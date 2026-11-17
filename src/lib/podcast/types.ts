// Podcast types + duration helpers (shared client/server).
//
// Model danych "sieci programów" (wzorzec RUSI/think-tank):
//   program (PodcastShow) -> sezony -> odcinki (Podcast)
//   odcinek: prowadzący/goście (PodcastPerson), rozdziały (PodcastChapter),
//   cytaty (PodcastQuote), źródła/materiały (PodcastResource), transkrypcja.
import { z } from "zod";

// TYPY WIERSZY, NIE SCHEMATY ZOD. Odcinek, program i ustawienia były dotąd
// obiektami `z.object(...)`, których nikt nigdy nie wywołał - służyły wyłącznie
// za źródło `z.infer`. Bundler nie umie dowieść, że budowa schematu nie ma
// skutków ubocznych, więc po zdjęciu nieużywanej nazwy zostawiał w chunku
// startowym klienta samo wywołanie (1,6 KB kodu wykonywanego przy każdym
// starcie strony, którego wyniku nikt nie czytał). Typy niżej są dokładnie
// tym, co dawało `z.infer` (aliasy obiektów, nie interfejsy - zachowują
// przypisywalność do `Record<string, unknown>`). Walidację kolumn jsonb robią
// jak dotąd parsery `parseChapters` / `parseQuotes` / `parseResources`.
export type PodcastStatus = "draft" | "published" | "archived";

export type Podcast = {
  id: string;
  tenant_id: string;
  slug: string;
  title_pl: string;
  title_en: string;
  excerpt_pl: string;
  excerpt_en: string;
  show_notes_pl: string;
  show_notes_en: string;
  transcript_pl: string;
  transcript_en: string;
  audio_url: string;
  duration_seconds: number;
  episode_number: number | null;
  season: number | null;
  cover_image_url: string | null;
  status: PodcastStatus;
  published_at: string | null;
  author_id: string | null;
  show_id: string | null;
  category_id: string | null;
  // Apple Podcasts: <itunes:explicit> i <itunes:episodeType> na elemencie
  // kanału (migracja 20260725090500).
  explicit: boolean;
  episode_type: PodcastEpisodeType;
  // Kolumny jsonb - kształt egzekwują parsery poniżej, nie rzutowanie z DB.
  chapters?: unknown;
  quotes?: unknown;
  resources?: unknown;
  created_at: string;
  updated_at: string;
};

export type PodcastShow = {
  id: string;
  tenant_id: string;
  slug: string;
  title_pl: string;
  title_en: string;
  description_pl: string;
  description_en: string;
  cover_image_url: string | null;
  spotify_url: string | null;
  apple_url: string | null;
  youtube_url: string | null;
  sort_order: number;
  status: PodcastStatus;
  created_at: string;
  updated_at: string;
};

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

export type PodcastSettings = {
  tenant_id: string;
  default_player_variant: "mini" | "full" | "sticky";
  autoplay_next: boolean;
  show_speed_control: boolean;
  spotify_url?: string | null;
  apple_url?: string | null;
  google_url?: string | null;
  rss_url?: string | null;
  // Metadane kanału wymagane przez Apple Podcasts Connect
  // (migracja 20260725090500). Emituje je `buildPodcastRssXml`; program
  // (`podcast_shows`) może każde z nich nadpisać.
  itunes_author?: string | null;
  itunes_owner_name?: string | null;
  itunes_owner_email?: string | null;
  itunes_category?: string | null;
  itunes_subcategory?: string | null;
  itunes_explicit: boolean;
  itunes_type: PodcastShowType;
  itunes_image_url?: string | null;
  itunes_copyright?: string | null;
};

/**
 * <itunes:type> kanału: "episodic" (najnowszy odcinek pierwszy) albo "serial"
 * (od pierwszego odcinka). Trzymany tu, a nie w builderze RSS, żeby formularze
 * panelu nie musiały importować generatora XML.
 */
export type PodcastShowType = "episodic" | "serial";

/** <itunes:episodeType> odcinka. */
export type PodcastEpisodeType = "full" | "trailer" | "bonus";

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

// `showTitle`/`showDescription` mieszkają w `showCopy.ts` (shell trasy
// `/podcasts/$show` czyta je w `head()` i nie może ciągnąć schematów zod).
export { showTitle, showDescription } from "./showCopy";

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
