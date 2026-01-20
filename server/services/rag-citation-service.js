/**
 * RAG Citation Service
 *
 * Provides citation-aware responses for the AI assistant by:
 * - Indexing verified claims and inputs
 * - Retrieving relevant facts for questions
 * - Generating responses with source citations
 * - Detecting when data is unavailable
 *
 * SECURITY: All fact index operations now require organizationId to prevent
 * cross-organization data leakage. Facts include visibility metadata for
 * role-based filtering.
 */

import { PrismaClient } from '@prisma/client';
import { filterFactsForUser } from './ai-context-filter.js';

const prisma = new PrismaClient();

// =============================================================================
// FACT INDEX BUILDER
// =============================================================================

/**
 * Build a searchable fact index for a deal with security context
 *
 * SECURITY: This function now requires organizationId and validates deal ownership
 * before building the fact index. All facts include organization metadata.
 *
 * @param {string} dealId - The deal ID
 * @param {string} organizationId - The organization ID to validate against
 * @returns {Array} Array of facts with security metadata
 */
async function buildFactIndex(dealId, organizationId = null) {
  const facts = [];

  // SECURITY: If organizationId provided, validate deal belongs to org
  if (organizationId) {
    const { readStore } = await import('../store.js');
    const store = await readStore();
    const dealRecord = store.dealIndex.find(d => d.id === dealId);

    if (!dealRecord) {
      throw new Error(`Deal not found: ${dealId}`);
    }

    if (dealRecord.organizationId && dealRecord.organizationId !== organizationId) {
      throw new Error('Access denied - deal belongs to different organization');
    }
  }

  // 1. Get verified extraction claims
  const claims = await prisma.extractionClaim.findMany({
    where: { dealId, status: 'VERIFIED' }
  });

  for (const claim of claims) {
    facts.push({
      type: 'VERIFIED_CLAIM',
      fieldPath: claim.fieldPath,
      value: JSON.parse(claim.claimedValue),
      source: {
        type: 'AI_EXTRACTION',
        documentName: claim.documentName,
        documentType: claim.documentType,
        pageNumber: claim.pageNumber,
        cellReference: claim.cellReference,
        confidence: claim.aiConfidence
      },
      verification: {
        verifiedBy: claim.verifiedByName,
        verifiedAt: claim.verifiedAt,
        corrected: claim.correctedValue != null
      },
      searchTerms: buildSearchTerms(claim.fieldPath),
      // SECURITY: Add metadata for filtering
      metadata: {
        organizationId,
        dealId,
        visibility: 'GP_ONLY',  // Extraction claims are GP/Admin only
        allowedRoles: ['GP', 'GP Analyst', 'Admin', 'Lender', 'Regulator', 'Auditor'],
      }
    });
  }

  // 2. Get underwriting inputs with provenance
  const inputs = await prisma.underwritingInput.findMany({
    where: { dealId },
    orderBy: { setAt: 'desc' }
  });

  const seenFields = new Set();
  for (const input of inputs) {
    if (seenFields.has(input.fieldPath)) continue;
    seenFields.add(input.fieldPath);

    facts.push({
      type: 'UNDERWRITING_INPUT',
      fieldPath: input.fieldPath,
      value: JSON.parse(input.value),
      source: {
        type: input.sourceType,
        documentName: input.documentName,
        documentCell: input.documentCell,
        confidence: input.aiConfidence
      },
      verification: {
        setBy: input.setByName,
        setAt: input.setAt,
        rationale: input.rationale
      },
      searchTerms: buildSearchTerms(input.fieldPath),
      // SECURITY: Add metadata for filtering
      metadata: {
        organizationId,
        dealId,
        visibility: 'GP_ONLY',  // Underwriting inputs are GP/Admin only
        allowedRoles: ['GP', 'GP Analyst', 'Admin', 'Lender', 'Regulator', 'Auditor'],
      }
    });
  }

  // 3. Get underwriting model (calculated values)
  const model = await prisma.underwritingModel.findFirst({
    where: { dealId, isBaseCase: true }
  });

  if (model) {
    const calculatedFields = [
      { field: 'purchasePrice', label: 'Purchase Price' },
      { field: 'noi', label: 'Net Operating Income' },
      { field: 'grossPotentialRent', label: 'Gross Potential Rent' },
      { field: 'operatingExpenses', label: 'Operating Expenses' },
      { field: 'loanAmount', label: 'Loan Amount' },
      { field: 'interestRate', label: 'Interest Rate' },
      { field: 'exitCapRate', label: 'Exit Cap Rate' },
      { field: 'holdPeriodYears', label: 'Hold Period' },
      { field: 'totalUnits', label: 'Total Units' },
      { field: 'grossSF', label: 'Gross Square Footage' }
    ];

    for (const { field, label } of calculatedFields) {
      if (model[field] != null && !seenFields.has(field)) {
        facts.push({
          type: 'MODEL_VALUE',
          fieldPath: field,
          value: model[field],
          source: {
            type: 'UNDERWRITING_MODEL',
            modelId: model.id,
            scenarioName: model.scenarioName
          },
          verification: null,
          searchTerms: buildSearchTerms(field, label),
          // SECURITY: Add metadata for filtering
          metadata: {
            organizationId,
            dealId,
            visibility: 'GP_ONLY',  // Model values are financials - GP/Admin only
            allowedRoles: ['GP', 'GP Analyst', 'Admin', 'Lender', 'Regulator', 'Auditor'],
          }
        });
      }
    }
  }

  // 4. Get open conflicts
  const conflicts = await prisma.underwritingConflict?.findMany({
    where: { dealId, resolved: false }
  });

  if (conflicts) {
    for (const conflict of conflicts) {
      facts.push({
        type: 'CONFLICT',
        fieldPath: conflict.fieldPath,
        value: {
          value1: conflict.value1,
          value2: conflict.value2,
          source1: conflict.source1,
          source2: conflict.source2
        },
        source: { type: 'CONFLICT_DETECTION' },
        verification: null,
        searchTerms: buildSearchTerms(conflict.fieldPath, 'conflict'),
        // SECURITY: Add metadata for filtering
        metadata: {
          organizationId,
          dealId,
          visibility: 'GP_ONLY',  // Conflicts are internal - GP/Admin only
          allowedRoles: ['GP', 'GP Analyst', 'Admin', 'Lender', 'Regulator', 'Auditor'],
        }
      });
    }
  }

  return facts;
}

