import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { SectionNode } from "@/lib/builder/types";
import type { Lang } from "@/lib/builder/postListQuery";
import { prefetchSectionQueries } from "@/lib/builder/prefetch";

/**
 * Lazy per-section data preloading.
 *
 * Attaches an IntersectionObserver to the section element and prefetches all
 * data-bound queries (post lists, slider refs, fallback images) ~one viewport
 * before the section scrolls into view. This keeps the initial paint cheap
 * while ensuring widgets below the fold are warm by the time they appear.
 *
 * - SSR-safe: bails out when `window`/`IntersectionObserver` are unavailable.
 * - Idempotent: prefetch runs at most once per section per mount.
 * - Cooperative: TanStack Query dedupes against loader-level prefetches, so
 *   wiring this hook alongside `prefetchBuilderDocumentQueries` is safe.
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
    const el = ref.current;
    if (typeof window === "undefined") return;

    const run = () => {
      if (didPrefetchRef.current) return;
      didPrefetchRef.current = true;
      void prefetchSectionQueries(queryClient, section, lang);
    };

    // No IO support (very old browsers, jsdom): prefetch immediately.
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
