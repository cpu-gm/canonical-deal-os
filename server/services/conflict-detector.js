/**
 * Conflict Detector Service
 *
 * Detects conflicts and discrepancies between different data sources
 * in underwriting (e.g., rent roll vs T12, stated vs calculated values).
 */

/**
 * Conflict severity levels
 */
export const SEVERITY = {
  INFO: 'INFO',       // Minor discrepancy, informational
  WARNING: 'WARNING', // Notable difference, should review
  ERROR: 'ERROR'      // Significant conflict, must resolve
};

/**
 * Conflict types
 */
export const CONFLICT_TYPE = {
  VALUE_MISMATCH: 'VALUE_MISMATCH',
  UNIT_COUNT: 'UNIT_COUNT',
  EXPENSE_ANOMALY: 'EXPENSE_ANOMALY',
  REVENUE_ANOMALY: 'REVENUE_ANOMALY',
  CALCULATION_MISMATCH: 'CALCULATION_MISMATCH',
  DATE_MISMATCH: 'DATE_MISMATCH',
  BENCHMARK_VARIANCE: 'BENCHMARK_VARIANCE'
};

/**
 * Benchmark values for multifamily properties
 */
const BENCHMARKS = {
  expenseRatio: { min: 0.30, max: 0.50, typical: 0.40 },
  capRate: { min: 0.04, max: 0.08, typical: 0.055 },
  vacancyRate: { min: 0.03, max: 0.10, typical: 0.05 },
  managementFeePercent: { min: 0.03, max: 0.06, typical: 0.04 },
  reservesPerUnit: { min: 200, max: 500, typical: 300 }
};

/**
 * Detect conflicts between rent roll and T12 data
 */
export function detectRentRollT12Conflicts(rentRollData, t12Data, dealId) {
  const conflicts = [];

  if (!rentRollData || !t12Data) {
    return conflicts;
  }

  // Revenue mismatch: Rent roll annual rent vs T12 GPR
  if (rentRollData.summary?.totalAnnualRent && t12Data.revenue?.grossPotentialRent) {
    const rrRevenue = rentRollData.summary.totalAnnualRent;
    const t12Revenue = t12Data.revenue.grossPotentialRent;
    const diff = Math.abs(rrRevenue - t12Revenue);
    const pctDiff = diff / t12Revenue;

    if (pctDiff > 0.03) { // >3% difference
      conflicts.push({
        dealId,
        fieldPath: 'grossPotentialRent',
        conflictType: CONFLICT_TYPE.VALUE_MISMATCH,
        severity: pctDiff > 0.10 ? SEVERITY.ERROR : SEVERITY.WARNING,
        sourceA: 'RENT_ROLL',
        valueA: JSON.stringify(rrRevenue),
        sourceB: 'T12',
        valueB: JSON.stringify(t12Revenue),
        difference: diff,
        percentDiff: pctDiff,
        description: `Rent roll annual rent ($${formatNumber(rrRevenue)}) differs from T12 GPR ($${formatNumber(t12Revenue)}) by ${(pctDiff * 100).toFixed(1)}%`
      });
    }
  }

  // Occupancy/vacancy check
  if (rentRollData.summary?.occupancyRate && t12Data.revenue?.grossPotentialRent && t12Data.revenue?.vacancyLoss) {
    const rrOccupancy = rentRollData.summary.occupancyRate;
    const t12VacancyRate = t12Data.revenue.vacancyLoss / t12Data.revenue.grossPotentialRent;
    const t12Occupancy = 1 - t12VacancyRate;
    const diff = Math.abs(rrOccupancy - t12Occupancy);

    if (diff > 0.05) { // >5% point difference
      conflicts.push({
        dealId,
        fieldPath: 'occupancyRate',
        conflictType: CONFLICT_TYPE.VALUE_MISMATCH,
        severity: diff > 0.10 ? SEVERITY.ERROR : SEVERITY.WARNING,
        sourceA: 'RENT_ROLL',
        valueA: JSON.stringify(rrOccupancy),
        sourceB: 'T12',
        valueB: JSON.stringify(t12Occupancy),
        difference: diff,
        percentDiff: diff,
        description: `Rent roll occupancy (${(rrOccupancy * 100).toFixed(1)}%) differs from T12 implied occupancy (${(t12Occupancy * 100).toFixed(1)}%)`
      });
    }
  }

  // Unit count mismatch
  if (rentRollData.summary?.totalUnits) {
    // T12 doesn't usually have unit count, but if we can infer it
    // from per-unit metrics, we could compare
  }

  return conflicts;
}

/**
 * Detect anomalies in expense data
 */
