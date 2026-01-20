/**
 * Memo Generator Service
 *
 * Generates Investment Committee (IC) memos from underwriting models.
 * Produces structured markdown output that can be edited by analysts.
 */

/**
 * Format currency for display
 */
function formatCurrency(amount) {
  if (amount === null || amount === undefined) return 'N/A';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(amount);
}

/**
 * Format percentage for display
 */
function formatPercent(decimal) {
  if (decimal === null || decimal === undefined) return 'N/A';
  return `${(decimal * 100).toFixed(2)}%`;
}

/**
 * Format number for display
 */
function formatNumber(num) {
  if (num === null || num === undefined) return 'N/A';
  return num.toLocaleString('en-US');
}

/**
 * Generate the full IC memo from model data
 *
 * @param {Object} deal - Deal information
 * @param {Object} model - Underwriting model
 * @param {Array} scenarios - Array of scenario comparisons
 * @param {Array} conflicts - Array of conflicts (resolved and open)
 * @param {Object} analystNotes - Analyst-provided content
 * @param {Array} inputs - Input provenance data
 * @returns {string} Markdown memo content
 */
export function generateMemo(deal, model, scenarios = [], conflicts = [], analystNotes = {}, inputs = []) {
  const sections = [];

  // Header
  sections.push(generateHeader(deal, model));

  // Executive Summary
  sections.push(generateExecutiveSummary(deal, model, scenarios));

  // Returns Summary Table
  sections.push(generateReturnsSummary(scenarios));

  // Investment Thesis (from analyst)
  sections.push(generateInvestmentThesis(analystNotes));

  // Property Overview
  sections.push(generatePropertyOverview(deal, model));

  // Financial Summary
  sections.push(generateFinancialSummary(model));

  // Debt Structure
  sections.push(generateDebtStructure(model));

  // Key Assumptions
  sections.push(generateAssumptions(model, inputs));

  // Sensitivity Analysis
  sections.push(generateSensitivityAnalysis(scenarios));

  // Risk Factors
  sections.push(generateRiskFactors(analystNotes, conflicts));

  // Resolved Conflicts
  if (conflicts.some(c => c.status === 'RESOLVED')) {
    sections.push(generateResolvedConflicts(conflicts));
  }

  // Appendix: Data Sources
  sections.push(generateDataSources(inputs));

  // Footer
  sections.push(generateFooter());

  return sections.filter(Boolean).join('\n\n');
}

function generateHeader(deal, model) {
  const dealName = deal?.name || '[Deal Name]';
  const status = model?.status || 'DRAFT';

  return `# Investment Memo: ${dealName}

**Status:** ${status}
**Prepared:** ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
**Preparer:** [Analyst Name]

---`;
}

function generateExecutiveSummary(deal, model, scenarios) {
  const profile = deal?.profile || {};
  const returns = model?.returns || {};
  const income = model?.income || {};

  // Get base case scenario
  const baseCase = scenarios.find(s => s.isBaseCase) || scenarios[0];

  return `## Executive Summary

**Property:** ${profile.asset_address || '[Address]'}, ${profile.asset_city || '[City]'}, ${profile.asset_state || '[State]'}
**Type:** ${formatNumber(profile.unit_count)}-unit ${profile.asset_type || 'Multifamily'}, ${profile.year_built || '[Year]'} vintage
**Price:** ${formatCurrency(profile.purchase_price)} (${formatCurrency(profile.purchase_price / (profile.unit_count || 1))}/unit)
**Going-In Cap:** ${formatPercent(returns.goingInCapRate)}

**Key Metrics:**
- NOI: ${formatCurrency(income.netOperatingIncome)}
- DSCR: ${model?.debtMetrics?.dscr?.toFixed(2) || 'N/A'}x
- LTV: ${formatPercent(model?.debtMetrics?.ltv)}
- Cash-on-Cash: ${formatPercent(returns.cashOnCash)}
- Projected IRR: ${formatPercent(returns.irr)}`;
}

