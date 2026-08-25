// Hooki panelu GRUP i ZGOD wydarzenia.
//
// JEDNA FABRYKA KLUCZY NA CALY MODUL: zapis grupy zmienia liste grup ORAZ
// liczniki zapisow (bo grupa domyslna wchodzi do nowych zapisow), a zapis zgody
// zmienia liczniki akceptacji na liscie zapisow (`required_terms_missing`).
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
  deleteEventGroup,
  deleteEventTerm,
  fetchEventGroups,
  fetchEventTerms,
  saveEventGroup,
  saveEventTerm,
  setEventGroupMember,
  type EventGroupRow,
  type EventTermRow,
  type GroupInput,
  type GroupMemberInput,
  type TermInput,
} from "@/lib/events/termsGroupsApi";
import { registrationKeys } from "@/lib/events/useEventRegistrations";

export const termsGroupsKeys = {
  all: ["event-terms-groups"] as const,
  event: (eventId: string) => [...termsGroupsKeys.all, eventId] as const,
  groups: (eventId: string) => [...termsGroupsKeys.event(eventId), "groups"] as const,
  terms: (eventId: string) => [...termsGroupsKeys.event(eventId), "terms"] as const,
};

export function useEventGroups(eventId: string, enabled = true): UseQueryResult<EventGroupRow[]> {
  return useQuery({
    queryKey: termsGroupsKeys.groups(eventId),
    queryFn: () => fetchEventGroups(eventId),
    enabled: enabled && eventId !== "",
  });
}

export function useEventTerms(eventId: string, enabled = true): UseQueryResult<EventTermRow[]> {
  return useQuery({
    queryKey: termsGroupsKeys.terms(eventId),
    queryFn: () => fetchEventTerms(eventId),
    enabled: enabled && eventId !== "",
  });
}

function useEventScopedInvalidation(eventId: string): () => void {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: termsGroupsKeys.event(eventId) });
    // Zapisy widza grupe i braki zgod w swoich wierszach - lista bez
    // uniewaznienia pokazywalaby stan sprzed zapisu.
    void client.invalidateQueries({ queryKey: registrationKeys.event(eventId) });
  };
}

export function useSaveEventGroup(eventId: string): UseMutationResult<string, Error, GroupInput> {
  const invalidate = useEventScopedInvalidation(eventId);
  return useMutation({
    mutationFn: (input: GroupInput) => saveEventGroup(input),
    onSuccess: invalidate,
  });
}

export function useDeleteEventGroup(eventId: string): UseMutationResult<boolean, Error, string> {
  const invalidate = useEventScopedInvalidation(eventId);
  return useMutation({
    mutationFn: (id: string) => deleteEventGroup(id),
    onSuccess: invalidate,
  });
}

export function useSetEventGroupMember(
  eventId: string,
): UseMutationResult<boolean, Error, GroupMemberInput> {
  const invalidate = useEventScopedInvalidation(eventId);
  return useMutation({
    mutationFn: (input: GroupMemberInput) => setEventGroupMember(input),
    onSuccess: invalidate,
  });
}

export function useSaveEventTerm(eventId: string): UseMutationResult<string, Error, TermInput> {
  const invalidate = useEventScopedInvalidation(eventId);
  return useMutation({
    mutationFn: (input: TermInput) => saveEventTerm(input),
    onSuccess: invalidate,
  });
}

export function useDeleteEventTerm(eventId: string): UseMutationResult<boolean, Error, string> {
  const invalidate = useEventScopedInvalidation(eventId);
  return useMutation({
    mutationFn: (id: string) => deleteEventTerm(id),
    onSuccess: invalidate,
  });
}
