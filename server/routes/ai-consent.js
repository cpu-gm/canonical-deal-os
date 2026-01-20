/**
 * AI Consent API Routes
 *
 * Endpoints for GDPR-compliant consent management for AI features.
 *
 * GET    /api/ai-consent/status   - Get current consent status
 * POST   /api/ai-consent/grant    - Grant consent
 * POST   /api/ai-consent/withdraw - Withdraw consent (GDPR right)
 * PATCH  /api/ai-consent/features - Update feature toggles
 * GET    /api/ai-consent/policy   - Get current policy
 * GET    /api/ai-consent/history  - Get consent audit history (admin)
 *
 * Phase 1.2 Implementation
 */

import {
  checkConsent,
  getConsentStatus,
  grantConsent,
  withdrawConsent,
  updateFeatureConsent,
  getCurrentPolicy,
  getConsentAuditHistory,
  AI_FEATURES,
  CONSENT_CONFIG,
} from '../services/ai-consent.js';

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(JSON.stringify(payload));
}

function sendError(res, status, message) {
  sendJson(res, status, { message });
}

/**
 * GET /api/ai-consent/status
 *
 * Get the current consent status for the authenticated user.
 */
export async function handleGetConsentStatus(req, res, authUser) {
  if (!authUser) {
    return sendError(res, 401, "Authentication required");
  }

  try {
    const status = await getConsentStatus(authUser.id);

    if (CONSENT_CONFIG.debug) {
      console.log(`[AI-CONSENT] Status request: user=${authUser.id}, hasConsent=${status.hasConsent}`);
    }

    sendJson(res, 200, status);
  } catch (error) {
    console.error('[AI-CONSENT] Error getting status:', error);
    sendError(res, 500, "Failed to get consent status");
  }
}

/**
 * POST /api/ai-consent/grant
 *
 * Grant consent to use AI features.
 *
 * Body:
 * {
 *   allowDealParsing?: boolean,
 *   allowChatAssistant?: boolean,
 *   allowDocumentAnalysis?: boolean,
 *   allowInsights?: boolean
 * }
 */
export async function handleGrantConsent(req, res, authUser, readJsonBody) {
  if (!authUser) {
    return sendError(res, 401, "Authentication required");
  }

  try {
    let body = {};
    try {
      body = await readJsonBody(req);
    } catch {
      // Empty body is OK - defaults will be used
    }

    const consent = await grantConsent(authUser.id, authUser.organizationId, {
      allowDealParsing: body.allowDealParsing !== false,
      allowChatAssistant: body.allowChatAssistant !== false,
      allowDocumentAnalysis: body.allowDocumentAnalysis !== false,
      allowInsights: body.allowInsights !== false,
      ipAddress: req.headers['x-forwarded-for'] || req.socket?.remoteAddress,
      userAgent: req.headers['user-agent'],
      method: 'UI',
    });

    sendJson(res, 200, {
      message: "Consent granted successfully",
      consent: {
        consentGiven: consent.consentGiven,
        consentVersion: consent.consentVersion,
        expiresAt: consent.expiresAt,
        features: {
          dealParsing: consent.allowDealParsing,
          chatAssistant: consent.allowChatAssistant,
          documentAnalysis: consent.allowDocumentAnalysis,
          insights: consent.allowInsights,
        }
      }
    });
  } catch (error) {
    console.error('[AI-CONSENT] Error granting consent:', error);
    sendError(res, error.status || 500, error.message || "Failed to grant consent");
  }
}

/**
 * POST /api/ai-consent/withdraw
 *
 * Withdraw consent (GDPR right to withdraw).
 *
 * Body:
 * {
 *   reason?: string  // User-provided reason
 * }
 */
