// Przeniesienie trwających subskrypcji na cenę katalogu v6.2 - warstwa RPC dla
// panelu /admin/billing. Cienki wrapper: decyzje w `subscriptionRepricing.ts`,
// orkiestracja w `subscriptionRepricing.server.ts`, baza w
// `server/subscriptionRepricingStore.server.ts`.
//
// BRAMKA NAJEMCY, NIE PLATFORMY. Skutek dotyczy wyłącznie subskrypcji najemcy
// wołającego (filtr `tenant_id` w każdym zapytaniu), a cena docelowa musi
// zgadzać się z JEGO własnym `access_plans` - inaczej niż synchronizacja
// katalogu, która zmienia ceny całej instalacji. Dlatego `requireAdmin`
// (admin / super_admin najemcy, z wbudowanym step-upem MFA), a nie
// `requirePlatformAdmin`.
//
// NAJEMCA Z SESJI. `assertCallerTenantMatchesHost` bierze najemcę z profilu
// i sprawdza, że host mu nie przeczy. Schemat jest `.strict()`: `tenantId`
// w ładunku nie jest „ignorowany", tylko odrzucany walidacją - klient nie
// może nawet spróbować wskazać cudzego obszaru roboczego.
//
// PODGLĄD JEST DOMYŚLNY. Brak `mode` = `preview`, który niczego nie zapisuje.
// Wykonanie wymaga jawnego `mode: "execute"` ORAZ przepisanego literału
// `REPRICING_CONFIRM` - przypadkowe wywołanie (stary klient, ręczne żądanie)
// nie przenosi niczyjej subskrypcji. Nic nie dzieje się automatycznie przy
// deployu: ta funkcja jest jedyną drogą do mutacji.
//
// ŚRODOWISKO Z SERWERA. `resolveEnvironment` w produkcji daje zawsze `live`;
// `environmentGrantsAccess` odcina piaskownicę na produkcji, tak jak przy
// skutkach webhooka.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "@/integrations/supabase/require-staff";
import { REPRICING_CAMPAIGN, REPRICING_CONFIRM } from "@/lib/billing/subscriptionRepricing";

/** Domyślne partie: podgląd czyta (1 odczyt na sztukę), wykonanie mutuje (do 3). */
const PREVIEW_BATCH = 50;
const EXECUTE_BATCH = 20;

const runSchema = z
  .object({
    mode: z.enum(["preview", "execute"]).default("preview"),
    /** `subscriptions.id` ostatniego wiersza poprzedniej partii. */
    cursor: z.string().uuid().nullable().optional(),
    batchSize: z.number().int().min(1).max(50).optional(),
    /** Podpowiedź dla środowiska deweloperskiego - w produkcji zawsze `live`. */
    environment: z.enum(["sandbox", "live"]).optional(),
    confirm: z.string().max(64).optional(),
  })
  .strict();

export const runSubscriptionRepricing = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((input: unknown) => runSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    if (data.mode === "execute" && data.confirm !== REPRICING_CONFIRM) {
      return { ok: false as const, error: "confirmation_required" as const };
    }
    const { assertCallerTenantMatchesHost } = await import("@/lib/server/callerTenant.server");
    const tenantId = await assertCallerTenantMatchesHost(context.supabase, context.userId);
    const { resolveEnvironment, environmentGrantsAccess } = await import("@/lib/stripe.server");
    const environment = resolveEnvironment(data.environment);
    if (!environmentGrantsAccess(environment)) {
      return { ok: false as const, error: "environment_not_allowed" as const };
    }
    if (data.mode === "execute") {
      // Ślad w logu serwera: kto, w którym najemcy i na którym koncie wykonał partię.
      console.info("[billing] subscription repricing execute", {
        tenantId,
        environment,
        cursor: data.cursor ?? null,
        userId: context.userId,
      });
    }
    const { runRepricingPage } = await import("@/lib/billing/subscriptionRepricing.server");
    return runRepricingPage({
      tenantId,
      environment,
      mode: data.mode,
      cursor: data.cursor ?? null,
      batchSize: data.batchSize ?? (data.mode === "execute" ? EXECUTE_BATCH : PREVIEW_BATCH),
      actorUserId: context.userId,
    });
  });

const logSchema = z
  .object({
    status: z.enum(["applied", "skipped", "failed"]).nullable().optional(),
    limit: z.number().int().min(1).max(200).optional(),
  })
  .strict();

/** Dziennik przeniesień najemcy wołającego - najnowsze wpisy. */
export const listSubscriptionRepricingLog = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((input: unknown) => logSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { assertCallerTenantMatchesHost } = await import("@/lib/server/callerTenant.server");
    const tenantId = await assertCallerTenantMatchesHost(context.supabase, context.userId);
    const { listRepricingLog } = await import("@/lib/server/subscriptionRepricingStore.server");
    return listRepricingLog({
      tenantId,
      campaign: REPRICING_CAMPAIGN,
      status: data.status ?? null,
      limit: data.limit ?? 100,
    });
  });
