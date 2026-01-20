/**
 * Deal Insights Service
 *
 * Automatically generates insights, warnings, and recommendations
 * based on the underwriting model, benchmarks, and extracted data.
 * These insights help analysts and GPs quickly identify issues
 * and understand deal characteristics.
 */

import { PROPERTY_SECTORS, detectSector } from './sector-config.js';

/**
 * Insight severity levels
 */
export const INSIGHT_SEVERITY = {
  CRITICAL: 'CRITICAL',   // Deal breaker or major concern
  WARNING: 'WARNING',     // Notable issue to investigate
  INFO: 'INFO',           // Informational observation
  POSITIVE: 'POSITIVE'    // Favorable characteristic
};

/**
 * Insight categories
 */
export const INSIGHT_CATEGORY = {
  VALUATION: 'Valuation',
  DEBT: 'Debt',
  OPERATIONS: 'Operations',
  RETURNS: 'Returns',
  MARKET: 'Market',
  RISK: 'Risk',
  STRUCTURE: 'Structure'
};

/**
 * Generate all insights for a deal
 * @param {Object} context - Deal context from buildDealContext()
 * @returns {Array} Array of insight objects
 */
export function generateInsights(context) {
  const insights = [];

  const { model, calculatedReturns, benchmarks, conflicts, property, extractions } = context;

  if (!model && !calculatedReturns) {
    insights.push({
      severity: INSIGHT_SEVERITY.INFO,
      category: INSIGHT_CATEGORY.RETURNS,
      title: 'No Model Data',
      message: 'Underwriting model has not been populated yet. Upload documents to auto-extract data.',
      recommendation: 'Upload rent roll, T12, and loan terms to build the model.'
    });
    return insights;
  }

  // === VALUATION INSIGHTS ===
  insights.push(...generateValuationInsights(calculatedReturns, benchmarks, property));

  // === DEBT INSIGHTS ===
  insights.push(...generateDebtInsights(model, calculatedReturns, benchmarks));

  // === OPERATIONS INSIGHTS ===
  insights.push(...generateOperationsInsights(model, extractions, benchmarks));

  // === RETURNS INSIGHTS ===
  insights.push(...generateReturnsInsights(calculatedReturns, benchmarks));

  // === CONFLICT INSIGHTS ===
  if (conflicts?.summary?.open > 0) {
    insights.push({
      severity: conflicts.summary.errors > 0 ? INSIGHT_SEVERITY.CRITICAL : INSIGHT_SEVERITY.WARNING,
      category: INSIGHT_CATEGORY.RISK,
      title: 'Data Conflicts Detected',
      message: `${conflicts.summary.open} unresolved conflict(s) between data sources: ${conflicts.summary.errors} errors, ${conflicts.summary.warnings} warnings.`,
      recommendation: 'Review and resolve conflicts before finalizing underwriting.',
      details: { openConflicts: conflicts.summary.open, errors: conflicts.summary.errors }
    });
  }

  // Sort by severity
  const severityOrder = { CRITICAL: 0, WARNING: 1, INFO: 2, POSITIVE: 3 };
  insights.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return insights;
}

/**
 * Generate valuation-related insights
 */
function generateValuationInsights(returns, benchmarks, property) {
  const insights = [];
  const bench = benchmarks?.metrics || {};

  // Going-in cap rate analysis
  if (returns?.goingInCapRate) {
    const cap = returns.goingInCapRate;
    const capBench = bench.capRate;

    if (capBench) {
      if (cap < capBench.min) {
        insights.push({
          severity: INSIGHT_SEVERITY.WARNING,
          category: INSIGHT_CATEGORY.VALUATION,
          title: 'Cap Rate Below Market',
          message: `Going-in cap rate (${(cap * 100).toFixed(2)}%) is below the typical range (${(capBench.min * 100).toFixed(1)}%-${(capBench.max * 100).toFixed(1)}%) for ${benchmarks.sectorName}.`,
          recommendation: 'This indicates aggressive pricing. Verify purchase price and NOI assumptions.',
          metric: 'goingInCapRate',
          value: cap,
          benchmark: capBench
        });
      } else if (cap > capBench.max) {
        insights.push({
          severity: INSIGHT_SEVERITY.INFO,
          category: INSIGHT_CATEGORY.VALUATION,
          title: 'Cap Rate Above Market',
          message: `Going-in cap rate (${(cap * 100).toFixed(2)}%) is above typical range. May indicate distress, higher risk, or value-add opportunity.`,
          recommendation: 'Investigate reason for elevated cap rate - could be upside or red flag.',
          metric: 'goingInCapRate',
          value: cap,
          benchmark: capBench
        });
      } else {
        insights.push({
          severity: INSIGHT_SEVERITY.POSITIVE,
          category: INSIGHT_CATEGORY.VALUATION,
          title: 'Cap Rate Within Market Range',
          message: `Going-in cap rate (${(cap * 100).toFixed(2)}%) is within typical market range.`,
          metric: 'goingInCapRate',
          value: cap,
          benchmark: capBench
        });
      }
    }
  }

  // Price per unit analysis (multifamily)
  if (property?.purchase_price && property?.unit_count) {
    const pricePerUnit = property.purchase_price / property.unit_count;

    if (pricePerUnit > 400000) {
      insights.push({
        severity: INSIGHT_SEVERITY.INFO,
        category: INSIGHT_CATEGORY.VALUATION,
        title: 'High Price Per Unit',
        message: `Price per unit ($${formatNumber(pricePerUnit)}) is elevated. Typical for Class A or prime markets.`,
        recommendation: 'Verify rent levels can support this pricing.',
        metric: 'pricePerUnit',
        value: pricePerUnit
      });
    } else if (pricePerUnit < 100000) {
      insights.push({
        severity: INSIGHT_SEVERITY.WARNING,
        category: INSIGHT_CATEGORY.VALUATION,
        title: 'Low Price Per Unit',
        message: `Price per unit ($${formatNumber(pricePerUnit)}) is low. May indicate value-add opportunity or property issues.`,
        recommendation: 'Assess deferred maintenance and capital needs carefully.',
        metric: 'pricePerUnit',
        value: pricePerUnit
      });
    }
  }

  return insights;
}

/**
 * Generate debt-related insights
 */
function generateDebtInsights(model, returns, benchmarks) {
  const insights = [];
  const bench = benchmarks?.metrics || {};

  // DSCR analysis
  if (returns?.dscr) {
    const dscr = returns.dscr;
    const dscrBench = bench.dscr;

    if (dscr < 1.0) {
      insights.push({
        severity: INSIGHT_SEVERITY.CRITICAL,
        category: INSIGHT_CATEGORY.DEBT,
        title: 'Negative Cash Flow',
        message: `DSCR (${dscr.toFixed(2)}x) is below 1.0x. Property does not generate enough income to cover debt service.`,
        recommendation: 'Deal is not financeable in current form. Reduce debt or increase NOI.',
        metric: 'dscr',
        value: dscr
      });
    } else if (dscr < 1.20) {
      insights.push({
        severity: INSIGHT_SEVERITY.CRITICAL,
        category: INSIGHT_CATEGORY.DEBT,
        title: 'DSCR Below Lender Minimums',
        message: `DSCR (${dscr.toFixed(2)}x) is below typical lender minimum (1.20x-1.25x). Will not qualify for most conventional financing.`,
        recommendation: 'Consider bridge debt, higher equity contribution, or negotiate lower purchase price.',
        metric: 'dscr',
        value: dscr
      });
    } else if (dscrBench && dscr < dscrBench.typical) {
      insights.push({
        severity: INSIGHT_SEVERITY.WARNING,
        category: INSIGHT_CATEGORY.DEBT,
        title: 'Thin DSCR Coverage',
        message: `DSCR (${dscr.toFixed(2)}x) is below typical (${dscrBench.typical}x). Limited cushion for NOI volatility.`,
        recommendation: 'Stress test for rent declines or expense increases.',
        metric: 'dscr',
        value: dscr,
        benchmark: dscrBench
      });
    } else if (dscr >= 1.40) {
      insights.push({
        severity: INSIGHT_SEVERITY.POSITIVE,
        category: INSIGHT_CATEGORY.DEBT,
        title: 'Strong DSCR Coverage',
        message: `DSCR (${dscr.toFixed(2)}x) provides healthy cushion above lender requirements.`,
        metric: 'dscr',
        value: dscr
      });
    }
  }

  // LTV analysis
  if (returns?.ltv) {
    const ltv = returns.ltv;

    if (ltv > 0.80) {
      insights.push({
        severity: INSIGHT_SEVERITY.WARNING,
        category: INSIGHT_CATEGORY.DEBT,
        title: 'High Leverage',
        message: `LTV (${(ltv * 100).toFixed(1)}%) exceeds 80%. May require subordinate debt or additional guarantees.`,
        recommendation: 'Consider mezzanine financing or increasing equity.',
        metric: 'ltv',
        value: ltv
      });
    } else if (ltv > 0.75) {
      insights.push({
        severity: INSIGHT_SEVERITY.INFO,
        category: INSIGHT_CATEGORY.DEBT,
        title: 'Moderate Leverage',
        message: `LTV (${(ltv * 100).toFixed(1)}%) is within typical agency range but at the higher end.`,
        metric: 'ltv',
        value: ltv
      });
    } else if (ltv <= 0.65) {
      insights.push({
        severity: INSIGHT_SEVERITY.POSITIVE,
        category: INSIGHT_CATEGORY.DEBT,
        title: 'Conservative Leverage',
        message: `LTV (${(ltv * 100).toFixed(1)}%) is conservative, providing downside protection.`,
        metric: 'ltv',
        value: ltv
      });
    }
  }

  // Debt yield analysis
  if (returns?.debtYield) {
    const dy = returns.debtYield;

    if (dy < 0.07) {
      insights.push({
        severity: INSIGHT_SEVERITY.WARNING,
        category: INSIGHT_CATEGORY.DEBT,
        title: 'Low Debt Yield',
        message: `Debt yield (${(dy * 100).toFixed(2)}%) is below 7%. May not meet CMBS or life company requirements.`,
        recommendation: 'Consider reducing loan amount or achieving higher NOI.',
        metric: 'debtYield',
        value: dy
      });
    } else if (dy >= 0.10) {
      insights.push({
        severity: INSIGHT_SEVERITY.POSITIVE,
        category: INSIGHT_CATEGORY.DEBT,
        title: 'Strong Debt Yield',
        message: `Debt yield (${(dy * 100).toFixed(2)}%) exceeds 10%, meeting requirements for most lenders.`,
        metric: 'debtYield',
        value: dy
      });
    }
  }

  // Interest rate impact
  if (model?.interestRate && model.interestRate > 0.07) {
    insights.push({
      severity: INSIGHT_SEVERITY.INFO,
      category: INSIGHT_CATEGORY.DEBT,
      title: 'Elevated Interest Rate',
      message: `Interest rate (${(model.interestRate * 100).toFixed(2)}%) is above historical norms. Consider refinance assumptions.`,
      recommendation: 'Model refinance scenario at lower rate if holding long-term.',
      metric: 'interestRate',
      value: model.interestRate
    });
  }

  return insights;
}

/**
 * Generate operations-related insights
 */
function generateOperationsInsights(model, extractions, benchmarks) {
  const insights = [];
  const bench = benchmarks?.metrics || {};

  // Expense ratio analysis
  if (model?.netOperatingIncome && model?.effectiveGrossIncome) {
    const expenseRatio = 1 - (model.netOperatingIncome / model.effectiveGrossIncome);
    const expBench = bench.expenseRatio;

    if (expBench) {
      if (expenseRatio < expBench.min) {
        insights.push({
          severity: INSIGHT_SEVERITY.WARNING,
          category: INSIGHT_CATEGORY.OPERATIONS,
          title: 'Low Expense Ratio',
          message: `Expense ratio (${(expenseRatio * 100).toFixed(1)}%) is below typical range (${(expBench.min * 100).toFixed(0)}%-${(expBench.max * 100).toFixed(0)}%).`,
          recommendation: 'May be understating expenses. Review for missing line items or owner-managed operations.',
          metric: 'expenseRatio',
          value: expenseRatio,
          benchmark: expBench
        });
      } else if (expenseRatio > expBench.max) {
        insights.push({
          severity: INSIGHT_SEVERITY.WARNING,
          category: INSIGHT_CATEGORY.OPERATIONS,
          title: 'High Expense Ratio',
          message: `Expense ratio (${(expenseRatio * 100).toFixed(1)}%) exceeds typical range. May indicate operational inefficiency.`,
          recommendation: 'Investigate high-cost line items. Consider value-add through expense reduction.',
          metric: 'expenseRatio',
          value: expenseRatio,
          benchmark: expBench
        });
      }
    }
  }

  // Vacancy analysis
  if (model?.vacancyRate) {
    const vacancy = model.vacancyRate;
    const occBench = bench.occupancy;

    if (vacancy > 0.10) {
      insights.push({
        severity: INSIGHT_SEVERITY.WARNING,
        category: INSIGHT_CATEGORY.OPERATIONS,
        title: 'High Vacancy',
        message: `Vacancy rate (${(vacancy * 100).toFixed(1)}%) is elevated. May indicate lease-up risk or market softness.`,
        recommendation: 'Verify market conditions and lease-up timeline.',
        metric: 'vacancyRate',
        value: vacancy
      });
    } else if (vacancy < 0.03) {
      insights.push({
        severity: INSIGHT_SEVERITY.INFO,
        category: INSIGHT_CATEGORY.OPERATIONS,
        title: 'Very Low Vacancy',
        message: `Vacancy rate (${(vacancy * 100).toFixed(1)}%) is exceptionally low. May indicate below-market rents.`,
        recommendation: 'Evaluate loss-to-lease and rent growth potential.',
        metric: 'vacancyRate',
        value: vacancy
      });
    }
  }

  // Rent roll extraction insights
  const rentRollExtraction = extractions?.find(e => e.documentType === 'RENT_ROLL');
  if (rentRollExtraction?.data?.summary) {
    const summary = rentRollExtraction.data.summary;

    // Occupancy check
    if (summary.occupancyRate && summary.occupancyRate < 0.90) {
      insights.push({
        severity: INSIGHT_SEVERITY.WARNING,
        category: INSIGHT_CATEGORY.OPERATIONS,
        title: 'Physical Occupancy Below 90%',
        message: `Current occupancy (${(summary.occupancyRate * 100).toFixed(1)}%) from rent roll is below stabilized threshold.`,
        recommendation: 'Underwrite to stabilized occupancy with realistic lease-up timeline.',
        metric: 'physicalOccupancy',
        value: summary.occupancyRate
      });
    }
  }

  return insights;
}

/**
 * Generate returns-related insights
 */
function generateReturnsInsights(returns, benchmarks) {
  const insights = [];

  // IRR analysis
  if (returns?.irr) {
    const irr = returns.irr;

    if (irr < 0.10) {
      insights.push({
        severity: INSIGHT_SEVERITY.WARNING,
        category: INSIGHT_CATEGORY.RETURNS,
        title: 'Below-Target IRR',
        message: `Projected IRR (${(irr * 100).toFixed(1)}%) is below typical institutional target (12%-15%).`,
        recommendation: 'Evaluate if risk-adjusted returns justify investment.',
        metric: 'irr',
        value: irr
      });
    } else if (irr >= 0.15 && irr < 0.20) {
      insights.push({
        severity: INSIGHT_SEVERITY.POSITIVE,
        category: INSIGHT_CATEGORY.RETURNS,
        title: 'Attractive IRR',
        message: `Projected IRR (${(irr * 100).toFixed(1)}%) meets value-add return targets.`,
        metric: 'irr',
        value: irr
      });
    } else if (irr >= 0.20) {
      insights.push({
        severity: INSIGHT_SEVERITY.INFO,
        category: INSIGHT_CATEGORY.RETURNS,
        title: 'High IRR - Verify Assumptions',
        message: `Projected IRR (${(irr * 100).toFixed(1)}%) is exceptionally high. Verify assumptions are realistic.`,
        recommendation: 'Stress test key assumptions: exit cap, rent growth, vacancy.',
        metric: 'irr',
        value: irr
      });
    }
  }

  // Equity multiple analysis
  if (returns?.equityMultiple) {
    const em = returns.equityMultiple;

    if (em < 1.5) {
      insights.push({
        severity: INSIGHT_SEVERITY.INFO,
        category: INSIGHT_CATEGORY.RETURNS,
        title: 'Modest Equity Multiple',
        message: `Equity multiple (${em.toFixed(2)}x) is below typical value-add targets (1.5x-2.0x).`,
        metric: 'equityMultiple',
        value: em
      });
    } else if (em >= 2.0) {
      insights.push({
        severity: INSIGHT_SEVERITY.POSITIVE,
        category: INSIGHT_CATEGORY.RETURNS,
        title: 'Strong Equity Multiple',
        message: `Equity multiple (${em.toFixed(2)}x) meets or exceeds value-add targets.`,
        metric: 'equityMultiple',
        value: em
      });
    }
  }

  // Cash-on-cash analysis
  if (returns?.cashOnCash) {
    const coc = returns.cashOnCash;

    if (coc < 0) {
      insights.push({
        severity: INSIGHT_SEVERITY.CRITICAL,
        category: INSIGHT_CATEGORY.RETURNS,
        title: 'Negative Cash-on-Cash',
        message: `Year 1 cash-on-cash (${(coc * 100).toFixed(1)}%) is negative. Property requires capital calls.`,
        recommendation: 'Budget for operational shortfall or increase equity.',
        metric: 'cashOnCash',
        value: coc
      });
    } else if (coc < 0.04) {
      insights.push({
        severity: INSIGHT_SEVERITY.WARNING,
        category: INSIGHT_CATEGORY.RETURNS,
        title: 'Low Current Yield',
        message: `Year 1 cash-on-cash (${(coc * 100).toFixed(1)}%) is below money market rates. Returns dependent on appreciation.`,
        metric: 'cashOnCash',
        value: coc
      });
    } else if (coc >= 0.08) {
      insights.push({
        severity: INSIGHT_SEVERITY.POSITIVE,
        category: INSIGHT_CATEGORY.RETURNS,
        title: 'Strong Current Yield',
        message: `Year 1 cash-on-cash (${(coc * 100).toFixed(1)}%) provides solid current income.`,
        metric: 'cashOnCash',
        value: coc
      });
    }
  }

  return insights;
}

/**
 * Get insights summary for quick display
 */
export function getInsightsSummary(insights) {
  return {
    total: insights.length,
    critical: insights.filter(i => i.severity === INSIGHT_SEVERITY.CRITICAL).length,
    warnings: insights.filter(i => i.severity === INSIGHT_SEVERITY.WARNING).length,
    info: insights.filter(i => i.severity === INSIGHT_SEVERITY.INFO).length,
    positive: insights.filter(i => i.severity === INSIGHT_SEVERITY.POSITIVE).length,
    hasBlockers: insights.some(i => i.severity === INSIGHT_SEVERITY.CRITICAL),
    topIssues: insights
      .filter(i => i.severity === INSIGHT_SEVERITY.CRITICAL || i.severity === INSIGHT_SEVERITY.WARNING)
      .slice(0, 3)
      .map(i => i.title)
  };
}

/**
 * Format number with commas
 */
function formatNumber(num) {
  return num.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

export default {
  generateInsights,
  getInsightsSummary,
  INSIGHT_SEVERITY,
  INSIGHT_CATEGORY
};
