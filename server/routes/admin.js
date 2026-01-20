import { getPrisma } from "../db.js";
import { extractAuthUser } from "./auth.js";

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
 * Check if user is an admin
 */
async function requireAdmin(req, res) {
  const user = await extractAuthUser(req);

  if (!user) {
    sendError(res, 401, "Not authenticated");
    return null;
  }

  if (user.role !== "Admin") {
    sendError(res, 403, "Admin access required");
    return null;
  }

  return user;
}

/**
 * GET /api/admin/verification-queue
 * Get pending verification requests for the admin's organization
 */
export async function handleGetVerificationQueue(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    const prisma = getPrisma();

    const requests = await prisma.userVerificationRequest.findMany({
      where: {
        status: "PENDING",
        user: {
          organizationId: admin.organizationId
        }
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            createdAt: true,
            organization: {
              select: {
                id: true,
                name: true
              }
            }
          }
        }
      },
      orderBy: { createdAt: "asc" }
    });

    return sendJson(res, 200, {
      requests: requests.map(r => ({
        id: r.id,
        userId: r.userId,
        requestedRole: r.requestedRole,
        status: r.status,
        createdAt: r.createdAt,
        user: r.user
      }))
    });
  } catch (error) {
    console.error("Get verification queue error:", error);
    return sendError(res, 500, "Failed to get verification queue");
  }
}

/**
 * GET /api/admin/users
 * Get all users in the admin's organization
 */
export async function handleGetUsers(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    const prisma = getPrisma();

    const users = await prisma.authUser.findMany({
      where: {
        organizationId: admin.organizationId
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        createdAt: true,
        verifiedAt: true,
        verifiedBy: true
      },
      orderBy: { createdAt: "desc" }
    });

    return sendJson(res, 200, { users });
  } catch (error) {
    console.error("Get users error:", error);
    return sendError(res, 500, "Failed to get users");
  }
}

/**
 * POST /api/admin/verification-requests/:id/approve
 * Approve a verification request
 */
export async function handleApproveVerification(req, res, requestId, readJsonBody) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    const prisma = getPrisma();

    // Get the request
    const request = await prisma.userVerificationRequest.findUnique({
      where: { id: requestId },
      include: {
        user: true
      }
    });

    if (!request) {
      return sendError(res, 404, "Verification request not found");
    }

    // Check same organization
    if (request.user.organizationId !== admin.organizationId) {
      return sendError(res, 403, "Cannot approve users from other organizations");
    }

    if (request.status !== "PENDING") {
      return sendError(res, 400, "Request has already been processed");
    }

    // Update request
    await prisma.userVerificationRequest.update({
      where: { id: requestId },
      data: {
        status: "APPROVED",
        reviewedBy: admin.id,
        reviewedAt: new Date()
      }
    });

    // Update user status
    const updatedUser = await prisma.authUser.update({
      where: { id: request.userId },
      data: {
        status: "ACTIVE",
        verifiedAt: new Date(),
        verifiedBy: admin.id
      }
    });

    // Log the permission change
    await prisma.permissionAuditLog.create({
      data: {
        actorId: admin.id,
        actorName: admin.name,
        targetUserId: request.userId,
        targetUserName: request.user.name,
        action: "VERIFICATION_APPROVED",
        beforeValue: JSON.stringify({ status: "PENDING", role: request.requestedRole }),
        afterValue: JSON.stringify({ status: "ACTIVE", role: updatedUser.role }),
        ipAddress: req.headers["x-forwarded-for"] || req.socket?.remoteAddress
      }
    });

    return sendJson(res, 200, {
      message: "User approved successfully",
      userId: request.userId
    });
  } catch (error) {
    console.error("Approve verification error:", error);
    return sendError(res, 500, "Failed to approve verification");
  }
}

/**
 * POST /api/admin/verification-requests/:id/reject
 * Reject a verification request
 */
export async function handleRejectVerification(req, res, requestId, readJsonBody) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    const body = await readJsonBody(req);
    const { note } = body || {};

    const prisma = getPrisma();

    // Get the request
    const request = await prisma.userVerificationRequest.findUnique({
      where: { id: requestId },
      include: {
        user: true
      }
    });

    if (!request) {
      return sendError(res, 404, "Verification request not found");
    }

    // Check same organization
    if (request.user.organizationId !== admin.organizationId) {
      return sendError(res, 403, "Cannot reject users from other organizations");
    }

    if (request.status !== "PENDING") {
      return sendError(res, 400, "Request has already been processed");
    }

    // Update request
    await prisma.userVerificationRequest.update({
      where: { id: requestId },
      data: {
        status: "REJECTED",
        reviewedBy: admin.id,
        reviewedAt: new Date(),
        reviewNote: note || null
      }
    });

    // Update user status to suspended
    await prisma.authUser.update({
      where: { id: request.userId },
      data: {
        status: "SUSPENDED"
      }
    });

    // Log the permission change
    await prisma.permissionAuditLog.create({
      data: {
        actorId: admin.id,
        actorName: admin.name,
        targetUserId: request.userId,
        targetUserName: request.user.name,
        action: "VERIFICATION_REJECTED",
        beforeValue: JSON.stringify({ status: "PENDING", role: request.requestedRole }),
        afterValue: JSON.stringify({ status: "SUSPENDED" }),
        reason: note || null,
        ipAddress: req.headers["x-forwarded-for"] || req.socket?.remoteAddress
      }
    });

    return sendJson(res, 200, {
      message: "User rejected",
      userId: request.userId
    });
  } catch (error) {
    console.error("Reject verification error:", error);
    return sendError(res, 500, "Failed to reject verification");
  }
}

