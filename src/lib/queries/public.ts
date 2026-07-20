// Public-content query options. Centralized so loaders + components share
// identical keys/fetchers (single source of truth for cache invalidation).
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SEO_FIELDS_SELECT } from "@/lib/seo/fields";
import type { PageTreeRow } from "@/lib/seo/pageTree";
import { fetchPageBreadcrumbs, type BreadcrumbRow } from "@/lib/breadcrumbs";
import { EMPTY_BODY, type BodyParts } from "@/lib/access/gating";
import type { ContentAccessRule } from "@/hooks/useContentAccess";
import type { LayoutOverrides, PostFormat } from "@/lib/postLayouts";
import { edgeTtlCache } from "@/lib/ssrCache";

// Non-sensitive columns of the access rule. Safe to ship to anonymous SSR so the
// paywall teaser renders server-side (good for SEO); the body itself stays gated
// behind get_entity_content.
const ACCESS_RULE_COLS =
  "id, entity_type, entity_id, mode, plan_ids, one_time_price_cents, one_time_currency, teaser_pl, teaser_en";

async function fetchAccessRule(
  entityType: "post" | "page",
  entityId: string,
): Promise<ContentAccessRule | null> {
  const { data } = await supabase
    .from("content_access_public")
    .select(ACCESS_RULE_COLS)
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .maybeSingle();
  return (data as ContentAccessRule | null) ?? null;
}

/**
 * Fetches the gated body (content_pl/en, builder_data, blocks_data) of a
 * post/page through the SECURITY DEFINER `get_entity_content` RPC. The server
 * returns the body only when the current caller satisfies `has_content_access`;
 * unentitled callers (including anonymous SSR) get an all-null body, so premium
 * content never reaches an unauthorized client. Single source of truth shared by
 * the SSR resolver and the client-side unlock hook.
 */
export async function fetchGatedBody(
  entityType: "post" | "page",
  entityId: string,
): Promise<BodyParts> {
  const { data, error } = await supabase.rpc("get_entity_content", {
    _entity_type: entityType,
    _entity_id: entityId,
  });
  if (error) throw error;
  const row = (data ?? [])[0];
  if (!row) return EMPTY_BODY;
  return {
    content_pl: row.content_pl,
    content_en: row.content_en,
    builder_data: row.builder_data,
    blocks_data: row.blocks_data,
  };
}

export interface BlogListItem {
  id: string;
  slug: string;
  title_pl: string;
  title_en: string;
  excerpt_pl: string | null;
  excerpt_en: string | null;
  cover_image_url: string | null;
  published_at: string | null;
  parent_page_id: string;
  href: string;
}

export interface PageData {
  id: string;
  slug: string;
  title_pl: string;
  title_en: string;
  content_pl: string | null;
  content_en: string | null;
  // Pages carry excerpts too - the pages editor writes them as the meta
  // description (SeoDescriptionField), so the public head() must receive them.
  excerpt_pl: string | null;
  excerpt_en: string | null;
  editor: "blocks" | "richtext" | "markdown" | "builder";
  blocks_data?: unknown;
  builder_data: unknown;
  cover_image_url: string | null;
  published_at: string | null;
  updated_at: string | null;
  template_type?: string | null;
  header_override?: string | null;
  // Per-entity SEO overrides (see @/lib/seo/fields).
  seo_title_pl: string | null;
  seo_title_en: string | null;
  seo_description_pl: string | null;
  seo_description_en: string | null;
  seo_canonical_url: string | null;
  seo_noindex: boolean;
  seo_og_image_url: string | null;
  og_image_generated_url: string | null;
  /** „Z tego materiału dowiesz się, że..." - dostępne również dla stron (max 7). */
  takeaways_pl: string[];
  takeaways_en: string[];
  /** Per-wpis nadpisanie wariantu wizualnego sekcji (`null` = użyj globalnego). */
  takeaways_variant: "card" | "heading" | "ghost" | null;
}

