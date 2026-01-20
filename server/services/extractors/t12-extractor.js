/**
 * T12 (Trailing Twelve) Extractor Service
 *
 * Extracts structured financial data from T12 operating statements.
 * Returns revenue, expense, and NOI information.
 */

const OPENAI_API_KEY = process.env.BFF_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY ?? null;
const OPENAI_MODEL = process.env.BFF_OPENAI_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini";
const OPENAI_BASE_URL = process.env.BFF_OPENAI_BASE_URL ?? "https://api.openai.com/v1";

/**
 * Schema for T12 extraction output
 */
export const t12Schema = {
  type: "object",
  properties: {
    period: {
      type: "object",
      properties: {
        startDate: { type: "string" },
        endDate: { type: "string" },
        months: { type: "number" }
      }
    },
    revenue: {
      type: "object",
      properties: {
        grossPotentialRent: { type: "number" },
        vacancyLoss: { type: "number" },
        concessions: { type: "number" },
        badDebt: { type: "number" },
        otherIncome: { type: "number" },
        effectiveGrossIncome: { type: "number" }
      }
    },
    expenses: {
      type: "object",
      properties: {
        taxes: { type: "number" },
        insurance: { type: "number" },
        utilities: { type: "number" },
        repairsAndMaintenance: { type: "number" },
        management: { type: "number" },
        payroll: { type: "number" },
        administrative: { type: "number" },
        marketing: { type: "number" },
        contractServices: { type: "number" },
        reserves: { type: "number" },
        other: { type: "number" },
        totalExpenses: { type: "number" }
      }
    },
    noi: { type: "number" },
    expenseRatio: { type: "number" },
    lineItems: {
      type: "array",
      items: {
        type: "object",
        properties: {
          category: { type: "string" },
          lineItem: { type: "string" },
          annualAmount: { type: "number" },
          monthlyAmounts: { type: "array", items: { type: "number" } }
        }
      }
    }
  }
};

/**
 * Build the extraction prompt for T12 documents
 */
function buildT12ExtractionPrompt(documentContent, filename) {
  return `You are extracting structured financial data from a T12 (Trailing Twelve Month) operating statement.

Document name: ${filename}
Document content: ${documentContent}

Extract the following information:

1. PERIOD:
   - startDate: Start date of the T12 period (ISO format YYYY-MM-DD)
   - endDate: End date of the T12 period (ISO format YYYY-MM-DD)
   - months: Number of months covered (usually 12)

2. REVENUE (all amounts in annual dollars):
   - grossPotentialRent: Total potential rent if 100% occupied at market rates
   - vacancyLoss: Revenue lost to vacancy (as a positive number)
   - concessions: Rent concessions/discounts given
   - badDebt: Uncollected rent/bad debt
   - otherIncome: Pet fees, parking, laundry, late fees, etc.
   - effectiveGrossIncome: GPR - vacancyLoss - concessions - badDebt + otherIncome

3. EXPENSES (all amounts in annual dollars):
   - taxes: Real estate taxes
   - insurance: Property insurance
   - utilities: Water, sewer, gas, electric, trash
   - repairsAndMaintenance: R&M, make-ready, general repairs
   - management: Property management fees
   - payroll: On-site staff salaries/wages
   - administrative: Office, legal, accounting, professional fees
   - marketing: Advertising, leasing commissions
   - contractServices: Landscaping, pest control, elevator, security
   - reserves: Replacement reserves (if listed as expense)
   - other: Any other operating expenses not categorized
   - totalExpenses: Sum of all operating expenses

4. NOI & RATIOS:
   - noi: Net Operating Income (EGI - Total Expenses)
   - expenseRatio: Total Expenses / Effective Gross Income (as decimal)

5. LINE ITEMS (detailed breakdown if available):
   For each expense or revenue line item in the document:
   - category: "REVENUE" or "EXPENSE"
   - lineItem: The name of the line item as it appears
   - annualAmount: The annual total
   - monthlyAmounts: Array of 12 monthly amounts if available, otherwise null

IMPORTANT:
- All monetary values should be numbers in dollars (no $ signs, no commas)
- Use null for any values not found in the document
- If monthly data is shown, calculate the annual amount
- If only annual is shown, leave monthlyAmounts as null
- Vacancy should be shown as a positive number (loss)

Return a JSON object with keys: period, revenue, expenses, noi, expenseRatio, lineItems`;
}

/**
 * Extract T12 data from document content
 *
 * @param {string} documentContent - The text content of the T12 document
 * @param {string} filename - The filename for context
 * @returns {Promise<Object>} Extracted T12 data
 */
