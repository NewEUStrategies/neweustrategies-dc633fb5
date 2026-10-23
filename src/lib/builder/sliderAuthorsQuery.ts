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
import { WIDGET_QUERY_ROOTS } from "@/lib/builder/queryKeys";
import { edgeTtlCache } from "@/lib/ssrCache";
import { latestSupersetAuthorsFor } from "@/lib/builder/latestPostsSuperset";

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

interface SliderAuthorProfile {
  id: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  slug: string | null;
}

/** Własny odczyt profili slajdów. Błąd RZUCA, żeby nie trafił do cache (niżej). */
async function readSliderAuthorProfiles(authorIds: string[]): Promise<SliderAuthorProfile[]> {
  const { data, error } = await supabase
    .from("profiles_public")
    .select("id, display_name, first_name, last_name, avatar_url, slug")
    .in("id", authorIds);
  if (error) throw error;
  return (data ?? []) as SliderAuthorProfile[];
}

/**
 * Rekord zamiast Map: prosty do serializacji w dehydratowanym payloadzie SSR.
 *
 * Per-isolate TTL (60 s) po UPORZĄDKOWANEJ liście id - tej samej, która jest
 * kluczem zapytania. Wcześniej ten odczyt nie był memoizowany wcale: każdy
 * render SSR na zimnym izolacie płacił za niego osobny round-trip, i to po
 * odczycie wpisów, więc bramka sekcji hero czekała na dwa odcinki szeregowo.
 * Na serwerze profile przychodzą najpierw ze wspólnego odczytu autorów
 * nadzbioru najnowszych wpisów (ten sam, z którego biorą byline post-listy -
 * `latestPostsSuperset.ts`), o ile wszyscy autorzy slajdów są w nadzbiorze.
 *
 * Odmowa odczytu daje PUSTĄ mapę (slider renderuje się bez bylinu), ale nie
 * jest cache'owana: rzut wewnątrz `edgeTtlCache` omija zapis, a pustą mapę
 * składamy dopiero na zewnątrz.
 */
async function fetchSliderAuthors(authorIds: string[]): Promise<Record<string, SliderAuthorInfo>> {
  return edgeTtlCache(`builder:slider-authors:${JSON.stringify(authorIds)}`, 60_000, async () => {
    const rows: readonly SliderAuthorProfile[] =
      (import.meta.env.SSR && typeof window === "undefined"
        ? await latestSupersetAuthorsFor(authorIds)
        : null) ?? (await readSliderAuthorProfiles(authorIds));
    const map: Record<string, SliderAuthorInfo> = {};
    rows.forEach((r) => {
      const composed = [r.first_name, r.last_name].filter(Boolean).join(" ").trim();
      map[r.id] = {
        name: r.display_name?.trim() || composed || "",
        avatar: r.avatar_url ?? "",
        slug: r.slug ?? "",
      };
    });
    return map;
  }).catch((): Record<string, SliderAuthorInfo> => ({}));
}

export const sliderAuthorsQueryOptions = (authorIds: string[]) =>
  queryOptions({
    // Korzeń z rejestru (a nie goły literał), więc trafia go też inwalidacja live.
    queryKey: [WIDGET_QUERY_ROOTS.sliderAuthors, authorIds] as const,
    queryFn: () => fetchSliderAuthors(authorIds),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });
