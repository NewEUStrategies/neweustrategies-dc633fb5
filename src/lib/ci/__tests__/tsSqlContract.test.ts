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
  LOOSE_CLIENT,
  LOOSE_TABLE,
  SEAM_FACTS_WITHHELD_REVIEWED,
  POST_PARENT_PAGE_READ,
  UNCHECKED_SELECTS_REVIEWED,
  extractSeamFacts,
  parseSelectColumns,
  renderContractTest,
  seamCoverageProblems,
  uncheckedSelectDrift,
  withPostParentPageEmbed,
  withheldKey,
  type PublicColumnContract,
  type WithheldFactReviewed,
} from "../tsSqlContract";
import { loadProductionSources } from "../../../../scripts/lib/onConflictArbitersInputs";

const NO_CONTRACTS: readonly PublicColumnContract[] = [];

function facts(
  files: Record<string, string>,
  contracts = NO_CONTRACTS,
  withheld: readonly WithheldFactReviewed[] = [],
) {
  return extractSeamFacts(
    Object.entries(files).map(([file, code]) => ({ file, code })),
    contracts,
    withheld,
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

  it("`looseClient(źródło)` wprost i przez `const`: rola jak źródło `looseTable`; nazwa z innego bloku, przesłonięta, `let` przypisany, parametr, obcy moduł - `unknown`", () => {
    const f = facts({
      "src/lib/supabase/looseQuery.ts":
        "export function looseClient() {}\nexport function looseTable() {}",
      "src/lib/crm-x.functions.ts": `
        import { looseClient } from "@/lib/supabase/looseQuery";
        export const a = createServerFn().handler(async ({ context }) => {
          await looseClient(context).rpc("crm_funnel_stats");
          const client = looseClient(context);
          await client.rpc("has_role", { _user_id: u, _role: "admin" });
        });
        export const b = createServerFn().handler(async () => {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const admin = looseClient({ supabase: supabaseAdmin });
          await admin.from("user_roles").select("user_id, role");
          await looseClient({ supabase: supabaseAdmin }).from("profiles").select("id");
        });
        export const c = createServerFn().handler(async ({ context }) => {
          const admin = looseClient(context);
          await admin.from("crm_leads").select("id");
        });
        export function d(client: { rpc(n: string): unknown }) {
          return client.rpc("x_param");
        }
        export const e = createServerFn().handler(async ({ context }) => {
          let moved = looseClient(context);
          moved = other;
          await moved.rpc("x_let");
          const shadow = looseClient(context);
          {
            const shadow = elsewhere;
            await shadow.rpc("x_shadow");
          }
          await shadow.rpc("x_shadowed_outer");
        });
        export const g = createServerFn().handler(async () => {
          await admin.rpc("x_out_of_block");
        });
      `,
      "src/lib/other.ts": `
        import { looseClient } from "@/lib/elsewhere";
        await looseClient(context).rpc("x_foreign");
      `,
    });
    expect(f.rpcs.map((r) => `${r.name}:${r.role}`)).toEqual([
      "crm_funnel_stats:authenticated",
      "has_role:authenticated",
      "x_param:unknown",
      "x_let:unknown",
      // Wiązanie przesłonięte w bloku wewnętrznym: oba użycia `unknown`
      // (reguła nie rozstrzyga zasięgów, tylko jedyne wiązanie w bloku).
      "x_shadow:unknown",
      "x_shadowed_outer:unknown",
      "x_out_of_block:unknown",
      "x_foreign:unknown",
    ]);
    expect(f.tables.map((t) => `${t.table}:${t.role}`)).toEqual([
      "user_roles:service_role",
      "profiles:service_role",
      "crm_leads:authenticated",
    ]);
  });

  it("`looseClient(param)` i `looseTable(param, t)` z parametrem innym niż kontekst - rola `unknown` (istnienie w pgTAP, uprawnienia nie)", () => {
    // Rola idzie z NAZWY źródła (`context`/`ctx`) albo z `{ supabase: X }`
    // rozpoznanego odbiorcy. Parametr o dowolnej innej nazwie może być
    // klientem użytkownika albo serwisowym - reguła nie zgaduje.
    const f = facts({
      "src/lib/supabase/looseQuery.ts":
        "export function looseClient() {}\nexport function looseTable() {}",
      "src/lib/crm-y.functions.ts": `
        import { looseClient, looseTable } from "@/lib/supabase/looseQuery";
        export async function viaParam(client: unknown, db: { supabase: unknown }) {
          await looseClient(client).rpc("x_client_param");
          await looseClient(db).rpc("x_db_param");
          await looseClient({ supabase: client }).rpc("x_wrapped_param");
          const bound = looseClient(client);
          await bound.rpc("x_bound_param");
          await looseTable(client, "crm_leads").select("id");
          await looseTable({ supabase: client }, "profiles").select("tenant_id");
          await looseClient(client).from("crm_companies").select("name");
        }
      `,
    });
    expect(f.rpcs.map((r) => `${r.name}:${r.role}`)).toEqual([
      "x_client_param:unknown",
      "x_db_param:unknown",
      "x_wrapped_param:unknown",
      "x_bound_param:unknown",
    ]);
    expect(f.tables.map((t) => `${t.table}:${t.op}:${t.role}:${t.columns.join(",")}`)).toEqual([
      "crm_leads:select:unknown:id",
      "profiles:select:unknown:tenant_id",
      "crm_companies:select:unknown:name",
    ]);
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
        later = other;
        later.select("title_pl");
        let neverReassigned = supabase.from("posts");
        neverReassigned.select("excerpt_pl");
      `,
    });
    // `let` przypisany na nowo może wskazać inny budowniczy - bez faktu
    // i bez łańcucha; `let` bez przypisania to ten sam budowniczy.
    expect(cols).toEqual(["src/lib/q.ts=id", "src/lib/q.ts=slug", "src/lib/q.ts=excerpt_pl"]);
    expect(f.coverage.tableChains).toBe(2);
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

  it("parametr rozkładany (`...cols`) - bez faktu, a nie fakt z samego pierwszego argumentu", () => {
    // `rest("id", "secret_col")` daje `cols = ["id", "secret_col"]`, czyli
    // `select("id,secret_col")`; pierwszy argument to tylko część listy.
    const { f, cols } = flowFacts({
      "src/lib/q.ts": `
        function rest(...cols: string[]) { return supabase.from("posts").select(\`\${cols}\`); }
        await rest("id", "secret_col");
      `,
    });
    expect(cols).toEqual([]);
    expect(f.coverage.unresolvedSites).toEqual([]);
    expect(f.coverage.uncheckedSelects).toEqual([
      "src/lib/q.ts: rest: .from(posts).select(`${cols}`)",
    ]);
  });

  it("nazwa funkcji przypisana na nowo (`F = inna`) - żadne wywołanie się nie liczy, także z importu", () => {
    // Po `postsBy = other` wywołanie `postsBy("...")` trafia do innej funkcji:
    // jego argument nie jest listą kolumn tego `select`.
    const { f, cols } = flowFacts({
      "src/lib/h.ts": `
        export function postsBy(cols: string) { return supabase.from("posts").select(cols); }
        postsBy = other;
        await postsBy("secret_col");
      `,
      "src/lib/q.ts": `
        import { postsBy } from "@/lib/h";
        await postsBy("secret_import");
      `,
    });
    expect(cols).toEqual([]);
    expect(f.coverage.unresolvedSites).toEqual([]);
    expect(f.coverage.uncheckedSelects).toEqual([
      "src/lib/h.ts: postsBy: .from(posts).select(cols)",
    ]);
  });

  it("separator `join` znany dopiero w czasie działania albo z parametru - reguła milczy, `select` na liście niesprawdzonych", () => {
    // Granice elementów listy zależą od separatora; bez jego wartości reguła
    // nie składa napisu (ani fakt, ani miejsce nieczytelne z przepływu).
    const { f, cols } = flowFacts({
      "src/lib/q.ts": `
        function runtimeSep(cols: string) { return supabase.from("posts").select([cols, "slug"].join(pickSep())); }
        function paramSep(cols: string, sep: string) { return supabase.from("posts").select([cols, "slug"].join(sep)); }
        await runtimeSep("id");
        await paramSep("id", ", ");
      `,
    });
    expect(cols).toEqual([]);
    expect(f.coverage.unresolvedSites).toEqual([]);
    expect(f.coverage.uncheckedSelects).toEqual([
      'src/lib/q.ts: paramSep: .from(posts).select([cols, "slug"].join(sep))',
      'src/lib/q.ts: runtimeSep: .from(posts).select([cols, "slug"].join(pickSep()))',
    ]);
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
      'src/lib/q.ts: load: .from(posts).select(COLS_LIST.join(", "))',
      "src/lib/q.ts: load: .from(posts).select(ENTITY.post)",
      "src/lib/q.ts: load: .from(posts).select(LOCAL)",
      'src/lib/q.ts: load: .from(posts).select(flag ? "id" : "slug")',
    ]);
  });

  it("zapadka: miejsce nowe albo liczniejsze niż w przeglądzie czerwieni bramkę; naprawione - `stale`", () => {
    const f = facts({
      "src/lib/q.ts": `${HEADER}
        export async function a() { const C = "id"; return supabase.from("posts").select(C); }
        export async function b() { const C = "slug"; return supabase.from("posts").select(C); }
        export async function c() {
          const C = "id";
          await supabase.from("posts").select(C);
          return supabase.from("posts").select(C);
        }
      `,
    });
    const [a, b, c] = ["a", "b", "c"].map((fn) => `src/lib/q.ts: ${fn}: .from(posts).select(C)`);
    const all = { [a]: [1, "powód"], [b]: [1, "powód"], [c]: [2, "powód"] } as const;
    expect(uncheckedSelectDrift(f, all)).toEqual({ fresh: [], stale: [] });
    expect(seamCoverageProblems(f, all)).toEqual([]);
    expect(uncheckedSelectDrift(f, { ...all, [c]: [1, "powód"] }).fresh).toEqual([
      `${c} (2, przejrzanych: 1)`,
    ]);
    expect(seamCoverageProblems(f, {})[0]).toContain(`${a} (1, przejrzanych: 0)`);
    expect(
      uncheckedSelectDrift(f, {
        ...all,
        [c]: [3, "powód"],
        "src/x.ts: f: .from(t).select(Y)": [1, "p"],
      }),
    ).toEqual({
      fresh: [],
      stale: [`${c} (2, przejrzanych: 3)`, "src/x.ts: f: .from(t).select(Y) (0, przejrzanych: 1)"],
    });
  });

  it("zamiana miejsc: naprawa w jednej funkcji i ten sam tekst w innej funkcji albo na innej tabeli - nowy klucz, czerwono", () => {
    // Przegląd zna `a` na `posts`. Naprawione `a` + nowy `select(C)` w `b`
    // (albo w `a`, ale na `pages`) dawniej dawały TEN SAM klucz `plik: .select(C)`
    // i licznik się zgadzał - nowe, niesprawdzone miejsce przechodziło CI.
    const reviewed = { "src/lib/q.ts: a: .from(posts).select(C)": [1, "powód"] } as const;
    const before = facts({
      "src/lib/q.ts": `${HEADER}
        export async function a() { const C = "id"; return supabase.from("posts").select(C); }
      `,
    });
    expect(seamCoverageProblems(before, reviewed)).toEqual([]);
    const otherFunction = facts({
      "src/lib/q.ts": `${HEADER}
        export async function a() { return supabase.from("posts").select("id"); }
        export async function b() { const C = "secret"; return supabase.from("posts").select(C); }
      `,
    });
    expect(uncheckedSelectDrift(otherFunction, reviewed)).toEqual({
      fresh: ["src/lib/q.ts: b: .from(posts).select(C) (1, przejrzanych: 0)"],
      stale: ["src/lib/q.ts: a: .from(posts).select(C) (0, przejrzanych: 1)"],
    });
    expect(seamCoverageProblems(otherFunction, reviewed)).toHaveLength(1);
    const otherTable = facts({
      "src/lib/q.ts": `${HEADER}
        export async function a() { const C = "id"; return supabase.from("pages").select(C); }
      `,
    });
    expect(uncheckedSelectDrift(otherTable, reviewed).fresh).toEqual([
      "src/lib/q.ts: a: .from(pages).select(C) (1, przejrzanych: 0)",
    ]);
    expect(seamCoverageProblems(otherTable, reviewed)).toHaveLength(1);
  });

  it("klucz: PEŁNY tekst argumentu (białe znaki zwinięte) - kolumna dopisana za 80. znakiem to nowy klucz, czerwono", () => {
    // Dawniej klucz obcinał tekst do 80 znaków: `secret_col` dopisany na końcu
    // długiego `select` z warunkiem zostawiał ten sam klucz i przechodził CI.
    const long = (extra: string) =>
      facts({
        "src/lib/q.ts": `${HEADER}
          export async function send(segment: boolean) {
            return supabase
              .from("newsletter_subscribers")
              .select(segment ? "id, email, first_name, last_name, language, unsubscribe_token, meta" : "id, email${extra}");
          }
        `,
      });
    const before = long("");
    const [site] = before.coverage.uncheckedSelects;
    expect(site).toBe(
      'src/lib/q.ts: send: .from(newsletter_subscribers).select(segment ? "id, email, first_name, last_name, language, unsubscribe_token, meta" : "id, email")',
    );
    expect(site.indexOf('"id, email")')).toBeGreaterThan(80);
    const reviewed = { [site]: [1, "powód"] } as const;
    expect(seamCoverageProblems(before, reviewed)).toEqual([]);
    const after = long(", secret_col");
    expect(uncheckedSelectDrift(after, reviewed)).toEqual({
      fresh: [
        'src/lib/q.ts: send: .from(newsletter_subscribers).select(segment ? "id, email, first_name, last_name, language, unsubscribe_token, meta" : "id, email, secret_col") (1, przejrzanych: 0)',
      ],
      stale: [`${site} (0, przejrzanych: 1)`],
    });
    expect(seamCoverageProblems(after, reviewed)).toHaveLength(1);
    // Żaden próg: kolumna na końcu argumentu dłuższego niż 600 znaków też
    // zmienia klucz (klucz kończy się PEŁNYM tekstem argumentu).
    const columns = Array.from({ length: 60 }, (_, i) => `column_${i}`).join(", ");
    const huge = (extra: string) =>
      facts({
        "src/lib/q.ts": `${HEADER}
          export async function send(segment: boolean) {
            return supabase.from("posts").select(segment ? "id" : "${columns}${extra}");
          }
        `,
      }).coverage.uncheckedSelects;
    expect(huge("")).toEqual([
      `src/lib/q.ts: send: .from(posts).select(segment ? "id" : "${columns}")`,
    ]);
    expect(columns.length).toBeGreaterThan(600);
    expect(huge(", secret_col")).toEqual([
      `src/lib/q.ts: send: .from(posts).select(segment ? "id" : "${columns}, secret_col")`,
    ]);
    // Wieloliniowy argument: białe znaki zwinięte do jednej spacji.
    const multiline = facts({
      "src/lib/q.ts": `${HEADER}
        export async function send(segment: boolean) {
          return supabase.from("posts").select(
            segment
              ? "id"
              : "slug",
          );
        }
      `,
    });
    expect(multiline.coverage.uncheckedSelects).toEqual([
      'src/lib/q.ts: send: .from(posts).select(segment ? "id" : "slug")',
    ]);
  });

  it("klucz: ścieżka nazwanych funkcji (także `const f = createServerFn().handler(async () => ...)`, metoda, właściwość); poza funkcją - `<moduł>`", () => {
    const f = facts({
      "src/lib/q.functions.ts": `${HEADER}
        const TOP = supabase.from("posts").select(MOD_COLS);
        export const getThing = createServerFn({ method: "GET" }).handler(async () => {
          const C = "id";
          const rows = await Promise.all([1].map(async () => supabase.from("posts").select(C)));
          return rows;
        });
        export const api = {
          load: async () => { const C = "id"; return supabase.from("posts").select(C); },
          list() { const C = "id"; return supabase.from("posts").select(C); },
        };
        export function outer() {
          return function inner() { const C = "id"; return supabase.from("posts").select(C); };
        }
      `,
    });
    expect(f.coverage.uncheckedSelects).toEqual([
      "src/lib/q.functions.ts: <moduł>: .from(posts).select(MOD_COLS)",
      "src/lib/q.functions.ts: getThing: .from(posts).select(C)",
      "src/lib/q.functions.ts: list: .from(posts).select(C)",
      "src/lib/q.functions.ts: load: .from(posts).select(C)",
      "src/lib/q.functions.ts: outer.inner: .from(posts).select(C)",
    ]);
  });
});

