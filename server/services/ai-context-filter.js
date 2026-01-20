/**
 * AI Context Filter Service
 *
 * Filters data before it reaches the AI/LLM to enforce the same access controls
 * as the rest of the platform. Core principle: if a user cannot see data X in
 * the UI, the AI must not see data X either.
 *
 * SECURITY: This is the primary defense against AI data leakage. All data sent
 * to LLMs MUST go through these filters.
 */

import { getPrisma } from '../db.js';
import { canPerform, getDealVisibility, PERMISSIONS } from '../../src/lib/permissions.js';

// =============================================================================
// DEBUG LOGGING
// =============================================================================

const DEBUG_AI_FILTER = process.env.DEBUG_AI_FILTER === 'true' || true; // Enable by default for now

function logFilter(category, message, data = null) {
  if (!DEBUG_AI_FILTER) return;
  const timestamp = new Date().toISOString();
  const prefix = `[AI-FILTER][${category}]`;
  if (data) {
    console.log(`${timestamp} ${prefix} ${message}`, JSON.stringify(data, null, 2));
  } else {
    console.log(`${timestamp} ${prefix} ${message}`);
  }
}

function logFilterDecision(field, decision, reason) {
  if (!DEBUG_AI_FILTER) return;
  const symbol = decision ? '✓' : '✗';
  console.log(`  ${symbol} ${field}: ${decision ? 'INCLUDED' : 'EXCLUDED'} - ${reason}`);
}

// =============================================================================
// ROLE-BASED FIELD MASKS
// =============================================================================

/**
 * Defines what each role can see in AI context.
 * These match the UI access controls.
 */
const ROLE_CONTEXT_MASKS = {
  LP: {
    // LPs have very restricted access
    deal: ['id', 'status', 'name', 'assetType', 'property_type'],
    property: ['asset_address', 'asset_city', 'asset_state', 'property_type', 'year_built'],
    investment: true,           // Own investment data only
    documents: 'LP_VISIBLE',    // Per LPDocumentPermission
    financials: false,          // No underwriting model
    lpList: false,              // Cannot see other LPs
    communications: false,      // No deal team messages
    extractionClaims: false,    // No raw AI extractions
    conflicts: false,           // No internal conflicts
    scenarios: false,           // No scenario analysis
    benchmarks: false,          // No market benchmarks
    tasks: false,               // No workflow tasks
    auditLogs: false,           // No audit logs
  },

  'GP Analyst': {
    deal: 'ALL',
    property: 'ALL',
    investment: 'ALL',
    documents: 'DEAL_DOCUMENTS',
    financials: true,
    lpList: true,
    communications: 'DEAL_RELATED',
    extractionClaims: true,
    conflicts: true,
    scenarios: true,
    benchmarks: true,
    tasks: 'ASSIGNED',          // Only assigned tasks
    auditLogs: false,           // No audit logs
  },

  Counsel: {
    deal: ['id', 'status', 'name', 'assetType'],
    property: ['asset_address', 'asset_city', 'asset_state'],
    investment: false,
    documents: 'LEGAL_DOCUMENTS',
    financials: 'SUMMARY_ONLY', // High-level metrics only
    lpList: false,
    communications: false,
    extractionClaims: false,
    conflicts: false,
    scenarios: false,
    benchmarks: false,
    tasks: 'ASSIGNED',
    auditLogs: false,
  },

  Lender: {
    deal: 'ALL',
    property: 'ALL',
    investment: false,          // No LP details
    documents: 'LOAN_DOCUMENTS',
    financials: true,           // Full financial access
    lpList: false,              // No LP details
    communications: false,
    extractionClaims: true,
    conflicts: true,
    scenarios: true,
    benchmarks: true,
    tasks: 'ASSIGNED',
    auditLogs: false,
  },

  Regulator: {
    deal: 'ALL',
    property: 'ALL',
    investment: 'ALL',
    documents: 'ALL',
    financials: true,
    lpList: true,
    communications: false,      // No internal comms
    extractionClaims: true,
    conflicts: true,
    scenarios: true,
    benchmarks: true,
    tasks: 'ALL',
    auditLogs: false,           // Regulators see deal data, not user actions
  },

  Auditor: {
    deal: 'ALL',
    property: 'ALL',
    investment: 'ALL',
    documents: 'ALL',
    financials: true,
    lpList: true,
    communications: false,
    extractionClaims: true,
    conflicts: true,
    scenarios: true,
    benchmarks: true,
    tasks: 'ALL',
    auditLogs: true,            // Auditors can see audit logs
  },

  GP: {
    deal: 'ALL',
    property: 'ALL',
    investment: 'ALL',
    documents: 'ALL',
    financials: true,
    lpList: true,
    communications: 'DEAL_RELATED',
    extractionClaims: true,
    conflicts: true,
    scenarios: true,
    benchmarks: true,
    tasks: 'ALL',
    auditLogs: false,
  },

  Admin: {
    // Admin has full access within their organization
    deal: 'ALL',
    property: 'ALL',
    investment: 'ALL',
    documents: 'ALL',
    financials: true,
    lpList: true,
    communications: 'DEAL_RELATED',
    extractionClaims: true,
    conflicts: true,
    scenarios: true,
    benchmarks: true,
    tasks: 'ALL',
    auditLogs: true,
  },
};

