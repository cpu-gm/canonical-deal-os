/**
 * Waterfall Calculator Service
 *
 * Calculates LP/GP equity distributions following institutional waterfall structures:
 * - Preferred return (hurdle rate)
 * - Multi-tier promotes (e.g., 80/20 up to 12% IRR, then 70/30)
 * - GP catch-up provisions
 * - Lookback calculations (optional)
 * - Per-class waterfall calculations (different terms per share class)
 */

import { calculateIRR } from './underwriting-calculator.js';

// ============================================================================
// LOGGING UTILITIES
// ============================================================================
const LOG_PREFIX = "[Waterfall]";

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
  if (process.env.DEBUG_WATERFALL === 'true') {
    const timestamp = new Date().toISOString();
    console.log(`${timestamp} ${LOG_PREFIX} DEBUG: ${message}`, JSON.stringify(data, null, 0));
  }
}

function logWarn(message, data = {}) {
  const timestamp = new Date().toISOString();
  console.warn(`${timestamp} ${LOG_PREFIX} WARN: ${message}`, JSON.stringify(data, null, 0));
}

// ============================================================================
// PER-CLASS WATERFALL HELPER FUNCTIONS
// ============================================================================

/**
 * Group LP ownership data by share class priority.
 *
 * Used for per-class waterfall calculations to process classes in priority order.
 * Classes with lower priority numbers are processed first (1 = highest priority).
 *
 * @param {Array<Object>} lpOwnership - Array of LP data with shareClass info
 *   Each LP: { lpActorId, entityName, ownershipPct, commitment, capitalContributed, shareClass: { id, code, name, preferredReturn, priority } }
 * @returns {Map<number, Object>} Map keyed by priority:
 *   { class: ShareClass, lps: LPActor[], totalCapital: number, totalOwnership: number }
 */
export function groupLPsByClassPriority(lpOwnership) {
  log(`Grouping LPs by class priority`, { lpCount: lpOwnership?.length || 0 });

  const classMap = new Map();

  for (const lp of (lpOwnership || [])) {
    // Handle LPs without share class (assign priority 999 = lowest)
    const priority = lp.shareClass?.priority ?? 999;
    const classCode = lp.shareClass?.code || 'NONE';
    const classData = lp.shareClass || {
      id: null,
      code: 'NONE',
      name: 'No Class',
      preferredReturn: null,
      managementFee: null,
      carryPercent: null,
      priority: 999
    };

    if (!classMap.has(priority)) {
      classMap.set(priority, {
        class: classData,
        lps: [],
        totalCapital: 0,
        totalOwnership: 0
      });
    }

    const group = classMap.get(priority);
    group.lps.push(lp);
    group.totalCapital += lp.commitment || 0;
    group.totalOwnership += lp.ownershipPct || 0;
  }

  // Log breakdown
  const breakdown = {};
  for (const [priority, data] of classMap) {
    breakdown[data.class.code] = {
      priority,
      lpCount: data.lps.length,
      totalCapital: data.totalCapital,
      totalOwnership: data.totalOwnership,
      preferredReturn: data.class.preferredReturn
    };
  }
  log(`Classes grouped by priority`, { classCount: classMap.size, breakdown });

  return classMap;
}

/**
 * Calculate preferred return owed for a single class over a period.
 *
 * Preferred return is calculated as: capital × rate × time
 * Supports cumulative preferred (accrues year over year).
 *
 * @param {Object} classConfig - Share class configuration
 * @param {number} classConfig.preferredReturn - Pref rate (e.g., 0.08 for 8%)
 * @param {number} capitalContributed - Capital contributed by this class
 * @param {number} capitalReturned - Capital already returned to this class
 * @param {number} yearCount - Number of years since investment
 * @param {number} prefAlreadyPaid - Preferred return already paid
 * @returns {Object} { accrued: number, paid: number, owed: number }
 */
export function calculateClassPreferred(classConfig, capitalContributed, capitalReturned, yearCount, prefAlreadyPaid = 0) {
  const prefRate = classConfig?.preferredReturn || 0;

  // Pref accrues on unreturned capital
  const unreturnedCapital = Math.max(0, capitalContributed - capitalReturned);
  const accrued = unreturnedCapital * prefRate * yearCount;
  const owed = Math.max(0, accrued - prefAlreadyPaid);

  logDebug(`Class preferred calculated`, {
    classCode: classConfig?.code || 'NONE',
    prefRate,
    unreturnedCapital,
    yearCount,
    accrued,
    prefAlreadyPaid,
    owed
  });

  return { accrued, paid: prefAlreadyPaid, owed };
}

/**
 * Allocate an amount to LPs within a class on a pari passu (pro-rata) basis.
 *
 * Each LP receives: amount × (lpOwnership / totalClassOwnership)
 * Handles rounding by allocating remainder to largest holder.
 *
 * @param {Array<Object>} lps - LPs in this class with ownershipPct
 * @param {number} totalAmount - Total amount to allocate
 * @param {number} totalClassOwnership - Total ownership in this class (for pro-rata calc)
 * @returns {Map<string, number>} Map of lpActorId → allocated amount
 */
export function allocateWithinClass(lps, totalAmount, totalClassOwnership) {
  const allocations = new Map();

  if (!lps || lps.length === 0 || totalAmount <= 0) {
    return allocations;
  }

  // If no ownership data, split evenly
  if (totalClassOwnership <= 0) {
    const evenSplit = totalAmount / lps.length;
    for (const lp of lps) {
      allocations.set(lp.lpActorId, evenSplit);
    }
    logDebug(`Allocated evenly (no ownership data)`, {
      lpCount: lps.length,
      perLP: evenSplit
    });
    return allocations;
  }

  // Pro-rata allocation based on ownership
  let allocated = 0;
  let largestLpId = null;
  let largestAllocation = 0;

  for (const lp of lps) {
    const share = (lp.ownershipPct || 0) / totalClassOwnership;
    const lpAmount = Math.round(totalAmount * share * 100) / 100; // Round to cents
    allocations.set(lp.lpActorId, lpAmount);
    allocated += lpAmount;

    if (lpAmount > largestAllocation) {
      largestAllocation = lpAmount;
      largestLpId = lp.lpActorId;
    }
  }

  // Handle rounding difference (allocate to largest holder)
  const roundingDiff = Math.round((totalAmount - allocated) * 100) / 100;
  if (Math.abs(roundingDiff) > 0 && largestLpId) {
    allocations.set(largestLpId, allocations.get(largestLpId) + roundingDiff);
    logDebug(`Rounding adjustment applied`, {
      diff: roundingDiff,
      adjustedLpId: largestLpId
    });
  }

  logDebug(`Allocated within class`, {
    lpCount: lps.length,
    totalAmount,
    allocations: Object.fromEntries(allocations)
  });

  return allocations;
}

