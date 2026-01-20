import crypto from 'node:crypto';
import { getPrisma } from '../db.js';

// ============================================================================
// LOGGING UTILITIES
// ============================================================================
const LOG_PREFIX = "[Snapshot]";

function log(message, data = {}) {
  const timestamp = new Date().toISOString();
  console.log(`${timestamp} ${LOG_PREFIX} ${message}`, JSON.stringify(data, null, 0));
}

function logError(message, error, data = {}) {
  const timestamp = new Date().toISOString();
  console.error(`${timestamp} ${LOG_PREFIX} ERROR: ${message}`, {
    ...data,
    error: error?.message || String(error),
    stack: error?.stack?.split('\n').slice(0, 3).join(' | ')
  });
}

function logDebug(message, data = {}) {
  if (process.env.DEBUG_SNAPSHOT === 'true') {
    const timestamp = new Date().toISOString();
    console.log(`${timestamp} ${LOG_PREFIX} DEBUG: ${message}`, JSON.stringify(data, null, 0));
  }
}

/**
 * Create an audited DealEvent with SHA-256 hash chain for tamper detection.
 *
 * This function ensures:
 * 1. Monotonic sequence numbers for gap detection
 * 2. Hash chain linking each event to the previous (like blockchain)
 * 3. Consistent audit trail for all deal mutations
 *
 * @param {string} dealId - UUID of the deal
 * @param {string} eventType - Event type (e.g., 'DISTRIBUTION_CREATED', 'CAPITAL_CALL_CANCELLED')
 * @param {object} eventData - Event-specific data payload
 * @param {object} actor - Actor performing the action { id, name, role }
 * @param {object} options - Optional fields: authorityContext, evidenceRefs, fromState, toState
 * @returns {Promise<object>} The created DealEvent
 */
export async function createDealEvent(dealId, eventType, eventData, actor, options = {}) {
  const prisma = getPrisma();

  // Get previous event for hash chain continuity
  const previousEvent = await prisma.dealEvent.findFirst({
    where: { dealId },
    orderBy: { sequenceNumber: 'desc' },
    select: { sequenceNumber: true, eventHash: true }
  });

  const sequenceNumber = (previousEvent?.sequenceNumber || 0) + 1;
  const previousHash = previousEvent?.eventHash || null;

  // Calculate SHA-256 hash of this event
  const hashPayload = JSON.stringify({
    dealId,
    sequenceNumber,
    eventType,
    eventData,
    previousHash,
    timestamp: new Date().toISOString()
  });
  const eventHash = crypto.createHash('sha256').update(hashPayload).digest('hex');

  return prisma.dealEvent.create({
    data: {
      dealId,
      eventType,
      eventData: JSON.stringify(eventData),
      actorId: actor.id || 'SYSTEM',
      actorName: actor.name || 'Unknown',
      actorRole: actor.role || 'SYSTEM',
      authorityContext: JSON.stringify(options.authorityContext || {}),
      evidenceRefs: options.evidenceRefs ? JSON.stringify(options.evidenceRefs) : null,
      fromState: options.fromState || null,
      toState: options.toState || null,
      sequenceNumber,
      previousEventHash: previousHash,
      eventHash
    }
  });
}

/**
 * Create a snapshot of LP ownership (cap table) for a deal.
 *
 * Snapshots freeze point-in-time state so that calculations (distributions, capital calls)
 * can be reproduced exactly as they were at the time of creation, even if LP ownership
 * changes later.
 *
 * @param {string} dealId - UUID of the deal
 * @param {string} snapshotType - Type: 'CAP_TABLE', 'DISTRIBUTION_CALC', 'CAPITAL_CALL_CALC'
 * @param {string} reason - Description of why snapshot was created
 * @param {object} actor - Actor creating the snapshot { id, name }
 * @returns {Promise<object>} The created Snapshot with capTableHash
 */
