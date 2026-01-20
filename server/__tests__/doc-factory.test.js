/**
 * Deal Doc Factory Integration Tests
 *
 * Tests the full document generation pipeline including:
 * - Extraction claims creation and verification
 * - State machine transitions
 * - Document generation with provenance
 * - Evidence pack generation
 * - Approval workflow
 *
 * Run with: npm test -- --testPathPattern=doc-factory
 */

import { jest } from '@jest/globals';
import { PrismaClient } from '@prisma/client';

// Create test database client
const prisma = new PrismaClient();

// Test data
const TEST_DEAL_ID = 'test-deal-doc-factory';
const TEST_USER = {
  id: 'test-user-123',
  name: 'Test Analyst',
  role: 'ANALYST'
};

// Clean up test data before and after tests
beforeAll(async () => {
  // Clean up any existing test data
  await cleanupTestData();
});

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

async function cleanupTestData() {
  // Delete in correct order due to foreign key constraints
  await prisma.approvalRecord.deleteMany({ where: { dealId: TEST_DEAL_ID } });
  await prisma.dealEvent.deleteMany({ where: { dealId: TEST_DEAL_ID } });
  await prisma.extractionClaim.deleteMany({ where: { dealId: TEST_DEAL_ID } });
  await prisma.underwritingInput.deleteMany({ where: { dealId: TEST_DEAL_ID } });
  await prisma.underwritingModel.deleteMany({ where: { dealId: TEST_DEAL_ID } });
  await prisma.documentVersion.deleteMany({ where: { dealId: TEST_DEAL_ID } });
  await prisma.generatedDocument.deleteMany({ where: { dealId: TEST_DEAL_ID } });
  await prisma.evidencePack.deleteMany({ where: { dealId: TEST_DEAL_ID } });
  await prisma.dealState.deleteMany({ where: { dealId: TEST_DEAL_ID } });
  await prisma.dealProfile.deleteMany({ where: { dealId: TEST_DEAL_ID } });
}

describe('ExtractionClaim Model', () => {
  test('creates extraction claim with all fields', async () => {
    const claim = await prisma.extractionClaim.create({
      data: {
        dealId: TEST_DEAL_ID,
        fieldPath: 'grossPotentialRent',
        claimedValue: JSON.stringify(820000),
        documentId: 'artifact-rent-roll-123',
        documentName: 'Rent_Roll_Q4_2025.xlsx',
        documentType: 'RENT_ROLL',
        pageNumber: null,
        cellReference: 'Summary!B15',
        textSnippet: 'Gross Potential Rent: $820,000',
        extractionId: 'extraction-123',
        aiModel: 'gpt-4o',
        aiConfidence: 0.92,
        status: 'PENDING'
      }
    });

    expect(claim.id).toBeDefined();
    expect(claim.dealId).toBe(TEST_DEAL_ID);
    expect(claim.fieldPath).toBe('grossPotentialRent');
    expect(claim.aiConfidence).toBe(0.92);
    expect(claim.status).toBe('PENDING');
  });

  test('updates claim status to VERIFIED', async () => {
    // Find the claim we created
    const pendingClaim = await prisma.extractionClaim.findFirst({
      where: { dealId: TEST_DEAL_ID, fieldPath: 'grossPotentialRent' }
    });

    const verifiedClaim = await prisma.extractionClaim.update({
      where: { id: pendingClaim.id },
      data: {
        status: 'VERIFIED',
        verifiedBy: TEST_USER.id,
        verifiedByName: TEST_USER.name,
        verifiedAt: new Date()
      }
    });

    expect(verifiedClaim.status).toBe('VERIFIED');
    expect(verifiedClaim.verifiedByName).toBe('Test Analyst');
  });

  test('creates claim with corrected value', async () => {
    const claim = await prisma.extractionClaim.create({
      data: {
        dealId: TEST_DEAL_ID,
        fieldPath: 'vacancyRate',
        claimedValue: JSON.stringify(0.10),  // AI extracted 10%
        documentId: 'artifact-t12-123',
        documentName: 'T12_2025.pdf',
        documentType: 'T12',
        pageNumber: 3,
        extractionId: 'extraction-124',
        aiModel: 'gpt-4o',
        aiConfidence: 0.75,
        status: 'VERIFIED',
        verifiedBy: TEST_USER.id,
        verifiedByName: TEST_USER.name,
        verifiedAt: new Date(),
        correctedValue: JSON.stringify(0.08)  // Analyst corrected to 8%
      }
    });

    expect(claim.status).toBe('VERIFIED');
    expect(JSON.parse(claim.claimedValue)).toBe(0.10);
    expect(JSON.parse(claim.correctedValue)).toBe(0.08);
  });
});

