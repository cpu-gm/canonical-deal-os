/**
 * Scenario Generator Service
 *
 * Automatically generates standard underwriting scenarios
 * (Base Case, Downside, Upside) when a deal model is created.
 * Scenarios use sector-specific adjustments to create
 * realistic sensitivity analysis.
 */

import { getPrisma } from '../db.js';
import { PROPERTY_SECTORS, detectSector } from './sector-config.js';
import { calculateUnderwriting } from './underwriting-calculator.js';
import { kernelFetchJson } from '../kernel.js';

/**
 * Default scenario templates
 * Adjustments are functions that take the base value and return the adjusted value
 */
export const DEFAULT_SCENARIOS = {
  baseCase: {
    name: 'Base Case',
    description: 'As-is underwriting based on current operations',
    isBaseCase: true,
    adjustments: {}
  },

  downside: {
    name: 'Downside',
    description: 'Conservative scenario with stressed assumptions',
    isBaseCase: false,
    adjustments: {
      // Revenue stress
      vacancyRate: (base) => Math.min(base * 1.5, 0.15), // 50% higher vacancy, max 15%
      rentGrowth: (base) => base * 0.5, // 50% lower rent growth
      otherIncome: (base) => base * 0.85, // 15% reduction in other income

      // Expense stress
      operatingExpenses: (base) => base * 1.05, // 5% higher expenses
      expenseGrowth: (base) => Math.max(base * 1.25, 0.03), // 25% higher expense growth

      // Exit stress
      exitCapRate: (base) => base + 0.0050, // 50bps cap rate expansion
      holdPeriod: (base) => base // Same hold period
    }
  },

  upside: {
    name: 'Value-Add Achieved',
    description: 'Upside scenario assuming successful value-add execution',
    isBaseCase: false,
    adjustments: {
      // Revenue improvement
      grossPotentialRent: (base) => base * 1.10, // 10% rent increase
      vacancyRate: (base) => Math.max(base - 0.02, 0.03), // 2% lower vacancy, min 3%
      otherIncome: (base) => base * 1.15, // 15% increase in other income
      rentGrowth: (base) => Math.min(base * 1.25, 0.05), // 25% higher rent growth

      // Expense improvement
      operatingExpenses: (base) => base * 0.95, // 5% lower expenses

      // Exit improvement
      exitCapRate: (base) => Math.max(base - 0.0025, 0.04) // 25bps cap compression, min 4%
    }
  },

  // Additional scenario for longer holds
  extendedHold: {
    name: 'Extended Hold (7 Years)',
    description: 'Longer hold period to maximize value creation',
    isBaseCase: false,
    adjustments: {
      holdPeriod: () => 7,
      exitCapRate: (base) => base + 0.0025 // Slight cap expansion for later exit
    }
  },

  // Rate stress scenario
  rateStress: {
    name: 'Interest Rate Stress',
    description: 'Scenario with 100bps rate increase at refinance',
    isBaseCase: false,
    adjustments: {
      interestRate: (base) => base + 0.01 // 100bps rate increase
    }
  }
};

/**
 * Sector-specific scenario adjustments
 */
const SECTOR_ADJUSTMENTS = {
  MULTIFAMILY: {
    downside: {
      vacancyRate: (base) => Math.min(base * 1.4, 0.12), // MF typically lower vacancy stress
      concessions: (base) => (base || 0) * 1.5 // Increase concessions
    },
    upside: {
      grossPotentialRent: (base) => base * 1.08, // More conservative rent bump for MF
      turnoverRate: (base) => (base || 0.5) * 0.85 // Reduce turnover
    }
  },

  OFFICE: {
    downside: {
      vacancyRate: (base) => Math.min(base * 2.0, 0.25), // Office has higher vacancy risk
      tenantImprovements: (base) => (base || 50) * 1.20 // Higher TI in downside
    },
    upside: {
      tenantImprovements: (base) => (base || 50) * 0.80 // Lower TI if market improves
    }
  },

  INDUSTRIAL: {
    downside: {
      vacancyRate: (base) => Math.min(base * 1.3, 0.10), // Industrial very stable
      exitCapRate: (base) => base + 0.0075 // Higher cap expansion risk
    },
    upside: {
      rentGrowth: (base) => Math.min(base * 1.5, 0.06) // Strong rent growth potential
    }
  },

  RETAIL: {
    downside: {
      vacancyRate: (base) => Math.min(base * 1.5, 0.20), // Retail volatility
      grossPotentialRent: (base) => base * 0.95 // Rent reduction risk
    },
    upside: {
      percentageRent: (base) => (base || 0) * 1.25 // Percentage rent upside
    }
  }
};

