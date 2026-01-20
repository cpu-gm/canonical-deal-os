/**
 * Distribution Service
 *
 * Manages deal distribution to buyers, including:
 * - Public vs private listing distribution
 * - Auto-matching buyers based on criteria
 * - Manual recipient management
 * - Engagement tracking (views, duration)
 *
 * Part of Phase 3: Distribution + Buyer AI
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Debug logging helper
const DEBUG = process.env.DEBUG_DISTRIBUTION === 'true' || process.env.DEBUG === 'true';
function debugLog(context, message, data = null) {
  if (DEBUG) {
    const timestamp = new Date().toISOString();
    console.log(`[DISTRIBUTION ${timestamp}] [${context}] ${message}`);
    if (data) {
      console.log(JSON.stringify(data, null, 2));
    }
  }
}

// Distribution status constants
export const DISTRIBUTION_STATUSES = {
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  PAUSED: 'PAUSED',
  CLOSED: 'CLOSED'
};

// Listing types
export const LISTING_TYPES = {
  PUBLIC: 'PUBLIC',    // Platform auto-matches buyers
  PRIVATE: 'PRIVATE'   // Broker manually selects recipients
};

// Match types for recipients
export const MATCH_TYPES = {
  AUTO_MATCHED: 'AUTO_MATCHED',
  MANUAL: 'MANUAL'
};

// Buyer response types
export const RESPONSE_TYPES = {
  INTERESTED: 'INTERESTED',
  INTERESTED_WITH_CONDITIONS: 'INTERESTED_WITH_CONDITIONS',
  PASS: 'PASS'
};

/**
 * Distribution Service
 */
class DistributionService {
  /**
   * Create a distribution for a deal
   *
   * @param {string} dealDraftId - The deal draft ID
   * @param {Object} options - Distribution options
   * @param {string} options.listingType - PUBLIC or PRIVATE
   * @param {string[]} options.manualRecipientIds - Manual recipient user IDs (for PRIVATE)
   * @param {Object} actor - The user initiating distribution
   * @returns {Object} Created distribution with recipients
   */
  async createDistribution(dealDraftId, options, actor) {
    debugLog('createDistribution', 'Starting distribution creation', { dealDraftId, options, actorId: actor.id });

    // Validate deal exists and is ready for distribution
    const dealDraft = await prisma.dealDraft.findUnique({
      where: { id: dealDraftId },
      include: {
        omVersions: {
          where: { status: 'SELLER_APPROVED' },
          orderBy: { versionNumber: 'desc' },
          take: 1
        },
        brokers: true
      }
    });

    if (!dealDraft) {
      debugLog('createDistribution', 'Deal not found', { dealDraftId });
      throw new Error('Deal not found');
    }

    // Verify actor is a broker on this deal
    const isBroker = dealDraft.brokers.some(b => b.userId === actor.id);
    if (!isBroker) {
      debugLog('createDistribution', 'Actor is not a broker on this deal', { actorId: actor.id });
      throw new Error('Only brokers can initiate distribution');
    }

    // Require seller-approved OM
    if (dealDraft.omVersions.length === 0) {
      debugLog('createDistribution', 'No seller-approved OM version', { dealDraftId });
      throw new Error('Deal must have a seller-approved OM before distribution');
    }

    const omVersion = dealDraft.omVersions[0];
    debugLog('createDistribution', 'Using OM version', { omVersionId: omVersion.id, versionNumber: omVersion.versionNumber });

    // Create distribution
    const distribution = await prisma.dealDistribution.create({
      data: {
        dealDraftId,
        omVersionId: omVersion.id,
        listingType: options.listingType || LISTING_TYPES.PRIVATE,
        distributedBy: actor.id,
        distributedByName: actor.name || actor.email
      }
    });

    debugLog('createDistribution', 'Distribution created', { distributionId: distribution.id });

    // Add recipients based on listing type
    let recipients = [];

    if (options.listingType === LISTING_TYPES.PUBLIC) {
      // Auto-match buyers based on criteria
      recipients = await this._autoMatchBuyers(dealDraft, distribution.id);
      debugLog('createDistribution', 'Auto-matched buyers', { count: recipients.length });
    }

    // Add manual recipients (works for both PUBLIC and PRIVATE)
    if (options.manualRecipientIds && options.manualRecipientIds.length > 0) {
      const manualRecipients = await this._addManualRecipients(
        distribution.id,
        options.manualRecipientIds,
        dealDraft.organizationId
      );
      recipients = [...recipients, ...manualRecipients];
      debugLog('createDistribution', 'Added manual recipients', { count: manualRecipients.length });
    }

    // Update deal status to DISTRIBUTED
    await prisma.dealDraft.update({
      where: { id: dealDraftId },
      data: {
        status: 'DISTRIBUTED',
        listingType: options.listingType
      }
    });

    // Log event
    await this._logEvent(dealDraftId, dealDraft.organizationId, 'DISTRIBUTION_CREATED', {
      distributionId: distribution.id,
      listingType: options.listingType,
      recipientCount: recipients.length
    }, actor);

    debugLog('createDistribution', 'Distribution complete', {
      distributionId: distribution.id,
      recipientCount: recipients.length
    });

    return {
      distribution,
      recipients
    };
  }