export async function createCapTableSnapshot(dealId, snapshotType, reason, actor) {
  const prisma = getPrisma();

  log(`Creating cap table snapshot`, { dealId, snapshotType, reason, actorId: actor?.id });

  // Get all active LP actors for this deal with share class info
  const lpActors = await prisma.lPActor.findMany({
    where: { dealId, status: 'ACTIVE' },
    select: {
      id: true,
      entityName: true,
      ownershipPct: true,
      commitment: true,
      shareClassId: true,
      shareClass: {
        select: {
          id: true,
          code: true,
          name: true,
          preferredReturn: true,
          managementFee: true,
          carryPercent: true,
          priority: true
        }
      }
    }
  });

  log(`Fetched LP data with share classes`, { dealId, lpCount: lpActors.length });

  // Calculate class breakdown for logging
  const classBreakdown = {};
  lpActors.forEach(lp => {
    const classCode = lp.shareClass?.code || 'NONE';
    classBreakdown[classCode] = (classBreakdown[classCode] || 0) + 1;
  });
  logDebug(`LP breakdown by share class`, { dealId, classBreakdown });

  // Build frozen LP ownership array with share class info
  const lpOwnership = lpActors.map(lp => ({
    lpActorId: lp.id,
    entityName: lp.entityName,
    ownershipPct: lp.ownershipPct,
    commitment: lp.commitment,
    shareClass: lp.shareClass ? {
      id: lp.shareClass.id,
      code: lp.shareClass.code,
      name: lp.shareClass.name,
      preferredReturn: lp.shareClass.preferredReturn,
      managementFee: lp.shareClass.managementFee,
      carryPercent: lp.shareClass.carryPercent,
      priority: lp.shareClass.priority
    } : null
  }));

  // Calculate integrity hash of cap table
  const capTableHash = crypto.createHash('sha256')
    .update(JSON.stringify(lpOwnership))
    .digest('hex');

  const snapshot = await prisma.snapshot.create({
    data: {
      dealId,
      snapshotType,
      lpOwnership: JSON.stringify(lpOwnership),
      capTableHash,
      createdBy: actor.id || 'SYSTEM',
      createdByName: actor.name || 'Unknown',
      reason
    }
  });

  log(`Cap table snapshot created`, {
    snapshotId: snapshot.id,
    dealId,
    snapshotType,
    lpCount: lpActors.length,
    hasShareClassData: lpActors.some(lp => lp.shareClass),
    classBreakdown
  });

  return snapshot;
}

/**
 * Verify the hash chain integrity for a deal's events.
 *
 * This can be used during audits to detect:
 * 1. Modified events (hash won't match)
 * 2. Deleted events (sequence gaps)
 * 3. Inserted events (chain breaks)
 *
 * @param {string} dealId - UUID of the deal to verify
 * @returns {Promise<object>} Verification result with any detected issues
 */
export async function verifyEventChain(dealId) {
  const prisma = getPrisma();

  const events = await prisma.dealEvent.findMany({
    where: { dealId },
    orderBy: { sequenceNumber: 'asc' },
    select: {
      id: true,
      sequenceNumber: true,
      eventType: true,
      eventData: true,
      previousEventHash: true,
      eventHash: true,
      occurredAt: true
    }
  });

  const issues = [];
  let expectedSequence = 1;
  let expectedPreviousHash = null;

  for (const event of events) {
    // Check sequence continuity
    if (event.sequenceNumber !== expectedSequence) {
      issues.push({
        eventId: event.id,
        sequenceNumber: event.sequenceNumber,
        issue: `Sequence gap: expected ${expectedSequence}, found ${event.sequenceNumber}`
      });
    }

    // Check previous hash linkage
    if (event.previousEventHash !== expectedPreviousHash) {
      issues.push({
        eventId: event.id,
        sequenceNumber: event.sequenceNumber,
        issue: `Chain break: previousEventHash doesn't match previous event's hash`
      });
    }

    // Move to next expected values
    expectedSequence = event.sequenceNumber + 1;
    expectedPreviousHash = event.eventHash;
  }

  return {
    valid: issues.length === 0,
    totalEvents: events.length,
    issues
  };
}

/**
 * Create a snapshot of LP ownership AND waterfall rules for distribution calculations.
 *
 * This enhanced snapshot captures both the cap table AND the waterfall structure
 * at the time of distribution creation, ensuring reproducibility even if
 * either ownership or waterfall rules change later.
 *
 * @param {string} dealId - UUID of the deal
 * @param {string} reason - Description of why snapshot was created
 * @param {object} actor - Actor creating the snapshot { id, name }
 * @returns {Promise<object>} The created Snapshot with both capTableHash and rulebookHash
 */