// =============================================================================
// MAIN FILTER FUNCTION
// =============================================================================

/**
 * Filter deal context based on user's role and entitlements.
 * This is the main entry point - ALL AI context must go through this.
 *
 * @param {Object} fullContext - Complete deal context from buildDealContext()
 * @param {Object} authUser - Authenticated user from JWT
 * @param {string} dealId - The deal being accessed
 * @returns {Object} Filtered context safe to send to LLM
 */
export async function filterContextForUser(fullContext, authUser, dealId) {
  logFilter('START', `=== Filtering context for deal ${dealId} ===`);

  if (!authUser) {
    logFilter('ERROR', 'No authUser provided - rejecting request');
    throw new Error('Authentication required for AI context access');
  }

  const { role, id: userId, email, organizationId } = authUser;
  logFilter('AUTH', `User: ${userId}, Role: ${role}, Org: ${organizationId}, Email: ${email}`);

  const prisma = getPrisma();

  // Get the role's access mask
  const mask = ROLE_CONTEXT_MASKS[role];
  if (!mask) {
    logFilter('ERROR', `Unknown role "${role}" - denying all access`);
    console.warn(`Unknown role "${role}" for AI context filtering, denying access`);
    throw new Error(`Role "${role}" does not have AI access defined`);
  }

  logFilter('MASK', `Loaded access mask for role "${role}"`, {
    deal: mask.deal,
    property: mask.property,
    financials: mask.financials,
    lpList: mask.lpList,
    documents: mask.documents,
    extractionClaims: mask.extractionClaims,
    conflicts: mask.conflicts,
    scenarios: mask.scenarios,
  });

  // Initialize filtered context with safe metadata
  const filtered = {
    dealId: fullContext.dealId,
    dealName: fullContext.dealName,
    status: fullContext.status,
    meta: {
      contextBuiltAt: fullContext.meta?.contextBuiltAt,
      filteredForRole: role,
      filteredAt: new Date().toISOString(),
    },
  };

  // 1. LP: Most restrictive path
  if (role === 'LP') {
    logFilter('PATH', 'Taking LP filtering path (most restrictive)');
    return await filterForLP(fullContext, authUser, dealId, mask, prisma);
  }

  // 2. Check deal assignment for roles that require it
  if (['GP Analyst', 'Counsel', 'Lender'].includes(role)) {
    logFilter('ASSIGN', `Checking deal assignment for ${role}...`);
    const isAssigned = await checkDealAssignment(userId, dealId, prisma);
    const visibility = getDealVisibility(role);

    logFilter('ASSIGN', `Assignment check: isAssigned=${isAssigned}, visibility=${visibility}`);

    if (visibility === 'assigned' && !isAssigned) {
      logFilter('DENY', `User not assigned to deal - access denied`);
      throw new Error('Not assigned to this deal');
    }
  }

  // 3. Apply role-specific filtering
  logFilter('FILTER', `Applying field-by-field filtering for role "${role}":`);

  // Deal info
  if (mask.deal === 'ALL') {
    filtered.dealName = fullContext.dealName;
    filtered.createdAt = fullContext.createdAt;
    logFilterDecision('deal', true, 'Full access (ALL)');
  } else if (Array.isArray(mask.deal)) {
    filtered.dealName = fullContext.dealName;
    logFilterDecision('deal', true, `Limited fields: ${mask.deal.join(', ')}`);
  } else {
    logFilterDecision('deal', false, 'No deal access configured');
  }

  // Property info
  if (mask.property === 'ALL') {
    filtered.property = fullContext.property;
    logFilterDecision('property', true, 'Full access (ALL)');
  } else if (Array.isArray(mask.property)) {
    filtered.property = filterObjectFields(fullContext.property, mask.property);
    logFilterDecision('property', true, `Limited fields: ${mask.property.join(', ')}`);
  } else {
    logFilterDecision('property', false, 'No property access configured');
  }

  // Financials (underwriting model and returns)
  if (mask.financials === true) {
    filtered.model = fullContext.model;
    filtered.calculatedReturns = fullContext.calculatedReturns;
    logFilterDecision('financials', true, 'Full financial access');
  } else if (mask.financials === 'SUMMARY_ONLY') {
    filtered.calculatedReturns = fullContext.calculatedReturns ? {
      goingInCapRate: fullContext.calculatedReturns.goingInCapRate,
      dscr: fullContext.calculatedReturns.dscr,
      ltv: fullContext.calculatedReturns.ltv,
    } : null;
    logFilterDecision('financials', true, 'Summary only (capRate, dscr, ltv)');
  } else {
    logFilterDecision('financials', false, 'No financial access');
  }

  // LP list
  if (mask.lpList === true) {
    filtered.lpInvestors = fullContext.lpInvestors;
    logFilterDecision('lpList', true, `Included ${fullContext.lpInvestors?.length || 0} LP investors`);
  } else {
    logFilterDecision('lpList', false, 'LP list hidden');
  }

  // Documents
  filtered.documents = await filterDocumentsForUser(
    fullContext.documents,
    authUser,
    dealId,
    mask.documents,
    prisma
  );
  logFilterDecision('documents', true, `${filtered.documents?.length || 0} of ${fullContext.documents?.length || 0} docs (access: ${mask.documents})`);

  // Extraction claims
  if (mask.extractionClaims === true) {
    filtered.extractions = fullContext.extractions;
    logFilterDecision('extractions', true, `${fullContext.extractions?.length || 0} extraction claims`);
  } else {
    logFilterDecision('extractions', false, 'Extraction claims hidden');
  }

  // Conflicts
  if (mask.conflicts === true) {
    filtered.conflicts = fullContext.conflicts;
    logFilterDecision('conflicts', true, `${fullContext.conflicts?.length || 0} conflicts`);
  } else {
    logFilterDecision('conflicts', false, 'Conflicts hidden');
  }

  // Scenarios
  if (mask.scenarios === true) {
    filtered.scenarios = fullContext.scenarios;
    logFilterDecision('scenarios', true, `${fullContext.scenarios?.length || 0} scenarios`);
  } else {
    logFilterDecision('scenarios', false, 'Scenarios hidden');
  }

  // Benchmarks
  if (mask.benchmarks === true) {
    filtered.benchmarks = fullContext.benchmarks;
    logFilterDecision('benchmarks', true, 'Market benchmarks included');
  } else {
    logFilterDecision('benchmarks', false, 'Benchmarks hidden');
  }

  // Tasks
  if (mask.tasks === 'ALL') {
    filtered.tasks = fullContext.tasks;
    logFilterDecision('tasks', true, `All ${fullContext.tasks?.length || 0} tasks`);
  } else if (mask.tasks === 'ASSIGNED') {
    filtered.tasks = await filterTasksForUser(fullContext.tasks, userId, dealId, prisma);
    logFilterDecision('tasks', true, `${filtered.tasks?.length || 0} assigned tasks of ${fullContext.tasks?.length || 0}`);
  } else {
    logFilterDecision('tasks', false, 'Tasks hidden');
  }

  // Input provenance
  if (mask.financials === true) {
    filtered.inputProvenance = fullContext.inputProvenance;
    logFilterDecision('inputProvenance', true, 'Input provenance included');
  } else {
    logFilterDecision('inputProvenance', false, 'Input provenance hidden');
  }

  // Update meta
  filtered.meta.hasModel = !!filtered.model;
  filtered.meta.documentCount = filtered.documents?.length || 0;
  filtered.meta.scenarioCount = filtered.scenarios?.length || 0;

  logFilter('COMPLETE', `Context filtering complete for ${role}`, {
    hasModel: filtered.meta.hasModel,
    documentCount: filtered.meta.documentCount,
    scenarioCount: filtered.meta.scenarioCount,
    lpCount: filtered.lpInvestors?.length || 0,
    extractionCount: filtered.extractions?.length || 0,
  });

  return filtered;
}

