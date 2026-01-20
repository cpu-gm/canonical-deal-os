/**
 * AI Consent Service
 *
 * Manages GDPR-compliant consent for AI features.
 *
 * SECURITY: Critical component for data privacy compliance.
 * - Validates consent before any AI feature access
 * - Tracks consent with full audit trail
 * - Handles consent withdrawal (GDPR right to erasure)
 *
 * Phase 1.2 Implementation
 */

import { getPrisma } from '../db.js';

// Configuration via environment variables
export const CONSENT_CONFIG = {
  enabled: process.env.AI_CONSENT_ENABLED !== 'false',
  gracePeriodDays: parseInt(process.env.AI_CONSENT_GRACE_PERIOD_DAYS) || 14,
  expirationMonths: parseInt(process.env.AI_CONSENT_EXPIRATION_MONTHS) || 12,
  currentPolicyVersion: process.env.AI_CONSENT_POLICY_VERSION || '1.0.0',
  debug: process.env.DEBUG_AI_CONSENT === 'true',
};

// Feature types for granular consent
export const AI_FEATURES = {
  DEAL_PARSING: 'allowDealParsing',
  CHAT_ASSISTANT: 'allowChatAssistant',
  DOCUMENT_ANALYSIS: 'allowDocumentAnalysis',
  INSIGHTS: 'allowInsights',
};

// Feature to field mapping
const FEATURE_FIELDS = {
  [AI_FEATURES.DEAL_PARSING]: 'allowDealParsing',
  [AI_FEATURES.CHAT_ASSISTANT]: 'allowChatAssistant',
  [AI_FEATURES.DOCUMENT_ANALYSIS]: 'allowDocumentAnalysis',
  [AI_FEATURES.INSIGHTS]: 'allowInsights',
};

/**
 * Check if user has valid consent for AI feature
 *
 * @param {string} userId - User ID
 * @param {string} feature - Feature from AI_FEATURES (optional)
 * @returns {Object} { valid, reason, requiresConsent, consentRecord }
 */
export async function checkConsent(userId, feature = null) {
  if (!CONSENT_CONFIG.enabled) {
    if (CONSENT_CONFIG.debug) {
      console.log(`[AI-CONSENT] Consent checking disabled, allowing access`);
    }
    return { valid: true, reason: 'consent_disabled', requiresConsent: false, consentRecord: null };
  }

  if (!userId) {
    console.log(`[AI-CONSENT] BLOCKED - No userId provided`);
    return {
      valid: false,
      reason: 'no_user_id',
      requiresConsent: true,
      consentRecord: null
    };
  }

  const prisma = getPrisma();

  // Get user's consent record
  const consent = await prisma.aIConsent.findUnique({
    where: { userId }
  });

  if (CONSENT_CONFIG.debug) {
    console.log(`[AI-CONSENT] Checking consent for user=${userId}, feature=${feature}, hasRecord=${!!consent}`);
  }

  // No consent record
  if (!consent) {
    console.log(`[AI-CONSENT] BLOCKED - No consent record: user=${userId}`);
    return {
      valid: false,
      reason: 'no_consent_record',
      requiresConsent: true,
      consentRecord: null
    };
  }

  // Consent withdrawn
  if (consent.withdrawnAt) {
    console.log(`[AI-CONSENT] BLOCKED - Consent withdrawn: user=${userId}`);
    return {
      valid: false,
      reason: 'consent_withdrawn',
      requiresConsent: true,
      consentRecord: consent
    };
  }

  // Consent not given (check grace period)
  if (!consent.consentGiven) {
    // Check if in grace period (for grandfathered users)
    if (consent.expiresAt && new Date() < new Date(consent.expiresAt)) {
      if (CONSENT_CONFIG.debug) {
        console.log(`[AI-CONSENT] Grace period active: user=${userId}, expires=${consent.expiresAt}`);
      }
      return { valid: true, reason: 'grace_period', requiresConsent: false, consentRecord: consent };
    }
    console.log(`[AI-CONSENT] BLOCKED - Consent not given, grace expired: user=${userId}`);
    return {
      valid: false,
      reason: 'consent_not_given',
      requiresConsent: true,
      consentRecord: consent
    };
  }

  // Consent expired (12-month auto-expiry)
  if (consent.expiresAt && new Date() > new Date(consent.expiresAt)) {
    console.log(`[AI-CONSENT] WARNING - Consent expired: user=${userId}`);
    return {
      valid: false,
      reason: 'consent_expired',
      requiresConsent: true,
      consentRecord: consent
    };
  }

  // Policy version mismatch (needs re-consent)
  if (consent.consentVersion !== CONSENT_CONFIG.currentPolicyVersion) {
    console.log(`[AI-CONSENT] WARNING - Re-consent needed: user=${userId}, old=${consent.consentVersion}, new=${CONSENT_CONFIG.currentPolicyVersion}`);
    return {
      valid: false,
      reason: 'policy_updated',
      requiresConsent: true,
      consentRecord: consent
    };
  }

  // Check feature-specific permission
  if (feature && FEATURE_FIELDS[feature]) {
    const fieldName = FEATURE_FIELDS[feature];
    if (!consent[fieldName]) {
      console.log(`[AI-CONSENT] BLOCKED - Feature not allowed: user=${userId}, feature=${feature}`);
      return {
        valid: false,
        reason: 'feature_not_allowed',
        requiresConsent: false,
        consentRecord: consent
      };
    }
  }

  // All checks passed
  if (CONSENT_CONFIG.debug) {
    console.log(`[AI-CONSENT] Consent valid: user=${userId}, feature=${feature}`);
  }
  return { valid: true, reason: 'consent_valid', requiresConsent: false, consentRecord: consent };
}

