/**
 * Excel Model Detector Service
 *
 * Detect the type of financial model (A.CRE All-in-One, A.CRE Office Dev, custom)
 * based on sheet names, cell patterns, and structure.
 */

/**
 * Known A.CRE model signatures
 */
const MODEL_SIGNATURES = {
  'ACRE_ALL_IN_ONE': {
    name: 'A.CRE All-in-One Model',
    shortName: 'Ai1',
    version: null, // Will be detected
    requiredSheets: ['Summary', 'Perm. Debt'],
    optionalSheets: ['ORI Settings', 'ORI RR', 'ORI OpSt', 'MF Settings', 'MF RR', 'MF OpSt', 'Property CF', 'Equity CF', 'S&U', 'Budget'],
    keyPatterns: [
      { sheet: 'Summary', patterns: [/purchase\s*price/i, /going[\s-]*in\s*cap/i, /levered\s*irr/i] },
      { sheet: 'Perm. Debt', patterns: [/loan\s*amount/i, /interest\s*rate/i, /amortization/i] }
    ],
    fieldMappings: {
      purchasePrice: { sheet: 'Summary', cellHint: 'C5-C10' },
      goingInCapRate: { sheet: 'Summary', cellHint: 'C15-C25' },
      irr: { sheet: 'Summary', cellHint: 'C20-C35' },
      equityMultiple: { sheet: 'Summary', cellHint: 'C20-C35' },
      loanAmount: { sheet: 'Perm. Debt', cellHint: 'C5-C15' },
      interestRate: { sheet: 'Perm. Debt', cellHint: 'C5-C15' }
    }
  },

  'ACRE_OFFICE_DEV': {
    name: 'A.CRE Office Development Model',
    shortName: 'Office Dev',
    version: null,
    requiredSheets: ['Underwriting', 'Rent Roll'],
    optionalSheets: ['Operating Statement', 'Development', 'S&U', 'Budget', 'Gantt', 'Debt Schedule'],
    keyPatterns: [
      { sheet: 'Underwriting', patterns: [/purchase\s*price/i, /development\s*cost/i] },
      { sheet: 'Rent Roll', patterns: [/tenant/i, /sf|square\s*feet/i, /rent/i] }
    ],
    fieldMappings: {
      purchasePrice: { sheet: 'Underwriting', cellHint: 'C5-C15' },
      grossPotentialRent: { sheet: 'Operating Statement', cellHint: 'B10-B20' }
    }
  },

  'ACRE_MULTIFAMILY': {
    name: 'A.CRE Multifamily Model',
    shortName: 'MF Model',
    version: null,
    requiredSheets: ['Summary', 'Rent Roll', 'Operating'],
    optionalSheets: ['Debt', 'Returns', 'Sensitivity'],
    keyPatterns: [
      { sheet: 'Rent Roll', patterns: [/unit/i, /rent/i, /vacancy/i] }
    ]
  },

  'GENERIC_CRE': {
    name: 'Generic CRE Model',
    shortName: 'Generic',
    version: null,
    requiredSheets: [],
    optionalSheets: [],
    keyPatterns: []
  }
};

/**
 * Detect the type of financial model
 * @param {Object} parsedExcel - Output from parseExcelFile
 * @returns {Object} Detection result with model type and confidence
 */
