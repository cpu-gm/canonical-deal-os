import { kernelFetchJson } from "./kernel.js";

const stateLabels = {
  Draft: "Draft",
  UnderReview: "Under Review",
  Approved: "Approved",
  ReadyToClose: "Ready to Close",
  Closed: "Closed",
  Operating: "Operating",
  Changed: "Changed",
  Distressed: "Distressed",
  Resolved: "Resolved",
  Frozen: "Frozen",
  Exited: "Exited",
  Terminated: "Terminated"
};

const nextActionByState = {
  Draft: { actionType: "OPEN_REVIEW", label: "Submit for Review" },
  UnderReview: { actionType: "APPROVE_DEAL", label: "Approve Deal" },
  Approved: { actionType: "ATTEST_READY_TO_CLOSE", label: "Attest Ready to Close" },
  ReadyToClose: { actionType: "FINALIZE_CLOSING", label: "Finalize Closing" },
  Closed: { actionType: "ACTIVATE_OPERATIONS", label: "Activate Operations" },
  Operating: { actionType: "DECLARE_CHANGE", label: "Declare Change" },
  Changed: { actionType: "RECONCILE_CHANGE", label: "Reconcile Change" },
  Distressed: { actionType: "RESOLVE_DISTRESS", label: "Resolve Distress" },
  Resolved: { actionType: "ACTIVATE_OPERATIONS", label: "Resume Operations" },
  Frozen: { actionType: "LIFT_FREEZE", label: "Lift Freeze" }
};

const actionToEventType = {
  OPEN_REVIEW: "ReviewOpened",
  APPROVE_DEAL: "DealApproved",
  ATTEST_READY_TO_CLOSE: "ClosingReadinessAttested",
  FINALIZE_CLOSING: "ClosingFinalized",
  ACTIVATE_OPERATIONS: "OperationsActivated",
  DECLARE_CHANGE: "MaterialChangeDetected",
  RECONCILE_CHANGE: "ChangeReconciled",
  DECLARE_DISTRESS: "DistressDeclared",
  RESOLVE_DISTRESS: "DistressResolved",
  IMPOSE_FREEZE: "FreezeImposed",
  LIFT_FREEZE: "FreezeLifted",
  FINALIZE_EXIT: "ExitFinalized",
  TERMINATE_DEAL: "DealTerminated",
  DISPUTE_DATA: "DataDisputed",
  OVERRIDE: "OverrideAttested"
};

const eventTitles = {
  ReviewOpened: "Review opened",
  DealApproved: "Deal approved",
  ClosingReadinessAttested: "Closing readiness attested",
  ClosingFinalized: "Closing finalized",
  OperationsActivated: "Operations activated",
  MaterialChangeDetected: "Material change detected",
  ChangeReconciled: "Change reconciled",
  DistressDeclared: "Distress declared",
  DistressResolved: "Distress resolved",
  FreezeImposed: "Freeze imposed",
  FreezeLifted: "Freeze lifted",
  ExitFinalized: "Exit finalized",
  DealTerminated: "Deal terminated",
  DataDisputed: "Data disputed",
  ApprovalGranted: "Approval granted",
  ApprovalDenied: "Approval denied",
  OverrideAttested: "Override attested"
};

function mapStateLabel(state) {
  return stateLabels[state] ?? state ?? null;
}

function deriveNextAction(state) {
  return nextActionByState[state] ?? null;
}

function normalizeStressMode(value) {
  if (!value || typeof value !== "string") {
    return null;
  }
  if (value === "SM0") {
    return "SM-0";
  }
  return value;
}

