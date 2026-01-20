/**
 * Phase 3 Tests - Buyer Portal & AI Triage
 *
 * Tests for buyer-side functionality and AI scoring.
 *
 * @jest-environment node
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Test data
const TEST_ORG_ID = 'test-org-buyer-portal';
const TEST_BUYER_ORG_ID = 'test-org-buyer-side';
const TEST_BROKER = {
  id: 'test-broker-bp',
  name: 'Test Broker',
  email: 'broker@test.com',
  organizationId: TEST_ORG_ID,
  role: 'GP'
};
const TEST_BUYER = {
  id: 'test-buyer-bp',
  name: 'Test Buyer',
  email: 'buyer@test.com',
  organizationId: TEST_BUYER_ORG_ID,
  role: 'GP'
};

let testDealDraftId;
let testCriteriaId;

describe('Buyer AI Triage Service', () => {
  beforeAll(async () => {
    await cleanupTestData();

    // Create test organizations (needed for foreign keys)
    await prisma.organization.upsert({
      where: { id: TEST_ORG_ID },
      update: {},
      create: { id: TEST_ORG_ID, name: 'Test Seller Organization', slug: 'test-seller-org-bp' }
    });
    await prisma.organization.upsert({
      where: { id: TEST_BUYER_ORG_ID },
      update: {},
      create: { id: TEST_BUYER_ORG_ID, name: 'Test Buyer Organization', slug: 'test-buyer-org-bp' }
    });
  });

  afterAll(async () => {
    await cleanupTestData();
    // Clean up organizations last
    await prisma.authUser.deleteMany({
      where: { organizationId: { in: [TEST_ORG_ID, TEST_BUYER_ORG_ID] } }
    });
    await prisma.organization.deleteMany({
      where: { id: { in: [TEST_ORG_ID, TEST_BUYER_ORG_ID] } }
    });
    await prisma.$disconnect();
  });

  async function cleanupTestData() {
    await prisma.buyerResponse.deleteMany({
      where: { buyerUserId: TEST_BUYER.id }
    });
    await prisma.buyerAITriage.deleteMany({
      where: { buyerCriteria: { userId: TEST_BUYER.id } }
    });
    await prisma.buyerAICriteria.deleteMany({
      where: { userId: TEST_BUYER.id }
    });
    await prisma.distributionRecipient.deleteMany({
      where: { buyerUserId: TEST_BUYER.id }
    });
    await prisma.dealDistribution.deleteMany({
      where: { dealDraft: { organizationId: TEST_ORG_ID } }
    });
    await prisma.dealIntakeEventLog.deleteMany({
      where: { organizationId: TEST_ORG_ID }
    });
    await prisma.oMVersion.deleteMany({
      where: { dealDraft: { organizationId: TEST_ORG_ID } }
    });
    await prisma.dealDraftSeller.deleteMany({
      where: { dealDraft: { organizationId: TEST_ORG_ID } }
    });
    await prisma.dealDraftBroker.deleteMany({
      where: { dealDraft: { organizationId: TEST_ORG_ID } }
    });
    await prisma.dealDraft.deleteMany({
      where: { organizationId: TEST_ORG_ID }
    });
  }

  beforeEach(async () => {
    await cleanupTestData();

    // Create buyer user
    await prisma.authUser.upsert({
      where: { id: TEST_BUYER.id },
      update: {},
      create: {
        id: TEST_BUYER.id,
        email: TEST_BUYER.email,
        name: TEST_BUYER.name,
        role: TEST_BUYER.role,
        organizationId: TEST_BUYER_ORG_ID,
        passwordHash: 'test'
      }
    });

    // Create a deal for testing
    const dealDraft = await prisma.dealDraft.create({
      data: {
        organizationId: TEST_ORG_ID,
        status: 'DISTRIBUTED',
        ingestSource: 'UPLOAD',
        propertyName: 'Buyer Portal Test Property',
        propertyAddress: '123 Main St, Austin, TX 78701',
        assetType: 'MULTIFAMILY',
        askingPrice: 30000000,
        unitCount: 200,
        totalSF: 160000
      }
    });
    testDealDraftId = dealDraft.id;
  });

  describe('Criteria Management', () => {
    it('should create buyer criteria', async () => {
      const { buyerAITriageService } = await import('../services/buyer-ai-triage.js');

      const criteria = await buyerAITriageService.upsertCriteria(TEST_BUYER.id, {
        assetTypes: ['MULTIFAMILY', 'INDUSTRIAL'],
        geographiesInclude: ['TX', 'FL'],
        minUnits: 50,
        maxUnits: 300,
        minPrice: 10000000,
        maxPrice: 50000000
      });

      expect(criteria).toBeDefined();
      expect(criteria.userId).toBe(TEST_BUYER.id);
      testCriteriaId = criteria.id;
    });

    it('should update existing criteria', async () => {
      const { buyerAITriageService } = await import('../services/buyer-ai-triage.js');

      // Create
      await buyerAITriageService.upsertCriteria(TEST_BUYER.id, {
        assetTypes: ['MULTIFAMILY'],
        minUnits: 50
      });

      // Update
      const updated = await buyerAITriageService.upsertCriteria(TEST_BUYER.id, {
        maxUnits: 500
      });

      // Should preserve previous values and add new ones
      const parsedTypes = JSON.parse(updated.assetTypes);
      expect(parsedTypes).toContain('MULTIFAMILY');
      expect(updated.maxUnits).toBe(500);
    });

    it('should get criteria with parsed JSON fields', async () => {
      const { buyerAITriageService } = await import('../services/buyer-ai-triage.js');

      await buyerAITriageService.upsertCriteria(TEST_BUYER.id, {
        assetTypes: ['MULTIFAMILY', 'INDUSTRIAL'],
        geographiesInclude: ['TX', 'FL']
      });

      const criteria = await buyerAITriageService.getCriteria(TEST_BUYER.id);

      expect(criteria.assetTypes).toEqual(['MULTIFAMILY', 'INDUSTRIAL']);
      expect(criteria.geographiesInclude).toEqual(['TX', 'FL']);
    });

    it('should delete criteria', async () => {
      const { buyerAITriageService } = await import('../services/buyer-ai-triage.js');

      await buyerAITriageService.upsertCriteria(TEST_BUYER.id, {
        assetTypes: ['MULTIFAMILY']
      });

      await buyerAITriageService.deleteCriteria(TEST_BUYER.id);

      const criteria = await buyerAITriageService.getCriteria(TEST_BUYER.id);
      expect(criteria).toBeNull();
    });
  });

  describe('Deal Scoring', () => {
    it('should score deal that matches criteria', async () => {
      const { buyerAITriageService } = await import('../services/buyer-ai-triage.js');

      // Create criteria that matches the test deal
      await buyerAITriageService.upsertCriteria(TEST_BUYER.id, {
        assetTypes: ['MULTIFAMILY'],
        geographiesInclude: ['TX'],
        minUnits: 100,
        maxUnits: 300,
        minPrice: 20000000,
        maxPrice: 50000000
      });

      const result = await buyerAITriageService.scoreDeal(testDealDraftId, TEST_BUYER.id);

      expect(result).toBeDefined();
      expect(result.passesFilters).toBe(true);
      expect(result.relevanceScore).toBeGreaterThan(50);
      expect(result.filterResults).toBeDefined();
      expect(result.summary).toBeDefined();
    });

    it('should fail scoring for deal outside criteria', async () => {
      const { buyerAITriageService } = await import('../services/buyer-ai-triage.js');

      // Create criteria that doesn't match the test deal
      await buyerAITriageService.upsertCriteria(TEST_BUYER.id, {
        assetTypes: ['OFFICE'], // Deal is MULTIFAMILY
        maxPrice: 10000000 // Deal is 30M
      });

      const result = await buyerAITriageService.scoreDeal(testDealDraftId, TEST_BUYER.id);

      expect(result.passesFilters).toBe(false);
      expect(result.filterResults.some(f => !f.passed)).toBe(true);
    });

    it('should generate flags for edge cases', async () => {
      const { buyerAITriageService } = await import('../services/buyer-ai-triage.js');

      // Create criteria where price is at the edge
      await buyerAITriageService.upsertCriteria(TEST_BUYER.id, {
        assetTypes: ['MULTIFAMILY'],
        maxPrice: 32000000 // Deal is 30M, so within range but close to max
      });

      const result = await buyerAITriageService.scoreDeal(testDealDraftId, TEST_BUYER.id);

      expect(result.flags).toBeDefined();
      expect(Array.isArray(result.flags)).toBe(true);
    });

    it('should update existing triage result', async () => {
      const { buyerAITriageService } = await import('../services/buyer-ai-triage.js');

      await buyerAITriageService.upsertCriteria(TEST_BUYER.id, {
        assetTypes: ['MULTIFAMILY']
      });

      // Score once
      const first = await buyerAITriageService.scoreDeal(testDealDraftId, TEST_BUYER.id);

      // Score again
      const second = await buyerAITriageService.scoreDeal(testDealDraftId, TEST_BUYER.id);

      // Should be same triage record (updated)
      expect(second.id).toBe(first.id);
    });
  });

  describe('Filter Types', () => {
    it('should export filter types', async () => {
      const { FILTER_TYPES } = await import('../services/buyer-ai-triage.js');

      expect(FILTER_TYPES.ASSET_TYPE).toBe('assetTypes');
      expect(FILTER_TYPES.GEOGRAPHY_INCLUDE).toBe('geographiesInclude');
      expect(FILTER_TYPES.MIN_UNITS).toBe('minUnits');
      expect(FILTER_TYPES.MAX_PRICE).toBe('maxPrice');
    });

    it('should export flag types', async () => {
      const { FLAG_TYPES } = await import('../services/buyer-ai-triage.js');

      expect(FLAG_TYPES.EXCEEDS_CRITERIA).toBe('EXCEEDS_CRITERIA');
      expect(FLAG_TYPES.OPPORTUNITY).toBe('OPPORTUNITY');
      expect(FLAG_TYPES.CONCERN).toBe('CONCERN');
    });
  });

  describe('Hard Filters', () => {
    it('should fail asset type filter', async () => {
      const { buyerAITriageService } = await import('../services/buyer-ai-triage.js');

      await buyerAITriageService.upsertCriteria(TEST_BUYER.id, {
        assetTypes: ['OFFICE', 'RETAIL'] // Deal is MULTIFAMILY
      });

      const result = await buyerAITriageService.scoreDeal(testDealDraftId, TEST_BUYER.id);

      expect(result.passesFilters).toBe(false);
      const assetTypeFilter = result.filterResults.find(f => f.filter === 'assetTypes');
      expect(assetTypeFilter.passed).toBe(false);
    });

    it('should fail geography include filter', async () => {
      const { buyerAITriageService } = await import('../services/buyer-ai-triage.js');

      await buyerAITriageService.upsertCriteria(TEST_BUYER.id, {
        geographiesInclude: ['CA', 'NY'] // Deal is in TX
      });

      const result = await buyerAITriageService.scoreDeal(testDealDraftId, TEST_BUYER.id);

      expect(result.passesFilters).toBe(false);
    });

    it('should fail geography exclude filter', async () => {
      const { buyerAITriageService } = await import('../services/buyer-ai-triage.js');

      await buyerAITriageService.upsertCriteria(TEST_BUYER.id, {
        geographiesExclude: ['TX'] // Deal is in TX - should be excluded
      });

      const result = await buyerAITriageService.scoreDeal(testDealDraftId, TEST_BUYER.id);

      expect(result.passesFilters).toBe(false);
    });

    it('should fail min units filter', async () => {
      const { buyerAITriageService } = await import('../services/buyer-ai-triage.js');

      await buyerAITriageService.upsertCriteria(TEST_BUYER.id, {
        minUnits: 300 // Deal has 200 units
      });

      const result = await buyerAITriageService.scoreDeal(testDealDraftId, TEST_BUYER.id);

      expect(result.passesFilters).toBe(false);
    });

    it('should fail max price filter', async () => {
      const { buyerAITriageService } = await import('../services/buyer-ai-triage.js');

      await buyerAITriageService.upsertCriteria(TEST_BUYER.id, {
        maxPrice: 20000000 // Deal is 30M
      });

      const result = await buyerAITriageService.scoreDeal(testDealDraftId, TEST_BUYER.id);

      expect(result.passesFilters).toBe(false);
    });
  });

  describe('Soft Scoring', () => {
    it('should give higher score for preferred asset type', async () => {
      const { buyerAITriageService } = await import('../services/buyer-ai-triage.js');

      // Preferred asset type first
      await buyerAITriageService.upsertCriteria(TEST_BUYER.id, {
        assetTypes: ['MULTIFAMILY', 'INDUSTRIAL'] // MULTIFAMILY is first = preferred
      });

      const result = await buyerAITriageService.scoreDeal(testDealDraftId, TEST_BUYER.id);

      // Score breakdown should show asset type match
      const assetScore = result.scoreBreakdown.find(s => s.criterion === 'assetTypeMatch');
      expect(assetScore.score).toBe(100); // Preferred match
    });

    it('should score price in sweet spot higher', async () => {
      const { buyerAITriageService } = await import('../services/buyer-ai-triage.js');

      // Price range where deal (30M) is in the middle
      await buyerAITriageService.upsertCriteria(TEST_BUYER.id, {
        minPrice: 25000000,
        maxPrice: 35000000 // 30M is exactly in the middle
      });

      const result = await buyerAITriageService.scoreDeal(testDealDraftId, TEST_BUYER.id);

      const priceScore = result.scoreBreakdown.find(s => s.criterion === 'priceRange');
      expect(priceScore.score).toBeGreaterThan(80); // Should be high since in sweet spot
    });
  });

  describe('Summary Generation', () => {
    it('should generate summary with deal info', async () => {
      const { buyerAITriageService } = await import('../services/buyer-ai-triage.js');

      await buyerAITriageService.upsertCriteria(TEST_BUYER.id, {
        assetTypes: ['MULTIFAMILY']
      });

      const result = await buyerAITriageService.scoreDeal(testDealDraftId, TEST_BUYER.id);

      expect(result.summary).toContain('Buyer Portal Test Property');
      expect(result.summary).toContain('MULTIFAMILY');
      expect(result.summary).toContain('200 units');
      expect(result.summary).toContain('Relevance Score');
    });
  });

  describe('Get Triage Result', () => {
    it('should get existing triage result', async () => {
      const { buyerAITriageService } = await import('../services/buyer-ai-triage.js');

      await buyerAITriageService.upsertCriteria(TEST_BUYER.id, {
        assetTypes: ['MULTIFAMILY']
      });

      // Score first
      await buyerAITriageService.scoreDeal(testDealDraftId, TEST_BUYER.id);

      // Then get
      const result = await buyerAITriageService.getTriageResult(testDealDraftId, TEST_BUYER.id);

      expect(result).toBeDefined();
      expect(result.filterResults).toBeInstanceOf(Array);
      expect(result.scoreBreakdown).toBeInstanceOf(Array);
    });

    it('should return null if no triage exists', async () => {
      const { buyerAITriageService } = await import('../services/buyer-ai-triage.js');

      await buyerAITriageService.upsertCriteria(TEST_BUYER.id, {
        assetTypes: ['MULTIFAMILY']
      });

      // Don't score - just try to get
      const result = await buyerAITriageService.getTriageResult(testDealDraftId, TEST_BUYER.id);

      expect(result).toBeNull();
    });
  });

  describe('Score All Deals', () => {
    it('should score all deals in buyer inbox', async () => {
      const { buyerAITriageService } = await import('../services/buyer-ai-triage.js');
      const { distributionService } = await import('../services/distribution.js');

      // Setup: Create criteria
      await buyerAITriageService.upsertCriteria(TEST_BUYER.id, {
        assetTypes: ['MULTIFAMILY']
      });

      // Setup: Add broker and seller-approved OM so we can distribute
      await prisma.dealDraftBroker.create({
        data: {
          dealDraftId: testDealDraftId,
          userId: TEST_BROKER.id,
          email: TEST_BROKER.email,
          name: TEST_BROKER.name,
          role: 'PRIMARY',
          canDistribute: true
        }
      });

      await prisma.oMVersion.create({
        data: {
          dealDraftId: testDealDraftId,
          versionNumber: 1,
          status: 'SELLER_APPROVED',
          content: JSON.stringify({ sections: {} }),
          createdBy: TEST_BROKER.id,
          createdByName: TEST_BROKER.name
        }
      });

      // Update deal status
      await prisma.dealDraft.update({
        where: { id: testDealDraftId },
        data: { status: 'OM_APPROVED_FOR_MARKETING' }
      });

      // Distribute to buyer
      await distributionService.createDistribution(
        testDealDraftId,
        {
          listingType: 'PRIVATE',
          manualRecipientIds: [TEST_BUYER.id]
        },
        TEST_BROKER
      );

      // Score all
      const results = await buyerAITriageService.scoreAllDealsForBuyer(TEST_BUYER.id);

      expect(results.length).toBe(1);
      expect(results[0].dealDraftId).toBe(testDealDraftId);
    });
  });
});
