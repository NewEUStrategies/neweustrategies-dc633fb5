// Global font-size tokens: body, small, lead, blockquote, code + H1-H6.
// Stored in site_settings under key `font_sizes` (JSONB). Emitted as :root
// CSS custom properties by <ThemeFontSizesStyle /> and consumed globally by
// h1..h6 / body / .cms-post-* selectors in styles.css.
import { toJson } from "@/lib/builder/types";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { z } from "zod";
import { deepMerge } from "@/lib/deepMerge";
import { siteSettingsQueryOptions } from "@/lib/useSiteSetting";

export const FONT_SIZES_KEY = "font_sizes";
const QUERY_KEY = ["site_setting", FONT_SIZES_KEY] as const;

const clamp = (min: number, max: number) => z.coerce.number().min(min).max(max).step(1);

const HeadingSchema = z
  .object({
    desktop: clamp(10, 120),
    mobile: clamp(10, 96),
    lineHeight: z.coerce.number().min(0.8).max(2.5),
    letterSpacing: z.coerce.number().min(-4).max(20),
    weight: z.coerce.number().int().min(100).max(900),
    transform: z.enum(["none", "uppercase", "lowercase", "capitalize"]),
  })
  .default({
    desktop: 32,
    mobile: 26,
    lineHeight: 1.25,
    letterSpacing: 0,
    weight: 700,
    transform: "none",
  });

const FontSizesSchema = z
  .object({
    body: z
      .object({ size: clamp(10, 28), lineHeight: z.coerce.number().min(1).max(2.4) })
      .default({ size: 16, lineHeight: 1.65 }),
    small: z
      .object({ size: clamp(8, 20), lineHeight: z.coerce.number().min(1).max(2.4) })
      .default({ size: 13, lineHeight: 1.5 }),
    lead: z
      .object({ size: clamp(12, 32), lineHeight: z.coerce.number().min(1).max(2.4) })
      .default({ size: 18, lineHeight: 1.6 }),
    blockquote: z
      .object({ size: clamp(12, 32), lineHeight: z.coerce.number().min(1).max(2.4) })
      .default({ size: 18, lineHeight: 1.55 }),
    code: z.object({ size: clamp(10, 22) }).default({ size: 14 }),
    headings: z
      .object({
        h1: HeadingSchema,
        h2: HeadingSchema,
        h3: HeadingSchema,
        h4: HeadingSchema,
        h5: HeadingSchema,
        h6: HeadingSchema,
      })
      .default({
        h1: {
          desktop: 44,
          mobile: 32,
          lineHeight: 1.15,
          letterSpacing: -0.5,
          weight: 800,
          transform: "none",
        },
        h2: {
          desktop: 34,
          mobile: 28,
          lineHeight: 1.2,
          letterSpacing: -0.25,
          weight: 700,
          transform: "none",
        },
        h3: {
          desktop: 26,
          mobile: 22,
          lineHeight: 1.25,
          letterSpacing: 0,
          weight: 700,
          transform: "none",
        },
        h4: {
          desktop: 22,
          mobile: 19,
          lineHeight: 1.3,
          letterSpacing: 0,
          weight: 700,
          transform: "none",
        },
        h5: {
          desktop: 18,
          mobile: 17,
          lineHeight: 1.4,
          letterSpacing: 0,
          weight: 600,
          transform: "none",
        },
        h6: {
          desktop: 16,
          mobile: 15,
          lineHeight: 1.45,
          letterSpacing: 0.5,
          weight: 600,
          transform: "uppercase",
        },
      }),
    mobileBreakpoint: clamp(360, 1024).default(768),
  })
  .default({});

export type FontSizesSettings = z.infer<typeof FontSizesSchema>;
export type HeadingLevel = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

export const FONT_SIZES_DEFAULTS: FontSizesSettings = FontSizesSchema.parse({});

export const HEADING_LEVELS: readonly HeadingLevel[] = [
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
] as const;

function loadFromMap(map: Record<string, unknown>): FontSizesSettings {
  const raw = map[FONT_SIZES_KEY] ?? {};
  const merged = deepMerge(FONT_SIZES_DEFAULTS, raw as Record<string, unknown>);
  const parsed = FontSizesSchema.safeParse(merged);
  return parsed.success ? parsed.data : FONT_SIZES_DEFAULTS;
}

export function useFontSizes() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async ({ client }): Promise<FontSizesSettings> => {
      const settings = await client.ensureQueryData(siteSettingsQueryOptions);
      return loadFromMap(settings as Record<string, unknown>);
    },
    staleTime: 5 * 60_000,
  });
}

export function useSaveFontSizes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (next: FontSizesSettings) => {
      const validated = FontSizesSchema.parse(next);
      const { error } = await supabase
        .from("site_settings")
        .upsert({ key: FONT_SIZES_KEY, value: toJson(validated) }, { onConflict: "key" });
      if (error) throw error;
      return validated;
    },
    onSuccess: (next) => {
      qc.setQueryData(QUERY_KEY, next);
      qc.invalidateQueries({ queryKey: ["site_settings_public", "all"] });
      toast.success("Zapisano rozmiary czcionek");
    },
    onError: (e: Error) => toast.error(e.message || "Błąd zapisu"),
  });
}

/** Build :root CSS with responsive H1-H6 (media query at mobileBreakpoint). */
export function fontSizesToCss(fs: FontSizesSettings): string {
  const rootLines: string[] = [
    `--fs-body:${fs.body.size}px;`,
    `--lh-body:${fs.body.lineHeight};`,
    `--fs-small:${fs.small.size}px;`,
    `--lh-small:${fs.small.lineHeight};`,
    `--fs-lead:${fs.lead.size}px;`,
    `--lh-lead:${fs.lead.lineHeight};`,
    `--fs-blockquote:${fs.blockquote.size}px;`,
    `--lh-blockquote:${fs.blockquote.lineHeight};`,
    `--fs-code:${fs.code.size}px;`,
  ];
  for (const level of HEADING_LEVELS) {
    const h = fs.headings[level];
    rootLines.push(`--fs-${level}:${h.desktop}px;`);
    rootLines.push(`--lh-${level}:${h.lineHeight};`);
    rootLines.push(`--ls-${level}:${h.letterSpacing}px;`);
    rootLines.push(`--fw-${level}:${h.weight};`);
    rootLines.push(`--tt-${level}:${h.transform};`);
  }
  const mobileLines: string[] = HEADING_LEVELS.map(
    (level) => `--fs-${level}:${fs.headings[level].mobile}px;`,
  );
  return [
    `:root{${rootLines.join("")}}`,
    `@media (max-width: ${fs.mobileBreakpoint}px){:root{${mobileLines.join("")}}}`,
  ].join("");
}
