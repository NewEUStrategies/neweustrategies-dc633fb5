import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  IMMUTABILITY_BASE_ENV,
  MIGRATION_EDIT_ALLOWLIST,
  MIGRATION_JOURNAL_PATH,
  allowlistErrors,
  analyzeMigrationImmutability,
  guardedMigrationPath,
  immutabilityFailed,
  parseRawDiff,
  renderImmutabilityReport,
  renderImmutabilitySkipped,
  resolveImmutabilityBase,
  type GitBaseProbe,
  type ImmutabilityReport,
  type MigrationDiffEntry,
  type MigrationEditAllowance,
} from "../migrationImmutability";

const ZERO = "0".repeat(40);
const blob = (n: number): string => n.toString(16).padStart(40, "a");

const SUPABASE_FILE = "supabase/migrations/20261025090000_adopt_event_speaker_panel_bio.sql";
const DRIZZLE_FILE = "drizzle/migrations/0312_builder_experiment_events_tenant_id.sql";
const SNAPSHOT_FILE = "drizzle/migrations/meta/0312_snapshot.json";

const added = (path: string, after = blob(1)): MigrationDiffEntry => ({
  change: "added",
  path,
  blobAfter: after,
});
const deleted = (path: string, before = blob(2)): MigrationDiffEntry => ({
  change: "deleted",
  path,
  blobBefore: before,
});
const modified = (path: string, before = blob(3), after = blob(4)): MigrationDiffEntry => ({
  change: "modified",
  path,
  blobBefore: before,
  blobAfter: after,
});

type Entry = readonly [tag: string, when: number];

function journal(entries: readonly Entry[], header: Record<string, unknown> = {}): string {
  return JSON.stringify(
    {
      version: "7",
      dialect: "postgresql",
      ...header,
      entries: entries.map(([tag, when], idx) => ({
        idx,
        version: "7",
        when,
        tag,
        breakpoints: true,
      })),
    },
    null,
    2,
  );
}

const BASE_ENTRIES: readonly Entry[] = [
  ["0000_a", 1000],
  ["0001_b", 2000],
  ["0002_c", 3000],
];

/** Diff samego dziennika z treściami bazy i HEAD pod blobami 10 i 11. */
function journalDiff(baseText: string, headText: string) {
  const blobs = new Map([
    [blob(10), baseText],
    [blob(11), headText],
  ]);
  return {
    diff: [modified(MIGRATION_JOURNAL_PATH, blob(10), blob(11))],
    readBlob: (sha: string): string => {
      const text = blobs.get(sha);
      if (text === undefined) throw new Error(`brak bloba ${sha}`);
      return text;
    },
  };
}

const noBlobs = (sha: string): string => {
  throw new Error(`niespodziewany odczyt bloba ${sha}`);
};

function analyzeJournal(
  baseText: string,
  headText: string,
  allowlist: readonly MigrationEditAllowance[] = [],
): ImmutabilityReport {
  const { diff, readBlob } = journalDiff(baseText, headText);
  return analyzeMigrationImmutability(diff, readBlob, allowlist);
}

const kinds = (report: ImmutabilityReport): string[] => report.violations.map((v) => v.kind);

const RANGE = { base: blob(20), source: IMMUTABILITY_BASE_ENV, head: blob(21) };

