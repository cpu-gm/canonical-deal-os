/**
 * Deal State Machine Service
 *
 * Enforces workflow state transitions with:
 * - Required approvals per transition
 * - Required documents per state
 * - Blocker detection (unverified claims, open conflicts)
 * - Event ledger with hash chain for audit trail
 */

import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import kernelClient from './kernel-client.js';
import { getDDCompletionStatus } from './ai/dd-checklist-assistant.js';

const prisma = new PrismaClient();

// =============================================================================
// STATE DEFINITIONS
// =============================================================================

const DEAL_STATES = {
  INTAKE_RECEIVED: 'INTAKE_RECEIVED',
  DATA_ROOM_INGESTED: 'DATA_ROOM_INGESTED',
  EXTRACTION_COMPLETE: 'EXTRACTION_COMPLETE',
  UNDERWRITING_DRAFT: 'UNDERWRITING_DRAFT',
  IC_READY: 'IC_READY',
  LOI_DRAFT: 'LOI_DRAFT',
  LOI_SENT: 'LOI_SENT',
  LOI_ACCEPTED: 'LOI_ACCEPTED',
  PSA_DRAFT: 'PSA_DRAFT',
  PSA_EXECUTED: 'PSA_EXECUTED',
  DD_ACTIVE: 'DD_ACTIVE',
  DD_COMPLETE: 'DD_COMPLETE',
  FINANCING_IN_PROGRESS: 'FINANCING_IN_PROGRESS',
  FINANCING_COMMITTED: 'FINANCING_COMMITTED',
  CLEAR_TO_CLOSE: 'CLEAR_TO_CLOSE',
  CLOSED: 'CLOSED',
  // Terminal states
  DEAD: 'DEAD',
  ON_HOLD: 'ON_HOLD'
};

const ROLES = {
  ANALYST: 'ANALYST',
  SENIOR_ANALYST: 'SENIOR_ANALYST',
  VP: 'VP',
  GP: 'GP',
  COUNSEL: 'COUNSEL',
  LENDER: 'LENDER'
};

// =============================================================================
// TRANSITION RULES
// =============================================================================