describe("extractSeamFacts - wszechświat `select` (każdy `select` na budowniczym Supabase)", () => {
  const HEADER = `import { supabase } from "@/integrations/supabase/client";\n`;
  const LOOSE = `import { looseTable } from "@/lib/supabase/looseQuery";\n`;
  const LOOSE_MODULE = { "src/lib/supabase/looseQuery.ts": "export function looseTable() {}" };

  it("`let q = ....update().eq()` przedłużane `q = q.eq()`, potem `q.select(...)` - fakt RETURNING tej tabeli", () => {
    const f = facts({
      "src/lib/admin/m.ts": `${HEADER}
        export async function save(id: string, patch: object, base?: string) {
          let q = supabase.from("member_organizations").update(patch).eq("id", id);
          if (base) q = q.eq("updated_at", base);
          return await q.select("id, updated_at");
        }
        export async function saveConst(id: string, patch: object) {
          const q = supabase.from("pages").update(patch).eq("id", id);
          return await q.select("id, updated_at");
        }
        export async function saveClaim(id: string | null, patch: object) {
          let q = supabase.from("subscriptions").update(patch);
          q = id === null ? q.is("last_event_id", null) : q.eq("last_event_id", id);
          return await q.select("id");
        }
      `,
    });
    // `update(patch)` z identyfikatorem nie daje kolumn (jak dotąd) - fakt to
    // RETURNING: kolumny `select` po zapisie.
    expect(f.tables.map((t) => `${t.table}:${t.op}:${t.role}:${t.columns.join(",")}`)).toEqual([
      "member_organizations:select:authenticated:id,updated_at",
      "pages:select:authenticated:id,updated_at",
      "subscriptions:select:authenticated:id",
    ]);
    expect(f.coverage.uncheckedSelects).toEqual([]);
  });

  it("`let` przypisany inaczej niż przedłużeniem (`q = filtruj(q)`) - bez faktu, `select` na liście niesprawdzonych", () => {
    const f = facts({
      "src/lib/admin/m.ts": `${HEADER}
        export async function save(id: string, patch: object) {
          let q = supabase.from("member_organizations").update(patch).eq("id", id);
          q = narrow(q);
          return await q.select("id, secret_col");
        }
        export async function elsewhere(q2: unknown) {
          const fromOtherFunction = shared;
          return fromOtherFunction.select("id");
        }
        const shared = supabase.from("posts");
        export const notSupabase = (el: HTMLInputElement, chart: { select(x: string): void }) => {
          el.select();
          chart.select("id");
          Array.from([1]).map((x) => x);
        };
      `,
    });
    // Ani fakt `q.select`, ani `fromOtherFunction.select` (nazwa związana
    // z budowniczym przez inną stałą) - oba w zapadce; `el.select()`
    // i `chart.select()` to nie budowniczy Supabase.
    expect(f.tables).toEqual([]);
    expect(f.coverage.uncheckedSelects).toEqual([
      'src/lib/admin/m.ts: elsewhere: .from(posts).select("id")',
      'src/lib/admin/m.ts: save: .from(member_organizations).select("id, secret_col")',
    ]);
  });

  it('`looseTable(context, "t")` to `.from("t")` klienta użytkownika; tabela nieczytelna - `select` na liście niesprawdzonych', () => {
    const f = facts({
      "src/lib/crm.functions.ts": `${LOOSE}
        import { supabaseAdmin } from "@/integrations/supabase/client.server";
        export const list = createServerFn().handler(async ({ data, context }) => {
          const view = data.all ? "crm_leads_all" : "crm_leads";
          let q = looseTable(context, view).select("*", { count: "exact" });
          q = applyFilters(q, data);
          await looseTable(context, "crm_lead_notes").insert({ lead_id: data.id, body: "x" }).select("id");
          await looseTable({ supabase: supabaseAdmin }, "crm_consent_log").select("id, kind");
          await looseTable(context, "crm_tasks").select("id", { count: "exact", head: true });
          return q;
        });
      `,
      ...LOOSE_MODULE,
      "src/lib/other.ts": `
        import { looseTable } from "@/lib/elsewhere";
        await looseTable(ctx, "not_a_table_call").select("id");
      `,
    });
    expect(
      f.tables.map((t) => `${t.table}:${t.op}:${t.role}:${t.columns.join(",")}:${t.star}`),
    ).toEqual([
      "crm_lead_notes:insert:authenticated:body,lead_id:false",
      "crm_lead_notes:select:authenticated:id:false",
      "crm_consent_log:select:service_role:id,kind:false",
    ]);
    expect(f.coverage.unresolvedSites).toEqual([]);
    expect(f.coverage.uncheckedSelects).toEqual([
      'src/lib/crm.functions.ts: list: .from(?).select("*")',
    ]);
  });

  it("budowniczy przez warunek (`(c ? q.eq() : q).select()`, `const g = c ? q.is() : q.gt()`, `a ?? b`) - też we wszechświecie", () => {
    // Kształty `oneTimeFulfilment.server.ts` i `legacyNonPaymentReconcile.server.ts`:
    // dawniej poza wszechświatem, więc nowy `select` przez warunek przechodził CI.
    const f = facts({
      "src/lib/billing/x.server.ts": `${HEADER}
        export async function settle(c: boolean) {
          const flip = supabase.from("payment_orders").update({ status: "paid" }).eq("id", 1);
          return (c ? flip.eq("x", 1) : flip).select("id");
        }
        export async function clamp(c: boolean) {
          const base = supabase.from("user_subscriptions").update({ status: "x" });
          const guarded = c ? base.is("y", null) : base.gt("y", 1);
          return guarded.select("id");
        }
        export async function either(a: unknown) {
          const b = supabase.from("posts");
          return (a ?? b).select("slug");
        }
      `,
    });
    expect(f.coverage.uncheckedSelects).toEqual([
      'src/lib/billing/x.server.ts: clamp: .from(user_subscriptions).select("id")',
      'src/lib/billing/x.server.ts: either: .from(posts).select("slug")',
      'src/lib/billing/x.server.ts: settle: .from(payment_orders).select("id")',
    ]);
  });

  it("`looseTable` w pliku CRM: wpis wstrzymuje WYŁĄCZNIE odczyt `profiles` z przeglądu; zapisy, literały i inne odczyty `looseTable` idą do pgTAP", () => {
    // Dawniej rejestr plikowy (LOOSE_TABLE_EXCLUDED_REVIEWED) zdejmował KAŻDY
    // fakt `looseTable` pliku - weryfikator przepuścił przez CI
    // `looseTable(context, "profiles").update({ tenant_id })` i zapis
    // `crm_leads.stage = "not_a_stage"` z nieistniejącą kolumną.
    const file = "src/lib/crm.functions.ts";
    const code = `${LOOSE}${HEADER}
      export const get = createServerFn().handler(async ({ context, data }) => {
        await looseTable(context, "profiles").select("avatar_url, email");
        await looseTable(context, "profiles").select("tenant_id");
        await looseTable(context, "profiles").update({ tenant_id: data.tenantId }).eq("id", data.id);
        await looseTable(context, "crm_leads").insert({ stage: "not_a_stage", bogus_col: 1 });
        return supabase.from("posts").select("id");
      });
    `;
    const entry: WithheldFactReviewed = {
      file,
      fn: "get",
      table: "profiles",
      op: "select",
      role: "authenticated",
      columns: ["avatar_url", "email"],
      reason: "defekt grantu",
    };
    const f = facts({ ...LOOSE_MODULE, [file]: code }, NO_CONTRACTS, [entry]);
    expect(f.withheld.map((w) => `${w.table}:${w.op}:${w.role}:${w.columns.join(",")}`)).toEqual([
      "profiles:select:authenticated:avatar_url,email",
    ]);
    expect(f.tables.map((t) => `${t.table}:${t.op}:${t.role}:${t.columns.join(",")}`)).toEqual([
      "profiles:select:authenticated:tenant_id",
      "profiles:update:authenticated:tenant_id",
      "crm_leads:insert:authenticated:bogus_col,stage",
      "posts:select:authenticated:id",
    ]);
    expect(f.literals).toEqual([
      { table: "crm_leads", column: "stage", value: "not_a_stage", file },
    ]);
    expect(f.coverage.uncheckedSelects).toEqual([]);
    expect(seamCoverageProblems(f)).toEqual([]);
  });
});

