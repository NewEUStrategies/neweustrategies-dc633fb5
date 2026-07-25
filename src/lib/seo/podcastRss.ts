// Pure RSS 2.0 + iTunes builder for the podcast feeds (/podcast/rss.xml and
// /podcasts/{show}/rss.xml). Unlike the site feed, podcast items carry an
// <enclosure> (the audio file) and the iTunes namespace tags Apple/Spotify
// require to ingest a show. Framework-free and unit-testable; the route only
// assembles input + headers.
//
// APPLE PODCASTS CONNECT - wymagania kanalu. Wersja sprzed 2026-07-25 emitowala
// z listy wymaganych tagow tylko <title>, <description> i <language>, wiec kanal
// NIE PRZECHODZIL walidacji przy zgloszeniu:
//   * <itunes:category>  - brakowalo calkowicie (twardy wymog),
//   * <itunes:explicit>  - brakowalo calkowicie (twardy wymog),
//   * <itunes:image>     - pole bylo opcjonalne w builderze, a trasa
//                          /podcast/rss.xml nie podawala go WCALE,
//   * <itunes:owner>     - brak e-maila = brak mozliwosci weryfikacji
//                          wlasnosci kanalu w Podcasts Connect,
//   * <itunes:author>    - brak nazwy wydawcy w katalogu.
// Na poziomie <item> brakowalo <itunes:explicit>, <itunes:episodeType>
// i <itunes:title>.
//
// Builder jest teraz FAIL-SAFE: kategoria i explicit mają wartości domyślne, a
// obrazek kanału degraduje do pierwszej dostępnej okładki, więc feed nigdy nie
// wychodzi bez tagu, którego Apple wymaga. Braki, których nie da się wypełnić
// sensownym domyślnym (e-mail właściciela), raportuje `podcastFeedReadiness`
// (osobny moduł, bo woła go PANEL) - /admin/podcasts pokazuje je redakcji
// ZANIM zgłosi kanał do Apple.
import { xmlEscape, plainText, rfc822Date } from "./rss";
import {
  DEFAULT_APPLE_CATEGORY,
  DEFAULT_APPLE_SUBCATEGORY,
  normalizeAppleCategory,
} from "./applePodcastCategories";

// Typy słownikowe żyją w `@/lib/podcast/types` (używa ich też panel).
export type { PodcastEpisodeType, PodcastShowType } from "@/lib/podcast/types";
import type { PodcastEpisodeType, PodcastShowType } from "@/lib/podcast/types";

export interface PodcastRssItem {
  /** Absolute episode page URL (also the guid). */
  url: string;
  title: string;
  description: string | null;
  publishedAt: string | null;
  /** Absolute audio URL (the enclosure). */
  audioUrl: string;
  /** Real file size in bytes (enclosure length); null/0 falls back to "0". */
  audioBytes?: number | null;
  /** Stored MIME (media library); null falls back to extension sniffing. */
  audioMime?: string | null;
  /** Duration in seconds (emitted as itunes:duration). */
  durationSeconds: number;
  season?: number | null;
  episodeNumber?: number | null;
  imageUrl?: string | null;
  /** <itunes:explicit> na odcinku; brak = wartość kanału. */
  explicit?: boolean | null;
  /** <itunes:episodeType>; brak = "full". */
  episodeType?: PodcastEpisodeType | null;
}

export interface PodcastRssChannelInput {
  title: string;
  description: string;
  siteUrl: string;
  feedUrl: string;
  language: string;
  copyright?: string | null;
  imageUrl?: string | null;
  /** <itunes:author> - wydawca prezentowany w katalogu. */
  author?: string | null;
  /** <itunes:owner> - nazwa właściciela kanału. */
  ownerName?: string | null;
  /** <itunes:owner><itunes:email> - adres weryfikacyjny Podcasts Connect. */
  ownerEmail?: string | null;
  /** Kategoria z taksonomii Apple; nieznana degraduje do domyślnej. */
  category?: string | null;
  subcategory?: string | null;
  /** <itunes:explicit> kanału; brak = false. */
  explicit?: boolean | null;
  /** <itunes:type>; brak = "episodic". */
  showType?: PodcastShowType | null;
  /** <itunes:complete> - program zakończony. */
  complete?: boolean | null;
  items: readonly PodcastRssItem[];
}

/**
 * Enclosure MIME derived from the audio URL's extension. The admin explicitly
 * invites mp3/m4a/wav uploads, so hardcoding audio/mpeg would mis-declare
 * non-mp3 episodes to podcast directories. Unknown/missing extension falls
 * back to audio/mpeg (the dominant format).
 */
