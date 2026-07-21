// Server function: odczyt + agregacja telemetrii błędów przeglądarki
// (client_errors) dla dashboardu w /admin/performance.
//
// Tabela client_errors ma RLS bez żadnych polityk (pisze wyłącznie ingest
// service role - patrz /api/public/client-errors), więc odczyt idzie przez
// supabaseAdmin za jawną bramką roli admina - dokładnie ten sam wzorzec co
// web_vitals w vitals.functions.ts. Service role omija RLS, dlatego KAŻDE
// zapytanie jest tu jawnie zawężone do tenanta wołającego.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolveUserTenantId } from "@/lib/server/userTenant.server";
import {
  aggregateClientErrors,
  type ClientErrorSample,
  type ClientErrorsReport,
} from "./clientErrorsAggregate";

// Ogranicznik agregacji w pamięci: raport liczony z najnowszych wierszy okna;
// prawdziwa wielkość okna wraca w windowTotal (COUNT), a `capped` mówi UI,
// że widzi czubek góry lodowej.
const SAMPLE_CAP = 5000;

export const getClientErrorsReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        sinceIso: z.string().datetime().optional(),
        untilIso: z.string().datetime().optional(),
        days: z.number().int().min(1).max(90).optional(),
      })
      .parse(i ?? {}),
  )
  .handler(async ({ data, context }): Promise<ClientErrorsReport> => {
    // Bramka admina: has_role() filtruje user_roles po current_tenant_id(),
    // więc rola z innego tenanta nigdy nie autoryzuje tego odczytu.
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Error("Forbidden: admin role required");

    const now = Date.now();
    const untilMs = data.untilIso ? Date.parse(data.untilIso) : now;
    const sinceMs = data.sinceIso ? Date.parse(data.sinceIso) : now - (data.days ?? 7) * 86_400_000;
    const since = new Date(sinceMs).toISOString();
    const until = new Date(untilMs).toISOString();
    const windowDays = Math.max(1, Math.ceil((untilMs - sinceMs) / 86_400_000));

    const empty: ClientErrorsReport = {
      windowDays,
      total: 0,
      windowTotal: 0,
      capped: false,
      uniqueGroups: 0,
      affectedPaths: 0,
      last24h: 0,
      daily: [],
      groups: [],
    };

    // Degradacja bez 500-ki, gdy migracja tabeli nie dotarła do tej bazy -
    // dashboard pokaże "brak danych" (błędy auth/roli wyżej nadal rzucają).
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const tenantId = await resolveUserTenantId(supabaseAdmin, context.userId);

      const { count: windowCount, error: countErr } = await supabaseAdmin
        .from("client_errors")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .gte("created_at", since)
        .lte("created_at", until);
      if (countErr) throw new Error(countErr.message);

      const { data: rows, error } = await supabaseAdmin
        .from("client_errors")
        .select("message, stack, source, path, created_at")
        .eq("tenant_id", tenantId)
        .gte("created_at", since)
        .lte("created_at", until)
        .order("created_at", { ascending: false })
        .limit(SAMPLE_CAP);
      if (error) throw new Error(error.message);

      const samples = (rows ?? []) as ClientErrorSample[];
      const windowTotal = windowCount ?? samples.length;
      return aggregateClientErrors(samples, {
        windowDays,
        windowTotal,
        capped: windowTotal > SAMPLE_CAP,
        nowMs: untilMs,
      });
    } catch (e) {
      console.warn(
        "[client-errors] report read failed; returning empty report:",
        e instanceof Error ? e.message : e,
      );
      return empty;
    }
  });
