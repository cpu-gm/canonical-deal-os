/**
 * Loan Terms Extractor Service
 *
 * Extracts structured loan/debt terms from term sheets, loan applications,
 * and financing documents.
 */

const OPENAI_API_KEY = process.env.BFF_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY ?? null;
const OPENAI_MODEL = process.env.BFF_OPENAI_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini";
const OPENAI_BASE_URL = process.env.BFF_OPENAI_BASE_URL ?? "https://api.openai.com/v1";

/**
 * Schema for loan terms extraction output
 */
export const loanTermsSchema = {
  type: "object",
  properties: {
    lender: { type: "string" },
    loanAmount: { type: "number" },
    ltv: { type: "number" },
    interestRate: { type: "number" },
    rateType: { type: "string" },
    spread: { type: "number" },
    index: { type: "string" },
    term: { type: "number" },
    amortization: { type: "number" },
    ioPeriod: { type: "number" },
    prepaymentPenalty: { type: "string" },
    dscrRequirement: { type: "number" },
    recourse: { type: "string" },
    fees: {
      type: "object",
      properties: {
        origination: { type: "number" },
        exit: { type: "number" },
        other: { type: "number" }
      }
    },
    covenants: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          requirement: { type: "string" },
          value: { type: "number" }
        }
      }
    }
  }
};

/**
 * Build the extraction prompt for loan terms documents
 */
function buildLoanTermsExtractionPrompt(documentContent, filename) {
  return `You are extracting structured loan terms from a financing document (term sheet, loan application, or commitment letter).

Document name: ${filename}
Document content: ${documentContent}

Extract the following information:

1. BASIC TERMS:
   - lender: Name of the lending institution
   - loanAmount: Loan principal amount in dollars
   - ltv: Loan-to-value ratio as decimal (e.g., 0.65 for 65%)

2. INTEREST RATE:
   - interestRate: Annual interest rate as decimal (e.g., 0.055 for 5.5%)
   - rateType: One of [FIXED, FLOATING, HYBRID]
   - spread: If floating, spread over index as decimal (e.g., 0.025 for 250 bps)
   - index: If floating, the index (e.g., "SOFR", "Prime", "LIBOR")

3. LOAN STRUCTURE:
   - term: Loan term in years
   - amortization: Amortization period in years (if different from term)
   - ioPeriod: Interest-only period in years (0 if none)
   - prepaymentPenalty: Description of prepayment terms (e.g., "3-2-1", "Yield Maintenance", "None")

4. REQUIREMENTS:
   - dscrRequirement: Minimum debt service coverage ratio (e.g., 1.25)
   - recourse: One of [FULL, PARTIAL, NON] for non-recourse, partial recourse, or full recourse

5. FEES (all in dollars):
   - origination: Origination fee amount or percentage * loan amount
   - exit: Exit fee if any
   - other: Other fees (legal, appraisal, etc.)

6. COVENANTS (if listed):
   For each covenant or requirement:
   - name: Covenant name (e.g., "Minimum DSCR", "Maximum LTV", "Minimum Occupancy")
   - requirement: Description of what's required
   - value: Numeric threshold if applicable

IMPORTANT:
- All monetary values should be numbers in dollars (no $ signs)
- All percentages/ratios should be decimals (e.g., 5.5% = 0.055, 65% LTV = 0.65)
- Use null for any values not found in the document
- If origination fee is given as percentage, convert to dollar amount if loan amount is known
- For floating rates, interestRate should be the current all-in rate if stated, or index + spread

Return a JSON object with keys: lender, loanAmount, ltv, interestRate, rateType, spread, index, term, amortization, ioPeriod, prepaymentPenalty, dscrRequirement, recourse, fees, covenants`;
}

/**
 * Extract loan terms data from document content
 *
 * @param {string} documentContent - The text content of the loan document
 * @param {string} filename - The filename for context
 * @returns {Promise<Object>} Extracted loan terms data
 */
