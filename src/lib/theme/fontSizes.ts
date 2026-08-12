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
import { commitSiteSettingWrite, siteSettingsQueryOptions } from "@/lib/useSiteSetting";

export const FONT_SIZES_KEY = "font_sizes";

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
    // Odstępy pionowe treści (rem). Wspólne dla frontu i canvasa buildera -
    // dzięki temu Enter w Gutenbergu daje ten sam rytm co publiczny wpis.
    spacing: z
      .object({
        headingTopRem: z.coerce.number().min(0).max(6),
        headingBottomRem: z.coerce.number().min(0).max(6),
        listRem: z.coerce.number().min(0).max(6),
        blockquoteRem: z.coerce.number().min(0).max(6),
      })
      .default({ headingTopRem: 2, headingBottomRem: 0.75, listRem: 1.5, blockquoteRem: 1.75 }),
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

/**
 * Rozmiary czcionek motywu = projekcja wspólnego bulk-query `site_settings`.
 * Jedno źródło prawdy: ten sam cache karmi header, footer i front, więc zapis
 * w panelu natychmiast przelicza tokeny `--fs-*` na stronie publicznej.
 */
export function useFontSizes() {
  return useQuery({
    ...siteSettingsQueryOptions,
    select: (map: unknown): FontSizesSettings => loadFromMap(map as Record<string, unknown>),
  });
}

export function useSaveFontSizes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (next: FontSizesSettings) => {
      const validated = FontSizesSchema.parse(next);
      const { error } = await supabase
        .from("site_settings")
        .upsert({ key: FONT_SIZES_KEY, value: toJson(validated) }, { onConflict: "tenant_id,key" });
      if (error) throw error;
      return validated;
    },
    onSuccess: async (next) => {
      // Zapis z kontrolą wersji: optymistyczna podmiana + refetch, przy czym
      // niepotwierdzona wartość nadpisuje ewentualną starą odpowiedź serwera,
      // więc podgląd i strona publiczna nigdy nie migają starymi tokenami.
      await commitSiteSettingWrite(qc, FONT_SIZES_KEY, next);
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
    `--sp-heading-top:${fs.spacing.headingTopRem}rem;`,
    `--sp-heading-bottom:${fs.spacing.headingBottomRem}rem;`,
    `--sp-list:${fs.spacing.listRem}rem;`,
    `--sp-blockquote:${fs.spacing.blockquoteRem}rem;`,
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
    spacingRulesCss(),
    lineHeightRulesCss(),
  ].join("");
}

/**
 * Interlinia treści (akapity + nagłówki). Te same zmienne konsumują publiczny
 * wpis (`.post-content` / `.single-post-content`) oraz canvas Gutenberga
 * (`[data-builder-renderer]`), więc edytor 1:1 odwzorowuje front.
 * Podwojona specyficzność klas wygrywa z `<ContentAreaStyle/>` i utility.
 */
function lineHeightRulesCss(): string {
  const heads = HEADING_LEVELS.map(
    (level) =>
      `.post-content.post-content ${level},` +
      `.blocks-content.blocks-content ${level},` +
      `.single-post-content.single-post-content ${level},` +
      `[data-builder-renderer] ${level}` +
      `{line-height:var(--lh-${level});}`,
  ).join("");
  return [
    `.post-content.post-content :is(p,li),`,
    `.blocks-content.blocks-content :is(p,li),`,
    `.single-post-content.single-post-content :is(p,li),`,
    `[data-builder-renderer] > [data-block-type="paragraph"],`,
    `[data-builder-renderer] > [data-block-type="paragraph"] :is(p,div,li),`,
    `[data-builder-renderer] > [data-block-type="list"] :is(p,li)`,
    `{line-height:var(--lh-body);}`,
    `.post-content.post-content blockquote,`,
    `.blocks-content.blocks-content blockquote,`,
    `.single-post-content.single-post-content blockquote,`,
    `[data-builder-renderer] > [data-block-type="quote"]`,
    `{line-height:var(--lh-blockquote);}`,
    heads,
  ].join("");
}

/**
 * Reguły odstępów treści. Podwojona specyficzność klas, żeby wygrać z
 * <ContentAreaStyle/> (margin-bottom list/cytatów) niezależnie od kolejności
 * montowania <style> w <head>. Canvas buildera dostaje te same wartości,
 * więc edytor i front mają identyczny rytm pionowy.
 */
function spacingRulesCss(): string {
  return [
    `.post-content.post-content :is(h1,h2,h3,h4,h5,h6),`,
    `.blocks-content.blocks-content :is(h1,h2,h3,h4,h5,h6),`,
    `.single-post-content.single-post-content :is(h1,h2,h3,h4,h5,h6),`,
    `[data-builder-renderer] > [data-block-type="heading"]`,
    `{margin-top:var(--sp-heading-top);margin-bottom:var(--sp-heading-bottom);}`,
    `.post-content.post-content :is(ul,ol),`,
    `.blocks-content.blocks-content :is(ul,ol),`,
    `.single-post-content.single-post-content :is(ul,ol),`,
    `[data-builder-renderer] > [data-block-type="list"]`,
    `{margin-bottom:var(--sp-list);}`,
    `.post-content.post-content blockquote,`,
    `.blocks-content.blocks-content blockquote,`,
    `.single-post-content.single-post-content blockquote,`,
    `[data-builder-renderer] > [data-block-type="quote"]`,
    `{margin-top:var(--sp-blockquote);margin-bottom:var(--sp-blockquote);}`,
    // Canvas: margines niesie wrapper bloku (jedno źródło prawdy), więc
    // wewnętrzne ul/ol/blockquote nie mogą dokładać drugiego odstępu -
    // inaczej edytor rozjeżdża się z frontem o wartość prose.
    `[data-builder-renderer] > [data-block-type="list"] :is(ul,ol),`,
    `[data-builder-renderer] > [data-block-type="quote"] blockquote`,
    `{margin-top:0;margin-bottom:0;}`,
  ].join("");
}
