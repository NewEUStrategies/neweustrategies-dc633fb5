// Potwierdzenie zapisu wysyłane kluczem samoobsługi - PUBLICZNA obwódka.
//
// GOŚĆ BEZ KONTA TEŻ DOSTAJE POTWIERDZENIE. Ścieżka administracyjna
// (`registrationNotify.functions`) wymaga roli redakcyjnej, a uczestnik, który
// właśnie się zapisał, żadnej roli nie ma.
//
// OD REG-04 POTWIERDZENIE WYSYŁA SERWER ZAPISU. Formularz nie woła już tej
// funkcji: `eventRegistration.server.ts` po utworzeniu zgłoszenia sam wysyła
// mail (`sendRegistrationNoticeForManageToken`), bo przeglądarka
// niezweryfikowanego wołającego nie dostaje klucza samoobsługi wcale. Funkcja
// zostaje dla starszych wywołań z tym samym kontraktem.
//
// UWIERZYTELNIENIE TYM SAMYM SEKRETEM, CO REZYGNACJA. Kto zna `manage_token`,
// może już dziś odwołać ten zapis - więc wysłanie maila na adres zgłoszenia
// niczego nie otwiera. Serwer NIE ufa niczemu poza tym kluczem: adres, język,
// status i najemca biorą się z bazy i z zaufanego hosta.
//
// Moduł zawiera WYŁĄCZNIE deklarację server function + importy (wymóg
// tss-serverfn-split). Logika: `registrationSelfNotify.server.ts`.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { SelfNotifyResult } from "@/lib/events/registrationSelfNotify.server";

export type { SelfNotifyResult } from "@/lib/events/registrationSelfNotify.server";

const Input = z.object({
  /** 24 bajty base64url z `_event_new_qr_token()` - dokładnie 32 znaki. */
  manageToken: z.string().regex(/^[A-Za-z0-9_-]{32}$/),
});

export const confirmEventRegistrationEmail = createServerFn({ method: "POST" })
  .validator((data: unknown) => Input.parse(data))
  .handler(async ({ data }): Promise<SelfNotifyResult> => {
    const { confirmRegistrationNoticeForRequest } =
      await import("@/lib/events/registrationSelfNotify.server");
    return confirmRegistrationNoticeForRequest(data.manageToken);
  });
