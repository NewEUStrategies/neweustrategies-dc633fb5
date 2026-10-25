// CLI generatora lustra (`bun run migrations:mirror`) na pamięciowym systemie
// plików: argumenty, kolejność zapisu (dziennik ostatni), --check/--dry-run,
// baza luster lokalnych, --rewrite i przepis na konflikt dziennika.
import { describe, expect, it, vi } from "vitest";
import {
  DRIZZLE_JOURNAL,
  DRIZZLE_MIGRATIONS_DIR,
  SUPABASE_MIGRATIONS_DIR,
} from "@/lib/ci/migrationSplitPlan";
import {
  DRIZZLE_META_DIR,
  DRY_SNAPSHOT_ID,
  JOURNAL_CONFLICT_FIX,
  MIRROR_NEXT_STEPS,
  journalText,
  snapshotText,
  type MirrorBase,
} from "@/lib/migrations/drizzleMirror";
import {
  MIRROR_USAGE,
  loadMirrorInput,
  parseMirrorArgs,
  runMirrorCli,
  type MirrorCliDeps,
} from "@/lib/migrations/drizzleMirrorCli";
import { mirrorHeader } from "@/lib/migrations/mirrorHeader";

const S = (name: string): string => `${SUPABASE_MIGRATIONS_DIR}/${name}`;
const D = (tag: string): string => `${DRIZZLE_MIGRATIONS_DIR}/${tag}.sql`;
const M = (idx: number): string =>
  `${DRIZZLE_META_DIR}/${String(idx).padStart(4, "0")}_snapshot.json`;

const B = "20261002000000_b_fix.sql";
const B_SQL = "GRANT EXECUTE ON FUNCTION public.a() TO service_role;\n";
const BASE: MirrorBase = {
  ref: "origin/main",
  entries: [{ idx: 0, when: 1_000_000, tag: "0000_a" }],
};

const entry = (idx: number, when: number, tag: string) => ({
  idx,
  version: "7",
  when,
  tag,
  breakpoints: true,
});

/** Repo w pamięci; `calls` zapisuje kolejność zapisów i usunięć. */
function memoryRepo(extra: Record<string, string> = {}) {
  const files = new Map(
    Object.entries({
      [S("20261001000000_a.sql")]: "REVOKE ALL ON FUNCTION public.a() FROM anon;\n",
      [D("0000_a")]: "REVOKE ALL ON FUNCTION public.a() FROM anon;",
      [M(0)]: snapshotText({
        id: "00000000-0000-4000-8000-000000000001",
        prevId: DRY_SNAPSHOT_ID,
        version: "7",
        dialect: "postgresql",
      }),
      [DRIZZLE_JOURNAL]: journalText({
        version: "7",
        dialect: "postgresql",
        entries: [entry(0, 1_000_000, "0000_a")],
      }),
      ...extra,
    }),
  );
  const calls: string[] = [];
  const fs = {
    read: (path: string) => files.get(path) ?? null,
    write: (path: string, content: string) => {
      calls.push(`write ${path}`);
      files.set(path, content);
    },
    remove: (path: string) => {
      calls.push(`remove ${path}`);
      files.delete(path);
    },
    list: (dir: string) =>
      [...files.keys()]
        .filter((p) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes("/"))
        .map((p) => p.slice(dir.length + 1)),
  };
  return { files, calls, fs };
}

function run(
  argv: readonly string[],
  repo: ReturnType<typeof memoryRepo>,
  base: MirrorBase | null = BASE,
) {
  const log: string[] = [];
  const baseJournal = vi.fn((_ref: string | null) => base);
  const deps: MirrorCliDeps = {
    fs: repo.fs,
    log: (line) => log.push(line),
    now: () => 9e12,
    baseJournal,
  };
  const code = runMirrorCli(argv, deps);
  return { code, out: log.join("\n"), baseJournal };
}