const TRANSITION_RULES = {
  [DEAL_STATES.INTAKE_RECEIVED]: {
    allowedTransitions: [DEAL_STATES.DATA_ROOM_INGESTED, DEAL_STATES.DEAD],
    requiredApprovals: [],
    requiredDocuments: [],
    blockerChecks: []
  },
  [DEAL_STATES.DATA_ROOM_INGESTED]: {
    allowedTransitions: [DEAL_STATES.EXTRACTION_COMPLETE, DEAL_STATES.DEAD, DEAL_STATES.ON_HOLD],
    requiredApprovals: [],
    requiredDocuments: ['RENT_ROLL', 'T12'],
    blockerChecks: ['hasSourceDocuments']
  },
  [DEAL_STATES.EXTRACTION_COMPLETE]: {
    allowedTransitions: [DEAL_STATES.UNDERWRITING_DRAFT, DEAL_STATES.DEAD, DEAL_STATES.ON_HOLD],
    requiredApprovals: [ROLES.ANALYST],
    requiredDocuments: [],
    blockerChecks: ['allClaimsVerified']
  },
  [DEAL_STATES.UNDERWRITING_DRAFT]: {
    allowedTransitions: [DEAL_STATES.IC_READY, DEAL_STATES.DEAD, DEAL_STATES.ON_HOLD],
    requiredApprovals: [ROLES.ANALYST, ROLES.SENIOR_ANALYST],
    requiredDocuments: [],
    blockerChecks: ['noOpenConflicts', 'hasUnderwritingModel']
  },
  [DEAL_STATES.IC_READY]: {
    allowedTransitions: [DEAL_STATES.LOI_DRAFT, DEAL_STATES.DEAD, DEAL_STATES.ON_HOLD],
    requiredApprovals: [ROLES.GP],
    requiredDocuments: ['IC_MEMO'],
    blockerChecks: ['hasICMemo']
  },
  [DEAL_STATES.LOI_DRAFT]: {
    allowedTransitions: [DEAL_STATES.LOI_SENT, DEAL_STATES.DEAD, DEAL_STATES.ON_HOLD],
    requiredApprovals: [ROLES.GP],
    requiredDocuments: ['LOI'],
    blockerChecks: []
  },
  [DEAL_STATES.LOI_SENT]: {
    allowedTransitions: [DEAL_STATES.LOI_ACCEPTED, DEAL_STATES.DEAD, DEAL_STATES.ON_HOLD],
    requiredApprovals: [],
    requiredDocuments: [],
    blockerChecks: []
  },
  [DEAL_STATES.LOI_ACCEPTED]: {
    allowedTransitions: [DEAL_STATES.PSA_DRAFT, DEAL_STATES.DEAD, DEAL_STATES.ON_HOLD],
    requiredApprovals: [],
    requiredDocuments: [],
    blockerChecks: []
  },
  [DEAL_STATES.PSA_DRAFT]: {
    allowedTransitions: [DEAL_STATES.PSA_EXECUTED, DEAL_STATES.DEAD, DEAL_STATES.ON_HOLD],
    requiredApprovals: [ROLES.GP, ROLES.COUNSEL],
    requiredDocuments: ['PSA'],
    blockerChecks: []
  },
  [DEAL_STATES.PSA_EXECUTED]: {
    allowedTransitions: [DEAL_STATES.DD_ACTIVE, DEAL_STATES.DEAD],
    requiredApprovals: [],
    requiredDocuments: [],
    blockerChecks: ['hasPSAExecuted']
  },
  [DEAL_STATES.DD_ACTIVE]: {
    allowedTransitions: [DEAL_STATES.DD_COMPLETE, DEAL_STATES.DEAD],
    requiredApprovals: [],
    requiredDocuments: ['DD_LIST'],
    blockerChecks: []
  },
  [DEAL_STATES.DD_COMPLETE]: {
    allowedTransitions: [DEAL_STATES.FINANCING_IN_PROGRESS, DEAL_STATES.DEAD],
    requiredApprovals: [ROLES.VP],
    requiredDocuments: [],
    blockerChecks: ['ddItemsComplete']
  },
  [DEAL_STATES.FINANCING_IN_PROGRESS]: {
    allowedTransitions: [DEAL_STATES.FINANCING_COMMITTED, DEAL_STATES.DEAD],
    requiredApprovals: [],
    requiredDocuments: [],
    blockerChecks: []
  },
  [DEAL_STATES.FINANCING_COMMITTED]: {
    allowedTransitions: [DEAL_STATES.CLEAR_TO_CLOSE, DEAL_STATES.DEAD],
    requiredApprovals: [ROLES.GP, ROLES.LENDER, ROLES.COUNSEL],
    requiredDocuments: ['CLOSING_STATEMENT'],
    blockerChecks: ['hasLoanCommitment']
  },
  [DEAL_STATES.CLEAR_TO_CLOSE]: {
    allowedTransitions: [DEAL_STATES.CLOSED],
    requiredApprovals: [ROLES.GP, ROLES.LENDER],
    requiredDocuments: ['WIRE_CONFIRMATION'],
    blockerChecks: ['allClosingDocsReady']
  },
  [DEAL_STATES.CLOSED]: {
    allowedTransitions: [],
    requiredApprovals: [],
    requiredDocuments: [],
    blockerChecks: []
  },
  [DEAL_STATES.DEAD]: {
    allowedTransitions: [],
    requiredApprovals: [],
    requiredDocuments: [],
    blockerChecks: []
  },
  [DEAL_STATES.ON_HOLD]: {
    allowedTransitions: [
      DEAL_STATES.DATA_ROOM_INGESTED,
      DEAL_STATES.EXTRACTION_COMPLETE,
      DEAL_STATES.UNDERWRITING_DRAFT,
      DEAL_STATES.IC_READY,
      DEAL_STATES.LOI_DRAFT,
      DEAL_STATES.DEAD
    ],
    requiredApprovals: [ROLES.VP],
    requiredDocuments: [],
    blockerChecks: []
  }
};

// =============================================================================
// BLOCKER CHECK FUNCTIONS
// =============================================================================

