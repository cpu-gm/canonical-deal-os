/**
 * LP Document Management Routes
 *
 * Provides document upload, download, and permission management for the LP Portal.
 * Supports per-LP document visibility for sensitive documents like side letters.
 */

import { getPrisma } from "../db.js";
import { deleteCache, deleteCacheByPrefix } from "../runtime.js";
import crypto from "node:crypto";

// Document categories
export const LP_DOCUMENT_CATEGORIES = {
  TAX: { label: 'Tax & K-1', types: ['K1', 'TAX_ELECTION', 'PARTNERSHIP_ALLOCATION', 'WITHHOLDING_CERT'] },
  LEGAL: { label: 'Legal', types: ['OPERATING_AGREEMENT', 'SIDE_LETTER', 'PSA', 'LOI', 'AMENDMENT'] },
  FINANCIAL: { label: 'Financial Reports', types: ['QUARTERLY_REPORT', 'ANNUAL_REPORT', 'NAV_STATEMENT', 'AUDIT_REPORT'] },
  PRESENTATION: { label: 'Presentations', types: ['INVESTOR_UPDATE', 'IC_MEMO', 'DEAL_TEASER', 'WEBINAR'] },
  CLOSING: { label: 'Closing', types: ['TITLE_POLICY', 'LOAN_DOCS', 'CLOSING_STATEMENT', 'INSURANCE'] }
};

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(JSON.stringify(payload));
}

function sendError(res, status, message, details) {
  sendJson(res, status, { message, details: details ?? null });
}

/**
 * Upload LP document
 * POST /api/lp/documents
 * Body: { dealId, filename, documentType, category, year?, quarter?, visibility, storageKey, mimeType, sizeBytes, lpActorIds? }
 */
export async function handleUploadDocument(req, res, readJsonBody, resolveUserId, resolveUserName) {
  const body = await readJsonBody(req);

  if (!body?.dealId || !body?.filename || !body?.documentType || !body?.category) {
    return sendError(res, 400, "Missing required fields: dealId, filename, documentType, category");
  }

  // Validate category
  if (!LP_DOCUMENT_CATEGORIES[body.category]) {
    return sendError(res, 400, "Invalid category", {
      validCategories: Object.keys(LP_DOCUMENT_CATEGORIES)
    });
  }

  const prisma = getPrisma();
  const userId = resolveUserId(req);
  const userName = resolveUserName(req);

  const docId = crypto.randomUUID();
  const visibility = body.visibility || "ALL_LPS";

  // Create document record
  const document = await prisma.lPDocument.create({
    data: {
      id: docId,
      dealId: body.dealId,
      filename: body.filename,
      documentType: body.documentType,
      category: body.category,
      year: body.year ?? null,
      quarter: body.quarter ?? null,
      storageKey: body.storageKey || `lp-docs/${body.dealId}/${docId}`,
      mimeType: body.mimeType || "application/pdf",
      sizeBytes: body.sizeBytes || 0,
      visibility,
      status: "PUBLISHED",
      uploadedBy: userId,
      uploadedByName: userName || "Unknown"
    }
  });

  // If SPECIFIC_LPS visibility, create permission records
  if (visibility === "SPECIFIC_LPS" && Array.isArray(body.lpActorIds)) {
    await prisma.lPDocumentPermission.createMany({
      data: body.lpActorIds.map((lpActorId) => ({
        id: crypto.randomUUID(),
        documentId: docId,
        lpActorId,
        canView: true,
        canDownload: true,
        grantedBy: userId
      }))
    });
  }

  // Invalidate caches
  deleteCacheByPrefix(`lp-portal:`);
  deleteCache(`lp-docs:${body.dealId}`);

  console.log(`[LP Documents] Uploaded ${body.filename} for deal ${body.dealId} (visibility: ${visibility})`);

  sendJson(res, 201, {
    id: document.id,
    dealId: document.dealId,
    filename: document.filename,
    documentType: document.documentType,
    category: document.category,
    year: document.year,
    quarter: document.quarter,
    visibility: document.visibility,
    status: document.status,
    createdAt: document.createdAt.toISOString()
  });
}

