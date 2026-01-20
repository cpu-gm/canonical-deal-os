import "dotenv/config";
import { createServer } from "node:http";
import { URL } from "node:url";
import { kernelRequest, proxyKernelStream } from "./kernel.js";
import { memoizeInFlight, deleteCacheByPrefix } from "./runtime.js";
import { getPrisma } from "./db.js";
import { readStore } from "./store.js";

// Import route handlers
import {
  handleListDeals,
  handleCreateDeal,
  handleDealHome,
  handleDealRecords,
  invalidateDealCaches
} from "./routes/deals.js";
import {
  handleExplain,
  handleAction,
  getOrCreateActorId
} from "./routes/actions.js";
import { handleListEvents, handleCreateEvent } from "./routes/events.js";
import { handleDealParse, handleForceAccept, handleCorrections, handleDataTrust } from "./routes/llm.js";
import { handleProvenanceUpdate } from "./routes/provenance.js";
import { handleInbox } from "./routes/inbox.js";
import {
  handleSendInvitation,
  handleAcceptInvitation,
  handleListInvitations,
  handleLPPortalLanding,
  handleLPPortalDealDetail,
  handleLPPortalExport,
  handleListLPActors,
  handleBulkLPImport,
  handleGenerateCustomReport
} from "./routes/lp-onboarding.js";
import {
  handleUploadDocument as handleLPUploadDocument,
  handleListDocuments as handleLPListDocuments,
  handleDownloadDocument as handleLPDownloadDocument,
  handleDeleteDocument as handleLPDeleteDocument,
  handleUpdatePermissions as handleLPUpdatePermissions,
  handleListLPsForDeal
} from "./routes/lp-documents.js";
import {
  handleCreateTransfer,
  handleListTransfers,
  handleGetTransfer,
  handleApproveTransfer,
  handleCompleteTransfer,
  handleCancelTransfer
} from "./routes/lp-transfers.js";
import {
  handleListShareClasses,
  handleCreateShareClass,
  handleGetShareClass,
  handleUpdateShareClass,
  handleDeleteShareClass
} from "./routes/share-classes.js";
import {
  handleGenerateMagicLink as handleLPGenerateMagicLink,
  handleValidateSession as handleLPValidateSession,
  handleRefreshSession as handleLPRefreshSession,
  handleRevokeSession as handleLPRevokeSession,
  handleLinkAccount as handleLPLinkAccount,
  handleGetPreferences as handleLPGetPreferences,
  handleUpdatePreferences as handleLPUpdatePreferences,
  handleGetMyInvestments as handleLPGetMyInvestments,
  handleGetMyInvestmentDetail as handleLPGetMyInvestmentDetail,
  handleGetMyInvestmentDocuments as handleLPGetMyInvestmentDocuments,
  handleGetLPStatement
} from "./routes/lp-portal-access.js";
import {
  handleDocumentChange,
  handleReconcileChange
} from "./routes/document-change.js";
import {
  handleIntegrationWebhook,
  handleListIntegrations,
  handleUpdateIntegration
} from "./routes/integrations.js";
import {
  handleSmartParse,
  handleSmartParseApply
} from "./routes/smart-parse.js";
import { handleHomeData } from "./routes/home.js";
import {
  handleNewsInsights,
  handleNewsAsk,
  handleNewsDismiss
} from "./routes/news-insights.js";
import {
  handleListConversations,
  handleCreateConversation,
  handleGetConversation,
  handleListMessages,
  handleSendMessage,
  handleMarkRead,
  handleJoinConversation,
  handleChatUpdates,
  handleGetDealThread,
  seedDefaultChannels
} from "./routes/chat.js";
import {
  handleListNotifications,
  handleMarkNotificationRead,
  handleMarkAllNotificationsRead,
  handleGetActivityFeed,
  handleCreateTask,
  handleListTasks,
  handleUpdateTask,
  handleSnoozeNotification,
  handleDismissNotification,
  handleGetNotificationPreferences,
  handleUpdateNotificationPreferences
} from "./routes/notifications.js";
import { startScheduler } from "./services/reminder-scheduler.js";
import {
  handleAskAI,
  handleGetSuggestions,
  handleDealChat,
  handleGetDealChatHistory,
  handleGetDealInsights,
  handleGetDealContext,
  handleDealSummarize,
  handleExportPackage,
  // Phase 2.1: Document Intelligence
  handleExtractDocument,
  handleSynthesizeDocuments,
  handleGetConflicts,
  handleResolveConflict,
  handleDismissConflict,
  handleGetExtractionReport,
  // Phase 2.2: Verification Agent
  handleGetVerificationStatus,
  handleGetLineage,
  handleGetFieldLineage,
  handleVerifyField,
  handleMarkNeedsReview,
  handleTrackLineage,
  handleBulkVerify,
  handleGetVerificationSuggestions,
  handleGetVerificationHistory,
  // Phase 2.3: Assumption Tracker
  handleCreateAssumptionSnapshot,
  handleGetAssumptionSnapshots,
  handleCompareAssumptions,
  handleGetAssumptionVariances,
  handleGetPortfolioTrends,
  handleGetAssumptionSuggestions,
} from "./routes/ai-assistant.js";

// Phase 2.4: DD Checklist AI Assistant
import {
  handleInitializeChecklist,
  handleGetChecklist,
  handleGetChecklistStatus,
  handleGetChecklistItems,
  handleGetItem,
  handleUpdateItem,
  handleAssignItem,
  handleLinkDocument,
  handleVerifyItem,
  handleMarkNA,
  handleAddCustomItem,
  handleGetItemHistory,
  handleGetTemplates,
  handleGetCategories,
  // AI features:
  handleGetSuggestions as handleGetDDSuggestions,
  handleGetRisks as handleGetDDRisks,
  handleGetSummary as handleGetDDSummary,
  handleProcessDocument as handleDDProcessDocument,
  handleGetPendingApprovals as handleGetDDPendingApprovals,
  handleApproveMatch as handleDDApproveMatch,
  handleRejectMatch as handleDDRejectMatch,
} from "./routes/dd-checklist.js";
import { autoProcessDocument } from "./services/ai/dd-checklist-assistant.js";
import {
  handleGetConsentStatus,
  handleGrantConsent,
  handleWithdrawConsent,
  handleUpdateFeatureConsent,
  handleGetPolicy,
  handleGetConsentHistory
} from "./routes/ai-consent.js";
import {
  handleListDealAssignments,
  handleAssignAnalyst,
  handleUnassignAnalyst
} from "./routes/deal-assignments.js";
import {
  handleCreateReviewRequest,
  handleListReviewRequests,
  handleGetReviewRequest,
  handleGetPendingReviewForDeal,
  handleRespondToReview,
  handleGetDealReviewHistory
} from "./routes/review-requests.js";
import {
  handleCreateMagicLink,
  handleValidateMagicLink,
  handleRevokeMagicLink,
  handleListDealMagicLinks
} from "./routes/magic-links.js";
import {
  handleGetLenderPortal,
  handleLenderApprove,
  handleLenderReject,
  handleLenderComment
} from "./routes/lender-portal.js";
import {
  handleSubmitDeal,
  handleListDealSubmissions,
  handleGetSubmission,
  handleResendSubmission,
  handleCancelSubmission
} from "./routes/deal-submissions.js";
import {
  handleEmailWebhook,
  handleListEmailIntakes,
  handleGetEmailIntake,
  handleRetryEmailIntake,
  handleSimulateEmailIntake
} from "./routes/email-intake.js";
import {
  handleExtractDocument as handleUnderwritingExtract,
  handleListExtractions,
  handleGetUnderwritingModel,
  handleUpdateUnderwritingModel,
  handleCalculateModel,
  handleListConflicts as handleUnderwritingConflicts,
  handleResolveConflict as handleUnderwritingResolveConflict,
  handleListScenarios,
  handleCreateScenario,
  handleDeleteScenario,
  handleCompareScenarios,
  handleGenerateMemo,
  handleGetMemo,
  handleUpdateMemo,
  handleApplyExtraction,
  handleGetInputHistory,
  handleGetProvenanceSummary,
  handleVerifyInput,
  handleGetCashFlows,
  handleGetScenarioCashFlows,
  handleGetWaterfall,
  handleCreateWaterfall,
  handleUpdateWaterfall,
  handleCalculateWaterfall,
  handleListWaterfallDistributions,
  handleCompareWaterfalls,
  handleGetSensitivityOptions,
  handleCalculateSensitivityMatrix,
  handleHoldPeriodSensitivity,
  handleQuickSensitivity,
  handleCreateScenarioFromSensitivity,
  // Sector endpoints
  handleGetAllSectors,
  handleGetSectorConfig,
  handleGetSectorInputs,
  handleGetSectorBenchmarks,
  handleGetSectorRisks,
  handleDetectSector,
  handleGetSectorMetrics,
  handleUpdateSectorInputs,
  handleValidateBenchmarks
} from "./routes/underwriting.js";
import {
  handleExcelUpload,
  handleListExcelImports,
  handleGetExcelImport,
  handleUpdateMappings,
  handleApplyExcelImport,
  handleGetExcelSheet,
  handleGetMappableFields,
  handleExcelExport,
  handleGetExportTemplates
} from "./routes/excel-import.js";
import {
  handleGetClaims,
  handleGetPendingClaims,
  handleGetClaimStats,
  handleGetFieldHistory,
  handleGetClaim,
  handleVerifyClaim,
  handleRejectClaim,
  handleBulkVerify as handleQueueBulkVerify,
  handleBulkReject
} from "./routes/verification-queue.js";
import {
  handleGetDealState,
  handleTransitionState,
  handleGetAvailableTransitions,
  handleGetBlockers,
  handleGetDealEvents,
  handleGetDealEvent
} from "./routes/deal-state.js";
import {
  handleGenerateDocument,
  handleListDocuments,
  handleGetDocumentVersions,
  handlePromoteDocument,
  handleDownloadDocument
} from "./routes/document-generation.js";
import {
  handleGenerateEvidencePack,
  handleListEvidencePacks,
  handleDownloadEvidencePack
} from "./routes/evidence-pack.js";
import {
  handleDebugStatus,
  handleDebugErrors,
  handleDebugClear
} from "./routes/debug.js";
import {
  handleSignup,
  handleLogin,
  handleLogout,
  handleGetMe,
  handleListOrganizations,
  extractAuthUser
} from "./routes/auth.js";
import {
  handleGetVerificationQueue,
  handleGetUsers,
  handleApproveVerification,
  handleRejectVerification,
  handleUpdateUserRole,
  handleUpdateUserStatus
} from "./routes/admin.js";
import { requireLPEntitlement } from "./middleware/auth.js";
import {
  handleListCapitalCalls,
  handleGetCapitalCall,
  handleCreateCapitalCall,
  handleIssueCapitalCall,
  handleUpdateCapitalCall,
  handleCancelCapitalCall,
  handleGetMyCapitalCalls,
  handleGetMyCapitalCallDetail,
  handleMarkWireInitiated,
  handleUploadWireProof,
  handleMarkFunded,
  handleGenerateCapitalCallNotices
} from "./routes/capital-calls.js";
import {
  handleListDistributions,
  handleGetDistribution,
  handleCreateDistribution,
  handleApproveDistribution,
  handleProcessDistribution,
  handleMarkDistributionPaid,
  handleCancelDistribution,
  handleGetMyDistributions,
  handleGetMyDistributionDetail,
  handleGenerateDistributionStatements
} from "./routes/distributions.js";
import {
  handleListInvestorUpdates,
  handleGetInvestorUpdate,
  handleCreateInvestorUpdate,
  handleUpdateInvestorUpdate,
  handlePublishInvestorUpdate,
  handleDeleteInvestorUpdate,
  handleGetMyInvestorUpdates,
  handleGetMyInvestorUpdateDetail,
  handleGetUpdateQuestions,
  handleAskQuestion,
  handleAnswerQuestion
} from "./routes/investor-updates.js";
import { dispatchIntakeRoutes } from "./routes/deal-intake.js";
import { dispatchOMRoutes } from "./routes/om-management.js";
import { dispatchSellerRoutes } from "./routes/seller-portal.js";
import { dispatchDistributionRoutes } from "./routes/distribution.js";
import { dispatchBuyerRoutes } from "./routes/buyer-portal.js";
import { dispatchPermissionGateRoutes } from "./routes/permission-gate.js";

const PORT = Number(process.env.BFF_PORT ?? 8787);
const KERNEL_BASE_URL = process.env.KERNEL_API_URL ?? "http://localhost:3001";
const HEALTH_TIMEOUT_MS = Number(process.env.BFF_HEALTH_TIMEOUT_MS ?? 2000);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-User-Id, X-Canonical-User-Id, X-Actor-Role, X-Idempotency-Key",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS"
};

const inFlight = memoizeInFlight();

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...corsHeaders
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
 * DEPRECATED: Debug-only user ID resolution from headers
 * WARNING: This function reads UNVALIDATED headers - NEVER use for authorization or data scoping
 * In production, always returns null to prevent spoofing
 * Only use for local development debugging when no auth is available
 */
function resolveDebugUserId(req) {
  // SECURITY: Disabled in production to prevent header spoofing
  if (process.env.NODE_ENV === 'production') {
    return null;
  }
  /* eslint-disable security/no-unsafe-headers -- Intentionally unsafe, gated by NODE_ENV check above */
  const candidate =
    req.headers["x-debug-user-id"] || // Renamed from x-user-id
    req.headers["x-canonical-user-id"];
  /* eslint-enable security/no-unsafe-headers */
  if (typeof candidate === "string" && candidate.trim()) {
    console.warn(`[DEBUG] Using unvalidated x-debug-user-id header: ${candidate.trim()} - DO NOT USE IN PRODUCTION`); // eslint-disable-line security/no-unsafe-headers
    return candidate.trim();
  }
  return null;
}

/**
 * DEPRECATED: Legacy resolveUserId for backwards compatibility
 * WARNING: Always prefer authUser.id from extractAuthUser()
 * This function should only be used when authUser is already validated at dispatch level
 */
function resolveUserId(req) {
  // In production, this returns 'anonymous' but callers should use authUser.id instead
  const debugId = resolveDebugUserId(req); // eslint-disable-line security/no-unsafe-headers -- Legacy function, callers should use authUser.id
  if (debugId) return debugId;
  // Fallback to authorization header (NOT validated here - just for logging/display)
  const authHeader = req.headers["authorization"];
  if (typeof authHeader === "string" && authHeader.trim()) {
    return authHeader.trim();
  }
  return "anonymous";
}

// DEPRECATED: DO NOT USE - role should come from authUser.role (validated JWT)
function resolveActorRole(req) {
  const roleHeader = req.headers["x-actor-role"]; // eslint-disable-line security/no-unsafe-headers -- Kept for backwards compat, NEVER use for authZ
  if (typeof roleHeader === "string" && roleHeader.trim()) {
    return roleHeader.trim();
  }
  return "GP";
}

function resolveUserName(req) {
  const nameHeader = req.headers["x-user-name"];
  if (typeof nameHeader === "string" && nameHeader.trim()) {
    return nameHeader.trim();
  }
  return null;
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return null;
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("Invalid JSON");
    error.status = 400;
    error.data = { message: "Invalid JSON" };
    throw error;
  }
}

// ========== DISPATCH-LEVEL AUTH HELPERS ==========
// These helpers provide authentication at the dispatch level before calling handlers
// Note: readStore is imported at the top of the file

/**
 * Require authenticated user. Returns authUser or null (sends 401).
 */
async function requireAuth(req, res) {
  const authUser = await extractAuthUser(req);
  if (!authUser) {
    sendError(res, 401, "Not authenticated");
    return null;
  }
  return authUser;
}

/**
 * Require GP or Admin role. Returns authUser or null (sends 401/403).
 */
async function requireGP(req, res) {
  const authUser = await requireAuth(req, res);
  if (!authUser) return null;

  if (!['GP', 'Admin'].includes(authUser.role)) {
    sendError(res, 403, "GP or Admin role required");
    return null;
  }
  return authUser;
}

/**
 * Require authenticated user with access to the specified deal.
 * Returns authUser or null (sends 401/403/404).
 */
async function requireDealAccess(req, res, dealId) {
  const authUser = await requireAuth(req, res);
  if (!authUser) return null;

  const store = await readStore();
  const record = store.dealIndex.find((item) => item.id === dealId);

  if (!record) {
    sendError(res, 404, "Deal not found");
    return null;
  }

  // ALWAYS enforce org isolation - no conditional bypass
  if (record.organizationId && record.organizationId !== authUser.organizationId) {
    sendError(res, 403, "Access denied - deal belongs to different organization");
    return null;
  }

  return authUser;
}

/**
 * Require GP/Admin role with deal access.
 * Returns authUser or null (sends 401/403/404).
 */
async function requireGPWithDealAccess(req, res, dealId) {
  const authUser = await requireDealAccess(req, res, dealId);
  if (!authUser) return null;

  if (!['GP', 'Admin'].includes(authUser.role)) {
    sendError(res, 403, "GP or Admin role required");
    return null;
  }

  return authUser;
}

