/**
 * Document Generator Service
 *
 * Main orchestrator for generating deal documents with full provenance tracking.
 *
 * Features:
 * - Handlebars template engine for document rendering
 * - Field-level provenance injection
 * - Version control (Draft/Binding/Executed)
 * - Watermarking and checksums
 * - PDF generation via Puppeteer
 */

import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs';
import Handlebars from 'handlebars';
import { PrismaClient } from '@prisma/client';
import { dealStateMachine } from './deal-state-machine.js';
import kernelClient from './kernel-client.js';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prisma = new PrismaClient();

// =============================================================================
// HANDLEBARS HELPERS
// =============================================================================

// Currency formatting
Handlebars.registerHelper('currency', function(value) {
  if (value == null) return 'N/A';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(value);
});

// Percentage formatting
Handlebars.registerHelper('percent', function(value, decimals = 1) {
  if (value == null) return 'N/A';
  const pct = typeof value === 'number' && value <= 1 ? value * 100 : value;
  return `${pct.toFixed(decimals)}%`;
});

// Multiple formatting (e.g., 2.5x)
Handlebars.registerHelper('multiple', function(value, decimals = 2) {
  if (value == null) return 'N/A';
  return `${value.toFixed(decimals)}x`;
});

// Number formatting with commas
Handlebars.registerHelper('number', function(value, decimals = 0) {
  if (value == null) return 'N/A';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(value);
});

// Date formatting
Handlebars.registerHelper('date', function(value, format = 'short') {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (format === 'short') {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } else if (format === 'long') {
    return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }
  return date.toISOString().split('T')[0];
});

// Conditional helper
Handlebars.registerHelper('ifEquals', function(arg1, arg2, options) {
  return arg1 === arg2 ? options.fn(this) : options.inverse(this);
});

// Provenance field wrapper - adds data attributes for traceability
Handlebars.registerHelper('provField', function(fieldPath, value, options) {
  const provenance = options.data.root._provenance?.[fieldPath];
  const formattedValue = options.fn ? options.fn(value) : value;

  if (!provenance) {
    return new Handlebars.SafeString(`<span class="prov-field" data-field="${fieldPath}">${formattedValue}</span>`);
  }

  const attrs = [
    `data-field="${fieldPath}"`,
    `data-source="${provenance.documentName || ''}"`,
    `data-page="${provenance.pageNumber || ''}"`,
    `data-claim-id="${provenance.claimId || ''}"`,
    `data-confidence="${provenance.confidence || ''}"`,
    `data-verified-by="${provenance.verifiedByName || ''}"`
  ].join(' ');

  return new Handlebars.SafeString(`<span class="prov-field" ${attrs}>${formattedValue}</span>`);
});

// =============================================================================
// DOCUMENT TYPES AND TEMPLATES
// =============================================================================

const DOCUMENT_TYPES = {
  IC_MEMO: {
    name: 'Investment Committee Memo',
    template: 'ic-memo.hbs',
    defaultWatermark: 'DRAFT - FOR IC REVIEW ONLY'
  },
  LOI: {
    name: 'Letter of Intent',
    template: 'loi.hbs',
    defaultWatermark: 'DRAFT - NOT FOR EXECUTION'
  },
  PSA: {
    name: 'Purchase and Sale Agreement',
    template: 'psa-skeleton.hbs',
    defaultWatermark: 'DRAFT - NOT FOR EXECUTION'
  },
  DD_LIST: {
    name: 'Due Diligence Request List',
    template: 'dd-request-list.hbs',
    defaultWatermark: null
  },
  CLOSING_STATEMENT: {
    name: 'Closing Statement',
    template: 'closing-statement.hbs',
    defaultWatermark: 'DRAFT - SUBJECT TO FINAL VERIFICATION'
  },
  ESTOPPEL_REQUEST: {
    name: 'Tenant Estoppel Request',
    template: 'estoppel-request.hbs',
    defaultWatermark: null
  },
  CLOSING_CHECKLIST: {
    name: 'Closing Checklist',
    template: 'closing-checklist.hbs',
    defaultWatermark: null
  },
  DEAL_TEASER: {
    name: 'Deal Teaser / One-Pager',
    template: 'deal-teaser.hbs',
    defaultWatermark: 'CONFIDENTIAL'
  },
  EXPLAIN_APPENDIX: {
    name: 'Explain Appendix',
    template: 'explain-appendix.hbs',
    defaultWatermark: null
  },
  // LP Financial Documents
  CAPITAL_CALL_NOTICE: {
    name: 'Capital Call Notice',
    template: 'capital-call-notice.hbs',
    defaultWatermark: null
  },
  DISTRIBUTION_STATEMENT: {
    name: 'Distribution Statement',
    template: 'distribution-statement.hbs',
    defaultWatermark: null
  }
};

