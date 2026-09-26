// Hooki React Query ekranu "Lejek Google Ads".
//
// JEDNA FABRYKA KLUCZY ZAKORZENIONA W `event-ads-funnel`. Kazda mutacja
// uniewaznia CALA galaz wydarzenia (`["event-ads-funnel", eventId]`): zmiana
// mapowania kampanii przestawia grupy raportu, a koszt - CPA i ROAS, wiec
// odswiezenie tylko listy zostawiloby raport z nieaktualnym podzialem.
// Galezie innych wydarzen zostaja nietkniete. Bez aktualizacji
// optymistycznych (konwencja modulu).
//
// EKSPORT KONWERSJI NIE JEST ZAPYTANIEM W CACHE. Plik niesie identyfikatory
// klikniec - pobieramy go na klikniecie (mutacja), a wynik zyje tylko do
// zbudowania pliku.
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import {
  deleteAdCampaign,
  deleteAdCost,
  fetchAdCampaigns,
  fetchAdCosts,
  fetchAdsConversions,
  fetchAdsFunnel,
  saveAdCampaign,
  saveAdCosts,
  type AdCampaign,
  type AdCampaignInput,
  type AdCost,
  type AdCostsInput,
  type AdsFunnelQuery,
} from "@/lib/events/adsFunnelApi";
import type { AdsConversionsExport, AdsFunnelReport } from "@/lib/events/adsFunnel";

export const adsFunnelKeys = {
  all: ["event-ads-funnel"] as const,
  event: (eventId: string) => [...adsFunnelKeys.all, eventId] as const,
  report: (query: AdsFunnelQuery) =>
    [...adsFunnelKeys.event(query.eventId), "report", query.from, query.to] as const,
  campaigns: (eventId: string) => [...adsFunnelKeys.event(eventId), "campaigns"] as const,
  costs: (eventId: string, campaignId: string) =>
    [...adsFunnelKeys.event(eventId), "costs", campaignId] as const,
};

export function useAdsFunnelReport(query: AdsFunnelQuery | null): UseQueryResult<AdsFunnelReport> {
  return useQuery({
    queryKey: query === null ? [...adsFunnelKeys.all, "idle"] : adsFunnelKeys.report(query),
    queryFn: () => fetchAdsFunnel(query as AdsFunnelQuery),
    enabled: query !== null && query.eventId !== "",
  });
}

export function useAdCampaigns(eventId: string): UseQueryResult<AdCampaign[]> {
  return useQuery({
    queryKey: adsFunnelKeys.campaigns(eventId),
    queryFn: () => fetchAdCampaigns(eventId),
    enabled: eventId !== "",
  });
}

export function useAdCampaignCosts(
  eventId: string,
  campaignId: string | null,
): UseQueryResult<AdCost[]> {
  return useQuery({
    queryKey: adsFunnelKeys.costs(eventId, campaignId ?? ""),
    queryFn: () => fetchAdCosts(campaignId as string),
    enabled: campaignId !== null,
  });
}

function useAdsFunnelMutation<TInput, TResult>(
  eventId: string,
  run: (input: TInput) => Promise<TResult>,
): UseMutationResult<TResult, Error, TInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adsFunnelKeys.event(eventId) });
    },
  });
}

export function useSaveAdCampaign(
  eventId: string,
): UseMutationResult<string, Error, AdCampaignInput> {
  return useAdsFunnelMutation(eventId, saveAdCampaign);
}

export function useDeleteAdCampaign(eventId: string): UseMutationResult<void, Error, string> {
  return useAdsFunnelMutation(eventId, deleteAdCampaign);
}

export function useSaveAdCosts(eventId: string): UseMutationResult<number, Error, AdCostsInput> {
  return useAdsFunnelMutation(eventId, saveAdCosts);
}

export function useDeleteAdCost(
  eventId: string,
): UseMutationResult<void, Error, { campaignId: string; day: string }> {
  return useAdsFunnelMutation(eventId, (input: { campaignId: string; day: string }) =>
    deleteAdCost(input.campaignId, input.day),
  );
}

export function useAdsConversionsExport(): UseMutationResult<
  AdsConversionsExport,
  Error,
  AdsFunnelQuery
> {
  return useMutation({ mutationFn: fetchAdsConversions });
}