export function detectModelType(parsedExcel) {
  const sheetNames = parsedExcel.sheets.map(s => s.name.toLowerCase());

  const results = [];

  for (const [modelType, signature] of Object.entries(MODEL_SIGNATURES)) {
    if (modelType === 'GENERIC_CRE') continue; // Fallback

    const detection = evaluateSignature(parsedExcel, signature, sheetNames);
    if (detection.score > 0) {
      results.push({
        type: modelType,
        ...signature,
        ...detection
      });
    }
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  if (results.length > 0 && results[0].score >= 0.5) {
    return {
      detected: true,
      modelType: results[0].type,
      modelName: results[0].name,
      shortName: results[0].shortName,
      confidence: results[0].score,
      version: results[0].detectedVersion,
      fieldMappings: results[0].fieldMappings,
      matchedSheets: results[0].matchedSheets,
      matchedPatterns: results[0].matchedPatterns,
      alternatives: results.slice(1)
    };
  }

  // Fallback to generic
  return {
    detected: false,
    modelType: 'GENERIC_CRE',
    modelName: 'Generic CRE Model',
    shortName: 'Generic',
    confidence: 0.3,
    version: null,
    fieldMappings: {},
    matchedSheets: [],
    matchedPatterns: []
  };
}

/**
 * Evaluate how well a parsed Excel matches a model signature
 */
function evaluateSignature(parsedExcel, signature, sheetNamesLower) {
  let score = 0;
  const matchedSheets = [];
  const matchedPatterns = [];
  let detectedVersion = null;

  // Check required sheets
  const requiredSheets = signature.requiredSheets || [];
  let requiredMatched = 0;

  for (const reqSheet of requiredSheets) {
    if (sheetNamesLower.includes(reqSheet.toLowerCase())) {
      requiredMatched++;
      matchedSheets.push(reqSheet);
    }
  }

  if (requiredSheets.length > 0) {
    const requiredScore = requiredMatched / requiredSheets.length;
    score += requiredScore * 0.4; // 40% weight for required sheets
  }

  // Check optional sheets
  const optionalSheets = signature.optionalSheets || [];
  let optionalMatched = 0;

  for (const optSheet of optionalSheets) {
    if (sheetNamesLower.includes(optSheet.toLowerCase())) {
      optionalMatched++;
      matchedSheets.push(optSheet);
    }
  }

  if (optionalSheets.length > 0) {
    const optionalScore = optionalMatched / optionalSheets.length;
    score += optionalScore * 0.2; // 20% weight for optional sheets
  }

  // Check key patterns in cells
  const keyPatterns = signature.keyPatterns || [];

  for (const patternSpec of keyPatterns) {
    const sheetCells = parsedExcel.cells.filter(
      c => c.sheetName.toLowerCase() === patternSpec.sheet.toLowerCase()
    );

    let patternsMatched = 0;
    for (const pattern of patternSpec.patterns) {
      for (const cell of sheetCells) {
        const textToCheck = cell.labelText || cell.rawValue || '';
        if (pattern.test(textToCheck)) {
          patternsMatched++;
          matchedPatterns.push({
            sheet: patternSpec.sheet,
            pattern: pattern.toString(),
            cell: cell.cellRef,
            value: textToCheck
          });
          break;
        }
      }
    }

    if (patternSpec.patterns.length > 0) {
      score += (patternsMatched / patternSpec.patterns.length) * 0.4 / keyPatterns.length;
    }
  }

  // Try to detect version from filename or cells
  const versionPattern = /v?(\d+\.\d+)/i;
  const filenameMatch = parsedExcel.filename?.match(versionPattern);
  if (filenameMatch) {
    detectedVersion = filenameMatch[1];
  }

  return {
    score,
    matchedSheets,
    matchedPatterns,
    detectedVersion
  };
}

/**
 * Get enhanced field mappings for a detected model type
 * @param {Object} parsedExcel - Parsed Excel data
 * @param {string} modelType - Detected model type
 * @returns {Object} Enhanced mappings with cell locations
 */
export function getEnhancedMappings(parsedExcel, modelType) {
  const signature = MODEL_SIGNATURES[modelType];
  if (!signature || !signature.fieldMappings) {
    return {};
  }

  const enhancedMappings = {};

  for (const [field, hint] of Object.entries(signature.fieldMappings)) {
    // Find cells in the hinted area
    const sheetCells = parsedExcel.cells.filter(
      c => c.sheetName === hint.sheet
    );

    // Try to find the best match using our existing mapper patterns
    // This is a placeholder - will be enhanced with specific cell targeting
    const candidates = sheetCells.filter(c =>
      ['NUMBER', 'FORMULA', 'CURRENCY', 'PERCENTAGE'].includes(c.dataType) &&
      c.labelText
    );

    if (candidates.length > 0) {
      enhancedMappings[field] = {
        ...hint,
        candidates: candidates.slice(0, 5).map(c => ({
          cell: c.cellRef,
          value: c.computedValue,
          label: c.labelText
        }))
      };
    }
  }

  return enhancedMappings;
}

/**
 * Get model-specific export template configuration
 * @param {string} modelType - Target model type
 * @returns {Object} Export template configuration
 */
export function getExportTemplate(modelType) {
  const templates = {
    'ACRE_ALL_IN_ONE': {
      sheets: [
        { name: 'Summary', sections: ['property', 'returns', 'assumptions'] },
        { name: 'Assumptions', sections: ['revenue', 'expenses', 'debt'] },
        { name: 'Cash Flows', sections: ['projections'] },
        { name: 'Returns', sections: ['irr_analysis', 'waterfall'] },
        { name: 'Sensitivity', sections: ['matrix'] }
      ],
      styling: {
        headerColor: '1F4E79',
        headerFont: 'white',
        currencyFormat: '$#,##0',
        percentFormat: '0.00%'
      }
    },
    'GENERIC_CRE': {
      sheets: [
        { name: 'Summary', sections: ['all'] },
        { name: 'Cash Flows', sections: ['projections'] }
      ],
      styling: {
        headerColor: '4472C4',
        headerFont: 'white',
        currencyFormat: '$#,##0',
        percentFormat: '0.00%'
      }
    }
  };

  return templates[modelType] || templates['GENERIC_CRE'];
}

export default {
  detectModelType,
  getEnhancedMappings,
  getExportTemplate,
  MODEL_SIGNATURES
};
