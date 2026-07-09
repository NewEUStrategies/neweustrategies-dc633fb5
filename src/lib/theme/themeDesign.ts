// Global "Theme Design" tokens - block headings, thumbnails, "Read more"
// button, and meta-info text styles. Single source of truth shared by every
// widget/post-card across the site.
//
// Stored in `site_settings` under key `theme_design`. Applied via
// <ThemeDesignStyle /> as CSS variables under `--td-*` that components reference
// through utility classes (e.g. `.cms-block-heading`, `.cms-read-more`).
import { toJson } from "@/lib/builder/types";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { z } from "zod";
import { deepMerge } from "@/lib/deepMerge";
import { siteSettingsQueryOptions } from "@/lib/useSiteSetting";

const PX = z
  .union([z.number(), z.string()])
  .transform((v) => (typeof v === "number" ? `${v}px` : v));
const COLOR = z.string().min(1);

// All color defaults inherit - in order - from the sibling Theme Options
// tabs (Global kolory, Tła motywu, Przyciski, Pola tekstowe, Kolory ikon,
// Kolory linków, Kolory pól tekstowych) via `--gc-*` CSS variables, with a
// themed shadcn token as a last-resort fallback. Global Colors already emit
// per-mode `.light` / `.dark` overrides, so Theme Design values automatically
// flip in CMS canvases and public pages without hard-coded copies.
export const THEME_DESIGN_COLOR_INHERITANCE = {
  blockHeading: {
    color: { token: "var(--gc-body-text, var(--foreground))", hint: "Kolory pól tekstowych" },
  },
  readMoreButton: {
    bgColor: { token: "transparent", hint: "Przezroczyste" },
    color: { token: "var(--gc-btn-bg, var(--brand))", hint: "Przyciski - tło" },
    borderColor: { token: "var(--gc-btn-bg, var(--brand))", hint: "Przyciski - tło" },
  },
  metaInfo: {
    color: {
      token: "var(--gc-body-text-muted, var(--muted-foreground))",
      hint: "Kolory pól tekstowych (muted)",
    },
  },
  toolbarButton: {
    bgColor: { token: "var(--gc-input-bg, var(--muted))", hint: "Pola tekstowe - tło" },
    color: { token: "var(--gc-body-text, var(--foreground))", hint: "Kolory pól tekstowych" },
    hoverBgColor: {
      token: "var(--gc-input-hover-bg, color-mix(in oklab, var(--gc-input-bg, var(--muted)) 70%, transparent))",
      hint: "Pola tekstowe - hover",
    },
    hoverColor: {
      token: "var(--gc-body-text, var(--foreground))",
      hint: "Kolory pól tekstowych",
    },
    activeBgColor: { token: "var(--gc-btn-bg, #fa9346)", hint: "Przyciski - tło" },
    activeColor: { token: "var(--gc-btn-text, #ffffff)", hint: "Przyciski - tekst" },
  },
  modeSwitcher: {
    trackBg: { token: "var(--gc-input-bg, var(--muted))", hint: "Pola tekstowe - tło" },
    trackBorder: { token: "var(--gc-input-border, var(--border))", hint: "Pola tekstowe - obramowanie" },
    inactiveColor: {
      token: "var(--gc-body-text-muted, var(--muted-foreground))",
      hint: "Kolory pól tekstowych (muted)",
    },
    activeBg: { token: "var(--gc-surface-bg, var(--background))", hint: "Tła motywu - surface" },
    activeColor: { token: "var(--gc-body-text, var(--foreground))", hint: "Kolory pól tekstowych" },
  },
  socialIcons: {
    color: { token: "var(--gc-icon, var(--foreground))", hint: "Kolory ikon" },
    hoverColor: { token: "var(--gc-icon-hover, var(--brand))", hint: "Kolory ikon - hover" },
    bgColor: { token: "transparent", hint: "Przezroczyste" },
    hoverBgColor: { token: "transparent", hint: "Przezroczyste" },
  },
  listIndex: {
    colorLight: { token: "var(--gc-body-text, #231f20)", hint: "Kolory pól tekstowych" },
    colorDark: { token: "var(--gc-highlight, #fa9346)", hint: "Global kolory - highlight" },
  },
  postTitle: {
    color: { token: "var(--gc-body-text, var(--foreground))", hint: "Kolory pól tekstowych" },
    hoverColor: { token: "var(--gc-link-hover, var(--brand))", hint: "Kolory linków - hover" },
  },
  postExcerpt: {
    color: {
      token: "var(--gc-body-text-muted, var(--muted-foreground))",
      hint: "Kolory pól tekstowych (muted)",
    },
  },
} as const;

