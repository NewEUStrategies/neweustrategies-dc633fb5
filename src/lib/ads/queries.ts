// Publiczne zapytania o aktywne reklamy do wyświetlenia czytelnikom.
//
// Okno czasowe emisji (starts_at/ends_at) jest filtrowane także tutaj, a nie
// tylko w publicznym RLS - inaczej staff (który przechodzi przez politykę
// "manage") widział na froncie wygasłe i jeszcze nierozpoczęte emisje.
// Targeting slotu (kategorie/tagi/język z ad_slots.targeting) dopasowujemy
// client-side po pobraniu - lista placementów per pozycja jest krótka.
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import {
  matchesAdTargeting,
  parseAdTargeting,
  type AdLanguage,
  type AdPageType,
  type AdPlacementWithSlot,
  type AdPosition,
} from "./types";

interface FetchArgs {
  position: AdPosition;
  pageType: AdPageType;
  pageId?: string | null;
}

/** Kontekst treści dla targetingu - podawany na stronach postów. */
export interface AdContentContext {
  categorySlugs?: string[];
  tagSlugs?: string[];
}

async function fetchPlacements({
  position,
  pageType,
  pageId,
}: FetchArgs): Promise<AdPlacementWithSlot[]> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("ad_placements")
    .select("*, slot:ad_slots!inner(*)")
    .eq("position", position)
    .in("page_type", ["all", pageType])
    .eq("active", true)
    .eq("slot.status", "active")
    .or(`starts_at.is.null,starts_at.lte.${nowIso}`)
    .or(`ends_at.is.null,ends_at.gte.${nowIso}`)
    .order("sort_order");

  if (error) throw error;
  // Filtrujemy page_id po stronie klienta - jeśli placement ma page_id ≠ null, musi pasować.
  return ((data as AdPlacementWithSlot[]) ?? []).filter(
    (p) => p.page_id == null || p.page_id === pageId,
  );
}

export function useAdPlacements(
  position: AdPosition,
  pageType: AdPageType,
  pageId?: string | null,
  content?: AdContentContext,
) {
  const { i18n } = useTranslation();
  const language: AdLanguage = i18n.language === "en" ? "en" : "pl";
  const categorySlugs = content?.categorySlugs ?? [];
  const tagSlugs = content?.tagSlugs ?? [];

  return useQuery({
    // Klucz bez języka/kontekstu treści: fetch jest współdzielony, a filtr
    // targetingu działa per obserwator w `select` (react-query v5).
    queryKey: ["ad_placements", position, pageType, pageId ?? null],
    queryFn: () => fetchPlacements({ position, pageType, pageId }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    select: (placements) =>
      placements.filter((p) =>
        matchesAdTargeting(parseAdTargeting(p.slot.targeting), {
          categorySlugs,
          tagSlugs,
          language,
        }),
      ),
  });
}
