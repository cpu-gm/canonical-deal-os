const cache = new Map();

export function getCache(key) {
  const entry = cache.get(key);
  if (!entry) {
    return null;
  }
  if (entry.expiresAt && entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

export function setCache(key, value, ttlMs) {
  const expiresAt = ttlMs ? Date.now() + ttlMs : null;
  cache.set(key, { value, expiresAt });
  return value;
}

export function deleteCache(key) {
  cache.delete(key);
}

export function deleteCacheByPrefix(prefix) {
  for (const key of cache.keys()) {
    if (typeof key === "string" && key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}

export function createLimiter(limit) {
  let active = 0;
  const queue = [];

  const next = () => {
    if (active >= limit || queue.length === 0) {
      return;
    }
    const { fn, resolve, reject } = queue.shift();
    active += 1;
    Promise.resolve()
      .then(fn)
      .then((result) => resolve(result))
      .catch((error) => reject(error))
      .finally(() => {
        active -= 1;
        next();
      });
  };

  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
}

export async function mapWithLimit(items, limit, mapper) {
  const run = createLimiter(limit);
  const results = await Promise.allSettled(
    items.map((item) => run(() => mapper(item)))
  );
  return results;
}

export function memoizeInFlight() {
  const inFlight = new Map();

  return async (key, fn) => {
    if (inFlight.has(key)) {
      return inFlight.get(key);
    }
    const promise = Promise.resolve()
      .then(fn)
      .finally(() => inFlight.delete(key));
    inFlight.set(key, promise);
    return promise;
  };
}