function generateReturnsSummary(scenarios) {
  if (!scenarios || scenarios.length === 0) {
    return `## Returns Summary

*No scenarios have been modeled yet.*`;
  }

  const rows = scenarios.map(s => {
    const r = s.results || {};
    const meetsThreshold = (r.irr ?? 0) > 0.15 ? '✓' : '⚠️';
    return `| ${s.name} | ${formatPercent(r.irr)} | ${formatPercent(r.cashOnCash)} | ${r.dscr?.toFixed(2) || 'N/A'}x | ${r.equityMultiple?.toFixed(2) || 'N/A'}x | ${meetsThreshold} |`;
  }).join('\n');

  return `## Returns Summary

| Scenario | IRR | Cash-on-Cash | DSCR | Equity Multiple | vs. Threshold |
|----------|-----|--------------|------|-----------------|---------------|
${rows}

*Threshold: 15% IRR minimum*`;
}

function generateInvestmentThesis(analystNotes) {
  return `## Investment Thesis

${analystNotes.recommendation || '*[Analyst to provide investment recommendation and thesis]*'}

### Key Investment Highlights
${analystNotes.highlights || `- *[Highlight 1]*
- *[Highlight 2]*
- *[Highlight 3]*`}`;
}

function generatePropertyOverview(deal, model) {
  const profile = deal?.profile || {};

  return `## Property Overview

### Location
- **Address:** ${profile.asset_address || '[Address]'}
- **City/State:** ${profile.asset_city || '[City]'}, ${profile.asset_state || '[State]'}
- **Submarket:** ${profile.submarket || '*[To be determined]*'}

### Physical Characteristics
- **Property Type:** ${profile.asset_type || 'Multifamily'}
- **Year Built:** ${profile.year_built || 'N/A'}
- **Units:** ${formatNumber(profile.unit_count)}
- **Square Footage:** ${formatNumber(profile.square_footage)} SF
- **Avg Unit Size:** ${profile.unit_count ? formatNumber(Math.round(profile.square_footage / profile.unit_count)) : 'N/A'} SF

### Sponsor
- **General Partner:** ${profile.gp_name || '[GP Name]'}`;
}

function generateFinancialSummary(model) {
  const income = model?.income || {};
  const expenses = model?.expenses || {};

  return `## Financial Summary

### Revenue
| Line Item | Annual Amount |
|-----------|--------------|
| Gross Potential Rent | ${formatCurrency(income.grossPotentialRent)} |
| Less: Vacancy | (${formatCurrency(income.vacancyLoss)}) |
| Plus: Other Income | ${formatCurrency(income.otherIncome)} |
| **Effective Gross Income** | **${formatCurrency(income.effectiveGrossIncome)}** |

### Expenses
| Line Item | Annual Amount |
|-----------|--------------|
| Operating Expenses | ${formatCurrency(expenses.totalOperating)} |
| Expense Ratio | ${formatPercent(expenses.expenseRatio)} |

### Net Operating Income
| | |
|-----------|--------------|
| **NOI** | **${formatCurrency(income.netOperatingIncome)}** |`;
}

function generateDebtStructure(model) {
  const debt = model?.debtMetrics || {};
  const inputs = model?.inputs || {};

  return `## Debt Structure

### Loan Terms
| | |
|-----------|--------------|
| Loan Amount | ${formatCurrency(inputs.loanAmount)} |
| LTV | ${formatPercent(debt.ltv)} |
| Interest Rate | ${formatPercent(inputs.interestRate)} |
| Amortization | ${inputs.amortization || 'N/A'} years |
| Annual Debt Service | ${formatCurrency(debt.annualDebtService)} |

### Coverage
| Metric | Value | Requirement |
|--------|-------|-------------|
| DSCR | ${debt.dscr?.toFixed(2) || 'N/A'}x | 1.25x min |`;
}

function generateAssumptions(model, inputs) {
  const modelInputs = model?.inputs || {};

  // Build table from input provenance if available
  let assumptionRows = '';

  if (inputs && inputs.length > 0) {
    assumptionRows = inputs
      .filter(i => !i.supersededAt) // Only current inputs
      .slice(0, 15) // Limit for readability
      .map(i => `| ${i.fieldPath} | ${i.value} | ${i.source} | ${i.setByName || 'System'} |`)
      .join('\n');
  } else {
    // Default assumptions display
    assumptionRows = `| Exit Cap Rate | ${formatPercent(modelInputs.exitCapRate)} | ASSUMPTION | Analyst |
| Hold Period | ${modelInputs.holdPeriod || 5} years | ASSUMPTION | Analyst |
| Rent Growth | ${formatPercent(modelInputs.rentGrowth)} | ASSUMPTION | Analyst |
| Expense Growth | ${formatPercent(modelInputs.expenseGrowth)} | ASSUMPTION | Analyst |`;
  }

  return `## Key Assumptions

| Input | Value | Source | Set By |
|-------|-------|--------|--------|
${assumptionRows}`;
}

