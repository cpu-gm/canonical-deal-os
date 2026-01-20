/**
 * Extraction Claim Service
 *
 * Manages AI-extracted claims that require human verification.
 * Claims go through: PENDING → VERIFIED/REJECTED → (optionally) SUPERSEDED
 *
 * Features:
 * - Create claims from extraction results
 * - Verify/reject claims with audit trail
 * - Bulk verification for high-confidence claims
 * - Supersede claims when new extractions occur
 * - Apply verified claims to underwriting model
 */

import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { dealStateMachine } from './deal-state-machine.js';
const prisma = new PrismaClient();

class ExtractionClaimService {
  /**
   * Create a new extraction claim from AI extraction
   */
  async createClaim(data) {
    const {
      dealId,
      fieldPath,
      claimedValue,
      documentId,
      documentName,
      documentType,
      pageNumber,
      boundingBox,
      cellReference,
      textSnippet,
      extractionId,
      aiModel,
      aiConfidence
    } = data;

    // Calculate snippet hash for verification
    const snippetHash = textSnippet
      ? crypto.createHash('sha256').update(textSnippet).digest('hex')
      : null;

    // Check for existing pending claim for same field
    const existingClaim = await prisma.extractionClaim.findFirst({
      where: {
        dealId,
        fieldPath,
        status: 'PENDING'
      }
    });

    // If there's an existing pending claim, supersede it
    if (existingClaim) {
      await prisma.extractionClaim.update({
        where: { id: existingClaim.id },
        data: {
          status: 'SUPERSEDED',
          supersededAt: new Date()
        }
      });
    }

    const claim = await prisma.extractionClaim.create({
      data: {
        dealId,
        fieldPath,
        claimedValue: JSON.stringify(claimedValue),
        documentId,
        documentName,
        documentType,
        pageNumber,
        boundingBox: boundingBox ? JSON.stringify(boundingBox) : null,
        cellReference,
        textSnippet,
        snippetHash,
        extractionId,
        aiModel,
        aiConfidence,
        status: 'PENDING'
      }
    });

    // Record event
    await dealStateMachine.recordEvent(
      dealId,
      'ClaimCreated',
      {
        claimId: claim.id,
        fieldPath,
        claimedValue,
        aiConfidence,
        documentName
      },
      { id: 'system', name: 'System', role: 'SYSTEM' }
    );

    return this.formatClaim(claim);
  }

  /**
   * Create multiple claims from a batch extraction
   */
  async createClaimsFromExtraction(dealId, extractionResult, metadata) {
    const {
      documentId,
      documentName,
      documentType,
      extractionId,
      aiModel
    } = metadata;

    const claims = [];

    for (const [fieldPath, extraction] of Object.entries(extractionResult)) {
      if (extraction && extraction.value !== undefined) {
        const claim = await this.createClaim({
          dealId,
          fieldPath,
          claimedValue: extraction.value,
          documentId,
          documentName,
          documentType,
          pageNumber: extraction.pageNumber,
          boundingBox: extraction.boundingBox,
          cellReference: extraction.cellReference,
          textSnippet: extraction.textSnippet,
          extractionId,
          aiModel,
          aiConfidence: extraction.confidence || 0.5
        });
        claims.push(claim);
      }
    }

    return claims;
  }

  /**
   * Get pending claims for a deal
   */
  async getPendingClaims(dealId, options = {}) {
    const { sortBy = 'confidence', order = 'asc', documentType } = options;

    const where = {
      dealId,
      status: 'PENDING'
    };

    if (documentType) {
      where.documentType = documentType;
    }

    const orderBy = sortBy === 'confidence'
      ? { aiConfidence: order }
      : { extractedAt: order };

    const claims = await prisma.extractionClaim.findMany({
      where,
      orderBy
    });

    return claims.map(this.formatClaim);
  }

  /**
   * Get all claims for a deal
   */
  async getClaims(dealId, options = {}) {
    const { status, fieldPath, documentId, limit = 100 } = options;

    const where = { dealId };
    if (status) where.status = status;
    if (fieldPath) where.fieldPath = fieldPath;
    if (documentId) where.documentId = documentId;

    const claims = await prisma.extractionClaim.findMany({
      where,
      orderBy: { extractedAt: 'desc' },
      take: limit
    });

    return claims.map(this.formatClaim);
  }

  /**
   * Get a single claim by ID
   */
  async getClaim(claimId) {
    const claim = await prisma.extractionClaim.findUnique({
      where: { id: claimId }
    });

    if (!claim) {
      throw new Error('Claim not found');
    }

    return this.formatClaim(claim);
  }

