/**
 * Evidence Pack Generator Service
 *
 * Generates comprehensive ZIP bundles containing all deal documentation,
 * provenance data, and audit trails for institutional review and compliance.
 *
 * Pack Types:
 * - IC_PACK: Investment Committee review package
 * - CLOSING_PACK: Final closing documentation
 * - AUDIT_PACK: Complete audit trail and provenance
 */

import archiver from 'archiver';
import crypto from 'crypto';
import path from 'path';
import { promises as fs } from 'fs';
import { Readable } from 'stream';
import { PrismaClient } from '@prisma/client';
import { dealStateMachine } from './deal-state-machine.js';
import { documentGenerator } from './document-generator.js';
import kernelClient from './kernel-client.js';

const prisma = new PrismaClient();

// =============================================================================
// PACK TYPE CONFIGURATIONS
// =============================================================================

const PACK_CONFIGS = {
  IC_PACK: {
    name: 'Investment Committee Package',
    description: 'Complete package for IC review and approval',
    includeDocuments: ['IC_MEMO', 'DEAL_TEASER', 'EXPLAIN_APPENDIX'],
    includeSourceDocs: true,
    includeEventLedger: true,
    includeProvenance: true,
    includeSnapshot: true
  },
  CLOSING_PACK: {
    name: 'Closing Package',
    description: 'Final documentation for deal closing',
    includeDocuments: ['LOI', 'PSA', 'CLOSING_STATEMENT', 'CLOSING_CHECKLIST', 'EXPLAIN_APPENDIX'],
    includeSourceDocs: true,
    includeEventLedger: true,
    includeProvenance: true,
    includeSnapshot: true
  },
  AUDIT_PACK: {
    name: 'Audit Package',
    description: 'Complete audit trail and documentation',
    includeDocuments: ['IC_MEMO', 'LOI', 'PSA', 'CLOSING_STATEMENT', 'EXPLAIN_APPENDIX'],
    includeSourceDocs: true,
    includeEventLedger: true,
    includeProvenance: true,
    includeSnapshot: true,
    includeVerificationLog: true,
    includeClaimHistory: true
  },
  DD_PACK: {
    name: 'Due Diligence Package',
    description: 'Documentation for due diligence review',
    includeDocuments: ['DD_LIST', 'DEAL_TEASER'],
    includeSourceDocs: true,
    includeEventLedger: false,
    includeProvenance: true,
    includeSnapshot: true
  }
};

// =============================================================================
// EVIDENCE PACK GENERATOR CLASS
// =============================================================================

class EvidencePackGenerator {
  /**
   * Generate an evidence pack
   */
  async generatePack(dealId, packType, actor) {
    const config = PACK_CONFIGS[packType];
    if (!config) {
      throw new Error(`Unknown pack type: ${packType}`);
    }

    // Get deal information from kernel (system of record)
    let deal;
    try {
      deal = await kernelClient.getDeal(dealId);
    } catch (error) {
      if (error.status === 404) {
        throw new Error('Deal not found');
      }
      throw error;
    }

    // Build pack contents
    const packContents = await this.buildPackContents(dealId, config);

    // Create ZIP archive
    const { buffer, fileCount, manifest } = await this.createZipArchive(
      dealId,
      packType,
      packContents,
      deal
    );

    // Calculate content hash
    const contentHash = crypto.createHash('sha256').update(buffer).digest('hex');

    // Generate storage key
    const timestamp = Date.now();
    const storageKey = `evidence-packs/${dealId}/${packType}_${timestamp}.zip`;

    // Get current deal state snapshot
    const dealState = await dealStateMachine.getState(dealId);
    const dealContext = await documentGenerator.buildDealContext(dealId);

    // Create evidence pack record
    const evidencePack = await prisma.evidencePack.create({
      data: {
        dealId,
        packType,
        name: `${config.name} - ${deal.name}`,
        description: config.description,
        manifest: JSON.stringify(manifest),
        storageKey,
        contentHash,
        sizeBytes: buffer.length,
        fileCount,
        generatedBy: actor.id,
        generatedByName: actor.name,
        asOfTimestamp: new Date(),
        dealStateSnapshot: JSON.stringify({
          state: dealState.currentState,
          model: dealContext.model,
          metrics: dealContext.metrics
        }),
        validationStatus: 'VALID'
      }
    });

    // Record event
    await dealStateMachine.recordEvent(
      dealId,
      'EvidencePackGenerated',
      {
        packId: evidencePack.id,
        packType,
        fileCount,
        sizeBytes: buffer.length,
        contentHash: contentHash.substring(0, 12)
      },
      actor
    );

    return {
      evidencePack,
      buffer,
      manifest
    };
  }

