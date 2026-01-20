/**
 * LP Transfers Routes
 *
 * Manages LP interest transfers/assignments between investors.
 * Enables secondary trading and LP assignments with GP approval workflow.
 *
 * Endpoints:
 * - POST /api/deals/:dealId/lp-transfers - Create transfer request
 * - GET /api/deals/:dealId/lp-transfers - List transfers for a deal
 * - GET /api/deals/:dealId/lp-transfers/:transferId - Get transfer details
 * - POST /api/deals/:dealId/lp-transfers/:transferId/approve - Approve transfer
 * - POST /api/deals/:dealId/lp-transfers/:transferId/complete - Execute transfer
 * - POST /api/deals/:dealId/lp-transfers/:transferId/cancel - Cancel transfer
 */

import { getPrisma } from "../db.js";
import { extractAuthUser } from "./auth.js";
import { createDealEvent } from "../services/audit-service.js";
import { readStore } from "../store.js";

const LOG_PREFIX = "[LPTransfers]";

function log(message, data = {}) {
  console.log(`${LOG_PREFIX} ${message}`, Object.keys(data).length > 0 ? JSON.stringify(data) : '');
}

function logError(message, error = null, data = {}) {
  console.error(`${LOG_PREFIX} ERROR: ${message}`, data, error?.message || '');
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

  const store = await readStore();
  const record = store.dealIndex.find((item) => item.id === dealId);

  if (!record) {
    log(`Deal not found`, { dealId });
    sendError(res, 404, "Deal not found");
    return null;
  }

  // Enforce org isolation
  log(`Org check: deal.orgId=${record.organizationId}, user.orgId=${authUser.organizationId}`);
  if (record.organizationId && record.organizationId !== authUser.organizationId) {
    logError(`Org isolation blocked`, null, { dealOrgId: record.organizationId, userOrgId: authUser.organizationId });
    sendError(res, 403, "Access denied - deal belongs to different organization");
    return null;
  }

  log(`Deal org access granted`, { userId: authUser.id, dealId });
  return authUser;
}

/**
 * Require GP or Admin role with deal org access
 * SECURITY: Enforces both role requirement AND organization isolation
 */
async function requireGPWithDealOrgAccess(req, res, dealId) {
  const authUser = await requireDealOrgAccess(req, res, dealId);
  if (!authUser) return null;

  if (!['GP', 'Admin'].includes(authUser.role)) {
    log(`Role check failed`, { role: authUser.role });
    sendError(res, 403, "GP or Admin role required");
    return null;
  }
  if (authUser.status !== 'ACTIVE') {
    log(`Status check failed`, { status: authUser.status });
    sendError(res, 403, "Account not active");
    return null;
  }
  log(`GP with deal org access granted`, { userId: authUser.id, role: authUser.role });
  return authUser;
}

/**
 * Require GP or Admin role for transfer management
 * @deprecated Use requireGPWithDealOrgAccess instead for org isolation
 */
async function requireGP(req, res) {
  const user = await extractAuthUser(req);
  if (!user) {
    sendError(res, 401, "Not authenticated");
    return null;
  }
  if (!['GP', 'Admin'].includes(user.role)) {
    sendError(res, 403, "GP or Admin role required");
    return null;
  }
  if (user.status !== 'ACTIVE') {
    sendError(res, 403, "Account not active");
    return null;
  }
  return user;
}

/**
 * Validate transfer amount and percentage
 */
function validateTransferValues(fromLp, transferAmount, transferPct) {
  const errors = [];

  if (transferAmount <= 0) {
    errors.push("Transfer amount must be positive");
  }

  if (transferPct <= 0 || transferPct > 100) {
    errors.push("Transfer percentage must be between 0 and 100");
  }

  // Ensure transfer doesn't exceed LP's current position
  if (transferAmount > fromLp.commitment) {
    errors.push(`Transfer amount ${transferAmount} exceeds LP commitment ${fromLp.commitment}`);
  }

  if (transferPct > fromLp.ownershipPct) {
    errors.push(`Transfer percentage ${transferPct} exceeds LP ownership ${fromLp.ownershipPct}`);
  }

  return errors;
}

/**
 * Create a new LP transfer request
 * POST /api/deals/:dealId/lp-transfers
 * Body: { fromLpActorId, toLpActorId, transferAmount, transferPct, effectiveDate, reason?, documentId? }
 */
