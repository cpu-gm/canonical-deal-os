/**
 * DD Checklist API Routes
 *
 * Exposes DD checklist management functionality via REST API.
 * Phase 2.4 Implementation
 */

import {
  initializeChecklist,
  getChecklist,
  getStageFilteredItems,
  getDDCompletionStatus,
  updateItemStatus,
  assignItem,
  linkDocument,
  markAsVerified,
  markItemNA,
  addCustomItem,
  getItemHistory,
  getTemplateLibrary,
  createLogger,
  // AI features:
  suggestNextItems,
  detectRisks,
  generateStatusSummary,
  autoProcessDocument,
  getPendingApprovals,
  approveDocumentMatch,
  rejectDocumentMatch,
} from '../services/ai/dd-checklist-assistant.js';
import { getPrisma } from '../db.js';

const log = createLogger('DD-API');

// ==================== HELPERS ====================

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendError(res, status, message, details = null) {
  const payload = { message };
  if (details) payload.details = details;
  sendJson(res, status, payload);
}

// ==================== CHECKLIST MANAGEMENT ====================

/**
 * POST /api/deals/:dealId/dd-checklist/initialize
 * Initialize DD checklist for a deal
 */
export async function handleInitializeChecklist(req, res, dealId, authUser, readJsonBody) {
  log.info('Initialize checklist request', { dealId, userId: authUser.id });

  try {
    const body = await readJsonBody(req);

    // Get deal dates if not provided
    let psaEffectiveDate = body.psaEffectiveDate;
    let ddExpirationDate = body.ddExpirationDate;
    let targetClosingDate = body.targetClosingDate;

    if (!psaEffectiveDate || !ddExpirationDate || !targetClosingDate) {
      // Try to get from deal
      const prisma = getPrisma();
      const deal = await prisma.deal.findUnique({
        where: { id: dealId },
        select: {
          effectiveDate: true,
          ddExpirationDate: true,
          targetClosingDate: true,
        }
      });

      if (deal) {
        psaEffectiveDate = psaEffectiveDate || deal.effectiveDate;
        ddExpirationDate = ddExpirationDate || deal.ddExpirationDate;
        targetClosingDate = targetClosingDate || deal.targetClosingDate;
      }
    }

    const result = await initializeChecklist(dealId, {
      organizationId: authUser.organizationId,
      psaEffectiveDate,
      ddExpirationDate,
      targetClosingDate,
      createdBy: authUser.id,
      createdByName: authUser.email || authUser.name || authUser.id,
    });

    if (!result.success) {
      if (result.reason === 'CHECKLIST_EXISTS') {
        return sendError(res, 409, 'DD checklist already exists for this deal');
      }
      return sendError(res, 400, result.reason);
    }

    log.info('Checklist initialized', { dealId, checklistId: result.checklist.id });
    sendJson(res, 201, result);

  } catch (error) {
    log.error('Failed to initialize checklist', { dealId, error: error.message });
    sendError(res, 500, 'Failed to initialize DD checklist', error.message);
  }
}

/**
 * GET /api/deals/:dealId/dd-checklist
 * Get DD checklist with all items
 */
export async function handleGetChecklist(req, res, dealId, authUser, url) {
  log.debug('Get checklist request', { dealId, userId: authUser.id });

  try {
    const checklist = await getChecklist(dealId);

    if (!checklist) {
      return sendError(res, 404, 'DD checklist not found');
    }

    sendJson(res, 200, { checklist });

  } catch (error) {
    log.error('Failed to get checklist', { dealId, error: error.message });
    sendError(res, 500, 'Failed to get DD checklist', error.message);
  }
}

/**
 * GET /api/deals/:dealId/dd-checklist/status
 * Get completion status summary
 */
export async function handleGetChecklistStatus(req, res, dealId, authUser) {
  log.debug('Get checklist status request', { dealId });

  try {
    const status = await getDDCompletionStatus(dealId);

    sendJson(res, 200, status);

  } catch (error) {
    log.error('Failed to get checklist status', { dealId, error: error.message });
    sendError(res, 500, 'Failed to get DD checklist status', error.message);
  }
}

/**
 * GET /api/deals/:dealId/dd-checklist/items
 * Get items filtered by deal state
 */