function normalizeTimestamp(value) {
  if (!value) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function isStressedMode(value) {
  const normalized = normalizeStressMode(value);
  return Boolean(normalized && normalized !== "SM-0");
}

function deriveBlockedBy(snapshot, actionType) {
  if (!snapshot || !actionType) {
    return null;
  }

  const requirements = snapshot.materials?.requiredFor?.[actionType] ?? [];
  const missing = requirements.filter((req) => req.status !== "OK");
  if (missing.length > 0) {
    return `Missing ${missing.map((req) => req.type).join(", ")}`;
  }

  const approval = snapshot.approvals?.[actionType];
  if (approval && !approval.satisfied) {
    const collected = Object.values(approval.satisfiedByRole ?? {}).reduce(
      (sum, count) => sum + count,
      0
    );
    return `Approval threshold ${collected}/${approval.threshold}`;
  }

  return null;
}

function deriveTruthHealth(snapshot, actionType, stressMode) {
  if (isStressedMode(stressMode)) {
    return "danger";
  }

  if (!snapshot || !actionType) {
    return null;
  }

  const requirements = snapshot.materials?.requiredFor?.[actionType] ?? [];
  const missing = requirements.filter((req) => req.status !== "OK");
  if (missing.length > 0) {
    return "warning";
  }

  const approval = snapshot.approvals?.[actionType];
  if (approval && !approval.satisfied) {
    return "warning";
  }

  return "healthy";
}

function mapEventTitle(eventType) {
  if (eventTitles[eventType]) {
    return eventTitles[eventType];
  }
  if (!eventType) {
    return null;
  }
  return eventType.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function buildEventDescription(event) {
  if (!event?.payload || typeof event.payload !== "object") {
    return null;
  }

  const payload = event.payload;
  if (event.type === "ApprovalGranted" || event.type === "ApprovalDenied") {
    if (typeof payload.action === "string") {
      return `${event.type === "ApprovalGranted" ? "Granted" : "Denied"} approval for ${payload.action}`;
    }
  }

  if (event.type === "OverrideAttested") {
    const action = typeof payload.action === "string" ? payload.action : "action";
    const reason = typeof payload.reason === "string" ? payload.reason : "override";
    return `Override: ${action} (${reason})`;
  }

  return null;
}

function mapEvidenceType(event, actor) {
  if (Array.isArray(event.evidenceRefs) && event.evidenceRefs.length > 0) {
    return "document_verified";
  }
  if (actor?.type === "HUMAN") {
    return "human_attested";
  }
  return "system_computed";
}

function mapEvent(event, actorMap) {
  const actor = actorMap.get(event.actorId) ?? null;
  const roleName = actor?.roles?.[0] ?? "System";

  return {
    id: event.id,
    deal_id: event.dealId,
    event_type: event.type,
    event_title: mapEventTitle(event.type),
    event_description: buildEventDescription(event),
    authority_role: roleName,
    authority_name: actor?.name ?? "System",
    evidence_type: mapEvidenceType(event, actor),
    evidence_hash: null,
    document_url: null,
    from_state: null,
    to_state: null,
    timestamp: event.createdAt,
    created_date: event.createdAt
  };
}

function mapAuthorities(actors) {
  return actors.map((actor) => {
    const role = actor.roles?.[0] ?? "System";
    return {
      id: actor.id,
      entity_name: actor.name,
      role,
      consent_status: "pending"
    };
  });
}

function buildActorMap(actors) {
  return new Map(
    (actors ?? []).map((actor) => [
      actor.id,
      { name: actor.name, type: actor.type, roles: actor.roles }
    ])
  );
}

function buildEvidenceSummary(artifacts) {
  if (!Array.isArray(artifacts)) {
    return { total_artifacts: 0, last_uploaded_at: null };
  }
  const last = artifacts[artifacts.length - 1];
  return {
    total_artifacts: artifacts.length,
    last_uploaded_at: normalizeTimestamp(last?.createdAt)
  };
}

function extractEvidenceRefs(material) {
  const data =
    material && typeof material.data === "object" && material.data !== null
      ? material.data
      : null;
  if (!data || !Array.isArray(data.evidenceRefs)) {
    return [];
  }
  return data.evidenceRefs.filter((ref) => typeof ref === "string");
}

export function resolveActionEventType(actionType) {
  return actionToEventType[actionType] ?? null;
}

/**
 * Maps field paths to kernel material types for automatic sync.
 * Standard fields have hardcoded mappings. Dynamic/custom fields return null.
 *
 * @param {string} fieldPath - e.g., "profile.purchase_price"
 * @returns {string|null} - Material type (e.g., "UnderwritingSummary") or null
 */
export function mapFieldToMaterialType(fieldPath) {
  // Standard fields → Material type mappings
  // Multiple fields can map to the same material type
  const mapping = {
    // Underwriting Summary fields (for APPROVE_DEAL)
    "profile.purchase_price": "UnderwritingSummary",
    "profile.noi": "UnderwritingSummary",
    "profile.cap_rate": "UnderwritingSummary",
    "profile.asset_type": "UnderwritingSummary",
    "profile.square_footage": "UnderwritingSummary",
    "profile.unit_count": "UnderwritingSummary",
    "profile.year_built": "UnderwritingSummary",

    // Final Underwriting fields (for ATTEST_READY_TO_CLOSE)
    "profile.ltv": "FinalUnderwriting",
    "profile.dscr": "FinalUnderwriting",
    "profile.senior_debt": "FinalUnderwriting",
    "profile.mezzanine_debt": "FinalUnderwriting",
    "profile.preferred_equity": "FinalUnderwriting",
    "profile.common_equity": "FinalUnderwriting"
  };

  // Return null for unknown fields (dynamic/custom fields)
  // User must manually create materials for these
  return mapping[fieldPath] || null;
}

export function buildCanonicalEvents(events, actors) {
  const actorMap = buildActorMap(actors);
  return (events ?? []).map((event) => mapEvent(event, actorMap));
}

export function buildCanonicalAuthorities(actors) {
  return mapAuthorities(actors ?? []);
}

export function buildEvidenceIndex(dealId, artifacts, events, materials, at) {
  const artifactList = Array.isArray(artifacts) ? artifacts : [];
  const eventList = Array.isArray(events) ? events : [];
  const materialList = Array.isArray(materials) ? materials : [];

  const artifactIds = new Set(
    artifactList
      .map((artifact) => artifact.artifactId ?? artifact.id)
      .filter((id) => typeof id === "string")
  );
  const referencesByArtifact = new Map();

  const addReference = (artifactId, reference) => {
    if (!artifactId || !artifactIds.has(artifactId)) {
      return;
    }
    const current = referencesByArtifact.get(artifactId) ?? [];
    current.push(reference);
    referencesByArtifact.set(artifactId, current);
  };

  for (const event of eventList) {
    if (!Array.isArray(event?.evidenceRefs)) {
      continue;
    }
    for (const ref of event.evidenceRefs) {
      if (typeof ref !== "string") {
        continue;
      }
      addReference(ref, { source: "eventEvidenceRef", eventId: event.id });
    }
  }

  for (const material of materialList) {
    const refs = extractEvidenceRefs(material);
    for (const ref of refs) {
      addReference(ref, { source: "materialEvidenceRef", materialId: material.id });
    }
  }

  return {
    dealId,
    at: normalizeTimestamp(at) ?? new Date().toISOString(),
    artifacts: artifactList.map((artifact) => {
      const artifactId = artifact.artifactId ?? artifact.id;
      return {
        artifactId,
        filename: artifact.filename ?? null,
        mimeType: artifact.mimeType ?? null,
        sizeBytes: artifact.sizeBytes ?? null,
        sha256Hex: artifact.sha256Hex ?? null,
        uploaderId: artifact.uploaderId ?? null,
        createdAt: normalizeTimestamp(artifact.createdAt),
        references: referencesByArtifact.get(artifactId) ?? []
      };
    })
  };
}

export function buildCanonicalDeal(record, kernelDeal, snapshot) {
  const nextAction = deriveNextAction(kernelDeal.state);
  const blockedBy = deriveBlockedBy(snapshot, nextAction?.actionType);
  const truthHealth = deriveTruthHealth(
    snapshot,
    nextAction?.actionType,
    kernelDeal.stressMode
  );

  return {
    id: kernelDeal.id,
    name: kernelDeal.name,
    lifecycle_state: mapStateLabel(kernelDeal.state),
    stress_mode: isStressedMode(kernelDeal.stressMode),
    stress_mode_label: normalizeStressMode(kernelDeal.stressMode),
    truth_health: truthHealth,
    next_action: nextAction?.label ?? null,
    next_action_type: nextAction?.actionType ?? null,
    blocked_by: blockedBy,
    created_date: kernelDeal.createdAt,
    updated_date: kernelDeal.updatedAt,
    profile: record?.profile ?? {},
    profile_meta: record?.profile_meta ?? {}
  };
}

export async function buildDealHome(kernelBaseUrl, record) {
  const [kernelDeal, snapshot, events, actors, artifacts] = await Promise.all([
    kernelFetchJson(`${kernelBaseUrl}/deals/${record.id}`),
    kernelFetchJson(`${kernelBaseUrl}/deals/${record.id}/snapshot`),
    kernelFetchJson(`${kernelBaseUrl}/deals/${record.id}/events`),
    kernelFetchJson(`${kernelBaseUrl}/deals/${record.id}/actors`),
    kernelFetchJson(`${kernelBaseUrl}/deals/${record.id}/artifacts`)
  ]);

  return {
    deal: buildCanonicalDeal(record, kernelDeal, snapshot),
    events: buildCanonicalEvents(events, actors),
    authorities: buildCanonicalAuthorities(actors),
    covenants: [],
    evidence: buildEvidenceSummary(artifacts),
    snapshot
  };
}
