import { PrismaClient } from '@prisma/client';
import { validateMagicLinkToken, consumeToken } from '../services/magic-link-service.js';
import { kernelFetchJson } from '../kernel.js';

const prisma = new PrismaClient();
const KERNEL_API_URL = process.env.KERNEL_API_URL || 'http://localhost:3001';

/**
 * Get portal data for a lender
 * GET /api/portal/lender?token=xxx
 */
export async function handleGetLenderPortal(req, res, token) {
  try {
    // Validate the token
    const validation = await validateMagicLinkToken(token);

    if (!validation.valid) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: validation.error,
        code: 'INVALID_TOKEN'
      }));
      return;
    }

    const { dealId, recipientEmail, recipientRole } = validation.payload;

    // Fetch deal data from kernel
    let deal;
    try {
      deal = await kernelFetchJson(`${KERNEL_API_URL}/deals/${dealId}`);
    } catch (err) {
      // If kernel is unavailable, return a mock response for demo
      deal = {
        id: dealId,
        name: 'Demo Deal',
        status: 'active',
        data: {
          propertyType: 'Multifamily',
          propertyAddress: '123 Main Street, Austin, TX',
          unitCount: 42,
          purchasePrice: 15000000,
          loanAmount: 12500000,
          ltv: 65,
          noi: 650000,
          capRate: 5.2,
          dscr: 1.35
        }
      };
    }

    // Fetch materials/documents from kernel
    let materials = [];
    try {
      materials = await kernelFetchJson(`${KERNEL_API_URL}/deals/${dealId}/materials`);
    } catch (err) {
      // Mock materials for demo
      materials = [
        { id: '1', type: 'RentRoll', name: 'Rent Roll', truthClass: 'DOC' },
        { id: '2', type: 'FinancialModel', name: 'Financial Model', truthClass: 'DOC' },
        { id: '3', type: 'Appraisal', name: 'Appraisal', truthClass: 'DOC' }
      ];
    }

    // Check if there's a submission record and update viewedAt
    const submission = await prisma.dealSubmission.findFirst({
      where: {
        dealId,
        recipientEmail,
        status: 'PENDING'
      },
      orderBy: { submittedAt: 'desc' }
    });

    if (submission && !submission.viewedAt) {
      await prisma.dealSubmission.update({
        where: { id: submission.id },
        data: {
          viewedAt: new Date(),
          status: 'VIEWED'
        }
      });
    }

    // Fetch comments for this deal
    const comments = await prisma.portalComment.findMany({
      where: { dealId },
      orderBy: { createdAt: 'desc' },
      take: 50
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      deal: {
        id: deal.id,
        name: deal.name,
        status: deal.status,
        propertyType: deal.data?.propertyType,
        propertyAddress: deal.data?.propertyAddress,
        unitCount: deal.data?.unitCount,
        purchasePrice: deal.data?.purchasePrice,
        loanAmount: deal.data?.loanAmount,
        ltv: deal.data?.ltv,
        noi: deal.data?.noi,
        capRate: deal.data?.capRate,
        dscr: deal.data?.dscr
      },
      documents: materials.map(m => ({
        id: m.id,
        type: m.type,
        name: m.name || m.type,
        verified: m.truthClass === 'DOC'
      })),
      comments,
      submission: submission ? {
        id: submission.id,
        status: submission.status,
        submittedAt: submission.submittedAt,
        submittedByName: submission.submittedByName
      } : null,
      portal: {
        recipientEmail,
        recipientRole,
        expiresAt: validation.tokenRecord.expiresAt
      }
    }));
  } catch (error) {
    console.error('Error getting lender portal:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to load portal data' }));
  }
}

/**
 * Approve a deal from the portal
 * POST /api/portal/lender/approve?token=xxx
 */
export async function handleLenderApprove(req, res, token, readJsonBody) {
  try {
    const validation = await validateMagicLinkToken(token);

    if (!validation.valid) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: validation.error,
        code: 'INVALID_TOKEN'
      }));
      return;
    }

    const { dealId, recipientEmail, recipientRole } = validation.payload;
    const body = await readJsonBody(req);
    const { comment } = body || {};

    // Find the submission
    const submission = await prisma.dealSubmission.findFirst({
      where: {
        dealId,
        recipientEmail,
        status: { in: ['PENDING', 'VIEWED'] }
      },
      orderBy: { submittedAt: 'desc' }
    });

    if (!submission) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No pending submission found' }));
      return;
    }

    // Update submission status
    await prisma.dealSubmission.update({
      where: { id: submission.id },
      data: {
        status: 'APPROVED',
        respondedAt: new Date(),
        responseNotes: comment || null
      }
    });

    // Add comment if provided
    if (comment) {
      await prisma.portalComment.create({
        data: {
          dealId,
          submissionId: submission.id,
          authorEmail: recipientEmail,
          authorName: validation.tokenRecord.recipientName,
          authorRole: recipientRole,
          content: comment
        }
      });
    }

    // Mark token as used (for action tokens)
    if (validation.tokenRecord.actionType !== 'view_deal') {
      await consumeToken(validation.tokenRecord.id);
    }

    // Create notification for GP
    await prisma.notification.create({
      data: {
        userId: submission.submittedByUserId,
        type: 'lender_approved',
        title: 'Deal Approved by Lender',
        body: comment
          ? `${validation.tokenRecord.recipientName || recipientEmail} approved the deal: "${comment}"`
          : `${validation.tokenRecord.recipientName || recipientEmail} approved the deal`,
        dealId,
        actionUrl: `/DealOverview?id=${dealId}`
      }
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      status: 'APPROVED',
      message: 'Deal has been approved'
    }));
  } catch (error) {
    console.error('Error approving deal:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to approve deal' }));
  }
}

