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
import { guestReach } from "../guestReach";
import {
  COLUMN_FLOW_MAX_DEPTH,
  GUEST_LOGIN_ONLY_REVIEWED,
  GUEST_VIA,
  INVOKER_TRIGGERS_REVIEWED,
  MAX_FILTERS_OUTSIDE_CHAINS,
  MAX_UNRESOLVED_FILTER_SITES,
  MAX_UNRESOLVED_SITES,
  LOOSE_CLIENT,
  LOOSE_TABLE,
  PRIMARY_KEY_COLUMNS,
  RPC_PROBE_VACUOUS_REVIEWED,
  SEAM_FACTS_WITHHELD_REVIEWED,
  SERVER_GUEST_VIA,
  POST_PARENT_PAGE_READ,
  UNCHECKED_SELECTS_REVIEWED,
  UNKNOWN_ROLE_REVIEWED,
  checkedRoles,
  embeddedTable,
  extractSeamFacts,
  filterColumnPath,
  guestLoginOnlyDrift,
  parseOrFilterColumns,
  parseSelectColumns,
  renderContractTest,
  renderGuestGaps,
  renderObservedQueries,
  seamCoverageProblems,
  selectEmbedItem,
  uncheckedSelectDrift,
  unknownRoleDrift,
  withPostParentPageEmbed,
  withheldKey,
  type PublicColumnContract,
  type SeamFacts,
  type SiteReach,
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
    // 9 asercji faktów bramki + 11 asercji faktów miary (rola zmierzona,
    // filtry, osadzenia, sondy, gość, wyzwalacze SECURITY INVOKER).
    expect(sql).toContain("SELECT plan(20);");
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
    // `authenticated`; `lookupLeadAvatars` (lista i karta leada) - DWA odczyty
    // adresów na porcję (logowanie: dokładne `email.in`; kontakt: `ilike` bez
    // wielkości liter), z których do przeglądarki wychodzi tylko `avatar_url`.
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
    ).toEqual([
      {
        table: "profiles",
        op: "select",
        columns: ["avatar_url", "contact_email", "email"],
        star: false,
        role: "service_role",
        file: "src/lib/crm.functions.ts",
      },
      {
        table: "profiles",
        op: "select",
        columns: ["avatar_url", "contact_email", "email"],
        star: false,
        role: "service_role",
        file: "src/lib/crm.functions.ts",
      },
    ]);
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
      "src/lib/crm-tasks.functions.ts: crm_import_leads: authenticated",
    ]);
    // Lejek marketingowy (17.11.2026): `crm_funnel_stats` (SECURITY INVOKER nad
    // `crm_funnel_view`) dziedziczyło 42501 z `profiles.email` w złączeniu
    // widoku, więc lejek czyta widok spod `service_role` z najemcą z sesji -
    // i NIGDY klientem użytkownika. Kolumny odpowiedzi to kolumny ekranu
    // (lista i karta subskrybenta); liczniki to `head: true`, które z założenia
    // nie są faktem kolumn.
    expect(
      repo.tables
        .filter(
          (t) => t.file === "src/lib/crm-funnel.functions.ts" && t.table === "crm_funnel_view",
        )
        .map((t) => `${t.op} ${t.role} [${t.columns.join(",")}]`)
        .sort(),
    ).toEqual([
      "select service_role [avatar_url,confirmed_at,contact_id,contact_score,contact_stage,created_at,display_name,email,first_name,id,is_contact,is_registered,language,last_name,profile_id,source,status,tenant_id,unsubscribed_at,user_id]",
      "select service_role [avatar_url,confirmed_at,contact_id,contact_score,contact_stage,created_at,display_name,email,first_name,id,is_contact,is_registered,language,last_name,profile_id,source,status,tenant_id,unsubscribed_at,user_id]",
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

// ── Miara poza bramką (`observe`) ───────────────────────────────────────────
//
// Kolumny filtrów i rola klienta ustalona szerzej NIE idą do pgTAP: bramka
// zostaje tak samo surowa jak przed miarą, a miara daje listę naruszeń do
// przeglądu (`generate:ts-sql-contract --measure`).

function observed(files: Record<string, string>): SeamFacts {
  return extractSeamFacts(
    Object.entries(files).map(([file, code]) => ({ file, code })),
    NO_CONTRACTS,
    [],
    { observe: true },
  );
}

const filterKeys = (f: SeamFacts): string[] =>
  f.observed.filters.map(
    (x) =>
      `${x.table}.${x.column}:${x.method}:${x.op}:${x.role}${x.embed === null ? "" : `@${x.embed}`}`,
  );

const roleKeys = (f: SeamFacts): string[] => [
  ...f.observed.rpcs.map((r) => `rpc ${r.name}: ${r.enforcedRole} -> ${r.role}`),
  ...f.observed.tables.map((t) => `${t.op} ${t.table}: ${t.enforcedRole} -> ${t.role}`),
];

const ADMIN_FILE = `
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
`;

describe("miara: składnia filtrów PostgREST", () => {
  it("ścieżka kolumny: osadzenie, ścieżka json, `rel(kol)` z `.order`; reszta - nie kolumna", () => {
    expect(filterColumnPath("status")).toEqual({ embed: [], column: "status" });
    expect(filterColumnPath("meta->>segment")).toEqual({ embed: [], column: "meta" });
    expect(filterColumnPath("slot.status")).toEqual({ embed: ["slot"], column: "status" });
    expect(filterColumnPath("a.b.c")).toEqual({ embed: ["a", "b"], column: "c" });
    expect(filterColumnPath("section(name)")).toEqual({ embed: ["section"], column: "name" });
    expect(filterColumnPath("Bad-Col")).toBeNull();
    expect(filterColumnPath("a..b")).toBeNull();
  });

  it("`or`: warunki z `and(...)`/`not.or(...)`, przecinek w nawiasie i cudzysłowie, osadzenie, operator z `(any)`", () => {
    expect(
      parseOrFilterColumns(
        'a.eq.1,and(b.gt.2,not.or(c.is.null,d.in.(1,2))),e.ilike."x,y",emb.f.eq.z,g.like(any).{a,b}',
      ),
    ).toEqual({ paths: ["a", "b", "c", "d", "e", "emb.f", "g"], unresolved: [] });
    // Warunek bez operatora - nieczytelny, nie zgadnięta kolumna.
    expect(parseOrFilterColumns("a.eq.1,bogus")).toEqual({ paths: ["a"], unresolved: ["bogus"] });
  });

  it("tabela osadzenia z listy `select`: alias, podpowiedź FK, `!inner`, rozkład, zagnieżdżenie; agregat to nie osadzenie", () => {
    const select =
      "id, slot:ad_slots!slot_fk!inner(status, owner:profiles(id)), event_people!inner(user_id), ...authors(name), count()";
    expect(embeddedTable(select, ["slot"])).toBe("ad_slots");
    expect(embeddedTable(select, ["ad_slots"])).toBe("ad_slots");
    expect(embeddedTable(select, ["slot", "owner"])).toBe("profiles");
    expect(embeddedTable(select, ["event_people"])).toBe("event_people");
    expect(embeddedTable(select, ["authors"])).toBe("authors");
    expect(embeddedTable(select, ["count"])).toBeNull();
    expect(embeddedTable(select, ["nope"])).toBeNull();
    expect(embeddedTable(null, ["slot"])).toBeNull();
  });
});

describe("miara: kolumny filtrów i sortowania (SELECT także w UPDATE/DELETE)", () => {
  it("pierwszy argument metod filtra, klucze `.match`, `.order` i operacja łańcucha; `head: true` też filtruje", () => {
    const f = observed({
      "src/a.server.ts": `${ADMIN_FILE}
        export async function f() {
          await supabaseAdmin.from("orders").select("id").eq("tenant_id", t).in("status", s)
            .ilike("email", e).order("created_at", { ascending: false });
          await supabaseAdmin.from("orders").update({ status: "x" }).eq("id", id).is("deleted_at", null);
          await supabaseAdmin.from("orders").delete().match({ tenant_id: t, kind: "k" });
          await supabaseAdmin.from("orders").select("id", { count: "exact", head: true })
            .not("ref", "is", null).filter("meta->>key", "eq", v).textSearch("fts", q);
        }
      `,
    });
    expect(filterKeys(f)).toEqual([
      "orders.tenant_id:eq:select:service_role",
      "orders.status:in:select:service_role",
      "orders.email:ilike:select:service_role",
      "orders.created_at:order:select:service_role",
      "orders.id:eq:update:service_role",
      "orders.deleted_at:is:update:service_role",
      "orders.kind:match:delete:service_role",
      "orders.tenant_id:match:delete:service_role",
      "orders.ref:not:select:service_role",
      "orders.meta:filter:select:service_role",
      "orders.fts:textSearch:select:service_role",
    ]);
    expect(f.observed.unresolvedFilters).toEqual([]);
    // Fakt filtra nie ma roli bramki - to nowy rodzaj faktu.
    expect(new Set(f.observed.filters.map((x) => x.enforcedRole))).toEqual(new Set(["unknown"]));
  });

  it("`.containedBy`, `.contains` i `.overlaps` - kolumna w pierwszym argumencie to fakt filtra (także w UPDATE)", () => {
    const f = observed({
      "src/a.server.ts": `${ADMIN_FILE}
        export async function f() {
          await supabaseAdmin.from("events").select("id").containedBy("tags", ["a", "b"]);
          await supabaseAdmin.from("events").update({ status: "x" }).contains("roles", ["admin"])
            .overlaps("during", "[2026-01-01,2026-02-01)");
        }
      `,
    });
    expect(filterKeys(f)).toEqual([
      "events.tags:containedBy:select:service_role",
      "events.roles:contains:update:service_role",
      "events.during:overlaps:update:service_role",
    ]);
    expect(f.observed.unresolvedFilters).toEqual([]);
  });

  it("`or`: literał, szablon z kolumną w literale, `xs.map(cb).join`; kolumna z parametru bez wywołań - nieczytelna", () => {
    const f = observed({
      "src/b.tsx": `
        import { supabase } from "@/integrations/supabase/client";
        export async function g(term: string, terms: string[], col: string) {
          await supabase.from("leads").select("id").or("a.eq.1,and(b.gt.2,c.is.null)");
          await supabase.from("leads").select("id").or(\`email.ilike.\${term},contact_email.ilike.\${term}\`);
          await supabase.from("leads").select("id").or(terms.map((t) => \`name.ilike.%\${t}%\`).join(","));
          await supabase.from("leads").select("id").or(\`\${col}.eq.1\`);
          await supabase.from("leads").select("id").or(\`kind.eq.\${(() => "x")()}\`);
          let stamp = new Date().toISOString();
          if (col) stamp = col;
          await supabase.from("leads").select("id").or(\`due_at.is.null,due_at.lt.\${stamp}\`);
        }
      `,
    });
    expect(filterKeys(f)).toEqual([
      "leads.a:or:select:authenticated",
      "leads.b:or:select:authenticated",
      "leads.c:or:select:authenticated",
      "leads.email:or:select:authenticated",
      "leads.contact_email:or:select:authenticated",
      "leads.name:or:select:authenticated",
      // \`let\` na miejscu WARTOŚCI nie czyni warunku nieczytelnym.
      "leads.kind:or:select:authenticated",
      "leads.due_at:or:select:authenticated",
      "leads.due_at:or:select:authenticated",
    ]);
    expect(f.observed.unresolvedFilters).toEqual([
      "src/b.tsx: g: .from(leads).or(`${col}.eq.1`): warunek ${…}.eq.1",
    ]);
  });

  it("parametr z wartością domyślną na miejscu wartości `or` - wartość czasu działania, kolumny zostają", () => {
    const f = observed({
      "src/b2.tsx": `
        import { supabase } from "@/integrations/supabase/client";
        export async function g2(term = "") {
          await supabase.from("leads").select("id").or(\`email.ilike.\${term}\`);
        }
      `,
    });
    expect(filterKeys(f)).toEqual(["leads.email:or:select:authenticated"]);
    expect(f.observed.unresolvedFilters).toEqual([]);
  });

  it("osadzenie z warunku: ta sama nazwa osadzenia na RÓŻNYCH tabelach w wariantach `select` - nieczytelne, nie pierwszy wariant", () => {
    const f = observed({
      "src/b3.tsx": `
        import { supabase } from "@/integrations/supabase/client";
        export async function g3(flag: boolean, cols: string) {
          await supabase.from("posts").select(flag ? \`\${cols}, x:tags(id)\` : \`\${cols}, x:categories(id)\`).eq("x.id", 1);
        }
        g3(true, "id");
      `,
    });
    expect(f.observed.filters).toEqual([]);
    expect(f.observed.unresolvedFilters).toEqual([
      "src/b3.tsx: g3: .from(posts).eq(x.id): osadzenie bez tabeli w liście `select`",
    ]);
  });

  it("osadzenie: tabela z listy `select` łańcucha (także `referencedTable`); osadzenie spoza listy - nieczytelne", () => {
    const f = observed({
      "src/c.tsx": `
        import { supabase } from "@/integrations/supabase/client";
        export async function h() {
          await supabase.from("ads").select("id, slot:ad_slots!inner(status)").eq("slot.status", "active").eq("nope.x", 1);
          await supabase.from("menus").select("*, items:menu_items(*)").order("position", { referencedTable: "items" });
          await supabase.from("menus").select("id").or("name.eq.x", { foreignTable: "missing" });
        }
      `,
    });
    expect(filterKeys(f)).toEqual([
      "ad_slots.status:eq:select:authenticated@slot",
      "menu_items.position:order:select:authenticated@items",
    ]);
    expect(f.observed.unresolvedFilters).toEqual([
      "src/c.tsx: h: .from(ads).eq(nope.x): osadzenie bez tabeli w liście `select`",
      "src/c.tsx: h: .from(menus).or(missing.name): osadzenie bez tabeli w liście `select`",
    ]);
  });

  it("osadzenie z listy `select` składanej z parametru i stałej modułu (kształt `taxonomyPivot.ts`) - tabela ze stałej", () => {
    const f = observed({
      "src/lib/n/pivot.ts": `
        import { supabase } from "@/integrations/supabase/client";
        const EMBED = "post_categories!inner(category_id)";
        export function narrowed(cols: string, ids: string[]) {
          return supabase.from("posts").select(\`\${cols}, \${EMBED}\`).in("post_categories.category_id", ids);
        }
      `,
      "src/lib/n/use.ts": `
        import { narrowed } from "@/lib/n/pivot";
        narrowed("id, slug", []);
      `,
    });
    expect(filterKeys(f)).toEqual([
      "post_categories.category_id:in:select:authenticated@post_categories",
    ]);
    expect(f.observed.unresolvedFilters).toEqual([]);
  });

  it("upsert: SELECT na celu `onConflict` (bez niego - klucz główny) i na kolumnach ładunku (`EXCLUDED`), chyba że `ignoreDuplicates`", () => {
    const f = observed({
      "src/d.server.ts": `${ADMIN_FILE}
        export async function u(row: object) {
          await supabaseAdmin.from("prefs").upsert({ user_id: u, theme: "dark" }, { onConflict: "user_id" });
          await supabaseAdmin.from("prefs").upsert({ user_id: u }, { onConflict: "user_id", ignoreDuplicates: true });
          await supabaseAdmin.from("prefs").upsert({ id: i, theme: "x" });
          await supabaseAdmin.from("prefs").upsert(row, { onConflict: "user_id" });
        }
      `,
    });
    expect(filterKeys(f)).toEqual([
      "prefs.user_id:onConflict:upsert:service_role",
      "prefs.theme:upsert(EXCLUDED):upsert:service_role",
      "prefs.user_id:upsert(EXCLUDED):upsert:service_role",
      "prefs.user_id:onConflict:upsert:service_role",
      `prefs.${PRIMARY_KEY_COLUMNS}:onConflict:upsert:service_role`,
      "prefs.id:upsert(EXCLUDED):upsert:service_role",
      "prefs.theme:upsert(EXCLUDED):upsert:service_role",
      "prefs.user_id:onConflict:upsert:service_role",
    ]);
    expect(f.observed.unresolvedFilters).toEqual([
      "src/d.server.ts: u: .from(prefs).upsert: kolumny ładunku nieczytelne (EXCLUDED)",
    ]);
  });

  it("kolumna z warunku - oba warianty; z parametru - wartości z wywołań, plik literału", () => {
    const f = observed({
      "src/lib/e/by.ts": `
        import { supabase } from "@/integrations/supabase/client";
        export function byColumn(col: string) {
          return supabase.from("t").select("id").eq(col, 1);
        }
        export function byFlag(flag: boolean) {
          return supabase.from("t").select("id").eq(flag ? "a" : "b", 1);
        }
      `,
      "src/lib/e/use.ts": `
        import { byColumn } from "@/lib/e/by";
        byColumn("from_caller");
      `,
    });
    expect(f.observed.filters.map((x) => `${x.table}.${x.column}@${x.file}<-${x.site}`)).toEqual([
      "t.from_caller@src/lib/e/use.ts<-src/lib/e/by.ts",
      "t.a@src/lib/e/by.ts<-src/lib/e/by.ts",
      "t.b@src/lib/e/by.ts<-src/lib/e/by.ts",
    ]);
  });

  it("budowniczy przez wartość: parametr pomocnika (wszystkie wywołania), funkcja zwracająca budowniczego, `let` przypisywany", () => {
    const f = observed({
      "src/lib/f/apply.ts": `
        export function applyStatus<B>(q: B): B {
          return q.eq("status", "published");
        }
        export function applyAll<B>(q: B, lang: string): B {
          let out = q.is("deleted_at", null);
          out = applyLang(out, lang);
          return out;
        }
        function applyLang<B>(q: B, lang: string): B {
          return lang === "pl" ? q.not("title_pl", "is", null) : q;
        }
      `,
      "src/lib/f/use.tsx": `
        import { supabase } from "@/integrations/supabase/client";
        import { applyStatus, applyAll } from "@/lib/f/apply";
        export function a() { return applyStatus(supabase.from("posts").select("id")); }
        export function b() { return applyStatus(postsBase()); }
        function postsBase() { return supabase.from("pages").select("id"); }
        export function c() { return applyAll(supabase.from("posts").select("id"), "pl"); }
      `,
    });
    expect(filterKeys(f).sort()).toEqual([
      "pages.status:eq:select:authenticated",
      "posts.deleted_at:is:select:authenticated",
      "posts.status:eq:select:authenticated",
      "posts.title_pl:not:select:authenticated",
    ]);
    expect(f.observed.filtersOutsideChains).toEqual([]);
  });

  it("budowniczy przez wartość: wywołanie z wartością nieczytelną albo funkcja bez widocznych wywołań - bez faktu, na liście luk", () => {
    const f = observed({
      "src/lib/g/apply.ts": `
        export function applyStatus<B>(q: B): B {
          return q.eq("status", "published");
        }
        export function orphan<B>(q: B): B {
          return q.eq("orphan_col", 1);
        }
      `,
      "src/lib/g/use.tsx": `
        import { supabase } from "@/integrations/supabase/client";
        import { applyStatus } from "@/lib/g/apply";
        export function a(t: string) { return applyStatus(supabase.from("posts").select("id")); }
        export function b(other: unknown) { return applyStatus(other); }
      `,
    });
    expect(f.observed.filters).toEqual([]);
    expect(f.observed.filtersOutsideChains).toEqual([
      'src/lib/g/apply.ts: applyStatus: .eq("status")',
      'src/lib/g/apply.ts: orphan: .eq("orphan_col")',
    ]);
  });

  it("`let` przesłonięty w bloku wewnętrznym: przypisanie wewnętrznej zmiennej NIE przenosi kolumn na budowniczego zewnętrznego", () => {
    // Kształt `TaxonomyPicker` (LinkPicker.tsx): dwie zmienne `query` w dwóch
    // blokach. Pierwsza wersja miary przypisywała `name` do `categories`.
    const f = observed({
      "src/h.tsx": `
        import { supabase } from "@/integrations/supabase/client";
        export async function pick(kind: string, term: string) {
          if (kind === "category") {
            let query = supabase.from("categories").select("id, name_pl");
            if (term) query = query.or(\`name_pl.ilike.%\${term}%\`);
            return query;
          }
          let query = supabase.from("tags").select("id, name");
          if (term) query = query.or(\`name.ilike.%\${term}%\`);
          return query;
        }
      `,
    });
    expect(filterKeys(f)).toEqual([
      "categories.name_pl:or:select:authenticated",
      "tags.name:or:select:authenticated",
    ]);
  });

  it("filtr wyniku `.rpc()` i `Object.is(a, b)` to nie kolumny tabeli - ani faktu, ani luki", () => {
    const f = observed({
      "src/i.tsx": `
        import { supabase } from "@/integrations/supabase/client";
        export async function r(a: unknown, b: unknown) {
          await supabase.rpc("admin_export").order("section_sort").range(0, 9);
          document.documentElement.classList.contains("dark");
          return Object.is(a, b);
        }
      `,
    });
    expect(f.observed.filters).toEqual([]);
    expect(f.observed.filtersOutsideChains).toEqual([]);
    expect(f.observed.unresolvedFilters).toEqual([]);
  });

  it("tabela nieczytelna (`.from(table)`) - filtry na liście luk, nie fakty", () => {
    const f = observed({
      "src/j.tsx": `
        import { supabase } from "@/integrations/supabase/client";
        export async function s(table: string) {
          await supabase.from(table).select("id").eq("slug", "x");
        }
      `,
    });
    expect(f.observed.filters).toEqual([]);
    expect(f.observed.unresolvedFilters).toEqual([
      "src/j.tsx: s: .from(table).eq(…): tabela nieczytelna",
    ]);
  });

  it("listopad 2026: filtry `user_reports.reporter_id` (eksport RODO) i `profiles.current_company_id` (karta firmy CRM) są faktami z rolą klienta", () => {
    const f = observed({
      "src/lib/profile/export.functions.ts": `
        export const exportMyData = createServerFn().middleware([requireSupabaseAuth]).handler(async ({ context }) => {
          const { supabase, userId } = context;
          await supabase.from("user_reports").select("id, reason").eq("reporter_id", userId).order("created_at");
        });
      `,
      "src/lib/crm-companies.functions.ts": `
        import { looseTable } from "@/lib/supabase/looseQuery";
        export const getCrmCompany = createServerFn().handler(async ({ context, data }) => {
          await looseTable(context, "profiles").select("id").eq("current_company_id", data.id);
        });
      `,
      "src/lib/supabase/looseQuery.ts":
        "export function looseClient() {}\nexport function looseTable() {}",
    });
    expect(filterKeys(f)).toEqual([
      "user_reports.reporter_id:eq:select:authenticated",
      "user_reports.created_at:order:select:authenticated",
      "profiles.current_company_id:eq:select:authenticated",
    ]);
  });
});

describe("miara: rola klienta ustalona szerzej (nigdy zgadywana)", () => {
  it("fabryka klienta serwisowego (`await admin()`) - każdy `return` daje `service_role`", () => {
    const f = observed({
      "src/lib/x/admin.server.ts": `
        async function admin() {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          return supabaseAdmin;
        }
        async function maybeAdmin(flag: boolean) {
          if (flag) return null;
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          return supabaseAdmin;
        }
        async function mixed(flag: boolean) {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          return flag ? supabaseAdmin : other;
        }
        export async function a() {
          const supabase = await admin();
          await supabase.from("t_factory").select("id");
          await (await admin()).rpc("fn_factory");
          await (await maybeAdmin(true))!.from("t_nullable").select("id");
          await (await mixed(true)).from("t_mixed").select("id");
        }
      `,
    });
    expect(roleKeys(f)).toEqual([
      "rpc fn_factory: unknown -> service_role",
      "select t_factory: unknown -> service_role",
      "select t_nullable: unknown -> service_role",
      "select t_mixed: unknown -> unknown",
    ]);
    expect(f.observed.tables[0].via).toBe("const supabase <- admin() <- bramka: supabaseAdmin");
  });

  it("parametr klienta: WSZYSTKIE wywołania (także z innego pliku i `await import`) muszą dać tę samą rolę", () => {
    const f = observed({
      "src/lib/x/load.server.ts": `
        import type { SupabaseClient } from "@supabase/supabase-js";
        export async function load(supabase: SupabaseClient) { await supabase.from("t_param").select("id"); }
        export async function loadMixed(supabase: SupabaseClient) { await supabase.from("t_mixed").select("id"); }
        export async function loadDyn(supabase: SupabaseClient) { await supabase.from("t_dyn").select("id"); }
        export async function loadOpts(opts: { supabase: SupabaseClient }) { await opts.supabase.from("t_opts").select("id"); }
        export async function loadNone(supabase: SupabaseClient) { await supabase.from("t_none").select("id"); }
      `,
      "src/lib/x/a.functions.ts": `
        import { load, loadMixed, loadOpts } from "@/lib/x/load.server";
        export const f = createServerFn().handler(async ({ context }) => {
          await load(context.supabase);
          await loadMixed(context.supabase);
          const { loadDyn } = await import("@/lib/x/load.server");
          await loadDyn(context.supabase);
          await loadOpts({ supabase: context.supabase });
        });
      `,
      "src/lib/x/b.server.ts": `
        import { loadMixed } from "@/lib/x/load.server";
        export async function g() {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          await loadMixed(supabaseAdmin);
        }
      `,
    });
    expect(roleKeys(f)).toEqual([
      "select t_param: unknown -> authenticated",
      "select t_mixed: unknown -> unknown",
      "select t_dyn: unknown -> authenticated",
      "select t_opts: unknown -> authenticated",
      "select t_none: unknown -> unknown",
    ]);
    expect(f.observed.tables[1].via).toContain("role [authenticated, service_role]");
    expect(f.observed.tables[4].via).toContain("argument pominięty we wszystkich wywołaniach");
  });

  it("funkcja z odwołaniem innym niż wywołanie (wartość, `export { f }`, przestrzeń nazw, `import()` bez rozkładu) - `unknown`", () => {
    const base = `
      import type { SupabaseClient } from "@supabase/supabase-js";
      export async function load(supabase: SupabaseClient) { await supabase.from("t").select("id"); }
    `;
    const caller = `
      import { load } from "@/lib/x/load.server";
      export const f = createServerFn().handler(async ({ context }) => { await load(context.supabase); });
    `;
    const roleWith = (extra: Record<string, string>): string =>
      observed({ "src/lib/x/load.server.ts": base, "src/lib/x/a.functions.ts": caller, ...extra })
        .observed.tables[0].role;
    expect(roleWith({})).toBe("authenticated");
    expect(
      roleWith({
        "src/lib/x/c.ts": `import { load } from "@/lib/x/load.server";\n[db].map(load);`,
      }),
    ).toBe("unknown");
    expect(
      roleWith({ "src/lib/x/c.ts": `import * as m from "@/lib/x/load.server";\nm.load(db);` }),
    ).toBe("unknown");
    expect(roleWith({ "src/lib/x/c.ts": `export { load } from "@/lib/x/load.server";` })).toBe(
      "unknown",
    );
    expect(
      roleWith({
        "src/lib/x/c.ts": `export async function g(db: unknown) {\n  const mod = await import("@/lib/x/load.server");\n  await mod.load(db);\n}`,
      }),
    ).toBe("unknown");
    expect(
      roleWith({
        "src/lib/x/c.ts": `export const g = createServerFn().handler(async ({ context }) => {
          await (await import("@/lib/x/load.server")).load(context.supabase);
        });`,
      }),
    ).toBe("authenticated");
  });

  it("`createClient`: klucz serwisowy - `service_role`, publiczny - `anon`, publiczny z `Authorization` - `authenticated`, opcje nieczytelne - `unknown`", () => {
    const f = observed({
      "src/lib/y/clients.server.ts": `
        import { createClient } from "@supabase/supabase-js";
        const svc = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
        const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";
        const pub = createClient(process.env.SUPABASE_URL!, key, { auth: { persistSession: false } });
        export async function h(token: string, opts: object, host: string | null) {
          const user = createClient(process.env.SUPABASE_URL!, key, { global: { headers: { Authorization: \`Bearer \${token}\` } } });
          const odd = createClient(process.env.SUPABASE_URL!, key, opts);
          const tagged = createClient(process.env.SUPABASE_URL!, key, { global: host ? { headers: { "x-tenant-host": host } } : {} });
          const other = createClient(process.env.SUPABASE_URL!, process.env.SOMETHING_ELSE!);
          await svc.from("t_svc").select("id");
          await pub.from("t_pub").select("id");
          await user.from("t_user").select("id");
          await odd.from("t_odd").select("id");
          await tagged.from("t_tagged").select("id");
          await other.from("t_other").select("id");
        }
      `,
    });
    expect(roleKeys(f)).toEqual([
      "select t_svc: unknown -> service_role",
      "select t_pub: unknown -> anon",
      "select t_user: unknown -> authenticated",
      "select t_odd: unknown -> unknown",
      "select t_tagged: unknown -> anon",
      "select t_other: unknown -> unknown",
    ]);
  });

  it("przelotka (`rpcClient(admin)`), argument opcjonalny pomijany przez wywołujących i callback wołany w funkcji, której go oddano", () => {
    const f = observed({
      "src/lib/z/jobs.server.ts": `
        type Db = unknown;
        function rpcClient(admin: Db) { return admin as unknown as { rpc: Function }; }
        async function adminClient(client?: Db): Promise<Db> {
          if (client) return client;
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          return supabaseAdmin;
        }
        export async function tick(client?: Db) {
          const db = await adminClient(client);
          await rpcClient(db).rpc("fn_tick");
        }
        export async function route() { await tick(); }
        function withAdmin<T>(fn: (c: Db) => T): T {
          const { supabaseAdmin } = globalThis as never;
          return fn(supabaseAdmin);
        }
        export function useIt() {
          return withAdmin((c) => c.from("t_cb").select("id"));
        }
      `,
    });
    expect(roleKeys(f)).toEqual([
      "rpc fn_tick: unknown -> service_role",
      "select t_cb: unknown -> service_role",
    ]);
  });

  it("przelotka wołana różnymi klientami: rola z argumentu TEGO wywołania, nie zgodność wszystkich wywołań", () => {
    const f = observed({
      "src/lib/z/pass.functions.ts": `
        function asRpc(client: unknown) { return client as { rpc: Function }; }
        export const user = createServerFn().handler(async ({ context }) => {
          await asRpc(context.supabase).rpc("fn_user");
        });
        export async function job() {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          await asRpc(supabaseAdmin).rpc("fn_job");
        }
      `,
    });
    expect(roleKeys(f)).toEqual([
      "rpc fn_user: unknown -> authenticated",
      "rpc fn_job: unknown -> service_role",
    ]);
  });

  it("reguła nazwy `supabase` bramki a wiązanie: parametr wołany WYŁĄCZNIE klientem serwisowym - miara pokazuje rozjazd", () => {
    const f = observed({
      "src/lib/k/helper.functions.ts": `
        import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
        async function helper(supabase: unknown) { await supabase.from("t_helper").select("id"); }
        export const f = createServerFn().middleware([requireSupabaseAuth]).handler(async () => {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          await helper(supabaseAdmin);
        });
      `,
    });
    expect(roleKeys(f)).toEqual(["select t_helper: authenticated -> service_role"]);
    expect(f.tables.map((t) => t.role)).toEqual(["authenticated"]);
    expect(f.observed.tables[0].via).toContain("wiązanie zamiast reguły nazwy");
  });

  it("parametr z wartością domyślną: domyślna (argument pominięty) i KAŻDY podany argument muszą się zgadzać; reguła nazwy nie wygrywa", () => {
    const f = observed({
      "src/lib/k/menu.functions.ts": `
        import { createClient } from "@supabase/supabase-js";
        import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
        let cached: ReturnType<typeof make> | undefined;
        function make() {
          return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
            auth: { persistSession: false },
          });
        }
        function publicClient() {
          cached ??= make();
          return cached;
        }
        export async function readOmitted(supabase = publicClient()) {
          await supabase.from("t_omitted").select("id");
        }
        export async function readMixed(supabase = publicClient()) {
          await supabase.from("t_mixed").select("id");
        }
        export async function readPassed(supabase = publicClient()) {
          await supabase.from("t_passed").select("id");
        }
        export async function readDeep(key: string, supabase = publicClient()) {
          await supabase.from("t_deep").select("id").eq("key", key);
        }
        export async function readWire(key: string, supabase?: unknown) {
          await readDeep(key, supabase);
        }
        export async function readHidden(supabase = publicClient()) {
          await supabase.from("t_hidden").select("id");
        }
        export const handlers = [readHidden];
        export const f = createServerFn().middleware([requireSupabaseAuth]).handler(async ({ context }) => {
          await readOmitted();
          await readMixed();
          await readMixed(context.supabase);
          await readPassed(context.supabase);
          await readWire("main");
        });
      `,
    });
    expect(roleKeys(f)).toEqual([
      "select t_omitted: authenticated -> anon",
      "select t_mixed: authenticated -> unknown",
      "select t_passed: authenticated -> unknown",
      "select t_deep: authenticated -> anon",
      "select t_hidden: authenticated -> unknown",
    ]);
    // Bramka bez zmian: reguła nazwy `supabase` w pliku z `requireSupabaseAuth`.
    expect(f.tables.map((t) => t.role)).toEqual(Array(5).fill("authenticated"));
    const [omitted, mixed, passed, deep, hidden] = f.observed.tables;
    expect(omitted.via).toContain("wiązanie zamiast reguły nazwy (bramka: authenticated)");
    expect(omitted.via).toContain("domyślna publicClient()");
    expect(omitted.via).toContain("createClient(…, SUPABASE_PUBLISHABLE_KEY)");
    expect(mixed.via).toContain("role [anon, authenticated]");
    // Domyślna liczy się także wtedy, gdy dziś każdy wołający podaje argument.
    expect(passed.via).toContain("role [anon, authenticated]");
    // Argument opcjonalny wołającego, pomijany przez wszystkich - działa domyślna.
    expect(deep.via).toContain("parametr 2 funkcji readDeep z wartością domyślną <- domyślna");
    expect(hidden.via).toContain("reguła nazwy nie zgaduje (bramka: authenticated)");
    expect(hidden.via).toContain("nie każde odwołanie do funkcji to widoczne wywołanie");
    expect(filterKeys(f)).toEqual(["t_deep.key:eq:select:anon"]);
  });

  it("reguła nazwy `supabase` przy wiązaniu nieczytelnym (zmienna pętli, `var`, callback bez widocznych wywołań) - `unknown`; import i `import().then(({ supabase }))` - rola modułu", () => {
    const f = observed({
      "src/integrations/supabase/client.ts": "export const supabase = createBrowserClient();",
      "src/integrations/supabase/client.server.ts":
        "export const supabaseAdmin = new Proxy({}, {});",
      "src/components/k/Panel.tsx": `
        import { supabase } from "@/integrations/supabase/client";
        export async function viaImport() { await supabase.from("t_import").select("id"); }
        export async function viaLoop(clients: unknown[]) {
          for (const supabase of clients) await supabase.from("t_loop").select("id");
        }
        export async function viaVar() {
          var supabase = pick();
          await supabase.from("t_var").select("id");
        }
        export function viaCallback(p: Promise<{ supabase: unknown }>) {
          void p.then(async ({ supabase }) => { await supabase.from("t_promise").select("id"); });
        }
        export function viaThen() {
          void import("@/integrations/supabase/client").then(async ({ supabase }) => {
            await supabase.from("t_then").select("id");
          });
          void import("@/integrations/supabase/client.server").then(({ supabaseAdmin: supabase }) =>
            supabase.from("t_then_admin").select("id"),
          );
        }
      `,
    });
    expect(roleKeys(f)).toEqual([
      "select t_import: authenticated -> authenticated",
      "select t_loop: authenticated -> unknown",
      "select t_var: authenticated -> unknown",
      "select t_promise: authenticated -> unknown",
      "select t_then: authenticated -> authenticated",
      "select t_then_admin: authenticated -> service_role",
    ]);
    const via = f.observed.tables.map((t) => t.via);
    expect(via[1]).toBe(
      "reguła nazwy nie zgaduje (bramka: authenticated): supabase: zmienna pętli",
    );
    expect(via[2]).toBe("reguła nazwy nie zgaduje (bramka: authenticated): supabase: var");
    expect(via[3]).toContain(
      "reguła nazwy nie zgaduje (bramka: authenticated): parametr 1.supabase",
    );
    expect(via[0]).toBe("bramka: klient przeglądarki");
    expect(via[4]).toBe("bramka: klient przeglądarki");
    expect(via[5]).toBe(
      "wiązanie zamiast reguły nazwy (bramka: authenticated): import supabaseAdmin",
    );
  });

  it("klient z warunku o różnych rolach (`flag ? supabaseAdmin : context.supabase`) - `unknown`; ta sama rola w obu gałęziach - ta rola", () => {
    const f = observed({
      "src/lib/k/pick.functions.ts": `
        export const f = createServerFn().handler(async ({ context, data }) => {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const c = data.flag ? supabaseAdmin : context.supabase;
          await c.from("t_cond").select("id").eq("owner_id", data.id);
          await (data.flag ? context.supabase : context.supabase).rpc("fn_same");
        });
      `,
    });
    expect(roleKeys(f)).toEqual([
      "rpc fn_same: unknown -> authenticated",
      "select t_cond: unknown -> unknown",
    ]);
    expect(f.observed.tables[0].via).toContain("role [service_role, authenticated]");
    expect(filterKeys(f)).toEqual(["t_cond.owner_id:eq:select:unknown"]);
  });

  it("`createClient` z kluczem publicznym i opcją `accessToken` (funkcja albo metoda) - `authenticated`; bez niej - `anon`", () => {
    const f = observed({
      "src/lib/k/token.server.ts": `
        import { createClient } from "@supabase/supabase-js";
        export async function h(token: string) {
          const fnToken = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
            accessToken: async () => token,
          });
          const methodToken = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
            async accessToken() { return token; },
          });
          const plain = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
            auth: { persistSession: false },
          });
          await fnToken.from("t_fn").select("id");
          await methodToken.from("t_method").select("id");
          await plain.from("t_plain").select("id");
        }
      `,
    });
    expect(roleKeys(f)).toEqual([
      "select t_fn: unknown -> authenticated",
      "select t_method: unknown -> authenticated",
      "select t_plain: unknown -> anon",
    ]);
    expect(f.observed.tables[0].via).toBe(
      "const fnToken <- createClient(…, SUPABASE_PUBLISHABLE_KEY) z nagłówkiem Authorization",
    );
  });

  it("cykl wywołań i parametr przypisywany - `unknown`, przebieg się kończy", () => {
    const f = observed({
      "src/lib/m/cycle.server.ts": `
        export async function a(c: unknown) { await c.from("t_cycle").select("id"); await b(c); }
        export async function b(c: unknown) { await a(c); }
        export async function d(c: unknown) { c = other; await c.from("t_assigned").select("id"); }
        export async function e() { const { supabaseAdmin } = await import("@/integrations/supabase/client.server"); await d(supabaseAdmin); }
      `,
    });
    expect(roleKeys(f)).toEqual([
      "select t_cycle: unknown -> unknown",
      "select t_assigned: unknown -> unknown",
    ]);
  });
});

describe("miara: zapytania łańcuchów do sond wykonania", () => {
  const statementKeys = (f: SeamFacts): string[] =>
    f.observed.statements.map(
      (x) =>
        `${x.op} ${x.table} [${x.star ? "*" : x.columns.join(",")}] ` +
        `ładunek(${x.payload.join(",")}) where(${x.where.join(",")})` +
        (x.conflict === null ? "" : ` conflict(${x.conflict.join(",")})`) +
        ` ${x.role} ${x.fn}`,
    );

  it("odczyt: kolumny `select` i filtry tabeli łańcucha (bez osadzeń i bez celu upsertu); `head: true` - same filtry; powtórzone zapytanie raz", () => {
    const f = observed({
      "src/a.server.ts": `${ADMIN_FILE}
        export async function read() {
          await supabaseAdmin.from("orders").select("id, total, items:order_items(sku)")
            .eq("tenant_id", t).eq("items.sku", s).order("created_at");
          await supabaseAdmin.from("orders").select("id", { count: "exact", head: true }).is("deleted_at", null);
          await supabaseAdmin.from("orders").select("id, total, items:order_items(sku)")
            .eq("tenant_id", t).eq("items.sku", s).order("created_at");
          await supabaseAdmin.from("orders").select();
        }
      `,
    });
    expect(statementKeys(f)).toEqual([
      "select orders [id,total] ładunek() where(tenant_id,created_at) service_role read",
      "select orders [] ładunek() where(deleted_at) service_role read",
      "select orders [*] ładunek() where() service_role read",
    ]);
    // Filtr osadzenia zostaje faktem filtra (sonda kolumny osobno), nie WHERE łańcucha.
    expect(filterKeys(f)).toContain("order_items.sku:eq:select:service_role@items");
  });

  it("zapis: ładunek, WHERE tylko w UPDATE/DELETE, RETURNING z `select` po zapisie, cel `ON CONFLICT` (bez `onConflict` - klucz główny)", () => {
    const f = observed({
      "src/a.server.ts": `${ADMIN_FILE}
        export async function write() {
          await supabaseAdmin.from("orders").update({ status: "x" }).eq("id", id).select("id, status");
          await supabaseAdmin.from("orders").delete().match({ tenant_id: t });
          await supabaseAdmin.from("orders").insert({ id, total }).select();
          await supabaseAdmin.from("prefs").upsert({ user_id: u, theme: "d" }, { onConflict: "user_id" });
          await supabaseAdmin.from("prefs").upsert({ user_id: u }, { ignoreDuplicates: true });
          await supabaseAdmin.from("prefs").upsert({ user_id: u }, { onConflict: target });
          await supabaseAdmin.from("prefs").upsert(rows).select("id");
          await supabaseAdmin.from("prefs").upsert(rows, { onConflict: "user_id" }).select("id");
        }
      `,
    });
    expect(statementKeys(f)).toEqual([
      "update orders [id,status] ładunek(status) where(id) service_role write",
      "delete orders [] ładunek() where(tenant_id) service_role write",
      "insert orders [*] ładunek(id,total) where() service_role write",
      "upsert prefs [] ładunek(theme,user_id) where() conflict(user_id) service_role write",
      `upsert_ignore prefs [] ładunek(user_id) where() conflict(${PRIMARY_KEY_COLUMNS}) service_role write`,
      // Cel nieczytelny - pusty, nie klucz główny (sonda: `ON CONFLICT DO NOTHING`).
      "upsert prefs [] ładunek(user_id) where() conflict() service_role write",
      // Ładunek nieczytelny - bez faktu zapisu; zostaje odczyt RETURNING, a cel
      // `ON CONFLICT` (także znacznik klucza głównego) to nie WHERE.
      "select prefs [id] ładunek() where() service_role write",
    ]);
  });

  it("budowniczy w zmiennej: zapytanie to łańcuch wprost RAZEM z każdym użyciem osobno (nie suma wszystkich użyć)", () => {
    const f = observed({
      "src/a.server.ts": `${ADMIN_FILE}
        export async function bound() {
          const base = supabaseAdmin.from("orders").select("id");
          await base.eq("status", "open");
          await base.eq("owner_id", o).order("total");
          const upd = supabaseAdmin.from("orders").update({ status: "closed" });
          await upd.eq("id", id).select("id");
          const bare = supabaseAdmin.from("invoices");
          await bare.select("number").eq("tenant_id", t);
          await bare.select("total").eq("owner_id", o);
        }
      `,
    });
    expect(statementKeys(f)).toEqual([
      "select orders [id] ładunek() where(status) service_role bound",
      "select orders [id] ładunek() where(owner_id,total) service_role bound",
      "update orders [id] ładunek(status) where(id) service_role bound",
      // Bez łańcucha wprost: każde użycie to osobne zapytanie z WŁASNYM `select`.
      "select invoices [number] ładunek() where(tenant_id) service_role bound",
      "select invoices [total] ładunek() where(owner_id) service_role bound",
    ]);
  });

  it("render: zapytania i sondy - SELECT … LIMIT 1, zapis jako EXPLAIN, RPC tylko SECURITY INVOKER z EXECUTE, rola i JWT w podtransakcji z wartownikiem, naruszenie tylko 42501 „permission denied for”", () => {
    const f = observed({
      "src/a.server.ts": `${ADMIN_FILE}
        export async function write() {
          await supabaseAdmin.from("orders").update({ status: "x" }).eq("id", id).select("id");
        }
      `,
    });
    const sql = renderObservedQueries(f);
    expect(sql).toContain(
      "('orders', 'update', 'service_role', 'service_role', ARRAY['id']::text[], false, ARRAY['status']::text[], ARRAY['id']::text[], NULL::text[],",
    );
    // Odczyt dla JEDNEGO wiersza (kolumny widoku i funkcje wiersza liczą się),
    // kolumny filtrów zostają w WHERE dla uprawnień, `OR true` nie odrzuca wiersza.
    expect(sql).toContain("format('SELECT %s FROM public.%I%s LIMIT 1'");
    expect(sql).toContain(
      "coalesce(' WHERE (' || pg_temp.ts_list(s.where_cols, '%I IS NULL', ' AND ') || ') OR true', '') AS clause) ws",
    );
    expect(sql).not.toContain("LIMIT 0");
    expect(sql).toContain("format('EXPLAIN UPDATE public.%I SET %s%s%s'");
    expect(sql).toContain("pg_temp.ts_list(s.payload, '%I = DEFAULT', ', ')");
    expect(sql).toContain("pg_temp.ts_list(s.payload, '%1$I = EXCLUDED.%1$I', ', ')");
    expect(sql).toContain("WHEN t.cols IS NULL THEN ' ON CONFLICT DO NOTHING'");
    expect(sql).toContain("format('SELECT FROM public.%I WHERE %I IS NULL LIMIT 1', f.rel, f.col)");
    expect(sql).toContain("WHERE r.role IN ('anon', 'authenticated')");
    expect(sql).toContain("AND NOT p.prosecdef AND p.prokind = 'f'");
    expect(sql).toContain("AND has_function_privilege(r.role, p.oid, 'EXECUTE')");
    expect(sql).toContain("PERFORM set_config('role', v_roles[i], true);");
    expect(sql).toContain("PERFORM set_config('request.jwt.claims',");
    expect(sql).toContain("RAISE SQLSTATE 'PRB00';");
    expect(sql).toContain("WHEN SQLSTATE 'PRB00' THEN");
    expect(sql).toContain(
      "WHEN v_state = '42501' AND v_msg LIKE 'permission denied for %' THEN 'brak uprawnienia'",
    );
    expect(sql).toContain("ARRAY(SELECT unnest(p.proargtypes::oid[]))");
    expect(sql).toContain("'execution-probe'");
    expect(sql).toContain("'privilege-check' AS caught_by");
    expect(sql.trimEnd().endsWith("ROLLBACK;")).toBe(true);
  });
});

describe("sondy wykonania: limit czasu, ASSERT i argumenty syntetyczne", () => {
  const f = observed({
    "src/a.server.ts": `${ADMIN_FILE}
      export async function write() {
        await supabaseAdmin.from("orders").update({ status: "x" }).eq("id", id).select("id");
      }
    `,
  });
  const gate = renderContractTest(f);
  const measure = renderObservedQueries(f);
  const runner = (sql: string): string => {
    const start = sql.search(/CREATE FUNCTION pg_temp\.(ts|obs)_probe_run\(\)/);
    expect(start).toBeGreaterThan(0);
    return sql.slice(start, sql.indexOf("END $run$;\n\nCREATE TEMP TABLE", start));
  };

  it("limit instrukcji uzbrajany na partię (DO najwyższego poziomu), partia kończy się sama, `lock_timeout` w podtransakcji sondy; ustawienia sesji wracają", () => {
    for (const [sql, probe] of [
      [gate, "ts_probe"],
      [measure, "obs_probe"],
    ] as const) {
      const batch = `DO $run$ BEGIN PERFORM pg_temp.${probe}_run(); END $run$;`;
      expect(sql.split(batch).length - 1).toBe(30);
      const armed = sql.indexOf("SET LOCAL statement_timeout = '10s';");
      const saved = sql.indexOf(
        `CREATE TEMP TABLE ${probe}_guc ON COMMIT DROP AS SELECT current_setting('statement_timeout') AS statement_timeout;`,
      );
      const restored = sql.indexOf(
        `DO $run$ BEGIN PERFORM set_config('statement_timeout', (SELECT statement_timeout FROM ${probe}_guc), true); END $run$;`,
      );
      const notRun = sql.indexOf(
        `UPDATE ${probe} SET outcome = 'nie uruchomiona' WHERE sql IS NOT NULL AND state IS NULL;`,
      );
      expect(saved).toBeGreaterThan(0);
      expect(armed).toBeGreaterThan(saved);
      expect(sql.indexOf(batch)).toBeGreaterThan(armed);
      expect(restored).toBeGreaterThan(sql.lastIndexOf(batch));
      expect(notRun).toBeGreaterThan(restored);
      // \`set_config\` limitu instrukcji WEWNĄTRZ bloku nie działa - tylko przywrócenie.
      expect(sql).not.toMatch(/set_config\('statement_timeout', '/);
      const body = runner(sql);
      expect(body).toContain(
        "EXIT WHEN clock_timestamp() - statement_timestamp() > interval '2s';",
      );
      const lock = body.indexOf("PERFORM set_config('lock_timeout', '5s', true);");
      const exec = body.indexOf("EXECUTE v_sqls[i];");
      const sentinel = body.indexOf("RAISE SQLSTATE 'PRB00';");
      expect(lock).toBeGreaterThan(0);
      expect(exec).toBeGreaterThan(lock);
      expect(sentinel).toBeGreaterThan(exec);
      expect(sql.trimEnd().endsWith("ROLLBACK;")).toBe(true);
    }
  });

  it("ASSERT (P0004) i limit czasu (57014) łapane jawnie - WHEN OTHERS ich nie łapie; anulowanie z zewnątrz przerywa plik; limit i blokada - naruszenie z plikiem i funkcją", () => {
    for (const sql of [gate, measure]) {
      const body = runner(sql);
      const explicit = body.indexOf("WHEN assert_failure OR query_canceled THEN");
      expect(explicit).toBeGreaterThan(body.indexOf("WHEN SQLSTATE 'PRB00' THEN"));
      expect(body.indexOf("WHEN OTHERS THEN")).toBeGreaterThan(explicit);
      expect(body).toContain(
        "IF v_state = '57014' AND NOT (clock_timestamp() - statement_timestamp() >= interval '10s' - interval '1 s') THEN\n            RAISE;",
      );
      // Osłona MIĘDZY sondami i przy zapisie wyników - limit nie przerywa pliku.
      expect(body.split("EXCEPTION WHEN query_canceled THEN").length - 1).toBe(2);
      expect(body).toContain("v_stop := v_state = '57014';");
      expect(sql).toContain("WHEN v_state IN ('57014', '55P03') THEN 'przekroczony czas'");
    }
    expect(gate).toContain(
      "coalesce(p.state, '-'), coalesce(p.msg, p.outcome)) AS msg\n  FROM ts_probe p\n WHERE p.outcome IN ('brak uprawnienia', 'brak obiektu', 'przekroczony czas', 'nie uruchomiona')\nUNION",
    );
    // P0004 nie ma własnej gałęzi klasyfikacji - to „inny blad”, nie naruszenie.
    expect(gate).not.toContain("'P0004'");
  });

  it("RPC: druga sonda z argumentami syntetycznymi (stałe wartości typów, bez losowości); funkcja bez argumentów - jedna", () => {
    for (const sql of [gate, measure]) {
      expect(sql).toContain("CREATE FUNCTION pg_temp.ts_synth(p_type oid, p_depth int DEFAULT 0)");
      expect(sql).toContain(
        "WHEN p_type = 'uuid'::regtype THEN '00000000-0000-4000-8000-0000000000aa'",
      );
      expect(sql).toContain(
        "FROM pg_enum e WHERE e.enumtypid = p_type ORDER BY e.enumsortorder LIMIT 1;",
      );
      expect(sql).toContain(
        "RETURN format('(%s)::%s', pg_temp.ts_synth(t.typbasetype, p_depth + 1), v_name);",
      );
      expect(sql).toContain("SELECT format('ROW(%s)::%s'");
      expect(sql).toContain(
        "RETURN format('ARRAY[%s]::%s', pg_temp.ts_synth(t.typelem, p_depth + 1), v_name);",
      );
      expect(sql).toContain("CASE WHEN p_synth THEN pg_temp.ts_synth(v_types[i])");
      expect(sql).toContain(
        "SELECT 'probe-rpc-synth', s.args, s.args <> pg_temp.ts_rpc_args(p.oid, r.keys)\n           FROM (SELECT pg_temp.ts_rpc_args(p.oid, r.keys, true) AS args) s) a",
      );
      expect(sql).toContain("   AND a.differs;");
      expect(sql).not.toMatch(/random|clock_timestamp\(\)::text|now\(\)::text/);
    }
  });
});

describe("sondy wykonania: sonda RPC pusta i wyzwalacze SECURITY INVOKER zapisów klienta", () => {
  const BROWSER = `import { supabase } from "@/integrations/supabase/client";`;
  const f = observed({
    "src/lib/x/bookmarks.ts": `${BROWSER}
      export async function toggle(id: string) {
        await supabase.from("user_bookmarks").insert({ entity_id: id, entity_type: "post" });
        await supabase.from("profiles").update({ bio_pl: "x" }).eq("id", id);
        await supabase.rpc("resolve_path", { _segments: ["a"] });
      }
    `,
  });
  const reach = new Map([["src/lib/x/bookmarks.ts", { cls: "public", entry: "/", path: [] }]]);

  it("liczniki odczytów relacji sesji (`pg_stat_get_xact_*`) dla sond RPC; pusta sonda (NULL i syntetyczne bez błędu i bez odczytu) - naruszenie 16/19, chyba że wpis RPC_PROBE_VACUOUS_REVIEWED (nieaktualny - też naruszenie)", () => {
    const sql = renderContractTest(f, {}, { reach });
    expect(sql).toContain("bool_or(kind LIKE 'probe-rpc%') AS rpc FROM ts_probe");
    expect(sql).toContain("IF current_setting('track_counts')::boolean THEN");
    expect(sql).toContain(
      "SELECT sum(pg_stat_get_xact_numscans(o) + pg_stat_get_xact_tuples_returned(o)\n                     + pg_stat_get_xact_tuples_fetched(o))\n            INTO v_before FROM unnest(v_rels) o;",
    );
    expect(sql).toContain("touched = x.touched");
    // Gałąź naruszenia (przed gałęzią wpisów nieaktualnych listy).
    expect(sql).toContain(
      "HAVING bool_and(p.state = '00000') AND sum(p.touched) = 0\nUNION\nSELECT false, 'RPC_PROBE_VACUOUS_REVIEWED', r.fn,",
    );
    expect(sql).toContain("WHERE p.kind LIKE 'probe-rpc%' AND p.rel <> ALL ('{}'::text[])");
    const reviewed = renderContractTest(f, {}, { reach, rpcProbeVacuous: { pure_fn: "test" } });
    expect(reviewed).toContain(
      "WHERE p.kind LIKE 'probe-rpc%' AND p.rel <> ALL (ARRAY['pure_fn']::text[])",
    );
    expect(reviewed).toContain("RPC_PROBE_VACUOUS_REVIEWED: %s - wpis nieaktualny");
    expect(RPC_PROBE_VACUOUS_REVIEWED).toEqual({});
  });

  it("asercja 20: wyzwalacz SECURITY INVOKER odpalany operacją zapisu klienta (UPDATE OF - tylko z kolumną w ładunku) - wpis z md5 bieżącego ciała albo SECURITY DEFINER; wpis bez wyzwalacza - nieaktualny", () => {
    const sql = renderContractTest(f, {}, { reach });
    expect(sql).toContain("CREATE TEMP VIEW ts_v_trigger AS");
    expect(sql).toContain("tg.tgenabled <> 'D' AND NOT p.prosecdef");
    expect(sql).toContain(
      "JOIN ts_obs_stmt s ON s.rel = t.rel AND s.role IN ('anon', 'authenticated')",
    );
    expect(sql).toContain(
      "WHERE ((t.tgtype & 4) <> 0 AND s.op IN ('insert', 'upsert', 'upsert_ignore'))\n      OR ((t.tgtype & 16) <> 0 AND s.op IN ('update', 'upsert')\n          AND (cardinality(t.cols) = 0 OR t.cols && s.payload))\n      OR ((t.tgtype & 8) <> 0 AND s.op = 'delete')",
    );
    expect(sql).toContain("WHERE r.md5 IS DISTINCT FROM f.md5");
    expect(sql).toContain("'brak wpisu INVOKER_TRIGGERS_REVIEWED (md5 ' || f.md5 || ')'");
    expect(sql).toContain(
      "wpis nieaktualny (zaden wyzwalacz SECURITY INVOKER tej funkcji nie odpala sie zapisem klienta)",
    );
    expect(sql).toContain("ARRAY(SELECT DISTINCT msg FROM ts_v_trigger ORDER BY 1)");
    // Zapis klienta niesie wiersz zapytania - wejście asercji 20 (także gość).
    expect(sql).toContain("('user_bookmarks', 'insert', 'authenticated',");
    expect(sql).toContain("('user_bookmarks', 'insert', 'anon',");
    // Lista z repozytorium trafia do pliku; własna lista wejścia zastępuje ją.
    expect(sql).toContain("('public.set_updated_at', '301a884953d37769916294bb60562e05')");
    const own = renderContractTest(
      f,
      {},
      {
        reach,
        invokerTriggers: { "public.rev_trg": { md5: "0".repeat(32), reason: "test" } },
      },
    );
    expect(own).toContain("('public.rev_trg', '00000000000000000000000000000000')");
    expect(own).not.toContain("'public.set_updated_at'");
  });

  it("lista INVOKER_TRIGGERS_REVIEWED: klucz `schemat.funkcja`, md5 32 znaki hex, powód; posortowana i bez powtórzeń w pliku", () => {
    const entries = Object.entries(INVOKER_TRIGGERS_REVIEWED);
    expect(entries.length).toBe(21);
    for (const [key, entry] of entries) {
      expect(key).toMatch(/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/);
      expect(entry.md5).toMatch(/^[0-9a-f]{32}$/);
      expect(entry.reason.length).toBeGreaterThan(20);
    }
    const sql = renderContractTest(f, {}, { reach });
    const rows = sql
      .split("\n")
      .filter((line) => /^\s*\('public\.[a-z_0-9]+', '[0-9a-f]{32}'\)/.test(line));
    expect(rows).toHaveLength(entries.length);
    expect([...rows].sort()).toEqual(rows);
  });
});

describe("miara: kolumny wyniku funkcji w łańcuchu `.rpc(...)`", () => {
  const rpcKeys = (x: SeamFacts): string[] =>
    x.observed.rpcColumns.map(
      (c) => `${c.name}(${(c.keys ?? ["?"]).join(",")}).${c.column}:${c.method} ${c.fn}`,
    );

  it("filtry, sortowanie i `select` wyniku - wprost i przez zmienną; kolumna nieczytelna i osadzenie - miejsce nieczytelne; nazwa RPC nieczytelna - filtr wyniku nieczytelny (nie znika po cichu)", () => {
    const x = observed({
      "src/a.server.ts": `${ADMIN_FILE}
        export async function direct() {
          await supabaseAdmin.rpc("seating_export", { p_payload: {} }).order("section_sort").eq("seat_id", 1).select("seat_id, label:section_label");
        }
        export async function bound(col: string) {
          const q = supabaseAdmin.rpc("list_rows");
          await q.or("a.eq.1,b.eq.2");
          await q.order(col);
          await q.eq("rel.col", 1);
        }
        export async function unnamed(name: string) {
          await supabaseAdmin.rpc(name).order("x");
        }
      `,
    });
    expect(rpcKeys(x)).toEqual([
      "seating_export(p_payload).section_sort:order direct",
      "seating_export(p_payload).seat_id:eq direct",
      "seating_export(p_payload).seat_id:select direct",
      "seating_export(p_payload).section_label:select direct",
      "list_rows().a:or bound",
      "list_rows().b:or bound",
    ]);
    expect(x.observed.unresolvedFilters).toEqual([
      "src/a.server.ts: bound: .rpc(list_rows).eq(rel.col): osadzenie na wyniku funkcji",
      "src/a.server.ts: bound: .rpc(list_rows).order(col): kolumna ${…}",
      'src/a.server.ts: unnamed: .order("x"): wynik .rpc() poza obejrzanym łańcuchem',
    ]);
    expect(x.observed.filtersOutsideChains).toEqual([]);
    // Bramka bez miary - bez faktów wyniku.
    expect(
      extractSeamFacts([
        { file: "src/a.server.ts", code: `${ADMIN_FILE} supabaseAdmin.rpc("f").order("x");` },
      ]).observed.rpcColumns,
    ).toEqual([]);
  });

  it("render: istnienie kolumny w TABLE/OUT albo atrybutach zwracanego typu złożonego przeciążenia z kluczy (asercja 12); wynik bez kolumn - naruszenie; brak funkcji - asercja 2", () => {
    const x = observed({
      "src/a.server.ts": `${ADMIN_FILE}
        export async function direct() {
          await supabaseAdmin.rpc("seating_export", { p_payload: {} }).order("section_sort");
        }
      `,
    });
    for (const sql of [renderContractTest(x), renderObservedQueries(x)]) {
      expect(sql).toContain("CREATE FUNCTION pg_temp.ts_result_cols(p_oid oid)");
      expect(sql).toContain("WHERE p.oid = p_oid AND a.mode IN ('o', 'b', 't')),");
      expect(sql).toContain("WHERE p.oid = p_oid AND t.typtype = 'c'))");
      expect(sql).toContain(
        "SELECT pg_temp.ts_rpc_match(c.fn, c.keys) AS oid WHERE c.keys IS NOT NULL",
      );
      expect(sql).toContain("'wynik bez kolumn (skalar, json) - kolumny nie da sie sprawdzic'");
      expect(sql).toContain("WHERE r.has_cols IS NOT NULL AND NOT coalesce(r.found, false)");
    }
    const gate = renderContractTest(x);
    expect(gate).toContain(
      "('seating_export', ARRAY['p_payload']::text[], 'section_sort', 'order', 'src/a.server.ts', 'src/a.server.ts', 'direct')",
    );
    // Część widoku asercji 12.
    expect(gate).toContain(
      "                 AND a.attnum > 0 AND NOT a.attisdropped)))\nUNION\nSELECT c.site, c.func,",
    );
    expect(gate).toContain("FROM ts_obs_rpc_col c");
    expect(renderObservedQueries(x)).toContain(
      "SELECT 'rpc-result-column', r.site, r.func, NULL, NULL, NULL, NULL, r.msg, '-'",
    );
  });
});

describe("miara: klient przeglądarki - z sesją (`authenticated`) i jako gość (`anon`)", () => {
  const BROWSER = `import { supabase } from "@/integrations/supabase/client";`;
  const guestKeys = (f: SeamFacts): string[] => [
    ...f.observed.rpcs.map((r) => `rpc ${r.name}: ${r.role}${r.guest ? "+anon" : ""}`),
    ...f.observed.tables.map((t) => `${t.op} ${t.table}: ${t.role}${t.guest ? "+anon" : ""}`),
  ];

  it("import klienta przeglądarki (wprost, przez stałą, przez parametr) - `authenticated` + gość; `context.supabase`, klient serwisowy i `createClient` z kluczem publicznym - bez gościa", () => {
    const f = observed({
      "src/lib/x/public.ts": `${BROWSER}
        export async function read() {
          await supabase.from("t_direct").select("id");
          await supabase.rpc("fn_direct", { p: 1 });
          const db = supabase;
          await db.from("t_const").select("id");
          await helper(supabase);
        }
        async function helper(c: unknown) { await c.from("t_param").select("id"); }
      `,
      "src/lib/x/a.functions.ts": `
        export const f = createServerFn().handler(async ({ context }) => {
          await context.supabase.from("t_ctx").select("id");
        });
      `,
      "src/lib/x/b.server.ts": `${ADMIN_FILE}
        import { createClient } from "@supabase/supabase-js";
        export async function g() {
          await supabaseAdmin.from("t_admin").select("id");
          const pub = createClient(url, process.env.SUPABASE_PUBLISHABLE_KEY!);
          await pub.from("t_pub").select("id");
        }
      `,
      // Reguła nazwy bez wiązania w pliku z klientem przeglądarki - ten klient.
      "src/lib/x/c.ts": `import * as client from "@/integrations/supabase/client";
        export async function h() { await supabase.from("t_name").select("id"); }
      `,
    });
    expect(guestKeys(f)).toEqual([
      "rpc fn_direct: authenticated+anon",
      "select t_direct: authenticated+anon",
      "select t_const: authenticated+anon",
      "select t_param: authenticated+anon",
      "select t_ctx: authenticated",
      "select t_admin: service_role",
      "select t_pub: anon",
      "select t_name: authenticated+anon",
    ]);
  });

  it("parametr: klient przeglądarki w JEDNYM wywołaniu - zapytanie idzie też jako gość; `const supabase = context.supabase` w pliku z importem klienta przeglądarki - bez gościa", () => {
    const f = observed({
      "src/lib/x/load.ts": `
        export async function load(c: unknown) { await c.from("t_mixed").select("id"); }
      `,
      "src/lib/x/a.ts": `${BROWSER}
        import { load } from "@/lib/x/load";
        export async function viaBrowser() { await load(supabase); }
        export const f = createServerFn().handler(async ({ context }) => {
          await load(context.supabase);
          const supabase = context.supabase;
          await supabase.from("t_shadow").select("id");
        });
      `,
    });
    expect(guestKeys(f)).toEqual([
      "select t_mixed: authenticated+anon",
      "select t_shadow: authenticated",
    ]);
  });

  it("render: fakt klienta przeglądarki ma DRUGI wiersz z rolą `anon` (RPC, tabela, filtr, osadzenie, zapytanie sondy); inne fakty - jeden", () => {
    const f = observed({
      "src/lib/x/public.ts": `${BROWSER}
        export async function read() {
          await supabase.from("posts").select("id, author:profiles(slug)").eq("status", s);
          await supabase.rpc("fn_pub", { p: 1 });
        }
      `,
      "src/a.server.ts": `${ADMIN_FILE}
        export async function w() { await supabaseAdmin.from("orders").select("id").eq("tenant_id", t); }
      `,
    });
    const sql = renderObservedQueries(f);
    const guest = `'${GUEST_VIA} <- bramka: klient przeglądarki'`;
    expect(sql).toContain(
      `('fn_pub', ARRAY['p']::text[], 'authenticated', 'authenticated', 'bramka: klient przeglądarki'`,
    );
    expect(sql).toContain(`('fn_pub', ARRAY['p']::text[], 'anon', 'authenticated', ${guest}`);
    expect(sql).toContain(
      `('posts', 'select', 'anon', 'authenticated', ARRAY['id']::text[], false, ${guest}`,
    );
    expect(sql).toContain(
      `('posts', 'status', NULL, 'eq', 'select', 'anon', 'authenticated', ${guest}`,
    );
    expect(sql).toContain(
      `'author', 'profiles', NULL, ARRAY['slug']::text[], false, 'anon', 'authenticated', ${guest}`,
    );
    expect(sql).toContain(
      `('posts', 'select', 'anon', 'authenticated', ARRAY['id']::text[], false, '{}'::text[], ARRAY['status']::text[], NULL::text[], ${guest}`,
    );
    // Klient serwisowy - bez wiersza gościa.
    expect(sql).not.toMatch(/\('orders', [^\n]*'anon'/);
    expect(sql).toContain("wiersze goscia (klient przegladarki takze jako anon): 5.");
  });
});

describe("miara: zasoby osadzone listy `select` jako fakty relacji osadzonej", () => {
  it("element listy: alias, podpowiedź `!fk` (bez `!inner`/`!left`), rozkład; kolumna i agregat - nie osadzenie", () => {
    expect(selectEmbedItem("author:profiles!posts_author_id_fkey!inner(slug)")).toEqual({
      name: "author",
      rel: "profiles",
      hint: "posts_author_id_fkey",
      inner: "slug",
    });
    expect(selectEmbedItem("tags!left(id)")).toEqual({
      name: "tags",
      rel: "tags",
      hint: null,
      inner: "id",
    });
    expect(selectEmbedItem("...authors(name)")).toEqual({
      name: "authors",
      rel: "authors",
      hint: null,
      inner: "name",
    });
    expect(selectEmbedItem("owner:owner_id(id)")).toEqual({
      name: "owner",
      rel: "owner_id",
      hint: null,
      inner: "id",
    });
    expect(selectEmbedItem("count()")).toBeNull();
    expect(selectEmbedItem("total.sum()")).toBeNull();
    expect(selectEmbedItem("id")).toBeNull();
  });

  it("fakty osadzeń: zagnieżdżenie z rodzicem, `*`, licznik `rel(count)` bez kolumny `count`, osadzenie w RETURNING i z listy składanej parametrem; to samo osadzenie raz", () => {
    const f = observed({
      "src/a.server.ts": `${ADMIN_FILE}
        export async function read() {
          await supabaseAdmin.from("orders").select("id, buyer:profiles!orders_buyer_fkey(slug, org:organizations(*)), items:order_items(count)");
          await supabaseAdmin.from("orders").select("id, buyer:profiles!orders_buyer_fkey(slug, org:organizations(*)), items:order_items(count)");
          await supabaseAdmin.from("orders").insert({ id }).select("id, owner:owner_id(email)");
          await byColumns("id, plan:access_plans(name)");
        }
        async function byColumns(columns: string) {
          await supabaseAdmin.from("subs").select(columns);
        }
      `,
    });
    expect(
      f.observed.embeds.map(
        (e) =>
          `${e.id}<-${e.parentId ?? "-"} ${e.table} ${e.path} ${e.rel}${e.hint === null ? "" : `!${e.hint}`} [${e.star ? "*" : e.columns.join(",")}] ${e.role} ${e.fn}`,
      ),
    ).toEqual([
      "0<-- orders buyer profiles!orders_buyer_fkey [slug] service_role read",
      "1<-0 orders buyer.org organizations [*] service_role read",
      "2<-- orders items order_items [] service_role read",
      "3<-- orders owner owner_id [email] service_role read",
      "4<-- subs plan access_plans [name] service_role byColumns",
    ]);
    // Osadzenie nie zmienia faktów tabeli łańcucha ani pgTAP bramki.
    expect(new Set(f.observed.embeds.map((e) => e.enforcedRole))).toEqual(new Set(["unknown"]));
    expect(new Set(f.observed.embeds.map((e) => e.gateRole))).toEqual(new Set(["service_role"]));
  });

  it("render: relacja osadzenia jak PostgREST (nazwa, klucz obcy albo jego kolumna, rekurencja od tabeli łańcucha), sprawdzenie SELECT i sonda ze złączeniem po kluczu obcym", () => {
    const f = observed({
      "src/a.server.ts": `${ADMIN_FILE}
        export async function read() {
          await supabaseAdmin.from("orders").select("id, buyer:profiles(slug, org:organizations(name))");
        }
      `,
    });
    const sql = renderObservedQueries(f);
    expect(sql).toContain(
      "(0, NULL, 'orders', 'buyer', 'profiles', NULL, ARRAY['slug']::text[], false, 'service_role', 'service_role',",
    );
    expect(sql).toContain(
      "(1, 0, 'orders', 'buyer.org', 'organizations', NULL, ARRAY['name']::text[], false, 'service_role', 'service_role',",
    );
    expect(sql).toContain(
      "CREATE FUNCTION pg_temp.ts_embed(p_parent oid, p_rel text, p_hint text, OUT target oid, OUT fk oid)",
    );
    expect(sql).toContain(
      "WHERE c.contype = 'f' AND c.conrelid = p_parent\n       AND (c.conname = p_rel OR",
    );
    expect(sql).toContain("<> 'public'::regnamespace THEN");
    expect(sql).toContain("CROSS JOIN LATERAL pg_temp.ts_embed(r.target, e.rel, e.hint) x");
    expect(sql).toContain(
      "SELECT 'embed-column', m.site, m.func, c.relname::text, col.col, m.role, m.enforced,",
    );
    expect(sql).toContain("AND NOT has_column_privilege(m.role, x.target, col.col, 'SELECT'))");
    expect(sql).toContain(
      "format('SELECT %s FROM public.%I p JOIN public.%I t ON %s LIMIT 1', tc.list,",
    );
    expect(sql).toContain("THEN format('p.%I = t.%I', a.attname, b.attname)");
    expect(sql).toContain("CASE WHEN x.target IS NULL THEN 'relacja osadzenia nieczytelna' END");
    // Sondy bez wyniku, każda para (rola, instrukcja) raz, w partiach.
    expect(sql).toContain(
      "FROM (SELECT min(id) AS id, role, sql, bool_or(kind LIKE 'probe-rpc%') AS rpc FROM obs_probe\n           WHERE sql IS NOT NULL AND state IS NULL GROUP BY role, sql) g;",
    );
    expect(sql).toContain("DO $run$ BEGIN PERFORM pg_temp.obs_probe_run(); END $run$;");
  });
});

describe("miara: osiągalność pliku wywołania dla gościa w wierszach naruszeń", () => {
  it("wiersz `obs_reach` dla pliku z faktami (klasa, URL wejścia, ścieżka importów); bez miary osiągalności - kolumna `reach` to `-`", () => {
    const f = observed({
      "src/lib/x/public.ts": `import { supabase } from "@/integrations/supabase/client";
        export async function read() { await supabase.from("posts").select("id"); }
      `,
    });
    const reach = new Map([
      [
        "src/lib/x/public.ts",
        {
          cls: "public",
          entry: "/podcast/$slug",
          path: ["src/routes/podcast.$slug.tsx", "src/lib/x/public.ts"],
        },
      ],
      ["src/lib/x/other.ts", { cls: "admin", entry: "/admin", path: ["src/routes/admin.tsx"] }],
    ]);
    const sql = renderObservedQueries(f, reach);
    expect(sql).toContain(
      "INSERT INTO obs_reach (site, cls, entry, path) VALUES\n  ('src/lib/x/public.ts', 'public', '/podcast/$slug', 'src/routes/podcast.$slug.tsx > src/lib/x/public.ts');",
    );
    // Plik bez faktów miary nie trafia do tabeli.
    expect(sql).not.toContain("src/lib/x/other.ts");
    expect(sql).toContain(
      "coalesce(r.cls || ' ' || coalesce(r.entry, '') || ': ' || r.path, '-') AS reach",
    );
    expect(sql).toContain("LEFT JOIN obs_reach r ON r.site = x.site");
    expect(renderObservedQueries(f)).toContain("-- obs_reach: brak wierszy");
  });
});

describe("miara: rola bramki w wierszach sond i kolumn filtra", () => {
  it("zapytanie sondy niesie rolę bramki swoich faktów (zapis i RETURNING; sam `head: true` - rola klienta łańcucha); filtr i osadzenie - rolę bramki klienta łańcucha", () => {
    const f = observed({
      "src/a.server.ts": `${ADMIN_FILE}
        async function admin() { return supabaseAdmin; }
        export async function w() {
          await supabaseAdmin.from("orders").update({ status: "x" }).eq("id", id).select("id");
          await supabaseAdmin.from("orders").select("id", { count: "exact", head: true }).eq("tenant_id", t);
          const db = await admin();
          await db.from("orders").select("id, buyer:profiles(slug)").eq("status", s);
        }
      `,
    });
    expect(f.observed.statements.map((x) => `${x.op} ${x.role} ${x.enforcedRole}`)).toEqual([
      "update service_role service_role",
      "select service_role service_role",
      "select service_role unknown",
    ]);
    expect(f.observed.filters.map((x) => `${x.column} ${x.gateRole} ${x.enforcedRole}`)).toEqual([
      "id service_role unknown",
      "tenant_id service_role unknown",
      "status unknown unknown",
    ]);
    expect(f.observed.embeds.map((x) => x.gateRole)).toEqual(["unknown"]);
    const sql = renderObservedQueries(f);
    expect(sql).toContain(
      "('orders', 'update', 'service_role', 'service_role', ARRAY['id']::text[]",
    );
    expect(sql).toContain("('orders', 'id', NULL, 'eq', 'update', 'service_role', 'service_role',");
    expect(sql).toContain(
      "SELECT DISTINCT p.kind, p.site, p.func, p.rel, p.cols, p.role, p.enforced,",
    );
    expect(sql).toContain("s.role, s.enforced, s.via,");
    expect(sql).toContain(
      "'probe-filter', f.site, f.func, f.rel, f.col, f.role, f.enforced, f.via,",
    );
    expect(sql).toContain("r.role, r.enforced, r.via, format('SELECT public.%I(%s)'");
    expect(sql).toContain(
      "SELECT 'filter-column', f.site, f.func, f.rel, coalesce(f.col, '(klucz glowny?)'), f.role, f.enforced,",
    );
    // Żaden wiersz naruszenia nie wpisuje roli bramki literałem.
    expect(sql).not.toMatch(/p\.role, 'unknown'|f\.role, 'unknown'/);
  });

  it("fakt wstrzymany w przeglądzie - zapytanie sondy z rolą bramki `unknown`", () => {
    const code = `${ADMIN_FILE}
      export async function w() { await supabaseAdmin.from("orders").select("id, total"); }
    `;
    const reviewed = [
      {
        file: "src/a.server.ts",
        fn: "w",
        table: "orders",
        op: "select" as const,
        role: "service_role" as const,
        columns: ["id", "total"],
        reason: "test",
      },
    ];
    const f = extractSeamFacts([{ file: "src/a.server.ts", code }], NO_CONTRACTS, reviewed, {
      observe: true,
    });
    expect(f.withheld.length).toBe(1);
    expect(f.observed.statements.map((x) => `${x.role} ${x.enforcedRole}`)).toEqual([
      "service_role unknown",
    ]);
  });
});

/** Część pliku pgTAP z asercjami 1-9 (od `BEGIN;` do faktów miary) - bez nagłówka z liczbami miary. */
function gateAssertions(sql: string): string {
  return sql.slice(sql.indexOf("BEGIN;\n"), sql.indexOf("-- ── Fakty miary (asercje 10-20)"));
}

describe("miara w bramce: fakty bramki i asercje 1-9 bez zmian", () => {
  const files = {
    "src/a.server.ts": `${ADMIN_FILE}
      async function admin() { return supabaseAdmin; }
      export async function f() {
        const db = await admin();
        await db.from("orders").select("id, total").eq("tenant_id", t).order("created_at");
        await db.rpc("fn_x", { p: 1 });
        await supabaseAdmin.from("prefs").upsert({ user_id: u, theme: "dark" }, { onConflict: "user_id" });
      }
    `,
  };
  const sources = Object.entries(files).map(([file, code]) => ({ file, code }));

  it("bez `observe` - `observed` puste; z `observe` - te same fakty i zasięg, asercje 1-9 bajt w bajt, rola zmierzona w asercjach 10-20", () => {
    const plain = extractSeamFacts(sources, NO_CONTRACTS, []);
    const measured = extractSeamFacts(sources, NO_CONTRACTS, [], { observe: true });
    expect(plain.observed).toEqual({
      rpcs: [],
      tables: [],
      filters: [],
      embeds: [],
      statements: [],
      rpcColumns: [],
      unresolvedFilters: [],
      filtersOutsideChains: [],
    });
    expect(measured.observed.filters.length).toBeGreaterThan(0);
    expect(measured.observed.tables.map((t) => t.role)).toEqual(["service_role", "service_role"]);
    const { observed: _a, ...plainRest } = plain;
    const { observed: _b, ...measuredRest } = measured;
    expect(measuredRest).toEqual(plainRest);
    // Asercje 1-9 i ich tabele: te same co bez miary (rola bramki `unknown`
    // dla `db` zostaje w `ts_table`).
    expect(gateAssertions(renderContractTest(measured))).toBe(
      gateAssertions(renderContractTest(plain)),
    );
    expect(renderContractTest(measured)).toContain("'orders', 'select', 'unknown'");
    // Rola zmierzona (`service_role` z fabryki `admin()`) - w faktach miary.
    expect(renderContractTest(measured)).toContain(
      "('orders', 'select', 'service_role', 'unknown', ARRAY['id', 'total']::text[], false,",
    );
    expect(renderContractTest(plain)).toContain("-- ts_obs_table: brak wierszy");
  });

  it("zapytania miary niosą fakty filtrów (klucz główny jako NULL), role zmierzone i sprawdzają SELECT", () => {
    const measured = observed({
      ...files,
      "src/b.server.ts": `${ADMIN_FILE}\nawait supabaseAdmin.from("prefs").upsert({ id: i });`,
    });
    const sql = renderObservedQueries(measured);
    expect(sql).toContain("('orders', 'tenant_id', NULL, 'eq', 'select', 'service_role'");
    expect(sql).toContain("('prefs', NULL, NULL, 'onConflict', 'upsert', 'service_role'");
    expect(sql).toContain(
      "('orders', 'select', 'service_role', 'unknown', ARRAY['id', 'total']::text[]",
    );
    expect(sql).toContain(
      "has_column_privilege(f.role, to_regclass('public.' || quote_ident(f.rel)), f.col, 'SELECT')",
    );
    expect(sql).toContain("i.indisprimary");
    expect(sql).toContain("('anon', 'authenticated', 'service_role')");
  });
});

// ── Bramka z miary (asercje 10-20) ──────────────────────────────────────────
//
// Klasa defektów z listopada 2026, której bramka nie widziała (złapała ją
// dopiero miara): kolumna sortowania, której nie ma (`views_count`), odczyt
// klientem użytkownika przez parametr pomocnika (rola nieznana bramce),
// klient przeglądarki wykonany przez gościa, osadzenie bez grantu, widok
// `security_invoker` widoczny tylko dla sondy wykonania. Tu: każdy taki fakt
// trafia do pgTAP z właściwą rolą; decyzję podejmuje baza (job `pgtap`).

const BROWSER_IMPORT = `import { supabase } from "@/integrations/supabase/client";`;
const AUTH_IMPORT = `import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";`;

const NOVEMBER = {
  // Bilety: `profiles.email` klientem z sesji przez parametr pomocnika.
  "src/lib/tickets.functions.ts": `${AUTH_IMPORT}
    async function readBuyer(client, id) { return client.from("profiles").select("email").eq("id", id); }
    export const myTicket = createServerFn().middleware([requireSupabaseAuth]).handler(async ({ context }) => readBuyer(context.supabase, 1));
  `,
  // Archiwum: sortowanie po kolumnie, której nie ma; szablon sekcji klientem przeglądarki.
  "src/lib/queries/archives.ts": `${BROWSER_IMPORT}
    export async function popular() { return supabase.from("posts").select("id, slug").order("views_count", { ascending: false }); }
    export async function featured() { return supabase.from("builder_templates").select("id, content").eq("slot", "archive_featured"); }
  `,
  // Podcast: osoby odcinka z osadzeniem `profiles(...)`.
  "src/lib/queries/podcasts.ts": `${BROWSER_IMPORT}
    export async function people() { return supabase.from("podcast_episode_people").select("role, profiles(slug, display_name)").eq("episode_id", 1); }
  `,
  // CRM: widok `security_invoker` klientem z sesji - widzi go sonda.
  "src/lib/crm/funnel.functions.ts": `${AUTH_IMPORT}
    export const funnel = createServerFn().middleware([requireSupabaseAuth]).handler(async ({ context }) => context.supabase.from("crm_funnel_view").select("stage, leads"));
  `,
};

const PUBLIC_REACH: ReadonlyMap<string, SiteReach> = new Map([
  ["src/lib/queries/archives.ts", { cls: "public", entry: "/kategoria/$slug", path: [] }],
  ["src/lib/queries/podcasts.ts", { cls: "public", entry: "/podcast", path: [] }],
]);

describe("bramka z miary: fakty listopadowych defektów idą do pgTAP z rolą", () => {
  const f = observed(NOVEMBER);
  const sql = renderContractTest(f, {}, { reach: PUBLIC_REACH, guestLoginOnly: {} });

  it("rola nieznana bramce, ustalona przez miarę (parametr pomocnika z klientem sesji) - fakt tabeli z rolą zmierzoną, plikiem i funkcją", () => {
    expect(sql).toContain(
      "('profiles', 'select', 'authenticated', 'unknown', ARRAY['email']::text[], false, 'parametr 1 funkcji readBuyer (1 wywołań) <- bramka: context.supabase', false, 'src/lib/tickets.functions.ts', 'src/lib/tickets.functions.ts', 'readBuyer')",
    );
    // Asercja 11 sprawdza fakt TYLKO tam, gdzie rola zmierzona różni się od
    // roli bramki (tę samą sprawdza asercja 5) - i nazywa plik i funkcję.
    expect(sql).toContain("WHERE (t.guest OR t.role IS DISTINCT FROM t.enforced)");
    expect(sql).toContain(
      "format('%s: %s: %s.%s %s dla %s: brak %s (rola: %s%s)', t.site, t.func,",
    );
    expect(sql).toContain(
      "SELECT DISTINCT msg FROM ts_v_fact WHERE kind = 'table' AND NOT guest ORDER BY 1",
    );
  });

  it("kolumna sortowania `views_count` - fakt filtra (istnienie i SELECT) dla roli i dla gościa", () => {
    expect(sql).toContain(
      "('posts', 'views_count', NULL, 'order', 'select', 'authenticated', 'authenticated', false, 'src/lib/queries/archives.ts', 'src/lib/queries/archives.ts', 'popular')",
    );
    expect(sql).toContain(
      "('posts', 'views_count', NULL, 'order', 'select', 'anon', 'authenticated', true, 'src/lib/queries/archives.ts', 'src/lib/queries/archives.ts', 'popular')",
    );
    expect(sql).toContain("SELECT DISTINCT msg FROM ts_v_filter_missing ORDER BY 1");
    expect(sql).toContain("ELSE 'kolumna nie istnieje' END) AS msg");
  });

  it("klient przeglądarki w pliku publicznym - wiersz gościa (`anon`) faktu, filtra, osadzenia i zapytania sondy", () => {
    expect(sql).toContain(
      "('builder_templates', 'select', 'anon', 'authenticated', ARRAY['content', 'id']::text[], false, 'gość bez sesji: klient przeglądarki z kluczem publicznym <- bramka: klient przeglądarki', true, 'src/lib/queries/archives.ts', 'src/lib/queries/archives.ts', 'featured')",
    );
    expect(sql).toContain(
      "(0, NULL, 'podcast_episode_people', 'profiles', 'profiles', NULL, ARRAY['display_name', 'slug']::text[], false, 'anon', 'authenticated', true, 'src/lib/queries/podcasts.ts', 'src/lib/queries/podcasts.ts', 'people')",
    );
    expect(sql).toContain(
      "('builder_templates', 'select', 'anon', 'authenticated', ARRAY['content', 'id']::text[], false, '{}'::text[], ARRAY['slot']::text[], NULL::text[], true, 'src/lib/queries/archives.ts', 'featured')",
    );
    expect(sql).toContain("SELECT DISTINCT msg FROM ts_v_fact WHERE guest ORDER BY 1");
    // Z sesją (`authenticated`) fakt sprawdza asercja 5 - w faktach miary
    // tabeli nie ma drugiego wiersza tej samej roli.
    expect(sql).not.toContain(
      "('builder_templates', 'select', 'authenticated', 'authenticated', ARRAY['content', 'id']::text[], false, 'bramka",
    );
  });

  it("osadzenie - fakt relacji osadzonej (istnienie relacji i kolumn, SELECT roli) i sonda ze złączeniem", () => {
    expect(sql).toContain(
      "(0, NULL, 'podcast_episode_people', 'profiles', 'profiles', NULL, ARRAY['display_name', 'slug']::text[], false, 'authenticated', 'authenticated', false, 'src/lib/queries/podcasts.ts', 'src/lib/queries/podcasts.ts', 'people')",
    );
    expect(sql).toContain("CREATE TEMP TABLE ts_obs_embed_rel ON COMMIT DROP AS");
    expect(sql).toContain("relacja osadzenia nie istnieje (ani relacja public, ani klucz obcy)");
    expect(sql).toContain("SELECT DISTINCT msg FROM ts_v_embed_denied WHERE NOT guest ORDER BY 1");
  });

  it("widok `security_invoker` - zapytanie sondy jako rola klienta; pada wyłącznie 42501 „permission denied for …” i brak obiektu", () => {
    expect(sql).toContain(
      "('crm_funnel_view', 'select', 'authenticated', 'authenticated', ARRAY['leads', 'stage']::text[], false, '{}'::text[], '{}'::text[], NULL::text[], false, 'src/lib/crm/funnel.functions.ts', 'funnel')",
    );
    expect(sql).toContain(
      "WHEN v_state = '42501' AND v_msg LIKE 'permission denied for %' THEN 'brak uprawnienia'",
    );
    expect(sql).toContain("WHEN v_state IN ('42703', '42P01', '42883') THEN 'brak obiektu'");
    expect(sql).toContain(
      "WHERE p.outcome IN ('brak uprawnienia', 'brak obiektu', 'przekroczony czas', 'nie uruchomiona')",
    );
    // Wartownik wycofuje każdą sondę; cały plik kończy `ROLLBACK`.
    expect(sql).toContain("RAISE SQLSTATE 'PRB00';");
    expect(sql.trimEnd().endsWith("ROLLBACK;")).toBe(true);
    // Lista wyłączeń sond RPC jest jawna (dziś pusta).
    expect(sql).toContain("AND p.proname <> ALL ('{}'::text[])");
    expect(
      renderContractTest(f, {}, { reach: PUBLIC_REACH, rpcProbeExcluded: { slow_fn: "test" } }),
    ).toContain("AND p.proname <> ALL (ARRAY['slow_fn']::text[])");
  });

  it("plan(20), deterministyczny: kolejność plików wejścia nie zmienia pliku", () => {
    const backward = extractSeamFacts(
      Object.entries(NOVEMBER)
        .reverse()
        .map(([file, code]) => ({ file, code })),
      NO_CONTRACTS,
      [],
      { observe: true },
    );
    expect(sql).toContain("SELECT plan(20);");
    expect((sql.match(/\nSELECT is\(/g) ?? []).length).toBe(20);
    expect(renderContractTest(backward, {}, { reach: PUBLIC_REACH, guestLoginOnly: {} })).toBe(sql);
  });

  it("fakt wstrzymany w przeglądzie - bez wierszy uprawnień miary i bez sondy (istnienie sprawdza dalej asercja 4)", () => {
    const code = `${AUTH_IMPORT}
      async function readBuyer(client, id) { return client.from("profiles").select("email"); }
      export const myTicket = createServerFn().middleware([requireSupabaseAuth]).handler(async ({ context }) => readBuyer(context.supabase, 1));
    `;
    const reviewed: WithheldFactReviewed[] = [
      {
        file: "src/lib/t.functions.ts",
        fn: "readBuyer",
        table: "profiles",
        op: "select",
        role: "unknown",
        columns: ["email"],
        reason: "test",
      },
    ];
    const w = extractSeamFacts([{ file: "src/lib/t.functions.ts", code }], NO_CONTRACTS, reviewed, {
      observe: true,
    });
    expect(w.withheld).toHaveLength(1);
    expect(w.observed.tables.map((t) => `${t.role} ${t.withheld}`)).toEqual(["authenticated true"]);
    const out = renderContractTest(w);
    expect(out).toContain("-- ts_obs_table: brak wierszy");
    expect(out).toContain("-- ts_obs_stmt: brak wierszy");
  });
});

describe("bramka z miary: fakt wstrzymany - filtry i osadzenia jego łańcucha tylko z istnieniem", () => {
  // Kształt historycznego wpisu (`export.functions.ts`): brakujący grant był
  // na KOLUMNIE FILTRA `reporter_id` - bez przeniesienia wstrzymania na
  // filtry i osadzenia łańcucha przejrzany defekt czerwieniłby asercje 13/16.
  const code = `${AUTH_IMPORT}
    export const exportMyData = createServerFn().middleware([requireSupabaseAuth]).handler(async ({ context }) => {
      const u = context.userId;
      const reports = await context.supabase.from("user_reports").select("id, reason, reporter:profiles(display_name)").eq("reporter_id", u).order("created_at");
      const own = await context.supabase.from("user_reports").select("id").eq("reporter_id", u);
      return [reports, own];
    });
  `;
  const FILE = "src/lib/profile/export.functions.ts";
  const ENTRY: WithheldFactReviewed = {
    file: FILE,
    fn: "exportMyData",
    table: "user_reports",
    op: "select",
    role: "authenticated",
    columns: ["id", "reason"],
    reason: "test",
  };
  const withheld = (entries: readonly WithheldFactReviewed[]) =>
    extractSeamFacts([{ file: FILE, code }], NO_CONTRACTS, entries, { observe: true });

  it("filtr `.eq`, sortowanie i osadzenie wstrzymanego łańcucha - wiersz `unknown` (asercje 12 i 14), bez SELECT roli, gościa i sondy; łańcuch obok sprawdzany", () => {
    const w = withheld([ENTRY]);
    expect(w.withheld).toHaveLength(1);
    expect(
      w.observed.filters.map((f) => `${f.column}:${f.method}:${f.withheld === true}`).sort(),
    ).toEqual(["created_at:order:true", "reporter_id:eq:false", "reporter_id:eq:true"]);
    expect(w.observed.embeds.map((e) => `${e.rel}:${e.withheld === true}`)).toEqual([
      "profiles:true",
    ]);
    const sql = renderContractTest(w);
    // Istnienie - wiersze z rolą `unknown`.
    expect(sql).toContain(
      `('user_reports', 'reporter_id', NULL, 'eq', 'select', 'unknown', 'authenticated', false, '${FILE}', '${FILE}', 'exportMyData')`,
    );
    expect(sql).toContain(
      `('user_reports', 'created_at', NULL, 'order', 'select', 'unknown', 'authenticated', false, '${FILE}', '${FILE}', 'exportMyData')`,
    );
    expect(sql).toContain(
      `(0, NULL, 'user_reports', 'reporter', 'profiles', NULL, ARRAY['display_name']::text[], false, 'unknown', 'authenticated', false, '${FILE}', '${FILE}', 'exportMyData')`,
    );
    // Bez roli z sesją dla wstrzymanego sortowania i osadzenia (SELECT roli i sonda).
    expect(sql).not.toContain(
      "('user_reports', 'created_at', NULL, 'order', 'select', 'authenticated'",
    );
    expect(sql).not.toContain(
      "'profiles', NULL, ARRAY['display_name']::text[], false, 'authenticated'",
    );
    // Ten sam filtr w łańcuchu bez faktu wstrzymanego - sprawdzany rolą.
    expect(sql).toContain(
      `('user_reports', 'reporter_id', NULL, 'eq', 'select', 'authenticated', 'authenticated', false, '${FILE}', '${FILE}', 'exportMyData')`,
    );
    // Zapytanie sondy - tylko łańcuch niewstrzymany.
    expect(sql).toContain(
      `('user_reports', 'select', 'authenticated', 'authenticated', ARRAY['id']::text[], false, '{}'::text[], ARRAY['reporter_id']::text[], NULL::text[], false, '${FILE}', 'exportMyData')`,
    );
    expect(sql).not.toContain("ARRAY['id', 'reason']::text[], false, '{}'::text[]");
  });

  it("bez wpisu - te same filtry i osadzenie z rolą łańcucha (wstrzymanie nie przecieka)", () => {
    const w = withheld([]);
    expect(w.observed.filters.every((f) => f.withheld === undefined)).toBe(true);
    expect(w.observed.embeds.every((e) => e.withheld === undefined)).toBe(true);
    const sql = renderContractTest(w);
    expect(sql).toContain(
      "('user_reports', 'created_at', NULL, 'order', 'select', 'authenticated', 'authenticated', false,",
    );
    expect(sql).toContain(
      "(0, NULL, 'user_reports', 'reporter', 'profiles', NULL, ARRAY['display_name']::text[], false, 'authenticated', 'authenticated', false,",
    );
  });
});

describe("bramka z miary: gość (`anon`) - zwolnienia strukturalne i lista GUEST_LOGIN_ONLY_REVIEWED", () => {
  const FILE = "src/lib/queries/archives.ts";
  const f = observed({ [FILE]: NOVEMBER[FILE] });
  const guestRows = (sql: string): string[] =>
    sql.split("\n").filter((line) => line.includes(`'${GUEST_VIA}`));
  const KEY = `${FILE}: featured: .from(builder_templates)`;
  const SHAPE = "eq(slot) select[content,id]";

  it("plik `public` i `none` (także spoza mapy) - wiersze gościa; `admin` i `session-gate` - bez nich, z liczbą w nagłówku pliku", () => {
    expect(guestRows(renderContractTest(f, {}, { reach: PUBLIC_REACH }))).not.toEqual([]);
    expect(guestRows(renderContractTest(f, {}, { reach: new Map() }))).not.toEqual([]);
    for (const cls of ["admin", "session-gate"]) {
      const reach = new Map([[FILE, { cls, entry: "/x", path: [] }]]);
      const sql = renderContractTest(f, {}, { reach });
      expect(guestRows(sql)).toEqual([]);
      expect(sql).not.toMatch(/, true, 'src\/lib\/queries\/archives\.ts'/);
      expect(sql).toContain(
        cls === "admin" ? "admin 2, session-gate 0." : "admin 0, session-gate 2.",
      );
    }
  });

  it("wpis listy zdejmuje wiersze gościa DOKŁADNIE swojego klucza (plik, funkcja, relacja); rola z sesją zostaje sprawdzana", () => {
    const sql = renderContractTest(
      f,
      {},
      {
        reach: PUBLIC_REACH,
        guestLoginOnly: { [KEY]: [1, SHAPE, `${FILE}:3 wołane tylko pod \`enabled: !!user\``] },
      },
    );
    expect(sql).not.toMatch(
      /, true, 'src\/lib\/queries\/archives\.ts', ('src\/lib\/queries\/archives\.ts', )?'featured'\)/,
    );
    expect(sql).toMatch(
      /, true, 'src\/lib\/queries\/archives\.ts', ('src\/lib\/queries\/archives\.ts', )?'popular'\)/,
    );
    expect(sql).toContain(
      "('builder_templates', 'slot', NULL, 'eq', 'select', 'authenticated', 'authenticated', false,",
    );
    expect(sql).toContain(
      "Wylaczone wpisem GUEST_LOGIN_ONLY_REVIEWED (public tylko z sesja, z dowodem): 1 kluczy (plik, funkcja, relacja).",
    );
  });

  it("rodzeństwo o tej samej ścieżce funkcji (`queryFn` kilku `queryOptions` w module, recenzja S6) - wpis jednej relacji nie zdejmuje innych; nowe zapytanie pod kluczem czerwieni rozjazd", () => {
    const PODCASTS = "src/lib/queries/podcasts.ts";
    const code = `${BROWSER_IMPORT}
      export const podcastSettingsQueryOptions = queryOptions({ queryKey: ["s"], queryFn: async () => supabase.from("podcast_settings").select("id, layout").eq("tenant_id", t) });
      export const publishedShowsQueryOptions = queryOptions({ queryKey: ["p"], queryFn: async () => supabase.from("podcast_shows").select("id, slug") });
    `;
    const reach = new Map([[PODCASTS, { cls: "public", entry: "/podcasts", path: [] }]]);
    const settingsKey = `${PODCASTS}: queryFn: .from(podcast_settings)`;
    const entry = {
      [settingsKey]: [1, "eq(tenant_id) select[id,layout]", `${PODCASTS}:2 enabled: !!user`],
    } as const;
    const sources = (c: string) => new Map([[PODCASTS, c]]);
    // Recenzja: `queryFn` wszystkich trzech opcji to ta sama ścieżka funkcji.
    const withProfiles = `${code}
      export const revNewQueryOptions = queryOptions({ queryKey: ["rev"], queryFn: async () => supabase.from("profiles").select("email").limit(1) });
    `;
    const g = observed({ [PODCASTS]: withProfiles });
    expect([...new Set(g.observed.tables.map((t) => t.fn))]).toEqual(["queryFn"]);
    const sql = renderContractTest(g, {}, { reach, guestLoginOnly: entry });
    const anonOf = (table: string): boolean =>
      sql.includes(`('${table}', 'select', 'anon', 'authenticated'`);
    expect(anonOf("podcast_settings")).toBe(false);
    expect(anonOf("podcast_shows")).toBe(true);
    expect(anonOf("profiles")).toBe(true);
    // Brak rozjazdu dla wpisu zgodnego z kodem (dowód z bramką w linii 2 - `enabled:`
    // w kodzie fikstury nie ma, więc dowód wskazuje linię z komentarzem bramki).
    const guarded = code.replace('queryKey: ["s"],', 'queryKey: ["s"], enabled: !!user,');
    expect(
      guestLoginOnlyDrift(observed({ [PODCASTS]: guarded }), reach, entry, sources(guarded)),
    ).toEqual({
      stale: [],
      fresh: [],
      invalid: [],
    });
    // Drugie zapytanie na tej samej relacji pod tym samym kluczem - przybyło faktów.
    const twice = guarded.replace(
      'queryFn: async () => supabase.from("podcast_shows")',
      'queryFn: async () => supabase.from("podcast_settings").select("id, layout").eq("tenant_id", t) && supabase.from("podcast_shows")',
    );
    expect(
      guestLoginOnlyDrift(observed({ [PODCASTS]: twice }), reach, entry, sources(twice)).fresh,
    ).toEqual([
      `${settingsKey} (2, kształt "eq(tenant_id) select[id,layout]"; przejrzany: 1, "eq(tenant_id) select[id,layout]")`,
    ]);
    // Dopisana kolumna przy tej samej liczbie - zmiana kształtu.
    const wider = guarded.replace('select("id, layout")', 'select("id, layout, owner_email")');
    expect(
      guestLoginOnlyDrift(observed({ [PODCASTS]: wider }), reach, entry, sources(wider)).fresh,
    ).toEqual([
      `${settingsKey} (1, kształt "eq(tenant_id) select[id,layout,owner_email]"; przejrzany: 1, "eq(tenant_id) select[id,layout]")`,
    ]);
  });

  it("rozjazd listy: wpis bez faktu pod kluczem, w pliku spoza `public`, z mniejszą liczbą - nieaktualny; czerwono w `check:ts-sql-contract`", () => {
    const evidence = `${FILE}:3 \`enabled: !!user\``;
    const guarded = new Map([
      [
        FILE,
        NOVEMBER[FILE].replace(
          '.eq("slot", "archive_featured")',
          '.eq("slot", "archive_featured") /* enabled: !!user */',
        ),
      ],
    ]);
    expect(guestLoginOnlyDrift(f, PUBLIC_REACH, { [KEY]: [1, SHAPE, evidence] }, guarded)).toEqual({
      stale: [],
      fresh: [],
      invalid: [],
    });
    expect(
      guestLoginOnlyDrift(
        f,
        PUBLIC_REACH,
        {
          [`${FILE}: gone: .from(builder_templates)`]: [1, SHAPE, evidence],
          [KEY]: [2, SHAPE, evidence],
        },
        guarded,
      ),
    ).toEqual({
      stale: [
        `${KEY} (1, przejrzanych: 2)`,
        `${FILE}: gone: .from(builder_templates) (brak faktu klienta przeglądarki pod tym kluczem)`,
      ],
      fresh: [],
      invalid: [],
    });
    const adminReach = new Map([[FILE, { cls: "admin", entry: "/admin", path: [] }]]);
    expect(
      guestLoginOnlyDrift(f, adminReach, { [KEY]: [1, SHAPE, evidence] }, guarded).stale,
    ).toEqual([`${KEY} (klasa pliku admin, wpis tylko dla public)`]);
    const problems = seamCoverageProblems(
      f,
      {},
      {
        reach: PUBLIC_REACH,
        unknownRole: {},
        guestLoginOnly: { [`${FILE}: gone: .from(builder_templates)`]: [1, SHAPE, evidence] },
        sources: guarded,
      },
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("GUEST_LOGIN_ONLY_REVIEWED");
    expect(problems[0]).toContain(`${FILE}: gone: .from(builder_templates)`);
  });

  it("dowód bramki sprawdzany w źródłach (recenzja S9): plik i linia muszą istnieć, a linia (±2) mieć rozpoznaną bramkę; usunięta bramka - czerwono", () => {
    const drift = (evidence: string, sources?: ReadonlyMap<string, string>): string[] =>
      guestLoginOnlyDrift(f, PUBLIC_REACH, { [KEY]: [1, SHAPE, evidence] }, sources).invalid;
    const guardedCode = NOVEMBER[FILE].replace(
      "export async function featured()",
      "// enabled: !!user - wołane wyłącznie z panelu zalogowanego\n    export async function featured()",
    );
    const sources = new Map([[FILE, guardedCode]]);
    expect(drift(`${FILE}:4 enabled: !!user`, sources)).toEqual([]);
    expect(drift("tylko po zalogowaniu", sources)).toEqual([
      `${KEY} (powód bez dowodu bramki plik:linia)`,
    ]);
    expect(drift("x.ts:1 brak", sources)).toEqual([`${KEY} (x.ts:1 - pliku nie ma w źródłach)`]);
    expect(drift("src/does/not/exist.tsx:99999 brak", sources)).toEqual([
      `${KEY} (src/does/not/exist.tsx:99999 - pliku nie ma w źródłach)`,
    ]);
    expect(drift(`${FILE}:99999 enabled: !!user`, sources)).toEqual([
      `${KEY} (${FILE}:99999 - linii nie ma w pliku)`,
    ]);
    // Bramka usunięta z kodu - ten sam wpis przestaje być ważny.
    expect(drift(`${FILE}:4 enabled: !!user`, new Map([[FILE, NOVEMBER[FILE]]]))[0]).toContain(
      `${FILE}:4 (±2) - brak rozpoznanej bramki`,
    );
    // Bez źródeł dowodu nie da się sprawdzić.
    expect(drift(`${FILE}:4 enabled: !!user`)).toEqual([
      `${KEY} (${FILE}:4 - pliku nie ma w źródłach)`,
    ]);
  });

  it("lista w repozytorium jest pusta - wypełnia ją przegląd wyniku `--guest-gaps`", () => {
    expect(GUEST_LOGIN_ONLY_REVIEWED).toEqual({});
  });

  it("`--guest-gaps`: zwykły SQL z tymi samymi wierszami i sondami, wynik - klucze (plik: funkcja: relacja) padające jako gość ze szkieletem wpisu", () => {
    const sql = renderGuestGaps(f, { reach: PUBLIC_REACH });
    expect(sql).not.toContain("plan(");
    expect(sql).not.toContain("SELECT is(");
    expect(sql).toContain(
      "SELECT v.site || ': ' || v.func || ': ' || v.call AS key, v.site, v.func, v.call,",
    );
    expect(sql).toContain("SELECT site, func, call, msg FROM ts_v_probe WHERE guest");
    expect(sql).toContain(
      `INSERT INTO ts_guest_key (key, n, shape) VALUES\n  ('${KEY}', 1, '${SHAPE}'),`,
    );
    expect(sql).toContain(
      "('posts', 'views_count', NULL, 'order', 'select', 'anon', 'authenticated', true,",
    );
    expect(sql.trimEnd().endsWith("ROLLBACK;")).toBe(true);
  });
});

describe("bramka z miary: rola nieustalona z widocznymi kandydatami - uprawnienia i sondy dla każdej roli", () => {
  // Pomocnik z wołającymi o RÓŻNYCH rolach: każdy wołający to ścieżka
  // wykonania, więc fakt idzie do pgTAP z każdą widoczną rolą (dawniej -
  // samo istnienie i wpis UNKNOWN_ROLE_REVIEWED).
  const MIXED = `${ADMIN_FILE}
    ${AUTH_IMPORT}
    async function count(client) { return client.from("event_rsvps").select("id").eq("event_id", 1); }
    export const a = createServerFn().middleware([requireSupabaseAuth]).handler(async ({ context }) => count(context.supabase));
    export async function b() { return count(supabaseAdmin); }
  `;

  it("wołający `context.supabase` i `supabaseAdmin` - kandydaci `authenticated` i `service_role`; wiersze faktu, filtra i sondy dla obu, bez wpisu listy", () => {
    const f = observed({ "src/lib/seats.server.ts": MIXED });
    expect(f.observed.tables.map((t) => `${t.table} ${t.role}`)).toEqual(["event_rsvps unknown"]);
    expect(f.observed.tables[0].candidates?.map((c) => `${c.role} ${c.guest}`)).toEqual([
      "authenticated false",
      "service_role false",
    ]);
    expect(f.observed.tables[0].candidates?.[0].via).toBe(
      "parametr 1 funkcji count (2 wywołań) <- bramka: context.supabase",
    );
    expect(unknownRoleDrift(f, {})).toEqual({ fresh: [], stale: [] });
    const sql = renderContractTest(f);
    for (const role of ["authenticated", "service_role"]) {
      expect(sql).toContain(
        `('event_rsvps', 'select', '${role}', 'unknown', ARRAY['id']::text[], false, 'parametr 1 funkcji count (2 wywołań) <- `,
      );
      expect(sql).toContain(
        `('event_rsvps', 'event_id', NULL, 'eq', 'select', '${role}', 'unknown', false,`,
      );
      expect(sql).toContain(
        `('event_rsvps', 'select', '${role}', 'unknown', ARRAY['id']::text[], false, '{}'::text[], ARRAY['event_id']::text[], NULL::text[], false, 'src/lib/seats.server.ts', 'count')`,
      );
    }
    // Bez wiersza `unknown` (samo istnienie) - kandydaci go zastępują.
    expect(sql).not.toContain("('event_rsvps', 'event_id', NULL, 'eq', 'select', 'unknown'");
    expect(sql).toContain("Rola nieustalona z widocznymi kandydatami");
    expect(sql).toContain("uprawnienia i sondy dla KAZDEJ widocznej roli.");
  });

  it("funkcja, której nie każde odwołanie jest wywołaniem - WIDOCZNE wywołania dają kandydatów (także `import()` w `Promise.all`)", () => {
    const f = observed({
      "src/lib/u/tenant.server.ts": `
        export async function readTenant(client, id) { return client.from("profiles").select("tenant_id").eq("id", id); }
        export const registry = [readTenant];
      `,
      "src/lib/u/a.functions.ts": `${AUTH_IMPORT}
        import { readTenant } from "./tenant.server";
        export const a = createServerFn().middleware([requireSupabaseAuth]).handler(async ({ context }) => readTenant(context.supabase, 1));
      `,
      "src/lib/u/b.server.ts": `
        export async function b() {
          const [{ supabaseAdmin }, { readTenant }] = await Promise.all([
            import("@/integrations/supabase/client.server"),
            import("./tenant.server"),
          ]);
          return readTenant(supabaseAdmin, 2);
        }
      `,
    });
    const t = f.observed.tables[0];
    expect(t.role).toBe("unknown");
    expect(t.via).toBe(
      "parametr 1 funkcji readTenant: nie każde odwołanie do funkcji to widoczne wywołanie",
    );
    expect(t.candidates?.map((c) => c.role)).toEqual(["authenticated", "service_role"]);
    expect(t.candidates?.[0].via).toContain("(widoczne: 2)");
    expect(unknownRoleDrift(f, {})).toEqual({ fresh: [], stale: [] });
    // Kolumna bez grantu dla `authenticated` dopisana do łańcucha idzie do
    // pgTAP z tą rolą (asercja 11), nie tylko jako istnienie.
    const mutated = observed({
      "src/lib/u/tenant.server.ts": `
        export async function readTenant(client, id) { return client.from("profiles").select("tenant_id, email").eq("id", id); }
        export const registry = [readTenant];
      `,
      "src/lib/u/a.functions.ts": `${AUTH_IMPORT}
        import { readTenant } from "./tenant.server";
        export const a = createServerFn().middleware([requireSupabaseAuth]).handler(async ({ context }) => readTenant(context.supabase, 1));
      `,
    });
    expect(renderContractTest(mutated)).toContain(
      "('profiles', 'select', 'authenticated', 'unknown', ARRAY['email', 'tenant_id']::text[], false,",
    );
  });

  it("`createClient` z `Authorization` z warunku (`hostAnonClient(bearer)`, import w `Promise.all`) - kandydaci `anon` i `authenticated`", () => {
    const f = observed({
      "src/lib/e/host.server.ts": `
        export async function hostAnonClient(bearer: string | null = null) {
          const url = process.env.SUPABASE_URL;
          const key = process.env.SUPABASE_PUBLISHABLE_KEY;
          if (!url || !key) return null;
          const [{ createClient }, { fetchWithTenantHost }] = await Promise.all([
            import("@supabase/supabase-js"),
            import("@/integrations/supabase/tenant-host-fetch"),
          ]);
          return createClient(url, key, {
            global: bearer === null ? { fetch: fetchWithTenantHost } : { fetch: fetchWithTenantHost, headers: { Authorization: \`Bearer \${bearer}\` } },
          });
        }
        export async function legacyRegister(bearer) {
          const legacy = await hostAnonClient(bearer);
          return legacy.rpc("event_register", { p_payload: {} });
        }
      `,
    });
    const r = f.observed.rpcs[0];
    expect(r.role).toBe("unknown");
    expect(r.candidates?.map((c) => `${c.role}: ${c.via}`)).toEqual([
      "anon: hostAnonClient() <- createClient(…, SUPABASE_PUBLISHABLE_KEY) bez nagłówka",
      "authenticated: hostAnonClient() <- createClient(…, SUPABASE_PUBLISHABLE_KEY) z nagłówkiem Authorization",
    ]);
    const sql = renderContractTest(f);
    expect(sql).toContain(
      "('event_register', ARRAY['p_payload']::text[], 'anon', 'unknown', 'hostAnonClient() <- createClient(…, SUPABASE_PUBLISHABLE_KEY) bez nagłówka', false, 'src/lib/e/host.server.ts', 'legacyRegister')",
    );
    expect(sql).toContain(
      "('event_register', ARRAY['p_payload']::text[], 'authenticated', 'unknown', 'hostAnonClient() <- createClient(…, SUPABASE_PUBLISHABLE_KEY) z nagłówkiem Authorization', false, 'src/lib/e/host.server.ts', 'legacyRegister')",
    );
  });
});

describe("bramka z miary: klient przeglądarki wykonany na serwerze - anon zawsze, bez zwolnień", () => {
  const reachOf = (cls: string, ...files: string[]): ReadonlyMap<string, SiteReach> =>
    new Map(files.map((file) => [file, { cls, entry: "/x", path: [] }]));
  /** Wiersze `anon` (gościa) danej funkcji w pliku pgTAP. */
  const anonRows = (sql: string, site: string, fn: string): string[] =>
    sql
      .split("\n")
      .filter((l) => l.includes(`'${GUEST_VIA}`) || l.includes(", true, '"))
      .filter((l) => l.includes(`'${site}'`) && l.trim().replace(/[,;]$/, "").endsWith(`'${fn}')`));

  it("handler `createServerFn` (także import pod inną nazwą) w pliku `admin` - wiersze `anon` z drogą serwera mimo zwolnienia klasy; komponent obok - zwolniony", () => {
    const FILE = "src/lib/admin/couponQueries.ts";
    const f = observed({
      [FILE]: `${BROWSER_IMPORT}
        import { createServerFn as revCreateServerFn } from "@tanstack/react-start";
        export const revAdminServerRead = revCreateServerFn().handler(async () =>
          supabase.from("builder_templates").select("id, data"),
        );
        export function CouponTable() {
          const q = useQuery({ queryKey: ["c"], queryFn: () => supabase.from("coupons").select("id") });
          return null;
        }
      `,
    });
    const handler = f.observed.tables.find((t) => t.table === "builder_templates");
    expect(handler?.server).toBe(`createServerFn().handler (${FILE})`);
    expect(f.observed.tables.find((t) => t.table === "coupons")?.server).toBeUndefined();
    const sql = renderContractTest(f, {}, { reach: reachOf("admin", FILE), guestLoginOnly: {} });
    expect(sql).toContain(
      `('builder_templates', 'select', 'anon', 'authenticated', ARRAY['data', 'id']::text[], false, '${GUEST_VIA} <- ${SERVER_GUEST_VIA}: createServerFn().handler (${FILE}) <- bramka: klient przeglądarki', true, '${FILE}', '${FILE}', 'revAdminServerRead')`,
    );
    expect(anonRows(sql, FILE, "revAdminServerRead").length).toBeGreaterThan(1);
    expect(anonRows(sql, FILE, "CouponTable.queryFn")).toEqual([]);
    expect(sql).toContain("anon sprawdzany zawsze,\n--   w tym 1 w plikach admin i session-gate");
  });

  it("pomocnik i opcje zapytania rozgrzewane w `loader` trasy (SSR) w pliku `session-gate` - anon; `ssr: false` i `.client(...)` - bez drogi serwera", () => {
    const HELPER = "src/lib/x/queries.ts";
    const ROUTE = "src/routes/x.tsx";
    const OFF = "src/routes/y.tsx";
    const files = {
      [HELPER]: `${BROWSER_IMPORT}
        export async function fetchPlans() { return supabase.from("plans").select("id"); }
        export const tiersQueryOptions = (id: string) =>
          queryOptions({ queryKey: ["t", id], queryFn: () => supabase.from("tiers").select("id").eq("id", id) });
        export async function fetchOff() { return supabase.from("off_table").select("id"); }
        export const pick = createIsomorphicFn().client(() => supabase.from("client_only").select("id"));
      `,
      [ROUTE]: `import { fetchPlans, tiersQueryOptions } from "@/lib/x/queries";
        export const Route = createFileRoute("/x")({
          loader: async ({ context }) => {
            await context.queryClient.ensureQueryData(tiersQueryOptions("a"));
            return fetchPlans();
          },
          component: X,
        });
        function X() { return null; }
      `,
      [OFF]: `import { fetchOff } from "@/lib/x/queries";
        export const Route = createFileRoute("/y")({ ssr: false, loader: () => fetchOff(), component: Y });
        function Y() { return null; }
      `,
    };
    const f = observed(files);
    const server = (table: string): string | undefined =>
      f.observed.tables.find((t) => t.table === table)?.server;
    expect(server("plans")).toBe(`fetchPlans <- loader trasy (${ROUTE})`);
    expect(server("tiers")).toBe(`tiersQueryOptions <- loader trasy (${ROUTE})`);
    expect(server("off_table")).toBeUndefined();
    expect(server("client_only")).toBeUndefined();
    const sql = renderContractTest(
      f,
      {},
      {
        reach: reachOf("session-gate", HELPER, ROUTE, OFF),
        guestLoginOnly: {},
      },
    );
    expect(anonRows(sql, HELPER, "fetchPlans").length).toBeGreaterThan(0);
    expect(anonRows(sql, HELPER, "tiersQueryOptions.queryFn").length).toBeGreaterThan(0);
    expect(anonRows(sql, HELPER, "fetchOff")).toEqual([]);
    expect(anonRows(sql, HELPER, "pick")).toEqual([]);
  });

  it("moduł `*.server.ts` i klient z parametru wołany z handlera - droga serwera; komponent oddany jako wartość w `.server(() => X)` - nie", () => {
    const f = observed({
      "src/lib/a/read.server.ts": `${BROWSER_IMPORT}
        export async function readA() { return supabase.from("a_table").select("id"); }
      `,
      "src/lib/a/helper.ts": `
        export async function readB(db) { return db.from("b_table").select("id"); }
      `,
      "src/lib/a/fn.functions.ts": `${BROWSER_IMPORT}
        import { readB } from "./helper";
        export const b = createServerFn().handler(async () => readB(supabase));
      `,
      "src/lib/a/view.tsx": `${BROWSER_IMPORT}
        export function View() { const q = useQuery({ queryKey: ["v"], queryFn: () => supabase.from("v_table").select("id") }); return null; }
        export const getView = createIsomorphicFn().server(() => View);
      `,
    });
    const server = (table: string): string | undefined =>
      f.observed.tables.find((t) => t.table === table)?.server;
    expect(server("a_table")).toBe("moduł src/lib/a/read.server.ts");
    expect(server("b_table")).toBe("createServerFn().handler (src/lib/a/fn.functions.ts)");
    expect(server("v_table")).toBeUndefined();
  });

  it("wpis GUEST_LOGIN_ONLY_REVIEWED nie zdejmuje wiersza `anon` klienta wykonanego na serwerze", () => {
    const FILE = "src/lib/queries/srv.ts";
    const f = observed({
      [FILE]: `${BROWSER_IMPORT}
        export const read = createServerFn().handler(async () => supabase.from("posts").select("id"));
      `,
    });
    const sql = renderContractTest(
      f,
      {},
      {
        reach: reachOf("public", FILE),
        guestLoginOnly: {
          [`${FILE}: read: .from(posts)`]: [1, "select[id]", `${FILE}:2 enabled: !!user`],
        },
      },
    );
    expect(anonRows(sql, FILE, "read").length).toBeGreaterThan(0);
  });
});

describe("bramka z miary: role bez kandydata - lista UNKNOWN_ROLE_REVIEWED tylko maleje, z kształtem", () => {
  // Pomocnik w obiekcie wołanym dynamicznie (`COLLECTORS[k](...)`) - żadnego
  // widocznego wywołania, żadnego kandydata roli.
  const DYNAMIC = `${ADMIN_FILE}
    const COLLECTORS = {
      async count(client) { return client.from("event_rsvps").select("id").eq("event_id", 1); },
    };
    export async function run(k) { return COLLECTORS[k](supabaseAdmin); }
  `;
  const KEY = "src/lib/seats.server.ts: count: .from(event_rsvps)";
  const SHAPE = "eq(event_id) select[id]";

  it("fakt bez kandydata - bez uprawnień, klucz (plik, funkcja, relacja) na liście z liczbą faktów i kształtem", () => {
    const f = observed({ "src/lib/seats.server.ts": DYNAMIC });
    expect(f.observed.tables.map((t) => `${t.table} ${t.role} ${t.candidates}`)).toEqual([
      "event_rsvps unknown undefined",
    ]);
    expect(unknownRoleDrift(f, {})).toEqual({
      fresh: [`${KEY} (1, kształt "${SHAPE}", przejrzanych: -)`],
      stale: [],
    });
    expect(unknownRoleDrift(f, { [KEY]: [1, SHAPE, "powód"] })).toEqual({ fresh: [], stale: [] });
    // Więcej faktów niż w przeglądzie - nowe; mniej - nieaktualne.
    expect(unknownRoleDrift(f, { [KEY]: [2, SHAPE, "powód"] }).stale).toEqual([
      `${KEY} (1, przejrzanych: 2)`,
    ]);
    const twice = observed({
      "src/lib/seats.server.ts": DYNAMIC.replace(
        'select("id")',
        'select("id"); await client.from("event_rsvps").delete().eq("id", 2)',
      ),
    });
    expect(unknownRoleDrift(twice, { [KEY]: [1, SHAPE, "powód"] }).fresh).toEqual([
      `${KEY} (2, kształt "delete[] eq(event_id) eq(id) select[id]", przejrzanych: 1)`,
    ]);
    // Rola w pgTAP: istnienie tak (asercje 4 i 12), uprawnienia nie.
    const sql = renderContractTest(f);
    expect(sql).toContain(
      "('event_rsvps', 'select', 'unknown', ARRAY['id']::text[], false, 'src/lib/seats.server.ts')",
    );
    expect(sql).toContain(
      "('event_rsvps', 'event_id', NULL, 'eq', 'select', 'unknown', 'unknown', false,",
    );
    expect(sql).toContain("-- ts_obs_stmt: brak wierszy");
  });

  it("zmiana kształtu przejrzanego łańcucha przy tej samej liczbie faktów (kolumna, filtr, osadzenie, zamiana łańcucha) - wpis do ponownego przeglądu", () => {
    const reviewed = { [KEY]: [1, SHAPE, "powód"] as const };
    const shapeOf = (code: string): string[] =>
      unknownRoleDrift(observed({ "src/lib/seats.server.ts": code }), reviewed).fresh;
    // Nowa kolumna (`readUserTenantId` + `email`, recenzja S2).
    expect(shapeOf(DYNAMIC.replace('select("id")', 'select("id, email")'))).toEqual([
      `${KEY} (kształt "eq(event_id) select[email,id]", przejrzany "${SHAPE}")`,
    ]);
    // Inna kolumna filtra.
    expect(shapeOf(DYNAMIC.replace('eq("event_id", 1)', 'eq("user_id", 1)'))).toEqual([
      `${KEY} (kształt "eq(user_id) select[id]", przejrzany "${SHAPE}")`,
    ]);
    // Osadzenie i filtr osadzenia.
    expect(
      shapeOf(
        DYNAMIC.replace('select("id")', 'select("id, events(title)")').replace(
          'eq("event_id", 1)',
          'eq("events.status", "x")',
        ),
      ),
    ).toEqual([
      `${KEY} (kształt "eq(events.status) events:events(title) select[id]", przejrzany "${SHAPE}")`,
    ]);
    // Zamiana łańcucha: odczyt zamiast odczytu z inną listą przy tym samym liczniku.
    expect(
      shapeOf(
        DYNAMIC.replace(
          '.select("id").eq("event_id", 1)',
          '.update({ status: "x" }).eq("event_id", 1)',
        ),
      ),
    ).toEqual([`${KEY} (kształt "eq(event_id) update[status]", przejrzany "${SHAPE}")`]);
    expect(shapeOf(DYNAMIC)).toEqual([]);
  });

  it("naprawione (klient wprost) - wpis nieaktualny czerwieni bramkę; nowy klucz bez wpisu też", () => {
    const fixed = observed({
      "src/lib/seats.server.ts": DYNAMIC.replace(
        'client.from("event_rsvps")',
        'supabaseAdmin.from("event_rsvps")',
      ),
    });
    expect(fixed.observed.tables.map((t) => t.role)).toEqual(["service_role"]);
    expect(unknownRoleDrift(fixed, { [KEY]: [1, SHAPE, "powód"] })).toEqual({
      fresh: [],
      stale: [`${KEY} (brak faktu z rolą nieustaloną, przejrzanych: 1)`],
    });
    const problems = seamCoverageProblems(
      fixed,
      {},
      {
        reach: new Map(),
        unknownRole: { [KEY]: [1, SHAPE, "powód"] },
        guestLoginOnly: {},
      },
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("UNKNOWN_ROLE_REVIEWED nieaktualnych");
    const fresh = seamCoverageProblems(
      observed({ "src/lib/seats.server.ts": DYNAMIC }),
      {},
      {
        reach: new Map(),
        unknownRole: {},
        guestLoginOnly: {},
      },
    );
    expect(fresh).toHaveLength(1);
    expect(fresh[0]).toContain(`${KEY} (1, kształt "${SHAPE}", przejrzanych: -)`);
  });

  it("łańcuch bez faktu tabeli (ładunek nieczytelny, same filtry) bez kandydata - klucz z liczbą 0 i kształtem filtrów", () => {
    const f = observed({
      "src/lib/seats.server.ts": DYNAMIC.replace(
        'return client.from("event_rsvps").select("id").eq("event_id", 1);',
        'return client.from("event_rsvps").update(patch).eq("event_id", 1);',
      ),
    });
    expect(f.observed.tables).toEqual([]);
    expect(unknownRoleDrift(f, {}).fresh).toEqual([
      `${KEY} (0, kształt "eq(event_id)", przejrzanych: -)`,
    ]);
    expect(unknownRoleDrift(f, { [KEY]: [0, "eq(event_id)", "powód"] })).toEqual({
      fresh: [],
      stale: [],
    });
  });
});

describe("bramka z miary: zapadki filtrów nieczytelnych", () => {
  it("miejsc filtrów nieczytelnych i filtrów poza budowniczym nie przybywa po cichu", () => {
    const many = (n: number, body: (i: number) => string): string =>
      `${ADMIN_FILE}\n${Array.from({ length: n }, (_, i) => body(i)).join("\n")}`;
    const unresolved = observed({
      "src/a.server.ts": many(
        MAX_UNRESOLVED_FILTER_SITES + 1,
        (i) =>
          `export async function f${i}(col: string) { await supabaseAdmin.from("t").select("id").order(\`\${col}\`); }`,
      ),
    });
    expect(unresolved.observed.unresolvedFilters).toHaveLength(MAX_UNRESOLVED_FILTER_SITES + 1);
    const p1 = seamCoverageProblems(unresolved, {}, { reach: new Map(), unknownRole: {} });
    expect(p1).toHaveLength(1);
    expect(p1[0]).toContain(`zapadka MAX_UNRESOLVED_FILTER_SITES: ${MAX_UNRESOLVED_FILTER_SITES}`);
    const outside = observed({
      "src/a.server.ts": many(
        MAX_FILTERS_OUTSIDE_CHAINS + 1,
        (i) => `export async function g${i}(q) { return q.eq("a", ${i}); }`,
      ),
    });
    expect(outside.observed.filtersOutsideChains).toHaveLength(MAX_FILTERS_OUTSIDE_CHAINS + 1);
    const p2 = seamCoverageProblems(outside, {}, { reach: new Map(), unknownRole: {} });
    expect(p2).toHaveLength(1);
    expect(p2[0]).toContain(`zapadka MAX_FILTERS_OUTSIDE_CHAINS: ${MAX_FILTERS_OUTSIDE_CHAINS}`);
    // W granicy - bez problemu.
    const within = observed({
      "src/a.server.ts": many(
        MAX_FILTERS_OUTSIDE_CHAINS,
        (i) => `export async function g${i}(q) { return q.eq("a", ${i}); }`,
      ),
    });
    expect(seamCoverageProblems(within, {}, { reach: new Map(), unknownRole: {} })).toEqual([]);
  });
});

describe("stan repozytorium - miara poza bramką", () => {
  const sources = loadProductionSources();
  const plain = extractSeamFacts(sources);
  const measured = extractSeamFacts(sources, undefined, undefined, { observe: true });
  const reach = guestReach(sources);

  it("`observe` nie zmienia faktów ani zasięgu; asercje 1-9 pgTAP bajt w bajt te same", () => {
    const { observed: _a, ...plainRest } = plain;
    const { observed: _b, ...measuredRest } = measured;
    expect(measuredRest).toEqual(plainRest);
    expect(gateAssertions(renderContractTest(measured, undefined, { reach }))).toBe(
      gateAssertions(renderContractTest(plain)),
    );
  });

  it("bramka z miary: lista ról nieustalonych DOKŁADNIE jak fakty, lista gościa bez rozjazdu, zapadki filtrów w granicy (i schodzą razem z liczbą)", () => {
    expect(seamCoverageProblems(measured, undefined, { reach })).toEqual([]);
    expect(unknownRoleDrift(measured)).toEqual({ fresh: [], stale: [] });
    // Lista liczy WYŁĄCZNIE fakty bez widocznej roli; fakty `unknown`
    // z kandydatami idą do pgTAP z każdą widoczną rolą.
    const unknownFacts = [...measured.observed.rpcs, ...measured.observed.tables].filter(
      (x) => x.role === "unknown",
    );
    expect(Object.values(UNKNOWN_ROLE_REVIEWED).reduce((sum, [count]) => sum + count, 0)).toBe(
      unknownFacts.filter((x) => checkedRoles(x).length === 0).length,
    );
    expect(unknownFacts.filter((x) => checkedRoles(x).length > 0).length).toBeGreaterThan(0);
    expect(guestLoginOnlyDrift(measured, reach)).toEqual({ stale: [], fresh: [], invalid: [] });
    expect(measured.observed.unresolvedFilters.length).toBe(MAX_UNRESOLVED_FILTER_SITES);
    expect(measured.observed.filtersOutsideChains.length).toBe(MAX_FILTERS_OUTSIDE_CHAINS);
    // Bez miary sprawdzenia miary nie przechodzą po cichu.
    expect(seamCoverageProblems(plain, undefined, { reach })[0]).toContain("miara nie uruchomiona");
  });

  it("każdy fakt bramki ma lustro w mierze z tą samą rolą bramki; miara DOPOWIADA rolę `unknown`, a rolę reguły nazwy zmienia DOKŁADNIE tam, gdzie wiązanie daje inną", () => {
    const o = measured.observed;
    expect(o.rpcs.map((r) => [r.name, r.enforcedRole, r.site])).toEqual(
      measured.rpcs.map((r) => [r.name, r.role, r.file]),
    );
    expect(o.tables.filter((t) => t.enforcedRole !== "unknown").length).toBe(
      measured.tables.filter((t) => t.role !== "unknown").length,
    );
    // Rola bramki rozstrzygnięta - miara zmienia ją WYŁĄCZNIE tam, gdzie
    // reguła nazwy `supabase` zgaduje, a wiązanie mówi co innego: parametr
    // z domyślnym klientem z kluczem publicznym (`serverPublicClient()` -
    // bez `Authorization`, czyli `anon`). Każdy nowy rozjazd (także
    // `unknown`: reguła nazwy przy wiązaniu nieczytelnym) to błąd reguły
    // nazwy albo kodu - do przeglądu, nie do dopisania bez czytania.
    const conflicts = [...o.rpcs, ...o.tables]
      .filter((x) => x.enforcedRole !== "unknown" && x.role !== x.enforcedRole)
      .map(
        (x) =>
          `${x.site} ${x.fn} ${"table" in x ? x.table : x.name}: ${x.enforcedRole} -> ${x.role}`,
      );
    // `ticket.server.ts` (od b80f1e81): parametr klienta miejsc z wołającymi
    // o różnych rolach - reguła nazwy zgadywała `authenticated`; miara mówi
    // `unknown` (lista UNKNOWN_ROLE_REVIEWED), a asercja 5 sprawdza dalej rolę
    // bramki.
    expect(conflicts).toEqual([
      "src/lib/events/ticket.server.ts legacySeatsFor get_event_rsvp_counts: authenticated -> unknown",
      "src/lib/events/ticket.server.ts seatsFor event_seat_state: authenticated -> unknown",
      "src/lib/events/ticket.server.ts legacySeatsFor events: authenticated -> unknown",
      "src/lib/events/ticket.server.ts assertSeatAvailable event_rsvps: authenticated -> unknown",
      "src/lib/menus/menu.functions.ts listMenuSummaries menus: authenticated -> anon",
      "src/lib/menus/menu.functions.ts fetchMenuWithItems menus: authenticated -> anon",
      "src/lib/mobileDrawer.functions.ts readMobileDrawerConfig mobile_drawer_configs: authenticated -> anon",
    ]);
    const unknownBefore = [...o.rpcs, ...o.tables].filter((x) => x.enforcedRole === "unknown");
    const unknownAfter = [...o.rpcs, ...o.tables].filter((x) => x.role === "unknown");
    expect(unknownAfter.length).toBeLessThan(unknownBefore.length / 4);
  });

  it("klient przeglądarki idzie też jako gość - przykłady weryfikatora naprawione (2eb0d84e, bbef4a56) i nie wracają, a fakty plików publicznych idą do pgTAP jako `anon`", () => {
    const o = measured.observed;
    // Sekcja wyróżniona archiwum - przez funkcję serwerową, bez odczytu
    // `builder_templates` klientem przeglądarki.
    expect(
      o.tables.filter(
        (t) => t.site === "src/lib/queries/archives.ts" && t.table === "builder_templates",
      ),
    ).toEqual([]);
    // Osoby odcinka - z `profiles_public`, bez osadzenia `profiles(...)`.
    expect(
      o.embeds.filter((e) => e.site === "src/lib/queries/podcasts.ts" && e.rel === "profiles"),
    ).toEqual([]);
    expect(reach.get("src/lib/queries/podcasts.ts")?.cls).toBe("public");
    const sql = renderContractTest(measured, undefined, { reach });
    expect(sql).toContain(
      // Opcje zapytania rozgrzewa `loader` trasy odcinka - w SSR klient
      // przeglądarki idzie jako `anon` dla każdego (wiersz bez zwolnień).
      "('podcast_episode_people', 'select', 'anon', 'authenticated', ARRAY['display_name', 'episode_id', 'id', 'profile_id', 'role', 'sort_order', 'url']::text[], false, 'gość bez sesji: klient przeglądarki z kluczem publicznym <- na serwerze, bez sesji (bez zwolnień): episodePeopleQueryOptions <- loader trasy (src/routes/podcast.$slug.tsx) <- bramka: klient przeglądarki', true, 'src/lib/queries/podcasts.ts', 'src/lib/queries/podcasts.ts', 'episodePeopleQueryOptions.queryFn')",
    );
    // Gość wyłącznie przy roli `authenticated` (klient przeglądarki z sesją).
    const all = [...o.rpcs, ...o.tables, ...o.filters, ...o.embeds, ...o.statements];
    expect(all.filter((x) => x.guest && x.role !== "authenticated")).toEqual([]);
    expect(all.filter((x) => x.guest).length).toBeGreaterThan(1000);
  });
});

// ── Złożenie pasów ról (S1, S4, C1) i sond (C2, S3, S7, S8) ─────────────────
// Oba pasy zmieniały te same widoki naruszeń: pas ról dodał kolumnę `call`
// (klucz listy gościa dla `--guest-gaps`), pas sond - gałęzie UNION sondy
// pustej. Scalenie bez konfliktu tekstowego dało widok `ts_v_probe` z gałęziami
// o różnej liczbie kolumn, a plik pgTAP padał na 9. asercji (plan 20, ran 9).

/**
 * Instrukcje najwyższego poziomu SQL bez komentarzy `--`: średnik poza
 * nawiasem, literałem `'...'` i ciałem `$tag$ ... $tag$`.
 */
function sqlStatements(sql: string): string[] {
  const out: string[] = [];
  let cur = "";
  let depth = 0;
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "-" && sql[i + 1] === "-") {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end;
      continue;
    }
    if (ch === "'") {
      const end = sql.indexOf("'", i + 1);
      cur += sql.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    const tag = ch === "$" ? /^\$[A-Za-z_]*\$/.exec(sql.slice(i, i + 40)) : null;
    if (tag !== null) {
      const end = sql.indexOf(tag[0], i + tag[0].length) + tag[0].length;
      cur += sql.slice(i, end);
      i = end;
      continue;
    }
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === ";" && depth === 0) {
      if (cur.trim() !== "") out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
    i += 1;
  }
  if (cur.trim() !== "") out.push(cur.trim());
  return out;
}

/** Tekst z literałami i zawartością nawiasów zamienionymi na spacje (te same indeksy). */
function topLevelMask(text: string): string {
  let out = "";
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      quoted = ch !== "'";
      out += " ";
    } else if (ch === "'") {
      quoted = true;
      out += " ";
    } else if (ch === "(" || ch === ")") {
      depth += ch === "(" ? 1 : -1;
      out += " ";
    } else {
      out += depth > 0 ? " " : ch;
    }
  }
  return out;
}

/** Gałęzie UNION zapytania: nazwy kolumn listy SELECT każdej gałęzi. */
function unionBranches(query: string): string[][] {
  const mask = topLevelMask(query);
  const cuts = [...mask.matchAll(/\bUNION(?:\s+ALL)?\b/g)];
  const bounds = [0, ...cuts.flatMap((m) => [m.index, m.index + m[0].length]), query.length];
  const branches: string[][] = [];
  for (let b = 0; b < bounds.length; b += 2) {
    const text = query.slice(bounds[b], bounds[b + 1]);
    const m = topLevelMask(text);
    const select = /\bSELECT\b(?:\s+DISTINCT\b)?/.exec(m);
    if (select === null) throw new Error(`gałąź bez SELECT: ${text.slice(0, 80)}`);
    const from = /\bFROM\b/.exec(m.slice(select.index));
    const end = from === null ? text.length : select.index + from.index;
    const start = select.index + select[0].length;
    const items: string[] = [];
    let last = start;
    for (let i = start; i <= end; i += 1) {
      if (i === end || m[i] === ",") {
        items.push(text.slice(last, i).trim());
        last = i + 1;
      }
    }
    branches.push(items.map((item) => /(\w+)\s*$/.exec(item)?.[1] ?? item));
  }
  return branches;
}

/**
 * Zapytania z UNION: widoki `CREATE TEMP VIEW`, instrukcje SELECT/WITH
 * i `CREATE TEMP TABLE ... AS`, a w nich podzapytania w nawiasach
 * (`FROM (... UNION ALL ...) v`, LATERAL). Ciała funkcji i bloki DO - pominięte.
 */
function unionQueries(sql: string): Map<string, string[][]> {
  const out = new Map<string, string[][]>();
  const add = (name: string, query: string): void => {
    if (/^\s*(SELECT|WITH)\b/.test(query) && /\bUNION\b/.test(topLevelMask(query))) {
      out.set(name, unionBranches(query.trim()));
    }
  };
  for (const s of sqlStatements(sql)) {
    if (/^(CREATE FUNCTION|DO)\b/.test(s)) continue;
    const head = /^CREATE TEMP (?:VIEW (\w+)|TABLE (\w+)[^(]*?) AS\s+/.exec(s);
    const name = head === null ? s.slice(0, 60) : (head[1] ?? head[2]);
    add(name, head === null ? s : s.slice(head[0].length));
    const open: number[] = [];
    let quoted = false;
    for (let i = 0; i < s.length; i += 1) {
      if (quoted) quoted = s[i] !== "'";
      else if (s[i] === "'") quoted = true;
      else if (s[i] === "(") open.push(i);
      else if (s[i] === ")") {
        const start = open.pop() ?? 0;
        const inner = s.slice(start + 1, i);
        add(`${name} > (${inner.trim().slice(0, 50)}`, inner);
      }
    }
  }
  return out;
}

// Wspólne źródła: pomocnik `hostAnonClient(bearer)` (kandydaci anon i authenticated),
// pomocnik z wołającymi o różnych rolach, klient przeglądarki w handlerze serwera
// i łańcuch `.rpc(...)` z sortowaniem wyniku.
const MERGE_SERVER = "src/lib/e/host.server.ts";
const MERGE_HOST = `
  export async function hostAnonClient(bearer: string | null = null) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return null;
    const [{ createClient }] = await Promise.all([import("@supabase/supabase-js")]);
    return createClient(url, key, {
      global: bearer === null ? {} : { headers: { Authorization: \`Bearer \${bearer}\` } },
    });
  }
  export async function legacyRegister(bearer) {
    const legacy = await hostAnonClient(bearer);
    await legacy.from("event_registrations").insert({ event_id: 1, email: "x" });
    return legacy.rpc("event_register", { p_payload: {} });
  }
`;
const MERGE_PUBLIC = "src/lib/queries/srv.ts";
const mergeFacts = observed({
  [MERGE_SERVER]: MERGE_HOST,
  "src/lib/seats.server.ts": `${ADMIN_FILE}
    ${AUTH_IMPORT}
    async function count(client) { return client.from("event_rsvps").select("id").eq("event_id", 1); }
    export const a = createServerFn().middleware([requireSupabaseAuth]).handler(async ({ context }) => count(context.supabase));
    export async function b() { return count(supabaseAdmin); }
  `,
  [MERGE_PUBLIC]: `${BROWSER_IMPORT}
    export const save = createServerFn().handler(async () => supabase.from("user_bookmarks").insert({ entity_id: 1 }));
    export async function pub() { return supabase.rpc("resolve_path", { _segments: [] }).order("page_id"); }
  `,
});
const mergeReach: ReadonlyMap<string, SiteReach> = new Map([
  [MERGE_PUBLIC, { cls: "public", entry: "/x", path: [] }],
]);
const mergeGate = renderContractTest(mergeFacts, {}, { reach: mergeReach, guestLoginOnly: {} });
const mergeOutputs = [
  ["pgTAP", mergeGate],
  ["--guest-gaps", renderGuestGaps(mergeFacts, { reach: mergeReach })],
  ["--measure", renderObservedQueries(mergeFacts)],
] as const;

describe("scalenie pasów ról i sond: widoki naruszeń spójne, klucz sondy syntetycznej", () => {
  it("każda gałąź UNION widoków naruszeń i zapytań raportu ma tyle samo kolumn; widoki czytane przez `--guest-gaps` niosą `call`", () => {
    for (const [label, sql] of mergeOutputs) {
      const queries = unionQueries(sql);
      expect(queries.size, label).toBeGreaterThan(0);
      for (const [name, branches] of queries) {
        expect(
          branches.map((b) => b.length),
          `${label}: ${name}`,
        ).toEqual(branches.map(() => branches[0].length));
      }
    }
    const views = unionQueries(mergeGate);
    // Widok sond: odmowa/brak obiektu/limit czasu, sonda pusta, wpis nieaktualny.
    expect(views.get("ts_v_probe")?.length).toBe(3);
    expect(views.get("ts_v_fact")?.[0]).toEqual(["kind", "guest", "site", "func", "call", "msg"]);
    expect(views.get("ts_v_probe")?.[0]).toEqual(["guest", "site", "func", "call", "msg"]);
    for (const name of ["ts_v_filter_denied", "ts_v_embed_denied"]) {
      const view = sqlStatements(mergeGate).find((s) =>
        s.startsWith(`CREATE TEMP VIEW ${name} AS`),
      );
      expect(view, name).toContain(" AS call,");
    }
  });

  it("sonda RPC syntetyczna (`probe-rpc-synth`) ma w `--guest-gaps` klucz `.rpc(funkcja)` jak sonda z NULL-ami", () => {
    const probe = sqlStatements(mergeGate).find((s) =>
      s.startsWith("CREATE TEMP VIEW ts_v_probe AS"),
    );
    expect(probe).toContain("CASE WHEN p.kind LIKE 'probe-rpc%' THEN '.rpc(' || p.rel || ')'");
    expect(probe).not.toContain("p.kind = 'probe-rpc'");
    expect(mergeGate).toContain("SELECT 'probe-rpc-synth', s.args,");
  });
});
