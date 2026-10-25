// Kontrakt bramki `check:migration-lanes` + self-test na REALNYM dzienniku drizzle.
//
// Rejestr MIGRATION_LANES istniał, ale nic go nie wołało; od 2026-10-12 bramka
// jedzie w CI. Pilnuje trzech rzeczy: każdy wpis dziennika ma decyzję (bliźniak,
// powód albo identyczna kopia pliku supabase), każdy wpis dziennika ma plik .sql
// i `when` rośnie wzdłuż dziennika - inaczej migrator drizzle pomija wpis po
// cichu (ten PR trafił na to dwa razy). Od zamrożenia (JOURNAL_FREEZE_IDX) wpis
// ocenia się wyłącznie po treści: lustro albo kopia pliku supabase, kanoniczny
// wyzwalacz wdrożenia albo znacznik z samych COMMENT ON.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  analyzeMigrationLanes,
  DEPLOY_TRIGGER_SQL,
  DRIZZLE_DIR,
  evaluateLaneGate,
  isCommentOnlySql,
  isDeployTrigger,
  JOURNAL_FREEZE_IDX,
  KNOWN_NON_MONOTONIC_JOURNAL,
  executableSql,
  KNOWN_ORPHAN_LANE_ENTRIES,
  laneGateFailed,
  MIGRATION_LANES,
  missingProductionCarriers,
  nonMonotonicJournal,
  renderLaneGate,
  REQUIRED_PRODUCTION_TWINS,
  SUPABASE_DIR,
  type JournalEntry,
  type LaneEntry,
  type LaneReport,
} from "@/lib/ci/migrationLaneParity";
import { coverageStatements } from "@/lib/ci/supabaseLaneCoverage";
import { mirrorHeader, mirrorSourceOf } from "@/lib/migrations/mirrorHeader";

const entry = (
  idx: number,
  when: number,
  tag = `${String(idx).padStart(4, "0")}_m`,
): JournalEntry => ({
  idx,
  when,
  tag,
});

const report = (violations: LaneReport["violations"] = []): LaneReport => ({
  checked: 3,
  twins: 1,
  drizzleOnly: 1,
  deployRecords: [],
  deployTriggers: [],
  deployMarkers: [],
  redundantRegistry: [],
  violations,
});

const noKnown = { orphans: [] as string[], nonMonotonic: [] as string[] };

/** Syntetyczne tagi nie mają plików na dysku - czytnik udaje, że każdy istnieje. */
const anyFile = () => "SELECT 1;";

/** Plik pasa supabase, którego kopie i lustra oceniają testy zamrożenia. */
const SRC = "20261101000000_fix.sql";
const BODY = "REVOKE ALL ON FUNCTION public.f() FROM anon;\n";
const SRC_TEXT = `-- nagłówek po polsku\n${BODY}`;
const BOT_SQL = "ALTER TABLE public.x ADD COLUMN y int;";
const MARKER_SQL = "COMMENT ON SCHEMA public IS 'PR #600 deployment';";
const TRIGGER_TAG = "0400_pr540_deployment_completion";

/**
 * Pasy na wstrzykniętych plikach: `drizzle` to tag -> treść wpisu dziennika,
 * `files` to nazwa -> treść pliku supabase. Zamrożenie jawnie, jak w runnerze (398).
 */
function lanes(
  drizzle: Readonly<Record<string, string>>,
  registry: readonly LaneEntry[] = [],
  {
    files = { [SRC]: SRC_TEXT },
    freezeIdx = 398,
  }: { files?: Readonly<Record<string, string>>; freezeIdx?: number } = {},
): LaneReport {
  const read = (p: string): string | null =>
    p.startsWith(`${DRIZZLE_DIR}/`)
      ? (drizzle[p.slice(DRIZZLE_DIR.length + 1, -".sql".length)] ?? null)
      : (files[p.slice(SUPABASE_DIR.length + 1)] ?? null);
  const list = () => Object.keys(files).sort();
  return analyzeMigrationLanes(Object.keys(drizzle), registry, read, list, freezeIdx);
}

const kinds = (r: LaneReport) => r.violations.map((v) => `${v.kind}:${v.tag}`);

