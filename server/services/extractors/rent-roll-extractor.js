/**
 * Rent Roll Extractor Service
 *
 * Extracts structured data from rent roll documents using LLM parsing.
 * Returns both summary metrics and unit-level details.
 */

const OPENAI_API_KEY = process.env.BFF_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY ?? null;
const OPENAI_MODEL = process.env.BFF_OPENAI_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini";
const OPENAI_BASE_URL = process.env.BFF_OPENAI_BASE_URL ?? "https://api.openai.com/v1";

/**
 * Schema for rent roll extraction output
 */
export const rentRollSchema = {
  type: "object",
  properties: {
    summary: {
      type: "object",
      properties: {
        totalUnits: { type: "number" },
        occupiedUnits: { type: "number" },
        vacantUnits: { type: "number" },
        avgRentPerUnit: { type: "number" },
        totalMonthlyRent: { type: "number" },
        totalAnnualRent: { type: "number" },
        avgSqftPerUnit: { type: "number" },
        occupancyRate: { type: "number" },
        asOfDate: { type: "string" }
      }
    },
    unitMix: {
      type: "array",
      items: {
        type: "object",
        properties: {
          unitType: { type: "string" },
          count: { type: "number" },
          avgRent: { type: "number" },
          avgSqft: { type: "number" }
        }
      }
    },
    units: {
      type: "array",
      items: {
        type: "object",
        properties: {
          unitNumber: { type: "string" },
          unitType: { type: "string" },
          sqft: { type: "number" },
          currentRent: { type: "number" },
          marketRent: { type: "number" },
          leaseStart: { type: "string" },
          leaseEnd: { type: "string" },
          status: { type: "string" },
          tenant: { type: "string" }
        }
      }
    }
  }
};

/**
 * Build the extraction prompt for rent roll documents
 */
function buildRentRollExtractionPrompt(documentContent, filename) {
  return `You are extracting structured data from a rent roll document.

Document name: ${filename}
Document content: ${documentContent}

Extract the following information:

1. SUMMARY METRICS:
   - totalUnits: Total number of units in the property
   - occupiedUnits: Number of currently occupied units
   - vacantUnits: Number of vacant units
   - avgRentPerUnit: Average monthly rent per unit (in dollars)
   - totalMonthlyRent: Total monthly rental income (in dollars)
   - totalAnnualRent: Total annual rental income (in dollars)
   - avgSqftPerUnit: Average square footage per unit
   - occupancyRate: Occupancy rate as a decimal (e.g., 0.94 for 94%)
   - asOfDate: The date this rent roll is as of (ISO format if available)

2. UNIT MIX (aggregated by unit type):
   For each unique unit type (e.g., Studio, 1BR, 2BR, 3BR):
   - unitType: The unit type name
   - count: Number of units of this type
   - avgRent: Average rent for this unit type
   - avgSqft: Average square footage for this unit type

3. INDIVIDUAL UNITS (if detailed unit data is available):
   For each unit:
   - unitNumber: Unit number/identifier
   - unitType: Unit type (Studio, 1BR, 2BR, etc.)
   - sqft: Square footage
   - currentRent: Current monthly rent (in dollars)
   - marketRent: Market rent if available (in dollars)
   - leaseStart: Lease start date (ISO format)
   - leaseEnd: Lease end date (ISO format)
   - status: One of [OCCUPIED, VACANT, NOTICE, MTM] where MTM = month-to-month
   - tenant: Tenant name if available

IMPORTANT:
- Use null for any values not found in the document
- All monetary values should be numbers in dollars (no $ signs)
- Dates should be in ISO format (YYYY-MM-DD) when possible
- If unit-level data is too detailed or numerous, include at least the first 50 units
- Calculate summary metrics from available data if not explicitly stated

Return a JSON object with keys: summary, unitMix, units`;
}

/**
 * Extract rent roll data from document content
 *
 * @param {string} documentContent - The text content of the rent roll document
 * @param {string} filename - The filename for context
 * @returns {Promise<Object>} Extracted rent roll data
 */