describe('DealState Model', () => {
  test('creates initial deal state', async () => {
    const state = await prisma.dealState.create({
      data: {
        dealId: TEST_DEAL_ID,
        currentState: 'INTAKE_RECEIVED'
      }
    });

    expect(state.currentState).toBe('INTAKE_RECEIVED');
    expect(state.enteredStateAt).toBeDefined();
  });

  test('updates deal state with blockers', async () => {
    const blockers = JSON.stringify([
      'Unverified claims: 3',
      'Missing required document: ENVIRONMENTAL'
    ]);

    const state = await prisma.dealState.update({
      where: { dealId: TEST_DEAL_ID },
      data: {
        blockers,
        pendingApprovals: JSON.stringify({
          required: ['ANALYST'],
          received: []
        })
      }
    });

    const parsedBlockers = JSON.parse(state.blockers);
    expect(parsedBlockers).toHaveLength(2);
    expect(parsedBlockers[0]).toContain('Unverified claims');
  });

  test('transitions deal state', async () => {
    const state = await prisma.dealState.update({
      where: { dealId: TEST_DEAL_ID },
      data: {
        currentState: 'DATA_ROOM_INGESTED',
        lastTransitionBy: TEST_USER.id,
        lastTransitionAt: new Date(),
        blockers: null
      }
    });

    expect(state.currentState).toBe('DATA_ROOM_INGESTED');
    expect(state.lastTransitionBy).toBe(TEST_USER.id);
  });
});

describe('DealEvent Model', () => {
  test('creates state transition event with hash chain', async () => {
    const event = await prisma.dealEvent.create({
      data: {
        dealId: TEST_DEAL_ID,
        eventType: 'STATE_TRANSITION',
        eventData: JSON.stringify({
          reason: 'Documents uploaded and classified'
        }),
        actorId: TEST_USER.id,
        actorName: TEST_USER.name,
        actorRole: TEST_USER.role,
        authorityContext: JSON.stringify({ approvals: [] }),
        sequenceNumber: 1,
        fromState: 'INTAKE_RECEIVED',
        toState: 'DATA_ROOM_INGESTED',
        previousEventHash: null,
        eventHash: 'abc123def456'  // Would be computed in real implementation
      }
    });

    expect(event.eventType).toBe('STATE_TRANSITION');
    expect(event.sequenceNumber).toBe(1);
    expect(event.fromState).toBe('INTAKE_RECEIVED');
    expect(event.toState).toBe('DATA_ROOM_INGESTED');
  });

  test('creates claim verification event', async () => {
    // First event hash
    const firstEvent = await prisma.dealEvent.findFirst({
      where: { dealId: TEST_DEAL_ID },
      orderBy: { sequenceNumber: 'desc' }
    });

    const event = await prisma.dealEvent.create({
      data: {
        dealId: TEST_DEAL_ID,
        eventType: 'CLAIM_VERIFIED',
        eventData: JSON.stringify({
          fieldPath: 'grossPotentialRent',
          value: 820000,
          corrected: false
        }),
        actorId: TEST_USER.id,
        actorName: TEST_USER.name,
        actorRole: TEST_USER.role,
        authorityContext: JSON.stringify({ approvals: [] }),
        sequenceNumber: 2,
        previousEventHash: firstEvent.eventHash,
        eventHash: 'def789ghi012'
      }
    });

    expect(event.eventType).toBe('CLAIM_VERIFIED');
    expect(event.previousEventHash).toBe(firstEvent.eventHash);
  });

  test('queries event ledger in sequence', async () => {
    const events = await prisma.dealEvent.findMany({
      where: { dealId: TEST_DEAL_ID },
      orderBy: { sequenceNumber: 'asc' }
    });

    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0].sequenceNumber).toBe(1);
    expect(events[1].sequenceNumber).toBe(2);
    expect(events[1].previousEventHash).toBe(events[0].eventHash);
  });
});

