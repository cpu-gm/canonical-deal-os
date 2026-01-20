/**
 * Unified Audit Trail Routes
 *
 * Provides a single endpoint to query both BFF DealEvent and Kernel Event logs,
 * normalizing them into a consistent format for audit review.
 *
 * This bridges the gap between:
 * - BFF DealEvent (LP/GP financial operations, auth events)
 * - Kernel Event (deal lifecycle, authority gates, materials)
 */

import { getPrisma } from "../db.js";
import { extractAuthUser } from "./auth.js";

const KERNEL_API_URL = process.env.KERNEL_API_URL || 'http://localhost:3001';

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

/**
 * Verify hash chain integrity for a subset of events.
 *
 * @param {Array} events - Events sorted by sequenceNumber ascending
 * @returns {boolean} True if chain is valid
 */
function verifyLocalChain(events) {
  if (events.length === 0) return true;

  let expectedPreviousHash = null;
  for (const event of events) {
    if (event.previousEventHash !== expectedPreviousHash) {
      return false;
    }
    expectedPreviousHash = event.eventHash;
  }
  return true;
}

/**
 * Get unified audit trail for a deal.
 * Combines BFF DealEvent and Kernel Event into a single timeline.
 *
 * GET /api/deals/:dealId/audit-trail
 * Query params:
 * - limit: number (default 100)
 * - offset: number (default 0)
 * - types: comma-separated event types to filter
 * - startDate: ISO date string
 * - endDate: ISO date string
 * - source: 'BFF' | 'KERNEL' | 'ALL' (default 'ALL')
 */
export async function handleGetUnifiedAuditTrail(req, res, dealId) {
  const authUser = await extractAuthUser(req);
  if (!authUser) {
    return sendError(res, 401, "Not authenticated");
  }

  const prisma = getPrisma();

  // Parse query params
  const url = new URL(req.url, `http://${req.headers.host}`);
  const limit = parseInt(url.searchParams.get('limit') || '100', 10);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);
  const eventTypes = url.searchParams.get('types')?.split(',') || null;
  const startDate = url.searchParams.get('startDate');
  const endDate = url.searchParams.get('endDate');
  const source = url.searchParams.get('source') || 'ALL';

  let normalizedBff = [];
  let normalizedKernel = [];

  // Get BFF DealEvents if requested
  if (source === 'ALL' || source === 'BFF') {
    const bffWhere = { dealId };
    if (eventTypes) bffWhere.eventType = { in: eventTypes };
    if (startDate || endDate) {
      bffWhere.occurredAt = {};
      if (startDate) bffWhere.occurredAt.gte = new Date(startDate);
      if (endDate) bffWhere.occurredAt.lte = new Date(endDate);
    }

    const bffEvents = await prisma.dealEvent.findMany({
      where: bffWhere,
      orderBy: { occurredAt: 'desc' },
      take: limit * 2, // Get extra to allow for merging
      skip: 0
    });

    normalizedBff = bffEvents.map(e => ({
      id: e.id,
      source: 'BFF',
      dealId: e.dealId,
      eventType: e.eventType,
      eventData: typeof e.eventData === 'string' ? safeJsonParse(e.eventData) : e.eventData,
      actorId: e.actorId,
      actorName: e.actorName,
      actorRole: e.actorRole,
      sequenceNumber: e.sequenceNumber,
      eventHash: e.eventHash,
      previousEventHash: e.previousEventHash,
      occurredAt: e.occurredAt.toISOString(),
      fromState: e.fromState,
      toState: e.toState
    }));
  }

  // Get Kernel Events if requested
  if (source === 'ALL' || source === 'KERNEL') {
    try {
      const kernelUrl = new URL(`${KERNEL_API_URL}/deals/${dealId}/events`);
      kernelUrl.searchParams.set('limit', String(limit * 2));

      const kernelResponse = await fetch(kernelUrl.toString(), {
        headers: { 'Accept': 'application/json' }
      });

      if (kernelResponse.ok) {
        const kernelEvents = await kernelResponse.json();

        normalizedKernel = (Array.isArray(kernelEvents) ? kernelEvents : []).map(e => ({
          id: e.id,
          source: 'KERNEL',
          dealId: e.dealId,
          eventType: e.type,
          eventData: e.payload,
          actorId: e.actorId,
          actorName: null, // Kernel doesn't store actor name
          actorRole: null,
          sequenceNumber: e.sequenceNumber,
          eventHash: e.eventHash,
          previousEventHash: e.previousEventHash,
          occurredAt: e.createdAt,
          fromState: null,
          toState: null
        }));
      }
    } catch (err) {
      console.warn(`[Unified Audit] Failed to fetch Kernel events: ${err.message}`);
    }
  }

  // Merge and sort by timestamp (most recent first)
  const allEvents = [...normalizedBff, ...normalizedKernel]
    .sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt));

  // Apply offset and limit after merge
  const paginatedEvents = allEvents.slice(offset, offset + limit);

  // Verify hash chains for integrity reporting
  const bffForChain = normalizedBff
    .filter(e => e.eventHash && e.sequenceNumber)
    .sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  const kernelForChain = normalizedKernel
    .filter(e => e.eventHash && e.sequenceNumber)
    .sort((a, b) => a.sequenceNumber - b.sequenceNumber);

  const bffChainValid = verifyLocalChain(bffForChain);
  const kernelChainValid = verifyLocalChain(kernelForChain);

  sendJson(res, 200, {
    events: paginatedEvents,
    pagination: {
      limit,
      offset,
      total: allEvents.length,
      hasMore: offset + limit < allEvents.length
    },
    integrity: {
      bffChainValid,
      kernelChainValid,
      bffEventCount: normalizedBff.length,
      kernelEventCount: normalizedKernel.length
    }
  });
}

