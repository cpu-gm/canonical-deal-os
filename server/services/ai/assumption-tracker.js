/**
 * Assumption Drift Tracker
 *
 * Compares underwritten assumptions to actual performance.
 * Builds feedback loop for future deals.
 *
 * Features:
 * 1. Assumption snapshot capture at key milestones
 * 2. Variance analysis comparing projected vs actual
 * 3. Portfolio-wide trend analysis
 * 4. AI-powered assumption adjustment suggestions
 *
 * Phase 2.3 Implementation
 */

import { getPrisma } from '../../db.js';

// Configuration
export const ASSUMPTION_TRACKER_CONFIG = {
  enabled: process.env.AI_ASSUMPTION_TRACKER_ENABLED !== 'false',
  varianceAlertThreshold: parseFloat(process.env.AI_ASSUMPTION_VARIANCE_ALERT_THRESHOLD) || 0.15,
  debug: process.env.DEBUG_AI_ASSUMPTION_TRACKER === 'true',
};

// Snapshot types
export const SNAPSHOT_TYPE = {
  UNDERWRITING: 'UNDERWRITING',
  YEAR_1_ACTUAL: 'YEAR_1_ACTUAL',
  YEAR_2_ACTUAL: 'YEAR_2_ACTUAL',
  YEAR_3_ACTUAL: 'YEAR_3_ACTUAL',
  YEAR_4_ACTUAL: 'YEAR_4_ACTUAL',
  YEAR_5_ACTUAL: 'YEAR_5_ACTUAL',
  EXIT: 'EXIT',
};

// Key assumptions to track
const KEY_ASSUMPTIONS = [
  'rentGrowth',
  'expenseGrowth',
  'vacancyRate',
  'capexPerUnit',
  'exitCapRate',
  'managementFee',
  'insuranceGrowth',
  'taxGrowth',
  'turnoverCost',
];

// Key metrics to track
const KEY_METRICS = [
  'noi',
  'irr',
  'cashOnCash',
  'equityMultiple',
  'dscr',
  'effectiveGrossIncome',
];

/**
 * Track assumptions at a specific milestone
 *
 * @param {string} dealId - Deal ID
 * @param {string} snapshotType - Type of snapshot (from SNAPSHOT_TYPE)
 * @param {Object} assumptions - Key assumptions
 * @param {Object} metrics - Calculated metrics (optional)
 * @param {string} notes - Optional notes
 * @returns {Object} Created snapshot record
 */
