import { useEffect, useRef } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { SectionNode } from "@/lib/builder/types";
import type { Lang } from "@/lib/builder/postListQuery";
import {
  collectSectionWidgets,
  prefetchSectionQueries,
  sectionCacheTargets,
} from "@/lib/builder/prefetch";
import { whenIdle, type CancelIdle } from "@/lib/ads/idle";

/**
 * Najpóźniejszy moment startu prefetchu sekcji. Praca jest z definicji
 * wyprzedzająca (sekcja jest jeszcze pod zgięciem), więc może poczekać na
 * bezczynny wątek główny - ale nie w nieskończoność, bo czytelnik przewijający
 * bez przerwy nigdy nie dałby przeglądarce chwili ciszy.
 */
const PREFETCH_IDLE_TIMEOUT_MS = 2000;

/**
 * Wyprzedzenie obserwatora. 1200 px na desktopie; na telefonie tyle, co ~dwa
 * ekrany, daje sekcje grzane długo przed tym, zanim czytelnik w ogóle skręci w
 * ich stronę - a każda taka sekcja to zapytania i CPU na urządzeniu, które ma
 * go najmniej. Stąd 600 px poniżej progu `md`.
 */
function defaultRootMargin(): string {
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    if (window.matchMedia("(max-width: 767px)").matches) return "600px 0px";
  }
  return "1200px 0px";
}

/**
 * Per-(QueryClient, section, lang) dedupe registry. A section that has already
 * been prefetched during the current client lifetime is never prefetched again;
 * świeżość danych sprawdza `isSectionFresh` PRZED rejestrem, więc rejestr nie
 * maskuje już sekcji, której dane przyjechały z SSR.
 *
 * Using a WeakMap keyed by QueryClient means the registry is automatically
 * disposed alongside the client (e.g. when a new SSR request mints a fresh
 * QueryClient) and never leaks across requests.
 */
const sectionPrefetchRegistry = new WeakMap<QueryClient, Set<string>>();

function registryFor(client: QueryClient): Set<string> {
  let set = sectionPrefetchRegistry.get(client);
  if (!set) {
    set = new Set<string>();
    sectionPrefetchRegistry.set(client, set);
  }
  return set;
}

function dedupeKey(section: SectionNode, lang: Lang): string {
  return `${section.id}::${lang}`;
}

/**
 * Stale-while-revalidate gate: a section is "fresh" when EVERY query it owns
 * has cached data whose age is below the matching `staleTime`. In that case
 * we skip the prefetch entirely - the cached payload renders synchronously
 * and TanStack Query revalidates on its own schedule.
 */
export function isSectionFresh(client: QueryClient, section: SectionNode, lang: Lang): boolean {
  const widgets = collectSectionWidgets(section);
  const targets = sectionCacheTargets(widgets, lang);
  if (targets.length === 0) return true;
  const now = Date.now();
  return targets.every(({ key, staleTime }) => {
    const state = client.getQueryState(key);
    if (!state || state.data === undefined) return false;
    return now - state.dataUpdatedAt < staleTime;
  });
}

/**
 * Lazy per-section data preloading with SWR-style caching.
 *
 * - SSR-safe: bails out when `window`/`IntersectionObserver` are unavailable.
 * - Idempotent across navigations: the section + lang pair is recorded against
 *   the active QueryClient, so revisiting the same page never re-fires the
 *   same prefetch.
 * - Cache-aware: if every underlying query is still fresh (within staleTime),
 *   prefetch is skipped entirely - niezależnie od rejestru, więc sekcja z
 *   danymi z SSR nie płaci za prefetch przy pierwszej wizycie (F39).
 * - Idle-scheduled: sama praca prefetchu jedzie przez `whenIdle`, żeby nie
 *   startowała w klatce przewijania, w której obserwator ją zauważył.
 */
