// Pure Google News sitemap builder (/news-sitemap.xml). Google News only
// accepts articles published within the last 48 hours (max 1000 per sitemap),
// so the builder filters by recency itself - the route just supplies rows.
// Each language version is its own <url> entry with a matching
// <news:language>, mirroring the site's path-prefix i18n.
//
// NAPRAWA 2026-10-10 - PUSTY <urlset> TO BŁĄD, NIE „SPOKOJNY DZIEŃ".
// Do tej pory dzień bez publikacji dawał dokument bez ani jednego <url>, a
// komentarz nazywał go poprawnym. Nie jest: schemat sitemaps.org
// (`sitemap.xsd`) wymaga w `urlset` co najmniej jednego `url` (domyślne
// `minOccurs="1"`), i dokładnie to raportował Search Console: „Mapa witryny
// może zostać odczytana, ale zawiera błędy - Brak tagu XML: url (wiersz 3)",
// 0 wykrytych stron. Serwis, który nie publikuje codziennie, miał ten błąd
// przez większość tygodnia.
//
// Plan ma teraz trzy stany:
//   * `fresh`  - artykuły z okna 48 h (jak dotąd, do 1000);
//   * `anchor` - okno puste, więc plik niesie NAJNOWSZY artykuł (wszystkie
//                jego wersje językowe) jako zwykły adres - `<loc>` + `<lastmod>`,
//                BEZ metadanych `<news:news>`. To dokładnie druga z dwóch dróg,
//                które Google podaje dla artykułów starszych niż dwa dni
//                („remove the <news:news> metadata in your sitemap from the
//                older URLs"): dokument zostaje poprawny względem schematu,
//                a News nie dostaje artykułu spoza okna. Kotwica znika sama
//                przy pierwszej nowej publikacji (poprawka z przeglądu PR #491:
//                pierwsza wersja zostawiała kotwicy metadane News);
//   * `empty`  - tenant nie ma ŻADNEGO opublikowanego artykułu: pliku nie ma
//                (trasa oddaje 404), a indeks sitemapy go nie ogłasza.
import { xmlEscape } from "@/lib/seo/rss";
import { SITEMAP_STYLESHEET_PI } from "@/lib/seo/sitemapStylesheet";

export const NEWS_SITEMAP_WINDOW_MS = 48 * 60 * 60 * 1000;
const NEWS_SITEMAP_MAX_ENTRIES = 1000;

export interface NewsSitemapEntry {
  /** Absolute, language-addressed URL. */
  url: string;
  title: string;
  /** ISO publication date. */
  publishedAt: string;
  /** ISO 639-1 language of THIS entry. */
  language: string;
}

export interface NewsSitemapInput {
  publicationName: string;
  entries: readonly NewsSitemapEntry[];
  /** Clock override for tests. */
  now?: number;
}

export type NewsSitemapMode = "fresh" | "anchor" | "empty";

export interface NewsSitemapPlan {
  mode: NewsSitemapMode;
  /** Wpisy, które trafią do dokumentu (pusta lista tylko dla `empty`). */
  entries: NewsSitemapEntry[];
  /**
   * Data publikacji najnowszego wpisu (W3C Datetime) - `lastmod` pozycji
   * news-sitemap w indeksie. `null` dla `empty`.
   */
  lastmod: string | null;
}

function publishedTime(entry: NewsSitemapEntry): number {
  return new Date(entry.publishedAt).getTime();
}

/**
 * Data publikacji w formacie W3C Datetime (UTC, bez milisekund). Baza oddaje
 * `timestamptz` w kilku równoważnych zapisach; Google News wymaga jednego z
 * profili ISO 8601, więc normalizujemy, zamiast przepuszczać surowy tekst.
 */
