import { createDealRequestSchema, dealListResponseSchema, dealHomeResponseSchema, dealRecordsResponseSchema } from "../../src/lib/contracts.js";
import { buildCanonicalDeal, buildCanonicalAuthorities, buildCanonicalEvents, buildDealHome, buildEvidenceIndex } from "../mappers.js";
import { readStore, upsertDealIndex, upsertDealProfile } from "../store.js";
import { kernelFetchJson } from "../kernel.js";
import { getCache, setCache, deleteCache, deleteCacheByPrefix, mapWithLimit, memoizeInFlight } from "../runtime.js";
import { getAssignedDealIds, checkDealAccess } from "./deal-assignments.js";

// Structured logging helper
function log(level, category, message, meta = {}) {
  const timestamp = new Date().toISOString();
  const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
  console.log(`[${timestamp}] [${level}] [${category}] ${message}${metaStr}`);
}

export const CACHE_TTL = {
  LIST: Number(process.env.BFF_LIST_TTL_MS ?? 5000),
  HOME: Number(process.env.BFF_HOME_TTL_MS ?? 3000),
  SNAPSHOT: Number(process.env.BFF_SNAPSHOT_TTL_MS ?? 5000),
  RECORDS: Number(process.env.BFF_RECORDS_TTL_MS ?? 4000)
};

const LIST_CONCURRENCY = Number(process.env.BFF_LIST_CONCURRENCY ?? 4);

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

// SECURITY: authUser is required and must come from validated JWT at dispatch level
export async function handleListDeals(req, res, kernelBaseUrl, inFlight, authUser) {
  log('INFO', 'DEALS', 'List deals request started', {
    userId: authUser?.id,
    role: authUser?.role,
    orgId: authUser?.organizationId
  });

  if (!authUser) {
    log('WARN', 'DEALS', 'List deals - not authenticated');
    return sendJson(res, 401, { message: "Not authenticated" });
  }
  const role = authUser.role;
  const userId = authUser.id;
  const organizationId = authUser?.organizationId || null;

  // For GP Analyst and Counsel, filter by assigned deals (no caching for these)
  const filterByAssignment = ['GP Analyst', 'Counsel'].includes(role);
  let allowedDealIds = null;

  if (filterByAssignment) {
    allowedDealIds = new Set(await getAssignedDealIds(userId));
    log('INFO', 'DEALS', `Filtering by assignment`, { assignedCount: allowedDealIds.size });
    // If no deals assigned, return empty
    if (allowedDealIds.size === 0) {
      log('INFO', 'DEALS', 'No assigned deals found, returning empty');
      return sendJson(res, 200, []);
    }
  }

  // Use cache only for non-filtered requests (and when no org filter)
  const cacheKey = organizationId ? `deal-list:${organizationId}` : "deal-list";
  if (!filterByAssignment) {
    const cached = getCache(cacheKey);
    if (cached) {
      log('INFO', 'DEALS', 'Returning cached deal list', { cacheKey, count: cached.length });
      return sendJson(res, 200, dealListResponseSchema.parse(cached));
    }
    log('INFO', 'DEALS', 'Cache miss, fetching from Kernel', { cacheKey });
  }

  const store = await readStore();
  const profileByDealId = new Map(
    store.dealProfiles.map((item) => [item.dealId, item])
  );

  let dealIndex = store.dealIndex;
  log('INFO', 'DEALS', `Store loaded`, { totalDeals: dealIndex.length, profiles: profileByDealId.size });

  // Filter deal index by organization
  // Only show deals belonging to the user's organization
  if (organizationId) {
    dealIndex = dealIndex.filter(record => record.organizationId === organizationId);
    log('INFO', 'DEALS', `Filtered by org`, { orgId: organizationId, count: dealIndex.length });
  }

  // Filter deal index by allowed deals for GP Analyst/Counsel
  if (filterByAssignment && allowedDealIds) {
    dealIndex = dealIndex.filter(record => allowedDealIds.has(record.id));
  }

  if (dealIndex.length === 0) {
    log('INFO', 'DEALS', 'No deals found after filtering');
    return sendJson(res, 200, []);
  }

  const url = new URL(req.url, "http://localhost");
  const includeSnapshot = url.searchParams.get("includeSnapshot") === "1";

  log('INFO', 'DEALS', `Fetching ${dealIndex.length} deals from Kernel`, { includeSnapshot });

  const results = await mapWithLimit(dealIndex, LIST_CONCURRENCY, async (record) => {
    const kernelDeal = await kernelFetchJson(
      `${kernelBaseUrl}/deals/${record.id}`
    );
    let snapshot = null;
    if (includeSnapshot) {
      snapshot = await kernelFetchJson(
        `${kernelBaseUrl}/deals/${record.id}/snapshot`
      );
      setCache(`snapshot:${record.id}`, snapshot, CACHE_TTL.SNAPSHOT);
    } else {
      snapshot = getCache(`snapshot:${record.id}`);
    }

    const profileEntry = profileByDealId.get(record.id);
    const recordWithProfile = {
      profile: profileEntry?.profile ?? {},
      profile_meta: profileEntry?.provenance ?? {}
    };

    return buildCanonicalDeal(recordWithProfile, kernelDeal, snapshot);
  });

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
    log('ERROR', 'DEALS', 'Kernel unavailable while fetching deals', { error: kernelDown.reason?.message });
    return sendKernelUnavailable(res, kernelDown.reason);
  }

  const deals = results
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value);

  const rejected = results.filter((result) => result.status === "rejected");
  if (rejected.length > 0) {
    log('WARN', 'DEALS', `Some deals failed to fetch`, { failed: rejected.length, success: deals.length });
  }

  // Only cache full list (non-filtered)
  if (!filterByAssignment) {
    setCache(cacheKey, deals, CACHE_TTL.LIST);
    log('INFO', 'DEALS', 'Cached deal list', { cacheKey, count: deals.length });
  }

  log('INFO', 'DEALS', 'List deals completed', { count: deals.length });
  sendJson(res, 200, dealListResponseSchema.parse(deals));
}

