import { z } from "zod";
import { AuthorizationStatus, NDAStatus, AccessLevel, BuyerResponseType } from "./intake";

export const GateAuthorizationStatus = AuthorizationStatus.or(z.literal("NOT_REVIEWED"));

export const BuyerAuthorization = z
  .object({
    id: z.string(),
    dealDraftId: z.string(),
    buyerUserId: z.string(),
    status: AuthorizationStatus,
    authorizedBy: z.string().nullable().optional(),
    authorizedByName: z.string().nullable().optional(),
    authorizedAt: z.string().nullable().optional(),
    sellerApprovalRequired: z.boolean().optional(),
    sellerApprovedBy: z.string().nullable().optional(),
    sellerApprovedAt: z.string().nullable().optional(),
    declinedBy: z.string().nullable().optional(),
    declinedAt: z.string().nullable().optional(),
    declineReason: z.string().nullable().optional(),
    revokedBy: z.string().nullable().optional(),
    revokedAt: z.string().nullable().optional(),
    revokeReason: z.string().nullable().optional(),
    ndaStatus: NDAStatus,
    ndaSentAt: z.string().nullable().optional(),
    ndaSignedAt: z.string().nullable().optional(),
    ndaDocumentId: z.string().nullable().optional(),
    dataRoomAccessGranted: z.boolean().optional(),
    dataRoomAccessLevel: AccessLevel.nullable().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional()
  })
  .passthrough();

export const GateAuthorizationResponse = z.union([
  BuyerAuthorization,
  z.object({ status: z.literal("NOT_REVIEWED") })
]);

export const GateAuthorizeRequest = z.object({
  accessLevel: AccessLevel.optional()
});

export const GateDeclineRequest = z.object({
  reason: z.string()
});

export const GateRevokeRequest = z.object({
  reason: z.string()
});

export const GateRecordNDASignedRequest = z.object({
  ndaDocumentId: z.string().optional()
});

export const GateGrantAccessRequest = z.object({
  accessLevel: AccessLevel.optional()
});

export const GateReviewQueueItem = z.object({
  response: z
    .object({
      id: z.string(),
      dealDraftId: z.string(),
      buyerUserId: z.string(),
      response: BuyerResponseType,
      respondedAt: z.string(),
      questionsForBroker: z.array(z.string()).nullable().optional(),
      conditions: z.array(z.string()).nullable().optional(),
      indicativePriceMin: z.number().nullable().optional(),
      indicativePriceMax: z.number().nullable().optional(),
      intendedStructure: z.string().nullable().optional(),
      timelineNotes: z.string().nullable().optional(),
      passReason: z.string().nullable().optional(),
      passNotes: z.string().nullable().optional(),
      isConfidential: z.boolean().optional()
    })
    .passthrough(),
  authorization: GateAuthorizationResponse,
  buyer: z
    .object({
      id: z.string(),
      name: z.string().nullable().optional(),
      email: z.string().nullable().optional(),
      firmName: z.string().nullable().optional(),
      isAnonymous: z.boolean().optional(),
      anonymousLabel: z.string().nullable().optional()
    })
    .nullable()
    .optional(),
  aiScore: z.number().nullable().optional(),
  matchType: z.string().nullable().optional(),
  viewedAt: z.string().nullable().optional()
});

export const GateReviewQueueResponse = z.array(GateReviewQueueItem);

export const GateProgress = z.object({
  dealStatus: z.string(),
  funnel: z.object({
    distributed: z.number(),
    responded: z.number(),
    interested: z.number(),
    authorized: z.number(),
    ndaSigned: z.number(),
    inDataRoom: z.number()
  }),
  canAdvanceToDD: z.boolean()
});
