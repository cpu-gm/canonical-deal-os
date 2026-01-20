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

// GET /api/notifications
export async function handleListNotifications(req, res, resolveUserId) {
  const userId = resolveUserId(req);
  const url = new URL(req.url, "http://localhost");
  const unreadOnly = url.searchParams.get("unreadOnly") === "true";
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10), 100);
  const prisma = getPrisma();

  try {
    const where = { userId };
    if (unreadOnly) {
      where.isRead = false;
    }

    const notifications = await prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit
    });

    const unreadCount = await prisma.notification.count({
      where: { userId, isRead: false }
    });

    sendJson(res, 200, {
      notifications: notifications.map(n => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        isRead: n.isRead,
        messageId: n.messageId,
        conversationId: n.conversationId,
        dealId: n.dealId,
        taskId: n.taskId,
        sourceUserId: n.sourceUserId,
        sourceUserName: n.sourceUserName,
        createdAt: n.createdAt.toISOString()
      })),
      unreadCount
    });
  } catch (error) {
    console.error("Error listing notifications:", error);
    sendError(res, 500, "Failed to list notifications", error.message);
  }
}

// PATCH /api/notifications/:id/read
export async function handleMarkNotificationRead(req, res, notificationId, resolveUserId) {
  const userId = resolveUserId(req);
  const prisma = getPrisma();

  try {
    const notification = await prisma.notification.findFirst({
      where: { id: notificationId, userId }
    });

    if (!notification) {
      return sendError(res, 404, "Notification not found");
    }

    await prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true, readAt: new Date() }
    });

    sendJson(res, 200, { success: true });
  } catch (error) {
    console.error("Error marking notification as read:", error);
    sendError(res, 500, "Failed to mark notification as read", error.message);
  }
}

// PATCH /api/notifications/read-all
export async function handleMarkAllNotificationsRead(req, res, resolveUserId) {
  const userId = resolveUserId(req);
  const prisma = getPrisma();

  try {
    await prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() }
    });

    sendJson(res, 200, { success: true });
  } catch (error) {
    console.error("Error marking all notifications as read:", error);
    sendError(res, 500, "Failed to mark notifications as read", error.message);
  }
}

// GET /api/activity-feed
export async function handleGetActivityFeed(req, res, resolveUserId, resolveUserRole) {
  const userId = resolveUserId(req);
  const userRole = resolveUserRole(req);
  const url = new URL(req.url, "http://localhost");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20", 10), 50);
  const dealId = url.searchParams.get("dealId");
  const prisma = getPrisma();

  try {
    // Get user's conversations
    const participations = await prisma.conversationParticipant.findMany({
      where: { participantId: userId, leftAt: null },
      select: { conversationId: true }
    });
    const conversationIds = participations.map(p => p.conversationId);

    // Build activity items from multiple sources
    const activities = [];

    // 1. Recent messages in user's conversations (excluding system messages from activity feed)
    const recentMessages = await prisma.message.findMany({
      where: {
        conversationId: { in: conversationIds },
        isDeleted: false,
        contentType: { not: "system" },
        senderId: { not: userId } // Don't show own messages
      },
      include: {
        conversation: {
          select: { name: true, type: true, dealId: true }
        }
      },
      orderBy: { createdAt: "desc" },
      take: limit
    });

    for (const msg of recentMessages) {
      activities.push({
        id: `msg-${msg.id}`,
        type: "message",
        title: `New message in ${msg.conversation.type === "DEAL_THREAD" ? msg.conversation.name : `#${msg.conversation.name}`}`,
        body: msg.content.substring(0, 150),
        actorName: msg.senderName,
        conversationId: msg.conversationId,
        dealId: msg.conversation.dealId,
        timestamp: msg.createdAt.toISOString()
      });
    }

    // 2. Tasks assigned to user
    const recentTasks = await prisma.chatTask.findMany({
      where: {
        OR: [
          { assigneeId: userId },
          { createdById: userId }
        ],
        ...(dealId ? { dealId } : {})
      },
      orderBy: { updatedAt: "desc" },
      take: limit
    });

    for (const task of recentTasks) {
      const isAssigned = task.assigneeId === userId && task.createdById !== userId;
      activities.push({
        id: `task-${task.id}`,
        type: "task",
        title: isAssigned ? `Task assigned to you: ${task.title}` : `Task: ${task.title}`,
        body: task.description?.substring(0, 150) || null,
        status: task.status,
        actorName: task.createdByName,
        dealId: task.dealId,
        taskId: task.id,
        timestamp: task.updatedAt.toISOString()
      });
    }

    // 3. Recent notifications (mentions, etc.)
    const recentNotifications = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit
    });

    for (const notif of recentNotifications) {
      // Avoid duplicates if we already have the message
      if (notif.messageId && activities.some(a => a.id === `msg-${notif.messageId}`)) {
        continue;
      }
      activities.push({
        id: `notif-${notif.id}`,
        type: notif.type,
        title: notif.title,
        body: notif.body,
        actorName: notif.sourceUserName,
        conversationId: notif.conversationId,
        dealId: notif.dealId,
        taskId: notif.taskId,
        isRead: notif.isRead,
        timestamp: notif.createdAt.toISOString()
      });
    }

    // Sort by timestamp and limit
    activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const limitedActivities = activities.slice(0, limit);

    sendJson(res, 200, { activities: limitedActivities });
  } catch (error) {
    console.error("Error getting activity feed:", error);
    sendError(res, 500, "Failed to get activity feed", error.message);
  }
}

