// Prolog plików mapy strony i brak instrukcji XSLT.
//
// CO TU JEST DOWODEM:
//   * ŻADEN generator (indeks, plik sekcji, news-sitemapa) nie wstawia już
//     instrukcji `<?xml-stylesheet?>` - Chrome wycofuje XSLT i każdy plik z tą
//     instrukcją otwierał się z ostrzeżeniem o usuwanej funkcji
//     (`lib/seo/sitemapProlog.ts`);
//   * drugi wiersz każdego pliku to komentarz wskazujący mapę HTML, a dokument
//     dalej przechodzi walidację mapy - robotom komentarz jest obojętny;
//   * chwila wygenerowania stoi w trzecim wierszu.
import { describe, expect, it } from "vitest";
import {
  HUMAN_SITEMAP_PATH,
  SITEMAP_GENERATED_MARKER,
  SITEMAP_HUMAN_POINTER,
  sitemapGeneratedComment,
  sitemapProlog,
} from "@/lib/seo/sitemapProlog";
import { checkXmlWellFormed, validateSitemapDocument } from "@/lib/seo/sitemapValidation";
import { buildSitemapIndexXml } from "@/lib/seo/sitemapIndex";
import { buildUrlsetXml, expandSitemapUrls } from "@/lib/seo/sitemapXml";
import { planNewsSitemap, renderNewsSitemapXml } from "@/lib/seo/newsSitemap";

const ORIGIN = "https://neweuropeanstrategies.com";
const NOW = Date.parse("2026-10-10T18:00:00Z");

function newsXml(hoursAgo: number, options = {}): string {
  return renderNewsSitemapXml(
    "NES",
    planNewsSitemap(
      [
        {
          url: `${ORIGIN}/analizy/wpis-${hoursAgo}`,
          title: `Wpis ${hoursAgo}`,
          publishedAt: new Date(NOW - hoursAgo * 3_600_000).toISOString(),
          language: "pl",
        },
      ],
      NOW,
    ),
    options,
  );
}

function allDocuments(options = {}): Array<{ url: string; body: string }> {
  return [
    {
      url: `${ORIGIN}/sitemap.xml`,
      body: buildSitemapIndexXml([{ loc: `${ORIGIN}/sitemaps/core.xml` }], options),
    },
    {
      url: `${ORIGIN}/sitemaps/core.xml`,
      body: buildUrlsetXml(expandSitemapUrls(ORIGIN, [{ loc: `${ORIGIN}/` }], null, []), options),
    },
    // Świeża news-sitemapa i plik z samą kotwicą (okno 48 h puste).
    { url: `${ORIGIN}/news-sitemap.xml`, body: newsXml(2, options) },
    { url: `${ORIGIN}/news-sitemap.xml`, body: newsXml(96, options) },
  ];
}

describe("mapy strony bez XSLT", () => {
  it("żaden generator nie odwołuje się do arkusza XSL", () => {
    for (const { url, body } of [...allDocuments(), ...allDocuments({ generatedAt: NOW })]) {
      expect(body, url).not.toContain("<?xml-stylesheet");
      expect(body, url).not.toContain(".xsl");
    }
  });

  it("drugi wiersz to wskazówka mapy HTML, a dokument przechodzi walidację", () => {
    expect(HUMAN_SITEMAP_PATH).toBe("/sitemap");
    expect(SITEMAP_HUMAN_POINTER).toBe(
      "<!-- Mapa strony dla ludzi / Human-readable site map: /sitemap -->",
    );
    for (const { url, body } of allDocuments()) {
      expect(body.split("\n")[1], url).toBe(SITEMAP_HUMAN_POINTER);
      expect(checkXmlWellFormed(body), url).toEqual({ ok: true });
      const report = validateSitemapDocument({ url, status: 200, body, now: NOW });
      expect(
        report.issues.filter((issue) => issue.severity !== "info"),
        url,
      ).toEqual([]);
    }
  });
});

// CHWILA WYGENEROWANIA. Mapy powstają na żywo, ale `lastmod` to (i musi być)
// data zmiany TREŚCI - przy treści sprzed tygodni plik wyglądał na stary.
// Komentarz w prologu mówi wprost, kiedy plik powstał. Roboty komentarze
// pomijają, więc treść mapy się nie zmienia.
describe("chwila wygenerowania w prologu", () => {
  const STAMP = "<!-- generated: 2026-10-10T18:00:00Z -->";

  it("komentarz niesie czas UTC bez milisekund", () => {
    expect(SITEMAP_GENERATED_MARKER).toBe("generated:");
    expect(sitemapGeneratedComment(NOW + 123)).toBe(STAMP);
  });

  it("bez chwili prolog ma dwa wiersze, z chwilą - trzy", () => {
    expect(sitemapProlog()).toEqual([
      '<?xml version="1.0" encoding="UTF-8"?>',
      SITEMAP_HUMAN_POINTER,
    ]);
    expect(sitemapProlog({ generatedAt: NOW })).toEqual([
      '<?xml version="1.0" encoding="UTF-8"?>',
      SITEMAP_HUMAN_POINTER,
      STAMP,
    ]);
  });

  it("chwila spoza zakresu nie psuje pliku - komentarza po prostu nie ma", () => {
    expect(sitemapProlog({ generatedAt: Number.NaN })).toHaveLength(2);
    expect(sitemapProlog({ generatedAt: Number.POSITIVE_INFINITY })).toHaveLength(2);
  });

  it("każdy generator stawia komentarz w trzecim wierszu i dalej przechodzi walidację", () => {
    for (const { url, body } of allDocuments({ generatedAt: NOW })) {
      expect(body.split("\n")[2], url).toBe(STAMP);
      expect(checkXmlWellFormed(body), url).toEqual({ ok: true });
      const report = validateSitemapDocument({ url, status: 200, body, now: NOW });
      expect(
        report.issues.filter((issue) => issue.severity !== "info"),
        url,
      ).toEqual([]);
    }
  });
});
