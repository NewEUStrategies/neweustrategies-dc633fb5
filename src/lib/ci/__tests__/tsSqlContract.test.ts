// Kontrakt TypeScript <-> SQL (`tsSqlContract.ts`): ekstrakcja faktów szwu
// z kodu TS i render testu pgTAP.
//
// Scenariusze wiodące to defekty, które przeszły przez 98,84% pokrycia, bo testy
// TS mają atrapę bazy, a pgTAP nie widzi wywołań TS:
//   * `onConflict: "user_id,role"` przy kluczu (tenant_id, user_id, role),
//   * literał zapisywany do kolumny z białą listą CHECK,
//   * GRANT szerszy niż kod (RPC wołane tylko rolą serwisową, kolumna
//     prywatna czytelna dla anona),
//   * klucz tożsamości z ładunku jsonb.
// Tu sprawdzamy, że ekstraktor WIDZI te fakty w kodzie i że render niesie je
// do SQL; prawdziwą decyzję podejmuje katalog Postgresa w jobie `pgtap`.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import * as postHrefModule from "@/lib/routing/postHref";
import { POST_PARENT_PAGE_EMBED, postColumnsWithParentPage } from "@/lib/routing/postHref";
import * as postParentPageReadModule from "@/lib/routing/postParentPageRead";
import {
  COLUMN_FLOW_MAX_DEPTH,
  MAX_UNRESOLVED_SITES,
  POST_PARENT_PAGE_READ,
  UNCHECKED_SELECTS_REVIEWED,
  extractSeamFacts,
  parseSelectColumns,
  renderContractTest,
  seamCoverageProblems,
  uncheckedSelectDrift,
  withPostParentPageEmbed,
  type PublicColumnContract,
} from "../tsSqlContract";
import { loadProductionSources } from "../../../../scripts/lib/onConflictArbitersInputs";

const NO_CONTRACTS: readonly PublicColumnContract[] = [];

function facts(files: Record<string, string>, contracts = NO_CONTRACTS) {
  return extractSeamFacts(
    Object.entries(files).map(([file, code]) => ({ file, code })),
    contracts,
  );
}

describe("parseSelectColumns", () => {
  it("kolumny najwyższego poziomu: alias, rzutowanie, ścieżka json", () => {
    expect(parseSelectColumns("id, name:label, amount::text, meta->>kind, created_at")).toEqual({
      columns: ["amount", "created_at", "id", "label", "meta"],
      star: false,
    });
  });

  it("zasoby osadzone i rozkłady to INNE relacje - pomijane", () => {
    expect(
      parseSelectColumns(
        "*, slot:ad_slots!inner(id, notes), author:profiles(display_name), ...rel(x)",
      ),
    ).toEqual({ columns: [], star: true });
  });
});

describe("extractSeamFacts - RPC", () => {
  it("nazwa, klucze argumentów i rola klienta", () => {
    const f = facts({
      "src/a.server.ts": `
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        await supabaseAdmin.rpc("validate_b2b_coupon_for_user", { _tenant_id: t, _user_id: u, _code: c });
      `,
      "src/b.tsx": `
        import { supabase } from "@/integrations/supabase/client";
        await supabase.rpc("run_event_reminders");
      `,
      "src/c.functions.ts": `
        export const f = createServerFn().middleware([requireSupabaseAuth]).handler(async ({ context }) => {
          await context.supabase.rpc("admin_get_user", { _user_id: id });
        });
      `,
      "src/d.ts": `export async function helper(client) { await client.rpc("x_fn", { p: 1 }); }`,
    });
    expect(f.rpcs).toEqual([
      {
        name: "validate_b2b_coupon_for_user",
        keys: ["_code", "_tenant_id", "_user_id"],
        role: "service_role",
        file: "src/a.server.ts",
      },
      { name: "run_event_reminders", keys: [], role: "authenticated", file: "src/b.tsx" },
      {
        name: "admin_get_user",
        keys: ["_user_id"],
        role: "authenticated",
        file: "src/c.functions.ts",
      },
      { name: "x_fn", keys: ["p"], role: "unknown", file: "src/d.ts" },
    ]);
  });

  it("alias roli serwisowej i stała z nazwą funkcji", () => {
    const f = facts({
      "src/a.server.ts": `
        const FN = "verify_content_password_for_tenant";
        const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
        await admin.rpc(FN, { _tenant_id: t });
      `,
    });
    expect(f.rpcs[0]).toMatchObject({
      name: "verify_content_password_for_tenant",
      role: "service_role",
    });
  });

  it("rozkład w argumentach = klucze nieznane (sprawdzamy samą nazwę)", () => {
    const f = facts({ "src/a.ts": `supabase.rpc("fn_x", { ...base, p_a: 1 })` });
    expect(f.rpcs[0].keys).toBeNull();
  });

  it("nazwa obliczona trafia do listy miejsc nieczytelnych", () => {
    const f = facts({ "src/a.ts": `supabase.rpc(fnName)` });
    expect(f.rpcs).toEqual([]);
    expect(f.coverage.unresolvedSites).toEqual(["src/a.ts: .rpc(fnName)"]);
  });
});

