// Archive + search queries. All run client-side against publicly readable
// tables. Each returns paginated post lists with hydrated `href`.
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { BlogListItem } from "@/lib/queries/public";
import type { SectionNode } from "@/lib/builder/types";

const TTL = 2 * 60_000;

// ---------- helpers --------------------------------------------------------

async function hydrateHref(
  rows: Array<Omit<BlogListItem, "href">>,
): Promise<BlogListItem[]> {
  if (rows.length === 0) return [];
  const parentIds = Array.from(new Set(rows.map((r) => r.parent_page_id)));
  const paths = new Map<string, string>();
  await Promise.all(
    parentIds.map(async (pid) => {
      const { data } = await supabase.rpc("page_full_path", { _page_id: pid });
      if (typeof data === "string") paths.set(pid, data);
    }),
  );
  return rows.map((r) => ({
    ...r,
    href: `/${paths.get(r.parent_page_id) ?? "blog"}/${r.slug}`,
  }));
}

const POST_COLS =
  "id, slug, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url, published_at, parent_page_id, author_id";

// ---------- AUTHOR ---------------------------------------------------------

export interface AuthorProfile {
  id: string;
  slug: string | null;
  display_name: string | null;
  avatar_url: string | null;
  cover_url: string | null;
  bio_pl: string | null;
  bio_en: string | null;
  twitter_url: string | null;
  linkedin_url: string | null;
  website_url: string | null;
}

export const authorBySlugQueryOptions = (slugOrId: string) =>
  queryOptions({
    queryKey: ["public", "author", slugOrId] as const,
    queryFn: async (): Promise<{ author: AuthorProfile; posts: BlogListItem[] } | null> => {
      // Try slug first, then fall back to id (uuid).
      let { data: prof } = await supabase
        .from("profiles")
        .select(
          "id, slug, display_name, avatar_url, cover_url, bio_pl, bio_en, twitter_url, linkedin_url, website_url",
        )
        .eq("slug", slugOrId)
        .maybeSingle();
      if (!prof) {
        const fallback = await supabase
          .from("profiles")
          .select(
            "id, slug, display_name, avatar_url, cover_url, bio_pl, bio_en, twitter_url, linkedin_url, website_url",
          )
          .eq("id", slugOrId)
          .maybeSingle();
        prof = fallback.data;
      }
      if (!prof) return null;

      const { data: rows } = await supabase
        .from("posts")
        .select(POST_COLS)
        .eq("author_id", prof.id)
        .eq("status", "published")
        .is("deleted_at", null)
        .order("published_at", { ascending: false })
        .limit(60);

      const posts = await hydrateHref((rows ?? []) as Array<Omit<BlogListItem, "href">>);
      return { author: prof as AuthorProfile, posts };
    },
    staleTime: TTL,
  });

// ---------- TAXONOMY (category / tag) --------------------------------------

export type TaxonomyKind = "category" | "tag";

export interface TaxonomyMeta {
  id: string;
  slug: string;
  name_pl: string;
  name_en: string;
  description_pl: string | null;
  description_en: string | null;
  featured_template_id: string | null;
  featured_section: SectionNode | null;
}

async function fetchFeaturedSection(templateId: string | null): Promise<SectionNode | null> {
  if (!templateId) return null;
  const { data } = await supabase
    .from("builder_templates")
    .select("data")
    .eq("id", templateId)
    .maybeSingle();
  const d = data?.data as SectionNode | undefined;
  if (!d || typeof d !== "object" || d.kind !== "section") return null;
  return d;
}

export const taxonomyArchiveQueryOptions = (kind: TaxonomyKind, slug: string) =>
  queryOptions({
    queryKey: ["public", "archive", kind, slug] as const,
    queryFn: async (): Promise<{ taxonomy: TaxonomyMeta; posts: BlogListItem[] } | null> => {
      const table = kind === "category" ? "categories" : "tags";
      const joinTable = kind === "category" ? "post_categories" : "post_tags";
      const joinCol = kind === "category" ? "category_id" : "tag_id";

      const cols =
        kind === "category"
          ? "id, slug, name_pl, name_en, description_pl, description_en, featured_template_id"
          : "id, slug, name as name_pl, name as name_en, featured_template_id";

      const { data: tax } = await supabase.from(table).select(cols).eq("slug", slug).maybeSingle();
      if (!tax) return null;
      const taxRow = tax as {
        id: string;
        slug: string;
        name_pl: string;
        name_en: string;
        description_pl?: string | null;
        description_en?: string | null;
        featured_template_id: string | null;
      };

      const [{ data: pivot }, featured_section] = await Promise.all([
        supabase.from(joinTable).select("post_id").eq(joinCol, taxRow.id),
        fetchFeaturedSection(taxRow.featured_template_id),
      ]);
      const postIds = (pivot ?? []).map((r) => r.post_id as string);

      let posts: BlogListItem[] = [];
      if (postIds.length > 0) {
        const { data: rows } = await supabase
          .from("posts")
          .select(POST_COLS)
          .in("id", postIds)
          .eq("status", "published")
          .is("deleted_at", null)
          .order("published_at", { ascending: false })
          .limit(60);
        posts = await hydrateHref((rows ?? []) as Array<Omit<BlogListItem, "href">>);
      }

      return {
        taxonomy: {
          id: taxRow.id,
          slug: taxRow.slug,
          name_pl: taxRow.name_pl,
          name_en: taxRow.name_en,
          description_pl: taxRow.description_pl ?? null,
          description_en: taxRow.description_en ?? null,
          featured_template_id: taxRow.featured_template_id,
          featured_section,
        },
        posts,
      };
    },
    staleTime: TTL,
  });

