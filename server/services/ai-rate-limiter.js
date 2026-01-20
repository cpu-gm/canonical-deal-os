/**
 * AI Rate Limiter Service
 *
 * Prevents abuse of AI endpoints by enforcing per-user and per-organization
 * request limits. Uses in-memory storage with sliding window algorithm.
 *
 * SECURITY: This is a critical cost control and abuse prevention measure.
 * Rate limits prevent:
 * - Single users running up OpenAI API costs
 * - Data scraping via repeated AI queries
 * - DoS attacks on AI endpoints
 *
 * Default limits:
 * - Per user: 20 requests/minute, 200 requests/day
 * - Per organization: 500 requests/minute, 5000 requests/day
 */

// Configuration (can be overridden via environment variables)
const RATE_LIMITS = {
  user: {
    perMinute: parseInt(process.env.AI_RATE_LIMIT_USER_PER_MINUTE) || 20,
    perDay: parseInt(process.env.AI_RATE_LIMIT_USER_PER_DAY) || 200,
  },
  organization: {
    perMinute: parseInt(process.env.AI_RATE_LIMIT_ORG_PER_MINUTE) || 500,
    perDay: parseInt(process.env.AI_RATE_LIMIT_ORG_PER_DAY) || 5000,
  },
};

// Time windows in milliseconds
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

// In-memory storage for rate limit tracking
// Structure: { [key]: { requests: [timestamp1, timestamp2, ...], lastCleanup: timestamp } }
const rateLimitStore = {
  users: new Map(),
  organizations: new Map(),
};

// Cleanup interval - removes old entries every 5 minutes
const CLEANUP_INTERVAL = 5 * MINUTE;

/**
 * Clean up old request timestamps from a tracking entry
 * @param {Object} entry - Rate limit entry { requests: [], lastCleanup: timestamp }
 * @param {number} windowMs - Time window in milliseconds
 * @returns {Array} Filtered requests array
 */
function cleanupOldRequests(entry, windowMs) {
  const now = Date.now();
  const cutoff = now - windowMs;
  entry.requests = entry.requests.filter(ts => ts > cutoff);
  entry.lastCleanup = now;
  return entry.requests;
}

/**
 * Get or create a rate limit entry for a key
 * @param {Map} store - The store (users or organizations)
 * @param {string} key - The key (userId or organizationId)
 * @returns {Object} Rate limit entry
 */
function getOrCreateEntry(store, key) {
  if (!store.has(key)) {
    store.set(key, {
      requests: [],
      lastCleanup: Date.now(),
    });
  }
  return store.get(key);
}

/**
 * Count requests within a time window
 * @param {Array} requests - Array of request timestamps
 * @param {number} windowMs - Time window in milliseconds
 * @returns {number} Count of requests within window
 */
function countRequestsInWindow(requests, windowMs) {
  const cutoff = Date.now() - windowMs;
  return requests.filter(ts => ts > cutoff).length;
}

/**
 * Check if a rate limit is exceeded
 * @param {string} userId - User ID
 * @param {string} organizationId - Organization ID
 * @returns {Object} { allowed: boolean, reason?: string, retryAfterSeconds?: number }
 */
export function checkRateLimit(userId, organizationId) {
  const now = Date.now();

  // Check user limits
  const userEntry = getOrCreateEntry(rateLimitStore.users, userId);

  // Periodic cleanup for user entry
  if (now - userEntry.lastCleanup > CLEANUP_INTERVAL) {
    cleanupOldRequests(userEntry, DAY);
  }

  const userRequestsPerMinute = countRequestsInWindow(userEntry.requests, MINUTE);
  const userRequestsPerDay = countRequestsInWindow(userEntry.requests, DAY);

  // Check per-minute user limit
  if (userRequestsPerMinute >= RATE_LIMITS.user.perMinute) {
    const oldestInWindow = userEntry.requests.find(ts => ts > now - MINUTE);
    const retryAfterMs = oldestInWindow ? (oldestInWindow + MINUTE - now) : MINUTE;

    console.log(`[AI-RATE-LIMIT] User ${userId} exceeded per-minute limit (${userRequestsPerMinute}/${RATE_LIMITS.user.perMinute})`);

    return {
      allowed: false,
      reason: `Rate limit exceeded. You can make ${RATE_LIMITS.user.perMinute} AI requests per minute.`,
      retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
      limitType: 'user_per_minute',
      current: userRequestsPerMinute,
      limit: RATE_LIMITS.user.perMinute,
    };
  }

  // Check per-day user limit
  if (userRequestsPerDay >= RATE_LIMITS.user.perDay) {
    console.log(`[AI-RATE-LIMIT] User ${userId} exceeded per-day limit (${userRequestsPerDay}/${RATE_LIMITS.user.perDay})`);

    return {
      allowed: false,
      reason: `Daily limit exceeded. You can make ${RATE_LIMITS.user.perDay} AI requests per day.`,
      retryAfterSeconds: Math.ceil((DAY - (now % DAY)) / 1000), // Until midnight
      limitType: 'user_per_day',
      current: userRequestsPerDay,
      limit: RATE_LIMITS.user.perDay,
    };
  }

  // Check organization limits (if organizationId provided)
  if (organizationId) {
    const orgEntry = getOrCreateEntry(rateLimitStore.organizations, organizationId);

    // Periodic cleanup for org entry
    if (now - orgEntry.lastCleanup > CLEANUP_INTERVAL) {
      cleanupOldRequests(orgEntry, DAY);
    }

    const orgRequestsPerMinute = countRequestsInWindow(orgEntry.requests, MINUTE);
    const orgRequestsPerDay = countRequestsInWindow(orgEntry.requests, DAY);

    // Check per-minute org limit
    if (orgRequestsPerMinute >= RATE_LIMITS.organization.perMinute) {
      const oldestInWindow = orgEntry.requests.find(ts => ts > now - MINUTE);
      const retryAfterMs = oldestInWindow ? (oldestInWindow + MINUTE - now) : MINUTE;

      console.log(`[AI-RATE-LIMIT] Organization ${organizationId} exceeded per-minute limit (${orgRequestsPerMinute}/${RATE_LIMITS.organization.perMinute})`);

      return {
        allowed: false,
        reason: `Organization rate limit exceeded. Please try again shortly.`,
        retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
        limitType: 'org_per_minute',
        current: orgRequestsPerMinute,
        limit: RATE_LIMITS.organization.perMinute,
      };
    }

    // Check per-day org limit
    if (orgRequestsPerDay >= RATE_LIMITS.organization.perDay) {
      console.log(`[AI-RATE-LIMIT] Organization ${organizationId} exceeded per-day limit (${orgRequestsPerDay}/${RATE_LIMITS.organization.perDay})`);

      return {
        allowed: false,
        reason: `Organization daily limit exceeded. Contact support if you need increased limits.`,
        retryAfterSeconds: Math.ceil((DAY - (now % DAY)) / 1000),
        limitType: 'org_per_day',
        current: orgRequestsPerDay,
        limit: RATE_LIMITS.organization.perDay,
      };
    }
  }

  // All checks passed
  return { allowed: true };
}

