import { z } from "zod";

export const ListingType = z.enum(["PUBLIC", "PRIVATE"]);

export const MatchType = z.enum(["AUTO_MATCHED", "MANUAL"]);

export const DistributionStatus = z.enum(["PENDING", "ACTIVE", "PAUSED", "CLOSED"]);

export const BuyerResponseType = z.enum([
  "INTERESTED",
  "INTERESTED_WITH_CONDITIONS",
  "PASS"
]);

export const BuyerResponse = z
  .object({
    id: z.string(),
    dealDraftId: z.string(),
    buyerUserId: z.string(),
    response: BuyerResponseType,
    indicativePriceMin: z.number().nullable().optional(),
    indicativePriceMax: z.number().nullable().optional(),
    intendedStructure: z.string().nullable().optional(),
    timelineNotes: z.string().nullable().optional(),
    questionsForBroker: z.union([z.string(), z.array(z.string())]).nullable().optional(),
    conditions: z.union([z.string(), z.array(z.string())]).nullable().optional(),
    passReason: z.string().nullable().optional(),
    passNotes: z.string().nullable().optional(),
    respondedAt: z.string().optional(),
    respondedBy: z.string().optional(),
    isConfidential: z.boolean().optional()
  })
  .passthrough();

export const DistributionRecipient = z
  .object({
    id: z.string(),
    distributionId: z.string(),
    buyerUserId: z.string(),
    buyerEmail: z.string(),
    buyerName: z.string(),
    buyerFirmName: z.string().nullable().optional(),
    matchType: MatchType,
    matchScore: z.number().nullable().optional(),
    matchReason: z.string().nullable().optional(),
    isAnonymous: z.boolean().optional(),
    anonymousLabel: z.string().nullable().optional(),
    pushedToInboxAt: z.string(),
    viewedAt: z.string().nullable().optional(),
    viewDurationSec: z.number().nullable().optional(),
    pagesViewed: z.union([z.string(), z.array(z.number())]).nullable().optional(),
    responseId: z.string().nullable().optional()
  })
  .passthrough();

export const DistributionRecipientWithResponse = DistributionRecipient.extend({
  response: BuyerResponse.nullable().optional()
});

export const DealDraftSummary = z
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

export const DealDistribution = z
  .object({
    id: z.string(),
    dealDraftId: z.string(),
    omVersionId: z.string().optional(),
    listingType: ListingType,
    distributedBy: z.string().optional(),
    distributedByName: z.string().optional(),
    distributedAt: z.string().optional(),
    recipients: z.array(DistributionRecipient).optional(),
    dealDraft: DealDraftSummary.optional()
  })
  .passthrough();

export const CreateDistributionRequest = z.object({
  listingType: ListingType.optional(),
  recipientIds: z.array(z.string()).optional()
});

export const AddRecipientsRequest = z.object({
  recipientIds: z.array(z.string())
});

export const RecordViewRequest = z.object({
  durationSec: z.number().optional(),
  pagesViewed: z.array(z.number()).optional()
});

export const CreateDistributionResponse = z.object({
  distribution: DealDistribution,
  recipients: z.array(DistributionRecipient)
});

export const AddRecipientsResponse = z.object({
  added: z.array(DistributionRecipient)
});

export const DistributionListResponse = z.array(DealDistribution);

export const DistributionResponsesResponse = z.array(BuyerResponse);
