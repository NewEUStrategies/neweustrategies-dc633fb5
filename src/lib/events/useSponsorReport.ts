// Hooki raportu dla sponsorów (studio wydarzenia, karta firmy w CRM).
//
// KLUCZE WISZĄ POD GAŁĘZIĄ SPONSORÓW WYDARZENIA (`["event-sponsors", eventId]`).
// To celowe: każdy zapis sponsorów (publikacja, poziom, odpięcie) zmienia
// raport, a mutacje modułu sponsorów unieważniają właśnie tę gałąź - raport
// odświeża się więc sam, bez listy wyjątków. Zdarzenia domenowe linków
// (`event_sponsor_report_link.*.v1`) trafiają w ten sam korzeń.
//
// Mutacje unieważniają CAŁĄ gałąź wydarzenia i historię sponsoringu firm
// (licznik aktywnych linków na karcie firmy). Bez optymistycznych aktualizacji.
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import {
  fetchCompanySponsorships,
  fetchSponsorReportLeadsSeries,
  fetchSponsorReportLinks,
  fetchSponsorReportSeries,
  fetchSponsorReportSummary,
  issueSponsorReportLink,
  pushLeadScansToCrm,
  revokeSponsorReportLink,
  type CompanySponsorshipRow,
  type IssuedSponsorReportLink,
  type PushLeadsInput,
  type PushLeadsResult,
  type SponsorReportLeadsSeriesRow,
  type SponsorReportLinkInput,
  type SponsorReportLinkRow,
  type SponsorReportQuery,
  type SponsorReportSeriesRow,
  type SponsorReportSummaryRow,
} from "@/lib/events/sponsorReportApi";
import { sponsorKeys } from "@/lib/events/useEventSponsors";

export const sponsorReportKeys = {
  event: (eventId: string) => [...sponsorKeys.event(eventId), "report"] as const,
  summary: (query: SponsorReportQuery) =>
    [...sponsorReportKeys.event(query.eventId), "summary", query] as const,
  series: (query: SponsorReportQuery) =>
    [...sponsorReportKeys.event(query.eventId), "series", query] as const,
  leadsSeries: (query: SponsorReportQuery) =>
    [...sponsorReportKeys.event(query.eventId), "leads-series", query] as const,
  links: (eventId: string) => [...sponsorReportKeys.event(eventId), "links"] as const,
  companies: () => [...sponsorKeys.all, "company"] as const,
  company: (companyId: string) => [...sponsorReportKeys.companies(), companyId] as const,
};

export function useSponsorReportSummary(
  query: SponsorReportQuery,
): UseQueryResult<SponsorReportSummaryRow[], Error> {
  return useQuery({
    queryKey: sponsorReportKeys.summary(query),
    queryFn: () => fetchSponsorReportSummary(query),
    enabled: query.eventId !== "",
  });
}

export function useSponsorReportSeries(
  query: SponsorReportQuery,
): UseQueryResult<SponsorReportSeriesRow[], Error> {
  return useQuery({
    queryKey: sponsorReportKeys.series(query),
    queryFn: () => fetchSponsorReportSeries(query),
    enabled: query.eventId !== "",
  });
}

export function useSponsorReportLeadsSeries(
  query: SponsorReportQuery,
): UseQueryResult<SponsorReportLeadsSeriesRow[], Error> {
  return useQuery({
    queryKey: sponsorReportKeys.leadsSeries(query),
    queryFn: () => fetchSponsorReportLeadsSeries(query),
    enabled: query.eventId !== "",
  });
}

export function useSponsorReportLinks(
  eventId: string,
): UseQueryResult<SponsorReportLinkRow[], Error> {
  return useQuery({
    queryKey: sponsorReportKeys.links(eventId),
    queryFn: () => fetchSponsorReportLinks(eventId),
    enabled: eventId !== "",
  });
}

export function useCompanySponsorships(
  companyId: string,
): UseQueryResult<CompanySponsorshipRow[], Error> {
  return useQuery({
    queryKey: sponsorReportKeys.company(companyId),
    queryFn: () => fetchCompanySponsorships(companyId),
    enabled: companyId !== "",
    // Redaktor CRM dostaje `forbidden` - ponawianie odmowy nic nie zmieni,
    // a karta i tak się chowa.
    retry: false,
  });
}

/** Wspólny kształt mutacji raportu: unieważnia gałąź wydarzenia i karty firm. */
function useReportMutation<TInput, TResult>(
  eventId: string,
  run: (input: TInput) => Promise<TResult>,
): UseMutationResult<TResult, Error, TInput> {
  const queryClient = useQueryClient();
  return useMutation<TResult, Error, TInput>({
    mutationFn: run,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sponsorKeys.event(eventId) });
      void queryClient.invalidateQueries({ queryKey: sponsorReportKeys.companies() });
    },
  });
}

export function useIssueSponsorReportLink(eventId: string) {
  return useReportMutation<SponsorReportLinkInput, IssuedSponsorReportLink>(
    eventId,
    issueSponsorReportLink,
  );
}

export function useRevokeSponsorReportLink(eventId: string) {
  return useReportMutation<string, boolean>(eventId, revokeSponsorReportLink);
}

export function usePushLeadScansToCrm(eventId: string) {
  return useReportMutation<PushLeadsInput, PushLeadsResult>(eventId, pushLeadScansToCrm);
}
