import { describe, expect, it } from "vitest";
import { shardSlice } from "@/lib/seo/sitemapIndex";
import {
  alternateLinks,
  buildUrlsetXml,
  expandSitemapUrls,
  newestLastmod,
  type SitemapEntry,
} from "@/lib/seo/sitemapXml";
import { SUPPORTED_LANGS } from "@/lib/i18n/localePath";

const ORIGIN = "https://nes.example";

function entries(...locs: string[]): SitemapEntry[] {
  return locs.map((loc) => ({ loc: `${ORIGIN}${loc}`, changefreq: "weekly", priority: "0.6" }));
}

describe("expandSitemapUrls", () => {
  it("emits one URL per language with a mutual hreflang cluster", () => {
    const [pl, en] = expandSitemapUrls(ORIGIN, entries("/blog/analiza"), null, []);
    expect(pl.loc).toBe(`${ORIGIN}/blog/analiza`);
    expect(en.loc).toBe(`${ORIGIN}/en/blog/analiza`);
    // Klaster jest ten sam w obu wpisach (self-referencing + x-default).
    expect(pl.alternates).toEqual(en.alternates);
    expect(pl.alternates.map((a) => a.hreflang)).toEqual(["x-default", "pl", "en"]);
  });

  it("is deterministic and sorted, so shard boundaries never move", () => {
    // To jest warunek POPRAWNOŚCI shardowania, nie kosmetyka: zapytania do bazy
    // nie mają ORDER BY, więc bez sortowania granica shardu wędrowałaby między
    // żądaniami i część adresów wypadałaby z mapy.
    const a = expandSitemapUrls(ORIGIN, entries("/c", "/a", "/b"), null, []);
    const b = expandSitemapUrls(ORIGIN, entries("/b", "/c", "/a"), null, []);
    expect(a.map((u) => u.loc)).toEqual(b.map((u) => u.loc));
    expect(a.map((u) => u.loc)).toEqual([...a.map((u) => u.loc)].sort());
  });

  it("splits into shards without gaps or duplicates", () => {
    const urls = expandSitemapUrls(
      ORIGIN,
      entries(...Array.from({ length: 6 }, (_, i) => `/p${i}`)),
      null,
      [],
    );
    expect(urls).toHaveLength(12); // 6 dokumentów × 2 języki
    const shard1 = shardSlice(urls, 1, 5);
    const shard2 = shardSlice(urls, 2, 5);
    const shard3 = shardSlice(urls, 3, 5);
    const all = [...shard1, ...shard2, ...shard3].map((u) => u.loc);
    expect(all).toEqual(urls.map((u) => u.loc));
    expect(new Set(all).size).toBe(all.length);
  });

  it("deduplicates documents that resolve to the same URL", () => {
    const urls = expandSitemapUrls(ORIGIN, entries("/a", "/a"), null, []);
    expect(urls.map((u) => u.loc)).toEqual([`${ORIGIN}/a`, `${ORIGIN}/en/a`]);
  });

  it("carries lastmod, changefreq and priority onto every language variant", () => {
    const urls = expandSitemapUrls(
      ORIGIN,
      [{ loc: `${ORIGIN}/a`, lastmod: "2026-08-01", changefreq: "monthly", priority: "0.7" }],
      null,
      [],
    );
    for (const url of urls) {
      expect(url.lastmod).toBe("2026-08-01");
      expect(url.changefreq).toBe("monthly");
      expect(url.priority).toBe("0.7");
    }
  });
});

describe("newestLastmod", () => {
  it("returns the newest date present", () => {
    expect(
      newestLastmod([
        { loc: "a", alternates: [], lastmod: "2026-01-01" },
        { loc: "b", alternates: [], lastmod: "2026-08-01" },
        { loc: "c", alternates: [] },
      ]),
    ).toBe("2026-08-01");
  });

  it("returns null when nothing carries a date", () => {
    expect(newestLastmod([{ loc: "a", alternates: [] }])).toBeNull();
  });
});

describe("buildUrlsetXml", () => {
  const xml = buildUrlsetXml(expandSitemapUrls(ORIGIN, entries("/a"), null, []));

  it("declares both the sitemap and the xhtml namespace", () => {
    expect(xml).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
    expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
  });

  it("emits loc + hreflang links per url block", () => {
    expect(xml).toContain(`<loc>${ORIGIN}/a</loc>`);
    expect(xml).toContain(`<xhtml:link rel="alternate" hreflang="en" href="${ORIGIN}/en/a"/>`);
    expect(xml.trimEnd().endsWith("</urlset>")).toBe(true);
  });

  it("escapes XML-significant characters in loc", () => {
    const escaped = buildUrlsetXml([{ loc: `${ORIGIN}/a?b=1&c=2`, alternates: [] }]);
    expect(escaped).toContain(`<loc>${ORIGIN}/a?b=1&amp;c=2</loc>`);
  });
});

