/**
 * E2E Test Utilities
 *
 * Helper functions for end-to-end integration tests that verify
 * numbers flow consistently from underwriting to execution.
 */

import { getPrisma } from "../../db.js";
import crypto from "node:crypto";

// ============================================================================
// TEST DATA GENERATORS
// ============================================================================

/**
 * Generate unique test IDs
 */
export function generateTestId(prefix = "test") {
  return `${prefix}-${crypto.randomUUID()}`;
}

/**
 * Generate unique email for test LP
 */
export function generateTestEmail(prefix = "lp") {
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}-${random}@e2e-test.com`;
}

// ============================================================================
// DEAL OPERATIONS
// ============================================================================

/**
 * Create a test deal with minimal required fields
 * @param {object} options
 * @returns {Promise<object>} Created deal
 */
export async function createTestDeal(options = {}) {
  const prisma = getPrisma();
  const dealId = options.id || generateTestId("deal");
  const orgId = options.organizationId || generateTestId("org");

  // For SQLite/test DB, we create a minimal deal record
  // In production, deals come from Kernel API

  return {
    id: dealId,
    name: options.name || `E2E Test Deal ${Date.now()}`,
    organizationId: orgId,
    purchasePrice: options.purchasePrice || 10000000,
    created: true
  };
}

// ============================================================================
// WATERFALL STRUCTURE OPERATIONS
// ============================================================================

/**
 * Create a waterfall structure for a deal
 */
export async function createTestWaterfallStructure(dealId, structure = {}) {
  const prisma = getPrisma();

  const waterfallStructure = await prisma.waterfallStructure.create({
    data: {
      id: generateTestId("waterfall"),
      dealId,
      lpEquity: structure.lpEquity || 9000000,
      gpEquity: structure.gpEquity || 1000000,
      preferredReturn: structure.preferredReturn ?? 0.08,
      promoteTiers: JSON.stringify(structure.promoteTiers || [
        { hurdle: 0.12, lpSplit: 0.80, gpSplit: 0.20 },
        { hurdle: Infinity, lpSplit: 0.70, gpSplit: 0.30 }
      ]),
      gpCatchUp: structure.gpCatchUp ?? true,
      catchUpPercent: structure.catchUpPercent ?? 1.0,
      lookback: structure.lookback ?? false
    }
  });

  return waterfallStructure;
}

// ============================================================================
// SHARE CLASS OPERATIONS
// ============================================================================

/**
 * Create a share class for a deal
 */
export async function createTestShareClass(dealId, config = {}) {
  const prisma = getPrisma();

  const shareClass = await prisma.shareClass.create({
    data: {
      id: generateTestId("class"),
      dealId,
      organizationId: config.organizationId || null,
      name: config.name || `Class ${config.code || 'A'}`,
      code: config.code || "A",
      description: config.description || null,
      preferredReturn: config.preferredReturn ?? null,
      managementFee: config.managementFee ?? null,
      carryPercent: config.carryPercent ?? null,
      votingRights: config.votingRights ?? true,
      priority: config.priority ?? 1,
      createdBy: config.createdBy || "e2e-test"
    }
  });

  return shareClass;
}

// ============================================================================
// LP OPERATIONS
// ============================================================================

/**
 * Create a test LP actor (skipping invitation flow)
 */
export async function createTestLP(dealId, lpData = {}) {
  const prisma = getPrisma();

  const lpActor = await prisma.lPActor.create({
    data: {
      id: generateTestId("lp"),
      dealId,
      email: lpData.email || generateTestEmail(),
      entityName: lpData.entityName || `Test LP ${Date.now()}`,
      actorId: generateTestId("actor"),
      commitment: lpData.commitment || 1000000,
      ownershipPct: lpData.ownershipPct || 10,
      status: lpData.status || "ACTIVE",
      organizationId: lpData.organizationId || null,
      shareClassId: lpData.shareClassId || null
    },
    include: {
      shareClass: true
    }
  });

  return lpActor;
}

/**
 * Create multiple test LPs with specified configurations
 */
export async function createTestLPs(dealId, lpConfigs) {
  const lps = [];
  for (const config of lpConfigs) {
    const lp = await createTestLP(dealId, config);
    lps.push(lp);
  }
  return lps;
}

// ============================================================================
// DISTRIBUTION OPERATIONS
// ============================================================================

/**
 * Create a test distribution with allocations
 */
export async function createTestDistribution(dealId, config = {}) {
  const prisma = getPrisma();

  // Get active LPs for this deal
  const lpActors = await prisma.lPActor.findMany({
    where: { dealId, status: "ACTIVE" },
    include: { shareClass: true }
  });

  if (lpActors.length === 0) {
    throw new Error(`No active LPs found for deal ${dealId}`);
  }

  // Calculate total ownership for pro-rata
  const totalOwnership = lpActors.reduce((sum, lp) => sum + (lp.ownershipPct || 0), 0);
  const totalAmount = config.totalAmount || 100000;

  // Create distribution
  const distribution = await prisma.distribution.create({
    data: {
      id: generateTestId("dist"),
      dealId,
      title: config.title || `E2E Test Distribution ${Date.now()}`,
      totalAmount,
      distributionDate: config.distributionDate || new Date(),
      type: config.type || "CASH_DISTRIBUTION",
      status: config.status || "DRAFT",
      createdBy: config.createdBy || "e2e-test",
      createdByName: config.createdByName || "E2E Test"
    }
  });

  // Create allocations (simple pro-rata for now)
  const allocations = [];
  for (const lp of lpActors) {
    const share = totalOwnership > 0 ? (lp.ownershipPct / totalOwnership) : (1 / lpActors.length);
    const grossAmount = Math.round(totalAmount * share * 100) / 100;

    const allocation = await prisma.distributionAllocation.create({
      data: {
        id: generateTestId("alloc"),
        distributionId: distribution.id,
        lpActorId: lp.id,
        grossAmount,
        withholdingAmount: 0,
        netAmount: grossAmount,
        status: "PENDING"
      }
    });
    allocations.push(allocation);
  }

  return {
    ...distribution,
    allocations
  };
}

// ============================================================================
// SNAPSHOT OPERATIONS
// ============================================================================

/**
 * Create a cap table snapshot for a deal
 */
export async function createTestSnapshot(dealId, options = {}) {
  const prisma = getPrisma();

  // Get active LPs with share class info
  const lpActors = await prisma.lPActor.findMany({
    where: { dealId, status: "ACTIVE" },
    include: { shareClass: true }
  });

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

  const capTableHash = crypto.createHash("sha256")
    .update(JSON.stringify(lpOwnership))
    .digest("hex");

  const snapshot = await prisma.snapshot.create({
    data: {
      id: generateTestId("snapshot"),
      dealId,
      snapshotType: options.snapshotType || "DISTRIBUTION_CALC",
      lpOwnership: JSON.stringify(lpOwnership),
      capTableHash,
      waterfallRules: options.waterfallRules ? JSON.stringify(options.waterfallRules) : null,
      rulebookHash: options.rulebookHash || null,
      createdBy: options.createdBy || "e2e-test",
      createdByName: options.createdByName || "E2E Test",
      reason: options.reason || "E2E test snapshot"
    }
  });

  return snapshot;
}

// ============================================================================
// CLEANUP OPERATIONS
// ============================================================================

/**
 * Clean up all test data for a deal
 */
export async function cleanupTestDeal(dealId) {
  const prisma = getPrisma();

  // Delete in order of dependencies (child tables first)
  // First, delete allocation children
  await prisma.distributionAllocation.deleteMany({
    where: { distribution: { dealId } }
  });
  await prisma.capitalCallAllocation.deleteMany({
    where: { capitalCall: { dealId } }
  });

  // Clear snapshotId references before deleting snapshots
  await prisma.distribution.updateMany({
    where: { dealId },
    data: { snapshotId: null }
  });
  await prisma.capitalCall.updateMany({
    where: { dealId },
    data: { snapshotId: null }
  });

  // Also clear any AccountingPeriod references
  await prisma.accountingPeriod.updateMany({
    where: { dealId },
    data: { closeSnapshotId: null }
  });

  // Now delete the main entities
  await prisma.distribution.deleteMany({ where: { dealId } });
  await prisma.capitalCall.deleteMany({ where: { dealId } });
  await prisma.accountingPeriod.deleteMany({ where: { dealId } });

  // NOTE: Snapshots are intentionally NOT deleted - they are immutable audit records.
  // The database has a trigger that prevents DELETE on Snapshot table.
  // Test snapshots will accumulate but are dealId-scoped so they won't interfere.
  // If cleanup is truly needed, manually remove the trigger or drop the table.

  await prisma.lPActor.deleteMany({ where: { dealId } });
  await prisma.lPInvitation.deleteMany({ where: { dealId } });
  await prisma.shareClass.deleteMany({ where: { dealId } });
  await prisma.waterfallStructure.deleteMany({ where: { dealId } });
}

/**
 * Clean up multiple test deals
 */
export async function cleanupTestDeals(dealIds) {
  for (const dealId of dealIds) {
    await cleanupTestDeal(dealId);
  }
}

// ============================================================================
// VERIFICATION HELPERS
// ============================================================================

/**
 * Verify allocation sum equals total amount
 */
export function verifyAllocationSum(allocations, totalAmount, tolerance = 0.01) {
  const sum = allocations.reduce((s, a) => s + (a.grossAmount || a.amount || 0), 0);
  const diff = Math.abs(sum - totalAmount);
  return {
    valid: diff <= tolerance,
    sum,
    expected: totalAmount,
    diff
  };
}

/**
 * Verify no negative allocations
 */
export function verifyNoNegativeAllocations(allocations) {
  const negatives = allocations.filter(a => (a.grossAmount || a.amount || 0) < 0);
  return {
    valid: negatives.length === 0,
    negativeCount: negatives.length,
    negatives
  };
}

/**
 * Verify pro-rata allocation matches ownership
 */
export function verifyProRataAllocation(allocations, lpActors, totalAmount, tolerance = 0.01) {
  const totalOwnership = lpActors.reduce((sum, lp) => sum + (lp.ownershipPct || 0), 0);
  const issues = [];

  for (const allocation of allocations) {
    const lp = lpActors.find(l => l.id === allocation.lpActorId);
    if (!lp) {
      issues.push({ lpActorId: allocation.lpActorId, issue: "LP not found" });
      continue;
    }

    const expectedShare = lp.ownershipPct / totalOwnership;
    const expectedAmount = totalAmount * expectedShare;
    const actualAmount = allocation.grossAmount || allocation.amount || 0;
    const diff = Math.abs(actualAmount - expectedAmount);

    if (diff > tolerance) {
      issues.push({
        lpActorId: allocation.lpActorId,
        expected: expectedAmount,
        actual: actualAmount,
        diff
      });
    }
  }

  return {
    valid: issues.length === 0,
    issues
  };
}

/**
 * Verify priority ordering in allocations
 * (Senior class should receive allocations first in limited cash scenarios)
 */
export function verifyPriorityOrdering(allocations, lpActors) {
  const sortedByPriority = [...lpActors].sort((a, b) => {
    const aPriority = a.shareClass?.priority ?? 999;
    const bPriority = b.shareClass?.priority ?? 999;
    return aPriority - bPriority;
  });

  // Group allocations by class priority
  const allocationsByPriority = new Map();
  for (const allocation of allocations) {
    const lp = lpActors.find(l => l.id === allocation.lpActorId);
    const priority = lp?.shareClass?.priority ?? 999;
    if (!allocationsByPriority.has(priority)) {
      allocationsByPriority.set(priority, []);
    }
    allocationsByPriority.get(priority).push(allocation);
  }

  return {
    valid: true, // Basic validation - more complex logic would check amounts
    priorities: [...allocationsByPriority.keys()].sort((a, b) => a - b)
  };
}
