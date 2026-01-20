/**
 * LP Statement Service
 *
 * Aggregates all financial activity for an LP in a specific deal:
 * - Capital call allocations (called, funded, pending)
 * - Distribution allocations (gross, withholding, net, paid)
 * - Current holdings (commitment, ownership, share class)
 * - Performance summary (deployed, received, net cash flow)
 */

import { getPrisma } from "../db.js";

// ============================================================================
// LOGGING UTILITIES
// ============================================================================
const LOG_PREFIX = "[LPStatement]";

function log(message, data = {}) {
  const timestamp = new Date().toISOString();
  console.log(`${timestamp} ${LOG_PREFIX} ${message}`, JSON.stringify(data, null, 0));
}

function logDebug(message, data = {}) {
  if (process.env.DEBUG_LP_STATEMENT === 'true') {
    const timestamp = new Date().toISOString();
    console.log(`${timestamp} ${LOG_PREFIX} DEBUG: ${message}`, JSON.stringify(data, null, 0));
  }
}

function logError(message, error, data = {}) {
  const timestamp = new Date().toISOString();
  console.error(`${timestamp} ${LOG_PREFIX} ERROR: ${message}`, {
    ...data,
    error: error?.message || String(error),
    stack: error?.stack?.split('\n').slice(0, 3).join(' | ')
  });
}

// ============================================================================
// SUMMARY CALCULATIONS
// ============================================================================

/**
 * Calculate capital call summary from allocations
 * @param {Array} allocations - CapitalCallAllocation records
 * @returns {Object} Summary with totals
 */
function calculateCapitalCallSummary(allocations) {
  logDebug(`Calculating capital call summary`, { allocationCount: allocations.length });

  const summary = {
    totalCalled: 0,
    totalFunded: 0,
    totalPending: 0,
    callCount: allocations.length,
    fundedCount: 0,
    pendingCount: 0
  };

  for (const alloc of allocations) {
    summary.totalCalled += alloc.amount || 0;
    summary.totalFunded += alloc.fundedAmount || 0;

    if (alloc.status === 'FUNDED' || alloc.status === 'COMPLETED') {
      summary.fundedCount++;
    } else if (alloc.status === 'PENDING' || alloc.status === 'ISSUED') {
      summary.pendingCount++;
      summary.totalPending += (alloc.amount || 0) - (alloc.fundedAmount || 0);
    }
  }

  logDebug(`Capital call summary calculated`, summary);
  return summary;
}

/**
 * Calculate distribution summary from allocations
 * @param {Array} allocations - DistributionAllocation records
 * @returns {Object} Summary with totals
 */
function calculateDistributionSummary(allocations) {
  logDebug(`Calculating distribution summary`, { allocationCount: allocations.length });

  const summary = {
    totalGross: 0,
    totalWithholding: 0,
    totalNet: 0,
    totalPaid: 0,
    distributionCount: allocations.length,
    paidCount: 0,
    pendingCount: 0
  };

  for (const alloc of allocations) {
    summary.totalGross += alloc.grossAmount || 0;
    summary.totalWithholding += alloc.withholdingAmount || 0;
    summary.totalNet += alloc.netAmount || 0;

    if (alloc.status === 'PAID' || alloc.status === 'COMPLETED') {
      summary.totalPaid += alloc.netAmount || 0;
      summary.paidCount++;
    } else {
      summary.pendingCount++;
    }
  }

  logDebug(`Distribution summary calculated`, summary);
  return summary;
}

/**
 * Calculate performance metrics
 * @param {Object} lpActor - LP Actor record
 * @param {Object} capitalSummary - Capital call summary
 * @param {Object} distributionSummary - Distribution summary
 * @returns {Object} Performance metrics
 */
