/**
 * Buyer AI Triage Service
 *
 * AI-powered deal scoring for buyers, including:
 * - Criteria configuration management
 * - Deal scoring against buyer criteria
 * - AI summary generation
 * - Relevance scoring and flagging
 *
 * IMPORTANT: AI can only SCORE and SUMMARIZE. It cannot:
 * - Submit responses on behalf of buyers
 * - Contact brokers or sellers
 * - Make recommendations to "buy" or "pass"
 *
 * Part of Phase 3: Distribution + Buyer AI
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Debug logging helper
const DEBUG = process.env.DEBUG_BUYER_AI === 'true' || process.env.DEBUG === 'true';
function debugLog(context, message, data = null) {
  if (DEBUG) {
    const timestamp = new Date().toISOString();
    console.log(`[BUYER_AI ${timestamp}] [${context}] ${message}`);
    if (data) {
      console.log(JSON.stringify(data, null, 2));
    }
  }
}

// Filter types
export const FILTER_TYPES = {
  ASSET_TYPE: 'assetTypes',
  GEOGRAPHY_INCLUDE: 'geographiesInclude',
  GEOGRAPHY_EXCLUDE: 'geographiesExclude',
  MIN_UNITS: 'minUnits',
  MAX_UNITS: 'maxUnits',
  MIN_PRICE: 'minPrice',
  MAX_PRICE: 'maxPrice',
  MIN_SF: 'minSF',
  MAX_SF: 'maxSF'
};

// Flag types for AI output
export const FLAG_TYPES = {
  EXCEEDS_CRITERIA: 'EXCEEDS_CRITERIA',
  BELOW_CRITERIA: 'BELOW_CRITERIA',
  OPPORTUNITY: 'OPPORTUNITY',
  CONCERN: 'CONCERN',
  INFO: 'INFO'
};

/**
 * Buyer AI Triage Service
 */
class BuyerAITriageService {
  /**
   * Create or update buyer criteria profile
   *
   * @param {string} userId - The buyer user ID
   * @param {Object} criteriaData - The criteria configuration
   * @returns {Object} The created/updated criteria
   */
  async upsertCriteria(userId, criteriaData) {
    debugLog('upsertCriteria', 'Upserting buyer criteria', { userId });

    // Get user's organization
    const user = await prisma.authUser.findUnique({
      where: { id: userId }
    });

    if (!user) {
      throw new Error('User not found');
    }

    const existingCriteria = await prisma.buyerAICriteria.findUnique({
      where: { userId }
    });

    const data = {
      organizationId: user.organizationId,
      assetTypes: criteriaData.assetTypes
        ? JSON.stringify(criteriaData.assetTypes)
        : existingCriteria?.assetTypes,
      geographiesInclude: criteriaData.geographiesInclude
        ? JSON.stringify(criteriaData.geographiesInclude)
        : existingCriteria?.geographiesInclude,
      geographiesExclude: criteriaData.geographiesExclude
        ? JSON.stringify(criteriaData.geographiesExclude)
        : existingCriteria?.geographiesExclude,
      minUnits: criteriaData.minUnits ?? existingCriteria?.minUnits,
      maxUnits: criteriaData.maxUnits ?? existingCriteria?.maxUnits,
      minPrice: criteriaData.minPrice ?? existingCriteria?.minPrice,
      maxPrice: criteriaData.maxPrice ?? existingCriteria?.maxPrice,
      minSF: criteriaData.minSF ?? existingCriteria?.minSF,
      maxSF: criteriaData.maxSF ?? existingCriteria?.maxSF,
      scoringWeights: criteriaData.scoringWeights
        ? JSON.stringify(criteriaData.scoringWeights)
        : existingCriteria?.scoringWeights,
      customInstructions: criteriaData.customInstructions ?? existingCriteria?.customInstructions,
      autoReceiveMatches: criteriaData.autoReceiveMatches ?? existingCriteria?.autoReceiveMatches ?? true,
      minMatchScore: criteriaData.minMatchScore ?? existingCriteria?.minMatchScore ?? 50
    };

    if (existingCriteria) {
      debugLog('upsertCriteria', 'Updating existing criteria', { criteriaId: existingCriteria.id });

      const updated = await prisma.buyerAICriteria.update({
        where: { userId },
        data
      });

      debugLog('upsertCriteria', 'Criteria updated', { criteriaId: updated.id });
      return updated;
    }

    const created = await prisma.buyerAICriteria.create({
      data: {
        userId,
        ...data
      }
    });

    debugLog('upsertCriteria', 'Criteria created', { criteriaId: created.id });
    return created;
  }

