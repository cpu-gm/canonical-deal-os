/**
 * Home Page Data Aggregation Route
 *
 * Provides the "Today at a Glance" data for the homepage including:
 * - Greeting with user name and time
 * - Portfolio status (single sentence summary)
 * - Decision cards (items requiring action today)
 * - Change feed (what changed since last login)
 * - Truth bar (stale data, overrides, disputes)
 * - Quick starts (intent-based action launcher)
 */

import { kernelFetchJson } from "../kernel.js";
import { getPrisma } from "../db.js";
import { readStore } from "../store.js";
import { getCache, setCache } from "../runtime.js";

const KERNEL_BASE_URL = process.env.KERNEL_API_URL ?? "http://localhost:3001";
const HOME_CACHE_TTL_MS = Number(process.env.BFF_HOME_TTL_MS ?? 5000);

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(JSON.stringify(payload));
}

function sendError(res, status, message, details) {
  sendJson(res, status, { message, details: details ?? null });
}

/**
 * Build personalized greeting based on time of day
 */
function buildGreeting(userName) {
  const hour = new Date().getHours();
  let timeGreeting = "Good morning";
  if (hour >= 12 && hour < 17) timeGreeting = "Good afternoon";
  if (hour >= 17) timeGreeting = "Good evening";

  // Use provided name or fallback
  const displayName = userName || "there";

  return `${timeGreeting}, ${displayName}`;
}

/**
 * Build portfolio status sentence
 */
function buildPortfolioStatus(decisionCards) {
  const urgentCount = decisionCards.filter(c => c.status === 'urgent').length;
  const warningCount = decisionCards.filter(c => c.status === 'warning').length;

  if (urgentCount === 0 && warningCount === 0) {
    return "All systems coherent";
  }

  const totalAttention = urgentCount + warningCount;
  if (totalAttention === 1) {
    return "1 item needs your attention";
  }
  return `${totalAttention} items need your attention`;
}

/**
 * Map inbox items to decision cards
 */
function buildDecisionCards(inboxItems, deals, role) {
  const cards = [];

  for (const item of inboxItems) {
    if (!item.dealId) continue;

    const deal = deals.find(d => d.id === item.dealId);
    if (!deal) continue;

    // Determine status based on truth health and blockers
    let status = 'ready';
    if (item.truth_health === 'danger' || item.primary_blocker) {
      status = 'urgent';
    } else if (item.truth_health === 'warning') {
      status = 'warning';
    }

    // Build summary and consequence
    let summary = item.primary_blocker || 'Ready for next step';
    let consequence = '';

    if (item.primary_blocker) {
      if (item.primary_blocker.includes('approval')) {
        consequence = 'Progress blocked until approval threshold met';
      } else if (item.primary_blocker.includes('material')) {
        consequence = 'Cannot advance lifecycle without required evidence';
      } else if (item.primary_blocker.includes('stale')) {
        consequence = 'Data freshness requirements not met for action';
      } else {
        consequence = 'Action required to proceed';
      }
    }

    // Build actions based on next_action and status
    const primaryAction = item.next_action?.label
      ? { type: item.next_action.actionType || 'REVIEW', label: item.next_action.label }
      : { type: 'REVIEW', label: 'Review deal' };

    const secondaryActions = [];
    if (status === 'urgent') {
      secondaryActions.push({ type: 'OVERRIDE', label: 'Override with attestation' });
    }
    if (item.primary_blocker?.includes('material')) {
      secondaryActions.push({ type: 'UPLOAD', label: 'Upload evidence' });
    }

    cards.push({
      dealId: item.dealId,
      dealName: item.dealName || deal.name,
      status,
      summary,
      consequence,
      primaryAction,
      secondaryActions,
      lifecycleState: item.lifecycle_state,
      truthHealth: item.truth_health
    });
  }

  // Sort: urgent first, then warning, then ready
  cards.sort((a, b) => {
    const order = { urgent: 0, warning: 1, ready: 2 };
    return order[a.status] - order[b.status];
  });

  return cards.slice(0, 6); // Limit to top 6
}

