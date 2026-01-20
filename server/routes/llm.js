import { llmDealParseRequestSchema, llmParseDealResponseSchema, llmForceAcceptRequestSchema, correctionsRequestSchema, dataTrustResponseSchema } from "../../src/lib/contracts.js";
import { getLLMProviderMeta, requestDealParse, PROMPT_VERSION, SCHEMA_VERSION } from "../llm.js";
import { buildAirlockMeta, buildProvenance, buildRecommendedTasks, normalizeParsedDeal, runEvaluators, summarizeTrust } from "../airlock.js";
import { getPrisma } from "../db.js";
import { deleteCacheByPrefix } from "../runtime.js";
import { invalidateDealCaches } from "./deals.js";

const toJsonString = (value) => {
  if (value === undefined || value === null) {
    return null;
  }
  return JSON.stringify(value);
};

const parseJsonString = (value, fallback = null) => {
  if (typeof value !== "string") {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(JSON.stringify(payload));
}

function sendError(res, status, message, details) {
  sendJson(res, status, { message, details: details ?? null });
}

export async function handleDealParse(req, res, readJsonBody, resolveUserId) {
  const body = await readJsonBody(req);
  const inputText = body?.inputText ?? body?.text ?? null;
  const inputSource = body?.inputSource ?? "USER_TEXT";
  const parsed = llmDealParseRequestSchema.safeParse({
    inputText,
    inputSource
  });
  if (!parsed.success) {
    return sendError(res, 400, "Invalid request", parsed.error.flatten());
  }

  const userId = resolveUserId(req);
  const prisma = getPrisma();
  const startedAt = Date.now();

  let providerMeta = { provider: "unconfigured", model: null };
  try {
    providerMeta = getLLMProviderMeta();
  } catch (error) {
    const session = await prisma.lLMParseSession.create({
      data: {
        userId: userId ?? null,
        inputText: parsed.data.inputText,
        inputSource: parsed.data.inputSource ?? "USER_TEXT",
        provider: providerMeta.provider,
        model: providerMeta.model,
        promptVersion: PROMPT_VERSION,
        schemaVersion: SCHEMA_VERSION,
        temperature: null,
        status: "PROVIDER_ERROR",
        errorMessage: error?.message ?? "LLM unavailable",
        completedAt: new Date(),
        latencyMs: Date.now() - startedAt
      }
    });
    return sendError(res, 502, "LLM unavailable", error?.message ?? null);
  }

  const meta = buildAirlockMeta(providerMeta.provider);

  const session = await prisma.lLMParseSession.create({
    data: {
      userId: userId ?? null,
      inputText: parsed.data.inputText,
      inputSource: parsed.data.inputSource ?? "USER_TEXT",
      provider: meta.provider,
      model: providerMeta.model,
      promptVersion: meta.promptVersion,
      schemaVersion: meta.schemaVersion,
      temperature: null,
      status: "PENDING"
    }
  });

  const attemptPayloads = [];
  let rawResponse = null;
  let normalized = null;
  let attemptCount = 1;

  try {
    const llmResult = await requestDealParse(parsed.data.inputText, "BASE");
    rawResponse = llmResult.raw;
    attemptPayloads.push({
      variant: "BASE",
      provider: llmResult.provider,
      model: llmResult.model,
      response: rawResponse
    });
    normalized = normalizeParsedDeal(llmResult.output);
  } catch (error) {
    await prisma.lLMParseSession.update({
      where: { id: session.id },
      data: {
        status: "PROVIDER_ERROR",
        errorMessage: error?.message ?? "LLM unavailable",
        completedAt: new Date(),
        latencyMs: Date.now() - startedAt,
        provider: providerMeta.provider,
        model: providerMeta.model,
        rawProviderResponse: toJsonString(attemptPayloads)
      }
    });
    return sendError(res, 502, "LLM unavailable", error?.message ?? null);
  }

  let validation = llmDealParseRequestSchema.safeParse(normalized);
  if (!validation.success) {
    attemptCount = 2;
    try {
      const llmResult = await requestDealParse(
        parsed.data.inputText,
        "STRICT_REPAIR"
      );
      rawResponse = llmResult.raw;
      attemptPayloads.push({
        variant: "STRICT_REPAIR",
        provider: llmResult.provider,
        model: llmResult.model,
        response: rawResponse
      });
      normalized = normalizeParsedDeal(llmResult.output);
      validation = llmDealParseRequestSchema.safeParse(normalized);
    } catch (error) {
      await prisma.lLMParseSession.update({
        where: { id: session.id },
        data: {
          status: "PROVIDER_ERROR",
          errorMessage: error?.message ?? "LLM unavailable",
          completedAt: new Date(),
          latencyMs: Date.now() - startedAt,
          attempts: attemptCount,
          provider: providerMeta.provider,
          model: providerMeta.model,
          rawProviderResponse: toJsonString(attemptPayloads)
        }
      });
      return sendError(res, 502, "LLM unavailable", error?.message ?? null);
    }
  }

  if (!validation.success) {
    const provenance = buildProvenance(normalized, {
      source: "AI",
      now: new Date().toISOString()
    });
    const evaluatorReport = runEvaluators(normalized, provenance);
    const recommendedTasks = buildRecommendedTasks(provenance, evaluatorReport);

    await prisma.$transaction([
      prisma.lLMParseSession.update({
        where: { id: session.id },
        data: {
          status: "VALIDATION_FAILED",
          errorMessage: "Validation failed after retry",
          completedAt: new Date(),
          latencyMs: Date.now() - startedAt,
          attempts: attemptCount,
          rawProviderResponse: toJsonString(attemptPayloads),
          parsedResult: toJsonString({ parsedDeal: normalized, recommendedTasks }),
          evaluatorReport: toJsonString(evaluatorReport),
          provider: providerMeta.provider,
          model: providerMeta.model
        }
      }),
      prisma.lLMFieldProvenance.createMany({
        data: provenance.map((row) => ({
          sessionId: session.id,
          fieldPath: row.fieldPath,
          value: toJsonString(row.value),
          source: row.source,
          confidence: row.confidence,
          rationale: row.rationale,
          evidenceNeeded: row.evidenceNeeded,
          artifactId: row.artifactId,
          asOf: row.asOf ? new Date(row.asOf) : new Date()
        }))
      })
    ]);

    const responsePayload = {
      sessionId: session.id,
      status: "VALIDATION_FAILED",
      parsedDeal: normalized,
      provenance,
      evaluatorReport,
      recommendedTasks
    };
    return sendJson(res, 422, llmParseDealResponseSchema.parse(responsePayload));
  }

  const provenance = buildProvenance(normalized, {
    source: "AI",
    now: new Date().toISOString()
  });
  const evaluatorReport = runEvaluators(normalized, provenance);
  const recommendedTasks = buildRecommendedTasks(provenance, evaluatorReport);
  const status = evaluatorReport.status === "OK" ? "OK" : "EVAL_FAILED";

  await prisma.$transaction([
    prisma.lLMParseSession.update({
      where: { id: session.id },
      data: {
        status,
        completedAt: new Date(),
        latencyMs: Date.now() - startedAt,
        attempts: attemptCount,
        rawProviderResponse: toJsonString(attemptPayloads),
        parsedResult: toJsonString({ parsedDeal: normalized, recommendedTasks }),
        evaluatorReport: toJsonString(evaluatorReport),
        provider: providerMeta.provider,
        model: providerMeta.model
      }
    }),
    prisma.lLMFieldProvenance.createMany({
      data: provenance.map((row) => ({
        sessionId: session.id,
        fieldPath: row.fieldPath,
        value: toJsonString(row.value),
        source: row.source,
        confidence: row.confidence,
        rationale: row.rationale,
        evidenceNeeded: row.evidenceNeeded,
        artifactId: row.artifactId,
        asOf: row.asOf ? new Date(row.asOf) : new Date()
      }))
    })
  ]);

  const responsePayload = {
    sessionId: session.id,
    status,
    parsedDeal: normalized,
    provenance,
    evaluatorReport,
    recommendedTasks
  };

  if (status === "EVAL_FAILED") {
    return sendJson(res, 422, llmParseDealResponseSchema.parse(responsePayload));
  }
  return sendJson(res, 200, llmParseDealResponseSchema.parse(responsePayload));
}

export async function handleForceAccept(req, res, readJsonBody, getPrisma) {
  const body = await readJsonBody(req);
  const parsed = llmForceAcceptRequestSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return sendError(res, 400, "Invalid request", parsed.error.flatten());
  }

  const prisma = getPrisma();
  const session = await prisma.lLMParseSession.findUnique({
    where: { id: parsed.data.sessionId }
  });
  if (!session) {
    return sendError(res, 404, "Parse session not found");
  }

  await prisma.lLMParseSession.update({
    where: { id: parsed.data.sessionId },
    data: {
      forceAccepted: true,
      forceAcceptedRationale: parsed.data.rationale,
      status: "OK"
    }
  });

  sendJson(res, 200, { ok: true });
}

