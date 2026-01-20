/**
 * Distributions Routes
 *
 * Handles creation, waterfall calculation, and payment of distributions to LPs.
 * GP creates distributions → calculates waterfall → approves → LPs view and receive.
 */

import { getPrisma } from "../db.js";
import { extractAuthUser } from "./auth.js";
import { readStore } from "../store.js";
import crypto from "node:crypto";
import { createDealEvent, createDistributionSnapshot } from "../services/audit-service.js";
import { calculateWaterfall, groupLPsByClassPriority } from "../services/waterfall-calculator.js";
import { generateDistributionStatements } from "../services/document-generator.js";

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(JSON.stringify(payload));
}

function sendError(res, status, message, details) {
  sendJson(res, status, { message, details: details ?? null });
}

/**
 * Require GP or Admin role for GP-only endpoints
 * Returns the authenticated user or null (and sends error response)
 */
async function requireGP(req, res) {
  const user = await extractAuthUser(req);
  if (!user) {
    sendError(res, 401, "Not authenticated");
    return null;
  }
  if (!['GP', 'Admin'].includes(user.role)) {
    sendError(res, 403, "GP or Admin role required");
    return null;
  }
  if (user.status !== 'ACTIVE') {
    sendError(res, 403, "Account not active");
    return null;
  }
  return user;
}

/**
 * Check organization isolation for a deal
 * Returns authUser if access granted, null if denied (response already sent)
 */
async function requireDealOrgAccess(req, res, dealId) {
  const authUser = await extractAuthUser(req);
  if (!authUser) {
    sendError(res, 401, "Not authenticated");
    return null;
  }

  const store = await readStore();
  const record = store.dealIndex.find((item) => item.id === dealId);

  if (!record) {
    sendError(res, 404, "Deal not found");
    return null;
  }

  // Enforce org isolation
  if (record.organizationId && record.organizationId !== authUser.organizationId) {
    sendError(res, 403, "Access denied - deal belongs to different organization");
    return null;
  }

  return authUser;
}

/**
 * List distributions for a deal
 * GET /api/deals/:dealId/distributions
 */
export async function handleListDistributions(req, res, dealId) {
  // Organization isolation check
  const authUser = await requireDealOrgAccess(req, res, dealId);
  if (!authUser) return;

  const prisma = getPrisma();

  const distributions = await prisma.distribution.findMany({
    where: { dealId },
    orderBy: { distributionDate: 'desc' },
    include: {
      allocations: true
    }
  });

  // Calculate summary stats
  const totalDistributed = distributions
    .filter(d => d.status === 'PAID')
    .reduce((sum, d) => sum + d.totalAmount, 0);

  sendJson(res, 200, {
    distributions: distributions.map(d => ({
      id: d.id,
      dealId: d.dealId,
      title: d.title,
      description: d.description,
      totalAmount: d.totalAmount,
      distributionDate: d.distributionDate?.toISOString(),
      period: d.period,
      type: d.type,
      status: d.status,
      approvedAt: d.approvedAt?.toISOString(),
      createdAt: d.createdAt.toISOString(),
      allocationCount: d.allocations.length,
      paidCount: d.allocations.filter(a => a.status === 'PAID').length,
      totalPaid: d.allocations.filter(a => a.status === 'PAID').reduce((sum, a) => sum + a.netAmount, 0)
    })),
    summary: {
      totalDistributed,
      pendingDistributions: distributions.filter(d => d.status !== 'PAID' && d.status !== 'CANCELLED').length,
      distributionCount: distributions.filter(d => d.status === 'PAID').length
    }
  });
}

/**
 * Get single distribution with allocations
 * GET /api/deals/:dealId/distributions/:distributionId
 */
