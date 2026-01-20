/**
 * Excel Import Routes
 *
 * Handle Excel file uploads, parsing, mapping, and applying
 * to underwriting models with full provenance tracking.
 * Includes A.CRE model detection and Excel export.
 */

import { getPrisma } from '../db.js';
import { parseExcelFile, getSheetData } from '../services/excel-parser.js';
import { autoMapExcelToModel, setManualMapping, validateMappings, getAllMappableFields } from '../services/excel-mapper.js';
import { detectModelType, getEnhancedMappings, getExportTemplate } from '../services/excel-model-detector.js';
import { exportToExcel } from '../services/excel-exporter.js';

/**
 * Helper to send JSON responses
 */
function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

/**
 * Parse multipart form data to get file buffer
 * Simple implementation for single file upload
 */
async function parseMultipartFile(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let filename = null;
    let contentType = null;
    let boundary = null;

    // Extract boundary from content-type header
    const contentTypeHeader = req.headers['content-type'] || '';
    const boundaryMatch = contentTypeHeader.match(/boundary=(.+)$/);
    if (boundaryMatch) {
      boundary = boundaryMatch[1];
    }

    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const buffer = Buffer.concat(chunks);

      if (!boundary) {
        // Try to parse as raw file
        resolve({ buffer, filename: 'upload.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        return;
      }

      // Parse multipart
      const data = buffer.toString('binary');
      const parts = data.split('--' + boundary);

      for (const part of parts) {
        if (part.includes('Content-Disposition')) {
          // Extract filename
          const filenameMatch = part.match(/filename="([^"]+)"/);
          if (filenameMatch) {
            filename = filenameMatch[1];
          }

          // Extract content type
          const ctMatch = part.match(/Content-Type:\s*([^\r\n]+)/i);
          if (ctMatch) {
            contentType = ctMatch[1].trim();
          }

          // Extract file content (after double CRLF)
          const contentStart = part.indexOf('\r\n\r\n');
          if (contentStart !== -1) {
            let content = part.substring(contentStart + 4);
            // Remove trailing boundary markers
            content = content.replace(/\r\n--$/, '').replace(/--\r\n$/, '').replace(/\r\n$/, '');
            const fileBuffer = Buffer.from(content, 'binary');
            resolve({ buffer: fileBuffer, filename, contentType });
            return;
          }
        }
      }

      reject(new Error('No file found in multipart data'));
    });
    req.on('error', reject);
  });
}

/**
 * POST /api/deals/:dealId/excel-import
 * Upload and parse an Excel file
 * SECURITY: authUser is required and must come from validated JWT at dispatch level
 */
