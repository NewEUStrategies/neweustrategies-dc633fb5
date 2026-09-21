// „DEGRADACJA MÓWI PRAWDĘ, ALE LECZY SIĘ SAMA" - domknięcie doktryny
// `lib/ssr/resilientLoad.ts` po stronie KOMPONENTU.
//
// PROBLEM (recenzja PR #382/#383, P1/P2 - zmierzony, nie teoretyczny).
// Loader trasy publicznej, który nie dostał danych, zasiewa fallback
// z `updatedAt: 0` i oddaje `degraded: true`. Zasiew jest natychmiast
// przeterminowany, więc `useQuery`/`useSuspenseQuery` na TYM SAMYM kluczu
// refetchuje po zamontowaniu i prawdziwe dane potrafią dojechać sekundę
// później. Flaga z loadera tego NIE WIDZI: `Route.useLoaderData()` jest
// NIEZMIENNE przez całe życie dopasowania trasy. Czytelnik zostawał więc
// z komunikatem awarii nad kompletną, świeżo dociągniętą listą - aż do
// kolejnej nawigacji, `router.invalidate()` albo przeładowania strony.
//
// Na SERWERZE flaga jest prawdą w momencie renderu i taka ma zostać (render
// musi skończyć się w budżecie; nagłówek `no-store` już wyszedł). W
// PRZEGLĄDARCE prawdą jest STAN ZAPYTANIA, nie wspomnienie po nim.
//
// KONTRAKT TEGO HAKA - trzy zdania:
//   1. `initialDegraded` (z loadera) jest STANEM POCZĄTKOWYM. Na serwerze
//      ORAZ w PIERWSZYM renderze klienta hak oddaje dokładnie tę wartość, więc
//      drzewo porównywane przez React przy hydratacji jest bit w bit tym,
//      które wyszło z serwera - przełączenie następuje dopiero w renderze PO
//      hydratacji. Bramką jest `getServerSnapshot` z `useSyncExternalStore` -
//      ten sam mechanizm, na którym stoi `useHydrated()` routera - a nie
//      `useState` + `useEffect`, bo ten drugi wariant oddaje `false` także
//      w renderze serwerowym trasy renderowanej wyłącznie na kliencie.
//   2. PO hydratacji (i przy każdej nawigacji SPA, gdzie hydratacji nie ma
//      w ogóle) źródłem prawdy jest `dataUpdatedAt` zapytania. `> 0` znaczy
//      „wpis pochodzi z backendu", bo `updatedAt: 0` jest JAWNYM stemplem
//      fallbacku (patrz `loadResilient`) - degradacja znika sama.
//   3. Gdy refetch znowu padnie, `dataUpdatedAt` zostaje zerem, więc komunikat
//      ZOSTAJE - razem z `retry()`, który ponawia DOKŁADNIE to zapytanie, bez
//      nawigacji i bez ponownego biegu loadera.
//
// CZEGO TEN HAK NIE ROBI - powiedziane wprost, bo obietnica szersza niż
// mechanizm jest gorsza od jej braku:
//   * NIE PODNOSI degradacji. Zapytanie, które padło przy CZYSTYM starcie
//     (`initialDegraded === false`), zostaje sprawą komponentu (`isError`,
//     własny komunikat) - inaczej jeden wspólny hak zacząłby po cichu
//     przejmować obsługę błędów siedmiu różnych powierzchni.
//   * NIE POBIERA sam z siebie. Refetch po hydratacji robi obserwator, który
//     i tak stoi na tym kluczu w komponencie (zasiew jest przeterminowany,
//     więc `refetchOnMount` odpala go bez pomocy). Hak, który fetchowałby sam,
//     musiałby znać `queryFn` - a po hydratacji wpis odtworzony z dehydracji
//     jeszcze go nie ma, więc byłby to fetch, który pada na „Missing queryFn".
//     WNIOSEK DLA WOŁAJĄCEGO: gałąź degradacji musi stać POD odczytem
//     zapytania w tym samym komponencie, nie nad nim.
import { useCallback, useSyncExternalStore } from "react";
import { hashKey, useQueryClient } from "@tanstack/react-query";
import type { QueryCache, QueryKey } from "@tanstack/react-query";

/** Wynik haka: uczciwa flaga widoku plus ponowienie bez nawigacji. */
export interface DegradedUntilHealed {
  /** `true` = pokaż komunikat degradacji (SSR albo nieuleczony refetch). */
  readonly degraded: boolean;
  /** Ponów DOKŁADNIE to zapytanie - bez `router.invalidate()` i bez nawigacji. */
  readonly retry: () => void;
}

/**
 * Migawka SERWEROWA. Wartość niemożliwa do wytworzenia przez `readSnapshot`
 * (ten składa liczbę ze stemplem), więc „jesteśmy przed hydratacją" jest
 * rozstrzygalne bez drugiego stanu i bez `useEffect`.
 */
const SSR_SNAPSHOT = "ssr";

/**
 * Migawka zapytania jako PRYMITYW - wymóg `useSyncExternalStore`, który
 * porównuje wynik `getSnapshot` przez `Object.is`. Obiekt składany przy każdym
 * wywołaniu dałby nieskończoną pętlę renderów.
 *
 * Wpisu może nie być w ogóle (klucz wyczyszczony przez `gcTime`) - to nie jest
 * wyleczenie, więc stempel zerowy, tak samo jak dla świeżo zasianego fallbacku.
 */
function readSnapshot(cache: QueryCache, queryHash: string): string {
  const state = cache.get(queryHash)?.state;
  return String(state?.dataUpdatedAt ?? 0);
}

/** Stała funkcja - nowa referencja przy każdym renderze resetowałaby subskrypcję. */
function serverSnapshot(): string {
  return SSR_SNAPSHOT;
}

/**
 * Degradacja z loadera, która leczy się stanem zapytania.
 *
 * @param queryKey klucz TEGO SAMEGO zapytania, które loader zasiał fallbackiem
 *   i które komponent czyta przez `useQuery`/`useSuspenseQuery`. Rozjazd tych
 *   kluczy daje widok, który nigdy się nie wyleczy - pilnuje go reguła W4
 *   bramki `check:loader-policy`.
 * @param initialDegraded flaga z `Route.useLoaderData()`.
 */
export function useDegradedUntilHealed(
  queryKey: QueryKey,
  initialDegraded: boolean,
): DegradedUntilHealed {
  const queryClient = useQueryClient();
  const cache = queryClient.getQueryCache();
  // Fabryki opcji (`xQueryOptions(...)`) oddają NOWĄ tablicę przy każdym
  // renderze, więc tożsamością haka jest hash klucza, a nie sama tablica.
  const queryHash = hashKey(queryKey);

  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      cache.subscribe((event) => {
        if (event.query.queryHash === queryHash) onStoreChange();
      }),
    [cache, queryHash],
  );
  const getSnapshot = useCallback(() => readSnapshot(cache, queryHash), [cache, queryHash]);

  const snapshot = useSyncExternalStore(subscribe, getSnapshot, serverSnapshot);

  const retry = useCallback(() => {
    // Po HASHU, nie po tablicy klucza: filtr `queryKey` wymagałby tablicy
    // w zależnościach `useCallback`, a ta jest nowa w każdym renderze.
    void queryClient.refetchQueries({ predicate: (query) => query.queryHash === queryHash });
  }, [queryClient, queryHash]);

  // PRZED hydratacją oddajemy wartość serwerową - patrz punkt 1 kontraktu.
  const healed = snapshot !== SSR_SNAPSHOT && snapshot !== "0";
  return { degraded: initialDegraded && !healed, retry };
}