  /**
   * Build all pack contents
   */
  async buildPackContents(dealId, config) {
    const contents = {};

    // Generate included documents
    if (config.includeDocuments) {
      contents.documents = await this.generateDocuments(dealId, config.includeDocuments);
    }

    // Get source documents
    if (config.includeSourceDocs) {
      contents.sourceDocuments = await this.getSourceDocuments(dealId);
    }

    // Get event ledger
    if (config.includeEventLedger) {
      contents.eventLedger = await this.getEventLedger(dealId);
    }

    // Get provenance data
    if (config.includeProvenance) {
      contents.provenance = await this.getProvenanceData(dealId);
    }

    // Get deal snapshot
    if (config.includeSnapshot) {
      contents.snapshot = await this.getDealSnapshot(dealId);
    }

    // Get verification log
    if (config.includeVerificationLog) {
      contents.verificationLog = await this.getVerificationLog(dealId);
    }

    // Get claim history
    if (config.includeClaimHistory) {
      contents.claimHistory = await this.getClaimHistory(dealId);
    }

    return contents;
  }

  /**
   * Generate required documents
   */
  async generateDocuments(dealId, documentTypes) {
    const documents = [];

    for (const docType of documentTypes) {
      try {
        const result = await documentGenerator.generateDocument(dealId, docType, {
          actor: { id: 'system', name: 'Evidence Pack Generator', role: 'SYSTEM' }
        });

        documents.push({
          type: docType,
          fileName: `${docType}_v${result.documentVersion.version}.html`,
          content: result.html,
          version: result.documentVersion.version,
          contentHash: result.contentHash
        });
      } catch (error) {
        console.warn(`Could not generate ${docType}:`, error.message);
      }
    }

    return documents;
  }

  /**
   * Get source documents (artifacts) from kernel
   */
  async getSourceDocuments(dealId) {
    // Get artifacts from kernel (system of record)
    const artifacts = await kernelClient.getArtifacts(dealId);

    return artifacts.map(a => ({
      id: a.id,
      fileName: a.fileName || a.name,
      classification: a.classification || a.type,
      contentType: a.contentType || a.mimeType,
      sizeBytes: a.sizeBytes || a.size,
      uploadedAt: a.uploadedAt || a.createdAt,
      // Note: In production, would fetch actual file content from storage
      storageKey: a.storageKey
    }));
  }

  /**
   * Get event ledger in JSONL format
   */
  async getEventLedger(dealId) {
    const events = await prisma.dealEvent.findMany({
      where: { dealId },
      orderBy: { sequenceNumber: 'asc' }
    });

    // Format as JSONL
    const lines = events.map(event => JSON.stringify({
      seq: event.sequenceNumber,
      type: event.eventType,
      ts: event.occurredAt.toISOString(),
      actor: event.actorId,
      actorName: event.actorName,
      data: JSON.parse(event.eventData),
      fromState: event.fromState,
      toState: event.toState,
      prevHash: event.previousEventHash,
      hash: event.eventHash
    }));

    return lines.join('\n');
  }

  /**
   * Get provenance data for all fields
   */
  async getProvenanceData(dealId) {
    // Get all inputs with provenance
    const inputs = await prisma.underwritingInput.findMany({
      where: { dealId },
      orderBy: { setAt: 'desc' }
    });

    // Get verified claims
    const claims = await prisma.extractionClaim.findMany({
      where: { dealId, status: 'VERIFIED' }
    });

    // Build explain bundle
    const fields = {};

    // Process inputs
    for (const input of inputs) {
      if (!fields[input.fieldPath]) {
        fields[input.fieldPath] = {
          displayName: this.formatFieldName(input.fieldPath),
          currentValue: JSON.parse(input.value),
          sourceChain: [],
          verification: null
        };
      }

      fields[input.fieldPath].sourceChain.push({
        sourceType: input.source,        // Schema field: source (not sourceType)
        documentName: input.documentName,
        documentCell: input.documentCell,
        pageNumber: input.documentPage,   // Schema field: documentPage (not pageNumber)
        setBy: input.setByName,
        setAt: input.setAt,
        rationale: input.rationale
      });
    }

    // Add claim verification data
    for (const claim of claims) {
      if (fields[claim.fieldPath]) {
        fields[claim.fieldPath].verification = {
          status: claim.status,
          verifiedBy: claim.verifiedByName,
          verifiedAt: claim.verifiedAt,
          aiConfidence: claim.aiConfidence,
          claimId: claim.id
        };
      }
    }

    return { fields };
  }

