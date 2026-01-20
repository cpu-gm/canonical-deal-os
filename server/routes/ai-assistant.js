import { getPrisma } from "../db.js";
import { readStore } from "../store.js";
import { kernelFetchJson } from "../kernel.js";
import {
  buildDealContext,
  buildFilteredDealContext,
  generateDealSystemPrompt,
  generateFilteredDealSystemPrompt
} from "../services/deal-context-builder.js";
import { generateInsights, getInsightsSummary } from "../services/deal-insights.js";
import { callOpenAI } from "../llm.js";
import { buildFilteredFactIndex } from "../services/rag-citation-service.js";
import { logAIInteraction } from "../services/ai-audit-logger.js";
import { filterConversationHistory } from "../services/ai-context-filter.js";
import { checkRateLimit, recordRequest } from "../services/ai-rate-limiter.js";
import {
  securityCheck,
  validateLLMOutput,
  createSecurityContext,
  SECURITY_CONFIG
} from "../services/ai-security.js";
import {
  checkConsent,
  AI_FEATURES,
  CONSENT_CONFIG
} from "../services/ai-consent.js";

// Phase 2: Document Intelligence
import {
  extractDocument,
  synthesizeDocuments,
  resolveConflict,
  dismissConflict,
  getConflicts,
  generateExtractionReport,
  DOC_INTELLIGENCE_CONFIG
} from "../services/ai/document-intelligence.js";

// Phase 2: Verification Agent
import {
  trackDataLineage,
  markAsVerified,
  markNeedsReview,
  getVerificationStatus,
  getFieldLineage,
  suggestNextVerification,
  bulkVerify,
  getVerificationHistory,
  VERIFICATION_CONFIG
} from "../services/ai/verification-agent.js";

// Phase 2: Assumption Tracker
import {
  trackAssumptions,
  compareToActuals,
  getPortfolioTrends,
  suggestAssumptionAdjustments,
  getDealSnapshots,
  getDealVariances,
  ASSUMPTION_TRACKER_CONFIG
} from "../services/ai/assumption-tracker.js";

// Debug flag for Phase 2 routes
const DEBUG_PHASE2 = process.env.DEBUG_AI_PHASE2 === 'true';

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

// Query types the AI can handle
const QUERY_TYPES = {
  DEAL_SUMMARY: 'deal_summary',
  DEAL_LIST: 'deal_list',
  TASK_STATUS: 'task_status',
  LP_INFO: 'lp_info',
  RISK_ASSESSMENT: 'risk_assessment',
  GENERAL_STATS: 'general_stats',
  CHAT_HISTORY: 'chat_history',
  UNKNOWN: 'unknown'
};

// Classify the user's question to determine what data to fetch
function classifyQuestion(question) {
  const q = question.toLowerCase();

  // Deal-related queries
  if (q.includes('deal') && (q.includes('summary') || q.includes('overview') || q.includes('status') || q.includes('details'))) {
    return QUERY_TYPES.DEAL_SUMMARY;
  }
  if (q.includes('how many deals') || q.includes('list deals') || q.includes('all deals') || q.includes('active deals')) {
    return QUERY_TYPES.DEAL_LIST;
  }

  // Task queries
  if (q.includes('task') || q.includes('todo') || q.includes('action item') || q.includes('pending')) {
    return QUERY_TYPES.TASK_STATUS;
  }

  // LP queries
  if (q.includes('lp') || q.includes('limited partner') || q.includes('investor') || q.includes('commitment')) {
    return QUERY_TYPES.LP_INFO;
  }

  // Risk assessment
  if (q.includes('risk') || q.includes('concern') || q.includes('issue') || q.includes('problem') || q.includes('assessment')) {
    return QUERY_TYPES.RISK_ASSESSMENT;
  }

  // General stats
  if (q.includes('stats') || q.includes('statistics') || q.includes('metrics') || q.includes('total') || q.includes('count')) {
    return QUERY_TYPES.GENERAL_STATS;
  }

  // Chat history
  if (q.includes('discussed') || q.includes('conversation') || q.includes('talked about') || q.includes('mentioned')) {
    return QUERY_TYPES.CHAT_HISTORY;
  }

  return QUERY_TYPES.UNKNOWN;
}

// Extract deal ID or name from question if mentioned
function extractDealReference(question, deals) {
  const q = question.toLowerCase();

  // Try to match deal by name
  for (const deal of deals) {
    if (deal.name && q.includes(deal.name.toLowerCase())) {
      return deal;
    }
  }

  // Try to match deal ID
  const idMatch = question.match(/deal[:\s]+([a-f0-9-]{36})/i);
  if (idMatch) {
    return deals.find(d => d.id === idMatch[1]);
  }

  return null;
}

// Gather context data based on query type
async function gatherContext(queryType, question, dealId, kernelBaseUrl) {
  const prisma = getPrisma();
  const store = await readStore();
  const context = {
    queryType,
    timestamp: new Date().toISOString(),
    data: {}
  };

  try {
    switch (queryType) {
      case QUERY_TYPES.DEAL_LIST:
      case QUERY_TYPES.GENERAL_STATS: {
        // Get all deals from store
        const dealIndex = store.dealIndex || [];
        context.data.deals = dealIndex.map(d => ({
          id: d.id,
          name: d.name,
          createdAt: d.createdAt
        }));
        context.data.totalDeals = dealIndex.length;

        // Get task counts
        const tasks = await prisma.workflowTask.groupBy({
          by: ['status'],
          _count: { status: true }
        });
        context.data.tasksByStatus = tasks.reduce((acc, t) => {
          acc[t.status] = t._count.status;
          return acc;
        }, {});

        // Get LP stats
        const lpCount = await prisma.lPActor.count();
        context.data.totalLPs = lpCount;

        break;
      }

      case QUERY_TYPES.DEAL_SUMMARY: {
        if (dealId) {
          // Get specific deal info
          const dealRecord = store.dealIndex.find(d => d.id === dealId);
          const profileEntry = store.dealProfiles.find(p => p.dealId === dealId);

          context.data.deal = {
            id: dealId,
            name: dealRecord?.name,
            createdAt: dealRecord?.createdAt,
            profile: profileEntry?.profile ? JSON.parse(profileEntry.profile) : {}
          };

          // Get tasks for this deal
          const tasks = await prisma.workflowTask.findMany({
            where: { dealId },
            orderBy: { createdAt: 'desc' },
            take: 10
          });
          context.data.tasks = tasks;

          // Get LPs for this deal
          const lps = await prisma.lPActor.findMany({
            where: { dealId }
          });
          context.data.lps = lps;
        } else {
          // No specific deal, list all
          context.data.deals = store.dealIndex || [];
          context.data.message = "No specific deal mentioned. Here are all available deals.";
        }
        break;
      }

      case QUERY_TYPES.TASK_STATUS: {
        const whereClause = dealId ? { dealId } : {};
        const tasks = await prisma.workflowTask.findMany({
          where: whereClause,
          orderBy: { createdAt: 'desc' },
          take: 20
        });
        context.data.tasks = tasks;

        // Group by status
        const tasksByStatus = await prisma.workflowTask.groupBy({
          by: ['status'],
          where: whereClause,
          _count: { status: true }
        });
        context.data.tasksByStatus = tasksByStatus.reduce((acc, t) => {
          acc[t.status] = t._count.status;
          return acc;
        }, {});
        break;
      }

      case QUERY_TYPES.LP_INFO: {
        const whereClause = dealId ? { dealId } : {};
        const lps = await prisma.lPActor.findMany({
          where: whereClause,
          orderBy: { commitment: 'desc' }
        });
        context.data.lps = lps;

        // Calculate totals
        const totalCommitment = lps.reduce((sum, lp) => sum + (lp.commitment || 0), 0);
        context.data.totalCommitment = totalCommitment;
        context.data.lpCount = lps.length;

        // Get pending invitations
        const invitations = await prisma.lPInvitation.findMany({
          where: { ...whereClause, status: 'PENDING' }
        });
        context.data.pendingInvitations = invitations;
        break;
      }

      case QUERY_TYPES.RISK_ASSESSMENT: {
        // Get tasks with high severity
        const highSeverityTasks = await prisma.workflowTask.findMany({
          where: dealId
            ? { dealId, severity: { in: ['HIGH', 'CRITICAL'] } }
            : { severity: { in: ['HIGH', 'CRITICAL'] } },
          orderBy: { createdAt: 'desc' }
        });
        context.data.highSeverityTasks = highSeverityTasks;

        // Get overdue invitations
        const overdueInvitations = await prisma.lPInvitation.findMany({
          where: {
            status: 'PENDING',
            expiresAt: { lt: new Date() }
          }
        });
        context.data.overdueInvitations = overdueInvitations;

        // Get open tasks count
        const openTasksCount = await prisma.workflowTask.count({
          where: dealId
            ? { dealId, status: 'OPEN' }
            : { status: 'OPEN' }
        });
        context.data.openTasksCount = openTasksCount;
        break;
      }

      case QUERY_TYPES.CHAT_HISTORY: {
        // Get recent messages
        const messages = await prisma.message.findMany({
          where: dealId
            ? { conversation: { dealId } }
            : {},
          orderBy: { createdAt: 'desc' },
          take: 50,
          include: {
            conversation: {
              select: { name: true, dealId: true }
            }
          }
        });
        context.data.recentMessages = messages.map(m => ({
          content: m.content,
          senderName: m.senderName,
          createdAt: m.createdAt,
          conversationName: m.conversation.name
        }));
        break;
      }

      default: {
        // For unknown queries, provide general context
        context.data.deals = store.dealIndex || [];
        const taskCount = await prisma.workflowTask.count();
        const lpCount = await prisma.lPActor.count();
        context.data.stats = {
          totalDeals: (store.dealIndex || []).length,
          totalTasks: taskCount,
          totalLPs: lpCount
        };
      }
    }
  } catch (error) {
    console.error('Error gathering context:', error);
    context.error = error.message;
  }

  return context;
}

