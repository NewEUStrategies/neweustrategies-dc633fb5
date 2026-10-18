// Kontrakt bramki `check:migration-lanes` + self-test na REALNYM dzienniku drizzle.
//
// Rejestr MIGRATION_LANES istniał, ale nic go nie wołało; od 2026-10-12 bramka
// jedzie w CI. Pilnuje trzech rzeczy: każdy wpis dziennika ma decyzję (bliźniak,
// powód albo identyczna kopia pliku supabase), każdy wpis dziennika ma plik .sql
// i `when` rośnie wzdłuż dziennika - inaczej migrator drizzle pomija wpis po
// cichu (ten PR trafił na to dwa razy).
//
// Od 2026-10-18 także kierunek odwrotny: każdy plik supabase od startu pasa
// drizzle ma kopię w dzienniku albo wpis SUPABASE_LANE_GAPS. Bez tego
// 20261007140300_subscriptions_tenant_from_owner przeszło pgTAP i nie trafiło
// na produkcję, która wykonuje wyłącznie dziennik drizzle.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  analyzeMigrationLanes,
  analyzeSupabaseCoverage,
  DRIZZLE_DIR,
  DRIZZLE_LANE_START,
  evaluateLaneGate,
  executableSql,
  KNOWN_NON_MONOTONIC_JOURNAL,
  KNOWN_ORPHAN_LANE_ENTRIES,
  laneGateFailed,
  nonMonotonicJournal,
  readFileOrNull,
  renderLaneGate,
  renderSupabaseCoverage,
  SUPABASE_DIR,
  SUPABASE_LANE_GAPS,
  supabaseCoverageFailed,
  type JournalEntry,
  type LaneEntry,
  type LaneReport,
  type SupabaseLaneGap,
} from "@/lib/ci/migrationLaneParity";

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
  violations,
});

const noKnown = { orphans: [] as string[], nonMonotonic: [] as string[] };

/** Syntetyczne tagi nie mają plików na dysku - czytnik udaje, że każdy istnieje. */
const anyFile = () => "SELECT 1;";

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
});