export interface PostData extends PageData {
  read_minutes: number | null;
  post_format: PostFormat;
  layout_overrides: LayoutOverrides | null;
  custom_meta: Record<string, string> | null;
  related_override: Record<string, unknown> | null;
  author_id: string | null;
  toc_override: Record<string, unknown> | null;
  audio_url_pl: string | null;
  audio_url_en: string | null;
}

interface AuthorProfileOverlay {
  avatar_url: string | null;
  job_title: string | null;
  company: string | null;
  bio_pl: string | null;
  bio_en: string | null;
  contact_email: string | null;
  website_url: string | null;
  x_url: string | null;
  linkedin_url: string | null;
  facebook_url: string | null;
  instagram_url: string | null;
  spotify_url: string | null;
  custom_socials: Array<{ label: string; url: string; iconUrl?: string }>;
}

interface PostAuthor {
  id: string;
  slug: string | null;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  /** Kanoniczne bio z profiles (author_profiles.bio_* to tylko legacy fallback). */
  bio_pl: string | null;
  bio_en: string | null;
  author_profile?: AuthorProfileOverlay | null;
}

export interface PostCategory {
  slug: string;
  name_pl: string;
  name_en: string;
  color: string | null;
}

export type ResolvedContent =
  | {
      kind: "post";
      item: PostData;
      crumbs: BreadcrumbRow[];
      parentPageId: string;
      tags: Array<{ slug: string; name: string }>;
      categories: PostCategory[];
      author: PostAuthor | null;
      access: ContentAccessRule | null;
    }
  | {
      kind: "page";
      item: PageData;
      crumbs: BreadcrumbRow[];
      parentPageId: string;
      access: ContentAccessRule | null;
    };

const PAGE_PATH_TTL = 10 * 60_000;

// Fetches the page used as the public homepage (`/`).
// Resolution order:
//   1. site_settings.reading.homepage_mode === "static_page" → page by
//      homepage_page_id or homepage_page_slug.
//   2. fallback: top-level page with slug = "home".
// Returns null if neither is found / published.
/**
 * Homepage mode from reading settings ("static_page" | "latest_posts" | unset).
 * The settings UI offers "latest posts" but the route never honoured it - this
 * lets index.tsx render the post list instead of always resolving a page.
 * Tiny, cached read; the full homepage query reads the same setting for the
 * static-page path.
 */
export const homepageModeQueryOptions = () =>
  queryOptions({
    queryKey: ["public", "home-mode"] as const,
    queryFn: async (): Promise<string> => {
      return edgeTtlCache("public:home-mode", 60_000, async () => {
        const { data } = await supabase
          .from("site_settings")
          .select("value")
          .eq("key", "reading")
          .maybeSingle();
        const reading = (data?.value ?? {}) as { homepage_mode?: string };
        return reading.homepage_mode ?? "";
      });
    },
    staleTime: PAGE_PATH_TTL,
  });