  /**
   * Get buyer criteria profile
   */
  async getCriteria(userId) {
    debugLog('getCriteria', 'Fetching buyer criteria', { userId });

    const criteria = await prisma.buyerAICriteria.findUnique({
      where: { userId }
    });

    if (!criteria) {
      debugLog('getCriteria', 'No criteria found');
      return null;
    }

    // Parse JSON fields for convenience
    return {
      ...criteria,
      assetTypes: criteria.assetTypes ? JSON.parse(criteria.assetTypes) : null,
      geographiesInclude: criteria.geographiesInclude ? JSON.parse(criteria.geographiesInclude) : null,
      geographiesExclude: criteria.geographiesExclude ? JSON.parse(criteria.geographiesExclude) : null,
      scoringWeights: criteria.scoringWeights ? JSON.parse(criteria.scoringWeights) : null
    };
  }

  /**
   * Score a deal for a specific buyer
   *
   * @param {string} dealDraftId - The deal to score
   * @param {string} userId - The buyer to score for
   * @returns {Object} Triage result with score, filters, and flags
   */
  async scoreDeal(dealDraftId, userId) {
    const startTime = Date.now();
    debugLog('scoreDeal', 'Starting deal scoring', { dealDraftId, userId });

    // Get buyer criteria
    const criteria = await prisma.buyerAICriteria.findUnique({
      where: { userId }
    });

    if (!criteria) {
      debugLog('scoreDeal', 'No criteria found for buyer');
      throw new Error('Buyer has no criteria configured');
    }

    // Get deal details
    const dealDraft = await prisma.dealDraft.findUnique({
      where: { id: dealDraftId },
      include: {
        claims: {
          where: { status: { not: 'REJECTED' } }
        },
        omVersions: {
          where: { status: 'SELLER_APPROVED' },
          orderBy: { versionNumber: 'desc' },
          take: 1
        }
      }
    });

    if (!dealDraft) {
      throw new Error('Deal not found');
    }

    debugLog('scoreDeal', 'Deal loaded', {
      dealDraftId,
      propertyName: dealDraft.propertyName,
      assetType: dealDraft.assetType
    });

    // Evaluate hard filters
    const filterResults = this._evaluateHardFilters(dealDraft, criteria);
    const passesFilters = filterResults.every(f => f.passed);

    debugLog('scoreDeal', 'Hard filter results', { passesFilters, filterCount: filterResults.length });

    // Calculate soft scoring
    const { score, scoreBreakdown } = this._calculateSoftScore(dealDraft, criteria);

    debugLog('scoreDeal', 'Soft score calculated', { score });

    // Generate flags
    const flags = this._generateFlags(dealDraft, criteria, filterResults, score);

    debugLog('scoreDeal', 'Flags generated', { flagCount: flags.length });

    // Generate AI summary (simplified - in production this would call LLM)
    const summary = this._generateSummary(dealDraft, criteria, score, flags);

    // Check for existing triage result
    const existingTriage = await prisma.buyerAITriage.findUnique({
      where: {
        buyerCriteriaId_dealDraftId: {
          buyerCriteriaId: criteria.id,
          dealDraftId
        }
      }
    });

    const processingTimeMs = Date.now() - startTime;

    const triageData = {
      passesFilters,
      filterResults: JSON.stringify(filterResults),
      relevanceScore: score,
      scoreBreakdown: JSON.stringify(scoreBreakdown),
      summary,
      flags: JSON.stringify(flags),
      processedAt: new Date(),
      processingTimeMs
    };

    let triage;
    if (existingTriage) {
      triage = await prisma.buyerAITriage.update({
        where: { id: existingTriage.id },
        data: triageData
      });
    } else {
      triage = await prisma.buyerAITriage.create({
        data: {
          buyerCriteriaId: criteria.id,
          dealDraftId,
          ...triageData
        }
      });
    }

    debugLog('scoreDeal', 'Triage result saved', {
      triageId: triage.id,
      score,
      passesFilters,
      processingTimeMs
    });

    // Return parsed result
    return {
      id: triage.id,
      dealDraftId,
      passesFilters,
      filterResults,
      relevanceScore: score,
      scoreBreakdown,
      summary,
      flags,
      processedAt: triage.processedAt
    };
  }