describe("parseMirrorArgs", () => {
  it("tryby, baza i --rewrite", () => {
    expect(parseMirrorArgs([])).toEqual({ mode: "write", base: null, rewrite: [] });
    expect(parseMirrorArgs(["--check"])).toEqual({ mode: "check", base: null, rewrite: [] });
    expect(parseMirrorArgs(["--dry-run", "--base", "upstream/main"])).toEqual({
      mode: "dry-run",
      base: "upstream/main",
      rewrite: [],
    });
    expect(parseMirrorArgs(["--no-base"])).toEqual({ mode: "write", base: false, rewrite: [] });
    expect(
      parseMirrorArgs(["--rewrite", "drizzle/migrations/0399_x.sql", "--rewrite", "0400_y"]),
    ).toEqual({ mode: "write", base: null, rewrite: ["0399_x", "0400_y"] });
  });

  it.each([
    [["--check", "--dry-run"], "wykluczają się"],
    [["--base"], "--base wymaga"],
    [["--base", "--check"], "--base wymaga"],
    [["--base", "main", "--no-base"], "Bazę podaj raz"],
    [["--rewrite"], "--rewrite wymaga"],
    [["--rewrite", "Zly-Tag"], "spoza konwencji"],
    [["--check", "--rewrite", "0399_x"], "nie łączy się z --check"],
    [["--force"], "Nieznana opcja --force"],
    [["adopt", "0148_event_speaker_panel_bio"], "Nieoczekiwany argument adopt"],
  ])("odrzuca %j", (argv, message) => {
    const parsed = parseMirrorArgs(argv);
    expect("error" in parsed && parsed.error).toContain(message);
  });
});