// POST /api/tasks
export async function handleCreateTask(req, res, resolveUserId, readJsonBody) {
  const userId = resolveUserId(req);
  const userName = req.headers["x-user-name"] ?? "Anonymous";
  const prisma = getPrisma();

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return sendError(res, 400, "Invalid request body");
  }

  const { title, description, assigneeId, assigneeName, dealId, conversationId, sourceMessageId, priority, dueDate } = body;

  if (!title || title.trim().length === 0) {
    return sendError(res, 400, "Task title is required");
  }

  try {
    const task = await prisma.chatTask.create({
      data: {
        title: title.trim(),
        description: description?.trim() || null,
        assigneeId: assigneeId || null,
        assigneeName: assigneeName || null,
        createdById: userId,
        createdByName: userName,
        dealId: dealId || null,
        conversationId: conversationId || null,
        sourceMessageId: sourceMessageId || null,
        priority: priority || "MEDIUM",
        dueDate: dueDate ? new Date(dueDate) : null
      }
    });

    // Create notification for assignee if different from creator
    if (assigneeId && assigneeId !== userId) {
      await prisma.notification.create({
        data: {
          userId: assigneeId,
          type: "task_assigned",
          title: `New task assigned: ${title}`,
          body: description?.substring(0, 200) || null,
          taskId: task.id,
          dealId: dealId || null,
          sourceUserId: userId,
          sourceUserName: userName
        }
      });
    }

    // If created from a message, add a system message to the conversation
    if (sourceMessageId && conversationId) {
      await prisma.message.create({
        data: {
          conversationId,
          senderId: "system",
          senderName: "System",
          content: `${userName} created a task: "${title}"${assigneeName ? ` (assigned to ${assigneeName})` : ""}`,
          contentType: "task"
        }
      });
    }

    sendJson(res, 201, {
      task: {
        id: task.id,
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        assigneeId: task.assigneeId,
        assigneeName: task.assigneeName,
        createdById: task.createdById,
        createdByName: task.createdByName,
        dealId: task.dealId,
        dueDate: task.dueDate?.toISOString() || null,
        createdAt: task.createdAt.toISOString()
      }
    });
  } catch (error) {
    console.error("Error creating task:", error);
    sendError(res, 500, "Failed to create task", error.message);
  }
}

