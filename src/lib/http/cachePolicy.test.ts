import { describe, it, expect } from "vitest";
import {
  cacheControlHeader,
  contentCacheControl,
  langOverridesSharedCache,
  PUBLIC_CONTENT_MAX_AGE,
  PUBLIC_CONTENT_S_MAXAGE,
  PUBLIC_CONTENT_SWR,
} from "./cachePolicy";

describe("cacheControlHeader", () => {
  it("returns private/no-store for non-cacheable responses", () => {
    expect(cacheControlHeader({ cacheable: false })).toBe("private, no-store");
    // browser/shared values are ignored when not cacheable
    expect(cacheControlHeader({ cacheable: false, sharedMaxAge: 999 })).toBe("private, no-store");
  });

  it("emits a full public directive set", () => {
    expect(
      cacheControlHeader({ cacheable: true, browserMaxAge: 60, sharedMaxAge: 300, staleWhileRevalidate: 86400 }),
    ).toBe("public, max-age=60, s-maxage=300, stale-while-revalidate=86400");
  });

  it("defaults browser max-age to 0 and omits unset shared directives", () => {
    expect(cacheControlHeader({ cacheable: true })).toBe("public, max-age=0");
    expect(cacheControlHeader({ cacheable: true, sharedMaxAge: 120 })).toBe("public, max-age=0, s-maxage=120");
  });

  it("clamps negatives to 0 and floors fractional seconds", () => {
    expect(
      cacheControlHeader({ cacheable: true, browserMaxAge: -5, sharedMaxAge: 30.9, staleWhileRevalidate: -1 }),
    ).toBe("public, max-age=0, s-maxage=30, stale-while-revalidate=0");
  });
});

describe("contentCacheControl", () => {
  it("share-caches anonymous public content by default", () => {
    expect(contentCacheControl()).toBe(
      `public, max-age=${PUBLIC_CONTENT_MAX_AGE}, s-maxage=${PUBLIC_CONTENT_S_MAXAGE}, stale-while-revalidate=${PUBLIC_CONTENT_SWR}`,
    );
  });

  it("never shares a personalized or preview render", () => {
    expect(contentCacheControl({ personalized: true })).toBe("private, no-store");
    expect(contentCacheControl({ preview: true })).toBe("private, no-store");
    expect(contentCacheControl({ personalized: false, preview: false })).toContain("public");
  });
});

describe("langOverridesSharedCache", () => {
  it("is shareable when language is in the URL (?lang=)", () => {
    // URL keys the CDN entry, so even a conflicting cookie is safe.
    expect(langOverridesSharedCache("en", "pl")).toBe(false);
    expect(langOverridesSharedCache("pl", "en")).toBe(false);
    expect(langOverridesSharedCache("en", null)).toBe(false);
  });

  it("is shareable with no cookie or a default-language cookie", () => {
    expect(langOverridesSharedCache(null, null)).toBe(false);
    expect(langOverridesSharedCache(null, "pl")).toBe(false); // cookie === default → identical to default render
  });

  it("is NOT shareable when a cookie overrides the default with no ?lang=", () => {
    expect(langOverridesSharedCache(null, "en")).toBe(true);
  });

  it("honours a custom default language", () => {
    expect(langOverridesSharedCache(null, "en", "en")).toBe(false);
    expect(langOverridesSharedCache(null, "pl", "en")).toBe(true);
  });
});
