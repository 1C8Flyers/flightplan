const DEFAULT_TTL_MS = 5 * 60 * 1000;

const cacheStore = new Map();

export function getCache(key) {
  const entry = cacheStore.get(key);

  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= Date.now()) {
    cacheStore.delete(key);
    return null;
  }

  return entry.value;
}

export function setCache(key, value, ttlMs = DEFAULT_TTL_MS) {
  cacheStore.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });

  return value;
}

export function clearCache() {
  cacheStore.clear();
}

export { DEFAULT_TTL_MS };
