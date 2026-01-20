/**
 * LP Portal Access Routes
 *
 * Handles magic link generation, session management, and account linking
 * for LP investors accessing the portal.
 */

import { getPrisma } from "../db.js";
import { deleteCache, deleteCacheByPrefix } from "../runtime.js";
import crypto from "node:crypto";
import { buildLPStatement, requireLPDealAccess } from "../services/lp-statement-service.js";

// ============================================================================
// LOGGING UTILITIES
// ============================================================================
const LOG_PREFIX = "[LP Portal Access]";

function log(message, data = {}) {
  const timestamp = new Date().toISOString();
  console.log(`${timestamp} ${LOG_PREFIX} ${message}`, JSON.stringify(data, null, 0));
}

function logDebug(message, data = {}) {
  if (process.env.DEBUG_LP_PORTAL === 'true') {
    const timestamp = new Date().toISOString();
    console.log(`${timestamp} ${LOG_PREFIX} DEBUG: ${message}`, JSON.stringify(data, null, 0));
  }
}

const LP_PORTAL_SESSION_EXPIRY_DAYS = 7;

/**
 * LP-visible deal fields - LPs only see this subset of deal data
 * All other deal fields (financials, internal metrics, etc.) are hidden
 */
const LP_VISIBLE_DEAL_FIELDS = {
  id: true,
  status: true,
  createdAt: true,
  updatedAt: true
  // Intentionally excludes: name, assetType, address, financials, metrics, etc.
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

/**
 * Generate a secure portal token
 */
function generatePortalToken() {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Generate magic link for LP portal access
 * POST /api/lp/portal/magic-link
 * Body: { lpActorId, dealId? }
 */
export async function handleGenerateMagicLink(req, res, readJsonBody, resolveUserId) {
  const body = await readJsonBody(req);

  if (!body?.lpActorId) {
    return sendError(res, 400, "lpActorId is required");
  }

  const prisma = getPrisma();
  const userId = resolveUserId(req);

  // Verify LP actor exists
  const lpActor = await prisma.lPActor.findUnique({
    where: { id: body.lpActorId }
  });

  if (!lpActor) {
    return sendError(res, 404, "LP not found");
  }

  if (lpActor.status !== "ACTIVE") {
    return sendError(res, 400, "LP is not active");
  }

  // Create portal session
  const token = generatePortalToken();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + LP_PORTAL_SESSION_EXPIRY_DAYS);

  const session = await prisma.lPPortalSession.create({
    data: {
      id: crypto.randomUUID(),
      lpActorId: body.lpActorId,
      token,
      expiresAt,
      createdAt: new Date()
    }
  });

  // Build magic link URL
  const baseUrl = process.env.BFF_PUBLIC_URL || "http://localhost:8787";
  const magicLink = `${baseUrl}/lp-portal?token=${token}`;

  console.log(`[LP Portal Access] Generated magic link for ${lpActor.entityName} (${lpActor.email})`);

  sendJson(res, 201, {
    magicLink,
    token: session.token,
    expiresAt: session.expiresAt.toISOString(),
    lpActor: {
      id: lpActor.id,
      entityName: lpActor.entityName,
      email: lpActor.email
    }
  });
}

/**
 * Validate portal session and get LP context
 * GET /api/lp/portal/session/:token
 */
export async function handleValidateSession(req, res, token) {
  const prisma = getPrisma();

  const session = await prisma.lPPortalSession.findUnique({
    where: { token }
  });

  if (!session) {
    return sendError(res, 401, "Invalid session token");
  }

  if (new Date() > session.expiresAt) {
    return sendError(res, 401, "Session expired");
  }

  // Get LP actor
  const lpActor = await prisma.lPActor.findUnique({
    where: { id: session.lpActorId }
  });

  if (!lpActor || lpActor.status !== "ACTIVE") {
    return sendError(res, 403, "LP is not active");
  }

  // Update last used timestamp
  await prisma.lPPortalSession.update({
    where: { id: session.id },
    data: { lastUsedAt: new Date() }
  });

  // Get all LP actors for this email (investments across deals) with share class
  const allLpActors = await prisma.lPActor.findMany({
    where: {
      email: lpActor.email,
      status: "ACTIVE"
    },
    include: {
      shareClass: {
        select: {
          id: true,
          code: true,
          name: true,
          preferredReturn: true,
          managementFee: true
        }
      }
    }
  });

  log(`Session validated`, {
    lpActorId: lpActor.id,
    email: lpActor.email,
    investmentCount: allLpActors.length,
    hasShareClassData: allLpActors.some(la => la.shareClass)
  });

  logDebug(`Investments with share classes`, {
    investments: allLpActors.map(la => ({
      dealId: la.dealId,
      shareClass: la.shareClass?.code || 'NONE'
    }))
  });

  sendJson(res, 200, {
    valid: true,
    session: {
      id: session.id,
      expiresAt: session.expiresAt.toISOString(),
      lastUsedAt: session.lastUsedAt?.toISOString() ?? null
    },
    lpActor: {
      id: lpActor.id,
      email: lpActor.email,
      entityName: lpActor.entityName,
      dealId: lpActor.dealId
    },
    investments: allLpActors.map((la) => ({
      id: la.id,
      dealId: la.dealId,
      entityName: la.entityName,
      commitment: la.commitment,
      ownershipPct: la.ownershipPct,
      shareClass: la.shareClass ? {
        id: la.shareClass.id,
        code: la.shareClass.code,
        name: la.shareClass.name,
        preferredReturn: la.shareClass.preferredReturn,
        managementFee: la.shareClass.managementFee
      } : null
    })),
    hasAccount: !!lpActor.authUserId
  });
}

/**
 * Refresh portal session
 * POST /api/lp/portal/session/:token/refresh
 */
export async function handleRefreshSession(req, res, token) {
  const prisma = getPrisma();

  const session = await prisma.lPPortalSession.findUnique({
    where: { token }
  });

  if (!session) {
    return sendError(res, 401, "Invalid session token");
  }

  // Generate new expiry
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + LP_PORTAL_SESSION_EXPIRY_DAYS);

  // Generate new token
  const newToken = generatePortalToken();

  // Update session
  const updated = await prisma.lPPortalSession.update({
    where: { id: session.id },
    data: {
      token: newToken,
      expiresAt,
      lastUsedAt: new Date()
    }
  });

  sendJson(res, 200, {
    token: updated.token,
    expiresAt: updated.expiresAt.toISOString()
  });
}