  /**
   * Verify a claim (approve it)
   */
  async verifyClaim(claimId, actor, options = {}) {
    const { correctedValue } = options;

    const claim = await prisma.extractionClaim.findUnique({
      where: { id: claimId }
    });

    if (!claim) {
      throw new Error('Claim not found');
    }

    if (claim.status !== 'PENDING') {
      throw new Error(`Cannot verify claim with status: ${claim.status}`);
    }

    // Update claim
    const updatedClaim = await prisma.extractionClaim.update({
      where: { id: claimId },
      data: {
        status: 'VERIFIED',
        verifiedBy: actor.id,
        verifiedByName: actor.name,
        verifiedAt: new Date(),
        correctedValue: correctedValue !== undefined
          ? JSON.stringify(correctedValue)
          : null
      }
    });

    // Apply to underwriting model
    const valueToApply = correctedValue !== undefined
      ? correctedValue
      : JSON.parse(claim.claimedValue);

    await this.applyClaimToModel(claim.dealId, claim.fieldPath, valueToApply, {
      claimId,
      verifiedBy: actor.id,
      verifiedByName: actor.name,
      sourceType: 'AI_EXTRACTION',
      documentName: claim.documentName,
      documentCell: claim.cellReference,
      aiConfidence: claim.aiConfidence
    });

    // Record event
    await dealStateMachine.recordEvent(
      claim.dealId,
      'ClaimVerified',
      {
        claimId,
        fieldPath: claim.fieldPath,
        originalValue: JSON.parse(claim.claimedValue),
        correctedValue,
        appliedValue: valueToApply
      },
      actor,
      { evidenceRefs: [claim.documentId] }
    );

    return this.formatClaim(updatedClaim);
  }

  /**
   * Reject a claim
   */
  async rejectClaim(claimId, actor, reason) {
    const claim = await prisma.extractionClaim.findUnique({
      where: { id: claimId }
    });

    if (!claim) {
      throw new Error('Claim not found');
    }

    if (claim.status !== 'PENDING') {
      throw new Error(`Cannot reject claim with status: ${claim.status}`);
    }

    const updatedClaim = await prisma.extractionClaim.update({
      where: { id: claimId },
      data: {
        status: 'REJECTED',
        verifiedBy: actor.id,
        verifiedByName: actor.name,
        verifiedAt: new Date(),
        rejectionReason: reason
      }
    });

    // Record event
    await dealStateMachine.recordEvent(
      claim.dealId,
      'ClaimRejected',
      {
        claimId,
        fieldPath: claim.fieldPath,
        claimedValue: JSON.parse(claim.claimedValue),
        reason
      },
      actor
    );

    return this.formatClaim(updatedClaim);
  }

  /**
   * Bulk verify high-confidence claims
   */
  async bulkVerify(dealId, actor, options = {}) {
    const { minConfidence = 0.95, claimIds } = options;

    let claims;

    if (claimIds && claimIds.length > 0) {
      // Verify specific claims
      claims = await prisma.extractionClaim.findMany({
        where: {
          id: { in: claimIds },
          dealId,
          status: 'PENDING'
        }
      });
    } else {
      // Verify all high-confidence claims
      claims = await prisma.extractionClaim.findMany({
        where: {
          dealId,
          status: 'PENDING',
          aiConfidence: { gte: minConfidence }
        }
      });
    }

    const results = {
      verified: [],
      failed: []
    };

    for (const claim of claims) {
      try {
        const verifiedClaim = await this.verifyClaim(claim.id, actor);
        results.verified.push(verifiedClaim);
      } catch (error) {
        results.failed.push({
          claimId: claim.id,
          fieldPath: claim.fieldPath,
          error: error.message
        });
      }
    }

    return results;
  }

  /**
   * Bulk reject claims
   */
  async bulkReject(claimIds, actor, reason) {
    const results = {
      rejected: [],
      failed: []
    };

    for (const claimId of claimIds) {
      try {
        const rejectedClaim = await this.rejectClaim(claimId, actor, reason);
        results.rejected.push(rejectedClaim);
      } catch (error) {
        results.failed.push({
          claimId,
          error: error.message
        });
      }
    }

    return results;
  }

  /**
   * Apply verified claim value to underwriting model
   */
  async applyClaimToModel(dealId, fieldPath, value, provenance) {
    // Get or create underwriting model
    let model = await prisma.underwritingModel.findFirst({
      where: { dealId }
    });

    if (!model) {
      model = await prisma.underwritingModel.create({
        data: {
          dealId,
          scenarioName: 'Base Case',
          isBaseCase: true,
          status: 'DRAFT'
        }
      });
    }

    // Create underwriting input with provenance
    // NOTE: 'source' is a required field in the schema
    await prisma.underwritingInput.create({
      data: {
        modelId: model.id,
        dealId,
        fieldPath,
        value: JSON.stringify(value),
        source: provenance.sourceType || 'AI_EXTRACTION', // Required field
        documentName: provenance.documentName,
        documentCell: provenance.documentCell,
        documentPage: provenance.pageNumber, // Schema uses documentPage, not pageNumber
        aiConfidence: provenance.aiConfidence,
        setBy: provenance.verifiedBy,
        setByName: provenance.verifiedByName,
        rationale: `Extracted from ${provenance.documentName}, verified by ${provenance.verifiedByName}`
      }
    });

    // Update model field if it maps to a direct field
    const fieldMapping = this.getFieldMapping(fieldPath);
    if (fieldMapping) {
      await prisma.underwritingModel.update({
        where: { id: model.id },
        data: { [fieldMapping]: value }
      });
    }

    return model;
  }

