// Cienki wrapper serwerowy (patrz tss-serverfn-split: żadnych pomocników obok
// deklaracji) nad odczytem zamówień biletowych dla panelu admina.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  loadTicketOrderHistory,
  loadTicketOrders,
  type TicketOrderHistoryEntry,
  type TicketOrderRow,
} from "@/lib/billing/ticketOrders.server";

export const listTicketOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ limit: z.number().int().min(1).max(500).optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<TicketOrderRow[]> =>
    loadTicketOrders(context.supabase, data.limit ?? 200),
  );

export const getTicketOrderHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ orderId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<TicketOrderHistoryEntry[]> =>
    loadTicketOrderHistory(context.supabase, data.orderId),
  );
