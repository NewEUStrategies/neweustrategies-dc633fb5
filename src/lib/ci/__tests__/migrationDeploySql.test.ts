// @vitest-environment node
//
// Kontrakt `bun run migrations:deploy-sql` (`src/lib/ci/migrationDeploySql.ts`).
//
// Zapytania porównują dziennik z repozytorium z rejestrem migratora na
// produkcji po parze (`when`, sha256 pliku). Jeśli hash liczony tutaj choć raz
// rozjedzie się z tym, który zapisuje drizzle-orm, `--verify` zgłosi „inny hash"
// dla poprawnie wdrożonego wpisu, a `--pending` - „INNY HASH" przed każdym
// wdrożeniem. Dlatego hash jest sprawdzany wobec PRAWDZIWEGO `readMigrationFiles`
// z drizzle-orm, na plikach z dysku, także z polskimi znakami.
//
// Drugi kontrakt: wypisany SQL jest TYLKO DO ODCZYTU - jedno zapytanie, bez
// żadnej instrukcji zmieniającej dane albo schemat.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEPLOY_SQL_USAGE,
  drizzleFileHash,
  journalRows,
  MAX_DEPLOY_ROWS,
  parseDeploySqlArgs,
  pendingAnchor,
  PENDING_ROLE,
  PENDING_STATUS,
  renderDeploySql,
  runDeploySqlCli,
  VERIFY_PROBLEM,
  type DeployJournalRow,
  type JournalLike,
} from "@/lib/ci/migrationDeploySql";
import {
  DEPLOY_TRIGGER_SQL,
  DRIZZLE_DIR,
  readFileOrNull,
  type JournalEntry,
  type ReadFile,
} from "@/lib/ci/migrationLaneParity";

/** `when` wpisu 0398 z prawdziwego dziennika; kolejne wpisy co 60 s jak generator lustra. */
const WHEN_0398 = 1792789886300;
const JOURNAL_PATH = `${DRIZZLE_DIR}/meta/_journal.json`;
/** Prawdziwy dziennik repozytorium (idx == pozycja we wpisach). */
const realJournal = () => JSON.parse(readFileOrNull(JOURNAL_PATH)!) as JournalLike;

const tagOf = (idx: number) => `${String(idx).padStart(4, "0")}_m`;
const whenOf = (idx: number) => WHEN_0398 + (idx - 398) * 60_000;
const entry = (idx: number, tag = tagOf(idx), when = whenOf(idx)): JournalEntry => ({
  idx,
  when,
  tag,
});
const journalOf = (...entries: JournalEntry[]): JournalLike => ({ entries });
const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, k) => entry(from + k));

/** Każdy plik dziennika istnieje i ma treść zależną od tagu. */
const anyFile: ReadFile = (path) => `-- ${path}\nSELECT 1;\n`;
/** Pamięciowy dysk: ścieżka -> treść; reszta nie istnieje. */
const diskOf =
  (files: Record<string, string>): ReadFile =>
  (path) =>
    files[path] ?? null;

const row = (idx: number, hash: string, tag = tagOf(idx), trigger = false): DeployJournalRow => ({
  idx,
  tag,
  when: whenOf(idx),
  hash,
  trigger,
});
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

/** Linie komentarza `--` usunięte: zostaje to, co wykona baza. */
const executable = (sql: string) =>
  sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
const WRITE_KEYWORDS =
  /\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|GRANT|REVOKE|TRUNCATE|COMMENT)\b/i;

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * Katalog migracji na dysku tak, jak czyta go drizzle-orm: dziennik i pliki.
 * Zwraca widok migratora oraz czytnik, który mapuje `drizzle/migrations/` na ten katalog.
 */
