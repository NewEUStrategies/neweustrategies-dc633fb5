// Globalne ustawienia sekcji "Z tego materiału dowiesz się, że ..."
// przechowywane w site_settings pod kluczem `key_takeaways`.
// Konsumowane przez <KeyTakeaways /> (widok publiczny) oraz przez
// dedykowaną stronę admina /admin/key-takeaways.
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { toJson } from "@/lib/builder/types";
import { useSiteSetting } from "@/lib/useSiteSetting";

const COLOR = z.string().min(1);

export const KEY_TAKEAWAYS_VARIANTS = ["card", "heading", "ghost"] as const;
export type KeyTakeawaysVariant = (typeof KEY_TAKEAWAYS_VARIANTS)[number];

export const KeyTakeawaysSettingsSchema = z
  .object({
    enabled: z.boolean().default(true),
    variant: z.enum(KEY_TAKEAWAYS_VARIANTS).default("card"),
    icon: z.string().min(1).default("Search"),
    labelPl: z.string().default("Z tego artykułu dowiesz się..."),
    labelEn: z.string().default("From this article you will learn..."),
    numbered: z.boolean().default(true),
    /**
     * Wariant "ghost": podświetlenie wybranych słów etykiety.
     * `indicesPl` / `indicesEn` - 0-based pozycje słów, wybierane niezależnie
     * per język (PL i EN mogą mieć inną liczbę i kolejność słów).
     * `indices` (legacy) - używane jako fallback, gdy per-language listy są puste.
     * `color` zachowuje transparentność napisu ghost.
     * `sizeScale` - mnożnik rozmiaru napisu (1 = domyślnie).
     */
    highlight: z
      .object({
        indices: z.array(z.number().int().min(0).max(20)).default([]),
        indicesPl: z.array(z.number().int().min(0).max(20)).default([]),
        indicesEn: z.array(z.number().int().min(0).max(20)).default([]),
        color: COLOR.default("#fa9346"),
        sizeScale: z.number().min(0.5).max(3).default(1),
        offsetY: z.number().min(-200).max(200).default(0),
      })
      .default({}),
    colors: z
      .object({
        bg: COLOR.default("#fff4ea"),
        bgDark: COLOR.default("#2b2118"),
        accent: COLOR.default("#fa9346"),
        icon: COLOR.default("#ffffff"),
        iconBg: COLOR.default("#fa9346"),
        text: COLOR.default("#1f2937"),
        textDark: COLOR.default("#e5e7eb"),
        title: COLOR.default("#111827"),
        titleDark: COLOR.default("#ffffff"),
        border: COLOR.default("transparent"),
        borderDark: COLOR.default("transparent"),
        borderWidth: z.number().min(0).max(8).default(0),
      })
      .default({}),
  })
  .default({});

export type KeyTakeawaysSettings = z.infer<typeof KeyTakeawaysSettingsSchema>;

export const KEY_TAKEAWAYS_DEFAULTS: KeyTakeawaysSettings = KeyTakeawaysSettingsSchema.parse({});

export const KEY_TAKEAWAYS_SETTING_KEY = "key_takeaways";

/** Hook: subskrybuje globalne ustawienia sekcji (site_settings.key_takeaways). */
export function useKeyTakeawaysSettings(): KeyTakeawaysSettings {
  const raw = useSiteSetting<KeyTakeawaysSettings>(
    KEY_TAKEAWAYS_SETTING_KEY,
    KEY_TAKEAWAYS_DEFAULTS,
  );
  const parsed = KeyTakeawaysSettingsSchema.safeParse(raw);
  return parsed.success ? parsed.data : KEY_TAKEAWAYS_DEFAULTS;
}

/** Zapis ustawień. */
export function useSaveKeyTakeawaysSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (next: KeyTakeawaysSettings) => {
      const { error } = await supabase
        .from("site_settings")
        .upsert(
          { key: KEY_TAKEAWAYS_SETTING_KEY, value: toJson(next) },
          { onConflict: "tenant_id,key" },
        );
      if (error) throw error;
      return next;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["site_settings_public", "all"] });
      toast.success("Zapisano ustawienia sekcji");
    },
    onError: (e: Error) => toast.error(e.message || "Błąd zapisu"),
  });
}
