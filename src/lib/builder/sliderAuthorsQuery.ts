// Zapytanie o autorów slajdów (nazwisko + awatar do byline hero) - jedno
// źródło prawdy współdzielone przez widget (PostsSliderWidget) i rejestr
// prefetch SSR (lib/builder/prefetch). Dopóki żyło inline w komponencie,
// serwer nie miał jak go rozgrzać: hero renderował się bez byline, a nazwisko
// i awatar wskakiwały dopiero po hydratacji + fetchu - widoczny "doskok"
// wewnątrz obszaru LCP na najczęściej odwiedzanej trasie serwisu.
//
// IZOLACJA NAJEMCY: czytamy `profiles_public`, nie tabelę `profiles`. Widok
// jest zawężony do `public_tenant_id()` i wystawia wyłącznie kolumny
// publiczne, więc slider jednej firmy nie ma jak pokazać (ani pobrać) profilu
// z obszaru roboczego innej - nawet gdyby `author_id` wpisu wskazywał poza
// najemcę. Ten sam widok czyta post-lista (`attachAuthorNames`) i widget
// rekomendacji, więc kontrakt danych autora jest jeden.
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { SliderPostRow } from "@/lib/builder/sliderPostsQuery";

export interface SliderAuthorInfo {
  name: string;
  avatar: string;
  slug: string;
}

/**
 * Zdeduplikowane id autorów w kolejności slajdów. Kolejność jest CZĘŚCIĄ
 * kontraktu klucza zapytania: prefetch SSR i widget muszą wyprowadzić
 * IDENTYCZNĄ listę z tych samych wierszy, inaczej klient po hydratacji
 * chybiłby rozgrzany wpis i fetchował drugi raz.
 */
export function sliderAuthorIds(items: readonly SliderPostRow[] | undefined): string[] {
  return Array.from(
    new Set((items ?? []).map((p) => p.author_id).filter((x): x is string => Boolean(x))),
  );
}

/** Rekord zamiast Map: prosty do serializacji w dehydratowanym payloadzie SSR. */
async function fetchSliderAuthors(authorIds: string[]): Promise<Record<string, SliderAuthorInfo>> {
  const { data } = await supabase
    .from("profiles_public")
    .select("id, display_name, first_name, last_name, avatar_url, slug")
    .in("id", authorIds);
  const map: Record<string, SliderAuthorInfo> = {};
  (data ?? []).forEach((row) => {
    const r = row as {
      id: string;
      display_name: string | null;
      first_name: string | null;
      last_name: string | null;
      avatar_url: string | null;
      slug: string | null;
    };
    const composed = [r.first_name, r.last_name].filter(Boolean).join(" ").trim();
    map[r.id] = {
      name: r.display_name?.trim() || composed || "",
      avatar: r.avatar_url ?? "",
      slug: r.slug ?? "",
    };
  });
  return map;
}

export const sliderAuthorsQueryOptions = (authorIds: string[]) =>
  queryOptions({
    queryKey: ["builder-slider-authors", authorIds] as const,
    queryFn: () => fetchSliderAuthors(authorIds),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });
