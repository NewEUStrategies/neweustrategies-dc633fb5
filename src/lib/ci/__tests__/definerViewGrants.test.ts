// Kontrakt bramki `check:sql-definer-views` + jej self-test na REALNYCH pasach.
//
// Bramka powstała po pomiarze produkcji 2026-10-12: dziewięć widoków DEFINER
// w public miało dla anon/authenticated `arwdDxtm` z domyślnych uprawnień
// schematu, więc zapis przez PostgREST omijał RLS tabel bazowych. Test pgTAP
// widzi tylko pas supabase; ta bramka czyta też drizzle/ (panel Lovable).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  analyzeDefinerViews,
  definerViewsFailed,
  KNOWN_DEFINER_VIEW_OFFENDERS,
  renderDefinerViewReport,
  suggestKnownOffenders,
  type KnownDefinerViewOffender,
  type LaneFiles,
} from "@/lib/ci/definerViewGrants";

type Files = readonly (readonly [string, string])[];

const lanes = (supabase: Files, drizzle: Files = []): LaneFiles[] => [
  { lane: "supabase", files: supabase.map(([name, sql]) => ({ name, sql })) },
  { lane: "drizzle", files: drizzle.map(([name, sql]) => ({ name, sql })) },
];

const run = (supabase: Files, drizzle: Files = [], known: KnownDefinerViewOffender[] = []) =>
  analyzeDefinerViews(lanes(supabase, drizzle), known);

const fresh = (r: ReturnType<typeof run>) => r.fresh.map((o) => `${o.lane}:${o.file}:${o.view}`);

const DEFINER_VIEW = `CREATE VIEW public.v WITH (security_invoker = off, security_barrier = true) AS SELECT id FROM public.t;`;
const READ_ONLY = `REVOKE ALL ON public.v FROM anon, authenticated;\nGRANT SELECT ON public.v TO anon, authenticated;`;

