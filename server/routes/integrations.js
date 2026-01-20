import crypto from "crypto";
import { kernelFetchJson, kernelRequest } from "../kernel.js";
import { getOrCreateActorId } from "./actions.js";
import { invalidateDealCaches } from "./deals.js";
import { getPrisma } from "../db.js";

const KERNEL_BASE_URL = process.env.KERNEL_API_URL ?? "http://localhost:3001";

// Email notification config (reused from document-change)
const EMAIL_ENDPOINT = process.env.BFF_LP_INVITATION_EMAIL_ENDPOINT?.trim() || "";
const EMAIL_API_KEY = process.env.BFF_LP_INVITATION_EMAIL_API_KEY?.trim();
const EMAIL_FROM = process.env.BFF_LP_INVITATION_EMAIL_FROM?.trim() ?? "Canonical Deal OS <noreply@canonical.com>";

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(JSON.stringify(payload));
}

function sendError(res, status, message, details) {
  sendJson(res, status, { message, details: details ?? null });
}

/**
 * Variance detection thresholds per metric
 * These define what constitutes a "material change" requiring attention
 */
const VARIANCE_THRESHOLDS = {
  noi: { variance: 0.10, severity: "HIGH", label: "Net Operating Income" },
  occupancy: { variance: 0.15, severity: "MEDIUM", label: "Occupancy Rate" },
  ltv: { variance: 0.05, severity: "HIGH", label: "Loan-to-Value" },
  dscr: { absolute: 0.15, severity: "CRITICAL", label: "Debt Service Coverage Ratio" },
  purchase_price: { variance: 0.05, severity: "HIGH", label: "Property Value" },
  cap_rate: { variance: 0.10, severity: "MEDIUM", label: "Cap Rate" },
  senior_debt: { variance: 0.10, severity: "HIGH", label: "Senior Debt" }
};

/**
 * Severity level ordering for comparison
 */
const SEVERITY_ORDER = {
  "LOW": 1,
  "MEDIUM": 2,
  "HIGH": 3,
  "CRITICAL": 4
};

/**
 * Validate webhook signature for security
 * SECURITY: Fails closed - missing secret or signature = reject
 * @returns {{ valid: boolean, error?: string }}
 */
function validateWebhookSignature(payload, signature, secret) {
  // FAIL CLOSED: Require webhook secret to be configured
  if (!secret) {
    console.error("[Integrations] WEBHOOK_SECRET not configured - rejecting webhook");
    return { valid: false, error: "Webhook secret not configured" };
  }

  // FAIL CLOSED: Require signature header
  if (!signature) {
    console.error("[Integrations] Missing webhook signature header");
    return { valid: false, error: "Missing webhook signature" };
  }

  const expectedSignature = `sha256=${crypto
    .createHmac("sha256", secret)
    .update(JSON.stringify(payload))
    .digest("hex")}`;

  try {
    const isValid = crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
    return { valid: isValid, error: isValid ? undefined : "Invalid signature" };
  } catch (err) {
    return { valid: false, error: "Signature validation failed" };
  }
}

/**
 * Calculate variance between two values
 */
function calculateVariance(current, incoming) {
  if (current === null || current === undefined || current === 0) {
    return incoming !== 0 ? 1 : 0; // 100% change if going from 0 to something
  }
  return Math.abs((incoming - current) / current);
}

/**
 * Detect material changes between incoming data and current deal profile
 */
async function detectChanges(dealId, incomingData, source) {
  // Fetch current deal profile
  const prisma = getPrisma();
  const dealProfile = await prisma.dealProfile.findUnique({
    where: { dealId }
  });

  if (!dealProfile) {
    console.log(`[Integrations] No profile found for deal ${dealId}`);
    return { changeDetected: false, reason: "no_profile" };
  }

  const currentProfile = dealProfile.profile || {};
  const changes = [];

  // Compare each field that has a threshold defined
  for (const [field, config] of Object.entries(VARIANCE_THRESHOLDS)) {
    const currentValue = currentProfile[field];
    const incomingValue = incomingData[field];

    if (incomingValue === undefined || incomingValue === null) {
      continue; // No incoming value for this field
    }

    // Calculate variance
    let isSignificant = false;
    let percentChange = 0;

    if (config.absolute !== undefined) {
      // Use absolute difference (for things like DSCR)
      const diff = Math.abs(incomingValue - (currentValue || 0));
      isSignificant = diff >= config.absolute;
      percentChange = currentValue ? diff / currentValue : 1;
    } else {
      // Use percentage variance
      percentChange = calculateVariance(currentValue, incomingValue);
      isSignificant = percentChange >= config.variance;
    }

    if (isSignificant) {
      changes.push({
        field,
        label: config.label,
        previousValue: currentValue,
        currentValue: incomingValue,
        percentChange: Math.round(percentChange * 100),
        severity: config.severity,
        delta: incomingValue - (currentValue || 0)
      });
    }
  }

  if (changes.length === 0) {
    return { changeDetected: false, changes: [] };
  }

  // Determine max severity
  const maxSeverity = changes.reduce((max, change) => {
    return SEVERITY_ORDER[change.severity] > SEVERITY_ORDER[max]
      ? change.severity
      : max;
  }, "LOW");

  // Determine recommended action based on severity
  let recommendedAction;
  if (maxSeverity === "CRITICAL") {
    recommendedAction = "AUTO_DECLARE_AND_NOTIFY";
  } else if (maxSeverity === "HIGH") {
    recommendedAction = "NOTIFY_FOR_REVIEW";
  } else {
    recommendedAction = "LOG_ONLY";
  }

  return {
    changeDetected: true,
    changes,
    severity: maxSeverity,
    recommendedAction,
    source
  };
}

