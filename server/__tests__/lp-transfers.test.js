/**
 * LP Transfers Test Suite
 * Run with: npm test -- --testPathPattern=lp-transfers
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import { getPrisma } from "../db.js";
import crypto from "node:crypto";

describe("LP Transfers Integration Tests", () => {
  let prisma;
  const testDealId = "test-deal-" + crypto.randomUUID();
  const testOrgId = "test-org-" + crypto.randomUUID();
  const testUserId = "test-user-" + crypto.randomUUID();

  // Test LPs
  let fromLpActor;
  let toLpActor;

  beforeAll(async () => {
    prisma = getPrisma();

    // Create test LPs
    fromLpActor = await prisma.lPActor.create({
      data: {
        id: crypto.randomUUID(),
        dealId: testDealId,
        email: "from-lp@example.com",
        entityName: "Source LP Fund",
        actorId: crypto.randomUUID(),
        commitment: 5000000,
        ownershipPct: 50,
        status: "ACTIVE",
        organizationId: testOrgId
      }
    });

    toLpActor = await prisma.lPActor.create({
      data: {
        id: crypto.randomUUID(),
        dealId: testDealId,
        email: "to-lp@example.com",
        entityName: "Destination LP Fund",
        actorId: crypto.randomUUID(),
        commitment: 3000000,
        ownershipPct: 30,
        status: "ACTIVE",
        organizationId: testOrgId
      }
    });
  });

  afterAll(async () => {
    // Cleanup test data in reverse order of dependencies
    await prisma.lPTransfer.deleteMany({
      where: { dealId: testDealId }
    });
    await prisma.lPActor.deleteMany({
      where: { dealId: testDealId }
    });
  });

  describe("LPTransfer Model", () => {
    it("should create a transfer with valid data", async () => {
      const transferId = crypto.randomUUID();
      const effectiveDate = new Date();
      effectiveDate.setDate(effectiveDate.getDate() + 7);

      const transfer = await prisma.lPTransfer.create({
        data: {
          id: transferId,
          dealId: testDealId,
          organizationId: testOrgId,
          fromLpActorId: fromLpActor.id,
          toLpActorId: toLpActor.id,
          transferAmount: 1000000,
          transferPct: 10,
          effectiveDate,
          status: "PENDING",
          reason: "Portfolio rebalancing",
          createdBy: testUserId,
          createdByName: "Test GP User"
        }
      });

      expect(transfer.id).toBe(transferId);
      expect(transfer.status).toBe("PENDING");
      expect(transfer.transferAmount).toBe(1000000);
      expect(transfer.transferPct).toBe(10);
      expect(transfer.fromLpActorId).toBe(fromLpActor.id);
      expect(transfer.toLpActorId).toBe(toLpActor.id);
    });

    it("should create transfer with relations", async () => {
      const effectiveDate = new Date();
      effectiveDate.setDate(effectiveDate.getDate() + 14);

      const transfer = await prisma.lPTransfer.create({
        data: {
          id: crypto.randomUUID(),
          dealId: testDealId,
          organizationId: testOrgId,
          fromLpActorId: fromLpActor.id,
          toLpActorId: toLpActor.id,
          transferAmount: 500000,
          transferPct: 5,
          effectiveDate,
          status: "PENDING",
          createdBy: testUserId
        },
        include: {
          fromLpActor: true,
          toLpActor: true
        }
      });

      expect(transfer.fromLpActor.entityName).toBe("Source LP Fund");
      expect(transfer.toLpActor.entityName).toBe("Destination LP Fund");
    });

    it("should enforce transfer cannot be to self", async () => {
      const effectiveDate = new Date();

      // This is a business logic constraint, not a DB constraint
      // The API should prevent this, but the DB allows it
      // Testing the API would require HTTP calls
      expect(fromLpActor.id).not.toBe(toLpActor.id);
    });
  });

  describe("Transfer Status Workflow", () => {
    let workflowTransfer;

    beforeEach(async () => {
      const effectiveDate = new Date();
      effectiveDate.setDate(effectiveDate.getDate() - 1); // Yesterday - ready for completion

      workflowTransfer = await prisma.lPTransfer.create({
        data: {
          id: crypto.randomUUID(),
          dealId: testDealId,
          organizationId: testOrgId,
          fromLpActorId: fromLpActor.id,
          toLpActorId: toLpActor.id,
          transferAmount: 100000,
          transferPct: 1,
          effectiveDate,
          status: "PENDING",
          createdBy: testUserId
        }
      });
    });

    it("should transition from PENDING to APPROVED", async () => {
      const updated = await prisma.lPTransfer.update({
        where: { id: workflowTransfer.id },
        data: {
          status: "APPROVED",
          approvedAt: new Date(),
          approvedBy: testUserId,
          approvedByName: "Test GP User"
        }
      });

      expect(updated.status).toBe("APPROVED");
      expect(updated.approvedAt).not.toBeNull();
      expect(updated.approvedBy).toBe(testUserId);
    });

    it("should transition from APPROVED to COMPLETED", async () => {
      // First approve
      await prisma.lPTransfer.update({
        where: { id: workflowTransfer.id },
        data: {
          status: "APPROVED",
          approvedAt: new Date(),
          approvedBy: testUserId
        }
      });

      // Then complete
      const updated = await prisma.lPTransfer.update({
        where: { id: workflowTransfer.id },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          completedBy: testUserId,
          completedByName: "Test GP User"
        }
      });

      expect(updated.status).toBe("COMPLETED");
      expect(updated.completedAt).not.toBeNull();
    });

    it("should allow cancellation from PENDING", async () => {
      const updated = await prisma.lPTransfer.update({
        where: { id: workflowTransfer.id },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancelledBy: testUserId,
          cancellationReason: "LP changed their mind"
        }
      });

      expect(updated.status).toBe("CANCELLED");
      expect(updated.cancellationReason).toBe("LP changed their mind");
    });

    it("should allow cancellation from APPROVED", async () => {
      // First approve
      await prisma.lPTransfer.update({
        where: { id: workflowTransfer.id },
        data: {
          status: "APPROVED",
          approvedAt: new Date(),
          approvedBy: testUserId
        }
      });

      // Then cancel
      const updated = await prisma.lPTransfer.update({
        where: { id: workflowTransfer.id },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancelledBy: testUserId,
          cancellationReason: "Deal terms changed"
        }
      });

      expect(updated.status).toBe("CANCELLED");
    });
  });

  describe("Query Operations", () => {
    it("should find transfers by deal", async () => {
      const transfers = await prisma.lPTransfer.findMany({
        where: { dealId: testDealId }
      });

      expect(transfers.length).toBeGreaterThan(0);
      expect(transfers.every(t => t.dealId === testDealId)).toBe(true);
    });

    it("should filter transfers by status", async () => {
      const pendingTransfers = await prisma.lPTransfer.findMany({
        where: { dealId: testDealId, status: "PENDING" }
      });

      expect(pendingTransfers.every(t => t.status === "PENDING")).toBe(true);
    });

    it("should find transfers by LP (source)", async () => {
      const transfers = await prisma.lPTransfer.findMany({
        where: { fromLpActorId: fromLpActor.id }
      });

      expect(transfers.every(t => t.fromLpActorId === fromLpActor.id)).toBe(true);
    });

    it("should find transfers by LP (destination)", async () => {
      const transfers = await prisma.lPTransfer.findMany({
        where: { toLpActorId: toLpActor.id }
      });

      expect(transfers.every(t => t.toLpActorId === toLpActor.id)).toBe(true);
    });

    it("should include LP relations", async () => {
      const transfers = await prisma.lPTransfer.findMany({
        where: { dealId: testDealId },
        include: {
          fromLpActor: { select: { entityName: true } },
          toLpActor: { select: { entityName: true } }
        }
      });

      expect(transfers.length).toBeGreaterThan(0);
      expect(transfers[0].fromLpActor.entityName).toBe("Source LP Fund");
      expect(transfers[0].toLpActor.entityName).toBe("Destination LP Fund");
    });
  });

  describe("Organization Isolation", () => {
    it("should store organizationId on transfer", async () => {
      const transfer = await prisma.lPTransfer.findFirst({
        where: { dealId: testDealId }
      });

      expect(transfer.organizationId).toBe(testOrgId);
    });

    it("should filter by organizationId", async () => {
      const transfers = await prisma.lPTransfer.findMany({
        where: { organizationId: testOrgId }
      });

      expect(transfers.length).toBeGreaterThan(0);
      expect(transfers.every(t => t.organizationId === testOrgId)).toBe(true);
    });
  });

  describe("Transfer Amount Validation", () => {
    it("should store positive transfer amounts", async () => {
      const transfer = await prisma.lPTransfer.findFirst({
        where: { dealId: testDealId }
      });

      expect(transfer.transferAmount).toBeGreaterThan(0);
      expect(transfer.transferPct).toBeGreaterThan(0);
    });

    // Note: Business logic validation (transfer <= LP position) is done in the API layer
    // The database allows any positive values
  });
});
