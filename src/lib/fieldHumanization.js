/**
 * Field Humanization Utilities
 *
 * Maps technical field names, action types, and material types to user-friendly labels.
 * Supports the "Calm UX" principle by hiding backend vocabulary from users.
 */

const FIELD_LABELS = {
  // Profile fields - Property Details (with and without "profile." prefix)
  "profile.asset_address": "Property Address",
  "asset_address": "Property Address",
  "profile.asset_city": "City",
  "asset_city": "City",
  "profile.asset_state": "State",
  "asset_state": "State",
  "profile.purchase_price": "Purchase Price",
  "purchase_price": "Purchase Price",
  "profile.noi": "NOI",
  "noi": "NOI",
  "profile.cap_rate": "Cap Rate",
  "cap_rate": "Cap Rate",
  "profile.asset_type": "Property Type",
  "asset_type": "Property Type",
  "profile.square_footage": "Square Footage",
  "square_footage": "Square Footage",
  "profile.unit_count": "Number of Units",
  "unit_count": "Number of Units",
  "profile.year_built": "Year Built",
  "year_built": "Year Built",
  "profile.occupancy_rate": "Occupancy Rate",
  "occupancy_rate": "Occupancy Rate",
  "profile.market_value": "Market Value",
  "market_value": "Market Value",

  // Profile fields - Financial Structure
  "profile.ltv": "LTV",
  "ltv": "LTV",
  "profile.dscr": "DSCR",
  "dscr": "DSCR",
  "profile.senior_debt": "Senior Debt",
  "senior_debt": "Senior Debt",
  "profile.mezzanine_debt": "Mezzanine Debt",
  "mezzanine_debt": "Mezzanine Debt",
  "profile.preferred_equity": "Preferred Equity",
  "preferred_equity": "Preferred Equity",
  "profile.common_equity": "Common Equity",
  "common_equity": "Common Equity",
  "profile.total_debt": "Total Debt",
  "total_debt": "Total Debt",
  "profile.equity_multiple": "Equity Multiple",
  "equity_multiple": "Equity Multiple",
  "profile.irr": "IRR",
  "irr": "IRR",

  // Profile fields - Operating Details
  "profile.property_management_company": "Property Management Company",
  "property_management_company": "Property Management Company",
  "profile.lease_expiration": "Lease Expiration",
  "lease_expiration": "Lease Expiration",
  "profile.major_tenants": "Major Tenants",
  "major_tenants": "Major Tenants",
  "profile.insurance_provider": "Insurance Provider",
  "insurance_provider": "Insurance Provider",

  // Additional common fields
  "profile.closing_date": "Closing Date",
  "closing_date": "Closing Date",
  "profile.lender": "Lender",
  "lender": "Lender",
  "profile.sponsor": "Sponsor",
  "sponsor": "Sponsor",
  "profile.fund_name": "Fund Name",
  "fund_name": "Fund Name",
  "name": "Deal Name"
};

const ACTION_LABELS = {
  // Lifecycle actions
  "APPROVE_DEAL": "Approve Deal",
  "REVIEW_OPEN": "Open Review",
  "ATTEST_READY_TO_CLOSE": "Attest Ready to Close",
  "FINALIZE_CLOSING": "Finalize Closing",
  "ACTIVATE_OPERATIONS": "Activate Operations",
  "RESOLVE_DISTRESS": "Resolve Distress",
  "DECLARE_DISTRESS": "Declare Distress",
  "IMPOSE_FREEZE": "Impose Freeze",
  "LIFT_FREEZE": "Lift Freeze",
  "FINALIZE_EXIT": "Finalize Exit",
  "TERMINATE_DEAL": "Terminate Deal",

  // Evidence and approval actions
  "GRANT_APPROVAL": "Grant Approval",
  "DENY_APPROVAL": "Deny Approval",
  "OVERRIDE_ATTEST": "Override Decision",
  "DISPUTE_DATA": "Dispute Data",
  "RECONCILE_CHANGE": "Reconcile Change",
  "DETECT_MATERIAL_CHANGE": "Detect Material Change",

  // Workflow task types
  "REQUEST_EVIDENCE": "Request Evidence",
  "REQUEST_APPROVAL": "Request Approval",
  "REVIEW_FLAG": "Review Flag",
  "FIX_FIELD": "Fix Data Field"
};

