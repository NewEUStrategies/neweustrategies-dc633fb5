// Server function: sugestie linków wewnętrznych dla edytora SEO.
// Zwraca do N kandydatów z tenanta bieżącego użytkownika, dopasowanych po
// wspólnych kategoriach/tagach oraz FTS po tytule/leadzie. Wynik służy do
// szybkiego wstawiania linków między analizami (SEO/related-content).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({
  postId: z.string().uuid().nullable().optional(),
  titlePl: z.string().max(500).nullable().optional(),
  titleEn: z.string().max(500).nullable().optional(),
  contentPl: z.string().max(20000).nullable().optional(),
  contentEn: z.string().max(20000).nullable().optional(),
  categoryIds: z.array(z.string().uuid()).max(50).optional(),
  tagIds: z.array(z.string().uuid()).max(200).optional(),
  limit: z.number().int().min(1).max(20).default(8),
});

export interface LinkSuggestion {
  id: string;
  slug: string;
  title_pl: string | null;
  title_en: string | null;
  excerpt_pl: string | null;
  score: number;
  reasons: string[];
}

function tokens(...values: Array<string | null | undefined>): string[] {
  const out = new Set<string>();
  for (const raw of values) {
    if (!raw) continue;
    const stripped = raw.replace(/<[^>]+>/g, " ").toLowerCase();
    for (const t of stripped.split(/[^\p{L}\p{N}]+/u)) {
      if (t.length >= 4) out.add(t);
    }
  }
  return Array.from(out).slice(0, 12);
}

export const suggestInternalLinks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data, context }): Promise<LinkSuggestion[]> => {
    const { supabase, userId } = context;
    const { postId, titlePl, titleEn, contentPl, contentEn, categoryIds, tagIds, limit } = data;

    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", userId)
      .maybeSingle();
    const tenantId = profile?.tenant_id;
    if (!tenantId) return [];

    const searchTokens = tokens(titlePl, titleEn, contentPl?.slice(0, 4000), contentEn?.slice(0, 4000));

    const scores = new Map<string, { score: number; reasons: Set<string> }>();
    const bump = (id: string, s: number, reason: string) => {
      const cur = scores.get(id) ?? { score: 0, reasons: new Set<string>() };
      cur.score += s;
      cur.reasons.add(reason);
      scores.set(id, cur);
    };

    if (categoryIds?.length) {
      const { data: rows } = await supabase
        .from("post_categories")
        .select("post_id, category_id")
        .in("category_id", categoryIds);
      for (const r of rows ?? []) {
        if (r.post_id === postId) continue;
        bump(r.post_id, 4, "category");
      }
    }

    if (tagIds?.length) {
      const { data: rows } = await supabase
        .from("post_tags")
        .select("post_id, tag_id")
        .in("tag_id", tagIds);
      for (const r of rows ?? []) {
        if (r.post_id === postId) continue;
        bump(r.post_id, 3, "tag");
      }
    }

    if (searchTokens.length) {
      const pattern = searchTokens.join(" | ");
      const { data: rows } = await supabase
        .from("posts")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("status", "published")
        .textSearch("fts", pattern, { type: "websearch", config: "simple" })
        .limit(40);
      for (const r of rows ?? []) {
        if (r.id === postId) continue;
        bump(r.id, 2, "content");
      }
    }

    if (scores.size === 0) return [];

    const ids = Array.from(scores.keys());
    const { data: posts } = await supabase
      .from("posts")
      .select("id, slug, title_pl, title_en, excerpt_pl, status, tenant_id")
      .in("id", ids)
      .eq("tenant_id", tenantId)
      .eq("status", "published");

    const out: LinkSuggestion[] = (posts ?? []).map((p) => {
      const s = scores.get(p.id)!;
      return {
        id: p.id,
        slug: p.slug,
        title_pl: p.title_pl,
        title_en: p.title_en,
        excerpt_pl: p.excerpt_pl,
        score: s.score,
        reasons: Array.from(s.reasons),
      };
    });

    out.sort((a, b) => b.score - a.score);
    return out.slice(0, limit);
  });