  /**
   * Evaluate hard filters (pass/fail)
   * @private
   */
  _evaluateHardFilters(dealDraft, criteria) {
    debugLog('_evaluateHardFilters', 'Evaluating hard filters');

    const results = [];

    // Asset type filter
    if (criteria.assetTypes) {
      const assetTypes = JSON.parse(criteria.assetTypes);
      if (assetTypes.length > 0) {
        const passed = dealDraft.assetType && assetTypes.includes(dealDraft.assetType);
        results.push({
          filter: FILTER_TYPES.ASSET_TYPE,
          passed,
          reason: passed
            ? `Asset type ${dealDraft.assetType} matches criteria`
            : `Asset type ${dealDraft.assetType || 'unknown'} not in [${assetTypes.join(', ')}]`
        });
      }
    }

    // Geography include filter
    if (criteria.geographiesInclude) {
      const geos = JSON.parse(criteria.geographiesInclude);
      if (geos.length > 0 && dealDraft.propertyAddress) {
        const addressUpper = dealDraft.propertyAddress.toUpperCase();
        const passed = geos.some(geo => addressUpper.includes(geo.toUpperCase()));
        results.push({
          filter: FILTER_TYPES.GEOGRAPHY_INCLUDE,
          passed,
          reason: passed
            ? `Property location matches geography criteria`
            : `Property not in required geographies [${geos.join(', ')}]`
        });
      }
    }

    // Geography exclude filter
    if (criteria.geographiesExclude) {
      const geos = JSON.parse(criteria.geographiesExclude);
      if (geos.length > 0 && dealDraft.propertyAddress) {
        const addressUpper = dealDraft.propertyAddress.toUpperCase();
        const isExcluded = geos.some(geo => addressUpper.includes(geo.toUpperCase()));
        results.push({
          filter: FILTER_TYPES.GEOGRAPHY_EXCLUDE,
          passed: !isExcluded,
          reason: isExcluded
            ? `Property in excluded geography`
            : `Property not in excluded geographies`
        });
      }
    }

    // Min units filter
    if (criteria.minUnits != null && dealDraft.unitCount != null) {
      const passed = dealDraft.unitCount >= criteria.minUnits;
      results.push({
        filter: FILTER_TYPES.MIN_UNITS,
        passed,
        reason: passed
          ? `${dealDraft.unitCount} units meets minimum of ${criteria.minUnits}`
          : `${dealDraft.unitCount} units below minimum of ${criteria.minUnits}`
      });
    }

    // Max units filter
    if (criteria.maxUnits != null && dealDraft.unitCount != null) {
      const passed = dealDraft.unitCount <= criteria.maxUnits;
      results.push({
        filter: FILTER_TYPES.MAX_UNITS,
        passed,
        reason: passed
          ? `${dealDraft.unitCount} units within maximum of ${criteria.maxUnits}`
          : `${dealDraft.unitCount} units exceeds maximum of ${criteria.maxUnits}`
      });
    }

    // Min price filter
    if (criteria.minPrice != null && dealDraft.askingPrice != null) {
      const passed = dealDraft.askingPrice >= criteria.minPrice;
      results.push({
        filter: FILTER_TYPES.MIN_PRICE,
        passed,
        reason: passed
          ? `Price $${(dealDraft.askingPrice / 1e6).toFixed(1)}M meets minimum`
          : `Price $${(dealDraft.askingPrice / 1e6).toFixed(1)}M below minimum $${(criteria.minPrice / 1e6).toFixed(1)}M`
      });
    }

    // Max price filter
    if (criteria.maxPrice != null && dealDraft.askingPrice != null) {
      const passed = dealDraft.askingPrice <= criteria.maxPrice;
      results.push({
        filter: FILTER_TYPES.MAX_PRICE,
        passed,
        reason: passed
          ? `Price $${(dealDraft.askingPrice / 1e6).toFixed(1)}M within maximum`
          : `Price $${(dealDraft.askingPrice / 1e6).toFixed(1)}M exceeds maximum $${(criteria.maxPrice / 1e6).toFixed(1)}M`
      });
    }

    // Min SF filter
    if (criteria.minSF != null && dealDraft.totalSF != null) {
      const passed = dealDraft.totalSF >= criteria.minSF;
      results.push({
        filter: FILTER_TYPES.MIN_SF,
        passed,
        reason: passed
          ? `${dealDraft.totalSF.toLocaleString()} SF meets minimum`
          : `${dealDraft.totalSF.toLocaleString()} SF below minimum ${criteria.minSF.toLocaleString()}`
      });
    }

    // Max SF filter
    if (criteria.maxSF != null && dealDraft.totalSF != null) {
      const passed = dealDraft.totalSF <= criteria.maxSF;
      results.push({
        filter: FILTER_TYPES.MAX_SF,
        passed,
        reason: passed
          ? `${dealDraft.totalSF.toLocaleString()} SF within maximum`
          : `${dealDraft.totalSF.toLocaleString()} SF exceeds maximum ${criteria.maxSF.toLocaleString()}`
      });
    }

    debugLog('_evaluateHardFilters', 'Filter evaluation complete', {
      totalFilters: results.length,
      passedFilters: results.filter(r => r.passed).length
    });

    return results;
  }

