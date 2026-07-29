// Ręczne uruchomienie synchronizacji katalogu produktów i cen z panelu.
// Cienka warstwa RPC: logika żyje w `paddleCatalogSync.server` (server-only).
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
    return syncPaddleCatalog(data.environment ?? "sandbox");
  });
