// Podcast types + duration helpers (shared client/server).
import { z } from "zod";

export const PodcastStatus = z.enum(["draft", "published", "archived"]);
export type PodcastStatus = z.infer<typeof PodcastStatus>;

export const PodcastSchema = z.object({
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
  created_at: z.string(),
  updated_at: z.string(),
});
export type Podcast = z.infer<typeof PodcastSchema>;

export const PodcastSettingsSchema = z.object({
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
