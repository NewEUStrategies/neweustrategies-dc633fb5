// Pure RSS 2.0 builder for the site-wide feeds (/rss.xml per language).
// Paywall-safe by design: items carry the excerpt, never the full body, so the
// feed can be public without leaking gated content. Framework-free and fully
// unit-testable; the server route only assembles the input and sets headers.
import { decodeHtmlEntities } from "@/lib/seo/headingValidation";

export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Końcowy znacznik skrócenia zajawki z WordPressa: „[…]", „[...]", „(…)" -
 * także kilka po sobie. Stosowany PO zwinięciu białych znaków, więc między
 * znacznikami stoi najwyżej jedna spacja (brak kosztownego nawrotu).
 */
const TRAILING_TRUNCATION_MARKER = /(?: ?[[(](?:…|\.{2,})[\])])+ ?$/;

/**
 * Znaki spoza produkcji `Char` XML 1.0 (sterujące C0 poza tab/LF/CR oraz
 * U+FFFE/U+FFFF). Przegląd 2026-10: od kiedy `plainText` dekoduje encje,
 * zajawka z `&#1;` albo `&#xFFFF;` (wklejka z Worda, import) przestała być
 * dosłownym tekstem `&amp;#1;` i stawała się SUROWYM znakiem sterującym
 * w `<description>` - a jeden taki znak czyni cały kanał źle uformowanym
 * XML-em, który czytnik odrzuca w całości. `xmlEscape` ich nie rusza (to nie
 * są znaki składni), więc wycinamy je tu, razem z surowymi z bazy.
 */
// eslint-disable-next-line no-control-regex -- celowo: znaki niedozwolone w XML 1.0
const XML_INVALID_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

/**
 * Tekst jawny do opisów feedów i llms.txt: bez znaczników, z ZDEKODOWANYMI
 * encjami, bez końcowego znacznika skrócenia, z jedną spacją między słowami.
 *
 * NAPRAWA 2026-10 (audyt powierzchni maszynowych na produkcji): funkcja
 * zdejmowała tagi, ale encji nie dekodowała, a zajawki 18 wpisów z importu
 * WordPressa niosą je dosłownie. `xmlEscape` zamieniał potem `&` na `&amp;`,
 * więc czytnik RSS pokazywał „&hellip;" i „&#8222;cytat&#8221;", a llms.txt -
 * który w ogóle nie czyścił zajawek - podawał modelom znacznik „[&hellip;]"
 * jako część streszczenia. Kolejność jest istotna: encje dekodujemy PO
 * zdjęciu tagów (`&lt;b&gt;` zostaje tekstem „<b>", nie staje się znacznikiem)
 * i PRZED `xmlEscape` wołającego, więc `&amp;` w bazie daje w XML-u jedno
 * `&amp;`, a nie `&amp;amp;`. Dekoder jest wspólny z walidatorem nagłówków
 * (jednoprzebiegowy, bez podwójnego dekodowania, mapa zamiast obiektu).
 */
export function plainText(value: string | null | undefined, maxLen = 500): string {
  const collapsed = decodeHtmlEntities((value ?? "").replace(/<[^>]+>/g, " "))
    .replace(XML_INVALID_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Znacznik skrócenia szukamy WYŁĄCZNIE w ogonie (przegląd 2026-10): wzorzec
  // z powtórzeniem `(...)+ ?$` na całym tekście nawracał kwadratowo przy
  // każdym renderze kanału, a WordPress dokleja najwyżej kilka znaczników.
  const cut = Math.max(0, collapsed.length - TRUNCATION_MARKER_TAIL);
  const clean = (
    collapsed.slice(0, cut) + collapsed.slice(cut).replace(TRAILING_TRUNCATION_MARKER, "")
  ).trimEnd();
  return clean.length > maxLen ? `${clean.slice(0, maxLen - 1).trimEnd()}…` : clean;
}

/** Ile końcowych znaków przeszukujemy pod kątem znaczników „[…]" (kilka po sobie). */
const TRUNCATION_MARKER_TAIL = 64;

/**
 * Tekst jawny jako treść HTML pola, które czytnik RENDERUJE (`<description>`
 * RSS 2.0). Przegląd 2026-10: od kiedy `plainText` dekoduje encje, znacznik
 * zapisany w bazie jako `&lt;img onerror=…&gt;` wychodził po jednym `xmlEscape`
 * jako `&lt;img …&gt;`, a czytnik po rozpakowaniu XML-a dostawał żywy tag.
 * Escapowanie HTML przed `xmlEscape` sprawia, że czytnik pokazuje go jako tekst.
 */
export function htmlEscapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** RFC 822 date (RSS 2.0 requires this exact format). */
export function rfc822Date(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toUTCString();
}

export interface RssItem {
  /** Absolute canonical URL (also the default permalink guid). */
  url: string;
  /**
   * Explicit, stable identity emitted as `guid isPermaLink="false"`.
   *
   * Needed whenever several items share ONE canonical URL - the tracker feed
   * emits one entry per timeline update of the same dossier, so a
   * URL-as-guid feed would look like duplicates to readers and silently drop
   * every alert after the first. Omit it for one-item-per-URL feeds (posts,
   * podcasts): the URL then stays the permalink guid, unchanged.
   */
  guid?: string;
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
    const explicitGuid = item.guid?.trim();
    const lines = [
      "    <item>",
      `      <title>${xmlEscape(item.title)}</title>`,
      `      <link>${xmlEscape(item.url)}</link>`,
      explicitGuid
        ? `      <guid isPermaLink="false">${xmlEscape(explicitGuid)}</guid>`
        : `      <guid isPermaLink="true">${xmlEscape(item.url)}</guid>`,
    ];
    const pub = rfc822Date(item.publishedAt);
    if (pub) lines.push(`      <pubDate>${pub}</pubDate>`);
    const description = plainText(item.description);
    if (description) {
      lines.push(`      <description>${xmlEscape(htmlEscapeText(description))}</description>`);
    }
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