// Generate AI response based on context
function generateResponse(question, context) {
  const { queryType, data } = context;

  let response = {
    answer: '',
    data: null,
    suggestions: []
  };

  switch (queryType) {
    case QUERY_TYPES.DEAL_LIST: {
      const deals = data.deals || [];
      if (deals.length === 0) {
        response.answer = "There are currently no deals in the system. You can create a new deal from the Deals page.";
      } else {
        response.answer = `There are ${deals.length} deal(s) in the system:\n\n`;
        deals.forEach((deal, i) => {
          response.answer += `${i + 1}. **${deal.name || 'Unnamed Deal'}** (created ${formatDate(deal.createdAt)})\n`;
        });
      }
      response.data = { deals, count: deals.length };
      response.suggestions = ['Show me deal details', 'What tasks are open?', 'Show LP commitments'];
      break;
    }

    case QUERY_TYPES.DEAL_SUMMARY: {
      if (data.deal) {
        const deal = data.deal;
        const tasks = data.tasks || [];
        const lps = data.lps || [];

        response.answer = `## ${deal.name || 'Deal Summary'}\n\n`;
        response.answer += `**Created:** ${formatDate(deal.createdAt)}\n\n`;

        if (Object.keys(deal.profile).length > 0) {
          response.answer += `**Profile:**\n`;
          Object.entries(deal.profile).forEach(([key, value]) => {
            if (value) response.answer += `- ${key}: ${value}\n`;
          });
          response.answer += '\n';
        }

        response.answer += `**Tasks:** ${tasks.length} total\n`;
        const openTasks = tasks.filter(t => t.status === 'OPEN').length;
        if (openTasks > 0) {
          response.answer += `- ${openTasks} open task(s) requiring attention\n`;
        }

        response.answer += `\n**Limited Partners:** ${lps.length}\n`;
        if (lps.length > 0) {
          const totalCommitment = lps.reduce((sum, lp) => sum + (lp.commitment || 0), 0);
          response.answer += `- Total commitment: $${formatCurrency(totalCommitment)}\n`;
        }

        response.data = { deal, tasks, lps };
      } else if (data.deals) {
        response.answer = "I couldn't identify a specific deal from your question. ";
        response.answer += `There are ${data.deals.length} deals available. Which one would you like to know about?\n\n`;
        data.deals.slice(0, 5).forEach((deal, i) => {
          response.answer += `${i + 1}. ${deal.name || deal.id}\n`;
        });
        response.data = { deals: data.deals };
      }
      response.suggestions = ['Show me the tasks', 'Who are the LPs?', 'Any risks to be aware of?'];
      break;
    }

    case QUERY_TYPES.TASK_STATUS: {
      const tasks = data.tasks || [];
      const byStatus = data.tasksByStatus || {};

      response.answer = `## Task Status Overview\n\n`;

      if (Object.keys(byStatus).length > 0) {
        response.answer += `**By Status:**\n`;
        Object.entries(byStatus).forEach(([status, count]) => {
          const emoji = status === 'OPEN' ? '🔴' : status === 'IN_PROGRESS' ? '🟡' : '🟢';
          response.answer += `- ${emoji} ${status}: ${count}\n`;
        });
        response.answer += '\n';
      }

      const openTasks = tasks.filter(t => t.status === 'OPEN');
      if (openTasks.length > 0) {
        response.answer += `**Open Tasks Requiring Attention:**\n`;
        openTasks.slice(0, 5).forEach(task => {
          const severity = task.severity === 'HIGH' || task.severity === 'CRITICAL' ? '⚠️' : '';
          response.answer += `- ${severity} ${task.title} (${task.type})\n`;
        });
      } else {
        response.answer += `Great news! No open tasks at the moment.`;
      }

      response.data = { tasks, byStatus };
      response.suggestions = ['Show high priority tasks', 'Create a new task', 'Mark task as complete'];
      break;
    }

    case QUERY_TYPES.LP_INFO: {
      const lps = data.lps || [];
      const totalCommitment = data.totalCommitment || 0;
      const pendingInvitations = data.pendingInvitations || [];

      response.answer = `## Limited Partner Overview\n\n`;
      response.answer += `**Total LPs:** ${lps.length}\n`;
      response.answer += `**Total Commitment:** $${formatCurrency(totalCommitment)}\n\n`;

      if (lps.length > 0) {
        response.answer += `**Top Contributors:**\n`;
        lps.slice(0, 5).forEach(lp => {
          response.answer += `- ${lp.entityName}: $${formatCurrency(lp.commitment)} (${lp.ownershipPct?.toFixed(1)}%)\n`;
        });
      }

      if (pendingInvitations.length > 0) {
        response.answer += `\n**Pending Invitations:** ${pendingInvitations.length}\n`;
        pendingInvitations.forEach(inv => {
          response.answer += `- ${inv.lpEntityName}: $${formatCurrency(inv.commitment)} pending\n`;
        });
      }

      response.data = { lps, totalCommitment, pendingInvitations };
      response.suggestions = ['Send LP invitation', 'Show commitment breakdown', 'View LP details'];
      break;
    }

    case QUERY_TYPES.RISK_ASSESSMENT: {
      const highSeverityTasks = data.highSeverityTasks || [];
      const overdueInvitations = data.overdueInvitations || [];
      const openTasksCount = data.openTasksCount || 0;

      response.answer = `## Risk Assessment\n\n`;

      const riskLevel = (highSeverityTasks.length > 3 || overdueInvitations.length > 0) ? 'HIGH' :
                       (highSeverityTasks.length > 0 || openTasksCount > 10) ? 'MEDIUM' : 'LOW';

      const riskEmoji = riskLevel === 'HIGH' ? '🔴' : riskLevel === 'MEDIUM' ? '🟡' : '🟢';
      response.answer += `**Overall Risk Level:** ${riskEmoji} ${riskLevel}\n\n`;

      if (highSeverityTasks.length > 0) {
        response.answer += `**High Severity Issues (${highSeverityTasks.length}):**\n`;
        highSeverityTasks.slice(0, 5).forEach(task => {
          response.answer += `- ⚠️ ${task.title}\n`;
        });
        response.answer += '\n';
      }

      if (overdueInvitations.length > 0) {
        response.answer += `**Overdue LP Invitations (${overdueInvitations.length}):**\n`;
        overdueInvitations.forEach(inv => {
          response.answer += `- ${inv.lpEntityName} - expired ${formatDate(inv.expiresAt)}\n`;
        });
        response.answer += '\n';
      }

      if (riskLevel === 'LOW') {
        response.answer += `No significant risks identified. All systems operating normally.`;
      } else {
        response.answer += `**Recommended Actions:**\n`;
        if (highSeverityTasks.length > 0) response.answer += `- Address high severity tasks immediately\n`;
        if (overdueInvitations.length > 0) response.answer += `- Follow up on expired LP invitations\n`;
        if (openTasksCount > 10) response.answer += `- Review and prioritize open tasks\n`;
      }

      response.data = { riskLevel, highSeverityTasks, overdueInvitations, openTasksCount };
      response.suggestions = ['Show all high priority tasks', 'View overdue items', 'Generate risk report'];
      break;
    }

    case QUERY_TYPES.GENERAL_STATS: {
      response.answer = `## System Statistics\n\n`;
      response.answer += `**Deals:** ${data.totalDeals || 0}\n`;
      response.answer += `**Limited Partners:** ${data.totalLPs || 0}\n\n`;

      if (data.tasksByStatus) {
        response.answer += `**Tasks by Status:**\n`;
        Object.entries(data.tasksByStatus).forEach(([status, count]) => {
          response.answer += `- ${status}: ${count}\n`;
        });
      }

      response.data = data;
      response.suggestions = ['Show me all deals', 'What tasks need attention?', 'Show LP commitments'];
      break;
    }

    case QUERY_TYPES.CHAT_HISTORY: {
      const messages = data.recentMessages || [];
      if (messages.length === 0) {
        response.answer = "No recent chat messages found.";
      } else {
        response.answer = `## Recent Discussions\n\n`;
        response.answer += `Found ${messages.length} recent message(s).\n\n`;

        // Group by conversation
        const byConversation = {};
        messages.forEach(m => {
          const convName = m.conversationName || 'General';
          if (!byConversation[convName]) byConversation[convName] = [];
          byConversation[convName].push(m);
        });

        Object.entries(byConversation).slice(0, 3).forEach(([convName, msgs]) => {
          response.answer += `**#${convName}:**\n`;
          msgs.slice(0, 3).forEach(m => {
            response.answer += `- ${m.senderName}: "${m.content.substring(0, 100)}${m.content.length > 100 ? '...' : ''}"\n`;
          });
          response.answer += '\n';
        });
      }
      response.data = { messages };
      response.suggestions = ['Search for specific topic', 'Show all messages', 'View conversation'];
      break;
    }

    default: {
      response.answer = `I can help you with information about:\n\n`;
      response.answer += `- **Deals** - summaries, status, details\n`;
      response.answer += `- **Tasks** - open tasks, status updates\n`;
      response.answer += `- **Limited Partners** - commitments, invitations\n`;
      response.answer += `- **Risk Assessment** - issues, concerns\n`;
      response.answer += `- **Statistics** - metrics, counts\n\n`;
      response.answer += `Try asking something like "How many deals do we have?" or "What tasks are open?"`;

      if (data.stats) {
        response.answer += `\n\n**Quick Stats:**\n`;
        response.answer += `- ${data.stats.totalDeals} deals\n`;
        response.answer += `- ${data.stats.totalTasks} tasks\n`;
        response.answer += `- ${data.stats.totalLPs} LPs\n`;
      }

      response.suggestions = ['Show all deals', 'What tasks are pending?', 'Give me a risk assessment'];
    }
  }

  return response;
}