export async function handleCreateDeal(req, res, kernelBaseUrl, readJsonBody, getPrisma, resolveUserId, authUser) {
  log('INFO', 'DEALS', 'Create deal request started', { userId: authUser?.id, role: authUser?.role });

  // Role enforcement: only GP or Admin can create deals
  if (!authUser) {
    log('WARN', 'DEALS', 'Create deal - not authenticated');
    return sendError(res, 401, "Not authenticated");
  }
  if (!['GP', 'Admin'].includes(authUser.role)) {
    log('WARN', 'DEALS', 'Create deal - forbidden', { role: authUser.role });
    return sendError(res, 403, "GP or Admin role required to create deals");
  }

  const body = await readJsonBody(req);
  const parsed = createDealRequestSchema.safeParse(body ?? {});
  if (!parsed.success) {
    log('WARN', 'DEALS', 'Create deal - invalid request', { errors: parsed.error.flatten() });
    return sendError(res, 400, "Invalid request", parsed.error.flatten());
  }

  const organizationId = authUser.organizationId;
  log('INFO', 'DEALS', 'Creating deal in Kernel', { name: parsed.data.name, orgId: organizationId });

  const kernelDeal = await kernelFetchJson(`${kernelBaseUrl}/deals`, {
    method: "POST",
    body: JSON.stringify({ name: parsed.data.name })
  });

  log('INFO', 'DEALS', 'Kernel deal created', { dealId: kernelDeal.id });

  const prisma = getPrisma();
  const sessionId = parsed.data.sessionId ?? null;
  if (sessionId) {
    const session = await prisma.lLMParseSession.findUnique({
      where: { id: sessionId }
    });
    if (session) {
      const parseJsonString = (value, fallback = null) => {
        if (typeof value !== "string") {
          return fallback;
        }
        try {
          return JSON.parse(value);
        } catch {
          return fallback;
        }
      };
      const parsedResult = parseJsonString(session.parsedResult, null);
      const recommendedTasks =
        parsedResult?.recommendedTasks ?? parsedResult?.recommended_tasks ?? [];
      await prisma.lLMParseSession.update({
        where: { id: sessionId },
        data: { dealId: kernelDeal.id }
      });
      if (Array.isArray(recommendedTasks) && recommendedTasks.length > 0) {
        await prisma.workflowTask.createMany({
          data: recommendedTasks.map((task) => ({
            dealId: kernelDeal.id,
            createdByUserId: resolveUserId(req),
            type: task.type ?? "REQUEST_EVIDENCE",
            title: task.title ?? "Provide evidence",
            description: task.description ?? null,
            status: task.status ?? "OPEN",
            relatedFieldPath: task.relatedFieldPath ?? null,
            relatedArtifactId: task.relatedArtifactId ?? null,
            severity: task.severity ?? "MEDIUM"
          }))
        });
      }
    }
  }

  await upsertDealIndex({
    id: kernelDeal.id,
    name: kernelDeal.name,
    organizationId,
    createdAt: kernelDeal.createdAt ?? new Date().toISOString()
  });

  const profileEntry = await upsertDealProfile(
    kernelDeal.id,
    parsed.data.profile ?? {},
    {
      source: "canonical-ui",
      asOf: new Date().toISOString()
    }
  );

  const snapshot = await kernelFetchJson(
    `${kernelBaseUrl}/deals/${kernelDeal.id}/snapshot`
  );

  setCache(`snapshot:${kernelDeal.id}`, snapshot, CACHE_TTL.SNAPSHOT);
  deleteCache("deal-list");
  deleteCacheByPrefix("inbox:");

  // Log deal creation for audit trail
  const prismaClient = getPrisma();
  await prismaClient.permissionAuditLog.create({
    data: {
      actorId: authUser.id,
      actorName: authUser.name,
      targetUserId: authUser.id,
      action: 'DEAL_CREATED',
      afterValue: JSON.stringify({ dealId: kernelDeal.id, name: kernelDeal.name }),
      ipAddress: req.headers["x-forwarded-for"] || req.socket?.remoteAddress
    }
  });

  const response = buildCanonicalDeal(
    {
      profile: profileEntry?.profile ?? {},
      profile_meta: profileEntry?.provenance ?? {}
    },
    kernelDeal,
    snapshot
  );
  sendJson(res, 201, response);
}

