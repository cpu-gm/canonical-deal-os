/**
 * Deal Ingest Service
 *
 * Handles zero-friction intake of deals from brokers.
 * Supports multiple intake sources: email, upload, paste, URL, voice, photo.
 *
 * Flow:
 * 1. Create DealDraft from any input source
 * 2. Store and classify documents
 * 3. Extract claims with provenance
 * 4. Detect and flag conflicts
 * 5. Ready for OM drafting
 *
 * All extracted data is treated as "claims" - not truth until verified.
 */

import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import path from 'path';
import {
  classifyDocumentByFilename,
  isSupportedFileType
} from './email-classifier.js';

const prisma = new PrismaClient();

// Valid ingest sources
const INGEST_SOURCES = new Set([
  'EMAIL',
  'UPLOAD',
  'PASTE',
  'URL',
  'VOICE',
  'PHOTO'
]);

// Valid deal draft statuses
const DEAL_DRAFT_STATUSES = {
  DRAFT_INGESTED: 'DRAFT_INGESTED',
  OM_DRAFTED: 'OM_DRAFTED',
  OM_BROKER_APPROVED: 'OM_BROKER_APPROVED',
  OM_APPROVED_FOR_MARKETING: 'OM_APPROVED_FOR_MARKETING',
  DISTRIBUTED: 'DISTRIBUTED'
};

// Asset types for classification
const ASSET_TYPES = new Set([
  'MULTIFAMILY',
  'OFFICE',
  'RETAIL',
  'INDUSTRIAL',
  'HOSPITALITY',
  'MIXED_USE',
  'LAND',
  'SELF_STORAGE',
  'SENIOR_HOUSING',
  'STUDENT_HOUSING',
  'MOBILE_HOME',
  'OTHER'
]);

class DealIngestService {
  /**
   * Create a new deal draft from any input source
   *
   * @param {Object} params
   * @param {string} params.organizationId - Organization ID
   * @param {Object} params.broker - Broker creating the deal { userId, email, name, firmName }
   * @param {string} params.ingestSource - Source type: EMAIL, UPLOAD, PASTE, URL, VOICE, PHOTO
   * @param {Object} params.sourceData - Raw source data (JSON-serializable)
   * @param {Object} [params.seller] - Optional seller info { userId, email, name, entityName }
   * @returns {Promise<Object>} Created DealDraft
   */
  async createDealDraft({ organizationId, broker, ingestSource, sourceData, seller }) {
    // Validate ingest source
    if (!INGEST_SOURCES.has(ingestSource)) {
      throw new Error(`Invalid ingest source: ${ingestSource}. Valid sources: ${[...INGEST_SOURCES].join(', ')}`);
    }

    // Validate broker info
    if (!broker?.userId || !broker?.email || !broker?.name) {
      throw new Error('Broker must have userId, email, and name');
    }

    // Create deal draft with broker relationship
    const dealDraft = await prisma.$transaction(async (tx) => {
      // Create the deal draft
      const draft = await tx.dealDraft.create({
        data: {
          organizationId,
          status: DEAL_DRAFT_STATUSES.DRAFT_INGESTED,
          ingestSource,
          ingestSourceRaw: sourceData ? JSON.stringify(sourceData) : null
        }
      });

      // Add primary broker
      await tx.dealDraftBroker.create({
        data: {
          dealDraftId: draft.id,
          userId: broker.userId,
          email: broker.email,
          name: broker.name,
          firmName: broker.firmName || null,
          role: 'PRIMARY',
          isPrimaryContact: true,
          canApproveOM: false, // Default: seller must approve
          canDistribute: true,
          canAuthorize: true,
          addedBy: broker.userId
        }
      });

      // Add seller if provided
      if (seller?.userId) {
        await tx.dealDraftSeller.create({
          data: {
            dealDraftId: draft.id,
            userId: seller.userId,
            email: seller.email,
            name: seller.name,
            entityName: seller.entityName || null,
            hasDirectAccess: true,
            receiveNotifications: true,
            requiresOMApproval: true, // Default: seller must approve OM
            requiresBuyerApproval: false, // Default: broker can authorize
            sellerSeesBuyerIdentity: true
          }
        });
      }

      // Log event
      await tx.dealIntakeEventLog.create({
        data: {
          dealDraftId: draft.id,
          organizationId,
          eventType: 'DRAFT_CREATED',
          eventData: JSON.stringify({
            ingestSource,
            brokerId: broker.userId,
            sellerId: seller?.userId || null
          }),
          actorId: broker.userId,
          actorName: broker.name,
          actorRole: 'BROKER'
        }
      });

      return draft;
    });

    return this.formatDealDraft(dealDraft);
  }