  /**
   * Calculate soft score based on weighted criteria
   * @private
   */
  _calculateSoftScore(dealDraft, criteria) {
    debugLog('_calculateSoftScore', 'Calculating soft score');

    const breakdown = [];
    let totalWeight = 0;
    let weightedScore = 0;

    // Parse scoring weights if available
    const weights = criteria.scoringWeights ? JSON.parse(criteria.scoringWeights) : {};

    // Default scoring components
    const scoringComponents = [
      {
        name: 'assetTypeMatch',
        weight: weights.assetTypeMatch?.weight || 20,
        calculate: () => {
          if (!criteria.assetTypes) return { score: 50, reason: 'No asset type preference' };
          const types = JSON.parse(criteria.assetTypes);
          if (types.length === 0) return { score: 50, reason: 'No asset type preference' };
          if (dealDraft.assetType && types[0] === dealDraft.assetType) {
            return { score: 100, reason: 'Preferred asset type' };
          }
          if (dealDraft.assetType && types.includes(dealDraft.assetType)) {
            return { score: 80, reason: 'Acceptable asset type' };
          }
          return { score: 0, reason: 'Asset type not in criteria' };
        }
      },
      {
        name: 'priceRange',
        weight: weights.priceRange?.weight || 25,
        calculate: () => {
          if (!dealDraft.askingPrice) return { score: 50, reason: 'No asking price available' };
          if (!criteria.minPrice && !criteria.maxPrice) return { score: 50, reason: 'No price preference' };

          const min = criteria.minPrice || 0;
          const max = criteria.maxPrice || Infinity;
          const price = dealDraft.askingPrice;

          if (price < min || price > max) {
            return { score: 0, reason: 'Outside price range' };
          }

          // Score higher for being in the middle of the range
          if (criteria.minPrice && criteria.maxPrice) {
            const midPoint = (min + max) / 2;
            const variance = Math.abs(price - midPoint) / midPoint;
            if (variance < 0.1) return { score: 100, reason: 'In sweet spot of price range' };
            if (variance < 0.25) return { score: 85, reason: 'Near target price range' };
            return { score: 70, reason: 'Within price range' };
          }

          return { score: 75, reason: 'Within price range' };
        }
      },
      {
        name: 'sizeMatch',
        weight: weights.sizeMatch?.weight || 20,
        calculate: () => {
          // Check units
          if (dealDraft.unitCount != null) {
            if (criteria.minUnits && dealDraft.unitCount < criteria.minUnits) {
              return { score: 0, reason: 'Below minimum units' };
            }
            if (criteria.maxUnits && dealDraft.unitCount > criteria.maxUnits) {
              return { score: 0, reason: 'Above maximum units' };
            }
            if (criteria.minUnits && criteria.maxUnits) {
              const midPoint = (criteria.minUnits + criteria.maxUnits) / 2;
              const variance = Math.abs(dealDraft.unitCount - midPoint) / midPoint;
              if (variance < 0.2) return { score: 100, reason: 'Ideal unit count' };
              return { score: 80, reason: 'Within unit range' };
            }
          }
          return { score: 50, reason: 'Size criteria not evaluated' };
        }
      },
      {
        name: 'locationMatch',
        weight: weights.locationMatch?.weight || 20,
        calculate: () => {
          if (!dealDraft.propertyAddress) return { score: 50, reason: 'No address available' };

          // Check include list
          if (criteria.geographiesInclude) {
            const includes = JSON.parse(criteria.geographiesInclude);
            if (includes.length > 0) {
              const addressUpper = dealDraft.propertyAddress.toUpperCase();
              const matched = includes.find(g => addressUpper.includes(g.toUpperCase()));
              if (matched) {
                // First in list = most preferred
                const position = includes.indexOf(matched);
                const score = Math.max(70, 100 - (position * 10));
                return { score, reason: `Matches preferred geography: ${matched}` };
              }
              return { score: 0, reason: 'Not in preferred geographies' };
            }
          }
          return { score: 50, reason: 'No geography preference' };
        }
      },
      {
        name: 'completeness',
        weight: weights.completeness?.weight || 15,
        calculate: () => {
          // Score based on how much info is available
          let infoScore = 0;
          let infoCount = 0;

          const fields = [
            dealDraft.propertyName,
            dealDraft.propertyAddress,
            dealDraft.assetType,
            dealDraft.askingPrice,
            dealDraft.unitCount,
            dealDraft.totalSF
          ];

          fields.forEach(f => {
            if (f != null) infoScore += 1;
            infoCount += 1;
          });

          const score = Math.round((infoScore / infoCount) * 100);
          return {
            score,
            reason: `${infoScore}/${infoCount} key fields available`
          };
        }
      }
    ];

    // Calculate each component
    for (const component of scoringComponents) {
      const result = component.calculate();
      breakdown.push({
        criterion: component.name,
        weight: component.weight,
        score: result.score,
        reason: result.reason
      });
      totalWeight += component.weight;
      weightedScore += result.score * component.weight;
    }

    // Calculate final score
    const finalScore = totalWeight > 0 ? Math.round(weightedScore / totalWeight) : 50;

    debugLog('_calculateSoftScore', 'Soft score calculated', {
      finalScore,
      components: breakdown.length
    });

    return {
      score: finalScore,
      scoreBreakdown: breakdown
    };
  }

