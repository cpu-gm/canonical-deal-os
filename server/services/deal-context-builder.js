/**
 * Deal Context Builder Service
 *
 * Builds comprehensive context for AI-powered deal analysis.
 * Gathers all relevant data from extractions, underwriting model,
 * scenarios, conflicts, and sector benchmarks to enable
 * context-aware AI conversations and insights.
 *
 * SECURITY: This module now supports filtered context building via
 * buildFilteredDealContext() which applies role-based access controls
 * before returning context. All AI endpoints should use the filtered version.
 */

import { getPrisma } from '../db.js';
import { PROPERTY_SECTORS, detectSector } from './sector-config.js';
import { getConflictSummary } from './conflict-detector.js';
import { kernelFetchJson } from '../kernel.js';
import { filterContextForUser } from './ai-context-filter.js';

/**
 * Build full deal context for AI interactions
 * @param {string} dealId - The deal ID
 * @returns {Object} Complete context object for AI
 */
export async function buildDealContext(dealId) {
  const prisma = getPrisma();

  // Fetch all related data in parallel
  const [
    deal,
    model,
    extractions,
    conflicts,
    scenarios,
    inputs,
    artifacts
  ] = await Promise.all([
    fetchDeal(dealId),
    prisma.underwritingModel?.findUnique({ where: { dealId } }),
    prisma.documentExtraction?.findMany({ where: { dealId } }) || [],
    prisma.underwritingConflict?.findMany({ where: { dealId } }) || [],
    prisma.underwritingScenario?.findMany({ where: { dealId } }) || [],
    prisma.underwritingInput?.findMany({
      where: { dealId, supersededAt: null },
      orderBy: { setAt: 'desc' }
    }) || [],
    fetchArtifacts(dealId)
  ]);

  if (!deal) {
    throw new Error(`Deal not found: ${dealId}`);
  }

  // Detect sector and get benchmarks
  const sectorCode = detectSector(deal.profile || {});
  const sector = PROPERTY_SECTORS[sectorCode] || PROPERTY_SECTORS.MULTIFAMILY;
  const benchmarks = sector.benchmarks || {};

  // Parse extraction data
  const parsedExtractions = parseExtractions(extractions);

  // Build calculated returns from model
  const calculatedReturns = model ? buildCalculatedReturns(model) : null;

  // Parse scenarios
  const parsedScenarios = scenarios.map(s => ({
    name: s.name,
    isBaseCase: s.isBaseCase,
    description: s.description,
    assumptions: safeJsonParse(s.assumptions, {}),
    results: safeJsonParse(s.results, {})
  }));

  // Build input provenance summary
  const inputProvenance = buildInputProvenance(inputs);

  // Get conflict summary
  const conflictSummary = getConflictSummary(conflicts);
  const openConflicts = conflicts.filter(c => c.status === 'OPEN');

  return {
    // Deal identification
    dealId,
    dealName: deal.name,
    status: deal.status,
    createdAt: deal.createdAt,

    // Property information
    property: {
      ...deal.profile,
      sectorCode,
      sectorName: sector.name,
      subsectors: sector.subsectors
    },

    // Underwriting model
    model: model ? {
      grossPotentialRent: model.grossPotentialRent,
      vacancyRate: model.vacancyRate,
      effectiveGrossIncome: model.effectiveGrossIncome,
      otherIncome: model.otherIncome,
      operatingExpenses: model.operatingExpenses,
      taxes: model.taxes,
      insurance: model.insurance,
      management: model.management,
      reserves: model.reserves,
      netOperatingIncome: model.netOperatingIncome,
      loanAmount: model.loanAmount,
      interestRate: model.interestRate,
      amortization: model.amortization,
      loanTerm: model.loanTerm,
      annualDebtService: model.annualDebtService,
      exitCapRate: model.exitCapRate,
      holdPeriod: model.holdPeriod,
      rentGrowth: model.rentGrowth,
      expenseGrowth: model.expenseGrowth,
      status: model.status,
      lastCalculatedAt: model.lastCalculatedAt
    } : null,

    // Calculated returns
    calculatedReturns,

    // Extracted data from documents
    extractions: parsedExtractions,

    // Documents available
    documents: artifacts.map(a => ({
      id: a.id,
      name: a.fileName,
      type: a.fileType,
      uploadedAt: a.uploadedAt
    })),

    // Conflicts and issues
    conflicts: {
      summary: conflictSummary,
      open: openConflicts.map(c => ({
        fieldPath: c.fieldPath,
        type: c.conflictType,
        severity: c.severity,
        sourceA: c.sourceA,
        valueA: safeJsonParse(c.valueA, c.valueA),
        sourceB: c.sourceB,
        valueB: safeJsonParse(c.valueB, c.valueB),
        description: c.description,
        percentDiff: c.percentDiff
      }))
    },

    // Scenarios
    scenarios: parsedScenarios,

    // Input provenance (where each number came from)
    inputProvenance,

    // Sector benchmarks for comparison
    benchmarks: {
      sector: sectorCode,
      sectorName: sector.name,
      metrics: benchmarks,
      riskFactors: sector.riskFactors || [],
      leaseStructure: sector.leaseStructure,
      typicalLeaseTerm: sector.typicalLeaseTerm
    },

    // Metadata
    meta: {
      contextBuiltAt: new Date().toISOString(),
      hasModel: !!model,
      extractionCount: extractions.length,
      scenarioCount: scenarios.length,
      openConflictCount: openConflicts.length,
      documentCount: artifacts.length
    }
  };
}