/**
 * Generate default scenarios for a deal
 * @param {string} dealId - The deal ID
 * @param {Object} baseModel - The base underwriting model
 * @param {string} createdBy - User ID creating the scenarios
 * @param {string} createdByName - User name
 * @returns {Array} Array of created scenario objects
 */
export async function generateDefaultScenarios(dealId, baseModel, createdBy, createdByName) {
  const prisma = getPrisma();

  // Detect sector for sector-specific adjustments (Deal is kernel-managed)
  let sectorCode = 'MULTIFAMILY';
  try {
    const deal = await kernelFetchJson(`/deals/${dealId}`);
    if (deal?.profile) {
      sectorCode = detectSector(deal.profile);
    }
  } catch (e) {
    // Kernel unavailable, use default sector
    const profile = await prisma.dealProfile?.findUnique({ where: { dealId } }).catch(() => null);
    if (profile) {
      sectorCode = detectSector(profile);
    }
  }

  const scenariosToCreate = ['baseCase', 'downside', 'upside'];
  const createdScenarios = [];

  for (const scenarioKey of scenariosToCreate) {
    const template = DEFAULT_SCENARIOS[scenarioKey];

    // Check if scenario already exists
    const existing = await prisma.underwritingScenario?.findFirst({
      where: { dealId, name: template.name }
    });

    if (existing) {
      createdScenarios.push(existing);
      continue;
    }

    // Apply adjustments to create scenario assumptions
    const assumptions = applyAdjustments(baseModel, template.adjustments, sectorCode, scenarioKey);

    // Calculate results for this scenario
    const results = calculateScenarioResults(baseModel, assumptions);

    // Create the scenario
    const scenario = await prisma.underwritingScenario?.create({
      data: {
        dealId,
        name: template.name,
        description: template.description,
        isBaseCase: template.isBaseCase,
        assumptions: JSON.stringify(assumptions),
        results: JSON.stringify(results),
        createdBy,
        createdByName
      }
    });

    createdScenarios.push(scenario);
  }

  return createdScenarios;
}

/**
 * Apply adjustments to base model values
 */
function applyAdjustments(baseModel, adjustments, sectorCode, scenarioKey) {
  const result = {};

  // Get sector-specific overrides
  const sectorOverrides = SECTOR_ADJUSTMENTS[sectorCode]?.[scenarioKey] || {};

  // Merge template adjustments with sector-specific ones
  const mergedAdjustments = { ...adjustments, ...sectorOverrides };

  // Apply each adjustment
  for (const [field, adjustFn] of Object.entries(mergedAdjustments)) {
    const baseValue = baseModel[field];
    if (baseValue !== undefined && baseValue !== null) {
      result[field] = adjustFn(baseValue);
    }
  }

  return result;
}

/**
 * Calculate results for a scenario
 */
function calculateScenarioResults(baseModel, assumptions) {
  // Merge base model with scenario assumptions
  const scenarioModel = { ...baseModel, ...assumptions };

  try {
    // Use the underwriting calculator to compute results
    const calculated = calculateUnderwriting(scenarioModel);

    return {
      grossPotentialRent: scenarioModel.grossPotentialRent,
      vacancyRate: scenarioModel.vacancyRate,
      effectiveGrossIncome: calculated.effectiveGrossIncome,
      netOperatingIncome: calculated.netOperatingIncome,
      annualDebtService: calculated.annualDebtService,

      // Key returns
      goingInCapRate: calculated.goingInCapRate,
      cashOnCash: calculated.cashOnCash,
      dscr: calculated.dscr,
      irr: calculated.irr,
      equityMultiple: calculated.equityMultiple,
      ltv: calculated.ltv,
      debtYield: calculated.debtYield,

      // Assumptions used
      exitCapRate: scenarioModel.exitCapRate,
      holdPeriod: scenarioModel.holdPeriod,
      rentGrowth: scenarioModel.rentGrowth,
      expenseGrowth: scenarioModel.expenseGrowth
    };
  } catch (error) {
    console.error('Error calculating scenario results:', error);
    return {
      error: error.message,
      calculationFailed: true
    };
  }
}

