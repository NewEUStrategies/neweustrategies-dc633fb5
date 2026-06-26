// Cache-Control policy for SSR document responses. Pure + framework-free so it
// is fully unit-testable; the isomorphic setter in responseHeaders.ts applies
// the result on the server only.
//
// Before this, only sitemap.xml / robots.txt carried cache headers - every
// content page was re-rendered from scratch on every request, with no edge or
// browser caching. These policies turn the public site into an ISR-like setup:
// the CDN serves a cached render for `s-maxage`, then serves it stale (up to
// `stale-while-revalidate`) while revalidating in the background, so visitors
// almost never wait on a cold render.

export interface CacheControlInput {
  /** When false, the response must never be stored by a shared/browser cache. */
  cacheable: boolean;
  /** Browser freshness in seconds. Default 0 (revalidate via the shared cache). */
  browserMaxAge?: number;
  /** Shared/CDN freshness in seconds. */
  sharedMaxAge?: number;
  /** Window (seconds) a shared cache may serve a stale response while revalidating. */
  staleWhileRevalidate?: number;
}

/** Build a Cache-Control header value from a policy. */
export function cacheControlHeader(input: CacheControlInput): string {
  if (!input.cacheable) return "private, no-store";
  const parts = ["public", `max-age=${Math.max(0, Math.floor(input.browserMaxAge ?? 0))}`];
  if (input.sharedMaxAge != null) parts.push(`s-maxage=${Math.max(0, Math.floor(input.sharedMaxAge))}`);
  if (input.staleWhileRevalidate != null) {
    parts.push(`stale-while-revalidate=${Math.max(0, Math.floor(input.staleWhileRevalidate))}`);
  }
  return parts.join(", ");
}

// Defaults tuned for a content site: a tiny browser TTL (snappy back/forward
// without serving long-stale content from the user's own cache), a few minutes
// of shared/CDN freshness, and a full day of stale-while-revalidate.
export const PUBLIC_CONTENT_MAX_AGE = 60; // s, browser
export const PUBLIC_CONTENT_S_MAXAGE = 300; // s, CDN/edge
export const PUBLIC_CONTENT_SWR = 86400; // s, serve-stale window

export interface ContentCachePolicy {
  /** Personalized render (depends on the visitor's session) → never shared-cache. */
  personalized?: boolean;
  /** Editor / preview render → never cache. */
  preview?: boolean;
}

/**
 * Cache-Control for a public content document (home, post, page). The public
 * SSR output is the anonymous shell (session-specific UI hydrates on the
 * client and gated bodies are fetched client-side), so it is safe to share-
 * cache. Personalized or preview renders opt out entirely.
 */
export function contentCacheControl(policy: ContentCachePolicy = {}): string {
  if (policy.personalized || policy.preview) return cacheControlHeader({ cacheable: false });
  return cacheControlHeader({
    cacheable: true,
    browserMaxAge: PUBLIC_CONTENT_MAX_AGE,
    sharedMaxAge: PUBLIC_CONTENT_S_MAXAGE,
    staleWhileRevalidate: PUBLIC_CONTENT_SWR,
  });
}