// =============================================================================
// DOCUMENT GENERATOR CLASS
// =============================================================================

class DocumentGenerator {
  constructor() {
    this.templateCache = new Map();
    this.templatesDir = path.join(__dirname, 'document-templates');
  }

  /**
   * Load and compile a template
   */
  async loadTemplate(templateName) {
    if (this.templateCache.has(templateName)) {
      return this.templateCache.get(templateName);
    }

    const templatePath = path.join(this.templatesDir, templateName);
    const templateSource = await fs.readFile(templatePath, 'utf-8');
    const template = Handlebars.compile(templateSource);

    this.templateCache.set(templateName, template);
    return template;
  }

  /**
   * Register partial templates
   */
  async registerPartials() {
    const partialsDir = path.join(this.templatesDir, '_partials');

    try {
      const files = await fs.readdir(partialsDir);

      for (const file of files) {
        if (file.endsWith('.hbs')) {
          const partialName = file.replace('.hbs', '');
          const partialPath = path.join(partialsDir, file);
          const partialSource = await fs.readFile(partialPath, 'utf-8');
          Handlebars.registerPartial(partialName, partialSource);
        }
      }
    } catch (error) {
      console.warn('Could not load partial templates:', error.message);
    }
  }

  /**
   * Build deal context for templates
   */
  async buildDealContext(dealId) {
    // Get deal from kernel (system of record)
    let deal;
    try {
      deal = await kernelClient.getDeal(dealId);
    } catch (error) {
      if (error.status === 404) {
        throw new Error('Deal not found');
      }
      throw error;
    }

    // Get underwriting model from BFF database
    const model = await prisma.underwritingModel.findFirst({
      where: { dealId, isBaseCase: true }
    });

    // Get all inputs with provenance
    const inputs = await prisma.underwritingInput.findMany({
      where: { dealId },
      orderBy: { setAt: 'desc' }
    });

    // Build provenance map
    const provenance = {};
    for (const input of inputs) {
      if (!provenance[input.fieldPath]) {
        provenance[input.fieldPath] = {
          value: JSON.parse(input.value),
          sourceType: input.source,
          documentName: input.documentName,
          documentCell: input.documentCell,
          pageNumber: input.documentPage,
          claimId: input.claimId,
          confidence: input.aiConfidence,
          verifiedBy: input.verifiedBy,
          verifiedByName: input.verifiedByName,
          setAt: input.setAt
        };
      }
    }

    // Get verified claims for additional provenance
    const claims = await prisma.extractionClaim.findMany({
      where: { dealId, status: 'VERIFIED' }
    });

    for (const claim of claims) {
      if (!provenance[claim.fieldPath]) {
        provenance[claim.fieldPath] = {
          value: JSON.parse(claim.claimedValue),
          sourceType: 'AI_EXTRACTION',
          documentName: claim.documentName,
          documentCell: claim.cellReference,
          pageNumber: claim.pageNumber,
          claimId: claim.id,
          confidence: claim.aiConfidence,
          verifiedBy: claim.verifiedBy,
          verifiedByName: claim.verifiedByName,
          setAt: claim.verifiedAt
        };
      }
    }

    // Get artifacts from kernel (system of record)
    const artifacts = await kernelClient.getArtifacts(dealId);

    // Get rent roll data from BFF
    const rentRollUnits = await prisma.rentRollUnit.findMany({
      where: { dealId }
    });

    // Get T12 data from BFF (using T12LineItem, not t12Period)
    const t12LineItems = await prisma.t12LineItem.findMany({
      where: { dealId },
      orderBy: { lineOrder: 'asc' }
    });

    // Calculate metrics if model exists
    let metrics = null;
    if (model) {
      metrics = this.calculateMetrics(model);
    }

    return {
      deal,
      model,
      metrics,
      inputs: provenance,
      _provenance: provenance, // For provField helper
      artifacts,
      rentRoll: {
        units: rentRollUnits,
        totalUnits: rentRollUnits.length,
        // Derive occupancy from status field (not isOccupied)
        occupiedUnits: rentRollUnits.filter(u => u.status === 'OCCUPIED' || u.status === 'CURRENT').length,
        vacantUnits: rentRollUnits.filter(u => u.status === 'VACANT').length
      },
      t12: t12LineItems,
      generatedAt: new Date().toISOString(),
      generatedBy: 'Deal Doc Factory'
    };
  }

