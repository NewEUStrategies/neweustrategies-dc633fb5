import { describe, expect, it } from "vitest";
import {
  SITEMAP_SECTIONS,
  SITEMAP_URLS_PER_SHARD,
  buildSitemapIndexXml,
  isSitemapSection,
  parseSitemapShard,
  shardCountFor,
  shardSlice,
  sitemapShardFile,
  sitemapShardPath,
} from "@/lib/seo/sitemapIndex";

describe("sitemap shard naming", () => {
  it("keeps the first shard unnumbered and numbers the rest from 2", () => {
    expect(sitemapShardFile("posts", 1)).toBe("posts.xml");
    expect(sitemapShardFile("posts", 2)).toBe("posts-2.xml");
    expect(sitemapShardPath("tracker", 1)).toBe("/sitemaps/tracker.xml");
    expect(sitemapShardPath("tracker", 3)).toBe("/sitemaps/tracker-3.xml");
  });

  it("round-trips every section through parse", () => {
    for (const section of SITEMAP_SECTIONS) {
      expect(parseSitemapShard(sitemapShardFile(section, 1))).toEqual({ section, shard: 1 });
      expect(parseSitemapShard(sitemapShardFile(section, 7))).toEqual({ section, shard: 7 });
    }
  });

  it("rejects unknown sections, missing extension and a redundant -1 suffix", () => {
    expect(parseSitemapShard("wpisy.xml")).toBeNull();
    expect(parseSitemapShard("posts")).toBeNull();
    expect(parseSitemapShard("posts.txt")).toBeNull();
    // Shard pierwszy mieszka pod "posts.xml" - drugi adres tej samej treści
    // byłby duplikatem w indeksie i w raporcie GSC.
    expect(parseSitemapShard("posts-1.xml")).toBeNull();
    expect(parseSitemapShard("posts-0.xml")).toBeNull();
    expect(parseSitemapShard("posts-x.xml")).toBeNull();
  });

  it("recognises exactly the declared sections", () => {
    expect(isSitemapSection("core")).toBe(true);
    expect(isSitemapSection("nope")).toBe(false);
  });
});

describe("sitemap sharding math", () => {
  it("stays under the 50 000 URL protocol limit per file", () => {
    expect(SITEMAP_URLS_PER_SHARD).toBeLessThanOrEqual(50_000);
  });

  it("counts shards from the URL count", () => {
    expect(shardCountFor(0)).toBe(0);
    expect(shardCountFor(1)).toBe(1);
    expect(shardCountFor(SITEMAP_URLS_PER_SHARD)).toBe(1);
    expect(shardCountFor(SITEMAP_URLS_PER_SHARD + 1)).toBe(2);
    expect(shardCountFor(SITEMAP_URLS_PER_SHARD * 3)).toBe(3);
  });

  it("slices shards without gaps or overlaps", () => {
    const urls = Array.from({ length: 25 }, (_, i) => i);
    const a = shardSlice(urls, 1, 10);
    const b = shardSlice(urls, 2, 10);
    const c = shardSlice(urls, 3, 10);
    expect(a).toHaveLength(10);
    expect(b).toHaveLength(10);
    expect(c).toHaveLength(5);
    expect([...a, ...b, ...c]).toEqual(urls);
    // Shard poza zakresem jest pusty - trasa odpowiada wtedy 404.
    expect(shardSlice(urls, 4, 10)).toEqual([]);
  });
});

describe("buildSitemapIndexXml", () => {
  it("emits a valid sitemapindex with optional lastmod", () => {
    const xml = buildSitemapIndexXml([
      { loc: "https://nes.example/sitemaps/core.xml" },
      { loc: "https://nes.example/sitemaps/posts.xml", lastmod: "2026-08-01" },
    ]);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain("<loc>https://nes.example/sitemaps/core.xml</loc>");
    expect(xml).toContain("<lastmod>2026-08-01</lastmod>");
    // Wpis bez daty nie dostaje pustego <lastmod> (walidatory to odrzucają).
    expect(xml).not.toContain("<lastmod></lastmod>");
    expect(xml.trimEnd().endsWith("</sitemapindex>")).toBe(true);
  });

  it("escapes XML-significant characters in loc", () => {
    const xml = buildSitemapIndexXml([{ loc: "https://nes.example/a?b=1&c=2" }]);
    expect(xml).toContain("<loc>https://nes.example/a?b=1&amp;c=2</loc>");
  });
});