  /**
   * Add a document to a deal draft
   *
   * @param {Object} params
   * @param {string} params.dealDraftId - Deal draft ID
   * @param {string} params.filename - Original filename
   * @param {string} params.mimeType - MIME type
   * @param {number} params.sizeBytes - File size in bytes
   * @param {string} params.storageKey - Path to stored file
   * @param {string} params.uploadedBy - User ID who uploaded
   * @param {string} [params.ingestSource] - Source: EMAIL_ATTACHMENT, UPLOAD, URL_FETCH
   * @param {string} [params.sourceEmailId] - Email intake ID if from email
   * @returns {Promise<Object>} Created DealDraftDocument
   */
  async addDocument({
    dealDraftId,
    filename,
    mimeType,
    sizeBytes,
    storageKey,
    uploadedBy,
    ingestSource = 'UPLOAD',
    sourceEmailId
  }) {
    // Verify deal draft exists
    const dealDraft = await prisma.dealDraft.findUnique({
      where: { id: dealDraftId }
    });

    if (!dealDraft) {
      throw new Error('Deal draft not found');
    }

    // Check if file type is supported
    if (!isSupportedFileType(filename, mimeType)) {
      throw new Error(`Unsupported file type: ${filename} (${mimeType})`);
    }

    // Classify document by filename
    const classifiedType = classifyDocumentByFilename(filename);

    // Generate a safe filename
    const ext = path.extname(filename);
    const baseName = path.basename(filename, ext).replace(/[^a-zA-Z0-9-_]/g, '_');
    const safeFilename = `${baseName}_${crypto.randomBytes(4).toString('hex')}${ext}`;

    const document = await prisma.$transaction(async (tx) => {
      const doc = await tx.dealDraftDocument.create({
        data: {
          dealDraftId,
          filename: safeFilename,
          originalFilename: filename,
          mimeType,
          sizeBytes,
          storageKey,
          classifiedType: classifiedType !== 'OTHER' ? classifiedType : null,
          classificationConfidence: classifiedType !== 'OTHER' ? 0.7 : null,
          status: 'PENDING',
          ingestSource,
          sourceEmailId,
          uploadedBy
        }
      });

      // Log event
      await tx.dealIntakeEventLog.create({
        data: {
          dealDraftId,
          organizationId: dealDraft.organizationId,
          eventType: 'DOCUMENT_UPLOADED',
          eventData: JSON.stringify({
            documentId: doc.id,
            filename,
            classifiedType,
            mimeType,
            sizeBytes
          }),
          actorId: uploadedBy,
          actorName: 'System',
          actorRole: 'SYSTEM'
        }
      });

      return doc;
    });

    return this.formatDocument(document);
  }

  /**
   * Add multiple documents in batch
   */
  async addDocuments(dealDraftId, documents, uploadedBy) {
    const results = [];
    const errors = [];

    for (const doc of documents) {
      try {
        const result = await this.addDocument({
          dealDraftId,
          ...doc,
          uploadedBy
        });
        results.push(result);
      } catch (error) {
        errors.push({
          filename: doc.filename,
          error: error.message
        });
      }
    }

    return { documents: results, errors };
  }

