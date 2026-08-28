// Hooki nadan stawek. Jedna galaz klucza na najemcę - nadanie zmienia wycene
// KAZDEGO pakietu i biletu tej grupy, wiec po zapisie uniewazniamy cala liste,
// a nie pojedynczy filtr.
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import {
  fetchAudienceGrantHistory,
  fetchAudienceGrants,
  revokeAudienceGrant,
  saveAudienceGrant,
  type AudienceGrantInput,
  type AudienceGrantsQuery,
  type AudienceGrantHistoryQuery,
  type EventAudienceGrantHistoryRow,
  type EventAudienceGrantRow,
} from "@/lib/events/audienceGrantsApi";

export const audienceGrantKeys = {
  all: ["event-audience-grants"] as const,
  list: (query: AudienceGrantsQuery) =>
    [
      ...audienceGrantKeys.all,
      query.eventId ?? "all",
      query.audience,
      query.includeRevoked ? "with-revoked" : "active",
      query.search.trim().toLowerCase(),
    ] as const,
};

export function useAudienceGrants(
  query: AudienceGrantsQuery,
): UseQueryResult<EventAudienceGrantRow[], Error> {
  return useQuery({
    queryKey: audienceGrantKeys.list(query),
    queryFn: () => fetchAudienceGrants(query),
    staleTime: 30_000,
  });
}

function useInvalidate(): () => void {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: audienceGrantKeys.all });
    void client.invalidateQueries({ queryKey: audienceGrantHistoryKeys.all });
  };
}

export function useSaveAudienceGrant(): UseMutationResult<string, Error, AudienceGrantInput> {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: saveAudienceGrant, onSuccess: invalidate });
}

export function useRevokeAudienceGrant(): UseMutationResult<boolean, Error, string> {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: revokeAudienceGrant, onSuccess: invalidate });
}

// HISTORIA. Osobna galaz klucza, bo dziennik jest tylko do odczytu i zmienia
// sie wylacznie jako SKUTEK zapisu nadania - dlatego zapis uniewaznia obie.
export const audienceGrantHistoryKeys = {
  all: ["event-audience-grant-history"] as const,
  list: (query: AudienceGrantHistoryQuery) =>
    [
      ...audienceGrantHistoryKeys.all,
      query.eventId ?? "all",
      query.grantId ?? "all",
      query.search.trim().toLowerCase(),
      query.limit,
    ] as const,
};

export function useAudienceGrantHistory(
  query: AudienceGrantHistoryQuery,
  enabled = true,
): UseQueryResult<EventAudienceGrantHistoryRow[], Error> {
  return useQuery({
    queryKey: audienceGrantHistoryKeys.list(query),
    queryFn: () => fetchAudienceGrantHistory(query),
    enabled,
    staleTime: 15_000,
  });
}
