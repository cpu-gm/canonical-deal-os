import { z } from "zod";

export const DealDraftStatus = z.enum([
  "DRAFT_INGESTED",
  "OM_DRAFTED",
  "OM_BROKER_APPROVED",
  "OM_APPROVED_FOR_MARKETING",
  "DISTRIBUTED",
  "ACTIVE_DD"
]);

export const ClaimVerifyAction = z.enum(["confirm", "reject"]);

export const ClaimVerifyRequest = z.object({
  action: ClaimVerifyAction,
  correctedValue: z.union([z.string(), z.number()]).optional(),
  rejectionReason: z.string().optional()
});

export const ConflictResolutionMethod = z.enum([
  "CHOSE_CLAIM_A",
  "CHOSE_CLAIM_B",
  "MANUAL_OVERRIDE",
  "AVERAGED"
]);

export const ConflictResolveRequest = z.object({
  method: ConflictResolutionMethod,
  resolvedValue: z.union([z.string(), z.number()]).optional(),
  resolvedClaimId: z.string().optional()
});

export const DocumentType = z.enum([
  "OM",
  "RENT_ROLL",
  "T12",
  "LOI",
  "APPRAISAL",
  "OTHER"
]);

export const DocumentMetadata = z.object({
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  storageKey: z.string(),
  classifiedType: DocumentType.optional()
});

export const BuyerResponseType = z.enum([
  "INTERESTED",
  "PASS",
  "INTERESTED_WITH_CONDITIONS"
]);

export const BuyerResponseRequest = z.object({
  response: BuyerResponseType,
  questionsForBroker: z.array(z.string()).optional(),
  conditions: z.array(z.string()).optional(),
  indicativePriceMin: z.number().optional(),
  indicativePriceMax: z.number().optional(),
  intendedStructure: z.string().optional(),
  timelineNotes: z.string().optional(),
  passReason: z.enum(["PRICE", "ASSET_TYPE", "GEOGRAPHY", "TIMING", "OTHER"]).optional(),
  passNotes: z.string().optional(),
  isConfidential: z.boolean().optional()
});

export const AuthorizationStatus = z.enum([
  "PENDING",
  "AUTHORIZED",
  "DECLINED",
  "REVOKED"
]);

export const NDAStatus = z.enum(["NOT_SENT", "SENT", "SIGNED", "EXPIRED"]);

export const AccessLevel = z.enum(["STANDARD", "FULL", "CUSTOM"]);

export const IntakeBroker = z
  .object({
    id: z.string().optional(),
    userId: z.string().optional(),
    email: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    firmName: z.string().nullable().optional(),
    role: z.string().nullable().optional(),
    isPrimaryContact: z.boolean().optional(),
    permissions: z
      .object({
        canApproveOM: z.boolean().optional(),
        canDistribute: z.boolean().optional(),
        canAuthorize: z.boolean().optional()
      })
      .optional(),
    addedAt: z.string().nullable().optional()
  })
  .passthrough();

export const IntakeSeller = z
  .object({
    id: z.string().optional(),
    userId: z.string().optional(),
    email: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    entityName: z.string().nullable().optional(),
    access: z
      .object({
        hasDirectAccess: z.boolean().optional(),
        receiveNotifications: z.boolean().optional()
      })
      .optional(),
    approvalSettings: z
      .object({
        requiresOMApproval: z.boolean().optional(),
        requiresBuyerApproval: z.boolean().optional(),
        sellerSeesBuyerIdentity: z.boolean().optional()
      })
      .optional(),
    createdAt: z.string().nullable().optional()
  })
  .passthrough();

export const IntakeDocument = z
  .object({
    id: z.string(),
    filename: z.string().nullable().optional(),
    originalFilename: z.string().nullable().optional(),
    mimeType: z.string().nullable().optional(),
    sizeBytes: z.number().nullable().optional(),
    storageKey: z.string().nullable().optional(),
    classification: z
      .object({
        type: z.string().nullable().optional(),
        confidence: z.number().nullable().optional()
      })
      .optional()
  })
  .passthrough();

export const IntakeClaim = z
  .object({
    id: z.string(),
    field: z.string().nullable().optional(),
    value: z.unknown().optional(),
    displayValue: z.string().nullable().optional(),
    source: z
      .object({
        documentId: z.string().nullable().optional(),
        documentName: z.string().nullable().optional(),
        pageNumber: z.number().nullable().optional(),
        location: z.string().nullable().optional(),
        textSnippet: z.string().nullable().optional()
      })
      .optional(),
    extraction: z
      .object({
        method: z.string().nullable().optional(),
        confidence: z.number().nullable().optional()
      })
      .optional(),
    verification: z
      .object({
        status: z.string().nullable().optional(),
        verifiedBy: z.string().nullable().optional(),
        verifiedByName: z.string().nullable().optional(),
        verifiedAt: z.string().nullable().optional(),
        rejectionReason: z.string().nullable().optional()
      })
      .optional(),
    conflictGroupId: z.string().nullable().optional(),
    createdAt: z.string().nullable().optional()
  })
  .passthrough();

export const IntakeConflict = z
  .object({
    id: z.string(),
    dealDraftId: z.string().nullable().optional(),
    field: z.string().nullable().optional(),
    claims: z
      .object({
        a: IntakeClaim.optional(),
        b: IntakeClaim.optional()
      })
      .optional(),
    variancePercent: z.number().nullable().optional(),
    resolution: z
      .object({
        status: z.string().nullable().optional(),
        resolvedClaimId: z.string().nullable().optional(),
        resolvedValue: z.unknown().nullable().optional(),
        resolvedBy: z.string().nullable().optional(),
        resolvedByName: z.string().nullable().optional(),
        resolvedAt: z.string().nullable().optional(),
        method: z.string().nullable().optional()
      })
      .optional(),
    createdAt: z.string().nullable().optional()
  })
  .passthrough();

export const IntakeOMVersion = z
  .object({
    id: z.string(),
    versionNumber: z.number().optional(),
    status: z.string().nullable().optional(),
    approval: z
      .object({
        brokerApprovedBy: z.string().nullable().optional(),
        brokerApprovedAt: z.string().nullable().optional(),
        sellerApprovedBy: z.string().nullable().optional(),
        sellerApprovedAt: z.string().nullable().optional()
      })
      .optional(),
    createdBy: z.string().nullable().optional(),
    createdByName: z.string().nullable().optional(),
    createdAt: z.string().nullable().optional()
  })
  .passthrough();

export const DealDraft = z
  .object({
    id: z.string(),
    organizationId: z.string().optional(),
    status: DealDraftStatus,
    ingestSource: z.string().nullable().optional(),
    propertyName: z.string().nullable().optional(),
    propertyAddress: z.string().nullable().optional(),
    assetType: z.string().nullable().optional(),
    askingPrice: z.number().nullable().optional(),
    unitCount: z.number().nullable().optional(),
    totalSF: z.number().nullable().optional(),
    listingType: z.string().nullable().optional(),
    isAnonymousSeller: z.boolean().nullable().optional(),
    kernelDealId: z.string().nullable().optional(),
    createdAt: z.string().nullable().optional(),
    updatedAt: z.string().nullable().optional(),
    promotedAt: z.string().nullable().optional(),
    brokers: z.array(IntakeBroker).optional(),
    seller: IntakeSeller.optional(),
    documents: z.array(IntakeDocument).optional(),
    claims: z.array(IntakeClaim).optional(),
    latestOMVersion: IntakeOMVersion.optional()
  })
  .passthrough();

export const DealDraftListResponse = z
  .object({
    drafts: z.array(DealDraft),
    total: z.number(),
    limit: z.number().optional(),
    offset: z.number().optional()
  })
  .passthrough();

export const IntakeClaimsResponse = z
  .object({
    claims: z.array(IntakeClaim)
  })
  .passthrough();

export const IntakeConflictsResponse = z
  .object({
    conflicts: z.array(IntakeConflict)
  })
  .passthrough();

export const IntakeClaimVerificationResponse = z
  .object({
    id: z.string(),
    field: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    verifiedBy: z.string().nullable().optional(),
    verifiedAt: z.string().nullable().optional()
  })
  .passthrough();

export const IntakeStatsResponse = z
  .object({
    stats: z.record(z.unknown()).nullable().optional(),
    verifiedFields: z.array(z.string()).optional(),
    fieldsNeedingVerification: z.array(z.string()).optional()
  })
  .passthrough();

export const IntakeDocumentsUploadResponse = z
  .object({
    documents: z.array(IntakeDocument),
    errors: z
      .array(
        z.object({
          filename: z.string(),
          error: z.string()
        })
      )
      .optional()
  })
  .passthrough();

export const IntakePasteResult = z
  .object({
    claims: z.array(IntakeClaim).optional(),
    conflicts: z.array(IntakeConflict).optional(),
    stats: z.record(z.unknown()).optional()
  })
  .passthrough();