export const homePageQueryOptions = () =>
  queryOptions({
    queryKey: ["public", "home-page"] as const,
    queryFn: async (): Promise<PageData | null> => {
      return edgeTtlCache("public:home-page", 60_000, async () => {
        // 1. Read reading-settings to find the designated homepage.
        const { data: setting } = await supabase
          .from("site_settings")
          .select("value")
          .eq("key", "reading")
          .maybeSingle();
        const reading = (setting?.value ?? {}) as {
          homepage_mode?: string;
          homepage_page_id?: string;
          homepage_page_slug?: string;
        };

        // Non-gated display + SEO columns only; the body (content_*/builder_data)
        // is fetched via the gated get_entity_content RPC below, so the homepage
        // is never read through direct body-column selects. Excerpts + SEO
        // overrides are included so the homepage head() (src/routes/index.tsx)
        // resolves the static page's own SEO fields like any other page.
        const cols = `id, slug, title_pl, title_en, excerpt_pl, excerpt_en, editor, cover_image_url, published_at, updated_at, takeaways_pl, takeaways_en, takeaways_variant, ${SEO_FIELDS_SELECT}`;

        let row: Record<string, unknown> | null = null;
        if (reading.homepage_mode === "static_page") {
          if (reading.homepage_page_id) {
            const { data } = await supabase
              .from("pages")
              .select(cols)
              .eq("id", reading.homepage_page_id)
              .is("deleted_at", null)
              .eq("status", "published")
              .maybeSingle();
            if (data) row = data;
          }
          if (!row && reading.homepage_page_slug) {
            const { data } = await supabase
              .from("pages")
              .select(cols)
              .eq("slug", reading.homepage_page_slug)
              .is("parent_id", null)
              .is("deleted_at", null)
              .eq("status", "published")
              .maybeSingle();
            if (data) row = data;
          }
        }

        // 2. Fallback: conventional slug = "home".
        if (!row) {
          const { data, error } = await supabase
            .from("pages")
            .select(cols)
            .eq("slug", "home")
            .is("parent_id", null)
            .is("deleted_at", null)
            .eq("status", "published")
            .maybeSingle();
          if (error) throw error;
          row = data ?? null;
        }

        if (!row) return null;
        // Body via the gated RPC (public homepage → has_content_access = true).
        const body = await fetchGatedBody("page", row.id as string);
        return { ...row, ...body } as PageData;
      });
    },
    staleTime: PAGE_PATH_TTL,
  });

// "Load more" page size for the public blog list. The default limit equals one
// page, so SSR loaders (called without an argument) keep prefetching exactly
// the first, cheap page; bigger limits are requested client-side only.
export const BLOG_PAGE_SIZE = 50;

