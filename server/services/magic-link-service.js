import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Secret for JWT signing - in production, use environment variable
const JWT_SECRET = process.env.MAGIC_LINK_JWT_SECRET || 'your-super-secret-key-change-in-production';
const DEFAULT_EXPIRY_DAYS = parseInt(process.env.MAGIC_LINK_DEFAULT_EXPIRY_DAYS || '7', 10);

/**
 * Generate a magic link token for external party access
 * @param {Object} params
 * @param {string} params.dealId - The deal ID
 * @param {string} params.recipientEmail - Recipient's email
 * @param {string} params.recipientName - Recipient's name (optional)
 * @param {string} params.recipientRole - LENDER, COUNSEL, etc.
 * @param {string} params.actionType - view_deal, approve_deal, reject_deal
 * @param {string} params.createdByUserId - User ID who created the link
 * @param {number} params.expiresInDays - Days until expiration (default: 7)
 * @returns {Promise<{token: string, tokenRecord: Object, magicLink: string}>}
 */
export async function generateMagicLinkToken({
  dealId,
  recipientEmail,
  recipientName,
  recipientRole,
  actionType = 'view_deal',
  createdByUserId,
  expiresInDays = DEFAULT_EXPIRY_DAYS
}) {
  // Generate a unique token ID
  const tokenId = crypto.randomUUID();

  // Calculate expiration
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + expiresInDays);

  // Create JWT payload
  const payload = {
    tokenId,
    dealId,
    recipientEmail,
    recipientRole,
    actionType,
    type: 'magic_link'
  };

  // Sign the JWT
  const token = jwt.sign(payload, JWT_SECRET, {
    expiresIn: `${expiresInDays}d`
  });

  // Store in database
  const tokenRecord = await prisma.magicLinkToken.create({
    data: {
      id: tokenId,
      token,
      dealId,
      recipientEmail,
      recipientName: recipientName || null,
      recipientRole,
      actionType,
      createdByUserId,
      expiresAt,
      status: 'ACTIVE'
    }
  });

  // Generate the magic link URL
  const baseUrl = process.env.APP_BASE_URL || 'http://localhost:5173';
  const magicLink = `${baseUrl}/portal/lender?token=${token}`;

  return {
    token,
    tokenRecord,
    magicLink
  };
}

/**
 * Validate a magic link token
 * @param {string} token - The JWT token to validate
 * @returns {Promise<{valid: boolean, payload?: Object, tokenRecord?: Object, error?: string}>}
 */
export async function validateMagicLinkToken(token) {
  try {
    // Verify JWT signature and expiration
    const payload = jwt.verify(token, JWT_SECRET);

    // Look up token in database
    const tokenRecord = await prisma.magicLinkToken.findUnique({
      where: { id: payload.tokenId }
    });

    if (!tokenRecord) {
      return { valid: false, error: 'Token not found in database' };
    }

    // Check status
    if (tokenRecord.status === 'REVOKED') {
      return { valid: false, error: 'Token has been revoked' };
    }

    if (tokenRecord.status === 'EXPIRED') {
      return { valid: false, error: 'Token has expired' };
    }

    // Check if token has been used (for one-time action tokens)
    if (tokenRecord.status === 'USED' && tokenRecord.actionType !== 'view_deal') {
      return { valid: false, error: 'Token has already been used' };
    }

    // Check expiration date
    if (new Date() > new Date(tokenRecord.expiresAt)) {
      // Update status to expired
      await prisma.magicLinkToken.update({
        where: { id: tokenRecord.id },
        data: { status: 'EXPIRED' }
      });
      return { valid: false, error: 'Token has expired' };
    }

    return {
      valid: true,
      payload,
      tokenRecord
    };
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return { valid: false, error: 'Token has expired' };
    }
    if (error.name === 'JsonWebTokenError') {
      return { valid: false, error: 'Invalid token' };
    }
    console.error('Token validation error:', error);
    return { valid: false, error: 'Token validation failed' };
  }
}

/**
 * Mark a token as used (for one-time action tokens)
 * @param {string} tokenId - The token ID to mark as used
 * @returns {Promise<Object>}
 */
export async function consumeToken(tokenId) {
  return prisma.magicLinkToken.update({
    where: { id: tokenId },
    data: {
      status: 'USED',
      usedAt: new Date()
    }
  });
}

/**
 * Revoke a magic link token
 * @param {string} tokenId - The token ID to revoke
 * @returns {Promise<Object>}
 */
export async function revokeToken(tokenId) {
  return prisma.magicLinkToken.update({
    where: { id: tokenId },
    data: { status: 'REVOKED' }
  });
}

/**
 * Get all active tokens for a deal
 * @param {string} dealId - The deal ID
 * @returns {Promise<Object[]>}
 */
export async function getActiveTokensForDeal(dealId) {
  return prisma.magicLinkToken.findMany({
    where: {
      dealId,
      status: 'ACTIVE',
      expiresAt: { gt: new Date() }
    },
    orderBy: { createdAt: 'desc' }
  });
}

/**
 * Clean up expired tokens (call periodically)
 * @returns {Promise<{count: number}>}
 */
export async function cleanupExpiredTokens() {
  const result = await prisma.magicLinkToken.updateMany({
    where: {
      status: 'ACTIVE',
      expiresAt: { lt: new Date() }
    },
    data: { status: 'EXPIRED' }
  });
  return { count: result.count };
}