describe("widok tworzony w pliku", () => {
  it("DEFINER bez REVOKE ALL = naruszenie (domyślne arwdDxtm zostaje)", () => {
    const r = run([["1_v.sql", DEFINER_VIEW]]);
    expect(fresh(r)).toEqual(["supabase:1_v.sql:public.v"]);
    expect(r.fresh[0]!.line).toBe(1);
    expect(definerViewsFailed(r)).toBe(true);
  });

  it("brak opcji security_invoker to też DEFINER", () => {
    expect(fresh(run([["1_v.sql", "CREATE VIEW public.v AS SELECT 1 AS x;"]]))).toEqual([
      "supabase:1_v.sql:public.v",
    ]);
  });

  it("REVOKE ALL od anon i authenticated + GRANT SELECT = zgodne", () => {
    expect(definerViewsFailed(run([["1_v.sql", `${DEFINER_VIEW}\n${READ_ONLY}`]]))).toBe(false);
  });

  it("REVOKE ALL PRIVILEGES ON TABLE z listą celów i nazwami w cudzysłowie", () => {
    const sql = `CREATE VIEW "public"."v" AS SELECT 1 AS x;
CREATE VIEW public.w AS SELECT 1 AS x;
REVOKE ALL PRIVILEGES ON TABLE public.v, "public"."w" FROM "anon", authenticated CASCADE;`;
    expect(definerViewsFailed(run([["1_v.sql", sql]]))).toBe(false);
  });

  it.each([
    ["tylko anon", "REVOKE ALL ON public.v FROM anon;"],
    [
      "INSERT/UPDATE/DELETE zamiast ALL",
      "REVOKE INSERT, UPDATE, DELETE ON public.v FROM anon, authenticated;",
    ],
    [
      "GRANT OPTION FOR zdejmuje tylko prawo nadawania",
      "REVOKE GRANT OPTION FOR ALL ON public.v FROM anon, authenticated;",
    ],
    ["REVOKE od PUBLIC nie zdejmuje praw nadanych rolom", "REVOKE ALL ON public.v FROM PUBLIC;"],
  ])("niepełne zdjęcie praw (%s) = naruszenie", (_label, revoke) => {
    expect(fresh(run([["1_v.sql", `${DEFINER_VIEW}\n${revoke}`]]))).toEqual([
      "supabase:1_v.sql:public.v",
    ]);
  });

  it.each(["on", "true", "1", "yes", "'on'", "TRUE"])(
    "security_invoker = %s to INVOKER - bez wymogu REVOKE",
    (value) => {
      const sql = `CREATE VIEW public.v WITH (security_invoker = ${value}) AS SELECT 1 AS x;`;
      expect(definerViewsFailed(run([["1_v.sql", sql]]))).toBe(false);
    },
  );

  it("samo `WITH (security_invoker)` znaczy true", () => {
    const sql = "CREATE VIEW public.v WITH (security_invoker) AS SELECT 1 AS x;";
    expect(definerViewsFailed(run([["1_v.sql", sql]]))).toBe(false);
  });

  it("ALTER VIEW ... SET (security_invoker = on) w tym samym pliku domyka (wzorzec crm_leads_all)", () => {
    const sql = `CREATE VIEW public.v AS SELECT 1 AS x;\nALTER VIEW public.v SET (security_invoker = on);`;
    expect(definerViewsFailed(run([["1_v.sql", sql]]))).toBe(false);
  });

  it("REVOKE ALL ON ALL TABLES IN SCHEMA public domyka widoki tego schematu", () => {
    const sql = `${DEFINER_VIEW}\nREVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;`;
    expect(definerViewsFailed(run([["1_v.sql", sql]]))).toBe(false);
  });

  it("widoki materializowane, tymczasowe i spoza public są poza zakresem", () => {
    const sql = `CREATE MATERIALIZED VIEW public.m AS SELECT 1 AS x;
CREATE TEMP VIEW t AS SELECT 1 AS x;
CREATE VIEW private.p AS SELECT 1 AS x;`;
    expect(definerViewsFailed(run([["1_v.sql", sql]]))).toBe(false);
  });

  it("CREATE VIEW w komentarzu ani w ciele funkcji nie jest instrukcją", () => {
    const sql = `-- CREATE VIEW public.fake AS SELECT 1;
/* CREATE VIEW public.fake2 AS SELECT 1; */
CREATE FUNCTION public.f() RETURNS void LANGUAGE sql AS $$ CREATE VIEW public.inner AS SELECT 1 $$;`;
    expect(run([["1_v.sql", sql]]).viewStatements).toBe(0);
  });
});