/**
 * Get sorted class priorities (ascending - 1 first, then 2, etc.)
 *
 * @param {Map<number, Object>} classMap - Map from groupLPsByClassPriority
 * @returns {Array<[number, Object]>} Sorted array of [priority, classData]
 */
export function getSortedClassPriorities(classMap) {
  const sorted = [...classMap.entries()].sort((a, b) => a[0] - b[0]);
  logDebug(`Sorted class priorities`, {
    order: sorted.map(([p, d]) => `${d.class.code}(p=${p})`)
  });
  return sorted;
}

/**
 * Get effective preferred return for a class.
 * Falls back to deal-level pref if class doesn't have one.
 *
 * @param {Object} classConfig - Share class with preferredReturn
 * @param {number} dealLevelPref - Deal-level preferred return fallback
 * @returns {number} Effective preferred return rate
 */
export function getEffectivePreferredReturn(classConfig, dealLevelPref) {
  const classPref = classConfig?.preferredReturn;
  const effective = (classPref !== null && classPref !== undefined) ? classPref : dealLevelPref;

  logDebug(`Effective pref return`, {
    classCode: classConfig?.code || 'NONE',
    classPref,
    dealLevelPref,
    effective
  });

  return effective;
}

/**
 * Calculate waterfall distribution with per-class terms.
 *
 * Processes classes in priority order (1 = first), applying each class's
 * specific preferredReturn. Within a class, distributions are pari passu (pro-rata).
 *
 * Algorithm:
 * 1. Sort classes by priority (ascending)
 * 2. For each year's cash flow:
 *    a. Return of Capital phase: Pay each class's capital in priority order
 *    b. Preferred Return phase: Pay each class's pref (using class-specific rate) in priority order
 *    c. GP Catch-up phase: After ALL classes' pref paid
 *    d. Promote phase: Distribute based on IRR tier (deal-wide tiers)
 *
 * @param {Array<number>} cashFlows - Array of cash flows by year
 * @param {Object} structure - Deal-level waterfall structure
 * @param {Map<number, Object>} perClassConfig - Map from groupLPsByClassPriority
 * @returns {Object} Waterfall distribution results with per-class breakdown
 */
