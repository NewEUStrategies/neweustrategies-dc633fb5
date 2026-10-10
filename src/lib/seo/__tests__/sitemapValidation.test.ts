// Walidator plików mapy strony - reguły Search Console liczone u nas.
//
// DWA RODZAJE DOWODU:
//   1. Walidator ROZPOZNAJE błędy, które realnie zgłosił Search Console - na
//      czele z pustym `<urlset>` z `news-sitemap.xml` („Brak tagu XML: url,
//      tag nadrzędny: urlset, wiersz 3"), z tym samym numerem wiersza.
//   2. KONTRAKT GENERATOR ↔ WALIDATOR: wyjście każdego naszego generatora
//      (`buildUrlsetXml`, `buildSitemapIndexXml`, `renderNewsSitemapXml`)
//      przechodzi walidację bez jednego błędu. Gdyby generator zaczął znowu
//      emitować pusty albo niepoprawny dokument, ten plik padnie przed
//      wdrożeniem, a nie tydzień później w raporcie GSC.
import { describe, expect, it } from "vitest";
import {
  isW3cDatetime,
  sitemapChildPath,
  validateSitemapDocument,
  worstSitemapState,
  type SitemapProbeInput,
} from "@/lib/seo/sitemapValidation";
import { buildUrlsetXml, expandSitemapUrls } from "@/lib/seo/sitemapXml";
import { buildSitemapIndexXml } from "@/lib/seo/sitemapIndex";
import {
  buildNewsSitemapXml,
  planNewsSitemap,
  renderNewsSitemapXml,
  type NewsSitemapEntry,
} from "@/lib/seo/newsSitemap";

const ORIGIN = "https://neweuropeanstrategies.com";
const NOW = Date.parse("2026-10-10T18:00:00Z");

function validate(body: string, over: Partial<SitemapProbeInput> = {}) {
  return validateSitemapDocument({
    url: `${ORIGIN}/sitemaps/core.xml`,
    status: 200,
    body,
    contentType: "application/xml; charset=utf-8",
    now: NOW,
    ...over,
  });
}

const URLSET_OPEN = `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;

describe("validateSitemapDocument - błędy zgłoszone przez Search Console", () => {
  it("pusty <urlset> news-sitemapy: brak tagu url w urlset, wiersz 3 (jak w GSC)", () => {
    // Bajt w bajt dokument, który produkcja oddawała 2026-10-10.
    const body = [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">`,
      `</urlset>`,
    ].join("\n");
    const report = validate(body, { url: `${ORIGIN}/news-sitemap.xml` });
    expect(report.state).toBe("fail");
    expect(report.kind).toBe("news");
    expect(report.entries).toBe(0);
    expect(report.issues).toEqual([
      expect.objectContaining({
        code: "missingTag",
        severity: "error",
        tag: "url",
        parent: "urlset",
        line: 3,
      }),
    ]);
  });

  it("brak odpowiedzi (status 0) i 5xx to błąd pobrania - „Ogólny błąd HTTP”", () => {
    for (const status of [0, 500, 503]) {
      const report = validate("", { status });
      expect(report.state).toBe("fail");
      expect(report.issues[0]).toEqual(
        expect.objectContaining({ code: "http", value: String(status) }),
      );
    }
  });

  it("pusty indeks: brak tagu sitemap w sitemapindex", () => {
    const report = validate(
      `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</sitemapindex>`,
      { url: `${ORIGIN}/sitemap.xml` },
    );
    expect(report.kind).toBe("index");
    expect(report.issues[0]).toEqual(
      expect.objectContaining({ code: "missingTag", tag: "sitemap", parent: "sitemapindex" }),
    );
  });
});

