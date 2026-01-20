/**
 * Calculator Adapter Tests
 *
 * Tests for the version-tolerant calculator execution layer.
 * Phase 2.1 Implementation
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import {
  executeCalculator,
  executeCalculatorChain,
  getExecutionHistory,
  getExecutionStats,
  clearExecutionHistory,
} from '../calculator-adapter.js';
import {
  registerCalculator,
  clearRegistry,
} from '../calculator-registry.js';

describe('Calculator Adapter', () => {
  beforeEach(() => {
    clearRegistry();
    clearExecutionHistory();
  });

  afterEach(() => {
    clearRegistry();
    clearExecutionHistory();
  });

  describe('executeCalculator', () => {
    test('executes registered calculator successfully', async () => {
      registerCalculator('math.double', (inputs) => inputs.value * 2);

      const result = await executeCalculator('math.double', { value: 5 });

      expect(result.success).toBe(true);
      expect(result.calculatorName).toBe('math.double');
      expect(result.result).toBeDefined();
      expect(result.metadata.duration).toBeGreaterThanOrEqual(0);
    });

    test('returns error for non-existent calculator', async () => {
      const result = await executeCalculator('nonexistent.calc', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
      expect(result.suggestions).toBeDefined();
    });

    test('handles calculator that throws error', async () => {
      registerCalculator('error.thrower', () => {
        throw new Error('Intentional error');
      });

      const result = await executeCalculator('error.thrower', {});

      expect(result.success).toBe(false);
      expect(result.error).toBe('Intentional error');
    });

    test('provides suggestions for similar calculators', async () => {
      registerCalculator('underwriting.calculateIRR', () => 0.15);
      registerCalculator('underwriting.calculateNOI', () => 100000);

      const result = await executeCalculator('underwriting.calculateROI', {});

      expect(result.success).toBe(false);
      expect(result.suggestions).toContain('underwriting.calculateIRR');
    });

    test('transforms output for AI consumption', async () => {
      registerCalculator('returns.getMetrics', () => ({
        irr: 0.15,
        purchasePrice: 1000000,
        vacancy: 0.05,
      }), {
        outputSchema: {
          properties: {
            irr: { format: 'percent', description: 'Internal Rate of Return' },
            purchasePrice: { format: 'currency', description: 'Purchase Price' },
            vacancy: { format: 'percent', description: 'Vacancy Rate' },
          },
        },
      });

      const result = await executeCalculator('returns.getMetrics', {});

      expect(result.success).toBe(true);
      expect(result.result.irr.value).toBe(0.15);
      expect(result.result.irr.formatted).toContain('%');
      expect(result.result.purchasePrice.formatted).toContain('$');
    });

    test('applies field mappings for version tolerance', async () => {
      registerCalculator('test.calc', (inputs) => inputs.newFieldName);

      const result = await executeCalculator(
        'test.calc',
        { oldFieldName: 'test value' },
        { fieldMappings: { oldFieldName: 'newFieldName' } }
      );

      expect(result.success).toBe(true);
    });

    test('applies default values from options', async () => {
      registerCalculator('test.calc', (inputs) => inputs.requiredField || 'default used');

      const result = await executeCalculator(
        'test.calc',
        {},
        { defaults: { requiredField: 'default value' } }
      );

      expect(result.success).toBe(true);
    });

    test('includes execution ID for tracking', async () => {
      registerCalculator('test.calc', () => 'result');

      const result = await executeCalculator('test.calc', {});

      expect(result.executionId).toBeDefined();
      expect(result.executionId).toMatch(/^exec_/);
    });

    test('includes raw result when requested', async () => {
      const rawValue = { nested: { value: 42 } };
      registerCalculator('test.calc', () => rawValue);

      const result = await executeCalculator('test.calc', {}, { includeRaw: true });

      expect(result.success).toBe(true);
      expect(result.rawResult).toEqual(rawValue);
    });
  });

  describe('input transformation', () => {
    test('coerces string to number when schema expects number', async () => {
      registerCalculator('test.calc', (inputs) => inputs.value * 2, {
        inputSchema: {
          properties: {
            value: { type: 'number' },
          },
        },
      });

      const result = await executeCalculator('test.calc', { value: '5' });

      expect(result.success).toBe(true);
      expect(result.inputs.value).toBe(5);
    });

    test('applies schema defaults for missing fields', async () => {
      registerCalculator('test.calc', (inputs) => inputs.rate, {
        inputSchema: {
          properties: {
            rate: { type: 'number', default: 0.05 },
          },
        },
      });

      const result = await executeCalculator('test.calc', {});

      expect(result.success).toBe(true);
      expect(result.inputs.rate).toBe(0.05);
    });
  });

  describe('output formatting', () => {
    test('formats currency values', async () => {
      registerCalculator('test.calc', () => ({ purchasePrice: 1500000 }));

      const result = await executeCalculator('test.calc', {});

      expect(result.success).toBe(true);
      // Should infer currency format from field name
      expect(result.result.purchasePrice.formatted).toMatch(/\$.*1.*500.*000/);
    });

    test('formats percentage values', async () => {
      registerCalculator('test.calc', () => ({ vacancyRate: 0.08 }));

      const result = await executeCalculator('test.calc', {});

      expect(result.success).toBe(true);
      // Should infer percent format from field name
      expect(result.result.vacancyRate.formatted).toContain('%');
    });

    test('humanizes field names', async () => {
      registerCalculator('test.calc', () => ({ netOperatingIncome: 100000 }));

      const result = await executeCalculator('test.calc', {});

      expect(result.success).toBe(true);
      expect(result.result.netOperatingIncome.description).toBe('Net Operating Income');
    });

    test('handles null and undefined values', async () => {
      registerCalculator('test.calc', () => ({ value: null, other: undefined }));

      const result = await executeCalculator('test.calc', {});

      expect(result.success).toBe(true);
      expect(result.result.value.formatted).toBe('N/A');
    });

    test('handles arrays', async () => {
      registerCalculator('test.calc', () => [1, 2, 3]);

      const result = await executeCalculator('test.calc', {});

      expect(result.success).toBe(true);
      expect(Array.isArray(result.result)).toBe(true);
    });

    test('handles nested objects', async () => {
      registerCalculator('test.calc', () => ({
        metrics: {
          irr: 0.15,
          nested: { deep: 'value' },
        },
      }));

      const result = await executeCalculator('test.calc', {});

      expect(result.success).toBe(true);
      expect(result.result.metrics).toBeDefined();
    });
  });

  describe('executeCalculatorChain', () => {
    test('executes multiple calculators in sequence', async () => {
      registerCalculator('step1.calc', () => ({ value: 10 }));
      registerCalculator('step2.calc', (inputs) => ({ doubled: inputs.input * 2 }));

      const result = await executeCalculatorChain([
        { calculator: 'step1.calc', inputs: {} },
        {
          calculator: 'step2.calc',
          inputs: {},
          inputMapping: { input: 'value.value' },
        },
      ]);

      expect(result.success).toBe(true);
      expect(result.steps).toHaveLength(2);
      expect(result.steps[0].success).toBe(true);
      expect(result.steps[1].success).toBe(true);
    });

    test('stops chain on first failure', async () => {
      registerCalculator('step1.calc', () => {
        throw new Error('Step 1 failed');
      });
      registerCalculator('step2.calc', () => ({ value: 'never reached' }));

      const result = await executeCalculatorChain([
        { calculator: 'step1.calc', inputs: {} },
        { calculator: 'step2.calc', inputs: {} },
      ]);

      expect(result.success).toBe(false);
      expect(result.steps).toHaveLength(1);
    });

    test('passes results between steps via inputMapping', async () => {
      registerCalculator('step1.calc', () => ({ result: { data: 42 } }));
      registerCalculator('step2.calc', (inputs) => ({ received: inputs.fromPrevious }));

      const result = await executeCalculatorChain([
        { calculator: 'step1.calc', inputs: {} },
        {
          calculator: 'step2.calc',
          inputs: {},
          inputMapping: { fromPrevious: 'result.data.value' },
        },
      ]);

      expect(result.success).toBe(true);
      expect(result.finalResult.success).toBe(true);
    });
  });

  describe('execution history', () => {
    test('records executions', async () => {
      registerCalculator('test.calc', () => 'result');

      await executeCalculator('test.calc', { input: 'value' });
      await executeCalculator('test.calc', { input: 'another' });

      const history = getExecutionHistory();
      expect(history).toHaveLength(2);
      expect(history[0].calculatorName).toBe('test.calc');
    });

    test('limits history to recent executions', async () => {
      registerCalculator('test.calc', () => 'result');

      const history = getExecutionHistory(5);
      expect(history.length).toBeLessThanOrEqual(5);
    });

    test('clears history', async () => {
      registerCalculator('test.calc', () => 'result');
      await executeCalculator('test.calc', {});

      clearExecutionHistory();

      expect(getExecutionHistory()).toHaveLength(0);
    });
  });

  describe('execution stats', () => {
    test('tracks success and failure counts', async () => {
      registerCalculator('success.calc', () => 'ok');
      registerCalculator('error.calc', () => {
        throw new Error('fail');
      });

      await executeCalculator('success.calc', {});
      await executeCalculator('success.calc', {});
      await executeCalculator('error.calc', {});

      const stats = getExecutionStats();
      expect(stats.total).toBe(3);
      expect(stats.successful).toBe(2);
      expect(stats.failed).toBe(1);
    });

    test('groups stats by calculator', async () => {
      registerCalculator('calc.a', () => 'a');
      registerCalculator('calc.b', () => 'b');

      await executeCalculator('calc.a', {});
      await executeCalculator('calc.a', {});
      await executeCalculator('calc.b', {});

      const stats = getExecutionStats();
      expect(stats.byCalculator['calc.a'].total).toBe(2);
      expect(stats.byCalculator['calc.b'].total).toBe(1);
    });
  });
});
