// Publiczne zapytania o aktywne reklamy do wyświetlenia czytelnikom.
//
// Okno czasowe emisji (starts_at/ends_at) jest filtrowane także tutaj, a nie
// tylko w publicznym RLS - inaczej staff (który przechodzi przez politykę
// "manage") widział na froncie wygasłe i jeszcze nierozpoczęte emisje.
// Targeting slotu (kategorie/tagi/język z ad_slots.targeting) dopasowujemy
// client-side po pobraniu - lista placementów per pozycja jest krótka.
import { queryOptions, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { edgeTtlCache } from "@/lib/ssrCache";
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

/**
 * JEDNA definicja zapytania o placementy - dla loadera (rozgrzewka SSR) i dla
 * komponentu (`useAdPlacements`).
 *
 * PO CO FABRYKA, skoro hook i tak wołał `useQuery` z literałem. Bo dopóki klucz
 * i `queryFn` żyły WYŁĄCZNIE wewnątrz hooka, rozgrzewka serwerowa musiałaby
 * powtórzyć jedno i drugie u siebie - a dwa literały klucza to dwa wpisy cache'u
 * i rozgrzewka, która nigdy nie trafia do komponentu. Sloty dochodziły więc po
 * hydratacji, a baner `header_banner` (90 px nad treścią) spychał stronę w dół:
 * ~0,11 CLS, najdroższa pojedyncza pozycja audytu CWV 2026-09-20 (F26).
 * Kontrakt: klucz i `queryFn` MAJĄ ŻYĆ TUTAJ, hook ma ich UŻYWAĆ - nie kopiować.
 *
 * `edgeTtlCache` jest przezroczysty w przeglądarce (`typeof window !== "undefined"`
 * -> natychmiastowe `fetcher()`), więc dokłada się wyłącznie w SSR: równoległe
 * rendery tej samej pozycji dzielą jeden round-trip, a w oknie 60 s izolat nie
 * pyta bazy ponownie. TTL jest równy `staleTime` zapytania - to ta sama
 * obietnica świeżości powiedziana dwa razy, po obu stronach granicy.
 */
export function adPlacementsQueryOptions(
  position: AdPosition,
  pageType: AdPageType,
  pageId?: string | null,
) {
  const id = pageId ?? null;
  return queryOptions<AdPlacementWithSlot[]>({
    // Klucz bez języka/kontekstu treści: fetch jest współdzielony, a filtr
    // targetingu działa per obserwator w `select` (react-query v5).
    queryKey: ["ad_placements", position, pageType, id],
    queryFn: () =>
      edgeTtlCache(`ad_placements:${position}:${pageType}:${id ?? "-"}`, 60_000, () =>
        fetchPlacements({ position, pageType, pageId: id }),
      ),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
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
    ...adPlacementsQueryOptions(position, pageType, pageId),
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
