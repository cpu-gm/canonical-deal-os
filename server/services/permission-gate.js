/**
 * Permission Gate Service
 *
 * Manages buyer authorization workflow:
 * - Review queue for broker/seller
 * - Authorization decisions (approve/decline/revoke)
 * - NDA tracking
 * - Data room access control
 * - Handoff to Active DD
 *
 * Part of Phase 4: Permission Gate
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Debug logging helper
const DEBUG = process.env.DEBUG_PERMISSION_GATE === 'true' || process.env.DEBUG === 'true';
function debugLog(context, message, data = null) {
  if (DEBUG) {
    const timestamp = new Date().toISOString();
    console.log(`[PERMISSION_GATE ${timestamp}] [${context}] ${message}`);
    if (data) {
      console.log(JSON.stringify(data, null, 2));
    }
  }
}

// Authorization statuses
export const AUTH_STATUSES = {
  PENDING: 'PENDING',
  AUTHORIZED: 'AUTHORIZED',
  DECLINED: 'DECLINED',
  REVOKED: 'REVOKED'
};

// NDA statuses
export const NDA_STATUSES = {
  NOT_SENT: 'NOT_SENT',
  SENT: 'SENT',
  SIGNED: 'SIGNED',
  EXPIRED: 'EXPIRED'
};

// Data room access levels
export const ACCESS_LEVELS = {
  STANDARD: 'STANDARD',
  FULL: 'FULL',
  CUSTOM: 'CUSTOM'
};

/**
 * Permission Gate Service
 */
class PermissionGateService {
  /**
   * Get the review queue for a deal
   * Shows all buyer responses awaiting broker/seller review
   *
   * @param {string} dealDraftId - The deal draft ID
   * @param {Object} options - Filter options
   * @returns {Array} List of buyers pending review
   */
  async getReviewQueue(dealDraftId, options = {}) {
    debugLog('getReviewQueue', 'Fetching review queue', { dealDraftId, options });

    const whereClause = {
      dealDraftId,
      response: { in: ['INTERESTED', 'INTERESTED_WITH_CONDITIONS'] }
    };

    // Get all interested buyer responses
    const responses = await prisma.buyerResponse.findMany({
      where: whereClause,
      orderBy: { respondedAt: 'desc' }
    });

    debugLog('getReviewQueue', 'Found responses', { count: responses.length });

    // Enrich with authorization status and buyer info
    const enrichedQueue = await Promise.all(
      responses.map(async (response) => {
        // Get or create authorization record
        let authorization = await prisma.buyerAuthorization.findUnique({
          where: {
            dealDraftId_buyerUserId: {
              dealDraftId,
              buyerUserId: response.buyerUserId
            }
          }
        });

        // Get buyer info
        const buyer = await prisma.authUser.findUnique({
          where: { id: response.buyerUserId },
          include: { organization: true }
        });

        // Get distribution recipient for match info
        const recipient = await prisma.distributionRecipient.findFirst({
          where: {
            buyerUserId: response.buyerUserId,
            distribution: { dealDraftId }
          }
        });

        // Get AI triage score if available
        let aiScore = null;
        const criteria = await prisma.buyerAICriteria.findUnique({
          where: { userId: response.buyerUserId }
        });
        if (criteria) {
          const triage = await prisma.buyerAITriage.findUnique({
            where: {
              buyerCriteriaId_dealDraftId: {
                buyerCriteriaId: criteria.id,
                dealDraftId
              }
            }
          });
          if (triage) {
            aiScore = triage.relevanceScore;
          }
        }

        return {
          response: {
            ...response,
            questionsForBroker: response.questionsForBroker
              ? JSON.parse(response.questionsForBroker)
              : null,
            conditions: response.conditions
              ? JSON.parse(response.conditions)
              : null
          },
          authorization: authorization || { status: 'NOT_REVIEWED' },
          buyer: buyer ? {
            id: buyer.id,
            name: buyer.name,
            email: buyer.email,
            firmName: buyer.organization?.name,
            isAnonymous: recipient?.isAnonymous || false,
            anonymousLabel: recipient?.anonymousLabel
          } : null,
          aiScore,
          matchType: recipient?.matchType,
          viewedAt: recipient?.viewedAt
        };
      })
    );

    // Filter by authorization status if specified
    let filteredQueue = enrichedQueue;
    if (options.status) {
      filteredQueue = enrichedQueue.filter(
        item => item.authorization.status === options.status
      );
    }

    // Filter to only pending by default (not yet authorized/declined)
    if (options.pendingOnly !== false) {
      filteredQueue = filteredQueue.filter(
        item => item.authorization.status === 'NOT_REVIEWED' ||
                item.authorization.status === AUTH_STATUSES.PENDING
      );
    }

    debugLog('getReviewQueue', 'Queue ready', {
      total: enrichedQueue.length,
      filtered: filteredQueue.length
    });

    return filteredQueue;
  }

