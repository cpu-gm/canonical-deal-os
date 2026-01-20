/**
 * Period Guard Service
 *
 * Provides validation middleware for accounting period close status.
 * Prevents modifications to financial records in closed periods.
 */

import { getPrisma } from "../db.js";

/**
 * Check if a transaction date falls within a closed accounting period.
 *
 * @param {string} dealId - UUID of the deal
 * @param {Date|string} transactionDate - Date of the transaction to check
 * @returns {Promise<object>} { allowed: boolean, warning?: string, reason?: string, periodId?: string }
 */
export async function checkPeriodOpen(dealId, transactionDate) {
  const prisma = getPrisma();
  const txDate = new Date(transactionDate);

  // Find the accounting period this date falls into
  const period = await prisma.accountingPeriod.findFirst({
    where: {
      dealId,
      startDate: { lte: txDate },
      endDate: { gte: txDate }
    }
  });

  if (!period) {
    // No period defined for this date - allow by default
    return { allowed: true };
  }

  if (period.status === 'HARD_CLOSE') {
    return {
      allowed: false,
      reason: `Period ${period.year} Q${period.quarter} is hard-closed. No changes allowed.`,
      periodId: period.id,
      periodStatus: period.status
    };
  }

  if (period.status === 'SOFT_CLOSE') {
    return {
      allowed: true,
      warning: `Period ${period.year} Q${period.quarter} is soft-closed. Changes will be flagged for review.`,
      periodId: period.id,
      periodStatus: period.status
    };
  }

  return {
    allowed: true,
    periodId: period.id,
    periodStatus: period.status
  };
}

/**
 * Get the current open period for a deal (if any).
 *
 * @param {string} dealId - UUID of the deal
 * @param {Date|string} date - Date to find period for (defaults to now)
 * @returns {Promise<object|null>} The matching period or null
 */
export async function getCurrentPeriod(dealId, date = new Date()) {
  const prisma = getPrisma();
  const txDate = new Date(date);

  return prisma.accountingPeriod.findFirst({
    where: {
      dealId,
      startDate: { lte: txDate },
      endDate: { gte: txDate }
    }
  });
}

/**
 * Validate a financial operation against period close status.
 *
 * Use this in route handlers before allowing financial mutations:
 * - Distribution creation/modification
 * - Capital call creation/modification
 * - Payment processing
 *
 * @param {string} dealId - UUID of the deal
 * @param {Date|string} transactionDate - Date of the transaction
 * @param {string} operationType - Description of the operation for error messages
 * @returns {Promise<object>} { blocked: boolean, status?: number, message?: string, warning?: string, periodId?: string }
 */
export async function validatePeriodForOperation(dealId, transactionDate, operationType) {
  const check = await checkPeriodOpen(dealId, transactionDate);

  if (!check.allowed) {
    return {
      blocked: true,
      status: 403,
      message: `Cannot ${operationType}: ${check.reason}`,
      periodId: check.periodId
    };
  }

  return {
    blocked: false,
    warning: check.warning,
    periodId: check.periodId,
    periodStatus: check.periodStatus
  };
}

/**
 * Get all distributions in a specific accounting period.
 *
 * @param {string} dealId - UUID of the deal
 * @param {string} periodId - UUID of the accounting period
 * @returns {Promise<Array>} Array of distributions in the period
 */
export async function getDistributionsInPeriod(dealId, periodId) {
  const prisma = getPrisma();

  const period = await prisma.accountingPeriod.findUnique({
    where: { id: periodId }
  });

  if (!period) {
    return [];
  }

  return prisma.distribution.findMany({
    where: {
      dealId,
      distributionDate: {
        gte: period.startDate,
        lte: period.endDate
      }
    },
    include: {
      allocations: true
    },
    orderBy: { distributionDate: 'asc' }
  });
}

/**
 * Get all capital calls in a specific accounting period.
 *
 * @param {string} dealId - UUID of the deal
 * @param {string} periodId - UUID of the accounting period
 * @returns {Promise<Array>} Array of capital calls in the period
 */
export async function getCapitalCallsInPeriod(dealId, periodId) {
  const prisma = getPrisma();

  const period = await prisma.accountingPeriod.findUnique({
    where: { id: periodId }
  });

  if (!period) {
    return [];
  }

  return prisma.capitalCall.findMany({
    where: {
      dealId,
      dueDate: {
        gte: period.startDate,
        lte: period.endDate
      }
    },
    include: {
      allocations: true
    },
    orderBy: { dueDate: 'asc' }
  });
}

/**
 * Generate a period summary for GL close review.
 *
 * @param {string} dealId - UUID of the deal
 * @param {string} periodId - UUID of the accounting period
 * @returns {Promise<object>} Summary of all financial activity in the period
 */
export async function generatePeriodSummary(dealId, periodId) {
  const prisma = getPrisma();

  const period = await prisma.accountingPeriod.findUnique({
    where: { id: periodId }
  });

  if (!period) {
    return null;
  }

  const distributions = await getDistributionsInPeriod(dealId, periodId);
  const capitalCalls = await getCapitalCallsInPeriod(dealId, periodId);

  const totalDistributed = distributions.reduce((sum, d) => sum + d.totalAmount, 0);
  const totalCalled = capitalCalls.reduce((sum, c) => sum + c.totalAmount, 0);

  return {
    period: {
      id: period.id,
      year: period.year,
      quarter: period.quarter,
      periodType: period.periodType,
      startDate: period.startDate,
      endDate: period.endDate,
      status: period.status
    },
    distributions: {
      count: distributions.length,
      totalAmount: totalDistributed,
      byStatus: distributions.reduce((acc, d) => {
        acc[d.status] = (acc[d.status] || 0) + 1;
        return acc;
      }, {})
    },
    capitalCalls: {
      count: capitalCalls.length,
      totalAmount: totalCalled,
      byStatus: capitalCalls.reduce((acc, c) => {
        acc[c.status] = (acc[c.status] || 0) + 1;
        return acc;
      }, {})
    },
    netCashFlow: totalCalled - totalDistributed
  };
}
