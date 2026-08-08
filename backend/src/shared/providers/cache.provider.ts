export interface CacheProvider {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T, ttlMs: number): void;
  invalidate(key: string): void;
  /** Test/debug hook — how many times a key was actually computed (miss) vs served from cache. */
  stats(): { hits: number; misses: number };
}

interface Entry {
  value: unknown;
  expiresAt: number;
}

// No real Redis this phase (same call as Phase 2's job-queue decision — see
// docs/Phase4_Implementation_Plan.md §4). A bounded in-memory LRU with per-entry TTL implements
// the same get/set/invalidate surface a Redis-backed provider would; swapping later is a
// constructor change in getCacheProvider(), not a rewrite of any caller.
const MAX_ENTRIES = 500;

class InMemoryLruCacheProvider implements CacheProvider {
  private store = new Map<string, Entry>();
  private hits = 0;
  private misses = 0;

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (entry.expiresAt < Date.now()) {
      this.store.delete(key);
      this.misses++;
      return undefined;
    }
    // Refresh recency for LRU eviction.
    this.store.delete(key);
    this.store.set(key, entry);
    this.hits++;
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    this.store.delete(key);
    if (this.store.size >= MAX_ENTRIES) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) this.store.delete(oldestKey);
    }
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  invalidate(key: string): void {
    this.store.delete(key);
  }

  stats() {
    return { hits: this.hits, misses: this.misses };
  }
}

let cached: CacheProvider | null = null;

export function getCacheProvider(): CacheProvider {
  if (!cached) cached = new InMemoryLruCacheProvider();
  return cached;
}

/** Test-only escape hatch, same pattern as llm.provider.ts's __setLlmProviderForTests. */
export function __resetCacheProviderForTests() {
  cached = new InMemoryLruCacheProvider();
}