export async function handleWithdrawConsent(req, res, authUser, readJsonBody) {
  if (!authUser) {
    return sendError(res, 401, "Authentication required");
  }

  try {
    let body = {};
    try {
      body = await readJsonBody(req);
    } catch {
      // Empty body is OK
    }

    await withdrawConsent(authUser.id, body.reason || null, {
      ipAddress: req.headers['x-forwarded-for'] || req.socket?.remoteAddress,
      userAgent: req.headers['user-agent'],
    });

    sendJson(res, 200, {
      message: "Consent withdrawn successfully",
      note: "Your consent has been withdrawn. AI features will no longer be available until you grant consent again."
    });
  } catch (error) {
    console.error('[AI-CONSENT] Error withdrawing consent:', error);
    sendError(res, error.status || 500, error.message || "Failed to withdraw consent");
  }
}

/**
 * PATCH /api/ai-consent/features
 *
 * Update individual feature consent toggles.
 *
 * Body:
 * {
 *   feature: "allowDealParsing" | "allowChatAssistant" | "allowDocumentAnalysis" | "allowInsights",
 *   allowed: boolean
 * }
 */
export async function handleUpdateFeatureConsent(req, res, authUser, readJsonBody) {
  if (!authUser) {
    return sendError(res, 401, "Authentication required");
  }

  try {
    const body = await readJsonBody(req);

    if (!body.feature) {
      return sendError(res, 400, "Feature is required");
    }

    if (typeof body.allowed !== 'boolean') {
      return sendError(res, 400, "Allowed must be a boolean");
    }

    // Validate feature
    const validFeatures = Object.values(AI_FEATURES);
    if (!validFeatures.includes(body.feature)) {
      return sendError(res, 400, `Invalid feature. Must be one of: ${validFeatures.join(', ')}`);
    }

    const consent = await updateFeatureConsent(authUser.id, body.feature, body.allowed, {
      ipAddress: req.headers['x-forwarded-for'] || req.socket?.remoteAddress,
      userAgent: req.headers['user-agent'],
    });

    sendJson(res, 200, {
      message: "Feature consent updated",
      features: {
        dealParsing: consent.allowDealParsing,
        chatAssistant: consent.allowChatAssistant,
        documentAnalysis: consent.allowDocumentAnalysis,
        insights: consent.allowInsights,
      }
    });
  } catch (error) {
    console.error('[AI-CONSENT] Error updating feature consent:', error);
    sendError(res, error.status || 500, error.message || "Failed to update feature consent");
  }
}

/**
 * GET /api/ai-consent/policy
 *
 * Get the current AI consent policy.
 */
export async function handleGetPolicy(req, res) {
  try {
    const policy = await getCurrentPolicy();

    sendJson(res, 200, {
      version: policy.version,
      title: policy.title,
      summary: policy.summary,
      content: policy.content,
      effectiveDate: policy.effectiveDate,
    });
  } catch (error) {
    console.error('[AI-CONSENT] Error getting policy:', error);
    sendError(res, 500, "Failed to get consent policy");
  }
}

/**
 * GET /api/ai-consent/history
 *
 * Get consent audit history for the authenticated user.
 * Query params: limit (default 50), offset (default 0)
 */
export async function handleGetConsentHistory(req, res, authUser, url) {
  if (!authUser) {
    return sendError(res, 401, "Authentication required");
  }

  try {
    const limit = parseInt(url.searchParams.get('limit')) || 50;
    const offset = parseInt(url.searchParams.get('offset')) || 0;

    const history = await getConsentAuditHistory(authUser.id, { limit, offset });

    sendJson(res, 200, {
      history: history.map(h => ({
        action: h.action,
        policyVersion: h.policyVersion,
        createdAt: h.createdAt,
        reason: h.reason,
      })),
      pagination: {
        limit,
        offset,
        count: history.length,
      }
    });
  } catch (error) {
    console.error('[AI-CONSENT] Error getting consent history:', error);
    sendError(res, 500, "Failed to get consent history");
  }
}

export default {
  handleGetConsentStatus,
  handleGrantConsent,
  handleWithdrawConsent,
  handleUpdateFeatureConsent,
  handleGetPolicy,
  handleGetConsentHistory,
};