// =============================================================================
// LP-SPECIFIC FILTERING
// =============================================================================

/**
 * Filter context for LP users - most restrictive access level
 */
async function filterForLP(fullContext, authUser, dealId, mask, prisma) {
  const { email } = authUser;
  logFilter('LP', `Filtering for LP: ${email}`);

  // Verify LP has access to this deal
  const lpActor = await prisma.lPActor.findUnique({
    where: {
      email_dealId: {
        email: email.toLowerCase(),
        dealId,
      },
    },
  });

  if (!lpActor || lpActor.status !== 'ACTIVE') {
    logFilter('LP-DENY', `LP ${email} does not have active investment in deal ${dealId}`);
    throw new Error('LP does not have an active investment in this deal');
  }

  logFilter('LP', `Found LP actor: ${lpActor.entityName}, status: ${lpActor.status}, commitment: ${lpActor.commitment}`);

  const filtered = {
    dealId: fullContext.dealId,
    dealName: fullContext.dealName,
    status: fullContext.status,
    meta: {
      contextBuiltAt: fullContext.meta?.contextBuiltAt,
      filteredForRole: 'LP',
      filteredAt: new Date().toISOString(),
    },
  };

  // Property: basic info only
  if (fullContext.property && Array.isArray(mask.property)) {
    filtered.property = filterObjectFields(fullContext.property, mask.property);
    logFilterDecision('property', true, `LP sees: ${mask.property.join(', ')}`);
  }

  // Investment: LP's own investment data only
  filtered.myInvestment = {
    entityName: lpActor.entityName,
    commitment: lpActor.commitment,
    ownershipPct: lpActor.ownershipPct,
    status: lpActor.status,
  };
  logFilterDecision('myInvestment', true, `Own investment only (${lpActor.entityName})`);

  // Capital calls for this LP
  const capitalCalls = await prisma.capitalCallAllocation?.findMany({
    where: { lpActorId: lpActor.id },
    include: { capitalCall: true },
  });
  if (capitalCalls) {
    filtered.myCapitalCalls = capitalCalls.map(alloc => ({
      amount: alloc.amount,
      status: alloc.status,
      dueDate: alloc.capitalCall?.dueDate,
      purpose: alloc.capitalCall?.purpose,
    }));
    logFilterDecision('capitalCalls', true, `${capitalCalls.length} capital calls for this LP`);
  } else {
    logFilterDecision('capitalCalls', true, 'No capital calls found');
  }

  // Distributions for this LP
  const distributions = await prisma.distributionAllocation?.findMany({
    where: { lpActorId: lpActor.id },
    include: { distribution: true },
  });
  if (distributions) {
    filtered.myDistributions = distributions.map(alloc => ({
      amount: alloc.amount,
      status: alloc.status,
      date: alloc.distribution?.distributionDate,
      type: alloc.distribution?.distributionType,
    }));
    logFilterDecision('distributions', true, `${distributions.length} distributions for this LP`);
  } else {
    logFilterDecision('distributions', true, 'No distributions found');
  }

  // Documents: only LP-visible documents with permissions
  filtered.documents = await filterDocumentsForLP(fullContext.documents, lpActor.id, dealId, prisma);
  logFilterDecision('documents', true, `${filtered.documents?.length || 0} LP-visible documents`);

  // EXPLICITLY EXCLUDED for LPs - log what we're NOT including
  logFilterDecision('financials', false, 'LP cannot see underwriting model');
  logFilterDecision('lpList', false, 'LP cannot see other investors');
  logFilterDecision('extractions', false, 'LP cannot see AI extractions');
  logFilterDecision('conflicts', false, 'LP cannot see data conflicts');
  logFilterDecision('scenarios', false, 'LP cannot see scenarios');
  logFilterDecision('benchmarks', false, 'LP cannot see benchmarks');
  logFilterDecision('tasks', false, 'LP cannot see workflow tasks');

  // No financials, conflicts, scenarios, tasks, extraction claims, etc.
  filtered.meta.hasModel = false;
  filtered.meta.documentCount = filtered.documents?.length || 0;
  filtered.meta.scenarioCount = 0;

  logFilter('LP-COMPLETE', `LP context filtering complete`, {
    hasInvestment: true,
    capitalCallCount: filtered.myCapitalCalls?.length || 0,
    distributionCount: filtered.myDistributions?.length || 0,
    documentCount: filtered.meta.documentCount,
  });

  return filtered;
}