// GET /api/tasks
export async function handleListTasks(req, res, resolveUserId) {
  const userId = resolveUserId(req);
  const url = new URL(req.url, "http://localhost");
  const status = url.searchParams.get("status");
  const dealId = url.searchParams.get("dealId");
  const assignedToMe = url.searchParams.get("assignedToMe") === "true";
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10), 100);
  const prisma = getPrisma();

  try {
    const where = {};

    if (assignedToMe) {
      where.assigneeId = userId;
    } else {
      // Show tasks user created or is assigned to
      where.OR = [
        { assigneeId: userId },
        { createdById: userId }
      ];
    }

    if (status) {
      where.status = status;
    }

    if (dealId) {
      where.dealId = dealId;
    }

    const tasks = await prisma.chatTask.findMany({
      where,
      orderBy: [
        { status: "asc" },
        { priority: "desc" },
        { createdAt: "desc" }
      ],
      take: limit,
      include: {
        sourceMessage: {
          select: {
            content: true,
            senderName: true
          }
        }
      }
    });

    sendJson(res, 200, {
      tasks: tasks.map(t => ({
        id: t.id,
        title: t.title,
        description: t.description,
        status: t.status,
        priority: t.priority,
        assigneeId: t.assigneeId,
        assigneeName: t.assigneeName,
        createdById: t.createdById,
        createdByName: t.createdByName,
        dealId: t.dealId,
        conversationId: t.conversationId,
        sourceMessage: t.sourceMessage ? {
          content: t.sourceMessage.content.substring(0, 200),
          senderName: t.sourceMessage.senderName
        } : null,
        dueDate: t.dueDate?.toISOString() || null,
        completedAt: t.completedAt?.toISOString() || null,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString()
      }))
    });
  } catch (error) {
    console.error("Error listing tasks:", error);
    sendError(res, 500, "Failed to list tasks", error.message);
  }
}

// PATCH /api/tasks/:id
export async function handleUpdateTask(req, res, taskId, resolveUserId, readJsonBody) {
  const userId = resolveUserId(req);
  const userName = req.headers["x-user-name"] ?? "Anonymous";
  const prisma = getPrisma();

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return sendError(res, 400, "Invalid request body");
  }

  try {
    const task = await prisma.chatTask.findUnique({ where: { id: taskId } });

    if (!task) {
      return sendError(res, 404, "Task not found");
    }

    // Only creator or assignee can update
    if (task.createdById !== userId && task.assigneeId !== userId) {
      return sendError(res, 403, "Not authorized to update this task");
    }

    const updateData = {};
    if (body.title !== undefined) updateData.title = body.title.trim();
    if (body.description !== undefined) updateData.description = body.description?.trim() || null;
    if (body.status !== undefined) {
      updateData.status = body.status;
      if (body.status === "DONE") {
        updateData.completedAt = new Date();
      } else {
        updateData.completedAt = null;
      }
    }
    if (body.priority !== undefined) updateData.priority = body.priority;
    if (body.assigneeId !== undefined) {
      updateData.assigneeId = body.assigneeId;
      updateData.assigneeName = body.assigneeName || null;
    }
    if (body.dueDate !== undefined) {
      updateData.dueDate = body.dueDate ? new Date(body.dueDate) : null;
    }

    const updatedTask = await prisma.chatTask.update({
      where: { id: taskId },
      data: updateData
    });

    // Notify assignee if assignment changed
    if (body.assigneeId && body.assigneeId !== task.assigneeId && body.assigneeId !== userId) {
      await prisma.notification.create({
        data: {
          userId: body.assigneeId,
          type: "task_assigned",
          title: `Task assigned to you: ${updatedTask.title}`,
          body: updatedTask.description?.substring(0, 200) || null,
          taskId: updatedTask.id,
          dealId: updatedTask.dealId || null,
          sourceUserId: userId,
          sourceUserName: userName
        }
      });
    }

    sendJson(res, 200, {
      task: {
        id: updatedTask.id,
        title: updatedTask.title,
        description: updatedTask.description,
        status: updatedTask.status,
        priority: updatedTask.priority,
        assigneeId: updatedTask.assigneeId,
        assigneeName: updatedTask.assigneeName,
        createdById: updatedTask.createdById,
        createdByName: updatedTask.createdByName,
        dealId: updatedTask.dealId,
        dueDate: updatedTask.dueDate?.toISOString() || null,
        completedAt: updatedTask.completedAt?.toISOString() || null,
        createdAt: updatedTask.createdAt.toISOString(),
        updatedAt: updatedTask.updatedAt.toISOString()
      }
    });
  } catch (error) {
    console.error("Error updating task:", error);
    sendError(res, 500, "Failed to update task", error.message);
  }
}