/**
 * Revoke portal session (logout)
 * DELETE /api/lp/portal/session/:token
 */
export async function handleRevokeSession(req, res, token) {
  const prisma = getPrisma();

  const session = await prisma.lPPortalSession.findUnique({
    where: { token }
  });

  if (!session) {
    return sendError(res, 404, "Session not found");
  }

  // Delete session
  await prisma.lPPortalSession.delete({
    where: { id: session.id }
  });

  // Invalidate caches
  deleteCacheByPrefix(`lp-portal:${session.lpActorId}`);

  sendJson(res, 200, { message: "Session revoked" });
}

/**
 * Link portal access to auth account
 * POST /api/lp/portal/link-account
 * Body: { token, authUserId }
 */
export async function handleLinkAccount(req, res, readJsonBody) {
  const body = await readJsonBody(req);

  if (!body?.token || !body?.authUserId) {
    return sendError(res, 400, "token and authUserId are required");
  }

  const prisma = getPrisma();

  // Validate session
  const session = await prisma.lPPortalSession.findUnique({
    where: { token: body.token }
  });

  if (!session || new Date() > session.expiresAt) {
    return sendError(res, 401, "Invalid or expired session");
  }

  // Verify auth user exists
  const authUser = await prisma.authUser.findUnique({
    where: { id: body.authUserId }
  });

  if (!authUser) {
    return sendError(res, 404, "Auth user not found");
  }

  // Get LP actor
  const lpActor = await prisma.lPActor.findUnique({
    where: { id: session.lpActorId }
  });

  if (!lpActor) {
    return sendError(res, 404, "LP not found");
  }

  // Verify email matches
  if (lpActor.email.toLowerCase() !== authUser.email.toLowerCase()) {
    return sendError(res, 400, "Email mismatch between LP and auth account");
  }

  // Link all LP actors with this email to the auth user
  await prisma.lPActor.updateMany({
    where: { email: lpActor.email },
    data: { authUserId: body.authUserId }
  });

  console.log(`[LP Portal Access] Linked ${lpActor.email} to auth account ${authUser.id}`);

  sendJson(res, 200, {
    message: "Account linked successfully",
    lpEmail: lpActor.email,
    authUserId: authUser.id,
    linkedCount: await prisma.lPActor.count({ where: { authUserId: body.authUserId } })
  });
}

