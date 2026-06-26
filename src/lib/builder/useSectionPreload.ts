import { useEffect, useRef } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { SectionNode } from "@/lib/builder/types";
import type { Lang } from "@/lib/builder/postListQuery";
import {
  collectSectionWidgets,
  prefetchSectionQueries,
  sectionCacheTargets,
} from "@/lib/builder/prefetch";

/**
 * Per-(QueryClient, section, lang) dedupe registry. A section that has already
 * been prefetched during the current client lifetime is never prefetched again
 * unless every one of its underlying queries has expired its `staleTime`.
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
export function isSectionFresh(
  client: QueryClient,
  section: SectionNode,
  lang: Lang,
): boolean {
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
 *   prefetch is skipped entirely. Stale entries are refreshed in the
 *   background while the cached payload renders instantly.
 */
export function useSectionPreload(
  section: SectionNode,
  lang: Lang,
  options: { rootMargin?: string; enabled?: boolean } = {},
): React.RefObject<HTMLElement | null> {
  const { rootMargin = "600px 0px", enabled = true } = options;
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
      // SWR gate: skip when every query is still fresh.
      if (registry.has(key) && isSectionFresh(queryClient, section, lang)) {
        return;
      }
      registry.add(key);
      void prefetchSectionQueries(queryClient, section, lang);
    };

    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      run();
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            run();
            observer.disconnect();
            break;
          }
        }
      },
      { rootMargin, threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled, lang, queryClient, rootMargin, section]);

  return ref;
}

/** Test-only: clear the dedupe registry for a given client. */
export function __resetSectionPrefetchRegistry(client: QueryClient): void {
  sectionPrefetchRegistry.delete(client);
}
