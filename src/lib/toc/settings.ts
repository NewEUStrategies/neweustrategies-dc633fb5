// Globalne ustawienia spisu treści (Table of Contents) i schemat nadpisania per wpis/strona.
// Zapisywane w site_settings pod kluczem `toc_defaults`.
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { toJson } from "@/lib/builder/types";
import { useSiteSetting } from "@/lib/useSiteSetting";
import type { Block, BlocksDoc, LocalizedBlocks } from "@/lib/blocks/types";

export const TOC_LAYOUTS = ["boxed", "inline", "sticky-sidebar"] as const;
export type TocLayout = (typeof TOC_LAYOUTS)[number];

/**
 * Trzy warianty kolumnowego układu spisu treści (parytet z Foxiz):
 * - `col-1`     - jedna kolumna, pełna szerokość (domyślnie)
 * - `col-2`     - dwie kolumny, pełna szerokość (długie ToC dzielone na pół)
 * - `half`      - jedna kolumna, połowa szerokości bloku treści
 */
export const TOC_COLUMNS = ["col-1", "col-2", "half"] as const;
export type TocColumns = (typeof TOC_COLUMNS)[number];

const COLOR = z.string().min(1);

export const TocDefaultsSchema = z
  .object({
    enabled: z.boolean().default(true),
    layout: z.enum(TOC_LAYOUTS).default("boxed"),
    columns: z.enum(TOC_COLUMNS).default("col-1"),
    /** Po którym akapicie treści wstawić ToC. 0 = na górze, -1 = ukryj w treści (tylko sidebar). */
    position: z.number().int().min(-1).max(20).default(3),
    minHeadings: z.number().int().min(1).max(20).default(3),
    /** Minimalny poziom pobieranych nagłówków (1 = H1, 2 = H2, ...). */
    minLevel: z.number().int().min(1).max(6).default(2),
    /** Maksymalny poziom pobieranych nagłówków. */
    maxLevel: z.number().int().min(1).max(6).default(3),
    sticky: z.boolean().default(false),
    ordered: z.boolean().default(false),
    titlePl: z.string().default("Spis treści"),
    titleEn: z.string().default("Table of contents"),
    colors: z
      .object({
        bg: COLOR.default("#f8fafc"),
        bgDark: COLOR.default("#1e293b"),
        accent: COLOR.default("#4f46e5"),
        border: COLOR.default("#e2e8f0"),
        borderDark: COLOR.default("#334155"),
        text: COLOR.default("#0f172a"),
        textDark: COLOR.default("#e2e8f0"),
      })
      .default({}),
  })
  .default({});

export type TocDefaults = z.infer<typeof TocDefaultsSchema>;
export const TOC_DEFAULTS: TocDefaults = TocDefaultsSchema.parse({});
export const TOC_SETTING_KEY = "toc_defaults";

/** Nadpisanie per wpis/strona. `null` = użyj globalnych. */
export const TocOverrideSchema = z
  .object({
    enabled: z.boolean().nullable().default(null),
    layout: z.enum(TOC_LAYOUTS).nullable().default(null),
    columns: z.enum(TOC_COLUMNS).nullable().default(null),
    position: z.number().int().min(-1).max(20).nullable().default(null),
    sticky: z.boolean().nullable().default(null),
  })
  .partial()
  .nullable();


export type TocOverride = z.infer<typeof TocOverrideSchema>;

/** Scala globalne z per-wpis override. */
export function mergeTocSettings(
  defaults: TocDefaults,
  override: TocOverride | null | undefined,
): TocDefaults {
  if (!override) return defaults;
  return {
    ...defaults,
    enabled: override.enabled ?? defaults.enabled,
    layout: override.layout ?? defaults.layout,
    position: override.position ?? defaults.position,
    sticky: override.sticky ?? defaults.sticky,
  };
}

export function useTocDefaults(): TocDefaults {
  const raw = useSiteSetting<TocDefaults>(TOC_SETTING_KEY, TOC_DEFAULTS);
  const parsed = TocDefaultsSchema.safeParse(raw);
  return parsed.success ? parsed.data : TOC_DEFAULTS;
}

export function useSaveTocDefaults() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (next: TocDefaults) => {
      const { error } = await supabase
        .from("site_settings")
        .upsert(
          { key: TOC_SETTING_KEY, value: toJson(next) },
          { onConflict: "key" },
        );
      if (error) throw error;
      return next;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["site_settings_public", "all"] });
      toast.success("Zapisano ustawienia spisu treści");
    },
    onError: (e: Error) => toast.error(e.message || "Błąd zapisu"),
  });
}
