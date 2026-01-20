import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import {
  classifyDocumentByFilename,
  classifyAttachments,
  findPrimaryDocument,
  isSupportedFileType,
  getDocumentTypeLabel
} from '../services/email-classifier.js';
import { requestDealParse } from '../llm.js';
import { sendEmailIntakeConfirmation } from '../services/email-service.js';
import {
  processIncomingDDEmail,
  isDDEmailAddress,
  DD_EMAIL_CONFIG
} from '../services/dd-email-intake.js';

const prisma = new PrismaClient();

// Configuration
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB per attachment
const MAX_TOTAL_SIZE = 50 * 1024 * 1024; // 50MB total per email
const ALLOWED_SENDERS_DOMAIN = process.env.EMAIL_INTAKE_ALLOWED_DOMAIN || null;

/**
 * Helper to send JSON response
 */
function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(payload));
}

function sendError(res, status, message, details = null) {
  sendJson(res, status, { error: message, details });
}

/**
 * Parse deal ID from email address format
 * deals@domain.com -> null (new deal)
 * deals+{dealId}@domain.com -> dealId (add to existing)
 */
function parseDealIdFromAddress(toAddress) {
  const match = toAddress.match(/deals\+([a-f0-9-]+)@/i);
  return match ? match[1] : null;
}

/**
 * Generate a unique message ID from email metadata
 */
function generateMessageId(from, subject, timestamp) {
  const content = `${from}|${subject}|${timestamp}`;
  return createHash('sha256').update(content).digest('hex').substring(0, 32);
}

/**
 * Validate sender email
 * SECURITY: Fails closed - if EMAIL_INTAKE_ALLOWED_DOMAIN not configured, returns error object
 * @returns {{ valid: boolean, error?: string }}
 */
function isValidSender(fromEmail) {
  // FAIL CLOSED: Require allowed domain to be configured
  if (!ALLOWED_SENDERS_DOMAIN) {
    console.error("[Email Intake] EMAIL_INTAKE_ALLOWED_DOMAIN not configured - rejecting");
    return { valid: false, error: "Email intake not configured - missing allowed domains" };
  }

  if (!fromEmail) {
    return { valid: false, error: "Missing sender email" };
  }

  const domain = fromEmail.split('@')[1]?.toLowerCase();
  if (!domain) {
    return { valid: false, error: "Invalid sender email format" };
  }

  const allowedDomains = ALLOWED_SENDERS_DOMAIN.split(',').map(d => d.trim().toLowerCase());
  const isAllowed = allowedDomains.includes(domain);

  if (!isAllowed) {
    return { valid: false, error: `Sender domain ${domain} not in allowed list` };
  }

  return { valid: true };
}

/**
 * Parse multipart form data from SendGrid webhook
 * SendGrid sends form-urlencoded data with attachment info
 */
async function parseEmailWebhookData(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        const contentType = req.headers['content-type'] || '';

        // Handle JSON format (for testing/simulation)
        if (contentType.includes('application/json')) {
          const data = JSON.parse(raw);
          resolve(normalizeEmailData(data));
          return;
        }

        // Handle form-urlencoded (SendGrid format)
        if (contentType.includes('application/x-www-form-urlencoded')) {
          const params = new URLSearchParams(raw);
          const data = {};
          for (const [key, value] of params.entries()) {
            data[key] = value;
          }
          resolve(normalizeEmailData(data));
          return;
        }

        // Handle multipart form data
        if (contentType.includes('multipart/form-data')) {
          // For a full implementation, use busboy or similar
          // For now, return a placeholder indicating multipart isn't fully supported
          reject(new Error('Multipart form data requires busboy. Use JSON or form-urlencoded for testing.'));
          return;
        }

        // Try JSON as fallback
        const data = JSON.parse(raw);
        resolve(normalizeEmailData(data));
      } catch (error) {
        reject(new Error(`Failed to parse email data: ${error.message}`));
      }
    });

    req.on('error', reject);
  });
}

/**
 * Normalize email data from various formats
 */
