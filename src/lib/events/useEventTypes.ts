// Hooki katalogu rodzajow wydarzen.
//
// Katalog jest maly i rzadko sie zmienia, wiec trzymamy go dlugo w cache -
// selekt w kreatorze wydarzenia nie moze migotac przy kazdym otwarciu dialogu.
//
// KLUCZE CACHE SA JEDNA FABRYKA. Rozsypane literaly (`["event-types"]` w jednym
// pliku, `["eventTypes"]` w drugim) to najczestsza przyczyna "zapisalem, a lista
// sie nie odswiezyla": unieważnienie trafia w klucz, ktorego nikt nie uzywa.
// Fabryka daje jedno miejsce prawdy i jedno `invalidateQueries` na cala rodzine.
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { EventTypeAdminRow, EventTypeOption } from "@/lib/events/eventTypes";
import {
  deleteEventType,
  fetchActiveEventTypes,
  fetchAdminEventTypes,
  reassignEventType,
  setEventTypeActive,
  upsertEventType,
  type EventTypeUpsertInput,
} from "@/lib/events/eventTypesApi";

export const eventTypeKeys = {
  all: ["event-types"] as const,
  active: () => [...eventTypeKeys.all, "active"] as const,
  admin: () => [...eventTypeKeys.all, "admin"] as const,
};

const ACTIVE_STALE_MS = 5 * 60 * 1000;
const ADMIN_STALE_MS = 30_000;

/**
 * Aktywne rodzaje organizacji - zrodlo selektu w kreatorze i filtrow na liscie.
 *
 * BEZ LISTY AWARYJNEJ, w odroznieniu od `useClubTopics`. Rodzaje sa per tenant
 * i redakcyjne, wiec zadna stala w kodzie nie jest dla nich poprawna: pokazanie
 * szesciu rodzajow systemowych organizacji, ktora ich nie uzywa, jest gorsze niz
 * pusty selekt z informacja o wczytywaniu.
 */
export function useEventTypes(enabled = true): UseQueryResult<EventTypeOption[], Error> {
  return useQuery({
    queryKey: eventTypeKeys.active(),
    queryFn: fetchActiveEventTypes,
    staleTime: ACTIVE_STALE_MS,
    enabled,
  });
}

export function useAdminEventTypes(enabled = true): UseQueryResult<EventTypeAdminRow[], Error> {
  return useQuery({
    queryKey: eventTypeKeys.admin(),
    queryFn: fetchAdminEventTypes,
    staleTime: ADMIN_STALE_MS,
    enabled,
  });
}

/**
 * Unieważnienie po zapisie obejmuje CALA rodzine kluczy, a nie tylko listę
 * panelu: przelaczenie rodzaju na nieaktywny musi zniknac takze z selektu
 * w kreatorze, ktory czyta `active()`.
 */
function useEventTypeInvalidation(): () => void {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: eventTypeKeys.all });
  };
}

export function useUpsertEventType(): UseMutationResult<string, Error, EventTypeUpsertInput> {
  const invalidate = useEventTypeInvalidation();
  return useMutation({
    mutationFn: upsertEventType,
    onSuccess: invalidate,
  });
}

export function useSetEventTypeActive(): UseMutationResult<
  boolean,
  Error,
  { id: string; isActive: boolean }
> {
  const invalidate = useEventTypeInvalidation();
  return useMutation({
    mutationFn: ({ id, isActive }) => setEventTypeActive(id, isActive),
    onSuccess: invalidate,
  });
}

export function useDeleteEventType(): UseMutationResult<boolean, Error, string> {
  const invalidate = useEventTypeInvalidation();
  return useMutation({
    mutationFn: deleteEventType,
    onSuccess: invalidate,
  });
}

/**
 * Przepiecie wydarzen na inny rodzaj. Unieważnia takze wydarzenia - operacja
 * zmienia `events.event_type_id` i `events.kind`, wiec lista wydarzen w panelu
 * i widgety publiczne trzymaja po niej nieaktualne dane.
 */
export function useReassignEventType(): UseMutationResult<
  number,
  Error,
  { fromId: string; toId: string }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ fromId, toId }) => reassignEventType(fromId, toId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: eventTypeKeys.all });
      void qc.invalidateQueries({ queryKey: ["admin-community-events"] });
    },
  });
}
