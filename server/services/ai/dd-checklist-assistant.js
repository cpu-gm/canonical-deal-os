/**
 * Due Diligence Checklist AI Assistant
 *
 * Provides intelligent DD workflow management:
 * - Auto-generates checklists from templates
 * - Calculates deadlines from deal dates
 * - Stage-gates items based on deal state
 * - Matches uploaded documents to DD items
 * - Prioritizes items based on risk and timeline
 * - Integrates with deal-state-machine blocker
 *
 * Phase 2.4 Implementation
 */

import { getPrisma } from '../../db.js';

// ==================== CONFIGURATION ====================

export const DD_ASSISTANT_CONFIG = {
  enabled: process.env.DD_ASSISTANT_ENABLED !== 'false',
  autoMatchDocuments: process.env.DD_AUTO_MATCH_DOCS === 'true',
  aiModel: process.env.DD_ASSISTANT_MODEL || 'gpt-4o-mini',
  debug: process.env.DEBUG_DD_ASSISTANT === 'true',
  // Completion thresholds
  criticalRequiredPct: parseFloat(process.env.DD_CRITICAL_REQUIRED_PCT || '100'),
  highRequiredPct: parseFloat(process.env.DD_HIGH_REQUIRED_PCT || '90'),
};

// ==================== LOGGING ====================

/**
 * Create logger with category prefix
 */
function createLogger(category) {
  const DEBUG = DD_ASSISTANT_CONFIG.debug;
  const timestamp = () => new Date().toISOString();

  return {
    debug: (message, meta = {}) => {
      if (DEBUG) {
        console.log(`[${timestamp()}] [DEBUG] [${category}] ${message}`, Object.keys(meta).length ? JSON.stringify(meta) : '');
      }
    },
    info: (message, meta = {}) => {
      console.log(`[${timestamp()}] [INFO] [${category}] ${message}`, Object.keys(meta).length ? JSON.stringify(meta) : '');
    },
    warn: (message, meta = {}) => {
      console.log(`[${timestamp()}] [WARN] [${category}] ${message}`, Object.keys(meta).length ? JSON.stringify(meta) : '');
    },
    error: (message, meta = {}) => {
      console.error(`[${timestamp()}] [ERROR] [${category}] ${message}`, Object.keys(meta).length ? JSON.stringify(meta) : '');
    }
  };
}

// ==================== DEAL STATE CONSTANTS ====================

const STATE_ORDER = {
  'INTAKE_RECEIVED': 0,
  'DATA_ROOM_INGESTED': 1,
  'EXTRACTION_COMPLETE': 2,
  'UNDERWRITING_DRAFT': 3,
  'IC_READY': 4,
  'LOI_DRAFT': 5,
  'LOI_SENT': 6,
  'LOI_ACCEPTED': 7,
  'PSA_DRAFT': 8,
  'PSA_EXECUTED': 9,
  'DD_ACTIVE': 10,
  'DD_COMPLETE': 11,
  'FINANCING_IN_PROGRESS': 12,
  'FINANCING_COMMITTED': 13,
  'CLEAR_TO_CLOSE': 14,
  'CLOSED': 15
};

const ITEM_STATUS = {
  NOT_STARTED: 'NOT_STARTED',
  IN_PROGRESS: 'IN_PROGRESS',
  WAITING: 'WAITING',
  BLOCKED: 'BLOCKED',
  COMPLETE: 'COMPLETE',
  NA: 'N/A'
};

const ITEM_PRIORITY = {
  CRITICAL: 'CRITICAL',
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW'
};

// ==================== CORE FUNCTIONS ====================

/**
 * Initialize DD checklist for a deal
 * Creates checklist from template with calculated deadlines
 *
 * @param {string} dealId - Deal ID
 * @param {Object} options - Options
 * @param {string} options.organizationId - Organization ID
 * @param {Date} options.psaEffectiveDate - PSA effective date
 * @param {Date} options.ddExpirationDate - DD expiration date
 * @param {Date} options.targetClosingDate - Target closing date
 * @param {string} options.createdBy - User ID creating the checklist
 * @returns {Object} Created checklist with items
 */
export async function initializeChecklist(dealId, options = {}) {
  const log = createLogger('DD-CHECKLIST');
  const prisma = getPrisma();

  log.info('Initializing DD checklist', { dealId });

  try {
    // Check if checklist already exists
    const existing = await prisma.dDChecklist.findUnique({
      where: { dealId }
    });

    if (existing) {
      log.warn('DD checklist already exists for deal', { dealId, checklistId: existing.id });
      return { success: false, reason: 'CHECKLIST_EXISTS', checklist: existing };
    }

    // Get all active template items
    const templateItems = await prisma.dDTemplateItem.findMany({
      where: { isActive: true },
      include: { category: true },
      orderBy: [
        { category: { displayOrder: 'asc' } },
        { displayOrder: 'asc' }
      ]
    });

    log.debug('Found template items', { count: templateItems.length });

    // Calculate deal dates
    const dealDates = {
      psaEffectiveDate: options.psaEffectiveDate ? new Date(options.psaEffectiveDate) : null,
      ddExpirationDate: options.ddExpirationDate ? new Date(options.ddExpirationDate) : null,
      targetClosingDate: options.targetClosingDate ? new Date(options.targetClosingDate) : null,
    };

    // Create checklist
    const checklist = await prisma.dDChecklist.create({
      data: {
        dealId,
        organizationId: options.organizationId,
        status: 'NOT_STARTED',
        psaEffectiveDate: dealDates.psaEffectiveDate,
        ddExpirationDate: dealDates.ddExpirationDate,
        targetClosingDate: dealDates.targetClosingDate,
        totalItems: templateItems.length,
        completedItems: 0,
        blockedItems: 0,
      }
    });

    log.info('Created DD checklist', { checklistId: checklist.id, dealId });

    // Create DD items from templates
    const items = [];
    for (const template of templateItems) {
      const dueDate = calculateDueDate(template, dealDates);

      const item = await prisma.dDItem.create({
        data: {
          checklistId: checklist.id,
          templateItemId: template.id,
          categoryCode: template.category.code,
          code: template.code,
          title: template.title,
          description: template.description,
          responsible: template.defaultResponsible,
          priority: template.priority,
          availableFromState: template.availableFromState,
          dueDate,
          requiresDocument: template.requiresDocument,
          status: ITEM_STATUS.NOT_STARTED,
        }
      });

      // Create history entry
      await prisma.dDItemHistory.create({
        data: {
          ddItemId: item.id,
          action: 'CREATED',
          newStatus: ITEM_STATUS.NOT_STARTED,
          changedBy: options.createdBy || 'SYSTEM',
          changedByName: options.createdByName || 'System',
          notes: 'Item created from template'
        }
      });

      items.push(item);
    }

    log.info('Created DD items', { checklistId: checklist.id, itemCount: items.length });

    return {
      success: true,
      checklist: {
        ...checklist,
        items
      }
    };

  } catch (error) {
    log.error('Failed to initialize checklist', { dealId, error: error.message });
    throw error;
  }
}

/**
 * Calculate due date for a DD item based on deal dates
 */