/**
 * Require authenticated user with access to a submission (via submission→deal org isolation).
 * Returns { authUser, submission } or null (sends 401/403/404).
 */
async function requireSubmissionAccess(req, res, submissionId) {
  const authUser = await requireAuth(req, res);
  if (!authUser) return null;

  const prisma = getPrisma();
  const submission = await prisma.dealSubmission.findUnique({
    where: { id: submissionId }
  });

  if (!submission) {
    sendError(res, 404, "Submission not found");
    return null;
  }

  // Check org isolation via deal
  const store = await readStore();
  const deal = store.dealIndex.find((item) => item.id === submission.dealId);

  if (!deal) {
    sendError(res, 404, "Deal not found");
    return null;
  }

  if (deal.organizationId && deal.organizationId !== authUser.organizationId) {
    sendError(res, 403, "Access denied - submission belongs to different organization");
    return null;
  }

  return { authUser, submission };
}

/**
 * Require GP/Admin role with submission access.
 * Returns { authUser, submission } or null (sends 401/403/404).
 */
async function requireGPWithSubmissionAccess(req, res, submissionId) {
  const result = await requireSubmissionAccess(req, res, submissionId);
  if (!result) return null;

  if (!['GP', 'Admin'].includes(result.authUser.role)) {
    sendError(res, 403, "GP or Admin role required");
    return null;
  }

  return result;
}

async function handleHealth(req, res) {
  const url = new URL(req.url, "http://localhost");
  const probe = url.searchParams.get("probe");
  const baseUrl = probe === "bad" ? "http://localhost:1" : KERNEL_BASE_URL;
  const target = `${baseUrl.replace(/\/$/, "")}/health`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);

  try {
    const result = await kernelRequest(target, {
      method: "GET",
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!result.ok) {
      return sendJson(res, 502, {
        status: "kernel_unavailable",
        kernelTarget: KERNEL_BASE_URL,
        kernelProbe: target,
        kernelStatus: result.status,
        kernelBody: result.data ?? null
      });
    }
    return sendJson(res, 200, {
      status: "ok",
      kernelTarget: KERNEL_BASE_URL,
      kernelStatus: result.status
    });
  } catch (error) {
    clearTimeout(timer);
    return sendJson(res, 502, {
      status: "kernel_unavailable",
      kernelTarget: KERNEL_BASE_URL,
      kernelProbe: target,
      error: error?.message ?? "Kernel unavailable"
    });
  }
}

// Structured logging helper for BFF
function bffLog(level, category, message, meta = {}) {
  const timestamp = new Date().toISOString();
  const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
  console.log(`[${timestamp}] [${level}] [${category}] ${message}${metaStr}`);
}

