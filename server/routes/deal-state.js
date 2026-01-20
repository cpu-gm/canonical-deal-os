/**
 * Deal State Machine Routes
 *
 * API endpoints for managing deal workflow states and transitions.
 *
 * Endpoints:
 * - GET    /api/deals/:dealId/state                    - Get current state
 * - GET    /api/deals/:dealId/state/available-transitions - Get available transitions
 * - GET    /api/deals/:dealId/state/blockers           - Get current blockers
 * - POST   /api/deals/:dealId/state/transition         - Perform state transition
 * - GET    /api/deals/:dealId/state/events             - Get event history
 * - GET    /api/deals/:dealId/state/events/:eventId    - Get single event
 */

import {
  dealStateMachine,
  DEAL_STATES,
  ROLES,
  TRANSITION_RULES
} from '../services/deal-state-machine.js';
import { PrismaClient } from '@prisma/client';
import { extractAuthUser } from './auth.js';
import { readStore } from '../store.js';

const prisma = new PrismaClient();

/**
 * Require authenticated user with access to the specified deal.
 * Returns authUser if authorized, null otherwise (response already sent).
 */
async function requireDealOrgAccess(req, res, dealId) {
  const authUser = await extractAuthUser(req);
  if (!authUser) {
    sendJson(res, 401, { success: false, error: 'Not authenticated' });
    return null;
  }

  const store = await readStore();
  const record = store.dealIndex.find((item) => item.id === dealId);

  if (!record) {
    sendJson(res, 404, { success: false, error: 'Deal not found' });
    return null;
  }

  // ALWAYS enforce org isolation - no conditional bypass
  if (record.organizationId && record.organizationId !== authUser.organizationId) {
    sendJson(res, 403, { success: false, error: 'Access denied - deal belongs to different organization' });
    return null;
  }

  return authUser;
}

/**
 * Require GP or Admin role for privileged operations.
 * Returns authUser if authorized, null otherwise (response already sent).
 */
async function requireGPWithDealAccess(req, res, dealId) {
  const authUser = await requireDealOrgAccess(req, res, dealId);
  if (!authUser) return null;

  if (!['GP', 'Admin'].includes(authUser.role)) {
    sendJson(res, 403, { success: false, error: 'GP or Admin role required' });
    return null;
  }

  return authUser;
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-User-Id, X-Canonical-User-Id, X-Actor-Role",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS"
  });
  res.end(JSON.stringify(payload));
}

/**
 * Format state name for display
 */
function formatStateName(state) {
  const names = {
    INTAKE_RECEIVED: 'Intake Received',
    DATA_ROOM_INGESTED: 'Data Room Ingested',
    EXTRACTION_COMPLETE: 'Extraction Complete',
    UNDERWRITING_DRAFT: 'Underwriting Draft',
    IC_READY: 'IC Ready',
    LOI_DRAFT: 'LOI Draft',
    LOI_SENT: 'LOI Sent',
    LOI_ACCEPTED: 'LOI Accepted',
    PSA_DRAFT: 'PSA Draft',
    PSA_EXECUTED: 'PSA Executed',
    DD_ACTIVE: 'Due Diligence Active',
    DD_COMPLETE: 'Due Diligence Complete',
    FINANCING_IN_PROGRESS: 'Financing In Progress',
    FINANCING_COMMITTED: 'Financing Committed',
    CLEAR_TO_CLOSE: 'Clear to Close',
    CLOSED: 'Closed',
    DEAD: 'Dead',
    ON_HOLD: 'On Hold'
  };

  return names[state] || state;
}

/**
 * Get current deal state
 */
async function handleGetDealState(req, res, dealId) {
  // Require authentication and org access
  const authUser = await requireDealOrgAccess(req, res, dealId);
  if (!authUser) return;

  try {
    const state = await dealStateMachine.getState(dealId);

    sendJson(res, 200, {
      success: true,
      state: {
        currentState: state.currentState,
        enteredStateAt: state.enteredStateAt,
        lastTransitionBy: state.lastTransitionBy,
        lastTransitionAt: state.lastTransitionAt
      },
      stateInfo: {
        displayName: formatStateName(state.currentState),
        rules: TRANSITION_RULES[state.currentState]
      }
    });
  } catch (error) {
    console.error('Error fetching deal state:', error);
    sendJson(res, 500, {
      success: false,
      error: error.message
    });
  }
}

/**
 * Perform state transition
 */