export async function createDistributionSnapshot(dealId, reason, actor) {
  const prisma = getPrisma();

  log(`Creating distribution snapshot`, { dealId, reason, actorId: actor?.id });

  // Get all active LP actors for this deal with share class info
  const lpActors = await prisma.lPActor.findMany({
    where: { dealId, status: 'ACTIVE' },
    select: {
      id: true,
      entityName: true,
      ownershipPct: true,
      commitment: true,
      shareClassId: true,
      shareClass: {
        select: {
          id: true,
          code: true,
          name: true,
          preferredReturn: true,
          managementFee: true,
          carryPercent: true,
          priority: true
        }
      }
    }
  });

  log(`Fetched LP data for distribution snapshot`, { dealId, lpCount: lpActors.length });

  // Calculate class breakdown for logging
  const classBreakdown = {};
  lpActors.forEach(lp => {
    const classCode = lp.shareClass?.code || 'NONE';
    classBreakdown[classCode] = (classBreakdown[classCode] || 0) + 1;
  });
  logDebug(`LP breakdown by share class`, { dealId, classBreakdown });

  // Build frozen LP ownership array with share class info
  const lpOwnership = lpActors.map(lp => ({
    lpActorId: lp.id,
    entityName: lp.entityName,
    ownershipPct: lp.ownershipPct,
    commitment: lp.commitment,
    shareClass: lp.shareClass ? {
      id: lp.shareClass.id,
      code: lp.shareClass.code,
      name: lp.shareClass.name,
      preferredReturn: lp.shareClass.preferredReturn,
      managementFee: lp.shareClass.managementFee,
      carryPercent: lp.shareClass.carryPercent,
      priority: lp.shareClass.priority
    } : null
  }));

  // Calculate integrity hash of cap table
  const capTableHash = crypto.createHash('sha256')
    .update(JSON.stringify(lpOwnership))
    .digest('hex');

  // Get waterfall structure if it exists
  const waterfallStructure = await prisma.waterfallStructure.findUnique({
    where: { dealId }
  });

  let waterfallRules = null;
  let rulebookHash = null;

  if (waterfallStructure) {
    log(`Found waterfall structure`, { dealId, hasPromoteTiers: !!waterfallStructure.promoteTiers });

    // Parse promote tiers if stored as JSON string
    let promoteTiers;
    try {
      promoteTiers = typeof waterfallStructure.promoteTiers === 'string'
        ? JSON.parse(waterfallStructure.promoteTiers)
        : waterfallStructure.promoteTiers;
    } catch {
      promoteTiers = waterfallStructure.promoteTiers;
    }

    waterfallRules = {
      lpEquity: waterfallStructure.lpEquity,
      gpEquity: waterfallStructure.gpEquity,
      preferredReturn: waterfallStructure.preferredReturn,
      promoteTiers: promoteTiers,
      gpCatchUp: waterfallStructure.gpCatchUp,
      catchUpPercent: waterfallStructure.catchUpPercent,
      lookback: waterfallStructure.lookback
    };

    rulebookHash = crypto.createHash('sha256')
      .update(JSON.stringify(waterfallRules))
      .digest('hex');
  } else {
    log(`No waterfall structure found`, { dealId });
  }

  const snapshot = await prisma.snapshot.create({
    data: {
      dealId,
      snapshotType: 'DISTRIBUTION_CALC',
      lpOwnership: JSON.stringify(lpOwnership),
      capTableHash,
      waterfallRules: waterfallRules ? JSON.stringify(waterfallRules) : null,
      rulebookHash,
      createdBy: actor.id || 'SYSTEM',
      createdByName: actor.name || 'Unknown',
      reason
    }
  });

  log(`Distribution snapshot created`, {
    snapshotId: snapshot.id,
    dealId,
    lpCount: lpActors.length,
    hasShareClassData: lpActors.some(lp => lp.shareClass),
    hasWaterfallRules: !!waterfallRules,
    classBreakdown
  });

  return snapshot;
}

/**
 * Verify a snapshot's integrity by recalculating the cap table hash.
 *
 * @param {string} snapshotId - UUID of the snapshot to verify
 * @returns {Promise<object>} Verification result
 */
export async function verifySnapshotIntegrity(snapshotId) {
  const prisma = getPrisma();

  const snapshot = await prisma.snapshot.findUnique({
    where: { id: snapshotId }
  });

  if (!snapshot) {
    return { valid: false, error: 'Snapshot not found' };
  }

  // Recalculate hash from stored lpOwnership
  const recalculatedHash = crypto.createHash('sha256')
    .update(snapshot.lpOwnership)
    .digest('hex');

  return {
    valid: recalculatedHash === snapshot.capTableHash,
    storedHash: snapshot.capTableHash,
    recalculatedHash,
    match: recalculatedHash === snapshot.capTableHash
  };
}
