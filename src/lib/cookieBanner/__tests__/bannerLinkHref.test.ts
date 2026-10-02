// `bannerLinkHref` - dokąd prowadzi dodatkowy odnośnik banera w danym języku.
//
// DLACZEGO TEN TEST. Do 2026-10-02 odnośnik z panelu szedł do `href` dosłownie:
// gość czytający baner po angielsku klikał „/cookies" i trafiał na polską
// stronę, choć polityka prywatności i zasady przetwarzania obok idą przez
// `localizedPath`. Adres nie był też sprawdzany - `javascript:` z panelu
// trafiał do banera każdego odwiedzającego.
import { describe, expect, it } from "vitest";
import { bannerLinkHref } from "@/lib/cookieBanner/config";

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
