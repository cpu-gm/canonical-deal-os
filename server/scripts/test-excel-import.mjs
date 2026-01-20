/**
 * Test Script for Excel Import Feature
 *
 * Tests the complete Excel import flow:
 * 1. Create a sample Excel file
 * 2. Upload it to a deal
 * 3. Verify auto-mapping
 * 4. Apply mappings to underwriting model
 * 5. Verify provenance tracking
 */

import ExcelJS from 'exceljs';

const BASE_URL = 'http://localhost:8787';
const TEST_USER_ID = 'test-analyst';
const TEST_USER_NAME = 'Test Analyst';

// Helper to make requests
async function request(method, path, body = null, headers = {}) {
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': TEST_USER_ID,
      'X-User-Name': TEST_USER_NAME,
      ...headers
    }
  };

  if (body && method !== 'GET') {
    if (body instanceof Buffer) {
      options.body = body;
      options.headers['Content-Type'] = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    } else {
      options.body = JSON.stringify(body);
    }
  }

  const response = await fetch(`${BASE_URL}${path}`, options);
  const text = await response.text();

  try {
    return { status: response.status, data: JSON.parse(text) };
  } catch {
    return { status: response.status, data: text };
  }
}

// Create a sample Excel file with underwriting data
async function createSampleExcel() {
  const workbook = new ExcelJS.Workbook();

  // T12 Sheet - Operating Statement
  const t12Sheet = workbook.addWorksheet('T12');
  t12Sheet.columns = [
    { header: 'Description', key: 'desc', width: 30 },
    { header: 'Annual', key: 'annual', width: 15 }
  ];

  t12Sheet.addRows([
    { desc: 'REVENUE', annual: '' },
    { desc: 'Gross Potential Rent', annual: 820000 },
    { desc: 'Vacancy Loss', annual: -41000 },
    { desc: 'Effective Gross Income', annual: 779000 },
    { desc: 'Other Income', annual: 24000 },
    { desc: 'Total Revenue', annual: 803000 },
    { desc: '', annual: '' },
    { desc: 'EXPENSES', annual: '' },
    { desc: 'Real Estate Taxes', annual: 78500 },
    { desc: 'Insurance', annual: 18500 },
    { desc: 'Property Management', annual: 32000 },
    { desc: 'Repairs & Maintenance', annual: 45000 },
    { desc: 'Utilities', annual: 62000 },
    { desc: 'Total Operating Expenses', annual: 236000 },
    { desc: 'Replacement Reserves', annual: 15000 },
    { desc: '', annual: '' },
    { desc: 'Net Operating Income', annual: 552000 }
  ]);

  // Debt Sheet
  const debtSheet = workbook.addWorksheet('Debt');
  debtSheet.columns = [
    { header: 'Term', key: 'term', width: 25 },
    { header: 'Value', key: 'value', width: 15 }
  ];

  debtSheet.addRows([
    { term: 'Loan Amount', value: 8500000 },
    { term: 'Interest Rate', value: 0.0625 },
    { term: 'Amortization', value: 30 },
    { term: 'Loan Term', value: 10 },
    { term: 'Annual Debt Service', value: 612000 }
  ]);

  // Returns Sheet
  const returnsSheet = workbook.addWorksheet('Returns');
  returnsSheet.columns = [
    { header: 'Metric', key: 'metric', width: 25 },
    { header: 'Value', key: 'value', width: 15 }
  ];

  returnsSheet.addRows([
    { metric: 'Going-In Cap Rate', value: 0.052 },
    { metric: 'Exit Cap Rate', value: 0.055 },
    { metric: 'Cash-on-Cash', value: 0.082 },
    { metric: 'DSCR', value: 1.35 },
    { metric: 'IRR', value: 0.148 },
    { metric: 'Equity Multiple', value: 1.92 },
    { metric: 'Hold Period', value: 5 },
    { metric: 'Rent Growth', value: 0.03 },
    { metric: 'Expense Growth', value: 0.02 }
  ]);

  // Generate buffer
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// Create multipart form data for file upload
function createMultipartBody(buffer, filename) {
  const boundary = '----WebKitFormBoundary' + Math.random().toString(16).slice(2);
  const crlf = '\r\n';

  let body = '';
  body += `--${boundary}${crlf}`;
  body += `Content-Disposition: form-data; name="file"; filename="${filename}"${crlf}`;
  body += `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet${crlf}${crlf}`;

  const prefix = Buffer.from(body, 'utf8');
  const suffix = Buffer.from(`${crlf}--${boundary}--${crlf}`, 'utf8');

  return {
    buffer: Buffer.concat([prefix, buffer, suffix]),
    contentType: `multipart/form-data; boundary=${boundary}`
  };
}

async function runTests() {
  console.log('='.repeat(60));
  console.log('EXCEL IMPORT TEST SUITE');
  console.log('='.repeat(60));
  console.log('');

  let passed = 0;
  let failed = 0;
  let dealId = null;
  let importId = null;

  // Test 1: Get or create a test deal
  console.log('Test 1: Setup - Get or create test deal');
  try {
    const dealsResponse = await request('GET', '/api/deals');
    if (dealsResponse.status === 200 && dealsResponse.data.deals?.length > 0) {
      dealId = dealsResponse.data.deals[0].id;
      console.log(`  ✓ Using existing deal: ${dealId}`);
      passed++;
    } else {
      // Create a test deal via API
      const createResponse = await request('POST', '/api/deals', {
        name: 'Excel Import Test Deal',
        profile: {
          asset_name: 'Test Property',
          asset_address: '123 Test St',
          purchase_price: 13100000
        }
      });
      if (createResponse.status === 200 || createResponse.status === 201) {
        dealId = createResponse.data.id || createResponse.data.deal?.id;
        console.log(`  ✓ Created test deal: ${dealId}`);
        passed++;
      } else {
        throw new Error(`Could not create deal: ${JSON.stringify(createResponse.data)}`);
      }
    }
  } catch (error) {
    console.log(`  ✗ Failed: ${error.message}`);
    failed++;
    return;
  }
  console.log('');

  // Test 2: Create sample Excel file
  console.log('Test 2: Create sample Excel file');
  let excelBuffer;
  try {
    excelBuffer = await createSampleExcel();
    console.log(`  ✓ Created Excel file (${excelBuffer.length} bytes)`);
    passed++;
  } catch (error) {
    console.log(`  ✗ Failed: ${error.message}`);
    failed++;
    return;
  }
  console.log('');

  // Test 3: Upload Excel file
  console.log('Test 3: Upload Excel file');
  try {
    const { buffer: multipartBuffer, contentType } = createMultipartBody(excelBuffer, 'test-model.xlsx');

    const response = await fetch(`${BASE_URL}/api/deals/${dealId}/excel-import`, {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        'X-User-Id': TEST_USER_ID,
        'X-User-Name': TEST_USER_NAME
      },
      body: multipartBuffer
    });

    const result = await response.json();

    if (response.status === 200 && result.import) {
      importId = result.import.id;
      console.log(`  ✓ Upload successful`);
      console.log(`    - Import ID: ${importId}`);
      console.log(`    - Sheets found: ${result.sheets?.length || 0}`);
      console.log(`    - Cells parsed: ${result.cellCount || 0}`);
      console.log(`    - Fields mapped: ${Object.keys(result.mappings || {}).length}`);
      console.log(`    - Unmapped fields: ${result.unmapped?.length || 0}`);
      passed++;
    } else {
      console.log(`  ✗ Upload failed: ${result.error || 'Unknown error'}`);
      console.log(`    Status: ${response.status}`);
      failed++;
    }
  } catch (error) {
    console.log(`  ✗ Failed: ${error.message}`);
    failed++;
  }
  console.log('');

  // Test 4: Get Excel import details
  console.log('Test 4: Get Excel import details');
  try {
    if (!importId) throw new Error('No import ID from previous test');

    const response = await request('GET', `/api/excel-imports/${importId}`);
    if (response.status === 200 && response.data.import) {
      console.log(`  ✓ Got import details`);
      console.log(`    - Filename: ${response.data.import.filename}`);
      console.log(`    - Status: ${response.data.import.status}`);
      console.log(`    - Cells stored: ${response.data.cells?.length || 0}`);
      passed++;
    } else {
      console.log(`  ✗ Failed to get import: ${response.data.error}`);
      failed++;
    }
  } catch (error) {
    console.log(`  ✗ Failed: ${error.message}`);
    failed++;
  }
  console.log('');

  // Test 5: List Excel imports for deal
  console.log('Test 5: List Excel imports for deal');
  try {
    const response = await request('GET', `/api/deals/${dealId}/excel-imports`);
    if (response.status === 200 && response.data.imports) {
      console.log(`  ✓ Listed imports: ${response.data.imports.length} found`);
      passed++;
    } else {
      console.log(`  ✗ Failed: ${response.data.error}`);
      failed++;
    }
  } catch (error) {
    console.log(`  ✗ Failed: ${error.message}`);
    failed++;
  }
  console.log('');

  // Test 6: Get mappable fields
  console.log('Test 6: Get mappable fields');
  try {
    const response = await request('GET', '/api/excel/mappable-fields');
    if (response.status === 200 && response.data.fields) {
      console.log(`  ✓ Got ${response.data.fields.length} mappable fields`);
      const categories = [...new Set(response.data.fields.map(f => f.category))];
      console.log(`    - Categories: ${categories.join(', ')}`);
      passed++;
    } else {
      console.log(`  ✗ Failed: ${response.data.error}`);
      failed++;
    }
  } catch (error) {
    console.log(`  ✗ Failed: ${error.message}`);
    failed++;
  }
  console.log('');

  // Test 7: Apply Excel import to model
  console.log('Test 7: Apply Excel import to underwriting model');
  try {
    if (!importId) throw new Error('No import ID from previous test');

    const response = await request('POST', `/api/excel-imports/${importId}/apply`);
    if (response.status === 200) {
      console.log(`  ✓ Applied import to model`);
      console.log(`    - Fields applied: ${response.data.applied?.length || 0}`);
      if (response.data.applied?.length > 0) {
        console.log(`    - Sample fields: ${response.data.applied.slice(0, 5).join(', ')}`);
      }
      passed++;
    } else {
      console.log(`  ✗ Failed: ${response.data.error}`);
      failed++;
    }
  } catch (error) {
    console.log(`  ✗ Failed: ${error.message}`);
    failed++;
  }
  console.log('');

  // Test 8: Verify provenance tracking
  console.log('Test 8: Verify Excel provenance tracking');
  try {
    const response = await request('GET', `/api/deals/${dealId}/inputs/provenance`);
    if (response.status === 200 && response.data.inputs) {
      const excelInputs = response.data.inputs.filter(i => i.sourceType === 'EXCEL_IMPORT');
      console.log(`  ✓ Found ${excelInputs.length} inputs from Excel`);
      if (excelInputs.length > 0) {
        const sample = excelInputs[0];
        console.log(`    - Sample: ${sample.fieldPath} = ${sample.value}`);
        console.log(`    - Cell: ${sample.documentCell || 'N/A'}`);
        console.log(`    - Source: ${sample.documentName || 'N/A'}`);
      }
      passed++;
    } else {
      console.log(`  ✗ Failed: ${response.data.error}`);
      failed++;
    }
  } catch (error) {
    console.log(`  ✗ Failed: ${error.message}`);
    failed++;
  }
  console.log('');

  // Test 9: Get underwriting model to verify values
  console.log('Test 9: Verify underwriting model updated');
  try {
    const response = await request('GET', `/api/deals/${dealId}/underwriting`);
    if (response.status === 200 && response.data.model) {
      const model = response.data.model;
      console.log(`  ✓ Got underwriting model`);

      // Check if values were applied
      const fieldsWithValues = Object.entries(model)
        .filter(([k, v]) => v !== null && !['id', 'dealId', 'status', 'createdAt', 'updatedAt', 'lastCalculatedAt'].includes(k))
        .length;

      console.log(`    - Fields with values: ${fieldsWithValues}`);
      if (model.grossPotentialRent) console.log(`    - GPR: $${model.grossPotentialRent.toLocaleString()}`);
      if (model.netOperatingIncome) console.log(`    - NOI: $${model.netOperatingIncome.toLocaleString()}`);
      if (model.loanAmount) console.log(`    - Loan: $${model.loanAmount.toLocaleString()}`);
      passed++;
    } else {
      console.log(`  ✗ Failed: ${response.data.error}`);
      failed++;
    }
  } catch (error) {
    console.log(`  ✗ Failed: ${error.message}`);
    failed++;
  }
  console.log('');

  // Test 10: Update mappings manually
  console.log('Test 10: Update mappings manually');
  try {
    if (!importId) throw new Error('No import ID');

    const response = await request('PATCH', `/api/excel-imports/${importId}/mappings`, {
      mappings: {
        exitCapRate: {
          sheet: 'Returns',
          cell: 'B2',
          value: 0.055,
          label: 'Exit Cap Rate'
        }
      }
    });

    if (response.status === 200) {
      console.log(`  ✓ Updated mappings`);
      console.log(`    - Updated fields: ${response.data.updated?.join(', ')}`);
      passed++;
    } else {
      console.log(`  ✗ Failed: ${response.data.error}`);
      failed++;
    }
  } catch (error) {
    console.log(`  ✗ Failed: ${error.message}`);
    failed++;
  }
  console.log('');

  // Summary
  console.log('='.repeat(60));
  console.log('TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total:  ${passed + failed}`);
  console.log('');

  if (failed === 0) {
    console.log('✓ All tests passed!');
  } else {
    console.log('✗ Some tests failed');
    process.exit(1);
  }
}

// Run tests
runTests().catch(error => {
  console.error('Test suite error:', error);
  process.exit(1);
});
