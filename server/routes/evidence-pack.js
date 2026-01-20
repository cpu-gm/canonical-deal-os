/**
 * Evidence Pack Routes
 *
 * API endpoints for generating and managing evidence packs.
 *
 * Endpoints:
 * - POST   /api/deals/:dealId/evidence-pack/generate   - Generate evidence pack
 * - GET    /api/deals/:dealId/evidence-packs           - List evidence packs
 * - GET    /api/deals/:dealId/evidence-packs/:packId/download - Download pack ZIP
 */

import {
  evidencePackGenerator,
  PACK_CONFIGS
} from '../services/evidence-pack-generator.js';

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
 * Generate a new evidence pack
 * SECURITY: authUser is required and must come from validated JWT at dispatch level
 */
async function handleGenerateEvidencePack(req, res, dealId, readJsonBody, authUser) {
  try {
    if (!authUser) {
      return sendJson(res, 401, { success: false, error: 'Not authenticated' });
    }

    const body = await readJsonBody(req);
    const { packType } = body || {};

    if (!packType) {
      return sendJson(res, 400, {
        success: false,
        error: 'packType is required'
      });
    }

    if (!PACK_CONFIGS[packType]) {
      return sendJson(res, 400, {
        success: false,
        error: `Invalid pack type: ${packType}`,
        validTypes: Object.keys(PACK_CONFIGS)
      });
    }

    // SECURITY: Use validated authUser instead of spoofable headers
    const actor = {
      id: body?.actorId || authUser.id || 'system',
      name: body?.actorName || authUser.name || 'System',
      role: body?.actorRole || authUser.role || 'ANALYST'
    };

    const result = await evidencePackGenerator.generatePack(dealId, packType, actor);

    sendJson(res, 200, {
      success: true,
      message: `Generated ${PACK_CONFIGS[packType].name}`,
      evidencePack: {
        id: result.evidencePack.id,
        packType: result.evidencePack.packType,
        name: result.evidencePack.name,
        fileCount: result.evidencePack.fileCount,
        sizeBytes: result.evidencePack.sizeBytes,
        contentHash: result.evidencePack.contentHash,
        generatedAt: result.evidencePack.generatedAt
      },
      manifest: result.manifest
    });
  } catch (error) {
    console.error('Error generating evidence pack:', error);
    sendJson(res, 500, {
      success: false,
      error: error.message
    });
  }
}

/**
 * List evidence packs for a deal
 */
async function handleListEvidencePacks(req, res, dealId) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const packType = url.searchParams.get('packType');

    const packs = await evidencePackGenerator.getPacks(dealId, packType);

    // Group by pack type
    const byType = packs.reduce((acc, pack) => {
      if (!acc[pack.packType]) {
        acc[pack.packType] = {
          packType: pack.packType,
          config: PACK_CONFIGS[pack.packType],
          packs: []
        };
      }
      acc[pack.packType].packs.push(pack);
      return acc;
    }, {});

    sendJson(res, 200, {
      success: true,
      packs,
      byType: Object.values(byType),
      total: packs.length
    });
  } catch (error) {
    console.error('Error fetching evidence packs:', error);
    sendJson(res, 500, {
      success: false,
      error: error.message
    });
  }
}

/**
 * Download evidence pack ZIP
 * SECURITY: authUser is required and must come from validated JWT at dispatch level
 */
async function handleDownloadEvidencePack(req, res, dealId, packId, authUser) {
  try {
    if (!authUser) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: 'Not authenticated' }));
      return;
    }

    // Get pack details
    const pack = await evidencePackGenerator.getPack(packId);

    if (!pack || pack.dealId !== dealId) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: 'Evidence pack not found' }));
      return;
    }

    // SECURITY: Use validated authUser instead of spoofable headers
    const actor = {
      id: authUser.id || 'system',
      name: authUser.name || 'System',
      role: authUser.role || 'ANALYST'
    };

    const result = await evidencePackGenerator.generatePack(
      pack.dealId,
      pack.packType,
      actor
    );

    // Set response headers
    const fileName = `${pack.packType}_${pack.dealId}_${Date.now()}.zip`;
    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': result.buffer.length,
      'Access-Control-Allow-Origin': '*'
    });

    res.end(result.buffer);
  } catch (error) {
    console.error('Error downloading evidence pack:', error);
    res.writeHead(error.message.includes('not found') ? 404 : 500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: false, error: error.message }));
  }
}

export {
  handleGenerateEvidencePack,
  handleListEvidencePacks,
  handleDownloadEvidencePack
};