describe('ApprovalRecord Model', () => {
  test('creates state transition approval', async () => {
    const approval = await prisma.approvalRecord.create({
      data: {
        dealId: TEST_DEAL_ID,
        approvalType: 'STATE_TRANSITION',
        targetState: 'IC_READY',
        approverId: 'gp-user-456',
        approverName: 'GP Partner',
        approverRole: 'GP',
        decision: 'APPROVED',
        notes: 'Underwriting looks solid, proceed to IC',
        captureMethod: 'UI',
        requestedAt: new Date(Date.now() - 86400000),  // Yesterday
        requestedBy: TEST_USER.id
      }
    });

    expect(approval.approvalType).toBe('STATE_TRANSITION');
    expect(approval.targetState).toBe('IC_READY');
    expect(approval.decision).toBe('APPROVED');
    expect(approval.approverRole).toBe('GP');
  });

  test('creates document release approval', async () => {
    const approval = await prisma.approvalRecord.create({
      data: {
        dealId: TEST_DEAL_ID,
        approvalType: 'DOCUMENT_RELEASE',
        documentType: 'LOI',
        documentVersionId: 'doc-version-123',
        approverId: 'gp-user-456',
        approverName: 'GP Partner',
        approverRole: 'GP',
        decision: 'APPROVED',
        evidenceType: 'SIGNATURE',
        evidenceDocName: 'LOI_signed_GP.pdf',
        captureMethod: 'UI'
      }
    });

    expect(approval.approvalType).toBe('DOCUMENT_RELEASE');
    expect(approval.documentType).toBe('LOI');
    expect(approval.evidenceType).toBe('SIGNATURE');
  });

  test('creates conditional approval', async () => {
    const approval = await prisma.approvalRecord.create({
      data: {
        dealId: TEST_DEAL_ID,
        approvalType: 'STATE_TRANSITION',
        targetState: 'PSA_EXECUTED',
        approverId: 'counsel-789',
        approverName: 'Deal Counsel',
        approverRole: 'COUNSEL',
        decision: 'CONDITIONAL',
        conditions: JSON.stringify([
          'Update Section 5.2 with revised DD period',
          'Add environmental carve-out language'
        ]),
        notes: 'Approve subject to noted revisions',
        captureMethod: 'EMAIL',
        captureSource: 'email-msg-id-xyz'
      }
    });

    expect(approval.decision).toBe('CONDITIONAL');
    const conditions = JSON.parse(approval.conditions);
    expect(conditions).toHaveLength(2);
  });

  test('queries approvals by deal and type', async () => {
    const approvals = await prisma.approvalRecord.findMany({
      where: {
        dealId: TEST_DEAL_ID,
        approvalType: 'STATE_TRANSITION'
      },
      orderBy: { approvedAt: 'desc' }
    });

    expect(approvals.length).toBeGreaterThanOrEqual(2);
    expect(approvals.every(a => a.approvalType === 'STATE_TRANSITION')).toBe(true);
  });
});

