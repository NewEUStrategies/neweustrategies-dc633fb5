// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW
//
// Plan decyduje o NAZWACH i KOLEJNOSCI czesci. Blad w wersji wpycha czesc 2
// za cudza migracje (albo zderza ja kluczem `schema_migrations.version`), blad
// w dzienniku drizzle sprawia, ze migrator pomija czesc (`when` mniejsze od
// ostatnio wykonanego) albo lancuch snapshotow sie rwie, a czesc bez znacznika
// harnessu wypada z replayu i harness zielenieje na bazie bez polowy migracji.
// Wzorce harnessow sa kopia z plikow run.sh - test pilnuje, ze sie nie
// rozjechaly, bo inaczej plan "gwarantowalby" cos, czego harness juz nie robi.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEPLOYED_MIGRATIONS, type DeployedMigrations } from "../migrationDeployed";
import { executableSql } from "../migrationLaneParity";
import { MigrationSplitError } from "../migrationSplit";
import {
  HARNESS_RULES,
  PROPAGATED_MARKERS,
  SPLIT_MARKER_RE,
  WHEN_STEP_MS,
  continuationParts,
  drizzlePartTag,
  harnessSelects,
  insertLaneEntries,
  mentionedInCode,
  partHeader,
  partTrailer,
  partVersion,
  planMigrationSplit,
  supabasePartName,
  type DrizzleJournal,
  type SplitPlanInput,
} from "../migrationSplitPlan";

const stmt = (name: string, bytes: number): string => {
  const head = `SELECT '${name}`;
  return `${head}${"x".repeat(Math.max(0, bytes - head.length - 3))}';\n`;
};

/** Migracja modulu wydarzen: w harnessie wydarzen tylko przez pierwsza instrukcje. */
const EVENTS_SQL = [
  "-- Naglowek oryginalu: po co ta migracja.",
  "CREATE OR REPLACE FUNCTION public.event_x() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;",
  stmt("a", 1500).trimEnd(),
  stmt("b", 1500).trimEnd(),
  stmt("c", 1500).trimEnd(),
  "",
].join("\n");

const FILE = "20260101000000_event_x.sql";

const journal = (tags: string[]): DrizzleJournal => ({
  version: "7",
  dialect: "postgresql",
  entries: tags.map((tag, idx) => ({
    idx,
    version: "7",
    when: 1000 + idx,
    tag,
    breakpoints: true,
  })),
});

const REGISTRY = [
  "export const MIGRATION_LANES: readonly LaneEntry[] = [",
  "  {",
  '    tag: "0000_event_x",',
  `    twin: "${FILE}",`,
  "  },",
  "];",
  "",
].join("\n");

/** Fikstury maja wersje z 2026-01 - pod prawdziwa linia bazowa, wiec "nic nie wdrozono". */
const NOTHING_DEPLOYED: DeployedMigrations = { baseline: "00000000000000", oversize: {} };

let ids = 0;
const base = (over: Partial<SplitPlanInput> = {}): SplitPlanInput => ({
  supabaseFile: FILE,
  deployed: NOTHING_DEPLOYED,
  supabaseSql: EVENTS_SQL,
  supabaseFiles: [
    "20251231000000_prev.sql",
    FILE,
    "20260201000000_later.sql",
    "20260102000000_next.sql",
  ],
  maxBytes: 3000,
  newId: () => `id-${(ids += 1)}`,
  ...over,
});

const withDrizzle = (over: Partial<SplitPlanInput> = {}): SplitPlanInput =>
  base({
    drizzle: {
      tag: "0000_event_x",
      sql: EVENTS_SQL.replace("-- Naglowek oryginalu: po co ta migracja.\n", ""),
      journal: journal(["0000_event_x"]),
      lastSnapshot: { id: "snap-0", prevId: "00000000-0000-0000-0000-000000000000", tables: {} },
    },
    registrySource: REGISTRY,
    ...over,
  });

