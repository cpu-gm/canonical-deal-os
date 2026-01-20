import { z } from "zod";

export const actionTypeSchema = z.enum([
  "OPEN_REVIEW",
  "APPROVE_DEAL",
  "ATTEST_READY_TO_CLOSE",
  "FINALIZE_CLOSING",
  "ACTIVATE_OPERATIONS",
  "DECLARE_CHANGE",
  "RECONCILE_CHANGE",
  "DECLARE_DISTRESS",
  "RESOLVE_DISTRESS",
  "IMPOSE_FREEZE",
  "LIFT_FREEZE",
  "FINALIZE_EXIT",
  "TERMINATE_DEAL",
  "DISPUTE_DATA",
  "OVERRIDE"
]);

export const dealProfileSchema = z.object({
  asset_type: z.string().nullable().optional(),
  asset_address: z.string().nullable().optional(),
  asset_city: z.string().nullable().optional(),
  asset_state: z.string().nullable().optional(),
  square_footage: z.number().nullable().optional(),
  unit_count: z.number().nullable().optional(),
  year_built: z.number().nullable().optional(),
  purchase_price: z.number().nullable().optional(),
  noi: z.number().nullable().optional(),
  cap_rate: z.number().nullable().optional(),
  ltv: z.number().nullable().optional(),
  dscr: z.number().nullable().optional(),
  senior_debt: z.number().nullable().optional(),
  mezzanine_debt: z.number().nullable().optional(),
  preferred_equity: z.number().nullable().optional(),
  common_equity: z.number().nullable().optional(),
  gp_name: z.string().nullable().optional(),
  lender_name: z.string().nullable().optional(),
  deal_summary: z.string().nullable().optional(),
  ai_derived: z.boolean().optional(),
  verification_status: z.string().nullable().optional(),
  next_action: z.string().nullable().optional(),
  truth_health: z.string().nullable().optional()
});

export const dealProfileMetaSchema = z.object({
  source: z.string().nullable().optional(),
  asOf: z.string().nullable().optional()
});

export const dealSchema = z.object({
  id: z.string(),
  name: z.string(),
  lifecycle_state: z.string().nullable().optional(),
  stress_mode: z.boolean().optional(),
  stress_mode_label: z.string().nullable().optional(),
  truth_health: z.enum(["healthy", "warning", "danger"]).nullable().optional(),
  next_action: z.string().nullable().optional(),
  next_action_type: z.string().nullable().optional(),
  blocked_by: z.string().nullable().optional(),
  created_date: z.string().nullable().optional(),
  updated_date: z.string().nullable().optional(),
  profile: dealProfileSchema.nullable().optional(),
  profile_meta: dealProfileMetaSchema.nullable().optional()
});

export const dealListResponseSchema = z.array(dealSchema);

export const dealEventSchema = z.object({
  id: z.string(),
  deal_id: z.string(),
  event_type: z.string(),
  event_title: z.string().nullable().optional(),
  event_description: z.string().nullable().optional(),
  authority_role: z.string().nullable().optional(),
  authority_name: z.string().nullable().optional(),
  evidence_type: z.string().nullable().optional(),
  evidence_hash: z.string().nullable().optional(),
  document_url: z.string().nullable().optional(),
  from_state: z.string().nullable().optional(),
  to_state: z.string().nullable().optional(),
  timestamp: z.string().nullable().optional(),
  created_date: z.string().nullable().optional()
});

export const authoritySchema = z.object({
  id: z.string(),
  entity_name: z.string(),
  role: z.string().nullable().optional(),
  consent_status: z.string().nullable().optional()
});

export const materialSchema = z.object({
  id: z.string(),
  dealId: z.string().nullable().optional(),
  type: z.string(),
  truthClass: z.string().nullable().optional(),
  data: z.record(z.unknown()).nullable().optional(),
  createdAt: z.string().nullable().optional()
});

export const covenantSchema = z.object({
  id: z.string().optional(),
  covenant_type: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  current_value: z.string().nullable().optional(),
  threshold_operator: z.string().nullable().optional(),
  threshold_value: z.string().nullable().optional()
});

export const evidenceSummarySchema = z.object({
  total_artifacts: z.number(),
  last_uploaded_at: z.string().nullable().optional()
});

export const approvalSummarySchema = z.object({
  threshold: z.number(),
  satisfiedByRole: z.record(z.number()),
  satisfied: z.boolean()
});

export const approvalsSchema = z.record(approvalSummarySchema);

export const evidenceReferenceSchema = z.object({
  source: z.string(),
  eventId: z.string().nullable().optional(),
  materialId: z.string().nullable().optional(),
  tag: z.string().nullable().optional()
});

export const evidenceArtifactSchema = z.object({
  artifactId: z.string(),
  filename: z.string().nullable().optional(),
  mimeType: z.string().nullable().optional(),
  sizeBytes: z.number().nullable().optional(),
  sha256Hex: z.string().nullable().optional(),
  uploaderId: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
  references: z.array(evidenceReferenceSchema)
});

export const evidenceIndexSchema = z.object({
  dealId: z.string(),
  at: z.string().nullable().optional(),
  artifacts: z.array(evidenceArtifactSchema)
});