  /**
   * Authorize a buyer for due diligence
   *
   * @param {string} dealDraftId - The deal draft ID
   * @param {string} buyerUserId - The buyer user ID
   * @param {Object} options - Authorization options
   * @param {Object} actor - The user authorizing
   * @returns {Object} Updated authorization record
   */
  async authorizeBuyer(dealDraftId, buyerUserId, options = {}, actor) {
    debugLog('authorizeBuyer', 'Authorizing buyer', {
      dealDraftId,
      buyerUserId,
      actorId: actor.id
    });

    // Verify buyer has responded with interest
    const response = await prisma.buyerResponse.findUnique({
      where: {
        dealDraftId_buyerUserId: { dealDraftId, buyerUserId }
      }
    });

    if (!response) {
      debugLog('authorizeBuyer', 'No response found for buyer');
      throw new Error('Buyer has not responded to this deal');
    }

    if (response.response === 'PASS') {
      debugLog('authorizeBuyer', 'Buyer passed on this deal');
      throw new Error('Cannot authorize a buyer who passed on the deal');
    }

    // Check if seller approval is required
    const seller = await prisma.dealDraftSeller.findUnique({
      where: { dealDraftId }
    });
    const requiresSellerApproval = seller?.requiresBuyerApproval || false;

    // Upsert authorization record
    const authorization = await prisma.buyerAuthorization.upsert({
      where: {
        dealDraftId_buyerUserId: { dealDraftId, buyerUserId }
      },
      update: {
        status: AUTH_STATUSES.AUTHORIZED,
        authorizedBy: actor.id,
        authorizedByName: actor.name || actor.email,
        authorizedAt: new Date(),
        sellerApprovalRequired: requiresSellerApproval,
        dataRoomAccessLevel: options.accessLevel || ACCESS_LEVELS.STANDARD
      },
      create: {
        dealDraftId,
        buyerUserId,
        status: AUTH_STATUSES.AUTHORIZED,
        authorizedBy: actor.id,
        authorizedByName: actor.name || actor.email,
        authorizedAt: new Date(),
        sellerApprovalRequired: requiresSellerApproval,
        dataRoomAccessLevel: options.accessLevel || ACCESS_LEVELS.STANDARD
      }
    });

    debugLog('authorizeBuyer', 'Authorization created', {
      authorizationId: authorization.id
    });

    // Log event
    await this._logEvent(dealDraftId, 'BUYER_AUTHORIZED', {
      buyerUserId,
      authorizedBy: actor.id,
      accessLevel: authorization.dataRoomAccessLevel
    }, actor);

    return authorization;
  }

  /**
   * Decline a buyer
   *
   * @param {string} dealDraftId - The deal draft ID
   * @param {string} buyerUserId - The buyer user ID
   * @param {string} reason - Reason for declining
   * @param {Object} actor - The user declining
   * @returns {Object} Updated authorization record
   */
  async declineBuyer(dealDraftId, buyerUserId, reason, actor) {
    debugLog('declineBuyer', 'Declining buyer', {
      dealDraftId,
      buyerUserId,
      actorId: actor.id
    });

    const authorization = await prisma.buyerAuthorization.upsert({
      where: {
        dealDraftId_buyerUserId: { dealDraftId, buyerUserId }
      },
      update: {
        status: AUTH_STATUSES.DECLINED,
        declinedBy: actor.id,
        declinedAt: new Date(),
        declineReason: reason
      },
      create: {
        dealDraftId,
        buyerUserId,
        status: AUTH_STATUSES.DECLINED,
        declinedBy: actor.id,
        declinedAt: new Date(),
        declineReason: reason
      }
    });

    debugLog('declineBuyer', 'Buyer declined', { authorizationId: authorization.id });

    // Log event
    await this._logEvent(dealDraftId, 'BUYER_DECLINED', {
      buyerUserId,
      declinedBy: actor.id,
      reason
    }, actor);

    return authorization;
  }

