// Zapytanie o okładki-fallbacki sliderów, wydzielone z sliderVariants.tsx:
// importuje je prefetch.ts (ścieżka loadera KAŻDEJ publicznej trasy), a przed
// wydzieleniem ciągnęło to cały ~53 KB renderer sliderów do współdzielonego
// bundla na stronach, które żadnego slidera nie mają.
import { supabase } from "@/integrations/supabase/client";
import { safeImageUrl } from "@/lib/sanitizePure";
import { WIDGET_QUERY_ROOTS } from "@/lib/builder/queryKeys";
import { edgeTtlCache } from "@/lib/ssrCache";
import {
  LATEST_POSTS_SUPERSET_LIMIT,
  fetchLatestPostsSuperset,
} from "@/lib/builder/latestPostsSuperset";

interface FallbackPostImage {
  cover_image_url: string | null;
}

/**
 * Okładki-fallbacki z nadzbioru najnowszych wpisów (SSR, `latestPostsSuperset.ts`)
 * albo `null`, gdy wynik nie byłby dokładny. Zapytanie widgetu bierze `count`
 * najnowszych wpisów Z okładką (`cover_image_url IS NOT NULL`); wpisy z okładką
 * w nadzbiorze są prefiksem tej listy, więc wystarczy ich `count` - albo
 * nadzbiór krótszy niż pojemność (wtedy zawiera wszystkie opublikowane).
 * Błąd odczytu nadzbioru też daje `null`: wołający pyta jak dotąd.
 */
async function fallbackImagesFromLatestSuperset(
  count: number,
): Promise<FallbackPostImage[] | null> {
  if (count > LATEST_POSTS_SUPERSET_LIMIT) return null;
  const superset = await fetchLatestPostsSuperset().catch((): null => null);
  if (superset === null) return null;
  const withCover = superset.filter((row) => row.cover_image_url !== null);
  if (withCover.length < count && superset.length >= LATEST_POSTS_SUPERSET_LIMIT) return null;
  return withCover.slice(0, count).map((row) => ({ cover_image_url: row.cover_image_url }));
}

/** Własne zapytanie okładek-fallbacków (przeglądarka i SSR poza nadzbiorem). */
async function readFallbackImages(count: number): Promise<FallbackPostImage[]> {
  const { data } = await supabase
    .from("posts")
    .select("cover_image_url")
    .eq("status", "published")
    .is("deleted_at", null)
    .not("cover_image_url", "is", null)
    .order("published_at", { ascending: false })
    .limit(count);
  return (data ?? []) as FallbackPostImage[];
}

export function sliderFallbackImagesQueryOptions(fallbackCount: number) {
  const count = Math.max(3, fallbackCount || 3);
  return {
    queryKey: [WIDGET_QUERY_ROOTS.sliderFallbackImages, count] as const,
    queryFn: async (): Promise<string[]> =>
      // Per-isolate TTL: prefetch sliderów biegnie z loaderów tras publicznych;
      // okładki-fallbacki zmieniają się z publikacjami, minuta wystarcza.
      edgeTtlCache(`builder:slider-fallback:${count}`, 60_000, async () => {
        // SSR: okładki to kolejny odczyt „najnowszych opublikowanych" nad
        // zgięciem - na zimnym izolacie z 6 połączeniami Workera dzielą
        // wspólny nadzbiór zamiast własnego round-tripu. Przeglądarka: jak dotąd.
        const rows =
          (import.meta.env.SSR && typeof window === "undefined"
            ? await fallbackImagesFromLatestSuperset(count)
            : null) ?? (await readFallbackImages(count));
        return rows
          .map((row) => safeImageUrl(row.cover_image_url ?? ""))
          .filter((src) => src.length > 0);
      }),
    staleTime: 120_000,
  };
}