/**
 * Get consent status for a user
 *
 * @param {string} userId - User ID
 * @returns {Object} Full consent status
 */
export async function getConsentStatus(userId) {
  const prisma = getPrisma();

  const consent = await prisma.aIConsent.findUnique({
    where: { userId }
  });

  if (!consent) {
    return {
      hasConsent: false,
      consentVersion: null,
      currentPolicyVersion: CONSENT_CONFIG.currentPolicyVersion,
      requiresConsent: CONSENT_CONFIG.enabled,
      requiresReconsent: false,
      expiresAt: null,
      features: {
        dealParsing: false,
        chatAssistant: false,
        documentAnalysis: false,
        insights: false,
      },
      gracePeriod: null,
      withdrawnAt: null,
    };
  }

  // Check if in grace period
  const inGracePeriod = !consent.consentGiven && consent.expiresAt && new Date() < new Date(consent.expiresAt);
  const isExpired = consent.expiresAt && new Date() > new Date(consent.expiresAt);
  const needsReconsent = consent.consentGiven && consent.consentVersion !== CONSENT_CONFIG.currentPolicyVersion;

  return {
    hasConsent: consent.consentGiven && !isExpired && !needsReconsent,
    consentVersion: consent.consentVersion,
    currentPolicyVersion: CONSENT_CONFIG.currentPolicyVersion,
    requiresConsent: CONSENT_CONFIG.enabled && (!consent.consentGiven || isExpired || needsReconsent),
    requiresReconsent: needsReconsent,
    expiresAt: consent.expiresAt,
    features: {
      dealParsing: consent.allowDealParsing,
      chatAssistant: consent.allowChatAssistant,
      documentAnalysis: consent.allowDocumentAnalysis,
      insights: consent.allowInsights,
    },
    gracePeriod: inGracePeriod ? {
      active: true,
      expiresAt: consent.expiresAt,
    } : null,
    withdrawnAt: consent.withdrawnAt,
    consentedAt: consent.consentedAt,
  };
}

/**
 * Grant consent with full audit trail
 *
 * @param {string} userId - User ID
 * @param {string} organizationId - Organization ID
 * @param {Object} options - Consent options
 * @returns {Object} Created/updated consent record
 */