  /**
   * Generate flags for buyer attention
   * @private
   */
  _generateFlags(dealDraft, criteria, filterResults, score) {
    debugLog('_generateFlags', 'Generating flags');

    const flags = [];

    // Flag filter failures
    filterResults.forEach(f => {
      if (!f.passed) {
        flags.push({
          type: f.filter.includes('MAX') ? FLAG_TYPES.EXCEEDS_CRITERIA : FLAG_TYPES.BELOW_CRITERIA,
          field: f.filter,
          message: f.reason
        });
      }
    });

    // Flag if price is near the boundary
    if (criteria.maxPrice && dealDraft.askingPrice) {
      const pricePct = dealDraft.askingPrice / criteria.maxPrice;
      if (pricePct > 0.9 && pricePct <= 1.0) {
        flags.push({
          type: FLAG_TYPES.INFO,
          field: 'askingPrice',
          message: `Price at ${Math.round(pricePct * 100)}% of maximum budget`
        });
      }
      if (pricePct > 1.0 && pricePct <= 1.15) {
        flags.push({
          type: FLAG_TYPES.EXCEEDS_CRITERIA,
          field: 'askingPrice',
          message: `Price ${Math.round((pricePct - 1) * 100)}% above maximum budget`
        });
      }
    }

    // Flag low relevance score
    if (score < 50) {
      flags.push({
        type: FLAG_TYPES.CONCERN,
        field: 'relevanceScore',
        message: `Low relevance score: ${score}/100`
      });
    }

    // Flag high relevance for opportunities
    if (score >= 85) {
      flags.push({
        type: FLAG_TYPES.OPPORTUNITY,
        field: 'relevanceScore',
        message: `High match score: ${score}/100`
      });
    }

    debugLog('_generateFlags', 'Flags generated', { count: flags.length });
    return flags;
  }