export async function handleExcelUpload(req, res, dealId, authUser) {
  const prisma = getPrisma();
  if (!authUser) {
    return sendJson(res, 401, { error: 'Not authenticated' });
  }
  // SECURITY: Use validated authUser instead of spoofable headers
  const userId = authUser.id || 'system';
  const userName = authUser.name || 'System';

  try {
    // Parse the uploaded file
    const { buffer, filename } = await parseMultipartFile(req);

    if (!buffer || buffer.length === 0) {
      return sendJson(res, 400, { error: 'No file uploaded' });
    }

    // Validate file extension
    if (!filename.match(/\.(xlsx|xls)$/i)) {
      return sendJson(res, 400, { error: 'Invalid file type. Only .xlsx and .xls files are supported.' });
    }

    // Parse the Excel file
    const parsed = await parseExcelFile(buffer, filename);

    // Detect model type (A.CRE All-in-One, A.CRE Office Dev, custom, etc.)
    const modelDetection = detectModelType(parsed);
    console.log(`[Excel Import] Detected model type: ${modelDetection.modelName} (confidence: ${(modelDetection.confidence * 100).toFixed(0)}%)`);

    // Auto-map to model fields, using enhanced mappings if known model type
    let mapping = autoMapExcelToModel(parsed);

    // If A.CRE model detected with high confidence, use enhanced mappings
    if (modelDetection.detected && modelDetection.confidence >= 0.7) {
      const enhanced = getEnhancedMappings(parsed, modelDetection.modelType);
      // Merge enhanced mappings with auto-detected ones
      for (const [field, hint] of Object.entries(enhanced)) {
        if (hint.candidates && hint.candidates.length > 0 && !mapping.mappings[field]) {
          // Use best candidate from enhanced mappings
          const best = hint.candidates[0];
          mapping.mappings[field] = {
            sheet: hint.sheet,
            cell: best.cell,
            value: best.value,
            label: best.label,
            confidence: 0.85,
            source: 'acre_enhanced'
          };
        }
      }
    }

    // Create import record with model detection info
    const excelImport = await prisma.excelImport.create({
      data: {
        dealId,
        filename,
        fileSize: buffer.length,
        sheetCount: parsed.sheetCount,
        uploadedBy: userId,
        uploadedByName: userName,
        status: 'COMPLETED',
        processedAt: new Date(),
        mappedFields: JSON.stringify(mapping.mappings),
        unmappedFields: JSON.stringify(mapping.unmapped),
        detectedModelType: modelDetection.modelType,
        detectedModelName: modelDetection.modelName,
        modelConfidence: modelDetection.confidence
      }
    });

    // Store cells for reference
    const cellsToStore = parsed.cells
      .filter(c => ['NUMBER', 'FORMULA', 'CURRENCY', 'PERCENTAGE'].includes(c.dataType))
      .slice(0, 1000); // Limit stored cells

    if (cellsToStore.length > 0) {
      await prisma.excelCell.createMany({
        data: cellsToStore.map(c => ({
          importId: excelImport.id,
          sheetName: c.sheetName,
          cellRef: c.cellRef,
          row: c.row,
          col: c.col,
          rawValue: c.rawValue,
          computedValue: c.computedValue !== null ? String(c.computedValue) : null,
          formula: c.formula,
          dataType: c.dataType,
          labelText: c.labelText,
          mappedTo: Object.entries(mapping.mappings).find(([_, m]) => m.cell === c.cellRef)?.[0] || null
        }))
      });
    }

    // Validate mappings
    const validation = validateMappings(mapping.mappings);

    return sendJson(res, 200, {
      import: excelImport,
      sheets: parsed.sheets,
      mappings: mapping.mappings,
      unmapped: mapping.unmapped,
      stats: mapping.stats,
      validation,
      cellCount: parsed.cells.length,
      // Model detection results
      detection: {
        detected: modelDetection.detected,
        modelType: modelDetection.modelType,
        modelName: modelDetection.modelName,
        shortName: modelDetection.shortName,
        confidence: modelDetection.confidence,
        matchedSheets: modelDetection.matchedSheets,
        matchedPatterns: modelDetection.matchedPatterns,
        version: modelDetection.version
      }
    });

  } catch (error) {
    console.error('[Excel Import] Upload error:', error);
    return sendJson(res, 500, { error: error.message });
  }
}

/**
 * GET /api/deals/:dealId/excel-imports
 * List all Excel imports for a deal
 */
export async function handleListExcelImports(req, res, dealId) {
  const prisma = getPrisma();

  try {
    const imports = await prisma.excelImport.findMany({
      where: { dealId },
      orderBy: { uploadedAt: 'desc' }
    });

    return sendJson(res, 200, {
      imports: imports.map(i => ({
        ...i,
        mappedFields: i.mappedFields ? JSON.parse(i.mappedFields) : {},
        unmappedFields: i.unmappedFields ? JSON.parse(i.unmappedFields) : []
      }))
    });

  } catch (error) {
    console.error('[Excel Import] List error:', error);
    return sendJson(res, 500, { error: error.message });
  }
}

/**
 * GET /api/excel-imports/:id
 * Get details of a specific import
 * SECURITY: authUser passed from dispatch for org isolation check
 */
