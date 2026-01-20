/**
 * OM (Offering Memorandum) Management Routes
 *
 * API endpoints for generating, editing, and approving OMs.
 *
 * Routes:
 * - POST /api/om/draft/:dealDraftId/generate - Generate OM draft
 * - GET /api/om/draft/:dealDraftId/latest - Get latest OM version
 * - GET /api/om/draft/:dealDraftId/versions - List all OM versions
 * - GET /api/om/version/:omVersionId - Get specific OM version
 * - PUT /api/om/version/:omVersionId/section/:sectionId - Update section
 * - POST /api/om/version/:omVersionId/broker-approve - Broker approval
 * - POST /api/om/version/:omVersionId/seller-approve - Seller approval
 * - POST /api/om/version/:omVersionId/request-changes - Request changes
 *
 * Phase 2: Deal Intake Platform - OM Generation + Seller Flow
 */

import { PrismaClient } from '@prisma/client';
import {
  omDrafterService,
  OM_SECTIONS,
  OM_STATUSES
} from '../services/om-drafter.js';

const prisma = new PrismaClient();

// Debug logging helper
const DEBUG = process.env.DEBUG_OM_ROUTES === 'true' || process.env.NODE_ENV !== 'production';

function log(level, message, data = {}) {
  const timestamp = new Date().toISOString();
  const prefix = `[OMRoutes][${level.toUpperCase()}]`;

  if (level === 'error') {
    console.error(`${timestamp} ${prefix} ${message}`, data);
  } else if (level === 'warn') {
    console.warn(`${timestamp} ${prefix} ${message}`, data);
  } else if (DEBUG || level === 'info') {
    console.log(`${timestamp} ${prefix} ${message}`, data);
  }
}

/**
 * Dispatch OM management routes
 */
export function dispatchOMRoutes(req, res, segments, readJsonBody, authUser) {
  const method = req.method;

  log('debug', 'OM route dispatch', {
    method,
    segments,
    userId: authUser.id
  });

  // POST /api/om/draft/:dealDraftId/generate
  if (method === 'POST' && segments[2] === 'draft' && segments[4] === 'generate') {
    return handleGenerateOM(req, res, segments[3], readJsonBody, authUser);
  }

  // GET /api/om/draft/:dealDraftId/latest
  if (method === 'GET' && segments[2] === 'draft' && segments[4] === 'latest') {
    return handleGetLatestOM(req, res, segments[3], authUser);
  }

  // GET /api/om/draft/:dealDraftId/versions
  if (method === 'GET' && segments[2] === 'draft' && segments[4] === 'versions') {
    return handleListOMVersions(req, res, segments[3], authUser);
  }

  // GET /api/om/version/:omVersionId
  if (method === 'GET' && segments[2] === 'version' && segments[3]) {
    return handleGetOMVersion(req, res, segments[3], authUser);
  }

  // PUT /api/om/version/:omVersionId/section/:sectionId
  if (method === 'PUT' && segments[2] === 'version' && segments[4] === 'section') {
    return handleUpdateSection(req, res, segments[3], segments[5], readJsonBody, authUser);
  }

  // POST /api/om/version/:omVersionId/broker-approve
  if (method === 'POST' && segments[2] === 'version' && segments[4] === 'broker-approve') {
    return handleBrokerApprove(req, res, segments[3], readJsonBody, authUser);
  }

  // POST /api/om/version/:omVersionId/seller-approve
  if (method === 'POST' && segments[2] === 'version' && segments[4] === 'seller-approve') {
    return handleSellerApprove(req, res, segments[3], readJsonBody, authUser);
  }

  // POST /api/om/version/:omVersionId/request-changes
  if (method === 'POST' && segments[2] === 'version' && segments[4] === 'request-changes') {
    return handleRequestChanges(req, res, segments[3], readJsonBody, authUser);
  }

  // GET /api/om/sections - List available section definitions
  if (method === 'GET' && segments[2] === 'sections') {
    return handleGetSections(req, res);
  }

  log('warn', 'Route not found', { method, segments });
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'OM endpoint not found' }));
}

/**
 * Generate OM draft for a deal
 */
