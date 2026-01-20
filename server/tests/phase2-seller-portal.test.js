/**
 * Phase 2 Tests - Seller Portal Routes
 *
 * Tests for seller-side deal management APIs.
 *
 * @jest-environment node
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Test data
const TEST_ORG_ID = 'test-org-seller-portal';
const TEST_SELLER = {
  id: 'test-seller-portal',
  name: 'Test Seller',
  email: 'seller@test.com',
  organizationId: TEST_ORG_ID,
  role: 'GP'
};
const TEST_BROKER = {
  id: 'test-broker-portal',
  name: 'Test Broker',
  email: 'broker@test.com'
};

let testDealDraftId;
let testSellerId;
let testBrokerId;

describe('Seller Portal', () => {
  beforeAll(async () => {
    // Clean up any existing test data
    await prisma.dealIntakeEventLog.deleteMany({
      where: { organizationId: TEST_ORG_ID }
    });
    await prisma.oMVersion.deleteMany({
      where: { dealDraft: { organizationId: TEST_ORG_ID } }
    });
    await prisma.dealClaim.deleteMany({
      where: { dealDraft: { organizationId: TEST_ORG_ID } }
    });
    await prisma.dealDraftDocument.deleteMany({
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
  });

  afterAll(async () => {
    // Clean up test data
    await prisma.dealIntakeEventLog.deleteMany({
      where: { organizationId: TEST_ORG_ID }
    });
    await prisma.oMVersion.deleteMany({
      where: { dealDraft: { organizationId: TEST_ORG_ID } }
    });
    await prisma.dealClaim.deleteMany({
      where: { dealDraft: { organizationId: TEST_ORG_ID } }
    });
    await prisma.dealDraftDocument.deleteMany({
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
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clean slate for each test
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

    // Create a fresh deal draft
    const dealDraft = await prisma.dealDraft.create({
      data: {
        organizationId: TEST_ORG_ID,
        status: 'OM_BROKER_APPROVED',
        ingestSource: 'UPLOAD',
        propertyName: 'Seller Test Property',
        propertyAddress: '456 Seller Ave, Test City, TX 75002',
        assetType: 'MULTIFAMILY',
        askingPrice: 20000000,
        listingType: null
      }
    });
    testDealDraftId = dealDraft.id;

    // Add broker
    const broker = await prisma.dealDraftBroker.create({
      data: {
        dealDraftId: dealDraft.id,
        userId: TEST_BROKER.id,
        email: TEST_BROKER.email,
        name: TEST_BROKER.name,
        firmName: 'Test Brokerage',
        role: 'PRIMARY',
        isPrimaryContact: true,
        canApproveOM: false,
        canDistribute: true,
        canAuthorize: true,
        addedBy: TEST_BROKER.id
      }
    });
    testBrokerId = broker.id;

    // Add seller
    const seller = await prisma.dealDraftSeller.create({
      data: {
        dealDraftId: dealDraft.id,
        userId: TEST_SELLER.id,
        email: TEST_SELLER.email,
        name: TEST_SELLER.name,
        entityName: 'Test Seller LLC',
        hasDirectAccess: true,
        receiveNotifications: true,
        requiresOMApproval: true,
        requiresBuyerApproval: false,
        sellerSeesBuyerIdentity: true
      }
    });
    testSellerId = seller.id;

    // Create an OM version awaiting seller approval
    await prisma.oMVersion.create({
      data: {
        dealDraftId: dealDraft.id,
        versionNumber: 1,
        status: 'BROKER_APPROVED',
        content: JSON.stringify({ sections: {} }),
        createdBy: TEST_BROKER.id,
        createdByName: TEST_BROKER.name,
        brokerApprovedBy: TEST_BROKER.id,
        brokerApprovedAt: new Date()
      }
    });
  });

  describe('Listing Type Configuration', () => {
    it('should have valid listing types defined', async () => {
      const { LISTING_TYPES } = await import('../routes/seller-portal.js');

      expect(LISTING_TYPES.PUBLIC).toBe('PUBLIC');
      expect(LISTING_TYPES.PRIVATE).toBe('PRIVATE');
    });

    it('should update listing type to PUBLIC', async () => {
      const updated = await prisma.dealDraft.update({
        where: { id: testDealDraftId },
        data: { listingType: 'PUBLIC' }
      });

      expect(updated.listingType).toBe('PUBLIC');
    });

    it('should update listing type to PRIVATE', async () => {
      const updated = await prisma.dealDraft.update({
        where: { id: testDealDraftId },
        data: { listingType: 'PRIVATE' }
      });

      expect(updated.listingType).toBe('PRIVATE');
    });
  });

  describe('Seller Settings', () => {
    it('should have default seller settings', async () => {
      const seller = await prisma.dealDraftSeller.findFirst({
        where: { dealDraftId: testDealDraftId }
      });

      expect(seller.hasDirectAccess).toBe(true);
      expect(seller.receiveNotifications).toBe(true);
      expect(seller.requiresOMApproval).toBe(true);
      expect(seller.requiresBuyerApproval).toBe(false);
      expect(seller.sellerSeesBuyerIdentity).toBe(true);
    });

    it('should allow updating notification preferences', async () => {
      const updated = await prisma.dealDraftSeller.update({
        where: { id: testSellerId },
        data: { receiveNotifications: false }
      });

      expect(updated.receiveNotifications).toBe(false);
    });

    it('should allow updating buyer approval requirement', async () => {
      const updated = await prisma.dealDraftSeller.update({
        where: { id: testSellerId },
        data: { requiresBuyerApproval: true }
      });

      expect(updated.requiresBuyerApproval).toBe(true);
    });

    it('should allow updating buyer identity visibility', async () => {
      const updated = await prisma.dealDraftSeller.update({
        where: { id: testSellerId },
        data: { sellerSeesBuyerIdentity: false }
      });

      expect(updated.sellerSeesBuyerIdentity).toBe(false);
    });
  });

  describe('Broker Delegation', () => {
    it('should have broker with default canApproveOM = false', async () => {
      const broker = await prisma.dealDraftBroker.findFirst({
        where: { dealDraftId: testDealDraftId }
      });

      expect(broker.canApproveOM).toBe(false);
    });

    it('should allow seller to delegate OM approval to broker', async () => {
      const updated = await prisma.dealDraftBroker.update({
        where: { id: testBrokerId },
        data: { canApproveOM: true }
      });

      expect(updated.canApproveOM).toBe(true);
    });

    it('should allow seller to revoke delegation', async () => {
      // First grant delegation
      await prisma.dealDraftBroker.update({
        where: { id: testBrokerId },
        data: { canApproveOM: true }
      });

      // Then revoke
      const updated = await prisma.dealDraftBroker.update({
        where: { id: testBrokerId },
        data: { canApproveOM: false }
      });

      expect(updated.canApproveOM).toBe(false);
    });
  });

  describe('Pending Approvals', () => {
    it('should find OM awaiting seller approval', async () => {
      const pendingOM = await prisma.oMVersion.findFirst({
        where: {
          dealDraftId: testDealDraftId,
          status: 'BROKER_APPROVED'
        }
      });

      expect(pendingOM).toBeDefined();
      expect(pendingOM.status).toBe('BROKER_APPROVED');
      expect(pendingOM.brokerApprovedBy).toBe(TEST_BROKER.id);
    });

    it('should not find pending OM after seller approval', async () => {
      // Approve the OM
      await prisma.oMVersion.updateMany({
        where: {
          dealDraftId: testDealDraftId,
          status: 'BROKER_APPROVED'
        },
        data: {
          status: 'SELLER_APPROVED',
          sellerApprovedBy: TEST_SELLER.id,
          sellerApprovedAt: new Date()
        }
      });

      const pendingOM = await prisma.oMVersion.findFirst({
        where: {
          dealDraftId: testDealDraftId,
          status: 'BROKER_APPROVED'
        }
      });

      expect(pendingOM).toBeNull();
    });
  });

  describe('Deal Activity Logging', () => {
    it('should log seller settings update event', async () => {
      // Create an event
      await prisma.dealIntakeEventLog.create({
        data: {
          dealDraftId: testDealDraftId,
          organizationId: TEST_ORG_ID,
          eventType: 'SELLER_SETTINGS_UPDATED',
          eventData: JSON.stringify({
            previousSettings: { receiveNotifications: true },
            newSettings: { receiveNotifications: false }
          }),
          actorId: TEST_SELLER.id,
          actorName: TEST_SELLER.name,
          actorRole: 'SELLER'
        }
      });

      const events = await prisma.dealIntakeEventLog.findMany({
        where: {
          dealDraftId: testDealDraftId,
          eventType: 'SELLER_SETTINGS_UPDATED'
        }
      });

      expect(events.length).toBe(1);
      expect(events[0].actorRole).toBe('SELLER');
    });

    it('should log listing type change event', async () => {
      await prisma.dealIntakeEventLog.create({
        data: {
          dealDraftId: testDealDraftId,
          organizationId: TEST_ORG_ID,
          eventType: 'LISTING_TYPE_SET',
          eventData: JSON.stringify({
            previousType: null,
            newType: 'PUBLIC'
          }),
          actorId: TEST_SELLER.id,
          actorName: TEST_SELLER.name,
          actorRole: 'SELLER'
        }
      });

      const events = await prisma.dealIntakeEventLog.findMany({
        where: {
          dealDraftId: testDealDraftId,
          eventType: 'LISTING_TYPE_SET'
        }
      });

      expect(events.length).toBe(1);
      const eventData = JSON.parse(events[0].eventData);
      expect(eventData.newType).toBe('PUBLIC');
    });

    it('should log broker delegation event', async () => {
      await prisma.dealIntakeEventLog.create({
        data: {
          dealDraftId: testDealDraftId,
          organizationId: TEST_ORG_ID,
          eventType: 'BROKER_DELEGATION_GRANTED',
          eventData: JSON.stringify({
            brokerId: testBrokerId,
            brokerName: TEST_BROKER.name,
            canApproveOM: true
          }),
          actorId: TEST_SELLER.id,
          actorName: TEST_SELLER.name,
          actorRole: 'SELLER'
        }
      });

      const events = await prisma.dealIntakeEventLog.findMany({
        where: {
          dealDraftId: testDealDraftId,
          eventType: 'BROKER_DELEGATION_GRANTED'
        }
      });

      expect(events.length).toBe(1);
    });
  });

  describe('Seller-Broker Relationship', () => {
    it('should have seller linked to deal', async () => {
      const dealWithSeller = await prisma.dealDraft.findUnique({
        where: { id: testDealDraftId },
        include: { seller: true }
      });

      expect(dealWithSeller.seller).toBeDefined();
      expect(dealWithSeller.seller.userId).toBe(TEST_SELLER.id);
    });

    it('should have brokers linked to deal', async () => {
      const dealWithBrokers = await prisma.dealDraft.findUnique({
        where: { id: testDealDraftId },
        include: { brokers: true }
      });

      expect(dealWithBrokers.brokers.length).toBeGreaterThan(0);
      expect(dealWithBrokers.brokers[0].userId).toBe(TEST_BROKER.id);
    });

    it('should support multiple brokers (co-listing)', async () => {
      // Add a co-broker
      await prisma.dealDraftBroker.create({
        data: {
          dealDraftId: testDealDraftId,
          userId: 'co-broker-id',
          email: 'cobroker@test.com',
          name: 'Co-Broker',
          firmName: 'Co-Brokerage',
          role: 'CO_BROKER',
          isPrimaryContact: false,
          canApproveOM: false,
          canDistribute: true,
          canAuthorize: true,
          addedBy: TEST_BROKER.id
        }
      });

      const dealWithBrokers = await prisma.dealDraft.findUnique({
        where: { id: testDealDraftId },
        include: { brokers: true }
      });

      expect(dealWithBrokers.brokers.length).toBe(2);

      const primaryBroker = dealWithBrokers.brokers.find(b => b.isPrimaryContact);
      const coBroker = dealWithBrokers.brokers.find(b => !b.isPrimaryContact);

      expect(primaryBroker.role).toBe('PRIMARY');
      expect(coBroker.role).toBe('CO_BROKER');
    });
  });
});
