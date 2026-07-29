// Synchronizacja katalogu produktów i cen - warstwa RPC dla panelu.
// Cienki wrapper: logika żyje w modułach server-only.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "@/integrations/supabase/require-staff";

const inputSchema = z.object({
  environment: z.enum(["sandbox", "live"]).optional(),
});

export const syncPaymentCatalogNow = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((input: unknown) => inputSchema.parse(input ?? {}))
  .handler(async ({ data }) => {
    const { syncPaddleCatalog } = await import("@/lib/billing/paddleCatalogSync.server");
    const env = data.environment ?? "sandbox";
    const report = await syncPaddleCatalog(env);
    // Ręczna synchronizacja odświeża też odcisk integracji - inaczej
    // automat uznałby katalog za nieaktualny i powtórzył pracę.
    const { recordManualSync } = await import("@/lib/billing/catalogAutoSync.server");
    await recordManualSync(env, report);
    return report;
  });

/** Stan automatycznej synchronizacji (odcisk integracji, ostatni przebieg). */
export const getCatalogSyncState = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .validator((input: unknown) => inputSchema.parse(input ?? {}))
  .handler(async ({ data }) => {
    const { getIntegrationState } = await import("@/lib/billing/catalogAutoSync.server");
    return getIntegrationState(data.environment ?? "sandbox");
  });
