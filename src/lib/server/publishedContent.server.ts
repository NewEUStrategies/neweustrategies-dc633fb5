import { readPublishedPagePaths } from "./publishedPagePaths.server";
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
import { createHash } from "node:crypto";

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
      const { paths } = await readPublishedPagePaths(supabaseAdmin, tenantId);
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
      const [pagePaths, { data, error: dataError }] = await Promise.all([
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
      if (dataError) throw dataError;
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
      const { data, error: dataError } = await supabaseAdmin
        .from("categories")
        .select("slug, name_pl, name_en, description_pl, description_en")
        .eq("tenant_id", tenantId)
        .order("name_pl");
      if (dataError) throw dataError;
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
  /** <itunes:explicit> na odcinku (Apple Podcasts Connect). */
  explicit: boolean;
  /** <itunes:episodeType>: full | trailer | bonus. */
  episode_type: string;
}

const PODCAST_RSS_COLS =
  "slug, title_pl, title_en, excerpt_pl, excerpt_en, audio_url, duration_seconds, season, episode_number, cover_image_url, published_at, show_id, explicit, episode_type";

/** Published podcast episodes for the network RSS feed (tenant-scoped). */
export async function fetchPublishedPodcasts(
  tenantId: string,
  limit = 50,
): Promise<PublishedPodcastRow[]> {
  return edgeTtlCache(`seo:podcasts:${tenantId}:${limit}`, CACHE_TTL_MS, () =>
    resilient("podcasts", [], async () => {
      const supabaseAdmin = await getSupabaseAdmin();
      const { data, error: dataError } = await supabaseAdmin
        .from("podcasts")
        .select(PODCAST_RSS_COLS)
        .eq("tenant_id", tenantId)
        .eq("status", "published")
        .is("deleted_at", null)
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(Math.max(1, Math.min(limit, 200)));
      if (dataError) throw dataError;
      // `as unknown as`: kolumny Apple (explicit / episode_type / itunes_*)
      // pochodzą z migracji 20260725090500 i nie ma ich jeszcze w wygenerowanych
      // typach - do usunięcia przy regeneracji types.ts.
      return (data ?? []) as unknown as PublishedPodcastRow[];
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
  /**
   * Nadpisania metadanych Apple per program - NULL oznacza dziedziczenie z
   * `podcast_settings` (kanal sieciowy). Patrz migracja 20260725090500.
   */
  itunes_author: string | null;
  itunes_owner_name: string | null;
  itunes_owner_email: string | null;
  itunes_category: string | null;
  itunes_subcategory: string | null;
  itunes_explicit: boolean | null;
  itunes_type: string | null;
  itunes_complete: boolean;
}

const SHOW_RSS_COLS =
  "id, slug, title_pl, title_en, description_pl, description_en, cover_image_url, " +
  "itunes_author, itunes_owner_name, itunes_owner_email, itunes_category, " +
  "itunes_subcategory, itunes_explicit, itunes_type, itunes_complete";

/** A single published program by slug (per-program RSS feed). */
export async function fetchPublishedShowBySlug(
  tenantId: string,
  slug: string,
): Promise<PublishedShowRow | null> {
  return edgeTtlCache(`seo:podcast-show:${tenantId}:${slug}`, CACHE_TTL_MS, () =>
    resilient("podcast-show", null, async () => {
      const supabaseAdmin = await getSupabaseAdmin();
      const { data, error: dataError } = await supabaseAdmin
        .from("podcast_shows")
        .select(SHOW_RSS_COLS)
        .eq("tenant_id", tenantId)
        .eq("slug", slug)
        .eq("status", "published")
        .is("deleted_at", null)
        .maybeSingle();
      if (dataError) throw dataError;
      // `as unknown as`: kolumny Apple (explicit / episode_type / itunes_*)
      // pochodzą z migracji 20260725090500 i nie ma ich jeszcze w wygenerowanych
      // typach - do usunięcia przy regeneracji types.ts.
      return (data ?? null) as unknown as PublishedShowRow | null;
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
      const { data, error: dataError } = await supabaseAdmin
        .from("podcasts")
        .select(PODCAST_RSS_COLS)
        .eq("tenant_id", tenantId)
        .eq("show_id", showId)
        .eq("status", "published")
        .is("deleted_at", null)
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(Math.max(1, Math.min(limit, 500)));
      if (dataError) throw dataError;
      // `as unknown as`: kolumny Apple (explicit / episode_type / itunes_*)
      // pochodzą z migracji 20260725090500 i nie ma ich jeszcze w wygenerowanych
      // typach - do usunięcia przy regeneracji types.ts.
      return (data ?? []) as unknown as PublishedPodcastRow[];
    }),
  );
}

/** Published programs of a tenant (sitemap enumerates their pages). */
export async function fetchPublishedShows(tenantId: string): Promise<PublishedShowRow[]> {
  return edgeTtlCache(`seo:podcast-shows:${tenantId}`, CACHE_TTL_MS, () =>
    resilient("podcast-shows", [], async () => {
      const supabaseAdmin = await getSupabaseAdmin();
      const { data, error: dataError } = await supabaseAdmin
        .from("podcast_shows")
        .select(SHOW_RSS_COLS)
        .eq("tenant_id", tenantId)
        .eq("status", "published")
        .is("deleted_at", null)
        .order("sort_order", { ascending: true });
      if (dataError) throw dataError;
      // `as unknown as`: kolumny Apple (explicit / episode_type / itunes_*)
      // pochodzą z migracji 20260725090500 i nie ma ich jeszcze w wygenerowanych
      // typach - do usunięcia przy regeneracji types.ts.
      return (data ?? []) as unknown as PublishedShowRow[];
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
      const { data, error: dataError } = await supabaseAdmin
        .from("web_stories")
        .select(
          "slug, title_pl, title_en, description_pl, description_en, cover_url, pages, published_at, updated_at",
        )
        .eq("tenant_id", tenantId)
        .eq("slug", slug)
        .eq("status", "published")
        .maybeSingle();
      if (dataError) throw dataError;
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
  const digest = createHash("sha256").update(JSON.stringify(unique.slice().sort())).digest("hex");
  return edgeTtlCache(`seo:media-meta:${tenantId}:${digest}`, CACHE_TTL_MS, () =>
    resilient("media-meta", new Map(), async () => {
      const supabaseAdmin = await getSupabaseAdmin();
      const { data, error: dataError } = await supabaseAdmin
        .from("media")
        .select("public_url, size_bytes, mime_type")
        .eq("tenant_id", tenantId)
        .in("public_url", unique);
      if (dataError) throw dataError;
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

/**
 * Metadane kanału podcastowego wymagane przez Apple Podcasts Connect
 * (singleton per tenant, migracja 20260725090500). Program może każde z tych
 * pól nadpisać - scalanie robi `resolvePodcastChannelMeta`.
 */
export interface PodcastChannelMetaRow {
  itunes_author: string | null;
  itunes_owner_name: string | null;
  itunes_owner_email: string | null;
  itunes_category: string | null;
  itunes_subcategory: string | null;
  itunes_explicit: boolean;
  itunes_type: string | null;
  itunes_image_url: string | null;
  itunes_copyright: string | null;
}

export async function fetchPodcastChannelMeta(
  tenantId: string,
): Promise<PodcastChannelMetaRow | null> {
  return edgeTtlCache(`seo:podcast-channel-meta:${tenantId}`, CACHE_TTL_MS, () =>
    resilient("podcast-channel-meta", null, async () => {
      const supabaseAdmin = await getSupabaseAdmin();
      const { data, error: dataError } = await supabaseAdmin
        .from("podcast_settings")
        .select(
          "itunes_author, itunes_owner_name, itunes_owner_email, itunes_category, " +
            "itunes_subcategory, itunes_explicit, itunes_type, itunes_image_url, itunes_copyright",
        )
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (dataError) throw dataError;
      // `as unknown as`: kolumny Apple (explicit / episode_type / itunes_*)
      // pochodzą z migracji 20260725090500 i nie ma ich jeszcze w wygenerowanych
      // typach - do usunięcia przy regeneracji types.ts.
      return (data ?? null) as unknown as PodcastChannelMetaRow | null;
    }),
  );
}

/** Site-wide SEO settings read server-side (service role, no RLS surprises). */
export async function fetchSeoSettingsValue(tenantId: string): Promise<unknown> {
  return edgeTtlCache(`seo:settings:${tenantId}`, CACHE_TTL_MS, () =>
    resilient("settings", null, async () => {
      const supabaseAdmin = await getSupabaseAdmin();
      const { data, error: dataError } = await supabaseAdmin
        .from("site_settings")
        .select("value")
        .eq("tenant_id", tenantId)
        .eq("key", "seo")
        .maybeSingle();
      if (dataError) throw dataError;
      return data?.value ?? null;
    }),
  );
}

// ---------------------------------------------------------------------------
// Feedy tematyczne (D3): RSS per kategoria / tag / program.
// Wspólny odczyt: metadane taksonomii (tytuł kanału) + opublikowane wpisy
// przypięte do niej. Ten sam service-role + tenant-scope + edge cache co
// pozostałe powierzchnie crawlerowe.
// ---------------------------------------------------------------------------

export type FeedTaxonomyKind = "category" | "tag" | "program";

export interface TaxonomyFeedMeta {
  slug: string;
  name_pl: string;
  name_en: string;
  description_pl: string | null;
  description_en: string | null;
}

// UWAGA (mapowanie zrodel feedow taksonomii): category -> categories +
// post_categories; tag -> tags + post_tags; program -> research_programs
// (programy badawcze; landing /programs/$slug i sitemap tez z tej tabeli),
// laczac wpisy przez category_id -> post_categories. Wczesniej `program`
// odpytywal tabele `programs` (hub ekspercki) + junction `post_programs` -
// rozlaczny byt i przestrzen slugow, wiec feed 404-owal dla poprawnego slugu
// albo serwowal wpisy zupelnie innego programu. Zrodla sa teraz jawnie
// rozgalezione w funkcjach ponizej (typowanie klienta Supabase per tabela).

/** Metadane taksonomii do nagłówka kanału; null = 404 feedu. */
export async function fetchTaxonomyForFeed(
  tenantId: string,
  kind: FeedTaxonomyKind,
  slug: string,
): Promise<TaxonomyFeedMeta | null> {
  return edgeTtlCache(`seo:feed-tax:${tenantId}:${kind}:${slug}`, CACHE_TTL_MS, () =>
    resilient("feed-taxonomy", null, async () => {
      const supabaseAdmin = await getSupabaseAdmin();
      if (kind === "tag") {
        // Tagi są jednojęzyczne (kolumna `name`) - mapujemy na oba języki.
        const { data, error: dataError } = await supabaseAdmin
          .from("tags")
          .select("slug, name")
          .eq("tenant_id", tenantId)
          .eq("slug", slug)
          .maybeSingle();
        if (dataError) throw dataError;
        if (!data) return null;
        return {
          slug: data.slug,
          name_pl: data.name,
          name_en: data.name,
          description_pl: null,
          description_en: null,
        };
      }
      if (kind === "program") {
        // research_programs nie ma description_pl/en - opis kanalu bierzemy z
        // tagline. Tylko opublikowane programy maja feed.
        const { data, error: dataError } = await supabaseAdmin
          .from("research_programs")
          .select("slug, name_pl, name_en, tagline_pl, tagline_en")
          .eq("tenant_id", tenantId)
          .eq("slug", slug)
          .eq("status", "published")
          .maybeSingle();
        if (dataError) throw dataError;
        if (!data) return null;
        return {
          slug: data.slug ?? slug,
          name_pl: data.name_pl ?? data.name_en ?? slug,
          name_en: data.name_en ?? data.name_pl ?? slug,
          description_pl: data.tagline_pl ?? null,
          description_en: data.tagline_en ?? null,
        };
      }
      const { data, error: dataError } = await supabaseAdmin
        .from("categories")
        .select("slug, name_pl, name_en, description_pl, description_en")
        .eq("tenant_id", tenantId)
        .eq("slug", slug)
        .maybeSingle();
      if (dataError) throw dataError;
      if (!data) return null;
      return {
        slug: data.slug ?? slug,
        name_pl: data.name_pl ?? data.name_en ?? slug,
        name_en: data.name_en ?? data.name_pl ?? slug,
        description_pl: data.description_pl ?? null,
        description_en: data.description_en ?? null,
      };
    }),
  );
}

export interface PublishedTrackerSitemapRow {
  slug: string;
  title_pl: string;
  title_en: string;
  summary_pl: string | null;
  summary_en: string | null;
  policy_area: string;
  stage: string;
  updated_at: string | null;
  created_at: string | null;
}

/**
 * Opublikowane dossier trackera legislacyjnego UE - materiał feedu /tracker/rss.xml.
 *
 * Tracker pozycjonuje się jako źródło prawdy o legislacji UE, ale nie miał ŻADNEGO
 * kanału subskrypcji: czytelnik (i agregator branżowy) musiał sam wracać na stronę,
 * żeby zauważyć zmianę etapu dossier. Sortowanie po `updated_at`, nie po dacie
 * utworzenia - w trackerze wartość informacyjną ma RUCH sprawy, nie jej debiut.
 */
export async function fetchPublishedTrackerItems(
  tenantId: string,
  limit = 50,
): Promise<PublishedTrackerSitemapRow[]> {
  return edgeTtlCache(`seo:tracker-items:${tenantId}:${limit}`, CACHE_TTL_MS, () =>
    resilient("tracker-items", [], async () => {
      const supabaseAdmin = await getSupabaseAdmin();
      const { data, error: dataError } = await supabaseAdmin
        .from("eu_policy_items")
        .select(
          "slug, title_pl, title_en, summary_pl, summary_en, policy_area, stage, updated_at, created_at",
        )
        .eq("tenant_id", tenantId)
        .eq("status", "published")
        .order("updated_at", { ascending: false })
        .limit(limit);
      if (dataError) throw dataError;
      return (data ?? []) as PublishedTrackerSitemapRow[];
    }),
  );
}

export interface LiveCoverageEntryRow {
  id: string;
  /** Kanoniczna ścieżka posta prowadzącego relację ("/sekcja/slug"). */
  postPath: string;
  postTitlePl: string;
  postTitleEn: string;
  /** Tytuł wpisu relacji (opcjonalny - redakcja często wrzuca sam tekst). */
  title: string | null;
  bodyHtml: string;
  /** Język wpisu ("pl"/"en"); wpisy relacji są jednojęzyczne. */
  lang: string;
  occurredAt: string;
}

/**
 * Najnowsze wpisy relacji na żywo z opublikowanych postów - materiał feedu
 * /live/rss.xml.
 *
 * Relacja live jest z natury kanałem PUSH: czytelnik chce dostać nowy wpis, a nie
 * odświeżać stronę. Do tej pory /live było wyłącznie stroną HTML, więc jedyną
 * formą subskrypcji było ręczne odświeżanie. Elementem feedu jest WPIS relacji
 * (nie post), bo to on jest jednostką aktualizacji; link prowadzi do posta z
 * zakotwiczeniem na wpisie.
 */
export async function fetchLiveCoverageEntries(
  tenantId: string,
  limit = 50,
): Promise<LiveCoverageEntryRow[]> {
  return edgeTtlCache(`seo:live-entries:${tenantId}:${limit}`, CACHE_TTL_MS, () =>
    resilient("live-entries", [], async () => {
      const supabaseAdmin = await getSupabaseAdmin();
      const { data: entries, error: entriesError } = await supabaseAdmin
        .from("live_blog_entries")
        .select("id, post_id, title, body_html, lang, occurred_at")
        .eq("tenant_id", tenantId)
        .order("occurred_at", { ascending: false })
        // Z zapasem: część najświeższych wpisów może wisieć na postach, które
        // wróciły do szkicu - odfiltrowanie następuje po złączeniu niżej.
        .limit(limit * 4);
      if (entriesError) throw entriesError;
      const rows = entries ?? [];
      if (rows.length === 0) return [];

      const postIds = [...new Set(rows.map((r) => r.post_id))];
      const [pagePaths, { data: posts, error: postsError }] = await Promise.all([
        fetchPagePaths(tenantId),
        supabaseAdmin
          .from("posts")
          .select("id, slug, parent_page_id, title_pl, title_en")
          .eq("tenant_id", tenantId)
          .eq("status", "published")
          .is("deleted_at", null)
          .eq("seo_noindex", false)
          .in("id", postIds),
      ]);
      if (postsError) throw postsError;
      const byId = new Map(
        (posts ?? []).map((p) => [
          p.id,
          {
            path: pagePaths.get(p.parent_page_id)
              ? `/${pagePaths.get(p.parent_page_id)}/${p.slug}`
              : null,
            titlePl: p.title_pl,
            titleEn: p.title_en,
          },
        ]),
      );

      const out: LiveCoverageEntryRow[] = [];
      for (const entry of rows) {
        const post = byId.get(entry.post_id);
        if (!post?.path) continue;
        out.push({
          id: entry.id,
          postPath: post.path,
          postTitlePl: post.titlePl,
          postTitleEn: post.titleEn,
          title: entry.title,
          bodyHtml: entry.body_html,
          lang: entry.lang,
          occurredAt: entry.occurred_at,
        });
        if (out.length >= limit) break;
      }
      return out;
    }),
  );
}

/** Opublikowane wpisy przypięte do taksonomii - kolejność jak w /rss.xml. */
export async function fetchPublishedPostsByTaxonomy(
  tenantId: string,
  kind: FeedTaxonomyKind,
  slug: string,
  limit = 50,
): Promise<PublishedPostRow[]> {
  return edgeTtlCache(`seo:feed-posts:${tenantId}:${kind}:${slug}:${limit}`, CACHE_TTL_MS, () =>
    resilient("feed-taxonomy-posts", [], async () => {
      const supabaseAdmin = await getSupabaseAdmin();
      // Jawny switch po tabeli łączącej - dynamiczna nazwa kolumny łamałaby
      // typowanie klienta Supabase (keyof Row per tabela).
      let joinRows: Array<{ post_id: string }> = [];
      if (kind === "program") {
        // research_programs -> category_id -> post_categories (jak landing).
        const { data: program, error: programError } = await supabaseAdmin
          .from("research_programs")
          .select("category_id")
          .eq("tenant_id", tenantId)
          .eq("slug", slug)
          .eq("status", "published")
          .maybeSingle();
        if (programError) throw programError;
        if (!program?.category_id) return [];
        const { data: rows, error: rowsError } = await supabaseAdmin
          .from("post_categories")
          .select("post_id")
          .eq("category_id", program.category_id);
        if (rowsError) throw rowsError;
        joinRows = rows ?? [];
      } else if (kind === "category") {
        const { data: tax, error: taxError } = await supabaseAdmin
          .from("categories")
          .select("id")
          .eq("tenant_id", tenantId)
          .eq("slug", slug)
          .maybeSingle();
        if (taxError) throw taxError;
        if (!tax?.id) return [];
        const { data: rows, error: rowsError } = await supabaseAdmin
          .from("post_categories")
          .select("post_id")
          .eq("category_id", tax.id);
        if (rowsError) throw rowsError;
        joinRows = rows ?? [];
      } else {
        const { data: tax, error: taxError } = await supabaseAdmin
          .from("tags")
          .select("id")
          .eq("tenant_id", tenantId)
          .eq("slug", slug)
          .maybeSingle();
        if (taxError) throw taxError;
        if (!tax?.id) return [];
        const { data: rows, error: rowsError } = await supabaseAdmin
          .from("post_tags")
          .select("post_id")
          .eq("tag_id", tax.id);
        if (rowsError) throw rowsError;
        joinRows = rows ?? [];
      }
      const postIds = [...new Set(joinRows.map((r) => r.post_id))];
      if (postIds.length === 0) return [];
      const [pagePaths, { data, error: dataError }] = await Promise.all([
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
          .in("id", postIds)
          .order("published_at", { ascending: false })
          .limit(limit),
      ]);
      if (dataError) throw dataError;
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

// ---------------------------------------------------------------------------
// Tracker legislacyjny UE: źródła kanału RSS (/tracker/rss.xml).
//
// TENANT SCOPE: service role omija RLS, więc OBA zapytania filtrują jawnie po
// tenancie właściciela hosta. Aktualizacje dodatkowo zawężamy do id dossier,
// które przeszły filtr `status = 'published'` - nawet gdyby polityka RLS
// kiedyś się rozluźniła, nota z wersji roboczej nie ma jak trafić do kanału.
// Jeden wpis cache na parę (tenant, limit): kanał czyta oba strumienie razem.
// ---------------------------------------------------------------------------

export interface PublishedTrackerItemRow {
  id: string;
  slug: string;
  title_pl: string;
  title_en: string;
  summary_pl: string | null;
  summary_en: string | null;
  policy_area: string;
  stage: string;
  created_at: string;
  updated_at: string;
}

export interface PublishedTrackerUpdateRow {
  id: string;
  item_id: string;
  note_pl: string;
  note_en: string;
  stage_from: string | null;
  stage_to: string | null;
  happened_on: string;
  created_at: string;
}

export interface TrackerFeedSources {
  items: PublishedTrackerItemRow[];
  updates: PublishedTrackerUpdateRow[];
}

/**
 * Opublikowane dossier + ich aktualizacje dla kanału RSS trackera.
 * Degraduje do pustych list (jak każda powierzchnia crawlerowa) - awaria bazy
 * nie może dać 500 na feedzie.
 */
export async function fetchTrackerFeedSources(
  tenantId: string,
  limit = 50,
): Promise<TrackerFeedSources> {
  return edgeTtlCache(`seo:tracker-feed:${tenantId}:${limit}`, CACHE_TTL_MS, () =>
    resilient<TrackerFeedSources>("tracker-feed", { items: [], updates: [] }, async () => {
      const supabaseAdmin = await getSupabaseAdmin();
      // Okno dossier jest szersze niż limit kanału: scalanie i przycięcie
      // dzieje się PO posortowaniu obu strumieni (buildTrackerFeedItems), więc
      // starsze dossier musi być dostępne jako kontekst swojej świeżej
      // aktualizacji (tytuł, obszar, etap) - inaczej wpis osi czasu wypadłby
      // z kanału jako "sierota".
      const { data: itemRows, error: itemRowsError } = await supabaseAdmin
        .from("eu_policy_items")
        .select(
          "id, slug, title_pl, title_en, summary_pl, summary_en, policy_area, stage, created_at, updated_at",
        )
        .eq("tenant_id", tenantId)
        .eq("status", "published")
        .order("updated_at", { ascending: false })
        .limit(Math.max(limit * 4, 100));
      if (itemRowsError) throw itemRowsError;
      const items: PublishedTrackerItemRow[] = itemRows ?? [];
      if (items.length === 0) return { items, updates: [] };

      const { data: updateRows, error: updateRowsError } = await supabaseAdmin
        .from("eu_policy_updates")
        .select("id, item_id, note_pl, note_en, stage_from, stage_to, happened_on, created_at")
        .eq("tenant_id", tenantId)
        .in(
          "item_id",
          items.map((item) => item.id),
        )
        .order("created_at", { ascending: false })
        .limit(limit);
      if (updateRowsError) throw updateRowsError;
      return { items, updates: updateRows ?? [] };
    }),
  );
}