describe("pokrycie pasa supabase w dzienniku drizzle (kierunek odwrotny)", () => {
  const files: Record<string, string> = {
    [`${SUPABASE_DIR}/20260901000000_before_lane.sql`]: "DROP TABLE public.old;",
    [`${SUPABASE_DIR}/20261101000000_copied.sql`]: "-- nagłówek\nREVOKE ALL ON public.a FROM anon;",
    [`${SUPABASE_DIR}/20261101000100_declared.sql`]: "GRANT SELECT ON public.b TO anon;",
    [`${SUPABASE_DIR}/20261101000200_bundled.sql`]: "ALTER TABLE public.c ADD COLUMN x int;",
    [`${SUPABASE_DIR}/20261101000300_known_gap.sql`]: "CREATE INDEX c_x ON public.c (x);",
    [`${SUPABASE_DIR}/20261101000400_new.sql`]: "REVOKE ALL ON public.d FROM authenticated;",
    [`${DRIZZLE_DIR}/0300_copied.sql`]: "REVOKE ALL ON public.a FROM anon;",
    // Bliźniak z rejestru o innej treści - pokrycie (ii), nie (i).
    [`${DRIZZLE_DIR}/0301_declared_trimmed.sql`]:
      "GRANT SELECT ON public.b TO anon, authenticated;",
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
    { tag: "0301_declared_trimmed", twin: "20261101000100_declared.sql" },
    // Wpis `twin` sieroty spoza dziennika - nie może niczego pokryć.
    { tag: "0399_orphan", twin: "20261101000400_new.sql" },
  ];
  const gaps: SupabaseLaneGap[] = [
    { file: "20261101000200_bundled.sql", coveredBy: ["0302_bundle"], reason: "zestawienie" },
    { file: "20261101000300_known_gap.sql", pending: "Indeks bez kopii w dzienniku." },
  ];
  const kinds = (r: ReturnType<typeof analyzeSupabaseCoverage>) =>
    r.violations.map((v) => `${v.kind}:${v.file}`);

  it("kopia w dzienniku, bliźniak z dziennika i zestawienie pokrywają; nowy plik bez kopii czerwieni", () => {
    const r = analyzeSupabaseCoverage(journal, gaps, read, listAll, lanes);
    // 20260901000000 jest sprzed DRIZZLE_LANE_START - bramka go nie sprawdza.
    expect(r.checked).toBe(5);
    expect(r.twins).toBe(2);
    expect(r.consolidated).toBe(1);
    expect(r.pending.map((p) => p.file)).toEqual(["20261101000300_known_gap.sql"]);
    // Wpis `twin` sieroty 0399 nie pokrywa 20261101000400 - migrator jej nie wykona.
    expect(kinds(r)).toEqual(["brak-kopii-drizzle:20261101000400_new.sql"]);
    expect(supabaseCoverageFailed(r)).toBe(true);
    const text = renderSupabaseCoverage(r);
    expect(text).toMatch(/^✗/);
    expect(text).toContain("[brak-kopii-drizzle] 20261101000400_new.sql");
  });

  it("znany brak (`pending`) nie czerwieni, ale raport drukuje go z powodem przy każdym przebiegu", () => {
    const r = analyzeSupabaseCoverage(journal, gaps, read, listWithoutNew, lanes);
    expect(r.violations).toEqual([]);
    expect(supabaseCoverageFailed(r)).toBe(false);
    const text = renderSupabaseCoverage(r);
    expect(text).toMatch(/^✓/);
    expect(text).toContain("ZNANE BRAKI W DZIENNIKU DRIZZLE (1)");
    expect(text).toContain("20261101000300_known_gap.sql: Indeks bez kopii w dzienniku.");
  });

  it("`coveredBy` musi wskazywać tag z dziennika - sierota ani pusta lista niczego nie pokrywają", () => {
    const orphanCover: SupabaseLaneGap[] = [
      { file: "20261101000200_bundled.sql", coveredBy: ["0399_orphan"], reason: "" },
      { file: "20261101000300_known_gap.sql", coveredBy: [], reason: "" },
    ];
    const r = analyzeSupabaseCoverage(journal, orphanCover, read, listWithoutNew, lanes);
    expect(kinds(r)).toEqual([
      "pokrycie-spoza-dziennika:20261101000200_bundled.sql",
      "pokrycie-spoza-dziennika:20261101000300_known_gap.sql",
    ]);
    expect(r.violations[0]!.detail).toContain("0399_orphan");
  });

  it("wpis dla pliku, którego nie ma w pasie supabase, czerwieni bramkę", () => {
    const r = analyzeSupabaseCoverage(
      journal,
      [...gaps, { file: "20261101000900_gone.sql", pending: "x" }],
      read,
      listWithoutNew,
      lanes,
    );
    expect(kinds(r)).toEqual(["wpis-bez-pliku-supabase:20261101000900_gone.sql"]);
  });

  it("wpis dla pliku pokrytego już kopią (i) albo bliźniakiem (ii) - albo sprzed startu pasa - jest nieaktualny", () => {
    const stale: SupabaseLaneGap[] = [
      ...gaps,
      { file: "20260901000000_before_lane.sql", pending: "x" },
      { file: "20261101000000_copied.sql", pending: "port czeka" },
      { file: "20261101000100_declared.sql", coveredBy: ["0301_declared_trimmed"], reason: "" },
    ];
    const r = analyzeSupabaseCoverage(journal, stale, read, listWithoutNew, lanes);
    expect(kinds(r)).toEqual([
      "nieaktualny-wpis:20261101000000_copied.sql",
      "nieaktualny-wpis:20261101000100_declared.sql",
      "nieaktualny-wpis:20260901000000_before_lane.sql",
    ]);
    expect(r.violations[0]!.detail).toContain("0300_copied");
    // Pokrycie liczy się mimo nieaktualnego wpisu - wpis nie zmienia werdyktu pliku.
    expect(r.twins).toBe(2);
    expect(r.pending.map((p) => p.file)).toEqual(["20261101000300_known_gap.sql"]);
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
      const bare = analyzeSupabaseCoverage(journalTags, [], readFileOrNull, () => [file], []);
      expect(bare.violations).toEqual([]);
      expect(bare.twins).toBe(1);
    });
  }

  it("rejestr luk jest posortowany po nazwie pliku, bez powtórzeń i wyłącznie od startu pasa drizzle", () => {
    const names = SUPABASE_LANE_GAPS.map((g) => g.file);
    expect(names).toEqual([...new Set(names)].sort());
    expect(names.every((f) => f >= DRIZZLE_LANE_START)).toBe(true);
  });

  it("znane braki to dokładnie wpisy `pending` i ta lista tylko maleje", () => {
    const pending = SUPABASE_LANE_GAPS.filter((g) => "pending" in g).map((g) => g.file);
    expect(real.pending.map((p) => p.file)).toEqual(pending);
    // Nowy plik bez kopii portuje się do dziennika, a nie dopisuje do tej listy.
    expect(pending.length).toBeLessThanOrEqual(23);
  });
});
