// Hook publicznych flag funkcji uczestnika.
//
// NIGDY NIE PREFETCHOWANY (S38). Strona wydarzenia, jej zakładki i korzeń nie
// dostają nowego loadera ani `ensureQueryData` - flagi pobiera dopiero
// komponent, który ich potrzebuje (otwarte menu kalendarza, panel „moje
// wydarzenie" po zalogowaniu). Stąd jawny `enabled` w sygnaturze: wołający
// MUSI zdecydować, kiedy zapytanie ma sens.
//
// MINUTA ŚWIEŻOŚCI. Flagi zmienia organizator raz na długi czas; 60 s
// wystarcza, żeby przełączanie zakładek nie pytało bazy za każdym razem,
// a zapis w panelu i tak unieważnia całą rodzinę kluczy.
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import {
  fetchEventParticipantOptions,
  type EventParticipantOptions,
} from "@/lib/events/participantOptionsApi";

export const participantOptionsKeys = {
  one: (slug: string) => ["event-participant-options", slug] as const,
};

export function useEventParticipantOptions(
  slug: string,
  enabled: boolean,
): UseQueryResult<EventParticipantOptions | null, Error> {
  return useQuery({
    queryKey: participantOptionsKeys.one(slug),
    queryFn: () => fetchEventParticipantOptions(slug),
    enabled: enabled && slug.length > 0,
    staleTime: 60_000,
  });
}
