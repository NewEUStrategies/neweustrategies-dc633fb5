// Server functions diagnostyki webhooka maili autoryzacyjnych
// (/admin/newsletter/auth-logs). Cienki wrapper - logika w
// src/lib/email/auth-events.server.ts.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "@/integrations/supabase/require-staff";
import { fetchAuthEmailEvents, type AuthEmailEventsReport } from "@/lib/email/auth-events.server";

export type {
  AuthEmailEventsReport,
  AuthEmailEventRow,
  AuthEventStatus,
} from "@/lib/email/auth-events.server";

export const getAuthEmailEvents = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .validator((data: unknown) =>
    z
      .object({
        days: z.number().int().min(1).max(90).default(7),
        emailType: z.string().min(1).max(60).nullable().default(null),
        lang: z.enum(["pl", "en"]).nullable().default(null),
        status: z.enum(["enqueued", "rejected", "failed"]).nullable().default(null),
        fallbackOnly: z.boolean().default(false),
        search: z.string().max(160).nullable().default(null),
        page: z.number().int().min(1).max(500).default(1),
        pageSize: z.number().int().min(10).max(100).default(50),
      })
      .default({})
      .parse(data ?? {}),
  )
  .handler(async ({ data }): Promise<AuthEmailEventsReport> =>
    fetchAuthEmailEvents({
      days: data.days,
      emailType: data.emailType,
      lang: data.lang,
      status: data.status,
      fallbackOnly: data.fallbackOnly,
      search: data.search,
      page: data.page,
      pageSize: data.pageSize,
    }),
  );
