// Podcast types + duration helpers (shared client/server).
//
// Model danych "sieci programów" (wzorzec RUSI/CSIS):
//   program (PodcastShow) -> sezony -> odcinki (Podcast)
//   odcinek: prowadzący/goście (PodcastPerson), rozdziały (PodcastChapter),
//   cytaty (PodcastQuote), źródła/materiały (PodcastResource), transkrypcja.
import { z } from "zod";

export const PodcastStatus = z.enum(["draft", "published", "archived"]);
export type PodcastStatus = z.infer<typeof PodcastStatus>;

const PodcastSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  slug: z.string().min(1),
  title_pl: z.string(),
  title_en: z.string(),
  excerpt_pl: z.string(),
  excerpt_en: z.string(),
  show_notes_pl: z.string(),
  show_notes_en: z.string(),
  transcript_pl: z.string(),
  transcript_en: z.string(),
  audio_url: z.string().url(),
  duration_seconds: z.number().int().nonnegative(),
  episode_number: z.number().int().nullable(),
  season: z.number().int().nullable(),
  cover_image_url: z.string().nullable(),
  status: PodcastStatus,
  published_at: z.string().nullable(),
  author_id: z.string().uuid().nullable(),
  show_id: z.string().uuid().nullable(),
  category_id: z.string().uuid().nullable(),
  // Kolumny jsonb - kształt egzekwują parsery poniżej, nie rzutowanie z DB.
  chapters: z.unknown(),
  quotes: z.unknown(),
  resources: z.unknown(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Podcast = z.infer<typeof PodcastSchema>;

const PodcastShowSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  slug: z.string().min(1),
  title_pl: z.string(),
  title_en: z.string(),
  description_pl: z.string(),
  description_en: z.string(),
  cover_image_url: z.string().nullable(),
  spotify_url: z.string().nullable(),
  apple_url: z.string().nullable(),
  youtube_url: z.string().nullable(),
  sort_order: z.number().int(),
  status: PodcastStatus,
  created_at: z.string(),
  updated_at: z.string(),
});
export type PodcastShow = z.infer<typeof PodcastShowSchema>;

/** Uczestnik odcinka; profile_* dołączane z tabeli profiles, gdy powiązany. */
export interface PodcastPerson {
  id: string;
  episode_id: string;
  profile_id: string | null;
  display_name: string;
  role: "host" | "guest";
  url: string | null;
  sort_order: number;
  profile_slug?: string | null;
  profile_avatar_url?: string | null;
}

const ChapterSchema = z.object({
  start: z.number().nonnegative(),
  title_pl: z.string().default(""),
  title_en: z.string().default(""),
});
export type PodcastChapter = z.infer<typeof ChapterSchema>;

const QuoteSchema = z.object({
  text_pl: z.string().default(""),
  text_en: z.string().default(""),
  attribution: z.string().default(""),
});
export type PodcastQuote = z.infer<typeof QuoteSchema>;

export const ResourceKind = z.enum(["source", "related"]);
export type ResourceKind = z.infer<typeof ResourceKind>;

const ResourceSchema = z.object({
  label_pl: z.string().default(""),
  label_en: z.string().default(""),
  url: z.string().default(""),
  kind: ResourceKind.default("source"),
});
export type PodcastResource = z.infer<typeof ResourceSchema>;

/**
 * Defensywne parsery tablic jsonb: złe wpisy odpadają, zamiast wywracać UI.
 * Inline per typ (nie generyk) - `safeParse().data` niesie wtedy pełny typ
 * wyjściowy schematu (pola z `.default()` są wymagane po parsowaniu).
 */
export function parseChapters(value: unknown): PodcastChapter[] {
  if (!Array.isArray(value)) return [];
  const out: PodcastChapter[] = [];
  for (const item of value) {
    const parsed = ChapterSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out.sort((a, b) => a.start - b.start);
}

export function parseQuotes(value: unknown): PodcastQuote[] {
  if (!Array.isArray(value)) return [];
  const out: PodcastQuote[] = [];
  for (const item of value) {
    const parsed = QuoteSchema.safeParse(item);
    if (parsed.success && (parsed.data.text_pl.trim() || parsed.data.text_en.trim())) {
      out.push(parsed.data);
    }
  }
  return out;
}

export function parseResources(value: unknown): PodcastResource[] {
  if (!Array.isArray(value)) return [];
  const out: PodcastResource[] = [];
  for (const item of value) {
    const parsed = ResourceSchema.safeParse(item);
    if (parsed.success && parsed.data.url.trim()) out.push(parsed.data);
  }
  return out;
}

const PodcastSettingsSchema = z.object({
  tenant_id: z.string().uuid(),
  default_player_variant: z.enum(["mini", "full", "sticky"]).default("full"),
  autoplay_next: z.boolean().default(false),
  show_speed_control: z.boolean().default(true),
  spotify_url: z.string().nullable().optional(),
  apple_url: z.string().nullable().optional(),
  google_url: z.string().nullable().optional(),
  rss_url: z.string().nullable().optional(),
});
export type PodcastSettings = z.infer<typeof PodcastSettingsSchema>;

/** Format seconds as `MM:SS` or `H:MM:SS`. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** Parse `HH:MM:SS` / `MM:SS` / `123` (seconds) to seconds. */
export function parseDuration(input: string): number {
  const t = (input ?? "").trim();
  if (!t) return 0;
  if (/^\d+$/.test(t)) return Number(t);
  const parts = t.split(":").map((p) => Number(p.trim()));
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return 0;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

export function podcastTitle(p: Pick<Podcast, "title_pl" | "title_en">, lang: "pl" | "en"): string {
  return (lang === "en" ? p.title_en : p.title_pl) || p.title_pl || p.title_en || "";
}

export function showTitle(
  s: Pick<PodcastShow, "title_pl" | "title_en">,
  lang: "pl" | "en",
): string {
  return (lang === "en" ? s.title_en : s.title_pl) || s.title_pl || s.title_en || "";
}

export function showDescription(
  s: Pick<PodcastShow, "description_pl" | "description_en">,
  lang: "pl" | "en",
): string {
  return (lang === "en" ? s.description_en : s.description_pl) || s.description_pl || "";
}

/** Rola uczestnika w języku UI. */
export function personRoleLabel(role: PodcastPerson["role"], lang: "pl" | "en"): string {
  if (role === "host") return lang === "en" ? "Host" : "Prowadzący";
  return lang === "en" ? "Guest" : "Gość";
}

export function podcastEpisodeLabel(
  p: Pick<Podcast, "season" | "episode_number">,
  lang: "pl" | "en",
): string | null {
  if (p.episode_number == null && p.season == null) return null;
  const s = p.season != null ? (lang === "en" ? `S${p.season}` : `Sezon ${p.season}`) : null;
  const e =
    p.episode_number != null
      ? lang === "en"
        ? `E${p.episode_number}`
        : `Odc. ${p.episode_number}`
      : null;
  return [s, e].filter(Boolean).join(" · ");
}
