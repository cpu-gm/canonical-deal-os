import { SCHEMA_VERSION, PROMPT_VERSION } from "./llm.js";

const REQUIRED_FIELDS = ["name", "asset_type", "asset_address"];
const FIELD_DEFS = [
  "name",
  "asset_type",
  "asset_address",
  "asset_city",
  "asset_state",
  "square_footage",
  "unit_count",
  "year_built",
  "purchase_price",
  "noi",
  "cap_rate",
  "senior_debt",
  "mezzanine_debt",
  "preferred_equity",
  "common_equity",
  "gp_name",
  "lender_name",
  "deal_summary",
  "ltv",
  "dscr"
];

const NUMERIC_FIELDS = new Set([
  "square_footage",
  "unit_count",
  "year_built",
  "purchase_price",
  "noi",
  "cap_rate",
  "senior_debt",
  "mezzanine_debt",
  "preferred_equity",
  "common_equity",
  "ltv",
  "dscr"
]);

const SENSITIVE_NUMERIC_FIELDS = new Set([
  "purchase_price",
  "noi",
  "ltv",
  "cap_rate"
]);

const EVIDENCE_MAP = {
  purchase_price: "PSA",
  noi: "T12",
  ltv: "Debt Schedule",
  cap_rate: "Appraisal"
};

const EVAL_MIN_SCORE = 70;

function coerceNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeString(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function isUnknown(value) {
  if (!value) {
    return false;
  }
  return String(value).trim().toLowerCase() === "unknown";
}

export function normalizeParsedDeal(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const normalized = {};
  for (const field of FIELD_DEFS) {
    if (NUMERIC_FIELDS.has(field)) {
      normalized[field] = coerceNumber(source[field]);
      continue;
    }
    normalized[field] = normalizeString(source[field]) ?? null;
  }
  return normalized;
}

export function buildProvenance(parsedDeal, { source = "AI", now }) {
  const timestamp = now ?? new Date().toISOString();
  return FIELD_DEFS.map((field) => {
    const value = parsedDeal[field] ?? null;
    const confidence = value === null ? 0 : 0.6;
    const evidenceNeeded =
      SENSITIVE_NUMERIC_FIELDS.has(field) && source !== "DOC"
        ? EVIDENCE_MAP[field] ?? "Supporting document"
        : null;

    return {
      fieldPath: field === "name" ? "name" : `profile.${field}`,
      value,
      source,
      confidence,
      rationale: "Extracted from input text",
      evidenceNeeded,
      artifactId: null,
      asOf: timestamp
    };
  });
}

export function runEvaluators(parsedDeal, provenanceRows) {
  const missingFields = REQUIRED_FIELDS.filter((field) => {
    const value = parsedDeal[field];
    if (value !== null && value !== undefined) {
      return false;
    }
    if (isUnknown(value)) {
      return false;
    }
    return true;
  });

  const completenessScore = Math.max(
    0,
    100 - missingFields.length * 25
  );

  const numericFlags = [];
  for (const field of NUMERIC_FIELDS) {
    const value = parsedDeal[field];
    if (value === null || value === undefined) {
      continue;
    }
    if (value < 0) {
      numericFlags.push(`${field} is negative`);
    }
  }

  if (parsedDeal.cap_rate !== null) {
    if (parsedDeal.cap_rate < 0 || parsedDeal.cap_rate > 1.5) {
      numericFlags.push("cap_rate out of bounds");
    }
  }

  if (parsedDeal.ltv !== null) {
    if (parsedDeal.ltv < 0 || parsedDeal.ltv > 2) {
      numericFlags.push("ltv out of bounds");
    }
  }

  const totalDebt =
    (parsedDeal.senior_debt ?? 0) + (parsedDeal.mezzanine_debt ?? 0);
  if (parsedDeal.purchase_price && parsedDeal.ltv && totalDebt) {
    const implied = totalDebt / parsedDeal.purchase_price;
    const delta = Math.abs(implied - parsedDeal.ltv);
    if (delta > 0.05) {
      numericFlags.push("ltv inconsistent with debt totals");
    }
  }

  const numericScore = Math.max(0, 100 - numericFlags.length * 15);

  const provenanceFlags = [];
  for (const row of provenanceRows) {
    const field = row.fieldPath.replace("profile.", "");
    if (!SENSITIVE_NUMERIC_FIELDS.has(field)) {
      continue;
    }
    if (row.source !== "DOC" && !row.evidenceNeeded) {
      provenanceFlags.push(`${field} missing evidence plan`);
    }
    if (row.confidence === null || row.confidence === undefined) {
      provenanceFlags.push(`${field} missing confidence`);
    }
  }

  const provenanceScore = Math.max(0, 100 - provenanceFlags.length * 20);

  const criticalFlags = [
    ...missingFields.map((field) => `missing ${field}`)
  ];

  const status =
    criticalFlags.length > 0 ||
    completenessScore < EVAL_MIN_SCORE ||
    numericScore < EVAL_MIN_SCORE ||
    provenanceScore < EVAL_MIN_SCORE
      ? "EVAL_FAILED"
      : "OK";

  return {
    status,
    schemaCompleteness: {
      score: completenessScore,
      missingFields
    },
    numericConsistency: {
      score: numericScore,
      flags: numericFlags
    },
    provenance: {
      score: provenanceScore,
      flags: provenanceFlags
    },
    criticalFlags
  };
}

export function buildRecommendedTasks(provenanceRows, evaluatorReport) {
  const tasks = [];
  const now = new Date().toISOString();

  for (const row of provenanceRows) {
    const field = row.fieldPath.replace("profile.", "");
    if (!SENSITIVE_NUMERIC_FIELDS.has(field)) {
      continue;
    }
    if (row.source !== "DOC") {
      tasks.push({
        type: "REQUEST_EVIDENCE",
        title: `Provide evidence for ${field}`,
        description: row.evidenceNeeded
          ? `Upload ${row.evidenceNeeded} to document ${field}.`
          : `Upload supporting evidence for ${field}.`,
        status: "OPEN",
        relatedFieldPath: row.fieldPath,
        severity: "MEDIUM",
        createdAt: now,
        updatedAt: now
      });
    }
  }

  if (evaluatorReport?.schemaCompleteness?.missingFields?.length) {
    evaluatorReport.schemaCompleteness.missingFields.forEach((field) => {
      tasks.push({
        type: "FIX_FIELD",
        title: `Fill missing field ${field}`,
        description: "Provide a verified value or mark as unknown.",
        status: "OPEN",
        relatedFieldPath: field === "name" ? "name" : `profile.${field}`,
        severity: "HIGH",
        createdAt: now,
        updatedAt: now
      });
    });
  }

  return tasks;
}

export function summarizeTrust(provenanceRows) {
  const summary = {
    aiCount: 0,
    humanCount: 0,
    docCount: 0
  };
  for (const row of provenanceRows) {
    if (row.source === "DOC") summary.docCount += 1;
    else if (row.source === "HUMAN") summary.humanCount += 1;
    else summary.aiCount += 1;
  }
  return summary;
}

export function buildAirlockMeta(provider) {
  return {
    provider,
    promptVersion: PROMPT_VERSION,
    schemaVersion: SCHEMA_VERSION
  };
}