function normalizeEmailData(data) {
  // SendGrid fields: from, to, subject, text, html, envelope, attachments, attachment-info, etc.
  // Also handle our test format

  const envelope = data.envelope ? JSON.parse(data.envelope) : null;

  return {
    from: data.from || envelope?.from || '',
    fromName: extractNameFromEmail(data.from || ''),
    to: data.to || envelope?.to?.[0] || '',
    subject: data.subject || '',
    textBody: data.text || data.textBody || '',
    htmlBody: data.html || data.htmlBody || '',
    // Attachments from SendGrid come as JSON in 'attachment-info' field
    // Each attachment is a separate field: attachment1, attachment2, etc.
    attachmentInfo: data['attachment-info'] ? JSON.parse(data['attachment-info']) : {},
    // For testing, allow direct attachment array
    attachments: data.attachments || []
  };
}

/**
 * Extract name from email "Name <email@domain.com>" format
 */
function extractNameFromEmail(email) {
  const match = email.match(/^([^<]+)<[^>]+>$/);
  return match ? match[1].trim() : null;
}

/**
 * Extract pure email from "Name <email@domain.com>" format
 */
function extractPureEmail(email) {
  const match = email.match(/<([^>]+)>/);
  return match ? match[1] : email;
}

/**
 * Handle SendGrid inbound email webhook
 * POST /api/email-intake/webhook
 *
 * Routes emails based on recipient:
 * - deal-{dealId}@docs.canonical.com -> DD document intake
 * - deals@domain.com -> General deal email intake
 */
