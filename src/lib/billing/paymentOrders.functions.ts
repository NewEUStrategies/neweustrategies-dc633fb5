// Cienki wrapper serwerowy nad listą zamówień płatniczych dla panelu admina.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  loadPaymentOrders,
  type PaymentOrderRow,
  type PaymentOrdersSummary,
} from "@/lib/billing/paymentOrders.server";

export const listPaymentOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        status: z
          .enum(["all", "pending", "processing", "paid", "failed", "refunded", "canceled"])
          .optional(),
        limit: z.number().int().min(1).max(500).optional(),
      })
      .parse(input ?? {}),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{ rows: PaymentOrderRow[]; summary: PaymentOrdersSummary }> =>
      loadPaymentOrders(context.supabase, {
        status: data.status ?? "all",
        limit: data.limit ?? 100,
      }),
  );
