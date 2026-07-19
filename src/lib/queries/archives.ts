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

// ---------- TAXONOMY (category / tag) --------------------------------------
// (Profil autora/eksperta przeniesiony do lib/experts/queries.ts - hub
//  agreguje materiały wielu typów, nie tylko wpisy.)

export type TaxonomyKind = "category" | "tag";
export type ArchiveSort = "newest" | "oldest" | "popular";

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

export interface TaxonomyArchiveParams {
  page?: number;
  pageSize?: number;
  sort?: ArchiveSort;
}

export interface TaxonomyArchiveResult {
  taxonomy: TaxonomyMeta;
  posts: BlogListItem[];
  total: number;
  page: number;
  pageSize: number;
  sort: ArchiveSort;
}

export const taxonomyArchiveQueryOptions = (
  kind: TaxonomyKind,
  slug: string,
  params: TaxonomyArchiveParams = {},
) => {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.max(1, Math.min(200, params.pageSize ?? ARCHIVE_PAGE_SIZE));
  const sort: ArchiveSort = params.sort ?? "newest";
  return queryOptions({
    queryKey: ["public", "archive", kind, slug, { page, pageSize, sort }] as const,
    queryFn: async (): Promise<TaxonomyArchiveResult | null> => {
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
      let total = 0;
      if (postIds.length > 0) {
        const from = (page - 1) * pageSize;
        const to = from + pageSize - 1;
        let q = supabase
          .from("posts")
          .select(POST_COLS, { count: "exact" })
          .in("id", postIds)
          .eq("status", "published")
          .is("deleted_at", null);
        if (sort === "oldest") q = q.order("published_at", { ascending: true });
        else if (sort === "popular")
          q = q
            .order("views_count", { ascending: false })
            .order("published_at", { ascending: false });
        else q = q.order("published_at", { ascending: false });
        const { data: rows, count, error: postsError } = await q.range(from, to);
        if (postsError) throw postsError;
        total = count ?? 0;
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
        total,
        page,
        pageSize,
        sort,
      };
    },
    staleTime: TTL,
  });
};

// ---------- SEARCH ---------------------------------------------------------

/** Kolejność wyników (mapuje się 1:1 na parametr _sort funkcji search_posts). */
export type SearchSort = "relevance" | "newest" | "popular";

/** Tryb dopasowania frazy (parametr _match RPC): wszystkie słowa / dowolne
 *  słowo / dokładna fraza. Składnia "fraza" i -wykluczenie działa w all/any. */
export type SearchMatchMode = "all" | "any" | "phrase";

/** Zakres dopasowania (parametr _in RPC): całość treści albo tylko tytuły. */
export type SearchScope = "all" | "title";

/** Wymiary fasetowe. Wymiary taksonomii = categories.kind; pozostałe są
 *  wyliczane z pól posta (autor / format / język / dostępność / rok). */
export type FacetDim =
  | "category" // specjalizacja (dotychczasowe kategorie treści)
  | "pub_type" // typ publikacji (analiza / raport / komentarz…)
  | "region" // region i państwo (hierarchia parent_id)
  | "topic" // temat
  | "project" // projekt
  | "series" // seria
  | "organization" // organizacja / instytucja (NATO, UE…)
  | "author"
  | "format"
  | "lang"
  | "access"
  | "year";

/** Wymiary taksonomii filtrowane przez tablicę id termów (`_terms`, AND). */
export const TAXONOMY_DIMS = [
  "category",
  "pub_type",
  "region",
  "topic",
  "project",
  "series",
  "organization",
] as const;

/** Podzbiór wymiarów opartych na kontrolowanej taksonomii (categories.kind). */
export type TaxonomyDim = (typeof TAXONOMY_DIMS)[number];

export interface SearchFilters {
  q: string;
  authorId?: string;
  dateFrom?: string; // YYYY-MM-DD
  dateTo?: string;
  /** Legacy pojedyncza kategoria (pushdown _category) - zachowana kompatybilnie. */
  categoryId?: string;
  /** Id termów kontrolowanej taksonomii (AND, z ekspansją hierarchii). */
  terms?: string[];
  /** post_format (standard / video / audio / gallery). */
  format?: string;
  /** Wariant językowy dostępny dla wpisu. */
  lang?: "pl" | "en";
  /** content_access.mode: public / members / paid. */
  access?: string;
  sort?: SearchSort;
  /** Tryb dopasowania (zaawansowane tryby wyszukiwania). */
  match?: SearchMatchMode;
  /** Zakres dopasowania: wszędzie / tylko tytuły. */
  scope?: SearchScope;
}