export async function handleEmailWebhook(req, res) {
  console.log('[EmailIntake] Received webhook request');

  let emailData;
  try {
    emailData = await parseEmailWebhookData(req);
  } catch (error) {
    console.error('[EmailIntake] Failed to parse webhook data:', error);
    return sendError(res, 400, 'Failed to parse email data', error.message);
  }

  const { from, fromName, to, subject, textBody, htmlBody, attachments, attachmentInfo } = emailData;
  const fromEmail = extractPureEmail(from);

  console.log(`[EmailIntake] Processing email from: ${fromEmail}, to: ${to}, subject: ${subject}`);

  // Route DD emails to dedicated handler
  if (isDDEmailAddress(to)) {
    console.log('[EmailIntake] Routing to DD email handler');

    if (!DD_EMAIL_CONFIG.enabled) {
      console.log('[EmailIntake] DD email intake disabled');
      return sendJson(res, 200, { status: 'ignored', reason: 'DD email intake disabled' });
    }

    try {
      const result = await processIncomingDDEmail(emailData);
      return sendJson(res, 200, result);
    } catch (error) {
      console.error('[EmailIntake] DD email processing error:', error);
      return sendError(res, 500, 'DD email processing failed', error.message);
    }
  }

  // Continue with general email intake for non-DD emails
  console.log(`[EmailIntake] Processing general email from: ${fromEmail}, subject: ${subject}`);

  // Validate sender - FAIL CLOSED
  const senderValidation = isValidSender(fromEmail);
  if (!senderValidation.valid) {
    console.log(`[EmailIntake] Rejected: ${senderValidation.error}`);
    return sendError(res, 403, senderValidation.error);
  }

  // Generate unique message ID
  const messageId = generateMessageId(fromEmail, subject, Date.now().toString());

  // Check for duplicate
  const existing = await prisma.emailIntake.findUnique({
    where: { messageId }
  });

  if (existing) {
    console.log(`[EmailIntake] Duplicate message, skipping: ${messageId}`);
    return sendJson(res, 200, { status: 'duplicate', id: existing.id });
  }

  // Create intake record
  const intake = await prisma.emailIntake.create({
    data: {
      messageId,
      from: fromEmail,
      fromName,
      to,
      subject,
      textBody: textBody?.substring(0, 10000) || null,
      htmlBody: htmlBody?.substring(0, 50000) || null,
      status: 'PROCESSING',
      attachmentCount: 0
    }
  });

  try {
    // Parse deal ID from address (for adding to existing deal)
    const existingDealId = parseDealIdFromAddress(to);

    // Process attachments
    // For SendGrid, attachments come as separate fields (attachment1, attachment2, etc.)
    // The attachment-info field contains metadata about each attachment
    const processedAttachments = [];

    // Handle direct attachments (from test/simulation)
    if (Array.isArray(attachments) && attachments.length > 0) {
      for (const att of attachments) {
        if (!isSupportedFileType(att.filename, att.contentType)) {
          console.log(`[EmailIntake] Skipping unsupported file: ${att.filename}`);
          continue;
        }

        const classifiedType = classifyDocumentByFilename(att.filename);

        const attachment = await prisma.emailAttachment.create({
          data: {
            emailIntakeId: intake.id,
            filename: att.filename,
            contentType: att.contentType || 'application/octet-stream',
            size: att.size || 0,
            classifiedType,
            storageKey: att.storageKey || null
          }
        });

        processedAttachments.push({
          ...attachment,
          content: att.content || null
        });
      }
    }

    // Handle SendGrid attachment-info format
    if (Object.keys(attachmentInfo).length > 0) {
      for (const [key, info] of Object.entries(attachmentInfo)) {
        if (!isSupportedFileType(info.filename || info.name, info.type || info['content-type'])) {
          continue;
        }

        const classifiedType = classifyDocumentByFilename(info.filename || info.name);

        const attachment = await prisma.emailAttachment.create({
          data: {
            emailIntakeId: intake.id,
            filename: info.filename || info.name,
            contentType: info.type || info['content-type'] || 'application/octet-stream',
            size: info.size || 0,
            classifiedType,
            storageKey: info['content-id'] || null
          }
        });

        processedAttachments.push(attachment);
      }
    }

    // Update intake with attachment count
    await prisma.emailIntake.update({
      where: { id: intake.id },
      data: { attachmentCount: processedAttachments.length }
    });

    // Classify and find primary document
    const classified = classifyAttachments(processedAttachments);
    const primaryDoc = findPrimaryDocument(classified);

    // Extract deal fields from email body or primary document
    let extractedFields = {};
    let dealId = existingDealId;

    if (!existingDealId) {
      // Try to extract deal info from email content
      const contentToparse = textBody || subject || '';

      if (contentToparse.length > 50) {
        try {
          console.log('[EmailIntake] Attempting LLM extraction from email content');
          const llmResult = await requestDealParse(contentToparse);
          extractedFields = llmResult.output || {};
          console.log('[EmailIntake] LLM extraction result:', Object.keys(extractedFields));
        } catch (llmError) {
          console.error('[EmailIntake] LLM extraction failed:', llmError.message);
          // Continue without extracted fields
        }
      }

      // Use subject as deal name if not extracted
      if (!extractedFields.name) {
        extractedFields.name = subject || `Deal from ${fromEmail}`;
      }
    }

    // Update intake with extracted fields
    await prisma.emailIntake.update({
      where: { id: intake.id },
      data: {
        extractedFields: JSON.stringify(extractedFields),
        dealId,
        status: 'COMPLETED',
        processedAt: new Date()
      }
    });

    // Create notification for GP team
    try {
      const notificationTitle = existingDealId
        ? 'Documents Added via Email'
        : 'New Deal Created from Email';

      const notificationBody = existingDealId
        ? `${processedAttachments.length} document(s) added to deal from ${fromEmail}`
        : `Deal "${extractedFields.name || subject}" created from email by ${fromEmail}`;

      await prisma.notification.create({
        data: {
          userId: 'gp-team', // Broadcast to GP team
          type: existingDealId ? 'documents_added' : 'deal_created_from_email',
          title: notificationTitle,
          body: notificationBody,
          dealId: dealId || null,
          actionUrl: dealId ? `/DealOverview?id=${dealId}` : '/Deals'
        }
      });
    } catch (notifError) {
      console.error('[EmailIntake] Failed to create notification:', notifError);
    }

    console.log(`[EmailIntake] Successfully processed email. Attachments: ${processedAttachments.length}`);

    // Send confirmation email to sender
    try {
      await sendEmailIntakeConfirmation({
        toEmail: fromEmail,
        senderName: fromName,
        dealName: extractedFields.name || subject,
        dealId: dealId || null,
        attachmentsCount: processedAttachments.length,
        extractedFields,
        isNewDeal: !existingDealId
      });
    } catch (emailError) {
      console.error('[EmailIntake] Failed to send confirmation email:', emailError);
      // Don't fail the request if email fails
    }

    // Return success
    return sendJson(res, 200, {
      status: 'success',
      id: intake.id,
      dealId: dealId || null,
      attachmentsProcessed: processedAttachments.length,
      extractedFields: Object.keys(extractedFields),
      primaryDocument: primaryDoc ? {
        filename: primaryDoc.filename,
        type: primaryDoc.classifiedType,
        typeLabel: getDocumentTypeLabel(primaryDoc.classifiedType)
      } : null
    });

  } catch (error) {
    console.error('[EmailIntake] Processing error:', error);

    // Update intake with error status
    await prisma.emailIntake.update({
      where: { id: intake.id },
      data: {
        status: 'FAILED',
        errorMessage: error.message,
        processedAt: new Date()
      }
    });

    return sendError(res, 500, 'Failed to process email', error.message);
  }
}

