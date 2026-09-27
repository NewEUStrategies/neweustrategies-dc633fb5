// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW
//
// CLI jest jedynym miejscem, gdzie plan dotyka dysku. Bez tych testow
// `--dry-run` moglby cos zapisac, odmowa planu (kolizja wersji, lekser)
// konczylaby sie zielonym kodem wyjscia albo stack trace'em, a blizniak drizzle
// bylby dobierany zle, gdy rejestr wskazuje kilka plikow (para 0003/0004).
// System plikow jest w pamieci - test nie rusza repozytorium.
import { describe, expect, it } from "vitest";
import type { LaneEntry } from "../migrationLaneParity";
import { SPLIT_USAGE, parseSplitArgs, runSplitCli, type CliFs } from "../migrationSplitCli";

const FILE = "20260101000000_event_x.sql";
const stmt = (name: string, bytes: number): string => {
  const head = `SELECT '${name}`;
  return `${head}${"x".repeat(Math.max(0, bytes - head.length - 3))}';\n`;
};
const SQL = `CREATE FUNCTION public.event_x() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;\n${stmt("a", 1500)}${stmt("b", 1500)}${stmt("c", 1500)}`;
const REGISTRY = `export const MIGRATION_LANES = [\n  {\n    tag: "0000_event_x",\n    twin: "${FILE}",\n  },\n];\n`;

function repo(extra: Record<string, string | undefined> = {}) {
  const files: Record<string, string | undefined> = {
    [`supabase/migrations/${FILE}`]: SQL,
    "supabase/migrations/20250101000000_prev.sql": "SELECT 0;\n",
    "drizzle/migrations/0000_event_x.sql": SQL,
    "drizzle/migrations/meta/_journal.json": JSON.stringify({
      version: "7",
      dialect: "postgresql",
      entries: [{ idx: 0, version: "7", when: 1, tag: "0000_event_x", breakpoints: true }],
    }),
    "drizzle/migrations/meta/0000_snapshot.json": JSON.stringify({ id: "s0", prevId: "p" }),
    "src/lib/ci/migrationLaneParity.ts": REGISTRY,
    "src/lib/events/__tests__/x.test.ts": `readFileSync("supabase/migrations/${FILE}")`,
    "src/lib/events/__tests__/notes.md": `supabase/migrations/${FILE}`,
    "supabase/tests/x_test.sql": "SELECT 1;",
    "src/znikniety.test.ts": undefined,
    ...extra,
  };
  const writes: string[] = [];
  const log: string[] = [];
  const fs: CliFs = {
    read: (path) => files[path] ?? null,
    write: (path, content) => {
      writes.push(path);
      files[path] = content;
    },
    list: (dir) =>
      Object.keys(files)
        .filter(
          (p) =>
            files[p] !== undefined &&
            p.startsWith(`${dir}/`) &&
            !p.slice(dir.length + 1).includes("/"),
        )
        .map((p) => p.slice(dir.length + 1)),
    // Bez filtra `undefined`: plik znikajacy miedzy listowaniem a odczytem.
    walk: (dir) => Object.keys(files).filter((p) => p.startsWith(`${dir}/`)),
  };
  let n = 0;
  const run = (argv: string[], lanes: LaneEntry[] = [{ tag: "0000_event_x", twin: FILE }]) =>
    runSplitCli(argv, { fs, log: (line) => log.push(line), newId: () => `id-${(n += 1)}`, lanes });
  return { files, writes, log, run };
}

