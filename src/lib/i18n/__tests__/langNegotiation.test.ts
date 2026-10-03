import { describe, expect, it } from "vitest";

import {
  detectLangFromAcceptLanguage,
  langCookieHeaderValue,
  resolveHomepageLang,
} from "../langNegotiation";
import { readLangCookieFromHeader } from "../langCookie";
import type { AppLang } from "../localePath";

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
    expect(detectLangFromAcceptLanguage("*;q=0.5")).toBeNull();
    // Wildcard stoi wyżej, ale nic nie mówi - decyduje pierwszy konkretny język.
    expect(detectLangFromAcceptLanguage("*;q=1, pl;q=0.5")).toBe("pl");
    expect(detectLangFromAcceptLanguage("*, de;q=0.5")).toBe("en");
  });

  it("the TOP stated preference decides, not the mere presence of Polish", () => {
    expect(detectLangFromAcceptLanguage("en-US,pl;q=0.9")).toBe("en");
    expect(detectLangFromAcceptLanguage("de, pl;q=0.5, en;q=0.4")).toBe("en");
  });

  it("keeps header order for equal weights", () => {
    expect(detectLangFromAcceptLanguage("en, pl")).toBe("en");
    expect(detectLangFromAcceptLanguage("pl, en")).toBe("pl");
  });

  it("excludes q=0 and treats a malformed weight as q=0", () => {
    expect(detectLangFromAcceptLanguage("pl;q=0, de")).toBe("en");
    expect(detectLangFromAcceptLanguage("pl;q=0")).toBeNull();
    expect(detectLangFromAcceptLanguage("pl;q=0, en;q=0")).toBeNull();
    expect(detectLangFromAcceptLanguage("pl;q=abc, de;q=0.1")).toBe("en");
    expect(detectLangFromAcceptLanguage("pl;q=")).toBeNull();
    expect(detectLangFromAcceptLanguage("en;q=-1, pl;q=0.2")).toBe("pl");
  });

  it("is case- and whitespace-insensitive and ignores empty entries and extra params", () => {
    expect(detectLangFromAcceptLanguage("PL-pl")).toBe("pl");
    // Porównujemy cały podstawowy podtag, nie prefiks: `plt` (malgaski) to nie polski.
    expect(detectLangFromAcceptLanguage("plt-MG, pl;q=0.5")).toBe("en");
    expect(detectLangFromAcceptLanguage("EN-us, pl;q=0.1")).toBe("en");
    expect(detectLangFromAcceptLanguage("  de-DE ; q=0.2 ,  pl-PL ;  q=0.8 ")).toBe("pl");
    expect(detectLangFromAcceptLanguage(",, ,pl")).toBe("pl");
    expect(detectLangFromAcceptLanguage(", ,")).toBeNull();
    expect(detectLangFromAcceptLanguage("pl;level=1;q=0.5, en;q=0.4")).toBe("pl");
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
    expect(resolveHomepageLang("/", "theme=dark", "*")).toEqual({
      lang: null,
      location: null,
      persistCookie: false,
    });
  });

  it("treats a corrupted cookie as absent instead of throwing", () => {
    // Bez tego URIError z decodeURIComponent szedł prosto do errorMiddleware (500).
    expect(resolveHomepageLang("/", "nes_lang=%E0%A4%A", "de")).toEqual({
      lang: "en",
      location: "/en",
      persistCookie: true,
    });
    expect(resolveHomepageLang("/", "nes_lang=%; lovable_lang=en", "pl")).toEqual({
      lang: "en",
      location: "/en",
      persistCookie: false,
    });
  });

  it("honours a valid duplicate behind a corrupted cookie instead of overriding the choice", () => {
    // Zepsuty egzemplarz z Domain= rodzica stoi pierwszy; świadomy wybór EN
    // (host-only) nie może przegrać z Accept-Language i zostać nadpisany na PL.
    expect(resolveHomepageLang("/", "nes_lang=%E0%A4%A; nes_lang=en", "pl")).toEqual({
      lang: "en",
      location: "/en",
      persistCookie: false,
    });
  });
});

describe("langCookieHeaderValue", () => {
  it("marks the cookie Secure over https only", () => {
    expect(langCookieHeaderValue("en", true)).toBe(
      "nes_lang=en; Path=/; Max-Age=31536000; SameSite=Lax; Secure",
    );
    expect(langCookieHeaderValue("en", false)).toBe(
      "nes_lang=en; Path=/; Max-Age=31536000; SameSite=Lax",
    );
  });

  it("never serializes an unvalidated runtime value into Set-Cookie", () => {
    // Typ mówi AppLang, ale wartość może przyjść z niezweryfikowanego źródła -
    // nagłówek dostaje wyłącznie znormalizowany kod albo język domyślny.
    const header = (raw: string) => langCookieHeaderValue(raw as AppLang, false);
    expect(header("EN-gb")).toMatch(/^nes_lang=en; Path=\/;/);
    expect(header("en-x; Domain=evil.example")).toMatch(/^nes_lang=en; Path=\/;/);
    expect(header("de")).toMatch(/^nes_lang=pl; Path=\/;/);
    expect(header("x\r\nSet-Cookie: a=b")).toBe(
      "nes_lang=pl; Path=/; Max-Age=31536000; SameSite=Lax",
    );
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
