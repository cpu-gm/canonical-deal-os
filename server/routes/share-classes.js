/**
 * Share Classes Routes
 *
 * Manages share classes for LP investments in deals.
 * Enables multi-class deal structures (Class A, Class B, Preferred, etc.)
 * with different economic terms for each class.
 *
 * Endpoints:
 * - GET /api/deals/:dealId/share-classes - List share classes for a deal
 * - POST /api/deals/:dealId/share-classes - Create share class (GP only)
 * - GET /api/deals/:dealId/share-classes/:id - Get share class details
 * - PATCH /api/deals/:dealId/share-classes/:id - Update share class (GP only)
 * - DELETE /api/deals/:dealId/share-classes/:id - Delete share class (GP only, no LPs)
 */

import { getPrisma } from "../db.js";
import { extractAuthUser } from "./auth.js";
import { createDealEvent } from "../services/audit-service.js";
import { readStore } from "../store.js";

const LOG_PREFIX = "[ShareClass]";

// ========== LOGGING UTILITIES ==========

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
  if (process.env.DEBUG_SHARECLASS === 'true') {
    const timestamp = new Date().toISOString();
    console.log(`${timestamp} ${LOG_PREFIX} DEBUG: ${message}`, JSON.stringify(data));
  }
}

// ========== RESPONSE HELPERS ==========

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(JSON.stringify(payload));
}

function sendError(res, status, message, details = null) {
  sendJson(res, status, { message, details });
}

// ========== AUTH HELPERS ==========

/**
 * Require authenticated user with deal org access
 * SECURITY: Enforces organization isolation via deal membership
 */
async function requireDealOrgAccess(req, res, dealId) {
  log(`Checking deal org access`, { dealId });
  const authUser = await extractAuthUser(req);

  if (!authUser) {
    log(`Auth failed - no user`);
    sendError(res, 401, "Not authenticated");
    return null;
  }

  log(`Auth user found`, { userId: authUser.id, role: authUser.role });

  const store = await readStore();
  const record = store.dealIndex.find((item) => item.id === dealId);

  if (!record) {
    log(`Deal not found`, { dealId });
    sendError(res, 404, "Deal not found");
    return null;
  }

  // Enforce org isolation
  log(`Org check`, { dealOrgId: record.organizationId, userOrgId: authUser.organizationId });
  if (record.organizationId && record.organizationId !== authUser.organizationId) {
    logError(`Org isolation blocked`, null, {
      dealOrgId: record.organizationId,
      userOrgId: authUser.organizationId
    });
    sendError(res, 403, "Access denied - deal belongs to different organization");
    return null;
  }

  log(`Deal org access granted`, { userId: authUser.id, dealId });
  return { authUser, dealRecord: record };
}

/**
 * Require GP or Admin role with deal org access
 * SECURITY: Enforces both role requirement AND organization isolation
 */
async function requireGPWithDealOrgAccess(req, res, dealId) {
  const result = await requireDealOrgAccess(req, res, dealId);
  if (!result) return null;

  const { authUser, dealRecord } = result;

  if (!['GP', 'Admin'].includes(authUser.role)) {
    log(`Role check failed`, { role: authUser.role, required: 'GP or Admin' });
    sendError(res, 403, "GP or Admin role required");
    return null;
  }

  if (authUser.status !== 'ACTIVE') {
    log(`Status check failed`, { status: authUser.status });
    sendError(res, 403, "Account not active");
    return null;
  }

  log(`GP with deal org access granted`, { userId: authUser.id, role: authUser.role });
  return { authUser, dealRecord };
}

// ========== VALIDATION HELPERS ==========

/**
 * Validate share class data
 */
