// Odsłonięcie ukrytych biletów kodem z linku albo z pola formularza zapisu.
//
// DLACZEGO FUNKCJA SERWEROWA, A NIE RPC Z PRZEGLĄDARKI. Odpowiedź „ten kod
// odsłania bilet" mówi, że kod istnieje - bez limitu prób to wyrocznia do
// zgadywania kodów. Limit po IP zna wyłącznie serwer, a najemca ma pochodzić
// z ZAUFANEGO hosta, a nie z nagłówka zapytania do bazy. Dlatego RPC
// `event_coupon_revealed_tickets` jest wykonywalne tylko dla `service_role`
// (migracja 20261001100000) i przyjmuje najemcę jawnie.
//
// PUBLICZNA, BEZ MIDDLEWARE. Formularz zapisu jest dla anonimów; sesję, gdy
// jest, serwer czyta miękko (`optionalUserIdFromRequest`) tylko po to, żeby
// dołożyć kubełek limitu na konto.
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
