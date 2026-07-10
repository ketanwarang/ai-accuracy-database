// Tiny module-scope cache for page data, mirroring the session cache in lib/auth.tsx.
// Lets pages render cached content instantly on revisit instead of a fresh skeleton,
// while still silently refetching in the background (stale-while-revalidate).

const cache = new Map<string, unknown>();

export function getCached<T>(key: string): T | undefined {
  return cache.get(key) as T | undefined;
}

export function setCached<T>(key: string, value: T): void {
  cache.set(key, value);
}

export function clearCached(key?: string): void {
  if (key) cache.delete(key);
  else cache.clear();
}
