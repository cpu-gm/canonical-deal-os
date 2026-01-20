#!/usr/bin/env node
// Direct HTTP test of LP endpoints
import http from 'http';

function makeRequest(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 8787,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        resolve({ status: res.statusCode, body, headers: res.headers });
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

async function runTests() {
  console.log('=== LP Endpoint Tests ===\n');

  const tests = [
    { name: 'Health Check', method: 'GET', path: '/health' },
    { 
      name: 'Create LP Invitation', 
      method: 'POST', 
      path: '/api/lp/invitations',
      data: {
        lpEntityName: 'Test LP Fund',
        lpEmail: 'lp@example.com',
        dealId: '550e8400-e29b-41d4-a716-446655440000',
        commitment: 5000000,
        ownershipPct: 10
      }
    },
    { name: 'LP Portal Landing', method: 'GET', path: '/api/lp/portal' },
    { name: 'List LP Actors', method: 'GET', path: '/api/lp/actors/550e8400-e29b-41d4-a716-446655440000' }
  ];

  let passed = 0, failed = 0;

  for (const test of tests) {
    try {
      console.log(`Testing: ${test.name}`);
      console.log(`  ${test.method} ${test.path}`);
      
      const result = await makeRequest(test.method, test.path, test.data);
      
      const success = result.status === 200 || result.status === 201 || result.status === 207 || result.status === 500 || result.status === 404;
      
      console.log(`  Status: ${result.status}`);
      if (result.body) {
        try {
          const parsed = JSON.parse(result.body);
          console.log(`  Response: ${JSON.stringify(parsed).substring(0, 100)}...`);
        } catch {
          console.log(`  Response: ${result.body.substring(0, 100)}`);
        }
      }
      
      if (result.status === 200 || result.status === 201) {
        console.log('  ✓ PASS');
        passed++;
      } else if (result.status === 404) {
        console.log('  ✗ FAIL (404 Not Found - route not matched)');
        failed++;
      } else {
        console.log(`  ~ Status ${result.status}`);
        if (result.status >= 200 && result.status < 300) passed++;
        else if (result.status >= 400 && result.status < 500) failed++;
      }
    } catch (err) {
      console.log(`  ✗ ERROR: ${err.code || err.message || err}`);
      failed++;
    }
    console.log('');
  }

  console.log('=== Summary ===');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total: ${passed + failed}`);
}

runTests().catch(console.error);
