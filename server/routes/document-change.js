import { kernelFetchJson, kernelRequest } from "../kernel.js";
import { getOrCreateActorId } from "./actions.js";
import { invalidateDealCaches } from "./deals.js";

const KERNEL_BASE_URL = process.env.KERNEL_API_URL ?? "http://localhost:3001";

// Email notification endpoint (reuse LP config for now)
const EMAIL_ENDPOINT = process.env.BFF_LP_INVITATION_EMAIL_ENDPOINT?.trim() || "";
const EMAIL_API_KEY = process.env.BFF_LP_INVITATION_EMAIL_API_KEY?.trim();
const EMAIL_FROM = process.env.BFF_LP_INVITATION_EMAIL_FROM?.trim() ?? "Canonical Deal OS <noreply@canonical.com>";

// Change types for validation
const VALID_CHANGE_TYPES = new Set([
  "NOI_VARIANCE",
  "OCCUPANCY_CHANGE",
  "DEBT_RESTRUCTURE",
  "PROPERTY_VALUE_ADJUSTMENT",
  "CAPITAL_STACK_CHANGE",
  "COVENANT_BREACH",
  "TENANT_CHANGE",
  "CAPITAL_EXPENDITURE",
  "OTHER"
]);

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
 * Streamlined Document Change Handler
 *
 * Combines the following steps into one API call:
 * 1. Upload artifact (if file provided - handled separately via multipart)
 * 2. Create MaterialChangeDetected event
 * 3. Auto-grant GP approval
 * 4. Send notification to LEGAL
 *
 * The UI should call artifacts endpoint first if uploading,
 * then call this endpoint with the artifactId.
 */
// SECURITY: authUser is required and must come from validated JWT at dispatch level
export async function handleDocumentChange(req, res, dealId, readJsonBody, authUser) {
  if (!authUser) {
    return sendError(res, 401, "Not authenticated");
  }

  const body = await readJsonBody(req);

  if (!body) {
    return sendError(res, 400, "Request body required");
  }

  const { changeType, description, artifactId, notifyRoles = ["LEGAL"] } = body;

  // Validate change type
  if (!changeType || !VALID_CHANGE_TYPES.has(changeType)) {
    return sendError(res, 400, "Invalid or missing changeType", {
      validTypes: Array.from(VALID_CHANGE_TYPES)
    });
  }

  // Validate description
  if (!description || typeof description !== "string" || description.trim().length === 0) {
    return sendError(res, 400, "Description is required");
  }

  // SECURITY: Use validated authUser instead of spoofable headers
  const userId = authUser.id;
  const role = authUser.role;

  try {
    // Get or create actor for the current user
    const actorId = await getOrCreateActorId(dealId, userId, role, KERNEL_BASE_URL);

    // Build event payload
    const eventPayload = {
      changeType,
      description: description.trim()
    };

    if (artifactId) {
      eventPayload.artifactId = artifactId;
    }

    // Create MaterialChangeDetected event
    const eventResult = await kernelRequest(
      `${KERNEL_BASE_URL}/deals/${dealId}/events`,
      {
        method: "POST",
        body: JSON.stringify({
          type: "MaterialChangeDetected",
          actorId,
          payload: eventPayload,
          authorityContext: {
            role,
            userId
          },
          evidenceRefs: artifactId ? [artifactId] : []
        })
      }
    );

    if (!eventResult.ok) {
      return sendError(
        res,
        eventResult.status || 500,
        eventResult.error || "Failed to create MaterialChangeDetected event",
        eventResult.data
      );
    }

    const declareEvent = eventResult.data;

    // Auto-grant GP approval (the caller is GP, so their action counts as approval)
    // The MaterialChangeDetected event itself serves as GP's declaration
    const approvals = {
      required: ["GP", "LEGAL"],
      granted: [role], // Current role (usually GP)
      pending: notifyRoles.filter(r => r !== role)
    };

    // Invalidate caches
    invalidateDealCaches(dealId);

    // Send notifications to required roles
    const notifications = [];

    for (const notifyRole of notifyRoles) {
      if (notifyRole === role) {
        // Skip notifying the actor who made the change
        continue;
      }

      // Fetch deal info for notification context
      let dealName = `Deal ${dealId}`;
      try {
        const dealResult = await kernelFetchJson(`${KERNEL_BASE_URL}/deals/${dealId}`);
        if (dealResult?.name) {
          dealName = dealResult.name;
        }
      } catch {
        // Use default name
      }

      // Send email notification to LEGAL (or other roles)
      const notificationResult = await sendChangeNotificationEmail({
        dealId,
        dealName,
        changeType,
        description: description.trim(),
        role: notifyRole,
        declaredBy: userId,
        eventId: declareEvent.id
      });

      notifications.push({
        role: notifyRole,
        method: notificationResult.method,
        status: notificationResult.status
      });
    }

    // Return success response
    return sendJson(res, 200, {
      changeId: declareEvent.id,
      status: "PENDING_APPROVAL",
      events: [
        {
          id: declareEvent.id,
          type: "MaterialChangeDetected",
          createdAt: declareEvent.createdAt
        }
      ],
      artifacts: artifactId ? [{ id: artifactId }] : [],
      approvals,
      notifications
    });

  } catch (error) {
    console.error("[DocumentChange] Error:", error);
    return sendError(res, 500, error.message || "Failed to document change");
  }
}