describe("extractSeamFacts - tabele", () => {
  it("N-19-1: cel onConflict ze stałej pliku idzie do faktów", () => {
    const f = facts({
      "src/lib/admin/invitations.functions.ts": `
        const USER_ROLES_CONFLICT_TARGET = "user_id,role";
        await supabaseAdmin.from("user_roles")
          .upsert({ user_id: u, role: r, tenant_id: t }, { onConflict: USER_ROLES_CONFLICT_TARGET, ignoreDuplicates: true });
      `,
    });
    expect(f.conflicts).toEqual([
      {
        table: "user_roles",
        columns: ["role", "user_id"],
        file: "src/lib/admin/invitations.functions.ts",
      },
    ]);
    expect(f.tables).toEqual([
      {
        table: "user_roles",
        op: "upsert_ignore",
        columns: ["role", "tenant_id", "user_id"],
        star: false,
        role: "service_role",
        file: "src/lib/admin/invitations.functions.ts",
      },
    ]);
  });

  it("literał zapisywany do kolumny (klasa N-16-1) - także przez stałą z importu", () => {
    const f = facts({
      "src/lib/consts.ts": `export const ARCHIVED = "archived";`,
      "src/b.tsx": `
        import { supabase } from "@/integrations/supabase/client";
        import { ARCHIVED } from "@/lib/consts";
        await supabase.from("b2b_coupon_campaigns").update({ status: ARCHIVED, note: someVar }).eq("id", id);
        await supabase.from("events").insert([{ status: "draft" }, { status: "published" }]);
      `,
    });
    expect(f.literals.map((l) => `${l.table}.${l.column}=${l.value}`)).toEqual([
      "b2b_coupon_campaigns.status=archived",
      "events.status=draft",
      "events.status=published",
    ]);
  });

  it("select, RETURNING po insert, delete i head:true", () => {
    const f = facts({
      "src/a.tsx": `
        import { supabase } from "@/integrations/supabase/client";
        await supabase.from("ad_slots").select("*").order("name");
        await supabase.from("payment_orders").insert(row).select("id, tenant_id").single();
        await supabase.from("conversations").delete().eq("id", id);
        await supabase.from("ad_events").select("*", { count: "exact", head: true });
      `,
    });
    expect(f.tables.map((t) => [t.table, t.op, t.columns.join(","), t.star])).toEqual([
      ["ad_slots", "select", "", true],
      ["payment_orders", "select", "id,tenant_id", false],
      ["conversations", "delete", "", false],
    ]);
  });

  it("kubełek Storage, inny schemat i Array.from to nie tabele public", () => {
    const f = facts({
      "src/a.ts": `
        await supabase.storage.from("avatars").upload(p, b);
        await supabase.schema("audit").from("events").select("id");
        const xs = Array.from("abc").map((c) => c);
      `,
    });
    expect(f.tables).toEqual([]);
    expect(f.coverage.tableChains).toBe(0);
  });
});

