/**
 * Verification Queue Routes
 *
 * API endpoints for managing extraction claims and verification workflow.
 *
 * Endpoints:
 * - GET    /api/deals/:dealId/claims          - Get all claims
 * - GET    /api/deals/:dealId/claims/pending  - Get pending claims
 * - GET    /api/deals/:dealId/claims/stats    - Get verification stats
 * - GET    /api/claims/:claimId               - Get single claim
 * - POST   /api/claims/:claimId/verify        - Verify a claim
 * - POST   /api/claims/:claimId/reject        - Reject a claim
 * - POST   /api/deals/:dealId/claims/bulk-verify  - Bulk verify claims
 * - POST   /api/deals/:dealId/claims/bulk-reject  - Bulk reject claims
 * - GET    /api/deals/:dealId/claims/field/:fieldPath/history - Field claim history
 */

import { extractionClaimService } from '../services/extraction-claim-service.js';

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-User-Id, X-Canonical-User-Id, X-Actor-Role",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS"
  });
  res.end(JSON.stringify(payload));
}

/**
 * Get all claims for a deal
 */
async function handleGetClaims(req, res, dealId) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const status = url.searchParams.get('status');
    const fieldPath = url.searchParams.get('fieldPath');
    const documentId = url.searchParams.get('documentId');
    const limit = url.searchParams.get('limit');

    const claims = await extractionClaimService.getClaims(dealId, {
      status,
      fieldPath,
      documentId,
      limit: limit ? parseInt(limit) : undefined
    });

    sendJson(res, 200, {
      success: true,
      claims,
      count: claims.length
    });
  } catch (error) {
    console.error('Error fetching claims:', error);
    sendJson(res, 500, {
      success: false,
      error: error.message
    });
  }
}

/**
 * Get pending claims for a deal (verification queue)
 */
async function handleGetPendingClaims(req, res, dealId) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const sortBy = url.searchParams.get('sortBy') || 'confidence';
    const order = url.searchParams.get('order') || 'asc';
    const documentType = url.searchParams.get('documentType');

    const claims = await extractionClaimService.getPendingClaims(dealId, {
      sortBy,
      order,
      documentType
    });

    // Group by document for UI convenience
    const byDocument = claims.reduce((acc, claim) => {
      const docName = claim.source.documentName || 'Unknown';
      if (!acc[docName]) {
        acc[docName] = {
          documentName: docName,
          documentType: claim.source.documentType,
          claims: []
        };
      }
      acc[docName].claims.push(claim);
      return acc;
    }, {});

    sendJson(res, 200, {
      success: true,
      claims,
      byDocument: Object.values(byDocument),
      count: claims.length
    });
  } catch (error) {
    console.error('Error fetching pending claims:', error);
    sendJson(res, 500, {
      success: false,
      error: error.message
    });
  }
}

/**
 * Get verification statistics for a deal
 */
async function handleGetClaimStats(req, res, dealId) {
  try {
    const stats = await extractionClaimService.getVerificationStats(dealId);

    sendJson(res, 200, {
      success: true,
      stats
    });
  } catch (error) {
    console.error('Error fetching claim stats:', error);
    sendJson(res, 500, {
      success: false,
      error: error.message
    });
  }
}

/**
 * Get claim history for a specific field
 */
async function handleGetFieldHistory(req, res, dealId, fieldPath) {
  try {
    const history = await extractionClaimService.getFieldClaimHistory(dealId, fieldPath);

    sendJson(res, 200, {
      success: true,
      fieldPath,
      history,
      count: history.length
    });
  } catch (error) {
    console.error('Error fetching field history:', error);
    sendJson(res, 500, {
      success: false,
      error: error.message
    });
  }
}

/**
 * Get a single claim by ID
 */
async function handleGetClaim(req, res, claimId) {
  try {
    const claim = await extractionClaimService.getClaim(claimId);

    sendJson(res, 200, {
      success: true,
      claim
    });
  } catch (error) {
    console.error('Error fetching claim:', error);
    sendJson(res, error.message === 'Claim not found' ? 404 : 500, {
      success: false,
      error: error.message
    });
  }
}