/**
 * Build a compact context summary for token-limited scenarios
 */
export async function buildCompactContext(dealId) {
  const fullContext = await buildDealContext(dealId);

  return {
    dealName: fullContext.dealName,
    property: {
      address: fullContext.property?.asset_address,
      city: fullContext.property?.asset_city,
      state: fullContext.property?.asset_state,
      type: fullContext.property?.property_type,
      purchasePrice: fullContext.property?.purchase_price,
      units: fullContext.property?.unit_count
    },
    returns: fullContext.calculatedReturns,
    keyMetrics: {
      noi: fullContext.model?.netOperatingIncome,
      goingInCap: fullContext.calculatedReturns?.goingInCapRate,
      dscr: fullContext.calculatedReturns?.dscr,
      ltv: fullContext.calculatedReturns?.ltv
    },
    openIssues: fullContext.conflicts.summary.open,
    scenarioCount: fullContext.scenarios.length,
    baseCase: fullContext.scenarios.find(s => s.isBaseCase)?.results
  };
}

/**
 * Generate AI system prompt with deal context
 */
export function generateDealSystemPrompt(context) {
  const { dealName, property, model, calculatedReturns, extractions, conflicts, scenarios, benchmarks } = context;

  return `You are an expert CRE (Commercial Real Estate) underwriting analyst reviewing a deal. You have comprehensive access to all deal data and should help the user understand, analyze, and make decisions about this investment opportunity.

## DEAL: ${dealName}

### PROPERTY INFORMATION
${formatPropertySection(property)}

### UNDERWRITING MODEL
${formatModelSection(model)}

### CALCULATED RETURNS
${formatReturnsSection(calculatedReturns)}

### EXTRACTED DATA SOURCES
${formatExtractionsSection(extractions)}

### CONFLICTS & ISSUES (${conflicts.summary.open} open)
${formatConflictsSection(conflicts.open)}

### SCENARIOS (${scenarios.length} total)
${formatScenariosSection(scenarios)}

### MARKET BENCHMARKS (${benchmarks.sectorName})
${formatBenchmarksSection(benchmarks)}

## YOUR ROLE
1. Answer questions about this deal thoroughly and accurately
2. Always cite your sources (e.g., "Per the T12, NOI is $X" or "From the rent roll, occupancy is Y%")
3. Flag any concerns or unusual metrics proactively
4. Compare metrics to benchmarks and explain implications
5. Help with sensitivity analysis and scenario planning
6. Explain where numbers come from (provenance)
7. Be direct about risks and don't sugarcoat issues

When asked about a specific number, explain:
- What the value is
- Where it came from (which document/extraction)
- How it compares to benchmarks
- Any conflicts or discrepancies`;
}

