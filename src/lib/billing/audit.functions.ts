// Cienki plik `createServerFn` - logika w `audit.server.ts`.
//
// Bezpieczeństwo: zalogowanie (middleware) plus serwerowa weryfikacja roli
// `admin`. Klient podaje wyłącznie zakres (środowisko, okno czasowe, opcjonalne
// wydarzenie) - nigdy identyfikatorów operatora ani ładunków.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { AuditExport, AuditReport } from "@/lib/billing/audit.server";

const querySchema = z.object({
  environment: z.enum(["sandbox", "live"]),
  sinceHours: z.number().int().min(1).max(8760).default(168),
  eventId: z.string().uuid().nullable().optional(),
});

const exportSchema = querySchema.extend({
  format: z.enum(["csv", "xlsx"]).default("csv"),
});

/** Materiał audytowy: zamówienia plus dziennik webhooków (tylko odczyt). */
export const getBillingAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => querySchema.parse(input))
  .handler(async ({ data, context }): Promise<AuditReport> => {
    const { assertAdmin } = await import("@/lib/billing/diagnostics.server");
    await assertAdmin(context.supabase, context.userId);
    const { buildAuditReport } = await import("@/lib/billing/audit.server");
    return buildAuditReport({
      environment: data.environment,
      sinceHours: data.sinceHours,
      eventId: data.eventId ?? null,
    });
  });

/** Eksport księgowy tego samego zakresu - CSV albo XLSX, zawsze z bazy. */
export const exportBillingAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => exportSchema.parse(input))
  .handler(async ({ data, context }): Promise<AuditExport> => {
    const { assertAdmin } = await import("@/lib/billing/diagnostics.server");
    await assertAdmin(context.supabase, context.userId);
    const { buildAuditReport, buildAuditExport } = await import("@/lib/billing/audit.server");
    const report = await buildAuditReport({
      environment: data.environment,
      sinceHours: data.sinceHours,
      eventId: data.eventId ?? null,
    });
    return buildAuditExport(report, data.format);
  });
