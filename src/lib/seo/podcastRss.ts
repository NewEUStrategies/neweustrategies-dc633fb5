// Pure RSS 2.0 + iTunes builder for the podcast feed (/podcast/rss.xml).
// Unlike the site feed, podcast items carry an <enclosure> (the audio file) and
// the iTunes namespace tags that Apple/Spotify require to ingest a show.
// Framework-free and unit-testable; the route only assembles input + headers.
import { xmlEscape, plainText, rfc822Date } from "./rss";

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
}

export interface PodcastRssChannelInput {
  title: string;
  description: string;
  siteUrl: string;
  feedUrl: string;
  language: string;
  copyright?: string | null;
  imageUrl?: string | null;
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

export function buildPodcastRssXml(input: PodcastRssChannelInput): string {
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
    if (item.season != null) lines.push(`      <itunes:season>${item.season}</itunes:season>`);
    if (item.episodeNumber != null) {
      lines.push(`      <itunes:episode>${item.episodeNumber}</itunes:episode>`);
    }
    if (item.imageUrl?.trim()) {
      lines.push(`      <itunes:image href="${xmlEscape(item.imageUrl.trim())}"/>`);
    }
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
    ...(input.imageUrl?.trim()
      ? [`    <itunes:image href="${xmlEscape(input.imageUrl.trim())}"/>`]
      : []),
    ...(newest ? [`    <lastBuildDate>${newest}</lastBuildDate>`] : []),
    ...(input.copyright ? [`    <copyright>${xmlEscape(input.copyright)}</copyright>`] : []),
    `    <ttl>60</ttl>`,
    ...itemXml,
    `  </channel>`,
    `</rss>`,
  ].join("\n");
}
