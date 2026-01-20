#!/usr/bin/env node
/**
 * Start All Services Script
 * Usage: node scripts/start-all.js
 *
 * Starts: Kernel API, BFF Server, Vite Dev Server
 * Monitors health and restarts if needed
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const kernelRoot = join(projectRoot, '..', 'cre-kernel-phase1');

const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
};

const services = [
  {
    name: 'Kernel',
    color: colors.cyan,
    cwd: kernelRoot,
    cmd: 'npm',
    args: ['run', 'dev:api'],
    healthUrl: 'http://localhost:3001/health',
    readyPattern: /listening|started|ready/i,
  },
  {
    name: 'BFF',
    color: colors.yellow,
    cwd: projectRoot,
    cmd: 'node',
    args: ['server/index.js'],
    healthUrl: 'http://localhost:8787/health',
    readyPattern: /listening|started/i,
  },
  {
    name: 'Vite',
    color: colors.green,
    cwd: projectRoot,
    cmd: 'npm',
    args: ['run', 'dev'],
    healthUrl: 'http://localhost:5173',
    readyPattern: /ready|localhost:5173/i,
  },
];

const processes = new Map();

function log(service, msg, isError = false) {
  const prefix = `${service.color}[${service.name}]${colors.reset}`;
  const lines = msg.toString().split('\n').filter(l => l.trim());
  for (const line of lines) {
    if (isError) {
      console.error(`${prefix} ${colors.red}${line}${colors.reset}`);
    } else {
      console.log(`${prefix} ${line}`);
    }
  }
}

async function checkHealth(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForReady(service, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await checkHealth(service.healthUrl)) {
      return true;
    }
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

function startService(service) {
  return new Promise((resolve) => {
    console.log(`${colors.dim}Starting ${service.name}...${colors.reset}`);

    const isWindows = process.platform === 'win32';
    const proc = spawn(service.cmd, service.args, {
      cwd: service.cwd,
      shell: isWindows,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '1' },
    });

    processes.set(service.name, proc);

    let ready = false;

    proc.stdout.on('data', (data) => {
      log(service, data);
      if (!ready && service.readyPattern.test(data.toString())) {
        ready = true;
        resolve(true);
      }
    });

    proc.stderr.on('data', (data) => {
      // Filter out noise
      const str = data.toString();
      if (!str.includes('ExperimentalWarning') && !str.includes('punycode')) {
        log(service, data, true);
      }
    });

    proc.on('error', (err) => {
      console.error(`${colors.red}Failed to start ${service.name}: ${err.message}${colors.reset}`);
      resolve(false);
    });

    proc.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.error(`${colors.red}${service.name} exited with code ${code}${colors.reset}`);
      }
      processes.delete(service.name);
    });

    // Fallback: resolve after timeout if ready pattern not matched
    setTimeout(() => {
      if (!ready) {
        resolve(true);
      }
    }, 10000);
  });
}

async function healthMonitor() {
  while (true) {
    await new Promise(r => setTimeout(r, 30000)); // Check every 30s

    for (const service of services) {
      const healthy = await checkHealth(service.healthUrl);
      if (!healthy && !processes.has(service.name)) {
        console.log(`\n${colors.yellow}${service.name} appears down, restarting...${colors.reset}`);
        await startService(service);
      }
    }
  }
}

function shutdown() {
  console.log(`\n${colors.dim}Shutting down...${colors.reset}`);
  for (const [name, proc] of processes) {
    console.log(`  Stopping ${name}...`);
    proc.kill('SIGTERM');
  }
  process.exit(0);
}

async function main() {
  console.log(`\n${colors.bold}=== Canonical Deal OS - Starting All Services ===${colors.reset}\n`);

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Start services sequentially (Kernel -> BFF -> Vite)
  for (const service of services) {
    const started = await startService(service);
    if (!started) {
      console.error(`${colors.red}Failed to start ${service.name}${colors.reset}`);
    }

    // Wait for health check to pass
    const ready = await waitForReady(service);
    if (ready) {
      console.log(`${colors.green}✓ ${service.name} is ready${colors.reset}\n`);
    } else {
      console.log(`${colors.yellow}⚠ ${service.name} health check pending${colors.reset}\n`);
    }
  }

  console.log(`${colors.bold}${colors.green}All services started!${colors.reset}`);
  console.log(`\n  Frontend: ${colors.cyan}http://localhost:5173${colors.reset}`);
  console.log(`  BFF API:  ${colors.cyan}http://localhost:8787${colors.reset}`);
  console.log(`  Kernel:   ${colors.cyan}http://localhost:3001${colors.reset}`);
  console.log(`\n${colors.dim}Press Ctrl+C to stop all services${colors.reset}\n`);

  // Start background health monitor
  healthMonitor();
}

main();