  /**
   * Revoke a previously authorized buyer's access
   *
   * @param {string} dealDraftId - The deal draft ID
   * @param {string} buyerUserId - The buyer user ID
   * @param {string} reason - Reason for revoking
   * @param {Object} actor - The user revoking
   * @returns {Object} Updated authorization record
   */
  async revokeBuyer(dealDraftId, buyerUserId, reason, actor) {
    debugLog('revokeBuyer', 'Revoking buyer access', {
      dealDraftId,
      buyerUserId,
      actorId: actor.id
    });

    const existing = await prisma.buyerAuthorization.findUnique({
      where: {
        dealDraftId_buyerUserId: { dealDraftId, buyerUserId }
      }
    });

    if (!existing || existing.status !== AUTH_STATUSES.AUTHORIZED) {
      debugLog('revokeBuyer', 'Buyer not currently authorized');
      throw new Error('Buyer is not currently authorized');
    }

    const authorization = await prisma.buyerAuthorization.update({
      where: {
        dealDraftId_buyerUserId: { dealDraftId, buyerUserId }
      },
      data: {
        status: AUTH_STATUSES.REVOKED,
        revokedBy: actor.id,
        revokedAt: new Date(),
        revokeReason: reason,
        dataRoomAccessGranted: false
      }
    });

    debugLog('revokeBuyer', 'Access revoked', { authorizationId: authorization.id });

    // Log event
    await this._logEvent(dealDraftId, 'BUYER_ACCESS_REVOKED', {
      buyerUserId,
      revokedBy: actor.id,
      reason
    }, actor);

    return authorization;
  }

  /**
   * Send NDA to authorized buyer
   *
   * @param {string} dealDraftId - The deal draft ID
   * @param {string} buyerUserId - The buyer user ID
   * @param {Object} actor - The user sending NDA
   * @returns {Object} Updated authorization record
   */
  async sendNDA(dealDraftId, buyerUserId, actor) {
    debugLog('sendNDA', 'Sending NDA', { dealDraftId, buyerUserId });

    const authorization = await prisma.buyerAuthorization.findUnique({
      where: {
        dealDraftId_buyerUserId: { dealDraftId, buyerUserId }
      }
    });

    if (!authorization || authorization.status !== AUTH_STATUSES.AUTHORIZED) {
      throw new Error('Buyer must be authorized before sending NDA');
    }

    if (authorization.ndaStatus === NDA_STATUSES.SIGNED) {
      throw new Error('NDA already signed');
    }

    const updated = await prisma.buyerAuthorization.update({
      where: {
        dealDraftId_buyerUserId: { dealDraftId, buyerUserId }
      },
      data: {
        ndaStatus: NDA_STATUSES.SENT,
        ndaSentAt: new Date()
      }
    });

    debugLog('sendNDA', 'NDA sent', { authorizationId: updated.id });

    // Log event
    await this._logEvent(dealDraftId, 'NDA_SENT', {
      buyerUserId,
      sentBy: actor.id
    }, actor);

    return updated;
  }

  /**
   * Record NDA signature
   *
   * @param {string} dealDraftId - The deal draft ID
   * @param {string} buyerUserId - The buyer user ID
   * @param {string} ndaDocumentId - The signed NDA document ID
   * @returns {Object} Updated authorization record
   */
  async recordNDASigned(dealDraftId, buyerUserId, ndaDocumentId) {
    debugLog('recordNDASigned', 'Recording NDA signature', {
      dealDraftId,
      buyerUserId
    });

    const authorization = await prisma.buyerAuthorization.findUnique({
      where: {
        dealDraftId_buyerUserId: { dealDraftId, buyerUserId }
      }
    });

    if (!authorization || authorization.ndaStatus !== NDA_STATUSES.SENT) {
      throw new Error('NDA must be sent before it can be signed');
    }

    // Look up buyer info for logging
    const buyer = await prisma.authUser.findUnique({
      where: { id: buyerUserId },
      select: { name: true, email: true }
    });

    const updated = await prisma.buyerAuthorization.update({
      where: {
        dealDraftId_buyerUserId: { dealDraftId, buyerUserId }
      },
      data: {
        ndaStatus: NDA_STATUSES.SIGNED,
        ndaSignedAt: new Date(),
        ndaDocumentId,
        dataRoomAccessGranted: true
      }
    });

    debugLog('recordNDASigned', 'NDA signed, data room access granted', {
      authorizationId: updated.id
    });

    // Log event
    await this._logEvent(dealDraftId, 'NDA_SIGNED', {
      buyerUserId,
      ndaDocumentId
    }, { id: buyerUserId, name: buyer?.name || buyer?.email || 'Buyer', role: 'BUYER' });

    return updated;
  }

