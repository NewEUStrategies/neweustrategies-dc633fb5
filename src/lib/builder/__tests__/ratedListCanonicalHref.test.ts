// LISTA OCENIANA (źródło dynamiczne): ADRES KANONICZNY WPISU.
//
// Wiersze listy niosły `href` i `authorHref` równe `/post/<slug>` - adres,
// który odpowiada 301 na `/<ścieżka rodzica>/<slug>` (dodatkowy dokument i dwa
// odczyty bazy na kliknięcie).
//
// CO TEN PLIK PRZYPINA.
//  1. Strona-rodzic jedzie osadzeniem w TYM SAMYM odczycie wpisów: jedno
//     żądanie `posts`, zero żądań `pages`.
//  2. `href` liczy `postHref` w zapytaniu, więc adres leży w stanie
//     odwodnionym (HTML serwera = strona po hydratacji); rodzic zagnieżdżony
//     albo niewidoczny dla gościa zostaje przy `/post/<slug>`.
//  3. Gdy odczyt z osadzeniem zawiedzie, leci ten sam odczyt bez osadzenia -
//     lista ma wpisy z adresem zapasowym, a nie pustkę.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordedChain, SupabaseFromStub } from "@/test/supabase";

const sb = vi.hoisted(() => ({ from: null as SupabaseFromStub | null }));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabase");
  const fromStub = supabaseFromStub();
  sb.from = fromStub;
  return { supabase: { from: fromStub.from } };
});

import { fail, ok } from "@/test/supabase";
import {
  RATED_LIST_POST_PLAIN_COLUMNS,
  ratedListQueryOptions,
  type RatedListItem,
} from "@/lib/builder/ratedListQuery";
import { POST_PARENT_PAGE_EMBED } from "@/lib/routing/postHref";
import { resetPostParentPageRead } from "@/lib/routing/postParentPageRead";

/**
 * `select` listy z osadzeniem rodzica - DOSŁOWNIE, znak po znaku. Moduł
 * zapytania trzyma już tylko literał zapasowy, a osadzenie dokleja wspólny
 * pomocnik (`readPostsWithParentPage`); ten napis pilnuje, że do bazy idzie
 * to samo żądanie co wtedy, gdy moduł miał pełny literał.
 */
const RATED_LIST_POST_COLUMNS =
  "id, slug, title_pl, title_en, excerpt_pl, excerpt_en, published_at, post_format, author_id, parent_page:pages!posts_parent_page_id_fkey(slug, parent_id)";

function db(): SupabaseFromStub {
  if (sb.from === null) throw new Error("test: atrapa `from` nie zostala utworzona");
  return sb.from;
}

function run(): Promise<RatedListItem[]> {
  const options = ratedListQueryOptions({ source: "dynamic" }, "pl");
  return (options.queryFn as () => Promise<RatedListItem[]>)();
}

function selectOf(chain: RecordedChain | undefined): string {
  return String(chain?.argsOf("select")?.[0]);
}

/** Wpisy: pod `/blog`, pod stroną zagnieżdżoną i pod rodzicem niewidocznym dla gościa. */
const PARENTS = [
  { slug: "blog", parent_id: null },
  { slug: "energetyka", parent_id: "pg-analizy" },
  null,
];

function posts(withParentPage: boolean): Array<Record<string, unknown>> {
  return PARENTS.map((parent, i) => ({
    id: `p${i + 1}`,
    slug: `wpis-${i + 1}`,
    title_pl: `Wpis ${i + 1}`,
    title_en: "",
    excerpt_pl: null,
    excerpt_en: null,
    published_at: "2026-10-01T08:00:00Z",
    post_format: "standard",
    author_id: null,
    ...(withParentPage ? { parent_page: parent } : {}),
  }));
}

beforeEach(() => {
  db().reset();
  resetPostParentPageRead();
  db().setResponse("posts", (chain) => ok(posts(selectOf(chain).includes("parent_page:"))));
});

describe("lista oceniana: adres kanoniczny wpisu", () => {
  it("literał z osadzeniem różni się od zapasowego wyłącznie osadzeniem rodzica", () => {
    expect(RATED_LIST_POST_COLUMNS).toBe(
      `${RATED_LIST_POST_PLAIN_COLUMNS}, ${POST_PARENT_PAGE_EMBED}`,
    );
    expect(RATED_LIST_POST_PLAIN_COLUMNS).toBe(
      "id, slug, title_pl, title_en, excerpt_pl, excerpt_en, published_at, post_format, author_id",
    );
    expect(RATED_LIST_POST_PLAIN_COLUMNS).not.toContain("(");
  });

  it("href i authorHref z rodzica w wierszu; jedno żądanie o wpisy, zero o strony", async () => {
    const rows = await run();

    expect(rows.map((r) => r.href)).toEqual(["/blog/wpis-1", "/post/wpis-2", "/post/wpis-3"]);
    expect(rows.map((r) => r.authorHref)).toEqual(rows.map((r) => r.href));
    expect(db().chainsFor("posts")).toHaveLength(1);
    expect(selectOf(db().lastChain("posts"))).toBe(RATED_LIST_POST_COLUMNS);
    expect(db().chainsFor("pages")).toHaveLength(0);
  });

  it("osadzenie nie wycieka do wiersza listy (kształt stanu odwodnionego bez zmian)", async () => {
    const [row] = await run();

    expect(row).not.toHaveProperty("parent_page");
    expect(Object.keys(row ?? {}).sort()).toEqual(
      [
        "author",
        "authorAvatar",
        "authorHref",
        "date",
        "excerpt",
        "format",
        "href",
        "rating",
        "title",
      ].sort(),
    );
  });

  it("odczyt z osadzeniem zawodzi: te same wpisy z adresem zapasowym, nie pusta lista", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    db().setResponse("posts", (chain) =>
      selectOf(chain).includes("parent_page:")
        ? fail(
            "Could not find a relationship between 'posts' and 'pages' in the schema cache",
            "PGRST200",
          )
        : ok(posts(false)),
    );

    const rows = await run();

    expect(rows.map((r) => r.href)).toEqual(["/post/wpis-1", "/post/wpis-2", "/post/wpis-3"]);
    const [embedded, plain, ...rest] = db().chainsFor("posts");
    expect(rest).toHaveLength(0);
    expect(selectOf(embedded)).toBe(RATED_LIST_POST_COLUMNS);
    expect(selectOf(plain)).toBe(RATED_LIST_POST_PLAIN_COLUMNS);
    // Poza `select` zapas to TO SAMO zapytanie: filtry, sortowanie, okno.
    expect(plain?.calls.slice(1)).toEqual(embedded?.calls.slice(1));
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