// =============================================================================
// DOCUMENT FILTERING
// =============================================================================

/**
 * Filter documents based on role and document permissions
 */
async function filterDocumentsForUser(documents, authUser, dealId, accessLevel, prisma) {
  if (!documents || documents.length === 0) return [];

  // GP/Admin: full access
  if (accessLevel === 'ALL') {
    return documents;
  }

  // Deal documents (for analysts)
  if (accessLevel === 'DEAL_DOCUMENTS') {
    return documents;
  }

  // Legal documents only (for counsel)
  if (accessLevel === 'LEGAL_DOCUMENTS') {
    const legalTypes = ['CONTRACT', 'AGREEMENT', 'LEGAL', 'COMPLIANCE', 'PPM', 'SUBSCRIPTION'];
    return documents.filter(doc =>
      legalTypes.some(type =>
        doc.type?.toUpperCase().includes(type) ||
        doc.name?.toUpperCase().includes(type)
      )
    );
  }

  // Loan documents only (for lenders)
  if (accessLevel === 'LOAN_DOCUMENTS') {
    const loanTypes = ['LOAN', 'TERM_SHEET', 'CREDIT', 'DEBT', 'MORTGAGE', 'APPRAISAL', 'FINANCIAL'];
    return documents.filter(doc =>
      loanTypes.some(type =>
        doc.type?.toUpperCase().includes(type) ||
        doc.name?.toUpperCase().includes(type)
      )
    );
  }

  // LP visible documents (uses LP document permission system)
  if (accessLevel === 'LP_VISIBLE') {
    // This should be handled by filterDocumentsForLP instead
    return [];
  }

  return [];
}