// ---------- SEARCH ---------------------------------------------------------

export interface SearchFilters {
  q: string;
  categoryId?: string;
  authorId?: string;
  dateFrom?: string; // YYYY-MM-DD
  dateTo?: string;
}

export interface SearchFacets {
  categories: Array<{ id: string; slug: string; name: string; count: number }>;
  authors: Array<{ id: string; name: string; count: number }>;
}

export const searchQueryOptions = (filters: SearchFilters) =>
  queryOptions({
    queryKey: ["public", "search", filters] as const,
    enabled: filters.q.trim().length >= 2,
    queryFn: async (): Promise<{ posts: BlogListItem[]; facets: SearchFacets }> => {
      const q = filters.q.trim().replace(/[%_]/g, "\\$&");
      const term = `%${q}%`;
      let query = supabase
        .from("posts")
        .select(POST_COLS)
        .eq("status", "published")
        .is("deleted_at", null)
        .or(
          `title_pl.ilike.${term},title_en.ilike.${term},excerpt_pl.ilike.${term},excerpt_en.ilike.${term}`,
        )
        .order("published_at", { ascending: false })
        .limit(80);
      if (filters.authorId) query = query.eq("author_id", filters.authorId);
      if (filters.dateFrom) query = query.gte("published_at", filters.dateFrom);
      if (filters.dateTo) query = query.lte("published_at", `${filters.dateTo}T23:59:59Z`);

      const { data: matchRows } = await query;
      let rows = (matchRows ?? []) as Array<Omit<BlogListItem, "href"> & { author_id: string | null }>;

      // Category filter is post-join: filter ids via post_categories.
      if (filters.categoryId && rows.length > 0) {
        const ids = rows.map((r) => r.id);
        const { data: pc } = await supabase
          .from("post_categories")
          .select("post_id")
          .eq("category_id", filters.categoryId)
          .in("post_id", ids);
        const allow = new Set((pc ?? []).map((r) => r.post_id as string));
        rows = rows.filter((r) => allow.has(r.id));
      }

      const posts = await hydrateHref(rows);

      // Facets: derived from the (pre-category-filter) match set so users can
      // discover other matching categories.
      const facets = await computeFacets(rows.map((r) => r.id), rows);
      return { posts, facets };
    },
    staleTime: 30_000,
  });

async function computeFacets(
  postIds: string[],
  rows: Array<Omit<BlogListItem, "href"> & { author_id: string | null }>,
): Promise<SearchFacets> {
  if (postIds.length === 0) return { categories: [], authors: [] };
  const [{ data: pc }, { data: cats }, { data: profs }] = await Promise.all([
    supabase.from("post_categories").select("post_id, category_id").in("post_id", postIds),
    supabase.from("categories").select("id, slug, name_pl, name_en"),
    supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", Array.from(new Set(rows.map((r) => r.author_id).filter(Boolean) as string[]))),
  ]);

  // Category counts
  const catCount = new Map<string, number>();
  (pc ?? []).forEach((r) => {
    const id = r.category_id as string;
    catCount.set(id, (catCount.get(id) ?? 0) + 1);
  });
  const categories = (cats ?? [])
    .filter((c) => catCount.has(c.id as string))
    .map((c) => ({
      id: c.id as string,
      slug: c.slug as string,
      name: (c.name_pl as string) || (c.name_en as string) || (c.slug as string),
      count: catCount.get(c.id as string) ?? 0,
    }))
    .sort((a, b) => b.count - a.count);

  // Author counts
  const authorCount = new Map<string, number>();
  rows.forEach((r) => {
    if (r.author_id) authorCount.set(r.author_id, (authorCount.get(r.author_id) ?? 0) + 1);
  });
  const authors = (profs ?? [])
    .map((p) => ({
      id: p.id as string,
      name: (p.display_name as string | null) ?? "Autor",
      count: authorCount.get(p.id as string) ?? 0,
    }))
    .filter((a) => a.count > 0)
    .sort((a, b) => b.count - a.count);

  return { categories, authors };
}