// Dopisane 22.08 (moduł 8, etap 4): `alternateLinks` stało na ZERZE w pomiarze
// katalogu `src/lib/seo`, bo jedyne jego testy mieszkają w
// `src/routes/-sitemap.xml.test.ts` (trasa RE-EKSPORTUJE ten helper). Pomiar
// per-katalog tego nie widzi, a to funkcja budująca klaster hreflang KAŻDEGO
// adresu w mapie - jej błąd rozspaja graf językowy całego serwisu.
//
// NIE DUBLUJE testu trasy: tam sprawdzane jest, że trasa helper wystawia i że
// escapuje `loc`. Tutaj - zachowanie na wejściach NIEPEŁNYCH, których tamten
// plik nie podaje (adres relatywny, adres z już nałożonym prefiksem języka,
// adres z portem, query i fragmentem).
describe("alternateLinks - wejścia niepełne i już zlokalizowane", () => {
  it("adres ABSOLUTNY daje x-default plus jeden self-adresowalny wariant na język", () => {
    const links = alternateLinks("https://nes.example/blog/analiza");
    expect(links).toHaveLength(SUPPORTED_LANGS.length + 1);
    expect(links[0]).toContain('hreflang="x-default"');
    expect(links[0]).toContain('href="https://nes.example/blog/analiza"');
    expect(links.some((l) => l.includes('hreflang="en"') && l.includes("/en/blog/analiza"))).toBe(
      true,
    );
  });

  it("adres RELATYWNY (bez originu) lokalizuje samą ścieżkę - `new URL` rzuca i wchodzi `catch`", () => {
    // To jest gałąź `catch` w `alternateLinks`: warstwa danych może podać
    // ścieżkę bez originu (tak robi statyczny szkielet mapy). Bez tej obrony
    // cała sitemapa poleciałaby wyjątkiem na pierwszym takim wpisie.
    const links = alternateLinks("/blog/analiza");
    expect(links).toHaveLength(SUPPORTED_LANGS.length + 1);
    expect(links[0]).toContain('href="/blog/analiza"');
    expect(links.some((l) => l.includes('href="/en/blog/analiza"'))).toBe(true);
  });

  it("adres JUŻ z prefiksem języka nie dostaje drugiego prefiksu", () => {
    // Podwójny prefiks (`/en/en/...`) to adres 404 ogłoszony crawlerowi jako
    // wariant językowy - błąd, który kosztuje cały klaster hreflang.
    const links = alternateLinks("https://nes.example/en/blog/analiza");
    expect(links.some((l) => l.includes("/en/en/"))).toBe(false);
    expect(links[0]).toContain('href="https://nes.example/blog/analiza"');
  });

  it.each([
    ["https://nes.example:8443/blog", "https://nes.example:8443"],
    ["http://nes.example/blog", "http://nes.example"],
  ])("origin z %s zachowuje port i schemat", (loc, expectedOrigin) => {
    const links = alternateLinks(loc);
    expect(links.every((l) => l.includes(expectedOrigin))).toBe(true);
  });

  it("query i fragment są ODRZUCANE - w mapie żyje sama ścieżka kanoniczna", () => {
    // `alternateLinks` czyta `u.pathname`, więc parametry wypadają. Przypinamy
    // to jawnie: adres z `?utm_source` ogłoszony jako wariant językowy dałby
    // crawlerowi tyle duplikatów, ile kampanii.
    const links = alternateLinks("https://nes.example/blog/analiza?utm_source=nl#sekcja");
    expect(links.every((l) => !l.includes("utm_source"))).toBe(true);
    expect(links.every((l) => !l.includes("#sekcja"))).toBe(true);
  });

  it("korzeń serwisu (`/`) daje poprawny klaster, nie podwójny slash", () => {
    const links = alternateLinks("https://nes.example/");
    expect(links.every((l) => !l.includes("nes.example//"))).toBe(true);
    expect(links[0]).toContain('href="https://nes.example/"');
  });

  it("znaki wymagające escapowania XML wychodzą jako encje w KAŻDYM wariancie", () => {
    const links = alternateLinks("https://nes.example/a&b");
    expect(links.every((l) => l.includes("&amp;"))).toBe(true);
    expect(links.some((l) => /href="[^"]*&(?!amp;)/.test(l))).toBe(false);
  });
});

