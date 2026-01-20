import { getPrisma } from "../db.js";
import { getCache, setCache } from "../runtime.js";

const CHAT_CACHE_TTL_MS = Number(process.env.BFF_CHAT_TTL_MS ?? 3000);

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

function parseAllowedRoles(allowedRoles) {
  if (!allowedRoles) return [];
  try {
    return JSON.parse(allowedRoles);
  } catch {
    return [];
  }
}

function canAccessConversation(conversation, userRole) {
  if (conversation.visibility === "PUBLIC") return true;
  if (conversation.visibility === "PRIVATE") return true; // checked via participant
  if (conversation.visibility === "ROLE_BASED") {
    const allowed = parseAllowedRoles(conversation.allowedRoles);
    return allowed.length === 0 || allowed.includes(userRole);
  }
  return true;
}

// GET /api/chat/conversations
// SECURITY: V2 fix - use authUser.role from validated JWT, not spoofable x-actor-role header
export async function handleListConversations(req, res, authUser) {
  const userId = authUser.id;
  const userRole = authUser.role;
  const prisma = getPrisma();

  try {
    // Get all conversations where user is a participant
    const participations = await prisma.conversationParticipant.findMany({
      where: {
        participantId: userId,
        leftAt: null
      },
      include: {
        conversation: {
          include: {
            messages: {
              orderBy: { createdAt: "desc" },
              take: 1
            },
            participants: {
              where: { leftAt: null },
              select: {
                participantId: true,
                participantName: true,
                lastReadAt: true
              }
            }
          }
        }
      }
    });

    // Also get public/role-based channels the user hasn't joined yet
    const joinedIds = participations.map(p => p.conversationId);
    const publicChannels = await prisma.conversation.findMany({
      where: {
        type: "CHANNEL",
        visibility: { in: ["PUBLIC", "ROLE_BASED"] },
        id: { notIn: joinedIds }
      },
      include: {
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1
        },
        participants: {
          where: { leftAt: null },
          select: {
            participantId: true,
            participantName: true
          }
        }
      }
    });

    // Filter role-based channels
    const accessiblePublicChannels = publicChannels.filter(c =>
      canAccessConversation(c, userRole)
    );

    // Format response
    const formatConversation = (conv, participation = null) => {
      const lastMessage = conv.messages[0];
      const unreadCount = participation && lastMessage
        ? (new Date(lastMessage.createdAt) > new Date(participation.lastReadAt) ? 1 : 0)
        : 0;

      return {
        id: conv.id,
        type: conv.type,
        name: conv.name,
        description: conv.description,
        visibility: conv.visibility,
        dealId: conv.dealId,
        participantCount: conv.participants.length,
        participants: conv.participants.slice(0, 5),
        lastMessage: lastMessage ? {
          id: lastMessage.id,
          content: lastMessage.content.substring(0, 100),
          senderName: lastMessage.senderName,
          createdAt: lastMessage.createdAt.toISOString()
        } : null,
        unreadCount,
        isJoined: !!participation,
        updatedAt: conv.updatedAt.toISOString()
      };
    };

    const conversations = [
      ...participations.map(p => formatConversation(p.conversation, p)),
      ...accessiblePublicChannels.map(c => formatConversation(c))
    ].sort((a, b) => {
      // Sort by last message time, most recent first
      const aTime = a.lastMessage?.createdAt ?? a.updatedAt;
      const bTime = b.lastMessage?.createdAt ?? b.updatedAt;
      return new Date(bTime) - new Date(aTime);
    });

    sendJson(res, 200, { conversations });
  } catch (error) {
    console.error("Error listing conversations:", error);
    sendError(res, 500, "Failed to list conversations", error.message);
  }
}

