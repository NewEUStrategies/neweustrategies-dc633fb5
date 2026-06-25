// Server functions: post view counter + Trending list.
//
// `recordPostView` - anti-spammed by viewer-hash + 5-min window inside the
//                    SECURITY DEFINER SQL function (`public.record_post_view`).
//                    No auth required: anonymous reads count too.
// `getTrendingPosts` - top published posts by view count in the last N days.
import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";

function client() {
  return createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
  );
}

const recordSchema = z.object({
  postId: z.string().uuid(),
  viewerHash: z.string().min(16).max(64),
});

export const recordPostView = createServerFn({ method: "POST" })
  .inputValidator((d) => recordSchema.parse(d))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const sb = client();
    const { error } = await sb.rpc("record_post_view", {
      _post_id: data.postId,
      _viewer_hash: data.viewerHash,
    });
    if (error) {
      // Surface the error in logs but never block the page render.
      console.warn("record_post_view failed:", error.message);
    }
    return { ok: true };
  });

export interface TrendingPost {
  id: string;
  slug: string;
  title_pl: string;
  title_en: string;
  cover_image_url: string | null;
  published_at: string | null;
  parent_page_id: string;
  views_count: number;
  href: string;
}

const trendingSchema = z.object({
  days: z.number().int().min(1).max(90).default(7),
  limit: z.number().int().min(1).max(50).default(10),
});

export const getTrendingPosts = createServerFn({ method: "GET" })
  .inputValidator((d) => trendingSchema.parse(d))
  .handler(async ({ data }): Promise<TrendingPost[]> => {
    const sb = client();
    const { data: rows, error } = await sb.rpc("trending_posts", {
      _days: data.days,
      _limit: data.limit,
    });
    if (error) {
      console.warn("trending_posts failed:", error.message);
      return [];
    }
    // Resolve canonical href via page_full_path for each post.
    const results: TrendingPost[] = [];
    for (const r of rows ?? []) {
      const { data: path } = await sb.rpc("page_full_path", { _page_id: r.parent_page_id });
      results.push({
        id: r.id,
        slug: r.slug,
        title_pl: r.title_pl,
        title_en: r.title_en,
        cover_image_url: r.cover_image_url,
        published_at: r.published_at,
        parent_page_id: r.parent_page_id,
        views_count: Number(r.views_count ?? 0),
        href: typeof path === "string" ? `/${path}/${r.slug}` : `/post/${r.slug}`,
      });
    }
    return results;
  });
