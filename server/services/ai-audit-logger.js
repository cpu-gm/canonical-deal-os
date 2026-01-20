/**
 * AI Audit Logger Service
 *
 * Logs all AI/LLM interactions for security audit and compliance.
 * Every interaction with the AI is logged including:
 * - Who made the request (user, role, organization)
 * - What data was sent to the AI (context fields, facts)
 * - What endpoint was called
 * - Response validation results
 *
 * SECURITY: This is a critical security component for detecting and
 * investigating potential data leakage through AI features.
 */

import { getPrisma } from '../db.js';

/**
 * Generate a hash of the system prompt for consistency verification
 * Uses a simple hash - not cryptographic, just for identifying changes
 */
function hashSystemPrompt(systemPrompt) {
  if (!systemPrompt) return null;
  let hash = 0;
  for (let i = 0; i < systemPrompt.length; i++) {
    const char = systemPrompt.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(16);
}

/**
 * Log an AI interaction for audit purposes
 *
 * @param {Object} params - Interaction details
 * @param {string} params.userId - ID of user who made the request
 * @param {string} params.userRole - User's role at time of request
 * @param {string} params.organizationId - User's organization ID
 * @param {string} [params.dealId] - Deal ID if deal-specific
 * @param {string} params.endpoint - API endpoint called
 * @param {string} params.promptSummary - First 200 chars of user prompt
 * @param {string} [params.fullPrompt] - Complete user prompt (for full audit trail)
 * @param {string} [params.fullResponse] - Complete AI response (for tracing decisions)
 * @param {string} [params.systemPrompt] - System prompt used (will be hashed)
 * @param {string} [params.modelUsed] - Model ID used (e.g., gpt-4o-mini)
 * @param {Array<string>} params.contextFields - Array of context field names included
 * @param {number} [params.factsIncluded=0] - Number of RAG facts sent
 * @param {number} [params.responseLength=0] - Length of AI response
 * @param {boolean} [params.validationPassed=true] - Whether validation passed
 * @param {Object} [params.validationIssues] - Any validation issues found
 * @param {boolean} [params.sanitizationApplied=false] - Whether input was sanitized
 * @param {number} [params.jailbreakScore] - Jailbreak detection score (0-1)
 * @param {string} [params.jailbreakPatterns] - JSON array of detected patterns
 * @param {boolean} [params.outputValidationPassed=true] - Whether output validation passed
 * @param {string} [params.outputValidationIssues] - JSON array of output issues
 */
export async function logAIInteraction({
  userId,
  userRole,
  organizationId,
  dealId = null,
  endpoint,
  promptSummary,
  fullPrompt = null,
  fullResponse = null,
  systemPrompt = null,
  modelUsed = null,
  contextFields = [],
  factsIncluded = 0,
  responseLength = 0,
  validationPassed = true,
  validationIssues = null,
  // Phase 1.1 security fields
  sanitizationApplied = false,
  jailbreakScore = null,
  jailbreakPatterns = null,
  outputValidationPassed = true,
  outputValidationIssues = null,
}) {
  const prisma = getPrisma();

  try {
    await prisma.aIInteractionLog.create({
      data: {
        userId: userId || 'unknown',
        userRole: userRole || 'unknown',
        organizationId: organizationId || 'unknown',
        dealId,
        endpoint: endpoint || 'unknown',
        promptSummary: (promptSummary || '').substring(0, 200),
        fullPrompt: fullPrompt || null,
        fullResponse: fullResponse || null,
        systemPromptHash: hashSystemPrompt(systemPrompt),
        modelUsed: modelUsed || null,
        contextFields: JSON.stringify(contextFields),
        factsIncluded,
        responseLength,
        validationPassed,
        validationIssues: validationIssues ? (typeof validationIssues === 'string' ? validationIssues : JSON.stringify(validationIssues)) : null,
        // Phase 1.1 security fields
        sanitizationApplied,
        jailbreakScore,
        jailbreakPatterns: jailbreakPatterns ? (typeof jailbreakPatterns === 'string' ? jailbreakPatterns : JSON.stringify(jailbreakPatterns)) : null,
        outputValidationPassed,
        outputValidationIssues: outputValidationIssues ? (typeof outputValidationIssues === 'string' ? outputValidationIssues : JSON.stringify(outputValidationIssues)) : null,
      },
    });

    // Enhanced logging for security events
    if (jailbreakScore && jailbreakScore > 0.5) {
      console.log(`[AI-AUDIT] Security event: jailbreak score ${jailbreakScore.toFixed(2)} for ${endpoint} by ${userRole}`);
    }
    if (!outputValidationPassed) {
      console.log(`[AI-AUDIT] Security event: output validation failed for ${endpoint} by ${userRole}`);
    }

    console.log(`[AI-AUDIT] Logged interaction: ${endpoint} by ${userRole} (${userId?.substring(0, 8)}...)`);
  } catch (error) {
    // Log error but don't fail the request
    console.error('Failed to log AI interaction:', error);
  }
}

/**
 * Query AI interaction logs for audit purposes
 *
 * @param {Object} filters - Query filters
 * @param {string} [filters.userId] - Filter by user
 * @param {string} [filters.organizationId] - Filter by organization
 * @param {string} [filters.dealId] - Filter by deal
 * @param {string} [filters.userRole] - Filter by role
 * @param {Date} [filters.startDate] - Start of date range
 * @param {Date} [filters.endDate] - End of date range
 * @param {number} [filters.limit=100] - Max results
 * @param {number} [filters.offset=0] - Offset for pagination
 * @returns {Promise<Array>} Array of log entries
 */
export async function queryAIInteractionLogs({
  userId,
  organizationId,
  dealId,
  userRole,
  startDate,
  endDate,
  limit = 100,
  offset = 0,
}) {
  const prisma = getPrisma();

  const where = {};

  if (userId) where.userId = userId;
  if (organizationId) where.organizationId = organizationId;
  if (dealId) where.dealId = dealId;
  if (userRole) where.userRole = userRole;

  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = startDate;
    if (endDate) where.createdAt.lte = endDate;
  }

  try {
    const logs = await prisma.aIInteractionLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });

    return logs.map(log => ({
      ...log,
      contextFields: JSON.parse(log.contextFields || '[]'),
      validationIssues: log.validationIssues ? JSON.parse(log.validationIssues) : null,
    }));
  } catch (error) {
    console.error('Failed to query AI interaction logs:', error);
    return [];
  }
}