const blockerChecks = {
  /**
   * Check if all AI extraction claims have been verified
   */
  async allClaimsVerified(dealId) {
    const pendingClaims = await prisma.extractionClaim.count({
      where: {
        dealId,
        status: 'PENDING'
      }
    });

    if (pendingClaims > 0) {
      return {
        blocked: true,
        reason: `${pendingClaims} extraction claims pending verification`,
        details: { pendingClaims }
      };
    }
    return { blocked: false };
  },

  /**
   * Check if there are unresolved underwriting conflicts
   */
  async noOpenConflicts(dealId) {
    const openConflicts = await prisma.underwritingConflict.count({
      where: {
        dealId,
        resolved: false
      }
    });

    if (openConflicts > 0) {
      return {
        blocked: true,
        reason: `${openConflicts} unresolved data conflicts`,
        details: { openConflicts }
      };
    }
    return { blocked: false };
  },

  /**
   * Check if required source documents exist
   */
  async hasSourceDocuments(dealId) {
    // Artifact is kernel-managed
    const artifacts = await kernelClient.getArtifacts(dealId);

    const hasRentRoll = artifacts.some(a => a.classification === 'RENT_ROLL' || a.documentType === 'RENT_ROLL');
    const hasT12 = artifacts.some(a => ['T12', 'OPERATING_STATEMENT'].includes(a.classification || a.documentType));

    if (!hasRentRoll && !hasT12) {
      return {
        blocked: true,
        reason: 'Missing required documents: Rent Roll or T12/Operating Statement',
        details: { hasRentRoll, hasT12 }
      };
    }
    return { blocked: false };
  },

  /**
   * Check if underwriting model exists
   */
  async hasUnderwritingModel(dealId) {
    const model = await prisma.underwritingModel.findFirst({
      where: { dealId }
    });

    if (!model) {
      return {
        blocked: true,
        reason: 'No underwriting model created',
        details: {}
      };
    }
    return { blocked: false };
  },

  /**
   * Check if IC memo has been generated
   */
  async hasICMemo(dealId) {
    const icMemo = await prisma.generatedDocument.findFirst({
      where: {
        dealId,
        documentType: 'IC_MEMO',
        status: { in: ['GENERATED', 'APPROVED'] }
      }
    });

    if (!icMemo) {
      return {
        blocked: true,
        reason: 'IC Memo not generated',
        details: {}
      };
    }
    return { blocked: false };
  },

  /**
   * Check if PSA is executed
   */
  async hasPSAExecuted(dealId) {
    const psa = await prisma.documentVersion.findFirst({
      where: {
        dealId,
        documentType: 'PSA',
        status: 'EXECUTED'
      }
    });

    if (!psa) {
      return {
        blocked: true,
        reason: 'PSA not executed',
        details: {}
      };
    }
    return { blocked: false };
  },

  /**
   * Check if all DD items are complete
   * Uses the DD Checklist AI Assistant for real validation
   */
  async ddItemsComplete(dealId) {
    try {
      // Use the DD Checklist Assistant for real completion check
      const result = await getDDCompletionStatus(dealId);
      return result;
    } catch (error) {
      console.error('[DEAL-STATE] Error checking DD completion:', error);
      // If there's an error (e.g., no checklist), block the transition
      return {
        blocked: true,
        reason: `Unable to verify DD completion: ${error.message}`
      };
    }
  },

  /**
   * Check if loan commitment exists
   */
  async hasLoanCommitment(dealId) {
    // Check for loan commitment document (Artifact is kernel-managed)
    const artifacts = await kernelClient.getArtifacts(dealId, 'LOAN_COMMITMENT');

    if (!artifacts || artifacts.length === 0) {
      return {
        blocked: true,
        reason: 'Loan commitment not received',
        details: {}
      };
    }
    return { blocked: false };
  },

  /**
   * Check if all closing documents are ready
   */
  async allClosingDocsReady(dealId) {
    const requiredDocs = ['CLOSING_STATEMENT', 'TITLE_POLICY', 'LOAN_DOCS'];
    const docs = await prisma.documentVersion.findMany({
      where: {
        dealId,
        documentType: { in: requiredDocs },
        status: { in: ['BINDING', 'EXECUTED'] }
      }
    });

    const foundTypes = new Set(docs.map(d => d.documentType));
    const missing = requiredDocs.filter(t => !foundTypes.has(t));

    if (missing.length > 0) {
      return {
        blocked: true,
        reason: `Missing closing documents: ${missing.join(', ')}`,
        details: { missing }
      };
    }
    return { blocked: false };
  }
};

// =============================================================================
// STATE MACHINE SERVICE
// =============================================================================

class DealStateMachine {
  /**
   * Get or create deal state record
   */
  async getState(dealId) {
    let state = await prisma.dealState.findUnique({
      where: { dealId }
    });

    if (!state) {
      state = await prisma.dealState.create({
        data: {
          dealId,
          currentState: DEAL_STATES.INTAKE_RECEIVED
        }
      });
    }

    return state;
  }

  /**
   * Get available transitions from current state
   */
  async getAvailableTransitions(dealId) {
    const state = await this.getState(dealId);
    const rules = TRANSITION_RULES[state.currentState];

    if (!rules) {
      return [];
    }

    const transitions = [];

    for (const targetState of rules.allowedTransitions) {
      const blockers = await this.checkBlockers(dealId, state.currentState, targetState);
      const requirements = this.getTransitionRequirements(state.currentState, targetState);

      transitions.push({
        targetState,
        requiredApprovals: requirements.requiredApprovals,
        requiredDocuments: requirements.requiredDocuments,
        blockers,
        canTransition: blockers.length === 0
      });
    }

    return transitions;
  }

