/**
 * Verification Agent Tests
 *
 * Tests for data lineage tracking and verification workflow.
 * Phase 2.2 Implementation
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Mock the Prisma client
const mockPrisma = {
  dataLineage: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    upsert: jest.fn(),
  },
};

// Mock the db module before importing the service
jest.unstable_mockModule('../../../db.js', () => ({
  getPrisma: () => mockPrisma,
}));

// Import after mocking
const {
  trackDataLineage,
  markAsVerified,
  markNeedsReview,
  getVerificationStatus,
  getFieldLineage,
  suggestNextVerification,
  bulkTrackLineage,
  bulkVerify,
  getVerificationHistory,
  VERIFICATION_CONFIG,
  VERIFICATION_STATUS,
  SOURCE_TYPE,
} = await import('../verification-agent.js');

describe('Verification Agent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    VERIFICATION_CONFIG.enabled = true;
    VERIFICATION_CONFIG.debug = false;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constants', () => {
    test('exports VERIFICATION_STATUS enum', () => {
      expect(VERIFICATION_STATUS.UNVERIFIED).toBe('UNVERIFIED');
      expect(VERIFICATION_STATUS.AI_EXTRACTED).toBe('AI_EXTRACTED');
      expect(VERIFICATION_STATUS.HUMAN_VERIFIED).toBe('HUMAN_VERIFIED');
      expect(VERIFICATION_STATUS.NEEDS_REVIEW).toBe('NEEDS_REVIEW');
    });

    test('exports SOURCE_TYPE enum', () => {
      expect(SOURCE_TYPE.MANUAL).toBe('MANUAL');
      expect(SOURCE_TYPE.DOCUMENT).toBe('DOCUMENT');
      expect(SOURCE_TYPE.FORMULA).toBe('FORMULA');
      expect(SOURCE_TYPE.AI_EXTRACTED).toBe('AI_EXTRACTED');
      expect(SOURCE_TYPE.IMPORTED).toBe('IMPORTED');
    });
  });

  describe('trackDataLineage', () => {
    test('returns error when feature is disabled', async () => {
      VERIFICATION_CONFIG.enabled = false;

      const result = await trackDataLineage('deal-123', 'model-456', 'purchasePrice', {
        value: 1000000,
        sourceType: SOURCE_TYPE.MANUAL,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('disabled');
    });

    test('creates new lineage record', async () => {
      mockPrisma.dataLineage.findUnique.mockResolvedValue(null);
      mockPrisma.dataLineage.upsert.mockResolvedValue({
        id: 'lineage-1',
        dealId: 'deal-123',
        modelId: 'model-456',
        field: 'purchasePrice',
        currentValue: '1000000',
        sourceType: SOURCE_TYPE.MANUAL,
        verificationStatus: VERIFICATION_STATUS.NEEDS_REVIEW,
      });

      const result = await trackDataLineage('deal-123', 'model-456', 'purchasePrice', {
        value: 1000000,
        sourceType: SOURCE_TYPE.MANUAL,
      });

      expect(result.success).toBe(true);
      expect(result.lineage).toBeDefined();
      expect(result.isNewValue).toBe(true);
    });

    test('updates existing lineage and preserves history', async () => {
      const existingLineage = {
        id: 'lineage-1',
        dealId: 'deal-123',
        modelId: 'model-456',
        field: 'purchasePrice',
        currentValue: '900000',
        sourceType: SOURCE_TYPE.DOCUMENT,
        verificationStatus: VERIFICATION_STATUS.AI_EXTRACTED,
        history: '[]',
        updatedAt: new Date(),
      };

      mockPrisma.dataLineage.findUnique.mockResolvedValue(existingLineage);
      mockPrisma.dataLineage.upsert.mockResolvedValue({
        ...existingLineage,
        currentValue: '1000000',
        sourceType: SOURCE_TYPE.MANUAL,
        history: JSON.stringify([{
          value: '900000',
          sourceType: SOURCE_TYPE.DOCUMENT,
          verificationStatus: VERIFICATION_STATUS.AI_EXTRACTED,
        }]),
      });

      const result = await trackDataLineage('deal-123', 'model-456', 'purchasePrice', {
        value: 1000000,
        sourceType: SOURCE_TYPE.MANUAL,
      });

      expect(result.success).toBe(true);
      expect(result.isNewValue).toBe(true);
      expect(result.previousValue).toBe('900000');
    });

    test('sets AI_EXTRACTED status for AI-sourced data', async () => {
      mockPrisma.dataLineage.findUnique.mockResolvedValue(null);
      mockPrisma.dataLineage.upsert.mockImplementation(({ create }) =>
        Promise.resolve(create)
      );

      const result = await trackDataLineage('deal-123', 'model-456', 'noi', {
        value: 500000,
        sourceType: SOURCE_TYPE.AI_EXTRACTED,
        extractionConfidence: 0.85,
      });

      expect(result.success).toBe(true);
      expect(mockPrisma.dataLineage.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            verificationStatus: VERIFICATION_STATUS.AI_EXTRACTED,
            extractionConfidence: 0.85,
          }),
        })
      );
    });

    test('tracks source document ID', async () => {
      mockPrisma.dataLineage.findUnique.mockResolvedValue(null);
      mockPrisma.dataLineage.upsert.mockImplementation(({ create }) =>
        Promise.resolve(create)
      );

      const result = await trackDataLineage('deal-123', 'model-456', 'gpr', {
        value: 1200000,
        sourceType: SOURCE_TYPE.DOCUMENT,
        sourceDocId: 'doc-789',
        sourceField: 'grossRent',
      });

      expect(result.success).toBe(true);
      expect(mockPrisma.dataLineage.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            sourceDocId: 'doc-789',
            sourceField: 'grossRent',
          }),
        })
      );
    });

    test('marks previously verified field as NEEDS_REVIEW when value changes', async () => {
      const existingLineage = {
        id: 'lineage-1',
        currentValue: '900000',
        verificationStatus: VERIFICATION_STATUS.HUMAN_VERIFIED,
        history: '[]',
        updatedAt: new Date(),
      };

      mockPrisma.dataLineage.findUnique.mockResolvedValue(existingLineage);
      mockPrisma.dataLineage.upsert.mockImplementation(({ update }) =>
        Promise.resolve({ ...existingLineage, ...update })
      );

      await trackDataLineage('deal-123', 'model-456', 'purchasePrice', {
        value: 1000000,
        sourceType: SOURCE_TYPE.MANUAL,
      });

      expect(mockPrisma.dataLineage.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            verificationStatus: VERIFICATION_STATUS.NEEDS_REVIEW,
          }),
        })
      );
    });
  });

  describe('markAsVerified', () => {
    test('returns error when feature is disabled', async () => {
      VERIFICATION_CONFIG.enabled = false;

      const result = await markAsVerified('deal-123', 'model-456', 'purchasePrice', 'user-1');

      expect(result.success).toBe(false);
    });

    test('returns error when lineage not found', async () => {
      mockPrisma.dataLineage.findUnique.mockResolvedValue(null);

      const result = await markAsVerified('deal-123', 'model-456', 'nonexistent', 'user-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('No lineage record');
    });

    test('updates field to HUMAN_VERIFIED status', async () => {
      const existing = {
        id: 'lineage-1',
        field: 'purchasePrice',
        verificationStatus: VERIFICATION_STATUS.AI_EXTRACTED,
      };

      mockPrisma.dataLineage.findUnique.mockResolvedValue(existing);
      mockPrisma.dataLineage.update.mockResolvedValue({
        ...existing,
        verificationStatus: VERIFICATION_STATUS.HUMAN_VERIFIED,
        verifiedBy: 'user-1',
        verifiedAt: new Date(),
      });

      const result = await markAsVerified('deal-123', 'model-456', 'purchasePrice', 'user-1', 'Verified against bank docs');

      expect(result.success).toBe(true);
      expect(result.lineage.verificationStatus).toBe(VERIFICATION_STATUS.HUMAN_VERIFIED);
      expect(result.previousStatus).toBe(VERIFICATION_STATUS.AI_EXTRACTED);
    });

    test('includes verification notes', async () => {
      mockPrisma.dataLineage.findUnique.mockResolvedValue({ id: 'lineage-1' });
      mockPrisma.dataLineage.update.mockResolvedValue({
        verificationStatus: VERIFICATION_STATUS.HUMAN_VERIFIED,
      });

      await markAsVerified('deal-123', 'model-456', 'noi', 'user-1', 'Verified against T12');

      expect(mockPrisma.dataLineage.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            verificationNotes: 'Verified against T12',
          }),
        })
      );
    });
  });

  describe('markNeedsReview', () => {
    test('returns error when feature is disabled', async () => {
      VERIFICATION_CONFIG.enabled = false;

      const result = await markNeedsReview('deal-123', 'model-456', 'purchasePrice', 'Value seems off');

      expect(result.success).toBe(false);
    });

    test('updates field to NEEDS_REVIEW status', async () => {
      mockPrisma.dataLineage.update.mockResolvedValue({
        verificationStatus: VERIFICATION_STATUS.NEEDS_REVIEW,
        verificationNotes: 'Conflicts with other sources',
      });

      const result = await markNeedsReview('deal-123', 'model-456', 'vacancyRate', 'Conflicts with other sources');

      expect(result.success).toBe(true);
      expect(mockPrisma.dataLineage.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            verificationStatus: VERIFICATION_STATUS.NEEDS_REVIEW,
            verificationNotes: 'Conflicts with other sources',
          }),
        })
      );
    });
  });

  describe('getVerificationStatus', () => {
    test('returns error when feature is disabled', async () => {
      VERIFICATION_CONFIG.enabled = false;

      const result = await getVerificationStatus('deal-123');

      expect(result.success).toBe(false);
    });

    test('returns summary of all verification statuses', async () => {
      mockPrisma.dataLineage.findMany.mockResolvedValue([
        { field: 'purchasePrice', currentValue: '1000000', verificationStatus: VERIFICATION_STATUS.HUMAN_VERIFIED, sourceType: SOURCE_TYPE.MANUAL, history: '[]' },
        { field: 'noi', currentValue: '500000', verificationStatus: VERIFICATION_STATUS.AI_EXTRACTED, sourceType: SOURCE_TYPE.AI_EXTRACTED, history: '[]' },
        { field: 'capRate', currentValue: '0.05', verificationStatus: VERIFICATION_STATUS.UNVERIFIED, sourceType: SOURCE_TYPE.FORMULA, history: '[]' },
        { field: 'gpr', currentValue: '1200000', verificationStatus: VERIFICATION_STATUS.NEEDS_REVIEW, sourceType: SOURCE_TYPE.DOCUMENT, history: '[]' },
      ]);

      const result = await getVerificationStatus('deal-123');

      expect(result.success).toBe(true);
      expect(result.summary.total).toBe(4);
      expect(result.summary.verified).toBe(1);
      expect(result.summary.aiExtracted).toBe(1);
      expect(result.summary.unverified).toBe(1);
      expect(result.summary.needsReview).toBe(1);
      expect(result.summary.verificationRate).toBe('25.0%');
    });

    test('returns field-level status details', async () => {
      mockPrisma.dataLineage.findMany.mockResolvedValue([
        {
          field: 'purchasePrice',
          currentValue: '1000000',
          verificationStatus: VERIFICATION_STATUS.HUMAN_VERIFIED,
          sourceType: SOURCE_TYPE.MANUAL,
          verifiedBy: 'user-1',
          verifiedAt: new Date(),
          extractionConfidence: null,
          history: '[]',
        },
      ]);

      const result = await getVerificationStatus('deal-123');

      expect(result.fields.purchasePrice).toBeDefined();
      expect(result.fields.purchasePrice.status).toBe(VERIFICATION_STATUS.HUMAN_VERIFIED);
      expect(result.fields.purchasePrice.verifiedBy).toBe('user-1');
    });

    test('filters by modelId when provided', async () => {
      mockPrisma.dataLineage.findMany.mockResolvedValue([]);

      await getVerificationStatus('deal-123', 'model-456');

      expect(mockPrisma.dataLineage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { dealId: 'deal-123', modelId: 'model-456' },
        })
      );
    });
  });

  describe('getFieldLineage', () => {
    test('returns error when feature is disabled', async () => {
      VERIFICATION_CONFIG.enabled = false;

      const result = await getFieldLineage('deal-123', 'model-456', 'purchasePrice');

      expect(result.success).toBe(false);
    });

    test('returns error when lineage not found', async () => {
      mockPrisma.dataLineage.findUnique.mockResolvedValue(null);

      const result = await getFieldLineage('deal-123', 'model-456', 'nonexistent');

      expect(result.success).toBe(false);
      expect(result.error).toContain('No lineage found');
    });

    test('returns complete lineage with history', async () => {
      const history = [
        { value: '900000', changedAt: '2024-01-01', sourceType: SOURCE_TYPE.AI_EXTRACTED },
        { value: '850000', changedAt: '2023-12-15', sourceType: SOURCE_TYPE.DOCUMENT },
      ];

      mockPrisma.dataLineage.findUnique.mockResolvedValue({
        field: 'purchasePrice',
        currentValue: '1000000',
        verificationStatus: VERIFICATION_STATUS.HUMAN_VERIFIED,
        sourceType: SOURCE_TYPE.MANUAL,
        sourceDocId: 'doc-123',
        sourceField: 'price',
        extractedAt: new Date(),
        extractionConfidence: 0.9,
        verifiedBy: 'user-1',
        verifiedAt: new Date(),
        verificationNotes: 'Verified',
        history: JSON.stringify(history),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await getFieldLineage('deal-123', 'model-456', 'purchasePrice');

      expect(result.success).toBe(true);
      expect(result.field).toBe('purchasePrice');
      expect(result.currentValue).toBe('1000000');
      expect(result.history).toHaveLength(2);
      expect(result.history[0].value).toBe('900000');
    });
  });

  describe('suggestNextVerification', () => {
    test('returns error when feature is disabled', async () => {
      VERIFICATION_CONFIG.enabled = false;

      const result = await suggestNextVerification('deal-123', 'model-456');

      expect(result.success).toBe(false);
    });

    test('returns empty suggestions when all fields verified', async () => {
      mockPrisma.dataLineage.findMany.mockResolvedValue([]);

      const result = await suggestNextVerification('deal-123', 'model-456');

      expect(result.success).toBe(true);
      expect(result.suggestions).toHaveLength(0);
      expect(result.message).toContain('All fields are verified');
    });

    test('prioritizes high-impact fields', async () => {
      mockPrisma.dataLineage.findMany.mockResolvedValue([
        { field: 'purchasePrice', currentValue: '1000000', verificationStatus: VERIFICATION_STATUS.UNVERIFIED, extractionConfidence: 0.9 },
        { field: 'minorField', currentValue: '100', verificationStatus: VERIFICATION_STATUS.UNVERIFIED, extractionConfidence: 0.9 },
        { field: 'netOperatingIncome', currentValue: '500000', verificationStatus: VERIFICATION_STATUS.AI_EXTRACTED, extractionConfidence: 0.8 },
      ]);

      const result = await suggestNextVerification('deal-123', 'model-456');

      expect(result.success).toBe(true);
      expect(result.suggestions.length).toBeGreaterThan(0);
      // purchasePrice and netOperatingIncome should be prioritized
      const topFields = result.suggestions.slice(0, 2).map(s => s.field);
      expect(topFields).toContain('purchasePrice');
    });

    test('prioritizes low confidence extractions', async () => {
      mockPrisma.dataLineage.findMany.mockResolvedValue([
        { field: 'fieldA', currentValue: '100', verificationStatus: VERIFICATION_STATUS.AI_EXTRACTED, extractionConfidence: 0.95 },
        { field: 'fieldB', currentValue: '200', verificationStatus: VERIFICATION_STATUS.AI_EXTRACTED, extractionConfidence: 0.6 },
      ]);

      const result = await suggestNextVerification('deal-123', 'model-456');

      expect(result.success).toBe(true);
      // fieldB should be first due to lower confidence
      expect(result.suggestions[0].field).toBe('fieldB');
    });

    test('prioritizes NEEDS_REVIEW status', async () => {
      mockPrisma.dataLineage.findMany.mockResolvedValue([
        { field: 'fieldA', currentValue: '100', verificationStatus: VERIFICATION_STATUS.UNVERIFIED, extractionConfidence: 0.9 },
        { field: 'fieldB', currentValue: '200', verificationStatus: VERIFICATION_STATUS.NEEDS_REVIEW, extractionConfidence: 0.9 },
      ]);

      const result = await suggestNextVerification('deal-123', 'model-456');

      expect(result.success).toBe(true);
      expect(result.suggestions[0].field).toBe('fieldB');
    });

    test('limits suggestions to specified count', async () => {
      mockPrisma.dataLineage.findMany.mockResolvedValue([
        { field: 'f1', verificationStatus: VERIFICATION_STATUS.UNVERIFIED },
        { field: 'f2', verificationStatus: VERIFICATION_STATUS.UNVERIFIED },
        { field: 'f3', verificationStatus: VERIFICATION_STATUS.UNVERIFIED },
        { field: 'f4', verificationStatus: VERIFICATION_STATUS.UNVERIFIED },
        { field: 'f5', verificationStatus: VERIFICATION_STATUS.UNVERIFIED },
        { field: 'f6', verificationStatus: VERIFICATION_STATUS.UNVERIFIED },
      ]);

      const result = await suggestNextVerification('deal-123', 'model-456', { limit: 3 });

      expect(result.suggestions).toHaveLength(3);
    });

    test('includes reason for each suggestion', async () => {
      mockPrisma.dataLineage.findMany.mockResolvedValue([
        { field: 'purchasePrice', currentValue: '1000000', verificationStatus: VERIFICATION_STATUS.AI_EXTRACTED, sourceType: SOURCE_TYPE.AI_EXTRACTED, extractionConfidence: 0.7 },
      ]);

      const result = await suggestNextVerification('deal-123', 'model-456');

      expect(result.suggestions[0].reason).toBeDefined();
      expect(result.suggestions[0].reason).toContain('confidence');
    });
  });

  describe('bulkTrackLineage', () => {
    test('returns error when feature is disabled', async () => {
      VERIFICATION_CONFIG.enabled = false;

      const result = await bulkTrackLineage('deal-123', 'model-456', []);

      expect(result.success).toBe(false);
    });

    test('tracks multiple fields', async () => {
      mockPrisma.dataLineage.findUnique.mockResolvedValue(null);
      mockPrisma.dataLineage.upsert.mockImplementation(({ create }) =>
        Promise.resolve(create)
      );

      const fields = [
        { field: 'purchasePrice', value: 1000000, sourceInfo: { sourceType: SOURCE_TYPE.MANUAL } },
        { field: 'noi', value: 500000, sourceInfo: { sourceType: SOURCE_TYPE.DOCUMENT } },
        { field: 'capRate', value: 0.05, sourceInfo: { sourceType: SOURCE_TYPE.FORMULA } },
      ];

      const result = await bulkTrackLineage('deal-123', 'model-456', fields);

      expect(result.total).toBe(3);
      expect(result.succeeded).toBe(3);
      expect(result.failed).toBe(0);
    });

    test('reports partial failures', async () => {
      mockPrisma.dataLineage.findUnique.mockResolvedValue(null);
      let callCount = 0;
      mockPrisma.dataLineage.upsert.mockImplementation(() => {
        callCount++;
        if (callCount === 2) {
          return Promise.reject(new Error('DB error'));
        }
        return Promise.resolve({});
      });

      const fields = [
        { field: 'f1', value: 100, sourceInfo: { sourceType: SOURCE_TYPE.MANUAL } },
        { field: 'f2', value: 200, sourceInfo: { sourceType: SOURCE_TYPE.MANUAL } },
        { field: 'f3', value: 300, sourceInfo: { sourceType: SOURCE_TYPE.MANUAL } },
      ];

      const result = await bulkTrackLineage('deal-123', 'model-456', fields);

      expect(result.succeeded).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.errors).toHaveLength(1);
    });
  });

  describe('bulkVerify', () => {
    test('returns error when feature is disabled', async () => {
      VERIFICATION_CONFIG.enabled = false;

      const result = await bulkVerify('deal-123', 'model-456', ['f1', 'f2'], 'user-1');

      expect(result.success).toBe(false);
    });

    test('verifies multiple fields', async () => {
      mockPrisma.dataLineage.findUnique.mockResolvedValue({ id: 'lineage-1' });
      mockPrisma.dataLineage.update.mockResolvedValue({
        verificationStatus: VERIFICATION_STATUS.HUMAN_VERIFIED,
      });

      const result = await bulkVerify('deal-123', 'model-456', ['purchasePrice', 'noi', 'capRate'], 'user-1', 'Bulk verified');

      expect(result.total).toBe(3);
      expect(result.verified).toBe(3);
      expect(result.failed).toBe(0);
    });
  });

  describe('getVerificationHistory', () => {
    test('returns error when feature is disabled', async () => {
      VERIFICATION_CONFIG.enabled = false;

      const result = await getVerificationHistory('deal-123');

      expect(result.success).toBe(false);
    });

    test('returns verification history', async () => {
      const records = [
        {
          field: 'purchasePrice',
          modelId: 'model-1',
          currentValue: '1000000',
          verifiedBy: 'user-1',
          verifiedAt: new Date(),
          verificationNotes: 'Verified',
          sourceType: SOURCE_TYPE.MANUAL,
        },
        {
          field: 'noi',
          modelId: 'model-1',
          currentValue: '500000',
          verifiedBy: 'user-2',
          verifiedAt: new Date(),
          verificationNotes: 'Checked against T12',
          sourceType: SOURCE_TYPE.DOCUMENT,
        },
      ];

      mockPrisma.dataLineage.findMany.mockResolvedValue(records);

      const result = await getVerificationHistory('deal-123');

      expect(result.success).toBe(true);
      expect(result.history).toHaveLength(2);
      expect(result.history[0].field).toBe('purchasePrice');
    });

    test('filters by verifierId', async () => {
      mockPrisma.dataLineage.findMany.mockResolvedValue([]);

      await getVerificationHistory('deal-123', { verifierId: 'user-1' });

      expect(mockPrisma.dataLineage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            verifiedBy: 'user-1',
          }),
        })
      );
    });

    test('respects limit option', async () => {
      mockPrisma.dataLineage.findMany.mockResolvedValue([]);

      await getVerificationHistory('deal-123', { limit: 10 });

      expect(mockPrisma.dataLineage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 10,
        })
      );
    });
  });
});
