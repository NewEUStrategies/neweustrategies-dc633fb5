// Rejestr personalizacji rozmów: normalizacja wartości z DB, mapowanie na
// klasy CSS oraz STRAŻNIK parytetu trzech źródeł prawdy - klienckich
// whitelist (themes.ts), CHECK-ów w migracji SQL i klas motywów/tapet w
// styles.css. Dryf którejkolwiek listy = czerwony test, nie cichy fallback.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  CHAT_THEMES,
  CHAT_WALLPAPERS,
  DB_CHAT_THEMES,
  DB_CHAT_WALLPAPERS,
  DEFAULT_QUICK_EMOJI,
  QUICK_EMOJI_CHOICES,
  normalizeQuickEmoji,
  normalizeTheme,
  normalizeWallpaper,
  themeClass,
  themeDbValue,
  themeLabelKey,
  wallpaperClass,
  wallpaperDbValue,
  wallpaperLabelKey,
} from "../themes";
import { chatEn, chatPl } from "../../i18n-chat";

// Ścieżki względem korzenia repo (tak jak brandContrast.test.ts).
const migration = readFileSync(
  "supabase/migrations/20260716090000_chat_conversation_personalization.sql",
  "utf8",
);
const css = readFileSync("src/styles.css", "utf8");

describe("chat themes registry", () => {
  it("registry = default + DB whitelist, without duplicates", () => {
    expect(CHAT_THEMES[0]).toBe("default");
    expect(CHAT_THEMES.slice(1)).toEqual([...DB_CHAT_THEMES]);
    expect(new Set(CHAT_THEMES).size).toBe(CHAT_THEMES.length);
    expect(CHAT_WALLPAPERS[0]).toBe("dots");
    expect(CHAT_WALLPAPERS.slice(1)).toEqual([...DB_CHAT_WALLPAPERS]);
    expect(new Set(CHAT_WALLPAPERS).size).toBe(CHAT_WALLPAPERS.length);
  });

  it("mirrors the DB CHECK constraint for themes", () => {
    const check =
      /conversations_theme_check\s+CHECK \(theme IS NULL OR theme IN\s*\(([^)]+)\)/m.exec(
        migration,
      );
    expect(check).not.toBeNull();
    const dbList = [...(check?.[1] ?? "").matchAll(/'([a-z]+)'/g)].map((m) => m[1]).sort();
    expect(dbList).toEqual([...DB_CHAT_THEMES].sort());
  });

  it("mirrors the DB CHECK constraint for wallpapers", () => {
    const check =
      /conversations_wallpaper_check\s+CHECK \(wallpaper IS NULL OR wallpaper IN \(([^)]+)\)/m.exec(
        migration,
      );
    expect(check).not.toBeNull();
    const dbList = [...(check?.[1] ?? "").matchAll(/'([a-z]+)'/g)].map((m) => m[1]).sort();
    expect(dbList).toEqual([...DB_CHAT_WALLPAPERS].sort());
  });

  it("every non-default theme has light and dark CSS classes", () => {
    for (const id of DB_CHAT_THEMES) {
      expect(css, `styles.css: brak .chat-theme-${id}`).toMatch(
        new RegExp(`^\\.chat-theme-${id} \\{`, "m"),
      );
      expect(css, `styles.css: brak .dark .chat-theme-${id}`).toMatch(
        new RegExp(`^\\.dark \\.chat-theme-${id} \\{`, "m"),
      );
    }
  });

  it("every non-dots wallpaper has a CSS class", () => {
    for (const id of DB_CHAT_WALLPAPERS) {
      expect(css, `styles.css: brak .chat-wallpaper-${id}`).toContain(`.chat-wallpaper-${id}`);
    }
  });

  it("has PL and EN labels for every theme and wallpaper", () => {
    interface AppearanceBundle {
      chat: {
        appearance: { themes: Record<string, string>; wallpapers: Record<string, string> };
      };
    }
    for (const bundle of [chatPl as AppearanceBundle, chatEn as AppearanceBundle]) {
      for (const id of CHAT_THEMES) {
        expect(bundle.chat.appearance.themes[id], `brak etykiety motywu ${id}`).toBeTruthy();
      }
      for (const id of CHAT_WALLPAPERS) {
        expect(bundle.chat.appearance.wallpapers[id], `brak etykiety tapety ${id}`).toBeTruthy();
      }
    }
  });

  it("normalizes unknown/legacy DB values to defaults", () => {
    expect(normalizeTheme(null)).toBe("default");
    expect(normalizeTheme(undefined)).toBe("default");
    expect(normalizeTheme("neon-z-2019")).toBe("default");
    expect(normalizeTheme("ocean")).toBe("ocean");
    expect(normalizeWallpaper(null)).toBe("dots");
    expect(normalizeWallpaper("marmur")).toBe("dots");
    expect(normalizeWallpaper("soft")).toBe("soft");
  });

  it("normalizes quick emoji with a safe default", () => {
    expect(normalizeQuickEmoji(null)).toBe(DEFAULT_QUICK_EMOJI);
    expect(normalizeQuickEmoji("  ")).toBe(DEFAULT_QUICK_EMOJI);
    expect(normalizeQuickEmoji("🔥")).toBe("🔥");
    expect(normalizeQuickEmoji("x".repeat(17))).toBe(DEFAULT_QUICK_EMOJI);
    expect(QUICK_EMOJI_CHOICES).toContain(DEFAULT_QUICK_EMOJI);
  });

  it("maps ids to CSS classes and DB payload values", () => {
    expect(themeClass("default")).toBeUndefined();
    expect(themeClass("ocean")).toBe("chat-theme-ocean");
    expect(wallpaperClass("dots")).toBe("chat-wallpaper chat-wallpaper-dots");
    expect(wallpaperClass("soft")).toBe("chat-wallpaper chat-wallpaper-soft");
    expect(wallpaperClass("none")).toBe("chat-wallpaper-none");
    expect(themeDbValue("default")).toBeNull();
    expect(themeDbValue("forest")).toBe("forest");
    expect(wallpaperDbValue("dots")).toBeNull();
    expect(wallpaperDbValue("lines")).toBe("lines");
    expect(themeLabelKey("rose")).toBe("chat.appearance.themes.rose");
    expect(wallpaperLabelKey("none")).toBe("chat.appearance.wallpapers.none");
  });
});
