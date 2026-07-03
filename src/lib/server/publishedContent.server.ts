// Shared server-side reader for published content used by the crawler-facing
// surfaces (sitemap, RSS feeds, Google News sitemap, llms.txt). One
// implementation of the "post URL = parent page path + slug" rule and one
// 60-second edge cache, so every surface emits identical canonical URLs
// without re-querying Supabase per request.
//
// TENANT SCOPE: these readers use the service role, which bypasses RLS - so
// every query filters by the tenant that owns the request host (resolved via
// resolveTenantForHost). Without the explicit filter a second tenant's
// content would leak into another site's sitemap/RSS/llms.txt.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { edgeTtlCache } from "@/lib/ssrCache";

const CACHE_TTL_MS = 60_000;

/**
 * Crawler-facing surfaces must degrade, never 500: robots.txt, feeds and
 * sitemaps stay up (with defaults / empty lists) even when the DB read fails,
 * so a transient outage cannot poison a crawl.
 */
async function resilient<T>(label: string, fallback: T, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    console.warn(`[seo] ${label} read failed:`, e);
    return fallback;
  }
}

export interface PublishedPostRow {
  id: string;
  slug: string;
  parent_page_id: string;
  title_pl: string;
  title_en: string;
  excerpt_pl: string | null;
  excerpt_en: string | null;
  cover_image_url: string | null;
  published_at: string | null;
  updated_at: string | null;
  seo_noindex: boolean;
  /** Canonical path ("/sekcja/slug"), resolved via the parent page path. */
  path: string;
}

export interface PublishedCategoryRow {
  slug: string;
  name_pl: string;
  name_en: string;
  description_pl: string | null;
  description_en: string | null;
}

/** Full paths of all published pages of a tenant, keyed by page id. */
export async function fetchPagePaths(tenantId: string): Promise<Map<string, string>> {
  return edgeTtlCache(`seo:page-paths:${tenantId}`, CACHE_TTL_MS, () =>
    resilient("page-paths", new Map<string, string>(), async () => {
      const { data } = await supabaseAdmin
        .from("pages")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("status", "published")
        .is("deleted_at", null);
      const ids = (data ?? []).map((r) => r.id);
      const paths = new Map<string, string>();
      await Promise.all(
        ids.map(async (id) => {
          const { data: p } = await supabaseAdmin.rpc("page_full_path", { _page_id: id });
          if (typeof p === "string" && p) paths.set(id, p);
        }),
      );
      return paths;
    }),
  );
}

/**
 * Latest published, indexable posts of a tenant with resolved canonical paths
 * (newest first). Posts whose parent page is unpublished and posts marked
 * `seo_noindex` are excluded - a URL we ask crawlers not to index must not be
 * advertised in feeds or sitemaps either.
 */
export async function fetchPublishedPosts(
  tenantId: string,
  limit = 50,
): Promise<PublishedPostRow[]> {
  return edgeTtlCache(`seo:published-posts:${tenantId}:${limit}`, CACHE_TTL_MS, () =>
    resilient("published-posts", [], async () => {
      const [pagePaths, { data }] = await Promise.all([
        fetchPagePaths(tenantId),
        supabaseAdmin
          .from("posts")
          .select(
            "id, slug, parent_page_id, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url, published_at, updated_at, seo_noindex",
          )
          .eq("tenant_id", tenantId)
          .eq("status", "published")
          .is("deleted_at", null)
          .eq("seo_noindex", false)
          .order("published_at", { ascending: false })
          .limit(limit),
      ]);
      const rows: PublishedPostRow[] = [];
      for (const row of data ?? []) {
        const parentPath = pagePaths.get(row.parent_page_id);
        if (!parentPath) continue;
        rows.push({ ...row, path: `/${parentPath}/${row.slug}` });
      }
      return rows;
    }),
  );
}

/** Categories for the llms.txt section list (tenant-scoped). */
export async function fetchPublicCategories(tenantId: string): Promise<PublishedCategoryRow[]> {
  return edgeTtlCache(`seo:categories:${tenantId}`, CACHE_TTL_MS, () =>
    resilient("categories", [], async () => {
      const { data } = await supabaseAdmin
        .from("categories")
        .select("slug, name_pl, name_en, description_pl, description_en")
        .eq("tenant_id", tenantId)
        .order("name_pl");
      return data ?? [];
    }),
  );
}

/** Site-wide SEO settings read server-side (service role, no RLS surprises). */
export async function fetchSeoSettingsValue(tenantId: string): Promise<unknown> {
  return edgeTtlCache(`seo:settings:${tenantId}`, CACHE_TTL_MS, () =>
    resilient("settings", null, async () => {
      const { data } = await supabaseAdmin
        .from("site_settings")
        .select("value")
        .eq("tenant_id", tenantId)
        .eq("key", "seo")
        .maybeSingle();
      return data?.value ?? null;
    }),
  );
}
