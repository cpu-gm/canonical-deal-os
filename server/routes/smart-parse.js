import { getPrisma } from "../db.js";
import { kernelFetchJson, kernelRequest, createOrUpdateMaterial } from "../kernel.js";
import { deleteCacheByPrefix } from "../runtime.js";
import { invalidateDealCaches } from "./deals.js";
import { requestSmartDocParse } from "../llm.js";

const KERNEL_BASE_URL = process.env.KERNEL_API_URL ?? "http://localhost:3001";

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
 * Smart Parse Handler
 *
 * Takes an uploaded artifact and uses LLM to extract field values
 * that match the target fields the deal needs.
 */
export async function handleSmartParse(req, res, dealId, readJsonBody) {
  const body = await readJsonBody(req);

  if (!body) {
    return sendError(res, 400, "Request body required");
  }

  const { artifactId, filename, targetFields = [] } = body;

  if (!artifactId) {
    return sendError(res, 400, "artifactId is required");
  }

  try {
    // Step 1: Get the artifact content from kernel
    let artifactContent = null;
    let artifactMeta = null;

    try {
      // First get artifact metadata
      const artifactsRes = await kernelFetchJson(`${KERNEL_BASE_URL}/deals/${dealId}/artifacts`);
      artifactMeta = artifactsRes?.find(a => a.id === artifactId);

      if (!artifactMeta) {
        return sendError(res, 404, "Artifact not found");
      }

      // For now, we'll work with the filename and ask LLM to extract based on document type
      // In a production system, you'd read the actual file content here
      // using a document extraction service (e.g., Apache Tika, AWS Textract, etc.)

      // Simulate getting document content description based on filename
      artifactContent = `Document: ${artifactMeta.filename || filename}`;

    } catch (error) {
      console.error("[SmartParse] Failed to get artifact:", error);
      return sendError(res, 502, "Failed to retrieve artifact");
    }

    // Step 2: Get current deal profile to understand what's missing
    const prisma = getPrisma();
    const dealProfile = await prisma.dealProfile.findUnique({
      where: { dealId }
    });

    const currentProfile = dealProfile?.profile || {};

    // Build a description of what we're looking for
    const fieldsDescription = targetFields.length > 0
      ? targetFields.map(f => {
          const fieldName = typeof f === 'string' ? f : f.fieldPath;
          return fieldName.replace('profile.', '');
        })
      : [
          'purchase_price', 'noi', 'cap_rate', 'ltv', 'dscr',
          'asset_address', 'asset_city', 'asset_state',
          'square_footage', 'unit_count', 'year_built',
          'senior_debt', 'mezzanine_debt', 'preferred_equity', 'common_equity',
          'gp_name', 'lender_name', 'occupancy'
        ];

    // Step 3: Call LLM to extract values
    let extractedValues = {};

    try {
      const llmResult = await requestSmartDocParse(
        artifactContent,
        artifactMeta.filename || filename,
        fieldsDescription,
        currentProfile
      );

      extractedValues = llmResult.extracted || {};

    } catch (llmError) {
      console.error("[SmartParse] LLM extraction failed:", llmError);

      // Return partial success with empty extractions
      return sendJson(res, 200, {
        artifactId,
        filename: artifactMeta?.filename || filename,
        extracted: {},
        message: "Document uploaded but extraction failed. You can manually enter values.",
        error: llmError.message
      });
    }

    // Step 4: Build response with extracted values and confidence scores
    const extracted = {};

    for (const field of fieldsDescription) {
      const fullPath = field.startsWith('profile.') ? field : `profile.${field}`;
      const value = extractedValues[field] ?? extractedValues[fullPath] ?? null;

      extracted[fullPath] = {
        value,
        confidence: value !== null ? 0.8 : 0, // Default confidence for LLM extraction
        source: 'document',
        currentValue: currentProfile[field] ?? null
      };
    }

    return sendJson(res, 200, {
      artifactId,
      filename: artifactMeta?.filename || filename,
      extracted,
      documentType: guessDocumentType(artifactMeta?.filename || filename)
    });

  } catch (error) {
    console.error("[SmartParse] Unexpected error:", error);
    return sendError(res, 500, "Smart parse failed", error.message);
  }
}

/**
 * Apply Smart Parse Results
 *
 * Takes the extracted values and applies them to the deal profile,
 * updating provenance and creating materials as needed.
 */