/**
 * Send push notification to specified roles about detected changes
 */
async function sendChangeNotifications(dealId, dealName, changes, roles) {
  const notifications = [];

  // Build summary message
  const changeSummary = changes
    .map(c => `${c.label}: ${c.percentChange}% change`)
    .join(", ");

  for (const role of roles) {
    // Email notification
    if (EMAIL_ENDPOINT) {
      const subject = `[Alert] Material Changes Detected in ${dealName}`;
      const textBody = `
Material changes have been detected in ${dealName}:

${changes.map(c => `- ${c.label}: ${c.previousValue ?? 'N/A'} → ${c.currentValue} (${c.percentChange}% change)`).join('\n')}

Severity: ${changes[0]?.severity ?? 'UNKNOWN'}

Please review and take appropriate action.
`;

      const htmlBody = `
<h2>Material Changes Detected</h2>
<p>Material changes have been detected in <strong>${dealName}</strong>:</p>
<table style="margin: 16px 0; border-collapse: collapse; width: 100%;">
  <tr style="background: #f5f5f5;">
    <th style="padding: 8px; text-align: left; border-bottom: 1px solid #ddd;">Metric</th>
    <th style="padding: 8px; text-align: right; border-bottom: 1px solid #ddd;">Previous</th>
    <th style="padding: 8px; text-align: right; border-bottom: 1px solid #ddd;">Current</th>
    <th style="padding: 8px; text-align: right; border-bottom: 1px solid #ddd;">Change</th>
  </tr>
  ${changes.map(c => `
  <tr>
    <td style="padding: 8px; border-bottom: 1px solid #eee;">${c.label}</td>
    <td style="padding: 8px; text-align: right; border-bottom: 1px solid #eee;">${c.previousValue ?? 'N/A'}</td>
    <td style="padding: 8px; text-align: right; border-bottom: 1px solid #eee;">${c.currentValue}</td>
    <td style="padding: 8px; text-align: right; border-bottom: 1px solid #eee; ${c.delta < 0 ? 'color: red;' : 'color: green;'}">${c.percentChange}%</td>
  </tr>
  `).join('')}
</table>
<p style="margin-top: 16px;">
  <a href="#" style="display: inline-block; padding: 12px 24px; background: #0A0A0A; color: white; text-decoration: none; border-radius: 6px;">
    Review Changes
  </a>
</p>
`;

      const payload = {
        from: EMAIL_FROM,
        to: `${role.toLowerCase()}@example.com`,
        subject,
        text: textBody.trim(),
        html: htmlBody.trim(),
        metadata: {
          event: "INTEGRATION_CHANGE_DETECTED",
          dealId,
          targetRole: role
        }
      };

      const headers = {
        "Content-Type": "application/json"
      };

      if (EMAIL_API_KEY) {
        headers.Authorization = `Bearer ${EMAIL_API_KEY}`;
      }

      try {
        const response = await fetch(EMAIL_ENDPOINT, {
          method: "POST",
          headers,
          body: JSON.stringify(payload)
        });

        if (response.ok) {
          notifications.push({
            role,
            method: "email",
            status: "sent"
          });
        } else {
          notifications.push({
            role,
            method: "email",
            status: "failed"
          });
        }
      } catch (error) {
        notifications.push({
          role,
          method: "email",
          status: "failed",
          error: error.message
        });
      }
    }

    // In-app inbox notification (would be implemented via kernel in production)
    notifications.push({
      role,
      method: "inbox",
      status: "logged" // Just logging for now
    });
  }

  return notifications;
}

/**
 * Main webhook receiver handler
 *
 * Receives data from external systems (Yardi, CoStar, bank APIs, etc.)
 * and detects material changes that require attention.
 */
