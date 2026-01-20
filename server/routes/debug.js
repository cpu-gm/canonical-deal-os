/**
 * Debug Routes
 *
 * Provides debugging endpoints for development.
 * Only enabled in non-production environments.
 */

import { getRecentErrors, getRequestStats, clearStats } from '../middleware/request-logger.js';

const KERNEL_URL = process.env.KERNEL_API_URL || 'http://localhost:3001';

/**
 * Check health of a service
 */
async function checkServiceHealth(url, name) {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    return {
      name,
      status: res.ok ? 'up' : 'degraded',
      statusCode: res.status,
      latency: Date.now() - start,
    };
  } catch (error) {
    return {
      name,
      status: 'down',
      error: error.name === 'AbortError' ? 'Timeout' : error.message,
      latency: Date.now() - start,
    };
  }
}

/**
 * GET /api/debug/status
 *
 * Returns comprehensive system status including:
 * - Service health (kernel, database)
 * - Recent errors
 * - Request statistics
 */
export async function handleDebugStatus(req, res) {
  // Only allow in development
  if (process.env.NODE_ENV === 'production') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Not found' }));
    return;
  }

  const [kernelHealth] = await Promise.all([
    checkServiceHealth(`${KERNEL_URL}/health`, 'Kernel API'),
  ]);

  const stats = getRequestStats();
  const recentErrors = getRecentErrors(10);

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    services: {
      kernel: kernelHealth,
      bff: { name: 'BFF Server', status: 'up', latency: 0 },
    },
    requests: {
      total: stats.total,
      successful: stats.successful,
      failed: stats.failed,
      successRate: stats.successRate,
    },
    topEndpoints: stats.topPaths,
    recentErrors: recentErrors.map(e => ({
      timestamp: e.timestamp,
      method: e.method,
      path: e.path,
      status: e.status,
      message: e.message,
    })),
  }, null, 2));
}

/**
 * GET /api/debug/errors
 *
 * Returns list of recent errors with full details
 */
export async function handleDebugErrors(req, res) {
  if (process.env.NODE_ENV === 'production') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Not found' }));
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const limit = parseInt(url.searchParams.get('limit') || '50', 10);

  const errors = getRecentErrors(limit);

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    count: errors.length,
    errors,
  }, null, 2));
}

/**
 * POST /api/debug/clear
 *
 * Clears all stats and error history
 */
export async function handleDebugClear(req, res) {
  if (process.env.NODE_ENV === 'production') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Not found' }));
    return;
  }

  clearStats();

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ message: 'Stats cleared' }));
}

/**
 * GET /api/debug/endpoints
 *
 * Lists all registered endpoints (useful for documentation)
 */
export async function handleDebugEndpoints(req, res) {
  if (process.env.NODE_ENV === 'production') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Not found' }));
    return;
  }

  // This would need to be populated by the main server
  // For now, return a helpful message
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    message: 'Run npm run test:endpoints to see all endpoints',
    docsUrl: '/api/debug/status for system status',
  }));
}
