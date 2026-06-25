// Public-content query options. Centralized so loaders + components share
// identical keys/fetchers (single source of truth for cache invalidation).
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchPageBreadcrumbs, type BreadcrumbRow } from "@/lib/breadcrumbs";
import { EMPTY_BODY, type BodyParts } from "@/lib/access/gating";
import type { ContentAccessRule } from "@/hooks/useContentAccess";
import type { LayoutOverrides, PostFormat } from "@/lib/postLayouts";

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
    .from("content_access")
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
  editor: "blocks" | "richtext" | "markdown" | "builder";
  blocks_data?: unknown;
  builder_data: unknown;
  cover_image_url: string | null;
  published_at: string | null;
  updated_at: string | null;
  template_type?: string | null;
  header_override?: string | null;
}

export interface PostData extends PageData {
  excerpt_pl: string | null;
  excerpt_en: string | null;
  read_minutes: number | null;
  post_format: PostFormat;
  layout_overrides: LayoutOverrides | null;
  takeaways_pl: string[];
  takeaways_en: string[];
  custom_meta: Record<string, string> | null;
  related_override: Record<string, unknown> | null;
}


export type ResolvedContent =
  | {
      kind: "post";
      item: PostData;
      crumbs: BreadcrumbRow[];
      parentPageId: string;
      tags: Array<{ slug: string; name: string }>;
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
export const homePageQueryOptions = () =>
  queryOptions({
    queryKey: ["public", "home-page"] as const,
    queryFn: async (): Promise<PageData | null> => {
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

      const cols = "id, slug, title_pl, title_en, content_pl, content_en, editor, builder_data, cover_image_url, published_at";

      if (reading.homepage_mode === "static_page") {
        if (reading.homepage_page_id) {
          const { data } = await supabase
            .from("pages").select(cols)
            .eq("id", reading.homepage_page_id)
            .is("deleted_at", null)
            .eq("status", "published")
            .maybeSingle();
          if (data) return data as PageData;
        }
        if (reading.homepage_page_slug) {
          const { data } = await supabase
            .from("pages").select(cols)
            .eq("slug", reading.homepage_page_slug)
            .is("parent_id", null)
            .is("deleted_at", null)
            .eq("status", "published")
            .maybeSingle();
          if (data) return data as PageData;
        }
      }

      // 2. Fallback: conventional slug = "home".
      const { data, error } = await supabase
        .from("pages").select(cols)
        .eq("slug", "home")
        .is("parent_id", null)
        .is("deleted_at", null)
        .eq("status", "published")
        .maybeSingle();
      if (error) throw error;
      return (data as PageData | null) ?? null;
    },
    staleTime: PAGE_PATH_TTL,
  });


export const blogListQueryOptions = () =>
  queryOptions({
    queryKey: ["public", "blog", "list", { limit: 50 }] as const,
    queryFn: async (): Promise<{ posts: BlogListItem[] }> => {
      const { data, error } = await supabase
        .from("posts")
        .select(
          "id, slug, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url, published_at, parent_page_id",
        )
        .eq("status", "published")
        .is("deleted_at", null)
        .order("published_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      const rows = (data ?? []) as Array<Omit<BlogListItem, "href">>;
      const parentIds = Array.from(new Set(rows.map((r) => r.parent_page_id)));
      const paths = new Map<string, string>();
      await Promise.all(
        parentIds.map(async (pid) => {
          const { data: p } = await supabase.rpc("page_full_path", { _page_id: pid });
          if (typeof p === "string") paths.set(pid, p);
        }),
      );
      const posts: BlogListItem[] = rows.map((r) => ({
        ...r,
        href: `/${paths.get(r.parent_page_id) ?? "blog"}/${r.slug}`,
      }));
      return { posts };
    },
    staleTime: 2 * 60_000,
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
        const [{ data, error }, body, { data: tagRows }, crumbs, access] = await Promise.all([
          supabase
            .from("posts")
            .select(
              "id, slug, title_pl, title_en, excerpt_pl, excerpt_en, editor, cover_image_url, published_at, updated_at, read_minutes, post_format, layout_overrides, takeaways_pl, takeaways_en, custom_meta, related_override",
            )
            .eq("id", hit.post_id)
            .maybeSingle(),
          fetchGatedBody("post", hit.post_id),
          supabase.from("post_tags").select("tags(slug, name)").eq("post_id", hit.post_id),
          fetchPageBreadcrumbs(hit.page_id),
          fetchAccessRule("post", hit.post_id),
        ]);
        if (error) throw error;
        if (!data) return null;
        const tags = (tagRows ?? [])
          .map((r) => (r as { tags: { slug: string; name: string } | null }).tags)
          .filter((t): t is { slug: string; name: string } => !!t);
        return {
          kind: "post",
          item: { ...data, ...body } as PostData,
          crumbs,
          parentPageId: hit.page_id,
          tags,
          access,
        };
      }

      const [{ data, error }, body, crumbs, access] = await Promise.all([
        supabase
          .from("pages")
          .select(
            "id, slug, title_pl, title_en, editor, cover_image_url, published_at, updated_at, template_type, header_override",
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
