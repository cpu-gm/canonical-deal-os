/**
 * Deal Claim Extractor Service
 *
 * Extracts claims from documents for the deal intake platform.
 * All extracted data is treated as "claims" with provenance - not truth until verified.
 *
 * Key principles:
 * 1. Every extracted value links to its source document and location
 * 2. Confidence scores indicate extraction reliability
 * 3. Conflicts are automatically detected when multiple sources disagree
 * 4. Nothing is accepted as fact until broker/seller confirms
 *
 * Supports:
 * - Offering Memorandums (OMs)
 * - Rent Rolls
 * - T-12 Statements
 * - LOIs / Term Sheets
 * - Photos (OCR)
 * - Pasted text
 */

import { PrismaClient } from '@prisma/client';
import { dealIngestService, ASSET_TYPES } from './deal-ingest.js';

const prisma = new PrismaClient();

// OpenAI configuration
const OPENAI_API_KEY = process.env.BFF_OPENAI_API_KEY;
const OPENAI_MODEL = process.env.BFF_OPENAI_MODEL || 'gpt-4o-mini';
const OPENAI_BASE_URL = process.env.BFF_OPENAI_BASE_URL || 'https://api.openai.com/v1';

// Extraction prompts by document type
const EXTRACTION_PROMPTS = {
  OFFERING_MEMO: `Extract the following deal information from this Offering Memorandum.
Return ONLY a JSON object with these fields (use null if not found):

{
  "propertyName": "string - name of the property",
  "propertyAddress": "string - full address including city, state, zip",
  "assetType": "string - one of: MULTIFAMILY, OFFICE, RETAIL, INDUSTRIAL, HOSPITALITY, MIXED_USE, LAND, SELF_STORAGE, SENIOR_HOUSING, STUDENT_HOUSING, MOBILE_HOME, OTHER",
  "askingPrice": number - asking price in dollars (no commas),
  "unitCount": number - total number of units,
  "totalSF": number - total square footage,
  "yearBuilt": number - year the property was built,
  "currentNOI": number - current Net Operating Income,
  "proFormaNOI": number - projected Net Operating Income,
  "capRate": number - cap rate as decimal (e.g., 0.055 for 5.5%),
  "occupancy": number - occupancy rate as decimal (e.g., 0.95 for 95%),
  "pricePerUnit": number - price per unit,
  "pricePerSF": number - price per square foot,
  "investmentHighlights": ["array of key investment highlights"],
  "brokerName": "string - listing broker name",
  "brokerFirm": "string - listing brokerage firm",
  "brokerPhone": "string - broker phone number",
  "brokerEmail": "string - broker email"
}

For each value, also provide extraction metadata:
{
  "values": { ... the JSON above ... },
  "metadata": {
    "fieldName": {
      "confidence": number 0.0-1.0,
      "pageNumber": number or null,
      "textSnippet": "quoted text from source"
    }
  }
}`,

  RENT_ROLL: `Extract rent roll summary data from this document.
Return ONLY a JSON object:

{
  "values": {
    "totalUnits": number,
    "occupiedUnits": number,
    "vacantUnits": number,
    "occupancyRate": number (decimal, e.g., 0.95),
    "totalMonthlyRent": number,
    "averageRent": number,
    "averageRentPerSF": number or null,
    "mtmUnits": number (month-to-month leases),
    "unitMix": [
      { "type": "Studio/1BR/2BR/etc", "count": number, "avgRent": number, "avgSF": number }
    ],
    "asOfDate": "string date or null"
  },
  "metadata": {
    "fieldName": {
      "confidence": number 0.0-1.0,
      "location": "cell reference or description",
      "textSnippet": "source text"
    }
  }
}`,

  T12: `Extract T-12 (trailing 12 months) financial data from this operating statement.
Return ONLY a JSON object:

{
  "values": {
    "grossPotentialRent": number,
    "vacancyLoss": number,
    "effectiveGrossIncome": number,
    "otherIncome": number,
    "totalRevenue": number,
    "operatingExpenses": number,
    "taxes": number,
    "insurance": number,
    "utilities": number,
    "repairsAndMaintenance": number,
    "management": number,
    "netOperatingIncome": number,
    "expenseRatio": number (decimal),
    "period": "string - e.g., 'Jan 2024 - Dec 2024'"
  },
  "metadata": {
    "fieldName": {
      "confidence": number 0.0-1.0,
      "location": "cell reference or line description",
      "textSnippet": "source text"
    }
  }
}`,

  LOI: `Extract Letter of Intent deal terms from this document.
Return ONLY a JSON object:

{
  "values": {
    "purchasePrice": number,
    "earnestMoney": number,
    "dueDiligencePeriod": number (days),
    "closingPeriod": number (days from DD expiration),
    "financingContingency": boolean,
    "loanAmount": number or null,
    "buyerName": "string",
    "buyerEntity": "string - legal entity name",
    "sellerName": "string",
    "propertyAddress": "string",
    "expirationDate": "string date"
  },
  "metadata": {
    "fieldName": {
      "confidence": number 0.0-1.0,
      "pageNumber": number,
      "textSnippet": "source text"
    }
  }
}`,

  GENERIC: `Extract any deal-related information from this text/document.
Look for:
- Property details (name, address, type, size)
- Financial metrics (price, NOI, cap rate)
- Broker/contact information
- Key dates

Return ONLY a JSON object:
{
  "values": {
    // any fields you can extract
  },
  "metadata": {
    "fieldName": {
      "confidence": number 0.0-1.0,
      "textSnippet": "source text"
    }
  }
}`
};

