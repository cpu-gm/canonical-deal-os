/**
 * Deal Intake Routes
 *
 * API endpoints for broker deal intake and pre-marketing workflow.
 *
 * Routes:
 * - POST /api/intake/draft - Create new deal draft
 * - GET /api/intake/drafts - List deal drafts
 * - GET /api/intake/draft/:id - Get deal draft
 * - POST /api/intake/draft/:id/documents - Upload documents
 * - POST /api/intake/draft/:id/paste - Paste text for extraction
 * - POST /api/intake/draft/:id/brokers - Add co-broker
 * - POST /api/intake/draft/:id/seller - Set seller
 * - GET /api/intake/draft/:id/claims - Get claims
 * - POST /api/intake/draft/:id/claims/:claimId/verify - Verify claim
 * - GET /api/intake/draft/:id/conflicts - Get conflicts
 * - POST /api/intake/draft/:id/conflicts/:conflictId/resolve - Resolve conflict
 * - POST /api/intake/draft/:id/advance - Advance status
 * - GET /api/intake/draft/:id/stats - Get extraction stats
 */

import {
  dealIngestService,
  DEAL_DRAFT_STATUSES,
  INGEST_SOURCES
} from '../services/deal-ingest.js';
import { dealClaimExtractorService } from '../services/deal-claim-extractor.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ============================================================================
// Helpers
// ============================================================================

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(payload));
}

function sendError(res, status, message, details = null) {
  sendJson(res, status, { error: message, details });
}

// ============================================================================
// Route Handlers
// ============================================================================

/**
 * Create a new deal draft
 * POST /api/intake/draft
 */
export async function handleCreateDraft(req, res, readJsonBody, authUser) {
  if (!authUser) {
    return sendError(res, 401, 'Not authenticated');
  }

  const body = await readJsonBody(req);
  if (!body) {
    return sendError(res, 400, 'Request body required');
  }

  const { ingestSource, sourceData, seller } = body;

  // Validate ingest source
  if (!ingestSource || !INGEST_SOURCES.has(ingestSource)) {
    return sendError(res, 400, `Invalid ingestSource. Valid values: ${[...INGEST_SOURCES].join(', ')}`);
  }

  try {
    const dealDraft = await dealIngestService.createDealDraft({
      organizationId: authUser.organizationId,
      broker: {
        userId: authUser.id,
        email: authUser.email,
        name: authUser.name,
        firmName: body.brokerFirm
      },
      ingestSource,
      sourceData,
      seller
    });

    return sendJson(res, 201, dealDraft);
  } catch (error) {
    console.error('[DealIntake] Create draft error:', error);
    return sendError(res, 500, error.message);
  }
}

/**
 * List deal drafts
 * GET /api/intake/drafts
 */
export async function handleListDrafts(req, res, authUser) {
  if (!authUser) {
    return sendError(res, 401, 'Not authenticated');
  }

  // Parse query params
  const url = new URL(req.url, `http://${req.headers.host}`);
  const status = url.searchParams.get('status');
  const limit = parseInt(url.searchParams.get('limit') || '50', 10);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);

  try {
    const result = await dealIngestService.listDealDrafts(authUser.organizationId, {
      status,
      brokerId: authUser.id, // Only show drafts where user is a broker
      limit,
      offset
    });

    return sendJson(res, 200, result);
  } catch (error) {
    console.error('[DealIntake] List drafts error:', error);
    return sendError(res, 500, error.message);
  }
}

/**
 * Get a single deal draft
 * GET /api/intake/draft/:id
 */
export async function handleGetDraft(req, res, dealDraftId, authUser) {
  if (!authUser) {
    return sendError(res, 401, 'Not authenticated');
  }

  try {
    const dealDraft = await dealIngestService.getDealDraft(dealDraftId, true);

    // Check access - must be broker on this deal
    const isBroker = dealDraft.brokers?.some(b => b.userId === authUser.id);
    const isSeller = dealDraft.seller?.userId === authUser.id;

    if (!isBroker && !isSeller && authUser.role !== 'Admin') {
      return sendError(res, 403, 'Access denied');
    }

    return sendJson(res, 200, dealDraft);
  } catch (error) {
    if (error.message === 'Deal draft not found') {
      return sendError(res, 404, 'Deal draft not found');
    }
    console.error('[DealIntake] Get draft error:', error);
    return sendError(res, 500, error.message);
  }
}

/**
 * Upload documents to a draft
 * POST /api/intake/draft/:id/documents
 *
 * Note: This is a simplified version. Real implementation would handle
 * multipart file uploads and store files to disk/S3.
 */