  /**
   * Get deal snapshot
   */
  async getDealSnapshot(dealId) {
    // Get deal from kernel (system of record)
    let deal;
    try {
      deal = await kernelClient.getDeal(dealId);
    } catch (error) {
      deal = null;
    }

    const model = await prisma.underwritingModel.findFirst({
      where: { dealId, isBaseCase: true }
    });

    const state = await dealStateMachine.getState(dealId);

    // Get artifacts from kernel
    const artifacts = await kernelClient.getArtifacts(dealId);
    const artifactCount = artifacts.length;

    const claims = await prisma.extractionClaim.groupBy({
      by: ['status'],
      where: { dealId },
      _count: true
    });

    return {
      deal,
      model,
      state: state.currentState,
      stateEnteredAt: state.enteredStateAt,
      artifactCount,
      claimStats: Object.fromEntries(
        claims.map(c => [c.status, c._count])
      ),
      snapshotAt: new Date().toISOString()
    };
  }

  /**
   * Get verification log
   */
  async getVerificationLog(dealId) {
    const events = await prisma.dealEvent.findMany({
      where: {
        dealId,
        eventType: { in: ['ClaimVerified', 'ClaimRejected', 'ClaimCreated'] }
      },
      orderBy: { occurredAt: 'desc' }
    });

    return events.map(e => ({
      timestamp: e.occurredAt,
      type: e.eventType,
      actor: e.actorName,
      data: JSON.parse(e.eventData)
    }));
  }

  /**
   * Get complete claim history
   */
  async getClaimHistory(dealId) {
    const claims = await prisma.extractionClaim.findMany({
      where: { dealId },
      orderBy: { extractedAt: 'desc' }
    });

    return claims.map(c => ({
      id: c.id,
      fieldPath: c.fieldPath,
      claimedValue: JSON.parse(c.claimedValue),
      status: c.status,
      source: {
        documentName: c.documentName,
        documentType: c.documentType,
        pageNumber: c.pageNumber,
        cellReference: c.cellReference
      },
      extraction: {
        model: c.aiModel,
        confidence: c.aiConfidence,
        extractedAt: c.extractedAt
      },
      verification: {
        verifiedBy: c.verifiedByName,
        verifiedAt: c.verifiedAt,
        rejectionReason: c.rejectionReason,
        correctedValue: c.correctedValue ? JSON.parse(c.correctedValue) : null
      }
    }));
  }