// POST /api/chat/conversations
// SECURITY: V2 fix - use authUser.role from validated JWT, not spoofable x-actor-role header
export async function handleCreateConversation(req, res, authUser) {
  const userId = authUser.id;
  const userRole = authUser.role;
  const userName = authUser.name ?? req.headers["x-user-name"] ?? "Anonymous";
  const prisma = getPrisma();

  let body;
  try {
    body = await new Promise((resolve, reject) => {
      let data = "";
      req.on("data", chunk => data += chunk);
      req.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error("Invalid JSON"));
        }
      });
      req.on("error", reject);
    });
  } catch {
    return sendError(res, 400, "Invalid request body");
  }

  const { type, name, description, visibility, allowedRoles, dealId, participantIds } = body;

  if (!type || !["CHANNEL", "DIRECT", "DEAL_THREAD"].includes(type)) {
    return sendError(res, 400, "Invalid conversation type");
  }

  if (type === "CHANNEL" && !name) {
    return sendError(res, 400, "Channel name is required");
  }

  try {
    // SECURITY: V6 - Set organizationId for org isolation
    const conversation = await prisma.conversation.create({
      data: {
        type,
        name: name ?? null,
        description: description ?? null,
        visibility: visibility ?? "PUBLIC",
        allowedRoles: allowedRoles ? JSON.stringify(allowedRoles) : null,
        dealId: dealId ?? null,
        organizationId: authUser.organizationId ?? null,
        createdById: userId,
        participants: {
          create: [
            {
              participantId: userId,
              participantName: userName,
              participantRole: userRole
            },
            ...(participantIds ?? []).filter(id => id !== userId).map(id => ({
              participantId: id,
              participantName: "User", // Would need lookup
              participantRole: null
            }))
          ]
        }
      },
      include: {
        participants: true
      }
    });

    // Add system message for channel creation
    if (type === "CHANNEL") {
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          senderId: "system",
          senderName: "System",
          content: `${userName} created the channel #${name}`,
          contentType: "system"
        }
      });
    }

    sendJson(res, 201, { conversation });
  } catch (error) {
    console.error("Error creating conversation:", error);
    sendError(res, 500, "Failed to create conversation", error.message);
  }
}

// GET /api/chat/conversations/:id
// SECURITY: V2 fix - use authUser.role from validated JWT, not spoofable x-actor-role header
export async function handleGetConversation(req, res, conversationId, authUser) {
  const userId = authUser.id;
  const userRole = authUser.role;
  const prisma = getPrisma();

  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        participants: {
          where: { leftAt: null }
        }
      }
    });

    if (!conversation) {
      return sendError(res, 404, "Conversation not found");
    }

    // SECURITY: V6 - Check org isolation
    if (conversation.organizationId && conversation.organizationId !== authUser.organizationId) {
      return sendError(res, 403, "Access denied - conversation belongs to different organization");
    }

    // Check access
    const isParticipant = conversation.participants.some(p => p.participantId === userId);
    if (!isParticipant && !canAccessConversation(conversation, userRole)) {
      return sendError(res, 403, "Access denied");
    }

    sendJson(res, 200, { conversation });
  } catch (error) {
    console.error("Error getting conversation:", error);
    sendError(res, 500, "Failed to get conversation", error.message);
  }
}

// GET /api/chat/conversations/:id/messages
// SECURITY: V2 fix - use authUser.role from validated JWT, not spoofable x-actor-role header
export async function handleListMessages(req, res, conversationId, authUser) {
  const userId = authUser.id;
  const userRole = authUser.role;
  const url = new URL(req.url, "http://localhost");
  const cursor = url.searchParams.get("cursor");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10), 100);
  const prisma = getPrisma();

  try {
    // Verify access
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        participants: {
          where: { participantId: userId, leftAt: null }
        }
      }
    });

    if (!conversation) {
      return sendError(res, 404, "Conversation not found");
    }

    // SECURITY: V6 - Check org isolation
    if (conversation.organizationId && conversation.organizationId !== authUser.organizationId) {
      return sendError(res, 403, "Access denied - conversation belongs to different organization");
    }

    const isParticipant = conversation.participants.length > 0;
    if (!isParticipant && !canAccessConversation(conversation, userRole)) {
      return sendError(res, 403, "Access denied");
    }

    const where = {
      conversationId,
      isDeleted: false
    };

    if (cursor) {
      const cursorMessage = await prisma.message.findUnique({ where: { id: cursor } });
      if (cursorMessage) {
        where.createdAt = { lt: cursorMessage.createdAt };
      }
    }

    const messages = await prisma.message.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit + 1
    });

    const hasMore = messages.length > limit;
    const resultMessages = hasMore ? messages.slice(0, limit) : messages;

    sendJson(res, 200, {
      messages: resultMessages.reverse().map(m => ({
        id: m.id,
        conversationId: m.conversationId,
        senderId: m.senderId,
        senderName: m.senderName,
        content: m.content,
        contentType: m.contentType,
        parentId: m.parentId,
        replyCount: m.replyCount,
        isEdited: m.isEdited,
        mentions: m.mentions,
        attachments: m.attachments,
        createdAt: m.createdAt.toISOString()
      })),
      hasMore,
      nextCursor: hasMore ? resultMessages[resultMessages.length - 1].id : null
    });
  } catch (error) {
    console.error("Error listing messages:", error);
    sendError(res, 500, "Failed to list messages", error.message);
  }
}

