/**
 * Buyer Portal Routes
 *
 * API endpoints for buyer-side functionality:
 * - Inbox management (received deals)
 * - AI criteria configuration
 * - Deal scoring and triage
 * - Response submission
 *
 * Part of Phase 3: Distribution + Buyer AI
 */

import { distributionService } from '../services/distribution.js';
import { buyerAITriageService } from '../services/buyer-ai-triage.js';

// Debug logging helper
const DEBUG = process.env.DEBUG_ROUTES === 'true' || process.env.DEBUG === 'true';
function debugLog(context, message, data = null) {
  if (DEBUG) {
    const timestamp = new Date().toISOString();
    console.log(`[BUYER_PORTAL_ROUTES ${timestamp}] [${context}] ${message}`);
    if (data) {
      console.log(JSON.stringify(data, null, 2));
    }
  }
}

/**
 * Dispatch buyer portal routes
 *
 * @param {Request} req - HTTP request
 * @param {Response} res - HTTP response
 * @param {string[]} segments - URL path segments
 * @param {Function} readJsonBody - JSON body parser
 * @param {Object} authUser - Authenticated user
 */
export function dispatchBuyerRoutes(req, res, segments, readJsonBody, authUser) {
  const method = req.method;
  debugLog('dispatch', `${method} /api/buyer/${segments.join('/')}`);

  // =====================
  // INBOX ENDPOINTS
  // =====================

  // GET /api/buyer/inbox - Get buyer's deal inbox
  if (method === 'GET' && segments[0] === 'inbox') {
    return handleGetInbox(req, res, authUser);
  }

  // GET /api/buyer/inbox/:dealDraftId - Get specific deal from inbox
  if (method === 'GET' && segments[0] === 'deal' && segments[1]) {
    return handleGetDeal(req, res, segments[1], authUser);
  }

  // =====================
  // AI CRITERIA ENDPOINTS
  // =====================

  // GET /api/buyer/criteria - Get buyer's AI criteria
  if (method === 'GET' && segments[0] === 'criteria') {
    return handleGetCriteria(req, res, authUser);
  }

  // PUT /api/buyer/criteria - Update buyer's AI criteria
  if (method === 'PUT' && segments[0] === 'criteria') {
    return handleUpdateCriteria(req, res, readJsonBody, authUser);
  }

  // DELETE /api/buyer/criteria - Delete buyer's AI criteria
  if (method === 'DELETE' && segments[0] === 'criteria') {
    return handleDeleteCriteria(req, res, authUser);
  }

  // =====================
  // AI TRIAGE ENDPOINTS
  // =====================

  // POST /api/buyer/score/:dealDraftId - Score a specific deal
  if (method === 'POST' && segments[0] === 'score' && segments[1]) {
    return handleScoreDeal(req, res, segments[1], authUser);
  }

  // POST /api/buyer/score-all - Score all deals in inbox
  if (method === 'POST' && segments[0] === 'score-all') {
    return handleScoreAllDeals(req, res, authUser);
  }

  // GET /api/buyer/triage/:dealDraftId - Get triage result for a deal
  if (method === 'GET' && segments[0] === 'triage' && segments[1]) {
    return handleGetTriage(req, res, segments[1], authUser);
  }

  // =====================
  // RESPONSE ENDPOINTS
  // =====================

  // POST /api/buyer/respond/:dealDraftId - Submit response to a deal
  if (method === 'POST' && segments[0] === 'respond' && segments[1]) {
    return handleSubmitResponse(req, res, segments[1], readJsonBody, authUser);
  }

  // GET /api/buyer/responses - Get all buyer's responses
  if (method === 'GET' && segments[0] === 'responses') {
    return handleGetResponses(req, res, authUser);
  }

  // =====================
  // ANONYMITY SETTINGS
  // =====================

  // GET /api/buyer/anonymity - Get anonymity settings
  if (method === 'GET' && segments[0] === 'anonymity') {
    return handleGetAnonymity(req, res, authUser);
  }

  // PUT /api/buyer/anonymity - Update anonymity settings
  if (method === 'PUT' && segments[0] === 'anonymity') {
    return handleUpdateAnonymity(req, res, readJsonBody, authUser);
  }

  // 404 - Route not found
  debugLog('dispatch', 'Route not found');
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Buyer portal route not found' }));
}

/**
 * Get buyer's deal inbox
 * GET /api/buyer/inbox
 */