  /**
   * Calculate key metrics from underwriting model
   * NOTE: Uses schema field names:
   * - netOperatingIncome (not noi)
   * - amortization (not amortizationYears)
   * - loanTerm (not loanTermYears)
   * - holdPeriod (not holdPeriodYears)
   */
  calculateMetrics(model) {
    const metrics = {};

    // Use purchasePrice (added to schema) and netOperatingIncome (schema field)
    const noi = model.netOperatingIncome;
    const purchasePrice = model.purchasePrice;

    // Cap Rate
    if (purchasePrice && noi) {
      metrics.goingInCapRate = noi / purchasePrice;
    }

    // DSCR
    if (noi && model.loanAmount && model.interestRate) {
      const annualDebtService = this.calculateDebtService(
        model.loanAmount,
        model.interestRate,
        model.amortization || 30  // schema field: amortization (not amortizationYears)
      );
      metrics.dscr = noi / annualDebtService;
      metrics.annualDebtService = annualDebtService;
    }

    // Equity
    if (purchasePrice && model.loanAmount) {
      metrics.equityRequired = purchasePrice - model.loanAmount;
      metrics.ltv = model.loanAmount / purchasePrice;
    }

    // Cash on Cash
    if (metrics.equityRequired && noi && metrics.annualDebtService) {
      const cashFlow = noi - metrics.annualDebtService;
      metrics.cashOnCash = cashFlow / metrics.equityRequired;
      metrics.yearOneCashFlow = cashFlow;
    }

    // Price per unit/SF (totalUnits and grossSF added to schema)
    if (purchasePrice) {
      if (model.totalUnits) {
        metrics.pricePerUnit = purchasePrice / model.totalUnits;
      }
      if (model.grossSF) {
        metrics.pricePerSF = purchasePrice / model.grossSF;
      }
    }

    // Debt Yield
    if (noi && model.loanAmount) {
      metrics.debtYield = noi / model.loanAmount;
    }

    return metrics;
  }

  /**
   * Calculate annual debt service
   */
  calculateDebtService(loanAmount, interestRate, amortYears) {
    const monthlyRate = interestRate / 12;
    const numPayments = amortYears * 12;
    const monthlyPayment = loanAmount *
      (monthlyRate * Math.pow(1 + monthlyRate, numPayments)) /
      (Math.pow(1 + monthlyRate, numPayments) - 1);
    return monthlyPayment * 12;
  }

