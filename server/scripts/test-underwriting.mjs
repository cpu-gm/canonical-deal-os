#!/usr/bin/env node

/**
 * Test Script for Phase 5: Underwriting Intelligence
 *
 * Tests the full underwriting flow including:
 * - Document extraction (rent roll, T12, loan terms)
 * - Underwriting model creation and calculation
 * - Conflict detection
 * - Scenario management
 * - Memo generation
 *
 * Run with: node server/scripts/test-underwriting.mjs
 */

const BASE_URL = process.env.BFF_URL || 'http://localhost:8787';
const TEST_USER_ID = 'test-analyst-123';
const TEST_DEAL_ID = 'test-deal-uw-456';

// Sample document content for extraction testing
const SAMPLE_RENT_ROLL = `
Property: 123 Main Street Apartments
As of: December 1, 2025
Total Units: 42

Unit Mix Summary:
- Studio: 6 units, avg rent $1,200, avg 450 sqft
- 1BR: 20 units, avg rent $1,500, avg 650 sqft
- 2BR: 14 units, avg rent $1,950, avg 900 sqft
- 3BR: 2 units, avg rent $2,400, avg 1,100 sqft

Occupancy: 40/42 units occupied (95.2%)
Total Monthly Rent: $65,400
Total Annual Rent: $784,800
Average Rent Per Unit: $1,557

Unit Details:
101 | 1BR | 650 sqft | $1,450 | Occupied | Lease 01/01/25-12/31/25
102 | Studio | 450 sqft | $1,150 | Occupied | MTM
103 | 2BR | 900 sqft | $1,900 | Occupied | Lease 03/01/25-02/28/26
104 | 2BR | 920 sqft | $2,050 | Vacant | -
...
`;

const SAMPLE_T12 = `
Operating Statement (T12)
Property: 123 Main Street Apartments
Period: January 2025 - December 2025

REVENUE
Gross Potential Rent: $820,000
Less: Vacancy/Loss to Lease: ($41,000)
Less: Concessions: ($8,200)
Less: Bad Debt: ($4,100)
Other Income (parking, laundry, fees): $24,000
-----------------------------------------
Effective Gross Income: $790,700

EXPENSES
Real Estate Taxes: $78,500
Insurance: $18,500
Utilities: $36,000
Repairs & Maintenance: $42,000
Property Management (4%): $31,628
Payroll: $52,000
Administrative: $12,000
Marketing: $6,000
Contract Services: $18,000
Reserves: $12,600
-----------------------------------------
Total Operating Expenses: $307,228

NET OPERATING INCOME: $483,472
Expense Ratio: 38.9%
`;

const SAMPLE_LOAN_TERMS = `
TERM SHEET
Lender: First National Bank
Date: January 10, 2026

Loan Amount: $8,500,000
Loan-to-Value: 65%
Purchase Price: $13,077,000

Interest Rate: 6.25% (Fixed)
Loan Term: 7 years
Amortization: 30 years
Interest-Only Period: 2 years

DSCR Requirement: 1.25x minimum
Recourse: Non-recourse (carve-outs apply)

Prepayment: 3-2-1 step-down

Fees:
- Origination: 0.75% ($63,750)
- Exit Fee: None
- Legal/Due Diligence: $25,000

Covenants:
- Minimum DSCR: 1.25x
- Maximum LTV: 70%
- Minimum Occupancy: 85%
`;

