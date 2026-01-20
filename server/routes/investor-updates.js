/**
 * Investor Updates Routes
 *
 * Handles creation and viewing of investor updates (quarterly reports, milestones, alerts).
 * GP creates updates → publishes → LPs view with optional Q&A.
 */

import { getPrisma } from "../db.js";
import { extractAuthUser } from "./auth.js";
import { readStore } from "../store.js";
import crypto from "node:crypto";

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
 * Require GP or Admin role for GP-only endpoints
 * Returns the authenticated user or null (and sends error response)
 */
async function requireGP(req, res) {
  const user = await extractAuthUser(req);
  if (!user) {
    sendError(res, 401, "Not authenticated");
    return null;
  }
  if (!['GP', 'Admin'].includes(user.role)) {
    sendError(res, 403, "GP or Admin role required");
    return null;
  }
  if (user.status !== 'ACTIVE') {
    sendError(res, 403, "Account not active");
    return null;
  }
  return user;
}

/**
 * Check organization isolation for a deal
 * Returns authUser if access granted, null if denied (response already sent)
 */
async function requireDealOrgAccess(req, res, dealId) {
  const authUser = await extractAuthUser(req);
  if (!authUser) {
    sendError(res, 401, "Not authenticated");
    return null;
  }

  const store = await readStore();
  const record = store.dealIndex.find((item) => item.id === dealId);

  if (!record) {
    sendError(res, 404, "Deal not found");
    return null;
  }

  // Enforce org isolation
  if (record.organizationId && record.organizationId !== authUser.organizationId) {
    sendError(res, 403, "Access denied - deal belongs to different organization");
    return null;
  }

  return authUser;
}

/**
 * List investor updates for a deal
 * GET /api/deals/:dealId/investor-updates
 */
export async function handleListInvestorUpdates(req, res, dealId) {
  // Organization isolation check
  const authUser = await requireDealOrgAccess(req, res, dealId);
  if (!authUser) return;

  const prisma = getPrisma();

  const updates = await prisma.investorUpdate.findMany({
    where: { dealId },
    orderBy: { createdAt: 'desc' }
  });

  sendJson(res, 200, {
    updates: updates.map(u => ({
      id: u.id,
      dealId: u.dealId,
      title: u.title,
      updateType: u.updateType,
      period: u.period,
      status: u.status,
      publishedAt: u.publishedAt?.toISOString(),
      scheduledFor: u.scheduledFor?.toISOString(),
      headline: u.headline,
      createdBy: u.createdBy,
      createdByName: u.createdByName,
      createdAt: u.createdAt.toISOString()
    }))
  });
}

/**
 * Get single investor update
 * GET /api/deals/:dealId/investor-updates/:updateId
 */
export async function handleGetInvestorUpdate(req, res, dealId, updateId) {
  // Organization isolation check
  const authUser = await requireDealOrgAccess(req, res, dealId);
  if (!authUser) return;

  const prisma = getPrisma();

  const update = await prisma.investorUpdate.findFirst({
    where: { id: updateId, dealId }
  });

  if (!update) {
    return sendError(res, 404, "Update not found");
  }

  // Parse JSON fields
  let whatChanged = null;
  let metrics = null;
  let planVsActual = null;
  let risksAndMitigations = null;
  let nextQuarterPriorities = null;
  let attachmentIds = null;

  try {
    if (update.whatChanged) whatChanged = JSON.parse(update.whatChanged);
    if (update.metrics) metrics = JSON.parse(update.metrics);
    if (update.planVsActual) planVsActual = JSON.parse(update.planVsActual);
    if (update.risksAndMitigations) risksAndMitigations = JSON.parse(update.risksAndMitigations);
    if (update.nextQuarterPriorities) nextQuarterPriorities = JSON.parse(update.nextQuarterPriorities);
    if (update.attachmentIds) attachmentIds = JSON.parse(update.attachmentIds);
  } catch (e) {
    // Keep as strings if parsing fails
  }

  sendJson(res, 200, {
    update: {
      id: update.id,
      dealId: update.dealId,
      title: update.title,
      updateType: update.updateType,
      period: update.period,
      status: update.status,
      publishedAt: update.publishedAt?.toISOString(),
      scheduledFor: update.scheduledFor?.toISOString(),
      headline: update.headline,
      whatChanged: whatChanged || update.whatChanged,
      metrics: metrics || update.metrics,
      planVsActual: planVsActual || update.planVsActual,
      risksAndMitigations: risksAndMitigations || update.risksAndMitigations,
      nextQuarterPriorities: nextQuarterPriorities || update.nextQuarterPriorities,
      attachmentIds: attachmentIds || update.attachmentIds,
      createdBy: update.createdBy,
      createdByName: update.createdByName,
      createdAt: update.createdAt.toISOString(),
      updatedAt: update.updatedAt.toISOString()
    }
  });
}

