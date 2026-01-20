/**
 * Phase 3 Tests - Distribution Service
 *
 * Tests for the deal distribution and buyer response functionality.
 *
 * @jest-environment node
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Test data
const TEST_ORG_ID = 'test-org-distribution';
const TEST_BUYER_ORG_ID = 'test-org-buyer';
const TEST_BROKER = {
  id: 'test-broker-dist',
  name: 'Test Broker',
  email: 'broker@test.com',
  organizationId: TEST_ORG_ID,
  role: 'GP'
};
const TEST_SELLER = {
  id: 'test-seller-dist',
  name: 'Test Seller',
  email: 'seller@test.com',
  organizationId: TEST_ORG_ID
};
const TEST_BUYER = {
  id: 'test-buyer-dist',
  name: 'Test Buyer',
  email: 'buyer@test.com',
  organizationId: TEST_BUYER_ORG_ID,
  role: 'GP'
};

let testDealDraftId;
let testDistributionId;
let testRecipientId;
let testOmVersionId;

describe('Distribution Service', () => {
  beforeAll(async () => {
    // Clean up any existing test data
    await cleanupTestData();

    // Create test organizations (needed for foreign keys)
    await prisma.organization.upsert({
      where: { id: TEST_ORG_ID },
      update: {},
      create: { id: TEST_ORG_ID, name: 'Test Seller Organization', slug: 'test-seller-org-dist' }
    });
    await prisma.organization.upsert({
      where: { id: TEST_BUYER_ORG_ID },
      update: {},
      create: { id: TEST_BUYER_ORG_ID, name: 'Test Buyer Organization', slug: 'test-buyer-org-dist' }
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
    // Clean in order to respect foreign keys
    await prisma.buyerResponse.deleteMany({
      where: { dealDraftId: { startsWith: 'test-deal-dist' } }
    });
    await prisma.buyerAITriage.deleteMany({
      where: { dealDraftId: { startsWith: 'test-deal-dist' } }
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
    // Clean and recreate test data for each test
    await cleanupTestData();

    // Create a deal draft with seller-approved OM
    const dealDraft = await prisma.dealDraft.create({
      data: {
        organizationId: TEST_ORG_ID,
        status: 'OM_APPROVED_FOR_MARKETING',
        ingestSource: 'UPLOAD',
        propertyName: 'Distribution Test Property',
        propertyAddress: '789 Distribution Blvd, Austin, TX 78701',
        assetType: 'MULTIFAMILY',
        askingPrice: 25000000,
        unitCount: 150,
        totalSF: 120000
      }
    });
    testDealDraftId = dealDraft.id;

    // Add broker
    await prisma.dealDraftBroker.create({
      data: {
        dealDraftId: dealDraft.id,
        userId: TEST_BROKER.id,
        email: TEST_BROKER.email,
        name: TEST_BROKER.name,
        firmName: 'Test Brokerage',
        role: 'PRIMARY',
        isPrimaryContact: true,
        canDistribute: true
      }
    });

    // Add seller
    await prisma.dealDraftSeller.create({
      data: {
        dealDraftId: dealDraft.id,
        userId: TEST_SELLER.id,
        email: TEST_SELLER.email,
        name: TEST_SELLER.name,
        entityName: 'Test Seller LLC'
      }
    });

    // Create seller-approved OM version
    const omVersion = await prisma.oMVersion.create({
      data: {
        dealDraftId: dealDraft.id,
        versionNumber: 1,
        status: 'SELLER_APPROVED',
        content: JSON.stringify({ sections: {} }),
        createdBy: TEST_BROKER.id,
        createdByName: TEST_BROKER.name,
        sellerApprovedBy: TEST_SELLER.id,
        sellerApprovedAt: new Date()
      }
    });
    testOmVersionId = omVersion.id;
  });

  describe('Listing Types', () => {
    it('should export valid listing types', async () => {
      const { LISTING_TYPES } = await import('../services/distribution.js');

      expect(LISTING_TYPES.PUBLIC).toBe('PUBLIC');
      expect(LISTING_TYPES.PRIVATE).toBe('PRIVATE');
    });

    it('should export response types', async () => {
      const { RESPONSE_TYPES } = await import('../services/distribution.js');

      expect(RESPONSE_TYPES.INTERESTED).toBe('INTERESTED');
      expect(RESPONSE_TYPES.INTERESTED_WITH_CONDITIONS).toBe('INTERESTED_WITH_CONDITIONS');
      expect(RESPONSE_TYPES.PASS).toBe('PASS');
    });
  });

  describe('Distribution Creation', () => {
    it('should create a private distribution', async () => {
      const { distributionService } = await import('../services/distribution.js');

      const result = await distributionService.createDistribution(
        testDealDraftId,
        { listingType: 'PRIVATE' },
        TEST_BROKER
      );

      expect(result.distribution).toBeDefined();
      expect(result.distribution.listingType).toBe('PRIVATE');
      expect(result.distribution.distributedBy).toBe(TEST_BROKER.id);
      testDistributionId = result.distribution.id;
    });

    it('should create a public distribution', async () => {
      const { distributionService } = await import('../services/distribution.js');

      const result = await distributionService.createDistribution(
        testDealDraftId,
        { listingType: 'PUBLIC' },
        TEST_BROKER
      );

      expect(result.distribution).toBeDefined();
      expect(result.distribution.listingType).toBe('PUBLIC');
    });

    it('should update deal status to DISTRIBUTED', async () => {
      const { distributionService } = await import('../services/distribution.js');

      await distributionService.createDistribution(
        testDealDraftId,
        { listingType: 'PRIVATE' },
        TEST_BROKER
      );

      const updatedDeal = await prisma.dealDraft.findUnique({
        where: { id: testDealDraftId }
      });

      expect(updatedDeal.status).toBe('DISTRIBUTED');
    });

    it('should reject distribution without seller-approved OM', async () => {
      const { distributionService } = await import('../services/distribution.js');

      // Create a deal without seller-approved OM
      const dealWithoutOM = await prisma.dealDraft.create({
        data: {
          organizationId: TEST_ORG_ID,
          status: 'OM_DRAFTED',
          ingestSource: 'UPLOAD',
          propertyName: 'No OM Property'
        }
      });

      // Add broker to deal
      await prisma.dealDraftBroker.create({
        data: {
          dealDraftId: dealWithoutOM.id,
          userId: TEST_BROKER.id,
          email: TEST_BROKER.email,
          name: TEST_BROKER.name,
          role: 'PRIMARY'
        }
      });

      await expect(
        distributionService.createDistribution(
          dealWithoutOM.id,
          { listingType: 'PRIVATE' },
          TEST_BROKER
        )
      ).rejects.toThrow('seller-approved OM');
    });

    it('should reject distribution from non-broker', async () => {
      const { distributionService } = await import('../services/distribution.js');

      await expect(
        distributionService.createDistribution(
          testDealDraftId,
          { listingType: 'PRIVATE' },
          { id: 'random-user', name: 'Random' }
        )
      ).rejects.toThrow('Only brokers');
    });
  });

  describe('Manual Recipients', () => {
    it('should add manual recipients to distribution', async () => {
      const { distributionService } = await import('../services/distribution.js');

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

      const result = await distributionService.createDistribution(
        testDealDraftId,
        {
          listingType: 'PRIVATE',
          manualRecipientIds: [TEST_BUYER.id]
        },
        TEST_BROKER
      );

      expect(result.recipients.length).toBe(1);
      expect(result.recipients[0].buyerUserId).toBe(TEST_BUYER.id);
      expect(result.recipients[0].matchType).toBe('MANUAL');
      testRecipientId = result.recipients[0].id;
    });

    it('should not add recipients from seller org', async () => {
      const { distributionService } = await import('../services/distribution.js');

      // Create a user in the seller's org (should be skipped)
      const sameOrgUser = {
        id: 'same-org-user',
        email: 'sameorg@test.com',
        name: 'Same Org User',
        organizationId: TEST_ORG_ID // Same as seller
      };

      await prisma.authUser.upsert({
        where: { id: sameOrgUser.id },
        update: {},
        create: {
          ...sameOrgUser,
          role: 'GP',
          passwordHash: 'test'
        }
      });

      const result = await distributionService.createDistribution(
        testDealDraftId,
        {
          listingType: 'PRIVATE',
          manualRecipientIds: [sameOrgUser.id]
        },
        TEST_BROKER
      );

      expect(result.recipients.length).toBe(0);
    });
  });

  describe('View Tracking', () => {
    it('should record view event', async () => {
      const { distributionService } = await import('../services/distribution.js');

      // Setup: create distribution with recipient
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

      const distResult = await distributionService.createDistribution(
        testDealDraftId,
        {
          listingType: 'PRIVATE',
          manualRecipientIds: [TEST_BUYER.id]
        },
        TEST_BROKER
      );

      const recipientId = distResult.recipients[0].id;

      // Record view
      const updated = await distributionService.recordView(recipientId, {
        durationSec: 120,
        pagesViewed: [1, 2, 3]
      });

      expect(updated.viewedAt).toBeDefined();
      expect(updated.viewDurationSec).toBe(120);
      expect(updated.pagesViewed).toBe(JSON.stringify([1, 2, 3]));
    });

    it('should accumulate view duration', async () => {
      const { distributionService } = await import('../services/distribution.js');

      // Setup
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

      const distResult = await distributionService.createDistribution(
        testDealDraftId,
        {
          listingType: 'PRIVATE',
          manualRecipientIds: [TEST_BUYER.id]
        },
        TEST_BROKER
      );

      const recipientId = distResult.recipients[0].id;

      // First view
      await distributionService.recordView(recipientId, { durationSec: 60 });

      // Second view
      const updated = await distributionService.recordView(recipientId, { durationSec: 45 });

      expect(updated.viewDurationSec).toBe(105); // 60 + 45
    });
  });

  describe('Buyer Response', () => {
    it('should submit INTERESTED response', async () => {
      const { distributionService } = await import('../services/distribution.js');

      // Setup
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

      await distributionService.createDistribution(
        testDealDraftId,
        {
          listingType: 'PRIVATE',
          manualRecipientIds: [TEST_BUYER.id]
        },
        TEST_BROKER
      );

      // Submit response
      const response = await distributionService.submitResponse(
        testDealDraftId,
        {
          response: 'INTERESTED',
          indicativePriceMin: 23000000,
          indicativePriceMax: 25000000,
          intendedStructure: 'All cash'
        },
        TEST_BUYER
      );

      expect(response.response).toBe('INTERESTED');
      expect(response.indicativePriceMin).toBe(23000000);
      expect(response.indicativePriceMax).toBe(25000000);
    });

    it('should submit PASS response', async () => {
      const { distributionService } = await import('../services/distribution.js');

      // Setup
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

      await distributionService.createDistribution(
        testDealDraftId,
        {
          listingType: 'PRIVATE',
          manualRecipientIds: [TEST_BUYER.id]
        },
        TEST_BROKER
      );

      const response = await distributionService.submitResponse(
        testDealDraftId,
        {
          response: 'PASS',
          passReason: 'PRICE',
          passNotes: 'Price too high for our criteria'
        },
        TEST_BUYER
      );

      expect(response.response).toBe('PASS');
      expect(response.passReason).toBe('PRICE');
    });

    it('should reject response from non-recipient', async () => {
      const { distributionService } = await import('../services/distribution.js');

      // Create distribution but don't add buyer as recipient
      await distributionService.createDistribution(
        testDealDraftId,
        { listingType: 'PRIVATE' },
        TEST_BROKER
      );

      await expect(
        distributionService.submitResponse(
          testDealDraftId,
          { response: 'INTERESTED' },
          TEST_BUYER
        )
      ).rejects.toThrow('not received');
    });

    it('should update existing response', async () => {
      const { distributionService } = await import('../services/distribution.js');

      // Setup
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

      await distributionService.createDistribution(
        testDealDraftId,
        {
          listingType: 'PRIVATE',
          manualRecipientIds: [TEST_BUYER.id]
        },
        TEST_BROKER
      );

      // First response
      await distributionService.submitResponse(
        testDealDraftId,
        { response: 'INTERESTED' },
        TEST_BUYER
      );

      // Update response
      const updated = await distributionService.submitResponse(
        testDealDraftId,
        { response: 'PASS', passReason: 'TIMING' },
        TEST_BUYER
      );

      expect(updated.response).toBe('PASS');
      expect(updated.passReason).toBe('TIMING');

      // Should only have one response
      const responses = await prisma.buyerResponse.findMany({
        where: {
          dealDraftId: testDealDraftId,
          buyerUserId: TEST_BUYER.id
        }
      });
      expect(responses.length).toBe(1);
    });
  });

  describe('Get Distribution', () => {
    it('should get distribution with recipients', async () => {
      const { distributionService } = await import('../services/distribution.js');

      // Setup
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

      const createResult = await distributionService.createDistribution(
        testDealDraftId,
        {
          listingType: 'PRIVATE',
          manualRecipientIds: [TEST_BUYER.id]
        },
        TEST_BROKER
      );

      const distribution = await distributionService.getDistribution(createResult.distribution.id);

      expect(distribution.id).toBe(createResult.distribution.id);
      expect(distribution.recipients.length).toBe(1);
      expect(distribution.dealDraft).toBeDefined();
    });

    it('should get distributions for deal', async () => {
      const { distributionService } = await import('../services/distribution.js');

      await distributionService.createDistribution(
        testDealDraftId,
        { listingType: 'PRIVATE' },
        TEST_BROKER
      );

      const distributions = await distributionService.getDistributionsForDeal(testDealDraftId);

      expect(distributions.length).toBeGreaterThan(0);
      expect(distributions[0].dealDraftId).toBe(testDealDraftId);
    });
  });

  describe('Buyer Inbox', () => {
    it('should get buyer inbox with deals', async () => {
      const { distributionService } = await import('../services/distribution.js');

      // Setup
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

      await distributionService.createDistribution(
        testDealDraftId,
        {
          listingType: 'PRIVATE',
          manualRecipientIds: [TEST_BUYER.id]
        },
        TEST_BROKER
      );

      const inbox = await distributionService.getBuyerInbox(TEST_BUYER.id);

      expect(inbox.length).toBe(1);
      expect(inbox[0].distribution.dealDraft).toBeDefined();
      expect(inbox[0].distribution.dealDraft.propertyName).toBe('Distribution Test Property');
    });

    it('should filter inbox by response status', async () => {
      const { distributionService } = await import('../services/distribution.js');

      // Setup
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

      await distributionService.createDistribution(
        testDealDraftId,
        {
          listingType: 'PRIVATE',
          manualRecipientIds: [TEST_BUYER.id]
        },
        TEST_BROKER
      );

      // Before response
      const inboxNoResponse = await distributionService.getBuyerInbox(TEST_BUYER.id, { hasResponded: false });
      expect(inboxNoResponse.length).toBe(1);

      // Submit response
      await distributionService.submitResponse(
        testDealDraftId,
        { response: 'INTERESTED' },
        TEST_BUYER
      );

      // After response
      const inboxWithResponse = await distributionService.getBuyerInbox(TEST_BUYER.id, { hasResponded: true });
      expect(inboxWithResponse.length).toBe(1);

      const inboxWithoutResponse = await distributionService.getBuyerInbox(TEST_BUYER.id, { hasResponded: false });
      expect(inboxWithoutResponse.length).toBe(0);
    });
  });
});
