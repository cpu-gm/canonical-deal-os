import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const BFF_BASE_URL = process.env.BFF_BASE_URL ?? "http://localhost:8787";
const KERNEL_BASE_URL = process.env.KERNEL_API_URL ?? "http://localhost:3001";
const USER_ID = process.env.DIAGNOSTICS_USER_ID ?? "diagnostics";
const ACTOR_ROLE_HEADER = "X-Actor-Role";
const USER_HEADER = "X-User-Id";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const canonicalRoot = path.resolve(__dirname, "..", "..");
const kernelServerPath = path.resolve(
  canonicalRoot,
  "..",
  "cre-kernel-phase1",
  "apps",
  "kernel-api",
  "src",
  "server.ts"
);

const runId = `${new Date().toISOString().replace(/[-:.TZ]/g, "")}-${crypto
  .randomBytes(3)
  .toString("hex")}`;

const report = {
  runId,
  startedAt: new Date().toISOString(),
  kernelBaseUrl: KERNEL_BASE_URL,
  bffBaseUrl: BFF_BASE_URL,
  steps: [],
  dealId: null,
  actorIds: {},
  materialIds: {},
  eventIds: {},
  explains: {},
  invariants: {}
};

function recordStep(name, ok, details = {}) {
  report.steps.push({ name, ok, details });
  const status = ok ? "PASS" : "FAIL";
  console.log(`${status} ${name}`);
  if (details.note) {
    console.log(`  ${details.note}`);
  }
}

function fail(message, details) {
  const error = new Error(message);
  error.details = details;
  throw error;
}

function ensure(condition, message, details) {
  if (!condition) {
    fail(message, details);
  }
}

async function fetchJson(url, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  let body = options.body;
  if (body && typeof body === "object" && !(body instanceof Buffer)) {
    body = JSON.stringify(body);
    if (!headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
  }

  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers,
      body
    });
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: error?.message ?? "fetch failed"
    };
  }

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    data,
    text
  };
}

function extractReasons(explain) {
  return Array.isArray(explain?.reasons) ? explain.reasons : [];
}

function extractReasonTypes(explain) {
  return extractReasons(explain).map((reason) => reason.type);
}

function extractReasonTypesByMaterial(explain) {
  return extractReasons(explain).map((reason) => ({
    type: reason.type,
    materialType: reason.materialType ?? null
  }));
}

