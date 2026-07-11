// Server functions: scoring-based recommendations + "Followed" feed.
// Scoring lives in ./recommendations.scoring (pure, unit-tested).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { scorePost, type ScoringSignals } from "./recommendations.scoring";

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
  author_id: string | null;
  score: number;
}

interface FollowsSplit {
  authors: Set<string>;
  categories: Set<string>;
  tags: Set<string>;
}

interface RawPost {
  id: string;
  slug: string;
  title_pl: string;
  title_en: string;
  excerpt_pl: string | null;
  excerpt_en: string | null;
  cover_image_url: string | null;
  published_at: string | null;
  parent_page_id: string;
  author_id: string | null;
}

const POSTS_COLS =
  "id, slug, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url, published_at, parent_page_id, author_id";

type SupabaseCtx = { supabase: import("@supabase/supabase-js").SupabaseClient; userId: string };

async function loadFollows(ctx: SupabaseCtx): Promise<FollowsSplit> {
  const { data } = await ctx.supabase
    .from("user_follows")
    .select("target_type, target_id")
    .eq("user_id", ctx.userId);
  const split: FollowsSplit = { authors: new Set(), categories: new Set(), tags: new Set() };
  for (const row of data ?? []) {
    if (row.target_type === "author") split.authors.add(row.target_id);
    else if (row.target_type === "category") split.categories.add(row.target_id);
    else if (row.target_type === "tag") split.tags.add(row.target_id);
  }
  return split;
}

async function loadPostTaxonomy(
  ctx: SupabaseCtx,
  postIds: string[],
): Promise<{ cats: Map<string, string[]>; tags: Map<string, string[]> }> {
  const cats = new Map<string, string[]>();
  const tags = new Map<string, string[]>();
  if (postIds.length === 0) return { cats, tags };
  const [{ data: pcRows }, { data: ptRows }] = await Promise.all([
    ctx.supabase.from("post_categories").select("post_id, category_id").in("post_id", postIds),
    ctx.supabase.from("post_tags").select("post_id, tag_id").in("post_id", postIds),
  ]);
  for (const r of pcRows ?? []) {
    const arr = cats.get(r.post_id) ?? [];
    arr.push(r.category_id);
    cats.set(r.post_id, arr);
  }
  for (const r of ptRows ?? []) {
    const arr = tags.get(r.post_id) ?? [];
    arr.push(r.tag_id);
    tags.set(r.post_id, arr);
  }
  return { cats, tags };
}

export const getRecommendedPosts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ limit: z.number().min(1).max(50).default(9) }).parse(input))
  .handler(async ({ data, context }): Promise<RecommendedPost[]> => {
    const ctx = { supabase: context.supabase, userId: context.userId };
    const follows = await loadFollows(ctx);

    const { data: history } = await ctx.supabase
      .from("user_read_history")
      .select("post_id, read_at")
      .order("read_at", { ascending: false })
      .limit(50);
    const readIds = new Set((history ?? []).map((r) => r.post_id));

    const historyCats = new Set<string>();
    const historyTags = new Set<string>();
    if (readIds.size > 0) {
      const { cats, tags } = await loadPostTaxonomy(ctx, Array.from(readIds));
      for (const arr of cats.values()) arr.forEach((c) => historyCats.add(c));
      for (const arr of tags.values()) arr.forEach((t) => historyTags.add(t));
    }

    let q = ctx.supabase
      .from("posts")
      .select(POSTS_COLS)
      .eq("status", "published")
      .is("deleted_at", null)
      .order("published_at", { ascending: false })
      .limit(100);
    if (readIds.size > 0) q = q.not("id", "in", `(${Array.from(readIds).join(",")})`);
    const { data: posts, error: pErr } = await q;
    if (pErr) throw pErr;
    const candidates = (posts ?? []) as RawPost[];
    if (candidates.length === 0) return [];

    const { cats: postCats, tags: postTags } = await loadPostTaxonomy(
      ctx,
      candidates.map((p) => p.id),
    );

    const signals: ScoringSignals = {
      followedAuthors: follows.authors,
      followedCategories: follows.categories,
      followedTags: follows.tags,
      historyCategories: historyCats,
      historyTags: historyTags,
    };

    const scored: RecommendedPost[] = candidates.map((p) => ({
      ...p,
      score: scorePost(
        {
          id: p.id,
          author_id: p.author_id,
          published_at: p.published_at,
          categoryIds: postCats.get(p.id) ?? [],
          tagIds: postTags.get(p.id) ?? [],
        },
        signals,
      ),
    }));

    scored.sort(
      (a, b) => b.score - a.score || (b.published_at ?? "").localeCompare(a.published_at ?? ""),
    );
    return scored.slice(0, data.limit);
  });

// Feed of posts from followed authors/categories/tags. Ordered by published_at DESC.
export const getFollowedFeed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ limit: z.number().min(1).max(50).default(18) }).parse(input),
  )
  .handler(async ({ data, context }): Promise<RecommendedPost[]> => {
    const ctx = { supabase: context.supabase, userId: context.userId };
    const follows = await loadFollows(ctx);
    if (follows.authors.size + follows.categories.size + follows.tags.size === 0) return [];

    // Collect candidate post IDs matching any followed axis.
    const candidateIds = new Set<string>();

    if (follows.authors.size > 0) {
      const { data: byAuthor } = await ctx.supabase
        .from("posts")
        .select("id")
        .eq("status", "published")
        .is("deleted_at", null)
        .in("author_id", Array.from(follows.authors))
        .order("published_at", { ascending: false })
        .limit(200);
      for (const r of byAuthor ?? []) candidateIds.add(r.id);
    }

    if (follows.categories.size > 0) {
      const { data: pc } = await ctx.supabase
        .from("post_categories")
        .select("post_id")
        .in("category_id", Array.from(follows.categories));
      for (const r of pc ?? []) candidateIds.add(r.post_id);
    }

    if (follows.tags.size > 0) {
      const { data: pt } = await ctx.supabase
        .from("post_tags")
        .select("post_id")
        .in("tag_id", Array.from(follows.tags));
      for (const r of pt ?? []) candidateIds.add(r.post_id);
    }

    if (candidateIds.size === 0) return [];

    const { data: posts, error } = await ctx.supabase
      .from("posts")
      .select(POSTS_COLS)
      .in("id", Array.from(candidateIds))
      .eq("status", "published")
      .is("deleted_at", null)
      .order("published_at", { ascending: false })
      .limit(data.limit);
    if (error) throw error;

    const rows = (posts ?? []) as RawPost[];
    const { cats: postCats, tags: postTags } = await loadPostTaxonomy(
      ctx,
      rows.map((p) => p.id),
    );
    const signals: ScoringSignals = {
      followedAuthors: follows.authors,
      followedCategories: follows.categories,
      followedTags: follows.tags,
      historyCategories: new Set(),
      historyTags: new Set(),
    };
    return rows.map((p) => ({
      ...p,
      score: scorePost(
        {
          id: p.id,
          author_id: p.author_id,
          published_at: p.published_at,
          categoryIds: postCats.get(p.id) ?? [],
          tagIds: postTags.get(p.id) ?? [],
        },
        signals,
      ),
    }));
  });
