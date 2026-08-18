// Zapytanie o okładki-fallbacki sliderów, wydzielone z sliderVariants.tsx:
// importuje je prefetch.ts (ścieżka loadera KAŻDEJ publicznej trasy), a przed
// wydzieleniem ciągnęło to cały ~53 KB renderer sliderów do współdzielonego
// bundla na stronach, które żadnego slidera nie mają.
import { supabase } from "@/integrations/supabase/client";
import { safeImageUrl } from "@/lib/sanitizePure";
import { WIDGET_QUERY_ROOTS } from "@/lib/builder/queryKeys";
import { edgeTtlCache } from "@/lib/ssrCache";

interface FallbackPostImage {
  cover_image_url: string | null;
}

export function sliderFallbackImagesQueryOptions(fallbackCount: number) {
  const count = Math.max(3, fallbackCount || 3);
  return {
    queryKey: [WIDGET_QUERY_ROOTS.sliderFallbackImages, count] as const,
    queryFn: async (): Promise<string[]> =>
      // Per-isolate TTL: prefetch sliderów biegnie z loaderów tras publicznych;
      // okładki-fallbacki zmieniają się z publikacjami, minuta wystarcza.
      edgeTtlCache(`builder:slider-fallback:${count}`, 60_000, async () => {
        const { data } = await supabase
          .from("posts")
          .select("cover_image_url")
          .eq("status", "published")
          .is("deleted_at", null)
          .not("cover_image_url", "is", null)
          .order("published_at", { ascending: false })
          .limit(count);
        return ((data ?? []) as FallbackPostImage[])
          .map((row) => safeImageUrl(row.cover_image_url ?? ""))
          .filter((src) => src.length > 0);
      }),
    staleTime: 120_000,
  };
}
