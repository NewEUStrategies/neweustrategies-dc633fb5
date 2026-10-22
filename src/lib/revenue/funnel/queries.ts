// `queryOptions` lejka czytelnika huba (S3, kontrakt §5.4).
//
// JEDNO źródło klucza i `queryFn` dla zakładki Lejek, kokpitu i każdego
// innego miejsca, które pokaże te liczby - dwie definicje pod jednym kluczem
// to kolizja cache.
//
// Klucz z fabryki I0 (`revenueKeys.query("funnel", …)`): prefiks
// `["admin-revenue", "funnel", najemca]` trafia regułą szyny (`funK` -
// `checkout.*`, `account.registered.v1`, `paywall.hit.v1`,
// `metering.quota_exhausted.v1`) w każde zapamiętane okno, a segment i tor są
// w kluczu, więc przełączenie toru nie podaje liczb drugiego toru z cache.
import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { revenueKeys } from "@/lib/revenue/keys";
import type { RevenueSegment, RevenueTrack } from "@/lib/revenue/search";
import type { RevenueRange } from "@/lib/revenue/window";
import type { RevenueFunnelRead } from "./dto";
import { getRevenueFunnel } from "./funnel.functions";

/** Okno rosnące razem z zegarem - liczby zmieniają się z każdym zamówieniem. */
export const FUNNEL_STALE_OPEN_MS = 60_000;
/** Okno domknięte - wynik zmienia już tylko spóźniony webhook płatności. */
export const FUNNEL_STALE_COMPLETE_MS = 30 * 60_000;
export const FUNNEL_GC_MS = 10 * 60_000;

type RangeInput = Pick<RevenueRange, "period" | "current" | "complete">;

export interface RevenueFunnelFilters {
  segment?: RevenueSegment;
  track?: RevenueTrack;
}

export function revenueFunnelQueryOptions(
  tenantId: string | null,
  range: RangeInput,
  filters: RevenueFunnelFilters = {},
) {
  const segment = filters.segment ?? "all";
  const track = filters.track ?? "all";
  return queryOptions<RevenueFunnelRead>({
    // Bez najemcy zapytanie jest wyłączone (`enabled`); pusty napis trzyma
    // tylko kształt klucza i nigdy nie trafia do cache z danymi.
    queryKey: revenueKeys.query("funnel", tenantId ?? "", range, { segment, track }),
    queryFn: () =>
      getRevenueFunnel({
        data: {
          sinceIso: range.current.sinceIso,
          untilIso: range.current.untilIso,
          segment,
          track,
        },
      }),
    enabled: Boolean(tenantId),
    staleTime: range.complete ? FUNNEL_STALE_COMPLETE_MS : FUNNEL_STALE_OPEN_MS,
    gcTime: FUNNEL_GC_MS,
    // Odmowa roli i brak funkcji wracają jako STAN, nie wyjątek - ponawiany
    // jest wyłącznie prawdziwy błąd, i to raz.
    retry: 1,
    // Zmiana okna pokazuje poprzednie liczby do czasu nowych - karta nie
    // zwija się do szkieletu przy każdym przełączeniu okresu.
    placeholderData: keepPreviousData,
  });
}