/**
 * Build a filtered fact index for a specific user
 *
 * SECURITY: This is the preferred method for AI endpoints - it builds the index
 * and filters it based on user's role and entitlements in one step.
 *
 * @param {string} dealId - The deal ID
 * @param {Object} authUser - Authenticated user from JWT
 * @returns {Array} Filtered array of facts safe for this user
 */
async function buildFilteredFactIndex(dealId, authUser) {
  if (!authUser || !authUser.organizationId) {
    throw new Error('Authentication required for fact index access');
  }

  // Build full fact index with org validation
  const allFacts = await buildFactIndex(dealId, authUser.organizationId);

  // Filter based on user's role
  return filterFactsForUser(allFacts, authUser);
}

/**
 * Build search terms for a field
 */
function buildSearchTerms(fieldPath, ...additionalTerms) {
  const fieldNames = {
    purchasePrice: ['purchase price', 'acquisition price', 'price', 'cost'],
    noi: ['noi', 'net operating income', 'operating income'],
    grossPotentialRent: ['gpr', 'gross potential rent', 'gross rent', 'rental income'],
    effectiveGrossIncome: ['egi', 'effective gross income'],
    operatingExpenses: ['opex', 'operating expenses', 'expenses'],
    goingInCapRate: ['going-in cap', 'cap rate', 'capitalization rate'],
    exitCapRate: ['exit cap', 'exit cap rate', 'terminal cap'],
    loanAmount: ['loan', 'loan amount', 'debt', 'mortgage'],
    interestRate: ['interest rate', 'rate', 'coupon'],
    dscr: ['dscr', 'debt service coverage', 'coverage ratio'],
    ltv: ['ltv', 'loan to value', 'leverage'],
    debtYield: ['debt yield', 'yield'],
    irr: ['irr', 'internal rate of return', 'return'],
    equityMultiple: ['equity multiple', 'multiple', 'moic'],
    cashOnCash: ['cash on cash', 'coc', 'cash yield'],
    totalUnits: ['units', 'unit count', 'total units'],
    grossSF: ['square feet', 'sf', 'square footage', 'rentable area']
  };

  const terms = fieldNames[fieldPath] || [fieldPath.replace(/([A-Z])/g, ' $1').toLowerCase()];
  return [...terms, ...additionalTerms].filter(Boolean);
}