export function detectExpenseAnomalies(t12Data, dealId, unitCount) {
  const conflicts = [];

  if (!t12Data || !t12Data.revenue?.effectiveGrossIncome) {
    return conflicts;
  }

  const egi = t12Data.revenue.effectiveGrossIncome;
  const totalExpenses = t12Data.expenses?.totalExpenses;

  // Expense ratio check
  if (totalExpenses) {
    const expenseRatio = totalExpenses / egi;

    if (expenseRatio < BENCHMARKS.expenseRatio.min) {
      conflicts.push({
        dealId,
        fieldPath: 'expenseRatio',
        conflictType: CONFLICT_TYPE.EXPENSE_ANOMALY,
        severity: SEVERITY.WARNING,
        sourceA: 'T12',
        valueA: JSON.stringify(expenseRatio),
        sourceB: 'BENCHMARK',
        valueB: JSON.stringify(BENCHMARKS.expenseRatio),
        description: `Expense ratio (${(expenseRatio * 100).toFixed(1)}%) is below typical range (${BENCHMARKS.expenseRatio.min * 100}-${BENCHMARKS.expenseRatio.max * 100}%). May be understating expenses.`
      });
    } else if (expenseRatio > BENCHMARKS.expenseRatio.max) {
      conflicts.push({
        dealId,
        fieldPath: 'expenseRatio',
        conflictType: CONFLICT_TYPE.EXPENSE_ANOMALY,
        severity: SEVERITY.WARNING,
        sourceA: 'T12',
        valueA: JSON.stringify(expenseRatio),
        sourceB: 'BENCHMARK',
        valueB: JSON.stringify(BENCHMARKS.expenseRatio),
        description: `Expense ratio (${(expenseRatio * 100).toFixed(1)}%) is above typical range. Review for one-time expenses or inefficiencies.`
      });
    }
  }

  // Management fee check
  if (t12Data.expenses?.management && egi) {
    const mgmtPercent = t12Data.expenses.management / egi;

    if (mgmtPercent > BENCHMARKS.managementFeePercent.max) {
      conflicts.push({
        dealId,
        fieldPath: 'management',
        conflictType: CONFLICT_TYPE.EXPENSE_ANOMALY,
        severity: SEVERITY.INFO,
        sourceA: 'T12',
        valueA: JSON.stringify(mgmtPercent),
        sourceB: 'BENCHMARK',
        valueB: JSON.stringify(BENCHMARKS.managementFeePercent),
        description: `Management fee (${(mgmtPercent * 100).toFixed(1)}%) is above typical ${(BENCHMARKS.managementFeePercent.max * 100)}%. Consider negotiating.`
      });
    }
  }

  // Reserves per unit check (if unit count available)
  if (unitCount && t12Data.expenses?.reserves) {
    const reservesPerUnit = t12Data.expenses.reserves / unitCount;

    if (reservesPerUnit < BENCHMARKS.reservesPerUnit.min) {
      conflicts.push({
        dealId,
        fieldPath: 'reserves',
        conflictType: CONFLICT_TYPE.EXPENSE_ANOMALY,
        severity: SEVERITY.WARNING,
        sourceA: 'T12',
        valueA: JSON.stringify(reservesPerUnit),
        sourceB: 'BENCHMARK',
        valueB: JSON.stringify(BENCHMARKS.reservesPerUnit),
        description: `Reserves ($${formatNumber(reservesPerUnit)}/unit) below typical minimum of $${BENCHMARKS.reservesPerUnit.min}/unit. Consider increasing.`
      });
    }
  }

  return conflicts;
}

/**
 * Detect conflicts in loan terms
 */
export function detectLoanTermsConflicts(loanTerms, calculatedMetrics, dealId) {
  const conflicts = [];

  if (!loanTerms) {
    return conflicts;
  }

  // DSCR below requirement
  if (loanTerms.dscrRequirement && calculatedMetrics?.dscr) {
    if (calculatedMetrics.dscr < loanTerms.dscrRequirement) {
      const cushion = calculatedMetrics.dscr / loanTerms.dscrRequirement - 1;
      conflicts.push({
        dealId,
        fieldPath: 'dscr',
        conflictType: CONFLICT_TYPE.BENCHMARK_VARIANCE,
        severity: SEVERITY.ERROR,
        sourceA: 'CALCULATED',
        valueA: JSON.stringify(calculatedMetrics.dscr),
        sourceB: 'LOAN_TERMS',
        valueB: JSON.stringify(loanTerms.dscrRequirement),
        difference: calculatedMetrics.dscr - loanTerms.dscrRequirement,
        description: `Calculated DSCR (${calculatedMetrics.dscr.toFixed(2)}x) is below lender requirement (${loanTerms.dscrRequirement}x). Deal may not qualify.`
      });
    }
  }

  // LTV check
  if (loanTerms.ltv && loanTerms.ltv > 0.80) {
    conflicts.push({
      dealId,
      fieldPath: 'ltv',
      conflictType: CONFLICT_TYPE.BENCHMARK_VARIANCE,
      severity: SEVERITY.WARNING,
      sourceA: 'LOAN_TERMS',
      valueA: JSON.stringify(loanTerms.ltv),
      sourceB: 'BENCHMARK',
      valueB: JSON.stringify(0.80),
      description: `LTV (${(loanTerms.ltv * 100).toFixed(1)}%) exceeds typical 80% threshold. May require additional equity or guarantees.`
    });
  }

  return conflicts;
}