export function enclosureMimeType(audioUrl: string): string {
  const ext = audioUrl.split(/[?#]/)[0].split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "m4a":
    case "mp4":
    case "aac":
      return "audio/mp4";
    case "wav":
      return "audio/wav";
    case "ogg":
    case "oga":
      return "audio/ogg";
    case "webm":
      return "audio/webm";
    default:
      return "audio/mpeg";
  }
}

/** Format seconds as HH:MM:SS for itunes:duration. */
function itunesDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

const yesNo = (v: boolean): string => (v ? "yes" : "no");

export function buildPodcastRssXml(input: PodcastRssChannelInput): string {
  const newest = input.items.map((i) => rfc822Date(i.publishedAt)).find((d) => d !== null);
  const channelExplicit = input.explicit === true;
  const { category, subcategory } = normalizeAppleCategory(input.category, input.subcategory);
  // Okładka kanału jest WYMAGANA - gdy nie podano jej wprost, bierzemy pierwszą
  // okładkę odcinka, żeby feed nie wyszedł bez <itunes:image>.
  const channelImage =
    input.imageUrl?.trim() || input.items.find((i) => i.imageUrl?.trim())?.imageUrl?.trim() || "";
  const author = input.author?.trim() || "";
  const ownerName = input.ownerName?.trim() || author;
  const ownerEmail = input.ownerEmail?.trim() || "";

  const itemXml = input.items.map((item) => {
    const lines = [
      "    <item>",
      `      <title>${xmlEscape(item.title)}</title>`,
      // <itunes:title> jest tytułem prezentowanym w aplikacji Apple (bez
      // prefiksów typu "S2E14", które lubią siedzieć w <title>).
      `      <itunes:title>${xmlEscape(item.title)}</itunes:title>`,
      `      <link>${xmlEscape(item.url)}</link>`,
      `      <guid isPermaLink="true">${xmlEscape(item.url)}</guid>`,
    ];
    const pub = rfc822Date(item.publishedAt);
    if (pub) lines.push(`      <pubDate>${pub}</pubDate>`);
    const description = plainText(item.description);
    if (description) {
      lines.push(`      <description>${xmlEscape(description)}</description>`);
      lines.push(`      <itunes:summary>${xmlEscape(description)}</itunes:summary>`);
    }
    // RSS wymaga length: dla plików z biblioteki mediów znamy prawdziwy rozmiar
    // i MIME; dla URL-i zewnętrznych 0 (dopuszczalne przez większość
    // agregatorów) + MIME z rozszerzenia pliku.
    const length =
      item.audioBytes != null && item.audioBytes > 0 ? String(Math.floor(item.audioBytes)) : "0";
    const mime = item.audioMime?.trim() || enclosureMimeType(item.audioUrl);
    lines.push(
      `      <enclosure url="${xmlEscape(item.audioUrl)}" length="${length}" type="${xmlEscape(mime)}"/>`,
    );
    if (item.durationSeconds > 0) {
      lines.push(
        `      <itunes:duration>${itunesDuration(item.durationSeconds)}</itunes:duration>`,
      );
    }
    // Apple traktuje brak <itunes:explicit> na odcinku jako dziedziczenie z
    // kanału; emitujemy jawnie, żeby wpis nie zależał od interpretacji.
    lines.push(
      `      <itunes:explicit>${yesNo(item.explicit ?? channelExplicit)}</itunes:explicit>`,
    );
    lines.push(
      `      <itunes:episodeType>${xmlEscape(item.episodeType ?? "full")}</itunes:episodeType>`,
    );
    if (item.season != null) lines.push(`      <itunes:season>${item.season}</itunes:season>`);
    if (item.episodeNumber != null) {
      lines.push(`      <itunes:episode>${item.episodeNumber}</itunes:episode>`);
    }
    if (item.imageUrl?.trim()) {
      lines.push(`      <itunes:image href="${xmlEscape(item.imageUrl.trim())}"/>`);
    }
    if (author) lines.push(`      <itunes:author>${xmlEscape(author)}</itunes:author>`);
    lines.push("    </item>");
    return lines.join("\n");
  });

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:content="http://purl.org/rss/1.0/modules/content/">`,
    `  <channel>`,
    `    <title>${xmlEscape(input.title)}</title>`,
    `    <link>${xmlEscape(input.siteUrl)}</link>`,
    `    <description>${xmlEscape(input.description)}</description>`,
    `    <language>${xmlEscape(input.language)}</language>`,
    `    <itunes:summary>${xmlEscape(input.description)}</itunes:summary>`,
    `    <atom:link href="${xmlEscape(input.feedUrl)}" rel="self" type="application/rss+xml"/>`,
    // ── Tagi WYMAGANE przez Apple Podcasts Connect ─────────────────────────
    `    <itunes:explicit>${yesNo(channelExplicit)}</itunes:explicit>`,
    `    <itunes:type>${xmlEscape(input.showType ?? "episodic")}</itunes:type>`,
    ...(subcategory
      ? [
          `    <itunes:category text="${xmlEscape(category)}">`,
          `      <itunes:category text="${xmlEscape(subcategory)}"/>`,
          `    </itunes:category>`,
        ]
      : [`    <itunes:category text="${xmlEscape(category)}"/>`]),
    ...(channelImage ? [`    <itunes:image href="${xmlEscape(channelImage)}"/>`] : []),
    // ── Zalecane / potrzebne do weryfikacji własności ───────────────────────
    ...(author ? [`    <itunes:author>${xmlEscape(author)}</itunes:author>`] : []),
    ...(ownerName || ownerEmail
      ? [
          `    <itunes:owner>`,
          ...(ownerName ? [`      <itunes:name>${xmlEscape(ownerName)}</itunes:name>`] : []),
          ...(ownerEmail ? [`      <itunes:email>${xmlEscape(ownerEmail)}</itunes:email>`] : []),
          `    </itunes:owner>`,
        ]
      : []),
    // managingEditor/webMaster to standardowe pola RSS 2.0 czytane przez
    // walidatory katalogów - używamy tego samego adresu kontaktowego.
    ...(ownerEmail
      ? [
          `    <managingEditor>${xmlEscape(ownerEmail)}${ownerName ? ` (${xmlEscape(ownerName)})` : ""}</managingEditor>`,
        ]
      : []),
    ...(input.complete ? [`    <itunes:complete>yes</itunes:complete>`] : []),
    ...(newest
      ? [`    <lastBuildDate>${newest}</lastBuildDate>`, `    <pubDate>${newest}</pubDate>`]
      : []),
    ...(input.copyright ? [`    <copyright>${xmlEscape(input.copyright)}</copyright>`] : []),
    `    <ttl>60</ttl>`,
    ...itemXml,
    `  </channel>`,
    `</rss>`,
  ].join("\n");
}

export { DEFAULT_APPLE_CATEGORY, DEFAULT_APPLE_SUBCATEGORY };