// SECURITY: authUser is required and must come from validated JWT at dispatch level
export async function handleDealHome(dealId, res, kernelBaseUrl, inFlight, req, authUser) {
  log('INFO', 'DEALS', 'Get deal home request', { dealId, userId: authUser?.id, role: authUser?.role });

  // Check access control for restricted roles using validated authUser
  if (authUser) {
    const role = authUser.role;
    const userId = authUser.id;
    log('INFO', 'DEALS', 'Checking deal access', { userId, role, dealId });
    const access = await checkDealAccess(role, userId, dealId);
    if (!access.allowed) {
      log('WARN', 'DEALS', 'Access denied by checkDealAccess', { dealId, reason: access.reason });
      return sendError(res, 403, access.reason || "Access denied");
    }
  }

  const store = await readStore();
  const record = store.dealIndex.find((item) => item.id === dealId);
  if (!record) {
    log('WARN', 'DEALS', 'Deal not found in BFF index', { dealId });
    return sendError(res, 404, "Deal not indexed in BFF");
  }

  // Organization isolation: ALWAYS verify deal belongs to user's org (no conditional bypass)
  if (!authUser) {
    log('WARN', 'DEALS', 'Not authenticated for deal access', { dealId });
    return sendError(res, 401, "Not authenticated");
  }
  log('INFO', 'DEALS', 'Org isolation check', { dealOrgId: record.organizationId, userOrgId: authUser.organizationId });
  if (record.organizationId && record.organizationId !== authUser.organizationId) {
    log('WARN', 'DEALS', 'Access denied - org mismatch', { dealId, dealOrgId: record.organizationId, userOrgId: authUser.organizationId });
    return sendError(res, 403, "Access denied - deal belongs to different organization");
  }

  const cacheKey = `deal-home:${dealId}`;
  const cached = getCache(cacheKey);
  if (cached) {
    log('INFO', 'DEALS', 'Returning cached deal home', { dealId, cacheKey });
    return sendJson(res, 200, dealHomeResponseSchema.parse(cached));
  }

  log('INFO', 'DEALS', 'Cache miss, building deal home from Kernel', { dealId, cacheKey });
  const profileEntry = store.dealProfiles.find((item) => item.dealId === dealId);

  const homeResult = await inFlight(cacheKey, async () =>
    buildDealHome(kernelBaseUrl, {
      id: record.id,
      profile: profileEntry?.profile ?? {},
      profile_meta: profileEntry?.provenance ?? {}
    })
  );

  if (homeResult.snapshot) {
    setCache(`snapshot:${dealId}`, homeResult.snapshot, CACHE_TTL.SNAPSHOT);
  }

  const { snapshot, ...home } = homeResult;
  setCache(cacheKey, home, CACHE_TTL.HOME);
  log('INFO', 'DEALS', 'Deal home loaded and cached', { dealId });
  sendJson(res, 200, dealHomeResponseSchema.parse(home));
}