export async function grantConsent(userId, organizationId, options = {}) {
  const prisma = getPrisma();
  const {
    allowDealParsing = true,
    allowChatAssistant = true,
    allowDocumentAnalysis = true,
    allowInsights = true,
    ipAddress = null,
    userAgent = null,
    method = 'UI'
  } = options;

  // Get existing consent for audit
  const existing = await prisma.aIConsent.findUnique({
    where: { userId }
  });

  // Calculate expiry (12 months from now)
  const expiresAt = new Date();
  expiresAt.setMonth(expiresAt.getMonth() + CONSENT_CONFIG.expirationMonths);

  const data = {
    organizationId,
    consentGiven: true,
    consentVersion: CONSENT_CONFIG.currentPolicyVersion,
    allowDealParsing,
    allowChatAssistant,
    allowDocumentAnalysis,
    allowInsights,
    consentedAt: new Date(),
    withdrawnAt: null,
    expiresAt,
    ipAddress,
    userAgent,
    consentMethod: method,
  };

  const consent = await prisma.aIConsent.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });

  // Log audit trail
  await logConsentAction({
    userId,
    consentId: consent.id,
    action: 'CONSENT_GIVEN',
    policyVersion: CONSENT_CONFIG.currentPolicyVersion,
    beforeState: existing ? JSON.stringify(existing) : null,
    afterState: JSON.stringify(consent),
    ipAddress,
    userAgent,
  });

  console.log(`[AI-CONSENT] Consent granted: user=${userId}, version=${CONSENT_CONFIG.currentPolicyVersion}`);

  return consent;
}

/**
 * Withdraw consent (GDPR right)
 *
 * @param {string} userId - User ID
 * @param {string} reason - User-provided reason (optional)
 * @param {Object} metadata - Additional metadata
 * @returns {Object} Updated consent record
 */
export async function withdrawConsent(userId, reason = null, metadata = {}) {
  const prisma = getPrisma();
  const { ipAddress = null, userAgent = null } = metadata;

  const existing = await prisma.aIConsent.findUnique({
    where: { userId }
  });

  if (!existing) {
    const error = new Error('No consent record found');
    error.status = 404;
    throw error;
  }

  const updated = await prisma.aIConsent.update({
    where: { userId },
    data: {
      consentGiven: false,
      withdrawnAt: new Date(),
      // Disable all features on withdrawal
      allowDealParsing: false,
      allowChatAssistant: false,
      allowDocumentAnalysis: false,
      allowInsights: false,
    },
  });

  // Log audit trail
  await logConsentAction({
    userId,
    consentId: existing.id,
    action: 'CONSENT_WITHDRAWN',
    policyVersion: existing.consentVersion,
    beforeState: JSON.stringify(existing),
    afterState: JSON.stringify(updated),
    ipAddress,
    userAgent,
    reason,
  });

  console.log(`[AI-CONSENT] Consent withdrawn: user=${userId}, reason=${reason || 'not provided'}`);

  return updated;
}

/**
 * Update individual feature consent
 *
 * @param {string} userId - User ID
 * @param {string} feature - Feature from AI_FEATURES
 * @param {boolean} allowed - Whether to allow the feature
 * @param {Object} metadata - Additional metadata
 * @returns {Object} Updated consent record
 */
export async function updateFeatureConsent(userId, feature, allowed, metadata = {}) {
  const prisma = getPrisma();
  const { ipAddress = null, userAgent = null } = metadata;

  if (!FEATURE_FIELDS[feature]) {
    const error = new Error(`Invalid feature: ${feature}`);
    error.status = 400;
    throw error;
  }

  const fieldName = FEATURE_FIELDS[feature];

  const existing = await prisma.aIConsent.findUnique({
    where: { userId }
  });

  if (!existing) {
    const error = new Error('No consent record found. Please grant consent first.');
    error.status = 404;
    throw error;
  }

  const updated = await prisma.aIConsent.update({
    where: { userId },
    data: {
      [fieldName]: allowed,
    },
  });

  // Log audit trail
  await logConsentAction({
    userId,
    consentId: existing.id,
    action: 'FEATURE_TOGGLED',
    policyVersion: existing.consentVersion,
    beforeState: JSON.stringify({ [fieldName]: existing[fieldName] }),
    afterState: JSON.stringify({ [fieldName]: allowed }),
    ipAddress,
    userAgent,
  });

  console.log(`[AI-CONSENT] Feature toggled: user=${userId}, feature=${feature}, allowed=${allowed}`);

  return updated;
}

