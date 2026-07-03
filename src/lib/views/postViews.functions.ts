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
import { fetchWithTenantHost } from "@/integrations/supabase/tenant-host-fetch";
import { edgeTtlCache } from "@/lib/ssrCache";

// Anon client running UNDER RLS. fetchWithTenantHost forwards the request
// host, so public_tenant_id() (and with it trending_posts + the "Public reads
// published posts" policy) resolves the tenant of the site being browsed.
function client() {
  return createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
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

// Posts in one list overwhelmingly share a handful of parent pages, and
// page_full_path is one DB round-trip per call - resolving it per POST (the
// previous sequential loop) made the ticker cost 1+N round-trips and show up
// seconds after the rest of the header. Dedupe to unique parent ids and
// resolve them in parallel: worst case one extra round-trip of latency total.
async function resolveParentPaths(
  sb: ReturnType<typeof client>,
  parentPageIds: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const unique = Array.from(new Set(parentPageIds.filter((id): id is string => !!id)));
  const entries = await Promise.all(
    unique.map(async (id) => {
      const { data } = await sb.rpc("page_full_path", { _page_id: id });
      return [id, typeof data === "string" ? data : ""] as const;
    }),
  );
  return new Map(entries);
}

function postHref(
  paths: Map<string, string>,
  parentPageId: string | null | undefined,
  slug: string,
): string {
  const path = parentPageId ? paths.get(parentPageId) : "";
  return path ? `/${path}/${slug}` : `/post/${slug}`;
}

// Anonymous, tenant-wide lists: keep them warm per isolate so repeat SSR
// renders (and the client HTTP calls hitting this server fn) skip Supabase
// entirely inside the TTL window. edgeTtlCache scopes every entry by the
// request host, so tenants never share a warm entry.
const TICKER_TTL_MS = 60_000;

const trendingSchema = z.object({
  days: z.number().int().min(1).max(90).default(7),
  limit: z.number().int().min(1).max(50).default(10),
});

export const getTrendingPosts = createServerFn({ method: "GET" })
  .inputValidator((d) => trendingSchema.parse(d))
  .handler(
    async ({ data }): Promise<TrendingPost[]> =>
      edgeTtlCache(`trending_posts:${data.days}:${data.limit}`, TICKER_TTL_MS, async () => {
        const sb = client();
        const { data: rows, error } = await sb.rpc("trending_posts", {
          _days: data.days,
          _limit: data.limit,
        });
        if (error) {
          console.warn("trending_posts failed:", error.message);
          return [];
        }
        const paths = await resolveParentPaths(
          sb,
          (rows ?? []).map((r) => r.parent_page_id),
        );
        return (rows ?? []).map((r) => ({
          id: r.id,
          slug: r.slug,
          title_pl: r.title_pl,
          title_en: r.title_en,
          cover_image_url: r.cover_image_url,
          published_at: r.published_at,
          parent_page_id: r.parent_page_id,
          views_count: Number(r.views_count ?? 0),
          href: postHref(paths, r.parent_page_id, r.slug),
        }));
      }),
  );

// Latest / pinned posts for the header ticker. Reuses TrendingPost shape so
// the UI can swap sources without per-mode branching.
const tickerSchema = z.object({
  source: z.enum(["latest", "pinned"]),
  limit: z.number().int().min(1).max(50).default(8),
  pinnedPostId: z.string().uuid().optional(),
});

export const getTickerPosts = createServerFn({ method: "GET" })
  .inputValidator((d) => tickerSchema.parse(d))
  .handler(
    async ({ data }): Promise<TrendingPost[]> =>
      edgeTtlCache(
        `ticker_posts:${data.source}:${data.limit}:${data.pinnedPostId ?? ""}`,
        TICKER_TTL_MS,
        async () => {
          const sb = client();
          let q = sb
            .from("posts")
            .select("id,slug,title_pl,title_en,cover_image_url,published_at,parent_page_id")
            .eq("status", "published")
            .is("deleted_at", null);
          if (data.source === "pinned" && data.pinnedPostId) {
            q = q.eq("id", data.pinnedPostId).limit(1);
          } else {
            q = q.order("published_at", { ascending: false }).limit(data.limit);
          }
          const { data: rows, error } = await q;
          if (error) {
            console.warn("getTickerPosts failed:", error.message);
            return [];
          }
          const paths = await resolveParentPaths(
            sb,
            (rows ?? []).map((r) => r.parent_page_id),
          );
          return (rows ?? []).map((r) => ({
            id: r.id,
            slug: r.slug,
            title_pl: r.title_pl ?? "",
            title_en: r.title_en ?? "",
            cover_image_url: r.cover_image_url,
            published_at: r.published_at,
            parent_page_id: r.parent_page_id,
            views_count: 0,
            href: postHref(paths, r.parent_page_id, r.slug),
          }));
        },
      ),
  );