/** Pojedyncza wartość fasety z licznikiem (płaska lista; UI grupuje po `dim`). */
export interface FacetValue {
  dim: FacetDim;
  id: string | null;
  slug: string;
  label_pl: string;
  label_en: string;
  parentId: string | null;
  count: number;
}

/** Wynik /search: pozycja listy + (opcjonalny) snippet trafienia z ts_headline
 *  (delimitery [[[ ]]] zamieniane na <mark> w komponencie SearchSnippet). */
export type SearchResultItem = BlogListItem & {
  headline_pl?: string | null;
  headline_en?: string | null;
  post_format?: string | null;
  access_mode?: string | null;
};

export interface SearchResult {
  posts: SearchResultItem[];
  facets: FacetValue[];
  /** Dokładna liczność zbioru trafień (z okna total_count RPC). */
  total: number;
  /** true, gdy wyniki pochodzą z fallbacku trigramowego (tolerancja literówek). */
  fuzzy: boolean;
}

/** Stabilizuje tablicę termów pod klucz React Query (kolejność bez znaczenia). */
const sortedTerms = (terms?: string[]): string[] | undefined =>
  terms && terms.length > 0 ? [...terms].sort() : undefined;

/** Wyszukiwanie przeglądowe działa też bez frazy (>=2 znaki), o ile jest
 *  aktywny którykolwiek filtr - inaczej pokazalibyśmy całe archiwum od zera. */
function hasActiveFilter(f: SearchFilters): boolean {
  return (
    !!f.authorId ||
    !!f.dateFrom ||
    !!f.dateTo ||
    !!f.categoryId ||
    !!f.format ||
    !!f.lang ||
    !!f.access ||
    (f.terms?.length ?? 0) > 0
  );
}

export function searchEnabled(f: SearchFilters): boolean {
  return f.q.trim().length >= 2 || hasActiveFilter(f);
}

/** Wspólny zestaw argumentów RPC (search_posts i search_facets dzielą filtry).
 *  _match/_in wysyłamy tylko przy wartościach nie-domyślnych - starszy backend
 *  (przed migracją premium_search) nadal rozwiąże wywołanie po nazwach. */
function rpcFilterArgs(filters: SearchFilters) {
  const q = filters.q.trim();
  return {
    _q: q.length >= 2 ? q : undefined,
    _author: filters.authorId ?? undefined,
    _date_from: filters.dateFrom ?? undefined,
    _date_to: filters.dateTo ? `${filters.dateTo}T23:59:59Z` : undefined,
    _category: filters.categoryId ?? undefined,
    _terms: sortedTerms(filters.terms),
    _format: filters.format ?? undefined,
    _lang: filters.lang ?? undefined,
    _access: filters.access ?? undefined,
    _match: filters.match && filters.match !== "all" ? filters.match : undefined,
    _in: filters.scope && filters.scope !== "all" ? filters.scope : undefined,
  };
}

export const searchQueryOptions = (filters: SearchFilters, limit: number = SEARCH_PAGE_SIZE) =>
  queryOptions({
    queryKey: [
      "public",
      "search",
      { ...filters, terms: sortedTerms(filters.terms) },
      { limit },
    ] as const,
    enabled: searchEnabled(filters),
    queryFn: async (): Promise<SearchResult> => {
      // Postgres full-text search (ranked, unaccent + prefiks + polska fleksja,
      // indeksuje też treść blocks_data/builder_data). Wszystkie filtry są w
      // RPC (pushdown), a fasety liczy osobny RPC po PEŁNYM zbiorze trafień -
      // nie po przyciętym oknie. search_posts nie ma offsetu, więc "load more"
      // rośnie przez _limit (60 → 120 → …) z sufitem SEARCH_LIMIT_MAX.
      const args = rpcFilterArgs(filters);
      const [{ data: matchRows, error: matchError }, { data: facetRows, error: facetError }] =
        await Promise.all([
          supabase.rpc("search_posts", {
            ...args,
            _limit: Math.min(limit, SEARCH_LIMIT_MAX),
            _sort: filters.sort ?? "relevance",
          }),
          supabase.rpc("search_facets", args),
        ]);
      if (matchError) throw matchError;
      if (facetError) throw facetError;

      const raw = matchRows ?? [];
      const total = raw.length > 0 ? Number(raw[0].total_count ?? raw.length) : 0;
      const fuzzy = raw.length > 0 && !!raw[0].fuzzy;
      const rows = raw.map(
        ({
          rank: _rank,
          total_count: _tc,
          fuzzy: _fz,
          ...row
        }): Omit<SearchResultItem, "href"> & { author_id: string | null } => row,
      );

      const posts = (await hydrateHref(rows)) as SearchResultItem[];

      // Telemetria zapytań (fundament podpowiedzi/trendów) - fire-and-forget,
      // odporna na brak funkcji przed wdrożeniem migracji. Logujemy tylko realne
      // frazy, nie czyste przeglądanie po filtrach.
      const qTrim = filters.q.trim();
      if (qTrim.length >= 2) {
        void supabase
          .rpc("log_search_query", { _q: qTrim, _lang: currentLang(), _results: total })
          .then(
            () => undefined,
            () => undefined,
          );
      }

      const facets: FacetValue[] = (facetRows ?? []).map((r) => ({
        dim: r.dim as FacetDim,
        id: (r.id as string | null) ?? null,
        slug: r.slug as string,
        label_pl: (r.label_pl as string | null) ?? (r.slug as string),
        label_en: (r.label_en as string | null) ?? (r.slug as string),
        parentId: (r.parent_id as string | null) ?? null,
        count: Number(r.cnt ?? 0),
      }));

      return { posts, facets, total, fuzzy };
    },
    staleTime: 30_000,
  });

