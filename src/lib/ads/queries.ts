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
import { Constants, type Database } from "@/integrations/supabase/types";
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

type DbAdPageType = Database["public"]["Enums"]["ad_page_type"];

/**
 * Wartości `ad_page_type`, które zna baza - Z WYGENEROWANYCH TYPÓW, nie z listy
 * pisanej ręcznie.
 *
 * Ręczna lista stała tu z komentarzem „które baza zna DZISIAJ (bez `event`)"
 * i to „dzisiaj" skończyło się migracją `20260823170000_event_front_binding.sql`
 * (`ALTER TYPE public.ad_page_type ADD VALUE 'event'`). Rozjazd był niemy:
 * `dbPageTypes("event")` zwracał `["all"]`, więc kampania sprzedana na stronę
 * wydarzenia nie emitowała się ani razu, a brak reklamy wygląda dokładnie tak
 * samo jak „nikt nie kupił". `Constants` jedzie z tego samego generatora, co typ
 * `DbAdPageType`, więc następna wartość enuma trafia tu razem z regeneracją
 * typów i nie da się jej przeoczyć.
 */
const DB_AD_PAGE_TYPES: readonly DbAdPageType[] = Constants.public.Enums.ad_page_type;

function dbPageTypes(pageType: AdPageType): DbAdPageType[] {
  const known = DB_AD_PAGE_TYPES.find((value) => value === pageType);
  return known === undefined ? ["all"] : ["all", known];
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
    // Filtr wysyła wyłącznie wartości, które baza zna (patrz `DB_AD_PAGE_TYPES`):
    // typ strony dodany po stronie klienta, a jeszcze nie w enumie, wywróciłby
    // całe zapytanie w PostgREST i strona zostałaby bez reklam.
    .in("page_type", dbPageTypes(pageType))
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
