/**
 * Excel Mapper Service
 *
 * Auto-map Excel cells to underwriting model fields based on
 * label patterns and cell positions.
 */

/**
 * Pattern definitions for auto-mapping Excel labels to model fields
 * Each field has an array of regex patterns to match against cell labels
 */
const FIELD_PATTERNS = {
  // Revenue fields
  grossPotentialRent: [
    /gross\s*potential\s*rent/i,
    /^gpr$/i,
    /scheduled\s*rent/i,
    /total\s*rent\s*revenue/i,
    /gross\s*rent/i,
    /potential\s*rent/i
  ],
  vacancyRate: [
    /vacancy\s*%?/i,
    /vacancy\s*rate/i,
    /vac\s*%/i,
    /physical\s*vacancy/i,
    /economic\s*vacancy/i
  ],
  effectiveGrossIncome: [
    /effective\s*gross\s*income/i,
    /^egi$/i,
    /net\s*rental\s*income/i
  ],
  otherIncome: [
    /other\s*income/i,
    /ancillary\s*income/i,
    /misc\s*income/i,
    /additional\s*income/i,
    /laundry/i,
    /parking\s*income/i
  ],

  // Expense fields
  operatingExpenses: [
    /total\s*operating\s*expense/i,
    /total\s*expense/i,
    /^opex$/i,
    /operating\s*costs/i
  ],
  taxes: [
    /real\s*estate\s*tax/i,
    /property\s*tax/i,
    /^taxes$/i,
    /^tax$/i,
    /re\s*tax/i
  ],
  insurance: [
    /^insurance$/i,
    /property\s*insurance/i,
    /liability\s*insurance/i
  ],
  management: [
    /management\s*fee/i,
    /property\s*management/i,
    /^management$/i,
    /mgmt\s*fee/i
  ],
  reserves: [
    /replacement\s*reserve/i,
    /^reserves?$/i,
    /capex\s*reserve/i,
    /capital\s*reserve/i
  ],

  // NOI
  netOperatingIncome: [
    /net\s*operating\s*income/i,
    /^noi$/i
  ],

  // Debt fields
  loanAmount: [
    /loan\s*amount/i,
    /^loan$/i,
    /mortgage\s*amount/i,
    /senior\s*debt/i,
    /first\s*mortgage/i,
    /principal\s*amount/i
  ],
  interestRate: [
    /interest\s*rate/i,
    /^rate$/i,
    /coupon\s*rate/i,
    /note\s*rate/i,
    /fixed\s*rate/i
  ],
  amortization: [
    /amortization/i,
    /^amort$/i,
    /amort\s*period/i,
    /amortization\s*period/i
  ],
  loanTerm: [
    /loan\s*term/i,
    /^term$/i,
    /maturity/i,
    /loan\s*maturity/i
  ],
  annualDebtService: [
    /annual\s*debt\s*service/i,
    /^ads$/i,
    /debt\s*service/i,
    /total\s*debt\s*service/i
  ],

  // Return metrics
  goingInCapRate: [
    /going[\s-]*in\s*cap/i,
    /entry\s*cap/i,
    /purchase\s*cap/i,
    /acquisition\s*cap/i,
    /^cap\s*rate$/i
  ],
  exitCapRate: [
    /exit\s*cap/i,
    /terminal\s*cap/i,
    /sale\s*cap/i,
    /disposition\s*cap/i,
    /reversion\s*cap/i
  ],
  cashOnCash: [
    /cash[\s-]*on[\s-]*cash/i,
    /^coc$/i,
    /cash\s*return/i
  ],
  dscr: [
    /^dscr$/i,
    /debt\s*service\s*coverage/i,
    /coverage\s*ratio/i
  ],

  // Assumptions
  holdPeriod: [
    /hold\s*period/i,
    /holding\s*period/i,
    /investment\s*period/i,
    /^hold$/i
  ],
  rentGrowth: [
    /rent\s*growth/i,
    /revenue\s*growth/i,
    /income\s*growth/i,
    /annual\s*rent\s*growth/i
  ],
  expenseGrowth: [
    /expense\s*growth/i,
    /cost\s*growth/i,
    /expense\s*inflation/i
  ],

  // Returns
  irr: [
    /^irr$/i,
    /internal\s*rate\s*of\s*return/i,
    /levered\s*irr/i,
    /project\s*irr/i
  ],
  equityMultiple: [
    /equity\s*multiple/i,
    /^em$/i,
    /^multiple$/i,
    /moic/i,
    /return\s*multiple/i
  ]
};