describe("extractSeamFacts - readPostsWithParentPage", () => {
  // Moduły pomocnika w wersji minimalnej: import musi się rozwiązać do JEGO
  // modułu, a osadzenie - do stałej, której pomocnik używa (prawdziwa wartość).
  const HELPER_MODULES = {
    [POST_PARENT_PAGE_READ.module]: `export function readPostsWithParentPage(read, plain) {}`,
    [POST_PARENT_PAGE_READ.embedModule]: `export const POST_PARENT_PAGE_EMBED = ${JSON.stringify(POST_PARENT_PAGE_EMBED)};`,
  };
  const HEADER = `
    import { supabase } from "@/integrations/supabase/client";
    import { readPostsWithParentPage } from "@/lib/routing/postParentPageRead";
  `;

  function postFacts(code: string, extra: Record<string, string> = {}) {
    const f = facts({ ...HELPER_MODULES, ...extra, "src/lib/q.ts": HEADER + code });
    return { f, posts: f.tables.filter((t) => t.table === "posts") };
  }

  /** Oba warianty pomocnika: z osadzeniem i zapasowy - te same kolumny `posts`. */
  function bothVariants(columns: string[]) {
    const site = {
      table: "posts",
      op: "select",
      columns,
      star: false,
      role: "authenticated",
      file: "src/lib/q.ts",
    };
    return [site, site];
  }

  it("strzałka wprost: fakty z drugiego argumentu, także z opcjami `select`", () => {
    const { f, posts } = postFacts(`
      const COLS = "id, slug, title_pl";
      await readPostsWithParentPage(
        (columns: string) =>
          supabase.from("posts").select(columns, { count: "exact" }).eq("status", "published"),
        COLS,
      );
    `);
    expect(posts).toEqual(bothVariants(["id", "slug", "title_pl"]));
    expect(f.coverage.unresolvedSites).toEqual([]);
  });

  it("strzałka przez stałą (w funkcji, z argumentem typu) i literał w drugim argumencie", () => {
    const { posts } = postFacts(`
      export async function load(limit: number) {
        const read = (columns: string) =>
          supabase.from("posts").select(columns).order("published_at").limit(limit);
        return readPostsWithParentPage<unknown>(read, "id, slug, cover_image_url");
      }
    `);
    expect(posts).toEqual(bothVariants(["cover_image_url", "id", "slug"]));
  });

  it("deklaracja funkcji, drugi argument ze stałą z importu w szablonie", () => {
    const { posts } = postFacts(
      `
      import { SPONSORED_LIST_COLS } from "@/lib/content/sponsored";
      function read(columns: string) {
        return supabase.from("posts").select(columns).is("deleted_at", null);
      }
      await readPostsWithParentPage(read, \`id, slug, \${SPONSORED_LIST_COLS}\`);
    `,
      { "src/lib/content/sponsored.ts": `export const SPONSORED_LIST_COLS = "is_sponsored";` },
    );
    expect(posts).toEqual(bothVariants(["id", "is_sponsored", "slug"]));
  });

  it("drugi argument nie do ustalenia: brak faktu, miejsce na liście nieczytelnych", () => {
    const { f, posts } = postFacts(`
      await readPostsWithParentPage(
        (columns: string) => supabase.from("posts").select(columns),
        pickColumns(lang),
      );
    `);
    expect(posts).toEqual([]);
    expect(f.coverage.unresolvedSites).toEqual([
      "src/lib/q.ts: .select(columns) <- readPostsWithParentPage(…, pickColumns(lang))",
    ]);
  });

  it("parametr niczego nie przesłania: `select` czyta inną nazwę - reguła milczy", () => {
    const { f, posts } = postFacts(`
      const OTHER = "id, title_en";
      let columns = await loadColumns();
      await readPostsWithParentPage((cols: string) => supabase.from("posts").select(columns), "id, slug");
      await readPostsWithParentPage((cols: string) => supabase.from("posts").select(OTHER), "id, slug");
    `);
    // Pierwszy odczyt: zmienna spoza funkcji, nic statycznego. Drugi: stała
    // modułu jak dotąd - kolumny pomocnika (`id, slug`) nie są tu przypisywane.
    expect(posts.map((t) => t.columns)).toEqual([["id", "title_en"]]);
    expect(f.coverage.unresolvedSites).toEqual([]);
  });

  it("parametr przesłaniający stałą modułu: wygrywa wartość od pomocnika", () => {
    const { posts } = postFacts(`
      const columns = "id";
      await readPostsWithParentPage((columns: string) => supabase.from("posts").select(columns), "id, slug");
    `);
    expect(posts).toEqual(bothVariants(["id", "slug"]));
  });

  it("parametryzowany select z cudzym pomocnikiem albo odwróconymi argumentami - bez faktu", () => {
    // Wywołanie `read("id, slug")` wprost daje fakt z reguły przepływu kolumn
    // przez parametr (osobny opis niżej); tu tylko pomocnik, który nim nie jest.
    const { f, posts } = postFacts(
      `
      import { readPostsWithParentPage as foreign } from "@/lib/other";
      const read = (columns: string) => supabase.from("posts").select(columns);
      await otherHelper(read, "id, slug");
      await otherHelper((columns: string) => supabase.from("posts").select(columns), "id, slug");
      await readPostsWithParentPage("id, slug", (columns: string) => supabase.from("posts").select(columns));
      await foreign((columns: string) => supabase.from("posts").select(columns), "id, slug");
    `,
      { "src/lib/other.ts": `export function readPostsWithParentPage() {}` },
    );
    expect(posts).toEqual([]);
    expect(f.coverage.unresolvedSites).toEqual([]);
  });

  it("parametr przypisany albo w zagnieżdżonej funkcji - poza regułą", () => {
    // Parametr przekazany DALEJ (`postsQuery(columns)`) ma fakty z reguły
    // przepływu kolumn - test w jej opisie niżej.
    const { posts } = postFacts(`
      await readPostsWithParentPage((columns: string) => {
        columns = columns + ", body";
        return supabase.from("posts").select(columns);
      }, "id, slug");
      await readPostsWithParentPage(
        (columns: string) => cache(() => supabase.from("posts").select(columns)),
        "id, slug",
      );
      const read = (columns: string) => supabase.from("posts").select(columns);
      { const read = other; await readPostsWithParentPage(read, "id, slug"); }
    `);
    expect(posts).toEqual([]);
  });

  it("parametr przesłonięty WEWNĄTRZ funkcji (blok, `catch`) - brak faktu, a nie fałszywy fakt", () => {
    // Bez sprawdzenia, że nazwa parametru jest w funkcji wiązana tylko raz,
    // reguła przypisałaby `.select(columns)` kolumny od pomocnika, choć
    // zapytanie wysyła wartość wiązaną bliżej - fakt ukryłby kolumnę, którą
    // zapytanie naprawdę czyta.
    const { posts } = postFacts(`
      await readPostsWithParentPage((columns: string) => {
        { const columns = "id, body_secret"; return supabase.from("posts").select(columns); }
      }, "id, slug");
      await readPostsWithParentPage((columns: string) => {
        try { return load(); } catch (columns) { return supabase.from("posts").select(columns); }
      }, "id, slug");
    `);
    expect(posts).toEqual([]);
  });

  it("strzałka w nawiasach albo z `as` - nadal oddana pomocnikowi, fakty są", () => {
    const { posts } = postFacts(`
      type Read = (columns: string) => unknown;
      await readPostsWithParentPage(((columns: string) => supabase.from("posts").select(columns)), "id");
      await readPostsWithParentPage(((columns: string) => supabase.from("posts").select(columns)) as Read, "slug");
    `);
    expect(posts.map((p) => p.columns)).toEqual([["id"], ["id"], ["slug"], ["slug"]]);
  });

  it("inny eksport modułu pomocnika (`readWithPostParentPage`) to nie ten kształt - brak faktu", () => {
    const { posts } = postFacts(
      `
      import { readWithPostParentPage } from "@/lib/routing/postParentPageRead";
      await readWithPostParentPage((columns: string) => supabase.from("posts").select(columns), "id, slug");
    `,
      {
        [POST_PARENT_PAGE_READ.module]:
          HELPER_MODULES[POST_PARENT_PAGE_READ.module] +
          "\nexport function readWithPostParentPage(a, b) {}",
      },
    );
    expect(posts).toEqual([]);
  });

  it("funkcja w `let` - poza regułą (wiązanie może zmienić wartość), brak faktu", () => {
    const { posts } = postFacts(`
      let read = (columns: string) => supabase.from("posts").select(columns);
      await readPostsWithParentPage(read, "id, slug");
    `);
    expect(posts).toEqual([]);
  });

  it("osadzenie nieczytelne: wariant zapasowy zostaje, brak osadzenia widać na liście", () => {
    const f = facts({
      [POST_PARENT_PAGE_READ.module]: HELPER_MODULES[POST_PARENT_PAGE_READ.module],
      "src/lib/q.ts": `${HEADER}
        await readPostsWithParentPage((columns: string) => supabase.from("posts").select(columns), "id");
      `,
    });
    expect(f.tables.map((t) => [t.table, t.columns])).toEqual([["posts", ["id"]]]);
    expect(f.coverage.unresolvedSites).toEqual([
      "src/lib/q.ts: .select(columns) <- readPostsWithParentPage: POST_PARENT_PAGE_EMBED (src/lib/routing/postHref.ts) nieczytelne",
    ]);
  });

  it("wariant z osadzeniem to dokładnie napis `postColumnsWithParentPage`", () => {
    const plain = "id, slug, title_pl";
    expect(withPostParentPageEmbed(plain, POST_PARENT_PAGE_EMBED)).toBe(
      postColumnsWithParentPage(plain),
    );
  });

  it("nazwy w regule wskazują prawdziwy pomocnik i prawdziwą stałą osadzenia", () => {
    expect(
      typeof (postParentPageReadModule as Record<string, unknown>)[POST_PARENT_PAGE_READ.helper],
    ).toBe("function");
    expect((postHrefModule as Record<string, unknown>)[POST_PARENT_PAGE_READ.embedConstant]).toBe(
      POST_PARENT_PAGE_EMBED,
    );
  });
});

