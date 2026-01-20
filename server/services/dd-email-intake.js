/**
 * DD Email Intake Service
 *
 * Processes emails to deal-specific inboxes for Due Diligence documents:
 * - deal-{dealId}@docs.canonical.com -> DD document processing
 *
 * Flow:
 * 1. SendGrid Inbound Parse webhook receives email
 * 2. Extract deal ID from recipient address
 * 3. Validate deal exists and has DD checklist
 * 4. Process each attachment:
 *    - Upload to document storage
 *    - AI smart-read (classify document type)
 *    - Match to DD checklist items
 *    - Create pending approval
 * 5. Send confirmation email to sender
 *
 * Phase 2.4 Implementation
 */

import { getPrisma } from '../db.js';
import { autoProcessDocument } from './ai/dd-checklist-assistant.js';
import { sendEmail, isEmailEnabled } from './email-service.js';
import {
  classifyDocumentByFilename,
  isSupportedFileType
} from './email-classifier.js';

// ==================== CONFIGURATION ====================

export const DD_EMAIL_CONFIG = {
  enabled: process.env.DD_EMAIL_INTAKE_ENABLED === 'true',
  domain: process.env.DD_EMAIL_DOMAIN || 'docs.canonical.com',
  webhookSecret: process.env.SENDGRID_INBOUND_SECRET,
  // Rate limiting
  maxEmailsPerSenderPerHour: parseInt(process.env.DD_EMAIL_RATE_LIMIT || '20', 10),
  // Attachment limits
  maxAttachmentSizeMB: parseInt(process.env.DD_MAX_ATTACHMENT_MB || '25', 10),
  maxTotalSizeMB: parseInt(process.env.DD_MAX_TOTAL_MB || '50', 10),
  // Debug
  debug: process.env.DEBUG_DD_EMAIL === 'true'
};

// ==================== LOGGING ====================

/**
 * Create logger with DD-EMAIL category prefix
 */
function createLogger() {
  const DEBUG = DD_EMAIL_CONFIG.debug;
  const timestamp = () => new Date().toISOString();

  return {
    debug: (message, meta = {}) => {
      if (DEBUG) {
        console.log(`[${timestamp()}] [DEBUG] [DD-EMAIL] ${message}`, Object.keys(meta).length ? JSON.stringify(meta) : '');
      }
    },
    info: (message, meta = {}) => {
      console.log(`[${timestamp()}] [INFO] [DD-EMAIL] ${message}`, Object.keys(meta).length ? JSON.stringify(meta) : '');
    },
    warn: (message, meta = {}) => {
      console.log(`[${timestamp()}] [WARN] [DD-EMAIL] ${message}`, Object.keys(meta).length ? JSON.stringify(meta) : '');
    },
    error: (message, meta = {}) => {
      console.error(`[${timestamp()}] [ERROR] [DD-EMAIL] ${message}`, Object.keys(meta).length ? JSON.stringify(meta) : '');
    }
  };
}

const log = createLogger();

// ==================== HELPERS ====================

/**
 * Extract deal ID from recipient email address
 * Format: deal-{dealId}@docs.canonical.com
 *
 * @param {string} toAddress - Recipient email address
 * @returns {string|null} Deal ID or null if not matching format
 */
export function extractDealIdFromRecipient(toAddress) {
  if (!toAddress) return null;

  // Handle "Name <email@domain.com>" format
  const emailMatch = toAddress.match(/<([^>]+)>/);
  const email = emailMatch ? emailMatch[1] : toAddress;

  // Match deal-{dealId}@domain pattern
  const dealMatch = email.match(/^deal-([a-z0-9-]+)@/i);
  return dealMatch ? dealMatch[1] : null;
}

/**
 * Check if email address is a DD email address
 * @param {string} toAddress - Recipient email address
 * @returns {boolean}
 */
export function isDDEmailAddress(toAddress) {
  return extractDealIdFromRecipient(toAddress) !== null;
}

/**
 * Extract pure email from "Name <email@domain.com>" format
 */
function extractPureEmail(email) {
  if (!email) return null;
  const match = email.match(/<([^>]+)>/);
  return match ? match[1] : email;
}

/**
 * Check rate limit for sender
 * @param {string} senderEmail - Sender email address
 * @returns {boolean} True if within rate limit
 */