export async function handleSmartParseApply(req, res, dealId, readJsonBody, resolveUserId) {
  const body = await readJsonBody(req);

  if (!body) {
    return sendError(res, 400, "Request body required");
  }

  const { artifactId, fields } = body;

  if (!artifactId) {
    return sendError(res, 400, "artifactId is required");
  }

  if (!fields || !Array.isArray(fields) || fields.length === 0) {
    return sendError(res, 400, "fields array is required");
  }

  const prisma = getPrisma();
  const userId = resolveUserId(req);

  try {
    // Step 1: Get or create parse session for this deal
    let session = await prisma.lLMParseSession.findFirst({
      where: { dealId },
      orderBy: { completedAt: "desc" }
    });

    if (!session) {
      // Create a new session for smart parse
      session = await prisma.lLMParseSession.create({
        data: {
          userId: userId ?? null,
          dealId,
          inputText: `Smart parse from artifact ${artifactId}`,
          inputSource: "SMART_PARSE",
          provider: "smart-parse",
          model: null,
          promptVersion: "smart-parse.v1",
          schemaVersion: "smart-parse.v1",
          status: "COMPLETE",
          completedAt: new Date()
        }
      });
    }

    // Step 2: Update deal profile with new values
    const dealProfile = await prisma.dealProfile.findUnique({
      where: { dealId }
    });

    const currentProfile = dealProfile?.profile || {};
    const updatedProfile = { ...currentProfile };

    for (const field of fields) {
      const fieldName = field.fieldPath.replace('profile.', '');
      updatedProfile[fieldName] = field.value;
    }

    // Upsert deal profile
    await prisma.dealProfile.upsert({
      where: { dealId },
      create: {
        dealId,
        profile: updatedProfile,
        provenance: { source: "smart-parse", updatedAt: new Date().toISOString() }
      },
      update: {
        profile: updatedProfile,
        provenance: { source: "smart-parse", updatedAt: new Date().toISOString() }
      }
    });

    // Step 3: Create/update provenance records for each field
    const provenanceResults = [];

    for (const field of fields) {
      const fieldPath = field.fieldPath.startsWith('profile.')
        ? field.fieldPath
        : `profile.${field.fieldPath}`;

      // Check for existing provenance
      const existing = await prisma.lLMFieldProvenance.findFirst({
        where: { sessionId: session.id, fieldPath },
        orderBy: { asOf: "desc" }
      });

      const now = new Date();

      if (existing) {
        await prisma.lLMFieldProvenance.update({
          where: { id: existing.id },
          data: {
            value: JSON.stringify(field.value),
            source: "DOC",
            artifactId,
            evidenceNeeded: null,
            confidence: 0.9,
            asOf: now
          }
        });
      } else {
        await prisma.lLMFieldProvenance.create({
          data: {
            sessionId: session.id,
            fieldPath,
            value: JSON.stringify(field.value),
            source: "DOC",
            confidence: 0.9,
            rationale: "Extracted from uploaded document via smart parse",
            evidenceNeeded: null,
            artifactId,
            asOf: now
          }
        });
      }

      // Step 4: Try to sync with kernel material
      let materialSyncResult = null;
      try {
        const { mapFieldToMaterialType } = await import("../mappers.js");
        const materialType = mapFieldToMaterialType(fieldPath);

        if (materialType) {
          materialSyncResult = await createOrUpdateMaterial(
            KERNEL_BASE_URL,
            dealId,
            materialType,
            artifactId,
            fieldPath
          );
        }
      } catch (materialError) {
        console.error(`[SmartParse] Material sync failed for ${fieldPath}:`, materialError);
        // Continue without material sync - provenance is still updated
      }

      provenanceResults.push({
        fieldPath,
        value: field.value,
        materialSync: materialSyncResult ? materialSyncResult.action : null
      });
    }

    // Step 5: Close any related workflow tasks
    for (const field of fields) {
      const fieldPath = field.fieldPath.startsWith('profile.')
        ? field.fieldPath
        : `profile.${field.fieldPath}`;

      await prisma.workflowTask.updateMany({
        where: {
          dealId,
          relatedFieldPath: fieldPath,
          status: "OPEN"
        },
        data: { status: "DONE" }
      });
    }

    // Step 6: Invalidate caches
    deleteCacheByPrefix("inbox:");
    invalidateDealCaches(dealId);

    return sendJson(res, 200, {
      success: true,
      appliedCount: fields.length,
      fields: provenanceResults,
      artifactId
    });

  } catch (error) {
    console.error("[SmartParse Apply] Error:", error);
    return sendError(res, 500, "Failed to apply parsed values", error.message);
  }
}

/**
 * Guess document type from filename
 */
function guessDocumentType(filename) {
  const lower = filename?.toLowerCase() || '';

  if (lower.includes('psa') || lower.includes('purchase') || lower.includes('sale agreement')) {
    return 'PSA';
  }
  if (lower.includes('appraisal')) {
    return 'APPRAISAL';
  }
  if (lower.includes('t12') || lower.includes('t-12') || lower.includes('trailing')) {
    return 'T12';
  }
  if (lower.includes('rent roll') || lower.includes('rentroll')) {
    return 'RENT_ROLL';
  }
  if (lower.includes('operating') || lower.includes('income') || lower.includes('expense')) {
    return 'OPERATING_STATEMENT';
  }
  if (lower.includes('offering') || lower.includes('om') || lower.includes('memorandum')) {
    return 'OFFERING_MEMO';
  }
  if (lower.includes('term') || lower.includes('sheet')) {
    return 'TERM_SHEET';
  }
  if (lower.includes('loan') || lower.includes('commitment')) {
    return 'LOAN_COMMITMENT';
  }

  return 'OTHER';
}
