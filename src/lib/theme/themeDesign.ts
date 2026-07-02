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

const PX = z.union([z.number(), z.string()]).transform((v) => (typeof v === "number" ? `${v}px` : v));
const COLOR = z.string().min(1);

export const ThemeDesignSchema = z.object({
  blockHeading: z.object({
    fontSize: PX.default("18px"),
    fontWeight: z.number().min(100).max(900).default(700),
    color: COLOR.default("var(--foreground)"),
    textTransform: z.enum(["none", "uppercase", "lowercase", "capitalize"]).default("none"),
    letterSpacing: PX.default("0px"),
    marginBottom: PX.default("16px"),
    underline: z.enum(["none", "left", "full", "dotted"]).default("none"),
  }).default({}),
  thumbnail: z.object({
    radius: PX.default("8px"),
    aspectRatio: z.string().default("16/9"),
    hoverEffect: z.enum(["none", "zoom", "fade", "slide"]).default("zoom"),
    shadow: z.enum(["none", "sm", "md", "lg"]).default("none"),
  }).default({}),
  readMoreButton: z.object({
    bgColor: COLOR.default("transparent"),
    color: COLOR.default("var(--brand)"),
    borderColor: COLOR.default("var(--brand)"),
    radius: PX.default("9999px"),
    paddingX: PX.default("16px"),
    paddingY: PX.default("8px"),
    fontWeight: z.number().min(100).max(900).default(600),
    uppercase: z.boolean().default(false),
    arrow: z.boolean().default(true),
  }).default({}),
  metaInfo: z.object({
    fontSize: PX.default("13px"),
    color: COLOR.default("var(--muted-foreground)"),
    uppercase: z.boolean().default(false),
    gap: PX.default("12px"),
    separator: z.enum(["dot", "slash", "pipe", "none"]).default("dot"),
  }).default({}),
  toolbarButton: z.object({
    bgColor: COLOR.default("var(--muted)"),
    color: COLOR.default("var(--foreground)"),
    hoverBgColor: COLOR.default("color-mix(in oklab, var(--muted) 70%, transparent)"),
    hoverColor: COLOR.default("var(--foreground)"),
    activeBgColor: COLOR.default("#fa9346"),
    activeColor: COLOR.default("#ffffff"),
    radius: PX.default("6px"),
    paddingX: PX.default("8px"),
    paddingY: PX.default("6px"),
    size: PX.default("16px"),
  }).default({}),
  modeSwitcher: z.object({
    trackBg: COLOR.default("var(--muted)"),
    trackBorder: COLOR.default("var(--border)"),
    inactiveColor: COLOR.default("var(--muted-foreground)"),
    activeBg: COLOR.default("var(--background)"),
    activeColor: COLOR.default("var(--foreground)"),
    radius: PX.default("6px"),
    showLabel: z.boolean().default(true),
  }).default({}),
  socialIcons: z.object({
    color: COLOR.default("var(--foreground)"),
    hoverColor: COLOR.default("#fa9346"),
    bgColor: COLOR.default("transparent"),
    hoverBgColor: COLOR.default("transparent"),
    size: PX.default("18px"),
    gap: PX.default("8px"),
    radius: PX.default("9999px"),
    paddingX: PX.default("6px"),
    paddingY: PX.default("6px"),
  }).default({}),
  listIndex: z.object({
    // Global defaults for "numbered" / "ranked" post-list variants.
    // Used when the individual widget does not override colors.
    colorLight: COLOR.default("#231f20"),
    colorDark: COLOR.default("#fa9346"),
    opacity: z.number().min(0).max(1).default(0.18),
    weight: z.number().min(100).max(900).default(800),
  }).default({}),
  postTitle: z.object({
    // Unified title styling shared by every post card / list / slider / grid widget.
    fontFamily: z.string().default('"Red Hat Display", system-ui, -apple-system, Segoe UI, sans-serif'),
    fontSize: PX.default("15px"),
    fontSizeSm: PX.default("14px"),
    fontWeight: z.number().min(100).max(900).default(600),
    lineHeight: z.union([z.number(), z.string()]).default(1.3),
    color: COLOR.default("var(--foreground)"),
    hoverColor: COLOR.default("var(--brand)"),
    textTransform: z.enum(["none", "uppercase", "lowercase", "capitalize"]).default("none"),
    letterSpacing: PX.default("0px"),
  }).default({}),
  postExcerpt: z.object({
    fontFamily: z.string().default('"Red Hat Display", system-ui, -apple-system, Segoe UI, sans-serif'),
    fontSize: PX.default("13px"),
    fontWeight: z.number().min(100).max(900).default(400),
    lineHeight: z.union([z.number(), z.string()]).default(1.5),
    color: COLOR.default("var(--muted-foreground)"),
    marginTop: PX.default("6px"),
  }).default({}),
}).default({});

