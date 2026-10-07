// Cienki wrapper serwerowy (tss-serverfn-split) nad ODBIOREM biletu z puli
// planu dla pojedynczego zgłoszenia etapu 4 - bez Stripe i bez zamówienia.
//
// Uwierzytelnienie jak w kasie i podglądzie: pula liczy się po `auth.uid()`,
// a baza przyjmuje wyłącznie zgłoszenie, którego osobą jest wołający. Klient
// wskazuje identyfikatory; o cenie, puli i miejscu rozstrzyga baza
// (`redeemPlanTicket`, `event_registration_redeem_plan_ticket`).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { PlanTicketRedeemResult } from "@/lib/billing/eventTicketPlanRedeem.server";

const redeemSchema = z.object({
  event_id: z.string().uuid(),
  ticket_type_id: z.string().uuid(),
  registration_id: z.string().uuid(),
  access_code: z.string().trim().max(64).optional(),
});

export const redeemEventTicketFromPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => redeemSchema.parse(input))
  .handler(async ({ data, context }): Promise<PlanTicketRedeemResult> => {
    const { redeemPlanTicket } = await import("@/lib/billing/eventTicketPlanRedeem.server");
    return redeemPlanTicket(context.supabase, {
      userId: context.userId,
      eventId: data.event_id,
      ticketTypeId: data.ticket_type_id,
      registrationId: data.registration_id,
      accessCode: data.access_code,
    });
  });
