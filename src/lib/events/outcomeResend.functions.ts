// Cienki plik `createServerFn` - logika w `outcomeResend.server.ts`
// i `webhookHealth` po stronie RPC bazy.
//
// Bezpieczeństwo: zalogowanie (middleware) plus serwerowa weryfikacja roli
// `admin`. Klient podaje wyłącznie identyfikator zgłoszenia; treść i adresat
// pochodzą z bazy.
//
// ZAKRES NAJEMCY BIERZEMY Z BRAMKI, NIE Z ŁADUNKU. `assertAdmin` autoryzuje
// rolę w obszarze PROFILU wołającego i tego samego najemcę oddaje w wyniku -
// podajemy go dalej, bo odczyt w `outcomeResend.server.ts` idzie kluczem
// serwisowym (z pominięciem RLS) po identyfikatorze pochodzącym od klienta.
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
    const { tenantId } = await assertAdmin(context.supabase, context.userId);
    const { resendTicketOutcome } = await import("@/lib/events/outcomeResend.server");
    return resendTicketOutcome(data.registrationId, tenantId);
  });
