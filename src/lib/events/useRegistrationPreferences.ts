// Haki karty przypomnień i przełącznika SMS (REG-09 / REG-10).
//
// KLUCZ ZAPYTANIA TO ZGŁOSZENIE, NIE POŚWIADCZENIE. Karta w „Moich
// zgłoszeniach" (konto) i karta na stronie samoobsługi (klucz z maila) czytają
// TO SAMO zgłoszenie - jeden wpis cache `["event-registration-preferences",
// registrationId]`. Klucz `manage_token` jedzie wyłącznie w ładunku RPC.
//
// POBIERANIE NA ŻĄDANIE. Karta jest zwinięta i pyta bazę dopiero po
// rozwinięciu (`enabled`) - lista dwudziestu zgłoszeń nie robi dwudziestu
// zapytań o preferencje, których nikt nie otworzył.
//
// DOSTĘPNOŚĆ SMS-ÓW. Zmienne środowiska żyją po stronie serwera, więc pytamy
// `getParticipantSmsAvailability` - ten sam klucz cache, co panel komunikacji
// organizatora (`useParticipantSettings.PARTICIPANT_SMS_AVAILABILITY_KEY`):
// odpowiedź nie zależy od wołającego. Literał stoi tu osobno, żeby strona
// uczestnika nie ciągnęła do paczki modułu panelu.
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import {
  fetchRegistrationPreferences,
  type RegistrationPreferences,
} from "@/lib/events/registrationChannelsApi";
import { getParticipantSmsAvailability } from "@/lib/events/smsAvailability.functions";

export function registrationPreferencesKey(registrationId: string) {
  return ["event-registration-preferences", registrationId] as const;
}

/** Ten sam literał, co `PARTICIPANT_SMS_AVAILABILITY_KEY` panelu organizatora. */
export const SMS_AVAILABILITY_KEY = ["participant-sms-availability"] as const;

export function useRegistrationPreferences({
  registrationId,
  manageToken = null,
  enabled,
}: {
  registrationId: string;
  /** Klucz z maila - pierwszeństwo przed sesją (strona samoobsługi). */
  manageToken?: string | null;
  enabled: boolean;
}) {
  return useQuery<RegistrationPreferences>({
    queryKey: registrationPreferencesKey(registrationId),
    queryFn: () =>
      fetchRegistrationPreferences(manageToken !== null ? { manageToken } : { registrationId }),
    enabled,
    staleTime: 15_000,
  });
}

/** Czy platforma wysyła SMS-y uczestnikom (`EVENT_SMS_ENABLED` + operator). */
export function useParticipantSmsAvailable(): boolean {
  const readAvailability = useServerFn(getParticipantSmsAvailability);
  const query = useQuery({
    queryKey: SMS_AVAILABILITY_KEY,
    queryFn: () => readAvailability(),
    staleTime: 5 * 60_000,
  });
  // Brak odpowiedzi = SMS niedostępny (bezpieczna strona - nie obiecujemy kanału).
  return query.data?.smsEnabled === true;
}
