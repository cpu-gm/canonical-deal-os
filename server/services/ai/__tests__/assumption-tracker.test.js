/**
 * Assumption Tracker Tests
 *
 * Tests for assumption drift tracking and portfolio analysis.
 * Phase 2.3 Implementation
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Mock the Prisma client
const mockPrisma = {
  assumptionSnapshot: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  assumptionVariance: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

// Mock the db module before importing the service
jest.unstable_mockModule('../../../db.js', () => ({
  getPrisma: () => mockPrisma,
}));

// Import after mocking
const {
  trackAssumptions,
  compareToActuals,
  getPortfolioTrends,
  suggestAssumptionAdjustments,
  getDealSnapshots,
  getDealVariances,
  ASSUMPTION_TRACKER_CONFIG,
  SNAPSHOT_TYPE,
} = await import('../assumption-tracker.js');

describe('Assumption Tracker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ASSUMPTION_TRACKER_CONFIG.enabled = true;
    ASSUMPTION_TRACKER_CONFIG.debug = false;
    ASSUMPTION_TRACKER_CONFIG.varianceAlertThreshold = 0.15;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('SNAPSHOT_TYPE', () => {
    test('exports all snapshot types', () => {
      expect(SNAPSHOT_TYPE.UNDERWRITING).toBe('UNDERWRITING');
      expect(SNAPSHOT_TYPE.YEAR_1_ACTUAL).toBe('YEAR_1_ACTUAL');
      expect(SNAPSHOT_TYPE.YEAR_2_ACTUAL).toBe('YEAR_2_ACTUAL');
      expect(SNAPSHOT_TYPE.YEAR_3_ACTUAL).toBe('YEAR_3_ACTUAL');
      expect(SNAPSHOT_TYPE.EXIT).toBe('EXIT');
    });
  });

  describe('trackAssumptions', () => {
    test('returns error when feature is disabled', async () => {
      ASSUMPTION_TRACKER_CONFIG.enabled = false;

      const result = await trackAssumptions('deal-123', SNAPSHOT_TYPE.UNDERWRITING, {
        rentGrowth: 0.03,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('disabled');
    });

    test('returns error for invalid snapshot type', async () => {
      const result = await trackAssumptions('deal-123', 'INVALID_TYPE', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid snapshot type');
    });

    test('creates underwriting snapshot', async () => {
      mockPrisma.assumptionSnapshot.findFirst.mockResolvedValue(null);
      mockPrisma.assumptionSnapshot.create.mockResolvedValue({
        id: 'snapshot-1',
        dealId: 'deal-123',
        snapshotType: SNAPSHOT_TYPE.UNDERWRITING,
        assumptions: JSON.stringify({ rentGrowth: 0.03, vacancyRate: 0.05 }),
      });

      const result = await trackAssumptions('deal-123', SNAPSHOT_TYPE.UNDERWRITING, {
        rentGrowth: 0.03,
        vacancyRate: 0.05,
      });

      expect(result.success).toBe(true);
      expect(result.snapshot).toBeDefined();
      expect(mockPrisma.assumptionSnapshot.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            dealId: 'deal-123',
            snapshotType: SNAPSHOT_TYPE.UNDERWRITING,
          }),
        })
      );
    });

    test('prevents duplicate underwriting snapshots', async () => {
      mockPrisma.assumptionSnapshot.findFirst.mockResolvedValue({
        id: 'existing-snapshot',
        snapshotType: SNAPSHOT_TYPE.UNDERWRITING,
      });

      const result = await trackAssumptions('deal-123', SNAPSHOT_TYPE.UNDERWRITING, {
        rentGrowth: 0.03,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });

    test('allows multiple actual snapshots', async () => {
      mockPrisma.assumptionSnapshot.findFirst.mockResolvedValue({
        id: 'year1-snapshot',
        snapshotType: SNAPSHOT_TYPE.YEAR_1_ACTUAL,
      });
      mockPrisma.assumptionSnapshot.create.mockResolvedValue({
        id: 'year2-snapshot',
        snapshotType: SNAPSHOT_TYPE.YEAR_2_ACTUAL,
      });

      const result = await trackAssumptions('deal-123', SNAPSHOT_TYPE.YEAR_2_ACTUAL, {
        rentGrowth: 0.025,
      });

      expect(result.success).toBe(true);
    });

    test('includes metrics in snapshot', async () => {
      mockPrisma.assumptionSnapshot.findFirst.mockResolvedValue(null);
      mockPrisma.assumptionSnapshot.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'snapshot-1', ...data })
      );

      await trackAssumptions(
        'deal-123',
        SNAPSHOT_TYPE.UNDERWRITING,
        { rentGrowth: 0.03 },
        { noi: 500000, irr: 0.15 }
      );

      expect(mockPrisma.assumptionSnapshot.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            projectedMetrics: expect.any(String),
          }),
        })
      );
    });
  });

  describe('compareToActuals', () => {
    test('returns error when feature is disabled', async () => {
      ASSUMPTION_TRACKER_CONFIG.enabled = false;

      const result = await compareToActuals('deal-123', 'YEAR_1');

      expect(result.success).toBe(false);
    });

    test('returns error when no underwriting snapshot exists', async () => {
      mockPrisma.assumptionSnapshot.findFirst.mockResolvedValue(null);

      const result = await compareToActuals('deal-123', 'YEAR_1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('No underwriting snapshot');
    });

    test('returns error when no actual data exists', async () => {
      mockPrisma.assumptionSnapshot.findFirst
        .mockResolvedValueOnce({ id: 'underwriting', assumptions: '{}' })
        .mockResolvedValueOnce(null);

      const result = await compareToActuals('deal-123', 'YEAR_1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('No actual data');
    });

    test('calculates variances between projected and actual', async () => {
      mockPrisma.assumptionSnapshot.findFirst
        .mockResolvedValueOnce({
          id: 'underwriting',
          assumptions: JSON.stringify({ rentGrowth: 0.03, vacancyRate: 0.05 }),
          projectedMetrics: JSON.stringify({ noi: 500000 }),
          createdAt: new Date(),
        })
        .mockResolvedValueOnce({
          id: 'year1-actual',
          assumptions: JSON.stringify({ rentGrowth: 0.025, vacancyRate: 0.07 }),
          projectedMetrics: JSON.stringify({ noi: 480000 }),
          createdAt: new Date(),
        });

      mockPrisma.assumptionVariance.findFirst.mockResolvedValue(null);
      mockPrisma.assumptionVariance.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'variance-1', ...data })
      );

      const result = await compareToActuals('deal-123', 'YEAR_1');

      expect(result.success).toBe(true);
      expect(result.assumptionVariances.length).toBeGreaterThan(0);
      expect(result.metricVariances.length).toBeGreaterThan(0);
    });

    test('identifies significant variances', async () => {
      mockPrisma.assumptionSnapshot.findFirst
        .mockResolvedValueOnce({
          id: 'underwriting',
          assumptions: JSON.stringify({ rentGrowth: 0.05 }),
          projectedMetrics: '{}',
          createdAt: new Date(),
        })
        .mockResolvedValueOnce({
          id: 'year1-actual',
          assumptions: JSON.stringify({ rentGrowth: 0.02 }),
          projectedMetrics: '{}',
          createdAt: new Date(),
        });

      mockPrisma.assumptionVariance.findFirst.mockResolvedValue(null);
      mockPrisma.assumptionVariance.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'v1', ...data })
      );

      const result = await compareToActuals('deal-123', 'YEAR_1');

      expect(result.success).toBe(true);
      const rentGrowthVariance = result.assumptionVariances.find(v => v.field === 'rentGrowth');
      expect(rentGrowthVariance).toBeDefined();
      expect(rentGrowthVariance.isSignificant).toBe(true);
    });

    test('generates insights from variances', async () => {
      mockPrisma.assumptionSnapshot.findFirst
        .mockResolvedValueOnce({
          id: 'underwriting',
          assumptions: JSON.stringify({ rentGrowth: 0.05, vacancyRate: 0.05 }),
          projectedMetrics: JSON.stringify({ noi: 500000 }),
          createdAt: new Date(),
        })
        .mockResolvedValueOnce({
          id: 'year1-actual',
          assumptions: JSON.stringify({ rentGrowth: 0.02, vacancyRate: 0.08 }),
          projectedMetrics: JSON.stringify({ noi: 420000 }),
          createdAt: new Date(),
        });

      mockPrisma.assumptionVariance.findFirst.mockResolvedValue(null);
      mockPrisma.assumptionVariance.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'v1', ...data })
      );

      const result = await compareToActuals('deal-123', 'YEAR_1');

      expect(result.success).toBe(true);
      expect(result.insights).toBeDefined();
      expect(result.insights.length).toBeGreaterThan(0);
    });

    test('includes summary statistics', async () => {
      mockPrisma.assumptionSnapshot.findFirst
        .mockResolvedValueOnce({
          id: 'underwriting',
          assumptions: JSON.stringify({ rentGrowth: 0.03 }),
          projectedMetrics: JSON.stringify({ noi: 500000 }),
          createdAt: new Date(),
        })
        .mockResolvedValueOnce({
          id: 'year1-actual',
          assumptions: JSON.stringify({ rentGrowth: 0.025 }),
          projectedMetrics: JSON.stringify({ noi: 480000 }),
          createdAt: new Date(),
        });

      mockPrisma.assumptionVariance.findFirst.mockResolvedValue(null);
      mockPrisma.assumptionVariance.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'v1', ...data })
      );

      const result = await compareToActuals('deal-123', 'YEAR_1');

      expect(result.summary).toBeDefined();
      expect(result.summary.totalVariances).toBeDefined();
      expect(result.summary.significantVariances).toBeDefined();
    });
  });

  describe('getPortfolioTrends', () => {
    test('returns error when feature is disabled', async () => {
      ASSUMPTION_TRACKER_CONFIG.enabled = false;

      const result = await getPortfolioTrends('org-123');

      expect(result.success).toBe(false);
    });

    test('returns empty trends when no variance data', async () => {
      mockPrisma.assumptionVariance.findMany.mockResolvedValue([]);

      const result = await getPortfolioTrends('org-123');

      expect(result.success).toBe(true);
      expect(result.message).toContain('No variance data');
    });

    test('calculates trends from variance history', async () => {
      mockPrisma.assumptionVariance.findMany.mockResolvedValue([
        { dealId: 'd1', field: 'rentGrowth', variancePercent: -0.1 },
        { dealId: 'd2', field: 'rentGrowth', variancePercent: -0.15 },
        { dealId: 'd3', field: 'rentGrowth', variancePercent: -0.12 },
        { dealId: 'd1', field: 'vacancyRate', variancePercent: 0.2 },
        { dealId: 'd2', field: 'vacancyRate', variancePercent: 0.15 },
        { dealId: 'd3', field: 'vacancyRate', variancePercent: 0.18 },
      ]);

      const result = await getPortfolioTrends('org-123');

      expect(result.success).toBe(true);
      expect(result.trends.rentGrowth).toBeDefined();
      expect(result.trends.rentGrowth.sampleSize).toBe(3);
      expect(result.trends.rentGrowth.tendency).toBe('conservative'); // negative variance = conservative
    });

    test('generates portfolio recommendations', async () => {
      mockPrisma.assumptionVariance.findMany.mockResolvedValue([
        { dealId: 'd1', field: 'rentGrowth', variancePercent: -0.1 },
        { dealId: 'd2', field: 'rentGrowth', variancePercent: -0.15 },
        { dealId: 'd3', field: 'rentGrowth', variancePercent: -0.12 },
        { dealId: 'd1', field: 'expenseGrowth', variancePercent: -0.08 },
        { dealId: 'd2', field: 'expenseGrowth', variancePercent: -0.1 },
        { dealId: 'd3', field: 'expenseGrowth', variancePercent: -0.09 },
      ]);

      const result = await getPortfolioTrends('org-123');

      expect(result.success).toBe(true);
      expect(result.recommendations).toBeDefined();
      expect(result.recommendations.length).toBeGreaterThan(0);
    });

    test('respects minimum deals threshold', async () => {
      mockPrisma.assumptionVariance.findMany.mockResolvedValue([
        { dealId: 'd1', field: 'rentGrowth', variancePercent: -0.1 },
        { dealId: 'd2', field: 'rentGrowth', variancePercent: -0.15 },
      ]);

      const result = await getPortfolioTrends('org-123', { minDeals: 3 });

      expect(result.success).toBe(true);
      // rentGrowth should not be in trends because only 2 samples
      expect(result.trends.rentGrowth).toBeUndefined();
    });
  });

  describe('suggestAssumptionAdjustments', () => {
    test('returns error when feature is disabled', async () => {
      ASSUMPTION_TRACKER_CONFIG.enabled = false;

      const result = await suggestAssumptionAdjustments('org-123', { rentGrowth: 0.03 });

      expect(result.success).toBe(false);
    });

    test('returns empty suggestions when insufficient history', async () => {
      mockPrisma.assumptionVariance.findMany.mockResolvedValue([]);

      const result = await suggestAssumptionAdjustments('org-123', { rentGrowth: 0.03 });

      expect(result.success).toBe(true);
      expect(result.suggestions).toHaveLength(0);
    });

    test('suggests adjustments based on historical variance', async () => {
      // Negative variance means actuals are lower than projections (overly optimistic)
      // So adjustment should increase the value (make it more conservative)
      mockPrisma.assumptionVariance.findMany.mockResolvedValue([
        { dealId: 'd1', field: 'rentGrowth', variancePercent: -0.15 },
        { dealId: 'd2', field: 'rentGrowth', variancePercent: -0.12 },
        { dealId: 'd3', field: 'rentGrowth', variancePercent: -0.18 },
      ]);

      const result = await suggestAssumptionAdjustments('org-123', {
        rentGrowth: 0.05,
        vacancyRate: 0.05,
      });

      expect(result.success).toBe(true);
      expect(result.suggestions.length).toBeGreaterThan(0);

      const rentGrowthSuggestion = result.suggestions.find(s => s.field === 'rentGrowth');
      expect(rentGrowthSuggestion).toBeDefined();
      // The suggested value is adjusted based on historical variance
      // With -15% avg variance, adjustment factor is 1 - (-0.15) = 1.15
      // So 0.05 * 1.15 = 0.0575 (suggests being more conservative)
      expect(rentGrowthSuggestion.suggestedValue).toBeCloseTo(0.0575, 3);
      expect(rentGrowthSuggestion.adjustmentPercent).toBeLessThan(0); // negative because variance was negative
    });

    test('includes confidence based on sample size', async () => {
      mockPrisma.assumptionVariance.findMany.mockResolvedValue([
        { dealId: 'd1', field: 'rentGrowth', variancePercent: -0.1 },
        { dealId: 'd2', field: 'rentGrowth', variancePercent: -0.12 },
        { dealId: 'd3', field: 'rentGrowth', variancePercent: -0.11 },
        { dealId: 'd4', field: 'rentGrowth', variancePercent: -0.09 },
        { dealId: 'd5', field: 'rentGrowth', variancePercent: -0.13 },
      ]);

      const result = await suggestAssumptionAdjustments('org-123', { rentGrowth: 0.05 });

      const suggestion = result.suggestions.find(s => s.field === 'rentGrowth');
      expect(suggestion.confidence).toBe('high');
    });
  });

  describe('getDealSnapshots', () => {
    test('returns error when feature is disabled', async () => {
      ASSUMPTION_TRACKER_CONFIG.enabled = false;

      const result = await getDealSnapshots('deal-123');

      expect(result.success).toBe(false);
    });

    test('returns all snapshots for a deal', async () => {
      mockPrisma.assumptionSnapshot.findMany.mockResolvedValue([
        {
          id: 's1',
          dealId: 'deal-123',
          snapshotType: SNAPSHOT_TYPE.UNDERWRITING,
          assumptions: JSON.stringify({ rentGrowth: 0.03 }),
          projectedMetrics: JSON.stringify({ noi: 500000 }),
          createdAt: new Date('2024-01-01'),
        },
        {
          id: 's2',
          dealId: 'deal-123',
          snapshotType: SNAPSHOT_TYPE.YEAR_1_ACTUAL,
          assumptions: JSON.stringify({ rentGrowth: 0.025 }),
          projectedMetrics: JSON.stringify({ noi: 480000 }),
          createdAt: new Date('2025-01-01'),
        },
      ]);

      const result = await getDealSnapshots('deal-123');

      expect(result.success).toBe(true);
      expect(result.snapshots).toHaveLength(2);
      expect(result.hasUnderwriting).toBe(true);
      expect(result.periods).toContain(SNAPSHOT_TYPE.UNDERWRITING);
      expect(result.periods).toContain(SNAPSHOT_TYPE.YEAR_1_ACTUAL);
    });

    test('parses JSON fields in snapshots', async () => {
      mockPrisma.assumptionSnapshot.findMany.mockResolvedValue([
        {
          id: 's1',
          assumptions: JSON.stringify({ rentGrowth: 0.03 }),
          projectedMetrics: JSON.stringify({ noi: 500000 }),
        },
      ]);

      const result = await getDealSnapshots('deal-123');

      expect(result.snapshots[0].assumptions.rentGrowth).toBe(0.03);
      expect(result.snapshots[0].projectedMetrics.noi).toBe(500000);
    });
  });

  describe('getDealVariances', () => {
    test('returns error when feature is disabled', async () => {
      ASSUMPTION_TRACKER_CONFIG.enabled = false;

      const result = await getDealVariances('deal-123');

      expect(result.success).toBe(false);
    });

    test('returns all variances grouped by period', async () => {
      mockPrisma.assumptionVariance.findMany.mockResolvedValue([
        { id: 'v1', period: 'YEAR_1', field: 'rentGrowth', variancePercent: -0.1 },
        { id: 'v2', period: 'YEAR_1', field: 'vacancyRate', variancePercent: 0.05 },
        { id: 'v3', period: 'YEAR_2', field: 'rentGrowth', variancePercent: -0.08 },
      ]);

      const result = await getDealVariances('deal-123');

      expect(result.success).toBe(true);
      expect(result.totalVariances).toBe(3);
      expect(result.byPeriod['YEAR_1']).toHaveLength(2);
      expect(result.byPeriod['YEAR_2']).toHaveLength(1);
      expect(result.periodsAnalyzed).toContain('YEAR_1');
      expect(result.periodsAnalyzed).toContain('YEAR_2');
    });
  });

  describe('variance calculations', () => {
    test('correctly calculates positive variance', async () => {
      // Actual better than projected (positive variance)
      mockPrisma.assumptionSnapshot.findFirst
        .mockResolvedValueOnce({
          id: 'underwriting',
          assumptions: JSON.stringify({ rentGrowth: 0.02 }),
          projectedMetrics: '{}',
          createdAt: new Date(),
        })
        .mockResolvedValueOnce({
          id: 'year1-actual',
          assumptions: JSON.stringify({ rentGrowth: 0.03 }),
          projectedMetrics: '{}',
          createdAt: new Date(),
        });

      mockPrisma.assumptionVariance.findFirst.mockResolvedValue(null);
      mockPrisma.assumptionVariance.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'v1', ...data })
      );

      const result = await compareToActuals('deal-123', 'YEAR_1');

      const rentGrowthVariance = result.assumptionVariances.find(v => v.field === 'rentGrowth');
      expect(rentGrowthVariance.direction).toBe('positive');
    });

    test('correctly calculates negative variance', async () => {
      // Actual worse than projected (negative variance)
      mockPrisma.assumptionSnapshot.findFirst
        .mockResolvedValueOnce({
          id: 'underwriting',
          assumptions: JSON.stringify({ rentGrowth: 0.05 }),
          projectedMetrics: '{}',
          createdAt: new Date(),
        })
        .mockResolvedValueOnce({
          id: 'year1-actual',
          assumptions: JSON.stringify({ rentGrowth: 0.02 }),
          projectedMetrics: '{}',
          createdAt: new Date(),
        });

      mockPrisma.assumptionVariance.findFirst.mockResolvedValue(null);
      mockPrisma.assumptionVariance.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'v1', ...data })
      );

      const result = await compareToActuals('deal-123', 'YEAR_1');

      const rentGrowthVariance = result.assumptionVariances.find(v => v.field === 'rentGrowth');
      expect(rentGrowthVariance.direction).toBe('negative');
    });
  });
});
