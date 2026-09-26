// Ponowna wysyłka biletu z kodem QR z panelu organizatora.
//
// PO CO. Gość, któremu mail z biletem nie doszedł (spam, literówka poprawiona
// po fakcie, wiersz ostemplowany przez backfill 0044), nie miał dotąd żadnej
// drogi do biletu - znacznik `ticket_code_sent_at` wykluczał go z wydania
// i z crona na zawsze.
//
// DWA KROKI, DWIE GRANICE. `admin_event_ticket_resend` idzie klientem
// ORGANIZATORA (bramka roli i najemcy w bazie): sprawdza, że wiersz jest
// przyjęty i rozliczony, kasuje znacznik wysyłki i oddaje identyfikator do
// wydania. Dopiero ten identyfikator - już po autoryzacji - trafia do
// `issueAndSendTicketCodes` na kluczu serwisowym, który zajmuje zgłoszenie,
// rotuje kod i wysyła mail. Z `includeGroup` identyfikatorem jest prowadzący,
// więc bilet dostaje cała przyjęta grupa.
//
// ODMOWA BAZY WRACA JAKO TEKST (`ticket_not_issuable: ...`, `not_found: ...`)
// - panel tłumaczy ją tym samym słownikiem, co pozostałe odmowy zapisów.
//
// Moduł zawiera WYŁĄCZNIE deklarację server function + importy (wymóg
// tss-serverfn-split).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** `sent` - liczba wysłanych maili z biletem (0 = nic nie wyszło). */
export type TicketResendResult = { ok: true; sent: number } | { ok: false; error: string };

const Input = z.object({
  registrationId: z.string().uuid(),
  includeGroup: z.boolean().default(true),
});

export const resendEventTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data, context }): Promise<TicketResendResult> => {
    const { data: rootId, error } = await context.supabase.rpc("admin_event_ticket_resend", {
      p_registration_id: data.registrationId,
      p_include_group: data.includeGroup,
    });
    if (error) return { ok: false, error: error.message };
    if (typeof rootId !== "string" || rootId === "") return { ok: false, error: "not_found" };

    const { issueAndSendTicketCodes } = await import("@/lib/events/ticketCodeNotify.server");
    return { ok: true, sent: await issueAndSendTicketCodes(rootId) };
  });