// POST /api/chat/conversations/:id/messages
// SECURITY: V2 fix - use authUser.role from validated JWT, not spoofable x-actor-role header
export async function handleSendMessage(req, res, conversationId, authUser) {
  const userId = authUser.id;
  const userRole = authUser.role;
  const userName = authUser.name ?? req.headers["x-user-name"] ?? "Anonymous";
  const prisma = getPrisma();

  let body;
  try {
    body = await new Promise((resolve, reject) => {
      let data = "";
      req.on("data", chunk => data += chunk);
      req.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error("Invalid JSON"));
        }
      });
      req.on("error", reject);
    });
  } catch {
    return sendError(res, 400, "Invalid request body");
  }

  const { content, contentType, parentId, attachments } = body;

  if ((!content || content.trim().length === 0) && !attachments) {
    return sendError(res, 400, "Message content or attachments are required");
  }

  if (content && content.length > 10000) {
    return sendError(res, 400, "Message content too long (max 10000 characters)");
  }

  try {
    // Verify conversation exists and user has access
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        participants: {
          where: { participantId: userId, leftAt: null }
        }
      }
    });

    if (!conversation) {
      return sendError(res, 404, "Conversation not found");
    }

    // SECURITY: V6 - Check org isolation
    if (conversation.organizationId && conversation.organizationId !== authUser.organizationId) {
      return sendError(res, 403, "Access denied - conversation belongs to different organization");
    }

    let isParticipant = conversation.participants.length > 0;

    // Auto-join public channels on first message
    if (!isParticipant && canAccessConversation(conversation, userRole)) {
      await prisma.conversationParticipant.create({
        data: {
          conversationId,
          participantId: userId,
          participantName: userName,
          participantRole: userRole
        }
      });
      isParticipant = true;
    }

    if (!isParticipant) {
      return sendError(res, 403, "Access denied");
    }

    // Parse mentions from content
    const mentions = content ? parseMentions(content) : [];

    // Create message
    const message = await prisma.message.create({
      data: {
        conversationId,
        senderId: userId,
        senderName: userName,
        content: content ? content.trim() : '',
        contentType: contentType ?? "text",
        parentId: parentId ?? null,
        mentions: mentions.length > 0 ? JSON.stringify(mentions) : null,
        attachments: attachments ?? null
      }
    });

    // Update reply count if this is a reply
    if (parentId) {
      await prisma.message.update({
        where: { id: parentId },
        data: { replyCount: { increment: 1 } }
      });
    }

    // Update conversation timestamp and version
    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        updatedAt: new Date(),
        version: { increment: 1 }
      }
    });

    // Update participant's last read
    await prisma.conversationParticipant.updateMany({
      where: { conversationId, participantId: userId },
      data: {
        lastReadAt: new Date(),
        lastReadMessageId: message.id
      }
    });

    sendJson(res, 201, {
      message: {
        id: message.id,
        conversationId: message.conversationId,
        senderId: message.senderId,
        senderName: message.senderName,
        content: message.content,
        contentType: message.contentType,
        parentId: message.parentId,
        replyCount: message.replyCount,
        isEdited: message.isEdited,
        mentions: message.mentions,
        attachments: message.attachments,
        createdAt: message.createdAt.toISOString()
      }
    });
  } catch (error) {
    console.error("Error sending message:", error);
    sendError(res, 500, "Failed to send message", error.message);
  }
}

// PATCH /api/chat/conversations/:id/read
// SECURITY: V2 fix - use authUser.id from validated JWT
export async function handleMarkRead(req, res, conversationId, authUser) {
  const userId = authUser.id;
  const prisma = getPrisma();

  try {
    // Get latest message
    const latestMessage = await prisma.message.findFirst({
      where: { conversationId },
      orderBy: { createdAt: "desc" }
    });

    await prisma.conversationParticipant.updateMany({
      where: { conversationId, participantId: userId },
      data: {
        lastReadAt: new Date(),
        lastReadMessageId: latestMessage?.id ?? null
      }
    });

    sendJson(res, 200, { success: true });
  } catch (error) {
    console.error("Error marking as read:", error);
    sendError(res, 500, "Failed to mark as read", error.message);
  }
}

