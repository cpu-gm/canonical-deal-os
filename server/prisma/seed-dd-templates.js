/**
 * Seed DD Categories and Template Items
 *
 * Run: node server/prisma/seed-dd-templates.js
 *
 * Creates 12 categories and 116 DD template items for
 * comprehensive due diligence workflow management.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Deal state constants for stage gating
const DEAL_STATES = {
  LOI_ACCEPTED: 'LOI_ACCEPTED',
  PSA_DRAFT: 'PSA_DRAFT',
  PSA_EXECUTED: 'PSA_EXECUTED',
  DD_ACTIVE: 'DD_ACTIVE',
  DD_COMPLETE: 'DD_COMPLETE',
  FINANCING_IN_PROGRESS: 'FINANCING_IN_PROGRESS',
  FINANCING_COMMITTED: 'FINANCING_COMMITTED',
  CLEAR_TO_CLOSE: 'CLEAR_TO_CLOSE',
  CLOSED: 'CLOSED',
};

// Categories
const categories = [
  { code: 'TITLE', name: 'Title & Legal', description: 'Title insurance, survey, and legal encumbrances', displayOrder: 1 },
  { code: 'ENVIRONMENTAL', name: 'Environmental', description: 'Phase I/II ESA and environmental compliance', displayOrder: 2 },
  { code: 'PROPERTY', name: 'Property Condition', description: 'PCA, inspections, and physical condition', displayOrder: 3 },
  { code: 'FINANCIAL', name: 'Financial Review', description: 'T12, rent roll, and financial verification', displayOrder: 4 },
  { code: 'TENANT', name: 'Tenant & Lease Matters', description: 'Leases, estoppels, and tenant verification', displayOrder: 5 },
  { code: 'ZONING', name: 'Zoning & Entitlements', description: 'Zoning compliance and building permits', displayOrder: 6 },
  { code: 'CONTRACTS', name: 'Service Contracts', description: 'Vendor agreements and service contracts', displayOrder: 7 },
  { code: 'INSURANCE', name: 'Insurance', description: 'Property and liability insurance', displayOrder: 8 },
  { code: 'FINANCING', name: 'Financing', description: 'Loan application and commitment', displayOrder: 9 },
  { code: 'CLOSING', name: 'Closing Preparation', description: 'Closing documents and settlement', displayOrder: 10 },
  { code: 'SITE', name: 'Site Visits & Inspections', description: 'Property visits and physical inspections', displayOrder: 11 },
  { code: 'POST_CLOSING', name: 'Post-Closing', description: 'Post-closing tasks and transitions', displayOrder: 12 },
];

// Template Items - all 116 DD tasks
const templateItems = [
  // ========== TITLE & LEGAL (12 items) ==========
  {
    categoryCode: 'TITLE', code: 'TITLE_001', title: 'Order Title Commitment',
    description: 'Order preliminary title commitment from title company',
    defaultResponsible: 'BUYER', priority: 'CRITICAL', requiresDocument: true,
    documentTypes: JSON.stringify(['TITLE_COMMITMENT']),
    deadlineType: 'PSA_RELATIVE', deadlineDaysOffset: 5,
    availableFromState: DEAL_STATES.PSA_DRAFT,
    aiAutoMatch: true, aiKeywords: JSON.stringify(['title commitment', 'title insurance', 'preliminary title']),
    displayOrder: 1
  },
  {
    categoryCode: 'TITLE', code: 'TITLE_002', title: 'Review Title Exceptions',
    description: 'Review all Schedule B exceptions in title commitment',
    defaultResponsible: 'COUNSEL', priority: 'HIGH', requiresDocument: true,
    documentTypes: JSON.stringify(['TITLE_EXCEPTION_REVIEW']),
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -10,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    displayOrder: 2
  },
  {
    categoryCode: 'TITLE', code: 'TITLE_003', title: 'Identify Title Objections',
    description: 'Identify objectionable title exceptions requiring cure',
    defaultResponsible: 'COUNSEL', priority: 'HIGH', requiresDocument: false,
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -10,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    displayOrder: 3
  },
  {
    categoryCode: 'TITLE', code: 'TITLE_004', title: 'Deliver Title Objections',
    description: 'Send title objection letter to seller',
    defaultResponsible: 'BUYER', priority: 'CRITICAL', requiresDocument: true,
    documentTypes: JSON.stringify(['TITLE_OBJECTION_LETTER']),
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -7,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    displayOrder: 4
  },
  {
    categoryCode: 'TITLE', code: 'TITLE_005', title: 'Seller Title Cure Response',
    description: 'Receive seller response to title objections',
    defaultResponsible: 'SELLER', priority: 'HIGH', requiresDocument: true,
    documentTypes: JSON.stringify(['TITLE_CURE_RESPONSE']),
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -3,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    displayOrder: 5
  },
  {
    categoryCode: 'TITLE', code: 'TITLE_006', title: 'Order ALTA Survey',
    description: 'Order ALTA/NSPS survey from licensed surveyor',
    defaultResponsible: 'BUYER', priority: 'CRITICAL', requiresDocument: true,
    documentTypes: JSON.stringify(['ALTA_SURVEY']),
    deadlineType: 'PSA_RELATIVE', deadlineDaysOffset: 3,
    availableFromState: DEAL_STATES.PSA_DRAFT,
    aiAutoMatch: true, aiKeywords: JSON.stringify(['ALTA survey', 'NSPS survey', 'land survey', 'plat']),
    displayOrder: 6
  },
  {
    categoryCode: 'TITLE', code: 'TITLE_007', title: 'Review Survey',
    description: 'Review survey for encroachments and easements',
    defaultResponsible: 'COUNSEL', priority: 'HIGH', requiresDocument: true,
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -7,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    displayOrder: 7
  },
  {
    categoryCode: 'TITLE', code: 'TITLE_008', title: 'Survey Exception Resolution',
    description: 'Resolve any survey-related exceptions',
    defaultResponsible: 'BOTH', priority: 'MEDIUM', requiresDocument: false,
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -3,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    displayOrder: 8
  },
  {
    categoryCode: 'TITLE', code: 'TITLE_009', title: 'UCC Search',
    description: 'Order and review UCC lien search',
    defaultResponsible: 'COUNSEL', priority: 'HIGH', requiresDocument: true,
    documentTypes: JSON.stringify(['UCC_SEARCH']),
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -10,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    aiAutoMatch: true, aiKeywords: JSON.stringify(['UCC', 'financing statement', 'lien search']),
    displayOrder: 9
  },
  {
    categoryCode: 'TITLE', code: 'TITLE_010', title: 'Judgment/Lien Search',
    description: 'Order and review judgment and lien searches',
    defaultResponsible: 'COUNSEL', priority: 'HIGH', requiresDocument: true,
    documentTypes: JSON.stringify(['JUDGMENT_SEARCH', 'LIEN_SEARCH']),
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -10,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    displayOrder: 10
  },
  {
    categoryCode: 'TITLE', code: 'TITLE_011', title: 'Tax Lien Search',
    description: 'Verify no outstanding tax liens',
    defaultResponsible: 'COUNSEL', priority: 'MEDIUM', requiresDocument: true,
    documentTypes: JSON.stringify(['TAX_LIEN_SEARCH']),
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -7,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    displayOrder: 11
  },
  {
    categoryCode: 'TITLE', code: 'TITLE_012', title: 'Title Clear to Close',
    description: 'Confirm title is clear and ready for closing',
    defaultResponsible: 'TITLE_CO', priority: 'CRITICAL', requiresDocument: true,
    documentTypes: JSON.stringify(['TITLE_CLEARANCE']),
    deadlineType: 'CLOSING_RELATIVE', deadlineDaysOffset: -3,
    availableFromState: DEAL_STATES.CLEAR_TO_CLOSE,
    displayOrder: 12
  },

  // ========== ENVIRONMENTAL (8 items) ==========
  {
    categoryCode: 'ENVIRONMENTAL', code: 'ENV_001', title: 'Order Phase I ESA',
    description: 'Order Phase I Environmental Site Assessment',
    defaultResponsible: 'BUYER', priority: 'CRITICAL', requiresDocument: true,
    documentTypes: JSON.stringify(['PHASE_I_ESA']),
    deadlineType: 'PSA_RELATIVE', deadlineDaysOffset: 3,
    availableFromState: DEAL_STATES.PSA_EXECUTED,
    aiAutoMatch: true, aiKeywords: JSON.stringify(['Phase I', 'ESA', 'environmental site assessment', 'environmental report']),
    displayOrder: 1
  },
  {
    categoryCode: 'ENVIRONMENTAL', code: 'ENV_002', title: 'Review Phase I Report',
    description: 'Review Phase I findings and RECs/HRECs',
    defaultResponsible: 'BUYER', priority: 'CRITICAL', requiresDocument: true,
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -10,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    dependsOn: JSON.stringify(['ENV_001']),
    displayOrder: 2
  },
  {
    categoryCode: 'ENVIRONMENTAL', code: 'ENV_003', title: 'Evaluate RECs/HRECs',
    description: 'Evaluate Recognized Environmental Conditions',
    defaultResponsible: 'BUYER', priority: 'HIGH', requiresDocument: false,
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -7,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    dependsOn: JSON.stringify(['ENV_002']),
    displayOrder: 3
  },
  {
    categoryCode: 'ENVIRONMENTAL', code: 'ENV_004', title: 'Order Phase II (if needed)',
    description: 'Order Phase II ESA if RECs identified',
    defaultResponsible: 'BUYER', priority: 'CRITICAL', requiresDocument: true,
    documentTypes: JSON.stringify(['PHASE_II_ESA']),
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -5,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    aiAutoMatch: true, aiKeywords: JSON.stringify(['Phase II', 'subsurface investigation', 'soil sampling']),
    displayOrder: 4
  },
  {
    categoryCode: 'ENVIRONMENTAL', code: 'ENV_005', title: 'Review Phase II Results',
    description: 'Review Phase II testing results',
    defaultResponsible: 'BUYER', priority: 'CRITICAL', requiresDocument: true,
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -3,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    dependsOn: JSON.stringify(['ENV_004']),
    displayOrder: 5
  },
  {
    categoryCode: 'ENVIRONMENTAL', code: 'ENV_006', title: 'Remediation Plan (if needed)',
    description: 'Develop remediation plan for environmental issues',
    defaultResponsible: 'SELLER', priority: 'HIGH', requiresDocument: true,
    documentTypes: JSON.stringify(['REMEDIATION_PLAN']),
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -2,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    displayOrder: 6
  },
  {
    categoryCode: 'ENVIRONMENTAL', code: 'ENV_007', title: 'Environmental Escrow/Reserve',
    description: 'Negotiate environmental escrow or reserve if needed',
    defaultResponsible: 'BOTH', priority: 'HIGH', requiresDocument: false,
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -1,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    displayOrder: 7
  },
  {
    categoryCode: 'ENVIRONMENTAL', code: 'ENV_008', title: 'Environmental Insurance Quote',
    description: 'Obtain environmental liability insurance quote',
    defaultResponsible: 'BUYER', priority: 'MEDIUM', requiresDocument: true,
    documentTypes: JSON.stringify(['ENVIRONMENTAL_INSURANCE_QUOTE']),
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -5,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    displayOrder: 8
  },

  // ========== PROPERTY CONDITION (10 items) ==========
  {
    categoryCode: 'PROPERTY', code: 'PROP_001', title: 'Order PCA',
    description: 'Order Property Condition Assessment',
    defaultResponsible: 'BUYER', priority: 'CRITICAL', requiresDocument: true,
    documentTypes: JSON.stringify(['PCA', 'PROPERTY_CONDITION_REPORT']),
    deadlineType: 'PSA_RELATIVE', deadlineDaysOffset: 3,
    availableFromState: DEAL_STATES.PSA_EXECUTED,
    aiAutoMatch: true, aiKeywords: JSON.stringify(['PCA', 'property condition assessment', 'physical inspection report']),
    displayOrder: 1
  },
  {
    categoryCode: 'PROPERTY', code: 'PROP_002', title: 'Review PCA Report',
    description: 'Review PCA findings and recommendations',
    defaultResponsible: 'BUYER', priority: 'CRITICAL', requiresDocument: true,
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -10,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    dependsOn: JSON.stringify(['PROP_001']),
    displayOrder: 2
  },
  {
    categoryCode: 'PROPERTY', code: 'PROP_003', title: 'Capital Expenditure Analysis',
    description: 'Analyze CapEx requirements from PCA',
    defaultResponsible: 'BUYER', priority: 'HIGH', requiresDocument: false,
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -7,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    dependsOn: JSON.stringify(['PROP_002']),
    displayOrder: 3
  },
  {
    categoryCode: 'PROPERTY', code: 'PROP_004', title: 'Deferred Maintenance Inventory',
    description: 'Document deferred maintenance items',
    defaultResponsible: 'BUYER', priority: 'HIGH', requiresDocument: true,
    documentTypes: JSON.stringify(['DEFERRED_MAINTENANCE_LIST']),
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -7,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    displayOrder: 4
  },
  {
    categoryCode: 'PROPERTY', code: 'PROP_005', title: 'Structural Engineer Report',
    description: 'Order structural engineer report if needed',
    defaultResponsible: 'BUYER', priority: 'HIGH', requiresDocument: true,
    documentTypes: JSON.stringify(['STRUCTURAL_REPORT']),
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -5,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    aiAutoMatch: true, aiKeywords: JSON.stringify(['structural', 'engineer report', 'foundation']),
    displayOrder: 5
  },
  {
    categoryCode: 'PROPERTY', code: 'PROP_006', title: 'HVAC/Mechanical Inspection',
    description: 'Inspect HVAC and mechanical systems',
    defaultResponsible: 'BUYER', priority: 'MEDIUM', requiresDocument: true,
    documentTypes: JSON.stringify(['HVAC_INSPECTION', 'MECHANICAL_REPORT']),
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -7,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    aiAutoMatch: true, aiKeywords: JSON.stringify(['HVAC', 'mechanical', 'heating', 'cooling']),
    displayOrder: 6
  },
  {
    categoryCode: 'PROPERTY', code: 'PROP_007', title: 'Roof Inspection/Warranty Review',
    description: 'Inspect roof and review warranty',
    defaultResponsible: 'BUYER', priority: 'HIGH', requiresDocument: true,
    documentTypes: JSON.stringify(['ROOF_INSPECTION', 'ROOF_WARRANTY']),
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -7,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    aiAutoMatch: true, aiKeywords: JSON.stringify(['roof inspection', 'roof warranty', 'roofing']),
    displayOrder: 7
  },
  {
    categoryCode: 'PROPERTY', code: 'PROP_008', title: 'Elevator Inspection',
    description: 'Inspect elevators if applicable',
    defaultResponsible: 'BUYER', priority: 'MEDIUM', requiresDocument: true,
    documentTypes: JSON.stringify(['ELEVATOR_INSPECTION']),
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -7,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    displayOrder: 8
  },
  {
    categoryCode: 'PROPERTY', code: 'PROP_009', title: 'Pool/Amenity Inspection',
    description: 'Inspect pool and amenity areas',
    defaultResponsible: 'BUYER', priority: 'LOW', requiresDocument: true,
    documentTypes: JSON.stringify(['POOL_INSPECTION', 'AMENITY_INSPECTION']),
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -7,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    displayOrder: 9
  },
  {
    categoryCode: 'PROPERTY', code: 'PROP_010', title: 'ADA Compliance Review',
    description: 'Review ADA accessibility compliance',
    defaultResponsible: 'BUYER', priority: 'HIGH', requiresDocument: true,
    documentTypes: JSON.stringify(['ADA_COMPLIANCE_REPORT']),
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -7,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    displayOrder: 10
  },

  // ========== FINANCIAL REVIEW (14 items) ==========
  {
    categoryCode: 'FINANCIAL', code: 'FIN_001', title: 'Obtain T12 Operating Statements',
    description: 'Request trailing 12-month operating statements',
    defaultResponsible: 'SELLER', priority: 'CRITICAL', requiresDocument: true,
    documentTypes: JSON.stringify(['T12', 'OPERATING_STATEMENT']),
    deadlineType: 'LOI_ACCEPTED', deadlineDaysOffset: 0,
    availableFromState: DEAL_STATES.LOI_ACCEPTED,
    aiAutoMatch: true, aiKeywords: JSON.stringify(['T12', 'trailing twelve', 'operating statement', 'P&L', 'income statement']),
    displayOrder: 1
  },
  {
    categoryCode: 'FINANCIAL', code: 'FIN_002', title: 'Verify T12 Against Bank Statements',
    description: 'Cross-reference T12 with bank statements',
    defaultResponsible: 'BUYER', priority: 'HIGH', requiresDocument: true,
    documentTypes: JSON.stringify(['BANK_STATEMENTS']),
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -10,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    dependsOn: JSON.stringify(['FIN_001']),
    aiAutoMatch: true, aiKeywords: JSON.stringify(['bank statement', 'deposit verification']),
    displayOrder: 2
  },
  {
    categoryCode: 'FINANCIAL', code: 'FIN_003', title: 'Obtain 3-Year Operating History',
    description: 'Request 3-year historical operating statements',
    defaultResponsible: 'SELLER', priority: 'HIGH', requiresDocument: true,
    documentTypes: JSON.stringify(['HISTORICAL_FINANCIALS']),
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -14,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    displayOrder: 3
  },
  {
    categoryCode: 'FINANCIAL', code: 'FIN_004', title: 'Current Year Budget Analysis',
    description: 'Review current year budget vs actuals',
    defaultResponsible: 'BUYER', priority: 'MEDIUM', requiresDocument: true,
    documentTypes: JSON.stringify(['BUDGET']),
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -10,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    displayOrder: 4
  },
  {
    categoryCode: 'FINANCIAL', code: 'FIN_005', title: 'Review Rent Roll',
    description: 'Review current certified rent roll',
    defaultResponsible: 'BUYER', priority: 'CRITICAL', requiresDocument: true,
    documentTypes: JSON.stringify(['RENT_ROLL']),
    deadlineType: 'LOI_ACCEPTED', deadlineDaysOffset: 0,
    availableFromState: DEAL_STATES.LOI_ACCEPTED,
    aiAutoMatch: true, aiKeywords: JSON.stringify(['rent roll', 'tenant roster', 'unit mix']),
    displayOrder: 5
  },
  {
    categoryCode: 'FINANCIAL', code: 'FIN_006', title: 'Rent Roll vs Lease Audit',
    description: 'Compare rent roll to actual leases',
    defaultResponsible: 'BUYER', priority: 'HIGH', requiresDocument: false,
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -7,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    dependsOn: JSON.stringify(['FIN_005', 'TENANT_001']),
    displayOrder: 6
  },
  {
    categoryCode: 'FINANCIAL', code: 'FIN_007', title: 'Bad Debt/Collections Analysis',
    description: 'Analyze bad debt and collections history',
    defaultResponsible: 'BUYER', priority: 'HIGH', requiresDocument: false,
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -7,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    displayOrder: 7
  },
  {
    categoryCode: 'FINANCIAL', code: 'FIN_008', title: 'Utility Expense Analysis',
    description: 'Review utility bills and RUBS analysis',
    defaultResponsible: 'BUYER', priority: 'MEDIUM', requiresDocument: true,
    documentTypes: JSON.stringify(['UTILITY_BILLS', 'RUBS_ANALYSIS']),
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -10,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    displayOrder: 8
  },
  {
    categoryCode: 'FINANCIAL', code: 'FIN_009', title: 'Real Estate Tax Review',
    description: 'Review tax bills and reassessment risk',
    defaultResponsible: 'BUYER', priority: 'HIGH', requiresDocument: true,
    documentTypes: JSON.stringify(['TAX_BILLS', 'TAX_ASSESSMENT']),
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -10,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    aiAutoMatch: true, aiKeywords: JSON.stringify(['property tax', 'tax bill', 'tax assessment']),
    displayOrder: 9
  },
  {
    categoryCode: 'FINANCIAL', code: 'FIN_010', title: 'Insurance Cost Verification',
    description: 'Verify insurance costs and coverage',
    defaultResponsible: 'BUYER', priority: 'MEDIUM', requiresDocument: true,
    documentTypes: JSON.stringify(['INSURANCE_DEC_PAGE']),
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -10,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    displayOrder: 10
  },
  {
    categoryCode: 'FINANCIAL', code: 'FIN_011', title: 'Payroll/Management Fee Analysis',
    description: 'Analyze payroll and management fees',
    defaultResponsible: 'BUYER', priority: 'MEDIUM', requiresDocument: false,
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -7,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    displayOrder: 11
  },
  {
    categoryCode: 'FINANCIAL', code: 'FIN_012', title: 'Capital Improvement History',
    description: 'Review recent capital improvements',
    defaultResponsible: 'SELLER', priority: 'MEDIUM', requiresDocument: true,
    documentTypes: JSON.stringify(['CAPEX_HISTORY', 'IMPROVEMENT_RECORDS']),
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -10,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    displayOrder: 12
  },
  {
    categoryCode: 'FINANCIAL', code: 'FIN_013', title: 'Accounts Payable Review',
    description: 'Review outstanding accounts payable',
    defaultResponsible: 'BUYER', priority: 'MEDIUM', requiresDocument: true,
    documentTypes: JSON.stringify(['AP_AGING', 'ACCOUNTS_PAYABLE']),
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -7,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    displayOrder: 13
  },
  {
    categoryCode: 'FINANCIAL', code: 'FIN_014', title: 'Security Deposit Reconciliation',
    description: 'Reconcile security deposits with ledger',
    defaultResponsible: 'BUYER', priority: 'HIGH', requiresDocument: true,
    documentTypes: JSON.stringify(['SECURITY_DEPOSIT_LEDGER']),
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -5,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    displayOrder: 14
  },

  // ========== TENANT & LEASE MATTERS (12 items) ==========
  {
    categoryCode: 'TENANT', code: 'TENANT_001', title: 'Obtain All Lease Copies',
    description: 'Collect copies of all tenant leases',
    defaultResponsible: 'SELLER', priority: 'CRITICAL', requiresDocument: true,
    documentTypes: JSON.stringify(['LEASE', 'LEASE_AGREEMENT']),
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -14,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    aiAutoMatch: true, aiKeywords: JSON.stringify(['lease', 'rental agreement', 'tenant agreement']),
    displayOrder: 1
  },
  {
    categoryCode: 'TENANT', code: 'TENANT_002', title: 'Lease Abstract Preparation',
    description: 'Prepare lease abstracts for all leases',
    defaultResponsible: 'BUYER', priority: 'HIGH', requiresDocument: true,
    documentTypes: JSON.stringify(['LEASE_ABSTRACT']),
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -10,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    dependsOn: JSON.stringify(['TENANT_001']),
    displayOrder: 2
  },
  {
    categoryCode: 'TENANT', code: 'TENANT_003', title: 'Lease Audit vs Rent Roll',
    description: 'Audit leases against rent roll',
    defaultResponsible: 'COUNSEL', priority: 'HIGH', requiresDocument: false,
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -7,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    dependsOn: JSON.stringify(['TENANT_001', 'FIN_005']),
    displayOrder: 3
  },
  {
    categoryCode: 'TENANT', code: 'TENANT_004', title: 'Review Lease Terms',
    description: 'Review renewal options and key terms',
    defaultResponsible: 'COUNSEL', priority: 'HIGH', requiresDocument: false,
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -7,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    dependsOn: JSON.stringify(['TENANT_001']),
    displayOrder: 4
  },
  {
    categoryCode: 'TENANT', code: 'TENANT_005', title: 'Identify Problem Tenants',
    description: 'Identify tenants with issues or delinquencies',
    defaultResponsible: 'BUYER', priority: 'HIGH', requiresDocument: false,
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -7,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    displayOrder: 5
  },
  {
    categoryCode: 'TENANT', code: 'TENANT_006', title: 'Pending Litigation Review',
    description: 'Review pending tenant litigation',
    defaultResponsible: 'COUNSEL', priority: 'HIGH', requiresDocument: true,
    documentTypes: JSON.stringify(['LITIGATION_SUMMARY']),
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -7,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    displayOrder: 6
  },
  {
    categoryCode: 'TENANT', code: 'TENANT_007', title: 'Eviction History Analysis',
    description: 'Review eviction history and patterns',
    defaultResponsible: 'BUYER', priority: 'MEDIUM', requiresDocument: true,
    documentTypes: JSON.stringify(['EVICTION_RECORDS']),
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -7,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    displayOrder: 7
  },
  {
    categoryCode: 'TENANT', code: 'TENANT_008', title: 'Send Estoppel Certificates',
    description: 'Send estoppel certificates to tenants',
    defaultResponsible: 'SELLER', priority: 'CRITICAL', requiresDocument: true,
    documentTypes: JSON.stringify(['ESTOPPEL_CERTIFICATE']),
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -14,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    aiAutoMatch: true, aiKeywords: JSON.stringify(['estoppel', 'tenant certificate']),
    displayOrder: 8
  },
  {
    categoryCode: 'TENANT', code: 'TENANT_009', title: 'Receive Estoppel Certificates',
    description: 'Collect signed estoppel certificates',
    defaultResponsible: 'SELLER', priority: 'CRITICAL', requiresDocument: true,
    documentTypes: JSON.stringify(['SIGNED_ESTOPPEL']),
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -5,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    dependsOn: JSON.stringify(['TENANT_008']),
    displayOrder: 9
  },
  {
    categoryCode: 'TENANT', code: 'TENANT_010', title: 'Review Estoppel Responses',
    description: 'Review estoppel certificate responses',
    defaultResponsible: 'COUNSEL', priority: 'HIGH', requiresDocument: false,
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -3,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    dependsOn: JSON.stringify(['TENANT_009']),
    displayOrder: 10
  },
  {
    categoryCode: 'TENANT', code: 'TENANT_011', title: 'Prepare SNDAs',
    description: 'Prepare SNDAs if required by lender',
    defaultResponsible: 'LENDER', priority: 'HIGH', requiresDocument: true,
    documentTypes: JSON.stringify(['SNDA']),
    deadlineType: 'FINANCING_IN_PROGRESS', deadlineDaysOffset: 5,
    availableFromState: DEAL_STATES.FINANCING_IN_PROGRESS,
    aiAutoMatch: true, aiKeywords: JSON.stringify(['SNDA', 'subordination', 'non-disturbance', 'attornment']),
    displayOrder: 11
  },
  {
    categoryCode: 'TENANT', code: 'TENANT_012', title: 'Obtain SNDA Signatures',
    description: 'Collect signed SNDAs from tenants',
    defaultResponsible: 'SELLER', priority: 'HIGH', requiresDocument: true,
    documentTypes: JSON.stringify(['SIGNED_SNDA']),
    deadlineType: 'CLOSING_RELATIVE', deadlineDaysOffset: -5,
    availableFromState: DEAL_STATES.FINANCING_COMMITTED,
    dependsOn: JSON.stringify(['TENANT_011']),
    displayOrder: 12
  },

  // ========== ZONING & ENTITLEMENTS (8 items) ==========
  {
    categoryCode: 'ZONING', code: 'ZONE_001', title: 'Obtain Zoning Letter',
    description: 'Obtain zoning letter or certificate from municipality',
    defaultResponsible: 'BUYER', priority: 'HIGH', requiresDocument: true,
    documentTypes: JSON.stringify(['ZONING_LETTER', 'ZONING_CERTIFICATE']),
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -14,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    aiAutoMatch: true, aiKeywords: JSON.stringify(['zoning letter', 'zoning certificate', 'zoning compliance']),
    displayOrder: 1
  },
  {
    categoryCode: 'ZONING', code: 'ZONE_002', title: 'Verify Permitted Use',
    description: 'Confirm property use is permitted',
    defaultResponsible: 'COUNSEL', priority: 'HIGH', requiresDocument: false,
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -10,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    dependsOn: JSON.stringify(['ZONE_001']),
    displayOrder: 2
  },
  {
    categoryCode: 'ZONING', code: 'ZONE_003', title: 'Review Parking Requirements',
    description: 'Verify parking compliance with zoning',
    defaultResponsible: 'BUYER', priority: 'MEDIUM', requiresDocument: false,
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -10,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    displayOrder: 3
  },
  {
    categoryCode: 'ZONING', code: 'ZONE_004', title: 'Certificate of Occupancy Review',
    description: 'Review certificate of occupancy',
    defaultResponsible: 'BUYER', priority: 'HIGH', requiresDocument: true,
    documentTypes: JSON.stringify(['CERTIFICATE_OF_OCCUPANCY', 'C_OF_O']),
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -10,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    aiAutoMatch: true, aiKeywords: JSON.stringify(['certificate of occupancy', 'C of O', 'CO']),
    displayOrder: 4
  },
  {
    categoryCode: 'ZONING', code: 'ZONE_005', title: 'Building Permits History',
    description: 'Review building permit history',
    defaultResponsible: 'BUYER', priority: 'MEDIUM', requiresDocument: true,
    documentTypes: JSON.stringify(['BUILDING_PERMITS']),
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -10,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    displayOrder: 5
  },
  {
    categoryCode: 'ZONING', code: 'ZONE_006', title: 'Code Violation Search',
    description: 'Search for open code violations',
    defaultResponsible: 'BUYER', priority: 'HIGH', requiresDocument: true,
    documentTypes: JSON.stringify(['CODE_VIOLATION_SEARCH']),
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -10,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    displayOrder: 6
  },
  {
    categoryCode: 'ZONING', code: 'ZONE_007', title: 'Pending Development Review',
    description: 'Research pending development in area',
    defaultResponsible: 'BUYER', priority: 'MEDIUM', requiresDocument: false,
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -7,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    displayOrder: 7
  },
  {
    categoryCode: 'ZONING', code: 'ZONE_008', title: 'HOA/Condo Docs',
    description: 'Review HOA or condo docs if applicable',
    defaultResponsible: 'BUYER', priority: 'MEDIUM', requiresDocument: true,
    documentTypes: JSON.stringify(['HOA_DOCS', 'CONDO_DOCS', 'CC_AND_RS']),
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -10,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    displayOrder: 8
  },

  // ========== SERVICE CONTRACTS (8 items) ==========
  {
    categoryCode: 'CONTRACTS', code: 'CONTRACT_001', title: 'Inventory All Service Contracts',
    description: 'Collect all service and vendor contracts',
    defaultResponsible: 'SELLER', priority: 'HIGH', requiresDocument: true,
    documentTypes: JSON.stringify(['SERVICE_CONTRACT', 'VENDOR_CONTRACT']),
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -14,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    aiAutoMatch: true, aiKeywords: JSON.stringify(['service contract', 'vendor agreement', 'maintenance contract']),
    displayOrder: 1
  },
  {
    categoryCode: 'CONTRACTS', code: 'CONTRACT_002', title: 'Review Contract Terms',
    description: 'Review terms and conditions of contracts',
    defaultResponsible: 'COUNSEL', priority: 'HIGH', requiresDocument: false,
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -10,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    dependsOn: JSON.stringify(['CONTRACT_001']),
    displayOrder: 2
  },
  {
    categoryCode: 'CONTRACTS', code: 'CONTRACT_003', title: 'Identify Assumable vs Terminable',
    description: 'Identify which contracts are assumable',
    defaultResponsible: 'COUNSEL', priority: 'HIGH', requiresDocument: false,
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -7,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    dependsOn: JSON.stringify(['CONTRACT_002']),
    displayOrder: 3
  },
  {
    categoryCode: 'CONTRACTS', code: 'CONTRACT_004', title: 'Management Agreement Review',
    description: 'Review property management agreement',
    defaultResponsible: 'COUNSEL', priority: 'HIGH', requiresDocument: true,
    documentTypes: JSON.stringify(['MANAGEMENT_AGREEMENT']),
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -10,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    aiAutoMatch: true, aiKeywords: JSON.stringify(['management agreement', 'property management', 'PM agreement']),
    displayOrder: 4
  },
  {
    categoryCode: 'CONTRACTS', code: 'CONTRACT_005', title: 'Utility Contract Review',
    description: 'Review utility contracts and accounts',
    defaultResponsible: 'BUYER', priority: 'MEDIUM', requiresDocument: true,
    documentTypes: JSON.stringify(['UTILITY_CONTRACT']),
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -10,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    displayOrder: 5
  },
  {
    categoryCode: 'CONTRACTS', code: 'CONTRACT_006', title: 'Equipment Lease Review',
    description: 'Review equipment leases (HVAC, laundry, etc.)',
    defaultResponsible: 'COUNSEL', priority: 'MEDIUM', requiresDocument: true,
    documentTypes: JSON.stringify(['EQUIPMENT_LEASE']),
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -10,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    displayOrder: 6
  },
  {
    categoryCode: 'CONTRACTS', code: 'CONTRACT_007', title: 'Vendor Notification List',
    description: 'Prepare vendor notification list',
    defaultResponsible: 'BUYER', priority: 'LOW', requiresDocument: false,
    deadlineType: 'CLOSING_RELATIVE', deadlineDaysOffset: -5,
    availableFromState: DEAL_STATES.FINANCING_COMMITTED,
    displayOrder: 7
  },
  {
    categoryCode: 'CONTRACTS', code: 'CONTRACT_008', title: 'Contract Assignment Letters',
    description: 'Prepare contract assignment letters',
    defaultResponsible: 'COUNSEL', priority: 'MEDIUM', requiresDocument: true,
    documentTypes: JSON.stringify(['CONTRACT_ASSIGNMENT']),
    deadlineType: 'CLOSING_RELATIVE', deadlineDaysOffset: -3,
    availableFromState: DEAL_STATES.CLEAR_TO_CLOSE,
    displayOrder: 8
  },

  // ========== INSURANCE (6 items) ==========
  {
    categoryCode: 'INSURANCE', code: 'INS_001', title: 'Obtain Current Insurance Policies',
    description: 'Obtain copies of current insurance policies',
    defaultResponsible: 'SELLER', priority: 'HIGH', requiresDocument: true,
    documentTypes: JSON.stringify(['INSURANCE_POLICY', 'INSURANCE_DEC_PAGE']),
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -14,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    aiAutoMatch: true, aiKeywords: JSON.stringify(['insurance policy', 'dec page', 'insurance certificate']),
    displayOrder: 1
  },
  {
    categoryCode: 'INSURANCE', code: 'INS_002', title: 'Review Coverage Amounts',
    description: 'Review insurance coverage amounts',
    defaultResponsible: 'BUYER', priority: 'HIGH', requiresDocument: false,
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -10,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    dependsOn: JSON.stringify(['INS_001']),
    displayOrder: 2
  },
  {
    categoryCode: 'INSURANCE', code: 'INS_003', title: 'Claims History (5 years)',
    description: 'Obtain 5-year insurance claims history',
    defaultResponsible: 'BUYER', priority: 'HIGH', requiresDocument: true,
    documentTypes: JSON.stringify(['CLAIMS_HISTORY', 'LOSS_RUNS']),
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -10,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    aiAutoMatch: true, aiKeywords: JSON.stringify(['claims history', 'loss runs', 'insurance claims']),
    displayOrder: 3
  },
  {
    categoryCode: 'INSURANCE', code: 'INS_004', title: 'Obtain New Insurance Quotes',
    description: 'Obtain insurance quotes for new policy',
    defaultResponsible: 'BUYER', priority: 'HIGH', requiresDocument: true,
    documentTypes: JSON.stringify(['INSURANCE_QUOTE']),
    deadlineType: 'CLOSING_RELATIVE', deadlineDaysOffset: -14,
    availableFromState: DEAL_STATES.FINANCING_COMMITTED,
    displayOrder: 4
  },
  {
    categoryCode: 'INSURANCE', code: 'INS_005', title: 'Flood Zone Determination',
    description: 'Obtain flood zone determination',
    defaultResponsible: 'BUYER', priority: 'HIGH', requiresDocument: true,
    documentTypes: JSON.stringify(['FLOOD_CERTIFICATE', 'FLOOD_DETERMINATION']),
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -10,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    aiAutoMatch: true, aiKeywords: JSON.stringify(['flood zone', 'FEMA', 'flood certificate', 'flood determination']),
    displayOrder: 5
  },
  {
    categoryCode: 'INSURANCE', code: 'INS_006', title: 'Lender Insurance Requirements',
    description: 'Review lender insurance requirements',
    defaultResponsible: 'LENDER', priority: 'HIGH', requiresDocument: false,
    deadlineType: 'FINANCING_IN_PROGRESS', deadlineDaysOffset: 5,
    availableFromState: DEAL_STATES.FINANCING_IN_PROGRESS,
    displayOrder: 6
  },

  // ========== FINANCING (10 items) ==========
  {
    categoryCode: 'FINANCING', code: 'LOAN_001', title: 'Submit Loan Application',
    description: 'Submit loan application to lender',
    defaultResponsible: 'BUYER', priority: 'CRITICAL', requiresDocument: true,
    documentTypes: JSON.stringify(['LOAN_APPLICATION']),
    deadlineType: 'PSA_EXECUTED', deadlineDaysOffset: 5,
    availableFromState: DEAL_STATES.PSA_EXECUTED,
    aiAutoMatch: true, aiKeywords: JSON.stringify(['loan application', 'financing application']),
    displayOrder: 1
  },
  {
    categoryCode: 'FINANCING', code: 'LOAN_002', title: 'Provide Lender DD Package',
    description: 'Provide due diligence package to lender',
    defaultResponsible: 'BUYER', priority: 'HIGH', requiresDocument: true,
    documentTypes: JSON.stringify(['LENDER_DD_PACKAGE']),
    deadlineType: 'FINANCING_IN_PROGRESS', deadlineDaysOffset: 3,
    availableFromState: DEAL_STATES.FINANCING_IN_PROGRESS,
    displayOrder: 2
  },
  {
    categoryCode: 'FINANCING', code: 'LOAN_003', title: 'Order Appraisal',
    description: 'Lender orders appraisal',
    defaultResponsible: 'LENDER', priority: 'CRITICAL', requiresDocument: true,
    documentTypes: JSON.stringify(['APPRAISAL']),
    deadlineType: 'FINANCING_IN_PROGRESS', deadlineDaysOffset: 5,
    availableFromState: DEAL_STATES.FINANCING_IN_PROGRESS,
    aiAutoMatch: true, aiKeywords: JSON.stringify(['appraisal', 'property valuation', 'MAI appraisal']),
    displayOrder: 3
  },
  {
    categoryCode: 'FINANCING', code: 'LOAN_004', title: 'Review Appraisal',
    description: 'Review appraisal for value and issues',
    defaultResponsible: 'BUYER', priority: 'HIGH', requiresDocument: false,
    deadlineType: 'FINANCING_IN_PROGRESS', deadlineDaysOffset: 10,
    availableFromState: DEAL_STATES.FINANCING_IN_PROGRESS,
    dependsOn: JSON.stringify(['LOAN_003']),
    displayOrder: 4
  },
  {
    categoryCode: 'FINANCING', code: 'LOAN_005', title: 'Receive Loan Commitment',
    description: 'Receive loan commitment letter',
    defaultResponsible: 'LENDER', priority: 'CRITICAL', requiresDocument: true,
    documentTypes: JSON.stringify(['LOAN_COMMITMENT', 'COMMITMENT_LETTER']),
    deadlineType: 'FINANCING_IN_PROGRESS', deadlineDaysOffset: 14,
    availableFromState: DEAL_STATES.FINANCING_IN_PROGRESS,
    aiAutoMatch: true, aiKeywords: JSON.stringify(['loan commitment', 'commitment letter', 'term sheet']),
    displayOrder: 5
  },
  {
    categoryCode: 'FINANCING', code: 'LOAN_006', title: 'Review Loan Terms',
    description: 'Review loan commitment terms',
    defaultResponsible: 'COUNSEL', priority: 'CRITICAL', requiresDocument: false,
    deadlineType: 'FINANCING_COMMITTED', deadlineDaysOffset: 3,
    availableFromState: DEAL_STATES.FINANCING_COMMITTED,
    dependsOn: JSON.stringify(['LOAN_005']),
    displayOrder: 6
  },
  {
    categoryCode: 'FINANCING', code: 'LOAN_007', title: 'Satisfy Loan Conditions',
    description: 'Satisfy all loan commitment conditions',
    defaultResponsible: 'BUYER', priority: 'HIGH', requiresDocument: true,
    deadlineType: 'CLOSING_RELATIVE', deadlineDaysOffset: -7,
    availableFromState: DEAL_STATES.FINANCING_COMMITTED,
    displayOrder: 7
  },
  {
    categoryCode: 'FINANCING', code: 'LOAN_008', title: 'Receive Loan Documents',
    description: 'Receive loan documents from lender',
    defaultResponsible: 'LENDER', priority: 'CRITICAL', requiresDocument: true,
    documentTypes: JSON.stringify(['LOAN_DOCUMENTS', 'NOTE', 'MORTGAGE']),
    deadlineType: 'CLOSING_RELATIVE', deadlineDaysOffset: -5,
    availableFromState: DEAL_STATES.FINANCING_COMMITTED,
    aiAutoMatch: true, aiKeywords: JSON.stringify(['loan documents', 'promissory note', 'mortgage', 'deed of trust']),
    displayOrder: 8
  },
  {
    categoryCode: 'FINANCING', code: 'LOAN_009', title: 'Review Loan Documents',
    description: 'Review loan documents with counsel',
    defaultResponsible: 'COUNSEL', priority: 'CRITICAL', requiresDocument: false,
    deadlineType: 'CLOSING_RELATIVE', deadlineDaysOffset: -3,
    availableFromState: DEAL_STATES.CLEAR_TO_CLOSE,
    dependsOn: JSON.stringify(['LOAN_008']),
    displayOrder: 9
  },
  {
    categoryCode: 'FINANCING', code: 'LOAN_010', title: 'Lender Clear to Fund',
    description: 'Lender confirms clear to fund',
    defaultResponsible: 'LENDER', priority: 'CRITICAL', requiresDocument: true,
    documentTypes: JSON.stringify(['CLEAR_TO_FUND']),
    deadlineType: 'CLOSING_RELATIVE', deadlineDaysOffset: -1,
    availableFromState: DEAL_STATES.CLEAR_TO_CLOSE,
    displayOrder: 10
  },

  // ========== CLOSING PREPARATION (14 items) ==========
  {
    categoryCode: 'CLOSING', code: 'CLOSE_001', title: 'Draft Deed',
    description: 'Draft warranty deed or grant deed',
    defaultResponsible: 'COUNSEL', priority: 'CRITICAL', requiresDocument: true,
    documentTypes: JSON.stringify(['DEED', 'WARRANTY_DEED', 'GRANT_DEED']),
    deadlineType: 'CLOSING_RELATIVE', deadlineDaysOffset: -7,
    availableFromState: DEAL_STATES.FINANCING_COMMITTED,
    aiAutoMatch: true, aiKeywords: JSON.stringify(['deed', 'warranty deed', 'grant deed']),
    displayOrder: 1
  },
  {
    categoryCode: 'CLOSING', code: 'CLOSE_002', title: 'Draft Bill of Sale',
    description: 'Draft bill of sale for personal property',
    defaultResponsible: 'COUNSEL', priority: 'HIGH', requiresDocument: true,
    documentTypes: JSON.stringify(['BILL_OF_SALE']),
    deadlineType: 'CLOSING_RELATIVE', deadlineDaysOffset: -5,
    availableFromState: DEAL_STATES.FINANCING_COMMITTED,
    displayOrder: 2
  },
  {
    categoryCode: 'CLOSING', code: 'CLOSE_003', title: 'Draft Assignment of Leases',
    description: 'Draft assignment and assumption of leases',
    defaultResponsible: 'COUNSEL', priority: 'HIGH', requiresDocument: true,
    documentTypes: JSON.stringify(['ASSIGNMENT_OF_LEASES']),
    deadlineType: 'CLOSING_RELATIVE', deadlineDaysOffset: -5,
    availableFromState: DEAL_STATES.FINANCING_COMMITTED,
    displayOrder: 3
  },
  {
    categoryCode: 'CLOSING', code: 'CLOSE_004', title: 'Draft Assignment of Contracts',
    description: 'Draft assignment of service contracts',
    defaultResponsible: 'COUNSEL', priority: 'MEDIUM', requiresDocument: true,
    documentTypes: JSON.stringify(['ASSIGNMENT_OF_CONTRACTS']),
    deadlineType: 'CLOSING_RELATIVE', deadlineDaysOffset: -5,
    availableFromState: DEAL_STATES.FINANCING_COMMITTED,
    displayOrder: 4
  },
  {
    categoryCode: 'CLOSING', code: 'CLOSE_005', title: 'FIRPTA Affidavit',
    description: 'Obtain FIRPTA affidavit from seller',
    defaultResponsible: 'SELLER', priority: 'CRITICAL', requiresDocument: true,
    documentTypes: JSON.stringify(['FIRPTA', 'FIRPTA_AFFIDAVIT']),
    deadlineType: 'CLOSING_RELATIVE', deadlineDaysOffset: -3,
    availableFromState: DEAL_STATES.CLEAR_TO_CLOSE,
    aiAutoMatch: true, aiKeywords: JSON.stringify(['FIRPTA', 'foreign investment', 'non-foreign affidavit']),
    displayOrder: 5
  },
  {
    categoryCode: 'CLOSING', code: 'CLOSE_006', title: 'Entity Authorization/Resolution',
    description: 'Obtain entity authorization documents',
    defaultResponsible: 'BOTH', priority: 'HIGH', requiresDocument: true,
    documentTypes: JSON.stringify(['RESOLUTION', 'AUTHORIZATION', 'CERTIFICATE_OF_GOOD_STANDING']),
    deadlineType: 'CLOSING_RELATIVE', deadlineDaysOffset: -5,
    availableFromState: DEAL_STATES.FINANCING_COMMITTED,
    displayOrder: 6
  },
  {
    categoryCode: 'CLOSING', code: 'CLOSE_007', title: "Seller's Closing Certificate",
    description: 'Obtain seller representations certificate',
    defaultResponsible: 'SELLER', priority: 'HIGH', requiresDocument: true,
    documentTypes: JSON.stringify(['SELLER_CERTIFICATE']),
    deadlineType: 'CLOSING_RELATIVE', deadlineDaysOffset: -2,
    availableFromState: DEAL_STATES.CLEAR_TO_CLOSE,
    displayOrder: 7
  },
  {
    categoryCode: 'CLOSING', code: 'CLOSE_008', title: "Buyer's Closing Certificate",
    description: 'Prepare buyer representations certificate',
    defaultResponsible: 'BUYER', priority: 'HIGH', requiresDocument: true,
    documentTypes: JSON.stringify(['BUYER_CERTIFICATE']),
    deadlineType: 'CLOSING_RELATIVE', deadlineDaysOffset: -2,
    availableFromState: DEAL_STATES.CLEAR_TO_CLOSE,
    displayOrder: 8
  },
  {
    categoryCode: 'CLOSING', code: 'CLOSE_009', title: 'Tenant Notification Letters',
    description: 'Prepare tenant notification letters',
    defaultResponsible: 'BUYER', priority: 'MEDIUM', requiresDocument: true,
    documentTypes: JSON.stringify(['TENANT_NOTIFICATION']),
    deadlineType: 'CLOSING_RELATIVE', deadlineDaysOffset: -3,
    availableFromState: DEAL_STATES.CLEAR_TO_CLOSE,
    displayOrder: 9
  },
  {
    categoryCode: 'CLOSING', code: 'CLOSE_010', title: 'Vendor Notification Letters',
    description: 'Prepare vendor notification letters',
    defaultResponsible: 'BUYER', priority: 'LOW', requiresDocument: true,
    documentTypes: JSON.stringify(['VENDOR_NOTIFICATION']),
    deadlineType: 'CLOSING_RELATIVE', deadlineDaysOffset: -3,
    availableFromState: DEAL_STATES.CLEAR_TO_CLOSE,
    displayOrder: 10
  },
  {
    categoryCode: 'CLOSING', code: 'CLOSE_011', title: 'Proration Calculations',
    description: 'Prepare closing proration calculations',
    defaultResponsible: 'TITLE_CO', priority: 'HIGH', requiresDocument: true,
    documentTypes: JSON.stringify(['PRORATION_WORKSHEET']),
    deadlineType: 'CLOSING_RELATIVE', deadlineDaysOffset: -3,
    availableFromState: DEAL_STATES.CLEAR_TO_CLOSE,
    displayOrder: 11
  },
  {
    categoryCode: 'CLOSING', code: 'CLOSE_012', title: 'Settlement Statement Approval',
    description: 'Approve final settlement statement',
    defaultResponsible: 'BOTH', priority: 'CRITICAL', requiresDocument: true,
    documentTypes: JSON.stringify(['SETTLEMENT_STATEMENT', 'HUD', 'CLOSING_STATEMENT']),
    deadlineType: 'CLOSING_RELATIVE', deadlineDaysOffset: -2,
    availableFromState: DEAL_STATES.CLEAR_TO_CLOSE,
    aiAutoMatch: true, aiKeywords: JSON.stringify(['settlement statement', 'HUD', 'closing statement', 'closing disclosure']),
    displayOrder: 12
  },
  {
    categoryCode: 'CLOSING', code: 'CLOSE_013', title: 'Wire Instructions Verification',
    description: 'Verify and confirm wire instructions',
    defaultResponsible: 'BOTH', priority: 'CRITICAL', requiresDocument: true,
    documentTypes: JSON.stringify(['WIRE_INSTRUCTIONS']),
    deadlineType: 'CLOSING_RELATIVE', deadlineDaysOffset: -1,
    availableFromState: DEAL_STATES.CLEAR_TO_CLOSE,
    displayOrder: 13
  },
  {
    categoryCode: 'CLOSING', code: 'CLOSE_014', title: 'Closing Checklist Final Review',
    description: 'Final review of all closing requirements',
    defaultResponsible: 'BOTH', priority: 'CRITICAL', requiresDocument: false,
    deadlineType: 'CLOSING_RELATIVE', deadlineDaysOffset: -1,
    availableFromState: DEAL_STATES.CLEAR_TO_CLOSE,
    displayOrder: 14
  },

  // ========== SITE VISITS & INSPECTIONS (6 items) ==========
  {
    categoryCode: 'SITE', code: 'SITE_001', title: 'Initial Site Visit',
    description: 'Conduct initial property inspection',
    defaultResponsible: 'BUYER', priority: 'CRITICAL', requiresDocument: false,
    deadlineType: 'LOI_ACCEPTED', deadlineDaysOffset: 3,
    availableFromState: DEAL_STATES.LOI_ACCEPTED,
    displayOrder: 1
  },
  {
    categoryCode: 'SITE', code: 'SITE_002', title: 'Unit Inspections (Sample)',
    description: 'Inspect sample of units',
    defaultResponsible: 'BUYER', priority: 'HIGH', requiresDocument: true,
    documentTypes: JSON.stringify(['UNIT_INSPECTION_REPORT']),
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -10,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    displayOrder: 2
  },
  {
    categoryCode: 'SITE', code: 'SITE_003', title: 'Common Area Inspection',
    description: 'Inspect common areas and amenities',
    defaultResponsible: 'BUYER', priority: 'HIGH', requiresDocument: true,
    documentTypes: JSON.stringify(['COMMON_AREA_INSPECTION']),
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -10,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    displayOrder: 3
  },
  {
    categoryCode: 'SITE', code: 'SITE_004', title: 'Market Comp Tour',
    description: 'Tour comparable properties in market',
    defaultResponsible: 'BUYER', priority: 'MEDIUM', requiresDocument: false,
    deadlineType: 'DD_RELATIVE', deadlineDaysOffset: -7,
    availableFromState: DEAL_STATES.DD_ACTIVE,
    displayOrder: 4
  },
  {
    categoryCode: 'SITE', code: 'SITE_005', title: 'Final Walk-Through',
    description: 'Conduct final pre-closing walk-through',
    defaultResponsible: 'BUYER', priority: 'CRITICAL', requiresDocument: false,
    deadlineType: 'CLOSING_RELATIVE', deadlineDaysOffset: -1,
    availableFromState: DEAL_STATES.CLEAR_TO_CLOSE,
    displayOrder: 5
  },
  {
    categoryCode: 'SITE', code: 'SITE_006', title: 'Pre-Closing Property Condition',
    description: 'Document property condition before closing',
    defaultResponsible: 'BUYER', priority: 'HIGH', requiresDocument: true,
    documentTypes: JSON.stringify(['PRE_CLOSING_CONDITION_REPORT']),
    deadlineType: 'CLOSING_RELATIVE', deadlineDaysOffset: -1,
    availableFromState: DEAL_STATES.CLEAR_TO_CLOSE,
    displayOrder: 6
  },

  // ========== POST-CLOSING (8 items) ==========
  {
    categoryCode: 'POST_CLOSING', code: 'POST_001', title: 'Record Deed',
    description: 'Record deed with county',
    defaultResponsible: 'TITLE_CO', priority: 'CRITICAL', requiresDocument: true,
    documentTypes: JSON.stringify(['RECORDED_DEED']),
    deadlineType: 'CLOSING_RELATIVE', deadlineDaysOffset: 1,
    availableFromState: DEAL_STATES.CLOSED,
    displayOrder: 1
  },
  {
    categoryCode: 'POST_CLOSING', code: 'POST_002', title: 'Send Tenant Notifications',
    description: 'Send ownership change notices to tenants',
    defaultResponsible: 'BUYER', priority: 'HIGH', requiresDocument: true,
    deadlineType: 'CLOSING_RELATIVE', deadlineDaysOffset: 3,
    availableFromState: DEAL_STATES.CLOSED,
    displayOrder: 2
  },
  {
    categoryCode: 'POST_CLOSING', code: 'POST_003', title: 'Transfer Utilities',
    description: 'Transfer utility accounts to buyer',
    defaultResponsible: 'BUYER', priority: 'HIGH', requiresDocument: false,
    deadlineType: 'CLOSING_RELATIVE', deadlineDaysOffset: 3,
    availableFromState: DEAL_STATES.CLOSED,
    displayOrder: 3
  },
  {
    categoryCode: 'POST_CLOSING', code: 'POST_004', title: 'Update Insurance',
    description: 'Update insurance to new owner',
    defaultResponsible: 'BUYER', priority: 'HIGH', requiresDocument: true,
    documentTypes: JSON.stringify(['INSURANCE_BINDER']),
    deadlineType: 'CLOSING_RELATIVE', deadlineDaysOffset: 0,
    availableFromState: DEAL_STATES.CLOSED,
    displayOrder: 4
  },
  {
    categoryCode: 'POST_CLOSING', code: 'POST_005', title: 'Management Transition',
    description: 'Complete property management transition',
    defaultResponsible: 'BUYER', priority: 'HIGH', requiresDocument: false,
    deadlineType: 'CLOSING_RELATIVE', deadlineDaysOffset: 7,
    availableFromState: DEAL_STATES.CLOSED,
    displayOrder: 5
  },
  {
    categoryCode: 'POST_CLOSING', code: 'POST_006', title: 'Security Deposit Transfer',
    description: 'Transfer security deposits to buyer',
    defaultResponsible: 'SELLER', priority: 'HIGH', requiresDocument: true,
    documentTypes: JSON.stringify(['SECURITY_DEPOSIT_TRANSFER']),
    deadlineType: 'CLOSING_RELATIVE', deadlineDaysOffset: 3,
    availableFromState: DEAL_STATES.CLOSED,
    displayOrder: 6
  },
  {
    categoryCode: 'POST_CLOSING', code: 'POST_007', title: 'Final Title Policy',
    description: 'Receive final title insurance policy',
    defaultResponsible: 'TITLE_CO', priority: 'MEDIUM', requiresDocument: true,
    documentTypes: JSON.stringify(['TITLE_POLICY']),
    deadlineType: 'CLOSING_RELATIVE', deadlineDaysOffset: 30,
    availableFromState: DEAL_STATES.CLOSED,
    displayOrder: 7
  },
  {
    categoryCode: 'POST_CLOSING', code: 'POST_008', title: 'Post-Closing Adjustments',
    description: 'Complete post-closing proration adjustments',
    defaultResponsible: 'BOTH', priority: 'MEDIUM', requiresDocument: false,
    deadlineType: 'CLOSING_RELATIVE', deadlineDaysOffset: 30,
    availableFromState: DEAL_STATES.CLOSED,
    displayOrder: 8
  },
];

async function seedDDTemplates() {
  console.log('🚀 Starting DD template seeding...\n');

  try {
    // First, delete existing data to ensure clean seed
    console.log('Cleaning existing DD template data...');
    await prisma.dDTemplateItem.deleteMany({});
    await prisma.dDCategory.deleteMany({});
    console.log('✅ Existing data cleared\n');

    // Create categories
    console.log('Creating DD categories...');
    const categoryMap = {};
    for (const cat of categories) {
      const created = await prisma.dDCategory.create({
        data: cat,
      });
      categoryMap[cat.code] = created.id;
      console.log(`  ✅ Created category: ${cat.name}`);
    }
    console.log(`\n📁 Created ${categories.length} categories\n`);

    // Create template items
    console.log('Creating DD template items...');
    let itemCount = 0;
    for (const item of templateItems) {
      const categoryId = categoryMap[item.categoryCode];
      if (!categoryId) {
        console.error(`  ❌ Category not found for code: ${item.categoryCode}`);
        continue;
      }

      const { categoryCode, ...itemData } = item;
      await prisma.dDTemplateItem.create({
        data: {
          ...itemData,
          categoryId,
        },
      });
      itemCount++;
    }
    console.log(`\n📋 Created ${itemCount} template items\n`);

    // Summary by category
    console.log('Summary by category:');
    console.log('─'.repeat(50));
    for (const cat of categories) {
      const count = templateItems.filter(i => i.categoryCode === cat.code).length;
      console.log(`  ${cat.name.padEnd(30)} ${count} items`);
    }
    console.log('─'.repeat(50));
    console.log(`  ${'TOTAL'.padEnd(30)} ${itemCount} items\n`);

    console.log('🎉 DD template seeding complete!');

  } catch (error) {
    console.error('❌ Error seeding DD templates:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the seed
seedDDTemplates()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