  /**
   * Map field paths to underwriting model columns
   * NOTE: Uses correct schema field names:
   * - netOperatingIncome (not noi)
   * - amortization (not amortizationYears)
   * - loanTerm (not loanTermYears)
   * - holdPeriod (not holdPeriodYears)
   */
  getFieldMapping(fieldPath) {
    const mappings = {
      // Schema fields we added
      'purchasePrice': 'purchasePrice',
      'totalUnits': 'totalUnits',
      'grossSF': 'grossSF',

      // Existing schema fields (correct names)
      'noi': 'netOperatingIncome',           // Map common alias to schema field
      'netOperatingIncome': 'netOperatingIncome',
      'grossPotentialRent': 'grossPotentialRent',
      'effectiveGrossIncome': 'effectiveGrossIncome',
      'operatingExpenses': 'operatingExpenses',
      'goingInCapRate': 'goingInCapRate',
      'exitCapRate': 'exitCapRate',
      'loanAmount': 'loanAmount',
      'interestRate': 'interestRate',

      // Map aliases to correct schema field names
      'holdPeriod': 'holdPeriod',             // Schema field (not holdPeriodYears)
      'holdPeriodYears': 'holdPeriod',        // Alias
      'loanTerm': 'loanTerm',                 // Schema field (not loanTermYears)
      'loanTermYears': 'loanTerm',            // Alias
      'amortization': 'amortization',         // Schema field (not amortizationYears)
      'amortizationYears': 'amortization'     // Alias
    };

    return mappings[fieldPath] || null;
  }

  /**
   * Get verification statistics for a deal
   */
  async getVerificationStats(dealId) {
    const claims = await prisma.extractionClaim.groupBy({
      by: ['status'],
      where: { dealId },
      _count: { status: true }
    });

    const stats = {
      total: 0,
      pending: 0,
      verified: 0,
      rejected: 0,
      superseded: 0
    };

    for (const group of claims) {
      stats[group.status.toLowerCase()] = group._count.status;
      stats.total += group._count.status;
    }

    // Get confidence distribution for pending claims
    const pendingClaims = await prisma.extractionClaim.findMany({
      where: { dealId, status: 'PENDING' },
      select: { aiConfidence: true }
    });

    const confidenceDistribution = {
      high: pendingClaims.filter(c => c.aiConfidence >= 0.9).length,
      medium: pendingClaims.filter(c => c.aiConfidence >= 0.7 && c.aiConfidence < 0.9).length,
      low: pendingClaims.filter(c => c.aiConfidence < 0.7).length
    };

    return {
      ...stats,
      pendingByConfidence: confidenceDistribution,
      verificationRate: stats.total > 0
        ? (stats.verified / (stats.verified + stats.rejected + stats.pending)).toFixed(2)
        : 0
    };
  }

  /**
   * Get claim history for a specific field
   */
  async getFieldClaimHistory(dealId, fieldPath) {
    const claims = await prisma.extractionClaim.findMany({
      where: { dealId, fieldPath },
      orderBy: { extractedAt: 'desc' }
    });

    return claims.map(this.formatClaim);
  }

  /**
   * Format claim for API response
   */
  formatClaim(claim) {
    return {
      id: claim.id,
      dealId: claim.dealId,
      fieldPath: claim.fieldPath,
      claimedValue: JSON.parse(claim.claimedValue),
      source: {
        documentId: claim.documentId,
        documentName: claim.documentName,
        documentType: claim.documentType,
        pageNumber: claim.pageNumber,
        boundingBox: claim.boundingBox ? JSON.parse(claim.boundingBox) : null,
        cellReference: claim.cellReference,
        textSnippet: claim.textSnippet
      },
      extraction: {
        id: claim.extractionId,
        aiModel: claim.aiModel,
        confidence: claim.aiConfidence,
        extractedAt: claim.extractedAt
      },
      verification: {
        status: claim.status,
        verifiedBy: claim.verifiedBy,
        verifiedByName: claim.verifiedByName,
        verifiedAt: claim.verifiedAt,
        rejectionReason: claim.rejectionReason,
        correctedValue: claim.correctedValue ? JSON.parse(claim.correctedValue) : null
      },
      supersession: {
        supersededBy: claim.supersededBy,
        supersededAt: claim.supersededAt
      }
    };
  }
}

// Export singleton instance
const extractionClaimService = new ExtractionClaimService();

export {
  extractionClaimService,
  ExtractionClaimService
};
