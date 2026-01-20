import { PrismaClient } from '@prisma/client';
import { readStore } from "../store.js";

const prisma = new PrismaClient();

/**
 * Create a review request (Analyst → GP)
 * POST /api/deals/:dealId/review-requests
 */
export async function handleCreateReviewRequest(req, res, dealId, readJsonBody, resolveUserId) {
  try {
    const userId = resolveUserId ? resolveUserId(req) : 'anonymous';
    const userName = req.headers['x-user-name'] || userId;
    const body = await readJsonBody(req);
    const { message } = body || {};

    // Check if there's already a pending review for this deal
    const existingPending = await prisma.reviewRequest.findFirst({
      where: {
        dealId,
        status: 'pending'
      }
    });

    if (existingPending) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'A review request is already pending for this deal',
        existingRequest: existingPending
      }));
      return;
    }

    // Create the review request
    const reviewRequest = await prisma.reviewRequest.create({
      data: {
        dealId,
        requestedBy: userId,
        requestedByName: userName,
        message: message || null,
        status: 'pending'
      }
    });

    // Create notification for GPs (we'll notify all users with GP role for now)
    // In a real system, you'd have a user-role mapping
    await prisma.notification.create({
      data: {
        userId: 'gp-team', // Placeholder - would be actual GP user IDs
        type: 'review_requested',
        title: 'Review Requested',
        body: `${userName} has requested a review for a deal`,
        dealId,
        reviewRequestId: reviewRequest.id,
        sourceUserId: userId,
        sourceUserName: userName,
        actionUrl: `/DealOverview?id=${dealId}`
      }
    });

    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: reviewRequest.id,
      status: 'pending',
      notificationSent: true,
      message: 'Review request submitted successfully'
    }));
  } catch (error) {
    console.error('Error creating review request:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to create review request' }));
  }
}

/**
 * List review requests
 * GET /api/review-requests?status=pending&dealId=xxx
 */
export async function handleListReviewRequests(req, res, resolveUserId) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const status = url.searchParams.get('status');
    const dealId = url.searchParams.get('dealId');

    const where = {};
    if (status) where.status = status;
    if (dealId) where.dealId = dealId;

    const requests = await prisma.reviewRequest.findMany({
      where,
      orderBy: { requestedAt: 'desc' },
      take: 50
    });

    // Enrich with deal names if we have deal IDs
    // For now, we'll return as-is since deal names come from kernel

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ requests }));
  } catch (error) {
    console.error('Error listing review requests:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to list review requests' }));
  }
}

/**
 * Get a single review request
 * GET /api/review-requests/:id
 * SECURITY: V4 fix - authUser passed from dispatch for org isolation check
 */
export async function handleGetReviewRequest(req, res, requestId, authUser) {
  try {
    const request = await prisma.reviewRequest.findUnique({
      where: { id: requestId }
    });

    if (!request) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Review request not found' }));
      return;
    }

    // SECURITY: V4 fix - Verify org isolation via deal
    const store = await readStore();
    const deal = store.dealIndex.find((d) => d.id === request.dealId);
    if (deal?.organizationId && deal.organizationId !== authUser.organizationId) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Access denied - review request belongs to different organization' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(request));
  } catch (error) {
    console.error('Error getting review request:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to get review request' }));
  }
}

/**
 * Get pending review request for a deal
 * GET /api/deals/:dealId/review-requests/pending
 */
export async function handleGetPendingReviewForDeal(req, res, dealId) {
  try {
    const request = await prisma.reviewRequest.findFirst({
      where: {
        dealId,
        status: 'pending'
      },
      orderBy: { requestedAt: 'desc' }
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ request }));
  } catch (error) {
    console.error('Error getting pending review:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to get pending review' }));
  }
}

/**
 * Respond to a review request (GP approves/rejects/provides feedback)
 * POST /api/review-requests/:id/respond
 */
export async function handleRespondToReview(req, res, requestId, readJsonBody, resolveUserId) {
  try {
    const userId = resolveUserId ? resolveUserId(req) : 'anonymous';
    const userName = req.headers['x-user-name'] || userId;
    const body = await readJsonBody(req);
    const { action, message } = body || {};

    if (!['approve', 'reject', 'feedback'].includes(action)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid action. Must be: approve, reject, or feedback' }));
      return;
    }

    // Get the review request
    const request = await prisma.reviewRequest.findUnique({
      where: { id: requestId }
    });

    if (!request) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Review request not found' }));
      return;
    }

    if (request.status !== 'pending') {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Review request has already been processed' }));
      return;
    }

    // Map action to status
    const statusMap = {
      approve: 'approved',
      reject: 'rejected',
      feedback: 'feedback'
    };

    // Update the review request
    const updated = await prisma.reviewRequest.update({
      where: { id: requestId },
      data: {
        status: statusMap[action],
        reviewedBy: userId,
        reviewedByName: userName,
        reviewedAt: new Date(),
        feedback: message || null
      }
    });

    // Create notification for the analyst
    const notificationTitles = {
      approve: 'Review Approved',
      reject: 'Review Rejected',
      feedback: 'Feedback Received'
    };

    const notificationBodies = {
      approve: `${userName} has approved your review request`,
      reject: `${userName} has rejected your review request`,
      feedback: `${userName} has provided feedback on your review request`
    };

    await prisma.notification.create({
      data: {
        userId: request.requestedBy,
        type: `review_${action}ed`,
        title: notificationTitles[action],
        body: message ? `${notificationBodies[action]}: "${message}"` : notificationBodies[action],
        dealId: request.dealId,
        reviewRequestId: requestId,
        sourceUserId: userId,
        sourceUserName: userName,
        actionUrl: `/DealOverview?id=${request.dealId}`
      }
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: updated.id,
      status: updated.status,
      notificationSent: true,
      message: `Review ${action === 'feedback' ? 'feedback sent' : action + 'd'} successfully`
    }));
  } catch (error) {
    console.error('Error responding to review:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to respond to review' }));
  }
}

/**
 * Get review request history for a deal
 * GET /api/deals/:dealId/review-requests
 */
export async function handleGetDealReviewHistory(req, res, dealId) {
  try {
    const requests = await prisma.reviewRequest.findMany({
      where: { dealId },
      orderBy: { requestedAt: 'desc' }
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ requests }));
  } catch (error) {
    console.error('Error getting deal review history:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to get review history' }));
  }
}
