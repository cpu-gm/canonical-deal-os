/**
 * Phase 2 Tests - OM Drafter Service
 *
 * Tests for the OM (Offering Memorandum) generation, versioning, and approval workflow.
 *
 * @jest-environment node
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Test data
const TEST_ORG_ID = 'test-org-om-drafter';
const TEST_USER = {
  id: 'test-broker-om',
  name: 'Test Broker',
  email: 'broker@test.com',
  organizationId: TEST_ORG_ID,
  role: 'GP'
};
const TEST_SELLER = {
  id: 'test-seller-om',
  name: 'Test Seller',
  email: 'seller@test.com'
};

let testDealDraftId;

describe('OM Drafter Service', () => {
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
    // Create a fresh deal draft with claims for each test
    const dealDraft = await prisma.dealDraft.create({
      data: {
        organizationId: TEST_ORG_ID,
        status: 'DRAFT_INGESTED',
        ingestSource: 'UPLOAD',
        propertyName: 'Test Property for OM',
        propertyAddress: '123 Test Street, Test City, TX 75001',
        assetType: 'MULTIFAMILY',
        askingPrice: 15000000
      }
    });
    testDealDraftId = dealDraft.id;

    // Add broker
    await prisma.dealDraftBroker.create({
      data: {
        dealDraftId: dealDraft.id,
        userId: TEST_USER.id,
        email: TEST_USER.email,
        name: TEST_USER.name,
        firmName: 'Test Brokerage',
        role: 'PRIMARY',
        isPrimaryContact: true,
        canApproveOM: false,
        canDistribute: true,
        canAuthorize: true,
        addedBy: TEST_USER.id
      }
    });

    // Add seller
    await prisma.dealDraftSeller.create({
      data: {
        dealDraftId: dealDraft.id,
        userId: TEST_SELLER.id,
        email: TEST_SELLER.email,
        name: TEST_SELLER.name,
        hasDirectAccess: true,
        receiveNotifications: true,
        requiresOMApproval: true,
        requiresBuyerApproval: false,
        sellerSeesBuyerIdentity: true
      }
    });

    // Add some test claims
    await prisma.dealClaim.createMany({
      data: [
        {
          dealDraftId: dealDraft.id,
          field: 'askingPrice',
          value: JSON.stringify(15000000),
          displayValue: '$15,000,000',
          extractionMethod: 'LLM',
          confidence: 0.95,
          status: 'BROKER_CONFIRMED',
          documentName: 'OM.pdf'
        },
        {
          dealDraftId: dealDraft.id,
          field: 'unitCount',
          value: JSON.stringify(120),
          displayValue: '120',
          extractionMethod: 'LLM',
          confidence: 0.9,
          status: 'BROKER_CONFIRMED',
          documentName: 'Rent Roll.xlsx'
        },
        {
          dealDraftId: dealDraft.id,
          field: 'currentNOI',
          value: JSON.stringify(950000),
          displayValue: '$950,000',
          extractionMethod: 'LLM',
          confidence: 0.85,
          status: 'UNVERIFIED',
          documentName: 'T12.xlsx'
        },
        {
          dealDraftId: dealDraft.id,
          field: 'occupancy',
          value: JSON.stringify(0.95),
          displayValue: '95%',
          extractionMethod: 'LLM',
          confidence: 0.9,
          status: 'BROKER_CONFIRMED',
          documentName: 'Rent Roll.xlsx'
        }
      ]
    });
  });

  describe('OM Generation', () => {
    it('should generate an OM draft from claims', async () => {
      const { omDrafterService } = await import('../services/om-drafter.js');

      const omVersion = await omDrafterService.generateOMDraft(testDealDraftId, {
        createdBy: TEST_USER.id,
        createdByName: TEST_USER.name
      });

      expect(omVersion).toBeDefined();
      expect(omVersion.versionNumber).toBe(1);
      expect(omVersion.status).toBe('DRAFT');
      expect(omVersion.content).toBeDefined();
      expect(omVersion.content.sections).toBeDefined();

      // Check that sections were created
      expect(omVersion.content.sections.cover).toBeDefined();
      expect(omVersion.content.sections.executive_summary).toBeDefined();
      expect(omVersion.content.sections.disclaimers).toBeDefined();
    });

    it('should use verified claims in OM generation', async () => {
      const { omDrafterService } = await import('../services/om-drafter.js');

      const omVersion = await omDrafterService.generateOMDraft(testDealDraftId, {
        createdBy: TEST_USER.id,
        createdByName: TEST_USER.name
      });

      // Check that claims are referenced
      expect(omVersion.claimRefs).toBeDefined();
      expect(omVersion.claimRefs.length).toBeGreaterThan(0);

      // Check that sections contain claim data
      const execSummary = omVersion.content.sections.executive_summary;
      expect(execSummary).toBeDefined();
      expect(execSummary.claims).toBeDefined();
    });

    it('should advance deal status to OM_DRAFTED', async () => {
      const { omDrafterService } = await import('../services/om-drafter.js');

      await omDrafterService.generateOMDraft(testDealDraftId, {
        createdBy: TEST_USER.id,
        createdByName: TEST_USER.name
      });

      const dealDraft = await prisma.dealDraft.findUnique({
        where: { id: testDealDraftId }
      });

      expect(dealDraft.status).toBe('OM_DRAFTED');
    });

    it('should not regenerate if draft exists (unless forced)', async () => {
      const { omDrafterService } = await import('../services/om-drafter.js');

      const first = await omDrafterService.generateOMDraft(testDealDraftId, {
        createdBy: TEST_USER.id,
        createdByName: TEST_USER.name
      });

      const second = await omDrafterService.generateOMDraft(testDealDraftId, {
        createdBy: TEST_USER.id,
        createdByName: TEST_USER.name,
        regenerate: false
      });

      // Should return same version
      expect(second.id).toBe(first.id);
      expect(second.versionNumber).toBe(first.versionNumber);
    });

    it('should create new version when forced regenerate', async () => {
      const { omDrafterService } = await import('../services/om-drafter.js');

      const first = await omDrafterService.generateOMDraft(testDealDraftId, {
        createdBy: TEST_USER.id,
        createdByName: TEST_USER.name
      });

      // Approve the first version to allow regeneration to create v2
      await prisma.oMVersion.update({
        where: { id: first.id },
        data: { status: 'BROKER_APPROVED' }
      });

      const second = await omDrafterService.generateOMDraft(testDealDraftId, {
        createdBy: TEST_USER.id,
        createdByName: TEST_USER.name,
        regenerate: true
      });

      expect(second.versionNumber).toBe(2);
    });
  });

  describe('OM Approval Workflow', () => {
    it('should allow broker to approve OM', async () => {
      const { omDrafterService } = await import('../services/om-drafter.js');

      const omVersion = await omDrafterService.generateOMDraft(testDealDraftId, {
        createdBy: TEST_USER.id,
        createdByName: TEST_USER.name
      });

      const approved = await omDrafterService.brokerApprove(omVersion.id, {
        id: TEST_USER.id,
        name: TEST_USER.name
      });

      expect(approved.status).toBe('BROKER_APPROVED');
      expect(approved.approval.brokerApprovedBy).toBe(TEST_USER.id);
      expect(approved.approval.brokerApprovedAt).toBeDefined();
    });

    it('should advance deal status on broker approval', async () => {
      const { omDrafterService } = await import('../services/om-drafter.js');

      const omVersion = await omDrafterService.generateOMDraft(testDealDraftId, {
        createdBy: TEST_USER.id,
        createdByName: TEST_USER.name
      });

      await omDrafterService.brokerApprove(omVersion.id, {
        id: TEST_USER.id,
        name: TEST_USER.name
      });

      const dealDraft = await prisma.dealDraft.findUnique({
        where: { id: testDealDraftId }
      });

      expect(dealDraft.status).toBe('OM_BROKER_APPROVED');
    });

    it('should allow seller to approve OM after broker approval', async () => {
      const { omDrafterService } = await import('../services/om-drafter.js');

      const omVersion = await omDrafterService.generateOMDraft(testDealDraftId, {
        createdBy: TEST_USER.id,
        createdByName: TEST_USER.name
      });

      await omDrafterService.brokerApprove(omVersion.id, {
        id: TEST_USER.id,
        name: TEST_USER.name
      });

      const approved = await omDrafterService.sellerApprove(omVersion.id, {
        id: TEST_SELLER.id,
        name: TEST_SELLER.name
      });

      expect(approved.status).toBe('SELLER_APPROVED');
      expect(approved.approval.sellerApprovedBy).toBe(TEST_SELLER.id);
    });

    it('should advance deal to OM_APPROVED_FOR_MARKETING on seller approval', async () => {
      const { omDrafterService } = await import('../services/om-drafter.js');

      const omVersion = await omDrafterService.generateOMDraft(testDealDraftId, {
        createdBy: TEST_USER.id,
        createdByName: TEST_USER.name
      });

      await omDrafterService.brokerApprove(omVersion.id, {
        id: TEST_USER.id,
        name: TEST_USER.name
      });

      await omDrafterService.sellerApprove(omVersion.id, {
        id: TEST_SELLER.id,
        name: TEST_SELLER.name
      });

      const dealDraft = await prisma.dealDraft.findUnique({
        where: { id: testDealDraftId }
      });

      expect(dealDraft.status).toBe('OM_APPROVED_FOR_MARKETING');
    });

    it('should not allow seller approval before broker approval', async () => {
      const { omDrafterService } = await import('../services/om-drafter.js');

      const omVersion = await omDrafterService.generateOMDraft(testDealDraftId, {
        createdBy: TEST_USER.id,
        createdByName: TEST_USER.name
      });

      await expect(
        omDrafterService.sellerApprove(omVersion.id, {
          id: TEST_SELLER.id,
          name: TEST_SELLER.name
        })
      ).rejects.toThrow('Seller can only approve OM in BROKER_APPROVED status');
    });

    it('should allow request changes to send OM back to draft', async () => {
      const { omDrafterService } = await import('../services/om-drafter.js');

      const omVersion = await omDrafterService.generateOMDraft(testDealDraftId, {
        createdBy: TEST_USER.id,
        createdByName: TEST_USER.name
      });

      await omDrafterService.brokerApprove(omVersion.id, {
        id: TEST_USER.id,
        name: TEST_USER.name
      });

      const updated = await omDrafterService.requestChanges(
        omVersion.id,
        { id: TEST_SELLER.id, name: TEST_SELLER.name, role: 'SELLER' },
        'Please update the NOI figures'
      );

      expect(updated.status).toBe('DRAFT');
      expect(updated.changeLog).toBeDefined();
      expect(updated.changeLog.length).toBeGreaterThan(0);
      expect(updated.changeLog[0].type).toBe('CHANGE_REQUEST');
    });
  });

  describe('OM Section Editing', () => {
    it('should allow updating section content in draft status', async () => {
      const { omDrafterService } = await import('../services/om-drafter.js');

      const omVersion = await omDrafterService.generateOMDraft(testDealDraftId, {
        createdBy: TEST_USER.id,
        createdByName: TEST_USER.name
      });

      const updated = await omDrafterService.updateSection(
        omVersion.id,
        'executive_summary',
        { content: 'Updated executive summary content' },
        { id: TEST_USER.id, name: TEST_USER.name }
      );

      expect(updated.content.sections.executive_summary.content).toBe('Updated executive summary content');
      expect(updated.changeLog.length).toBeGreaterThan(0);
    });

    it('should not allow editing approved OM', async () => {
      const { omDrafterService } = await import('../services/om-drafter.js');

      const omVersion = await omDrafterService.generateOMDraft(testDealDraftId, {
        createdBy: TEST_USER.id,
        createdByName: TEST_USER.name
      });

      await omDrafterService.brokerApprove(omVersion.id, {
        id: TEST_USER.id,
        name: TEST_USER.name
      });

      await expect(
        omDrafterService.updateSection(
          omVersion.id,
          'executive_summary',
          { content: 'Trying to update' },
          { id: TEST_USER.id, name: TEST_USER.name }
        )
      ).rejects.toThrow('Cannot edit OM in BROKER_APPROVED status');
    });
  });

  describe('OM Version Queries', () => {
    it('should get latest OM version', async () => {
      const { omDrafterService } = await import('../services/om-drafter.js');

      await omDrafterService.generateOMDraft(testDealDraftId, {
        createdBy: TEST_USER.id,
        createdByName: TEST_USER.name
      });

      const latest = await omDrafterService.getLatestOMVersion(testDealDraftId);

      expect(latest).toBeDefined();
      expect(latest.versionNumber).toBe(1);
    });

    it('should list all OM versions', async () => {
      const { omDrafterService } = await import('../services/om-drafter.js');

      // Create first version
      const first = await omDrafterService.generateOMDraft(testDealDraftId, {
        createdBy: TEST_USER.id,
        createdByName: TEST_USER.name
      });

      // Approve and create second version
      await omDrafterService.brokerApprove(first.id, {
        id: TEST_USER.id,
        name: TEST_USER.name
      });

      await omDrafterService.generateOMDraft(testDealDraftId, {
        createdBy: TEST_USER.id,
        createdByName: TEST_USER.name,
        regenerate: true
      });

      const versions = await omDrafterService.listOMVersions(testDealDraftId);

      expect(versions.length).toBe(2);
      expect(versions[0].versionNumber).toBe(2); // Latest first
      expect(versions[1].versionNumber).toBe(1);
    });
  });
});

describe('OM Sections Schema', () => {
  it('should have all required sections defined', async () => {
    const { OM_SECTIONS } = await import('../services/om-drafter.js');

    expect(OM_SECTIONS.cover).toBeDefined();
    expect(OM_SECTIONS.cover.required).toBe(true);

    expect(OM_SECTIONS.executive_summary).toBeDefined();
    expect(OM_SECTIONS.executive_summary.required).toBe(true);

    expect(OM_SECTIONS.property_overview).toBeDefined();
    expect(OM_SECTIONS.property_overview.required).toBe(true);

    expect(OM_SECTIONS.financial_summary).toBeDefined();
    expect(OM_SECTIONS.financial_summary.required).toBe(true);

    expect(OM_SECTIONS.disclaimers).toBeDefined();
    expect(OM_SECTIONS.disclaimers.required).toBe(true);
    expect(OM_SECTIONS.disclaimers.autogenerated).toBe(true);
  });

  it('should have optional sections defined', async () => {
    const { OM_SECTIONS } = await import('../services/om-drafter.js');

    expect(OM_SECTIONS.market_overview).toBeDefined();
    expect(OM_SECTIONS.market_overview.required).toBe(false);

    expect(OM_SECTIONS.investment_thesis).toBeDefined();
    expect(OM_SECTIONS.investment_thesis.required).toBe(false);
  });
});