  /**
   * Add a claim to a deal draft
   *
   * @param {Object} params
   * @param {string} params.dealDraftId - Deal draft ID
   * @param {string} params.field - Field name (e.g., 'askingPrice', 'unitCount')
   * @param {*} params.value - The claimed value
   * @param {string} [params.displayValue] - Human-readable value
   * @param {string} params.extractionMethod - LLM, REGEX, OCR, EXCEL_FORMULA, MANUAL
   * @param {number} [params.confidence] - 0.0-1.0 confidence score
   * @param {Object} [params.source] - Source attribution
   * @returns {Promise<Object>} Created DealClaim
   */
  async addClaim({
    dealDraftId,
    field,
    value,
    displayValue,
    extractionMethod,
    confidence = 0.8,
    source = {}
  }) {
    // Verify deal draft exists
    const dealDraft = await prisma.dealDraft.findUnique({
      where: { id: dealDraftId }
    });

    if (!dealDraft) {
      throw new Error('Deal draft not found');
    }

    // Check for existing unverified claims for this field
    const existingClaims = await prisma.dealClaim.findMany({
      where: {
        dealDraftId,
        field,
        status: 'UNVERIFIED'
      }
    });

    // Generate conflict group ID if there are existing claims
    let conflictGroupId = null;
    if (existingClaims.length > 0) {
      conflictGroupId = existingClaims[0].conflictGroupId || crypto.randomUUID();

      // Update existing claims to same conflict group
      await prisma.dealClaim.updateMany({
        where: {
          id: { in: existingClaims.map(c => c.id) }
        },
        data: { conflictGroupId }
      });
    }

    const claim = await prisma.$transaction(async (tx) => {
      const newClaim = await tx.dealClaim.create({
        data: {
          dealDraftId,
          field,
          value: JSON.stringify(value),
          displayValue,
          documentId: source.documentId || null,
          documentName: source.documentName || null,
          pageNumber: source.pageNumber || null,
          location: source.location || null,
          textSnippet: source.textSnippet || null,
          extractionMethod,
          confidence,
          status: 'UNVERIFIED',
          conflictGroupId
        }
      });

      // Create conflicts with existing claims
      for (const existingClaim of existingClaims) {
        const existingValue = JSON.parse(existingClaim.value);
        let variancePercent = null;

        // Calculate variance for numeric values
        if (typeof value === 'number' && typeof existingValue === 'number' && existingValue !== 0) {
          variancePercent = Math.abs((value - existingValue) / existingValue) * 100;
        }

        await tx.dealClaimConflict.create({
          data: {
            dealDraftId,
            claimAId: existingClaim.id,
            claimBId: newClaim.id,
            field,
            valueA: existingClaim.value,
            valueB: JSON.stringify(value),
            variancePercent,
            status: 'OPEN'
          }
        });
      }

      // Log event
      await tx.dealIntakeEventLog.create({
        data: {
          dealDraftId,
          organizationId: dealDraft.organizationId,
          eventType: 'CLAIM_EXTRACTED',
          eventData: JSON.stringify({
            claimId: newClaim.id,
            field,
            value,
            extractionMethod,
            confidence,
            hasConflict: existingClaims.length > 0
          }),
          actorId: 'system',
          actorName: 'System',
          actorRole: 'SYSTEM'
        }
      });

      return newClaim;
    });

    // Update deal draft with inferred values
    await this.updateDealFromClaim(dealDraftId, field, value);

    return this.formatClaim(claim);
  }

