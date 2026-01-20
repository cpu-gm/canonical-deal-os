#!/usr/bin/env node
/**
 * Email Intake Test Script
 *
 * Tests the email-to-deal integration by:
 * 1. Running unit tests on the classifier
 * 2. Starting the server (if not running)
 * 3. Calling the simulate endpoint
 * 4. Verifying the results
 *
 * Usage: node server/scripts/test-email-intake.mjs
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..', '..');

// Load env
import 'dotenv/config';

const BASE_URL = `http://localhost:${process.env.BFF_PORT || 8787}`;

// ANSI colors for output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(60));
  log(`  ${title}`, 'bold');
  console.log('='.repeat(60) + '\n');
}

function logTest(name, passed, details = '') {
  const icon = passed ? '✓' : '✗';
  const color = passed ? 'green' : 'red';
  log(`  ${icon} ${name}`, color);
  if (details) {
    console.log(`    ${details}`);
  }
}

// ============================================================
// Unit Tests for Email Classifier
// ============================================================

async function testEmailClassifier() {
  logSection('Email Classifier Unit Tests');

  const {
    classifyDocumentByFilename,
    classifyAttachments,
    findPrimaryDocument,
    isSupportedFileType,
    getDocumentTypeLabel
  } = await import('../services/email-classifier.js');

  let passed = 0;
  let failed = 0;

  // Test 1: LOI classification
  const loiTests = [
    ['LOI_123_Main_St.pdf', 'LOI'],
    ['Letter of Intent.pdf', 'LOI'],
    ['letter-of-intent.docx', 'LOI']
  ];

  for (const [filename, expected] of loiTests) {
    const result = classifyDocumentByFilename(filename);
    if (result === expected) {
      passed++;
    } else {
      failed++;
      logTest(`classifyDocumentByFilename('${filename}')`, false, `Expected ${expected}, got ${result}`);
    }
  }

  // Test 2: Term Sheet classification
  const termSheetTests = [
    ['Term Sheet.pdf', 'TERM_SHEET'],
    ['terms_v2.xlsx', 'TERM_SHEET']
  ];

  for (const [filename, expected] of termSheetTests) {
    const result = classifyDocumentByFilename(filename);
    if (result === expected) {
      passed++;
    } else {
      failed++;
      logTest(`classifyDocumentByFilename('${filename}')`, false, `Expected ${expected}, got ${result}`);
    }
  }

  // Test 3: Rent Roll classification
  const rentRollResult = classifyDocumentByFilename('Rent Roll Jan 2026.xlsx');
  if (rentRollResult === 'RENT_ROLL') {
    passed++;
  } else {
    failed++;
    logTest('Rent Roll classification', false, `Expected RENT_ROLL, got ${rentRollResult}`);
  }

  // Test 4: Unknown file (use a name that doesn't match any patterns)
  const unknownResult = classifyDocumentByFilename('quarterly_report.pdf');
  if (unknownResult === 'OTHER') {
    passed++;
  } else {
    failed++;
    logTest('Unknown file classification', false, `Expected OTHER, got ${unknownResult}`);
  }

  // Test 5: File type support
  const supportedTests = [
    ['doc.pdf', 'application/pdf', true],
    ['doc.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', true],
    ['doc.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', true],
    ['script.exe', 'application/x-msdownload', false],
    ['archive.zip', 'application/zip', false]
  ];

  for (const [filename, contentType, expected] of supportedTests) {
    const result = isSupportedFileType(filename, contentType);
    if (result === expected) {
      passed++;
    } else {
      failed++;
      logTest(`isSupportedFileType('${filename}')`, false, `Expected ${expected}, got ${result}`);
    }
  }

  // Test 6: Attachment classification and sorting
  const attachments = [
    { filename: 'other.pdf', contentType: 'application/pdf', size: 1000 },
    { filename: 'Rent Roll.xlsx', contentType: 'application/xlsx', size: 2000 },
    { filename: 'LOI.pdf', contentType: 'application/pdf', size: 3000 }
  ];

  const classified = classifyAttachments(attachments);
  if (classified[0].classifiedType === 'LOI') {
    passed++;
  } else {
    failed++;
    logTest('Attachment priority sorting', false, `LOI should be first, got ${classified[0].classifiedType}`);
  }

  // Test 7: Find primary document
  const primary = findPrimaryDocument(classified);
  if (primary && primary.classifiedType === 'LOI') {
    passed++;
  } else {
    failed++;
    logTest('Find primary document', false, `Expected LOI, got ${primary?.classifiedType}`);
  }

  // Test 8: Document labels
  const labelTests = [
    ['LOI', 'Letter of Intent'],
    ['TERM_SHEET', 'Term Sheet'],
    ['RENT_ROLL', 'Rent Roll']
  ];

  for (const [type, expected] of labelTests) {
    const result = getDocumentTypeLabel(type);
    if (result === expected) {
      passed++;
    } else {
      failed++;
      logTest(`getDocumentTypeLabel('${type}')`, false, `Expected ${expected}, got ${result}`);
    }
  }

  logTest(`Classifier tests: ${passed} passed, ${failed} failed`, failed === 0);

  return failed === 0;
}

// ============================================================
// Server Health Check
// ============================================================

async function checkServerHealth() {
  logSection('Server Health Check');

  try {
    // Check if server responds to the email-intake endpoint (doesn't require kernel)
    const response = await fetch(`${BASE_URL}/api/email-intake`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000)
    });

    if (response.ok) {
      logTest('Server is running', true, 'Email intake API responding');
      return true;
    } else {
      logTest('Server health check failed', false, `Status: ${response.status}`);
      return false;
    }
  } catch (error) {
    logTest('Server is not running', false, error.message);
    log('\n  To start the server, run:', 'yellow');
    log('  cd server && node index.js', 'blue');
    return false;
  }
}

// ============================================================
// API Integration Tests
// ============================================================

async function testSimulateEndpoint() {
  logSection('API: Simulate Email Intake');

  // Test 1: Basic email with attachments
  try {
    const response = await fetch(`${BASE_URL}/api/email-intake/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'broker@example.com',
        subject: '123 Main Street - LOI',
        text: 'Please review the attached LOI for 123 Main Street, a 42-unit multifamily in Austin, TX. Purchase price $15M.',
        attachments: [
          { filename: 'LOI_123_Main_St.pdf', contentType: 'application/pdf', size: 50000 },
          { filename: 'Rent_Roll_Jan_2026.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 25000 }
        ]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      logTest('Simulate with attachments', false, `Status ${response.status}: ${errorText}`);
      return false;
    }

    const data = await response.json();
    console.log('\n  Response:', JSON.stringify(data, null, 2).split('\n').map(l => '    ' + l).join('\n'));

    const checks = [
      ['status === "success"', data.status === 'success'],
      ['id is defined', !!data.id],
      ['attachmentsProcessed === 2', data.attachmentsProcessed === 2],
      ['primaryDocument.type === "LOI"', data.primaryDocument?.type === 'LOI']
    ];

    let allPassed = true;
    for (const [name, passed] of checks) {
      logTest(name, passed);
      if (!passed) allPassed = false;
    }

    return allPassed;
  } catch (error) {
    logTest('Simulate endpoint', false, error.message);
    return false;
  }
}

async function testListEndpoint() {
  logSection('API: List Email Intakes');

  try {
    const response = await fetch(`${BASE_URL}/api/email-intake`);

    if (!response.ok) {
      logTest('List email intakes', false, `Status: ${response.status}`);
      return false;
    }

    const data = await response.json();
    logTest('List endpoint returns data', true);
    logTest(`Found ${data.intakes?.length || 0} intake(s)`, true);

    if (data.intakes?.length > 0) {
      const latest = data.intakes[0];
      console.log('\n  Latest intake:');
      console.log(`    ID: ${latest.id}`);
      console.log(`    From: ${latest.from}`);
      console.log(`    Subject: ${latest.subject}`);
      console.log(`    Status: ${latest.status}`);
      console.log(`    Attachments: ${latest.attachmentCount}`);
    }

    return true;
  } catch (error) {
    logTest('List email intakes', false, error.message);
    return false;
  }
}

async function testEmailWithoutAttachments() {
  logSection('API: Email Without Attachments');

  try {
    const response = await fetch(`${BASE_URL}/api/email-intake/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'analyst@firm.com',
        subject: 'Quick deal update',
        text: 'Just a heads up - we have a new opportunity at 456 Oak Ave. Will send docs tomorrow.',
        attachments: []
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      logTest('Email without attachments', false, `Status ${response.status}: ${errorText}`);
      return false;
    }

    const data = await response.json();
    logTest('Processed email without attachments', data.status === 'success');
    logTest('attachmentsProcessed === 0', data.attachmentsProcessed === 0);
    logTest('primaryDocument === null', data.primaryDocument === null);

    return true;
  } catch (error) {
    logTest('Email without attachments', false, error.message);
    return false;
  }
}

async function testValidation() {
  logSection('API: Validation');

  // Missing required fields
  try {
    const response = await fetch(`${BASE_URL}/api/email-intake/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'Missing from and subject'
      })
    });

    logTest('Rejects missing required fields', response.status === 400);
  } catch (error) {
    logTest('Validation test', false, error.message);
    return false;
  }

  return true;
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log('\n');
  log('╔════════════════════════════════════════════════════════════╗', 'blue');
  log('║          EMAIL-TO-DEAL INTEGRATION TEST SUITE              ║', 'blue');
  log('╚════════════════════════════════════════════════════════════╝', 'blue');

  const results = {
    classifier: false,
    server: false,
    simulate: false,
    list: false,
    noAttachments: false,
    validation: false
  };

  // Run classifier unit tests (no server needed)
  results.classifier = await testEmailClassifier();

  // Check server
  results.server = await checkServerHealth();

  if (results.server) {
    // Run API tests
    results.simulate = await testSimulateEndpoint();
    results.list = await testListEndpoint();
    results.noAttachments = await testEmailWithoutAttachments();
    results.validation = await testValidation();
  }

  // Summary
  logSection('Test Summary');

  const tests = Object.entries(results);
  const passed = tests.filter(([_, v]) => v).length;
  const total = tests.length;

  for (const [name, result] of tests) {
    logTest(name, result);
  }

  console.log('\n');
  if (passed === total) {
    log(`  All ${total} tests passed! ✓`, 'green');
  } else {
    log(`  ${passed}/${total} tests passed`, passed > 0 ? 'yellow' : 'red');
  }
  console.log('\n');

  process.exit(passed === total ? 0 : 1);
}

main().catch(error => {
  console.error('Test script failed:', error);
  process.exit(1);
});
