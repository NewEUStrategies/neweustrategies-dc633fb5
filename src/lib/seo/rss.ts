// Pure RSS 2.0 builder for the site-wide feeds (/rss.xml per language).
// Paywall-safe by design: items carry the excerpt, never the full body, so the
// feed can be public without leaking gated content. Framework-free and fully
// unit-testable; the server route only assembles the input and sets headers.

export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Strip HTML tags and collapse whitespace (feed descriptions are plain text). */
export function plainText(value: string | null | undefined, maxLen = 500): string {
  const clean = (value ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > maxLen ? `${clean.slice(0, maxLen - 1).trimEnd()}…` : clean;
}

/** RFC 822 date (RSS 2.0 requires this exact format). */
export function rfc822Date(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toUTCString();
}

export interface RssItem {
  /** Absolute canonical URL (also the permalink guid). */
  url: string;
  title: string;
  /** Plain-text or HTML excerpt (tags are stripped). */
  description: string | null;
  publishedAt: string | null;
  /** Category / tag names. */
  categories?: readonly string[];
  /** Cover image (absolute URL) - emitted as media:content. */
  imageUrl?: string | null;
  authorName?: string | null;
}

export interface RssChannelInput {
  title: string;
  description: string;
  /** Absolute site URL for this language (e.g. "https://x.com/en"). */
  siteUrl: string;
  /** Absolute URL of the feed itself (atom:link rel="self"). */
  feedUrl: string;
  language: string;
  copyright?: string | null;
  items: readonly RssItem[];
}

/** Build the complete RSS 2.0 document. */
export function buildRssXml(input: RssChannelInput): string {
  const newest = input.items.map((i) => rfc822Date(i.publishedAt)).find((d) => d !== null);

  const itemXml = input.items.map((item) => {
    const lines = [
      "    <item>",
      `      <title>${xmlEscape(item.title)}</title>`,
      `      <link>${xmlEscape(item.url)}</link>`,
      `      <guid isPermaLink="true">${xmlEscape(item.url)}</guid>`,
    ];
    const pub = rfc822Date(item.publishedAt);
    if (pub) lines.push(`      <pubDate>${pub}</pubDate>`);
    const description = plainText(item.description);
    if (description) lines.push(`      <description>${xmlEscape(description)}</description>`);
    if (item.authorName?.trim()) {
      lines.push(`      <dc:creator>${xmlEscape(item.authorName.trim())}</dc:creator>`);
    }
    for (const category of item.categories ?? []) {
      if (category.trim()) lines.push(`      <category>${xmlEscape(category.trim())}</category>`);
    }
    if (item.imageUrl?.trim()) {
      lines.push(`      <media:content url="${xmlEscape(item.imageUrl.trim())}" medium="image"/>`);
    }
    lines.push("    </item>");
    return lines.join("\n");
  });

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/">`,
    `  <channel>`,
    `    <title>${xmlEscape(input.title)}</title>`,
    `    <link>${xmlEscape(input.siteUrl)}</link>`,
    `    <description>${xmlEscape(input.description)}</description>`,
    `    <language>${xmlEscape(input.language)}</language>`,
    `    <atom:link href="${xmlEscape(input.feedUrl)}" rel="self" type="application/rss+xml"/>`,
    ...(newest ? [`    <lastBuildDate>${newest}</lastBuildDate>`] : []),
    ...(input.copyright ? [`    <copyright>${xmlEscape(input.copyright)}</copyright>`] : []),
    `    <ttl>60</ttl>`,
    ...itemXml,
    `  </channel>`,
    `</rss>`,
  ].join("\n");
}