function calculateDueDate(template, dealDates) {
  const { deadlineType, deadlineDaysOffset } = template;

  let referenceDate = null;

  switch (deadlineType) {
    case 'PSA_RELATIVE':
    case 'PSA_EXECUTED':
      referenceDate = dealDates.psaEffectiveDate;
      break;
    case 'DD_RELATIVE':
      referenceDate = dealDates.ddExpirationDate;
      break;
    case 'CLOSING_RELATIVE':
      referenceDate = dealDates.targetClosingDate;
      break;
    case 'LOI_ACCEPTED':
      // Use PSA date as fallback for LOI items
      referenceDate = dealDates.psaEffectiveDate;
      break;
    case 'FINANCING_IN_PROGRESS':
    case 'FINANCING_COMMITTED':
      // Use target closing date minus buffer
      referenceDate = dealDates.targetClosingDate;
      break;
    default:
      referenceDate = dealDates.ddExpirationDate;
  }

  if (!referenceDate) {
    return null;
  }

  const dueDate = new Date(referenceDate);
  dueDate.setDate(dueDate.getDate() + deadlineDaysOffset);
  return dueDate;
}

/**
 * Get DD items filtered by current deal state
 * Only returns items appropriate for current workflow stage
 *
 * @param {string} dealId - Deal ID
 * @param {string} dealState - Current deal state
 * @returns {Object} Filtered items grouped by category
 */
export async function getStageFilteredItems(dealId, dealState) {
  const log = createLogger('DD-CHECKLIST');
  const prisma = getPrisma();

  log.debug('Getting stage-filtered items', { dealId, dealState });

  const currentStateOrder = STATE_ORDER[dealState] || 0;

  // Get checklist with all items
  const checklist = await prisma.dDChecklist.findUnique({
    where: { dealId },
    include: {
      items: {
        orderBy: [
          { priority: 'asc' },
          { dueDate: 'asc' }
        ]
      }
    }
  });

  if (!checklist) {
    log.warn('No DD checklist found for deal', { dealId });
    return null;
  }

  // Filter items to only those available at current state
  const visibleItems = checklist.items.filter(item => {
    const itemStateOrder = STATE_ORDER[item.availableFromState] || 10;
    return itemStateOrder <= currentStateOrder;
  });

  // Group by category with counts
  const categories = {};
  for (const item of visibleItems) {
    if (!categories[item.categoryCode]) {
      categories[item.categoryCode] = {
        code: item.categoryCode,
        items: [],
        total: 0,
        completed: 0,
        inProgress: 0,
        blocked: 0,
        notStarted: 0
      };
    }
    categories[item.categoryCode].items.push(item);
    categories[item.categoryCode].total++;

    switch (item.status) {
      case ITEM_STATUS.COMPLETE:
      case ITEM_STATUS.NA:
        categories[item.categoryCode].completed++;
        break;
      case ITEM_STATUS.IN_PROGRESS:
      case ITEM_STATUS.WAITING:
        categories[item.categoryCode].inProgress++;
        break;
      case ITEM_STATUS.BLOCKED:
        categories[item.categoryCode].blocked++;
        break;
      default:
        categories[item.categoryCode].notStarted++;
    }
  }

  // Calculate overall summary
  const summary = {
    totalVisible: visibleItems.length,
    totalAll: checklist.items.length,
    completed: visibleItems.filter(i => i.status === ITEM_STATUS.COMPLETE || i.status === ITEM_STATUS.NA).length,
    inProgress: visibleItems.filter(i => i.status === ITEM_STATUS.IN_PROGRESS || i.status === ITEM_STATUS.WAITING).length,
    blocked: visibleItems.filter(i => i.status === ITEM_STATUS.BLOCKED).length,
    notStarted: visibleItems.filter(i => i.status === ITEM_STATUS.NOT_STARTED).length,
    completionPct: visibleItems.length > 0
      ? Math.round((visibleItems.filter(i => i.status === ITEM_STATUS.COMPLETE || i.status === ITEM_STATUS.NA).length / visibleItems.length) * 100)
      : 0
  };

  log.debug('Stage-filtered items', {
    dealId,
    dealState,
    totalVisible: summary.totalVisible,
    completed: summary.completed
  });

  return {
    checklistId: checklist.id,
    dealState,
    summary,
    categories: Object.values(categories),
    items: visibleItems
  };
}

/**
 * Get DD completion status for deal-state-machine blocker
 * This replaces the stubbed ddItemsComplete() function
 *
 * @param {string} dealId - Deal ID
 * @returns {Object} { blocked: boolean, reason?: string, blockedItems?: array }
 */
export async function getDDCompletionStatus(dealId) {
  const log = createLogger('DD-STATE');
  const prisma = getPrisma();

  log.debug('Checking DD completion status', { dealId });

  const checklist = await prisma.dDChecklist.findUnique({
    where: { dealId },
    include: {
      items: {
        where: {
          priority: { in: [ITEM_PRIORITY.CRITICAL, ITEM_PRIORITY.HIGH] }
        }
      }
    }
  });

  if (!checklist) {
    log.warn('DD checklist not initialized', { dealId });
    return { blocked: true, reason: 'DD checklist not initialized' };
  }

  // Check critical items - 100% must be complete
  const criticalItems = checklist.items.filter(i => i.priority === ITEM_PRIORITY.CRITICAL);
  const incompleteCritical = criticalItems.filter(i =>
    i.status !== ITEM_STATUS.COMPLETE && i.status !== ITEM_STATUS.NA
  );

  if (incompleteCritical.length > 0) {
    log.info('DD blocked - critical items incomplete', {
      dealId,
      incompleteCount: incompleteCritical.length,
      totalCritical: criticalItems.length
    });

    return {
      blocked: true,
      reason: `${incompleteCritical.length} critical DD items incomplete`,
      blockedItems: incompleteCritical.slice(0, 5).map(i => ({
        code: i.code,
        title: i.title,
        status: i.status
      }))
    };
  }

  // Check high priority items - configurable threshold must be complete
  const highItems = checklist.items.filter(i => i.priority === ITEM_PRIORITY.HIGH);
  const incompleteHigh = highItems.filter(i =>
    i.status !== ITEM_STATUS.COMPLETE && i.status !== ITEM_STATUS.NA
  );

  if (highItems.length > 0) {
    const highCompletionPct = ((highItems.length - incompleteHigh.length) / highItems.length) * 100;
    const requiredPct = DD_ASSISTANT_CONFIG.highRequiredPct;

    if (highCompletionPct < requiredPct) {
      log.info('DD blocked - high priority items below threshold', {
        dealId,
        completionPct: Math.round(highCompletionPct),
        requiredPct
      });

      return {
        blocked: true,
        reason: `Only ${Math.round(highCompletionPct)}% of high-priority DD items complete (need ${requiredPct}%)`,
        blockedItems: incompleteHigh.slice(0, 5).map(i => ({
          code: i.code,
          title: i.title,
          status: i.status
        }))
      };
    }
  }

  log.info('DD completion check passed', { dealId });
  return { blocked: false };
}

