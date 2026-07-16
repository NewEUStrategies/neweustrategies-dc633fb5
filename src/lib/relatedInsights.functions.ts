// Server function: analityka silnika rekomendacji per tenant.
// Woła RPC `related_posts_signals` (SECURITY DEFINER, admin-gated w SQL) i
// pakuje wynik w typowany DTO gotowy dla wykresów ECharts na
// /admin/related-posts (zakładka Analiza).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface TopCategory {
  category_id: string;
  name: string;
  posts_count: number;
}
export interface TopTag {
  tag_id: string;
  name: string;
  posts_count: number;
}
export interface CoTagPair {
  a: string;
  b: string;
  c: number;
}
export interface PopularityRow {
  post_id: string;
  title: string | null;
  views: number;
  uniques: number;
}
export interface ClickPair {
  source_post_id: string;
  target_post_id: string;
  source_title: string | null;
  target_title: string | null;
  clicks: number;
}
export interface HubTarget {
  post_id: string;
  title: string | null;
  clicks: number;
  sources: number;
}
export interface InsightsSummary {
  total_posts: number;
  total_views: number;
  total_clicks: number;
  total_reads: number;
  window_days: number;
}

export interface RelatedInsightsResult {
  summary: InsightsSummary;
  top_categories: TopCategory[];
  top_tags: TopTag[];
  tag_cooccurrence: CoTagPair[];
  popularity: PopularityRow[];
  click_pairs: ClickPair[];
  hub_targets: HubTarget[];
}

const EMPTY: RelatedInsightsResult = {
  summary: {
    total_posts: 0,
    total_views: 0,
    total_clicks: 0,
    total_reads: 0,
    window_days: 28,
  },
  top_categories: [],
  top_tags: [],
  tag_cooccurrence: [],
  popularity: [],
  click_pairs: [],
  hub_targets: [],
};

export const getRelatedInsights = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        days: z.number().int().min(1).max(365).default(28),
      })
      .parse(i ?? {}),
  )
  .handler(async ({ data, context }): Promise<RelatedInsightsResult> => {
    // Admin gate (druga warstwa - RPC też sprawdza, ale wolimy szybkie 403).
    const { data: roles, error: roleErr } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (roleErr) throw new Error(roleErr.message);
    const isAdmin = (roles ?? []).some((r) => r.role === "admin");
    if (!isAdmin) throw new Error("Forbidden: admin role required");

    // Tenant z helpera (spójne z całym modułem analytics).
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { resolveUserTenantId } = await import("@/lib/server/userTenant.server");
    const tenantId = await resolveUserTenantId(supabaseAdmin, context.userId);

    try {
      const { data: rpcData, error } = await context.supabase.rpc(
        "related_posts_signals" as never,
        { _tenant: tenantId, _since_days: data.days } as never,
      );
      if (error) throw new Error(error.message);
      if (!rpcData) return { ...EMPTY, summary: { ...EMPTY.summary, window_days: data.days } };
      // RPC zwraca jsonb - już parsowany przez PostgREST do JS-owego obiektu.
      const r = rpcData as unknown as Partial<RelatedInsightsResult>;
      return {
        summary: r.summary ?? { ...EMPTY.summary, window_days: data.days },
        top_categories: r.top_categories ?? [],
        top_tags: r.top_tags ?? [],
        tag_cooccurrence: r.tag_cooccurrence ?? [],
        popularity: r.popularity ?? [],
        click_pairs: r.click_pairs ?? [],
        hub_targets: r.hub_targets ?? [],
      };
    } catch (e) {
      console.warn(
        "[related-insights] read failed, returning empty:",
        e instanceof Error ? e.message : e,
      );
      return { ...EMPTY, summary: { ...EMPTY.summary, window_days: data.days } };
    }
  });
