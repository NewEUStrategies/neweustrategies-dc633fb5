// Odczyt ekspozycji publicznej własnego profilu (warstwa danych).
//
// Model i cała logika bez I/O żyją w `publicExposure.ts` - tutaj zostaje samo
// zapytanie, żeby molekuła prezentacyjna nie ciągnęła za sobą klienta Supabase.
import "@/lib/i18n-chat";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { normalizeExposure, type PublicExposure, type RawExposureRow } from "./publicExposure";

const exposureKey = (uid: string | undefined) =>
  ["profile", "public-exposure", uid ?? "anon"] as const;

/**
 * Ekspozycja publiczna własnego profilu. `null` znaczy „nie wiemy" (RPC jeszcze
 * niewdrożone albo błąd sieci) - interfejs pokazuje wtedy notę neutralną zamiast
 * zgadywać, bo fałszywe „jesteś prywatny" jest dokładnie tym błędem, który ta
 * zmiana likwiduje.
 *
 * Izolacja tenanta jest po stronie bazy: RPC czyta WYŁĄCZNIE wiersz `auth.uid()`
 * i liczy sygnały w tenancie tego profilu - klient nie podaje żadnego id.
 *
 * Nazwa RPC jest rzutowana przez `unknown`, bo wygenerowane typy klienta
 * (src/integrations/supabase/types.ts) odświeża osobny przebieg i nadążają za
 * migracją 20260806160000 dopiero po nim - ustalony idiom repo (patrz
 * `popular_post_ids` w src/lib/builder/postListQuery.ts).
 */
export function usePublicExposure(): UseQueryResult<PublicExposure | null> {
  const { user } = useAuth();
  return useQuery({
    queryKey: exposureKey(user?.id),
    enabled: !!user,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async (): Promise<PublicExposure | null> => {
      const { data, error } = await (
        supabase.rpc as unknown as (
          fn: string,
        ) => Promise<{ data: unknown; error: { message: string } | null }>
      )("get_my_public_exposure");
      if (error) {
        if (typeof console !== "undefined") {
          console.warn("[profile] get_my_public_exposure unavailable:", error.message);
        }
        return null;
      }
      const rows = (data ?? []) as RawExposureRow[];
      return normalizeExposure(rows[0]);
    },
  });
}