function validateShareClassData(data, isUpdate = false) {
  const errors = [];

  if (!isUpdate) {
    // Required fields for creation
    if (!data.name || typeof data.name !== 'string' || data.name.trim() === '') {
      errors.push("name is required and must be a non-empty string");
    }
    if (!data.code || typeof data.code !== 'string' || data.code.trim() === '') {
      errors.push("code is required and must be a non-empty string");
    }
  }

  // Validate code format (alphanumeric, 1-10 chars)
  if (data.code !== undefined) {
    if (!/^[A-Za-z0-9]{1,10}$/.test(data.code)) {
      errors.push("code must be alphanumeric and 1-10 characters");
    }
  }

  // Validate numeric fields
  if (data.preferredReturn !== undefined && data.preferredReturn !== null) {
    if (typeof data.preferredReturn !== 'number' || data.preferredReturn < 0 || data.preferredReturn > 1) {
      errors.push("preferredReturn must be a number between 0 and 1 (e.g., 0.08 for 8%)");
    }
  }

  if (data.managementFee !== undefined && data.managementFee !== null) {
    if (typeof data.managementFee !== 'number' || data.managementFee < 0 || data.managementFee > 1) {
      errors.push("managementFee must be a number between 0 and 1 (e.g., 0.02 for 2%)");
    }
  }

  if (data.carryPercent !== undefined && data.carryPercent !== null) {
    if (typeof data.carryPercent !== 'number' || data.carryPercent < 0 || data.carryPercent > 1) {
      errors.push("carryPercent must be a number between 0 and 1 (e.g., 0.20 for 20%)");
    }
  }

  if (data.priority !== undefined && data.priority !== null) {
    if (!Number.isInteger(data.priority) || data.priority < 1) {
      errors.push("priority must be a positive integer (1 = highest)");
    }
  }

  if (data.votingRights !== undefined && typeof data.votingRights !== 'boolean') {
    errors.push("votingRights must be a boolean");
  }

  return errors;
}

// ========== ROUTE HANDLERS ==========

/**
 * List share classes for a deal
 * GET /api/deals/:dealId/share-classes
 */
export async function handleListShareClasses(req, res, dealId) {
  log(`GET /share-classes`, { dealId });

  const result = await requireDealOrgAccess(req, res, dealId);
  if (!result) return;

  const { authUser } = result;
  log(`Listing share classes`, { dealId, userId: authUser.id });

  try {
    const prisma = getPrisma();

    const shareClasses = await prisma.shareClass.findMany({
      where: { dealId },
      include: {
        _count: {
          select: { lpActors: true, lpInvitations: true }
        }
      },
      orderBy: [
        { priority: 'asc' },
        { code: 'asc' }
      ]
    });

    log(`Share classes fetched`, { dealId, count: shareClasses.length });
    logDebug(`Share class list`, { classes: shareClasses.map(c => ({ id: c.id, code: c.code, name: c.name })) });

    sendJson(res, 200, { shareClasses });
  } catch (error) {
    logError(`Failed to list share classes`, error, { dealId });
    sendError(res, 500, "Failed to list share classes");
  }
}

/**
 * Create a new share class
 * POST /api/deals/:dealId/share-classes
 * Body: { name, code, description?, preferredReturn?, managementFee?, carryPercent?, votingRights?, priority? }
 */
export async function handleCreateShareClass(req, res, dealId, readJsonBody) {
  log(`POST /share-classes`, { dealId });

  const result = await requireGPWithDealOrgAccess(req, res, dealId);
  if (!result) return;

  const { authUser, dealRecord } = result;

  try {
    const body = await readJsonBody(req);
    log(`Create share class request`, {
      dealId,
      code: body?.code,
      name: body?.name,
      userId: authUser.id
    });

    // Validate input
    const validationErrors = validateShareClassData(body, false);
    if (validationErrors.length > 0) {
      log(`Validation failed`, { errors: validationErrors });
      return sendError(res, 400, "Validation failed", validationErrors);
    }

    const prisma = getPrisma();

    // Check for duplicate code
    log(`Validating share class code uniqueness`, { dealId, code: body.code });
    const existing = await prisma.shareClass.findFirst({
      where: { dealId, code: body.code.toUpperCase() }
    });

    if (existing) {
      logWarn(`Duplicate code attempted`, { dealId, code: body.code, existingId: existing.id });
      return sendError(res, 409, `Share class with code '${body.code}' already exists in this deal`);
    }

    // Create share class
    log(`Creating share class record`, {
      dealId,
      code: body.code,
      name: body.name
    });

    const shareClass = await prisma.shareClass.create({
      data: {
        dealId,
        organizationId: dealRecord.organizationId || null,
        name: body.name.trim(),
        code: body.code.toUpperCase().trim(),
        description: body.description?.trim() || null,
        preferredReturn: body.preferredReturn ?? null,
        managementFee: body.managementFee ?? null,
        carryPercent: body.carryPercent ?? null,
        votingRights: body.votingRights ?? true,
        priority: body.priority ?? 1,
        createdBy: authUser.id,
        createdByName: authUser.name
      }
    });

    // Audit event
    await createDealEvent(dealId, 'SHARE_CLASS_CREATED', {
      shareClassId: shareClass.id,
      code: shareClass.code,
      name: shareClass.name,
      preferredReturn: shareClass.preferredReturn,
      managementFee: shareClass.managementFee,
      carryPercent: shareClass.carryPercent,
      priority: shareClass.priority
    }, { id: authUser.id, name: authUser.name, role: authUser.role });

    log(`Share class created`, {
      shareClassId: shareClass.id,
      dealId,
      code: shareClass.code,
      name: shareClass.name
    });

    sendJson(res, 201, { shareClass });
  } catch (error) {
    logError(`Share class creation failed`, error, { dealId });
    sendError(res, 500, "Failed to create share class");
  }
}

