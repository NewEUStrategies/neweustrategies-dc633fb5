import { readFileSync } from "node:fs";
import { popupFixtureSettings } from "./popupFixture.ts";

type Row = Record<string, unknown>;
interface HomeFixture {
  settings: Row[];
  tokens: Row[];
  pages: Row[];
  posts: Row[];
  menus: Row[];
  "menu-items": Row[];
  "home-body": Row[];
  fixture_image_type: string;
  fixture_cover_image_type: string;
}

// Synthetic homepage with representative builder geometry and typography.
// IDs, copy, links and images are test data. No production records or keys.
export const homeFixture = JSON.parse(
  readFileSync(new URL("../../e2e/fixtures/first-visit.json", import.meta.url), "utf8"),
) as HomeFixture;
// Logos and icons: a 279-byte vector, as in production.
export const fixtureImage = readFileSync(
  new URL("../../e2e/fixtures/first-visit-cover.svg", import.meta.url),
);
// Slider hero and post covers: a 1600×900 raster with photo-like entropy
// (gradients, skyline, grain; 112,795 bytes, generated deterministically).
// Chrome drops images below 0.05 bits per displayed pixel from LCP, and the
// vector at the hero size (598×336) is 0.011 bpp: with it the first-visit gate
// measured the small card (0.052 bpp at 275×155), never the hero. The raster is
// ≈4.5 bpp at the hero size, so the gate measures the same element as
// production covers do (docs/performance/2026-10-01-first-visit-lcp-streaming.md, 2.5).
export const fixtureCoverImage = readFileSync(
  new URL("../../e2e/fixtures/first-visit-cover.jpg", import.meta.url),
);

/** Fixture bytes for an intercepted image request: raster for `.jpg` URLs, vector otherwise. */
export function fixtureImageFor(url: string): { body: Buffer; contentType: string } {
  return /\.jpe?g$/i.test(new URL(url).pathname)
    ? { body: fixtureCoverImage, contentType: homeFixture.fixture_cover_image_type }
    : { body: fixtureImage, contentType: homeFixture.fixture_image_type };
}
const emptyTables = new Set([
  "categories",
  "tags",
  "post_categories",
  "post_tags",
  "profiles_public",
  "builder_popups",
  "popups",
  "global_widgets",
  "global_sections",
  "events",
  "ads",
  "ad_slots",
  "ad_placements",
  "ad_campaigns",
  "newsletter_topics",
  "public_newsletter_topics",
  "newsletter_interests",
  "ad_zone_assignments",
  "content_access_public",
  "newsletter_settings",
  // Valid empty catalogs for the cross-platform cold-entry smoke test.
  // Route tests separately exercise populated catalogs and failure recovery.
  "research_programs",
  "podcasts",
  "podcast_shows",
  "web_stories",
  "live_blog_entries",
  "profile_badges",
]);

/**
 * WPIS POD STAŁYM ADRESEM - WYŁĄCZNIE DLA BRAMKI WAGI DOKUMENTU.
 *
 * `node scripts/performance/check-document-weight.ts --root . --path /blog/fixture-2`
 * mierzy stronę wpisu (`/$`): okładkę-kandydata LCP z `PostLayoutRenderer` (eager/high
 * + `data-lcp-candidate`), logo `ReadingHeader` (leniwe od P1.4 na wpisie) i preloady
 * obrazów w `<head>` oraz nagłówku `Link` - źródło duplikatów preloadów z produkcji. Bez tych
 * odpowiedzi `resolve_path` i `get_related_posts_config` rzucały „Unrecorded…”, loader
 * `/$` widział błąd zapytania i oddawał render ZDEGRADOWANY (200, bez wpisu i okładki),
 * więc pomiar wpisu niczego nie mierzył.
 *
 * Wpis to `posts[0]` (`fixture-2`, okładka `https://fixture.invalid/cover.jpg`) pod
 * syntetyczną sekcją `blog`: `page_full_path` fixture odpowiada `/blog` dla każdej strony,
 * więc adres kanoniczny wpisu (pełna ścieżka rodzica + slug) to dokładnie mierzona
 * ścieżka. Żadnego nowego wiersza w `posts`/`pages` - `/` i `/blog` czytają te tabele,
 * a ich progi (`document-weight-budgets.json`, `.blog.json`) liczono bez niego. Progi
 * wpisu: `document-weight-budgets.post.json` (krok CI w `first-visit.yml`) - od `/` różni
 * się wyłącznie seria bootu (domknięcie statyczne trasy `/$`; uzasadnienie w `_comment`
 * tamtego pliku).
 *
 * ZAKRES: tylko `NES_PERFORMANCE_CASE=document-weight` (ustawia go wyłącznie
 * `check-document-weight.ts`). Specy first-visit (`lighthouse-local`, `slow-first-fold`,
 * `popup-first-render`, ...), backend klienta (`clientBackend.ts`) i testy na tym fixture
 * widzą go bez zmian - te RPC i `post_authors` dalej rzucają „Unrecorded…”. `/` i `/blog`
 * nie wołają żadnego z nich (ślad żądań fixture 2026-10-17), więc ich pomiar się nie zmienia.
 */
