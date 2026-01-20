/**
 * Request Logger Middleware
 *
 * Logs all requests with timing and captures errors for debugging.
 * Recent errors are stored in memory for the debug status endpoint.
 */

const MAX_RECENT_ERRORS = 100;
const recentErrors = [];
const requestStats = {
  total: 0,
  successful: 0,
  failed: 0,
  byPath: new Map(),
};

/**
 * Add an error to the recent errors list
 */
export function addRecentError(error) {
  recentErrors.unshift({
    id: Date.now() + Math.random().toString(36).slice(2),
    timestamp: new Date().toISOString(),
    ...error,
  });
  if (recentErrors.length > MAX_RECENT_ERRORS) {
    recentErrors.pop();
  }
}

/**
 * Get recent errors
 */
export function getRecentErrors(limit = 50) {
  return recentErrors.slice(0, limit);
}

/**
 * Get request statistics
 */
export function getRequestStats() {
  return {
    total: requestStats.total,
    successful: requestStats.successful,
    failed: requestStats.failed,
    successRate: requestStats.total > 0
      ? ((requestStats.successful / requestStats.total) * 100).toFixed(1) + '%'
      : 'N/A',
    topPaths: Array.from(requestStats.byPath.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10)
      .map(([path, stats]) => ({
        path,
        count: stats.count,
        errors: stats.errors,
        avgLatency: Math.round(stats.totalLatency / stats.count),
      })),
  };
}

/**
 * Clear all stats and errors
 */
export function clearStats() {
  recentErrors.length = 0;
  requestStats.total = 0;
  requestStats.successful = 0;
  requestStats.failed = 0;
  requestStats.byPath.clear();
}

/**
 * Wrap a request handler with logging
 */
export function withLogging(handler, routeName = null) {
  return async (req, res) => {
    const start = Date.now();
    const method = req.method;
    const path = routeName || req.url.split('?')[0];

    requestStats.total++;

    // Track by path
    if (!requestStats.byPath.has(path)) {
      requestStats.byPath.set(path, { count: 0, errors: 0, totalLatency: 0 });
    }
    const pathStats = requestStats.byPath.get(path);
    pathStats.count++;

    // Capture original methods to intercept status
    const originalEnd = res.end.bind(res);
    let statusCode = 200;
    let responseBody = null;

    res.end = function(chunk, encoding) {
      const latency = Date.now() - start;
      pathStats.totalLatency += latency;

      if (res.statusCode >= 400) {
        statusCode = res.statusCode;
        requestStats.failed++;
        pathStats.errors++;

        // Try to parse error from response
        let errorMessage = 'Unknown error';
        if (chunk) {
          try {
            const body = JSON.parse(chunk.toString());
            errorMessage = body.message || body.error || 'Unknown error';
            responseBody = body;
          } catch {
            errorMessage = chunk.toString().slice(0, 200);
          }
        }

        addRecentError({
          method,
          path,
          status: statusCode,
          message: errorMessage,
          latency,
          details: responseBody?.details || null,
        });

        // Log to console in development
        if (process.env.NODE_ENV !== 'production') {
          console.error(`[${method}] ${path} - ${statusCode} (${latency}ms): ${errorMessage}`);
        }
      } else {
        requestStats.successful++;

        // Log successful requests in verbose mode
        if (process.env.BFF_VERBOSE_LOGGING === 'true') {
          console.log(`[${method}] ${path} - ${res.statusCode} (${latency}ms)`);
        }
      }

      return originalEnd(chunk, encoding);
    };

    try {
      await handler(req, res);
    } catch (error) {
      const latency = Date.now() - start;

      requestStats.failed++;
      pathStats.errors++;

      addRecentError({
        method,
        path,
        status: 500,
        message: error.message,
        latency,
        stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined,
      });

      console.error(`[${method}] ${path} - UNCAUGHT ERROR (${latency}ms):`, error);

      // Send error response if not already sent
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          message: 'Internal server error',
          details: process.env.NODE_ENV !== 'production' ? error.message : null,
        }));
      }
    }
  };
}
