import { describe, expect, it } from "vitest";

import {
  detectLangFromAcceptLanguage,
  langCookieHeaderValue,
  resolveHomepageLang,
} from "../langNegotiation";

describe("detectLangFromAcceptLanguage", () => {
  it("returns null without a header", () => {
    expect(detectLangFromAcceptLanguage(null)).toBeNull();
    expect(detectLangFromAcceptLanguage("")).toBeNull();
  });

  it("maps Polish to pl", () => {
    expect(detectLangFromAcceptLanguage("pl-PL,pl;q=0.9,en;q=0.8")).toBe("pl");
  });

  it("maps any other stated language to en", () => {
    expect(detectLangFromAcceptLanguage("de-DE,de;q=0.9")).toBe("en");
    expect(detectLangFromAcceptLanguage("fr")).toBe("en");
  });

  it("honours quality ordering", () => {
    expect(detectLangFromAcceptLanguage("en;q=0.5,pl;q=0.9")).toBe("pl");
  });

  it("skips the wildcard", () => {
    expect(detectLangFromAcceptLanguage("*")).toBeNull();
  });
});

describe("resolveHomepageLang", () => {
  it("ignores every path but the bare homepage", () => {
    expect(resolveHomepageLang("/analizy", "lovable_lang=en", null).location).toBeNull();
    expect(resolveHomepageLang("/post/x", null, "de").location).toBeNull();
  });

  it("redirects a stored EN preference", () => {
    const d = resolveHomepageLang("/", "lovable_lang=en", "pl");
    expect(d).toEqual({ lang: "en", location: "/en", persistCookie: false });
  });

  it("does not redirect a stored default preference", () => {
    expect(resolveHomepageLang("/", "lovable_lang=pl", "de").location).toBeNull();
  });

  it("falls back to Accept-Language and persists it", () => {
    expect(resolveHomepageLang("/", null, "de-DE")).toEqual({
      lang: "en",
      location: "/en",
      persistCookie: true,
    });
    expect(resolveHomepageLang("/", null, "pl-PL")).toEqual({
      lang: "pl",
      location: null,
      persistCookie: true,
    });
  });

  it("stays neutral when nothing is known", () => {
    expect(resolveHomepageLang("/", null, null)).toEqual({
      lang: null,
      location: null,
      persistCookie: false,
    });
  });
});

describe("langCookieHeaderValue", () => {
  it("marks the cookie Secure over https only", () => {
    expect(langCookieHeaderValue("en", true)).toContain("; Secure");
    expect(langCookieHeaderValue("en", false)).not.toContain("Secure");
    expect(langCookieHeaderValue("en", false)).toContain("lovable_lang=en");
  });
});