async function handleTransitionState(req, res, dealId, readJsonBody, resolveUserId, resolveActorRole) {
  // Require GP/Admin role and org access for state transitions
  const authUser = await requireGPWithDealAccess(req, res, dealId);
  if (!authUser) return;

  try {
    const body = await readJsonBody(req);
    const { toState, reason, approvals, force } = body || {};

    if (!toState) {
      return sendJson(res, 400, {
        success: false,
        error: 'toState is required'
      });
    }

    if (!DEAL_STATES[toState]) {
      return sendJson(res, 400, {
        success: false,
        error: `Invalid state: ${toState}`,
        validStates: Object.keys(DEAL_STATES)
      });
    }

    // SECURITY: Use validated authUser identity, NOT spoofable headers
    // authUser is already validated by requireGPWithDealAccess at dispatch level
    const actor = {
      id: authUser.id,
      name: authUser.name || 'Unknown',
      role: authUser.role || 'GP'
    };

    const result = await dealStateMachine.transition(dealId, toState, actor, {
      reason,
      approvals,
      force
    });

    sendJson(res, 200, {
      success: true,
      message: `Transitioned to ${toState}`,
      state: {
        currentState: result.state.currentState,
        enteredStateAt: result.state.enteredStateAt
      },
      event: {
        id: result.event.id,
        eventType: result.event.eventType,
        sequenceNumber: result.event.sequenceNumber
      }
    });
  } catch (error) {
    console.error('Error performing transition:', error);
    sendJson(res, 400, {
      success: false,
      error: error.message
    });
  }
}

/**
 * Get available state transitions
 */
async function handleGetAvailableTransitions(req, res, dealId, resolveUserId, resolveActorRole) {
  // Require authentication and org access
  const authUser = await requireDealOrgAccess(req, res, dealId);
  if (!authUser) return;

  try {
    const transitions = await dealStateMachine.getAvailableTransitions(dealId);
    const state = await dealStateMachine.getState(dealId);

    sendJson(res, 200, {
      success: true,
      currentState: state.currentState,
      transitions: transitions.map(t => ({
        ...t,
        displayName: formatStateName(t.targetState)
      }))
    });
  } catch (error) {
    console.error('Error fetching transitions:', error);
    sendJson(res, 500, {
      success: false,
      error: error.message
    });
  }
}

/**
 * Get current blockers for a deal
 */
async function handleGetBlockers(req, res, dealId) {
  // Require authentication and org access
  const authUser = await requireDealOrgAccess(req, res, dealId);
  if (!authUser) return;

  try {
    const result = await dealStateMachine.getCurrentBlockers(dealId);

    sendJson(res, 200, {
      success: true,
      currentState: result.currentState,
      blockers: result.blockers,
      hasBlockers: result.blockers.length > 0
    });
  } catch (error) {
    console.error('Error fetching blockers:', error);
    sendJson(res, 500, {
      success: false,
      error: error.message
    });
  }
}

/**
 * Get event history
 */
async function handleGetDealEvents(req, res, dealId) {
  // Require authentication and org access
  const authUser = await requireDealOrgAccess(req, res, dealId);
  if (!authUser) return;

  try {
    const url = new URL(req.url, 'http://localhost');
    const limit = url.searchParams.get('limit');
    const eventType = url.searchParams.get('eventType');

    const events = await dealStateMachine.getEventHistory(dealId, {
      limit: limit ? parseInt(limit) : undefined,
      eventType
    });

    sendJson(res, 200, {
      success: true,
      events,
      count: events.length
    });
  } catch (error) {
    console.error('Error fetching events:', error);
    sendJson(res, 500, {
      success: false,
      error: error.message
    });
  }
}

/**
 * Get single event
 */
async function handleGetDealEvent(req, res, dealId, eventId) {
  // Require authentication and org access
  const authUser = await requireDealOrgAccess(req, res, dealId);
  if (!authUser) return;

  try {
    const event = await prisma.dealEvent.findFirst({
      where: { id: eventId, dealId }
    });

    if (!event) {
      return sendJson(res, 404, {
        success: false,
        error: 'Event not found'
      });
    }

    sendJson(res, 200, {
      success: true,
      event: {
        ...event,
        eventData: JSON.parse(event.eventData),
        authorityContext: JSON.parse(event.authorityContext),
        evidenceRefs: event.evidenceRefs ? JSON.parse(event.evidenceRefs) : null
      }
    });
  } catch (error) {
    console.error('Error fetching event:', error);
    sendJson(res, 500, {
      success: false,
      error: error.message
    });
  }
}

export {
  handleGetDealState,
  handleTransitionState,
  handleGetAvailableTransitions,
  handleGetBlockers,
  handleGetDealEvents,
  handleGetDealEvent
};
