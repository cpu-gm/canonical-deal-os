/**
 * Seed Sample Deal Data
 *
 * Creates sample data for testing the Deal Doc Factory.
 *
 * NOTE: Deal and Artifact data is managed by the kernel, not the BFF database.
 * This script seeds the BFF-managed data (underwriting model, claims, events)
 * that would typically be populated after processing kernel-managed documents.
 *
 * Usage:
 *   cd server && node scripts/seed-sample-deal.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

const prisma = new PrismaClient();

// Sample deal ID - would come from kernel in production
const SAMPLE_DEAL_ID = 'sample-deal-001';
const SAMPLE_DEAL_NAME = 'Maple Grove Apartments';

async function main() {
  console.log('Seeding sample deal data...\n');
  console.log('NOTE: Deal/Artifact data is managed by kernel.');
  console.log(`Using deal ID: ${SAMPLE_DEAL_ID}\n`);

  // Create or update DealProfile (BFF-managed deal metadata)
  // Schema expects profile as a JSON string
  const profileData = {
    propertyType: 'MULTIFAMILY',
    propertyAddress: '123 Maple Street',
    propertyCity: 'Austin',
    propertyState: 'TX',
    propertyZip: '78701',
    name: SAMPLE_DEAL_NAME
  };

  const profile = await prisma.dealProfile.upsert({
    where: { dealId: SAMPLE_DEAL_ID },
    update: {
      profile: JSON.stringify(profileData)
    },
    create: {
      dealId: SAMPLE_DEAL_ID,
      profile: JSON.stringify(profileData)
    }
  });
  console.log(`Created/updated deal profile for: ${SAMPLE_DEAL_ID}`);

  // Create underwriting model with correct schema field names
  const model = await prisma.underwritingModel.upsert({
    where: { dealId: SAMPLE_DEAL_ID },
    update: {
      updatedAt: new Date()
    },
    create: {
      dealId: SAMPLE_DEAL_ID,
      scenarioName: 'Base Case',
      isBaseCase: true,
      status: 'DRAFT',

      // Property basics (added to schema)
      purchasePrice: 25000000,
      totalUnits: 150,
      grossSF: 125000,

      // Income (use correct schema field names)
      netOperatingIncome: 1500000,  // NOT 'noi'
      grossPotentialRent: 2400000,
      effectiveGrossIncome: 2160000,
      operatingExpenses: 660000,

      // Cap rates
      goingInCapRate: 0.06,
      exitCapRate: 0.065,

      // Loan terms (use correct schema field names)
      loanAmount: 17500000,
      interestRate: 0.055,
      loanTerm: 10,        // NOT 'loanTermYears'
      amortization: 30,    // NOT 'amortizationYears'

      // Hold period
      holdPeriod: 5,       // NOT 'holdPeriodYears'

      createdAt: new Date(),
      updatedAt: new Date()
    }
  });
  console.log(`Created/updated underwriting model: ${model.scenarioName}`);

  // Note about documents: In production, these would be created via kernel API
  // Here we just reference the document IDs that would exist in kernel
  const sampleDocuments = [
    {
      id: 'doc-rent-roll-001',
      name: 'Q4_2025_Rent_Roll.xlsx',
      type: 'RENT_ROLL'
    },
    {
      id: 'doc-t12-001',
      name: 'T12_Operating_Statement.pdf',
      type: 'T12'
    },
    {
      id: 'doc-loi-001',
      name: 'Letter_of_Intent.pdf',
      type: 'LOI'
    }
  ];
  console.log(`\nReferencing ${sampleDocuments.length} sample documents (kernel-managed)`);

  // Create extraction claims
  const claims = [
    {
      fieldPath: 'purchasePrice',
      claimedValue: 25000000,
      documentId: 'doc-loi-001',
      documentName: 'Letter_of_Intent.pdf',
      documentType: 'LOI',
      pageNumber: 2,
      textSnippet: 'Purchase Price: Twenty-Five Million Dollars ($25,000,000)',
      confidence: 0.97
    },
    {
      fieldPath: 'netOperatingIncome',  // Use correct schema field name
      claimedValue: 1500000,
      documentId: 'doc-t12-001',
      documentName: 'T12_Operating_Statement.pdf',
      documentType: 'T12',
      pageNumber: 3,
      textSnippet: 'Net Operating Income: $1,500,000',
      confidence: 0.95
    },
    {
      fieldPath: 'grossPotentialRent',
      claimedValue: 2400000,
      documentId: 'doc-rent-roll-001',
      documentName: 'Q4_2025_Rent_Roll.xlsx',
      documentType: 'RENT_ROLL',
      cellReference: 'Summary!B15',
      textSnippet: 'Total Gross Potential Rent',
      confidence: 0.98
    },
    {
      fieldPath: 'effectiveGrossIncome',
      claimedValue: 2160000,
      documentId: 'doc-t12-001',
      documentName: 'T12_Operating_Statement.pdf',
      documentType: 'T12',
      pageNumber: 2,
      textSnippet: 'Effective Gross Income: $2,160,000',
      confidence: 0.92
    },
    {
      fieldPath: 'operatingExpenses',
      claimedValue: 660000,
      documentId: 'doc-t12-001',
      documentName: 'T12_Operating_Statement.pdf',
      documentType: 'T12',
      pageNumber: 4,
      textSnippet: 'Total Operating Expenses: $660,000',
      confidence: 0.89
    },
    {
      fieldPath: 'totalUnits',
      claimedValue: 150,
      documentId: 'doc-rent-roll-001',
      documentName: 'Q4_2025_Rent_Roll.xlsx',
      documentType: 'RENT_ROLL',
      cellReference: 'Summary!A5',
      textSnippet: 'Total Units: 150',
      confidence: 0.99
    },
    {
      fieldPath: 'vacancyRate',
      claimedValue: 0.10,
      documentId: 'doc-rent-roll-001',
      documentName: 'Q4_2025_Rent_Roll.xlsx',
      documentType: 'RENT_ROLL',
      cellReference: 'Summary!C10',
      textSnippet: 'Current Vacancy: 10%',
      confidence: 0.94
    },
    {
      fieldPath: 'loanAmount',
      claimedValue: 17500000,
      documentId: 'doc-loi-001',
      documentName: 'Letter_of_Intent.pdf',
      documentType: 'LOI',
      pageNumber: 3,
      textSnippet: 'Senior Debt: $17,500,000 (70% LTV)',
      confidence: 0.91
    },
    {
      fieldPath: 'interestRate',
      claimedValue: 0.055,
      documentId: 'doc-loi-001',
      documentName: 'Letter_of_Intent.pdf',
      documentType: 'LOI',
      pageNumber: 3,
      textSnippet: 'Interest Rate: 5.5% fixed',
      confidence: 0.93
    },
    {
      fieldPath: 'propertyTaxes',
      claimedValue: 180000,
      documentId: 'doc-t12-001',
      documentName: 'T12_Operating_Statement.pdf',
      documentType: 'T12',
      pageNumber: 4,
      textSnippet: 'Real Estate Taxes: $180,000',
      confidence: 0.72
    },
    {
      fieldPath: 'insurance',
      claimedValue: 45000,
      documentId: 'doc-t12-001',
      documentName: 'T12_Operating_Statement.pdf',
      documentType: 'T12',
      pageNumber: 4,
      textSnippet: 'Insurance: $45,000',
      confidence: 0.68
    }
  ];

  // Clear existing claims for this deal
  await prisma.extractionClaim.deleteMany({
    where: { dealId: SAMPLE_DEAL_ID }
  });
  console.log('\nCleared existing claims');

  // Create new claims
  const extractionId = `extraction-${Date.now()}`;
  for (const claim of claims) {
    const snippetHash = crypto.createHash('sha256')
      .update(claim.textSnippet)
      .digest('hex');

    await prisma.extractionClaim.create({
      data: {
        id: `claim-${claim.fieldPath}-${Date.now()}`,
        dealId: SAMPLE_DEAL_ID,
        fieldPath: claim.fieldPath,
        claimedValue: JSON.stringify(claim.claimedValue),
        documentId: claim.documentId,
        documentName: claim.documentName,
        documentType: claim.documentType,
        pageNumber: claim.pageNumber || null,
        cellReference: claim.cellReference || null,
        textSnippet: claim.textSnippet,
        snippetHash,
        extractionId,
        aiModel: 'gpt-4-turbo',
        aiConfidence: claim.confidence,
        status: 'PENDING',
        extractedAt: new Date()
      }
    });
    console.log(`Created claim: ${claim.fieldPath} (${Math.round(claim.confidence * 100)}% confidence)`);
  }

  // Clear existing events for clean slate
  await prisma.dealEvent.deleteMany({
    where: { dealId: SAMPLE_DEAL_ID }
  });

  // Create initial deal state
  await prisma.dealState.upsert({
    where: { dealId: SAMPLE_DEAL_ID },
    update: {
      currentState: 'INTAKE_RECEIVED',
      enteredStateAt: new Date()
    },
    create: {
      dealId: SAMPLE_DEAL_ID,
      currentState: 'INTAKE_RECEIVED',
      enteredStateAt: new Date(),
      createdAt: new Date()
    }
  });
  console.log('\nCreated/updated deal state: INTAKE_RECEIVED');

  // Create initial deal event
  await prisma.dealEvent.create({
    data: {
      id: `event-${Date.now()}`,
      dealId: SAMPLE_DEAL_ID,
      eventType: 'DealCreated',
      eventData: JSON.stringify({
        name: SAMPLE_DEAL_NAME,
        propertyType: 'MULTIFAMILY',
        askingPrice: 25000000
      }),
      actorId: 'seed-script',
      actorName: 'Seed Script',
      actorRole: 'SYSTEM',
      authorityContext: JSON.stringify({ source: 'seed-script' }),
      sequenceNumber: 1,
      occurredAt: new Date(),
      fromState: null,
      toState: 'INTAKE_RECEIVED',
      previousEventHash: null,
      eventHash: crypto.createHash('sha256')
        .update(`DealCreated-${SAMPLE_DEAL_ID}-${Date.now()}`)
        .digest('hex')
    }
  });
  console.log('Created initial deal event');

  // Summary
  console.log('\n========================================');
  console.log('Sample Deal Summary');
  console.log('========================================');
  console.log(`Deal ID: ${SAMPLE_DEAL_ID}`);
  console.log(`Deal Name: ${SAMPLE_DEAL_NAME}`);
  console.log(`Property: ${profileData.propertyAddress}, ${profileData.propertyCity}, ${profileData.propertyState}`);
  console.log(`\nUnderwriting Model:`);
  console.log(`  - Purchase Price: $${model.purchasePrice?.toLocaleString()}`);
  console.log(`  - NOI: $${model.netOperatingIncome?.toLocaleString()}`);
  console.log(`  - Total Units: ${model.totalUnits}`);
  console.log(`  - Loan Amount: $${model.loanAmount?.toLocaleString()}`);
  console.log(`\nClaims Created: ${claims.length}`);
  console.log(`  - High Confidence (>90%): ${claims.filter(c => c.confidence >= 0.9).length}`);
  console.log(`  - Medium Confidence (70-90%): ${claims.filter(c => c.confidence >= 0.7 && c.confidence < 0.9).length}`);
  console.log(`  - Low Confidence (<70%): ${claims.filter(c => c.confidence < 0.7).length}`);
  console.log('\n========================================');
  console.log('Ready to test verification queue at:');
  console.log(`  GET http://localhost:8787/api/deals/${SAMPLE_DEAL_ID}/claims/pending`);
  console.log('========================================\n');
}

main()
  .catch((e) => {
    console.error('Error seeding data:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
