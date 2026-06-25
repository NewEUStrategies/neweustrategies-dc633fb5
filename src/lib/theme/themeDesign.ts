// Global "Theme Design" tokens — block headings, thumbnails, "Read more"
// button, and meta-info text styles. Single source of truth shared by every
// widget/post-card across the site.
//
// Stored in `site_settings` under key `theme_design`. Applied via
// <ThemeDesignStyle /> as CSS variables under `--td-*` that components reference
// through utility classes (e.g. `.cms-block-heading`, `.cms-read-more`).
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { z } from "zod";
import { deepMerge } from "@/lib/deepMerge";

const PX = z.union([z.number(), z.string()]).transform((v) => (typeof v === "number" ? `${v}px` : v));
const COLOR = z.string().min(1);

export const ThemeDesignSchema = z.object({
  blockHeading: z.object({
    fontSize: PX.default("18px"),
    fontWeight: z.number().min(100).max(900).default(700),
    color: COLOR.default("hsl(var(--foreground))"),
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
    color: COLOR.default("hsl(var(--brand))"),
    borderColor: COLOR.default("hsl(var(--brand))"),
    radius: PX.default("9999px"),
    paddingX: PX.default("16px"),
    paddingY: PX.default("8px"),
    fontWeight: z.number().min(100).max(900).default(600),
    uppercase: z.boolean().default(false),
    arrow: z.boolean().default(true),
  }).default({}),
  metaInfo: z.object({
    fontSize: PX.default("13px"),
    color: COLOR.default("hsl(var(--muted-foreground))"),
    uppercase: z.boolean().default(false),
    gap: PX.default("12px"),
    separator: z.enum(["dot", "slash", "pipe", "none"]).default("dot"),
  }).default({}),
  toolbarButton: z.object({
    bgColor: COLOR.default("hsl(var(--muted))"),
    color: COLOR.default("hsl(var(--foreground))"),
    hoverBgColor: COLOR.default("hsl(var(--muted) / 0.7)"),
    hoverColor: COLOR.default("hsl(var(--foreground))"),
    activeBgColor: COLOR.default("#fa9346"),
    activeColor: COLOR.default("#ffffff"),
    radius: PX.default("6px"),
    paddingX: PX.default("8px"),
    paddingY: PX.default("6px"),
    size: PX.default("16px"),
  }).default({}),
  modeSwitcher: z.object({
    trackBg: COLOR.default("hsl(var(--muted))"),
    trackBorder: COLOR.default("hsl(var(--border))"),
    inactiveColor: COLOR.default("hsl(var(--muted-foreground))"),
    activeBg: COLOR.default("hsl(var(--background))"),
    activeColor: COLOR.default("hsl(var(--foreground))"),
    radius: PX.default("6px"),
    showLabel: z.boolean().default(true),
  }).default({}),
  socialIcons: z.object({
    color: COLOR.default("hsl(var(--foreground))"),
    hoverColor: COLOR.default("#fa9346"),
    bgColor: COLOR.default("transparent"),
    hoverBgColor: COLOR.default("transparent"),
    size: PX.default("18px"),
    gap: PX.default("8px"),
    radius: PX.default("9999px"),
    paddingX: PX.default("6px"),
    paddingY: PX.default("6px"),
  }).default({}),
}).default({});

export type ThemeDesign = z.infer<typeof ThemeDesignSchema>;

export const THEME_DESIGN_DEFAULTS: ThemeDesign = ThemeDesignSchema.parse({});

const KEY = "theme_design";
const QUERY_KEY = ["site_settings", KEY] as const;

export function useThemeDesign() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async (): Promise<ThemeDesign> => {
      const { data, error } = await supabase
        .from("site_settings").select("value").eq("key", KEY).maybeSingle();
      if (error) throw error;
      const raw = data?.value ?? {};
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
        { key: KEY, value: next as unknown as never },
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
  return `:root{${v.join("")}}`;
}

function shadow(level: "none" | "sm" | "md" | "lg"): string {
  switch (level) {
    case "sm": return "0 1px 2px 0 rgb(0 0 0 / .06)";
    case "md": return "0 4px 12px -2px rgb(0 0 0 / .12)";
    case "lg": return "0 12px 32px -6px rgb(0 0 0 / .18)";
    default:   return "none";
  }
}
