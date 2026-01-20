/**
 * Calculator Registry - Schema Discovery for Calculator-Agnostic AI
 *
 * This registry discovers and catalogs calculator capabilities at runtime,
 * allowing the AI layer to adapt when calculators change without breaking.
 *
 * Design Principles:
 * 1. Schema Discovery - Introspect calculators instead of hardcoding
 * 2. Version Tolerance - Handle renamed/missing fields gracefully
 * 3. Aliasing - Support old function names for backward compatibility
 *
 * Phase 2.1 Implementation
 */

// Registry stores discovered calculators with metadata
const calculatorRegistry = new Map();

// Configuration
export const REGISTRY_CONFIG = {
  debug: process.env.DEBUG_AI_REGISTRY === 'true',
  strictMode: process.env.CALCULATOR_STRICT_MODE === 'true',
  versionTolerance: process.env.CALCULATOR_VERSION_TOLERANCE !== 'false',
};

/**
 * Calculator metadata schema
 * @typedef {Object} CalculatorMetadata
 * @property {Function} fn - The calculator function
 * @property {Object} inputSchema - JSON Schema for inputs
 * @property {Object} outputSchema - JSON Schema for outputs
 * @property {string} category - Category: 'returns', 'distribution', 'risk', 'debt', 'sensitivity'
 * @property {string} description - Human-readable description for AI
 * @property {string} version - Semantic version
 * @property {string[]} aliases - Alternative names for backward compatibility
 * @property {Object[]} examples - Example input/output pairs for few-shot prompting
 */

/**
 * Register a calculator with its metadata
 *
 * @param {string} name - Unique calculator name (e.g., 'underwriting.calculateIRR')
 * @param {Function} fn - The calculator function
 * @param {Object} metadata - Schema and description
 */
export function registerCalculator(name, fn, metadata = {}) {
  if (typeof fn !== 'function') {
    console.error(`[AI-REGISTRY] Cannot register '${name}': not a function`);
    return;
  }

  const registration = {
    fn,
    inputSchema: metadata.inputSchema || {},
    outputSchema: metadata.outputSchema || {},
    category: metadata.category || 'general',
    description: metadata.description || `Calculator: ${name}`,
    version: metadata.version || '1.0.0',
    aliases: metadata.aliases || [],
    examples: metadata.examples || [],
    registeredAt: new Date().toISOString(),
  };

  calculatorRegistry.set(name, registration);

  if (REGISTRY_CONFIG.debug) {
    console.log(`[AI-REGISTRY] Registered: ${name} (category: ${registration.category})`);
  }
}

/**
 * Bulk register calculators from a module
 *
 * @param {string} moduleName - Base name for the module (e.g., 'underwriting')
 * @param {Object} moduleExports - The module's exports
 * @param {Object} metadataMap - Optional metadata per function name
 * @returns {string[]} List of registered function names
 */
export function registerModule(moduleName, moduleExports, metadataMap = {}) {
  const registered = [];

  for (const [key, value] of Object.entries(moduleExports)) {
    // Skip non-functions and private functions (starting with _)
    if (typeof value !== 'function' || key.startsWith('_')) {
      continue;
    }

    // Skip constants (all uppercase)
    if (key === key.toUpperCase()) {
      continue;
    }

    const fullName = `${moduleName}.${key}`;
    const metadata = metadataMap[key] || inferMetadata(key, value);

    registerCalculator(fullName, value, metadata);
    registered.push(key);
  }

  if (REGISTRY_CONFIG.debug) {
    console.log(`[AI-REGISTRY] Registered ${registered.length} functions from '${moduleName}'`);
  }

  return registered;
}

/**
 * Infer metadata from function name and signature
 *
 * @param {string} name - Function name
 * @param {Function} fn - The function
 * @returns {Object} Inferred metadata
 */
function inferMetadata(name, fn) {
  // Infer category from function name
  let category = 'general';
  if (name.includes('IRR') || name.includes('Return') || name.includes('CashFlow')) {
    category = 'returns';
  } else if (name.includes('Waterfall') || name.includes('Distribution') || name.includes('Allocation')) {
    category = 'distribution';
  } else if (name.includes('Sensitivity') || name.includes('Scenario')) {
    category = 'sensitivity';
  } else if (name.includes('Debt') || name.includes('Loan') || name.includes('DSCR')) {
    category = 'debt';
  } else if (name.includes('Conflict') || name.includes('Risk') || name.includes('Validate')) {
    category = 'risk';
  }

  // Generate description from camelCase name
  const description = name
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, str => str.toUpperCase())
    .trim();

  return {
    category,
    description,
    inputSchema: {},
    outputSchema: {},
  };
}

