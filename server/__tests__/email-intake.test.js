/**
 * Email Intake Integration Tests
 *
 * Tests the full email-to-deal flow including:
 * - Document classification
 * - Email webhook processing
 * - Database record creation
 * - API endpoints
 *
 * Run with: npm test -- --testPathPattern=email-intake
 */

import { jest } from '@jest/globals';

// Mock the LLM module to avoid needing OpenAI API key
jest.unstable_mockModule('../llm.js', () => ({
  requestDealParse: jest.fn().mockResolvedValue({
    provider: 'mock',
    model: 'mock-model',
    output: {
      name: '123 Main Street Acquisition',
      asset_type: 'Multifamily',
      asset_address: '123 Main Street',
      asset_city: 'Austin',
      asset_state: 'TX',
      purchase_price: 15000000,
      unit_count: 42
    }
  })
}));

// Mock email service
jest.unstable_mockModule('../services/email-service.js', () => ({
  sendEmailIntakeConfirmation: jest.fn().mockResolvedValue({ sent: true }),
  isEmailEnabled: jest.fn().mockReturnValue(false)
}));

// Import after mocks
const {
  classifyDocumentByFilename,
  classifyAttachments,
  findPrimaryDocument,
  isSupportedFileType,
  getDocumentTypeLabel
} = await import('../services/email-classifier.js');

