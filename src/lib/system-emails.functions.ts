// Server functions raportu wysyłek maili systemowych (/admin/newsletter/system-emails).
// Cienki wrapper - cała logika w src/lib/email/system-log.server.ts.
//
// Rozstrzygnięcie najemcy wywołującego należy DO WRAPPERA i to jest cała jego
// dodana wartość poza walidacją: warstwa danych czyta `email_send_log` klientem
// serwisowym (RLS dopuszcza tam wyłącznie service_role), więc granicę stawia
// wyłącznie filtr - a tenant jest własnością ŻĄDANIA, nie zapytania.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "@/integrations/supabase/require-staff";
import { fetchSystemEmailReport, type SystemEmailReport } from "@/lib/email/system-log.server";

export type {
  SystemEmailReport,
  SystemEmailRow,
  SystemEmailStatus,
  SystemEmailDayPoint,
} from "@/lib/email/system-log.server";

/**
 * Tenant wywołującego - jedyna dopuszczalna granica danych dla klienta
 * serwisowego. Helper jest lokalny, zgodnie z konwencją każdego `*.functions.ts`
 * w tym repo: `roleMiddleware` czyta `profiles.tenant_id`, ale kończy zwykłym
 * `next()` i nie publikuje tenanta do kontekstu handlera.
 */
async function callerTenant(context: {
  supabase: { from: (t: string) => never } | unknown;
  userId: string;
}): Promise<string> {
  const ctx = context as {
    supabase: {
      from: (table: "profiles") => {
        select: (cols: string) => {
          eq: (
            col: string,
            value: string,
          ) => { maybeSingle: () => Promise<{ data: { tenant_id: string | null } | null }> };
        };
      };
    };
    userId: string;
  };
  const { data } = await ctx.supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", ctx.userId)
    .maybeSingle();
  const tenantId = data?.tenant_id ?? null;
  if (!tenantId) throw new Error("Forbidden: missing tenant");
  return tenantId;
}

export const getSystemEmailReport = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .validator((data: unknown) =>
    z
      .object({
        days: z.number().int().min(1).max(90).default(7),
        template: z.string().min(1).max(120).nullable().default(null),
        status: z
          .enum(["pending", "sent", "dlq", "suppressed", "failed", "bounced", "complained"])
          .nullable()
          .default(null),
        search: z.string().max(160).nullable().default(null),
        page: z.number().int().min(1).max(500).default(1),
        pageSize: z.number().int().min(10).max(100).default(50),
      })
      .default({})
      .parse(data ?? {}),
  )
  .handler(async ({ data, context }): Promise<SystemEmailReport> =>
    fetchSystemEmailReport({
      tenantId: await callerTenant(context),
      days: data.days,
      template: data.template,
      status: data.status,
      search: data.search,
      page: data.page,
      pageSize: data.pageSize,
    }),
  );