  /**
   * Generate AI summary for the deal
   * @private
   */
  _generateSummary(dealDraft, criteria, score, flags) {
    debugLog('_generateSummary', 'Generating summary');

    // In production, this would call an LLM. For now, generate a structured summary.
    const parts = [];

    // Basic deal info
    if (dealDraft.propertyName) {
      parts.push(`**${dealDraft.propertyName}**`);
    }

    // Property details
    const details = [];
    if (dealDraft.assetType) details.push(dealDraft.assetType);
    if (dealDraft.unitCount) details.push(`${dealDraft.unitCount} units`);
    if (dealDraft.totalSF) details.push(`${dealDraft.totalSF.toLocaleString()} SF`);
    if (dealDraft.propertyAddress) details.push(dealDraft.propertyAddress);
    if (details.length > 0) {
      parts.push(details.join(' | '));
    }

    // Price info
    if (dealDraft.askingPrice) {
      const priceM = dealDraft.askingPrice / 1e6;
      const perUnitNote = dealDraft.unitCount
        ? ` (~$${Math.round(dealDraft.askingPrice / dealDraft.unitCount / 1000)}K/unit)`
        : '';
      parts.push(`Asking: $${priceM.toFixed(1)}M${perUnitNote}`);
    }

    // Relevance note
    parts.push(`\nRelevance Score: **${score}/100**`);

    // Key flags
    const importantFlags = flags.filter(f =>
      f.type === FLAG_TYPES.OPPORTUNITY ||
      f.type === FLAG_TYPES.EXCEEDS_CRITERIA
    );
    if (importantFlags.length > 0) {
      parts.push('\nKey Notes:');
      importantFlags.forEach(f => {
        const icon = f.type === FLAG_TYPES.OPPORTUNITY ? '✓' : '⚠';
        parts.push(`- ${icon} ${f.message}`);
      });
    }

    const summary = parts.join('\n');
    debugLog('_generateSummary', 'Summary generated', { length: summary.length });
    return summary;
  }

  /**
   * Get triage result for a deal
   */
  async getTriageResult(dealDraftId, userId) {
    debugLog('getTriageResult', 'Fetching triage result', { dealDraftId, userId });

    const criteria = await prisma.buyerAICriteria.findUnique({
      where: { userId }
    });

    if (!criteria) {
      return null;
    }

    const triage = await prisma.buyerAITriage.findUnique({
      where: {
        buyerCriteriaId_dealDraftId: {
          buyerCriteriaId: criteria.id,
          dealDraftId
        }
      }
    });

    if (!triage) {
      return null;
    }

    // Parse JSON fields
    return {
      ...triage,
      filterResults: JSON.parse(triage.filterResults),
      scoreBreakdown: JSON.parse(triage.scoreBreakdown),
      flags: triage.flags ? JSON.parse(triage.flags) : []
    };
  }

  /**
   * Score all distributed deals for a buyer
   */
  async scoreAllDealsForBuyer(userId) {
    debugLog('scoreAllDealsForBuyer', 'Scoring all deals', { userId });

    // Get buyer's received deals
    const recipients = await prisma.distributionRecipient.findMany({
      where: { buyerUserId: userId },
      include: {
        distribution: true
      }
    });

    const results = [];

    for (const recipient of recipients) {
      try {
        const result = await this.scoreDeal(recipient.distribution.dealDraftId, userId);
        results.push(result);
      } catch (error) {
        debugLog('scoreAllDealsForBuyer', 'Error scoring deal', {
          dealDraftId: recipient.distribution.dealDraftId,
          error: error.message
        });
      }
    }

    debugLog('scoreAllDealsForBuyer', 'Scoring complete', { scored: results.length });
    return results;
  }

  /**
   * Delete buyer criteria
   */
  async deleteCriteria(userId) {
    debugLog('deleteCriteria', 'Deleting buyer criteria', { userId });

    const existing = await prisma.buyerAICriteria.findUnique({
      where: { userId }
    });

    if (!existing) {
      throw new Error('No criteria found');
    }

    // Delete associated triage results first (cascade should handle this, but being explicit)
    await prisma.buyerAITriage.deleteMany({
      where: { buyerCriteriaId: existing.id }
    });

    await prisma.buyerAICriteria.delete({
      where: { userId }
    });

    debugLog('deleteCriteria', 'Criteria deleted');
    return { deleted: true };
  }
}

// Export singleton instance
export const buyerAITriageService = new BuyerAITriageService();

// Export class for testing
export { BuyerAITriageService };