describe("parseRawDiff", () => {
  it("czyta wpisy A/M/D formatu `git diff --raw -z --no-abbrev`, zera SHA znaczą brak bloba", () => {
    const raw = [
      `:000000 100644 ${ZERO} ${blob(1)} A`,
      "drizzle/migrations/0399_x.sql",
      `:100644 100644 ${blob(3)} ${blob(4)} M`,
      "drizzle/migrations/meta/_journal.json",
      `:100644 000000 ${blob(2)} ${ZERO} D`,
      "supabase/migrations/20261001000000_y.sql",
      "",
    ].join("\0");
    expect(parseRawDiff(raw)).toEqual([
      added("drizzle/migrations/0399_x.sql"),
      modified("drizzle/migrations/meta/_journal.json"),
      deleted("supabase/migrations/20261001000000_y.sql"),
    ]);
  });

  it("zmiana typu pliku (T) jest zmianą istniejącego pliku", () => {
    const raw = `:100644 120000 ${blob(3)} ${blob(4)} T\0${DRIZZLE_FILE}\0`;
    expect(parseRawDiff(raw)).toEqual([modified(DRIZZLE_FILE)]);
  });

  it("pusty diff to brak zmian", () => {
    expect(parseRawDiff("")).toEqual([]);
  });

  it("przyjmuje pełne SHA-1 i SHA-256, odrzuca skrócone i niepełne", () => {
    const sha256 = "b".repeat(64);
    expect(parseRawDiff(`:100644 100644 ${sha256} ${"c".repeat(64)} M\0${DRIZZLE_FILE}\0`)).toEqual(
      [modified(DRIZZLE_FILE, sha256, "c".repeat(64))],
    );
    expect(() => parseRawDiff(`:100644 100644 abc1234 def5678 M\0${DRIZZLE_FILE}\0`)).toThrow();
    expect(() =>
      parseRawDiff(`:100644 100644 ${blob(3)}0 ${blob(4)}0 M\0${DRIZZLE_FILE}\0`),
    ).toThrow();
  });

  it("odrzuca zmianę nazwy - diff musi iść z --no-renames, inaczej usunięcie staje się niewidoczne", () => {
    const raw = `:100644 100644 ${blob(3)} ${blob(3)} R100\0a.sql\0b.sql\0`;
    expect(() => parseRawDiff(raw)).toThrow(/--no-renames/);
  });

  it("odrzuca wiersz spoza formatu i wpis bez ścieżki", () => {
    expect(() => parseRawDiff("M\tplik.sql\0")).toThrow(/git diff --raw/);
    expect(() => parseRawDiff(`:100644 100644 ${blob(3)} ${blob(4)} M\0`)).toThrow(/ścieżki/);
  });
});

describe("guardedMigrationPath", () => {
  it("pilnuje plików obu pasów, snapshotów i dziennika", () => {
    expect(guardedMigrationPath(SUPABASE_FILE)).toBe("supabase-sql");
    expect(guardedMigrationPath(DRIZZLE_FILE)).toBe("drizzle-sql");
    expect(guardedMigrationPath(SNAPSHOT_FILE)).toBe("drizzle-snapshot");
    expect(guardedMigrationPath(MIGRATION_JOURNAL_PATH)).toBe("drizzle-journal");
  });

  it("pomija pliki spoza katalogów migracji i spoza konwencji", () => {
    for (const path of [
      "drizzle/schema.ts",
      "drizzle.config.ts",
      "supabase/tests/drizzle_only_schema_adoption_test.sql",
      "supabase/migrations/sub/20261001000000_x.sql",
      "supabase/migrations/README.md",
      "drizzle/migrations/meta/notes.json",
      "drizzle/migrations/meta/0312_snapshot.json.bak",
      "scripts/supabase/migrations/20261001000000_x.sql",
    ]) {
      expect(guardedMigrationPath(path), path).toBeNull();
    }
  });
});