export type ThemeDesign = z.infer<typeof ThemeDesignSchema>;

export const THEME_DESIGN_DEFAULTS: ThemeDesign = ThemeDesignSchema.parse({});

const KEY = "theme_design";
const QUERY_KEY = ["site_settings", KEY] as const;

export function useThemeDesign() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async ({ client }): Promise<ThemeDesign> => {
      const settings = await client.ensureQueryData(siteSettingsQueryOptions);
      const raw = settings[KEY] ?? {};
      const merged = deepMerge(THEME_DESIGN_DEFAULTS, raw as Record<string, unknown>);
      const parsed = ThemeDesignSchema.safeParse(merged);
      return parsed.success ? parsed.data : THEME_DESIGN_DEFAULTS;
    },
    staleTime: 5 * 60_000,
  });
}

export function useSaveThemeDesign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (next: ThemeDesign) => {
      const { error } = await supabase.from("site_settings").upsert(
        { key: KEY, value: toJson(next) },
        { onConflict: "key" },
      );
      if (error) throw error;
      return next;
    },
    onSuccess: (next) => {
      qc.setQueryData(QUERY_KEY, next);
      qc.invalidateQueries({ queryKey: ["site_settings_public", "all"] });
      toast.success("Zapisano Theme Design");
    },
    onError: (e: Error) => toast.error(e.message || "Błąd zapisu"),
  });
}

/** Normalizes legacy shadcn-style `hsl(var(--x))` / `hsl(var(--x) / .5)` wrappers
 *  to bare `var(--x)` — our design tokens now hold ready-to-use color values
 *  (hex, oklch, color-mix), not raw HSL triplets, so wrapping them in `hsl()`
 *  produces invalid CSS ("hsl(#F8F6F4)") that browsers silently drop, leaving
 *  text unreadable in dark mode. Older DB rows still contain the wrapped form. */
function normalizeColor(c: string): string {
  return c.replace(/hsl\(\s*var\((--[a-z0-9-]+)\)(?:\s*\/\s*[^)]+)?\s*\)/gi, "var($1)");
}

