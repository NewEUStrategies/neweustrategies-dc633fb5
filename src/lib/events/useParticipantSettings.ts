// Hooki panelu ustawień uczestnika (komunikacja, zasady rejestracji, tor C).
//
// KLUCZE SĄ KONTRAKTEM. `["admin-event-participant-settings", eventId]`
// unieważnia mapa zdarzeń domenowych (`event.participant_settings.updated.v1`),
// więc drugi administrator w innej karcie zobaczy zapis bez przeładowania.
// Zmiana literału tutaj bez zmiany w `eventInvalidationMap.ts` rozjechałaby
// oba miejsca po cichu - test klucza (`useParticipantSettings.test.tsx`)
// przypina oba literały.
//
// ZAPIS UNIEWAŻNIA PUBLICZNE FLAGI. `event_participant_options(slug)` czyta
// ten sam wiersz (np. „eksport do kalendarza włączony"), a panel zna tylko
// `eventId` - unieważniamy więc całą rodzinę `["event-participant-options"]`.
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import type { Json } from "@/integrations/supabase/types";
import type { ParticipantSettings } from "@/lib/events/participantSettings";
import {
  fetchMessageDeliveryStats,
  fetchParticipantSettings,
  saveParticipantSettings,
  type MessageDeliveryStats,
} from "@/lib/events/participantSettingsApi";

export const participantSettingsKeys = {
  one: (eventId: string) => ["admin-event-participant-settings", eventId] as const,
  deliveries: (eventId: string) => ["admin-event-message-deliveries", eventId] as const,
};

/**
 * Dostępność SMS (`getParticipantSmsAvailability`) - odpowiedź nie zależy od
 * wołającego ani od wydarzenia, więc klucz jest jeden dla całego panelu.
 */
export const PARTICIPANT_SMS_AVAILABILITY_KEY = ["participant-sms-availability"] as const;

const SETTINGS_STALE_MS = 15_000;

export function useParticipantSettings(
  eventId: string,
): UseQueryResult<ParticipantSettings, Error> {
  return useQuery({
    queryKey: participantSettingsKeys.one(eventId),
    queryFn: () => fetchParticipantSettings(eventId),
    staleTime: SETTINGS_STALE_MS,
    enabled: eventId !== "",
  });
}

export function useSaveParticipantSettings(
  eventId: string,
): UseMutationResult<ParticipantSettings, Error, { [key: string]: Json }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { [key: string]: Json }) => saveParticipantSettings(payload),
    onSuccess: (data) => {
      qc.setQueryData(participantSettingsKeys.one(eventId), data);
      void qc.invalidateQueries({ queryKey: ["event-participant-options"] });
    },
  });
}

export function useMessageDeliveryStats(
  eventId: string,
): UseQueryResult<MessageDeliveryStats, Error> {
  return useQuery({
    queryKey: participantSettingsKeys.deliveries(eventId),
    queryFn: () => fetchMessageDeliveryStats(eventId),
    staleTime: SETTINGS_STALE_MS,
    enabled: eventId !== "",
  });
}
