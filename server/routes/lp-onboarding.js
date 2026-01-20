import {
  lpInvitationRequestSchema,
  lpInvitationSchema,
  lpPortalLandingSchema,
  lpInvestmentDetailSchema,
  lpPortalSummarySchema,
  lpPortalInvestmentListSchema
} from "../../src/lib/contracts.js";
import { kernelFetchJson, kernelRequest } from "../kernel.js";
import { getPrisma } from "../db.js";
import { getCache, setCache, deleteCache, deleteCacheByPrefix, mapWithLimit } from "../runtime.js";
import { readStore } from "../store.js";
import { emitLpWebhook, isLpEmailEnabled, isLpWebhookEnabled, sendLpInvitationEmail } from "../notifications.js";
import { buildCanonicalDeal } from "../mappers.js";
import crypto from "node:crypto";

const LP_PORTAL_CACHE_TTL = Number(process.env.BFF_LP_PORTAL_TTL_MS ?? 5000);
const LP_INVITATION_EXPIRY_DAYS = 30;

// ========== LOGGING ==========
const LOG_PREFIX = "[LPOnboarding]";

function log(message, data = {}) {
  const timestamp = new Date().toISOString();
  console.log(`${timestamp} ${LOG_PREFIX} ${message}`, Object.keys(data).length > 0 ? JSON.stringify(data) : '');
}

function logError(message, error = null, data = {}) {
  const timestamp = new Date().toISOString();
  console.error(`${timestamp} ${LOG_PREFIX} ERROR: ${message}`, {
    ...data,
    error: error?.message || String(error || ''),
    stack: error?.stack?.split('\n').slice(0, 3).join(' | ') || ''
  });
}

function logWarn(message, data = {}) {
  const timestamp = new Date().toISOString();
  console.warn(`${timestamp} ${LOG_PREFIX} WARN: ${message}`, JSON.stringify(data));
}

function logDebug(message, data = {}) {
  if (process.env.DEBUG_LPONBOARDING === 'true') {
    const timestamp = new Date().toISOString();
    console.log(`${timestamp} ${LOG_PREFIX} DEBUG: ${message}`, JSON.stringify(data));
  }
}

// ========== SHARE CLASS HELPERS ==========

/**
 * Get or create default share class for a deal
 * Used when no share class is specified for an LP
 */
async function getOrCreateDefaultShareClass(dealId, organizationId, createdBy = null, createdByName = null) {
  log(`Getting/creating default share class`, { dealId, organizationId });

  const prisma = getPrisma();

  // Look for existing default (Class A)
  let defaultClass = await prisma.shareClass.findFirst({
    where: { dealId, code: 'A' }
  });

  if (defaultClass) {
    log(`Default share class found`, { dealId, shareClassId: defaultClass.id, code: defaultClass.code });
    return defaultClass;
  }

  // Create default Class A
  log(`Creating default Class A`, { dealId });
  defaultClass = await prisma.shareClass.create({
    data: {
      dealId,
      organizationId,
      name: 'Class A',
      code: 'A',
      description: 'Default share class',
      votingRights: true,
      priority: 1,
      createdBy,
      createdByName
    }
  });

  log(`Default Class A created`, { dealId, shareClassId: defaultClass.id });
  return defaultClass;
}

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

function sendKernelUnavailable(res, error) {
  sendJson(res, 502, {
    message: "Kernel unavailable",
    details: error?.message ?? null
  });
}

/**
 * Send LP invitation to join a deal
 * POST /api/lp/invitations
 * Body: { lpEntityName, lpEmail, dealId, commitment, ownershipPct, shareClassId? }
 */