describe("historia widoku w kolejnych plikach", () => {
  it("CREATE OR REPLACE znanego, zamkniętego widoku zachowuje ACL - bez nowego naruszenia", () => {
    const r = run([
      ["1_v.sql", `${DEFINER_VIEW}\n${READ_ONLY}`],
      ["2_v.sql", "CREATE OR REPLACE VIEW public.v AS SELECT id, 1 AS y FROM public.t;"],
    ]);
    expect(definerViewsFailed(r)).toBe(false);
  });

  it("CREATE OR REPLACE bez security_invoker na widoku INVOKER z prawami klientów = naruszenie (dryf content_access_public)", () => {
    const r = run([
      ["1_v.sql", "CREATE VIEW public.v WITH (security_invoker = on) AS SELECT 1 AS x;"],
      ["2_v.sql", "CREATE OR REPLACE VIEW public.v AS SELECT 1 AS x, 2 AS y;"],
    ]);
    expect(fresh(r)).toEqual(["supabase:2_v.sql:public.v"]);
    expect(r.fresh[0]!.reason).toContain("CREATE OR REPLACE");
  });

  it("DROP + CREATE resetuje ACL do domyślnych - zamknięty wcześniej widok znowu wymaga REVOKE", () => {
    const r = run([
      ["1_v.sql", `${DEFINER_VIEW}\n${READ_ONLY}`],
      [
        "2_v.sql",
        `DROP VIEW IF EXISTS public.v;\n${DEFINER_VIEW}\nGRANT SELECT ON public.v TO anon, authenticated;`,
      ],
    ]);
    expect(fresh(r)).toEqual(["supabase:2_v.sql:public.v"]);
  });

  it.each([
    [
      "ALTER VIEW ... SET (security_invoker = off)",
      "ALTER VIEW public.v SET (security_invoker = off);",
    ],
    ["ALTER VIEW ... RESET (security_invoker)", "ALTER VIEW public.v RESET (security_invoker);"],
  ])("%s na widoku z prawami klientów = naruszenie", (_label, alter) => {
    const r = run([
      ["1_v.sql", "CREATE VIEW public.v WITH (security_invoker = on) AS SELECT 1 AS x;"],
      ["2_v.sql", alter],
    ]);
    expect(fresh(r)).toEqual(["supabase:2_v.sql:public.v"]);
  });

  it.each([
    ["kolumnowy UPDATE dla anon", "GRANT UPDATE (x) ON public.v TO anon;"],
    ["ALL dla authenticated", "GRANT ALL ON public.v TO authenticated;"],
    ["INSERT dla PUBLIC", "GRANT INSERT ON public.v TO PUBLIC;"],
  ])("GRANT w późniejszym pliku na widok DEFINER (%s) = naruszenie", (_label, grant) => {
    const r = run([
      ["1_v.sql", `${DEFINER_VIEW}\n${READ_ONLY}`],
      ["2_v.sql", grant],
    ]);
    expect(fresh(r)).toEqual(["supabase:2_v.sql:public.v"]);
  });

  it("GRANT SELECT dla klientów i GRANT ALL dla service_role nie są naruszeniem", () => {
    const r = run([
      ["1_v.sql", `${DEFINER_VIEW}\n${READ_ONLY}`],
      ["2_v.sql", "GRANT SELECT ON public.v TO anon;\nGRANT ALL ON public.v TO service_role;"],
    ]);
    expect(definerViewsFailed(r)).toBe(false);
  });

  it("GRANT zapisu na widok INVOKER jest dozwolony (wzorzec research_programs - RLS bazy działa)", () => {
    const r = run([
      ["1_v.sql", "CREATE VIEW public.v WITH (security_invoker = true) AS SELECT 1 AS x;"],
      ["2_v.sql", "GRANT INSERT, UPDATE, DELETE ON public.v TO authenticated;"],
    ]);
    expect(definerViewsFailed(r)).toBe(false);
  });
});

describe("pas drizzle (panel Lovable)", () => {
  it("widok DEFINER tylko w drizzle/ bez REVOKE = naruszenie - tego pgTAP nie widzi", () => {
    const r = run([], [["0200_panel_view.sql", DEFINER_VIEW]]);
    expect(fresh(r)).toEqual(["drizzle:0200_panel_view.sql:public.v"]);
    expect(renderDefinerViewReport(r)).toContain("drizzle/migrations/0200_panel_view.sql:1");
  });

  it("GRANT zapisu z drizzle/ na widok DEFINER zdefiniowany w pasie supabase = naruszenie", () => {
    const r = run(
      [["1_v.sql", `${DEFINER_VIEW}\n${READ_ONLY}`]],
      [["0200_panel_grant.sql", "GRANT INSERT ON public.v TO authenticated;"]],
    );
    expect(fresh(r)).toEqual(["drizzle:0200_panel_grant.sql:public.v"]);
  });

  it("bliźniak drizzle z REVOKE ALL przechodzi", () => {
    const r = run(
      [["1_v.sql", `${DEFINER_VIEW}\n${READ_ONLY}`]],
      [["0200_twin.sql", `${DEFINER_VIEW}\n${READ_ONLY}`]],
    );
    expect(definerViewsFailed(r)).toBe(false);
  });
});

