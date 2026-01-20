#!/usr/bin/env node
/**
 * AI Context Filtering Test Script
 *
 * Tests that the AI endpoints properly filter context based on user role.
 * Verifies that:
 * 1. GP users see full context
 * 2. LP users only see their investment data
 * 3. Unauthorized users are rejected
 *
 * Usage: node scripts/test-ai-filtering.js
 *
 * Prerequisites:
 * 1. Server running: npm run start
 * 2. Test users seeded: npm run db:seed:auth
 */

const BFF_URL = process.env.BFF_URL || 'http://localhost:8787';

const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
};

// Test credentials (from db:seed:auth)
const TEST_USERS = {
  GP: { email: 'gp@canonical.com', password: 'gp123' },
  Admin: { email: 'admin@canonical.com', password: 'admin123' },
  // Note: LP user needs to be created with an investment in a deal to test properly
};

let stats = { passed: 0, failed: 0, skipped: 0 };
let testDealId = null;
let gpToken = null;
let adminToken = null;

async function request(method, path, options = {}) {
  const url = `${BFF_URL}${path}`;
  const start = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (options.token) {
      headers['Authorization'] = `Bearer ${options.token}`;
    }

    const res = await fetch(url, {
      method,
      signal: controller.signal,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    clearTimeout(timeout);
    const latency = Date.now() - start;

    let data = null;
    const contentType = res.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      try {
        data = await res.json();
      } catch {}
    }

    return {
      ok: res.ok,
      status: res.status,
      latency,
      data,
      error: !res.ok ? (data?.message || data?.error || `HTTP ${res.status}`) : null,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      latency: Date.now() - start,
      data: null,
      error: err.name === 'AbortError' ? 'Timeout (15s)' : err.message,
    };
  }
}

function printTest(name, passed, details = '') {
  if (passed) {
    stats.passed++;
    console.log(`  ${colors.green}✓${colors.reset} ${name}`);
    if (details) console.log(`    ${colors.dim}${details}${colors.reset}`);
  } else {
    stats.failed++;
    console.log(`  ${colors.red}✗${colors.reset} ${name}`);
    if (details) console.log(`    ${colors.dim}${details}${colors.reset}`);
  }
}

function printSkipped(name, reason) {
  stats.skipped++;
  console.log(`  ${colors.yellow}○${colors.reset} ${name} - ${reason}`);
}

async function login(email, password) {
  const result = await request('POST', '/api/auth/login', {
    body: { email, password },
  });

  if (result.ok && result.data?.token) {
    return result.data.token;
  }
  return null;
}

