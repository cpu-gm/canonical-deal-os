/**
 * Calculator Adapter - Version-Tolerant Calculator Execution
 *
 * Provides a layer between AI features and calculators that:
 * 1. Handles missing/renamed fields gracefully
 * 2. Transforms inputs/outputs for AI consumption
 * 3. Provides fallback behavior when calculators fail
 * 4. Logs all operations for debugging
 *
 * Phase 2.1 Implementation
 */

import {
  getCalculator,
  suggestSimilarCalculators,
  REGISTRY_CONFIG,
} from './calculator-registry.js';

// Configuration
export const ADAPTER_CONFIG = {
  debug: process.env.DEBUG_AI_ADAPTER === 'true',
  strictMode: process.env.CALCULATOR_STRICT_MODE === 'true',
  versionTolerance: process.env.CALCULATOR_VERSION_TOLERANCE !== 'false',
  logExecutions: process.env.LOG_CALCULATOR_EXECUTIONS !== 'false',
};

// Execution history for debugging
const executionHistory = [];
const MAX_HISTORY = 100;

/**
 * Execute a calculator with AI-friendly input/output transformation
 *
 * @param {string} calculatorName - Name of the calculator to execute
 * @param {Object} inputs - Input parameters
 * @param {Object} options - Execution options
 * @returns {Object} Result with success flag, data, and metadata
 */
export async function executeCalculator(calculatorName, inputs, options = {}) {
  const startTime = Date.now();
  const executionId = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  if (ADAPTER_CONFIG.debug) {
    console.log(`[AI-ADAPTER] [${executionId}] Starting execution: ${calculatorName}`);
    console.log(`[AI-ADAPTER] [${executionId}] Inputs:`, JSON.stringify(inputs, null, 2));
  }

  // Get calculator from registry
  const calculator = getCalculator(calculatorName);

  if (!calculator) {
    const suggestions = suggestSimilarCalculators(calculatorName);
    const result = {
      success: false,
      executionId,
      calculatorName,
      error: `Calculator '${calculatorName}' not found`,
      suggestions,
      duration: Date.now() - startTime,
    };

    console.warn(`[AI-ADAPTER] [${executionId}] Calculator not found: ${calculatorName}`);
    if (suggestions.length > 0) {
      console.warn(`[AI-ADAPTER] [${executionId}] Suggestions: ${suggestions.join(', ')}`);
    }

    logExecution(result);
    return result;
  }

  try {
    // Transform inputs with version tolerance
    const transformedInputs = transformInputs(inputs, calculator.inputSchema, options);

    if (ADAPTER_CONFIG.debug) {
      console.log(`[AI-ADAPTER] [${executionId}] Transformed inputs:`, JSON.stringify(transformedInputs, null, 2));
    }

    // Execute calculator
    const rawResult = await calculator.fn(transformedInputs);

    if (ADAPTER_CONFIG.debug) {
      console.log(`[AI-ADAPTER] [${executionId}] Raw result:`, JSON.stringify(rawResult, null, 2));
    }

    // Transform output for AI consumption
    const aiResult = transformOutputForAI(rawResult, calculator.outputSchema, options);

    const result = {
      success: true,
      executionId,
      calculatorName,
      calculatorVersion: calculator.version,
      category: calculator.category,
      inputs: transformedInputs,
      result: aiResult,
      rawResult: options.includeRaw ? rawResult : undefined,
      metadata: {
        executedAt: new Date().toISOString(),
        duration: Date.now() - startTime,
      },
    };

    if (ADAPTER_CONFIG.logExecutions) {
      console.log(`[AI-ADAPTER] [${executionId}] Success: ${calculatorName} (${result.metadata.duration}ms)`);
    }

    logExecution(result);
    return result;

  } catch (error) {
    const result = {
      success: false,
      executionId,
      calculatorName,
      calculatorVersion: calculator.version,
      error: error.message,
      errorStack: ADAPTER_CONFIG.debug ? error.stack : undefined,
      inputs,
      fallbackResult: options.enableFallback ? attemptFallback(calculatorName, inputs, error) : undefined,
      metadata: {
        executedAt: new Date().toISOString(),
        duration: Date.now() - startTime,
      },
    };

    console.error(`[AI-ADAPTER] [${executionId}] Error in ${calculatorName}:`, error.message);
    if (ADAPTER_CONFIG.debug) {
      console.error(`[AI-ADAPTER] [${executionId}] Stack:`, error.stack);
    }

    logExecution(result);
    return result;
  }
}