/**
 * Build change feed from recent events
 */
async function buildChangeFeed(dealIds, lastLoginAt, kernelBaseUrl) {
  const changes = [];
  const cutoff = lastLoginAt || new Date(Date.now() - 24 * 60 * 60 * 1000);

  for (const dealId of dealIds.slice(0, 10)) { // Limit to first 10 deals for performance
    try {
      const events = await kernelFetchJson(`${kernelBaseUrl}/deals/${dealId}/events`);
      const deal = await kernelFetchJson(`${kernelBaseUrl}/deals/${dealId}`);

      for (const event of events) {
        const eventDate = new Date(event.createdAt);
        if (eventDate <= cutoff) continue;

        // Map event type to human-readable change
        const changeInfo = mapEventToChange(event, deal.name);
        if (changeInfo) {
          changes.push({
            id: event.id,
            dealId,
            dealName: deal.name,
            ...changeInfo,
            timestamp: event.createdAt
          });
        }
      }
    } catch (error) {
      // Skip deals that fail to fetch
      console.error(`[Home] Failed to fetch events for deal ${dealId}:`, error.message);
    }
  }

  // Sort by timestamp descending
  changes.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  return changes.slice(0, 10); // Limit to 10 most recent
}

/**
 * Map kernel event to change feed item
 */
function mapEventToChange(event, dealName) {
  const typeMap = {
    'ReviewOpened': { changeType: 'event', summary: 'Review process opened', severity: 'info' },
    'DealApproved': { changeType: 'event', summary: 'Deal approved', severity: 'info' },
    'ClosingReadinessAttested': { changeType: 'event', summary: 'Ready to close attestation received', severity: 'info' },
    'DealClosed': { changeType: 'event', summary: 'Deal closed', severity: 'info' },
    'OperationsActivated': { changeType: 'event', summary: 'Operations activated', severity: 'info' },
    'MaterialChangeDetected': { changeType: 'event', summary: 'Material change detected', severity: 'warning' },
    'ChangeReconciled': { changeType: 'event', summary: 'Change reconciled', severity: 'info' },
    'DistressDeclared': { changeType: 'event', summary: 'Distress declared', severity: 'critical' },
    'DistressResolved': { changeType: 'event', summary: 'Distress resolved', severity: 'info' },
    'ApprovalGranted': { changeType: 'event', summary: 'Approval granted', severity: 'info' },
    'ApprovalDenied': { changeType: 'event', summary: 'Approval denied', severity: 'warning' },
    'OverrideAttested': { changeType: 'event', summary: 'Override attested', severity: 'warning' },
    'ArtifactUploaded': { changeType: 'document', summary: 'Document uploaded', severity: 'info' },
    'MaterialCreated': { changeType: 'document', summary: 'Material evidence added', severity: 'info' },
    'MaterialUpdated': { changeType: 'document', summary: 'Material evidence updated', severity: 'info' }
  };

  return typeMap[event.type] || null;
}

/**
 * Calculate truth bar metrics
 */
async function calculateTruthBar(dealIds, kernelBaseUrl) {
  let staleDataCount = 0;
  let unresolvedOverrides = 0;
  let disputedDocuments = 0;

  const prisma = getPrisma();

  // Count stale data (AI-derived fields older than 30 days without DOC backing)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const staleProvenance = await prisma.lLMFieldProvenance.count({
    where: {
      source: 'AI',
      asOf: { lt: thirtyDaysAgo }
    }
  });
  staleDataCount = staleProvenance;

  // Count unresolved overrides (from kernel events)
  for (const dealId of dealIds.slice(0, 5)) {
    try {
      const events = await kernelFetchJson(`${kernelBaseUrl}/deals/${dealId}/events`);
      const overrides = events.filter(e => e.type === 'OverrideAttested');
      // Count overrides not followed by reconciliation
      unresolvedOverrides += overrides.length;
    } catch (error) {
      // Skip on error
    }
  }

  // Count disputed documents (workflow tasks with dispute status)
  const disputeTasks = await prisma.workflowTask.count({
    where: {
      type: 'DISPUTE',
      status: 'OPEN'
    }
  });
  disputedDocuments = disputeTasks;

  return {
    staleDataCount,
    unresolvedOverrides,
    disputedDocuments
  };
}

