/**
 * Underwriting Intelligence Routes
 *
 * API endpoints for document extraction, underwriting model management,
 * conflict detection, scenario analysis, and memo generation.
 */

import { getPrisma } from '../db.js';
import { extractAuthUser } from './auth.js';
import { readStore } from '../store.js';
import { extractRentRoll, calculateRentRollConfidence } from '../services/extractors/rent-roll-extractor.js';
import { extractT12, calculateT12Confidence, mapT12ToUnderwritingModel } from '../services/extractors/t12-extractor.js';
import { extractLoanTerms, calculateLoanTermsConfidence, mapLoanTermsToUnderwritingModel, calculateDebtService } from '../services/extractors/loan-terms-extractor.js';
import { calculateUnderwriting, calculateScenario, compareScenarios, projectDetailedCashFlows } from '../services/underwriting-calculator.js';
import { calculateWaterfall, createDefaultStructure, formatWaterfallForDisplay, compareWaterfallScenarios, groupLPsByClassPriority } from '../services/waterfall-calculator.js';
import { calculateSensitivityMatrix, getCellColor, calculateHoldPeriodSensitivity, calculateQuickSensitivity, getSensitivityOptions, createScenarioFromCell, DEFAULT_RANGES, OUTPUT_METRICS } from '../services/sensitivity-calculator.js';
import { getAllSectors, getSectorConfig, detectSector, getSectorRequiredInputs, getSectorAllInputs, getSectorBenchmarks, getSectorRiskFactors, getSectorPrimaryMetrics, validateAgainstBenchmark } from '../services/sector-config.js';
import { calculateSectorMetrics } from '../services/underwriting-calculator.js';

import { detectAllConflicts, getConflictSummary, SEVERITY, CONFLICT_TYPE } from '../services/conflict-detector.js';
import { generateMemo, generateQuickSummary } from '../services/memo-generator.js';

/**
 * Helper to send JSON responses
 */
function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

/**
 * Require authenticated user with access to the specified deal.
 * Returns authUser if authorized, null otherwise (response already sent).
 */
async function requireDealOrgAccess(req, res, dealId) {
  const authUser = await extractAuthUser(req);
  if (!authUser) {
    sendJson(res, 401, { error: 'Not authenticated' });
    return null;
  }

  const store = await readStore();
  const record = store.dealIndex.find((item) => item.id === dealId);

  if (!record) {
    sendJson(res, 404, { error: 'Deal not found' });
    return null;
  }

  // ALWAYS enforce org isolation - no conditional bypass
  if (record.organizationId && record.organizationId !== authUser.organizationId) {
    sendJson(res, 403, { error: 'Access denied - deal belongs to different organization' });
    return null;
  }

  return authUser;
}

/**
 * Require GP or Admin role for privileged operations.
 * Returns authUser if authorized, null otherwise (response already sent).
 */
async function requireGPWithDealAccess(req, res, dealId) {
  const authUser = await requireDealOrgAccess(req, res, dealId);
  if (!authUser) return null;

  if (!['GP', 'Admin'].includes(authUser.role)) {
    sendJson(res, 403, { error: 'GP or Admin role required' });
    return null;
  }

  return authUser;
}

/**
 * POST /api/deals/:dealId/extract
 * Extract structured data from an uploaded document
 */
export async function handleExtractDocument(req, res, dealId) {
  // Require authentication and org access
  const authUser = await requireDealOrgAccess(req, res, dealId);
  if (!authUser) return;

  const prisma = getPrisma();
  const userId = authUser.id;
  const userName = authUser.name;

  try {
    let body = '';
    for await (const chunk of req) body += chunk;
    const { artifactId, documentType, documentContent, filename } = JSON.parse(body);

    if (!artifactId || !documentType || !documentContent) {
      return sendJson(res, 400, { error: 'Missing required fields: artifactId, documentType, documentContent' });
    }

    // Check if extraction already exists
    const existing = await prisma.documentExtraction.findUnique({
      where: { dealId_artifactId: { dealId, artifactId } }
    });

    if (existing) {
      // Mark as superseded and create new
      await prisma.documentExtraction.update({
        where: { id: existing.id },
        data: { status: 'SUPERSEDED' }
      });
    }

    // Extract based on document type
    let extractedData;
    let confidence;

    switch (documentType.toUpperCase()) {
      case 'RENT_ROLL':
        extractedData = await extractRentRoll(documentContent, filename || 'rent-roll.pdf');
        confidence = calculateRentRollConfidence(extractedData);
        break;

      case 'T12':
        extractedData = await extractT12(documentContent, filename || 't12.pdf');
        confidence = calculateT12Confidence(extractedData);
        break;

      case 'LOAN_TERMS':
      case 'TERM_SHEET':
        extractedData = await extractLoanTerms(documentContent, filename || 'loan-terms.pdf');
        confidence = calculateLoanTermsConfidence(extractedData);
        break;

      default:
        return sendJson(res, 400, { error: `Unsupported document type: ${documentType}` });
    }

    // Store extraction
    const extraction = await prisma.documentExtraction.create({
      data: {
        dealId,
        artifactId,
        documentType: documentType.toUpperCase(),
        extractedData: JSON.stringify(extractedData),
        confidence,
        extractedBy: userId,
        status: 'EXTRACTED'
      }
    });

    // Store unit-level data for rent rolls
    if (documentType.toUpperCase() === 'RENT_ROLL' && extractedData.units?.length > 0) {
      await prisma.rentRollUnit.deleteMany({ where: { dealId } }); // Clear old data
      await prisma.rentRollUnit.createMany({
        data: extractedData.units.slice(0, 500).map(unit => ({
          dealId,
          extractionId: extraction.id,
          unitNumber: unit.unitNumber || '',
          unitType: unit.unitType,
          sqft: unit.sqft,
          currentRent: unit.currentRent,
          marketRent: unit.marketRent,
          leaseStart: unit.leaseStart ? new Date(unit.leaseStart) : null,
          leaseEnd: unit.leaseEnd ? new Date(unit.leaseEnd) : null,
          status: unit.status,
          tenant: unit.tenant
        }))
      });
    }

    // Store line items for T12
    if (documentType.toUpperCase() === 'T12' && extractedData.lineItems?.length > 0) {
      await prisma.t12LineItem.deleteMany({ where: { dealId } }); // Clear old data
      await prisma.t12LineItem.createMany({
        data: extractedData.lineItems.map(item => ({
          dealId,
          extractionId: extraction.id,
          category: item.category || 'EXPENSE',
          lineItem: item.lineItem || '',
          annualAmount: item.annualAmount || 0,
          monthlyAmounts: item.monthlyAmounts ? JSON.stringify(item.monthlyAmounts) : null
        }))
      });
    }

    return sendJson(res, 201, {
      extraction: {
        id: extraction.id,
        documentType: extraction.documentType,
        confidence: extraction.confidence,
        extractedAt: extraction.extractedAt
      },
      data: extractedData
    });

  } catch (error) {
    console.error('[Underwriting] Extract error:', error);
    return sendJson(res, error.status || 500, { error: error.message });
  }
}

/**
 * GET /api/deals/:dealId/extractions
 * List all extractions for a deal
 */
export async function handleListExtractions(req, res, dealId) {
  // Require authentication and org access
  const authUser = await requireDealOrgAccess(req, res, dealId);
  if (!authUser) return;

  const prisma = getPrisma();

  try {
    const extractions = await prisma.documentExtraction.findMany({
      where: { dealId },
      orderBy: { extractedAt: 'desc' }
    });

    return sendJson(res, 200, {
      extractions: extractions.map(e => ({
        id: e.id,
        documentType: e.documentType,
        artifactId: e.artifactId,
        confidence: e.confidence,
        status: e.status,
        extractedAt: e.extractedAt,
        extractedBy: e.extractedBy
      }))
    });

  } catch (error) {
    console.error('[Underwriting] List extractions error:', error);
    return sendJson(res, 500, { error: error.message });
  }
}

/**
 * GET /api/deals/:dealId/underwriting
 * Get or create underwriting model for a deal
 */
export async function handleGetUnderwritingModel(req, res, dealId) {
  // Require authentication and org access
  const authUser = await requireDealOrgAccess(req, res, dealId);
  if (!authUser) return;

  const prisma = getPrisma();

  try {
    let model = await prisma.underwritingModel.findUnique({
      where: { dealId }
    });

    if (!model) {
      // Create empty model
      model = await prisma.underwritingModel.create({
        data: { dealId, status: 'DRAFT' }
      });
    }

    // Get inputs history (current only)
    const inputs = await prisma.underwritingInput.findMany({
      where: { dealId, supersededAt: null },
      orderBy: { setAt: 'desc' }
    });

    // Get scenarios
    const scenarios = await prisma.underwritingScenario.findMany({
      where: { dealId },
      orderBy: { createdAt: 'asc' }
    });

    // Get conflicts
    const conflicts = await prisma.underwritingConflict.findMany({
      where: { dealId },
      orderBy: { createdAt: 'desc' }
    });

    return sendJson(res, 200, {
      model,
      inputs,
      scenarios: scenarios.map(s => ({
        ...s,
        assumptions: JSON.parse(s.assumptions || '{}'),
        results: s.results ? JSON.parse(s.results) : null
      })),
      conflicts,
      conflictSummary: getConflictSummary(conflicts)
    });

  } catch (error) {
    console.error('[Underwriting] Get model error:', error);
    return sendJson(res, 500, { error: error.message });
  }
}

/**
 * PATCH /api/deals/:dealId/underwriting
 * Update underwriting model inputs
 */
