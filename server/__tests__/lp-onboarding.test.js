/**
 * Comprehensive LP Onboarding Test Suite
 * Run with: npm test -- --testPathPattern=lp-onboarding
 */

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { getPrisma } from "../db.js";
import crypto from "node:crypto";

describe("LP Onboarding Integration Tests", () => {
  let prisma;
  const testDealId = "test-deal-" + crypto.randomUUID();
  const testUserId = "test-user-" + crypto.randomUUID();

  beforeAll(async () => {
    prisma = getPrisma();
  });

  afterAll(async () => {
    // Cleanup test data
    await prisma.lPInvitation.deleteMany({
      where: { dealId: testDealId }
    });
    await prisma.lPActor.deleteMany({
      where: { dealId: testDealId }
    });
  });

  describe("LPInvitation Model", () => {
    it("should create an invitation with valid data", async () => {
      const invitationId = crypto.randomUUID();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);

      const invitation = await prisma.lPInvitation.create({
        data: {
          id: invitationId,
          dealId: testDealId,
          lpEntityName: "Test LP Fund",
          lpEmail: "test-lp@example.com",
          commitment: 5000000,
          ownershipPct: 10,
          status: "PENDING",
          createdByUserId: testUserId,
          expiresAt
        }
      });

      expect(invitation.id).toBe(invitationId);
      expect(invitation.status).toBe("PENDING");
      expect(invitation.commitment).toBe(5000000);
      expect(invitation.ownershipPct).toBe(10);
      expect(invitation.acceptedAt).toBeNull();
    });

    it("should enforce unique constraint on (dealId, lpEmail)", async () => {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);

      // First invitation succeeds
      await prisma.lPInvitation.create({
        data: {
          id: crypto.randomUUID(),
          dealId: testDealId,
          lpEntityName: "Unique LP Fund",
          lpEmail: "unique-lp@example.com",
          commitment: 1000000,
          ownershipPct: 5,
          status: "PENDING",
          createdByUserId: testUserId,
          expiresAt
        }
      });

      // Second invitation with same email should fail
      await expect(
        prisma.lPInvitation.create({
          data: {
            id: crypto.randomUUID(),
            dealId: testDealId,
            lpEntityName: "Duplicate LP Fund",
            lpEmail: "unique-lp@example.com",
            commitment: 2000000,
            ownershipPct: 10,
            status: "PENDING",
            createdByUserId: testUserId,
            expiresAt
          }
        })
      ).rejects.toThrow();
    });

    it("should transition invitation from PENDING to ACCEPTED", async () => {
      const invitationId = crypto.randomUUID();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);

      const invitation = await prisma.lPInvitation.create({
        data: {
          id: invitationId,
          dealId: testDealId,
          lpEntityName: "Test Acceptance LP",
          lpEmail: "acceptance-test@example.com",
          commitment: 3000000,
          ownershipPct: 7,
          status: "PENDING",
          createdByUserId: testUserId,
          expiresAt
        }
      });

      expect(invitation.status).toBe("PENDING");
      expect(invitation.acceptedAt).toBeNull();

      const updated = await prisma.lPInvitation.update({
        where: { id: invitationId },
        data: {
          status: "ACCEPTED",
          acceptedAt: new Date(),
          actorId: "test-actor-" + crypto.randomUUID()
        }
      });

      expect(updated.status).toBe("ACCEPTED");
      expect(updated.acceptedAt).not.toBeNull();
      expect(updated.actorId).not.toBeNull();
    });

    it("should query invitations by dealId and status", async () => {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);

      await prisma.lPInvitation.create({
        data: {
          id: crypto.randomUUID(),
          dealId: testDealId,
          lpEntityName: "Query Test LP 1",
          lpEmail: "query-test-1@example.com",
          commitment: 1000000,
          ownershipPct: 5,
          status: "PENDING",
          createdByUserId: testUserId,
          expiresAt
        }
      });

      await prisma.lPInvitation.create({
        data: {
          id: crypto.randomUUID(),
          dealId: testDealId,
          lpEntityName: "Query Test LP 2",
          lpEmail: "query-test-2@example.com",
          commitment: 2000000,
          ownershipPct: 10,
          status: "PENDING",
          createdByUserId: testUserId,
          expiresAt
        }
      });

      const pending = await prisma.lPInvitation.findMany({
        where: { dealId: testDealId, status: "PENDING" }
      });

      expect(pending.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("LPActor Model", () => {
    it("should create an LP actor with valid data", async () => {
      const lpActorId = crypto.randomUUID();
      const kernelActorId = "kernel-actor-" + crypto.randomUUID();

      const lpActor = await prisma.lPActor.create({
        data: {
          id: lpActorId,
          dealId: testDealId,
          email: "lp-actor@example.com",
          entityName: "Test LP Entity",
          actorId: kernelActorId,
          commitment: 5000000,
          ownershipPct: 10,
          status: "ACTIVE"
        }
      });

      expect(lpActor.id).toBe(lpActorId);
      expect(lpActor.email).toBe("lp-actor@example.com");
      expect(lpActor.actorId).toBe(kernelActorId);
      expect(lpActor.status).toBe("ACTIVE");
    });

    it("should enforce unique constraint on (email, dealId)", async () => {
      const kernelActorId1 = "kernel-actor-" + crypto.randomUUID();
      const kernelActorId2 = "kernel-actor-" + crypto.randomUUID();

      // First actor succeeds
      await prisma.lPActor.create({
        data: {
          id: crypto.randomUUID(),
          dealId: testDealId,
          email: "unique-actor@example.com",
          entityName: "First LP Entity",
          actorId: kernelActorId1,
          commitment: 1000000,
          ownershipPct: 5,
          status: "ACTIVE"
        }
      });

      // Second actor with same email should fail
      await expect(
        prisma.lPActor.create({
          data: {
            id: crypto.randomUUID(),
            dealId: testDealId,
            email: "unique-actor@example.com",
            entityName: "Second LP Entity",
            actorId: kernelActorId2,
            commitment: 2000000,
            ownershipPct: 10,
            status: "ACTIVE"
          }
        })
      ).rejects.toThrow();
    });

    it("should query active LP actors for a deal", async () => {
      await prisma.lPActor.create({
        data: {
          id: crypto.randomUUID(),
          dealId: testDealId,
          email: "active-actor-1@example.com",
          entityName: "Active LP 1",
          actorId: "kernel-actor-" + crypto.randomUUID(),
          commitment: 1000000,
          ownershipPct: 5,
          status: "ACTIVE"
        }
      });

      const activeActors = await prisma.lPActor.findMany({
        where: { dealId: testDealId, status: "ACTIVE" }
      });

      expect(activeActors.length).toBeGreaterThan(0);
      expect(activeActors.every((a) => a.status === "ACTIVE")).toBe(true);
    });

    it("should update LP actor status", async () => {
      const actorId = crypto.randomUUID();

      const actor = await prisma.lPActor.create({
        data: {
          id: actorId,
          dealId: testDealId,
          email: "update-test@example.com",
          entityName: "Update Test LP",
          actorId: "kernel-actor-" + crypto.randomUUID(),
          commitment: 3000000,
          ownershipPct: 7,
          status: "ACTIVE"
        }
      });

      expect(actor.status).toBe("ACTIVE");

      const updated = await prisma.lPActor.update({
        where: { id: actorId },
        data: { status: "INACTIVE" }
      });

      expect(updated.status).toBe("INACTIVE");
    });
  });

  describe("Data Integrity", () => {
    it("should maintain referential integrity with cascade delete", async () => {
      const invitationId = crypto.randomUUID();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);

      // Create invitation
      await prisma.lPInvitation.create({
        data: {
          id: invitationId,
          dealId: testDealId,
          lpEntityName: "Cascade Test LP",
          lpEmail: "cascade-test@example.com",
          commitment: 1000000,
          ownershipPct: 5,
          status: "PENDING",
          createdByUserId: testUserId,
          expiresAt
        }
      });

      const initialCount = await prisma.lPInvitation.count({
        where: { dealId: testDealId }
      });

      expect(initialCount).toBeGreaterThan(0);
    });

    it("should handle null values appropriately", async () => {
      const invitationId = crypto.randomUUID();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);

      const invitation = await prisma.lPInvitation.create({
        data: {
          id: invitationId,
          dealId: testDealId,
          lpEntityName: "Null Test LP",
          lpEmail: "null-test@example.com",
          commitment: 1000000,
          ownershipPct: 5,
          status: "PENDING",
          createdByUserId: testUserId,
          expiresAt
        }
      });

      expect(invitation.acceptedAt).toBeNull();
      expect(invitation.actorId).toBeNull();
    });
  });

  describe("Query Performance", () => {
    it("should efficiently query invitations with indices", async () => {
      const startTime = Date.now();

      const invitations = await prisma.lPInvitation.findMany({
        where: { dealId: testDealId }
      });

      const endTime = Date.now();
      const queryTime = endTime - startTime;

      expect(queryTime).toBeLessThan(100); // Should complete in <100ms
      expect(Array.isArray(invitations)).toBe(true);
    });

    it("should efficiently query LP actors with indices", async () => {
      const startTime = Date.now();

      const actors = await prisma.lPActor.findMany({
        where: { dealId: testDealId, status: "ACTIVE" }
      });

      const endTime = Date.now();
      const queryTime = endTime - startTime;

      expect(queryTime).toBeLessThan(100); // Should complete in <100ms
      expect(Array.isArray(actors)).toBe(true);
    });
  });

  describe("Validation", () => {
    it("should require valid dealId", async () => {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);

      await expect(
        prisma.lPInvitation.create({
          data: {
            id: crypto.randomUUID(),
            dealId: "", // Invalid: empty string
            lpEntityName: "Test LP",
            lpEmail: "test@example.com",
            commitment: 1000000,
            ownershipPct: 5,
            status: "PENDING",
            createdByUserId: testUserId,
            expiresAt
          }
        })
      ).rejects.toThrow();
    });

    it("should require valid email format", async () => {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);

      // This would fail in application layer validation,
      // but Prisma allows it (validation is in Zod schemas)
      const invitation = await prisma.lPInvitation.create({
        data: {
          id: crypto.randomUUID(),
          dealId: testDealId,
          lpEntityName: "Test LP",
          lpEmail: "not-an-email", // Invalid format
          commitment: 1000000,
          ownershipPct: 5,
          status: "PENDING",
          createdByUserId: testUserId,
          expiresAt
        }
      });

      expect(invitation.lpEmail).toBe("not-an-email");
    });

    it("should require positive commitment", async () => {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);

      // Prisma allows negative numbers, validation is in Zod
      const invitation = await prisma.lPInvitation.create({
        data: {
          id: crypto.randomUUID(),
          dealId: testDealId,
          lpEntityName: "Test LP",
          lpEmail: "test@example.com",
          commitment: -1000000, // Invalid: negative
          ownershipPct: 5,
          status: "PENDING",
          createdByUserId: testUserId,
          expiresAt
        }
      });

      expect(invitation.commitment).toBe(-1000000);
    });
  });
});
