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
    colors: z
      .object({
        bg: COLOR.default("#eef1ff"),
        bgDark: COLOR.default("#1e2540"),
        accent: COLOR.default("#4f46e5"),
        icon: COLOR.default("#ffffff"),
        iconBg: COLOR.default("#4f46e5"),
        text: COLOR.default("#1f2937"),
        textDark: COLOR.default("#e5e7eb"),
        title: COLOR.default("#111827"),
        titleDark: COLOR.default("#ffffff"),
      })
      .default({}),
  })
  .default({});

export type KeyTakeawaysSettings = z.infer<typeof KeyTakeawaysSettingsSchema>;

export const KEY_TAKEAWAYS_DEFAULTS: KeyTakeawaysSettings =
  KeyTakeawaysSettingsSchema.parse({});

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
          { onConflict: "key" },
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