const ThemeDesignSchema = z
  .object({
    blockHeading: z
      .object({
        fontSize: PX.default("18px"),
        fontWeight: z.number().min(100).max(900).default(700),
        color: COLOR.default(THEME_DESIGN_COLOR_INHERITANCE.blockHeading.color.token),
        textTransform: z.enum(["none", "uppercase", "lowercase", "capitalize"]).default("none"),
        letterSpacing: PX.default("0px"),
        marginBottom: PX.default("16px"),
        underline: z.enum(["none", "left", "full", "dotted"]).default("none"),
      })
      .default({}),
    thumbnail: z
      .object({
        radius: PX.default("8px"),
        aspectRatio: z.string().default("16/9"),
        hoverEffect: z.enum(["none", "zoom", "fade", "slide"]).default("zoom"),
        shadow: z.enum(["none", "sm", "md", "lg"]).default("none"),
      })
      .default({}),
    readMoreButton: z
      .object({
        // Inherits from the "Przyciski" tab.
        bgColor: COLOR.default(THEME_DESIGN_COLOR_INHERITANCE.readMoreButton.bgColor.token),
        color: COLOR.default(THEME_DESIGN_COLOR_INHERITANCE.readMoreButton.color.token),
        borderColor: COLOR.default(THEME_DESIGN_COLOR_INHERITANCE.readMoreButton.borderColor.token),
        radius: PX.default("9999px"),
        paddingX: PX.default("16px"),
        paddingY: PX.default("8px"),
        fontWeight: z.number().min(100).max(900).default(600),
        uppercase: z.boolean().default(false),
        arrow: z.boolean().default(true),
      })
      .default({}),
    metaInfo: z
      .object({
        // Inherits from "Kolory pól tekstowych" (muted body text).
        fontSize: PX.default("13px"),
        color: COLOR.default(THEME_DESIGN_COLOR_INHERITANCE.metaInfo.color.token),
        uppercase: z.boolean().default(false),
        gap: PX.default("12px"),
        separator: z.enum(["dot", "slash", "pipe", "none"]).default("dot"),
      })
      .default({}),
    toolbarButton: z
      .object({
        // Toolbar surface inherits from "Pola tekstowe"; active state from "Przyciski".
        bgColor: COLOR.default(THEME_DESIGN_COLOR_INHERITANCE.toolbarButton.bgColor.token),
        color: COLOR.default(THEME_DESIGN_COLOR_INHERITANCE.toolbarButton.color.token),
        hoverBgColor: COLOR.default(THEME_DESIGN_COLOR_INHERITANCE.toolbarButton.hoverBgColor.token),
        hoverColor: COLOR.default(THEME_DESIGN_COLOR_INHERITANCE.toolbarButton.hoverColor.token),
        activeBgColor: COLOR.default(THEME_DESIGN_COLOR_INHERITANCE.toolbarButton.activeBgColor.token),
        activeColor: COLOR.default(THEME_DESIGN_COLOR_INHERITANCE.toolbarButton.activeColor.token),
        radius: PX.default("6px"),
        paddingX: PX.default("8px"),
        paddingY: PX.default("6px"),
        size: PX.default("16px"),
      })
      .default({}),
    modeSwitcher: z
      .object({
        // Track = "Pola tekstowe", inactive = "Kolory pól tekstowych" muted,
        // active surface = "Tła motywu", active text = body text.
        trackBg: COLOR.default(THEME_DESIGN_COLOR_INHERITANCE.modeSwitcher.trackBg.token),
        trackBorder: COLOR.default(THEME_DESIGN_COLOR_INHERITANCE.modeSwitcher.trackBorder.token),
        inactiveColor: COLOR.default(THEME_DESIGN_COLOR_INHERITANCE.modeSwitcher.inactiveColor.token),
        activeBg: COLOR.default(THEME_DESIGN_COLOR_INHERITANCE.modeSwitcher.activeBg.token),
        activeColor: COLOR.default(THEME_DESIGN_COLOR_INHERITANCE.modeSwitcher.activeColor.token),
        radius: PX.default("6px"),
        showLabel: z.boolean().default(true),
      })
      .default({}),
    socialIcons: z
      .object({
        // Inherits from "Kolory ikon".
        color: COLOR.default(THEME_DESIGN_COLOR_INHERITANCE.socialIcons.color.token),
        hoverColor: COLOR.default(THEME_DESIGN_COLOR_INHERITANCE.socialIcons.hoverColor.token),
        bgColor: COLOR.default(THEME_DESIGN_COLOR_INHERITANCE.socialIcons.bgColor.token),
        hoverBgColor: COLOR.default(THEME_DESIGN_COLOR_INHERITANCE.socialIcons.hoverBgColor.token),
        size: PX.default("18px"),
        gap: PX.default("8px"),
        radius: PX.default("9999px"),
        paddingX: PX.default("6px"),
        paddingY: PX.default("6px"),
      })
      .default({}),
    listIndex: z
      .object({
        // Global defaults for "numbered" / "ranked" post-list variants.
        // Used when the individual widget does not override colors.
        colorLight: COLOR.default(THEME_DESIGN_COLOR_INHERITANCE.listIndex.colorLight.token),
        colorDark: COLOR.default(THEME_DESIGN_COLOR_INHERITANCE.listIndex.colorDark.token),
        opacity: z.number().min(0).max(1).default(0.18),
        weight: z.number().min(100).max(900).default(800),
      })
      .default({}),
    postTitle: z
      .object({
        // Unified title styling shared by every post card / list / slider / grid widget.
        // Inherits body text color; hover follows "Kolory linków".
        fontFamily: z
          .string()
          .default('"Red Hat Display", system-ui, -apple-system, Segoe UI, sans-serif'),
        fontSize: PX.default("15px"),
        fontSizeSm: PX.default("14px"),
        fontWeight: z.number().min(100).max(900).default(600),
        lineHeight: z.union([z.number(), z.string()]).default(1.3),
        color: COLOR.default(THEME_DESIGN_COLOR_INHERITANCE.postTitle.color.token),
        hoverColor: COLOR.default(THEME_DESIGN_COLOR_INHERITANCE.postTitle.hoverColor.token),
        textTransform: z.enum(["none", "uppercase", "lowercase", "capitalize"]).default("none"),
        letterSpacing: PX.default("0px"),
      })
      .default({}),
    postExcerpt: z
      .object({
        // Inherits from "Kolory pól tekstowych" (muted body text).
        fontFamily: z
          .string()
          .default('"Red Hat Display", system-ui, -apple-system, Segoe UI, sans-serif'),
        fontSize: PX.default("13px"),
        fontWeight: z.number().min(100).max(900).default(400),
        lineHeight: z.union([z.number(), z.string()]).default(1.5),
        color: COLOR.default(THEME_DESIGN_COLOR_INHERITANCE.postExcerpt.color.token),
        marginTop: PX.default("6px"),
      })
      .default({}),
    // Optional per-mode dark overrides. Shape mirrors the sibling sections
    // above but only for color-typed fields. An empty string means "inherit
    // the light value" (which itself may reference a global token like
    // var(--foreground) / var(--brand) / var(--gc-input-*), so dark mode of
    // the site's global tokens still kicks in automatically).
    darkOverrides: z
      .record(z.string(), z.record(z.string(), z.string()))
      .default({}),
  })
  .default({});


