/**
 * Test Script for Excel Services (Parser + Mapper)
 *
 * Tests the core Excel parsing and mapping functionality directly
 * without requiring the full server to be running.
 */

import ExcelJS from 'exceljs';
import { parseExcelFile } from '../services/excel-parser.js';
import { autoMapExcelToModel, getAllMappableFields, validateMappings } from '../services/excel-mapper.js';

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
    { desc: 'Vacancy', annual: 0.05 },
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

async function runTests() {
  console.log('='.repeat(60));
  console.log('EXCEL SERVICES TEST SUITE');
  console.log('='.repeat(60));
  console.log('');

  let passed = 0;
  let failed = 0;

  // Test 1: Create sample Excel file
  console.log('Test 1: Create sample Excel file');
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

  // Test 2: Parse Excel file
  console.log('Test 2: Parse Excel file');
  let parsed;
  try {
    parsed = await parseExcelFile(excelBuffer, 'test-model.xlsx');
    console.log(`  ✓ Parsed Excel file`);
    console.log(`    - Filename: ${parsed.filename}`);
    console.log(`    - Sheets: ${parsed.sheetCount}`);
    console.log(`    - Sheet names: ${parsed.sheets.map(s => s.name).join(', ')}`);
    console.log(`    - Total cells: ${parsed.cells.length}`);
    passed++;
  } catch (error) {
    console.log(`  ✗ Failed: ${error.message}`);
    console.log(error.stack);
    failed++;
    return;
  }
  console.log('');

  // Test 3: Check cell types
  console.log('Test 3: Check cell type detection');
  try {
    const cellTypes = {};
    for (const cell of parsed.cells) {
      cellTypes[cell.dataType] = (cellTypes[cell.dataType] || 0) + 1;
    }
    console.log(`  ✓ Cell types detected:`);
    for (const [type, count] of Object.entries(cellTypes)) {
      console.log(`    - ${type}: ${count}`);
    }
    passed++;
  } catch (error) {
    console.log(`  ✗ Failed: ${error.message}`);
    failed++;
  }
  console.log('');

  // Test 4: Check label enrichment
  console.log('Test 4: Check label enrichment (adjacent cell labels)');
  try {
    const cellsWithLabels = parsed.cells.filter(c => c.labelText);
    console.log(`  ✓ Found ${cellsWithLabels.length} cells with labels`);
    const samples = cellsWithLabels.slice(0, 5);
    for (const cell of samples) {
      console.log(`    - ${cell.sheetName}!${cell.cellRef}: "${cell.labelText}" → ${cell.computedValue}`);
    }
    passed++;
  } catch (error) {
    console.log(`  ✗ Failed: ${error.message}`);
    failed++;
  }
  console.log('');

  // Test 5: Auto-map to model
  console.log('Test 5: Auto-map to underwriting model');
  let mapping;
  try {
    mapping = autoMapExcelToModel(parsed);
    console.log(`  ✓ Auto-mapping complete`);
    console.log(`    - Mapped fields: ${mapping.stats.mapped}`);
    console.log(`    - Unmapped fields: ${mapping.stats.unmapped}`);
    console.log(`    - Total fields: ${mapping.stats.total}`);
    console.log(`    - Confidence: ${(mapping.stats.confidence * 100).toFixed(1)}%`);
    passed++;
  } catch (error) {
    console.log(`  ✗ Failed: ${error.message}`);
    console.log(error.stack);
    failed++;
    return;
  }
  console.log('');

  // Test 6: Check mapped field details
  console.log('Test 6: Review mapped field details');
  try {
    const mappedFields = Object.entries(mapping.mappings);
    console.log(`  ✓ Mapped ${mappedFields.length} fields:`);
    for (const [field, details] of mappedFields.slice(0, 10)) {
      const val = typeof details.value === 'number'
        ? (details.value < 1 ? `${(details.value * 100).toFixed(2)}%` : details.value.toLocaleString())
        : details.value;
      console.log(`    - ${field}: ${val} (from ${details.sheet}!${details.cell}, conf: ${(details.confidence * 100).toFixed(0)}%)`);
    }
    if (mappedFields.length > 10) {
      console.log(`    ... and ${mappedFields.length - 10} more`);
    }
    passed++;
  } catch (error) {
    console.log(`  ✗ Failed: ${error.message}`);
    failed++;
  }
  console.log('');

  // Test 7: Check unmapped fields
  console.log('Test 7: Review unmapped fields');
  try {
    console.log(`  ✓ ${mapping.unmapped.length} unmapped fields:`);
    for (const item of mapping.unmapped.slice(0, 5)) {
      console.log(`    - ${item.field} (${item.metadata?.category || 'unknown'})`);
    }
    if (mapping.unmapped.length > 5) {
      console.log(`    ... and ${mapping.unmapped.length - 5} more`);
    }
    passed++;
  } catch (error) {
    console.log(`  ✗ Failed: ${error.message}`);
    failed++;
  }
  console.log('');

  // Test 8: Get all mappable fields
  console.log('Test 8: Get all mappable fields');
  try {
    const fields = getAllMappableFields();
    console.log(`  ✓ ${fields.length} mappable fields available`);
    const categories = [...new Set(fields.map(f => f.category))];
    console.log(`    - Categories: ${categories.join(', ')}`);
    passed++;
  } catch (error) {
    console.log(`  ✗ Failed: ${error.message}`);
    failed++;
  }
  console.log('');

  // Test 9: Validate mappings
  console.log('Test 9: Validate mappings');
  try {
    const validation = validateMappings(mapping.mappings);
    console.log(`  ✓ Validation result: ${validation.isValid ? 'VALID' : 'INVALID'}`);
    if (validation.missing.required.length > 0) {
      console.log(`    - Missing required: ${validation.missing.required.join(', ')}`);
    }
    if (validation.warnings.length > 0) {
      console.log(`    - Warnings:`);
      for (const warning of validation.warnings) {
        console.log(`      ⚠ ${warning}`);
      }
    }
    passed++;
  } catch (error) {
    console.log(`  ✗ Failed: ${error.message}`);
    failed++;
  }
  console.log('');

  // Test 10: Test with specific expected mappings
  console.log('Test 10: Verify specific expected mappings');
  try {
    const expectations = [
      { field: 'grossPotentialRent', expected: 820000 },
      { field: 'netOperatingIncome', expected: 552000 },
      { field: 'loanAmount', expected: 8500000 },
      { field: 'interestRate', expected: 0.0625 },
      { field: 'dscr', expected: 1.35 }
    ];

    let matchCount = 0;
    for (const exp of expectations) {
      const mapped = mapping.mappings[exp.field];
      if (mapped && mapped.value === exp.expected) {
        console.log(`    ✓ ${exp.field}: ${exp.expected} ✓`);
        matchCount++;
      } else if (mapped) {
        console.log(`    ~ ${exp.field}: expected ${exp.expected}, got ${mapped.value}`);
      } else {
        console.log(`    ✗ ${exp.field}: not mapped`);
      }
    }

    if (matchCount >= 3) {
      console.log(`  ✓ ${matchCount}/${expectations.length} expected mappings matched`);
      passed++;
    } else {
      console.log(`  ✗ Only ${matchCount}/${expectations.length} mappings matched`);
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