  /**
   * Auto-match buyers based on their criteria
   * @private
   */
  async _autoMatchBuyers(dealDraft, distributionId) {
    debugLog('_autoMatchBuyers', 'Starting auto-match', { dealDraftId: dealDraft.id });

    // Get all buyer criteria profiles with auto-receive enabled
    const buyerCriteria = await prisma.buyerAICriteria.findMany({
      where: {
        autoReceiveMatches: true,
        // Exclude buyers from seller's organization
        organizationId: { not: dealDraft.organizationId }
      }
    });

    debugLog('_autoMatchBuyers', 'Found buyer criteria profiles', { count: buyerCriteria.length });

    const matchedRecipients = [];

    for (const criteria of buyerCriteria) {
      const matchResult = this._evaluateCriteriaMatch(dealDraft, criteria);

      if (matchResult.passes && matchResult.score >= criteria.minMatchScore) {
        debugLog('_autoMatchBuyers', 'Buyer matches', {
          userId: criteria.userId,
          score: matchResult.score
        });

        // Get buyer user info
        const buyerUser = await prisma.authUser.findUnique({
          where: { id: criteria.userId },
          include: { organization: true }
        });

        if (buyerUser) {
          // Check if buyer has anonymity enabled
          const isAnonymous = buyerUser.isAnonymousBuyer || false;

          const recipient = await prisma.distributionRecipient.create({
            data: {
              distributionId,
              buyerUserId: criteria.userId,
              buyerEmail: buyerUser.email,
              buyerName: buyerUser.name || buyerUser.email,
              buyerFirmName: buyerUser.organization?.name,
              matchType: MATCH_TYPES.AUTO_MATCHED,
              matchScore: matchResult.score,
              matchReason: matchResult.reason,
              isAnonymous,
              anonymousLabel: isAnonymous ? 'Anonymous Buyer' : null
            }
          });

          matchedRecipients.push(recipient);
        }
      }
    }

    debugLog('_autoMatchBuyers', 'Auto-matching complete', { matchedCount: matchedRecipients.length });
    return matchedRecipients;
  }