describe("analyzeMigrationImmutability - pliki migracji", () => {
  it("nowe pliki przechodzą i są tylko liczone", () => {
    const report = analyzeMigrationImmutability(
      [added(SUPABASE_FILE), added("drizzle/migrations/0399_x.sql"), added(SNAPSHOT_FILE)],
      noBlobs,
      [],
    );
    expect(report.added).toEqual([SUPABASE_FILE, "drizzle/migrations/0399_x.sql", SNAPSHOT_FILE]);
    expect(immutabilityFailed(report)).toBe(false);
  });

  it("usunięcie scalonej migracji (rewert bota) czerwieni bramkę w obu pasach", () => {
    const report = analyzeMigrationImmutability(
      [deleted(SUPABASE_FILE), deleted(DRIZZLE_FILE)],
      noBlobs,
      [],
    );
    expect(report.violations).toEqual([
      expect.objectContaining({ kind: "plik-usuniety", path: SUPABASE_FILE, blobAfter: null }),
      expect.objectContaining({ kind: "plik-usuniety", path: DRIZZLE_FILE, blobAfter: null }),
    ]);
    expect(immutabilityFailed(report)).toBe(true);
  });

  it("edycja w miejscu pliku SQL albo snapshotu czerwieni bramkę i niesie SHA bloba po zmianie", () => {
    const report = analyzeMigrationImmutability(
      [modified(DRIZZLE_FILE, blob(3), blob(5)), modified(SNAPSHOT_FILE, blob(3), blob(6))],
      noBlobs,
      [],
    );
    expect(report.violations).toEqual([
      expect.objectContaining({ kind: "plik-zmieniony", path: DRIZZLE_FILE, blobAfter: blob(5) }),
      expect.objectContaining({ kind: "plik-zmieniony", path: SNAPSHOT_FILE, blobAfter: blob(6) }),
    ]);
  });

  it("pomija pliki, których bramka nie pilnuje", () => {
    const report = analyzeMigrationImmutability(
      [modified("drizzle/schema.ts"), deleted("supabase/tests/x_test.sql")],
      noBlobs,
      [],
    );
    expect(report).toEqual({
      added: [],
      appendedEntries: [],
      violations: [],
      allowed: [],
      registryErrors: [],
    });
  });

  it("wpis rejestru z dokładnym SHA bloba po zmianie dopuszcza edycję i zostaje w raporcie", () => {
    const allowance: MigrationEditAllowance = {
      path: DRIZZLE_FILE,
      kind: "rewrite-unapplied",
      reason: "--verify: brak w rejestrze; poprawka dryfu przed pierwszym wdrożeniem",
      blobAfter: blob(5),
    };
    const report = analyzeMigrationImmutability(
      [modified(DRIZZLE_FILE, blob(3), blob(5))],
      noBlobs,
      [allowance],
    );
    expect(report.violations).toEqual([]);
    expect(report.allowed).toEqual([allowance]);
    expect(immutabilityFailed(report)).toBe(false);
  });

  it("martwy wpis rejestru (inny SHA) nie otwiera furtki dla kolejnej edycji tej samej ścieżki", () => {
    const report = analyzeMigrationImmutability(
      [modified(DRIZZLE_FILE, blob(5), blob(6))],
      noBlobs,
      [
        {
          path: DRIZZLE_FILE,
          kind: "bot-pending-fix",
          reason: "dawna poprawka",
          blobAfter: blob(5),
        },
      ],
    );
    expect(kinds(report)).toEqual(["plik-zmieniony"]);
    expect(report.allowed).toEqual([]);
  });

  it("zgoda na usunięcie (blobAfter: null) nie dopuszcza edycji, a zgoda na treść - usunięcia", () => {
    const allowlist: MigrationEditAllowance[] = [
      { path: DRIZZLE_FILE, kind: "other", reason: "sierota spoza dziennika", blobAfter: null },
      { path: SUPABASE_FILE, kind: "other", reason: "poprawka treści", blobAfter: blob(4) },
    ];
    const deletionAllowed = analyzeMigrationImmutability(
      [deleted(DRIZZLE_FILE)],
      noBlobs,
      allowlist,
    );
    expect(deletionAllowed.violations).toEqual([]);
    expect(deletionAllowed.allowed).toEqual([allowlist[0]]);

    const report = analyzeMigrationImmutability(
      [modified(DRIZZLE_FILE), deleted(SUPABASE_FILE)],
      noBlobs,
      allowlist,
    );
    expect(kinds(report)).toEqual(["plik-zmieniony", "plik-usuniety"]);
  });
});