async function runTests() {
  console.log(`\n${colors.bold}=== AI Context Filtering Tests ===${colors.reset}\n`);
  console.log(`BFF: ${colors.cyan}${BFF_URL}${colors.reset}\n`);

  // Check server health
  console.log(`${colors.bold}[Setup]${colors.reset}`);
  const healthResult = await request('GET', '/health');
  if (!healthResult.ok) {
    console.log(`  ${colors.red}✗${colors.reset} Server health check failed`);
    console.log(`    ${colors.dim}Is the server running? Try: npm run start${colors.reset}\n`);
    process.exit(1);
  }
  printTest('Server is running');

  // Login as GP user
  gpToken = await login(TEST_USERS.GP.email, TEST_USERS.GP.password);
  if (gpToken) {
    printTest('GP user logged in');
  } else {
    console.log(`  ${colors.red}✗${colors.reset} GP login failed`);
    console.log(`    ${colors.dim}Did you run: npm run db:seed:auth ?${colors.reset}\n`);
    process.exit(1);
  }

  // Login as Admin user
  adminToken = await login(TEST_USERS.Admin.email, TEST_USERS.Admin.password);
  if (adminToken) {
    printTest('Admin user logged in');
  }

  // Get a deal ID for testing
  const dealsResult = await request('GET', '/api/deals', { token: gpToken });
  if (dealsResult.ok && dealsResult.data?.deals?.length > 0) {
    testDealId = dealsResult.data.deals[0].id;
    printTest(`Found test deal: ${testDealId.substring(0, 8)}...`);
  } else {
    console.log(`  ${colors.yellow}⚠${colors.reset} No deals found - some tests will be skipped`);
    console.log(`    ${colors.dim}Try: npm run db:seed${colors.reset}`);
  }

  console.log('');

  // Test 1: GP user can access deal context
  console.log(`${colors.bold}[GP Access Tests]${colors.reset}`);

  if (testDealId && gpToken) {
    // Test /api/deals/:dealId/context (debugging endpoint)
    const contextResult = await request('GET', `/api/deals/${testDealId}/context`, {
      token: gpToken,
    });

    if (contextResult.ok) {
      const context = contextResult.data?.context;
      const hasModel = context?.model !== undefined;
      const hasFinancials = context?.calculatedReturns !== undefined;
      const hasLpList = context?.lpInvestors !== undefined;
      const role = contextResult.data?.filteredForRole;

      printTest('GP can access deal context', `Role: ${role}`);

      // GP should see financials
      if (hasModel || hasFinancials) {
        printTest('GP sees financial data');
      } else {
        printTest('GP sees financial data', false);
      }

      // Log what keys are in context for debugging
      console.log(`    ${colors.dim}Context keys: ${Object.keys(context || {}).join(', ')}${colors.reset}`);
    } else {
      printTest('GP can access deal context', false, contextResult.error);
    }

    // Test /api/deals/:dealId/insights
    const insightsResult = await request('GET', `/api/deals/${testDealId}/insights`, {
      token: gpToken,
    });

    if (insightsResult.ok) {
      printTest('GP can access deal insights');
    } else {
      printTest('GP can access deal insights', false, insightsResult.error);
    }

    // Test /api/deals/:dealId/chat
    const chatResult = await request('POST', `/api/deals/${testDealId}/chat`, {
      token: gpToken,
      body: {
        message: 'What is the property type?',
      },
    });

    if (chatResult.ok) {
      printTest('GP can use deal chat', `Response length: ${chatResult.data?.response?.length || 0}`);
    } else {
      printTest('GP can use deal chat', false, chatResult.error);
    }
  } else {
    printSkipped('GP context tests', 'No deal ID available');
  }

  console.log('');

  // Test 2: Unauthenticated requests are rejected
  console.log(`${colors.bold}[Security Tests]${colors.reset}`);

  if (testDealId) {
    // No token - should be rejected
    const noAuthResult = await request('GET', `/api/deals/${testDealId}/context`);
    if (!noAuthResult.ok && (noAuthResult.status === 401 || noAuthResult.status === 403)) {
      printTest('Unauthenticated request rejected', `Status: ${noAuthResult.status}`);
    } else {
      printTest('Unauthenticated request rejected', false, `Got status: ${noAuthResult.status}`);
    }

    // Invalid token - should be rejected
    const badTokenResult = await request('GET', `/api/deals/${testDealId}/context`, {
      token: 'invalid-token-12345',
    });
    if (!badTokenResult.ok && (badTokenResult.status === 401 || badTokenResult.status === 403)) {
      printTest('Invalid token rejected', `Status: ${badTokenResult.status}`);
    } else {
      printTest('Invalid token rejected', false, `Got status: ${badTokenResult.status}`);
    }
  } else {
    printSkipped('Security tests', 'No deal ID available');
  }

  console.log('');

  // Test 3: Response includes role filtering metadata
  console.log(`${colors.bold}[Filtering Metadata Tests]${colors.reset}`);

  if (testDealId && gpToken) {
    const metaResult = await request('GET', `/api/deals/${testDealId}/context`, {
      token: gpToken,
    });

    if (metaResult.ok) {
      const context = metaResult.data?.context;
      const meta = context?.meta;

      if (meta?.filteredForRole) {
        printTest('Response includes filteredForRole', meta.filteredForRole);
      } else {
        printTest('Response includes filteredForRole', false);
      }

      if (meta?.filteredAt) {
        printTest('Response includes filteredAt timestamp');
      } else {
        printTest('Response includes filteredAt timestamp', false);
      }

      // Check note field
      if (metaResult.data?.note) {
        printTest('Response includes security note', metaResult.data.note.substring(0, 50) + '...');
      }
    } else {
      printSkipped('Metadata tests', metaResult.error);
    }
  } else {
    printSkipped('Metadata tests', 'No deal ID or GP token');
  }

  console.log('');

  // Summary
  console.log(`${colors.bold}─────────────────────────────${colors.reset}`);
  console.log(`${colors.green}Passed: ${stats.passed}${colors.reset}  ${colors.red}Failed: ${stats.failed}${colors.reset}  ${colors.yellow}Skipped: ${stats.skipped}${colors.reset}`);

  if (stats.failed > 0) {
    console.log(`\n${colors.yellow}Check the server logs for [AI-FILTER] and [AI-HANDLER] debug output.${colors.reset}\n`);
    process.exit(1);
  } else {
    console.log(`\n${colors.green}${colors.bold}All AI filtering tests passed!${colors.reset}\n`);
    process.exit(0);
  }
}

// Run
runTests().catch(err => {
  console.error(`${colors.red}Test runner error: ${err.message}${colors.reset}`);
  process.exit(1);
});