// Helper functions
function formatDate(dateStr) {
  if (!dateStr) return 'N/A';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatCurrency(amount) {
  if (!amount) return '0';
  if (amount >= 1000000) return `${(amount / 1000000).toFixed(1)}M`;
  if (amount >= 1000) return `${(amount / 1000).toFixed(0)}K`;
  return amount.toLocaleString();
}

// POST /api/ai-assistant/ask
export async function handleAskAI(req, res, kernelBaseUrl, resolveUserId, resolveUserRole) {
  const userId = resolveUserId(req);
  const userRole = resolveUserRole(req);

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

  const { question, conversationId, dealId: explicitDealId } = body;

  if (!question || question.trim().length === 0) {
    return sendError(res, 400, "Question is required");
  }

  try {
    // Get deal list for reference
    const store = await readStore();
    const deals = store.dealIndex || [];

    // Classify the question
    const queryType = classifyQuestion(question);

    // Try to extract deal reference from question
    let dealId = explicitDealId;
    if (!dealId) {
      const referencedDeal = extractDealReference(question, deals);
      if (referencedDeal) {
        dealId = referencedDeal.id;
      }
    }

    // Gather relevant context
    const context = await gatherContext(queryType, question, dealId, kernelBaseUrl);

    // Generate response
    const response = generateResponse(question, context);

    sendJson(res, 200, {
      question,
      queryType,
      dealId,
      ...response,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error("Error processing AI question:", error);
    sendError(res, 500, "Failed to process question", error.message);
  }
}

// GET /api/ai-assistant/suggestions
export async function handleGetSuggestions(req, res, resolveUserId, resolveUserRole) {
  const userRole = resolveUserRole(req);

  const suggestions = [
    { text: "How many deals do we have?", category: "deals" },
    { text: "What tasks need attention?", category: "tasks" },
    { text: "Show me LP commitments", category: "lps" },
    { text: "Give me a risk assessment", category: "risk" },
    { text: "What were we discussing recently?", category: "chat" }
  ];

  // Role-specific suggestions
  if (userRole === 'GP') {
    suggestions.push({ text: "Portfolio overview", category: "deals" });
    suggestions.push({ text: "Pending approvals", category: "tasks" });
  } else if (userRole === 'Lender') {
    suggestions.push({ text: "Credit exposure summary", category: "risk" });
    suggestions.push({ text: "DSCR status across deals", category: "risk" });
  } else if (userRole === 'Counsel') {
    suggestions.push({ text: "Document review status", category: "tasks" });
    suggestions.push({ text: "Outstanding legal tasks", category: "tasks" });
  }

  sendJson(res, 200, { suggestions });
}

// ==================== DEAL-SPECIFIC CONTEXT-AWARE CHAT ====================

/**
 * POST /api/deals/:dealId/chat
 * Context-aware deal chat with full underwriting intelligence
 *
 * SECURITY: Uses filtered context based on user's role and entitlements.
 * The LLM only sees data the authenticated user is authorized to access.
 */
export async function handleDealChat(req, res, dealId, resolveUserId, resolveUserRole, authUser) {
  const prisma = getPrisma();
  const userId = resolveUserId(req);
  const userRole = authUser?.role || resolveUserRole(req);
  const userName = req.headers['x-user-name'] || authUser?.name || 'User';

  console.log(`[AI-HANDLER] handleDealChat called - Deal: ${dealId}, User: ${authUser?.id}, Role: ${authUser?.role}`);

  // SECURITY: Require authenticated user for AI access
  if (!authUser) {
    console.log(`[AI-HANDLER] REJECTED - No authUser provided`);
    return sendError(res, 401, "Authentication required for AI chat");
  }

  // SECURITY: Check rate limits before processing
  const rateLimitResult = checkRateLimit(authUser.id, authUser.organizationId);
  if (!rateLimitResult.allowed) {
    console.log(`[AI-HANDLER] RATE LIMITED - User: ${authUser.id}, Reason: ${rateLimitResult.limitType}`);
    res.writeHead(429, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Retry-After": rateLimitResult.retryAfterSeconds.toString(),
    });
    return res.end(JSON.stringify({
      error: 'Rate limit exceeded',
      message: rateLimitResult.reason,
      retryAfterSeconds: rateLimitResult.retryAfterSeconds,
      limitType: rateLimitResult.limitType,
    }));
  }

  let body;
  try {
    body = await parseBody(req);
  } catch {
    return sendError(res, 400, "Invalid request body");
  }

  const { message, conversationHistory = [] } = body;

  if (!message || message.trim().length === 0) {
    return sendError(res, 400, "Message is required");
  }

  if (!dealId) {
    return sendError(res, 400, "Deal ID is required");
  }

  // SECURITY: Run security check on user message (sanitization + jailbreak detection)
  const securityResult = securityCheck(message);

  if (securityResult.blocked) {
    console.log(`[AI-SECURITY] BLOCKED chat message from user ${authUser.id}: ${securityResult.error}`);

    // Log the blocked attempt
    try {
      await logAIInteraction({
        userId: authUser.id,
        userRole: authUser.role,
        organizationId: authUser.organizationId,
        dealId,
        endpoint: `/api/deals/${dealId}/chat`,
        promptSummary: message.substring(0, 200),
        fullPrompt: message,
        fullResponse: null,
        contextFields: [],
        factsIncluded: 0,
        responseLength: 0,
        validationPassed: false,
        validationIssues: JSON.stringify({ blocked: true, reason: 'jailbreak_detected' }),
        ...securityResult.securityContext
      });
    } catch (logError) {
      console.error('Failed to log blocked AI interaction:', logError);
    }

    return sendError(res, 400, securityResult.error);
  }

  // Log warning if detected but not blocked
  if (securityResult.warning) {
    console.log(`[AI-SECURITY] WARNING on chat message from user ${authUser.id}: ${securityResult.warning}`);
  }

  // SECURITY: Check AI consent (Phase 1.2)
  const consentResult = await checkConsent(authUser.id, AI_FEATURES.CHAT_ASSISTANT);
  if (!consentResult.valid) {
    console.log(`[AI-CONSENT] BLOCKED chat: user=${authUser.id}, reason=${consentResult.reason}`);
    return sendJson(res, 451, {
      message: "AI consent required",
      consentRequired: consentResult.requiresConsent,
      reason: consentResult.reason,
      policyVersion: CONSENT_CONFIG.currentPolicyVersion
    });
  }

  // Record the request for rate limiting (before processing)
  recordRequest(authUser.id, authUser.organizationId);

  try {
    // SECURITY: Build FILTERED deal context based on user's role
    // This ensures the LLM only sees data the user is authorized to access
    const filteredContext = await buildFilteredDealContext(dealId, authUser);

    // Generate system prompt with FILTERED context
    const systemPrompt = generateFilteredDealSystemPrompt(filteredContext, userRole);

    // SECURITY: Filter conversation history to prevent cross-role data leakage
    // If a GP started the conversation and an LP continues, the LP shouldn't see
    // GP-level data that may have been discussed in the history
    const filteredHistory = filterConversationHistory(conversationHistory, authUser, dealId);

    // Build messages array for LLM with FILTERED history (using sanitized message)
    const messages = [
      { role: 'system', content: systemPrompt },
      // Include filtered conversation history (role-appropriate content only)
      ...filteredHistory.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content
      })),
      { role: 'user', content: securityResult.sanitized }
    ];

    // Call OpenAI (or configured LLM)
    let aiResponse;
    try {
      aiResponse = await callOpenAI(messages, {
        model: 'gpt-4o-mini',
        temperature: 0.7,
        max_tokens: 2000
      });
    } catch (llmError) {
      console.error('LLM call failed:', llmError);
      // Fall back to a simpler response generation
      aiResponse = generateFallbackResponse(message, filteredContext);
    }

    // SECURITY: Validate LLM output for security issues
    const outputValidation = validateLLMOutput(aiResponse, 'chat');

    if (!outputValidation.valid && outputValidation.severity === 'high') {
      console.log(`[AI-SECURITY] HIGH severity output issue detected: ${outputValidation.issues.join(', ')}`);
      // For high severity issues, we still return the response but log it
      // Could optionally block/sanitize the response here
    }

    // Store the conversation in the chat system
    const chatThread = await getOrCreateDealChatThread(dealId, userId, userName);

    // Store the user message
    await prisma.message?.create({
      data: {
        conversationId: chatThread.id,
        senderId: userId,
        senderName: userName,
        senderRole: userRole,
        content: message,
        type: 'CHAT'
      }
    });

    // Store the AI response
    await prisma.message?.create({
      data: {
        conversationId: chatThread.id,
        senderId: 'ai-assistant',
        senderName: 'AI Underwriting Assistant',
        senderRole: 'SYSTEM',
        content: aiResponse,
        type: 'CHAT'
      }
    });

    // SECURITY: Log AI interaction for audit (full audit trail with security context)
    try {
      await logAIInteraction({
        userId: authUser.id,
        userRole: authUser.role,
        organizationId: authUser.organizationId,
        dealId,
        endpoint: `/api/deals/${dealId}/chat`,
        promptSummary: message.substring(0, 200),
        fullPrompt: message,              // Full user message for audit trail
        fullResponse: aiResponse,         // Full AI response for tracing decisions
        systemPrompt: systemPrompt,       // System prompt (will be hashed for consistency)
        modelUsed: 'gpt-4o-mini',          // Model used for this request
        contextFields: Object.keys(filteredContext),
        factsIncluded: 0, // No RAG facts in basic chat
        responseLength: aiResponse?.length || 0,
        validationPassed: outputValidation.valid,
        validationIssues: outputValidation.issues.length > 0 ? JSON.stringify(outputValidation.issues) : null,
        // Phase 1.1 security fields
        ...securityResult.securityContext,
        outputValidationPassed: outputValidation.valid,
        outputValidationIssues: outputValidation.issues.length > 0 ? JSON.stringify(outputValidation.issues) : null,
      });
    } catch (logError) {
      // Don't fail the request if logging fails
      console.error('Failed to log AI interaction:', logError);
    }

    sendJson(res, 200, {
      response: aiResponse,
      dealId,
      dealName: filteredContext.dealName,
      conversationId: chatThread.id,
      timestamp: new Date().toISOString(),
      context: {
        hasModel: filteredContext.meta?.hasModel || false,
        documentCount: filteredContext.meta?.documentCount || 0,
        scenarioCount: filteredContext.meta?.scenarioCount || 0,
        filteredForRole: userRole
      }
    });

  } catch (error) {
    console.error("Error in deal chat:", error);

    // Handle access denied errors specifically
    if (error.message.includes('Access denied') || error.message.includes('not assigned') || error.message.includes('does not have')) {
      return sendError(res, 403, error.message);
    }

    sendError(res, 500, "Failed to process message", error.message);
  }
}

