// `queryOptions` przekrojów społeczności huba (S4) + zejście do wydarzenia.
//
// JEDNO źródło klucza i `queryFn` dla zakładki Społeczność (S7), migawki
// i każdego innego miejsca, które pokaże te liczby (wzorzec S1).
//
// Klucz z fabryki I0 (`revenueKeys.query("events" | "clubs", …)`): prefiks
// `["admin-revenue", dziedzina, najemca]` trafia regułami szyny
// (`event.registration.*`, `club_application.*` -> `rev("events")`,
// `rev("clubs")`) w każde zapamiętane okno.
//
// ZEJŚCIE DO WYDARZENIA = TE SAME ARGUMENTY CO STUDIO. Wiersz wydarzenia
// w hubie otwiera liczniki zgłoszeń i lejek reklam - pod KLUCZAMI STUDIA
// (`registrationKeys.counts`, `adsFunnelKeys.report`) i z tą samą funkcją
// pobrania. Dzięki temu hub i studio dzielą wpis cache (zero drugiego
// zapytania, zero rozjazdu liczb), a mutacje studia (decyzja organizatora,
// koszt kampanii) odświeżają też widok huba. Test pilnuje identyczności.
import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { revenueKeys } from "@/lib/revenue/keys";
import type { RevenueRange } from "@/lib/revenue/window";
import { registrationKeys } from "@/lib/events/useEventRegistrations";
import { adsFunnelKeys } from "@/lib/events/useEventAdsFunnel";
import {
  fetchRegistrationCounts,
  type RegistrationCountsQuery,
} from "@/lib/events/registrationsApi";
import { parseRegistrationCounts } from "@/lib/events/registrationCounts";
import { fetchAdsFunnel, type AdsFunnelQuery } from "@/lib/events/adsFunnelApi";
import type { RevenueClubsSummaryRead, RevenueEventsSummaryRead } from "./dto";
import { getRevenueClubsSummary, getRevenueEventsSummary } from "./community.functions";

/** Okno rosnące razem z zegarem - frekwencja zmienia się z każdym skanem. */
export const COMMUNITY_STALE_OPEN_MS = 60_000;
/** Okno domknięte - wynik zmienia już tylko spóźniony zwrot albo decyzja. */
export const COMMUNITY_STALE_COMPLETE_MS = 30 * 60_000;
export const COMMUNITY_GC_MS = 10 * 60_000;

/** Świeżość liczników zgłoszeń studia (`useEventRegistrations`, LIVE_STALE_MS). */
export const STUDIO_REGISTRATION_COUNTS_STALE_MS = 15_000;

type RangeInput = Pick<RevenueRange, "period" | "current" | "complete">;

export function revenueEventsSummaryQueryOptions(tenantId: string | null, range: RangeInput) {
  return queryOptions<RevenueEventsSummaryRead>({
    // Bez najemcy zapytanie jest wyłączone; pusty napis trzyma tylko kształt.
    queryKey: revenueKeys.query("events", tenantId ?? "", range),
    queryFn: () =>
      getRevenueEventsSummary({
        data: { sinceIso: range.current.sinceIso, untilIso: range.current.untilIso },
      }),
    enabled: Boolean(tenantId),
    staleTime: range.complete ? COMMUNITY_STALE_COMPLETE_MS : COMMUNITY_STALE_OPEN_MS,
    gcTime: COMMUNITY_GC_MS,
    // Odmowa i brak funkcji wracają jako STAN - ponawiany jest prawdziwy błąd.
    retry: 1,
    placeholderData: keepPreviousData,
  });
}

export function revenueClubsSummaryQueryOptions(tenantId: string | null, range: RangeInput) {
  return queryOptions<RevenueClubsSummaryRead>({
    queryKey: revenueKeys.query("clubs", tenantId ?? "", range),
    queryFn: () =>
      getRevenueClubsSummary({
        data: { sinceIso: range.current.sinceIso, untilIso: range.current.untilIso },
      }),
    enabled: Boolean(tenantId),
    staleTime: range.complete ? COMMUNITY_STALE_COMPLETE_MS : COMMUNITY_STALE_OPEN_MS,
    gcTime: COMMUNITY_GC_MS,
    retry: 1,
    placeholderData: keepPreviousData,
  });
}

/**
 * Zapytanie liczników zgłoszeń BEZ filtrów - dokładnie to, które składa
 * przegląd wydarzenia w studiu (`EventOverviewPanel`).
 */
export function studioRegistrationCountsQuery(eventId: string): RegistrationCountsQuery {
  return { eventId, ticketTypeId: null, groupId: null, q: "", from: null, to: null };
}

/**
 * Lejek reklam „od początku" (preset `all` studia): przychód netto per waluta
 * jest wtedy tą samą liczbą co `by_currency` wiersza wydarzenia w hubie
 * (oba z `_event_revenue_net` bez granic okna).
 */
export function studioAdsFunnelAllTimeQuery(eventId: string): AdsFunnelQuery {
  return { eventId, from: null, to: null };
}

export function eventRegistrationCountsQueryOptions(eventId: string) {
  const query = studioRegistrationCountsQuery(eventId);
  return queryOptions({
    queryKey: registrationKeys.counts(query),
    queryFn: async () => parseRegistrationCounts(await fetchRegistrationCounts(query)),
    enabled: eventId !== "",
    staleTime: STUDIO_REGISTRATION_COUNTS_STALE_MS,
  });
}

export function eventAdsFunnelAllTimeQueryOptions(eventId: string) {
  const query = studioAdsFunnelAllTimeQuery(eventId);
  return queryOptions({
    queryKey: adsFunnelKeys.report(query),
    queryFn: () => fetchAdsFunnel(query),
    enabled: eventId !== "",
  });
}