function migrationsOnDisk(contents: readonly string[]) {
  const dir = mkdtempSync(join(tmpdir(), "deploy-sql-"));
  tempDirs.push(dir);
  mkdirSync(join(dir, "meta"));
  const entries = contents.map((_, idx) => ({
    idx,
    version: "7",
    when: whenOf(idx),
    tag: tagOf(idx),
    breakpoints: true,
  }));
  writeFileSync(
    join(dir, "meta", "_journal.json"),
    JSON.stringify({ version: "7", dialect: "postgresql", entries }),
  );
  contents.forEach((content, idx) => writeFileSync(join(dir, `${tagOf(idx)}.sql`), content));
  const read: ReadFile = (path) => readFileOrNull(path.replace(`${DRIZZLE_DIR}/`, `${dir}/`));
  return { journal: { entries }, read, migrator: readMigrationFiles({ migrationsFolder: dir }) };
}

describe("drizzleFileHash - ten sam skrót co migrator drizzle-orm", () => {
  const ascii = "ALTER TABLE public.t ADD COLUMN IF NOT EXISTS c int;\n";
  const polish =
    "-- Uzupełnia kolumnę; zażółć gęślą jaźń\nCOMMENT ON TABLE public.t IS 'Tabela źródłowa: łączy wpisy';\n";

  it("polska treść naprawdę zawiera znaki spoza ASCII (inaczej test niczego nie dowodzi)", () => {
    expect(Buffer.byteLength(polish, "utf8")).toBeGreaterThan(polish.length);
  });

  it.each([
    ["ASCII", ascii],
    ["polskie znaki w UTF-8", polish],
    ["dwie instrukcje z `--> statement-breakpoint`", `${ascii}--> statement-breakpoint\n${ascii}`],
  ])("%s: hash równy `readMigrationFiles(...).hash`", (_label, content) => {
    const { migrator } = migrationsOnDisk([content]);
    expect(drizzleFileHash(content)).toBe(migrator[0]!.hash);
  });

  it("journalRows daje dokładnie pary (folderMillis, hash) migratora dla każdego wpisu", () => {
    const { journal, read, migrator } = migrationsOnDisk([ascii, polish, `${polish}${ascii}`]);
    expect(journalRows(journal, read, 0).map((r) => [r.when, r.hash])).toEqual(
      migrator.map((m) => [m.folderMillis, m.hash]),
    );
  });

  it("REALNY dziennik: ostatnie wpisy mają hash i `when` takie jak u migratora", () => {
    const journal = realJournal();
    const migrator = readMigrationFiles({ migrationsFolder: DRIZZLE_DIR });
    const last = journal.entries.length - 1;
    const from = Math.max(0, last - 49);
    const rows = journalRows(journal, readFileOrNull, from);
    expect(rows.map((r) => r.idx)).toEqual(range(from, last).map((e) => e.idx));
    expect(rows.map((r) => [r.when, r.hash])).toEqual(
      migrator.slice(from).map((m) => [m.folderMillis, m.hash]),
    );
  });
});