/**
 * GET /api/deals/:dealId/chat/history
 * Get chat history for a deal
 */
export async function handleGetDealChatHistory(req, res, dealId, resolveUserId) {
  const prisma = getPrisma();
  const userId = resolveUserId(req);

  if (!dealId) {
    return sendError(res, 400, "Deal ID is required");
  }

  try {
    // Find the deal's chat conversation
    const conversation = await prisma.conversation?.findFirst({
      where: {
        dealId,
        type: 'AI_CHAT'
      }
    });

    if (!conversation) {
      return sendJson(res, 200, { messages: [], conversationId: null });
    }

    // Get messages
    const messages = await prisma.message?.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'asc' },
      take: 100
    });

    sendJson(res, 200, {
      conversationId: conversation.id,
      dealId,
      messages: messages.map(m => ({
        id: m.id,
        role: m.senderId === 'ai-assistant' ? 'assistant' : 'user',
        content: m.content,
        senderName: m.senderName,
        createdAt: m.createdAt
      }))
    });

  } catch (error) {
    console.error("Error getting chat history:", error);
    sendError(res, 500, "Failed to get chat history", error.message);
  }
}

/**
 * GET /api/deals/:dealId/insights
 * Get auto-generated insights for a deal
 *
 * SECURITY: Uses filtered context based on user's role.
 */
export async function handleGetDealInsights(req, res, dealId, authUser) {
  console.log(`[AI-HANDLER] handleGetDealInsights called - Deal: ${dealId}, User: ${authUser?.id}, Role: ${authUser?.role}`);

  if (!dealId) {
    return sendError(res, 400, "Deal ID is required");
  }

  // SECURITY: Require authenticated user
  if (!authUser) {
    console.log(`[AI-HANDLER] REJECTED - No authUser provided`);
    return sendError(res, 401, "Authentication required for AI insights");
  }

  // SECURITY: Check rate limits before processing
  const rateLimitResult = checkRateLimit(authUser.id, authUser.organizationId);
  if (!rateLimitResult.allowed) {
    console.log(`[AI-HANDLER] RATE LIMITED - User: ${authUser.id}, Reason: ${rateLimitResult.limitType}`);
    res.writeHead(429, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Retry-After": rateLimitResult.retryAfterSeconds.toString(),
    });
    return res.end(JSON.stringify({
      error: 'Rate limit exceeded',
      message: rateLimitResult.reason,
      retryAfterSeconds: rateLimitResult.retryAfterSeconds,
      limitType: rateLimitResult.limitType,
    }));
  }

  // SECURITY: Check AI consent (Phase 1.2)
  const consentResult = await checkConsent(authUser.id, AI_FEATURES.INSIGHTS);
  if (!consentResult.valid) {
    console.log(`[AI-CONSENT] BLOCKED insights: user=${authUser.id}, reason=${consentResult.reason}`);
    return sendJson(res, 451, {
      message: "AI consent required",
      consentRequired: consentResult.requiresConsent,
      reason: consentResult.reason,
      policyVersion: CONSENT_CONFIG.currentPolicyVersion
    });
  }

  // Record the request for rate limiting
  recordRequest(authUser.id, authUser.organizationId);

  try {
    // SECURITY: Build FILTERED deal context based on user's role
    const filteredContext = await buildFilteredDealContext(dealId, authUser);

    // Generate insights from filtered context only
    const insights = generateInsights(filteredContext);
    const summary = getInsightsSummary(insights);

    // SECURITY: Log AI interaction (full audit trail)
    const insightsResponse = JSON.stringify(insights);
    try {
      await logAIInteraction({
        userId: authUser.id,
        userRole: authUser.role,
        organizationId: authUser.organizationId,
        dealId,
        endpoint: `/api/deals/${dealId}/insights`,
        promptSummary: 'Auto-generated insights request',
        fullPrompt: 'Auto-generated insights request (no user prompt)',
        fullResponse: insightsResponse,   // Full insights response for audit
        systemPrompt: null,               // No system prompt for rule-based insights
        modelUsed: null,                  // Rule-based, no LLM used
        contextFields: Object.keys(filteredContext),
        factsIncluded: 0,
        responseLength: insightsResponse.length,
        validationPassed: true,
      });
    } catch (logError) {
      console.error('Failed to log AI interaction:', logError);
    }

    sendJson(res, 200, {
      dealId,
      dealName: filteredContext.dealName,
      insights,
      summary,
      generatedAt: new Date().toISOString(),
      filteredForRole: authUser.role
    });

  } catch (error) {
    console.error("Error generating insights:", error);

    if (error.message.includes('Access denied') || error.message.includes('not assigned')) {
      return sendError(res, 403, error.message);
    }

    sendError(res, 500, "Failed to generate insights", error.message);
  }
}

/**
 * GET /api/deals/:dealId/context
 * Get the deal context (for debugging/inspection)
 *
 * SECURITY: Returns FILTERED context based on user's role.
 * This endpoint shows what the AI would see for this user.
 */
export async function handleGetDealContext(req, res, dealId, authUser) {
  console.log(`[AI-HANDLER] handleGetDealContext called - Deal: ${dealId}, User: ${authUser?.id}, Role: ${authUser?.role}`);

  if (!dealId) {
    return sendError(res, 400, "Deal ID is required");
  }

  // SECURITY: Require authenticated user
  if (!authUser) {
    console.log(`[AI-HANDLER] REJECTED - No authUser provided`);
    return sendError(res, 401, "Authentication required");
  }

  try {
    // SECURITY: Build FILTERED context - shows what AI sees for this user
    const filteredContext = await buildFilteredDealContext(dealId, authUser);

    sendJson(res, 200, {
      dealId,
      context: filteredContext,
      filteredForRole: authUser.role,
      note: "This shows the context that would be sent to the AI for your role."
    });

  } catch (error) {
    console.error("Error getting deal context:", error);

    if (error.message.includes('Access denied') || error.message.includes('not assigned')) {
      return sendError(res, 403, error.message);
    }

    sendError(res, 500, "Failed to get deal context", error.message);
  }
}

/**
 * POST /api/deals/:dealId/summarize
 * Generate an AI executive summary of the deal
 *
 * SECURITY: Uses filtered context based on user's role.
 */
