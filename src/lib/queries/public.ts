// Public-content query options. Centralized so loaders + components share
// identical keys/fetchers (single source of truth for cache invalidation).
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchPageBreadcrumbs, type BreadcrumbRow } from "@/lib/breadcrumbs";
import type { LayoutOverrides, PostFormat } from "@/lib/postLayouts";

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
}

export interface PostData extends PageData {
  excerpt_pl: string | null;
  excerpt_en: string | null;
  read_minutes: number | null;
  post_format: PostFormat;
  layout_overrides: LayoutOverrides | null;
  takeaways_pl: string[];
  takeaways_en: string[];
}


export type ResolvedContent =
  | {
      kind: "post";
      item: PostData;
      crumbs: BreadcrumbRow[];
      parentPageId: string;
      tags: Array<{ slug: string; name: string }>;
    }
  | {
      kind: "page";
      item: PageData;
      crumbs: BreadcrumbRow[];
      parentPageId: string;
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
        const [{ data, error }, { data: tagRows }, crumbs] = await Promise.all([
          supabase
            .from("posts")
            .select(
              "id, slug, title_pl, title_en, excerpt_pl, excerpt_en, content_pl, content_en, editor, builder_data, blocks_data, cover_image_url, published_at, read_minutes, post_format, layout_overrides, takeaways_pl, takeaways_en",
            )
            .eq("id", hit.post_id)
            .maybeSingle(),
          supabase.from("post_tags").select("tags(slug, name)").eq("post_id", hit.post_id),
          fetchPageBreadcrumbs(hit.page_id),
        ]);
        if (error) throw error;
        if (!data) return null;
        const tags = (tagRows ?? [])
          .map((r) => (r as { tags: { slug: string; name: string } | null }).tags)
          .filter((t): t is { slug: string; name: string } => !!t);
        return {
          kind: "post",
          item: data as PostData,
          crumbs,
          parentPageId: hit.page_id,
          tags,
        };
      }

      const [{ data, error }, crumbs] = await Promise.all([
        supabase
          .from("pages")
          .select(
            "id, slug, title_pl, title_en, content_pl, content_en, editor, builder_data, cover_image_url, published_at",
          )
          .eq("id", hit.page_id)
          .maybeSingle(),
        fetchPageBreadcrumbs(hit.page_id),
      ]);
      if (error) throw error;
      if (!data) return null;
      return {
        kind: "page",
        item: data as PageData,
        crumbs,
        parentPageId: hit.page_id,
      };
    },
    staleTime: PAGE_PATH_TTL,
  });
