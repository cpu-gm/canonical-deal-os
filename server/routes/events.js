import { eventsResponseSchema } from "../../src/lib/contracts.js";
import { buildCanonicalEvents } from "../mappers.js";
import { readStore } from "../store.js";
import { kernelFetchJson } from "../kernel.js";
import { emitLpWebhook } from "../notifications.js";
import { getCache, setCache, mapWithLimit } from "../runtime.js";

const EVENTS_CACHE_TTL_MS = Number(process.env.BFF_EVENTS_TTL_MS ?? 4000);
const EVENTS_CONCURRENCY = Number(process.env.BFF_EVENTS_CONCURRENCY ?? 4);
const CAPITAL_EVENT_NOTIFICATION_TYPES = new Set([
  "CapitalCalled",
  "DistributionProcessed",
  "ReturnProcessed"
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

function sendKernelUnavailable(res, error) {
  sendJson(res, 502, {
    message: "Kernel unavailable",
    details: error?.message ?? null
  });
}

function parseLimitParam(value, fallback, max = 1000) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, max);
}

function parseOrderParam(value) {
  return value === "asc" ? "asc" : "desc";
}

export async function handleListEvents(req, res, kernelBaseUrl, inFlight) {
  const url = new URL(req.url, "http://localhost");
  const dealId = url.searchParams.get("dealId");
  const order = parseOrderParam(url.searchParams.get("order"));
  const limit = parseLimitParam(url.searchParams.get("limit"), 200, 1000);
  const cacheKey = `events:${dealId ?? "all"}:${order}:${limit}`;
  const cached = getCache(cacheKey);
  if (cached) {
    return sendJson(res, 200, eventsResponseSchema.parse(cached));
  }

  if (dealId) {
    const store = await readStore();
    const record = store.dealIndex.find((item) => item.id === dealId);
    if (!record) {
      return sendError(res, 404, "Deal not indexed in BFF");
    }

    const eventsResult = await inFlight(cacheKey, async () => {
      const [events, actors] = await Promise.all([
        kernelFetchJson(`${kernelBaseUrl}/deals/${dealId}/events`),
        kernelFetchJson(`${kernelBaseUrl}/deals/${dealId}/actors`)
      ]);

      const mapped = buildCanonicalEvents(events, actors);
      const ordered = order === "desc" ? [...mapped].reverse() : mapped;
      return ordered.slice(0, limit);
    });

    setCache(cacheKey, eventsResult, EVENTS_CACHE_TTL_MS);
    return sendJson(res, 200, eventsResponseSchema.parse(eventsResult));
  }

  const store = await readStore();
  if (store.dealIndex.length === 0) {
    return sendJson(res, 200, []);
  }

  const results = await mapWithLimit(
    store.dealIndex,
    EVENTS_CONCURRENCY,
    async (record) => {
      const [events, actors] = await Promise.all([
        kernelFetchJson(`${kernelBaseUrl}/deals/${record.id}/events`),
        kernelFetchJson(`${kernelBaseUrl}/deals/${record.id}/actors`)
      ]);
      return buildCanonicalEvents(events, actors);
    }
  );

  const kernelDown = results.find((result) => {
    if (result.status !== "rejected") {
      return false;
    }
    return (
      result.reason?.type === "KERNEL_UNAVAILABLE" ||
      (typeof result.reason?.status === "number" && result.reason.status >= 500)
    );
  });
  if (kernelDown) {
    return sendKernelUnavailable(res, kernelDown.reason);
  }

  const allEvents = results
    .filter((result) => result.status === "fulfilled")
    .flatMap((result) => result.value);

  const toMillis = (event) => {
    const value = event.timestamp ?? event.created_date;
    const parsed = Date.parse(value ?? "");
    return Number.isNaN(parsed) ? 0 : parsed;
  };

  const sorted = [...allEvents].sort((a, b) => toMillis(a) - toMillis(b));
  const ordered = order === "desc" ? sorted.reverse() : sorted;
  const limited = ordered.slice(0, limit);

  setCache(cacheKey, limited, EVENTS_CACHE_TTL_MS);
  sendJson(res, 200, eventsResponseSchema.parse(limited));
}

// SECURITY: authUser is required and must come from validated JWT at dispatch level
export async function handleCreateEvent(req, res, dealId, kernelBaseUrl, readJsonBody, getOrCreateActorId, invalidateDealCaches, authUser) {
  if (!authUser) {
    return sendError(res, 401, "Not authenticated");
  }

  const body = await readJsonBody(req);

  if (!body || !body.type) {
    return sendError(res, 400, "Event type is required");
  }

  // SECURITY: Use validated authUser instead of spoofable headers
  const userId = authUser.id;
  const role = authUser.role;
  const actorId = await getOrCreateActorId(dealId, userId, role, kernelBaseUrl);

  const { kernelRequest } = await import("../kernel.js");
  const result = await kernelRequest(
    `${kernelBaseUrl}/deals/${dealId}/events`,
    {
      method: "POST",
      body: JSON.stringify({
        type: body.type,
        actorId,
        payload: body.payload || {},
        authorityContext: body.authorityContext || {},
        evidenceRefs: body.evidenceRefs || []
      })
    }
  );

  if (result.ok) {
    invalidateDealCaches(dealId);
    if (CAPITAL_EVENT_NOTIFICATION_TYPES.has(body.type)) {
      void emitLpWebhook("LP_CAPITAL_EVENT", {
        dealId,
        eventType: body.type,
        payload: body.payload ?? {},
        authorityContext: body.authorityContext ?? {},
        actorId,
        createdBy: userId,
        kernelEventId: result.data?.id ?? null,
        kernelTimestamp: result.data?.createdAt ?? new Date().toISOString(),
        eventSummary: result.data
      });
    }
    return sendJson(res, 200, result.data);
  } else {
    return sendError(res, result.status, result.error || "Failed to create event");
  }
}
