// Archive + search queries. All run client-side against publicly readable
// tables. Each returns paginated post lists with hydrated `href`.
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { BlogListItem } from "@/lib/queries/public";
import type { SectionNode } from "@/lib/builder/types";
import { currentLang } from "@/lib/i18n/localeRuntime";

const TTL = 2 * 60_000;

// Page sizes for "load more" pagination. The first page equals the page size,
// so SSR loaders (which call the query options with the default limit) keep
// prefetching exactly one cheap page; bigger limits are client-side only.
export const ARCHIVE_PAGE_SIZE = 60;
export const SEARCH_PAGE_SIZE = 60;
// search_posts has `_limit` but no offset, so search paginates by growing the
// limit. Hard ceiling so a click-happy user cannot request unbounded result sets.
export const SEARCH_LIMIT_MAX = 300;

// ---------- helpers --------------------------------------------------------

async function hydrateHref(rows: Array<Omit<BlogListItem, "href">>): Promise<BlogListItem[]> {
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
  /** Weryfikacja zawodowa nadana przez admina (odznaka przy nazwisku). */
  verified_at: string | null;
}

// verified_at jest nowsze niż wygenerowane typy (migracja 20260713160000),
// stąd rzutowania wyników poniżej.
const PROFILE_COLS =
  "id, slug, display_name, avatar_url, cover_url, bio_pl, bio_en, twitter_url, linkedin_url, website_url, verified_at";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const authorBySlugQueryOptions = (slugOrId: string, limit: number = ARCHIVE_PAGE_SIZE) =>
  queryOptions({
    queryKey: ["public", "author", slugOrId, { limit }] as const,
    queryFn: async (): Promise<{ author: AuthorProfile; posts: BlogListItem[] } | null> => {
      // Try slug first, then fall back to id (uuid). Errors are THROWN (never
      // swallowed into a fake 404): a network/RLS failure must hit the route
      // error boundary, only a genuinely missing row resolves to null.
      const bySlug = await supabase
        .from("profiles")
        .select(PROFILE_COLS)
        .eq("slug", slugOrId)
        .maybeSingle();
      if (bySlug.error) throw bySlug.error;
      let prof = bySlug.data as AuthorProfile | null;
      if (!prof && UUID_RE.test(slugOrId)) {
        const byId = await supabase
          .from("profiles")
          .select(PROFILE_COLS)
          .eq("id", slugOrId)
          .maybeSingle();
        if (byId.error) throw byId.error;
        prof = byId.data as AuthorProfile | null;
      }
      if (!prof) return null;

      const { data: rows, error } = await supabase
        .from("posts")
        .select(POST_COLS)
        .eq("author_id", prof.id)
        .eq("status", "published")
        .is("deleted_at", null)
        .order("published_at", { ascending: false })
        .limit(limit);
      if (error) throw error;

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

export const taxonomyArchiveQueryOptions = (
  kind: TaxonomyKind,
  slug: string,
  limit: number = ARCHIVE_PAGE_SIZE,
) =>
  queryOptions({
    queryKey: ["public", "archive", kind, slug, { limit }] as const,
    queryFn: async (): Promise<{ taxonomy: TaxonomyMeta; posts: BlogListItem[] } | null> => {
      // Errors are thrown (route error boundary), never collapsed into a fake
      // "not found" - null is reserved for a genuinely missing taxonomy row.
      let taxRow: {
        id: string;
        slug: string;
        name_pl: string;
        name_en: string;
        description_pl: string | null;
        description_en: string | null;
        featured_template_id: string | null;
      } | null = null;
      let postIds: string[] = [];

      if (kind === "category") {
        const { data: tax, error: taxError } = await supabase
          .from("categories")
          .select(
            "id, slug, name_pl, name_en, description_pl, description_en, featured_template_id",
          )
          .eq("slug", slug)
          .maybeSingle();
        if (taxError) throw taxError;
        if (!tax) return null;
        taxRow = {
          id: tax.id as string,
          slug: tax.slug as string,
          name_pl: tax.name_pl as string,
          name_en: tax.name_en as string,
          description_pl: (tax.description_pl as string | null) ?? null,
          description_en: (tax.description_en as string | null) ?? null,
          featured_template_id: (tax.featured_template_id as string | null) ?? null,
        };
        const { data: pivot, error: pivotError } = await supabase
          .from("post_categories")
          .select("post_id")
          .eq("category_id", taxRow.id);
        if (pivotError) throw pivotError;
        postIds = (pivot ?? []).map((r) => r.post_id as string);
      } else {
        const { data: tax, error: taxError } = await supabase
          .from("tags")
          .select("id, slug, name, featured_template_id")
          .eq("slug", slug)
          .maybeSingle();
        if (taxError) throw taxError;
        if (!tax) return null;
        const name = tax.name as string;
        taxRow = {
          id: tax.id as string,
          slug: tax.slug as string,
          name_pl: name,
          name_en: name,
          description_pl: null,
          description_en: null,
          featured_template_id: (tax.featured_template_id as string | null) ?? null,
        };
        const { data: pivot, error: pivotError } = await supabase
          .from("post_tags")
          .select("post_id")
          .eq("tag_id", taxRow.id);
        if (pivotError) throw pivotError;
        postIds = (pivot ?? []).map((r) => r.post_id as string);
      }

      const featured_section = await fetchFeaturedSection(taxRow.featured_template_id);

      let posts: BlogListItem[] = [];
      if (postIds.length > 0) {
        const { data: rows, error: postsError } = await supabase
          .from("posts")
          .select(POST_COLS)
          .in("id", postIds)
          .eq("status", "published")
          .is("deleted_at", null)
          .order("published_at", { ascending: false })
          .limit(limit);
        if (postsError) throw postsError;
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

/** Wynik /search: pozycja listy + (opcjonalny) snippet trafienia z ts_headline
 *  (delimitery [[[ ]]] zamieniane na <mark> w komponencie SearchSnippet). */
export type SearchResultItem = BlogListItem & {
  headline_pl?: string | null;
  headline_en?: string | null;
};

export const searchQueryOptions = (filters: SearchFilters, limit: number = SEARCH_PAGE_SIZE) =>
  queryOptions({
    queryKey: ["public", "search", filters, { limit }] as const,
    enabled: filters.q.trim().length >= 2,
    queryFn: async (): Promise<{ posts: SearchResultItem[]; facets: SearchFacets }> => {
      // Postgres full-text search (ranked, unaccent + prefix matching, indexuje
      // też treść blocks_data/builder_data) zamiast ILIKE %q%. Author/data/
      // kategoria są filtrowane w RPC (pushdown kategorii naprawia audytowany
      // defekt: filtr po stronie klienta zwężał już przycięte okno wyników).
      // search_posts nie ma offsetu, więc "load more" rośnie przez _limit
      // (60 → 120 → ...), z twardym sufitem SEARCH_LIMIT_MAX.
      const { data: matchRows, error: matchError } = await supabase.rpc("search_posts", {
        _q: filters.q.trim(),
        _limit: Math.min(limit, SEARCH_LIMIT_MAX),
        _author: filters.authorId ?? undefined,
        _date_from: filters.dateFrom ?? undefined,
        _date_to: filters.dateTo ? `${filters.dateTo}T23:59:59Z` : undefined,
        _category: filters.categoryId ?? undefined,
      });
      if (matchError) throw matchError;
      const rows = (matchRows ?? []).map(
        ({ rank: _rank, ...row }): Omit<SearchResultItem, "href"> & { author_id: string | null } =>
          row,
      );

      const posts = (await hydrateHref(rows)) as SearchResultItem[];

      // Telemetria zapytań (fundament podpowiedzi/trendów) - fire-and-forget,
      // odporna na brak funkcji przed wdrożeniem migracji.
      void supabase
        .rpc("log_search_query", {
          _q: filters.q.trim(),
          _lang: currentLang(),
          _results: rows.length,
        })
        .then(
          () => undefined,
          () => undefined,
        );

      // Facets: liczone z przefiltrowanego zbioru (po pushdownie kategorii
      // aktywna kategoria zawęża facety; odznaczenie przywraca pełen zestaw).
      const facets = await computeFacets(
        rows.map((r) => r.id),
        rows,
      );
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