describe("extractSeamFacts - składnia (rodzaj pliku po rozszerzeniu)", () => {
  // Kształt `profile/export.functions.ts`: strzałka generyczna w pliku `.ts`.
  // Parsowana jako TSX otwiera znacznik JSX i reszta pliku znika z kontraktu.
  const GENERIC_ARROW = `
    import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
    export const f = createServerFn().middleware([requireSupabaseAuth]).handler(async ({ context }) => {
      const { supabase } = context;
      const pages = async <Row>(read: () => PromiseLike<Row>) => read();
      await supabase.rpc("get_own_profile");
      return pages(() => supabase.from("user_roles").select("role, tenant_id"));
    });
  `;

  it("plik `.ts` ze strzałką generyczną `async <Row>(` - fakty są, błędów składni brak", () => {
    const f = facts({ "src/lib/profile/export.functions.ts": GENERIC_ARROW });
    expect(f.coverage.parseErrors).toEqual([]);
    expect(f.rpcs.map((r) => `${r.name}:${r.role}`)).toEqual(["get_own_profile:authenticated"]);
    expect(f.tables.map((t) => `${t.table}:${t.op}:${t.role}:${t.columns.join(",")}`)).toEqual([
      "user_roles:select:authenticated:role,tenant_id",
    ]);
    expect(seamCoverageProblems(f)).toEqual([]);
  });

  it("plik z błędem składni czerwieni zasięg - także bez wywołań", () => {
    const f = facts({
      // Ten sam tekst w `.tsx` to błąd składni - jak każdy plik `.ts` dawniej.
      "src/lib/profile/export.functions.tsx": GENERIC_ARROW,
      "src/lib/broken.ts": `export const x = ;`,
      "src/lib/ok.ts": `export const y = 1;`,
    });
    expect(f.coverage.parseErrors).toHaveLength(2);
    expect(f.coverage.parseErrors[0]).toMatch(
      /^src\/lib\/broken\.ts: 1 błędów składni, pierwszy: linia 1: /,
    );
    expect(f.coverage.parseErrors[1]).toMatch(/^src\/lib\/profile\/export\.functions\.tsx: \d+ /);
    const problems = seamCoverageProblems(f);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("2 plików z błędami składni");
    expect(problems[0]).toContain("src/lib/broken.ts: 1 błędów składni");
  });
});