  /**
   * Get requirements for a specific transition
   */
  getTransitionRequirements(fromState, toState) {
    const rules = TRANSITION_RULES[fromState];
    const targetRules = TRANSITION_RULES[toState];

    return {
      requiredApprovals: targetRules?.requiredApprovals || [],
      requiredDocuments: targetRules?.requiredDocuments || []
    };
  }

  /**
   * Check blockers for a transition
   */
  async checkBlockers(dealId, fromState, toState) {
    const rules = TRANSITION_RULES[fromState];
    const blockerResults = [];

    // Run blocker checks for the target state
    const targetRules = TRANSITION_RULES[toState];
    if (targetRules?.blockerChecks) {
      for (const checkName of targetRules.blockerChecks) {
        const checkFn = blockerChecks[checkName];
        if (checkFn) {
          const result = await checkFn(dealId);
          if (result.blocked) {
            blockerResults.push({
              check: checkName,
              reason: result.reason,
              details: result.details
            });
          }
        }
      }
    }

    return blockerResults;
  }

  /**
   * Validate approvals for a transition
   */
  validateApprovals(requiredApprovals, providedApprovals) {
    const missing = requiredApprovals.filter(
      role => !providedApprovals.some(a => a.role === role && a.approved)
    );
    return {
      valid: missing.length === 0,
      missing
    };
  }

