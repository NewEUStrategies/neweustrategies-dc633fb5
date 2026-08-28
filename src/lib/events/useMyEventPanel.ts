// Hooki panelu uczestnika na wydarzeniu.
//
// JEDEN KLUCZ CACHE NA WYDARZENIE. Profil i agenda są czytane w kilku
// zakładkach jednego ekranu; wspólny klucz `["event-me", slug, ...]` sprawia,
// że przełączanie zakładek nie generuje nowych zapytań, a zapis profilu
// odświeża dokładnie tę jedną gałąź.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";

import {
  fetchMyAgenda,
  fetchMyEventProfile,
  saveMyEventProfile,
  type MyAgendaSession,
  type MyEventPanelState,
  type MyEventProfileInput,
} from "@/lib/events/myEventProfileApi";

export function myEventPanelKey(slug: string): readonly unknown[] {
  return ["event-me", slug, "profile"] as const;
}

export function myAgendaKey(slug: string): readonly unknown[] {
  return ["event-me", slug, "agenda"] as const;
}

export function useMyEventProfile(
  slug: string,
  enabled: boolean,
): UseQueryResult<MyEventPanelState> {
  return useQuery({
    queryKey: myEventPanelKey(slug),
    queryFn: () => fetchMyEventProfile(slug),
    enabled: enabled && slug.length > 0,
    staleTime: 30_000,
  });
}

export function useMyAgenda(slug: string, enabled: boolean): UseQueryResult<MyAgendaSession[]> {
  return useQuery({
    queryKey: myAgendaKey(slug),
    queryFn: () => fetchMyAgenda(slug),
    enabled: enabled && slug.length > 0,
    staleTime: 30_000,
  });
}

export function useSaveMyEventProfile(
  slug: string,
): UseMutationResult<MyEventPanelState, Error, Omit<MyEventProfileInput, "slug">> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<MyEventProfileInput, "slug">) =>
      saveMyEventProfile({ ...input, slug }),
    onSuccess: (data) => {
      // Odpowiedź RPC to już nowy stan - wstawiamy ją do cache zamiast
      // wywoływać drugie zapytanie o to samo.
      qc.setQueryData(myEventPanelKey(slug), data);
    },
  });
}