/**
 * Filter documents for LP using the LP document permission system
 */
async function filterDocumentsForLP(documents, lpActorId, dealId, prisma) {
  if (!documents || documents.length === 0) return [];

  // Get LP documents with visibility settings
  const lpDocuments = await prisma.lPDocument?.findMany({
    where: {
      dealId,
      status: 'PUBLISHED',
    },
    include: {
      permissions: {
        where: { lpActorId },
      },
    },
  });

  if (!lpDocuments) return [];

  // Filter based on visibility
  return lpDocuments.filter(doc => {
    // ALL_LPS visibility - any LP can see
    if (doc.visibility === 'ALL_LPS') return true;

    // SPECIFIC_LPS - check if LP has permission
    if (doc.visibility === 'SPECIFIC_LPS') {
      return doc.permissions.some(p => p.canView && !p.revokedAt);
    }

    return false;
  }).map(doc => ({
    id: doc.id,
    name: doc.filename,
    type: doc.documentType,
    uploadedAt: doc.uploadedAt,
  }));
}

// =============================================================================
// TASK FILTERING
// =============================================================================

/**
 * Filter tasks for users who only see assigned tasks
 */
async function filterTasksForUser(tasks, userId, dealId, prisma) {
  if (!tasks || tasks.length === 0) return [];

  // Get tasks assigned to this user
  const assignedTasks = await prisma.workflowTask?.findMany({
    where: {
      dealId,
      OR: [
        { assigneeId: userId },
        { createdById: userId },
      ],
    },
    select: { id: true },
  });

  if (!assignedTasks) return [];

  const assignedIds = new Set(assignedTasks.map(t => t.id));
  return tasks.filter(t => assignedIds.has(t.id));
}

// =============================================================================
// DEAL ASSIGNMENT CHECK
// =============================================================================

/**
 * Check if a user is assigned to a deal
 */