/**
 * PATCH /api/admin/users/:id/role
 * Update a user's role
 */
export async function handleUpdateUserRole(req, res, userId, readJsonBody) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    const body = await readJsonBody(req);
    const { role } = body || {};

    if (!role) {
      return sendError(res, 400, "Role is required");
    }

    const validRoles = ["GP", "GP Analyst", "Lender", "Counsel", "Regulator", "Auditor", "LP", "Admin"];
    if (!validRoles.includes(role)) {
      return sendError(res, 400, `Invalid role. Must be one of: ${validRoles.join(", ")}`);
    }

    const prisma = getPrisma();

    // Get the user
    const user = await prisma.authUser.findUnique({
      where: { id: userId }
    });

    if (!user) {
      return sendError(res, 404, "User not found");
    }

    // Check same organization
    if (user.organizationId !== admin.organizationId) {
      return sendError(res, 403, "Cannot update users from other organizations");
    }

    const previousRole = user.role;

    // Update role
    const updatedUser = await prisma.authUser.update({
      where: { id: userId },
      data: { role }
    });

    // Log the permission change
    await prisma.permissionAuditLog.create({
      data: {
        actorId: admin.id,
        actorName: admin.name,
        targetUserId: userId,
        targetUserName: user.name,
        action: "ROLE_CHANGE",
        beforeValue: JSON.stringify({ role: previousRole }),
        afterValue: JSON.stringify({ role: updatedUser.role }),
        ipAddress: req.headers["x-forwarded-for"] || req.socket?.remoteAddress
      }
    });

    return sendJson(res, 200, {
      message: "Role updated successfully",
      user: {
        id: updatedUser.id,
        role: updatedUser.role
      }
    });
  } catch (error) {
    console.error("Update user role error:", error);
    return sendError(res, 500, "Failed to update user role");
  }
}

/**
 * PATCH /api/admin/users/:id/status
 * Update a user's status (suspend/activate)
 */
export async function handleUpdateUserStatus(req, res, userId, readJsonBody) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    const body = await readJsonBody(req);
    const { status } = body || {};

    if (!status) {
      return sendError(res, 400, "Status is required");
    }

    const validStatuses = ["ACTIVE", "SUSPENDED"];
    if (!validStatuses.includes(status)) {
      return sendError(res, 400, `Invalid status. Must be one of: ${validStatuses.join(", ")}`);
    }

    const prisma = getPrisma();

    // Get the user
    const user = await prisma.authUser.findUnique({
      where: { id: userId }
    });

    if (!user) {
      return sendError(res, 404, "User not found");
    }

    // Check same organization
    if (user.organizationId !== admin.organizationId) {
      return sendError(res, 403, "Cannot update users from other organizations");
    }

    // Prevent self-suspension
    if (userId === admin.id && status === "SUSPENDED") {
      return sendError(res, 400, "Cannot suspend your own account");
    }

    const previousStatus = user.status;

    // Update status
    const updatedUser = await prisma.authUser.update({
      where: { id: userId },
      data: {
        status,
        verifiedAt: status === "ACTIVE" && !user.verifiedAt ? new Date() : user.verifiedAt,
        verifiedBy: status === "ACTIVE" && !user.verifiedBy ? admin.id : user.verifiedBy
      }
    });

    // Log the permission change
    await prisma.permissionAuditLog.create({
      data: {
        actorId: admin.id,
        actorName: admin.name,
        targetUserId: userId,
        targetUserName: user.name,
        action: "STATUS_CHANGE",
        beforeValue: JSON.stringify({ status: previousStatus }),
        afterValue: JSON.stringify({ status: updatedUser.status }),
        ipAddress: req.headers["x-forwarded-for"] || req.socket?.remoteAddress
      }
    });

    return sendJson(res, 200, {
      message: `User ${status === "ACTIVE" ? "activated" : "suspended"} successfully`,
      user: {
        id: updatedUser.id,
        status: updatedUser.status
      }
    });
  } catch (error) {
    console.error("Update user status error:", error);
    return sendError(res, 500, "Failed to update user status");
  }
}
