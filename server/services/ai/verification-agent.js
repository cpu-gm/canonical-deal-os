/**
 * Verification Workflow Agent
 *
 * Tracks data lineage from extraction through verification.
 * Provides audit trail for every number in the model.
 *
 * Features:
 * 1. Data lineage tracking (source, extraction, verification)
 * 2. Verification status management
 * 3. AI-powered verification suggestions
 * 4. Comprehensive audit trail
 *
 * Phase 2.2 Implementation
 */

import { getPrisma } from '../../db.js';

// Configuration
export const VERIFICATION_CONFIG = {
  enabled: process.env.AI_VERIFICATION_AGENT_ENABLED !== 'false',
  debug: process.env.DEBUG_AI_VERIFICATION === 'true',
};

// Verification statuses
export const VERIFICATION_STATUS = {
  UNVERIFIED: 'UNVERIFIED',
  AI_EXTRACTED: 'AI_EXTRACTED',
  HUMAN_VERIFIED: 'HUMAN_VERIFIED',
  NEEDS_REVIEW: 'NEEDS_REVIEW',
};

// Source types
export const SOURCE_TYPE = {
  MANUAL: 'MANUAL',
  DOCUMENT: 'DOCUMENT',
  FORMULA: 'FORMULA',
  AI_EXTRACTED: 'AI_EXTRACTED',
  IMPORTED: 'IMPORTED',
};

// Priority fields for verification (most material fields first)
const PRIORITY_FIELDS = [
  'purchasePrice',
  'netOperatingIncome',
  'capRate',
  'grossPotentialRent',
  'effectiveGrossIncome',
  'vacancyRate',
  'operatingExpenses',
  'debtService',
  'cashOnCash',
  'irr',
];

/**
 * Track data lineage for a field
 *
 * @param {string} dealId - Deal ID
 * @param {string} modelId - Underwriting model ID
 * @param {string} field - Field name
 * @param {Object} sourceInfo - Source information
 * @returns {Object} Created/updated lineage record
 */