export async function handleGetDistribution(req, res, dealId, distributionId) {
  // Organization isolation check
  const authUser = await requireDealOrgAccess(req, res, dealId);
  if (!authUser) return;

  const prisma = getPrisma();

  const distribution = await prisma.distribution.findFirst({
    where: { id: distributionId, dealId },
    include: {
      allocations: true
    }
  });

  if (!distribution) {
    return sendError(res, 404, "Distribution not found");
  }

  // Get LP actor details for each allocation (including share class)
  const allocationsWithLP = await Promise.all(
    distribution.allocations.map(async (alloc) => {
      const lpActor = await prisma.lPActor.findUnique({
        where: { id: alloc.lpActorId },
        select: {
          id: true,
          entityName: true,
          email: true,
          commitment: true,
          ownershipPct: true,
          shareClass: { select: { id: true, code: true, name: true } }
        }
      });
      return {
        id: alloc.id,
        lpActorId: alloc.lpActorId,
        lpEntityName: lpActor?.entityName || 'Unknown',
        lpEmail: lpActor?.email || '',
        shareClass: lpActor?.shareClass || null,  // NEW: Include share class info
        grossAmount: alloc.grossAmount,
        withholdingAmount: alloc.withholdingAmount,
        netAmount: alloc.netAmount,
        paymentMethod: alloc.paymentMethod,
        status: alloc.status,
        paidAt: alloc.paidAt?.toISOString(),
        confirmationRef: alloc.confirmationRef
      };
    })
  );

  sendJson(res, 200, {
    distribution: {
      id: distribution.id,
      dealId: distribution.dealId,
      title: distribution.title,
      description: distribution.description,
      totalAmount: distribution.totalAmount,
      distributionDate: distribution.distributionDate?.toISOString(),
      period: distribution.period,
      type: distribution.type,
      status: distribution.status,
      approvedAt: distribution.approvedAt?.toISOString(),
      approvedBy: distribution.approvedBy,
      approvedByName: distribution.approvedByName,
      waterfallCalcId: distribution.waterfallCalcId,
      documentId: distribution.documentId,
      createdBy: distribution.createdBy,
      createdByName: distribution.createdByName,
      createdAt: distribution.createdAt.toISOString(),
      updatedAt: distribution.updatedAt.toISOString(),
      allocations: allocationsWithLP
    }
  });
}

/**
 * Create a distribution (GP only)
 * POST /api/deals/:dealId/distributions
 * Body: { title, description?, totalAmount, distributionDate, period?, type, useWaterfall?: boolean }
 *
 * Allocation Methods:
 * 1. useWaterfall=true + WaterfallStructure exists: Uses full waterfall calculation with share class terms
 * 2. useWaterfall=false OR no WaterfallStructure: Pro-rata allocation based on ownership percentage
 *
 * For waterfall mode:
 * - Respects share class preferredReturn (different pref rates per class)
 * - Respects share class priority (senior classes paid before junior)
 * - Integrates with underwriting cash flow projections when available
 */