export async function handleSendInvitation(req, res, readJsonBody, kernelBaseUrl, resolveUserId) {
  log(`POST /lp/invitations`);

  const body = await readJsonBody(req);
  const parsed = lpInvitationRequestSchema.safeParse(body ?? {});
  if (!parsed.success) {
    log(`Validation failed`, { errors: parsed.error.flatten() });
    return sendError(res, 400, "Invalid request", parsed.error.flatten());
  }

  const prisma = getPrisma();
  const userId = resolveUserId(req);
  const dealId = parsed.data.dealId;
  const shareClassId = body?.shareClassId || null;

  log(`Creating LP invitation`, {
    dealId,
    lpEmail: parsed.data.lpEmail,
    lpEntityName: parsed.data.lpEntityName,
    shareClassId: shareClassId || 'default'
  });

  // Verify deal exists in kernel
  try {
    await kernelFetchJson(`${kernelBaseUrl}/deals/${dealId}`);
  } catch (error) {
    if (error?.status === 404) {
      log(`Deal not found`, { dealId });
      return sendError(res, 404, "Deal not found");
    }
    logError(`Kernel unavailable`, error, { dealId });
    return sendKernelUnavailable(res, error);
  }

  // If shareClassId provided, validate it belongs to this deal
  if (shareClassId) {
    log(`Validating shareClassId`, { dealId, shareClassId });
    const shareClass = await prisma.shareClass.findFirst({
      where: { id: shareClassId, dealId }
    });

    if (!shareClass) {
      logError(`Invalid shareClassId - not found or wrong deal`, null, { shareClassId, dealId });
      return sendError(res, 400, "Share class not found or does not belong to this deal");
    }
    log(`ShareClass validated`, { shareClassId, code: shareClass.code, name: shareClass.name });
  }

  const needsNotifications = isLpEmailEnabled() || isLpWebhookEnabled();
  let dealName = null;
  if (needsNotifications) {
    const store = await readStore();
    const record = store.dealIndex.find((r) => r.id === dealId);
    dealName = record?.name ?? null;
  }

  // Create invitation record
  const invitationId = crypto.randomUUID();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + LP_INVITATION_EXPIRY_DAYS);

  log(`Creating invitation record`, { invitationId, dealId, shareClassId });

  const invitation = await prisma.lPInvitation.create({
    data: {
      id: invitationId,
      dealId,
      lpEntityName: parsed.data.lpEntityName,
      lpEmail: parsed.data.lpEmail,
      commitment: parsed.data.commitment,
      ownershipPct: parsed.data.ownershipPct,
      status: "PENDING",
      createdByUserId: userId,
      expiresAt,
      createdAt: new Date(),
      acceptedAt: null,
      shareClassId  // NEW: Optional share class
    }
  });

  if (isLpEmailEnabled()) {
    void sendLpInvitationEmail({
      lpEmail: parsed.data.lpEmail,
      lpEntityName: parsed.data.lpEntityName,
      invitationId: invitation.id,
      dealId,
      dealName,
      commitment: parsed.data.commitment,
      ownershipPct: parsed.data.ownershipPct,
      expiresAt: invitation.expiresAt,
      createdBy: userId
    });
  }

  if (isLpWebhookEnabled()) {
    void emitLpWebhook("LP_INVITATION_SENT", {
      invitationId: invitation.id,
      dealId,
      dealName,
      lpEntityName: invitation.lpEntityName,
      lpEmail: invitation.lpEmail,
      commitment: invitation.commitment,
      ownershipPct: invitation.ownershipPct,
      status: invitation.status,
      expiresAt: invitation.expiresAt.toISOString(),
      createdBy: userId
    });
  }

  console.log(`[LP Onboarding] Invitation sent to ${parsed.data.lpEmail} for deal ${dealId}`);

  // Invalidate LP portal cache
  deleteCacheByPrefix("lp-portal:");
  deleteCache(`deal-home:${dealId}`);

  sendJson(res, 201, lpInvitationSchema.parse({
    id: invitation.id,
    dealId: invitation.dealId,
    lpEntityName: invitation.lpEntityName,
    lpEmail: invitation.lpEmail,
    status: invitation.status,
    commitment: invitation.commitment,
    ownershipPct: invitation.ownershipPct,
    createdAt: invitation.createdAt.toISOString(),
    acceptedAt: invitation.acceptedAt?.toISOString() ?? null,
    expiresAt: invitation.expiresAt.toISOString()
  }));
}

/**
 * Accept LP invitation
 * POST /api/lp/invitations/:invitationId/accept
 * Body: { acceptanceToken }
 */
