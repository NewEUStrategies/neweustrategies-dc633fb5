// Agregacja lustra pikseli reklamowych dla /admin/analytics -> „Piksele Ads".
// Odczyt pod `requireAdmin`; RLS `analytics_events_admin_read` zawęża do
// najemcy wywołującego (jak panel stopki).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "@/integrations/supabase/require-staff";
import { AD_PIXEL_EVENTS, aggregateAdPixelRows, type AdPixelRawRow, type AdPixelSummary } from "./adPixels";

const SAMPLE_CAP = 20_000;

const inputSchema = z.object({
  days: z.number().int().min(1).max(180).default(30),
});

export interface AdPixelsAnalyticsResult extends AdPixelSummary {
  capped: boolean;
}

export const getAdPixelsAnalytics = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((i: unknown) => inputSchema.parse(i ?? {}))
  .handler(async ({ data, context }): Promise<AdPixelsAnalyticsResult> => {
    const since = new Date(Date.now() - data.days * 86_400_000).toISOString();
    const { data: rows, error } = await context.supabase
      .from("analytics_events")
      .select("event_name, created_at, meta")
      .in("event_name", [...AD_PIXEL_EVENTS])
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(SAMPLE_CAP);
    if (error) throw new Error(error.message);
    const list = (rows ?? []) as AdPixelRawRow[];
    return { ...aggregateAdPixelRows(list, data.days), capped: list.length >= SAMPLE_CAP };
  });