  /**
   * Evaluate if a deal matches buyer criteria
   * @private
   */
  _evaluateCriteriaMatch(dealDraft, criteria) {
    debugLog('_evaluateCriteriaMatch', 'Evaluating criteria', {
      dealDraftId: dealDraft.id,
      criteriaId: criteria.id
    });

    let passes = true;
    let score = 100;
    const reasons = [];

    // Parse criteria JSON fields
    const assetTypes = criteria.assetTypes ? JSON.parse(criteria.assetTypes) : null;
    const geoInclude = criteria.geographiesInclude ? JSON.parse(criteria.geographiesInclude) : null;
    const geoExclude = criteria.geographiesExclude ? JSON.parse(criteria.geographiesExclude) : null;

    // Check asset type
    if (assetTypes && assetTypes.length > 0) {
      if (!dealDraft.assetType || !assetTypes.includes(dealDraft.assetType)) {
        passes = false;
        reasons.push(`Asset type ${dealDraft.assetType || 'unknown'} not in criteria`);
      } else {
        reasons.push(`Asset type ${dealDraft.assetType} matches`);
      }
    }

    // Check geography inclusion
    if (geoInclude && geoInclude.length > 0 && dealDraft.propertyAddress) {
      const addressUpper = dealDraft.propertyAddress.toUpperCase();
      const matchesGeo = geoInclude.some(geo => addressUpper.includes(geo.toUpperCase()));
      if (!matchesGeo) {
        passes = false;
        reasons.push(`Geography not in include list`);
      } else {
        reasons.push(`Geography matches include criteria`);
      }
    }

    // Check geography exclusion
    if (geoExclude && geoExclude.length > 0 && dealDraft.propertyAddress) {
      const addressUpper = dealDraft.propertyAddress.toUpperCase();
      const excludedGeo = geoExclude.some(geo => addressUpper.includes(geo.toUpperCase()));
      if (excludedGeo) {
        passes = false;
        reasons.push(`Geography in exclude list`);
      }
    }

    // Check unit count
    if (criteria.minUnits && dealDraft.unitCount && dealDraft.unitCount < criteria.minUnits) {
      passes = false;
      reasons.push(`Units ${dealDraft.unitCount} below minimum ${criteria.minUnits}`);
    }
    if (criteria.maxUnits && dealDraft.unitCount && dealDraft.unitCount > criteria.maxUnits) {
      passes = false;
      reasons.push(`Units ${dealDraft.unitCount} above maximum ${criteria.maxUnits}`);
    }

    // Check price range
    if (criteria.minPrice && dealDraft.askingPrice && dealDraft.askingPrice < criteria.minPrice) {
      passes = false;
      reasons.push(`Price below minimum`);
    }
    if (criteria.maxPrice && dealDraft.askingPrice && dealDraft.askingPrice > criteria.maxPrice) {
      passes = false;
      reasons.push(`Price above maximum`);
    }

    // Check SF range
    if (criteria.minSF && dealDraft.totalSF && dealDraft.totalSF < criteria.minSF) {
      passes = false;
      reasons.push(`SF below minimum`);
    }
    if (criteria.maxSF && dealDraft.totalSF && dealDraft.totalSF > criteria.maxSF) {
      passes = false;
      reasons.push(`SF above maximum`);
    }

    // Calculate score based on how many criteria matched (soft scoring)
    // This is a simplified version - full AI scoring is in buyer-ai-triage.js
    if (passes) {
      // Start with base score and adjust based on specifics
      score = 75;

      // Bonus for exact asset type match
      if (assetTypes && dealDraft.assetType && assetTypes[0] === dealDraft.assetType) {
        score += 10;
      }

      // Bonus for price in sweet spot (middle of range)
      if (criteria.minPrice && criteria.maxPrice && dealDraft.askingPrice) {
        const midPoint = (criteria.minPrice + criteria.maxPrice) / 2;
        const variance = Math.abs(dealDraft.askingPrice - midPoint) / midPoint;
        if (variance < 0.1) score += 10;
        else if (variance < 0.25) score += 5;
      }
    } else {
      score = 0;
    }

    const result = {
      passes,
      score,
      reason: reasons.join('; ')
    };

    debugLog('_evaluateCriteriaMatch', 'Criteria evaluation result', result);
    return result;
  }

  /**
   * Add manual recipients to a distribution
   * @private
   */
  async _addManualRecipients(distributionId, userIds, excludeOrgId) {
    debugLog('_addManualRecipients', 'Adding manual recipients', {
      distributionId,
      userCount: userIds.length
    });

    const recipients = [];

    for (const userId of userIds) {
      // Get user info
      const user = await prisma.authUser.findUnique({
        where: { id: userId },
        include: { organization: true }
      });

      if (!user) {
        debugLog('_addManualRecipients', 'User not found, skipping', { userId });
        continue;
      }

      // Skip if user is from seller's organization
      if (user.organizationId === excludeOrgId) {
        debugLog('_addManualRecipients', 'Skipping user from seller org', { userId });
        continue;
      }

      // Check if already a recipient
      const existing = await prisma.distributionRecipient.findFirst({
        where: {
          distributionId,
          buyerUserId: userId
        }
      });

      if (existing) {
        debugLog('_addManualRecipients', 'User already recipient, skipping', { userId });
        continue;
      }

      const isAnonymous = user.isAnonymousBuyer || false;

      const recipient = await prisma.distributionRecipient.create({
        data: {
          distributionId,
          buyerUserId: userId,
          buyerEmail: user.email,
          buyerName: user.name || user.email,
          buyerFirmName: user.organization?.name,
          matchType: MATCH_TYPES.MANUAL,
          isAnonymous,
          anonymousLabel: isAnonymous ? 'Anonymous Buyer' : null
        }
      });

      recipients.push(recipient);
      debugLog('_addManualRecipients', 'Added recipient', { recipientId: recipient.id });
    }

    return recipients;
  }