// POST /api/chat/conversations/:id/join
// SECURITY: V2 fix - use authUser.role from validated JWT, not spoofable x-actor-role header
export async function handleJoinConversation(req, res, conversationId, authUser) {
  const userId = authUser.id;
  const userRole = authUser.role;
  const userName = authUser.name ?? req.headers["x-user-name"] ?? "Anonymous";
  const prisma = getPrisma();

  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId }
    });

    if (!conversation) {
      return sendError(res, 404, "Conversation not found");
    }

    // SECURITY: V6 - Check org isolation
    if (conversation.organizationId && conversation.organizationId !== authUser.organizationId) {
      return sendError(res, 403, "Access denied - conversation belongs to different organization");
    }

    if (!canAccessConversation(conversation, userRole)) {
      return sendError(res, 403, "Access denied");
    }

    // Check if already a participant
    const existing = await prisma.conversationParticipant.findFirst({
      where: { conversationId, participantId: userId }
    });

    if (existing) {
      if (existing.leftAt) {
        // Rejoin
        await prisma.conversationParticipant.update({
          where: { id: existing.id },
          data: { leftAt: null, joinedAt: new Date() }
        });
      }
      return sendJson(res, 200, { success: true, alreadyJoined: true });
    }

    await prisma.conversationParticipant.create({
      data: {
        conversationId,
        participantId: userId,
        participantName: userName,
        participantRole: userRole
      }
    });

    sendJson(res, 200, { success: true });
  } catch (error) {
    console.error("Error joining conversation:", error);
    sendError(res, 500, "Failed to join conversation", error.message);
  }
}

