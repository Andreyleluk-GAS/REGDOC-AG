/**
 * Простой in-memory кэш для /api/my-requests
 * Ускоряет повторные запросы — WebDAV не вызывается снова в течение TTL
 */

const CACHE_TTL = 30_000; // 30 секунд

const store = new Map(); // key → { data, ts }

export function cacheGet(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) {
    store.delete(key);
    return null;
  }
  return entry.data;
}

export function cacheSet(key, data) {
  store.set(key, { data, ts: Date.now() });
}

export function cacheInvalidate(key) {
  if (key) store.delete(key);
  else store.clear();
}

/** Инвалидируем по паттерну (например, все ключи, содержащие email) */
export function cacheInvalidateMatching(pattern) {
  for (const k of store.keys()) {
    if (k.includes(pattern)) store.delete(k);
  }
}