describe("kolejność dziennika", () => {
  it("ściśle rosnące `when` jest w porządku", () => {
    expect(nonMonotonicJournal([entry(1, 10), entry(2, 20), entry(3, 30)])).toEqual([]);
  });

  it("wpis z `when` nie większym od poprzednika jest oznaczony", () => {
    expect(nonMonotonicJournal([entry(1, 10), entry(2, 20), entry(3, 20, "0003_dup")])).toEqual([
      "0003_dup",
    ]);
  });

  it("liczy się NAJPÓŹNIEJSZE wcześniejsze `when`, nie tylko poprzednik (tak liczy migrator)", () => {
    // 0003 jest późniejsze od 0002, ale wcześniejsze od 0001 - baza, która ma 0001,
    // pominie i 0002, i 0003.
    expect(
      nonMonotonicJournal([entry(1, 100), entry(2, 50, "0002_a"), entry(3, 60, "0003_b")]),
    ).toEqual(["0002_a", "0003_b"]);
  });
});

describe("ocena bramki względem list znanych przypadków", () => {
  const orphan = { kind: "wpis-bez-pliku" as const, tag: "0057_old", detail: "" };
  const missing = { kind: "brak-wpisu" as const, tag: "0200_panel", detail: "" };

  it("znana sierota nie czerwieni, nieznana i brak wpisu - tak", () => {
    const r = evaluateLaneGate(
      report([orphan, missing]),
      [],
      { orphans: ["0057_old"], nonMonotonic: [] },
      anyFile,
    );
    expect(r.fresh.map((v) => v.tag)).toEqual(["0200_panel"]);
    expect(laneGateFailed(r)).toBe(true);
  });

  it("znana sierota, której już nie ma, jest wadą listy (lista tylko maleje)", () => {
    const r = evaluateLaneGate(
      report([]),
      [],
      { orphans: ["0057_old"], nonMonotonic: [] },
      anyFile,
    );
    expect(r.stale).toEqual(["0057_old"]);
    expect(laneGateFailed(r)).toBe(true);
  });

  it("nowe odstępstwo kolejności czerwieni, znane - nie; znane, którego nie ma - też czerwieni", () => {
    const journal = [entry(1, 100), entry(2, 50, "0002_known"), entry(3, 70, "0003_new")];
    const r = evaluateLaneGate(
      report([]),
      journal,
      { orphans: [], nonMonotonic: ["0002_known", "0009_gone"] },
      anyFile,
    );
    expect(r.journalFresh).toEqual(["0003_new"]);
    expect(r.journalStale).toEqual(["0009_gone"]);
    const text = renderLaneGate(report([]), r);
    expect(text).toContain("NIEMONOTONICZNY DZIENNIK");
    expect(text).toContain("0009_gone");
  });

  it("samo znane odstępstwo kolejności, którego już nie ma, czerwieni bramkę", () => {
    const r = evaluateLaneGate(
      report([]),
      [entry(1, 1), entry(2, 2)],
      { orphans: [], nonMonotonic: ["0002_m"] },
      anyFile,
    );
    expect(r.journalStale).toEqual(["0002_m"]);
    expect(laneGateFailed(r)).toBe(true);
  });

  it("wpis dziennika bez pliku .sql czerwieni bramkę, nawet gdy ma decyzję w rejestrze", () => {
    // analyzeMigrationLanes pomija wpis z decyzją, gdy pliku nie ma - migrator by się wywrócił.
    const read = (p: string) => (p === `${DRIZZLE_DIR}/0002_m.sql` ? null : "SELECT 1;");
    const r = evaluateLaneGate(report([]), [entry(1, 1), entry(2, 2)], noKnown, read);
    expect(r.missingFiles).toEqual(["0002_m"]);
    expect(laneGateFailed(r)).toBe(true);
    const text = renderLaneGate(report([]), r);
    expect(text).toContain("WPISY DZIENNIKA BEZ PLIKU");
    expect(text).toContain("0002_m");
  });

  it("czysty raport i dziennik przechodzą", () => {
    const r = evaluateLaneGate(report([]), [entry(1, 1), entry(2, 2)], noKnown, anyFile);
    expect(laneGateFailed(r)).toBe(false);
    expect(renderLaneGate(report([]), r)).toMatch(/^✓/);
  });
});

describe("analiza pasów na wstrzykniętych plikach", () => {
  const files: Record<string, string> = {
    [`${SUPABASE_DIR}/20261012000000_a.sql`]: "-- nagłówek\nREVOKE ALL ON public.v FROM anon;",
    [`${DRIZZLE_DIR}/0200_copy.sql`]: "REVOKE ALL ON public.v FROM anon;",
    [`${DRIZZLE_DIR}/0201_panel_only.sql`]: "GRANT ALL ON public.v TO anon;",
    [`${DRIZZLE_DIR}/0202_twin_drift.sql`]: "REVOKE ALL ON public.v FROM authenticated;",
  };
  const read = (p: string) => files[p] ?? null;
  const list = () => ["20261012000000_a.sql"];
  const registry: LaneEntry[] = [{ tag: "0202_twin_drift", twin: "20261012000000_a.sql" }];

  it("kopia pliku supabase przechodzi bez wpisu, plik tylko-drizzle bez wpisu i rozjechany bliźniak - nie", () => {
    const r = analyzeMigrationLanes(
      ["0200_copy", "0201_panel_only", "0202_twin_drift"],
      registry,
      read,
      list,
    );
    expect(r.deployRecords.map((d) => d.tag)).toEqual(["0200_copy"]);
    expect(r.violations.map((v) => `${v.kind}:${v.tag}`)).toEqual([
      "brak-wpisu:0201_panel_only",
      "rozjazd-sql:0202_twin_drift",
    ]);
    expect(laneGateFailed(evaluateLaneGate(r, [], noKnown, read))).toBe(true);
  });
});