/**
 * Get calculator by name with alias fallback
 *
 * @param {string} name - Calculator name
 * @returns {CalculatorMetadata|null} Calculator metadata or null
 */
export function getCalculator(name) {
  // Direct lookup
  if (calculatorRegistry.has(name)) {
    return calculatorRegistry.get(name);
  }

  // Search by alias
  for (const [regName, calc] of calculatorRegistry) {
    if (calc.aliases.includes(name)) {
      if (REGISTRY_CONFIG.debug) {
        console.log(`[AI-REGISTRY] Resolved alias '${name}' -> '${regName}'`);
      }
      return calc;
    }
  }

  // Partial match (for backward compatibility)
  const shortName = name.split('.').pop();
  for (const [regName, calc] of calculatorRegistry) {
    if (regName.endsWith(`.${shortName}`)) {
      if (REGISTRY_CONFIG.debug) {
        console.log(`[AI-REGISTRY] Partial match '${name}' -> '${regName}'`);
      }
      return calc;
    }
  }

  return null;
}

/**
 * Get all calculators in a category
 *
 * @param {string} category - Category to filter by
 * @returns {Object[]} Array of { name, ...metadata }
 */
export function getCalculatorsByCategory(category) {
  const results = [];

  for (const [name, calc] of calculatorRegistry) {
    if (calc.category === category) {
      results.push({ name, ...calc });
    }
  }

  return results;
}

/**
 * Get all registered calculator names
 *
 * @returns {string[]} Array of calculator names
 */
export function getRegisteredCalculators() {
  return Array.from(calculatorRegistry.keys());
}

/**
 * Generate AI-consumable tool schema for all calculators
 * This is what the AI uses to understand available tools
 *
 * @param {Object} options - Options
 * @param {string[]} options.categories - Filter by categories
 * @param {number} options.maxExamples - Max examples per calculator
 * @returns {Object[]} Array of tool schemas
 */
export function generateAIToolSchema(options = {}) {
  const { categories = null, maxExamples = 2 } = options;
  const tools = [];

  for (const [name, calc] of calculatorRegistry) {
    // Filter by category if specified
    if (categories && !categories.includes(calc.category)) {
      continue;
    }

    tools.push({
      name,
      description: calc.description,
      category: calc.category,
      version: calc.version,
      parameters: calc.inputSchema,
      returns: calc.outputSchema,
      examples: calc.examples.slice(0, maxExamples),
    });
  }

  return tools;
}

/**
 * Find similar calculators (for suggestions when not found)
 *
 * @param {string} name - Calculator name that wasn't found
 * @returns {string[]} Array of similar calculator names
 */
export function suggestSimilarCalculators(name) {
  const suggestions = [];
  const searchTerms = name.toLowerCase().split('.');

  for (const regName of calculatorRegistry.keys()) {
    const regTerms = regName.toLowerCase();
    for (const term of searchTerms) {
      if (regTerms.includes(term) && !suggestions.includes(regName)) {
        suggestions.push(regName);
      }
    }
  }

  return suggestions.slice(0, 5);
}

/**
 * Clear all registered calculators (for testing)
 */
export function clearRegistry() {
  calculatorRegistry.clear();
  if (REGISTRY_CONFIG.debug) {
    console.log('[AI-REGISTRY] Registry cleared');
  }
}

/**
 * Get registry statistics
 *
 * @returns {Object} Statistics about registered calculators
 */
export function getRegistryStats() {
  const stats = {
    total: calculatorRegistry.size,
    byCategory: {},
  };

  for (const calc of calculatorRegistry.values()) {
    stats.byCategory[calc.category] = (stats.byCategory[calc.category] || 0) + 1;
  }

  return stats;
}

export default {
  registerCalculator,
  registerModule,
  getCalculator,
  getCalculatorsByCategory,
  getRegisteredCalculators,
  generateAIToolSchema,
  suggestSimilarCalculators,
  clearRegistry,
  getRegistryStats,
  REGISTRY_CONFIG,
};
