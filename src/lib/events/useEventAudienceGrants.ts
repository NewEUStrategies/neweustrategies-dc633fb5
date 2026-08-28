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
  fetchAudienceGrants,
  revokeAudienceGrant,
  saveAudienceGrant,
  type AudienceGrantInput,
  type AudienceGrantsQuery,
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
