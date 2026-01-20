import { inboxResponseSchema } from "../../src/lib/contracts.js";
import { buildCanonicalDeal } from "../mappers.js";
import { readStore } from "../store.js";
import { kernelFetchJson } from "../kernel.js";
import { getCache, setCache, mapWithLimit } from "../runtime.js";
import { getPrisma } from "../db.js";

const INBOX_CACHE_TTL_MS = Number(process.env.BFF_INBOX_TTL_MS ?? 5000);
const INBOX_CONCURRENCY = Number(process.env.BFF_INBOX_CONCURRENCY ?? 4);

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

export async function handleInbox(req, res, kernelBaseUrl, resolveUserId) {
  const url = new URL(req.url, "http://localhost");
  const scope = url.searchParams.get("scope") ?? "mine";
  if (!["mine", "waiting", "risk", "data_requests"].includes(scope)) {
    return sendError(res, 400, "Invalid inbox scope");
  }

  const userId = resolveUserId(req);
  const cacheKey = `inbox:${scope}:${userId}`;
  const cached = getCache(cacheKey);
  if (cached) {
    return sendJson(res, 200, inboxResponseSchema.parse(cached));
  }

  const store = await readStore();

  if (scope === "data_requests") {
    const prisma = getPrisma();
    const tasks = await prisma.workflowTask.findMany({
      where: {
        status: "OPEN",
        type: { in: ["REQUEST_EVIDENCE", "REVIEW_FLAG"] }
      },
      orderBy: { updatedAt: "desc" }
    });

    const dealNameById = new Map(
      store.dealIndex.map((entry) => [entry.id, entry.name])
    );

    const items = tasks.map((task) => ({
      dealId: task.dealId,
      dealName: dealNameById.get(task.dealId) ?? "Untitled Deal",
      lifecycle_state: null,
      truth_health: null,
      primary_blocker: task.title,
      next_action: {
        actionType: task.type,
        label: task.title
      },
      assignedToMe: task.createdByUserId === userId,
      updatedAt: task.updatedAt.toISOString()
    }));

    const response = { items };
    setCache(cacheKey, response, INBOX_CACHE_TTL_MS);
    return sendJson(res, 200, inboxResponseSchema.parse(response));
  }

  const SNAPSHOT_CACHE_TTL_MS = Number(process.env.BFF_SNAPSHOT_TTL_MS ?? 5000);
  const { getCache: getSnapCache, setCache: setSnapCache } = await import("../runtime.js");

  const profileByDealId = new Map(
    store.dealProfiles.map((item) => [item.dealId, item])
  );
  const assignedDeals = new Set(
    store.userActors
      .filter((entry) => entry.userId === userId)
      .map((entry) => entry.dealId)
  );

  const results = await mapWithLimit(store.dealIndex, INBOX_CONCURRENCY, async (record) => {
    const kernelDeal = await kernelFetchJson(
      `${kernelBaseUrl}/deals/${record.id}`
    );
    let snapshot = getCache(`snapshot:${record.id}`);
    if (!snapshot) {
      snapshot = await kernelFetchJson(
        `${kernelBaseUrl}/deals/${record.id}/snapshot`
      );
      setCache(`snapshot:${record.id}`, snapshot, SNAPSHOT_CACHE_TTL_MS);
    }

    const profileEntry = profileByDealId.get(record.id);
    const canonical = buildCanonicalDeal(
      {
        profile: profileEntry?.profile ?? {},
        profile_meta: profileEntry?.provenance ?? {}
      },
      kernelDeal,
      snapshot
    );

    const truthHealth = canonical.truth_health ?? "healthy";
    const assignedToMe = assignedDeals.has(record.id);
    const nextAction =
      canonical.next_action_type || canonical.next_action
        ? {
            actionType: canonical.next_action_type ?? null,
            label: canonical.next_action ?? null
          }
        : null;

    return {
      dealId: canonical.id,
      dealName: canonical.name,
      lifecycle_state: canonical.lifecycle_state ?? null,
      truth_health: truthHealth ?? null,
      primary_blocker: canonical.blocked_by ?? null,
      next_action: nextAction,
      assignedToMe,
      updatedAt: kernelDeal.updatedAt ?? kernelDeal.createdAt ?? null,
      stress_mode: canonical.stress_mode ?? false
    };
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
    return sendKernelUnavailable(res, kernelDown.reason);
  }

  const rawItems = results
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value);

  const items = rawItems.filter((item) => {
    const truthHealth = item.truth_health ?? "healthy";
    const isHealthy = truthHealth === "healthy" || truthHealth === null;
    const isRisk =
      item.stress_mode || truthHealth === "risk" || truthHealth === "danger";
    if (scope === "mine") {
      return item.assignedToMe && !isHealthy;
    }
    if (scope === "waiting") {
      return !item.assignedToMe && !isHealthy;
    }
    return isRisk;
  });

  const response = {
    items: items.map(({ stress_mode, ...rest }) => rest)
  };

  setCache(cacheKey, response, INBOX_CACHE_TTL_MS);
  sendJson(res, 200, inboxResponseSchema.parse(response));
}