export async function trackDataLineage(dealId, modelId, field, sourceInfo) {
  const operationId = `lineage_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  if (VERIFICATION_CONFIG.debug) {
    console.log(`[VERIFY-AGENT] [${operationId}] Tracking lineage: deal=${dealId}, field=${field}`);
  }

  if (!VERIFICATION_CONFIG.enabled) {
    console.log(`[VERIFY-AGENT] [${operationId}] Feature disabled`);
    return {
      success: false,
      error: 'Verification agent feature is disabled',
    };
  }

  const prisma = getPrisma();

  try {
    const {
      value,
      sourceType,
      sourceDocId = null,
      sourceField = null,
      extractionConfidence = null,
    } = sourceInfo;

    // Determine initial verification status based on source
    let verificationStatus = VERIFICATION_STATUS.UNVERIFIED;
    if (sourceType === SOURCE_TYPE.AI_EXTRACTED) {
      verificationStatus = VERIFICATION_STATUS.AI_EXTRACTED;
    } else if (sourceType === SOURCE_TYPE.MANUAL) {
      verificationStatus = VERIFICATION_STATUS.NEEDS_REVIEW;
    }

    // Get existing lineage to preserve history
    const existing = await prisma.dataLineage.findUnique({
      where: {
        dealId_modelId_field: {
          dealId,
          modelId,
          field,
        },
      },
    });

    // Build history entry
    const historyEntry = {
      value,
      changedAt: new Date().toISOString(),
      sourceType,
      sourceDocId,
    };

    let previousValues = [];
    if (existing && existing.history) {
      try {
        previousValues = typeof existing.history === 'string'
          ? JSON.parse(existing.history)
          : existing.history;
      } catch (e) {
        previousValues = [];
      }
    }

    // Add previous value to history
    if (existing) {
      previousValues.unshift({
        value: existing.currentValue,
        changedAt: existing.updatedAt?.toISOString() || new Date().toISOString(),
        sourceType: existing.sourceType,
        verificationStatus: existing.verificationStatus,
      });
    }

    // Keep only last 10 history entries
    previousValues = previousValues.slice(0, 10);

    // Create or update lineage record
    const lineage = await prisma.dataLineage.upsert({
      where: {
        dealId_modelId_field: {
          dealId,
          modelId,
          field,
        },
      },
      create: {
        dealId,
        modelId,
        field,
        currentValue: String(value),
        sourceType,
        sourceDocId,
        sourceField,
        extractedAt: sourceType === SOURCE_TYPE.AI_EXTRACTED || sourceType === SOURCE_TYPE.DOCUMENT
          ? new Date()
          : null,
        extractionConfidence,
        verificationStatus,
        history: JSON.stringify(previousValues),
      },
      update: {
        currentValue: String(value),
        sourceType,
        sourceDocId,
        sourceField,
        extractedAt: sourceType === SOURCE_TYPE.AI_EXTRACTED || sourceType === SOURCE_TYPE.DOCUMENT
          ? new Date()
          : undefined,
        extractionConfidence,
        verificationStatus: existing?.verificationStatus === VERIFICATION_STATUS.HUMAN_VERIFIED
          ? VERIFICATION_STATUS.NEEDS_REVIEW  // Re-verification needed if value changed
          : verificationStatus,
        history: JSON.stringify(previousValues),
      },
    });

    console.log(`[VERIFY-AGENT] [${operationId}] Lineage tracked: deal=${dealId}, field=${field}, source=${sourceType}`);

    return {
      success: true,
      lineage,
      isNewValue: !existing || existing.currentValue !== String(value),
      previousValue: existing?.currentValue,
    };

  } catch (error) {
    console.error(`[VERIFY-AGENT] [${operationId}] Error:`, error.message);
    if (VERIFICATION_CONFIG.debug) {
      console.error(`[VERIFY-AGENT] [${operationId}] Stack:`, error.stack);
    }

    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Mark a field as verified by a user
 *
 * @param {string} dealId - Deal ID
 * @param {string} modelId - Model ID
 * @param {string} field - Field name
 * @param {string} verifierId - User ID who verified
 * @param {string} notes - Optional verification notes
 * @returns {Object} Updated lineage record
 */
export async function markAsVerified(dealId, modelId, field, verifierId, notes = '') {
  const operationId = `verify_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  if (VERIFICATION_CONFIG.debug) {
    console.log(`[VERIFY-AGENT] [${operationId}] Marking verified: deal=${dealId}, field=${field}, by=${verifierId}`);
  }

  if (!VERIFICATION_CONFIG.enabled) {
    return {
      success: false,
      error: 'Verification agent feature is disabled',
    };
  }

  const prisma = getPrisma();

  try {
    const existing = await prisma.dataLineage.findUnique({
      where: {
        dealId_modelId_field: {
          dealId,
          modelId,
          field,
        },
      },
    });

    if (!existing) {
      return {
        success: false,
        error: `No lineage record found for field: ${field}`,
      };
    }

    const updated = await prisma.dataLineage.update({
      where: {
        dealId_modelId_field: {
          dealId,
          modelId,
          field,
        },
      },
      data: {
        verificationStatus: VERIFICATION_STATUS.HUMAN_VERIFIED,
        verifiedBy: verifierId,
        verifiedAt: new Date(),
        verificationNotes: notes,
      },
    });

    console.log(`[VERIFY-AGENT] [${operationId}] Field verified: deal=${dealId}, field=${field}, by=${verifierId}`);

    return {
      success: true,
      lineage: updated,
      previousStatus: existing.verificationStatus,
    };

  } catch (error) {
    console.error(`[VERIFY-AGENT] [${operationId}] Error:`, error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Mark a field as needing review
 *
 * @param {string} dealId - Deal ID
 * @param {string} modelId - Model ID
 * @param {string} field - Field name
 * @param {string} reason - Reason for requiring review
 * @returns {Object} Updated lineage record
 */
export async function markNeedsReview(dealId, modelId, field, reason = '') {
  if (!VERIFICATION_CONFIG.enabled) {
    return {
      success: false,
      error: 'Verification agent feature is disabled',
    };
  }

  const prisma = getPrisma();

  try {
    const updated = await prisma.dataLineage.update({
      where: {
        dealId_modelId_field: {
          dealId,
          modelId,
          field,
        },
      },
      data: {
        verificationStatus: VERIFICATION_STATUS.NEEDS_REVIEW,
        verificationNotes: reason,
      },
    });

    console.log(`[VERIFY-AGENT] Field needs review: deal=${dealId}, field=${field}, reason=${reason}`);

    return {
      success: true,
      lineage: updated,
    };

  } catch (error) {
    console.error(`[VERIFY-AGENT] Error marking needs review:`, error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Get verification status for all fields in a deal
 *
 * @param {string} dealId - Deal ID
 * @param {string} modelId - Optional model ID filter
 * @returns {Object} Verification status summary
 */
export async function getVerificationStatus(dealId, modelId = null) {
  if (!VERIFICATION_CONFIG.enabled) {
    return {
      success: false,
      error: 'Verification agent feature is disabled',
    };
  }

  const prisma = getPrisma();

  try {
    const where = { dealId };
    if (modelId) {
      where.modelId = modelId;
    }

    const lineageRecords = await prisma.dataLineage.findMany({
      where,
      orderBy: { field: 'asc' },
    });

    // Calculate summary statistics
    const summary = {
      total: lineageRecords.length,
      verified: 0,
      aiExtracted: 0,
      unverified: 0,
      needsReview: 0,
    };

    const byField = {};

    for (const record of lineageRecords) {
      switch (record.verificationStatus) {
        case VERIFICATION_STATUS.HUMAN_VERIFIED:
          summary.verified++;
          break;
        case VERIFICATION_STATUS.AI_EXTRACTED:
          summary.aiExtracted++;
          break;
        case VERIFICATION_STATUS.NEEDS_REVIEW:
          summary.needsReview++;
          break;
        default:
          summary.unverified++;
      }

      byField[record.field] = {
        value: record.currentValue,
        status: record.verificationStatus,
        sourceType: record.sourceType,
        sourceDocId: record.sourceDocId,
        verifiedBy: record.verifiedBy,
        verifiedAt: record.verifiedAt,
        extractionConfidence: record.extractionConfidence,
        hasHistory: record.history && JSON.parse(record.history).length > 0,
      };
    }

    summary.verificationRate = summary.total > 0
      ? ((summary.verified / summary.total) * 100).toFixed(1) + '%'
      : 'N/A';

    return {
      success: true,
      dealId,
      modelId,
      summary,
      fields: byField,
      lineageRecords,
    };

  } catch (error) {
    console.error(`[VERIFY-AGENT] Error getting verification status:`, error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Get lineage for a specific field
 *
 * @param {string} dealId - Deal ID
 * @param {string} modelId - Model ID
 * @param {string} field - Field name
 * @returns {Object} Field lineage with history
 */
export async function getFieldLineage(dealId, modelId, field) {
  if (!VERIFICATION_CONFIG.enabled) {
    return {
      success: false,
      error: 'Verification agent feature is disabled',
    };
  }

  const prisma = getPrisma();

  try {
    const lineage = await prisma.dataLineage.findUnique({
      where: {
        dealId_modelId_field: {
          dealId,
          modelId,
          field,
        },
      },
    });

    if (!lineage) {
      return {
        success: false,
        error: `No lineage found for field: ${field}`,
      };
    }

    // Parse history
    let history = [];
    if (lineage.history) {
      try {
        history = typeof lineage.history === 'string'
          ? JSON.parse(lineage.history)
          : lineage.history;
      } catch (e) {
        history = [];
      }
    }

    return {
      success: true,
      field,
      currentValue: lineage.currentValue,
      verificationStatus: lineage.verificationStatus,
      sourceType: lineage.sourceType,
      sourceDocId: lineage.sourceDocId,
      sourceField: lineage.sourceField,
      extractedAt: lineage.extractedAt,
      extractionConfidence: lineage.extractionConfidence,
      verifiedBy: lineage.verifiedBy,
      verifiedAt: lineage.verifiedAt,
      verificationNotes: lineage.verificationNotes,
      history,
      createdAt: lineage.createdAt,
      updatedAt: lineage.updatedAt,
    };

  } catch (error) {
    console.error(`[VERIFY-AGENT] Error getting field lineage:`, error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Suggest which fields should be verified next
 * Based on: materiality, confidence scores, time since extraction
 *
 * @param {string} dealId - Deal ID
 * @param {string} modelId - Model ID
 * @param {Object} options - Suggestion options
 * @returns {Object} Prioritized list of fields to verify
 */
export async function suggestNextVerification(dealId, modelId, options = {}) {
  const { limit = 5 } = options;

  if (!VERIFICATION_CONFIG.enabled) {
    return {
      success: false,
      error: 'Verification agent feature is disabled',
    };
  }

  const prisma = getPrisma();

  try {
    // Get all unverified/needs-review fields
    const unverifiedRecords = await prisma.dataLineage.findMany({
      where: {
        dealId,
        modelId,
        verificationStatus: {
          in: [VERIFICATION_STATUS.UNVERIFIED, VERIFICATION_STATUS.AI_EXTRACTED, VERIFICATION_STATUS.NEEDS_REVIEW],
        },
      },
    });

    if (unverifiedRecords.length === 0) {
      return {
        success: true,
        suggestions: [],
        message: 'All fields are verified!',
      };
    }

    // Score each field for priority
    const scoredFields = unverifiedRecords.map(record => {
      let score = 0;

      // Priority based on field importance (material fields first)
      const priorityIndex = PRIORITY_FIELDS.indexOf(record.field);
      if (priorityIndex !== -1) {
        score += (PRIORITY_FIELDS.length - priorityIndex) * 10;
      }

      // Lower confidence = higher priority
      if (record.extractionConfidence !== null) {
        score += (1 - record.extractionConfidence) * 50;
      }

      // NEEDS_REVIEW status = higher priority
      if (record.verificationStatus === VERIFICATION_STATUS.NEEDS_REVIEW) {
        score += 30;
      }

      // Older extractions = higher priority
      if (record.extractedAt) {
        const ageInDays = (Date.now() - new Date(record.extractedAt).getTime()) / (1000 * 60 * 60 * 24);
        score += Math.min(ageInDays * 2, 20);
      }

      return {
        field: record.field,
        currentValue: record.currentValue,
        verificationStatus: record.verificationStatus,
        sourceType: record.sourceType,
        extractionConfidence: record.extractionConfidence,
        priorityScore: score,
        reason: generateVerificationReason(record, priorityIndex),
      };
    });

    // Sort by priority score (highest first)
    scoredFields.sort((a, b) => b.priorityScore - a.priorityScore);

    // Return top suggestions
    const suggestions = scoredFields.slice(0, limit);

    if (VERIFICATION_CONFIG.debug) {
      console.log(`[VERIFY-AGENT] Suggested ${suggestions.length} fields for verification`);
    }

    return {
      success: true,
      suggestions,
      totalUnverified: unverifiedRecords.length,
      message: `${suggestions.length} fields recommended for verification`,
    };

  } catch (error) {
    console.error(`[VERIFY-AGENT] Error suggesting verification:`, error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Generate human-readable reason for verification priority
 *
 * @param {Object} record - Lineage record
 * @param {number} priorityIndex - Index in priority fields
 * @returns {string} Reason for verification priority
 */
function generateVerificationReason(record, priorityIndex) {
  const reasons = [];

  if (priorityIndex !== -1 && priorityIndex < 5) {
    reasons.push('High-impact financial metric');
  }

  if (record.extractionConfidence !== null && record.extractionConfidence < 0.8) {
    reasons.push(`Low extraction confidence (${(record.extractionConfidence * 100).toFixed(0)}%)`);
  }

  if (record.verificationStatus === VERIFICATION_STATUS.NEEDS_REVIEW) {
    reasons.push('Flagged for review');
  }

  if (record.sourceType === SOURCE_TYPE.AI_EXTRACTED) {
    reasons.push('AI-extracted value');
  }

  if (reasons.length === 0) {
    reasons.push('Unverified field');
  }

  return reasons.join('; ');
}

/**
 * Bulk track lineage for multiple fields
 *
 * @param {string} dealId - Deal ID
 * @param {string} modelId - Model ID
 * @param {Object[]} fields - Array of { field, value, sourceInfo }
 * @returns {Object} Results summary
 */
export async function bulkTrackLineage(dealId, modelId, fields) {
  if (!VERIFICATION_CONFIG.enabled) {
    return {
      success: false,
      error: 'Verification agent feature is disabled',
    };
  }

  const results = {
    total: fields.length,
    succeeded: 0,
    failed: 0,
    errors: [],
  };

  for (const fieldData of fields) {
    const result = await trackDataLineage(dealId, modelId, fieldData.field, {
      value: fieldData.value,
      ...fieldData.sourceInfo,
    });

    if (result.success) {
      results.succeeded++;
    } else {
      results.failed++;
      results.errors.push({ field: fieldData.field, error: result.error });
    }
  }

  console.log(`[VERIFY-AGENT] Bulk lineage: ${results.succeeded}/${results.total} succeeded`);

  return {
    success: results.failed === 0,
    ...results,
  };
}

/**
 * Bulk verify multiple fields
 *
 * @param {string} dealId - Deal ID
 * @param {string} modelId - Model ID
 * @param {string[]} fields - Array of field names
 * @param {string} verifierId - User ID
 * @param {string} notes - Optional notes
 * @returns {Object} Results summary
 */
export async function bulkVerify(dealId, modelId, fields, verifierId, notes = '') {
  if (!VERIFICATION_CONFIG.enabled) {
    return {
      success: false,
      error: 'Verification agent feature is disabled',
    };
  }

  const results = {
    total: fields.length,
    verified: 0,
    failed: 0,
    errors: [],
  };

  for (const field of fields) {
    const result = await markAsVerified(dealId, modelId, field, verifierId, notes);

    if (result.success) {
      results.verified++;
    } else {
      results.failed++;
      results.errors.push({ field, error: result.error });
    }
  }

  console.log(`[VERIFY-AGENT] Bulk verify: ${results.verified}/${results.total} verified by ${verifierId}`);

  return {
    success: results.failed === 0,
    ...results,
  };
}

/**
 * Get verification history for audit purposes
 *
 * @param {string} dealId - Deal ID
 * @param {Object} options - Query options
 * @returns {Object} Verification audit history
 */
export async function getVerificationHistory(dealId, options = {}) {
  const { limit = 50, verifierId = null } = options;

  if (!VERIFICATION_CONFIG.enabled) {
    return {
      success: false,
      error: 'Verification agent feature is disabled',
    };
  }

  const prisma = getPrisma();

  try {
    const where = {
      dealId,
      verificationStatus: VERIFICATION_STATUS.HUMAN_VERIFIED,
    };

    if (verifierId) {
      where.verifiedBy = verifierId;
    }

    const verifiedRecords = await prisma.dataLineage.findMany({
      where,
      orderBy: { verifiedAt: 'desc' },
      take: limit,
    });

    return {
      success: true,
      dealId,
      history: verifiedRecords.map(record => ({
        field: record.field,
        modelId: record.modelId,
        value: record.currentValue,
        verifiedBy: record.verifiedBy,
        verifiedAt: record.verifiedAt,
        notes: record.verificationNotes,
        sourceType: record.sourceType,
      })),
      count: verifiedRecords.length,
    };

  } catch (error) {
    console.error(`[VERIFY-AGENT] Error getting verification history:`, error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

export default {
  trackDataLineage,
  markAsVerified,
  markNeedsReview,
  getVerificationStatus,
  getFieldLineage,
  suggestNextVerification,
  bulkTrackLineage,
  bulkVerify,
  getVerificationHistory,
  VERIFICATION_CONFIG,
  VERIFICATION_STATUS,
  SOURCE_TYPE,
};