  /**
   * Update deal draft fields from claim values
   */
  async updateDealFromClaim(dealDraftId, field, value) {
    const fieldMapping = {
      'propertyName': 'propertyName',
      'propertyAddress': 'propertyAddress',
      'address': 'propertyAddress',
      'assetType': 'assetType',
      'askingPrice': 'askingPrice',
      'price': 'askingPrice',
      'unitCount': 'unitCount',
      'units': 'unitCount',
      'totalUnits': 'unitCount',
      'totalSF': 'totalSF',
      'squareFeet': 'totalSF',
      'sf': 'totalSF'
    };

    const dbField = fieldMapping[field];
    if (!dbField) return;

    // Validate asset type
    if (dbField === 'assetType' && typeof value === 'string') {
      const normalizedType = value.toUpperCase().replace(/[^A-Z_]/g, '_');
      if (!ASSET_TYPES.has(normalizedType)) {
        return; // Don't update with invalid asset type
      }
      value = normalizedType;
    }

    await prisma.dealDraft.update({
      where: { id: dealDraftId },
      data: { [dbField]: value }
    });
  }

  /**
   * Add a co-broker to a deal
   */
  async addCoBroker(dealDraftId, broker, addedBy) {
    // Verify deal draft exists
    const dealDraft = await prisma.dealDraft.findUnique({
      where: { id: dealDraftId },
      include: { brokers: true }
    });

    if (!dealDraft) {
      throw new Error('Deal draft not found');
    }

    // Check if broker already exists on this deal
    const existingBroker = dealDraft.brokers.find(b => b.userId === broker.userId);
    if (existingBroker) {
      throw new Error('Broker is already on this deal');
    }

    const coBroker = await prisma.$transaction(async (tx) => {
      const newBroker = await tx.dealDraftBroker.create({
        data: {
          dealDraftId,
          userId: broker.userId,
          email: broker.email,
          name: broker.name,
          firmName: broker.firmName || null,
          role: 'CO_BROKER',
          isPrimaryContact: false,
          canApproveOM: false,
          canDistribute: true,
          canAuthorize: true,
          addedBy
        }
      });

      // Log event
      await tx.dealIntakeEventLog.create({
        data: {
          dealDraftId,
          organizationId: dealDraft.organizationId,
          eventType: 'BROKER_ADDED',
          eventData: JSON.stringify({
            brokerId: broker.userId,
            brokerName: broker.name,
            role: 'CO_BROKER'
          }),
          actorId: addedBy,
          actorName: 'System',
          actorRole: 'BROKER'
        }
      });

      return newBroker;
    });

    return this.formatBroker(coBroker);
  }

  /**
   * Set the seller for a deal
   */
  async setSeller(dealDraftId, seller, setBy) {
    const dealDraft = await prisma.dealDraft.findUnique({
      where: { id: dealDraftId },
      include: { seller: true }
    });

    if (!dealDraft) {
      throw new Error('Deal draft not found');
    }

    if (dealDraft.seller) {
      throw new Error('Seller is already set for this deal. Use updateSeller instead.');
    }

    const newSeller = await prisma.$transaction(async (tx) => {
      const s = await tx.dealDraftSeller.create({
        data: {
          dealDraftId,
          userId: seller.userId,
          email: seller.email,
          name: seller.name,
          entityName: seller.entityName || null,
          hasDirectAccess: seller.hasDirectAccess ?? true,
          receiveNotifications: seller.receiveNotifications ?? true,
          requiresOMApproval: seller.requiresOMApproval ?? true,
          requiresBuyerApproval: seller.requiresBuyerApproval ?? false,
          sellerSeesBuyerIdentity: seller.sellerSeesBuyerIdentity ?? true
        }
      });

      // Log event
      await tx.dealIntakeEventLog.create({
        data: {
          dealDraftId,
          organizationId: dealDraft.organizationId,
          eventType: 'SELLER_SET',
          eventData: JSON.stringify({
            sellerId: seller.userId,
            sellerName: seller.name,
            entityName: seller.entityName
          }),
          actorId: setBy,
          actorName: 'System',
          actorRole: 'BROKER'
        }
      });

      return s;
    });

    return this.formatSeller(newSeller);
  }

