// Public-content query options. Centralized so loaders + components share
// identical keys/fetchers (single source of truth for cache invalidation).
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SEO_FIELDS_SELECT } from "@/lib/seo/fields";
import type { PageTreeRow } from "@/lib/seo/pageTree";
import { fetchPageBreadcrumbs, type BreadcrumbRow } from "@/lib/breadcrumbs";
import { EMPTY_BODY, type BodyParts } from "@/lib/access/gating";
import { GUEST_ACCESS_CONTEXT, stripInaccessibleNodes } from "@/lib/builder/accessControl";
import type { ContentAccessRule } from "@/hooks/useContentAccess";
import type { LayoutOverrides, PostFormat } from "@/lib/postLayouts";
import { edgeTtlCache } from "@/lib/ssrCache";
import { SPONSORED_LIST_COLS } from "@/lib/content/sponsored";

// Non-sensitive columns of the access rule. Safe to ship to anonymous SSR so the
// paywall teaser renders server-side (good for SEO); the body itself stays gated
// behind get_entity_content.
const ACCESS_RULE_COLS =
  "id, entity_type, entity_id, mode, plan_ids, one_time_price_cents, one_time_currency, teaser_pl, teaser_en, metering_policy";

/**
 * Kolumny sekcji "dowiesz się, że..." - WSPÓLNE dla wpisów i stron.
 *
 * Wyciągnięte do nazwanej stałej, bo to najcieńsze ogniwo tej funkcji: gdy
 * wypadnie z selectu STRON, sekcja przestaje się renderować na stronach i nikt
 * tego nie zauważy (żaden test nie patrzył na listę kolumn, a audyty 07-30 i
 * 08-01 zapisały wprost nieprawdę, że dla stron ta gałąź jest martwa).
 * Kontrakt pilnuje `lib/keyTakeaways/__tests__/selectContract.test.ts`.
 */
export const TAKEAWAYS_SELECT_COLS = "takeaways_pl, takeaways_en, takeaways_variant";

/** Wspólny prefiks kolumn każdej encji treści (tożsamość + prezentacja + daty). */
const ENTITY_BASE_COLS =
  "id, slug, title_pl, title_en, excerpt_pl, excerpt_en, editor, cover_image_url, published_at, updated_at";

/**
 * Migawka organizacji przypisanej do wpisu. Czytamy KOPIĘ z wiersza wpisu, a nie
 * `crm_companies` przez join - tamta tabela jest czytelna wyłącznie dla stafu CRM
 * (crm_companies_staff_read), więc dla anonimowego czytelnika join zwracałby NULL.
 * Uzasadnienie i konsekwencje: migracja 20260817090000.
 */
const ORGANIZATION_SELECT_COLS =
  "organization_id, organization_name, organization_logo_url, organization_website";

/**
 * Ujawnienie komercyjne. `sponsored_order_ref`, `sponsored_marked_by` i
 * `sponsored_marked_at` są tu CELOWO NIEOBECNE: to ślad rozliczalności dla
 * redakcji, a nie treść dla czytelnika - nie mają czego szukać w publicznym
 * bundlu (ani w grancie kolumnowym, patrz ta sama migracja).
 */
const SPONSORED_SELECT_COLS =
  "is_sponsored, sponsored_kind, sponsored_advertiser_name, sponsored_advertiser_url, sponsored_payer_name, sponsored_note_pl, sponsored_note_en, sponsored_affiliate, sponsored_political, sponsored_political_process, sponsored_sponsor_controller";

/**
 * Kolumny encji treści dla renderu publicznego (bez body - to gated RPC).
 *
 * UWAGA: każdy wpis MUSI być jednym literałem szablonowym. Klient Supabase
 * typuje wynik `.select()` z literalnego typu argumentu - konkatenacja przez
 * `+` rozszerza typ do `string` i wynik degraduje do `GenericStringError`,
 * czyli tracimy całe typowanie wierszy (i wracamy do rzutowań przez `unknown`).
 */