const MATERIAL_TYPE_LABELS = {
  "UnderwritingSummary": "Underwriting Summary",
  "FinalUnderwriting": "Final Underwriting",
  "SourcesAndUses": "Sources and Uses",
  "WireConfirmation": "Wire Confirmation",
  "EntityFormationDocs": "Entity Formation Documents",
  "PropertyManagementAgreement": "Property Management Agreement",
  "InsurancePolicy": "Insurance Policy",
  "TitleReport": "Title Report",
  "EnvironmentalReport": "Environmental Report",
  "Appraisal": "Appraisal",
  "PropertyInspection": "Property Inspection",
  "OperatingAgreement": "Operating Agreement",
  "SubscriptionAgreement": "Subscription Agreement"
};

/**
 * Convert a technical field path to a human-friendly label
 * @param {string} fieldPath - Technical field path (e.g., "profile.purchase_price")
 * @returns {string} Human-friendly label (e.g., "Purchase Price")
 */
export function humanizeFieldPath(fieldPath) {
  if (!fieldPath) return "";

  // Check if we have a predefined label
  if (FIELD_LABELS[fieldPath]) {
    return FIELD_LABELS[fieldPath];
  }

  // Remove profile prefix for fallback processing
  const cleanField = fieldPath.replace(/^profile\./, "");

  // Special cases that should always be uppercase
  const upperCaseFields = {
    'noi': 'NOI',
    'ltv': 'LTV',
    'irr': 'IRR',
    'dscr': 'DSCR'
  };

  if (upperCaseFields[cleanField.toLowerCase()]) {
    return upperCaseFields[cleanField.toLowerCase()];
  }

  // Fallback: auto-generate from field path
  return cleanField
    .replace(/_/g, " ")          // Replace underscores with spaces
    .replace(/\b\w/g, l => l.toUpperCase()); // Capitalize each word
}

/**
 * Convert a technical action name to a human-friendly label
 * @param {string} action - Technical action name (e.g., "APPROVE_DEAL")
 * @returns {string} Human-friendly label (e.g., "Approve Deal")
 */