export async function handleGetChecklistItems(req, res, dealId, authUser, url) {
  log.debug('Get checklist items request', { dealId });

  try {
    const dealState = url.searchParams.get('dealState') || 'DD_ACTIVE';
    const categoryCode = url.searchParams.get('category');
    const status = url.searchParams.get('status');
    const priority = url.searchParams.get('priority');

    const result = await getStageFilteredItems(dealId, dealState);

    if (!result) {
      return sendError(res, 404, 'DD checklist not found');
    }

    // Apply additional filters
    let items = result.items;

    if (categoryCode) {
      items = items.filter(i => i.categoryCode === categoryCode);
    }
    if (status) {
      items = items.filter(i => i.status === status);
    }
    if (priority) {
      items = items.filter(i => i.priority === priority);
    }

    sendJson(res, 200, {
      checklistId: result.checklistId,
      dealState: result.dealState,
      summary: result.summary,
      categories: result.categories,
      items,
    });

  } catch (error) {
    log.error('Failed to get checklist items', { dealId, error: error.message });
    sendError(res, 500, 'Failed to get DD checklist items', error.message);
  }
}

// ==================== ITEM MANAGEMENT ====================

/**
 * GET /api/deals/:dealId/dd-checklist/items/:itemId
 * Get single item with history
 */
export async function handleGetItem(req, res, dealId, itemId, authUser) {
  log.debug('Get item request', { dealId, itemId });

  try {
    const prisma = getPrisma();
    const item = await prisma.dDItem.findUnique({
      where: { id: itemId },
      include: {
        history: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        }
      }
    });

    if (!item) {
      return sendError(res, 404, 'DD item not found');
    }

    sendJson(res, 200, { item });

  } catch (error) {
    log.error('Failed to get item', { itemId, error: error.message });
    sendError(res, 500, 'Failed to get DD item', error.message);
  }
}

/**
 * PATCH /api/deals/:dealId/dd-checklist/items/:itemId
 * Update item status
 */
export async function handleUpdateItem(req, res, dealId, itemId, authUser, readJsonBody) {
  log.info('Update item request', { dealId, itemId, userId: authUser.id });

  try {
    const body = await readJsonBody(req);
    const { status, notes } = body;

    if (!status) {
      return sendError(res, 400, 'status is required');
    }

    const validStatuses = ['NOT_STARTED', 'IN_PROGRESS', 'WAITING', 'BLOCKED', 'COMPLETE', 'N/A'];
    if (!validStatuses.includes(status)) {
      return sendError(res, 400, `Invalid status. Must be one of: ${validStatuses.join(', ')}`);
    }

    const userName = authUser.email || authUser.name || authUser.id;
    const item = await updateItemStatus(itemId, status, authUser.id, userName, notes);

    log.info('Item updated', { itemId, status });
    sendJson(res, 200, { item });

  } catch (error) {
    log.error('Failed to update item', { itemId, error: error.message });
    sendError(res, 500, 'Failed to update DD item', error.message);
  }
}

/**
 * POST /api/deals/:dealId/dd-checklist/items/:itemId/assign
 * Assign item to user
 */
export async function handleAssignItem(req, res, dealId, itemId, authUser, readJsonBody) {
  log.info('Assign item request', { dealId, itemId, userId: authUser.id });

  try {
    const body = await readJsonBody(req);
    const { assigneeUserId, assigneeName } = body;

    if (!assigneeUserId || !assigneeName) {
      return sendError(res, 400, 'assigneeUserId and assigneeName are required');
    }

    const item = await assignItem(itemId, assigneeUserId, assigneeName, authUser.id);

    log.info('Item assigned', { itemId, assignee: assigneeName });
    sendJson(res, 200, { item });

  } catch (error) {
    log.error('Failed to assign item', { itemId, error: error.message });
    sendError(res, 500, 'Failed to assign DD item', error.message);
  }
}

/**
 * POST /api/deals/:dealId/dd-checklist/items/:itemId/link-document
 * Link document to item
 */
export async function handleLinkDocument(req, res, dealId, itemId, authUser, readJsonBody) {
  log.info('Link document request', { dealId, itemId, userId: authUser.id });

  try {
    const body = await readJsonBody(req);
    const { documentId } = body;

    if (!documentId) {
      return sendError(res, 400, 'documentId is required');
    }

    const item = await linkDocument(itemId, documentId, authUser.id);

    log.info('Document linked', { itemId, documentId });
    sendJson(res, 200, { item });

  } catch (error) {
    log.error('Failed to link document', { itemId, error: error.message });
    sendError(res, 500, 'Failed to link document', error.message);
  }
}

