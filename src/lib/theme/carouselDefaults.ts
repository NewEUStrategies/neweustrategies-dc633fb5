// Global slider / carousel animation defaults - used as fallback for every
// slider/carousel widget that doesn't define its own value. Editors override
// per-widget; otherwise these globals win.
import { toJson } from "@/lib/builder/types";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { siteSettingsQueryOptions } from "@/lib/useSiteSetting";

const CAROUSEL_TRANSITIONS = ["slide", "fade", "zoom"] as const;

// `type`, nie `interface`: alias obiektu (jak dawne `z.infer`) da się rzutować
// na `Record<string, unknown>` - robią to edytor motywu i jego testy.
export type CarouselDefaults = {
  autoplay: boolean;
  /** Liczba całkowita z zakresu 1000-30000 ms. */
  intervalMs: number;
  // Zarezerwowane (zapisy historyczne): typ przejścia definiują warianty
  // sliderów, więc renderer tego pola nie czyta, a panel go nie pokazuje.
  transition: (typeof CAROUSEL_TRANSITIONS)[number];
  loop: boolean;
  pauseOnHover: boolean;
  /** Liczba całkowita z zakresu 100-3000 ms. */
  speedMs: number;
};

export const CAROUSEL_DEFAULTS: CarouselDefaults = {
  autoplay: true,
  intervalMs: 4500,
  transition: "slide",
  loop: true,
  pauseOnHover: true,
  speedMs: 600,
};

function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function intInRangeOr(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
    ? value
    : fallback;
}

/**
 * Wartość `site_settings.carousel_defaults` sprowadzona do kontraktu POLE PO
 * POLU: niepoprawne pole dostaje wartość domyślną, poprawne zostają.
 *
 * Do 05.10.2026 stał tu `deepMerge` + `safeParse` schematu zod na CAŁYM
 * obiekcie. Jedno złe pole - także zarezerwowane `transition`, którego
 * renderer nie czyta - wywracało walidację: poprawne `autoplay`/`intervalMs`
 * redakcji przepadały na rzecz domyślnych, a zod budował obiekt błędu w
 * `queryFn` każdego slidera (P0.5: 5,6 ms w plastrze K14 po commicie hydratacji
 * na fixture). Ręczne strażniki nie mają ścieżki błędu i nie zależą od zod.
 */
export function normalizeCarouselDefaults(raw: unknown): CarouselDefaults {
  const r =
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const d = CAROUSEL_DEFAULTS;
  return {
    autoplay: boolOr(r.autoplay, d.autoplay),
    intervalMs: intInRangeOr(r.intervalMs, 1000, 30_000, d.intervalMs),
    transition: (CAROUSEL_TRANSITIONS as readonly unknown[]).includes(r.transition)
      ? (r.transition as CarouselDefaults["transition"])
      : d.transition,
    loop: boolOr(r.loop, d.loop),
    pauseOnHover: boolOr(r.pauseOnHover, d.pauseOnHover),
    speedMs: intInRangeOr(r.speedMs, 100, 3000, d.speedMs),
  };
}

const KEY = "carousel_defaults";
const QUERY_KEY = ["site_settings", KEY] as const;

export function useCarouselDefaults() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async ({ client }): Promise<CarouselDefaults> => {
      const settings = await client.ensureQueryData(siteSettingsQueryOptions);
      return normalizeCarouselDefaults(settings[KEY]);
    },
    staleTime: 5 * 60_000,
  });
}

export function useSaveCarouselDefaults() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (next: CarouselDefaults) => {
      const { error } = await supabase
        .from("site_settings")
        .upsert({ key: KEY, value: toJson(next) }, { onConflict: "tenant_id,key" });
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
