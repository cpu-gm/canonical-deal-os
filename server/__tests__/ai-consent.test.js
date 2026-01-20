/**
 * AI Consent Service Tests
 *
 * Tests for GDPR-compliant consent management for AI features.
 *
 * Phase 1.2 Implementation
 */

import { describe, test, expect, beforeEach, afterAll, jest, beforeAll } from '@jest/globals';
import { getPrisma } from '../db.js';
import crypto from 'node:crypto';
import {
  checkConsent,
  getConsentStatus,
  grantConsent,
  withdrawConsent,
  updateFeatureConsent,
  getCurrentPolicy,
  createGracePeriodConsent,
  AI_FEATURES,
  CONSENT_CONFIG,
} from '../services/ai-consent.js';

describe('AI Consent Service', () => {
  let prisma;
  const testUserId = 'test-consent-user-' + crypto.randomUUID();
  const testOrgId = 'test-consent-org-' + crypto.randomUUID();

  beforeAll(async () => {
    prisma = getPrisma();
  });

  afterAll(async () => {
    // Cleanup test data
    try {
      await prisma.aIConsentAudit.deleteMany({
        where: { userId: testUserId }
      });
      await prisma.aIConsent.deleteMany({
        where: { userId: testUserId }
      });
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  beforeEach(async () => {
    // Clean up before each test
    try {
      await prisma.aIConsentAudit.deleteMany({
        where: { userId: testUserId }
      });
      await prisma.aIConsent.deleteMany({
        where: { userId: testUserId }
      });
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe('checkConsent', () => {
    test('returns invalid when no userId provided', async () => {
      const result = await checkConsent(null, AI_FEATURES.CHAT_ASSISTANT);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('no_user_id');
      expect(result.requiresConsent).toBe(true);
    });

    test('returns invalid when no consent record exists', async () => {
      const result = await checkConsent(testUserId, AI_FEATURES.CHAT_ASSISTANT);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('no_consent_record');
      expect(result.requiresConsent).toBe(true);
    });

    test('returns invalid when consent withdrawn', async () => {
      // Create a withdrawn consent
      await prisma.aIConsent.create({
        data: {
          userId: testUserId,
          organizationId: testOrgId,
          consentGiven: true,
          consentVersion: '1.0.0',
          withdrawnAt: new Date(),
          allowChatAssistant: true,
        }
      });

      const result = await checkConsent(testUserId, AI_FEATURES.CHAT_ASSISTANT);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('consent_withdrawn');
      expect(result.requiresConsent).toBe(true);
    });

    test('returns valid during grace period', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 7); // 7 days in future

      await prisma.aIConsent.create({
        data: {
          userId: testUserId,
          organizationId: testOrgId,
          consentGiven: false, // Not yet consented
          consentVersion: 'PRE_CONSENT',
          expiresAt: futureDate,
          allowChatAssistant: true,
        }
      });

      const result = await checkConsent(testUserId, AI_FEATURES.CHAT_ASSISTANT);
      expect(result.valid).toBe(true);
      expect(result.reason).toBe('grace_period');
    });

    test('returns invalid when grace period expired', async () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1); // 1 day in past

      await prisma.aIConsent.create({
        data: {
          userId: testUserId,
          organizationId: testOrgId,
          consentGiven: false,
          consentVersion: 'PRE_CONSENT',
          expiresAt: pastDate,
        }
      });

      const result = await checkConsent(testUserId, AI_FEATURES.CHAT_ASSISTANT);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('consent_not_given');
      expect(result.requiresConsent).toBe(true);
    });

    test('returns invalid when consent expired', async () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);

      await prisma.aIConsent.create({
        data: {
          userId: testUserId,
          organizationId: testOrgId,
          consentGiven: true,
          consentVersion: '1.0.0',
          expiresAt: pastDate,
        }
      });

      const result = await checkConsent(testUserId, AI_FEATURES.CHAT_ASSISTANT);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('consent_expired');
      expect(result.requiresConsent).toBe(true);
    });

    test('returns invalid when policy version mismatch', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 365);

      await prisma.aIConsent.create({
        data: {
          userId: testUserId,
          organizationId: testOrgId,
          consentGiven: true,
          consentVersion: '0.9.0', // Old version
          expiresAt: futureDate,
          allowChatAssistant: true,
        }
      });

      const result = await checkConsent(testUserId, AI_FEATURES.CHAT_ASSISTANT);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('policy_updated');
      expect(result.requiresConsent).toBe(true);
    });

    test('returns invalid when feature not allowed', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 365);

      await prisma.aIConsent.create({
        data: {
          userId: testUserId,
          organizationId: testOrgId,
          consentGiven: true,
          consentVersion: CONSENT_CONFIG.currentPolicyVersion,
          expiresAt: futureDate,
          allowChatAssistant: false, // Feature disabled
        }
      });

      const result = await checkConsent(testUserId, AI_FEATURES.CHAT_ASSISTANT);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('feature_not_allowed');
      expect(result.requiresConsent).toBe(false); // Has consent, just feature disabled
    });

    test('returns valid with all checks passing', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 365);

      await prisma.aIConsent.create({
        data: {
          userId: testUserId,
          organizationId: testOrgId,
          consentGiven: true,
          consentVersion: CONSENT_CONFIG.currentPolicyVersion,
          expiresAt: futureDate,
          allowChatAssistant: true,
          allowDealParsing: true,
          allowDocumentAnalysis: true,
          allowInsights: true,
        }
      });

      const result = await checkConsent(testUserId, AI_FEATURES.CHAT_ASSISTANT);
      expect(result.valid).toBe(true);
      expect(result.reason).toBe('consent_valid');
      expect(result.requiresConsent).toBe(false);
    });

    test('returns valid when no feature specified', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 365);

      await prisma.aIConsent.create({
        data: {
          userId: testUserId,
          organizationId: testOrgId,
          consentGiven: true,
          consentVersion: CONSENT_CONFIG.currentPolicyVersion,
          expiresAt: futureDate,
        }
      });

      const result = await checkConsent(testUserId); // No feature
      expect(result.valid).toBe(true);
      expect(result.reason).toBe('consent_valid');
    });
  });

  describe('getConsentStatus', () => {
    test('returns no consent status when no record exists', async () => {
      const status = await getConsentStatus(testUserId);
      expect(status.hasConsent).toBe(false);
      expect(status.requiresConsent).toBe(true);
      expect(status.features.chatAssistant).toBe(false);
    });

    test('returns full status with consent record', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 365);

      await prisma.aIConsent.create({
        data: {
          userId: testUserId,
          organizationId: testOrgId,
          consentGiven: true,
          consentVersion: CONSENT_CONFIG.currentPolicyVersion,
          expiresAt: futureDate,
          allowChatAssistant: true,
          allowDealParsing: true,
          allowDocumentAnalysis: false,
          allowInsights: true,
          consentedAt: new Date(),
        }
      });

      const status = await getConsentStatus(testUserId);
      expect(status.hasConsent).toBe(true);
      expect(status.requiresConsent).toBe(false);
      expect(status.requiresReconsent).toBe(false);
      expect(status.features.chatAssistant).toBe(true);
      expect(status.features.documentAnalysis).toBe(false);
    });

    test('indicates reconsent needed when policy updated', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 365);

      await prisma.aIConsent.create({
        data: {
          userId: testUserId,
          organizationId: testOrgId,
          consentGiven: true,
          consentVersion: '0.9.0', // Old version
          expiresAt: futureDate,
        }
      });

      const status = await getConsentStatus(testUserId);
      expect(status.hasConsent).toBe(false);
      expect(status.requiresReconsent).toBe(true);
    });
  });

  describe('grantConsent', () => {
    test('creates new consent record', async () => {
      const result = await grantConsent(testUserId, testOrgId);

      expect(result.consentGiven).toBe(true);
      expect(result.userId).toBe(testUserId);
      expect(result.organizationId).toBe(testOrgId);
      expect(result.consentVersion).toBe(CONSENT_CONFIG.currentPolicyVersion);
    });

    test('updates existing consent record', async () => {
      // Create initial consent (withdrawn)
      await prisma.aIConsent.create({
        data: {
          userId: testUserId,
          organizationId: testOrgId,
          consentGiven: false,
          consentVersion: 'PRE_CONSENT',
          withdrawnAt: new Date(),
        }
      });

      // Grant consent again
      const result = await grantConsent(testUserId, testOrgId);

      expect(result.consentGiven).toBe(true);
      expect(result.withdrawnAt).toBeNull();
    });

    test('sets correct expiration date (12 months)', async () => {
      const beforeGrant = new Date();
      const result = await grantConsent(testUserId, testOrgId);
      const afterGrant = new Date();

      expect(result.expiresAt).toBeDefined();

      // Should be about 12 months from now
      const monthsDiff = (result.expiresAt.getFullYear() - beforeGrant.getFullYear()) * 12 +
        (result.expiresAt.getMonth() - beforeGrant.getMonth());
      expect(monthsDiff).toBe(CONSENT_CONFIG.expirationMonths);
    });

    test('logs audit trail', async () => {
      await grantConsent(testUserId, testOrgId, {
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
      });

      const audits = await prisma.aIConsentAudit.findMany({
        where: { userId: testUserId }
      });

      expect(audits.length).toBeGreaterThan(0);
      expect(audits[0].action).toBe('CONSENT_GIVEN');
      expect(audits[0].ipAddress).toBe('192.168.1.1');
    });

    test('respects feature options', async () => {
      const result = await grantConsent(testUserId, testOrgId, {
        allowDealParsing: true,
        allowChatAssistant: false,
        allowDocumentAnalysis: true,
        allowInsights: false,
      });

      expect(result.allowDealParsing).toBe(true);
      expect(result.allowChatAssistant).toBe(false);
      expect(result.allowDocumentAnalysis).toBe(true);
      expect(result.allowInsights).toBe(false);
    });
  });

  describe('withdrawConsent', () => {
    test('marks consent as withdrawn', async () => {
      // First grant consent
      await grantConsent(testUserId, testOrgId);

      // Then withdraw
      const result = await withdrawConsent(testUserId, 'Privacy concerns');

      expect(result.consentGiven).toBe(false);
      expect(result.withdrawnAt).toBeDefined();
    });

    test('disables all features on withdrawal', async () => {
      // First grant consent with all features
      await grantConsent(testUserId, testOrgId, {
        allowDealParsing: true,
        allowChatAssistant: true,
        allowDocumentAnalysis: true,
        allowInsights: true,
      });

      // Then withdraw
      const result = await withdrawConsent(testUserId);

      expect(result.allowDealParsing).toBe(false);
      expect(result.allowChatAssistant).toBe(false);
      expect(result.allowDocumentAnalysis).toBe(false);
      expect(result.allowInsights).toBe(false);
    });

    test('logs audit with reason', async () => {
      await grantConsent(testUserId, testOrgId);
      await withdrawConsent(testUserId, 'Privacy concerns', {
        ipAddress: '192.168.1.1',
      });

      const audits = await prisma.aIConsentAudit.findMany({
        where: {
          userId: testUserId,
          action: 'CONSENT_WITHDRAWN'
        }
      });

      expect(audits.length).toBe(1);
      expect(audits[0].reason).toBe('Privacy concerns');
      expect(audits[0].ipAddress).toBe('192.168.1.1');
    });

    test('throws when no consent record exists', async () => {
      await expect(withdrawConsent(testUserId)).rejects.toThrow('No consent record found');
    });
  });

  describe('updateFeatureConsent', () => {
    test('updates specific feature', async () => {
      // First grant consent
      await grantConsent(testUserId, testOrgId, {
        allowChatAssistant: true,
      });

      // Update feature
      const result = await updateFeatureConsent(
        testUserId,
        AI_FEATURES.CHAT_ASSISTANT,
        false
      );

      expect(result.allowChatAssistant).toBe(false);
    });

    test('throws on invalid feature', async () => {
      await grantConsent(testUserId, testOrgId);

      await expect(
        updateFeatureConsent(testUserId, 'invalidFeature', true)
      ).rejects.toThrow('Invalid feature');
    });

    test('throws when no consent record', async () => {
      await expect(
        updateFeatureConsent(testUserId, AI_FEATURES.CHAT_ASSISTANT, true)
      ).rejects.toThrow('No consent record found');
    });

    test('logs feature toggle in audit', async () => {
      await grantConsent(testUserId, testOrgId);
      await updateFeatureConsent(testUserId, AI_FEATURES.DEAL_PARSING, false);

      const audits = await prisma.aIConsentAudit.findMany({
        where: {
          userId: testUserId,
          action: 'FEATURE_TOGGLED'
        }
      });

      expect(audits.length).toBe(1);
    });
  });

  describe('getCurrentPolicy', () => {
    test('returns default policy when none in database', async () => {
      const policy = await getCurrentPolicy();

      expect(policy.version).toBe(CONSENT_CONFIG.currentPolicyVersion);
      expect(policy.title).toBe('AI Features Data Processing Agreement');
    });
  });

  describe('createGracePeriodConsent', () => {
    test('creates grace period consent for new user', async () => {
      const result = await createGracePeriodConsent(testUserId, testOrgId);

      expect(result.consentGiven).toBe(false);
      expect(result.consentMethod).toBe('GRANDFATHERED');
      expect(result.consentVersion).toBe('PRE_CONSENT');
      expect(result.expiresAt).toBeDefined();

      // Should have grace period (14 days default)
      const now = new Date();
      const daysDiff = Math.round((result.expiresAt - now) / (1000 * 60 * 60 * 24));
      expect(daysDiff).toBeGreaterThanOrEqual(CONSENT_CONFIG.gracePeriodDays - 1);
      expect(daysDiff).toBeLessThanOrEqual(CONSENT_CONFIG.gracePeriodDays + 1);
    });

    test('returns existing consent if already exists', async () => {
      // First create a consent
      await grantConsent(testUserId, testOrgId);

      // Try to create grace period - should return existing
      const result = await createGracePeriodConsent(testUserId, testOrgId);

      expect(result.consentGiven).toBe(true); // Original consent, not grace period
    });

    test('grace period consent allows AI access', async () => {
      await createGracePeriodConsent(testUserId, testOrgId);

      const result = await checkConsent(testUserId, AI_FEATURES.CHAT_ASSISTANT);
      expect(result.valid).toBe(true);
      expect(result.reason).toBe('grace_period');
    });
  });

  describe('AI_FEATURES enum', () => {
    test('has all required features', () => {
      expect(AI_FEATURES.DEAL_PARSING).toBe('allowDealParsing');
      expect(AI_FEATURES.CHAT_ASSISTANT).toBe('allowChatAssistant');
      expect(AI_FEATURES.DOCUMENT_ANALYSIS).toBe('allowDocumentAnalysis');
      expect(AI_FEATURES.INSIGHTS).toBe('allowInsights');
    });
  });

  describe('CONSENT_CONFIG', () => {
    test('has required configuration values', () => {
      expect(CONSENT_CONFIG.enabled).toBeDefined();
      expect(CONSENT_CONFIG.gracePeriodDays).toBeGreaterThan(0);
      expect(CONSENT_CONFIG.expirationMonths).toBeGreaterThan(0);
      expect(CONSENT_CONFIG.currentPolicyVersion).toBeDefined();
    });
  });
});
