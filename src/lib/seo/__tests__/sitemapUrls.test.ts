// Kanonizacja adresów sitemapy + klaster hreflang PL/EN.
import { describe, expect, it } from "vitest";

import { buildRedirectIndex, type RedirectRule } from "@/lib/seo/redirects";
import { canonicalSitemapPath, sitemapLanguageUrls } from "@/lib/seo/sitemapUrls";

const ORIGIN = "https://neweuropeanstrategies.com";

function index(rules: Array<Partial<RedirectRule> & { source_path: string; target_path: string }>) {
  return buildRedirectIndex(
    rules.map((r, i) => ({
      id: `r${i}`,
      status_code: 301,
      ...r,
    })) as RedirectRule[],
  );
}

describe("canonicalSitemapPath", () => {
  it("zwraca ścieżkę bez zmian, gdy nie ma reguł", () => {
    expect(canonicalSitemapPath(null, "/o-nas")).toBe("/o-nas");
    expect(canonicalSitemapPath(index([]), "/o-nas")).toBe("/o-nas");
  });

  it("podmienia adres źródłowy na docelowy", () => {
    const idx = index([{ source_path: "/about-us", target_path: "/o-nas" }]);
    expect(canonicalSitemapPath(idx, "/about-us")).toBe("/o-nas");
  });

  it("domyka łańcuch przekierowań do adresu końcowego", () => {
    const idx = index([
      { source_path: "/a", target_path: "/b" },
      { source_path: "/b", target_path: "/c" },
    ]);
    expect(canonicalSitemapPath(idx, "/a")).toBe("/c");
  });

  it("pomija adresy oznaczone jako 410 Gone", () => {
    const idx = index([{ source_path: "/wp-old", target_path: "/", status_code: 410 }]);
    expect(canonicalSitemapPath(idx, "/wp-old")).toBeNull();
  });

  it("pomija przekierowania na obcy host, akceptuje własny", () => {
    const idx = index([
      { source_path: "/x", target_path: "https://example.com/x" },
      { source_path: "/y", target_path: "https://www.neweuropeanstrategies.com/nowe" },
    ]);
    expect(canonicalSitemapPath(idx, "/x", ["neweuropeanstrategies.com"])).toBeNull();
    expect(canonicalSitemapPath(idx, "/y", ["neweuropeanstrategies.com"])).toBe("/nowe");
  });

  it("obsługuje reguły wildcard", () => {
    const idx = index([{ source_path: "/kategoria/*", target_path: "/category/*" }]);
    expect(canonicalSitemapPath(idx, "/kategoria/geopolityka")).toBe("/category/geopolityka");
  });
});

describe("sitemapLanguageUrls", () => {
  it("tworzy wpis PL i EN z pełnym, wzajemnym klastrem hreflang", () => {
    const urls = sitemapLanguageUrls(ORIGIN, "/o-nas");
    expect(urls.map((u) => u.loc)).toEqual([`${ORIGIN}/o-nas`, `${ORIGIN}/en/o-nas`]);
    for (const u of urls) {
      expect(u.alternates).toEqual([
        { hreflang: "x-default", href: `${ORIGIN}/o-nas` },
        { hreflang: "pl", href: `${ORIGIN}/o-nas` },
        { hreflang: "en", href: `${ORIGIN}/en/o-nas` },
      ]);
    }
  });

  it("hreflang wskazuje adresy po przekierowaniu, nie źródłowe", () => {
    const idx = index([{ source_path: "/about-us", target_path: "/o-nas" }]);
    const urls = sitemapLanguageUrls(ORIGIN, "/about-us", idx);
    expect(urls.map((u) => u.loc)).toEqual([`${ORIGIN}/o-nas`, `${ORIGIN}/en/o-nas`]);
    expect(urls[0].alternates.map((a) => a.href)).not.toContain(`${ORIGIN}/about-us`);
  });

  it("respektuje regułę zdefiniowaną wyłącznie dla wariantu /en", () => {
    const idx = index([{ source_path: "/en/o-nas", target_path: "/en/about" }]);
    const urls = sitemapLanguageUrls(ORIGIN, "/o-nas", idx);
    expect(urls.map((u) => u.loc)).toEqual([`${ORIGIN}/o-nas`, `${ORIGIN}/en/about`]);
  });

  it("pomija dokument wycofany regułą 410", () => {
    const idx = index([{ source_path: "/stare", target_path: "/", status_code: 410 }]);
    expect(sitemapLanguageUrls(ORIGIN, "/stare", idx)).toEqual([]);
  });

  it("nie generuje wariantu EN dla ścieżek nielokalizowanych", () => {
    const urls = sitemapLanguageUrls(ORIGIN, "/people");
    expect(urls).toHaveLength(1);
    expect(urls[0].loc).toBe(`${ORIGIN}/people`);
    expect(urls[0].alternates).toEqual([]);
  });

  it("normalizuje wejście z prefiksem językowym do jednego dokumentu", () => {
    const fromEn = sitemapLanguageUrls(ORIGIN, "/en/blog");
    const fromPl = sitemapLanguageUrls(ORIGIN, "/blog");
    expect(fromEn).toEqual(fromPl);
  });
});
