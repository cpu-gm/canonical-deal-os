#!/usr/bin/env node
/**
 * Health Check Script - Run this anytime to check server status
 * Usage: node scripts/health.js
 */

const services = [
  { name: 'Kernel API', url: 'http://localhost:3001/health', required: true },
  { name: 'BFF Server', url: 'http://localhost:8787/health', required: true },
  { name: 'Vite Dev', url: 'http://localhost:5173', required: true },
];

const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
};

async function checkService(service) {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const res = await fetch(service.url, { signal: controller.signal });
    clearTimeout(timeout);

    const latency = Date.now() - start;

    if (res.ok) {
      let details = '';
      if (service.url.includes('/health')) {
        try {
          const data = await res.json();
          if (data.kernelStatus) details = ` (kernel: ${data.kernelStatus})`;
        } catch {}
      }
      return { ...service, status: 'UP', latency, details };
    } else {
      return { ...service, status: 'ERROR', code: res.status, latency };
    }
  } catch (err) {
    return {
      ...service,
      status: 'DOWN',
      error: err.name === 'AbortError' ? 'Timeout' : err.code || err.message
    };
  }
}

async function main() {
  console.log(`\n${colors.bold}=== Canonical Deal OS - Health Check ===${colors.reset}\n`);
  console.log(`Timestamp: ${new Date().toLocaleString()}\n`);

  const results = await Promise.all(services.map(checkService));

  let allUp = true;

  for (const r of results) {
    let icon, color;
    if (r.status === 'UP') {
      icon = '✓';
      color = colors.green;
    } else if (r.status === 'ERROR') {
      icon = '⚠';
      color = colors.yellow;
      allUp = false;
    } else {
      icon = '✗';
      color = colors.red;
      allUp = false;
    }

    let line = `${color}${icon} ${r.name}${colors.reset}`;

    if (r.status === 'UP') {
      line += ` - ${r.latency}ms${r.details || ''}`;
    } else if (r.status === 'ERROR') {
      line += ` - HTTP ${r.code}`;
    } else {
      line += ` - ${r.error}`;
    }

    console.log(`  ${line}`);
  }

  console.log('');

  if (!allUp) {
    console.log(`${colors.yellow}${colors.bold}Some services are down. Run:${colors.reset}`);
    console.log(`  node scripts/start-all.js\n`);
    process.exit(1);
  } else {
    console.log(`${colors.green}${colors.bold}All services healthy!${colors.reset}\n`);
  }
}

main();