async function checkRateLimit(senderEmail) {
  const prisma = getPrisma();
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  try {
    const recentCount = await prisma.dDEmailIntake.count({
      where: {
        senderEmail,
        receivedAt: { gte: oneHourAgo }
      }
    });

    return recentCount < DD_EMAIL_CONFIG.maxEmailsPerSenderPerHour;
  } catch (error) {
    log.warn('Rate limit check failed, allowing request', { error: error.message });
    return true;
  }
}

// ==================== MAIN PROCESSING ====================

/**
 * Process incoming DD email
 *
 * Main entry point called by webhook handler when email matches
 * deal-{dealId}@docs.canonical.com format
 *
 * @param {Object} emailData - Normalized email data
 * @returns {Object} Processing result
 */
export async function processIncomingDDEmail(emailData) {
  const prisma = getPrisma();

  const {
    from,
    fromName,
    to,
    subject,
    textBody,
    attachments = [],
    attachmentInfo = {}
  } = emailData;

  const senderEmail = extractPureEmail(from);
  const dealId = extractDealIdFromRecipient(to);

  log.info('Processing DD email', {
    from: senderEmail,
    dealId,
    subject,
    attachmentCount: attachments.length + Object.keys(attachmentInfo).length
  });

  // Validate deal ID was extracted
  if (!dealId) {
    log.error('Failed to extract deal ID from recipient', { to });
    return {
      status: 'error',
      error: 'Invalid recipient format - could not extract deal ID'
    };
  }

  // Check rate limit
  const withinRateLimit = await checkRateLimit(senderEmail);
  if (!withinRateLimit) {
    log.warn('Rate limit exceeded', { senderEmail, dealId });
    return {
      status: 'rate_limited',
      error: `Rate limit exceeded. Maximum ${DD_EMAIL_CONFIG.maxEmailsPerSenderPerHour} emails per hour.`
    };
  }

  // Validate deal exists and has DD checklist
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: {
      id: true,
      name: true,
      organizationId: true,
      ddChecklist: {
        select: { id: true }
      }
    }
  });

  if (!deal) {
    log.warn('Deal not found for DD email', { dealId });
    return {
      status: 'error',
      error: `Deal not found: ${dealId}`
    };
  }

  if (!deal.ddChecklist) {
    log.warn('Deal has no DD checklist', { dealId, dealName: deal.name });
    return {
      status: 'error',
      error: `Deal "${deal.name}" does not have an active DD checklist`
    };
  }

  // Create intake record
  const intake = await prisma.dDEmailIntake.create({
    data: {
      dealId,
      checklistId: deal.ddChecklist.id,
      senderEmail,
      senderName: fromName || senderEmail,
      subject: subject || '(No subject)',
      textBody: textBody?.substring(0, 10000) || null,
      status: 'PROCESSING',
      attachmentCount: 0,
      organizationId: deal.organizationId
    }
  });

  log.debug('Created DD email intake record', { intakeId: intake.id, dealId });

  try {
    // Process attachments
    const processedAttachments = [];
    const processingErrors = [];

    // Process direct attachments (from test/simulation)
    if (Array.isArray(attachments) && attachments.length > 0) {
      for (const att of attachments) {
        const result = await processAttachment(dealId, att, {
          intakeId: intake.id,
          senderEmail,
          source: 'EMAIL_INTAKE'
        });

        if (result.success) {
          processedAttachments.push(result);
        } else {
          processingErrors.push(result);
        }
      }
    }

    // Process SendGrid attachment-info format
    if (Object.keys(attachmentInfo).length > 0) {
      for (const [key, info] of Object.entries(attachmentInfo)) {
        const att = {
          filename: info.filename || info.name,
          contentType: info.type || info['content-type'],
          size: info.size || 0,
          storageKey: info['content-id'] || null
        };

        const result = await processAttachment(dealId, att, {
          intakeId: intake.id,
          senderEmail,
          source: 'EMAIL_INTAKE'
        });

        if (result.success) {
          processedAttachments.push(result);
        } else {
          processingErrors.push(result);
        }
      }
    }

    // Update intake record
    await prisma.dDEmailIntake.update({
      where: { id: intake.id },
      data: {
        attachmentCount: processedAttachments.length,
        status: processedAttachments.length > 0 ? 'COMPLETED' : 'NO_ATTACHMENTS',
        processedAt: new Date(),
        processingNotes: processingErrors.length > 0
          ? JSON.stringify(processingErrors.map(e => e.error))
          : null
      }
    });

    log.info('DD email processing complete', {
      intakeId: intake.id,
      dealId,
      processed: processedAttachments.length,
      errors: processingErrors.length
    });

    // Send confirmation email to sender
    await sendDDIntakeConfirmation({
      toEmail: senderEmail,
      senderName: fromName,
      dealName: deal.name,
      dealId,
      attachmentsProcessed: processedAttachments.length,
      pendingApprovals: processedAttachments.filter(a => a.approvalId).length,
      errors: processingErrors
    });

    return {
      status: 'success',
      intakeId: intake.id,
      dealId,
      attachmentsProcessed: processedAttachments.length,
      pendingApprovals: processedAttachments.filter(a => a.approvalId).length,
      errors: processingErrors.map(e => e.error)
    };

  } catch (error) {
    log.error('DD email processing failed', {
      intakeId: intake.id,
      dealId,
      error: error.message
    });

    // Update intake with error
    await prisma.dDEmailIntake.update({
      where: { id: intake.id },
      data: {
        status: 'FAILED',
        errorMessage: error.message,
        processedAt: new Date()
      }
    });

    return {
      status: 'error',
      intakeId: intake.id,
      error: error.message
    };
  }
}