export async function handleCorrections(req, res, dealId, readJsonBody, resolveUserId, getPrisma) {
  const body = await readJsonBody(req);
  const parsed = correctionsRequestSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return sendError(res, 400, "Invalid request", parsed.error.flatten());
  }

  const prisma = getPrisma();
  const userId = resolveUserId(req);

  if (parsed.data.diffs.length === 0) {
    return sendJson(res, 200, { ok: true });
  }

  await prisma.dealCorrection.createMany({
    data: parsed.data.diffs.map((diff) => ({
      dealId,
      userId,
      sessionId: parsed.data.sessionId ?? null,
      fieldPath: diff.fieldPath,
      oldValue: toJsonString(diff.oldValue),
      newValue: toJsonString(diff.newValue),
      correctionType: diff.correctionType
    }))
  });

  sendJson(res, 200, { ok: true });
}

export async function handleDataTrust(res, dealId, getPrisma) {
  const prisma = getPrisma();
  const latestSession = await prisma.lLMParseSession.findFirst({
    where: { dealId },
    orderBy: { completedAt: "desc" }
  });

  if (!latestSession) {
    const response = {
      docCount: 0,
      aiCount: 0,
      humanCount: 0,
      openTasksCount: 0,
      tasks: []
    };
    return sendJson(res, 200, dataTrustResponseSchema.parse(response));
  }

  const provenanceRows = await prisma.lLMFieldProvenance.findMany({
    where: { sessionId: latestSession.id }
  });

  const tasks = await prisma.workflowTask.findMany({
    where: { dealId, status: "OPEN" },
    orderBy: { updatedAt: "desc" }
  });

  const summary = summarizeTrust(provenanceRows);

  const response = {
    docCount: summary.docCount,
    aiCount: summary.aiCount,
    humanCount: summary.humanCount,
    openTasksCount: tasks.length,
    tasks: tasks.map((task) => ({
      id: task.id,
      dealId: task.dealId,
      type: task.type,
      title: task.title,
      description: task.description,
      status: task.status,
      relatedFieldPath: task.relatedFieldPath,
      relatedArtifactId: task.relatedArtifactId,
      severity: task.severity,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString()
    }))
  };

  sendJson(res, 200, dataTrustResponseSchema.parse(response));
}