export async function extractRentRoll(documentContent, filename) {
  if (!OPENAI_API_KEY) {
    const error = new Error("OpenAI not configured for rent roll extraction");
    error.status = 502;
    throw error;
  }

  const prompt = buildRentRollExtractionPrompt(documentContent, filename);

  const url = `${OPENAI_BASE_URL.replace(/\/$/, "")}/chat/completions`;
  const payload = {
    model: OPENAI_MODEL,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "You are a real estate underwriting assistant that extracts structured data from rent roll documents. Return only valid JSON."
      },
      {
        role: "user",
        content: prompt
      }
    ]
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    let errorData = null;
    try {
      errorData = await response.json();
    } catch {}
    const error = new Error(errorData?.error?.message ?? "Rent roll extraction failed");
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;

  if (!content) {
    const error = new Error("No content in rent roll extraction response");
    error.status = 502;
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    const error = new Error("Invalid JSON in rent roll extraction response");
    error.status = 502;
    throw error;
  }

  // Validate and normalize the response
  return normalizeRentRollData(parsed);
}

/**
 * Normalize and validate rent roll extraction data
 */
function normalizeRentRollData(data) {
  const result = {
    summary: {
      totalUnits: data.summary?.totalUnits ?? null,
      occupiedUnits: data.summary?.occupiedUnits ?? null,
      vacantUnits: data.summary?.vacantUnits ?? null,
      avgRentPerUnit: data.summary?.avgRentPerUnit ?? null,
      totalMonthlyRent: data.summary?.totalMonthlyRent ?? null,
      totalAnnualRent: data.summary?.totalAnnualRent ?? null,
      avgSqftPerUnit: data.summary?.avgSqftPerUnit ?? null,
      occupancyRate: data.summary?.occupancyRate ?? null,
      asOfDate: data.summary?.asOfDate ?? null
    },
    unitMix: [],
    units: []
  };

  // Calculate derived values if possible
  if (result.summary.totalUnits && result.summary.occupiedUnits && !result.summary.vacantUnits) {
    result.summary.vacantUnits = result.summary.totalUnits - result.summary.occupiedUnits;
  }

  if (result.summary.totalUnits && result.summary.occupiedUnits && !result.summary.occupancyRate) {
    result.summary.occupancyRate = result.summary.occupiedUnits / result.summary.totalUnits;
  }

  if (result.summary.totalMonthlyRent && !result.summary.totalAnnualRent) {
    result.summary.totalAnnualRent = result.summary.totalMonthlyRent * 12;
  }

  // Normalize unit mix
  if (Array.isArray(data.unitMix)) {
    result.unitMix = data.unitMix.map(mix => ({
      unitType: mix.unitType ?? null,
      count: mix.count ?? null,
      avgRent: mix.avgRent ?? null,
      avgSqft: mix.avgSqft ?? null
    }));
  }

  // Normalize individual units
  if (Array.isArray(data.units)) {
    result.units = data.units.map(unit => ({
      unitNumber: unit.unitNumber ?? null,
      unitType: unit.unitType ?? null,
      sqft: unit.sqft ?? null,
      currentRent: unit.currentRent ?? null,
      marketRent: unit.marketRent ?? null,
      leaseStart: unit.leaseStart ?? null,
      leaseEnd: unit.leaseEnd ?? null,
      status: normalizeUnitStatus(unit.status),
      tenant: unit.tenant ?? null
    }));
  }

  return result;
}

/**
 * Normalize unit status to standard values
 */
function normalizeUnitStatus(status) {
  if (!status) return null;

  const normalized = status.toUpperCase().trim();

  if (['OCCUPIED', 'LEASED', 'RENTED'].includes(normalized)) return 'OCCUPIED';
  if (['VACANT', 'EMPTY', 'AVAILABLE'].includes(normalized)) return 'VACANT';
  if (['NOTICE', 'NTV', 'NOTICE TO VACATE'].includes(normalized)) return 'NOTICE';
  if (['MTM', 'M2M', 'MONTH-TO-MONTH', 'MONTH TO MONTH'].includes(normalized)) return 'MTM';

  return 'OCCUPIED'; // Default assumption
}

/**
 * Calculate confidence score for the extraction based on completeness
 */
export function calculateRentRollConfidence(data) {
  let score = 0;
  let total = 0;

  // Summary fields (weighted more heavily)
  const summaryFields = ['totalUnits', 'occupiedUnits', 'totalMonthlyRent', 'occupancyRate'];
  summaryFields.forEach(field => {
    total += 2;
    if (data.summary?.[field] !== null && data.summary?.[field] !== undefined) {
      score += 2;
    }
  });

  // Unit mix present
  total += 1;
  if (data.unitMix?.length > 0) {
    score += 1;
  }

  // Individual units present
  total += 1;
  if (data.units?.length > 0) {
    score += 1;
  }

  return score / total;
}

export default {
  extractRentRoll,
  calculateRentRollConfidence,
  rentRollSchema
};