/**
 * POST /api/deals/:dealId/dd-checklist/items/:itemId/verify
 * Verify item
 */
export async function handleVerifyItem(req, res, dealId, itemId, authUser, readJsonBody) {
  log.info('Verify item request', { dealId, itemId, userId: authUser.id });

  try {
    const body = await readJsonBody(req);
    const { notes } = body;

    const userName = authUser.email || authUser.name || authUser.id;
    const item = await markAsVerified(itemId, authUser.id, userName, notes);

    log.info('Item verified', { itemId });
    sendJson(res, 200, { item });

  } catch (error) {
    log.error('Failed to verify item', { itemId, error: error.message });
    sendError(res, 500, 'Failed to verify DD item', error.message);
  }
}

/**
 * POST /api/deals/:dealId/dd-checklist/items/:itemId/mark-na
 * Mark item as N/A
 */
export async function handleMarkNA(req, res, dealId, itemId, authUser, readJsonBody) {
  log.info('Mark N/A request', { dealId, itemId, userId: authUser.id });

  try {
    const body = await readJsonBody(req);
    const { reason } = body;

    if (!reason) {
      return sendError(res, 400, 'reason is required to mark item as N/A');
    }

    const item = await markItemNA(itemId, reason, authUser.id);

    log.info('Item marked N/A', { itemId, reason });
    sendJson(res, 200, { item });

  } catch (error) {
    log.error('Failed to mark item N/A', { itemId, error: error.message });
    sendError(res, 500, 'Failed to mark DD item as N/A', error.message);
  }
}

/**
 * POST /api/deals/:dealId/dd-checklist/items/custom
 * Add custom item
 */
export async function handleAddCustomItem(req, res, dealId, authUser, readJsonBody) {
  log.info('Add custom item request', { dealId, userId: authUser.id });

  try {
    const body = await readJsonBody(req);

    if (!body.title) {
      return sendError(res, 400, 'title is required');
    }

    // Get checklist ID
    const prisma = getPrisma();
    const checklist = await prisma.dDChecklist.findUnique({
      where: { dealId }
    });

    if (!checklist) {
      return sendError(res, 404, 'DD checklist not found. Initialize checklist first.');
    }

    const item = await addCustomItem(checklist.id, body, authUser.id);

    log.info('Custom item added', { itemId: item.id, code: item.code });
    sendJson(res, 201, { item });

  } catch (error) {
    log.error('Failed to add custom item', { dealId, error: error.message });
    sendError(res, 500, 'Failed to add custom DD item', error.message);
  }
}

/**
 * GET /api/deals/:dealId/dd-checklist/items/:itemId/history
 * Get item history
 */
export async function handleGetItemHistory(req, res, dealId, itemId, authUser) {
  log.debug('Get item history request', { dealId, itemId });

  try {
    const history = await getItemHistory(itemId);

    sendJson(res, 200, { history });

  } catch (error) {
    log.error('Failed to get item history', { itemId, error: error.message });
    sendError(res, 500, 'Failed to get DD item history', error.message);
  }
}

// ==================== TEMPLATE MANAGEMENT ====================

/**
 * GET /api/admin/dd-templates
 * Get template library
 */
export async function handleGetTemplates(req, res, authUser) {
  log.debug('Get templates request', { userId: authUser.id });

  try {
    const categories = await getTemplateLibrary();

    sendJson(res, 200, {
      categories,
      totalItems: categories.reduce((sum, cat) => sum + cat.items.length, 0),
    });

  } catch (error) {
    log.error('Failed to get templates', { error: error.message });
    sendError(res, 500, 'Failed to get DD templates', error.message);
  }
}

/**
 * GET /api/admin/dd-templates/categories
 * Get categories only
 */
export async function handleGetCategories(req, res, authUser) {
  log.debug('Get categories request', { userId: authUser.id });

  try {
    const prisma = getPrisma();
    const categories = await prisma.dDCategory.findMany({
      orderBy: { displayOrder: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        displayOrder: true,
      }
    });

    sendJson(res, 200, { categories });

  } catch (error) {
    log.error('Failed to get categories', { error: error.message });
    sendError(res, 500, 'Failed to get DD categories', error.message);
  }
}

// ==================== AI FEATURES ====================