  /**
   * Get a deal draft by ID with all relations
   */
  async getDealDraft(dealDraftId, includeRelations = true) {
    const dealDraft = await prisma.dealDraft.findUnique({
      where: { id: dealDraftId },
      include: includeRelations ? {
        brokers: true,
        seller: true,
        documents: {
          orderBy: { createdAt: 'desc' }
        },
        claims: {
          where: { status: 'UNVERIFIED' },
          orderBy: { createdAt: 'desc' }
        },
        omVersions: {
          orderBy: { versionNumber: 'desc' },
          take: 1
        }
      } : undefined
    });

    if (!dealDraft) {
      throw new Error('Deal draft not found');
    }

    return this.formatDealDraft(dealDraft, includeRelations);
  }

  /**
   * List deal drafts for an organization
   */
  async listDealDrafts(organizationId, options = {}) {
    const {
      status,
      brokerId,
      limit = 50,
      offset = 0
    } = options;

    const where = { organizationId };

    if (status) {
      where.status = status;
    }

    if (brokerId) {
      where.brokers = {
        some: { userId: brokerId }
      };
    }

    const [drafts, total] = await Promise.all([
      prisma.dealDraft.findMany({
        where,
        include: {
          brokers: { where: { isPrimaryContact: true } },
          seller: true
        },
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit
      }),
      prisma.dealDraft.count({ where })
    ]);

    return {
      drafts: drafts.map(d => this.formatDealDraft(d, true)),
      total,
      limit,
      offset
    };
  }

  /**
   * Get conflicts for a deal draft
   */
  async getConflicts(dealDraftId, options = {}) {
    const { status = 'OPEN', field } = options;

    const where = { dealDraftId };
    if (status) where.status = status;
    if (field) where.field = field;

    const conflicts = await prisma.dealClaimConflict.findMany({
      where,
      include: {
        claimA: true,
        claimB: true
      },
      orderBy: { createdAt: 'desc' }
    });

    return conflicts.map(this.formatConflict.bind(this));
  }

  /**
   * Resolve a conflict
   */
  async resolveConflict(conflictId, resolution, actor) {
    const { resolvedClaimId, resolvedValue, method } = resolution;

    const conflict = await prisma.dealClaimConflict.findUnique({
      where: { id: conflictId },
      include: { claimA: true, claimB: true }
    });

    if (!conflict) {
      throw new Error('Conflict not found');
    }

    if (conflict.status !== 'OPEN') {
      throw new Error('Conflict is already resolved');
    }

    // Validate method
    const validMethods = ['CHOSE_CLAIM_A', 'CHOSE_CLAIM_B', 'MANUAL_OVERRIDE', 'AVERAGED'];
    if (!validMethods.includes(method)) {
      throw new Error(`Invalid resolution method: ${method}`);
    }

    // Get the deal draft for logging
    const dealDraft = await prisma.dealDraft.findUnique({
      where: { id: conflict.dealDraftId }
    });

    const updated = await prisma.$transaction(async (tx) => {
      const resolved = await tx.dealClaimConflict.update({
        where: { id: conflictId },
        data: {
          status: 'RESOLVED',
          resolvedClaimId,
          resolvedValue: resolvedValue !== undefined ? JSON.stringify(resolvedValue) : null,
          resolvedBy: actor.id,
          resolvedByName: actor.name,
          resolvedAt: new Date(),
          resolutionMethod: method
        }
      });

      // Update the chosen claim to BROKER_CONFIRMED
      if (resolvedClaimId) {
        await tx.dealClaim.update({
          where: { id: resolvedClaimId },
          data: {
            status: 'BROKER_CONFIRMED',
            verifiedBy: actor.id,
            verifiedByName: actor.name,
            verifiedAt: new Date()
          }
        });
      }

      // Log event
      await tx.dealIntakeEventLog.create({
        data: {
          dealDraftId: conflict.dealDraftId,
          organizationId: dealDraft?.organizationId,
          eventType: 'CONFLICT_RESOLVED',
          eventData: JSON.stringify({
            conflictId,
            field: conflict.field,
            method,
            resolvedValue
          }),
          actorId: actor.id,
          actorName: actor.name,
          actorRole: 'BROKER'
        }
      });

      return resolved;
    });

    // Update deal draft with resolved value
    if (resolvedValue !== undefined) {
      await this.updateDealFromClaim(conflict.dealDraftId, conflict.field, resolvedValue);
    }

    return this.formatConflict({ ...updated, claimA: conflict.claimA, claimB: conflict.claimB });
  }

