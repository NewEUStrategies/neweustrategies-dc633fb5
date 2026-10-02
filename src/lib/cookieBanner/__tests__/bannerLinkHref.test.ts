// `bannerLinkHref` - dokąd prowadzi dodatkowy odnośnik banera w danym języku.
//
// DLACZEGO TEN TEST. Do 2026-10-02 odnośnik z panelu szedł do `href` dosłownie:
// gość czytający baner po angielsku klikał „/cookies" i trafiał na polską
// stronę, choć polityka prywatności i zasady przetwarzania obok idą przez
// `localizedPath`. Adres nie był też sprawdzany - `javascript:` z panelu
// trafiał do banera każdego odwiedzającego.
import { describe, expect, it } from "vitest";
import {
  COOKIE_BANNER_DEFAULTS,
  bannerLinkHref,
  resolveBannerCopy,
} from "@/lib/cookieBanner/config";

describe("bannerLinkHref - ścieżka wewnętrzna dostaje język banera", () => {
  it.each([
    ["/cookies", "pl", "/cookies"],
    ["/cookies", "en", "/en/cookies"],
    ["cookies", "en", "/en/cookies"],
    ["  /cookies  ", "en", "/en/cookies"],
    ["/", "en", "/en"],
    ["/", "pl", "/"],
    ["/rodo?wersja=2", "en", "/en/rodo?wersja=2"],
    ["/rodo#prawa", "en", "/en/rodo#prawa"],
    ["/rodo?a=1#b", "en", "/en/rodo?a=1#b"],
  ] as const)("%s (%s) -> %s", (url, lang, expected) => {
    expect(bannerLinkHref(url, lang)).toBe(expected);
  });

  it("ścieżka JUŻ z prefiksem jest sprowadzana do języka banera - wersja PL nie prowadzi na EN", () => {
    expect(bannerLinkHref("/en/cookies", "pl")).toBe("/cookies");
    expect(bannerLinkHref("/en/cookies", "en")).toBe("/en/cookies");
    expect(bannerLinkHref("/EN/cookies#a", "pl")).toBe("/cookies#a");
  });

  it("powierzchnie bez prefiksu języka (`/admin`, `/api`, `/profile`) zostają bez prefiksu", () => {
    expect(bannerLinkHref("/profile/privacy", "en")).toBe("/profile/privacy");
    expect(bannerLinkHref("/api/public/feed", "en")).toBe("/api/public/feed");
    // Zapytanie nie może przeszkodzić w rozpoznaniu takiej powierzchni.
    expect(bannerLinkHref("/admin?x=1", "en")).toBe("/admin?x=1");
  });
});

describe("bannerLinkHref - ścieżka rozwiązana TAK, JAK ZROBI TO PRZEGLĄDARKA", () => {
  it("`..` jest sklejane przed prefiksem - wersja EN nie ucieka na stronę polską", () => {
    // Bez sklejenia `/en/../cookies` przeglądarka czyta jako `/cookies` (PL).
    expect(bannerLinkHref("/en/../cookies", "en")).toBe("/en/cookies");
    expect(bannerLinkHref("../cookies", "en")).toBe("/en/cookies");
    expect(bannerLinkHref("/a/./b/../cookies", "pl")).toBe("/a/cookies");
  });

  it("`\\` przeglądarka czyta jak `/`: `\\cookies` to ścieżka wewnętrzna", () => {
    expect(bannerLinkHref("\\cookies", "en")).toBe("/en/cookies");
  });

  it("`/\\host` wychodzi poza serwis - obie wersje banera prowadzą w TO SAMO miejsce", () => {
    // Wcześniej PL dawało `/\\evil.example` (dla przeglądarki: `//evil.example`,
    // czyli adres zewnętrzny), a EN - `/en/\\evil.example` (ścieżkę wewnętrzną).
    const pl = bannerLinkHref("/\\evil.example", "pl");
    const en = bannerLinkHref("/\\evil.example", "en");
    expect(pl).toBe(en);
    expect(en?.startsWith("/en")).toBe(false);
  });

  it("tabulator w środku `javascript:` nie robi z adresu skryptu - zostaje ścieżką", () => {
    // Przeglądarka usuwa tabulatory z adresu, więc `java\tscript:` wykonałoby się.
    expect(bannerLinkHref("java\tscript:alert(1)", "pl")).toBe("/javascript:alert(1)");
    expect(bannerLinkHref("java\nscript:alert(1)", "en")).toBe("/en/javascript:alert(1)");
  });
});

describe("bannerLinkHref - adresy zewnętrzne i kotwice bez zmian", () => {
  it.each([
    "https://example.org/regulamin",
    "http://example.org",
    "HTTPS://Example.org/A",
    "mailto:iod@example.org",
    "tel:+48123456789",
    "//cdn.example.org/polityka.pdf",
    "#ustawienia",
    "?pokaz=cookies",
  ])("%s", (url) => {
    expect(bannerLinkHref(url, "en")).toBe(url);
    expect(bannerLinkHref(url, "pl")).toBe(url);
  });
});

describe("bannerLinkHref - adres, którego baner nie pokaże", () => {
  it.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "  javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "",
    "   ",
  ])("%j -> null", (url) => {
    expect(bannerLinkHref(url, "pl")).toBeNull();
    expect(bannerLinkHref(url, "en")).toBeNull();
  });

  it("brak adresu (`null`/`undefined` ze starszego zapisu) -> null", () => {
    expect(bannerLinkHref(null, "pl")).toBeNull();
    expect(bannerLinkHref(undefined, "en")).toBeNull();
  });
});

describe("resolveBannerCopy - puste pole treści wraca do brzmienia domyślnego", () => {
  it("pole puste albo z samych spacji -> brzmienie domyślne TEGO języka", () => {
    const copy = { ...COOKIE_BANNER_DEFAULTS.copy.en, acceptAll: "", title: "   " };
    const resolved = resolveBannerCopy(copy, "en");
    expect(resolved.acceptAll).toBe(COOKIE_BANNER_DEFAULTS.copy.en.acceptAll);
    expect(resolved.title).toBe(COOKIE_BANNER_DEFAULTS.copy.en.title);
  });

  it("wartość ustawiona przez administratora wygrywa, a brak całej wersji to same domyślne", () => {
    expect(resolveBannerCopy({ acceptAll: "Zgadzam się" }, "pl").acceptAll).toBe("Zgadzam się");
    expect(resolveBannerCopy(undefined, "pl")).toEqual(COOKIE_BANNER_DEFAULTS.copy.pl);
    expect(resolveBannerCopy(null, "en")).toEqual(COOKIE_BANNER_DEFAULTS.copy.en);
  });
});