export async function handleUpdateUnderwritingModel(req, res, dealId) {
  // Require GP/Admin role for modifying underwriting model
  const authUser = await requireGPWithDealAccess(req, res, dealId);
  if (!authUser) return;

  const prisma = getPrisma();
  const userId = authUser.id;
  const userName = authUser.name;

  try {
    let body = '';
    for await (const chunk of req) body += chunk;
    const { updates, source = 'MANUAL', rationale } = JSON.parse(body);

    if (!updates || typeof updates !== 'object') {
      return sendJson(res, 400, { error: 'Missing updates object' });
    }

    // Get or create model
    let model = await prisma.underwritingModel.findUnique({ where: { dealId } });
    if (!model) {
      model = await prisma.underwritingModel.create({ data: { dealId, status: 'DRAFT' } });
    }

    // Track each input update with full provenance
    for (const [fieldPath, value] of Object.entries(updates)) {
      // Supersede old input
      await prisma.underwritingInput.updateMany({
        where: { dealId, fieldPath, supersededAt: null },
        data: { supersededAt: new Date() }
      });

      // Create new input record with full provenance
      await prisma.underwritingInput.create({
        data: {
          dealId,
          fieldPath,
          value: JSON.stringify(value),
          sourceType: 'HUMAN_ENTRY',
          source,
          setBy: userId,
          setByName: userName,
          rationale
        }
      });
    }

    // Update the model with new values
    const modelUpdate = {};
    const allowedFields = [
      'grossPotentialRent', 'vacancyRate', 'effectiveGrossIncome', 'otherIncome',
      'operatingExpenses', 'taxes', 'insurance', 'management', 'reserves',
      'netOperatingIncome', 'loanAmount', 'interestRate', 'amortization', 'loanTerm',
      'annualDebtService', 'goingInCapRate', 'cashOnCash', 'dscr',
      'exitCapRate', 'holdPeriod', 'rentGrowth', 'expenseGrowth', 'irr', 'equityMultiple'
    ];

    for (const [field, value] of Object.entries(updates)) {
      if (allowedFields.includes(field) && value !== undefined) {
        modelUpdate[field] = value;
      }
    }

    if (Object.keys(modelUpdate).length > 0) {
      model = await prisma.underwritingModel.update({
        where: { dealId },
        data: modelUpdate
      });
    }

    return sendJson(res, 200, { model, updated: Object.keys(updates) });

  } catch (error) {
    console.error('[Underwriting] Update model error:', error);
    return sendJson(res, 500, { error: error.message });
  }
}

/**
 * POST /api/deals/:dealId/underwriting/calculate
 * Recalculate underwriting model
 */
export async function handleCalculateModel(req, res, dealId) {
  // Require authentication and org access
  const authUser = await requireDealOrgAccess(req, res, dealId);
  if (!authUser) return;

  const prisma = getPrisma();

  try {
    // Get current model
    const model = await prisma.underwritingModel.findUnique({ where: { dealId } });
    if (!model) {
      return sendJson(res, 404, { error: 'No underwriting model found' });
    }

    // Get deal profile for purchase price
    const dealProfile = await prisma.dealProfile.findUnique({ where: { dealId } });
    const profile = dealProfile ? JSON.parse(dealProfile.profile) : {};

    // Build inputs from model
    const inputs = {
      purchasePrice: profile.purchase_price,
      grossPotentialRent: model.grossPotentialRent,
      vacancyRate: model.vacancyRate || 0.05,
      otherIncome: model.otherIncome || 0,
      operatingExpenses: model.operatingExpenses,
      taxes: model.taxes,
      insurance: model.insurance,
      management: model.management,
      reserves: model.reserves,
      loanAmount: model.loanAmount,
      interestRate: model.interestRate,
      amortization: model.amortization || 30,
      loanTerm: model.loanTerm,
      exitCapRate: model.exitCapRate || 0.055,
      holdPeriod: model.holdPeriod || 5,
      rentGrowth: model.rentGrowth || 0.03,
      expenseGrowth: model.expenseGrowth || 0.02
    };

    // Calculate
    const calculated = calculateUnderwriting(inputs);

    // Update model with calculated values
    const updatedModel = await prisma.underwritingModel.update({
      where: { dealId },
      data: {
        effectiveGrossIncome: calculated.income.effectiveGrossIncome,
        netOperatingIncome: calculated.income.netOperatingIncome,
        annualDebtService: calculated.debtMetrics.annualDebtService,
        goingInCapRate: calculated.returns.goingInCapRate,
        cashOnCash: calculated.returns.cashOnCash,
        dscr: calculated.debtMetrics.dscr,
        irr: calculated.returns.irr,
        equityMultiple: calculated.returns.equityMultiple,
        lastCalculatedAt: new Date()
      }
    });

    // Detect conflicts
    const extractions = await prisma.documentExtraction.findMany({
      where: { dealId, status: 'EXTRACTED' }
    });

    const conflicts = detectAllConflicts(dealId, extractions, {
      goingInCapRate: calculated.returns.goingInCapRate,
      dscr: calculated.debtMetrics.dscr
    });

    // Store new conflicts
    for (const conflict of conflicts) {
      // Check if similar conflict already exists
      const existing = await prisma.underwritingConflict.findFirst({
        where: {
          dealId,
          fieldPath: conflict.fieldPath,
          conflictType: conflict.conflictType,
          status: 'OPEN'
        }
      });

      if (!existing) {
        await prisma.underwritingConflict.create({
          data: {
            ...conflict,
            status: 'OPEN'
          }
        });
      }
    }

    // Get updated conflicts
    const allConflicts = await prisma.underwritingConflict.findMany({
      where: { dealId },
      orderBy: { createdAt: 'desc' }
    });

    return sendJson(res, 200, {
      model: updatedModel,
      calculated,
      warnings: calculated.warnings,
      conflicts: allConflicts,
      conflictSummary: getConflictSummary(allConflicts)
    });

  } catch (error) {
    console.error('[Underwriting] Calculate error:', error);
    return sendJson(res, 500, { error: error.message });
  }
}

/**
 * GET /api/deals/:dealId/conflicts
 * List conflicts for a deal
 */
export async function handleListConflicts(req, res, dealId) {
  // Require authentication and org access
  const authUser = await requireDealOrgAccess(req, res, dealId);
  if (!authUser) return;

  const prisma = getPrisma();
  const url = new URL(req.url, `http://${req.headers.host}`);
  const status = url.searchParams.get('status'); // OPEN, RESOLVED, IGNORED, or null for all

  try {
    const where = { dealId };
    if (status) {
      where.status = status.toUpperCase();
    }

    const conflicts = await prisma.underwritingConflict.findMany({
      where,
      orderBy: [{ severity: 'asc' }, { createdAt: 'desc' }]
    });

    return sendJson(res, 200, {
      conflicts,
      summary: getConflictSummary(conflicts)
    });

  } catch (error) {
    console.error('[Underwriting] List conflicts error:', error);
    return sendJson(res, 500, { error: error.message });
  }
}

/**
 * POST /api/deals/:dealId/conflicts/:conflictId/resolve
 * Resolve a conflict
 */
export async function handleResolveConflict(req, res, dealId, conflictId) {
  // Require GP/Admin role for resolving conflicts
  const authUser = await requireGPWithDealAccess(req, res, dealId);
  if (!authUser) return;

  const prisma = getPrisma();
  const userId = authUser.id;
  const userName = authUser.name;

  try {
    let body = '';
    for await (const chunk of req) body += chunk;
    const { resolution, resolutionNote, action } = JSON.parse(body);

    // action: 'resolve' or 'ignore'
    const status = action === 'ignore' ? 'IGNORED' : 'RESOLVED';

    const conflict = await prisma.underwritingConflict.update({
      where: { id: conflictId },
      data: {
        status,
        resolution,
        resolvedBy: userId,
        resolvedByName: userName,
        resolvedAt: new Date(),
        resolutionNote
      }
    });

    return sendJson(res, 200, { conflict });

  } catch (error) {
    console.error('[Underwriting] Resolve conflict error:', error);
    return sendJson(res, 500, { error: error.message });
  }
}

/**
 * GET /api/deals/:dealId/scenarios
 * List scenarios for a deal
 */
export async function handleListScenarios(req, res, dealId) {
  // Require authentication and org access
  const authUser = await requireDealOrgAccess(req, res, dealId);
  if (!authUser) return;

  const prisma = getPrisma();

  try {
    const scenarios = await prisma.underwritingScenario.findMany({
      where: { dealId },
      orderBy: [{ isBaseCase: 'desc' }, { createdAt: 'asc' }]
    });

    return sendJson(res, 200, {
      scenarios: scenarios.map(s => ({
        ...s,
        assumptions: JSON.parse(s.assumptions || '{}'),
        results: s.results ? JSON.parse(s.results) : null
      }))
    });

  } catch (error) {
    console.error('[Underwriting] List scenarios error:', error);
    return sendJson(res, 500, { error: error.message });
  }
}

/**
 * POST /api/deals/:dealId/scenarios
 * Create a new scenario
 */
export async function handleCreateScenario(req, res, dealId) {
  // Require GP/Admin role for creating scenarios
  const authUser = await requireGPWithDealAccess(req, res, dealId);
  if (!authUser) return;

  const prisma = getPrisma();
  const userId = authUser.id;
  const userName = authUser.name;

  try {
    let body = '';
    for await (const chunk of req) body += chunk;
    const { name, description, assumptions, isBaseCase } = JSON.parse(body);

    if (!name) {
      return sendJson(res, 400, { error: 'Scenario name is required' });
    }

    // If this is base case, unset other base cases
    if (isBaseCase) {
      await prisma.underwritingScenario.updateMany({
        where: { dealId, isBaseCase: true },
        data: { isBaseCase: false }
      });
    }

    // Get base model for calculations
    const model = await prisma.underwritingModel.findUnique({ where: { dealId } });
    const dealProfile = await prisma.dealProfile.findUnique({ where: { dealId } });
    const profile = dealProfile ? JSON.parse(dealProfile.profile) : {};

    // Calculate scenario results
    const baseInputs = {
      purchasePrice: profile.purchase_price,
      grossPotentialRent: model?.grossPotentialRent,
      vacancyRate: model?.vacancyRate || 0.05,
      operatingExpenses: model?.operatingExpenses,
      loanAmount: model?.loanAmount,
      interestRate: model?.interestRate,
      amortization: model?.amortization || 30,
      exitCapRate: model?.exitCapRate || 0.055,
      holdPeriod: model?.holdPeriod || 5,
      rentGrowth: model?.rentGrowth || 0.03,
      expenseGrowth: model?.expenseGrowth || 0.02,
      ...assumptions
    };

    const calculated = calculateUnderwriting(baseInputs);

    const scenario = await prisma.underwritingScenario.create({
      data: {
        dealId,
        name,
        description,
        assumptions: JSON.stringify(assumptions || {}),
        results: JSON.stringify({
          irr: calculated.returns.irr,
          cashOnCash: calculated.returns.cashOnCash,
          dscr: calculated.debtMetrics.dscr,
          equityMultiple: calculated.returns.equityMultiple,
          goingInCapRate: calculated.returns.goingInCapRate
        }),
        isBaseCase: isBaseCase || false,
        createdBy: userId,
        createdByName: userName
      }
    });

    return sendJson(res, 201, {
      scenario: {
        ...scenario,
        assumptions: JSON.parse(scenario.assumptions),
        results: JSON.parse(scenario.results)
      }
    });

  } catch (error) {
    console.error('[Underwriting] Create scenario error:', error);
    return sendJson(res, 500, { error: error.message });
  }
}