export function newsPublicationDate(publishedAt: string): string {
  const time = new Date(publishedAt).getTime();
  if (Number.isNaN(time)) return publishedAt;
  return new Date(time).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Entries inside Google's 48h window, newest first, capped at 1000. */
export function freshNewsEntries(
  entries: readonly NewsSitemapEntry[],
  now: number,
): NewsSitemapEntry[] {
  return entries
    .filter((e) => {
      const t = publishedTime(e);
      return !Number.isNaN(t) && t <= now && now - t <= NEWS_SITEMAP_WINDOW_MS;
    })
    .sort((a, b) => publishedTime(b) - publishedTime(a))
    .slice(0, NEWS_SITEMAP_MAX_ENTRIES);
}

/**
 * Co trafi do news-sitemapy - JEDNO źródło prawdy dla trasy pliku i dla
 * indeksu, żeby indeks nigdy nie ogłaszał pliku, który wyszedłby pusty.
 */
export function planNewsSitemap(
  entries: readonly NewsSitemapEntry[],
  now: number,
): NewsSitemapPlan {
  const fresh = freshNewsEntries(entries, now);
  if (fresh.length > 0) {
    return { mode: "fresh", entries: fresh, lastmod: newsPublicationDate(fresh[0].publishedAt) };
  }
  // Kotwica: najnowsza publikacja z przeszłości (wpis z przyszłością to
  // zaplanowana publikacja - nie wolno jej ujawnić przed czasem) razem ze
  // wszystkimi wersjami językowymi, które dzielą tę samą chwilę publikacji.
  let newest = Number.NEGATIVE_INFINITY;
  for (const entry of entries) {
    const t = publishedTime(entry);
    if (!Number.isNaN(t) && t <= now && t > newest) newest = t;
  }
  if (!Number.isFinite(newest)) return { mode: "empty", entries: [], lastmod: null };
  const anchor = entries
    .filter((entry) => publishedTime(entry) === newest)
    .slice(0, NEWS_SITEMAP_MAX_ENTRIES);
  return { mode: "anchor", entries: anchor, lastmod: newsPublicationDate(anchor[0].publishedAt) };
}

/** Wpis z metadanymi Google News (artykuł z okna 48 h). */
function newsUrlBlock(publicationName: string, entry: NewsSitemapEntry): string {
  return [
    "  <url>",
    `    <loc>${xmlEscape(entry.url)}</loc>`,
    "    <news:news>",
    "      <news:publication>",
    `        <news:name>${xmlEscape(publicationName)}</news:name>`,
    `        <news:language>${xmlEscape(entry.language)}</news:language>`,
    "      </news:publication>",
    `      <news:publication_date>${xmlEscape(newsPublicationDate(entry.publishedAt))}</news:publication_date>`,
    `      <news:title>${xmlEscape(entry.title)}</news:title>`,
    "    </news:news>",
    "  </url>",
  ].join("\n");
}

/** Kotwica: zwykły adres bez metadanych News (artykuł starszy niż 48 h). */
function anchorUrlBlock(entry: NewsSitemapEntry): string {
  return [
    "  <url>",
    `    <loc>${xmlEscape(entry.url)}</loc>`,
    `    <lastmod>${xmlEscape(newsPublicationDate(entry.publishedAt))}</lastmod>`,
    "  </url>",
  ].join("\n");
}

/**
 * Dokument news-sitemapy z planu (co najmniej jeden wpis). Wpisy `fresh` niosą
 * `<news:news>`, kotwica (`anchor`) - wyłącznie `<loc>` i `<lastmod>`.
 */
export function renderNewsSitemapXml(publicationName: string, plan: NewsSitemapPlan): string {
  const urls = plan.entries.map((entry) =>
    plan.mode === "fresh" ? newsUrlBlock(publicationName, entry) : anchorUrlBlock(entry),
  );
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    SITEMAP_STYLESHEET_PI,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">`,
    ...urls,
    `</urlset>`,
  ].join("\n");
}

/**
 * Build the news sitemap XML. `null` = nothing to publish (the tenant has no
 * published article at all) - an empty `<urlset>` is invalid against
 * sitemap.xsd, so there is no such document to serve.
 */
export function buildNewsSitemapXml(input: NewsSitemapInput): string | null {
  const plan = planNewsSitemap(input.entries, input.now ?? Date.now());
  if (plan.entries.length === 0) return null;
  return renderNewsSitemapXml(input.publicationName, plan);
}
