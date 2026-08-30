export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  consume(key: string): RateLimitResult;
}

export interface MemoryRateLimiterOptions {
  limit: number;
  windowMs: number;
  maxKeys?: number;
  now?: () => number;
}

/** Anonymous page-loads of /api/session: plenty for a human, tight for a loop. */
export const SESSION_RATE = { limit: 30, windowMs: 60_000 } as const;

/** Blind votes are a write. A person does not need more than this per minute. */
export const BLIND_CHOICE_RATE = { limit: 10, windowMs: 60_000 } as const;

/**
 * Isolate-local sliding window. Not a global quota: Cloudflare runs many
 * isolates. It is still fail-closed-enough for a single noisy client, and
 * for a flood of new keys (the map will not grow without bound).
 */
export function memoryRateLimiter(options: MemoryRateLimiterOptions): RateLimiter {
  const hits = new Map<string, number[]>();
  const maxKeys = options.maxKeys ?? 20_000;
  const nowFn = options.now ?? Date.now;

  const sweepExpired = (now: number) => {
    const budget = Math.min(8, hits.size);
    for (let index = 0; index < budget; index += 1) {
      const entry = hits.entries().next().value as [string, number[]] | undefined;
      if (!entry) return;
      const [candidate, recorded] = entry;
      hits.delete(candidate);
      const active = recorded.filter((time) => now - time < options.windowMs);
      if (active.length > 0) hits.set(candidate, active);
    }
  };

  return {
    consume(key: string): RateLimitResult {
      const now = nowFn();
      // Rotate a bounded number of buckets on every request. Expired clients
      // free capacity, while active clients move to the back of the queue.
      sweepExpired(now);
      const stamps = (hits.get(key) ?? []).filter((time) => now - time < options.windowMs);

      if (stamps.length >= options.limit) {
        hits.set(key, stamps);
        const oldest = stamps[0] ?? now;
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((oldest + options.windowMs - now) / 1000)),
        };
      }

      if (!hits.has(key) && hits.size >= maxKeys) {
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(options.windowMs / 1000)) };
      }

      stamps.push(now);
      hits.set(key, stamps);
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}

/** Cloudflare overwrites this header; anything else is spoofable. Missing IP shares one bucket. */
export function clientKey(request: Request): string {
  const ip = request.headers.get("CF-Connecting-IP")?.trim();
  if (ip && ip.length > 0 && ip.length <= 128) return ip;
  return "missing";
}
