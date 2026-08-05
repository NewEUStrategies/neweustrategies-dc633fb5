// Cienki plik `createServerFn` - logika w `donationsAdmin.server.ts`.
// Obie funkcje wymagają zalogowania (middleware) i roli `admin` (`assertAdmin`).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { AdminDonationRow, DonationsSyncReport } from "@/lib/billing/donationsAdmin.server";

const listSchema = z.object({ limit: z.number().int().min(1).max(200).default(50) });

const syncSchema = z.object({
  environment: z.enum(["sandbox", "live"]),
  sinceHours: z.number().int().min(1).max(2160).default(168),
});

/** Rejestr wpłat dla panelu administracyjnego. */
export const listDonationRecords = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => listSchema.parse(input))
  .handler(async ({ data, context }): Promise<AdminDonationRow[]> => {
    const { assertAdmin } = await import("@/lib/billing/diagnostics.server");
    await assertAdmin(context.supabase, context.userId);
    const { listAdminDonations } = await import("@/lib/billing/donationsAdmin.server");
    return listAdminDonations(data.limit);
  });

/** Synchronizacja rejestru darowizn ze Stripe (idempotentna). */
export const syncDonationsWithStripe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => syncSchema.parse(input))
  .handler(async ({ data, context }): Promise<DonationsSyncReport> => {
    const { assertAdmin } = await import("@/lib/billing/diagnostics.server");
    await assertAdmin(context.supabase, context.userId);
    const { syncDonationsFromStripe } = await import("@/lib/billing/donationsAdmin.server");
    return syncDonationsFromStripe(data.environment, data.sinceHours);
  });
