// Hooki jednego wydarzenia w studiu.
//
// JEDEN KLUCZ CACHE NA WYDARZENIE. Kazdy ekran studia (informacje ogolne,
// branding, strony, grupy) czyta ten sam wiersz - osobne zapytanie na ekran
// znaczyloby cztery odpowiedzi, ktore po zapisie rozjezdzaja sie w czasie.
//
// ZAPIS UNIEWAZNIA TAKZE LISTE MODULU. Tytul, termin i status widac na liscie
// wydarzen; bez uniewaznienia redaktor wraca z zapisu na liste pokazujaca stara
// nazwe i nie wie, czy zapis przeszedl.
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  fetchAdminEventDetail,
  saveEventBranding,
  saveEventGeneral,
  setEventStatus,
  type AdminEventDetailRow,
  type EventStatus,
} from "@/lib/events/eventDetailApi";
import { adminEventKeys } from "@/lib/events/useAdminEvents";

export const eventDetailKeys = {
  all: ["admin-event-detail"] as const,
  one: (eventId: string) => [...eventDetailKeys.all, eventId] as const,
};

const DETAIL_STALE_MS = 15_000;

export function useAdminEventDetail(
  eventId: string,
): UseQueryResult<AdminEventDetailRow | null, Error> {
  return useQuery({
    queryKey: eventDetailKeys.one(eventId),
    queryFn: () => fetchAdminEventDetail(eventId),
    staleTime: DETAIL_STALE_MS,
    enabled: eventId !== "",
  });
}

function useDetailInvalidation(eventId: string): () => void {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: eventDetailKeys.one(eventId) });
    void qc.invalidateQueries({ queryKey: adminEventKeys.all });
    // Stara lista w sekcji spolecznosci czyta te same wiersze.
    void qc.invalidateQueries({ queryKey: ["admin-community-events"] });
  };
}

export function useSaveEventGeneral(
  eventId: string,
): UseMutationResult<string, Error, Record<string, string | string[]>> {
  const invalidate = useDetailInvalidation(eventId);
  return useMutation({ mutationFn: saveEventGeneral, onSuccess: invalidate });
}

export function useSaveEventBranding(
  eventId: string,
): UseMutationResult<void, Error, Record<string, string>> {
  const invalidate = useDetailInvalidation(eventId);
  return useMutation({
    mutationFn: (branding: Record<string, string>) => saveEventBranding(eventId, branding),
    onSuccess: invalidate,
  });
}

export function useSetEventStatus(
  eventId: string,
): UseMutationResult<EventStatus, Error, EventStatus> {
  const invalidate = useDetailInvalidation(eventId);
  return useMutation({
    mutationFn: (status: EventStatus) => setEventStatus(eventId, status),
    onSuccess: invalidate,
  });
}