/**
 * Get notification preferences
 * GET /api/lp/preferences
 * Query: ?lpActorId=
 * SECURITY: V8 fix - authUser passed from dispatch, verify ownership
 */
export async function handleGetPreferences(req, res, lpActorId, authUser) {
  if (!lpActorId) {
    return sendError(res, 400, "lpActorId is required");
  }

  const prisma = getPrisma();

  // SECURITY: V8 - Verify authUser owns this lpActorId
  const lpActor = await prisma.lPActor.findUnique({
    where: { id: lpActorId }
  });

  if (!lpActor) {
    return sendError(res, 404, "LP not found");
  }

  // Allow access if: user owns this lpActor (by authUserId or email), OR user is GP/Admin
  const isOwner = lpActor.authUserId === authUser.id || lpActor.email?.toLowerCase() === authUser.email?.toLowerCase();
  const isGPAdmin = ['GP', 'Admin'].includes(authUser.role);

  if (!isOwner && !isGPAdmin) {
    return sendError(res, 403, "Access denied - not your LP actor");
  }

  let preferences = await prisma.lPNotificationPreference.findUnique({
    where: { lpActorId }
  });

  // Return defaults if no preferences set
  if (!preferences) {
    preferences = {
      lpActorId,
      emailEnabled: true,
      emailDigestFrequency: "IMMEDIATE",
      documentNotifications: true,
      capitalCallNotifications: true,
      distributionNotifications: true,
      milestoneNotifications: true
    };
  }

  sendJson(res, 200, {
    lpActorId: preferences.lpActorId,
    emailEnabled: preferences.emailEnabled,
    emailDigestFrequency: preferences.emailDigestFrequency,
    documentNotifications: preferences.documentNotifications,
    capitalCallNotifications: preferences.capitalCallNotifications,
    distributionNotifications: preferences.distributionNotifications,
    milestoneNotifications: preferences.milestoneNotifications
  });
}

/**
 * Update notification preferences
 * PUT /api/lp/preferences
 * Body: { lpActorId, emailEnabled?, emailDigestFrequency?, ... }
 * SECURITY: V8 fix - authUser passed from dispatch, verify ownership
 */
export async function handleUpdatePreferences(req, res, readJsonBody, authUser) {
  const body = await readJsonBody(req);

  if (!body?.lpActorId) {
    return sendError(res, 400, "lpActorId is required");
  }

  const prisma = getPrisma();

  // Verify LP exists
  const lpActor = await prisma.lPActor.findUnique({
    where: { id: body.lpActorId }
  });

  if (!lpActor) {
    return sendError(res, 404, "LP not found");
  }

  // SECURITY: V8 - Verify authUser owns this lpActorId
  const isOwner = lpActor.authUserId === authUser.id || lpActor.email?.toLowerCase() === authUser.email?.toLowerCase();
  const isGPAdmin = ['GP', 'Admin'].includes(authUser.role);

  if (!isOwner && !isGPAdmin) {
    return sendError(res, 403, "Access denied - not your LP actor");
  }

  // Validate digest frequency
  const validFrequencies = ["IMMEDIATE", "DAILY", "WEEKLY"];
  if (body.emailDigestFrequency && !validFrequencies.includes(body.emailDigestFrequency)) {
    return sendError(res, 400, "Invalid emailDigestFrequency", { validValues: validFrequencies });
  }

  // Upsert preferences
  const preferences = await prisma.lPNotificationPreference.upsert({
    where: { lpActorId: body.lpActorId },
    update: {
      emailEnabled: body.emailEnabled ?? undefined,
      emailDigestFrequency: body.emailDigestFrequency ?? undefined,
      documentNotifications: body.documentNotifications ?? undefined,
      capitalCallNotifications: body.capitalCallNotifications ?? undefined,
      distributionNotifications: body.distributionNotifications ?? undefined,
      milestoneNotifications: body.milestoneNotifications ?? undefined
    },
    create: {
      id: crypto.randomUUID(),
      lpActorId: body.lpActorId,
      emailEnabled: body.emailEnabled ?? true,
      emailDigestFrequency: body.emailDigestFrequency ?? "IMMEDIATE",
      documentNotifications: body.documentNotifications ?? true,
      capitalCallNotifications: body.capitalCallNotifications ?? true,
      distributionNotifications: body.distributionNotifications ?? true,
      milestoneNotifications: body.milestoneNotifications ?? true
    }
  });

  console.log(`[LP Portal Access] Updated preferences for ${lpActor.entityName}`);

  sendJson(res, 200, {
    lpActorId: preferences.lpActorId,
    emailEnabled: preferences.emailEnabled,
    emailDigestFrequency: preferences.emailDigestFrequency,
    documentNotifications: preferences.documentNotifications,
    capitalCallNotifications: preferences.capitalCallNotifications,
    distributionNotifications: preferences.distributionNotifications,
    milestoneNotifications: preferences.milestoneNotifications,
    updatedAt: preferences.updatedAt.toISOString()
  });
}

