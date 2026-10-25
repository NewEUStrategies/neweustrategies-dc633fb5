// Pomocnik wdrożenia `bun run migrations:deploy-sql`: wypisuje SQL TYLKO DO
// ODCZYTU, który właściciel albo agent Lovable wykonuje w edytorze SQL (albo
// narzędziem odczytu `supabase--read_query`) przed i po wywołaniu narzędzia
// migracji. Procedura: `docs/RUNBOOK_MIGRACJE_LOVABLE.md`.
//
// PO CO. Produkcja wykonuje wyłącznie dziennik drizzle
// (`drizzle/migrations/meta/_journal.json`), a jedynym dowodem wykonania jest
// rejestr migratora `drizzle.__drizzle_migrations`. Migrator drizzle-orm 0.45.2
// (`pg-core/dialect.js`, `migrate()`) czyta z rejestru tylko wiersz o
// największym `created_at`, w JEDNEJ transakcji wykonuje każdy wpis dziennika
// o `when` większym od niego i zapisuje parę (sha256 tekstu pliku, `when`).
// Wpis o `when` nie większym od ostatniego zapisu pomija PO CICHU, a hasha
// zapisanego wiersza nigdy z niczym nie porównuje. Obie te luki widać tylko
// przez porównanie dziennika z repozytorium z rejestrem produkcji - i to robią
// te zapytania:
// - `pending` (PRZED wdrożeniem): status każdego wpisu zakresu wobec rejestru
//   (PENDING_STATUS); jedyny sposób, żeby cichy pominięty wpis zobaczyć z góry;
// - `verify` (PO wdrożeniu): PUSTY wynik = każdy wpis zakresu zapisany przez
//   migrator z hashem pliku z repozytorium; inaczej VERIFY_PROBLEM.
//
// Statusy są w ASCII celowo i dosłownie takie, jak cytują je runbook i wiedza
// projektu Lovable: zmiana tekstu tutaj wymaga tej samej zmiany tam.
//
// NIGDY NIE PISZE. Pomocnik nie łączy się z bazą, a wypisany SQL to jedno
// zapytanie SELECT; test pilnuje, że nie ma w nim żadnej instrukcji zmieniającej
// dane albo schemat. Rejestru migratora ani `supabase_migrations.schema_migrations`
// nikt nie wypełnia ręcznie, więc trybu zapisu tu nie ma.
import { createHash } from "node:crypto";
import { DRIZZLE_DIR, type JournalEntry, type ReadFile } from "./migrationLaneParity";

const JOURNAL_PATH = `${DRIZZLE_DIR}/meta/_journal.json`;

/**
 * Najwięcej wpisów w jednym zapytaniu (400 wierszy to około 56 KB SQL-a): zapytanie
 * trzeba wkleić do edytora SQL albo przekazać narzędziu czatu, więc zakres ma być
 * wdrożeniem, a nie historią dziennika.
 */
export const MAX_DEPLOY_ROWS = 400;

/** Tag wpisu dziennika: trafia do ścieżki pliku i do literału SQL, więc bez wyjątków. */
const TAG_RE = /^\d{4}_[a-z0-9_]+$/;
const HASH_RE = /^[0-9a-f]{64}$/;
/** Etykieta HEAD w komentarzu nagłówka: bez znaku nowej linii nie wyjdzie z komentarza. */
const HEAD_RE = /^[0-9A-Za-z._-]{1,64}$/;

/** Statusy trybu `pending`, w kolejności sprawdzania w `CASE`. */
export const PENDING_STATUS = {
  applied: "juz zastosowany",
  hashMismatch: "INNY HASH W REJESTRZE",
  willRun: "zostanie wykonany",
  skipped: "POMINIETY: when nie wiekszy od ostatniego zapisu",
} as const;

/** Problemy trybu `verify`; wpis bez problemu nie pojawia się w wyniku. */
export const VERIFY_PROBLEM = {
  hashMismatch: "inny hash",
  missing: "brak w rejestrze",
} as const;

export interface JournalLike {
  readonly entries: readonly JournalEntry[];
}

/** Wpis dziennika z hashem, który migrator zapisze (albo zapisał) w rejestrze. */
export interface DeployJournalRow {
  readonly idx: number;
  readonly tag: string;
  readonly when: number;
  readonly hash: string;
}

export type DeploySqlMode = "pending" | "verify";

export interface DeploySqlArgs {
  readonly mode: DeploySqlMode;
  readonly from: number;
  readonly to?: number;
}