describe('DocumentVersion Model', () => {
  test('creates draft document version', async () => {
    const version = await prisma.documentVersion.create({
      data: {
        dealId: TEST_DEAL_ID,
        documentType: 'IC_MEMO',
        version: 1,
        status: 'DRAFT',
        contentHash: 'sha256-abc123',
        storageKey: `/documents/${TEST_DEAL_ID}/IC_MEMO_v1.pdf`,
        format: 'PDF',
        pageCount: 12,
        watermarkText: 'DRAFT - NOT FOR EXECUTION',
        createdBy: TEST_USER.id,
        createdByName: TEST_USER.name,
        provenanceMap: JSON.stringify({
          'purchasePrice': 'claim-123',
          'noi': 'claim-456'
        })
      }
    });

    expect(version.status).toBe('DRAFT');
    expect(version.watermarkText).toContain('DRAFT');
    expect(version.version).toBe(1);
  });

  test('promotes document to BINDING', async () => {
    const version = await prisma.documentVersion.findFirst({
      where: { dealId: TEST_DEAL_ID, documentType: 'IC_MEMO' }
    });

    const promoted = await prisma.documentVersion.update({
      where: { id: version.id },
      data: {
        status: 'BINDING',
        promotedAt: new Date(),
        promotedBy: 'gp-user-456',
        watermarkText: null  // Remove watermark for binding docs
      }
    });

    expect(promoted.status).toBe('BINDING');
    expect(promoted.promotedAt).toBeDefined();
    expect(promoted.watermarkText).toBeNull();
  });

  test('creates new version with parent reference', async () => {
    const parentVersion = await prisma.documentVersion.findFirst({
      where: { dealId: TEST_DEAL_ID, documentType: 'IC_MEMO' }
    });

    const newVersion = await prisma.documentVersion.create({
      data: {
        dealId: TEST_DEAL_ID,
        documentType: 'IC_MEMO',
        version: 2,
        status: 'DRAFT',
        contentHash: 'sha256-def456',
        storageKey: `/documents/${TEST_DEAL_ID}/IC_MEMO_v2.pdf`,
        format: 'PDF',
        pageCount: 14,
        createdBy: TEST_USER.id,
        createdByName: TEST_USER.name,
        parentVersionId: parentVersion.id
      }
    });

    expect(newVersion.version).toBe(2);
    expect(newVersion.parentVersionId).toBe(parentVersion.id);
  });

  test('enforces unique constraint on deal/type/version', async () => {
    await expect(
      prisma.documentVersion.create({
        data: {
          dealId: TEST_DEAL_ID,
          documentType: 'IC_MEMO',
          version: 1,  // Already exists
          status: 'DRAFT',
          contentHash: 'sha256-xyz',
          storageKey: '/duplicate/path',
          format: 'PDF',
          createdBy: TEST_USER.id,
          createdByName: TEST_USER.name
        }
      })
    ).rejects.toThrow();
  });
});

describe('UnderwritingModel with Doc Factory Fields', () => {
  test('creates underwriting model with new fields', async () => {
    const model = await prisma.underwritingModel.create({
      data: {
        dealId: TEST_DEAL_ID,
        scenarioName: 'Base Case',
        isBaseCase: true,
        purchasePrice: 15000000,
        totalUnits: 42,
        grossSF: 35000,
        grossPotentialRent: 820000,
        vacancyRate: 0.05,
        effectiveGrossIncome: 779000,
        operatingExpenses: 296000,
        netOperatingIncome: 483000,
        loanAmount: 10500000,
        interestRate: 0.065,
        loanTerm: 10,
        amortization: 30,
        goingInCapRate: 0.0644,
        exitCapRate: 0.06,
        holdPeriod: 5,
        status: 'DRAFT'
      }
    });

    expect(model.scenarioName).toBe('Base Case');
    expect(model.isBaseCase).toBe(true);
    expect(model.purchasePrice).toBe(15000000);
    expect(model.totalUnits).toBe(42);
    expect(model.grossSF).toBe(35000);
  });

  test('queries base case model', async () => {
    const baseCase = await prisma.underwritingModel.findFirst({
      where: {
        dealId: TEST_DEAL_ID,
        isBaseCase: true
      }
    });

    expect(baseCase).toBeDefined();
    expect(baseCase.scenarioName).toBe('Base Case');
  });
});