async function checkDealAssignment(userId, dealId, prisma) {
  // Check DealAssignment table if it exists
  const assignment = await prisma.dealAssignment?.findFirst({
    where: { userId, dealId },
  });

  return !!assignment;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Filter object to only include specified fields
 */
function filterObjectFields(obj, allowedFields) {
  if (!obj) return null;

  const filtered = {};
  for (const field of allowedFields) {
    if (obj[field] !== undefined) {
      filtered[field] = obj[field];
    }
  }
  return filtered;
}

// =============================================================================
// CONVERSATION HISTORY FILTERING
// =============================================================================

/**
 * Filter conversation history before sending to LLM.
 *
 * SECURITY: Prevents data leakage when users with different roles share
 * the same conversation thread. Ensures each user only sees responses
 * appropriate for their access level.
 *
 * Risk addressed: If a GP starts a conversation asking about confidential
 * financials, and then an LP continues in the same thread, the LP could
 * potentially see GP-level data leaked through the conversation history.
 *
 * @param {Array} conversationHistory - Array of {role, content} messages
 * @param {Object} authUser - Authenticated user from JWT
 * @param {string} dealId - The deal being discussed
 * @returns {Array} Filtered conversation history safe for this user's role
 */
export function filterConversationHistory(conversationHistory, authUser, dealId) {
  logFilter('HISTORY', `=== Filtering conversation history for ${authUser?.role || 'unknown'} ===`);

  if (!conversationHistory || conversationHistory.length === 0) {
    logFilter('HISTORY', 'No history to filter');
    return [];
  }

  if (!authUser) {
    logFilter('HISTORY', 'No authUser - returning empty history');
    return [];
  }

  const { role, organizationId } = authUser;
  const mask = ROLE_CONTEXT_MASKS[role];

  if (!mask) {
    logFilter('HISTORY', `No mask for role ${role} - returning empty history`);
    return [];
  }

  logFilter('HISTORY', `Processing ${conversationHistory.length} messages for role ${role}`);

  // Define sensitive patterns that should be redacted for restricted roles
  const sensitivePatterns = {
    // Financial data patterns
    financials: [
      /\birr\b.*?(\d+\.?\d*%?)/gi,
      /\bequity\s*multiple\b.*?(\d+\.?\d*x?)/gi,
      /\bcash.on.cash\b.*?(\d+\.?\d*%?)/gi,
      /\bltv\b.*?(\d+\.?\d*%?)/gi,
      /\bdscr\b.*?(\d+\.?\d*x?)/gi,
      /\bcap\s*rate\b.*?(\d+\.?\d*%?)/gi,
      /\bnoi\b.*?\$?(\d[\d,]*)/gi,
      /\bloan\s*amount\b.*?\$?(\d[\d,]*)/gi,
      /\bpurchase\s*price\b.*?\$?(\d[\d,]*)/gi,
    ],
    // LP data patterns
    lpData: [
      /\blp\s*(commitment|investor|allocation)s?\b.*?\$?(\d[\d,]*)/gi,
      /\b(investor|lp)\s+([A-Z][a-z]+\s*)+.*?committed/gi,
      /\b(ownership|equity)\s*(%|percent).*?(\d+\.?\d*)/gi,
    ],
    // Internal notes patterns
    internalNotes: [
      /\b(internal|confidential|gp.only)\b.*$/gim,
      /\bnote\s*to\s*(team|gp|self)\b.*$/gim,
    ],
  };

  // Determine which patterns to redact based on role
  const patternsToRedact = [];

  if (mask.financials !== true && mask.financials !== 'SUMMARY_ONLY') {
    patternsToRedact.push(...sensitivePatterns.financials);
    logFilter('HISTORY', 'Will redact financial patterns (no financial access)');
  }

  if (mask.lpList !== true) {
    patternsToRedact.push(...sensitivePatterns.lpData);
    logFilter('HISTORY', 'Will redact LP data patterns (no LP list access)');
  }

  if (role === 'LP') {
    patternsToRedact.push(...sensitivePatterns.internalNotes);
    logFilter('HISTORY', 'Will redact internal notes (LP role)');
  }

  let redactedCount = 0;
  let passedCount = 0;

  const filteredHistory = conversationHistory.map(message => {
    // Always pass through user messages unmodified (they came from this user)
    if (message.role === 'user') {
      passedCount++;
      return message;
    }

    // Filter assistant (AI) responses
    let content = message.content;
    let wasRedacted = false;

    for (const pattern of patternsToRedact) {
      const originalContent = content;
      content = content.replace(pattern, (match) => {
        wasRedacted = true;
        return '[REDACTED - Access Restricted]';
      });
    }

    if (wasRedacted) {
      redactedCount++;
      logFilter('HISTORY', `Redacted sensitive content in message: ${message.content.substring(0, 50)}...`);
    } else {
      passedCount++;
    }

    return {
      ...message,
      content,
    };
  });

  // For LP role, also limit history depth to reduce exposure risk
  let result = filteredHistory;
  if (role === 'LP') {
    // LPs only see last 5 messages to minimize risk
    result = filteredHistory.slice(-5);
    logFilter('HISTORY', `LP role: limited history to last 5 messages`);
  } else {
    // Other roles get last 10
    result = filteredHistory.slice(-10);
  }

  logFilter('HISTORY', `History filtering complete: ${passedCount} passed, ${redactedCount} redacted, returning ${result.length} messages`);

  return result;
}

// =============================================================================
// RAG FACT FILTERING
// =============================================================================

/**
 * Filter RAG facts based on user's role
 * Used to ensure citation service respects access controls
 */
export function filterFactsForUser(facts, authUser) {
  logFilter('RAG', `=== Filtering RAG facts for ${authUser?.role || 'unknown'} ===`);

  if (!facts || facts.length === 0) {
    logFilter('RAG', 'No facts to filter');
    return [];
  }

  const { role, organizationId } = authUser;
  const mask = ROLE_CONTEXT_MASKS[role];

  if (!mask) {
    logFilter('RAG', `No mask for role ${role} - returning empty`);
    return [];
  }

  logFilter('RAG', `Filtering ${facts.length} facts for role ${role}, org ${organizationId}`);

  let orgFiltered = 0;
  let roleFiltered = 0;
  let passed = 0;

  const filtered = facts.filter(fact => {
    // Always filter by organization
    if (fact.metadata?.organizationId && fact.metadata.organizationId !== organizationId) {
      orgFiltered++;
      return false;
    }

    // LP: only verified claims from LP-visible documents
    if (role === 'LP') {
      // LPs cannot see extraction claims or financial data
      roleFiltered++;
      return false;
    }

    // Check if role can see this type of data
    const factType = fact.type;

    // Extraction claims
    if (factType === 'VERIFIED_CLAIM' || factType === 'UNDERWRITING_INPUT') {
      if (mask.extractionClaims !== true) {
        roleFiltered++;
        return false;
      }
    }

    // Model values (financials)
    if (factType === 'MODEL_VALUE') {
      if (mask.financials !== true && mask.financials !== 'SUMMARY_ONLY') {
        roleFiltered++;
        return false;
      }
    }

    // Conflicts
    if (factType === 'CONFLICT') {
      if (mask.conflicts !== true) {
        roleFiltered++;
        return false;
      }
    }

    passed++;
    return true;
  });

  logFilter('RAG', `RAG filtering complete: ${passed} passed, ${orgFiltered} org-filtered, ${roleFiltered} role-filtered`);

  return filtered;
}

// =============================================================================
// DATA SOURCE PERMISSIONS (For future external integrations)
// =============================================================================

/**
 * Data source access permissions for future integrations
 * SECURITY: External sources (Slack, email) are blocked by default
 */
export const DATA_SOURCE_PERMISSIONS = {
  // Internal platform data - role-based
  DEAL_DATABASE: ['GP', 'GP Analyst', 'Admin', 'LP', 'Counsel', 'Lender', 'Regulator', 'Auditor'],
  UNDERWRITING_MODEL: ['GP', 'GP Analyst', 'Admin', 'Lender', 'Regulator', 'Auditor'],
  EXTRACTION_CLAIMS: ['GP', 'GP Analyst', 'Admin', 'Lender', 'Regulator', 'Auditor'],
  LP_DATA: ['GP', 'GP Analyst', 'Admin', 'Regulator', 'Auditor'],

  // External sources - NEVER by default, requires explicit permission
  SLACK_MESSAGES: [],
  EMAIL_THREADS: [],
  EXTERNAL_DOCUMENTS: [],
};

/**
 * Check if a role can access a data source
 */
export function canAccessDataSource(role, dataSource) {
  const allowedRoles = DATA_SOURCE_PERMISSIONS[dataSource];
  if (!allowedRoles) return false;
  return allowedRoles.includes(role);
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
  ROLE_CONTEXT_MASKS,
  filterDocumentsForUser,
  filterDocumentsForLP,
  filterTasksForUser,
  checkDealAssignment,
};

export default {
  filterContextForUser,
  filterConversationHistory,
  filterFactsForUser,
  canAccessDataSource,
  ROLE_CONTEXT_MASKS,
  DATA_SOURCE_PERMISSIONS,
};
