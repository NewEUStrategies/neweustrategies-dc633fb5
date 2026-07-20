// Server function: read + aggregate Real User Monitoring (Core Web Vitals)
// samples for the admin analytics dashboard.
//
// The `web_vitals` table has RLS enabled with NO policies, so neither anon nor
// authenticated roles can read it directly - only the service role can. We
// therefore read via supabaseAdmin (service role) but gate the call behind an
// explicit admin-role check first, so RUM analytics stay admin-only even though
// the underlying client bypasses RLS.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolveUserTenantId } from "@/lib/server/userTenant.server";
import {
  aggregateVitals,
  trendsFromDailyP75,
  type DailyP75Row,
  type VitalSample,
  type VitalsReport,
} from "./aggregate";

// Bound the in-memory aggregation. The percentile math runs over the most recent
// rows in the window; if a busy site exceeds this within the window the report is
// computed over the newest SAMPLE_CAP rows (surfaced via `capped`), which keeps
// memory + transfer bounded while staying representative for a p75.
const SAMPLE_CAP = 20000;

export interface VitalsSummaryResult extends VitalsReport {
  /** Exact number of samples in the window (independent of the SAMPLE_CAP). */
  windowTotal: number;
  /** True when the window held more samples than SAMPLE_CAP (newest were used). */
  capped: boolean;
}

export const getVitalsSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        days: z.number().int().min(1).max(365).optional(),
        sinceIso: z.string().datetime().optional(),
        untilIso: z.string().datetime().optional(),
      })
      .parse(i ?? {}),
  )
  .handler(async ({ data, context }): Promise<VitalsSummaryResult> => {
    // Admin gate: has_role() filters user_roles by current_tenant_id(), so a
    // stale role row from another tenant can never authorize this tenant's RUM.
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Error("Forbidden: admin role required");

    // Resolve the analytical window. Custom range (sinceIso/untilIso) wins over
    // the `days` preset; falls back to 7d when nothing is supplied.
    const now = Date.now();
    const untilMs = data.untilIso ? Date.parse(data.untilIso) : now;
    const sinceMs = data.sinceIso ? Date.parse(data.sinceIso) : now - (data.days ?? 7) * 86_400_000;
    const since = new Date(sinceMs).toISOString();
    const until = new Date(untilMs).toISOString();
    const windowDays = Math.max(1, Math.ceil((untilMs - sinceMs) / 86_400_000));
    const hasCustomUntil = Boolean(data.untilIso);
    const empty: VitalsSummaryResult = {
      windowDays,
      total: 0,
      metrics: [],
      paths: [],
      trends: [],
      windowTotal: 0,
      capped: false,
    };

    // Degrade gracefully on any data-read failure (e.g. the web_vitals migration
    // hasn't been applied to this database yet): the dashboard shows "no data"
    // instead of returning a 500. Auth/admin failures above still throw.
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      // Scope every read to the caller's own tenant so one workspace's admin
      // never sees another workspace's RUM data / URL paths.
      const tenantId = await resolveUserTenantId(supabaseAdmin, context.userId);

      // `web_vitals` is created by a migration not yet reflected in the generated
      // Supabase types, so the table name/row shape are cast here (mirrors the
      // ingest route in src/routes/api/public/vitals.ts).
      // Accurate window size via a cheap COUNT(*) - the TRUE total even when the
      // aggregated sample set below is capped, so the dashboard never understates.
      const { count: windowCount, error: countErr } = await supabaseAdmin
        .from("web_vitals" as never)
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .gte("created_at", since)
        .lte("created_at", until);
      if (countErr) throw new Error(countErr.message);

      const { data: rows, error } = await supabaseAdmin
        .from("web_vitals" as never)
        .select("metric, value, rating, path, created_at")
        .eq("tenant_id", tenantId)
        .gte("created_at", since)
        .lte("created_at", until)
        .order("created_at", { ascending: false })
        .limit(SAMPLE_CAP);
      if (error) throw new Error(error.message);

      const samples = (rows ?? []) as unknown as VitalSample[];
      const report = aggregateVitals(samples, { windowDays });
      const windowTotal = windowCount ?? samples.length;

      // The in-memory trend above is computed over only the capped newest rows,
      // so on a busy site it truncates to the most recent days. Recompute the
      // per-day p75 trend in Postgres over the FULL window via an RPC. If the
      // function isn't present yet (older DB), fall back to the in-memory trend.
      // For custom ranges with an explicit `until` in the past we skip the RPC
      // (its signature only takes `p_since`) and rely on the in-memory trend.
      let trends = report.trends;
      if (!hasCustomUntil) {
        try {
          const { data: trendRows, error: trendErr } = await supabaseAdmin.rpc(
            "web_vitals_daily_p75" as never,
            { p_since: since, p_tenant: tenantId } as never,
          );
          if (!trendErr && Array.isArray(trendRows)) {
            trends = trendsFromDailyP75(trendRows as unknown as DailyP75Row[]);
          }
        } catch {
          // Keep the in-memory trend.
        }
      }

      return { ...report, trends, windowTotal, capped: windowTotal > SAMPLE_CAP };
    } catch (e) {
      console.warn(
        "[vitals] summary read failed; returning empty report:",
        e instanceof Error ? e.message : e,
      );
      return empty;
    }
  });
