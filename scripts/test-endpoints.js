#!/usr/bin/env node
/**
 * Endpoint Smoke Test Suite
 *
 * Tests all critical BFF endpoints and reports status.
 * Usage: npm run test:endpoints
 */

const BFF_URL = process.env.BFF_URL || 'http://localhost:8787';
const KERNEL_URL = process.env.KERNEL_URL || 'http://localhost:3001';

const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
};

// Test state
let testDealId = null;
let stats = { passed: 0, failed: 0, skipped: 0 };
let failures = [];

// Endpoint definitions grouped by feature
const endpointGroups = [
  {
    name: 'Health',
    endpoints: [
      { method: 'GET', path: '/health', baseUrl: BFF_URL, critical: true },
      { method: 'GET', path: '/health', baseUrl: KERNEL_URL, critical: true, name: 'Kernel Health' },
    ]
  },
  {
    name: 'Deals',
    endpoints: [
      { method: 'GET', path: '/api/deals', critical: true },
      { method: 'GET', path: '/api/deals/{dealId}/home', critical: true, needsDeal: true },
      { method: 'GET', path: '/api/deals/{dealId}/records', critical: true, needsDeal: true },
    ]
  },
  {
    name: 'Deal State',
    endpoints: [
      { method: 'GET', path: '/api/deals/{dealId}/state', needsDeal: true },
      { method: 'GET', path: '/api/deals/{dealId}/state/blockers', needsDeal: true },
      { method: 'GET', path: '/api/deals/{dealId}/state/available-transitions', needsDeal: true },
      { method: 'GET', path: '/api/deals/{dealId}/state/events', needsDeal: true },
    ]
  },
  {
    name: 'Home & Activity',
    endpoints: [
      { method: 'GET', path: '/api/home', critical: true },
      { method: 'GET', path: '/api/activity-feed?limit=5' },
      { method: 'GET', path: '/api/inbox' },
    ]
  },
  {
    name: 'Chat',
    endpoints: [
      { method: 'GET', path: '/api/chat/conversations' },
    ]
  },
  {
    name: 'Review & Verification',
    endpoints: [
      { method: 'GET', path: '/api/review-requests?status=pending' },
      { method: 'GET', path: '/api/deals/{dealId}/verification-queue', needsDeal: true },
    ]
  },
  {
    name: 'Documents',
    endpoints: [
      { method: 'GET', path: '/api/deals/{dealId}/documents', needsDeal: true },
    ]
  },
  {
    name: 'Data Trust',
    endpoints: [
      { method: 'GET', path: '/api/deals/{dealId}/data-trust', needsDeal: true },
    ]
  },
];

async function request(method, path, options = {}) {
  const baseUrl = options.baseUrl || BFF_URL;
  const url = `${baseUrl}${path}`;
  const start = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(url, {
      method,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-actor-id': 'test-runner',
        ...options.headers,
      },
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
      error: err.name === 'AbortError' ? 'Timeout (10s)' : err.message,
    };
  }
}

function printResult(endpoint, result) {
  const method = endpoint.method.padEnd(4);
  const path = endpoint.name || endpoint.path;

  if (result.ok) {
    stats.passed++;
    console.log(`  ${colors.green}✓${colors.reset} ${method} ${path} ${colors.dim}${result.latency}ms${colors.reset}`);
  } else if (result.skipped) {
    stats.skipped++;
    console.log(`  ${colors.yellow}○${colors.reset} ${method} ${path} ${colors.dim}(skipped - no deal)${colors.reset}`);
  } else {
    stats.failed++;
    failures.push({ endpoint, result });
    console.log(`  ${colors.red}✗${colors.reset} ${method} ${path} ${colors.red}${result.status || 'ERR'}${colors.reset}`);
    console.log(`    ${colors.dim}└─${colors.reset} ${result.error}`);
  }
}

async function runTests() {
  console.log(`\n${colors.bold}=== Endpoint Smoke Tests ===${colors.reset}\n`);
  console.log(`BFF:    ${colors.cyan}${BFF_URL}${colors.reset}`);
  console.log(`Kernel: ${colors.cyan}${KERNEL_URL}${colors.reset}\n`);

  // First, get a deal ID to use for deal-specific endpoints
  const dealsResult = await request('GET', '/api/deals');
  if (dealsResult.ok && dealsResult.data?.deals?.length > 0) {
    testDealId = dealsResult.data.deals[0].id;
    console.log(`${colors.dim}Using deal: ${testDealId}${colors.reset}\n`);
  } else {
    console.log(`${colors.yellow}⚠ No deals found - deal-specific endpoints will be skipped${colors.reset}\n`);
  }

  // Run tests by group
  for (const group of endpointGroups) {
    console.log(`${colors.bold}[${group.name}]${colors.reset}`);

    for (const endpoint of group.endpoints) {
      // Skip deal-specific endpoints if no deal
      if (endpoint.needsDeal && !testDealId) {
        printResult(endpoint, { skipped: true });
        continue;
      }

      // Replace {dealId} placeholder
      let path = endpoint.path;
      if (endpoint.needsDeal) {
        path = path.replace('{dealId}', testDealId);
      }

      const result = await request(endpoint.method, path, {
        baseUrl: endpoint.baseUrl,
      });

      printResult(endpoint, result);
    }

    console.log('');
  }

  // Summary
  console.log(`${colors.bold}─────────────────────────────${colors.reset}`);
  console.log(`${colors.green}Passed: ${stats.passed}${colors.reset}  ${colors.red}Failed: ${stats.failed}${colors.reset}  ${colors.yellow}Skipped: ${stats.skipped}${colors.reset}`);

  if (failures.length > 0) {
    console.log(`\n${colors.bold}${colors.red}Failed Endpoints:${colors.reset}`);
    for (const { endpoint, result } of failures) {
      const isCritical = endpoint.critical ? `${colors.red}[CRITICAL]${colors.reset} ` : '';
      console.log(`  ${isCritical}${endpoint.method} ${endpoint.path}`);
      console.log(`    ${colors.dim}Error: ${result.error}${colors.reset}`);
    }
    console.log('');
  }

  // Exit code
  const hasCriticalFailure = failures.some(f => f.endpoint.critical);
  if (hasCriticalFailure) {
    console.log(`${colors.red}${colors.bold}Critical endpoints failed!${colors.reset}\n`);
    process.exit(1);
  } else if (stats.failed > 0) {
    console.log(`${colors.yellow}Some non-critical endpoints failed.${colors.reset}\n`);
    process.exit(0);
  } else {
    console.log(`${colors.green}${colors.bold}All endpoints healthy!${colors.reset}\n`);
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error(`${colors.red}Test runner error: ${err.message}${colors.reset}`);
  process.exit(1);
});