/**
 * Update DD item status with history tracking
 *
 * @param {string} itemId - DD Item ID
 * @param {string} newStatus - New status
 * @param {string} userId - User making the change
 * @param {string} notes - Optional notes
 * @returns {Object} Updated item
 */
export async function updateItemStatus(itemId, newStatus, userId, userNameOrNotes = null, notes = null) {
  const log = createLogger('DD-ITEM');
  const prisma = getPrisma();

  // Handle backwards compatible signature
  let userName = userNameOrNotes;
  let actualNotes = notes;
  if (notes === null && typeof userNameOrNotes === 'string' && !['BUYER', 'SELLER', 'COUNSEL', 'LENDER', 'TITLE_CO', 'BOTH'].includes(userNameOrNotes)) {
    // Old signature: updateItemStatus(itemId, newStatus, userId, notes)
    actualNotes = userNameOrNotes;
    userName = null;
  }

  log.info('Updating item status', { itemId, newStatus, userId });

  try {
    // Get current item
    const item = await prisma.dDItem.findUnique({
      where: { id: itemId },
      include: { checklist: true }
    });

    if (!item) {
      throw new Error('DD item not found');
    }

    const previousStatus = item.status;

    // Prepare update data
    const updateData = {
      status: newStatus,
      notes: actualNotes || item.notes,
    };

    // Set timestamp based on status
    if (newStatus === ITEM_STATUS.IN_PROGRESS && !item.startedAt) {
      updateData.startedAt = new Date();
    } else if (newStatus === ITEM_STATUS.COMPLETE || newStatus === ITEM_STATUS.NA) {
      updateData.completedAt = new Date();
    }

    // Update item
    const updatedItem = await prisma.dDItem.update({
      where: { id: itemId },
      data: updateData
    });

    // Create history entry
    await prisma.dDItemHistory.create({
      data: {
        ddItemId: itemId,
        action: 'STATUS_CHANGED',
        previousStatus,
        newStatus,
        changedBy: userId,
        changedByName: userName || userId,
        notes: actualNotes
      }
    });

    // Update checklist summary metrics
    await updateChecklistMetrics(item.checklistId);

    log.info('Item status updated', {
      itemId,
      code: item.code,
      previousStatus,
      newStatus
    });

    return updatedItem;

  } catch (error) {
    log.error('Failed to update item status', { itemId, error: error.message });
    throw error;
  }
}

/**
 * Assign DD item to user
 *
 * @param {string} itemId - DD Item ID
 * @param {string} assigneeUserId - User to assign to
 * @param {string} assigneeName - Assignee name
 * @param {string} assignerUserId - User making the assignment
 * @returns {Object} Updated item
 */
export async function assignItem(itemId, assigneeUserId, assigneeName, assignerUserId) {
  const log = createLogger('DD-ITEM');
  const prisma = getPrisma();

  log.info('Assigning item', { itemId, assigneeUserId, assignerUserId });

  try {
    const item = await prisma.dDItem.findUnique({
      where: { id: itemId }
    });

    if (!item) {
      throw new Error('DD item not found');
    }

    const updatedItem = await prisma.dDItem.update({
      where: { id: itemId },
      data: {
        assignedToUserId: assigneeUserId,
        assignedToName: assigneeName,
        assignedAt: new Date()
      }
    });

    // Create history entry
    await prisma.dDItemHistory.create({
      data: {
        ddItemId: itemId,
        action: 'ASSIGNED',
        changedBy: assignerUserId,
        changedByName: assignerUserId,
        notes: `Assigned to ${assigneeName}`
      }
    });

    log.info('Item assigned', { itemId, code: item.code, assignee: assigneeName });

    return updatedItem;

  } catch (error) {
    log.error('Failed to assign item', { itemId, error: error.message });
    throw error;
  }
}

/**
 * Link document to DD item
 *
 * @param {string} itemId - DD Item ID
 * @param {string} documentId - Document ID to link
 * @param {string} userId - User making the change
 * @returns {Object} Updated item
 */
export async function linkDocument(itemId, documentId, userId) {
  const log = createLogger('DD-ITEM');
  const prisma = getPrisma();

  log.info('Linking document to item', { itemId, documentId, userId });

  try {
    const item = await prisma.dDItem.findUnique({
      where: { id: itemId }
    });

    if (!item) {
      throw new Error('DD item not found');
    }

    // Parse existing linked documents
    const linkedDocs = item.linkedDocumentIds ? JSON.parse(item.linkedDocumentIds) : [];

    // Add new document if not already linked
    if (!linkedDocs.includes(documentId)) {
      linkedDocs.push(documentId);
    }

    const updatedItem = await prisma.dDItem.update({
      where: { id: itemId },
      data: {
        linkedDocumentIds: JSON.stringify(linkedDocs)
      }
    });

    // Create history entry
    await prisma.dDItemHistory.create({
      data: {
        ddItemId: itemId,
        action: 'DOCUMENT_LINKED',
        changedBy: userId,
        changedByName: userId,
        notes: `Linked document: ${documentId}`
      }
    });

    log.info('Document linked to item', { itemId, code: item.code, documentId });

    return updatedItem;

  } catch (error) {
    log.error('Failed to link document', { itemId, documentId, error: error.message });
    throw error;
  }
}

/**
 * Mark item as verified
 *
 * @param {string} itemId - DD Item ID
 * @param {string} userId - User verifying
 * @param {string} userName - Verifier name
 * @param {string} notes - Verification notes
 * @returns {Object} Updated item
 */
export async function markAsVerified(itemId, userId, userName, notes = null) {
  const log = createLogger('DD-ITEM');
  const prisma = getPrisma();

  log.info('Marking item as verified', { itemId, userId });

  try {
    const item = await prisma.dDItem.findUnique({
      where: { id: itemId }
    });

    if (!item) {
      throw new Error('DD item not found');
    }

    const updatedItem = await prisma.dDItem.update({
      where: { id: itemId },
      data: {
        verifiedBy: userId,
        verifiedByName: userName,
        verifiedAt: new Date(),
        verificationNotes: notes,
        status: ITEM_STATUS.COMPLETE,
        completedAt: new Date()
      }
    });

    // Create history entry
    await prisma.dDItemHistory.create({
      data: {
        ddItemId: itemId,
        action: 'VERIFIED',
        previousStatus: item.status,
        newStatus: ITEM_STATUS.COMPLETE,
        changedBy: userId,
        changedByName: userName,
        notes: notes || 'Item verified'
      }
    });

    // Update checklist metrics
    await updateChecklistMetrics(item.checklistId);

    log.info('Item verified', { itemId, code: item.code, verifiedBy: userName });

    return updatedItem;

  } catch (error) {
    log.error('Failed to verify item', { itemId, error: error.message });
    throw error;
  }
}

/**
 * Mark item as N/A with required reason
 *
 * @param {string} itemId - DD Item ID
 * @param {string} reason - Reason for marking N/A
 * @param {string} userId - User making the change
 * @returns {Object} Updated item
 */