export async function handleAcceptInvitation(req, res, invitationId, readJsonBody, kernelBaseUrl) {
  log(`Accepting invitation`, { invitationId });

  const body = await readJsonBody(req);
  const prisma = getPrisma();

  // Find invitation (including shareClass)
  const invitation = await prisma.lPInvitation.findUnique({
    where: { id: invitationId },
    include: { shareClass: true }
  });

  if (!invitation) {
    log(`Invitation not found`, { invitationId });
    return sendError(res, 404, "Invitation not found");
  }

  log(`Invitation found`, {
    invitationId,
    dealId: invitation.dealId,
    lpEmail: invitation.lpEmail,
    shareClassId: invitation.shareClassId || 'none'
  });

  if (invitation.status !== "PENDING") {
    logWarn(`Invitation already processed`, { invitationId, status: invitation.status });
    return sendError(res, 409, "Invitation already processed", {
      currentStatus: invitation.status
    });
  }

  if (new Date() > invitation.expiresAt) {
    logWarn(`Invitation expired`, { invitationId, expiresAt: invitation.expiresAt });
    return sendError(res, 410, "Invitation expired");
  }

  // Get deal's organizationId for org isolation
  const store = await readStore();
  const dealRecord = store.dealIndex.find((r) => r.id === invitation.dealId);
  const organizationId = dealRecord?.organizationId || null;

  // Determine shareClassId - use invitation's class or get/create default Class A
  let shareClassId = invitation.shareClassId;
  if (!shareClassId) {
    log(`Looking up/creating default share class`, { dealId: invitation.dealId });
    const defaultClass = await getOrCreateDefaultShareClass(
      invitation.dealId,
      organizationId,
      null,
      'System'
    );
    shareClassId = defaultClass.id;
    log(`Using default share class`, { dealId: invitation.dealId, shareClassId, code: defaultClass.code });
  } else {
    log(`Using invitation share class`, { shareClassId, code: invitation.shareClass?.code });
  }

  // Create LP actor in kernel deal
  log(`Creating LP actor in Kernel`, { dealId: invitation.dealId, lpEntityName: invitation.lpEntityName });
  const actor = await kernelFetchJson(`${kernelBaseUrl}/deals/${invitation.dealId}/actors`, {
    method: "POST",
    body: JSON.stringify({
      name: invitation.lpEntityName,
      type: "HUMAN",
      roles: ["LP"]
    })
  }).catch((error) => {
    logError(`Kernel actor creation failed`, error, { dealId: invitation.dealId });
    throw error;
  });
  log(`Kernel actor created`, { actorId: actor.id });

  // Update invitation status
  const updated = await prisma.lPInvitation.update({
    where: { id: invitationId },
    data: {
      status: "ACCEPTED",
      acceptedAt: new Date(),
      actorId: actor.id
    }
  });
  log(`Invitation status updated`, { invitationId, status: updated.status });

  // Check if LP already exists in this class
  log(`Checking for existing LPActor`, { email: invitation.lpEmail, dealId: invitation.dealId, shareClassId });
  const existingLp = await prisma.lPActor.findFirst({
    where: {
      email: invitation.lpEmail,
      dealId: invitation.dealId,
      shareClassId
    }
  });

  let lpActor;
  if (existingLp) {
    // Update existing LP
    logWarn(`LP already in this class - updating`, { existingLpActorId: existingLp.id });
    lpActor = await prisma.lPActor.update({
      where: { id: existingLp.id },
      data: {
        actorId: actor.id,
        status: "ACTIVE",
        organizationId
      }
    });
    log(`LPActor updated`, { lpActorId: lpActor.id });
  } else {
    // Create new LP actor
    log(`Creating/updating LPActor`, {
      dealId: invitation.dealId,
      email: invitation.lpEmail,
      shareClassId,
      commitment: invitation.commitment
    });
    lpActor = await prisma.lPActor.create({
      data: {
        email: invitation.lpEmail,
        dealId: invitation.dealId,
        actorId: actor.id,
        entityName: invitation.lpEntityName,
        commitment: invitation.commitment,
        ownershipPct: invitation.ownershipPct,
        status: "ACTIVE",
        organizationId,
        shareClassId  // NEW: Propagate share class from invitation
      }
    });
    log(`LPActor created`, { lpActorId: lpActor.id, shareClassId });
  }

  logDebug(`LPActor state`, { lpActor: JSON.stringify(lpActor) });

  // Invalidate caches
  deleteCacheByPrefix("lp-portal:");
  deleteCache(`deal-home:${invitation.dealId}`);

  sendJson(res, 200, lpInvitationSchema.parse({
    id: updated.id,
    dealId: updated.dealId,
    lpEntityName: updated.lpEntityName,
    lpEmail: updated.lpEmail,
    status: updated.status,
    commitment: updated.commitment,
    ownershipPct: updated.ownershipPct,
    createdAt: updated.createdAt.toISOString(),
    acceptedAt: updated.acceptedAt?.toISOString() ?? null,
    expiresAt: updated.expiresAt.toISOString()
  }));
  if (isLpWebhookEnabled()) {
    void emitLpWebhook("LP_INVITATION_ACCEPTED", {
      invitationId,
      dealId: updated.dealId,
      lpEmail: updated.lpEmail,
      lpEntityName: updated.lpEntityName,
      actorId: updated.actorId,
      commitment: updated.commitment,
      ownershipPct: updated.ownershipPct,
      status: updated.status,
      acceptedAt: updated.acceptedAt?.toISOString() ?? null
    });
  }
}

/**
 * List LP invitations for a deal
 * GET /api/lp/deals/:dealId/invitations
 */
