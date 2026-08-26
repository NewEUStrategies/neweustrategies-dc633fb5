// Hooki ekranu „Strony i menu" wydarzenia.
//
// JEDNA FABRYKA KLUCZY NA CALY EKRAN, GALAZ PER WYDARZENIE: przypiecie,
// odpiecie, kolejnosc i utworzenie strony zmieniaja TE SAMA liste, wiec kazda
// mutacja uniewaznia galaz tego wydarzenia, a zapytania pozostalych wydarzen
// zostaja nietkniete.
//
// UTWORZENIE STRONY SIEGA POZA TEN EKRAN. `admin_event_page_create` zaklada
// korzen wydarzenia, gdy go nie ma - czyli zmienia `events.root_page_id`,
// z ktorego rama studia buduje odsylacz „Dostosuj w builderze" - i dopisuje
// wiersz do `pages`, czyli do drzewa `/admin/pages`. Bez uniewaznienia tych
// dwoch redaktor po utworzeniu pierwszej podstrony nadal widzi „wydarzenie nie
// ma jeszcze strony glownej".
//
// PODGLADU NIE UNIEWAZNIAMY. Podglad na zywo nie jest zapytaniem - ekran wpisuje
// do niego szkic przez `useSyncEventPreview`, a szkic liczy sie z tej samej
// listy, wiec odswiezenie listy przerysowuje podglad samo.
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  createEventPage,
  detachEventPage,
  fetchEventPages,
  fetchEventRootPage,
  reorderEventPages,
  saveEventPage,
  type EventPageCreateInput,
  type EventPageInput,
  type EventPageRow,
  type EventRootPageRow,
} from "@/lib/events/eventPagesApi";
import { eventDetailKeys } from "@/lib/events/useAdminEventDetail";

export const eventPagesKeys = {
  all: ["admin-event-pages"] as const,
  event: (eventId: string) => [...eventPagesKeys.all, eventId] as const,
  list: (eventId: string) => [...eventPagesKeys.event(eventId), "list"] as const,
  root: (rootPageId: string) => [...eventPagesKeys.all, "root", rootPageId] as const,
  document: (pageId: string) => [...eventPagesKeys.all, "document", pageId] as const,
};

export function useAdminEventPages(
  eventId: string,
  enabled = true,
): UseQueryResult<EventPageRow[], Error> {
  return useQuery({
    queryKey: eventPagesKeys.list(eventId),
    queryFn: () => fetchEventPages(eventId),
    enabled: enabled && eventId !== "",
  });
}

/**
 * Dokument buildera WYBRANEJ podstrony - zrodlo podgladu tresci w studiu.
 *
 * OSOBNE ZAPYTANIE NA STRONE, a nie `builder_data` w liscie: dokumenty stron waza
 * tyle, co cala tresc serwisu, wiec lista menu ciagnelaby je wszystkie po to,
 * zeby pokazac jeden.
 */
export function useEventPageDocument(
  pageId: string | null,
): UseQueryResult<BuilderDocument | null, Error> {
  const key = pageId ?? "";
  return useQuery({
    queryKey: eventPagesKeys.document(key),
    queryFn: () => fetchEventPageDocument(key),
    enabled: key !== "",
  });
}

export function useEventRootPage(
  rootPageId: string | null,
): UseQueryResult<EventRootPageRow | null, Error> {
  const key = rootPageId ?? "";
  return useQuery({
    queryKey: eventPagesKeys.root(key),
    queryFn: () => fetchEventRootPage(rootPageId),
    enabled: key !== "",
  });
}

function useEventPagesInvalidation(eventId: string): () => void {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: eventPagesKeys.event(eventId) });
    // Wiersz wydarzenia niesie `root_page_id`, a drzewo stron panelu niesie
    // nowo zalozona strone - patrz naglowek pliku.
    void client.invalidateQueries({ queryKey: eventDetailKeys.one(eventId) });
    void client.invalidateQueries({ queryKey: ["admin-pages"] });
  };
}

export function useSaveEventPage(
  eventId: string,
): UseMutationResult<string, Error, EventPageInput> {
  const invalidate = useEventPagesInvalidation(eventId);
  return useMutation({
    mutationFn: (input: EventPageInput) => saveEventPage(input),
    onSuccess: invalidate,
  });
}

export function useDetachEventPage(eventId: string): UseMutationResult<boolean, Error, string> {
  const invalidate = useEventPagesInvalidation(eventId);
  return useMutation({
    mutationFn: (id: string) => detachEventPage(id),
    onSuccess: invalidate,
  });
}

export function useReorderEventPages(
  eventId: string,
): UseMutationResult<number, Error, readonly string[]> {
  const invalidate = useEventPagesInvalidation(eventId);
  return useMutation({
    mutationFn: (ids: readonly string[]) => reorderEventPages(eventId, ids),
    onSuccess: invalidate,
  });
}

export function useCreateEventPage(
  eventId: string,
): UseMutationResult<string, Error, EventPageCreateInput> {
  const invalidate = useEventPagesInvalidation(eventId);
  return useMutation({
    mutationFn: (input: EventPageCreateInput) => createEventPage(input),
    onSuccess: invalidate,
  });
}