export const blogListQueryOptions = (limit: number = BLOG_PAGE_SIZE) =>
  queryOptions({
    queryKey: ["public", "blog", "list", { limit }] as const,
    queryFn: async (): Promise<{ posts: BlogListItem[] }> => {
      const { data, error } = await supabase
        .from("posts")
        .select(
          "id, slug, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url, published_at, parent_page_id",
        )
        .eq("status", "published")
        .is("deleted_at", null)
        .order("published_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      const rows = (data ?? []) as Array<Omit<BlogListItem, "href">>;
      // Posts always link via the dedicated `/post/$slug` route, which resolves
      // even when a parent path is missing. (A previous version fetched one
      // `page_full_path` RPC per parent page here and then never used the
      // result - removed: pure N+1 with no effect on the href.)
      const posts: BlogListItem[] = rows.map((r) => ({
        ...r,
        href: `/post/${r.slug}`,
      }));
      return { posts };
    },
    staleTime: 2 * 60_000,
  });

// Published, indexable pages for the public HTML site map (/sitemap). The
// noindex exclusion mirrors sitemap.xml: a URL hidden from crawlers must not
// be advertised by the visible site map either.
export const publicPagesTreeQueryOptions = () =>
  queryOptions({
    queryKey: ["public", "pages-tree"] as const,
    queryFn: async (): Promise<PageTreeRow[]> => {
      const { data, error } = await supabase
        .from("pages")
        .select("id, slug, title_pl, title_en, parent_id, menu_order")
        .eq("status", "published")
        .eq("seo_noindex", false)
        .is("deleted_at", null)
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60_000,
  });

// Public category list (site map + navigation surfaces).
export const publicCategoriesQueryOptions = () =>
  queryOptions({
    queryKey: ["public", "categories"] as const,
    queryFn: async (): Promise<Array<{ slug: string; name_pl: string; name_en: string }>> => {
      const { data, error } = await supabase
        .from("categories")
        .select("slug, name_pl, name_en")
        .order("name_pl");
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60_000,
  });

export const resolvedContentQueryOptions = (segments: string[]) =>
  queryOptions({
    queryKey: ["public", "resolved", segments] as const,
    queryFn: async (): Promise<ResolvedContent | null> => {
      if (segments.length === 0) return null;
      const { data: resolved, error: rErr } = await supabase.rpc("resolve_path", {
        _segments: segments,
      });
      if (rErr) throw rErr;
      const hit = (resolved ?? [])[0] as
        | { page_id: string | null; post_id: string | null }
        | undefined;
      if (!hit?.page_id) return null;

      if (hit.post_id) {
        // Body columns (content_*/builder_data/blocks_data) are fetched via the
        // gated RPC, never selected directly - the row select carries only the
        // non-sensitive display metadata. All four requests run in parallel so
        // gating adds no extra latency.
        const [{ data, error }, body, { data: tagRows }, { data: catRows }, crumbs, access] =
          await Promise.all([
            supabase
              .from("posts")
              .select(
                `id, slug, title_pl, title_en, excerpt_pl, excerpt_en, editor, cover_image_url, published_at, updated_at, read_minutes, post_format, layout_overrides, takeaways_pl, takeaways_en, takeaways_variant, toc_override, custom_meta, related_override, author_id, audio_url_pl, audio_url_en, ${SEO_FIELDS_SELECT}`,
              )
              .eq("id", hit.post_id)
              .maybeSingle(),
            fetchGatedBody("post", hit.post_id),
            supabase.from("post_tags").select("tags(slug, name)").eq("post_id", hit.post_id),
            supabase
              .from("post_categories")
              .select("categories(slug, name_pl, name_en, color)")
              .eq("post_id", hit.post_id),
            fetchPageBreadcrumbs(hit.page_id),
            fetchAccessRule("post", hit.post_id),
          ]);
        if (error) throw error;
        if (!data) return null;
        const tags = (tagRows ?? [])
          .map((r) => (r as { tags: { slug: string; name: string } | null }).tags)
          .filter((t): t is { slug: string; name: string } => !!t);
        const categories = (catRows ?? [])
          .map((r) => (r as { categories: PostCategory | null }).categories)
          .filter((c): c is PostCategory => !!c);
        const post = { ...data, ...body } as PostData;
        let author: PostAuthor | null = null;
        if (post.author_id) {
          const [{ data: authorRow }, { data: apRow }] = await Promise.all([
            supabase
              .from("profiles")
              .select("id, slug, display_name, first_name, last_name, avatar_url, bio_pl, bio_en")
              .eq("id", post.author_id)
              .maybeSingle(),
            supabase
              .from("author_profiles")
              .select(
                "avatar_url, job_title, company, bio_pl, bio_en, contact_email, website_url, x_url, linkedin_url, facebook_url, instagram_url, spotify_url, custom_socials",
              )
              .eq("user_id", post.author_id)
              .eq("is_public", true)
              .maybeSingle(),
          ]);
          if (authorRow) {
            const cs = Array.isArray(apRow?.custom_socials)
              ? (apRow!.custom_socials as unknown as Array<{
                  label: string;
                  url: string;
                  iconUrl?: string;
                }>)
              : [];
            author = {
              ...(authorRow as Omit<PostAuthor, "author_profile">),
              author_profile: apRow
                ? { ...(apRow as unknown as AuthorProfileOverlay), custom_socials: cs }
                : null,
            };
          }
        }
        return {
          kind: "post",
          item: post,
          crumbs,
          parentPageId: hit.page_id,
          tags,
          categories,
          author,
          access,
        };
      }

      const [{ data, error }, body, crumbs, access] = await Promise.all([
        supabase
          .from("pages")
          .select(
            `id, slug, title_pl, title_en, excerpt_pl, excerpt_en, editor, cover_image_url, published_at, updated_at, template_type, header_override, takeaways_pl, takeaways_en, takeaways_variant, ${SEO_FIELDS_SELECT}`,
          )
          .eq("id", hit.page_id)
          .maybeSingle(),
        fetchGatedBody("page", hit.page_id),
        fetchPageBreadcrumbs(hit.page_id),
        fetchAccessRule("page", hit.page_id),
      ]);
      if (error) throw error;
      if (!data) return null;
      return {
        kind: "page",
        item: { ...data, ...body } as PageData,
        crumbs,
        parentPageId: hit.page_id,
        access,
      };
    },
    staleTime: PAGE_PATH_TTL,
  });
