// Server functions raportu wysyłek maili systemowych (/admin/newsletter/system-emails).
// Cienki wrapper - cała logika w src/lib/email/system-log.server.ts.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "@/integrations/supabase/require-staff";
import { fetchSystemEmailReport, type SystemEmailReport } from "@/lib/email/system-log.server";
import { resolveUserTenantId } from "@/lib/server/userTenant.server";

export type {
  SystemEmailReport,
  SystemEmailRow,
  SystemEmailStatus,
  SystemEmailDayPoint,
} from "@/lib/email/system-log.server";

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
  .handler(async ({ data, context }): Promise<SystemEmailReport> => {
    // GRANICA NAJEMCY: `tenantId` pochodzi WYŁĄCZNIE z profilu wołającego, nigdy
    // z ładunku żądania. Warstwa danych czyta dziennik kluczem serwisowym, czyli
    // ponad RLS - bez tego filtru admin jednego najemcy widziałby pocztę
    // wszystkich. `resolveUserTenantId` rzuca, gdy profil nie ma najemcy
    // (fail closed), więc brak kontekstu nie zamienia się w brak zakresu.
    const tenantId = await resolveUserTenantId(context.supabase, context.userId);
    return fetchSystemEmailReport({
      tenantId,
      days: data.days,
      template: data.template,
      status: data.status,
      search: data.search,
      page: data.page,
      pageSize: data.pageSize,
    });
  });