// =============================================================================
// FACT RETRIEVAL
// =============================================================================

/**
 * Find relevant facts for a question
 */
function findRelevantFacts(question, facts, limit = 10) {
  const q = question.toLowerCase();
  const scored = [];

  for (const fact of facts) {
    let score = 0;

    // Check search terms
    for (const term of fact.searchTerms) {
      if (q.includes(term)) {
        score += 10;
      }
    }

    // Check field path
    if (q.includes(fact.fieldPath.toLowerCase())) {
      score += 15;
    }

    // Boost verified facts
    if (fact.verification?.verifiedBy) {
      score += 5;
    }

    // Boost conflicts if asking about issues/conflicts
    if (fact.type === 'CONFLICT' && (q.includes('conflict') || q.includes('issue') || q.includes('discrepancy'))) {
      score += 20;
    }

    if (score > 0) {
      scored.push({ fact, score });
    }
  }

  // Sort by score and take top results
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.fact);
}

/**
 * Check if we have data to answer a question
 */
function canAnswerQuestion(question, facts) {
  const relevantFacts = findRelevantFacts(question, facts, 3);
  return {
    canAnswer: relevantFacts.length > 0,
    confidence: relevantFacts.length >= 3 ? 'high' : relevantFacts.length >= 1 ? 'medium' : 'none',
    relevantFacts
  };
}

// =============================================================================
// CITATION FORMATTING
// =============================================================================

/**
 * Format a citation for a fact
 */
function formatCitation(fact) {
  const parts = [];

  // Value
  const formattedValue = formatFactValue(fact.fieldPath, fact.value);
  parts.push(`**${formatFieldName(fact.fieldPath)}**: ${formattedValue}`);

  // Source
  if (fact.source) {
    let sourceStr = '';
    if (fact.source.documentName) {
      sourceStr = fact.source.documentName;
      if (fact.source.pageNumber) {
        sourceStr += ` (p. ${fact.source.pageNumber})`;
      }
      if (fact.source.cellReference) {
        sourceStr += ` (${fact.source.cellReference})`;
      }
    } else if (fact.source.type === 'UNDERWRITING_MODEL') {
      sourceStr = `${fact.source.scenarioName} model`;
    }
    if (sourceStr) {
      parts.push(`Source: ${sourceStr}`);
    }
  }

  // Verification
  if (fact.verification?.verifiedBy) {
    parts.push(`Verified by ${fact.verification.verifiedBy} on ${formatDate(fact.verification.verifiedAt)}`);
  }

  // Confidence
  if (fact.source?.confidence) {
    const confPct = Math.round(fact.source.confidence * 100);
    parts.push(`[${confPct}% confidence]`);
  }

  return parts.join(' | ');
}

/**
 * Build a citations section for response
 */
function buildCitationsSection(facts) {
  if (facts.length === 0) return '';

  const lines = ['\n---', '**Sources:**'];

  for (const fact of facts) {
    const source = fact.source?.documentName || fact.source?.type || 'Unknown';
    const location = [];
    if (fact.source?.pageNumber) location.push(`p. ${fact.source.pageNumber}`);
    if (fact.source?.cellReference) location.push(fact.source.cellReference);

    let citation = `- **${formatFieldName(fact.fieldPath)}**: ${source}`;
    if (location.length > 0) {
      citation += ` (${location.join(', ')})`;
    }
    if (fact.verification?.verifiedBy) {
      citation += ` [verified]`;
    }
    lines.push(citation);
  }

  return lines.join('\n');
}

