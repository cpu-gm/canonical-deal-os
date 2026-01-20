import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const STORE_DIR = resolve(process.cwd(), "server", ".data");
const STORE_PATH = resolve(STORE_DIR, "store.json");
const EMPTY_STORE = {
  dealIndex: [],
  dealProfiles: [],
  userActors: [],
  idempotency: []
};

let storeLock = Promise.resolve();

function withStoreLock(fn) {
  const next = storeLock.then(fn, fn);
  storeLock = next.catch(() => undefined);
  return next;
}

async function ensureStoreDir() {
  await mkdir(STORE_DIR, { recursive: true });
}

async function readStoreUnsafe() {
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return { ...EMPTY_STORE };
    }
    return {
      dealIndex: Array.isArray(parsed.dealIndex) ? parsed.dealIndex : [],
      dealProfiles: Array.isArray(parsed.dealProfiles) ? parsed.dealProfiles : [],
      userActors: Array.isArray(parsed.userActors) ? parsed.userActors : [],
      idempotency: Array.isArray(parsed.idempotency) ? parsed.idempotency : []
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { ...EMPTY_STORE };
    }
    throw error;
  }
}

async function writeStoreUnsafe(store) {
  await ensureStoreDir();
  const tempPath = `${STORE_PATH}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, JSON.stringify(store, null, 2), "utf8");
  try {
    await rename(tempPath, STORE_PATH);
  } catch (error) {
    if (error.code === "EEXIST" || error.code === "EPERM") {
      await rm(STORE_PATH, { force: true });
      await rename(tempPath, STORE_PATH);
      return;
    }
    throw error;
  }
}

export async function readStore() {
  return readStoreUnsafe();
}

function pruneIdempotency(store) {
  const now = Date.now();
  const next = store.idempotency.filter((entry) => entry.expiresAt > now);
  const changed = next.length !== store.idempotency.length;
  if (changed) {
    store.idempotency = next;
  }
  return changed;
}

export async function upsertDealIndex(record) {
  return withStoreLock(async () => {
    const store = await readStoreUnsafe();
    const existingIndex = store.dealIndex.findIndex(
      (item) => item.id === record.id
    );
    const next = {
      id: record.id,
      name: record.name ?? null,
      organizationId: record.organizationId ?? null,
      createdAt: record.createdAt ?? new Date().toISOString()
    };
    if (existingIndex >= 0) {
      store.dealIndex[existingIndex] = {
        ...store.dealIndex[existingIndex],
        ...next
      };
    } else {
      store.dealIndex.push(next);
    }
    await writeStoreUnsafe(store);
    return store.dealIndex.find((item) => item.id === record.id);
  });
}

export async function upsertDealProfile(dealId, profile, provenance) {
  return withStoreLock(async () => {
    const store = await readStoreUnsafe();
    const existingIndex = store.dealProfiles.findIndex(
      (item) => item.dealId === dealId
    );
    const next = {
      dealId,
      profile: profile ?? {},
      provenance: provenance ?? { source: "canonical", asOf: new Date().toISOString() },
      updatedAt: new Date().toISOString()
    };
    if (existingIndex >= 0) {
      store.dealProfiles[existingIndex] = {
        ...store.dealProfiles[existingIndex],
        ...next
      };
    } else {
      store.dealProfiles.push(next);
    }
    await writeStoreUnsafe(store);
    return store.dealProfiles.find((item) => item.dealId === dealId);
  });
}

export async function getDealProfile(dealId) {
  const store = await readStoreUnsafe();
  return store.dealProfiles.find((item) => item.dealId === dealId) ?? null;
}

export async function listDealIndex() {
  const store = await readStoreUnsafe();
  return store.dealIndex;
}

export async function getUserActor(userId, dealId) {
  const store = await readStoreUnsafe();
  return (
    store.userActors.find(
      (item) => item.userId === userId && item.dealId === dealId
    ) ?? null
  );
}

export async function getIdempotencyEntry(key) {
  return withStoreLock(async () => {
    const store = await readStoreUnsafe();
    const changed = pruneIdempotency(store);
    const entry = store.idempotency.find((item) => item.key === key) ?? null;
    if (changed) {
      await writeStoreUnsafe(store);
    }
    return entry;
  });
}

export async function upsertIdempotencyEntry(entry) {
  return withStoreLock(async () => {
    const store = await readStoreUnsafe();
    pruneIdempotency(store);
    const existingIndex = store.idempotency.findIndex(
      (item) => item.key === entry.key
    );
    if (existingIndex >= 0) {
      store.idempotency[existingIndex] = {
        ...store.idempotency[existingIndex],
        ...entry
      };
    } else {
      store.idempotency.push(entry);
    }
    await writeStoreUnsafe(store);
    return store.idempotency.find((item) => item.key === entry.key) ?? null;
  });
}

export async function upsertUserActor(entry) {
  return withStoreLock(async () => {
    const store = await readStoreUnsafe();
    const existingIndex = store.userActors.findIndex(
      (item) =>
        item.userId === entry.userId && item.dealId === entry.dealId
    );
    const next = {
      userId: entry.userId,
      dealId: entry.dealId,
      actorId: entry.actorId,
      role: entry.role ?? "GP",
      updatedAt: new Date().toISOString()
    };
    if (existingIndex >= 0) {
      store.userActors[existingIndex] = {
        ...store.userActors[existingIndex],
        ...next
      };
    } else {
      store.userActors.push(next);
    }
    await writeStoreUnsafe(store);
    return store.userActors.find(
      (item) => item.userId === entry.userId && item.dealId === entry.dealId
    );
  });
}