export async function handleUploadDocuments(req, res, dealDraftId, readJsonBody, authUser) {
  if (!authUser) {
    return sendError(res, 401, 'Not authenticated');
  }

  const body = await readJsonBody(req);
  if (!body?.documents || !Array.isArray(body.documents)) {
    return sendError(res, 400, 'documents array required');
  }

  try {
    // Verify access
    const dealDraft = await dealIngestService.getDealDraft(dealDraftId, true);
    const isBroker = dealDraft.brokers?.some(b => b.userId === authUser.id);

    if (!isBroker && authUser.role !== 'Admin') {
      return sendError(res, 403, 'Only brokers can upload documents');
    }

    const result = await dealIngestService.addDocuments(
      dealDraftId,
      body.documents,
      authUser.id
    );

    return sendJson(res, 200, result);
  } catch (error) {
    if (error.message === 'Deal draft not found') {
      return sendError(res, 404, 'Deal draft not found');
    }
    console.error('[DealIntake] Upload documents error:', error);
    return sendError(res, 500, error.message);
  }
}

/**
 * Paste text for extraction
 * POST /api/intake/draft/:id/paste
 */
export async function handlePasteText(req, res, dealDraftId, readJsonBody, authUser) {
  if (!authUser) {
    return sendError(res, 401, 'Not authenticated');
  }

  const body = await readJsonBody(req);
  if (!body?.text || typeof body.text !== 'string') {
    return sendError(res, 400, 'text field required');
  }

  try {
    // Verify access
    const dealDraft = await dealIngestService.getDealDraft(dealDraftId, false);
    const drafts = await prisma.dealDraftBroker.findFirst({
      where: { dealDraftId, userId: authUser.id }
    });

    if (!drafts && authUser.role !== 'Admin') {
      return sendError(res, 403, 'Only brokers can add content');
    }

    // Extract claims from pasted text
    const result = await dealClaimExtractorService.extractFromText({
      dealDraftId,
      text: body.text,
      sourceName: body.sourceName || 'Pasted Text'
    });

    return sendJson(res, 200, result);
  } catch (error) {
    if (error.message === 'Deal draft not found') {
      return sendError(res, 404, 'Deal draft not found');
    }
    console.error('[DealIntake] Paste text error:', error);
    return sendError(res, 500, error.message);
  }
}

/**
 * Add a co-broker
 * POST /api/intake/draft/:id/brokers
 */
export async function handleAddBroker(req, res, dealDraftId, readJsonBody, authUser) {
  if (!authUser) {
    return sendError(res, 401, 'Not authenticated');
  }

  const body = await readJsonBody(req);
  if (!body?.email || !body?.name) {
    return sendError(res, 400, 'email and name required');
  }

  try {
    // Verify caller is primary broker
    const primaryBroker = await prisma.dealDraftBroker.findFirst({
      where: {
        dealDraftId,
        userId: authUser.id,
        role: 'PRIMARY'
      }
    });

    if (!primaryBroker && authUser.role !== 'Admin') {
      return sendError(res, 403, 'Only primary broker can add co-brokers');
    }

    // Look up user by email or create placeholder
    let userId = body.userId;
    if (!userId) {
      const user = await prisma.authUser.findFirst({
        where: {
          email: body.email,
          organizationId: authUser.organizationId
        }
      });
      userId = user?.id || `pending_${body.email}`;
    }

    const broker = await dealIngestService.addCoBroker(
      dealDraftId,
      {
        userId,
        email: body.email,
        name: body.name,
        firmName: body.firmName
      },
      authUser.id
    );

    return sendJson(res, 201, broker);
  } catch (error) {
    console.error('[DealIntake] Add broker error:', error);
    return sendError(res, 500, error.message);
  }
}

/**
 * Set the seller
 * POST /api/intake/draft/:id/seller
 */