/**
 * Transform inputs with version tolerance
 * Handles missing fields, renamed fields, and type coercion
 *
 * @param {Object} inputs - Original inputs
 * @param {Object} schema - Input schema
 * @param {Object} options - Transformation options
 * @returns {Object} Transformed inputs
 */
function transformInputs(inputs, schema, options = {}) {
  const transformed = { ...inputs };
  const { fieldMappings = {}, defaults = {} } = options;

  // Apply field mappings (handles renamed fields between versions)
  for (const [oldName, newName] of Object.entries(fieldMappings)) {
    if (inputs[oldName] !== undefined && inputs[newName] === undefined) {
      transformed[newName] = inputs[oldName];
      delete transformed[oldName];

      if (ADAPTER_CONFIG.debug) {
        console.log(`[AI-ADAPTER] Field mapping: ${oldName} -> ${newName}`);
      }
    }
  }

  // Apply defaults from schema
  if (schema.properties && ADAPTER_CONFIG.versionTolerance) {
    for (const [field, fieldSchema] of Object.entries(schema.properties)) {
      if (transformed[field] === undefined) {
        if (fieldSchema.default !== undefined) {
          transformed[field] = fieldSchema.default;
          if (ADAPTER_CONFIG.debug) {
            console.log(`[AI-ADAPTER] Applied schema default: ${field} = ${fieldSchema.default}`);
          }
        } else if (defaults[field] !== undefined) {
          transformed[field] = defaults[field];
          if (ADAPTER_CONFIG.debug) {
            console.log(`[AI-ADAPTER] Applied option default: ${field} = ${defaults[field]}`);
          }
        }
      }
    }
  }

  // Type coercion for common mismatches
  for (const [field, value] of Object.entries(transformed)) {
    const fieldSchema = schema.properties?.[field];
    if (!fieldSchema) continue;

    // String to number
    if (fieldSchema.type === 'number' && typeof value === 'string') {
      const parsed = parseFloat(value);
      if (!isNaN(parsed)) {
        transformed[field] = parsed;
        if (ADAPTER_CONFIG.debug) {
          console.log(`[AI-ADAPTER] Type coercion: ${field} string -> number`);
        }
      }
    }

    // Number to boolean
    if (fieldSchema.type === 'boolean' && typeof value === 'number') {
      transformed[field] = value !== 0;
      if (ADAPTER_CONFIG.debug) {
        console.log(`[AI-ADAPTER] Type coercion: ${field} number -> boolean`);
      }
    }
  }

  return transformed;
}

/**
 * Transform calculator output for AI consumption
 * Adds descriptions, formatting hints, and units
 *
 * @param {*} result - Raw calculator result
 * @param {Object} schema - Output schema
 * @param {Object} options - Transformation options
 * @returns {Object} AI-friendly result
 */
function transformOutputForAI(result, schema, options = {}) {
  // Handle non-object results
  if (result === null || result === undefined) {
    return result;
  }

  if (typeof result !== 'object') {
    return {
      value: result,
      formatted: formatValue(result, inferFormat(result)),
    };
  }

  // Handle arrays
  if (Array.isArray(result)) {
    return result.map(item => transformOutputForAI(item, schema.items || {}, options));
  }

  // Transform object fields
  const enhanced = {};

  for (const [key, value] of Object.entries(result)) {
    const fieldMeta = schema.properties?.[key] || {};

    // Skip internal/private fields
    if (key.startsWith('_')) continue;

    // Recursively transform nested objects
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      enhanced[key] = transformOutputForAI(value, fieldMeta, options);
      continue;
    }

    // Transform primitive values
    enhanced[key] = {
      value,
      formatted: formatValue(value, fieldMeta.format || inferFormat(value, key)),
      description: fieldMeta.description || humanizeFieldName(key),
      unit: fieldMeta.unit || inferUnit(key),
    };
  }

  return enhanced;
}