  /**
   * Grant data room access (after NDA signed)
   *
   * @param {string} dealDraftId - The deal draft ID
   * @param {string} buyerUserId - The buyer user ID
   * @param {string} accessLevel - Access level (STANDARD, FULL, CUSTOM)
   * @param {Object} actor - The user granting access
   * @returns {Object} Updated authorization record
   */
  async grantDataRoomAccess(dealDraftId, buyerUserId, accessLevel, actor) {
    debugLog('grantDataRoomAccess', 'Granting data room access', {
      dealDraftId,
      buyerUserId,
      accessLevel
    });

    const authorization = await prisma.buyerAuthorization.findUnique({
      where: {
        dealDraftId_buyerUserId: { dealDraftId, buyerUserId }
      }
    });

    if (!authorization || authorization.status !== AUTH_STATUSES.AUTHORIZED) {
      throw new Error('Buyer must be authorized');
    }

    if (authorization.ndaStatus !== NDA_STATUSES.SIGNED) {
      throw new Error('NDA must be signed before granting data room access');
    }

    const updated = await prisma.buyerAuthorization.update({
      where: {
        dealDraftId_buyerUserId: { dealDraftId, buyerUserId }
      },
      data: {
        dataRoomAccessGranted: true,
        dataRoomAccessLevel: accessLevel
      }
    });

    debugLog('grantDataRoomAccess', 'Access granted', {
      authorizationId: updated.id,
      accessLevel
    });

    // Log event
    await this._logEvent(dealDraftId, 'DATA_ROOM_ACCESS_GRANTED', {
      buyerUserId,
      accessLevel,
      grantedBy: actor.id
    }, actor);

    return updated;
  }

  /**
   * Get authorization status for a buyer
   *
   * @param {string} dealDraftId - The deal draft ID
   * @param {string} buyerUserId - The buyer user ID
   * @returns {Object} Authorization record or null
   */
  async getAuthorizationStatus(dealDraftId, buyerUserId) {
    debugLog('getAuthorizationStatus', 'Fetching status', {
      dealDraftId,
      buyerUserId
    });

    const authorization = await prisma.buyerAuthorization.findUnique({
      where: {
        dealDraftId_buyerUserId: { dealDraftId, buyerUserId }
      }
    });

    return authorization;
  }