export type ThemeDesign = z.infer<typeof ThemeDesignSchema>;

export const THEME_DESIGN_DEFAULTS: ThemeDesign = ThemeDesignSchema.parse({});

const LEGACY_INHERIT_VALUES: Record<string, Record<string, readonly string[]>> = {
  blockHeading: {
    color: ["var(--foreground)", "hsl(var(--foreground))", "#141414", "#231f20", "#1f2937", "oklch(0.18 0 0)"],
  },
  readMoreButton: {
    bgColor: ["transparent"],
    color: ["var(--brand)", "var(--primary)", "hsl(var(--primary))", "#fa9346", "#f59e0b"],
    borderColor: ["var(--brand)", "var(--primary)", "hsl(var(--primary))", "#fa9346", "#f59e0b"],
  },
  metaInfo: {
    color: ["var(--muted-foreground)", "hsl(var(--muted-foreground))", "#6b7280", "#71717a", "#9ca3af"],
  },
  toolbarButton: {
    bgColor: ["var(--muted)", "hsl(var(--muted))", "#f4f4ef", "#1f1f1f"],
    color: ["var(--foreground)", "hsl(var(--foreground))", "#141414", "#f8f6f4", "#ffffff"],
    hoverBgColor: [
      "color-mix(in oklab, var(--muted) 70%, transparent)",
      "color-mix(in oklab, var(--gc-input-bg, var(--muted)) 70%, transparent)",
    ],
    hoverColor: ["var(--foreground)", "hsl(var(--foreground))", "#141414", "#ffffff"],
    activeBgColor: ["var(--brand)", "var(--primary)", "#fa9346", "#f59e0b"],
    activeColor: ["var(--primary-foreground)", "#ffffff", "#fff"],
  },
  modeSwitcher: {
    trackBg: ["var(--muted)", "hsl(var(--muted))", "#f4f4ef", "#1f1f1f"],
    trackBorder: ["var(--border)", "hsl(var(--border))", "#e2e8f0", "#1f1f1f"],
    inactiveColor: ["var(--muted-foreground)", "hsl(var(--muted-foreground))", "#6b7280", "#9ca3af"],
    activeBg: ["var(--background)", "hsl(var(--background))", "#ffffff", "#0f0f0f", "#141414"],
    activeColor: ["var(--foreground)", "hsl(var(--foreground))", "#141414", "#ffffff"],
  },
  socialIcons: {
    color: ["var(--foreground)", "hsl(var(--foreground))", "#141414", "#ffffff", "#6b7280"],
    hoverColor: ["var(--brand)", "var(--primary)", "#fa9346", "#fdb078", "#f59e0b"],
    bgColor: ["transparent"],
    hoverBgColor: ["transparent"],
  },
  listIndex: {
    colorLight: ["#231f20", "#141414", "var(--foreground)", "hsl(var(--foreground))"],
    colorDark: ["#fa9346", "#f59e0b", "var(--brand)", "var(--primary)", "var(--gc-highlight)"],
  },
  postTitle: {
    color: ["var(--foreground)", "hsl(var(--foreground))", "#141414", "#231f20", "#1f2937"],
    hoverColor: ["var(--brand)", "var(--primary)", "#fa9346", "#fdb078", "#f59e0b"],
  },
  postExcerpt: {
    color: ["var(--muted-foreground)", "hsl(var(--muted-foreground))", "#6b7280", "#71717a", "#9ca3af"],
  },
};