function calculatePerClassWaterfall(cashFlows, structure, perClassConfig) {
  const {
    lpEquity,
    gpEquity,
    preferredReturn: dealLevelPref,
    promoteTiers,
    gpCatchUp,
    catchUpPercent = 1.0,
    lookback = false
  } = structure;

  log(`calculatePerClassWaterfall starting`, {
    cashFlowCount: cashFlows.length,
    classCount: perClassConfig.size || Object.keys(perClassConfig).length,
    lpEquity,
    gpEquity,
    dealLevelPref,
    gpCatchUp
  });

  // Convert Map to sorted array by priority (ascending)
  const sortedClasses = getSortedClassPriorities(perClassConfig);

  // Calculate total LP capital from all classes
  const totalLPCapital = sortedClasses.reduce((sum, [_, data]) => sum + data.totalCapital, 0);
  const totalEquity = lpEquity + gpEquity;

  log(`Per-class capital breakdown`, {
    totalLPCapital,
    lpEquityFromStructure: lpEquity,
    gpEquity,
    totalEquity,
    classBreakdown: sortedClasses.map(([p, d]) => ({
      priority: p,
      code: d.class.code,
      capital: d.totalCapital,
      prefRate: d.class.preferredReturn ?? dealLevelPref
    }))
  });

  // Use the larger of totalLPCapital or lpEquity (for consistency)
  const effectiveLPCapital = Math.max(totalLPCapital, lpEquity) || lpEquity;

  // Parse promote tiers if string
  let tiers = promoteTiers;
  if (typeof tiers === 'string') {
    try {
      tiers = JSON.parse(tiers);
    } catch (e) {
      logWarn(`Failed to parse promote tiers, using defaults`, { error: e.message });
      tiers = DEFAULT_WATERFALL_STRUCTURE.promoteTiers;
    }
  }

  // Initialize per-class tracking state
  const classState = new Map();
  for (const [priority, data] of sortedClasses) {
    const effectivePref = getEffectivePreferredReturn(data.class, dealLevelPref);
    classState.set(priority, {
      classCode: data.class.code,
      className: data.class.name,
      priority,
      capital: data.totalCapital,
      ownership: data.totalOwnership,
      lps: data.lps,
      effectivePref,
      capitalReturned: 0,
      prefAccrued: 0,
      prefPaid: 0,
      totalDistributed: 0
    });
    logDebug(`Initialized class state`, {
      priority,
      code: data.class.code,
      capital: data.totalCapital,
      effectivePref
    });
  }

  // Track GP state
  let gpCapitalReturned = 0;
  let gpCatchUpPaid = 0;
  let catchUpComplete = false;

  // Track overall LP state for IRR calculation
  const lpCashFlows = [-effectiveLPCapital]; // Initial investment
  const gpCashFlows = [-gpEquity];

  // Per-LP allocations for each year
  const yearlyDistributions = [];
  const byClassDistributions = []; // Detailed per-class breakdown

  // Process each year's cash flow
  for (let year = 0; year < cashFlows.length; year++) {
    let remaining = cashFlows[year];
    let totalLpShare = 0;
    let gpShare = 0;
    const yearClassAlloc = new Map(); // Track this year's per-class distributions

    log(`Year ${year + 1} starting`, { cashFlow: remaining });

    // Initialize year's per-class tracking
    for (const [priority] of sortedClasses) {
      yearClassAlloc.set(priority, {
        capitalReturn: 0,
        prefReturn: 0,
        promote: 0,
        total: 0
      });
    }

    // Accrue preferred return for each class (on unreturned capital)
    for (const [priority, state] of classState) {
      const unreturnedCapital = Math.max(0, state.capital - state.capitalReturned);
      const yearPref = unreturnedCapital * state.effectivePref;
      state.prefAccrued += yearPref;

      logDebug(`Year ${year + 1} pref accrual for ${state.classCode}`, {
        unreturnedCapital,
        prefRate: state.effectivePref,
        yearPref,
        totalPrefAccrued: state.prefAccrued
      });
    }

    // ========================================================================
    // PHASE 1: RETURN OF CAPITAL (by class priority)
    // ========================================================================
    if (remaining > 0) {
      log(`Year ${year + 1} ROC phase starting`, { remaining });

      for (const [priority, state] of classState) {
        if (remaining <= 0) break;

        const capitalNeeded = Math.max(0, state.capital - state.capitalReturned);
        if (capitalNeeded > 0) {
          const capitalReturn = Math.min(remaining, capitalNeeded);
          state.capitalReturned += capitalReturn;
          state.totalDistributed += capitalReturn;
          totalLpShare += capitalReturn;
          remaining -= capitalReturn;

          yearClassAlloc.get(priority).capitalReturn = capitalReturn;
          yearClassAlloc.get(priority).total += capitalReturn;

          logDebug(`Year ${year + 1} ROC: ${state.classCode}`, {
            priority,
            capitalNeeded,
            capitalReturn,
            capitalReturned: state.capitalReturned,
            remaining
          });
        }
      }

      // GP capital return (proportional to GP equity)
      if (remaining > 0 && gpCapitalReturned < gpEquity) {
        const gpCapitalNeeded = Math.max(0, gpEquity - gpCapitalReturned);
        const gpCapitalReturn = Math.min(remaining, gpCapitalNeeded);
        gpCapitalReturned += gpCapitalReturn;
        gpShare += gpCapitalReturn;
        remaining -= gpCapitalReturn;

        logDebug(`Year ${year + 1} ROC: GP`, {
          gpCapitalNeeded,
          gpCapitalReturn,
          gpCapitalReturned,
          remaining
        });
      }
    }

    // ========================================================================
    // PHASE 2: PREFERRED RETURN (by class priority, using class-specific rates)
    // ========================================================================
    if (remaining > 0) {
      log(`Year ${year + 1} PREF phase starting`, { remaining });

      for (const [priority, state] of classState) {
        if (remaining <= 0) break;

        const prefOwed = Math.max(0, state.prefAccrued - state.prefPaid);
        if (prefOwed > 0) {
          const prefPayment = Math.min(remaining, prefOwed);
          state.prefPaid += prefPayment;
          state.totalDistributed += prefPayment;
          totalLpShare += prefPayment;
          remaining -= prefPayment;

          yearClassAlloc.get(priority).prefReturn = prefPayment;
          yearClassAlloc.get(priority).total += prefPayment;

          logDebug(`Year ${year + 1} PREF: ${state.classCode}`, {
            priority,
            prefRate: state.effectivePref,
            prefOwed,
            prefPayment,
            prefPaid: state.prefPaid,
            remaining
          });
        }
      }
    }

    // ========================================================================
    // PHASE 3: GP CATCH-UP (only after ALL classes' pref is fully paid)
    // ========================================================================
    if (gpCatchUp && remaining > 0 && !catchUpComplete) {
      // Check if ALL classes have received their full pref
      let allPrefPaid = true;
      for (const [, state] of classState) {
        if (state.prefPaid < state.prefAccrued) {
          allPrefPaid = false;
          break;
        }
      }

      if (allPrefPaid) {
        log(`Year ${year + 1} GP CATCH-UP phase`, { remaining, allPrefPaid });

        // GP catch-up: GP receives 100% (or catchUpPercent) until they've "caught up"
        // to their target share of total distributions
        const firstTier = tiers[0] || { gpSplit: 0.20 };
        const targetGpPercent = firstTier.gpSplit;

        // Total LP distributions so far (including this year)
        const totalLPDistributed = Array.from(classState.values())
          .reduce((sum, s) => sum + s.totalDistributed, 0);

        // GP needs enough so that: gpShare / (lpShare + gpShare) = targetGpPercent
        // gpShare = targetGpPercent * (totalDistributed) / (1 - targetGpPercent)
        const targetGpTotal = (totalLPDistributed * targetGpPercent) / (1 - targetGpPercent);
        const gpNeedsCatchUp = Math.max(0, targetGpTotal - gpShare - gpCatchUpPaid);

        if (gpNeedsCatchUp > 0) {
          const catchUpPayment = Math.min(remaining, gpNeedsCatchUp * catchUpPercent);
          gpShare += catchUpPayment;
          gpCatchUpPaid += catchUpPayment;
          remaining -= catchUpPayment;

          logDebug(`Year ${year + 1} GP Catch-up`, {
            targetGpPercent,
            totalLPDistributed,
            targetGpTotal,
            gpNeedsCatchUp,
            catchUpPayment,
            gpCatchUpPaid,
            remaining
          });

          if (gpCatchUpPaid >= gpNeedsCatchUp * 0.99) { // Allow small tolerance
            catchUpComplete = true;
            log(`Year ${year + 1} GP Catch-up complete`, { gpCatchUpPaid });
          }
        } else {
          catchUpComplete = true;
        }
      }
    }

    // ========================================================================
    // PHASE 4: PROMOTE (based on IRR tier, distributed per deal-level structure)
    // ========================================================================
    if (remaining > 0) {
      // Calculate current IRR to determine which tier
      const tempLpCashFlows = [...lpCashFlows, totalLpShare + remaining * 0.5]; // Estimate
      const currentIRR = calculateIRR(tempLpCashFlows);

      // Find applicable tier (handle empty tiers array)
      let applicableTier = tiers && tiers.length > 0
        ? tiers[tiers.length - 1]
        : { hurdle: Infinity, lpSplit: 0.80, gpSplit: 0.20 }; // Default tier if none defined
      for (const tier of (tiers || [])) {
        if (currentIRR <= tier.hurdle) {
          applicableTier = tier;
          break;
        }
      }

      log(`Year ${year + 1} PROMOTE phase`, {
        currentIRR: (currentIRR * 100).toFixed(2) + '%',
        applicableTierHurdle: applicableTier.hurdle === Infinity ? 'Infinity' : applicableTier.hurdle,
        lpSplit: applicableTier.lpSplit,
        gpSplit: applicableTier.gpSplit,
        remaining
      });

      // Distribute promote: LP portion goes pro-rata to all classes based on ownership
      const lpPromote = remaining * applicableTier.lpSplit;
      const gpPromote = remaining * applicableTier.gpSplit;

      // Distribute LP promote pro-rata across classes based on ownership
      const totalOwnership = Array.from(classState.values())
        .reduce((sum, s) => sum + s.ownership, 0);

      for (const [priority, state] of classState) {
        const classShare = totalOwnership > 0
          ? (state.ownership / totalOwnership) * lpPromote
          : lpPromote / classState.size;

        state.totalDistributed += classShare;
        yearClassAlloc.get(priority).promote = classShare;
        yearClassAlloc.get(priority).total += classShare;
      }

      totalLpShare += lpPromote;
      gpShare += gpPromote;
      remaining = 0;

      logDebug(`Year ${year + 1} Promote distributed`, {
        lpPromote,
        gpPromote,
        byClass: Array.from(yearClassAlloc.entries()).map(([p, a]) => ({
          priority: p,
          promote: a.promote
        }))
      });
    }

    // Record year's distributions
    const yearData = {
      year: year + 1,
      cashFlow: cashFlows[year],
      lpShare: totalLpShare,
      gpShare,
      byClass: Object.fromEntries(
        Array.from(yearClassAlloc.entries()).map(([priority, alloc]) => {
          const state = classState.get(priority);
          return [state.classCode, {
            priority,
            capitalReturn: alloc.capitalReturn,
            prefReturn: alloc.prefReturn,
            promote: alloc.promote,
            total: alloc.total
          }];
        })
      )
    };

    yearlyDistributions.push(yearData);
    byClassDistributions.push(yearData.byClass);

    log(`Year ${year + 1} complete`, {
      lpShare: totalLpShare,
      gpShare,
      byClass: Object.entries(yearData.byClass).map(([code, data]) =>
        `${code}: $${data.total.toFixed(0)}`
      ).join(', ')
    });

    // Track for IRR calculation
    lpCashFlows.push(totalLpShare);
    gpCashFlows.push(gpShare);
  }

  // ========================================================================
  // CALCULATE FINAL METRICS
  // ========================================================================

  // Total returns
  const lpTotalReturn = yearlyDistributions.reduce((sum, d) => sum + d.lpShare, 0);
  const gpTotalReturn = yearlyDistributions.reduce((sum, d) => sum + d.gpShare, 0);

  // IRRs
  const lpIRR = calculateIRR(lpCashFlows);
  const gpIRR = calculateIRR(gpCashFlows);

  // Equity multiples
  const lpEquityMultiple = effectiveLPCapital > 0 ? lpTotalReturn / effectiveLPCapital : 0;
  const gpEquityMultiple = gpEquity > 0 ? gpTotalReturn / gpEquity : 0;

  // Promote (GP profit above pro-rata)
  const gpProRataShare = gpEquity > 0
    ? (gpEquity / totalEquity) * (lpTotalReturn + gpTotalReturn)
    : 0;
  const totalPromote = Math.max(0, gpTotalReturn - gpProRataShare);

  // Per-class summary
  const classSummary = {};
  for (const [, state] of classState) {
    classSummary[state.classCode] = {
      className: state.className,
      priority: state.priority,
      capital: state.capital,
      effectivePref: state.effectivePref,
      capitalReturned: state.capitalReturned,
      prefPaid: state.prefPaid,
      totalDistributed: state.totalDistributed,
      equityMultiple: state.capital > 0 ? state.totalDistributed / state.capital : 0
    };
  }

  // Lookback provision check
  let lookbackAdjustment = null;
  if (lookback && lpIRR < dealLevelPref) {
    const lpShortfall = effectiveLPCapital * dealLevelPref * cashFlows.length
      - Array.from(classState.values()).reduce((sum, s) => sum + s.prefPaid, 0);
    if (lpShortfall > 0) {
      lookbackAdjustment = {
        lpShortfall,
        clawbackFromGp: Math.min(lpShortfall, totalPromote),
        adjustedLpReturn: lpTotalReturn + Math.min(lpShortfall, totalPromote),
        adjustedGpReturn: gpTotalReturn - Math.min(lpShortfall, totalPromote)
      };
      log(`Lookback adjustment applied`, lookbackAdjustment);
    }
  }

  log(`Per-class waterfall calculation complete`, {
    lpTotalReturn,
    gpTotalReturn,
    lpIRR: (lpIRR * 100).toFixed(2) + '%',
    gpIRR: (gpIRR * 100).toFixed(2) + '%',
    lpEquityMultiple: lpEquityMultiple.toFixed(2) + 'x',
    gpEquityMultiple: gpEquity > 0 ? gpEquityMultiple.toFixed(2) + 'x' : 'N/A',
    totalPromote,
    gpCatchUpPaid,
    classSummary
  });

  return {
    yearlyDistributions,
    summary: {
      lpIRR,
      gpIRR,
      lpEquityMultiple,
      gpEquityMultiple,
      lpTotalReturn,
      gpTotalReturn,
      totalPromote,
      lpCapitalReturned: Array.from(classState.values()).reduce((sum, s) => sum + s.capitalReturned, 0),
      gpCapitalReturned,
      lpPrefPaid: Array.from(classState.values()).reduce((sum, s) => sum + s.prefPaid, 0),
      gpCatchUpPaid
    },
    byClass: classSummary,
    structure: {
      lpEquity: effectiveLPCapital,
      gpEquity,
      preferredReturn: dealLevelPref,
      promoteTiers: tiers,
      gpCatchUp,
      catchUpPercent,
      lookback,
      perClassTerms: Object.fromEntries(
        Array.from(classState.entries()).map(([priority, state]) => [
          state.classCode,
          { preferredReturn: state.effectivePref, priority }
        ])
      )
    },
    lookbackAdjustment
  };
}