  /**
   * Get all authorizations for a deal
   *
   * @param {string} dealDraftId - The deal draft ID
   * @param {Object} options - Filter options
   * @returns {Array} List of authorization records
   */
  async getAuthorizationsForDeal(dealDraftId, options = {}) {
    debugLog('getAuthorizationsForDeal', 'Fetching authorizations', {
      dealDraftId,
      options
    });

    const whereClause = { dealDraftId };

    if (options.status) {
      whereClause.status = options.status;
    }

    const authorizations = await prisma.buyerAuthorization.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' }
    });

    // Enrich with buyer info
    const enriched = await Promise.all(
      authorizations.map(async (auth) => {
        const buyer = await prisma.authUser.findUnique({
          where: { id: auth.buyerUserId },
          include: { organization: true }
        });

        return {
          ...auth,
          buyer: buyer ? {
            id: buyer.id,
            name: buyer.name,
            email: buyer.email,
            firmName: buyer.organization?.name
          } : null
        };
      })
    );

    debugLog('getAuthorizationsForDeal', 'Authorizations found', {
      count: enriched.length
    });

    return enriched;
  }

  /**
   * Advance deal to Active DD state
   * Called when at least one buyer has signed NDA and has data room access
   *
   * @param {string} dealDraftId - The deal draft ID
   * @param {Object} actor - The user advancing the deal
   * @returns {Object} Updated deal draft
   */
  async advanceToActiveDD(dealDraftId, actor) {
    debugLog('advanceToActiveDD', 'Advancing deal to Active DD', { dealDraftId });

    // Check if any buyer has data room access
    const authorizedWithAccess = await prisma.buyerAuthorization.findFirst({
      where: {
        dealDraftId,
        status: AUTH_STATUSES.AUTHORIZED,
        ndaStatus: NDA_STATUSES.SIGNED,
        dataRoomAccessGranted: true
      }
    });

    if (!authorizedWithAccess) {
      debugLog('advanceToActiveDD', 'No buyers with data room access');
      throw new Error('At least one buyer must have signed NDA and data room access');
    }

    const dealDraft = await prisma.dealDraft.update({
      where: { id: dealDraftId },
      data: { status: 'ACTIVE_DD' }
    });

    debugLog('advanceToActiveDD', 'Deal advanced to ACTIVE_DD', {
      dealDraftId: dealDraft.id
    });

    // Log event
    await this._logEvent(dealDraftId, 'DEAL_ADVANCED_TO_DD', {
      advancedBy: actor.id,
      authorizedBuyerCount: await prisma.buyerAuthorization.count({
        where: { dealDraftId, status: AUTH_STATUSES.AUTHORIZED }
      })
    }, actor);

    return dealDraft;
  }

  /**
   * Get deal progress summary
   *
   * @param {string} dealDraftId - The deal draft ID
   * @returns {Object} Progress summary
   */
  async getDealProgress(dealDraftId) {
    debugLog('getDealProgress', 'Getting deal progress', { dealDraftId });

    const dealDraft = await prisma.dealDraft.findUnique({
      where: { id: dealDraftId }
    });

    if (!dealDraft) {
      throw new Error('Deal not found');
    }

    // Count various states
    const [
      totalDistributed,
      totalResponded,
      interestedCount,
      authorizedCount,
      ndaSignedCount,
      dataRoomAccessCount
    ] = await Promise.all([
      prisma.distributionRecipient.count({
        where: { distribution: { dealDraftId } }
      }),
      prisma.buyerResponse.count({
        where: { dealDraftId }
      }),
      prisma.buyerResponse.count({
        where: {
          dealDraftId,
          response: { in: ['INTERESTED', 'INTERESTED_WITH_CONDITIONS'] }
        }
      }),
      prisma.buyerAuthorization.count({
        where: { dealDraftId, status: AUTH_STATUSES.AUTHORIZED }
      }),
      prisma.buyerAuthorization.count({
        where: { dealDraftId, ndaStatus: NDA_STATUSES.SIGNED }
      }),
      prisma.buyerAuthorization.count({
        where: { dealDraftId, dataRoomAccessGranted: true }
      })
    ]);

    const progress = {
      dealStatus: dealDraft.status,
      funnel: {
        distributed: totalDistributed,
        responded: totalResponded,
        interested: interestedCount,
        authorized: authorizedCount,
        ndaSigned: ndaSignedCount,
        inDataRoom: dataRoomAccessCount
      },
      canAdvanceToDD: dataRoomAccessCount > 0 && dealDraft.status !== 'ACTIVE_DD'
    };

    debugLog('getDealProgress', 'Progress calculated', progress);
    return progress;
  }

  /**
   * Log an event to the deal event log
   * @private
   */
  async _logEvent(dealDraftId, eventType, eventData, actor) {
    const dealDraft = await prisma.dealDraft.findUnique({
      where: { id: dealDraftId },
      select: { organizationId: true }
    });

    if (dealDraft) {
      await prisma.dealIntakeEventLog.create({
        data: {
          dealDraftId,
          organizationId: dealDraft.organizationId,
          eventType,
          eventData: JSON.stringify(eventData),
          actorId: actor.id,
          actorName: actor.name || actor.email,
          actorRole: actor.role || 'BROKER'
        }
      });
    }
  }
}

// Export singleton instance
export const permissionGateService = new PermissionGateService();

// Export class for testing
export { PermissionGateService };
