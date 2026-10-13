// Hooki panelu uczestnika na wydarzeniu.
//
// JEDEN KLUCZ CACHE NA WYDARZENIE. Profil i agenda są czytane w kilku
// zakładkach jednego ekranu; wspólny klucz `["event-me", slug, ...]` sprawia,
// że przełączanie zakładek nie generuje nowych zapytań, a zapis profilu
// odświeża dokładnie tę jedną gałąź.
import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";

import {
  fetchMyAgenda,
  fetchMyEventProfile,
  linkMyEventAccount,
  saveMyEventProfile,
  syncMyEventProfileFromAccount,
  type MyAgendaSession,
  type MyEventAccountLink,
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
      // KATALOG UCZESTNIKÓW CZYTA TE SAME WIERSZE. Bez unieważnienia karta
      // w katalogu pokazywałaby poprzednią rolę do czasu wygaśnięcia cache.
      void qc.invalidateQueries({ queryKey: ["public-event-surface", slug] });
      // Karta widza i powitanie siedzą na `header-profile`; po zapisie wstecz
      // do konta nazwa/stanowisko muszą zmienić się natychmiast.
      void qc.invalidateQueries({ queryKey: ["header-profile"] });
    },
  });
}

/** „Uzupełnij z konta" - kopiuje dane profilu platformy do kartoteki wydarzenia. */
export function useSyncMyEventProfileFromAccount(
  slug: string,
): UseMutationResult<MyEventPanelState, Error, void> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => syncMyEventProfileFromAccount(slug),
    onSuccess: (data) => {
      qc.setQueryData(myEventPanelKey(slug), data);
      void qc.invalidateQueries({ queryKey: ["public-event-surface", slug] });
    },
  });
}

/**
 * SAMODZIELNE DOWIĄZANIE KARTOTEKI (REG-01, D14). Gdy zalogowany uczestnik
 * nie ma kartoteki na tym wydarzeniu (`profile === null`), panel RAZ prosi
 * bazę o dowiązanie osoby o POTWIERDZONYM adresie konta
 * (`event_my_account_link`). Udane dowiązanie odświeża panel - kartoteka
 * pojawia się bez organizatora. Jedna próba na zamontowanie panelu: wynik
 * „nie ma czego dowiązać" nie zmieni się od ponownego pytania.
 */
export function useAutoLinkMyEventAccount(
  slug: string,
  panel: MyEventPanelState | undefined,
  enabled: boolean,
): UseMutationResult<MyEventAccountLink | null, Error, void> {
  const qc = useQueryClient();
  const link = useMutation({
    mutationFn: () => linkMyEventAccount(),
    onSuccess: (result) => {
      if (result?.linked === true) void qc.invalidateQueries({ queryKey: myEventPanelKey(slug) });
    },
  });
  const { mutate } = link;
  const needsLink = enabled && slug.length > 0 && panel !== undefined && panel.profile === null;
  const tried = useRef(false);
  useEffect(() => {
    if (!needsLink || tried.current) return;
    tried.current = true;
    mutate();
  }, [needsLink, mutate]);
  return link;
}