async function handleGetInbox(req, res, authUser) {
  debugLog('handleGetInbox', 'Fetching inbox', { userId: authUser.id });

  try {
    // Parse query params from URL
    const url = new URL(req.url, `http://${req.headers.host}`);
    const hasResponded = url.searchParams.get('hasResponded');

    const options = {};
    if (hasResponded !== null) {
      options.hasResponded = hasResponded === 'true';
    }

    const inbox = await distributionService.getBuyerInbox(authUser.id, options);

    debugLog('handleGetInbox', 'Inbox fetched', { count: inbox.length });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(inbox));
  } catch (error) {
    debugLog('handleGetInbox', 'Error', { error: error.message });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

/**
 * Get specific deal from inbox
 * GET /api/buyer/deal/:dealDraftId
 */
async function handleGetDeal(req, res, dealDraftId, authUser) {
  debugLog('handleGetDeal', 'Fetching deal', { dealDraftId, userId: authUser.id });

  try {
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();

    // Check if buyer has received this deal
    const recipient = await prisma.distributionRecipient.findFirst({
      where: {
        buyerUserId: authUser.id,
        distribution: { dealDraftId }
      },
      include: {
        distribution: {
          include: {
            dealDraft: {
              include: {
                omVersions: {
                  where: { status: 'SELLER_APPROVED' },
                  orderBy: { versionNumber: 'desc' },
                  take: 1
                }
              }
            }
          }
        }
      }
    });

    if (!recipient) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'You have not received this deal' }));
      return;
    }

    // Get triage result if available
    const triage = await buyerAITriageService.getTriageResult(dealDraftId, authUser.id);

    // Get existing response if any
    const response = await prisma.buyerResponse.findFirst({
      where: {
        dealDraftId,
        buyerUserId: authUser.id
      }
    });

    const result = {
      recipient,
      deal: recipient.distribution.dealDraft,
      omVersion: recipient.distribution.dealDraft.omVersions[0] || null,
      triage,
      response: response ? {
        ...response,
        questionsForBroker: response.questionsForBroker ? JSON.parse(response.questionsForBroker) : null,
        conditions: response.conditions ? JSON.parse(response.conditions) : null
      } : null
    };

    debugLog('handleGetDeal', 'Deal found', { dealDraftId });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (error) {
    debugLog('handleGetDeal', 'Error', { error: error.message });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

/**
 * Get buyer's AI criteria
 * GET /api/buyer/criteria
 */
async function handleGetCriteria(req, res, authUser) {
  debugLog('handleGetCriteria', 'Fetching criteria', { userId: authUser.id });

  try {
    const criteria = await buyerAITriageService.getCriteria(authUser.id);

    if (!criteria) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(null));
      return;
    }

    debugLog('handleGetCriteria', 'Criteria found', { criteriaId: criteria.id });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(criteria));
  } catch (error) {
    debugLog('handleGetCriteria', 'Error', { error: error.message });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

/**
 * Update buyer's AI criteria
 * PUT /api/buyer/criteria
 */
async function handleUpdateCriteria(req, res, readJsonBody, authUser) {
  debugLog('handleUpdateCriteria', 'Updating criteria', { userId: authUser.id });

  try {
    const body = await readJsonBody();

    const criteria = await buyerAITriageService.upsertCriteria(authUser.id, body);

    debugLog('handleUpdateCriteria', 'Criteria updated', { criteriaId: criteria.id });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(criteria));
  } catch (error) {
    debugLog('handleUpdateCriteria', 'Error', { error: error.message });
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

/**
 * Delete buyer's AI criteria
 * DELETE /api/buyer/criteria
 */
async function handleDeleteCriteria(req, res, authUser) {
  debugLog('handleDeleteCriteria', 'Deleting criteria', { userId: authUser.id });

  try {
    await buyerAITriageService.deleteCriteria(authUser.id);

    debugLog('handleDeleteCriteria', 'Criteria deleted');

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ deleted: true }));
  } catch (error) {
    debugLog('handleDeleteCriteria', 'Error', { error: error.message });
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

/**
 * Score a specific deal
 * POST /api/buyer/score/:dealDraftId
 */
async function handleScoreDeal(req, res, dealDraftId, authUser) {
  debugLog('handleScoreDeal', 'Scoring deal', { dealDraftId, userId: authUser.id });

  try {
    const result = await buyerAITriageService.scoreDeal(dealDraftId, authUser.id);

    debugLog('handleScoreDeal', 'Deal scored', {
      dealDraftId,
      score: result.relevanceScore
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (error) {
    debugLog('handleScoreDeal', 'Error', { error: error.message });
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

/**
 * Score all deals in inbox
 * POST /api/buyer/score-all
 */
async function handleScoreAllDeals(req, res, authUser) {
  debugLog('handleScoreAllDeals', 'Scoring all deals', { userId: authUser.id });

  try {
    const results = await buyerAITriageService.scoreAllDealsForBuyer(authUser.id);

    debugLog('handleScoreAllDeals', 'Deals scored', { count: results.length });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ scored: results.length, results }));
  } catch (error) {
    debugLog('handleScoreAllDeals', 'Error', { error: error.message });
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

/**
 * Get triage result for a deal
 * GET /api/buyer/triage/:dealDraftId
 */
async function handleGetTriage(req, res, dealDraftId, authUser) {
  debugLog('handleGetTriage', 'Fetching triage', { dealDraftId, userId: authUser.id });

  try {
    const triage = await buyerAITriageService.getTriageResult(dealDraftId, authUser.id);

    if (!triage) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No triage result found. Run scoring first.' }));
      return;
    }

    debugLog('handleGetTriage', 'Triage found', { dealDraftId, score: triage.relevanceScore });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(triage));
  } catch (error) {
    debugLog('handleGetTriage', 'Error', { error: error.message });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

/**
 * Submit response to a deal
 * POST /api/buyer/respond/:dealDraftId
 */
async function handleSubmitResponse(req, res, dealDraftId, readJsonBody, authUser) {
  debugLog('handleSubmitResponse', 'Submitting response', { dealDraftId, userId: authUser.id });

  try {
    const body = await readJsonBody();

    // Validate response type
    const validResponses = ['INTERESTED', 'INTERESTED_WITH_CONDITIONS', 'PASS'];
    if (!body.response || !validResponses.includes(body.response)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Invalid response type',
        validTypes: validResponses
      }));
      return;
    }

    const response = await distributionService.submitResponse(dealDraftId, body, authUser);

    debugLog('handleSubmitResponse', 'Response submitted', { responseId: response.id });

    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  } catch (error) {
    debugLog('handleSubmitResponse', 'Error', { error: error.message });
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

/**
 * Get all buyer's responses
 * GET /api/buyer/responses
 */
async function handleGetResponses(req, res, authUser) {
  debugLog('handleGetResponses', 'Fetching responses', { userId: authUser.id });

  try {
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();

    const responses = await prisma.buyerResponse.findMany({
      where: { buyerUserId: authUser.id },
      orderBy: { respondedAt: 'desc' }
    });

    // Parse JSON fields
    const parsed = responses.map(r => ({
      ...r,
      questionsForBroker: r.questionsForBroker ? JSON.parse(r.questionsForBroker) : null,
      conditions: r.conditions ? JSON.parse(r.conditions) : null
    }));

    debugLog('handleGetResponses', 'Responses found', { count: parsed.length });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(parsed));
  } catch (error) {
    debugLog('handleGetResponses', 'Error', { error: error.message });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

/**
 * Get anonymity settings
 * GET /api/buyer/anonymity
 */
async function handleGetAnonymity(req, res, authUser) {
  debugLog('handleGetAnonymity', 'Fetching anonymity', { userId: authUser.id });

  try {
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();

    const user = await prisma.authUser.findUnique({
      where: { id: authUser.id },
      select: {
        id: true,
        isAnonymousBuyer: true,
        anonymousLabel: true
      }
    });

    if (!user) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'User not found' }));
      return;
    }

    debugLog('handleGetAnonymity', 'Anonymity settings found', {
      isAnonymous: user.isAnonymousBuyer
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      isAnonymous: user.isAnonymousBuyer || false,
      anonymousLabel: user.anonymousLabel || 'Anonymous Buyer'
    }));
  } catch (error) {
    debugLog('handleGetAnonymity', 'Error', { error: error.message });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

/**
 * Update anonymity settings
 * PUT /api/buyer/anonymity
 */
async function handleUpdateAnonymity(req, res, readJsonBody, authUser) {
  debugLog('handleUpdateAnonymity', 'Updating anonymity', { userId: authUser.id });

  try {
    const body = await readJsonBody();
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();

    const updated = await prisma.authUser.update({
      where: { id: authUser.id },
      data: {
        isAnonymousBuyer: body.isAnonymous || false,
        anonymousLabel: body.anonymousLabel || 'Anonymous Buyer'
      },
      select: {
        id: true,
        isAnonymousBuyer: true,
        anonymousLabel: true
      }
    });

    debugLog('handleUpdateAnonymity', 'Anonymity updated', {
      isAnonymous: updated.isAnonymousBuyer
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      isAnonymous: updated.isAnonymousBuyer,
      anonymousLabel: updated.anonymousLabel
    }));
  } catch (error) {
    debugLog('handleUpdateAnonymity', 'Error', { error: error.message });
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}
