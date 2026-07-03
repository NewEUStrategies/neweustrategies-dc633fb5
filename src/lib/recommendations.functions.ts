// Server function: scoring-based post recommendations for the current user.
// Algorithm:
//   +3 per followed category match
//   +2 per followed tag match
//   +1 per category/tag overlap with recently read posts (last 50)
//   recency bonus: +1 if published within 30 days
//   excludes posts already in user's read_history
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface RecommendedPost {
  id: string;
  slug: string;
  title_pl: string;
  title_en: string;
  excerpt_pl: string | null;
  excerpt_en: string | null;
  cover_image_url: string | null;
  published_at: string | null;
  parent_page_id: string;
  score: number;
}

export const getRecommendedPosts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ limit: z.number().min(1).max(50).default(9) }).parse(input))
  .handler(async ({ data, context }): Promise<RecommendedPost[]> => {
    const { supabase, userId } = context;

    // 1. Get followed categories & tags
    const { data: follows } = await supabase
      .from("user_follows")
      .select("target_type, target_id")
      .eq("user_id", userId);
    const followedCats = new Set(
      (follows ?? []).filter((f) => f.target_type === "category").map((f) => f.target_id),
    );
    const followedTags = new Set(
      (follows ?? []).filter((f) => f.target_type === "tag").map((f) => f.target_id),
    );

    // 2. Get read history (to exclude + derive interests)
    const { data: history } = await supabase
      .from("user_read_history")
      .select("post_id, read_at")
      .order("read_at", { ascending: false })
      .limit(50);
    const readIds = new Set((history ?? []).map((r) => r.post_id));

    // 3. Derive category/tag interests from history
    const historyInterestCats = new Set<string>();
    const historyInterestTags = new Set<string>();
    if (readIds.size > 0) {
      const ids = Array.from(readIds);
      const [{ data: hc }, { data: ht }] = await Promise.all([
        supabase.from("post_categories").select("category_id, post_id").in("post_id", ids),
        supabase.from("post_tags").select("tag_id, post_id").in("post_id", ids),
      ]);
      (hc ?? []).forEach((r) => historyInterestCats.add(r.category_id));
      (ht ?? []).forEach((r) => historyInterestTags.add(r.tag_id));
    }

    // 4. Fetch candidate posts (recent published, not already read)
    let q = supabase
      .from("posts")
      .select(
        "id, slug, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url, published_at, parent_page_id",
      )
      .eq("status", "published")
      .is("deleted_at", null)
      .order("published_at", { ascending: false })
      .limit(100);
    if (readIds.size > 0) q = q.not("id", "in", `(${Array.from(readIds).join(",")})`);
    const { data: posts, error: pErr } = await q;
    if (pErr) throw pErr;
    const candidates = posts ?? [];
    if (candidates.length === 0) return [];

    const candIds = candidates.map((p) => p.id);
    const [{ data: pcRows }, { data: ptRows }] = await Promise.all([
      supabase.from("post_categories").select("post_id, category_id").in("post_id", candIds),
      supabase.from("post_tags").select("post_id, tag_id").in("post_id", candIds),
    ]);
    const postCats = new Map<string, string[]>();
    (pcRows ?? []).forEach((r) => {
      const arr = postCats.get(r.post_id) ?? [];
      arr.push(r.category_id);
      postCats.set(r.post_id, arr);
    });
    const postTags = new Map<string, string[]>();
    (ptRows ?? []).forEach((r) => {
      const arr = postTags.get(r.post_id) ?? [];
      arr.push(r.tag_id);
      postTags.set(r.post_id, arr);
    });

    const now = Date.now();
    const scored: RecommendedPost[] = candidates.map((p) => {
      const cats = postCats.get(p.id) ?? [];
      const tags = postTags.get(p.id) ?? [];
      let score = 0;
      cats.forEach((c) => {
        if (followedCats.has(c)) score += 3;
        else if (historyInterestCats.has(c)) score += 1;
      });
      tags.forEach((t) => {
        if (followedTags.has(t)) score += 2;
        else if (historyInterestTags.has(t)) score += 1;
      });
      if (p.published_at) {
        const ageDays = (now - new Date(p.published_at).getTime()) / 86400000;
        if (ageDays < 30) score += 1;
      }
      return { ...p, score } as RecommendedPost;
    });

    scored.sort(
      (a, b) => b.score - a.score || (b.published_at ?? "").localeCompare(a.published_at ?? ""),
    );
    return scored.slice(0, data.limit);
  });
