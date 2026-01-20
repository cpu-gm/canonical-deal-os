/**
 * Seller Portal Routes
 *
 * API endpoints for seller-side deal management.
 * Sellers can view their deals, approve OMs, configure buyer access, and manage listing type.
 *
 * Routes:
 * - GET /api/seller/deals - List deals where user is seller
 * - GET /api/seller/deal/:dealDraftId - Get seller view of deal
 * - PUT /api/seller/deal/:dealDraftId/settings - Update seller settings
 * - PUT /api/seller/deal/:dealDraftId/listing-type - Set listing type (PUBLIC/PRIVATE)
 * - POST /api/seller/deal/:dealDraftId/delegate-broker - Delegate OM approval to broker
 * - GET /api/seller/deal/:dealDraftId/pending-approvals - Get pending items for approval
 *
 * Phase 2: Deal Intake Platform - OM Generation + Seller Flow
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Debug logging helper
const DEBUG = process.env.DEBUG_SELLER_ROUTES === 'true' || process.env.NODE_ENV !== 'production';

function log(level, message, data = {}) {
  const timestamp = new Date().toISOString();
  const prefix = `[SellerPortal][${level.toUpperCase()}]`;

  if (level === 'error') {
    console.error(`${timestamp} ${prefix} ${message}`, data);
  } else if (level === 'warn') {
    console.warn(`${timestamp} ${prefix} ${message}`, data);
  } else if (DEBUG || level === 'info') {
    console.log(`${timestamp} ${prefix} ${message}`, data);
  }
}

// Valid listing types
const LISTING_TYPES = {
  PUBLIC: 'PUBLIC',   // Platform auto-matches buyers based on criteria
  PRIVATE: 'PRIVATE'  // Broker manually selects recipients
};

/**
 * Dispatch seller portal routes
 */
export function dispatchSellerRoutes(req, res, segments, readJsonBody, authUser) {
  const method = req.method;

  log('debug', 'Seller route dispatch', {
    method,
    segments,
    userId: authUser.id
  });

  // GET /api/seller/deals - List seller's deals
  if (method === 'GET' && segments[2] === 'deals' && !segments[3]) {
    return handleListSellerDeals(req, res, authUser);
  }

  // GET /api/seller/deal/:dealDraftId - Get deal details (seller view)
  if (method === 'GET' && segments[2] === 'deal' && segments[3] && !segments[4]) {
    return handleGetSellerDeal(req, res, segments[3], authUser);
  }

  // PUT /api/seller/deal/:dealDraftId/settings - Update seller settings
  if (method === 'PUT' && segments[2] === 'deal' && segments[4] === 'settings') {
    return handleUpdateSellerSettings(req, res, segments[3], readJsonBody, authUser);
  }

  // PUT /api/seller/deal/:dealDraftId/listing-type - Set listing type
  if (method === 'PUT' && segments[2] === 'deal' && segments[4] === 'listing-type') {
    return handleSetListingType(req, res, segments[3], readJsonBody, authUser);
  }

  // POST /api/seller/deal/:dealDraftId/delegate-broker - Delegate OM approval
  if (method === 'POST' && segments[2] === 'deal' && segments[4] === 'delegate-broker') {
    return handleDelegateBroker(req, res, segments[3], readJsonBody, authUser);
  }

  // GET /api/seller/deal/:dealDraftId/pending-approvals - Get pending items
  if (method === 'GET' && segments[2] === 'deal' && segments[4] === 'pending-approvals') {
    return handleGetPendingApprovals(req, res, segments[3], authUser);
  }

  // GET /api/seller/deal/:dealDraftId/activity - Get deal activity log
  if (method === 'GET' && segments[2] === 'deal' && segments[4] === 'activity') {
    return handleGetDealActivity(req, res, segments[3], authUser);
  }

  log('warn', 'Route not found', { method, segments });
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Seller endpoint not found' }));
}

/**
 * List all deals where the user is a seller
 */
