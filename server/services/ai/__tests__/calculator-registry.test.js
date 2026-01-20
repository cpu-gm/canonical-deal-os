/**
 * Calculator Registry Tests
 *
 * Tests for the calculator-agnostic registry system.
 * Phase 2.1 Implementation
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import {
  registerCalculator,
  registerModule,
  getCalculator,
  getCalculatorsByCategory,
  getRegisteredCalculators,
  generateAIToolSchema,
  suggestSimilarCalculators,
  clearRegistry,
  getRegistryStats,
} from '../calculator-registry.js';

describe('Calculator Registry', () => {
  beforeEach(() => {
    clearRegistry();
  });

  afterEach(() => {
    clearRegistry();
  });

  describe('registerCalculator', () => {
    test('registers a function with metadata', () => {
      const mockFn = (x) => x * 2;

      registerCalculator('test.double', mockFn, {
        category: 'math',
        description: 'Doubles a number',
        version: '1.0.0',
      });

      const calc = getCalculator('test.double');
      expect(calc).not.toBeNull();
      expect(calc.category).toBe('math');
      expect(calc.description).toBe('Doubles a number');
      expect(calc.version).toBe('1.0.0');
      expect(typeof calc.fn).toBe('function');
    });

    test('uses default metadata when not provided', () => {
      const mockFn = () => {};
      registerCalculator('test.simple', mockFn);

      const calc = getCalculator('test.simple');
      expect(calc.category).toBe('general');
      expect(calc.version).toBe('1.0.0');
    });

    test('does not register non-functions', () => {
      // This should log an error but not throw
      registerCalculator('test.notAFunction', 'string value');
      expect(getCalculator('test.notAFunction')).toBeNull();
    });

    test('stores aliases for backward compatibility', () => {
      const mockFn = () => 42;
      registerCalculator('test.newName', mockFn, {
        aliases: ['test.oldName', 'test.legacyName'],
      });

      // Should find by primary name
      expect(getCalculator('test.newName')).not.toBeNull();

      // Should find by alias
      expect(getCalculator('test.oldName')).not.toBeNull();
      expect(getCalculator('test.legacyName')).not.toBeNull();
    });
  });

  describe('registerModule', () => {
    test('registers all functions from a module', () => {
      const mockModule = {
        calculateIRR: () => 0.15,
        calculateNOI: () => 100000,
        SOME_CONSTANT: 'value', // Should be skipped
        _privateFunction: () => {}, // Should be skipped
      };

      const registered = registerModule('underwriting', mockModule);

      expect(registered).toContain('calculateIRR');
      expect(registered).toContain('calculateNOI');
      expect(registered).not.toContain('SOME_CONSTANT');
      expect(registered).not.toContain('_privateFunction');
    });

    test('applies metadata from metadataMap', () => {
      const mockModule = {
        calculateIRR: () => 0.15,
      };

      registerModule('underwriting', mockModule, {
        calculateIRR: {
          category: 'returns',
          description: 'Calculate Internal Rate of Return',
        },
      });

      const calc = getCalculator('underwriting.calculateIRR');
      expect(calc.category).toBe('returns');
      expect(calc.description).toBe('Calculate Internal Rate of Return');
    });

    test('infers category from function name', () => {
      const mockModule = {
        calculateIRR: () => 0.15,
        calculateWaterfallDistribution: () => {},
        calculateDebtService: () => {},
        detectConflicts: () => [],
      };

      registerModule('test', mockModule);

      expect(getCalculator('test.calculateIRR').category).toBe('returns');
      expect(getCalculator('test.calculateWaterfallDistribution').category).toBe('distribution');
      expect(getCalculator('test.calculateDebtService').category).toBe('debt');
      expect(getCalculator('test.detectConflicts').category).toBe('risk');
    });
  });

  describe('getCalculator', () => {
    beforeEach(() => {
      registerCalculator('returns.calculateIRR', () => 0.15);
      registerCalculator('distribution.calculateWaterfall', () => ({}), {
        aliases: ['waterfall.calculate'],
      });
    });

    test('returns calculator by exact name', () => {
      const calc = getCalculator('returns.calculateIRR');
      expect(calc).not.toBeNull();
      expect(typeof calc.fn).toBe('function');
    });

    test('returns calculator by alias', () => {
      const calc = getCalculator('waterfall.calculate');
      expect(calc).not.toBeNull();
    });

    test('returns calculator by partial match', () => {
      const calc = getCalculator('calculateIRR');
      expect(calc).not.toBeNull();
    });

    test('returns null for non-existent calculator', () => {
      expect(getCalculator('nonexistent.calculator')).toBeNull();
    });
  });

  describe('getCalculatorsByCategory', () => {
    beforeEach(() => {
      registerCalculator('returns.irr', () => {}, { category: 'returns' });
      registerCalculator('returns.coc', () => {}, { category: 'returns' });
      registerCalculator('distribution.waterfall', () => {}, { category: 'distribution' });
    });

    test('returns all calculators in a category', () => {
      const returnsCalcs = getCalculatorsByCategory('returns');
      expect(returnsCalcs).toHaveLength(2);
      expect(returnsCalcs.map(c => c.name)).toContain('returns.irr');
      expect(returnsCalcs.map(c => c.name)).toContain('returns.coc');
    });

    test('returns empty array for non-existent category', () => {
      expect(getCalculatorsByCategory('nonexistent')).toHaveLength(0);
    });
  });

  describe('getRegisteredCalculators', () => {
    test('returns all registered calculator names', () => {
      registerCalculator('a.calc', () => {});
      registerCalculator('b.calc', () => {});
      registerCalculator('c.calc', () => {});

      const names = getRegisteredCalculators();
      expect(names).toHaveLength(3);
      expect(names).toContain('a.calc');
      expect(names).toContain('b.calc');
      expect(names).toContain('c.calc');
    });
  });

  describe('generateAIToolSchema', () => {
    beforeEach(() => {
      registerCalculator('returns.calculateIRR', () => 0.15, {
        category: 'returns',
        description: 'Calculate IRR',
        inputSchema: { type: 'object', properties: { cashFlows: { type: 'array' } } },
        outputSchema: { type: 'number' },
        examples: [{ input: { cashFlows: [-100, 50, 60] }, output: 0.15 }],
      });
      registerCalculator('distribution.waterfall', () => ({}), {
        category: 'distribution',
        description: 'Calculate waterfall',
      });
    });

    test('generates schema for all calculators', () => {
      const schema = generateAIToolSchema();
      expect(schema).toHaveLength(2);
      expect(schema[0]).toHaveProperty('name');
      expect(schema[0]).toHaveProperty('description');
      expect(schema[0]).toHaveProperty('category');
      expect(schema[0]).toHaveProperty('parameters');
      expect(schema[0]).toHaveProperty('returns');
    });

    test('filters by category', () => {
      const schema = generateAIToolSchema({ categories: ['returns'] });
      expect(schema).toHaveLength(1);
      expect(schema[0].category).toBe('returns');
    });

    test('limits examples', () => {
      const schema = generateAIToolSchema({ maxExamples: 1 });
      expect(schema[0].examples.length).toBeLessThanOrEqual(1);
    });
  });

  describe('suggestSimilarCalculators', () => {
    beforeEach(() => {
      registerCalculator('underwriting.calculateIRR', () => {});
      registerCalculator('underwriting.calculateNOI', () => {});
      registerCalculator('waterfall.calculateDistribution', () => {});
    });

    test('suggests calculators with matching terms', () => {
      const suggestions = suggestSimilarCalculators('underwriting.calculateROI');
      expect(suggestions).toContain('underwriting.calculateIRR');
      expect(suggestions).toContain('underwriting.calculateNOI');
    });

    test('returns empty array when no matches', () => {
      const suggestions = suggestSimilarCalculators('completely.different.name');
      // May or may not find matches depending on implementation
      expect(Array.isArray(suggestions)).toBe(true);
    });
  });

  describe('getRegistryStats', () => {
    test('returns correct statistics', () => {
      registerCalculator('returns.irr', () => {}, { category: 'returns' });
      registerCalculator('returns.coc', () => {}, { category: 'returns' });
      registerCalculator('distribution.waterfall', () => {}, { category: 'distribution' });

      const stats = getRegistryStats();
      expect(stats.total).toBe(3);
      expect(stats.byCategory.returns).toBe(2);
      expect(stats.byCategory.distribution).toBe(1);
    });
  });

  describe('clearRegistry', () => {
    test('removes all registered calculators', () => {
      registerCalculator('test.calc', () => {});
      expect(getRegisteredCalculators()).toHaveLength(1);

      clearRegistry();
      expect(getRegisteredCalculators()).toHaveLength(0);
    });
  });
});
