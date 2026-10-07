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
import { describe, expect, it } from "vitest";

import {
  MAX_UNRESOLVED_SITES,
  extractSeamFacts,
  parseSelectColumns,
  renderContractTest,
  seamCoverageProblems,
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

  it("zasięg: bez problemów i w granicy zapadki nazw nieczytelnych", () => {
    expect(seamCoverageProblems(repo)).toEqual([]);
    expect(repo.coverage.unresolvedSites.length).toBeLessThanOrEqual(MAX_UNRESOLVED_SITES);
    // Gdy liczba spadnie, zapadka ma zejść razem z nią.
    expect(repo.coverage.unresolvedSites.length).toBe(MAX_UNRESOLVED_SITES);
  });
});