function canonicalColorValue(value: string): string {
  return normalizeColor(value).trim().toLowerCase().replace(/\s+/g, "");
}

function isLegacyInheritedColor(section: string, field: string, value: string): boolean {
  const legacy = LEGACY_INHERIT_VALUES[section]?.[field] ?? [];
  const current = canonicalColorValue(value);
  return legacy.some((entry) => canonicalColorValue(entry) === current);
}

function normalizeLegacyInheritedColors(t: ThemeDesign): ThemeDesign {
  const inheritanceMap: Record<string, Record<string, { token: string; hint: string }>> = THEME_DESIGN_COLOR_INHERITANCE;
  for (const section of Object.keys(inheritanceMap)) {
    const sectionRecord = t[section as keyof ThemeDesign] as Record<string, unknown>;
    const inheritance = inheritanceMap[section];
    for (const field of Object.keys(inheritance)) {
      const current = sectionRecord[field];
      const target = inheritance[field].token;
      if (
        typeof current === "string" &&
        canonicalColorValue(current) !== canonicalColorValue(target) &&
        isLegacyInheritedColor(section, field, current)
      ) {
        sectionRecord[field] = target;
      }
      const overrideSection = t.darkOverrides?.[section];
      const override = overrideSection?.[field];
      if (overrideSection && typeof override === "string" && isLegacyInheritedColor(section, field, override)) {
        delete overrideSection[field];
      }
    }
    if (t.darkOverrides?.[section] && Object.keys(t.darkOverrides[section]).length === 0) {
      delete t.darkOverrides[section];
    }
  }
  return t;
}