const DOCUMENT_WEIGHT_CASE = "document-weight";
/**
 * WPIS Z TREŚCIĄ - WYŁĄCZNIE DLA SPECU KOLUMNY TEKSTU (`e2e/article-reading.boot-home.spec.ts`).
 *
 * Ten sam adres co wpis bramki wagi (`posts[0]`, `/blog/fixture-2`), ale z treścią bloków
 * wpisu z produkcji, automatyczną zajawką WordPressa i ustawieniami układu produkcji
 * (`e2e/fixtures/article-reading-post.json`). Tylko w przypadku `artifact-boot` (serwer
 * `playwright.artifact.config.ts`): bramka wagi (`document-weight`) mierzy wpis jak dotąd,
 * bez treści, a pozostałe przypadki widzą `Unrecorded…` jak przed zmianą. Specy `/`
 * w `artifact-boot` nie wołają `resolve_path` ani `get_entity_content` dla wpisu, a wiersz
 * `post_layout_settings` różni się od domyślnych wyłącznie szerokościami kolumny wpisu.
 */
const ARTICLE_READING_CASE = "artifact-boot";
interface ArticleReadingFixture {
  post: Row;
  blocks_pl: unknown;
  post_layout_settings: Row;
}
const articleReading = JSON.parse(
  readFileSync(new URL("../../e2e/fixtures/article-reading-post.json", import.meta.url), "utf8"),
) as ArticleReadingFixture;
const isArticleReadingCase = () => process.env.NES_PERFORMANCE_CASE === ARTICLE_READING_CASE;
/** Wpis pod `DOCUMENT_WEIGHT_POST_PATH` istnieje w bramce wagi i w specu kolumny tekstu. */
const servesFixturePost = () =>
  process.env.NES_PERFORMANCE_CASE === DOCUMENT_WEIGHT_CASE || isArticleReadingCase();
const documentWeightPost = homeFixture.posts[0];
const documentWeightSection = {
  id: "00000000-0000-0000-0000-0000000000b1",
  slug: "blog",
  title_pl: "Blog",
  title_en: "Blog",
  depth: 0,
  full_path: "blog",
};
export const DOCUMENT_WEIGHT_POST_PATH = `/${documentWeightSection.full_path}/${String(documentWeightPost.slug)}`;
/**
 * Ten sam wpis spec-u kolumny tekstu Z SIDEBAREM (`layout_overrides.has_sidebar`), jak na
 * produkcji: osobny adres i id, bo układ wynika z wiersza wpisu. Tylko `artifact-boot`;
 * wiersza nie ma w `homeFixture.posts` (listy `/` i `/blog` bez zmian).
 */
const ARTICLE_SIDEBAR_POST_ID = "00000000-0000-0000-0000-0000000000a2";
const ARTICLE_SIDEBAR_SLUG = `${String(documentWeightPost.slug)}-sidebar`;
export const ARTICLE_SIDEBAR_POST_PATH = `/${documentWeightSection.full_path}/${ARTICLE_SIDEBAR_SLUG}`;
const isArticlePostId = (id: unknown) =>
  id === documentWeightPost.id || id === ARTICLE_SIDEBAR_POST_ID;

