// Global slider / carousel animation defaults — used as fallback for every
// slider/carousel widget that doesn't define its own value. Editors override
// per-widget; otherwise these globals win.
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { z } from "zod";
import { deepMerge } from "@/lib/deepMerge";

export const CarouselDefaultsSchema = z.object({
  autoplay: z.boolean().default(true),
  intervalMs: z.number().int().min(1000).max(30_000).default(4500),
  transition: z.enum(["slide", "fade", "zoom"]).default("slide"),
  loop: z.boolean().default(true),
  pauseOnHover: z.boolean().default(true),
  speedMs: z.number().int().min(100).max(3000).default(600),
});

export type CarouselDefaults = z.infer<typeof CarouselDefaultsSchema>;

export const CAROUSEL_DEFAULTS: CarouselDefaults = CarouselDefaultsSchema.parse({});

const KEY = "carousel_defaults";
const QUERY_KEY = ["site_settings", KEY] as const;

export function useCarouselDefaults() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async (): Promise<CarouselDefaults> => {
      const { data, error } = await supabase
        .from("site_settings").select("value").eq("key", KEY).maybeSingle();
      if (error) throw error;
      const raw = data?.value ?? {};
      const merged = deepMerge(CAROUSEL_DEFAULTS, raw as Record<string, unknown>);
      const parsed = CarouselDefaultsSchema.safeParse(merged);
      return parsed.success ? parsed.data : CAROUSEL_DEFAULTS;
    },
    staleTime: 5 * 60_000,
  });
}

export function useSaveCarouselDefaults() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (next: CarouselDefaults) => {
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
      toast.success("Zapisano domyślne ustawienia karuzeli");
    },
    onError: (e: Error) => toast.error(e.message || "Błąd zapisu"),
  });
}

/** Merge per-widget overrides with global defaults. `undefined` falls back. */
export function resolveCarouselSettings(
  defaults: CarouselDefaults,
  override: Partial<CarouselDefaults> | undefined,
): CarouselDefaults {
  if (!override) return defaults;
  const cleaned: Partial<CarouselDefaults> = {};
  for (const [k, v] of Object.entries(override)) {
    if (v !== undefined && v !== null) {
      (cleaned as Record<string, unknown>)[k] = v;
    }
  }
  return { ...defaults, ...cleaned };
}
