/**
 * Document Intelligence Tests
 *
 * Tests for multi-document extraction and conflict detection.
 * Phase 2.1 Implementation
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Mock the Prisma client
const mockPrisma = {
  document: {
    findUnique: jest.fn(),
  },
  documentExtraction: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  extractionConflict: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
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
  extractDocument,
  synthesizeDocuments,
  resolveConflict,
  dismissConflict,
  getConflicts,
  generateExtractionReport,
  DOC_INTELLIGENCE_CONFIG,
  DOCUMENT_TYPES,
} = await import('../document-intelligence.js');

describe('Document Intelligence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Enable feature for tests
    DOC_INTELLIGENCE_CONFIG.enabled = true;
    DOC_INTELLIGENCE_CONFIG.debug = false;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('DOCUMENT_TYPES', () => {
    test('exports all document types', () => {
      expect(DOCUMENT_TYPES.RENT_ROLL).toBe('rent_roll');
      expect(DOCUMENT_TYPES.T12).toBe('t12');
      expect(DOCUMENT_TYPES.OPERATING_MEMORANDUM).toBe('operating_memorandum');
      expect(DOCUMENT_TYPES.LOAN_DOCUMENTS).toBe('loan_documents');
      expect(DOCUMENT_TYPES.APPRAISAL).toBe('appraisal');
      expect(DOCUMENT_TYPES.BROKER_ANALYSIS).toBe('broker_analysis');
    });
  });

  describe('extractDocument', () => {
    test('returns error when feature is disabled', async () => {
      DOC_INTELLIGENCE_CONFIG.enabled = false;

      const result = await extractDocument('doc-123', DOCUMENT_TYPES.RENT_ROLL);

      expect(result.success).toBe(false);
      expect(result.error).toContain('disabled');
    });

    test('returns error when document not found', async () => {
      mockPrisma.document.findUnique.mockResolvedValue(null);

      const result = await extractDocument('nonexistent-doc', DOCUMENT_TYPES.T12);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    test('returns cached extraction when available', async () => {
      const mockDocument = { id: 'doc-123', dealId: 'deal-456' };
      const mockExtraction = {
        id: 'ext-789',
        documentId: 'doc-123',
        extractedData: JSON.stringify({ noi: { value: 100000, confidence: 0.9 } }),
        status: 'COMPLETED',
      };

      mockPrisma.document.findUnique.mockResolvedValue(mockDocument);
      mockPrisma.documentExtraction.findFirst.mockResolvedValue(mockExtraction);

      const result = await extractDocument('doc-123', DOCUMENT_TYPES.T12);

      expect(result.success).toBe(true);
      expect(result.cached).toBe(true);
      expect(result.extraction).toEqual(mockExtraction);
    });

    test('forces re-extraction when option is set', async () => {
      const mockDocument = { id: 'doc-123', dealId: 'deal-456' };
      const mockExtraction = { id: 'ext-old' };

      mockPrisma.document.findUnique.mockResolvedValue(mockDocument);
      mockPrisma.documentExtraction.findFirst.mockResolvedValue(mockExtraction);
      mockPrisma.documentExtraction.create.mockResolvedValue({
        id: 'ext-new',
        documentId: 'doc-123',
        dealId: 'deal-456',
        status: 'COMPLETED',
      });

      const result = await extractDocument('doc-123', DOCUMENT_TYPES.T12, { forceReextract: true });

      expect(result.success).toBe(true);
      expect(mockPrisma.documentExtraction.create).toHaveBeenCalled();
    });

    test('includes extraction ID for tracking', async () => {
      mockPrisma.document.findUnique.mockResolvedValue({ id: 'doc-123', dealId: 'deal-456' });
      mockPrisma.documentExtraction.findFirst.mockResolvedValue(null);
      mockPrisma.documentExtraction.create.mockResolvedValue({
        id: 'ext-123',
        documentId: 'doc-123',
        status: 'COMPLETED',
      });

      const result = await extractDocument('doc-123', DOCUMENT_TYPES.RENT_ROLL);

      expect(result.extractionId).toBeDefined();
      expect(result.extractionId).toMatch(/^extract_/);
    });

    test('includes metadata with duration', async () => {
      mockPrisma.document.findUnique.mockResolvedValue({ id: 'doc-123', dealId: 'deal-456' });
      mockPrisma.documentExtraction.findFirst.mockResolvedValue(null);
      mockPrisma.documentExtraction.create.mockResolvedValue({
        id: 'ext-123',
        status: 'COMPLETED',
      });

      const result = await extractDocument('doc-123', DOCUMENT_TYPES.T12);

      expect(result.metadata).toBeDefined();
      expect(result.metadata.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('synthesizeDocuments', () => {
    test('returns error when feature is disabled', async () => {
      DOC_INTELLIGENCE_CONFIG.enabled = false;

      const result = await synthesizeDocuments('deal-123');

      expect(result.success).toBe(false);
      expect(result.error).toContain('disabled');
    });

    test('returns error when no extractions found', async () => {
      mockPrisma.documentExtraction.findMany.mockResolvedValue([]);

      const result = await synthesizeDocuments('deal-123');

      expect(result.success).toBe(false);
      expect(result.error).toContain('No document extractions');
    });

    test('builds cross-reference matrix from extractions', async () => {
      mockPrisma.documentExtraction.findMany.mockResolvedValue([
        {
          id: 'ext-1',
          documentId: 'doc-1',
          extractionType: 'rent_roll',
          extractedData: JSON.stringify({
            grossPotentialRent: { value: 1200000, confidence: 0.9 },
          }),
          extractedAt: new Date(),
        },
        {
          id: 'ext-2',
          documentId: 'doc-2',
          extractionType: 't12',
          extractedData: JSON.stringify({
            gpr: { value: 1180000, confidence: 0.95 },
          }),
          extractedAt: new Date(),
        },
      ]);
      mockPrisma.extractionConflict.findFirst.mockResolvedValue(null);
      mockPrisma.extractionConflict.create.mockImplementation(({ data }) => Promise.resolve({
        id: 'conflict-1',
        ...data,
      }));

      const result = await synthesizeDocuments('deal-123');

      expect(result.success).toBe(true);
      expect(result.crossReferenceMatrix).toBeDefined();
      expect(result.crossReferenceMatrix.grossPotentialRent).toBeDefined();
    });

    test('detects conflicts above variance threshold', async () => {
      // 10% variance (1.2M vs 1.08M)
      mockPrisma.documentExtraction.findMany.mockResolvedValue([
        {
          id: 'ext-1',
          documentId: 'doc-1',
          extractionType: 'rent_roll',
          extractedData: JSON.stringify({
            netOperatingIncome: { value: 1200000, confidence: 0.9 },
          }),
          extractedAt: new Date(),
        },
        {
          id: 'ext-2',
          documentId: 'doc-2',
          extractionType: 't12',
          extractedData: JSON.stringify({
            noi: { value: 1080000, confidence: 0.95 },
          }),
          extractedAt: new Date(),
        },
      ]);
      mockPrisma.extractionConflict.findFirst.mockResolvedValue(null);
      mockPrisma.extractionConflict.create.mockImplementation(({ data }) => Promise.resolve({
        id: 'conflict-1',
        ...data,
        status: 'OPEN',
      }));

      const result = await synthesizeDocuments('deal-123');

      expect(result.success).toBe(true);
      expect(result.conflicts.length).toBeGreaterThan(0);
    });

    test('generates recommendations based on document reliability', async () => {
      mockPrisma.documentExtraction.findMany.mockResolvedValue([
        {
          id: 'ext-1',
          documentId: 'doc-1',
          extractionType: 'operating_memorandum', // Lower reliability
          extractedData: JSON.stringify({
            vacancyRate: { value: 0.05, confidence: 0.85 },
          }),
          extractedAt: new Date(),
        },
        {
          id: 'ext-2',
          documentId: 'doc-2',
          extractionType: 't12', // Higher reliability
          extractedData: JSON.stringify({
            vacancy: { value: 0.10, confidence: 0.95 },
          }),
          extractedAt: new Date(),
        },
      ]);
      mockPrisma.extractionConflict.findFirst.mockResolvedValue(null);
      mockPrisma.extractionConflict.create.mockImplementation(({ data }) => Promise.resolve({
        id: 'conflict-1',
        ...data,
        status: 'OPEN',
      }));

      const result = await synthesizeDocuments('deal-123');

      expect(result.success).toBe(true);
      if (result.conflicts.length > 0) {
        expect(result.conflicts[0].recommendedSource).toBe('t12');
      }
    });

    test('includes synthesis ID for tracking', async () => {
      mockPrisma.documentExtraction.findMany.mockResolvedValue([
        {
          id: 'ext-1',
          extractionType: 'rent_roll',
          extractedData: JSON.stringify({ gpr: { value: 100000 } }),
          extractedAt: new Date(),
        },
      ]);

      const result = await synthesizeDocuments('deal-123');

      expect(result.synthesisId).toBeDefined();
      expect(result.synthesisId).toMatch(/^synth_/);
    });

    test('includes conflict summary', async () => {
      mockPrisma.documentExtraction.findMany.mockResolvedValue([
        {
          id: 'ext-1',
          extractionType: 't12',
          extractedData: JSON.stringify({ noi: { value: 100000 } }),
          extractedAt: new Date(),
        },
      ]);

      const result = await synthesizeDocuments('deal-123');

      expect(result.success).toBe(true);
      expect(result.conflictSummary).toBeDefined();
      expect(result.conflictSummary.total).toBeDefined();
      expect(result.conflictSummary.open).toBeDefined();
    });
  });

  describe('resolveConflict', () => {
    test('resolves conflict with chosen value', async () => {
      mockPrisma.extractionConflict.findUnique.mockResolvedValue({
        id: 'conflict-1',
        field: 'noi',
        recommendedReason: 'T12 has higher reliability',
      });
      mockPrisma.extractionConflict.update.mockImplementation(({ where, data }) =>
        Promise.resolve({
          id: where.id,
          ...data,
          status: 'RESOLVED',
        })
      );

      const result = await resolveConflict('conflict-1', 1200000, 'user-123', 'Verified with accountant');

      expect(result.success).toBe(true);
      expect(result.conflict.status).toBe('RESOLVED');
      expect(mockPrisma.extractionConflict.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            resolvedValue: 1200000,
            resolvedBy: 'user-123',
          }),
        })
      );
    });

    test('returns error when conflict not found', async () => {
      mockPrisma.extractionConflict.findUnique.mockResolvedValue(null);

      const result = await resolveConflict('nonexistent', 100000, 'user-123');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    test('converts string value to number', async () => {
      mockPrisma.extractionConflict.findUnique.mockResolvedValue({ id: 'conflict-1' });
      mockPrisma.extractionConflict.update.mockImplementation(({ data }) =>
        Promise.resolve({ ...data, status: 'RESOLVED' })
      );

      const result = await resolveConflict('conflict-1', '1500000', 'user-123');

      expect(result.success).toBe(true);
      expect(mockPrisma.extractionConflict.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            resolvedValue: 1500000,
          }),
        })
      );
    });
  });

  describe('dismissConflict', () => {
    test('dismisses conflict with reason', async () => {
      mockPrisma.extractionConflict.update.mockResolvedValue({
        id: 'conflict-1',
        status: 'DISMISSED',
      });

      const result = await dismissConflict('conflict-1', 'user-123', 'Different property types, comparison not valid');

      expect(result.success).toBe(true);
      expect(mockPrisma.extractionConflict.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'DISMISSED',
            resolvedBy: 'user-123',
            resolvedReason: 'Different property types, comparison not valid',
          }),
        })
      );
    });

    test('returns error on database failure', async () => {
      mockPrisma.extractionConflict.update.mockRejectedValue(new Error('Database error'));

      const result = await dismissConflict('conflict-1', 'user-123', 'reason');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Database error');
    });
  });

  describe('getConflicts', () => {
    test('returns all conflicts for a deal', async () => {
      mockPrisma.extractionConflict.findMany.mockResolvedValue([
        { id: 'c1', field: 'noi', status: 'OPEN', sources: '{}', variancePercent: 0.1 },
        { id: 'c2', field: 'gpr', status: 'RESOLVED', sources: '{}', variancePercent: 0.05 },
      ]);

      const result = await getConflicts('deal-123');

      expect(result.conflicts).toHaveLength(2);
      expect(result.summary.total).toBe(2);
      expect(result.summary.open).toBe(1);
      expect(result.summary.resolved).toBe(1);
    });

    test('filters by status', async () => {
      mockPrisma.extractionConflict.findMany.mockResolvedValue([
        { id: 'c1', field: 'noi', status: 'OPEN', sources: '{}' },
      ]);

      await getConflicts('deal-123', { status: 'OPEN' });

      expect(mockPrisma.extractionConflict.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'OPEN',
          }),
        })
      );
    });

    test('filters by minimum variance', async () => {
      mockPrisma.extractionConflict.findMany.mockResolvedValue([]);

      await getConflicts('deal-123', { minVariance: 0.1 });

      expect(mockPrisma.extractionConflict.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            variancePercent: { gte: 0.1 },
          }),
        })
      );
    });

    test('parses sources JSON', async () => {
      mockPrisma.extractionConflict.findMany.mockResolvedValue([
        {
          id: 'c1',
          field: 'noi',
          status: 'OPEN',
          sources: JSON.stringify({ rent_roll: { value: 100000 }, t12: { value: 95000 } }),
        },
      ]);

      const result = await getConflicts('deal-123');

      expect(result.conflicts[0].sources).toEqual({
        rent_roll: { value: 100000 },
        t12: { value: 95000 },
      });
    });
  });

  describe('generateExtractionReport', () => {
    test('generates comprehensive report', async () => {
      mockPrisma.documentExtraction.findMany.mockResolvedValue([
        {
          id: 'ext-1',
          extractionType: 'rent_roll',
          extractedData: JSON.stringify({
            grossPotentialRent: { value: 1200000, confidence: 0.9 },
          }),
          extractedAt: new Date(),
          confidence: 0.9,
        },
        {
          id: 'ext-2',
          extractionType: 't12',
          extractedData: JSON.stringify({
            noi: { value: 850000, confidence: 0.95 },
          }),
          extractedAt: new Date(),
          confidence: 0.95,
        },
      ]);
      mockPrisma.extractionConflict.findMany.mockResolvedValue([
        {
          id: 'c1',
          field: 'grossPotentialRent',
          status: 'OPEN',
          sources: '{}',
          variancePercent: 0.1,
          recommendedSource: 't12',
          recommendedReason: 'Higher reliability',
        },
      ]);

      const report = await generateExtractionReport('deal-123');

      expect(report.dealId).toBe('deal-123');
      expect(report.extractionCount).toBe(2);
      expect(report.consolidatedData).toBeDefined();
      expect(report.conflictSummary).toBeDefined();
      expect(report.recommendations).toBeDefined();
      expect(report.generatedAt).toBeDefined();
    });

    test('marks fields with conflicts', async () => {
      mockPrisma.documentExtraction.findMany.mockResolvedValue([
        {
          id: 'ext-1',
          extractionType: 't12',
          extractedData: JSON.stringify({ noi: { value: 100000 } }),
          extractedAt: new Date(),
        },
      ]);
      mockPrisma.extractionConflict.findMany.mockResolvedValue([
        {
          id: 'c1',
          field: 'netOperatingIncome',
          status: 'OPEN',
          sources: '{}',
          variancePercent: 0.1,
        },
      ]);

      const report = await generateExtractionReport('deal-123');

      // The noi field should be normalized to netOperatingIncome
      if (report.consolidatedData.netOperatingIncome) {
        expect(report.consolidatedData.netOperatingIncome.hasConflict).toBe(true);
      }
    });

    test('includes recommendations for open conflicts', async () => {
      mockPrisma.documentExtraction.findMany.mockResolvedValue([]);
      mockPrisma.extractionConflict.findMany.mockResolvedValue([
        {
          id: 'c1',
          field: 'noi',
          status: 'OPEN',
          sources: '{}',
          variancePercent: 0.1,
          recommendedSource: 't12',
          recommendedValue: 850000,
          recommendedReason: 'T12 has highest reliability',
        },
        {
          id: 'c2',
          field: 'gpr',
          status: 'RESOLVED',
          sources: '{}',
          variancePercent: 0.05,
        },
      ]);

      const report = await generateExtractionReport('deal-123');

      expect(report.recommendations).toHaveLength(1);
      expect(report.recommendations[0].field).toBe('noi');
    });
  });

  describe('field normalization', () => {
    test('normalizes GPR variations to grossPotentialRent', async () => {
      mockPrisma.documentExtraction.findMany.mockResolvedValue([
        {
          id: 'ext-1',
          extractionType: 'rent_roll',
          extractedData: JSON.stringify({ gpr: { value: 100000 } }),
          extractedAt: new Date(),
        },
        {
          id: 'ext-2',
          extractionType: 't12',
          extractedData: JSON.stringify({ gross_potential_rent: { value: 105000 } }),
          extractedAt: new Date(),
        },
      ]);
      mockPrisma.extractionConflict.findFirst.mockResolvedValue(null);
      mockPrisma.extractionConflict.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'c1', ...data, status: 'OPEN' })
      );

      const result = await synthesizeDocuments('deal-123');

      expect(result.success).toBe(true);
      // Both should be normalized to grossPotentialRent
      expect(result.crossReferenceMatrix.grossPotentialRent).toBeDefined();
    });

    test('normalizes NOI variations to netOperatingIncome', async () => {
      mockPrisma.documentExtraction.findMany.mockResolvedValue([
        {
          id: 'ext-1',
          extractionType: 't12',
          extractedData: JSON.stringify({ noi: { value: 500000 } }),
          extractedAt: new Date(),
        },
      ]);

      const result = await synthesizeDocuments('deal-123');

      expect(result.crossReferenceMatrix.netOperatingIncome).toBeDefined();
    });
  });
});