/**
 * Process a single attachment for DD
 *
 * @param {string} dealId - Deal ID
 * @param {Object} attachment - Attachment data
 * @param {Object} metadata - Processing metadata
 * @returns {Object} Processing result
 */
async function processAttachment(dealId, attachment, metadata) {
  const prisma = getPrisma();
  const { filename, contentType, size, storageKey, content } = attachment;
  const { intakeId, senderEmail, source } = metadata;

  log.debug('Processing attachment', { dealId, filename, size, contentType });

  // Validate file type
  if (!isSupportedFileType(filename, contentType)) {
    log.debug('Skipping unsupported file type', { filename, contentType });
    return {
      success: false,
      filename,
      error: `Unsupported file type: ${contentType || 'unknown'}`
    };
  }

  // Validate file size
  const maxSizeBytes = DD_EMAIL_CONFIG.maxAttachmentSizeMB * 1024 * 1024;
  if (size > maxSizeBytes) {
    log.warn('Attachment too large', { filename, size, maxSizeBytes });
    return {
      success: false,
      filename,
      error: `File too large: ${(size / (1024 * 1024)).toFixed(1)}MB exceeds ${DD_EMAIL_CONFIG.maxAttachmentSizeMB}MB limit`
    };
  }

  try {
    // Classify document type from filename
    const documentType = classifyDocumentByFilename(filename);

    // Create document record
    // Note: In production, we'd upload to blob storage first
    const document = await prisma.document.create({
      data: {
        dealId,
        filename,
        contentType: contentType || 'application/octet-stream',
        size: size || 0,
        storageKey: storageKey || `dd-email/${intakeId}/${filename}`,
        documentType,
        uploadedBy: senderEmail,
        source: source || 'EMAIL_INTAKE',
        metadata: JSON.stringify({
          ddEmailIntakeId: intakeId,
          senderEmail,
          originalFilename: filename
        })
      }
    });

    log.debug('Document record created', {
      documentId: document.id,
      dealId,
      documentType
    });

    // Auto-process for DD matching
    const approval = await autoProcessDocument(dealId, document.id, {
      uploadedBy: senderEmail,
      source: source || 'EMAIL_INTAKE',
      documentType,
      filename
    });

    log.info('Attachment processed', {
      documentId: document.id,
      approvalId: approval?.id,
      documentType,
      matchConfidence: approval?.matchConfidence
    });

    return {
      success: true,
      filename,
      documentId: document.id,
      documentType,
      approvalId: approval?.id,
      matchConfidence: approval?.matchConfidence,
      suggestedItem: approval?.suggestedItemCode
    };

  } catch (error) {
    log.error('Failed to process attachment', {
      dealId,
      filename,
      error: error.message
    });

    return {
      success: false,
      filename,
      error: `Processing failed: ${error.message}`
    };
  }
}

// ==================== EMAIL NOTIFICATIONS ====================

/**
 * Send confirmation email for DD document intake
 *
 * @param {Object} params - Email parameters
 */