// Helper for API requests
async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': TEST_USER_ID,
      'x-user-name': 'Test Analyst',
      'x-actor-role': 'GP Analyst',
      ...options.headers
    }
  });

  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  if (!response.ok) {
    throw new Error(`${response.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  }

  return data;
}

// Test results tracking
let passed = 0;
let failed = 0;

function test(name, fn) {
  return async () => {
    try {
      await fn();
      console.log(`✓ ${name}`);
      passed++;
    } catch (error) {
      console.log(`✗ ${name}`);
      console.log(`  Error: ${error.message}`);
      failed++;
    }
  };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

// ==================== Tests ====================

const tests = [
  // Test 1: API health check
  test('Server is running', async () => {
    const response = await fetch(`${BASE_URL}/health`);
    assert(response.status === 200, 'Server should respond to health check');
  }),

  // Test 2: Extract rent roll
  test('Extract rent roll document', async () => {
    const result = await request(`/api/deals/${TEST_DEAL_ID}/extract`, {
      method: 'POST',
      body: JSON.stringify({
        artifactId: 'test-rent-roll-001',
        documentType: 'RENT_ROLL',
        documentContent: SAMPLE_RENT_ROLL,
        filename: 'rent-roll-dec-2025.pdf'
      })
    });

    assert(result.extraction, 'Should return extraction object');
    assert(result.extraction.documentType === 'RENT_ROLL', 'Document type should be RENT_ROLL');
    assert(result.extraction.confidence > 0, 'Should have confidence score');
    assert(result.data, 'Should return extracted data');
    assert(result.data.summary, 'Should have summary section');

    // Store extraction ID for later tests
    globalThis.rentRollExtractionId = result.extraction.id;
    console.log(`    Confidence: ${(result.extraction.confidence * 100).toFixed(0)}%`);
    console.log(`    Units extracted: ${result.data.summary?.totalUnits || 'N/A'}`);
  }),

  // Test 3: Extract T12
  test('Extract T12 operating statement', async () => {
    const result = await request(`/api/deals/${TEST_DEAL_ID}/extract`, {
      method: 'POST',
      body: JSON.stringify({
        artifactId: 'test-t12-001',
        documentType: 'T12',
        documentContent: SAMPLE_T12,
        filename: 't12-2025.pdf'
      })
    });

    assert(result.extraction, 'Should return extraction object');
    assert(result.extraction.documentType === 'T12', 'Document type should be T12');
    assert(result.data, 'Should return extracted data');
    assert(result.data.noi || result.data.revenue, 'Should have financial data');

    globalThis.t12ExtractionId = result.extraction.id;
    console.log(`    Confidence: ${(result.extraction.confidence * 100).toFixed(0)}%`);
    console.log(`    NOI extracted: $${result.data.noi?.toLocaleString() || 'N/A'}`);
  }),

  // Test 4: Extract loan terms
  test('Extract loan terms', async () => {
    const result = await request(`/api/deals/${TEST_DEAL_ID}/extract`, {
      method: 'POST',
      body: JSON.stringify({
        artifactId: 'test-loan-terms-001',
        documentType: 'LOAN_TERMS',
        documentContent: SAMPLE_LOAN_TERMS,
        filename: 'term-sheet.pdf'
      })
    });

    assert(result.extraction, 'Should return extraction object');
    assert(result.data, 'Should return extracted data');

    globalThis.loanExtractionId = result.extraction.id;
    console.log(`    Confidence: ${(result.extraction.confidence * 100).toFixed(0)}%`);
    console.log(`    Loan amount: $${result.data.loanAmount?.toLocaleString() || 'N/A'}`);
  }),

  // Test 5: List extractions
  test('List extractions for deal', async () => {
    const result = await request(`/api/deals/${TEST_DEAL_ID}/extractions`);

    assert(Array.isArray(result.extractions), 'Should return array of extractions');
    assert(result.extractions.length >= 3, 'Should have at least 3 extractions');
    console.log(`    Found ${result.extractions.length} extractions`);
  }),

  // Test 6: Get/create underwriting model
  test('Get underwriting model', async () => {
    const result = await request(`/api/deals/${TEST_DEAL_ID}/underwriting`);

    assert(result.model, 'Should return model object');
    assert(result.model.dealId === TEST_DEAL_ID, 'Model should be for correct deal');
    console.log(`    Model status: ${result.model.status}`);
  }),

  // Test 7: Apply rent roll extraction to model
  test('Apply rent roll extraction to model', async () => {
    const result = await request(`/api/deals/${TEST_DEAL_ID}/underwriting/apply-extraction`, {
      method: 'POST',
      body: JSON.stringify({
        extractionId: globalThis.rentRollExtractionId
      })
    });

    assert(result.applied, 'Should return applied fields');
    assert(result.applied.length > 0, 'Should have applied at least one field');
    console.log(`    Applied fields: ${result.applied.join(', ')}`);
  }),

  // Test 8: Apply T12 extraction
  test('Apply T12 extraction to model', async () => {
    const result = await request(`/api/deals/${TEST_DEAL_ID}/underwriting/apply-extraction`, {
      method: 'POST',
      body: JSON.stringify({
        extractionId: globalThis.t12ExtractionId
      })
    });

    assert(result.applied, 'Should return applied fields');
    console.log(`    Applied fields: ${result.applied.join(', ')}`);
  }),

  // Test 9: Update model with manual input
  test('Update model with manual assumption', async () => {
    const result = await request(`/api/deals/${TEST_DEAL_ID}/underwriting`, {
      method: 'PATCH',
      body: JSON.stringify({
        updates: {
          exitCapRate: 0.055,
          holdPeriod: 5,
          rentGrowth: 0.03,
          expenseGrowth: 0.02,
          loanAmount: 8500000,
          interestRate: 0.0625,
          amortization: 30
        },
        source: 'ASSUMPTION',
        rationale: 'Base case assumptions'
      })
    });

    assert(result.model, 'Should return updated model');
    assert(result.updated?.length > 0, 'Should report updated fields');
    console.log(`    Updated: ${result.updated.join(', ')}`);
  }),

  // Test 10: Calculate model
  test('Calculate underwriting model', async () => {
    const result = await request(`/api/deals/${TEST_DEAL_ID}/underwriting/calculate`, {
      method: 'POST'
    });

    assert(result.model, 'Should return calculated model');
    assert(result.calculated, 'Should return calculation details');
    console.log(`    Cap Rate: ${result.calculated?.returns?.goingInCapRate ? (result.calculated.returns.goingInCapRate * 100).toFixed(2) + '%' : 'N/A'}`);
    console.log(`    DSCR: ${result.calculated?.debtMetrics?.dscr?.toFixed(2) || 'N/A'}x`);
    console.log(`    IRR: ${result.calculated?.returns?.irr ? (result.calculated.returns.irr * 100).toFixed(1) + '%' : 'N/A'}`);

    if (result.warnings?.length > 0) {
      console.log(`    Warnings: ${result.warnings.join(', ')}`);
    }
  }),

  // Test 11: List conflicts
  test('List conflicts', async () => {
    const result = await request(`/api/deals/${TEST_DEAL_ID}/conflicts`);

    assert(Array.isArray(result.conflicts), 'Should return array of conflicts');
    assert(result.summary, 'Should return summary');
    console.log(`    Open conflicts: ${result.summary.open}`);
    console.log(`    Errors: ${result.summary.errors}, Warnings: ${result.summary.warnings}`);
  }),

  // Test 12: Create base case scenario
  test('Create base case scenario', async () => {
    const result = await request(`/api/deals/${TEST_DEAL_ID}/scenarios`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Base Case',
        description: 'Standard underwriting assumptions',
        assumptions: {
          exitCapRate: 0.055,
          holdPeriod: 5,
          rentGrowth: 0.03
        },
        isBaseCase: true
      })
    });

    assert(result.scenario, 'Should return scenario');
    assert(result.scenario.name === 'Base Case', 'Should have correct name');
    assert(result.scenario.isBaseCase === true, 'Should be marked as base case');
    globalThis.baseCaseId = result.scenario.id;
    console.log(`    IRR: ${result.scenario.results?.irr ? (result.scenario.results.irr * 100).toFixed(1) + '%' : 'N/A'}`);
  }),

  // Test 13: Create downside scenario
  test('Create downside scenario', async () => {
    const result = await request(`/api/deals/${TEST_DEAL_ID}/scenarios`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Downside',
        description: 'Conservative assumptions with cap rate expansion',
        assumptions: {
          exitCapRate: 0.065,
          holdPeriod: 5,
          rentGrowth: 0.02,
          expenseGrowth: 0.03
        },
        isBaseCase: false
      })
    });

    assert(result.scenario, 'Should return scenario');
    globalThis.downsideId = result.scenario.id;
    console.log(`    IRR: ${result.scenario.results?.irr ? (result.scenario.results.irr * 100).toFixed(1) + '%' : 'N/A'}`);
  }),

  // Test 14: Create upside scenario
  test('Create upside scenario', async () => {
    const result = await request(`/api/deals/${TEST_DEAL_ID}/scenarios`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Value-Add Achieved',
        description: 'Rent growth achieved, cap rate compression',
        assumptions: {
          exitCapRate: 0.050,
          holdPeriod: 5,
          rentGrowth: 0.05
        },
        isBaseCase: false
      })
    });

    assert(result.scenario, 'Should return scenario');
    console.log(`    IRR: ${result.scenario.results?.irr ? (result.scenario.results.irr * 100).toFixed(1) + '%' : 'N/A'}`);
  }),

  // Test 15: Compare scenarios
  test('Compare scenarios', async () => {
    const result = await request(`/api/deals/${TEST_DEAL_ID}/scenarios/compare`);

    assert(Array.isArray(result.comparison), 'Should return comparison array');
    assert(result.comparison.length >= 3, 'Should have at least 3 scenarios');

    console.log('    Scenario Comparison:');
    result.comparison.forEach(s => {
      const irr = s.results?.irr ? (s.results.irr * 100).toFixed(1) + '%' : 'N/A';
      console.log(`      ${s.name}: IRR ${irr}`);
    });
  }),

  // Test 16: Generate memo
  test('Generate IC memo', async () => {
    const result = await request(`/api/deals/${TEST_DEAL_ID}/memo/generate`, {
      method: 'POST',
      body: JSON.stringify({
        analystNotes: {
          recommendation: 'Recommend proceeding with acquisition. Returns exceed threshold in base case.',
          highlights: '- Strong submarket fundamentals\n- Below replacement cost basis\n- Value-add opportunity through unit renovations',
          risks: '- Interest rate risk if refinancing in Year 7\n- Execution risk on renovation program\n- Local rent control ballot measure in 2027'
        }
      })
    });

    assert(result.memo, 'Should return memo');
    assert(result.memo.content, 'Should have content');
    assert(result.memo.content.includes('Investment Memo'), 'Should include memo header');
    console.log(`    Memo generated: ${result.memo.content.length} characters`);
    console.log(`    Status: ${result.memo.status}`);
  }),

  // Test 17: Get memo
  test('Get memo', async () => {
    const result = await request(`/api/deals/${TEST_DEAL_ID}/memo`);

    assert(result.memo, 'Should return memo');
    assert(result.memo.content, 'Should have content');
  }),

  // Test 18: Update memo
  test('Update memo with edits', async () => {
    const result = await request(`/api/deals/${TEST_DEAL_ID}/memo`, {
      method: 'PATCH',
      body: JSON.stringify({
        recommendation: 'Updated: Strong buy recommendation',
        status: 'READY'
      })
    });

    assert(result.memo, 'Should return updated memo');
    assert(result.memo.status === 'READY', 'Status should be updated');
    console.log(`    New status: ${result.memo.status}`);
  }),

  // Test 19: Delete scenario
  test('Delete scenario', async () => {
    if (!globalThis.downsideId) {
      console.log('    (Skipping - no downside scenario created)');
      return;
    }

    const result = await request(`/api/deals/${TEST_DEAL_ID}/scenarios/${globalThis.downsideId}`, {
      method: 'DELETE'
    });

    assert(result.deleted === true, 'Should confirm deletion');
  }),

  // Test 20: List remaining scenarios
  test('List scenarios after deletion', async () => {
    const result = await request(`/api/deals/${TEST_DEAL_ID}/scenarios`);

    assert(Array.isArray(result.scenarios), 'Should return scenarios array');
    console.log(`    Remaining scenarios: ${result.scenarios.length}`);
  })
];

// ==================== Run Tests ====================

async function runTests() {
  console.log('\n========== Phase 5: Underwriting Intelligence Test Suite ==========\n');
  console.log(`Target: ${BASE_URL}`);
  console.log(`Test Deal: ${TEST_DEAL_ID}\n`);

  // Check server first
  try {
    await fetch(`${BASE_URL}/health`);
  } catch (error) {
    console.log('✗ Server is not running. Please start with: npm run bff\n');
    process.exit(1);
  }

  console.log('========== Running Tests ==========\n');

  // Run tests sequentially (order matters for some)
  for (const testFn of tests) {
    await testFn();
  }

  // Summary
  console.log('\n========== Summary ==========');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total:  ${passed + failed}\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});