export function humanizeAction(action) {
  if (!action) return "";

  // Check if we have a predefined label
  if (ACTION_LABELS[action]) {
    return ACTION_LABELS[action];
  }

  // Fallback: auto-generate from action name
  return action
    .split("_")
    .map(word => word.charAt(0) + word.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Convert a technical material type to a human-friendly label
 * @param {string} materialType - Technical material type (e.g., "UnderwritingSummary")
 * @returns {string} Human-friendly label (e.g., "Underwriting Summary")
 */
export function humanizeMaterialType(materialType) {
  if (!materialType) return "";

  // Check if we have a predefined label
  if (MATERIAL_TYPE_LABELS[materialType]) {
    return MATERIAL_TYPE_LABELS[materialType];
  }

  // Fallback: auto-generate by adding spaces before capitals
  return materialType
    .replace(/([A-Z])/g, " $1")
    .trim();
}

/**
 * Convert a technical deal state to a human-friendly label
 * @param {string} state - Technical state (e.g., "ReadyToClose")
 * @returns {string} Human-friendly label (e.g., "Ready to Close")
 */
export function humanizeState(state) {
  if (!state) return "";

  const stateLabels = {
    "Draft": "Draft",
    "UnderReview": "Under Review",
    "Approved": "Approved",
    "ReadyToClose": "Ready to Close",
    "Closed": "Closed",
    "Operating": "Operating",
    "Changed": "Material Change Detected",
    "Distressed": "Distressed",
    "Resolved": "Resolved",
    "Frozen": "Frozen",
    "Exited": "Exited",
    "Terminated": "Terminated"
  };

  return stateLabels[state] || state
    .replace(/([A-Z])/g, " $1")
    .trim();
}

/**
 * Convert a stress mode to a human-friendly label with description
 * @param {string} stressMode - Stress mode (e.g., "SM-2")
 * @returns {object} Label and description
 */
export function humanizeStressMode(stressMode) {
  const stressModes = {
    "SM-0": {
      label: "Normal Operations",
      description: "All systems operating normally",
      severity: "low"
    },
    "SM-1": {
      label: "Data Disputed",
      description: "Data accuracy or completeness is being disputed",
      severity: "medium"
    },
    "SM-2": {
      label: "Distressed",
      description: "Deal is experiencing financial or operational distress",
      severity: "high"
    },
    "SM-3": {
      label: "Frozen",
      description: "Deal activities are frozen pending resolution",
      severity: "critical"
    }
  };

  return stressModes[stressMode] || {
    label: stressMode,
    description: "Unknown stress mode",
    severity: "unknown"
  };
}

/**
 * Convert a role name to a human-friendly label
 * @param {string} role - Role name (e.g., "GP")
 * @returns {string} Human-friendly label (e.g., "General Partner")
 */
export function humanizeRole(role) {
  const roleLabels = {
    "GP": "General Partner",
    "LP": "Limited Partner",
    "LEGAL": "Legal Counsel",
    "LENDER": "Lender",
    "ESCROW": "Escrow Agent",
    "OPERATOR": "Property Operator",
    "AUDITOR": "Auditor",
    "REGULATOR": "Regulator",
    "TRUSTEE": "Trustee",
    "COURT": "Court"
  };

  return roleLabels[role] || role;
}

/**
 * Format a number as currency with dollar sign and commas
 * @param {number|string} value - The numeric value to format
 * @param {object} options - Formatting options
 * @param {boolean} [options.compact] - Use compact notation (1.5M instead of $1,500,000)
 * @returns {string} Formatted currency string
 */
export function formatCurrency(value, options) {
  const { compact = false } = options || {};

  if (value === null || value === undefined || value === "") return "—";

  const numValue = typeof value === "string" ? parseFloat(value) : value;

  if (isNaN(numValue)) return "—";

  if (compact && numValue >= 1000000) {
    // Format as millions with one decimal place
    return `$${(numValue / 1000000).toFixed(1)}M`;
  } else if (compact && numValue >= 1000) {
    // Format as thousands with one decimal place
    return `$${(numValue / 1000).toFixed(1)}K`;
  }

  // Standard formatting with commas
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(numValue);
}

/**
 * Replace technical field names in text with humanized versions
 * @param {string} text - Text containing technical field names
 * @returns {string} Text with humanized field names
 */
export function humanizeText(text) {
  if (!text) return "";

  let result = text;

  // Replace field names (both with and without profile. prefix)
  const fieldPatterns = [
    { pattern: /\basset_address\b/g, replacement: "Property Address" },
    { pattern: /\basset_city\b/g, replacement: "City" },
    { pattern: /\basset_state\b/g, replacement: "State" },
    { pattern: /\bpurchase_price\b/g, replacement: "Purchase Price" },
    { pattern: /\bcap_rate\b/g, replacement: "Cap Rate" },
    { pattern: /\basset_type\b/g, replacement: "Property Type" },
    { pattern: /\bsquare_footage\b/g, replacement: "Square Footage" },
    { pattern: /\bunit_count\b/g, replacement: "Number of Units" },
    { pattern: /\byear_built\b/g, replacement: "Year Built" },
    { pattern: /\boccupancy_rate\b/g, replacement: "Occupancy Rate" },
    { pattern: /\bmarket_value\b/g, replacement: "Market Value" },
    { pattern: /\bsenior_debt\b/g, replacement: "Senior Debt" },
    { pattern: /\bmezzanine_debt\b/g, replacement: "Mezzanine Debt" },
    { pattern: /\bpreferred_equity\b/g, replacement: "Preferred Equity" },
    { pattern: /\bcommon_equity\b/g, replacement: "Common Equity" },
    { pattern: /\btotal_debt\b/g, replacement: "Total Debt" },
    { pattern: /\bequity_multiple\b/g, replacement: "Equity Multiple" },
    { pattern: /\bproperty_management_company\b/g, replacement: "Property Management Company" },
    { pattern: /\blease_expiration\b/g, replacement: "Lease Expiration" },
    { pattern: /\bmajor_tenants\b/g, replacement: "Major Tenants" },
    { pattern: /\binsurance_provider\b/g, replacement: "Insurance Provider" },
    { pattern: /\bclosing_date\b/g, replacement: "Closing Date" },
    { pattern: /\blender\b/g, replacement: "Lender" },
    { pattern: /\bsponsor\b/g, replacement: "Sponsor" },
    { pattern: /\bfund_name\b/g, replacement: "Fund Name" },
    // Special cases that need to stay uppercase
    { pattern: /\bnoi\b/gi, replacement: "NOI" },
    { pattern: /\bltv\b/gi, replacement: "LTV" },
    { pattern: /\birr\b/gi, replacement: "IRR" },
    { pattern: /\bdscr\b/gi, replacement: "DSCR" }
  ];

  for (const { pattern, replacement } of fieldPatterns) {
    result = result.replace(pattern, replacement);
  }

  return result;
}

/**
 * Format a truth class with appropriate badge styling
 * @param {string} truthClass - Truth class (DOC, HUMAN, AI)
 * @returns {object} Label and styling
 */
export function humanizeTruthClass(truthClass) {
  const truthClasses = {
    "DOC": {
      label: "Document-Verified",
      shortLabel: "DOC",
      color: "green",
      description: "Backed by uploaded documents"
    },
    "HUMAN": {
      label: "Human-Attested",
      shortLabel: "HUMAN",
      color: "blue",
      description: "Verified by human attestation"
    },
    "AI": {
      label: "AI-Derived",
      shortLabel: "AI",
      color: "gray",
      description: "Generated by AI, requires verification"
    }
  };

  return truthClasses[truthClass] || {
    label: truthClass,
    shortLabel: truthClass,
    color: "gray",
    description: "Unknown truth class"
  };
}

/**
 * Format a number with commas (no currency symbol)
 * @param {number|string} value - The numeric value to format
 * @param {object} options - Formatting options
 * @param {number} [options.decimals] - Number of decimal places (default 0)
 * @returns {string} Formatted number string
 */
export function formatNumber(value, options) {
  const { decimals = 0 } = options || {};

  if (value === null || value === undefined || value === "") return "—";

  const numValue = typeof value === "string" ? parseFloat(value) : value;

  if (isNaN(numValue)) return "—";

  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(numValue);
}

/**
 * Format a percentage value
 * @param {number|string} value - The numeric value (0.05 = 5%)
 * @param {object} options - Formatting options
 * @param {number} [options.decimals] - Number of decimal places (default 2)
 * @param {boolean} [options.alreadyPercent] - If true, value is already a percent (5 = 5%)
 * @returns {string} Formatted percentage string
 */
export function formatPercent(value, options) {
  const { decimals = 2, alreadyPercent = false } = options || {};

  if (value === null || value === undefined || value === "") return "—";

  let numValue = typeof value === "string" ? parseFloat(value) : value;

  if (isNaN(numValue)) return "—";

  // Convert decimal to percentage if needed
  if (!alreadyPercent && numValue <= 1) {
    numValue = numValue * 100;
  }

  return `${numValue.toFixed(decimals)}%`;
}

/**
 * Blocker message mappings for common blocker types
 */
const BLOCKER_MESSAGES = {
  "hasRentRoll": "Rent Roll document",
  "hasT12": "T12/Operating Statement",
  "UnderwritingSummary": "Underwriting Summary",
  "underwritingSummary": "Underwriting Summary",
  "allClaimsVerified": "All AI claims verified",
  "noOpenConflicts": "No unresolved conflicts",
  "hasSourceDocuments": "Source documents uploaded",
  "hasUnderwritingModel": "Underwriting model created",
  "hasICMemo": "IC Memo generated",
  "hasLOI": "Letter of Intent",
  "hasPSA": "Purchase and Sale Agreement",
  "RentRoll": "Rent Roll",
  "T12": "T12/Operating Statement",
  "Appraisal": "Appraisal Report",
  "EnvironmentalReport": "Environmental Report",
  "TitleReport": "Title Report"
};

/**
 * Convert a technical blocker message to a human-friendly label
 * Handles JSON strings, camelCase, and PascalCase
 * @param {string} blocker - Technical blocker message
 * @returns {string} Human-friendly blocker message
 */
export function humanizeBlocker(blocker) {
  if (!blocker) return "";

  // Handle JSON strings like {"hasRentRoll":false,"hasT12":false}
  if (typeof blocker === 'string' && blocker.startsWith('{')) {
    try {
      const parsed = JSON.parse(blocker);
      const missing = Object.entries(parsed)
        .filter(([, value]) => value === false)
        .map(([key]) => BLOCKER_MESSAGES[key] || humanizeFieldPath(key));
      if (missing.length > 0) {
        return `Missing: ${missing.join(', ')}`;
      }
      return blocker;
    } catch {
      // Not valid JSON, continue with other methods
    }
  }

  // Check for direct mapping
  if (BLOCKER_MESSAGES[blocker]) {
    return BLOCKER_MESSAGES[blocker];
  }

  // Handle "Missing X" pattern
  if (blocker.startsWith('Missing ')) {
    const item = blocker.replace('Missing ', '');
    return `Missing ${BLOCKER_MESSAGES[item] || item.replace(/([A-Z])/g, ' $1').trim()}`;
  }

  // Handle camelCase/PascalCase by adding spaces before capitals
  return blocker
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, str => str.toUpperCase())
    .trim();
}
