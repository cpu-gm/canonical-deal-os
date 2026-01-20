import { extractAuthUser } from "../routes/auth.js";
import { getPrisma } from "../db.js";

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS"
  });
  res.end(JSON.stringify(payload));
}

function sendError(res, status, message, details = null) {
  sendJson(res, status, { message, details });
}

/**
 * Require authenticated user with ACTIVE status
 */
export async function requireAuth(req, res) {
  const user = await extractAuthUser(req);
  if (!user) {
    sendError(res, 401, "Not authenticated");
    return null;
  }
  if (user.status !== 'ACTIVE') {
    sendError(res, 403, "Account not active");
    return null;
  }
  return user;
}

/**
 * Require GP or Admin role
 */
export async function requireGP(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return null;

  if (!['GP', 'Admin'].includes(user.role)) {
    sendError(res, 403, "GP or Admin role required");
    return null;
  }
  return user;
}

/**
 * Require Admin role
 */
export async function requireAdmin(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return null;

  if (user.role !== 'Admin') {
    sendError(res, 403, "Admin access required");
    return null;
  }
  return user;
}

/**
 * Verify deal belongs to user's organization
 * ALWAYS enforces - no conditional bypass
 * @returns {boolean} true if access granted, false if denied (response already sent)
 */
export async function requireDealAccess(authUser, dealId, res) {
  if (!authUser) {
    sendError(res, 401, "Not authenticated");
    return false;
  }

  const { readStore } = await import("../store.js");
  const store = await readStore();
  const record = store.dealIndex.find((item) => item.id === dealId);

  if (!record) {
    sendError(res, 404, "Deal not found");
    return false;
  }

  // ALWAYS enforce org isolation - no conditional bypass
  if (record.organizationId && record.organizationId !== authUser.organizationId) {
    sendError(res, 403, "Access denied - deal belongs to different organization");
    return false;
  }

  return true;
}

/**
 * Validate that approver is not the same as creator (prevent self-approval)
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateNotSelfApproval(approverId, creatorId) {
  if (approverId === creatorId) {
    return { valid: false, reason: "Cannot approve your own submission" };
  }
  return { valid: true };
}

/**
 * Check if required approval exists and is valid
 * @returns {{ valid: boolean, approval?: object, reason?: string }}
 */
export async function checkApprovalExists(dealId, approvalType) {
  const prisma = getPrisma();

  const existingApproval = await prisma.approvalRecord.findFirst({
    where: {
      dealId,
      approvalType,
      decision: 'APPROVED'
    },
    orderBy: { createdAt: 'desc' }
  });

  if (!existingApproval) {
    return { valid: false, reason: `Requires ${approvalType} approval before proceeding` };
  }

  // Check if expired (if expiresAt is set)
  if (existingApproval.expiresAt && existingApproval.expiresAt < new Date()) {
    return { valid: false, reason: `${approvalType} approval has expired` };
  }

  return { valid: true, approval: existingApproval };
}

/**
 * Require LP entitlement - validates LP has access via JWT or portal token
 * SECURITY: Uses validated credentials, NOT raw headers like x-user-id
 *
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @param {string|null} dealId - Optional deal ID to verify specific deal access
 * @param {string|null} token - Optional LP portal session token from query param
 * @returns {Promise<{lpEmail: string, lpActorId?: string, authType: 'jwt'|'token'}|null>}
 *          Returns LP context if entitled, null if not (response already sent)
 */