async function handleListSellerDeals(req, res, authUser) {
  log('info', 'List seller deals', { userId: authUser.id });

  try {
    // Find all DealDraftSeller records for this user
    const sellerDeals = await prisma.dealDraftSeller.findMany({
      where: {
        userId: authUser.id
      },
      include: {
        dealDraft: {
          include: {
            brokers: { where: { isPrimaryContact: true } },
            omVersions: {
              orderBy: { versionNumber: 'desc' },
              take: 1
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const deals = sellerDeals.map(sd => ({
      id: sd.dealDraft.id,
      status: sd.dealDraft.status,
      propertyName: sd.dealDraft.propertyName,
      propertyAddress: sd.dealDraft.propertyAddress,
      assetType: sd.dealDraft.assetType,
      askingPrice: sd.dealDraft.askingPrice,
      listingType: sd.dealDraft.listingType,
      primaryBroker: sd.dealDraft.brokers[0] ? {
        name: sd.dealDraft.brokers[0].name,
        firmName: sd.dealDraft.brokers[0].firmName,
        email: sd.dealDraft.brokers[0].email
      } : null,
      latestOMStatus: sd.dealDraft.omVersions[0]?.status || null,
      sellerSettings: {
        hasDirectAccess: sd.hasDirectAccess,
        requiresOMApproval: sd.requiresOMApproval,
        requiresBuyerApproval: sd.requiresBuyerApproval
      },
      createdAt: sd.dealDraft.createdAt,
      updatedAt: sd.dealDraft.updatedAt
    }));

    log('info', 'Seller deals retrieved', { count: deals.length });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ deals }));
  } catch (error) {
    log('error', 'List seller deals failed', { error: error.message });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

/**
 * Get deal details from seller's perspective
 */
async function handleGetSellerDeal(req, res, dealDraftId, authUser) {
  log('info', 'Get seller deal', { dealDraftId, userId: authUser.id });

  try {
    // Verify user is the seller
    const sellerRecord = await prisma.dealDraftSeller.findFirst({
      where: {
        dealDraftId,
        userId: authUser.id
      }
    });

    if (!sellerRecord) {
      log('warn', 'User is not the seller for this deal', { dealDraftId, userId: authUser.id });
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Not authorized as seller for this deal' }));
    }

    // Get full deal details
    const dealDraft = await prisma.dealDraft.findUnique({
      where: { id: dealDraftId },
      include: {
        brokers: true,
        seller: true,
        documents: {
          orderBy: { createdAt: 'desc' }
        },
        claims: {
          where: { status: { in: ['BROKER_CONFIRMED', 'SELLER_CONFIRMED'] } },
          orderBy: { createdAt: 'desc' }
        },
        omVersions: {
          orderBy: { versionNumber: 'desc' }
        }
      }
    });

    if (!dealDraft) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Deal not found' }));
    }

    // Format response with seller-relevant information
    const response = {
      id: dealDraft.id,
      status: dealDraft.status,
      ingestSource: dealDraft.ingestSource,
      propertyName: dealDraft.propertyName,
      propertyAddress: dealDraft.propertyAddress,
      assetType: dealDraft.assetType,
      askingPrice: dealDraft.askingPrice,
      unitCount: dealDraft.unitCount,
      totalSF: dealDraft.totalSF,
      listingType: dealDraft.listingType,

      // Broker info
      brokers: dealDraft.brokers.map(b => ({
        id: b.id,
        name: b.name,
        firmName: b.firmName,
        email: b.email,
        role: b.role,
        isPrimaryContact: b.isPrimaryContact,
        canApproveOM: b.canApproveOM
      })),

      // Seller settings
      sellerSettings: {
        hasDirectAccess: sellerRecord.hasDirectAccess,
        receiveNotifications: sellerRecord.receiveNotifications,
        requiresOMApproval: sellerRecord.requiresOMApproval,
        requiresBuyerApproval: sellerRecord.requiresBuyerApproval,
        sellerSeesBuyerIdentity: sellerRecord.sellerSeesBuyerIdentity
      },

      // Documents (summary only - seller can see what was uploaded)
      documentCount: dealDraft.documents.length,
      documentsByType: dealDraft.documents.reduce((acc, doc) => {
        const type = doc.classifiedType || 'OTHER';
        acc[type] = (acc[type] || 0) + 1;
        return acc;
      }, {}),

      // Verified claims (key metrics)
      verifiedMetrics: dealDraft.claims
        .filter(c => ['BROKER_CONFIRMED', 'SELLER_CONFIRMED'].includes(c.status))
        .reduce((acc, c) => {
          try {
            acc[c.field] = {
              value: JSON.parse(c.value),
              displayValue: c.displayValue,
              status: c.status
            };
          } catch (e) {
            // ignore parse errors
          }
          return acc;
        }, {}),

      // OM versions
      omVersions: dealDraft.omVersions.map(v => ({
        id: v.id,
        versionNumber: v.versionNumber,
        status: v.status,
        brokerApprovedAt: v.brokerApprovedAt,
        sellerApprovedAt: v.sellerApprovedAt,
        createdAt: v.createdAt
      })),

      // Latest OM awaiting seller approval?
      pendingOMApproval: dealDraft.omVersions.find(v => v.status === 'BROKER_APPROVED') || null,

      createdAt: dealDraft.createdAt,
      updatedAt: dealDraft.updatedAt
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  } catch (error) {
    log('error', 'Get seller deal failed', { dealDraftId, error: error.message });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

/**
 * Update seller settings for a deal
 */
async function handleUpdateSellerSettings(req, res, dealDraftId, readJsonBody, authUser) {
  log('info', 'Update seller settings', { dealDraftId, userId: authUser.id });

  try {
    const body = await readJsonBody();

    // Verify user is the seller
    const sellerRecord = await prisma.dealDraftSeller.findFirst({
      where: {
        dealDraftId,
        userId: authUser.id
      },
      include: {
        dealDraft: true
      }
    });

    if (!sellerRecord) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Not authorized as seller for this deal' }));
    }

    // Update allowed fields
    const updateData = {};
    if (typeof body.receiveNotifications === 'boolean') {
      updateData.receiveNotifications = body.receiveNotifications;
    }
    if (typeof body.requiresBuyerApproval === 'boolean') {
      updateData.requiresBuyerApproval = body.requiresBuyerApproval;
    }
    if (typeof body.sellerSeesBuyerIdentity === 'boolean') {
      updateData.sellerSeesBuyerIdentity = body.sellerSeesBuyerIdentity;
    }

    if (Object.keys(updateData).length === 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'No valid settings to update' }));
    }

    const updated = await prisma.$transaction(async (tx) => {
      const seller = await tx.dealDraftSeller.update({
        where: { id: sellerRecord.id },
        data: updateData
      });

      // Log event
      await tx.dealIntakeEventLog.create({
        data: {
          dealDraftId,
          organizationId: sellerRecord.dealDraft.organizationId,
          eventType: 'SELLER_SETTINGS_UPDATED',
          eventData: JSON.stringify({
            previousSettings: {
              receiveNotifications: sellerRecord.receiveNotifications,
              requiresBuyerApproval: sellerRecord.requiresBuyerApproval,
              sellerSeesBuyerIdentity: sellerRecord.sellerSeesBuyerIdentity
            },
            newSettings: updateData
          }),
          actorId: authUser.id,
          actorName: authUser.name,
          actorRole: 'SELLER'
        }
      });

      return seller;
    });

    log('info', 'Seller settings updated', { dealDraftId, updated: updateData });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      message: 'Settings updated',
      settings: {
        hasDirectAccess: updated.hasDirectAccess,
        receiveNotifications: updated.receiveNotifications,
        requiresOMApproval: updated.requiresOMApproval,
        requiresBuyerApproval: updated.requiresBuyerApproval,
        sellerSeesBuyerIdentity: updated.sellerSeesBuyerIdentity
      }
    }));
  } catch (error) {
    log('error', 'Update seller settings failed', { dealDraftId, error: error.message });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

/**
 * Set listing type (PUBLIC or PRIVATE)
 */
async function handleSetListingType(req, res, dealDraftId, readJsonBody, authUser) {
  log('info', 'Set listing type', { dealDraftId, userId: authUser.id });

  try {
    const body = await readJsonBody();
    const { listingType } = body;

    if (!listingType || !LISTING_TYPES[listingType]) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        error: 'Invalid listing type',
        validTypes: Object.keys(LISTING_TYPES)
      }));
    }

    // Verify user is the seller
    const sellerRecord = await prisma.dealDraftSeller.findFirst({
      where: {
        dealDraftId,
        userId: authUser.id
      },
      include: {
        dealDraft: true
      }
    });

    if (!sellerRecord) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Not authorized as seller for this deal' }));
    }

    // Only allow setting listing type before distribution
    if (sellerRecord.dealDraft.status === 'DISTRIBUTED') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        error: 'Cannot change listing type after distribution has started'
      }));
    }

    const updated = await prisma.$transaction(async (tx) => {
      const deal = await tx.dealDraft.update({
        where: { id: dealDraftId },
        data: { listingType }
      });

      // Log event
      await tx.dealIntakeEventLog.create({
        data: {
          dealDraftId,
          organizationId: sellerRecord.dealDraft.organizationId,
          eventType: 'LISTING_TYPE_SET',
          eventData: JSON.stringify({
            previousType: sellerRecord.dealDraft.listingType,
            newType: listingType
          }),
          actorId: authUser.id,
          actorName: authUser.name,
          actorRole: 'SELLER'
        }
      });

      return deal;
    });

    log('info', 'Listing type set', { dealDraftId, listingType });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      message: `Listing type set to ${listingType}`,
      listingType: updated.listingType,
      description: listingType === 'PUBLIC'
        ? 'Platform will auto-match buyers based on their investment criteria'
        : 'Broker will manually select recipients for distribution'
    }));
  } catch (error) {
    log('error', 'Set listing type failed', { dealDraftId, error: error.message });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

/**
 * Delegate OM approval to a broker
 */
async function handleDelegateBroker(req, res, dealDraftId, readJsonBody, authUser) {
  log('info', 'Delegate broker for OM approval', { dealDraftId, userId: authUser.id });

  try {
    const body = await readJsonBody();
    const { brokerId, canApproveOM } = body;

    if (!brokerId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'brokerId is required' }));
    }

    // Verify user is the seller
    const sellerRecord = await prisma.dealDraftSeller.findFirst({
      where: {
        dealDraftId,
        userId: authUser.id
      },
      include: {
        dealDraft: {
          include: { brokers: true }
        }
      }
    });

    if (!sellerRecord) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Not authorized as seller for this deal' }));
    }

    // Find the broker
    const broker = sellerRecord.dealDraft.brokers.find(b => b.id === brokerId || b.userId === brokerId);
    if (!broker) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Broker not found on this deal' }));
    }

    const updated = await prisma.$transaction(async (tx) => {
      const updatedBroker = await tx.dealDraftBroker.update({
        where: { id: broker.id },
        data: { canApproveOM: canApproveOM !== false } // default to true
      });

      // Log event
      await tx.dealIntakeEventLog.create({
        data: {
          dealDraftId,
          organizationId: sellerRecord.dealDraft.organizationId,
          eventType: canApproveOM !== false ? 'BROKER_DELEGATION_GRANTED' : 'BROKER_DELEGATION_REVOKED',
          eventData: JSON.stringify({
            brokerId: broker.id,
            brokerName: broker.name,
            canApproveOM: canApproveOM !== false
          }),
          actorId: authUser.id,
          actorName: authUser.name,
          actorRole: 'SELLER'
        }
      });

      return updatedBroker;
    });

    log('info', 'Broker delegation updated', {
      dealDraftId,
      brokerId: broker.id,
      canApproveOM: updated.canApproveOM
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      message: updated.canApproveOM
        ? `${broker.name} can now approve the OM on your behalf`
        : `${broker.name} can no longer approve the OM on your behalf`,
      broker: {
        id: broker.id,
        name: broker.name,
        canApproveOM: updated.canApproveOM
      }
    }));
  } catch (error) {
    log('error', 'Delegate broker failed', { dealDraftId, error: error.message });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

/**
 * Get pending items that need seller approval
 */
async function handleGetPendingApprovals(req, res, dealDraftId, authUser) {
  log('debug', 'Get pending approvals', { dealDraftId, userId: authUser.id });

  try {
    // Verify user is the seller
    const sellerRecord = await prisma.dealDraftSeller.findFirst({
      where: {
        dealDraftId,
        userId: authUser.id
      }
    });

    if (!sellerRecord) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Not authorized as seller for this deal' }));
    }

    // Find OM versions awaiting seller approval
    const pendingOMVersions = await prisma.oMVersion.findMany({
      where: {
        dealDraftId,
        status: 'BROKER_APPROVED'
      },
      orderBy: { createdAt: 'desc' }
    });

    // If seller requires buyer approval, find pending buyer authorizations
    let pendingBuyers = [];
    if (sellerRecord.requiresBuyerApproval) {
      // This will be implemented in Phase 3 with buyer responses
      // For now, return empty array
      pendingBuyers = [];
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      pendingOMApprovals: pendingOMVersions.map(v => ({
        id: v.id,
        versionNumber: v.versionNumber,
        brokerApprovedBy: v.brokerApprovedBy,
        brokerApprovedAt: v.brokerApprovedAt,
        createdAt: v.createdAt
      })),
      pendingBuyerAuthorizations: pendingBuyers,
      summary: {
        omApprovalsNeeded: pendingOMVersions.length,
        buyerAuthorizationsNeeded: pendingBuyers.length
      }
    }));
  } catch (error) {
    log('error', 'Get pending approvals failed', { dealDraftId, error: error.message });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

/**
 * Get deal activity log (seller view)
 */
async function handleGetDealActivity(req, res, dealDraftId, authUser) {
  log('debug', 'Get deal activity', { dealDraftId, userId: authUser.id });

  try {
    // Verify user is the seller
    const sellerRecord = await prisma.dealDraftSeller.findFirst({
      where: {
        dealDraftId,
        userId: authUser.id
      }
    });

    if (!sellerRecord) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Not authorized as seller for this deal' }));
    }

    // Get recent activity events
    const events = await prisma.dealIntakeEventLog.findMany({
      where: { dealDraftId },
      orderBy: { createdAt: 'desc' },
      take: 50
    });

    // Format events for seller view (may hide some details)
    const formattedEvents = events.map(e => ({
      id: e.id,
      type: e.eventType,
      actor: {
        name: e.actorName,
        role: e.actorRole
      },
      timestamp: e.createdAt,
      summary: getEventSummary(e)
    }));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ events: formattedEvents }));
  } catch (error) {
    log('error', 'Get deal activity failed', { dealDraftId, error: error.message });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

/**
 * Generate human-readable event summary
 */
function getEventSummary(event) {
  const summaries = {
    'DRAFT_CREATED': 'Deal draft was created',
    'DOCUMENT_UPLOADED': 'Document was uploaded',
    'CLAIM_EXTRACTED': 'Data was extracted from document',
    'CONFLICT_RESOLVED': 'Data conflict was resolved',
    'OM_DRAFT_GENERATED': 'OM draft was generated',
    'OM_BROKER_APPROVED': 'Broker approved the OM',
    'OM_SELLER_APPROVED': 'Seller approved the OM for marketing',
    'OM_CHANGE_REQUESTED': 'Changes were requested for the OM',
    'SELLER_SETTINGS_UPDATED': 'Seller settings were updated',
    'LISTING_TYPE_SET': 'Listing type was configured',
    'BROKER_DELEGATION_GRANTED': 'Broker was authorized for OM approval',
    'BROKER_DELEGATION_REVOKED': 'Broker authorization was revoked'
  };

  return summaries[event.eventType] || `${event.eventType} occurred`;
}

export { LISTING_TYPES };
