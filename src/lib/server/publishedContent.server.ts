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
import { edgeTtlCache } from "@/lib/ssrCache";

const CACHE_TTL_MS = 60_000;

async function getSupabaseAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

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
async function fetchPagePaths(tenantId: string): Promise<Map<string, string>> {
  return edgeTtlCache(`seo:page-paths:${tenantId}`, CACHE_TTL_MS, () =>
    resilient("page-paths", new Map<string, string>(), async () => {
      const supabaseAdmin = await getSupabaseAdmin();
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
      const supabaseAdmin = await getSupabaseAdmin();
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
      const supabaseAdmin = await getSupabaseAdmin();
      const { data } = await supabaseAdmin
        .from("categories")
        .select("slug, name_pl, name_en, description_pl, description_en")
        .eq("tenant_id", tenantId)
        .order("name_pl");
      return data ?? [];
    }),
  );
}

export interface PublishedPodcastRow {
  slug: string;
  title_pl: string;
  title_en: string;
  excerpt_pl: string | null;
  excerpt_en: string | null;
  audio_url: string;
  duration_seconds: number;
  season: number | null;
  episode_number: number | null;
  cover_image_url: string | null;
  published_at: string | null;
  show_id: string | null;
}

const PODCAST_RSS_COLS =
  "slug, title_pl, title_en, excerpt_pl, excerpt_en, audio_url, duration_seconds, season, episode_number, cover_image_url, published_at, show_id";

/** Published podcast episodes for the network RSS feed (tenant-scoped). */
export async function fetchPublishedPodcasts(
  tenantId: string,
  limit = 50,
): Promise<PublishedPodcastRow[]> {
  return edgeTtlCache(`seo:podcasts:${tenantId}:${limit}`, CACHE_TTL_MS, () =>
    resilient("podcasts", [], async () => {
      const supabaseAdmin = await getSupabaseAdmin();
      const { data } = await supabaseAdmin
        .from("podcasts")
        .select(PODCAST_RSS_COLS)
        .eq("tenant_id", tenantId)
        .eq("status", "published")
        .is("deleted_at", null)
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(Math.max(1, Math.min(limit, 200)));
      return (data ?? []) as PublishedPodcastRow[];
    }),
  );
}

export interface PublishedShowRow {
  id: string;
  slug: string;
  title_pl: string;
  title_en: string;
  description_pl: string;
  description_en: string;
  cover_image_url: string | null;
}

/** A single published program by slug (per-program RSS feed). */
export async function fetchPublishedShowBySlug(
  tenantId: string,
  slug: string,
): Promise<PublishedShowRow | null> {
  return edgeTtlCache(`seo:podcast-show:${tenantId}:${slug}`, CACHE_TTL_MS, () =>
    resilient("podcast-show", null, async () => {
      const supabaseAdmin = await getSupabaseAdmin();
      const { data } = await supabaseAdmin
        .from("podcast_shows")
        .select("id, slug, title_pl, title_en, description_pl, description_en, cover_image_url")
        .eq("tenant_id", tenantId)
        .eq("slug", slug)
        .eq("status", "published")
        .is("deleted_at", null)
        .maybeSingle();
      return (data ?? null) as PublishedShowRow | null;
    }),
  );
}

/** Published episodes of one program, newest first (per-program RSS feed). */
export async function fetchPublishedPodcastsByShow(
  tenantId: string,
  showId: string,
  limit = 200,
): Promise<PublishedPodcastRow[]> {
  return edgeTtlCache(`seo:podcasts-by-show:${tenantId}:${showId}:${limit}`, CACHE_TTL_MS, () =>
    resilient("podcasts-by-show", [], async () => {
      const supabaseAdmin = await getSupabaseAdmin();
      const { data } = await supabaseAdmin
        .from("podcasts")
        .select(PODCAST_RSS_COLS)
        .eq("tenant_id", tenantId)
        .eq("show_id", showId)
        .eq("status", "published")
        .is("deleted_at", null)
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(Math.max(1, Math.min(limit, 500)));
      return (data ?? []) as PublishedPodcastRow[];
    }),
  );
}