  /**
   * Advance deal draft status
   */
  async advanceStatus(dealDraftId, newStatus, actor) {
    const validTransitions = {
      [DEAL_DRAFT_STATUSES.DRAFT_INGESTED]: [DEAL_DRAFT_STATUSES.OM_DRAFTED],
      [DEAL_DRAFT_STATUSES.OM_DRAFTED]: [DEAL_DRAFT_STATUSES.OM_BROKER_APPROVED],
      [DEAL_DRAFT_STATUSES.OM_BROKER_APPROVED]: [DEAL_DRAFT_STATUSES.OM_APPROVED_FOR_MARKETING],
      [DEAL_DRAFT_STATUSES.OM_APPROVED_FOR_MARKETING]: [DEAL_DRAFT_STATUSES.DISTRIBUTED],
      [DEAL_DRAFT_STATUSES.DISTRIBUTED]: [] // Terminal state (for distribution)
    };

    const dealDraft = await prisma.dealDraft.findUnique({
      where: { id: dealDraftId }
    });

    if (!dealDraft) {
      throw new Error('Deal draft not found');
    }

    const allowed = validTransitions[dealDraft.status] || [];
    if (!allowed.includes(newStatus)) {
      throw new Error(`Cannot transition from ${dealDraft.status} to ${newStatus}`);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const draft = await tx.dealDraft.update({
        where: { id: dealDraftId },
        data: { status: newStatus }
      });

      // Log event
      await tx.dealIntakeEventLog.create({
        data: {
          dealDraftId,
          organizationId: dealDraft.organizationId,
          eventType: `STATUS_${newStatus}`,
          eventData: JSON.stringify({
            previousStatus: dealDraft.status,
            newStatus
          }),
          actorId: actor.id,
          actorName: actor.name,
          actorRole: actor.role || 'BROKER'
        }
      });

      return draft;
    });

