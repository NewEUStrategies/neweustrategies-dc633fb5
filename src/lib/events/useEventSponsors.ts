// Hooki panelu sponsorow: poziomy, przypiecia firm, kontakty, materialy, migawki.
//
// JEDNA FABRYKA KLUCZY NA CALY MODUL. Zapis sponsora zmienia liste sponsorow ORAZ
// liczniki poziomu ORAZ szczegol przypiecia. Gdyby kazdy ekran mial wlasny
// literal klucza, po zapisie odswiezalby sie tylko ten, na ktorym stoi kursor.
//
// UNIEWAZNIAMY GALAZ WYDARZENIA, NIE POJEDYNCZE ZAPYTANIE - zapytania innych
// wydarzen zostaja nietkniete.
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  deleteSponsor,
  deleteSponsorMaterial,
  deleteSponsorTier,
  fetchSponsorDetail,
  fetchSponsorTiers,
  fetchSponsors,
  refreshSponsorSnapshots,
  reorderSponsorMaterials,
  reorderSponsorTiers,
  reorderSponsors,
  saveSponsor,
  saveSponsorMaterial,
  saveSponsorTier,
  searchSponsorCompanies,
  setSponsorContacts,
  setSponsorsPublished,
  type EventSponsorDetailRow,
  type EventSponsorRow,
  type EventSponsorTierRow,
  type SnapshotRefreshInput,
  type SponsorCompanyRow,
  type SponsorContactInput,
  type SponsorInput,
  type SponsorMaterialInput,
  type SponsorOrderItem,
  type SponsorTierInput,
  type SponsorsQuery,
} from "@/lib/events/sponsorsApi";

export const sponsorKeys = {
  all: ["event-sponsors"] as const,
  event: (eventId: string) => [...sponsorKeys.all, eventId] as const,
  list: (query: SponsorsQuery) => [...sponsorKeys.event(query.eventId), "list", query] as const,
  tiers: (eventId: string) => [...sponsorKeys.event(eventId), "tiers"] as const,
  companies: (eventId: string, q: string) =>
    [...sponsorKeys.event(eventId), "companies", q] as const,
  detail: (sponsorId: string) => [...sponsorKeys.all, "detail", sponsorId] as const,
};

export function useSponsors(
  query: SponsorsQuery,
  enabled = true,
): UseQueryResult<EventSponsorRow[]> {
  return useQuery({
    queryKey: sponsorKeys.list(query),
    queryFn: () => fetchSponsors(query),
    enabled: enabled && query.eventId !== "",
  });
}

export function useSponsorTiers(
  eventId: string,
  enabled = true,
): UseQueryResult<EventSponsorTierRow[]> {
  return useQuery({
    queryKey: sponsorKeys.tiers(eventId),
    queryFn: () => fetchSponsorTiers(eventId),
    enabled: enabled && eventId !== "",
  });
}

export function useSponsorDetail(
  sponsorId: string,
  enabled = true,
): UseQueryResult<EventSponsorDetailRow | null> {
  return useQuery({
    queryKey: sponsorKeys.detail(sponsorId),
    queryFn: () => fetchSponsorDetail(sponsorId),
    enabled: enabled && sponsorId !== "",
  });
}

export function useSponsorCompanySearch(
  eventId: string,
  q: string,
  enabled = true,
): UseQueryResult<SponsorCompanyRow[]> {
  return useQuery({
    queryKey: sponsorKeys.companies(eventId, q),
    queryFn: () => searchSponsorCompanies(eventId, q),
    enabled: enabled && eventId !== "",
  });
}

/** Wszystkie mutacje modulu uniewazniaja te sama galaz - jeden helper. */
function useSponsorMutation<TInput, TResult>(
  eventId: string,
  run: (input: TInput) => Promise<TResult>,
): UseMutationResult<TResult, Error, TInput> {
  const queryClient = useQueryClient();
  return useMutation<TResult, Error, TInput>({
    mutationFn: run,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sponsorKeys.event(eventId) });
      void queryClient.invalidateQueries({ queryKey: [...sponsorKeys.all, "detail"] });
    },
  });
}

export function useSaveSponsorTier(eventId: string) {
  return useSponsorMutation<SponsorTierInput, string>(eventId, saveSponsorTier);
}

export function useDeleteSponsorTier(eventId: string) {
  return useSponsorMutation<string, boolean>(eventId, deleteSponsorTier);
}

export function useReorderSponsorTiers(eventId: string) {
  return useSponsorMutation<SponsorOrderItem[], number>(eventId, reorderSponsorTiers);
}

export function useSaveSponsor(eventId: string) {
  return useSponsorMutation<SponsorInput, string>(eventId, saveSponsor);
}

export function useDeleteSponsor(eventId: string) {
  return useSponsorMutation<string, boolean>(eventId, deleteSponsor);
}

export function useReorderSponsors(eventId: string) {
  return useSponsorMutation<SponsorOrderItem[], number>(eventId, reorderSponsors);
}

export function useSetSponsorsPublished(eventId: string) {
  return useSponsorMutation<{ ids: string[]; isPublished: boolean }, number>(eventId, (input) =>
    setSponsorsPublished(input.ids, input.isPublished),
  );
}

export function useRefreshSponsorSnapshots(eventId: string) {
  return useSponsorMutation<SnapshotRefreshInput, number>(eventId, refreshSponsorSnapshots);
}

export function useSetSponsorContacts(eventId: string) {
  return useSponsorMutation<{ sponsorId: string; items: SponsorContactInput[] }, number>(
    eventId,
    (input) => setSponsorContacts(input.sponsorId, input.items),
  );
}

export function useSaveSponsorMaterial(eventId: string) {
  return useSponsorMutation<SponsorMaterialInput, string>(eventId, saveSponsorMaterial);
}

export function useDeleteSponsorMaterial(eventId: string) {
  return useSponsorMutation<string, boolean>(eventId, deleteSponsorMaterial);
}

export function useReorderSponsorMaterials(eventId: string) {
  return useSponsorMutation<SponsorOrderItem[], number>(eventId, reorderSponsorMaterials);
}
