/**
 * Permission Gate Routes
 *
 * API endpoints for buyer authorization workflow:
 * - Review queue management
 * - Authorization decisions
 * - NDA tracking
 * - Data room access
 *
 * Part of Phase 4: Permission Gate
 */

import {
  permissionGateService,
  AUTH_STATUSES,
  NDA_STATUSES,
  ACCESS_LEVELS
} from '../services/permission-gate.js';

// Debug logging helper
const DEBUG = process.env.DEBUG_ROUTES === 'true' || process.env.DEBUG === 'true';
function debugLog(context, message, data = null) {
  if (DEBUG) {
    const timestamp = new Date().toISOString();
    console.log(`[PERMISSION_GATE_ROUTES ${timestamp}] [${context}] ${message}`);
    if (data) {
      console.log(JSON.stringify(data, null, 2));
    }
  }
}

/**
 * Dispatch permission gate routes
 *
 * @param {Request} req - HTTP request
 * @param {Response} res - HTTP response
 * @param {string[]} segments - URL path segments
 * @param {Function} readJsonBody - JSON body parser
 * @param {Object} authUser - Authenticated user
 */
export function dispatchPermissionGateRoutes(req, res, segments, readJsonBody, authUser) {
  const method = req.method;
  debugLog('dispatch', `${method} /api/gate/${segments.join('/')}`);

  // =====================
  // REVIEW QUEUE
  // =====================

  // GET /api/gate/queue/:dealDraftId - Get review queue for a deal
  if (method === 'GET' && segments[0] === 'queue' && segments[1]) {
    return handleGetReviewQueue(req, res, segments[1], authUser);
  }

  // =====================
  // AUTHORIZATION ACTIONS
  // =====================

  // POST /api/gate/authorize/:dealDraftId/:buyerUserId - Authorize a buyer
  if (method === 'POST' && segments[0] === 'authorize' && segments[1] && segments[2]) {
    return handleAuthorizeBuyer(req, res, segments[1], segments[2], readJsonBody, authUser);
  }

  // POST /api/gate/decline/:dealDraftId/:buyerUserId - Decline a buyer
  if (method === 'POST' && segments[0] === 'decline' && segments[1] && segments[2]) {
    return handleDeclineBuyer(req, res, segments[1], segments[2], readJsonBody, authUser);
  }

  // POST /api/gate/revoke/:dealDraftId/:buyerUserId - Revoke access
  if (method === 'POST' && segments[0] === 'revoke' && segments[1] && segments[2]) {
    return handleRevokeBuyer(req, res, segments[1], segments[2], readJsonBody, authUser);
  }

  // =====================
  // NDA MANAGEMENT
  // =====================

  // POST /api/gate/nda/send/:dealDraftId/:buyerUserId - Send NDA
  if (method === 'POST' && segments[0] === 'nda' && segments[1] === 'send' && segments[2] && segments[3]) {
    return handleSendNDA(req, res, segments[2], segments[3], authUser);
  }

  // POST /api/gate/nda/signed/:dealDraftId/:buyerUserId - Record NDA signed
  if (method === 'POST' && segments[0] === 'nda' && segments[1] === 'signed' && segments[2] && segments[3]) {
    return handleRecordNDASigned(req, res, segments[2], segments[3], readJsonBody, authUser);
  }

  // =====================
  // DATA ROOM ACCESS
  // =====================

  // POST /api/gate/access/:dealDraftId/:buyerUserId - Grant data room access
  if (method === 'POST' && segments[0] === 'access' && segments[1] && segments[2]) {
    return handleGrantDataRoomAccess(req, res, segments[1], segments[2], readJsonBody, authUser);
  }

  // =====================
  // STATUS & PROGRESS
  // =====================

  // GET /api/gate/status/:dealDraftId/:buyerUserId - Get authorization status
  if (method === 'GET' && segments[0] === 'status' && segments[1] && segments[2]) {
    return handleGetAuthorizationStatus(req, res, segments[1], segments[2], authUser);
  }

  // GET /api/gate/authorizations/:dealDraftId - Get all authorizations for a deal
  if (method === 'GET' && segments[0] === 'authorizations' && segments[1]) {
    return handleGetAuthorizations(req, res, segments[1], authUser);
  }

  // GET /api/gate/progress/:dealDraftId - Get deal progress summary
  if (method === 'GET' && segments[0] === 'progress' && segments[1]) {
    return handleGetProgress(req, res, segments[1], authUser);
  }

  // =====================
  // DEAL ADVANCEMENT
  // =====================

  // POST /api/gate/advance/:dealDraftId - Advance deal to Active DD
  if (method === 'POST' && segments[0] === 'advance' && segments[1]) {
    return handleAdvanceToActiveDD(req, res, segments[1], authUser);
  }

  // 404 - Route not found
  debugLog('dispatch', 'Route not found');
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Permission gate route not found' }));
}

