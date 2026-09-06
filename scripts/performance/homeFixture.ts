import { readFileSync } from "node:fs";

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
}

// Synthetic homepage with representative builder geometry and typography.
// IDs, copy, links and images are test data. No production records or keys.
export const homeFixture = JSON.parse(
  readFileSync(new URL("../../e2e/fixtures/first-visit.json", import.meta.url), "utf8"),
) as HomeFixture;
export const fixtureImage = readFileSync(
  new URL("../../e2e/fixtures/first-visit-cover.svg", import.meta.url),
);
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

/** Real PostgREST/RPC response shapes consumed by the unchanged application. */
export async function fixtureResponse(request: Request, { delayMs = 0 } = {}): Promise<Response> {
  const url = new URL(request.url);
  const name = url.pathname.replace(/^\/rest\/v1\//, "");
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