/**
 * List documents for a deal
 * GET /api/lp/documents/:dealId
 * Query: ?lpActorId= (optional, for LP access filtering)
 */
export async function handleListDocuments(req, res, dealId, lpActorId) {
  const prisma = getPrisma();

  // Get all documents for the deal
  const documents = await prisma.lPDocument.findMany({
    where: {
      dealId,
      status: "PUBLISHED"
    },
    include: {
      permissions: lpActorId ? {
        where: { lpActorId, revokedAt: null }
      } : false
    },
    orderBy: [
      { category: 'asc' },
      { year: 'desc' },
      { quarter: 'desc' },
      { createdAt: 'desc' }
    ]
  });

  // Filter documents based on LP visibility
  const filteredDocs = documents.filter((doc) => {
    if (doc.visibility === "ALL_LPS") return true;
    if (!lpActorId) return true; // GP can see all
    // SPECIFIC_LPS: only if LP has permission
    return doc.permissions && doc.permissions.length > 0 && doc.permissions.some(p => p.canView);
  });

  // Group by category
  const grouped = {};
  for (const cat of Object.keys(LP_DOCUMENT_CATEGORIES)) {
    grouped[cat] = {
      label: LP_DOCUMENT_CATEGORIES[cat].label,
      documents: []
    };
  }

  for (const doc of filteredDocs) {
    const category = doc.category || 'LEGAL';
    if (!grouped[category]) {
      grouped[category] = { label: category, documents: [] };
    }

    grouped[category].documents.push({
      id: doc.id,
      filename: doc.filename,
      documentType: doc.documentType,
      year: doc.year,
      quarter: doc.quarter,
      mimeType: doc.mimeType,
      sizeBytes: doc.sizeBytes,
      visibility: doc.visibility,
      uploadedBy: doc.uploadedByName,
      createdAt: doc.createdAt.toISOString(),
      canDownload: doc.visibility === "ALL_LPS" ||
        (doc.permissions?.some(p => p.canDownload) ?? !lpActorId)
    });
  }

  sendJson(res, 200, {
    dealId,
    categories: LP_DOCUMENT_CATEGORIES,
    documents: grouped,
    totalCount: filteredDocs.length
  });
}

/**
 * Get document for download
 * GET /api/lp/documents/:dealId/:docId
 */
export async function handleDownloadDocument(req, res, dealId, docId, lpActorId) {
  const prisma = getPrisma();

  const document = await prisma.lPDocument.findFirst({
    where: {
      id: docId,
      dealId,
      status: "PUBLISHED"
    },
    include: {
      permissions: lpActorId ? {
        where: { lpActorId, revokedAt: null }
      } : false
    }
  });

  if (!document) {
    return sendError(res, 404, "Document not found");
  }

  // Check access
  if (document.visibility === "SPECIFIC_LPS" && lpActorId) {
    const hasAccess = document.permissions?.some(p => p.canDownload);
    if (!hasAccess) {
      return sendError(res, 403, "You do not have access to this document");
    }
  }

  // Log download for audit
  console.log(`[LP Documents] Download: ${document.filename} by ${lpActorId || 'GP'}`);

  // Return document info (actual file serving handled by storage layer)
  sendJson(res, 200, {
    id: document.id,
    filename: document.filename,
    storageKey: document.storageKey,
    mimeType: document.mimeType,
    sizeBytes: document.sizeBytes
  });
}

/**
 * Delete document
 * DELETE /api/lp/documents/:docId
 * SECURITY: V3 fix - authUser passed from dispatch for org isolation check
 */
