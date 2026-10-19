// `queryOptions` zdrowia kanału e-mail huba (S1, kontrakt §4.5).
//
// JEDNO źródło klucza i `queryFn` dla karty huba i każdego innego miejsca,
// które pokaże te liczby - dwie definicje pod jednym kluczem to kolizja
// cache (dokładnie ten defekt miała retencja, V30).
//
// Klucz z fabryki I0 (`revenueKeys.query("email", …)`): prefiks
// `["admin-revenue", "email", najemca]` trafia regułą szyny w każde
// zapamiętane okno, a obie granice okna w kluczu sprawiają, że „ten miesiąc"
// w październiku i w listopadzie nie dzielą wpisu.
import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { revenueKeys } from "@/lib/revenue/keys";
import type { RevenueRange } from "@/lib/revenue/window";
import type { RevenueEmailHealthRead } from "./dto";
import { getRevenueEmailHealth } from "./emailHealth.functions";

/** Okno rosnące razem z zegarem - liczby zmieniają się z każdą wysyłką. */
export const EMAIL_HEALTH_STALE_OPEN_MS = 60_000;
/** Okno domknięte - wynik zmienia już tylko spóźniony webhook dostawcy. */
export const EMAIL_HEALTH_STALE_COMPLETE_MS = 30 * 60_000;
export const EMAIL_HEALTH_GC_MS = 10 * 60_000;

type RangeInput = Pick<RevenueRange, "period" | "current" | "complete">;

export function revenueEmailHealthQueryOptions(tenantId: string | null, range: RangeInput) {
  return queryOptions<RevenueEmailHealthRead>({
    // Bez najemcy zapytanie jest wyłączone (`enabled`); pusty napis trzyma
    // tylko kształt klucza i nigdy nie trafia do cache z danymi.
    queryKey: revenueKeys.query("email", tenantId ?? "", range),
    queryFn: () =>
      getRevenueEmailHealth({
        data: { sinceIso: range.current.sinceIso, untilIso: range.current.untilIso },
      }),
    enabled: Boolean(tenantId),
    staleTime: range.complete ? EMAIL_HEALTH_STALE_COMPLETE_MS : EMAIL_HEALTH_STALE_OPEN_MS,
    gcTime: EMAIL_HEALTH_GC_MS,
    // Odmowa roli i brak funkcji wracają jako STAN (`state`), nie wyjątek -
    // ponawiany jest wyłącznie prawdziwy błąd, i to raz.
    retry: 1,
    // Zmiana okna pokazuje poprzednie liczby do czasu nowych - karta nie
    // zwija się do szkieletu przy każdym przełączeniu okresu.
    placeholderData: keepPreviousData,
  });
}