/**
 * Default waterfall structure if none provided
 * Updated with 2025 industry standards based on institutional research
 */
export const DEFAULT_WATERFALL_STRUCTURE = {
  lpEquity: 0,
  gpEquity: 0,
  preferredReturn: 0.08, // 8% pref (most common at 40% of deals)
  promoteTiers: [
    { hurdle: 0.12, lpSplit: 0.80, gpSplit: 0.20 },  // Up to 12% IRR: 80/20
    { hurdle: 0.15, lpSplit: 0.70, gpSplit: 0.30 },  // 12-15% IRR: 70/30
    { hurdle: 0.20, lpSplit: 0.60, gpSplit: 0.40 },  // 15-20% IRR: 60/40
    { hurdle: Infinity, lpSplit: 0.50, gpSplit: 0.50 } // Above 20%: 50/50
  ],
  gpCatchUp: true,
  catchUpPercent: 1.0, // 100% to GP during catch-up
  lookback: false
};

/**
 * Industry-standard waterfall templates by strategy type
 * Based on 2025 market research: 8% pref in 40% of deals, 10% pref in 30%
 */
export const WATERFALL_TEMPLATES = {
  // Core: Low-risk, stable cash flow
  CORE: {
    name: 'Core',
    description: '6% pref, minimal promote - for stabilized, low-risk assets',
    preferredReturn: 0.06,
    gpCatchUp: false,
    catchUpPercent: 0,
    promoteTiers: [
      { hurdle: 0.06, lpSplit: 0.95, gpSplit: 0.05 },
      { hurdle: 0.08, lpSplit: 0.90, gpSplit: 0.10 },
      { hurdle: Infinity, lpSplit: 0.85, gpSplit: 0.15 }
    ],
    typicalGPCoInvest: 0.05, // 5% GP co-invest
    targetReturns: { irr: '6-8%', equity: '1.2-1.4x' }
  },

  // Core Plus: Modest value-add opportunity
  CORE_PLUS: {
    name: 'Core Plus',
    description: '7% pref, moderate promote - for stable assets with upside',
    preferredReturn: 0.07,
    gpCatchUp: true,
    catchUpPercent: 0.5, // 50/50 catch-up
    promoteTiers: [
      { hurdle: 0.10, lpSplit: 0.85, gpSplit: 0.15 },
      { hurdle: 0.12, lpSplit: 0.80, gpSplit: 0.20 },
      { hurdle: Infinity, lpSplit: 0.75, gpSplit: 0.25 }
    ],
    typicalGPCoInvest: 0.05,
    targetReturns: { irr: '9-12%', equity: '1.3-1.5x' }
  },

  // Value Add: Renovation, repositioning, lease-up
  VALUE_ADD: {
    name: 'Value Add',
    description: '8% pref, standard 80/20 promote - for repositioning opportunities',
    preferredReturn: 0.08,
    gpCatchUp: true,
    catchUpPercent: 1.0, // 100% catch-up
    promoteTiers: [
      { hurdle: 0.12, lpSplit: 0.80, gpSplit: 0.20 },
      { hurdle: 0.15, lpSplit: 0.70, gpSplit: 0.30 },
      { hurdle: 0.18, lpSplit: 0.65, gpSplit: 0.35 },
      { hurdle: Infinity, lpSplit: 0.50, gpSplit: 0.50 }
    ],
    typicalGPCoInvest: 0.10,
    targetReturns: { irr: '13-18%', equity: '1.5-2.0x' }
  },

  // Opportunistic: Ground-up development, distressed
  OPPORTUNISTIC: {
    name: 'Opportunistic',
    description: '10% pref, aggressive promote - for development and distressed',
    preferredReturn: 0.10,
    gpCatchUp: true,
    catchUpPercent: 1.0,
    promoteTiers: [
      { hurdle: 0.15, lpSplit: 0.80, gpSplit: 0.20 },
      { hurdle: 0.20, lpSplit: 0.70, gpSplit: 0.30 },
      { hurdle: 0.25, lpSplit: 0.60, gpSplit: 0.40 },
      { hurdle: Infinity, lpSplit: 0.50, gpSplit: 0.50 }
    ],
    typicalGPCoInvest: 0.10,
    targetReturns: { irr: '18-25%+', equity: '2.0x+' }
  },

  // Equity Multiple Based (common for development)
  EQUITY_MULTIPLE: {
    name: 'Equity Multiple Based',
    description: 'Hurdles based on equity multiples instead of IRR',
    preferredReturn: 0.08,
    gpCatchUp: true,
    catchUpPercent: 1.0,
    hurdleType: 'EQUITY_MULTIPLE',
    promoteTiers: [
      { hurdle: 1.25, lpSplit: 0.90, gpSplit: 0.10, description: 'Up to 1.25x' },
      { hurdle: 1.50, lpSplit: 0.80, gpSplit: 0.20, description: '1.25x to 1.5x' },
      { hurdle: 2.00, lpSplit: 0.70, gpSplit: 0.30, description: '1.5x to 2.0x' },
      { hurdle: 2.50, lpSplit: 0.60, gpSplit: 0.40, description: '2.0x to 2.5x' },
      { hurdle: Infinity, lpSplit: 0.50, gpSplit: 0.50, description: 'Above 2.5x' }
    ],
    typicalGPCoInvest: 0.10,
    targetReturns: { equity: '1.7-2.5x' }
  },

  // High Net Worth / Family Office (simpler structure)
  FAMILY_OFFICE: {
    name: 'Family Office / HNW',
    description: 'Simpler 8% pref, single promote tier',
    preferredReturn: 0.08,
    gpCatchUp: true,
    catchUpPercent: 1.0,
    promoteTiers: [
      { hurdle: Infinity, lpSplit: 0.70, gpSplit: 0.30 } // Flat 70/30 after pref
    ],
    typicalGPCoInvest: 0.10,
    targetReturns: { irr: '12-16%', equity: '1.5-1.8x' }
  },

  // JV with Operating Partner
  JOINT_VENTURE: {
    name: 'Joint Venture (with Operator)',
    description: 'Partnership JV - promote to operating partner',
    preferredReturn: 0.08,
    gpCatchUp: true,
    catchUpPercent: 1.0,
    promoteTiers: [
      { hurdle: 0.08, lpSplit: 0.90, gpSplit: 0.10 },  // Pref tier
      { hurdle: 0.12, lpSplit: 0.80, gpSplit: 0.20 },
      { hurdle: 0.15, lpSplit: 0.70, gpSplit: 0.30 },
      { hurdle: Infinity, lpSplit: 0.60, gpSplit: 0.40 }
    ],
    typicalGPCoInvest: 0.05,
    targetReturns: { irr: '12-18%', equity: '1.6-2.2x' }
  },

  // REIT/Institutional Platform Deal
  INSTITUTIONAL: {
    name: 'Institutional Platform',
    description: 'Large institutional LP terms - lower promotes',
    preferredReturn: 0.07,
    gpCatchUp: true,
    catchUpPercent: 0.5,
    promoteTiers: [
      { hurdle: 0.10, lpSplit: 0.88, gpSplit: 0.12 },
      { hurdle: 0.13, lpSplit: 0.82, gpSplit: 0.18 },
      { hurdle: 0.16, lpSplit: 0.78, gpSplit: 0.22 },
      { hurdle: Infinity, lpSplit: 0.75, gpSplit: 0.25 }
    ],
    typicalGPCoInvest: 0.02,
    targetReturns: { irr: '10-14%', equity: '1.4-1.7x' }
  }
};

