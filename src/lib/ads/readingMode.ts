// Tryb czytania artykułu: globalny, między-strefowy budżet reklam
// (P0 z OCENA_MODULOW_2026-07-20 §1.5: "maks 2 strefy reklam dla
// niezalogowanych i 0-1 dla płacących").
//
// Dotąd każda strefa decydowała o sobie (MidPostAds ma własny limit 2,
// FooterSlideup bierze 1 kreację), ale nic nie ograniczało ŁĄCZNEJ liczby
// stref na stronie artykułu - czytelnik dostawał top + mid + sidebar +
// bottom + slideup naraz. Budżet nadaje strefom stały priorytet i wycina
// wszystko poza N najważniejszymi; N zależy od tego, czy czytelnik ma
// płatny plan (useCurrentTier, rank > 0).
//
// Ustawienia redakcyjne żyją w site_settings["reading"] (bez migracji),
// edycja w /admin/settings/reading.
import { useCallback } from "react";
import { useCurrentTier } from "@/lib/billing/tiers";
import { useSiteSetting } from "@/lib/useSiteSetting";
import type { AdPosition } from "@/lib/ads/types";

export interface ReadingAdSettings {
  /** Wyłącznik całości - false przywraca dotychczasowe zachowanie. */
  reading_mode_ads: boolean;
  /** Budżet stref dla czytelników bez płatnego planu (w tym gości). */
  max_ad_zones_free: number;
  /** Budżet stref dla płacących członków (0 = zero reklam w artykule). */
  max_ad_zones_paid: number;
}

export const READING_AD_DEFAULTS: ReadingAdSettings = {
  reading_mode_ads: true,
  max_ad_zones_free: 2,
  max_ad_zones_paid: 1,
};

/**
 * Kolejność ważności stref na stronie artykułu - budżet N wpuszcza strefy
 * o priorytecie < N. Góra strony ma najwyższą wartość (widoczna zawsze),
 * pasek dolny najniższą (najbardziej inwazyjny w czytaniu).
 */
export const POST_AD_PRIORITY: Partial<Record<AdPosition, number>> = {
  top_of_post: 0,
  mid_post: 1,
  sidebar: 2,
  bottom_of_post: 3,
  footer_slideup: 4,
};

function clampBudget(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(8, Math.round(n)));
}

/**
 * Zwraca predykat "czy strefa mieści się w budżecie trybu czytania".
 * Zanim ranga planu się rozstrzygnie, przyjmujemy budżet PŁACĄCEGO -
 * lepiej pokazać płacącemu o jedną reklamę za mało przez chwilę niż
 * mignąć mu pełnym torem przeszkód (strefy i tak dociągają się leniwie).
 */
export function useReadingAdBudget(): (position: AdPosition) => boolean {
  const settings = useSiteSetting<Record<string, unknown>>(
    "reading",
    READING_AD_DEFAULTS as unknown as Record<string, unknown>,
  );
  const tierQ = useCurrentTier();

  const enabled =
    typeof settings.reading_mode_ads === "boolean"
      ? settings.reading_mode_ads
      : READING_AD_DEFAULTS.reading_mode_ads;
  const maxFree = clampBudget(settings.max_ad_zones_free, READING_AD_DEFAULTS.max_ad_zones_free);
  const maxPaid = clampBudget(settings.max_ad_zones_paid, READING_AD_DEFAULTS.max_ad_zones_paid);
  const paying = tierQ.isPending ? true : (tierQ.data?.rank ?? 0) > 0;
  const budget = enabled ? (paying ? maxPaid : maxFree) : Number.POSITIVE_INFINITY;

  return useCallback(
    (position: AdPosition) => {
      const priority = POST_AD_PRIORITY[position];
      if (priority === undefined) return true;
      return priority < budget;
    },
    [budget],
  );
}
