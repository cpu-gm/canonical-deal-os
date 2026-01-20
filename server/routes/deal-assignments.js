import { getPrisma } from "../db.js";
import { extractAuthUser } from "./auth.js";
import { readStore } from "../store.js";

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
 * Check organization isolation for a deal
 * Returns authUser if access granted, null if denied (response already sent)
 */
async function requireDealOrgAccess(req, res, dealId) {
  const authUser = await extractAuthUser(req);
  if (!authUser) {
    sendError(res, 401, "Not authenticated");
    return null;
  }

  const store = await readStore();
  const record = store.dealIndex.find((item) => item.id === dealId);

  if (!record) {
    sendError(res, 404, "Deal not found");
    return null;
  }

  // Enforce org isolation
  if (record.organizationId && record.organizationId !== authUser.organizationId) {
    sendError(res, 403, "Access denied - deal belongs to different organization");
    return null;
  }

  return authUser;
}

/**
 * Get all assignments for a deal
 */
export async function handleListDealAssignments(req, res, dealId) {
  // Organization isolation check
  const authUser = await requireDealOrgAccess(req, res, dealId);
  if (!authUser) return;

  const prisma = getPrisma();

  const assignments = await prisma.dealAssignment.findMany({
    where: {
      dealId,
      removedAt: null
    },
    orderBy: { assignedAt: "asc" }
  });

  sendJson(res, 200, { assignments });
}

/**
 * Assign an analyst to a deal (GP only)
 */
export async function handleAssignAnalyst(req, res, dealId, readJsonBody, resolveUserId, resolveActorRole) {
  // Organization isolation check
  const authUser = await requireDealOrgAccess(req, res, dealId);
  if (!authUser) return;

  // Only GP or Admin can assign analysts
  if (!['GP', 'Admin'].includes(authUser.role)) {
    return sendError(res, 403, "Only GP or Admin can assign analysts to deals");
  }

  const body = await readJsonBody(req);
  if (!body?.userId) {
    return sendError(res, 400, "userId is required");
  }

  const prisma = getPrisma();
  const assignedBy = resolveUserId(req);

  try {
    // Check if already assigned
    const existing = await prisma.dealAssignment.findUnique({
      where: {
        dealId_userId: {
          dealId,
          userId: body.userId
        }
      }
    });

    if (existing && !existing.removedAt) {
      return sendError(res, 409, "User is already assigned to this deal");
    }

    // If previously removed, reactivate
    if (existing && existing.removedAt) {
      const updated = await prisma.dealAssignment.update({
        where: { id: existing.id },
        data: {
          removedAt: null,
          assignedBy,
          assignedAt: new Date(),
          userName: body.userName ?? existing.userName,
          role: body.role ?? "analyst"
        }
      });

      // SECURITY: V9 - Audit log for analyst access control change
      await prisma.permissionAuditLog.create({
        data: {
          actorId: authUser.id,
          actorName: authUser.name || null,
          targetUserId: body.userId,
          targetUserName: body.userName || existing.userName || null,
          action: 'DEAL_ASSIGNMENT_REACTIVATED',
          afterValue: JSON.stringify({
            dealId,
            analystId: body.userId,
            analystName: body.userName || existing.userName,
            role: body.role ?? "analyst"
          }),
          ipAddress: req.headers["x-forwarded-for"] || req.socket?.remoteAddress || null
        }
      });

      return sendJson(res, 200, { assignment: updated });
    }

    // Create new assignment
    const assignment = await prisma.dealAssignment.create({
      data: {
        dealId,
        userId: body.userId,
        userName: body.userName ?? null,
        role: body.role ?? "analyst",
        assignedBy
      }
    });

    // SECURITY: V9 - Audit log for analyst access control change
    await prisma.permissionAuditLog.create({
      data: {
        actorId: authUser.id,
        actorName: authUser.name || null,
        targetUserId: body.userId,
        targetUserName: body.userName || null,
        action: 'DEAL_ASSIGNMENT_CREATED',
        afterValue: JSON.stringify({
          dealId,
          analystId: body.userId,
          analystName: body.userName,
          role: body.role ?? "analyst"
        }),
        ipAddress: req.headers["x-forwarded-for"] || req.socket?.remoteAddress || null
      }
    });

    sendJson(res, 201, { assignment });
  } catch (error) {
    console.error("Failed to assign analyst:", error);
    sendError(res, 500, "Failed to assign analyst");
  }
}

/**
 * Remove an analyst from a deal (GP only)
 */
export async function handleUnassignAnalyst(req, res, dealId, userId, resolveActorRole) {
  // Organization isolation check
  const authUser = await requireDealOrgAccess(req, res, dealId);
  if (!authUser) return;

  // Only GP or Admin can unassign analysts
  if (!['GP', 'Admin'].includes(authUser.role)) {
    return sendError(res, 403, "Only GP or Admin can unassign analysts from deals");
  }

  const prisma = getPrisma();

  try {
    const assignment = await prisma.dealAssignment.findUnique({
      where: {
        dealId_userId: {
          dealId,
          userId
        }
      }
    });

    if (!assignment || assignment.removedAt) {
      return sendError(res, 404, "Assignment not found");
    }

    // Soft delete
    await prisma.dealAssignment.update({
      where: { id: assignment.id },
      data: { removedAt: new Date() }
    });

    // SECURITY: V9 - Audit log for analyst access control change
    await prisma.permissionAuditLog.create({
      data: {
        actorId: authUser.id,
        actorName: authUser.name || null,
        targetUserId: userId,
        targetUserName: assignment.userName || null,
        action: 'DEAL_ASSIGNMENT_REMOVED',
        beforeValue: JSON.stringify({
          dealId,
          analystId: userId,
          analystName: assignment.userName,
          role: assignment.role
        }),
        ipAddress: req.headers["x-forwarded-for"] || req.socket?.remoteAddress || null
      }
    });

    sendJson(res, 200, { success: true });
  } catch (error) {
    console.error("Failed to unassign analyst:", error);
    sendError(res, 500, "Failed to unassign analyst");
  }
}

/**
 * Get all deals assigned to a specific user
 */
export async function getAssignedDealIds(userId) {
  const prisma = getPrisma();

  const assignments = await prisma.dealAssignment.findMany({
    where: {
      userId,
      removedAt: null
    },
    select: { dealId: true }
  });

  return assignments.map(a => a.dealId);
}

/**
 * Check if a user is assigned to a specific deal
 */
export async function isUserAssignedToDeal(userId, dealId) {
  const prisma = getPrisma();

  const assignment = await prisma.dealAssignment.findUnique({
    where: {
      dealId_userId: {
        dealId,
        userId
      }
    }
  });

  return assignment && !assignment.removedAt;
}

/**
 * Check if user has access to a deal based on role
 * GP sees all, GP Analyst sees only assigned
 */
export async function checkDealAccess(role, userId, dealId) {
  // GP, Admin, Lender, Regulator, Auditor can see all deals
  if (['GP', 'Admin', 'Lender', 'Regulator', 'Auditor'].includes(role)) {
    return { allowed: true };
  }

  // GP Analyst and Counsel can only see assigned deals
  if (role === 'GP Analyst' || role === 'Counsel') {
    const isAssigned = await isUserAssignedToDeal(userId, dealId);
    if (!isAssigned) {
      return {
        allowed: false,
        reason: `${role} can only access assigned deals`
      };
    }
    return { allowed: true };
  }

  // LP has their own access logic (via LPActor)
  if (role === 'LP') {
    // LP access is handled separately via LPActor table
    return { allowed: true };
  }

  return { allowed: false, reason: 'Unknown role' };
}
