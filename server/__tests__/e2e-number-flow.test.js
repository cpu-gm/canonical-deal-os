/**
 * E2E Number Flow Tests
 *
 * These tests verify that numbers flow consistently from underwriting
 * through distribution creation to LP allocations across the platform.
 *
 * Run with: npm test -- e2e-number-flow
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "@jest/globals";
import { getPrisma } from "../db.js";
import {
  generateTestId,
  createTestDeal,
  createTestWaterfallStructure,
  createTestShareClass,
  createTestLP,
  createTestLPs,
  createTestDistribution,
  createTestSnapshot,
  cleanupTestDeal,
  verifyAllocationSum,
  verifyNoNegativeAllocations,
  verifyProRataAllocation,
  verifyPriorityOrdering
} from "./helpers/e2e-test-utils.js";
import {
  calculateWaterfall,
  groupLPsByClassPriority
} from "../services/waterfall-calculator.js";
import { createDistributionSnapshot } from "../services/audit-service.js";
import crypto from "node:crypto";

// ============================================================================
// TEST SETUP
// ============================================================================

describe("E2E: Number Flow Tests", () => {
  let prisma;
  let testDealIds = [];

  beforeAll(async () => {
    prisma = getPrisma();
  });

  afterAll(async () => {
    // Cleanup all test deals
    for (const dealId of testDealIds) {
      try {
        await cleanupTestDeal(dealId);
      } catch (err) {
        // Ignore cleanup errors
      }
    }
  });

  // ============================================================================
  // SUITE 1: UNDERWRITING TO DISTRIBUTION FLOW
  // ============================================================================

  describe("E2E: Underwriting to Distribution Flow", () => {
    let dealId;
    let waterfallStructure;

    beforeEach(async () => {
      dealId = generateTestId("deal");
      testDealIds.push(dealId);
    });

    afterEach(async () => {
      await cleanupTestDeal(dealId);
      testDealIds = testDealIds.filter(id => id !== dealId);
    });

    it("1.1: Waterfall structure terms propagate to distribution calculation", async () => {
      // Create waterfall structure with specific terms
      waterfallStructure = await createTestWaterfallStructure(dealId, {
        lpEquity: 9000000,
        gpEquity: 1000000,
        preferredReturn: 0.08,
        promoteTiers: [
          { hurdle: 0.12, lpSplit: 0.80, gpSplit: 0.20 }
        ],
        gpCatchUp: true
      });

      // Create single share class and LPs
      const shareClass = await createTestShareClass(dealId, {
        code: "A",
        preferredReturn: 0.08,
        priority: 1
      });

      await createTestLPs(dealId, [
        { commitment: 5000000, ownershipPct: 50, shareClassId: shareClass.id },
        { commitment: 3000000, ownershipPct: 30, shareClassId: shareClass.id },
        { commitment: 1000000, ownershipPct: 20, shareClassId: shareClass.id }
      ]);

      // Get LPs with share class for waterfall
      const lpActors = await prisma.lPActor.findMany({
        where: { dealId, status: "ACTIVE" },
        include: { shareClass: true }
      });

      const lpOwnership = lpActors.map(lp => ({
        lpActorId: lp.id,
        entityName: lp.entityName,
        ownershipPct: lp.ownershipPct,
        commitment: lp.commitment,
        shareClass: lp.shareClass ? {
          id: lp.shareClass.id,
          code: lp.shareClass.code,
          preferredReturn: lp.shareClass.preferredReturn,
          priority: lp.shareClass.priority
        } : null
      }));

      // Calculate waterfall
      const cashFlows = [500000, 600000, 700000, 12000000];
      const perClassConfig = groupLPsByClassPriority(lpOwnership);

      const result = calculateWaterfall(cashFlows, {
        lpEquity: waterfallStructure.lpEquity,
        gpEquity: waterfallStructure.gpEquity,
        preferredReturn: waterfallStructure.preferredReturn,
        promoteTiers: JSON.parse(waterfallStructure.promoteTiers),
        gpCatchUp: waterfallStructure.gpCatchUp,
        catchUpPercent: waterfallStructure.catchUpPercent
      }, { useClassTerms: true, perClassConfig });

      // Verify calculation used waterfall terms
      expect(result.error).toBeUndefined();
      expect(result.summary).toBeDefined();
      expect(result.structure.lpEquity).toBe(9000000);
      expect(result.structure.preferredReturn).toBe(0.08);
    });

    it("1.2: Per-class preferred returns applied correctly", async () => {
      // Create Class A (8% pref) and Class P (10% pref)
      const classP = await createTestShareClass(dealId, {
        code: "P",
        name: "Preferred",
        preferredReturn: 0.10,
        priority: 1
      });
      const classA = await createTestShareClass(dealId, {
        code: "A",
        name: "Class A",
        preferredReturn: 0.08,
        priority: 2
      });

      // Create LPs in each class
      await createTestLP(dealId, {
        commitment: 2000000,
        ownershipPct: 20,
        shareClassId: classP.id
      });
      await createTestLPs(dealId, [
        { commitment: 5000000, ownershipPct: 50, shareClassId: classA.id },
        { commitment: 3000000, ownershipPct: 30, shareClassId: classA.id }
      ]);

      // Get LP data for waterfall
      const lpActors = await prisma.lPActor.findMany({
        where: { dealId, status: "ACTIVE" },
        include: { shareClass: true }
      });

      const lpOwnership = lpActors.map(lp => ({
        lpActorId: lp.id,
        entityName: lp.entityName,
        ownershipPct: lp.ownershipPct,
        commitment: lp.commitment,
        shareClass: lp.shareClass ? {
          id: lp.shareClass.id,
          code: lp.shareClass.code,
          preferredReturn: lp.shareClass.preferredReturn,
          priority: lp.shareClass.priority
        } : null
      }));

      const perClassConfig = groupLPsByClassPriority(lpOwnership);

      // Calculate waterfall
      const result = calculateWaterfall(
        [500000, 600000, 700000, 12000000],
        {
          lpEquity: 10000000,
          gpEquity: 0,
          preferredReturn: 0.08,
          promoteTiers: [{ hurdle: Infinity, lpSplit: 1.0, gpSplit: 0.0 }],
          gpCatchUp: false
        },
        { useClassTerms: true, perClassConfig }
      );

      // Verify class-specific preferred returns
      expect(result.byClass).toBeDefined();
      expect(result.byClass.P).toBeDefined();
      expect(result.byClass.A).toBeDefined();
      expect(result.byClass.P.effectivePref).toBe(0.10);
      expect(result.byClass.A.effectivePref).toBe(0.08);
    });

    it("1.3: Priority ordering respected in limited cash scenario", async () => {
      // Create senior (priority 1) and junior (priority 2) classes
      const seniorClass = await createTestShareClass(dealId, {
        code: "S",
        name: "Senior",
        preferredReturn: 0.10,
        priority: 1
      });
      const juniorClass = await createTestShareClass(dealId, {
        code: "J",
        name: "Junior",
        preferredReturn: 0.08,
        priority: 2
      });

      // Create LPs in each class
      await createTestLP(dealId, {
        commitment: 3000000,
        ownershipPct: 30,
        shareClassId: seniorClass.id
      });
      await createTestLP(dealId, {
        commitment: 7000000,
        ownershipPct: 70,
        shareClassId: juniorClass.id
      });

      // Get LP data for waterfall
      const lpActors = await prisma.lPActor.findMany({
        where: { dealId, status: "ACTIVE" },
        include: { shareClass: true }
      });

      const lpOwnership = lpActors.map(lp => ({
        lpActorId: lp.id,
        entityName: lp.entityName,
        ownershipPct: lp.ownershipPct,
        commitment: lp.commitment,
        shareClass: lp.shareClass ? {
          id: lp.shareClass.id,
          code: lp.shareClass.code,
          preferredReturn: lp.shareClass.preferredReturn,
          priority: lp.shareClass.priority
        } : null
      }));

      const perClassConfig = groupLPsByClassPriority(lpOwnership);

      // Limited cash - only covers senior capital + some pref
      const result = calculateWaterfall(
        [3500000], // Only $3.5M to distribute
        {
          lpEquity: 10000000,
          gpEquity: 0,
          preferredReturn: 0.08,
          promoteTiers: [{ hurdle: Infinity, lpSplit: 1.0, gpSplit: 0.0 }],
          gpCatchUp: false
        },
        { useClassTerms: true, perClassConfig }
      );

      // Verify senior class paid first
      expect(result.byClass.S).toBeDefined();
      expect(result.byClass.J).toBeDefined();

      // Senior ($3M capital) should be fully returned
      expect(result.byClass.S.capitalReturned).toBe(3000000);

      // Junior should get remaining $500k toward their $7M capital
      expect(result.byClass.J.capitalReturned).toBe(500000);
    });

    it("1.4: Pro-rata allocation within same class", async () => {
      // Create single class with 3 LPs at different ownership %
      const shareClass = await createTestShareClass(dealId, {
        code: "A",
        preferredReturn: 0.08,
        priority: 1
      });

      const lps = await createTestLPs(dealId, [
        { commitment: 5000000, ownershipPct: 50, shareClassId: shareClass.id },
        { commitment: 3000000, ownershipPct: 30, shareClassId: shareClass.id },
        { commitment: 2000000, ownershipPct: 20, shareClassId: shareClass.id }
      ]);

      // Create distribution
      const distribution = await createTestDistribution(dealId, {
        totalAmount: 100000
      });

      // Verify sum of allocations equals total
      const sumResult = verifyAllocationSum(distribution.allocations, 100000);
      expect(sumResult.valid).toBe(true);
      expect(sumResult.diff).toBeLessThan(0.01);

      // Verify pro-rata allocation
      const lpActors = await prisma.lPActor.findMany({
        where: { dealId, status: "ACTIVE" }
      });
      const proRataResult = verifyProRataAllocation(
        distribution.allocations,
        lpActors,
        100000
      );
      expect(proRataResult.valid).toBe(true);
    });
  });

  // ============================================================================
  // SUITE 2: SNAPSHOT REPRODUCIBILITY
  // ============================================================================

  describe("E2E: Snapshot Reproducibility", () => {
    let dealId;

    beforeEach(async () => {
      dealId = generateTestId("deal");
      testDealIds.push(dealId);
    });

    afterEach(async () => {
      await cleanupTestDeal(dealId);
      testDealIds = testDealIds.filter(id => id !== dealId);
    });

    it("2.1: Distribution snapshot captures per-class terms", async () => {
      // Create share classes with different terms
      const classA = await createTestShareClass(dealId, {
        code: "A",
        preferredReturn: 0.08,
        managementFee: 0.02,
        carryPercent: 0.20,
        priority: 1
      });
      const classB = await createTestShareClass(dealId, {
        code: "B",
        preferredReturn: 0.06,
        priority: 2
      });

      // Create LPs
      await createTestLP(dealId, {
        commitment: 5000000,
        ownershipPct: 50,
        shareClassId: classA.id
      });
      await createTestLP(dealId, {
        commitment: 5000000,
        ownershipPct: 50,
        shareClassId: classB.id
      });

      // Create snapshot
      const snapshot = await createDistributionSnapshot(
        dealId,
        "E2E test snapshot",
        { id: "e2e-test", name: "E2E Test" }
      );

      // Verify snapshot contains class terms
      const lpOwnership = JSON.parse(snapshot.lpOwnership);
      expect(lpOwnership.length).toBe(2);

      // Find Class A LP
      const classALP = lpOwnership.find(lp => lp.shareClass?.code === "A");
      expect(classALP).toBeDefined();
      expect(classALP.shareClass.preferredReturn).toBe(0.08);
      expect(classALP.shareClass.managementFee).toBe(0.02);
      expect(classALP.shareClass.carryPercent).toBe(0.20);

      // Find Class B LP
      const classBLP = lpOwnership.find(lp => lp.shareClass?.code === "B");
      expect(classBLP).toBeDefined();
      expect(classBLP.shareClass.preferredReturn).toBe(0.06);
    });

    it("2.2: Calculation reproducible from snapshot data", async () => {
      // Setup: Create waterfall structure
      await createTestWaterfallStructure(dealId, {
        lpEquity: 10000000,
        gpEquity: 0,
        preferredReturn: 0.08
      });

      const shareClass = await createTestShareClass(dealId, {
        code: "A",
        preferredReturn: 0.08,
        priority: 1
      });

      await createTestLPs(dealId, [
        { commitment: 6000000, ownershipPct: 60, shareClassId: shareClass.id },
        { commitment: 4000000, ownershipPct: 40, shareClassId: shareClass.id }
      ]);

      // Get current LP data
      const lpActors = await prisma.lPActor.findMany({
        where: { dealId, status: "ACTIVE" },
        include: { shareClass: true }
      });

      const lpOwnership = lpActors.map(lp => ({
        lpActorId: lp.id,
        entityName: lp.entityName,
        ownershipPct: lp.ownershipPct,
        commitment: lp.commitment,
        shareClass: lp.shareClass ? {
          id: lp.shareClass.id,
          code: lp.shareClass.code,
          preferredReturn: lp.shareClass.preferredReturn,
          priority: lp.shareClass.priority
        } : null
      }));

      // Calculate waterfall with current data
      const perClassConfig = groupLPsByClassPriority(lpOwnership);
      const cashFlows = [500000, 12000000];

      const result1 = calculateWaterfall(
        cashFlows,
        { lpEquity: 10000000, gpEquity: 0, preferredReturn: 0.08, promoteTiers: [], gpCatchUp: false },
        { useClassTerms: true, perClassConfig }
      );

      // Create and retrieve snapshot
      const snapshot = await createDistributionSnapshot(
        dealId,
        "Reproducibility test",
        { id: "e2e-test", name: "E2E Test" }
      );

      // Re-run calculation using snapshot data
      const snapshotLpOwnership = JSON.parse(snapshot.lpOwnership);
      const snapshotPerClassConfig = groupLPsByClassPriority(snapshotLpOwnership);

      const result2 = calculateWaterfall(
        cashFlows,
        { lpEquity: 10000000, gpEquity: 0, preferredReturn: 0.08, promoteTiers: [], gpCatchUp: false },
        { useClassTerms: true, perClassConfig: snapshotPerClassConfig }
      );

      // Verify identical results
      expect(result1.summary.lpTotalReturn).toBe(result2.summary.lpTotalReturn);
      expect(result1.summary.gpTotalReturn).toBe(result2.summary.gpTotalReturn);
    });

    it("2.3: Snapshot captures waterfall rules", async () => {
      // Create waterfall structure
      const waterfallStructure = await createTestWaterfallStructure(dealId, {
        lpEquity: 9000000,
        gpEquity: 1000000,
        preferredReturn: 0.08,
        promoteTiers: [
          { hurdle: 0.12, lpSplit: 0.80, gpSplit: 0.20 }
        ],
        gpCatchUp: true,
        catchUpPercent: 0.5
      });

      // Create LP
      await createTestLP(dealId, {
        commitment: 9000000,
        ownershipPct: 100
      });

      // Create snapshot with waterfall rules
      const snapshot = await createDistributionSnapshot(
        dealId,
        "Waterfall rules test",
        { id: "e2e-test", name: "E2E Test" }
      );

      // Verify waterfall rules captured
      expect(snapshot.waterfallRules).toBeDefined();
      const rules = JSON.parse(snapshot.waterfallRules);
      expect(rules.lpEquity).toBe(9000000);
      expect(rules.gpEquity).toBe(1000000);
      expect(rules.preferredReturn).toBe(0.08);
      expect(rules.gpCatchUp).toBe(true);
      expect(rules.catchUpPercent).toBe(0.5);

      // Verify rulebook hash
      expect(snapshot.rulebookHash).toBeDefined();
      expect(snapshot.rulebookHash.length).toBe(64); // SHA-256 hex
    });
  });

  // ============================================================================
  // SUITE 3: DATA INTEGRITY INVARIANTS
  // ============================================================================

  describe("E2E: Data Integrity Invariants", () => {
    let dealId;

    beforeEach(async () => {
      dealId = generateTestId("deal");
      testDealIds.push(dealId);
    });

    afterEach(async () => {
      await cleanupTestDeal(dealId);
      testDealIds = testDealIds.filter(id => id !== dealId);
    });

    it("3.1: Allocation sum equals distribution total", async () => {
      // Create LPs
      await createTestLPs(dealId, [
        { commitment: 5000000, ownershipPct: 50 },
        { commitment: 3000000, ownershipPct: 30 },
        { commitment: 2000000, ownershipPct: 20 }
      ]);

      // Create distribution
      const distribution = await createTestDistribution(dealId, {
        totalAmount: 123456.78
      });

      // Verify sum
      const result = verifyAllocationSum(distribution.allocations, 123456.78);
      expect(result.valid).toBe(true);
      expect(result.diff).toBeLessThan(0.01);
    });

    it("3.2: No negative allocations", async () => {
      // Create LPs
      await createTestLPs(dealId, [
        { commitment: 5000000, ownershipPct: 50 },
        { commitment: 5000000, ownershipPct: 50 }
      ]);

      // Create distribution
      const distribution = await createTestDistribution(dealId, {
        totalAmount: 100000
      });

      // Verify no negatives
      const result = verifyNoNegativeAllocations(distribution.allocations);
      expect(result.valid).toBe(true);
      expect(result.negativeCount).toBe(0);
    });

    it("3.3: All active LPs receive allocation", async () => {
      // Create multiple LPs
      const lps = await createTestLPs(dealId, [
        { commitment: 5000000, ownershipPct: 50, status: "ACTIVE" },
        { commitment: 3000000, ownershipPct: 30, status: "ACTIVE" },
        { commitment: 2000000, ownershipPct: 20, status: "ACTIVE" }
      ]);

      // Create distribution
      const distribution = await createTestDistribution(dealId, {
        totalAmount: 100000
      });

      // Verify all active LPs have allocations
      const allocatedLpIds = distribution.allocations.map(a => a.lpActorId);
      for (const lp of lps) {
        expect(allocatedLpIds).toContain(lp.id);
      }
    });

    it("3.4: Inactive LPs excluded from allocation", async () => {
      // Create one active and one inactive LP
      const activeLp = await createTestLP(dealId, {
        commitment: 5000000,
        ownershipPct: 50,
        status: "ACTIVE"
      });
      const inactiveLp = await createTestLP(dealId, {
        commitment: 5000000,
        ownershipPct: 50,
        status: "INACTIVE"
      });

      // Create distribution
      const distribution = await createTestDistribution(dealId, {
        totalAmount: 100000
      });

      // Verify only active LP has allocation
      const allocatedLpIds = distribution.allocations.map(a => a.lpActorId);
      expect(allocatedLpIds).toContain(activeLp.id);
      expect(allocatedLpIds).not.toContain(inactiveLp.id);

      // Active LP should get full amount
      const activeAllocation = distribution.allocations.find(a => a.lpActorId === activeLp.id);
      expect(activeAllocation.grossAmount).toBe(100000);
    });

    it("3.5: Ownership percentages respected in allocation", async () => {
      // Create LPs with specific ownership
      await createTestLPs(dealId, [
        { commitment: 6000000, ownershipPct: 60 },
        { commitment: 4000000, ownershipPct: 40 }
      ]);

      // Create distribution
      const distribution = await createTestDistribution(dealId, {
        totalAmount: 100000
      });

      // Verify allocations match ownership
      const lpActors = await prisma.lPActor.findMany({
        where: { dealId, status: "ACTIVE" }
      });

      const lp60 = lpActors.find(lp => lp.ownershipPct === 60);
      const lp40 = lpActors.find(lp => lp.ownershipPct === 40);

      const alloc60 = distribution.allocations.find(a => a.lpActorId === lp60.id);
      const alloc40 = distribution.allocations.find(a => a.lpActorId === lp40.id);

      expect(alloc60.grossAmount).toBeCloseTo(60000, 1);
      expect(alloc40.grossAmount).toBeCloseTo(40000, 1);
    });
  });

  // ============================================================================
  // SUITE 4: BACKWARD COMPATIBILITY
  // ============================================================================

  describe("E2E: Backward Compatibility", () => {
    let dealId;

    beforeEach(async () => {
      dealId = generateTestId("deal");
      testDealIds.push(dealId);
    });

    afterEach(async () => {
      await cleanupTestDeal(dealId);
      testDealIds = testDealIds.filter(id => id !== dealId);
    });

    it("4.1: Distribution without waterfall uses pro-rata", async () => {
      // Create LPs without share classes
      await createTestLPs(dealId, [
        { commitment: 5000000, ownershipPct: 50 },
        { commitment: 5000000, ownershipPct: 50 }
      ]);

      // Create distribution (no waterfall)
      const distribution = await createTestDistribution(dealId, {
        totalAmount: 100000
      });

      // Verify simple pro-rata allocation
      expect(distribution.allocations.length).toBe(2);
      for (const allocation of distribution.allocations) {
        expect(allocation.grossAmount).toBe(50000); // 50/50 split
      }
    });

    it("4.2: Deal without classes uses default allocation", async () => {
      // Create LPs without share classes
      await createTestLPs(dealId, [
        { commitment: 6000000, ownershipPct: 60, shareClassId: null },
        { commitment: 4000000, ownershipPct: 40, shareClassId: null }
      ]);

      // Create distribution
      const distribution = await createTestDistribution(dealId, {
        totalAmount: 100000
      });

      // Verify standard pro-rata based on ownershipPct
      const lpActors = await prisma.lPActor.findMany({
        where: { dealId, status: "ACTIVE" }
      });

      const proRataResult = verifyProRataAllocation(
        distribution.allocations,
        lpActors,
        100000
      );
      expect(proRataResult.valid).toBe(true);
    });

    it("4.3: Waterfall calculation without options unchanged", async () => {
      // Use calculateWaterfall without options
      const cashFlows = [500000, 600000, 700000, 12000000];
      const structure = {
        lpEquity: 9000000,
        gpEquity: 1000000,
        preferredReturn: 0.08,
        promoteTiers: [
          { hurdle: 0.12, lpSplit: 0.80, gpSplit: 0.20 }
        ],
        gpCatchUp: true
      };

      const result = calculateWaterfall(cashFlows, structure);

      // Verify standard calculation works
      expect(result.error).toBeUndefined();
      expect(result.summary).toBeDefined();
      expect(result.summary.lpTotalReturn).toBeGreaterThan(0);
      expect(result.summary.gpTotalReturn).toBeGreaterThan(0);

      // Verify no per-class breakdown (not using per-class mode)
      expect(result.byClass).toBeUndefined();
    });
  });

  // ============================================================================
  // SUITE 5: FULL E2E SCENARIO
  // ============================================================================

  describe("E2E: Complete Deal Lifecycle", () => {
    let dealId;

    beforeAll(async () => {
      dealId = generateTestId("deal-lifecycle");
      testDealIds.push(dealId);
    });

    afterAll(async () => {
      await cleanupTestDeal(dealId);
      testDealIds = testDealIds.filter(id => id !== dealId);
    });

    it("5.1: Full flow from deal creation to LP distribution", async () => {
      // STEP 1: Create waterfall structure
      const waterfallStructure = await createTestWaterfallStructure(dealId, {
        lpEquity: 9000000,
        gpEquity: 1000000,
        preferredReturn: 0.08,
        promoteTiers: [{ hurdle: 0.12, lpSplit: 0.80, gpSplit: 0.20 }],
        gpCatchUp: true
      });
      expect(waterfallStructure.id).toBeDefined();

      // STEP 2: Create share classes
      const classA = await createTestShareClass(dealId, {
        code: "A",
        name: "Class A",
        preferredReturn: 0.08,
        priority: 1
      });
      const classB = await createTestShareClass(dealId, {
        code: "B",
        name: "Class B",
        preferredReturn: 0.06,
        priority: 2
      });
      expect(classA.id).toBeDefined();
      expect(classB.id).toBeDefined();

      // STEP 3: Create LPs in each class
      const lp1 = await createTestLP(dealId, {
        entityName: "LP One",
        commitment: 5000000,
        ownershipPct: 50,
        shareClassId: classA.id
      });
      const lp2 = await createTestLP(dealId, {
        entityName: "LP Two",
        commitment: 3000000,
        ownershipPct: 30,
        shareClassId: classA.id
      });
      const lp3 = await createTestLP(dealId, {
        entityName: "LP Three",
        commitment: 2000000,
        ownershipPct: 20,
        shareClassId: classB.id
      });
      expect(lp1.shareClass.code).toBe("A");
      expect(lp3.shareClass.code).toBe("B");

      // STEP 4: Calculate waterfall
      const lpActors = await prisma.lPActor.findMany({
        where: { dealId, status: "ACTIVE" },
        include: { shareClass: true }
      });

      const lpOwnership = lpActors.map(lp => ({
        lpActorId: lp.id,
        entityName: lp.entityName,
        ownershipPct: lp.ownershipPct,
        commitment: lp.commitment,
        shareClass: lp.shareClass ? {
          id: lp.shareClass.id,
          code: lp.shareClass.code,
          preferredReturn: lp.shareClass.preferredReturn,
          priority: lp.shareClass.priority
        } : null
      }));

      const perClassConfig = groupLPsByClassPriority(lpOwnership);
      const waterfallCalc = calculateWaterfall(
        [500000, 600000, 700000, 12000000],
        {
          lpEquity: waterfallStructure.lpEquity,
          gpEquity: waterfallStructure.gpEquity,
          preferredReturn: waterfallStructure.preferredReturn,
          promoteTiers: JSON.parse(waterfallStructure.promoteTiers),
          gpCatchUp: waterfallStructure.gpCatchUp
        },
        { useClassTerms: true, perClassConfig }
      );

      expect(waterfallCalc.byClass.A).toBeDefined();
      expect(waterfallCalc.byClass.B).toBeDefined();

      // STEP 5: Create distribution
      const distribution = await createTestDistribution(dealId, {
        totalAmount: 1000000,
        type: "OPERATING"
      });

      // STEP 6: Verify allocations
      expect(distribution.allocations.length).toBe(3);
      const totalAllocated = distribution.allocations.reduce((s, a) => s + a.grossAmount, 0);
      expect(Math.abs(totalAllocated - 1000000)).toBeLessThan(0.01);

      // STEP 7: Verify no negative allocations
      const negativeCheck = verifyNoNegativeAllocations(distribution.allocations);
      expect(negativeCheck.valid).toBe(true);

      // STEP 8: Verify snapshot was created
      const snapshot = await createDistributionSnapshot(
        dealId,
        "Full E2E test",
        { id: "e2e-test", name: "E2E Test" }
      );
      expect(snapshot.id).toBeDefined();

      const snapshotLpOwnership = JSON.parse(snapshot.lpOwnership);
      expect(snapshotLpOwnership.length).toBe(3);

      // Verify snapshot includes share class info
      const snapshotClassA = snapshotLpOwnership.filter(lp => lp.shareClass?.code === "A");
      const snapshotClassB = snapshotLpOwnership.filter(lp => lp.shareClass?.code === "B");
      expect(snapshotClassA.length).toBe(2);
      expect(snapshotClassB.length).toBe(1);

      // STEP 9: Verify total cash flow matches
      const totalCashFlows = 500000 + 600000 + 700000 + 12000000;
      const lpGpTotal = waterfallCalc.summary.lpTotalReturn + waterfallCalc.summary.gpTotalReturn;
      expect(Math.abs(lpGpTotal - totalCashFlows)).toBeLessThan(1);
    });
  });
});