/**
 * Calculate full waterfall distribution from cash flows
 *
 * @param {Object} params
 * @param {Array<number>} params.cashFlows - Array of cash flows by year (including exit)
 * @param {Object} params.structure - Waterfall structure definition
 * @param {number} params.structure.lpEquity - Total LP investment
 * @param {number} params.structure.gpEquity - GP co-invest
 * @param {number} params.structure.preferredReturn - Preferred return rate (e.g., 0.08 for 8%)
 * @param {Array<Object>} params.structure.promoteTiers - Array of promote tiers
 * @param {boolean} params.structure.gpCatchUp - Whether GP catches up after pref
 * @param {number} params.structure.catchUpPercent - Percentage to GP during catch-up
 * @param {boolean} params.structure.lookback - Whether to apply lookback provision
 * @returns {Object} Waterfall distribution results
 */
export function calculateWaterfall(cashFlows, structure, options = {}) {
  const {
    lpEquity,
    gpEquity,
    preferredReturn,
    promoteTiers,
    gpCatchUp,
    catchUpPercent = 1.0,
    lookback = false
  } = structure;

  // Log entry point
  log(`calculateWaterfall called`, {
    cashFlowCount: cashFlows?.length || 0,
    lpEquity,
    gpEquity,
    preferredReturn,
    gpCatchUp,
    catchUpPercent,
    lookback,
    useClassTerms: options?.useClassTerms || false,
    hasPerClassConfig: !!options?.perClassConfig
  });

  // Validate inputs
  if (!lpEquity || lpEquity <= 0) {
    logError(`Validation failed`, null, { reason: 'LP equity must be greater than 0', lpEquity });
    return { error: 'LP equity must be greater than 0' };
  }
  if (!Array.isArray(cashFlows) || cashFlows.length === 0) {
    logError(`Validation failed`, null, { reason: 'Cash flows must be a non-empty array', cashFlows });
    return { error: 'Cash flows must be a non-empty array' };
  }

  const totalEquity = lpEquity + gpEquity;
  const lpOwnership = lpEquity / totalEquity;
  const gpOwnership = gpEquity / totalEquity;

  logDebug(`Equity calculated`, { totalEquity, lpOwnership, gpOwnership });

  // ==========================================================================
  // PER-CLASS WATERFALL ROUTING
  // If useClassTerms is enabled and perClassConfig is provided, use per-class logic
  // Otherwise, fall through to standard calculation (backward compatible)
  // ==========================================================================
  if (options.useClassTerms && options.perClassConfig) {
    log(`Routing to per-class waterfall calculation`, {
      classCount: options.perClassConfig.size || Object.keys(options.perClassConfig).length,
      useClassTerms: true
    });
    return calculatePerClassWaterfall(cashFlows, structure, options.perClassConfig);
  }

  // ==========================================================================
  // STANDARD WATERFALL CALCULATION (existing logic - unchanged)
  // ==========================================================================

  // Parse promote tiers if string
  let tiers = promoteTiers;
  if (typeof tiers === 'string') {
    try {
      tiers = JSON.parse(tiers);
      logDebug(`Promote tiers parsed from string`, { tierCount: tiers.length });
    } catch (e) {
      logWarn(`Failed to parse promote tiers, using defaults`, { error: e.message });
      tiers = DEFAULT_WATERFALL_STRUCTURE.promoteTiers;
    }
  }

  // Track cumulative state
  let lpCapitalReturned = 0;
  let gpCapitalReturned = 0;
  let lpPrefPaid = 0;
  let lpPrefAccrued = 0;
  let gpCatchUpPaid = 0;
  let inCatchUp = false;
  let catchUpComplete = false;

  const yearlyDistributions = [];
  const lpCashFlows = [-lpEquity]; // Initial investment (negative)
  const gpCashFlows = [-gpEquity]; // Initial investment (negative)

  // Process each year's cash flow
  logDebug(`Starting yearly distribution loop`, { years: cashFlows.length });

  for (let year = 0; year < cashFlows.length; year++) {
    let remaining = cashFlows[year];
    let lpShare = 0;
    let gpShare = 0;

    logDebug(`Year ${year + 1} starting`, { cashFlow: cashFlows[year], remaining });

    // Accrue pref for this year
    const lpUnreturnedCapital = Math.max(0, lpEquity - lpCapitalReturned);
    lpPrefAccrued += lpUnreturnedCapital * preferredReturn;

    // Step 1: Return of capital (pari passu based on ownership)
    if (lpCapitalReturned < lpEquity || gpCapitalReturned < gpEquity) {
      const lpCapitalNeeded = Math.max(0, lpEquity - lpCapitalReturned);
      const gpCapitalNeeded = Math.max(0, gpEquity - gpCapitalReturned);
      const totalCapitalNeeded = lpCapitalNeeded + gpCapitalNeeded;

      if (totalCapitalNeeded > 0 && remaining > 0) {
        const capitalAvailable = Math.min(remaining, totalCapitalNeeded);
        const lpCapitalReturn = capitalAvailable * (lpCapitalNeeded / totalCapitalNeeded);
        const gpCapitalReturn = capitalAvailable * (gpCapitalNeeded / totalCapitalNeeded);

        lpShare += lpCapitalReturn;
        gpShare += gpCapitalReturn;
        lpCapitalReturned += lpCapitalReturn;
        gpCapitalReturned += gpCapitalReturn;
        remaining -= capitalAvailable;

        logDebug(`Year ${year + 1} ROC phase`, {
          lpCapitalReturn,
          gpCapitalReturn,
          lpCapitalReturned,
          gpCapitalReturned,
          remaining
        });
      }
    }

    // Step 2: Pay accrued preferred return to LP
    if (remaining > 0 && lpPrefAccrued > lpPrefPaid) {
      const prefOwed = lpPrefAccrued - lpPrefPaid;
      const prefPayment = Math.min(remaining, prefOwed);
      lpShare += prefPayment;
      lpPrefPaid += prefPayment;
      remaining -= prefPayment;

      logDebug(`Year ${year + 1} Pref phase`, {
        prefOwed,
        prefPayment,
        lpPrefPaid,
        lpPrefAccrued,
        remaining
      });
    }

    // Step 3: GP Catch-up (if enabled and pref has been fully paid)
    if (gpCatchUp && remaining > 0 && lpPrefPaid >= lpPrefAccrued && !catchUpComplete) {
      // GP needs to "catch up" to have received their proportional share of the pref
      // The catch-up continues until GP has received enough that the overall split
      // equals the first tier split
      const firstTier = tiers[0] || { lpSplit: 0.80, gpSplit: 0.20 };
      const targetGpPercent = firstTier.gpSplit;

      // Total distributions before catch-up
      const totalDistributed = lpShare + gpShare + lpPrefPaid;
      const targetGpAmount = (totalDistributed + remaining) * targetGpPercent;
      const gpNeedsCatchUp = targetGpAmount - gpShare;

      if (gpNeedsCatchUp > 0) {
        inCatchUp = true;
        const catchUpPayment = Math.min(remaining, gpNeedsCatchUp * catchUpPercent);
        gpShare += catchUpPayment;
        gpCatchUpPaid += catchUpPayment;
        remaining -= catchUpPayment;

        logDebug(`Year ${year + 1} GP Catch-up phase`, {
          targetGpPercent,
          gpNeedsCatchUp,
          catchUpPayment,
          gpCatchUpPaid,
          remaining
        });

        if (gpCatchUpPaid >= gpNeedsCatchUp) {
          catchUpComplete = true;
          inCatchUp = false;
          logDebug(`Year ${year + 1} GP Catch-up complete`, { gpCatchUpPaid });
        }
      } else {
        catchUpComplete = true;
      }
    }

    // Step 4: Promote tiers based on IRR hurdles
    if (remaining > 0) {
      // Calculate current IRR to determine which tier we're in
      const tempLpCashFlows = [...lpCashFlows, lpShare + remaining * lpOwnership];
      const currentIRR = calculateIRR(tempLpCashFlows);

      // Find the appropriate tier (handle empty tiers array)
      let applicableTier = tiers && tiers.length > 0
        ? tiers[tiers.length - 1]
        : { hurdle: Infinity, lpSplit: 0.80, gpSplit: 0.20 }; // Default tier if none defined
      for (const tier of (tiers || [])) {
        if (currentIRR <= tier.hurdle) {
          applicableTier = tier;
          break;
        }
      }

      logDebug(`Year ${year + 1} Promote phase`, {
        currentIRR,
        applicableTierHurdle: applicableTier.hurdle === Infinity ? 'Infinity' : applicableTier.hurdle,
        lpSplit: applicableTier.lpSplit,
        gpSplit: applicableTier.gpSplit,
        remaining
      });

      // Distribute remaining according to tier split
      lpShare += remaining * applicableTier.lpSplit;
      gpShare += remaining * applicableTier.gpSplit;
      remaining = 0;
    }

    // Record year's distributions
    yearlyDistributions.push({
      year: year + 1,
      cashFlow: cashFlows[year],
      lpShare,
      gpShare,
      lpCapitalReturned,
      gpCapitalReturned,
      lpPrefPaid,
      lpPrefAccrued,
      gpCatchUpPaid,
      inCatchUp,
      cumulativeLp: yearlyDistributions.reduce((sum, d) => sum + d.lpShare, 0) + lpShare,
      cumulativeGp: yearlyDistributions.reduce((sum, d) => sum + d.gpShare, 0) + gpShare
    });

    logDebug(`Year ${year + 1} complete`, {
      lpShare,
      gpShare,
      cumulativeLp: yearlyDistributions[yearlyDistributions.length - 1].cumulativeLp,
      cumulativeGp: yearlyDistributions[yearlyDistributions.length - 1].cumulativeGp
    });

    // Track cash flows for IRR calculation
    lpCashFlows.push(lpShare);
    gpCashFlows.push(gpShare);
  }

  // Calculate final metrics
  const lpTotalReturn = yearlyDistributions.reduce((sum, d) => sum + d.lpShare, 0);
  const gpTotalReturn = yearlyDistributions.reduce((sum, d) => sum + d.gpShare, 0);

  const lpIRR = calculateIRR(lpCashFlows);
  const gpIRR = calculateIRR(gpCashFlows);

  const lpEquityMultiple = lpEquity > 0 ? lpTotalReturn / lpEquity : 0;
  const gpEquityMultiple = gpEquity > 0 ? gpTotalReturn / gpEquity : 0;

  const totalPromote = gpTotalReturn - (gpEquity > 0 ?
    (gpEquity / totalEquity) * (lpTotalReturn + gpTotalReturn) : 0);

  // Lookback provision check
  let lookbackAdjustment = null;
  if (lookback && lpIRR < preferredReturn) {
    // LP didn't achieve their preferred return - calculate clawback
    const lpShortfall = lpEquity * preferredReturn * cashFlows.length - lpPrefPaid;
    if (lpShortfall > 0) {
      lookbackAdjustment = {
        lpShortfall,
        clawbackFromGp: Math.min(lpShortfall, totalPromote),
        adjustedLpReturn: lpTotalReturn + Math.min(lpShortfall, totalPromote),
        adjustedGpReturn: gpTotalReturn - Math.min(lpShortfall, totalPromote)
      };
      log(`Lookback adjustment applied`, {
        lpShortfall,
        clawbackFromGp: lookbackAdjustment.clawbackFromGp
      });
    }
  }

  // Log final summary
  log(`Waterfall calculation complete`, {
    lpTotalReturn,
    gpTotalReturn,
    lpIRR: (lpIRR * 100).toFixed(2) + '%',
    gpIRR: (gpIRR * 100).toFixed(2) + '%',
    lpEquityMultiple: lpEquityMultiple.toFixed(2) + 'x',
    gpEquityMultiple: gpEquity > 0 ? gpEquityMultiple.toFixed(2) + 'x' : 'N/A',
    totalPromote: Math.max(0, totalPromote),
    hasLookback: !!lookbackAdjustment
  });

  return {
    yearlyDistributions,
    summary: {
      lpIRR,
      gpIRR,
      lpEquityMultiple,
      gpEquityMultiple,
      lpTotalReturn,
      gpTotalReturn,
      totalPromote: Math.max(0, totalPromote),
      lpCapitalReturned,
      gpCapitalReturned,
      lpPrefPaid,
      gpCatchUpPaid
    },
    structure: {
      lpEquity,
      gpEquity,
      preferredReturn,
      promoteTiers: tiers,
      gpCatchUp,
      catchUpPercent,
      lookback
    },
    lookbackAdjustment
  };
}

