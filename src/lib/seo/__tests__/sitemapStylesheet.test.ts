// Arkusz wyglądu map strony (XSL) i jego podpięcie do generatorów.
//
// CO TU JEST DOWODEM:
//   * arkusz jest poprawnym XML-em - przeglądarka, która dostanie zepsuty
//     arkusz, nie pokaże NIC (ani tabeli, ani surowego drzewa), tylko błąd;
//   * arkusz zna wszystkie trzy rodzaje plików (indeks, adresy, Google News)
//     i ich przestrzenie nazw;
//   * skrypt filtra nie zawiera `<` ani `&` (przechodzi przez serializację
//     XSLT bez zmian);
//   * KAŻDY generator wstawia instrukcję `<?xml-stylesheet?>` w drugim wierszu,
//     a dokument dalej przechodzi walidację mapy - robotom instrukcja jest
//     obojętna.
// Renderowanie w prawdziwej przeglądarce dowodzi e2e (`e2e/seo.spec.ts`).
import { describe, expect, it } from "vitest";
import { SITEMAP_STYLESHEET_PATH, SITEMAP_STYLESHEET_PI } from "@/lib/seo/sitemapStylesheet";
import {
  SITEMAP_STYLESHEET_CONTENT_TYPE,
  buildSitemapStylesheet,
} from "@/lib/seo/sitemapStylesheetXsl";
import { checkXmlWellFormed, validateSitemapDocument } from "@/lib/seo/sitemapValidation";
import { buildSitemapIndexXml } from "@/lib/seo/sitemapIndex";
import { buildUrlsetXml, expandSitemapUrls } from "@/lib/seo/sitemapXml";
import { planNewsSitemap, renderNewsSitemapXml } from "@/lib/seo/newsSitemap";

const ORIGIN = "https://neweuropeanstrategies.com";
const NOW = Date.parse("2026-10-10T18:00:00Z");

describe("arkusz XSL", () => {
  const xsl = buildSitemapStylesheet();

  it("jest poprawnym XML-em (inaczej przeglądarka pokaże wyłącznie błąd)", () => {
    expect(checkXmlWellFormed(xsl)).toEqual({ ok: true });
  });

  it("jest arkuszem XSLT 1.0 z wyjściem HTML i przestrzeniami nazw map", () => {
    expect(xsl).toContain('<xsl:stylesheet version="1.0"');
    expect(xsl).toContain('xmlns:s="http://www.sitemaps.org/schemas/sitemap/0.9"');
    expect(xsl).toContain('xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"');
    expect(xsl).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
    expect(xsl).toContain('<xsl:output method="html"');
  });

  it("obsługuje indeks, mapę adresów i mapę Google News", () => {
    for (const name of ["indexTable", "urlTable", "newsTable"]) {
      expect(xsl).toContain(`<xsl:template name="${name}">`);
    }
    expect(xsl).toContain("/s:sitemapindex/s:sitemap");
    expect(xsl).toContain("/s:urlset/s:url");
    expect(xsl).toContain("news:news/news:title");
    expect(xsl).toContain("xhtml:link[@hreflang");
  });

  it("adresy są linkami, a pliki sekcji prowadzą z powrotem do indeksu", () => {
    expect(xsl).toContain('<a href="{$loc}"');
    expect(xsl).toContain('<a href="/sitemap.xml">');
  });

  it("skrypt filtra nie zawiera znaków, które zepsułyby serializację XSLT", () => {
    const script = /<script>([\s\S]*?)<\/script>/.exec(xsl)?.[1] ?? "";
    expect(script.length).toBeGreaterThan(0);
    expect(script).not.toMatch(/[<&]/);
  });

  it("nie ładuje żadnego zasobu z zewnątrz (CDN, fonty, skrypty)", () => {
    expect(xsl).not.toMatch(/<link\b|<script\s+src|@import|url\(/i);
  });

  it("typ treści jest XML-owy - Chrome z `nosniff` odrzuca arkusz o innym typie", () => {
    expect(SITEMAP_STYLESHEET_CONTENT_TYPE).toBe("text/xsl; charset=utf-8");
  });
});

describe("instrukcja <?xml-stylesheet?> w każdym generatorze", () => {
  const secondLine = (xml: string) => xml.split("\n")[1];

  it("wskazuje arkusz względnym adresem (działa na każdej domenie tenanta)", () => {
    expect(SITEMAP_STYLESHEET_PATH).toBe("/sitemap.xsl");
    expect(SITEMAP_STYLESHEET_PI).toBe('<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>');
  });

  it("indeks: drugi wiersz to instrukcja, dokument przechodzi walidację", () => {
    const xml = buildSitemapIndexXml([{ loc: `${ORIGIN}/sitemaps/core.xml` }]);
    expect(secondLine(xml)).toBe(SITEMAP_STYLESHEET_PI);
    expect(
      validateSitemapDocument({ url: `${ORIGIN}/sitemap.xml`, status: 200, body: xml }).issues,
    ).toEqual([]);
  });

  it("plik sekcji: drugi wiersz to instrukcja, dokument przechodzi walidację", () => {
    const xml = buildUrlsetXml(expandSitemapUrls(ORIGIN, [{ loc: `${ORIGIN}/` }], null, []));
    expect(secondLine(xml)).toBe(SITEMAP_STYLESHEET_PI);
    expect(
      validateSitemapDocument({ url: `${ORIGIN}/sitemaps/core.xml`, status: 200, body: xml })
        .issues,
    ).toEqual([]);
  });

  it("news-sitemap (świeża i kotwica): drugi wiersz to instrukcja, dokument przechodzi walidację", () => {
    const entry = (hoursAgo: number) => ({
      url: `${ORIGIN}/analizy/wpis-${hoursAgo}`,
      title: `Wpis ${hoursAgo}`,
      publishedAt: new Date(NOW - hoursAgo * 3_600_000).toISOString(),
      language: "pl",
    });
    for (const hoursAgo of [2, 96]) {
      const xml = renderNewsSitemapXml("NES", planNewsSitemap([entry(hoursAgo)], NOW));
      expect(secondLine(xml)).toBe(SITEMAP_STYLESHEET_PI);
      const report = validateSitemapDocument({
        url: `${ORIGIN}/news-sitemap.xml`,
        status: 200,
        body: xml,
        now: NOW,
      });
      expect(report.issues.filter((issue) => issue.severity !== "info")).toEqual([]);
    }
  });
});