export async function handleListInvitations(req, res, dealId, kernelBaseUrl) {
  const prisma = getPrisma();

  // Verify deal exists
  try {
    await kernelFetchJson(`${kernelBaseUrl}/deals/${dealId}`);
  } catch (error) {
    if (error?.status === 404) {
      return sendError(res, 404, "Deal not found");
    }
    return sendKernelUnavailable(res, error);
  }

  const invitations = await prisma.lPInvitation.findMany({
    where: { dealId },
    orderBy: { createdAt: "desc" }
  });

  const response = invitations.map((inv) => ({
    id: inv.id,
    dealId: inv.dealId,
    lpEntityName: inv.lpEntityName,
    lpEmail: inv.lpEmail,
    status: inv.status,
    commitment: inv.commitment,
    ownershipPct: inv.ownershipPct,
    createdAt: inv.createdAt.toISOString(),
    acceptedAt: inv.acceptedAt?.toISOString() ?? null,
    expiresAt: inv.expiresAt.toISOString()
  }));

  sendJson(res, 200, { items: response });
}

/**
 * LP Portal: Get landing screen
 * GET /api/lp/portal
 * Shows portfolio summary and active investments (read-only)
 * @param {string} lpEmail - Validated LP email from requireLPEntitlement (NOT from raw headers)
 */
export async function handleLPPortalLanding(req, res, kernelBaseUrl, lpEmail) {
  // SECURITY: lpEmail is pre-validated by requireLPEntitlement in dispatch
  // Do NOT use resolveUserId(req) or raw headers here
  const cacheKey = `lp-portal:landing:${lpEmail}`;
  const cached = getCache(cacheKey);
  if (cached) {
    return sendJson(res, 200, lpPortalLandingSchema.parse(cached));
  }

  const prisma = getPrisma();

  // Get LP deals for this user
  const lpActors = await prisma.lPActor.findMany({
    where: {
      email: lpEmail,
      status: "ACTIVE"
    }
  });

  if (lpActors.length === 0) {
    return sendJson(res, 200, lpPortalLandingSchema.parse({
      summary: {
        active_investments: 0,
        capital_committed: 0,
        capital_deployed: 0,
        distributions_ytd: 0
      },
      investments: []
    }));
  }

  const store = await readStore();
  const dealIds = lpActors.map((la) => la.dealId);
  const dealRecords = store.dealIndex.filter((r) => dealIds.includes(r.id));

  // Fetch deal data in parallel
  const results = await mapWithLimit(dealRecords, 4, async (record) => {
    const [kernelDeal, snapshot] = await Promise.all([
      kernelFetchJson(`${kernelBaseUrl}/deals/${record.id}`),
      kernelFetchJson(`${kernelBaseUrl}/deals/${record.id}/snapshot`)
    ]);

    const lpActor = lpActors.find((la) => la.dealId === record.id);
    const canonical = buildCanonicalDeal(
      { profile: {}, profile_meta: {} },
      kernelDeal,
      snapshot
    );

    return {
      id: canonical.id,
      name: canonical.name,
      asset_type: canonical.profile?.asset_type ?? "Unknown",
      status: canonical.lifecycle_state ?? "Operating",
      last_update: canonical.updated_date ?? new Date().toISOString(),
      key_notes: canonical.next_action ?? null,
      commitment: lpActor?.commitment ?? 0,
      deployed: snapshot?.totalDeployed ?? 0
    };
  });

  const kernelDown = results.find((result) => {
    if (result.status !== "rejected") {
      return false;
    }
    return (
      result.reason?.type === "KERNEL_UNAVAILABLE" ||
      (typeof result.reason?.status === "number" && result.reason.status >= 500)
    );
  });

  if (kernelDown) {
    return sendKernelUnavailable(res, kernelDown.reason);
  }

  const investments = results
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value);

  // Calculate summary
  const summary = {
    active_investments: investments.length,
    capital_committed: investments.reduce((sum, inv) => sum + (inv.commitment || 0), 0),
    capital_deployed: investments.reduce((sum, inv) => sum + (inv.deployed || 0), 0),
    distributions_ytd: 0 // TODO: Aggregate from deal events
  };

  const response = {
    summary,
    investments: investments.map((inv) => ({
      id: inv.id,
      name: inv.name,
      asset_type: inv.asset_type,
      status: inv.status,
      last_update: inv.last_update,
      key_notes: inv.key_notes
    }))
  };

  setCache(cacheKey, response, LP_PORTAL_CACHE_TTL);
  sendJson(res, 200, lpPortalLandingSchema.parse(response));
}

/**
 * LP Portal: Get investment detail
 * GET /api/lp/portal/deals/:dealId
 * Shows investment detail with capital events, compliance, performance
 * @param {string} lpEmail - Validated LP email from requireLPEntitlement (NOT from raw headers)
 */