export async function handleSetSeller(req, res, dealDraftId, readJsonBody, authUser) {
  if (!authUser) {
    return sendError(res, 401, 'Not authenticated');
  }

  const body = await readJsonBody(req);
  if (!body?.email || !body?.name) {
    return sendError(res, 400, 'email and name required');
  }

  try {
    // Verify caller is a broker on this deal
    const broker = await prisma.dealDraftBroker.findFirst({
      where: { dealDraftId, userId: authUser.id }
    });

    if (!broker && authUser.role !== 'Admin') {
      return sendError(res, 403, 'Only brokers can set seller');
    }

    // Look up user by email
    let userId = body.userId;
    if (!userId) {
      const user = await prisma.authUser.findFirst({
        where: {
          email: body.email,
          organizationId: authUser.organizationId
        }
      });
      userId = user?.id || `pending_${body.email}`;
    }

    const seller = await dealIngestService.setSeller(
      dealDraftId,
      {
        userId,
        email: body.email,
        name: body.name,
        entityName: body.entityName,
        hasDirectAccess: body.hasDirectAccess,
        receiveNotifications: body.receiveNotifications,
        requiresOMApproval: body.requiresOMApproval,
        requiresBuyerApproval: body.requiresBuyerApproval,
        sellerSeesBuyerIdentity: body.sellerSeesBuyerIdentity
      },
      authUser.id
    );

    return sendJson(res, 201, seller);
  } catch (error) {
    console.error('[DealIntake] Set seller error:', error);
    return sendError(res, 500, error.message);
  }
}

/**
 * Get claims for a draft
 * GET /api/intake/draft/:id/claims
 */