  /**
   * Attempt state transition
   */
  async transition(dealId, toState, actor, options = {}) {
    const state = await this.getState(dealId);
    const fromState = state.currentState;
    const rules = TRANSITION_RULES[fromState];

    // Check if transition is allowed
    if (!rules || !rules.allowedTransitions.includes(toState)) {
      throw new Error(`Transition from ${fromState} to ${toState} is not allowed`);
    }

    // Check blockers
    const blockers = await this.checkBlockers(dealId, fromState, toState);
    if (blockers.length > 0) {
      if (options.force) {
        // AUDIT: Log force bypass for audit trail
        console.warn(`[STATE MACHINE] Force bypass used by ${actor.id} (${actor.name}): ${blockers.map(b => b.reason).join('; ')}`);
        await prisma.permissionAuditLog.create({
          data: {
            actorId: actor.id,
            actorName: actor.name || null,
            targetUserId: actor.id,
            action: 'FORCE_BYPASS_BLOCKERS',
            beforeValue: JSON.stringify({ blockers, fromState }),
            afterValue: JSON.stringify({ toState }),
            reason: options.forceReason || 'No reason provided'
          }
        });
      } else {
        throw new Error(`Transition blocked: ${blockers.map(b => b.reason).join('; ')}`);
      }
    }

    // Validate approvals
    const targetRules = TRANSITION_RULES[toState];
    if (targetRules?.requiredApprovals?.length > 0) {
      const approvalCheck = this.validateApprovals(
        targetRules.requiredApprovals,
        options.approvals || []
      );
      if (!approvalCheck.valid) {
        if (options.force) {
          // AUDIT: Log force bypass of missing approvals
          console.warn(`[STATE MACHINE] Force bypass of approvals by ${actor.id} (${actor.name}): missing ${approvalCheck.missing.join(', ')}`);
          await prisma.permissionAuditLog.create({
            data: {
              actorId: actor.id,
              actorName: actor.name || null,
              targetUserId: actor.id,
              action: 'FORCE_BYPASS_APPROVALS',
              beforeValue: JSON.stringify({ missingApprovals: approvalCheck.missing, fromState }),
              afterValue: JSON.stringify({ toState }),
              reason: options.forceReason || 'No reason provided'
            }
          });
        } else {
          throw new Error(`Missing approvals: ${approvalCheck.missing.join(', ')}`);
        }
      }
    }

    // Perform transition in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Update deal state
      const updatedState = await tx.dealState.update({
        where: { dealId },
        data: {
          currentState: toState,
          enteredStateAt: new Date(),
          lastTransitionBy: actor.id,
          lastTransitionAt: new Date(),
          blockers: null,
          pendingApprovals: null
        }
      });

      // Get previous event for hash chain
      const previousEvent = await tx.dealEvent.findFirst({
        where: { dealId },
        orderBy: { sequenceNumber: 'desc' }
      });

      const sequenceNumber = (previousEvent?.sequenceNumber || 0) + 1;

      // Create event data
      const eventData = {
        fromState,
        toState,
        reason: options.reason,
        approvals: options.approvals,
        blockerOverrides: options.force ? blockers : undefined
      };

      // Calculate event hash
      const eventHash = this.calculateEventHash(
        dealId,
        sequenceNumber,
        'StateTransition',
        eventData,
        previousEvent?.eventHash
      );

      // Record event
      const event = await tx.dealEvent.create({
        data: {
          dealId,
          eventType: 'StateTransition',
          eventData: JSON.stringify(eventData),
          actorId: actor.id,
          actorName: actor.name,
          actorRole: actor.role,
          authorityContext: JSON.stringify({ approvals: options.approvals || [] }),
          evidenceRefs: options.evidenceRefs ? JSON.stringify(options.evidenceRefs) : null,
          sequenceNumber,
          fromState,
          toState,
          previousEventHash: previousEvent?.eventHash || null,
          eventHash
        }
      });

      return { state: updatedState, event };
    });

    return result;
  }

  /**
   * Calculate SHA-256 hash for event integrity chain
   */
  calculateEventHash(dealId, sequenceNumber, eventType, eventData, previousHash) {
    const payload = JSON.stringify({
      dealId,
      sequenceNumber,
      eventType,
      eventData,
      previousHash: previousHash || null,
      timestamp: new Date().toISOString()
    });

    return crypto.createHash('sha256').update(payload).digest('hex');
  }

  /**
   * Record a generic deal event (not a state transition)
   */
  async recordEvent(dealId, eventType, eventData, actor, options = {}) {
    const previousEvent = await prisma.dealEvent.findFirst({
      where: { dealId },
      orderBy: { sequenceNumber: 'desc' }
    });

    const sequenceNumber = (previousEvent?.sequenceNumber || 0) + 1;

    const eventHash = this.calculateEventHash(
      dealId,
      sequenceNumber,
      eventType,
      eventData,
      previousEvent?.eventHash
    );

    const event = await prisma.dealEvent.create({
      data: {
        dealId,
        eventType,
        eventData: JSON.stringify(eventData),
        actorId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        authorityContext: JSON.stringify(options.authorityContext || {}),
        evidenceRefs: options.evidenceRefs ? JSON.stringify(options.evidenceRefs) : null,
        sequenceNumber,
        previousEventHash: previousEvent?.eventHash || null,
        eventHash
      }
    });

    return event;
  }

  /**
   * Get event history for a deal
   */
  async getEventHistory(dealId, options = {}) {
    const { limit = 100, eventType } = options;

    const where = { dealId };
    if (eventType) {
      where.eventType = eventType;
    }

    const events = await prisma.dealEvent.findMany({
      where,
      orderBy: { sequenceNumber: 'desc' },
      take: limit
    });

    return events.map(e => ({
      ...e,
      eventData: JSON.parse(e.eventData),
      authorityContext: JSON.parse(e.authorityContext),
      evidenceRefs: e.evidenceRefs ? JSON.parse(e.evidenceRefs) : null
    }));
  }

  /**
   * Verify event chain integrity
   */
  async verifyEventChain(dealId) {
    const events = await prisma.dealEvent.findMany({
      where: { dealId },
      orderBy: { sequenceNumber: 'asc' }
    });

    const errors = [];

    for (let i = 0; i < events.length; i++) {
      const event = events[i];

      // Check sequence
      if (event.sequenceNumber !== i + 1) {
        errors.push({
          eventId: event.id,
          error: `Sequence gap: expected ${i + 1}, got ${event.sequenceNumber}`
        });
      }

      // Check hash chain
      if (i > 0) {
        const previousEvent = events[i - 1];
        if (event.previousEventHash !== previousEvent.eventHash) {
          errors.push({
            eventId: event.id,
            error: 'Hash chain broken: previous hash mismatch'
          });
        }
      }
    }

    return {
      valid: errors.length === 0,
      eventCount: events.length,
      errors
    };
  }

  /**
   * Get current blockers for a deal
   */
  async getCurrentBlockers(dealId) {
    const state = await this.getState(dealId);
    const transitions = await this.getAvailableTransitions(dealId);

    // Collect all unique blockers
    const allBlockers = new Map();

    for (const t of transitions) {
      for (const blocker of t.blockers) {
        allBlockers.set(blocker.check, blocker);
      }
    }

    return {
      currentState: state.currentState,
      blockers: Array.from(allBlockers.values())
    };
  }
}

// Export singleton instance
const dealStateMachine = new DealStateMachine();

export {
  dealStateMachine,
  DealStateMachine,
  DEAL_STATES,
  ROLES,
  TRANSITION_RULES
};