export async function handleLPPortalDealDetail(req, res, dealId, kernelBaseUrl, lpEmail) {
  // SECURITY: lpEmail is pre-validated by requireLPEntitlement in dispatch
  // Deal access already verified by requireLPEntitlement(req, res, dealId, token)
  const cacheKey = `lp-portal:detail:${dealId}:${lpEmail}`;
  const cached = getCache(cacheKey);
  if (cached) {
    return sendJson(res, 200, lpInvestmentDetailSchema.parse(cached));
  }

  const prisma = getPrisma();

  // Get LP actor for this deal with share class (entitlement already verified by dispatch)
  const lpActor = await prisma.lPActor.findFirst({
    where: {
      email: lpEmail,
      dealId
    },
    include: {
      shareClass: {
        select: {
          id: true,
          code: true,
          name: true,
          preferredReturn: true,
          managementFee: true,
          carryPercent: true
        }
      }
    }
  });

  if (!lpActor) {
    // This shouldn't happen if requireLPEntitlement passed, but defensive check
    return sendError(res, 403, "LP does not have access to this deal");
  }

  log(`Fetching LP portal deal detail`, {
    dealId,
    lpActorId: lpActor.id,
    shareClass: lpActor.shareClass?.code || 'NONE'
  });

  const store = await readStore();
  const record = store.dealIndex.find((r) => r.id === dealId);
  if (!record) {
    return sendError(res, 404, "Deal not found");
  }

  // Fetch deal data
  const [kernelDeal, snapshot, events, materials] = await Promise.all([
    kernelFetchJson(`${kernelBaseUrl}/deals/${dealId}`),
    kernelFetchJson(`${kernelBaseUrl}/deals/${dealId}/snapshot`),
    kernelFetchJson(`${kernelBaseUrl}/deals/${dealId}/events`),
    kernelFetchJson(`${kernelBaseUrl}/deals/${dealId}/materials`)
  ]).catch((error) => {
    throw error;
  });

  const canonical = buildCanonicalDeal(
    { profile: {}, profile_meta: {} },
    kernelDeal,
    snapshot
  );

  // Build capital events from kernel events
  const capitalEvents = (events ?? [])
    .filter((e) => ["DistributionProcessed", "CapitalCalled", "ReturnProcessed"].includes(e.type))
    .map((e) => ({
      id: e.id,
      type: e.type === "DistributionProcessed" ? "DISTRIBUTION" : e.type === "CapitalCalled" ? "CALL" : "RETURN",
      amount: e.payload?.amount ?? 0,
      date: e.createdAt,
      description: e.payload?.description ?? null,
      timestamp: e.createdAt
    }));

  // Build compliance status
  const compliance = {
    status: snapshot?.materials?.covenantStatus === "AT_RISK" ? "AT_RISK" : "COMPLIANT",
    amended_covenants: snapshot?.materials?.amendedCount ?? 0,
    details: snapshot?.materials?.complianceNotes ?? null
  };

  // Build performance snapshot
  const performance = {
    cash_in: snapshot?.totalCalled ?? 0,
    cash_out: snapshot?.totalDistributed ?? 0,
    net_invested: (snapshot?.totalCalled ?? 0) - (snapshot?.totalDistributed ?? 0),
    distributions_to_date: snapshot?.totalDistributed ?? 0,
    period: "YTD"
  };

  const detail = {
    id: dealId,
    name: canonical.name,
    asset_type: canonical.profile?.asset_type ?? "Unknown",
    status: canonical.lifecycle_state ?? "Operating",
    last_update: canonical.updated_date ?? new Date().toISOString(),
    key_notes: canonical.next_action ?? null,
    ownership: {
      entity: lpActor.entityName,
      commitment: lpActor.commitment,
      ownership_pct: lpActor.ownershipPct,
      effective_date: lpActor.createdAt?.toISOString() ?? null,
      end_date: null,
      shareClass: lpActor.shareClass ? {
        id: lpActor.shareClass.id,
        code: lpActor.shareClass.code,
        name: lpActor.shareClass.name,
        preferredReturn: lpActor.shareClass.preferredReturn,
        managementFee: lpActor.shareClass.managementFee,
        carryPercent: lpActor.shareClass.carryPercent
      } : null
    },
    capital_events: capitalEvents,
    compliance,
    performance,
    documents: (materials ?? [])
      .filter((m) => m.type === "OfferingDoc" || m.type === "Amendment" || m.type === "Report")
      .map((m) => ({
        id: m.id,
        name: m.data?.filename ?? m.type,
        type: m.type,
        added_date: m.createdAt ?? new Date().toISOString(),
        supersedes: m.data?.supersedes ?? null
      }))
  };

  setCache(cacheKey, detail, LP_PORTAL_CACHE_TTL);
  sendJson(res, 200, lpInvestmentDetailSchema.parse(detail));
}

/**
 * LP Portal: Download report
 * GET /api/lp/portal/deals/:dealId/report
 * Exports investment statements and event summaries
 * @param {string} lpEmail - Validated LP email from requireLPEntitlement (NOT from raw headers)
 */
