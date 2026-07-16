// Conversation appearance registry (themes / wallpapers / quick emoji) -
// pure, dependency-free so the DB-whitelist parity test and every chat
// surface can import it without pulling the Supabase client.
//
// A theme is a named set of CSS custom properties (gradient stops of own
// bubbles, accent, read-tick color) declared in styles.css as
// `.chat-theme-<id>` for BOTH color schemes; components only ever attach the
// class, so dark mode and future themes stay a pure-CSS concern. `default`
// (brand orange) is represented as NULL in the DB - the whitelists below
// must mirror the CHECK constraints in
// supabase/migrations/20260716090000_chat_conversation_personalization.sql.

/** Themes stored in the DB (NULL = default). Mirrors conversations_theme_check. */
export const DB_CHAT_THEMES = [
  "ocean",
  "forest",
  "sunset",
  "orchid",
  "rose",
  "graphite",
  "midnight",
] as const;

export type ChatThemeId = "default" | (typeof DB_CHAT_THEMES)[number];

export const CHAT_THEMES: ReadonlyArray<ChatThemeId> = ["default", ...DB_CHAT_THEMES];

/** Wallpapers stored in the DB (NULL = default dots). Mirrors conversations_wallpaper_check. */
export const DB_CHAT_WALLPAPERS = ["soft", "lines", "none"] as const;

export type ChatWallpaperId = "dots" | (typeof DB_CHAT_WALLPAPERS)[number];

export const CHAT_WALLPAPERS: ReadonlyArray<ChatWallpaperId> = ["dots", ...DB_CHAT_WALLPAPERS];

/** Quick-send emoji when the conversation has none configured. */
export const DEFAULT_QUICK_EMOJI = "👍";

/** Curated choices for the appearance dialog (any single emoji is valid). */
export const QUICK_EMOJI_CHOICES: ReadonlyArray<string> = [
  "👍",
  "❤️",
  "🔥",
  "😂",
  "🎉",
  "🤝",
  "💪",
  "☕",
  "🚀",
  "🇪🇺",
];

/** Unknown/legacy DB values degrade to the default instead of breaking UI. */
export function normalizeTheme(raw: string | null | undefined): ChatThemeId {
  return (DB_CHAT_THEMES as ReadonlyArray<string>).includes(raw ?? "")
    ? (raw as ChatThemeId)
    : "default";
}

export function normalizeWallpaper(raw: string | null | undefined): ChatWallpaperId {
  return (DB_CHAT_WALLPAPERS as ReadonlyArray<string>).includes(raw ?? "")
    ? (raw as ChatWallpaperId)
    : "dots";
}

export function normalizeQuickEmoji(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim();
  return trimmed.length >= 1 && trimmed.length <= 16 ? trimmed : DEFAULT_QUICK_EMOJI;
}

/**
 * Class attached to the conversation surface. The default theme has no class
 * on purpose: it inherits the global --chat-user-* tokens from :root/.dark.
 */
export function themeClass(theme: ChatThemeId): string | undefined {
  return theme === "default" ? undefined : `chat-theme-${theme}`;
}

/** Class of the scrollable thread background. */
export function wallpaperClass(wallpaper: ChatWallpaperId): string {
  return wallpaper === "none"
    ? "chat-wallpaper-none"
    : `chat-wallpaper chat-wallpaper-${wallpaper}`;
}

/** i18n label key of a theme (chat.appearance.theme.<id>). */
export function themeLabelKey(theme: ChatThemeId): string {
  return `chat.appearance.themes.${theme}`;
}

/** i18n label key of a wallpaper (chat.appearance.wallpapers.<id>). */
export function wallpaperLabelKey(wallpaper: ChatWallpaperId): string {
  return `chat.appearance.wallpapers.${wallpaper}`;
}

/** DB payload value for a chosen theme (default -> NULL). */
export function themeDbValue(theme: ChatThemeId): string | null {
  return theme === "default" ? null : theme;
}

/** DB payload value for a chosen wallpaper (dots -> NULL). */
export function wallpaperDbValue(wallpaper: ChatWallpaperId): string | null {
  return wallpaper === "dots" ? null : wallpaper;
}
