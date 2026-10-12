// Odsłonięcie ukrytych biletów kodem z linku albo z pola formularza zapisu.
//
// DLACZEGO FUNKCJA SERWEROWA, A NIE RPC Z PRZEGLĄDARKI. Odpowiedź „ten kod
// odsłania bilet" mówi, że kod istnieje - bez limitu prób to wyrocznia do
// zgadywania kodów. Limit po IP zna wyłącznie serwer, a najemca ma pochodzić
// z ZAUFANEGO hosta, a nie z nagłówka zapytania do bazy. Dlatego RPC
// `event_registration_revealed_tickets` (B1a; w oknie wdrożenia
// `event_coupon_revealed_tickets`, migracja 20261001100000) jest wykonywalne
// tylko dla `service_role` i przyjmuje najemcę jawnie.
//
// BILETY, NIE IDENTYFIKATORY (REG-05). Formularz publiczny nie oddaje już
// biletów ukrytych, więc odpowiedź niesie pełne wiersze biletów w kształcie
// formularza - przeglądarka dokleja je do listy wyboru.
//
// PUBLICZNA, BEZ MIDDLEWARE. Formularz zapisu jest dla anonimów; sesję, gdy
// jest, serwer czyta miękko (`optionalUserIdFromRequest`), żeby dołożyć
// kubełek limitu na konto i policzyć blokadę poziomu członkostwa.
//
// POST, bo każde wywołanie liczy się do limitu - odpowiedź nie może leżeć
// w żadnym cache.
//
// Moduł zawiera WYŁĄCZNIE deklarację server function + importy (wymóg
// tss-serverfn-split). Logika: `eventCodeReveal.server.ts`.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Input = z.object({
  eventId: z.string().uuid(),
  /** Kod w bazie ma najwyżej 64 znaki - dłuższy nie ma czego szukać. */
  code: z.string().trim().min(1).max(64),
});

export const revealEventCodeTickets = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data }) => {
    const { revealTicketsForEventCode } = await import("@/lib/events/eventCodeReveal.server");
    return revealTicketsForEventCode(data.eventId, data.code);
  });