export async function markItemNA(itemId, reason, userId) {
  const log = createLogger('DD-ITEM');
  const prisma = getPrisma();

  if (!reason) {
    throw new Error('Reason is required to mark item as N/A');
  }

  log.info('Marking item as N/A', { itemId, userId });

  try {
    const item = await prisma.dDItem.findUnique({
      where: { id: itemId }
    });

    if (!item) {
      throw new Error('DD item not found');
    }

    const updatedItem = await prisma.dDItem.update({
      where: { id: itemId },
      data: {
        status: ITEM_STATUS.NA,
        completedAt: new Date(),
        notes: reason
      }
    });

    // Create history entry
    await prisma.dDItemHistory.create({
      data: {
        ddItemId: itemId,
        action: 'STATUS_CHANGED',
        previousStatus: item.status,
        newStatus: ITEM_STATUS.NA,
        changedBy: userId,
        changedByName: userId,
        notes: `Marked N/A: ${reason}`
      }
    });

    // Update checklist metrics
    await updateChecklistMetrics(item.checklistId);

    log.info('Item marked N/A', { itemId, code: item.code, reason });

    return updatedItem;

  } catch (error) {
    log.error('Failed to mark item N/A', { itemId, error: error.message });
    throw error;
  }
}

/**
 * Add custom DD item to deal checklist
 *
 * @param {string} checklistId - Checklist ID
 * @param {Object} itemData - Item data
 * @param {string} userId - User creating the item
 * @returns {Object} Created item
 */
export async function addCustomItem(checklistId, itemData, userId) {
  const log = createLogger('DD-ITEM');
  const prisma = getPrisma();

  log.info('Adding custom item', { checklistId, title: itemData.title, userId });

  try {
    // Get checklist to find next code
    const checklist = await prisma.dDChecklist.findUnique({
      where: { id: checklistId },
      include: {
        items: {
          where: { code: { startsWith: 'CUSTOM_' } }
        }
      }
    });

    if (!checklist) {
      throw new Error('DD checklist not found');
    }

    // Generate custom code
    const customCount = checklist.items.length + 1;
    const code = `CUSTOM_${String(customCount).padStart(3, '0')}`;

    const item = await prisma.dDItem.create({
      data: {
        checklistId,
        templateItemId: null, // Custom item
        categoryCode: itemData.categoryCode || 'CUSTOM',
        code,
        title: itemData.title,
        description: itemData.description,
        responsible: itemData.responsible || 'BUYER',
        priority: itemData.priority || ITEM_PRIORITY.MEDIUM,
        availableFromState: itemData.availableFromState || 'DD_ACTIVE',
        dueDate: itemData.dueDate ? new Date(itemData.dueDate) : null,
        requiresDocument: itemData.requiresDocument || false,
        status: ITEM_STATUS.NOT_STARTED,
      }
    });

    // Create history entry
    await prisma.dDItemHistory.create({
      data: {
        ddItemId: item.id,
        action: 'CREATED',
        newStatus: ITEM_STATUS.NOT_STARTED,
        changedBy: userId,
        changedByName: userId,
        notes: 'Custom item created'
      }
    });

    // Update checklist total
    await prisma.dDChecklist.update({
      where: { id: checklistId },
      data: {
        totalItems: { increment: 1 }
      }
    });

    log.info('Custom item created', { itemId: item.id, code, title: item.title });

    return item;

  } catch (error) {
    log.error('Failed to add custom item', { checklistId, error: error.message });
    throw error;
  }
}

/**
 * Get full checklist with all items
 *
 * @param {string} dealId - Deal ID
 * @returns {Object} Full checklist
 */
export async function getChecklist(dealId) {
  const log = createLogger('DD-CHECKLIST');
  const prisma = getPrisma();

  log.debug('Getting checklist', { dealId });

  const checklist = await prisma.dDChecklist.findUnique({
    where: { dealId },
    include: {
      items: {
        orderBy: [
          { priority: 'asc' },
          { dueDate: 'asc' }
        ]
      }
    }
  });

  if (!checklist) {
    log.warn('No DD checklist found', { dealId });
    return null;
  }

  return checklist;
}

/**
 * Get item history
 *
 * @param {string} itemId - DD Item ID
 * @returns {Array} History entries
 */
export async function getItemHistory(itemId) {
  const prisma = getPrisma();

  const history = await prisma.dDItemHistory.findMany({
    where: { ddItemId: itemId },
    orderBy: { createdAt: 'desc' }
  });

  return history;
}

/**
 * Update checklist summary metrics
 */
async function updateChecklistMetrics(checklistId) {
  const prisma = getPrisma();

  const items = await prisma.dDItem.findMany({
    where: { checklistId }
  });

  const completedItems = items.filter(i =>
    i.status === ITEM_STATUS.COMPLETE || i.status === ITEM_STATUS.NA
  ).length;

  const blockedItems = items.filter(i =>
    i.status === ITEM_STATUS.BLOCKED
  ).length;

  // Determine overall status
  let status = 'NOT_STARTED';
  if (completedItems === items.length) {
    status = 'COMPLETE';
  } else if (blockedItems > 0) {
    status = 'BLOCKED';
  } else if (completedItems > 0 || items.some(i => i.status === ITEM_STATUS.IN_PROGRESS)) {
    status = 'IN_PROGRESS';
  }

  await prisma.dDChecklist.update({
    where: { id: checklistId },
    data: {
      totalItems: items.length,
      completedItems,
      blockedItems,
      status,
      completedAt: status === 'COMPLETE' ? new Date() : null
    }
  });
}

// ==================== TEMPLATE FUNCTIONS ====================

/**
 * Get all DD categories and template items
 *
 * @returns {Array} Categories with items
 */
export async function getTemplateLibrary() {
  const prisma = getPrisma();

  const categories = await prisma.dDCategory.findMany({
    orderBy: { displayOrder: 'asc' },
    include: {
      items: {
        where: { isActive: true },
        orderBy: { displayOrder: 'asc' }
      }
    }
  });

  return categories;
}

// ==================== DOCUMENT AUTO-PROCESSING ====================

/**
 * Document type to DD category mapping
 * Used for AI document matching
 */
