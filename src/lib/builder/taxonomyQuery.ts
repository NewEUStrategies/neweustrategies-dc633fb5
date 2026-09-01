// Warstwa danych widgetów taksonomii (`categories` / `tags`).
//
// PO CO OSOBNY MODUŁ. Oba zapytania były pisane WPROST w widokach
// (`CategoriesView` / `TagsView`), więc rejestr prefetchu SSR
// (`prefetch.widgetQueryOptionsList`) nie miał jak ich zobaczyć: dla obu typów
// zwracał pustą listę. Konsekwencje były DWIE, obie ciche:
//   1. loader nie grzał żadnego wpisu cache, więc serwer renderował pustą listę
//      chipów, a prawdziwe kategorie/tagi wskakiwały po hydratacji i osobnym
//      fetchu (skok układu w miejscu, które ma nawigować po serwisie),
//   2. `shouldStreamSection` (sectionStreaming.tsx) bramkuje strumieniowanie na
//      NIEPUSTEJ liście zapytań sekcji - sekcja z samymi chipami liczyła się
//      jako statyczna, więc nawet `ServerSectionGate` nie miał na co czekać.
// Ten sam wzorzec, co `clubsQuery.ts` / `eventsQuery.ts`: JEDNE `queryOptions`
// jako źródło prawdy dla klucza, czytane przez rejestr prefetchu.
//
// JĘZYK CELOWO NIE WCHODZI DO KLUCZA. `select` pobiera OBA języki
// (`name_pl` + `name_en`), a wybór wersji następuje w renderze. Klucz z
// językiem trzymałby dwa identyczne wpisy cache i kazał każdej wersji płacić
// osobne zapytanie za te same wiersze - patrz komentarz przy `LANG_TOKEN`
// w `lib/builder/ci/localizedQueryKeys.ts`, który wskazuje DOKŁADNIE te dwa
// widgety jako wzorzec POPRAWNY.
//
// UWAGA O PODWÓJNYM ZAPISIE ZAPYTANIA. Widoki nadal mają własne, dosłownie
// takie samo `useQuery` - przełączenie ich na te fabryki jest osobną zmianą
// w `components/builder/organisms/widget-view/`. Klucz jest ten sam literał
// z `WIDGET_QUERY_ROOTS`, więc rozgrzany wpis TRAFIA w odczyt widgetu, ale
// `select` istnieje w dwóch kopiach. Dryf tych kopii pilnuje statyczna asercja
// w `__tests__/sectionPrefetch.test.ts` ("bramka dryfu": czyta pliki widoków
// i porównuje literały) - bez niej zmiana kolumny w widoku po cichu zatruwałaby
// cache SSR wierszami o innym kształcie.
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { WIDGET_QUERY_ROOTS } from "@/lib/builder/queryKeys";

/**
 * Kolumny czytane przez widoki - eksportowane, bo statyczna bramka parytetu
 * porównuje ten literał z tym, co stoi w `CategoriesView` / `TagsView`.
 */
export const CATEGORY_CHIP_COLUMNS = "id, slug, name_pl, name_en";
export const TAG_CHIP_COLUMNS = "id, slug, name";

/**
 * Świeżość taksonomii. Widoki nie deklarowały `staleTime`, więc obowiązywała
 * DOMYŚLNA wartość klienta zapytań (`router.tsx`: `staleTime: 5 * 60_000`) -
 * ta stała jest jej jawnym powtórzeniem, żeby semantyka świeżości NIE ZMIENIŁA
 * SIĘ, a `widgetCacheTargets` mogło podać prawdziwą liczbę zamiast zera
 * z `coerceStaleTime(undefined)`. Przy zerze bramka SWR
 * (`useSectionPreload.isSectionFresh`) uznawałaby taką sekcję za przestarzałą
 * po KAŻDYM renderze i grzała ją w kółko.
 */
const TAXONOMY_STALE_MS = 5 * 60_000;

export function categoriesQueryOptions() {
  return queryOptions({
    // Korzeń z WIDGET_QUERY_ROOTS - ten sam literał zasila zbiór inwalidacji
    // live (LIVE_INVALIDATED_ROOTS), więc zmiana kategorii faktycznie odświeża
    // ten widget.
    queryKey: [WIDGET_QUERY_ROOTS.categories] as const,
    staleTime: TAXONOMY_STALE_MS,
    // Bez `throw` na błędzie - dokładnie jak w widoku: pusta lista chipów jest
    // poprawnym stanem, a rzucenie zamieniłoby brak taksonomii w błąd sekcji.
    queryFn: async () =>
      (await supabase.from("categories").select(CATEGORY_CHIP_COLUMNS)).data ?? [],
  });
}

export function tagsQueryOptions() {
  return queryOptions({
    // Jw. - korzeń z WIDGET_QUERY_ROOTS zasila inwalidację live tagów.
    queryKey: [WIDGET_QUERY_ROOTS.tags] as const,
    staleTime: TAXONOMY_STALE_MS,
    queryFn: async () => (await supabase.from("tags").select(TAG_CHIP_COLUMNS)).data ?? [],
  });
}