/**
 * Format a value based on its format type
 *
 * @param {*} value - The value to format
 * @param {string} format - Format type
 * @returns {string} Formatted value
 */
function formatValue(value, format) {
  if (value === null || value === undefined) {
    return 'N/A';
  }

  switch (format) {
    case 'currency':
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0,
      }).format(value);

    case 'percent':
      return `${(value * 100).toFixed(2)}%`;

    case 'decimal':
      return value.toFixed(2);

    case 'integer':
      return Math.round(value).toLocaleString();

    case 'date':
      return new Date(value).toLocaleDateString();

    default:
      if (typeof value === 'number') {
        return value.toLocaleString();
      }
      return String(value);
  }
}

/**
 * Infer format from value and field name
 *
 * @param {*} value - The value
 * @param {string} fieldName - Field name
 * @returns {string} Inferred format
 */
function inferFormat(value, fieldName = '') {
  const name = fieldName.toLowerCase();

  // Currency fields
  if (name.includes('price') || name.includes('amount') || name.includes('noi') ||
      name.includes('revenue') || name.includes('expense') || name.includes('cost') ||
      name.includes('value') || name.includes('cash')) {
    return 'currency';
  }

  // Percentage fields
  if (name.includes('rate') || name.includes('percent') || name.includes('ratio') ||
      name.includes('irr') || name.includes('yield') || name.includes('growth') ||
      name.includes('vacancy') || name.includes('ltv') || name.includes('dscr')) {
    // Check if value is already a decimal (0-1) or percentage (0-100)
    if (typeof value === 'number' && Math.abs(value) <= 1) {
      return 'percent';
    }
  }

  // Count fields
  if (name.includes('count') || name.includes('units') || name.includes('number')) {
    return 'integer';
  }

  return 'default';
}

/**
 * Infer unit from field name
 *
 * @param {string} fieldName - Field name
 * @returns {string|null} Inferred unit
 */
function inferUnit(fieldName) {
  const name = fieldName.toLowerCase();

  if (name.includes('sqft') || name.includes('squarefeet') || name.includes('sf')) {
    return 'sq ft';
  }
  if (name.includes('acres')) {
    return 'acres';
  }
  if (name.includes('years') || name.includes('term')) {
    return 'years';
  }
  if (name.includes('months')) {
    return 'months';
  }
  if (name.includes('days')) {
    return 'days';
  }
  if (name.includes('units')) {
    return 'units';
  }

  return null;
}

/**
 * Convert camelCase field name to human-readable description
 *
 * @param {string} fieldName - camelCase field name
 * @returns {string} Human-readable description
 */
function humanizeFieldName(fieldName) {
  return fieldName
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, str => str.toUpperCase())
    .trim();
}

/**
 * Attempt fallback when calculator fails
 *
 * @param {string} calculatorName - Calculator that failed
 * @param {Object} inputs - Original inputs
 * @param {Error} error - The error
 * @returns {Object|null} Fallback result or null
 */
function attemptFallback(calculatorName, inputs, error) {
  if (ADAPTER_CONFIG.debug) {
    console.log(`[AI-ADAPTER] Attempting fallback for ${calculatorName}`);
  }

  // Define fallback strategies per calculator category
  const fallbacks = {
    'returns': () => ({
      warning: 'Fallback values - calculator error',
      irr: null,
      cashOnCash: null,
      equityMultiple: null,
    }),
    'distribution': () => ({
      warning: 'Fallback values - calculator error',
      totalDistribution: null,
      lpShare: null,
      gpShare: null,
    }),
  };

  // Extract category from calculator name
  const category = calculatorName.split('.')[0];
  const fallbackFn = fallbacks[category];

  if (fallbackFn) {
    const result = fallbackFn();
    console.log(`[AI-ADAPTER] Fallback applied for ${calculatorName}`);
    return result;
  }

  return null;
}

/**
 * Log execution to history
 *
 * @param {Object} result - Execution result
 */
function logExecution(result) {
  executionHistory.unshift({
    ...result,
    timestamp: new Date().toISOString(),
  });

  // Trim history
  if (executionHistory.length > MAX_HISTORY) {
    executionHistory.pop();
  }
}

/**
 * Get recent execution history
 *
 * @param {number} limit - Max entries to return
 * @returns {Object[]} Recent executions
 */
export function getExecutionHistory(limit = 10) {
  return executionHistory.slice(0, limit);
}

/**
 * Get execution statistics
 *
 * @returns {Object} Execution stats
 */
export function getExecutionStats() {
  const successful = executionHistory.filter(e => e.success).length;
  const failed = executionHistory.filter(e => !e.success).length;
  const avgDuration = executionHistory.length > 0
    ? executionHistory.reduce((sum, e) => sum + (e.metadata?.duration || 0), 0) / executionHistory.length
    : 0;

  // Group by calculator
  const byCalculator = {};
  for (const exec of executionHistory) {
    const name = exec.calculatorName;
    if (!byCalculator[name]) {
      byCalculator[name] = { total: 0, success: 0, failed: 0 };
    }
    byCalculator[name].total++;
    if (exec.success) {
      byCalculator[name].success++;
    } else {
      byCalculator[name].failed++;
    }
  }

  return {
    total: executionHistory.length,
    successful,
    failed,
    successRate: executionHistory.length > 0 ? (successful / executionHistory.length * 100).toFixed(1) + '%' : 'N/A',
    avgDuration: Math.round(avgDuration) + 'ms',
    byCalculator,
  };
}

/**
 * Clear execution history (for testing)
 */
export function clearExecutionHistory() {
  executionHistory.length = 0;
  if (ADAPTER_CONFIG.debug) {
    console.log('[AI-ADAPTER] Execution history cleared');
  }
}

/**
 * Execute multiple calculators in sequence, passing results forward
 *
 * @param {Object[]} steps - Array of { calculator, inputs, inputMapping }
 * @returns {Object} Combined results
 */
export async function executeCalculatorChain(steps) {
  const results = [];
  let previousResult = null;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    let inputs = { ...step.inputs };

    // Apply input mapping from previous result
    if (previousResult && step.inputMapping) {
      for (const [targetField, sourceField] of Object.entries(step.inputMapping)) {
        const value = getNestedValue(previousResult.result, sourceField);
        if (value !== undefined) {
          inputs[targetField] = value?.value ?? value;
        }
      }
    }

    if (ADAPTER_CONFIG.debug) {
      console.log(`[AI-ADAPTER] Chain step ${i + 1}/${steps.length}: ${step.calculator}`);
    }

    const result = await executeCalculator(step.calculator, inputs, step.options);
    results.push(result);

    if (!result.success) {
      console.warn(`[AI-ADAPTER] Chain failed at step ${i + 1}: ${step.calculator}`);
      break;
    }

    previousResult = result;
  }

  return {
    success: results.every(r => r.success),
    steps: results,
    finalResult: results[results.length - 1],
  };
}

/**
 * Get nested value from object using dot notation
 *
 * @param {Object} obj - Source object
 * @param {string} path - Dot-notation path
 * @returns {*} Value or undefined
 */
function getNestedValue(obj, path) {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}

export default {
  executeCalculator,
  executeCalculatorChain,
  getExecutionHistory,
  getExecutionStats,
  clearExecutionHistory,
  ADAPTER_CONFIG,
};