export async function handleCreateDistribution(req, res, dealId, readJsonBody, userId, userName) {
  const authUser = await requireGP(req, res);
  if (!authUser) return;

  const body = await readJsonBody(req);

  if (!body?.title || !body?.totalAmount || !body?.distributionDate) {
    return sendError(res, 400, "title, totalAmount, and distributionDate are required");
  }

  const prisma = getPrisma();

  // Verify deal exists
  const deal = await prisma.deal.findUnique({ where: { id: dealId } });
  if (!deal) {
    return sendError(res, 404, "Deal not found");
  }

  // Get all active LPs for this deal with full share class info for waterfall calculations
  const lpActors = await prisma.lPActor.findMany({
    where: { dealId, status: 'ACTIVE' },
    include: {
      shareClass: {
        select: {
          id: true,
          code: true,
          name: true,
          preferredReturn: true,
          managementFee: true,
          carryPercent: true,
          priority: true
        }
      }
    }
  });

  if (lpActors.length === 0) {
    return sendError(res, 400, "No active LPs found for this deal");
  }

  // Log share class breakdown
  const classCounts = {};
  lpActors.forEach(lp => {
    const code = lp.shareClass?.code || 'NONE';
    classCounts[code] = (classCounts[code] || 0) + 1;
  });
  console.log(`[Distributions] Creating distribution for deal ${dealId}, LP breakdown by class:`, JSON.stringify(classCounts));

  // Check if waterfall mode is requested and waterfall structure exists
  let waterfallMode = false;
  let waterfallStructure = null;
  let waterfallResult = null;
  let perClassBreakdown = null;

  if (body.useWaterfall) {
    waterfallStructure = await prisma.waterfallStructure.findUnique({ where: { dealId } });
    if (waterfallStructure) {
      waterfallMode = true;
      console.log(`[Distributions] Waterfall mode config`, {
        dealId,
        usePerClassWaterfall: waterfallStructure.usePerClassWaterfall,
        gpCatchUp: waterfallStructure.gpCatchUp,
        preferredReturn: waterfallStructure.preferredReturn,
        lookback: waterfallStructure.lookback
      });
    } else {
      console.log(`[Distributions] Waterfall requested but no WaterfallStructure found, falling back to pro-rata`);
    }
  }

  // Calculate allocations
  let lpAllocations = [];

  if (waterfallMode && waterfallStructure) {
    // ==========================================================================
    // WATERFALL-BASED ALLOCATION
    // Uses the waterfall calculator with per-class terms
    // ==========================================================================
    console.log(`[Distributions] Using waterfall-based allocation with per-class terms`);

    // Transform LP actors to format expected by groupLPsByClassPriority
    const lpOwnership = lpActors.map(lp => ({
      lpActorId: lp.id,
      entityName: lp.entityName,
      ownershipPct: lp.ownershipPct || 0,
      commitment: lp.commitment || 0,
      capitalContributed: lp.capitalContributed || 0,
      capitalRemaining: lp.capitalRemaining || 0,
      shareClass: lp.shareClass
    }));

    // Group LPs by class priority
    const perClassConfig = groupLPsByClassPriority(lpOwnership);

    // Parse waterfall structure
    let promoteTiers;
    try {
      promoteTiers = typeof waterfallStructure.promoteTiers === 'string'
        ? JSON.parse(waterfallStructure.promoteTiers)
        : waterfallStructure.promoteTiers;
    } catch {
      promoteTiers = [{ hurdle: Infinity, lpSplit: 0.80, gpSplit: 0.20 }];
    }

    const structure = {
      lpEquity: waterfallStructure.lpEquity,
      gpEquity: waterfallStructure.gpEquity,
      preferredReturn: waterfallStructure.preferredReturn,
      promoteTiers,
      gpCatchUp: waterfallStructure.gpCatchUp,
      catchUpPercent: waterfallStructure.catchUpPercent || 1.0,
      lookback: waterfallStructure.lookback || false
    };

    // Check feature flag and class configuration
    const perClassFlagEnabled = waterfallStructure.usePerClassWaterfall === true;
    const hasMultipleClasses = perClassConfig.size > 1;
    const hasDifferentTerms = Array.from(perClassConfig.values())
      .some(c => c.class.preferredReturn !== null && c.class.preferredReturn !== undefined);

    console.log(`[Distributions] Per-class decision`, {
      dealId,
      perClassFlagEnabled,
      hasMultipleClasses,
      hasDifferentTerms,
      classCount: perClassConfig.size
    });

    // For single distribution, use the amount as the only cash flow
    // (In a more complete implementation, this would integrate with historical cash flows)
    const cashFlows = [body.totalAmount];

    let waterfallOptions = {};
    if (perClassFlagEnabled && (hasMultipleClasses || hasDifferentTerms)) {
      waterfallOptions = {
        useClassTerms: true,
        perClassConfig
      };
      console.log(`[Distributions] USING per-class waterfall`, {
        dealId,
        classCodes: Array.from(perClassConfig.values()).map(c => c.class.code)
      });
    } else if (hasMultipleClasses && !perClassFlagEnabled) {
      console.log(`[Distributions] SKIPPING per-class (flag disabled), using standard waterfall`, { dealId });
    } else {
      console.log(`[Distributions] Using standard waterfall (single class or no class terms)`, { dealId });
    }

    // Calculate waterfall distribution
    waterfallResult = calculateWaterfall(cashFlows, structure, waterfallOptions);

    if (waterfallResult.error) {
      console.error(`[Distributions] Waterfall calculation failed:`, waterfallResult.error);
      // Fall back to pro-rata if waterfall fails
      waterfallMode = false;
    } else {
      // Extract per-class breakdown if available
      perClassBreakdown = waterfallResult.byClass;

      // Calculate LP allocations from waterfall result
      // The waterfall gives us total LP return, we need to allocate to individual LPs
      const totalLPReturn = waterfallResult.summary.lpTotalReturn;

      // If per-class breakdown available, allocate based on class totals
      if (perClassBreakdown) {
        console.log(`[Distributions] Allocating based on per-class waterfall results`);

        for (const lp of lpActors) {
          const classCode = lp.shareClass?.code || 'NONE';
          const classData = perClassBreakdown[classCode];

          if (classData) {
            // Find this LP's share within their class
            const classConfig = Array.from(perClassConfig.values())
              .find(c => c.class.code === classCode);

            const classOwnership = classConfig?.totalOwnership || 0;
            const lpOwnershipInClass = lp.ownershipPct || 0;
            const lpShareOfClass = classOwnership > 0 ? lpOwnershipInClass / classOwnership : 0;

            // LP gets their proportional share of class total
            const grossAmount = Math.round(classData.totalDistributed * lpShareOfClass * 100) / 100;

            lpAllocations.push({
              lpActorId: lp.id,
              shareClassCode: classCode,
              grossAmount,
              withholdingAmount: 0,
              netAmount: grossAmount,
              allocationMethod: 'WATERFALL_PER_CLASS',
              classEquityMultiple: classData.equityMultiple
            });
          } else {
            // Fallback: pro-rata within unclassified LPs
            const totalOwnership = lpActors.reduce((sum, l) => sum + (l.ownershipPct || 0), 0);
            const ownershipShare = totalOwnership > 0 ? (lp.ownershipPct || 0) / totalOwnership : 1 / lpActors.length;
            const grossAmount = Math.round(totalLPReturn * ownershipShare * 100) / 100;

            lpAllocations.push({
              lpActorId: lp.id,
              shareClassCode: classCode,
              grossAmount,
              withholdingAmount: 0,
              netAmount: grossAmount,
              allocationMethod: 'WATERFALL_PRO_RATA'
            });
          }
        }
      } else {
        // Standard waterfall without per-class: distribute LP total pro-rata
        console.log(`[Distributions] Allocating LP total pro-rata (no per-class breakdown)`);

        const totalOwnership = lpActors.reduce((sum, lp) => sum + (lp.ownershipPct || 0), 0);
        for (const lp of lpActors) {
          const ownershipShare = totalOwnership > 0 ? (lp.ownershipPct || 0) / totalOwnership : 1 / lpActors.length;
          const grossAmount = Math.round(totalLPReturn * ownershipShare * 100) / 100;

          lpAllocations.push({
            lpActorId: lp.id,
            shareClassCode: lp.shareClass?.code || 'NONE',
            grossAmount,
            withholdingAmount: 0,
            netAmount: grossAmount,
            allocationMethod: 'WATERFALL_PRO_RATA'
          });
        }
      }

      console.log(`[Distributions] Waterfall calculation complete:`, {
        lpTotalReturn: waterfallResult.summary.lpTotalReturn,
        gpTotalReturn: waterfallResult.summary.gpTotalReturn,
        lpIRR: waterfallResult.summary.lpIRR,
        hasPerClassBreakdown: !!perClassBreakdown
      });
    }
  }

  if (!waterfallMode || lpAllocations.length === 0) {
    // ==========================================================================
    // PRO-RATA ALLOCATION (fallback)
    // Simple ownership-based allocation
    // ==========================================================================
    console.log(`[Distributions] Using pro-rata allocation based on ownership`);

    const totalOwnership = lpActors.reduce((sum, lp) => sum + (lp.ownershipPct || 0), 0);

    for (const lp of lpActors) {
      const ownershipShare = totalOwnership > 0 ? (lp.ownershipPct || 0) / totalOwnership : 1 / lpActors.length;
      const grossAmount = Math.round(body.totalAmount * ownershipShare * 100) / 100;

      lpAllocations.push({
        lpActorId: lp.id,
        shareClassCode: lp.shareClass?.code || 'NONE',
        grossAmount,
        withholdingAmount: 0,
        netAmount: grossAmount,
        allocationMethod: 'PRO_RATA'
      });
    }
  }

  // Ensure allocations sum to totalAmount (adjust for rounding)
  const allocatedTotal = lpAllocations.reduce((sum, a) => sum + a.grossAmount, 0);
  const roundingDiff = Math.round((body.totalAmount - allocatedTotal) * 100) / 100;
  if (Math.abs(roundingDiff) > 0.001 && lpAllocations.length > 0) {
    // Add rounding difference to largest allocation
    const largest = lpAllocations.reduce((max, a) => a.grossAmount > max.grossAmount ? a : max, lpAllocations[0]);
    largest.grossAmount = Math.round((largest.grossAmount + roundingDiff) * 100) / 100;
    largest.netAmount = largest.grossAmount - largest.withholdingAmount;
    console.log(`[Distributions] Rounding adjustment: ${roundingDiff} added to LP ${largest.lpActorId}`);
  }

  // Create distribution record
  const distribution = await prisma.distribution.create({
    data: {
      id: crypto.randomUUID(),
      dealId,
      title: body.title,
      description: body.description || null,
      totalAmount: body.totalAmount,
      distributionDate: new Date(body.distributionDate),
      period: body.period || null,
      type: body.type || 'CASH_DISTRIBUTION',
      status: 'DRAFT',
      createdBy: userId,
      createdByName: userName || 'Unknown'
    }
  });

  // Create allocations in database
  const allocations = await Promise.all(
    lpAllocations.map(async (alloc) => {
      return prisma.distributionAllocation.create({
        data: {
          id: crypto.randomUUID(),
          distributionId: distribution.id,
          lpActorId: alloc.lpActorId,
          grossAmount: alloc.grossAmount,
          withholdingAmount: alloc.withholdingAmount,
          netAmount: alloc.netAmount,
          paymentMethod: 'WIRE',
          status: 'PENDING'
        }
      });
    })
  );

  // Create snapshot of cap table AND waterfall rules for reproducibility
  const snapshot = await createDistributionSnapshot(
    dealId,
    `Distribution: ${body.title}`,
    { id: userId, name: userName }
  );

  // Update distribution with snapshotId
  await prisma.distribution.update({
    where: { id: distribution.id },
    data: { snapshotId: snapshot.id }
  });

  // Record audit event with allocation method details
  await createDealEvent(dealId, 'DISTRIBUTION_CREATED', {
    distributionId: distribution.id,
    title: distribution.title,
    totalAmount: distribution.totalAmount,
    distributionDate: distribution.distributionDate.toISOString(),
    type: distribution.type,
    snapshotId: snapshot.id,
    allocationMethod: waterfallMode ? 'WATERFALL' : 'PRO_RATA',
    waterfallSummary: waterfallMode && waterfallResult ? {
      lpTotalReturn: waterfallResult.summary.lpTotalReturn,
      gpTotalReturn: waterfallResult.summary.gpTotalReturn,
      lpIRR: waterfallResult.summary.lpIRR,
      hasPerClassBreakdown: !!perClassBreakdown
    } : null,
    allocationCount: allocations.length,
    allocations: lpAllocations.map(a => ({
      lpActorId: a.lpActorId,
      shareClassCode: a.shareClassCode,
      grossAmount: a.grossAmount,
      netAmount: a.netAmount,
      allocationMethod: a.allocationMethod
    }))
  }, { id: userId, name: userName, role: 'GP' });

  console.log(`[Distributions] Created distribution ${distribution.id} for deal ${dealId} with ${allocations.length} allocations (method: ${waterfallMode ? 'WATERFALL' : 'PRO_RATA'}, snapshot: ${snapshot.id})`);

  // Build response
  const response = {
    distribution: {
      id: distribution.id,
      dealId: distribution.dealId,
      title: distribution.title,
      totalAmount: distribution.totalAmount,
      distributionDate: distribution.distributionDate.toISOString(),
      status: distribution.status,
      allocationCount: allocations.length,
      allocationMethod: waterfallMode ? 'WATERFALL' : 'PRO_RATA',
      snapshotId: snapshot.id
    }
  };

  // Include per-class breakdown if available
  if (perClassBreakdown) {
    response.byClass = perClassBreakdown;
  }

  // Include waterfall summary if used
  if (waterfallResult) {
    response.waterfallSummary = {
      lpTotalReturn: waterfallResult.summary.lpTotalReturn,
      gpTotalReturn: waterfallResult.summary.gpTotalReturn,
      lpIRR: waterfallResult.summary.lpIRR,
      lpEquityMultiple: waterfallResult.summary.lpEquityMultiple
    };
  }

  sendJson(res, 201, response);
}