export async function handleGetExcelImport(req, res, importId, authUser) {
  const prisma = getPrisma();

  try {
    // SECURITY: Include deal to verify org isolation
    const excelImport = await prisma.excelImport.findUnique({
      where: { id: importId },
      include: { deal: true }
    });

    if (!excelImport) {
      return sendJson(res, 404, { error: 'Import not found' });
    }

    // SECURITY: Enforce organization isolation
    if (excelImport.deal?.organizationId && excelImport.deal.organizationId !== authUser.organizationId) {
      return sendJson(res, 403, { error: 'Access denied - import belongs to different organization' });
    }

    // Get stored cells
    const cells = await prisma.excelCell.findMany({
      where: { importId },
      orderBy: [{ sheetName: 'asc' }, { row: 'asc' }, { col: 'asc' }]
    });

    return sendJson(res, 200, {
      import: {
        ...excelImport,
        mappedFields: excelImport.mappedFields ? JSON.parse(excelImport.mappedFields) : {},
        unmappedFields: excelImport.unmappedFields ? JSON.parse(excelImport.unmappedFields) : []
      },
      cells
    });

  } catch (error) {
    console.error('[Excel Import] Get error:', error);
    return sendJson(res, 500, { error: error.message });
  }
}

/**
 * PATCH /api/excel-imports/:id/mappings
 * Update mappings for an import (manual adjustments)
 * SECURITY: authUser passed from dispatch for org isolation check
 */
export async function handleUpdateMappings(req, res, importId, authUser) {
  const prisma = getPrisma();

  try {
    let body = '';
    for await (const chunk of req) body += chunk;
    const { mappings } = JSON.parse(body);

    // SECURITY: Include deal to verify org isolation
    const excelImport = await prisma.excelImport.findUnique({
      where: { id: importId },
      include: { deal: true }
    });

    if (!excelImport) {
      return sendJson(res, 404, { error: 'Import not found' });
    }

    // SECURITY: Enforce organization isolation
    if (excelImport.deal?.organizationId && excelImport.deal.organizationId !== authUser.organizationId) {
      return sendJson(res, 403, { error: 'Access denied - import belongs to different organization' });
    }

    // Merge with existing mappings
    const existingMappings = excelImport.mappedFields ? JSON.parse(excelImport.mappedFields) : {};
    const updatedMappings = { ...existingMappings, ...mappings };

    // Update import record
    await prisma.excelImport.update({
      where: { id: importId },
      data: {
        mappedFields: JSON.stringify(updatedMappings)
      }
    });

    // Update cell mappings
    for (const [field, mapping] of Object.entries(mappings)) {
      if (mapping && mapping.cell) {
        await prisma.excelCell.updateMany({
          where: { importId, cellRef: mapping.cell },
          data: { mappedTo: field }
        });
      }
    }

    return sendJson(res, 200, {
      mappings: updatedMappings,
      updated: Object.keys(mappings)
    });

  } catch (error) {
    console.error('[Excel Import] Update mappings error:', error);
    return sendJson(res, 500, { error: error.message });
  }
}

/**
 * POST /api/excel-imports/:id/apply
 * Apply Excel mappings to underwriting model
 * SECURITY: authUser passed from dispatch for org isolation check
 */
