// Bilety z kodem QR dla bezpłatnego zapisu grupowego - wysyłane od razu po
// dopisaniu gości, bo nie ma płatności, po której zrobiłby to webhook.
//
// UWIERZYTELNIENIE KLUCZEM `manage_token` PROWADZĄCEGO, jak potwierdzenie
// zapisu (`registrationSelfNotify.functions`). Najemca z zaufanego hosta,
// klucz rozstrzyga baza jedną regułą (REG-17) - szczegóły w
// `groupTicketCodes.server.ts`.
//
// Moduł zawiera WYŁĄCZNIE deklarację server function + importy (wymóg
// tss-serverfn-split).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { GroupTicketCodesResult } from "@/lib/events/groupTicketCodes.server";

export type { GroupTicketCodesResult } from "@/lib/events/groupTicketCodes.server";

const Input = z.object({
  /** 24 bajty base64url z `_event_new_qr_token()` - dokładnie 32 znaki. */
  manageToken: z.string().regex(/^[A-Za-z0-9_-]{32}$/),
});

export const sendGroupTicketCodes = createServerFn({ method: "POST" })
  .validator((data: unknown) => Input.parse(data))
  .handler(async ({ data }): Promise<GroupTicketCodesResult> => {
    const { sendGroupTicketCodesForRequest } = await import("@/lib/events/groupTicketCodes.server");
    return sendGroupTicketCodesForRequest(data.manageToken);
  });