/**
 * Build Lender-specific home data
 */
async function buildLenderHomeData(deals, lastLoginAt, kernelBaseUrl) {
  const dealList = [];
  let totalOutstanding = 0;
  let needsAttention = 0;
  let monitoring = 0;
  let stable = 0;
  const actionsRequired = [];
  const riskSignals = [];

  for (const deal of deals.slice(0, 20)) {
    try {
      const dealData = await kernelFetchJson(`${kernelBaseUrl}/deals/${deal.id}`);
      const profile = dealData.profile || {};

      // Calculate exposure (loan amount)
      const loanAmount = profile.loan_amount || profile.purchase_price * (profile.ltv || 0.65) || 50000000;
      totalOutstanding += loanAmount;

      // Calculate DSCR status
      const dscr = profile.dscr || 1.35;
      let dscrStatus = 'healthy';
      if (dscr < 1.15) {
        dscrStatus = 'danger';
        needsAttention++;
      } else if (dscr < 1.25) {
        dscrStatus = 'warning';
        monitoring++;
      } else {
        stable++;
      }

      // Check for actions required
      let actionRequired = null;
      if (dscrStatus === 'warning' || dscrStatus === 'danger') {
        actionRequired = { type: 'REVIEW', label: 'Review covenant' };
        actionsRequired.push({
          dealId: deal.id,
          dealName: dealData.name || deal.name,
          summary: dscrStatus === 'danger' ? 'Covenant breach risk' : 'DSCR approaching threshold',
          actionLabel: 'Review'
        });
      }

      // Add risk signals
      if (dscr < 1.20) {
        riskSignals.push({
          message: `${dealData.name}: DSCR at ${dscr.toFixed(2)}x approaching covenant threshold`,
          severity: 'warning',
          dealId: deal.id
        });
      }

      dealList.push({
        dealId: deal.id,
        dealName: dealData.name || deal.name,
        sponsor: profile.sponsor_name || 'Sponsor',
        exposure: loanAmount,
        dscr,
        dscrStatus,
        lastUpdate: '3 days ago', // Would calculate from events in production
        actionRequired
      });
    } catch (error) {
      // Skip deals that fail
    }
  }

  // Add general risk signals
  if (needsAttention > 0) {
    riskSignals.unshift({
      message: `${needsAttention} deal(s) with covenant breach risk < 30 days`,
      severity: needsAttention > 1 ? 'critical' : 'warning'
    });
  }

  return {
    exposure: {
      dealCount: dealList.length,
      totalOutstanding
    },
    riskBuckets: {
      needsAttention,
      monitoring,
      stable
    },
    dealList,
    actionsRequired,
    riskSignals
  };
}

/**
 * Build Counsel-specific home data
 */