describe("rejestr znanych, domkniętych naruszeń", () => {
  const history: Files = [
    ["1_open.sql", DEFINER_VIEW],
    ["2_close.sql", READ_ONLY],
  ];

  it("wpis ze wskazaniem późniejszego pliku domykającego wycisza naruszenie", () => {
    const known = [
      { lane: "supabase" as const, file: "1_open.sql", view: "public.v", closedBy: "2_close.sql" },
    ];
    const r = run(history, [], known);
    expect(r.fresh).toEqual([]);
    expect(r.registryDefects).toEqual([]);
  });

  it("suggestKnownOffenders wskazuje najwcześniejszy plik domykający", () => {
    const l = lanes(history);
    const r = analyzeDefinerViews(l, []);
    expect(suggestKnownOffenders(r, l)).toEqual([
      { lane: "supabase", file: "1_open.sql", view: "public.v", closedBy: "2_close.sql" },
    ]);
  });

  it.each([
    ["plik domykający nie zdejmuje praw", "1_open.sql", "3_noop.sql", "nie zdejmuje"],
    ["plik domykający nie istnieje", "1_open.sql", "9_missing.sql", "nie istnieje"],
    ["plik domykający nie jest późniejszy", "1_open.sql", "0_earlier.sql", "nie jest późniejszy"],
    ["martwy wpis (to nie jest naruszenie)", "2_close.sql", "3_noop.sql", "Martwy wpis"],
  ])("wada rejestru: %s", (_label, file, closedBy, message) => {
    const r = run(
      [["0_earlier.sql", "SELECT 1;"], ...history, ["3_noop.sql", "SELECT 1;"]],
      [],
      [{ lane: "supabase", file, view: "public.v", closedBy }],
    );
    expect(r.registryDefects.join("\n")).toContain(message);
    expect(definerViewsFailed(r)).toBe(true);
  });
});

describe("self-test na realnych pasach migracji", () => {
  const load = (lane: LaneFiles["lane"], dir: string): LaneFiles => ({
    lane,
    files: readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((name) => ({ name, sql: readFileSync(join(dir, name), "utf8") })),
  });
  const real = [load("supabase", "supabase/migrations"), load("drizzle", "drizzle/migrations")];

  it("obecny stan repo przechodzi z rejestrem znanych naruszeń", () => {
    const r = analyzeDefinerViews(real, KNOWN_DEFINER_VIEW_OFFENDERS);
    expect(r.registryDefects).toEqual([]);
    expect(r.fresh).toEqual([]);
    expect(r.offenders.length).toBe(KNOWN_DEFINER_VIEW_OFFENDERS.length);
  });

  it("bez 20261012210000 rejestr nie ma czym domknąć dziewięciu widoków - bramka czerwona", () => {
    const without = real.map((l) =>
      l.lane === "supabase"
        ? { ...l, files: l.files.filter((f) => !f.name.startsWith("20261012210000_")) }
        : l,
    );
    const r = analyzeDefinerViews(without, KNOWN_DEFINER_VIEW_OFFENDERS);
    expect(definerViewsFailed(r)).toBe(true);
    expect(r.registryDefects.some((d) => d.includes("20261012210000"))).toBe(true);
  });

  it("nowa migracja panelu w drizzle/ z widokiem DEFINER bez REVOKE zapala bramkę", () => {
    const withPanel = real.map((l) =>
      l.lane === "drizzle"
        ? { ...l, files: [...l.files, { name: "9999_panel_view.sql", sql: DEFINER_VIEW }] }
        : l,
    );
    const r = analyzeDefinerViews(withPanel, KNOWN_DEFINER_VIEW_OFFENDERS);
    expect(fresh(r)).toEqual(["drizzle:9999_panel_view.sql:public.v"]);
  });
});
