/**
 * Phase 4 Tests - Permission Gate Service
 *
 * Tests for buyer authorization workflow, NDA tracking, and data room access.
 *
 * @jest-environment node
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Test data
const TEST_ORG_ID = 'test-org-permission-gate';
const TEST_BUYER_ORG_ID = 'test-org-buyer-gate';
const TEST_BROKER = {
  id: 'test-broker-gate',
  name: 'Test Broker',
  email: 'broker@test.com',
  organizationId: TEST_ORG_ID,
  role: 'GP'
};
const TEST_SELLER = {
  id: 'test-seller-gate',
  name: 'Test Seller',
  email: 'seller@test.com',
  organizationId: TEST_ORG_ID
};
const TEST_BUYER = {
  id: 'test-buyer-gate',
  name: 'Test Buyer',
  email: 'buyer@test.com',
  organizationId: TEST_BUYER_ORG_ID,
  role: 'GP'
};

let testDealDraftId;

describe('Permission Gate Service', () => {
  beforeAll(async () => {
    await cleanupTestData();

    // Create test organizations
    await prisma.organization.upsert({
      where: { id: TEST_ORG_ID },
      update: {},
      create: { id: TEST_ORG_ID, name: 'Test Seller Organization', slug: 'test-seller-org-gate' }
    });
    await prisma.organization.upsert({
      where: { id: TEST_BUYER_ORG_ID },
      update: {},
      create: { id: TEST_BUYER_ORG_ID, name: 'Test Buyer Organization', slug: 'test-buyer-org-gate' }
    });

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
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.authUser.deleteMany({
      where: { organizationId: { in: [TEST_ORG_ID, TEST_BUYER_ORG_ID] } }
    });
    await prisma.organization.deleteMany({
      where: { id: { in: [TEST_ORG_ID, TEST_BUYER_ORG_ID] } }
    });
    await prisma.$disconnect();
  });

  async function cleanupTestData() {
    await prisma.buyerAuthorization.deleteMany({
      where: { dealDraftId: { startsWith: 'test-deal' } }
    });
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
    // Clean authorization-specific data
    await prisma.buyerAuthorization.deleteMany({
      where: { buyerUserId: TEST_BUYER.id }
    });
    await prisma.buyerResponse.deleteMany({
      where: { buyerUserId: TEST_BUYER.id }
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

    // Create deal
    const dealDraft = await prisma.dealDraft.create({
      data: {
        organizationId: TEST_ORG_ID,
        status: 'DISTRIBUTED',
        ingestSource: 'UPLOAD',
        propertyName: 'Permission Gate Test Property',
        propertyAddress: '456 Gate Ave, Austin, TX 78702',
        assetType: 'MULTIFAMILY',
        askingPrice: 35000000,
        unitCount: 180
      }
    });
    testDealDraftId = dealDraft.id;

    // Add seller
    await prisma.dealDraftSeller.create({
      data: {
        dealDraftId: dealDraft.id,
        userId: TEST_SELLER.id,
        email: TEST_SELLER.email,
        name: TEST_SELLER.name,
        requiresBuyerApproval: false
      }
    });

    // Add distribution and recipient
    const distribution = await prisma.dealDistribution.create({
      data: {
        dealDraftId: dealDraft.id,
        omVersionId: 'mock-om-version',
        listingType: 'PRIVATE',
        distributedBy: TEST_BROKER.id,
        distributedByName: TEST_BROKER.name
      }
    });

    await prisma.distributionRecipient.create({
      data: {
        distributionId: distribution.id,
        buyerUserId: TEST_BUYER.id,
        buyerEmail: TEST_BUYER.email,
        buyerName: TEST_BUYER.name,
        matchType: 'MANUAL'
      }
    });

    // Add buyer response (INTERESTED)
    await prisma.buyerResponse.create({
      data: {
        dealDraftId: dealDraft.id,
        buyerUserId: TEST_BUYER.id,
        response: 'INTERESTED',
        respondedBy: TEST_BUYER.id
      }
    });
  });

  describe('Constants', () => {
    it('should export authorization statuses', async () => {
      const { AUTH_STATUSES } = await import('../services/permission-gate.js');

      expect(AUTH_STATUSES.PENDING).toBe('PENDING');
      expect(AUTH_STATUSES.AUTHORIZED).toBe('AUTHORIZED');
      expect(AUTH_STATUSES.DECLINED).toBe('DECLINED');
      expect(AUTH_STATUSES.REVOKED).toBe('REVOKED');
    });

    it('should export NDA statuses', async () => {
      const { NDA_STATUSES } = await import('../services/permission-gate.js');

      expect(NDA_STATUSES.NOT_SENT).toBe('NOT_SENT');
      expect(NDA_STATUSES.SENT).toBe('SENT');
      expect(NDA_STATUSES.SIGNED).toBe('SIGNED');
    });

    it('should export access levels', async () => {
      const { ACCESS_LEVELS } = await import('../services/permission-gate.js');

      expect(ACCESS_LEVELS.STANDARD).toBe('STANDARD');
      expect(ACCESS_LEVELS.FULL).toBe('FULL');
      expect(ACCESS_LEVELS.CUSTOM).toBe('CUSTOM');
    });
  });

  describe('Review Queue', () => {
    it('should get review queue with interested buyers', async () => {
      const { permissionGateService } = await import('../services/permission-gate.js');

      const queue = await permissionGateService.getReviewQueue(testDealDraftId);

      expect(queue.length).toBe(1);
      expect(queue[0].response.response).toBe('INTERESTED');
      expect(queue[0].buyer.id).toBe(TEST_BUYER.id);
    });

    it('should not include passed buyers in queue', async () => {
      const { permissionGateService } = await import('../services/permission-gate.js');

      // Update response to PASS
      await prisma.buyerResponse.update({
        where: {
          dealDraftId_buyerUserId: {
            dealDraftId: testDealDraftId,
            buyerUserId: TEST_BUYER.id
          }
        },
        data: { response: 'PASS' }
      });

      const queue = await permissionGateService.getReviewQueue(testDealDraftId);

      expect(queue.length).toBe(0);
    });

    it('should filter out already authorized buyers by default', async () => {
      const { permissionGateService } = await import('../services/permission-gate.js');

      // Authorize the buyer
      await permissionGateService.authorizeBuyer(
        testDealDraftId,
        TEST_BUYER.id,
        {},
        TEST_BROKER
      );

      const queue = await permissionGateService.getReviewQueue(testDealDraftId);

      expect(queue.length).toBe(0);
    });

    it('should include all buyers when pendingOnly is false', async () => {
      const { permissionGateService } = await import('../services/permission-gate.js');

      await permissionGateService.authorizeBuyer(
        testDealDraftId,
        TEST_BUYER.id,
        {},
        TEST_BROKER
      );

      const queue = await permissionGateService.getReviewQueue(testDealDraftId, {
        pendingOnly: false
      });

      expect(queue.length).toBe(1);
    });
  });

  describe('Authorization', () => {
    it('should authorize a buyer', async () => {
      const { permissionGateService } = await import('../services/permission-gate.js');

      const authorization = await permissionGateService.authorizeBuyer(
        testDealDraftId,
        TEST_BUYER.id,
        {},
        TEST_BROKER
      );

      expect(authorization.status).toBe('AUTHORIZED');
      expect(authorization.authorizedBy).toBe(TEST_BROKER.id);
      expect(authorization.authorizedAt).toBeDefined();
    });

    it('should set access level when authorizing', async () => {
      const { permissionGateService } = await import('../services/permission-gate.js');

      const authorization = await permissionGateService.authorizeBuyer(
        testDealDraftId,
        TEST_BUYER.id,
        { accessLevel: 'FULL' },
        TEST_BROKER
      );

      expect(authorization.dataRoomAccessLevel).toBe('FULL');
    });

    it('should reject authorizing a buyer who passed', async () => {
      const { permissionGateService } = await import('../services/permission-gate.js');

      // Change response to PASS
      await prisma.buyerResponse.update({
        where: {
          dealDraftId_buyerUserId: {
            dealDraftId: testDealDraftId,
            buyerUserId: TEST_BUYER.id
          }
        },
        data: { response: 'PASS' }
      });

      await expect(
        permissionGateService.authorizeBuyer(testDealDraftId, TEST_BUYER.id, {}, TEST_BROKER)
      ).rejects.toThrow('passed');
    });

    it('should reject authorizing a buyer who has not responded', async () => {
      const { permissionGateService } = await import('../services/permission-gate.js');

      // Delete response
      await prisma.buyerResponse.delete({
        where: {
          dealDraftId_buyerUserId: {
            dealDraftId: testDealDraftId,
            buyerUserId: TEST_BUYER.id
          }
        }
      });

      await expect(
        permissionGateService.authorizeBuyer(testDealDraftId, TEST_BUYER.id, {}, TEST_BROKER)
      ).rejects.toThrow('not responded');
    });
  });

  describe('Decline', () => {
    it('should decline a buyer with reason', async () => {
      const { permissionGateService } = await import('../services/permission-gate.js');

      const authorization = await permissionGateService.declineBuyer(
        testDealDraftId,
        TEST_BUYER.id,
        'Does not meet criteria',
        TEST_BROKER
      );

      expect(authorization.status).toBe('DECLINED');
      expect(authorization.declinedBy).toBe(TEST_BROKER.id);
      expect(authorization.declineReason).toBe('Does not meet criteria');
    });
  });

  describe('Revoke', () => {
    it('should revoke access from authorized buyer', async () => {
      const { permissionGateService } = await import('../services/permission-gate.js');

      // First authorize
      await permissionGateService.authorizeBuyer(
        testDealDraftId,
        TEST_BUYER.id,
        {},
        TEST_BROKER
      );

      // Then revoke
      const authorization = await permissionGateService.revokeBuyer(
        testDealDraftId,
        TEST_BUYER.id,
        'Violated NDA terms',
        TEST_BROKER
      );

      expect(authorization.status).toBe('REVOKED');
      expect(authorization.revokedBy).toBe(TEST_BROKER.id);
      expect(authorization.revokeReason).toBe('Violated NDA terms');
      expect(authorization.dataRoomAccessGranted).toBe(false);
    });

    it('should reject revoking non-authorized buyer', async () => {
      const { permissionGateService } = await import('../services/permission-gate.js');

      await expect(
        permissionGateService.revokeBuyer(testDealDraftId, TEST_BUYER.id, 'Reason', TEST_BROKER)
      ).rejects.toThrow('not currently authorized');
    });
  });

  describe('NDA Workflow', () => {
    it('should send NDA to authorized buyer', async () => {
      const { permissionGateService } = await import('../services/permission-gate.js');

      // Authorize first
      await permissionGateService.authorizeBuyer(
        testDealDraftId,
        TEST_BUYER.id,
        {},
        TEST_BROKER
      );

      // Send NDA
      const authorization = await permissionGateService.sendNDA(
        testDealDraftId,
        TEST_BUYER.id,
        TEST_BROKER
      );

      expect(authorization.ndaStatus).toBe('SENT');
      expect(authorization.ndaSentAt).toBeDefined();
    });

    it('should reject sending NDA to non-authorized buyer', async () => {
      const { permissionGateService } = await import('../services/permission-gate.js');

      await expect(
        permissionGateService.sendNDA(testDealDraftId, TEST_BUYER.id, TEST_BROKER)
      ).rejects.toThrow('must be authorized');
    });

    it('should record NDA signature', async () => {
      const { permissionGateService } = await import('../services/permission-gate.js');

      // Authorize and send NDA
      await permissionGateService.authorizeBuyer(
        testDealDraftId,
        TEST_BUYER.id,
        {},
        TEST_BROKER
      );
      await permissionGateService.sendNDA(testDealDraftId, TEST_BUYER.id, TEST_BROKER);

      // Record signature
      const authorization = await permissionGateService.recordNDASigned(
        testDealDraftId,
        TEST_BUYER.id,
        'nda-doc-123'
      );

      expect(authorization.ndaStatus).toBe('SIGNED');
      expect(authorization.ndaSignedAt).toBeDefined();
      expect(authorization.ndaDocumentId).toBe('nda-doc-123');
      expect(authorization.dataRoomAccessGranted).toBe(true);
    });

    it('should reject signing NDA that was not sent', async () => {
      const { permissionGateService } = await import('../services/permission-gate.js');

      // Authorize but don't send NDA
      await permissionGateService.authorizeBuyer(
        testDealDraftId,
        TEST_BUYER.id,
        {},
        TEST_BROKER
      );

      await expect(
        permissionGateService.recordNDASigned(testDealDraftId, TEST_BUYER.id, 'doc-123')
      ).rejects.toThrow('must be sent');
    });
  });

  describe('Data Room Access', () => {
    it('should grant data room access after NDA signed', async () => {
      const { permissionGateService } = await import('../services/permission-gate.js');

      // Full workflow
      await permissionGateService.authorizeBuyer(testDealDraftId, TEST_BUYER.id, {}, TEST_BROKER);
      await permissionGateService.sendNDA(testDealDraftId, TEST_BUYER.id, TEST_BROKER);
      await permissionGateService.recordNDASigned(testDealDraftId, TEST_BUYER.id, 'nda-123');

      const authorization = await permissionGateService.grantDataRoomAccess(
        testDealDraftId,
        TEST_BUYER.id,
        'FULL',
        TEST_BROKER
      );

      expect(authorization.dataRoomAccessGranted).toBe(true);
      expect(authorization.dataRoomAccessLevel).toBe('FULL');
    });

    it('should reject granting access without NDA signed', async () => {
      const { permissionGateService } = await import('../services/permission-gate.js');

      await permissionGateService.authorizeBuyer(testDealDraftId, TEST_BUYER.id, {}, TEST_BROKER);
      await permissionGateService.sendNDA(testDealDraftId, TEST_BUYER.id, TEST_BROKER);
      // Don't sign NDA

      await expect(
        permissionGateService.grantDataRoomAccess(testDealDraftId, TEST_BUYER.id, 'STANDARD', TEST_BROKER)
      ).rejects.toThrow('NDA must be signed');
    });
  });

  describe('Status & Progress', () => {
    it('should get authorization status', async () => {
      const { permissionGateService } = await import('../services/permission-gate.js');

      await permissionGateService.authorizeBuyer(testDealDraftId, TEST_BUYER.id, {}, TEST_BROKER);

      const status = await permissionGateService.getAuthorizationStatus(
        testDealDraftId,
        TEST_BUYER.id
      );

      expect(status.status).toBe('AUTHORIZED');
    });

    it('should return null for non-existent authorization', async () => {
      const { permissionGateService } = await import('../services/permission-gate.js');

      const status = await permissionGateService.getAuthorizationStatus(
        testDealDraftId,
        TEST_BUYER.id
      );

      expect(status).toBeNull();
    });

    it('should get all authorizations for a deal', async () => {
      const { permissionGateService } = await import('../services/permission-gate.js');

      await permissionGateService.authorizeBuyer(testDealDraftId, TEST_BUYER.id, {}, TEST_BROKER);

      const authorizations = await permissionGateService.getAuthorizationsForDeal(testDealDraftId);

      expect(authorizations.length).toBe(1);
      expect(authorizations[0].buyer.id).toBe(TEST_BUYER.id);
    });

    it('should get deal progress summary', async () => {
      const { permissionGateService } = await import('../services/permission-gate.js');

      const progress = await permissionGateService.getDealProgress(testDealDraftId);

      expect(progress.dealStatus).toBe('DISTRIBUTED');
      expect(progress.funnel.distributed).toBe(1);
      expect(progress.funnel.responded).toBe(1);
      expect(progress.funnel.interested).toBe(1);
      expect(progress.funnel.authorized).toBe(0);
      expect(progress.canAdvanceToDD).toBe(false);
    });

    it('should indicate can advance when buyer has data room access', async () => {
      const { permissionGateService } = await import('../services/permission-gate.js');

      // Full authorization workflow
      await permissionGateService.authorizeBuyer(testDealDraftId, TEST_BUYER.id, {}, TEST_BROKER);
      await permissionGateService.sendNDA(testDealDraftId, TEST_BUYER.id, TEST_BROKER);
      await permissionGateService.recordNDASigned(testDealDraftId, TEST_BUYER.id, 'nda-123');

      const progress = await permissionGateService.getDealProgress(testDealDraftId);

      expect(progress.funnel.authorized).toBe(1);
      expect(progress.funnel.ndaSigned).toBe(1);
      expect(progress.funnel.inDataRoom).toBe(1);
      expect(progress.canAdvanceToDD).toBe(true);
    });
  });

  describe('Advance to Active DD', () => {
    it('should advance deal to ACTIVE_DD status', async () => {
      const { permissionGateService } = await import('../services/permission-gate.js');

      // Full workflow
      await permissionGateService.authorizeBuyer(testDealDraftId, TEST_BUYER.id, {}, TEST_BROKER);
      await permissionGateService.sendNDA(testDealDraftId, TEST_BUYER.id, TEST_BROKER);
      await permissionGateService.recordNDASigned(testDealDraftId, TEST_BUYER.id, 'nda-123');

      const dealDraft = await permissionGateService.advanceToActiveDD(testDealDraftId, TEST_BROKER);

      expect(dealDraft.status).toBe('ACTIVE_DD');
    });

    it('should reject advancing without any buyer in data room', async () => {
      const { permissionGateService } = await import('../services/permission-gate.js');

      await expect(
        permissionGateService.advanceToActiveDD(testDealDraftId, TEST_BROKER)
      ).rejects.toThrow('At least one buyer');
    });
  });

  describe('Event Logging', () => {
    it('should log authorization event', async () => {
      const { permissionGateService } = await import('../services/permission-gate.js');

      await permissionGateService.authorizeBuyer(testDealDraftId, TEST_BUYER.id, {}, TEST_BROKER);

      const events = await prisma.dealIntakeEventLog.findMany({
        where: {
          dealDraftId: testDealDraftId,
          eventType: 'BUYER_AUTHORIZED'
        }
      });

      expect(events.length).toBe(1);
      expect(events[0].actorId).toBe(TEST_BROKER.id);
    });

    it('should log NDA sent event', async () => {
      const { permissionGateService } = await import('../services/permission-gate.js');

      await permissionGateService.authorizeBuyer(testDealDraftId, TEST_BUYER.id, {}, TEST_BROKER);
      await permissionGateService.sendNDA(testDealDraftId, TEST_BUYER.id, TEST_BROKER);

      const events = await prisma.dealIntakeEventLog.findMany({
        where: {
          dealDraftId: testDealDraftId,
          eventType: 'NDA_SENT'
        }
      });

      expect(events.length).toBe(1);
    });
  });
});
