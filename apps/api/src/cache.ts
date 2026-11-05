import { Redis } from 'ioredis';

/**
 * Read-through cache for hot catalogue reads (proposal §8: Redis cache).
 * Uses Redis when REDIS_URL is set, otherwise an in-process map — so local
 * development and tests need no Redis. Values are JSON.
 */
export interface Cache {
  readonly kind: 'redis' | 'memory';
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  /** Delete every key starting with prefix. */
  invalidate(prefix: string): Promise<void>;
  stats(): { hits: number; misses: number };
  close(): Promise<void>;
}

export const CACHE_KEYS = {
  models: 'catalogue:models',
  providers: 'catalogue:providers',
  analytics: 'catalogue:analytics',
} as const;

export const CATALOGUE_PREFIX = 'catalogue:';

class MemoryCache implements Cache {
  readonly kind = 'memory' as const;
  private store = new Map<string, { value: string; expires: number }>();
  private hits = 0;
  private misses = 0;

  async get<T>(key: string): Promise<T | null> {
    const e = this.store.get(key);
    if (!e || e.expires < Date.now()) {
      if (e) this.store.delete(key);
      this.misses++;
      return null;
    }
    this.hits++;
    return JSON.parse(e.value) as T;
  }
  async set(key: string, value: unknown, ttlSeconds: number) {
    this.store.set(key, { value: JSON.stringify(value), expires: Date.now() + ttlSeconds * 1000 });
  }
  async invalidate(prefix: string) {
    for (const k of this.store.keys()) if (k.startsWith(prefix)) this.store.delete(k);
  }
  stats() {
    return { hits: this.hits, misses: this.misses };
  }
  async close() {}
}

class RedisCache implements Cache {
  readonly kind = 'redis' as const;
  private hits = 0;
  private misses = 0;
  constructor(private redis: Redis) {}

  async get<T>(key: string): Promise<T | null> {
    try {
      const v = await this.redis.get(`pf:${key}`);
      if (v === null) {
        this.misses++;
        return null;
      }
      this.hits++;
      return JSON.parse(v) as T;
    } catch {
      // A cache outage must never take reads down: fall through to the database.
      this.misses++;
      return null;
    }
  }
  async set(key: string, value: unknown, ttlSeconds: number) {
    try {
      await this.redis.set(`pf:${key}`, JSON.stringify(value), 'EX', ttlSeconds);
    } catch {
      // ignore
    }
  }
  async invalidate(prefix: string) {
    try {
      let cursor = '0';
      do {
        const [next, keys] = await this.redis.scan(cursor, 'MATCH', `pf:${prefix}*`, 'COUNT', 200);
        cursor = next;
        if (keys.length) await this.redis.del(...keys);
      } while (cursor !== '0');
    } catch {
      // ignore: entries expire on their own TTL
    }
  }
  stats() {
    return { hits: this.hits, misses: this.misses };
  }
  async close() {
    await this.redis.quit().catch(() => {});
  }
}

export function createCache(redisUrl: string | undefined): Cache {
  if (!redisUrl) return new MemoryCache();
  return new RedisCache(new Redis(redisUrl, { lazyConnect: false, maxRetriesPerRequest: 2, enableOfflineQueue: false }));
}

/** Read-through helper. */
export async function cached<T>(cache: Cache, key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
  const hit = await cache.get<T>(key);
  if (hit !== null) return hit;
  const value = await load();
  await cache.set(key, value, ttlSeconds);
  return value;
}