/**
 * Get AI interaction statistics for an organization
 *
 * @param {string} organizationId - Organization to get stats for
 * @param {Date} [startDate] - Start of date range
 * @param {Date} [endDate] - End of date range
 * @returns {Promise<Object>} Statistics object
 */
export async function getAIInteractionStats(organizationId, startDate, endDate) {
  const prisma = getPrisma();

  const where = { organizationId };

  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = startDate;
    if (endDate) where.createdAt.lte = endDate;
  }

  try {
    const [totalCount, byRole, byEndpoint, validationFailures] = await Promise.all([
      // Total interactions
      prisma.aIInteractionLog.count({ where }),

      // By role
      prisma.aIInteractionLog.groupBy({
        by: ['userRole'],
        where,
        _count: { userRole: true },
      }),

      // By endpoint
      prisma.aIInteractionLog.groupBy({
        by: ['endpoint'],
        where,
        _count: { endpoint: true },
      }),

      // Validation failures
      prisma.aIInteractionLog.count({
        where: { ...where, validationPassed: false },
      }),
    ]);

    return {
      totalInteractions: totalCount,
      byRole: byRole.reduce((acc, r) => {
        acc[r.userRole] = r._count.userRole;
        return acc;
      }, {}),
      byEndpoint: byEndpoint.reduce((acc, e) => {
        acc[e.endpoint] = e._count.endpoint;
        return acc;
      }, {}),
      validationFailures,
      validationFailureRate: totalCount > 0 ? (validationFailures / totalCount) * 100 : 0,
    };
  } catch (error) {
    console.error('Failed to get AI interaction stats:', error);
    return {
      totalInteractions: 0,
      byRole: {},
      byEndpoint: {},
      validationFailures: 0,
      validationFailureRate: 0,
    };
  }
}

/**
 * Check for suspicious AI activity patterns
 * Returns alerts if unusual patterns are detected
 *
 * @param {string} organizationId - Organization to check
 * @param {number} [windowMinutes=60] - Time window to analyze
 * @returns {Promise<Array>} Array of alerts
 */
export async function detectSuspiciousAIActivity(organizationId, windowMinutes = 60) {
  const prisma = getPrisma();
  const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000);

  const alerts = [];

  try {
    // Check for high volume from single user
    const userVolume = await prisma.aIInteractionLog.groupBy({
      by: ['userId'],
      where: {
        organizationId,
        createdAt: { gte: windowStart },
      },
      _count: { userId: true },
    });

    for (const user of userVolume) {
      if (user._count.userId > 100) {
        alerts.push({
          type: 'HIGH_VOLUME',
          severity: 'WARNING',
          message: `User ${user.userId} made ${user._count.userId} AI requests in ${windowMinutes} minutes`,
          userId: user.userId,
        });
      }
    }

    // Check for validation failures
    const recentFailures = await prisma.aIInteractionLog.findMany({
      where: {
        organizationId,
        createdAt: { gte: windowStart },
        validationPassed: false,
      },
      take: 10,
    });

    if (recentFailures.length > 0) {
      alerts.push({
        type: 'VALIDATION_FAILURES',
        severity: 'HIGH',
        message: `${recentFailures.length} AI responses failed validation in the last ${windowMinutes} minutes`,
        details: recentFailures.map(f => ({
          userId: f.userId,
          endpoint: f.endpoint,
          dealId: f.dealId,
        })),
      });
    }

    // Check for unusual role access patterns
    const roleAccess = await prisma.aIInteractionLog.groupBy({
      by: ['userRole', 'endpoint'],
      where: {
        organizationId,
        createdAt: { gte: windowStart },
      },
      _count: { userRole: true },
    });

    // Flag if LP users are hitting deal chat endpoints frequently
    const lpDealChats = roleAccess.filter(
      r => r.userRole === 'LP' && r.endpoint.includes('/deals/')
    );

    for (const access of lpDealChats) {
      if (access._count.userRole > 50) {
        alerts.push({
          type: 'UNUSUAL_ACCESS_PATTERN',
          severity: 'INFO',
          message: `LP users made ${access._count.userRole} requests to ${access.endpoint} in ${windowMinutes} minutes`,
        });
      }
    }

  } catch (error) {
    console.error('Failed to detect suspicious AI activity:', error);
  }

  return alerts;
}

export default {
  logAIInteraction,
  queryAIInteractionLogs,
  getAIInteractionStats,
  detectSuspiciousAIActivity,
};
