// Cienki plik `createServerFn` - logika w `outcomeResend.server.ts`
// i `webhookHealth` po stronie RPC bazy.
//
// Bezpieczeństwo: zalogowanie (middleware) plus serwerowa weryfikacja roli
// `admin`. Klient podaje wyłącznie identyfikator zgłoszenia; treść i adresat
// pochodzą z bazy.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ResendOutcomeResult } from "@/lib/events/outcomeResend.server";

const schema = z.object({ registrationId: z.string().uuid() });

/** Ponawia wysyłkę maila/SMS o statusie zgłoszenia - bez zmiany płatności. */
export const resendRegistrationNotifications = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => schema.parse(input))
  .handler(async ({ data, context }): Promise<ResendOutcomeResult> => {
    const { assertAdmin } = await import("@/lib/billing/diagnostics.server");
    await assertAdmin(context.supabase, context.userId);
    const { resendTicketOutcome } = await import("@/lib/events/outcomeResend.server");
    return resendTicketOutcome(data.registrationId);
  });