describe("validateSitemapDocument - schemat sitemaps.org", () => {
  it("poprawny <urlset> przechodzi bez zastrzeżeń i liczy adresy oraz najnowszy lastmod", () => {
    const report = validate(
      [
        URLSET_OPEN,
        `<url><loc>${ORIGIN}/</loc><lastmod>2026-10-01</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>`,
        `<url><loc>${ORIGIN}/blog</loc><lastmod>2026-10-07T08:00:00+02:00</lastmod></url>`,
        `</urlset>`,
      ].join("\n"),
    );
    expect(report).toEqual(
      expect.objectContaining({ state: "ok", kind: "urlset", entries: 2, issues: [] }),
    );
    expect(report.newestLastmod).toBe("2026-10-07T08:00:00+02:00");
  });

  it("<url> bez <loc> - brak tagu loc w url, z wierszem i licznikiem wystąpień", () => {
    const report = validate([URLSET_OPEN, "<url></url>", "<url></url>", "</urlset>"].join("\n"));
    expect(report.issues).toEqual([
      expect.objectContaining({ code: "missingTag", tag: "loc", parent: "url", line: 2, count: 2 }),
    ]);
  });

  it("korzeń bez przestrzeni nazw sitemaps.org to błąd", () => {
    const report = validate(`<urlset><url><loc>${ORIGIN}/</loc></url></urlset>`);
    expect(report.issues.map((issue) => issue.code)).toEqual(["namespace"]);
  });

  it("dokument HTML zamiast mapy: zły korzeń", () => {
    const report = validate("<html><body>Not found</body></html>", {
      contentType: "text/html; charset=utf-8",
    });
    expect(report.state).toBe("fail");
    expect(report.issues.map((issue) => issue.code)).toEqual(["root", "contentType"]);
  });

  it("adres względny, obcy host i duplikat", () => {
    const report = validate(
      [
        URLSET_OPEN,
        `<url><loc>/blog</loc></url>`,
        `<url><loc>https://example.org/x</loc></url>`,
        `<url><loc>${ORIGIN}/a</loc></url>`,
        `<url><loc>${ORIGIN}/a</loc></url>`,
        `</urlset>`,
      ].join("\n"),
    );
    expect(report.issues.map((issue) => issue.code).sort()).toEqual([
      "duplicateLoc",
      "foreignHost",
      "invalidLoc",
    ]);
    expect(report.state).toBe("fail");
  });

  it("zła data, data z przyszłości, zły changefreq i priority", () => {
    const report = validate(
      [
        URLSET_OPEN,
        `<url><loc>${ORIGIN}/a</loc><lastmod>10.10.2026</lastmod></url>`,
        `<url><loc>${ORIGIN}/b</loc><lastmod>2027-01-01</lastmod></url>`,
        `<url><loc>${ORIGIN}/c</loc><changefreq>sometimes</changefreq><priority>1.5</priority></url>`,
        `</urlset>`,
      ].join("\n"),
    );
    const codes = Object.fromEntries(report.issues.map((issue) => [issue.code, issue.severity]));
    expect(codes).toEqual({
      invalidDate: "error",
      futureDate: "warning",
      invalidChangefreq: "warning",
      invalidPriority: "warning",
    });
  });

  it("hreflang przez xhtml:link wymaga deklaracji prefiksu", () => {
    const body = [
      URLSET_OPEN,
      `<url><loc>${ORIGIN}/</loc><xhtml:link rel="alternate" hreflang="en" href="${ORIGIN}/en"/></url>`,
      `</urlset>`,
    ].join("\n");
    expect(validate(body).issues.map((issue) => issue.code)).toEqual(["undeclaredPrefix"]);
  });

  it("limit 50 000 adresów", () => {
    const urls = Array.from({ length: 50_001 }, (_, i) => `<url><loc>${ORIGIN}/p/${i}</loc></url>`);
    const report = validate([URLSET_OPEN, ...urls, "</urlset>"].join("\n"));
    expect(report.entries).toBe(50_001);
    expect(report.issues.map((issue) => issue.code)).toContain("tooManyEntries");
  });
});