describe("analyzeMigrationImmutability - dziennik drizzle", () => {
  const BASE = journal(BASE_ENTRIES);

  it("dopisanie wpisów na końcu przechodzi i jest wypisane", () => {
    const report = analyzeJournal(
      BASE,
      journal([...BASE_ENTRIES, ["0003_d", 4000], ["0004_e", 5000]]),
    );
    expect(report.violations).toEqual([]);
    expect(report.appendedEntries).toEqual(["0003_d", "0004_e"]);
  });

  it("samo przeformatowanie dziennika nie jest zmianą", () => {
    const compact = JSON.stringify(JSON.parse(BASE));
    const report = analyzeJournal(BASE, compact);
    expect(report.violations).toEqual([]);
    expect(report.appendedEntries).toEqual([]);
  });

  it("zmiana `when` dawnego wpisu czerwieni bramkę z polem i wartościami (przypadek 9f6173f2a)", () => {
    const report = analyzeJournal(
      BASE,
      journal([
        ["0000_a", 1000],
        ["0001_b", 2500],
        ["0002_c", 3000],
      ]),
    );
    expect(report.violations).toEqual([
      expect.objectContaining({
        kind: "wpis-zmieniony",
        path: MIGRATION_JOURNAL_PATH,
        blobAfter: blob(11),
      }),
    ]);
    expect(report.violations[0].detail).toContain("0001_b");
    expect(report.violations[0].detail).toContain("when 2000 -> 2500");
  });

  it("zmiana innego pola wpisu (breakpoints, idx) też jest zmianą", () => {
    const head = JSON.parse(BASE) as { entries: Record<string, unknown>[] };
    head.entries[0].breakpoints = false;
    head.entries[2].idx = 7;
    const report = analyzeJournal(BASE, JSON.stringify(head));
    expect(kinds(report)).toEqual(["wpis-zmieniony", "wpis-zmieniony"]);
    expect(report.violations[0].detail).toContain("breakpoints true -> false");
    expect(report.violations[1].detail).toContain("idx 2 -> 7");
  });

  it("usunięcie dawnego wpisu czerwieni bramkę (rewert bota)", () => {
    const head = JSON.parse(BASE) as { entries: Record<string, unknown>[] };
    head.entries.splice(1, 1);
    const report = analyzeJournal(BASE, JSON.stringify(head));
    expect(kinds(report)).toEqual(["wpis-usuniety"]);
    expect(report.violations[0].detail).toContain("0001_b");
  });

  it("nowy wpis wstawiony przed końcem dawnych wpisów czerwieni bramkę", () => {
    const head = JSON.parse(BASE) as { entries: Record<string, unknown>[] };
    head.entries.splice(1, 0, {
      idx: 9,
      version: "7",
      when: 9000,
      tag: "0009_wstawka",
      breakpoints: true,
    });
    const report = analyzeJournal(BASE, JSON.stringify(head));
    expect(kinds(report)).toEqual(["wpis-wstawiony"]);
    expect(report.violations[0].detail).toContain("0009_wstawka");
    expect(report.appendedEntries).toEqual([]);
  });

  it("przestawienie dawnych wpisów czerwieni bramkę", () => {
    const head = JSON.parse(BASE) as { entries: Record<string, unknown>[] };
    head.entries = [head.entries[1], head.entries[0], head.entries[2]];
    const report = analyzeJournal(BASE, JSON.stringify(head));
    expect(kinds(report)).toEqual(["wpis-przestawiony"]);
    expect(report.violations[0].detail).toContain("0000_a");
  });

  it("duplikat dawnego wpisu dopisany na końcu to też przestawienie", () => {
    const head = JSON.parse(BASE) as { entries: Record<string, unknown>[] };
    head.entries.push({ ...head.entries[0] });
    const report = analyzeJournal(BASE, JSON.stringify(head));
    expect(kinds(report)).toEqual(["wpis-przestawiony"]);
  });

  it("zmiana nagłówka dziennika czerwieni bramkę", () => {
    const report = analyzeJournal(BASE, journal(BASE_ENTRIES, { version: "8" }));
    expect(kinds(report)).toEqual(["dziennik-naglowek"]);
    expect(report.violations[0].detail).toContain('version "7" -> "8"');
  });

  it("nieczytelny dziennik czerwieni bramkę - w HEAD i w bazie", () => {
    expect(kinds(analyzeJournal(BASE, "{ niepoprawny"))).toEqual(["dziennik-nieczytelny"]);
    expect(kinds(analyzeJournal(BASE, JSON.stringify({ entries: [{ idx: 0 }] })))).toEqual([
      "dziennik-nieczytelny",
    ]);
    expect(kinds(analyzeJournal(BASE, "[]"))).toEqual(["dziennik-nieczytelny"]);
    const fromBroken = analyzeJournal("{", BASE);
    expect(kinds(fromBroken)).toEqual(["dziennik-nieczytelny"]);
    expect(fromBroken.violations[0].detail).toMatch(/^baza: /);
  });

  it("usunięcie dziennika czerwieni bramkę", () => {
    const report = analyzeMigrationImmutability([deleted(MIGRATION_JOURNAL_PATH)], noBlobs, []);
    expect(kinds(report)).toEqual(["dziennik-usuniety"]);
  });

  it("wpis rejestru z SHA dziennika dopuszcza świadome przywrócenie wpisu w środku", () => {
    const head = journal(BASE_ENTRIES);
    // Rewert bota usuwa wpis, a następne zachowują swoje `idx`.
    const reverted = JSON.parse(head) as { entries: Record<string, unknown>[] };
    reverted.entries.splice(1, 1);
    const base = JSON.stringify(reverted, null, 2);
    const allowance: MigrationEditAllowance = {
      path: MIGRATION_JOURNAL_PATH,
      kind: "other",
      reason: "przywrócenie wpisu 0001_b usuniętego rewertem bota",
      blobAfter: blob(11),
    };
    expect(kinds(analyzeJournal(base, head))).toEqual(["wpis-wstawiony"]);
    const report = analyzeJournal(base, head, [allowance]);
    expect(report.violations).toEqual([]);
    expect(report.allowed).toEqual([allowance]);
  });
});

