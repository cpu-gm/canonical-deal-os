/**
 * Distribution Routes
 *
 * API endpoints for deal distribution management.
 * Broker-initiated distribution to buyers.
 *
 * Part of Phase 3: Distribution + Buyer AI
 */

import {
  distributionService,
  LISTING_TYPES,
  RESPONSE_TYPES
} from '../services/distribution.js';

// Debug logging helper
const DEBUG = process.env.DEBUG_ROUTES === 'true' || process.env.DEBUG === 'true';
function debugLog(context, message, data = null) {
  if (DEBUG) {
    const timestamp = new Date().toISOString();
    console.log(`[DISTRIBUTION_ROUTES ${timestamp}] [${context}] ${message}`);
    if (data) {
      console.log(JSON.stringify(data, null, 2));
    }
  }
}

/**
 * Dispatch distribution routes
 *
 * @param {Request} req - HTTP request
 * @param {Response} res - HTTP response
 * @param {string[]} segments - URL path segments
 * @param {Function} readJsonBody - JSON body parser
 * @param {Object} authUser - Authenticated user
 */
export function dispatchDistributionRoutes(req, res, segments, readJsonBody, authUser) {
  const method = req.method;
  debugLog('dispatch', `${method} /api/distribution/${segments.join('/')}`);

  // POST /api/distribution/create/:dealDraftId - Create a distribution
  if (method === 'POST' && segments[0] === 'create' && segments[1]) {
    return handleCreateDistribution(req, res, segments[1], readJsonBody, authUser);
  }

  // POST /api/distribution/:distributionId/add-recipients - Add manual recipients
  if (method === 'POST' && segments[1] === 'add-recipients') {
    return handleAddRecipients(req, res, segments[0], readJsonBody, authUser);
  }

  // GET /api/distribution/:distributionId - Get distribution details
  if (method === 'GET' && segments.length === 1) {
    return handleGetDistribution(req, res, segments[0], authUser);
  }

  // GET /api/distribution/deal/:dealDraftId - Get distributions for a deal
  if (method === 'GET' && segments[0] === 'deal' && segments[1]) {
    return handleGetDistributionsForDeal(req, res, segments[1], authUser);
  }

  // POST /api/distribution/recipient/:recipientId/view - Record a view
  if (method === 'POST' && segments[0] === 'recipient' && segments[2] === 'view') {
    return handleRecordView(req, res, segments[1], readJsonBody, authUser);
  }

  // POST /api/distribution/respond/:dealDraftId - Submit buyer response
  if (method === 'POST' && segments[0] === 'respond' && segments[1]) {
    return handleSubmitResponse(req, res, segments[1], readJsonBody, authUser);
  }

  // GET /api/distribution/responses/:dealDraftId - Get all responses for a deal
  if (method === 'GET' && segments[0] === 'responses' && segments[1]) {
    return handleGetResponses(req, res, segments[1], authUser);
  }

  // 404 - Route not found
  debugLog('dispatch', 'Route not found');
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Distribution route not found' }));
}

/**
 * Create a new distribution
 * POST /api/distribution/create/:dealDraftId
 */
async function handleCreateDistribution(req, res, dealDraftId, readJsonBody, authUser) {
  debugLog('handleCreateDistribution', 'Creating distribution', { dealDraftId });

  try {
    const body = await readJsonBody();

    // Validate listing type
    if (body.listingType && !Object.values(LISTING_TYPES).includes(body.listingType)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Invalid listing type',
        validTypes: Object.values(LISTING_TYPES)
      }));
      return;
    }

    const result = await distributionService.createDistribution(
      dealDraftId,
      {
        listingType: body.listingType || LISTING_TYPES.PRIVATE,
        manualRecipientIds: body.recipientIds || []
      },
      authUser
    );

    debugLog('handleCreateDistribution', 'Distribution created', {
      distributionId: result.distribution.id,
      recipientCount: result.recipients.length
    });

    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (error) {
    debugLog('handleCreateDistribution', 'Error', { error: error.message });
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

/**
 * Add manual recipients to existing distribution
 * POST /api/distribution/:distributionId/add-recipients
 */
async function handleAddRecipients(req, res, distributionId, readJsonBody, authUser) {
  debugLog('handleAddRecipients', 'Adding recipients', { distributionId });

  try {
    const body = await readJsonBody();

    if (!body.recipientIds || !Array.isArray(body.recipientIds)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'recipientIds array required' }));
      return;
    }

    // Get distribution to find deal
    const distribution = await distributionService.getDistribution(distributionId);

    // Add recipients via service (re-using internal method)
    const result = await distributionService.createDistribution(
      distribution.dealDraftId,
      {
        listingType: distribution.listingType,
        manualRecipientIds: body.recipientIds
      },
      authUser
    );

    debugLog('handleAddRecipients', 'Recipients added', {
      count: result.recipients.length
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ added: result.recipients }));
  } catch (error) {
    debugLog('handleAddRecipients', 'Error', { error: error.message });
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

/**
 * Get distribution details
 * GET /api/distribution/:distributionId
 */
async function handleGetDistribution(req, res, distributionId, authUser) {
  debugLog('handleGetDistribution', 'Fetching distribution', { distributionId });

  try {
    const distribution = await distributionService.getDistribution(distributionId);

    debugLog('handleGetDistribution', 'Distribution found', {
      id: distribution.id,
      recipientCount: distribution.recipients.length
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(distribution));
  } catch (error) {
    debugLog('handleGetDistribution', 'Error', { error: error.message });
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

/**
 * Get distributions for a deal
 * GET /api/distribution/deal/:dealDraftId
 */
async function handleGetDistributionsForDeal(req, res, dealDraftId, authUser) {
  debugLog('handleGetDistributionsForDeal', 'Fetching distributions', { dealDraftId });

  try {
    const distributions = await distributionService.getDistributionsForDeal(dealDraftId);

    debugLog('handleGetDistributionsForDeal', 'Distributions found', {
      count: distributions.length
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(distributions));
  } catch (error) {
    debugLog('handleGetDistributionsForDeal', 'Error', { error: error.message });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

/**
 * Record a view event
 * POST /api/distribution/recipient/:recipientId/view
 */
async function handleRecordView(req, res, recipientId, readJsonBody, authUser) {
  debugLog('handleRecordView', 'Recording view', { recipientId });

  try {
    const body = await readJsonBody();

    const updated = await distributionService.recordView(recipientId, {
      durationSec: body.durationSec,
      pagesViewed: body.pagesViewed
    });

    debugLog('handleRecordView', 'View recorded', { recipientId });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(updated));
  } catch (error) {
    debugLog('handleRecordView', 'Error', { error: error.message });
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

/**
 * Submit buyer response
 * POST /api/distribution/respond/:dealDraftId
 */
async function handleSubmitResponse(req, res, dealDraftId, readJsonBody, authUser) {
  debugLog('handleSubmitResponse', 'Submitting response', { dealDraftId });

  try {
    const body = await readJsonBody();

    // Validate response type
    if (!body.response || !Object.values(RESPONSE_TYPES).includes(body.response)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Invalid response type',
        validTypes: Object.values(RESPONSE_TYPES)
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
 * Get all responses for a deal
 * GET /api/distribution/responses/:dealDraftId
 */
async function handleGetResponses(req, res, dealDraftId, authUser) {
  debugLog('handleGetResponses', 'Fetching responses', { dealDraftId });

  try {
    // Import Prisma client
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();

    const responses = await prisma.buyerResponse.findMany({
      where: { dealDraftId },
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

// Export constants for external use
export { LISTING_TYPES, RESPONSE_TYPES };
