import { describe, expect, it } from "vitest";

import {
  detectLangFromAcceptLanguage,
  langCookieHeaderValue,
  resolveHomepageLang,
} from "../langNegotiation";
import { readLangCookieFromHeader } from "../langCookie";

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
    expect(resolveHomepageLang("/analizy", "nes_lang=en", null).location).toBeNull();
    expect(resolveHomepageLang("/post/x", null, "de").location).toBeNull();
  });

  it("redirects a stored EN preference", () => {
    const d = resolveHomepageLang("/", "nes_lang=en", "pl");
    expect(d).toEqual({ lang: "en", location: "/en", persistCookie: false });
  });

  it("does not redirect a stored default preference", () => {
    expect(resolveHomepageLang("/", "nes_lang=pl", "de").location).toBeNull();
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
    expect(langCookieHeaderValue("en", false)).toContain("nes_lang=en");
  });
});

describe("nazwa cookie językowego: migracja", () => {
  it("czyta jeszcze POPRZEDNIĄ nazwę cookie", () => {
    // Cookie żyje rok. Bez odczytu zapasowego zmiana nazwy zabrałaby wracającemu
    // czytelnikowi wybrany język i przekierowała go na wersję z Accept-Language.
    expect(readLangCookieFromHeader("lovable_lang=en")).toBe("en");
  });

  it("nowa nazwa wygrywa, gdy w nagłówku są obie", () => {
    expect(readLangCookieFromHeader("lovable_lang=en; nes_lang=pl")).toBe("pl");
  });

  it("zapisuje WYŁĄCZNIE nową nazwę - stara wygasa sama", () => {
    const value = langCookieHeaderValue("pl", true);
    expect(value).toContain("nes_lang=pl");
    expect(value).not.toContain("lovable_lang");
  });
});
