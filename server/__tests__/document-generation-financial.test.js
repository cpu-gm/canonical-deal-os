/**
 * Document Generation Tests for Capital Call Notices and Distribution Statements
 *
 * Tests the document generation functionality for LP financial documents:
 * - Capital call notice context building
 * - Distribution statement context building
 * - Batch document generation
 * - Template rendering
 */

import { jest } from "@jest/globals";
import { getPrisma } from "../db.js";
import {
  DOCUMENT_TYPES,
  buildCapitalCallContext,
  buildDistributionContext,
  generateCapitalCallNotices,
  generateDistributionStatements,
} from "../services/document-generator.js";

// Mock the Kernel API fetch
jest.unstable_mockModule("../kernel.js", () => ({
  kernelRequest: jest.fn().mockResolvedValue({
    id: "mock-deal-id",
    name: "Test Deal for Docs",
    status: "ACTIVE",
    propertyAddress: "123 Main St",
  }),
}));

const { kernelRequest } = await import("../kernel.js");

describe("Document Generation - Financial Documents", () => {
  let prisma;
  let dealId;
  let lpActorId;
  let shareClassId;
  let capitalCallId;
  let capitalCallAllocationId;
  let distributionId;
  let distributionAllocationId;

  beforeAll(async () => {
    prisma = getPrisma();

    // Create unique deal ID for this test suite
    const uniqueSuffix = Math.random().toString(36).substring(2, 15);
    dealId = `test-deal-docgen-${uniqueSuffix}`;

    // Create share class
    const shareClass = await prisma.shareClass.create({
      data: {
        dealId,
        code: "A",
        name: "Class A",
        preferredReturn: 0.08,
        managementFee: 0.02,
        carryPercent: 0.2,
        priority: 1,
        createdBy: "test-user",
        createdByName: "Test User",
      },
    });
    shareClassId = shareClass.id;

    // Create LP Actor
    const lpActor = await prisma.lPActor.create({
      data: {
        dealId,
        email: "test-lp-docgen@example.com",
        entityName: "DocGen Test LP Fund",
        actorId: `lp-actor-docgen-${uniqueSuffix}`,
        commitment: 1000000,
        ownershipPct: 10,
        status: "ACTIVE",
        shareClassId,
      },
    });
    lpActorId = lpActor.id;

    // Create Capital Call
    const capitalCall = await prisma.capitalCall.create({
      data: {
        dealId,
        title: "Q1 2026 Capital Call",
        totalAmount: 100000,
        dueDate: new Date("2026-02-15"),
        status: "ISSUED",
        purpose: "Initial property acquisition",
        createdBy: "test-user",
        createdByName: "Test GP User",
      },
    });
    capitalCallId = capitalCall.id;

    // Create Capital Call Allocation
    const capitalCallAllocation = await prisma.capitalCallAllocation.create({
      data: {
        capitalCallId,
        lpActorId,
        amount: 10000,
        status: "PENDING",
      },
    });
    capitalCallAllocationId = capitalCallAllocation.id;

    // Create Distribution
    const distribution = await prisma.distribution.create({
      data: {
        dealId,
        title: "Q4 2025 Distribution",
        totalAmount: 50000,
        distributionDate: new Date("2026-01-15"),
        type: "OPERATING",
        status: "APPROVED",
        period: "Q4 2025",
        createdBy: "test-user",
        createdByName: "Test GP User",
      },
    });
    distributionId = distribution.id;

    // Create Distribution Allocation
    const distributionAllocation = await prisma.distributionAllocation.create({
      data: {
        distributionId,
        lpActorId,
        grossAmount: 5000,
        withholdingAmount: 500,
        netAmount: 4500,
        status: "PENDING",
      },
    });
    distributionAllocationId = distributionAllocation.id;
  });

  afterAll(async () => {
    // Clean up test data in reverse order of creation
    await prisma.distributionAllocation.deleteMany({
      where: { distributionId },
    });
    await prisma.distribution.deleteMany({
      where: { dealId },
    });
    await prisma.capitalCallAllocation.deleteMany({
      where: { capitalCallId },
    });
    await prisma.capitalCall.deleteMany({
      where: { dealId },
    });
    await prisma.lPActor.deleteMany({
      where: { dealId },
    });
    await prisma.shareClass.deleteMany({
      where: { dealId },
    });
  });

  describe("buildCapitalCallContext", () => {
    it("should build context with all required fields", async () => {
      const context = await buildCapitalCallContext(
        dealId,
        capitalCallId,
        lpActorId
      );

      expect(context).toHaveProperty("deal");
      expect(context).toHaveProperty("capitalCall");
      expect(context).toHaveProperty("lpActor");
      expect(context).toHaveProperty("allocation");
      expect(context).toHaveProperty("callDate");
      expect(context).toHaveProperty("dueDate");
      expect(context).toHaveProperty("purpose");
    });

    it("should include capital call details", async () => {
      const context = await buildCapitalCallContext(
        dealId,
        capitalCallId,
        lpActorId
      );

      expect(context.capitalCall.title).toBe("Q1 2026 Capital Call");
      expect(context.capitalCall.totalAmount).toBe(100000);
      expect(context.capitalCall.status).toBe("ISSUED");
      expect(context.purpose).toBe("Initial property acquisition");
    });

    it("should include LP actor details with share class", async () => {
      const context = await buildCapitalCallContext(
        dealId,
        capitalCallId,
        lpActorId
      );

      expect(context.lpActor.entityName).toBe("DocGen Test LP Fund");
      expect(context.lpActor.commitment).toBe(1000000);
      expect(context.lpActor.shareClass).toBeDefined();
      expect(context.lpActor.shareClass.code).toBe("A");
      expect(context.lpActor.shareClass.preferredReturn).toBe(0.08);
    });

    it("should include allocation amount", async () => {
      const context = await buildCapitalCallContext(
        dealId,
        capitalCallId,
        lpActorId
      );

      expect(context.allocation.amount).toBe(10000);
      expect(context.allocation.status).toBe("PENDING");
    });

    it("should throw error for non-existent capital call", async () => {
      await expect(
        buildCapitalCallContext(dealId, "non-existent-id", lpActorId)
      ).rejects.toThrow();
    });

    it("should throw error for LP with no allocation", async () => {
      // Create another LP with no allocation
      const otherLp = await prisma.lPActor.create({
        data: {
          dealId,
          email: "other-lp-docgen@example.com",
          entityName: "Other LP No Alloc",
          actorId: `other-lp-docgen-${Date.now()}`,
          commitment: 500000,
          ownershipPct: 5,
          status: "ACTIVE",
        },
      });

      await expect(
        buildCapitalCallContext(dealId, capitalCallId, otherLp.id)
      ).rejects.toThrow("No allocation found");

      // Clean up
      await prisma.lPActor.delete({ where: { id: otherLp.id } });
    });
  });

  describe("buildDistributionContext", () => {
    it("should build context with all required fields", async () => {
      const context = await buildDistributionContext(
        dealId,
        distributionId,
        lpActorId
      );

      expect(context).toHaveProperty("deal");
      expect(context).toHaveProperty("distribution");
      expect(context).toHaveProperty("lpActor");
      expect(context).toHaveProperty("allocation");
      expect(context).toHaveProperty("distributionDate");
      expect(context).toHaveProperty("type");
      expect(context).toHaveProperty("period");
    });

    it("should include distribution details", async () => {
      const context = await buildDistributionContext(
        dealId,
        distributionId,
        lpActorId
      );

      expect(context.distribution.title).toBe("Q4 2025 Distribution");
      expect(context.distribution.totalAmount).toBe(50000);
      expect(context.distribution.status).toBe("APPROVED");
      expect(context.type).toBe("OPERATING");
      expect(context.period).toBe("Q4 2025");
    });

    it("should include allocation amounts with withholding", async () => {
      const context = await buildDistributionContext(
        dealId,
        distributionId,
        lpActorId
      );

      expect(context.allocation.grossAmount).toBe(5000);
      expect(context.allocation.withholdingAmount).toBe(500);
      expect(context.allocation.netAmount).toBe(4500);
    });

    it("should include LP actor details with share class", async () => {
      const context = await buildDistributionContext(
        dealId,
        distributionId,
        lpActorId
      );

      expect(context.lpActor.entityName).toBe("DocGen Test LP Fund");
      expect(context.lpActor.shareClass).toBeDefined();
      expect(context.lpActor.shareClass.name).toBe("Class A");
    });

    it("should throw error for non-existent distribution", async () => {
      await expect(
        buildDistributionContext(dealId, "non-existent-id", lpActorId)
      ).rejects.toThrow();
    });
  });

  describe("Document Type Registration", () => {
    it("should have CAPITAL_CALL_NOTICE type registered", () => {
      expect(DOCUMENT_TYPES.CAPITAL_CALL_NOTICE).toBeDefined();
      expect(DOCUMENT_TYPES.CAPITAL_CALL_NOTICE.name).toBe(
        "Capital Call Notice"
      );
      expect(DOCUMENT_TYPES.CAPITAL_CALL_NOTICE.template).toBe(
        "capital-call-notice.hbs"
      );
    });

    it("should have DISTRIBUTION_STATEMENT type registered", () => {
      expect(DOCUMENT_TYPES.DISTRIBUTION_STATEMENT).toBeDefined();
      expect(DOCUMENT_TYPES.DISTRIBUTION_STATEMENT.name).toBe(
        "Distribution Statement"
      );
      expect(DOCUMENT_TYPES.DISTRIBUTION_STATEMENT.template).toBe(
        "distribution-statement.hbs"
      );
    });
  });

  describe("Batch Generation - Capital Call Notices", () => {
    it("should generate notices for all LP allocations", async () => {
      // Create a second LP with allocation
      const lp2 = await prisma.lPActor.create({
        data: {
          dealId,
          email: "lp2-docgen@example.com",
          entityName: "DocGen Test LP 2",
          actorId: `lp2-docgen-${Date.now()}`,
          commitment: 2000000,
          ownershipPct: 20,
          status: "ACTIVE",
          shareClassId,
        },
      });

      await prisma.capitalCallAllocation.create({
        data: {
          capitalCallId,
          lpActorId: lp2.id,
          amount: 20000,
          status: "PENDING",
        },
      });

      const results = await generateCapitalCallNotices(dealId, capitalCallId, {
        id: "test-user",
        name: "Test User",
        role: "GP",
      });

      expect(results.length).toBe(2);
      expect(results.every((r) => !r.error || r.document)).toBe(true);

      // Clean up
      await prisma.capitalCallAllocation.deleteMany({
        where: { lpActorId: lp2.id },
      });
      await prisma.lPActor.delete({ where: { id: lp2.id } });
    });
  });

  describe("Batch Generation - Distribution Statements", () => {
    it("should generate statements for all LP allocations", async () => {
      // Create a second LP with allocation
      const lp2 = await prisma.lPActor.create({
        data: {
          dealId,
          email: "lp2-dist-docgen@example.com",
          entityName: "DocGen Test LP 2 Dist",
          actorId: `lp2-dist-docgen-${Date.now()}`,
          commitment: 2000000,
          ownershipPct: 20,
          status: "ACTIVE",
          shareClassId,
        },
      });

      await prisma.distributionAllocation.create({
        data: {
          distributionId,
          lpActorId: lp2.id,
          grossAmount: 10000,
          withholdingAmount: 1000,
          netAmount: 9000,
          status: "PENDING",
        },
      });

      const results = await generateDistributionStatements(
        dealId,
        distributionId,
        {
          id: "test-user",
          name: "Test User",
          role: "GP",
        }
      );

      expect(results.length).toBe(2);
      expect(results.every((r) => !r.error || r.document)).toBe(true);

      // Clean up
      await prisma.distributionAllocation.deleteMany({
        where: { lpActorId: lp2.id },
      });
      await prisma.lPActor.delete({ where: { id: lp2.id } });
    });
  });

  describe("Context Date Formatting", () => {
    it("should include properly formatted dates in capital call context", async () => {
      const context = await buildCapitalCallContext(
        dealId,
        capitalCallId,
        lpActorId
      );

      // Dates should be Date objects or ISO strings
      expect(context.callDate).toBeDefined();
      expect(context.dueDate).toBeDefined();
    });

    it("should include properly formatted dates in distribution context", async () => {
      const context = await buildDistributionContext(
        dealId,
        distributionId,
        lpActorId
      );

      expect(context.distributionDate).toBeDefined();
    });
  });
});