/**
 * Create an investor update (GP only)
 * POST /api/deals/:dealId/investor-updates
 */
export async function handleCreateInvestorUpdate(req, res, dealId, readJsonBody, userId, userName) {
  const authUser = await requireGP(req, res);
  if (!authUser) return;

  const body = await readJsonBody(req);

  if (!body?.title) {
    return sendError(res, 400, "title is required");
  }

  const prisma = getPrisma();

  // Verify deal exists
  const deal = await prisma.deal.findUnique({ where: { id: dealId } });
  if (!deal) {
    return sendError(res, 404, "Deal not found");
  }

  const update = await prisma.investorUpdate.create({
    data: {
      id: crypto.randomUUID(),
      dealId,
      title: body.title,
      updateType: body.updateType || 'QUARTERLY_UPDATE',
      period: body.period || null,
      status: 'DRAFT',
      headline: body.headline || null,
      whatChanged: body.whatChanged ? JSON.stringify(body.whatChanged) : null,
      metrics: body.metrics ? JSON.stringify(body.metrics) : null,
      planVsActual: body.planVsActual ? JSON.stringify(body.planVsActual) : null,
      risksAndMitigations: body.risksAndMitigations ? JSON.stringify(body.risksAndMitigations) : null,
      nextQuarterPriorities: body.nextQuarterPriorities ? JSON.stringify(body.nextQuarterPriorities) : null,
      attachmentIds: body.attachmentIds ? JSON.stringify(body.attachmentIds) : null,
      createdBy: userId,
      createdByName: userName || 'Unknown'
    }
  });

  console.log(`[Investor Updates] Created update ${update.id} for deal ${dealId}`);

  sendJson(res, 201, {
    update: {
      id: update.id,
      dealId: update.dealId,
      title: update.title,
      updateType: update.updateType,
      status: update.status
    }
  });
}

/**
 * Update an investor update (GP only, draft only)
 * PATCH /api/deals/:dealId/investor-updates/:updateId
 */
export async function handleUpdateInvestorUpdate(req, res, dealId, updateId, readJsonBody) {
  const authUser = await requireGP(req, res);
  if (!authUser) return;

  const body = await readJsonBody(req);
  const prisma = getPrisma();

  const update = await prisma.investorUpdate.findFirst({
    where: { id: updateId, dealId }
  });

  if (!update) {
    return sendError(res, 404, "Update not found");
  }

  if (update.status === 'PUBLISHED') {
    return sendError(res, 400, "Cannot edit published updates");
  }

  const updated = await prisma.investorUpdate.update({
    where: { id: updateId },
    data: {
      title: body.title ?? undefined,
      updateType: body.updateType ?? undefined,
      period: body.period ?? undefined,
      headline: body.headline ?? undefined,
      whatChanged: body.whatChanged !== undefined ? JSON.stringify(body.whatChanged) : undefined,
      metrics: body.metrics !== undefined ? JSON.stringify(body.metrics) : undefined,
      planVsActual: body.planVsActual !== undefined ? JSON.stringify(body.planVsActual) : undefined,
      risksAndMitigations: body.risksAndMitigations !== undefined ? JSON.stringify(body.risksAndMitigations) : undefined,
      nextQuarterPriorities: body.nextQuarterPriorities !== undefined ? JSON.stringify(body.nextQuarterPriorities) : undefined,
      attachmentIds: body.attachmentIds !== undefined ? JSON.stringify(body.attachmentIds) : undefined,
      scheduledFor: body.scheduledFor ? new Date(body.scheduledFor) : undefined
    }
  });

  sendJson(res, 200, {
    update: {
      id: updated.id,
      title: updated.title,
      status: updated.status
    }
  });
}

/**
 * Publish an investor update
 * POST /api/deals/:dealId/investor-updates/:updateId/publish
 */
export async function handlePublishInvestorUpdate(req, res, dealId, updateId) {
  const authUser = await requireGP(req, res);
  if (!authUser) return;

  const prisma = getPrisma();

  const update = await prisma.investorUpdate.findFirst({
    where: { id: updateId, dealId }
  });

  if (!update) {
    return sendError(res, 404, "Update not found");
  }

  if (update.status === 'PUBLISHED') {
    return sendError(res, 400, "Update is already published");
  }

  const updated = await prisma.investorUpdate.update({
    where: { id: updateId },
    data: {
      status: 'PUBLISHED',
      publishedAt: new Date()
    }
  });

  console.log(`[Investor Updates] Published update ${updateId}`);

  sendJson(res, 200, {
    update: {
      id: updated.id,
      status: updated.status,
      publishedAt: updated.publishedAt.toISOString()
    }
  });
}

