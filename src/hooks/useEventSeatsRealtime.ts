// Dostępność miejsc na wydarzeniu w czasie rzeczywistym.
//
// Liczbę zajętych miejsc bierzemy z backendu (SECURITY DEFINER RPC), a nie z
// cudzych wierszy RSVP. Realtime na `event_rsvps` służy tylko jako sygnał
// „przelicz ponownie" - dane zawsze pochodzą z serwera.
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { subscribeToTable } from "@/lib/realtime/tableChannelHub";
import { getEventSeatState } from "@/lib/events/ticket.functions";
import type { EventSeatState } from "@/lib/events/ticketTypes";

export interface UseEventSeatsResult {
  seats: EventSeatState | null;
  isLoading: boolean;
}

export function useEventSeatsRealtime(eventId: string | undefined): UseEventSeatsResult {
  const qc = useQueryClient();
  const loadSeats = useServerFn(getEventSeatState);
  const queryKey = ["event-seat-state", eventId] as const;

  const seatsQ = useQuery({
    queryKey,
    queryFn: () => loadSeats({ data: { eventId: eventId! } }),
    enabled: !!eventId,
    // Miejsca to dane szybko wygasające - odświeżamy też przy powrocie na kartę.
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (!eventId) return;
    return subscribeToTable({ table: "event_rsvps", filter: `event_id=eq.${eventId}` }, () => {
      void qc.invalidateQueries({ queryKey });
      void qc.invalidateQueries({ queryKey: ["event-rsvp-counts", eventId] });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, qc]);

  return { seats: seatsQ.data ?? null, isLoading: seatsQ.isLoading };
}