const DOCUMENT_TYPE_MAPPING = {
  // Title & Legal
  'TITLE_COMMITMENT': { category: 'TITLE', itemCodes: ['TITLE_001', 'TITLE_002'] },
  'ALTA_SURVEY': { category: 'TITLE', itemCodes: ['TITLE_006', 'TITLE_007'] },
  'UCC_SEARCH': { category: 'TITLE', itemCodes: ['TITLE_009'] },
  'JUDGMENT_SEARCH': { category: 'TITLE', itemCodes: ['TITLE_010'] },
  'LIEN_SEARCH': { category: 'TITLE', itemCodes: ['TITLE_010'] },

  // Environmental
  'PHASE_I_ESA': { category: 'ENVIRONMENTAL', itemCodes: ['ENV_001', 'ENV_002'] },
  'PHASE_II_ESA': { category: 'ENVIRONMENTAL', itemCodes: ['ENV_004', 'ENV_005'] },
  'ENVIRONMENTAL_REPORT': { category: 'ENVIRONMENTAL', itemCodes: ['ENV_001'] },

  // Property Condition
  'PCA': { category: 'PROPERTY', itemCodes: ['PROP_001', 'PROP_002'] },
  'PROPERTY_CONDITION_REPORT': { category: 'PROPERTY', itemCodes: ['PROP_001', 'PROP_002'] },
  'ROOF_INSPECTION': { category: 'PROPERTY', itemCodes: ['PROP_007'] },
  'HVAC_INSPECTION': { category: 'PROPERTY', itemCodes: ['PROP_006'] },
  'STRUCTURAL_REPORT': { category: 'PROPERTY', itemCodes: ['PROP_005'] },

  // Financial
  'T12': { category: 'FINANCIAL', itemCodes: ['FIN_001'] },
  'OPERATING_STATEMENT': { category: 'FINANCIAL', itemCodes: ['FIN_001', 'FIN_003'] },
  'RENT_ROLL': { category: 'FINANCIAL', itemCodes: ['FIN_005'] },
  'TAX_BILLS': { category: 'FINANCIAL', itemCodes: ['FIN_009'] },
  'BANK_STATEMENTS': { category: 'FINANCIAL', itemCodes: ['FIN_002'] },

  // Tenant
  'LEASE': { category: 'TENANT', itemCodes: ['TENANT_001'] },
  'ESTOPPEL_CERTIFICATE': { category: 'TENANT', itemCodes: ['TENANT_008', 'TENANT_009'] },
  'SNDA': { category: 'TENANT', itemCodes: ['TENANT_011', 'TENANT_012'] },

  // Zoning
  'ZONING_LETTER': { category: 'ZONING', itemCodes: ['ZONE_001'] },
  'CERTIFICATE_OF_OCCUPANCY': { category: 'ZONING', itemCodes: ['ZONE_004'] },

  // Insurance
  'INSURANCE_POLICY': { category: 'INSURANCE', itemCodes: ['INS_001'] },
  'INSURANCE_DEC_PAGE': { category: 'INSURANCE', itemCodes: ['INS_001'] },
  'FLOOD_CERTIFICATE': { category: 'INSURANCE', itemCodes: ['INS_005'] },

  // Financing
  'LOAN_APPLICATION': { category: 'FINANCING', itemCodes: ['LOAN_001'] },
  'APPRAISAL': { category: 'FINANCING', itemCodes: ['LOAN_003', 'LOAN_004'] },
  'LOAN_COMMITMENT': { category: 'FINANCING', itemCodes: ['LOAN_005'] },
  'LOAN_DOCUMENTS': { category: 'FINANCING', itemCodes: ['LOAN_008'] },

  // Closing
  'DEED': { category: 'CLOSING', itemCodes: ['CLOSE_001'] },
  'SETTLEMENT_STATEMENT': { category: 'CLOSING', itemCodes: ['CLOSE_012'] },
  'FIRPTA': { category: 'CLOSING', itemCodes: ['CLOSE_005'] },
};

/**
 * Match a document to DD checklist items based on document type and keywords
 *
 * @param {string} dealId - Deal ID
 * @param {string} documentId - Document ID
 * @param {Object} documentMetadata - Document metadata (type, filename, extractedData)
 * @returns {Array} Ranked matches with confidence scores
 */
export async function matchDocumentToItems(dealId, documentId, documentMetadata) {
  const log = createLogger('DD-MATCH');
  const prisma = getPrisma();

  log.info('Matching document to DD items', {
    dealId,
    documentId,
    documentType: documentMetadata.documentType,
    filename: documentMetadata.filename
  });

  try {
    // Get deal's DD checklist items
    const checklist = await prisma.dDChecklist.findUnique({
      where: { dealId },
      include: {
        items: {
          where: { status: { not: ITEM_STATUS.COMPLETE } },
          orderBy: [{ priority: 'asc' }, { dueDate: 'asc' }]
        }
      }
    });

    if (!checklist) {
      log.warn('No DD checklist found for deal', { dealId });
      return [];
    }

    const matches = [];
    const { documentType, filename, extractedData } = documentMetadata;

    // Strategy 1: Direct document type mapping
    if (documentType && DOCUMENT_TYPE_MAPPING[documentType]) {
      const mapping = DOCUMENT_TYPE_MAPPING[documentType];
      for (const itemCode of mapping.itemCodes) {
        const item = checklist.items.find(i => i.code === itemCode);
        if (item) {
          matches.push({
            item,
            confidence: 0.95,
            matchReason: `Document type ${documentType} matches item ${itemCode}`,
            matchMethod: 'DOCUMENT_TYPE'
          });
        }
      }
    }

    // Strategy 2: Filename keyword matching
    if (filename) {
      const filenameLower = filename.toLowerCase();
      for (const item of checklist.items) {
        // Skip if already matched
        if (matches.some(m => m.item.id === item.id)) continue;

        const titleWords = item.title.toLowerCase().split(' ');
        const matchingWords = titleWords.filter(word =>
          word.length > 3 && filenameLower.includes(word)
        );

        if (matchingWords.length >= 2) {
          matches.push({
            item,
            confidence: 0.7 + (matchingWords.length * 0.05),
            matchReason: `Filename contains keywords: ${matchingWords.join(', ')}`,
            matchMethod: 'FILENAME'
          });
        }
      }
    }

    // Strategy 3: Category matching from document type prefix
    if (documentType) {
      const typePrefix = documentType.split('_')[0];
      const categoryMapping = {
        'TITLE': 'TITLE',
        'PHASE': 'ENVIRONMENTAL',
        'ENV': 'ENVIRONMENTAL',
        'PCA': 'PROPERTY',
        'PROPERTY': 'PROPERTY',
        'T12': 'FINANCIAL',
        'RENT': 'FINANCIAL',
        'FIN': 'FINANCIAL',
        'LEASE': 'TENANT',
        'ESTOPPEL': 'TENANT',
        'ZONE': 'ZONING',
        'INSURANCE': 'INSURANCE',
        'LOAN': 'FINANCING',
        'DEED': 'CLOSING',
        'SETTLEMENT': 'CLOSING',
      };

      const categoryCode = categoryMapping[typePrefix];
      if (categoryCode) {
        for (const item of checklist.items) {
          if (item.categoryCode === categoryCode && !matches.some(m => m.item.id === item.id)) {
            matches.push({
              item,
              confidence: 0.5,
              matchReason: `Document category ${categoryCode} matches item category`,
              matchMethod: 'CATEGORY'
            });
          }
        }
      }
    }

    // Sort by confidence (highest first) and limit
    const sortedMatches = matches
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5);

    log.info('Document matching complete', {
      dealId,
      documentId,
      matchCount: sortedMatches.length,
      topMatch: sortedMatches[0]?.item.code,
      topConfidence: sortedMatches[0]?.confidence
    });

    return sortedMatches;

  } catch (error) {
    log.error('Failed to match document', { dealId, documentId, error: error.message });
    throw error;
  }
}

/**
 * Auto-process uploaded document for DD workflow
 * Creates pending approval for user review
 *
 * @param {string} dealId - Deal ID
 * @param {string} documentId - Document ID
 * @param {Object} options - Processing options
 * @returns {Object} Approval record or null
 */