const KEY = "theme_design";
const KEY_EN = "theme_design_en";
const KEY_LANG_MODE = "theme_design_lang_mode";
const QUERY_KEY = ["site_settings", KEY] as const;
const QUERY_KEY_EN = ["site_settings", KEY_EN] as const;
const QUERY_KEY_LANG_MODE = ["site_settings", KEY_LANG_MODE] as const;

export type ThemeDesignLang = "pl" | "en";
export type ThemeDesignLangMode = "shared" | "split";
export interface ThemeDesignLangSettings {
  mode: ThemeDesignLangMode;
}
export const THEME_DESIGN_LANG_DEFAULTS: ThemeDesignLangSettings = { mode: "shared" };

function loadFromMap(map: Record<string, unknown>, key: string): ThemeDesign {
  const raw = map[key] ?? {};
  const merged = deepMerge(THEME_DESIGN_DEFAULTS, raw as Record<string, unknown>);
  const parsed = ThemeDesignSchema.safeParse(merged);
  return parsed.success ? normalizeLegacyInheritedColors(parsed.data) : THEME_DESIGN_DEFAULTS;
}

export function useThemeDesign() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async ({ client }): Promise<ThemeDesign> => {
      const settings = await client.ensureQueryData(siteSettingsQueryOptions);
      return loadFromMap(settings as Record<string, unknown>, KEY);
    },
    staleTime: 5 * 60_000,
  });
}

export function useThemeDesignEn() {
  return useQuery({
    queryKey: QUERY_KEY_EN,
    queryFn: async ({ client }): Promise<ThemeDesign> => {
      const settings = await client.ensureQueryData(siteSettingsQueryOptions);
      return loadFromMap(settings as Record<string, unknown>, KEY_EN);
    },
    staleTime: 5 * 60_000,
  });
}

export function useThemeDesignLangMode() {
  return useQuery({
    queryKey: QUERY_KEY_LANG_MODE,
    queryFn: async ({ client }): Promise<ThemeDesignLangSettings> => {
      const settings = await client.ensureQueryData(siteSettingsQueryOptions);
      const raw = (settings as Record<string, unknown>)[KEY_LANG_MODE];
      const mode =
        raw && typeof raw === "object" && (raw as { mode?: string }).mode === "split"
          ? "split"
          : "shared";
      return { mode };
    },
    staleTime: 5 * 60_000,
  });
}

/** Effective Theme Design for a UI language.
 *  - shared mode: always returns the base (PL) row - one source of truth
 *  - split mode + lang=en: returns the EN row, falling back to PL if EN empty */