/**
 * Verify full audit trail integrity.
 *
 * GET /api/deals/:dealId/audit-trail/verify
 */
export async function handleVerifyAuditTrail(req, res, dealId) {
  const authUser = await extractAuthUser(req);
  if (!authUser) {
    return sendError(res, 401, "Not authenticated");
  }

  const prisma = getPrisma();

  // Verify BFF chain
  const bffEvents = await prisma.dealEvent.findMany({
    where: { dealId },
    orderBy: { sequenceNumber: 'asc' },
    select: {
      id: true,
      sequenceNumber: true,
      eventType: true,
      previousEventHash: true,
      eventHash: true
    }
  });

  const bffIssues = [];
  let expectedSeq = 1;
  let expectedHash = null;

  for (const event of bffEvents) {
    if (event.sequenceNumber !== expectedSeq) {
      bffIssues.push({
        eventId: event.id,
        sequenceNumber: event.sequenceNumber,
        issue: `Sequence gap: expected ${expectedSeq}, found ${event.sequenceNumber}`
      });
    }
    if (event.previousEventHash !== expectedHash) {
      bffIssues.push({
        eventId: event.id,
        sequenceNumber: event.sequenceNumber,
        issue: `Chain break at sequence ${event.sequenceNumber}`
      });
    }
    expectedSeq = event.sequenceNumber + 1;
    expectedHash = event.eventHash;
  }

  // Verify Kernel chain via API
  let kernelVerification = { valid: true, issues: [], totalEvents: 0 };
  try {
    const kernelResponse = await fetch(`${KERNEL_API_URL}/deals/${dealId}/events/verify`, {
      headers: { 'Accept': 'application/json' }
    });
    if (kernelResponse.ok) {
      kernelVerification = await kernelResponse.json();
    }
  } catch (err) {
    kernelVerification = {
      valid: false,
      error: `Failed to reach Kernel API: ${err.message}`,
      issues: [],
      totalEvents: 0
    };
  }

  const overallValid = bffIssues.length === 0 && kernelVerification.valid;

  sendJson(res, 200, {
    dealId,
    overallValid,
    bff: {
      valid: bffIssues.length === 0,
      eventCount: bffEvents.length,
      issues: bffIssues
    },
    kernel: kernelVerification,
    verifiedAt: new Date().toISOString()
  });
}

/**
 * Get event count summary for a deal.
 *
 * GET /api/deals/:dealId/audit-trail/summary
 */
export async function handleGetAuditSummary(req, res, dealId) {
  const authUser = await extractAuthUser(req);
  if (!authUser) {
    return sendError(res, 401, "Not authenticated");
  }

  const prisma = getPrisma();

  // Get BFF event type counts
  const bffEvents = await prisma.dealEvent.findMany({
    where: { dealId },
    select: { eventType: true }
  });

  const bffByType = bffEvents.reduce((acc, e) => {
    acc[e.eventType] = (acc[e.eventType] || 0) + 1;
    return acc;
  }, {});

  // Get Kernel event type counts
  let kernelByType = {};
  let kernelTotal = 0;
  try {
    const kernelResponse = await fetch(`${KERNEL_API_URL}/deals/${dealId}/events`, {
      headers: { 'Accept': 'application/json' }
    });
    if (kernelResponse.ok) {
      const kernelEvents = await kernelResponse.json();
      kernelTotal = Array.isArray(kernelEvents) ? kernelEvents.length : 0;
      kernelByType = (Array.isArray(kernelEvents) ? kernelEvents : []).reduce((acc, e) => {
        acc[e.type] = (acc[e.type] || 0) + 1;
        return acc;
      }, {});
    }
  } catch (err) {
    console.warn(`[Unified Audit] Failed to fetch Kernel events: ${err.message}`);
  }

  sendJson(res, 200, {
    dealId,
    bff: {
      totalEvents: bffEvents.length,
      byType: bffByType
    },
    kernel: {
      totalEvents: kernelTotal,
      byType: kernelByType
    },
    combined: {
      totalEvents: bffEvents.length + kernelTotal
    }
  });
}

/**
 * Safe JSON parse with fallback.
 */
function safeJsonParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}