export async function autoProcessDocument(dealId, documentId, options = {}) {
  const log = createLogger('DD-AUTO');
  const prisma = getPrisma();

  log.info('Starting auto-process', {
    dealId,
    documentId,
    source: options.source,
    uploadedBy: options.uploadedBy
  });

  try {
    // Get checklist
    const checklist = await prisma.dDChecklist.findUnique({
      where: { dealId }
    });

    if (!checklist) {
      log.warn('No DD checklist for deal', { dealId });
      return null;
    }

    // Match document to items
    const matches = await matchDocumentToItems(dealId, documentId, {
      documentType: options.documentType,
      filename: options.filename,
      extractedData: options.extractedData
    });

    log.debug('Matches found for auto-process', {
      dealId,
      documentId,
      matchCount: matches.length
    });

    // Create pending approval
    const approval = await prisma.dDDocumentApproval.create({
      data: {
        dealId,
        documentId,
        checklistId: checklist.id,
        suggestedItemId: matches[0]?.item.id || null,
        suggestedItemCode: matches[0]?.item.code || null,
        matchConfidence: matches[0]?.confidence || null,
        alternativeMatches: matches.length > 1
          ? JSON.stringify(matches.slice(1, 5).map(m => ({
              itemId: m.item.id,
              itemCode: m.item.code,
              confidence: m.confidence,
              reason: m.matchReason
            })))
          : null,
        extractedData: options.extractedData ? JSON.stringify(options.extractedData) : null,
        status: 'PENDING'
      }
    });

    log.info('Created pending approval', {
      approvalId: approval.id,
      documentId,
      suggestedItem: approval.suggestedItemCode,
      confidence: approval.matchConfidence
    });

    return approval;

  } catch (error) {
    log.error('Failed to auto-process document', { dealId, documentId, error: error.message });
    throw error;
  }
}

/**
 * Approve document match and cross off DD item
 *
 * @param {string} approvalId - Approval record ID
 * @param {string} userId - User approving
 * @param {Object} options - Options (itemId to override, syncToModel)
 * @returns {Object} Result
 */
export async function approveDocumentMatch(approvalId, userId, options = {}) {
  const log = createLogger('DD-APPROVE');
  const prisma = getPrisma();

  const { itemId, userName, syncToModel = false } = options;

  log.info('Approving document match', {
    approvalId,
    userId,
    overrideItemId: itemId,
    syncToModel
  });

  try {
    // Get approval record
    const approval = await prisma.dDDocumentApproval.findUnique({
      where: { id: approvalId }
    });

    if (!approval) {
      throw new Error('Approval not found');
    }

    if (approval.status !== 'PENDING') {
      throw new Error(`Approval already ${approval.status}`);
    }

    const resolvedItemId = itemId || approval.suggestedItemId;

    if (!resolvedItemId) {
      throw new Error('No item to approve - must specify itemId');
    }

    // Update approval status
    const updatedApproval = await prisma.dDDocumentApproval.update({
      where: { id: approvalId },
      data: {
        status: 'APPROVED',
        resolvedItemId,
        resolvedBy: userId,
        resolvedByName: userName || userId,
        resolvedAt: new Date()
      }
    });

    log.debug('Approval updated', { approvalId, resolvedItemId });

    // Mark DD item as complete
    const ddItem = await prisma.dDItem.findUnique({ where: { id: resolvedItemId } });
    if (ddItem) {
      await updateItemStatus(resolvedItemId, ITEM_STATUS.COMPLETE, userId, userName, `Document verified: ${approval.documentId}`);

      // Link document to item
      await linkDocument(resolvedItemId, approval.documentId, userId);

      log.info('DD item marked complete via document approval', {
        itemId: resolvedItemId,
        itemCode: ddItem.code,
        documentId: approval.documentId
      });
    }

    // Sync extracted data to model if requested
    let syncResult = null;
    if (syncToModel && approval.extractedData) {
      syncResult = await syncToUnderwritingModel(
        approval.dealId,
        JSON.parse(approval.extractedData),
        { source: 'DD_DOCUMENT', documentId: approval.documentId }
      );

      await prisma.dDDocumentApproval.update({
        where: { id: approvalId },
        data: {
          syncedToModel: true,
          syncedFields: syncResult.updatedFields ? JSON.stringify(syncResult.updatedFields) : null
        }
      });

      log.info('Data synced to model', {
        approvalId,
        fieldsUpdated: syncResult.updatedFields?.length || 0
      });
    }

    return {
      success: true,
      approval: updatedApproval,
      syncResult
    };

  } catch (error) {
    log.error('Failed to approve document match', { approvalId, error: error.message });
    throw error;
  }
}

/**
 * Reject document match
 *
 * @param {string} approvalId - Approval record ID
 * @param {string} userId - User rejecting
 * @param {string} reason - Rejection reason
 * @returns {Object} Updated approval
 */
export async function rejectDocumentMatch(approvalId, userId, reason) {
  const log = createLogger('DD-APPROVE');
  const prisma = getPrisma();

  log.info('Rejecting document match', { approvalId, userId, reason });

  try {
    const approval = await prisma.dDDocumentApproval.findUnique({
      where: { id: approvalId }
    });

    if (!approval) {
      throw new Error('Approval not found');
    }

    if (approval.status !== 'PENDING') {
      throw new Error(`Approval already ${approval.status}`);
    }

    const updatedApproval = await prisma.dDDocumentApproval.update({
      where: { id: approvalId },
      data: {
        status: 'REJECTED',
        resolvedBy: userId,
        resolvedAt: new Date(),
        rejectionReason: reason
      }
    });

    log.info('Document match rejected', { approvalId, reason });

    return updatedApproval;

  } catch (error) {
    log.error('Failed to reject document match', { approvalId, error: error.message });
    throw error;
  }
}

/**
 * Get pending document approvals for a deal
 *
 * @param {string} dealId - Deal ID
 * @returns {Array} Pending approvals
 */
export async function getPendingApprovals(dealId) {
  const log = createLogger('DD-APPROVE');
  const prisma = getPrisma();

  log.debug('Getting pending approvals', { dealId });

  const approvals = await prisma.dDDocumentApproval.findMany({
    where: {
      dealId,
      status: 'PENDING'
    },
    orderBy: { createdAt: 'desc' }
  });

  return approvals;
}

/**
 * Sync extracted data to UnderwritingModel (living data)
 *
 * @param {string} dealId - Deal ID
 * @param {Object} extractedData - Extracted field values
 * @param {Object} options - Options
 * @returns {Object} Sync result with updated fields
 */