/**
 * Create a custom scenario
 * @param {string} dealId - The deal ID
 * @param {string} name - Scenario name
 * @param {string} description - Scenario description
 * @param {Object} assumptions - Custom assumption overrides
 * @param {string} createdBy - User ID
 * @param {string} createdByName - User name
 */
export async function createCustomScenario(dealId, name, description, assumptions, createdBy, createdByName) {
  const prisma = getPrisma();

  // Get base model
  const baseModel = await prisma.underwritingModel?.findUnique({ where: { dealId } });
  if (!baseModel) {
    throw new Error('No base underwriting model found for deal');
  }

  // Calculate results
  const results = calculateScenarioResults(baseModel, assumptions);

  // Create scenario
  const scenario = await prisma.underwritingScenario?.create({
    data: {
      dealId,
      name,
      description,
      isBaseCase: false,
      assumptions: JSON.stringify(assumptions),
      results: JSON.stringify(results),
      createdBy,
      createdByName
    }
  });

  return scenario;
}

/**
 * Recalculate all scenarios for a deal (after base model changes)
 */
export async function recalculateAllScenarios(dealId) {
  const prisma = getPrisma();

  // Get base model
  const baseModel = await prisma.underwritingModel?.findUnique({ where: { dealId } });
  if (!baseModel) return [];

  // Get all scenarios
  const scenarios = await prisma.underwritingScenario?.findMany({ where: { dealId } });

  const updated = [];

  for (const scenario of scenarios) {
    const assumptions = JSON.parse(scenario.assumptions || '{}');
    const results = calculateScenarioResults(baseModel, assumptions);

    await prisma.underwritingScenario?.update({
      where: { id: scenario.id },
      data: {
        results: JSON.stringify(results),
        updatedAt: new Date()
      }
    });

    updated.push({ id: scenario.id, name: scenario.name, results });
  }

  return updated;
}

/**
 * Generate scenario comparison table
 */
export async function getScenarioComparison(dealId) {
  const prisma = getPrisma();

  const scenarios = await prisma.underwritingScenario?.findMany({
    where: { dealId },
    orderBy: { isBaseCase: 'desc' } // Base case first
  });

  if (!scenarios || scenarios.length === 0) {
    return { scenarios: [], comparison: null };
  }

  const comparison = {
    metrics: ['irr', 'equityMultiple', 'cashOnCash', 'dscr', 'goingInCapRate', 'exitCapRate'],
    rows: []
  };

  for (const metric of comparison.metrics) {
    const row = {
      metric,
      label: getMetricLabel(metric),
      values: {}
    };

    for (const scenario of scenarios) {
      const results = JSON.parse(scenario.results || '{}');
      row.values[scenario.name] = {
        value: results[metric],
        formatted: formatMetricValue(metric, results[metric])
      };
    }

    comparison.rows.push(row);
  }

  return {
    scenarios: scenarios.map(s => ({
      id: s.id,
      name: s.name,
      description: s.description,
      isBaseCase: s.isBaseCase,
      assumptions: JSON.parse(s.assumptions || '{}'),
      results: JSON.parse(s.results || '{}')
    })),
    comparison
  };
}

/**
 * Helper: Get metric display label
 */
function getMetricLabel(metric) {
  const labels = {
    irr: 'IRR',
    equityMultiple: 'Equity Multiple',
    cashOnCash: 'Cash-on-Cash',
    dscr: 'DSCR',
    goingInCapRate: 'Going-In Cap',
    exitCapRate: 'Exit Cap',
    ltv: 'LTV',
    debtYield: 'Debt Yield'
  };
  return labels[metric] || metric;
}

/**
 * Helper: Format metric value for display
 */
function formatMetricValue(metric, value) {
  if (value == null) return 'N/A';

  switch (metric) {
    case 'irr':
    case 'cashOnCash':
    case 'goingInCapRate':
    case 'exitCapRate':
    case 'ltv':
    case 'debtYield':
      return `${(value * 100).toFixed(2)}%`;
    case 'equityMultiple':
    case 'dscr':
      return `${value.toFixed(2)}x`;
    default:
      return value.toString();
  }
}

export default {
  generateDefaultScenarios,
  createCustomScenario,
  recalculateAllScenarios,
  getScenarioComparison,
  DEFAULT_SCENARIOS,
  SECTOR_ADJUSTMENTS
};