export function useSectionPreload(
  section: SectionNode,
  lang: Lang,
  options: { rootMargin?: string; enabled?: boolean } = {},
): React.RefObject<HTMLElement | null> {
  // Wyprzedzenie obserwatora (domyślnie 1200 px, na telefonie 600 px - patrz
  // `defaultRootMargin`): dane sekcji startują, zanim wjedzie w kadr, więc są
  // ciepłe, gdy czytelnik do niej dojedzie.
  //
  // Od 2026-09-01 to jest ŚCIEŻKA GŁÓWNA dla sekcji spod zgięcia, nie tylko
  // ogon awaryjny: publiczne trasy edge-cache'owane (`$.tsx` oraz strona
  // główna) blokują SSR wyłącznie na `ABOVE_FOLD_SECTION_COUNT` pierwszych
  // sekcjach, a resztę albo dostrumieniowuje `ServerSectionGate` w renderze
  // serwerowym, albo - po hydratacji i przy nawigacji SPA - dogrzewa właśnie
  // ten obserwator. Wcześniej stało tu, że „trasy edge-cache'owane renderują
  // serwerowo CAŁY dokument przez prefetchCachedRouteQueries"; ta funkcja
  // grzeje dziś już tylko chrome (header/footer) w loaderze korzenia.
  // Domyślny margines liczymy W EFEKCIE (`defaultRootMargin`), nie w renderze:
  // `matchMedia` na serwerze nie istnieje, a wartość i tak jest potrzebna
  // dopiero obserwatorowi.
  const { rootMargin, enabled = true } = options;
  const ref = useRef<HTMLElement | null>(null);
  const queryClient = useQueryClient();
  const didPrefetchRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    if (didPrefetchRef.current) return;
    if (typeof window === "undefined") return;

    const registry = registryFor(queryClient);
    const key = dedupeKey(section, lang);

    const run = () => {
      if (didPrefetchRef.current) return;
      didPrefetchRef.current = true;
      // ŚWIEŻOŚĆ PRZED REJESTREM (F39). Stary warunek brzmiał
      // `registry.has(key) && isSectionFresh(...)`, a przy PIERWSZEJ wizycie
      // rejestr jest z definicji pusty - koniunkcja ucinała się na pierwszym
      // członie i `isSectionFresh` nigdy nie dochodziło do głosu. Sekcja
      // wyrenderowana serwerowo, z danymi w cache'u, i tak dostawała pełny
      // `prefetchQuery`: budowanie opcji i obietnic (CPU) zaraz po hydratacji,
      // a dla wpisów zastępczych po zdegradowanym SSR - realny ruch sieciowy.
      if (isSectionFresh(queryClient, section, lang)) return;
      // Rejestr zostaje TYLKO dla powtórnych nawigacji: prefetch tej pary już
      // w tym kliencie poszedł, więc drugi raz go nie powtarzamy. Gdyby dane
      // zdążyły się zestarzeć, odświeży je `useQuery` samej sekcji przy
      // montażu (`refetchOnMount` jest domyślnie włączone).
      if (registry.has(key)) return;
      registry.add(key);
      void prefetchSectionQueries(queryClient, section, lang);
    };

    // Prefetch NIE startuje w tej samej klatce, co przecięcie z obserwatorem:
    // callback `IntersectionObserver` biegnie w trakcie przewijania, a
    // `prefetchSectionQueries` to budowa opcji zapytań i start obietnic dla
    // całej sekcji. `whenIdle` przesuwa tę pracę na bezczynny wątek główny
    // (najpóźniej po `PREFETCH_IDLE_TIMEOUT_MS`), więc nie ląduje w oknie
    // mierzonym jako zacięcie przewijania.
    let cancelIdle: CancelIdle | null = null;
    const schedule = () => {
      if (didPrefetchRef.current || cancelIdle) return;
      cancelIdle = whenIdle(() => {
        cancelIdle = null;
        run();
      }, PREFETCH_IDLE_TIMEOUT_MS);
    };

    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      schedule();
      return () => cancelIdle?.();
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            schedule();
            observer.disconnect();
            break;
          }
        }
      },
      { rootMargin: rootMargin ?? defaultRootMargin(), threshold: 0 },
    );
    observer.observe(el);
    return () => {
      cancelIdle?.();
      observer.disconnect();
    };
  }, [enabled, lang, queryClient, rootMargin, section]);

  return ref;
}

/** Test-only: clear the dedupe registry for a given client. */
export function __resetSectionPrefetchRegistry(client: QueryClient): void {
  sectionPrefetchRegistry.delete(client);
}