function parseRolesFromRule(source, action) {
  const pattern = new RegExp(
    `action:\\s*\"${action}\"[\\s\\S]*?rolesAllowed:\\s*\\[([^\\]]*)\\]`,
    "m"
  );
  const match = source.match(pattern);
  if (!match) {
    return null;
  }
  return match[1]
    .split(",")
    .map((value) => value.replace(/["'\\s]/g, ""))
    .filter(Boolean);
}

async function discoverApprovalEventType() {
  const source = await fs.readFile(kernelServerPath, "utf8");
  const directMatch = source.match(
    new RegExp(
      'approvalEvents\\s*=\\s*events\\.filter\\(\\(event\\) => event\\.type === "([A-Za-z]+)"'
    )
  );
  if (directMatch) {
    return { eventType: directMatch[1], source: "approvalEvents filter" };
  }

  const mapMatches = [...source.matchAll(/(\\w+):\\s*\"APPROVAL_SIGNAL\"/g)].map(
    (match) => match[1]
  );
  if (mapMatches.length > 0) {
    const eventType = mapMatches.includes("ApprovalGranted")
      ? "ApprovalGranted"
      : mapMatches[0];
    return { eventType, source: "eventActionMap" };
  }

  throw new Error("Approval event type not found");
}

async function writeReport() {
  const outDir = path.resolve(__dirname, "out");
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, "proof-report.json");
  await fs.writeFile(outPath, JSON.stringify(report, null, 2), "utf8");
}

async function main() {
  console.log(`Diagnostics runId=${runId}`);

  const kernelHealth = await fetchJson(`${KERNEL_BASE_URL}/health`);
  ensure(kernelHealth.status === 200, "Kernel /health failed", kernelHealth);
  recordStep("A1 kernel /health", true, { status: kernelHealth.status });

  const bffHealth = await fetchJson(`${BFF_BASE_URL}/health`);
  ensure(bffHealth.status === 200, "BFF /health failed", bffHealth);
  ensure(
    bffHealth.data?.kernelTarget === KERNEL_BASE_URL,
    "BFF kernel target mismatch",
    bffHealth.data
  );
  recordStep("A2 BFF /health", true, {
    kernelTarget: bffHealth.data?.kernelTarget
  });

  const bffKernelDown = await fetchJson(`${BFF_BASE_URL}/health?probe=bad`);
  ensure(
    bffKernelDown.status === 502,
    "BFF did not report kernel down",
    bffKernelDown
  );
  recordStep("A3 BFF kernel-down 502", true, {
    status: bffKernelDown.status
  });

  const bffHealthRecovery = await fetchJson(`${BFF_BASE_URL}/health`);
  ensure(bffHealthRecovery.status === 200, "BFF /health recovery failed", {
    bffHealthRecovery
  });
  recordStep("A3 BFF recovery after probe", true, {
    status: bffHealthRecovery.status
  });

  const dealName = `Invariant Proof ${runId}`;
  const createDeal = await fetchJson(`${BFF_BASE_URL}/api/deals`, {
    method: "POST",
    headers: {
      [USER_HEADER]: USER_ID,
      [ACTOR_ROLE_HEADER]: "GP"
    },
    body: {
      name: dealName,
      profile: {
        asset_address: "1 Main St",
        lifecycle_state: "Injected"
      }
    }
  });
  ensure(createDeal.status === 201, "BFF deal create failed", createDeal);
  const dealId = createDeal.data?.id;
  ensure(dealId, "BFF deal create missing dealId", createDeal.data);
  report.dealId = dealId;
  recordStep("B1 create deal via BFF", true, { dealId });

  const listDeals = await fetchJson(`${BFF_BASE_URL}/api/deals`);
  ensure(Array.isArray(listDeals.data), "BFF deals list not array", listDeals);
  const listed = listDeals.data.find((deal) => deal.id === dealId);
  ensure(listed, "BFF list missing created deal", listDeals.data);
  recordStep("B2 list deals via BFF", true, { count: listDeals.data.length });

  const home = await fetchJson(`${BFF_BASE_URL}/api/deals/${dealId}/home`);
  ensure(home.status === 200, "BFF deal home failed", home);
  ensure(
    home.data?.deal?.lifecycle_state,
    "BFF deal home missing lifecycle_state",
    home.data
  );
  ensure(
    typeof home.data?.evidence?.total_artifacts === "number",
    "BFF deal home missing evidence totals",
    home.data?.evidence
  );
  ensure(Array.isArray(home.data?.events), "BFF deal home missing events", home);
  ensure(
    home.data?.deal?.lifecycle_state !== home.data?.deal?.profile?.lifecycle_state,
    "BFF lifecycle_state overridden by profile",
    home.data?.deal
  );
  recordStep("B3 deal home payload", true, {
    lifecycle_state: home.data?.deal?.lifecycle_state
  });

  const beforeFinalize = await fetchJson(
    `${BFF_BASE_URL}/api/deals/${dealId}/actions/FINALIZE_CLOSING`,
    {
      method: "POST",
      headers: {
        [USER_HEADER]: USER_ID,
        [ACTOR_ROLE_HEADER]: "GP"
      },
      body: {
        payload: { probeId: `${runId}-before-materials` }
      }
    }
  );
  ensure(beforeFinalize.status === 409, "Expected BLOCKED finalize", beforeFinalize);
  const explainBeforeMaterials =
    beforeFinalize.data?.explain ?? beforeFinalize.data;
  report.explains.beforeMaterials = explainBeforeMaterials;
  const reasonTypesBefore = extractReasonTypesByMaterial(explainBeforeMaterials);
  const reasonTypeSet = new Set(reasonTypesBefore.map((reason) => reason.type));
  ensure(
    reasonTypeSet.has("MISSING_MATERIAL"),
    "Missing material reason not found",
    reasonTypesBefore
  );
  ensure(
    reasonTypeSet.has("APPROVAL_THRESHOLD"),
    "Approval threshold reason missing",
    reasonTypesBefore
  );
  const missingTypes = reasonTypesBefore
    .filter((reason) => reason.type === "MISSING_MATERIAL")
    .map((reason) => reason.materialType);
  ensure(
    missingTypes.includes("WireConfirmation") &&
      missingTypes.includes("EntityFormationDocs"),
    "Missing material types mismatch",
    missingTypes
  );
  recordStep("C1 finalize blocked by materials+approvals", true, {
    missingTypes
  });

  const kernelMaterials = await fetchJson(
    `${KERNEL_BASE_URL}/deals/${dealId}/materials`
  );
  ensure(kernelMaterials.status === 200, "Kernel materials list failed", kernelMaterials);
  ensure(
    Array.isArray(kernelMaterials.data) && kernelMaterials.data.length === 0,
    "Kernel materials not empty initially",
    kernelMaterials.data
  );
  recordStep("C2 kernel materials empty", true);

  const wireMaterial = await fetchJson(
    `${KERNEL_BASE_URL}/deals/${dealId}/materials`,
    {
      method: "POST",
      body: {
        type: "WireConfirmation",
        truthClass: "DOC",
        meta: { runId, source: "diagnostics" }
      }
    }
  );
  ensure(wireMaterial.status === 201, "WireConfirmation material create failed", wireMaterial);
  report.materialIds.WireConfirmation = wireMaterial.data?.id ?? null;
  recordStep("D1 add WireConfirmation", true, {
    id: report.materialIds.WireConfirmation
  });

  const entityMaterial = await fetchJson(
    `${KERNEL_BASE_URL}/deals/${dealId}/materials`,
    {
      method: "POST",
      body: {
        type: "EntityFormationDocs",
        truthClass: "DOC",
        meta: { runId, source: "diagnostics" }
      }
    }
  );
  ensure(
    entityMaterial.status === 201,
    "EntityFormationDocs material create failed",
    entityMaterial
  );
  report.materialIds.EntityFormationDocs = entityMaterial.data?.id ?? null;
  recordStep("D2 add EntityFormationDocs", true, {
    id: report.materialIds.EntityFormationDocs
  });

  const afterMaterials = await fetchJson(
    `${BFF_BASE_URL}/api/deals/${dealId}/actions/FINALIZE_CLOSING`,
    {
      method: "POST",
      headers: {
        [USER_HEADER]: USER_ID,
        [ACTOR_ROLE_HEADER]: "GP"
      },
      body: {
        payload: { probeId: `${runId}-after-materials` }
      }
    }
  );
  ensure(afterMaterials.status === 409, "Expected BLOCKED finalize after materials", afterMaterials);
  const explainAfterMaterials =
    afterMaterials.data?.explain ?? afterMaterials.data;
  report.explains.afterMaterials = explainAfterMaterials;
  const reasonTypesAfterMaterials = extractReasonTypes(explainAfterMaterials);
  ensure(
    !reasonTypesAfterMaterials.includes("MISSING_MATERIAL"),
    "Missing material reason remained after adding materials",
    reasonTypesAfterMaterials
  );
  ensure(
    reasonTypesAfterMaterials.includes("APPROVAL_THRESHOLD"),
    "Approval threshold missing after materials",
    reasonTypesAfterMaterials
  );
  recordStep("E1 finalize blocked only by approvals", true, {
    reasons: reasonTypesAfterMaterials
  });

  const actors = await fetchJson(`${KERNEL_BASE_URL}/deals/${dealId}/actors`);
  ensure(actors.status === 200, "Kernel actors list failed", actors);
  const actorsByRole = new Map();
  for (const actor of actors.data ?? []) {
    for (const role of actor.roles ?? []) {
      if (!actorsByRole.has(role)) {
        actorsByRole.set(role, actor);
      }
    }
  }
  const gpActor = actorsByRole.get("GP");
  ensure(gpActor?.id, "GP actor missing", actors.data);
  report.actorIds.GP = gpActor.id;
  recordStep("F1 kernel actors include GP", true, { actorId: gpActor.id });

  async function ensureActor(role, type) {
    const existing = actorsByRole.get(role);
    if (existing?.id) {
      report.actorIds[role] = existing.id;
      return existing;
    }
    const created = await fetchJson(
      `${KERNEL_BASE_URL}/deals/${dealId}/actors`,
      {
        method: "POST",
        body: {
          name: `Diagnostics ${role} ${runId}`,
          type,
          role
        }
      }
    );
    ensure(created.status === 201, `Create ${role} actor failed`, created);
    report.actorIds[role] = created.data?.id ?? null;
    return created.data;
  }

  await ensureActor("LENDER", "SYSTEM");
  recordStep("F2 ensure LENDER actor", true, { actorId: report.actorIds.LENDER });
  await ensureActor("ESCROW", "SYSTEM");
  recordStep("F2 ensure ESCROW actor", true, { actorId: report.actorIds.ESCROW });

  const illegalActor = await fetchJson(
    `${KERNEL_BASE_URL}/deals/${dealId}/actors`,
    {
      method: "POST",
      body: {
        name: `Diagnostics ORG ${runId}`,
        type: "ORG",
        role: "LENDER"
      }
    }
  );
  ensure(illegalActor.status === 400, "Invalid actor type not rejected", illegalActor);
  recordStep("F3 invalid actor type rejected", true, {
    message: illegalActor.data?.message ?? null
  });

  const restrictedEvent = await fetchJson(
    `${KERNEL_BASE_URL}/deals/${dealId}/events`,
    {
      method: "POST",
      body: {
        type: "ReviewOpened",
        actorId: report.actorIds.LENDER,
        payload: { probeId: `${runId}-restricted` }
      }
    }
  );
  ensure(
    restrictedEvent.status === 403,
    "Restricted event did not reject LENDER",
    restrictedEvent
  );
  recordStep("F4 restricted event blocked for LENDER", true, {
    message: restrictedEvent.data?.message ?? null
  });

  const approvalDiscovery = await discoverApprovalEventType();
  report.eventIds.approvalEventType = approvalDiscovery.eventType;
  recordStep("G2 approval event type discovered", true, approvalDiscovery);

  const kernelExplainBeforeApprovals = await fetchJson(
    `${KERNEL_BASE_URL}/deals/${dealId}/explain`,
    {
      method: "POST",
      body: {
        action: "FINALIZE_CLOSING",
        actorId: report.actorIds.GP
      }
    }
  );
  ensure(
    kernelExplainBeforeApprovals.status === 200,
    "Kernel explain failed",
    kernelExplainBeforeApprovals
  );
  report.explains.kernelBeforeApprovals = kernelExplainBeforeApprovals.data;
  ensure(
    kernelExplainBeforeApprovals.data?.status === "BLOCKED",
    "Expected kernel explain blocked before approvals",
    kernelExplainBeforeApprovals.data
  );
  recordStep("G1 kernel explain blocked before approvals", true, {
    reasons: extractReasonTypes(kernelExplainBeforeApprovals.data)
  });

  const bffExplainBeforeApprovals = await fetchJson(
    `${BFF_BASE_URL}/api/deals/${dealId}/explain`,
    {
      method: "POST",
      headers: {
        [USER_HEADER]: USER_ID,
        [ACTOR_ROLE_HEADER]: "GP"
      },
      body: {
        actionType: "FINALIZE_CLOSING",
        payload: { probeId: `${runId}-explain-before-approvals` }
      }
    }
  );
  ensure(
    bffExplainBeforeApprovals.status === 200,
    "BFF explain failed",
    bffExplainBeforeApprovals
  );
  report.explains.bffBeforeApprovals = bffExplainBeforeApprovals.data;

  const kernelSource = await fs.readFile(kernelServerPath, "utf8");
  const finalizeRoles = parseRolesFromRule(kernelSource, "FINALIZE_CLOSING") ?? [
    "GP",
    "LENDER",
    "ESCROW"
  ];
  const attestRoles =
    parseRolesFromRule(kernelSource, "ATTEST_READY_TO_CLOSE") ?? ["GP", "LEGAL"];

  const legalActor = await ensureActor("LEGAL", "SYSTEM");
  recordStep("Advance: ensure LEGAL actor", true, { actorId: legalActor?.id });

  const reviewOpened = await fetchJson(
    `${BFF_BASE_URL}/api/deals/${dealId}/actions/OPEN_REVIEW`,
    {
      method: "POST",
      headers: {
        [USER_HEADER]: USER_ID,
        [ACTOR_ROLE_HEADER]: "GP"
      },
      body: {
        payload: { probeId: `${runId}-open-review` }
      }
    }
  );
  ensure(reviewOpened.status === 200, "OPEN_REVIEW action failed", reviewOpened);
  report.eventIds.reviewOpened = reviewOpened.data?.event?.id ?? null;
  recordStep("Advance: OPEN_REVIEW", true, {
    eventId: report.eventIds.reviewOpened
  });

  const underwritingMaterial = await fetchJson(
    `${KERNEL_BASE_URL}/deals/${dealId}/materials`,
    {
      method: "POST",
      body: {
        type: "UnderwritingSummary",
        truthClass: "HUMAN",
        meta: { runId, source: "diagnostics" }
      }
    }
  );
  ensure(
    underwritingMaterial.status === 201,
    "UnderwritingSummary material create failed",
    underwritingMaterial
  );
  report.materialIds.UnderwritingSummary = underwritingMaterial.data?.id ?? null;
  recordStep("Advance: add UnderwritingSummary", true, {
    id: report.materialIds.UnderwritingSummary
  });

  const approveAction = "APPROVE_DEAL";
  const approvalEventType = approvalDiscovery.eventType;
  const approveGrant = await fetchJson(
    `${KERNEL_BASE_URL}/deals/${dealId}/events`,
    {
      method: "POST",
      body: {
        type: approvalEventType,
        actorId: report.actorIds.GP,
        payload: { action: approveAction, runId }
      }
    }
  );
  ensure(approveGrant.status === 201, "Approval grant for APPROVE_DEAL failed", approveGrant);
  report.eventIds.approveDealApproval = approveGrant.data?.id ?? null;
  recordStep("Advance: approval for APPROVE_DEAL", true, {
    eventId: report.eventIds.approveDealApproval
  });

  const approveDeal = await fetchJson(
    `${BFF_BASE_URL}/api/deals/${dealId}/actions/APPROVE_DEAL`,
    {
      method: "POST",
      headers: {
        [USER_HEADER]: USER_ID,
        [ACTOR_ROLE_HEADER]: "GP"
      },
      body: {
        payload: { probeId: `${runId}-approve-deal` }
      }
    }
  );
  ensure(approveDeal.status === 200, "APPROVE_DEAL action failed", approveDeal);
  report.eventIds.dealApproved = approveDeal.data?.event?.id ?? null;
  recordStep("Advance: APPROVE_DEAL", true, {
    eventId: report.eventIds.dealApproved
  });

  const finalUnderwriting = await fetchJson(
    `${KERNEL_BASE_URL}/deals/${dealId}/materials`,
    {
      method: "POST",
      body: {
        type: "FinalUnderwriting",
        truthClass: "DOC",
        meta: { runId, source: "diagnostics" }
      }
    }
  );
  ensure(
    finalUnderwriting.status === 201,
    "FinalUnderwriting material create failed",
    finalUnderwriting
  );
  report.materialIds.FinalUnderwriting = finalUnderwriting.data?.id ?? null;
  recordStep("Advance: add FinalUnderwriting", true, {
    id: report.materialIds.FinalUnderwriting
  });

  const sourcesAndUses = await fetchJson(
    `${KERNEL_BASE_URL}/deals/${dealId}/materials`,
    {
      method: "POST",
      body: {
        type: "SourcesAndUses",
        truthClass: "DOC",
        meta: { runId, source: "diagnostics" }
      }
    }
  );
  ensure(
    sourcesAndUses.status === 201,
    "SourcesAndUses material create failed",
    sourcesAndUses
  );
  report.materialIds.SourcesAndUses = sourcesAndUses.data?.id ?? null;
  recordStep("Advance: add SourcesAndUses", true, {
    id: report.materialIds.SourcesAndUses
  });

  const attestAction = "ATTEST_READY_TO_CLOSE";
  for (const rawRole of attestRoles) {
    const role = String(rawRole).trim();
    const actorId = report.actorIds[role];
    ensure(actorId, `Missing actor for ${role}`, report.actorIds);
    const approval = await fetchJson(
      `${KERNEL_BASE_URL}/deals/${dealId}/events`,
      {
        method: "POST",
        body: {
          type: approvalEventType,
          actorId,
          payload: { action: attestAction, runId }
        }
      }
    );
    ensure(
      approval.status === 201,
      `Approval grant for ${attestAction} failed`,
      approval
    );
    if (!report.eventIds.attestApprovals) {
      report.eventIds.attestApprovals = [];
    }
    report.eventIds.attestApprovals.push(approval.data?.id ?? null);
  }
  recordStep("Advance: approvals for ATTEST_READY_TO_CLOSE", true, {
    eventIds: report.eventIds.attestApprovals
  });

  const attestReady = await fetchJson(
    `${BFF_BASE_URL}/api/deals/${dealId}/actions/ATTEST_READY_TO_CLOSE`,
    {
      method: "POST",
      headers: {
        [USER_HEADER]: USER_ID,
        [ACTOR_ROLE_HEADER]: "GP"
      },
      body: {
        payload: { probeId: `${runId}-attest-ready` }
      }
    }
  );
  ensure(
    attestReady.status === 200,
    "ATTEST_READY_TO_CLOSE action failed",
    attestReady
  );
  report.eventIds.attestReady = attestReady.data?.event?.id ?? null;
  recordStep("Advance: ATTEST_READY_TO_CLOSE", true, {
    eventId: report.eventIds.attestReady
  });

  const preFinalizeHome = await fetchJson(
    `${BFF_BASE_URL}/api/deals/${dealId}/home`
  );
  ensure(preFinalizeHome.status === 200, "BFF home before finalize failed", preFinalizeHome);
  const stateBeforeFinalize = preFinalizeHome.data?.deal?.lifecycle_state;
  report.invariants.stateBeforeFinalize = stateBeforeFinalize ?? null;

  for (const rawRole of finalizeRoles) {
    const role = String(rawRole).trim();
    const actorId = report.actorIds[role];
    ensure(actorId, `Missing actor for ${role}`, report.actorIds);
    const approval = await fetchJson(
      `${KERNEL_BASE_URL}/deals/${dealId}/events`,
      {
        method: "POST",
        body: {
          type: approvalEventType,
          actorId,
          payload: { action: "FINALIZE_CLOSING", runId }
        }
      }
    );
    ensure(
      approval.status === 201,
      `Approval grant for FINALIZE_CLOSING failed (${role})`,
      approval
    );
    if (!report.eventIds.finalizeApprovals) {
      report.eventIds.finalizeApprovals = [];
    }
    report.eventIds.finalizeApprovals.push(approval.data?.id ?? null);
  }
  recordStep("H1 approvals for FINALIZE_CLOSING", true, {
    eventIds: report.eventIds.finalizeApprovals
  });

  const kernelExplainAfterApprovals = await fetchJson(
    `${KERNEL_BASE_URL}/deals/${dealId}/explain`,
    {
      method: "POST",
      body: {
        action: "FINALIZE_CLOSING",
        actorId: report.actorIds.GP
      }
    }
  );
  ensure(
    kernelExplainAfterApprovals.status === 200,
    "Kernel explain after approvals failed",
    kernelExplainAfterApprovals
  );
  report.explains.kernelAfterApprovals = kernelExplainAfterApprovals.data;
  ensure(
    kernelExplainAfterApprovals.data?.status === "ALLOWED",
    "Kernel explain did not allow after approvals",
    kernelExplainAfterApprovals.data
  );
  recordStep("H2 kernel explain allowed after approvals", true, {
    status: kernelExplainAfterApprovals.data?.status
  });

  const bffExplainAfterApprovals = await fetchJson(
    `${BFF_BASE_URL}/api/deals/${dealId}/explain`,
    {
      method: "POST",
      headers: {
        [USER_HEADER]: USER_ID,
        [ACTOR_ROLE_HEADER]: "GP"
      },
      body: {
        actionType: "FINALIZE_CLOSING",
        payload: { probeId: `${runId}-explain-after-approvals` }
      }
    }
  );
  ensure(
    bffExplainAfterApprovals.status === 200,
    "BFF explain after approvals failed",
    bffExplainAfterApprovals
  );
  report.explains.bffAfterApprovals = bffExplainAfterApprovals.data;

  const finalize = await fetchJson(
    `${BFF_BASE_URL}/api/deals/${dealId}/actions/FINALIZE_CLOSING`,
    {
      method: "POST",
      headers: {
        [USER_HEADER]: USER_ID,
        [ACTOR_ROLE_HEADER]: "GP"
      },
      body: {
        payload: { probeId: `${runId}-finalize` }
      }
    }
  );
  ensure(finalize.status === 200, "Finalize closing via BFF failed", finalize);
  report.eventIds.finalize = finalize.data?.event?.id ?? null;
  recordStep("I1 finalize closing via BFF", true, {
    eventId: report.eventIds.finalize
  });

  const kernelEvents = await fetchJson(
    `${KERNEL_BASE_URL}/deals/${dealId}/events`
  );
  ensure(kernelEvents.status === 200, "Kernel events list failed", kernelEvents);
  const finalizeEvent = (kernelEvents.data ?? []).find(
    (event) => event.type === "ClosingFinalized"
  );
  ensure(finalizeEvent, "ClosingFinalized event missing", kernelEvents.data);
  report.eventIds.finalizeKernel = finalizeEvent?.id ?? null;
  recordStep("I2 kernel events include ClosingFinalized", true, {
    eventId: report.eventIds.finalizeKernel
  });

  const postFinalizeHome = await fetchJson(
    `${BFF_BASE_URL}/api/deals/${dealId}/home`
  );
  ensure(postFinalizeHome.status === 200, "BFF home after finalize failed", postFinalizeHome);
  const stateAfterFinalize = postFinalizeHome.data?.deal?.lifecycle_state;
  report.invariants.stateAfterFinalize = stateAfterFinalize ?? null;
  ensure(
    stateAfterFinalize && stateAfterFinalize !== stateBeforeFinalize,
    "Lifecycle state did not advance after finalize",
    { stateBeforeFinalize, stateAfterFinalize }
  );
  recordStep("I3 lifecycle_state advanced", true, {
    stateBeforeFinalize,
    stateAfterFinalize
  });

  const beforeReasons = extractReasonTypes(bffExplainBeforeApprovals.data);
  const afterReasons = extractReasonTypes(bffExplainAfterApprovals.data);
  report.invariants.reasonDiff = {
    before: beforeReasons,
    after: afterReasons
  };

  const invariants = {
    I1: reasonTypeSet.has("MISSING_MATERIAL") &&
      !reasonTypesAfterMaterials.includes("MISSING_MATERIAL"),
    I2: illegalActor.status === 400 && restrictedEvent.status === 403,
    I3: kernelExplainAfterApprovals.data?.status === "ALLOWED",
    I4:
      bffExplainBeforeApprovals.data?.status === "BLOCKED" &&
      bffExplainAfterApprovals.data?.status === "ALLOWED",
    I5:
      home.data?.deal?.lifecycle_state &&
      home.data?.deal?.lifecycle_state !== home.data?.deal?.profile?.lifecycle_state
  };
  report.invariants = invariants;

  Object.entries(invariants).forEach(([key, ok]) => {
    recordStep(`${key} invariant`, Boolean(ok));
  });

  const allPassed = Object.values(invariants).every(Boolean);
  if (!allPassed) {
    throw new Error("One or more invariants failed");
  }

  console.log("INVARIANTS VERIFIED");
}

try {
  await main();
  await writeReport();
  process.exit(0);
} catch (error) {
  console.error("Diagnostics failed:", error?.message ?? error);
  if (error?.details) {
    console.error("Details:", error.details);
  }
  await writeReport();
  process.exit(1);
}