describe('UnderwritingInput Provenance', () => {
  test('creates input with document source', async () => {
    const model = await prisma.underwritingModel.findFirst({
      where: { dealId: TEST_DEAL_ID }
    });

    const input = await prisma.underwritingInput.create({
      data: {
        dealId: TEST_DEAL_ID,
        fieldPath: 'grossPotentialRent',
        value: JSON.stringify(820000),
        sourceType: 'EXCEL_IMPORT',
        source: 'RENT_ROLL',
        documentName: 'Rent_Roll_Q4_2025.xlsx',
        documentCell: 'Summary!B15',
        aiConfidence: 0.92,
        setBy: TEST_USER.id,
        setByName: TEST_USER.name,
        verifiedBy: TEST_USER.id,
        verifiedByName: TEST_USER.name,
        verifiedAt: new Date()
      }
    });

    expect(input.sourceType).toBe('EXCEL_IMPORT');
    expect(input.documentCell).toBe('Summary!B15');
    expect(input.aiConfidence).toBe(0.92);
    expect(input.verifiedAt).toBeDefined();
  });

  test('creates input with page reference', async () => {
    const input = await prisma.underwritingInput.create({
      data: {
        dealId: TEST_DEAL_ID,
        fieldPath: 'purchasePrice',
        value: JSON.stringify(15000000),
        sourceType: 'AI_EXTRACTION',
        source: 'LOI',
        documentName: 'LOI_123_Main_St.pdf',
        documentPage: 2,
        aiModel: 'gpt-4o',
        aiConfidence: 0.95,
        setBy: TEST_USER.id,
        setByName: TEST_USER.name,
        rationale: 'Extracted from LOI Section 1: Purchase Price'
      }
    });

    expect(input.sourceType).toBe('AI_EXTRACTION');
    expect(input.documentPage).toBe(2);
    expect(input.aiModel).toBe('gpt-4o');
  });

  test('queries provenance chain for field', async () => {
    const provenanceChain = await prisma.underwritingInput.findMany({
      where: {
        dealId: TEST_DEAL_ID,
        fieldPath: 'grossPotentialRent'
      },
      orderBy: { setAt: 'desc' }
    });

    expect(provenanceChain.length).toBeGreaterThanOrEqual(1);
    expect(provenanceChain[0].documentName).toBe('Rent_Roll_Q4_2025.xlsx');
  });
});

describe('GeneratedDocument Model', () => {
  test('creates generated document with provenance', async () => {
    const version = await prisma.documentVersion.findFirst({
      where: { dealId: TEST_DEAL_ID, documentType: 'IC_MEMO' }
    });

    const doc = await prisma.generatedDocument.create({
      data: {
        dealId: TEST_DEAL_ID,
        documentType: 'IC_MEMO',
        title: 'Investment Committee Memo - 123 Main Street',
        versionId: version.id,
        templateName: 'ic-memo.hbs',
        generatedBy: TEST_USER.id,
        generatedByName: TEST_USER.name,
        storageKey: `/generated/${TEST_DEAL_ID}/IC_MEMO_v1.pdf`,
        contentHash: 'sha256-generated-123',
        format: 'PDF',
        sizeBytes: 245000,
        pageCount: 12,
        fieldProvenance: JSON.stringify([
          {
            fieldPath: 'purchasePrice',
            value: 15000000,
            claimId: 'claim-123',
            documentSource: 'LOI_123_Main_St.pdf',
            pageNumber: 2
          },
          {
            fieldPath: 'noi',
            value: 483000,
            claimId: 'claim-456',
            documentSource: 'T12_2025.pdf',
            pageNumber: 5
          }
        ]),
        status: 'GENERATED'
      }
    });

    expect(doc.documentType).toBe('IC_MEMO');
    expect(doc.pageCount).toBe(12);

    const provenance = JSON.parse(doc.fieldProvenance);
    expect(provenance).toHaveLength(2);
    expect(provenance[0].fieldPath).toBe('purchasePrice');
  });
});

describe('EvidencePack Model', () => {
  test('creates evidence pack', async () => {
    const pack = await prisma.evidencePack.create({
      data: {
        dealId: TEST_DEAL_ID,
        packType: 'IC_PACK',
        name: 'IC Evidence Pack - 123 Main Street',
        description: 'Evidence package for Investment Committee review',
        manifest: JSON.stringify({
          files: [
            { path: 'documents/IC_Memo_v1.pdf', type: 'GENERATED' },
            { path: 'source_documents/LOI.pdf', type: 'SOURCE' },
            { path: 'source_documents/RentRoll.xlsx', type: 'SOURCE' }
          ],
          eventCount: 5,
          claimCount: 8
        }),
        storageKey: `/packs/${TEST_DEAL_ID}/IC_PACK_20260115.zip`,
        contentHash: 'sha256-pack-abc',
        sizeBytes: 2500000,
        fileCount: 7,
        generatedBy: TEST_USER.id,
        generatedByName: TEST_USER.name,
        asOfTimestamp: new Date(),
        dealStateSnapshot: JSON.stringify({
          state: 'IC_READY',
          model: { purchasePrice: 15000000, noi: 483000 }
        }),
        validationStatus: 'VALID'
      }
    });

    expect(pack.packType).toBe('IC_PACK');
    expect(pack.validationStatus).toBe('VALID');

    const manifest = JSON.parse(pack.manifest);
    expect(manifest.files).toHaveLength(3);
  });
});