async function sendDDIntakeConfirmation({
  toEmail,
  senderName,
  dealName,
  dealId,
  attachmentsProcessed,
  pendingApprovals,
  errors = []
}) {
  if (!isEmailEnabled()) {
    log.debug('Email disabled, skipping DD intake confirmation');
    return;
  }

  const hasErrors = errors.length > 0;
  const statusText = hasErrors
    ? `${attachmentsProcessed} document(s) received, ${errors.length} error(s)`
    : `${attachmentsProcessed} document(s) received successfully`;

  const subject = `DD Documents Received - ${dealName}`;

  const textBody = `
Hello ${senderName || 'there'},

Thank you for submitting documents for "${dealName}".

Status: ${statusText}

${attachmentsProcessed > 0 ? `
Documents Processed: ${attachmentsProcessed}
Pending Review: ${pendingApprovals}

Your documents will be reviewed by the deal team and matched to the appropriate DD checklist items.
` : ''}
${hasErrors ? `
Some files could not be processed:
${errors.map(e => `- ${e}`).join('\n')}
` : ''}

If you have any questions, please contact the deal team.

Best regards,
Canonical Deal Management
`.trim();

  const htmlBody = `
<p>Hello ${senderName || 'there'},</p>

<p>Thank you for submitting documents for <strong>"${dealName}"</strong>.</p>

<p><strong>Status:</strong> ${statusText}</p>

${attachmentsProcessed > 0 ? `
<table style="margin: 20px 0; border-collapse: collapse;">
  <tr>
    <td style="padding: 8px; border: 1px solid #ddd;"><strong>Documents Processed</strong></td>
    <td style="padding: 8px; border: 1px solid #ddd;">${attachmentsProcessed}</td>
  </tr>
  <tr>
    <td style="padding: 8px; border: 1px solid #ddd;"><strong>Pending Review</strong></td>
    <td style="padding: 8px; border: 1px solid #ddd;">${pendingApprovals}</td>
  </tr>
</table>

<p>Your documents will be reviewed by the deal team and matched to the appropriate DD checklist items.</p>
` : ''}

${hasErrors ? `
<p style="color: #d9534f;"><strong>Some files could not be processed:</strong></p>
<ul>
${errors.map(e => `<li>${e}</li>`).join('\n')}
</ul>
` : ''}

<p>If you have any questions, please contact the deal team.</p>

<p>Best regards,<br/>
Canonical Deal Management</p>
`.trim();

  try {
    await sendEmail({
      to: toEmail,
      subject,
      text: textBody,
      html: htmlBody,
      metadata: {
        type: 'dd_intake_confirmation',
        dealId
      }
    });

    log.debug('DD intake confirmation sent', { toEmail, dealId });
  } catch (error) {
    log.error('Failed to send DD intake confirmation', {
      toEmail,
      dealId,
      error: error.message
    });
  }
}

// ==================== ADMIN FUNCTIONS ====================

/**
 * List DD email intakes for a deal
 *
 * @param {string} dealId - Deal ID
 * @param {Object} options - Query options
 * @returns {Array} Intake records
 */
export async function listDDEmailIntakes(dealId, options = {}) {
  const prisma = getPrisma();
  const { status, limit = 50 } = options;

  const where = { dealId };
  if (status) {
    where.status = status;
  }

  const intakes = await prisma.dDEmailIntake.findMany({
    where,
    orderBy: { receivedAt: 'desc' },
    take: limit
  });

  return intakes;
}

/**
 * Get DD email intake by ID
 *
 * @param {string} intakeId - Intake ID
 * @returns {Object|null} Intake record
 */
export async function getDDEmailIntake(intakeId) {
  const prisma = getPrisma();

  return prisma.dDEmailIntake.findUnique({
    where: { id: intakeId }
  });
}

/**
 * Retry failed DD email intake
 *
 * @param {string} intakeId - Intake ID
 * @returns {Object} Result
 */
export async function retryDDEmailIntake(intakeId) {
  const prisma = getPrisma();

  const intake = await prisma.dDEmailIntake.findUnique({
    where: { id: intakeId }
  });

  if (!intake) {
    throw new Error('DD email intake not found');
  }

  if (intake.status !== 'FAILED') {
    throw new Error('Can only retry failed intakes');
  }

  // Reset status
  await prisma.dDEmailIntake.update({
    where: { id: intakeId },
    data: {
      status: 'PENDING',
      errorMessage: null
    }
  });

  log.info('DD email intake queued for retry', { intakeId });

  return { intakeId, status: 'PENDING', message: 'Queued for retry' };
}