/**
 * DELETE /api/deals/:dealId/scenarios/:scenarioId
 * Delete a scenario
 */
export async function handleDeleteScenario(req, res, dealId, scenarioId) {
  // Require GP/Admin role for deleting scenarios
  const authUser = await requireGPWithDealAccess(req, res, dealId);
  if (!authUser) return;

  const prisma = getPrisma();

  try {
    await prisma.underwritingScenario.delete({
      where: { id: scenarioId }
    });

    return sendJson(res, 200, { deleted: true });

  } catch (error) {
    console.error('[Underwriting] Delete scenario error:', error);
    return sendJson(res, 500, { error: error.message });
  }
}

/**
 * GET /api/deals/:dealId/scenarios/compare
 * Compare all scenarios
 */
export async function handleCompareScenarios(req, res, dealId) {
  // Require authentication and org access
  const authUser = await requireDealOrgAccess(req, res, dealId);
  if (!authUser) return;

  const prisma = getPrisma();

  try {
    const scenarios = await prisma.underwritingScenario.findMany({
      where: { dealId },
      orderBy: [{ isBaseCase: 'desc' }, { createdAt: 'asc' }]
    });

    const comparison = scenarios.map(s => ({
      name: s.name,
      isBaseCase: s.isBaseCase,
      results: s.results ? JSON.parse(s.results) : null
    }));

    return sendJson(res, 200, { comparison });

  } catch (error) {
    console.error('[Underwriting] Compare scenarios error:', error);
    return sendJson(res, 500, { error: error.message });
  }
}

/**
 * POST /api/deals/:dealId/memo/generate
 * Generate IC memo from model
 */
export async function handleGenerateMemo(req, res, dealId) {
  // Require GP/Admin role for generating memos
  const authUser = await requireGPWithDealAccess(req, res, dealId);
  if (!authUser) return;

  const prisma = getPrisma();
  const userId = authUser.id;
  const userName = authUser.name;

  try {
    let body = '';
    for await (const chunk of req) body += chunk;
    const { analystNotes } = JSON.parse(body || '{}');

    // Get model
    const model = await prisma.underwritingModel.findUnique({ where: { dealId } });
    if (!model) {
      return sendJson(res, 404, { error: 'No underwriting model found' });
    }

    // Get deal info
    const dealProfile = await prisma.dealProfile.findUnique({ where: { dealId } });
    const profile = dealProfile ? JSON.parse(dealProfile.profile) : {};
    const deal = { name: profile.name || 'Deal', profile };

    // Get scenarios
    const scenarios = await prisma.underwritingScenario.findMany({
      where: { dealId },
      orderBy: [{ isBaseCase: 'desc' }, { createdAt: 'asc' }]
    });

    // Get conflicts
    const conflicts = await prisma.underwritingConflict.findMany({
      where: { dealId },
      orderBy: { createdAt: 'desc' }
    });

    // Get inputs
    const inputs = await prisma.underwritingInput.findMany({
      where: { dealId, supersededAt: null },
      orderBy: { setAt: 'desc' }
    });

    // Format model for memo generator
    const modelForMemo = {
      inputs: {
        purchasePrice: profile.purchase_price,
        loanAmount: model.loanAmount,
        interestRate: model.interestRate,
        exitCapRate: model.exitCapRate,
        holdPeriod: model.holdPeriod,
        rentGrowth: model.rentGrowth,
        expenseGrowth: model.expenseGrowth
      },
      income: {
        grossPotentialRent: model.grossPotentialRent,
        vacancyLoss: model.grossPotentialRent ? model.grossPotentialRent * (model.vacancyRate || 0.05) : null,
        otherIncome: model.otherIncome,
        effectiveGrossIncome: model.effectiveGrossIncome,
        netOperatingIncome: model.netOperatingIncome
      },
      expenses: {
        totalOperating: model.operatingExpenses,
        expenseRatio: model.effectiveGrossIncome ? model.operatingExpenses / model.effectiveGrossIncome : null
      },
      returns: {
        goingInCapRate: model.goingInCapRate,
        cashOnCash: model.cashOnCash,
        irr: model.irr,
        equityMultiple: model.equityMultiple,
        equityRequired: profile.purchase_price && model.loanAmount ? profile.purchase_price - model.loanAmount : null
      },
      debtMetrics: {
        dscr: model.dscr,
        ltv: profile.purchase_price && model.loanAmount ? model.loanAmount / profile.purchase_price : null,
        annualDebtService: model.annualDebtService
      }
    };

    // Format scenarios for memo
    const scenariosForMemo = scenarios.map(s => ({
      name: s.name,
      isBaseCase: s.isBaseCase,
      results: s.results ? JSON.parse(s.results) : null
    }));

    // Generate memo
    const memoContent = generateMemo(deal, modelForMemo, scenariosForMemo, conflicts, analystNotes || {}, inputs);

    // Save or update memo
    let memo = await prisma.underwritingMemo.findUnique({ where: { dealId } });
    if (memo) {
      memo = await prisma.underwritingMemo.update({
        where: { dealId },
        data: {
          content: memoContent,
          recommendation: analystNotes?.recommendation,
          risks: analystNotes?.risks,
          generatedAt: new Date()
        }
      });
    } else {
      memo = await prisma.underwritingMemo.create({
        data: {
          dealId,
          content: memoContent,
          recommendation: analystNotes?.recommendation,
          risks: analystNotes?.risks,
          generatedAt: new Date(),
          status: 'DRAFT'
        }
      });
    }

    return sendJson(res, 200, { memo });

  } catch (error) {
    console.error('[Underwriting] Generate memo error:', error);
    return sendJson(res, 500, { error: error.message });
  }
}

/**
 * GET /api/deals/:dealId/memo
 * Get current memo
 */
export async function handleGetMemo(req, res, dealId) {
  // Require authentication and org access
  const authUser = await requireDealOrgAccess(req, res, dealId);
  if (!authUser) return;

  const prisma = getPrisma();

  try {
    const memo = await prisma.underwritingMemo.findUnique({ where: { dealId } });

    if (!memo) {
      return sendJson(res, 404, { error: 'No memo found' });
    }

    return sendJson(res, 200, { memo });

  } catch (error) {
    console.error('[Underwriting] Get memo error:', error);
    return sendJson(res, 500, { error: error.message });
  }
}

/**
 * PATCH /api/deals/:dealId/memo
 * Update memo (analyst edits)
 */
export async function handleUpdateMemo(req, res, dealId) {
  // Require GP/Admin role for updating memos
  const authUser = await requireGPWithDealAccess(req, res, dealId);
  if (!authUser) return;

  const prisma = getPrisma();
  const userId = authUser.id;
  const userName = authUser.name;

  try {
    let body = '';
    for await (const chunk of req) body += chunk;
    const { content, recommendation, risks, status } = JSON.parse(body);

    const updates = {};
    if (content !== undefined) updates.content = content;
    if (recommendation !== undefined) updates.recommendation = recommendation;
    if (risks !== undefined) updates.risks = risks;
    if (status !== undefined) updates.status = status;
    updates.editedAt = new Date();
    updates.editedBy = userId;
    updates.editedByName = userName;

    const memo = await prisma.underwritingMemo.update({
      where: { dealId },
      data: updates
    });

    return sendJson(res, 200, { memo });

  } catch (error) {
    console.error('[Underwriting] Update memo error:', error);
    return sendJson(res, 500, { error: error.message });
  }
}

/**
 * POST /api/deals/:dealId/underwriting/apply-extraction
 * Apply extracted data to underwriting model
 */
export async function handleApplyExtraction(req, res, dealId) {
  // Require GP/Admin role for applying extractions
  const authUser = await requireGPWithDealAccess(req, res, dealId);
  if (!authUser) return;

  const prisma = getPrisma();
  const userId = authUser.id;
  const userName = authUser.name;

  try {
    let body = '';
    for await (const chunk of req) body += chunk;
    const { extractionId, fields } = JSON.parse(body);

    const extraction = await prisma.documentExtraction.findUnique({
      where: { id: extractionId }
    });

    if (!extraction || extraction.dealId !== dealId) {
      return sendJson(res, 404, { error: 'Extraction not found' });
    }

    const extractedData = JSON.parse(extraction.extractedData);

    // Map extraction data to model fields based on document type
    let modelUpdates = {};
    let appliedFields = [];

    switch (extraction.documentType) {
      case 'RENT_ROLL':
        if (!fields || fields.includes('grossPotentialRent')) {
          modelUpdates.grossPotentialRent = extractedData.summary?.totalAnnualRent;
          appliedFields.push('grossPotentialRent');
        }
        if (!fields || fields.includes('vacancyRate')) {
          modelUpdates.vacancyRate = 1 - (extractedData.summary?.occupancyRate || 0.95);
          appliedFields.push('vacancyRate');
        }
        break;

      case 'T12':
        const t12Mapping = mapT12ToUnderwritingModel(extractedData);
        for (const [key, value] of Object.entries(t12Mapping)) {
          if (value !== null && (!fields || fields.includes(key))) {
            modelUpdates[key] = value;
            appliedFields.push(key);
          }
        }
        break;

      case 'LOAN_TERMS':
        const loanMapping = mapLoanTermsToUnderwritingModel(extractedData);
        for (const [key, value] of Object.entries(loanMapping)) {
          if (value !== null && (!fields || fields.includes(key))) {
            modelUpdates[key] = value;
            appliedFields.push(key);
          }
        }
        break;
    }

    // Update model
    if (Object.keys(modelUpdates).length > 0) {
      await prisma.underwritingModel.upsert({
        where: { dealId },
        create: { dealId, ...modelUpdates },
        update: modelUpdates
      });

      // Track inputs with full provenance
      for (const field of appliedFields) {
        await prisma.underwritingInput.updateMany({
          where: { dealId, fieldPath: field, supersededAt: null },
          data: { supersededAt: new Date() }
        });

        await prisma.underwritingInput.create({
          data: {
            dealId,
            fieldPath: field,
            value: JSON.stringify(modelUpdates[field]),
            sourceType: 'AI_EXTRACTION',
            source: extraction.documentType,
            sourceId: extraction.id,
            documentId: extraction.artifactId,
            documentName: extraction.artifactId, // Will be filename if available
            aiModel: 'gpt-4o', // The model used for extraction
            aiConfidence: extraction.confidence,
            sourceDocId: extraction.artifactId,
            confidence: extraction.confidence,
            setBy: userId,
            setByName: userName,
            rationale: `Applied from ${extraction.documentType} extraction`
          }
        });
      }

      // Mark extraction as applied
      await prisma.documentExtraction.update({
        where: { id: extractionId },
        data: { status: 'APPLIED' }
      });
    }

    return sendJson(res, 200, {
      applied: appliedFields,
      modelUpdates
    });

  } catch (error) {
    console.error('[Underwriting] Apply extraction error:', error);
    return sendJson(res, 500, { error: error.message });
  }
}

