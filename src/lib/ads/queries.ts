// Publiczne zapytania o aktywne reklamy do wyświetlenia czytelnikom.
//
// Okno czasowe emisji (starts_at/ends_at) jest filtrowane także tutaj, a nie
// tylko w publicznym RLS - inaczej staff (który przechodzi przez politykę
// "manage") widział na froncie wygasłe i jeszcze nierozpoczęte emisje.
// Targeting slotu (kategorie/tagi/język z ad_slots.targeting) dopasowujemy
// client-side po pobraniu - lista placementów per pozycja jest krótka.
import { queryOptions, useQuery, type QueryClient } from "@tanstack/react-query";
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

/**
 * JEDEN round-trip po wiersze DOWOLNEJ liczby pozycji naraz.
 *
 * PO CO LISTA POZYCJI, SKORO WIDOK PYTA O JEDNĄ. Bo rozgrzewka SSR pyta o
 * KILKA (baner nagłówka + slot nad treścią), a limit runtime Cloudflare Workers
 * to 6 równoległych podżądań na żądanie - loader trasy treści ma już 5 odnóg
 * w fali wtórnej (bramka `check:ssr-budgets`, sufit `parallelQueriesPerLoader`).
 * Dwie osobne rozgrzewki nie zmieściłyby się w tym budżecie; jedno zapytanie
 * `position=in.(...)` mieści się w jednej odnodze i kosztuje jeden round-trip.
 *
 * `page_id` NIE jest filtrowane w bazie - i to nie jest niedopatrzenie, tylko
 * warunek, na którym stoi współdzielenie tego zapytania: ten sam wiersz
 * wyników obsługuje projekcję BEZ identyfikatora strony (klucz banera
 * nagłówka) i projekcję Z identyfikatorem (klucze pozycji w treści). Odsiew
 * robi `placementsForPage` poniżej, po stronie klienta, dokładnie tak jak
 * przedtem.
 */
async function fetchPlacementRows(
  positions: readonly AdPosition[],
  pageType: AdPageType,
): Promise<AdPlacementWithSlot[]> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("ad_placements")
    .select("*, slot:ad_slots!inner(*)")
    .in("position", positions as AdPosition[])
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
  return (data as AdPlacementWithSlot[]) ?? [];
}

/**
 * Projekcja wierszy na JEDNĄ pozycję i JEDEN identyfikator strony - dokładnie
 * to, co widok czyta spod klucza `["ad_placements", position, pageType, id]`.
 * Placement przypięty do innej strony (`page_id ≠ null`) nie wchodzi.
 */
function placementsForPage(
  rows: readonly AdPlacementWithSlot[],
  position: AdPosition,
  pageId: string | null,
): AdPlacementWithSlot[] {
  return rows.filter(
    (p) => p.position === position && (p.page_id == null || p.page_id === pageId),
  );
}

async function fetchPlacements({
  position,
  pageType,
  pageId,
}: FetchArgs): Promise<AdPlacementWithSlot[]> {
  const rows = await fetchPlacementRows([position], pageType);
  return placementsForPage(rows, position, pageId ?? null);
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

/** Jedna pozycja do rozgrzania razem z `pageId`, POD KTÓRYM CZYTA JĄ WIDOK. */
export interface AdWarmTarget {
  readonly position: AdPosition;
  /**
   * `null`/`undefined` = klucz BEZ identyfikatora strony. Tak czyta baner
   * nagłówka (`Header` renderuje `<AdZone position="header_banner">` bez
   * `pageId`); pozycje w treści czytają klucz Z identyfikatorem wpisu/strony.
   * Rozjazd tej wartości z widokiem oznacza rozgrzany klucz, którego nikt nie
   * czyta - czyli round-trip za nic.
   */
  readonly pageId?: string | null;
}

/**
 * ROZGRZEWKA SSR KILKU POZYCJI ZA JEDEN ROUND-TRIP (audyt CWV 2026-09-20, F26).
 *
 * CO NAPRAWIA. `AdZone` bez danych zwraca `null`, a `AdContainer` rezerwuje
 * wtedy ZERO pikseli - slot dojeżdża więc po hydratacji i spycha treść w dół.
 * Korzeń grzeje `header_banner` tylko tam, gdzie typ strony rozstrzyga sam
 * adres (`__root.tsx`); na trasie łapiącej wszystko typ zna dopiero loader
 * treści, więc baner nagłówka ORAZ slot nad treścią startowały tam dopiero
 * w przeglądarce.
 *
 * DLACZEGO JEDNO WYWOŁANIE, A NIE DWA `prefetchQuery`. Fala wtórna loadera
 * `$.tsx` ma 5 odnóg przy sufcie 6 (`check:ssr-budgets`,
 * `parallelQueriesPerLoader` - twardy limit 6 równoległych podżądań runtime
 * Cloudflare Workers). Dwie rozgrzewki to dwie odnogi i siódme podżądanie
 * w szczycie; jedno zapytanie `position=in.(...)` mieści się w JEDNEJ odnodze
 * i w JEDNYM round-tripie, a rozdziela je `placementsForPage` po stronie
 * klienta - na te same klucze, które czyta `useAdPlacements`.
 *
 * NIGDY NIE ODRZUCA I NIGDY NIE ZGŁASZA DEGRADACJI. Reklama jest DEKORACJĄ:
 * brak banera degraduje wyłącznie rezerwację jego własnych pikseli, więc nie
 * ma prawa zdjąć wspólnego cache'u całego dokumentu. To ta sama doktryna, którą
 * korzeń zapisał przy `chromeQueryKeys` (`__root.tsx`: klucz reklamy CELOWO nie
 * wchodzi do listy rozstrzygającej o świeżości dokumentu).
 */
export async function prefetchAdPlacementQueries(
  queryClient: QueryClient,
  targets: readonly AdWarmTarget[],
  pageType: AdPageType,
): Promise<void> {
  // Pozycje posortowane i bez duplikatów - klucz cache'u izolatu ma być ten sam
  // niezależnie od kolejności, w jakiej wołający wymienił sloty.
  const positions = [...new Set(targets.map((t) => t.position))].sort();
  if (positions.length === 0) return;
  try {
    const rows = await edgeTtlCache(
      // Prefiks `multi:` oddziela ten wpis od kluczy jednopozycyjnych wyżej -
      // te niosą jeszcze `pageId`, ten świadomie go nie zna (patrz
      // `fetchPlacementRows`).
      `ad_placements:multi:${positions.join("+")}:${pageType}`,
      60_000,
      () => fetchPlacementRows(positions, pageType),
    );
    for (const target of targets) {
      const id = target.pageId ?? null;
      // `setQueryData` bez `updatedAt: 0`: to są PRAWDZIWE wiersze, nie zasiew
      // fallbackowy. Wpis ma się urodzić świeży, inaczej przeglądarka
      // powtórzyłaby round-trip zaraz po hydratacji i cała rozgrzewka nie
      // zdjęłaby ani jednego skoku układu.
      queryClient.setQueryData(
        adPlacementsQueryOptions(target.position, pageType, id).queryKey,
        placementsForPage(rows, target.position, id),
      );
    }
  } catch {
    /* patrz wyżej: slot bez danych wraca do fetcha po hydratacji, jak dotąd */
  }
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