export async function trackAssumptions(dealId, snapshotType, assumptions, metrics = {}, notes = '') {
  const operationId = `snapshot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  if (ASSUMPTION_TRACKER_CONFIG.debug) {
    console.log(`[ASSUMPTION] [${operationId}] Tracking: deal=${dealId}, type=${snapshotType}`);
  }

  if (!ASSUMPTION_TRACKER_CONFIG.enabled) {
    console.log(`[ASSUMPTION] [${operationId}] Feature disabled`);
    return {
      success: false,
      error: 'Assumption tracker feature is disabled',
    };
  }

  const prisma = getPrisma();

  try {
    // Validate snapshot type
    if (!Object.values(SNAPSHOT_TYPE).includes(snapshotType)) {
      return {
        success: false,
        error: `Invalid snapshot type: ${snapshotType}`,
      };
    }

    // Check for existing snapshot of same type
    const existing = await prisma.assumptionSnapshot.findFirst({
      where: {
        dealId,
        snapshotType,
      },
    });

    if (existing && snapshotType === SNAPSHOT_TYPE.UNDERWRITING) {
      // Only one underwriting snapshot allowed
      return {
        success: false,
        error: 'Underwriting snapshot already exists for this deal',
        existingSnapshot: existing,
      };
    }

    // Create snapshot
    const snapshot = await prisma.assumptionSnapshot.create({
      data: {
        dealId,
        snapshotType,
        assumptions: JSON.stringify(assumptions),
        projectedMetrics: JSON.stringify(metrics),
        notes,
      },
    });

    console.log(`[ASSUMPTION] [${operationId}] Snapshot saved: ${snapshot.id}`);

    return {
      success: true,
      snapshot,
    };

  } catch (error) {
    console.error(`[ASSUMPTION] [${operationId}] Error:`, error.message);
    if (ASSUMPTION_TRACKER_CONFIG.debug) {
      console.error(`[ASSUMPTION] [${operationId}] Stack:`, error.stack);
    }

    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Compare projected assumptions to actuals
 *
 * @param {string} dealId - Deal ID
 * @param {string} period - Period to compare (e.g., 'YEAR_1')
 * @returns {Object} Variance analysis
 */
export async function compareToActuals(dealId, period) {
  const operationId = `compare_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  if (ASSUMPTION_TRACKER_CONFIG.debug) {
    console.log(`[ASSUMPTION] [${operationId}] Comparing: deal=${dealId}, period=${period}`);
  }

  if (!ASSUMPTION_TRACKER_CONFIG.enabled) {
    return {
      success: false,
      error: 'Assumption tracker feature is disabled',
    };
  }

  const prisma = getPrisma();

  try {
    // Get underwriting snapshot
    const underwriting = await prisma.assumptionSnapshot.findFirst({
      where: {
        dealId,
        snapshotType: SNAPSHOT_TYPE.UNDERWRITING,
      },
    });

    if (!underwriting) {
      return {
        success: false,
        error: 'No underwriting snapshot found for this deal',
      };
    }

    // Get actual snapshot for the period
    const actualType = `${period}_ACTUAL`;
    const actual = await prisma.assumptionSnapshot.findFirst({
      where: {
        dealId,
        snapshotType: actualType,
      },
    });

    if (!actual) {
      return {
        success: false,
        error: `No actual data found for period: ${period}`,
      };
    }

    // Parse data
    const projectedAssumptions = parseJSON(underwriting.assumptions);
    const projectedMetrics = parseJSON(underwriting.projectedMetrics);
    const actualAssumptions = parseJSON(actual.assumptions);
    const actualMetrics = parseJSON(actual.projectedMetrics);

    // Calculate variances
    const assumptionVariances = calculateVariances(projectedAssumptions, actualAssumptions, KEY_ASSUMPTIONS);
    const metricVariances = calculateVariances(projectedMetrics, actualMetrics, KEY_METRICS);

    // Save variances to database
    const savedVariances = await saveVariances(prisma, dealId, period, assumptionVariances, metricVariances);

    // Generate insights
    const insights = generateVarianceInsights(assumptionVariances, metricVariances);

    console.log(`[ASSUMPTION] [${operationId}] Comparison complete: ${assumptionVariances.length + metricVariances.length} variances calculated`);

    return {
      success: true,
      dealId,
      period,
      underwritingSnapshot: {
        id: underwriting.id,
        createdAt: underwriting.createdAt,
      },
      actualSnapshot: {
        id: actual.id,
        createdAt: actual.createdAt,
      },
      assumptionVariances,
      metricVariances,
      savedVariances,
      insights,
      summary: {
        totalVariances: assumptionVariances.length + metricVariances.length,
        significantVariances: [...assumptionVariances, ...metricVariances].filter(
          v => Math.abs(v.variancePercent) > ASSUMPTION_TRACKER_CONFIG.varianceAlertThreshold
        ).length,
        overperforming: [...assumptionVariances, ...metricVariances].filter(v => v.variancePercent > 0).length,
        underperforming: [...assumptionVariances, ...metricVariances].filter(v => v.variancePercent < 0).length,
      },
    };

  } catch (error) {
    console.error(`[ASSUMPTION] [${operationId}] Error:`, error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Parse JSON string safely
 */
function parseJSON(str) {
  if (!str) return {};
  try {
    return typeof str === 'string' ? JSON.parse(str) : str;
  } catch (e) {
    return {};
  }
}

/**
 * Calculate variances between projected and actual values
 *
 * @param {Object} projected - Projected values
 * @param {Object} actual - Actual values
 * @param {string[]} fields - Fields to compare
 * @returns {Object[]} Array of variance records
 */
function calculateVariances(projected, actual, fields) {
  const variances = [];

  for (const field of fields) {
    const projectedValue = projected[field];
    const actualValue = actual[field];

    if (projectedValue === undefined || actualValue === undefined) {
      continue;
    }

    const projNum = parseFloat(projectedValue);
    const actNum = parseFloat(actualValue);

    if (isNaN(projNum) || isNaN(actNum)) {
      continue;
    }

    const variance = actNum - projNum;
    const variancePercent = projNum !== 0 ? variance / Math.abs(projNum) : 0;

    variances.push({
      field,
      projectedValue: projNum,
      actualValue: actNum,
      variance,
      variancePercent,
      direction: variancePercent > 0 ? 'positive' : variancePercent < 0 ? 'negative' : 'neutral',
      isSignificant: Math.abs(variancePercent) > ASSUMPTION_TRACKER_CONFIG.varianceAlertThreshold,
    });
  }

  return variances;
}

/**
 * Save variances to database
 */
async function saveVariances(prisma, dealId, period, assumptionVariances, metricVariances) {
  const allVariances = [...assumptionVariances, ...metricVariances];
  const saved = [];

  for (const v of allVariances) {
    try {
      // Check for existing variance
      const existing = await prisma.assumptionVariance.findFirst({
        where: {
          dealId,
          period,
          field: v.field,
        },
      });

      if (existing) {
        // Update existing
        const updated = await prisma.assumptionVariance.update({
          where: { id: existing.id },
          data: {
            projectedValue: v.projectedValue,
            actualValue: v.actualValue,
            variancePercent: v.variancePercent,
            aiExplanation: v.explanation || null,
          },
        });
        saved.push(updated);
      } else {
        // Create new
        const created = await prisma.assumptionVariance.create({
          data: {
            dealId,
            period,
            field: v.field,
            projectedValue: v.projectedValue,
            actualValue: v.actualValue,
            variancePercent: v.variancePercent,
            aiExplanation: v.explanation || null,
          },
        });
        saved.push(created);
      }
    } catch (error) {
      console.error(`[ASSUMPTION] Error saving variance for ${v.field}:`, error.message);
    }
  }

  return saved;
}

/**
 * Generate insights from variance analysis
 */
function generateVarianceInsights(assumptionVariances, metricVariances) {
  const insights = [];

  // Check for significant assumption variances
  const significantAssumptions = assumptionVariances.filter(v => v.isSignificant);
  if (significantAssumptions.length > 0) {
    insights.push({
      type: 'warning',
      message: `${significantAssumptions.length} assumption(s) have significant variance from projections`,
      fields: significantAssumptions.map(v => v.field),
    });
  }

  // Check for overall performance
  const noiVariance = metricVariances.find(v => v.field === 'noi');
  if (noiVariance) {
    if (noiVariance.variancePercent > 0.05) {
      insights.push({
        type: 'positive',
        message: `NOI is ${(noiVariance.variancePercent * 100).toFixed(1)}% above projections`,
        field: 'noi',
      });
    } else if (noiVariance.variancePercent < -0.05) {
      insights.push({
        type: 'warning',
        message: `NOI is ${(Math.abs(noiVariance.variancePercent) * 100).toFixed(1)}% below projections`,
        field: 'noi',
      });
    }
  }

  // Check rent growth assumptions
  const rentGrowthVariance = assumptionVariances.find(v => v.field === 'rentGrowth');
  if (rentGrowthVariance && rentGrowthVariance.isSignificant) {
    if (rentGrowthVariance.variancePercent < 0) {
      insights.push({
        type: 'action',
        message: 'Rent growth underperformed - consider reviewing market assumptions for future deals',
        field: 'rentGrowth',
      });
    }
  }

  // Check vacancy rate
  const vacancyVariance = assumptionVariances.find(v => v.field === 'vacancyRate');
  if (vacancyVariance && vacancyVariance.isSignificant) {
    if (vacancyVariance.direction === 'positive') { // Higher vacancy = worse
      insights.push({
        type: 'warning',
        message: 'Actual vacancy rate exceeds projections',
        field: 'vacancyRate',
      });
    }
  }

  return insights;
}

/**
 * Get portfolio-wide assumption trends
 *
 * @param {string} organizationId - Organization ID
 * @param {Object} options - Query options
 * @returns {Object} Portfolio trends analysis
 */
export async function getPortfolioTrends(organizationId, options = {}) {
  const { minDeals = 3 } = options;

  if (!ASSUMPTION_TRACKER_CONFIG.enabled) {
    return {
      success: false,
      error: 'Assumption tracker feature is disabled',
    };
  }

  const prisma = getPrisma();

  try {
    // Get all variances for the organization's deals
    // Note: This assumes deals have organizationId - adjust query based on actual schema
    const variances = await prisma.assumptionVariance.findMany({
      orderBy: { createdAt: 'desc' },
    });

    if (variances.length === 0) {
      return {
        success: true,
        message: 'No variance data available yet',
        trends: {},
      };
    }

    // Group variances by field
    const fieldGroups = {};
    for (const v of variances) {
      if (!fieldGroups[v.field]) {
        fieldGroups[v.field] = [];
      }
      fieldGroups[v.field].push(v.variancePercent);
    }

    // Calculate trends for each field
    const trends = {};
    for (const [field, values] of Object.entries(fieldGroups)) {
      if (values.length < minDeals) {
        continue;
      }

      const sum = values.reduce((a, b) => a + b, 0);
      const avg = sum / values.length;
      const sorted = [...values].sort((a, b) => a - b);

      trends[field] = {
        sampleSize: values.length,
        averageVariance: avg,
        medianVariance: sorted[Math.floor(sorted.length / 2)],
        minVariance: sorted[0],
        maxVariance: sorted[sorted.length - 1],
        tendency: avg > 0.02 ? 'optimistic' : avg < -0.02 ? 'conservative' : 'accurate',
        recommendation: generateFieldRecommendation(field, avg),
      };
    }

    // Generate overall recommendations
    const recommendations = generatePortfolioRecommendations(trends);

    console.log(`[ASSUMPTION] Portfolio trends calculated for ${Object.keys(trends).length} fields`);

    return {
      success: true,
      organizationId,
      totalVariances: variances.length,
      uniqueDeals: [...new Set(variances.map(v => v.dealId))].length,
      trends,
      recommendations,
    };

  } catch (error) {
    console.error(`[ASSUMPTION] Error getting portfolio trends:`, error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Generate recommendation for a specific field based on variance history
 */
function generateFieldRecommendation(field, avgVariance) {
  const absVariance = Math.abs(avgVariance);
  const direction = avgVariance > 0 ? 'optimistic' : 'conservative';

  if (absVariance < 0.02) {
    return `${field} assumptions are generally accurate`;
  }

  const adjustment = (absVariance * 100).toFixed(1);

  switch (field) {
    case 'rentGrowth':
      return direction === 'optimistic'
        ? `Consider reducing rent growth assumptions by ~${adjustment}%`
        : `Rent growth assumptions are ~${adjustment}% conservative`;
    case 'vacancyRate':
      return direction === 'optimistic'
        ? `Consider increasing vacancy rate assumptions by ~${adjustment}%`
        : `Vacancy assumptions are ~${adjustment}% conservative`;
    case 'expenseGrowth':
      return direction === 'optimistic'
        ? `Expense growth is underestimated by ~${adjustment}%`
        : `Expense growth assumptions are conservative`;
    default:
      return direction === 'optimistic'
        ? `${field} assumptions are ${adjustment}% optimistic on average`
        : `${field} assumptions are ${adjustment}% conservative on average`;
  }
}

/**
 * Generate portfolio-wide recommendations
 */
function generatePortfolioRecommendations(trends) {
  const recommendations = [];

  // Check for consistently optimistic assumptions
  const optimisticFields = Object.entries(trends)
    .filter(([_, data]) => data.tendency === 'optimistic')
    .map(([field, _]) => field);

  if (optimisticFields.length >= 2) {
    recommendations.push({
      type: 'pattern',
      severity: 'warning',
      message: `Multiple assumptions tend to be optimistic: ${optimisticFields.join(', ')}`,
      suggestion: 'Consider applying a conservative adjustment factor to projections',
    });
  }

  // Check for consistently conservative assumptions
  const conservativeFields = Object.entries(trends)
    .filter(([_, data]) => data.tendency === 'conservative')
    .map(([field, _]) => field);

  if (conservativeFields.length >= 2) {
    recommendations.push({
      type: 'pattern',
      severity: 'info',
      message: `Multiple assumptions tend to be conservative: ${conservativeFields.join(', ')}`,
      suggestion: 'Your projections are generally cautious - this is often preferred',
    });
  }

  // Check for high variance fields
  const highVarianceFields = Object.entries(trends)
    .filter(([_, data]) => Math.abs(data.averageVariance) > 0.2)
    .map(([field, _]) => field);

  if (highVarianceFields.length > 0) {
    recommendations.push({
      type: 'accuracy',
      severity: 'warning',
      message: `High variance in: ${highVarianceFields.join(', ')}`,
      suggestion: 'These assumptions need better calibration or more market research',
    });
  }

  return recommendations;
}

/**
 * Suggest assumption adjustments for a new deal based on portfolio history
 *
 * @param {string} organizationId - Organization ID
 * @param {Object} proposedAssumptions - Proposed assumptions for new deal
 * @param {Object} dealContext - Context about the new deal
 * @returns {Object} Suggested adjustments
 */
export async function suggestAssumptionAdjustments(organizationId, proposedAssumptions, dealContext = {}) {
  if (!ASSUMPTION_TRACKER_CONFIG.enabled) {
    return {
      success: false,
      error: 'Assumption tracker feature is disabled',
    };
  }

  try {
    // Get portfolio trends
    const trendsResult = await getPortfolioTrends(organizationId);

    if (!trendsResult.success || Object.keys(trendsResult.trends).length === 0) {
      return {
        success: true,
        message: 'Insufficient historical data for suggestions',
        suggestions: [],
      };
    }

    const suggestions = [];

    for (const [field, value] of Object.entries(proposedAssumptions)) {
      const trend = trendsResult.trends[field];
      if (!trend) continue;

      const proposedValue = parseFloat(value);
      if (isNaN(proposedValue)) continue;

      // Suggest adjustment based on historical variance
      if (Math.abs(trend.averageVariance) > 0.05) {
        const adjustmentFactor = 1 - trend.averageVariance;
        const adjustedValue = proposedValue * adjustmentFactor;

        suggestions.push({
          field,
          proposedValue,
          suggestedValue: adjustedValue,
          adjustmentPercent: trend.averageVariance * 100,
          reason: trend.recommendation,
          confidence: trend.sampleSize >= 5 ? 'high' : trend.sampleSize >= 3 ? 'medium' : 'low',
          historicalBasis: {
            sampleSize: trend.sampleSize,
            averageVariance: trend.averageVariance,
          },
        });
      }
    }

    console.log(`[ASSUMPTION] Generated ${suggestions.length} adjustment suggestions`);

    return {
      success: true,
      organizationId,
      suggestions,
      basedOnDeals: trendsResult.uniqueDeals,
      portfolioTrends: trendsResult.trends,
    };

  } catch (error) {
    console.error(`[ASSUMPTION] Error suggesting adjustments:`, error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Get all snapshots for a deal
 *
 * @param {string} dealId - Deal ID
 * @returns {Object} All snapshots for the deal
 */
export async function getDealSnapshots(dealId) {
  if (!ASSUMPTION_TRACKER_CONFIG.enabled) {
    return {
      success: false,
      error: 'Assumption tracker feature is disabled',
    };
  }

  const prisma = getPrisma();

  try {
    const snapshots = await prisma.assumptionSnapshot.findMany({
      where: { dealId },
      orderBy: { createdAt: 'asc' },
    });

    // Parse JSON fields
    const parsed = snapshots.map(s => ({
      ...s,
      assumptions: parseJSON(s.assumptions),
      projectedMetrics: parseJSON(s.projectedMetrics),
    }));

    return {
      success: true,
      dealId,
      snapshots: parsed,
      hasUnderwriting: parsed.some(s => s.snapshotType === SNAPSHOT_TYPE.UNDERWRITING),
      periods: parsed.map(s => s.snapshotType),
    };

  } catch (error) {
    console.error(`[ASSUMPTION] Error getting snapshots:`, error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Get variance history for a deal
 *
 * @param {string} dealId - Deal ID
 * @returns {Object} All variances for the deal
 */
export async function getDealVariances(dealId) {
  if (!ASSUMPTION_TRACKER_CONFIG.enabled) {
    return {
      success: false,
      error: 'Assumption tracker feature is disabled',
    };
  }

  const prisma = getPrisma();

  try {
    const variances = await prisma.assumptionVariance.findMany({
      where: { dealId },
      orderBy: [
        { period: 'asc' },
        { field: 'asc' },
      ],
    });

    // Group by period
    const byPeriod = {};
    for (const v of variances) {
      if (!byPeriod[v.period]) {
        byPeriod[v.period] = [];
      }
      byPeriod[v.period].push(v);
    }

    return {
      success: true,
      dealId,
      variances,
      byPeriod,
      totalVariances: variances.length,
      periodsAnalyzed: Object.keys(byPeriod),
    };

  } catch (error) {
    console.error(`[ASSUMPTION] Error getting variances:`, error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

export default {
  trackAssumptions,
  compareToActuals,
  getPortfolioTrends,
  suggestAssumptionAdjustments,
  getDealSnapshots,
  getDealVariances,
  ASSUMPTION_TRACKER_CONFIG,
  SNAPSHOT_TYPE,
};
