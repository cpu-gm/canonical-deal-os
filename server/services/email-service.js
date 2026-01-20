/**
 * Generic Email Service
 *
 * Sends emails via configured HTTP endpoint.
 * Used for confirmation emails, notifications, etc.
 */

const DEFAULT_PORT = Number(process.env.BFF_PORT ?? 8787);

const stripTrailingSlash = (value) => {
  if (!value || typeof value !== "string") {
    return "";
  }
  return value.replace(/\/+$/, "");
};

const PUBLIC_BASE_URL =
  stripTrailingSlash(process.env.BFF_PUBLIC_URL) || `http://localhost:${DEFAULT_PORT}`;

const EMAIL_ENDPOINT = stripTrailingSlash(process.env.BFF_EMAIL_ENDPOINT ||
  process.env.BFF_LP_INVITATION_EMAIL_ENDPOINT) || "";
const EMAIL_API_KEY = (process.env.BFF_EMAIL_API_KEY ||
  process.env.BFF_LP_INVITATION_EMAIL_API_KEY)?.trim();
const EMAIL_FROM =
  (process.env.BFF_EMAIL_FROM ||
    process.env.BFF_LP_INVITATION_EMAIL_FROM)?.trim() ?? "Canonical Deal OS <noreply@canonical.com>";

const isString = (value) => typeof value === "string" && value.trim().length > 0;

/**
 * Check if email sending is enabled
 */
export function isEmailEnabled() {
  return !!EMAIL_ENDPOINT;
}

/**
 * Send a generic email
 */
export async function sendEmail({ to, subject, text, html, metadata = {} }) {
  if (!EMAIL_ENDPOINT || !isString(to)) {
    console.log('[Email] Email endpoint not configured, skipping send');
    return { sent: false, reason: 'not_configured' };
  }

  const payload = {
    from: EMAIL_FROM,
    to,
    subject,
    text: text?.trim() || '',
    html: html?.trim() || '',
    metadata: {
      ...metadata,
      timestamp: new Date().toISOString()
    }
  };

  const headers = {
    "Content-Type": "application/json"
  };

  if (isString(EMAIL_API_KEY)) {
    headers.Authorization = `Bearer ${EMAIL_API_KEY}`;
  }

  try {
    const response = await fetch(EMAIL_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "<no body>");
      console.error(`[Email] Send failed (${response.status}): ${bodyText}`);
      return { sent: false, reason: 'request_failed', status: response.status };
    }

    console.log(`[Email] Sent to ${to}: ${subject}`);
    return { sent: true };
  } catch (error) {
    console.error("[Email] Send error:", error?.message ?? error);
    return { sent: false, reason: 'error', error: error?.message };
  }
}

/**
 * Send email intake confirmation email
 */
export async function sendEmailIntakeConfirmation({
  toEmail,
  senderName,
  dealName,
  dealId,
  attachmentsCount,
  extractedFields,
  isNewDeal
}) {
  const subject = isNewDeal
    ? `Deal Created: ${dealName || 'New Deal'}`
    : `Documents Added: ${dealName || 'Deal'}`;

  const viewUrl = dealId ? `${PUBLIC_BASE_URL}/DealOverview?id=${dealId}` : PUBLIC_BASE_URL;

  const fieldsText = extractedFields && Object.keys(extractedFields).length > 0
    ? `\nExtracted fields: ${Object.keys(extractedFields).join(', ')}`
    : '';

  const textBody = `
Hello${senderName ? ` ${senderName}` : ''},

Your email has been processed successfully.

${isNewDeal ? `A new deal "${dealName || 'Untitled'}" has been created.` : `Documents have been added to the deal.`}

${attachmentsCount} document(s) were processed.${fieldsText}

View in platform: ${viewUrl}

Thank you for using Canonical Deal OS.
`;

  const htmlBody = `
<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
  <h2 style="color: #171717;">${isNewDeal ? 'Deal Created' : 'Documents Added'}</h2>

  <p>Hello${senderName ? ` ${senderName}` : ''},</p>

  <p>Your email has been processed successfully.</p>

  <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; margin: 16px 0;">
    ${isNewDeal ? `<p><strong>New deal created:</strong> ${dealName || 'Untitled'}</p>` : '<p>Documents have been added to the deal.</p>'}
    <p><strong>Documents processed:</strong> ${attachmentsCount}</p>
    ${extractedFields && Object.keys(extractedFields).length > 0
      ? `<p><strong>Extracted fields:</strong> ${Object.keys(extractedFields).join(', ')}</p>`
      : ''
    }
  </div>

  <p>
    <a href="${viewUrl}" style="display: inline-block; background: #171717; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
      View in Platform
    </a>
  </p>

  <p style="color: #737373; font-size: 12px; margin-top: 32px;">
    Thank you for using Canonical Deal OS.
  </p>
</div>
`;

  return sendEmail({
    to: toEmail,
    subject,
    text: textBody,
    html: htmlBody,
    metadata: {
      event: isNewDeal ? 'EMAIL_INTAKE_DEAL_CREATED' : 'EMAIL_INTAKE_DOCS_ADDED',
      dealId,
      attachmentsCount
    }
  });
}

/**
 * Send deal submission email to external party (lender, counsel)
 */
export async function sendDealSubmissionEmail({
  toEmail,
  recipientName,
  dealName,
  dealId,
  submitterName,
  magicLink,
  recipientRole
}) {
  const roleLabel = recipientRole === 'COUNSEL' ? 'Legal Review' : 'Lender Review';
  const subject = `Deal Submission: ${dealName || 'Deal'} - ${roleLabel} Required`;

  const textBody = `
Hello${recipientName ? ` ${recipientName}` : ''},

${submitterName || 'A GP'} has submitted a deal for your review.

Deal: ${dealName || 'Untitled'}

Please click the link below to access the deal portal:
${magicLink}

This link will expire in 7 days.

If you have questions, please contact the submitter directly.
`;

  const htmlBody = `
<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
  <h2 style="color: #171717;">Deal Submission - ${roleLabel}</h2>

  <p>Hello${recipientName ? ` ${recipientName}` : ''},</p>

  <p>${submitterName || 'A GP'} has submitted a deal for your review.</p>

  <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; margin: 16px 0;">
    <p><strong>Deal:</strong> ${dealName || 'Untitled'}</p>
  </div>

  <p>
    <a href="${magicLink}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
      Review Deal
    </a>
  </p>

  <p style="color: #737373; font-size: 12px; margin-top: 24px;">
    This link will expire in 7 days. If you have questions, please contact the submitter directly.
  </p>

  <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 32px 0;">

  <p style="color: #a3a3a3; font-size: 11px;">
    Powered by Canonical Deal OS
  </p>
</div>
`;

  return sendEmail({
    to: toEmail,
    subject,
    text: textBody,
    html: htmlBody,
    metadata: {
      event: 'DEAL_SUBMITTED_TO_EXTERNAL',
      dealId,
      recipientRole
    }
  });
}