/**
 * Approve a distribution for payment (GP only)
 * POST /api/deals/:dealId/distributions/:distributionId/approve
 */
export async function handleApproveDistribution(req, res, dealId, distributionId, userId, userName) {
  const authUser = await requireGP(req, res);
  if (!authUser) return;

  const prisma = getPrisma();

  const distribution = await prisma.distribution.findFirst({
    where: { id: distributionId, dealId }
  });

  if (!distribution) {
    return sendError(res, 404, "Distribution not found");
  }

  if (distribution.status !== 'DRAFT') {
    return sendError(res, 400, `Cannot approve distribution with status ${distribution.status}`);
  }

  // Prevent self-approval: creator cannot approve their own distribution
  if (distribution.createdBy === authUser.id) {
    return sendError(res, 403, "Cannot approve your own distribution - requires another GP/Admin to approve");
  }

  const updated = await prisma.distribution.update({
    where: { id: distributionId },
    data: {
      status: 'APPROVED',
      approvedAt: new Date(),
      approvedBy: authUser.id,
      approvedByName: authUser.name || 'Unknown'
    }
  });

  // Create approval record for audit trail
  await prisma.approvalRecord.create({
    data: {
      dealId,
      approvalType: 'DISTRIBUTION_APPROVAL',
      approverId: authUser.id,
      approverName: authUser.name || 'Unknown',
      approverRole: authUser.role,
      approverEmail: authUser.email,
      decision: 'APPROVED',
      notes: `Distribution "${distribution.title}" approved for ${distribution.totalAmount}`,
      captureMethod: 'UI'
    }
  });

  console.log(`[Distributions] Approved distribution ${distributionId} by ${authUser.name}`);

  sendJson(res, 200, {
    distribution: {
      id: updated.id,
      status: updated.status,
      approvedAt: updated.approvedAt.toISOString()
    }
  });
}