// Helper to create mention notifications when a message is sent
export async function createMentionNotifications(messageId, conversationId, senderId, senderName, mentionedUserIds, dealId = null) {
  const prisma = getPrisma();

  for (const mentionedUserId of mentionedUserIds) {
    if (mentionedUserId === senderId) continue; // Don't notify yourself

    try {
      await prisma.notification.create({
        data: {
          userId: mentionedUserId,
          type: "mention",
          title: `${senderName} mentioned you`,
          body: null,
          messageId,
          conversationId,
          dealId,
          sourceUserId: senderId,
          sourceUserName: senderName
        }
      });
    } catch (error) {
      console.error("Error creating mention notification:", error);
    }
  }
}

// ========== SNOOZE & PREFERENCES (Phase 4: Smart Reminders) ==========

// Maximum snooze duration in days
const MAX_SNOOZE_DAYS = 30;

/**
 * Snooze a notification
 * PATCH /api/notifications/:id/snooze
 * Body: { duration: "1h" | "3h" | "1d" | "3d" | "1w" | "custom", until?: ISO date string }
 */
export async function handleSnoozeNotification(req, res, notificationId, resolveUserId, readJsonBody) {
  const prisma = getPrisma();

  try {
    const userId = resolveUserId(req);
    const body = await readJsonBody(req);
    const { duration, until } = body;

    // Find notification
    const notification = await prisma.notification.findUnique({
      where: { id: notificationId }
    });

    if (!notification) {
      sendError(res, 404, "Notification not found");
      return;
    }

    if (notification.userId !== userId && notification.userId !== "gp-team") {
      sendError(res, 403, "Cannot snooze another user's notification");
      return;
    }

    // Calculate snooze until time
    let snoozedUntil;
    const now = new Date();

    if (until) {
      snoozedUntil = new Date(until);
      // Validate not too far in future
      const maxDate = new Date(now);
      maxDate.setDate(maxDate.getDate() + MAX_SNOOZE_DAYS);
      if (snoozedUntil > maxDate) {
        sendError(res, 400, `Cannot snooze more than ${MAX_SNOOZE_DAYS} days`);
        return;
      }
    } else {
      switch (duration) {
        case "1h":
          snoozedUntil = new Date(now.getTime() + 1 * 60 * 60 * 1000);
          break;
        case "3h":
          snoozedUntil = new Date(now.getTime() + 3 * 60 * 60 * 1000);
          break;
        case "1d":
          snoozedUntil = new Date(now.getTime() + 24 * 60 * 60 * 1000);
          break;
        case "3d":
          snoozedUntil = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
          break;
        case "1w":
          snoozedUntil = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
          break;
        default:
          sendError(res, 400, "Invalid duration. Use: 1h, 3h, 1d, 3d, 1w, or custom with 'until'");
          return;
      }
    }

    // Update notification
    const updated = await prisma.notification.update({
      where: { id: notificationId },
      data: { snoozedUntil }
    });

    sendJson(res, 200, {
      id: updated.id,
      snoozedUntil: updated.snoozedUntil?.toISOString(),
      message: `Notification snoozed until ${snoozedUntil.toLocaleString()}`
    });
  } catch (error) {
    console.error("Error snoozing notification:", error);
    sendError(res, 500, "Failed to snooze notification", error.message);
  }
}

/**
 * Dismiss a notification (mark as read with reason)
 * PATCH /api/notifications/:id/dismiss
 * Body: { reason?: "completed" | "not_relevant" | "other" }
 */
export async function handleDismissNotification(req, res, notificationId, resolveUserId, readJsonBody) {
  const prisma = getPrisma();

  try {
    const userId = resolveUserId(req);
    const body = await readJsonBody(req);
    const { reason } = body;

    // Find notification
    const notification = await prisma.notification.findUnique({
      where: { id: notificationId }
    });

    if (!notification) {
      sendError(res, 404, "Notification not found");
      return;
    }

    if (notification.userId !== userId && notification.userId !== "gp-team") {
      sendError(res, 403, "Cannot dismiss another user's notification");
      return;
    }

    // Update notification
    const updated = await prisma.notification.update({
      where: { id: notificationId },
      data: {
        isRead: true,
        snoozedUntil: null // Clear any snooze
      }
    });

    console.log(`[Notifications] Notification ${notificationId} dismissed by ${userId}, reason: ${reason || "none"}`);

    sendJson(res, 200, {
      id: updated.id,
      isRead: true,
      message: "Notification dismissed"
    });
  } catch (error) {
    console.error("Error dismissing notification:", error);
    sendError(res, 500, "Failed to dismiss notification", error.message);
  }
}

