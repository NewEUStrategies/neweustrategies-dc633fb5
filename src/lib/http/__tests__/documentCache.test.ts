import { describe, expect, it } from "vitest";

import {
  DOCUMENT_CACHE_MAX_FRESH_MS,
  DOCUMENT_CACHE_MAX_SWR_MS,
  documentPathVariants,
  documentStorePolicy,
  normalizeDocumentPath,
  planDocumentCache,
  postDocumentPaths,
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

  it("models no-cache and must-revalidate instead of silently dropping them", () => {
    // A silent `default: break` meant "may be served without validation" - and
    // this cache cannot validate. Modelling them lets the policy refuse.
    const parsed = parseCacheControl("public, s-maxage=600, no-cache, must-revalidate");
    expect(parsed.noCache).toBe(true);
    expect(parsed.mustRevalidate).toBe(true);
    expect(parsed.public).toBe(true);
    expect(parsed.sMaxAge).toBe(600);
  });

  it("leaves both validation flags false for the header this app actually emits", () => {
    expect(
      parseCacheControl("public, max-age=60, s-maxage=900, stale-while-revalidate=86400"),
    ).toMatchObject({ noCache: false, mustRevalidate: false });
  });

  it('reads a qualified no-cache="field" as an unqualified one', () => {
    // This store cannot strip individual headers from a replayed response, so
    // the qualified form has to be read the strict way.
    expect(parseCacheControl('public, s-maxage=600, no-cache="set-cookie"').noCache).toBe(true);
  });

  it("treats proxy-revalidate like must-revalidate - this cache IS a shared cache", () => {
    expect(parseCacheControl("public, s-maxage=600, proxy-revalidate").mustRevalidate).toBe(true);
  });

  it("ignores empty segments, unknown directives and a negative s-maxage", () => {
    // A defensive parser must survive a header written by hand or by another
    // proxy: a trailing comma, a directive this cache does not model, and a
    // value that is syntactically fine but semantically nonsense.
    const parsed = parseCacheControl("public, , immutable, s-maxage=-5, stale-while-revalidate=x");
    expect(parsed.public).toBe(true);
    expect(parsed.sMaxAge).toBeNull();
    expect(parsed.staleWhileRevalidate).toBeNull();
    expect(parsed.noCache).toBe(false);
    expect(parsed.mustRevalidate).toBe(false);
    // A seconds directive written with no "=" at all: the token parses, the
    // value is undefined, and the field must stay null rather than NaN.
    expect(parseCacheControl("public, s-maxage").sMaxAge).toBeNull();
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

  // S26: dokumenty z POŚWIADCZENIEM w ścieżce nigdy nie wchodzą do cache'u.
  it.each([
    "/tickets/transfer/AbCdEfGhIjKlMnOpQrStUvWxYz012345",
    "/en/tickets/transfer/AbCdEfGhIjKlMnOpQrStUvWxYz012345",
    "/tickets",
    "/certificates/ABCD-EFGH-JKMN-PQRS",
    "/en/certificates/ABCD-EFGH-JKMN-PQRS",
  ])("bypasses the credential surface %s", (path) => {
    expect(planDocumentCache(req(`https://example.org${path}`), host)).toEqual({
      kind: "bypass",
      reason: "path",
    });
  });

  it("keeps look-alike public paths cacheable (prefix match on whole segments)", () => {
    expect(planDocumentCache(req("https://example.org/tickets-guide"), host).kind).toBe("lookup");
    expect(planDocumentCache(req("https://example.org/certificatesx"), host).kind).toBe("lookup");
  });

  // MIN-2: `/events/<slug>/me` renderuje na serwerze ten sam szkielet dla każdej
  // zakładki, więc `?tab=` wypada z klucza zamiast wymuszać BYPASS.
  it("drops `tab` from the key of the participant panel route only", () => {
    const bare = planDocumentCache(req("https://example.org/events/forum/me"), host);
    expect(bare).toEqual({ kind: "lookup", key: "example.org::/events/forum/me" });
    expect(
      planDocumentCache(req("https://example.org/events/forum/me?tab=schedule"), host),
    ).toEqual(bare);
    expect(
      planDocumentCache(req("https://example.org/events/forum/me?TAB=profile&utm_source=x"), host),
    ).toEqual(bare);
    expect(
      planDocumentCache(req("https://example.org/en/events/forum/me?tab=follow-up"), host),
    ).toEqual({ kind: "lookup", key: "example.org::/en/events/forum/me" });
  });

  it("does not drop `tab` elsewhere, nor other params on the panel route", () => {
    expect(planDocumentCache(req("https://example.org/events/forum?tab=schedule"), host)).toEqual({
      kind: "bypass",
      reason: "query",
    });
    expect(planDocumentCache(req("https://example.org/events/forum/me/x?tab=a"), host)).toEqual({
      kind: "bypass",
      reason: "query",
    });
    expect(planDocumentCache(req("https://example.org/events/forum/me?token=a"), host)).toEqual({
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

  it("refuses to store a no-cache document - it cannot revalidate before reuse", () => {
    // `freshMs = 0` is not a middle ground here: the entry would be served
    // STALE from the first millisecond, i.e. the exact inverse of no-cache.
    expect(documentStorePolicy(200, html, "public, s-maxage=600, no-cache").store).toBe(false);
    expect(
      documentStorePolicy(200, html, "public, s-maxage=900, stale-while-revalidate=86400, no-cache")
        .store,
    ).toBe(false);
  });

  it("keeps freshness but drops the stale window for must-revalidate", () => {
    const policy = documentStorePolicy(
      200,
      html,
      "public, s-maxage=30, stale-while-revalidate=600, must-revalidate",
    );
    expect(policy.store).toBe(true);
    expect(policy.freshMs).toBe(30_000);
    // Expiry becomes a plain MISS (full render) instead of a stale serve.
    expect(policy.swrMs).toBe(0);
  });

  it("leaves today's emitted header untouched - this is a latent hole, not a behaviour change", () => {
    const policy = documentStorePolicy(
      200,
      html,
      "public, s-maxage=30, stale-while-revalidate=600",
    );
    expect(policy).toEqual({ store: true, freshMs: 30_000, swrMs: 600_000 });
  });
});

describe("normalizeDocumentPath", () => {
  it("sprowadza ścieżkę do postaci klucza: bez query, fragmentu, końcowego `/` i prefiksu języka", () => {
    expect(normalizeDocumentPath("/analizy/tekst/")).toBe("/analizy/tekst");
    expect(normalizeDocumentPath("/analizy/tekst?page=2#top")).toBe("/analizy/tekst");
    expect(normalizeDocumentPath("/en/analizy/tekst")).toBe("/analizy/tekst");
    expect(normalizeDocumentPath("  /blog  ")).toBe("/blog");
    expect(normalizeDocumentPath("/")).toBe("/");
    expect(normalizeDocumentPath("/en")).toBe("/");
  });

  it("odrzuca wejście, które nie jest ścieżką względną serwisu - purge nie zgaduje", () => {
    expect(normalizeDocumentPath("")).toBeNull();
    expect(normalizeDocumentPath("https://example.org/x")).toBeNull();
    expect(normalizeDocumentPath("//evil.example/x")).toBeNull();
    expect(normalizeDocumentPath("blog")).toBeNull();
  });
});

describe("documentPathVariants", () => {
  it("dokłada wariant /en do każdej ścieżki i scala duplikaty", () => {
    expect(documentPathVariants(["/analizy/tekst", "/en/analizy/tekst"])).toEqual([
      "/analizy/tekst",
      "/en/analizy/tekst",
    ]);
    expect(documentPathVariants(["/"])).toEqual(["/", "/en"]);
  });

  it("pomija wejścia niepoprawne, nie przerywając reszty", () => {
    expect(documentPathVariants(["", "https://x.example/a", "/blog"])).toEqual([
      "/blog",
      "/en/blog",
    ]);
  });
});

describe("postDocumentPaths", () => {
  it("zawsze obejmuje stronę główną i listing bloga (pokazują najnowsze wpisy)", () => {
    expect(postDocumentPaths([])).toEqual(["/", "/blog"]);
  });

  it("dokłada adres legacy /post/<slug> i adres kanoniczny (z wiodącym `/` lub bez)", () => {
    expect(postDocumentPaths([{ slug: "tekst", canonicalPath: "analizy/tekst" }])).toEqual([
      "/",
      "/blog",
      "/post/tekst",
      "/analizy/tekst",
    ]);
    expect(postDocumentPaths([{ slug: "/tekst/", canonicalPath: "/analizy/tekst" }])).toContain(
      "/post/tekst",
    );
  });

  it("pusty slug nie produkuje adresu /post/, a brak kanonicznego nie psuje listy", () => {
    expect(postDocumentPaths([{ slug: "  " }])).toEqual(["/", "/blog"]);
    expect(postDocumentPaths([{ slug: "a" }, { slug: "b", canonicalPath: null }])).toEqual([
      "/",
      "/blog",
      "/post/a",
      "/post/b",
    ]);
  });
});