describe("validateSitemapDocument - poprawność XML", () => {
  it.each([
    [`${URLSET_OPEN}<url><loc>${ORIGIN}/</loc></url>`, 1, "is never closed"],
    [`${URLSET_OPEN}\n<url><loc>${ORIGIN}/</url></loc></urlset>`, 2, "closes <loc>"],
    [`${URLSET_OPEN}<url><loc>${ORIGIN}/?a=1&b=2</loc></url></urlset>`, 1, "unescaped &"],
    [`${URLSET_OPEN}</urlset><urlset></urlset>`, 1, "second root"],
    [`tekst <urlset></urlset>`, 1, "text outside"],
  ])("odrzuca %j (wiersz %i)", (body, line, message) => {
    const report = validate(body);
    expect(report.state).toBe("fail");
    expect(report.issues[0]).toEqual(expect.objectContaining({ code: "malformed", line }));
    expect(report.issues[0]?.value).toContain(message);
  });

  it("dekoduje encje w adresie przed oceną", () => {
    const report = validate(
      `${URLSET_OPEN}<url><loc>${ORIGIN}/szukaj?q=a&amp;page=2</loc></url></urlset>`,
    );
    expect(report.state).toBe("ok");
  });

  it("toleruje BOM, komentarze i CDATA", () => {
    const report = validate(
      `\uFEFF<?xml version="1.0"?>\n<!-- generator -->\n${URLSET_OPEN}<url><loc><![CDATA[${ORIGIN}/]]></loc></url></urlset>`,
    );
    expect(report.state).toBe("ok");
  });

  it("pusta odpowiedź 200 to błąd, nie pusta mapa", () => {
    expect(validate("   ").issues.map((issue) => issue.code)).toEqual(["emptyBody"]);
  });
});

describe("validateSitemapDocument - Google News", () => {
  const newsDoc = (inner: string) =>
    [
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">`,
      inner,
      `</urlset>`,
    ].join("\n");
  const block = (publication: string, date = "2026-10-10T08:00:00Z", title = "Tytuł") =>
    `<url><loc>${ORIGIN}/a</loc><news:news><news:publication>${publication}</news:publication><news:publication_date>${date}</news:publication_date><news:title>${title}</news:title></news:news></url>`;

  it("kompletny wpis przechodzi i liczy artykuły", () => {
    const report = validate(
      newsDoc(block("<news:name>NES</news:name><news:language>pl</news:language>")),
    );
    expect(report).toEqual(expect.objectContaining({ kind: "news", state: "ok", newsEntries: 1 }));
  });

  it("brak news:language i zły kod języka", () => {
    const missing = validate(newsDoc(block("<news:name>NES</news:name>")));
    expect(missing.issues[0]).toEqual(
      expect.objectContaining({
        code: "missingTag",
        tag: "news:language",
        parent: "news:publication",
      }),
    );
    const wrong = validate(
      newsDoc(block("<news:name>NES</news:name><news:language>polski</news:language>")),
    );
    expect(wrong.issues.map((issue) => issue.code)).toEqual(["newsLanguage"]);
  });

  it("<url> bez news:news w mapie News jest poprawny - kotwica (informacja)", () => {
    // Google: artykuł starszy niż dwa dni - usuń adres ALBO zdejmij mu
    // `<news:news>`. Adres bez metadanych nie jest błędem.
    const report = validate(newsDoc(`<url><loc>${ORIGIN}/a</loc></url>`));
    expect(report.state).toBe("ok");
    expect(report.issues).toEqual([
      expect.objectContaining({ code: "newsAnchor", severity: "info" }),
    ]);
  });

  it("metadane News przy artykule starszym niż 48 h to ostrzeżenie", () => {
    const report = validate(
      newsDoc(
        block(
          "<news:name>NES</news:name><news:language>pl</news:language>",
          "2026-10-07T08:00:00Z",
        ),
      ),
    );
    expect(report.state).toBe("warn");
    expect(report.issues).toEqual([
      expect.objectContaining({ code: "newsStale", severity: "warning" }),
    ]);
  });
});

