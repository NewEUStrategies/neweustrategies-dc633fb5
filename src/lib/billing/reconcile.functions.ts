// Cienki plik `createServerFn` - logika w `reconcile.server.ts`.
//
// Bezpieczeństwo: obie funkcje wymagają zalogowania (middleware) i roli
// `admin` (weryfikacja serwerowa `assertAdmin`). Klient nigdy nie przekazuje
// ładunku zdarzenia - wyłącznie identyfikatory, po których serwer sam pobiera
// dane ze Stripe.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ReconcileReport, RepairOutcome } from "@/lib/billing/reconcile.server";

const envSchema = z.enum(["sandbox", "live"]);

const reportSchema = z.object({
  environment: envSchema,
  sinceHours: z.number().int().min(1).max(720).default(72),
});

const repairSchema = z.object({
  environment: envSchema,
  kind: z.enum(["event", "order", "subscription"]),
  reference: z.string().trim().min(1).max(255),
});

/** Raport rozbieżności Stripe kontra baza (tylko odczyt). */
export const getReconcileReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => reportSchema.parse(input))
  .handler(async ({ data, context }): Promise<ReconcileReport> => {
    const { assertAdmin } = await import("@/lib/billing/diagnostics.server");
    await assertAdmin(context.supabase, context.userId);
    const { buildReconcileReport } = await import("@/lib/billing/reconcile.server");
    return buildReconcileReport(data.environment, data.sinceHours);
  });

/** Naprawa pojedynczej rozbieżności - idempotentna, tą samą ścieżką co webhook. */
export const repairReconcileEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => repairSchema.parse(input))
  .handler(async ({ data, context }): Promise<RepairOutcome> => {
    const { assertAdmin } = await import("@/lib/billing/diagnostics.server");
    await assertAdmin(context.supabase, context.userId);
    const { repairReconcileIssue } = await import("@/lib/billing/reconcile.server");
    return repairReconcileIssue(data.environment, data.kind, data.reference);
  });