export async function handleDealSummarize(req, res, dealId, resolveUserId, authUser) {
  const prisma = getPrisma();
  const userId = resolveUserId(req);

  console.log(`[AI-HANDLER] handleDealSummarize called - Deal: ${dealId}, User: ${authUser?.id}, Role: ${authUser?.role}`);

  if (!dealId) {
    return sendError(res, 400, "Deal ID is required");
  }

  // SECURITY: Require authenticated user
  if (!authUser) {
    console.log(`[AI-HANDLER] REJECTED - No authUser provided`);
    return sendError(res, 401, "Authentication required for AI summary");
  }

  // SECURITY: Check rate limits before processing
  const rateLimitResult = checkRateLimit(authUser.id, authUser.organizationId);
  if (!rateLimitResult.allowed) {
    console.log(`[AI-HANDLER] RATE LIMITED - User: ${authUser.id}, Reason: ${rateLimitResult.limitType}`);
    res.writeHead(429, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Retry-After": rateLimitResult.retryAfterSeconds.toString(),
    });
    return res.end(JSON.stringify({
      error: 'Rate limit exceeded',
      message: rateLimitResult.reason,
      retryAfterSeconds: rateLimitResult.retryAfterSeconds,
      limitType: rateLimitResult.limitType,
    }));
  }

  // SECURITY: Check AI consent (Phase 1.2)
  const consentResult = await checkConsent(authUser.id, AI_FEATURES.INSIGHTS);
  if (!consentResult.valid) {
    console.log(`[AI-CONSENT] BLOCKED summarize: user=${authUser.id}, reason=${consentResult.reason}`);
    return sendJson(res, 451, {
      message: "AI consent required",
      consentRequired: consentResult.requiresConsent,
      reason: consentResult.reason,
      policyVersion: CONSENT_CONFIG.currentPolicyVersion
    });
  }

  // Record the request for rate limiting
  recordRequest(authUser.id, authUser.organizationId);

  try {
    // SECURITY: Build FILTERED deal context based on user's role
    const context = await buildFilteredDealContext(dealId, authUser);

    // Generate insights for the summary
    const insights = generateInsights(context);
    const insightsSummary = getInsightsSummary(insights);

    // Build summary prompt
    const summaryPrompt = `Based on the deal information below, write a 2-3 paragraph executive summary suitable for an investment committee. Include:
1. Property overview (type, location, size, price)
2. Key financial metrics (cap rate, IRR, DSCR, equity multiple)
3. Main risks and considerations
4. Your overall assessment and recommendation

DEAL: ${context.dealName}

PROPERTY:
${formatPropertyForSummary(context.property)}

RETURNS:
${formatReturnsForSummary(context.calculatedReturns)}

DEBT METRICS:
${formatDebtForSummary(context.model, context.calculatedReturns)}

KEY INSIGHTS:
${formatInsightsForSummary(insights)}

Write the executive summary now:`;

    // Call LLM
    let summary;
    try {
      summary = await callOpenAI([
        { role: 'system', content: 'You are a senior CRE investment analyst writing executive summaries for investment committees. Be concise, direct, and focus on decision-relevant information.' },
        { role: 'user', content: summaryPrompt }
      ], {
        model: 'gpt-4o-mini',
        temperature: 0.5,
        max_tokens: 1000
      });
    } catch (llmError) {
      console.error('LLM summary failed:', llmError);
      summary = generateFallbackSummary(context, insights);
    }

    // Cache the summary in DealProfile (BFF-managed metadata)
    await prisma.dealProfile?.upsert({
      where: { dealId },
      update: {
        aiSummary: summary,
        aiSummaryGeneratedAt: new Date(),
        updatedAt: new Date()
      },
      create: {
        dealId,
        aiSummary: summary,
        aiSummaryGeneratedAt: new Date()
      }
    }).catch(() => {
      // If the field doesn't exist, just skip caching
    });

    // SECURITY: Log AI interaction (full audit trail)
    const systemPromptForSummary = 'You are a senior CRE investment analyst writing executive summaries for investment committees. Be concise, direct, and focus on decision-relevant information.';
    try {
      await logAIInteraction({
        userId: authUser.id,
        userRole: authUser.role,
        organizationId: authUser.organizationId,
        dealId,
        endpoint: `/api/deals/${dealId}/summarize`,
        promptSummary: summaryPrompt.substring(0, 200),
        fullPrompt: summaryPrompt,        // Full prompt for audit trail
        fullResponse: summary,            // Full AI response for tracing
        systemPrompt: systemPromptForSummary, // Will be hashed
        modelUsed: 'gpt-4o-mini',
        contextFields: Object.keys(context),
        factsIncluded: 0,
        responseLength: summary?.length || 0,
        validationPassed: true,
      });
    } catch (logError) {
      console.error('Failed to log AI interaction:', logError);
    }

    sendJson(res, 200, {
      dealId,
      dealName: context.dealName,
      summary,
      insights: insightsSummary,
      generatedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error("Error generating summary:", error);
    sendError(res, 500, "Failed to generate summary", error.message);
  }
}

// ==================== HELPER FUNCTIONS ====================

async function parseBody(req) {
  return new Promise((resolve, reject) => {
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
}

async function getOrCreateDealChatThread(dealId, userId, userName) {
  const prisma = getPrisma();

  // Find existing AI chat thread for this deal
  let thread = await prisma.conversation?.findFirst({
    where: {
      dealId,
      type: 'AI_CHAT'
    }
  });

  if (!thread) {
    // Create new thread
    thread = await prisma.conversation?.create({
      data: {
        dealId,
        name: 'AI Underwriting Chat',
        type: 'AI_CHAT',
        createdBy: userId,
        createdByName: userName
      }
    });
  }

  return thread;
}

function generateFallbackResponse(message, context) {
  // Simple fallback if LLM is unavailable
  const q = message.toLowerCase();

  if (q.includes('irr') || q.includes('return')) {
    const irr = context.calculatedReturns?.irr;
    if (irr) {
      return `The projected IRR for ${context.dealName} is ${(irr * 100).toFixed(2)}%. ` +
        `This is based on the current underwriting model with a ${context.model?.holdPeriod || 5} year hold period.`;
    }
    return `IRR has not been calculated yet. Please ensure the underwriting model is complete.`;
  }

  if (q.includes('dscr') || q.includes('debt service')) {
    const dscr = context.calculatedReturns?.dscr;
    if (dscr) {
      return `The DSCR for ${context.dealName} is ${dscr.toFixed(2)}x. ` +
        (dscr >= 1.25 ? 'This meets typical lender requirements.' : 'This is below typical lender minimums of 1.25x.');
    }
    return `DSCR has not been calculated yet. Please ensure debt terms are entered.`;
  }

  if (q.includes('cap rate') || q.includes('caprate')) {
    const cap = context.calculatedReturns?.goingInCapRate;
    if (cap) {
      return `The going-in cap rate is ${(cap * 100).toFixed(2)}%. ` +
        `Market benchmarks for ${context.benchmarks.sectorName} are typically ${(context.benchmarks.metrics?.capRate?.min * 100).toFixed(1)}% - ${(context.benchmarks.metrics?.capRate?.max * 100).toFixed(1)}%.`;
    }
    return `Cap rate has not been calculated yet. Please ensure NOI and purchase price are entered.`;
  }

  if (q.includes('risk') || q.includes('concern') || q.includes('issue')) {
    if (context.conflicts?.open?.length > 0) {
      return `There are ${context.conflicts.open.length} open conflict(s) to review:\n` +
        context.conflicts.open.map(c => `- ${c.description || c.fieldPath}`).join('\n');
    }
    return `No major data conflicts detected. Review the insights panel for risk factors.`;
  }

  // Default response
  return `I have information about ${context.dealName}. You can ask me about:\n` +
    `- Returns (IRR, equity multiple, cash-on-cash)\n` +
    `- Debt metrics (DSCR, LTV, debt yield)\n` +
    `- Valuation (cap rate, price per unit)\n` +
    `- Risks and conflicts\n` +
    `- Scenarios and sensitivity analysis`;
}

function generateFallbackSummary(context, insights) {
  const { dealName, property, calculatedReturns, model, benchmarks } = context;

  let summary = `**${dealName}**\n\n`;

  // Property overview
  summary += `This ${property?.property_type || 'property'} acquisition `;
  if (property?.asset_city && property?.asset_state) {
    summary += `in ${property.asset_city}, ${property.asset_state} `;
  }
  if (property?.purchase_price) {
    summary += `at $${formatCurrencyFull(property.purchase_price)} `;
  }
  summary += `is being evaluated for investment.\n\n`;

  // Returns
  if (calculatedReturns) {
    summary += `The underwriting shows `;
    if (calculatedReturns.irr) summary += `a ${(calculatedReturns.irr * 100).toFixed(1)}% IRR, `;
    if (calculatedReturns.goingInCapRate) summary += `${(calculatedReturns.goingInCapRate * 100).toFixed(2)}% going-in cap, `;
    if (calculatedReturns.dscr) summary += `and ${calculatedReturns.dscr.toFixed(2)}x DSCR`;
    summary += `.\n\n`;
  }

  // Key risks
  const criticalInsights = insights.filter(i => i.severity === 'CRITICAL' || i.severity === 'WARNING');
  if (criticalInsights.length > 0) {
    summary += `Key considerations include: ${criticalInsights.map(i => i.title).join(', ')}.\n\n`;
  }

  return summary;
}

function formatPropertyForSummary(property) {
  if (!property) return 'No property data available.';
  const lines = [];
  if (property.property_type) lines.push(`Type: ${property.property_type}`);
  if (property.asset_address) lines.push(`Address: ${property.asset_address}`);
  if (property.asset_city && property.asset_state) lines.push(`Location: ${property.asset_city}, ${property.asset_state}`);
  if (property.purchase_price) lines.push(`Price: $${formatCurrencyFull(property.purchase_price)}`);
  if (property.unit_count) lines.push(`Units: ${property.unit_count}`);
  return lines.join('\n') || 'Limited property data.';
}

function formatReturnsForSummary(returns) {
  if (!returns) return 'Returns not calculated.';
  const lines = [];
  if (returns.irr != null) lines.push(`IRR: ${(returns.irr * 100).toFixed(2)}%`);
  if (returns.equityMultiple != null) lines.push(`Equity Multiple: ${returns.equityMultiple.toFixed(2)}x`);
  if (returns.cashOnCash != null) lines.push(`Cash-on-Cash: ${(returns.cashOnCash * 100).toFixed(2)}%`);
  if (returns.goingInCapRate != null) lines.push(`Going-In Cap: ${(returns.goingInCapRate * 100).toFixed(2)}%`);
  return lines.join('\n') || 'Returns data incomplete.';
}

function formatDebtForSummary(model, returns) {
  const lines = [];
  if (model?.loanAmount) lines.push(`Loan Amount: $${formatCurrencyFull(model.loanAmount)}`);
  if (model?.interestRate) lines.push(`Rate: ${(model.interestRate * 100).toFixed(2)}%`);
  if (returns?.dscr != null) lines.push(`DSCR: ${returns.dscr.toFixed(2)}x`);
  if (returns?.ltv != null) lines.push(`LTV: ${(returns.ltv * 100).toFixed(1)}%`);
  if (returns?.debtYield != null) lines.push(`Debt Yield: ${(returns.debtYield * 100).toFixed(2)}%`);
  return lines.join('\n') || 'Debt metrics not available.';
}

function formatInsightsForSummary(insights) {
  const critical = insights.filter(i => i.severity === 'CRITICAL');
  const warnings = insights.filter(i => i.severity === 'WARNING');
  const positive = insights.filter(i => i.severity === 'POSITIVE');

  const lines = [];
  if (critical.length > 0) {
    lines.push(`CRITICAL ISSUES: ${critical.map(i => i.title).join(', ')}`);
  }
  if (warnings.length > 0) {
    lines.push(`WARNINGS: ${warnings.map(i => i.title).join(', ')}`);
  }
  if (positive.length > 0) {
    lines.push(`POSITIVES: ${positive.map(i => i.title).join(', ')}`);
  }
  return lines.join('\n') || 'No significant insights.';
}

function formatCurrencyFull(amount) {
  if (!amount) return '0';
  return amount.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

// ==================== EXPORT PACKAGE ====================

/**
 * POST /api/deals/:dealId/export-package
 * Generate a complete deal package with all documents, model, memo, and summary
 *
 * Returns URLs for:
 * - Excel model
 * - IC Memo (markdown)
 * - Executive Summary
 * - Provenance Report
 * - All uploaded documents
 */
export async function handleExportPackage(req, res, dealId, resolveUserId) {
  const prisma = getPrisma();
  const userId = resolveUserId(req);

  if (!dealId) {
    return sendError(res, 400, "Deal ID is required");
  }

  try {
    // Build deal context for all data
    const context = await buildDealContext(dealId);

    // Generate insights
    const insights = generateInsights(context);
    const insightsSummary = getInsightsSummary(insights);

    // 1. Generate Executive Summary
    let executiveSummary;
    try {
      const summaryPrompt = `Write a concise 2-3 paragraph executive summary for this real estate investment opportunity:

PROPERTY: ${context.dealName}
${formatPropertyForSummary(context.property)}

RETURNS:
${formatReturnsForSummary(context.calculatedReturns)}

DEBT:
${formatDebtForSummary(context.model, context.calculatedReturns)}

KEY INSIGHTS:
${formatInsightsForSummary(insights)}

Write a professional executive summary suitable for an investment committee:`;

      executiveSummary = await callOpenAI([
        { role: 'system', content: 'You are a senior CRE analyst writing investment committee materials.' },
        { role: 'user', content: summaryPrompt }
      ], { model: 'gpt-4o-mini', temperature: 0.5, max_tokens: 800 });
    } catch (llmError) {
      executiveSummary = generateFallbackSummary(context, insights);
    }

    // 2. Get existing memo or generate one
    let memo = await prisma.underwritingMemo?.findFirst({
      where: { dealId }
    });

    if (!memo) {
      memo = {
        content: generateBasicMemo(context, insights)
      };
    }

    // 3. Get list of documents from kernel (Artifact is kernel-managed)
    let artifacts = [];
    try {
      const kernelArtifacts = await kernelFetchJson(`/deals/${dealId}/artifacts`);
      artifacts = (kernelArtifacts || []).map(a => ({
        id: a.id,
        fileName: a.fileName,
        documentType: a.documentType,
        mimeType: a.mimeType
      }));
    } catch (e) {
      // Kernel unavailable, artifacts will be empty
    }

    // 4. Get scenarios comparison
    const scenarios = context.scenarios || [];

    // 5. Build provenance summary
    const provenanceSummary = buildProvenanceSummary(context.inputs || []);

    // 6. Prepare the export package response
    const exportPackage = {
      dealId,
      dealName: context.dealName,
      generatedAt: new Date().toISOString(),

      // Executive summary
      executiveSummary: {
        content: executiveSummary,
        wordCount: executiveSummary.split(/\s+/).length
      },

      // Underwriting model data
      underwritingModel: {
        inputs: context.model,
        calculatedReturns: context.calculatedReturns,
        assumptions: {
          exitCapRate: context.model?.exitCapRate,
          holdPeriod: context.model?.holdPeriod,
          rentGrowth: context.model?.rentGrowth,
          expenseGrowth: context.model?.expenseGrowth
        }
      },

      // Scenarios
      scenarios: scenarios.map(s => ({
        name: s.name,
        isBaseCase: s.isBaseCase,
        assumptions: s.assumptions,
        results: s.results
      })),

      // Insights
      insights: {
        summary: insightsSummary,
        details: insights.map(i => ({
          severity: i.severity,
          category: i.category,
          message: i.message,
          recommendation: i.recommendation
        }))
      },

      // IC Memo
      memo: {
        content: memo.content || memo,
        lastUpdated: memo.updatedAt
      },

      // Documents
      documents: artifacts.map(a => ({
        id: a.id,
        name: a.fileName,
        type: a.documentType,
        downloadUrl: `/api/artifacts/${a.id}/download`
      })),

      // Provenance summary
      provenance: provenanceSummary,

      // Export options
      exportUrls: {
        excelModel: `/api/deals/${dealId}/excel-export`,
        pdfMemo: `/api/deals/${dealId}/memo/export?format=pdf`,
        provenanceReport: `/api/deals/${dealId}/provenance-report`
      }
    };

    sendJson(res, 200, exportPackage);

  } catch (error) {
    console.error("Error generating export package:", error);
    sendError(res, 500, "Failed to generate export package", error.message);
  }
}

function generateBasicMemo(context, insights) {
  const { dealName, property, calculatedReturns, model, benchmarks } = context;

  let memo = `# Investment Memo: ${dealName}\n\n`;
  memo += `**Generated:** ${new Date().toLocaleString()}\n\n`;

  // Executive Summary
  memo += `## Executive Summary\n\n`;
  if (property) {
    memo += `This memo presents the underwriting analysis for ${dealName}, `;
    memo += `a ${property.property_type || 'property'} `;
    if (property.asset_city && property.asset_state) {
      memo += `located in ${property.asset_city}, ${property.asset_state}. `;
    }
    if (property.purchase_price) {
      memo += `The acquisition price is $${formatCurrencyFull(property.purchase_price)}. `;
    }
  }
  memo += `\n\n`;

  // Property Details
  memo += `## Property Overview\n\n`;
  if (property) {
    memo += `| Attribute | Value |\n|-----------|-------|\n`;
    if (property.property_type) memo += `| Property Type | ${property.property_type} |\n`;
    if (property.asset_address) memo += `| Address | ${property.asset_address} |\n`;
    if (property.asset_city && property.asset_state) memo += `| Location | ${property.asset_city}, ${property.asset_state} |\n`;
    if (property.purchase_price) memo += `| Purchase Price | $${formatCurrencyFull(property.purchase_price)} |\n`;
    if (property.unit_count) memo += `| Unit Count | ${property.unit_count} |\n`;
    if (property.sf) memo += `| Square Feet | ${formatCurrencyFull(property.sf)} SF |\n`;
    if (property.year_built) memo += `| Year Built | ${property.year_built} |\n`;
  }
  memo += `\n`;

  // Returns
  memo += `## Investment Returns\n\n`;
  if (calculatedReturns) {
    memo += `| Metric | Value |\n|--------|-------|\n`;
    if (calculatedReturns.irr != null) memo += `| Levered IRR | ${(calculatedReturns.irr * 100).toFixed(2)}% |\n`;
    if (calculatedReturns.equityMultiple != null) memo += `| Equity Multiple | ${calculatedReturns.equityMultiple.toFixed(2)}x |\n`;
    if (calculatedReturns.cashOnCash != null) memo += `| Cash-on-Cash (Yr 1) | ${(calculatedReturns.cashOnCash * 100).toFixed(2)}% |\n`;
    if (calculatedReturns.goingInCapRate != null) memo += `| Going-In Cap Rate | ${(calculatedReturns.goingInCapRate * 100).toFixed(2)}% |\n`;
    if (model?.exitCapRate != null) memo += `| Exit Cap Rate | ${(model.exitCapRate * 100).toFixed(2)}% |\n`;
  }
  memo += `\n`;

  // Debt Metrics
  memo += `## Debt Structure\n\n`;
  if (model?.loanAmount || calculatedReturns?.dscr) {
    memo += `| Metric | Value |\n|--------|-------|\n`;
    if (model?.loanAmount) memo += `| Loan Amount | $${formatCurrencyFull(model.loanAmount)} |\n`;
    if (model?.interestRate) memo += `| Interest Rate | ${(model.interestRate * 100).toFixed(2)}% |\n`;
    if (calculatedReturns?.ltv) memo += `| LTV | ${(calculatedReturns.ltv * 100).toFixed(1)}% |\n`;
    if (calculatedReturns?.dscr) memo += `| DSCR | ${calculatedReturns.dscr.toFixed(2)}x |\n`;
    if (calculatedReturns?.debtYield) memo += `| Debt Yield | ${(calculatedReturns.debtYield * 100).toFixed(2)}% |\n`;
  }
  memo += `\n`;

  // Key Insights
  memo += `## Key Insights & Risks\n\n`;
  const critical = insights.filter(i => i.severity === 'CRITICAL');
  const warnings = insights.filter(i => i.severity === 'WARNING');
  const positive = insights.filter(i => i.severity === 'POSITIVE');

  if (critical.length > 0) {
    memo += `### Critical Issues\n`;
    critical.forEach(i => {
      memo += `- **${i.category}**: ${i.message}\n`;
      if (i.recommendation) memo += `  - *Recommendation*: ${i.recommendation}\n`;
    });
    memo += `\n`;
  }

  if (warnings.length > 0) {
    memo += `### Warnings\n`;
    warnings.forEach(i => {
      memo += `- **${i.category}**: ${i.message}\n`;
    });
    memo += `\n`;
  }

  if (positive.length > 0) {
    memo += `### Positive Factors\n`;
    positive.forEach(i => {
      memo += `- **${i.category}**: ${i.message}\n`;
    });
    memo += `\n`;
  }

  // Recommendation
  memo += `## Recommendation\n\n`;
  if (insightsSummary?.hasBlockers) {
    memo += `⚠️ **Review Required**: This deal has critical issues that should be addressed before proceeding.\n\n`;
  } else if (warnings.length > 0) {
    memo += `**Proceed with Caution**: Address noted concerns during due diligence.\n\n`;
  } else {
    memo += `**Approved for Further Review**: No significant blockers identified.\n\n`;
  }

  return memo;
}

function buildProvenanceSummary(inputs) {
  const bySource = {
    DOCUMENT: 0,
    AI_EXTRACTION: 0,
    EXCEL_IMPORT: 0,
    HUMAN_ENTRY: 0,
    CALCULATION: 0
  };

  inputs.forEach(input => {
    const source = input.sourceType || 'HUMAN_ENTRY';
    if (bySource[source] !== undefined) {
      bySource[source]++;
    }
  });

  return {
    totalInputs: inputs.length,
    bySource,
    summary: `${inputs.length} data points tracked: ` +
      `${bySource.DOCUMENT || 0} from documents, ` +
      `${bySource.AI_EXTRACTION || 0} AI-extracted, ` +
      `${bySource.EXCEL_IMPORT || 0} from Excel, ` +
      `${bySource.HUMAN_ENTRY || 0} manual entries, ` +
      `${bySource.CALCULATION || 0} calculated`
  };
}

// ========== PHASE 2.1: DOCUMENT INTELLIGENCE ROUTES ==========

/**
 * POST /api/deals/:dealId/ai/extract
 * Extract data from a document with AI
 */
export async function handleExtractDocument(req, res, dealId, authUser, readJsonBody) {
  if (DEBUG_PHASE2) {
    console.log(`[AI-DOC] Extract request: dealId=${dealId}, user=${authUser.id}`);
  }

  try {
    const body = await readJsonBody(req);
    const { documentId, documentType, options } = body;

    if (!documentId || !documentType) {
      return sendError(res, 400, "documentId and documentType are required");
    }

    console.log(`[AI-DOC] Extracting document: docId=${documentId}, type=${documentType}, deal=${dealId}`);

    const result = await extractDocument(documentId, documentType, {
      ...options,
      dealId,
      userId: authUser.id,
      organizationId: authUser.organizationId
    });

    if (DEBUG_PHASE2) {
      console.log(`[AI-DOC] Extract complete: docId=${documentId}, fields=${Object.keys(result.extractedData || {}).length}`);
    }

    sendJson(res, 200, result);
  } catch (error) {
    console.error('[AI-DOC] Extract error:', error);
    sendError(res, 500, "Failed to extract document", error.message);
  }
}

/**
 * POST /api/deals/:dealId/ai/synthesize
 * Cross-reference all documents for a deal
 */
export async function handleSynthesizeDocuments(req, res, dealId, authUser, readJsonBody) {
  if (DEBUG_PHASE2) {
    console.log(`[AI-DOC] Synthesize request: dealId=${dealId}, user=${authUser.id}`);
  }

  try {
    const body = await readJsonBody(req);

    console.log(`[AI-DOC] Synthesizing documents for deal: ${dealId}`);

    const result = await synthesizeDocuments(dealId, {
      ...body,
      organizationId: authUser.organizationId
    });

    if (DEBUG_PHASE2) {
      console.log(`[AI-DOC] Synthesize complete: dealId=${dealId}, conflicts=${result.conflicts?.length || 0}`);
    }

    sendJson(res, 200, result);
  } catch (error) {
    console.error('[AI-DOC] Synthesize error:', error);
    sendError(res, 500, "Failed to synthesize documents", error.message);
  }
}

/**
 * GET /api/deals/:dealId/ai/conflicts
 * Get all extraction conflicts for a deal
 */
export async function handleGetConflicts(req, res, dealId, authUser, url) {
  if (DEBUG_PHASE2) {
    console.log(`[AI-DOC] Get conflicts request: dealId=${dealId}`);
  }

  try {
    const status = url.searchParams.get('status') || null;
    const field = url.searchParams.get('field') || null;

    const conflicts = await getConflicts(dealId, { status, field });

    if (DEBUG_PHASE2) {
      console.log(`[AI-DOC] Conflicts retrieved: dealId=${dealId}, count=${conflicts.length}`);
    }

    sendJson(res, 200, { conflicts });
  } catch (error) {
    console.error('[AI-DOC] Get conflicts error:', error);
    sendError(res, 500, "Failed to get conflicts", error.message);
  }
}

/**
 * POST /api/deals/:dealId/ai/conflicts/:conflictId/resolve
 * Resolve an extraction conflict
 */
export async function handleResolveConflict(req, res, dealId, conflictId, authUser, readJsonBody) {
  if (DEBUG_PHASE2) {
    console.log(`[AI-DOC] Resolve conflict request: conflictId=${conflictId}, user=${authUser.id}`);
  }

  try {
    const body = await readJsonBody(req);
    const { resolvedValue, reason } = body;

    if (resolvedValue === undefined) {
      return sendError(res, 400, "resolvedValue is required");
    }

    console.log(`[AI-DOC] Resolving conflict: ${conflictId}, value=${resolvedValue}, user=${authUser.id}`);

    const result = await resolveConflict(conflictId, resolvedValue, authUser.id, reason);

    sendJson(res, 200, result);
  } catch (error) {
    console.error('[AI-DOC] Resolve conflict error:', error);
    sendError(res, 500, "Failed to resolve conflict", error.message);
  }
}

/**
 * POST /api/deals/:dealId/ai/conflicts/:conflictId/dismiss
 * Dismiss an extraction conflict
 */
export async function handleDismissConflict(req, res, dealId, conflictId, authUser, readJsonBody) {
  if (DEBUG_PHASE2) {
    console.log(`[AI-DOC] Dismiss conflict request: conflictId=${conflictId}, user=${authUser.id}`);
  }

  try {
    const body = await readJsonBody(req);
    const { reason } = body;

    if (!reason) {
      return sendError(res, 400, "reason is required to dismiss a conflict");
    }

    console.log(`[AI-DOC] Dismissing conflict: ${conflictId}, reason=${reason}, user=${authUser.id}`);

    const result = await dismissConflict(conflictId, authUser.id, reason);

    sendJson(res, 200, result);
  } catch (error) {
    console.error('[AI-DOC] Dismiss conflict error:', error);
    sendError(res, 500, "Failed to dismiss conflict", error.message);
  }
}

/**
 * GET /api/deals/:dealId/ai/extraction-report
 * Generate extraction report for a deal
 */
export async function handleGetExtractionReport(req, res, dealId, authUser) {
  if (DEBUG_PHASE2) {
    console.log(`[AI-DOC] Extraction report request: dealId=${dealId}`);
  }

  try {
    console.log(`[AI-DOC] Generating extraction report for deal: ${dealId}`);

    const report = await generateExtractionReport(dealId);

    if (DEBUG_PHASE2) {
      console.log(`[AI-DOC] Report generated: dealId=${dealId}`);
    }

    sendJson(res, 200, report);
  } catch (error) {
    console.error('[AI-DOC] Report error:', error);
    sendError(res, 500, "Failed to generate extraction report", error.message);
  }
}

// ========== PHASE 2.2: VERIFICATION AGENT ROUTES ==========

/**
 * GET /api/deals/:dealId/ai/verification-status
 * Get verification status summary
 */
export async function handleGetVerificationStatus(req, res, dealId, authUser, url) {
  if (DEBUG_PHASE2) {
    console.log(`[AI-VERIFY] Verification status request: dealId=${dealId}`);
  }

  try {
    const modelId = url.searchParams.get('modelId') || null;

    const status = await getVerificationStatus(dealId, modelId);

    if (DEBUG_PHASE2) {
      console.log(`[AI-VERIFY] Status retrieved: dealId=${dealId}, verified=${status.summary?.verified || 0}`);
    }

    sendJson(res, 200, status);
  } catch (error) {
    console.error('[AI-VERIFY] Status error:', error);
    sendError(res, 500, "Failed to get verification status", error.message);
  }
}

/**
 * GET /api/deals/:dealId/ai/lineage
 * Get all data lineage for a deal
 */
export async function handleGetLineage(req, res, dealId, authUser, url) {
  if (DEBUG_PHASE2) {
    console.log(`[AI-VERIFY] Lineage request: dealId=${dealId}`);
  }

  try {
    const modelId = url.searchParams.get('modelId') || null;

    // Uses getVerificationStatus which includes all lineage
    const status = await getVerificationStatus(dealId, modelId);

    sendJson(res, 200, {
      lineage: status.fields,
      summary: status.summary
    });
  } catch (error) {
    console.error('[AI-VERIFY] Lineage error:', error);
    sendError(res, 500, "Failed to get lineage", error.message);
  }
}

/**
 * GET /api/deals/:dealId/ai/lineage/:field
 * Get lineage for a specific field
 */
export async function handleGetFieldLineage(req, res, dealId, field, authUser, url) {
  if (DEBUG_PHASE2) {
    console.log(`[AI-VERIFY] Field lineage request: dealId=${dealId}, field=${field}`);
  }

  try {
    const modelId = url.searchParams.get('modelId') || null;

    const lineage = await getFieldLineage(dealId, modelId, field);

    if (!lineage) {
      return sendError(res, 404, "Field lineage not found");
    }

    sendJson(res, 200, lineage);
  } catch (error) {
    console.error('[AI-VERIFY] Field lineage error:', error);
    sendError(res, 500, "Failed to get field lineage", error.message);
  }
}

/**
 * POST /api/deals/:dealId/ai/lineage/:field/verify
 * Mark a field as verified
 */
export async function handleVerifyField(req, res, dealId, field, authUser, readJsonBody, url) {
  if (DEBUG_PHASE2) {
    console.log(`[AI-VERIFY] Verify field request: dealId=${dealId}, field=${field}, user=${authUser.id}`);
  }

  try {
    const modelId = url.searchParams.get('modelId') || null;
    const body = await readJsonBody(req);
    const { notes } = body;

    console.log(`[AI-VERIFY] Verifying field: dealId=${dealId}, field=${field}, user=${authUser.id}`);

    const result = await markAsVerified(dealId, modelId, field, authUser.id, notes);

    sendJson(res, 200, result);
  } catch (error) {
    console.error('[AI-VERIFY] Verify error:', error);
    sendError(res, 500, "Failed to verify field", error.message);
  }
}

/**
 * POST /api/deals/:dealId/ai/lineage/:field/needs-review
 * Mark a field as needing review
 */
export async function handleMarkNeedsReview(req, res, dealId, field, authUser, readJsonBody, url) {
  if (DEBUG_PHASE2) {
    console.log(`[AI-VERIFY] Needs review request: dealId=${dealId}, field=${field}`);
  }

  try {
    const modelId = url.searchParams.get('modelId') || null;
    const body = await readJsonBody(req);
    const { reason } = body;

    console.log(`[AI-VERIFY] Marking for review: dealId=${dealId}, field=${field}`);

    const result = await markNeedsReview(dealId, modelId, field, reason);

    sendJson(res, 200, result);
  } catch (error) {
    console.error('[AI-VERIFY] Needs review error:', error);
    sendError(res, 500, "Failed to mark field for review", error.message);
  }
}

/**
 * POST /api/deals/:dealId/ai/lineage/track
 * Track data lineage for a field
 */
export async function handleTrackLineage(req, res, dealId, authUser, readJsonBody, url) {
  if (DEBUG_PHASE2) {
    console.log(`[AI-VERIFY] Track lineage request: dealId=${dealId}`);
  }

  try {
    const modelId = url.searchParams.get('modelId') || null;
    const body = await readJsonBody(req);
    const { field, sourceInfo } = body;

    if (!field || !sourceInfo) {
      return sendError(res, 400, "field and sourceInfo are required");
    }

    console.log(`[AI-VERIFY] Tracking lineage: dealId=${dealId}, field=${field}`);

    const result = await trackDataLineage(dealId, modelId, field, sourceInfo);

    sendJson(res, 200, result);
  } catch (error) {
    console.error('[AI-VERIFY] Track lineage error:', error);
    sendError(res, 500, "Failed to track lineage", error.message);
  }
}

/**
 * POST /api/deals/:dealId/ai/lineage/bulk-verify
 * Bulk verify multiple fields
 */
export async function handleBulkVerify(req, res, dealId, authUser, readJsonBody, url) {
  if (DEBUG_PHASE2) {
    console.log(`[AI-VERIFY] Bulk verify request: dealId=${dealId}, user=${authUser.id}`);
  }

  try {
    const modelId = url.searchParams.get('modelId') || null;
    const body = await readJsonBody(req);
    const { fields, notes } = body;

    if (!Array.isArray(fields) || fields.length === 0) {
      return sendError(res, 400, "fields array is required");
    }

    console.log(`[AI-VERIFY] Bulk verifying: dealId=${dealId}, fields=${fields.length}, user=${authUser.id}`);

    const results = await bulkVerify(dealId, modelId, fields, authUser.id, notes);

    sendJson(res, 200, { results });
  } catch (error) {
    console.error('[AI-VERIFY] Bulk verify error:', error);
    sendError(res, 500, "Failed to bulk verify", error.message);
  }
}

/**
 * GET /api/deals/:dealId/ai/verification-suggestions
 * Get AI suggestions for next verification
 */
export async function handleGetVerificationSuggestions(req, res, dealId, authUser, url) {
  if (DEBUG_PHASE2) {
    console.log(`[AI-VERIFY] Suggestions request: dealId=${dealId}`);
  }

  try {
    const modelId = url.searchParams.get('modelId') || null;
    const limit = parseInt(url.searchParams.get('limit') || '5');

    const suggestions = await suggestNextVerification(dealId, modelId, { limit });

    if (DEBUG_PHASE2) {
      console.log(`[AI-VERIFY] Suggestions retrieved: dealId=${dealId}, count=${suggestions.suggestions?.length || 0}`);
    }

    sendJson(res, 200, suggestions);
  } catch (error) {
    console.error('[AI-VERIFY] Suggestions error:', error);
    sendError(res, 500, "Failed to get verification suggestions", error.message);
  }
}

/**
 * GET /api/deals/:dealId/ai/verification-history
 * Get verification history for a deal
 */
export async function handleGetVerificationHistory(req, res, dealId, authUser, url) {
  if (DEBUG_PHASE2) {
    console.log(`[AI-VERIFY] History request: dealId=${dealId}`);
  }

  try {
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const field = url.searchParams.get('field') || null;

    const history = await getVerificationHistory(dealId, { limit, field });

    if (DEBUG_PHASE2) {
      console.log(`[AI-VERIFY] History retrieved: dealId=${dealId}, count=${history.history?.length || 0}`);
    }

    sendJson(res, 200, history);
  } catch (error) {
    console.error('[AI-VERIFY] History error:', error);
    sendError(res, 500, "Failed to get verification history", error.message);
  }
}

// ========== PHASE 2.3: ASSUMPTION TRACKER ROUTES ==========

/**
 * POST /api/deals/:dealId/ai/assumptions/snapshot
 * Create assumption snapshot
 */
export async function handleCreateAssumptionSnapshot(req, res, dealId, authUser, readJsonBody) {
  if (DEBUG_PHASE2) {
    console.log(`[AI-ASSUME] Snapshot request: dealId=${dealId}, user=${authUser.id}`);
  }

  try {
    const body = await readJsonBody(req);
    const { snapshotType, assumptions, metrics, notes } = body;

    if (!snapshotType || !assumptions) {
      return sendError(res, 400, "snapshotType and assumptions are required");
    }

    console.log(`[AI-ASSUME] Creating snapshot: dealId=${dealId}, type=${snapshotType}`);

    const result = await trackAssumptions(dealId, snapshotType, assumptions, metrics, notes);

    sendJson(res, 200, result);
  } catch (error) {
    console.error('[AI-ASSUME] Snapshot error:', error);
    sendError(res, 500, "Failed to create assumption snapshot", error.message);
  }
}

/**
 * GET /api/deals/:dealId/ai/assumptions/snapshots
 * Get all assumption snapshots for a deal
 */
export async function handleGetAssumptionSnapshots(req, res, dealId, authUser) {
  if (DEBUG_PHASE2) {
    console.log(`[AI-ASSUME] Get snapshots request: dealId=${dealId}`);
  }

  try {
    const snapshots = await getDealSnapshots(dealId);

    if (DEBUG_PHASE2) {
      console.log(`[AI-ASSUME] Snapshots retrieved: dealId=${dealId}, count=${snapshots.length}`);
    }

    sendJson(res, 200, { snapshots });
  } catch (error) {
    console.error('[AI-ASSUME] Get snapshots error:', error);
    sendError(res, 500, "Failed to get assumption snapshots", error.message);
  }
}

/**
 * POST /api/deals/:dealId/ai/assumptions/compare
 * Compare assumptions to actuals
 */
export async function handleCompareAssumptions(req, res, dealId, authUser, readJsonBody) {
  if (DEBUG_PHASE2) {
    console.log(`[AI-ASSUME] Compare request: dealId=${dealId}`);
  }

  try {
    const body = await readJsonBody(req);
    const { period } = body;

    if (!period) {
      return sendError(res, 400, "period is required (e.g., 'YEAR_1')");
    }

    console.log(`[AI-ASSUME] Comparing assumptions: dealId=${dealId}, period=${period}`);

    const result = await compareToActuals(dealId, period);

    sendJson(res, 200, result);
  } catch (error) {
    console.error('[AI-ASSUME] Compare error:', error);
    sendError(res, 500, "Failed to compare assumptions", error.message);
  }
}

/**
 * GET /api/deals/:dealId/ai/assumptions/variances
 * Get variance records for a deal
 */
export async function handleGetAssumptionVariances(req, res, dealId, authUser) {
  if (DEBUG_PHASE2) {
    console.log(`[AI-ASSUME] Get variances request: dealId=${dealId}`);
  }

  try {
    const variances = await getDealVariances(dealId);

    if (DEBUG_PHASE2) {
      console.log(`[AI-ASSUME] Variances retrieved: dealId=${dealId}, count=${variances.length}`);
    }

    sendJson(res, 200, { variances });
  } catch (error) {
    console.error('[AI-ASSUME] Get variances error:', error);
    sendError(res, 500, "Failed to get assumption variances", error.message);
  }
}

/**
 * GET /api/portfolio/ai/assumption-trends
 * Get portfolio-wide assumption trends
 */
export async function handleGetPortfolioTrends(req, res, authUser, url) {
  if (DEBUG_PHASE2) {
    console.log(`[AI-ASSUME] Portfolio trends request: orgId=${authUser.organizationId}`);
  }

  try {
    const minDeals = parseInt(url.searchParams.get('minDeals') || '3');

    console.log(`[AI-ASSUME] Getting portfolio trends: orgId=${authUser.organizationId}, minDeals=${minDeals}`);

    const trends = await getPortfolioTrends(authUser.organizationId, { minDeals });

    if (DEBUG_PHASE2) {
      console.log(`[AI-ASSUME] Trends retrieved: orgId=${authUser.organizationId}`);
    }

    sendJson(res, 200, trends);
  } catch (error) {
    console.error('[AI-ASSUME] Trends error:', error);
    sendError(res, 500, "Failed to get portfolio trends", error.message);
  }
}

/**
 * POST /api/portfolio/ai/assumption-suggestions
 * Get AI-suggested assumption adjustments
 */
export async function handleGetAssumptionSuggestions(req, res, authUser, readJsonBody) {
  if (DEBUG_PHASE2) {
    console.log(`[AI-ASSUME] Suggestions request: orgId=${authUser.organizationId}`);
  }

  try {
    const body = await readJsonBody(req);
    const { proposedAssumptions, dealContext } = body;

    if (!proposedAssumptions) {
      return sendError(res, 400, "proposedAssumptions is required");
    }

    console.log(`[AI-ASSUME] Getting assumption suggestions: orgId=${authUser.organizationId}`);

    const suggestions = await suggestAssumptionAdjustments(
      authUser.organizationId,
      proposedAssumptions,
      dealContext || {}
    );

    sendJson(res, 200, suggestions);
  } catch (error) {
    console.error('[AI-ASSUME] Suggestions error:', error);
    sendError(res, 500, "Failed to get assumption suggestions", error.message);
  }
}
