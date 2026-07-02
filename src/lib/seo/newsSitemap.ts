// Pure Google News sitemap builder (/news-sitemap.xml). Google News only
// accepts articles published within the last 48 hours (max 1000 per sitemap),
// so the builder filters by recency itself - the route just supplies rows.
// Each language version is its own <url> entry with a matching
// <news:language>, mirroring the site's path-prefix i18n.
import { xmlEscape } from "@/lib/seo/rss";

export const NEWS_SITEMAP_WINDOW_MS = 48 * 60 * 60 * 1000;
export const NEWS_SITEMAP_MAX_ENTRIES = 1000;

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

/** Entries inside Google's 48h window, newest first, capped at 1000. */
export function freshNewsEntries(
  entries: readonly NewsSitemapEntry[],
  now: number,
): NewsSitemapEntry[] {
  return entries
    .filter((e) => {
      const t = new Date(e.publishedAt).getTime();
      return !Number.isNaN(t) && t <= now && now - t <= NEWS_SITEMAP_WINDOW_MS;
    })
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, NEWS_SITEMAP_MAX_ENTRIES);
}

/** Build the news sitemap XML. An empty urlset is valid (quiet news day). */
export function buildNewsSitemapXml(input: NewsSitemapInput): string {
  const now = input.now ?? Date.now();
  const fresh = freshNewsEntries(input.entries, now);
  const urls = fresh.map((entry) =>
    [
      "  <url>",
      `    <loc>${xmlEscape(entry.url)}</loc>`,
      "    <news:news>",
      "      <news:publication>",
      `        <news:name>${xmlEscape(input.publicationName)}</news:name>`,
      `        <news:language>${xmlEscape(entry.language)}</news:language>`,
      "      </news:publication>",
      `      <news:publication_date>${xmlEscape(entry.publishedAt)}</news:publication_date>`,
      `      <news:title>${xmlEscape(entry.title)}</news:title>`,
      "    </news:news>",
      "  </url>",
    ].join("\n"),
  );
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">`,
    ...urls,
    `</urlset>`,
  ].join("\n");
}
