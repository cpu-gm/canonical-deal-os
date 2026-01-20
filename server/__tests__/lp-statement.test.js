/**
 * LP Statement Service Test Suite
 * Run with: npm test -- --testPathPattern=lp-statement
 */

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { getPrisma } from "../db.js";
import crypto from "node:crypto";
import {
  buildLPStatement,
  requireLPDealAccess,
  calculateCapitalCallSummary,
  calculateDistributionSummary,
  calculatePerformance
} from "../services/lp-statement-service.js";

describe("LP Statement Service", () => {
  let prisma;
  const testDealId = "test-deal-stmt-" + crypto.randomUUID();
  const testOrgId = "test-org-stmt-" + crypto.randomUUID();
  const testUserId = "test-user-stmt-" + crypto.randomUUID();
  let testLpActor;
  let testShareClass;
  let testCapitalCall;
  let testDistribution;

  beforeAll(async () => {
    prisma = getPrisma();

    // Create share class
    testShareClass = await prisma.shareClass.create({
      data: {
        id: crypto.randomUUID(),
        dealId: testDealId,
        organizationId: testOrgId,
        name: "Class A",
        code: "A",
        preferredReturn: 0.08,
        managementFee: 0.02,
        carryPercent: 0.20,
        priority: 1,
        createdBy: testUserId
      }
    });

    // Create LP Actor
    testLpActor = await prisma.lPActor.create({
      data: {
        id: crypto.randomUUID(),
        dealId: testDealId,
        email: `lp-stmt-${Date.now()}@test.com`,
        entityName: "Test LP Statement Fund",
        actorId: crypto.randomUUID(),
        commitment: 5000000,
        ownershipPct: 50,
        status: "ACTIVE",
        organizationId: testOrgId,
        shareClassId: testShareClass.id,
        authUserId: testUserId
      }
    });

    // Create Capital Call
    testCapitalCall = await prisma.capitalCall.create({
      data: {
        id: crypto.randomUUID(),
        dealId: testDealId,
        title: "Q1 2026 Capital Call",
        totalAmount: 100000,
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        status: "ISSUED",
        purpose: "Acquisition",
        createdBy: testUserId,
        createdByName: "Test GP"
      }
    });

    // Create Capital Call Allocation
    await prisma.capitalCallAllocation.create({
      data: {
        id: crypto.randomUUID(),
        capitalCallId: testCapitalCall.id,
        lpActorId: testLpActor.id,
        amount: 50000,
        fundedAmount: 50000,
        status: "FUNDED",
        fundedAt: new Date(),
        wireReference: "WIRE-001"
      }
    });

    // Create Distribution
    testDistribution = await prisma.distribution.create({
      data: {
        id: crypto.randomUUID(),
        dealId: testDealId,
        title: "Q1 2026 Distribution",
        totalAmount: 20000,
        distributionDate: new Date(),
        type: "CASH_DISTRIBUTION",
        status: "APPROVED",
        createdBy: testUserId,
        createdByName: "Test GP"
      }
    });

    // Create Distribution Allocation
    await prisma.distributionAllocation.create({
      data: {
        id: crypto.randomUUID(),
        distributionId: testDistribution.id,
        lpActorId: testLpActor.id,
        grossAmount: 10000,
        withholdingAmount: 500,
        netAmount: 9500,
        status: "PAID",
        paidAt: new Date()
      }
    });
  });

  afterAll(async () => {
    // Cleanup in reverse order
    await prisma.distributionAllocation.deleteMany({
      where: { distribution: { dealId: testDealId } }
    });
    await prisma.distribution.deleteMany({ where: { dealId: testDealId } });
    await prisma.capitalCallAllocation.deleteMany({
      where: { capitalCall: { dealId: testDealId } }
    });
    await prisma.capitalCall.deleteMany({ where: { dealId: testDealId } });
    await prisma.lPActor.deleteMany({ where: { dealId: testDealId } });
    await prisma.shareClass.deleteMany({ where: { dealId: testDealId } });
  });

  describe("calculateCapitalCallSummary", () => {
    it("should calculate summary from allocations", () => {
      const allocations = [
        { amount: 50000, fundedAmount: 50000, status: "FUNDED" },
        { amount: 30000, fundedAmount: 15000, status: "PENDING" }
      ];

      const summary = calculateCapitalCallSummary(allocations);

      expect(summary.totalCalled).toBe(80000);
      expect(summary.totalFunded).toBe(65000);
      expect(summary.totalPending).toBe(15000);
      expect(summary.callCount).toBe(2);
      expect(summary.fundedCount).toBe(1);
      expect(summary.pendingCount).toBe(1);
    });

    it("should handle empty allocations", () => {
      const summary = calculateCapitalCallSummary([]);

      expect(summary.totalCalled).toBe(0);
      expect(summary.totalFunded).toBe(0);
      expect(summary.callCount).toBe(0);
    });
  });

  describe("calculateDistributionSummary", () => {
    it("should calculate summary from allocations", () => {
      const allocations = [
        { grossAmount: 10000, withholdingAmount: 500, netAmount: 9500, status: "PAID" },
        { grossAmount: 5000, withholdingAmount: 250, netAmount: 4750, status: "PENDING" }
      ];

      const summary = calculateDistributionSummary(allocations);

      expect(summary.totalGross).toBe(15000);
      expect(summary.totalWithholding).toBe(750);
      expect(summary.totalNet).toBe(14250);
      expect(summary.totalPaid).toBe(9500);
      expect(summary.distributionCount).toBe(2);
      expect(summary.paidCount).toBe(1);
      expect(summary.pendingCount).toBe(1);
    });

    it("should handle empty allocations", () => {
      const summary = calculateDistributionSummary([]);

      expect(summary.totalGross).toBe(0);
      expect(summary.totalNet).toBe(0);
      expect(summary.distributionCount).toBe(0);
    });
  });

  describe("calculatePerformance", () => {
    it("should calculate performance metrics", () => {
      const lpActor = { id: "test", commitment: 100000 };
      const capitalSummary = { totalFunded: 50000, totalPending: 10000 };
      const distributionSummary = { totalPaid: 15000, totalNet: 20000 };

      const perf = calculatePerformance(lpActor, capitalSummary, distributionSummary);

      expect(perf.capitalCommitted).toBe(100000);
      expect(perf.capitalDeployed).toBe(50000);
      expect(perf.capitalRemaining).toBe(50000);
      expect(perf.distributionsReceived).toBe(15000);
      expect(perf.distributionsPending).toBe(5000);
      expect(perf.netCashFlow).toBe(-35000); // 15000 - 50000
    });

    it("should calculate distribution multiple when capital deployed > 0", () => {
      const lpActor = { id: "test", commitment: 100000 };
      const capitalSummary = { totalFunded: 50000, totalPending: 0 };
      const distributionSummary = { totalPaid: 25000, totalNet: 25000 };

      const perf = calculatePerformance(lpActor, capitalSummary, distributionSummary);

      // (25000 + 50000) / 50000 = 1.5
      expect(perf.distributionMultiple).toBe(1.5);
    });

    it("should handle zero capital deployed", () => {
      const lpActor = { id: "test", commitment: 100000 };
      const capitalSummary = { totalFunded: 0, totalPending: 0 };
      const distributionSummary = { totalPaid: 0, totalNet: 0 };

      const perf = calculatePerformance(lpActor, capitalSummary, distributionSummary);

      expect(perf.distributionMultiple).toBeNull();
    });
  });

  describe("buildLPStatement", () => {
    it("should build complete statement structure", async () => {
      const statement = await buildLPStatement(testDealId, testLpActor.id);

      expect(statement.reportDate).toBeDefined();
      expect(statement.reportPeriod).toBeDefined();
      expect(statement.lpActor).toBeDefined();
      expect(statement.capitalCalls).toBeDefined();
      expect(statement.distributions).toBeDefined();
      expect(statement.performance).toBeDefined();
    });

    it("should include LP actor details with share class", async () => {
      const statement = await buildLPStatement(testDealId, testLpActor.id);

      expect(statement.lpActor.id).toBe(testLpActor.id);
      expect(statement.lpActor.entityName).toBe("Test LP Statement Fund");
      expect(statement.lpActor.commitment).toBe(5000000);
      expect(statement.lpActor.shareClass).toBeDefined();
      expect(statement.lpActor.shareClass.code).toBe("A");
      expect(statement.lpActor.shareClass.preferredReturn).toBe(0.08);
    });

    it("should include capital call items and summary", async () => {
      const statement = await buildLPStatement(testDealId, testLpActor.id);

      expect(statement.capitalCalls.items.length).toBeGreaterThanOrEqual(1);
      expect(statement.capitalCalls.summary.callCount).toBeGreaterThanOrEqual(1);
      expect(statement.capitalCalls.summary.totalFunded).toBeGreaterThan(0);

      const item = statement.capitalCalls.items[0];
      expect(item.title).toBeDefined();
      expect(item.amount).toBeDefined();
      expect(item.fundedAmount).toBeDefined();
      expect(item.status).toBeDefined();
    });

    it("should include distribution items and summary", async () => {
      const statement = await buildLPStatement(testDealId, testLpActor.id);

      expect(statement.distributions.items.length).toBeGreaterThanOrEqual(1);
      expect(statement.distributions.summary.distributionCount).toBeGreaterThanOrEqual(1);
      expect(statement.distributions.summary.totalNet).toBeGreaterThan(0);

      const item = statement.distributions.items[0];
      expect(item.title).toBeDefined();
      expect(item.grossAmount).toBeDefined();
      expect(item.netAmount).toBeDefined();
      expect(item.status).toBeDefined();
    });

    it("should calculate performance metrics", async () => {
      const statement = await buildLPStatement(testDealId, testLpActor.id);

      expect(statement.performance.capitalCommitted).toBe(5000000);
      expect(statement.performance.capitalDeployed).toBeGreaterThan(0);
      expect(statement.performance.distributionsReceived).toBeGreaterThan(0);
      expect(typeof statement.performance.netCashFlow).toBe("number");
    });

    it("should throw error for invalid LP actor", async () => {
      await expect(
        buildLPStatement(testDealId, "invalid-lp-id")
      ).rejects.toThrow("LP Actor not found");
    });

    it("should throw error for LP in different deal", async () => {
      // Create LP in different deal
      const otherDealId = "other-deal-" + crypto.randomUUID();
      const otherLp = await prisma.lPActor.create({
        data: {
          id: crypto.randomUUID(),
          dealId: otherDealId,
          email: `other-lp-${Date.now()}@test.com`,
          entityName: "Other LP Fund",
          actorId: crypto.randomUUID(),
          commitment: 1000000,
          ownershipPct: 10,
          status: "ACTIVE"
        }
      });

      await expect(
        buildLPStatement(testDealId, otherLp.id)
      ).rejects.toThrow("LP Actor does not belong to this deal");

      // Cleanup
      await prisma.lPActor.delete({ where: { id: otherLp.id } });
    });
  });

  describe("requireLPDealAccess", () => {
    it("should return LP actor for valid access by authUserId", async () => {
      const authUser = { id: testUserId, email: "other@test.com", role: "LP" };
      const lpActor = await requireLPDealAccess(authUser, testDealId);

      expect(lpActor).not.toBeNull();
      expect(lpActor.id).toBe(testLpActor.id);
    });

    it("should return LP actor for valid access by email", async () => {
      const authUser = { id: "different-user", email: testLpActor.email, role: "LP" };
      const lpActor = await requireLPDealAccess(authUser, testDealId);

      expect(lpActor).not.toBeNull();
      expect(lpActor.id).toBe(testLpActor.id);
    });

    it("should return null for no auth user", async () => {
      const lpActor = await requireLPDealAccess(null, testDealId);
      expect(lpActor).toBeNull();
    });

    it("should return null for non-LP role", async () => {
      const authUser = { id: testUserId, email: testLpActor.email, role: "GP" };
      const lpActor = await requireLPDealAccess(authUser, testDealId);
      expect(lpActor).toBeNull();
    });

    it("should return null for LP without access to deal", async () => {
      const authUser = { id: "unknown-user", email: "unknown@test.com", role: "LP" };
      const lpActor = await requireLPDealAccess(authUser, testDealId);
      expect(lpActor).toBeNull();
    });
  });

  describe("Edge Cases", () => {
    it("should handle LP with no capital calls", async () => {
      // Create LP with no allocations
      const emptyLp = await prisma.lPActor.create({
        data: {
          id: crypto.randomUUID(),
          dealId: testDealId,
          email: `empty-lp-${Date.now()}@test.com`,
          entityName: "Empty LP Fund",
          actorId: crypto.randomUUID(),
          commitment: 1000000,
          ownershipPct: 10,
          status: "ACTIVE"
        }
      });

      const statement = await buildLPStatement(testDealId, emptyLp.id);

      expect(statement.capitalCalls.items.length).toBe(0);
      expect(statement.capitalCalls.summary.totalCalled).toBe(0);
      expect(statement.distributions.items.length).toBe(0);
      expect(statement.performance.capitalDeployed).toBe(0);

      // Cleanup
      await prisma.lPActor.delete({ where: { id: emptyLp.id } });
    });

    it("should handle LP without share class", async () => {
      // Create LP without share class
      const noClassLp = await prisma.lPActor.create({
        data: {
          id: crypto.randomUUID(),
          dealId: testDealId,
          email: `noclass-lp-${Date.now()}@test.com`,
          entityName: "No Class LP Fund",
          actorId: crypto.randomUUID(),
          commitment: 500000,
          ownershipPct: 5,
          status: "ACTIVE",
          shareClassId: null
        }
      });

      const statement = await buildLPStatement(testDealId, noClassLp.id);

      expect(statement.lpActor.shareClass).toBeNull();

      // Cleanup
      await prisma.lPActor.delete({ where: { id: noClassLp.id } });
    });
  });
});