export function useThemeDesignFor(lang: ThemeDesignLang): ThemeDesign {
  const pl = useThemeDesign().data ?? THEME_DESIGN_DEFAULTS;
  const en = useThemeDesignEn().data ?? THEME_DESIGN_DEFAULTS;
  const mode = useThemeDesignLangMode().data?.mode ?? "shared";
  if (mode === "split" && lang === "en") return en;
  return pl;
}

export function useSaveThemeDesign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ next, lang }: { next: ThemeDesign; lang?: ThemeDesignLang }) => {
      const key = lang === "en" ? KEY_EN : KEY;
      const { error } = await supabase
        .from("site_settings")
        .upsert({ key, value: toJson(next) }, { onConflict: "key" });
      if (error) throw error;
      return { next, lang };
    },
    onSuccess: ({ next, lang }) => {
      qc.setQueryData(lang === "en" ? QUERY_KEY_EN : QUERY_KEY, next);
      qc.invalidateQueries({ queryKey: ["site_settings_public", "all"] });
      toast.success(lang === "en" ? "Zapisano Theme Design (EN)" : "Zapisano Theme Design");
    },
    onError: (e: Error) => toast.error(e.message || "Błąd zapisu"),
  });
}

export function useSaveThemeDesignLangMode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (next: ThemeDesignLangSettings) => {
      const { error } = await supabase
        .from("site_settings")
        .upsert({ key: KEY_LANG_MODE, value: toJson(next) }, { onConflict: "key" });
      if (error) throw error;
      return next;
    },
    onSuccess: (next) => {
      qc.setQueryData(QUERY_KEY_LANG_MODE, next);
      qc.invalidateQueries({ queryKey: ["site_settings_public", "all"] });
      toast.success(
        next.mode === "split"
          ? "Styl treści: osobno dla PL i EN"
          : "Styl treści: wspólny dla PL i EN",
      );
    },
    onError: (e: Error) => toast.error(e.message || "Błąd zapisu"),
  });
}

/** Optimistically mirror an in-progress draft into the react-query cache so
 *  every consumer of useThemeDesign() / <ThemeDesignStyle /> reflects it live -
 *  including the CMS builder canvases (Gutenberg + Elementor-style). Restores
 *  the persisted value on unmount so unsaved drafts never leak. */
export function useLiveThemeDesignPreview(
  draft: ThemeDesign | null,
  enabled: boolean,
  lang: ThemeDesignLang = "pl",
) {
  const qc = useQueryClient();
  const key = lang === "en" ? QUERY_KEY_EN : QUERY_KEY;
  // Note: use useEffect via lazy import to keep this file framework-lean.
  // Callers already run in a React tree.
  useEffectLike(() => {
    if (!enabled || !draft) return;
    const prev = qc.getQueryData<ThemeDesign>(key);
    qc.setQueryData(key, draft);
    return () => {
      if (prev) qc.setQueryData(key, prev);
      else qc.invalidateQueries({ queryKey: key });
    };
    // draft object identity changes on every keystroke - that's the whole point
  }, [enabled, draft, lang, qc, key]);
}

// Tiny wrapper so this module doesn't need a top-level React import.
import { useEffect as useEffectLike } from "react";

/** Normalizes legacy shadcn-style `hsl(var(--x))` / `hsl(var(--x) / .5)` wrappers
 *  to bare `var(--x)` - our design tokens now hold ready-to-use color values
 *  (hex, oklch, color-mix), not raw HSL triplets, so wrapping them in `hsl()`
 *  produces invalid CSS ("hsl(#F8F6F4)") that browsers silently drop, leaving
 *  text unreadable in dark mode. Older DB rows still contain the wrapped form. */
function normalizeColor(c: string): string {
  return c.replace(/hsl\(\s*var\((--[a-z0-9-]+)\)(?:\s*\/\s*[^)]+)?\s*\)/gi, "var($1)");
}

/** Serializes the design tokens to CSS variables under `:root` for light mode,
 *  plus a `.dark` selector block for any per-field dark overrides. Empty
 *  overrides fall through to the light value (which itself may reference a
 *  themed token such as `var(--foreground)` that already flips with the site's
 *  global dark scheme). */