/**
 * GET /api/deals/:dealId/inputs/:fieldPath/history
 * Get full provenance history for a specific input field
 */
export async function handleGetInputHistory(req, res, dealId, fieldPath) {
  // Require authentication and org access
  const authUser = await requireDealOrgAccess(req, res, dealId);
  if (!authUser) return;

  const prisma = getPrisma();

  try {
    // Get all inputs for this field, including superseded ones
    const inputs = await prisma.underwritingInput.findMany({
      where: { dealId, fieldPath },
      orderBy: { setAt: 'desc' }
    });

    // Format for display
    const history = inputs.map(input => ({
      id: input.id,
      value: JSON.parse(input.value),

      // Source info
      sourceType: input.sourceType,
      source: input.source,
      sourceId: input.sourceId,

      // Document details
      documentId: input.documentId,
      documentName: input.documentName,
      documentPage: input.documentPage,
      documentCell: input.documentCell,

      // AI details
      aiModel: input.aiModel,
      aiConfidence: input.aiConfidence,

      // Human details
      setBy: input.setBy,
      setByName: input.setByName,
      rationale: input.rationale,

      // Calculation details
      formula: input.formula,
      inputFields: input.inputFields ? JSON.parse(input.inputFields) : null,

      // Timestamps
      setAt: input.setAt,
      supersededAt: input.supersededAt,

      // Verification
      verifiedBy: input.verifiedBy,
      verifiedByName: input.verifiedByName,
      verifiedAt: input.verifiedAt,

      // Status
      isCurrent: !input.supersededAt
    }));

    // Get current value
    const current = history.find(h => h.isCurrent);

    return sendJson(res, 200, {
      fieldPath,
      currentValue: current?.value,
      currentSource: current?.sourceType,
      history,
      totalChanges: history.length
    });

  } catch (error) {
    console.error('[Underwriting] Get input history error:', error);
    return sendJson(res, 500, { error: error.message });
  }
}

/**
 * GET /api/deals/:dealId/inputs/provenance
 * Get provenance summary for all current inputs
 */
export async function handleGetProvenanceSummary(req, res, dealId) {
  // Require authentication and org access
  const authUser = await requireDealOrgAccess(req, res, dealId);
  if (!authUser) return;

  const prisma = getPrisma();

  try {
    // Get all current (non-superseded) inputs
    const inputs = await prisma.underwritingInput.findMany({
      where: { dealId, supersededAt: null },
      orderBy: { fieldPath: 'asc' }
    });

    // Group by source type
    const bySourceType = {};
    const fields = {};

    for (const input of inputs) {
      // Track by source type
      if (!bySourceType[input.sourceType]) {
        bySourceType[input.sourceType] = [];
      }
      bySourceType[input.sourceType].push(input.fieldPath);

      // Track field details
      fields[input.fieldPath] = {
        value: JSON.parse(input.value),
        sourceType: input.sourceType,
        source: input.source,
        documentName: input.documentName,
        documentCell: input.documentCell,
        aiModel: input.aiModel,
        aiConfidence: input.aiConfidence,
        setBy: input.setBy,
        setByName: input.setByName,
        setAt: input.setAt,
        verified: !!input.verifiedAt
      };
    }

    // Calculate summary stats
    const summary = {
      totalFields: inputs.length,
      bySourceType: Object.fromEntries(
        Object.entries(bySourceType).map(([type, fields]) => [type, fields.length])
      ),
      verified: inputs.filter(i => i.verifiedAt).length,
      unverified: inputs.filter(i => !i.verifiedAt).length,
      fromDocuments: inputs.filter(i => i.documentId).length,
      fromAI: inputs.filter(i => i.sourceType === 'AI_EXTRACTION').length,
      fromExcel: inputs.filter(i => i.sourceType === 'EXCEL_IMPORT').length,
      manual: inputs.filter(i => i.sourceType === 'HUMAN_ENTRY').length,
      calculated: inputs.filter(i => i.sourceType === 'CALCULATION').length
    };

    return sendJson(res, 200, {
      summary,
      fields,
      bySourceType
    });

  } catch (error) {
    console.error('[Underwriting] Get provenance summary error:', error);
    return sendJson(res, 500, { error: error.message });
  }
}

/**
 * POST /api/deals/:dealId/inputs/:fieldPath/verify
 * Mark an input as verified by a user
 */
export async function handleVerifyInput(req, res, dealId, fieldPath) {
  // Require GP/Admin role for verifying inputs
  const authUser = await requireGPWithDealAccess(req, res, dealId);
  if (!authUser) return;

  const prisma = getPrisma();
  const userId = authUser.id;
  const userName = authUser.name;

  try {
    // Find current input
    const input = await prisma.underwritingInput.findFirst({
      where: { dealId, fieldPath, supersededAt: null }
    });

    if (!input) {
      return sendJson(res, 404, { error: 'Input not found' });
    }

    // Update with verification
    const updated = await prisma.underwritingInput.update({
      where: { id: input.id },
      data: {
        verifiedBy: userId,
        verifiedByName: userName,
        verifiedAt: new Date()
      }
    });

    return sendJson(res, 200, {
      fieldPath,
      verified: true,
      verifiedBy: userName,
      verifiedAt: updated.verifiedAt
    });

  } catch (error) {
    console.error('[Underwriting] Verify input error:', error);
    return sendJson(res, 500, { error: error.message });
  }
}

/**
 * GET /api/deals/:dealId/underwriting/cash-flows
 * Get detailed year-by-year cash flow projection
 */
export async function handleGetCashFlows(req, res, dealId) {
  // Require authentication and org access
  const authUser = await requireDealOrgAccess(req, res, dealId);
  if (!authUser) return;

  const prisma = getPrisma();
  const url = new URL(req.url, 'http://localhost');
  const yearsParam = url.searchParams.get('years');

  try {
    // Get current model
    const model = await prisma.underwritingModel.findUnique({ where: { dealId } });
    if (!model) {
      return sendJson(res, 404, { error: 'No underwriting model found' });
    }

    // Get deal profile for purchase price
    const dealProfile = await prisma.dealProfile.findUnique({ where: { dealId } });
    const profile = dealProfile ? JSON.parse(dealProfile.profile) : {};

    // Build full model inputs
    const modelInputs = {
      purchasePrice: profile.purchase_price,
      grossPotentialRent: model.grossPotentialRent,
      vacancyRate: model.vacancyRate || 0.05,
      otherIncome: model.otherIncome || 0,
      operatingExpenses: model.operatingExpenses,
      taxes: model.taxes,
      insurance: model.insurance,
      management: model.management,
      reserves: model.reserves,
      loanAmount: model.loanAmount,
      interestRate: model.interestRate,
      amortization: model.amortization || 30,
      loanTerm: model.loanTerm,
      ioPeriod: model.ioPeriod || 0,
      exitCapRate: model.exitCapRate || 0.055,
      holdPeriod: model.holdPeriod || 5,
      rentGrowth: model.rentGrowth || 0.03,
      expenseGrowth: model.expenseGrowth || 0.02
    };

    // Override hold period if specified
    const years = yearsParam ? parseInt(yearsParam) : null;

    // Project detailed cash flows
    const cashFlows = projectDetailedCashFlows(modelInputs, years);

    return sendJson(res, 200, {
      dealId,
      model: {
        id: model.id,
        status: model.status,
        lastCalculatedAt: model.lastCalculatedAt
      },
      cashFlows
    });

  } catch (error) {
    console.error('[Underwriting] Cash flows error:', error);
    return sendJson(res, 500, { error: error.message });
  }
}

/**
 * POST /api/deals/:dealId/underwriting/cash-flows/scenario
 * Get cash flows for a specific scenario (with modified assumptions)
 */
export async function handleGetScenarioCashFlows(req, res, dealId) {
  // Require authentication and org access
  const authUser = await requireDealOrgAccess(req, res, dealId);
  if (!authUser) return;

  const prisma = getPrisma();

  try {
    let body = '';
    for await (const chunk of req) body += chunk;
    const { assumptions } = JSON.parse(body || '{}');

    // Get current model
    const model = await prisma.underwritingModel.findUnique({ where: { dealId } });
    if (!model) {
      return sendJson(res, 404, { error: 'No underwriting model found' });
    }

    // Get deal profile for purchase price
    const dealProfile = await prisma.dealProfile.findUnique({ where: { dealId } });
    const profile = dealProfile ? JSON.parse(dealProfile.profile) : {};

    // Build model inputs with scenario overrides
    const modelInputs = {
      purchasePrice: profile.purchase_price,
      grossPotentialRent: model.grossPotentialRent,
      vacancyRate: model.vacancyRate || 0.05,
      otherIncome: model.otherIncome || 0,
      operatingExpenses: model.operatingExpenses,
      taxes: model.taxes,
      insurance: model.insurance,
      management: model.management,
      reserves: model.reserves,
      loanAmount: model.loanAmount,
      interestRate: model.interestRate,
      amortization: model.amortization || 30,
      loanTerm: model.loanTerm,
      ioPeriod: model.ioPeriod || 0,
      exitCapRate: model.exitCapRate || 0.055,
      holdPeriod: model.holdPeriod || 5,
      rentGrowth: model.rentGrowth || 0.03,
      expenseGrowth: model.expenseGrowth || 0.02,
      // Apply scenario overrides
      ...assumptions
    };

    // Project detailed cash flows
    const cashFlows = projectDetailedCashFlows(modelInputs);

    return sendJson(res, 200, {
      dealId,
      assumptions,
      cashFlows
    });

  } catch (error) {
    console.error('[Underwriting] Scenario cash flows error:', error);
    return sendJson(res, 500, { error: error.message });
  }
}

// ========== WATERFALL ENDPOINTS (Sprint 3) ==========

/**
 * GET /api/deals/:dealId/waterfall
 * Get waterfall structure for a deal
 */
export async function handleGetWaterfall(req, res, dealId) {
  // Require authentication and org access
  const authUser = await requireDealOrgAccess(req, res, dealId);
  if (!authUser) return;

  const prisma = getPrisma();

  try {
    let structure = await prisma.waterfallStructure.findUnique({
      where: { dealId },
      include: {
        distributions: {
          orderBy: { calculatedAt: 'desc' },
          take: 1
        }
      }
    });

    if (!structure) {
      // Return empty structure with defaults
      return sendJson(res, 200, {
        structure: null,
        hasStructure: false,
        defaults: {
          preferredReturn: 0.08,
          promoteTiers: [
            { hurdle: 0.12, lpSplit: 0.80, gpSplit: 0.20 },
            { hurdle: 0.15, lpSplit: 0.70, gpSplit: 0.30 },
            { hurdle: 0.20, lpSplit: 0.60, gpSplit: 0.40 },
            { hurdle: Infinity, lpSplit: 0.50, gpSplit: 0.50 }
          ],
          gpCatchUp: true,
          catchUpPercent: 1.0,
          lookback: false
        }
      });
    }

    // Parse promote tiers
    const parsedStructure = {
      ...structure,
      promoteTiers: JSON.parse(structure.promoteTiers || '[]')
    };

    // Get latest distribution if exists
    const latestDistribution = structure.distributions[0];
    const parsedDistribution = latestDistribution ? {
      ...latestDistribution,
      yearlyDistributions: JSON.parse(latestDistribution.yearlyDistributions || '[]')
    } : null;

    return sendJson(res, 200, {
      structure: parsedStructure,
      hasStructure: true,
      latestDistribution: parsedDistribution
    });

  } catch (error) {
    console.error('[Waterfall] Get structure error:', error);
    return sendJson(res, 500, { error: error.message });
  }
}

/**
 * POST /api/deals/:dealId/waterfall
 * Create or update waterfall structure
 */
export async function handleCreateWaterfall(req, res, dealId) {
  // Require GP/Admin role for creating waterfall structure
  const authUser = await requireGPWithDealAccess(req, res, dealId);
  if (!authUser) return;

  const prisma = getPrisma();
  const userId = authUser.id;
  const userName = authUser.name;

  try {
    let body = '';
    for await (const chunk of req) body += chunk;
    const { lpEquity, gpEquity, preferredReturn, promoteTiers, gpCatchUp, catchUpPercent, lookback } = JSON.parse(body);

    if (!lpEquity || lpEquity <= 0) {
      return sendJson(res, 400, { error: 'LP equity must be greater than 0' });
    }

    const data = {
      lpEquity,
      gpEquity: gpEquity || 0,
      preferredReturn: preferredReturn || 0.08,
      promoteTiers: JSON.stringify(promoteTiers || [
        { hurdle: 0.12, lpSplit: 0.80, gpSplit: 0.20 },
        { hurdle: Infinity, lpSplit: 0.50, gpSplit: 0.50 }
      ]),
      gpCatchUp: gpCatchUp !== false,
      catchUpPercent: catchUpPercent || 1.0,
      lookback: lookback || false,
      createdBy: userId,
      createdByName: userName
    };

    const structure = await prisma.waterfallStructure.upsert({
      where: { dealId },
      create: { dealId, ...data },
      update: data
    });

    return sendJson(res, 201, {
      structure: {
        ...structure,
        promoteTiers: JSON.parse(structure.promoteTiers)
      }
    });

  } catch (error) {
    console.error('[Waterfall] Create structure error:', error);
    return sendJson(res, 500, { error: error.message });
  }
}

/**
 * PATCH /api/deals/:dealId/waterfall
 * Update waterfall structure
 */
export async function handleUpdateWaterfall(req, res, dealId) {
  // Require GP/Admin role for updating waterfall structure
  const authUser = await requireGPWithDealAccess(req, res, dealId);
  if (!authUser) return;

  const prisma = getPrisma();

  try {
    let body = '';
    for await (const chunk of req) body += chunk;
    const updates = JSON.parse(body);

    const existing = await prisma.waterfallStructure.findUnique({ where: { dealId } });
    if (!existing) {
      return sendJson(res, 404, { error: 'No waterfall structure found' });
    }

    // Prepare updates
    const data = {};
    if (updates.lpEquity !== undefined) data.lpEquity = updates.lpEquity;
    if (updates.gpEquity !== undefined) data.gpEquity = updates.gpEquity;
    if (updates.preferredReturn !== undefined) data.preferredReturn = updates.preferredReturn;
    if (updates.promoteTiers !== undefined) data.promoteTiers = JSON.stringify(updates.promoteTiers);
    if (updates.gpCatchUp !== undefined) data.gpCatchUp = updates.gpCatchUp;
    if (updates.catchUpPercent !== undefined) data.catchUpPercent = updates.catchUpPercent;
    if (updates.lookback !== undefined) data.lookback = updates.lookback;
    if (updates.usePerClassWaterfall !== undefined) {
      if (typeof updates.usePerClassWaterfall !== 'boolean') {
        console.log(`[Waterfall] Invalid usePerClassWaterfall value`, {
          dealId,
          providedValue: updates.usePerClassWaterfall,
          type: typeof updates.usePerClassWaterfall
        });
        return sendJson(res, 400, { error: 'usePerClassWaterfall must be a boolean' });
      }
      data.usePerClassWaterfall = updates.usePerClassWaterfall;
      console.log(`[Waterfall] Per-class flag changing`, {
        dealId,
        oldValue: existing.usePerClassWaterfall,
        newValue: updates.usePerClassWaterfall,
        userId: authUser.id
      });
    }

    const structure = await prisma.waterfallStructure.update({
      where: { dealId },
      data
    });

    // Log flag change for audit trail
    if (updates.usePerClassWaterfall !== undefined &&
        updates.usePerClassWaterfall !== existing.usePerClassWaterfall) {
      console.log(`[Waterfall] Per-class flag CHANGED and recorded`, {
        dealId,
        oldValue: existing.usePerClassWaterfall,
        newValue: structure.usePerClassWaterfall,
        changedBy: authUser.id
      });
    }

    return sendJson(res, 200, {
      structure: {
        ...structure,
        promoteTiers: JSON.parse(structure.promoteTiers)
      }
    });

  } catch (error) {
    console.error('[Waterfall] Update structure error:', error);
    return sendJson(res, 500, { error: error.message });
  }
}

/**
 * POST /api/deals/:dealId/waterfall/calculate
 * Calculate waterfall distributions from cash flows
 *
 * Body: { scenarioId?, usePerClassWaterfall?: boolean }
 *
 * When usePerClassWaterfall=true:
 * - Fetches LP actors with share class data
 * - Uses per-class preferred returns (different classes can have different pref rates)
 * - Processes classes in priority order (priority 1 paid first)
 * - Returns per-class breakdown in response
 */
export async function handleCalculateWaterfall(req, res, dealId) {
  // Require authentication and org access
  const authUser = await requireDealOrgAccess(req, res, dealId);
  if (!authUser) return;

  const prisma = getPrisma();

  try {
    let body = '';
    for await (const chunk of req) body += chunk;
    const { scenarioId, usePerClassWaterfall } = JSON.parse(body || '{}');

    console.log(`[Waterfall] Calculate request for deal ${dealId}`, {
      scenarioId,
      usePerClassWaterfall: !!usePerClassWaterfall
    });

    // Get waterfall structure
    const structure = await prisma.waterfallStructure.findUnique({ where: { dealId } });
    if (!structure) {
      return sendJson(res, 404, { error: 'No waterfall structure found. Create one first.' });
    }

    // Get underwriting model
    const model = await prisma.underwritingModel.findUnique({ where: { dealId } });
    if (!model) {
      return sendJson(res, 404, { error: 'No underwriting model found' });
    }

    // Get deal profile for purchase price
    const dealProfile = await prisma.dealProfile.findUnique({ where: { dealId } });
    const profile = dealProfile ? JSON.parse(dealProfile.profile) : {};

    // Get scenario overrides if specified
    let assumptions = {};
    if (scenarioId) {
      const scenario = await prisma.underwritingScenario.findUnique({ where: { id: scenarioId } });
      if (scenario) {
        assumptions = JSON.parse(scenario.assumptions || '{}');
      }
    }

    // Build model inputs
    const modelInputs = {
      purchasePrice: profile.purchase_price,
      grossPotentialRent: model.grossPotentialRent,
      vacancyRate: model.vacancyRate || 0.05,
      otherIncome: model.otherIncome || 0,
      operatingExpenses: model.operatingExpenses,
      taxes: model.taxes,
      insurance: model.insurance,
      management: model.management,
      reserves: model.reserves,
      loanAmount: model.loanAmount,
      interestRate: model.interestRate,
      amortization: model.amortization || 30,
      loanTerm: model.loanTerm,
      ioPeriod: model.ioPeriod || 0,
      exitCapRate: model.exitCapRate || 0.055,
      holdPeriod: model.holdPeriod || 5,
      rentGrowth: model.rentGrowth || 0.03,
      expenseGrowth: model.expenseGrowth || 0.02,
      ...assumptions
    };

    // Get detailed cash flows
    const cashFlowProjection = projectDetailedCashFlows(modelInputs);

    // Extract cash flows array (operating + exit in final year)
    const cashFlows = cashFlowProjection.years.map((y, idx) => {
      if (idx === cashFlowProjection.years.length - 1) {
        // Last year: add exit proceeds
        return y.beforeTaxCashFlow + (cashFlowProjection.exit?.netEquityProceeds || 0);
      }
      return y.beforeTaxCashFlow;
    });

    // Parse waterfall structure
    const waterfallStructure = {
      lpEquity: structure.lpEquity,
      gpEquity: structure.gpEquity,
      preferredReturn: structure.preferredReturn,
      promoteTiers: JSON.parse(structure.promoteTiers),
      gpCatchUp: structure.gpCatchUp,
      catchUpPercent: structure.catchUpPercent,
      lookback: structure.lookback
    };

    // Build options for per-class waterfall calculation
    let waterfallOptions = {};

    if (usePerClassWaterfall) {
      // Fetch LP actors with share class data for per-class calculation
      const lpActors = await prisma.lPActor.findMany({
        where: { dealId, status: 'ACTIVE' },
        include: {
          shareClass: {
            select: {
              id: true,
              code: true,
              name: true,
              preferredReturn: true,
              managementFee: true,
              carryPercent: true,
              priority: true
            }
          }
        }
      });

      console.log(`[Waterfall] Per-class mode enabled, found ${lpActors.length} LP actors`);

      if (lpActors.length > 0) {
        // Transform LP actors to the format expected by groupLPsByClassPriority
        const lpOwnership = lpActors.map(lp => ({
          lpActorId: lp.id,
          entityName: lp.entityName,
          ownershipPct: lp.ownershipPct || 0,
          commitment: lp.commitment || 0,
          capitalContributed: lp.capitalContributed || 0,
          shareClass: lp.shareClass
        }));

        // Group LPs by class priority
        const perClassConfig = groupLPsByClassPriority(lpOwnership);

        // Check if we have multiple classes with different terms
        const hasMultipleClasses = perClassConfig.size > 1;
        const hasDifferentTerms = Array.from(perClassConfig.values())
          .some(c => c.class.preferredReturn !== null && c.class.preferredReturn !== undefined);

        console.log(`[Waterfall] Class analysis:`, {
          classCount: perClassConfig.size,
          hasMultipleClasses,
          hasDifferentTerms,
          classes: Array.from(perClassConfig.entries()).map(([p, d]) => ({
            priority: p,
            code: d.class.code,
            lpCount: d.lps.length,
            prefReturn: d.class.preferredReturn
          }))
        });

        if (hasMultipleClasses || hasDifferentTerms) {
          waterfallOptions = {
            useClassTerms: true,
            perClassConfig
          };
        }
      }
    }

    // Calculate waterfall (standard or per-class based on options)
    const waterfallResult = calculateWaterfall(cashFlows, waterfallStructure, waterfallOptions);

    if (waterfallResult.error) {
      return sendJson(res, 400, { error: waterfallResult.error });
    }

    // Store distribution
    const distribution = await prisma.waterfallDistribution.create({
      data: {
        dealId,
        scenarioId,
        structureId: structure.id,
        yearlyDistributions: JSON.stringify(waterfallResult.yearlyDistributions),
        lpIRR: waterfallResult.summary.lpIRR,
        gpIRR: waterfallResult.summary.gpIRR,
        lpEquityMultiple: waterfallResult.summary.lpEquityMultiple,
        gpEquityMultiple: waterfallResult.summary.gpEquityMultiple,
        totalPromote: waterfallResult.summary.totalPromote,
        lpTotalReturn: waterfallResult.summary.lpTotalReturn,
        gpTotalReturn: waterfallResult.summary.gpTotalReturn
      }
    });

    // Format for display
    const formatted = formatWaterfallForDisplay(waterfallResult);

    // Build response
    const response = {
      distribution: {
        id: distribution.id,
        ...formatted
      },
      cashFlowsUsed: cashFlows,
      scenarioId
    };

    // Include per-class breakdown if available
    if (waterfallResult.byClass) {
      response.byClass = waterfallResult.byClass;
      response.perClassTerms = waterfallResult.structure?.perClassTerms;
      console.log(`[Waterfall] Per-class results included:`, Object.keys(waterfallResult.byClass));
    }

    return sendJson(res, 200, response);

  } catch (error) {
    console.error('[Waterfall] Calculate error:', error);
    return sendJson(res, 500, { error: error.message });
  }
}