// ==================== HELPER FUNCTIONS ====================

async function fetchDeal(dealId) {
  // Deal is kernel-managed, fetch from kernel API
  // Also get DealProfile from BFF for additional metadata
  const prisma = getPrisma();

  try {
    // Try kernel first
    const kernelDeal = await kernelFetchJson(`/deals/${dealId}`);
    if (kernelDeal) {
      // Merge with BFF profile if available
      const profile = await prisma.dealProfile?.findUnique({ where: { dealId } }).catch(() => null);
      return {
        ...kernelDeal,
        profile: profile || {}
      };
    }
  } catch (e) {
    // Kernel unavailable, try BFF profile only
  }

  // Fallback to DealProfile only
  const profile = await prisma.dealProfile?.findUnique({ where: { dealId } });
  if (profile) {
    return {
      id: dealId,
      name: profile.propertyAddress || dealId,
      profile
    };
  }

  return null;
}

async function fetchArtifacts(dealId) {
  // Artifact is kernel-managed
  try {
    const artifacts = await kernelFetchJson(`/deals/${dealId}/artifacts`);
    return (artifacts || []).map(a => ({
      id: a.id,
      fileName: a.fileName,
      fileType: a.fileType || a.mimeType,
      uploadedAt: a.uploadedAt
    }));
  } catch (e) {
    return [];
  }
}

function parseExtractions(extractions) {
  return extractions.map(e => {
    const data = safeJsonParse(e.extractedData, {});
    return {
      documentType: e.documentType,
      artifactId: e.artifactId,
      confidence: e.confidence,
      extractedAt: e.extractedAt,
      status: e.status,
      data
    };
  });
}

function buildCalculatedReturns(model) {
  if (!model) return null;

  return {
    goingInCapRate: model.goingInCapRate,
    cashOnCash: model.cashOnCash,
    dscr: model.dscr,
    irr: model.irr,
    equityMultiple: model.equityMultiple,
    ltv: model.loanAmount && model.netOperatingIncome && model.goingInCapRate
      ? model.loanAmount / (model.netOperatingIncome / model.goingInCapRate)
      : null,
    debtYield: model.netOperatingIncome && model.loanAmount
      ? model.netOperatingIncome / model.loanAmount
      : null
  };
}

function buildInputProvenance(inputs) {
  const provenance = {};

  for (const input of inputs) {
    provenance[input.fieldPath] = {
      value: safeJsonParse(input.value, input.value),
      source: input.source,
      sourceDocId: input.sourceDocId,
      confidence: input.confidence,
      setBy: input.setByName,
      setAt: input.setAt,
      rationale: input.rationale
    };
  }

  return provenance;
}