export async function extractLoanTerms(documentContent, filename) {
  if (!OPENAI_API_KEY) {
    const error = new Error("OpenAI not configured for loan terms extraction");
    error.status = 502;
    throw error;
  }

  const prompt = buildLoanTermsExtractionPrompt(documentContent, filename);

  const url = `${OPENAI_BASE_URL.replace(/\/$/, "")}/chat/completions`;
  const payload = {
    model: OPENAI_MODEL,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "You are a real estate underwriting assistant that extracts structured loan terms from financing documents. Return only valid JSON."
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
    const error = new Error(errorData?.error?.message ?? "Loan terms extraction failed");
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;

  if (!content) {
    const error = new Error("No content in loan terms extraction response");
    error.status = 502;
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    const error = new Error("Invalid JSON in loan terms extraction response");
    error.status = 502;
    throw error;
  }

  // Validate and normalize the response
  return normalizeLoanTermsData(parsed);
}

/**
 * Normalize and validate loan terms extraction data
 */
function normalizeLoanTermsData(data) {
  const result = {
    lender: data.lender ?? null,
    loanAmount: data.loanAmount ?? null,
    ltv: data.ltv ?? null,
    interestRate: data.interestRate ?? null,
    rateType: normalizeRateType(data.rateType),
    spread: data.spread ?? null,
    index: data.index ?? null,
    term: data.term ?? null,
    amortization: data.amortization ?? null,
    ioPeriod: data.ioPeriod ?? 0,
    prepaymentPenalty: data.prepaymentPenalty ?? null,
    dscrRequirement: data.dscrRequirement ?? null,
    recourse: normalizeRecourse(data.recourse),
    fees: {
      origination: data.fees?.origination ?? null,
      exit: data.fees?.exit ?? null,
      other: data.fees?.other ?? null
    },
    covenants: []
  };

  // If amortization not provided, assume same as term for fully amortizing
  if (!result.amortization && result.term) {
    result.amortization = result.term;
  }

  // Calculate LTV if loan amount and we have purchase price context
  // (This would need deal context, so leaving as-is for now)

  // Normalize covenants
  if (Array.isArray(data.covenants)) {
    result.covenants = data.covenants.map(cov => ({
      name: cov.name ?? null,
      requirement: cov.requirement ?? null,
      value: cov.value ?? null
    }));
  }

  return result;
}

/**
 * Normalize rate type to standard values
 */
function normalizeRateType(rateType) {
  if (!rateType) return null;

  const normalized = rateType.toUpperCase().trim();

  if (['FIXED', 'FIX'].includes(normalized)) return 'FIXED';
  if (['FLOATING', 'FLOAT', 'VARIABLE', 'ARM'].includes(normalized)) return 'FLOATING';
  if (['HYBRID'].includes(normalized)) return 'HYBRID';

  return 'FIXED'; // Default assumption
}

/**
 * Normalize recourse type to standard values
 */
function normalizeRecourse(recourse) {
  if (!recourse) return null;

  const normalized = recourse.toUpperCase().trim().replace('-', '');

  if (['FULL', 'FULLRECOURSE'].includes(normalized)) return 'FULL';
  if (['PARTIAL', 'PARTIALRECOURSE', 'LIMITED'].includes(normalized)) return 'PARTIAL';
  if (['NON', 'NONRECOURSE', 'NONE'].includes(normalized)) return 'NON';

  return null;
}

/**
 * Calculate confidence score for the extraction based on completeness
 */
export function calculateLoanTermsConfidence(data) {
  let score = 0;
  let total = 0;

  // Critical fields
  const criticalFields = ['loanAmount', 'interestRate', 'term'];
  criticalFields.forEach(field => {
    total += 2;
    if (data[field] !== null && data[field] !== undefined) {
      score += 2;
    }
  });

  // Important fields
  const importantFields = ['ltv', 'amortization', 'dscrRequirement', 'lender'];
  importantFields.forEach(field => {
    total += 1;
    if (data[field] !== null && data[field] !== undefined) {
      score += 1;
    }
  });

  // Rate details for floating
  if (data.rateType === 'FLOATING') {
    total += 1;
    if (data.spread && data.index) {
      score += 1;
    }
  }

  return score / total;
}

/**
 * Map loan terms to underwriting model fields
 */
export function mapLoanTermsToUnderwritingModel(loanTerms) {
  return {
    loanAmount: loanTerms.loanAmount ?? null,
    interestRate: loanTerms.interestRate ?? null,
    amortization: loanTerms.amortization ?? null,
    loanTerm: loanTerms.term ?? null
  };
}

/**
 * Calculate annual debt service from loan terms
 *
 * @param {number} loanAmount - Principal amount
 * @param {number} interestRate - Annual interest rate as decimal
 * @param {number} amortization - Amortization period in years
 * @param {number} ioPeriod - Interest-only period in years (0 if none)
 * @returns {Object} Debt service calculations
 */
export function calculateDebtService(loanAmount, interestRate, amortization, ioPeriod = 0) {
  if (!loanAmount || !interestRate) {
    return { annualDebtService: null, monthlyPayment: null };
  }

  // Interest-only payment
  const annualInterest = loanAmount * interestRate;
  const monthlyInterestOnly = annualInterest / 12;

  if (ioPeriod > 0) {
    // Return IO payment for IO period
    return {
      annualDebtService: annualInterest,
      monthlyPayment: monthlyInterestOnly,
      isInterestOnly: true
    };
  }

  // Amortizing payment calculation (standard mortgage formula)
  const monthlyRate = interestRate / 12;
  const numPayments = (amortization || 30) * 12;

  if (monthlyRate === 0) {
    const monthlyPayment = loanAmount / numPayments;
    return {
      annualDebtService: monthlyPayment * 12,
      monthlyPayment,
      isInterestOnly: false
    };
  }

  const monthlyPayment = loanAmount *
    (monthlyRate * Math.pow(1 + monthlyRate, numPayments)) /
    (Math.pow(1 + monthlyRate, numPayments) - 1);

  return {
    annualDebtService: monthlyPayment * 12,
    monthlyPayment,
    isInterestOnly: false
  };
}

export default {
  extractLoanTerms,
  calculateLoanTermsConfidence,
  mapLoanTermsToUnderwritingModel,
  calculateDebtService,
  loanTermsSchema
};
