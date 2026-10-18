// Bramka pasów migracji, kierunek odwrotny: każdy plik supabase od startu pasa
// drizzle ma kopię w dzienniku albo ZMIERZONY wpis SUPABASE_LANE_GAPS. Bez tego
// 20261007140300_subscriptions_tenant_from_owner przeszło pgTAP i nie trafiło
// do dziennika drizzle, który wykonuje produkcja.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DRIZZLE_DIR,
  SUPABASE_DIR,
  executableSql,
  readFileOrNull,
  type JournalEntry,
  type LaneEntry,
} from "@/lib/ci/migrationLaneParity";
import {
  DRIZZLE_LANE_START,
  PRE_LANE_FREEZE,
  SUPABASE_LANE_GAPS,
  SUPABASE_LANE_GAPS_CLOSED_FROM,
  analyzeSupabaseCoverage,
  coverageStatements,
  preLaneFingerprint,
  renderSupabaseCoverage,
  supabaseCoverageFailed,
  supabaseMigrationVersion,
  type SupabaseCoverageOptions,
  type SupabaseLaneGap,
} from "@/lib/ci/supabaseLaneCoverage";

describe("pokrycie pasa supabase w dzienniku drizzle (syntetycznie)", () => {
  const files: Record<string, string> = {
    [`${SUPABASE_DIR}/20260901000000_before_lane.sql`]: "DROP TABLE public.old;",
    [`${SUPABASE_DIR}/20261001000000_copied.sql`]: "-- nagłówek\nREVOKE ALL ON public.a FROM anon;",
    [`${SUPABASE_DIR}/20261001000100_declared.sql`]: "GRANT SELECT ON public.b TO anon;",
    [`${SUPABASE_DIR}/20261001000200_bundled.sql`]:
      "ALTER TABLE public.c ADD COLUMN x int;\nCOMMENT ON COLUMN public.c.x IS 'opis';",
    [`${SUPABASE_DIR}/20261001000300_known_gap.sql`]: "CREATE INDEX c_x ON public.c (x);",
    [`${SUPABASE_DIR}/20261101000400_new.sql`]: "REVOKE ALL ON public.d FROM authenticated;",
    [`${DRIZZLE_DIR}/0300_copied.sql`]: "REVOKE ALL ON public.a FROM anon;",
    // Bliźniak z rejestru o innej treści - pokrycie (ii), nie (i).
    [`${DRIZZLE_DIR}/0301_declared_trimmed.sql`]:
      "GRANT SELECT ON public.b TO anon, authenticated;",
    // Zestawienie przeformatowane (spacja przy nawiasach) i bez COMMENT ON.
    [`${DRIZZLE_DIR}/0302_bundle.sql`]:
      "ALTER TABLE public.c ADD COLUMN x int;\nALTER TABLE public.e ADD COLUMN y int;",
    // Sierota: plik leży w drizzle/, ale nie ma go w dzienniku.
    [`${DRIZZLE_DIR}/0399_orphan.sql`]: "REVOKE ALL ON public.d FROM authenticated;",
  };
  const read = (p: string) => files[p] ?? null;
  const supabaseFiles = Object.keys(files)
    .filter((p) => p.startsWith(`${SUPABASE_DIR}/`))
    .map((p) => p.slice(SUPABASE_DIR.length + 1))
    .sort();
  const listAll = () => supabaseFiles;
  const listWithoutNew = () => supabaseFiles.filter((f) => f !== "20261101000400_new.sql");
  const journal = ["0300_copied", "0301_declared_trimmed", "0302_bundle"];
  const lanes: LaneEntry[] = [
    { tag: "0301_declared_trimmed", twin: "20261001000100_declared.sql" },
    // Wpis `twin` sieroty spoza dziennika - nie może niczego pokryć.
    { tag: "0399_orphan", twin: "20261101000400_new.sql" },
  ];
  const gaps: SupabaseLaneGap[] = [
    { file: "20261001000200_bundled.sql", coveredBy: ["0302_bundle"], reason: "zestawienie" },
    { file: "20261001000300_known_gap.sql", pending: "Indeks bez kopii w dzienniku." },
  ];
  const base: SupabaseCoverageOptions = {
    gaps,
    read,
    listSupabase: listWithoutNew,
    lanes,
    preLane: null,
  };
  const run = (opts: SupabaseCoverageOptions = {}) =>
    analyzeSupabaseCoverage(journal, { ...base, ...opts });
  const kinds = (r: ReturnType<typeof analyzeSupabaseCoverage>) =>
    r.violations.map((v) => `${v.kind}:${v.file}`);

  it("kopia, bliźniak z dziennika i zmierzone zestawienie pokrywają; nowy plik bez kopii czerwieni", () => {
    const r = run({ listSupabase: listAll });
    // 20260901000000 jest sprzed DRIZZLE_LANE_START - bramka go nie sprawdza.
    expect(r.checked).toBe(5);
    expect(r.twins).toBe(2);
    expect(r.consolidated).toBe(1);
    expect(r.pending.map((p) => p.file)).toEqual(["20261001000300_known_gap.sql"]);
    // Wpis `twin` sieroty 0399 nie pokrywa 20261101000400 - migrator jej nie wykona.
    expect(kinds(r)).toEqual(["brak-kopii-drizzle:20261101000400_new.sql"]);
    expect(supabaseCoverageFailed(r)).toBe(true);
    const text = renderSupabaseCoverage(r);
    expect(text).toMatch(/^✗/);
    expect(text).toContain("[brak-kopii-drizzle] 20261101000400_new.sql");
  });

  it("znany brak (`pending`) nie czerwieni, ale raport drukuje go z powodem przy każdym przebiegu", () => {
    const r = run();
    expect(r.violations).toEqual([]);
    expect(supabaseCoverageFailed(r)).toBe(false);
    const text = renderSupabaseCoverage(r);
    expect(text).toMatch(/^✓/);
    expect(text).toContain("ZNANE BRAKI W DZIENNIKU DRIZZLE (1)");
    expect(text).toContain("20261001000300_known_gap.sql: Indeks bez kopii w dzienniku.");
  });

  it("`coveredBy` jest MIERZONE: tag z dziennika bez treści pliku niczego nie pokrywa", () => {
    // Deklaracja „zmierzone" przy pliku 0300, który nie niesie ALTER TABLE.
    const r = run({
      gaps: [
        { file: "20261001000200_bundled.sql", coveredBy: ["0300_copied"], reason: "zmierzone" },
        gaps[1]!,
      ],
    });
    expect(kinds(r)).toEqual(["niezmierzone-pokrycie:20261001000200_bundled.sql"]);
    expect(r.violations[0]!.detail).toContain("ALTER TABLE public.c ADD COLUMN x int");
    expect(r.consolidated).toBe(0);
  });

  it("instrukcję świadomie pominiętą w zestawieniu wpis wymienia w `uncovered`; zbędny prefiks idzie do usunięcia", () => {
    const withExtra: Record<string, string> = {
      ...files,
      [`${SUPABASE_DIR}/20261001000200_bundled.sql`]:
        "ALTER TABLE public.c ADD COLUMN x int;\nDO $$ BEGIN RAISE NOTICE 'diagnostyka'; END $$;",
    };
    const readExtra = (p: string) => withExtra[p] ?? null;
    const missing = run({ read: readExtra });
    expect(kinds(missing)).toEqual(["niezmierzone-pokrycie:20261001000200_bundled.sql"]);

    const justified = run({
      read: readExtra,
      gaps: [
        {
          file: "20261001000200_bundled.sql",
          coveredBy: ["0302_bundle"],
          uncovered: ["DO $$ BEGIN RAISE NOTICE", "DROP TABLE public.nigdy"],
          reason: "diagnostyka bez zapisu",
        },
        gaps[1]!,
      ],
    });
    expect(justified.violations).toEqual([]);
    expect(justified.consolidated).toBe(1);
    expect(justified.stale.map((s) => s.file)).toEqual(["20261001000200_bundled.sql"]);
    expect(justified.stale[0]!.detail).toContain("DROP TABLE public.nigdy");
  });

  it("`coveredBy` musi wskazywać tag z dziennika - sierota ani pusta lista niczego nie pokrywają", () => {
    const r = run({
      gaps: [
        { file: "20261001000200_bundled.sql", coveredBy: ["0399_orphan"], reason: "" },
        { file: "20261001000300_known_gap.sql", coveredBy: [], reason: "" },
      ],
    });
    expect(kinds(r)).toEqual([
      "pokrycie-spoza-dziennika:20261001000200_bundled.sql",
      "pokrycie-spoza-dziennika:20261001000300_known_gap.sql",
    ]);
    expect(r.violations[0]!.detail).toContain("0399_orphan");
  });

  it("lista znanych braków jest ZAMKNIĘTA: `pending` dla nowej migracji czerwieni", () => {
    const r = run({
      listSupabase: listAll,
      gaps: [...gaps, { file: "20261101000400_new.sql", pending: "port później" }],
    });
    expect(SUPABASE_LANE_GAPS_CLOSED_FROM <= "20261101000400").toBe(true);
    expect(kinds(r)).toEqual(["zamkniety-rejestr:20261101000400_new.sql"]);
    expect(r.pending.map((p) => p.file)).toEqual(["20261001000300_known_gap.sql"]);
  });

  it("wpis dla pliku, którego nie ma w pasie supabase, i wpis sprzed startu pasa czerwienią", () => {
    const r = run({
      gaps: [
        ...gaps,
        { file: "20260901000000_before_lane.sql", pending: "x" },
        { file: "20261001000900_gone.sql", pending: "x" },
      ],
    });
    expect(kinds(r)).toEqual([
      "nieaktualny-wpis:20260901000000_before_lane.sql",
      "wpis-bez-pliku-supabase:20261001000900_gone.sql",
    ]);
  });

  it("wpis dla pliku, który zyskał kopię (panel Lovable dopisał ją prosto na main), NIE czerwieni - idzie do usunięcia", () => {
    const r = run({
      gaps: [
        ...gaps,
        { file: "20261001000000_copied.sql", pending: "port czeka" },
        { file: "20261001000100_declared.sql", coveredBy: ["0301_declared_trimmed"], reason: "" },
      ],
    });
    expect(r.violations).toEqual([]);
    expect(r.stale.map((s) => s.file)).toEqual([
      "20261001000000_copied.sql",
      "20261001000100_declared.sql",
    ]);
    expect(r.stale[0]!.detail).toContain("0300_copied");
    expect(r.twins).toBe(2);
    expect(r.pending.map((p) => p.file)).toEqual(["20261001000300_known_gap.sql"]);
    expect(renderSupabaseCoverage(r)).toContain(
      "DO USUNIĘCIA Z SUPABASE_LANE_GAPS (2, bez czerwieni)",
    );
  });

  it("zbiór sprzed pasa jest zamrożony: plik z cofniętą wersją czerwieni zamiast przejść bokiem", () => {
    const frozen = preLaneFingerprint(["20260901000000_before_lane.sql"]);
    expect(run({ preLane: frozen }).violations).toEqual([]);
    const backdated = run({
      preLane: frozen,
      listSupabase: () => [...listWithoutNew(), "20260118100000_new_rls_fix.sql"],
    });
    expect(kinds(backdated)).toEqual([`zmiana-sprzed-pasa:${SUPABASE_DIR}/*`]);
    expect(backdated.violations[0]!.detail).toContain("2 plików wobec zamrożonych 1");
    // Nazwa spoza konwencji też należy do zamrożonego zbioru, a nie znika z oczu.
    const misnamed = run({ preLane: frozen, listSupabase: () => [...listWithoutNew(), "fix.sql"] });
    expect(kinds(misnamed)).toEqual([`zmiana-sprzed-pasa:${SUPABASE_DIR}/*`]);
  });

  it("pomiar instrukcji: bez COMMENT ON, bez komentarzy i odporny na spację przy nawiasach", () => {
    expect(
      coverageStatements(
        "-- nagłówek\nCREATE POLICY p ON t USING ( a = 1 );\nCOMMENT ON TABLE t IS 'x';\n",
      ),
    ).toEqual(["CREATE POLICY p ON t USING(a = 1)"]);
    expect(supabaseMigrationVersion("20261018100000_x.sql")).toBe("20261018100000");
    expect(supabaseMigrationVersion("x.sql")).toBeNull();
  });
});

