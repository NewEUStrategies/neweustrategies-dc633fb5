// `queryOptions` ścieżek komunikacji (S5, kontrakt §5.4) - JEDNO źródło klucza
// i `queryFn` dla listy, kontaktów, karty leada, ustawień, zdrowia silnika,
// statystyk, szacunku i symulacji (UI S8 i karta CRM).
//
// Klucze z fabryki I0 (`journeyKeys`): `journey.changed.v1` i
// `journey.stats_changed.v1` unieważniają prefiksy (`listAll`, `statsFor`,
// `enrollmentsFor`, `forLeadAll`) - każdy klucz poniżej leży pod jednym z nich.
// Seria dzienna nie ma własnej funkcji fabryki: siedzi POD `statsFor(id)`, więc
// to samo zdarzenie statystyk odświeża i karty, i wykres.
import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import type { JourneyStatus } from "@/lib/revenue/search";
import type {
  JourneyEngineHealthDto,
  JourneyEnrollmentsPage,
  JourneyLeadEnrollment,
  JourneyListItem,
  JourneyRead,
  JourneySeriesPoint,
  JourneySettingsDto,
  JourneySimulationDto,
  JourneyStatsDto,
  JourneyTriggerEstimate,
} from "./dto";
import type { JourneyDraft } from "./graph";
import {
  estimateJourneyTrigger,
  getJourneyEngineHealth,
  getJourneyEnrollments,
  getJourneySettings,
  getLeadJourneys,
  listJourneys,
  simulateJourney,
} from "./journeys.functions";
import { journeyKeys } from "./keys";
import type { JourneyEnrollmentStatus } from "./limits";
import { getJourneySeries, getJourneyStats } from "./stats.functions";

/** Lista i kontakty zmieniają się z każdym tickiem silnika (minuta). */
export const JOURNEYS_STALE_MS = 30_000;
/** Ustawienia zmienia wyłącznie admin - szyna i tak odświeża po zapisie. */
export const JOURNEY_SETTINGS_STALE_MS = 5 * 60_000;
/** Zdrowie silnika: odpytywanie co minutę, gdy karta jest otwarta. */
export const JOURNEY_HEALTH_REFETCH_MS = 60_000;
export const JOURNEYS_GC_MS = 10 * 60_000;

export function journeyListQueryOptions(
  tenantId: string | null,
  status: JourneyStatus | null = null,
) {
  return queryOptions<JourneyRead<JourneyListItem[]>>({
    queryKey: journeyKeys.list(tenantId ?? "", status),
    queryFn: () => listJourneys({ data: { status } }),
    enabled: Boolean(tenantId),
    staleTime: JOURNEYS_STALE_MS,
    gcTime: JOURNEYS_GC_MS,
    retry: 1,
  });
}

export function journeyEnrollmentsQueryOptions(
  journeyId: string,
  nodeId: string | null = null,
  status: JourneyEnrollmentStatus | null = null,
  page = 0,
) {
  return queryOptions<JourneyRead<JourneyEnrollmentsPage>>({
    queryKey: journeyKeys.enrollments(journeyId, nodeId, status, page),
    queryFn: () =>
      getJourneyEnrollments({ data: { journeyId, nodeId, status, page, pageSize: 50 } }),
    staleTime: JOURNEYS_STALE_MS,
    gcTime: JOURNEYS_GC_MS,
    retry: 1,
    placeholderData: keepPreviousData,
  });
}

export function leadJourneysQueryOptions(leadId: string) {
  return queryOptions<JourneyRead<JourneyLeadEnrollment[]>>({
    queryKey: journeyKeys.forLead(leadId),
    queryFn: () => getLeadJourneys({ data: { leadId } }),
    staleTime: JOURNEYS_STALE_MS,
    gcTime: JOURNEYS_GC_MS,
    retry: 1,
  });
}

export function journeySettingsQueryOptions(tenantId: string | null) {
  return queryOptions<JourneyRead<JourneySettingsDto>>({
    queryKey: journeyKeys.settings(tenantId ?? ""),
    queryFn: () => getJourneySettings(),
    enabled: Boolean(tenantId),
    staleTime: JOURNEY_SETTINGS_STALE_MS,
    gcTime: JOURNEYS_GC_MS,
    retry: 1,
  });
}

export function journeyEngineHealthQueryOptions(tenantId: string | null) {
  return queryOptions<JourneyRead<JourneyEngineHealthDto>>({
    queryKey: journeyKeys.engineHealth(tenantId ?? ""),
    queryFn: () => getJourneyEngineHealth(),
    enabled: Boolean(tenantId),
    staleTime: JOURNEYS_STALE_MS,
    gcTime: JOURNEYS_GC_MS,
    refetchInterval: JOURNEY_HEALTH_REFETCH_MS,
    retry: 1,
  });
}

export function journeyStatsQueryOptions(
  journeyId: string,
  versionId: string | null,
  sinceIso: string | null,
  untilIso: string | null,
) {
  return queryOptions<JourneyRead<JourneyStatsDto>>({
    queryKey: journeyKeys.stats(journeyId, versionId, sinceIso, untilIso),
    queryFn: () => getJourneyStats({ data: { journeyId, versionId, sinceIso, untilIso } }),
    staleTime: JOURNEYS_STALE_MS,
    gcTime: JOURNEYS_GC_MS,
    retry: 1,
    placeholderData: keepPreviousData,
  });
}

export function journeySeriesQueryOptions(journeyId: string, sinceIso: string, untilIso: string) {
  return queryOptions<JourneyRead<JourneySeriesPoint[]>>({
    queryKey: [...journeyKeys.statsFor(journeyId), "series", sinceIso, untilIso] as const,
    queryFn: () => getJourneySeries({ data: { journeyId, sinceIso, untilIso } }),
    staleTime: JOURNEYS_STALE_MS,
    gcTime: JOURNEYS_GC_MS,
    retry: 1,
    placeholderData: keepPreviousData,
  });
}

export function journeyTriggerEstimateQueryOptions(
  tenantId: string | null,
  eventType: string,
  condition: Record<string, string | number | boolean>,
  conditionHash: string,
) {
  return queryOptions<JourneyRead<JourneyTriggerEstimate>>({
    queryKey: journeyKeys.triggerEstimate(tenantId ?? "", eventType, conditionHash),
    queryFn: () => estimateJourneyTrigger({ data: { eventType, condition, days: 30 } }),
    enabled: Boolean(tenantId),
    staleTime: 5 * 60_000,
    gcTime: JOURNEYS_GC_MS,
    retry: 1,
  });
}

export function journeySimulationQueryOptions(
  journeyId: string,
  leadId: string,
  draft: JourneyDraft | null,
  draftChecksum: string,
) {
  return queryOptions<JourneyRead<JourneySimulationDto>>({
    queryKey: journeyKeys.simulate(journeyId, leadId, draftChecksum),
    queryFn: () => simulateJourney({ data: { journeyId, leadId, draft } }),
    staleTime: 60_000,
    gcTime: JOURNEYS_GC_MS,
    retry: false,
  });
}