describe("extractSeamFacts - kolumny przekazywane parametrem", () => {
  // `.select(x)`, gdzie `x` zależy od parametru funkcji, a kolumny podaje
  // wołający - także z innego pliku i przez kilka funkcji pośrednich.
  const HELPER_MODULES = {
    [POST_PARENT_PAGE_READ.module]: `export function readPostsWithParentPage(read, plain) {}`,
    [POST_PARENT_PAGE_READ.embedModule]: `export const POST_PARENT_PAGE_EMBED = ${JSON.stringify(POST_PARENT_PAGE_EMBED)};`,
  };
  const HEADER = `
    import { supabase } from "@/integrations/supabase/client";
    import { readPostsWithParentPage } from "@/lib/routing/postParentPageRead";
  `;

  function flowFacts(files: Record<string, string>) {
    const withHeader = Object.fromEntries(
      Object.entries(files).map(([file, code]) => [file, HEADER + code]),
    );
    const f = facts({ ...HELPER_MODULES, ...withHeader });
    const posts = f.tables.filter((t) => t.table === "posts");
    return { f, posts, cols: posts.map((t) => `${t.file}=${t.columns.join(",")}`) };
  }

  function site(columns: string[], file = "src/lib/q.ts") {
    return { table: "posts", op: "select", columns, star: false, role: "authenticated", file };
  }

  it("funkcja pośrednia w tym samym pliku (kształt `blocks.ts`): oba warianty pomocnika", () => {
    const { f, posts } = flowFacts({
      "src/lib/q.ts": `
        function postsQuery(narrowing: unknown, columns: string) {
          return narrowing === null ? supabase.from("posts").select(columns) : other(columns);
        }
        await readPostsWithParentPage((columns: string) => refine(postsQuery(n, columns)), "id, slug");
      `,
    });
    expect(posts).toEqual([site(["id", "slug"]), site(["id", "slug"])]);
    expect(f.coverage.unresolvedSites).toEqual([]);
  });

  it("prawdziwy `taxonomyPivot.ts` przez import: osadzenia z jego stałych, kolumny z pliku wołającego", () => {
    const { f, posts } = flowFacts({
      "src/lib/queries/taxonomyPivot.ts": readFileSync("src/lib/queries/taxonomyPivot.ts", "utf8"),
      "src/lib/q.ts": `
        import { postsConstrainedByTaxonomy, postsNarrowedToTaxonomy } from "@/lib/queries/taxonomyPivot";
        const ARCHIVE_COLS = "id, author_id";
        export async function load(id: string, constraints: unknown[]) {
          const read = (columns: string) =>
            postsNarrowedToTaxonomy(columns, { kind: "category", termIds: [id] }).limit(3);
          await readPostsWithParentPage(read, "id, slug, title_pl");
          await postsNarrowedToTaxonomy(ARCHIVE_COLS, { kind: "tag", termIds: [id] }, { count: "exact" });
          await readPostsWithParentPage(
            (columns: string) => postsConstrainedByTaxonomy(columns, constraints).eq("status", "published"),
            "id, post_format",
          );
        }
      `,
    });
    const read = site(["id", "slug", "title_pl"]);
    const archive = site(["author_id", "id"]);
    const constrained = site(["id", "post_format"]);
    // Dwa `select` zawężenia (kategoria, tag) x trzy wartości kolumn, potem
    // jeden `select` warunków x dwa warianty pomocnika.
    expect(posts).toEqual([read, read, archive, read, read, archive, constrained, constrained]);
    // Osadzenia tabel pośrednich (`${CATEGORY_PIVOT_EMBED}`, `[cols, ...].join`)
    // rozwiązane - inaczej miejsce trafiłoby tutaj.
    expect(f.coverage.unresolvedSites).toEqual([]);
  });

  it("osadzenie spoza stałej (wartość czasu działania obok kolumn) - miejsce nieczytelne, nie cichy fakt", () => {
    const { f, posts } = flowFacts({
      "src/lib/h.ts": `
        const EMBED = pickEmbed();
        export function narrowed(cols: string) {
          return supabase.from("posts").select(\`\${cols}, \${EMBED}\`);
        }
      `,
      "src/lib/q.ts": `
        import { narrowed } from "@/lib/h";
        await narrowed("id");
      `,
    });
    expect(posts).toEqual([site(["id"])]);
    expect(f.coverage.unresolvedSites).toEqual([
      "src/lib/h.ts: .select(`${cols}, ${EMBED}`) <- src/lib/q.ts: kolumna z wartości czasu działania",
    ]);
  });

  it("`[cols, ...xs.map(cb)].join`: element z nawiasem to zasób osadzony; inny element - miejsce nieczytelne", () => {
    const { f, cols } = flowFacts({
      "src/lib/h.ts": `
        export function constrained(cols: string, xs: X[]) {
          const select = [cols, ...xs.map(({ alias, table }) => \`\${alias}:\${table}!inner()\`)].join(", ");
          return supabase.from("posts").select(select as "x");
        }
        export function leaky(cols: string, xs: X[]) {
          const select = [cols, ...xs.map((x) => \`\${x.column}\`)].join(", ");
          return supabase.from("posts").select(select);
        }
        export function spread(cols: string, extra: string[]) {
          return supabase.from("posts").select([cols, ...extra].join(", "));
        }
      `,
      "src/lib/q.ts": `
        import { constrained, leaky, spread } from "@/lib/h";
        await constrained("id, slug", xs);
        await leaky("id", xs);
        await spread("title_pl", extra);
      `,
    });
    expect(cols).toEqual(["src/lib/q.ts=id,slug", "src/lib/q.ts=id", "src/lib/q.ts=title_pl"]);
    // Lista jest posortowana: rozkład bez `map`, potem element bez nawiasu.
    expect(f.coverage.unresolvedSites).toEqual([
      'src/lib/h.ts: .select([cols, ...extra].join(", ")) <- src/lib/q.ts: kolumna z wartości czasu działania',
      "src/lib/h.ts: .select(select) <- src/lib/q.ts: kolumna z wartości czasu działania",
    ]);
  });

  it("budowniczy w stałej (`const base = supabase.from(...)`): łańcuch każdego użycia", () => {
    const { f, cols } = flowFacts({
      "src/lib/q.ts": `
        export function q(cond: boolean) {
          const base = supabase.from("posts");
          return cond ? base.select("id").eq("x", 1) : (base as Builder).select("slug");
        }
        let later = supabase.from("posts");
        later.select("title_pl");
      `,
    });
    // `let` może wskazać inny budowniczy - bez faktu i bez łańcucha.
    expect(cols).toEqual(["src/lib/q.ts=id", "src/lib/q.ts=slug"]);
    expect(f.coverage.tableChains).toBe(1);
  });

  it("budowniczy w stałej przesłoniętej gdzie indziej w bloku - bez faktu, a nie cudza lista kolumn", () => {
    const { cols } = flowFacts({
      "src/lib/q.ts": `
        const base = supabase.from("posts");
        function f() { const base = other(); return base.select("secret"); }
        await base.select("id");
      `,
    });
    expect(cols).toEqual([]);
  });

  it("wywołanie wprost (także z aliasem importu) i stała `const` wołającego", () => {
    const { f, cols } = flowFacts({
      "src/lib/h.ts": `
        export function postsBy(cols: string) { return supabase.from("posts").select(cols); }
        export const postsByArrow = (cols: string) => supabase.from("posts").select(cols, { count: "exact" });
      `,
      "src/lib/q.ts": `
        import { postsBy as load, postsByArrow } from "@/lib/h";
        await load("id, slug");
        export function g() { const LOCAL = "title_en"; return postsByArrow(LOCAL); }
      `,
    });
    expect(cols).toEqual(["src/lib/q.ts=id,slug", "src/lib/q.ts=title_en"]);
    expect(f.coverage.unresolvedSites).toEqual([]);
  });

  it("parametr przypisany albo z wartością domyślną - bez faktu", () => {
    const { cols } = flowFacts({
      "src/lib/q.ts": `
        function assigned(cols: string) { cols = cols + ", secret"; return supabase.from("posts").select(cols); }
        function defaulted(cols = "secret") { return supabase.from("posts").select(cols); }
        await assigned("id");
        await defaulted("slug");
      `,
    });
    expect(cols).toEqual([]);
  });

  it("nazwa funkcji przesłonięta u wołającego (import, blok tego pliku) - wywołanie się nie liczy", () => {
    const { cols } = flowFacts({
      "src/lib/h.ts": `export function postsBy(cols: string) { return supabase.from("posts").select(cols); }`,
      "src/lib/q.ts": `
        import { postsBy } from "@/lib/h";
        function g() { const postsBy = (x: string) => x; return postsBy("secret"); }
        function local(cols: string) { return supabase.from("posts").select(cols); }
        { function local(x: string) { return x; } local("secret"); }
      `,
    });
    expect(cols).toEqual([]);
  });

  it("wywołanie z rozkładem, bez argumentu albo z funkcją nieeksportowaną - pomijane", () => {
    const { f, cols } = flowFacts({
      "src/lib/h.ts": `function hidden(cols: string) { return supabase.from("posts").select(cols); }`,
      "src/lib/q.ts": `
        import { hidden } from "@/lib/h";
        function q(cols: string) { return supabase.from("posts").select(cols); }
        await q(...args);
        await q();
        await hidden("secret");
      `,
    });
    expect(cols).toEqual([]);
    expect(f.coverage.unresolvedSites).toEqual([]);
  });

  it("stała lokalna albo parametr funkcji zewnętrznej przesłania stałą modułu - nie wartość z modułu", () => {
    // Obie wartości znane dopiero w czasie działania: brak faktu i jedno
    // miejsce nieczytelne (ten sam `select`, ten sam plik literału).
    const { f, cols } = flowFacts({
      "src/lib/q.ts": `
        const COLS = "secret";
        function q(cols: string) { return supabase.from("posts").select(cols); }
        export function g() { const COLS = pickColumns(); return q(COLS); }
        export function outer(COLS: string) { return [1].map(() => q(COLS)); }
      `,
    });
    expect(cols).toEqual([]);
    expect(f.coverage.unresolvedSites).toEqual([
      "src/lib/q.ts: .select(cols) <- src/lib/q.ts: kolumna z wartości czasu działania",
    ]);
  });

  it("parametr przesłania stałą modułu o tej samej nazwie - wartość od wołającego", () => {
    const { cols } = flowFacts({
      "src/lib/q.ts": `
        const cols = "secret";
        function q(cols: string) { return supabase.from("posts").select(cols); }
        await q("id");
      `,
    });
    expect(cols).toEqual(["src/lib/q.ts=id"]);
  });

  it("`const` w bloku nieobejmującym użycia, `let` albo dwa parametry w szablonie - reguła milczy", () => {
    const { f, cols } = flowFacts({
      "src/lib/q.ts": `
        function scoped(cols: string) {
          if (flag) { const sel = \`\${cols}, a\`; }
          return supabase.from("posts").select(sel);
        }
        function mutable(cols: string) { let sel = cols; return supabase.from("posts").select(sel); }
        function two(a: string, b: string) { return supabase.from("posts").select(\`\${a}, \${b}\`); }
        await scoped("id");
        await mutable("id");
        await two("id", "slug");
      `,
    });
    expect(cols).toEqual([]);
    expect(f.coverage.unresolvedSites).toEqual([]);
  });

  it(`najwyżej ${COLUMN_FLOW_MAX_DEPTH} skoki wywołań; dłuższy przepływ - miejsce nieczytelne`, () => {
    const chain = (prefix: string, hops: number) =>
      Array.from({ length: hops }, (_, i) =>
        i === 0
          ? `function ${prefix}0(cols: string) { return supabase.from("posts").select(cols); }`
          : `function ${prefix}${i}(cols: string) { return ${prefix}${i - 1}(cols); }`,
      ).join("\n") + `\nawait ${prefix}${hops - 1}("${prefix}_col");`;
    const { f, cols } = flowFacts({
      "src/lib/q.ts": `${chain("ok", COLUMN_FLOW_MAX_DEPTH)}\n${chain("far", COLUMN_FLOW_MAX_DEPTH + 1)}`,
    });
    expect(cols).toEqual(["src/lib/q.ts=ok_col"]);
    expect(f.coverage.unresolvedSites).toHaveLength(1);
    expect(f.coverage.unresolvedSites[0]).toMatch(/^src\/lib\/q\.ts:\d+: przepływ kolumn dłuższy/);
    // Miejsce zgłoszone - `select` nie jest też „niesprawdzony po cichu".
    expect(f.coverage.uncheckedSelects).toEqual([]);
  });

  it("wywołania wzajemne (cykl) - przebieg się kończy, fakt z wywołania z literałem", () => {
    const { cols } = flowFacts({
      "src/lib/q.ts": `
        function a(c: string) { return c ? supabase.from("posts").select(c) : b(c); }
        function b(c: string) { return a(c); }
        await a("id");
      `,
    });
    expect(cols).toEqual(["src/lib/q.ts=id"]);
  });
});

