// Hooki KLONU EDYCJI: zrodlo, podglad, klon, edycje, podsumowanie wyniku.
//
// JEDNA FABRYKA KLUCZY, KORZEN `event-clone`. Galaz wydarzenia
// (`["event-clone", eventId]`) zbiera wszystko, co dotyczy tego wydarzenia
// jako ZRODLA albo KOPII: podglad, liste edycji i podsumowanie wyniku. Mapa
// inwalidacji szyny zdarzen (`event.cloned.v1`) trafia literalem w galaz
// zrodla - zgodnosc literalu z fabryka pilnuje `eventRealtimeKeys.test.ts`.
//
// PODGLAD JEST ODRACZANY PO TRESCI, NIE PO REFERENCJI. Formularz sklada nowe
// wejscie przy kazdym renderze; odroczenie obiektu resetowaloby zegar
// w nieskonczonosc (nowa referencja = nowa zmiana). Odraczamy wiec zserializowany
// ladunek - napis porownuje sie po wartosci, a zapytanie strzela raz po pauzie
// w pisaniu. Poprzedni wynik zostaje na ekranie, dopoki nie przyjdzie nowy
// (`keepPreviousData`), zeby podglad nie mrugal przy kazdym znaku.
//
// PODSUMOWANIE WYNIKU ZYJE W CACHE, NIE W ADRESIE. Po klonie organizator
// laduje na pulpicie nowej edycji; tam czyta wynik z klucza
// `["event-clone", noweId, "result"]` wpisanego przez mutacje. Zapytanie
// nigdy nie idzie do bazy (`enabled: false`) - odswiezenie strony gubi
// podsumowanie, a to jest wlasciwe: to jest raport z JEDNEJ operacji, a nie
// stan wydarzenia (stan pokazuje studio).
//
// BEZ OPTYMISTYCZNYCH AKTUALIZACJI - jak w calym module wydarzen.
import { useMemo } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { Json } from "@/integrations/supabase/types";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  clonePayload,
  cloneEvent,
  fetchEventEditions,
  previewEventClone,
  requestClonePreview,
  searchCloneSources,
  type CloneSourceRow,
  type EventCloneInput,
  type EventClonePreview,
  type EventCloneResult,
  type EventEditionRow,
} from "@/lib/events/eventCloneApi";
import { adminEventKeys } from "@/lib/events/useAdminEvents";
import { eventTypeKeys } from "@/lib/events/useEventTypes";

export const eventCloneKeys = {
  all: ["event-clone"] as const,
  event: (eventId: string) => [...eventCloneKeys.all, eventId] as const,
  source: (eventId: string) => [...eventCloneKeys.event(eventId), "source"] as const,
  preview: (eventId: string, payload: string) =>
    [...eventCloneKeys.event(eventId), "preview", payload] as const,
  editions: (eventId: string) => [...eventCloneKeys.event(eventId), "editions"] as const,
  result: (eventId: string) => [...eventCloneKeys.event(eventId), "result"] as const,
  search: (q: string) => [...eventCloneKeys.all, "search", q] as const,
};

/** Pauza w pisaniu, po ktorej podglad pyta baze (ms). */
export const CLONE_PREVIEW_DEBOUNCE_MS = 400;
/** Minimalna fraza wyszukiwarki zrodla - jeden znak dopasowuje pol listy. */
export const CLONE_SEARCH_MIN_LENGTH = 2;

/** Podglad samego zrodla: liczniki, podpowiedz terminu i domyslne przelaczniki. */
export function useEventCloneSource(sourceId: string): UseQueryResult<EventClonePreview, Error> {
  return useQuery({
    queryKey: eventCloneKeys.source(sourceId),
    queryFn: () => previewEventClone({ sourceEventId: sourceId }),
    enabled: sourceId !== "",
    // Brak zrodla (`not_found`) nie jest bledem sieci - ponowienie nic nie zmieni.
    retry: false,
  });
}

/** Podglad szkicu: odroczony po tresci ladunku, poprzedni wynik zostaje. */
export function useEventClonePreview(
  input: EventCloneInput | null,
): UseQueryResult<EventClonePreview, Error> {
  const text = input === null ? "" : JSON.stringify(clonePayload(input));
  const debounced = useDebouncedValue(text, CLONE_PREVIEW_DEBOUNCE_MS);
  const sourceId = input === null ? "" : input.sourceEventId;
  const payload = useMemo(() => JSON.parse(debounced === "" ? "{}" : debounced) as Json, [debounced]);
  return useQuery({
    queryKey: eventCloneKeys.preview(sourceId, debounced),
    queryFn: () => requestClonePreview(payload),
    enabled: debounced !== "",
    placeholderData: keepPreviousData,
    retry: false,
  });
}

/**
 * Klon. Uniewaznia liste wydarzen (nowy wiersz), katalog rodzajow (licznik
 * uzycia) i galaz ZRODLA (lista jego edycji), a wynik wpisuje w galaz KOPII,
 * skad czyta go podsumowanie na pulpicie nowej edycji.
 */
export function useCloneEvent(): UseMutationResult<EventCloneResult, Error, EventCloneInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: cloneEvent,
    onSuccess: (result) => {
      qc.setQueryData(eventCloneKeys.result(result.eventId), result);
      void qc.invalidateQueries({ queryKey: adminEventKeys.all });
      void qc.invalidateQueries({ queryKey: eventTypeKeys.all });
      void qc.invalidateQueries({ queryKey: ["admin-community-events"] });
      void qc.invalidateQueries({ queryKey: eventCloneKeys.editions(result.sourceEventId) });
    },
  });
}

export function useEventEditions(eventId: string): UseQueryResult<EventEditionRow[], Error> {
  return useQuery({
    queryKey: eventCloneKeys.editions(eventId),
    queryFn: () => fetchEventEditions(eventId),
    enabled: eventId !== "",
  });
}

/** Podsumowanie ostatniego klonu, ktory utworzyl TO wydarzenie (albo `null`). */
export function useEventCloneResult(eventId: string): EventCloneResult | null {
  const q = useQuery<EventCloneResult | null>({
    queryKey: eventCloneKeys.result(eventId),
    queryFn: () => Promise.resolve(null),
    enabled: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  return q.data ?? null;
}

/** Zamkniecie podsumowania - bez zapytania, tylko wyczyszczenie wpisu cache. */
export function useDismissCloneResult(eventId: string): () => void {
  const qc = useQueryClient();
  return () => qc.setQueryData(eventCloneKeys.result(eventId), null);
}

export function useCloneSourceSearch(q: string): UseQueryResult<CloneSourceRow[], Error> {
  const phrase = q.trim();
  return useQuery({
    queryKey: eventCloneKeys.search(phrase),
    queryFn: () => searchCloneSources(phrase),
    enabled: phrase.length >= CLONE_SEARCH_MIN_LENGTH,
  });
}