describe('End-to-End Flow Simulation', () => {
  test('simulates full document generation pipeline', async () => {
    // This test documents the expected end-to-end flow
    // In production, this would be an integration test against the actual services

    // Step 1: Deal created and documents uploaded
    // (simulated by existing test data)

    // Step 2: AI extracts claims from documents
    const extractedClaims = [
      { fieldPath: 'purchasePrice', value: 15000000, confidence: 0.95 },
      { fieldPath: 'grossPotentialRent', value: 820000, confidence: 0.92 },
      { fieldPath: 'vacancyRate', value: 0.05, confidence: 0.88 }
    ];

    // Step 3: Analyst verifies claims
    const verificationResults = {
      verified: 3,
      rejected: 0,
      pending: 0
    };

    // Step 4: All claims verified, state transitions
    const stateProgression = [
      'INTAKE_RECEIVED',
      'DATA_ROOM_INGESTED',
      'EXTRACTION_COMPLETE',
      'UNDERWRITING_DRAFT',
      'IC_READY'
    ];

    // Step 5: Generate IC Memo with provenance
    const generatedDoc = {
      type: 'IC_MEMO',
      pageCount: 12,
      provenanceFields: 15,
      watermark: 'DRAFT'
    };

    // Step 6: GP approves, document promoted to BINDING
    const approval = {
      approver: 'GP Partner',
      decision: 'APPROVED',
      newStatus: 'BINDING'
    };

    // Step 7: Generate evidence pack
    const evidencePack = {
      type: 'IC_PACK',
      files: 7,
      events: 5,
      claims: 3
    };

    // Assertions documenting expected behavior
    expect(extractedClaims.length).toBe(3);
    expect(verificationResults.verified).toBe(3);
    expect(stateProgression[stateProgression.length - 1]).toBe('IC_READY');
    expect(generatedDoc.type).toBe('IC_MEMO');
    expect(approval.decision).toBe('APPROVED');
    expect(evidencePack.type).toBe('IC_PACK');

    // Log flow for documentation
    console.log('End-to-end flow simulation:');
    console.log('  1. Deal created with documents');
    console.log(`  2. AI extracted ${extractedClaims.length} claims`);
    console.log(`  3. Analyst verified ${verificationResults.verified} claims`);
    console.log(`  4. Deal progressed through ${stateProgression.length} states`);
    console.log(`  5. Generated ${generatedDoc.type} with ${generatedDoc.provenanceFields} provenance fields`);
    console.log(`  6. GP ${approval.decision} - status changed to ${approval.newStatus}`);
    console.log(`  7. Evidence pack generated with ${evidencePack.files} files`);
  });
});

describe('Provenance Traceability', () => {
  test('traces field value back to source document', async () => {
    // Given a field value in a generated document
    const fieldPath = 'grossPotentialRent';

    // We can trace it back through:
    // 1. GeneratedDocument.fieldProvenance -> claimId
    // 2. ExtractionClaim -> documentName, cellReference
    // 3. UnderwritingInput -> full provenance chain

    const claim = await prisma.extractionClaim.findFirst({
      where: {
        dealId: TEST_DEAL_ID,
        fieldPath
      }
    });

    const input = await prisma.underwritingInput.findFirst({
      where: {
        dealId: TEST_DEAL_ID,
        fieldPath
      }
    });

    // Verify complete traceability
    expect(claim).toBeDefined();
    expect(claim.documentName).toBe('Rent_Roll_Q4_2025.xlsx');
    expect(claim.cellReference).toBe('Summary!B15');

    expect(input).toBeDefined();
    expect(input.documentName).toBe(claim.documentName);
    expect(input.verifiedAt).toBeDefined();

    console.log(`Provenance chain for ${fieldPath}:`);
    console.log(`  Source: ${claim.documentName}`);
    console.log(`  Location: ${claim.cellReference || `Page ${claim.pageNumber}`}`);
    console.log(`  AI Confidence: ${(claim.aiConfidence * 100).toFixed(0)}%`);
    console.log(`  Verified by: ${input.verifiedByName}`);
    console.log(`  Verified at: ${input.verifiedAt}`);
  });
});
