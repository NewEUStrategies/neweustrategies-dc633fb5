// Indeks sitemap (<sitemapindex>) + podział mapy na sekcje i shardy.
//
// PRZYCZYNA: /sitemap.xml był JEDNYM plikiem <urlset> z całą treścią serwisu.
// Protokół sitemap.org twardo ogranicza pojedynczy plik do 50 000 adresów i
// 50 MB nieskompresowanych, a każdy dokument serwis publikuje w DWÓCH wariantach
// językowych (PL + /en) z klastrem hreflang - realny sufit to więc ~25 000
// dokumentów, po czym mapa milcząco urywa się na granicy limitu i crawler
// przestaje widzieć nowe treści. Dodatkowo cały plik trzeba było wyliczyć
// (kilkanaście zapytań) na każde żądanie crawlera.
//
// ROZWIĄZANIE: /sitemap.xml to teraz INDEKS, który wskazuje na shardy sekcji
// (/sitemaps/<sekcja>.xml, przy przepełnieniu /sitemaps/<sekcja>-2.xml itd.).
// Crawler pobiera tylko te sekcje, które go interesują, a rozmiar jednego pliku
// nigdy nie zbliża się do limitu protokołu. news-sitemap.xml jest listowany w
// tym samym indeksie, więc przestaje być odkrywalny wyłącznie z robots.txt.
//
// Ten moduł jest CZYSTY (bez I/O, bez frameworka), więc kontrakt limitów i
// nazewnictwa shardów da się przetestować jednostkowo.

/**
 * Adresów na jeden shard. Połowa twardego limitu protokołu (50 000): jeden wpis
 * <url> z klastrem hreflang to ~400 B, więc 25 000 daje ~10 MB - z zapasem pod
 * limitem 50 MB, a jednocześnie nie mnoży plików bez potrzeby.
 */
export const SITEMAP_URLS_PER_SHARD = 25_000;

/**
 * Sekcje mapy. Podział idzie po TYPIE treści (a nie po ślepym dzieleniu na
 * równe paczki), bo wtedy raport "Sitemapy" w GSC pokazuje pokrycie i błędy
 * per rodzaj strony - widać, że np. przestały się indeksować dossier trackera,
 * a nie że "coś w mapie".
 */
export const SITEMAP_SECTIONS = [
  "core",
  "pages",
  "posts",
  "taxonomy",
  "podcasts",
  "programs",
  "stories",
  "tracker",
  "events",
  "qa",
  "experts",
] as const;

export type SitemapSection = (typeof SITEMAP_SECTIONS)[number];

const SECTION_SET: ReadonlySet<string> = new Set(SITEMAP_SECTIONS);

export function isSitemapSection(value: string): value is SitemapSection {
  return SECTION_SET.has(value);
}

/** Liczba shardów potrzebna dla danej liczby adresów (min. 1). */
export function shardCountFor(urlCount: number, perShard = SITEMAP_URLS_PER_SHARD): number {
  if (!Number.isFinite(urlCount) || urlCount <= 0) return 0;
  return Math.max(1, Math.ceil(urlCount / Math.max(1, perShard)));
}

/**
 * Nazwa pliku shardu. Pierwszy shard nie dostaje sufiksu (`posts.xml`), kolejne
 * numerujemy od 2 (`posts-2.xml`) - dzięki temu serwisy o normalnej skali mają
 * stabilne, czytelne adresy, a numeracja pojawia się tylko wtedy, gdy naprawdę
 * jest potrzebna.
 */
export function sitemapShardFile(section: SitemapSection, shard: number): string {
  return shard <= 1 ? `${section}.xml` : `${section}-${shard}.xml`;
}

/** Ścieżka shardu w serwisie (absolutna, bez originu). */
export function sitemapShardPath(section: SitemapSection, shard: number): string {
  return `/sitemaps/${sitemapShardFile(section, shard)}`;
}

/**
 * Odwrotność `sitemapShardFile`: rozbiera segment adresu na sekcję i numer
 * shardu. Zwraca `null` dla nieznanej sekcji, złego sufiksu i numeru <= 1
 * podanego jawnie (`posts-1.xml` nie jest adresem kanonicznym - shard pierwszy
 * mieszka pod `posts.xml`), żeby jeden shard nie był dostępny pod dwoma URL-ami.
 */
export function parseSitemapShard(raw: string): { section: SitemapSection; shard: number } | null {
  if (!raw.endsWith(".xml")) return null;
  const stem = raw.slice(0, -".xml".length);
  const match = /^(.+?)(?:-(\d+))?$/.exec(stem);
  if (!match) return null;
  const [, section, shardRaw] = match;
  if (!isSitemapSection(section)) return null;
  if (shardRaw === undefined) return { section, shard: 1 };
  const shard = Number(shardRaw);
  if (!Number.isInteger(shard) || shard < 2) return null;
  return { section, shard };
}

/** Wycinek adresów należący do shardu (1-indeksowany). */
export function shardSlice<T>(
  urls: readonly T[],
  shard: number,
  perShard = SITEMAP_URLS_PER_SHARD,
): T[] {
  const size = Math.max(1, perShard);
  const start = (Math.max(1, shard) - 1) * size;
  return urls.slice(start, start + size);
}

export interface SitemapIndexEntry {
  /** Absolutny adres pliku sitemapy. */
  loc: string;
  /** YYYY-MM-DD lub pełny ISO; pusty/nieznany pomijamy. */
  lastmod?: string | null;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Dokument <sitemapindex> zgodny z sitemaps.org 0.9. */
export function buildSitemapIndexXml(entries: readonly SitemapIndexEntry[]): string {
  const blocks = entries.map((entry) =>
    [
      "  <sitemap>",
      `    <loc>${xmlEscape(entry.loc)}</loc>`,
      entry.lastmod?.trim() ? `    <lastmod>${xmlEscape(entry.lastmod.trim())}</lastmod>` : null,
      "  </sitemap>",
    ]
      .filter(Boolean)
      .join("\n"),
  );
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    ...blocks,
    `</sitemapindex>`,
  ].join("\n");
}