describe("parseSplitArgs", () => {
  it("czyta plik (sciezke albo nazwe) i opcje", () => {
    expect(
      parseSplitArgs([`supabase/migrations/${FILE}`, "--dry-run", "--allow-interleave"]),
    ).toEqual({
      file: FILE,
      dryRun: true,
      allowInterleave: true,
      maxBytes: undefined,
      drizzleTag: undefined,
    });
    expect(
      parseSplitArgs([FILE, "--max-kb", "2.5", "--drizzle", "drizzle/migrations/0000_x.sql"]),
    ).toMatchObject({
      maxBytes: 2560,
      drizzleTag: "0000_x",
    });
  });

  it("odrzuca bledne uzycie", () => {
    expect(parseSplitArgs([])).toEqual({ error: "Podaj dokladnie jeden plik migracji supabase." });
    expect(parseSplitArgs(["a.sql", "b.sql"])).toHaveProperty("error");
    expect(parseSplitArgs([FILE, "--max-kb", "zero"])).toEqual({
      error: "--max-kb wymaga liczby > 0.",
    });
    expect(parseSplitArgs([FILE, "--max-kb", "-1"])).toHaveProperty("error");
    expect(parseSplitArgs([FILE, "--drizzle"])).toEqual({ error: "--drizzle wymaga tagu." });
    expect(parseSplitArgs([FILE, "--drizzle", "--dry-run"])).toHaveProperty("error");
    expect(parseSplitArgs([FILE, "--cos"])).toEqual({ error: "Nieznana opcja --cos." });
  });
});