// ---------------------------------------------------------------------------
// ETAP 4: gałąź parsera segmentu adresu shardu (sitemapIndex.ts:86 - wejście, na
// którym regexp nazwy w ogóle NIE łapie). Trasa `/sitemaps/<segment>.xml`
// przyjmuje dowolny łańcuch od crawlera, więc każdy taki segment musi dać
// czyste `null` (trasa odpowiada 404), a nie wyjątek albo pusty <urlset>.
// NIE DUBLUJE `e2e/seo.spec.ts` - tam "an unknown sitemap shard is a 404, not an
// empty urlset" i "every sitemap listed in the index resolves to a urlset"
// dowodzą KODU ODPOWIEDZI na żywym SSR; tutaj dowodzimy czystego parsera.
// ---------------------------------------------------------------------------
describe("parseSitemapShard - segmenty niepełne i wrogie", () => {
  it.each([
    { raw: ".xml", why: "sam sufiks bez nazwy sekcji (regexp nazwy nie łapie)" },
    { raw: "", why: "pusty segment" },
    { raw: ".XML", why: "sufiks innej wielkości liter (porównanie jest dokładne)" },
    { raw: "-2.xml", why: "numer shardu bez sekcji" },
    { raw: "posts.xml.xml", why: "podwojony sufiks" },
    { raw: "posts-2-3.xml", why: "dwa numery shardu" },
    { raw: "posts-2.5.xml", why: "numer niecałkowity" },
    { raw: "posts-.xml", why: "separator bez numeru" },
    { raw: "Posts.xml", why: "sekcja innej wielkości liter" },
    { raw: "../posts.xml", why: "próba wyjścia z katalogu" },
  ])("zwraca null dla '$raw' ($why)", ({ raw }) => {
    expect(parseSitemapShard(raw)).toBeNull();
  });

  it("numer shardu bez górnego ograniczenia nadal się parsuje", () => {
    // Górny limit pilnuje trasa (liczbą realnych adresów), nie parser - inaczej
    // wzrost serwisu wymagałby zmiany w DWÓCH miejscach.
    expect(parseSitemapShard("posts-99999.xml")).toEqual({ section: "posts", shard: 99999 });
  });

  // FAKT ZMIERZONY (stan produkcji): numer z zerem wiodącym przechodzi, bo
  // `Number("02") === 2`. Ten test jest ZIELONY i przypina stan faktyczny -
  // gdy produkcja zostanie naprawiona, wywali się on i `it.fails` poniżej
  // przestanie być potrzebny.
  it("numer z zerem wiodącym parsuje się jak numer kanoniczny", () => {
    expect(parseSitemapShard("posts-02.xml")).toEqual({ section: "posts", shard: 2 });
    expect(parseSitemapShard("posts-0002.xml")).toEqual({ section: "posts", shard: 2 });
  });

  it.fails("DEFEKT: shard 2 jest dostępny pod dwoma adresami (posts-2.xml i posts-02.xml)", () => {
    // KONSEKWENCJA DLA UŻYTKOWNIKA: dokumentacja `parseSitemapShard` mówi
    // wprost, że odrzuca "numer <= 1 podanego jawnie (...), żeby jeden shard
    // nie był dostępny pod dwoma URL-ami". Zero wiodące łamie ten sam
    // inwariant: `/sitemaps/posts-02.xml` zwraca BAJT W BAJT tę samą mapę co
    // adres kanoniczny `/sitemaps/posts-2.xml`. Crawler, który trafi na
    // wariant z zerem (błędny link, stara mapa, skan katalogu), zaindeksuje
    // drugi adres tej samej mapy, a raport "Sitemapy" w GSC pokaże duplikat
    // zamiast pokrycia sekcji. Poprawka: odrzucić `shardRaw`, którego zapis
    // nie jest kanoniczny (`String(Number(shardRaw)) !== shardRaw`).
    expect(parseSitemapShard("posts-02.xml")).toBeNull();
  });
});

describe("shardCountFor / shardSlice - wartości spoza zakresu", () => {
  it.each([
    { label: "zero adresów", urlCount: 0, expected: 0 },
    { label: "liczba ujemna", urlCount: -5, expected: 0 },
    { label: "NaN", urlCount: Number.NaN, expected: 0 },
    { label: "Infinity", urlCount: Number.POSITIVE_INFINITY, expected: 0 },
  ])("shardCountFor zwraca 0 dla $label (trasa odpowiada wtedy 404)", ({ urlCount, expected }) => {
    expect(shardCountFor(urlCount)).toBe(expected);
  });

  it("rozmiar shardu <= 0 nie dzieli przez zero ani nie gubi adresów", () => {
    // `perShard` z konfiguracji nigdy nie powinno być zerem, ale dzielenie przez
    // zero dałoby Infinity shardów, a `slice(0, 0)` - pustą mapę na produkcji.
    expect(shardCountFor(10, 0)).toBe(10);
    expect(shardCountFor(10, -1)).toBe(10);
    const urls = [1, 2, 3];
    expect(shardSlice(urls, 1, 0)).toEqual([1]);
    expect(shardSlice(urls, 1, -7)).toEqual([1]);
  });

  it("numer shardu 0 i ujemny są traktowane jak pierwszy shard", () => {
    const urls = Array.from({ length: 5 }, (_, i) => i);
    expect(shardSlice(urls, 0, 2)).toEqual([0, 1]);
    expect(shardSlice(urls, -3, 2)).toEqual([0, 1]);
  });
});

describe("buildSitemapIndexXml - wejścia niepełne", () => {
  const lastmodCases: readonly { label: string; lastmod?: string | null }[] = [
    { label: "pominięte pole" },
    { label: "null", lastmod: null },
    { label: "pusty łańcuch", lastmod: "" },
    { label: "same spacje", lastmod: "   " },
  ];

  it.each(lastmodCases)("pomija <lastmod> dla $label", ({ lastmod }) => {
    const xml = buildSitemapIndexXml([{ loc: "https://nes.example/sitemaps/core.xml", lastmod }]);
    expect(xml).not.toContain("<lastmod>");
    expect(xml).toContain("<loc>https://nes.example/sitemaps/core.xml</loc>");
  });

  it("przycina datę otoczoną spacjami", () => {
    const xml = buildSitemapIndexXml([
      { loc: "https://nes.example/a.xml", lastmod: "  2026-08-01 " },
    ]);
    expect(xml).toContain("<lastmod>2026-08-01</lastmod>");
  });

  it("pusta lista wpisów daje poprawny, pusty indeks (a nie połamany XML)", () => {
    // Świeża instalacja bez treści nadal MUSI odpowiedzieć dokumentem, który
    // walidator sitemaps.org przyjmie - inaczej GSC zgłasza błąd pobierania.
    const xml = buildSitemapIndexXml([]);
    expect(xml).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        "</sitemapindex>",
    );
    expect(xml).not.toContain("<sitemap>");
  });
});