export async function syncToUnderwritingModel(dealId, extractedData, options = {}) {
  const log = createLogger('DD-SYNC');
  const prisma = getPrisma();

  log.info('Syncing to underwriting model', {
    dealId,
    source: options.source,
    documentId: options.documentId,
    fieldCount: Object.keys(extractedData).length
  });

  try {
    // Get deal's underwriting model
    const model = await prisma.underwritingModel.findFirst({
      where: { dealId },
      orderBy: { createdAt: 'desc' }
    });

    if (!model) {
      log.warn('No underwriting model found', { dealId });
      return { success: false, reason: 'NO_MODEL', updatedFields: [] };
    }

    // Map extracted data to model fields
    const fieldMapping = {
      // From T12 / Operating Statement
      'grossPotentialRent': 'grossPotentialRent',
      'effectiveGrossIncome': 'effectiveGrossIncome',
      'totalOperatingExpenses': 'operatingExpenses',
      'netOperatingIncome': 'noi',
      'managementFee': 'managementFee',
      'realEstateTaxes': 'realEstateTaxes',
      'insurance': 'insurance',
      'utilities': 'utilities',
      'repairsAndMaintenance': 'repairsAndMaintenance',

      // From Rent Roll
      'totalUnits': 'units',
      'occupancyRate': 'occupancy',
      'averageRent': 'inPlaceRent',
      'monthlyRent': 'monthlyRent',
      'annualRent': 'annualRent',

      // From Loan Terms
      'loanAmount': 'loanAmount',
      'interestRate': 'interestRate',
      'loanTerm': 'loanTermMonths',
      'amortization': 'amortizationYears',
      'ltv': 'ltv',
      'dscr': 'dscr',

      // From Appraisal
      'appraised Value': 'appraisedValue',
      'capRate': 'capRate',
      'pricePerUnit': 'pricePerUnit',
      'pricePerSF': 'pricePerSF',
    };

    const updates = {};
    const updatedFields = [];

    for (const [extractedField, modelField] of Object.entries(fieldMapping)) {
      if (extractedData[extractedField] !== undefined && extractedData[extractedField] !== null) {
        updates[modelField] = extractedData[extractedField];
        updatedFields.push(modelField);
      }
    }

    if (updatedFields.length > 0) {
      await prisma.underwritingModel.update({
        where: { id: model.id },
        data: updates
      });

      log.info('Updated underwriting model', {
        modelId: model.id,
        fields: updatedFields,
        source: options.source
      });
    } else {
      log.debug('No matching fields to update', { dealId });
    }

    return {
      success: true,
      modelId: model.id,
      updatedFields
    };

  } catch (error) {
    log.error('Failed to sync to underwriting model', { dealId, error: error.message });
    throw error;
  }
}

// ==================== AI FEATURES ====================

/**
 * AI: Suggest next priority items to work on
 *
 * @param {string} dealId - Deal ID
 * @param {number} limit - Max items to return
 * @returns {Object} Suggestions with reasoning
 */
export async function suggestNextItems(dealId, limit = 5) {
  const log = createLogger('DD-AI');
  const prisma = getPrisma();

  log.info('Generating next item suggestions', { dealId, limit });

  try {
    const checklist = await prisma.dDChecklist.findUnique({
      where: { dealId },
      include: {
        items: {
          where: {
            status: { notIn: [ITEM_STATUS.COMPLETE, ITEM_STATUS.NA] }
          }
        }
      }
    });

    if (!checklist) {
      return { success: false, reason: 'NO_CHECKLIST', suggestions: [] };
    }

    const now = new Date();
    const scoredItems = checklist.items.map(item => {
      let score = 0;
      const reasons = [];

      // Priority scoring
      switch (item.priority) {
        case ITEM_PRIORITY.CRITICAL:
          score += 100;
          reasons.push('Critical priority');
          break;
        case ITEM_PRIORITY.HIGH:
          score += 75;
          reasons.push('High priority');
          break;
        case ITEM_PRIORITY.MEDIUM:
          score += 50;
          break;
        case ITEM_PRIORITY.LOW:
          score += 25;
          break;
      }

      // Due date scoring
      if (item.dueDate) {
        const daysUntilDue = Math.ceil((item.dueDate - now) / (1000 * 60 * 60 * 24));
        if (daysUntilDue < 0) {
          score += 50;
          reasons.push(`Overdue by ${Math.abs(daysUntilDue)} days`);
        } else if (daysUntilDue <= 3) {
          score += 40;
          reasons.push(`Due in ${daysUntilDue} days`);
        } else if (daysUntilDue <= 7) {
          score += 25;
          reasons.push(`Due in ${daysUntilDue} days`);
        }
      }

      // Status scoring - in progress items get slight boost
      if (item.status === ITEM_STATUS.IN_PROGRESS) {
        score += 15;
        reasons.push('Already in progress');
      } else if (item.status === ITEM_STATUS.BLOCKED) {
        score -= 20; // Deprioritize blocked items
        reasons.push('Blocked - may need resolution');
      }

      // Document required but not linked
      if (item.requiresDocument && !item.linkedDocumentIds) {
        score += 10;
        reasons.push('Needs document');
      }

      return { item, score, reasons };
    });

    // Sort by score and take top N
    const suggestions = scoredItems
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(s => ({
        itemId: s.item.id,
        code: s.item.code,
        title: s.item.title,
        priority: s.item.priority,
        status: s.item.status,
        dueDate: s.item.dueDate,
        score: s.score,
        reasons: s.reasons
      }));

    log.info('Generated suggestions', {
      dealId,
      suggestionCount: suggestions.length,
      topItem: suggestions[0]?.code
    });

    return {
      success: true,
      suggestions
    };

  } catch (error) {
    log.error('Failed to generate suggestions', { dealId, error: error.message });
    throw error;
  }
}

/**
 * AI: Detect DD risks and blockers
 *
 * @param {string} dealId - Deal ID
 * @returns {Object} Risk assessment
 */
