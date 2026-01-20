/**
 * Share Classes Test Suite
 * Run with: npm test -- --testPathPattern=share-classes
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import { getPrisma } from "../db.js";
import crypto from "node:crypto";

describe("ShareClass Integration Tests", () => {
  let prisma;
  const testDealId = "test-deal-" + crypto.randomUUID();
  const testOrgId = "test-org-" + crypto.randomUUID();
  const testUserId = "test-user-" + crypto.randomUUID();

  beforeAll(async () => {
    prisma = getPrisma();
  });

  afterAll(async () => {
    // Cleanup test data in reverse order of dependencies
    await prisma.lPActor.deleteMany({
      where: { dealId: testDealId }
    });
    await prisma.shareClass.deleteMany({
      where: { dealId: testDealId }
    });
  });

  describe("ShareClass Model", () => {
    it("should create a share class with valid data", async () => {
      const shareClass = await prisma.shareClass.create({
        data: {
          id: crypto.randomUUID(),
          dealId: testDealId,
          organizationId: testOrgId,
          name: "Class A",
          code: "A",
          description: "Primary share class",
          preferredReturn: 0.08,
          managementFee: 0.02,
          carryPercent: 0.20,
          votingRights: true,
          priority: 1,
          createdBy: testUserId,
          createdByName: "Test GP User"
        }
      });

      expect(shareClass.id).toBeDefined();
      expect(shareClass.dealId).toBe(testDealId);
      expect(shareClass.code).toBe("A");
      expect(shareClass.name).toBe("Class A");
      expect(shareClass.preferredReturn).toBe(0.08);
      expect(shareClass.managementFee).toBe(0.02);
      expect(shareClass.carryPercent).toBe(0.20);
      expect(shareClass.votingRights).toBe(true);
      expect(shareClass.priority).toBe(1);
    });

    it("should create a second share class in same deal", async () => {
      const shareClass = await prisma.shareClass.create({
        data: {
          id: crypto.randomUUID(),
          dealId: testDealId,
          organizationId: testOrgId,
          name: "Class B",
          code: "B",
          description: "Secondary share class",
          preferredReturn: 0.06,
          managementFee: 0.015,
          carryPercent: 0.25,
          votingRights: false,
          priority: 2,
          createdBy: testUserId
        }
      });

      expect(shareClass.code).toBe("B");
      expect(shareClass.name).toBe("Class B");
      expect(shareClass.votingRights).toBe(false);
      expect(shareClass.priority).toBe(2);
    });

    it("should enforce unique code per deal", async () => {
      // Try to create another Class A in the same deal
      await expect(
        prisma.shareClass.create({
          data: {
            id: crypto.randomUUID(),
            dealId: testDealId,
            organizationId: testOrgId,
            name: "Class A Duplicate",
            code: "A",  // Same code as existing
            priority: 3,
            createdBy: testUserId
          }
        })
      ).rejects.toThrow();
    });

    it("should allow same code in different deals", async () => {
      const differentDealId = "test-deal-different-" + crypto.randomUUID();

      const shareClass = await prisma.shareClass.create({
        data: {
          id: crypto.randomUUID(),
          dealId: differentDealId,
          organizationId: testOrgId,
          name: "Class A",
          code: "A",  // Same code, different deal
          priority: 1,
          createdBy: testUserId
        }
      });

      expect(shareClass.code).toBe("A");
      expect(shareClass.dealId).toBe(differentDealId);

      // Cleanup
      await prisma.shareClass.delete({ where: { id: shareClass.id } });
    });
  });

  describe("ShareClass with LPActor", () => {
    let classA;
    let classB;

    beforeAll(async () => {
      // Get the previously created classes
      classA = await prisma.shareClass.findFirst({
        where: { dealId: testDealId, code: "A" }
      });
      classB = await prisma.shareClass.findFirst({
        where: { dealId: testDealId, code: "B" }
      });
    });

    it("should create LP in a specific share class", async () => {
      const lpActor = await prisma.lPActor.create({
        data: {
          id: crypto.randomUUID(),
          dealId: testDealId,
          email: "investor1@example.com",
          entityName: "Investor One Fund",
          actorId: crypto.randomUUID(),
          commitment: 5000000,
          ownershipPct: 50,
          status: "ACTIVE",
          organizationId: testOrgId,
          shareClassId: classA.id
        },
        include: {
          shareClass: true
        }
      });

      expect(lpActor.shareClassId).toBe(classA.id);
      expect(lpActor.shareClass.code).toBe("A");
      expect(lpActor.shareClass.name).toBe("Class A");
    });

    it("should create same LP in different share class (multi-class holding)", async () => {
      // Same email but different class should be allowed with new unique constraint
      const lpActor = await prisma.lPActor.create({
        data: {
          id: crypto.randomUUID(),
          dealId: testDealId,
          email: "investor1@example.com",  // Same email
          entityName: "Investor One Fund",
          actorId: crypto.randomUUID(),
          commitment: 2000000,
          ownershipPct: 20,
          status: "ACTIVE",
          organizationId: testOrgId,
          shareClassId: classB.id  // Different class
        },
        include: {
          shareClass: true
        }
      });

      expect(lpActor.shareClassId).toBe(classB.id);
      expect(lpActor.shareClass.code).toBe("B");
    });

    it("should prevent same LP in same class twice", async () => {
      // Same email, same deal, same class should fail
      await expect(
        prisma.lPActor.create({
          data: {
            id: crypto.randomUUID(),
            dealId: testDealId,
            email: "investor1@example.com",  // Same email
            entityName: "Investor One Fund Duplicate",
            actorId: crypto.randomUUID(),
            commitment: 1000000,
            ownershipPct: 10,
            status: "ACTIVE",
            organizationId: testOrgId,
            shareClassId: classA.id  // Same class as first LP
          }
        })
      ).rejects.toThrow();
    });

    it("should create LP without share class (null)", async () => {
      const lpActor = await prisma.lPActor.create({
        data: {
          id: crypto.randomUUID(),
          dealId: testDealId,
          email: "investor2@example.com",
          entityName: "Investor Two Fund",
          actorId: crypto.randomUUID(),
          commitment: 3000000,
          ownershipPct: 30,
          status: "ACTIVE",
          organizationId: testOrgId,
          shareClassId: null  // No share class
        }
      });

      expect(lpActor.shareClassId).toBeNull();
    });
  });

  describe("Query Operations", () => {
    it("should find share classes by deal", async () => {
      const shareClasses = await prisma.shareClass.findMany({
        where: { dealId: testDealId },
        orderBy: { priority: 'asc' }
      });

      expect(shareClasses.length).toBeGreaterThanOrEqual(2);
      expect(shareClasses.every(sc => sc.dealId === testDealId)).toBe(true);
    });

    it("should include LP counts with share class", async () => {
      const shareClasses = await prisma.shareClass.findMany({
        where: { dealId: testDealId },
        include: {
          _count: {
            select: { lpActors: true }
          }
        }
      });

      expect(shareClasses.length).toBeGreaterThanOrEqual(2);
      const classA = shareClasses.find(sc => sc.code === "A");
      expect(classA._count.lpActors).toBeGreaterThanOrEqual(1);
    });

    it("should find LPs by share class", async () => {
      const classA = await prisma.shareClass.findFirst({
        where: { dealId: testDealId, code: "A" }
      });

      const lps = await prisma.lPActor.findMany({
        where: { shareClassId: classA.id },
        include: { shareClass: true }
      });

      expect(lps.length).toBeGreaterThanOrEqual(1);
      expect(lps.every(lp => lp.shareClass.code === "A")).toBe(true);
    });

    it("should find share class with all LPs", async () => {
      const shareClass = await prisma.shareClass.findFirst({
        where: { dealId: testDealId, code: "A" },
        include: {
          lpActors: {
            select: {
              id: true,
              entityName: true,
              commitment: true,
              ownershipPct: true
            }
          }
        }
      });

      expect(shareClass.lpActors.length).toBeGreaterThanOrEqual(1);
      expect(shareClass.lpActors[0].entityName).toBeDefined();
    });
  });

  describe("Organization Isolation", () => {
    it("should store organizationId on share class", async () => {
      const shareClass = await prisma.shareClass.findFirst({
        where: { dealId: testDealId, code: "A" }
      });

      expect(shareClass.organizationId).toBe(testOrgId);
    });

    it("should filter share classes by organizationId", async () => {
      const shareClasses = await prisma.shareClass.findMany({
        where: { organizationId: testOrgId }
      });

      expect(shareClasses.length).toBeGreaterThan(0);
      expect(shareClasses.every(sc => sc.organizationId === testOrgId)).toBe(true);
    });
  });

  describe("LPInvitation with ShareClass", () => {
    let classA;

    beforeAll(async () => {
      classA = await prisma.shareClass.findFirst({
        where: { dealId: testDealId, code: "A" }
      });
    });

    it("should create LP invitation with share class", async () => {
      const invitation = await prisma.lPInvitation.create({
        data: {
          id: crypto.randomUUID(),
          dealId: testDealId,
          lpEntityName: "New Investor Fund",
          lpEmail: "newinvestor@example.com",
          commitment: 1000000,
          ownershipPct: 10,
          status: "PENDING",
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          shareClassId: classA.id
        },
        include: {
          shareClass: true
        }
      });

      expect(invitation.shareClassId).toBe(classA.id);
      expect(invitation.shareClass.code).toBe("A");

      // Cleanup
      await prisma.lPInvitation.delete({ where: { id: invitation.id } });
    });

    it("should create LP invitation without share class", async () => {
      const invitation = await prisma.lPInvitation.create({
        data: {
          id: crypto.randomUUID(),
          dealId: testDealId,
          lpEntityName: "Another New Investor",
          lpEmail: "anotherinvestor@example.com",
          commitment: 500000,
          ownershipPct: 5,
          status: "PENDING",
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          shareClassId: null
        }
      });

      expect(invitation.shareClassId).toBeNull();

      // Cleanup
      await prisma.lPInvitation.delete({ where: { id: invitation.id } });
    });
  });

  describe("ShareClass Update Operations", () => {
    it("should update share class economic terms", async () => {
      const classB = await prisma.shareClass.findFirst({
        where: { dealId: testDealId, code: "B" }
      });

      const updated = await prisma.shareClass.update({
        where: { id: classB.id },
        data: {
          preferredReturn: 0.07,
          managementFee: 0.018
        }
      });

      expect(updated.preferredReturn).toBe(0.07);
      expect(updated.managementFee).toBe(0.018);
    });

    it("should update share class name and description", async () => {
      const classB = await prisma.shareClass.findFirst({
        where: { dealId: testDealId, code: "B" }
      });

      const updated = await prisma.shareClass.update({
        where: { id: classB.id },
        data: {
          name: "Class B (Updated)",
          description: "Updated secondary share class"
        }
      });

      expect(updated.name).toBe("Class B (Updated)");
      expect(updated.description).toBe("Updated secondary share class");
    });
  });

  describe("ShareClass Deletion", () => {
    it("should verify LPs exist in share class before deletion logic", async () => {
      // NOTE: SQLite doesn't enforce FK constraints by default.
      // The API layer (handleDeleteShareClass) performs explicit check before delete.
      // This test verifies the check would work - actual enforcement is in API layer.

      const classA = await prisma.shareClass.findFirst({
        where: { dealId: testDealId, code: "A" }
      });

      // Verify there are LPs in this class
      const lpCount = await prisma.lPActor.count({
        where: { shareClassId: classA.id }
      });
      expect(lpCount).toBeGreaterThan(0);

      // The API handleDeleteShareClass checks this count before attempting delete
      // If lpCount > 0, API returns 409 error before reaching prisma.delete()
    });

    it("should delete share class without LPs", async () => {
      // Create a new empty share class
      const emptyClass = await prisma.shareClass.create({
        data: {
          id: crypto.randomUUID(),
          dealId: testDealId,
          organizationId: testOrgId,
          name: "Class Z",
          code: "Z",
          priority: 99,
          createdBy: testUserId
        }
      });

      // Should succeed
      await prisma.shareClass.delete({ where: { id: emptyClass.id } });

      // Verify deleted
      const deleted = await prisma.shareClass.findUnique({
        where: { id: emptyClass.id }
      });
      expect(deleted).toBeNull();
    });
  });

  describe("Default Values", () => {
    it("should use default values when not specified", async () => {
      const shareClass = await prisma.shareClass.create({
        data: {
          id: crypto.randomUUID(),
          dealId: testDealId,
          organizationId: testOrgId,
          name: "Minimal Class",
          code: "MIN",
          createdBy: testUserId
        }
      });

      expect(shareClass.votingRights).toBe(true);  // Default true
      expect(shareClass.priority).toBe(1);  // Default 1
      expect(shareClass.preferredReturn).toBeNull();
      expect(shareClass.managementFee).toBeNull();
      expect(shareClass.carryPercent).toBeNull();

      // Cleanup
      await prisma.shareClass.delete({ where: { id: shareClass.id } });
    });
  });
});