/** Odpowiedź RPC strony wpisu bramki wagi; poza jej przypadkiem - `Unrecorded…`, jak dotąd. */
function documentWeightPostRpc(name: string, input: Record<string, unknown>): unknown {
  if (!servesFixturePost()) throw new Error(`Unrecorded performance fixture RPC: ${name}`);
  if (name === "rpc/resolve_path") {
    // Jedyny adres treści `/$` w tym przypadku; każdy inny to czyste 404, nie degradacja.
    const segments = input._segments;
    const hit = Array.isArray(segments) && `/${segments.join("/")}` === DOCUMENT_WEIGHT_POST_PATH;
    if (hit) return [{ page_id: documentWeightSection.id, post_id: documentWeightPost.id }];
    if (
      isArticleReadingCase() &&
      Array.isArray(segments) &&
      `/${segments.join("/")}` === ARTICLE_SIDEBAR_POST_PATH
    )
      return [{ page_id: documentWeightSection.id, post_id: ARTICLE_SIDEBAR_POST_ID }];
    // `artifact-boot`: inne ścieżki rzucają jak przed zmianą (żaden spec `/` ich nie woła).
    if (isArticleReadingCase()) throw new Error(`Unrecorded performance fixture RPC: ${name}`);
    return [];
  }
  if (name === "rpc/page_breadcrumbs")
    return input._page_id === documentWeightSection.id ? [documentWeightSection] : [];
  // `rpc/get_related_posts_config`: tenant bez własnych reguł powiązanych (jak `cmsFixture.ts`).
  return [];
}

function selectRows(rows: Row[], search: URLSearchParams): Row[] {
  return rows
    .filter((row) =>
      [...search].every(([key, filter]) => {
        if (["select", "order", "limit", "offset", "or", "and"].includes(key)) return true;
        if (key === "menus.key")
          return homeFixture.menus.some(
            (menu) => menu.id === row.menu_id && `eq.${menu.key}` === filter,
          );
        if (filter.startsWith("eq.")) return String(row[key]) === filter.slice(3);
        if (filter === "is.null") return row[key] == null;
        if (filter.startsWith("in.("))
          return filter.slice(4, -1).split(",").includes(String(row[key]));
        return true;
      }),
    )
    .slice(
      Number(search.get("offset") ?? 0),
      Number(search.get("offset") ?? 0) + Number(search.get("limit") ?? rows.length),
    );
}

export function isFixtureBackend(url: string): boolean {
  const parsed = new URL(url);
  return (
    parsed.pathname.startsWith("/rest/v1/") &&
    (parsed.hostname.endsWith(".supabase.co") || parsed.hostname === "127.0.0.1")
  );
}

/**
 * Hosty skryptów analitycznych, których harness NIE MA PRAWA pobierać z sieci.
 *
 * Aplikacja wstrzykuje GTM (`ConsentScriptInjector`) i GA4 (`ga4Client`) z
 * `googletagmanager.com`. Runner CI nie ma wyjścia na te hosty, więc żądanie
 * kończy się porażką sieciową - a pomiar wydajności czyta ją jako błąd strony
 * i przewraca się, ZANIM zmierzy cokolwiek. Nie zależy to od mierzonej zmiany:
 * tak samo pada noga BAZOWA, czyli kod sprzed dowolnej modyfikacji. Harness
 * musi więc odpowiedzieć na to żądanie sam, zamiast liczyć na egress.
 */
export function isAnalyticsScript(url: string): boolean {
  const { hostname } = new URL(url);
  return (
    hostname === "www.googletagmanager.com" ||
    hostname === "googletagmanager.com" ||
    hostname === "www.google-analytics.com" ||
    hostname === "google-analytics.com"
  );
}

