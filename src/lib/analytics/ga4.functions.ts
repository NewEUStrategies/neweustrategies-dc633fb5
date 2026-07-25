/**
 * Server functions for Google Analytics 4 Data API + Measurement Protocol.
 *
 * Cztery obsługiwane tryby uwierzytelnienia (dowolny do wyboru):
 *
 * 1) Service Account
 *    - GA4_SERVICE_ACCOUNT_JSON (cała treść pliku)
 *    - GA4_PROPERTY_ID
 *
 * 2) OAuth 2.0 z refresh tokenem (Google Cloud "Desktop app" client)
 *    - GA4_OAUTH_CLIENT_ID
 *    - GA4_OAUTH_CLIENT_SECRET
 *    - GA4_OAUTH_REFRESH_TOKEN
 *    - GA4_PROPERTY_ID
 *
 * 3) Measurement Protocol (wysyłka eventów server-side)
 *    - GA4_MEASUREMENT_ID  (np. G-XXXXXXX)
 *    - GA4_API_SECRET      (Admin → Data Streams → Measurement Protocol API secrets)
 *
 * 4) Embed (Looker Studio / GA4 iframe) - patrz status.functions.ts (GA4_EMBED_URL).
 *
 * Priorytet dla raportów Data API: Service Account → OAuth refresh token.
 *
 * Uwierzytelnienie i surowe wywołanie Data API żyją w `./ga4.server.ts`, żeby
 * warstwa semantyczna (`./semantic/snapshot.functions.ts`) mogła zamówić te same
 * totale GA4 bez kopiowania logiki tokenów.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Ga4Report, Ga4Row } from "./ga4.server";
import type { AnalyticsGatewayCtx } from "./gateway.server";

// Kształt DTO raportu jest współdzielony z warstwą serwerową; re-eksport trzyma
// dotychczasowe importy (`Ga4BiDashboard`, `ga4Insights`) bez zmian.
export type { Ga4Report, Ga4Row };

// ---------- Report ----------

const reportInput = z.object({
  startDate: z.string().default("28daysAgo"),
  endDate: z.string().default("today"),
  metrics: z
    .array(z.string().min(1))
    .min(1)
    .default(["sessions", "activeUsers", "screenPageViews"]),
  dimensions: z.array(z.string().min(1)).max(3).default(["date"]),
  limit: z.number().int().min(1).max(1000).default(100),
});

export const runGa4Report = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => reportInput.parse(i ?? {}))
  .handler(async ({ data, context }): Promise<Ga4Report> => {
    const { requireAnalyticsAdmin, readStoredAnalyticsSettings } = await import("./gateway.server");
    const ctx = context as unknown as AnalyticsGatewayCtx;
    await requireAnalyticsAdmin(ctx);

    const stored = await readStoredAnalyticsSettings(ctx);
    const { EMPTY_GA4_REPORT, resolveGa4AccessToken, resolveGa4PropertyId, runGa4DataApiReport } =
      await import("./ga4.server");

    const propertyId = resolveGa4PropertyId(stored.ga4_property_id);
    if (stored.ga4_enabled === false) {
      return { ...EMPTY_GA4_REPORT, error: "GA4 wyłączone przez administratora" };
    }
    if (!propertyId) return EMPTY_GA4_REPORT;
    const auth = await resolveGa4AccessToken();
    if (!auth) return EMPTY_GA4_REPORT;

    return runGa4DataApiReport(
      {
        propertyId,
        startDate: data.startDate,
        endDate: data.endDate,
        dimensions: data.dimensions,
        metrics: data.metrics,
        limit: data.limit,
      },
      auth.token,
    );
  });

// ---------- Measurement Protocol ----------

const mpInput = z.object({
  clientId: z.string().min(1).default("admin-test"),
  eventName: z.string().min(1).max(40).default("admin_test_event"),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  debug: z.boolean().default(false),
});

export interface Ga4MpResult {
  ok: boolean;
  configured: boolean;
  debug?: string;
  error?: string;
}

/**
 * Wysyła event GA4 przez Measurement Protocol.
 * Wymaga sekretów: GA4_MEASUREMENT_ID + GA4_API_SECRET.
 * Przy debug=true używa endpointu /debug/mp/collect i zwraca walidację od Google.
 */
export const sendGa4Event = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => mpInput.parse(i ?? {}))
  .handler(async ({ data, context }): Promise<Ga4MpResult> => {
    const { requireAnalyticsAdmin, readStoredAnalyticsSettings } = await import("./gateway.server");
    const ctx = context as unknown as AnalyticsGatewayCtx;
    await requireAnalyticsAdmin(ctx);

    const stored = await readStoredAnalyticsSettings(ctx);
    const measurementId =
      process.env.GA4_MEASUREMENT_ID?.trim() || stored.ga4_measurement_id?.trim() || "";
    const apiSecret = process.env.GA4_API_SECRET;
    if (!measurementId || !apiSecret) {
      return {
        ok: false,
        configured: false,
        error: "Brak Measurement ID (ustawienia analityki) lub GA4_API_SECRET (sekret)",
      };
    }

    const path = data.debug ? "/debug/mp/collect" : "/mp/collect";
    const url = `https://www.google-analytics.com${path}?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: data.clientId,
          events: [{ name: data.eventName, params: data.params }],
        }),
      });
      if (data.debug) {
        const body = await res.text();
        return { ok: res.ok, configured: true, debug: body };
      }

      // Produkcyjny /mp/collect zawsze zwraca 204 przy sukcesie.
      if (!res.ok) {
        const t = await res.text();
        return { ok: false, configured: true, error: `MP ${res.status}: ${t.slice(0, 300)}` };
      }
      return { ok: true, configured: true };
    } catch (e) {
      return {
        ok: false,
        configured: true,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  });