/**
 * Reject or request changes from the portal
 * POST /api/portal/lender/reject?token=xxx
 */
export async function handleLenderReject(req, res, token, readJsonBody) {
  try {
    const validation = await validateMagicLinkToken(token);

    if (!validation.valid) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: validation.error,
        code: 'INVALID_TOKEN'
      }));
      return;
    }

    const { dealId, recipientEmail, recipientRole } = validation.payload;
    const body = await readJsonBody(req);
    const { reason, requestChanges = false } = body || {};

    // Find the submission
    const submission = await prisma.dealSubmission.findFirst({
      where: {
        dealId,
        recipientEmail,
        status: { in: ['PENDING', 'VIEWED'] }
      },
      orderBy: { submittedAt: 'desc' }
    });

    if (!submission) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No pending submission found' }));
      return;
    }

    const newStatus = requestChanges ? 'CHANGES_REQUESTED' : 'REJECTED';

    // Update submission status
    await prisma.dealSubmission.update({
      where: { id: submission.id },
      data: {
        status: newStatus,
        respondedAt: new Date(),
        responseNotes: reason || null
      }
    });

    // Add comment
    if (reason) {
      await prisma.portalComment.create({
        data: {
          dealId,
          submissionId: submission.id,
          authorEmail: recipientEmail,
          authorName: validation.tokenRecord.recipientName,
          authorRole: recipientRole,
          content: reason
        }
      });
    }

    // Mark token as used
    if (validation.tokenRecord.actionType !== 'view_deal') {
      await consumeToken(validation.tokenRecord.id);
    }

    // Create notification for GP
    await prisma.notification.create({
      data: {
        userId: submission.submittedByUserId,
        type: requestChanges ? 'changes_requested' : 'lender_rejected',
        title: requestChanges ? 'Changes Requested by Lender' : 'Deal Rejected by Lender',
        body: reason
          ? `${validation.tokenRecord.recipientName || recipientEmail}: "${reason}"`
          : `${validation.tokenRecord.recipientName || recipientEmail} ${requestChanges ? 'requested changes' : 'rejected the deal'}`,
        dealId,
        actionUrl: `/DealOverview?id=${dealId}`
      }
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      status: newStatus,
      message: requestChanges ? 'Change request submitted' : 'Deal has been rejected'
    }));
  } catch (error) {
    console.error('Error rejecting deal:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to process rejection' }));
  }
}

/**
 * Add a comment from the portal
 * POST /api/portal/lender/comment?token=xxx
 */
export async function handleLenderComment(req, res, token, readJsonBody) {
  try {
    const validation = await validateMagicLinkToken(token);

    if (!validation.valid) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: validation.error,
        code: 'INVALID_TOKEN'
      }));
      return;
    }

    const { dealId, recipientEmail, recipientRole } = validation.payload;
    const body = await readJsonBody(req);
    const { content } = body || {};

    if (!content || !content.trim()) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Comment content is required' }));
      return;
    }

    // Find related submission
    const submission = await prisma.dealSubmission.findFirst({
      where: {
        dealId,
        recipientEmail
      },
      orderBy: { submittedAt: 'desc' }
    });

    // Create comment
    const comment = await prisma.portalComment.create({
      data: {
        dealId,
        submissionId: submission?.id || null,
        authorEmail: recipientEmail,
        authorName: validation.tokenRecord.recipientName,
        authorRole: recipientRole,
        content: content.trim()
      }
    });

    // Notify GP of new comment
    if (submission) {
      await prisma.notification.create({
        data: {
          userId: submission.submittedByUserId,
          type: 'portal_comment',
          title: 'New Comment from Lender',
          body: `${validation.tokenRecord.recipientName || recipientEmail}: "${content.substring(0, 100)}${content.length > 100 ? '...' : ''}"`,
          dealId,
          actionUrl: `/DealOverview?id=${dealId}`
        }
      });
    }

    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: comment.id,
      content: comment.content,
      createdAt: comment.createdAt,
      authorName: comment.authorName,
      authorRole: comment.authorRole
    }));
  } catch (error) {
    console.error('Error adding comment:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to add comment' }));
  }
}