/**
 * Get current policy from database (or default)
 *
 * @returns {Object} Current policy
 */
export async function getCurrentPolicy() {
  const prisma = getPrisma();

  // Get the current policy (most recent by effectiveDate where supersededBy is null)
  const policy = await prisma.aIConsentPolicy.findFirst({
    where: {
      supersededBy: null,
      effectiveDate: {
        lte: new Date()
      }
    },
    orderBy: {
      effectiveDate: 'desc'
    }
  });

  if (policy) {
    return {
      version: policy.version,
      title: policy.title,
      content: policy.content,
      summary: policy.summary,
      effectiveDate: policy.effectiveDate,
    };
  }

  // Default policy if none in database
  return {
    version: CONSENT_CONFIG.currentPolicyVersion,
    title: 'AI Features Data Processing Agreement',
    summary: 'This policy explains how we use AI to analyze and process your commercial real estate data to provide insights, summaries, and document extraction.',
    content: null, // No full content in default
    effectiveDate: new Date(),
  };
}

/**
 * Log consent action to audit trail
 *
 * @param {Object} params - Audit log parameters
 */
async function logConsentAction(params) {
  const prisma = getPrisma();

  try {
    await prisma.aIConsentAudit.create({
      data: {
        userId: params.userId,
        consentId: params.consentId,
        action: params.action,
        policyVersion: params.policyVersion,
        beforeState: params.beforeState || null,
        afterState: params.afterState,
        ipAddress: params.ipAddress || null,
        userAgent: params.userAgent || null,
        reason: params.reason || null,
      }
    });

    if (CONSENT_CONFIG.debug) {
      console.log(`[AI-CONSENT] Audit logged: action=${params.action}, user=${params.userId}`);
    }
  } catch (error) {
    // Log error but don't fail the main operation
    console.error('[AI-CONSENT] Failed to log audit:', error);
  }
}

/**
 * Create a grace period consent for existing AI users (migration)
 *
 * @param {string} userId - User ID
 * @param {string} organizationId - Organization ID
 * @returns {Object} Created consent record
 */
export async function createGracePeriodConsent(userId, organizationId) {
  const prisma = getPrisma();

  // Check if already exists
  const existing = await prisma.aIConsent.findUnique({
    where: { userId }
  });

  if (existing) {
    return existing;
  }

  // Calculate grace period end
  const gracePeriodEnd = new Date();
  gracePeriodEnd.setDate(gracePeriodEnd.getDate() + CONSENT_CONFIG.gracePeriodDays);

  const consent = await prisma.aIConsent.create({
    data: {
      userId,
      organizationId,
      consentGiven: false, // Not yet consented
      consentVersion: 'PRE_CONSENT',
      // Grandfathered access during grace period
      allowDealParsing: true,
      allowChatAssistant: true,
      allowDocumentAnalysis: true,
      allowInsights: true,
      expiresAt: gracePeriodEnd,
      consentMethod: 'GRANDFATHERED',
    }
  });

  console.log(`[AI-CONSENT] Grace period consent created: user=${userId}, expires=${gracePeriodEnd.toISOString()}`);

  return consent;
}

/**
 * Get consent audit history for a user (admin use)
 *
 * @param {string} userId - User ID
 * @param {Object} options - Query options
 * @returns {Array} Audit records
 */
export async function getConsentAuditHistory(userId, options = {}) {
  const prisma = getPrisma();
  const { limit = 50, offset = 0 } = options;

  const audits = await prisma.aIConsentAudit.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
  });

  return audits;
}

export default {
  CONSENT_CONFIG,
  AI_FEATURES,
  checkConsent,
  getConsentStatus,
  grantConsent,
  withdrawConsent,
  updateFeatureConsent,
  getCurrentPolicy,
  createGracePeriodConsent,
  getConsentAuditHistory,
};