/**
 * Detect all conflicts across all extractions
 */
export function detectAllConflicts(dealId, extractions, calculatedMetrics) {
  const conflicts = [];

  // Find extraction data by type
  const rentRollExtraction = extractions.find(e => e.documentType === 'RENT_ROLL');
  const t12Extraction = extractions.find(e => e.documentType === 'T12');
  const loanTermsExtraction = extractions.find(e => e.documentType === 'LOAN_TERMS');

  const rentRollData = rentRollExtraction ? JSON.parse(rentRollExtraction.extractedData) : null;
  const t12Data = t12Extraction ? JSON.parse(t12Extraction.extractedData) : null;
  const loanTermsData = loanTermsExtraction ? JSON.parse(loanTermsExtraction.extractedData) : null;

  // Cross-source conflicts
  if (rentRollData && t12Data) {
    conflicts.push(...detectRentRollT12Conflicts(rentRollData, t12Data, dealId));
  }

  // Expense anomalies
  if (t12Data) {
    const unitCount = rentRollData?.summary?.totalUnits ?? null;
    conflicts.push(...detectExpenseAnomalies(t12Data, dealId, unitCount));
  }

  // Loan terms conflicts
  if (loanTermsData && calculatedMetrics) {
    conflicts.push(...detectLoanTermsConflicts(loanTermsData, calculatedMetrics, dealId));
  }

  // Cap rate sanity check
  if (calculatedMetrics?.goingInCapRate) {
    const cap = calculatedMetrics.goingInCapRate;
    if (cap < BENCHMARKS.capRate.min) {
      conflicts.push({
        dealId,
        fieldPath: 'goingInCapRate',
        conflictType: CONFLICT_TYPE.BENCHMARK_VARIANCE,
        severity: SEVERITY.INFO,
        sourceA: 'CALCULATED',
        valueA: JSON.stringify(cap),
        sourceB: 'BENCHMARK',
        valueB: JSON.stringify(BENCHMARKS.capRate),
        description: `Going-in cap rate (${(cap * 100).toFixed(2)}%) is below typical range. Verify purchase price or NOI.`
      });
    } else if (cap > BENCHMARKS.capRate.max) {
      conflicts.push({
        dealId,
        fieldPath: 'goingInCapRate',
        conflictType: CONFLICT_TYPE.BENCHMARK_VARIANCE,
        severity: SEVERITY.WARNING,
        sourceA: 'CALCULATED',
        valueA: JSON.stringify(cap),
        sourceB: 'BENCHMARK',
        valueB: JSON.stringify(BENCHMARKS.capRate),
        description: `Going-in cap rate (${(cap * 100).toFixed(2)}%) is above typical range. May indicate higher risk or distressed asset.`
      });
    }
  }

  return conflicts;
}

/**
 * Helper to format numbers with commas
 */
function formatNumber(num) {
  return num.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/**
 * Get conflict summary for display
 */
export function getConflictSummary(conflicts) {
  const byStatus = {
    OPEN: conflicts.filter(c => c.status === 'OPEN'),
    RESOLVED: conflicts.filter(c => c.status === 'RESOLVED'),
    IGNORED: conflicts.filter(c => c.status === 'IGNORED')
  };

  const bySeverity = {
    ERROR: conflicts.filter(c => c.severity === SEVERITY.ERROR),
    WARNING: conflicts.filter(c => c.severity === SEVERITY.WARNING),
    INFO: conflicts.filter(c => c.severity === SEVERITY.INFO)
  };

  return {
    total: conflicts.length,
    open: byStatus.OPEN.length,
    resolved: byStatus.RESOLVED.length,
    ignored: byStatus.IGNORED.length,
    errors: bySeverity.ERROR.length,
    warnings: bySeverity.WARNING.length,
    info: bySeverity.INFO.length,
    hasBlockers: bySeverity.ERROR.length > 0
  };
}

export default {
  detectAllConflicts,
  detectRentRollT12Conflicts,
  detectExpenseAnomalies,
  detectLoanTermsConflicts,
  getConflictSummary,
  SEVERITY,
  CONFLICT_TYPE
};