export async function handleLPPortalExport(req, res, dealId, kernelBaseUrl, lpEmail) {
  // SECURITY: lpEmail is pre-validated by requireLPEntitlement in dispatch
  // Deal access already verified by requireLPEntitlement(req, res, dealId, token)
  const prisma = getPrisma();

  // Get LP actor for this deal (entitlement already verified by dispatch)
  const lpActor = await prisma.lPActor.findUnique({
    where: {
      email_dealId: {
        email: lpEmail,
        dealId
      }
    }
  });

  if (!lpActor) {
    // This shouldn't happen if requireLPEntitlement passed, but defensive check
    return sendError(res, 403, "LP does not have access to this deal");
  }

  // Fetch deal detail
  const [kernelDeal, events] = await Promise.all([
    kernelFetchJson(`${kernelBaseUrl}/deals/${dealId}`),
    kernelFetchJson(`${kernelBaseUrl}/deals/${dealId}/events`)
  ]);

  // Generate export payload
  const exportData = {
    generatedAt: new Date().toISOString(),
    dealName: kernelDeal.name,
    lpEntity: lpActor.entityName,
    ownership: {
      commitment: lpActor.commitment,
      ownershipPct: lpActor.ownershipPct
    },
    capitalStatement: {
      commitment: lpActor.commitment,
      called: events
        .filter((e) => e.type === "CapitalCalled")
        .reduce((sum, e) => sum + (e.payload?.amount ?? 0), 0),
      distributed: events
        .filter((e) => e.type === "DistributionProcessed")
        .reduce((sum, e) => sum + (e.payload?.amount ?? 0), 0)
    },
    disclaimers: [
      "Generated on [TIMESTAMP]. Reflects verified data as of [TIMESTAMP].",
      "This statement contains confidential information.",
      "LP Portal data is read-only and reflects current verified state."
    ]
  };

  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": `attachment; filename="lp-statement-${dealId}-${new Date().toISOString().split("T")[0]}.json"`,
    "Access-Control-Allow-Origin": "*"
  });
  res.end(JSON.stringify(exportData, null, 2));
}

/**
 * List LP actor history / status
 * GET /api/lp/actors/:dealId
 */
export async function handleListLPActors(req, res, dealId, kernelBaseUrl) {
  const prisma = getPrisma();

  // Verify deal exists
  try {
    await kernelFetchJson(`${kernelBaseUrl}/deals/${dealId}`);
  } catch (error) {
    if (error?.status === 404) {
      return sendError(res, 404, "Deal not found");
    }
    return sendKernelUnavailable(res, error);
  }

  const lpActors = await prisma.lPActor.findMany({
    where: { dealId, status: "ACTIVE" }
  });

  const response = lpActors.map((la) => ({
    id: la.id,
    dealId: la.dealId,
    entityName: la.entityName,
    email: la.email,
    actorId: la.actorId,
    commitment: la.commitment,
    ownershipPct: la.ownershipPct,
    status: la.status,
    createdAt: la.createdAt?.toISOString() ?? null
  }));

  sendJson(res, 200, { items: response });
}

/**
 * Bulk import LP invitations from CSV
 * POST /api/lp/bulk-import
 * Body: { dealId, investors: [{ lpEntityName, lpEmail, commitment, ownershipPct }, ...] }
 */
