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
  "post_layout_settings",
  // Valid empty catalogs for the cross-platform cold-entry smoke test.
  // Route tests separately exercise populated catalogs and failure recovery.
  "research_programs",
  "podcasts",
  "podcast_shows",
  "web_stories",
  "live_blog_entries",
  "profile_badges",
]);

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
        rows = homeFixture.tokens;
        break;
      case "pages":
        rows = homeFixture.pages;
        break;
      case "posts":
        rows = homeFixture.posts;
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