/**
 * Field metadata for display and validation
 */
const FIELD_METADATA = {
  grossPotentialRent: { label: 'Gross Potential Rent', type: 'currency', category: 'revenue' },
  vacancyRate: { label: 'Vacancy Rate', type: 'percentage', category: 'revenue' },
  effectiveGrossIncome: { label: 'Effective Gross Income', type: 'currency', category: 'revenue' },
  otherIncome: { label: 'Other Income', type: 'currency', category: 'revenue' },
  operatingExpenses: { label: 'Operating Expenses', type: 'currency', category: 'expenses' },
  taxes: { label: 'Taxes', type: 'currency', category: 'expenses' },
  insurance: { label: 'Insurance', type: 'currency', category: 'expenses' },
  management: { label: 'Management', type: 'currency', category: 'expenses' },
  reserves: { label: 'Reserves', type: 'currency', category: 'expenses' },
  netOperatingIncome: { label: 'Net Operating Income', type: 'currency', category: 'noi' },
  loanAmount: { label: 'Loan Amount', type: 'currency', category: 'debt' },
  interestRate: { label: 'Interest Rate', type: 'percentage', category: 'debt' },
  amortization: { label: 'Amortization', type: 'years', category: 'debt' },
  loanTerm: { label: 'Loan Term', type: 'years', category: 'debt' },
  annualDebtService: { label: 'Annual Debt Service', type: 'currency', category: 'debt' },
  goingInCapRate: { label: 'Going-In Cap Rate', type: 'percentage', category: 'returns' },
  exitCapRate: { label: 'Exit Cap Rate', type: 'percentage', category: 'assumptions' },
  cashOnCash: { label: 'Cash-on-Cash', type: 'percentage', category: 'returns' },
  dscr: { label: 'DSCR', type: 'ratio', category: 'returns' },
  holdPeriod: { label: 'Hold Period', type: 'years', category: 'assumptions' },
  rentGrowth: { label: 'Rent Growth', type: 'percentage', category: 'assumptions' },
  expenseGrowth: { label: 'Expense Growth', type: 'percentage', category: 'assumptions' },
  irr: { label: 'IRR', type: 'percentage', category: 'returns' },
  equityMultiple: { label: 'Equity Multiple', type: 'multiple', category: 'returns' }
};

/**
 * Auto-map parsed Excel cells to underwriting model fields
 * @param {Object} parsedExcel - Output from parseExcelFile
 * @returns {Object} { mappings, unmapped, confidence }
 */
export function autoMapExcelToModel(parsedExcel) {
  const mappings = {};
  const unmapped = [];
  const allFields = Object.keys(FIELD_PATTERNS);
  const mappedFields = new Set();

  // Process cells with numeric values and labels
  for (const cell of parsedExcel.cells) {
    // Skip non-numeric cells
    if (!['NUMBER', 'FORMULA', 'CURRENCY', 'PERCENTAGE'].includes(cell.dataType)) {
      continue;
    }

    // Skip cells without labels
    if (!cell.labelText) {
      continue;
    }

    const label = cell.labelText.trim();

    // Try to match against patterns
    for (const [field, patterns] of Object.entries(FIELD_PATTERNS)) {
      // Skip already mapped fields (take first match)
      if (mappedFields.has(field)) {
        continue;
      }

      if (patterns.some(p => p.test(label))) {
        let value = cell.computedValue;

        // Normalize percentage values
        if (cell.dataType === 'PERCENTAGE' || FIELD_METADATA[field]?.type === 'percentage') {
          if (typeof value === 'string' && value.endsWith('%')) {
            value = parseFloat(value) / 100;
          } else if (typeof value === 'number' && value > 1) {
            // If it looks like a whole percentage (e.g., 5.5 for 5.5%)
            value = value / 100;
          }
        }

        mappings[field] = {
          sheet: cell.sheetName,
          cell: cell.cellRef,
          row: cell.row,
          col: cell.col,
          value: value,
          formula: cell.formula,
          label: label,
          confidence: calculateMappingConfidence(field, label, cell),
          metadata: FIELD_METADATA[field]
        };

        mappedFields.add(field);
        break;
      }
    }
  }

  // Track unmapped fields
  for (const field of allFields) {
    if (!mappedFields.has(field)) {
      unmapped.push({
        field,
        metadata: FIELD_METADATA[field]
      });
    }
  }

  // Calculate overall confidence
  const mappedCount = Object.keys(mappings).length;
  const totalFields = allFields.length;
  const overallConfidence = mappedCount / totalFields;

  return {
    mappings,
    unmapped,
    stats: {
      mapped: mappedCount,
      unmapped: unmapped.length,
      total: totalFields,
      confidence: overallConfidence
    }
  };
}