  /**
   * Create ZIP archive
   */
  async createZipArchive(dealId, packType, contents, deal) {
    return new Promise((resolve, reject) => {
      const archive = archiver('zip', {
        zlib: { level: 9 }
      });

      const chunks = [];
      let fileCount = 0;
      const manifest = {
        packType,
        dealId,
        dealName: deal.name,
        generatedAt: new Date().toISOString(),
        files: []
      };

      archive.on('data', chunk => chunks.push(chunk));
      archive.on('error', reject);
      archive.on('end', () => {
        resolve({
          buffer: Buffer.concat(chunks),
          fileCount,
          manifest
        });
      });

      // Add manifest.json
      const manifestJson = JSON.stringify(manifest, null, 2);
      archive.append(manifestJson, { name: 'manifest.json' });
      fileCount++;
      manifest.files.push({ path: 'manifest.json', type: 'manifest' });

      // Add generated documents
      if (contents.documents) {
        for (const doc of contents.documents) {
          const filePath = `documents/${doc.fileName}`;
          archive.append(doc.content, { name: filePath });
          fileCount++;
          manifest.files.push({
            path: filePath,
            type: 'generated_document',
            documentType: doc.type,
            version: doc.version,
            contentHash: doc.contentHash
          });
        }
      }

      // Add event ledger
      if (contents.eventLedger) {
        archive.append(contents.eventLedger, { name: 'event_ledger.jsonl' });
        fileCount++;
        manifest.files.push({ path: 'event_ledger.jsonl', type: 'event_ledger' });
      }

      // Add deal snapshot
      if (contents.snapshot) {
        const snapshotJson = JSON.stringify(contents.snapshot, null, 2);
        archive.append(snapshotJson, { name: 'snapshot.json' });
        fileCount++;
        manifest.files.push({ path: 'snapshot.json', type: 'snapshot' });
      }

      // Add provenance data
      if (contents.provenance) {
        const provenanceJson = JSON.stringify(contents.provenance, null, 2);
        archive.append(provenanceJson, { name: 'provenance/explain_bundle.json' });
        fileCount++;
        manifest.files.push({ path: 'provenance/explain_bundle.json', type: 'provenance' });
      }

      // Add verification log
      if (contents.verificationLog) {
        const logJson = JSON.stringify(contents.verificationLog, null, 2);
        archive.append(logJson, { name: 'compliance/verification_log.json' });
        fileCount++;
        manifest.files.push({ path: 'compliance/verification_log.json', type: 'verification_log' });
      }

      // Add claim history
      if (contents.claimHistory) {
        const claimsJson = JSON.stringify(contents.claimHistory, null, 2);
        archive.append(claimsJson, { name: 'provenance/claim_history.json' });
        fileCount++;
        manifest.files.push({ path: 'provenance/claim_history.json', type: 'claim_history' });
      }

      // Add source document metadata (not actual files for now)
      if (contents.sourceDocuments) {
        const sourceDocsJson = JSON.stringify(contents.sourceDocuments, null, 2);
        archive.append(sourceDocsJson, { name: 'source_documents/manifest.json' });
        fileCount++;
        manifest.files.push({ path: 'source_documents/manifest.json', type: 'source_manifest' });
      }

      // Update manifest with file count
      manifest.fileCount = fileCount;

      archive.finalize();
    });
  }

  /**
   * Get existing evidence packs for a deal
   */
  async getPacks(dealId, packType) {
    const where = { dealId };
    if (packType) {
      where.packType = packType;
    }

    return prisma.evidencePack.findMany({
      where,
      orderBy: { generatedAt: 'desc' }
    });
  }

  /**
   * Get a specific evidence pack
   */
  async getPack(packId) {
    const pack = await prisma.evidencePack.findUnique({
      where: { id: packId }
    });

    if (!pack) {
      throw new Error('Evidence pack not found');
    }

    return {
      ...pack,
      manifest: JSON.parse(pack.manifest),
      dealStateSnapshot: JSON.parse(pack.dealStateSnapshot)
    };
  }

  /**
   * Validate an evidence pack
   */
  async validatePack(packId) {
    const pack = await this.getPack(packId);
    const errors = [];

    // Check deal still exists in kernel
    try {
      await kernelClient.getDeal(pack.dealId);
    } catch (error) {
      if (error.status === 404) {
        errors.push('Deal no longer exists');
      }
    }

    // Verify event chain integrity
    const chainVerification = await dealStateMachine.verifyEventChain(pack.dealId);
    if (!chainVerification.valid) {
      errors.push(`Event chain integrity errors: ${chainVerification.errors.length}`);
    }

    // Update validation status
    const validationStatus = errors.length === 0 ? 'VALID' : 'INVALID';
    await prisma.evidencePack.update({
      where: { id: packId },
      data: {
        validationStatus,
        validationErrors: errors.length > 0 ? JSON.stringify(errors) : null
      }
    });

    return {
      valid: errors.length === 0,
      errors,
      chainVerification
    };
  }

  /**
   * Format field name for display
   */
  formatFieldName(fieldPath) {
    const names = {
      purchasePrice: 'Purchase Price',
      noi: 'Net Operating Income',
      grossPotentialRent: 'Gross Potential Rent',
      effectiveGrossIncome: 'Effective Gross Income',
      operatingExpenses: 'Operating Expenses',
      goingInCapRate: 'Going-In Cap Rate',
      exitCapRate: 'Exit Cap Rate',
      loanAmount: 'Loan Amount',
      interestRate: 'Interest Rate',
      totalUnits: 'Total Units',
      grossSF: 'Gross Square Footage'
    };

    return names[fieldPath] || fieldPath
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, str => str.toUpperCase());
  }
}

// Export singleton instance
const evidencePackGenerator = new EvidencePackGenerator();

export {
  evidencePackGenerator,
  EvidencePackGenerator,
  PACK_CONFIGS
};