class DealClaimExtractorService {
  /**
   * Extract claims from a document
   *
   * @param {Object} params
   * @param {string} params.dealDraftId - Deal draft ID
   * @param {string} params.documentId - Document ID
   * @param {string} params.documentContent - Text content to extract from
   * @param {string} params.documentType - Type: OFFERING_MEMO, RENT_ROLL, T12, LOI, OTHER
   * @param {string} params.documentName - Original filename
   * @returns {Promise<Object>} Extraction results with claims
   */
  async extractFromDocument({
    dealDraftId,
    documentId,
    documentContent,
    documentType,
    documentName
  }) {
    if (!OPENAI_API_KEY) {
      console.log('[ClaimExtractor] OpenAI API key not configured, skipping LLM extraction');
      return { claims: [], skipped: true, reason: 'api_key_not_configured' };
    }

    // Get appropriate prompt
    const prompt = EXTRACTION_PROMPTS[documentType] || EXTRACTION_PROMPTS.GENERIC;

    // Call LLM for extraction
    const extractionResult = await this.callLLM(prompt, documentContent);

    if (!extractionResult?.values) {
      console.log('[ClaimExtractor] No values extracted from document');
      return { claims: [], skipped: false, noValues: true };
    }

    // Create claims from extracted values
    const claims = [];
    const errors = [];

    for (const [field, value] of Object.entries(extractionResult.values)) {
      if (value === null || value === undefined) continue;

      const metadata = extractionResult.metadata?.[field] || {};

      try {
        // Normalize field names
        const normalizedField = this.normalizeFieldName(field);

        // Format display value
        const displayValue = this.formatDisplayValue(normalizedField, value);

        const claim = await dealIngestService.addClaim({
          dealDraftId,
          field: normalizedField,
          value,
          displayValue,
          extractionMethod: 'LLM',
          confidence: metadata.confidence || 0.7,
          source: {
            documentId,
            documentName,
            pageNumber: metadata.pageNumber,
            location: metadata.location,
            textSnippet: metadata.textSnippet?.slice(0, 500) // Limit snippet length
          }
        });

        claims.push(claim);
      } catch (error) {
        errors.push({ field, error: error.message });
      }
    }

    // Update document status
    await prisma.dealDraftDocument.update({
      where: { id: documentId },
      data: {
        status: 'PROCESSED',
        processedAt: new Date(),
        extractedClaimCount: claims.length
      }
    });

    return {
      claims,
      errors,
      totalExtracted: claims.length,
      totalErrors: errors.length
    };
  }