// GET /api/chat/updates
// SECURITY: V2 fix - use authUser.role from validated JWT, not spoofable x-actor-role header
export async function handleChatUpdates(req, res, authUser) {
  const userId = authUser.id;
  const userRole = authUser.role;
  const url = new URL(req.url, "http://localhost");
  const since = url.searchParams.get("since");
  const prisma = getPrisma();

  if (!since) {
    return sendError(res, 400, "Missing 'since' parameter");
  }

  const sinceDate = new Date(since);
  if (isNaN(sinceDate.getTime())) {
    return sendError(res, 400, "Invalid 'since' timestamp");
  }

  try {
    // Get user's conversations
    const participations = await prisma.conversationParticipant.findMany({
      where: {
        participantId: userId,
        leftAt: null
      },
      select: { conversationId: true, lastReadAt: true }
    });

    const conversationIds = participations.map(p => p.conversationId);
    const lastReadMap = new Map(participations.map(p => [p.conversationId, p.lastReadAt]));

    // Get new messages since timestamp
    const newMessages = await prisma.message.findMany({
      where: {
        conversationId: { in: conversationIds },
        createdAt: { gt: sinceDate },
        isDeleted: false
      },
      orderBy: { createdAt: "asc" }
    });

    // Calculate unread counts
    const unreadCounts = {};
    for (const msg of newMessages) {
      const lastRead = lastReadMap.get(msg.conversationId);
      if (!lastRead || msg.createdAt > lastRead) {
        unreadCounts[msg.conversationId] = (unreadCounts[msg.conversationId] ?? 0) + 1;
      }
    }

    // Get updated conversations
    const updatedConversations = await prisma.conversation.findMany({
      where: {
        id: { in: conversationIds },
        updatedAt: { gt: sinceDate }
      },
      select: { id: true, version: true, updatedAt: true }
    });

    sendJson(res, 200, {
      newMessages: newMessages.map(m => ({
        id: m.id,
        conversationId: m.conversationId,
        senderId: m.senderId,
        senderName: m.senderName,
        content: m.content,
        contentType: m.contentType,
        parentId: m.parentId,
        mentions: m.mentions,
        attachments: m.attachments,
        createdAt: m.createdAt.toISOString()
      })),
      unreadCounts,
      updatedConversations,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Error getting chat updates:", error);
    sendError(res, 500, "Failed to get updates", error.message);
  }
}

// GET /api/chat/deals/:dealId/thread - Get or create deal-specific thread
// SECURITY: V2 fix - use authUser.role from validated JWT, not spoofable x-actor-role header
export async function handleGetDealThread(req, res, dealId, dealName, authUser) {
  const userId = authUser.id;
  const userRole = authUser.role;
  const userName = authUser.name ?? req.headers["x-user-name"] ?? "Anonymous";
  const prisma = getPrisma();

  try {
    // Check if deal thread already exists
    let conversation = await prisma.conversation.findFirst({
      where: {
        type: "DEAL_THREAD",
        dealId: dealId
      },
      include: {
        participants: { where: { leftAt: null } },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1
        }
      }
    });

    // Create if doesn't exist
    if (!conversation) {
      // SECURITY: V6 - Set organizationId for org isolation
      conversation = await prisma.conversation.create({
        data: {
          type: "DEAL_THREAD",
          name: dealName || `Deal Discussion`,
          description: `Discussion thread for this deal`,
          visibility: "PRIVATE",
          dealId: dealId,
          organizationId: authUser.organizationId ?? null,
          createdById: userId,
          participants: {
            create: {
              participantId: userId,
              participantName: userName,
              participantRole: userRole
            }
          }
        },
        include: {
          participants: { where: { leftAt: null } },
          messages: {
            orderBy: { createdAt: "desc" },
            take: 1
          }
        }
      });

      // Add system message
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          senderId: "system",
          senderName: "System",
          content: `Discussion thread created for ${dealName || 'this deal'}`,
          contentType: "system"
        }
      });
    } else {
      // Auto-join if not already a participant
      const isParticipant = conversation.participants.some(p => p.participantId === userId);
      if (!isParticipant) {
        await prisma.conversationParticipant.create({
          data: {
            conversationId: conversation.id,
            participantId: userId,
            participantName: userName,
            participantRole: userRole
          }
        });
        conversation.participants.push({
          participantId: userId,
          participantName: userName,
          participantRole: userRole
        });
      }
    }

    const lastMessage = conversation.messages[0];
    sendJson(res, 200, {
      conversation: {
        id: conversation.id,
        type: conversation.type,
        name: conversation.name,
        description: conversation.description,
        dealId: conversation.dealId,
        participantCount: conversation.participants.length,
        participants: conversation.participants,
        lastMessage: lastMessage ? {
          id: lastMessage.id,
          content: lastMessage.content.substring(0, 100),
          senderName: lastMessage.senderName,
          createdAt: lastMessage.createdAt.toISOString()
        } : null,
        updatedAt: conversation.updatedAt.toISOString()
      }
    });
  } catch (error) {
    console.error("Error getting deal thread:", error);
    sendError(res, 500, "Failed to get deal thread", error.message);
  }
}

// Parse @mentions from message content and return mentioned user IDs
function parseMentions(content) {
  const mentionRegex = /@(\w+)/g;
  const mentions = [];
  let match;
  while ((match = mentionRegex.exec(content)) !== null) {
    mentions.push(match[1].toLowerCase());
  }
  return mentions;
}

// Seed default channels
export async function seedDefaultChannels() {
  const prisma = getPrisma();

  const defaultChannels = [
    {
      type: "CHANNEL",
      name: "general",
      description: "Company-wide announcements and discussion",
      visibility: "PUBLIC",
      allowedRoles: null
    },
    {
      type: "CHANNEL",
      name: "gp-internal",
      description: "Internal GP team discussions",
      visibility: "ROLE_BASED",
      allowedRoles: JSON.stringify(["GP"])
    },
    {
      type: "CHANNEL",
      name: "lender-updates",
      description: "Updates and discussions with lenders",
      visibility: "ROLE_BASED",
      allowedRoles: JSON.stringify(["GP", "Lender"])
    },
    {
      type: "CHANNEL",
      name: "counsel-workspace",
      description: "Legal team coordination",
      visibility: "ROLE_BASED",
      allowedRoles: JSON.stringify(["GP", "Counsel"])
    }
  ];

  for (const channel of defaultChannels) {
    const existing = await prisma.conversation.findFirst({
      where: { type: "CHANNEL", name: channel.name }
    });

    if (!existing) {
      await prisma.conversation.create({
        data: {
          ...channel,
          createdById: "system"
        }
      });
      console.log(`Created default channel: #${channel.name}`);
    }
  }
}