export async function handleGetClaims(req, res, dealDraftId, authUser) {
  if (!authUser) {
    return sendError(res, 401, 'Not authenticated');
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const status = url.searchParams.get('status');
  const field = url.searchParams.get('field');

  try {
    const where = { dealDraftId };
    if (status) where.status = status;
    if (field) where.field = field;

    const claims = await prisma.dealClaim.findMany({
      where,
      orderBy: [
        { status: 'asc' },
        { confidence: 'asc' },
        { createdAt: 'desc' }
      ]
    });

    const formatted = claims.map(claim => ({
      id: claim.id,
      field: claim.field,
      value: JSON.parse(claim.value),
      displayValue: claim.displayValue,
      source: {
        documentId: claim.documentId,
        documentName: claim.documentName,
        pageNumber: claim.pageNumber,
        location: claim.location,
        textSnippet: claim.textSnippet
      },
      extraction: {
        method: claim.extractionMethod,
        confidence: claim.confidence
      },
      verification: {
        status: claim.status,
        verifiedBy: claim.verifiedByName,
        verifiedAt: claim.verifiedAt
      },
      conflictGroupId: claim.conflictGroupId,
      createdAt: claim.createdAt
    }));

    return sendJson(res, 200, { claims: formatted });
  } catch (error) {
    console.error('[DealIntake] Get claims error:', error);
    return sendError(res, 500, error.message);
  }
}

/**
 * Verify a claim
 * POST /api/intake/draft/:id/claims/:claimId/verify
 */
export async function handleVerifyClaim(req, res, dealDraftId, claimId, readJsonBody, authUser) {
  if (!authUser) {
    return sendError(res, 401, 'Not authenticated');
  }

  const body = await readJsonBody(req);
  const { action, correctedValue, rejectionReason } = body || {};

  if (!action || !['confirm', 'reject'].includes(action)) {
    return sendError(res, 400, 'action must be "confirm" or "reject"');
  }

  try {
    // Verify access
    const broker = await prisma.dealDraftBroker.findFirst({
      where: { dealDraftId, userId: authUser.id }
    });
    const seller = await prisma.dealDraftSeller.findFirst({
      where: { dealDraftId, userId: authUser.id }
    });

    if (!broker && !seller && authUser.role !== 'Admin') {
      return sendError(res, 403, 'Access denied');
    }

    // Get the claim
    const claim = await prisma.dealClaim.findFirst({
      where: { id: claimId, dealDraftId }
    });

    if (!claim) {
      return sendError(res, 404, 'Claim not found');
    }

    if (claim.status !== 'UNVERIFIED') {
      return sendError(res, 400, `Claim already has status: ${claim.status}`);
    }

    // Determine new status based on who is verifying
    const newStatus = action === 'confirm'
      ? (seller ? 'SELLER_CONFIRMED' : 'BROKER_CONFIRMED')
      : 'REJECTED';

    const updated = await prisma.dealClaim.update({
      where: { id: claimId },
      data: {
        status: newStatus,
        verifiedBy: authUser.id,
        verifiedByName: authUser.name,
        verifiedAt: new Date(),
        rejectionReason: action === 'reject' ? rejectionReason : null,
        // If corrected, update the value
        value: correctedValue !== undefined ? JSON.stringify(correctedValue) : claim.value
      }
    });

    // Update deal draft with confirmed value
    if (action === 'confirm') {
      const value = correctedValue !== undefined ? correctedValue : JSON.parse(claim.value);
      await dealIngestService.updateDealFromClaim(dealDraftId, claim.field, value);
    }

    return sendJson(res, 200, {
      id: updated.id,
      field: updated.field,
      status: updated.status,
      verifiedBy: updated.verifiedByName,
      verifiedAt: updated.verifiedAt
    });
  } catch (error) {
    console.error('[DealIntake] Verify claim error:', error);
    return sendError(res, 500, error.message);
  }
}

/**
 * Get conflicts
 * GET /api/intake/draft/:id/conflicts
 */
export async function handleGetConflicts(req, res, dealDraftId, authUser) {
  if (!authUser) {
    return sendError(res, 401, 'Not authenticated');
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const status = url.searchParams.get('status') || 'OPEN';

  try {
    const conflicts = await dealIngestService.getConflicts(dealDraftId, { status });
    return sendJson(res, 200, { conflicts });
  } catch (error) {
    console.error('[DealIntake] Get conflicts error:', error);
    return sendError(res, 500, error.message);
  }
}

/**
 * Resolve a conflict
 * POST /api/intake/draft/:id/conflicts/:conflictId/resolve
 */
export async function handleResolveConflict(req, res, dealDraftId, conflictId, readJsonBody, authUser) {
  if (!authUser) {
    return sendError(res, 401, 'Not authenticated');
  }

  const body = await readJsonBody(req);
  if (!body?.method) {
    return sendError(res, 400, 'method required (CHOSE_CLAIM_A, CHOSE_CLAIM_B, MANUAL_OVERRIDE, AVERAGED)');
  }

  try {
    // Verify access
    const broker = await prisma.dealDraftBroker.findFirst({
      where: { dealDraftId, userId: authUser.id }
    });

    if (!broker && authUser.role !== 'Admin') {
      return sendError(res, 403, 'Only brokers can resolve conflicts');
    }

    const resolved = await dealIngestService.resolveConflict(
      conflictId,
      {
        resolvedClaimId: body.resolvedClaimId,
        resolvedValue: body.resolvedValue,
        method: body.method
      },
      { id: authUser.id, name: authUser.name }
    );

    return sendJson(res, 200, resolved);
  } catch (error) {
    console.error('[DealIntake] Resolve conflict error:', error);
    return sendError(res, 500, error.message);
  }
}

/**
 * Advance deal draft status
 * POST /api/intake/draft/:id/advance
 */
export async function handleAdvanceStatus(req, res, dealDraftId, readJsonBody, authUser) {
  if (!authUser) {
    return sendError(res, 401, 'Not authenticated');
  }

  const body = await readJsonBody(req);
  if (!body?.status) {
    return sendError(res, 400, 'status required');
  }

  if (!Object.values(DEAL_DRAFT_STATUSES).includes(body.status)) {
    return sendError(res, 400, `Invalid status. Valid values: ${Object.values(DEAL_DRAFT_STATUSES).join(', ')}`);
  }

  try {
    // Verify access based on transition
    const dealDraft = await dealIngestService.getDealDraft(dealDraftId, true);

    // Check permissions for specific transitions
    if (body.status === DEAL_DRAFT_STATUSES.OM_BROKER_APPROVED) {
      const isBroker = dealDraft.brokers?.some(b => b.userId === authUser.id);
      if (!isBroker && authUser.role !== 'Admin') {
        return sendError(res, 403, 'Only brokers can approve OM');
      }
    }

    if (body.status === DEAL_DRAFT_STATUSES.OM_APPROVED_FOR_MARKETING) {
      const isSeller = dealDraft.seller?.userId === authUser.id;
      const brokerCanApprove = dealDraft.brokers?.some(
        b => b.userId === authUser.id && b.permissions?.canApproveOM
      );

      if (!isSeller && !brokerCanApprove && authUser.role !== 'Admin') {
        return sendError(res, 403, 'Seller approval required');
      }
    }

    const updated = await dealIngestService.advanceStatus(
      dealDraftId,
      body.status,
      { id: authUser.id, name: authUser.name, role: authUser.role }
    );

    return sendJson(res, 200, updated);
  } catch (error) {
    console.error('[DealIntake] Advance status error:', error);
    return sendError(res, 500, error.message);
  }
}

/**
 * Get extraction statistics
 * GET /api/intake/draft/:id/stats
 */
export async function handleGetStats(req, res, dealDraftId, authUser) {
  if (!authUser) {
    return sendError(res, 401, 'Not authenticated');
  }

  try {
    const [stats, verifiedFields, fieldsNeedingVerification] = await Promise.all([
      dealClaimExtractorService.getExtractionStats(dealDraftId),
      dealClaimExtractorService.getVerifiedFields(dealDraftId),
      dealClaimExtractorService.getFieldsNeedingVerification(dealDraftId)
    ]);

    return sendJson(res, 200, {
      stats,
      verifiedFields,
      fieldsNeedingVerification
    });
  } catch (error) {
    console.error('[DealIntake] Get stats error:', error);
    return sendError(res, 500, error.message);
  }
}

// ============================================================================
// Route Dispatcher
// ============================================================================

/**
 * Main route dispatcher for /api/intake/*
 */
export function dispatchIntakeRoutes(req, res, segments, readJsonBody, authUser) {
  const method = req.method;

  // POST /api/intake/draft - Create draft
  if (method === 'POST' && segments.length === 2 && segments[1] === 'draft') {
    return handleCreateDraft(req, res, readJsonBody, authUser);
  }

  // GET /api/intake/drafts - List drafts
  if (method === 'GET' && segments.length === 2 && segments[1] === 'drafts') {
    return handleListDrafts(req, res, authUser);
  }

  // GET /api/intake/draft/:id - Get draft
  if (method === 'GET' && segments.length === 3 && segments[1] === 'draft') {
    const dealDraftId = segments[2];
    return handleGetDraft(req, res, dealDraftId, authUser);
  }

  // POST /api/intake/draft/:id/documents - Upload documents
  if (method === 'POST' && segments.length === 4 && segments[1] === 'draft' && segments[3] === 'documents') {
    const dealDraftId = segments[2];
    return handleUploadDocuments(req, res, dealDraftId, readJsonBody, authUser);
  }

  // POST /api/intake/draft/:id/paste - Paste text
  if (method === 'POST' && segments.length === 4 && segments[1] === 'draft' && segments[3] === 'paste') {
    const dealDraftId = segments[2];
    return handlePasteText(req, res, dealDraftId, readJsonBody, authUser);
  }

  // POST /api/intake/draft/:id/brokers - Add broker
  if (method === 'POST' && segments.length === 4 && segments[1] === 'draft' && segments[3] === 'brokers') {
    const dealDraftId = segments[2];
    return handleAddBroker(req, res, dealDraftId, readJsonBody, authUser);
  }

  // POST /api/intake/draft/:id/seller - Set seller
  if (method === 'POST' && segments.length === 4 && segments[1] === 'draft' && segments[3] === 'seller') {
    const dealDraftId = segments[2];
    return handleSetSeller(req, res, dealDraftId, readJsonBody, authUser);
  }

  // GET /api/intake/draft/:id/claims - Get claims
  if (method === 'GET' && segments.length === 4 && segments[1] === 'draft' && segments[3] === 'claims') {
    const dealDraftId = segments[2];
    return handleGetClaims(req, res, dealDraftId, authUser);
  }

  // POST /api/intake/draft/:id/claims/:claimId/verify - Verify claim
  if (method === 'POST' && segments.length === 6 && segments[1] === 'draft' && segments[3] === 'claims' && segments[5] === 'verify') {
    const dealDraftId = segments[2];
    const claimId = segments[4];
    return handleVerifyClaim(req, res, dealDraftId, claimId, readJsonBody, authUser);
  }

  // GET /api/intake/draft/:id/conflicts - Get conflicts
  if (method === 'GET' && segments.length === 4 && segments[1] === 'draft' && segments[3] === 'conflicts') {
    const dealDraftId = segments[2];
    return handleGetConflicts(req, res, dealDraftId, authUser);
  }

  // POST /api/intake/draft/:id/conflicts/:conflictId/resolve - Resolve conflict
  if (method === 'POST' && segments.length === 6 && segments[1] === 'draft' && segments[3] === 'conflicts' && segments[5] === 'resolve') {
    const dealDraftId = segments[2];
    const conflictId = segments[4];
    return handleResolveConflict(req, res, dealDraftId, conflictId, readJsonBody, authUser);
  }

  // POST /api/intake/draft/:id/advance - Advance status
  if (method === 'POST' && segments.length === 4 && segments[1] === 'draft' && segments[3] === 'advance') {
    const dealDraftId = segments[2];
    return handleAdvanceStatus(req, res, dealDraftId, readJsonBody, authUser);
  }

  // GET /api/intake/draft/:id/stats - Get stats
  if (method === 'GET' && segments.length === 4 && segments[1] === 'draft' && segments[3] === 'stats') {
    const dealDraftId = segments[2];
    return handleGetStats(req, res, dealDraftId, authUser);
  }

  // Not found
  return sendError(res, 404, 'Route not found');
}