/**
 * Delete an investor update (GP only, draft only)
 * DELETE /api/deals/:dealId/investor-updates/:updateId
 */
export async function handleDeleteInvestorUpdate(req, res, dealId, updateId) {
  const authUser = await requireGP(req, res);
  if (!authUser) return;

  const prisma = getPrisma();

  const update = await prisma.investorUpdate.findFirst({
    where: { id: updateId, dealId }
  });

  if (!update) {
    return sendError(res, 404, "Update not found");
  }

  if (update.status === 'PUBLISHED') {
    return sendError(res, 400, "Cannot delete published updates");
  }

  await prisma.investorUpdate.delete({ where: { id: updateId } });

  console.log(`[Investor Updates] Deleted update ${updateId}`);

  sendJson(res, 200, { message: "Update deleted" });
}

// ========== LP-FACING ENDPOINTS ==========

/**
 * Get investor updates for authenticated LP user
 * GET /api/lp/portal/my-investments/:dealId/updates
 */
export async function handleGetMyInvestorUpdates(req, res, authUser, dealId) {
  if (!authUser) {
    return sendError(res, 401, "Authentication required");
  }

  if (authUser.role !== "LP") {
    return sendError(res, 403, "Only LP users can access this endpoint");
  }

  const prisma = getPrisma();

  // Verify LP has access to this deal
  const lpActor = await prisma.lPActor.findFirst({
    where: {
      dealId,
      OR: [
        { authUserId: authUser.id },
        { email: authUser.email.toLowerCase() }
      ],
      status: 'ACTIVE'
    }
  });

  if (!lpActor) {
    return sendError(res, 404, "Investment not found or you don't have access");
  }

  // Get published updates only
  const updates = await prisma.investorUpdate.findMany({
    where: {
      dealId,
      status: 'PUBLISHED'
    },
    orderBy: { publishedAt: 'desc' }
  });

  sendJson(res, 200, {
    updates: updates.map(u => ({
      id: u.id,
      title: u.title,
      updateType: u.updateType,
      period: u.period,
      headline: u.headline,
      publishedAt: u.publishedAt?.toISOString(),
      createdByName: u.createdByName
    })),
    lpActorId: lpActor.id
  });
}

/**
 * Get single investor update detail for LP
 * GET /api/lp/portal/my-investments/:dealId/updates/:updateId
 */
export async function handleGetMyInvestorUpdateDetail(req, res, authUser, dealId, updateId) {
  if (!authUser) {
    return sendError(res, 401, "Authentication required");
  }

  if (authUser.role !== "LP") {
    return sendError(res, 403, "Only LP users can access this endpoint");
  }

  const prisma = getPrisma();

  // Verify LP has access
  const lpActor = await prisma.lPActor.findFirst({
    where: {
      dealId,
      OR: [
        { authUserId: authUser.id },
        { email: authUser.email.toLowerCase() }
      ],
      status: 'ACTIVE'
    }
  });

  if (!lpActor) {
    return sendError(res, 404, "Investment not found or you don't have access");
  }

  // Get update (must be published)
  const update = await prisma.investorUpdate.findFirst({
    where: {
      id: updateId,
      dealId,
      status: 'PUBLISHED'
    }
  });

  if (!update) {
    return sendError(res, 404, "Update not found");
  }

  // Parse JSON fields
  let whatChanged = null;
  let metrics = null;
  let planVsActual = null;
  let risksAndMitigations = null;
  let nextQuarterPriorities = null;
  let attachmentIds = null;

  try {
    if (update.whatChanged) whatChanged = JSON.parse(update.whatChanged);
    if (update.metrics) metrics = JSON.parse(update.metrics);
    if (update.planVsActual) planVsActual = JSON.parse(update.planVsActual);
    if (update.risksAndMitigations) risksAndMitigations = JSON.parse(update.risksAndMitigations);
    if (update.nextQuarterPriorities) nextQuarterPriorities = JSON.parse(update.nextQuarterPriorities);
    if (update.attachmentIds) attachmentIds = JSON.parse(update.attachmentIds);
  } catch (e) {
    // Keep as strings if parsing fails
  }

  sendJson(res, 200, {
    update: {
      id: update.id,
      title: update.title,
      updateType: update.updateType,
      period: update.period,
      publishedAt: update.publishedAt?.toISOString(),
      headline: update.headline,
      whatChanged: whatChanged || update.whatChanged,
      metrics: metrics || update.metrics,
      planVsActual: planVsActual || update.planVsActual,
      risksAndMitigations: risksAndMitigations || update.risksAndMitigations,
      nextQuarterPriorities: nextQuarterPriorities || update.nextQuarterPriorities,
      attachmentIds: attachmentIds || update.attachmentIds,
      createdByName: update.createdByName
    },
    lpActorId: lpActor.id
  });
}

