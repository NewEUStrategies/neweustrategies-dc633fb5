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
  .validator((i: unknown) =>
    z
      .object({
        days: z.number().int().min(1).max(365).default(28),
      })
      .parse(i ?? {}),
  )
  .handler(async ({ data, context }): Promise<RelatedInsightsResult> => {
    // Admin gate (tenant-scoped przez has_role -> current_tenant_id()).
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Error("Forbidden: admin role required");

    try {
      // Najemca NIE jest parametrem: RPC bierze go z assert_admin_tenant()
      // (profil wołającego), więc podmiana uuid w żądaniu nic nie daje.
      const { data: rpcData, error } = await context.supabase.rpc("related_posts_signals", {
        _since_days: data.days,
      });
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