describe("MIGRATION_EDIT_ALLOWLIST", () => {
  it("rejestr w repozytorium jest poprawny", () => {
    expect(allowlistErrors(MIGRATION_EDIT_ALLOWLIST)).toEqual([]);
  });

  it("odrzuca wpisy, które nie opisują jednej konkretnej zmiany pliku migracji", () => {
    const errors = allowlistErrors([
      { path: "drizzle/schema.ts", kind: "other", reason: "x", blobAfter: blob(1) },
      { path: SUPABASE_FILE, kind: "other", reason: "  ", blobAfter: blob(1) },
      { path: DRIZZLE_FILE, kind: "other", reason: "x", blobAfter: "abc" },
      { path: DRIZZLE_FILE, kind: "other", reason: "x", blobAfter: `${blob(5)}0` },
      { path: DRIZZLE_FILE, kind: "other", reason: "x", blobAfter: blob(6).toUpperCase() },
      { path: DRIZZLE_FILE, kind: "rewrite-unapplied", reason: "x", blobAfter: null },
      { path: SNAPSHOT_FILE, kind: "rewrite-unapplied", reason: "x", blobAfter: blob(2) },
      { path: SUPABASE_FILE, kind: "bot-pending-fix", reason: "x", blobAfter: blob(3) },
      { path: SUPABASE_FILE, kind: "other", reason: "y", blobAfter: blob(3) },
    ]);
    expect(errors).toEqual([
      expect.stringContaining("drizzle/schema.ts"),
      expect.stringContaining("pusty powód"),
      expect.stringContaining("blobAfter musi"),
      expect.stringContaining("blobAfter musi"),
      expect.stringContaining("blobAfter musi"),
      expect.stringContaining("rewrite-unapplied zmienia treść"),
      expect.stringContaining("rewrite-unapplied zmienia treść"),
      expect.stringContaining("zdublowany"),
    ]);
  });

  it("przyjmuje SHA-256 bloba (repozytorium w formacie sha256)", () => {
    expect(
      allowlistErrors([
        { path: SUPABASE_FILE, kind: "rewrite-unapplied", reason: "x", blobAfter: "d".repeat(64) },
      ]),
    ).toEqual([]);
  });

  it("błędny wpis rejestru czerwieni bramkę nawet przy czystym diffie", () => {
    const report = analyzeMigrationImmutability([], noBlobs, [
      { path: SUPABASE_FILE, kind: "other", reason: "", blobAfter: null },
    ]);
    expect(report.registryErrors).toHaveLength(1);
    expect(immutabilityFailed(report)).toBe(true);
  });
});

describe("resolveImmutabilityBase", () => {
  function probe(commits: Record<string, string>, mergeBase: string | null): GitBaseProbe {
    return {
      resolveCommit: (ref) => commits[ref] ?? null,
      mergeBaseWithMain: () => mergeBase,
    };
  }

  it("bierze bazę z MIGRATION_IMMUTABILITY_BASE, gdy commit jest w klonie", () => {
    expect(
      resolveImmutabilityBase(` ${blob(20)}\n`, probe({ [blob(20)]: blob(20) }, blob(30))),
    ).toEqual({
      kind: "base",
      sha: blob(20),
      source: IMMUTABILITY_BASE_ENV,
    });
  });

  it("jawna baza nieobecna w klonie: ostrzeżenie zamiast porównania z czymś innym", () => {
    const base = resolveImmutabilityBase(blob(20), probe({}, blob(30)));
    expect(base).toEqual({ kind: "unavailable", reason: expect.stringContaining(blob(20)) });
    expect(base.kind === "unavailable" && base.reason).toContain("fetch");
  });

  it("pierwszy push gałęzi (SHA z zer) idzie przez merge-base z origin/main", () => {
    expect(resolveImmutabilityBase(ZERO, probe({}, blob(30)))).toEqual({
      kind: "base",
      sha: blob(30),
      source: expect.stringContaining("pierwszy push"),
    });
    const none = resolveImmutabilityBase(ZERO, probe({}, null));
    expect(none.kind).toBe("unavailable");
    expect(none.kind === "unavailable" && none.reason).toContain("pierwszy push");
  });

  it("bez zmiennej: merge-base HEAD origin/main, a bez niego ostrzeżenie", () => {
    for (const env of [undefined, "", "   "]) {
      expect(resolveImmutabilityBase(env, probe({}, blob(30)))).toEqual({
        kind: "base",
        sha: blob(30),
        source: "merge-base HEAD origin/main",
      });
      expect(resolveImmutabilityBase(env, probe({}, null)).kind).toBe("unavailable");
    }
  });
});