/**
 * Get investments for authenticated LP user
 * GET /api/lp/portal/my-investments
 * Requires Authorization header with Bearer token
 */
export async function handleGetMyInvestments(req, res, authUser) {
  if (!authUser) {
    return sendError(res, 401, "Authentication required");
  }

  if (authUser.role !== "LP") {
    return sendError(res, 403, "Only LP users can access this endpoint");
  }

  const prisma = getPrisma();

  // Find all LP actors linked to this auth user's email with share class
  const lpActors = await prisma.lPActor.findMany({
    where: {
      OR: [
        { authUserId: authUser.id },
        { email: authUser.email.toLowerCase() }
      ],
      status: "ACTIVE"
    },
    include: {
      shareClass: {
        select: {
          id: true,
          code: true,
          name: true,
          preferredReturn: true,
          managementFee: true
        }
      }
    }
  });

  log(`Fetching investments for authenticated LP`, {
    authUserId: authUser.id,
    email: authUser.email,
    lpActorCount: lpActors.length,
    hasShareClassData: lpActors.some(la => la.shareClass)
  });

  // Get deal information for each LP actor
  const investments = await Promise.all(
    lpActors.map(async (la) => {
      const deal = await prisma.deal.findUnique({
        where: { id: la.dealId },
        select: LP_VISIBLE_DEAL_FIELDS
      });

      return {
        id: la.id,
        dealId: la.dealId,
        entityName: la.entityName,
        email: la.email,
        commitment: la.commitment,
        ownershipPct: la.ownershipPct,
        dealName: la.entityName, // Use entity name as deal name for now
        dealStatus: deal?.status || "INTAKE_RECEIVED",
        assetType: "Real Estate",
        lastUpdate: deal?.updatedAt?.toISOString() || null,
        shareClass: la.shareClass ? {
          id: la.shareClass.id,
          code: la.shareClass.code,
          name: la.shareClass.name,
          preferredReturn: la.shareClass.preferredReturn,
          managementFee: la.shareClass.managementFee
        } : null
      };
    })
  );

  // Calculate summary
  const summary = {
    active_investments: investments.length,
    capital_committed: investments.reduce((sum, i) => sum + (i.commitment || 0), 0),
    capital_deployed: 0, // Would come from capital events
    distributions_ytd: 0 // Would come from capital events
  };

  sendJson(res, 200, {
    investments,
    summary,
    user: {
      id: authUser.id,
      name: authUser.name,
      email: authUser.email
    }
  });
}

/**
 * Get single investment detail for authenticated LP user
 * GET /api/lp/portal/my-investments/:dealId
 */
export async function handleGetMyInvestmentDetail(req, res, authUser, dealId) {
  if (!authUser) {
    return sendError(res, 401, "Authentication required");
  }

  if (authUser.role !== "LP") {
    return sendError(res, 403, "Only LP users can access this endpoint");
  }

  const prisma = getPrisma();

  // Find LP actor for this deal with share class
  const lpActor = await prisma.lPActor.findFirst({
    where: {
      dealId,
      OR: [
        { authUserId: authUser.id },
        { email: authUser.email.toLowerCase() }
      ],
      status: "ACTIVE"
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
    return sendError(res, 404, "Investment not found or you don't have access");
  }

  log(`Fetching investment detail`, {
    dealId,
    lpActorId: lpActor.id,
    shareClass: lpActor.shareClass?.code || 'NONE'
  });

  // Get deal information (filtered to LP-visible fields only)
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: LP_VISIBLE_DEAL_FIELDS
  });

  sendJson(res, 200, {
    deal: {
      id: deal?.id || dealId,
      name: lpActor.entityName,
      status: deal?.status || "DD_ACTIVE",
      asset_type: "Real Estate",
      last_update: deal?.updatedAt?.toISOString() || null,
      ownership: {
        entity: lpActor.entityName,
        commitment: lpActor.commitment,
        ownership_pct: lpActor.ownershipPct,
        shareClass: lpActor.shareClass ? {
          id: lpActor.shareClass.id,
          code: lpActor.shareClass.code,
          name: lpActor.shareClass.name,
          preferredReturn: lpActor.shareClass.preferredReturn,
          managementFee: lpActor.shareClass.managementFee,
          carryPercent: lpActor.shareClass.carryPercent
        } : null
      },
      performance: {
        cash_in: 0,
        cash_out: 0,
        net_invested: lpActor.commitment || 0
      },
      capital_events: []
    },
    lpActor: {
      id: lpActor.id,
      entityName: lpActor.entityName,
      email: lpActor.email,
      commitment: lpActor.commitment,
      ownershipPct: lpActor.ownershipPct,
      shareClass: lpActor.shareClass ? {
        id: lpActor.shareClass.id,
        code: lpActor.shareClass.code,
        name: lpActor.shareClass.name
      } : null
    }
  });
}