export function themeDesignToCss(t: ThemeDesign): string {
  const light: string[] = [];
  const dark: string[] = [];

  // Map: section.field -> css var name. Only color-typed fields need dark.
  const colorVars: Array<[keyof ThemeDesign, string, string]> = [
    ["blockHeading", "color", "--td-bh-color"],
    ["readMoreButton", "bgColor", "--td-rm-bg"],
    ["readMoreButton", "color", "--td-rm-color"],
    ["readMoreButton", "borderColor", "--td-rm-border"],
    ["metaInfo", "color", "--td-meta-color"],
    ["toolbarButton", "bgColor", "--td-tb-bg"],
    ["toolbarButton", "color", "--td-tb-color"],
    ["toolbarButton", "hoverBgColor", "--td-tb-hover-bg"],
    ["toolbarButton", "hoverColor", "--td-tb-hover-color"],
    ["toolbarButton", "activeBgColor", "--td-tb-active-bg"],
    ["toolbarButton", "activeColor", "--td-tb-active-color"],
    ["modeSwitcher", "trackBg", "--td-ms-track-bg"],
    ["modeSwitcher", "trackBorder", "--td-ms-track-border"],
    ["modeSwitcher", "inactiveColor", "--td-ms-inactive"],
    ["modeSwitcher", "activeBg", "--td-ms-active-bg"],
    ["modeSwitcher", "activeColor", "--td-ms-active-color"],
    ["socialIcons", "color", "--td-si-color"],
    ["socialIcons", "hoverColor", "--td-si-hover-color"],
    ["socialIcons", "bgColor", "--td-si-bg"],
    ["socialIcons", "hoverBgColor", "--td-si-hover-bg"],
    ["listIndex", "colorLight", "--td-li-light"],
    ["listIndex", "colorDark", "--td-li-dark"],
    ["postTitle", "color", "--td-pt-color"],
    ["postTitle", "hoverColor", "--td-pt-hover"],
    ["postExcerpt", "color", "--td-pe-color"],
  ];

  // Static (non-color) tokens.
  light.push(`--td-bh-size:${t.blockHeading.fontSize};`);
  light.push(`--td-bh-weight:${t.blockHeading.fontWeight};`);
  light.push(`--td-bh-transform:${t.blockHeading.textTransform};`);
  light.push(`--td-bh-spacing:${t.blockHeading.letterSpacing};`);
  light.push(`--td-bh-mb:${t.blockHeading.marginBottom};`);
  light.push(`--td-thumb-radius:${t.thumbnail.radius};`);
  light.push(`--td-thumb-ratio:${t.thumbnail.aspectRatio};`);
  light.push(`--td-thumb-shadow:${shadow(t.thumbnail.shadow)};`);
  light.push(`--td-rm-radius:${t.readMoreButton.radius};`);
  light.push(`--td-rm-px:${t.readMoreButton.paddingX};`);
  light.push(`--td-rm-py:${t.readMoreButton.paddingY};`);
  light.push(`--td-rm-weight:${t.readMoreButton.fontWeight};`);
  light.push(`--td-rm-transform:${t.readMoreButton.uppercase ? "uppercase" : "none"};`);
  light.push(`--td-meta-size:${t.metaInfo.fontSize};`);
  light.push(`--td-meta-transform:${t.metaInfo.uppercase ? "uppercase" : "none"};`);
  light.push(`--td-meta-gap:${t.metaInfo.gap};`);
  light.push(`--td-tb-radius:${t.toolbarButton.radius};`);
  light.push(`--td-tb-px:${t.toolbarButton.paddingX};`);
  light.push(`--td-tb-py:${t.toolbarButton.paddingY};`);
  light.push(`--td-tb-size:${t.toolbarButton.size};`);
  light.push(`--td-ms-radius:${t.modeSwitcher.radius};`);
  light.push(`--td-si-size:${t.socialIcons.size};`);
  light.push(`--td-si-gap:${t.socialIcons.gap};`);
  light.push(`--td-si-radius:${t.socialIcons.radius};`);
  light.push(`--td-si-px:${t.socialIcons.paddingX};`);
  light.push(`--td-si-py:${t.socialIcons.paddingY};`);
  light.push(`--td-li-opacity:${t.listIndex.opacity};`);
  light.push(`--td-li-weight:${t.listIndex.weight};`);
  light.push(`--td-pt-family:${t.postTitle.fontFamily};`);
  light.push(`--td-pt-size:${t.postTitle.fontSize};`);
  light.push(`--td-pt-size-sm:${t.postTitle.fontSizeSm};`);
  light.push(`--td-pt-weight:${t.postTitle.fontWeight};`);
  light.push(`--td-pt-lh:${t.postTitle.lineHeight};`);
  light.push(`--td-pt-transform:${t.postTitle.textTransform};`);
  light.push(`--td-pt-spacing:${t.postTitle.letterSpacing};`);
  light.push(`--td-pe-family:${t.postExcerpt.fontFamily};`);
  light.push(`--td-pe-size:${t.postExcerpt.fontSize};`);
  light.push(`--td-pe-weight:${t.postExcerpt.fontWeight};`);
  light.push(`--td-pe-lh:${t.postExcerpt.lineHeight};`);
  light.push(`--td-pe-mt:${t.postExcerpt.marginTop};`);

  // Color tokens - light from the section, dark from overrides when present.
  for (const [section, field, cssVar] of colorVars) {
    const sec = t[section] as Record<string, unknown>;
    const lightVal = sec?.[field];
    if (typeof lightVal === "string" && lightVal.length > 0) {
      light.push(`${cssVar}:${lightVal};`);
    }
    const darkVal = t.darkOverrides?.[section as string]?.[field];
    if (typeof darkVal === "string" && darkVal.length > 0) {
      dark.push(`${cssVar}:${darkVal};`);
    }
  }

  const parts = [`:root,.light{${light.join("")}}`];
  if (dark.length > 0) {
    parts.push(`.dark{${dark.join("")}}`);
  }
  return normalizeColor(parts.join(""));
}

