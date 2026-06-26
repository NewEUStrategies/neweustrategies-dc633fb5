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
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { aggregateVitals, type VitalSample, type VitalsReport } from "./aggregate";

// Bound the in-memory aggregation. The percentile math runs over the most recent
// rows in the window; if a busy site exceeds this within the window the report is
// computed over the newest SAMPLE_CAP rows (surfaced via `capped`), which keeps
// memory + transfer bounded while staying representative for a p75.
const SAMPLE_CAP = 20000;

export interface VitalsSummaryResult extends VitalsReport {
  /** True when the window held more samples than SAMPLE_CAP (newest were used). */
  capped: boolean;
}

export const getVitalsSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ days: z.number().int().min(1).max(90).default(7) }).parse(i ?? {}))
  .handler(async ({ data, context }): Promise<VitalsSummaryResult> => {
    // Admin gate: a user can read their own roles under RLS (see useAuth), so we
    // check the role with the user-scoped client before touching the service role.
    const { data: roles, error: roleErr } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (roleErr) throw new Error(roleErr.message);
    const isAdmin = (roles ?? []).some((r) => r.role === "admin");
    if (!isAdmin) throw new Error("Forbidden: admin role required");

    const since = new Date(Date.now() - data.days * 86_400_000).toISOString();
    // `web_vitals` is created by a migration not yet reflected in the generated
    // Supabase types, so the table name/row shape are cast here (mirrors the
    // ingest route in src/routes/api/public/vitals.ts).
    const { data: rows, error } = await supabaseAdmin
      .from("web_vitals" as never)
      .select("metric, value, rating, path")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(SAMPLE_CAP);
    if (error) throw new Error(error.message);

    const samples = (rows ?? []) as unknown as VitalSample[];
    const report = aggregateVitals(samples, { windowDays: data.days });
    return { ...report, capped: samples.length >= SAMPLE_CAP };
  });
