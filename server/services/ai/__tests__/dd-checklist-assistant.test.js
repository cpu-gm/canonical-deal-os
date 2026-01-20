/**
 * DD Checklist AI Assistant Tests
 *
 * Tests for the Due Diligence Checklist AI Assistant service.
 */

import { jest, describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from '@jest/globals';

// Mock Prisma
const mockPrisma = {
  dDCategory: {
    findMany: jest.fn(),
    create: jest.fn(),
    deleteMany: jest.fn(),
  },
  dDTemplateItem: {
    findMany: jest.fn(),
    create: jest.fn(),
    deleteMany: jest.fn(),
  },
  dDChecklist: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  dDItem: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  dDItemHistory: {
    findMany: jest.fn(),
    create: jest.fn(),
  },
  dDDocumentApproval: {
    findUnique: jest.fn(),
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
  initializeChecklist,
  getStageFilteredItems,
  getDDCompletionStatus,
  updateItemStatus,
  assignItem,
  linkDocument,
  markAsVerified,
  markItemNA,
  addCustomItem,
  getChecklist,
  getItemHistory,
  getTemplateLibrary,
  STATE_ORDER,
  ITEM_STATUS,
  ITEM_PRIORITY,
} = await import('../dd-checklist-assistant.js');

describe('DD Checklist AI Assistant', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ==================== initializeChecklist ====================

  describe('initializeChecklist', () => {
    const mockDealId = 'deal-123';
    const mockOrgId = 'org-456';

    const mockTemplateItems = [
      {
        id: 'template-1',
        code: 'TITLE_001',
        title: 'Order Title Commitment',
        description: 'Order title commitment',
        defaultResponsible: 'BUYER',
        priority: 'CRITICAL',
        requiresDocument: true,
        deadlineType: 'PSA_RELATIVE',
        deadlineDaysOffset: 5,
        availableFromState: 'PSA_DRAFT',
        category: { code: 'TITLE' },
      },
      {
        id: 'template-2',
        code: 'ENV_001',
        title: 'Order Phase I ESA',
        description: 'Order Phase I',
        defaultResponsible: 'BUYER',
        priority: 'CRITICAL',
        requiresDocument: true,
        deadlineType: 'DD_RELATIVE',
        deadlineDaysOffset: -10,
        availableFromState: 'DD_ACTIVE',
        category: { code: 'ENVIRONMENTAL' },
      },
    ];

    it('creates checklist from template', async () => {
      mockPrisma.dDChecklist.findUnique.mockResolvedValue(null);
      mockPrisma.dDTemplateItem.findMany.mockResolvedValue(mockTemplateItems);
      mockPrisma.dDChecklist.create.mockResolvedValue({
        id: 'checklist-1',
        dealId: mockDealId,
        status: 'NOT_STARTED',
        totalItems: 2,
      });
      mockPrisma.dDItem.create.mockResolvedValue({ id: 'item-1' });
      mockPrisma.dDItemHistory.create.mockResolvedValue({});

      const result = await initializeChecklist(mockDealId, {
        organizationId: mockOrgId,
        psaEffectiveDate: '2025-01-01',
        ddExpirationDate: '2025-01-30',
        targetClosingDate: '2025-02-15',
      });

      expect(result.success).toBe(true);
      expect(result.checklist).toBeDefined();
      expect(mockPrisma.dDChecklist.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.dDItem.create).toHaveBeenCalledTimes(2);
    });

    it('calculates deadlines from deal dates', async () => {
      mockPrisma.dDChecklist.findUnique.mockResolvedValue(null);
      mockPrisma.dDTemplateItem.findMany.mockResolvedValue(mockTemplateItems);
      mockPrisma.dDChecklist.create.mockResolvedValue({
        id: 'checklist-1',
        dealId: mockDealId,
      });
      mockPrisma.dDItem.create.mockResolvedValue({ id: 'item-1' });
      mockPrisma.dDItemHistory.create.mockResolvedValue({});

      await initializeChecklist(mockDealId, {
        psaEffectiveDate: '2025-01-01',
        ddExpirationDate: '2025-01-30',
      });

      // First item: PSA_RELATIVE, +5 days from PSA date
      const firstCreateCall = mockPrisma.dDItem.create.mock.calls[0][0].data;
      expect(firstCreateCall.dueDate).toEqual(new Date('2025-01-06'));

      // Second item: DD_RELATIVE, -10 days from DD expiration
      const secondCreateCall = mockPrisma.dDItem.create.mock.calls[1][0].data;
      expect(secondCreateCall.dueDate).toEqual(new Date('2025-01-20'));
    });

    it('returns error when checklist already exists', async () => {
      mockPrisma.dDChecklist.findUnique.mockResolvedValue({
        id: 'existing-checklist',
        dealId: mockDealId,
      });

      const result = await initializeChecklist(mockDealId, {});

      expect(result.success).toBe(false);
      expect(result.reason).toBe('CHECKLIST_EXISTS');
    });

    it('handles missing deal dates gracefully', async () => {
      mockPrisma.dDChecklist.findUnique.mockResolvedValue(null);
      mockPrisma.dDTemplateItem.findMany.mockResolvedValue(mockTemplateItems);
      mockPrisma.dDChecklist.create.mockResolvedValue({
        id: 'checklist-1',
        dealId: mockDealId,
      });
      mockPrisma.dDItem.create.mockResolvedValue({ id: 'item-1' });
      mockPrisma.dDItemHistory.create.mockResolvedValue({});

      // No dates provided
      const result = await initializeChecklist(mockDealId, {});

      expect(result.success).toBe(true);
      // Due dates should be null when reference dates are missing
      const createCall = mockPrisma.dDItem.create.mock.calls[0][0].data;
      expect(createCall.dueDate).toBeNull();
    });
  });

  // ==================== getStageFilteredItems ====================

  describe('getStageFilteredItems', () => {
    const mockDealId = 'deal-123';

    it('only returns stage-appropriate items', async () => {
      mockPrisma.dDChecklist.findUnique.mockResolvedValue({
        id: 'checklist-1',
        dealId: mockDealId,
        items: [
          { id: 'item-1', code: 'TITLE_001', categoryCode: 'TITLE', availableFromState: 'PSA_DRAFT', status: 'NOT_STARTED', priority: 'CRITICAL' },
          { id: 'item-2', code: 'ENV_001', categoryCode: 'ENVIRONMENTAL', availableFromState: 'DD_ACTIVE', status: 'NOT_STARTED', priority: 'CRITICAL' },
          { id: 'item-3', code: 'POST_001', categoryCode: 'POST_CLOSING', availableFromState: 'CLOSED', status: 'NOT_STARTED', priority: 'HIGH' },
        ],
      });

      // At DD_ACTIVE state, should see TITLE and ENV but not POST_CLOSING
      const result = await getStageFilteredItems(mockDealId, 'DD_ACTIVE');

      expect(result).not.toBeNull();
      expect(result.items.length).toBe(2);
      expect(result.items.map(i => i.code)).toContain('TITLE_001');
      expect(result.items.map(i => i.code)).toContain('ENV_001');
      expect(result.items.map(i => i.code)).not.toContain('POST_001');
    });

    it('returns null when checklist not found', async () => {
      mockPrisma.dDChecklist.findUnique.mockResolvedValue(null);

      const result = await getStageFilteredItems(mockDealId, 'DD_ACTIVE');

      expect(result).toBeNull();
    });

    it('groups items by category with counts', async () => {
      mockPrisma.dDChecklist.findUnique.mockResolvedValue({
        id: 'checklist-1',
        dealId: mockDealId,
        items: [
          { id: 'item-1', code: 'TITLE_001', categoryCode: 'TITLE', availableFromState: 'DD_ACTIVE', status: 'COMPLETE', priority: 'CRITICAL' },
          { id: 'item-2', code: 'TITLE_002', categoryCode: 'TITLE', availableFromState: 'DD_ACTIVE', status: 'IN_PROGRESS', priority: 'HIGH' },
          { id: 'item-3', code: 'ENV_001', categoryCode: 'ENVIRONMENTAL', availableFromState: 'DD_ACTIVE', status: 'NOT_STARTED', priority: 'CRITICAL' },
        ],
      });

      const result = await getStageFilteredItems(mockDealId, 'DD_ACTIVE');

      expect(result.categories.length).toBe(2);

      const titleCategory = result.categories.find(c => c.code === 'TITLE');
      expect(titleCategory.total).toBe(2);
      expect(titleCategory.completed).toBe(1);
      expect(titleCategory.inProgress).toBe(1);

      const envCategory = result.categories.find(c => c.code === 'ENVIRONMENTAL');
      expect(envCategory.total).toBe(1);
      expect(envCategory.notStarted).toBe(1);
    });
  });

  // ==================== getDDCompletionStatus ====================

  describe('getDDCompletionStatus', () => {
    const mockDealId = 'deal-123';

    it('returns blocked when critical items incomplete', async () => {
      mockPrisma.dDChecklist.findUnique.mockResolvedValue({
        id: 'checklist-1',
        dealId: mockDealId,
        items: [
          { id: 'item-1', code: 'TITLE_001', title: 'Order Title', priority: 'CRITICAL', status: 'COMPLETE' },
          { id: 'item-2', code: 'ENV_001', title: 'Order Phase I', priority: 'CRITICAL', status: 'NOT_STARTED' },
          { id: 'item-3', code: 'FIN_001', title: 'Get T12', priority: 'HIGH', status: 'COMPLETE' },
        ],
      });

      const result = await getDDCompletionStatus(mockDealId);

      expect(result.blocked).toBe(true);
      expect(result.reason).toContain('critical DD items incomplete');
      expect(result.blockedItems.length).toBeGreaterThan(0);
    });

    it('returns blocked when high items below threshold', async () => {
      mockPrisma.dDChecklist.findUnique.mockResolvedValue({
        id: 'checklist-1',
        dealId: mockDealId,
        items: [
          { id: 'item-1', code: 'TITLE_001', title: 'Title 1', priority: 'CRITICAL', status: 'COMPLETE' },
          { id: 'item-2', code: 'FIN_001', title: 'Financial 1', priority: 'HIGH', status: 'COMPLETE' },
          { id: 'item-3', code: 'FIN_002', title: 'Financial 2', priority: 'HIGH', status: 'NOT_STARTED' },
          { id: 'item-4', code: 'FIN_003', title: 'Financial 3', priority: 'HIGH', status: 'NOT_STARTED' },
          { id: 'item-5', code: 'FIN_004', title: 'Financial 4', priority: 'HIGH', status: 'NOT_STARTED' },
        ],
      });

      const result = await getDDCompletionStatus(mockDealId);

      expect(result.blocked).toBe(true);
      expect(result.reason).toContain('high-priority DD items');
    });

    it('returns not blocked when thresholds met', async () => {
      mockPrisma.dDChecklist.findUnique.mockResolvedValue({
        id: 'checklist-1',
        dealId: mockDealId,
        items: [
          { id: 'item-1', code: 'TITLE_001', priority: 'CRITICAL', status: 'COMPLETE' },
          { id: 'item-2', code: 'ENV_001', priority: 'CRITICAL', status: 'COMPLETE' },
          { id: 'item-3', code: 'FIN_001', priority: 'HIGH', status: 'COMPLETE' },
          { id: 'item-4', code: 'FIN_002', priority: 'HIGH', status: 'COMPLETE' },
        ],
      });

      const result = await getDDCompletionStatus(mockDealId);

      expect(result.blocked).toBe(false);
    });

    it('handles N/A items correctly', async () => {
      mockPrisma.dDChecklist.findUnique.mockResolvedValue({
        id: 'checklist-1',
        dealId: mockDealId,
        items: [
          { id: 'item-1', code: 'TITLE_001', priority: 'CRITICAL', status: 'COMPLETE' },
          { id: 'item-2', code: 'ENV_004', priority: 'CRITICAL', status: 'N/A' }, // Phase II not needed
          { id: 'item-3', code: 'FIN_001', priority: 'HIGH', status: 'COMPLETE' },
        ],
      });

      const result = await getDDCompletionStatus(mockDealId);

      // N/A items should count as complete
      expect(result.blocked).toBe(false);
    });

    it('returns blocked when checklist not initialized', async () => {
      mockPrisma.dDChecklist.findUnique.mockResolvedValue(null);

      const result = await getDDCompletionStatus(mockDealId);

      expect(result.blocked).toBe(true);
      expect(result.reason).toContain('not initialized');
    });
  });

  // ==================== updateItemStatus ====================

  describe('updateItemStatus', () => {
    it('updates status and creates history', async () => {
      const mockItem = {
        id: 'item-1',
        code: 'TITLE_001',
        status: 'NOT_STARTED',
        checklistId: 'checklist-1',
        checklist: { id: 'checklist-1' },
      };

      mockPrisma.dDItem.findUnique.mockResolvedValue(mockItem);
      mockPrisma.dDItem.update.mockResolvedValue({
        ...mockItem,
        status: 'IN_PROGRESS',
        startedAt: new Date(),
      });
      mockPrisma.dDItemHistory.create.mockResolvedValue({});
      mockPrisma.dDItem.findMany.mockResolvedValue([]);
      mockPrisma.dDChecklist.update.mockResolvedValue({});

      const result = await updateItemStatus('item-1', 'IN_PROGRESS', 'user-1', 'Started work');

      expect(mockPrisma.dDItem.update).toHaveBeenCalled();
      expect(mockPrisma.dDItemHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'STATUS_CHANGED',
          previousStatus: 'NOT_STARTED',
          newStatus: 'IN_PROGRESS',
        }),
      });
    });

    it('sets startedAt when moving to IN_PROGRESS', async () => {
      const mockItem = {
        id: 'item-1',
        status: 'NOT_STARTED',
        startedAt: null,
        checklistId: 'checklist-1',
        checklist: { id: 'checklist-1' },
      };

      mockPrisma.dDItem.findUnique.mockResolvedValue(mockItem);
      mockPrisma.dDItem.update.mockResolvedValue({});
      mockPrisma.dDItemHistory.create.mockResolvedValue({});
      mockPrisma.dDItem.findMany.mockResolvedValue([]);
      mockPrisma.dDChecklist.update.mockResolvedValue({});

      await updateItemStatus('item-1', 'IN_PROGRESS', 'user-1');

      const updateCall = mockPrisma.dDItem.update.mock.calls[0][0].data;
      expect(updateCall.startedAt).toBeDefined();
    });

    it('sets completedAt when moving to COMPLETE', async () => {
      const mockItem = {
        id: 'item-1',
        status: 'IN_PROGRESS',
        checklistId: 'checklist-1',
        checklist: { id: 'checklist-1' },
      };

      mockPrisma.dDItem.findUnique.mockResolvedValue(mockItem);
      mockPrisma.dDItem.update.mockResolvedValue({});
      mockPrisma.dDItemHistory.create.mockResolvedValue({});
      mockPrisma.dDItem.findMany.mockResolvedValue([]);
      mockPrisma.dDChecklist.update.mockResolvedValue({});

      await updateItemStatus('item-1', 'COMPLETE', 'user-1');

      const updateCall = mockPrisma.dDItem.update.mock.calls[0][0].data;
      expect(updateCall.completedAt).toBeDefined();
    });
  });

  // ==================== assignItem ====================

  describe('assignItem', () => {
    it('assigns item and creates history', async () => {
      const mockItem = {
        id: 'item-1',
        code: 'TITLE_001',
      };

      mockPrisma.dDItem.findUnique.mockResolvedValue(mockItem);
      mockPrisma.dDItem.update.mockResolvedValue({
        ...mockItem,
        assignedToUserId: 'user-2',
        assignedToName: 'John Doe',
      });
      mockPrisma.dDItemHistory.create.mockResolvedValue({});

      const result = await assignItem('item-1', 'user-2', 'John Doe', 'user-1');

      expect(mockPrisma.dDItem.update).toHaveBeenCalledWith({
        where: { id: 'item-1' },
        data: expect.objectContaining({
          assignedToUserId: 'user-2',
          assignedToName: 'John Doe',
        }),
      });
      expect(mockPrisma.dDItemHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'ASSIGNED',
          notes: 'Assigned to John Doe',
        }),
      });
    });
  });

  // ==================== linkDocument ====================

  describe('linkDocument', () => {
    it('links document and creates history', async () => {
      const mockItem = {
        id: 'item-1',
        code: 'ENV_001',
        linkedDocumentIds: null,
      };

      mockPrisma.dDItem.findUnique.mockResolvedValue(mockItem);
      mockPrisma.dDItem.update.mockResolvedValue({});
      mockPrisma.dDItemHistory.create.mockResolvedValue({});

      await linkDocument('item-1', 'doc-123', 'user-1');

      const updateCall = mockPrisma.dDItem.update.mock.calls[0][0].data;
      const linkedDocs = JSON.parse(updateCall.linkedDocumentIds);
      expect(linkedDocs).toContain('doc-123');
    });

    it('appends to existing linked documents', async () => {
      const mockItem = {
        id: 'item-1',
        code: 'ENV_001',
        linkedDocumentIds: JSON.stringify(['doc-existing']),
      };

      mockPrisma.dDItem.findUnique.mockResolvedValue(mockItem);
      mockPrisma.dDItem.update.mockResolvedValue({});
      mockPrisma.dDItemHistory.create.mockResolvedValue({});

      await linkDocument('item-1', 'doc-new', 'user-1');

      const updateCall = mockPrisma.dDItem.update.mock.calls[0][0].data;
      const linkedDocs = JSON.parse(updateCall.linkedDocumentIds);
      expect(linkedDocs).toContain('doc-existing');
      expect(linkedDocs).toContain('doc-new');
    });

    it('does not duplicate document links', async () => {
      const mockItem = {
        id: 'item-1',
        code: 'ENV_001',
        linkedDocumentIds: JSON.stringify(['doc-123']),
      };

      mockPrisma.dDItem.findUnique.mockResolvedValue(mockItem);
      mockPrisma.dDItem.update.mockResolvedValue({});
      mockPrisma.dDItemHistory.create.mockResolvedValue({});

      await linkDocument('item-1', 'doc-123', 'user-1'); // Same doc

      const updateCall = mockPrisma.dDItem.update.mock.calls[0][0].data;
      const linkedDocs = JSON.parse(updateCall.linkedDocumentIds);
      expect(linkedDocs.length).toBe(1);
    });
  });

  // ==================== markAsVerified ====================

  describe('markAsVerified', () => {
    it('marks item as verified and complete', async () => {
      const mockItem = {
        id: 'item-1',
        code: 'FIN_001',
        status: 'IN_PROGRESS',
        checklistId: 'checklist-1',
      };

      mockPrisma.dDItem.findUnique.mockResolvedValue(mockItem);
      mockPrisma.dDItem.update.mockResolvedValue({
        ...mockItem,
        status: 'COMPLETE',
        verifiedBy: 'user-1',
      });
      mockPrisma.dDItemHistory.create.mockResolvedValue({});
      mockPrisma.dDItem.findMany.mockResolvedValue([]);
      mockPrisma.dDChecklist.update.mockResolvedValue({});

      const result = await markAsVerified('item-1', 'user-1', 'Jane Smith', 'Verified against source');

      expect(mockPrisma.dDItem.update).toHaveBeenCalledWith({
        where: { id: 'item-1' },
        data: expect.objectContaining({
          verifiedBy: 'user-1',
          verifiedByName: 'Jane Smith',
          status: 'COMPLETE',
        }),
      });
    });
  });

  // ==================== markItemNA ====================

  describe('markItemNA', () => {
    it('requires reason to mark N/A', async () => {
      await expect(markItemNA('item-1', null, 'user-1')).rejects.toThrow('Reason is required');
      await expect(markItemNA('item-1', '', 'user-1')).rejects.toThrow('Reason is required');
    });

    it('marks item as N/A with reason', async () => {
      const mockItem = {
        id: 'item-1',
        code: 'ENV_004',
        status: 'NOT_STARTED',
        checklistId: 'checklist-1',
      };

      mockPrisma.dDItem.findUnique.mockResolvedValue(mockItem);
      mockPrisma.dDItem.update.mockResolvedValue({
        ...mockItem,
        status: 'N/A',
      });
      mockPrisma.dDItemHistory.create.mockResolvedValue({});
      mockPrisma.dDItem.findMany.mockResolvedValue([]);
      mockPrisma.dDChecklist.update.mockResolvedValue({});

      await markItemNA('item-1', 'Phase II not required per Phase I', 'user-1');

      expect(mockPrisma.dDItem.update).toHaveBeenCalledWith({
        where: { id: 'item-1' },
        data: expect.objectContaining({
          status: 'N/A',
          notes: 'Phase II not required per Phase I',
        }),
      });
    });
  });

  // ==================== addCustomItem ====================

  describe('addCustomItem', () => {
    it('creates custom item with generated code', async () => {
      mockPrisma.dDChecklist.findUnique.mockResolvedValue({
        id: 'checklist-1',
        items: [], // No existing custom items
      });
      mockPrisma.dDItem.create.mockResolvedValue({
        id: 'new-item',
        code: 'CUSTOM_001',
      });
      mockPrisma.dDItemHistory.create.mockResolvedValue({});
      mockPrisma.dDChecklist.update.mockResolvedValue({});

      const result = await addCustomItem('checklist-1', {
        title: 'Custom inspection',
        description: 'Special inspection required',
        categoryCode: 'PROPERTY',
        priority: 'HIGH',
      }, 'user-1');

      expect(mockPrisma.dDItem.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          code: 'CUSTOM_001',
          title: 'Custom inspection',
          templateItemId: null,
        }),
      });
    });

    it('increments custom item code', async () => {
      mockPrisma.dDChecklist.findUnique.mockResolvedValue({
        id: 'checklist-1',
        items: [
          { code: 'CUSTOM_001' },
          { code: 'CUSTOM_002' },
        ],
      });
      mockPrisma.dDItem.create.mockResolvedValue({
        id: 'new-item',
        code: 'CUSTOM_003',
      });
      mockPrisma.dDItemHistory.create.mockResolvedValue({});
      mockPrisma.dDChecklist.update.mockResolvedValue({});

      await addCustomItem('checklist-1', {
        title: 'Another custom item',
      }, 'user-1');

      expect(mockPrisma.dDItem.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          code: 'CUSTOM_003',
        }),
      });
    });
  });

  // ==================== getTemplateLibrary ====================

  describe('getTemplateLibrary', () => {
    it('returns categories with items', async () => {
      const mockCategories = [
        {
          id: 'cat-1',
          code: 'TITLE',
          name: 'Title & Legal',
          items: [
            { id: 'item-1', code: 'TITLE_001', title: 'Order Title' },
          ],
        },
        {
          id: 'cat-2',
          code: 'ENVIRONMENTAL',
          name: 'Environmental',
          items: [
            { id: 'item-2', code: 'ENV_001', title: 'Order Phase I' },
          ],
        },
      ];

      mockPrisma.dDCategory.findMany.mockResolvedValue(mockCategories);

      const result = await getTemplateLibrary();

      expect(result.length).toBe(2);
      expect(result[0].items.length).toBe(1);
    });
  });

  // ==================== Constants ====================

  describe('Constants', () => {
    it('exports STATE_ORDER with correct order', () => {
      expect(STATE_ORDER.INTAKE_RECEIVED).toBeLessThan(STATE_ORDER.DD_ACTIVE);
      expect(STATE_ORDER.DD_ACTIVE).toBeLessThan(STATE_ORDER.DD_COMPLETE);
      expect(STATE_ORDER.DD_COMPLETE).toBeLessThan(STATE_ORDER.CLOSED);
    });

    it('exports ITEM_STATUS enum', () => {
      expect(ITEM_STATUS.NOT_STARTED).toBe('NOT_STARTED');
      expect(ITEM_STATUS.COMPLETE).toBe('COMPLETE');
      expect(ITEM_STATUS.NA).toBe('N/A');
    });

    it('exports ITEM_PRIORITY enum', () => {
      expect(ITEM_PRIORITY.CRITICAL).toBe('CRITICAL');
      expect(ITEM_PRIORITY.HIGH).toBe('HIGH');
      expect(ITEM_PRIORITY.MEDIUM).toBe('MEDIUM');
      expect(ITEM_PRIORITY.LOW).toBe('LOW');
    });
  });
});
