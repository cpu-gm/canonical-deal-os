import { z } from "zod";

export const BuyerCriteriaWeight = z.object({
  weight: z.number().optional()
}).passthrough();

export const BuyerCriteriaWeights = z
  .object({
    assetTypeMatch: BuyerCriteriaWeight.optional(),
    priceRange: BuyerCriteriaWeight.optional(),
    sizeMatch: BuyerCriteriaWeight.optional(),
    locationMatch: BuyerCriteriaWeight.optional(),
    completeness: BuyerCriteriaWeight.optional()
  })
  .passthrough();

export const BuyerCriteria = z
  .object({
    id: z.string(),
    userId: z.string(),
    organizationId: z.string(),
    assetTypes: z.array(z.string()).nullable().optional(),
    geographiesInclude: z.array(z.string()).nullable().optional(),
    geographiesExclude: z.array(z.string()).nullable().optional(),
    minUnits: z.number().nullable().optional(),
    maxUnits: z.number().nullable().optional(),
    minPrice: z.number().nullable().optional(),
    maxPrice: z.number().nullable().optional(),
    minSF: z.number().nullable().optional(),
    maxSF: z.number().nullable().optional(),
    scoringWeights: BuyerCriteriaWeights.nullable().optional(),
    customInstructions: z.string().nullable().optional(),
    autoReceiveMatches: z.boolean().optional(),
    minMatchScore: z.number().nullable().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional()
  })
  .passthrough();

export const BuyerCriteriaRequest = z.object({
  assetTypes: z.array(z.string()).nullable().optional(),
  geographiesInclude: z.array(z.string()).nullable().optional(),
  geographiesExclude: z.array(z.string()).nullable().optional(),
  minUnits: z.number().nullable().optional(),
  maxUnits: z.number().nullable().optional(),
  minPrice: z.number().nullable().optional(),
  maxPrice: z.number().nullable().optional(),
  minSF: z.number().nullable().optional(),
  maxSF: z.number().nullable().optional(),
  scoringWeights: BuyerCriteriaWeights.optional(),
  customInstructions: z.string().nullable().optional(),
  autoReceiveMatches: z.boolean().optional(),
  minMatchScore: z.number().nullable().optional()
});

export const BuyerFilterResult = z.object({
  filter: z.string(),
  passed: z.boolean(),
  reason: z.string()
});

export const BuyerScoreBreakdown = z.object({
  criterion: z.string(),
  score: z.number(),
  reason: z.string()
});

export const BuyerTriageFlag = z.object({
  type: z.string(),
  field: z.string().optional().nullable(),
  message: z.string()
});

export const BuyerTriageResult = z
  .object({
    id: z.string(),
    buyerCriteriaId: z.string(),
    dealDraftId: z.string(),
    passesFilters: z.boolean(),
    filterResults: z.array(BuyerFilterResult),
    relevanceScore: z.number(),
    scoreBreakdown: z.array(BuyerScoreBreakdown),
    summary: z.string().nullable().optional(),
    flags: z.array(BuyerTriageFlag).optional(),
    processedAt: z.string().optional(),
    aiModel: z.string().nullable().optional(),
    processingTimeMs: z.number().nullable().optional()
  })
  .passthrough();

export const BuyerInboxScore = z.object({
  relevanceScore: z.number().nullable().optional(),
  passesFilters: z.boolean().nullable().optional(),
  summary: z.string().nullable().optional()
});

export const BuyerInboxDeal = z
  .object({
    id: z.string(),
    propertyName: z.string().nullable().optional(),
    propertyAddress: z.string().nullable().optional(),
    assetType: z.string().nullable().optional(),
    askingPrice: z.number().nullable().optional(),
    unitCount: z.number().nullable().optional(),
    status: z.string().nullable().optional()
  })
  .passthrough();

export const BuyerInboxItem = z
  .object({
    id: z.string(),
    distributionId: z.string(),
    buyerUserId: z.string(),
    buyerEmail: z.string(),
    buyerName: z.string(),
    buyerFirmName: z.string().nullable().optional(),
    matchType: z.string().optional(),
    matchScore: z.number().nullable().optional(),
    matchReason: z.string().nullable().optional(),
    isAnonymous: z.boolean().optional(),
    anonymousLabel: z.string().nullable().optional(),
    pushedToInboxAt: z.string(),
    viewedAt: z.string().nullable().optional(),
    viewDurationSec: z.number().nullable().optional(),
    pagesViewed: z.union([z.string(), z.array(z.number())]).nullable().optional(),
    responseId: z.string().nullable().optional(),
    distribution: z
      .object({
        dealDraft: BuyerInboxDeal
      })
      .optional(),
    aiScore: BuyerInboxScore.nullable().optional()
  })
  .passthrough();

export const BuyerInboxResponse = z.array(BuyerInboxItem);

export const BuyerDealResponse = z
  .object({
    recipient: z.record(z.unknown()),
    deal: z.record(z.unknown()),
    omVersion: z.record(z.unknown()).nullable().optional(),
    triage: BuyerTriageResult.nullable().optional(),
    response: z.record(z.unknown()).nullable().optional()
  })
  .passthrough();

export const BuyerAnonymity = z.object({
  isAnonymous: z.boolean(),
  anonymousLabel: z.string()
});
