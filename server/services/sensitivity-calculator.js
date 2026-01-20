/**
 * Sensitivity Analysis Calculator
 *
 * Generates 2D sensitivity matrices showing how returns change
 * with variations in key assumptions (exit cap, vacancy, rent growth, etc.)
 */

import { calculateReturns, projectDetailedCashFlows } from './underwriting-calculator.js';

// Default ranges for sensitivity analysis
const DEFAULT_RANGES = {
  exitCapRate: {
    label: 'Exit Cap Rate',
    min: 0.04,
    max: 0.07,
    step: 0.005,
    format: 'percent',
    decimals: 2
  },
  vacancyRate: {
    label: 'Vacancy Rate',
    min: 0.03,
    max: 0.12,
    step: 0.01,
    format: 'percent',
    decimals: 1
  },
  rentGrowth: {
    label: 'Rent Growth',
    min: 0.00,
    max: 0.05,
    step: 0.005,
    format: 'percent',
    decimals: 1
  },
  expenseGrowth: {
    label: 'Expense Growth',
    min: 0.01,
    max: 0.04,
    step: 0.005,
    format: 'percent',
    decimals: 1
  },
  interestRate: {
    label: 'Interest Rate',
    min: 0.05,
    max: 0.08,
    step: 0.0025,
    format: 'percent',
    decimals: 2
  },
  purchasePrice: {
    label: 'Purchase Price',
    min: -0.10, // -10% from base
    max: 0.10,  // +10% from base
    step: 0.025,
    format: 'percentChange',
    decimals: 1
  },
  holdPeriod: {
    label: 'Hold Period',
    min: 3,
    max: 10,
    step: 1,
    format: 'years',
    decimals: 0
  }
};

// Output metrics that can be analyzed
const OUTPUT_METRICS = {
  irr: {
    label: 'IRR',
    format: 'percent',
    decimals: 1,
    thresholds: { green: 0.15, yellow: 0.10, red: 0 }
  },
  equityMultiple: {
    label: 'Equity Multiple',
    format: 'multiple',
    decimals: 2,
    thresholds: { green: 1.8, yellow: 1.5, red: 1.0 }
  },
  cashOnCash: {
    label: 'Cash-on-Cash',
    format: 'percent',
    decimals: 1,
    thresholds: { green: 0.08, yellow: 0.05, red: 0 }
  },
  dscr: {
    label: 'DSCR',
    format: 'ratio',
    decimals: 2,
    thresholds: { green: 1.35, yellow: 1.20, red: 1.0 }
  },
  goingInCapRate: {
    label: 'Going-In Cap',
    format: 'percent',
    decimals: 2,
    thresholds: { green: 0.055, yellow: 0.045, red: 0 }
  }
};

/**
 * Generate values for a sensitivity axis
 */
function generateAxisValues(field, baseValue, customRange = null) {
  const range = customRange || DEFAULT_RANGES[field];
  if (!range) {
    throw new Error(`Unknown sensitivity field: ${field}`);
  }

  const values = [];

  if (range.format === 'percentChange') {
    // For percentage changes from base (e.g., purchase price +/- 10%)
    for (let pct = range.min; pct <= range.max + 0.0001; pct += range.step) {
      values.push({
        value: baseValue * (1 + pct),
        label: `${pct >= 0 ? '+' : ''}${(pct * 100).toFixed(range.decimals)}%`,
        raw: pct
      });
    }
  } else if (range.format === 'years') {
    // For hold period (integer years)
    for (let yr = range.min; yr <= range.max; yr += range.step) {
      values.push({
        value: yr,
        label: `${yr} yrs`,
        raw: yr
      });
    }
  } else {
    // For percentages (cap rate, vacancy, etc.)
    for (let val = range.min; val <= range.max + 0.0001; val += range.step) {
      values.push({
        value: val,
        label: `${(val * 100).toFixed(range.decimals)}%`,
        raw: val
      });
    }
  }

  return values;
}

/**
 * Calculate a single point in the sensitivity matrix
 */
function calculateSensitivityPoint(baseModel, xField, xValue, yField, yValue, outputMetric) {
  // Create modified model with the sensitivity values
  const modifiedModel = {
    ...baseModel,
    [xField]: xValue,
    [yField]: yValue
  };

  try {
    const results = calculateReturns(modifiedModel);
    return results[outputMetric] || null;
  } catch (error) {
    console.error('Sensitivity calculation error:', error);
    return null;
  }
}

/**
 * Generate a full 2D sensitivity matrix
 *
 * @param {Object} baseModel - The base underwriting model
 * @param {string} xField - Field for X-axis (e.g., 'exitCapRate')
 * @param {string} yField - Field for Y-axis (e.g., 'vacancyRate')
 * @param {string} outputMetric - Metric to calculate (e.g., 'irr')
 * @param {Object} options - Optional customization
 * @returns {Object} - Matrix with values and metadata
 */
export function calculateSensitivityMatrix(baseModel, xField, yField, outputMetric, options = {}) {
  const {
    xRange = null,
    yRange = null,
    maxPoints = 100  // Safety limit
  } = options;

  // Validate fields
  if (!DEFAULT_RANGES[xField]) {
    throw new Error(`Invalid X-axis field: ${xField}`);
  }
  if (!DEFAULT_RANGES[yField]) {
    throw new Error(`Invalid Y-axis field: ${yField}`);
  }
  if (!OUTPUT_METRICS[outputMetric]) {
    throw new Error(`Invalid output metric: ${outputMetric}`);
  }

  // Generate axis values
  const xValues = generateAxisValues(xField, baseModel[xField], xRange);
  const yValues = generateAxisValues(yField, baseModel[yField], yRange);

  // Safety check
  if (xValues.length * yValues.length > maxPoints) {
    throw new Error(`Matrix too large: ${xValues.length} x ${yValues.length} = ${xValues.length * yValues.length} points (max ${maxPoints})`);
  }

  // Calculate matrix
  const matrix = [];
  let minValue = Infinity;
  let maxValue = -Infinity;

  for (const yVal of yValues) {
    const row = [];
    for (const xVal of xValues) {
      const result = calculateSensitivityPoint(
        baseModel,
        xField,
        xVal.value,
        yField,
        yVal.value,
        outputMetric
      );

      if (result !== null) {
        minValue = Math.min(minValue, result);
        maxValue = Math.max(maxValue, result);
      }

      row.push({
        value: result,
        xValue: xVal.value,
        yValue: yVal.value,
        formatted: formatMetricValue(result, outputMetric)
      });
    }
    matrix.push(row);
  }

  // Calculate base case position
  const baseXIndex = xValues.findIndex(v =>
    Math.abs(v.value - baseModel[xField]) < 0.0001
  );
  const baseYIndex = yValues.findIndex(v =>
    Math.abs(v.value - baseModel[yField]) < 0.0001
  );

  // Get base case result
  const baseResult = calculateReturns(baseModel);

  return {
    xField,
    yField,
    outputMetric,
    xAxis: {
      field: xField,
      label: DEFAULT_RANGES[xField].label,
      values: xValues.map(v => v.label),
      rawValues: xValues.map(v => v.value)
    },
    yAxis: {
      field: yField,
      label: DEFAULT_RANGES[yField].label,
      values: yValues.map(v => v.label),
      rawValues: yValues.map(v => v.value)
    },
    metric: {
      key: outputMetric,
      label: OUTPUT_METRICS[outputMetric].label,
      format: OUTPUT_METRICS[outputMetric].format,
      thresholds: OUTPUT_METRICS[outputMetric].thresholds
    },
    matrix,
    stats: {
      min: minValue,
      max: maxValue,
      range: maxValue - minValue
    },
    baseCase: {
      xIndex: baseXIndex,
      yIndex: baseYIndex,
      value: baseResult[outputMetric],
      formatted: formatMetricValue(baseResult[outputMetric], outputMetric)
    }
  };
}

/**
 * Format a metric value for display
 */
function formatMetricValue(value, metric) {
  if (value === null || value === undefined || isNaN(value)) {
    return '—';
  }

  const config = OUTPUT_METRICS[metric];
  if (!config) return value.toString();

  switch (config.format) {
    case 'percent':
      return `${(value * 100).toFixed(config.decimals)}%`;
    case 'multiple':
      return `${value.toFixed(config.decimals)}x`;
    case 'ratio':
      return `${value.toFixed(config.decimals)}x`;
    default:
      return value.toFixed(config.decimals);
  }
}

/**
 * Get color for a cell based on thresholds
 */
export function getCellColor(value, metric) {
  if (value === null || value === undefined || isNaN(value)) {
    return 'neutral';
  }

  const thresholds = OUTPUT_METRICS[metric]?.thresholds;
  if (!thresholds) return 'neutral';

  if (value >= thresholds.green) return 'green';
  if (value >= thresholds.yellow) return 'yellow';
  return 'red';
}

/**
 * Calculate IRR sensitivity by hold period
 * Shows IRR for each potential exit year
 */
