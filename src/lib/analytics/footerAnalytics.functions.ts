// Agregacja klikniec i konwersji w stopce dla panelu admin/analytics -> footer.
// Wykonywane pod requireAdmin (staff bypass RLS przez SDK service-role) - dane
// pochodza z public.analytics_events zbieranych przez /api/public/track. Zapytania
// zawezone do tenant_id wywolujacego oraz do zdarzen z prefiksem `footer_*`,
// zeby dashboard nie mieszal ich z innymi CTA.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "@/integrations/supabase/require-staff";

const inputSchema = z.object({
  days: z.number().int().min(1).max(180).default(30),
});

export interface FooterAnalyticsRow {
  href: string;
  label: string;
  group: string;
  event_name: string;
  clicks: number;
  last_at: string | null;
}

export interface FooterAnalyticsResult {
  totals: {
    total: number;
    link_clicks: number;
    legal_clicks: number;
    newsletter_clicks: number;
    newsletter_signups: number;
  };
  rows: FooterAnalyticsRow[];
  daily: Array<{ date: string; clicks: number; signups: number }>;
  windowDays: number;
}

const FOOTER_EVENTS = [
  "footer_link_click",
  "footer_legal_click",
  "footer_newsletter_click",
  "footer_newsletter_signup",
] as const;

interface RawEvent {
  event_name: string;
  meta: Record<string, unknown> | null;
  created_at: string;
  entity_id: string | null;
}

function metaString(meta: Record<string, unknown> | null, key: string): string {
  const v = meta?.[key];
  return typeof v === "string" ? v : "";
}

export const getFooterAnalytics = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((i: unknown) => inputSchema.parse(i ?? {}))
  .handler(async ({ data, context }): Promise<FooterAnalyticsResult> => {
    const since = new Date(Date.now() - data.days * 86_400_000).toISOString();
    const { data: rows, error } = await context.supabase
      .from("analytics_events")
      .select("event_name, meta, created_at, entity_id")
      .in("event_name", [...FOOTER_EVENTS])
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(10_000);

    if (error) throw new Error(error.message);

    const events = (rows ?? []) as RawEvent[];

    const totals = {
      total: events.length,
      link_clicks: 0,
      legal_clicks: 0,
      newsletter_clicks: 0,
      newsletter_signups: 0,
    };

    type Bucket = FooterAnalyticsRow;
    const bucketMap = new Map<string, Bucket>();
    const dailyMap = new Map<string, { clicks: number; signups: number }>();

    for (const e of events) {
      const name = e.event_name;
      if (name === "footer_link_click") totals.link_clicks += 1;
      else if (name === "footer_legal_click") totals.legal_clicks += 1;
      else if (name === "footer_newsletter_click") totals.newsletter_clicks += 1;
      else if (name === "footer_newsletter_signup") totals.newsletter_signups += 1;

      const meta = e.meta ?? null;
      const href = metaString(meta, "href") || e.entity_id || "-";
      const label = metaString(meta, "label") || href;
      const group = metaString(meta, "group") || "unknown";
      const key = `${name}::${href}`;
      const existing = bucketMap.get(key);
      if (existing) {
        existing.clicks += 1;
        if (!existing.last_at || existing.last_at < e.created_at) existing.last_at = e.created_at;
      } else {
        bucketMap.set(key, {
          event_name: name,
          href,
          label,
          group,
          clicks: 1,
          last_at: e.created_at,
        });
      }

      const day = e.created_at.slice(0, 10);
      const d = dailyMap.get(day) ?? { clicks: 0, signups: 0 };
      if (name === "footer_newsletter_signup") d.signups += 1;
      else d.clicks += 1;
      dailyMap.set(day, d);
    }

    const rowsOut = [...bucketMap.values()].sort((a, b) => b.clicks - a.clicks).slice(0, 100);
    const daily = [...dailyMap.entries()]
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));

    return { totals, rows: rowsOut, daily, windowDays: data.days };
  });
