const DEFAULT_PORT = Number(process.env.BFF_PORT ?? 8787);

const stripTrailingSlash = (value) => {
  if (!value || typeof value !== "string") {
    return "";
  }
  return value.replace(/\/+$/, "");
};

const PUBLIC_BASE_URL =
  stripTrailingSlash(process.env.BFF_PUBLIC_URL) || `http://localhost:${DEFAULT_PORT}`;
const INVITATION_BASE_URL =
  stripTrailingSlash(process.env.BFF_LP_INVITATION_BASE_URL) || PUBLIC_BASE_URL;

const EMAIL_ENDPOINT = stripTrailingSlash(process.env.BFF_LP_INVITATION_EMAIL_ENDPOINT) || "";
const EMAIL_API_KEY = process.env.BFF_LP_INVITATION_EMAIL_API_KEY?.trim();
const EMAIL_FROM =
  process.env.BFF_LP_INVITATION_EMAIL_FROM?.trim() ?? "Canonical LP Portal <noreply@canonical.com>";

const WEBHOOK_URL = stripTrailingSlash(process.env.BFF_LP_NOTIFICATION_WEBHOOK_URL);
const WEBHOOK_SECRET = process.env.BFF_LP_NOTIFICATION_WEBHOOK_SECRET?.trim();
const WEBHOOK_HEADER_NAME =
  process.env.BFF_LP_NOTIFICATION_WEBHOOK_HEADER ?? "X-LP-Webhook-Secret";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2
});

const percentFormatter = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2
});

const isString = (value) => typeof value === "string" && value.trim().length > 0;

export function isLpEmailEnabled() {
  return !!EMAIL_ENDPOINT;
}

export function isLpWebhookEnabled() {
  return !!WEBHOOK_URL;
}

const formatOwnership = (ownershipPct) => {
  if (typeof ownershipPct === "number" && Number.isFinite(ownershipPct)) {
    return percentFormatter.format(ownershipPct / 100);
  }
  return "TBD";
};

const formatCommitment = (commitment) => {
  if (typeof commitment === "number" && Number.isFinite(commitment)) {
    return currencyFormatter.format(commitment);
  }
  return "TBD";
};

const formatExpiration = (value) => {
  if (!value) {
    return "TBD";
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "TBD";
  }
  return date.toISOString();
};

const buildAcceptanceUrl = (invitationId) =>
  `${INVITATION_BASE_URL}/api/lp/invitations/${invitationId}/accept`;

export async function sendLpInvitationEmail({
  lpEmail,
  lpEntityName,
  invitationId,
  dealId,
  dealName,
  commitment,
  ownershipPct,
  expiresAt,
  createdBy
}) {
  if (!EMAIL_ENDPOINT || !isString(lpEmail) || !isString(invitationId)) {
    return;
  }

  const subject = `Invitation to join ${dealName ?? `deal ${dealId}`}`;
  const acceptanceUrl = buildAcceptanceUrl(invitationId);
  const formattedCommitment = formatCommitment(commitment);
  const formattedOwnership = formatOwnership(ownershipPct);
  const expirationLabel = formatExpiration(expiresAt);

  const textBody = `
Hello ${lpEntityName ?? "Investor"},

${createdBy ?? "A GP"} invited you to join ${dealName ?? `deal ${dealId}`}.

Commitment: ${formattedCommitment}
Ownership: ${formattedOwnership}
Expires: ${expirationLabel}

Accept the invitation: ${acceptanceUrl}

If you have questions, reply to your GP or reach out to support.
`;

  const htmlBody = `
<p>Hello ${lpEntityName ?? "Investor"},</p>
<p>${createdBy ?? "A GP"} invited you to join <strong>${
    dealName ?? `deal ${dealId}`
  }</strong>.</p>
<dl>
  <dt>Commitment</dt><dd>${formattedCommitment}</dd>
  <dt>Ownership</dt><dd>${formattedOwnership}</dd>
  <dt>Expires</dt><dd>${expirationLabel}</dd>
</dl>
<p><a href="${acceptanceUrl}">Accept the invitation</a></p>
<p>If you need help, reply to your GP or contact support.</p>
`;

  const payload = {
    from: EMAIL_FROM,
    to: lpEmail,
    subject,
    text: textBody.trim(),
    html: htmlBody.trim(),
    metadata: {
      event: "LP_INVITATION_SENT",
      dealId,
      invitationId,
      createdBy
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
      console.error(
        `[LP Onboarding] Invitation email failed (${response.status}): ${bodyText}`
      );
    } else {
      console.log(`[LP Onboarding] Invitation email queued for ${lpEmail}`);
    }
  } catch (error) {
    console.error("[LP Onboarding] Email notification error:", error?.message ?? error);
  }
}

export async function emitLpWebhook(eventType, detail = {}) {
  if (!WEBHOOK_URL || !isString(eventType)) {
    return;
  }

  const body = {
    eventType,
    detail,
    timestamp: new Date().toISOString(),
    source: "canonical-bff"
  };

  const headers = {
    "Content-Type": "application/json"
  };

  if (isString(WEBHOOK_SECRET)) {
    headers[WEBHOOK_HEADER_NAME] = WEBHOOK_SECRET;
  }

  try {
    const response = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const responseText = await response.text().catch(() => "<no body>");
      console.error(
        `[LP Onboarding] Webhook ${eventType} failed (${response.status}): ${responseText}`
      );
    }
  } catch (error) {
    console.error(
      `[LP Onboarding] Webhook ${eventType} error:`,
      error?.message ?? error
    );
  }
}