/**
 * Get review queue for a deal
 * GET /api/gate/queue/:dealDraftId
 */
async function handleGetReviewQueue(req, res, dealDraftId, authUser) {
  debugLog('handleGetReviewQueue', 'Fetching review queue', { dealDraftId });

  try {
    // Parse query params
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pendingOnly = url.searchParams.get('pendingOnly') !== 'false';
    const status = url.searchParams.get('status');

    const queue = await permissionGateService.getReviewQueue(dealDraftId, {
      pendingOnly,
      status
    });

    debugLog('handleGetReviewQueue', 'Queue fetched', { count: queue.length });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(queue));
  } catch (error) {
    debugLog('handleGetReviewQueue', 'Error', { error: error.message });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

/**
 * Authorize a buyer
 * POST /api/gate/authorize/:dealDraftId/:buyerUserId
 */
async function handleAuthorizeBuyer(req, res, dealDraftId, buyerUserId, readJsonBody, authUser) {
  debugLog('handleAuthorizeBuyer', 'Authorizing buyer', { dealDraftId, buyerUserId });

  try {
    const body = await readJsonBody();

    // Validate access level if provided
    if (body.accessLevel && !Object.values(ACCESS_LEVELS).includes(body.accessLevel)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Invalid access level',
        validLevels: Object.values(ACCESS_LEVELS)
      }));
      return;
    }

    const authorization = await permissionGateService.authorizeBuyer(
      dealDraftId,
      buyerUserId,
      { accessLevel: body.accessLevel },
      authUser
    );

    debugLog('handleAuthorizeBuyer', 'Buyer authorized', {
      authorizationId: authorization.id
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(authorization));
  } catch (error) {
    debugLog('handleAuthorizeBuyer', 'Error', { error: error.message });
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

/**
 * Decline a buyer
 * POST /api/gate/decline/:dealDraftId/:buyerUserId
 */
async function handleDeclineBuyer(req, res, dealDraftId, buyerUserId, readJsonBody, authUser) {
  debugLog('handleDeclineBuyer', 'Declining buyer', { dealDraftId, buyerUserId });

  try {
    const body = await readJsonBody();

    if (!body.reason) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Reason is required when declining a buyer' }));
      return;
    }

    const authorization = await permissionGateService.declineBuyer(
      dealDraftId,
      buyerUserId,
      body.reason,
      authUser
    );

    debugLog('handleDeclineBuyer', 'Buyer declined', {
      authorizationId: authorization.id
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(authorization));
  } catch (error) {
    debugLog('handleDeclineBuyer', 'Error', { error: error.message });
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

/**
 * Revoke access from a buyer
 * POST /api/gate/revoke/:dealDraftId/:buyerUserId
 */
async function handleRevokeBuyer(req, res, dealDraftId, buyerUserId, readJsonBody, authUser) {
  debugLog('handleRevokeBuyer', 'Revoking access', { dealDraftId, buyerUserId });

  try {
    const body = await readJsonBody();

    if (!body.reason) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Reason is required when revoking access' }));
      return;
    }

    const authorization = await permissionGateService.revokeBuyer(
      dealDraftId,
      buyerUserId,
      body.reason,
      authUser
    );

    debugLog('handleRevokeBuyer', 'Access revoked', {
      authorizationId: authorization.id
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(authorization));
  } catch (error) {
    debugLog('handleRevokeBuyer', 'Error', { error: error.message });
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

/**
 * Send NDA to buyer
 * POST /api/gate/nda/send/:dealDraftId/:buyerUserId
 */
async function handleSendNDA(req, res, dealDraftId, buyerUserId, authUser) {
  debugLog('handleSendNDA', 'Sending NDA', { dealDraftId, buyerUserId });

  try {
    const authorization = await permissionGateService.sendNDA(
      dealDraftId,
      buyerUserId,
      authUser
    );

    debugLog('handleSendNDA', 'NDA sent', { authorizationId: authorization.id });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(authorization));
  } catch (error) {
    debugLog('handleSendNDA', 'Error', { error: error.message });
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

/**
 * Record NDA signed
 * POST /api/gate/nda/signed/:dealDraftId/:buyerUserId
 */
async function handleRecordNDASigned(req, res, dealDraftId, buyerUserId, readJsonBody, authUser) {
  debugLog('handleRecordNDASigned', 'Recording NDA signature', { dealDraftId, buyerUserId });

  try {
    const body = await readJsonBody();

    const authorization = await permissionGateService.recordNDASigned(
      dealDraftId,
      buyerUserId,
      body.ndaDocumentId
    );

    debugLog('handleRecordNDASigned', 'NDA signed recorded', {
      authorizationId: authorization.id
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(authorization));
  } catch (error) {
    debugLog('handleRecordNDASigned', 'Error', { error: error.message });
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

/**
 * Grant data room access
 * POST /api/gate/access/:dealDraftId/:buyerUserId
 */
async function handleGrantDataRoomAccess(req, res, dealDraftId, buyerUserId, readJsonBody, authUser) {
  debugLog('handleGrantDataRoomAccess', 'Granting access', { dealDraftId, buyerUserId });

  try {
    const body = await readJsonBody();

    // Validate access level
    const accessLevel = body.accessLevel || ACCESS_LEVELS.STANDARD;
    if (!Object.values(ACCESS_LEVELS).includes(accessLevel)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Invalid access level',
        validLevels: Object.values(ACCESS_LEVELS)
      }));
      return;
    }

    const authorization = await permissionGateService.grantDataRoomAccess(
      dealDraftId,
      buyerUserId,
      accessLevel,
      authUser
    );

    debugLog('handleGrantDataRoomAccess', 'Access granted', {
      authorizationId: authorization.id
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(authorization));
  } catch (error) {
    debugLog('handleGrantDataRoomAccess', 'Error', { error: error.message });
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

/**
 * Get authorization status for a buyer
 * GET /api/gate/status/:dealDraftId/:buyerUserId
 */
async function handleGetAuthorizationStatus(req, res, dealDraftId, buyerUserId, authUser) {
  debugLog('handleGetAuthorizationStatus', 'Fetching status', { dealDraftId, buyerUserId });

  try {
    const authorization = await permissionGateService.getAuthorizationStatus(
      dealDraftId,
      buyerUserId
    );

    if (!authorization) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'NOT_REVIEWED' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(authorization));
  } catch (error) {
    debugLog('handleGetAuthorizationStatus', 'Error', { error: error.message });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

/**
 * Get all authorizations for a deal
 * GET /api/gate/authorizations/:dealDraftId
 */
async function handleGetAuthorizations(req, res, dealDraftId, authUser) {
  debugLog('handleGetAuthorizations', 'Fetching authorizations', { dealDraftId });

  try {
    // Parse query params
    const url = new URL(req.url, `http://${req.headers.host}`);
    const status = url.searchParams.get('status');

    const authorizations = await permissionGateService.getAuthorizationsForDeal(
      dealDraftId,
      { status }
    );

    debugLog('handleGetAuthorizations', 'Authorizations fetched', {
      count: authorizations.length
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(authorizations));
  } catch (error) {
    debugLog('handleGetAuthorizations', 'Error', { error: error.message });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

/**
 * Get deal progress summary
 * GET /api/gate/progress/:dealDraftId
 */
async function handleGetProgress(req, res, dealDraftId, authUser) {
  debugLog('handleGetProgress', 'Fetching progress', { dealDraftId });

  try {
    const progress = await permissionGateService.getDealProgress(dealDraftId);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(progress));
  } catch (error) {
    debugLog('handleGetProgress', 'Error', { error: error.message });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

/**
 * Advance deal to Active DD
 * POST /api/gate/advance/:dealDraftId
 */
async function handleAdvanceToActiveDD(req, res, dealDraftId, authUser) {
  debugLog('handleAdvanceToActiveDD', 'Advancing deal', { dealDraftId });

  try {
    const dealDraft = await permissionGateService.advanceToActiveDD(
      dealDraftId,
      authUser
    );

    debugLog('handleAdvanceToActiveDD', 'Deal advanced', { status: dealDraft.status });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(dealDraft));
  } catch (error) {
    debugLog('handleAdvanceToActiveDD', 'Error', { error: error.message });
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

// Export constants for external use
export { AUTH_STATUSES, NDA_STATUSES, ACCESS_LEVELS };