describe("journalRows - zakres wpisów", () => {
  const journal = journalOf(...range(396, 401));

  it("bez `to` bierze wpisy od `from` do ostatniego, w kolejności dziennika", () => {
    expect(journalRows(journal, anyFile, 399).map((r) => r.tag)).toEqual([
      "0399_m",
      "0400_m",
      "0401_m",
    ]);
  });

  it("jawny zakres [from, to] obejmuje oba końce; pojedynczy wpis też jest zakresem", () => {
    expect(journalRows(journal, anyFile, 397, 398).map((r) => r.idx)).toEqual([397, 398]);
    expect(journalRows(journal, anyFile, 401, 401).map((r) => r.idx)).toEqual([401]);
  });

  it("wiersz niesie idx, tag, `when` z dziennika i hash treści pliku", () => {
    const content = "SELECT 1;\n";
    const read = diskOf({ [`${DRIZZLE_DIR}/0400_m.sql`]: content });
    expect(journalRows(journalOf(entry(400)), read, 400)).toEqual([
      {
        idx: 400,
        tag: "0400_m",
        when: whenOf(400),
        hash: drizzleFileHash(content),
        trigger: false,
      },
    ]);
  });

  it("kanoniczny wyzwalacz wdrożenia jest oznaczony (te same bajty w każdym wdrożeniu)", () => {
    const tag = "0400_pr540_deployment_completion";
    const read = diskOf({
      [`${DRIZZLE_DIR}/${tag}.sql`]: DEPLOY_TRIGGER_SQL,
      [`${DRIZZLE_DIR}/0401_m.sql`]: DEPLOY_TRIGGER_SQL,
    });
    expect(
      journalRows(journalOf(entry(400, tag), entry(401)), read, 400).map((r) => r.trigger),
    ).toEqual([true, false]);
  });

  it("kotwica --pending to wpis tuż przed `from`; dla `from` = 0 jej nie ma", () => {
    expect(pendingAnchor(journal, anyFile, 399)).toEqual(
      journalRows(journal, anyFile, 398, 398)[0],
    );
    expect(pendingAnchor(journalOf(...range(0, 2)), anyFile, 0)).toBeNull();
    expect(() => pendingAnchor(journal, diskOf({}), 399)).toThrow("brak pliku 0398_m.sql");
  });

  it.each([
    ["`from` większe od `to`", 399, 398],
    ["`to` za ostatnim wpisem", 399, 402],
    ["`from` za ostatnim wpisem (domyślne `to`)", 402, undefined],
    ["ujemne `from`", -1, undefined],
    ["niecałkowite `from`", 399.5, undefined],
    ["niecałkowite `to`", 399, 400.5],
  ])("zły zakres: %s", (_label, from, to) => {
    expect(() => journalRows(journal, anyFile, from, to)).toThrow(/poza dziennikiem/);
  });

  it("pusty dziennik nie daje zapytania", () => {
    expect(() => journalRows(journalOf(), anyFile, 0)).toThrow("dziennik nie ma wpisów");
  });

  it("zakres w luce numeracji nie daje zapytania", () => {
    expect(() => journalRows(journalOf(entry(0), entry(5)), anyFile, 1, 4)).toThrow(
      "brak wpisów dziennika w zakresie 1-4",
    );
  });

  it(`najwyżej ${MAX_DEPLOY_ROWS} wpisów w jednym zapytaniu`, () => {
    const long = journalOf(...range(0, MAX_DEPLOY_ROWS));
    expect(journalRows(long, anyFile, 1)).toHaveLength(MAX_DEPLOY_ROWS);
    expect(() => journalRows(long, anyFile, 0)).toThrow(/zawęź go przez --from\/--to/);
  });

  it("brak pliku wpisu rzuca z nazwą pliku", () => {
    const read = diskOf({ [`${DRIZZLE_DIR}/0399_m.sql`]: "SELECT 1;" });
    expect(() => journalRows(journalOf(entry(399), entry(400)), read, 399)).toThrow(
      "brak pliku 0400_m.sql",
    );
  });

  it.each(["../meta/_journal", "0400_Wielkie", "0400_x'y", "400_m", "0400_m.sql"])(
    "tag spoza wzorca %j rzuca, zanim cokolwiek zostanie przeczytane",
    (tag) => {
      const paths: string[] = [];
      const read: ReadFile = (path) => {
        paths.push(path);
        return "SELECT 1;";
      };
      expect(() => journalRows(journalOf(entry(400, tag)), read, 400)).toThrow(/spoza wzorca/);
      expect(paths).toEqual([]);
    },
  );

  it.each([
    ["ułamkowe", 1792789946300.5],
    ["ujemne", -1],
    ["poza bezpiecznym zakresem liczb całkowitych", Number.MAX_SAFE_INTEGER + 2],
  ])("`when` %s rzuca", (_label, when) => {
    expect(() => journalRows(journalOf(entry(400, "0400_m", when)), anyFile, 400)).toThrow(
      /when .* nie jest liczbą całkowitą/,
    );
  });
});