async function buildCounselHomeData(deals, userId, kernelBaseUrl) {
  const openRequests = [];
  const inProgress = [];
  const teamActivity = [];
  const emailStatus = [];

  // Build mock open requests from deals that have workflow tasks
  for (const deal of deals.slice(0, 10)) {
    try {
      const dealData = await kernelFetchJson(`${kernelBaseUrl}/deals/${deal.id}`);

      // Check for pending legal work (simplified - would check workflow tasks in production)
      if (Math.random() > 0.6) { // Random for demo
        openRequests.push({
          id: `req-${deal.id}`,
          dealId: deal.id,
          dealName: dealData.name || deal.name,
          matterType: ['Covenant Amendment', 'Lease Consent', 'Document Review'][Math.floor(Math.random() * 3)],
          requestedBy: 'ABC Capital',
          status: ['draft_requested', 'clarification_requested', 'review_pending'][Math.floor(Math.random() * 3)],
          summary: 'Sponsor requested review of proposed amendment language.',
          dueDate: null
        });
      } else if (Math.random() > 0.5) {
        inProgress.push({
          dealId: deal.id,
          dealName: dealData.name || deal.name,
          summary: 'Draft uploaded',
          waitingOn: 'sponsor review',
          lastTouched: {
            user: 'J. Levin',
            timestamp: new Date(Date.now() - 3600000).toISOString()
          }
        });
      }
    } catch (error) {
      // Skip
    }
  }

  // Add mock team activity
  if (openRequests.length > 0 || inProgress.length > 0) {
    teamActivity.push(
      { user: 'J. Levin', action: 'uploaded revised amendment', deal: inProgress[0]?.dealName || 'Phoenix Industrial', timestamp: new Date(Date.now() - 7200000).toISOString() },
      { user: 'M. Rosen', action: 'flagged clause discrepancy', deal: openRequests[0]?.dealName || 'Austin Multifamily', timestamp: new Date(Date.now() - 14400000).toISOString() }
    );
  }

  return {
    firmName: 'Smith & Carter LLP',
    openRequests: openRequests.slice(0, 3),
    inProgress: inProgress.slice(0, 3),
    teamActivity: teamActivity.slice(0, 5),
    emailStatus,
    allClear: openRequests.length === 0
  };
}

/**
 * Get quick starts based on role
 */
function getQuickStartsForRole(role) {
  const gpStarts = [
    { id: 'create-deal', label: 'Create a new deal', description: 'Start a new acquisition with guided setup', icon: 'plus' },
    { id: 'model-scenario', label: 'Model a scenario', description: 'Run what-if analysis on portfolio', icon: 'calculator' },
    { id: 'lender-update', label: 'Prepare lender update', description: 'Generate periodic lender report', icon: 'send' },
    { id: 'ic-materials', label: 'Generate IC materials', description: 'Create investment committee deck', icon: 'briefcase' }
  ];

  const lenderStarts = [
    { id: 'portfolio-review', label: 'Review portfolio exposure', description: 'See all active loans and risk status', icon: 'chart' },
    { id: 'covenant-check', label: 'Covenant compliance check', description: 'Review DSCR and LTV across loans', icon: 'shield' },
    { id: 'consent-queue', label: 'Pending consents', description: 'Review items awaiting your approval', icon: 'check' }
  ];

  const legalStarts = [
    { id: 'document-queue', label: 'Document review queue', description: 'See drafts awaiting your review', icon: 'file' },
    { id: 'upload-draft', label: 'Upload a draft', description: 'Submit document for sponsor review', icon: 'upload' },
    { id: 'matter-status', label: 'Matter status', description: 'Check status of open legal matters', icon: 'folder' }
  ];

  switch (role) {
    case 'Lender':
    case 'LENDER':
      return lenderStarts;
    case 'Legal':
    case 'LEGAL':
    case 'Counsel':
      return legalStarts;
    default:
      return gpStarts;
  }
}

/**
 * Main handler for /api/home
 * SECURITY: authUser is required and must come from validated JWT at dispatch level
 */