/** Serializes the design tokens to CSS variables under `:root`. */
export function themeDesignToCss(t: ThemeDesign): string {
  const v: string[] = [];
  // Block heading
  v.push(`--td-bh-size:${t.blockHeading.fontSize};`);
  v.push(`--td-bh-weight:${t.blockHeading.fontWeight};`);
  v.push(`--td-bh-color:${t.blockHeading.color};`);
  v.push(`--td-bh-transform:${t.blockHeading.textTransform};`);
  v.push(`--td-bh-spacing:${t.blockHeading.letterSpacing};`);
  v.push(`--td-bh-mb:${t.blockHeading.marginBottom};`);
  // Thumbnail
  v.push(`--td-thumb-radius:${t.thumbnail.radius};`);
  v.push(`--td-thumb-ratio:${t.thumbnail.aspectRatio};`);
  v.push(`--td-thumb-shadow:${shadow(t.thumbnail.shadow)};`);
  // Read more
  v.push(`--td-rm-bg:${t.readMoreButton.bgColor};`);
  v.push(`--td-rm-color:${t.readMoreButton.color};`);
  v.push(`--td-rm-border:${t.readMoreButton.borderColor};`);
  v.push(`--td-rm-radius:${t.readMoreButton.radius};`);
  v.push(`--td-rm-px:${t.readMoreButton.paddingX};`);
  v.push(`--td-rm-py:${t.readMoreButton.paddingY};`);
  v.push(`--td-rm-weight:${t.readMoreButton.fontWeight};`);
  v.push(`--td-rm-transform:${t.readMoreButton.uppercase ? "uppercase" : "none"};`);
  // Meta
  v.push(`--td-meta-size:${t.metaInfo.fontSize};`);
  v.push(`--td-meta-color:${t.metaInfo.color};`);
  v.push(`--td-meta-transform:${t.metaInfo.uppercase ? "uppercase" : "none"};`);
  v.push(`--td-meta-gap:${t.metaInfo.gap};`);
  // Toolbar buttons (undo/redo, device, lang)
  v.push(`--td-tb-bg:${t.toolbarButton.bgColor};`);
  v.push(`--td-tb-color:${t.toolbarButton.color};`);
  v.push(`--td-tb-hover-bg:${t.toolbarButton.hoverBgColor};`);
  v.push(`--td-tb-hover-color:${t.toolbarButton.hoverColor};`);
  v.push(`--td-tb-active-bg:${t.toolbarButton.activeBgColor};`);
  v.push(`--td-tb-active-color:${t.toolbarButton.activeColor};`);
  v.push(`--td-tb-radius:${t.toolbarButton.radius};`);
  v.push(`--td-tb-px:${t.toolbarButton.paddingX};`);
  v.push(`--td-tb-py:${t.toolbarButton.paddingY};`);
  v.push(`--td-tb-size:${t.toolbarButton.size};`);
  // Mode switcher (light/dark segmented)
  v.push(`--td-ms-track-bg:${t.modeSwitcher.trackBg};`);
  v.push(`--td-ms-track-border:${t.modeSwitcher.trackBorder};`);
  v.push(`--td-ms-inactive:${t.modeSwitcher.inactiveColor};`);
  v.push(`--td-ms-active-bg:${t.modeSwitcher.activeBg};`);
  v.push(`--td-ms-active-color:${t.modeSwitcher.activeColor};`);
  v.push(`--td-ms-radius:${t.modeSwitcher.radius};`);
  // Social icons
  v.push(`--td-si-color:${t.socialIcons.color};`);
  v.push(`--td-si-hover-color:${t.socialIcons.hoverColor};`);
  v.push(`--td-si-bg:${t.socialIcons.bgColor};`);
  v.push(`--td-si-hover-bg:${t.socialIcons.hoverBgColor};`);
  v.push(`--td-si-size:${t.socialIcons.size};`);
  v.push(`--td-si-gap:${t.socialIcons.gap};`);
  v.push(`--td-si-radius:${t.socialIcons.radius};`);
  v.push(`--td-si-px:${t.socialIcons.paddingX};`);
  v.push(`--td-si-py:${t.socialIcons.paddingY};`);
  // List index (numbered / ranked variant)
  v.push(`--td-li-light:${t.listIndex.colorLight};`);
  v.push(`--td-li-dark:${t.listIndex.colorDark};`);
  v.push(`--td-li-opacity:${t.listIndex.opacity};`);
  v.push(`--td-li-weight:${t.listIndex.weight};`);
  // Unified post title
  v.push(`--td-pt-family:${t.postTitle.fontFamily};`);
  v.push(`--td-pt-size:${t.postTitle.fontSize};`);
  v.push(`--td-pt-size-sm:${t.postTitle.fontSizeSm};`);
  v.push(`--td-pt-weight:${t.postTitle.fontWeight};`);
  v.push(`--td-pt-lh:${t.postTitle.lineHeight};`);
  v.push(`--td-pt-color:${t.postTitle.color};`);
  v.push(`--td-pt-hover:${t.postTitle.hoverColor};`);
  v.push(`--td-pt-transform:${t.postTitle.textTransform};`);
  v.push(`--td-pt-spacing:${t.postTitle.letterSpacing};`);
  // Unified post excerpt
  v.push(`--td-pe-family:${t.postExcerpt.fontFamily};`);
  v.push(`--td-pe-size:${t.postExcerpt.fontSize};`);
  v.push(`--td-pe-weight:${t.postExcerpt.fontWeight};`);
  v.push(`--td-pe-lh:${t.postExcerpt.lineHeight};`);
  v.push(`--td-pe-color:${t.postExcerpt.color};`);
  v.push(`--td-pe-mt:${t.postExcerpt.marginTop};`);
  return normalizeColor(`:root{${v.join("")}}`);
}

function shadow(level: "none" | "sm" | "md" | "lg"): string {
  switch (level) {
    case "sm": return "0 1px 2px 0 rgb(0 0 0 / .06)";
    case "md": return "0 4px 12px -2px rgb(0 0 0 / .12)";
    case "lg": return "0 12px 32px -6px rgb(0 0 0 / .18)";
    default:   return "none";
  }
}