describe("extractSeamFacts - fakty wstrzymane w przeglądzie (SEAM_FACTS_WITHHELD_REVIEWED)", () => {
  // Kształt `profile/export.functions.ts`: jeden odczyt bez grantu wśród wielu
  // poprawnych. Dawniej wpis wyłączał CAŁY plik - kolumna dopisana do
  // sąsiedniego odczytu, zmyślone RPC i nowy odczyt przechodziły CI.
  const FILE = "src/lib/profile/export.functions.ts";
  const CODE = `
    import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
    export const exportMyData = createServerFn().middleware([requireSupabaseAuth]).handler(async ({ context }) => {
      const { supabase } = context;
      const LOCAL = "id";
      return {
        reports: supabase.from("user_reports").select("id, reason").eq("reporter_id", u),
        badges: supabase.from("profile_badges").select("badge, created_at, bogus_secret_col"),
        widened: supabase.from("user_reports").select("id, reason, reporter_id"),
        local: supabase.from("posts").select(LOCAL),
        renamed: supabase.rpc("get_own_profile_nonexistent"),
      };
    });
    export const other = createServerFn().middleware([requireSupabaseAuth]).handler(async ({ context }) => {
      const { supabase } = context;
      return supabase.from("user_reports").select("id, reason");
    });
  `;
  const ENTRY: WithheldFactReviewed = {
    file: FILE,
    fn: "exportMyData",
    table: "user_reports",
    op: "select",
    role: "authenticated",
    columns: ["id", "reason"],
    reason: "defekt grantu",
  };
  const LOCAL_SITE = `${FILE}: exportMyData: .from(posts).select(LOCAL)`;

  it("wstrzymany DOKŁADNIE jeden fakt (plik, funkcja, tabela, operacja, rola, kolumny); reszta pliku - fakty, RPC i zapadka jak każdy kod", () => {
    const f = facts({ [FILE]: CODE }, NO_CONTRACTS, [ENTRY]);
    expect(f.withheld.map((w) => `${w.fn}: ${w.table}:${w.role}:${w.columns.join(",")}`)).toEqual([
      "exportMyData: user_reports:authenticated:id,reason",
    ]);
    expect(f.withheld[0].key).toBe(withheldKey(ENTRY));
    // Kolumna dopisana do wstrzymanego odczytu (`widened`) i ten sam odczyt
    // w innej funkcji (`other`) to INNE fakty - idą do pgTAP z rolą klienta.
    expect(
      f.tables.map((t) => `${t.table}:${t.op}:${t.role}:${t.columns.join(",")}:${t.file}`),
    ).toEqual([
      `profile_badges:select:authenticated:badge,bogus_secret_col,created_at:${FILE}`,
      `user_reports:select:authenticated:id,reason,reporter_id:${FILE}`,
      `user_reports:select:authenticated:id,reason:${FILE}`,
    ]);
    expect(f.rpcs.map((r) => `${r.name}:${r.role}`)).toEqual([
      "get_own_profile_nonexistent:authenticated",
    ]);
    expect(f.coverage.uncheckedSelects).toEqual([LOCAL_SITE]);
    expect(f.coverage.withheldReviewed).toEqual([{ key: withheldKey(ENTRY), matched: 1 }]);
    expect(seamCoverageProblems(f, { [LOCAL_SITE]: [1, "powód"] })).toEqual([]);
    // Bez wpisu ten sam odczyt to zwykły fakt.
    expect(facts({ [FILE]: CODE }).tables).toHaveLength(4);
  });

  it("wpis, który nie trafia w dokładnie jeden fakt, czerwieni zasięg (inna lista kolumn, tabela, operacja, rola, funkcja, plik; dwa trafienia)", () => {
    const reviewed = { [LOCAL_SITE]: [1, "powód"] } as const;
    for (const entry of [
      { ...ENTRY, columns: ["id"] },
      // Ta sama funkcja, rola i kolumny - inna tabela albo operacja to inny
      // fakt: wpis nie może wstrzymać odczytu `user_reports` pod cudzym kluczem.
      { ...ENTRY, table: "user_reports_other" },
      { ...ENTRY, op: "update" as const },
      { ...ENTRY, role: "service_role" as const },
      { ...ENTRY, fn: "other" },
      { ...ENTRY, fn: "exportMyData.inner" },
      { ...ENTRY, file: "src/lib/profile/other.functions.ts" },
    ]) {
      const f = facts({ [FILE]: CODE }, NO_CONTRACTS, [entry]);
      const label = withheldKey(entry);
      if (entry.fn === "other") {
        // Ten sam tekst w innej funkcji: wstrzymany jest TAMTEN fakt, a odczyt
        // z przeglądu (`exportMyData`) idzie do pgTAP.
        expect(
          f.withheld.map((w) => w.fn),
          label,
        ).toEqual(["other"]);
        expect(
          f.tables.filter((t) => t.table === "user_reports" && t.columns.join(",") === "id,reason"),
          label,
        ).toHaveLength(1);
        continue;
      }
      expect(f.withheld, label).toEqual([]);
      expect(f.tables, label).toHaveLength(4);
      const problems = seamCoverageProblems(f, reviewed);
      expect(problems, label).toHaveLength(1);
      expect(problems[0]).toContain(`${label} (faktów: 0)`);
    }
    const twice = facts(
      {
        [FILE]: `
          import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
          export const exportMyData = createServerFn().handler(async ({ context }) => {
            const { supabase } = context;
            await supabase.from("user_reports").select("id, reason");
            return supabase.from("user_reports").select("reason, id");
          });
        `,
      },
      NO_CONTRACTS,
      [ENTRY],
    );
    expect(twice.withheld).toHaveLength(2);
    expect(seamCoverageProblems(twice)[0]).toContain(`${withheldKey(ENTRY)} (faktów: 2)`);
  });

  it("render: fakt wstrzymany idzie z rolą `unknown` - istnienie relacji i kolumn sprawdzane, uprawnienia nie", () => {
    const f = facts(
      {
        [FILE]: `
          import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
          export const exportMyData = createServerFn().handler(async ({ context }) => {
            const { supabase } = context;
            return supabase.from("user_reports").select("id, reason");
          });
        `,
      },
      NO_CONTRACTS,
      [ENTRY],
    );
    expect(f.tables).toEqual([]);
    const sql = renderContractTest(f);
    expect(sql).toContain(
      `('user_reports', 'select', 'unknown', ARRAY['id', 'reason']::text[], false, '${FILE}')`,
    );
    expect(sql).not.toContain("('user_reports', 'select', 'authenticated'");
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
    // `.select(POST_SELECT)` (sąsiad wpisu); `archives.ts`: 6 z przepływu -
    // trzy wywołania pomocnika (strona od najnowszych/najstarszych oraz
    // czołówka i ogon „popularnych”, 17.11.2026), każde z tymi samymi
    // kolumnami `POST_COLS`.
    const expected: Record<string, readonly [number, string]> = {
      "src/lib/queries/megaMenu.ts": [4, "cover_image_url,id,published_at,slug,title_en,title_pl"],
      "src/lib/queries/blocks.ts": [
        7,
        "cover_image_url,excerpt_en,excerpt_pl,id,is_sponsored,parent_page_id,published_at,slug,sponsored_affiliate,sponsored_kind,title_en,title_pl",
      ],
      "src/lib/queries/archives.ts": [
        6,
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

  it("każdy plik produkcyjny parsuje się bez błędów składni", () => {
    expect(repo.coverage.parseErrors).toEqual([]);
  });

  it("fakty wstrzymane to DOKŁADNIE przejrzana lista (dziś pusta) - każdy wpis trafia w jeden fakt, z powodem", () => {
    // Pełny odcisk: plik, funkcja, operacja, tabela, rola, kolumny. Nowy
    // wstrzymany fakt (albo inna lista kolumn) zmienia ten napis. Trzy wpisy
    // z listopada 2026 (eksport `user_reports`, `profiles` w kartach leada
    // i firmy CRM) zeszły razem z naprawami - kod nie czyta już tych kolumn
    // klientem użytkownika, więc wpis trafiałby w zero faktów.
    expect(
      repo.withheld
        .map((w) => `${w.file}: ${w.fn}: ${w.op} ${w.table} dla ${w.role} [${w.columns.join(",")}]`)
        .sort(),
    ).toEqual([]);
    expect(SEAM_FACTS_WITHHELD_REVIEWED).toEqual([]);
    expect(repo.withheld.map((w) => w.key).sort()).toEqual(
      SEAM_FACTS_WITHHELD_REVIEWED.map(withheldKey).sort(),
    );
    expect(repo.coverage.withheldReviewed.map((e) => e.matched)).toEqual(
      SEAM_FACTS_WITHHELD_REVIEWED.map(() => 1),
    );
    for (const entry of SEAM_FACTS_WITHHELD_REVIEWED) {
      expect(entry.reason.length, withheldKey(entry)).toBeGreaterThan(200);
      expect(entry.columns, withheldKey(entry)).toEqual([...entry.columns].sort());
    }
  });

  it("eksport danych RODO (`profile/export.functions.ts`): 32 odczyty i 14 RPC w kontrakcie (zgłoszenia przez `user_reports_export_my_data`), nic wstrzymanego", () => {
    // Do listopada 2026 plik parsowany jako TSX nie dawał ŻADNEGO faktu, potem
    // był wyłączony w całości, a potem wstrzymany był jego odczyt
    // `user_reports` (tabela RPC-only - 42501 w każdym eksporcie). Dziś
    // sekcja `user_reports_filed` woła SECURITY DEFINER RPC
    // (20261116211500), a każdy odczyt i RPC pliku idzie do pgTAP z rolą
    // klienta (sprawdzone lokalnie na schemacie po migracjach).
    const file = "src/lib/profile/export.functions.ts";
    expect(repo.withheld.filter((w) => w.file === file)).toEqual([]);
    const tables = repo.tables.filter((t) => t.file === file);
    expect(tables.filter((t) => t.table === "user_reports")).toEqual([]);
    expect(tables).toHaveLength(32);
    expect(new Set(tables.map((t) => `${t.op}:${t.role}`))).toEqual(
      new Set(["select:authenticated"]),
    );
    expect(tables.filter((t) => t.star).map((t) => t.table)).toEqual(["notification_preferences"]);
    const rpcs = repo.rpcs.filter((r) => r.file === file);
    expect(rpcs).toHaveLength(14);
    expect(new Set(rpcs.map((r) => r.role))).toEqual(new Set(["authenticated"]));
    expect(rpcs.filter((r) => r.name === "user_reports_export_my_data")).toEqual([
      { name: "user_reports_export_my_data", keys: ["p_limit"], role: "authenticated", file },
    ]);
    // Plik jest we wszechświecie zapadki `select` jak każdy inny.
    expect(repo.coverage.uncheckedSelects.filter((site) => site.startsWith(file))).toEqual([]);
  });

  it("`looseTable` - nazwa i moduł pomocnika są prawdziwe; w plikach CRM nic nie jest wstrzymane, `profiles` klientem użytkownika tylko `tenant_id`, reszta (także zapisy i literały) w pgTAP", () => {
    const source = readFileSync(LOOSE_TABLE.module, "utf8");
    expect(source).toMatch(new RegExp(`export function ${LOOSE_TABLE.helper}\\(`));
    const crm = ["src/lib/crm-companies.functions.ts", "src/lib/crm.functions.ts"];
    const inCrm = (file: string) => crm.includes(file);
    // Do listopada 2026 wstrzymane były dwa odczyty `profiles` klientem
    // użytkownika z kolumnami celowo odebranymi `authenticated` (karta leada:
    // `email`/`contact_email`, karta firmy: `location`/`contact_email`
    // i filtr `current_company_id`) - oba padały na 42501. Dziś obie karty
    // czytają spod `service_role` (niżej), więc nie ma czego wstrzymywać.
    expect(repo.withheld.filter((w) => inCrm(w.file))).toEqual([]);
    // Odczyty `profiles` klientem użytkownika w CRM (z `resolveCallerTenantId`
    // wydzielonym do lib/crm/callerTenant.ts) to wyłącznie najemca wołającego
    // - bez kolumn PII.
    expect(
      repo.tables
        .filter(
          (t) =>
            (inCrm(t.file) || t.file === "src/lib/crm/callerTenant.ts") &&
            t.table === "profiles" &&
            t.role === "authenticated",
        )
        .map((t) => `${t.file}: ${t.op} [${t.columns.join(",")}]`)
        .sort(),
    ).toEqual([
      "src/lib/crm-companies.functions.ts: select [tenant_id]",
      "src/lib/crm.functions.ts: select [tenant_id]",
      "src/lib/crm/callerTenant.ts: select [tenant_id]",
    ]);
    // Nowe ścieżki serwerowe obu kart (najemca z sesji, `.eq("tenant_id", ...)`
    // bezwarunkowo): `companyMembers` (karta firmy) - jedyny odczyt `profiles`
    // spod `service_role` w crm-companies, wyłącznie kolumny z grantem dla
    // `authenticated`; `lookupLeadAvatars` (lista i karta leada) - jeden
    // odczyt adresów, z którego do przeglądarki wychodzi tylko `avatar_url`.
    expect(
      repo.tables
        .filter(
          (t) =>
            t.file === "src/lib/crm-companies.functions.ts" &&
            t.table === "profiles" &&
            t.role === "service_role",
        )
        .map((t) => `${t.op} [${t.columns.join(",")}]`),
    ).toEqual(["select [avatar_url,display_name,first_name,id,job_title,last_name,slug]"]);
    expect(
      repo.tables.filter(
        (t) =>
          t.file === "src/lib/crm.functions.ts" &&
          t.table === "profiles" &&
          t.role === "service_role" &&
          t.columns.join(",") === "avatar_url,contact_email,email",
      ),
    ).toHaveLength(1);
    // Zapisy i odczyty `looseTable` tych plików są faktami kontraktu.
    const ops = new Set(
      repo.tables
        .filter((t) => inCrm(t.file) && t.role === "authenticated")
        .map((t) => `${t.file}: ${t.op} ${t.table}`),
    );
    for (const expected of [
      "src/lib/crm-companies.functions.ts: delete crm_companies",
      "src/lib/crm-companies.functions.ts: insert audit_log",
      "src/lib/crm-companies.functions.ts: insert crm_companies",
      "src/lib/crm-companies.functions.ts: insert crm_leads",
      "src/lib/crm-companies.functions.ts: select crm_leads",
      "src/lib/crm.functions.ts: delete crm_lead_notes",
      "src/lib/crm.functions.ts: delete crm_leads",
      "src/lib/crm.functions.ts: insert audit_log",
      "src/lib/crm.functions.ts: insert crm_lead_notes",
      "src/lib/crm.functions.ts: insert crm_scoring_settings",
      "src/lib/crm.functions.ts: select crm_leads",
      "src/lib/crm.functions.ts: update crm_leads",
    ]) {
      expect(ops.has(expected), expected).toBe(true);
    }
    expect(repo.literals).toContainEqual({
      table: "crm_leads",
      column: "stage",
      value: "new",
      file: "src/lib/crm-companies.functions.ts",
    });
    // Zapadka `select` z tych plików: tylko miejsca, których reguła nie umie
    // odczytać (tabela z warunku, tablica `join`, stała funkcji).
    expect(
      repo.coverage.uncheckedSelects.filter((site) => crm.some((f) => site.startsWith(f))),
    ).toEqual([
      "src/lib/crm.functions.ts: buildLeadTimeline: .from(crm_consent_log).select(CONSENT_LOG_TIMELINE_SELECT)",
      'src/lib/crm.functions.ts: exportCrmLeadsCsv: .from(?).select("*")',
      'src/lib/crm.functions.ts: listCrmLeads: .from(?).select("*")',
      "src/lib/crm.functions.ts: listStaffUsers: .from(profiles).select(cols)",
    ]);
  });

  it("`looseClient` - nazwa i moduł pomocnika są prawdziwe; w CRM żaden fakt nie zostaje z rolą `unknown` (EXECUTE i uprawnienia w pgTAP)", () => {
    const source = readFileSync(LOOSE_CLIENT.module, "utf8");
    expect(source).toMatch(new RegExp(`export function ${LOOSE_CLIENT.helper}\\(`));
    // Sprawdzone lokalnie na schemacie po migracjach: `authenticated` ma
    // EXECUTE na tych RPC, a `service_role` - SELECT na odczytanych tabelach.
    expect(
      repo.rpcs
        .filter((r) =>
          ["crm_companies_aggregates", "crm_funnel_stats", "crm_import_leads"].includes(r.name),
        )
        .map((r) => `${r.file}: ${r.name}: ${r.role}`)
        .sort(),
    ).toEqual([
      "src/lib/crm-companies.functions.ts: crm_companies_aggregates: authenticated",
      "src/lib/crm-funnel.functions.ts: crm_funnel_stats: authenticated",
      "src/lib/crm-tasks.functions.ts: crm_import_leads: authenticated",
    ]);
    // Każde RPC karty i scoringu leada jest faktem z rolą klienta. Do listopada
    // 2026 pięć z nich szło przez lokalne `rpcOf(context)` (`const rpc = ...;
    // rpc("nazwa")`) - kontrakt ich nie widział (ani istnienia, ani EXECUTE,
    // ani nazw argumentów). Dziś `looseClient(context).rpc(...)`.
    expect(
      repo.rpcs
        .filter((r) => r.file === "src/lib/crm.functions.ts")
        .map((r) => `${r.name}: ${r.role}: ${(r.keys ?? ["?"]).join(",")}`)
        .sort(),
    ).toEqual([
      "admin_crm_set_lifecycle_stage: authenticated: p_lead_id,p_stage",
      "admin_journey_lead_enrollments: authenticated: p_lead_id",
      "crm_enqueue_lead_push: authenticated: p_endpoint_id,p_lead_id",
      "crm_leads_marketing_consent_withdraw: authenticated: p_lead_ids",
      "has_role: authenticated: _role,_user_id",
      "has_role: authenticated: _role,_user_id",
      "has_role: authenticated: _role,_user_id",
      "is_super_admin: authenticated: ",
      "recompute_crm_lead_score: authenticated: p_lead_id",
      "recompute_crm_lead_scores: authenticated: p_after_id,p_limit",
    ]);
    const crm = (file: string) => /^src\/lib\/crm[-.]/.test(file);
    expect(repo.rpcs.filter((r) => crm(r.file) && r.role === "unknown")).toEqual([]);
    expect(repo.tables.filter((t) => crm(t.file) && t.role === "unknown")).toEqual([]);
    expect(
      new Set(
        repo.tables
          .filter((t) => t.file === "src/lib/crm.functions.ts" && t.role === "service_role")
          .map((t) => t.table),
      ),
    ).toEqual(
      new Set([
        "membership_grants",
        "membership_tiers",
        "metered_views",
        "metering_settings",
        "organization_seats",
        "profile_awards",
        "profile_cv_files",
        "profile_education",
        "profile_experiences",
        "profile_skills",
        "profiles",
        "user_roles",
        "user_subscriptions",
      ]),
    );
    // Karta firmy: członkowie (`companyMembers`) spod `service_role` - jedyna
    // tabela tej roli w pliku.
    expect(
      new Set(
        repo.tables
          .filter(
            (t) => t.file === "src/lib/crm-companies.functions.ts" && t.role === "service_role",
          )
          .map((t) => t.table),
      ),
    ).toEqual(new Set(["profiles"]));
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