/**
 * GET /api/deals/:dealId/waterfall/distributions
 * List all waterfall distributions for a deal
 */
export async function handleListWaterfallDistributions(req, res, dealId) {
  // Require authentication and org access
  const authUser = await requireDealOrgAccess(req, res, dealId);
  if (!authUser) return;

  const prisma = getPrisma();

  try {
    const distributions = await prisma.waterfallDistribution.findMany({
      where: { dealId },
      orderBy: { calculatedAt: 'desc' },
      include: {
        structure: true
      }
    });

    return sendJson(res, 200, {
      distributions: distributions.map(d => ({
        id: d.id,
        scenarioId: d.scenarioId,
        lpIRR: d.lpIRR,
        gpIRR: d.gpIRR,
        lpEquityMultiple: d.lpEquityMultiple,
        gpEquityMultiple: d.gpEquityMultiple,
        totalPromote: d.totalPromote,
        lpTotalReturn: d.lpTotalReturn,
        gpTotalReturn: d.gpTotalReturn,
        calculatedAt: d.calculatedAt,
        yearlyDistributions: JSON.parse(d.yearlyDistributions)
      }))
    });

  } catch (error) {
    console.error('[Waterfall] List distributions error:', error);
    return sendJson(res, 500, { error: error.message });
  }
}

/**
 * POST /api/deals/:dealId/waterfall/compare
 * Compare waterfall across all scenarios
 */
export async function handleCompareWaterfalls(req, res, dealId) {
  // Require authentication and org access
  const authUser = await requireDealOrgAccess(req, res, dealId);
  if (!authUser) return;

  const prisma = getPrisma();

  try {
    // Get waterfall structure
    const structure = await prisma.waterfallStructure.findUnique({ where: { dealId } });
    if (!structure) {
      return sendJson(res, 404, { error: 'No waterfall structure found' });
    }

    // Get all scenarios
    const scenarios = await prisma.underwritingScenario.findMany({
      where: { dealId },
      orderBy: [{ isBaseCase: 'desc' }, { createdAt: 'asc' }]
    });

    // Get underwriting model
    const model = await prisma.underwritingModel.findUnique({ where: { dealId } });
    const dealProfile = await prisma.dealProfile.findUnique({ where: { dealId } });
    const profile = dealProfile ? JSON.parse(dealProfile.profile) : {};

    // Build base inputs
    const baseInputs = {
      purchasePrice: profile.purchase_price,
      grossPotentialRent: model?.grossPotentialRent,
      vacancyRate: model?.vacancyRate || 0.05,
      otherIncome: model?.otherIncome || 0,
      operatingExpenses: model?.operatingExpenses,
      taxes: model?.taxes,
      insurance: model?.insurance,
      management: model?.management,
      reserves: model?.reserves,
      loanAmount: model?.loanAmount,
      interestRate: model?.interestRate,
      amortization: model?.amortization || 30,
      loanTerm: model?.loanTerm,
      ioPeriod: model?.ioPeriod || 0,
      exitCapRate: model?.exitCapRate || 0.055,
      holdPeriod: model?.holdPeriod || 5,
      rentGrowth: model?.rentGrowth || 0.03,
      expenseGrowth: model?.expenseGrowth || 0.02
    };

    // Calculate cash flows for each scenario
    const scenarioCashFlows = [];

    // Add base case
    const baseCashFlowProjection = projectDetailedCashFlows(baseInputs);
    const baseCashFlows = baseCashFlowProjection.years.map((y, idx) => {
      if (idx === baseCashFlowProjection.years.length - 1) {
        return y.beforeTaxCashFlow + (baseCashFlowProjection.exit?.netEquityProceeds || 0);
      }
      return y.beforeTaxCashFlow;
    });
    scenarioCashFlows.push({ name: 'Base Case', cashFlows: baseCashFlows });

    // Add other scenarios
    for (const scenario of scenarios) {
      if (scenario.isBaseCase) continue; // Skip duplicate base case

      const scenarioAssumptions = JSON.parse(scenario.assumptions || '{}');
      const scenarioInputs = { ...baseInputs, ...scenarioAssumptions };
      const cfProjection = projectDetailedCashFlows(scenarioInputs);
      const cfs = cfProjection.years.map((y, idx) => {
        if (idx === cfProjection.years.length - 1) {
          return y.beforeTaxCashFlow + (cfProjection.exit?.netEquityProceeds || 0);
        }
        return y.beforeTaxCashFlow;
      });
      scenarioCashFlows.push({ name: scenario.name, cashFlows: cfs });
    }

    // Parse waterfall structure
    const waterfallStructure = {
      lpEquity: structure.lpEquity,
      gpEquity: structure.gpEquity,
      preferredReturn: structure.preferredReturn,
      promoteTiers: JSON.parse(structure.promoteTiers),
      gpCatchUp: structure.gpCatchUp,
      catchUpPercent: structure.catchUpPercent,
      lookback: structure.lookback
    };

    // Compare across scenarios
    const comparison = compareWaterfallScenarios(scenarioCashFlows, waterfallStructure);

    return sendJson(res, 200, {
      comparison,
      structure: {
        ...structure,
        promoteTiers: JSON.parse(structure.promoteTiers)
      }
    });

  } catch (error) {
    console.error('[Waterfall] Compare error:', error);
    return sendJson(res, 500, { error: error.message });
  }
}

// ========== SENSITIVITY ENDPOINTS (Sprint 4) ==========

/**
 * GET /api/deals/:dealId/sensitivity/options
 * Get available fields and metrics for sensitivity analysis
 */
export async function handleGetSensitivityOptions(req, res, dealId) {
  // Require authentication and org access
  const authUser = await requireDealOrgAccess(req, res, dealId);
  if (!authUser) return;

  try {
    const options = getSensitivityOptions();
    return sendJson(res, 200, options);
  } catch (error) {
    console.error('[Sensitivity] Get options error:', error);
    return sendJson(res, 500, { error: error.message });
  }
}

/**
 * POST /api/deals/:dealId/sensitivity/matrix
 * Calculate a 2D sensitivity matrix
 */