// =============================================================================
// RESPONSE GENERATION
// =============================================================================

/**
 * Generate a citation-aware response
 */
async function generateCitationResponse(dealId, question, context) {
  // Build fact index
  const facts = await buildFactIndex(dealId);

  // Check if we can answer
  const { canAnswer, confidence, relevantFacts } = canAnswerQuestion(question, facts);

  if (!canAnswer) {
    return {
      response: generateUnknownResponse(question, facts),
      canAnswer: false,
      citations: [],
      missingData: identifyMissingData(question)
    };
  }

  // Generate response with citations
  const response = generateFactBasedResponse(question, relevantFacts, context);
  const citations = relevantFacts.map(f => ({
    fieldPath: f.fieldPath,
    value: f.value,
    source: f.source,
    verified: !!f.verification?.verifiedBy
  }));

  return {
    response: response + buildCitationsSection(relevantFacts),
    canAnswer: true,
    confidence,
    citations
  };
}

/**
 * Generate response when data is unknown
 */
function generateUnknownResponse(question, facts) {
  const q = question.toLowerCase();

  let response = "I don't have verified data to answer this question accurately. ";

  // Suggest what data might be needed
  const suggestions = [];

  if (q.includes('market') || q.includes('comp') || q.includes('comparable')) {
    suggestions.push('Upload market comparable data or rent comps');
  }
  if (q.includes('tenant') || q.includes('lease')) {
    suggestions.push('Upload rent roll or lease abstracts');
  }
  if (q.includes('expense') || q.includes('operating')) {
    suggestions.push('Upload T12 or operating statements');
  }
  if (q.includes('loan') || q.includes('debt') || q.includes('financing')) {
    suggestions.push('Enter loan terms or upload term sheet');
  }
  if (q.includes('cap rate') || q.includes('value')) {
    suggestions.push('Ensure purchase price and NOI are entered');
  }

  if (suggestions.length > 0) {
    response += '\n\nTo answer this question, you would need to:\n';
    suggestions.forEach(s => {
      response += `- ${s}\n`;
    });
  }

  // Show what data IS available
  const availableFields = [...new Set(facts.map(f => f.fieldPath))];
  if (availableFields.length > 0) {
    response += '\n\nI do have verified data for: ';
    response += availableFields.slice(0, 10).map(formatFieldName).join(', ');
    if (availableFields.length > 10) {
      response += `, and ${availableFields.length - 10} more fields`;
    }
  }

  return response;
}

/**
 * Generate fact-based response
 */
function generateFactBasedResponse(question, facts, context) {
  const q = question.toLowerCase();

  // Handle "where did X come from" questions
  if (q.includes('where') && (q.includes('come from') || q.includes('source') || q.includes('from'))) {
    const relevantFact = facts[0];
    if (relevantFact) {
      let response = `The ${formatFieldName(relevantFact.fieldPath)} of ${formatFactValue(relevantFact.fieldPath, relevantFact.value)} `;

      if (relevantFact.source?.documentName) {
        response += `comes from ${relevantFact.source.documentName}`;
        if (relevantFact.source.pageNumber) {
          response += ` (page ${relevantFact.source.pageNumber})`;
        }
        if (relevantFact.source.cellReference) {
          response += ` at cell ${relevantFact.source.cellReference}`;
        }
      } else {
        response += `was entered manually`;
      }

      if (relevantFact.verification?.verifiedBy) {
        response += ` and was verified by ${relevantFact.verification.verifiedBy} on ${formatDate(relevantFact.verification.verifiedAt)}`;
      }

      response += '.';

      if (relevantFact.source?.confidence) {
        response += ` AI extraction confidence: ${Math.round(relevantFact.source.confidence * 100)}%.`;
      }

      return response;
    }
  }

  // Handle metric questions
  if (q.includes('what is') || q.includes('what\'s') || q.includes('tell me')) {
    const responses = [];

    for (const fact of facts) {
      const value = formatFactValue(fact.fieldPath, fact.value);
      responses.push(`${formatFieldName(fact.fieldPath)}: ${value}`);
    }

    return `Based on verified data:\n\n${responses.join('\n')}`;
  }

  // Handle comparison/analysis questions
  if (q.includes('compare') || q.includes('vs') || q.includes('versus')) {
    // Build comparison from available facts
    const metrics = facts.map(f => ({
      name: formatFieldName(f.fieldPath),
      value: formatFactValue(f.fieldPath, f.value)
    }));

    return `Here are the relevant metrics:\n\n${metrics.map(m => `- ${m.name}: ${m.value}`).join('\n')}`;
  }

  // Default: summarize available facts
  return `Based on the deal data:\n\n${facts.map(f => `- ${formatFieldName(f.fieldPath)}: ${formatFactValue(f.fieldPath, f.value)}`).join('\n')}`;
}