function calculatePerformance(lpActor, capitalSummary, distributionSummary) {
  logDebug(`Calculating performance metrics`, {
    lpActorId: lpActor.id,
    commitment: lpActor.commitment
  });

  const performance = {
    capitalCommitted: lpActor.commitment || 0,
    capitalDeployed: capitalSummary.totalFunded,
    capitalRemaining: (lpActor.commitment || 0) - capitalSummary.totalFunded,
    capitalPending: capitalSummary.totalPending,
    distributionsReceived: distributionSummary.totalPaid,
    distributionsPending: distributionSummary.totalNet - distributionSummary.totalPaid,
    netCashFlow: distributionSummary.totalPaid - capitalSummary.totalFunded,
    unrealizedValue: null // Future: NAV integration
  };

  // Calculate multiple if capital deployed > 0
  if (performance.capitalDeployed > 0) {
    performance.distributionMultiple = (performance.distributionsReceived + performance.capitalDeployed) / performance.capitalDeployed;
  } else {
    performance.distributionMultiple = null;
  }

  logDebug(`Performance metrics calculated`, performance);
  return performance;
}

// ============================================================================
// MAIN SERVICE FUNCTION
// ============================================================================

/**
 * Build comprehensive LP statement for a specific deal
 * @param {string} dealId - Deal ID
 * @param {string} lpActorId - LP Actor ID
 * @param {Object} options - Optional parameters
 * @returns {Promise<Object>} Complete LP statement
 */