async function handleRequest(req, res) {
  const startTime = Date.now();

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;

  // Log all incoming requests (except health checks to reduce noise)
  if (path !== "/health") {
    bffLog('INFO', 'REQ', `${req.method} ${path}`);
  }

  // Wrap response.end to log response status and timing
  const originalEnd = res.end.bind(res);
  res.end = function(...args) {
    const duration = Date.now() - startTime;
    if (path !== "/health") {
      const status = res.statusCode;
      const level = status >= 500 ? 'ERROR' : status >= 400 ? 'WARN' : 'INFO';
      bffLog(level, 'RES', `${req.method} ${path} → ${status} (${duration}ms)`);
    }
    return originalEnd(...args);
  };

  // Debug logging for LP routes (existing)
  if (path.includes("/api/lp/")) {
    console.log(`[LP Route] ${req.method} ${path}`);
  }

  // Health check
  if (req.method === "GET" && path === "/health") {
    return handleHealth(req, res);
  }

  // Debug routes (development only)
  if (req.method === "GET" && path === "/api/debug/status") {
    return handleDebugStatus(req, res);
  }
  if (req.method === "GET" && path === "/api/debug/errors") {
    return handleDebugErrors(req, res);
  }
  if (req.method === "POST" && path === "/api/debug/clear") {
    return handleDebugClear(req, res);
  }

  // ========== AUTHENTICATION ==========

  if (req.method === "POST" && path === "/api/auth/signup") {
    return handleSignup(req, res, readJsonBody);
  }

  if (req.method === "POST" && path === "/api/auth/login") {
    return handleLogin(req, res, readJsonBody);
  }

  if (req.method === "POST" && path === "/api/auth/logout") {
    return handleLogout(req, res);
  }

  if (req.method === "GET" && path === "/api/auth/me") {
    return handleGetMe(req, res);
  }

  if (req.method === "GET" && path === "/api/organizations/public") {
    return handleListOrganizations(req, res);
  }

  // ========== ADMIN ROUTES ==========

  if (req.method === "GET" && path === "/api/admin/verification-queue") {
    return handleGetVerificationQueue(req, res);
  }

  if (req.method === "GET" && path === "/api/admin/users") {
    return handleGetUsers(req, res);
  }

  const approveVerificationMatch = path.match(/^\/api\/admin\/verification-requests\/([^/]+)\/approve$/);
  if (req.method === "POST" && approveVerificationMatch) {
    return handleApproveVerification(req, res, approveVerificationMatch[1], readJsonBody);
  }

  const rejectVerificationMatch = path.match(/^\/api\/admin\/verification-requests\/([^/]+)\/reject$/);
  if (req.method === "POST" && rejectVerificationMatch) {
    return handleRejectVerification(req, res, rejectVerificationMatch[1], readJsonBody);
  }

  const updateUserRoleMatch = path.match(/^\/api\/admin\/users\/([^/]+)\/role$/);
  if (req.method === "PATCH" && updateUserRoleMatch) {
    return handleUpdateUserRole(req, res, updateUserRoleMatch[1], readJsonBody);
  }

  const updateUserStatusMatch = path.match(/^\/api\/admin\/users\/([^/]+)\/status$/);
  if (req.method === "PATCH" && updateUserStatusMatch) {
    return handleUpdateUserStatus(req, res, updateUserStatusMatch[1], readJsonBody);
  }

  // Deal CRUD
  if (req.method === "GET" && path === "/api/deals") {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    // SECURITY: Pass validated authUser, not spoofable headers
    return handleListDeals(req, res, KERNEL_BASE_URL, inFlight, authUser);
  }

  if (req.method === "POST" && path === "/api/deals") {
    const authUser = await extractAuthUser(req);
    return handleCreateDeal(req, res, KERNEL_BASE_URL, readJsonBody, getPrisma, resolveUserId, authUser);
  }

  // Deal details
  const recordsMatch = path.match(/^\/api\/deals\/([^/]+)\/records$/);
  if (req.method === "GET" && recordsMatch) {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    // SECURITY: Pass validated authUser, not spoofable headers
    return handleDealRecords(recordsMatch[1], res, KERNEL_BASE_URL, inFlight, req, authUser);
  }

  const homeMatch = path.match(/^\/api\/deals\/([^/]+)\/home$/);
  if (req.method === "GET" && homeMatch) {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    // SECURITY: Pass validated authUser, not spoofable headers
    return handleDealHome(homeMatch[1], res, KERNEL_BASE_URL, inFlight, req, authUser);
  }

  // Deal Assignments (GP Analyst access control)
  const assignmentsListMatch = path.match(/^\/api\/deals\/([^/]+)\/assignments$/);
  if (req.method === "GET" && assignmentsListMatch) {
    const authUser = await requireDealAccess(req, res, assignmentsListMatch[1]);
    if (!authUser) return;
    return handleListDealAssignments(req, res, assignmentsListMatch[1]);
  }
  if (req.method === "POST" && assignmentsListMatch) {
    const authUser = await requireGPWithDealAccess(req, res, assignmentsListMatch[1]);
    if (!authUser) return;
    return handleAssignAnalyst(req, res, assignmentsListMatch[1], readJsonBody, resolveUserId, resolveActorRole);
  }

  const assignmentDeleteMatch = path.match(/^\/api\/deals\/([^/]+)\/assignments\/([^/]+)$/);
  if (req.method === "DELETE" && assignmentDeleteMatch) {
    const authUser = await requireGPWithDealAccess(req, res, assignmentDeleteMatch[1]);
    if (!authUser) return;
    return handleUnassignAnalyst(req, res, assignmentDeleteMatch[1], assignmentDeleteMatch[2], resolveActorRole);
  }

  // Review Requests (Analyst → GP approval workflow)
  const reviewRequestsListMatch = path.match(/^\/api\/deals\/([^/]+)\/review-requests$/);
  if (req.method === "GET" && reviewRequestsListMatch) {
    const authUser = await requireDealAccess(req, res, reviewRequestsListMatch[1]);
    if (!authUser) return;
    return handleGetDealReviewHistory(req, res, reviewRequestsListMatch[1]);
  }
  if (req.method === "POST" && reviewRequestsListMatch) {
    const authUser = await requireDealAccess(req, res, reviewRequestsListMatch[1]);
    if (!authUser) return;
    return handleCreateReviewRequest(req, res, reviewRequestsListMatch[1], readJsonBody, resolveUserId);
  }

  const pendingReviewMatch = path.match(/^\/api\/deals\/([^/]+)\/review-requests\/pending$/);
  if (req.method === "GET" && pendingReviewMatch) {
    const authUser = await requireDealAccess(req, res, pendingReviewMatch[1]);
    if (!authUser) return;
    return handleGetPendingReviewForDeal(req, res, pendingReviewMatch[1]);
  }

  // Global review requests list (for GP inbox)
  if (req.method === "GET" && path === "/api/review-requests") {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    return handleListReviewRequests(req, res, resolveUserId);
  }

  const reviewRequestRespondMatch = path.match(/^\/api\/review-requests\/([^/]+)\/respond$/);
  if (req.method === "POST" && reviewRequestRespondMatch) {
    const authUser = await requireGP(req, res);
    if (!authUser) return;
    return handleRespondToReview(req, res, reviewRequestRespondMatch[1], readJsonBody, resolveUserId);
  }

  // SECURITY: V4 fix - pass authUser for org isolation check in handler
  const singleReviewRequestMatch = path.match(/^\/api\/review-requests\/([^/]+)$/);
  if (req.method === "GET" && singleReviewRequestMatch) {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    return handleGetReviewRequest(req, res, singleReviewRequestMatch[1], authUser);
  }

  // ========== MAGIC LINKS & LENDER PORTAL ==========

  // Create magic link (GP only)
  if (req.method === "POST" && path === "/api/magic-links") {
    const authUser = await requireGP(req, res);
    if (!authUser) return;
    return handleCreateMagicLink(req, res, readJsonBody, resolveUserId);
  }

  // Validate magic link (no auth - the link itself is the auth)
  const validateMagicLinkMatch = path.match(/^\/api\/magic-links\/([^/]+)\/validate$/);
  if (req.method === "GET" && validateMagicLinkMatch) {
    return handleValidateMagicLink(req, res, validateMagicLinkMatch[1]);
  }

  // Revoke magic link (GP only)
  const revokeMagicLinkMatch = path.match(/^\/api\/magic-links\/([^/]+)\/revoke$/);
  if (req.method === "POST" && revokeMagicLinkMatch) {
    const authUser = await requireGP(req, res);
    if (!authUser) return;
    return handleRevokeMagicLink(req, res, revokeMagicLinkMatch[1], resolveUserId);
  }

  // List magic links for a deal
  const dealMagicLinksMatch = path.match(/^\/api\/deals\/([^/]+)\/magic-links$/);
  if (req.method === "GET" && dealMagicLinksMatch) {
    const authUser = await requireDealAccess(req, res, dealMagicLinksMatch[1]);
    if (!authUser) return;
    return handleListDealMagicLinks(req, res, dealMagicLinksMatch[1]);
  }

  // Lender Portal (accessed via magic link token)
  if (req.method === "GET" && path === "/api/portal/lender") {
    const token = url.searchParams.get("token");
    if (!token) {
      return sendError(res, 400, "Token is required");
    }
    return handleGetLenderPortal(req, res, token);
  }

  if (req.method === "POST" && path === "/api/portal/lender/approve") {
    const token = url.searchParams.get("token");
    if (!token) {
      return sendError(res, 400, "Token is required");
    }
    return handleLenderApprove(req, res, token, readJsonBody);
  }

  if (req.method === "POST" && path === "/api/portal/lender/reject") {
    const token = url.searchParams.get("token");
    if (!token) {
      return sendError(res, 400, "Token is required");
    }
    return handleLenderReject(req, res, token, readJsonBody);
  }

  if (req.method === "POST" && path === "/api/portal/lender/comment") {
    const token = url.searchParams.get("token");
    if (!token) {
      return sendError(res, 400, "Token is required");
    }
    return handleLenderComment(req, res, token, readJsonBody);
  }

  // ========== DEAL SUBMISSIONS ==========

  // Submit deal to external party (GP only)
  const submitDealMatch = path.match(/^\/api\/deals\/([^/]+)\/submit$/);
  if (req.method === "POST" && submitDealMatch) {
    const authUser = await requireGPWithDealAccess(req, res, submitDealMatch[1]);
    if (!authUser) return;
    return handleSubmitDeal(req, res, submitDealMatch[1], readJsonBody, resolveUserId);
  }

  // List submissions for a deal
  const dealSubmissionsMatch = path.match(/^\/api\/deals\/([^/]+)\/submissions$/);
  if (req.method === "GET" && dealSubmissionsMatch) {
    const authUser = await requireDealAccess(req, res, dealSubmissionsMatch[1]);
    if (!authUser) return;
    return handleListDealSubmissions(req, res, dealSubmissionsMatch[1]);
  }

  // Get single submission (requires auth + org isolation via submission→deal)
  const singleSubmissionMatch = path.match(/^\/api\/submissions\/([^/]+)$/);
  if (req.method === "GET" && singleSubmissionMatch) {
    const result = await requireSubmissionAccess(req, res, singleSubmissionMatch[1]);
    if (!result) return;
    return handleGetSubmission(req, res, singleSubmissionMatch[1]);
  }

  // Resend submission (GP only + org isolation via submission→deal)
  const resendSubmissionMatch = path.match(/^\/api\/submissions\/([^/]+)\/resend$/);
  if (req.method === "POST" && resendSubmissionMatch) {
    const result = await requireGPWithSubmissionAccess(req, res, resendSubmissionMatch[1]);
    if (!result) return;
    return handleResendSubmission(req, res, resendSubmissionMatch[1], resolveUserId);
  }

  // Cancel submission (GP only + org isolation via submission→deal)
  const cancelSubmissionMatch = path.match(/^\/api\/submissions\/([^/]+)\/cancel$/);
  if (req.method === "POST" && cancelSubmissionMatch) {
    const result = await requireGPWithSubmissionAccess(req, res, cancelSubmissionMatch[1]);
    if (!result) return;
    return handleCancelSubmission(req, res, cancelSubmissionMatch[1], resolveUserId);
  }

  // ========== EMAIL-TO-DEAL INTEGRATION ==========

  // SendGrid inbound webhook (external - uses sender domain validation in handler)
  if (req.method === "POST" && path === "/api/email-intake/webhook") {
    return handleEmailWebhook(req, res);
  }

  // Simulate email intake (for testing - GP only)
  if (req.method === "POST" && path === "/api/email-intake/simulate") {
    const authUser = await requireGP(req, res);
    if (!authUser) return;
    return handleSimulateEmailIntake(req, res, readJsonBody);
  }

  // List email intakes (GP only)
  if (req.method === "GET" && path === "/api/email-intake") {
    const authUser = await requireGP(req, res);
    if (!authUser) return;
    return handleListEmailIntakes(req, res);
  }

  // Get single email intake (GP only)
  const emailIntakeMatch = path.match(/^\/api\/email-intake\/([^/]+)$/);
  if (req.method === "GET" && emailIntakeMatch) {
    const authUser = await requireGP(req, res);
    if (!authUser) return;
    return handleGetEmailIntake(req, res, emailIntakeMatch[1]);
  }

  // Retry failed email intake (GP only)
  const emailIntakeRetryMatch = path.match(/^\/api\/email-intake\/([^/]+)\/retry$/);
  if (req.method === "POST" && emailIntakeRetryMatch) {
    const authUser = await requireGP(req, res);
    if (!authUser) return;
    return handleRetryEmailIntake(req, res, emailIntakeRetryMatch[1]);
  }

  // Events
  if (req.method === "GET" && path === "/api/events") {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    return handleListEvents(req, res, KERNEL_BASE_URL, inFlight);
  }

  const eventsMatch = path.match(/^\/api\/deals\/([^/]+)\/events$/);
  if (req.method === "POST" && eventsMatch) {
    const authUser = await requireGPWithDealAccess(req, res, eventsMatch[1]);
    if (!authUser) return;
    // SECURITY: Pass validated authUser, not spoofable headers
    return handleCreateEvent(req, res, eventsMatch[1], KERNEL_BASE_URL, readJsonBody, getOrCreateActorId, invalidateDealCaches, authUser);
  }

  // Actions & Gating
  const explainMatch = path.match(/^\/api\/deals\/([^/]+)\/explain$/);
  if (req.method === "POST" && explainMatch) {
    const authUser = await requireDealAccess(req, res, explainMatch[1]);
    if (!authUser) return;
    return handleExplain(req, res, explainMatch[1], KERNEL_BASE_URL, resolveUserId, resolveActorRole);
  }

  const actionMatch = path.match(/^\/api\/deals\/([^/]+)\/actions\/([^/]+)$/);
  if (req.method === "POST" && actionMatch) {
    const authUser = await requireGPWithDealAccess(req, res, actionMatch[1]);
    if (!authUser) return;
    return handleAction(req, res, actionMatch[1], actionMatch[2], KERNEL_BASE_URL, readJsonBody, resolveUserId, resolveActorRole, inFlight);
  }

  // LLM & Provenance
  if (req.method === "POST" && path === "/api/llm/parse-deal") {
    const authUser = await requireGP(req, res);
    if (!authUser) return;
    return handleDealParse(req, res, readJsonBody, resolveUserId);
  }

  if (req.method === "POST" && path === "/api/llm/parse-deal/force-accept") {
    const authUser = await requireGP(req, res);
    if (!authUser) return;
    return handleForceAccept(req, res, readJsonBody, getPrisma);
  }

  const correctionsMatch = path.match(/^\/api\/deals\/([^/]+)\/corrections$/);
  if (req.method === "POST" && correctionsMatch) {
    const authUser = await requireDealAccess(req, res, correctionsMatch[1]);
    if (!authUser) return;
    return handleCorrections(req, res, correctionsMatch[1], readJsonBody, resolveUserId, getPrisma);
  }

  const dataTrustMatch = path.match(/^\/api\/deals\/([^/]+)\/data-trust$/);
  if (req.method === "GET" && dataTrustMatch) {
    const authUser = await requireDealAccess(req, res, dataTrustMatch[1]);
    if (!authUser) return;
    return handleDataTrust(res, dataTrustMatch[1], getPrisma);
  }

  const provenanceMatch = path.match(/^\/api\/deals\/([^/]+)\/provenance$/);
  if (req.method === "POST" && provenanceMatch) {
    const authUser = await requireDealAccess(req, res, provenanceMatch[1]);
    if (!authUser) return;
    return handleProvenanceUpdate(req, res, provenanceMatch[1], readJsonBody, KERNEL_BASE_URL, resolveUserId);
  }

  // Smart Parse (auto-extract fields from uploaded documents)
  const smartParseMatch = path.match(/^\/api\/deals\/([^/]+)\/smart-parse$/);
  if (req.method === "POST" && smartParseMatch) {
    const authUser = await requireDealAccess(req, res, smartParseMatch[1]);
    if (!authUser) return;
    return handleSmartParse(req, res, smartParseMatch[1], readJsonBody);
  }

  const smartParseApplyMatch = path.match(/^\/api\/deals\/([^/]+)\/smart-parse\/apply$/);
  if (req.method === "POST" && smartParseApplyMatch) {
    const authUser = await requireGPWithDealAccess(req, res, smartParseApplyMatch[1]);
    if (!authUser) return;
    return handleSmartParseApply(req, res, smartParseApplyMatch[1], readJsonBody, resolveUserId);
  }

  // ========== UNDERWRITING INTELLIGENCE (Phase 5) ==========

  // Extract structured data from document
  const extractMatch = path.match(/^\/api\/deals\/([^/]+)\/extract$/);
  if (req.method === "POST" && extractMatch) {
    const authUser = await requireDealAccess(req, res, extractMatch[1]);
    if (!authUser) return;
    return handleUnderwritingExtract(req, res, extractMatch[1]);
  }

  // List extractions for a deal
  const extractionsListMatch = path.match(/^\/api\/deals\/([^/]+)\/extractions$/);
  if (req.method === "GET" && extractionsListMatch) {
    const authUser = await requireDealAccess(req, res, extractionsListMatch[1]);
    if (!authUser) return;
    return handleListExtractions(req, res, extractionsListMatch[1]);
  }

  // Get underwriting model
  const underwritingMatch = path.match(/^\/api\/deals\/([^/]+)\/underwriting$/);
  if (req.method === "GET" && underwritingMatch) {
    const authUser = await requireDealAccess(req, res, underwritingMatch[1]);
    if (!authUser) return;
    return handleGetUnderwritingModel(req, res, underwritingMatch[1]);
  }
  if (req.method === "PATCH" && underwritingMatch) {
    const authUser = await requireGPWithDealAccess(req, res, underwritingMatch[1]);
    if (!authUser) return;
    return handleUpdateUnderwritingModel(req, res, underwritingMatch[1]);
  }

  // Calculate underwriting model
  const calculateMatch = path.match(/^\/api\/deals\/([^/]+)\/underwriting\/calculate$/);
  if (req.method === "POST" && calculateMatch) {
    const authUser = await requireDealAccess(req, res, calculateMatch[1]);
    if (!authUser) return;
    return handleCalculateModel(req, res, calculateMatch[1]);
  }

  // Get detailed year-by-year cash flows
  const cashFlowsMatch = path.match(/^\/api\/deals\/([^/]+)\/underwriting\/cash-flows$/);
  if (req.method === "GET" && cashFlowsMatch) {
    const authUser = await requireDealAccess(req, res, cashFlowsMatch[1]);
    if (!authUser) return;
    return handleGetCashFlows(req, res, cashFlowsMatch[1]);
  }

  // Get cash flows with scenario assumptions
  const scenarioCashFlowsMatch = path.match(/^\/api\/deals\/([^/]+)\/underwriting\/cash-flows\/scenario$/);
  if (req.method === "POST" && scenarioCashFlowsMatch) {
    const authUser = await requireDealAccess(req, res, scenarioCashFlowsMatch[1]);
    if (!authUser) return;
    return handleGetScenarioCashFlows(req, res, scenarioCashFlowsMatch[1]);
  }

  // Apply extraction to model
  const applyExtractionMatch = path.match(/^\/api\/deals\/([^/]+)\/underwriting\/apply-extraction$/);
  if (req.method === "POST" && applyExtractionMatch) {
    const authUser = await requireGPWithDealAccess(req, res, applyExtractionMatch[1]);
    if (!authUser) return;
    return handleApplyExtraction(req, res, applyExtractionMatch[1]);
  }

  // ========== PROVENANCE ROUTES ==========

  // Get provenance summary for all inputs
  const provenanceSummaryMatch = path.match(/^\/api\/deals\/([^/]+)\/inputs\/provenance$/);
  if (req.method === "GET" && provenanceSummaryMatch) {
    const authUser = await requireDealAccess(req, res, provenanceSummaryMatch[1]);
    if (!authUser) return;
    return handleGetProvenanceSummary(req, res, provenanceSummaryMatch[1]);
  }

  // Get history for specific field
  const inputHistoryMatch = path.match(/^\/api\/deals\/([^/]+)\/inputs\/([^/]+)\/history$/);
  if (req.method === "GET" && inputHistoryMatch) {
    const authUser = await requireDealAccess(req, res, inputHistoryMatch[1]);
    if (!authUser) return;
    return handleGetInputHistory(req, res, inputHistoryMatch[1], decodeURIComponent(inputHistoryMatch[2]));
  }

  // Verify input
  const verifyInputMatch = path.match(/^\/api\/deals\/([^/]+)\/inputs\/([^/]+)\/verify$/);
  if (req.method === "POST" && verifyInputMatch) {
    const authUser = await requireGPWithDealAccess(req, res, verifyInputMatch[1]);
    if (!authUser) return;
    return handleVerifyInput(req, res, verifyInputMatch[1], decodeURIComponent(verifyInputMatch[2]));
  }

  // List conflicts
  const conflictsListMatch = path.match(/^\/api\/deals\/([^/]+)\/conflicts$/);
  if (req.method === "GET" && conflictsListMatch) {
    const authUser = await requireDealAccess(req, res, conflictsListMatch[1]);
    if (!authUser) return;
    return handleUnderwritingConflicts(req, res, conflictsListMatch[1]);
  }

  // Resolve conflict
  const resolveConflictMatch = path.match(/^\/api\/deals\/([^/]+)\/conflicts\/([^/]+)\/resolve$/);
  if (req.method === "POST" && resolveConflictMatch) {
    const authUser = await requireGPWithDealAccess(req, res, resolveConflictMatch[1]);
    if (!authUser) return;
    return handleUnderwritingResolveConflict(req, res, resolveConflictMatch[1], resolveConflictMatch[2]);
  }

  // List scenarios
  const scenariosListMatch = path.match(/^\/api\/deals\/([^/]+)\/scenarios$/);
  if (req.method === "GET" && scenariosListMatch) {
    const authUser = await requireDealAccess(req, res, scenariosListMatch[1]);
    if (!authUser) return;
    return handleListScenarios(req, res, scenariosListMatch[1]);
  }
  if (req.method === "POST" && scenariosListMatch) {
    const authUser = await requireGPWithDealAccess(req, res, scenariosListMatch[1]);
    if (!authUser) return;
    return handleCreateScenario(req, res, scenariosListMatch[1]);
  }

  // Delete scenario
  const scenarioDeleteMatch = path.match(/^\/api\/deals\/([^/]+)\/scenarios\/([^/]+)$/);
  if (req.method === "DELETE" && scenarioDeleteMatch) {
    const authUser = await requireGPWithDealAccess(req, res, scenarioDeleteMatch[1]);
    if (!authUser) return;
    return handleDeleteScenario(req, res, scenarioDeleteMatch[1], scenarioDeleteMatch[2]);
  }

  // Compare scenarios
  const scenariosCompareMatch = path.match(/^\/api\/deals\/([^/]+)\/scenarios\/compare$/);
  if (req.method === "GET" && scenariosCompareMatch) {
    const authUser = await requireDealAccess(req, res, scenariosCompareMatch[1]);
    if (!authUser) return;
    return handleCompareScenarios(req, res, scenariosCompareMatch[1]);
  }

  // Generate memo
  const memoGenerateMatch = path.match(/^\/api\/deals\/([^/]+)\/memo\/generate$/);
  if (req.method === "POST" && memoGenerateMatch) {
    const authUser = await requireGPWithDealAccess(req, res, memoGenerateMatch[1]);
    if (!authUser) return;
    return handleGenerateMemo(req, res, memoGenerateMatch[1]);
  }

  // Get/update memo
  const memoMatch = path.match(/^\/api\/deals\/([^/]+)\/memo$/);
  if (req.method === "GET" && memoMatch) {
    const authUser = await requireDealAccess(req, res, memoMatch[1]);
    if (!authUser) return;
    return handleGetMemo(req, res, memoMatch[1]);
  }
  if (req.method === "PATCH" && memoMatch) {
    const authUser = await requireGPWithDealAccess(req, res, memoMatch[1]);
    if (!authUser) return;
    return handleUpdateMemo(req, res, memoMatch[1]);
  }

  // ========== EQUITY WATERFALL (Sprint 3) ==========

  // Get/create/update waterfall structure
  const waterfallMatch = path.match(/^\/api\/deals\/([^/]+)\/waterfall$/);
  if (req.method === "GET" && waterfallMatch) {
    const authUser = await requireDealAccess(req, res, waterfallMatch[1]);
    if (!authUser) return;
    return handleGetWaterfall(req, res, waterfallMatch[1]);
  }
  if (req.method === "POST" && waterfallMatch) {
    const authUser = await requireGPWithDealAccess(req, res, waterfallMatch[1]);
    if (!authUser) return;
    return handleCreateWaterfall(req, res, waterfallMatch[1]);
  }
  if (req.method === "PATCH" && waterfallMatch) {
    const authUser = await requireGPWithDealAccess(req, res, waterfallMatch[1]);
    if (!authUser) return;
    return handleUpdateWaterfall(req, res, waterfallMatch[1]);
  }

  // Calculate waterfall distributions
  const waterfallCalculateMatch = path.match(/^\/api\/deals\/([^/]+)\/waterfall\/calculate$/);
  if (req.method === "POST" && waterfallCalculateMatch) {
    const authUser = await requireDealAccess(req, res, waterfallCalculateMatch[1]);
    if (!authUser) return;
    return handleCalculateWaterfall(req, res, waterfallCalculateMatch[1]);
  }

  // List waterfall distributions
  const waterfallDistributionsMatch = path.match(/^\/api\/deals\/([^/]+)\/waterfall\/distributions$/);
  if (req.method === "GET" && waterfallDistributionsMatch) {
    const authUser = await requireDealAccess(req, res, waterfallDistributionsMatch[1]);
    if (!authUser) return;
    return handleListWaterfallDistributions(req, res, waterfallDistributionsMatch[1]);
  }

  // Compare waterfall across scenarios
  const waterfallCompareMatch = path.match(/^\/api\/deals\/([^/]+)\/waterfall\/compare$/);
  if (req.method === "POST" && waterfallCompareMatch) {
    const authUser = await requireDealAccess(req, res, waterfallCompareMatch[1]);
    if (!authUser) return;
    return handleCompareWaterfalls(req, res, waterfallCompareMatch[1]);
  }

  // ========== SENSITIVITY ANALYSIS (Sprint 4) ==========

  // Get sensitivity options (available fields and metrics)
  const sensitivityOptionsMatch = path.match(/^\/api\/deals\/([^/]+)\/sensitivity\/options$/);
  if (req.method === "GET" && sensitivityOptionsMatch) {
    const authUser = await requireDealAccess(req, res, sensitivityOptionsMatch[1]);
    if (!authUser) return;
    return handleGetSensitivityOptions(req, res, sensitivityOptionsMatch[1]);
  }

  // Calculate 2D sensitivity matrix
  const sensitivityMatrixMatch = path.match(/^\/api\/deals\/([^/]+)\/sensitivity\/matrix$/);
  if (req.method === "POST" && sensitivityMatrixMatch) {
    const authUser = await requireDealAccess(req, res, sensitivityMatrixMatch[1]);
    if (!authUser) return;
    return handleCalculateSensitivityMatrix(req, res, sensitivityMatrixMatch[1]);
  }

  // Get hold period sensitivity (IRR by exit year)
  const holdPeriodSensitivityMatch = path.match(/^\/api\/deals\/([^/]+)\/sensitivity\/hold-period$/);
  if (req.method === "GET" && holdPeriodSensitivityMatch) {
    const authUser = await requireDealAccess(req, res, holdPeriodSensitivityMatch[1]);
    if (!authUser) return;
    return handleHoldPeriodSensitivity(req, res, holdPeriodSensitivityMatch[1]);
  }

  // Get quick sensitivity summary
  const quickSensitivityMatch = path.match(/^\/api\/deals\/([^/]+)\/sensitivity\/quick$/);
  if (req.method === "GET" && quickSensitivityMatch) {
    const authUser = await requireDealAccess(req, res, quickSensitivityMatch[1]);
    if (!authUser) return;
    return handleQuickSensitivity(req, res, quickSensitivityMatch[1]);
  }

  // Create scenario from sensitivity matrix cell
  const createScenarioFromSensMatch = path.match(/^\/api\/deals\/([^/]+)\/sensitivity\/create-scenario$/);
  if (req.method === "POST" && createScenarioFromSensMatch) {
    const authUser = await requireGPWithDealAccess(req, res, createScenarioFromSensMatch[1]);
    if (!authUser) return;
    // SECURITY: Pass validated authUser, not spoofable headers
    return handleCreateScenarioFromSensitivity(req, res, createScenarioFromSensMatch[1], authUser);
  }

  // ========== SECTOR-SPECIFIC UNDERWRITING ==========

  // Get all available sectors (public reference data - auth required but no deal access)
  if (req.method === "GET" && path === "/api/sectors") {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    return handleGetAllSectors(req, res);
  }

  // Get sector configuration (public reference data - auth required)
  const sectorConfigMatch = path.match(/^\/api\/sectors\/([^/]+)$/);
  if (req.method === "GET" && sectorConfigMatch) {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    return handleGetSectorConfig(req, res, sectorConfigMatch[1]);
  }

  // Get sector inputs (public reference data - auth required)
  const sectorInputsMatch = path.match(/^\/api\/sectors\/([^/]+)\/inputs$/);
  if (req.method === "GET" && sectorInputsMatch) {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    return handleGetSectorInputs(req, res, sectorInputsMatch[1]);
  }

  // Get sector benchmarks (public reference data - auth required)
  const sectorBenchmarksMatch = path.match(/^\/api\/sectors\/([^/]+)\/benchmarks$/);
  if (req.method === "GET" && sectorBenchmarksMatch) {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    return handleGetSectorBenchmarks(req, res, sectorBenchmarksMatch[1]);
  }

  // Get sector risk factors (public reference data - auth required)
  const sectorRisksMatch = path.match(/^\/api\/sectors\/([^/]+)\/risks$/);
  if (req.method === "GET" && sectorRisksMatch) {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    return handleGetSectorRisks(req, res, sectorRisksMatch[1]);
  }

  // Detect sector from deal data
  const detectSectorMatch = path.match(/^\/api\/deals\/([^/]+)\/detect-sector$/);
  if (req.method === "POST" && detectSectorMatch) {
    const authUser = await requireDealAccess(req, res, detectSectorMatch[1]);
    if (!authUser) return;
    return handleDetectSector(req, res, detectSectorMatch[1]);
  }

  // Get sector-specific metrics for a deal
  const sectorMetricsMatch = path.match(/^\/api\/deals\/([^/]+)\/sector-metrics$/);
  if (req.method === "GET" && sectorMetricsMatch) {
    const authUser = await requireDealAccess(req, res, sectorMetricsMatch[1]);
    if (!authUser) return;
    return handleGetSectorMetrics(req, res, sectorMetricsMatch[1]);
  }

  // Update sector-specific inputs
  const sectorInputsUpdateMatch = path.match(/^\/api\/deals\/([^/]+)\/sector-inputs$/);
  if (req.method === "PATCH" && sectorInputsUpdateMatch) {
    const authUser = await requireGPWithDealAccess(req, res, sectorInputsUpdateMatch[1]);
    if (!authUser) return;
    // SECURITY: Pass validated authUser, not spoofable headers
    return handleUpdateSectorInputs(req, res, sectorInputsUpdateMatch[1], authUser);
  }

  // Validate metrics against sector benchmarks
  const validateBenchmarksMatch = path.match(/^\/api\/deals\/([^/]+)\/validate-benchmarks$/);
  if (req.method === "POST" && validateBenchmarksMatch) {
    const authUser = await requireDealAccess(req, res, validateBenchmarksMatch[1]);
    if (!authUser) return;
    return handleValidateBenchmarks(req, res, validateBenchmarksMatch[1]);
  }

  // ========== EXCEL IMPORT (Phase 5c) ==========

  // Upload and parse Excel file
  const excelUploadMatch = path.match(/^\/api\/deals\/([^/]+)\/excel-import$/);
  if (req.method === "POST" && excelUploadMatch) {
    const authUser = await requireGPWithDealAccess(req, res, excelUploadMatch[1]);
    if (!authUser) return;
    // SECURITY: Pass validated authUser, not spoofable headers
    return handleExcelUpload(req, res, excelUploadMatch[1], authUser);
  }

  // List Excel imports for a deal
  const excelImportsListMatch = path.match(/^\/api\/deals\/([^/]+)\/excel-imports$/);
  if (req.method === "GET" && excelImportsListMatch) {
    const authUser = await requireDealAccess(req, res, excelImportsListMatch[1]);
    if (!authUser) return;
    return handleListExcelImports(req, res, excelImportsListMatch[1]);
  }

  // Get specific Excel import details (requires auth - import is tied to deal)
  // SECURITY: V1 fix - pass authUser for org isolation check in handler
  const excelImportMatch = path.match(/^\/api\/excel-imports\/([^/]+)$/);
  if (req.method === "GET" && excelImportMatch) {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    return handleGetExcelImport(req, res, excelImportMatch[1], authUser);
  }

  // Update mappings for an import (requires GP)
  // SECURITY: V1 fix - pass authUser for org isolation check in handler
  const excelMappingsMatch = path.match(/^\/api\/excel-imports\/([^/]+)\/mappings$/);
  if (req.method === "PATCH" && excelMappingsMatch) {
    const authUser = await requireGP(req, res);
    if (!authUser) return;
    return handleUpdateMappings(req, res, excelMappingsMatch[1], authUser);
  }

  // Apply Excel import to underwriting model (requires GP)
  // SECURITY: V1 fix - pass authUser for org isolation check in handler
  const excelApplyMatch = path.match(/^\/api\/excel-imports\/([^/]+)\/apply$/);
  if (req.method === "POST" && excelApplyMatch) {
    const authUser = await requireGP(req, res);
    if (!authUser) return;
    return handleApplyExcelImport(req, res, excelApplyMatch[1], authUser);
  }

  // Get data for a specific sheet (requires auth)
  // SECURITY: V1 fix - pass authUser for org isolation check in handler
  const excelSheetMatch = path.match(/^\/api\/excel-imports\/([^/]+)\/sheet\/([^/]+)$/);
  if (req.method === "GET" && excelSheetMatch) {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    return handleGetExcelSheet(req, res, excelSheetMatch[1], excelSheetMatch[2], authUser);
  }

  // Get list of all mappable fields (reference data - auth required)
  if (req.method === "GET" && path === "/api/excel/mappable-fields") {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    return handleGetMappableFields(req, res);
  }

  // Get available export templates (reference data - auth required)
  if (req.method === "GET" && path === "/api/excel/templates") {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    return handleGetExportTemplates(req, res);
  }

  // Export underwriting model to Excel
  const excelExportMatch = path.match(/^\/api\/deals\/([^/]+)\/excel-export$/);
  if (req.method === "GET" && excelExportMatch) {
    const authUser = await requireDealAccess(req, res, excelExportMatch[1]);
    if (!authUser) return;
    return handleExcelExport(req, res, excelExportMatch[1]);
  }

  // Document Change (streamlined UI flow)
  const documentChangeMatch = path.match(/^\/api\/deals\/([^/]+)\/document-change$/);
  if (req.method === "POST" && documentChangeMatch) {
    const authUser = await requireGPWithDealAccess(req, res, documentChangeMatch[1]);
    if (!authUser) return;
    // SECURITY: Pass validated authUser, not spoofable headers
    return handleDocumentChange(req, res, documentChangeMatch[1], readJsonBody, authUser);
  }

  const reconcileChangeMatch = path.match(/^\/api\/deals\/([^/]+)\/reconcile-change$/);
  if (req.method === "POST" && reconcileChangeMatch) {
    const authUser = await requireGPWithDealAccess(req, res, reconcileChangeMatch[1]);
    if (!authUser) return;
    // SECURITY: Pass validated authUser, not spoofable headers
    return handleReconcileChange(req, res, reconcileChangeMatch[1], readJsonBody, authUser);
  }

  // Inbox
  if (req.method === "GET" && path === "/api/inbox") {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    return handleInbox(req, res, KERNEL_BASE_URL, resolveUserId);
  }

  // Home page data
  if (req.method === "GET" && path === "/api/home") {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    // SECURITY: Pass validated authUser, not spoofable headers
    return handleHomeData(req, res, authUser);
  }

  // News insights
  if (req.method === "GET" && path === "/api/news-insights") {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    // SECURITY: Pass validated authUser, not spoofable headers
    return handleNewsInsights(req, res, authUser);
  }

  if (req.method === "POST" && path === "/api/news-insights/ask") {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    // SECURITY: Pass validated authUser, not spoofable headers
    return handleNewsAsk(req, res, readJsonBody, authUser);
  }

  const newsDismissMatch = path.match(/^\/api\/news-insights\/([^/]+)\/dismiss$/);
  if (req.method === "POST" && newsDismissMatch) {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    return handleNewsDismiss(req, res, newsDismissMatch[1], resolveUserId);
  }

  // Draft mode proxies
  const draftStartMatch = path.match(/^\/api\/deals\/([^/]+)\/draft\/start$/);
  if (req.method === "POST" && draftStartMatch) {
    const authUser = await requireGPWithDealAccess(req, res, draftStartMatch[1]);
    if (!authUser) return;
    const target = `${KERNEL_BASE_URL}/deals/${draftStartMatch[1]}/draft/start`;
    return proxyKernelStream(req, res, target);
  }

  const draftSimulateMatch = path.match(/^\/api\/deals\/([^/]+)\/draft\/simulate-event$/);
  if (req.method === "POST" && draftSimulateMatch) {
    const authUser = await requireGPWithDealAccess(req, res, draftSimulateMatch[1]);
    if (!authUser) return;
    const target = `${KERNEL_BASE_URL}/deals/${draftSimulateMatch[1]}/draft/simulate-event`;
    return proxyKernelStream(req, res, target);
  }

  const draftGatesMatch = path.match(/^\/api\/deals\/([^/]+)\/draft\/gates$/);
  if (req.method === "GET" && draftGatesMatch) {
    const authUser = await requireDealAccess(req, res, draftGatesMatch[1]);
    if (!authUser) return;
    const target = `${KERNEL_BASE_URL}/deals/${draftGatesMatch[1]}/draft/gates`;
    return proxyKernelStream(req, res, target);
  }

  const draftDiffMatch = path.match(/^\/api\/deals\/([^/]+)\/draft\/diff$/);
  if (req.method === "GET" && draftDiffMatch) {
    const authUser = await requireDealAccess(req, res, draftDiffMatch[1]);
    if (!authUser) return;
    const target = `${KERNEL_BASE_URL}/deals/${draftDiffMatch[1]}/draft/diff`;
    return proxyKernelStream(req, res, target);
  }

  const draftRevertMatch = path.match(/^\/api\/deals\/([^/]+)\/draft\/revert$/);
  if (req.method === "POST" && draftRevertMatch) {
    const authUser = await requireGPWithDealAccess(req, res, draftRevertMatch[1]);
    if (!authUser) return;
    const target = `${KERNEL_BASE_URL}/deals/${draftRevertMatch[1]}/draft/revert`;
    return proxyKernelStream(req, res, target, {
      onComplete: () => {
        invalidateDealCaches(draftRevertMatch[1]);
      }
    });
  }

  const draftCommitMatch = path.match(/^\/api\/deals\/([^/]+)\/draft\/commit$/);
  if (req.method === "POST" && draftCommitMatch) {
    const authUser = await requireGPWithDealAccess(req, res, draftCommitMatch[1]);
    if (!authUser) return;
    const target = `${KERNEL_BASE_URL}/deals/${draftCommitMatch[1]}/draft/commit`;
    return proxyKernelStream(req, res, target, {
      onComplete: () => {
        invalidateDealCaches(draftCommitMatch[1]);
      }
    });
  }

  // Artifacts - with DD auto-processing on upload
  const artifactMatch = path.match(/^\/api\/deals\/([^/]+)\/artifacts$/);
  if (artifactMatch) {
    const dealId = artifactMatch[1];
    const authUser = req.method === "POST"
      ? await requireGPWithDealAccess(req, res, dealId)
      : await requireDealAccess(req, res, dealId);
    if (!authUser) return;

    // For POST requests, check if deal has DD checklist for auto-processing
    if (req.method === "POST") {
      // Use non-streaming approach to capture response for DD processing
      const prisma = getPrisma();
      try {
        const result = await kernelRequest(
          `${KERNEL_BASE_URL}/deals/${dealId}/artifacts`,
          {
            method: "POST",
            body: req,
            headers: {
              ...Object.fromEntries(
                Object.entries(req.headers).filter(([k]) =>
                  !["host", "connection", "content-length"].includes(k.toLowerCase())
                )
              )
            }
          }
        );

        if (result.ok && result.data) {
          invalidateDealCaches(dealId);

          // Check for DD checklist and trigger auto-processing
          const deal = await prisma.deal.findUnique({
            where: { id: dealId },
            select: { ddChecklist: { select: { id: true } } }
          });

          if (deal?.ddChecklist && result.data.id) {
            console.log(`[DD-AUTO] Triggering auto-process for artifact ${result.data.id} in deal ${dealId}`);
            // Run asynchronously - don't block the response
            setImmediate(async () => {
              try {
                await autoProcessDocument(dealId, result.data.id, {
                  uploadedBy: authUser.id,
                  source: 'DATA_ROOM_UPLOAD',
                  filename: result.data.filename || result.data.name
                });
                console.log(`[DD-AUTO] Auto-process complete for artifact ${result.data.id}`);
              } catch (error) {
                console.error(`[DD-AUTO] Auto-process failed for artifact ${result.data.id}:`, error.message);
              }
            });
          }

          // Return the kernel response
          res.writeHead(result.status, {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*"
          });
          return res.end(JSON.stringify(result.data));
        } else {
          // Return kernel error response
          res.writeHead(result.status || 500, {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*"
          });
          return res.end(JSON.stringify(result.data || { error: result.error }));
        }
      } catch (error) {
        console.error("[Artifacts] Upload error:", error);
        res.writeHead(500, {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*"
        });
        return res.end(JSON.stringify({ error: error.message }));
      }
    }

    // GET requests - use streaming proxy
    return proxyKernelStream(
      req,
      res,
      `${KERNEL_BASE_URL}/deals/${dealId}/artifacts`
    );
  }

  const proofpackMatch = path.match(/^\/api\/deals\/([^/]+)\/proofpack$/);
  if (proofpackMatch) {
    const authUser = await requireDealAccess(req, res, proofpackMatch[1]);
    if (!authUser) return;
    const target = `${KERNEL_BASE_URL}/deals/${proofpackMatch[1]}/proofpack${url.search}`;
    return proxyKernelStream(req, res, target);
  }

  // LP Onboarding Routes
  if (req.method === "POST" && path === "/api/lp/invitations") {
    const authUser = await requireGP(req, res);
    if (!authUser) return;
    return handleSendInvitation(req, res, readJsonBody, KERNEL_BASE_URL, resolveUserId);
  }

  // Accept invitation - no auth required (the invitation token is the auth)
  const acceptInvitationMatch = path.match(/^\/api\/lp\/invitations\/([^/]+)\/accept$/);
  if (req.method === "POST" && acceptInvitationMatch) {
    return handleAcceptInvitation(req, res, acceptInvitationMatch[1], readJsonBody, KERNEL_BASE_URL);
  }

  const listInvitationsMatch = path.match(/^\/api\/lp\/deals\/([^/]+)\/invitations$/);
  if (req.method === "GET" && listInvitationsMatch) {
    const authUser = await requireDealAccess(req, res, listInvitationsMatch[1]);
    if (!authUser) return;
    return handleListInvitations(req, res, listInvitationsMatch[1], KERNEL_BASE_URL);
  }

  // LP Portal landing - requires LP entitlement via JWT or portal token
  // SECURITY: Uses requireLPEntitlement which validates credentials, not raw headers
  if (req.method === "GET" && path === "/api/lp/portal") {
    const token = url.searchParams.get("token");
    const lpContext = await requireLPEntitlement(req, res, null, token);
    if (!lpContext) return; // Response already sent
    return handleLPPortalLanding(req, res, KERNEL_BASE_URL, lpContext.lpEmail);
  }

  // LP Portal deal detail - requires LP entitlement for specific deal
  // SECURITY: Uses requireLPEntitlement which validates credentials, not raw headers
  const lpPortalDetailMatch = path.match(/^\/api\/lp\/portal\/deals\/([^/]+)$/);
  if (req.method === "GET" && lpPortalDetailMatch) {
    const dealId = lpPortalDetailMatch[1];
    const token = url.searchParams.get("token");
    const lpContext = await requireLPEntitlement(req, res, dealId, token);
    if (!lpContext) return; // Response already sent
    return handleLPPortalDealDetail(req, res, dealId, KERNEL_BASE_URL, lpContext.lpEmail);
  }

  // LP Portal report export - requires LP entitlement for specific deal
  // SECURITY: Uses requireLPEntitlement which validates credentials, not raw headers
  const lpPortalExportMatch = path.match(/^\/api\/lp\/portal\/deals\/([^/]+)\/report$/);
  if (req.method === "GET" && lpPortalExportMatch) {
    const dealId = lpPortalExportMatch[1];
    const token = url.searchParams.get("token");
    const lpContext = await requireLPEntitlement(req, res, dealId, token);
    if (!lpContext) return; // Response already sent
    return handleLPPortalExport(req, res, dealId, KERNEL_BASE_URL, lpContext.lpEmail);
  }

  const lpActorsMatch = path.match(/^\/api\/lp\/actors\/([^/]+)$/);
  if (req.method === "GET" && lpActorsMatch) {
    const authUser = await requireDealAccess(req, res, lpActorsMatch[1]);
    if (!authUser) return;
    return handleListLPActors(req, res, lpActorsMatch[1], KERNEL_BASE_URL);
  }

  // Bulk LP Import (GP only)
  if (req.method === "POST" && path === "/api/lp/bulk-import") {
    const authUser = await requireGP(req, res);
    if (!authUser) return;
    return handleBulkLPImport(req, res, readJsonBody, KERNEL_BASE_URL, resolveUserId);
  }

  // Custom Reports (GP only)
  if (req.method === "POST" && path === "/api/lp/reports/generate") {
    const authUser = await requireGP(req, res);
    if (!authUser) return;
    return handleGenerateCustomReport(req, res, readJsonBody, KERNEL_BASE_URL, resolveUserId);
  }

  // LP Document Management Routes (GP only for uploads/management)
  if (req.method === "POST" && path === "/api/lp/documents") {
    const authUser = await requireGP(req, res);
    if (!authUser) return;
    return handleLPUploadDocument(req, res, readJsonBody, resolveUserId, resolveUserName);
  }

  const lpDocumentsListMatch = path.match(/^\/api\/lp\/documents\/([^/]+)$/);
  if (req.method === "GET" && lpDocumentsListMatch) {
    const authUser = await requireDealAccess(req, res, lpDocumentsListMatch[1]);
    if (!authUser) return;
    const lpActorId = parsedUrl.searchParams.get("lpActorId");
    return handleLPListDocuments(req, res, lpDocumentsListMatch[1], lpActorId);
  }

  const lpDocumentDownloadMatch = path.match(/^\/api\/lp\/documents\/([^/]+)\/([^/]+)$/);
  if (req.method === "GET" && lpDocumentDownloadMatch) {
    const authUser = await requireDealAccess(req, res, lpDocumentDownloadMatch[1]);
    if (!authUser) return;
    const lpActorId = parsedUrl.searchParams.get("lpActorId");
    return handleLPDownloadDocument(req, res, lpDocumentDownloadMatch[1], lpDocumentDownloadMatch[2], lpActorId);
  }

  // SECURITY: V3 fix - pass authUser for org isolation check in handler
  const lpDocumentDeleteMatch = path.match(/^\/api\/lp\/documents\/([^/]+)$/);
  if (req.method === "DELETE" && lpDocumentDeleteMatch) {
    const authUser = await requireGP(req, res);
    if (!authUser) return;
    return handleLPDeleteDocument(req, res, lpDocumentDeleteMatch[1], authUser);
  }

  // SECURITY: V3 fix - pass authUser for org isolation check in handler
  const lpDocumentPermissionsMatch = path.match(/^\/api\/lp\/documents\/([^/]+)\/permissions$/);
  if (req.method === "PUT" && lpDocumentPermissionsMatch) {
    const authUser = await requireGP(req, res);
    if (!authUser) return;
    return handleLPUpdatePermissions(req, res, lpDocumentPermissionsMatch[1], readJsonBody, authUser);
  }

  const lpDealLPsMatch = path.match(/^\/api\/lp\/documents\/([^/]+)\/lps$/);
  if (req.method === "GET" && lpDealLPsMatch) {
    const authUser = await requireDealAccess(req, res, lpDealLPsMatch[1]);
    if (!authUser) return;
    return handleListLPsForDeal(req, res, lpDealLPsMatch[1]);
  }

  // LP Portal Access Routes
  // Generate magic link for LP portal (GP only - creates link for LP)
  if (req.method === "POST" && path === "/api/lp/portal/magic-link") {
    const authUser = await requireGP(req, res);
    if (!authUser) return;
    return handleLPGenerateMagicLink(req, res, readJsonBody, resolveUserId);
  }

  // Validate LP session (token-based - handler validates)
  const lpSessionValidateMatch = path.match(/^\/api\/lp\/portal\/session\/([^/]+)$/);
  if (req.method === "GET" && lpSessionValidateMatch) {
    return handleLPValidateSession(req, res, lpSessionValidateMatch[1]);
  }

  // Refresh LP session (token-based - handler validates)
  const lpSessionRefreshMatch = path.match(/^\/api\/lp\/portal\/session\/([^/]+)\/refresh$/);
  if (req.method === "POST" && lpSessionRefreshMatch) {
    return handleLPRefreshSession(req, res, lpSessionRefreshMatch[1]);
  }

  // Revoke LP session (token-based - handler validates)
  const lpSessionRevokeMatch = path.match(/^\/api\/lp\/portal\/session\/([^/]+)$/);
  if (req.method === "DELETE" && lpSessionRevokeMatch) {
    return handleLPRevokeSession(req, res, lpSessionRevokeMatch[1]);
  }

  // Link LP account to auth user (requires auth)
  if (req.method === "POST" && path === "/api/lp/portal/link-account") {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    return handleLPLinkAccount(req, res, readJsonBody);
  }

  // Get LP preferences (requires auth)
  // SECURITY: V8 fix - pass authUser for ownership verification in handler
  if (req.method === "GET" && path === "/api/lp/preferences") {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    const lpActorId = url.searchParams.get("lpActorId");
    return handleLPGetPreferences(req, res, lpActorId, authUser);
  }

  // Update LP preferences (requires auth)
  // SECURITY: V8 fix - pass authUser for ownership verification in handler
  if (req.method === "PUT" && path === "/api/lp/preferences") {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    return handleLPUpdatePreferences(req, res, readJsonBody, authUser);
  }

  // LP Portal - Authenticated LP user endpoints
  if (req.method === "GET" && path === "/api/lp/portal/my-investments") {
    const authUser = await extractAuthUser(req);
    return handleLPGetMyInvestments(req, res, authUser);
  }

  const lpMyInvestmentDetailMatch = path.match(/^\/api\/lp\/portal\/my-investments\/([^/]+)$/);
  if (req.method === "GET" && lpMyInvestmentDetailMatch) {
    const authUser = await extractAuthUser(req);
    return handleLPGetMyInvestmentDetail(req, res, authUser, lpMyInvestmentDetailMatch[1]);
  }

  const lpMyInvestmentDocsMatch = path.match(/^\/api\/lp\/portal\/my-investments\/([^/]+)\/documents$/);
  if (req.method === "GET" && lpMyInvestmentDocsMatch) {
    const authUser = await extractAuthUser(req);
    return handleLPGetMyInvestmentDocuments(req, res, authUser, lpMyInvestmentDocsMatch[1]);
  }

  // LP Statement - comprehensive financial summary
  const lpStatementMatch = path.match(/^\/api\/lp\/portal\/my-investments\/([^/]+)\/statement$/);
  if (req.method === "GET" && lpStatementMatch) {
    const authUser = await extractAuthUser(req);
    return handleGetLPStatement(req, res, authUser, lpStatementMatch[1]);
  }

  // ========== LP TRANSFERS (Interest Assignments) ==========

  // List LP transfers for a deal
  const lpTransfersListMatch = path.match(/^\/api\/deals\/([^/]+)\/lp-transfers$/);
  if (req.method === "GET" && lpTransfersListMatch) {
    const authUser = await requireDealAccess(req, res, lpTransfersListMatch[1]);
    if (!authUser) return;
    return handleListTransfers(req, res, lpTransfersListMatch[1], parsedUrl);
  }

  // Create LP transfer
  if (req.method === "POST" && lpTransfersListMatch) {
    const authUser = await requireGPWithDealAccess(req, res, lpTransfersListMatch[1]);
    if (!authUser) return;
    return handleCreateTransfer(req, res, lpTransfersListMatch[1], readJsonBody);
  }

  // Get single LP transfer
  const lpTransferDetailMatch = path.match(/^\/api\/deals\/([^/]+)\/lp-transfers\/([^/]+)$/);
  if (req.method === "GET" && lpTransferDetailMatch) {
    const authUser = await requireDealAccess(req, res, lpTransferDetailMatch[1]);
    if (!authUser) return;
    return handleGetTransfer(req, res, lpTransferDetailMatch[1], lpTransferDetailMatch[2]);
  }

  // Approve LP transfer
  const lpTransferApproveMatch = path.match(/^\/api\/deals\/([^/]+)\/lp-transfers\/([^/]+)\/approve$/);
  if (req.method === "POST" && lpTransferApproveMatch) {
    const authUser = await requireGPWithDealAccess(req, res, lpTransferApproveMatch[1]);
    if (!authUser) return;
    return handleApproveTransfer(req, res, lpTransferApproveMatch[1], lpTransferApproveMatch[2], readJsonBody);
  }

  // Complete LP transfer
  const lpTransferCompleteMatch = path.match(/^\/api\/deals\/([^/]+)\/lp-transfers\/([^/]+)\/complete$/);
  if (req.method === "POST" && lpTransferCompleteMatch) {
    const authUser = await requireGPWithDealAccess(req, res, lpTransferCompleteMatch[1]);
    if (!authUser) return;
    return handleCompleteTransfer(req, res, lpTransferCompleteMatch[1], lpTransferCompleteMatch[2]);
  }

  // Cancel LP transfer
  const lpTransferCancelMatch = path.match(/^\/api\/deals\/([^/]+)\/lp-transfers\/([^/]+)\/cancel$/);
  if (req.method === "POST" && lpTransferCancelMatch) {
    const authUser = await requireGPWithDealAccess(req, res, lpTransferCancelMatch[1]);
    if (!authUser) return;
    return handleCancelTransfer(req, res, lpTransferCancelMatch[1], lpTransferCancelMatch[2], readJsonBody);
  }

  // ========== SHARE CLASSES ==========

  // List share classes for a deal
  const shareClassListMatch = path.match(/^\/api\/deals\/([^/]+)\/share-classes$/);
  if (req.method === "GET" && shareClassListMatch) {
    return handleListShareClasses(req, res, shareClassListMatch[1]);
  }
  if (req.method === "POST" && shareClassListMatch) {
    return handleCreateShareClass(req, res, shareClassListMatch[1], readJsonBody);
  }

  // Get/Update/Delete share class
  const shareClassDetailMatch = path.match(/^\/api\/deals\/([^/]+)\/share-classes\/([^/]+)$/);
  if (req.method === "GET" && shareClassDetailMatch) {
    return handleGetShareClass(req, res, shareClassDetailMatch[1], shareClassDetailMatch[2]);
  }
  if (req.method === "PATCH" && shareClassDetailMatch) {
    return handleUpdateShareClass(req, res, shareClassDetailMatch[1], shareClassDetailMatch[2], readJsonBody);
  }
  if (req.method === "DELETE" && shareClassDetailMatch) {
    return handleDeleteShareClass(req, res, shareClassDetailMatch[1], shareClassDetailMatch[2]);
  }

  // ========== CAPITAL CALLS ==========

  // GP: List capital calls for a deal
  const capitalCallsListMatch = path.match(/^\/api\/deals\/([^/]+)\/capital-calls$/);
  if (req.method === "GET" && capitalCallsListMatch) {
    const authUser = await requireDealAccess(req, res, capitalCallsListMatch[1]);
    if (!authUser) return;
    return handleListCapitalCalls(req, res, capitalCallsListMatch[1]);
  }
  if (req.method === "POST" && capitalCallsListMatch) {
    const authUser = await requireGPWithDealAccess(req, res, capitalCallsListMatch[1]);
    if (!authUser) return;
    // SECURITY: Use authUser.id/name from validated JWT, NOT spoofable headers
    return handleCreateCapitalCall(req, res, capitalCallsListMatch[1], readJsonBody, authUser.id, authUser.name);
  }

  // GP: Get single capital call
  const capitalCallDetailMatch = path.match(/^\/api\/deals\/([^/]+)\/capital-calls\/([^/]+)$/);
  if (req.method === "GET" && capitalCallDetailMatch) {
    const authUser = await requireDealAccess(req, res, capitalCallDetailMatch[1]);
    if (!authUser) return;
    return handleGetCapitalCall(req, res, capitalCallDetailMatch[1], capitalCallDetailMatch[2]);
  }
  if (req.method === "PATCH" && capitalCallDetailMatch) {
    const authUser = await requireGPWithDealAccess(req, res, capitalCallDetailMatch[1]);
    if (!authUser) return;
    return handleUpdateCapitalCall(req, res, capitalCallDetailMatch[1], capitalCallDetailMatch[2], readJsonBody);
  }

  // GP: Issue capital call
  const capitalCallIssueMatch = path.match(/^\/api\/deals\/([^/]+)\/capital-calls\/([^/]+)\/issue$/);
  if (req.method === "POST" && capitalCallIssueMatch) {
    const authUser = await requireGPWithDealAccess(req, res, capitalCallIssueMatch[1]);
    if (!authUser) return;
    // SECURITY: Use authUser.id/name from validated JWT, NOT spoofable headers
    return handleIssueCapitalCall(req, res, capitalCallIssueMatch[1], capitalCallIssueMatch[2], authUser.id, authUser.name);
  }

  // GP: Cancel capital call
  const capitalCallCancelMatch = path.match(/^\/api\/deals\/([^/]+)\/capital-calls\/([^/]+)\/cancel$/);
  if (req.method === "POST" && capitalCallCancelMatch) {
    const authUser = await requireGPWithDealAccess(req, res, capitalCallCancelMatch[1]);
    if (!authUser) return;
    return handleCancelCapitalCall(req, res, capitalCallCancelMatch[1], capitalCallCancelMatch[2]);
  }

  // GP: Mark allocation as funded
  const capitalCallMarkFundedMatch = path.match(/^\/api\/deals\/([^/]+)\/capital-calls\/([^/]+)\/allocations\/([^/]+)\/mark-funded$/);
  if (req.method === "POST" && capitalCallMarkFundedMatch) {
    const authUser = await requireGPWithDealAccess(req, res, capitalCallMarkFundedMatch[1]);
    if (!authUser) return;
    return handleMarkFunded(req, res, capitalCallMarkFundedMatch[1], capitalCallMarkFundedMatch[2], capitalCallMarkFundedMatch[3], readJsonBody);
  }

  // GP: Generate capital call notices for all LPs
  const capitalCallGenerateNoticesMatch = path.match(/^\/api\/deals\/([^/]+)\/capital-calls\/([^/]+)\/generate-notices$/);
  if (req.method === "POST" && capitalCallGenerateNoticesMatch) {
    const authUser = await requireGPWithDealAccess(req, res, capitalCallGenerateNoticesMatch[1]);
    if (!authUser) return;
    return handleGenerateCapitalCallNotices(req, res, capitalCallGenerateNoticesMatch[1], capitalCallGenerateNoticesMatch[2], authUser.id, authUser.name);
  }

  // LP: Get my capital calls for an investment
  const lpMyCapitalCallsMatch = path.match(/^\/api\/lp\/portal\/my-investments\/([^/]+)\/capital-calls$/);
  if (req.method === "GET" && lpMyCapitalCallsMatch) {
    const authUser = await extractAuthUser(req);
    return handleGetMyCapitalCalls(req, res, authUser, lpMyCapitalCallsMatch[1]);
  }

  // LP: Get single capital call detail
  const lpMyCapitalCallDetailMatch = path.match(/^\/api\/lp\/portal\/my-investments\/([^/]+)\/capital-calls\/([^/]+)$/);
  if (req.method === "GET" && lpMyCapitalCallDetailMatch) {
    const authUser = await extractAuthUser(req);
    return handleGetMyCapitalCallDetail(req, res, authUser, lpMyCapitalCallDetailMatch[1], lpMyCapitalCallDetailMatch[2]);
  }

  // LP: Mark wire initiated
  const lpWireInitiatedMatch = path.match(/^\/api\/lp\/portal\/my-investments\/([^/]+)\/capital-calls\/([^/]+)\/wire-initiated$/);
  if (req.method === "POST" && lpWireInitiatedMatch) {
    const authUser = await extractAuthUser(req);
    return handleMarkWireInitiated(req, res, authUser, lpWireInitiatedMatch[1], lpWireInitiatedMatch[2], readJsonBody);
  }

  // LP: Upload wire proof
  const lpUploadProofMatch = path.match(/^\/api\/lp\/portal\/my-investments\/([^/]+)\/capital-calls\/([^/]+)\/upload-proof$/);
  if (req.method === "POST" && lpUploadProofMatch) {
    const authUser = await extractAuthUser(req);
    return handleUploadWireProof(req, res, authUser, lpUploadProofMatch[1], lpUploadProofMatch[2], readJsonBody);
  }

  // ========== DISTRIBUTIONS ==========

  // GP: List distributions for a deal
  const distributionsListMatch = path.match(/^\/api\/deals\/([^/]+)\/distributions$/);
  if (req.method === "GET" && distributionsListMatch) {
    const authUser = await requireDealAccess(req, res, distributionsListMatch[1]);
    if (!authUser) return;
    return handleListDistributions(req, res, distributionsListMatch[1]);
  }
  if (req.method === "POST" && distributionsListMatch) {
    const authUser = await requireGPWithDealAccess(req, res, distributionsListMatch[1]);
    if (!authUser) return;
    // SECURITY: Use authUser.id/name from validated JWT, NOT spoofable headers
    return handleCreateDistribution(req, res, distributionsListMatch[1], readJsonBody, authUser.id, authUser.name);
  }

  // GP: Get single distribution
  const distributionDetailMatch = path.match(/^\/api\/deals\/([^/]+)\/distributions\/([^/]+)$/);
  if (req.method === "GET" && distributionDetailMatch) {
    const authUser = await requireDealAccess(req, res, distributionDetailMatch[1]);
    if (!authUser) return;
    return handleGetDistribution(req, res, distributionDetailMatch[1], distributionDetailMatch[2]);
  }

  // GP: Approve distribution
  const distributionApproveMatch = path.match(/^\/api\/deals\/([^/]+)\/distributions\/([^/]+)\/approve$/);
  if (req.method === "POST" && distributionApproveMatch) {
    const authUser = await requireGPWithDealAccess(req, res, distributionApproveMatch[1]);
    if (!authUser) return;
    // SECURITY: Use authUser.id/name from validated JWT, NOT spoofable headers
    return handleApproveDistribution(req, res, distributionApproveMatch[1], distributionApproveMatch[2], authUser.id, authUser.name);
  }

  // GP: Process distribution
  const distributionProcessMatch = path.match(/^\/api\/deals\/([^/]+)\/distributions\/([^/]+)\/process$/);
  if (req.method === "POST" && distributionProcessMatch) {
    const authUser = await requireGPWithDealAccess(req, res, distributionProcessMatch[1]);
    if (!authUser) return;
    return handleProcessDistribution(req, res, distributionProcessMatch[1], distributionProcessMatch[2]);
  }

  // GP: Cancel distribution
  const distributionCancelMatch = path.match(/^\/api\/deals\/([^/]+)\/distributions\/([^/]+)\/cancel$/);
  if (req.method === "POST" && distributionCancelMatch) {
    const authUser = await requireGPWithDealAccess(req, res, distributionCancelMatch[1]);
    if (!authUser) return;
    return handleCancelDistribution(req, res, distributionCancelMatch[1], distributionCancelMatch[2]);
  }

  // GP: Mark allocation as paid
  const distributionMarkPaidMatch = path.match(/^\/api\/deals\/([^/]+)\/distributions\/([^/]+)\/allocations\/([^/]+)\/mark-paid$/);
  if (req.method === "POST" && distributionMarkPaidMatch) {
    const authUser = await requireGPWithDealAccess(req, res, distributionMarkPaidMatch[1]);
    if (!authUser) return;
    return handleMarkDistributionPaid(req, res, distributionMarkPaidMatch[1], distributionMarkPaidMatch[2], distributionMarkPaidMatch[3], readJsonBody);
  }

  // GP: Generate distribution statements for all LPs
  const distributionGenerateStatementsMatch = path.match(/^\/api\/deals\/([^/]+)\/distributions\/([^/]+)\/generate-statements$/);
  if (req.method === "POST" && distributionGenerateStatementsMatch) {
    const authUser = await requireGPWithDealAccess(req, res, distributionGenerateStatementsMatch[1]);
    if (!authUser) return;
    return handleGenerateDistributionStatements(req, res, distributionGenerateStatementsMatch[1], distributionGenerateStatementsMatch[2], authUser.id, authUser.name);
  }

  // LP: Get my distributions for an investment
  const lpMyDistributionsMatch = path.match(/^\/api\/lp\/portal\/my-investments\/([^/]+)\/distributions$/);
  if (req.method === "GET" && lpMyDistributionsMatch) {
    const authUser = await extractAuthUser(req);
    return handleGetMyDistributions(req, res, authUser, lpMyDistributionsMatch[1]);
  }

  // LP: Get single distribution detail
  const lpMyDistributionDetailMatch = path.match(/^\/api\/lp\/portal\/my-investments\/([^/]+)\/distributions\/([^/]+)$/);
  if (req.method === "GET" && lpMyDistributionDetailMatch) {
    const authUser = await extractAuthUser(req);
    return handleGetMyDistributionDetail(req, res, authUser, lpMyDistributionDetailMatch[1], lpMyDistributionDetailMatch[2]);
  }

  // ========== INVESTOR UPDATES ==========

  // GP: List investor updates for a deal
  const investorUpdatesListMatch = path.match(/^\/api\/deals\/([^/]+)\/investor-updates$/);
  if (req.method === "GET" && investorUpdatesListMatch) {
    const authUser = await requireDealAccess(req, res, investorUpdatesListMatch[1]);
    if (!authUser) return;
    return handleListInvestorUpdates(req, res, investorUpdatesListMatch[1]);
  }
  if (req.method === "POST" && investorUpdatesListMatch) {
    const authUser = await requireGPWithDealAccess(req, res, investorUpdatesListMatch[1]);
    if (!authUser) return;
    // SECURITY: Use authUser.id/name from validated JWT, NOT spoofable headers
    return handleCreateInvestorUpdate(req, res, investorUpdatesListMatch[1], readJsonBody, authUser.id, authUser.name);
  }

  // GP: Get/update single investor update
  const investorUpdateDetailMatch = path.match(/^\/api\/deals\/([^/]+)\/investor-updates\/([^/]+)$/);
  if (req.method === "GET" && investorUpdateDetailMatch) {
    const authUser = await requireDealAccess(req, res, investorUpdateDetailMatch[1]);
    if (!authUser) return;
    return handleGetInvestorUpdate(req, res, investorUpdateDetailMatch[1], investorUpdateDetailMatch[2]);
  }
  if (req.method === "PATCH" && investorUpdateDetailMatch) {
    const authUser = await requireGPWithDealAccess(req, res, investorUpdateDetailMatch[1]);
    if (!authUser) return;
    return handleUpdateInvestorUpdate(req, res, investorUpdateDetailMatch[1], investorUpdateDetailMatch[2], readJsonBody);
  }
  if (req.method === "DELETE" && investorUpdateDetailMatch) {
    const authUser = await requireGPWithDealAccess(req, res, investorUpdateDetailMatch[1]);
    if (!authUser) return;
    return handleDeleteInvestorUpdate(req, res, investorUpdateDetailMatch[1], investorUpdateDetailMatch[2]);
  }

  // GP: Publish investor update
  const investorUpdatePublishMatch = path.match(/^\/api\/deals\/([^/]+)\/investor-updates\/([^/]+)\/publish$/);
  if (req.method === "POST" && investorUpdatePublishMatch) {
    const authUser = await requireGPWithDealAccess(req, res, investorUpdatePublishMatch[1]);
    if (!authUser) return;
    return handlePublishInvestorUpdate(req, res, investorUpdatePublishMatch[1], investorUpdatePublishMatch[2]);
  }

  // GP: Answer LP question
  const answerQuestionMatch = path.match(/^\/api\/deals\/([^/]+)\/questions\/([^/]+)\/answer$/);
  if (req.method === "POST" && answerQuestionMatch) {
    const authUser = await requireGPWithDealAccess(req, res, answerQuestionMatch[1]);
    if (!authUser) return;
    // SECURITY: Use authUser.id/name from validated JWT, NOT spoofable headers
    return handleAnswerQuestion(req, res, answerQuestionMatch[1], answerQuestionMatch[2], readJsonBody, authUser.id, authUser.name);
  }

  // LP: Get my investor updates for an investment
  const lpMyUpdatesMatch = path.match(/^\/api\/lp\/portal\/my-investments\/([^/]+)\/updates$/);
  if (req.method === "GET" && lpMyUpdatesMatch) {
    const authUser = await extractAuthUser(req);
    return handleGetMyInvestorUpdates(req, res, authUser, lpMyUpdatesMatch[1]);
  }

  // LP: Get single investor update detail
  const lpMyUpdateDetailMatch = path.match(/^\/api\/lp\/portal\/my-investments\/([^/]+)\/updates\/([^/]+)$/);
  if (req.method === "GET" && lpMyUpdateDetailMatch) {
    const authUser = await extractAuthUser(req);
    return handleGetMyInvestorUpdateDetail(req, res, authUser, lpMyUpdateDetailMatch[1], lpMyUpdateDetailMatch[2]);
  }

  // LP: Get questions for an update
  const lpUpdateQuestionsMatch = path.match(/^\/api\/lp\/portal\/my-investments\/([^/]+)\/updates\/([^/]+)\/questions$/);
  if (req.method === "GET" && lpUpdateQuestionsMatch) {
    const authUser = await extractAuthUser(req);
    return handleGetUpdateQuestions(req, res, authUser, lpUpdateQuestionsMatch[1], lpUpdateQuestionsMatch[2]);
  }

  // LP: Ask a question
  const lpAskQuestionMatch = path.match(/^\/api\/lp\/portal\/my-investments\/([^/]+)\/questions$/);
  if (req.method === "POST" && lpAskQuestionMatch) {
    const authUser = await extractAuthUser(req);
    return handleAskQuestion(req, res, authUser, lpAskQuestionMatch[1], readJsonBody);
  }

  // Integrations - External API webhook receiver (no auth - uses webhook secret)
  if (req.method === "POST" && path === "/api/integrations/webhook") {
    return handleIntegrationWebhook(req, res, readJsonBody);
  }

  // Integrations - List configured integrations for a deal
  const integrationsListMatch = path.match(/^\/api\/deals\/([^/]+)\/integrations$/);
  if (req.method === "GET" && integrationsListMatch) {
    const authUser = await requireDealAccess(req, res, integrationsListMatch[1]);
    if (!authUser) return;
    return handleListIntegrations(req, res, integrationsListMatch[1]);
  }

  // Integrations - Update integration configuration
  const integrationsUpdateMatch = path.match(/^\/api\/deals\/([^/]+)\/integrations\/([^/]+)$/);
  if (req.method === "PATCH" && integrationsUpdateMatch) {
    const authUser = await requireGPWithDealAccess(req, res, integrationsUpdateMatch[1]);
    if (!authUser) return;
    return handleUpdateIntegration(req, res, integrationsUpdateMatch[1], integrationsUpdateMatch[2], readJsonBody);
  }

  // Chat API Routes
  // SECURITY: V2 fix - pass authUser instead of resolveUserId/resolveActorRole to prevent x-actor-role spoofing
  if (req.method === "GET" && path === "/api/chat/conversations") {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    return handleListConversations(req, res, authUser);
  }

  if (req.method === "POST" && path === "/api/chat/conversations") {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    return handleCreateConversation(req, res, authUser);
  }

  const chatConversationMatch = path.match(/^\/api\/chat\/conversations\/([^/]+)$/);
  if (req.method === "GET" && chatConversationMatch) {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    return handleGetConversation(req, res, chatConversationMatch[1], authUser);
  }

  const chatMessagesMatch = path.match(/^\/api\/chat\/conversations\/([^/]+)\/messages$/);
  if (req.method === "GET" && chatMessagesMatch) {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    return handleListMessages(req, res, chatMessagesMatch[1], authUser);
  }
  if (req.method === "POST" && chatMessagesMatch) {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    return handleSendMessage(req, res, chatMessagesMatch[1], authUser);
  }

  const chatReadMatch = path.match(/^\/api\/chat\/conversations\/([^/]+)\/read$/);
  if (req.method === "PATCH" && chatReadMatch) {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    return handleMarkRead(req, res, chatReadMatch[1], authUser);
  }

  const chatJoinMatch = path.match(/^\/api\/chat\/conversations\/([^/]+)\/join$/);
  if (req.method === "POST" && chatJoinMatch) {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    return handleJoinConversation(req, res, chatJoinMatch[1], authUser);
  }

  if (req.method === "GET" && path === "/api/chat/updates") {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    return handleChatUpdates(req, res, authUser);
  }

  // Deal-specific chat thread
  const dealThreadMatch = path.match(/^\/api\/chat\/deals\/([^/]+)\/thread$/);
  if (req.method === "GET" && dealThreadMatch) {
    const authUser = await requireDealAccess(req, res, dealThreadMatch[1]);
    if (!authUser) return;
    const url = new URL(req.url, "http://localhost");
    const dealName = url.searchParams.get("dealName");
    return handleGetDealThread(req, res, dealThreadMatch[1], dealName, authUser);
  }

  // Notifications
  if (req.method === "GET" && path === "/api/notifications") {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    return handleListNotifications(req, res, resolveUserId);
  }

  const notificationReadMatch = path.match(/^\/api\/notifications\/([^/]+)\/read$/);
  if (req.method === "PATCH" && notificationReadMatch) {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    return handleMarkNotificationRead(req, res, notificationReadMatch[1], resolveUserId);
  }

  if (req.method === "PATCH" && path === "/api/notifications/read-all") {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    return handleMarkAllNotificationsRead(req, res, resolveUserId);
  }

  // Notification snooze
  const notificationSnoozeMatch = path.match(/^\/api\/notifications\/([^/]+)\/snooze$/);
  if (req.method === "PATCH" && notificationSnoozeMatch) {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    return handleSnoozeNotification(req, res, notificationSnoozeMatch[1], resolveUserId, readJsonBody);
  }

  // Notification dismiss
  const notificationDismissMatch = path.match(/^\/api\/notifications\/([^/]+)\/dismiss$/);
  if (req.method === "PATCH" && notificationDismissMatch) {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    return handleDismissNotification(req, res, notificationDismissMatch[1], resolveUserId, readJsonBody);
  }

  // Notification preferences
  if (req.method === "GET" && path === "/api/notification-preferences") {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    return handleGetNotificationPreferences(req, res, resolveUserId);
  }

  if (req.method === "PATCH" && path === "/api/notification-preferences") {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    return handleUpdateNotificationPreferences(req, res, resolveUserId, readJsonBody);
  }

  // Activity Feed
  if (req.method === "GET" && path === "/api/activity-feed") {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    return handleGetActivityFeed(req, res, resolveUserId, resolveActorRole);
  }

  // Chat Tasks
  if (req.method === "GET" && path === "/api/tasks") {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    return handleListTasks(req, res, resolveUserId);
  }

  if (req.method === "POST" && path === "/api/tasks") {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    return handleCreateTask(req, res, resolveUserId, readJsonBody);
  }

  const taskUpdateMatch = path.match(/^\/api\/tasks\/([^/]+)$/);
  if (req.method === "PATCH" && taskUpdateMatch) {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    return handleUpdateTask(req, res, taskUpdateMatch[1], resolveUserId, readJsonBody);
  }

  // AI Assistant
  // SECURITY: All AI endpoints now pass authUser for role-based context filtering
  if (req.method === "POST" && path === "/api/ai-assistant/ask") {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    console.log(`[AI] /api/ai-assistant/ask - User: ${authUser.id}, Role: ${authUser.role}, Org: ${authUser.organizationId}`);
    return handleAskAI(req, res, KERNEL_BASE_URL, resolveUserId, resolveActorRole, authUser);
  }

  if (req.method === "GET" && path === "/api/ai-assistant/suggestions") {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    console.log(`[AI] /api/ai-assistant/suggestions - User: ${authUser.id}, Role: ${authUser.role}`);
    return handleGetSuggestions(req, res, resolveUserId, resolveActorRole, authUser);
  }

  // ========== AI CONSENT MANAGEMENT (Phase 1.2) ==========
  // GET /api/ai-consent/status - Get user's consent status
  if (req.method === "GET" && path === "/api/ai-consent/status") {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    return handleGetConsentStatus(req, res, authUser);
  }

  // POST /api/ai-consent/grant - Grant consent
  if (req.method === "POST" && path === "/api/ai-consent/grant") {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    return handleGrantConsent(req, res, authUser, readJsonBody);
  }

  // POST /api/ai-consent/withdraw - Withdraw consent (GDPR)
  if (req.method === "POST" && path === "/api/ai-consent/withdraw") {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    return handleWithdrawConsent(req, res, authUser, readJsonBody);
  }

  // PATCH /api/ai-consent/features - Update feature toggles
  if (req.method === "PATCH" && path === "/api/ai-consent/features") {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    return handleUpdateFeatureConsent(req, res, authUser, readJsonBody);
  }

  // GET /api/ai-consent/policy - Get current policy
  if (req.method === "GET" && path === "/api/ai-consent/policy") {
    return handleGetPolicy(req, res);
  }

  // GET /api/ai-consent/history - Get consent audit history
  if (req.method === "GET" && path === "/api/ai-consent/history") {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    return handleGetConsentHistory(req, res, authUser, url);
  }

  // Deal-specific AI Chat & Insights (Phase: Broker→GP Workflow)
  // SECURITY: All deal-specific AI endpoints use filtered context based on authUser role
  // POST /api/deals/:dealId/chat - Context-aware chat
  const dealChatMatch = path.match(/^\/api\/deals\/([^/]+)\/chat$/);
  if (req.method === "POST" && dealChatMatch) {
    const authUser = await requireDealAccess(req, res, dealChatMatch[1]);
    if (!authUser) return;
    console.log(`[AI] /api/deals/${dealChatMatch[1]}/chat - User: ${authUser.id}, Role: ${authUser.role}, Org: ${authUser.organizationId}`);
    return handleDealChat(req, res, dealChatMatch[1], resolveUserId, resolveActorRole, authUser);
  }

  // GET /api/deals/:dealId/chat/history - Chat history
  const dealChatHistoryMatch = path.match(/^\/api\/deals\/([^/]+)\/chat\/history$/);
  if (req.method === "GET" && dealChatHistoryMatch) {
    const authUser = await requireDealAccess(req, res, dealChatHistoryMatch[1]);
    if (!authUser) return;
    console.log(`[AI] /api/deals/${dealChatHistoryMatch[1]}/chat/history - User: ${authUser.id}, Role: ${authUser.role}`);
    return handleGetDealChatHistory(req, res, dealChatHistoryMatch[1], resolveUserId, authUser);
  }

  // GET /api/deals/:dealId/insights - Auto-generated insights
  const dealInsightsMatch = path.match(/^\/api\/deals\/([^/]+)\/insights$/);
  if (req.method === "GET" && dealInsightsMatch) {
    const authUser = await requireDealAccess(req, res, dealInsightsMatch[1]);
    if (!authUser) return;
    console.log(`[AI] /api/deals/${dealInsightsMatch[1]}/insights - User: ${authUser.id}, Role: ${authUser.role}, Org: ${authUser.organizationId}`);
    return handleGetDealInsights(req, res, dealInsightsMatch[1], authUser);
  }

  // GET /api/deals/:dealId/context - Full deal context (for debugging)
  const dealContextMatch = path.match(/^\/api\/deals\/([^/]+)\/context$/);
  if (req.method === "GET" && dealContextMatch) {
    const authUser = await requireDealAccess(req, res, dealContextMatch[1]);
    if (!authUser) return;
    console.log(`[AI] /api/deals/${dealContextMatch[1]}/context - User: ${authUser.id}, Role: ${authUser.role}, Org: ${authUser.organizationId}`);
    return handleGetDealContext(req, res, dealContextMatch[1], authUser);
  }

  // POST /api/deals/:dealId/summarize - AI executive summary
  const dealSummarizeMatch = path.match(/^\/api\/deals\/([^/]+)\/summarize$/);
  if (req.method === "POST" && dealSummarizeMatch) {
    const authUser = await requireDealAccess(req, res, dealSummarizeMatch[1]);
    if (!authUser) return;
    console.log(`[AI] /api/deals/${dealSummarizeMatch[1]}/summarize - User: ${authUser.id}, Role: ${authUser.role}, Org: ${authUser.organizationId}`);
    return handleDealSummarize(req, res, dealSummarizeMatch[1], resolveUserId, authUser);
  }

  // POST /api/deals/:dealId/export-package - One-click complete deal package export
  const exportPackageMatch = path.match(/^\/api\/deals\/([^/]+)\/export-package$/);
  if (req.method === "POST" && exportPackageMatch) {
    const authUser = await requireDealAccess(req, res, exportPackageMatch[1]);
    if (!authUser) return;
    return handleExportPackage(req, res, exportPackageMatch[1], resolveUserId);
  }

  // ========== PHASE 2 AI ROUTES ==========

  // Phase 2.1: Document Intelligence
  const aiExtractMatch = path.match(/^\/api\/deals\/([^/]+)\/ai\/extract$/);
  if (req.method === "POST" && aiExtractMatch) {
    const authUser = await requireDealAccess(req, res, aiExtractMatch[1]);
    if (!authUser) return;
    return handleExtractDocument(req, res, aiExtractMatch[1], authUser, readJsonBody);
  }

  const aiSynthesizeMatch = path.match(/^\/api\/deals\/([^/]+)\/ai\/synthesize$/);
  if (req.method === "POST" && aiSynthesizeMatch) {
    const authUser = await requireDealAccess(req, res, aiSynthesizeMatch[1]);
    if (!authUser) return;
    return handleSynthesizeDocuments(req, res, aiSynthesizeMatch[1], authUser, readJsonBody);
  }

  const aiConflictsMatch = path.match(/^\/api\/deals\/([^/]+)\/ai\/conflicts$/);
  if (req.method === "GET" && aiConflictsMatch) {
    const authUser = await requireDealAccess(req, res, aiConflictsMatch[1]);
    if (!authUser) return;
    return handleGetConflicts(req, res, aiConflictsMatch[1], authUser, url);
  }

  const aiResolveConflictMatch = path.match(/^\/api\/deals\/([^/]+)\/ai\/conflicts\/([^/]+)\/resolve$/);
  if (req.method === "POST" && aiResolveConflictMatch) {
    const authUser = await requireDealAccess(req, res, aiResolveConflictMatch[1]);
    if (!authUser) return;
    return handleResolveConflict(req, res, aiResolveConflictMatch[1], aiResolveConflictMatch[2], authUser, readJsonBody);
  }

  const aiDismissConflictMatch = path.match(/^\/api\/deals\/([^/]+)\/ai\/conflicts\/([^/]+)\/dismiss$/);
  if (req.method === "POST" && aiDismissConflictMatch) {
    const authUser = await requireDealAccess(req, res, aiDismissConflictMatch[1]);
    if (!authUser) return;
    return handleDismissConflict(req, res, aiDismissConflictMatch[1], aiDismissConflictMatch[2], authUser, readJsonBody);
  }

  const aiExtractionReportMatch = path.match(/^\/api\/deals\/([^/]+)\/ai\/extraction-report$/);
  if (req.method === "GET" && aiExtractionReportMatch) {
    const authUser = await requireDealAccess(req, res, aiExtractionReportMatch[1]);
    if (!authUser) return;
    return handleGetExtractionReport(req, res, aiExtractionReportMatch[1], authUser);
  }

  // Phase 2.2: Verification Agent
  const aiVerificationStatusMatch = path.match(/^\/api\/deals\/([^/]+)\/ai\/verification-status$/);
  if (req.method === "GET" && aiVerificationStatusMatch) {
    const authUser = await requireDealAccess(req, res, aiVerificationStatusMatch[1]);
    if (!authUser) return;
    return handleGetVerificationStatus(req, res, aiVerificationStatusMatch[1], authUser, url);
  }

  const aiLineageMatch = path.match(/^\/api\/deals\/([^/]+)\/ai\/lineage$/);
  if (req.method === "GET" && aiLineageMatch) {
    const authUser = await requireDealAccess(req, res, aiLineageMatch[1]);
    if (!authUser) return;
    return handleGetLineage(req, res, aiLineageMatch[1], authUser, url);
  }

  const aiTrackLineageMatch = path.match(/^\/api\/deals\/([^/]+)\/ai\/lineage\/track$/);
  if (req.method === "POST" && aiTrackLineageMatch) {
    const authUser = await requireDealAccess(req, res, aiTrackLineageMatch[1]);
    if (!authUser) return;
    return handleTrackLineage(req, res, aiTrackLineageMatch[1], authUser, readJsonBody, url);
  }

  const aiBulkVerifyMatch = path.match(/^\/api\/deals\/([^/]+)\/ai\/lineage\/bulk-verify$/);
  if (req.method === "POST" && aiBulkVerifyMatch) {
    const authUser = await requireDealAccess(req, res, aiBulkVerifyMatch[1]);
    if (!authUser) return;
    return handleBulkVerify(req, res, aiBulkVerifyMatch[1], authUser, readJsonBody, url);
  }

  // Note: Field lineage must come after /track and /bulk-verify to avoid matching them
  const aiFieldLineageMatch = path.match(/^\/api\/deals\/([^/]+)\/ai\/lineage\/([^/]+)$/);
  if (req.method === "GET" && aiFieldLineageMatch && aiFieldLineageMatch[2] !== 'track' && aiFieldLineageMatch[2] !== 'bulk-verify') {
    const authUser = await requireDealAccess(req, res, aiFieldLineageMatch[1]);
    if (!authUser) return;
    return handleGetFieldLineage(req, res, aiFieldLineageMatch[1], decodeURIComponent(aiFieldLineageMatch[2]), authUser, url);
  }

  const aiVerifyFieldMatch = path.match(/^\/api\/deals\/([^/]+)\/ai\/lineage\/([^/]+)\/verify$/);
  if (req.method === "POST" && aiVerifyFieldMatch) {
    const authUser = await requireDealAccess(req, res, aiVerifyFieldMatch[1]);
    if (!authUser) return;
    return handleVerifyField(req, res, aiVerifyFieldMatch[1], decodeURIComponent(aiVerifyFieldMatch[2]), authUser, readJsonBody, url);
  }

  const aiNeedsReviewMatch = path.match(/^\/api\/deals\/([^/]+)\/ai\/lineage\/([^/]+)\/needs-review$/);
  if (req.method === "POST" && aiNeedsReviewMatch) {
    const authUser = await requireDealAccess(req, res, aiNeedsReviewMatch[1]);
    if (!authUser) return;
    return handleMarkNeedsReview(req, res, aiNeedsReviewMatch[1], decodeURIComponent(aiNeedsReviewMatch[2]), authUser, readJsonBody, url);
  }

  const aiVerificationSuggestionsMatch = path.match(/^\/api\/deals\/([^/]+)\/ai\/verification-suggestions$/);
  if (req.method === "GET" && aiVerificationSuggestionsMatch) {
    const authUser = await requireDealAccess(req, res, aiVerificationSuggestionsMatch[1]);
    if (!authUser) return;
    return handleGetVerificationSuggestions(req, res, aiVerificationSuggestionsMatch[1], authUser, url);
  }

  const aiVerificationHistoryMatch = path.match(/^\/api\/deals\/([^/]+)\/ai\/verification-history$/);
  if (req.method === "GET" && aiVerificationHistoryMatch) {
    const authUser = await requireDealAccess(req, res, aiVerificationHistoryMatch[1]);
    if (!authUser) return;
    return handleGetVerificationHistory(req, res, aiVerificationHistoryMatch[1], authUser, url);
  }

  // Phase 2.3: Assumption Tracker
  const aiAssumptionSnapshotMatch = path.match(/^\/api\/deals\/([^/]+)\/ai\/assumptions\/snapshot$/);
  if (req.method === "POST" && aiAssumptionSnapshotMatch) {
    const authUser = await requireDealAccess(req, res, aiAssumptionSnapshotMatch[1]);
    if (!authUser) return;
    return handleCreateAssumptionSnapshot(req, res, aiAssumptionSnapshotMatch[1], authUser, readJsonBody);
  }

  const aiAssumptionSnapshotsMatch = path.match(/^\/api\/deals\/([^/]+)\/ai\/assumptions\/snapshots$/);
  if (req.method === "GET" && aiAssumptionSnapshotsMatch) {
    const authUser = await requireDealAccess(req, res, aiAssumptionSnapshotsMatch[1]);
    if (!authUser) return;
    return handleGetAssumptionSnapshots(req, res, aiAssumptionSnapshotsMatch[1], authUser);
  }

  const aiAssumptionCompareMatch = path.match(/^\/api\/deals\/([^/]+)\/ai\/assumptions\/compare$/);
  if (req.method === "POST" && aiAssumptionCompareMatch) {
    const authUser = await requireDealAccess(req, res, aiAssumptionCompareMatch[1]);
    if (!authUser) return;
    return handleCompareAssumptions(req, res, aiAssumptionCompareMatch[1], authUser, readJsonBody);
  }

  const aiAssumptionVariancesMatch = path.match(/^\/api\/deals\/([^/]+)\/ai\/assumptions\/variances$/);
  if (req.method === "GET" && aiAssumptionVariancesMatch) {
    const authUser = await requireDealAccess(req, res, aiAssumptionVariancesMatch[1]);
    if (!authUser) return;
    return handleGetAssumptionVariances(req, res, aiAssumptionVariancesMatch[1], authUser);
  }

  // Portfolio-level assumption routes
  if (req.method === "GET" && path === "/api/portfolio/ai/assumption-trends") {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    return handleGetPortfolioTrends(req, res, authUser, url);
  }

  if (req.method === "POST" && path === "/api/portfolio/ai/assumption-suggestions") {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    return handleGetAssumptionSuggestions(req, res, authUser, readJsonBody);
  }

  // ========== PHASE 2.4: DD CHECKLIST AI ASSISTANT ==========

  // POST /api/deals/:dealId/dd-checklist/initialize - Initialize DD checklist
  const ddInitMatch = path.match(/^\/api\/deals\/([^/]+)\/dd-checklist\/initialize$/);
  if (req.method === "POST" && ddInitMatch) {
    const authUser = await requireDealAccess(req, res, ddInitMatch[1]);
    if (!authUser) return;
    return handleInitializeChecklist(req, res, ddInitMatch[1], authUser, readJsonBody);
  }

  // GET /api/deals/:dealId/dd-checklist - Get full checklist
  const ddChecklistMatch = path.match(/^\/api\/deals\/([^/]+)\/dd-checklist$/);
  if (req.method === "GET" && ddChecklistMatch) {
    const authUser = await requireDealAccess(req, res, ddChecklistMatch[1]);
    if (!authUser) return;
    return handleGetChecklist(req, res, ddChecklistMatch[1], authUser, url);
  }

  // GET /api/deals/:dealId/dd-checklist/status - Get completion status
  const ddStatusMatch = path.match(/^\/api\/deals\/([^/]+)\/dd-checklist\/status$/);
  if (req.method === "GET" && ddStatusMatch) {
    const authUser = await requireDealAccess(req, res, ddStatusMatch[1]);
    if (!authUser) return;
    return handleGetChecklistStatus(req, res, ddStatusMatch[1], authUser);
  }

  // GET /api/deals/:dealId/dd-checklist/items - Get items (filtered by state)
  const ddItemsMatch = path.match(/^\/api\/deals\/([^/]+)\/dd-checklist\/items$/);
  if (req.method === "GET" && ddItemsMatch) {
    const authUser = await requireDealAccess(req, res, ddItemsMatch[1]);
    if (!authUser) return;
    return handleGetChecklistItems(req, res, ddItemsMatch[1], authUser, url);
  }

  // POST /api/deals/:dealId/dd-checklist/items/custom - Add custom item
  const ddCustomItemMatch = path.match(/^\/api\/deals\/([^/]+)\/dd-checklist\/items\/custom$/);
  if (req.method === "POST" && ddCustomItemMatch) {
    const authUser = await requireDealAccess(req, res, ddCustomItemMatch[1]);
    if (!authUser) return;
    return handleAddCustomItem(req, res, ddCustomItemMatch[1], authUser, readJsonBody);
  }

  // GET /api/deals/:dealId/dd-checklist/items/:itemId/history - Get item history
  const ddItemHistoryMatch = path.match(/^\/api\/deals\/([^/]+)\/dd-checklist\/items\/([^/]+)\/history$/);
  if (req.method === "GET" && ddItemHistoryMatch) {
    const authUser = await requireDealAccess(req, res, ddItemHistoryMatch[1]);
    if (!authUser) return;
    return handleGetItemHistory(req, res, ddItemHistoryMatch[1], ddItemHistoryMatch[2], authUser);
  }

  // POST /api/deals/:dealId/dd-checklist/items/:itemId/assign - Assign item
  const ddAssignMatch = path.match(/^\/api\/deals\/([^/]+)\/dd-checklist\/items\/([^/]+)\/assign$/);
  if (req.method === "POST" && ddAssignMatch) {
    const authUser = await requireDealAccess(req, res, ddAssignMatch[1]);
    if (!authUser) return;
    return handleAssignItem(req, res, ddAssignMatch[1], ddAssignMatch[2], authUser, readJsonBody);
  }

  // POST /api/deals/:dealId/dd-checklist/items/:itemId/link-document - Link document
  const ddLinkDocMatch = path.match(/^\/api\/deals\/([^/]+)\/dd-checklist\/items\/([^/]+)\/link-document$/);
  if (req.method === "POST" && ddLinkDocMatch) {
    const authUser = await requireDealAccess(req, res, ddLinkDocMatch[1]);
    if (!authUser) return;
    return handleLinkDocument(req, res, ddLinkDocMatch[1], ddLinkDocMatch[2], authUser, readJsonBody);
  }

  // POST /api/deals/:dealId/dd-checklist/items/:itemId/verify - Verify item
  const ddVerifyMatch = path.match(/^\/api\/deals\/([^/]+)\/dd-checklist\/items\/([^/]+)\/verify$/);
  if (req.method === "POST" && ddVerifyMatch) {
    const authUser = await requireDealAccess(req, res, ddVerifyMatch[1]);
    if (!authUser) return;
    return handleVerifyItem(req, res, ddVerifyMatch[1], ddVerifyMatch[2], authUser, readJsonBody);
  }

  // POST /api/deals/:dealId/dd-checklist/items/:itemId/mark-na - Mark N/A
  const ddMarkNAMatch = path.match(/^\/api\/deals\/([^/]+)\/dd-checklist\/items\/([^/]+)\/mark-na$/);
  if (req.method === "POST" && ddMarkNAMatch) {
    const authUser = await requireDealAccess(req, res, ddMarkNAMatch[1]);
    if (!authUser) return;
    return handleMarkNA(req, res, ddMarkNAMatch[1], ddMarkNAMatch[2], authUser, readJsonBody);
  }

  // GET /api/deals/:dealId/dd-checklist/items/:itemId - Get single item
  const ddSingleItemMatch = path.match(/^\/api\/deals\/([^/]+)\/dd-checklist\/items\/([^/]+)$/);
  if (req.method === "GET" && ddSingleItemMatch && ddSingleItemMatch[2] !== 'custom') {
    const authUser = await requireDealAccess(req, res, ddSingleItemMatch[1]);
    if (!authUser) return;
    return handleGetItem(req, res, ddSingleItemMatch[1], ddSingleItemMatch[2], authUser);
  }

  // PATCH /api/deals/:dealId/dd-checklist/items/:itemId - Update item
  const ddUpdateItemMatch = path.match(/^\/api\/deals\/([^/]+)\/dd-checklist\/items\/([^/]+)$/);
  if (req.method === "PATCH" && ddUpdateItemMatch) {
    const authUser = await requireDealAccess(req, res, ddUpdateItemMatch[1]);
    if (!authUser) return;
    return handleUpdateItem(req, res, ddUpdateItemMatch[1], ddUpdateItemMatch[2], authUser, readJsonBody);
  }

  // DD Checklist AI Features
  // GET /api/deals/:dealId/dd-checklist/suggestions
  const ddSuggestMatch = path.match(/^\/api\/deals\/([^/]+)\/dd-checklist\/suggestions$/);
  if (req.method === "GET" && ddSuggestMatch) {
    const authUser = await requireDealAccess(req, res, ddSuggestMatch[1]);
    if (!authUser) return;
    return handleGetDDSuggestions(req, res, ddSuggestMatch[1], authUser, url);
  }

  // GET /api/deals/:dealId/dd-checklist/risks
  const ddRisksMatch = path.match(/^\/api\/deals\/([^/]+)\/dd-checklist\/risks$/);
  if (req.method === "GET" && ddRisksMatch) {
    const authUser = await requireDealAccess(req, res, ddRisksMatch[1]);
    if (!authUser) return;
    return handleGetDDRisks(req, res, ddRisksMatch[1], authUser);
  }

  // GET /api/deals/:dealId/dd-checklist/summary
  const ddSummaryMatch = path.match(/^\/api\/deals\/([^/]+)\/dd-checklist\/summary$/);
  if (req.method === "GET" && ddSummaryMatch) {
    const authUser = await requireDealAccess(req, res, ddSummaryMatch[1]);
    if (!authUser) return;
    return handleGetDDSummary(req, res, ddSummaryMatch[1], authUser, url);
  }

  // POST /api/deals/:dealId/dd-checklist/process-document
  const ddProcessDocMatch = path.match(/^\/api\/deals\/([^/]+)\/dd-checklist\/process-document$/);
  if (req.method === "POST" && ddProcessDocMatch) {
    const authUser = await requireDealAccess(req, res, ddProcessDocMatch[1]);
    if (!authUser) return;
    return handleDDProcessDocument(req, res, ddProcessDocMatch[1], authUser, readJsonBody);
  }

  // GET /api/deals/:dealId/dd-checklist/pending-approvals
  const ddPendingMatch = path.match(/^\/api\/deals\/([^/]+)\/dd-checklist\/pending-approvals$/);
  if (req.method === "GET" && ddPendingMatch) {
    const authUser = await requireDealAccess(req, res, ddPendingMatch[1]);
    if (!authUser) return;
    return handleGetDDPendingApprovals(req, res, ddPendingMatch[1], authUser);
  }

  // POST /api/deals/:dealId/dd-checklist/approvals/:approvalId/approve
  const ddApproveMatch = path.match(/^\/api\/deals\/([^/]+)\/dd-checklist\/approvals\/([^/]+)\/approve$/);
  if (req.method === "POST" && ddApproveMatch) {
    const authUser = await requireDealAccess(req, res, ddApproveMatch[1]);
    if (!authUser) return;
    return handleDDApproveMatch(req, res, ddApproveMatch[1], ddApproveMatch[2], authUser, readJsonBody);
  }

  // POST /api/deals/:dealId/dd-checklist/approvals/:approvalId/reject
  const ddRejectMatch = path.match(/^\/api\/deals\/([^/]+)\/dd-checklist\/approvals\/([^/]+)\/reject$/);
  if (req.method === "POST" && ddRejectMatch) {
    const authUser = await requireDealAccess(req, res, ddRejectMatch[1]);
    if (!authUser) return;
    return handleDDRejectMatch(req, res, ddRejectMatch[1], ddRejectMatch[2], authUser, readJsonBody);
  }

  // Admin DD Template routes
  if (req.method === "GET" && path === "/api/admin/dd-templates") {
    const authUser = await requireAdmin(req, res);
    if (!authUser) return;
    return handleGetTemplates(req, res, authUser);
  }

  if (req.method === "GET" && path === "/api/admin/dd-templates/categories") {
    const authUser = await requireAdmin(req, res);
    if (!authUser) return;
    return handleGetCategories(req, res, authUser);
  }

  // ========== VERIFICATION QUEUE (Deal Doc Factory) ==========

  // Get all claims for a deal
  const claimsListMatch = path.match(/^\/api\/deals\/([^/]+)\/claims$/);
  if (req.method === "GET" && claimsListMatch) {
    const authUser = await requireDealAccess(req, res, claimsListMatch[1]);
    if (!authUser) return;
    return handleGetClaims(req, res, claimsListMatch[1]);
  }

  // Get pending claims for a deal
  const pendingClaimsMatch = path.match(/^\/api\/deals\/([^/]+)\/claims\/pending$/);
  if (req.method === "GET" && pendingClaimsMatch) {
    const authUser = await requireDealAccess(req, res, pendingClaimsMatch[1]);
    if (!authUser) return;
    return handleGetPendingClaims(req, res, pendingClaimsMatch[1]);
  }

  // Get verification stats for a deal
  const claimStatsMatch = path.match(/^\/api\/deals\/([^/]+)\/claims\/stats$/);
  if (req.method === "GET" && claimStatsMatch) {
    const authUser = await requireDealAccess(req, res, claimStatsMatch[1]);
    if (!authUser) return;
    return handleGetClaimStats(req, res, claimStatsMatch[1]);
  }

  // Get claim history for a specific field
  const fieldHistoryMatch = path.match(/^\/api\/deals\/([^/]+)\/claims\/field\/([^/]+)\/history$/);
  if (req.method === "GET" && fieldHistoryMatch) {
    const authUser = await requireDealAccess(req, res, fieldHistoryMatch[1]);
    if (!authUser) return;
    return handleGetFieldHistory(req, res, fieldHistoryMatch[1], decodeURIComponent(fieldHistoryMatch[2]));
  }

  // Bulk verify claims (GP only)
  const bulkVerifyMatch = path.match(/^\/api\/deals\/([^/]+)\/claims\/bulk-verify$/);
  if (req.method === "POST" && bulkVerifyMatch) {
    const authUser = await requireGPWithDealAccess(req, res, bulkVerifyMatch[1]);
    if (!authUser) return;
    // SECURITY: Pass authUser for validated identity, NOT spoofable headers
    return handleQueueBulkVerify(req, res, bulkVerifyMatch[1], readJsonBody, authUser);
  }

  // Bulk reject claims (GP only)
  const bulkRejectMatch = path.match(/^\/api\/deals\/([^/]+)\/claims\/bulk-reject$/);
  if (req.method === "POST" && bulkRejectMatch) {
    const authUser = await requireGPWithDealAccess(req, res, bulkRejectMatch[1]);
    if (!authUser) return;
    // SECURITY: Pass authUser for validated identity, NOT spoofable headers
    return handleBulkReject(req, res, bulkRejectMatch[1], readJsonBody, authUser);
  }

  // Get single claim (requires auth - claim-level org check in handler)
  const singleClaimMatch = path.match(/^\/api\/claims\/([^/]+)$/);
  if (req.method === "GET" && singleClaimMatch) {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    return handleGetClaim(req, res, singleClaimMatch[1]);
  }

  // Verify a claim (GP only)
  const verifyClaimMatch = path.match(/^\/api\/claims\/([^/]+)\/verify$/);
  if (req.method === "POST" && verifyClaimMatch) {
    const authUser = await requireGP(req, res);
    if (!authUser) return;
    // SECURITY: Pass authUser for validated identity, NOT spoofable headers
    return handleVerifyClaim(req, res, verifyClaimMatch[1], readJsonBody, authUser);
  }

  // Reject a claim (GP only)
  const rejectClaimMatch = path.match(/^\/api\/claims\/([^/]+)\/reject$/);
  if (req.method === "POST" && rejectClaimMatch) {
    const authUser = await requireGP(req, res);
    if (!authUser) return;
    // SECURITY: Pass authUser for validated identity, NOT spoofable headers
    return handleRejectClaim(req, res, rejectClaimMatch[1], readJsonBody, authUser);
  }

  // ========== DEAL STATE MACHINE (Deal Doc Factory) ==========
  // Note: Handlers also have their own guards for defense-in-depth

  // Get current deal state
  const dealStateMatch = path.match(/^\/api\/deals\/([^/]+)\/state$/);
  if (req.method === "GET" && dealStateMatch) {
    const authUser = await requireDealAccess(req, res, dealStateMatch[1]);
    if (!authUser) return;
    return handleGetDealState(req, res, dealStateMatch[1]);
  }

  // Transition deal state (GP only)
  const transitionStateMatch = path.match(/^\/api\/deals\/([^/]+)\/state\/transition$/);
  if (req.method === "POST" && transitionStateMatch) {
    const authUser = await requireGPWithDealAccess(req, res, transitionStateMatch[1]);
    if (!authUser) return;
    return handleTransitionState(req, res, transitionStateMatch[1], readJsonBody, resolveUserId, resolveActorRole);
  }

  // Get available transitions
  const availableTransitionsMatch = path.match(/^\/api\/deals\/([^/]+)\/state\/available-transitions$/);
  if (req.method === "GET" && availableTransitionsMatch) {
    const authUser = await requireDealAccess(req, res, availableTransitionsMatch[1]);
    if (!authUser) return;
    return handleGetAvailableTransitions(req, res, availableTransitionsMatch[1], resolveUserId, resolveActorRole);
  }

  // Get blockers
  const blockersMatch = path.match(/^\/api\/deals\/([^/]+)\/state\/blockers$/);
  if (req.method === "GET" && blockersMatch) {
    const authUser = await requireDealAccess(req, res, blockersMatch[1]);
    if (!authUser) return;
    return handleGetBlockers(req, res, blockersMatch[1]);
  }

  // Get deal events (audit log)
  const dealEventsMatch = path.match(/^\/api\/deals\/([^/]+)\/state\/events$/);
  if (req.method === "GET" && dealEventsMatch) {
    const authUser = await requireDealAccess(req, res, dealEventsMatch[1]);
    if (!authUser) return;
    return handleGetDealEvents(req, res, dealEventsMatch[1]);
  }

  // Get single deal event
  const singleDealEventMatch = path.match(/^\/api\/deals\/([^/]+)\/state\/events\/([^/]+)$/);
  if (req.method === "GET" && singleDealEventMatch) {
    const authUser = await requireDealAccess(req, res, singleDealEventMatch[1]);
    if (!authUser) return;
    return handleGetDealEvent(req, res, singleDealEventMatch[1], singleDealEventMatch[2]);
  }

  // ========== DOCUMENT GENERATION (Deal Doc Factory) ==========

  // Generate a document
  const generateDocMatch = path.match(/^\/api\/deals\/([^/]+)\/documents\/generate$/);
  if (req.method === "POST" && generateDocMatch) {
    const authUser = await requireGPWithDealAccess(req, res, generateDocMatch[1]);
    if (!authUser) return;
    // SECURITY: Pass validated authUser, not spoofable headers
    return handleGenerateDocument(req, res, generateDocMatch[1], readJsonBody, authUser);
  }

  // List documents for a deal
  const listDocsMatch = path.match(/^\/api\/deals\/([^/]+)\/documents$/);
  if (req.method === "GET" && listDocsMatch) {
    const authUser = await requireDealAccess(req, res, listDocsMatch[1]);
    if (!authUser) return;
    return handleListDocuments(req, res, listDocsMatch[1]);
  }

  // Get document versions
  const docVersionsMatch = path.match(/^\/api\/deals\/([^/]+)\/documents\/([^/]+)\/versions$/);
  if (req.method === "GET" && docVersionsMatch) {
    const authUser = await requireDealAccess(req, res, docVersionsMatch[1]);
    if (!authUser) return;
    return handleGetDocumentVersions(req, res, docVersionsMatch[1], docVersionsMatch[2]);
  }

  // Promote document status
  const promoteDocMatch = path.match(/^\/api\/deals\/([^/]+)\/documents\/([^/]+)\/promote$/);
  if (req.method === "POST" && promoteDocMatch) {
    const authUser = await requireGPWithDealAccess(req, res, promoteDocMatch[1]);
    if (!authUser) return;
    // SECURITY: Pass validated authUser, not spoofable headers
    return handlePromoteDocument(req, res, promoteDocMatch[1], promoteDocMatch[2], readJsonBody, authUser);
  }

  // Download document PDF
  const downloadDocMatch = path.match(/^\/api\/deals\/([^/]+)\/documents\/([^/]+)\/download$/);
  if (req.method === "GET" && downloadDocMatch) {
    const authUser = await requireDealAccess(req, res, downloadDocMatch[1]);
    if (!authUser) return;
    return handleDownloadDocument(req, res, downloadDocMatch[1], downloadDocMatch[2]);
  }

  // ========== EVIDENCE PACKS (Deal Doc Factory) ==========

  // Generate evidence pack
  const generatePackMatch = path.match(/^\/api\/deals\/([^/]+)\/evidence-pack\/generate$/);
  if (req.method === "POST" && generatePackMatch) {
    const authUser = await requireGPWithDealAccess(req, res, generatePackMatch[1]);
    if (!authUser) return;
    // SECURITY: Pass validated authUser, not spoofable headers
    return handleGenerateEvidencePack(req, res, generatePackMatch[1], readJsonBody, authUser);
  }

  // List evidence packs
  const listPacksMatch = path.match(/^\/api\/deals\/([^/]+)\/evidence-packs$/);
  if (req.method === "GET" && listPacksMatch) {
    const authUser = await requireDealAccess(req, res, listPacksMatch[1]);
    if (!authUser) return;
    return handleListEvidencePacks(req, res, listPacksMatch[1]);
  }

  // Download evidence pack
  const downloadPackMatch = path.match(/^\/api\/deals\/([^/]+)\/evidence-packs\/([^/]+)\/download$/);
  if (req.method === "GET" && downloadPackMatch) {
    const authUser = await requireDealAccess(req, res, downloadPackMatch[1]);
    if (!authUser) return;
    // SECURITY: Pass validated authUser, not spoofable headers
    return handleDownloadEvidencePack(req, res, downloadPackMatch[1], downloadPackMatch[2], authUser);
  }

  // ========== DEAL INTAKE & DISTRIBUTION (Pre-DD workflow) ==========
  // Routes: /api/intake/*
  if (path.startsWith("/api/intake/")) {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    const segments = path.split("/").filter(Boolean); // ['api', 'intake', ...]
    return dispatchIntakeRoutes(req, res, segments, readJsonBody, authUser);
  }

  // ========== OM MANAGEMENT (Offering Memorandum) ==========
  // Routes: /api/om/*
  if (path.startsWith("/api/om/")) {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    const segments = path.split("/").filter(Boolean); // ['api', 'om', ...]
    return dispatchOMRoutes(req, res, segments, readJsonBody, authUser);
  }

  // ========== SELLER PORTAL (Seller-side deal management) ==========
  // Routes: /api/seller/*
  if (path.startsWith("/api/seller/")) {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    const segments = path.split("/").filter(Boolean); // ['api', 'seller', ...]
    return dispatchSellerRoutes(req, res, segments, readJsonBody, authUser);
  }

  // ========== DISTRIBUTION (Deal distribution to buyers) ==========
  // Routes: /api/distribution/*
  if (path.startsWith("/api/distribution/")) {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    const segments = path.split("/").filter(Boolean); // ['api', 'distribution', ...]
    return dispatchDistributionRoutes(req, res, segments.slice(2), readJsonBody, authUser);
  }

  // ========== BUYER PORTAL (Buyer-side functionality) ==========
  // Routes: /api/buyer/*
  if (path.startsWith("/api/buyer/")) {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    const segments = path.split("/").filter(Boolean); // ['api', 'buyer', ...]
    return dispatchBuyerRoutes(req, res, segments.slice(2), readJsonBody, authUser);
  }

  // ========== PERMISSION GATE (Buyer authorization workflow) ==========
  // Routes: /api/gate/*
  if (path.startsWith("/api/gate/")) {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    const segments = path.split("/").filter(Boolean); // ['api', 'gate', ...]
    return dispatchPermissionGateRoutes(req, res, segments.slice(2), readJsonBody, authUser);
  }

  // Not found
  sendError(res, 404, "Not found");
}

const server = createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    if (error?.type === "KERNEL_UNAVAILABLE") {
      return sendKernelUnavailable(res, error);
    }
    if (typeof error?.status === "number" && error.status >= 500) {
      return sendKernelUnavailable(res, error);
    }
    if (error?.status === 404 && error?.data?.message === "Deal not found") {
      return sendError(res, 404, "Kernel deal not found");
    }
    if (typeof error?.status === "number") {
      const message = error?.data?.message ?? "Kernel request failed";
      return sendError(res, error.status, message, error.data);
    }
    console.error("BFF error:", error);
    sendError(res, 500, "BFF request failed");
  });
});

server.listen(PORT, "0.0.0.0", async () => {
  console.log(`Canonical BFF listening on http://localhost:${PORT}`);
  console.log(`Kernel target: ${KERNEL_BASE_URL}`);

  // Seed default chat channels
  try {
    await seedDefaultChannels();
    console.log("Chat channels initialized");
  } catch (error) {
    console.error("Failed to seed chat channels:", error);
  }

  // Start reminder scheduler (Phase 4: Smart Reminders)
  try {
    startScheduler();
    console.log("Reminder scheduler started");
  } catch (error) {
    console.error("Failed to start reminder scheduler:", error);
  }
});