  /**
   * Extract claims from pasted text
   */
  async extractFromText({
    dealDraftId,
    text,
    sourceName = 'Pasted Text'
  }) {
    if (!OPENAI_API_KEY) {
      console.log('[ClaimExtractor] OpenAI API key not configured, skipping LLM extraction');
      return { claims: [], skipped: true, reason: 'api_key_not_configured' };
    }

    // Use generic extraction for pasted text
    const extractionResult = await this.callLLM(EXTRACTION_PROMPTS.GENERIC, text);

    if (!extractionResult?.values) {
      return { claims: [], skipped: false, noValues: true };
    }

    const claims = [];
    const errors = [];

    for (const [field, value] of Object.entries(extractionResult.values)) {
      if (value === null || value === undefined) continue;

      const metadata = extractionResult.metadata?.[field] || {};

      try {
        const normalizedField = this.normalizeFieldName(field);
        const displayValue = this.formatDisplayValue(normalizedField, value);

        const claim = await dealIngestService.addClaim({
          dealDraftId,
          field: normalizedField,
          value,
          displayValue,
          extractionMethod: 'LLM',
          confidence: metadata.confidence || 0.6, // Lower confidence for pasted text
          source: {
            documentName: sourceName,
            textSnippet: metadata.textSnippet?.slice(0, 500)
          }
        });

        claims.push(claim);
      } catch (error) {
        errors.push({ field, error: error.message });
      }
    }

    return {
      claims,
      errors,
      totalExtracted: claims.length
    };
  }

  /**
   * Extract claims from email body
   */
  async extractFromEmail({
    dealDraftId,
    emailSubject,
    emailBody,
    senderEmail,
    senderName
  }) {
    // Combine subject and body for extraction
    const fullText = `
Subject: ${emailSubject}
From: ${senderName} <${senderEmail}>

${emailBody}
`.trim();

    return this.extractFromText({
      dealDraftId,
      text: fullText,
      sourceName: `Email from ${senderName || senderEmail}`
    });
  }

  /**
   * Process all pending documents for a deal
   */
  async processAllPendingDocuments(dealDraftId) {
    const documents = await prisma.dealDraftDocument.findMany({
      where: {
        dealDraftId,
        status: 'PENDING'
      }
    });

    const results = [];

    for (const doc of documents) {
      // Mark as processing
      await prisma.dealDraftDocument.update({
        where: { id: doc.id },
        data: { status: 'PROCESSING' }
      });

      try {
        // In a real implementation, this would read the document content
        // For now, we'll skip if no content is available
        console.log(`[ClaimExtractor] Would process document: ${doc.originalFilename}`);

        results.push({
          documentId: doc.id,
          filename: doc.originalFilename,
          status: 'skipped',
          reason: 'document_reading_not_implemented'
        });

        // Reset status for manual processing
        await prisma.dealDraftDocument.update({
          where: { id: doc.id },
          data: { status: 'PENDING' }
        });
      } catch (error) {
        await prisma.dealDraftDocument.update({
          where: { id: doc.id },
          data: {
            status: 'FAILED',
            errorMessage: error.message
          }
        });

        results.push({
          documentId: doc.id,
          filename: doc.originalFilename,
          status: 'failed',
          error: error.message
        });
      }
    }

    return results;
  }

