// Jednorazowe uzgodnienie dawnych anulowań za brak płatności - warstwa RPC dla
// panelu. Cienki wrapper: decyzje i zapisy żyją w
// `legacyNonPaymentReconcile.server.ts` (service_role + operator płatności).
//
// BRAMKA PLATFORMY, NIE NAJEMCY. Przebieg czyta subskrypcje WSZYSTKICH
// najemców środowiska i skraca ich uprawnienia - to operacja instalacji, jak
// przypomnienia rozliczeniowe i synchronizacja katalogu, więc stoi za
// `requirePlatformAdmin` (super_admin najemcy domyślnego + step-up MFA).
// Admin najemcy nie ma tu wstępu nawet w symulacji: raport niesie
// identyfikatory subskrypcji i najemców całej instalacji.
//
// SYMULACJA JEST DOMYŚLNA. Brak `mode` w ładunku znaczy `dry_run` - zapis
// wymaga jawnego `apply`, więc przypadkowe wywołanie (stary klient, ręczne
// żądanie bez pola) niczego nie zmienia.
//
// ŚRODOWISKO Z SERWERA. W produkcji `resolveEnvironment` zawsze daje `live`:
// klient nie wybiera konta operatora ani zbioru wierszy, na których zadanie
// pracuje. Najemca nie przychodzi w ładunku wcale - każdy wiersz jest
// przetwarzany w granicach własnego `tenant_id`.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requirePlatformAdmin } from "@/integrations/supabase/require-staff";

const inputSchema = z.object({
  environment: z.enum(["sandbox", "live"]).optional(),
  mode: z.enum(["dry_run", "apply"]).default("dry_run"),
  /** `subscriptions.id` ostatniego wiersza poprzedniej partii (UUID). */
  cursor: z.string().uuid().nullable().optional(),
  batchSize: z.number().int().min(1).max(100).optional(),
});

export const runLegacyNonPaymentReconcile = createServerFn({ method: "POST" })
  .middleware([requirePlatformAdmin])
  .validator((input: unknown) => inputSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { resolveEnvironment } = await import("@/lib/stripe.server");
    const { reconcileLegacyNonPaymentCancellations } =
      await import("@/lib/billing/legacyNonPaymentReconcile.server");
    const environment = resolveEnvironment(data.environment);
    if (data.mode === "apply") {
      // Ślad w logu serwera: kto i na którym koncie zastosował partię.
      console.info("[billing] legacy non-payment reconcile apply", {
        environment,
        cursor: data.cursor ?? null,
        userId: context.userId,
      });
    }
    return reconcileLegacyNonPaymentCancellations({
      environment,
      mode: data.mode,
      cursor: data.cursor ?? null,
      batchSize: data.batchSize,
    });
  });