describe("renderDeploySql - szablony", () => {
  const rows = [row(399, HASH_A), row(400, HASH_B)];
  const values = [
    "  (399, '0399_m', 1792789946300::bigint, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),",
    "  (400, '0400_m', 1792790006300::bigint, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')",
  ];

  it("pending: dokładny tekst zapytania - kotwica (wpis przed zakresem), wyzwalacz bez statusu ponownej dostawy", () => {
    const anchor = row(398, HASH_C, "0398_pr533_deployment_completion", true);
    expect(renderDeploySql("pending", rows, "afbff7cd0", anchor)).toBe(
      [
        "-- migrations:deploy-sql --pending (HEAD afbff7cd0, wpisy 399-400, kotwica 398)",
        "-- TYLKO ODCZYT. Pokazuje, co zrobi najblizsze uruchomienie migratora Drizzle.",
        "-- Wiersz 'kotwica' (wpis tuz przed zakresem) ma miec 'juz zastosowany' - inaczej migrator wykona tez wpisy sprzed zakresu.",
        "WITH j(idx, tag, created_at, hash, rola, wyzwalacz) AS (VALUES",
        "  (398, '0398_pr533_deployment_completion', 1792789886300::bigint, 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', 'kotwica', true),",
        "  (399, '0399_m', 1792789946300::bigint, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'zakres', false),",
        "  (400, '0400_m', 1792790006300::bigint, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'zakres', false)",
        "), r AS (",
        "  SELECT COALESCE(max(created_at), 0)::bigint AS last_applied FROM drizzle.__drizzle_migrations",
        ")",
        "SELECT j.idx, j.tag, j.rola,",
        "  CASE",
        "    WHEN EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations d WHERE d.created_at = j.created_at AND d.hash = j.hash) THEN 'juz zastosowany'",
        "    WHEN EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations d WHERE d.created_at = j.created_at) THEN 'INNY HASH W REJESTRZE'",
        "    WHEN j.created_at <= r.last_applied THEN 'POMINIETY: when nie wiekszy od ostatniego zapisu'",
        "    WHEN NOT j.wyzwalacz AND EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations d WHERE d.hash = j.hash) THEN 'PONOWNA DOSTAWA: ten sam plik juz w rejestrze'",
        "    ELSE 'zostanie wykonany'",
        "  END AS status",
        "FROM j CROSS JOIN r",
        "ORDER BY j.idx;",
      ].join("\n"),
    );
  });

  it("pending bez kotwicy (zakres od wpisu 0): same wiersze zakresu, nagłówek bez kotwicy", () => {
    const sql = renderDeploySql("pending", rows, "x");
    expect(sql.split("\n")[0]).toBe("-- migrations:deploy-sql --pending (HEAD x, wpisy 399-400)");
    expect(sql).not.toContain("'kotwica', ");
    expect(() => renderDeploySql("verify", rows, "x", row(398, HASH_C))).toThrow(
      "kotwica dotyczy wyłącznie --pending",
    );
  });

  it("verify: dokładny tekst zapytania (pusty wynik = OK)", () => {
    expect(renderDeploySql("verify", rows, "afbff7cd0")).toBe(
      [
        "-- migrations:deploy-sql --verify (HEAD afbff7cd0, wpisy 399-400)",
        "-- TYLKO ODCZYT. PUSTY wynik = kazdy wpis zakresu zapisany przez migrator z hashem pliku z repozytorium.",
        "WITH j(idx, tag, created_at, hash) AS (VALUES",
        ...values,
        ")",
        "SELECT j.idx, j.tag,",
        "  CASE WHEN EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations d WHERE d.created_at = j.created_at)",
        "       THEN 'inny hash' ELSE 'brak w rejestrze' END AS problem",
        "FROM j",
        "WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations d WHERE d.created_at = j.created_at AND d.hash = j.hash)",
        "ORDER BY j.idx;",
      ].join("\n"),
    );
  });

  it("statusy to dokładnie teksty cytowane przez runbook i wiedzę projektu (ASCII)", () => {
    expect(PENDING_STATUS).toEqual({
      applied: "juz zastosowany",
      hashMismatch: "INNY HASH W REJESTRZE",
      skipped: "POMINIETY: when nie wiekszy od ostatniego zapisu",
      redelivered: "PONOWNA DOSTAWA: ten sam plik juz w rejestrze",
      willRun: "zostanie wykonany",
    });
    expect(PENDING_ROLE).toEqual({ anchor: "kotwica", range: "zakres" });
    expect(VERIFY_PROBLEM).toEqual({ hashMismatch: "inny hash", missing: "brak w rejestrze" });
    for (const text of [...Object.values(PENDING_STATUS), ...Object.values(VERIFY_PROBLEM)]) {
      expect(text).toMatch(/^[\x20-\x7e]+$/);
    }
  });

  it("wiersze VALUES w kolejności dziennika, każdy `when` jako literał ::bigint", () => {
    const sql = renderDeploySql(
      "verify",
      [row(397, HASH_A), row(398, HASH_B), row(399, HASH_C)],
      "x",
    );
    const lines = sql.split("\n").filter((line) => line.startsWith("  ("));
    expect(lines.map((line) => line.match(/^ {2}\((\d+), /)![1])).toEqual(["397", "398", "399"]);
    for (const line of lines) expect(line).toMatch(/, \d+::bigint, '[0-9a-f]{64}'\)/);
    expect(sql.split("\n")[0]).toBe("-- migrations:deploy-sql --verify (HEAD x, wpisy 397-399)");
  });

  it("brak wierszy rzuca (VALUES bez wierszy to błąd składni)", () => {
    expect(() => renderDeploySql("pending", [], "x")).toThrow("brak wpisów do zapytania");
  });

  it.each(["abc\nDROP TABLE x;", "", "a b", "a".repeat(65)])(
    "HEAD %j spoza wzorca rzuca (nie wychodzi z komentarza nagłówka)",
    (head) => {
      expect(() => renderDeploySql("pending", rows, head)).toThrow(/HEAD .* spoza wzorca/);
    },
  );

  it.each<[string, DeployJournalRow, RegExp]>([
    ["tag z apostrofem", row(400, HASH_A, "0400_x'); DROP TABLE t; --"), /spoza wzorca/],
    ["hash nie-hex", row(400, "Z".repeat(64)), /hash nie jest sha256 hex/],
    ["hash za krótki", row(400, "a".repeat(63)), /hash nie jest sha256 hex/],
    ["ułamkowy idx", { ...row(400, HASH_A), idx: 400.5 }, /idx .* nie jest liczbą całkowitą/],
    ["ułamkowy when", { ...row(400, HASH_A), when: 1.5 }, /when .* nie jest liczbą całkowitą/],
  ])("wiersz trafia do SQL-a bez cytowania, więc %s rzuca", (_label, bad, error) => {
    expect(() => renderDeploySql("verify", [bad], "x")).toThrow(error);
  });
});