/**
 * List email intakes (admin view)
 * GET /api/email-intake
 */
export async function handleListEmailIntakes(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const status = url.searchParams.get('status');
  const limit = parseInt(url.searchParams.get('limit') || '50', 10);

  try {
    const where = status ? { status } : {};

    const intakes = await prisma.emailIntake.findMany({
      where,
      orderBy: { receivedAt: 'desc' },
      take: limit,
      include: {
        attachments: true
      }
    });

    return sendJson(res, 200, {
      intakes: intakes.map(i => ({
        id: i.id,
        from: i.from,
        fromName: i.fromName,
        subject: i.subject,
        status: i.status,
        dealId: i.dealId,
        attachmentCount: i.attachmentCount,
        receivedAt: i.receivedAt,
        processedAt: i.processedAt,
        errorMessage: i.errorMessage,
        attachments: i.attachments.map(a => ({
          id: a.id,
          filename: a.filename,
          classifiedType: a.classifiedType,
          size: a.size
        }))
      }))
    });
  } catch (error) {
    console.error('[EmailIntake] List error:', error);
    return sendError(res, 500, 'Failed to list email intakes');
  }
}

/**
 * Get single email intake details
 * GET /api/email-intake/:id
 */
export async function handleGetEmailIntake(req, res, intakeId) {
  try {
    const intake = await prisma.emailIntake.findUnique({
      where: { id: intakeId },
      include: {
        attachments: true
      }
    });

    if (!intake) {
      return sendError(res, 404, 'Email intake not found');
    }

    return sendJson(res, 200, {
      ...intake,
      extractedFields: intake.extractedFields ? JSON.parse(intake.extractedFields) : null
    });
  } catch (error) {
    console.error('[EmailIntake] Get error:', error);
    return sendError(res, 500, 'Failed to get email intake');
  }
}

/**
 * Retry failed email intake
 * POST /api/email-intake/:id/retry
 */
export async function handleRetryEmailIntake(req, res, intakeId) {
  try {
    const intake = await prisma.emailIntake.findUnique({
      where: { id: intakeId },
      include: { attachments: true }
    });

    if (!intake) {
      return sendError(res, 404, 'Email intake not found');
    }

    if (intake.status !== 'FAILED') {
      return sendError(res, 400, 'Can only retry failed intakes');
    }

    // Reset status and retry processing
    await prisma.emailIntake.update({
      where: { id: intakeId },
      data: {
        status: 'PENDING',
        errorMessage: null
      }
    });

    // In a production system, you'd re-queue for processing
    // For now, just return success
    return sendJson(res, 200, {
      id: intakeId,
      status: 'PENDING',
      message: 'Email intake queued for retry'
    });
  } catch (error) {
    console.error('[EmailIntake] Retry error:', error);
    return sendError(res, 500, 'Failed to retry email intake');
  }
}

/**
 * Simulate email intake (for testing without SendGrid)
 * POST /api/email-intake/simulate
 */
export async function handleSimulateEmailIntake(req, res, readJsonBody) {
  try {
    const body = await readJsonBody(req);

    if (!body) {
      return sendError(res, 400, 'Request body required');
    }

    const { from, subject, text, attachments = [] } = body;

    if (!from || !subject) {
      return sendError(res, 400, 'from and subject are required');
    }

    // Create a mock request with the test data
    const mockReq = {
      headers: { 'content-type': 'application/json' },
      on: (event, callback) => {
        if (event === 'data') {
          callback(Buffer.from(JSON.stringify({
            from,
            to: 'deals@test.canonical.app',
            subject,
            text: text || '',
            attachments: attachments.map(a => ({
              filename: a.filename,
              contentType: a.contentType || 'application/pdf',
              size: a.size || 1000,
              content: a.content || null
            }))
          })));
        }
        if (event === 'end') {
          callback();
        }
      }
    };

    // Process using main handler
    return handleEmailWebhook(mockReq, res);

  } catch (error) {
    console.error('[EmailIntake] Simulate error:', error);
    return sendError(res, 500, 'Failed to simulate email intake', error.message);
  }
}