describe("runMirrorCli", () => {
  it("zapis tworzy lustro, snapshot i dziennik - dziennik OSTATNI; drugi przebieg nic nie pisze", () => {
    const repo = memoryRepo({ [S(B)]: B_SQL });
    const first = run([], repo);
    expect(first.code).toBe(0);
    expect(repo.calls).toEqual([
      `write ${D("0001_b_fix")}`,
      `write ${M(1)}`,
      `write ${DRIZZLE_JOURNAL}`,
    ]);
    expect(repo.files.get(D("0001_b_fix"))).toBe(mirrorHeader(B) + B_SQL);
    expect(first.out).toContain("Baza luster lokalnych: origin/main");
    expect(first.out).toContain("Wpisy dziennika do wdrożenia: idx 1-1 (0001_b_fix)");
    expect(first.out).toContain(`  1. ${MIRROR_NEXT_STEPS[0]}`);
    expect(first.baseJournal).toHaveBeenCalledWith(null);

    repo.calls.length = 0;
    const second = run([], repo);
    expect(second.code).toBe(0);
    expect(repo.calls).toEqual([]);
    expect(second.out).toContain("✓ Lustro drizzle aktualne");
    expect(second.out).toContain("Wpisy dziennika do wdrożenia: idx 1-1 (0001_b_fix)");
  });

  it("--check: kod 1 przy nieaktualnym lustrze, 0 przy aktualnym; nigdy nie pisze i nie pyta gita o bazę", () => {
    const repo = memoryRepo({ [S(B)]: B_SQL });
    const stale = run(["--check"], repo);
    expect(stale.code).toBe(1);
    expect(stale.out).toContain("✗ Lustro drizzle NIEAKTUALNE");
    expect(stale.baseJournal).not.toHaveBeenCalled();
    expect(repo.calls).toEqual([]);
    run([], repo);
    repo.calls.length = 0;
    expect(run(["--check"], repo).code).toBe(0);
    expect(repo.calls).toEqual([]);
  });

  it("--check --base <ref> używa bazy (przepisanie lustra lokalnego to nadal stan nieaktualny)", () => {
    const repo = memoryRepo({ [S(B)]: B_SQL });
    run([], repo);
    repo.files.set(S(B), B_SQL.replace("service_role", "authenticated"));
    const withBase = run(["--check", "--base", "origin/main"], repo);
    expect(withBase.baseJournal).toHaveBeenCalledWith("origin/main");
    expect(withBase.code).toBe(1);
    expect(withBase.out).toContain("+ 0001_b_fix");
    const withoutBase = run(["--check"], repo);
    expect(withoutBase.out).toContain("[zrodlo-rozjechane]");
  });

  it("--dry-run drukuje plan i niczego nie zapisuje", () => {
    const repo = memoryRepo({ [S(B)]: B_SQL });
    const { code, out } = run(["--dry-run"], repo);
    expect(code).toBe(0);
    expect(out).toContain("+ 0001_b_fix");
    expect(out).toContain("--dry-run: nic nie zapisano.");
    expect(repo.calls).toEqual([]);
  });

  it("plan z błędami: kod 1, bez zapisu", () => {
    const repo = memoryRepo({ [S(B)]: "VACUUM public.t;\n" });
    const { code, out } = run([], repo);
    expect(code).toBe(1);
    expect(out).toContain("[poza-transakcja]");
    expect(repo.calls).toEqual([]);
  });

  it.each([
    ["obie strony z wpisem", '{\n<<<<<<< HEAD\n  "a": 1\n=======\n  "a": 2\n>>>>>>> main\n}\n'],
    // Bez znaczników reszta byłaby poprawnym JSON-em - odmawiają same znaczniki.
    [
      "jedna strona pusta",
      '{"version": "7", "dialect": "postgresql", "entries": [\n<<<<<<< HEAD\n=======\n>>>>>>> origin/main\n]}\n',
    ],
  ])("dziennik ze znacznikami konfliktu (%s): kod 1 i przepis naprawy", (_name, text) => {
    const repo = memoryRepo({ [S(B)]: B_SQL, [DRIZZLE_JOURNAL]: text });
    const { code, out } = run([], repo);
    expect(code).toBe(1);
    expect(out).toContain("ma znaczniki konfliktu gita");
    expect(out).toContain(`  ${JOURNAL_CONFLICT_FIX}`);
    expect(out).toContain("git checkout origin/main -- drizzle/migrations/meta");
    expect(repo.calls).toEqual([]);
  });

  it("loadMirrorInput: brak dziennika i JSON bez tablicy entries to błąd; meta/ jak w drizzle-kit (każdy plik bez _)", () => {
    const missing = memoryRepo();
    missing.files.delete(DRIZZLE_JOURNAL);
    expect(loadMirrorInput(missing.fs)).toEqual({ error: `Brak ${DRIZZLE_JOURNAL}.` });
    const notJournal = memoryRepo({ [DRIZZLE_JOURNAL]: '{"entries": {}}' });
    const error = loadMirrorInput(notJournal.fs);
    expect("error" in error && error.error).toContain("nie jest dziennikiem drizzle");
    const repo = memoryRepo({ [S("README.md")]: "x", [`${DRIZZLE_META_DIR}/notes.json`]: "{}" });
    const input = loadMirrorInput(repo.fs);
    expect("error" in input).toBe(false);
    if ("error" in input) return;
    expect(input.supabaseSql).toEqual(["20261001000000_a.sql"]);
    expect(input.drizzleSql).toEqual(["0000_a.sql"]);
    expect(input.snapshots).toEqual(["0000_snapshot.json", "notes.json"]);
  });

  it("bez bazy (ani origin/main, ani main): ostrzeżenie i samo dopisywanie", () => {
    const repo = memoryRepo({ [S(B)]: B_SQL });
    run([], repo, BASE);
    repo.files.set(S(B), B_SQL.replace("service_role", "authenticated"));
    const { code, out } = run([], repo, null);
    expect(out).toContain("UWAGA: bez bazy (ani origin/main, ani main) - tylko dopisywanie");
    expect(out).toContain("[zrodlo-rozjechane]");
    expect(code).toBe(1);
  });

  it("baza: log z SHA i datą commitu; nieudane pobranie main to ostrzeżenie o przenumerowaniu cudzych luster", () => {
    const repo = memoryRepo({ [S(B)]: B_SQL });
    const commit = { sha: "c".repeat(40), date: "2026-10-24T22:05:23+00:00" };
    const fetched = run(["--dry-run"], repo, { ...BASE, commit, fetch: "ok" });
    expect(fetched.out).toContain(
      `Baza luster lokalnych: origin/main @ ${"c".repeat(12)} z 2026-10-24T22:05:23+00:00 (wpisy dziennika: 1).`,
    );
    expect(fetched.out).not.toContain("nie udało się pobrać");
    const stale = run(["--dry-run"], repo, { ...BASE, commit, fetch: "failed" });
    expect(stale.out).toContain("UWAGA: nie udało się pobrać origin/main (git fetch)");
    // Jawny refspec: w klonie jednej gałęzi `git fetch origin main` nie odświeża origin/main.
    expect(stale.out).toContain("git fetch origin +refs/heads/main:refs/remotes/origin/main");
    expect(stale.code).toBe(0);
  });

  it("baza niescalona z gałęzią: zapis przechodzi z ostrzeżeniem, bez linii do opisu PR", () => {
    const repo = memoryRepo({ [S(B)]: B_SQL });
    const { code, out } = run([], repo, { ...BASE, merged: false });
    expect(code).toBe(0);
    expect(out).toContain("UWAGA [baza-niescalona]");
    expect(out).not.toContain("Wpisy dziennika do wdrożenia: idx");
    expect(repo.files.has(D("0001_b_fix"))).toBe(true);
  });

  it("--no-base nie pyta gita; nieczytelny jawny --base to błędne wywołanie", () => {
    const repo = memoryRepo({ [S(B)]: B_SQL });
    const noBase = run(["--no-base", "--dry-run"], repo);
    expect(noBase.baseJournal).not.toHaveBeenCalled();
    expect(noBase.out).not.toContain("UWAGA: bez bazy");
    const missing = run(["--base", "upstream/main"], repo, null);
    expect(missing.code).toBe(2);
    expect(missing.out).toBe(`Nie da się odczytać ${DRIZZLE_JOURNAL} z upstream/main (git show).`);
    expect(repo.calls).toEqual([]);
  });

  it("--rewrite przepisuje lustro z bazy i drukuje polecenie sprawdzenia rejestru produkcji", () => {
    const repo = memoryRepo({ [S(B)]: B_SQL });
    run(["--no-base"], repo);
    repo.calls.length = 0;
    const changed = B_SQL.replace("service_role", "authenticated");
    repo.files.set(S(B), changed);
    const journalBefore = repo.files.get(DRIZZLE_JOURNAL);
    const { code, out } = run(["--rewrite", "0001_b_fix"], repo, {
      ref: "origin/main",
      entries: [...BASE.entries, { idx: 1, when: 1_060_000, tag: "0001_b_fix" }],
    });
    expect(code).toBe(0);
    expect(repo.calls).toEqual([`write ${D("0001_b_fix")}`]);
    expect(repo.files.get(D("0001_b_fix"))).toBe(mirrorHeader(B) + changed);
    expect(repo.files.get(DRIZZLE_JOURNAL)).toBe(journalBefore);
    expect(out).toContain(
      "UWAGA --rewrite 0001_b_fix (idx 1): wolno WYŁĄCZNIE dla wpisu, którego produkcja NIE zapisała",
    );
    expect(out).toContain("bun run migrations:deploy-sql -- --verify --from 1 --to 1");
  });

  it("--rewrite wpisu bez nagłówka generatora: kod 1, bez zapisu", () => {
    const repo = memoryRepo();
    const { code, out } = run(["--rewrite", "0000_a"], repo);
    expect(code).toBe(1);
    expect(out).toContain("[przepisanie-niedozwolone]");
    expect(repo.calls).toEqual([]);
  });

  it("błędne wywołanie: kod 2, komunikat i składnia", () => {
    const repo = memoryRepo();
    const { code, out } = run(["--bogus"], repo);
    expect(code).toBe(2);
    expect(out).toBe(`Nieznana opcja --bogus.\n${MIRROR_USAGE}`);
    expect(repo.calls).toEqual([]);
  });
});