/**
 * Record a request for rate limiting
 * @param {string} userId - User ID
 * @param {string} organizationId - Organization ID
 */
export function recordRequest(userId, organizationId) {
  const now = Date.now();

  // Record for user
  const userEntry = getOrCreateEntry(rateLimitStore.users, userId);
  userEntry.requests.push(now);

  // Record for organization
  if (organizationId) {
    const orgEntry = getOrCreateEntry(rateLimitStore.organizations, organizationId);
    orgEntry.requests.push(now);
  }
}

/**
 * Get current rate limit status for a user
 * @param {string} userId - User ID
 * @param {string} organizationId - Organization ID
 * @returns {Object} Current rate limit status
 */
export function getRateLimitStatus(userId, organizationId) {
  const userEntry = rateLimitStore.users.get(userId) || { requests: [] };
  const orgEntry = organizationId
    ? rateLimitStore.organizations.get(organizationId) || { requests: [] }
    : null;

  return {
    user: {
      requestsPerMinute: countRequestsInWindow(userEntry.requests, MINUTE),
      requestsPerDay: countRequestsInWindow(userEntry.requests, DAY),
      limits: RATE_LIMITS.user,
    },
    organization: orgEntry ? {
      requestsPerMinute: countRequestsInWindow(orgEntry.requests, MINUTE),
      requestsPerDay: countRequestsInWindow(orgEntry.requests, DAY),
      limits: RATE_LIMITS.organization,
    } : null,
  };
}

/**
 * Reset rate limits for a user (admin function)
 * @param {string} userId - User ID to reset
 */
export function resetUserRateLimit(userId) {
  rateLimitStore.users.delete(userId);
  console.log(`[AI-RATE-LIMIT] Reset rate limits for user ${userId}`);
}

/**
 * Reset rate limits for an organization (admin function)
 * @param {string} organizationId - Organization ID to reset
 */
export function resetOrganizationRateLimit(organizationId) {
  rateLimitStore.organizations.delete(organizationId);
  console.log(`[AI-RATE-LIMIT] Reset rate limits for organization ${organizationId}`);
}

/**
 * Get rate limit configuration (for admin/debugging)
 */
export function getRateLimitConfig() {
  return {
    limits: RATE_LIMITS,
    trackedUsers: rateLimitStore.users.size,
    trackedOrganizations: rateLimitStore.organizations.size,
  };
}

// Periodic cleanup of stale entries (runs every hour)
setInterval(() => {
  const now = Date.now();
  const staleThreshold = DAY + MINUTE; // Entries with no requests in 24h+

  let cleanedUsers = 0;
  let cleanedOrgs = 0;

  for (const [key, entry] of rateLimitStore.users) {
    const latestRequest = Math.max(...entry.requests, 0);
    if (now - latestRequest > staleThreshold) {
      rateLimitStore.users.delete(key);
      cleanedUsers++;
    }
  }

  for (const [key, entry] of rateLimitStore.organizations) {
    const latestRequest = Math.max(...entry.requests, 0);
    if (now - latestRequest > staleThreshold) {
      rateLimitStore.organizations.delete(key);
      cleanedOrgs++;
    }
  }

  if (cleanedUsers > 0 || cleanedOrgs > 0) {
    console.log(`[AI-RATE-LIMIT] Cleanup: removed ${cleanedUsers} stale user entries, ${cleanedOrgs} stale org entries`);
  }
}, 60 * 60 * 1000); // Run every hour

export default {
  checkRateLimit,
  recordRequest,
  getRateLimitStatus,
  resetUserRateLimit,
  resetOrganizationRateLimit,
  getRateLimitConfig,
};