export async function handleApplyExcelImport(req, res, importId, authUser) {
  const prisma = getPrisma();
  // SECURITY: Use validated authUser identity, not spoofable headers
  const userId = authUser.id;
  const userName = authUser.name || 'System';

  try {
    let body = '';
    for await (const chunk of req) body += chunk;
    const { fields } = body ? JSON.parse(body) : {}; // Optional: specific fields to apply

    // SECURITY: Include deal to verify org isolation
    const excelImport = await prisma.excelImport.findUnique({
      where: { id: importId },
      include: { deal: true }
    });

    if (!excelImport) {
      return sendJson(res, 404, { error: 'Import not found' });
    }

    // SECURITY: Enforce organization isolation
    if (excelImport.deal?.organizationId && excelImport.deal.organizationId !== authUser.organizationId) {
      return sendJson(res, 403, { error: 'Access denied - import belongs to different organization' });
    }

    const mappings = excelImport.mappedFields ? JSON.parse(excelImport.mappedFields) : {};

    if (Object.keys(mappings).length === 0) {
      return sendJson(res, 400, { error: 'No mappings to apply' });
    }

    const dealId = excelImport.dealId;

    // Get or create underwriting model
    let model = await prisma.underwritingModel.findUnique({ where: { dealId } });
    if (!model) {
      model = await prisma.underwritingModel.create({ data: { dealId, status: 'DRAFT' } });
    }

    // Apply each mapped field
    const appliedFields = [];
    const modelUpdates = {};

    for (const [field, mapping] of Object.entries(mappings)) {
      // Skip if specific fields requested and this isn't one
      if (fields && !fields.includes(field)) {
        continue;
      }

      // Skip if no value
      if (mapping.value === null || mapping.value === undefined) {
        continue;
      }

      // Supersede old input
      await prisma.underwritingInput.updateMany({
        where: { dealId, fieldPath: field, supersededAt: null },
        data: { supersededAt: new Date() }
      });

      // Create new input with Excel provenance
      await prisma.underwritingInput.create({
        data: {
          dealId,
          fieldPath: field,
          value: JSON.stringify(mapping.value),
          sourceType: 'EXCEL_IMPORT',
          source: 'EXCEL',
          sourceId: excelImport.id,
          documentId: excelImport.id,
          documentName: excelImport.filename,
          documentCell: `${mapping.sheet}!${mapping.cell}`,
          aiConfidence: mapping.confidence,
          setBy: userId,
          setByName: userName,
          rationale: `Imported from Excel: ${mapping.label} (${mapping.sheet}!${mapping.cell})`
        }
      });

      modelUpdates[field] = mapping.value;
      appliedFields.push(field);
    }

    // Update the model
    if (Object.keys(modelUpdates).length > 0) {
      await prisma.underwritingModel.update({
        where: { dealId },
        data: modelUpdates
      });
    }

    // Mark import as applied
    await prisma.excelImport.update({
      where: { id: importId },
      data: {
        appliedAt: new Date(),
        appliedBy: userId
      }
    });

    return sendJson(res, 200, {
      applied: appliedFields,
      modelUpdates,
      importId
    });

  } catch (error) {
    console.error('[Excel Import] Apply error:', error);
    return sendJson(res, 500, { error: error.message });
  }
}

/**
 * GET /api/excel-imports/:id/sheet/:sheetName
 * Get data for a specific sheet
 * SECURITY: authUser passed from dispatch for org isolation check
 */
export async function handleGetExcelSheet(req, res, importId, sheetName, authUser) {
  const prisma = getPrisma();

  try {
    // SECURITY: Verify org isolation before returning sheet data
    const excelImport = await prisma.excelImport.findUnique({
      where: { id: importId },
      include: { deal: true }
    });

    if (!excelImport) {
      return sendJson(res, 404, { error: 'Import not found' });
    }

    // SECURITY: Enforce organization isolation
    if (excelImport.deal?.organizationId && excelImport.deal.organizationId !== authUser.organizationId) {
      return sendJson(res, 403, { error: 'Access denied - import belongs to different organization' });
    }

    const cells = await prisma.excelCell.findMany({
      where: {
        importId,
        sheetName: decodeURIComponent(sheetName)
      },
      orderBy: [{ row: 'asc' }, { col: 'asc' }]
    });

    // Group by row for display
    const rows = {};
    for (const cell of cells) {
      if (!rows[cell.row]) {
        rows[cell.row] = [];
      }
      rows[cell.row].push(cell);
    }

    return sendJson(res, 200, {
      sheetName: decodeURIComponent(sheetName),
      cellCount: cells.length,
      rows: Object.entries(rows).map(([row, cells]) => ({
        row: parseInt(row),
        cells
      }))
    });

  } catch (error) {
    console.error('[Excel Import] Get sheet error:', error);
    return sendJson(res, 500, { error: error.message });
  }
}

/**
 * GET /api/excel/mappable-fields
 * Get list of all fields that can be mapped from Excel
 */
export async function handleGetMappableFields(req, res) {
  try {
    const fields = getAllMappableFields();
    return sendJson(res, 200, { fields });
  } catch (error) {
    console.error('[Excel Import] Get mappable fields error:', error);
    return sendJson(res, 500, { error: error.message });
  }
}