/**
 * Start processing distribution payments
 * POST /api/deals/:dealId/distributions/:distributionId/process
 */
export async function handleProcessDistribution(req, res, dealId, distributionId) {
  const authUser = await requireGP(req, res);
  if (!authUser) return;

  const prisma = getPrisma();

  const distribution = await prisma.distribution.findFirst({
    where: { id: distributionId, dealId }
  });

  if (!distribution) {
    return sendError(res, 404, "Distribution not found");
  }

  if (distribution.status !== 'APPROVED') {
    return sendError(res, 400, "Distribution must be approved before processing");
  }

  // Verify approval record exists (double-check for audit trail integrity)
  const approvalRecord = await prisma.approvalRecord.findFirst({
    where: {
      dealId,
      approvalType: 'DISTRIBUTION_APPROVAL',
      decision: 'APPROVED'
    },
    orderBy: { createdAt: 'desc' }
  });

  if (!approvalRecord) {
    return sendError(res, 403, "Distribution must have a valid approval record before processing");
  }

  // Verify approver is not the creator (belt-and-suspenders check)
  if (approvalRecord.approverId === distribution.createdBy) {
    return sendError(res, 403, "Invalid approval - same person cannot create and approve distribution");
  }

  const updated = await prisma.distribution.update({
    where: { id: distributionId },
    data: { status: 'PROCESSING' }
  });

  // Update all allocations to PROCESSING
  const allAllocations = await prisma.distributionAllocation.findMany({
    where: { distributionId }
  });

  await prisma.distributionAllocation.updateMany({
    where: { distributionId },
    data: { status: 'PROCESSING' }
  });

  // Record audit event
  await createDealEvent(dealId, 'DISTRIBUTION_PROCESSING_STARTED', {
    distributionId,
    title: distribution.title,
    totalAmount: distribution.totalAmount,
    allocationCount: allAllocations.length,
    processedBy: authUser.id,
    processedByName: authUser.name
  }, { id: authUser.id, name: authUser.name, role: authUser.role });

  console.log(`[Distributions] Started processing distribution ${distributionId}`);

  sendJson(res, 200, {
    distribution: {
      id: updated.id,
      status: updated.status
    }
  });
}