export async function handleBulkLPImport(req, res, readJsonBody, kernelBaseUrl, resolveUserId) {
  const body = await readJsonBody(req);
  
  if (!body?.dealId || typeof body.dealId !== "string") {
    return sendError(res, 400, "dealId is required");
  }

  if (!Array.isArray(body.investors) || body.investors.length === 0) {
    return sendError(res, 400, "investors array required (minimum 1)");
  }

  if (body.investors.length > 1000) {
    return sendError(res, 400, "Maximum 1000 investors per import");
  }

  const prisma = getPrisma();
  const dealId = body.dealId;
  const userId = resolveUserId(req);

  // Verify deal exists
  try {
    await kernelFetchJson(`${kernelBaseUrl}/deals/${dealId}`);
  } catch (error) {
    if (error?.status === 404) {
      return sendError(res, 404, "Deal not found");
    }
    return sendKernelUnavailable(res, error);
  }

  const results = {
    total: body.investors.length,
    succeeded: 0,
    failed: 0,
    errors: [],
    invitations: []
  };

  const store = await readStore();
  const dealRecord = store.dealIndex.find((r) => r.id === dealId);
  const dealName = dealRecord?.name ?? dealId;

  for (const [index, investor] of body.investors.entries()) {
    try {
      // Validate each investor
      if (!investor.lpEntityName || typeof investor.lpEntityName !== "string") {
        throw new Error("lpEntityName is required");
      }
      if (!investor.lpEmail || typeof investor.lpEmail !== "string") {
        throw new Error("lpEmail is required");
      }
      if (!Number.isFinite(investor.commitment) || investor.commitment <= 0) {
        throw new Error("commitment must be a positive number");
      }
      if (!Number.isFinite(investor.ownershipPct) || investor.ownershipPct <= 0 || investor.ownershipPct > 100) {
        throw new Error("ownershipPct must be between 0 and 100");
      }

      // Check for duplicate in this batch
      const isDuplicateInBatch = results.invitations.some(
        (inv) => inv.lpEmail === investor.lpEmail
      );
      if (isDuplicateInBatch) {
        throw new Error("Duplicate email in import batch");
      }

      // Check for existing invitation
      const existing = await prisma.lPInvitation.findUnique({
        where: {
          dealId_lpEmail: {
            dealId,
            lpEmail: investor.lpEmail
          }
        }
      });

      if (existing && existing.status === "ACCEPTED") {
        throw new Error("LP already accepted invitation for this deal");
      }

      // Create or update invitation
      const invitationId = crypto.randomUUID();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + LP_INVITATION_EXPIRY_DAYS);

      if (existing) {
        // Revoke old and create new
        await prisma.lPInvitation.update({
          where: { id: existing.id },
          data: { status: "REVOKED" }
        });
      }

      const invitation = await prisma.lPInvitation.create({
        data: {
          id: invitationId,
          dealId,
          lpEntityName: investor.lpEntityName,
          lpEmail: investor.lpEmail,
          commitment: investor.commitment,
          ownershipPct: investor.ownershipPct,
          status: "PENDING",
          createdByUserId: userId,
          expiresAt,
          createdAt: new Date()
        }
      });

      results.invitations.push({
        id: invitation.id,
        lpEmail: investor.lpEmail,
        status: "created"
      });

      // Send email notification asynchronously
      if (isLpEmailEnabled()) {
        void sendLpInvitationEmail({
          lpEmail: investor.lpEmail,
          lpEntityName: investor.lpEntityName,
          invitationId: invitation.id,
          dealId,
          dealName,
          commitment: investor.commitment,
          ownershipPct: investor.ownershipPct,
          expiresAt: invitation.expiresAt,
          createdBy: userId
        });
      }

      // Emit webhook
      if (isLpWebhookEnabled()) {
        void emitLpWebhook("LP_BULK_IMPORT_ITEM", {
          dealId,
          invitationId: invitation.id,
          lpEmail: investor.lpEmail,
          lpEntityName: investor.lpEntityName,
          batchIndex: index
        });
      }

      results.succeeded += 1;
    } catch (error) {
      results.failed += 1;
      results.errors.push({
        index,
        email: investor.lpEmail,
        error: error?.message ?? "Unknown error"
      });
    }
  }

  // Invalidate caches
  deleteCacheByPrefix("lp-portal:");
  deleteCache(`deal-home:${dealId}`);

  // Log bulk import
  console.log(
    `[LP Onboarding] Bulk import completed: ${results.succeeded}/${results.total} succeeded`
  );

  // Emit summary webhook
  if (isLpWebhookEnabled()) {
    void emitLpWebhook("LP_BULK_IMPORT_COMPLETED", {
      dealId,
      total: results.total,
      succeeded: results.succeeded,
      failed: results.failed,
      createdBy: userId
    });
  }

  sendJson(res, 207, results);
}

/**
 * Generate custom LP report with filters
 * POST /api/lp/reports/generate
 * Body: { dealId, reportType, filters: { startDate, endDate, lpEmails } }
 */
export async function handleGenerateCustomReport(req, res, readJsonBody, kernelBaseUrl, resolveUserId) {
  const body = await readJsonBody(req);

  if (!body?.dealId || typeof body.dealId !== "string") {
    return sendError(res, 400, "dealId is required");
  }

  const dealId = body.dealId;
  const reportType = body.reportType ?? "capital_statement";
  const filters = body.filters ?? {};

  // Verify deal exists
  try {
    await kernelFetchJson(`${kernelBaseUrl}/deals/${dealId}`);
  } catch (error) {
    if (error?.status === 404) {
      return sendError(res, 404, "Deal not found");
    }
    return sendKernelUnavailable(res, error);
  }

  const prisma = getPrisma();
  const store = await readStore();
  const dealRecord = store.dealIndex.find((r) => r.id === dealId);
  const dealName = dealRecord?.name ?? dealId;

  // Get LP actors, optionally filtered by email
  const lpActors = await prisma.lPActor.findMany({
    where: {
      dealId,
      status: "ACTIVE",
      ...(Array.isArray(filters.lpEmails) && filters.lpEmails.length > 0
        ? { email: { in: filters.lpEmails } }
        : {})
    }
  });

  if (lpActors.length === 0) {
    return sendError(res, 404, "No LP actors found matching filters");
  }

  // Fetch deal data
  const [kernelDeal, events] = await Promise.all([
    kernelFetchJson(`${kernelBaseUrl}/deals/${dealId}`),
    kernelFetchJson(`${kernelBaseUrl}/deals/${dealId}/events`)
  ]);

  // Parse date filters
  const startDate = filters.startDate ? new Date(filters.startDate) : new Date("1900-01-01");
  const endDate = filters.endDate ? new Date(filters.endDate) : new Date();

  // Build report based on type
  let report = null;

  if (reportType === "capital_statement") {
    report = buildCapitalStatementReport(
      dealName,
      dealId,
      lpActors,
      events,
      startDate,
      endDate
    );
  } else if (reportType === "distribution_summary") {
    report = buildDistributionSummaryReport(
      dealName,
      dealId,
      lpActors,
      events,
      startDate,
      endDate
    );
  } else if (reportType === "irr_performance") {
    report = buildIRRPerformanceReport(dealName, dealId, lpActors, events);
  } else {
    return sendError(res, 400, "Invalid reportType");
  }

  // Return report
  const filename = `lp-report-${dealId}-${reportType}-${new Date().toISOString().split("T")[0]}.json`;
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Access-Control-Allow-Origin": "*"
  });
  res.end(JSON.stringify(report, null, 2));
}