// ========== LP QUESTIONS ==========

/**
 * Get questions for an update
 * GET /api/lp/portal/my-investments/:dealId/updates/:updateId/questions
 */
export async function handleGetUpdateQuestions(req, res, authUser, dealId, updateId) {
  if (!authUser) {
    return sendError(res, 401, "Authentication required");
  }

  const prisma = getPrisma();

  // Verify LP has access
  const lpActor = await prisma.lPActor.findFirst({
    where: {
      dealId,
      OR: [
        { authUserId: authUser.id },
        { email: authUser.email.toLowerCase() }
      ],
      status: 'ACTIVE'
    }
  });

  if (!lpActor) {
    return sendError(res, 404, "Investment not found");
  }

  // Get questions (public ones + this LP's questions)
  const questions = await prisma.lPQuestion.findMany({
    where: {
      dealId,
      OR: [
        { isPublic: true },
        { lpActorId: lpActor.id }
      ]
    },
    orderBy: { createdAt: 'desc' }
  });

  sendJson(res, 200, {
    questions: questions.map(q => ({
      id: q.id,
      question: q.question,
      context: q.context,
      isPublic: q.isPublic,
      isMine: q.lpActorId === lpActor.id,
      status: q.status,
      answer: q.answer,
      answeredByName: q.answeredByName,
      answeredAt: q.answeredAt?.toISOString(),
      createdAt: q.createdAt.toISOString()
    }))
  });
}

/**
 * Ask a question (LP only)
 * POST /api/lp/portal/my-investments/:dealId/questions
 */
export async function handleAskQuestion(req, res, authUser, dealId, readJsonBody) {
  if (!authUser) {
    return sendError(res, 401, "Authentication required");
  }

  if (authUser.role !== "LP") {
    return sendError(res, 403, "Only LP users can ask questions");
  }

  const body = await readJsonBody(req);

  if (!body?.question) {
    return sendError(res, 400, "question is required");
  }

  const prisma = getPrisma();

  // Verify LP has access
  const lpActor = await prisma.lPActor.findFirst({
    where: {
      dealId,
      OR: [
        { authUserId: authUser.id },
        { email: authUser.email.toLowerCase() }
      ],
      status: 'ACTIVE'
    }
  });

  if (!lpActor) {
    return sendError(res, 404, "Investment not found");
  }

  const question = await prisma.lPQuestion.create({
    data: {
      id: crypto.randomUUID(),
      dealId,
      lpActorId: lpActor.id,
      question: body.question,
      context: body.context || null,
      anchorRef: body.anchorRef || null,
      isPublic: body.isPublic || false,
      status: 'PENDING'
    }
  });

  console.log(`[LP Questions] LP ${lpActor.entityName} asked question for deal ${dealId}`);

  sendJson(res, 201, {
    question: {
      id: question.id,
      question: question.question,
      status: question.status,
      createdAt: question.createdAt.toISOString()
    }
  });
}

/**
 * Answer a question (GP only)
 * POST /api/deals/:dealId/questions/:questionId/answer
 */
export async function handleAnswerQuestion(req, res, dealId, questionId, readJsonBody, userId, userName) {
  const authUser = await requireGP(req, res);
  if (!authUser) return;

  const body = await readJsonBody(req);

  if (!body?.answer) {
    return sendError(res, 400, "answer is required");
  }

  const prisma = getPrisma();

  const question = await prisma.lPQuestion.findFirst({
    where: { id: questionId, dealId }
  });

  if (!question) {
    return sendError(res, 404, "Question not found");
  }

  const updated = await prisma.lPQuestion.update({
    where: { id: questionId },
    data: {
      answer: body.answer,
      answeredBy: userId,
      answeredByName: userName || 'Unknown',
      answeredAt: new Date(),
      status: 'ANSWERED',
      isPublic: body.makePublic ?? question.isPublic
    }
  });

  console.log(`[LP Questions] Answered question ${questionId}`);

  sendJson(res, 200, {
    question: {
      id: updated.id,
      answer: updated.answer,
      answeredByName: updated.answeredByName,
      answeredAt: updated.answeredAt.toISOString(),
      status: updated.status
    }
  });
}