export async function handleCreateTransfer(req, res, dealId, readJsonBody) {
  log(`Creating LP transfer`, { dealId });

  // SECURITY: Enforce GP role AND org isolation via deal membership
  const authUser = await requireGPWithDealOrgAccess(req, res, dealId);
  if (!authUser) return;

  const body = await readJsonBody(req);
  log(`Transfer request body`, { fromLpActorId: body?.fromLpActorId, toLpActorId: body?.toLpActorId, amount: body?.transferAmount });

  // Validate required fields
  if (!body?.fromLpActorId || !body?.toLpActorId || !body?.transferAmount || !body?.transferPct || !body?.effectiveDate) {
    log(`Validation failed - missing required fields`);
    return sendError(res, 400, "fromLpActorId, toLpActorId, transferAmount, transferPct, and effectiveDate are required");
  }

  // Cannot transfer to self
  if (body.fromLpActorId === body.toLpActorId) {
    log(`Validation failed - self transfer`);
    return sendError(res, 400, "Cannot transfer to the same LP");
  }

  const prisma = getPrisma();

  // Get deal's organizationId for new transfer record
  const store = await readStore();
  const dealRecord = store.dealIndex.find((r) => r.id === dealId);
  const organizationId = dealRecord?.organizationId || null;
  log(`Deal org for transfer`, { organizationId });

  // Verify both LPs exist and belong to this deal (include share class for validation)
  const fromLp = await prisma.lPActor.findFirst({
    where: { id: body.fromLpActorId, dealId, status: 'ACTIVE' },
    include: { shareClass: { select: { id: true, code: true, name: true } } }
  });

  if (!fromLp) {
    log(`Source LP not found`, { lpActorId: body.fromLpActorId });
    return sendError(res, 404, "Source LP not found or not active");
  }
  log(`Source LP found`, {
    entityName: fromLp.entityName,
    commitment: fromLp.commitment,
    ownershipPct: fromLp.ownershipPct,
    shareClassCode: fromLp.shareClass?.code || 'NONE'
  });

  const toLp = await prisma.lPActor.findFirst({
    where: { id: body.toLpActorId, dealId, status: 'ACTIVE' },
    include: { shareClass: { select: { id: true, code: true, name: true } } }
  });

  if (!toLp) {
    log(`Destination LP not found`, { lpActorId: body.toLpActorId });
    return sendError(res, 404, "Destination LP not found or not active");
  }
  log(`Destination LP found`, {
    entityName: toLp.entityName,
    commitment: toLp.commitment,
    ownershipPct: toLp.ownershipPct,
    shareClassCode: toLp.shareClass?.code || 'NONE'
  });

  // Validate same share class requirement
  log(`Validating share class match`, {
    fromClass: fromLp.shareClass?.code || 'NONE',
    toClass: toLp.shareClass?.code || 'NONE'
  });

  if (fromLp.shareClassId !== toLp.shareClassId) {
    logError(`Transfer rejected - class mismatch`, null, {
      fromLpActorId: body.fromLpActorId,
      fromClass: fromLp.shareClass?.code || 'NONE',
      toLpActorId: body.toLpActorId,
      toClass: toLp.shareClass?.code || 'NONE'
    });
    return sendError(res, 400, "Cannot transfer between different share classes", {
      fromShareClass: fromLp.shareClass?.code || 'None',
      toShareClass: toLp.shareClass?.code || 'None',
      hint: "Transfers can only occur between LPs in the same share class"
    });
  }
  log(`Share class validation passed`, { shareClassCode: fromLp.shareClass?.code || 'NONE' });

  // Validate transfer values
  const validationErrors = validateTransferValues(fromLp, body.transferAmount, body.transferPct);
  if (validationErrors.length > 0) {
    log(`Transfer validation failed`, { errors: validationErrors });
    return sendError(res, 400, "Validation failed", validationErrors);
  }

  // Parse effective date
  const effectiveDate = new Date(body.effectiveDate);
  if (isNaN(effectiveDate.getTime())) {
    log(`Invalid effective date format`, { effectiveDate: body.effectiveDate });
    return sendError(res, 400, "Invalid effectiveDate format");
  }

  // Check for existing pending transfer between same parties
  const existingPending = await prisma.lPTransfer.findFirst({
    where: {
      dealId,
      fromLpActorId: body.fromLpActorId,
      toLpActorId: body.toLpActorId,
      status: { in: ['PENDING', 'APPROVED'] }
    }
  });

  if (existingPending) {
    log(`Duplicate transfer exists`, { existingId: existingPending.id, status: existingPending.status });
    return sendError(res, 409, "A pending or approved transfer already exists between these LPs");
  }

  // Create transfer record
  const transfer = await prisma.lPTransfer.create({
    data: {
      dealId,
      organizationId,
      fromLpActorId: body.fromLpActorId,
      toLpActorId: body.toLpActorId,
      transferAmount: body.transferAmount,
      transferPct: body.transferPct,
      effectiveDate,
      status: 'PENDING',
      reason: body.reason || null,
      documentId: body.documentId || null,
      createdBy: authUser.id,
      createdByName: authUser.name
    },
    include: {
      fromLpActor: {
        select: {
          id: true,
          entityName: true,
          email: true,
          shareClass: { select: { id: true, code: true, name: true } }
        }
      },
      toLpActor: {
        select: {
          id: true,
          entityName: true,
          email: true,
          shareClass: { select: { id: true, code: true, name: true } }
        }
      }
    }
  });

  log(`Transfer record created`, {
    transferId: transfer.id,
    shareClassCode: fromLp.shareClass?.code || 'NONE'
  });

  // Create audit event
  await createDealEvent(dealId, 'LP_TRANSFER_CREATED', {
    transferId: transfer.id,
    fromLpActorId: transfer.fromLpActorId,
    fromLpName: transfer.fromLpActor.entityName,
    toLpActorId: transfer.toLpActorId,
    toLpName: transfer.toLpActor.entityName,
    transferAmount: transfer.transferAmount,
    transferPct: transfer.transferPct,
    effectiveDate: transfer.effectiveDate.toISOString()
  }, { id: authUser.id, name: authUser.name, role: authUser.role });

  log(`Transfer created successfully`, { transferId: transfer.id, status: transfer.status });
  sendJson(res, 201, { transfer });
}