  /**
   * Call OpenAI API for extraction
   */
  async callLLM(systemPrompt, content) {
    try {
      const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: content.slice(0, 15000) } // Limit content length
          ],
          temperature: 0,
          response_format: { type: 'json_object' }
        })
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('[ClaimExtractor] OpenAI API error:', error);
        return null;
      }

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content;

      if (!text) {
        return null;
      }

      return JSON.parse(text);
    } catch (error) {
      console.error('[ClaimExtractor] LLM call failed:', error);
      return null;
    }
  }

  /**
   * Normalize field names to consistent format
   */
  normalizeFieldName(field) {
    const mappings = {
      // Property fields
      'property_name': 'propertyName',
      'property_address': 'propertyAddress',
      'address': 'propertyAddress',
      'asset_type': 'assetType',
      'type': 'assetType',
      'asking_price': 'askingPrice',
      'purchase_price': 'askingPrice',
      'price': 'askingPrice',
      'unit_count': 'unitCount',
      'units': 'unitCount',
      'total_units': 'unitCount',
      'totalUnits': 'unitCount',
      'total_sf': 'totalSF',
      'square_feet': 'totalSF',
      'sqft': 'totalSF',
      'sf': 'totalSF',
      'year_built': 'yearBuilt',
      'yearBuilt': 'yearBuilt',

      // Financial fields
      'current_noi': 'currentNOI',
      'currentNOI': 'currentNOI',
      'noi': 'currentNOI',
      'net_operating_income': 'currentNOI',
      'proforma_noi': 'proFormaNOI',
      'pro_forma_noi': 'proFormaNOI',
      'cap_rate': 'capRate',
      'occupancy_rate': 'occupancy',
      'occupancy': 'occupancy',
      'price_per_unit': 'pricePerUnit',
      'price_per_sf': 'pricePerSF',

      // Rent roll fields
      'occupied_units': 'occupiedUnits',
      'vacant_units': 'vacantUnits',
      'total_monthly_rent': 'totalMonthlyRent',
      'average_rent': 'averageRent',
      'avg_rent': 'averageRent',

      // T12 fields
      'gross_potential_rent': 'grossPotentialRent',
      'gpr': 'grossPotentialRent',
      'vacancy_loss': 'vacancyLoss',
      'effective_gross_income': 'effectiveGrossIncome',
      'egi': 'effectiveGrossIncome',
      'other_income': 'otherIncome',
      'total_revenue': 'totalRevenue',
      'operating_expenses': 'operatingExpenses',
      'opex': 'operatingExpenses',

      // LOI fields
      'earnest_money': 'earnestMoney',
      'due_diligence_period': 'dueDiligencePeriod',
      'dd_period': 'dueDiligencePeriod',
      'closing_period': 'closingPeriod',
      'loan_amount': 'loanAmount',
      'buyer_name': 'buyerName',
      'seller_name': 'sellerName',

      // Broker fields
      'broker_name': 'brokerName',
      'broker_firm': 'brokerFirm',
      'broker_phone': 'brokerPhone',
      'broker_email': 'brokerEmail'
    };

    // Convert to camelCase if not already
    const camelCase = field.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

    return mappings[field] || mappings[camelCase] || camelCase;
  }

  /**
   * Format value for human-readable display
   */
  formatDisplayValue(field, value) {
    if (value === null || value === undefined) return null;

    // Currency fields
    const currencyFields = [
      'askingPrice', 'currentNOI', 'proFormaNOI', 'purchasePrice', 'earnestMoney',
      'loanAmount', 'grossPotentialRent', 'effectiveGrossIncome', 'totalRevenue',
      'operatingExpenses', 'netOperatingIncome', 'averageRent', 'totalMonthlyRent',
      'pricePerUnit', 'pricePerSF', 'taxes', 'insurance', 'utilities',
      'repairsAndMaintenance', 'management', 'vacancyLoss', 'otherIncome'
    ];

    if (currencyFields.includes(field) && typeof value === 'number') {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0
      }).format(value);
    }

    // Percentage fields
    const percentageFields = ['capRate', 'occupancy', 'occupancyRate', 'expenseRatio'];
    if (percentageFields.includes(field) && typeof value === 'number') {
      return `${(value * 100).toFixed(2)}%`;
    }

    // Number fields with commas
    const numberFields = ['unitCount', 'totalUnits', 'occupiedUnits', 'vacantUnits', 'totalSF', 'mtmUnits', 'yearBuilt'];
    if (numberFields.includes(field) && typeof value === 'number') {
      return new Intl.NumberFormat('en-US').format(value);
    }

    // Days fields
    const daysFields = ['dueDiligencePeriod', 'closingPeriod'];
    if (daysFields.includes(field) && typeof value === 'number') {
      return `${value} days`;
    }

    // Arrays (like investmentHighlights)
    if (Array.isArray(value)) {
      return value.join('; ');
    }

    // Default: return as string
    return String(value);
  }

  /**
   * Get extraction statistics for a deal
   */
  async getExtractionStats(dealDraftId) {
    const [documents, claims, conflicts] = await Promise.all([
      prisma.dealDraftDocument.groupBy({
        by: ['status'],
        where: { dealDraftId },
        _count: { status: true }
      }),
      prisma.dealClaim.groupBy({
        by: ['status'],
        where: { dealDraftId },
        _count: { status: true }
      }),
      prisma.dealClaimConflict.count({
        where: { dealDraftId, status: 'OPEN' }
      })
    ]);

    const docStats = {
      total: 0,
      pending: 0,
      processing: 0,
      processed: 0,
      failed: 0
    };

    for (const group of documents) {
      docStats[group.status.toLowerCase()] = group._count.status;
      docStats.total += group._count.status;
    }

    const claimStats = {
      total: 0,
      unverified: 0,
      brokerConfirmed: 0,
      sellerConfirmed: 0,
      rejected: 0
    };

    for (const group of claims) {
      const key = group.status.toLowerCase().replace('_', '');
      if (key in claimStats) {
        claimStats[key] = group._count.status;
      }
      claimStats.total += group._count.status;
    }

    return {
      documents: docStats,
      claims: claimStats,
      openConflicts: conflicts
    };
  }

  /**
   * Get fields that are ready (have verified claims)
   */
  async getVerifiedFields(dealDraftId) {
    const claims = await prisma.dealClaim.findMany({
      where: {
        dealDraftId,
        status: { in: ['BROKER_CONFIRMED', 'SELLER_CONFIRMED'] }
      },
      orderBy: { verifiedAt: 'desc' }
    });

    // Group by field, keeping only the most recent verified claim
    const fieldMap = new Map();
    for (const claim of claims) {
      if (!fieldMap.has(claim.field)) {
        fieldMap.set(claim.field, {
          field: claim.field,
          value: JSON.parse(claim.value),
          displayValue: claim.displayValue,
          status: claim.status,
          verifiedBy: claim.verifiedByName,
          verifiedAt: claim.verifiedAt
        });
      }
    }

    return Array.from(fieldMap.values());
  }

  /**
   * Get fields that need verification
   */
  async getFieldsNeedingVerification(dealDraftId) {
    const claims = await prisma.dealClaim.findMany({
      where: {
        dealDraftId,
        status: 'UNVERIFIED'
      },
      orderBy: [
        { confidence: 'asc' }, // Low confidence first
        { createdAt: 'desc' }
      ]
    });

    // Group by field
    const fieldMap = new Map();
    for (const claim of claims) {
      if (!fieldMap.has(claim.field)) {
        fieldMap.set(claim.field, {
          field: claim.field,
          claims: []
        });
      }
      fieldMap.get(claim.field).claims.push({
        id: claim.id,
        value: JSON.parse(claim.value),
        displayValue: claim.displayValue,
        confidence: claim.confidence,
        source: {
          documentName: claim.documentName,
          location: claim.location
        }
      });
    }

    return Array.from(fieldMap.values());
  }
}

// Export singleton instance
const dealClaimExtractorService = new DealClaimExtractorService();

export {
  dealClaimExtractorService,
  DealClaimExtractorService,
  EXTRACTION_PROMPTS
};