/**
 * GET /api/deals/:dealId/dd-checklist/suggestions
 * Get AI-suggested next items to work on
 */
export async function handleGetSuggestions(req, res, dealId, authUser, url) {
  log.debug('Get suggestions request', { dealId, userId: authUser.id });
  try {
    const params = new URL(url, 'http://localhost').searchParams;
    const limit = parseInt(params.get('limit') || '5');
    const result = await suggestNextItems(dealId, limit);
    sendJson(res, 200, result);
  } catch (error) {
    log.error('Failed to get suggestions', { dealId, error: error.message });
    sendError(res, 500, 'Failed to get DD suggestions', error.message);
  }
}

/**
 * GET /api/deals/:dealId/dd-checklist/risks
 * Detect risks in DD checklist
 */
export async function handleGetRisks(req, res, dealId, authUser) {
  log.debug('Get risks request', { dealId, userId: authUser.id });
  try {
    const result = await detectRisks(dealId);
    sendJson(res, 200, result);
  } catch (error) {
    log.error('Failed to detect risks', { dealId, error: error.message });
    sendError(res, 500, 'Failed to detect DD risks', error.message);
  }
}

/**
 * GET /api/deals/:dealId/dd-checklist/summary?audience=internal|ic_memo|lender
 * Generate status summary for different audiences
 */
export async function handleGetSummary(req, res, dealId, authUser, url) {
  log.debug('Get summary request', { dealId, userId: authUser.id });
  try {
    const params = new URL(url, 'http://localhost').searchParams;
    const audience = params.get('audience') || 'internal';
    const result = await generateStatusSummary(dealId, audience);
    sendJson(res, 200, result);
  } catch (error) {
    log.error('Failed to generate summary', { dealId, error: error.message });
    sendError(res, 500, 'Failed to generate DD summary', error.message);
  }
}

/**
 * POST /api/deals/:dealId/dd-checklist/process-document
 * Auto-process an uploaded document
 */
export async function handleProcessDocument(req, res, dealId, authUser, readJsonBody) {
  log.info('Process document request', { dealId, userId: authUser.id });
  try {
    const body = await readJsonBody(req);
    if (!body.documentId) {
      return sendError(res, 400, 'documentId is required');
    }
    const result = await autoProcessDocument(dealId, body.documentId, body.options || {});
    sendJson(res, 200, result);
  } catch (error) {
    log.error('Failed to process document', { dealId, error: error.message });
    sendError(res, 500, 'Failed to process document', error.message);
  }
}

/**
 * GET /api/deals/:dealId/dd-checklist/pending-approvals
 * Get pending document match approvals
 */
export async function handleGetPendingApprovals(req, res, dealId, authUser) {
  log.debug('Get pending approvals request', { dealId, userId: authUser.id });
  try {
    const result = await getPendingApprovals(dealId);
    sendJson(res, 200, result);
  } catch (error) {
    log.error('Failed to get pending approvals', { dealId, error: error.message });
    sendError(res, 500, 'Failed to get pending approvals', error.message);
  }
}

/**
 * POST /api/deals/:dealId/dd-checklist/approvals/:approvalId/approve
 * Approve a document match
 */
export async function handleApproveMatch(req, res, dealId, approvalId, authUser, readJsonBody) {
  log.info('Approve match request', { dealId, approvalId, userId: authUser.id });
  try {
    const body = await readJsonBody(req);
    const result = await approveDocumentMatch(approvalId, authUser.id, body || {});
    sendJson(res, 200, result);
  } catch (error) {
    log.error('Failed to approve match', { approvalId, error: error.message });
    sendError(res, 500, 'Failed to approve document match', error.message);
  }
}

/**
 * POST /api/deals/:dealId/dd-checklist/approvals/:approvalId/reject
 * Reject a document match
 */
export async function handleRejectMatch(req, res, dealId, approvalId, authUser, readJsonBody) {
  log.info('Reject match request', { dealId, approvalId, userId: authUser.id });
  try {
    const body = await readJsonBody(req);
    if (!body.reason) {
      return sendError(res, 400, 'reason is required to reject a match');
    }
    const result = await rejectDocumentMatch(approvalId, authUser.id, body.reason);
    sendJson(res, 200, result);
  } catch (error) {
    log.error('Failed to reject match', { approvalId, error: error.message });
    sendError(res, 500, 'Failed to reject document match', error.message);
  }
}
