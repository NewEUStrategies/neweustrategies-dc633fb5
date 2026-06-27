// Server function: search published posts + pages by title (PL/EN) within
// the caller's tenant. Public-readable rows only; RLS handles enforcement.
// Returned shape is a small DTO consumable by the command palette.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type SearchHitKind = "post" | "page";

export interface SearchHit {
  kind: SearchHitKind;
  id: string;
  slug: string;
  title_pl: string;
  title_en: string;
  /** Public href ready for navigation. */
  href: string;
}

const InputSchema = z.object({
  q: z.string().trim().min(1).max(128),
  limit: z.number().int().min(1).max(50).optional(),
});

export const globalSearch = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data }): Promise<{ hits: SearchHit[] }> => {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return { hits: [] };
    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(url, key, { auth: { persistSession: false } });

    const limit = data.limit ?? 12;
    const pattern = `%${data.q.replace(/[%_]/g, (m) => `\\${m}`)}%`;

    const [postsRes, pagesRes] = await Promise.all([
      sb.from("posts")
        .select("id, slug, title_pl, title_en, status")
        .eq("status", "published")
        .or(`title_pl.ilike.${pattern},title_en.ilike.${pattern},slug.ilike.${pattern}`)
        .limit(limit),
      sb.from("pages")
        .select("id, slug, title_pl, title_en, status")
        .eq("status", "published")
        .or(`title_pl.ilike.${pattern},title_en.ilike.${pattern},slug.ilike.${pattern}`)
        .limit(limit),
    ]);

    const hits: SearchHit[] = [];
    for (const row of postsRes.data ?? []) {
      hits.push({
        kind: "post", id: row.id, slug: row.slug,
        title_pl: row.title_pl ?? "", title_en: row.title_en ?? "",
        href: `/post/${row.slug}`,
      });
    }
    for (const row of pagesRes.data ?? []) {
      hits.push({
        kind: "page", id: row.id, slug: row.slug,
        title_pl: row.title_pl ?? "", title_en: row.title_en ?? "",
        href: `/${row.slug}`,
      });
    }
    return { hits };
  });