export async function detectRisks(dealId) {
  const log = createLogger('DD-AI');
  const prisma = getPrisma();

  log.info('Detecting DD risks', { dealId });

  try {
    const checklist = await prisma.dDChecklist.findUnique({
      where: { dealId },
      include: { items: true }
    });

    if (!checklist) {
      return { success: false, reason: 'NO_CHECKLIST', risks: [] };
    }

    const now = new Date();
    const risks = [];

    // Check for overdue items
    const overdueItems = checklist.items.filter(item =>
      item.dueDate &&
      item.dueDate < now &&
      item.status !== ITEM_STATUS.COMPLETE &&
      item.status !== ITEM_STATUS.NA
    );

    if (overdueItems.length > 0) {
      risks.push({
        type: 'OVERDUE_ITEMS',
        severity: 'HIGH',
        message: `${overdueItems.length} DD items are overdue`,
        items: overdueItems.slice(0, 5).map(i => ({
          code: i.code,
          title: i.title,
          dueDate: i.dueDate,
          daysOverdue: Math.ceil((now - i.dueDate) / (1000 * 60 * 60 * 24))
        })),
        recommendation: 'Prioritize overdue items or request deadline extensions'
      });
    }

    // Check for approaching deadlines (within 3 days)
    const approachingItems = checklist.items.filter(item => {
      if (!item.dueDate || item.status === ITEM_STATUS.COMPLETE || item.status === ITEM_STATUS.NA) return false;
      const daysUntilDue = Math.ceil((item.dueDate - now) / (1000 * 60 * 60 * 24));
      return daysUntilDue > 0 && daysUntilDue <= 3;
    });

    if (approachingItems.length > 0) {
      risks.push({
        type: 'APPROACHING_DEADLINES',
        severity: 'MEDIUM',
        message: `${approachingItems.length} DD items due within 3 days`,
        items: approachingItems.slice(0, 5).map(i => ({
          code: i.code,
          title: i.title,
          dueDate: i.dueDate
        })),
        recommendation: 'Focus on completing these items before deadline'
      });
    }

    // Check for blocked items
    const blockedItems = checklist.items.filter(i => i.status === ITEM_STATUS.BLOCKED);
    if (blockedItems.length > 0) {
      risks.push({
        type: 'BLOCKED_ITEMS',
        severity: 'MEDIUM',
        message: `${blockedItems.length} DD items are blocked`,
        items: blockedItems.slice(0, 5).map(i => ({
          code: i.code,
          title: i.title,
          blockerReason: i.blockerReason
        })),
        recommendation: 'Resolve blockers to unblock workflow'
      });
    }

    // Check for incomplete critical items
    const incompleteCritical = checklist.items.filter(i =>
      i.priority === ITEM_PRIORITY.CRITICAL &&
      i.status !== ITEM_STATUS.COMPLETE &&
      i.status !== ITEM_STATUS.NA
    );

    if (incompleteCritical.length > 0) {
      risks.push({
        type: 'INCOMPLETE_CRITICAL',
        severity: 'HIGH',
        message: `${incompleteCritical.length} critical DD items not complete`,
        items: incompleteCritical.map(i => ({
          code: i.code,
          title: i.title,
          status: i.status
        })),
        recommendation: 'Complete all critical items before transitioning to next stage'
      });
    }

    // Check completion percentage
    const totalItems = checklist.items.length;
    const completedItems = checklist.items.filter(i =>
      i.status === ITEM_STATUS.COMPLETE || i.status === ITEM_STATUS.NA
    ).length;
    const completionPct = totalItems > 0 ? (completedItems / totalItems) * 100 : 0;

    if (completionPct < 50) {
      risks.push({
        type: 'LOW_COMPLETION',
        severity: 'MEDIUM',
        message: `Only ${Math.round(completionPct)}% of DD items complete`,
        recommendation: 'Accelerate DD progress to meet timeline'
      });
    }

    log.info('Risk detection complete', {
      dealId,
      riskCount: risks.length,
      highRisks: risks.filter(r => r.severity === 'HIGH').length
    });

    return {
      success: true,
      summary: {
        totalItems,
        completedItems,
        completionPct: Math.round(completionPct),
        overdueCount: overdueItems.length,
        blockedCount: blockedItems.length
      },
      risks
    };

  } catch (error) {
    log.error('Failed to detect risks', { dealId, error: error.message });
    throw error;
  }
}

/**
 * AI: Generate DD status summary for stakeholders
 *
 * @param {string} dealId - Deal ID
 * @param {string} audience - Target audience (internal, ic_memo, lender)
 * @returns {Object} Generated summary
 */
export async function generateStatusSummary(dealId, audience = 'internal') {
  const log = createLogger('DD-AI');
  const prisma = getPrisma();

  log.info('Generating status summary', { dealId, audience });

  try {
    const checklist = await prisma.dDChecklist.findUnique({
      where: { dealId },
      include: { items: true }
    });

    if (!checklist) {
      return { success: false, reason: 'NO_CHECKLIST', summary: null };
    }

    // Calculate stats by category
    const categoryStats = {};
    for (const item of checklist.items) {
      if (!categoryStats[item.categoryCode]) {
        categoryStats[item.categoryCode] = {
          total: 0,
          completed: 0,
          inProgress: 0,
          blocked: 0,
          critical: { total: 0, completed: 0 }
        };
      }
      categoryStats[item.categoryCode].total++;
      if (item.status === ITEM_STATUS.COMPLETE || item.status === ITEM_STATUS.NA) {
        categoryStats[item.categoryCode].completed++;
      } else if (item.status === ITEM_STATUS.IN_PROGRESS) {
        categoryStats[item.categoryCode].inProgress++;
      } else if (item.status === ITEM_STATUS.BLOCKED) {
        categoryStats[item.categoryCode].blocked++;
      }
      if (item.priority === ITEM_PRIORITY.CRITICAL) {
        categoryStats[item.categoryCode].critical.total++;
        if (item.status === ITEM_STATUS.COMPLETE || item.status === ITEM_STATUS.NA) {
          categoryStats[item.categoryCode].critical.completed++;
        }
      }
    }

    // Overall stats
    const totalItems = checklist.items.length;
    const completedItems = checklist.items.filter(i =>
      i.status === ITEM_STATUS.COMPLETE || i.status === ITEM_STATUS.NA
    ).length;
    const completionPct = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;

    // Generate narrative summary based on audience
    let narrative = '';
    if (audience === 'internal') {
      narrative = `DD Progress: ${completionPct}% complete (${completedItems}/${totalItems} items). `;
      const blockedCount = checklist.items.filter(i => i.status === ITEM_STATUS.BLOCKED).length;
      if (blockedCount > 0) {
        narrative += `${blockedCount} items blocked. `;
      }
      const overdueCount = checklist.items.filter(i =>
        i.dueDate && i.dueDate < new Date() &&
        i.status !== ITEM_STATUS.COMPLETE && i.status !== ITEM_STATUS.NA
      ).length;
      if (overdueCount > 0) {
        narrative += `${overdueCount} items overdue.`;
      }
    } else if (audience === 'ic_memo') {
      narrative = `Due diligence is ${completionPct}% complete. `;
      const criticalComplete = checklist.items.filter(i =>
        i.priority === ITEM_PRIORITY.CRITICAL &&
        (i.status === ITEM_STATUS.COMPLETE || i.status === ITEM_STATUS.NA)
      ).length;
      const criticalTotal = checklist.items.filter(i => i.priority === ITEM_PRIORITY.CRITICAL).length;
      narrative += `${criticalComplete}/${criticalTotal} critical items complete.`;
    } else if (audience === 'lender') {
      narrative = `Third-party reports and DD items are ${completionPct}% complete. `;
      const envComplete = categoryStats['ENVIRONMENTAL']?.completed || 0;
      const envTotal = categoryStats['ENVIRONMENTAL']?.total || 0;
      const propComplete = categoryStats['PROPERTY']?.completed || 0;
      const propTotal = categoryStats['PROPERTY']?.total || 0;
      narrative += `Environmental: ${envComplete}/${envTotal}. Property Condition: ${propComplete}/${propTotal}.`;
    }

    log.info('Generated status summary', { dealId, audience, completionPct });

    return {
      success: true,
      summary: {
        completionPct,
        totalItems,
        completedItems,
        narrative,
        categoryStats,
        generatedAt: new Date().toISOString(),
        audience
      }
    };

  } catch (error) {
    log.error('Failed to generate summary', { dealId, error: error.message });
    throw error;
  }
}

// ==================== EXPORTS ====================

export {
  STATE_ORDER,
  ITEM_STATUS,
  ITEM_PRIORITY,
  createLogger,
  DOCUMENT_TYPE_MAPPING
};