/**
 * Create a default waterfall structure for a deal
 *
 * @param {number} totalEquity - Total equity investment
 * @param {number} gpCoInvestPercent - GP co-invest percentage (e.g., 0.10 for 10%)
 * @returns {Object} Waterfall structure
 */
export function createDefaultStructure(totalEquity, gpCoInvestPercent = 0.10) {
  const gpEquity = totalEquity * gpCoInvestPercent;
  const lpEquity = totalEquity - gpEquity;

  return {
    ...DEFAULT_WATERFALL_STRUCTURE,
    lpEquity,
    gpEquity
  };
}

/**
 * Format waterfall results for display
 *
 * @param {Object} results - Results from calculateWaterfall
 * @returns {Object} Formatted results for UI
 */
export function formatWaterfallForDisplay(results) {
  if (results.error) {
    return { error: results.error };
  }

  const { yearlyDistributions, summary, structure, lookbackAdjustment } = results;

  // Format yearly distributions
  const formattedDistributions = yearlyDistributions.map(d => ({
    year: d.year,
    cashFlow: d.cashFlow,
    lpShare: d.lpShare,
    gpShare: d.gpShare,
    lpPercent: d.cashFlow > 0 ? (d.lpShare / d.cashFlow * 100).toFixed(1) + '%' : '—',
    gpPercent: d.cashFlow > 0 ? (d.gpShare / d.cashFlow * 100).toFixed(1) + '%' : '—',
    cumulativeLp: d.cumulativeLp,
    cumulativeGp: d.cumulativeGp
  }));

  // Format summary
  const formattedSummary = {
    lpIRR: (summary.lpIRR * 100).toFixed(2) + '%',
    gpIRR: (summary.gpIRR * 100).toFixed(2) + '%',
    lpEquityMultiple: summary.lpEquityMultiple.toFixed(2) + 'x',
    gpEquityMultiple: summary.gpEquityMultiple.toFixed(2) + 'x',
    lpTotalReturn: formatCurrency(summary.lpTotalReturn),
    gpTotalReturn: formatCurrency(summary.gpTotalReturn),
    totalPromote: formatCurrency(summary.totalPromote)
  };

  // Format structure
  const formattedStructure = {
    lpEquity: formatCurrency(structure.lpEquity),
    gpEquity: formatCurrency(structure.gpEquity),
    totalEquity: formatCurrency(structure.lpEquity + structure.gpEquity),
    lpPercent: ((structure.lpEquity / (structure.lpEquity + structure.gpEquity)) * 100).toFixed(1) + '%',
    gpPercent: ((structure.gpEquity / (structure.lpEquity + structure.gpEquity)) * 100).toFixed(1) + '%',
    preferredReturn: (structure.preferredReturn * 100).toFixed(1) + '%',
    gpCatchUp: structure.gpCatchUp ? 'Yes' : 'No',
    lookback: structure.lookback ? 'Yes' : 'No',
    promoteTiers: structure.promoteTiers.map(t => ({
      hurdle: t.hurdle === Infinity ? 'Above' : (t.hurdle * 100).toFixed(0) + '%',
      lpSplit: (t.lpSplit * 100).toFixed(0) + '%',
      gpSplit: (t.gpSplit * 100).toFixed(0) + '%'
    }))
  };

  return {
    distributions: formattedDistributions,
    summary: formattedSummary,
    structure: formattedStructure,
    lookbackAdjustment: lookbackAdjustment ? {
      lpShortfall: formatCurrency(lookbackAdjustment.lpShortfall),
      clawbackFromGp: formatCurrency(lookbackAdjustment.clawbackFromGp),
      adjustedLpReturn: formatCurrency(lookbackAdjustment.adjustedLpReturn),
      adjustedGpReturn: formatCurrency(lookbackAdjustment.adjustedGpReturn)
    } : null,
    raw: results // Include raw data for charts
  };
}