export const ENTITY_SELECT_COLS = {
  post: `${ENTITY_BASE_COLS}, read_minutes, post_format, layout_overrides, ${TAKEAWAYS_SELECT_COLS}, toc_override, custom_meta, related_override, author_id, audio_url_pl, audio_url_en, ${SEO_FIELDS_SELECT}, ${ORGANIZATION_SELECT_COLS}, ${SPONSORED_SELECT_COLS}`,
  page: `${ENTITY_BASE_COLS}, template_type, header_override, ${TAKEAWAYS_SELECT_COLS}, ${SEO_FIELDS_SELECT}`,
  /**
   * Strona główna w trybie statycznej strony: bez pól postowych i bez pól
   * stron (szablon/nagłówek rozstrzyga trasa `/`), ale Z takeaways - sekcja
   * działa też na stronie głównej.
   */
  homepage: `${ENTITY_BASE_COLS}, ${TAKEAWAYS_SELECT_COLS}, ${SEO_FIELDS_SELECT}`,
} as const;

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
 * Enforces builder `advanced.access` gates (widget/column/section visibility)
 * on the SERVER, before the document leaves for the client.
 *
 * The renderer evaluates the same rules, but doing it only there left the gated
 * markup in the page source of every guest - the rule decided what was painted,
 * not what was shipped.
 *
 * The projection is ALWAYS the guest one, and that is not a simplification: the
 * public Supabase client keeps its session in localStorage, so a server render
 * has no identity to strip against (this is the same invariant that makes
 * `get_entity_content` return a null body to anonymous SSR). It is also the only
 * safe projection - the result lands in `edgeTtlCache` and in a shared CDN entry
 * (see `contentCacheControl` on the public routes), both keyed without identity,
 * so an identity-dependent strip would serve one visitor's nodes to the next.
 * In the browser the same fetcher runs with the visitor's real session, so the
 * body is left intact and the renderer gates it against the real context.
 */
function stripBuilderAccessForAnonymousRender(builderData: unknown): unknown {
  if (typeof window !== "undefined") return builderData;
  return stripInaccessibleNodes(builderData, GUEST_ACCESS_CONTEXT);
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
    builder_data: stripBuilderAccessForAnonymousRender(row.builder_data),
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
  // Wymagane, nie opcjonalne - patrz uzasadnienie przy `PostCardData`
  // w components/molecules/PostListCard: opcjonalność pozwalała zapytaniu
  // przemilczeć te kolumny i wyrenderować sponsorowany materiał bez oznaczenia.
  is_sponsored: boolean | null;
  sponsored_kind: string | null;
  sponsored_affiliate: boolean | null;
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
  /** Migawka organizacji (patrz ORGANIZATION_SELECT_COLS). */
  organization_id: string | null;
  organization_name: string | null;
  organization_logo_url: string | null;
  organization_website: string | null;
  /** Ujawnienie komercyjne (patrz SPONSORED_SELECT_COLS + lib/content/sponsored.ts). */
  is_sponsored: boolean;
  sponsored_kind: string | null;
  sponsored_advertiser_name: string | null;
  sponsored_advertiser_url: string | null;
  sponsored_payer_name: string | null;
  sponsored_note_pl: string | null;
  sponsored_note_en: string | null;
  sponsored_affiliate: boolean;
  sponsored_political: boolean;
  sponsored_political_process: string | null;
  sponsored_sponsor_controller: string | null;
}

