// Cienki wrapper serwerowy (tss-serverfn-split) nad PODGLĄDEM kasy wejściówki.
//
// TYLKO ODCZYT. Liczy dokładnie to, co policzy `createCheckoutOrder` - te same
// RPC, ta sama funkcja (`quoteEventTicketOrder`) - ale NIE zakłada zamówienia
// i NIGDY nie woła `redeem_b2b_coupon`: podgląd kodu nie może zjadać jego
// limitu. Uwierzytelnienie jak w kasie, bo wycena czyta pulę planu i zgłoszenie
// wołającego (`auth.uid()`).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { EventTicketQuote } from "@/lib/billing/eventTicketPricing.server";

const quoteSchema = z.object({
  event_id: z.string().uuid(),
  ticket_type_id: z.string().uuid(),
  registration_id: z.string().uuid().nullable().optional(),
  coupon_code: z.string().trim().max(64).optional(),
  access_code: z.string().trim().max(64).optional(),
});

export const quoteEventTicketCheckout = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => quoteSchema.parse(input))
  .handler(async ({ data, context }): Promise<EventTicketQuote> => {
    const { quoteEventTicketOrder } = await import("@/lib/billing/eventTicketPricing.server");
    return quoteEventTicketOrder(context.supabase, {
      eventId: data.event_id,
      ticketTypeId: data.ticket_type_id,
      registrationId: data.registration_id ?? null,
      accessCode: data.access_code,
      couponCode: data.coupon_code,
    });
  });