/** Published programs of a tenant (sitemap enumerates their pages). */
export async function fetchPublishedShows(tenantId: string): Promise<PublishedShowRow[]> {
  return edgeTtlCache(`seo:podcast-shows:${tenantId}`, CACHE_TTL_MS, () =>
    resilient("podcast-shows", [], async () => {
      const supabaseAdmin = await getSupabaseAdmin();
      const { data } = await supabaseAdmin
        .from("podcast_shows")
        .select("id, slug, title_pl, title_en, description_pl, description_en, cover_image_url")
        .eq("tenant_id", tenantId)
        .eq("status", "published")
        .is("deleted_at", null)
        .order("sort_order", { ascending: true });
      return (data ?? []) as PublishedShowRow[];
    }),
  );
}

export interface PublishedWebStoryRow {
  slug: string;
  title_pl: string;
  title_en: string;
  description_pl: string;
  description_en: string;
  cover_url: string | null;
  pages: unknown;
  published_at: string | null;
  updated_at: string | null;
}

/** Pojedyncza opublikowana web story (wariant AMP renderuje ją server-side). */
export async function fetchPublishedWebStoryBySlug(
  tenantId: string,
  slug: string,
): Promise<PublishedWebStoryRow | null> {
  return edgeTtlCache(`seo:web-story:${tenantId}:${slug}`, CACHE_TTL_MS, () =>
    resilient("web-story", null, async () => {
      const supabaseAdmin = await getSupabaseAdmin();
      const { data } = await supabaseAdmin
        .from("web_stories")
        .select(
          "slug, title_pl, title_en, description_pl, description_en, cover_url, pages, published_at, updated_at",
        )
        .eq("tenant_id", tenantId)
        .eq("slug", slug)
        .eq("status", "published")
        .maybeSingle();
      return (data ?? null) as PublishedWebStoryRow | null;
    }),
  );
}

/**
 * Rozmiar + MIME plików z biblioteki mediów po public_url. Podcastowy RSS
 * wymaga `<enclosure length type>` - dla odcinków wgranych przez media
 * library mamy prawdziwe wartości; URL-e zewnętrzne pozostają bez dopasowania
 * (feed emituje wtedy length=0 + MIME z rozszerzenia, jak dotąd).
 */
export async function fetchMediaMetaByUrls(
  tenantId: string,
  urls: readonly string[],
): Promise<Map<string, { sizeBytes: number | null; mimeType: string | null }>> {
  const unique = Array.from(new Set(urls.filter((u) => !!u)));
  if (unique.length === 0) return new Map();
  return edgeTtlCache(
    `seo:media-meta:${tenantId}:${unique.slice().sort().join("|").slice(0, 512)}`,
    CACHE_TTL_MS,
    () =>
      resilient("media-meta", new Map(), async () => {
        const supabaseAdmin = await getSupabaseAdmin();
        const { data } = await supabaseAdmin
          .from("media")
          .select("public_url, size_bytes, mime_type")
          .eq("tenant_id", tenantId)
          .in("public_url", unique);
        const map = new Map<string, { sizeBytes: number | null; mimeType: string | null }>();
        for (const row of (data ?? []) as Array<{
          public_url: string;
          size_bytes: number | null;
          mime_type: string | null;
        }>) {
          map.set(row.public_url, { sizeBytes: row.size_bytes, mimeType: row.mime_type });
        }
        return map;
      }),
  );
}

/** Site-wide SEO settings read server-side (service role, no RLS surprises). */
export async function fetchSeoSettingsValue(tenantId: string): Promise<unknown> {
  return edgeTtlCache(`seo:settings:${tenantId}`, CACHE_TTL_MS, () =>
    resilient("settings", null, async () => {
      const supabaseAdmin = await getSupabaseAdmin();
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