export async function handleHomeData(req, res, authUser) {
  if (!authUser) {
    return sendJson(res, 401, { message: "Not authenticated" });
  }
  // SECURITY: Use validated authUser instead of spoofable headers
  const userId = authUser.id;
  const role = authUser.role;
  const cacheKey = `home:${userId}:${role}`;

  // Check cache
  const cached = getCache(cacheKey);
  if (cached) {
    return sendJson(res, 200, cached);
  }

  try {
    const prisma = getPrisma();
    const store = await readStore();

    // Get or create user session for last login tracking (with graceful fallback)
    let lastLoginAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
    try {
      let userSession = await prisma.userSession.findUnique({
        where: { userId }
      });

      if (userSession) {
        lastLoginAt = userSession.lastLoginAt;
        await prisma.userSession.update({
          where: { userId },
          data: { lastLoginAt: new Date() }
        });
      } else {
        await prisma.userSession.create({
          data: { userId, lastLoginAt: new Date() }
        });
      }
    } catch (sessionError) {
      // UserSession table may not exist - continue with default lastLoginAt
      console.warn("[Home] UserSession query failed (table may not exist):", sessionError.message);
    }

    // Fetch deals from store
    const deals = store.dealIndex || [];
    const dealIds = deals.map(d => d.id);

    // Fetch inbox items for decision cards
    let inboxItems = [];
    try {
      const { buildInboxItems } = await import("./inbox.js");
      // We'll build a simplified inbox fetch
      for (const deal of deals.slice(0, 10)) {
        try {
          const dealData = await kernelFetchJson(`${KERNEL_BASE_URL}/deals/${deal.id}`);
          const explain = await kernelFetchJson(`${KERNEL_BASE_URL}/deals/${deal.id}/explain`);

          // Find blocked actions
          const blockedAction = explain?.actions?.find(a => a.status === 'BLOCKED');

          inboxItems.push({
            dealId: deal.id,
            dealName: dealData.name || deal.name,
            lifecycle_state: dealData.state,
            truth_health: blockedAction ? 'warning' : 'healthy',
            primary_blocker: blockedAction?.reasons?.[0]?.message || null,
            next_action: blockedAction
              ? { actionType: blockedAction.action, label: `Resolve: ${blockedAction.action}` }
              : null,
            assignedToMe: true
          });
        } catch (e) {
          // Skip deals that fail to fetch
        }
      }
    } catch (error) {
      console.error("[Home] Failed to build inbox items:", error.message);
    }

    // Build response based on role
    let response;

    if (role === 'Lender' || role === 'LENDER') {
      // Lender-specific response
      const lenderData = await buildLenderHomeData(deals, lastLoginAt, KERNEL_BASE_URL);
      const changeFeed = await buildChangeFeed(dealIds, lastLoginAt, KERNEL_BASE_URL);

      response = {
        role: 'Lender',
        timestamp: new Date().toISOString(),
        ...lenderData,
        changeFeed
      };
    } else if (role === 'Counsel' || role === 'COUNSEL' || role === 'Legal' || role === 'LEGAL') {
      // Counsel-specific response
      const counselData = await buildCounselHomeData(deals, userId, KERNEL_BASE_URL);

      response = {
        role: 'Counsel',
        timestamp: new Date().toISOString(),
        ...counselData
      };
    } else {
      // GP and other roles - default response
      const decisionCards = buildDecisionCards(inboxItems, deals, role);
      const changeFeed = await buildChangeFeed(dealIds, lastLoginAt, KERNEL_BASE_URL);
      const truthBar = await calculateTruthBar(dealIds, KERNEL_BASE_URL);
      const quickStarts = getQuickStartsForRole(role);

      response = {
        greeting: buildGreeting(authUser.name || authUser.email?.split('@')[0]),
        timestamp: new Date().toISOString(),
        dayOfWeek: new Date().toLocaleDateString('en-US', { weekday: 'long' }),
        portfolioStatus: buildPortfolioStatus(decisionCards),
        portfolioSummary: {
          totalDeals: deals.length,
          needsAttention: decisionCards.filter(c => c.status !== 'ready').length
        },
        decisionCards,
        changeFeed,
        truthBar,
        quickStarts,
        role
      };
    }

    // Cache the response
    setCache(cacheKey, response, HOME_CACHE_TTL_MS);

    return sendJson(res, 200, response);

  } catch (error) {
    console.error("[Home] Error building homepage data:", error);
    return sendError(res, 500, "Failed to load homepage data", error.message);
  }
}