describe("extractSeamFacts - `select` bez faktu i bez miejsca nieczytelnego", () => {
  const HEADER = `import { supabase } from "@/integrations/supabase/client";\n`;

  it("stała lokalna funkcji, `X.join`, warunek, właściwość obiektu - na liście; literał, stała modułu, zgłoszone miejsce - nie", () => {
    const f = facts({
      "src/lib/q.ts": `${HEADER}
        const MODULE_COLS = "id, slug";
        const COLS_LIST = ["id", "slug"] as const;
        const ENTITY = { post: "id, slug" };
        export async function load(flag: boolean, name: string) {
          const LOCAL = "id, slug";
          await supabase.from("posts").select(LOCAL);
          await supabase.from("posts").select(COLS_LIST.join(", "));
          await supabase.from("posts").select(flag ? "id" : "slug");
          await supabase.from("posts").select(ENTITY.post);
          await supabase.from("posts").select("id, title_pl");
          await supabase.from("posts").select(MODULE_COLS);
          await supabase.from("posts").select("id", { count: "exact", head: true });
          await supabase.from(name).select(LOCAL);
        }
      `,
    });
    expect(f.tables.map((t) => `${t.table}:${t.columns.join(",")}`)).toEqual([
      "posts:id,title_pl",
      "posts:id,slug",
    ]);
    // Tabela z nazwą obliczoną jest już w `unresolvedSites` - nie dubluje się.
    expect(f.coverage.unresolvedSites).toEqual(["src/lib/q.ts: .from(name)"]);
    expect(f.coverage.uncheckedSelects).toEqual([
      'src/lib/q.ts: .select(COLS_LIST.join(", "))',
      "src/lib/q.ts: .select(ENTITY.post)",
      "src/lib/q.ts: .select(LOCAL)",
      'src/lib/q.ts: .select(flag ? "id" : "slug")',
    ]);
  });

  it("zapadka: miejsce nowe albo liczniejsze niż w przeglądzie czerwieni bramkę; naprawione - `stale`", () => {
    const f = facts({
      "src/lib/q.ts": `${HEADER}
        export async function a() { const C = "id"; return supabase.from("posts").select(C); }
        export async function b() { const C = "slug"; return supabase.from("posts").select(C); }
      `,
    });
    const site = "src/lib/q.ts: .select(C)";
    expect(uncheckedSelectDrift(f, { [site]: [2, "powód"] })).toEqual({ fresh: [], stale: [] });
    expect(seamCoverageProblems(f, { [site]: [2, "powód"] })).toEqual([]);
    expect(uncheckedSelectDrift(f, { [site]: [1, "powód"] }).fresh).toEqual([
      `${site} (2, przejrzanych: 1)`,
    ]);
    expect(seamCoverageProblems(f, {})[0]).toContain(`${site} (2, przejrzanych: 0)`);
    expect(
      uncheckedSelectDrift(f, { [site]: [3, "powód"], "src/x.ts: .select(Y)": [1, "p"] }),
    ).toEqual({
      fresh: [],
      stale: [`${site} (2, przejrzanych: 3)`, "src/x.ts: .select(Y) (0, przejrzanych: 1)"],
    });
  });
});