export const dealHomeResponseSchema = z.object({
  deal: dealSchema,
  events: z.array(dealEventSchema),
  authorities: z.array(authoritySchema),
  covenants: z.array(covenantSchema),
  evidence: evidenceSummarySchema
});

export const dealRecordsResponseSchema = z.object({
  deal: dealSchema,
  events: z.array(dealEventSchema),
  authorities: z.array(authoritySchema),
  materials: z.array(materialSchema),
  approvals: approvalsSchema.optional(),
  evidence_index: evidenceIndexSchema
});

export const eventsResponseSchema = z.array(dealEventSchema);

export const explainReasonSchema = z.object({
  type: z.string(),
  message: z.string(),
  materialType: z.string().nullable().optional(),
  requiredTruth: z.string().nullable().optional(),
  currentTruth: z.string().nullable().optional(),
  satisfiedByOverride: z.boolean().optional()
});

export const explainBlockSchema = z.object({
  action: z.string(),
  status: z.literal("BLOCKED"),
  reasons: z.array(explainReasonSchema),
  nextSteps: z.array(
    z.object({
      description: z.string(),
      canBeFixedByRoles: z.array(z.string()),
      canBeOverriddenByRoles: z.array(z.string())
    })
  )
}).passthrough();

export const explainAllowedSchema = z
  .object({
    status: z.literal("ALLOWED"),
    action: z.string(),
    at: z.string().nullable().optional(),
    projectionSummary: z
      .object({
        state: z.string().nullable().optional(),
        stressMode: z.string().nullable().optional()
      })
      .nullable()
      .optional()
  })
  .passthrough();

export const explainResponseSchema = z
  .union([explainBlockSchema, explainAllowedSchema]);

export const actionResponseSchema = z.object({
  status: z.literal("ALLOWED"),
  action: z.string(),
  event: z.unknown(),
  appendedEventId: z.string().nullable().optional()
});

export const createDealRequestSchema = z.object({
  name: z.string().min(1),
  profile: dealProfileSchema.optional(),
  sessionId: z.string().optional()
});

export const llmDealParseRequestSchema = z.object({
  inputText: z.string().min(1),
  inputSource: z.enum(["USER_TEXT", "DOC_EXTRACT", "API"]).optional()
});

export const llmDealParseResponseSchema = z
  .object({
    name: z.string().nullable().optional(),
    asset_type: z.string().nullable().optional(),
    asset_address: z.string().nullable().optional(),
    asset_city: z.string().nullable().optional(),
    asset_state: z.string().nullable().optional(),
    square_footage: z.number().nullable().optional(),
    unit_count: z.number().nullable().optional(),
    year_built: z.number().nullable().optional(),
    purchase_price: z.number().nullable().optional(),
    noi: z.number().nullable().optional(),
    cap_rate: z.number().nullable().optional(),
    senior_debt: z.number().nullable().optional(),
    mezzanine_debt: z.number().nullable().optional(),
    preferred_equity: z.number().nullable().optional(),
    common_equity: z.number().nullable().optional(),
    gp_name: z.string().nullable().optional(),
    lender_name: z.string().nullable().optional(),
    deal_summary: z.string().nullable().optional(),
    ltv: z.number().nullable().optional(),
    dscr: z.number().nullable().optional()
  })
  .passthrough();

export const provenanceSchema = z.object({
  fieldPath: z.string(),
  value: z.unknown().nullable().optional(),
  source: z.enum(["AI", "HUMAN", "DOC"]),
  confidence: z.number().nullable().optional(),
  rationale: z.string().nullable().optional(),
  evidenceNeeded: z.string().nullable().optional(),
  artifactId: z.string().nullable().optional(),
  asOf: z.string().nullable().optional()
});

export const evaluatorReportSchema = z.object({
  status: z.enum(["OK", "EVAL_FAILED"]),
  schemaCompleteness: z.object({
    score: z.number(),
    missingFields: z.array(z.string())
  }),
  numericConsistency: z.object({
    score: z.number(),
    flags: z.array(z.string())
  }),
  provenance: z.object({
    score: z.number(),
    flags: z.array(z.string())
  }),
  criticalFlags: z.array(z.string())
});

export const workflowTaskSchema = z.object({
  id: z.string().optional(),
  dealId: z.string().optional(),
  type: z.enum([
    "REQUEST_EVIDENCE",
    "REQUEST_APPROVAL",
    "REVIEW_FLAG",
    "FIX_FIELD"
  ]),
  title: z.string(),
  description: z.string().nullable().optional(),
  status: z.enum(["OPEN", "IN_PROGRESS", "DONE", "DISMISSED"]),
  relatedFieldPath: z.string().nullable().optional(),
  relatedArtifactId: z.string().nullable().optional(),
  severity: z.enum(["LOW", "MEDIUM", "HIGH"]),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional()
});

export const llmParseDealResponseSchema = z.object({
  sessionId: z.string(),
  status: z.enum(["OK", "EVAL_FAILED", "VALIDATION_FAILED"]).optional(),
  parsedDeal: llmDealParseResponseSchema,
  provenance: z.array(provenanceSchema),
  evaluatorReport: evaluatorReportSchema,
  recommendedTasks: z.array(workflowTaskSchema)
});