export async function handleCalculateSensitivityMatrix(req, res, dealId) {
  // Require authentication and org access
  const authUser = await requireDealOrgAccess(req, res, dealId);
  if (!authUser) return;

  const prisma = getPrisma();

  try {
    let body = '';
    for await (const chunk of req) body += chunk;
    const { xField, yField, outputMetric, xRange, yRange } = JSON.parse(body);

    // Validate required fields
    if (!xField || !yField || !outputMetric) {
      return sendJson(res, 400, { error: 'Missing required fields: xField, yField, outputMetric' });
    }

    // Get underwriting model
    const model = await prisma.underwritingModel.findUnique({ where: { dealId } });
    if (!model) {
      return sendJson(res, 404, { error: 'No underwriting model found' });
    }

    // Get deal profile for purchase price
    const dealProfile = await prisma.dealProfile.findUnique({ where: { dealId } });
    const profile = dealProfile ? JSON.parse(dealProfile.profile) : {};

    // Build model inputs
    const modelInputs = {
      purchasePrice: profile.purchase_price,
      grossPotentialRent: model.grossPotentialRent,
      vacancyRate: model.vacancyRate || 0.05,
      otherIncome: model.otherIncome || 0,
      operatingExpenses: model.operatingExpenses,
      taxes: model.taxes,
      insurance: model.insurance,
      management: model.management,
      reserves: model.reserves,
      loanAmount: model.loanAmount,
      interestRate: model.interestRate,
      amortization: model.amortization || 30,
      loanTerm: model.loanTerm,
      exitCapRate: model.exitCapRate || 0.055,
      holdPeriod: model.holdPeriod || 5,
      rentGrowth: model.rentGrowth || 0.03,
      expenseGrowth: model.expenseGrowth || 0.02
    };

    // Calculate sensitivity matrix
    const matrix = calculateSensitivityMatrix(modelInputs, xField, yField, outputMetric, {
      xRange,
      yRange
    });

    // Add colors to matrix cells
    for (const row of matrix.matrix) {
      for (const cell of row) {
        cell.color = getCellColor(cell.value, outputMetric);
      }
    }

    return sendJson(res, 200, matrix);

  } catch (error) {
    console.error('[Sensitivity] Matrix calculation error:', error);
    return sendJson(res, 500, { error: error.message });
  }
}

/**
 * GET /api/deals/:dealId/sensitivity/hold-period
 * Calculate IRR sensitivity by hold period (exit year)
 */
export async function handleHoldPeriodSensitivity(req, res, dealId) {
  // Require authentication and org access
  const authUser = await requireDealOrgAccess(req, res, dealId);
  if (!authUser) return;

  const prisma = getPrisma();
  const url = new URL(req.url, 'http://localhost');
  const maxYears = parseInt(url.searchParams.get('maxYears') || '10');

  try {
    // Get underwriting model
    const model = await prisma.underwritingModel.findUnique({ where: { dealId } });
    if (!model) {
      return sendJson(res, 404, { error: 'No underwriting model found' });
    }

    // Get deal profile for purchase price
    const dealProfile = await prisma.dealProfile.findUnique({ where: { dealId } });
    const profile = dealProfile ? JSON.parse(dealProfile.profile) : {};

    // Build model inputs
    const modelInputs = {
      purchasePrice: profile.purchase_price,
      grossPotentialRent: model.grossPotentialRent,
      vacancyRate: model.vacancyRate || 0.05,
      otherIncome: model.otherIncome || 0,
      operatingExpenses: model.operatingExpenses,
      taxes: model.taxes,
      insurance: model.insurance,
      management: model.management,
      reserves: model.reserves,
      loanAmount: model.loanAmount,
      interestRate: model.interestRate,
      amortization: model.amortization || 30,
      loanTerm: model.loanTerm,
      exitCapRate: model.exitCapRate || 0.055,
      holdPeriod: model.holdPeriod || 5,
      rentGrowth: model.rentGrowth || 0.03,
      expenseGrowth: model.expenseGrowth || 0.02
    };

    // Calculate hold period sensitivity
    const result = calculateHoldPeriodSensitivity(modelInputs, maxYears);

    return sendJson(res, 200, {
      dealId,
      currentHoldPeriod: model.holdPeriod || 5,
      ...result
    });

  } catch (error) {
    console.error('[Sensitivity] Hold period error:', error);
    return sendJson(res, 500, { error: error.message });
  }
}

/**
 * GET /api/deals/:dealId/sensitivity/quick
 * Get quick sensitivity summary (+/- key assumptions)
 */
export async function handleQuickSensitivity(req, res, dealId) {
  const prisma = getPrisma();

  try {
    // Get underwriting model
    const model = await prisma.underwritingModel.findUnique({ where: { dealId } });
    if (!model) {
      return sendJson(res, 404, { error: 'No underwriting model found' });
    }

    // Get deal profile for purchase price
    const dealProfile = await prisma.dealProfile.findUnique({ where: { dealId } });
    const profile = dealProfile ? JSON.parse(dealProfile.profile) : {};

    // Build model inputs
    const modelInputs = {
      purchasePrice: profile.purchase_price,
      grossPotentialRent: model.grossPotentialRent,
      vacancyRate: model.vacancyRate || 0.05,
      otherIncome: model.otherIncome || 0,
      operatingExpenses: model.operatingExpenses,
      taxes: model.taxes,
      insurance: model.insurance,
      management: model.management,
      reserves: model.reserves,
      loanAmount: model.loanAmount,
      interestRate: model.interestRate,
      amortization: model.amortization || 30,
      loanTerm: model.loanTerm,
      exitCapRate: model.exitCapRate || 0.055,
      holdPeriod: model.holdPeriod || 5,
      rentGrowth: model.rentGrowth || 0.03,
      expenseGrowth: model.expenseGrowth || 0.02
    };

    // Calculate quick sensitivity
    const result = calculateQuickSensitivity(modelInputs);

    return sendJson(res, 200, {
      dealId,
      ...result
    });

  } catch (error) {
    console.error('[Sensitivity] Quick sensitivity error:', error);
    return sendJson(res, 500, { error: error.message });
  }
}

/**
 * POST /api/deals/:dealId/sensitivity/create-scenario
 * Create a scenario from a sensitivity matrix cell
 * SECURITY: authUser is required and must come from validated JWT at dispatch level
 */
export async function handleCreateScenarioFromSensitivity(req, res, dealId, authUser) {
  const prisma = getPrisma();
  if (!authUser) {
    return sendJson(res, 401, { error: 'Not authenticated' });
  }
  // SECURITY: Use validated authUser instead of spoofable headers
  const userId = authUser.id || 'system';
  const userName = authUser.name || 'System';

  try {
    let body = '';
    for await (const chunk of req) body += chunk;
    const { xField, xValue, yField, yValue, customName } = JSON.parse(body);

    // Validate required fields
    if (!xField || xValue === undefined || !yField || yValue === undefined) {
      return sendJson(res, 400, { error: 'Missing required fields: xField, xValue, yField, yValue' });
    }

    // Get underwriting model
    const model = await prisma.underwritingModel.findUnique({ where: { dealId } });
    if (!model) {
      return sendJson(res, 404, { error: 'No underwriting model found' });
    }

    // Get deal profile for purchase price
    const dealProfile = await prisma.dealProfile.findUnique({ where: { dealId } });
    const profile = dealProfile ? JSON.parse(dealProfile.profile) : {};

    // Create scenario template from cell
    const scenarioTemplate = createScenarioFromCell(
      { [xField]: model[xField], [yField]: model[yField] },
      xField,
      xValue,
      yField,
      yValue
    );

    // Build full inputs for calculation
    const baseInputs = {
      purchasePrice: profile.purchase_price,
      grossPotentialRent: model.grossPotentialRent,
      vacancyRate: model.vacancyRate || 0.05,
      operatingExpenses: model.operatingExpenses,
      loanAmount: model.loanAmount,
      interestRate: model.interestRate,
      amortization: model.amortization || 30,
      exitCapRate: model.exitCapRate || 0.055,
      holdPeriod: model.holdPeriod || 5,
      rentGrowth: model.rentGrowth || 0.03,
      expenseGrowth: model.expenseGrowth || 0.02,
      ...scenarioTemplate.assumptions
    };

    // Calculate results
    const calculated = calculateUnderwriting(baseInputs);

    // Create scenario
    const scenario = await prisma.underwritingScenario.create({
      data: {
        dealId,
        name: customName || scenarioTemplate.name,
        description: scenarioTemplate.description,
        assumptions: JSON.stringify(scenarioTemplate.assumptions),
        results: JSON.stringify({
          irr: calculated.returns.irr,
          cashOnCash: calculated.returns.cashOnCash,
          dscr: calculated.debtMetrics.dscr,
          equityMultiple: calculated.returns.equityMultiple,
          goingInCapRate: calculated.returns.goingInCapRate
        }),
        isBaseCase: false,
        createdBy: userId,
        createdByName: userName
      }
    });

    return sendJson(res, 201, {
      scenario: {
        ...scenario,
        assumptions: JSON.parse(scenario.assumptions),
        results: JSON.parse(scenario.results)
      }
    });

  } catch (error) {
    console.error('[Sensitivity] Create scenario error:', error);
    return sendJson(res, 500, { error: error.message });
  }
}

// ============ SECTOR API ENDPOINTS ============

/**
 * GET /api/sectors
 * Get all available property sectors
 */
export async function handleGetAllSectors(req, res) {
  try {
    const sectors = getAllSectors();
    return sendJson(res, 200, { sectors });
  } catch (error) {
    console.error('[Sectors] Get all sectors error:', error);
    return sendJson(res, 500, { error: error.message });
  }
}

/**
 * GET /api/sectors/:sectorCode
 * Get full configuration for a specific sector
 */
export async function handleGetSectorConfig(req, res, sectorCode) {
  try {
    const config = getSectorConfig(sectorCode);
    if (!config) {
      return sendJson(res, 404, { error: `Sector not found: ${sectorCode}` });
    }

    return sendJson(res, 200, {
      sector: config.code,
      name: config.name,
      description: config.description,
      subsectors: config.subsectors,
      primaryMetrics: config.primaryMetrics,
      inputs: getSectorAllInputs(sectorCode),
      requiredInputs: getSectorRequiredInputs(sectorCode),
      benchmarks: config.benchmarks,
      riskFactors: config.riskFactors,
      leaseStructure: config.leaseStructure,
      typicalLeaseTerm: config.typicalLeaseTerm,
      calculations: config.calculations
    });
  } catch (error) {
    console.error('[Sectors] Get sector config error:', error);
    return sendJson(res, 500, { error: error.message });
  }
}

/**
 * GET /api/sectors/:sectorCode/inputs
 * Get input fields for a sector
 */
export async function handleGetSectorInputs(req, res, sectorCode) {
  try {
    const config = getSectorConfig(sectorCode);
    if (!config) {
      return sendJson(res, 404, { error: `Sector not found: ${sectorCode}` });
    }

    return sendJson(res, 200, {
      sector: sectorCode,
      inputs: getSectorAllInputs(sectorCode),
      requiredInputs: getSectorRequiredInputs(sectorCode)
    });
  } catch (error) {
    console.error('[Sectors] Get sector inputs error:', error);
    return sendJson(res, 500, { error: error.message });
  }
}

/**
 * GET /api/sectors/:sectorCode/benchmarks
 * Get benchmarks for a sector
 */
