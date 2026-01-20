/**
 * Accounting Periods Routes
 *
 * Implements GL close workflow with OPEN -> SOFT_CLOSE -> HARD_CLOSE states.
 * Provides period-based isolation for financial records to ensure audit compliance.
 */

import { getPrisma } from "../db.js";
import { extractAuthUser } from "./auth.js";
import { createDealEvent, createDistributionSnapshot } from "../services/audit-service.js";

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
 * Require GP or Admin role for period management
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
 * List accounting periods for a deal
 * GET /api/deals/:dealId/accounting-periods
 */
export async function handleListAccountingPeriods(req, res, dealId) {
  const authUser = await extractAuthUser(req);
  if (!authUser) {
    return sendError(res, 401, "Not authenticated");
  }

  const prisma = getPrisma();

  const periods = await prisma.accountingPeriod.findMany({
    where: { dealId },
    orderBy: [{ year: 'desc' }, { quarter: 'desc' }]
  });

  sendJson(res, 200, { periods });
}

/**
 * Get a specific accounting period
 * GET /api/deals/:dealId/accounting-periods/:periodId
 */
export async function handleGetAccountingPeriod(req, res, dealId, periodId) {
  const authUser = await extractAuthUser(req);
  if (!authUser) {
    return sendError(res, 401, "Not authenticated");
  }

  const prisma = getPrisma();

  const period = await prisma.accountingPeriod.findFirst({
    where: { id: periodId, dealId }
  });

  if (!period) {
    return sendError(res, 404, "Accounting period not found");
  }

  sendJson(res, 200, { period });
}

/**
 * Create a new accounting period
 * POST /api/deals/:dealId/accounting-periods
 * Body: { year: number, quarter: number (0-4), notes?: string }
 */
export async function handleCreateAccountingPeriod(req, res, dealId, readJsonBody) {
  const authUser = await requireGP(req, res);
  if (!authUser) return;

  const body = await readJsonBody(req);

  if (!body?.year || body?.quarter === undefined) {
    return sendError(res, 400, "year and quarter are required");
  }

  if (body.quarter < 0 || body.quarter > 4) {
    return sendError(res, 400, "quarter must be 0 (annual) or 1-4 (quarterly)");
  }

  const prisma = getPrisma();

  // Check for existing period
  const existing = await prisma.accountingPeriod.findFirst({
    where: { dealId, year: body.year, quarter: body.quarter }
  });

  if (existing) {
    return sendError(res, 409, `Accounting period ${body.year} Q${body.quarter} already exists`);
  }

  // Calculate period boundaries
  const startDate = body.quarter === 0
    ? new Date(body.year, 0, 1)
    : new Date(body.year, (body.quarter - 1) * 3, 1);

  const endDate = body.quarter === 0
    ? new Date(body.year, 11, 31, 23, 59, 59)
    : new Date(body.year, body.quarter * 3, 0, 23, 59, 59);

  const period = await prisma.accountingPeriod.create({
    data: {
      dealId,
      year: body.year,
      quarter: body.quarter,
      periodType: body.quarter === 0 ? 'ANNUAL' : 'QUARTERLY',
      startDate,
      endDate,
      status: 'OPEN',
      notes: body.notes || null
    }
  });

  await createDealEvent(dealId, 'ACCOUNTING_PERIOD_CREATED', {
    periodId: period.id,
    year: period.year,
    quarter: period.quarter,
    periodType: period.periodType,
    startDate: period.startDate.toISOString(),
    endDate: period.endDate.toISOString()
  }, { id: authUser.id, name: authUser.name, role: authUser.role });

  sendJson(res, 201, { period });
}

/**
 * Soft close an accounting period (preliminary close, allows corrections with review)
 * POST /api/deals/:dealId/accounting-periods/:periodId/soft-close
 */