/**
 * Verify a claim (approve it)
 * @param {object} authUser - Validated auth user from dispatch (NOT spoofable headers)
 */
async function handleVerifyClaim(req, res, claimId, readJsonBody, authUser) {
  try {
    const body = await readJsonBody(req);
    const { correctedValue } = body || {};

    // SECURITY: Use validated authUser identity, NOT spoofable headers
    const actor = {
      id: authUser.id,
      name: authUser.name || 'Unknown',
      role: authUser.role || 'GP'
    };

    const claim = await extractionClaimService.verifyClaim(claimId, actor, {
      correctedValue
    });

    sendJson(res, 200, {
      success: true,
      message: 'Claim verified successfully',
      claim
    });
  } catch (error) {
    console.error('Error verifying claim:', error);
    sendJson(res, error.message.includes('not found') ? 404 : 400, {
      success: false,
      error: error.message
    });
  }
}

/**
 * Reject a claim
 * @param {object} authUser - Validated auth user from dispatch (NOT spoofable headers)
 */
async function handleRejectClaim(req, res, claimId, readJsonBody, authUser) {
  try {
    const body = await readJsonBody(req);
    const { reason } = body || {};

    if (!reason) {
      return sendJson(res, 400, {
        success: false,
        error: 'Rejection reason is required'
      });
    }

    // SECURITY: Use validated authUser identity, NOT spoofable headers
    const actor = {
      id: authUser.id,
      name: authUser.name || 'Unknown',
      role: authUser.role || 'GP'
    };

    const claim = await extractionClaimService.rejectClaim(claimId, actor, reason);

    sendJson(res, 200, {
      success: true,
      message: 'Claim rejected',
      claim
    });
  } catch (error) {
    console.error('Error rejecting claim:', error);
    sendJson(res, error.message.includes('not found') ? 404 : 400, {
      success: false,
      error: error.message
    });
  }
}

/**
 * Bulk verify claims
 * @param {object} authUser - Validated auth user from dispatch (NOT spoofable headers)
 */
async function handleBulkVerify(req, res, dealId, readJsonBody, authUser) {
  try {
    const body = await readJsonBody(req);
    const { claimIds, minConfidence } = body || {};

    // SECURITY: Use validated authUser identity, NOT spoofable headers
    const actor = {
      id: authUser.id,
      name: authUser.name || 'Unknown',
      role: authUser.role || 'GP'
    };

    const results = await extractionClaimService.bulkVerify(dealId, actor, {
      claimIds,
      minConfidence: minConfidence ? parseFloat(minConfidence) : undefined
    });

    sendJson(res, 200, {
      success: true,
      message: `Verified ${results.verified.length} claims`,
      results
    });
  } catch (error) {
    console.error('Error bulk verifying claims:', error);
    sendJson(res, 500, {
      success: false,
      error: error.message
    });
  }
}

/**
 * Bulk reject claims
 * @param {object} authUser - Validated auth user from dispatch (NOT spoofable headers)
 */
async function handleBulkReject(req, res, dealId, readJsonBody, authUser) {
  try {
    const body = await readJsonBody(req);
    const { claimIds, reason } = body || {};

    if (!claimIds || claimIds.length === 0) {
      return sendJson(res, 400, {
        success: false,
        error: 'claimIds array is required'
      });
    }

    if (!reason) {
      return sendJson(res, 400, {
        success: false,
        error: 'Rejection reason is required'
      });
    }

    // SECURITY: Use validated authUser identity, NOT spoofable headers
    const actor = {
      id: authUser.id,
      name: authUser.name || 'Unknown',
      role: authUser.role || 'GP'
    };

    const results = await extractionClaimService.bulkReject(claimIds, actor, reason);

    sendJson(res, 200, {
      success: true,
      message: `Rejected ${results.rejected.length} claims`,
      results
    });
  } catch (error) {
    console.error('Error bulk rejecting claims:', error);
    sendJson(res, 500, {
      success: false,
      error: error.message
    });
  }
}

export {
  handleGetClaims,
  handleGetPendingClaims,
  handleGetClaimStats,
  handleGetFieldHistory,
  handleGetClaim,
  handleVerifyClaim,
  handleRejectClaim,
  handleBulkVerify,
  handleBulkReject
};