describe("extractSeamFacts - kolumny publiczne", () => {
  const contract: PublicColumnContract = {
    table: "ad_slots",
    file: "src/lib/ads/types.ts",
    constant: "PUBLIC_AD_SLOT_COLUMNS",
    roles: ["anon", "authenticated"],
  };

  it("odczytuje stałą TS jako listę kolumn", () => {
    const f = facts(
      { "src/lib/ads/types.ts": `export const PUBLIC_AD_SLOT_COLUMNS = "id, name, html";` },
      [contract],
    );
    expect(f.publicColumns[0].columns).toEqual(["html", "id", "name"]);
    expect(seamCoverageProblems(f)).toEqual([]);
  });

  it("brak stałej albo `*` to problem zasięgu - kontrakt kolumn nie może zniknąć po cichu", () => {
    const f = facts({ "src/lib/ads/types.ts": `export const PUBLIC_AD_SLOT_COLUMNS = "*";` }, [
      contract,
    ]);
    expect(f.publicColumns[0].columns).toBeNull();
    expect(seamCoverageProblems(f)[0]).toContain("PUBLIC_AD_SLOT_COLUMNS");
  });
});

describe("renderContractTest", () => {
  const sample = facts({
    "src/lib/admin/invitations.functions.ts": `
      await supabaseAdmin.from("user_roles").upsert(row, { onConflict: "user_id,role" });
      await supabaseAdmin.rpc("join_us_link_and_backfill", { _user_id: u });
    `,
    "src/b.tsx": `
      import { supabase } from "@/integrations/supabase/client";
      await supabase.from("b2b_coupon_campaigns").update({ status: "it's" }).eq("id", id);
    `,
  });

  it("niesie fakty do tabel tymczasowych testu (z cytowaniem apostrofu)", () => {
    const sql = renderContractTest(sample);
    expect(sql).toContain(
      "('user_roles', ARRAY['role', 'user_id']::text[], 'src/lib/admin/invitations.functions.ts')",
    );
    expect(sql).toContain(
      "('join_us_link_and_backfill', ARRAY['_user_id']::text[], 'service_role', 'src/lib/admin/invitations.functions.ts')",
    );
    expect(sql).toContain("('b2b_coupon_campaigns', 'status', 'it''s', 'src/b.tsx')");
    expect(sql).toContain("SELECT plan(9);");
  });

  it("deterministyczny - kolejność plików wejścia nie zmienia wyniku", () => {
    const files = {
      "src/x.ts": `supabase.rpc("b_fn"); supabase.rpc("a_fn");`,
      "src/y.ts": `supabase.rpc("a_fn");`,
    };
    const forward = extractSeamFacts(
      Object.entries(files).map(([file, code]) => ({ file, code })),
      NO_CONTRACTS,
    );
    const backward = extractSeamFacts(
      Object.entries(files)
        .reverse()
        .map(([file, code]) => ({ file, code })),
      NO_CONTRACTS,
    );
    expect(renderContractTest(forward)).toBe(renderContractTest(backward));
  });

  it("wyjątki przejrzane trafiają do reguł jako jawna lista", () => {
    const sql = renderContractTest(sample, {
      payloadIdentity: { event_my_event_profile_set: "powód" },
      serverOnlyRpc: {},
    });
    expect(sql).toContain("f.proname <> ALL (ARRAY['event_my_event_profile_set']::text[])");
    expect(sql).toContain("p.proname <> ALL ('{}'::text[])");
  });
});

