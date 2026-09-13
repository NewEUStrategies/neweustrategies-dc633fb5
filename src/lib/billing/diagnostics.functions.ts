// Cienki wrapper serwerowy (tss-serverfn-split) nad diagnostyką płatności.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  assertAdmin,
  buildPaymentsDiagnostics,
  syncCouponDiscounts,
  type PaymentsDiagnostics,
} from "@/lib/billing/diagnostics.server";

export const getPaymentsDiagnostics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ environment: z.enum(["sandbox", "live"]) }).parse(input),
  )
  .handler(async ({ data, context }): Promise<PaymentsDiagnostics> => {
    // Najemca pochodzi Z BRAMKI, nie z hosta i nie z ładunku - diagnostyka
    // liczy kondycję dziennika webhooków WYŁĄCZNIE w obszarze wołającego.
    const { tenantId } = await assertAdmin(context.supabase, context.userId);
    return buildPaymentsDiagnostics(data.environment, tenantId);
  });

export const syncCouponsToProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ environment: z.enum(["sandbox", "live"]) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    return syncCouponDiscounts(data.environment);
  });
