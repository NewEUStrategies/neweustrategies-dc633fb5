// In-memory token-bucket rate limiter for the unauthenticated public ingest
// endpoints (RUM vitals + client-error beacons). Those endpoints cannot require
// auth - the browser delivers them via navigator.sendBeacon - so a per-IP token
// bucket is the defense against a single client flooding the telemetry tables
// and skewing the admin dashboard.
//
// The limiter is per-isolate (serverless instances do not share memory), so it
// is a mitigation, not a hard global quota; that is the right trade for
// best-effort telemetry. The pure `tickBucket` core takes an injected clock so
// the refill maths is unit-testable without timers.

export interface Bucket {
  /** Tokens currently available (fractional during refill). */
  tokens: number;
  /** Epoch ms of the last update, used to compute elapsed refill. */
  updatedAt: number;
}

export interface RateLimitOptions {
  /** Max burst: tokens a fresh key starts with and can refill back up to. */
  capacity: number;
  /** Sustained rate: tokens regained per second. */
  refillPerSec: number;
}

/**
 * Pure token-bucket step. Given the prior bucket (or undefined for a new key),
 * the current time and the limit, returns the next bucket and whether this
 * request is allowed. Never mutates its input.
 */
export function tickBucket(
  bucket: Bucket | undefined,
  now: number,
  opts: RateLimitOptions,
): { bucket: Bucket; allowed: boolean } {
  const cap = Math.max(1, opts.capacity);
  if (!bucket) {
    return { bucket: { tokens: cap - 1, updatedAt: now }, allowed: true };
  }
  const elapsedSec = Math.max(0, (now - bucket.updatedAt) / 1000);
  const refilled = Math.min(cap, bucket.tokens + elapsedSec * opts.refillPerSec);
  if (refilled >= 1) {
    return { bucket: { tokens: refilled - 1, updatedAt: now }, allowed: true };
  }
  return { bucket: { tokens: refilled, updatedAt: now }, allowed: false };
}

// Bound memory: a pathological spread of distinct keys (spoofed IPs) is flushed
// wholesale rather than allowed to grow without limit. Telemetry rate-limiting
// tolerates the occasional reset.
const MAX_KEYS = 10_000;

/** Create an isolated limiter instance with its own key store. */
export function createRateLimiter(opts: RateLimitOptions) {
  const store = new Map<string, Bucket>();
  return {
    /** Returns true if the request for `key` is allowed at time `now` (ms). */
    check(key: string, now: number): boolean {
      if (store.size > MAX_KEYS) store.clear();
      const { bucket, allowed } = tickBucket(store.get(key), now, opts);
      store.set(key, bucket);
      return allowed;
    },
  };
}

/**
 * Best-effort client IP for rate-limiting. Reads the proxy-forwarded headers
 * (correct behind the Lovable edge proxy / any CDN); falls back to a constant so
 * an IP-less request still shares one bucket rather than bypassing the limit.
 */
export function clientIpFromHeaders(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}