/**
 * Get documents for authenticated LP user's investment
 * GET /api/lp/portal/my-investments/:dealId/documents
 */
export async function handleGetMyInvestmentDocuments(req, res, authUser, dealId) {
  if (!authUser) {
    return sendError(res, 401, "Authentication required");
  }

  if (authUser.role !== "LP") {
    return sendError(res, 403, "Only LP users can access this endpoint");
  }

  const prisma = getPrisma();

  // Verify LP has access to this deal
  const lpActor = await prisma.lPActor.findFirst({
    where: {
      dealId,
      OR: [
        { authUserId: authUser.id },
        { email: authUser.email.toLowerCase() }
      ],
      status: "ACTIVE"
    }
  });

  if (!lpActor) {
    return sendError(res, 404, "Investment not found or you don't have access");
  }

  // Get documents (if LPDocument model exists)
  // For now return empty structure
  sendJson(res, 200, {
    documents: {
      TAX: { label: "K-1 & Tax Documents", documents: [] },
      LEGAL: { label: "Legal Documents", documents: [] },
      FINANCIAL: { label: "Financial Reports", documents: [] },
      PRESENTATION: { label: "Presentations", documents: [] },
      CLOSING: { label: "Closing Documents", documents: [] }
    }
  });
}

/**
 * Cleanup expired sessions (called periodically)
 */
export async function cleanupExpiredSessions() {
  const prisma = getPrisma();

  const result = await prisma.lPPortalSession.deleteMany({
    where: {
      expiresAt: { lt: new Date() }
    }
  });

  if (result.count > 0) {
    console.log(`[LP Portal Access] Cleaned up ${result.count} expired sessions`);
  }

  return result.count;
}

/**
 * Get comprehensive LP statement for a specific investment
 * GET /api/lp/portal/my-investments/:dealId/statement
 *
 * Returns aggregated financial data:
 * - Capital call history with funding status
 * - Distribution history with payment status
 * - Performance summary (deployed, received, net cash flow)
 */
export async function handleGetLPStatement(req, res, authUser, dealId) {
  log(`GET /statement request`, { dealId, userId: authUser?.id });

  if (!authUser) {
    return sendError(res, 401, "Authentication required");
  }

  if (authUser.role !== "LP") {
    log(`Access denied - not LP role`, { role: authUser.role });
    return sendError(res, 403, "Only LP users can access this endpoint");
  }

  const prisma = getPrisma();

  // Verify LP has access to this deal
  const lpActor = await requireLPDealAccess(authUser, dealId);

  if (!lpActor) {
    log(`LP access denied`, { userId: authUser.id, dealId });
    return sendError(res, 404, "Investment not found or you don't have access");
  }

  try {
    // Build comprehensive statement
    const statement = await buildLPStatement(dealId, lpActor.id);

    log(`Statement returned`, {
      dealId,
      lpActorId: lpActor.id,
      capitalCallCount: statement.capitalCalls.summary.callCount,
      distributionCount: statement.distributions.summary.distributionCount
    });

    sendJson(res, 200, statement);
  } catch (error) {
    console.error(`[LP Portal Access] ERROR: Failed to build statement`, {
      dealId,
      lpActorId: lpActor.id,
      error: error.message
    });
    return sendError(res, 500, "Failed to generate statement", error.message);
  }
}