export function calculateHoldPeriodSensitivity(baseModel, maxYears = 10) {
  const results = [];

  for (let year = 1; year <= maxYears; year++) {
    const modifiedModel = { ...baseModel, holdPeriod: year };

    try {
      const yearResults = calculateReturns(modifiedModel);
      const cashFlows = projectDetailedCashFlows(modifiedModel, year);

      // Calculate total cash distributed
      const totalCashFlow = cashFlows.years.reduce((sum, y) => sum + y.cashFlow.beforeTaxCashFlow, 0);
      const exitCashFlow = cashFlows.exit?.netEquityProceeds || 0;

      results.push({
        year,
        irr: yearResults.irr,
        equityMultiple: yearResults.equityMultiple,
        cashOnCash: yearResults.cashOnCash,
        totalCashDistributed: totalCashFlow + exitCashFlow,
        exitValue: cashFlows.exit?.grossSalePrice || 0,
        netProceeds: exitCashFlow,
        recommendation: getHoldRecommendation(yearResults.irr, year)
      });
    } catch (error) {
      console.error(`Error calculating hold period ${year}:`, error);
      results.push({
        year,
        irr: null,
        equityMultiple: null,
        cashOnCash: null,
        totalCashDistributed: null,
        exitValue: null,
        netProceeds: null,
        recommendation: 'error'
      });
    }
  }

  // Find optimal exit year (highest IRR)
  const validResults = results.filter(r => r.irr !== null);
  const optimalYear = validResults.length > 0
    ? validResults.reduce((best, curr) => curr.irr > best.irr ? curr : best)
    : null;

  // Find highest total return year
  const highestReturnYear = validResults.length > 0
    ? validResults.reduce((best, curr) =>
        (curr.totalCashDistributed || 0) > (best.totalCashDistributed || 0) ? curr : best
      )
    : null;

  return {
    years: results,
    optimalYear: optimalYear?.year || null,
    optimalIRR: optimalYear?.irr || null,
    highestReturnYear: highestReturnYear?.year || null,
    highestTotalReturn: highestReturnYear?.totalCashDistributed || null
  };
}

/**
 * Get recommendation emoji for hold period
 */
function getHoldRecommendation(irr, year) {
  if (irr === null) return 'error';
  if (irr < 0) return 'negative';
  if (irr < 0.10) return 'caution';
  if (irr < 0.15) return 'acceptable';
  return 'recommended';
}

/**
 * Generate a quick sensitivity summary
 * Shows how key metrics change with +/- one standard deviation
 */
export function calculateQuickSensitivity(baseModel) {
  const baseResults = calculateReturns(baseModel);
  const sensitivities = [];

  // Define sensitivity tests
  const tests = [
    { field: 'exitCapRate', delta: 0.005, label: 'Exit Cap +50bps' },
    { field: 'exitCapRate', delta: -0.005, label: 'Exit Cap -50bps' },
    { field: 'vacancyRate', delta: 0.02, label: 'Vacancy +2%' },
    { field: 'vacancyRate', delta: -0.02, label: 'Vacancy -2%' },
    { field: 'rentGrowth', delta: 0.01, label: 'Rent Growth +1%' },
    { field: 'rentGrowth', delta: -0.01, label: 'Rent Growth -1%' },
    { field: 'interestRate', delta: 0.01, label: 'Interest Rate +100bps' },
    { field: 'interestRate', delta: -0.01, label: 'Interest Rate -100bps' }
  ];

  for (const test of tests) {
    const modifiedModel = {
      ...baseModel,
      [test.field]: (baseModel[test.field] || 0) + test.delta
    };

    try {
      const results = calculateReturns(modifiedModel);
      sensitivities.push({
        label: test.label,
        field: test.field,
        delta: test.delta,
        irr: results.irr,
        irrChange: results.irr - baseResults.irr,
        equityMultiple: results.equityMultiple,
        emChange: results.equityMultiple - baseResults.equityMultiple
      });
    } catch (error) {
      sensitivities.push({
        label: test.label,
        field: test.field,
        delta: test.delta,
        error: error.message
      });
    }
  }

  return {
    baseCase: {
      irr: baseResults.irr,
      equityMultiple: baseResults.equityMultiple,
      cashOnCash: baseResults.cashOnCash,
      dscr: baseResults.dscr
    },
    sensitivities
  };
}

/**
 * Get available fields and metrics for sensitivity analysis
 */
export function getSensitivityOptions() {
  return {
    fields: Object.entries(DEFAULT_RANGES).map(([key, config]) => ({
      value: key,
      label: config.label,
      format: config.format
    })),
    metrics: Object.entries(OUTPUT_METRICS).map(([key, config]) => ({
      value: key,
      label: config.label,
      format: config.format
    }))
  };
}

/**
 * Create a scenario from a sensitivity matrix cell
 */
export function createScenarioFromCell(baseModel, xField, xValue, yField, yValue) {
  const xLabel = DEFAULT_RANGES[xField]?.label || xField;
  const yLabel = DEFAULT_RANGES[yField]?.label || yField;

  // Format values for name
  const xFormatted = formatFieldValue(xValue, xField);
  const yFormatted = formatFieldValue(yValue, yField);

  return {
    name: `${xLabel} ${xFormatted}, ${yLabel} ${yFormatted}`,
    description: `Sensitivity scenario with ${xLabel} at ${xFormatted} and ${yLabel} at ${yFormatted}`,
    assumptions: {
      [xField]: xValue,
      [yField]: yValue
    }
  };
}

/**
 * Format a field value for display
 */
function formatFieldValue(value, field) {
  const range = DEFAULT_RANGES[field];
  if (!range) return value.toString();

  switch (range.format) {
    case 'percent':
    case 'percentChange':
      return `${(value * 100).toFixed(range.decimals)}%`;
    case 'years':
      return `${value} years`;
    default:
      return value.toFixed(range.decimals);
  }
}

export { DEFAULT_RANGES, OUTPUT_METRICS };