describe("self-test kierunku odwrotnego na realnym repozytorium", () => {
  const journalTags = (
    JSON.parse(readFileSync(`${DRIZZLE_DIR}/meta/_journal.json`, "utf8")) as {
      entries: JournalEntry[];
    }
  ).entries.map((e) => e.tag);
  const real = analyzeSupabaseCoverage(journalTags);

  it("obecny stan repo przechodzi: każdy plik od startu pasa drizzle jest pokryty albo jawnie znany", () => {
    expect(real.violations).toEqual([]);
    expect(real.stale).toEqual([]);
    expect(real.twins + real.consolidated + real.pending.length).toBe(real.checked);
  });

  for (const [file, tag] of [
    ["20261007140300_subscriptions_tenant_from_owner.sql", "0305_subscriptions_tenant_from_owner"],
    [
      "20261018100000_payment_webhook_events_follow_subscription_tenant.sql",
      "0306_payment_webhook_events_follow_subscription_tenant",
    ],
  ] as const) {
    it(`${file} ma KOPIĘ w dzienniku (${tag}), a nie wpis rejestru`, () => {
      expect(SUPABASE_LANE_GAPS.map((g) => g.file)).not.toContain(file);
      expect(journalTags).toContain(tag);
      expect(executableSql(readFileSync(`${DRIZZLE_DIR}/${tag}.sql`, "utf8"))).toBe(
        executableSql(readFileSync(`${SUPABASE_DIR}/${file}`, "utf8")),
      );
      // Bez rejestru i bez wpisów `twin` plik nadal jest pokryty - czyli treścią (i).
      const bare = analyzeSupabaseCoverage(journalTags, {
        gaps: [],
        read: readFileOrNull,
        listSupabase: () => [file],
        lanes: [],
        preLane: null,
      });
      expect(bare.violations).toEqual([]);
      expect(bare.twins).toBe(1);
    });
  }

  it("bez kopii 0305 w dzienniku bramka czerwieni na 20261007140300 - łapie pierwotny incydent", () => {
    const without = analyzeSupabaseCoverage(
      journalTags.filter((t) => t !== "0305_subscriptions_tenant_from_owner"),
    );
    expect(without.violations.map((v) => `${v.kind}:${v.file}`)).toContain(
      "brak-kopii-drizzle:20261007140300_subscriptions_tenant_from_owner.sql",
    );
  });

  it("rejestr luk jest posortowany po nazwie pliku, bez powtórzeń i wyłącznie od startu pasa drizzle", () => {
    const names = SUPABASE_LANE_GAPS.map((g) => g.file);
    expect(names).toEqual([...new Set(names)].sort());
    expect(names.every((f) => f >= DRIZZLE_LANE_START)).toBe(true);
  });

  it("znane braki to dokładnie wpisy `pending`, wszystkie sprzed zamknięcia rejestru, i ta lista tylko maleje", () => {
    const pending = SUPABASE_LANE_GAPS.filter((g) => "pending" in g).map((g) => g.file);
    expect(real.pending.map((p) => p.file)).toEqual(pending);
    expect(pending.every((f) => f < SUPABASE_LANE_GAPS_CLOSED_FROM)).toBe(true);
    expect(pending.length).toBeLessThanOrEqual(23);
  });

  it("zamrożony zbiór sprzed pasa odpowiada repozytorium", () => {
    expect(PRE_LANE_FREEZE.count).toBe(951);
    expect(analyzeSupabaseCoverage(journalTags).violations).toEqual([]);
  });
});