function safeJsonParse(str, fallback) {
  if (typeof str !== 'string') return str ?? fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

// ==================== PROMPT FORMATTERS ====================

function formatPropertySection(property) {
  if (!property) return 'No property information available.';

  const lines = [];
  if (property.asset_address) lines.push(`Address: ${property.asset_address}`);
  if (property.asset_city && property.asset_state) {
    lines.push(`Location: ${property.asset_city}, ${property.asset_state}`);
  }
  if (property.property_type) lines.push(`Type: ${property.property_type} (${property.sectorName})`);
  if (property.purchase_price) lines.push(`Purchase Price: $${formatNumber(property.purchase_price)}`);
  if (property.unit_count) lines.push(`Units: ${property.unit_count}`);
  if (property.year_built) lines.push(`Year Built: ${property.year_built}`);
  if (property.total_sf) lines.push(`Total SF: ${formatNumber(property.total_sf)}`);

  return lines.length > 0 ? lines.join('\n') : 'Limited property information available.';
}

function formatModelSection(model) {
  if (!model) return 'No underwriting model available.';

  const lines = [];

  // Revenue
  if (model.grossPotentialRent) lines.push(`Gross Potential Rent: $${formatNumber(model.grossPotentialRent)}`);
  if (model.vacancyRate) lines.push(`Vacancy Rate: ${(model.vacancyRate * 100).toFixed(1)}%`);
  if (model.effectiveGrossIncome) lines.push(`Effective Gross Income: $${formatNumber(model.effectiveGrossIncome)}`);

  // Expenses
  if (model.operatingExpenses) lines.push(`Operating Expenses: $${formatNumber(model.operatingExpenses)}`);
  if (model.netOperatingIncome) lines.push(`Net Operating Income (NOI): $${formatNumber(model.netOperatingIncome)}`);

  // Debt
  if (model.loanAmount) lines.push(`Loan Amount: $${formatNumber(model.loanAmount)}`);
  if (model.interestRate) lines.push(`Interest Rate: ${(model.interestRate * 100).toFixed(2)}%`);
  if (model.annualDebtService) lines.push(`Annual Debt Service: $${formatNumber(model.annualDebtService)}`);

  // Assumptions
  if (model.exitCapRate) lines.push(`Exit Cap Rate: ${(model.exitCapRate * 100).toFixed(2)}%`);
  if (model.holdPeriod) lines.push(`Hold Period: ${model.holdPeriod} years`);
  if (model.rentGrowth) lines.push(`Rent Growth: ${(model.rentGrowth * 100).toFixed(1)}%/year`);

  return lines.length > 0 ? lines.join('\n') : 'Model inputs not yet populated.';
}

function formatReturnsSection(returns) {
  if (!returns) return 'No returns calculated yet.';

  const lines = [];
  if (returns.irr != null) lines.push(`IRR: ${(returns.irr * 100).toFixed(2)}%`);
  if (returns.equityMultiple != null) lines.push(`Equity Multiple: ${returns.equityMultiple.toFixed(2)}x`);
  if (returns.cashOnCash != null) lines.push(`Cash-on-Cash: ${(returns.cashOnCash * 100).toFixed(2)}%`);
  if (returns.goingInCapRate != null) lines.push(`Going-In Cap Rate: ${(returns.goingInCapRate * 100).toFixed(2)}%`);
  if (returns.dscr != null) lines.push(`DSCR: ${returns.dscr.toFixed(2)}x`);
  if (returns.ltv != null) lines.push(`LTV: ${(returns.ltv * 100).toFixed(1)}%`);
  if (returns.debtYield != null) lines.push(`Debt Yield: ${(returns.debtYield * 100).toFixed(2)}%`);

  return lines.length > 0 ? lines.join('\n') : 'Returns not yet calculated.';
}

function formatExtractionsSection(extractions) {
  if (!extractions || extractions.length === 0) {
    return 'No documents have been extracted yet.';
  }

  return extractions.map(e => {
    let summary = `${e.documentType}: `;
    if (e.documentType === 'RENT_ROLL' && e.data.summary) {
      const s = e.data.summary;
      summary += `${s.totalUnits || '?'} units, ${((s.occupancyRate || 0) * 100).toFixed(0)}% occupancy, $${formatNumber(s.totalAnnualRent || 0)}/year`;
    } else if (e.documentType === 'T12' && e.data.revenue) {
      summary += `NOI $${formatNumber(e.data.noi || 0)}, GPR $${formatNumber(e.data.revenue?.grossPotentialRent || 0)}`;
    } else if (e.documentType === 'LOAN_TERMS' && e.data) {
      summary += `$${formatNumber(e.data.loanAmount || 0)} at ${((e.data.interestRate || 0) * 100).toFixed(2)}%`;
    } else {
      summary += `Extracted ${e.extractedAt}`;
    }
    return `- ${summary} (confidence: ${((e.confidence || 0) * 100).toFixed(0)}%)`;
  }).join('\n');
}

function formatConflictsSection(conflicts) {
  if (!conflicts || conflicts.length === 0) {
    return 'No open conflicts.';
  }

  return conflicts.map(c => {
    return `- [${c.severity}] ${c.fieldPath}: ${c.description || `${c.sourceA}=${c.valueA} vs ${c.sourceB}=${c.valueB}`}`;
  }).join('\n');
}

function formatScenariosSection(scenarios) {
  if (!scenarios || scenarios.length === 0) {
    return 'No scenarios created yet.';
  }

  return scenarios.map(s => {
    const results = s.results;
    let metrics = '';
    if (results.irr != null) metrics += `IRR: ${(results.irr * 100).toFixed(1)}%`;
    if (results.equityMultiple != null) metrics += `, EM: ${results.equityMultiple.toFixed(2)}x`;
    return `- ${s.name}${s.isBaseCase ? ' (BASE)' : ''}: ${metrics || 'Not calculated'}`;
  }).join('\n');
}

function formatBenchmarksSection(benchmarks) {
  if (!benchmarks || !benchmarks.metrics) {
    return 'No benchmarks available.';
  }

  const lines = [];
  const m = benchmarks.metrics;

  if (m.capRate) {
    lines.push(`Cap Rate: ${(m.capRate.min * 100).toFixed(1)}% - ${(m.capRate.max * 100).toFixed(1)}% (typical: ${(m.capRate.typical * 100).toFixed(1)}%)`);
  }
  if (m.occupancy) {
    lines.push(`Occupancy: ${(m.occupancy.min * 100).toFixed(0)}% - ${(m.occupancy.max * 100).toFixed(0)}%`);
  }
  if (m.expenseRatio) {
    lines.push(`Expense Ratio: ${(m.expenseRatio.min * 100).toFixed(0)}% - ${(m.expenseRatio.max * 100).toFixed(0)}%`);
  }
  if (m.dscr) {
    lines.push(`DSCR: ${m.dscr.min.toFixed(2)}x - ${m.dscr.max.toFixed(2)}x`);
  }

  if (benchmarks.riskFactors && benchmarks.riskFactors.length > 0) {
    lines.push('');
    lines.push('Key Risk Factors:');
    benchmarks.riskFactors.slice(0, 5).forEach(rf => lines.push(`- ${rf}`));
  }

  return lines.join('\n');
}

function formatNumber(num) {
  if (num == null) return '0';
  return num.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

// =============================================================================
// FILTERED CONTEXT BUILDER (SECURITY)
// =============================================================================

/**
 * Build filtered deal context for AI interactions
 *
 * SECURITY: This is the preferred method for all AI endpoints. It builds
 * the full context and then filters it based on the user's role and
 * entitlements. The LLM only sees data the user is authorized to access.
 *
 * @param {string} dealId - The deal ID
 * @param {Object} authUser - Authenticated user from JWT (must include role, organizationId)
 * @returns {Object} Filtered context object safe for this user's AI interactions
 */
export async function buildFilteredDealContext(dealId, authUser) {
  console.log(`[CONTEXT-BUILDER] buildFilteredDealContext called - Deal: ${dealId}, User: ${authUser?.id}, Role: ${authUser?.role}`);

  if (!authUser) {
    console.log(`[CONTEXT-BUILDER] ERROR - No authUser provided`);
    throw new Error('Authentication required for AI context access');
  }

  // Build full context
  console.log(`[CONTEXT-BUILDER] Building full context for deal ${dealId}...`);
  const fullContext = await buildDealContext(dealId);
  console.log(`[CONTEXT-BUILDER] Full context built - Keys: ${Object.keys(fullContext).join(', ')}`);

  // Apply role-based filtering
  console.log(`[CONTEXT-BUILDER] Applying role-based filtering for ${authUser.role}...`);
  const filteredContext = await filterContextForUser(fullContext, authUser, dealId);
  console.log(`[CONTEXT-BUILDER] Filtering complete - Filtered keys: ${Object.keys(filteredContext).join(', ')}`);

  return filteredContext;
}

/**
 * Generate AI system prompt with filtered deal context
 *
 * SECURITY: Uses filtered context so the prompt only includes data
 * the user is authorized to see.
 *
 * @param {Object} filteredContext - Filtered context from buildFilteredDealContext()
 * @param {string} userRole - The user's role for role-specific instructions
 * @returns {string} System prompt safe for this user
 */
export function generateFilteredDealSystemPrompt(filteredContext, userRole) {
  const { dealName, property, model, calculatedReturns, extractions, conflicts, scenarios, benchmarks, myInvestment } = filteredContext;

  // LP gets a different prompt focused on their investment
  if (userRole === 'LP') {
    return generateLPSystemPrompt(filteredContext);
  }

  // For other roles, use the standard prompt with filtered data
  return `You are an expert CRE (Commercial Real Estate) underwriting analyst reviewing a deal. You have access to deal data filtered based on your role (${userRole}). Only discuss information that has been provided to you.

## DEAL: ${dealName}

### PROPERTY INFORMATION
${formatPropertySection(property)}

${model ? `### UNDERWRITING MODEL
${formatModelSection(model)}` : ''}

${calculatedReturns ? `### CALCULATED RETURNS
${formatReturnsSection(calculatedReturns)}` : ''}

${extractions && extractions.length > 0 ? `### EXTRACTED DATA SOURCES
${formatExtractionsSection(extractions)}` : ''}

${conflicts && conflicts.open && conflicts.open.length > 0 ? `### CONFLICTS & ISSUES (${conflicts.summary?.open || 0} open)
${formatConflictsSection(conflicts.open)}` : ''}

${scenarios && scenarios.length > 0 ? `### SCENARIOS (${scenarios.length} total)
${formatScenariosSection(scenarios)}` : ''}

${benchmarks && benchmarks.metrics ? `### MARKET BENCHMARKS (${benchmarks.sectorName})
${formatBenchmarksSection(benchmarks)}` : ''}

## YOUR ROLE
1. Answer questions about this deal thoroughly and accurately
2. Always cite your sources (e.g., "Per the T12, NOI is $X" or "From the rent roll, occupancy is Y%")
3. Flag any concerns or unusual metrics proactively
4. Compare metrics to benchmarks and explain implications
5. Help with sensitivity analysis and scenario planning
6. Explain where numbers come from (provenance)
7. Be direct about risks and don't sugarcoat issues
8. IMPORTANT: Only discuss data that has been provided to you. Do not speculate about data you don't have access to.

When asked about a specific number, explain:
- What the value is
- Where it came from (which document/extraction)
- How it compares to benchmarks
- Any conflicts or discrepancies`;
}

/**
 * Generate LP-specific system prompt focused on their investment
 */
function generateLPSystemPrompt(filteredContext) {
  const { dealName, property, myInvestment, myCapitalCalls, myDistributions, documents } = filteredContext;

  return `You are a helpful assistant for Limited Partner investors. You have access to information about the LP's investment in ${dealName}.

## INVESTMENT SUMMARY

### Property
${property ? `
- Address: ${property.asset_address || 'N/A'}
- Location: ${property.asset_city || ''}, ${property.asset_state || ''}
- Type: ${property.property_type || 'N/A'}
` : 'Property details not available for your role.'}

### Your Investment
${myInvestment ? `
- Entity: ${myInvestment.entityName}
- Commitment: $${myInvestment.commitment?.toLocaleString() || 0}
- Ownership: ${myInvestment.ownershipPct?.toFixed(2) || 0}%
- Status: ${myInvestment.status}
` : 'No investment data available.'}

${myCapitalCalls && myCapitalCalls.length > 0 ? `### Capital Calls
${myCapitalCalls.map(cc => `- $${cc.amount?.toLocaleString() || 0} - ${cc.status} (Due: ${cc.dueDate || 'N/A'})`).join('\n')}
` : ''}

${myDistributions && myDistributions.length > 0 ? `### Distributions
${myDistributions.map(d => `- $${d.amount?.toLocaleString() || 0} - ${d.type || 'Distribution'} (${d.date || 'N/A'})`).join('\n')}
` : ''}

${documents && documents.length > 0 ? `### Available Documents
${documents.map(d => `- ${d.name}`).join('\n')}
` : ''}

## YOUR ROLE
1. Help the LP understand their investment
2. Answer questions about capital calls and distributions
3. Provide information about available documents
4. Be helpful and clear in your explanations
5. IMPORTANT: You only have access to LP-visible data. Do not speculate about deal financials, other investors, or internal deal team information.`;
}

export default {
  buildDealContext,
  buildFilteredDealContext,
  buildCompactContext,
  generateDealSystemPrompt,
  generateFilteredDealSystemPrompt
};