export async function requireLPEntitlement(req, res, dealId = null, token = null) {
  const prisma = getPrisma();

  // Try JWT auth first
  const authUser = await extractAuthUser(req);

  if (authUser) {
    // JWT auth path - use email from validated JWT, NOT from headers
    const lpEmail = authUser.email;

    if (dealId) {
      // Verify LP has access to this specific deal
      const lpActor = await prisma.lPActor.findUnique({
        where: {
          email_dealId: {
            email: lpEmail,
            dealId
          }
        }
      });

      if (!lpActor || lpActor.status !== 'ACTIVE') {
        sendError(res, 403, "LP does not have access to this deal");
        return null;
      }

      return { lpEmail, lpActorId: lpActor.id, authType: 'jwt' };
    }

    // No specific deal - verify LP has at least one active investment
    const lpActors = await prisma.lPActor.findMany({
      where: {
        email: lpEmail,
        status: 'ACTIVE'
      },
      take: 1
    });

    if (lpActors.length === 0) {
      sendError(res, 403, "No active LP investments found");
      return null;
    }

    return { lpEmail, authType: 'jwt' };
  }

  // Token auth path - validate portal session token
  if (token) {
    const session = await prisma.lPPortalSession.findUnique({
      where: { token }
    });

    if (!session) {
      sendError(res, 401, "Invalid session token");
      return null;
    }

    if (new Date() > session.expiresAt) {
      sendError(res, 401, "Session expired");
      return null;
    }

    // Get LP actor from session
    const lpActor = await prisma.lPActor.findUnique({
      where: { id: session.lpActorId }
    });

    if (!lpActor || lpActor.status !== 'ACTIVE') {
      sendError(res, 403, "LP is not active");
      return null;
    }

    // If dealId specified, verify this LP has access to that deal
    if (dealId && lpActor.dealId !== dealId) {
      // Check if LP has access to the requested deal via another LPActor record
      const dealAccess = await prisma.lPActor.findUnique({
        where: {
          email_dealId: {
            email: lpActor.email,
            dealId
          }
        }
      });

      if (!dealAccess || dealAccess.status !== 'ACTIVE') {
        sendError(res, 403, "LP does not have access to this deal");
        return null;
      }

      return { lpEmail: lpActor.email, lpActorId: dealAccess.id, authType: 'token' };
    }

    // Update last used timestamp
    await prisma.lPPortalSession.update({
      where: { id: session.id },
      data: { lastUsedAt: new Date() }
    });

    return { lpEmail: lpActor.email, lpActorId: lpActor.id, authType: 'token' };
  }

  // Neither JWT nor token provided
  sendError(res, 401, "Authentication required - provide JWT or LP portal token");
  return null;
}

/**
 * Log an action to the permission audit log
 */
export async function logPermissionAction({
  actorId,
  actorName,
  targetUserId,
  targetUserName,
  action,
  beforeValue,
  afterValue,
  reason,
  ipAddress
}) {
  const prisma = getPrisma();

  await prisma.permissionAuditLog.create({
    data: {
      actorId,
      actorName: actorName || null,
      targetUserId: targetUserId || actorId,
      targetUserName: targetUserName || null,
      action,
      beforeValue: beforeValue ? JSON.stringify(beforeValue) : null,
      afterValue: afterValue ? JSON.stringify(afterValue) : null,
      reason: reason || null,
      ipAddress: ipAddress || null
    }
  });
}

/**
 * Generic resource org isolation check
 * Verifies a resource belongs to the user's organization via deal chain
 *
 * @param {object} resource - The fetched resource (must include deal if using dealField)
 * @param {object} authUser - The authenticated user
 * @param {object} res - Response object (for sending 403)
 * @param {string} resourceName - Name for error message (e.g., "document", "import")
 * @param {string} orgField - Field path to organizationId (default: "deal.organizationId")
 * @returns {boolean} true if access granted, false if denied (response already sent)
 */
export function requireOrgIsolation(resource, authUser, res, resourceName = "resource", orgField = "deal.organizationId") {
  // Navigate the field path (e.g., "deal.organizationId" -> resource.deal.organizationId)
  const parts = orgField.split(".");
  let orgId = resource;
  for (const part of parts) {
    orgId = orgId?.[part];
  }

  if (orgId && orgId !== authUser.organizationId) {
    sendError(res, 403, `Access denied - ${resourceName} belongs to different organization`);
    return false;
  }

  return true;
}

/**
 * Fetch a resource by ID with org isolation check built-in
 * Returns null if not found or access denied (response already sent)
 *
 * @param {object} options
 * @param {object} options.prisma - Prisma client
 * @param {string} options.model - Model name (e.g., "excelImport")
 * @param {string} options.id - Resource ID
 * @param {object} options.authUser - Authenticated user
 * @param {object} options.res - Response object
 * @param {object} options.include - Prisma include object (should include deal for org check)
 * @param {string} options.resourceName - Name for error messages
 * @returns {Promise<object|null>} The resource or null
 */
export async function fetchWithOrgCheck({ prisma, model, id, authUser, res, include = { deal: true }, resourceName = "resource" }) {
  const resource = await prisma[model].findUnique({
    where: { id },
    include
  });

  if (!resource) {
    sendError(res, 404, `${resourceName} not found`);
    return null;
  }

  if (!requireOrgIsolation(resource, authUser, res, resourceName)) {
    return null;
  }

  return resource;
}

// Re-export for convenience
export { sendJson, sendError };