/**
 * Get a specific share class
 * GET /api/deals/:dealId/share-classes/:shareClassId
 */
export async function handleGetShareClass(req, res, dealId, shareClassId) {
  log(`GET /share-classes/:id`, { dealId, shareClassId });

  const result = await requireDealOrgAccess(req, res, dealId);
  if (!result) return;

  const { authUser } = result;
  log(`Getting share class`, { dealId, shareClassId, userId: authUser.id });

  try {
    const prisma = getPrisma();

    const shareClass = await prisma.shareClass.findFirst({
      where: { id: shareClassId, dealId },
      include: {
        lpActors: {
          select: {
            id: true,
            entityName: true,
            email: true,
            commitment: true,
            ownershipPct: true,
            status: true
          }
        },
        lpInvitations: {
          select: {
            id: true,
            lpEntityName: true,
            lpEmail: true,
            commitment: true,
            ownershipPct: true,
            status: true
          }
        }
      }
    });

    if (!shareClass) {
      log(`Share class not found`, { dealId, shareClassId });
      return sendError(res, 404, "Share class not found");
    }

    log(`Share class found`, {
      shareClassId,
      code: shareClass.code,
      lpCount: shareClass.lpActors.length,
      invitationCount: shareClass.lpInvitations.length
    });

    sendJson(res, 200, { shareClass });
  } catch (error) {
    logError(`Failed to get share class`, error, { dealId, shareClassId });
    sendError(res, 500, "Failed to get share class");
  }
}

/**
 * Update a share class
 * PATCH /api/deals/:dealId/share-classes/:shareClassId
 * Body: { name?, description?, preferredReturn?, managementFee?, carryPercent?, votingRights?, priority? }
 * NOTE: code cannot be changed after creation
 */
export async function handleUpdateShareClass(req, res, dealId, shareClassId, readJsonBody) {
  log(`PATCH /share-classes/:id`, { dealId, shareClassId });

  const result = await requireGPWithDealOrgAccess(req, res, dealId);
  if (!result) return;

  const { authUser } = result;

  try {
    const body = await readJsonBody(req);
    log(`Update share class request`, {
      shareClassId,
      dealId,
      changes: Object.keys(body || {}),
      userId: authUser.id
    });

    // Prevent code changes
    if (body?.code !== undefined) {
      logWarn(`Attempted to change share class code`, { shareClassId, newCode: body.code });
      return sendError(res, 400, "Share class code cannot be changed after creation");
    }

    // Validate input
    const validationErrors = validateShareClassData(body, true);
    if (validationErrors.length > 0) {
      log(`Validation failed`, { errors: validationErrors });
      return sendError(res, 400, "Validation failed", validationErrors);
    }

    const prisma = getPrisma();

    // Verify share class exists
    const existing = await prisma.shareClass.findFirst({
      where: { id: shareClassId, dealId }
    });

    if (!existing) {
      log(`Share class not found for update`, { shareClassId, dealId });
      return sendError(res, 404, "Share class not found");
    }

    log(`Existing share class found`, {
      shareClassId,
      code: existing.code,
      name: existing.name
    });

    // Build update data
    const updateData = {};
    if (body.name !== undefined) updateData.name = body.name.trim();
    if (body.description !== undefined) updateData.description = body.description?.trim() || null;
    if (body.preferredReturn !== undefined) updateData.preferredReturn = body.preferredReturn;
    if (body.managementFee !== undefined) updateData.managementFee = body.managementFee;
    if (body.carryPercent !== undefined) updateData.carryPercent = body.carryPercent;
    if (body.votingRights !== undefined) updateData.votingRights = body.votingRights;
    if (body.priority !== undefined) updateData.priority = body.priority;

    if (Object.keys(updateData).length === 0) {
      logWarn(`No fields to update`, { shareClassId });
      return sendError(res, 400, "No valid fields provided for update");
    }

    log(`Updating share class`, { shareClassId, fieldsUpdated: Object.keys(updateData) });

    const shareClass = await prisma.shareClass.update({
      where: { id: shareClassId },
      data: updateData
    });

    // Audit event
    await createDealEvent(dealId, 'SHARE_CLASS_UPDATED', {
      shareClassId: shareClass.id,
      code: shareClass.code,
      fieldsUpdated: Object.keys(updateData),
      newValues: updateData
    }, { id: authUser.id, name: authUser.name, role: authUser.role });

    log(`Share class updated`, {
      shareClassId,
      fieldsUpdated: Object.keys(updateData)
    });

    sendJson(res, 200, { shareClass });
  } catch (error) {
    logError(`Failed to update share class`, error, { dealId, shareClassId });
    sendError(res, 500, "Failed to update share class");
  }
}