/** Parses `themeDesignToCss` output into a React inline-style object of CSS
 *  variables for a given mode. Applying these on an element guarantees the
 *  browser re-computes styles that read `var(--td-*)` on every draft change -
 *  useful for admin previews where relying on `<style>` innerHTML updates has
 *  proven flaky (memoization, hydration, stale caches). */
export function themeDesignToStyleVars(
  t: ThemeDesign,
  mode: "light" | "dark" = "light",
): Record<string, string> {
  const css = themeDesignToCss(t);
  const out: Record<string, string> = {};
  const lightMatch = css.match(/:root,\.light\{([^}]*)\}/);
  if (lightMatch) {
    for (const decl of lightMatch[1].split(";")) {
      const [k, ...rest] = decl.split(":");
      const key = k.trim();
      const val = rest.join(":").trim();
      if (key.startsWith("--") && val.length > 0) out[key] = val;
    }
  }
  if (mode === "dark") {
    const darkMatch = css.match(/\.dark\{([^}]*)\}/);
    if (darkMatch) {
      for (const decl of darkMatch[1].split(";")) {
        const [k, ...rest] = decl.split(":");
        const key = k.trim();
        const val = rest.join(":").trim();
        if (key.startsWith("--") && val.length > 0) out[key] = val;
      }
    }
  }
  return out;
}

function shadow(level: "none" | "sm" | "md" | "lg"): string {
  switch (level) {
    case "sm":
      return "0 1px 2px 0 rgb(0 0 0 / .06)";
    case "md":
      return "0 4px 12px -2px rgb(0 0 0 / .12)";
    case "lg":
      return "0 12px 32px -6px rgb(0 0 0 / .18)";
    default:
      return "none";
  }
}

