/**
 * Email Document Classifier Service
 *
 * Classifies documents from email attachments using filename patterns
 * and optionally LLM for ambiguous cases.
 */

// Document type patterns for classification
// Patterns can be:
// - Simple strings: matched as substrings (e.g., 'rent roll' matches 'Q4_Rent_Roll.xlsx')
// - Regex patterns: for word-boundary matching (e.g., /\bom\b/ matches 'OM.pdf' but not 'random.pdf')
const DOCUMENT_PATTERNS = {
  LOI: ['loi', 'letter of intent', 'letter-of-intent', 'letterofintent'],
  TERM_SHEET: ['term sheet', 'term_sheet', 'termsheet', 'terms', 'ts.pdf'],
  RENT_ROLL: ['rent roll', 'rent_roll', 'rentroll', 'tenant roster', 'tenant list'],
  T12: ['t12', 't-12', 'trailing twelve', 'trailing 12', 'operating statement'],
  APPRAISAL: ['appraisal', 'valuation', 'appraisal report'],
  PSA: ['psa', 'purchase agreement', 'sale agreement', 'purchase and sale'],
  ENVIRONMENTAL: ['phase 1', 'phase i', 'environmental', 'esa', 'phase1'],
  TITLE_REPORT: ['title report', 'title commitment', 'title policy'],
  LOAN_APPLICATION: ['loan application', 'loan app', 'application form'],
  FINANCIAL_MODEL: ['proforma', 'pro forma', 'underwriting', 'financial model'],
  // 'om' uses word-boundary regex to avoid matching 'random', 'from', etc.
  // Matches: 'OM.pdf', 'deal_om.pdf', 'om-v2.pdf', but NOT 'random.pdf'
  OFFERING_MEMO: ['offering memo', 'offering memorandum', 'offering_memo', 'offeringmemo', /(?:^|[^a-z])om(?:[^a-z]|$)/],
  INSURANCE: ['insurance', 'certificate of insurance', /(?:^|[^a-z])coi(?:[^a-z]|$)/],
  SURVEY: ['survey', 'alta survey', 'plat'],
  LEASE: ['lease', 'lease agreement', 'rental agreement'],
  AMENDMENT: ['amendment', 'addendum', 'modification'],
};

// Priority order - primary documents come first for deal extraction
const PRIORITY_TYPES = ['LOI', 'TERM_SHEET', 'PSA', 'OFFERING_MEMO', 'RENT_ROLL', 'T12'];

/**
 * Check if a pattern matches the filename
 * @param {string} filename - Lowercase filename to check
 * @param {string|RegExp} pattern - Pattern to match (string or regex)
 * @returns {boolean}
 */
function matchesPattern(filename, pattern) {
  if (pattern instanceof RegExp) {
    return pattern.test(filename);
  }
  return filename.includes(pattern);
}

/**
 * Classify a document based on its filename
 * @param {string} filename - The filename to classify
 * @returns {string} - Document type (e.g., 'LOI', 'TERM_SHEET', 'OTHER')
 */
export function classifyDocumentByFilename(filename) {
  const lower = (filename || '').toLowerCase();

  for (const [type, patterns] of Object.entries(DOCUMENT_PATTERNS)) {
    if (patterns.some(pattern => matchesPattern(lower, pattern))) {
      return type;
    }
  }

  return 'OTHER';
}

/**
 * Classify multiple documents and sort by priority
 * @param {Array<{filename: string, contentType: string, size: number}>} attachments
 * @returns {Array<{filename: string, contentType: string, size: number, classifiedType: string, isPrimary: boolean}>}
 */
export function classifyAttachments(attachments) {
  const classified = attachments.map(attachment => {
    const classifiedType = classifyDocumentByFilename(attachment.filename);
    return {
      ...attachment,
      classifiedType,
      isPrimary: PRIORITY_TYPES.includes(classifiedType)
    };
  });

  // Sort: primary documents first, then by priority order
  classified.sort((a, b) => {
    if (a.isPrimary && !b.isPrimary) return -1;
    if (!a.isPrimary && b.isPrimary) return 1;

    const aIndex = PRIORITY_TYPES.indexOf(a.classifiedType);
    const bIndex = PRIORITY_TYPES.indexOf(b.classifiedType);

    if (aIndex !== -1 && bIndex !== -1) {
      return aIndex - bIndex;
    }
    if (aIndex !== -1) return -1;
    if (bIndex !== -1) return 1;

    return 0;
  });

  return classified;
}

/**
 * Find the primary document from classified attachments
 * @param {Array<{classifiedType: string, isPrimary: boolean}>} classifiedAttachments
 * @returns {Object|null} - The primary document or null
 */
export function findPrimaryDocument(classifiedAttachments) {
  return classifiedAttachments.find(a => a.isPrimary) || null;
}

/**
 * Check if file type is supported for processing
 * @param {string} filename
 * @param {string} contentType
 * @returns {boolean}
 */
export function isSupportedFileType(filename, contentType) {
  const supportedExtensions = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.png', '.jpg', '.jpeg'];
  const supportedMimeTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/png',
    'image/jpeg'
  ];

  const lower = (filename || '').toLowerCase();
  const hasValidExtension = supportedExtensions.some(ext => lower.endsWith(ext));
  const hasValidMimeType = supportedMimeTypes.includes(contentType);

  return hasValidExtension || hasValidMimeType;
}

/**
 * Get document type display name
 * @param {string} type
 * @returns {string}
 */
export function getDocumentTypeLabel(type) {
  const labels = {
    LOI: 'Letter of Intent',
    TERM_SHEET: 'Term Sheet',
    RENT_ROLL: 'Rent Roll',
    T12: 'T-12 Statement',
    APPRAISAL: 'Appraisal',
    PSA: 'Purchase & Sale Agreement',
    ENVIRONMENTAL: 'Environmental Report',
    TITLE_REPORT: 'Title Report',
    LOAN_APPLICATION: 'Loan Application',
    FINANCIAL_MODEL: 'Financial Model',
    OFFERING_MEMO: 'Offering Memorandum',
    INSURANCE: 'Insurance Certificate',
    SURVEY: 'Survey',
    LEASE: 'Lease Agreement',
    AMENDMENT: 'Amendment',
    OTHER: 'Other Document'
  };

  return labels[type] || type;
}