describe("nazwy i wersje czesci", () => {
  it("czesc 1 zostaje pod nazwa oryginalu, czesc k dostaje wersje + k - 1 i sufiks _part<k>", () => {
    expect(partVersion("20260926180000", 2)).toBe("20260926180002");
    expect(partVersion("00000000000009", 1)).toBe("00000000000010");
    expect(supabasePartName("20260926180000", "x", 1)).toBe("20260926180000_x.sql");
    expect(supabasePartName("20260926180000", "x", 3)).toBe("20260926180002_x_part3.sql");
    expect(drizzlePartTag("0067_x", 67, 1)).toBe("0067_x");
    expect(drizzlePartTag("0067_x", 67, 2)).toBe("0068_x_part2");
    expect(drizzlePartTag("0009_x", 9999, 3)).toBe("10001_x_part3");
    // Blizniak poza dziennikiem: czesci dostaja JEGO numer, nie indeks dziennika.
    expect(drizzlePartTag("0057_event_cfp", null, 2)).toBe("0057_event_cfp_part2");
    expect(drizzlePartTag("0057_event_cfp", null, 1)).toBe("0057_event_cfp");
  });
});

describe("harnessy dobierajace migracje po tresci", () => {
  it("wzorce i znaczniki sa DOKLADNIE takie, jak w skryptach run.sh", () => {
    for (const rule of HARNESS_RULES) {
      const script = readFileSync(rule.script, "utf8");
      expect(script, rule.script).toContain(rule.ere);
      if (rule.nameIncludes !== undefined) expect(script).toContain(`*${rule.nameIncludes}*`);
      if (rule.marker !== undefined) expect(rule.ere).toContain(rule.marker);
    }
    for (const marker of PROPAGATED_MARKERS) {
      expect(readFileSync("scripts/pg-harness/run.sh", "utf8")).toContain(marker);
    }
  });

  it("wybiera po tresci albo po fragmencie nazwy", () => {
    const [events, clubs] = HARNESS_RULES;
    expect(harnessSelects(events!, "x.sql", "CREATE FUNCTION public.event_a(")).toBe(true);
    expect(harnessSelects(events!, "x.sql", "-- events-harness: include")).toBe(true);
    expect(harnessSelects(events!, "x.sql", "SELECT 1;")).toBe(false);
    expect(harnessSelects(clubs!, "1_discussion_clubs_a.sql", "SELECT 1;")).toBe(true);
    expect(harnessSelects(clubs!, "1_x.sql", "SELECT 1;")).toBe(false);
  });
});