/**
 * GET /api/deals/:dealId/excel-export
 * Export underwriting model to Excel workbook
 */
export async function handleExcelExport(req, res, dealId) {
  const prisma = getPrisma();
  const url = new URL(req.url, 'http://localhost');

  try {
    // Get underwriting model
    const model = await prisma.underwritingModel.findUnique({
      where: { dealId }
    });

    if (!model) {
      return sendJson(res, 404, { error: 'No underwriting model found for this deal' });
    }

    // Get deal info for filename from DealProfile (Deal is kernel-managed)
    const dealProfile = await prisma.dealProfile?.findUnique({ where: { dealId } })
      .catch(() => null);
    const deal = dealProfile ? { name: dealProfile.propertyAddress || dealId } : null;

    // Get scenarios for the deal
    const scenarios = await prisma.underwritingScenario.findMany({
      where: { dealId }
    });

    // Get waterfall structure if exists
    const waterfall = await prisma.waterfallStructure?.findUnique({ where: { dealId } })
      .catch(() => null);

    // Parse options from query params
    const options = {
      templateType: url.searchParams.get('template') || 'GENERIC_CRE',
      includeFormulas: url.searchParams.get('formulas') !== 'false',
      includeWaterfall: url.searchParams.get('waterfall') !== 'false' && waterfall,
      includeSensitivity: url.searchParams.get('sensitivity') !== 'false',
      sensitivityConfig: {
        xAxisField: url.searchParams.get('xAxis') || 'exitCapRate',
        yAxisField: url.searchParams.get('yAxis') || 'vacancyRate',
        outputMetric: url.searchParams.get('metric') || 'irr'
      }
    };

    // Build model data for export
    const exportModel = {
      ...model,
      dealName: deal?.name || 'Underwriting Model',
      scenarios: scenarios.map(s => ({
        ...s,
        assumptions: s.assumptions ? JSON.parse(s.assumptions) : {},
        results: s.results ? JSON.parse(s.results) : {}
      })),
      waterfall: waterfall ? {
        ...waterfall,
        promoteTiers: waterfall.promoteTiers ? JSON.parse(waterfall.promoteTiers) : []
      } : null
    };

    // Generate Excel workbook
    const buffer = await exportToExcel(exportModel, options);

    // Set response headers for file download
    const filename = `${deal?.name || 'Underwriting'}-Model-${new Date().toISOString().split('T')[0]}.xlsx`;
    res.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      'Content-Length': buffer.length
    });
    res.end(buffer);

  } catch (error) {
    console.error('[Excel Export] Error:', error);
    return sendJson(res, 500, { error: error.message });
  }
}

/**
 * GET /api/excel/templates
 * List available export templates
 */
export async function handleGetExportTemplates(req, res) {
  try {
    const templates = [
      {
        id: 'ACRE_ALL_IN_ONE',
        name: 'A.CRE All-in-One Style',
        description: 'Professional template matching A.CRE All-in-One Model structure',
        sheets: ['Summary', 'Assumptions', 'Cash Flows', 'Returns', 'Waterfall', 'Sensitivity']
      },
      {
        id: 'GENERIC_CRE',
        name: 'Standard CRE Model',
        description: 'Clean, professional layout suitable for any deal type',
        sheets: ['Summary', 'Assumptions', 'Cash Flows', 'Sensitivity']
      },
      {
        id: 'LP_REPORT',
        name: 'LP Report Format',
        description: 'Simplified view optimized for LP distribution',
        sheets: ['Summary', 'Returns', 'Distributions']
      }
    ];

    return sendJson(res, 200, { templates });
  } catch (error) {
    console.error('[Excel Templates] Error:', error);
    return sendJson(res, 500, { error: error.message });
  }
}

export default {
  handleExcelUpload,
  handleListExcelImports,
  handleGetExcelImport,
  handleUpdateMappings,
  handleApplyExcelImport,
  handleGetExcelSheet,
  handleGetMappableFields,
  handleExcelExport,
  handleGetExportTemplates
};