interface AuthorProfileOverlay {
  avatar_url: string | null;
  job_title: string | null;
  company: string | null;
  bio_pl: string | null;
  bio_en: string | null;
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

/** Lekka referencja autora do cytowań i meta citation_* (bez bio/socials). */
export interface PostAuthorRef {
  id: string;
  slug: string | null;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
}

/**
 * Wiersz profiles_public pobierany jednym selectem .in() dla wszystkich
 * autorów wpisu - nadzbiór PostAuthorRef o avatar/bio, z którego budujemy
 * zarówno pełny profil autora głównego, jak i lekkie referencje pozostałych.
 */
export type FullAuthorRow = PostAuthorRef & {
  avatar_url: string | null;
  bio_pl: string | null;
  bio_en: string | null;
};

/** Surowy wiersz author_profiles: jak overlay, ale custom_socials to Json. */
export type RawAuthorOverlay = Omit<AuthorProfileOverlay, "custom_socials"> & {
  custom_socials: unknown;
};

/**
 * Kanoniczna kolejność autorów wpisu: główny (author_id) zawsze pierwszy,
 * potem współautorzy z post_authors wg sort_order, z deduplikacją. Czysta
 * funkcja - kolejność musi być policzona PRZED pojedynczym selectem .in(),
 * więc żyje osobno od kształtowania profili.
 */
export function orderAuthorIds(
  mainAuthorId: string | null,
  coAuthorUserIds: readonly string[],
): string[] {
  const ordered: string[] = [];
  if (mainAuthorId) ordered.push(mainAuthorId);
  for (const uid of coAuthorUserIds) {
    if (uid && !ordered.includes(uid)) ordered.push(uid);
  }
  return ordered;
}

/**
 * Buduje pełny profil autora głównego (avatar/bio + nakładka author_profiles)
 * oraz uporządkowane, lekkie referencje WSZYSTKICH autorów z jednego zestawu
 * wierszy profiles_public. Czysta transformacja bez I/O - cały ruch do bazy
 * dzieje się u wołającego jednym round-tripem, tu tylko kształtujemy dane, co
 * czyni logikę kolejności/scalania testowalną w izolacji.
 */
export function buildPostAuthors(input: {
  orderedAuthorIds: readonly string[];
  profileRows: readonly FullAuthorRow[];
  mainAuthorId: string | null;
  overlay: RawAuthorOverlay | null;
}): { author: PostAuthor | null; authors: PostAuthorRef[] } {
  const byId = new Map(input.profileRows.map((p) => [p.id, p] as const));
  const authors: PostAuthorRef[] = input.orderedAuthorIds
    .map((id) => byId.get(id))
    .filter((p): p is FullAuthorRow => !!p)
    .map((p) => ({
      id: p.id,
      slug: p.slug,
      display_name: p.display_name,
      first_name: p.first_name,
      last_name: p.last_name,
    }));
  let author: PostAuthor | null = null;
  const mainRow = input.mainAuthorId ? byId.get(input.mainAuthorId) : undefined;
  if (mainRow) {
    const overlay = input.overlay;
    const cs = Array.isArray(overlay?.custom_socials)
      ? (overlay!.custom_socials as unknown as Array<{
          label: string;
          url: string;
          iconUrl?: string;
        }>)
      : [];
    author = {
      id: mainRow.id,
      slug: mainRow.slug,
      display_name: mainRow.display_name,
      first_name: mainRow.first_name,
      last_name: mainRow.last_name,
      avatar_url: mainRow.avatar_url,
      bio_pl: mainRow.bio_pl,
      bio_en: mainRow.bio_en,
      author_profile: overlay
        ? { ...(overlay as unknown as AuthorProfileOverlay), custom_socials: cs }
        : null,
    };
  }
  return { author, authors };
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
      /**
       * Kanoniczna, uporządkowana lista WSZYSTKICH autorów: autor główny
       * (author_id) zawsze pierwszy, potem współautorzy z post_authors wg
       * sort_order. Zasila box cytowań i tagi citation_author w <head>.
       */
      authors: PostAuthorRef[];
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

/** Kształt ustawień czytania konsumowany przez trasę główną. */
interface ReadingSettingsValue {
  homepage_mode?: string;
  homepage_page_id?: string;
  homepage_page_slug?: string;
}

/**
 * Ustawienia czytania (`site_settings["reading"]`) bez dedykowanego
 * round-tripu na serwerze: root loader grzeje bulk mapę wszystkich ustawień
 * (edgeTtlCache per tenant host), więc odczyt jednego klucza jest darmowy.
 * Wcześniej home-mode i home-page czytały ten sam jednowierszowy zapis dwoma
 * osobnymi selectami na każdą rewalidację strony głównej. Przeglądarka
 * (nawigacje SPA) zostaje przy tanim selekcie pojedynczego wiersza - bulk
 * payload nie ma tam sensu.
 */
async function fetchReadingSettings(): Promise<ReadingSettingsValue> {
  if (typeof window === "undefined" && import.meta.env.SSR) {
    // Failure is not an editorial decision to use the legacy static homepage.
    // Let the resilient route loader seed an explicitly stale fallback instead
    // of caching a fabricated mode for 60 seconds in edgeTtlCache.
    const { fetchAllSiteSettings } = await import("@/lib/useSiteSetting");
    const map = await fetchAllSiteSettings();
    const reading = map["reading"];
    return typeof reading === "object" && reading !== null ? (reading as ReadingSettingsValue) : {};
  }
  const { data, error } = await supabase
    .from("site_settings")
    .select("value")
    .eq("key", "reading")
    .maybeSingle();
  if (error) throw error;
  return (data?.value ?? {}) as ReadingSettingsValue;
}

/** Tryb strony głównej z ustawień czytania. Pusta wartość = brak decyzji
 *  (zachowanie historyczne: rezolucja strony statycznej z fallbackiem "home"). */
export type HomepageMode = "latest_posts" | "static_page" | "";

/** Normalizacja surowej wartości ustawienia do zamkniętej unii - nieznane albo
 *  uszkodzone wpisy (stare zapisy, literówki) spadają do "", czyli ścieżki
 *  strony statycznej. Czysta funkcja, dzielona przez loader, komponent i
 *  rezolucję strony głównej - jedna definicja tego, czym jest tryb. */
export function normalizeHomepageMode(value: unknown): HomepageMode {
  return value === "latest_posts" || value === "static_page" ? value : "";
}

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
    queryFn: async (): Promise<HomepageMode> => {
      return edgeTtlCache("public:home-mode", 60_000, async () => {
        const reading = await fetchReadingSettings();
        return normalizeHomepageMode(reading.homepage_mode);
      });
    },
    staleTime: PAGE_PATH_TTL,
  });