/**
 * Mark allocation as paid (GP only)
 * POST /api/deals/:dealId/distributions/:distributionId/allocations/:allocationId/mark-paid
 * Body: { confirmationRef? }
 */
export async function handleMarkDistributionPaid(req, res, dealId, distributionId, allocationId, readJsonBody) {
  const authUser = await requireGP(req, res);
  if (!authUser) return;

  const body = await readJsonBody(req);
  const prisma = getPrisma();

  const allocation = await prisma.distributionAllocation.findFirst({
    where: { id: allocationId, distributionId }
  });

  if (!allocation) {
    return sendError(res, 404, "Allocation not found");
  }

  // Update allocation
  const updated = await prisma.distributionAllocation.update({
    where: { id: allocationId },
    data: {
      status: 'PAID',
      paidAt: new Date(),
      confirmationRef: body?.confirmationRef || null
    }
  });

  // Check if all allocations are paid
  const allAllocations = await prisma.distributionAllocation.findMany({
    where: { distributionId }
  });

  const allPaid = allAllocations.every(a => a.status === 'PAID');

  // Update distribution status if all paid
  if (allPaid) {
    await prisma.distribution.update({
      where: { id: distributionId },
      data: { status: 'PAID' }
    });
  }

  // SECURITY: V7 - Audit log for financial operation
  await prisma.permissionAuditLog.create({
    data: {
      actorId: authUser.id,
      actorName: authUser.name || null,
      action: 'DISTRIBUTION_MARKED_PAID',
      afterValue: JSON.stringify({
        dealId,
        distributionId,
        allocationId,
        paidAmount: allocation.amount,
        confirmationRef: body?.confirmationRef || null
      }),
      ipAddress: req.headers["x-forwarded-for"] || req.socket?.remoteAddress || null
    }
  });

  console.log(`[Distributions] Marked allocation ${allocationId} as paid`);

  sendJson(res, 200, {
    allocation: {
      id: updated.id,
      status: updated.status,
      paidAt: updated.paidAt.toISOString(),
      confirmationRef: updated.confirmationRef
    }
  });
}