/** Real PostgREST/RPC response shapes consumed by the unchanged application. */
export async function fixtureResponse(request: Request, { delayMs = 0 } = {}): Promise<Response> {
  const url = new URL(request.url);
  const name = url.pathname.replace(/^\/rest\/v1\//, "");
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, HEAD, POST, OPTIONS",
        "access-control-allow-headers":
          request.headers.get("access-control-request-headers") ?? "*",
      },
    });
  }
  if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
  let data: unknown;
  if (name.startsWith("rpc/")) {
    const input =
      request.method === "POST" ? await request.json() : Object.fromEntries(url.searchParams);
    switch (name) {
      case "rpc/get_entity_content":
        data =
          input._entity_type === "page" && input._entity_id === homeFixture.pages[0].id
            ? homeFixture["home-body"]
            : isArticleReadingCase() &&
                input._entity_type === "post" &&
                isArticlePostId(input._entity_id)
              ? [
                  {
                    content_pl: null,
                    content_en: null,
                    builder_data: null,
                    blocks_data: { pl: articleReading.blocks_pl },
                  },
                ]
              : [];
        break;
      case "rpc/page_full_path":
        data = "/blog";
        break;
      case "rpc/page_full_paths":
        data = [];
        break;
      case "rpc/trending_posts":
        data = homeFixture.posts;
        break;
      case "rpc/get_recommended_posts_v2":
        data = homeFixture.posts.slice(0, Number(input._limit ?? 3));
        break;
      case "rpc/get_post_refs":
        data = homeFixture.posts
          .filter((post) => Array.isArray(input._post_ids) && input._post_ids.includes(post.id))
          .map((post) => ({ ...post, author_name: null, author_avatar: null, author_slug: null }));
        break;
      case "rpc/resolve_path":
      case "rpc/page_breadcrumbs":
      case "rpc/get_related_posts_config":
        data = documentWeightPostRpc(name, input);
        break;
      default:
        throw new Error(`Unrecorded performance fixture RPC: ${name}`);
    }
  } else {
    if (!["GET", "HEAD"].includes(request.method))
      throw new Error("Fixture rejects database writes");
    let rows: Row[];
    switch (name) {
      case "newsletter_settings":
        rows =
          process.env.NES_PERFORMANCE_CASE === "popup-first-render" ? [popupFixtureSettings] : [];
        break;
      case "tenants":
        rows = [
          { id: "performance-tenant", slug: "performance", domain: "127.0.0.1", is_default: true },
        ];
        break;
      case "redirects":
        rows = [];
        break;
      case "site_settings":
        rows = homeFixture.settings;
        break;
      case "site_design_tokens":
        // Kolumna `font_scale jsonb NOT NULL DEFAULT '{}'` (migracja 20260908145237)
        // jest w każdym wierszu produkcji; zapis fixture sprzed tej migracji jej nie
        // ma. Brak pola i `{}` normalizują się tak samo, ale backend klienta
        // (P0.1, `clientBackend.ts`) ma odpowiadać kształtem produkcji.
        rows = homeFixture.tokens.map((row) => ({ font_scale: {}, ...row }));
        break;
      case "pages":
        rows = homeFixture.pages;
        break;
      case "posts":
        // Wiersz wpisu czytany po id (`.maybeSingle()`) w specu kolumny tekstu niesie
        // pola artykułu (silnik bloków, zajawka WordPressa, punkty); listy - bez zmian.
        rows =
          isArticleReadingCase() &&
          url.searchParams.get("id") === `eq.${String(documentWeightPost.id)}`
            ? homeFixture.posts.map((post) =>
                post.id === documentWeightPost.id ? { ...post, ...articleReading.post } : post,
              )
            : isArticleReadingCase() &&
                url.searchParams.get("id") === `eq.${ARTICLE_SIDEBAR_POST_ID}`
              ? [
                  {
                    ...documentWeightPost,
                    ...articleReading.post,
                    id: ARTICLE_SIDEBAR_POST_ID,
                    slug: ARTICLE_SIDEBAR_SLUG,
                    layout_overrides: { has_sidebar: true },
                  },
                ]
              : homeFixture.posts;
        break;
      case "post_layout_settings":
        rows = isArticleReadingCase() ? [articleReading.post_layout_settings] : [];
        break;
      case "post_authors":
        // Wpis bramki wagi bez współautorów (`author_id` też null); poza nią - jak dotąd.
        if (!servesFixturePost()) throw new Error(`Unrecorded performance fixture table: ${name}`);
        rows = [];
        break;
      case "menus":
        rows = homeFixture.menus;
        break;
      case "menu_items":
        rows = homeFixture["menu-items"];
        break;
      default:
        if (!emptyTables.has(name))
          throw new Error(`Unrecorded performance fixture table: ${name}`);
        rows = [];
    }
    const selected = selectRows(rows, url.searchParams);
    data = request.headers.get("accept")?.includes("application/vnd.pgrst.object+json")
      ? (selected[0] ?? null)
      : selected;
  }
  return new Response(request.method === "HEAD" ? null : JSON.stringify(data), {
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });
}