describe("naglowek, stopka i rozpoznawanie czesci", () => {
  const ctx = {
    original: FILE,
    partName: (k: number) => supabasePartName("20260101000000", "event_x", k),
    markers: ["events-harness: include"],
    maxBytes: 46080,
  };

  it("naglowek i stopka sa czystym komentarzem ASCII z maszynowym znacznikiem czesci", () => {
    const header = partHeader(ctx, 2, 3);
    const trailer = partTrailer(ctx, 3);
    for (const text of [header, trailer]) {
      expect(executableSql(text)).toBe("");
      expect([...text].every((ch) => ch.charCodeAt(0) < 128)).toBe(true);
      expect(text).toContain("-- events-harness: include\n");
    }
    expect(SPLIT_MARKER_RE.exec(header)?.slice(1)).toEqual(["2", "3", FILE]);
    expect(SPLIT_MARKER_RE.exec(trailer)?.slice(1)).toEqual(["1", "3", FILE]);
    expect(header).toContain("20260101000002_event_x_part3.sql");
    expect(header.endsWith("\n")).toBe(true);
  });

  it("continuationParts: tylko pliki o ksztalcie czesci z naglowkiem wskazujacym oryginal, po numerze", () => {
    const files = {
      "20260101000002_event_x_part3.sql": `-- migration-split: part 3/3 of ${FILE}\nSELECT 3;`,
      "20260101000001_event_x_part2.sql": `-- migration-split: part 2/3 of ${FILE}\nSELECT 2;`,
      "20260101000009_event_x_part9.sql": "-- zwykla migracja o nazwie jak czesc\nSELECT 9;",
      "20260101000008_event_x_part8.sql":
        "-- migration-split: part 8/9 of 20250101000000_inny.sql\n",
      "20260101000007_event_x_part7.sql": null,
      [FILE]: "SELECT 1;",
      "20260101000003_other.sql": "SELECT 0;",
    } as Record<string, string | null>;
    expect(continuationParts(FILE, Object.keys(files), (name) => files[name] ?? null)).toEqual([
      "20260101000001_event_x_part2.sql",
      "20260101000002_event_x_part3.sql",
    ]);
  });

  it("insertLaneEntries dopisuje wpisy zaraz za wpisem oryginalu albo oddaje null", () => {
    const edited = insertLaneEntries(REGISTRY, "0000_event_x", FILE, [
      { tag: "0001_event_x_part2", twin: "20260101000001_event_x_part2.sql" },
    ]);
    expect(edited).toContain(
      `    twin: "${FILE}",\n  },\n  // Czesc 2 migracji 0000_event_x (scripts/split-migration.ts,\n  // limit wdrozenia Lovable) - para czesci to pelne blizniaki.\n`,
    );
    expect(edited).toContain(
      '  {\n    tag: "0001_event_x_part2",\n    twin: "20260101000001_event_x_part2.sql",\n  },\n];',
    );
    expect(insertLaneEntries(REGISTRY, "0009_brak", FILE, [])).toBeNull();
    expect(
      insertLaneEntries(
        REGISTRY.replace(
          "];",
          `${REGISTRY.slice(REGISTRY.indexOf("  {"), REGISTRY.indexOf("];"))}];`,
        ),
        "0000_event_x",
        FILE,
        [],
      ),
    ).toBeNull();
    // Bez rozpoznawalnych granic tablicy albo z wpisem poza nia - tez do reki.
    const block = REGISTRY.slice(REGISTRY.indexOf("  {") - 1, REGISTRY.indexOf("];"));
    const open = "export const MIGRATION_LANES: readonly LaneEntry[] = [\n";
    for (const registry of [
      `export const X = [${block}];\n`,
      `${open}];\nconst Y = [${block}];\n`,
      `const Y = [${block}];\n${open}];\n`,
      REGISTRY.replace("\n];\n", "\n]"),
    ]) {
      expect(insertLaneEntries(registry, "0000_event_x", FILE, []), registry).toBeNull();
    }
  });

  it("insertLaneEntries: czesci Z DZIENNIKA na koncu rejestru (kolejnosc dziennika), nie za oryginalem", () => {
    const registry = REGISTRY.replace(
      "];",
      '  {\n    tag: "0001_pozniejsza",\n    twin: "20260102000000_next.sql",\n  },\n];',
    );
    const parts = [
      { tag: "0002_event_x_part2", twin: "20260101000001_event_x_part2.sql" },
      { tag: "0003_event_x_part3", twin: "20260101000002_event_x_part3.sql" },
    ];
    const edited = insertLaneEntries(registry, "0000_event_x", FILE, parts, true)!;
    const order = ["0000_event_x", "0001_pozniejsza", "0002_event_x_part2", "0003_event_x_part3"];
    expect(order.map((t) => edited.indexOf(`tag: "${t}"`))).toEqual(
      order.map((t) => edited.indexOf(`tag: "${t}"`)).sort((a, b) => a - b),
    );
    expect(edited).toContain("  // Czesci 2..3 migracji 0000_event_x");
    expect(edited).toContain("kazda para czesci to pelne blizniaki.");
    expect(edited.endsWith('    twin: "20260101000002_event_x_part3.sql",\n  },\n];\n')).toBe(true);
    // Poza dziennikiem - zaraz za oryginalem, przed pozniejszym wpisem.
    const after = insertLaneEntries(registry, "0000_event_x", FILE, parts)!;
    expect(after.indexOf('"0002_event_x_part2"')).toBeLessThan(after.indexOf('"0001_pozniejsza"'));
  });
});