describe("wypisany SQL jest TYLKO DO ODCZYTU", () => {
  const cases: readonly (readonly [string, () => DeployJournalRow[]])[] = [
    ["syntetyczne wiersze", () => [row(399, HASH_A), row(400, HASH_B)]],
    [
      "ostatnie 200 wpisów realnego dziennika",
      () => {
        const journal = realJournal();
        return journalRows(journal, readFileOrNull, Math.max(0, journal.entries.length - 200));
      },
    ],
  ];

  for (const [label, rowsOf] of cases) {
    for (const mode of ["pending", "verify"] as const) {
      it(`${mode}, ${label}: bez instrukcji zapisu, jedno zapytanie zakończone średnikiem`, () => {
        const [anchor, ...range] = rowsOf();
        const sql = executable(
          mode === "pending"
            ? renderDeploySql(mode, range, "afbff7cd0", anchor!)
            : renderDeploySql(mode, [anchor!, ...range], "afbff7cd0"),
        );
        expect(sql).not.toMatch(WRITE_KEYWORDS);
        expect(sql.trimEnd().endsWith(";")).toBe(true);
        expect(sql.split(";")).toHaveLength(2);
        expect(sql.trimStart()).toMatch(
          mode === "pending"
            ? /^WITH j\(idx, tag, created_at, hash, rola, wyzwalacz\) AS \(VALUES/
            : /^WITH j\(idx, tag, created_at, hash\) AS \(VALUES/,
        );
      });
    }
  }

  it("strażnik naprawdę łapie zapis (kontrola testu)", () => {
    expect("INSERT INTO drizzle.__drizzle_migrations VALUES (1)").toMatch(WRITE_KEYWORDS);
    expect("comment on schema public is 'x'").toMatch(WRITE_KEYWORDS);
    expect(executable("-- DROP TABLE t\nSELECT 1;")).not.toMatch(WRITE_KEYWORDS);
  });
});

describe("parseDeploySqlArgs - wywołanie", () => {
  const ONE_MODE = "Podaj dokladnie jeden tryb: --pending albo --verify.";
  const needsIdx = (flag: string) =>
    `${flag} wymaga numeru wpisu dziennika (liczba calkowita >= 0).`;

  it.each<[string[], ReturnType<typeof parseDeploySqlArgs>]>([
    [["--pending", "--from", "399"], { mode: "pending", from: 399 }],
    [["--verify", "--from", "399", "--to", "402"], { mode: "verify", from: 399, to: 402 }],
    [["--from", "0", "--to", "0", "--verify"], { mode: "verify", from: 0, to: 0 }],
  ])("%j", (argv, expected) => {
    expect(parseDeploySqlArgs(argv)).toEqual(expected);
  });

  it.each<[string, string[], string]>([
    ["bez trybu", ["--from", "399"], ONE_MODE],
    ["bez argumentów", [], ONE_MODE],
    ["oba tryby", ["--pending", "--verify", "--from", "399"], ONE_MODE],
    ["tryb dwa razy", ["--pending", "--pending", "--from", "399"], ONE_MODE],
    ["bez --from", ["--pending"], "Brak --from <idx>."],
    ["bez --from, z --to", ["--verify", "--to", "400"], "Brak --from <idx>."],
    ["--from bez wartości", ["--pending", "--from"], needsIdx("--from")],
    ["--from zjada następną opcję", ["--pending", "--from", "--to", "400"], needsIdx("--from")],
    ["--from nieliczbowe", ["--pending", "--from", "abc"], needsIdx("--from")],
    ["--from ułamkowe", ["--pending", "--from", "399.5"], needsIdx("--from")],
    ["--from ujemne", ["--pending", "--from", "-1"], needsIdx("--from")],
    ["--from wykładnicze", ["--pending", "--from", "4e2"], needsIdx("--from")],
    ["--from puste", ["--pending", "--from", ""], needsIdx("--from")],
    ["--from za duże", ["--pending", "--from", "99999999999999999999"], needsIdx("--from")],
    ["--to nieliczbowe", ["--pending", "--from", "399", "--to", "x"], needsIdx("--to")],
    ["--from dwa razy", ["--pending", "--from", "399", "--from", "400"], "--from podano dwa razy."],
    [
      "--to dwa razy",
      ["--verify", "--from", "1", "--to", "2", "--to", "3"],
      "--to podano dwa razy.",
    ],
    ["--from=399", ["--pending", "--from=399"], "Nieznany argument --from=399."],
    [
      "tryb zapisu --ledger nie istnieje",
      ["--ledger", "--from", "399"],
      "Nieznany argument --ledger.",
    ],
    ["argument pozycyjny", ["--pending", "--from", "399", "0400_m"], "Nieznany argument 0400_m."],
  ])("błąd (kod 2): %s", (_label, argv, error) => {
    expect(parseDeploySqlArgs(argv)).toEqual({ error });
  });
});

describe("runDeploySqlCli - kody wyjścia", () => {
  const journalJson = JSON.stringify({ version: "7", entries: [entry(399), entry(400)] });
  const files = {
    [JOURNAL_PATH]: journalJson,
    [`${DRIZZLE_DIR}/0399_m.sql`]: "SELECT 1;\n",
    [`${DRIZZLE_DIR}/0400_m.sql`]: "SELECT 2;\n",
  };

  function run(argv: string[], disk: Record<string, string> = files, head = "afbff7cd0") {
    const out: string[] = [];
    const err: string[] = [];
    const code = runDeploySqlCli(argv, {
      read: diskOf(disk),
      head: () => head,
      out: (text) => out.push(text),
      err: (text) => err.push(text),
    });
    return { code, out, err };
  }

  it("0: SQL na stdout, nic na stderr; ten sam zakres w obu trybach daje te same wiersze", () => {
    const pending = run(["--pending", "--from", "399"]);
    const verify = run(["--verify", "--from", "399", "--to", "400"]);
    expect([pending.code, pending.err, verify.code, verify.err]).toEqual([0, [], 0, []]);
    const rows = journalRows(journalOf(entry(399), entry(400)), diskOf(files), 399);
    expect(pending.out).toEqual([renderDeploySql("pending", rows, "afbff7cd0")]);
    expect(verify.out).toEqual([renderDeploySql("verify", rows, "afbff7cd0")]);
  });

  it("0: --pending dokłada kotwicę (wpis --from - 1), --verify jej nie ma", () => {
    const anchored = run(["--pending", "--from", "400"]);
    expect(anchored.code).toBe(0);
    const journal = journalOf(entry(399), entry(400));
    expect(anchored.out).toEqual([
      renderDeploySql(
        "pending",
        journalRows(journal, diskOf(files), 400),
        "afbff7cd0",
        pendingAnchor(journal, diskOf(files), 400),
      ),
    ]);
    expect(anchored.out[0]).toContain("(399, '0399_m', ");
    expect(anchored.out[0]).toContain("'kotwica', false)");
    expect(run(["--verify", "--from", "400"]).out[0]).not.toContain("0399_m");
  });

  it("2: złe wywołanie drukuje powód i sposób użycia, bez SQL-a", () => {
    const result = run(["--pending"]);
    expect(result).toEqual({ code: 2, out: [], err: [`Brak --from <idx>.\n${DEPLOY_SQL_USAGE}`] });
  });

  it.each<[string, string[], Record<string, string>, string]>([
    ["zły zakres", ["--verify", "--from", "401"], files, "zakres 401-400 poza dziennikiem"],
    [
      "brak pliku wpisu",
      ["--pending", "--from", "399"],
      { [JOURNAL_PATH]: journalJson, [`${DRIZZLE_DIR}/0399_m.sql`]: "SELECT 1;\n" },
      "brak pliku 0400_m.sql",
    ],
    ["brak dziennika", ["--pending", "--from", "399"], {}, `brak pliku ${JOURNAL_PATH}`],
    [
      "dziennik nie jest JSON-em",
      ["--pending", "--from", "399"],
      { ...files, [JOURNAL_PATH]: "<<<<<<< HEAD" },
      `${JOURNAL_PATH} nie ma kształtu`,
    ],
    [
      "dziennik bez tablicy wpisów",
      ["--pending", "--from", "399"],
      { ...files, [JOURNAL_PATH]: JSON.stringify({ entries: [{ idx: "399" }] }) },
      `${JOURNAL_PATH} nie ma kształtu`,
    ],
  ])("1: %s", (_label, argv, disk, message) => {
    const result = run(argv, disk);
    expect(result.code).toBe(1);
    expect(result.out).toEqual([]);
    expect(result.err).toHaveLength(1);
    expect(result.err[0]).toContain(`migrations:deploy-sql: ${message}`);
  });

  it("1: HEAD, który wyszedłby z komentarza nagłówka", () => {
    expect(run(["--pending", "--from", "399"], files, "x\ny").code).toBe(1);
  });
});
