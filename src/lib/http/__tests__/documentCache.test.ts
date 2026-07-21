import { describe, expect, it } from "vitest";

import {
  DOCUMENT_CACHE_MAX_FRESH_MS,
  DOCUMENT_CACHE_MAX_SWR_MS,
  documentStorePolicy,
  planDocumentCache,
  stripLangPrefix,
  type DocumentCacheRequest,
} from "../documentCache";
import { parseCacheControl } from "../parseCacheControl";

// Celowo NIE konstruujemy Request: konstruktor przeglądarkowy (happy-dom)
// wycina "zakazane" nagłówki (cookie, host), a polityka musi być testowalna
// dokładnie na tym, co czyta. Samodzielny Headers nie ma tego guarda.
function req(
  url: string,
  init?: { method?: string; headers?: Record<string, string> },
): DocumentCacheRequest {
  return {
    url,
    method: init?.method ?? "GET",
    headers: new Headers(init?.headers),
  };
}

describe("parseCacheControl", () => {
  it("parses the directives NES Edge Cache cares about", () => {
    const cc = parseCacheControl("public, max-age=60, s-maxage=900, stale-while-revalidate=86400");
    expect(cc.public).toBe(true);
    expect(cc.private).toBe(false);
    expect(cc.noStore).toBe(false);
    expect(cc.sMaxAge).toBe(900);
    expect(cc.staleWhileRevalidate).toBe(86400);
  });

  it("is defensive about malformed input", () => {
    expect(parseCacheControl(null).public).toBe(false);
    expect(parseCacheControl("s-maxage=abc").sMaxAge).toBeNull();
    expect(parseCacheControl("private, no-store")).toMatchObject({ private: true, noStore: true });
  });
});

describe("stripLangPrefix", () => {
  it("maps the EN prefix onto the canonical path", () => {
    expect(stripLangPrefix("/en/admin")).toBe("/admin");
    expect(stripLangPrefix("/en")).toBe("/");
    expect(stripLangPrefix("/blog")).toBe("/blog");
  });
});

describe("planDocumentCache", () => {
  const host = "example.org";

  it("bypasses non-GET requests", () => {
    const plan = planDocumentCache(req("https://example.org/post", { method: "POST" }), host);
    expect(plan).toEqual({ kind: "bypass", reason: "method" });
  });

  it("bypasses authenticated requests (Authorization or sb-* cookie)", () => {
    expect(
      planDocumentCache(
        req("https://example.org/post", { headers: { authorization: "Bearer x" } }),
        host,
      ),
    ).toEqual({ kind: "bypass", reason: "auth" });
    expect(
      planDocumentCache(
        req("https://example.org/post", { headers: { cookie: "sb-abc-auth-token=1" } }),
        host,
      ),
    ).toEqual({ kind: "bypass", reason: "auth" });
  });

  it("bypasses logged-in/transactional surfaces in both languages", () => {
    for (const path of ["/admin/posts", "/en/admin/posts", "/profile", "/checkout/plan-1"]) {
      expect(planDocumentCache(req(`https://example.org${path}`), host).kind).toBe("bypass");
    }
  });

  it("bypasses extension paths (xml/txt have their own cache policies)", () => {
    expect(planDocumentCache(req("https://example.org/sitemap.xml"), host).kind).toBe("bypass");
    expect(planDocumentCache(req("https://example.org/robots.txt"), host).kind).toBe("bypass");
  });

  it("strips tracking params so campaign visits share the clean entry", () => {
    const clean = planDocumentCache(req("https://example.org/analiza"), host);
    const tracked = planDocumentCache(
      req("https://example.org/analiza?utm_source=nl&utm_medium=email&fbclid=x"),
      host,
    );
    expect(clean).toEqual(tracked);
    expect(clean.kind).toBe("lookup");
  });

  it("keys pagination/sort params deterministically and bypasses unknown ones", () => {
    const a = planDocumentCache(req("https://example.org/blog?sort=popular&page=2"), host);
    const b = planDocumentCache(req("https://example.org/blog?page=2&sort=popular"), host);
    expect(a).toEqual(b);
    expect(a).toEqual({ kind: "lookup", key: "example.org::/blog?page=2&sort=popular" });
    expect(planDocumentCache(req("https://example.org/blog?weird=1"), host)).toEqual({
      kind: "bypass",
      reason: "query",
    });
  });

  it("scopes keys by tenant host, with a no-host fallback scope", () => {
    const a = planDocumentCache(req("https://x/post"), "tenant-a.eu");
    const b = planDocumentCache(req("https://x/post"), "tenant-b.eu");
    const none = planDocumentCache(req("https://x/post"), null);
    expect(a).toEqual({ kind: "lookup", key: "tenant-a.eu::/post" });
    expect(b).toEqual({ kind: "lookup", key: "tenant-b.eu::/post" });
    expect(none).toEqual({ kind: "lookup", key: "no-host::/post" });
  });
});

describe("documentStorePolicy", () => {
  const html = "text/html; charset=utf-8";
  const cc = "public, max-age=60, s-maxage=900, stale-while-revalidate=86400";

  it("stores only 200 HTML responses that opted into shared caching", () => {
    expect(documentStorePolicy(200, html, cc).store).toBe(true);
    expect(documentStorePolicy(404, html, cc).store).toBe(false);
    expect(documentStorePolicy(200, "application/json", cc).store).toBe(false);
    expect(documentStorePolicy(200, html, "private, no-store").store).toBe(false);
    expect(documentStorePolicy(200, html, "public, max-age=60").store).toBe(false);
    expect(documentStorePolicy(200, html, null).store).toBe(false);
  });

  it("caps freshness and SWR independently of the emitted header", () => {
    const policy = documentStorePolicy(200, html, cc);
    expect(policy.freshMs).toBe(DOCUMENT_CACHE_MAX_FRESH_MS);
    expect(policy.swrMs).toBe(Math.min(86400 * 1000, DOCUMENT_CACHE_MAX_SWR_MS));
    const short = documentStorePolicy(200, html, "public, s-maxage=30, stale-while-revalidate=10");
    expect(short.freshMs).toBe(30_000);
    expect(short.swrMs).toBe(10_000);
  });
});