/**
 * Calculate confidence score for a mapping
 */
function calculateMappingConfidence(field, label, cell) {
  let confidence = 0.7; // Base confidence

  // Exact match patterns get higher confidence
  const exactPatterns = {
    'grossPotentialRent': /^gross\s*potential\s*rent$/i,
    'netOperatingIncome': /^(net\s*operating\s*income|noi)$/i,
    'loanAmount': /^loan\s*amount$/i,
    'interestRate': /^interest\s*rate$/i,
    'irr': /^irr$/i,
    'dscr': /^dscr$/i
  };

  if (exactPatterns[field] && exactPatterns[field].test(label)) {
    confidence = 0.95;
  }

  // Formula cells are more likely to be calculated results
  if (cell.formula && ['netOperatingIncome', 'dscr', 'irr', 'cashOnCash'].includes(field)) {
    confidence = Math.min(confidence + 0.1, 1.0);
  }

  // Value range validation
  const value = cell.computedValue;
  if (typeof value === 'number') {
    // Cap rates should be between 0 and 0.2 (0-20%)
    if (field.includes('Cap') && (value < 0 || value > 0.2)) {
      confidence -= 0.2;
    }

    // DSCR should be between 0.5 and 5
    if (field === 'dscr' && (value < 0.5 || value > 5)) {
      confidence -= 0.2;
    }

    // IRR should be between -0.5 and 1 (-50% to 100%)
    if (field === 'irr' && (value < -0.5 || value > 1)) {
      confidence -= 0.2;
    }
  }

  return Math.max(confidence, 0.1);
}

/**
 * Manually set a mapping for a field
 */
export function setManualMapping(mappings, field, cell, parsedExcel) {
  // Find the cell in parsed data
  const targetCell = parsedExcel.cells.find(
    c => c.sheetName === cell.sheetName && c.cellRef === cell.cellRef
  );

  if (!targetCell) {
    throw new Error(`Cell ${cell.cellRef} not found in sheet ${cell.sheetName}`);
  }

  mappings[field] = {
    sheet: targetCell.sheetName,
    cell: targetCell.cellRef,
    row: targetCell.row,
    col: targetCell.col,
    value: targetCell.computedValue,
    formula: targetCell.formula,
    label: targetCell.labelText || 'Manual mapping',
    confidence: 1.0, // Manual mappings are 100% confident
    metadata: FIELD_METADATA[field],
    manual: true
  };

  return mappings;
}

/**
 * Get field metadata
 */
export function getFieldMetadata(field) {
  return FIELD_METADATA[field] || null;
}

/**
 * Get all mappable fields
 */
export function getAllMappableFields() {
  return Object.entries(FIELD_METADATA).map(([field, meta]) => ({
    field,
    ...meta
  }));
}

/**
 * Validate a set of mappings for completeness
 */
export function validateMappings(mappings) {
  const required = ['grossPotentialRent', 'netOperatingIncome', 'loanAmount'];
  const recommended = ['vacancyRate', 'interestRate', 'exitCapRate'];

  const missing = {
    required: required.filter(f => !mappings[f]),
    recommended: recommended.filter(f => !mappings[f])
  };

  const isValid = missing.required.length === 0;

  return {
    isValid,
    missing,
    warnings: missing.recommended.map(f =>
      `${FIELD_METADATA[f]?.label || f} not mapped - using defaults`
    )
  };
}

export default {
  autoMapExcelToModel,
  setManualMapping,
  getFieldMetadata,
  getAllMappableFields,
  validateMappings,
  FIELD_PATTERNS,
  FIELD_METADATA
};
