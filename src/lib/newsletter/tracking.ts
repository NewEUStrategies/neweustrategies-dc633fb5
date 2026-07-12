// Pure, dependency-free helpers for newsletter open/click tracking.
//
// Shared by the send pipeline (link rewriting + tracking pixel) and the public
// ingest routes (token / target validation). No server imports here so the
// logic is unit-testable in isolation; the DB writes live in
// trackingEvents.server.ts.

/** A tracking id reuses the subscriber's unsubscribe token: 16-128 hex chars. */
export function isValidTrackingToken(token: string | null | undefined): token is string {
  return !!token && token.length >= 16 && token.length <= 128 && /^[a-f0-9]+$/i.test(token);
}

/**
 * True only for an ABSOLUTE http/https URL. `new URL(raw)` (no base) rejects
 * relative paths, protocol-relative "//evil", and dangerous schemes
 * (javascript:, data:, mailto:) - the open-redirect guard for nl-click.
 */
export function isSafeHttpUrl(raw: string | null | undefined): raw is string {
  if (!raw) return false;
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Escape `&` for safe embedding of a URL inside an HTML attribute value. */
function escAttr(url: string): string {
  return url.replace(/&/g, "&amp;");
}

/** Absolute click-tracking redirect URL. `target` is fully percent-encoded. */
export function buildTrackedClickUrl(
  origin: string,
  campaignId: string,
  token: string,
  target: string,
): string {
  const u = new URL("/api/public/nl-click", origin);
  u.searchParams.set("c", campaignId);
  u.searchParams.set("s", token);
  u.searchParams.set("u", target);
  return u.toString();
}

/** Absolute open-tracking pixel URL. */
export function trackingPixelUrl(origin: string, campaignId: string, token: string): string {
  const u = new URL("/api/public/nl-open", origin);
  u.searchParams.set("c", campaignId);
  u.searchParams.set("s", token);
  return u.toString();
}

/** 1×1, display:none tracking pixel `<img>` (HTML-attribute-safe). */
export function trackingPixelImg(origin: string, campaignId: string, token: string): string {
  const src = escAttr(trackingPixelUrl(origin, campaignId, token));
  return `<img src="${src}" width="1" height="1" alt="" style="display:none;width:1px;height:1px" />`;
}

// Matches href="http(s)://..." and href='http(s)://...' (preserves the quote).
const HREF_RE = /href\s*=\s*(["'])(https?:\/\/[^"']+)\1/gi;

/**
 * Rewrite every absolute http/https `<a href>` in `html` to route through the
 * click-tracking redirect. `&amp;` in the captured URL is decoded before
 * re-encoding (email HTML commonly encodes query separators), and the emitted
 * href uses `&amp;` separators so the markup stays valid.
 */
export function rewriteTrackingLinks(
  html: string,
  origin: string,
  campaignId: string,
  token: string,
): string {
  return html.replace(HREF_RE, (_m, quote: string, url: string) => {
    const decoded = url.replace(/&amp;/gi, "&");
    const tracked = escAttr(buildTrackedClickUrl(origin, campaignId, token, decoded));
    return `href=${quote}${tracked}${quote}`;
  });
}