/**
 * Cancel a distribution (GP only, draft/approved only)
 * POST /api/deals/:dealId/distributions/:distributionId/cancel
 */
export async function handleCancelDistribution(req, res, dealId, distributionId) {
  const authUser = await requireGP(req, res);
  if (!authUser) return;

  const prisma = getPrisma();

  const distribution = await prisma.distribution.findFirst({
    where: { id: distributionId, dealId }
  });

  if (!distribution) {
    return sendError(res, 404, "Distribution not found");
  }

  if (!['DRAFT', 'APPROVED'].includes(distribution.status)) {
    return sendError(res, 400, `Cannot cancel distribution with status ${distribution.status}`);
  }

  const previousStatus = distribution.status;

  const updated = await prisma.distribution.update({
    where: { id: distributionId },
    data: { status: 'CANCELLED' }
  });

  // Record audit event
  await createDealEvent(dealId, 'DISTRIBUTION_CANCELLED', {
    distributionId,
    title: distribution.title,
    totalAmount: distribution.totalAmount,
    previousStatus,
    cancelledBy: authUser.id,
    cancelledByName: authUser.name
  }, { id: authUser.id, name: authUser.name, role: authUser.role });

  console.log(`[Distributions] Cancelled distribution ${distributionId}`);

  sendJson(res, 200, {
    distribution: {
      id: updated.id,
      status: updated.status
    }
  });
}

// ========== LP-FACING ENDPOINTS ==========

/**
 * Get distributions for authenticated LP user
 * GET /api/lp/portal/my-investments/:dealId/distributions
 */
export async function handleGetMyDistributions(req, res, authUser, dealId) {
  if (!authUser) {
    return sendError(res, 401, "Authentication required");
  }

  if (authUser.role !== "LP") {
    return sendError(res, 403, "Only LP users can access this endpoint");
  }

  const prisma = getPrisma();

  // Find LP actor for this deal
  const lpActor = await prisma.lPActor.findFirst({
    where: {
      dealId,
      OR: [
        { authUserId: authUser.id },
        { email: authUser.email.toLowerCase() }
      ],
      status: 'ACTIVE'
    }
  });

  if (!lpActor) {
    return sendError(res, 404, "Investment not found or you don't have access");
  }

  // Get distributions with this LP's allocations
  const distributions = await prisma.distribution.findMany({
    where: {
      dealId,
      status: { in: ['APPROVED', 'PROCESSING', 'PAID'] }
    },
    orderBy: { distributionDate: 'desc' },
    include: {
      allocations: {
        where: { lpActorId: lpActor.id }
      }
    }
  });

  // Calculate totals
  const totalReceived = distributions.reduce((sum, d) => {
    const alloc = d.allocations[0];
    if (alloc?.status === 'PAID') {
      return sum + alloc.netAmount;
    }
    return sum;
  }, 0);

  sendJson(res, 200, {
    distributions: distributions.map(d => ({
      id: d.id,
      title: d.title,
      description: d.description,
      totalAmount: d.totalAmount,
      distributionDate: d.distributionDate?.toISOString(),
      period: d.period,
      type: d.type,
      status: d.status,
      myAllocation: d.allocations[0] ? {
        id: d.allocations[0].id,
        grossAmount: d.allocations[0].grossAmount,
        withholdingAmount: d.allocations[0].withholdingAmount,
        netAmount: d.allocations[0].netAmount,
        status: d.allocations[0].status,
        paidAt: d.allocations[0].paidAt?.toISOString(),
        confirmationRef: d.allocations[0].confirmationRef
      } : null
    })),
    summary: {
      totalReceived,
      pendingDistributions: distributions.filter(d =>
        d.allocations[0]?.status !== 'PAID' && d.allocations[0]?.status !== 'FAILED'
      ).length
    },
    lpActorId: lpActor.id
  });
}

/**
 * Get single distribution detail for LP
 * GET /api/lp/portal/my-investments/:dealId/distributions/:distributionId
 */