function buildCapitalStatementReport(dealName, dealId, lpActors, events, startDate, endDate) {
  const statements = lpActors.map((lp) => {
    const capitalCalls = events
      .filter(
        (e) =>
          e.type === "CapitalCalled" &&
          new Date(e.createdAt) >= startDate &&
          new Date(e.createdAt) <= endDate
      )
      .reduce((sum, e) => sum + (e.payload?.amount ?? 0), 0);

    const distributions = events
      .filter(
        (e) =>
          e.type === "DistributionProcessed" &&
          new Date(e.createdAt) >= startDate &&
          new Date(e.createdAt) <= endDate
      )
      .reduce((sum, e) => sum + (e.payload?.amount ?? 0), 0);

    return {
      lpEmail: lp.email,
      lpEntity: lp.entityName,
      commitment: lp.commitment,
      ownershipPct: lp.ownershipPct,
      capitalCalled,
      distributions,
      netCashFlow: distributions - capitalCalls,
      period: { startDate: startDate.toISOString(), endDate: endDate.toISOString() }
    };
  });

  return {
    reportType: "capital_statement",
    dealName,
    dealId,
    generatedAt: new Date().toISOString(),
    period: { startDate: startDate.toISOString(), endDate: endDate.toISOString() },
    lpCount: lpActors.length,
    statements,
    totals: {
      totalCommitment: lpActors.reduce((sum, lp) => sum + lp.commitment, 0),
      totalCapitalCalled: statements.reduce((sum, s) => sum + s.capitalCalled, 0),
      totalDistributions: statements.reduce((sum, s) => sum + s.distributions, 0)
    },
    disclaimer: "This report is confidential and contains proprietary information."
  };
}

function buildDistributionSummaryReport(dealName, dealId, lpActors, events, startDate, endDate) {
  const distributions = events
    .filter(
      (e) =>
        e.type === "DistributionProcessed" &&
        new Date(e.createdAt) >= startDate &&
        new Date(e.createdAt) <= endDate
    )
    .map((e) => ({
      date: e.createdAt,
      amount: e.payload?.amount ?? 0,
      description: e.payload?.description ?? "Distribution"
    }));

  const totalDistributed = distributions.reduce((sum, d) => sum + d.amount, 0);

  return {
    reportType: "distribution_summary",
    dealName,
    dealId,
    generatedAt: new Date().toISOString(),
    period: { startDate: startDate.toISOString(), endDate: endDate.toISOString() },
    distributions,
    totalDistributed,
    distributionCount: distributions.length,
    averageDistribution: distributions.length > 0 ? totalDistributed / distributions.length : 0,
    lpCount: lpActors.length
  };
}

function buildIRRPerformanceReport(dealName, dealId, lpActors, events) {
  // Simplified IRR calculation - real implementation would use financial library
  const capitalEvents = events
    .filter((e) => ["CapitalCalled", "DistributionProcessed", "ReturnProcessed"].includes(e.type))
    .map((e) => ({
      date: e.createdAt,
      type: e.type,
      amount: e.payload?.amount ?? 0
    }));

  return {
    reportType: "irr_performance",
    dealName,
    dealId,
    generatedAt: new Date().toISOString(),
    lpCount: lpActors.length,
    capitalEvents,
    note: "IRR calculations require specialized financial library. Consider integrating @financial-calculations/irr for production use.",
    estimatedIRR: "Pending financial library integration",
    disclaimer: "IRR performance is estimated and may not reflect actual returns."
  };
}
