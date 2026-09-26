// Raport dla sponsora po tokenie linku - odczyt dla strony
// `/events/$slug/sponsor-report` (sponsor BEZ konta).
//
// DLACZEGO FUNKCJA SERWEROWA, A NIE RPC Z PRZEGLĄDARKI. Odczyt po tokenie
// musi mieć limit prób po IP (zgadywanie tokenów), a adres IP zna wyłącznie
// serwer; najemca pochodzi z ZAUFANEGO hosta, a nie z nagłówka zapytania do
// bazy, który przeglądarka mogłaby podrobić. Dlatego RPC
// `event_sponsor_report_for_token` jest wykonywalne tylko dla `service_role`.
//
// ODPOWIEDŹ TO `{ json }`. Serializator TanStack odrzuca część wartości jsonb,
// a kształt i tak sprawdza parser po stronie klienta
// (`parseSponsorReportJson` w `sponsorReportPayload.ts`).
//
// Moduł zawiera WYŁĄCZNIE deklarację server function + importy (wymóg
// tss-serverfn-split). Logika: `sponsorReport.server.ts`.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Input = z.object({
  /** 24 bajty base64url z `_event_new_qr_token()` - dokładnie 32 znaki. */
  token: z.string().regex(/^[A-Za-z0-9_-]{32}$/),
});

export const getSponsorReportByToken = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data }): Promise<{ json: string }> => {
    const { loadSponsorReportByToken } = await import("@/lib/events/sponsorReport.server");
    return loadSponsorReportByToken(data.token);
  });