function generateSensitivityAnalysis(scenarios) {
  if (!scenarios || scenarios.length < 2) {
    return `## Sensitivity Analysis

*Run additional scenarios to see sensitivity analysis.*`;
  }

  // Find base case
  const baseCase = scenarios.find(s => s.isBaseCase) || scenarios[0];
  const baseIRR = baseCase?.results?.irr ?? 0;

  const sensitivityRows = scenarios
    .filter(s => s.name !== baseCase.name)
    .map(s => {
      const irr = s.results?.irr ?? 0;
      const diff = irr - baseIRR;
      const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '→';
      return `| ${s.name} | ${formatPercent(irr)} | ${arrow} ${formatPercent(Math.abs(diff))} |`;
    })
    .join('\n');

  return `## Sensitivity Analysis

**Base Case IRR:** ${formatPercent(baseIRR)}

| Scenario | IRR | vs. Base |
|----------|-----|----------|
${sensitivityRows}`;
}

function generateRiskFactors(analystNotes, conflicts) {
  const openConflicts = conflicts.filter(c => c.status === 'OPEN');
  const errorConflicts = conflicts.filter(c => c.severity === 'ERROR');

  let riskContent = analystNotes.risks || `### Identified Risks

*[Analyst to identify key risks]*

- Market risk
- Execution risk
- Financing risk`;

  // Add open conflicts as risks
  if (openConflicts.length > 0) {
    riskContent += `

### Unresolved Data Conflicts

${openConflicts.map(c => `- **${c.fieldPath}:** ${c.description || 'Needs resolution'}`).join('\n')}`;
  }

  if (errorConflicts.length > 0) {
    riskContent += `

⚠️ **${errorConflicts.length} critical issue(s) require resolution before IC submission.**`;
  }

  return `## Risk Factors

${riskContent}`;
}

function generateResolvedConflicts(conflicts) {
  const resolved = conflicts.filter(c => c.status === 'RESOLVED');

  if (resolved.length === 0) return null;

  const rows = resolved.map(c =>
    `- **${c.fieldPath}:** Used ${c.resolution} source. ${c.resolutionNote || ''}`
  ).join('\n');

  return `## Resolved Data Conflicts

The following discrepancies were identified and resolved during underwriting:

${rows}`;
}

function generateDataSources(inputs) {
  // Get unique sources
  const sources = [...new Set(inputs.map(i => i.source).filter(Boolean))];

  if (sources.length === 0) {
    return `## Data Sources

*No documented data sources.*`;
  }

  const sourceList = sources.map(s => `- ${s}`).join('\n');

  return `## Data Sources

This analysis incorporates data from the following sources:

${sourceList}

All inputs are tracked with full audit trail in the underwriting system.`;
}

function generateFooter() {
  return `---

*Generated ${new Date().toISOString()} from Canonical Deal OS underwriting model*

**This memo is for internal investment committee use only.**`;
}

/**
 * Generate a quick summary (shorter format)
 */
export function generateQuickSummary(deal, model) {
  const profile = deal?.profile || {};
  const returns = model?.returns || {};
  const debt = model?.debtMetrics || {};
  const income = model?.income || {};

  return `**${deal?.name || 'Deal'}** | ${profile.asset_type || 'Property'} | ${formatNumber(profile.unit_count)} units

Price: ${formatCurrency(profile.purchase_price)} | Cap: ${formatPercent(returns.goingInCapRate)} | NOI: ${formatCurrency(income.netOperatingIncome)}
IRR: ${formatPercent(returns.irr)} | CoC: ${formatPercent(returns.cashOnCash)} | DSCR: ${debt.dscr?.toFixed(2) || 'N/A'}x`;
}

export default {
  generateMemo,
  generateQuickSummary
};