export async function handleSoftClosePeriod(req, res, dealId, periodId) {
  const authUser = await requireGP(req, res);
  if (!authUser) return;

  const prisma = getPrisma();

  const period = await prisma.accountingPeriod.findFirst({
    where: { id: periodId, dealId }
  });

  if (!period) {
    return sendError(res, 404, "Accounting period not found");
  }

  if (period.status !== 'OPEN') {
    return sendError(res, 400, `Cannot soft-close period with status ${period.status}`);
  }

  const updated = await prisma.accountingPeriod.update({
    where: { id: periodId },
    data: {
      status: 'SOFT_CLOSE',
      softClosedAt: new Date(),
      softClosedBy: authUser.id,
      softClosedByName: authUser.name
    }
  });

  await createDealEvent(dealId, 'ACCOUNTING_PERIOD_SOFT_CLOSED', {
    periodId: period.id,
    year: period.year,
    quarter: period.quarter,
    closedBy: authUser.id,
    closedByName: authUser.name
  }, { id: authUser.id, name: authUser.name, role: authUser.role });

  sendJson(res, 200, { period: updated });
}

/**
 * Hard close an accounting period (final close, creates snapshot, prevents changes)
 * POST /api/deals/:dealId/accounting-periods/:periodId/hard-close
 */
export async function handleHardClosePeriod(req, res, dealId, periodId) {
  const authUser = await requireGP(req, res);
  if (!authUser) return;

  const prisma = getPrisma();

  const period = await prisma.accountingPeriod.findFirst({
    where: { id: periodId, dealId }
  });

  if (!period) {
    return sendError(res, 404, "Accounting period not found");
  }

  if (period.status === 'HARD_CLOSE') {
    return sendError(res, 400, "Period is already hard-closed");
  }

  // Create final snapshot at close
  const snapshot = await createDistributionSnapshot(
    dealId,
    `Period Close: ${period.year} Q${period.quarter}`,
    { id: authUser.id, name: authUser.name }
  );

  const updated = await prisma.accountingPeriod.update({
    where: { id: periodId },
    data: {
      status: 'HARD_CLOSE',
      hardClosedAt: new Date(),
      hardClosedBy: authUser.id,
      hardClosedByName: authUser.name,
      closeSnapshotId: snapshot.id
    }
  });

  await createDealEvent(dealId, 'ACCOUNTING_PERIOD_HARD_CLOSED', {
    periodId: period.id,
    year: period.year,
    quarter: period.quarter,
    closedBy: authUser.id,
    closedByName: authUser.name,
    snapshotId: snapshot.id
  }, { id: authUser.id, name: authUser.name, role: authUser.role });

  sendJson(res, 200, { period: updated, snapshotId: snapshot.id });
}

/**
 * Reopen a soft-closed period (not hard-closed)
 * POST /api/deals/:dealId/accounting-periods/:periodId/reopen
 * Body: { reason?: string }
 */
export async function handleReopenPeriod(req, res, dealId, periodId, readJsonBody) {
  const authUser = await requireGP(req, res);
  if (!authUser) return;

  const body = await readJsonBody(req);
  const prisma = getPrisma();

  const period = await prisma.accountingPeriod.findFirst({
    where: { id: periodId, dealId }
  });

  if (!period) {
    return sendError(res, 404, "Accounting period not found");
  }

  if (period.status === 'HARD_CLOSE') {
    return sendError(res, 400, "Cannot reopen hard-closed period - this requires admin override");
  }

  if (period.status === 'OPEN') {
    return sendError(res, 400, "Period is already open");
  }

  const updated = await prisma.accountingPeriod.update({
    where: { id: periodId },
    data: {
      status: 'OPEN',
      softClosedAt: null,
      softClosedBy: null,
      softClosedByName: null
    }
  });

  await createDealEvent(dealId, 'ACCOUNTING_PERIOD_REOPENED', {
    periodId: period.id,
    year: period.year,
    quarter: period.quarter,
    reopenedBy: authUser.id,
    reopenedByName: authUser.name,
    reason: body?.reason || 'No reason provided'
  }, { id: authUser.id, name: authUser.name, role: authUser.role });

  sendJson(res, 200, { period: updated });
}