// Dopisane 22.08 (moduł 8, etap 4): trzy gałęzie `expandSitemapUrls` i jedna
// `buildUrlsetXml`, których nie dotykał żaden przypadek - wszystkie na wejściach
// NIEPEŁNYCH, jakie realnie podaje warstwa danych.
describe("expandSitemapUrls / buildUrlsetXml - wejścia niepełne", () => {
  it("adres NIE zaczynający się od originu jest brany w całości jako ścieżka", () => {
    // Gałąź `entry.loc.startsWith(origin) ? slice : loc`. Warstwa danych podaje
    // czasem gotowy adres innego originu (import, migracja) - musi wyjść jedna
    // interpretacja, a nie ucięty ogon.
    const [pl] = expandSitemapUrls(ORIGIN, [{ loc: "/analizy/wpis" }], null, []);
    expect(pl.loc).toBe(`${ORIGIN}/analizy/wpis`);
  });

  it("adres RÓWNY originowi daje korzeń `/`, nie pustą ścieżkę", () => {
    // Gałąź `path || "/"`: po odjęciu originu zostaje pusty napis. Pusty `loc`
    // w `<urlset>` to wpis, który crawler odrzuca.
    const [pl] = expandSitemapUrls(ORIGIN, [{ loc: ORIGIN }], null, []);
    expect(pl.loc).toBe(`${ORIGIN}/`);
  });

  it("dwa wpisy o IDENTYCZNYM adresie nie wywracają sortowania", () => {
    // Ostatnie ramię komparatora (`: 0`). Duplikat w danych jest realny
    // (ta sama strona pod dwiema taksonomiami) i nie może zmieniać kolejności
    // między przebiegami - inaczej ten sam stan bazy daje dwa różne pliki
    // i CDN traktuje je jako zmianę.
    const blocks = expandSitemapUrls(
      ORIGIN,
      [{ loc: `${ORIGIN}/a` }, { loc: `${ORIGIN}/a` }],
      null,
      [],
    );
    expect(blocks.map((b) => b.loc)).toEqual([...blocks.map((b) => b.loc)].sort());
  });

  it("blok Z `lastmod` renderuje go dokładnie raz", () => {
    // Drugie ramię tej samej ternary. Fixture `entries()` u góry pliku ustawia
    // tylko `changefreq` i `priority`, więc gałąź z datą stała niepokryta -
    // a to ona mówi crawlerowi, czy w ogóle warto pobrać stronę ponownie.
    const xml = buildUrlsetXml([
      {
        loc: `${ORIGIN}/analizy/wpis`,
        alternates: [],
        lastmod: "2026-02-03",
        changefreq: "weekly",
        priority: "0.8",
      },
    ]);
    expect(xml.match(/<lastmod>/g)).toHaveLength(1);
    expect(xml).toContain("<lastmod>2026-02-03</lastmod>");
    expect(xml).toContain("<changefreq>weekly</changefreq>");
    expect(xml).toContain("<priority>0.8</priority>");
  });

  it("adresy przychodzące w kolejności ODWROTNEJ wychodzą posortowane rosnąco", () => {
    // Ramię `a.loc > b.loc ? 1` komparatora. Sortowanie musi być stabilne
    // i niezależne od kolejności z bazy: ten sam stan treści ma dawać
    // BAJTOWO ten sam plik, inaczej CDN i Search Console widzą zmianę
    // przy każdym przebiegu.
    const blocks = expandSitemapUrls(
      ORIGIN,
      [{ loc: `${ORIGIN}/z-ostatni` }, { loc: `${ORIGIN}/a-pierwszy` }],
      null,
      [],
    );
    const locs = blocks.map((b) => b.loc);
    expect(locs).toEqual([...locs].sort());
    expect(locs[0]).toContain("/a-pierwszy");
  });

  it("blok BEZ `lastmod`, `changefreq` i `priority` renderuje sam `<loc>` i klaster", () => {
    // Trzy gałęzie `x ? ... : null` naraz. Warstwa danych nie zna daty zmiany
    // dla stron statycznych szkieletu, a pusty `<lastmod></lastmod>` jest
    // błędem schematu - element musi po prostu NIE WYSTĄPIĆ.
    const xml = buildUrlsetXml([
      { loc: `${ORIGIN}/o-nas`, alternates: [{ hreflang: "pl", href: `${ORIGIN}/o-nas` }] },
    ]);
    expect(xml).toContain(`<loc>${ORIGIN}/o-nas</loc>`);
    expect(xml).not.toContain("<lastmod>");
    expect(xml).not.toContain("<changefreq>");
    expect(xml).not.toContain("<priority>");
    expect(xml.trimEnd().endsWith("</urlset>")).toBe(true);
  });
});