  /**
   * Generate a document
   */
  async generateDocument(dealId, documentType, options = {}) {
    const { actor, watermark, status = 'DRAFT' } = options;

    const docConfig = DOCUMENT_TYPES[documentType];
    if (!docConfig) {
      throw new Error(`Unknown document type: ${documentType}`);
    }

    // Register partials
    await this.registerPartials();

    // Load template
    const template = await this.loadTemplate(docConfig.template);

    // Build context
    const context = await this.buildDealContext(dealId);

    // Add watermark
    context.watermark = watermark !== undefined ? watermark :
      (status === 'DRAFT' ? docConfig.defaultWatermark : null);
    context.documentStatus = status;
    context.documentType = documentType;
    context.documentTitle = docConfig.name;

    // Render HTML
    const html = template(context);

    // Calculate content hash
    const contentHash = crypto.createHash('sha256').update(html).digest('hex');

    // Get next version number
    const lastVersion = await prisma.documentVersion.findFirst({
      where: { dealId, documentType },
      orderBy: { version: 'desc' }
    });
    const version = (lastVersion?.version || 0) + 1;

    // Build provenance map for the document
    const provenanceMap = {};
    for (const [fieldPath, prov] of Object.entries(context._provenance || {})) {
      provenanceMap[fieldPath] = prov.claimId || null;
    }

    // For now, store HTML. In practice, this would go to S3/R2
    const storageKey = `documents/${dealId}/${documentType}_v${version}_${Date.now()}.html`;

    // Create document version record
    const docVersion = await prisma.documentVersion.create({
      data: {
        dealId,
        documentType,
        version,
        status,
        contentHash,
        storageKey,
        format: 'HTML',
        provenanceMap: JSON.stringify(provenanceMap),
        watermarkText: context.watermark,
        createdBy: actor?.id || 'system',
        createdByName: actor?.name || 'System'
      }
    });

    // Create generated document record
    const generatedDoc = await prisma.generatedDocument.create({
      data: {
        dealId,
        documentType,
        title: `${docConfig.name} v${version}`,
        versionId: docVersion.id,
        templateId: docConfig.template,
        templateName: docConfig.name,
        generatedBy: actor?.id || 'system',
        generatedByName: actor?.name || 'System',
        storageKey,
        contentHash,
        format: 'HTML',
        sizeBytes: Buffer.byteLength(html, 'utf-8'),
        fieldProvenance: JSON.stringify(
          Object.entries(provenanceMap).map(([field, claimId]) => ({
            fieldPath: field,
            claimId,
            source: context._provenance?.[field]?.documentName
          }))
        ),
        status: 'GENERATED'
      }
    });

    // Record event
    await dealStateMachine.recordEvent(
      dealId,
      'DocumentGenerated',
      {
        documentType,
        version,
        status,
        contentHash: contentHash.substring(0, 12),
        generatedDocId: generatedDoc.id
      },
      actor || { id: 'system', name: 'System', role: 'SYSTEM' }
    );

    return {
      documentVersion: docVersion,
      generatedDocument: generatedDoc,
      html,
      contentHash,
      provenanceMap
    };
  }

  /**
   * Generate a document with a pre-built context (for LP financial documents)
   * @param {string} documentType - Document type key
   * @param {Object} context - Pre-built template context
   * @param {Object} options - Generation options (actor, watermark, status)
   */
  async generateDocumentWithContext(documentType, context, options = {}) {
    const { actor, watermark, status = 'GENERATED' } = options;

    const docConfig = DOCUMENT_TYPES[documentType];
    if (!docConfig) {
      throw new Error(`Unknown document type: ${documentType}`);
    }

    // Register partials
    await this.registerPartials();

    // Load template
    const template = await this.loadTemplate(docConfig.template);

    // Add document metadata to context
    context.watermark = watermark !== undefined ? watermark : docConfig.defaultWatermark;
    context.documentStatus = status;
    context.documentType = documentType;
    context.documentTitle = docConfig.name;

    // Render HTML
    const html = template(context);

    // Calculate content hash
    const contentHash = crypto.createHash('sha256').update(html).digest('hex');

    // For LP documents, we may not have a dealId from context
    const dealId = context.deal?.id || context.capitalCall?.dealId || context.distribution?.dealId || 'unknown';

    // Get next version number
    const lastVersion = await prisma.documentVersion.findFirst({
      where: { dealId, documentType },
      orderBy: { version: 'desc' }
    });
    const version = (lastVersion?.version || 0) + 1;

    // For now, store HTML. In practice, this would go to S3/R2
    const storageKey = `documents/${dealId}/${documentType}_v${version}_${Date.now()}.html`;

    // Create document version record
    const docVersion = await prisma.documentVersion.create({
      data: {
        dealId,
        documentType,
        version,
        status,
        contentHash,
        storageKey,
        format: 'HTML',
        provenanceMap: '{}',
        watermarkText: context.watermark,
        createdBy: actor?.id || 'system',
        createdByName: actor?.name || 'System'
      }
    });

    // Create generated document record
    const generatedDoc = await prisma.generatedDocument.create({
      data: {
        dealId,
        documentType,
        title: `${docConfig.name} v${version}`,
        versionId: docVersion.id,
        templateId: docConfig.template,
        templateName: docConfig.name,
        generatedBy: actor?.id || 'system',
        generatedByName: actor?.name || 'System',
        storageKey,
        contentHash,
        format: 'HTML',
        sizeBytes: Buffer.byteLength(html, 'utf-8'),
        fieldProvenance: '[]',
        status: 'GENERATED'
      }
    });

    return {
      documentVersion: docVersion,
      generatedDocument: generatedDoc,
      html,
      contentHash
    };
  }

  /**
   * Promote document status (DRAFT → BINDING → EXECUTED)
   */
  async promoteDocument(versionId, toStatus, actor) {
    const docVersion = await prisma.documentVersion.findUnique({
      where: { id: versionId }
    });

    if (!docVersion) {
      throw new Error('Document version not found');
    }

    const validTransitions = {
      DRAFT: ['BINDING'],
      BINDING: ['EXECUTED'],
      EXECUTED: ['EFFECTIVE']
    };

    if (!validTransitions[docVersion.status]?.includes(toStatus)) {
      throw new Error(`Cannot promote from ${docVersion.status} to ${toStatus}`);
    }

    const updateData = {
      status: toStatus,
      promotedAt: new Date(),
      promotedBy: actor.id
    };

    if (toStatus === 'EXECUTED') {
      updateData.executedAt = new Date();
      updateData.executedBy = actor.id;
    }

    const updated = await prisma.documentVersion.update({
      where: { id: versionId },
      data: updateData
    });

    // Record event
    await dealStateMachine.recordEvent(
      docVersion.dealId,
      'DocumentPromoted',
      {
        documentType: docVersion.documentType,
        version: docVersion.version,
        fromStatus: docVersion.status,
        toStatus
      },
      actor
    );

    return updated;
  }

  /**
   * Get document versions for a deal
   */
  async getDocumentVersions(dealId, documentType) {
    const where = { dealId };
    if (documentType) {
      where.documentType = documentType;
    }

    return prisma.documentVersion.findMany({
      where,
      orderBy: [
        { documentType: 'asc' },
        { version: 'desc' }
      ]
    });
  }

  /**
   * Get latest version of each document type
   */
  async getLatestDocuments(dealId) {
    const allVersions = await prisma.documentVersion.findMany({
      where: { dealId },
      orderBy: { version: 'desc' }
    });

    // Group by document type and get latest
    const latest = {};
    for (const version of allVersions) {
      if (!latest[version.documentType]) {
        latest[version.documentType] = version;
      }
    }

    return Object.values(latest);
  }

  /**
   * Get document provenance (field-level source tracking)
   */
  async getDocumentProvenance(versionId) {
    const docVersion = await prisma.documentVersion.findUnique({
      where: { id: versionId }
    });

    if (!docVersion) {
      throw new Error('Document version not found');
    }

    const provenanceMap = JSON.parse(docVersion.provenanceMap || '{}');

    // Fetch claim details for each field
    const claimIds = Object.values(provenanceMap).filter(Boolean);
    const claims = await prisma.extractionClaim.findMany({
      where: { id: { in: claimIds } }
    });

    const claimMap = new Map(claims.map(c => [c.id, c]));

    const provenance = [];
    for (const [fieldPath, claimId] of Object.entries(provenanceMap)) {
      const claim = claimId ? claimMap.get(claimId) : null;

      provenance.push({
        fieldPath,
        claimId,
        source: claim ? {
          documentName: claim.documentName,
          documentType: claim.documentType,
          pageNumber: claim.pageNumber,
          cellReference: claim.cellReference,
          textSnippet: claim.textSnippet,
          confidence: claim.aiConfidence,
          verifiedBy: claim.verifiedByName,
          verifiedAt: claim.verifiedAt
        } : null
      });
    }

    return provenance;
  }
}

// Export singleton instance
const documentGenerator = new DocumentGenerator();

// =============================================================================
// LP FINANCIAL DOCUMENT CONTEXT BUILDERS
// =============================================================================

const LOG_PREFIX_LP = "[DocGen:LP]";

function logLP(message, data = {}) {
  console.log(`${new Date().toISOString()} ${LOG_PREFIX_LP} ${message}`, JSON.stringify(data));
}

/**
 * Build context for capital call notice
 * @param {string} dealId - Deal ID
 * @param {string} capitalCallId - Capital Call ID
 * @param {string} lpActorId - LP Actor ID
 * @returns {Promise<Object>} Template context
 */
async function buildCapitalCallContext(dealId, capitalCallId, lpActorId) {
  logLP(`Building capital call context`, { dealId, capitalCallId, lpActorId });

  const capitalCall = await prisma.capitalCall.findUnique({
    where: { id: capitalCallId },
    include: {
      allocations: {
        where: { lpActorId }
      }
    }
  });

  if (!capitalCall) {
    throw new Error(`Capital call not found: ${capitalCallId}`);
  }

  const allocation = capitalCall.allocations[0];
  if (!allocation) {
    throw new Error(`No allocation found for LP ${lpActorId} in capital call ${capitalCallId}`);
  }

  const lpActor = await prisma.lPActor.findUnique({
    where: { id: lpActorId },
    include: {
      shareClass: {
        select: {
          id: true,
          code: true,
          name: true,
          preferredReturn: true
        }
      }
    }
  });

  if (!lpActor) {
    throw new Error(`LP Actor not found: ${lpActorId}`);
  }

  // Get deal info from kernel or local (simplified for now)
  const deal = { id: dealId, name: lpActor.entityName }; // Placeholder - would fetch from kernel

  logLP(`Context built`, {
    capitalCallId,
    lpActorId,
    allocationAmount: allocation.amount
  });

  return {
    deal,
    capitalCall,
    lpActor,
    allocation,
    callDate: capitalCall.createdAt,
    dueDate: capitalCall.dueDate,
    purpose: capitalCall.purpose || 'Investment Funding',
    wireInstructions: capitalCall.wireInstructions || null,
    generatedAt: new Date().toISOString(),
    generatedBy: 'Deal Doc Factory'
  };
}

/**
 * Build context for distribution statement
 * @param {string} dealId - Deal ID
 * @param {string} distributionId - Distribution ID
 * @param {string} lpActorId - LP Actor ID
 * @returns {Promise<Object>} Template context
 */
async function buildDistributionContext(dealId, distributionId, lpActorId) {
  logLP(`Building distribution context`, { dealId, distributionId, lpActorId });

  const distribution = await prisma.distribution.findUnique({
    where: { id: distributionId },
    include: {
      allocations: {
        where: { lpActorId }
      }
    }
  });

  if (!distribution) {
    throw new Error(`Distribution not found: ${distributionId}`);
  }

  const allocation = distribution.allocations[0];
  if (!allocation) {
    throw new Error(`No allocation found for LP ${lpActorId} in distribution ${distributionId}`);
  }

  const lpActor = await prisma.lPActor.findUnique({
    where: { id: lpActorId },
    include: {
      shareClass: {
        select: {
          id: true,
          code: true,
          name: true,
          preferredReturn: true,
          managementFee: true,
          carryPercent: true
        }
      }
    }
  });

  if (!lpActor) {
    throw new Error(`LP Actor not found: ${lpActorId}`);
  }

  // Get deal info (simplified)
  const deal = { id: dealId, name: lpActor.entityName };

  // Build waterfall breakdown if available
  let waterfallBreakdown = null;
  if (distribution.byClass) {
    try {
      const byClassData = typeof distribution.byClass === 'string'
        ? JSON.parse(distribution.byClass)
        : distribution.byClass;
      const classCode = lpActor.shareClass?.code || 'A';
      if (byClassData[classCode]) {
        waterfallBreakdown = {
          returnOfCapital: byClassData[classCode].capitalReturned || 0,
          preferredReturn: byClassData[classCode].prefPaid || 0,
          profitShare: byClassData[classCode].promotePaid || 0
        };
      }
    } catch (e) {
      // Ignore parsing errors
    }
  }

  logLP(`Context built`, {
    distributionId,
    lpActorId,
    grossAmount: allocation.grossAmount,
    netAmount: allocation.netAmount
  });

  return {
    deal,
    distribution,
    lpActor,
    allocation,
    distributionDate: distribution.distributionDate,
    type: distribution.type || 'Cash Distribution',
    period: distribution.period || null,
    waterfallBreakdown,
    generatedAt: new Date().toISOString(),
    generatedBy: 'Deal Doc Factory'
  };
}