// ---------- AUTOSUGGEST ----------------------------------------------------

export interface AutosuggestItem {
  kind: "author" | "post" | FacetDim;
  id: string | null;
  slug: string | null;
  label_pl: string;
  label_en: string;
  parentPageId: string | null;
  score: number;
}

export const searchAutosuggestQueryOptions = (q: string, limit: number = 8) =>
  queryOptions({
    queryKey: ["public", "search-autosuggest", q.trim(), { limit }] as const,
    enabled: q.trim().length >= 2,
    staleTime: 30_000,
    queryFn: async (): Promise<AutosuggestItem[]> => {
      try {
        const { data } = await supabase.rpc("search_autosuggest", { _q: q.trim(), _limit: limit });
        return (data ?? []).map((r) => ({
          kind: r.kind as AutosuggestItem["kind"],
          id: (r.id as string | null) ?? null,
          slug: (r.slug as string | null) ?? null,
          label_pl: (r.label_pl as string | null) ?? "",
          label_en: (r.label_en as string | null) ?? "",
          parentPageId: (r.parent_page_id as string | null) ?? null,
          score: Number(r.score ?? 0),
        }));
      } catch {
        // Odporność przed wdrożeniem migracji: brak funkcji → brak podpowiedzi.
        return [];
      }
    },
  });

// ---------- OSOBY I ORGANIZACJE --------------------------------------------

/** Pozycja sekcji "Osoby i organizacje": autor/ekspert z publicznym dorobkiem
 *  albo term organizacji, z metadanymi do premium kart wyników. */
export interface PeopleOrgItem {
  kind: "person" | "organization";
  id: string;
  slug: string | null;
  label_pl: string;
  label_en: string;
  sublabel_pl: string | null;
  sublabel_en: string | null;
  avatarUrl: string | null;
  logoUrl: string | null;
  verified: boolean;
  postCount: number;
}

export const searchPeopleOrgsQueryOptions = (q: string, limit: number = 40) =>
  queryOptions({
    queryKey: ["public", "search-people-orgs", q.trim(), { limit }] as const,
    staleTime: 60_000,
    queryFn: async (): Promise<PeopleOrgItem[]> => {
      try {
        const { data } = await supabase.rpc("search_people_orgs", {
          _q: q.trim() || undefined,
          _limit: limit,
        });
        return (data ?? []).map((r) => ({
          kind: (r.kind as PeopleOrgItem["kind"]) ?? "person",
          id: r.id as string,
          slug: (r.slug as string | null) ?? null,
          label_pl: (r.label_pl as string | null) ?? "",
          label_en: (r.label_en as string | null) ?? "",
          sublabel_pl: (r.sublabel_pl as string | null) ?? null,
          sublabel_en: (r.sublabel_en as string | null) ?? null,
          avatarUrl: (r.avatar_url as string | null) ?? null,
          logoUrl: (r.logo_url as string | null) ?? null,
          verified: Boolean(r.verified),
          postCount: Number(r.post_count ?? 0),
        }));
      } catch {
        // Odporność przed wdrożeniem migracji: brak funkcji → pusta sekcja.
        return [];
      }
    },
  });