  /**
   * Record that a buyer viewed the distribution
   *
   * @param {string} recipientId - The distribution recipient ID
   * @param {Object} viewData - View tracking data
   */
  async recordView(recipientId, viewData = {}) {
    debugLog('recordView', 'Recording view', { recipientId, viewData });

    const recipient = await prisma.distributionRecipient.findUnique({
      where: { id: recipientId }
    });

    if (!recipient) {
      throw new Error('Recipient not found');
    }

    const updated = await prisma.distributionRecipient.update({
      where: { id: recipientId },
      data: {
        viewedAt: recipient.viewedAt || new Date(),
        viewDurationSec: (recipient.viewDurationSec || 0) + (viewData.durationSec || 0),
        pagesViewed: viewData.pagesViewed
          ? JSON.stringify(viewData.pagesViewed)
          : recipient.pagesViewed
      }
    });

    debugLog('recordView', 'View recorded', { recipientId, viewedAt: updated.viewedAt });
    return updated;
  }

  /**
   * Submit a buyer response to a distribution
   *
   * @param {string} dealDraftId - The deal draft ID
   * @param {Object} responseData - The buyer's response
   * @param {Object} actor - The buyer user
   */
  async submitResponse(dealDraftId, responseData, actor) {
    debugLog('submitResponse', 'Submitting buyer response', {
      dealDraftId,
      response: responseData.response,
      actorId: actor.id
    });

    // Validate response type
    if (!Object.values(RESPONSE_TYPES).includes(responseData.response)) {
      throw new Error(`Invalid response type: ${responseData.response}`);
    }

    // Check if buyer has received this deal
    const recipient = await prisma.distributionRecipient.findFirst({
      where: {
        distribution: { dealDraftId },
        buyerUserId: actor.id
      }
    });

    if (!recipient) {
      debugLog('submitResponse', 'Buyer is not a recipient of this deal', { actorId: actor.id });
      throw new Error('You have not received this deal');
    }

    // Check for existing response
    const existingResponse = await prisma.buyerResponse.findFirst({
      where: {
        dealDraftId,
        buyerUserId: actor.id
      }
    });

    if (existingResponse) {
      debugLog('submitResponse', 'Buyer already responded, updating', { responseId: existingResponse.id });

      const updated = await prisma.buyerResponse.update({
        where: { id: existingResponse.id },
        data: {
          response: responseData.response,
          indicativePriceMin: responseData.indicativePriceMin,
          indicativePriceMax: responseData.indicativePriceMax,
          intendedStructure: responseData.intendedStructure,
          timelineNotes: responseData.timelineNotes,
          questionsForBroker: responseData.questionsForBroker
            ? JSON.stringify(responseData.questionsForBroker)
            : null,
          conditions: responseData.conditions
            ? JSON.stringify(responseData.conditions)
            : null,
          passReason: responseData.passReason,
          passNotes: responseData.passNotes,
          respondedAt: new Date(),
          respondedBy: actor.id,
          isConfidential: responseData.isConfidential || false
        }
      });

      // Update recipient with response reference
      await prisma.distributionRecipient.update({
        where: { id: recipient.id },
        data: { responseId: updated.id }
      });

      return updated;
    }

    // Create new response
    const response = await prisma.buyerResponse.create({
      data: {
        dealDraftId,
        buyerUserId: actor.id,
        response: responseData.response,
        indicativePriceMin: responseData.indicativePriceMin,
        indicativePriceMax: responseData.indicativePriceMax,
        intendedStructure: responseData.intendedStructure,
        timelineNotes: responseData.timelineNotes,
        questionsForBroker: responseData.questionsForBroker
          ? JSON.stringify(responseData.questionsForBroker)
          : null,
        conditions: responseData.conditions
          ? JSON.stringify(responseData.conditions)
          : null,
        passReason: responseData.passReason,
        passNotes: responseData.passNotes,
        respondedBy: actor.id,
        isConfidential: responseData.isConfidential || false
      }
    });

    // Update recipient with response reference
    await prisma.distributionRecipient.update({
      where: { id: recipient.id },
      data: { responseId: response.id }
    });

    // Log event (get deal for org ID)
    const dealDraft = await prisma.dealDraft.findUnique({
      where: { id: dealDraftId }
    });

    await this._logEvent(dealDraftId, dealDraft.organizationId, 'BUYER_RESPONSE_SUBMITTED', {
      responseId: response.id,
      responseType: responseData.response
    }, actor);

    debugLog('submitResponse', 'Response submitted', { responseId: response.id });
    return response;
  }