export async function extractT12(documentContent, filename) {
  if (!OPENAI_API_KEY) {
    const error = new Error("OpenAI not configured for T12 extraction");
    error.status = 502;
    throw error;
  }

  const prompt = buildT12ExtractionPrompt(documentContent, filename);

  const url = `${OPENAI_BASE_URL.replace(/\/$/, "")}/chat/completions`;
  const payload = {
    model: OPENAI_MODEL,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "You are a real estate underwriting assistant that extracts structured financial data from operating statements. Return only valid JSON."
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
    const error = new Error(errorData?.error?.message ?? "T12 extraction failed");
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;

  if (!content) {
    const error = new Error("No content in T12 extraction response");
    error.status = 502;
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    const error = new Error("Invalid JSON in T12 extraction response");
    error.status = 502;
    throw error;
  }

  // Validate and normalize the response
  return normalizeT12Data(parsed);
}

/**
 * Normalize and validate T12 extraction data
 */
function normalizeT12Data(data) {
  const result = {
    period: {
      startDate: data.period?.startDate ?? null,
      endDate: data.period?.endDate ?? null,
      months: data.period?.months ?? 12
    },
    revenue: {
      grossPotentialRent: data.revenue?.grossPotentialRent ?? null,
      vacancyLoss: data.revenue?.vacancyLoss ?? null,
      concessions: data.revenue?.concessions ?? null,
      badDebt: data.revenue?.badDebt ?? null,
      otherIncome: data.revenue?.otherIncome ?? null,
      effectiveGrossIncome: data.revenue?.effectiveGrossIncome ?? null
    },
    expenses: {
      taxes: data.expenses?.taxes ?? null,
      insurance: data.expenses?.insurance ?? null,
      utilities: data.expenses?.utilities ?? null,
      repairsAndMaintenance: data.expenses?.repairsAndMaintenance ?? null,
      management: data.expenses?.management ?? null,
      payroll: data.expenses?.payroll ?? null,
      administrative: data.expenses?.administrative ?? null,
      marketing: data.expenses?.marketing ?? null,
      contractServices: data.expenses?.contractServices ?? null,
      reserves: data.expenses?.reserves ?? null,
      other: data.expenses?.other ?? null,
      totalExpenses: data.expenses?.totalExpenses ?? null
    },
    noi: data.noi ?? null,
    expenseRatio: data.expenseRatio ?? null,
    lineItems: []
  };

  // Calculate EGI if not provided
  if (!result.revenue.effectiveGrossIncome && result.revenue.grossPotentialRent) {
    const gpr = result.revenue.grossPotentialRent;
    const vacancyLoss = result.revenue.vacancyLoss ?? 0;
    const concessions = result.revenue.concessions ?? 0;
    const badDebt = result.revenue.badDebt ?? 0;
    const otherIncome = result.revenue.otherIncome ?? 0;
    result.revenue.effectiveGrossIncome = gpr - vacancyLoss - concessions - badDebt + otherIncome;
  }

  // Calculate total expenses if not provided
  if (!result.expenses.totalExpenses) {
    const expenseFields = ['taxes', 'insurance', 'utilities', 'repairsAndMaintenance',
      'management', 'payroll', 'administrative', 'marketing', 'contractServices',
      'reserves', 'other'];
    let total = 0;
    let hasAny = false;
    expenseFields.forEach(field => {
      if (result.expenses[field]) {
        total += result.expenses[field];
        hasAny = true;
      }
    });
    if (hasAny) {
      result.expenses.totalExpenses = total;
    }
  }

  // Calculate NOI if not provided
  if (!result.noi && result.revenue.effectiveGrossIncome && result.expenses.totalExpenses) {
    result.noi = result.revenue.effectiveGrossIncome - result.expenses.totalExpenses;
  }

  // Calculate expense ratio if not provided
  if (!result.expenseRatio && result.revenue.effectiveGrossIncome && result.expenses.totalExpenses) {
    result.expenseRatio = result.expenses.totalExpenses / result.revenue.effectiveGrossIncome;
  }

  // Normalize line items
  if (Array.isArray(data.lineItems)) {
    result.lineItems = data.lineItems.map(item => ({
      category: (item.category ?? 'EXPENSE').toUpperCase(),
      lineItem: item.lineItem ?? null,
      annualAmount: item.annualAmount ?? null,
      monthlyAmounts: Array.isArray(item.monthlyAmounts) ? item.monthlyAmounts : null
    }));
  }

  return result;
}

/**
 * Calculate confidence score for the extraction based on completeness
 */
export function calculateT12Confidence(data) {
  let score = 0;
  let total = 0;

  // Critical revenue fields
  const revenueFields = ['grossPotentialRent', 'effectiveGrossIncome'];
  revenueFields.forEach(field => {
    total += 2;
    if (data.revenue?.[field] !== null && data.revenue?.[field] !== undefined) {
      score += 2;
    }
  });

  // Critical expense fields
  const expenseFields = ['totalExpenses', 'taxes', 'insurance', 'management'];
  expenseFields.forEach(field => {
    total += 1;
    if (data.expenses?.[field] !== null && data.expenses?.[field] !== undefined) {
      score += 1;
    }
  });

  // NOI
  total += 2;
  if (data.noi !== null && data.noi !== undefined) {
    score += 2;
  }

  // Line items present (bonus)
  total += 1;
  if (data.lineItems?.length > 0) {
    score += 1;
  }

  return score / total;
}

/**
 * Map expense categories to standard underwriting fields
 */
export function mapT12ToUnderwritingModel(t12Data) {
  return {
    grossPotentialRent: t12Data.revenue?.grossPotentialRent ?? null,
    effectiveGrossIncome: t12Data.revenue?.effectiveGrossIncome ?? null,
    otherIncome: t12Data.revenue?.otherIncome ?? null,
    operatingExpenses: t12Data.expenses?.totalExpenses ?? null,
    taxes: t12Data.expenses?.taxes ?? null,
    insurance: t12Data.expenses?.insurance ?? null,
    management: t12Data.expenses?.management ?? null,
    reserves: t12Data.expenses?.reserves ?? null,
    netOperatingIncome: t12Data.noi ?? null
  };
}

export default {
  extractT12,
  calculateT12Confidence,
  mapT12ToUnderwritingModel,
  t12Schema
};