    return this.formatDealDraft(updated);
  }

  // ============================================================================
  // Formatters
  // ============================================================================

  formatDealDraft(draft, includeRelations = false) {
    const formatted = {
      id: draft.id,
      organizationId: draft.organizationId,
      status: draft.status,
      ingestSource: draft.ingestSource,
      propertyName: draft.propertyName,
      propertyAddress: draft.propertyAddress,
      assetType: draft.assetType,
      askingPrice: draft.askingPrice,
      unitCount: draft.unitCount,
      totalSF: draft.totalSF,
      listingType: draft.listingType,
      isAnonymousSeller: draft.isAnonymousSeller,
      kernelDealId: draft.kernelDealId,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
      promotedAt: draft.promotedAt
    };

    if (includeRelations && draft.brokers) {
      formatted.brokers = draft.brokers.map(this.formatBroker.bind(this));
    }

    if (includeRelations && draft.seller) {
      formatted.seller = this.formatSeller(draft.seller);
    }

    if (includeRelations && draft.documents) {
      formatted.documents = draft.documents.map(this.formatDocument.bind(this));
    }

    if (includeRelations && draft.claims) {
      formatted.claims = draft.claims.map(this.formatClaim.bind(this));
    }

    if (includeRelations && draft.omVersions?.length > 0) {
      formatted.latestOMVersion = this.formatOMVersion(draft.omVersions[0]);
    }

    return formatted;
  }

  formatBroker(broker) {
    return {
      id: broker.id,
      userId: broker.userId,
      email: broker.email,
      name: broker.name,
      firmName: broker.firmName,
      role: broker.role,
      isPrimaryContact: broker.isPrimaryContact,
      permissions: {
        canApproveOM: broker.canApproveOM,
        canDistribute: broker.canDistribute,
        canAuthorize: broker.canAuthorize
      },
      addedAt: broker.addedAt
    };
  }

  formatSeller(seller) {
    return {
      id: seller.id,
      userId: seller.userId,
      email: seller.email,
      name: seller.name,
      entityName: seller.entityName,
      access: {
        hasDirectAccess: seller.hasDirectAccess,
        receiveNotifications: seller.receiveNotifications
      },
      approvalSettings: {
        requiresOMApproval: seller.requiresOMApproval,
        requiresBuyerApproval: seller.requiresBuyerApproval,
        sellerSeesBuyerIdentity: seller.sellerSeesBuyerIdentity
      },
      createdAt: seller.createdAt
    };
  }

  formatDocument(doc) {
    return {
      id: doc.id,
      filename: doc.filename,
      originalFilename: doc.originalFilename,
      mimeType: doc.mimeType,
      sizeBytes: doc.sizeBytes,
      storageKey: doc.storageKey,
      classification: {
        type: doc.classifiedType,
        confidence: doc.classificationConfidence
      },
      processing: {
        status: doc.status,
        processedAt: doc.processedAt,
        errorMessage: doc.errorMessage
      },
      extraction: {
        pageCount: doc.pageCount,
        claimCount: doc.extractedClaimCount
      },
      source: {
        ingestSource: doc.ingestSource,
        emailId: doc.sourceEmailId
      },
      createdAt: doc.createdAt
    };
  }

  formatClaim(claim) {
    return {
      id: claim.id,
      field: claim.field,
      value: JSON.parse(claim.value),
      displayValue: claim.displayValue,
      source: {
        documentId: claim.documentId,
        documentName: claim.documentName,
        pageNumber: claim.pageNumber,
        location: claim.location,
        textSnippet: claim.textSnippet
      },
      extraction: {
        method: claim.extractionMethod,
        confidence: claim.confidence
      },
      verification: {
        status: claim.status,
        verifiedBy: claim.verifiedBy,
        verifiedByName: claim.verifiedByName,
        verifiedAt: claim.verifiedAt,
        rejectionReason: claim.rejectionReason
      },
      conflictGroupId: claim.conflictGroupId,
      createdAt: claim.createdAt
    };
  }

  formatConflict(conflict) {
    return {
      id: conflict.id,
      dealDraftId: conflict.dealDraftId,
      field: conflict.field,
      claims: {
        a: conflict.claimA ? this.formatClaim(conflict.claimA) : { id: conflict.claimAId, value: JSON.parse(conflict.valueA) },
        b: conflict.claimB ? this.formatClaim(conflict.claimB) : { id: conflict.claimBId, value: JSON.parse(conflict.valueB) }
      },
      variancePercent: conflict.variancePercent,
      resolution: {
        status: conflict.status,
        resolvedClaimId: conflict.resolvedClaimId,
        resolvedValue: conflict.resolvedValue ? JSON.parse(conflict.resolvedValue) : null,
        resolvedBy: conflict.resolvedBy,
        resolvedByName: conflict.resolvedByName,
        resolvedAt: conflict.resolvedAt,
        method: conflict.resolutionMethod
      },
      createdAt: conflict.createdAt
    };
  }

  formatOMVersion(version) {
    return {
      id: version.id,
      versionNumber: version.versionNumber,
      status: version.status,
      approval: {
        brokerApprovedBy: version.brokerApprovedBy,
        brokerApprovedAt: version.brokerApprovedAt,
        sellerApprovedBy: version.sellerApprovedBy,
        sellerApprovedAt: version.sellerApprovedAt
      },
      createdBy: version.createdBy,
      createdByName: version.createdByName,
      createdAt: version.createdAt
    };
  }
}

// Export singleton instance
const dealIngestService = new DealIngestService();

export {
  dealIngestService,
  DealIngestService,
  DEAL_DRAFT_STATUSES,
  INGEST_SOURCES,
  ASSET_TYPES
};
