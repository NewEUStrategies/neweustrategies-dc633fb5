// Kontrakt bramki `check:sql-definer-views` + jej self-test na REALNYCH pasach.
//
// Bramka powstała po pomiarze produkcji 2026-10-12: dziewięć widoków DEFINER
// w public miało dla anon/authenticated `arwdDxtm` z domyślnych uprawnień
// schematu, więc zapis przez PostgREST omijał RLS tabel bazowych. Test pgTAP
// widzi tylko pas supabase; ta bramka czyta też drizzle/ (panel Lovable).
// Przypadki niżej pochodzą m.in. z adwersaryjnego polowania na obejścia
// (2026-10-13) - każdy był potwierdzony na żywym PostgreSQL 17.
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
const CLOSED = `${DEFINER_VIEW}\n${READ_ONLY}`;

describe("widok tworzony w pliku", () => {
  it("DEFINER bez REVOKE ALL = naruszenie (domyślne arwdDxtm zostaje)", () => {
    const r = run([["1_v.sql", DEFINER_VIEW]]);
    expect(fresh(r)).toEqual(["supabase:1_v.sql:public.v"]);
    expect(r.fresh[0]!.line).toBe(1);
    expect(r.fresh[0]!.reason).toContain("CREATE VIEW bez security_invoker = on");
    expect(definerViewsFailed(r)).toBe(true);
  });

  it("brak opcji security_invoker to też DEFINER", () => {
    expect(fresh(run([["1_v.sql", "CREATE VIEW public.v AS SELECT 1 AS x;"]]))).toEqual([
      "supabase:1_v.sql:public.v",
    ]);
  });

  it("REVOKE ALL od anon i authenticated + GRANT SELECT = zgodne", () => {
    expect(definerViewsFailed(run([["1_v.sql", CLOSED]]))).toBe(false);
  });

  it("REVOKE ALL PRIVILEGES ON TABLE z listą celów i nazwami w cudzysłowie", () => {
    const sql = `CREATE VIEW "public"."v" AS SELECT 1 AS x;
CREATE VIEW public.w AS SELECT 1 AS x;
REVOKE ALL PRIVILEGES ON TABLE public.v, "public"."w" FROM "anon", authenticated CASCADE;`;
    expect(definerViewsFailed(run([["1_v.sql", sql]]))).toBe(false);
  });

  it.each([
    [
      "rozbite po prawach",
      "REVOKE INSERT, UPDATE, DELETE ON public.v FROM anon, authenticated;\nREVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public.v FROM anon, authenticated;",
    ],
    [
      "rozbite po rolach",
      "REVOKE ALL ON public.v FROM anon;\nREVOKE ALL ON public.v FROM authenticated;",
    ],
    ["razem z PUBLIC", "REVOKE ALL ON public.v FROM PUBLIC, anon, authenticated;"],
  ])("REVOKE %s zamyka widok", (_label, revoke) => {
    expect(definerViewsFailed(run([["1_v.sql", `${DEFINER_VIEW}\n${revoke}`]]))).toBe(false);
  });

  it.each([
    ["tylko anon", "REVOKE ALL ON public.v FROM anon;"],
    [
      "INSERT/UPDATE/DELETE zamiast ALL",
      "REVOKE INSERT, UPDATE, DELETE ON public.v FROM anon, authenticated;",
    ],
    [
      "lista bez MAINTAIN",
      "REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.v FROM anon, authenticated;",
    ],
    [
      "GRANT OPTION FOR zdejmuje tylko prawo nadawania",
      "REVOKE GRANT OPTION FOR ALL ON public.v FROM anon, authenticated;",
    ],
    ["REVOKE od PUBLIC nie zdejmuje praw nadanych rolom", "REVOKE ALL ON public.v FROM PUBLIC;"],
    [
      "REVOKE w bloku DO się nie liczy",
      "DO $$ BEGIN REVOKE ALL ON public.v FROM anon, authenticated; END $$;",
    ],
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

  it("samo `WITH (security_invoker)` i nazwa opcji w cudzysłowie", () => {
    expect(
      definerViewsFailed(
        run([["1_v.sql", "CREATE VIEW public.v WITH (security_invoker) AS SELECT 1 AS x;"]]),
      ),
    ).toBe(false);
    expect(
      definerViewsFailed(
        run([
          ["1_v.sql", `CREATE VIEW public.v WITH ("security_invoker" = true) AS SELECT 1 AS x;`],
        ]),
      ),
    ).toBe(false);
    expect(
      fresh(
        run([
          ["1_v.sql", `CREATE VIEW public.v WITH ("security_invoker" = false) AS SELECT 1 AS x;`],
        ]),
      ),
    ).toEqual(["supabase:1_v.sql:public.v"]);
  });

  it("komentarz cytujący 'on' nie przykrywa prawdziwego 'off'", () => {
    const sql = `-- WITH (security_invoker = 'on')
CREATE VIEW public.v /* security_invoker = 'on' */ WITH (security_invoker = 'off') AS SELECT 1 AS x;`;
    expect(fresh(run([["1_v.sql", sql]]))).toEqual(["supabase:1_v.sql:public.v"]);
  });

  it.each([
    "CREATE VIEW public.v AS(SELECT 1 AS x);",
    "CREATE VIEW public.v(x)AS SELECT 1;",
    `CREATE VIEW"public"."v" AS SELECT 1 AS x;`,
    "CREATE VIEW public.v WITH(security_invoker=off)AS SELECT 1 AS x;",
  ])("zwarta składnia bez spacji jest rozpoznana: %s", (sql) => {
    expect(fresh(run([["1_v.sql", sql]]))).toEqual(["supabase:1_v.sql:public.v"]);
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
    const sql = `CREATE MATERIALIZED VIEW public.m WITH (fillfactor = 70) TABLESPACE pg_default AS SELECT 1 AS x;
CREATE TEMP VIEW t AS SELECT 1 AS x;
CREATE VIEW private.p AS SELECT 1 AS x;`;
    const r = run([["1_v.sql", sql]]);
    expect(definerViewsFailed(r)).toBe(false);
  });

  it("CREATE VIEW w komentarzu ani w ciele funkcji nie jest instrukcją", () => {
    const sql = `-- CREATE VIEW public.fake AS SELECT 1;
/* CREATE VIEW public.fake2 AS SELECT 1; */
CREATE FUNCTION public.f() RETURNS void LANGUAGE sql AS $$ CREATE VIEW public.inner AS SELECT 1 $$;`;
    expect(run([["1_v.sql", sql]]).viewStatements).toBe(0);
  });
});

describe("INSTEAD OF trigger", () => {
  const INVOKER_COMPAT =
    "CREATE VIEW public.v WITH (security_invoker = on) AS SELECT id FROM public.t;";
  const TRIGGER =
    "CREATE TRIGGER v_ins INSTEAD OF INSERT ON public.v FOR EACH ROW EXECUTE FUNCTION public.tg_v_write();";

  it("na widoku INVOKER bez REVOKE = naruszenie (funkcja SECURITY DEFINER pisze obok RLS)", () => {
    const r = run([["1_v.sql", `${INVOKER_COMPAT}\n${TRIGGER}`]]);
    expect(fresh(r)).toEqual(["supabase:1_v.sql:public.v"]);
    expect(r.fresh[0]!.reason).toContain("INSTEAD OF");
  });

  it("z REVOKE ALL od klientów przechodzi (wzorzec suppressed_emails)", () => {
    const sql = `${INVOKER_COMPAT}\nREVOKE ALL ON public.v FROM PUBLIC, anon, authenticated;\n${TRIGGER}`;
    expect(definerViewsFailed(run([["1_v.sql", sql]]))).toBe(false);
  });

  it("trigger pamiętany między plikami i pasami: późniejszy GRANT INSERT na widok INVOKER zapala bramkę", () => {
    const closed = `${INVOKER_COMPAT}\nREVOKE ALL ON public.v FROM anon, authenticated;\n${TRIGGER}`;
    const grant = "GRANT INSERT ON public.v TO authenticated;";
    expect(
      fresh(
        run([
          ["1_v.sql", closed],
          ["2_g.sql", grant],
        ]),
      ),
    ).toEqual(["supabase:2_g.sql:public.v"]);
    expect(fresh(run([["1_v.sql", closed]], [["0001_g.sql", grant]]))).toEqual([
      "drizzle:0001_g.sql:public.v",
    ]);
    // CREATE OR REPLACE zachowuje trigger - bez REVOKE nadal naruszenie, choć INVOKER.
    const replaced = INVOKER_COMPAT.replace("CREATE VIEW", "CREATE OR REPLACE VIEW");
    expect(
      fresh(
        run([
          ["1_v.sql", closed],
          ["2_r.sql", replaced],
        ]),
      ),
    ).toEqual(["supabase:2_r.sql:public.v"]);
    // DROP VIEW zabiera trigger: nowy widok INVOKER bez triggera jest w porządku.
    const recreated = `DROP VIEW public.v;\n${INVOKER_COMPAT}`;
    expect(
      definerViewsFailed(
        run([
          ["1_v.sql", closed],
          ["2_r.sql", recreated],
        ]),
      ),
    ).toBe(false);
  });

  it("trigger na widoku spoza public przechodzi z nim przez SET SCHEMA public", () => {
    const sql = [
      "CREATE VIEW staging.v WITH (security_invoker = on) AS SELECT id FROM public.t;",
      "CREATE TRIGGER v_ins INSTEAD OF INSERT ON staging.v FOR EACH ROW EXECUTE FUNCTION public.tg_v_write();",
      "ALTER VIEW staging.v SET SCHEMA public;",
    ].join("\n");
    expect(fresh(run([["1_v.sql", sql]]))).toEqual(["supabase:1_v.sql:public.v"]);
  });
});

describe("każdy plik zamyka się sam - bez zaufania do historii", () => {
  it("CREATE OR REPLACE zamkniętego wcześniej widoku bez REVOKE w tym pliku = naruszenie", () => {
    const r = run([
      ["1_v.sql", CLOSED],
      ["2_v.sql", "CREATE OR REPLACE VIEW public.v AS SELECT id, 1 AS y FROM public.t;"],
    ]);
    expect(fresh(r)).toEqual(["supabase:2_v.sql:public.v"]);
    expect(r.fresh[0]!.reason).toContain("CREATE OR REPLACE");
  });

  it("CREATE OR REPLACE z REVOKE ALL w tym samym pliku przechodzi", () => {
    const r = run([
      ["1_v.sql", CLOSED],
      [
        "2_v.sql",
        `CREATE OR REPLACE VIEW public.v AS SELECT id, 1 AS y FROM public.t;\n${READ_ONLY}`,
      ],
    ]);
    expect(definerViewsFailed(r)).toBe(false);
  });

  it("DROP ... CASCADE tabeli bazowej, potem CREATE OR REPLACE = świeży widok z arwdDxtm", () => {
    const r = run([
      ["1_v.sql", CLOSED],
      ["2_t.sql", "DROP TABLE public.t CASCADE;\nCREATE TABLE public.t (id int PRIMARY KEY);"],
      [
        "3_v.sql",
        "CREATE OR REPLACE VIEW public.v AS SELECT id FROM public.t;\nGRANT SELECT ON public.v TO anon;",
      ],
    ]);
    expect(fresh(r)).toEqual(["supabase:3_v.sql:public.v"]);
  });

  it("DROP VIEW + CREATE OR REPLACE (kształt Lovable) bez REVOKE = naruszenie", () => {
    const r = run([
      ["1_v.sql", CLOSED],
      [
        "2_v.sql",
        "DROP VIEW IF EXISTS public.v;\nCREATE OR REPLACE VIEW public.v AS SELECT id FROM public.t;\nGRANT SELECT ON public.v TO anon, authenticated;",
      ],
    ]);
    expect(fresh(r)).toEqual(["supabase:2_v.sql:public.v"]);
  });

  it("RENAME starego widoku i CREATE OR REPLACE pod tą nazwą = nowy widok z arwdDxtm", () => {
    const r = run([
      ["1_v.sql", CLOSED],
      [
        "2_v.sql",
        "ALTER VIEW public.v RENAME TO v_old;\nCREATE OR REPLACE VIEW public.v AS SELECT id FROM public.t;",
      ],
    ]);
    expect(fresh(r)).toEqual(["supabase:2_v.sql:public.v"]);
  });

  it("zbuduj-i-podmień: zamknięty v_new przemianowany na v przechodzi", () => {
    const sql = `CREATE VIEW public.v_new AS SELECT id FROM public.t;
REVOKE ALL ON public.v_new FROM anon, authenticated;
GRANT SELECT ON public.v_new TO anon, authenticated;
DROP VIEW public.v;
ALTER VIEW public.v_new RENAME TO v;`;
    expect(
      definerViewsFailed(
        run([
          ["1_v.sql", CLOSED],
          ["2_swap.sql", sql],
        ]),
      ),
    ).toBe(false);
  });

  it("SET SCHEMA do public przenosi otwarty widok; przeniesienie poza public go zwalnia", () => {
    const into = run([
      [
        "1_v.sql",
        "CREATE VIEW staging.v AS SELECT 1 AS x;\nALTER VIEW staging.v SET SCHEMA public;",
      ],
    ]);
    expect(fresh(into)).toEqual(["supabase:1_v.sql:public.v"]);
    const out = run([["1_v.sql", `${DEFINER_VIEW}\nALTER VIEW public.v SET SCHEMA archive;`]]);
    expect(definerViewsFailed(out)).toBe(false);
  });

  it("przeplot pasów: CREATE OR REPLACE w supabase po INVOKER-ze z drizzle i tak wymaga REVOKE", () => {
    const r = run(
      [
        ["1_init.sql", CLOSED],
        ["3_add_col.sql", "CREATE OR REPLACE VIEW public.v AS SELECT id, 2 AS y FROM public.t;"],
      ],
      [
        [
          "0002_lovable_invoker.sql",
          "DROP VIEW IF EXISTS public.v;\nCREATE VIEW public.v WITH (security_invoker = on) AS SELECT id FROM public.t;",
        ],
      ],
    );
    expect(fresh(r)).toEqual(["supabase:3_add_col.sql:public.v"]);
  });
});

describe("ALTER i GRANT w późniejszych plikach", () => {
  it.each([
    [
      "ALTER VIEW ... SET (security_invoker = off)",
      "ALTER VIEW public.v SET (security_invoker = off);",
    ],
    [
      "ALTER TABLE ... SET (security_invoker = off)",
      "ALTER TABLE public.v SET (security_invoker = off);",
    ],
    ["ALTER VIEW ... RESET (security_invoker)", "ALTER VIEW public.v RESET (security_invoker);"],
    [
      "ALTER TABLE z kilkoma podpoleceniami",
      "ALTER TABLE public.v SET (security_barrier = true), RESET (security_invoker);",
    ],
  ])("%s na widoku INVOKER = naruszenie, z linią i powodem", (_label, alter) => {
    const r = run([
      ["1_v.sql", "CREATE VIEW public.v WITH (security_invoker = on) AS SELECT 1 AS x;"],
      ["2_v.sql", `SELECT 1;\n${alter}`],
    ]);
    expect(fresh(r)).toEqual(["supabase:2_v.sql:public.v"]);
    expect(r.fresh[0]!.line).toBe(2);
    expect(r.fresh[0]!.reason).toContain("security_invoker = off/RESET");
  });

  it.each([
    ["kolumnowy UPDATE dla anon", "GRANT UPDATE (x) ON public.v TO anon;"],
    ["zwarty kolumnowy UPDATE", "GRANT UPDATE(x)ON public.v TO anon;"],
    ["ALL dla authenticated", "GRANT ALL ON public.v TO authenticated;"],
    ["INSERT dla PUBLIC", "GRANT INSERT ON public.v TO PUBLIC;"],
    ["TO GROUP anon", "GRANT DELETE ON public.v TO GROUP anon;"],
    ["ALL TABLES IN SCHEMA", "GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;"],
  ])("GRANT w późniejszym pliku na widok DEFINER (%s) = naruszenie", (_label, grant) => {
    const r = run([
      ["1_v.sql", CLOSED],
      ["2_v.sql", `SELECT 1;\n${grant}`],
    ]);
    expect(fresh(r)).toEqual(["supabase:2_v.sql:public.v"]);
    expect(r.fresh[0]!.line).toBe(2);
    expect(r.fresh[0]!.reason).toContain("GRANT");
  });

  it("GRANT SELECT dla klientów i GRANT ALL dla service_role nie są naruszeniem", () => {
    const r = run([
      ["1_v.sql", CLOSED],
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

  it("tabela pod nazwą widoku usuniętego niejawnie (CASCADE) nie jest widokiem - jej GRANT przechodzi", () => {
    const r = run([
      ["1_v.sql", CLOSED],
      [
        "2_t.sql",
        "DROP TABLE public.t CASCADE;\nCREATE TABLE public.v (id int);\nGRANT INSERT ON public.v TO authenticated;",
      ],
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
      [["1_v.sql", CLOSED]],
      [["0200_panel_grant.sql", "GRANT INSERT ON public.v TO authenticated;"]],
    );
    expect(fresh(r)).toEqual(["drizzle:0200_panel_grant.sql:public.v"]);
  });

  it("bliźniak drizzle z REVOKE ALL przechodzi", () => {
    expect(definerViewsFailed(run([["1_v.sql", CLOSED]], [["0200_twin.sql", CLOSED]]))).toBe(false);
  });
});

describe("fail closed", () => {
  it("CREATE VIEW, którego parser nie rozumie, czerwieni bramkę zamiast przejść po cichu", () => {
    const r = run([["1_v.sql", "CREATE SCHEMA s CREATE VIEW v AS SELECT 1;"]]);
    expect(r.parseDefects.join("\n")).toContain("1_v.sql:1");
    expect(definerViewsFailed(r)).toBe(true);
  });

  it("plik, którego nie da się podzielić na instrukcje, jest zgłoszony z nazwą - bez wywrotki", () => {
    const r = run(
      [["1_ok.sql", "SELECT 1;"]],
      [["0057_broken.sql", "CREATE FUNCTION f() RETURNS int AS $$ SELECT 1; "]],
    );
    expect(r.parseDefects.join("\n")).toContain("drizzle/migrations/0057_broken.sql");
    expect(definerViewsFailed(r)).toBe(true);
    expect(renderDefinerViewReport(r)).toContain("fail closed");
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
    ["plik domykający nie zdejmuje praw", "1_open.sql", "3_noop.sql", "nie zamyka"],
    ["plik domykający zamyka INNY widok", "1_open.sql", "4_other.sql", "nie zamyka"],
    ["plik domykający nie istnieje", "1_open.sql", "9_missing.sql", "nie istnieje"],
    ["plik domykający nie jest późniejszy", "1_open.sql", "0_earlier.sql", "nie jest późniejszy"],
    ["martwy wpis (to nie jest naruszenie)", "2_close.sql", "3_noop.sql", "Martwy wpis"],
  ])("wada rejestru: %s", (_label, file, closedBy, message) => {
    const r = run(
      [
        ["0_earlier.sql", "SELECT 1;"],
        ...history,
        ["3_noop.sql", "SELECT 1;"],
        [
          "4_other.sql",
          "CREATE VIEW public.w AS SELECT 1 AS x;\nREVOKE ALL ON public.w FROM anon, authenticated;",
        ],
      ],
      [],
      [{ lane: "supabase", file, view: "public.v", closedBy }],
    );
    expect(r.registryDefects.join("\n")).toContain(message);
    expect(definerViewsFailed(r)).toBe(true);
  });

  it("zdublowany wpis rejestru jest wadą", () => {
    const entry = {
      lane: "supabase" as const,
      file: "1_open.sql",
      view: "public.v",
      closedBy: "2_close.sql",
    };
    expect(run(history, [], [entry, entry]).registryDefects.join("\n")).toContain("Zdublowany");
  });
});

describe("self-test na realnych pasach migracji", () => {
  const supabase: LaneFiles = {
    lane: "supabase",
    files: readdirSync("supabase/migrations")
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((name) => ({ name, sql: readFileSync(join("supabase/migrations", name), "utf8") })),
  };
  const journal = (
    JSON.parse(readFileSync("drizzle/migrations/meta/_journal.json", "utf8")) as {
      entries: { tag: string }[];
    }
  ).entries;
  const drizzle: LaneFiles = {
    lane: "drizzle",
    files: journal.map(({ tag }) => ({
      name: `${tag}.sql`,
      sql: readFileSync(join("drizzle/migrations", `${tag}.sql`), "utf8"),
    })),
  };
  const real = [supabase, drizzle];

  it("obecny stan repo przechodzi z rejestrem znanych naruszeń", () => {
    const r = analyzeDefinerViews(real, KNOWN_DEFINER_VIEW_OFFENDERS);
    expect(r.parseDefects).toEqual([]);
    expect(r.registryDefects).toEqual([]);
    expect(r.fresh).toEqual([]);
    expect(r.offenders.length).toBe(KNOWN_DEFINER_VIEW_OFFENDERS.length);
  });

  it("rejestr nie rośnie (nowe naruszenie naprawia się migracją, nie wpisem)", () => {
    expect(KNOWN_DEFINER_VIEW_OFFENDERS.length).toBeLessThanOrEqual(25);
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
