// Synchronizacja katalogu produktów i cen - warstwa RPC dla panelu.
// Cienki wrapper: logika żyje w modułach server-only.
//
// ZASÓB INSTALACJI, NIE NAJEMCY. Katalog operatora jest jeden dla wszystkich
// najemców (`lookup_key` nie niesie najemcy), więc przycisk „Synchronizuj
// katalog" przepisuje ceny KAŻDEMU obszarowi roboczemu. `requireAdmin` to rola
// per najemca - admin dowolnej organizacji odpalał synchronizację produkcyjną
// cennika całej instalacji. Bramką jest `requirePlatformAdmin` (super_admin
// najemcy domyślnego + step-up MFA), ta sama co przy singletonie
// `job_runner_settings`.
//
// ŚRODOWISKO ROZSTRZYGA SERWER. Wartość z ładunku jest tylko podpowiedzią dla
// środowiska deweloperskiego: `resolveEnvironment` w produkcji zawsze daje
// `live` (ta sama reguła co w kasie), więc klient nie wybiera konta operatora,
// na którym zmieniają się ceny, ani konta, dla którego zapisuje się odcisk.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requirePlatformAdmin } from "@/integrations/supabase/require-staff";

const inputSchema = z.object({
  environment: z.enum(["sandbox", "live"]).optional(),
});

export const syncPaymentCatalogNow = createServerFn({ method: "POST" })
  .middleware([requirePlatformAdmin])
  .validator((input: unknown) => inputSchema.parse(input ?? {}))
  .handler(async ({ data }) => {
    const { resolveEnvironment } = await import("@/lib/stripe.server");
    const { syncBillingCatalog } = await import("@/lib/billing/catalogSync.server");
    const env = resolveEnvironment(data.environment);
    const report = await syncBillingCatalog(env);
    // Ręczna synchronizacja odświeża też odcisk integracji - inaczej
    // automat uznałby katalog za nieaktualny i powtórzył pracę.
    const { recordManualSync } = await import("@/lib/billing/catalogAutoSync.server");
    await recordManualSync(env, report);
    return report;
  });

/** Stan automatycznej synchronizacji (odcisk integracji, ostatni przebieg). */
export const getCatalogSyncState = createServerFn({ method: "GET" })
  .middleware([requirePlatformAdmin])
  .validator((input: unknown) => inputSchema.parse(input ?? {}))
  .handler(async ({ data }) => {
    const { resolveEnvironment } = await import("@/lib/stripe.server");
    const { getIntegrationState } = await import("@/lib/billing/catalogAutoSync.server");
    return getIntegrationState(resolveEnvironment(data.environment));
  });