/**
 * Send email notification about a material change
 */
async function sendChangeNotificationEmail({
  dealId,
  dealName,
  changeType,
  description,
  role,
  declaredBy,
  eventId
}) {
  if (!EMAIL_ENDPOINT) {
    console.log(`[DocumentChange] Email not configured, skipping notification to ${role}`);
    return { method: "email", status: "skipped", reason: "not_configured" };
  }

  const humanChangeType = changeType
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase());

  const subject = `[Action Required] Material Change in ${dealName}`;

  const textBody = `
A material change has been declared for ${dealName} and requires your review.

Change Type: ${humanChangeType}
Description: ${description}

Declared By: ${declaredBy}
Event ID: ${eventId}

Please log in to review and approve this change.
`;

  const htmlBody = `
<h2>Material Change Detected</h2>
<p>A material change has been declared for <strong>${dealName}</strong> and requires your review.</p>
<table style="margin: 16px 0; border-collapse: collapse;">
  <tr>
    <td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #eee;">Change Type</td>
    <td style="padding: 8px; border-bottom: 1px solid #eee;">${humanChangeType}</td>
  </tr>
  <tr>
    <td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #eee;">Description</td>
    <td style="padding: 8px; border-bottom: 1px solid #eee;">${description}</td>
  </tr>
  <tr>
    <td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #eee;">Declared By</td>
    <td style="padding: 8px; border-bottom: 1px solid #eee;">${declaredBy}</td>
  </tr>
</table>
<p style="margin-top: 16px;">
  <a href="#" style="display: inline-block; padding: 12px 24px; background: #0A0A0A; color: white; text-decoration: none; border-radius: 6px;">
    Review & Approve
  </a>
</p>
`;

  const payload = {
    from: EMAIL_FROM,
    to: `${role.toLowerCase()}@example.com`, // In production, this would look up actual email
    subject,
    text: textBody.trim(),
    html: htmlBody.trim(),
    metadata: {
      event: "MATERIAL_CHANGE_DETECTED",
      dealId,
      eventId,
      changeType,
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

    if (!response.ok) {
      const responseText = await response.text().catch(() => "<no body>");
      console.error(`[DocumentChange] Email notification failed (${response.status}): ${responseText}`);
      return { method: "email", status: "failed", reason: responseText };
    }

    console.log(`[DocumentChange] Email notification sent to ${role}`);
    return { method: "email", status: "sent" };

  } catch (error) {
    console.error("[DocumentChange] Email notification error:", error?.message ?? error);
    return { method: "email", status: "failed", reason: error?.message };
  }
}

/**
 * Handle reconcile change - called after all approvals are granted
 * SECURITY: authUser is required and must come from validated JWT at dispatch level
 */
export async function handleReconcileChange(req, res, dealId, readJsonBody, authUser) {
  if (!authUser) {
    return sendError(res, 401, "Not authenticated");
  }
  const body = await readJsonBody(req);
  // SECURITY: Use validated authUser instead of spoofable headers
  const userId = authUser.id;
  const role = authUser.role;

  try {
    const actorId = await getOrCreateActorId(dealId, userId, role, KERNEL_BASE_URL);

    // Create ChangeReconciled event
    const eventResult = await kernelRequest(
      `${KERNEL_BASE_URL}/deals/${dealId}/events`,
      {
        method: "POST",
        body: JSON.stringify({
          type: "ChangeReconciled",
          actorId,
          payload: body?.payload || {},
          authorityContext: {
            role,
            userId
          },
          evidenceRefs: body?.evidenceRefs || []
        })
      }
    );

    if (!eventResult.ok) {
      return sendError(
        res,
        eventResult.status || 500,
        eventResult.error || "Failed to reconcile change",
        eventResult.data
      );
    }

    invalidateDealCaches(dealId);

    return sendJson(res, 200, {
      status: "RECONCILED",
      event: eventResult.data
    });

  } catch (error) {
    console.error("[ReconcileChange] Error:", error);
    return sendError(res, 500, error.message || "Failed to reconcile change");
  }
}