describe("kontrakt generator ↔ walidator: nasze pliki przechodzą bez błędu", () => {
  it("shard sekcji z klastrem hreflang (buildUrlsetXml)", () => {
    const blocks = expandSitemapUrls(
      ORIGIN,
      [
        { loc: `${ORIGIN}/`, changefreq: "daily", priority: "1.0" },
        { loc: `${ORIGIN}/analizy/wpis?x=1&y=2`, lastmod: "2026-10-07", changefreq: "monthly" },
      ],
      null,
      ["neweuropeanstrategies.com"],
    );
    const report = validate(buildUrlsetXml(blocks));
    expect(report.issues).toEqual([]);
    expect(report.entries).toBe(blocks.length);
  });

  it("indeks (buildSitemapIndexXml) z lastmod dziennym i pełnym", () => {
    const report = validate(
      buildSitemapIndexXml([
        { loc: `${ORIGIN}/sitemaps/core.xml` },
        { loc: `${ORIGIN}/sitemaps/posts.xml`, lastmod: "2026-10-07" },
        { loc: `${ORIGIN}/news-sitemap.xml`, lastmod: "2026-10-07T08:00:00Z" },
      ]),
      { url: `${ORIGIN}/sitemap.xml` },
    );
    expect(report.issues).toEqual([]);
    expect(report.children).toEqual([
      `${ORIGIN}/sitemaps/core.xml`,
      `${ORIGIN}/sitemaps/posts.xml`,
      `${ORIGIN}/news-sitemap.xml`,
    ]);
  });

  const article = (hoursAgo: number, language: string): NewsSitemapEntry => ({
    url: `${ORIGIN}${language === "en" ? "/en" : ""}/analizy/wpis-${hoursAgo}`,
    title: `Wpis <${hoursAgo}h> & "cytat"`,
    publishedAt: new Date(NOW - hoursAgo * 3_600_000).toISOString(),
    language,
  });

  it("news-sitemap ze świeżymi wpisami", () => {
    const xml = buildNewsSitemapXml({
      publicationName: "New European Strategies",
      entries: [article(2, "pl"), article(2, "en"), article(30, "pl")],
      now: NOW,
    });
    expect(xml).not.toBeNull();
    const report = validate(xml ?? "", { url: `${ORIGIN}/news-sitemap.xml` });
    expect(report.issues).toEqual([]);
    expect(report.newsEntries).toBe(3);
  });

  it("news-sitemap w dzień bez publikacji niesie kotwicę bez metadanych i NIE jest pustym urlset", () => {
    const plan = planNewsSitemap([article(72, "pl"), article(72, "en"), article(120, "pl")], NOW);
    expect(plan.mode).toBe("anchor");
    const report = validate(renderNewsSitemapXml("NES", plan), {
      url: `${ORIGIN}/news-sitemap.xml`,
    });
    expect(report.state).toBe("ok");
    expect(report.issues.map((issue) => issue.code)).toEqual(["newsAnchor"]);
    expect(report.entries).toBe(2);
    expect(report.newsEntries).toBe(0);
  });
});

describe("pomocnicze", () => {
  it.each([
    ["2026", true],
    ["2026-10", true],
    ["2026-10-10", true],
    ["2026-10-10T08:00Z", true],
    ["2026-10-10T08:00:00.123+02:00", true],
    ["2026-10-10T08:00:00", false],
    ["2026-02-30", false],
    ["2026-13-01", false],
    ["10.10.2026", false],
  ])("isW3cDatetime(%j) = %s", (value, expected) => {
    expect(isW3cDatetime(value)).toBe(expected);
  });

  it("ścieżka pliku z indeksu i najgorszy stan zbioru", () => {
    expect(sitemapChildPath(`${ORIGIN}/sitemaps/core.xml`)).toBe("/sitemaps/core.xml");
    expect(sitemapChildPath("/news-sitemap.xml")).toBe("/news-sitemap.xml");
    expect(sitemapChildPath("nie-adres")).toBeNull();
    const ok = validate(`${URLSET_OPEN}<url><loc>${ORIGIN}/</loc></url></urlset>`);
    const bad = validate(`${URLSET_OPEN}</urlset>`);
    expect(worstSitemapState([ok])).toBe("ok");
    expect(worstSitemapState([ok, bad])).toBe("fail");
  });
});
