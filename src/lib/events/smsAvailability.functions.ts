// Czy SMS-y uczestnika są dostępne na tej platformie (wyłącznik
// `EVENT_SMS_ENABLED` + token operatora).
//
// PO CO FUNKCJA SERWEROWA. Zmienne środowiska żyją wyłącznie po stronie
// serwera - przeglądarka nie wie, czy operator SMS jest skonfigurowany.
// Panel komunikacji (przełącznik SMS organizatora) i karta preferencji
// przypomnień uczestnika pytają tutaj, zanim pokażą opcję, której nie da się
// użyć. Odpowiedź nie zależy od wołającego, więc nie ma middleware i nie
// potrzebuje sesji.
//
// Moduł zawiera WYŁĄCZNIE deklarację server function (wymóg podziału
// `*.functions.ts` / `*.server.ts`); logika w `smsAvailability.server.ts`.
import { createServerFn } from "@tanstack/react-start";

import type { ParticipantSmsAvailability } from "@/lib/events/smsAvailability.server";

export const getParticipantSmsAvailability = createServerFn({ method: "GET" }).handler(
  async (): Promise<ParticipantSmsAvailability> => {
    const { readParticipantSmsAvailability } = await import("@/lib/events/smsAvailability.server");
    return readParticipantSmsAvailability();
  },
);