describe("nagłówek lustra generatora (src/lib/migrations/mirrorHeader.ts)", () => {
  it("wskazuje źródło w pierwszej linii, a SQL wykonywalny go nie widzi", () => {
    const mirrored = mirrorHeader(SRC) + SRC_TEXT;
    expect(mirrorSourceOf(mirrored)).toBe(SRC);
    expect(mirrorSourceOf(mirrored.replace(/\n/g, "\r\n"))).toBe(SRC);
    expect(executableSql(mirrored)).toBe(executableSql(SRC_TEXT));
  });

  it("wpis panelu, nagłówek poza pierwszą linią i brak pliku nie mają źródła", () => {
    expect(mirrorSourceOf(BODY)).toBeNull();
    expect(mirrorSourceOf(`-- panel\n${mirrorHeader(SRC)}${BODY}`)).toBeNull();
    expect(mirrorSourceOf(null)).toBeNull();
  });

  it("jest liściem bez importów - bramka czyta go bez cyklu z generatorem", () => {
    const source = readFileSync("src/lib/migrations/mirrorHeader.ts", "utf8");
    expect(source).not.toMatch(/^\s*import\b/m);
    expect(source).not.toMatch(/\brequire\(/);
  });
});

describe("zamrożenie dziennika: supabase/migrations źródłem prawdy", () => {
  const gate = (r: LaneReport) => evaluateLaneGate(r, [], noKnown, anyFile);

  it("wpis po zamrożeniu spoza pasa supabase czerwieni jako wpis-spoza-zrodla: adopcja wg runbooka, rejestr się nie rozszerza", () => {
    const r = lanes({ "0399_bot_fix": BOT_SQL });
    expect(kinds(r)).toEqual(["wpis-spoza-zrodla:0399_bot_fix"]);
    const g = gate(r);
    expect(laneGateFailed(g)).toBe(true);
    const text = renderLaneGate(r, g);
    expect(text).toContain("[wpis-spoza-zrodla] 0399_bot_fix");
    expect(text).toContain("docs/RUNBOOK_MIGRACJE_LOVABLE.md §5");
    expect(text).toContain("rejestru MIGRATION_LANES nie rozszerzamy");
    // Furtka dla SQL-a, którego nie da się przenieść 1:1 (jak 0393), jest nazwana.
    expect(text).toContain("JOURNAL_FREEZE_IDX");
    // Rada „dopisz wpis do MIGRATION_LANES" dotyczy wyłącznie historii (brak-wpisu).
    expect(text).not.toContain("dopisz wpis do MIGRATION_LANES");
  });

  it("kopia pliku supabase po zamrożeniu to zapis wdrożenia bez naruszenia", () => {
    const r = lanes({ "0399_copy": BODY });
    expect(r.violations).toEqual([]);
    expect(r.deployRecords).toEqual([{ tag: "0399_copy", twin: SRC }]);
  });

  it("lustro generatora równe źródłu to zapis wdrożenia wskazujący źródło z nagłówka", () => {
    const r = lanes({ "0399_fix": mirrorHeader(SRC) + SRC_TEXT });
    expect(r.violations).toEqual([]);
    expect(r.deployRecords).toEqual([{ tag: "0399_fix", twin: SRC }]);
  });

  it("zmiana źródła lustra wyłącznie w komentarzach nie jest rozjazdem", () => {
    const r = lanes({ "0399_fix": mirrorHeader(SRC) + SRC_TEXT }, [], {
      files: { [SRC]: `-- poprawiony opis\n${BODY}` },
    });
    expect(r.violations).toEqual([]);
    expect(r.deployRecords).toEqual([{ tag: "0399_fix", twin: SRC }]);
  });

  it("wykonywalna zmiana źródła lustra to rozjazd-sql z zasadą forward-only, nie wpis-spoza-zrodla", () => {
    const changed = "REVOKE ALL ON FUNCTION public.f() FROM anon, authenticated;\n";
    const r = lanes({ "0399_fix": mirrorHeader(SRC) + BODY }, [], { files: { [SRC]: changed } });
    expect(kinds(r)).toEqual(["rozjazd-sql:0399_fix"]);
    expect(r.violations[0]!.detail).toContain("NOWĄ migrację");
    // Jedyny wyjątek: wpis, którego produkcja jeszcze nie wykonała.
    expect(r.violations[0]!.detail).toContain("bun run migrations:mirror --rewrite 0399_fix");
  });

  it("nagłówek wiąże lustro z jego źródłem: rozjazd nie chowa się za innym plikiem o starym SQL-u", () => {
    const changed = "REVOKE ALL ON FUNCTION public.f() FROM anon, authenticated;\n";
    const r = lanes({ "0399_fix": mirrorHeader(SRC) + BODY }, [], {
      files: { [SRC]: changed, "20261101000100_old_copy.sql": BODY },
    });
    expect(kinds(r)).toEqual(["rozjazd-sql:0399_fix"]);
    expect(r.deployRecords).toEqual([]);
  });

  it("lustro, którego źródła nie ma (usunięte albo przemianowane), to brak-blizniaka", () => {
    const r = lanes({ "0399_fix": mirrorHeader("20261101000200_renamed.sql") + BODY });
    expect(kinds(r)).toEqual(["brak-blizniaka:0399_fix"]);
    expect(r.violations[0]!.detail).toContain(`${SUPABASE_DIR}/20261101000200_renamed.sql`);
  });

  it("wpis z samych COMMENT ON po zamrożeniu to znacznik wdrożenia: przechodzi, ale raport ostrzega", () => {
    const r = lanes({ "0399_pr600_deployment_completion": MARKER_SQL });
    expect(r.violations).toEqual([]);
    expect(r.deployMarkers).toEqual(["0399_pr600_deployment_completion"]);
    expect(r.deployTriggers).toEqual([]);
    const g = gate(r);
    expect(laneGateFailed(g)).toBe(false);
    const text = renderLaneGate(r, g);
    expect(text).toMatch(/^✓/);
    expect(text).toContain("UWAGA - ZNACZNIKI WDROŻENIA");
    expect(text).toContain("  0399_pr600_deployment_completion");
  });

  it("granica zamrożenia: wpis 398 to historia z rejestrem, wpis 399 już ocena po treści", () => {
    const r = lanes({ "0398_marker": MARKER_SQL, "0399_marker": MARKER_SQL });
    expect(kinds(r)).toEqual(["brak-wpisu:0398_marker"]);
    expect(r.deployMarkers).toEqual(["0399_marker"]);
  });

  it("rejestr jest zamrożony: wpis MIGRATION_LANES dla lustra, kopii albo wpisu spoza źródła czerwieni", () => {
    const r = lanes(
      {
        "0399_fix": mirrorHeader(SRC) + SRC_TEXT,
        "0400_copy": BODY,
        "0401_bot_fix": BOT_SQL,
      },
      [
        { tag: "0399_fix", twin: SRC },
        { tag: "0400_copy", twin: SRC },
        { tag: "0401_bot_fix", drizzleOnly: "Naprawa dryfu z panelu Lovable." },
      ],
    );
    expect(kinds(r)).toEqual([
      "rejestr-zamrozony:0399_fix",
      "rejestr-zamrozony:0400_copy",
      "wpis-spoza-zrodla:0401_bot_fix",
      "rejestr-zamrozony:0401_bot_fix",
    ]);
    // Wpis rejestru niczego nie zwalnia: treść jest oceniona jak bez niego.
    expect(r.deployRecords.map((d) => d.tag)).toEqual(["0399_fix", "0400_copy"]);
    expect(r.twins + r.drizzleOnly).toBe(0);
    const g = gate(r);
    expect(laneGateFailed(g)).toBe(true);
    expect(renderLaneGate(r, g)).toContain("usuń wpis z MIGRATION_LANES");
  });

  it("wpis rejestru dla wyzwalacza albo znacznika po zamrożeniu to tylko zbędny wpis - bot Lovable je rejestrował", () => {
    const r = lanes(
      { [TRIGGER_TAG]: DEPLOY_TRIGGER_SQL, "0401_pr541_deployment_completion": MARKER_SQL },
      [
        { tag: TRIGGER_TAG, drizzleOnly: "Potwierdzenie wdrożenia PR #540." },
        {
          tag: "0401_pr541_deployment_completion",
          drizzleOnly: "Potwierdzenie wdrożenia PR #541.",
        },
      ],
    );
    expect(r.violations).toEqual([]);
    expect(r.deployTriggers).toEqual([TRIGGER_TAG]);
    expect(r.deployMarkers).toEqual(["0401_pr541_deployment_completion"]);
    expect(r.redundantRegistry).toEqual([TRIGGER_TAG, "0401_pr541_deployment_completion"]);
    const g = gate(r);
    expect(laneGateFailed(g)).toBe(false);
    const text = renderLaneGate(r, g);
    expect(text).toMatch(/^✓/);
    expect(text).toContain("ZBĘDNE WPISY MIGRATION_LANES (2, bez czerwieni)");
    expect(text).toContain(`  ${TRIGGER_TAG}`);
  });

  it("furtka: podniesienie JOURNAL_FREEZE_IDX z decyzją drizzleOnly przyjmuje wpis, którego nie da się przenieść", () => {
    const decision: LaneEntry[] = [
      { tag: "0399_bot_fix", drizzleOnly: "42710 na bazie z pasa supabase - jak 0393." },
    ];
    const r = lanes({ "0399_bot_fix": BOT_SQL }, decision, { freezeIdx: 399 });
    expect(r.violations).toEqual([]);
    expect(r.drizzleOnly).toBe(1);
  });
});

describe("kanoniczny wyzwalacz wdrożenia (narzędzie migracji Lovable)", () => {
  it("kanoniczna treść pod nazwą wyzwalacza przechodzi po cichu, bez wpisu rejestru", () => {
    const r = lanes({ [TRIGGER_TAG]: DEPLOY_TRIGGER_SQL });
    expect(r.violations).toEqual([]);
    expect(r.deployTriggers).toEqual([TRIGGER_TAG]);
    expect(r.deployMarkers).toEqual([]);
    const text = renderLaneGate(r, evaluateLaneGate(r, [], noKnown, anyFile));
    expect(text).toMatch(/^✓/);
    expect(text).toContain("1 wyzwalaczy wdrożenia");
    expect(text).not.toContain("UWAGA");
  });

  it("nazwa lovable_RRRRMMDD też oznacza wyzwalacz", () => {
    const tag = "0400_lovable_20261101_deployment_completion";
    expect(lanes({ [tag]: DEPLOY_TRIGGER_SQL }).deployTriggers).toEqual([tag]);
  });

  it("nazwa wyzwalacza z innym komentarzem albo kanoniczna treść pod inną nazwą to znacznik z ostrzeżeniem", () => {
    const r = lanes({
      [TRIGGER_TAG]: "COMMENT ON TABLE public.x IS 'PR #540';",
      "0401_fix": DEPLOY_TRIGGER_SQL,
    });
    expect(r.violations).toEqual([]);
    expect(r.deployTriggers).toEqual([]);
    expect(r.deployMarkers).toEqual([TRIGGER_TAG, "0401_fix"]);
  });

  it("kanoniczna treść z dodatkową instrukcją to wpis-spoza-zrodla", () => {
    const r = lanes({ [TRIGGER_TAG]: `${DEPLOY_TRIGGER_SQL}\nGRANT ALL ON public.x TO anon;` });
    expect(kinds(r)).toEqual([`wpis-spoza-zrodla:${TRIGGER_TAG}`]);
  });

  it("komentarze `--`, końcowy znak nowej linii i spacja między słowami kluczowymi nie przeszkadzają", () => {
    for (const content of [
      DEPLOY_TRIGGER_SQL,
      `${DEPLOY_TRIGGER_SQL}\n`,
      `-- Wdrożenie PR #540\r\n${DEPLOY_TRIGGER_SQL} -- no-op\n--`,
      "COMMENT  ON\nSCHEMA public\tIS 'standard public schema' ;",
    ])
      expect(isDeployTrigger(TRIGGER_TAG, content), content).toBe(true);
  });

  it("inny literał, inna nazwa, komentarz blokowy, znak spoza spacji PostgreSQL albo brak pliku to nie wyzwalacz", () => {
    expect(isDeployTrigger(TRIGGER_TAG, null)).toBe(false);
    // BOM i twardą spację baza czyta jak znaki identyfikatora - plik padłby na produkcji.
    expect(isDeployTrigger(TRIGGER_TAG, `\uFEFF${DEPLOY_TRIGGER_SQL}`)).toBe(false);
    expect(isDeployTrigger(TRIGGER_TAG, DEPLOY_TRIGGER_SQL.replace(" ON ", "\u00a0ON "))).toBe(
      false,
    );
    expect(
      isDeployTrigger(TRIGGER_TAG, "COMMENT ON SCHEMA public IS 'standard  public schema';"),
    ).toBe(false);
    expect(isDeployTrigger(TRIGGER_TAG, "COMMENT ON SCHEMA public IS 'PR #540';")).toBe(false);
    expect(isDeployTrigger(TRIGGER_TAG, `/* PR #540 */ ${DEPLOY_TRIGGER_SQL}`)).toBe(false);
    expect(isDeployTrigger("0400_fix", DEPLOY_TRIGGER_SQL)).toBe(false);
    expect(isDeployTrigger(`${TRIGGER_TAG}_v2`, DEPLOY_TRIGGER_SQL)).toBe(false);
  });

  it("instrukcja przemycona między dwoma literałami nie udaje wyzwalacza ani znacznika", () => {
    // Wycięcie `--` przed porównaniem zjadłoby `--` z wnętrza literału: po takim
    // wycięciu i zwarciu spacji ten tekst to dokładnie DEPLOY_TRIGGER_SQL, a baza
    // wykonałaby DROP TABLE.
    const smuggled =
      "COMMENT ON SCHEMA public IS 'standard --';DROP TABLE public.x;SELECT '\npublic schema';";
    expect(isDeployTrigger(TRIGGER_TAG, smuggled)).toBe(false);
    expect(isCommentOnlySql(smuggled)).toBe(false);
    expect(kinds(lanes({ [TRIGGER_TAG]: smuggled }))).toEqual([`wpis-spoza-zrodla:${TRIGGER_TAG}`]);
  });
});

describe("wpis z samych COMMENT ON", () => {
  it("rozpoznaje znacznik, a `;` w prozie komentarza nie dzieli instrukcji", () => {
    expect(isCommentOnlySql("COMMENT ON TABLE t IS 'a; b';")).toBe(true);
    expect(
      isCommentOnlySql(
        "-- nagłówek\nCOMMENT ON FUNCTION public.f() IS 'x';\nCOMMENT ON TABLE t IS E'y\\'; z';",
      ),
    ).toBe(true);
  });

  it("każda instrukcja spoza COMMENT ON, pusty plik i ciało cytowane dolarami dają `false`", () => {
    expect(isCommentOnlySql("COMMENT ON TABLE t IS 'a; b'; GRANT ALL ON t TO anon;")).toBe(false);
    expect(isCommentOnlySql("-- sam komentarz\n")).toBe(false);
    expect(isCommentOnlySql("")).toBe(false);
    // Operand cytowany dolarami nie jest maskowaną prozą - ocena zachowawcza.
    expect(isCommentOnlySql("COMMENT ON TABLE t IS $x$; DROP TABLE y; $x$;")).toBe(false);
  });
});

describe("poprawki wymagane na pasie produkcyjnym", () => {
  const FIX = "20261012000000_fix.sql";
  const files: Record<string, string> = {
    [`${SUPABASE_DIR}/${FIX}`]: "-- długi nagłówek\nREVOKE ALL ON FUNCTION public.f() FROM anon;",
    [`${DRIZZLE_DIR}/0001_other.sql`]: "SELECT 1;",
    [`${DRIZZLE_DIR}/0002_carrier.sql`]: "-- Twin\nREVOKE ALL ON FUNCTION public.f()  FROM anon;",
  };
  const read = (p: string) => files[p] ?? null;

  it("nośnik o tym samym SQL-u wykonywalnym wystarcza (nagłówek i spacje bez znaczenia)", () => {
    expect(missingProductionCarriers(["0001_other", "0002_carrier"], [FIX], read)).toEqual([]);
  });

  it("poprawka obecna tylko w pasie supabase jest brakiem - tak przeszło 20261007140200", () => {
    expect(missingProductionCarriers(["0001_other"], [FIX], read)).toEqual([FIX]);
  });

  it("wpis listy wskazujący plik, którego nie ma, też jest brakiem", () => {
    expect(missingProductionCarriers(["0002_carrier"], ["20990101000000_gone.sql"], read)).toEqual([
      "20990101000000_gone.sql",
    ]);
  });

  it("brak nośnika czerwieni bramkę i jest nazwany w raporcie", () => {
    const r = evaluateLaneGate(
      report([]),
      [entry(1, 1, "0001_other")],
      { ...noKnown, requiredTwins: [FIX] },
      read,
    );
    expect(r.missingCarriers).toEqual([FIX]);
    expect(laneGateFailed(r)).toBe(true);
    const text = renderLaneGate(report([]), r);
    expect(text).toContain("POPRAWKI BEZ NOŚNIKA NA PASIE PRODUKCYJNYM");
    expect(text).toContain(`${SUPABASE_DIR}/${FIX}`);
    // Nośnik generuje lustro, a nie ręczny wpis dziennika i rejestru.
    expect(text).toContain("Naprawa: bun run migrations:mirror");
    expect(text).not.toContain("MIGRATION_LANES");
  });

  it("bez listy wymaganych bramka nie sprawdza nośników (testy nie dziedziczą listy repo)", () => {
    const r = evaluateLaneGate(report([]), [entry(1, 1, "0001_other")], noKnown, read);
    expect(r.missingCarriers).toEqual([]);
  });
});

describe("self-test na realnym dzienniku drizzle", () => {
  const journal = (
    JSON.parse(readFileSync(`${DRIZZLE_DIR}/meta/_journal.json`, "utf8")) as {
      entries: JournalEntry[];
    }
  ).entries;
  const real = analyzeMigrationLanes(journal.map((e) => e.tag));

  it("obecny stan repo przechodzi z listami znanych przypadków", () => {
    const r = evaluateLaneGate(real, journal);
    expect(r.fresh).toEqual([]);
    expect(r.stale).toEqual([]);
    expect(r.journalFresh).toEqual([]);
    expect(r.journalStale).toEqual([]);
    expect(r.missingFiles).toEqual([]);
    expect(r.missingCarriers).toEqual([]);
  });

  it("lista poprawek wymaganych na produkcji tylko rośnie", () => {
    expect(REQUIRED_PRODUCTION_TWINS).toEqual(
      expect.arrayContaining([
        "20261007140200_release_coupon_server_only.sql",
        "20261018120000_release_coupon_order_lock.sql",
      ]),
    );
    expect(new Set(REQUIRED_PRODUCTION_TWINS).size).toBe(REQUIRED_PRODUCTION_TWINS.length);
  });

  it("każda wymagana poprawka ma nośnik w dzienniku zapisany jako bliźniak w rejestrze", () => {
    // Szukamy po TREŚCI, nie po tagu - przenumerowanie przy konflikcie z main
    // nie może zepsuć testu.
    for (const fix of REQUIRED_PRODUCTION_TWINS) {
      const want = executableSql(readFileSync(`${SUPABASE_DIR}/${fix}`, "utf8"));
      const carriers = journal.filter(
        (e) => executableSql(readFileSync(`${DRIZZLE_DIR}/${e.tag}.sql`, "utf8")) === want,
      );
      expect(carriers.length, fix).toBeGreaterThan(0);
      const registered = MIGRATION_LANES.filter((l) => "twin" in l && l.twin === fix).map(
        (l) => l.tag,
      );
      expect(
        carriers.some((c) => registered.includes(c.tag)),
        fix,
      ).toBe(true);
    }
  });

  it("dziennik bez nośnika poprawki kuponu zapala bramkę (stan sprzed portu 0305)", () => {
    const fix = "20261007140200_release_coupon_server_only.sql";
    const want = executableSql(readFileSync(`${SUPABASE_DIR}/${fix}`, "utf8"));
    const before = journal.filter(
      (e) => executableSql(readFileSync(`${DRIZZLE_DIR}/${e.tag}.sql`, "utf8")) !== want,
    );
    // Nośników może być kilka: panel Lovable dopisuje własną kopię wdrożonego
    // pliku (jak 0301-0304 po 0297-0300) - usuwamy wszystkie.
    expect(before.length).toBeLessThan(journal.length);
    const lanes = analyzeMigrationLanes(before.map((e) => e.tag));
    const r = evaluateLaneGate(lanes, before);
    expect(r.missingCarriers).toEqual([fix]);
    expect(laneGateFailed(r)).toBe(true);
    // Czerwień wynika z braku nośnika, nie tylko z osieroconego wpisu rejestru.
    expect(renderLaneGate(lanes, r)).toContain("POPRAWKI BEZ NOŚNIKA NA PASIE PRODUKCYJNYM");
  });

  it("listy znanych przypadków tylko maleją", () => {
    // Nowa sierota albo nowe odstępstwo kolejności naprawia się w dzienniku, nie wpisem.
    expect(KNOWN_ORPHAN_LANE_ENTRIES.length).toBeLessThanOrEqual(31);
    expect(KNOWN_NON_MONOTONIC_JOURNAL.length).toBeLessThanOrEqual(5);
  });

  it("listy znanych przypadków są dokładnie tym, co bramka dziś widzi", () => {
    expect(nonMonotonicJournal(journal)).toEqual([...KNOWN_NON_MONOTONIC_JOURNAL]);
    expect(real.violations.filter((v) => v.kind === "wpis-bez-pliku").map((v) => v.tag)).toEqual([
      ...KNOWN_ORPHAN_LANE_ENTRIES,
    ]);
  });

  it("wpis dopisany na koniec z `when` sprzed ostatniego wpisu main zapala bramkę (stara numeracja gałęzi)", () => {
    const last = journal[journal.length - 1]!;
    const stale = [...journal, entry(last.idx + 1, last.when - 1, "9999_branch_twin")];
    const r = evaluateLaneGate(real, stale);
    expect(r.journalFresh).toEqual(["9999_branch_twin"]);
    // Ten wpis nie ma też pliku - bramka mówi o tym osobno.
    expect(r.missingFiles).toEqual(["9999_branch_twin"]);
  });

  it("wpis z `when` RÓWNYM ostatniemu też zapala bramkę - migrator pomija `when` nie większe od zapisu", () => {
    const last = journal[journal.length - 1]!;
    const r = evaluateLaneGate(real, [
      ...journal,
      entry(last.idx + 1, last.when, "9999_same_when"),
    ]);
    expect(r.journalFresh).toEqual(["9999_same_when"]);
    expect(renderLaneGate(real, r)).toContain(
      "git checkout origin/main -- drizzle/migrations/meta && bun run migrations:mirror",
    );
  });

  it("zamrożenie na wpisie 398: rejestr i listy znanych przypadków to wyłącznie historia", () => {
    expect(JOURNAL_FREEZE_IDX).toBe(398);
    const idx = (tag: string) => Number(/^(\d+)_/.exec(tag)?.[1]);
    for (const tag of [
      ...MIGRATION_LANES.map((l) => l.tag),
      ...KNOWN_ORPHAN_LANE_ENTRIES,
      ...KNOWN_NON_MONOTONIC_JOURNAL,
    ])
      expect(idx(tag), tag).toBeLessThanOrEqual(JOURNAL_FREEZE_IDX);
  });

  it("historia dziennika: wpisy z samych COMMENT ON to 0137, 0329, 0346, 0391, 0398, a kanoniczny wyzwalacz - tylko 0391", () => {
    const history = journal
      .filter((e) => e.idx <= JOURNAL_FREEZE_IDX)
      .map((e) => ({ tag: e.tag, sql: readFileSync(`${DRIZZLE_DIR}/${e.tag}.sql`, "utf8") }));
    expect(history.filter((e) => isCommentOnlySql(e.sql)).map((e) => e.tag)).toEqual([
      "0137_event_participant_reminders_apply",
      "0329_pr520_deployment_completion",
      "0346_pr527_deployment_completion",
      "0391_pr530_deployment_completion",
      "0398_pr533_deployment_completion",
    ]);
    expect(history.filter((e) => isDeployTrigger(e.tag, e.sql)).map((e) => e.tag)).toEqual([
      "0391_pr530_deployment_completion",
    ]);
  });
});

describe("adopcja schematu drizzleOnly w pasie kanonicznym (20261025090000, 20261025090010)", () => {
  // Pliki adopcji NIE są bliźniakami 1:1 (warunkowy DROP + CREATE OR REPLACE,
  // dodatkowy indeks klucza obcego i polski komentarz kolumny), więc równości
  // SQL-a wykonywalnego nie ma - przypinamy, że każda instrukcja schematu wpisu
  // stoi w swoim pliku adopcji. DROP z 0148 zastępuje tam blok warunkowy, a ADD
  // COLUMN z 0392 nie jest przenoszony: kolumna jest w pasie od 20260725090300.
  it.each([
    [
      "0148_event_speaker_panel_bio",
      "20261025090000_adopt_event_speaker_panel_bio.sql",
      /^DROP FUNCTION /,
    ],
    [
      "0392_membership_coupon_source",
      "20261025090010_adopt_membership_coupon_source_indexes.sql",
      /^ALTER TABLE public\.membership_grants ADD COLUMN IF NOT EXISTS /,
    ],
  ] as const)("%s: każda instrukcja schematu stoi w %s", (tag, file, skip) => {
    const adopted = coverageStatements(readFileSync(`${SUPABASE_DIR}/${file}`, "utf8")).map((s) =>
      s.replace(/^CREATE OR REPLACE FUNCTION /, "CREATE FUNCTION "),
    );
    const want = coverageStatements(readFileSync(`${DRIZZLE_DIR}/${tag}.sql`, "utf8")).filter(
      (s) => !skip.test(s),
    );
    expect(want.length).toBeGreaterThan(0);
    expect(want.filter((s) => !adopted.includes(s))).toEqual([]);
    // Wpis zostaje decyzją `drizzleOnly`, a jej powód wskazuje plik adopcji.
    const decision = MIGRATION_LANES.find((l) => l.tag === tag);
    expect(decision && "drizzleOnly" in decision ? decision.drizzleOnly : "").toContain(file);
  });
});