describe("renderImmutabilityReport", () => {
  it("zielony raport podaje zakres, liczniki i zmiany dopuszczone rejestrem", () => {
    const allowance: MigrationEditAllowance = {
      path: DRIZZLE_FILE,
      kind: "rewrite-unapplied",
      reason: "brak w rejestrze produkcji",
      blobAfter: blob(5),
    };
    const report = analyzeMigrationImmutability(
      [added(SUPABASE_FILE), modified(DRIZZLE_FILE, blob(3), blob(5))],
      noBlobs,
      [allowance],
    );
    const text = renderImmutabilityReport(report, RANGE);
    expect(text.split("\n")[0]).toMatch(/^✓ Niezmienność migracji: /);
    expect(text).toContain(blob(20).slice(0, 8));
    expect(text).toContain(blob(21).slice(0, 8));
    expect(text).toContain("nowe pliki migracji: 1");
    expect(text).toContain(`[rewrite-unapplied] ${DRIZZLE_FILE}`);
    expect(text).toContain("brak w rejestrze produkcji");
  });

  it("czerwony raport wylicza naruszenia, naprawę i gotowy wpis rejestru z SHA bloba", () => {
    const { diff, readBlob } = journalDiff(
      journal(BASE_ENTRIES),
      journal([
        ["0000_a", 1000],
        ["0002_c", 3000],
      ]),
    );
    const report = analyzeMigrationImmutability(
      [deleted(SUPABASE_FILE), modified(DRIZZLE_FILE, blob(3), blob(5)), ...diff],
      readBlob,
      [{ path: SNAPSHOT_FILE, kind: "other", reason: "", blobAfter: null }],
    );
    const text = renderImmutabilityReport(report, RANGE);
    expect(text.split("\n")[0]).toMatch(/^✗ Niezmienność migracji: /);
    expect(text).toContain(SUPABASE_FILE);
    expect(text).toContain("[wpis-usuniety]");
    expect(text).toContain("BŁĘDNE WPISY MIGRATION_EDIT_ALLOWLIST (1)");
    expect(text).toContain(`git checkout ${blob(20).slice(0, 12)} -- ${SUPABASE_FILE}`);
    expect(text).toContain("bun run migrations:mirror");
    expect(text).toContain("migrations:deploy-sql -- --verify");
    expect(text).toContain(
      `{ path: "${SUPABASE_FILE}", kind: "other", reason: "", blobAfter: null },`,
    );
    expect(text).toContain(
      `{ path: "${DRIZZLE_FILE}", kind: "other", reason: "", blobAfter: "${blob(5)}" },`,
    );
    expect(text).toContain(
      `{ path: "${MIGRATION_JOURNAL_PATH}", kind: "other", reason: "", blobAfter: "${blob(11)}" },`,
    );
  });

  it("raport pominięcia mówi, czego brakuje i jak to naprawić w CI", () => {
    const text = renderImmutabilitySkipped("commit bazowy niedostępny");
    expect(text).toMatch(/^⚠ Niezmienność migracji: POMINIĘTA/);
    expect(text).toContain("commit bazowy niedostępny");
    expect(text).toContain(IMMUTABILITY_BASE_ENV);
  });
});

describe("dziennik z repozytorium", () => {
  it("prawdziwy `_journal.json` parsuje się, a porównany sam ze sobą nie ma naruszeń", () => {
    const text = readFileSync(MIGRATION_JOURNAL_PATH, "utf8");
    const report = analyzeJournal(text, text);
    expect(report.violations).toEqual([]);
    const withAppended = JSON.parse(text) as { entries: Record<string, unknown>[] };
    const last = withAppended.entries.at(-1);
    withAppended.entries.push({ ...last, idx: 100000, tag: "99999_test", when: 9e15 });
    const appended = analyzeJournal(text, JSON.stringify(withAppended, null, 2));
    expect(appended.violations).toEqual([]);
    expect(appended.appendedEntries).toEqual(["99999_test"]);
  });
});