/**
 * Compare waterfall results across multiple scenarios
 *
 * @param {Array<Object>} scenarios - Array of { name, cashFlows }
 * @param {Object} structure - Waterfall structure to apply
 * @returns {Object} Comparison results
 */
export function compareWaterfallScenarios(scenarios, structure) {
  const results = scenarios.map(scenario => ({
    name: scenario.name,
    ...calculateWaterfall(scenario.cashFlows, structure)
  }));

  return {
    scenarios: results,
    comparison: {
      lpIRRs: results.map(r => ({ name: r.name, value: r.summary?.lpIRR || 0 })),
      gpIRRs: results.map(r => ({ name: r.name, value: r.summary?.gpIRR || 0 })),
      lpEMs: results.map(r => ({ name: r.name, value: r.summary?.lpEquityMultiple || 0 })),
      gpEMs: results.map(r => ({ name: r.name, value: r.summary?.gpEquityMultiple || 0 })),
      promotes: results.map(r => ({ name: r.name, value: r.summary?.totalPromote || 0 }))
    }
  };
}

// Helper function
function formatCurrency(value) {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(value);
}

export default {
  calculateWaterfall,
  createDefaultStructure,
  formatWaterfallForDisplay,
  compareWaterfallScenarios,
  DEFAULT_WATERFALL_STRUCTURE,
  WATERFALL_TEMPLATES,
  // Per-class helper functions
  groupLPsByClassPriority,
  calculateClassPreferred,
  allocateWithinClass,
  getSortedClassPriorities,
  getEffectivePreferredReturn
};