export async function handleGetSectorBenchmarks(req, res, sectorCode) {
  try {
    const config = getSectorConfig(sectorCode);
    if (!config) {
      return sendJson(res, 404, { error: `Sector not found: ${sectorCode}` });
    }

    return sendJson(res, 200, {
      sector: sectorCode,
      benchmarks: getSectorBenchmarks(sectorCode)
    });
  } catch (error) {
    console.error('[Sectors] Get sector benchmarks error:', error);
    return sendJson(res, 500, { error: error.message });
  }
}

/**
 * GET /api/sectors/:sectorCode/risks
 * Get risk factors for a sector
 */
export async function handleGetSectorRisks(req, res, sectorCode) {
  try {
    const config = getSectorConfig(sectorCode);
    if (!config) {
      return sendJson(res, 404, { error: `Sector not found: ${sectorCode}` });
    }

    return sendJson(res, 200, {
      sector: sectorCode,
      riskFactors: getSectorRiskFactors(sectorCode)
    });
  } catch (error) {
    console.error('[Sectors] Get sector risks error:', error);
    return sendJson(res, 500, { error: error.message });
  }
}

/**
 * POST /api/deals/:dealId/detect-sector
 * Detect property sector from deal data
 */
export async function handleDetectSector(req, res, dealId) {
  const prisma = getPrisma();

  try {
    // Get deal profile
    const dealProfile = await prisma.dealProfile.findUnique({ where: { dealId } });
    if (!dealProfile) {
      return sendJson(res, 404, { error: 'Deal profile not found' });
    }

    const profile = JSON.parse(dealProfile.profile);
    const detectedSector = detectSector(profile);

    if (!detectedSector) {
      return sendJson(res, 200, {
        detected: false,
        message: 'Could not auto-detect sector from deal profile',
        availableSectors: getAllSectors()
      });
    }

    const config = getSectorConfig(detectedSector);

    return sendJson(res, 200, {
      detected: true,
      sector: detectedSector,
      sectorName: config.name,
      confidence: 'HIGH',
      primaryMetrics: config.primaryMetrics,
      requiredInputs: getSectorRequiredInputs(detectedSector),
      riskFactors: config.riskFactors?.slice(0, 5)
    });

  } catch (error) {
    console.error('[Sectors] Detect sector error:', error);
    return sendJson(res, 500, { error: error.message });
  }
}

/**
 * GET /api/deals/:dealId/sector-metrics
 * Calculate sector-specific metrics for a deal
 */
export async function handleGetSectorMetrics(req, res, dealId) {
  const prisma = getPrisma();
  const url = new URL(req.url, 'http://localhost');
  const forceSector = url.searchParams.get('sector');

  try {
    // Get underwriting model
    const model = await prisma.underwritingModel.findUnique({ where: { dealId } });
    if (!model) {
      return sendJson(res, 404, { error: 'No underwriting model found' });
    }

    // Get deal profile
    const dealProfile = await prisma.dealProfile.findUnique({ where: { dealId } });
    const profile = dealProfile ? JSON.parse(dealProfile.profile) : {};

    // Combine model and profile into inputs
    const inputs = {
      // From profile
      property_type: profile.property_type,
      asset_type: profile.asset_type,
      purchasePrice: profile.purchase_price,
      unitCount: profile.unit_count,
      totalSF: profile.square_footage,
      yearBuilt: profile.year_built,

      // From underwriting model
      grossPotentialRent: model.grossPotentialRent,
      vacancyRate: model.vacancyRate,
      operatingExpenses: model.operatingExpenses,
      netOperatingIncome: model.netOperatingIncome,
      loanAmount: model.loanAmount,
      interestRate: model.interestRate,

      // Additional sector-specific fields that might be stored
      ...(model.sectorInputs ? JSON.parse(model.sectorInputs) : {})
    };

    // Calculate sector metrics
    const sectorResult = calculateSectorMetrics(inputs, forceSector || null);

    return sendJson(res, 200, {
      dealId,
      ...sectorResult
    });

  } catch (error) {
    console.error('[Sectors] Get sector metrics error:', error);
    return sendJson(res, 500, { error: error.message });
  }
}

/**
 * PATCH /api/deals/:dealId/sector-inputs
 * Update sector-specific inputs for a deal
 * SECURITY: authUser is required and must come from validated JWT at dispatch level
 */
export async function handleUpdateSectorInputs(req, res, dealId, authUser) {
  const prisma = getPrisma();
  if (!authUser) {
    return sendJson(res, 401, { error: 'Not authenticated' });
  }
  // SECURITY: Use validated authUser instead of spoofable headers
  const userId = authUser.id || 'system';
  const userName = authUser.name || 'System';

  try {
    let body = '';
    for await (const chunk of req) body += chunk;
    const { sector, inputs } = JSON.parse(body);

    if (!sector || !inputs) {
      return sendJson(res, 400, { error: 'Missing required fields: sector, inputs' });
    }

    // Validate sector
    const config = getSectorConfig(sector);
    if (!config) {
      return sendJson(res, 400, { error: `Invalid sector: ${sector}` });
    }

    // Update underwriting model with sector inputs
    const model = await prisma.underwritingModel.upsert({
      where: { dealId },
      create: {
        dealId,
        sectorInputs: JSON.stringify({ sector, ...inputs })
      },
      update: {
        sectorInputs: JSON.stringify({ sector, ...inputs })
      }
    });

    // Calculate updated sector metrics
    const dealProfile = await prisma.dealProfile.findUnique({ where: { dealId } });
    const profile = dealProfile ? JSON.parse(dealProfile.profile) : {};

    const allInputs = {
      property_type: profile.property_type,
      asset_type: profile.asset_type,
      purchasePrice: profile.purchase_price,
      grossPotentialRent: model.grossPotentialRent,
      vacancyRate: model.vacancyRate,
      operatingExpenses: model.operatingExpenses,
      loanAmount: model.loanAmount,
      interestRate: model.interestRate,
      ...inputs
    };

    const sectorMetrics = calculateSectorMetrics(allInputs, sector);

    return sendJson(res, 200, {
      updated: true,
      sector,
      inputs,
      metrics: sectorMetrics.metrics,
      warnings: sectorMetrics.warnings
    });

  } catch (error) {
    console.error('[Sectors] Update sector inputs error:', error);
    return sendJson(res, 500, { error: error.message });
  }
}

/**
 * POST /api/deals/:dealId/validate-benchmarks
 * Validate deal metrics against sector benchmarks
 */
export async function handleValidateBenchmarks(req, res, dealId) {
  const prisma = getPrisma();

  try {
    let body = '';
    for await (const chunk of req) body += chunk;
    const { sector, metrics } = JSON.parse(body || '{}');

    // Get underwriting model if metrics not provided
    let metricsToValidate = metrics;
    let usedSector = sector;

    if (!metricsToValidate) {
      const model = await prisma.underwritingModel.findUnique({ where: { dealId } });
      if (!model) {
        return sendJson(res, 404, { error: 'No underwriting model found' });
      }

      const dealProfile = await prisma.dealProfile.findUnique({ where: { dealId } });
      const profile = dealProfile ? JSON.parse(dealProfile.profile) : {};

      // Detect sector if not provided
      if (!usedSector) {
        usedSector = detectSector(profile) || 'MULTIFAMILY';
      }

      // Calculate metrics from model
      const inputs = {
        property_type: profile.property_type,
        purchasePrice: profile.purchase_price,
        unitCount: profile.unit_count,
        totalSF: profile.square_footage,
        grossPotentialRent: model.grossPotentialRent,
        vacancyRate: model.vacancyRate,
        operatingExpenses: model.operatingExpenses,
        netOperatingIncome: model.netOperatingIncome,
        loanAmount: model.loanAmount,
        interestRate: model.interestRate,
        ...(model.sectorInputs ? JSON.parse(model.sectorInputs) : {})
      };

      const sectorResult = calculateSectorMetrics(inputs, usedSector);
      metricsToValidate = {
        capRate: model.goingInCapRate,
        dscr: model.dscr,
        occupancy: 1 - (model.vacancyRate || 0.05),
        ...sectorResult.metrics
      };
    }

    if (!usedSector) {
      return sendJson(res, 400, { error: 'Sector required for benchmark validation' });
    }

    // Validate each metric against benchmarks
    const validations = [];
    for (const [metricKey, value] of Object.entries(metricsToValidate)) {
      if (value !== null && value !== undefined && typeof value === 'number') {
        const result = validateAgainstBenchmark(usedSector, metricKey, value);
        validations.push({
          metric: metricKey,
          value,
          ...result
        });
      }
    }

    // Summary
    const warnings = validations.filter(v => v.warning);
    const passed = validations.filter(v => v.valid && !v.warning);

    return sendJson(res, 200, {
      sector: usedSector,
      totalMetrics: validations.length,
      passed: passed.length,
      warnings: warnings.length,
      validations,
      summary: warnings.length === 0 ? 'All metrics within typical ranges' : `${warnings.length} metric(s) outside typical ranges`
    });

  } catch (error) {
    console.error('[Sectors] Validate benchmarks error:', error);
    return sendJson(res, 500, { error: error.message });
  }
}

export default {
  handleExtractDocument,
  handleListExtractions,
  handleGetUnderwritingModel,
  handleUpdateUnderwritingModel,
  handleCalculateModel,
  handleListConflicts,
  handleResolveConflict,
  handleListScenarios,
  handleCreateScenario,
  handleDeleteScenario,
  handleCompareScenarios,
  handleGenerateMemo,
  handleGetMemo,
  handleUpdateMemo,
  handleApplyExtraction,
  handleGetInputHistory,
  handleGetProvenanceSummary,
  handleVerifyInput,
  handleGetCashFlows,
  handleGetScenarioCashFlows,
  // Waterfall endpoints
  handleGetWaterfall,
  handleCreateWaterfall,
  handleUpdateWaterfall,
  handleCalculateWaterfall,
  handleListWaterfallDistributions,
  handleCompareWaterfalls,
  // Sensitivity endpoints
  handleGetSensitivityOptions,
  handleCalculateSensitivityMatrix,
  handleHoldPeriodSensitivity,
  handleQuickSensitivity,
  handleCreateScenarioFromSensitivity,
  // Sector endpoints
  handleGetAllSectors,
  handleGetSectorConfig,
  handleGetSectorInputs,
  handleGetSectorBenchmarks,
  handleGetSectorRisks,
  handleDetectSector,
  handleGetSectorMetrics,
  handleUpdateSectorInputs,
  handleValidateBenchmarks
};
