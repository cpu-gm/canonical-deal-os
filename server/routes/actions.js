import { actionTypeSchema, explainBlockSchema, explainResponseSchema, actionResponseSchema } from "../../src/lib/contracts.js";
import { resolveActionEventType } from "../mappers.js";
import { getIdempotencyEntry, upsertIdempotencyEntry, getUserActor, upsertUserActor } from "../store.js";
import { kernelRequest, kernelFetchJson } from "../kernel.js";
import { createHash } from "node:crypto";
import { invalidateDealCaches } from "./deals.js";
import { readStore } from "../store.js";
import { extractAuthUser } from "./auth.js";
import { getPrisma } from "../db.js";

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

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries
      .map(([key, val]) => `"${key}":${stableStringify(val)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function hashPayload(payload) {
  const input = stableStringify(payload ?? {});
  return createHash("sha256").update(input).digest("hex");
}

function buildIdempotencyKey(dealId, actionType, actorId, payloadHash) {
  return `${dealId}:${actionType}:${actorId}:${payloadHash}`;
}

function normalizeExplain(explain) {
  const parsed = explainBlockSchema.safeParse(explain);
  return parsed.success ? parsed.data : explain;
}

async function probeActorsEndpoint(dealId, kernelBaseUrl) {
  const result = await kernelRequest(`${kernelBaseUrl}/deals/${dealId}/actors`, {
    method: "GET"
  });
  if (result.ok) {
    return true;
  }
  if (result.status === 404 && result.data?.message === "Deal not found") {
    return true;
  }
  if (result.status === 404 || result.status === 405) {
    return false;
  }
  return true;
}

export async function getOrCreateActorId(dealId, userId, role, kernelBaseUrl) {
  const existing = await getUserActor(userId, dealId);
  if (existing?.actorId) {
    return existing.actorId;
  }

  const demoActorId = process.env.DEMO_ACTOR_ID;
  const endpointAvailable = await probeActorsEndpoint(dealId, kernelBaseUrl);
  if (!endpointAvailable) {
    if (demoActorId) {
      await upsertUserActor({
        userId,
        dealId,
        actorId: demoActorId,
        role
      });
      return demoActorId;
    }
    throw new Error("Actor endpoint unavailable");
  }

  const payloads = [
    { name: `Canonical ${role}`, type: "HUMAN", role },
    { name: `Canonical ${role}`, type: "HUMAN", roles: [role] },
    { name: `Canonical ${role}`, role }
  ];

  let lastError = null;
  for (const payload of payloads) {
    try {
      const actor = await kernelFetchJson(
        `${kernelBaseUrl}/deals/${dealId}/actors`,
        {
          method: "POST",
          body: JSON.stringify(payload)
        }
      );
      const actorId = actor?.id ?? null;
      if (actorId) {
        await upsertUserActor({
          userId,
          dealId,
          actorId,
          role
        });
        return actorId;
      }
    } catch (error) {
      lastError = error;
      if (error?.status === 404 && error?.data?.message === "Deal not found") {
        throw error;
      }
    }
  }

  if (demoActorId) {
    await upsertUserActor({
      userId,
      dealId,
      actorId: demoActorId,
      role
    });
    return demoActorId;
  }

  throw lastError ?? new Error("Actor creation failed");
}

async function explainWithFallback(
  dealId,
  actionType,
  actorId,
  actionPayload,
  kernelBaseUrl
) {
  const body = {
    action: actionType,
    actorId,
    payload: actionPayload,
    authorityContext: {},
    evidenceRefs: []
  };

  const primary = await kernelRequest(
    `${kernelBaseUrl}/deals/${dealId}/explain`,
    {
      method: "POST",
      body: JSON.stringify(body)
    }
  );

  if (primary.ok) {
    return { data: primary.data, usedAction: actionType };
  }

  const message = String(primary.data?.message ?? "");
  const isUnknownAction =
    primary.status === 400 && message.toLowerCase().includes("unknown action");

  if (isUnknownAction) {
    const eventType = resolveActionEventType(actionType);
    if (eventType) {
      const fallbackPayload = {
        ...body,
        action: eventType
      };
      const secondary = await kernelRequest(
        `${kernelBaseUrl}/deals/${dealId}/explain`,
        {
          method: "POST",
          body: JSON.stringify(fallbackPayload)
        }
      );
      if (secondary.ok) {
        return { data: secondary.data, usedAction: eventType };
      }
      const error = new Error(`Kernel explain failed ${secondary.status}`);
      error.status = secondary.status;
      error.data = secondary.data;
      throw error;
    }
  }

  const error = new Error(`Kernel explain failed ${primary.status}`);
  error.status = primary.status;
  error.data = primary.data;
  throw error;
}

const ACTION_IDEMPOTENCY_TTL_MS = Number(
  process.env.BFF_ACTION_IDEMPOTENCY_TTL_MS ?? 60000
);

export async function handleExplain(req, res, dealId, kernelBaseUrl, resolveUserId, resolveActorRole) {
  // Authentication check
  const authUser = await extractAuthUser(req);
  if (!authUser) {
    return sendError(res, 401, "Not authenticated");
  }

  // Organization isolation check
  const store = await readStore();
  const record = store.dealIndex.find((item) => item.id === dealId);
  if (!record) {
    return sendError(res, 404, "Deal not found");
  }
  if (record.organizationId && record.organizationId !== authUser.organizationId) {
    return sendError(res, 403, "Access denied - deal belongs to different organization");
  }

  const body = await new Promise((resolve) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve(null);
      } else {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch {
          resolve(null);
        }
      }
    });
  });

  const actionType = body?.actionType;
  const parsedAction = actionTypeSchema.safeParse(actionType);
  if (!parsedAction.success) {
    return sendError(res, 400, "Unsupported action type");
  }

  const actionPayload =
    body && typeof body === "object" && body.payload && typeof body.payload === "object"
      ? body.payload
      : {};

  const userId = authUser.id;
  const role = authUser.role;
  const actorId = await getOrCreateActorId(dealId, userId, role, kernelBaseUrl);

  const explainResult = await explainWithFallback(
    dealId,
    parsedAction.data,
    actorId,
    actionPayload,
    kernelBaseUrl
  );

  const payload =
    explainResult.data?.status === "BLOCKED"
      ? normalizeExplain(explainResult.data)
      : explainResult.data;

  sendJson(res, 200, explainResponseSchema.parse(payload));
}

export async function handleAction(req, res, dealId, actionType, kernelBaseUrl, readJsonBody, resolveUserId, resolveActorRole, inFlight) {
  // Authentication check
  const authUser = await extractAuthUser(req);
  if (!authUser) {
    return sendError(res, 401, "Not authenticated");
  }

  // Role enforcement: only GP or Admin can execute actions
  if (!['GP', 'Admin'].includes(authUser.role)) {
    return sendError(res, 403, "GP or Admin role required to execute actions");
  }

  const parsedAction = actionTypeSchema.safeParse(actionType);
  if (!parsedAction.success) {
    return sendError(res, 400, "Unsupported action type");
  }

  const store = await readStore();
  const record = store.dealIndex.find((item) => item.id === dealId);
  if (!record) {
    return sendError(res, 404, "Deal not indexed in BFF");
  }

  // Organization isolation check
  if (record.organizationId && record.organizationId !== authUser.organizationId) {
    return sendError(res, 403, "Access denied - deal belongs to different organization");
  }

  const body = await readJsonBody(req);
  const actionPayload =
    body && typeof body === "object" && body.payload && typeof body.payload === "object"
      ? body.payload
      : {};

  const userId = authUser.id;
  const role = authUser.role;

  const actorId = await getOrCreateActorId(dealId, userId, role, kernelBaseUrl);
  const payloadHash = hashPayload(actionPayload);
  const idempotencyKey = buildIdempotencyKey(
    dealId,
    parsedAction.data,
    actorId,
    payloadHash
  );

  const cached = await getIdempotencyEntry(idempotencyKey);
  if (cached?.payload) {
    return sendJson(res, cached.status, cached.payload);
  }

  const inFlightKey = `idempotency:${idempotencyKey}`;
  const result = await inFlight(inFlightKey, async () => {
    const cachedEntry = await getIdempotencyEntry(idempotencyKey);
    if (cachedEntry?.payload) {
      return { status: cachedEntry.status, payload: cachedEntry.payload };
    }

    const explainResult = await explainWithFallback(
      dealId,
      parsedAction.data,
      actorId,
      actionPayload,
      kernelBaseUrl
    );

    if (explainResult.data?.status === "BLOCKED") {
      const blockedPayload = {
        status: 409,
        payload: {
          status: "BLOCKED",
          action: parsedAction.data,
          explain: normalizeExplain(explainResult.data)
        }
      };
      await upsertIdempotencyEntry({
        key: idempotencyKey,
        dealId,
        actionType: parsedAction.data,
        actorId,
        payloadHash,
        status: blockedPayload.status,
        payload: blockedPayload.payload,
        appendedEventId: null,
        createdAt: new Date().toISOString(),
        expiresAt: Date.now() + ACTION_IDEMPOTENCY_TTL_MS
      });
      return blockedPayload;
    }

    const eventType = resolveActionEventType(parsedAction.data);
    if (!eventType) {
      return {
        status: 400,
        payload: { message: "No event mapping for action" }
      };
    }

    const appendResult = await kernelRequest(
      `${kernelBaseUrl}/deals/${dealId}/events`,
      {
        method: "POST",
        body: JSON.stringify({
          type: eventType,
          actorId,
          payload: actionPayload,
          authorityContext: {},
          evidenceRefs: []
        })
      }
    );

    if (appendResult.ok) {
      const appendedEventId = appendResult.data?.id ?? null;
      const response = actionResponseSchema.parse({
        status: "ALLOWED",
        action: parsedAction.data,
        event: appendResult.data,
        appendedEventId
      });
      await upsertIdempotencyEntry({
        key: idempotencyKey,
        dealId,
        actionType: parsedAction.data,
        actorId,
        payloadHash,
        status: 200,
        payload: response,
        appendedEventId,
        createdAt: new Date().toISOString(),
        expiresAt: Date.now() + ACTION_IDEMPOTENCY_TTL_MS
      });
      return { status: 200, payload: response };
    }

    if (appendResult.status === 409 && appendResult.data) {
      const blockedPayload = {
        status: 409,
        payload: {
          status: "BLOCKED",
          action: parsedAction.data,
          explain: normalizeExplain(appendResult.data)
        }
      };
      await upsertIdempotencyEntry({
        key: idempotencyKey,
        dealId,
        actionType: parsedAction.data,
        actorId,
        payloadHash,
        status: blockedPayload.status,
        payload: blockedPayload.payload,
        appendedEventId: null,
        createdAt: new Date().toISOString(),
        expiresAt: Date.now() + ACTION_IDEMPOTENCY_TTL_MS
      });
      return blockedPayload;
    }

    if (appendResult.status >= 500) {
      return {
        status: 502,
        payload: { message: "Kernel unavailable" }
      };
    }

    return {
      status: appendResult.status,
      payload: appendResult.data ?? { message: "Kernel request failed" }
    };
  });

  if (result.status === 200 && result.payload?.status === "ALLOWED") {
    invalidateDealCaches(dealId);

    // Log action execution for audit trail
    const prisma = getPrisma();
    const eventType = resolveActionEventType(parsedAction.data);
    await prisma.permissionAuditLog.create({
      data: {
        actorId: authUser.id,
        actorName: authUser.name,
        targetUserId: authUser.id,
        action: `ACTION_${parsedAction.data.toUpperCase()}`,
        afterValue: JSON.stringify({ dealId, actionType: parsedAction.data, eventType }),
        ipAddress: req.headers["x-forwarded-for"] || req.socket?.remoteAddress
      }
    });
  }

  return sendJson(res, result.status, result.payload);
}