export async function handleDeleteDocument(req, res, docId, authUser) {
  const prisma = getPrisma();
  const userId = authUser.id;

  // SECURITY: Include deal to verify org isolation
  const document = await prisma.lPDocument.findUnique({
    where: { id: docId },
    include: { deal: true }
  });

  if (!document) {
    return sendError(res, 404, "Document not found");
  }

  // SECURITY: Enforce organization isolation
  if (document.deal?.organizationId && document.deal.organizationId !== authUser.organizationId) {
    return sendError(res, 403, "Access denied - document belongs to different organization");
  }

  // Mark as superseded instead of hard delete
  await prisma.lPDocument.update({
    where: { id: docId },
    data: { status: "SUPERSEDED" }
  });

  // Invalidate caches
  deleteCacheByPrefix(`lp-portal:`);
  deleteCache(`lp-docs:${document.dealId}`);

  console.log(`[LP Documents] Deleted ${document.filename} by ${userId}`);

  sendJson(res, 200, { message: "Document deleted", id: docId });
}

/**
 * Update document permissions
 * PUT /api/lp/documents/:docId/permissions
 * Body: { lpActorIds: [{ id, canView, canDownload }] }
 * SECURITY: V3 fix - authUser passed from dispatch for org isolation check
 */
export async function handleUpdatePermissions(req, res, docId, readJsonBody, authUser) {
  const body = await readJsonBody(req);

  if (!Array.isArray(body?.lpActorIds)) {
    return sendError(res, 400, "lpActorIds array is required");
  }

  const prisma = getPrisma();
  const userId = authUser.id;

  // SECURITY: Include deal to verify org isolation
  const document = await prisma.lPDocument.findUnique({
    where: { id: docId },
    include: { deal: true }
  });

  if (!document) {
    return sendError(res, 404, "Document not found");
  }

  // SECURITY: Enforce organization isolation
  if (document.deal?.organizationId && document.deal.organizationId !== authUser.organizationId) {
    return sendError(res, 403, "Access denied - document belongs to different organization");
  }

  // Update visibility if needed
  if (body.lpActorIds.length > 0 && document.visibility !== "SPECIFIC_LPS") {
    await prisma.lPDocument.update({
      where: { id: docId },
      data: { visibility: "SPECIFIC_LPS" }
    });
  }

  // Revoke existing permissions
  await prisma.lPDocumentPermission.updateMany({
    where: { documentId: docId, revokedAt: null },
    data: { revokedAt: new Date() }
  });

  // Create new permissions
  if (body.lpActorIds.length > 0) {
    await prisma.lPDocumentPermission.createMany({
      data: body.lpActorIds.map((lp) => ({
        id: crypto.randomUUID(),
        documentId: docId,
        lpActorId: lp.id,
        canView: lp.canView ?? true,
        canDownload: lp.canDownload ?? true,
        grantedBy: userId
      }))
    });
  }

  // If no specific LPs, revert to ALL_LPS visibility
  if (body.lpActorIds.length === 0) {
    await prisma.lPDocument.update({
      where: { id: docId },
      data: { visibility: "ALL_LPS" }
    });
  }

  // Invalidate caches
  deleteCacheByPrefix(`lp-portal:`);
  deleteCache(`lp-docs:${document.dealId}`);

  console.log(`[LP Documents] Updated permissions for ${document.filename}`);

  sendJson(res, 200, {
    message: "Permissions updated",
    documentId: docId,
    visibility: body.lpActorIds.length > 0 ? "SPECIFIC_LPS" : "ALL_LPS",
    permissionCount: body.lpActorIds.length
  });
}

/**
 * Get LPs for a deal (for permission UI)
 * GET /api/lp/documents/:dealId/lps
 */
export async function handleListLPsForDeal(req, res, dealId) {
  const prisma = getPrisma();

  const lpActors = await prisma.lPActor.findMany({
    where: {
      dealId,
      status: "ACTIVE"
    },
    orderBy: { entityName: 'asc' }
  });

  sendJson(res, 200, {
    dealId,
    lps: lpActors.map((lp) => ({
      id: lp.id,
      entityName: lp.entityName,
      email: lp.email,
      commitment: lp.commitment,
      ownershipPct: lp.ownershipPct
    }))
  });
}