  /**
   * Get distribution details with recipients
   */
  async getDistribution(distributionId) {
    debugLog('getDistribution', 'Fetching distribution', { distributionId });

    const distribution = await prisma.dealDistribution.findUnique({
      where: { id: distributionId },
      include: {
        dealDraft: true,
        recipients: {
          include: {
            // Note: responseId is just a string FK, not a relation
          }
        }
      }
    });

    if (!distribution) {
      throw new Error('Distribution not found');
    }

    // Fetch responses for recipients that have them
    const recipientsWithResponses = await Promise.all(
      distribution.recipients.map(async (r) => {
        if (r.responseId) {
          const response = await prisma.buyerResponse.findUnique({
            where: { id: r.responseId }
          });
          return { ...r, response };
        }
        return { ...r, response: null };
      })
    );

    return {
      ...distribution,
      recipients: recipientsWithResponses
    };
  }

  /**
   * Get distributions for a deal
   */
  async getDistributionsForDeal(dealDraftId) {
    debugLog('getDistributionsForDeal', 'Fetching distributions', { dealDraftId });

    const distributions = await prisma.dealDistribution.findMany({
      where: { dealDraftId },
      include: {
        recipients: true
      },
      orderBy: { distributedAt: 'desc' }
    });

    return distributions;
  }

  /**
   * Get buyer's received deals (their inbox)
   */
  async getBuyerInbox(userId, options = {}) {
    debugLog('getBuyerInbox', 'Fetching buyer inbox', { userId, options });

    const whereClause = {
      buyerUserId: userId
    };

    // Filter by response status if specified
    if (options.hasResponded !== undefined) {
      whereClause.responseId = options.hasResponded ? { not: null } : null;
    }

    const recipients = await prisma.distributionRecipient.findMany({
      where: whereClause,
      include: {
        distribution: {
          include: {
            dealDraft: {
              select: {
                id: true,
                propertyName: true,
                propertyAddress: true,
                assetType: true,
                askingPrice: true,
                unitCount: true,
                status: true
              }
            }
          }
        }
      },
      orderBy: { pushedToInboxAt: 'desc' }
    });

    // Get AI triage scores if available
    const buyerCriteria = await prisma.buyerAICriteria.findUnique({
      where: { userId }
    });

    const inboxWithScores = await Promise.all(
      recipients.map(async (r) => {
        let aiScore = null;
        if (buyerCriteria) {
          const triage = await prisma.buyerAITriage.findUnique({
            where: {
              buyerCriteriaId_dealDraftId: {
                buyerCriteriaId: buyerCriteria.id,
                dealDraftId: r.distribution.dealDraftId
              }
            }
          });
          if (triage) {
            aiScore = {
              relevanceScore: triage.relevanceScore,
              passesFilters: triage.passesFilters,
              summary: triage.summary
            };
          }
        }
        return { ...r, aiScore };
      })
    );

    debugLog('getBuyerInbox', 'Inbox fetched', { count: inboxWithScores.length });
    return inboxWithScores;
  }

  /**
   * Log an event
   * @private
   */
  async _logEvent(dealDraftId, organizationId, eventType, eventData, actor) {
    await prisma.dealIntakeEventLog.create({
      data: {
        dealDraftId,
        organizationId,
        eventType,
        eventData: JSON.stringify(eventData),
        actorId: actor.id,
        actorName: actor.name || actor.email,
        actorRole: actor.role || 'BROKER'
      }
    });
  }
}

// Export singleton instance
export const distributionService = new DistributionService();

// Export class for testing
export { DistributionService };
