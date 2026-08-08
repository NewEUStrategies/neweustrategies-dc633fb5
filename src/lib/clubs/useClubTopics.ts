// Hooki katalogu obszarów tematycznych klubów.
//
// Katalog jest mały i rzadko się zmienia, więc trzymamy go długo w cache -
// select w formularzu wątku nie może migotać przy każdym otwarciu dialogu.
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { ClubTopicAdminRow, ClubTopicOption } from "@/lib/clubs/topicCatalog";
import { CLUB_TOPIC_FALLBACK } from "@/lib/clubs/topicCatalog";
import {
  deleteClubTopic,
  fetchActiveClubTopics,
  fetchAdminClubTopics,
  setClubTopicActive,
  upsertClubTopic,
  type ClubTopicUpsertInput,
} from "@/lib/clubs/topicsApi";

export const clubTopicKeys = {
  all: ["club-topics"] as const,
  active: () => [...clubTopicKeys.all, "active"] as const,
  admin: () => [...clubTopicKeys.all, "admin"] as const,
};

const TOPIC_STALE_MS = 5 * 60 * 1000;

/**
 * Aktywne obszary organizacji. Do czasu pierwszej odpowiedzi zwracamy listę
 * awaryjną - pusty select w formularzu wygląda jak awaria, a nie jak ładowanie.
 */
export function useClubTopics(enabled = true): {
  topics: ClubTopicOption[];
  isLoading: boolean;
} {
  const query = useQuery({
    queryKey: clubTopicKeys.active(),
    queryFn: fetchActiveClubTopics,
    staleTime: TOPIC_STALE_MS,
    enabled,
  });
  return {
    topics: query.data ?? [...CLUB_TOPIC_FALLBACK],
    isLoading: query.isLoading,
  };
}

export function useAdminClubTopics(enabled = true): UseQueryResult<ClubTopicAdminRow[], Error> {
  return useQuery({
    queryKey: clubTopicKeys.admin(),
    queryFn: fetchAdminClubTopics,
    staleTime: 30_000,
    enabled,
  });
}

function useTopicInvalidation(): () => void {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: clubTopicKeys.all });
  };
}

export function useUpsertClubTopic(): UseMutationResult<string, Error, ClubTopicUpsertInput> {
  const invalidate = useTopicInvalidation();
  return useMutation({
    mutationFn: upsertClubTopic,
    onSuccess: invalidate,
  });
}

export function useSetClubTopicActive(): UseMutationResult<
  boolean,
  Error,
  { id: string; isActive: boolean }
> {
  const invalidate = useTopicInvalidation();
  return useMutation({
    mutationFn: ({ id, isActive }) => setClubTopicActive(id, isActive),
    onSuccess: invalidate,
  });
}

export function useDeleteClubTopic(): UseMutationResult<boolean, Error, string> {
  const invalidate = useTopicInvalidation();
  return useMutation({
    mutationFn: deleteClubTopic,
    onSuccess: invalidate,
  });
}
