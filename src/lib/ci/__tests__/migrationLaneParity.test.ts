// Kontrakt bramki `check:migration-lanes` + self-test na REALNYM dzienniku drizzle.
//
// Rejestr MIGRATION_LANES istniał, ale nic go nie wołało; od 2026-10-12 bramka
// jedzie w CI. Pilnuje trzech rzeczy: każdy wpis dziennika ma decyzję (bliźniak,
// powód albo identyczna kopia pliku supabase), każdy wpis dziennika ma plik .sql
// i `when` rośnie wzdłuż dziennika - inaczej migrator drizzle pomija wpis po
// cichu (ten PR trafił na to dwa razy).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  analyzeMigrationLanes,
  DRIZZLE_DIR,
  evaluateLaneGate,
  KNOWN_NON_MONOTONIC_JOURNAL,
  KNOWN_ORPHAN_LANE_ENTRIES,
  laneGateFailed,
  nonMonotonicJournal,
  renderLaneGate,
  SUPABASE_DIR,
  type JournalEntry,
  type LaneEntry,
  type LaneReport,
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