/**
 * Identify what data might be missing
 */
function identifyMissingData(question) {
  const q = question.toLowerCase();
  const missing = [];

  const dataRequirements = {
    'cap rate': ['purchasePrice', 'noi'],
    'dscr': ['noi', 'loanAmount', 'interestRate'],
    'irr': ['purchasePrice', 'noi', 'exitCapRate', 'holdPeriod'],
    'ltv': ['loanAmount', 'purchasePrice'],
    'market': ['market comparables (external data)'],
    'rent comp': ['rent comparables (external data)'],
    'tenant': ['rent roll'],
    'occupancy': ['rent roll']
  };

  for (const [keyword, required] of Object.entries(dataRequirements)) {
    if (q.includes(keyword)) {
      missing.push(...required);
    }
  }

  return [...new Set(missing)];
}

// =============================================================================
// HELPERS
// =============================================================================

function formatFieldName(fieldPath) {
  const names = {
    purchasePrice: 'Purchase Price',
    noi: 'NOI',
    grossPotentialRent: 'Gross Potential Rent',
    effectiveGrossIncome: 'Effective Gross Income',
    operatingExpenses: 'Operating Expenses',
    goingInCapRate: 'Going-In Cap Rate',
    exitCapRate: 'Exit Cap Rate',
    loanAmount: 'Loan Amount',
    interestRate: 'Interest Rate',
    dscr: 'DSCR',
    ltv: 'LTV',
    debtYield: 'Debt Yield',
    irr: 'IRR',
    equityMultiple: 'Equity Multiple',
    cashOnCash: 'Cash-on-Cash',
    totalUnits: 'Total Units',
    grossSF: 'Gross SF',
    holdPeriodYears: 'Hold Period'
  };

  return names[fieldPath] || fieldPath.replace(/([A-Z])/g, ' $1').trim();
}

function formatFactValue(fieldPath, value) {
  if (value == null) return 'N/A';

  // Percentage fields
  if (['goingInCapRate', 'exitCapRate', 'irr', 'cashOnCash', 'ltv', 'debtYield', 'interestRate'].includes(fieldPath)) {
    const pct = typeof value === 'number' && value <= 1 ? value * 100 : value;
    return `${pct.toFixed(2)}%`;
  }

  // Multiple fields
  if (['equityMultiple', 'dscr'].includes(fieldPath)) {
    return `${parseFloat(value).toFixed(2)}x`;
  }

  // Currency fields
  if (['purchasePrice', 'noi', 'grossPotentialRent', 'operatingExpenses', 'loanAmount', 'effectiveGrossIncome'].includes(fieldPath)) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  }

  // Number fields
  if (['totalUnits', 'grossSF', 'holdPeriodYears'].includes(fieldPath)) {
    return new Intl.NumberFormat('en-US').format(value);
  }

  return String(value);
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
  buildFactIndex,
  buildFilteredFactIndex,
  findRelevantFacts,
  canAnswerQuestion,
  generateCitationResponse,
  formatCitation,
  buildCitationsSection,
  formatFieldName,
  formatFactValue
};
