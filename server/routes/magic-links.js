import { PrismaClient } from '@prisma/client';
import {
  generateMagicLinkToken,
  validateMagicLinkToken,
  revokeToken,
  getActiveTokensForDeal
} from '../services/magic-link-service.js';

const prisma = new PrismaClient();

/**
 * Generate a new magic link
 * POST /api/magic-links
 */
export async function handleCreateMagicLink(req, res, readJsonBody, resolveUserId) {
  try {
    const userId = resolveUserId ? resolveUserId(req) : 'anonymous';
    const body = await readJsonBody(req);
    const {
      dealId,
      recipientEmail,
      recipientName,
      recipientRole,
      actionType = 'view_deal',
      expiresInDays = 7
    } = body || {};

    if (!dealId || !recipientEmail || !recipientRole) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Missing required fields: dealId, recipientEmail, recipientRole'
      }));
      return;
    }

    // Validate role
    const validRoles = ['LENDER', 'COUNSEL'];
    if (!validRoles.includes(recipientRole.toUpperCase())) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: `Invalid recipientRole. Must be one of: ${validRoles.join(', ')}`
      }));
      return;
    }

    const result = await generateMagicLinkToken({
      dealId,
      recipientEmail,
      recipientName,
      recipientRole: recipientRole.toUpperCase(),
      actionType,
      createdByUserId: userId,
      expiresInDays
    });

    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: result.tokenRecord.id,
      magicLink: result.magicLink,
      expiresAt: result.tokenRecord.expiresAt,
      recipientEmail,
      recipientRole: recipientRole.toUpperCase()
    }));
  } catch (error) {
    console.error('Error creating magic link:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to create magic link' }));
  }
}

/**
 * Validate a magic link token
 * GET /api/magic-links/:token/validate
 */
export async function handleValidateMagicLink(req, res, token) {
  try {
    const result = await validateMagicLinkToken(token);

    if (!result.valid) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        valid: false,
        error: result.error
      }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      valid: true,
      dealId: result.payload.dealId,
      recipientEmail: result.payload.recipientEmail,
      recipientRole: result.payload.recipientRole,
      actionType: result.payload.actionType,
      expiresAt: result.tokenRecord.expiresAt
    }));
  } catch (error) {
    console.error('Error validating magic link:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to validate magic link' }));
  }
}

/**
 * Revoke a magic link
 * POST /api/magic-links/:id/revoke
 */
export async function handleRevokeMagicLink(req, res, tokenId, resolveUserId) {
  try {
    const userId = resolveUserId ? resolveUserId(req) : 'anonymous';

    // Check if token exists
    const token = await prisma.magicLinkToken.findUnique({
      where: { id: tokenId }
    });

    if (!token) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Token not found' }));
      return;
    }

    await revokeToken(tokenId);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: tokenId,
      status: 'REVOKED',
      message: 'Magic link has been revoked'
    }));
  } catch (error) {
    console.error('Error revoking magic link:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to revoke magic link' }));
  }
}

/**
 * List active magic links for a deal
 * GET /api/deals/:dealId/magic-links
 */
export async function handleListDealMagicLinks(req, res, dealId) {
  try {
    const tokens = await getActiveTokensForDeal(dealId);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      tokens: tokens.map(t => ({
        id: t.id,
        recipientEmail: t.recipientEmail,
        recipientName: t.recipientName,
        recipientRole: t.recipientRole,
        actionType: t.actionType,
        status: t.status,
        createdAt: t.createdAt,
        expiresAt: t.expiresAt
      }))
    }));
  } catch (error) {
    console.error('Error listing magic links:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to list magic links' }));
  }
}
