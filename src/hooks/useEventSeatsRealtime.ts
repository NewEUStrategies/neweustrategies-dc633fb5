// Dostępność miejsc na wydarzeniu.
//
// Liczbę zajętych miejsc bierzemy z backendu (SECURITY DEFINER RPC), a nie z
// cudzych wierszy RSVP.
//
// REALTIME USUNIĘTY (F34), bo go NIGDY NIE BYŁO. Kanał na `event_rsvps`
// subskrybował tabelę, której NIE MA w publikacji `supabase_realtime` (grep
// `alter publication supabase_realtime add table` w supabase/migrations nie zna
// tej tabeli), więc nie dostarczył ani jednego zdarzenia - płacił tylko za
// zestawienie websocketu (TLS + WS + auth + join) na każdą odsłonę strony
// wydarzenia, także anonimową. Świeżość niesie teraz odpytywanie:
// `refetchInterval` 30 s + refetch przy powrocie na kartę, a react-query
// wstrzymuje interwał, gdy karta nie jest widoczna
// (`refetchIntervalInBackground` domyślnie false) - niewidoczna karta nie
// generuje ruchu. Gdyby kiedyś realtime był tu naprawdę potrzebny, warunkiem
// wstępnym jest migracja dodająca `public.event_rsvps` do publikacji.
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { getEventSeatState } from "@/lib/events/ticket.functions";
import type { EventSeatState } from "@/lib/events/ticketTypes";

export interface UseEventSeatsResult {
  seats: EventSeatState | null;
  isLoading: boolean;
}

export function useEventSeatsRealtime(eventId: string | undefined): UseEventSeatsResult {
  const loadSeats = useServerFn(getEventSeatState);

  const seatsQ = useQuery({
    queryKey: ["event-seat-state", eventId] as const,
    queryFn: () => loadSeats({ data: { eventId: eventId! } }),
    enabled: !!eventId,
    // Miejsca to dane szybko wygasające - odświeżamy też przy powrocie na kartę.
    staleTime: 10_000,
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });

  return { seats: seatsQ.data ?? null, isLoading: seatsQ.isLoading };
}