describe("runSplitCli", () => {
  it("bledne uzycie i brak pliku: kod 2 z instrukcja", () => {
    const r = repo();
    expect(r.run([])).toBe(2);
    expect(r.log).toContain(SPLIT_USAGE);
    expect(r.run(["20260101000009_brak.sql"])).toBe(2);
    expect(r.log.at(-1)).toBe("Brak pliku supabase/migrations/20260101000009_brak.sql.");
  });

  it("--dry-run pokazuje plan i nic nie zapisuje", () => {
    const r = repo();
    expect(r.run([FILE, "--dry-run", "--max-kb", "2.9"])).toBe(0);
    expect(r.writes).toEqual([]);
    const out = r.log.join("\n");
    expect(out).toMatch(/: 3 czesci\./);
    expect(out).toContain("Wpisy MIGRATION_LANES dopisane w src/lib/ci/migrationLaneParity.ts:");
    expect(out).toContain(
      '  { tag: "0001_event_x_part2", twin: "20260101000001_event_x_part2.sql" },',
    );
    expect(out).toContain(
      "UWAGA: src/lib/events/__tests__/x.test.ts wskazuje te migracje po nazwie",
    );
    expect(out).not.toContain("notes.md");
    expect(out).toMatch(/--dry-run: nic nie zapisano \(10 plikow w planie\)\./);
  });

  it("bez --dry-run zapisuje czesci obu pasow, dziennik, snapshoty i rejestr", () => {
    const r = repo();
    expect(r.run([FILE, "--max-kb", "2.9"])).toBe(0);
    expect(r.writes).toContain("supabase/migrations/20260101000002_event_x_part3.sql");
    expect(r.writes).toContain("drizzle/migrations/meta/0002_snapshot.json");
    expect(r.files["src/lib/ci/migrationLaneParity.ts"]).toContain('tag: "0002_event_x_part3"');
    expect(r.log.join("\n")).toMatch(/Zapisano 10 plikow\./);
    expect(r.log.at(-1)).toBe(
      `Dowod na PostgreSQL (oryginal z HEAD vs czesci): bash scripts/split-migration-proof.sh supabase/migrations/${FILE}`,
    );
  });

  it("rejestr, ktorego nie da sie edytowac mechanicznie: wpisy do dopisania recznie", () => {
    const r = repo({ "src/lib/ci/migrationLaneParity.ts": undefined });
    expect(r.run([FILE, "--dry-run", "--max-kb", "2.9"])).toBe(0);
    expect(r.log.join("\n")).toContain("Wpisy MIGRATION_LANES do dopisania RECZNIE");
  });

  it("plik w limicie: kod 0 bez zapisow; bez blizniaka dzieli tylko pas supabase", () => {
    const r = repo();
    expect(r.run([FILE])).toBe(0);
    expect(r.writes).toEqual([]);
    expect(r.log.join("\n")).toContain("miesci sie w limicie");
    const solo = repo();
    expect(solo.run([FILE, "--max-kb", "2.9"], [])).toBe(0);
    expect(solo.writes.every((p) => p.startsWith("supabase/"))).toBe(true);
  });

  it("jawny --drizzle wybiera blizniaka, gdy rejestr wskazuje kilka; bez niego - odmowa", () => {
    const lanes: LaneEntry[] = [
      { tag: "0000_event_x", twin: FILE },
      { tag: "0001_event_x", twin: FILE },
      { tag: "0002_inny", drizzleOnly: "powod" },
    ];
    const r = repo();
    expect(r.run([FILE, "--max-kb", "2.9", "--dry-run"], lanes)).toBe(1);
    expect(r.log.at(-1)).toMatch(
      /ODMOWA: Kilka plikow drizzle wskazuje .*0000_event_x, 0001_event_x/,
    );
    expect(r.run([FILE, "--max-kb", "2.9", "--dry-run", "--drizzle", "0000_event_x"], lanes)).toBe(
      0,
    );
  });

  it("brak pliku blizniaka, dziennika albo snapshotu: odmowa z kodem 1", () => {
    for (const missing of [
      "drizzle/migrations/0000_event_x.sql",
      "drizzle/migrations/meta/_journal.json",
    ]) {
      const r = repo({ [missing]: undefined });
      expect(r.run([FILE, "--max-kb", "2.9"]), missing).toBe(1);
      expect(r.log.at(-1)).toBe(`ODMOWA: Brak pliku ${missing}.`);
    }
    const noSnapshot = repo({ "drizzle/migrations/meta/0000_snapshot.json": undefined });
    expect(noSnapshot.run([FILE, "--max-kb", "2.9"])).toBe(1);
    expect(noSnapshot.log.at(-1)).toMatch(
      /^ODMOWA: Brak drizzle\/migrations\/meta\/0000_snapshot\.json - lancuch prevId/,
    );
    expect(noSnapshot.writes).toEqual([]);
  });

  it("blizniak poza dziennikiem: snapshot niepotrzebny, czesci z numerem blizniaka", () => {
    const r = repo({
      "drizzle/migrations/meta/_journal.json": JSON.stringify({
        version: "7",
        dialect: "postgresql",
        entries: [{ idx: 0, version: "7", when: 1, tag: "0000_inny", breakpoints: true }],
      }),
      "drizzle/migrations/meta/0000_snapshot.json": undefined,
    });
    expect(r.run([FILE, "--max-kb", "2.9"])).toBe(0);
    expect(r.writes).toContain("drizzle/migrations/0000_event_x_part3.sql");
    expect(r.writes.some((p) => p.includes("/meta/"))).toBe(false);
    expect(r.log.join("\n")).toContain("nie ma wpisu w drizzle/migrations/meta/_journal.json");
  });

  it("istniejacy plik czesci (np. po poprzednim podziale) to odmowa, a nie nadpisanie", () => {
    const r = repo({ "drizzle/migrations/0001_event_x_part2.sql": "SELECT 'cudzy';\n" });
    expect(r.run([FILE, "--max-kb", "2.9"])).toBe(1);
    expect(r.log.at(-1)).toMatch(
      /^ODMOWA: Plan nadpisalby istniejace pliki: drizzle\/migrations\/0001_event_x_part2\.sql\./,
    );
    expect(r.writes).toEqual([]);
    expect(r.files["drizzle/migrations/0001_event_x_part2.sql"]).toBe("SELECT 'cudzy';\n");
  });

  it("odmowa planu i blad leksera: kod 1, nic nie zapisane", () => {
    const collision = repo({ "supabase/migrations/20260101000001_sasiad.sql": "SELECT 1;\n" });
    expect(collision.run([FILE, "--max-kb", "2.9"])).toBe(1);
    expect(collision.log.at(-1)).toMatch(/ODMOWA: Czesci potrzebuja wersji/);
    const broken = repo({ [`supabase/migrations/${FILE}`]: `${SQL}SELECT 'niezamkniety;\n` });
    expect(broken.run([FILE, "--max-kb", "2.9"], [])).toBe(1);
    expect(broken.log.at(-1)).toMatch(/ODMOWA: Niezamkniety literal/);
    expect(collision.writes).toEqual([]);
    expect(broken.writes).toEqual([]);
  });

  it("nieoczekiwany blad (np. uszkodzony dziennik) nie jest polykany", () => {
    const r = repo({ "drizzle/migrations/meta/_journal.json": "{ uszkodzony" });
    expect(() => r.run([FILE, "--max-kb", "2.9"])).toThrow(SyntaxError);
  });
});