describe("planMigrationSplit - odmowy", () => {
  it("wdrozonej migracji nie tnie (forward-only): lista DEPLOYED_OVERSIZE albo wersja pod linia", () => {
    const listed = () =>
      planMigrationSplit(
        base({ deployed: { baseline: "00000000000000", oversize: { [FILE]: 1 } } }),
      );
    expect(listed).toThrow(MigrationSplitError);
    expect(listed).toThrow(
      /20260101000000_event_x\.sql to wdrozona migracja \(lista DEPLOYED_OVERSIZE, .*forward-only, nie tniemy/,
    );
    // Prawdziwy rejestr: wersja 2026-01 lezy pod linia 20260926100000.
    expect(() => planMigrationSplit(base({ deployed: DEPLOYED_MIGRATIONS }))).toThrow(
      /wersja <= linii bazowej 20260926100000/,
    );
    // Wersja ROWNA linii tez jest wdrozona (plik grup 20260926100000 jest na produkcji).
    const line = { baseline: "20260101000000", oversize: {} };
    expect(() => planMigrationSplit(base({ deployed: line }))).toThrow(/wdrozona migracja/);
    expect(
      planMigrationSplit(base({ deployed: { ...line, baseline: "20251231235959" } })).parts,
    ).toBe(3);
  });

  it("nazwa spoza konwencji, plik juz podzielony i zdublowana wersja", () => {
    expect(() => planMigrationSplit(base({ supabaseFile: "zla_nazwa.sql" }))).toThrow(
      /spoza konwencji/,
    );
    expect(() =>
      planMigrationSplit(
        base({ supabaseSql: `${EVENTS_SQL}-- migration-split: part 1/2 of ${FILE}\n` }),
      ),
    ).toThrow(/juz czescia/);
    expect(() =>
      planMigrationSplit(
        base({ supabaseFiles: [FILE, "20260101000000_event_y.sql", "README.md"] }),
      ),
    ).toThrow(/Wersje 20260101000000 maja tez: 20260101000000_event_y\.sql/);
  });

  it("brak wolnych wersji przed nastepna migracja", () => {
    expect(() =>
      planMigrationSplit(
        base({ supabaseFiles: [FILE, "20260101000002_next.sql", "20260101000005_x.sql"] }),
      ),
    ).toThrow(
      /potrzebuja wersji 20260101000001\.\.20260101000002, a nastepna migracja ma wersje 20260101000002/,
    );
  });

  it("tag drizzle spoza konwencji <numer>_<nazwa>", () => {
    const input = withDrizzle();
    const bad = () =>
      planMigrationSplit({ ...input, drizzle: { ...input.drizzle!, tag: "event_x" } });
    // Odmowa planu to MigrationSplitError - CLI zamienia ja na kod 1, nie na stack trace.
    expect(bad).toThrow(MigrationSplitError);
    expect(bad).toThrow(/event_x: tag drizzle spoza konwencji/);
  });

  it("blizniak z dziennika bez snapshotu ostatniego wpisu: lancuch prevId nie ma poczatku", () => {
    const input = withDrizzle();
    expect(() =>
      planMigrationSplit({ ...input, drizzle: { ...input.drizzle!, lastSnapshot: undefined } }),
    ).toThrow(/Brak drizzle\/migrations\/meta\/0000_snapshot\.json - lancuch prevId/);
  });

  it("plan nie nadpisuje istniejacego pliku - poza czescia 1, dziennikiem i rejestrem", () => {
    const own = [
      `supabase/migrations/${FILE}`,
      "drizzle/migrations/0000_event_x.sql",
      "drizzle/migrations/meta/_journal.json",
      "src/lib/ci/migrationLaneParity.ts",
    ];
    expect(planMigrationSplit(withDrizzle({ existingPaths: own })).parts).toBe(3);
    expect(() =>
      planMigrationSplit(
        withDrizzle({
          existingPaths: [
            ...own,
            "drizzle/migrations/0001_event_x_part2.sql",
            "drizzle/migrations/meta/0002_snapshot.json",
          ],
        }),
      ),
    ).toThrow(
      /nadpisalby istniejace pliki: drizzle\/migrations\/0001_event_x_part2\.sql, drizzle\/migrations\/meta\/0002_snapshot\.json\./,
    );
  });

  it("czesci drizzle za pozniejszymi wpisami dziennika: blad albo jawna zgoda", () => {
    const input = withDrizzle();
    const later = { ...input.drizzle!, journal: journal(["0000_event_x", "0001_pozniejsza"]) };
    expect(() => planMigrationSplit({ ...input, drizzle: later })).toThrow(
      /za 0000_event_x stoja juz: 0001_pozniejsza.*--allow-interleave/,
    );
    const plan = planMigrationSplit({ ...input, drizzle: later, allowInterleave: true });
    expect(plan.warnings[0]).toMatch(/Potwierdzone --allow-interleave/);
    expect(plan.drizzleParts.slice(1)).toEqual(["0002_event_x_part2", "0003_event_x_part3"]);
  });

  it("czesc wypadlaby z harnessu bez znacznika wlaczenia (rekrutacja)", () => {
    const sql = EVENTS_SQL.replace("public.event_x()", "public.career_x()");
    const file = "20260101000000_c.sql";
    expect(() =>
      planMigrationSplit(base({ supabaseSql: sql, supabaseFile: file, supabaseFiles: [file] })),
    ).toThrow(/20260101000001_c_part2\.sql wypadlaby z scripts\/careers-harness\/run\.sh/);
  });

  it("czesc weszlaby do harnessu, w ktorym oryginalu nie ma (nazwa wpisana w naglowek)", () => {
    const file = "20260101000000_events_tenant_id_key.sql";
    const sql = EVENTS_SQL.replace("public.event_x()", "public.nic()");
    expect(() =>
      planMigrationSplit(base({ supabaseFile: file, supabaseSql: sql, supabaseFiles: [file] })),
    ).toThrow(/weszlaby do scripts\/events-harness\/run\.sh/);
  });
});

describe("planMigrationSplit - plan", () => {
  it("plik w limicie: nic do zapisania, z blizniakiem i bez", () => {
    const small = planMigrationSplit(base({ supabaseSql: "SELECT 1;\n" }));
    expect(small).toMatchObject({ parts: 1, writes: [], drizzleParts: [], laneEntries: [] });
    expect(small.warnings[0]).toMatch(/miesci sie w limicie 3000 B/);
    const input = withDrizzle();
    const twin = planMigrationSplit({
      ...input,
      supabaseSql: "SELECT 1;\n",
      drizzle: { ...input.drizzle!, sql: "SELECT 1;\n" },
    });
    expect(twin.drizzleParts).toEqual(["0000_event_x"]);
    expect(twin.supabaseParts).toEqual([FILE]);
  });

  it("tylko pas supabase: czesci po kolei, znacznik harnessu w kazdej, ostrzezenie o braku blizniaka", () => {
    const plan = planMigrationSplit(base());
    expect(plan.parts).toBe(3);
    expect(plan.supabaseParts).toEqual([
      FILE,
      "20260101000001_event_x_part2.sql",
      "20260101000002_event_x_part3.sql",
    ]);
    expect(plan.writes.map((w) => w.path)).toEqual(
      plan.supabaseParts.map((p) => `supabase/migrations/${p}`),
    );
    for (const write of plan.writes) {
      expect(write.content).toContain("-- events-harness: include");
      expect(harnessSelects(HARNESS_RULES[0]!, write.path, write.content)).toBe(true);
    }
    expect(plan.writes[0]!.content.startsWith("-- Naglowek oryginalu")).toBe(true);
    expect(plan.warnings).toEqual([
      `${FILE} nie ma blizniaka drizzle w MIGRATION_LANES - dzielony jest tylko pas supabase.`,
    ]);
    expect(plan.sizes.every((s) => s.bytes <= 3000)).toBe(true);
    expect(plan.registryEdited).toBe(false);
  });

  it("znacznik wykluczenia z pg-harness przechodzi z oryginalu na kazda czesc", () => {
    const plan = planMigrationSplit(
      base({ supabaseSql: `-- pg-harness: exclude (zlepek)\n${EVENTS_SQL}` }),
    );
    for (const write of plan.writes) expect(write.content).toContain("pg-harness: exclude");
  });

  it("z blizniakiem: dziennik, snapshoty z lancuchem prevId, rejestr i identyczny SQL par", () => {
    ids = 0;
    const plan = planMigrationSplit(withDrizzle());
    expect(plan.drizzleParts).toEqual(["0000_event_x", "0001_event_x_part2", "0002_event_x_part3"]);
    const byPath = new Map(plan.writes.map((w) => [w.path, w.content]));
    const written = JSON.parse(
      byPath.get("drizzle/migrations/meta/_journal.json")!,
    ) as DrizzleJournal;
    expect(written.entries.slice(1)).toEqual([
      {
        idx: 1,
        version: "7",
        when: 1000 + WHEN_STEP_MS,
        tag: "0001_event_x_part2",
        breakpoints: true,
      },
      {
        idx: 2,
        version: "7",
        when: 1000 + 2 * WHEN_STEP_MS,
        tag: "0002_event_x_part3",
        breakpoints: true,
      },
    ]);
    const snap1 = JSON.parse(byPath.get("drizzle/migrations/meta/0001_snapshot.json")!);
    const snap2 = JSON.parse(byPath.get("drizzle/migrations/meta/0002_snapshot.json")!);
    expect([snap1.id, snap1.prevId, snap2.id, snap2.prevId]).toEqual([
      "id-1",
      "snap-0",
      "id-2",
      "id-1",
    ]);
    expect(Object.keys(snap1)).toEqual(["id", "prevId", "tables"]);
    expect(byPath.get("drizzle/migrations/meta/0001_snapshot.json")!.endsWith("}\n")).toBe(true);
    expect(plan.laneEntries).toEqual([
      { tag: "0001_event_x_part2", twin: "20260101000001_event_x_part2.sql" },
      { tag: "0002_event_x_part3", twin: "20260101000002_event_x_part3.sql" },
    ]);
    expect(plan.registryEdited).toBe(true);
    expect(byPath.get("src/lib/ci/migrationLaneParity.ts")).toContain('tag: "0002_event_x_part3"');
    plan.supabaseParts.forEach((name, k) => {
      const drizzleSql = byPath.get(`drizzle/migrations/${plan.drizzleParts[k]}.sql`)!;
      expect(executableSql(drizzleSql)).toBe(
        executableSql(byPath.get(`supabase/migrations/${name}`)!),
      );
      expect(drizzleSql).not.toContain("events-harness");
    });
  });

  it("blizniak POZA dziennikiem: czesci z jego numerem, bez wpisow i snapshotow, z wpisami rejestru", () => {
    const input = withDrizzle();
    const plan = planMigrationSplit({
      ...input,
      drizzle: {
        ...input.drizzle!,
        journal: journal(["0000_inny", "0001_inny"]),
        lastSnapshot: undefined,
      },
    });
    expect(plan.drizzleParts).toEqual(["0000_event_x", "0000_event_x_part2", "0000_event_x_part3"]);
    const paths = plan.writes.map((w) => w.path);
    expect(paths.filter((p) => p.includes("/meta/"))).toEqual([]);
    expect(paths).toContain("drizzle/migrations/0000_event_x_part3.sql");
    expect(plan.laneEntries).toEqual([
      { tag: "0000_event_x_part2", twin: "20260101000001_event_x_part2.sql" },
      { tag: "0000_event_x_part3", twin: "20260101000002_event_x_part3.sql" },
    ]);
    expect(plan.registryEdited).toBe(true);
    expect(plan.warnings[0]).toMatch(
      /0000_event_x nie ma wpisu w .*_journal\.json.*numer blizniaka/,
    );
    // Czesc 2 pasa drizzle w naglowku wskazuje wlasne nazwy (numer blizniaka).
    const part2 = plan.writes.find((w) => w.path.endsWith("0000_event_x_part2.sql"))!;
    expect(part2.content).toContain("0000_event_x_part2.sql .. 0000_event_x_part3.sql");
    // Za blizniakiem poza dziennikiem nie ma "przeplotu" - dziennik go nie wykonuje.
    expect(plan.warnings.join("\n")).not.toContain("allow-interleave");
  });

  it("rejestr bez prostego wpisu albo bez tresci: plan dziala, wpisy do reki", () => {
    const noSource = planMigrationSplit(withDrizzle({ registrySource: undefined }));
    const noBlock = planMigrationSplit(withDrizzle({ registrySource: "export const X = [];\n" }));
    for (const plan of [noSource, noBlock]) {
      expect(plan.registryEdited).toBe(false);
      expect(plan.writes.some((w) => w.path === "src/lib/ci/migrationLaneParity.ts")).toBe(false);
      expect(plan.warnings.join("\n")).toMatch(/NIE zostal zmieniony.*na koncu rejestru/);
      expect(plan.laneEntries).toHaveLength(2);
    }
    // Blizniak poza dziennikiem: wpisy do reki zaraz za jego wpisem.
    const input = withDrizzle({ registrySource: undefined });
    const outside = planMigrationSplit({
      ...input,
      drizzle: { ...input.drizzle!, journal: journal(["0000_inny"]), lastSnapshot: undefined },
    });
    expect(outside.warnings.join("\n")).toMatch(/NIE zostal zmieniony.*zaraz za nim/);
  });

  it("ostrzega o plikach, ktore czytaja migracje po nazwie - nie o samych wzmiankach w komentarzu", () => {
    const plan = planMigrationSplit(
      withDrizzle({
        references: [
          { path: "src/a.test.ts", content: `readFileSync("supabase/migrations/${FILE}")` },
          { path: "src/b.test.ts", content: 'files.filter((f) => f.endsWith("_event_x.sql"))' },
          { path: "src/c.test.ts", content: 'read("drizzle/migrations/0000_event_x.sql")' },
          { path: "src/d.test.ts", content: "nic tu nie ma" },
          { path: "src/e.ts", content: `// opis: ${FILE}\n * i w bloku ${FILE}\nconst a = 1;` },
          { path: "scripts/f.sh", content: `# ${FILE}\necho ok` },
          { path: "scripts/g.sql", content: `-- ${FILE}\nSELECT 1;` },
        ],
      }),
    );
    const refs = plan.warnings.filter((w) => w.includes("po nazwie"));
    expect(refs.map((w) => w.split(" ")[0])).toEqual([
      "src/a.test.ts",
      "src/b.test.ts",
      "src/c.test.ts",
    ]);
  });

  it("mentionedInCode: kod tak, komentarz nie - wedlug jezyka pliku", () => {
    const n = "20260101000000_event_x.sql";
    expect(mentionedInCode("a.ts", `read("${n}") // i komentarz`, n)).toBe(true);
    expect(mentionedInCode("a.ts", `const x = 1; // ${n}`, n)).toBe(false);
    expect(mentionedInCode("a.tsx", `/* ${n} */`, n)).toBe(false);
    expect(mentionedInCode("a.mjs", `   * ${n}`, n)).toBe(false);
    expect(mentionedInCode("run.sh", `grep -l x ${n} # opis`, n)).toBe(true);
    expect(mentionedInCode("run.sh", `echo a#b ${n}`, n)).toBe(true);
    expect(mentionedInCode("run.sh", `  # ${n}`, n)).toBe(false);
    expect(mentionedInCode("t.sql", `\\i ${n}`, n)).toBe(true);
    expect(mentionedInCode("t.sql", `SELECT 1; -- ${n}`, n)).toBe(false);
    // `*` na poczatku linii SQL to nie komentarz blokowy JS.
    expect(mentionedInCode("t.sql", ` * ${n}`, n)).toBe(true);
    expect(mentionedInCode("bez-rozszerzenia", `// ${n}\nx("${n}")`, n)).toBe(true);
    expect(mentionedInCode("a.ts", "nic", n)).toBe(false);
  });

  it("bez maxBytes stosuje domyslny limit 45 KiB", () => {
    const big = Array.from({ length: 8 }, (_, k) => stmt(`s${k}`, 8000)).join("");
    const plan = planMigrationSplit({ ...base({ supabaseSql: big }), maxBytes: undefined });
    expect(plan.parts).toBe(2);
    expect(plan.writes[1]!.content).toContain("po najwyzej 46080 B");
  });
});