// SECURITY: authUser is required and must come from validated JWT at dispatch level
export async function handleDealRecords(dealId, res, kernelBaseUrl, inFlight, req, authUser) {
  // Check access control for restricted roles using validated authUser
  if (authUser) {
    const role = authUser.role;
    const userId = authUser.id;
    const access = await checkDealAccess(role, userId, dealId);
    if (!access.allowed) {
      return sendError(res, 403, access.reason || "Access denied");
    }
  }

  const store = await readStore();
  const record = store.dealIndex.find((item) => item.id === dealId);
  if (!record) {
    return sendError(res, 404, "Deal not indexed in BFF");
  }

  // Organization isolation: ALWAYS verify deal belongs to user's org (no conditional bypass)
  if (!authUser) {
    return sendError(res, 401, "Not authenticated");
  }
  if (record.organizationId && record.organizationId !== authUser.organizationId) {
    return sendError(res, 403, "Access denied - deal belongs to different organization");
  }

  const cacheKey = `deal-records:${dealId}`;
  const cached = getCache(cacheKey);
  if (cached) {
    return sendJson(res, 200, dealRecordsResponseSchema.parse(cached));
  }

  const profileEntry = store.dealProfiles.find((item) => item.dealId === dealId);
  const recordWithProfile = {
    id: record.id,
    profile: profileEntry?.profile ?? {},
    profile_meta: profileEntry?.provenance ?? {}
  };

  const recordsResult = await inFlight(cacheKey, async () => {
    const [kernelDeal, snapshot, events, actors, artifacts, materials] =
      await Promise.all([
        kernelFetchJson(`${kernelBaseUrl}/deals/${record.id}`),
        kernelFetchJson(`${kernelBaseUrl}/deals/${record.id}/snapshot`),
        kernelFetchJson(`${kernelBaseUrl}/deals/${record.id}/events`),
        kernelFetchJson(`${kernelBaseUrl}/deals/${record.id}/actors`),
        kernelFetchJson(`${kernelBaseUrl}/deals/${record.id}/artifacts`),
        kernelFetchJson(`${kernelBaseUrl}/deals/${record.id}/materials`)
      ]);

    const evidenceIndex = buildEvidenceIndex(
      record.id,
      artifacts,
      events,
      materials,
      snapshot?.at
    );

    return {
      deal: buildCanonicalDeal(recordWithProfile, kernelDeal, snapshot),
      events: buildCanonicalEvents(events, actors),
      authorities: buildCanonicalAuthorities(actors),
      materials: (materials ?? []).map((material) => ({
        id: material.id,
        dealId: material.dealId ?? null,
        type: material.type,
        truthClass: material.truthClass ?? null,
        data: material.data ?? null,
        createdAt: material.createdAt ?? null
      })),
      approvals: snapshot?.approvals ?? {},
      evidence_index: evidenceIndex,
      snapshot
    };
  });

  if (recordsResult.snapshot) {
    setCache(`snapshot:${dealId}`, recordsResult.snapshot, CACHE_TTL.SNAPSHOT);
  }

  const { snapshot, ...response } = recordsResult;
  setCache(cacheKey, response, CACHE_TTL.RECORDS);
  sendJson(res, 200, dealRecordsResponseSchema.parse(response));
}

export function invalidateDealCaches(dealId) {
  deleteCache(`deal-home:${dealId}`);
  deleteCache(`deal-records:${dealId}`);
  deleteCache(`snapshot:${dealId}`);
  deleteCache("deal-list");
  deleteCacheByPrefix(`events:${dealId}:`);
  deleteCacheByPrefix("events:all:");
  deleteCacheByPrefix("inbox:");
}