/** Skrót jak w drizzle-orm `readMigrationFiles` (`migrator.js`): sha256 tekstu pliku w UTF-8. */
export function drizzleFileHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function isIndex(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function checkTag(tag: string): string {
  if (!TAG_RE.test(tag)) throw new Error(`tag ${JSON.stringify(tag)} spoza wzorca NNNN_[a-z0-9_]+`);
  return tag;
}

/** Każde pole wiersza trafia do SQL-a bez cytowania, więc każde jest sprawdzone. */
function checkRow(row: DeployJournalRow): DeployJournalRow {
  checkTag(row.tag);
  for (const field of ["idx", "when"] as const) {
    if (!isIndex(row[field])) {
      throw new Error(`${row.tag}: ${field} ${row[field]} nie jest liczbą całkowitą >= 0`);
    }
  }
  if (!HASH_RE.test(row.hash)) throw new Error(`${row.tag}: hash nie jest sha256 hex`);
  return row;
}

/**
 * Wpisy dziennika z zakresu [from, to] (`to` domyślnie ostatni wpis) w kolejności
 * dziennika, z hashem pliku liczonym jak w migratorze. Rzuca na: zakres spoza
 * dziennika albo odwrócony, zakres pusty albo dłuższy niż MAX_DEPLOY_ROWS, tag
 * spoza wzorca, brak pliku `.sql`, `when` niecałkowite.
 */
export function journalRows(
  journal: JournalLike,
  read: ReadFile,
  from: number,
  to?: number,
): DeployJournalRow[] {
  if (journal.entries.length === 0) throw new Error("dziennik nie ma wpisów");
  const last = journal.entries.reduce((max, e) => Math.max(max, e.idx), -1);
  const upper = to ?? last;
  if (!isIndex(from) || !isIndex(upper) || from > upper || upper > last) {
    throw new Error(`zakres ${from}-${upper} poza dziennikiem: wymagane 0 <= od <= do <= ${last}`);
  }
  const entries = journal.entries.filter((e) => e.idx >= from && e.idx <= upper);
  if (entries.length === 0) throw new Error(`brak wpisów dziennika w zakresie ${from}-${upper}`);
  if (entries.length > MAX_DEPLOY_ROWS) {
    throw new Error(
      `zakres ${from}-${upper} ma ${entries.length} wpisów, a jedno zapytanie mieści najwyżej ${MAX_DEPLOY_ROWS}; zawęź go przez --from/--to`,
    );
  }
  return entries.map((e) => {
    const content = read(`${DRIZZLE_DIR}/${checkTag(e.tag)}.sql`);
    if (content === null) throw new Error(`brak pliku ${e.tag}.sql`);
    return checkRow({ idx: e.idx, tag: e.tag, when: e.when, hash: drizzleFileHash(content) });
  });
}

function valuesRow(row: DeployJournalRow): string {
  const { idx, tag, when, hash } = checkRow(row);
  return `(${idx}, '${tag}', ${when}::bigint, '${hash}')`;
}

/** SQL TYLKO DO ODCZYTU dla edytora SQL; `head` to krótki SHA HEAD do nagłówka. */
export function renderDeploySql(
  mode: DeploySqlMode,
  rows: readonly DeployJournalRow[],
  head: string,
): string {
  if (rows.length === 0) throw new Error("brak wpisów do zapytania");
  if (!HEAD_RE.test(head)) {
    throw new Error(`HEAD ${JSON.stringify(head)} spoza wzorca [0-9A-Za-z._-]`);
  }
  const values = rows.map(valuesRow).join(",\n  ");
  const idxs = rows.map((r) => r.idx);
  const label = `HEAD ${head}, wpisy ${Math.min(...idxs)}-${Math.max(...idxs)}`;
  return mode === "pending" ? pendingSql(values, label) : verifySql(values, label);
}

function pendingSql(values: string, label: string): string {
  return [
    `-- migrations:deploy-sql --pending (${label})`,
    "-- TYLKO ODCZYT. Pokazuje, co zrobi najblizsze uruchomienie migratora Drizzle.",
    "WITH j(idx, tag, created_at, hash) AS (VALUES",
    `  ${values}`,
    "), r AS (",
    "  SELECT COALESCE(max(created_at), 0)::bigint AS last_applied FROM drizzle.__drizzle_migrations",
    ")",
    "SELECT j.idx, j.tag,",
    "  CASE",
    `    WHEN EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations d WHERE d.created_at = j.created_at AND d.hash = j.hash) THEN '${PENDING_STATUS.applied}'`,
    `    WHEN EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations d WHERE d.created_at = j.created_at) THEN '${PENDING_STATUS.hashMismatch}'`,
    `    WHEN j.created_at > r.last_applied THEN '${PENDING_STATUS.willRun}'`,
    `    ELSE '${PENDING_STATUS.skipped}'`,
    "  END AS status",
    "FROM j CROSS JOIN r",
    "ORDER BY j.idx;",
  ].join("\n");
}

function verifySql(values: string, label: string): string {
  return [
    `-- migrations:deploy-sql --verify (${label})`,
    "-- TYLKO ODCZYT. PUSTY wynik = kazdy wpis zakresu zapisany przez migrator z hashem pliku z repozytorium.",
    "WITH j(idx, tag, created_at, hash) AS (VALUES",
    `  ${values}`,
    ")",
    "SELECT j.idx, j.tag,",
    "  CASE WHEN EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations d WHERE d.created_at = j.created_at)",
    `       THEN '${VERIFY_PROBLEM.hashMismatch}' ELSE '${VERIFY_PROBLEM.missing}' END AS problem`,
    "FROM j",
    "WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations d WHERE d.created_at = j.created_at AND d.hash = j.hash)",
    "ORDER BY j.idx;",
  ].join("\n");
}

export const DEPLOY_SQL_USAGE = [
  "Uzycie: bun run migrations:deploy-sql -- (--pending|--verify) --from <idx> [--to <idx>]",
  "  --pending     co zrobi najblizsze uruchomienie migratora (przed wdrozeniem)",
  "  --verify      wpisy zakresu bez zapisu w rejestrze z hashem z repozytorium (po wdrozeniu; pusty wynik = OK)",
  "  --from <idx>  pierwszy wpis dziennika drizzle",
  "  --to <idx>    ostatni wpis (domyslnie ostatni w dzienniku)",
  "Wypisuje SQL tylko do odczytu; nie laczy sie z baza.",
].join("\n");

export function parseDeploySqlArgs(
  argv: readonly string[],
): DeploySqlArgs | { readonly error: string } {
  const modes: DeploySqlMode[] = [];
  const bounds: { from?: number; to?: number } = {};
  for (let k = 0; k < argv.length; k += 1) {
    const arg = argv[k]!;
    if (arg === "--pending") modes.push("pending");
    else if (arg === "--verify") modes.push("verify");
    else if (arg === "--from" || arg === "--to") {
      const key = arg === "--from" ? "from" : "to";
      const value = argv[(k += 1)];
      if (bounds[key] !== undefined) return { error: `${arg} podano dwa razy.` };
      if (value === undefined || !/^\d+$/.test(value) || !isIndex(Number(value))) {
        return { error: `${arg} wymaga numeru wpisu dziennika (liczba calkowita >= 0).` };
      }
      bounds[key] = Number(value);
    } else return { error: `Nieznany argument ${arg}.` };
  }
  if (modes.length !== 1) return { error: "Podaj dokladnie jeden tryb: --pending albo --verify." };
  if (bounds.from === undefined) return { error: "Brak --from <idx>." };
  return { mode: modes[0]!, from: bounds.from, to: bounds.to };
}

function isJournal(value: unknown): value is JournalLike {
  if (typeof value !== "object" || value === null) return false;
  const { entries } = value as { entries?: unknown };
  return (
    Array.isArray(entries) &&
    entries.every(
      (e: unknown) =>
        typeof e === "object" &&
        e !== null &&
        typeof (e as JournalEntry).idx === "number" &&
        typeof (e as JournalEntry).when === "number" &&
        typeof (e as JournalEntry).tag === "string",
    )
  );
}

function readJournal(read: ReadFile): JournalLike {
  const text = read(JOURNAL_PATH);
  if (text === null) throw new Error(`brak pliku ${JOURNAL_PATH}`);
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Zły JSON zgłasza ten sam komunikat co zły kształt niżej.
  }
  if (!isJournal(parsed)) {
    throw new Error(`${JOURNAL_PATH} nie ma kształtu {"entries": [{idx, when, tag}]}`);
  }
  return parsed;
}

/** Dysk, HEAD i wyjście wstrzykiwane: cała ścieżka CLI ma test bez dysku i bez gita. */
export interface DeploySqlCliDeps {
  readonly read: ReadFile;
  /** Krótki SHA HEAD do nagłówka zapytania. */
  readonly head: () => string;
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
}

/** Kod wyjścia: 0 - SQL wypisany; 1 - dziennik albo zakres nie dają zapytania; 2 - złe wywołanie. */
export function runDeploySqlCli(argv: readonly string[], deps: DeploySqlCliDeps): 0 | 1 | 2 {
  const args = parseDeploySqlArgs(argv);
  if ("error" in args) {
    deps.err(`${args.error}\n${DEPLOY_SQL_USAGE}`);
    return 2;
  }
  try {
    const rows = journalRows(readJournal(deps.read), deps.read, args.from, args.to);
    deps.out(renderDeploySql(args.mode, rows, deps.head()));
    return 0;
  } catch (error) {
    deps.err(`migrations:deploy-sql: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