export async function buildLPStatement(dealId, lpActorId, options = {}) {
  log(`Building statement`, { dealId, lpActorId, options });

  const prisma = getPrisma();
  const reportDate = new Date();

  try {
    // Step 1: Fetch LP Actor with share class
    log(`Fetching LP Actor`, { lpActorId });
    const lpActor = await prisma.lPActor.findUnique({
      where: { id: lpActorId },
      include: {
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

    if (!lpActor) {
      logError(`LP Actor not found`, null, { lpActorId });
      throw new Error(`LP Actor not found: ${lpActorId}`);
    }

    // Verify LP belongs to this deal
    if (lpActor.dealId !== dealId) {
      logError(`LP Actor does not belong to deal`, null, { lpActorId, lpDealId: lpActor.dealId, requestedDealId: dealId });
      throw new Error(`LP Actor does not belong to this deal`);
    }

    log(`LP Actor fetched`, {
      lpActorId: lpActor.id,
      entityName: lpActor.entityName,
      shareClass: lpActor.shareClass?.code || 'NONE',
      commitment: lpActor.commitment
    });

    // Step 2: Fetch capital call allocations for this LP
    log(`Fetching capital call allocations`, { lpActorId });
    const capitalCallAllocations = await prisma.capitalCallAllocation.findMany({
      where: { lpActorId },
      include: {
        capitalCall: {
          select: {
            id: true,
            title: true,
            dueDate: true,
            status: true,
            purpose: true,
            createdAt: true
          }
        }
      },
      orderBy: { capitalCall: { createdAt: 'desc' } }
    });

    log(`Fetched capital calls`, {
      count: capitalCallAllocations.length,
      totalCalled: capitalCallAllocations.reduce((s, a) => s + (a.amount || 0), 0)
    });

    // Step 3: Fetch distribution allocations for this LP
    log(`Fetching distribution allocations`, { lpActorId });
    const distributionAllocations = await prisma.distributionAllocation.findMany({
      where: { lpActorId },
      include: {
        distribution: {
          select: {
            id: true,
            title: true,
            distributionDate: true,
            type: true,
            status: true,
            period: true,
            createdAt: true
          }
        }
      },
      orderBy: { distribution: { createdAt: 'desc' } }
    });

    log(`Fetched distributions`, {
      count: distributionAllocations.length,
      totalNet: distributionAllocations.reduce((s, a) => s + (a.netAmount || 0), 0)
    });

    // Step 4: Calculate summaries
    const capitalSummary = calculateCapitalCallSummary(capitalCallAllocations);
    const distributionSummary = calculateDistributionSummary(distributionAllocations);

    // Step 5: Calculate performance
    const performance = calculatePerformance(lpActor, capitalSummary, distributionSummary);

    // Step 6: Build response
    const statement = {
      reportDate: reportDate.toISOString(),
      reportPeriod: {
        from: options.fromDate || null, // null = inception
        to: options.toDate || reportDate.toISOString().split('T')[0]
      },

      lpActor: {
        id: lpActor.id,
        entityName: lpActor.entityName,
        email: lpActor.email,
        commitment: lpActor.commitment,
        ownershipPct: lpActor.ownershipPct,
        status: lpActor.status,
        shareClass: lpActor.shareClass ? {
          id: lpActor.shareClass.id,
          code: lpActor.shareClass.code,
          name: lpActor.shareClass.name,
          preferredReturn: lpActor.shareClass.preferredReturn,
          managementFee: lpActor.shareClass.managementFee,
          carryPercent: lpActor.shareClass.carryPercent,
          priority: lpActor.shareClass.priority
        } : null
      },

      capitalCalls: {
        items: capitalCallAllocations.map(alloc => ({
          id: alloc.id,
          capitalCallId: alloc.capitalCall.id,
          title: alloc.capitalCall.title,
          callDate: alloc.capitalCall.createdAt?.toISOString() || null,
          dueDate: alloc.capitalCall.dueDate?.toISOString() || null,
          purpose: alloc.capitalCall.purpose,
          amount: alloc.amount,
          fundedAmount: alloc.fundedAmount || 0,
          status: alloc.status,
          fundedAt: alloc.fundedAt?.toISOString() || null,
          wireReference: alloc.wireReference || null
        })),
        summary: capitalSummary
      },

      distributions: {
        items: distributionAllocations.map(alloc => ({
          id: alloc.id,
          distributionId: alloc.distribution.id,
          title: alloc.distribution.title,
          date: alloc.distribution.distributionDate?.toISOString() || null,
          type: alloc.distribution.type,
          period: alloc.distribution.period,
          grossAmount: alloc.grossAmount,
          withholdingAmount: alloc.withholdingAmount || 0,
          netAmount: alloc.netAmount,
          status: alloc.status,
          paidAt: alloc.paidAt?.toISOString() || null
        })),
        summary: distributionSummary
      },

      performance
    };

    log(`Statement built successfully`, {
      dealId,
      lpActorId,
      capitalCallCount: capitalSummary.callCount,
      distributionCount: distributionSummary.distributionCount,
      netCashFlow: performance.netCashFlow
    });

    return statement;

  } catch (error) {
    logError(`Failed to build statement`, error, { dealId, lpActorId });
    throw error;
  }
}

/**
 * Verify LP has access to a deal
 * @param {Object} authUser - Authenticated user
 * @param {string} dealId - Deal ID
 * @returns {Promise<Object|null>} LP Actor if access granted, null otherwise
 */
export async function requireLPDealAccess(authUser, dealId) {
  log(`Verifying LP access`, { userId: authUser?.id, dealId });

  if (!authUser) {
    log(`Access denied - no auth user`);
    return null;
  }

  if (authUser.role !== 'LP') {
    log(`Access denied - not LP role`, { role: authUser.role });
    return null;
  }

  const prisma = getPrisma();

  const lpActor = await prisma.lPActor.findFirst({
    where: {
      dealId,
      OR: [
        { authUserId: authUser.id },
        { email: authUser.email?.toLowerCase() }
      ],
      status: 'ACTIVE'
    },
    include: {
      shareClass: true
    }
  });

  if (!lpActor) {
    log(`Access denied - no LP actor found`, { userId: authUser.id, dealId });
    return null;
  }

  log(`Access granted`, { lpActorId: lpActor.id, entityName: lpActor.entityName });
  return lpActor;
}

// Named exports for direct import
export {
  calculateCapitalCallSummary,
  calculateDistributionSummary,
  calculatePerformance
};

export default {
  buildLPStatement,
  requireLPDealAccess,
  calculateCapitalCallSummary,
  calculateDistributionSummary,
  calculatePerformance
};