/**
 * List LP transfers for a deal
 * GET /api/deals/:dealId/lp-transfers
 * Query: status? (filter by status)
 */
export async function handleListTransfers(req, res, dealId, url) {
  log(`Listing LP transfers`, { dealId });

  // SECURITY: Enforce org isolation via deal membership
  const authUser = await requireDealOrgAccess(req, res, dealId);
  if (!authUser) return;

  const prisma = getPrisma();
  const statusFilter = url.searchParams.get('status');

  const where = { dealId };
  if (statusFilter) {
    where.status = statusFilter;
    log(`Filtering by status`, { status: statusFilter });
  }

  const transfers = await prisma.lPTransfer.findMany({
    where,
    include: {
      fromLpActor: {
        select: {
          id: true,
          entityName: true,
          email: true,
          shareClass: { select: { id: true, code: true, name: true } }
        }
      },
      toLpActor: {
        select: {
          id: true,
          entityName: true,
          email: true,
          shareClass: { select: { id: true, code: true, name: true } }
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  });

  log(`Found transfers`, { count: transfers.length });
  sendJson(res, 200, { transfers });
}

/**
 * Get a specific LP transfer
 * GET /api/deals/:dealId/lp-transfers/:transferId
 */
export async function handleGetTransfer(req, res, dealId, transferId) {
  log(`Getting LP transfer`, { dealId, transferId });

  // SECURITY: Enforce org isolation via deal membership
  const authUser = await requireDealOrgAccess(req, res, dealId);
  if (!authUser) return;

  const prisma = getPrisma();

  const transfer = await prisma.lPTransfer.findFirst({
    where: { id: transferId, dealId },
    include: {
      fromLpActor: {
        select: {
          id: true,
          entityName: true,
          email: true,
          commitment: true,
          ownershipPct: true,
          shareClass: { select: { id: true, code: true, name: true } }
        }
      },
      toLpActor: {
        select: {
          id: true,
          entityName: true,
          email: true,
          commitment: true,
          ownershipPct: true,
          shareClass: { select: { id: true, code: true, name: true } }
        }
      }
    }
  });

  if (!transfer) {
    log(`Transfer not found`, { transferId });
    return sendError(res, 404, "Transfer not found");
  }

  log(`Transfer found`, { transferId, status: transfer.status });
  sendJson(res, 200, { transfer });
}

/**
 * Approve an LP transfer (GP only)
 * POST /api/deals/:dealId/lp-transfers/:transferId/approve
 * Body: { approvalDocId? }
 */
export async function handleApproveTransfer(req, res, dealId, transferId, readJsonBody) {
  log(`Approving LP transfer`, { dealId, transferId });

  // SECURITY: Enforce GP role AND org isolation via deal membership
  const authUser = await requireGPWithDealOrgAccess(req, res, dealId);
  if (!authUser) return;

  const body = await readJsonBody(req);
  const prisma = getPrisma();

  const transfer = await prisma.lPTransfer.findFirst({
    where: { id: transferId, dealId },
    include: {
      fromLpActor: { select: { id: true, entityName: true } },
      toLpActor: { select: { id: true, entityName: true } }
    }
  });

  if (!transfer) {
    log(`Transfer not found for approval`, { transferId });
    return sendError(res, 404, "Transfer not found");
  }

  if (transfer.status !== 'PENDING') {
    log(`Cannot approve transfer - wrong status`, { transferId, currentStatus: transfer.status });
    return sendError(res, 400, `Cannot approve transfer with status ${transfer.status}`);
  }

  log(`Approving transfer`, { transferId, fromLp: transfer.fromLpActor.entityName, toLp: transfer.toLpActor.entityName });

  const updated = await prisma.lPTransfer.update({
    where: { id: transferId },
    data: {
      status: 'APPROVED',
      approvedAt: new Date(),
      approvedBy: authUser.id,
      approvedByName: authUser.name,
      approvalDocId: body?.approvalDocId || null
    },
    include: {
      fromLpActor: { select: { id: true, entityName: true, email: true } },
      toLpActor: { select: { id: true, entityName: true, email: true } }
    }
  });

  await createDealEvent(dealId, 'LP_TRANSFER_APPROVED', {
    transferId: transfer.id,
    fromLpName: transfer.fromLpActor.entityName,
    toLpName: transfer.toLpActor.entityName,
    approvedBy: authUser.id,
    approvedByName: authUser.name
  }, { id: authUser.id, name: authUser.name, role: authUser.role });

  log(`Transfer approved successfully`, { transferId, approvedBy: authUser.name });
  sendJson(res, 200, { transfer: updated });
}

/**
 * Complete/Execute an LP transfer (GP only)
 * POST /api/deals/:dealId/lp-transfers/:transferId/complete
 *
 * This updates the actual LP ownership positions:
 * - Reduces fromLp's commitment and ownershipPct
 * - Increases toLp's commitment and ownershipPct
 */
export async function handleCompleteTransfer(req, res, dealId, transferId) {
  log(`Completing LP transfer`, { dealId, transferId });

  // SECURITY: Enforce GP role AND org isolation via deal membership
  const authUser = await requireGPWithDealOrgAccess(req, res, dealId);
  if (!authUser) return;

  const prisma = getPrisma();

  const transfer = await prisma.lPTransfer.findFirst({
    where: { id: transferId, dealId },
    include: {
      fromLpActor: true,
      toLpActor: true
    }
  });

  if (!transfer) {
    log(`Transfer not found for completion`, { transferId });
    return sendError(res, 404, "Transfer not found");
  }

  if (transfer.status !== 'APPROVED') {
    log(`Cannot complete transfer - wrong status`, { transferId, currentStatus: transfer.status });
    return sendError(res, 400, `Cannot complete transfer with status ${transfer.status}. Must be APPROVED first.`);
  }

  // Verify effective date has passed or is today
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const effectiveDate = new Date(transfer.effectiveDate);
  effectiveDate.setHours(0, 0, 0, 0);

  if (effectiveDate > today) {
    log(`Cannot complete transfer - effective date in future`, { transferId, effectiveDate: transfer.effectiveDate.toISOString() });
    return sendError(res, 400, `Cannot complete transfer before effective date (${transfer.effectiveDate.toISOString().split('T')[0]})`);
  }

  log(`Validating transfer amounts`, {
    fromLpCommitment: transfer.fromLpActor.commitment,
    fromLpOwnership: transfer.fromLpActor.ownershipPct,
    transferAmount: transfer.transferAmount,
    transferPct: transfer.transferPct
  });

  // Re-validate that transfer is still valid (LP positions may have changed)
  const validationErrors = validateTransferValues(
    transfer.fromLpActor,
    transfer.transferAmount,
    transfer.transferPct
  );
  if (validationErrors.length > 0) {
    log(`Transfer validation failed on completion`, { errors: validationErrors });
    return sendError(res, 400, "Transfer is no longer valid - LP positions have changed", validationErrors);
  }

  log(`Executing transfer transaction`, { transferId });

  // Execute the transfer atomically
  const [updatedTransfer] = await prisma.$transaction([
    // Update transfer status
    prisma.lPTransfer.update({
      where: { id: transferId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        completedBy: authUser.id,
        completedByName: authUser.name
      },
      include: {
        fromLpActor: { select: { id: true, entityName: true, email: true } },
        toLpActor: { select: { id: true, entityName: true, email: true } }
      }
    }),

    // Reduce fromLp's position
    prisma.lPActor.update({
      where: { id: transfer.fromLpActorId },
      data: {
        commitment: { decrement: transfer.transferAmount },
        ownershipPct: { decrement: transfer.transferPct }
      }
    }),

    // Increase toLp's position
    prisma.lPActor.update({
      where: { id: transfer.toLpActorId },
      data: {
        commitment: { increment: transfer.transferAmount },
        ownershipPct: { increment: transfer.transferPct }
      }
    })
  ]);

  await createDealEvent(dealId, 'LP_TRANSFER_COMPLETED', {
    transferId: transfer.id,
    fromLpActorId: transfer.fromLpActorId,
    fromLpName: transfer.fromLpActor.entityName,
    fromLpNewCommitment: transfer.fromLpActor.commitment - transfer.transferAmount,
    fromLpNewOwnershipPct: transfer.fromLpActor.ownershipPct - transfer.transferPct,
    toLpActorId: transfer.toLpActorId,
    toLpName: transfer.toLpActor.entityName,
    toLpNewCommitment: transfer.toLpActor.commitment + transfer.transferAmount,
    toLpNewOwnershipPct: transfer.toLpActor.ownershipPct + transfer.transferPct,
    transferAmount: transfer.transferAmount,
    transferPct: transfer.transferPct,
    completedBy: authUser.id,
    completedByName: authUser.name
  }, { id: authUser.id, name: authUser.name, role: authUser.role });

  log(`Transfer completed successfully`, {
    transferId,
    fromLpNewCommitment: transfer.fromLpActor.commitment - transfer.transferAmount,
    toLpNewCommitment: transfer.toLpActor.commitment + transfer.transferAmount
  });
  sendJson(res, 200, { transfer: updatedTransfer });
}

/**
 * Cancel an LP transfer
 * POST /api/deals/:dealId/lp-transfers/:transferId/cancel
 * Body: { reason? }
 */
export async function handleCancelTransfer(req, res, dealId, transferId, readJsonBody) {
  log(`Cancelling LP transfer`, { dealId, transferId });

  // SECURITY: Enforce GP role AND org isolation via deal membership
  const authUser = await requireGPWithDealOrgAccess(req, res, dealId);
  if (!authUser) return;

  const body = await readJsonBody(req);
  const prisma = getPrisma();

  const transfer = await prisma.lPTransfer.findFirst({
    where: { id: transferId, dealId },
    include: {
      fromLpActor: { select: { id: true, entityName: true } },
      toLpActor: { select: { id: true, entityName: true } }
    }
  });

  if (!transfer) {
    log(`Transfer not found for cancellation`, { transferId });
    return sendError(res, 404, "Transfer not found");
  }

  if (transfer.status === 'COMPLETED') {
    log(`Cannot cancel completed transfer`, { transferId });
    return sendError(res, 400, "Cannot cancel a completed transfer");
  }

  if (transfer.status === 'CANCELLED') {
    log(`Transfer already cancelled`, { transferId });
    return sendError(res, 400, "Transfer is already cancelled");
  }

  log(`Cancelling transfer`, { transferId, previousStatus: transfer.status, reason: body?.reason });

  const updated = await prisma.lPTransfer.update({
    where: { id: transferId },
    data: {
      status: 'CANCELLED',
      cancelledAt: new Date(),
      cancelledBy: authUser.id,
      cancellationReason: body?.reason || null
    },
    include: {
      fromLpActor: { select: { id: true, entityName: true, email: true } },
      toLpActor: { select: { id: true, entityName: true, email: true } }
    }
  });

  await createDealEvent(dealId, 'LP_TRANSFER_CANCELLED', {
    transferId: transfer.id,
    fromLpName: transfer.fromLpActor.entityName,
    toLpName: transfer.toLpActor.entityName,
    cancelledBy: authUser.id,
    cancelledByName: authUser.name,
    cancellationReason: body?.reason || 'No reason provided'
  }, { id: authUser.id, name: authUser.name, role: authUser.role });

  log(`Transfer cancelled successfully`, { transferId, cancelledBy: authUser.name });
  sendJson(res, 200, { transfer: updated });
}
