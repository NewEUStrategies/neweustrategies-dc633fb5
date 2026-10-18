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
});
