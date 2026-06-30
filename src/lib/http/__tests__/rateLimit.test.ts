import { describe, it, expect } from "vitest";
import { tickBucket, createRateLimiter, clientIpFromHeaders } from "@/lib/http/rateLimit";

const OPTS = { capacity: 3, refillPerSec: 1 };

describe("tickBucket", () => {
  it("allows a fresh key and seeds it with capacity-1 tokens", () => {
    const { bucket, allowed } = tickBucket(undefined, 1_000, OPTS);
    expect(allowed).toBe(true);
    expect(bucket.tokens).toBe(2);
    expect(bucket.updatedAt).toBe(1_000);
  });

  it("denies once the bucket is empty within the same instant", () => {
    let b = tickBucket(undefined, 0, { capacity: 1, refillPerSec: 1 }).bucket; // tokens 0
    const second = tickBucket(b, 0, { capacity: 1, refillPerSec: 1 });
    expect(second.allowed).toBe(false);
    expect(second.bucket.tokens).toBeLessThan(1);
  });

  it("refills over elapsed time and allows again", () => {
    const empty = { tokens: 0, updatedAt: 0 };
    const after2s = tickBucket(empty, 2_000, OPTS); // +2 tokens
    expect(after2s.allowed).toBe(true);
    expect(after2s.bucket.tokens).toBeCloseTo(1, 5);
  });

  it("never refills above capacity", () => {
    const full = { tokens: 3, updatedAt: 0 };
    const later = tickBucket(full, 100_000, OPTS);
    expect(later.bucket.tokens).toBeLessThanOrEqual(OPTS.capacity);
  });
});

describe("createRateLimiter", () => {
  it("throttles a single key after its burst, independently per key", () => {
    const rl = createRateLimiter({ capacity: 2, refillPerSec: 0 });
    expect(rl.check("a", 0)).toBe(true);
    expect(rl.check("a", 0)).toBe(true);
    expect(rl.check("a", 0)).toBe(false); // burst exhausted, no refill
    expect(rl.check("b", 0)).toBe(true); // a different key has its own bucket
  });
});

describe("clientIpFromHeaders", () => {
  it("uses the first x-forwarded-for entry", () => {
    const h = new Headers({ "x-forwarded-for": "203.0.113.7, 70.41.3.18" });
    expect(clientIpFromHeaders(h)).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip, then to a constant", () => {
    expect(clientIpFromHeaders(new Headers({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIpFromHeaders(new Headers())).toBe("unknown");
  });
});
