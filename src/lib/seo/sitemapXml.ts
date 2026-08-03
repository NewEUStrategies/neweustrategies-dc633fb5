// Czyste składanie dokumentów <urlset> sitemapy (escaping, klaster hreflang,
// render bloków <url>). Wydzielone z trasy /sitemap.xml, bo od podziału mapy na
// indeks + shardy te same funkcje potrzebuje KILKA tras (indeks liczy adresy,
// shard je renderuje) - a trasa nie jest modułem, z którego się importuje.
import {
  SUPPORTED_LANGS,
  DEFAULT_LANG,
  localizedPath,
  stripLangPrefix,
} from "@/lib/i18n/localePath";
import type { RedirectIndex } from "@/lib/seo/redirects";
import { sitemapLanguageUrls } from "@/lib/seo/sitemapUrls";

// Jeden escaper dla wszystkich powierzchni XML (RSS i sitemapy) - dwie kopie
// tej samej funkcji rozjeżdżały się przy każdej zmianie.
export { xmlEscape } from "./rss";
import { xmlEscape } from "./rss";

/**
 * hreflang alternates per URL (x-default + jeden self-adresowalny URL na język).
 * Każdy wariant używa prefiksu ŚCIEŻKI, którym serwis adresuje język (PL pod
 * nagim adresem, EN pod "/en") - dokładnie jak wewnątrzstronicowy klaster
 * <link rel="alternate">, więc crawler dostaje ten sam graf językowy z mapy i
 * z <head>. `loc` jest adresem kanonicznym (język domyślny).
 */
export function alternateLinks(loc: string): string[] {
  let origin = "";
  let path = loc;
  try {
    const u = new URL(loc);
    origin = u.origin;
    path = u.pathname;
  } catch {
    /* relative loc - localize the raw string */
  }
  const canonical = stripLangPrefix(path).pathname;
  const href = (lang: (typeof SUPPORTED_LANGS)[number]) =>
    xmlEscape(`${origin}${localizedPath(canonical, lang)}`);
  const lines = [
    `    <xhtml:link rel="alternate" hreflang="x-default" href="${href(DEFAULT_LANG)}"/>`,
  ];
  for (const l of SUPPORTED_LANGS) {
    lines.push(`    <xhtml:link rel="alternate" hreflang="${l}" href="${href(l)}"/>`);
  }
  return lines;
}

/** Wejście z warstwy danych: jeden DOKUMENT (bez wariantów językowych). */
export interface SitemapEntry {
  loc: string;
  lastmod?: string;
  changefreq?: "daily" | "weekly" | "monthly";
  priority?: string;
}

/** Jeden gotowy adres w sitemapie, już po kanonizacji i lokalizacji. */
export interface SitemapUrlBlock {
  loc: string;
  alternates: ReadonlyArray<{ hreflang: string; href: string }>;
  lastmod?: string;
  changefreq?: string;
  priority?: string;
}

/** Blok <url> pojedynczego adresu. */
export function renderUrlBlock(block: SitemapUrlBlock): string {
  return [
    "  <url>",
    `    <loc>${xmlEscape(block.loc)}</loc>`,
    ...block.alternates.map(
      (a) =>
        `    <xhtml:link rel="alternate" hreflang="${a.hreflang}" href="${xmlEscape(a.href)}"/>`,
    ),
    block.lastmod ? `    <lastmod>${block.lastmod}</lastmod>` : null,
    block.changefreq ? `    <changefreq>${block.changefreq}</changefreq>` : null,
    block.priority ? `    <priority>${block.priority}</priority>` : null,
    "  </url>",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Rozwinięcie dokumentów w konkretne adresy sitemapy: kanonizacja przekierowań,
 * warianty językowe, deduplikacja i STABILNE sortowanie.
 *
 * Sortowanie nie jest kosmetyką, tylko warunkiem poprawności shardowania:
 * indeks liczy adresy, a shard je wycina - gdyby kolejność zależała od
 * niezdeterminowanej kolejności wierszy Postgresa (zapytania nie mają ORDER BY),
 * granice shardów wędrowałyby między żądaniami i część adresów wypadałaby z
 * mapy albo dublowała się w dwóch shardach.
 */
export function expandSitemapUrls(
  origin: string,
  entries: readonly SitemapEntry[],
  redirectIndex: RedirectIndex | null,
  sameOriginHosts: readonly string[],
): SitemapUrlBlock[] {
  const seen = new Set<string>();
  const blocks: SitemapUrlBlock[] = [];
  for (const entry of entries) {
    const path = entry.loc.startsWith(origin) ? entry.loc.slice(origin.length) : entry.loc;
    for (const variant of sitemapLanguageUrls(
      origin,
      path || "/",
      redirectIndex,
      sameOriginHosts,
    )) {
      if (seen.has(variant.loc)) continue;
      seen.add(variant.loc);
      blocks.push({
        loc: variant.loc,
        alternates: variant.alternates,
        lastmod: entry.lastmod,
        changefreq: entry.changefreq,
        priority: entry.priority,
      });
    }
  }
  blocks.sort((a, b) => (a.loc < b.loc ? -1 : a.loc > b.loc ? 1 : 0));
  return blocks;
}

/** Najnowsza data `lastmod` w zbiorze - `lastmod` wpisu w indeksie sitemapy. */
export function newestLastmod(blocks: readonly SitemapUrlBlock[]): string | null {
  let newest: string | null = null;
  for (const block of blocks) {
    if (!block.lastmod) continue;
    if (newest === null || block.lastmod > newest) newest = block.lastmod;
  }
  return newest;
}

/** Kompletny dokument <urlset> (z przestrzenią xhtml pod hreflang). */
export function buildUrlsetXml(blocks: readonly SitemapUrlBlock[]): string {
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">`,
    ...blocks.map(renderUrlBlock),
    `</urlset>`,
  ].join("\n");
}