export async function handleGetMyDistributionDetail(req, res, authUser, dealId, distributionId) {
  if (!authUser) {
    return sendError(res, 401, "Authentication required");
  }

  if (authUser.role !== "LP") {
    return sendError(res, 403, "Only LP users can access this endpoint");
  }

  const prisma = getPrisma();

  // Find LP actor
  const lpActor = await prisma.lPActor.findFirst({
    where: {
      dealId,
      OR: [
        { authUserId: authUser.id },
        { email: authUser.email.toLowerCase() }
      ],
      status: 'ACTIVE'
    }
  });

  if (!lpActor) {
    return sendError(res, 404, "Investment not found or you don't have access");
  }

  // Get distribution with LP's allocation
  const distribution = await prisma.distribution.findFirst({
    where: { id: distributionId, dealId },
    include: {
      allocations: {
        where: { lpActorId: lpActor.id }
      }
    }
  });

  if (!distribution) {
    return sendError(res, 404, "Distribution not found");
  }

  if (!['APPROVED', 'PROCESSING', 'PAID'].includes(distribution.status)) {
    return sendError(res, 404, "Distribution not available");
  }

  sendJson(res, 200, {
    distribution: {
      id: distribution.id,
      title: distribution.title,
      description: distribution.description,
      totalAmount: distribution.totalAmount,
      distributionDate: distribution.distributionDate?.toISOString(),
      period: distribution.period,
      type: distribution.type,
      status: distribution.status,
      documentId: distribution.documentId
    },
    myAllocation: distribution.allocations[0] ? {
      id: distribution.allocations[0].id,
      grossAmount: distribution.allocations[0].grossAmount,
      withholdingAmount: distribution.allocations[0].withholdingAmount,
      netAmount: distribution.allocations[0].netAmount,
      paymentMethod: distribution.allocations[0].paymentMethod,
      status: distribution.allocations[0].status,
      paidAt: distribution.allocations[0].paidAt?.toISOString(),
      confirmationRef: distribution.allocations[0].confirmationRef
    } : null,
    lpActorId: lpActor.id
  });
}

/**
 * Get distribution type label
 */
export function getDistributionTypeLabel(type) {
  switch (type) {
    case 'CASH_DISTRIBUTION':
      return 'Cash Distribution';
    case 'RETURN_OF_CAPITAL':
      return 'Return of Capital';
    case 'TAX_DISTRIBUTION':
      return 'Tax Distribution';
    default:
      return type;
  }
}

/**
 * Generate distribution statements for all LPs in a distribution
 * POST /api/deals/:dealId/distributions/:distId/generate-statements
 * GP Only - Generates PDF statements for each LP allocation
 */
export async function handleGenerateDistributionStatements(req, res, dealId, distId, userId, userName) {
  console.log(`[Distributions] Generate statements request`, { dealId, distId, userId });

  // Auth is handled by route dispatch (requireGPWithDealAccess)
  const prisma = getPrisma();

  // Verify distribution exists and belongs to deal
  const distribution = await prisma.distribution.findUnique({
    where: { id: distId },
    include: {
      allocations: {
        include: { lpActor: true }
      }
    }
  });

  if (!distribution) {
    return sendError(res, 404, "Distribution not found");
  }

  if (distribution.dealId !== dealId) {
    return sendError(res, 400, "Distribution does not belong to this deal");
  }

  if (distribution.allocations.length === 0) {
    return sendError(res, 400, "No LP allocations found for this distribution");
  }

  console.log(`[Distributions] Generating statements for ${distribution.allocations.length} LPs`, { dealId, distId });

  try {
    const results = await generateDistributionStatements(
      dealId,
      distId,
      { id: userId, name: userName, role: 'GP' }
    );

    const successful = results.filter(r => !r.error);
    const failed = results.filter(r => r.error);

    // Record audit event
    await createDealEvent(dealId, 'DISTRIBUTION_STATEMENTS_GENERATED', {
      distributionId: distId,
      distributionTitle: distribution.title,
      totalCount: results.length,
      successCount: successful.length,
      failedCount: failed.length,
      generatedBy: userName
    }, { id: userId, name: userName, role: 'GP' });

    console.log(`[Distributions] Generated ${successful.length}/${results.length} statements`, { dealId, distId });

    sendJson(res, 200, {
      success: true,
      totalCount: results.length,
      successCount: successful.length,
      failedCount: failed.length,
      documents: successful.map(r => ({
        lpActorId: r.lpActorId,
        entityName: r.entityName,
        documentId: r.document?.generatedDocument?.id,
        versionId: r.document?.documentVersion?.id
      })),
      errors: failed.map(r => ({
        lpActorId: r.lpActorId,
        entityName: r.entityName,
        error: r.error
      }))
    });
  } catch (error) {
    console.error(`[Distributions] Failed to generate statements`, { dealId, distId, error: error.message });
    return sendError(res, 500, "Failed to generate statements", error.message);
  }
}
