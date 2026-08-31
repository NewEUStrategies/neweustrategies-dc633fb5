// Cienka obudowa server fn rejestru monetyzacji. Logika w `ledger.server.ts`.
// Bramka: zalogowany (middleware) + rola `admin` (`assertAdmin`) - rejestr
// niesie kwoty i adresy darczyńców, więc sam `authenticated` nie wystarcza.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { MonetizationLedgerResult } from "@/lib/admin/monetization/ledger.server";

const ledgerSchema = z.object({
  environment: z.enum(["all", "live", "sandbox"]).default("all"),
  limit: z.number().int().min(1).max(200).default(50),
});

export const listMonetizationLedger = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ledgerSchema.parse(input))
  .handler(async ({ data, context }): Promise<MonetizationLedgerResult> => {
    const { assertAdmin } = await import("@/lib/billing/diagnostics.server");
    await assertAdmin(context.supabase, context.userId);
    const { loadMonetizationLedger } = await import("@/lib/admin/monetization/ledger.server");
    return loadMonetizationLedger({ environment: data.environment, limit: data.limit });
  });