// Fetches the page used as the public homepage (`/`).
// Resolution order:
//   0. homepage_mode === "latest_posts" → null (strona główna renderuje
//      paginowaną listę wpisów - żadna strona statyczna nie jest rozwiązywana).
//   1. site_settings.reading.homepage_mode === "static_page" → page by
//      homepage_page_id or homepage_page_slug.
//   2. fallback: top-level page with slug = "home".
// Returns null if neither is found / published.
export const homePageQueryOptions = () =>
  queryOptions({
    queryKey: ["public", "home-page"] as const,
    queryFn: async (): Promise<PageData | null> => {
      return edgeTtlCache("public:home-page", 60_000, async () => {
        // 1. Read reading-settings to find the designated homepage.
        const reading = await fetchReadingSettings();

        // Tryb "najnowsze wpisy": nie rezolwujemy fallbacku slug="home".
        // Dotąd ta gałąź biegła także w trybie latest_posts, co kosztowało
        // 2 zbędne round-tripy (select strony + gated RPC), a head() trasy
        // brał SEO ukrytej strony (title/canonical/robots/og:image) - metadane
        // opisywały treść, której nie ma na ekranie; seo_noindex takiej strony
        // potrafił zdeindeksować stronę główną w trybie wpisów.
        if (normalizeHomepageMode(reading.homepage_mode) === "latest_posts") {
          return null;
        }

        // Non-gated display + SEO columns only; the body (content_*/builder_data)
        // is fetched via the gated get_entity_content RPC below, so the homepage
        // is never read through direct body-column selects. Excerpts + SEO
        // overrides are included so the homepage head() (src/routes/index.tsx)
        // resolves the static page's own SEO fields like any other page.
        const cols = ENTITY_SELECT_COLS.homepage;

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

/**
 * Rozmiar strony list wpisów z ustawień czytania (admin: Ustawienia ->
 * Czytanie -> "Wpisów na stronę"). Twarde widełki 1..100 jak w formularzu;
 * brak/uszkodzony wpis = dotychczasowy default (BLOG_PAGE_SIZE), więc serwisy,
 * które nigdy nie zapisały ustawienia, nie zmieniają zachowania.
 */
export function resolvePostsPerPage(settings: Record<string, unknown> | undefined): number {
  const reading = settings?.["reading"];
  if (typeof reading !== "object" || reading === null) return BLOG_PAGE_SIZE;
  const n = Number((reading as { posts_per_page?: unknown }).posts_per_page);
  return Number.isFinite(n) && n >= 1 ? Math.min(100, Math.round(n)) : BLOG_PAGE_SIZE;
}

export const blogListQueryOptions = (limit: number = BLOG_PAGE_SIZE) =>
  queryOptions({
    queryKey: ["public", "blog", "list", { limit }] as const,
    queryFn: async (): Promise<{ posts: BlogListItem[] }> =>
      // Per-isolate TTL: /blog nie ustawiał dotąd nagłówka cache, więc to
      // zapytanie biegło na każde żądanie SSR. Klucz zawiera limit (rozmiar
      // strony z ustawień czytania rozdziela wpisy cache).
      edgeTtlCache(`public:blog-list:${limit}`, 60_000, async () => {
        const { data, error } = await supabase
          .from("posts")
          .select(
            `id, slug, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url, published_at, parent_page_id, ${SPONSORED_LIST_COLS}`,
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
      }),
    staleTime: 2 * 60_000,
  });

/** Parametry paginowanego archiwum bloga (/blog?page=N). */
export interface BlogArchiveParams {
  page?: number;
  pageSize?: number;
}

/** Jedna strona archiwum bloga + metadane paginacji (dla UI i head()). */
export interface BlogArchiveResult {
  posts: BlogListItem[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Paginowane archiwum bloga - SSR ładuje DOKŁADNIE jedną stronę wyników
 * (range + count), ten sam model co archiwa taksonomii (lib/queries/archives).
 * Zastępuje dawne "load more" (rosnący limit bez `?page`), przez które wpisy
 * poza pierwszą stroną nie miały żadnego indeksowalnego URL-a. Klucz cache
 * odzwierciedla pełną parametryzację strony; edgeTtlCache jest per tenant host,
 * więc izolacja tenantów zachodzi z konstrukcji. Widełki pageSize jak w
 * resolvePostsPerPage (1..100); strona spoza zakresu zwraca pustą listę z
 * poprawnym total - bez błędu 416 (offset/limit, nie nagłówek Range).
 */
export const blogArchiveQueryOptions = (params: BlogArchiveParams = {}) => {
  const page = Math.max(1, Math.floor(params.page ?? 1));
  const pageSize = Math.max(1, Math.min(100, Math.floor(params.pageSize ?? BLOG_PAGE_SIZE)));
  return queryOptions({
    queryKey: ["public", "blog", "archive", { page, pageSize }] as const,
    queryFn: async (): Promise<BlogArchiveResult> =>
      edgeTtlCache(`public:blog-archive:${page}:${pageSize}`, 60_000, async () => {
        const from = (page - 1) * pageSize;
        const { data, count, error } = await supabase
          .from("posts")
          .select(
            `id, slug, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url, published_at, parent_page_id, ${SPONSORED_LIST_COLS}`,
            { count: "exact" },
          )
          .eq("status", "published")
          .is("deleted_at", null)
          .order("published_at", { ascending: false })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        const rows = (data ?? []) as Array<Omit<BlogListItem, "href">>;
        // Wpisy linkują przez dedykowaną trasę /post/$slug (jak blogListQueryOptions)
        // - rozwiązuje się także przy brakującej ścieżce rodzica, zero N+1.
        const posts: BlogListItem[] = rows.map((r) => ({ ...r, href: `/post/${r.slug}` }));
        return { posts, total: count ?? 0, page, pageSize };
      }),
    staleTime: 2 * 60_000,
  });
};

// Published, indexable pages for the public HTML site map (/sitemap). The
// noindex exclusion mirrors sitemap.xml: a URL hidden from crawlers must not
// be advertised by the visible site map either.
export const publicPagesTreeQueryOptions = () =>
  queryOptions({
    queryKey: ["public", "pages-tree"] as const,
    queryFn: async (): Promise<PageTreeRow[]> =>
      edgeTtlCache("public:pages-tree", 5 * 60_000, async () => {
        const { data, error } = await supabase
          .from("pages")
          .select("id, slug, title_pl, title_en, parent_id, menu_order")
          .eq("status", "published")
          .eq("seo_noindex", false)
          .is("deleted_at", null)
          .limit(500);
        if (error) throw error;
        return data ?? [];
      }),
    staleTime: 5 * 60_000,
  });

// Public category list (site map + navigation surfaces).
export const publicCategoriesQueryOptions = () =>
  queryOptions({
    queryKey: ["public", "categories"] as const,
    queryFn: async (): Promise<Array<{ slug: string; name_pl: string; name_en: string }>> =>
      edgeTtlCache("public:categories", 5 * 60_000, async () => {
        const { data, error } = await supabase
          .from("categories")
          .select("slug, name_pl, name_en")
          .order("name_pl");
        if (error) throw error;
        return data ?? [];
      }),
    staleTime: 5 * 60_000,
  });

/**
 * Rdzeń rezolucji treści po segmentach ścieżki (wydzielony z queryFn, żeby
 * objąć go edgeTtlCache bez zmiany logiki). Trzy fale round-tripów:
 * resolve_path -> Promise.all(metadane+body+taksonomie+okruszki+access) ->
 * profile autorów.
 */
async function resolveContentForSegments(segments: string[]): Promise<ResolvedContent | null> {
  const { data: resolved, error: rErr } = await supabase.rpc("resolve_path", {
    _segments: segments,
  });
  if (rErr) throw rErr;
  const hit = (resolved ?? [])[0] as { page_id: string | null; post_id: string | null } | undefined;
  if (!hit?.page_id) return null;

  if (hit.post_id) {
    // Body columns (content_*/builder_data/blocks_data) are fetched via the
    // gated RPC, never selected directly - the row select carries only the
    // non-sensitive display metadata. All four requests run in parallel so
    // gating adds no extra latency.
    const [
      { data, error },
      body,
      { data: tagRows },
      { data: catRows },
      { data: coAuthorRows },
      crumbs,
      access,
    ] = await Promise.all([
      supabase.from("posts").select(ENTITY_SELECT_COLS.post).eq("id", hit.post_id).maybeSingle(),
      fetchGatedBody("post", hit.post_id),
      supabase.from("post_tags").select("tags(slug, name)").eq("post_id", hit.post_id),
      supabase
        .from("post_categories")
        .select("categories(slug, name_pl, name_en, color)")
        .eq("post_id", hit.post_id),
      supabase
        .from("post_authors")
        .select("user_id, sort_order")
        .eq("post_id", hit.post_id)
        .order("sort_order", { ascending: true }),
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
    // Profile WSZYSTKICH autorów (główny + współautorzy) pobieramy JEDNYM
    // selectem .in() po profiles_public - wcześniej były to dwie
    // sekwencyjne rundy (osobny profil autora głównego, a potem drugi
    // .in() na współautorów), co dokładało 1-2 round-tripy na krytycznej
    // ścieżce TTFB wpisu. Nakładka author_profiles (tylko dla autora
    // głównego) leci równolegle w tym samym Promise.all, więc nie dokłada
    // opóźnienia. Ten sam klient anon i te same widoki - izolacja
    // tenanta/RLS bez zmian. Kolejność i scalanie są czystymi funkcjami
    // (orderAuthorIds / buildPostAuthors), przetestowanymi w izolacji.
    const mainAuthorId = post.author_id ?? null;
    const orderedAuthorIds = orderAuthorIds(
      mainAuthorId,
      (coAuthorRows ?? []).map((row) => (row as { user_id: string }).user_id),
    );
    let author: PostAuthor | null = null;
    let authors: PostAuthorRef[] = [];
    if (orderedAuthorIds.length > 0) {
      // Nakładka autora z author_profiles_public - publicznej projekcji BEZ
      // kolumn kontaktowych (contact_email/phone/media_contact_* są PII i mają
      // odebrany SELECT role-wide). Bezpośredni select z author_profiles
      // z contact_email kończył się tu 42501 (połykanym), więc nakładka
      // znikała z każdej strony wpisu; widok filtruje też is_public = true
      // oraz tenant = public_tenant_id() po stronie bazy.
      const overlayQuery = mainAuthorId
        ? supabase
            .from("author_profiles_public")
            .select(
              "avatar_url, job_title, company, bio_pl, bio_en, website_url, x_url, linkedin_url, facebook_url, instagram_url, spotify_url, custom_socials",
            )
            .eq("user_id", mainAuthorId)
            .maybeSingle()
        : null;
      const [{ data: profileRows }, overlayRes] = await Promise.all([
        supabase
          .from("profiles_public")
          .select("id, slug, display_name, first_name, last_name, avatar_url, bio_pl, bio_en")
          .in("id", orderedAuthorIds),
        overlayQuery ?? Promise.resolve({ data: null } as const),
      ]);
      ({ author, authors } = buildPostAuthors({
        orderedAuthorIds,
        profileRows: (profileRows ?? []) as FullAuthorRow[],
        mainAuthorId,
        overlay: overlayRes.data as RawAuthorOverlay | null,
      }));
    }
    return {
      kind: "post",
      item: post,
      crumbs,
      parentPageId: hit.page_id,
      tags,
      categories,
      author,
      authors,
      access,
    };
  }

  const [{ data, error }, body, crumbs, access] = await Promise.all([
    supabase.from("pages").select(ENTITY_SELECT_COLS.page).eq("id", hit.page_id).maybeSingle(),
    fetchGatedBody("page", hit.page_id),
    fetchPageBreadcrumbs(hit.page_id),
    fetchAccessRule("page", hit.page_id),
  ]);
  if (error) throw error;
  if (!data) return null;
  // Microsites (C4): header_override DZIEDZICZY w dół poddrzewa stron -
  // ustawienie nagłówka raz na stronie-korzeniu microsite'u obowiązuje
  // wszystkie podstrony (najbliższy przodek z ustawieniem wygrywa,
  // własne ustawienie strony ma pierwszeństwo). Jedno tanie zapytanie
  // po id przodków z okruszków, tylko gdy strona sama nie nadpisuje.
  let effectiveHeaderOverride = (data as { header_override: string | null }).header_override;
  if (!effectiveHeaderOverride && crumbs.length > 0) {
    const ancestorIds = crumbs.map((c) => c.id).filter((id) => id !== hit.page_id);
    if (ancestorIds.length > 0) {
      const { data: ancestorRows } = await supabase
        .from("pages")
        .select("id, header_override")
        .in("id", ancestorIds);
      const overrideById = new Map(
        (ancestorRows ?? []).map((row) => [row.id, row.header_override] as const),
      );
      for (const crumb of [...crumbs].sort((a, b) => b.depth - a.depth)) {
        const inherited = overrideById.get(crumb.id);
        if (inherited) {
          effectiveHeaderOverride = inherited;
          break;
        }
      }
    }
  }
  return {
    kind: "page",
    item: { ...data, ...body, header_override: effectiveHeaderOverride } as PageData,
    crumbs,
    parentPageId: hit.page_id,
    access,
  };
}

export const resolvedContentQueryOptions = (segments: string[]) =>
  queryOptions({
    queryKey: ["public", "resolved", segments] as const,
    queryFn: async (): Promise<ResolvedContent | null> => {
      if (segments.length === 0) return null;
      // Per-isolate TTL (per tenant host): każdy MISS cache dokumentów płacił
      // dotąd pełne ~10 round-tripów rezolucji wpisu. Krótkie 60 s pokrywa
      // rewalidacje i rozgrzewa świeże izolaty; publikacje i tak wchodzą w
      // ciągu minuty (spójnie z oknem świeżości dokumentów). Wynik to zawsze
      // ANONIMOWA projekcja (body gated = null z get_entity_content), więc
      // współdzielenie między żądaniami jest bezpieczne z konstrukcji.
      return edgeTtlCache(`public:resolved:${segments.join("/")}`, 60_000, () =>
        resolveContentForSegments(segments),
      );
    },
    staleTime: PAGE_PATH_TTL,
  });