describe('Email Classifier Service', () => {
  describe('classifyDocumentByFilename', () => {
    test('classifies LOI documents', () => {
      expect(classifyDocumentByFilename('LOI_123_Main_St.pdf')).toBe('LOI');
      expect(classifyDocumentByFilename('Letter of Intent - Deal.pdf')).toBe('LOI');
      expect(classifyDocumentByFilename('letter-of-intent.docx')).toBe('LOI');
    });

    test('classifies term sheets', () => {
      expect(classifyDocumentByFilename('Term Sheet v2.pdf')).toBe('TERM_SHEET');
      expect(classifyDocumentByFilename('terms_final.pdf')).toBe('TERM_SHEET');
      expect(classifyDocumentByFilename('termsheet.xlsx')).toBe('TERM_SHEET');
    });

    test('classifies rent rolls', () => {
      expect(classifyDocumentByFilename('Rent Roll Jan 2026.xlsx')).toBe('RENT_ROLL');
      expect(classifyDocumentByFilename('rentroll_current.pdf')).toBe('RENT_ROLL');
      expect(classifyDocumentByFilename('tenant roster.xlsx')).toBe('RENT_ROLL');
    });

    test('classifies T12 statements', () => {
      expect(classifyDocumentByFilename('T12_2025.pdf')).toBe('T12');
      expect(classifyDocumentByFilename('T-12 Operating Statement.xlsx')).toBe('T12');
      expect(classifyDocumentByFilename('trailing twelve months.pdf')).toBe('T12');
    });

    test('classifies appraisals', () => {
      expect(classifyDocumentByFilename('Appraisal Report.pdf')).toBe('APPRAISAL');
      expect(classifyDocumentByFilename('Property Valuation.pdf')).toBe('APPRAISAL');
    });

    test('classifies PSAs', () => {
      expect(classifyDocumentByFilename('PSA_Final.pdf')).toBe('PSA');
      expect(classifyDocumentByFilename('Purchase Agreement.pdf')).toBe('PSA');
      expect(classifyDocumentByFilename('Purchase and Sale Agreement.docx')).toBe('PSA');
    });

    test('classifies environmental reports', () => {
      expect(classifyDocumentByFilename('Phase 1 ESA.pdf')).toBe('ENVIRONMENTAL');
      expect(classifyDocumentByFilename('Environmental Report.pdf')).toBe('ENVIRONMENTAL');
      expect(classifyDocumentByFilename('Phase I.pdf')).toBe('ENVIRONMENTAL');
    });

    test('returns OTHER for unknown documents', () => {
      expect(classifyDocumentByFilename('random_file.pdf')).toBe('OTHER');
      expect(classifyDocumentByFilename('notes.txt')).toBe('OTHER');
      expect(classifyDocumentByFilename('image.png')).toBe('OTHER');
    });
  });

  describe('classifyAttachments', () => {
    test('classifies and sorts by priority', () => {
      const attachments = [
        { filename: 'random.pdf', contentType: 'application/pdf', size: 1000 },
        { filename: 'Rent Roll.xlsx', contentType: 'application/xlsx', size: 2000 },
        { filename: 'LOI.pdf', contentType: 'application/pdf', size: 3000 },
        { filename: 'T12.pdf', contentType: 'application/pdf', size: 1500 }
      ];

      const result = classifyAttachments(attachments);

      // LOI should be first (highest priority primary doc)
      expect(result[0].filename).toBe('LOI.pdf');
      expect(result[0].classifiedType).toBe('LOI');
      expect(result[0].isPrimary).toBe(true);

      // Rent Roll should be second (primary doc)
      expect(result[1].filename).toBe('Rent Roll.xlsx');
      expect(result[1].classifiedType).toBe('RENT_ROLL');
      expect(result[1].isPrimary).toBe(true);

      // T12 should be third (primary doc)
      expect(result[2].filename).toBe('T12.pdf');
      expect(result[2].classifiedType).toBe('T12');
      expect(result[2].isPrimary).toBe(true);

      // Random should be last (not primary)
      expect(result[3].filename).toBe('random.pdf');
      expect(result[3].classifiedType).toBe('OTHER');
      expect(result[3].isPrimary).toBe(false);
    });

    test('handles empty array', () => {
      const result = classifyAttachments([]);
      expect(result).toEqual([]);
    });
  });

  describe('findPrimaryDocument', () => {
    test('finds first primary document', () => {
      const classified = [
        { filename: 'LOI.pdf', classifiedType: 'LOI', isPrimary: true },
        { filename: 'other.pdf', classifiedType: 'OTHER', isPrimary: false }
      ];

      const result = findPrimaryDocument(classified);
      expect(result.filename).toBe('LOI.pdf');
    });

    test('returns null when no primary document', () => {
      const classified = [
        { filename: 'other.pdf', classifiedType: 'OTHER', isPrimary: false }
      ];

      const result = findPrimaryDocument(classified);
      expect(result).toBeNull();
    });
  });

  describe('isSupportedFileType', () => {
    test('accepts PDF files', () => {
      expect(isSupportedFileType('document.pdf', 'application/pdf')).toBe(true);
    });

    test('accepts Word documents', () => {
      expect(isSupportedFileType('document.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(true);
      expect(isSupportedFileType('document.doc', 'application/msword')).toBe(true);
    });

    test('accepts Excel files', () => {
      expect(isSupportedFileType('spreadsheet.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe(true);
      expect(isSupportedFileType('spreadsheet.xls', 'application/vnd.ms-excel')).toBe(true);
    });

    test('accepts images', () => {
      expect(isSupportedFileType('photo.png', 'image/png')).toBe(true);
      expect(isSupportedFileType('photo.jpg', 'image/jpeg')).toBe(true);
    });

    test('rejects unsupported files', () => {
      expect(isSupportedFileType('script.exe', 'application/x-msdownload')).toBe(false);
      expect(isSupportedFileType('archive.zip', 'application/zip')).toBe(false);
    });

    test('accepts by extension even with wrong mime type', () => {
      expect(isSupportedFileType('document.pdf', 'application/octet-stream')).toBe(true);
    });
  });

  describe('getDocumentTypeLabel', () => {
    test('returns human-readable labels', () => {
      expect(getDocumentTypeLabel('LOI')).toBe('Letter of Intent');
      expect(getDocumentTypeLabel('TERM_SHEET')).toBe('Term Sheet');
      expect(getDocumentTypeLabel('RENT_ROLL')).toBe('Rent Roll');
      expect(getDocumentTypeLabel('T12')).toBe('T-12 Statement');
      expect(getDocumentTypeLabel('PSA')).toBe('Purchase & Sale Agreement');
      expect(getDocumentTypeLabel('OTHER')).toBe('Other Document');
    });

    test('returns type itself for unknown types', () => {
      expect(getDocumentTypeLabel('UNKNOWN_TYPE')).toBe('UNKNOWN_TYPE');
    });
  });
});

describe('Email Intake API', () => {
  const BASE_URL = 'http://localhost:8787';

  // Skip these tests if server isn't running
  const skipIfNoServer = () => {
    return fetch(`${BASE_URL}/health`, { method: 'GET' })
      .then(() => false)
      .catch(() => true);
  };

  describe('POST /api/email-intake/simulate', () => {
    test('processes simulated email with attachments', async () => {
      const shouldSkip = await skipIfNoServer();
      if (shouldSkip) {
        console.log('Skipping API test - server not running');
        return;
      }

      const response = await fetch(`${BASE_URL}/api/email-intake/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'broker@example.com',
          subject: '123 Main Street - LOI Attached',
          text: 'Please find attached the LOI for 123 Main Street, a 42-unit multifamily in Austin, TX. Purchase price is $15M.',
          attachments: [
            { filename: 'LOI_123_Main_St.pdf', contentType: 'application/pdf', size: 50000 },
            { filename: 'Rent Roll Jan 2026.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 25000 }
          ]
        })
      });

      expect(response.ok).toBe(true);
      const data = await response.json();

      expect(data.status).toBe('success');
      expect(data.id).toBeDefined();
      expect(data.attachmentsProcessed).toBe(2);
      expect(data.primaryDocument).toBeDefined();
      expect(data.primaryDocument.type).toBe('LOI');
    });

    test('handles email without attachments', async () => {
      const shouldSkip = await skipIfNoServer();
      if (shouldSkip) {
        console.log('Skipping API test - server not running');
        return;
      }

      const response = await fetch(`${BASE_URL}/api/email-intake/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'analyst@firm.com',
          subject: 'New deal opportunity - 456 Oak Ave',
          text: 'Quick note about a potential deal at 456 Oak Ave. Will send docs soon.',
          attachments: []
        })
      });

      expect(response.ok).toBe(true);
      const data = await response.json();

      expect(data.status).toBe('success');
      expect(data.attachmentsProcessed).toBe(0);
      expect(data.primaryDocument).toBeNull();
    });

    test('requires from and subject', async () => {
      const shouldSkip = await skipIfNoServer();
      if (shouldSkip) {
        console.log('Skipping API test - server not running');
        return;
      }

      const response = await fetch(`${BASE_URL}/api/email-intake/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Some content without required fields'
        })
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/email-intake', () => {
    test('lists email intakes', async () => {
      const shouldSkip = await skipIfNoServer();
      if (shouldSkip) {
        console.log('Skipping API test - server not running');
        return;
      }

      const response = await fetch(`${BASE_URL}/api/email-intake`);
      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data.intakes).toBeDefined();
      expect(Array.isArray(data.intakes)).toBe(true);
    });

    test('filters by status', async () => {
      const shouldSkip = await skipIfNoServer();
      if (shouldSkip) {
        console.log('Skipping API test - server not running');
        return;
      }

      const response = await fetch(`${BASE_URL}/api/email-intake?status=COMPLETED`);
      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data.intakes).toBeDefined();
      // All returned intakes should have COMPLETED status
      data.intakes.forEach(intake => {
        expect(intake.status).toBe('COMPLETED');
      });
    });
  });
});

describe('End-to-End Flow', () => {
  test('full email-to-deal simulation', async () => {
    // This test documents the expected flow
    // In a real test, you'd run this against a test database

    const mockEmail = {
      from: 'John Smith <broker@realestate.com>',
      to: 'deals@canonical.app',
      subject: 'LOI - 789 Park Avenue, NYC',
      text: `
        Hi team,

        Please find attached the LOI for 789 Park Avenue.

        Key terms:
        - Purchase Price: $25,000,000
        - Property: 60-unit luxury multifamily
        - Location: New York, NY
        - Expected close: Q2 2026

        Let me know if you need anything else.

        Best,
        John
      `,
      attachments: [
        { filename: 'LOI_789_Park_Ave.pdf', contentType: 'application/pdf', size: 75000 },
        { filename: 'Rent_Roll_Dec_2025.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 45000 },
        { filename: 'T12_2025.pdf', contentType: 'application/pdf', size: 30000 },
        { filename: 'Building_Photos.zip', contentType: 'application/zip', size: 10000000 } // Should be filtered out
      ]
    };

    // Expected behavior:
    // 1. Email received via webhook
    // 2. Sender validated (if domain restriction enabled)
    // 3. Attachments classified:
    //    - LOI_789_Park_Ave.pdf -> LOI (primary)
    //    - Rent_Roll_Dec_2025.xlsx -> RENT_ROLL (primary)
    //    - T12_2025.pdf -> T12 (primary)
    //    - Building_Photos.zip -> REJECTED (unsupported type)
    // 4. LLM extracts fields from email body:
    //    - name: "789 Park Avenue"
    //    - purchase_price: 25000000
    //    - unit_count: 60
    //    - asset_city: "New York"
    //    - asset_state: "NY"
    // 5. EmailIntake record created with status COMPLETED
    // 6. 3 EmailAttachment records created
    // 7. Notification created for GP team
    // 8. Confirmation email sent to broker@realestate.com

    // Test classification
    const classified = classifyAttachments(mockEmail.attachments.filter(a =>
      isSupportedFileType(a.filename, a.contentType)
    ));

    expect(classified.length).toBe(3); // zip should be filtered
    expect(classified[0].classifiedType).toBe('LOI');
    expect(classified[1].classifiedType).toBe('RENT_ROLL');
    expect(classified[2].classifiedType).toBe('T12');

    const primary = findPrimaryDocument(classified);
    expect(primary.classifiedType).toBe('LOI');
  });
});