/**
 * Delete a share class
 * DELETE /api/deals/:dealId/share-classes/:shareClassId
 * NOTE: Cannot delete if LPs are assigned to this class
 */
export async function handleDeleteShareClass(req, res, dealId, shareClassId) {
  log(`DELETE /share-classes/:id`, { dealId, shareClassId });

  const result = await requireGPWithDealOrgAccess(req, res, dealId);
  if (!result) return;

  const { authUser } = result;

  try {
    const prisma = getPrisma();

    // Verify share class exists
    const shareClass = await prisma.shareClass.findFirst({
      where: { id: shareClassId, dealId },
      include: {
        _count: {
          select: { lpActors: true, lpInvitations: true }
        }
      }
    });

    if (!shareClass) {
      log(`Share class not found for deletion`, { shareClassId, dealId });
      return sendError(res, 404, "Share class not found");
    }

    log(`Checking for existing LPs in class`, {
      shareClassId,
      code: shareClass.code,
      lpCount: shareClass._count.lpActors,
      invitationCount: shareClass._count.lpInvitations
    });

    // Cannot delete if LPs are assigned
    if (shareClass._count.lpActors > 0) {
      logWarn(`Cannot delete class with LPs`, {
        shareClassId,
        code: shareClass.code,
        lpCount: shareClass._count.lpActors
      });
      return sendError(res, 409, `Cannot delete share class with ${shareClass._count.lpActors} LP(s) assigned`);
    }

    // Cannot delete if pending invitations exist
    if (shareClass._count.lpInvitations > 0) {
      logWarn(`Cannot delete class with pending invitations`, {
        shareClassId,
        code: shareClass.code,
        invitationCount: shareClass._count.lpInvitations
      });
      return sendError(res, 409, `Cannot delete share class with ${shareClass._count.lpInvitations} pending invitation(s)`);
    }

    log(`Deleting share class`, { shareClassId, code: shareClass.code });

    await prisma.shareClass.delete({
      where: { id: shareClassId }
    });

    // Audit event
    await createDealEvent(dealId, 'SHARE_CLASS_DELETED', {
      shareClassId,
      code: shareClass.code,
      name: shareClass.name
    }, { id: authUser.id, name: authUser.name, role: authUser.role });

    log(`Share class deleted`, { shareClassId, dealId, code: shareClass.code });

    sendJson(res, 200, { message: "Share class deleted", deletedId: shareClassId });
  } catch (error) {
    logError(`Failed to delete share class`, error, { dealId, shareClassId });
    sendError(res, 500, "Failed to delete share class");
  }
}

/**
 * Get or create default share class for a deal
 * Used internally when no share class is specified
 */
export async function getOrCreateDefaultShareClass(dealId, organizationId, createdBy = null, createdByName = null) {
  log(`Getting/creating default share class`, { dealId, organizationId });

  const prisma = getPrisma();

  // Look for existing default (Class A)
  let defaultClass = await prisma.shareClass.findFirst({
    where: { dealId, code: 'A' }
  });

  if (defaultClass) {
    log(`Default share class found`, { dealId, shareClassId: defaultClass.id });
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
