import { getPrisma } from "../db.js";
import { kernelRequest } from "../kernel.js";
import { deleteCacheByPrefix } from "../runtime.js";
import { invalidateDealCaches } from "./deals.js";

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

export async function handleProvenanceUpdate(req, res, dealId, readJsonBody, kernelBaseUrl, resolveUserId) {
  const body = await readJsonBody(req);
  const fieldPath = body?.fieldPath;
  const artifactId = body?.artifactId ?? null;
  if (!fieldPath || typeof fieldPath !== "string") {
    return sendError(res, 400, "Invalid fieldPath");
  }

  const prisma = getPrisma();
  const latestSession = await prisma.lLMParseSession.findFirst({
    where: { dealId },
    orderBy: { completedAt: "desc" }
  });
  if (!latestSession) {
    return sendError(res, 404, "No parse session found for deal");
  }

  const existing = await prisma.lLMFieldProvenance.findFirst({
    where: { sessionId: latestSession.id, fieldPath },
    orderBy: { asOf: "desc" }
  });

  // Store original values for rollback
  const originalProvenance = existing
    ? {
        source: existing.source,
        artifactId: existing.artifactId,
        evidenceNeeded: existing.evidenceNeeded,
        confidence: existing.confidence,
        asOf: existing.asOf
      }
    : null;

  const now = new Date();
  let updatedProvenance = null;

  try {
    // Step 1: Update provenance in BFF SQLite
    if (existing) {
      updatedProvenance = await prisma.lLMFieldProvenance.update({
        where: { id: existing.id },
        data: {
          source: "DOC",
          artifactId,
          evidenceNeeded: null,
          confidence: existing.confidence ?? 0.9,
          asOf: now
        }
      });
    } else {
      updatedProvenance = await prisma.lLMFieldProvenance.create({
        data: {
          sessionId: latestSession.id,
          fieldPath,
          value: null,
          source: "DOC",
          confidence: 0.9,
          rationale: "Document-backed update",
          evidenceNeeded: null,
          artifactId,
          asOf: now
        }
      });
    }

    // Step 2: Map field to material type - Query Kernel endpoint
    let materialType = null;
    try {
      const mappingResponse = await kernelRequest(
        `${kernelBaseUrl}/deals/${dealId}/schema/field-material-map?fieldPath=${encodeURIComponent(fieldPath)}`,
        { method: "GET" }
      );
      if (mappingResponse.ok && mappingResponse.data?.materialType) {
        materialType = mappingResponse.data.materialType;
      }
    } catch (error) {
      // Kernel endpoint not available yet, fall back to BFF mapping
      const { mapFieldToMaterialType } = await import("../mappers.js");
      materialType = mapFieldToMaterialType(fieldPath);
    }

    let materialSyncResult = null;

    if (materialType && artifactId) {
      // Step 3: Create or update kernel material (atomic with rollback)
      try {
        const { createOrUpdateMaterial } = await import("../kernel.js");
        materialSyncResult = await createOrUpdateMaterial(
          kernelBaseUrl,
          dealId,
          materialType,
          artifactId,
          fieldPath
        );

        console.log(
          `[Provenance Sync] ${materialSyncResult.action} material ${materialType} for field ${fieldPath}`
        );
      } catch (materialError) {
        // Kernel material creation/update failed - rollback provenance
        console.error(
          `[Provenance Sync] Material sync failed, rolling back provenance:`,
          materialError
        );

        if (originalProvenance) {
          // Rollback to original values
          await prisma.lLMFieldProvenance.update({
            where: { id: existing.id },
            data: originalProvenance
          });
        } else {
          // Delete newly created provenance
          await prisma.lLMFieldProvenance.delete({
            where: { id: updatedProvenance.id }
          });
        }

        // Return error to user
        return sendError(
          res,
          502,
          "Failed to sync with kernel",
          materialError?.data ?? materialError?.message ?? "Material creation failed"
        );
      }
    } else if (!materialType) {
      // Dynamic/custom field - no automatic material sync
      console.log(
        `[Provenance Sync] No material mapping for field ${fieldPath}, skipping kernel sync`
      );
    }

    // Step 4: Close related tasks
    await prisma.workflowTask.updateMany({
      where: {
        dealId,
        relatedFieldPath: fieldPath,
        status: "OPEN"
      },
      data: { status: "DONE" }
    });

    // Step 5: Invalidate caches
    deleteCacheByPrefix("inbox:");
    invalidateDealCaches(dealId);

    // Return success with sync details
    sendJson(res, 200, {
      ok: true,
      provenance: {
        fieldPath,
        source: "DOC",
        artifactId
      },
      materialSync: materialSyncResult
        ? {
            action: materialSyncResult.action,
            materialType,
            materialId: materialSyncResult.material?.id
          }
        : null
    });
  } catch (error) {
    // Unexpected error - attempt rollback if provenance was updated
    if (updatedProvenance && originalProvenance) {
      try {
        await prisma.lLMFieldProvenance.update({
          where: { id: existing.id },
          data: originalProvenance
        });
      } catch (rollbackError) {
        console.error("[Provenance Sync] Rollback failed:", rollbackError);
      }
    } else if (updatedProvenance && !originalProvenance) {
      try {
        await prisma.lLMFieldProvenance.delete({
          where: { id: updatedProvenance.id }
        });
      } catch (rollbackError) {
        console.error("[Provenance Sync] Rollback failed:", rollbackError);
      }
    }

    console.error("[Provenance Sync] Unexpected error:", error);
    return sendError(res, 500, "Provenance update failed", error?.message);
  }
}
