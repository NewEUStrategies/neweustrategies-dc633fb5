// Related-posts: SAM odczyt globalnej konfiguracji - bez silnika scoringu.
//
// Dlaczego osobny plik, a nie sekcja w `queries/relatedPosts.ts`: publiczna
// trasa wpisu (`routes/$.tsx`) potrzebuje tej konfiguracji STATYCZNIE - decyduje
// nią o pozycji bloku rekomendacji jeszcze zanim cokolwiek się doliczy, i
// prefetchuje ją w loaderze. Statyczny import z `queries/relatedPosts` ciągnął
// przez to do chunku wejściowego CAŁĄ warstwę liczącą (`scoreRelatedDetailed`,
// `buildIdf`, `normalizeMap`), mimo że sam komponent rekomendacji jest już
// ładowany leniwie. Rozdzielenie zostawia w wejściu tylko to, co trasa
// naprawdę czyta na starcie.
//
// Para do tego rozdziału: `lib/relatedPosts/config.ts` (typy i domyślne
// wartości bez silnika). Oba pliki mają jedną regułę: NIE importować stąd
// niczego, co liczy - inaczej podgraf wraca do chunku wejściowego.
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { RELATED_POSTS_DEFAULTS, type RelatedPostsConfig } from "@/lib/relatedPosts/config";

/** Wspólny TTL wszystkich zapytań rekomendacji (także tych w `queries/relatedPosts`). */
export const RELATED_TTL = 5 * 60_000;

/**
 * Konfiguracja rekomendacji tenanta PRZEGLĄDANEGO (płaszczyzna publiczna).
 *
 * Czyta przez `get_related_posts_config()`, a nie przez `select().limit(1)`.
 * Dlaczego: polityki SELECT na tabeli sumują się (OR) - publiczna po
 * `public_tenant_id()` i edytorska po `current_tenant_id()`. Zalogowany
 * admin/edytor tenanta A, który przegląda domenę tenanta B, spełniał OBIE, więc
 * `limit(1)` mógł zwrócić wiersz TENANTA A i publiczna strona tenanta B
 * renderowała się cudzą konfiguracją. Funkcja zwraca wyłącznie wiersz tenanta
 * przeglądanego, więc odczyt jest deterministyczny i izolowany.
 *
 * Klucz zapytania celowo NIE zawiera tenanta - prefetch SSR i render kliencki
 * muszą trafiać w ten sam wpis cache (patrz components/blocks/renderer/tenant.tsx).
 */
export const relatedPostsConfigQueryOptions = () =>
  queryOptions({
    queryKey: ["public", "related-posts-config"] as const,
    queryFn: async (): Promise<RelatedPostsConfig> => {
      const { data, error: dataError } = await supabase.rpc("get_related_posts_config");
      if (dataError) throw dataError;
      const row = Array.isArray(data) ? data[0] : null;
      if (!row) return RELATED_POSTS_DEFAULTS;
      return { ...RELATED_POSTS_DEFAULTS, ...(row as Partial<RelatedPostsConfig>) };
    },
    staleTime: RELATED_TTL,
  });
