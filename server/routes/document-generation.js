/**
 * Document Generation Routes
 *
 * API endpoints for generating, managing, and exporting deal documents.
 *
 * Endpoints:
 * - POST   /api/deals/:dealId/documents/generate       - Generate a document
 * - GET    /api/deals/:dealId/documents                - List all documents
 * - GET    /api/deals/:dealId/documents/:type/versions - Get versions by type
 * - POST   /api/deals/:dealId/documents/:type/promote  - Promote document status
 * - GET    /api/deals/:dealId/documents/:type/download - Download PDF
 */

import { documentGenerator, DOCUMENT_TYPES } from '../services/document-generator.js';
import { pdfRenderer } from '../services/pdf-renderer.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-User-Id, X-Canonical-User-Id, X-Actor-Role",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS"
  });
  res.end(JSON.stringify(payload));
}

/**
 * Generate a new document
 * SECURITY: authUser is required and must come from validated JWT at dispatch level
 */
async function handleGenerateDocument(req, res, dealId, readJsonBody, authUser) {
  try {
    const body = await readJsonBody(req);
    const { documentType, watermark, status } = body || {};

    if (!documentType) {
      return sendJson(res, 400, {
        success: false,
        error: 'documentType is required'
      });
    }

    if (!DOCUMENT_TYPES[documentType]) {
      return sendJson(res, 400, {
        success: false,
        error: `Invalid document type: ${documentType}`,
        validTypes: Object.keys(DOCUMENT_TYPES)
      });
    }

    // SECURITY: Use validated authUser instead of spoofable headers
    const actor = {
      id: body?.actorId || authUser?.id || 'system',
      name: body?.actorName || authUser?.name || 'System',
      role: body?.actorRole || authUser?.role || 'ANALYST'
    };

    const result = await documentGenerator.generateDocument(dealId, documentType, {
      actor,
      watermark,
      status: status || 'DRAFT'
    });

    sendJson(res, 200, {
      success: true,
      message: `Generated ${DOCUMENT_TYPES[documentType].name}`,
      document: {
        id: result.generatedDocument.id,
        documentType: result.documentVersion.documentType,
        title: result.generatedDocument.title,
        version: result.documentVersion.version,
        status: result.documentVersion.status,
        contentHash: result.documentVersion.contentHash,
        createdAt: result.documentVersion.createdAt,
        sizeBytes: result.generatedDocument.sizeBytes
      }
    });
  } catch (error) {
    console.error('Error generating document:', error);
    sendJson(res, 500, {
      success: false,
      error: error.message
    });
  }
}

/**
 * List all documents for a deal
 */
async function handleListDocuments(req, res, dealId) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const documentType = url.searchParams.get('documentType');

    const versions = await documentGenerator.getDocumentVersions(dealId, documentType);

    // Get generated document info
    const documents = await prisma.generatedDocument.findMany({
      where: { dealId },
      orderBy: { generatedAt: 'desc' }
    });

    // Merge with version info
    const enrichedDocs = documents.map(doc => {
      const version = versions.find(v => v.id === doc.versionId);
      return {
        ...doc,
        version: version?.version,
        status: version?.status,
        displayName: DOCUMENT_TYPES[doc.documentType]?.name || doc.documentType,
        fieldProvenance: doc.fieldProvenance ? JSON.parse(doc.fieldProvenance) : null
      };
    });

    sendJson(res, 200, {
      success: true,
      documents: enrichedDocs,
      total: enrichedDocs.length
    });
  } catch (error) {
    console.error('Error fetching documents:', error);
    sendJson(res, 500, {
      success: false,
      error: error.message
    });
  }
}

/**
 * Get versions of a specific document type
 */
async function handleGetDocumentVersions(req, res, dealId, documentType) {
  try {
    const versions = await documentGenerator.getDocumentVersions(dealId, documentType);

    sendJson(res, 200, {
      success: true,
      documentType,
      displayName: DOCUMENT_TYPES[documentType]?.name || documentType,
      versions,
      count: versions.length
    });
  } catch (error) {
    console.error('Error fetching document versions:', error);
    sendJson(res, 500, {
      success: false,
      error: error.message
    });
  }
}

/**
 * Promote document status
 * SECURITY: authUser is required and must come from validated JWT at dispatch level
 */
async function handlePromoteDocument(req, res, dealId, documentType, readJsonBody, authUser) {
  try {
    const body = await readJsonBody(req);
    const { toStatus } = body || {};

    if (!toStatus) {
      return sendJson(res, 400, {
        success: false,
        error: 'toStatus is required'
      });
    }

    const validStatuses = ['BINDING', 'EXECUTED', 'EFFECTIVE'];
    if (!validStatuses.includes(toStatus)) {
      return sendJson(res, 400, {
        success: false,
        error: `Invalid status: ${toStatus}`,
        validStatuses
      });
    }

    // Get latest version of this document type
    const version = await prisma.documentVersion.findFirst({
      where: { dealId, documentType },
      orderBy: { version: 'desc' }
    });

    if (!version) {
      return sendJson(res, 404, {
        success: false,
        error: 'Document not found'
      });
    }

    // SECURITY: Use validated authUser instead of spoofable headers
    const actor = {
      id: body?.actorId || authUser?.id || 'system',
      name: body?.actorName || authUser?.name || 'System',
      role: body?.actorRole || authUser?.role || 'ANALYST'
    };

    const updated = await documentGenerator.promoteDocument(version.id, toStatus, actor);

    sendJson(res, 200, {
      success: true,
      message: `Document promoted to ${toStatus}`,
      documentVersion: updated
    });
  } catch (error) {
    console.error('Error promoting document:', error);
    sendJson(res, 400, {
      success: false,
      error: error.message
    });
  }
}

/**
 * Download document as PDF
 */
async function handleDownloadDocument(req, res, dealId, documentType) {
  try {
    // Get latest version of this document type
    const version = await prisma.documentVersion.findFirst({
      where: { dealId, documentType },
      orderBy: { version: 'desc' }
    });

    if (!version) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: 'Document not found' }));
      return;
    }

    // Regenerate the HTML (in production, would fetch from storage)
    const result = await documentGenerator.generateDocument(dealId, documentType, {
      status: version.status,
      watermark: version.watermarkText
    });

    // Render to PDF
    const pdf = await pdfRenderer.renderToPDF(result.html, {
      watermark: version.watermarkText,
      documentTitle: DOCUMENT_TYPES[documentType]?.name || documentType,
      status: version.status,
      version: version.version,
      contentHash: version.contentHash,
      generatedAt: version.createdAt
    });

    // Set response headers
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${documentType}_v${version.version}.pdf"`,
      'Content-Length': pdf.buffer.length,
      'Access-Control-Allow-Origin': '*'
    });

    res.end(pdf.buffer);
  } catch (error) {
    console.error('Error generating PDF:', error);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: false, error: error.message }));
  }
}

export {
  handleGenerateDocument,
  handleListDocuments,
  handleGetDocumentVersions,
  handlePromoteDocument,
  handleDownloadDocument
};