/**
 * Get user's notification preferences
 * GET /api/notification-preferences
 */
export async function handleGetNotificationPreferences(req, res, resolveUserId) {
  const prisma = getPrisma();

  try {
    const userId = resolveUserId(req);

    let prefs = await prisma.notificationPreference.findUnique({
      where: { userId }
    });

    // Return defaults if no preferences set
    if (!prefs) {
      prefs = {
        userId,
        emailEnabled: true,
        inAppEnabled: true,
        reminderDays: "[7,3,1]",
        escalateAfterDays: 2,
        quietStart: null,
        quietEnd: null
      };
    }

    sendJson(res, 200, {
      emailEnabled: prefs.emailEnabled,
      inAppEnabled: prefs.inAppEnabled,
      reminderDays: JSON.parse(prefs.reminderDays),
      escalateAfterDays: prefs.escalateAfterDays,
      quietStart: prefs.quietStart,
      quietEnd: prefs.quietEnd
    });
  } catch (error) {
    console.error("Error getting notification preferences:", error);
    sendError(res, 500, "Failed to get preferences", error.message);
  }
}

/**
 * Update user's notification preferences
 * PATCH /api/notification-preferences
 * Body: { emailEnabled?, inAppEnabled?, reminderDays?, escalateAfterDays?, quietStart?, quietEnd? }
 */
export async function handleUpdateNotificationPreferences(req, res, resolveUserId, readJsonBody) {
  const prisma = getPrisma();

  try {
    const userId = resolveUserId(req);
    const body = await readJsonBody(req);

    const {
      emailEnabled,
      inAppEnabled,
      reminderDays,
      escalateAfterDays,
      quietStart,
      quietEnd
    } = body;

    // Build update data
    const updateData = {};

    if (typeof emailEnabled === "boolean") {
      updateData.emailEnabled = emailEnabled;
    }
    if (typeof inAppEnabled === "boolean") {
      updateData.inAppEnabled = inAppEnabled;
    }
    if (Array.isArray(reminderDays)) {
      // Validate reminder days are positive integers
      if (!reminderDays.every(d => Number.isInteger(d) && d > 0 && d <= 30)) {
        sendError(res, 400, "Reminder days must be positive integers <= 30");
        return;
      }
      updateData.reminderDays = JSON.stringify(reminderDays);
    }
    if (typeof escalateAfterDays === "number") {
      if (escalateAfterDays < 1 || escalateAfterDays > 30) {
        sendError(res, 400, "Escalate after days must be between 1 and 30");
        return;
      }
      updateData.escalateAfterDays = escalateAfterDays;
    }
    if (quietStart !== undefined) {
      // Validate time format HH:MM (00-23 for hours, 00-59 for minutes)
      if (quietStart && !/^([01]\d|2[0-3]):[0-5]\d$/.test(quietStart)) {
        sendError(res, 400, "Quiet start must be in HH:MM format (00:00-23:59)");
        return;
      }
      updateData.quietStart = quietStart || null;
    }
    if (quietEnd !== undefined) {
      if (quietEnd && !/^([01]\d|2[0-3]):[0-5]\d$/.test(quietEnd)) {
        sendError(res, 400, "Quiet end must be in HH:MM format (00:00-23:59)");
        return;
      }
      updateData.quietEnd = quietEnd || null;
    }

    // Upsert preferences
    const prefs = await prisma.notificationPreference.upsert({
      where: { userId },
      create: {
        userId,
        ...updateData
      },
      update: updateData
    });

    sendJson(res, 200, {
      emailEnabled: prefs.emailEnabled,
      inAppEnabled: prefs.inAppEnabled,
      reminderDays: JSON.parse(prefs.reminderDays),
      escalateAfterDays: prefs.escalateAfterDays,
      quietStart: prefs.quietStart,
      quietEnd: prefs.quietEnd,
      message: "Preferences updated"
    });
  } catch (error) {
    console.error("Error updating notification preferences:", error);
    sendError(res, 500, "Failed to update preferences", error.message);
  }
}