export async function handleIntegrationWebhook(req, res, readJsonBody) {
  const body = await readJsonBody(req);

  if (!body) {
    return sendError(res, 400, "Request body required");
  }

  const {
    source,
    eventType,
    timestamp,
    dealRef,
    dealId: explicitDealId,
    data,
    signature
  } = body;

  // Validate required fields
  if (!source || typeof source !== "string") {
    return sendError(res, 400, "Source is required");
  }

  if (!data || typeof data !== "object") {
    return sendError(res, 400, "Data payload is required");
  }

  // Look up integration config (in production this would be in database)
  const integrationSecret = process.env[`BFF_INTEGRATION_${source.toUpperCase()}_SECRET`];

  // SECURITY: Validate webhook signature - FAIL CLOSED
  const signatureResult = validateWebhookSignature(body, signature, integrationSecret);
  if (!signatureResult.valid) {
    console.error(`[Integrations] Webhook rejected from ${source}: ${signatureResult.error}`);
    return sendError(res, 403, signatureResult.error);
  }

  // Resolve deal ID (from explicit param or deal reference)
  let dealId = explicitDealId;
  if (!dealId && dealRef) {
    // Look up deal by external reference via DealProfile external ID
    // IntegrationMapping model is not yet implemented
    const prisma = getPrisma();
    const profile = await prisma.dealProfile?.findFirst({
      where: { externalDealId: dealRef }
    }).catch(() => null);

    if (profile) {
      dealId = profile.dealId;
    }
  }

  if (!dealId) {
    return sendError(res, 400, "Could not resolve deal ID from dealRef or dealId");
  }

  // Log the webhook event
  console.log(`[Integrations] Received webhook from ${source} for deal ${dealId}`, {
    eventType,
    timestamp,
    dataKeys: Object.keys(data)
  });

  try {
    // Detect changes
    const detection = await detectChanges(dealId, data, source);

    if (!detection.changeDetected) {
      return sendJson(res, 200, {
        received: true,
        changeDetected: false,
        dealId,
        message: "No material changes detected"
      });
    }

    // Get deal name for notifications
    let dealName = `Deal ${dealId}`;
    try {
      const dealResult = await kernelFetchJson(`${KERNEL_BASE_URL}/deals/${dealId}`);
      if (dealResult?.name) {
        dealName = dealResult.name;
      }
    } catch {
      // Use default name
    }

    // Determine which roles to notify based on severity
    const notifyRoles = detection.severity === "CRITICAL"
      ? ["GP", "LEGAL", "LP"]
      : detection.severity === "HIGH"
        ? ["GP", "LEGAL"]
        : ["GP"];

    // Send notifications
    const notifications = await sendChangeNotifications(
      dealId,
      dealName,
      detection.changes,
      notifyRoles
    );

    // If critical, auto-create MaterialChangeDetected event
    let autoEvent = null;
    if (detection.recommendedAction === "AUTO_DECLARE_AND_NOTIFY") {
      try {
        // Create system actor for auto-events
        const actorId = await getOrCreateActorId(dealId, `integration:${source}`, "SYSTEM", KERNEL_BASE_URL);

        const eventResult = await kernelRequest(
          `${KERNEL_BASE_URL}/deals/${dealId}/events`,
          {
            method: "POST",
            body: JSON.stringify({
              type: "MaterialChangeDetected",
              actorId,
              payload: {
                changeType: "INTEGRATION_DETECTED",
                description: `Auto-detected changes from ${source}: ${detection.changes.map(c => c.label).join(", ")}`,
                source,
                changes: detection.changes
              },
              authorityContext: {
                role: "SYSTEM",
                userId: `integration:${source}`
              },
              evidenceRefs: []
            })
          }
        );

        if (eventResult.ok) {
          autoEvent = eventResult.data;
          invalidateDealCaches(dealId);
        }
      } catch (error) {
        console.error(`[Integrations] Failed to auto-declare change:`, error);
      }
    }

    // Build variance summary for response
    const variance = {};
    for (const change of detection.changes) {
      variance[change.field] = {
        previous: change.previousValue,
        current: change.currentValue,
        delta: change.percentChange
      };
    }

    return sendJson(res, 200, {
      received: true,
      changeDetected: true,
      dealId,
      variance,
      severity: detection.severity,
      action: detection.recommendedAction,
      notifications,
      autoEvent: autoEvent ? { id: autoEvent.id, type: autoEvent.type } : null
    });

  } catch (error) {
    console.error(`[Integrations] Error processing webhook:`, error);
    return sendError(res, 500, "Failed to process webhook", error.message);
  }
}

/**
 * List configured integrations for a deal
 */
export async function handleListIntegrations(req, res, dealId) {
  // In production, this would query the Integration and IntegrationMapping tables
  // For now, return mock data structure

  return sendJson(res, 200, {
    dealId,
    integrations: [
      {
        id: "yardi-default",
        name: "Yardi Voyager",
        type: "PROPERTY_MANAGEMENT",
        enabled: true,
        lastSyncAt: null,
        status: "configured"
      },
      {
        id: "costar-default",
        name: "CoStar Market Data",
        type: "MARKET_DATA",
        enabled: false,
        lastSyncAt: null,
        status: "available"
      }
    ],
    thresholds: VARIANCE_THRESHOLDS
  });
}

/**
 * Update integration configuration for a deal
 */
export async function handleUpdateIntegration(req, res, dealId, integrationId, readJsonBody) {
  const body = await readJsonBody(req);

  if (!body) {
    return sendError(res, 400, "Request body required");
  }

  const { enabled, fieldMappings, thresholds } = body;

  // In production, this would update the IntegrationMapping table
  console.log(`[Integrations] Updating integration ${integrationId} for deal ${dealId}`, {
    enabled,
    fieldMappings,
    thresholds
  });

  return sendJson(res, 200, {
    id: integrationId,
    dealId,
    enabled,
    updatedAt: new Date().toISOString()
  });
}