describe("stan repozytorium", () => {
  const repo = extractSeamFacts(loadProductionSources());

  it("ekstrakcja widzi naprawione szwy z tego wydania", () => {
    expect(repo.conflicts).toContainEqual({
      table: "user_roles",
      columns: ["role", "tenant_id", "user_id"],
      file: "src/lib/admin/invitations.functions.ts",
    });
    expect(
      repo.rpcs.filter((r) => r.name === "validate_b2b_coupon_for_user").map((r) => r.role),
    ).toEqual(["service_role"]);
    expect(repo.rpcs.filter((r) => r.name === "run_event_reminders").map((r) => r.role)).toEqual([
      "service_role",
      "service_role",
    ]);
    expect(repo.publicColumns.map((p) => [p.table, p.columns?.includes("notes")])).toEqual([
      ["ad_slots", false],
    ]);
  });

  it("odczyty przez readPostsWithParentPage z `.select(columns)` w funkcji pomocnika mają fakty", () => {
    // Po dwa odczyty w pliku, każdy w dwóch wariantach (z osadzeniem i zapasowy).
    for (const file of ["src/lib/menus/megaFeatured.ts", "src/lib/queries/public.ts"]) {
      const posts = repo.tables.filter(
        (t) => t.file === file && t.table === "posts" && t.op === "select",
      );
      expect(posts, file).toHaveLength(4);
      expect(new Set(posts.map((t) => `${t.role}:${t.columns.join(",")}`)).size, file).toBe(1);
      expect(posts[0].role).toBe("authenticated");
      expect(posts[0].columns).toEqual(expect.arrayContaining(["id", "slug", "published_at"]));
    }
    expect(
      repo.coverage.unresolvedSites.filter((s) => s.includes(POST_PARENT_PAGE_READ.helper)),
    ).toEqual([]);
  });

  it("odczyty przekazujące kolumny dalej (postsQuery, taxonomyPivot) mają fakty w pliku literału", () => {
    // Plik literału -> [liczba faktów `posts.select`, kolumny]. Odczyt przez
    // pomocnik ma dwa warianty, `postsNarrowedToTaxonomy` - dwa `select`
    // (kategoria, tag). `blocks.ts`: 2 + 4 z przepływu i 1 bezpośredni
    // `.select(POST_SELECT)` (sąsiad wpisu); `archives.ts`: 2 z przepływu.
    const expected: Record<string, readonly [number, string]> = {
      "src/lib/queries/megaMenu.ts": [4, "cover_image_url,id,published_at,slug,title_en,title_pl"],
      "src/lib/queries/blocks.ts": [
        7,
        "cover_image_url,excerpt_en,excerpt_pl,id,is_sponsored,parent_page_id,published_at,slug,sponsored_affiliate,sponsored_kind,title_en,title_pl",
      ],
      "src/lib/queries/archives.ts": [
        2,
        "author_id,cover_image_url,excerpt_en,excerpt_pl,id,is_sponsored,parent_page_id,published_at,slug,sponsored_affiliate,sponsored_kind,title_en,title_pl",
      ],
      "src/lib/builder/postListQuery.ts": [
        2,
        "author_id,cover_image_url,excerpt_en,excerpt_pl,id,is_sponsored,post_format,published_at,slug,sponsored_affiliate,sponsored_kind,title_en,title_pl",
      ],
      "src/lib/builder/ratedListQuery.ts": [
        2,
        "author_id,excerpt_en,excerpt_pl,id,post_format,published_at,slug,title_en,title_pl",
      ],
      "src/lib/builder/sliderPostsQuery.ts": [
        2,
        "author_id,cover_image_url,excerpt_en,excerpt_pl,id,published_at,slug,title_en,title_pl",
      ],
      "src/lib/builder/newsTickerQuery.ts": [2, "author_id,id,slug,title_en,title_pl"],
    };
    for (const [file, [count, columns]] of Object.entries(expected)) {
      const posts = repo.tables.filter(
        (t) =>
          t.file === file &&
          t.table === "posts" &&
          t.op === "select" &&
          t.role === "authenticated" &&
          t.columns.join(",") === columns,
      );
      expect(posts, file).toHaveLength(count);
    }
  });

  it("zasięg: bez problemów i w granicy zapadki nazw nieczytelnych", () => {
    expect(seamCoverageProblems(repo)).toEqual([]);
    expect(repo.coverage.unresolvedSites.length).toBeLessThanOrEqual(MAX_UNRESOLVED_SITES);
    // Gdy liczba spadnie, zapadka ma zejść razem z nią.
    expect(repo.coverage.unresolvedSites.length).toBe(MAX_UNRESOLVED_SITES);
  });

  it("`select` bez faktu i bez miejsca nieczytelnego to DOKŁADNIE przejrzana lista (nowy - czerwono; naprawiony - zdejmij z listy)", () => {
    expect(uncheckedSelectDrift(repo)).toEqual({ fresh: [], stale: [] });
    expect(repo.coverage.uncheckedSelects).toHaveLength(
      Object.values(UNCHECKED_SELECTS_REVIEWED).reduce((sum, [count]) => sum + count, 0),
    );
  });
});
