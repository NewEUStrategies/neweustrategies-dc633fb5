// Server function: read + aggregate Real User Monitoring (Core Web Vitals)
// samples for the admin analytics dashboard.
//
// The `web_vitals` table has RLS enabled with NO policies, so neither anon nor
// authenticated roles can read it directly - only the service role can. We
// therefore read via supabaseAdmin (service role) but gate the call behind an
// explicit admin-role check first, so RUM analytics stay admin-only even though
// the underlying client bypasses RLS.
//
// Awaria odczytu ODRZUCA wywołanie z przyczyną - zera wracają wyłącznie
// z udanego odczytu pustego okna (szczegóły przy bloku `try` niżej).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAnalyticsAdmin } from "@/lib/analytics/gateway.server";
import { resolveUserTenantId } from "@/lib/server/userTenant.server";
import {
  aggregateVitals,
  trendsFromDailyP75,
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
  .validator((i: unknown) =>
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
    // Wspólna bramka analityki (`gateway.server.ts`) - przed rozwiązaniem
    // najemcy i przed jakimkolwiek odczytem service role.
    await requireAnalyticsAdmin(context);

    // Resolve the analytical window. Custom range (sinceIso/untilIso) wins over
    // the `days` preset; falls back to 7d when nothing is supplied.
    const now = Date.now();
    const untilMs = data.untilIso ? Date.parse(data.untilIso) : now;
    const sinceMs = data.sinceIso ? Date.parse(data.sinceIso) : now - (data.days ?? 7) * 86_400_000;
    const since = new Date(sinceMs).toISOString();
    const until = new Date(untilMs).toISOString();
    const windowDays = Math.max(1, Math.ceil((untilMs - sinceMs) / 86_400_000));

    // AWARIA ODCZYTU LECI W GÓRĘ, NIE W PUSTY RAPORT. Do 2026-10 ten blok łapał
    // KAŻDY błąd - brak najemcy w profilu, timeout PostgREST, zerwane
    // połączenie, brak relacji - i oddawał `windowTotal: 0`. Pulpit RUM
    // rysował wtedy „Brak próbek RUM w wybranym oknie", a pasek na /admin
    // „Próbki RUM: 0", czyli twierdzenie o pomiarze, którego nie było. Karta
    // „Awaria odczytu" w VitalsBiDashboard była osiągalna wyłącznie przy
    // odmowie roli, bo tylko bramka stała poza tym blokiem. Uzasadnienie
    // „migracja web_vitals mogła jeszcze nie dotrzeć do bazy" przestało być
    // prawdą: tabela powstała w 20260626210000 i jest w wygenerowanych typach,
    // więc jej brak na produkcji to awaria wdrożenia, którą operator MA
    // zobaczyć. Kontrakt jak w relatedInsights.functions.ts (ta sama naprawa
    // tej samej klasy defektu): pusty raport wraca WYŁĄCZNIE z udanego odczytu
    // pustego okna, a każda awaria odrzuca wywołanie z przyczyną, więc
    // react-query ustawia `isError`.
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      // Scope every read to the caller's own tenant so one workspace's admin
      // never sees another workspace's RUM data / URL paths.
      const tenantId = await resolveUserTenantId(supabaseAdmin, context.userId);

      // Accurate window size via a cheap COUNT(*) - the TRUE total even when the
      // aggregated sample set below is capped, so the dashboard never understates.
      const { count: windowCount, error: countErr } = await supabaseAdmin
        .from("web_vitals")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .gte("created_at", since)
        .lte("created_at", until);
      if (countErr) throw new Error(countErr.message);

      const { data: rows, error } = await supabaseAdmin
        .from("web_vitals")
        .select("metric, value, rating, path, created_at")
        .eq("tenant_id", tenantId)
        .gte("created_at", since)
        .lte("created_at", until)
        .order("created_at", { ascending: false })
        .limit(SAMPLE_CAP);
      if (error) throw new Error(error.message);

      // BEZ `as unknown as`. Stało tu rzutowanie z komentarzem „tabela z migracji,
      // której nie ma jeszcze w wygenerowanych typach" - i to przestało być
      // prawdą: `web_vitals` JEST w `src/integrations/supabase/types.ts` razem
      // z kolumnami kontekstu nawigacji (20260920121000). Wybrane kolumny
      // pokrywają `VitalSample` co do jednej, więc zmiana typu `value` czy
      // `path` w bazie ma tu wywrócić kompilację, a nie przejść przez rzutowanie.
      const samples: VitalSample[] = rows ?? [];
      const report = aggregateVitals(samples, { windowDays });
      const windowTotal = windowCount ?? samples.length;

      // TREND Z BAZY PO PEŁNYM OKNIE [since, until]. Trend z pamięci liczy się
      // tylko z SAMPLE_CAP najnowszych próbek, więc na ruchliwym serwisie
      // najstarsze dni okna znikają, a pierwszy ocalały dzień powstaje
      // z niepełnej próbki. Do 2026-10-03 RPC było pomijane przy KAŻDYM
      // `untilIso`, bo funkcja znała wyłącznie `p_since` i dla okna
      // zamkniętego w przeszłości dokładałaby dni spoza zakresu - a pulpit
      // VitalsBiDashboard wysyła `untilIso` ZAWSZE, także dla presetów
      // (`buildPresetRange`), więc główny pulpit wydajności nigdy nie dostał
      // dokładnego trendu. Od migracji 20261003171000 `p_until` jest domknięte
      // jak `.lte` wyżej, więc trend, COUNT i próbka opisują JEDNO okno.
      // `until` to TERAZ, gdy wołający nie podał górnej granicy. Błąd albo
      // rzut RPC (baza sprzed migracji: PGRST202 dla trzech argumentów)
      // zostawia trend z pamięci - wykres gorszy, ale nie pusty.
      let trends = report.trends;
      try {
        const { data: trendRows, error: trendErr } = await supabaseAdmin.rpc(
          "web_vitals_daily_p75",
          { p_since: since, p_tenant: tenantId, p_until: until },
        );
        if (!trendErr && Array.isArray(trendRows)) {
          trends = trendsFromDailyP75(trendRows);
        }
      } catch {
        // Zostaje trend z pamięci.
      }

      return { ...report, trends, windowTotal, capped: windowTotal > SAMPLE_CAP };
    } catch (e) {
      // Ślad z nazwą modułu zostaje w logu workera. Start loguje odrzucenie
      // sam („Server Fn Error!"), ale bez nazwy funkcji, a „No tenant for
      // current user" rzuca wspólny userTenant.server.ts. Wyjątek idzie DALEJ
      // nietknięty: komunikat PostgREST jest dokładnie tą przyczyną, którą
      // karta awarii pokazuje operatorowi.
      console.warn("[vitals] summary read failed:", e instanceof Error ? e.message : e);
      throw e;
    }
  });