async function handleGenerateOM(req, res, dealDraftId, readJsonBody, authUser) {
  log('info', 'Generate OM request', { dealDraftId, userId: authUser.id });

  try {
    const body = await readJsonBody();

    // Verify access to deal draft
    const dealDraft = await prisma.dealDraft.findFirst({
      where: {
        id: dealDraftId,
        organizationId: authUser.organizationId
      },
      include: {
        brokers: true
      }
    });

    if (!dealDraft) {
      log('warn', 'Deal draft not found or access denied', { dealDraftId });
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Deal draft not found' }));
    }

    // Check if user is a broker on this deal
    const isBroker = dealDraft.brokers.some(b => b.userId === authUser.id);
    const isAdmin = authUser.role === 'Admin';

    if (!isBroker && !isAdmin) {
      log('warn', 'User not authorized to generate OM', { dealDraftId, userId: authUser.id });
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Not authorized to generate OM for this deal' }));
    }

    const omVersion = await omDrafterService.generateOMDraft(dealDraftId, {
      createdBy: authUser.id,
      createdByName: authUser.name,
      regenerate: body.regenerate === true
    });

    log('info', 'OM generated successfully', { dealDraftId, omVersionId: omVersion.id });

    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(omVersion));
  } catch (error) {
    log('error', 'Generate OM failed', { dealDraftId, error: error.message });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

/**
 * Get latest OM version for a deal
 */
async function handleGetLatestOM(req, res, dealDraftId, authUser) {
  log('debug', 'Get latest OM request', { dealDraftId, userId: authUser.id });

  try {
    // Verify access to deal draft
    const dealDraft = await prisma.dealDraft.findFirst({
      where: {
        id: dealDraftId,
        organizationId: authUser.organizationId
      }
    });

    if (!dealDraft) {
      log('warn', 'Deal draft not found or access denied', { dealDraftId });
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Deal draft not found' }));
    }

    const omVersion = await omDrafterService.getLatestOMVersion(dealDraftId);

    if (!omVersion) {
      log('debug', 'No OM version found', { dealDraftId });
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'No OM version found for this deal' }));
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(omVersion));
  } catch (error) {
    log('error', 'Get latest OM failed', { dealDraftId, error: error.message });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

/**
 * List all OM versions for a deal
 */
async function handleListOMVersions(req, res, dealDraftId, authUser) {
  log('debug', 'List OM versions request', { dealDraftId, userId: authUser.id });

  try {
    // Verify access to deal draft
    const dealDraft = await prisma.dealDraft.findFirst({
      where: {
        id: dealDraftId,
        organizationId: authUser.organizationId
      }
    });

    if (!dealDraft) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Deal draft not found' }));
    }

    const versions = await omDrafterService.listOMVersions(dealDraftId);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ versions }));
  } catch (error) {
    log('error', 'List OM versions failed', { dealDraftId, error: error.message });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

/**
 * Get specific OM version
 */
async function handleGetOMVersion(req, res, omVersionId, authUser) {
  log('debug', 'Get OM version request', { omVersionId, userId: authUser.id });

  try {
    const omVersion = await omDrafterService.getOMVersion(omVersionId);

    // Verify access via deal draft
    const dealDraft = await prisma.dealDraft.findFirst({
      where: {
        id: omVersion.dealDraftId,
        organizationId: authUser.organizationId
      }
    });

    if (!dealDraft) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Not authorized to access this OM' }));
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(omVersion));
  } catch (error) {
    log('error', 'Get OM version failed', { omVersionId, error: error.message });
    const status = error.message === 'OM version not found' ? 404 : 500;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

/**
 * Update OM section content
 */
async function handleUpdateSection(req, res, omVersionId, sectionId, readJsonBody, authUser) {
  log('info', 'Update section request', { omVersionId, sectionId, userId: authUser.id });

  try {
    const body = await readJsonBody();

    // Verify access and get OM
    const omVersion = await prisma.oMVersion.findUnique({
      where: { id: omVersionId },
      include: {
        dealDraft: {
          include: { brokers: true }
        }
      }
    });

    if (!omVersion) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'OM version not found' }));
    }

    // Check org access
    if (omVersion.dealDraft.organizationId !== authUser.organizationId) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Not authorized to edit this OM' }));
    }

    // Check if user is a broker
    const isBroker = omVersion.dealDraft.brokers.some(b => b.userId === authUser.id);
    const isAdmin = authUser.role === 'Admin';

    if (!isBroker && !isAdmin) {
      log('warn', 'User not authorized to edit OM', { omVersionId, userId: authUser.id });
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Only brokers can edit the OM' }));
    }

    // Validate section ID
    if (!OM_SECTIONS[sectionId]) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        error: `Invalid section ID: ${sectionId}`,
        validSections: Object.keys(OM_SECTIONS)
      }));
    }

    const updated = await omDrafterService.updateSection(
      omVersionId,
      sectionId,
      { content: body.content },
      { id: authUser.id, name: authUser.name }
    );

    log('info', 'Section updated successfully', { omVersionId, sectionId });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(updated));
  } catch (error) {
    log('error', 'Update section failed', { omVersionId, sectionId, error: error.message });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

/**
 * Broker approves OM
 */
async function handleBrokerApprove(req, res, omVersionId, readJsonBody, authUser) {
  log('info', 'Broker approve request', { omVersionId, userId: authUser.id });

  try {
    // Verify access and get OM
    const omVersion = await prisma.oMVersion.findUnique({
      where: { id: omVersionId },
      include: {
        dealDraft: {
          include: { brokers: true }
        }
      }
    });

    if (!omVersion) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'OM version not found' }));
    }

    // Check org access
    if (omVersion.dealDraft.organizationId !== authUser.organizationId) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Not authorized' }));
    }

    // Check if user is a broker with approval permission
    const broker = omVersion.dealDraft.brokers.find(b => b.userId === authUser.id);
    const isAdmin = authUser.role === 'Admin';

    if (!broker && !isAdmin) {
      log('warn', 'User not authorized for broker approval', { omVersionId, userId: authUser.id });
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Only brokers can approve the OM' }));
    }

    const approved = await omDrafterService.brokerApprove(
      omVersionId,
      { id: authUser.id, name: authUser.name }
    );

    log('info', 'OM broker approved', { omVersionId });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(approved));
  } catch (error) {
    log('error', 'Broker approve failed', { omVersionId, error: error.message });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

/**
 * Seller approves OM (unlocks distribution)
 */
async function handleSellerApprove(req, res, omVersionId, readJsonBody, authUser) {
  log('info', 'Seller approve request', { omVersionId, userId: authUser.id });

  try {
    // Verify access and get OM
    const omVersion = await prisma.oMVersion.findUnique({
      where: { id: omVersionId },
      include: {
        dealDraft: {
          include: {
            seller: true,
            brokers: true
          }
        }
      }
    });

    if (!omVersion) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'OM version not found' }));
    }

    // Check org access
    if (omVersion.dealDraft.organizationId !== authUser.organizationId) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Not authorized' }));
    }

    // Check if user is the seller or has delegation
    const seller = omVersion.dealDraft.seller;
    const isSeller = seller?.userId === authUser.id;
    const isAdmin = authUser.role === 'Admin';

    // Check if broker has delegation to approve on behalf of seller
    const broker = omVersion.dealDraft.brokers.find(b => b.userId === authUser.id);
    const hasDelegation = broker?.canApproveOM === true;

    if (!isSeller && !hasDelegation && !isAdmin) {
      log('warn', 'User not authorized for seller approval', { omVersionId, userId: authUser.id });
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        error: 'Only the seller (or delegated broker) can approve the OM for marketing'
      }));
    }

    const approved = await omDrafterService.sellerApprove(
      omVersionId,
      { id: authUser.id, name: authUser.name }
    );

    log('info', 'OM seller approved - ready for distribution', { omVersionId });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(approved));
  } catch (error) {
    log('error', 'Seller approve failed', { omVersionId, error: error.message });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

/**
 * Request changes (sends back to draft)
 */
async function handleRequestChanges(req, res, omVersionId, readJsonBody, authUser) {
  log('info', 'Request changes request', { omVersionId, userId: authUser.id });

  try {
    const body = await readJsonBody();

    if (!body.feedback) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Feedback is required when requesting changes' }));
    }

    // Verify access and get OM
    const omVersion = await prisma.oMVersion.findUnique({
      where: { id: omVersionId },
      include: {
        dealDraft: {
          include: {
            seller: true,
            brokers: true
          }
        }
      }
    });

    if (!omVersion) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'OM version not found' }));
    }

    // Check org access
    if (omVersion.dealDraft.organizationId !== authUser.organizationId) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Not authorized' }));
    }

    // Check if user is seller, broker, or admin
    const isSeller = omVersion.dealDraft.seller?.userId === authUser.id;
    const isBroker = omVersion.dealDraft.brokers.some(b => b.userId === authUser.id);
    const isAdmin = authUser.role === 'Admin';

    if (!isSeller && !isBroker && !isAdmin) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Not authorized to request changes' }));
    }

    const role = isSeller ? 'SELLER' : (isBroker ? 'BROKER' : 'ADMIN');

    const updated = await omDrafterService.requestChanges(
      omVersionId,
      { id: authUser.id, name: authUser.name, role },
      body.feedback
    );

    log('info', 'Changes requested', { omVersionId });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(updated));
  } catch (error) {
    log('error', 'Request changes failed', { omVersionId, error: error.message });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

/**
 * Get available section definitions
 */
function handleGetSections(req, res) {
  const sections = Object.entries(OM_SECTIONS).map(([id, def]) => ({
    id,
    title: def.title,
    required: def.required,
    fields: def.fields,
    autogenerated: def.autogenerated || false
  }));

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ sections, statuses: OM_STATUSES }));
}