/**
 * Generate capital call notices for all LPs in a capital call
 * @param {string} dealId - Deal ID
 * @param {string} capitalCallId - Capital Call ID
 * @param {Object} actor - Actor performing generation
 * @returns {Promise<Array>} Generated documents
 */
async function generateCapitalCallNotices(dealId, capitalCallId, actor) {
  logLP(`Generating capital call notices`, { dealId, capitalCallId });

  const allocations = await prisma.capitalCallAllocation.findMany({
    where: { capitalCallId }
  });

  // Get LP actors for allocations
  const lpActorIds = allocations.map(a => a.lpActorId);
  const lpActors = await prisma.lPActor.findMany({
    where: { id: { in: lpActorIds } }
  });
  const lpActorMap = new Map(lpActors.map(lp => [lp.id, lp]));

  const generatedDocs = [];

  for (const alloc of allocations) {
    const lpActor = lpActorMap.get(alloc.lpActorId);
    logLP(`Generating notice for LP`, { lpActorId: alloc.lpActorId, entityName: lpActor?.entityName });

    try {
      const context = await buildCapitalCallContext(dealId, capitalCallId, alloc.lpActorId);
      const result = await documentGenerator.generateDocumentWithContext(
        'CAPITAL_CALL_NOTICE',
        context,
        { actor, status: 'GENERATED' }
      );
      generatedDocs.push({
        lpActorId: alloc.lpActorId,
        entityName: lpActor?.entityName,
        document: result
      });
    } catch (error) {
      logLP(`Failed to generate notice for LP`, { lpActorId: alloc.lpActorId, error: error.message });
      generatedDocs.push({
        lpActorId: alloc.lpActorId,
        entityName: lpActor?.entityName,
        error: error.message
      });
    }
  }

  logLP(`Generated ${generatedDocs.filter(d => !d.error).length} notices`, { dealId, capitalCallId });
  return generatedDocs;
}

/**
 * Generate distribution statements for all LPs in a distribution
 * @param {string} dealId - Deal ID
 * @param {string} distributionId - Distribution ID
 * @param {Object} actor - Actor performing generation
 * @returns {Promise<Array>} Generated documents
 */
async function generateDistributionStatements(dealId, distributionId, actor) {
  logLP(`Generating distribution statements`, { dealId, distributionId });

  const allocations = await prisma.distributionAllocation.findMany({
    where: { distributionId }
  });

  // Get LP actors for allocations
  const lpActorIds = allocations.map(a => a.lpActorId);
  const lpActors = await prisma.lPActor.findMany({
    where: { id: { in: lpActorIds } }
  });
  const lpActorMap = new Map(lpActors.map(lp => [lp.id, lp]));

  const generatedDocs = [];

  for (const alloc of allocations) {
    const lpActor = lpActorMap.get(alloc.lpActorId);
    logLP(`Generating statement for LP`, { lpActorId: alloc.lpActorId, entityName: lpActor?.entityName });

    try {
      const context = await buildDistributionContext(dealId, distributionId, alloc.lpActorId);
      const result = await documentGenerator.generateDocumentWithContext(
        'DISTRIBUTION_STATEMENT',
        context,
        { actor, status: 'GENERATED' }
      );
      generatedDocs.push({
        lpActorId: alloc.lpActorId,
        entityName: lpActor?.entityName,
        document: result
      });
    } catch (error) {
      logLP(`Failed to generate statement for LP`, { lpActorId: alloc.lpActorId, error: error.message });
      generatedDocs.push({
        lpActorId: alloc.lpActorId,
        entityName: lpActor?.entityName,
        error: error.message
      });
    }
  }

  logLP(`Generated ${generatedDocs.filter(d => !d.error).length} statements`, { dealId, distributionId });
  return generatedDocs;
}

export {
  documentGenerator,
  DocumentGenerator,
  DOCUMENT_TYPES,
  buildCapitalCallContext,
  buildDistributionContext,
  generateCapitalCallNotices,
  generateDistributionStatements
};