export const llmForceAcceptRequestSchema = z.object({
  sessionId: z.string().min(1),
  rationale: z.string().min(1)
});

export const correctionsRequestSchema = z.object({
  sessionId: z.string().optional(),
  diffs: z.array(
    z.object({
      fieldPath: z.string(),
      oldValue: z.unknown().optional(),
      newValue: z.unknown().optional(),
      correctionType: z.enum(["EDIT", "DELETE", "ADD"])
    })
  )
});

export const dataTrustResponseSchema = z.object({
  docCount: z.number(),
  aiCount: z.number(),
  humanCount: z.number(),
  openTasksCount: z.number(),
  tasks: z.array(workflowTaskSchema)
});

export const inboxItemSchema = z.object({
  dealId: z.string(),
  dealName: z.string(),
  lifecycle_state: z.string().nullable().optional(),
  truth_health: z.string().nullable().optional(),
  primary_blocker: z.string().nullable().optional(),
  next_action: z
    .object({
      actionType: z.string().nullable().optional(),
      label: z.string().nullable().optional()
    })
    .nullable()
    .optional(),
  assignedToMe: z.boolean(),
  updatedAt: z.string().nullable().optional()
});

export const inboxResponseSchema = z.object({
  items: z.array(inboxItemSchema)
});

// LP Portal Schemas
export const lpInvestmentStatusSchema = z.enum([
  "OFFER_PENDING",
  "OFFER_ACCEPTED",
  "CAPITAL_CALLED",
  "CAPITAL_DEPLOYED",
  "OPERATING",
  "AMENDED",
  "EXITING",
  "EXITED"
]);

// Share class schema for LP ownership
export const lpShareClassSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  preferredReturn: z.number().nullable().optional(),
  managementFee: z.number().nullable().optional(),
  carryPercent: z.number().nullable().optional()
}).nullable().optional();

export const lpOwnershipSchema = z.object({
  entity: z.string(),
  commitment: z.number(),
  ownership_pct: z.number(),
  effective_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
  shareClass: lpShareClassSchema
});

export const lpCapitalEventSchema = z.object({
  id: z.string(),
  type: z.enum(["CALL", "DISTRIBUTION", "RETURN", "FEE"]),
  amount: z.number(),
  date: z.string(),
  description: z.string().nullable().optional(),
  timestamp: z.string().nullable().optional()
});

export const lpCovenantComplianceSchema = z.object({
  status: z.enum(["COMPLIANT", "TEMPORARILY_AMENDED", "AT_RISK", "BREACHED"]),
  amended_covenants: z.number().default(0),
  details: z.string().nullable().optional()
});

export const lpPerformanceSnapshotSchema = z.object({
  cash_in: z.number(),
  cash_out: z.number(),
  net_invested: z.number(),
  distributions_to_date: z.number(),
  period: z.string().nullable().optional()
});

export const lpInvestmentDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  asset_type: z.string(),
  status: lpInvestmentStatusSchema,
  last_update: z.string(),
  key_notes: z.string().nullable().optional(),
  ownership: lpOwnershipSchema,
  capital_events: z.array(lpCapitalEventSchema),
  compliance: lpCovenantComplianceSchema,
  performance: lpPerformanceSnapshotSchema,
  documents: z.array(z.object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
    added_date: z.string(),
    supersedes: z.string().nullable().optional()
  })).optional()
});

export const lpPortalInvestmentListSchema = z.array(z.object({
  id: z.string(),
  name: z.string(),
  asset_type: z.string(),
  status: lpInvestmentStatusSchema,
  last_update: z.string(),
  key_notes: z.string().nullable().optional()
}));

export const lpPortalSummarySchema = z.object({
  active_investments: z.number(),
  capital_committed: z.number(),
  capital_deployed: z.number(),
  distributions_ytd: z.number()
});

export const lpPortalLandingSchema = z.object({
  summary: lpPortalSummarySchema,
  investments: lpPortalInvestmentListSchema
});

export const lpInvitationRequestSchema = z.object({
  lpEntityName: z.string().min(1),
  lpEmail: z.string().email(),
  dealId: z.string().uuid(),
  commitment: z.number().positive(),
  ownershipPct: z.number().positive().max(100)
});

export const lpInvitationSchema = z.object({
  id: z.string(),
  dealId: z.string(),
  lpEntityName: z.string(),
  lpEmail: z.string(),
  status: z.enum(["PENDING", "ACCEPTED", "REJECTED", "REVOKED"]),
  commitment: z.number(),
  ownershipPct: z.number(),
  createdAt: z.string(),
  acceptedAt: z.string().nullable().optional(),
  expiresAt: z.string()
});

export function verifyExplainBlockKeys(explain) {
  const required = ["action", "status", "reasons", "nextSteps"];
  const missing = required.filter(
    (key) => !Object.prototype.hasOwnProperty.call(explain ?? {}, key)
  );
  return { ok: missing.length === 0, missing };
}
