// LUSTRO DRIZZLE - generator wpisów dziennika drizzle z pasa supabase. Warstwa
// czysta: dostaje treści plików (`read`) i listy nazw, zwraca plan zapisów
// i usunięć; dysk, git i zegar obsługuje `drizzleMirrorCli.ts`
// (runner: scripts/migrations-mirror.ts).
//
// MODEL (docs/RUNBOOK_MIGRACJE_LOVABLE.md). Źródłem prawdy schematu jest
// `supabase/migrations`: z niego CI stawia bazę pgTAP i liczy bramki
// `check:sql-*`. Produkcja (Lovable Cloud) wykonuje wyłącznie dziennik
// `drizzle/migrations/meta/_journal.json` migratorem Drizzle, więc `drizzle/`
// jest artefaktem: każdy nowy plik supabase dostaje tu kopię (nagłówek
// z mirrorHeader.ts + bajty źródła), wpis dziennika i snapshot. Ręcznie nie
// pisze tego nikt; historyczne wpisy (do JOURNAL_FREEZE_IDX) zostają, jakie są.
//
// KONTRAKT MIGRATORA (drizzle-orm 0.45.2: `readMigrationFiles` i
// `PgDialect.migrate`, sprawdzone na PostgreSQL 16), z którego biorą się reguły:
//   * plik wpisu tnie na `--> statement-breakpoint` ZAWSZE, także w komentarzu,
//     literale i ciele `$$` (stąd `znacznik-breakpoint`); plik bez znacznika
//     idzie jednym zapytaniem protokołu prostego (postgres.js), więc wiele
//     instrukcji, ciała `$$` i `;` w literałach działają;
//   * wykonuje każdy wpis o `when` większym od ostatniego zapisu rejestru,
//     wszystkie w JEDNEJ transakcji: stąd `poza-transakcja` (COMMIT,
//     CONCURRENTLY, VACUUM ...) i ostrzeżenia `ustawienie-sesji` (SET z jednego
//     pliku obowiązuje w następnych) oraz `enum-nowa-wartosc` (55P04, gdy wpis
//     tej samej partii użyje nowej wartości);
//   * wpis o `when` nie większym od ostatniego zapisu pomija PO CICHU.
//
// DETERMINIZM. Plan nie czyta zegara ani losowości: `when` nowego wpisu to
// maksimum dziennika + k * 60 s (krok split-migration), a id snapshotu to
// UUID v8 z sha256 tagu i źródła. Drugi przebieg nic nie zmienia, więc
// `--check` w CI pyta dokładnie o to, co zrobiłby zapis. `now` z wejścia tylko
// PILNUJE (`when-w-przyszlosci`): wpis z `when` w przyszłości zepchnąłby
// następny wpis narzędzia Lovable (`when` = chwila wdrożenia) pod próg
// migratora.
//
// LUSTRA LOKALNE GAŁĘZI. Lustra spoza dziennika bazy (`base`, domyślnie
// origin/main) produkcja jeszcze nie widziała, więc generator przepisuje je przy
// każdym przebiegu od nowa - po scaleniu main z nowymi wpisami (konflikt
// dziennika) stają za nimi z kolejnym idx i `when`. Lustro z bazy jest
// forward-only: zmiana SQL-a wykonywalnego jego źródła to `zrodlo-rozjechane`,
// nigdy cicha ponowna dostawa. Jedyny wyjątek (runbook §6.3): `rewrite`
// (`--rewrite <tag>`) dla lustra, którego rejestr produkcji nie zapisał - nowa
// treść pod tym samym idx, `when` i snapshotem.
//
// CO KOPIOWAĆ - JEDNA DEFINICJA Z BRAMKĄ. Kandydaci to dokładnie pliki, które
// kierunek odwrotny bramki (`analyzeSupabaseCoverage`) zgłasza jako
// `brak-kopii-drizzle`. Plik z wpisem SUPABASE_LANE_GAPS (zestawienie albo
// `appliedOutOfBand`) nie jest wysyłany nigdy, a „lustro aktualne" i „bramka
// bez `brak-kopii-drizzle`" to ten sam warunek.
import { createHash } from "node:crypto";

import {
  MIGRATION_LANES,
  executableSql,
  type LaneEntry,
  type ReadFile,
} from "../ci/migrationLaneParity";
import {
  DEFAULT_MAX_BYTES,
  MigrationLexError,
  lexStatements,
  utf8Length,
  type SqlSegment,
} from "../ci/migrationSplit";
import {
  DRIZZLE_JOURNAL,
  DRIZZLE_MIGRATIONS_DIR,
  SUPABASE_MIGRATIONS_DIR,
  WHEN_STEP_MS,
  type DrizzleJournal,
  type DrizzleSnapshot,
  type FileWrite,
  type JournalEntry,
} from "../ci/migrationSplitPlan";
import {
  DRIZZLE_LANE_START,
  GAP_EXCEPTIONS_AT_GATE_START,
  SUPABASE_LANE_GAPS,
  analyzeSupabaseCoverage,
  supabaseMigrationVersion,
  type SupabaseLaneGap,
} from "../ci/supabaseLaneCoverage";
import { mirrorHeader, mirrorSourceOf } from "./mirrorHeader";

/** Znacznik, na którym migrator Drizzle tnie plik wpisu - bez względu na kontekst. */
export const DRIZZLE_BREAKPOINT = "--> statement-breakpoint";
/** Najdłuższa etykieta tagu (dziś najdłuższa nazwa źródła ma 50 znaków). */
export const MIRROR_LABEL_MAX = 64;
/** `id` snapshotu „przed pierwszym" w drizzle-kit (prevId wpisu 0000). */
export const DRY_SNAPSHOT_ID = "00000000-0000-0000-0000-000000000000";
export const SNAPSHOT_RE = /^(\d+)_snapshot\.json$/;
export const DRIZZLE_META_DIR = `${DRIZZLE_MIGRATIONS_DIR}/meta`;
/** Naprawa dziennika po konflikcie albo ręcznej przeróbce (runbook, wiersz CLI). */
export const JOURNAL_CONFLICT_FIX = `git checkout origin/main -- ${DRIZZLE_META_DIR} && bun run migrations:mirror`;

const JOURNAL_TAG_RE = /^(\d{4,})_[a-z0-9_]+$/;

/**
 * Snapshot poprzednika, gdy w meta/ nie ma żadnego (pusty dziennik): układ kluczy
 * `0000_snapshot.json`, czyli `dryPg` drizzle-kit.
 */
const DRY_SNAPSHOT: DrizzleSnapshot = {
  id: DRY_SNAPSHOT_ID,
  prevId: "",
  version: "7",
  dialect: "postgresql",
  tables: {},
  enums: {},
  schemas: {},
  views: {},
  sequences: {},
  roles: {},
  policies: {},
  _meta: { columns: {}, schemas: {}, tables: {} },
};

/**
 * Instrukcje, które nie wykonają się w transakcji migratora (25001 albo
 * zerwana atomowość) - zmierzone na PostgreSQL 16. `REFRESH MATERIALIZED VIEW
 * CONCURRENTLY` i `ALTER DATABASE ... SET` w transakcji działają, więc ich tu nie ma.
 */
const OUTSIDE_TX = new RegExp(
  [
    String.raw`^(?:BEGIN|START TRANSACTION|COMMIT|END|ROLLBACK|ABORT|SAVEPOINT|RELEASE|PREPARE TRANSACTION|VACUUM|ALTER SYSTEM|(?:CREATE|DROP) (?:DATABASE|TABLESPACE)|DISCARD ALL)\b`,
    String.raw`^(?:CREATE (?:UNIQUE )?INDEX|DROP INDEX|REINDEX)\b.*\bCONCURRENTLY\b`,
    String.raw`^ALTER TABLE\b.*\bDETACH PARTITION\b.*\bCONCURRENTLY\b`,
  ].join("|"),
  "i",
);
const ENUM_ADD_VALUE = /^ALTER TYPE\b.*\bADD VALUE\b/i;
/** Ustawienie sesji albo transakcji na najwyższym poziomie pliku. */
const SESSION_SETTING = /^(?:SET|RESET)\b|^SELECT (?:pg_catalog ?\. ?)?set_config ?\(/i;

export type MirrorIssueKind =
  | "dziennik-ksztalt"
  | "wpis-bazy-zmieniony"
  | "lokalne-nie-na-koncu"
  | "brak-pliku-wpisu"
  | "snapshot-uszkodzony"
  | "snapshot-kolizja"
  | "zrodlo-rozjechane"
  | "zrodlo-brak"
  | "przepisanie-niedozwolone"
  | "wersja-wsteczna"
  | "nazwa-zrodla"
  | "pusty-sql"
  | "znacznik-breakpoint"
  | "poza-transakcja"
  | "sql-nieczytelny"
  | "za-duzy"
  | "when-w-przyszlosci";

export type MirrorWarningKind = "enum-nowa-wartosc" | "ustawienie-sesji" | "przepisanie-zbedne";

export interface MirrorIssue {
  readonly kind: MirrorIssueKind;
  readonly path: string;
  readonly detail: string;
}

export interface MirrorWarning {
  readonly kind: MirrorWarningKind;
  readonly path: string;
  readonly detail: string;
}

export interface MirrorBase {
  /** Ref gita, z którego pochodzi dziennik bazy (do komunikatów). */
  readonly ref: string;
  readonly entries: readonly Pick<JournalEntry, "idx" | "when" | "tag">[];
}

export interface MirrorInput {
  /** Sparsowany `_journal.json`. */
  readonly journal: DrizzleJournal;
  /** Nazwy `drizzle/migrations/*.sql`. */
  readonly drizzleSql: readonly string[];
  /** Nazwy plików `drizzle/migrations/meta/` bez prefiksu `_` - drizzle-kit czyta każdy jako snapshot. */
  readonly snapshots: readonly string[];
  /** Nazwy `supabase/migrations/*.sql` (kolejność dowolna). */
  readonly supabaseSql: readonly string[];
  /** Odczyt pliku (ścieżka względem repozytorium); `null`, gdy go nie ma. */
  readonly read: ReadFile;
  /**
   * Dziennik bazy (origin/main). Lustra SPOZA niego są lokalne dla gałęzi
   * i przepisywane; `null`/brak = tylko dopisywanie.
   */
  readonly base?: MirrorBase | null;
  /** Chwila uruchomienia (ms) - `when` nowego wpisu nie może jej przekroczyć. */
  readonly now?: number;
  /** Tagi luster z bazy do przepisania z bieżącego źródła (runbook §6.3). */
  readonly rewrite?: ReadonlySet<string>;
  readonly gaps?: readonly SupabaseLaneGap[];
  readonly lanes?: readonly LaneEntry[];
  readonly exceptions?: ReadonlySet<string>;
  readonly maxBytes?: number;
}

/** Wpis lustra w końcowym dzienniku. */
export interface MirrorEntry {
  readonly idx: number;
  readonly tag: string;
  readonly when: number;
  /** Plik w `supabase/migrations/`. */
  readonly source: string;
  /** Rozmiar pliku lustra (UTF-8, z nagłówkiem). */
  readonly bytes: number;
}

/** Lustro przepisane `--rewrite`: nowa treść, idx, `when` i snapshot bez zmian. */
export interface MirrorRewrite {
  readonly idx: number;
  readonly tag: string;
  readonly source: string;
  readonly bytes: number;
}

export interface MirrorPlan {
  /** Lustra, których plik, snapshot albo wpis dziennika zmienia zapis (nowe albo przepisane lokalne). */
  readonly entries: readonly MirrorEntry[];
  readonly rewritten: readonly MirrorRewrite[];
  /** Tylko pliki, których treść się zmienia: sql, snapshoty, `_journal.json` na końcu. */
  readonly files: readonly FileWrite[];
  /** Osierocone pliki generatora i snapshoty za końcem dziennika (tylko istniejące). */
  readonly deletions: readonly string[];
  readonly errors: readonly MirrorIssue[];
  readonly warnings: readonly MirrorWarning[];
  /** Najnowszy plik supabase niesiony przez dziennik po zastosowaniu planu. */
  readonly lastCarried: string | null;
  /** Wpisy, które wykona najbliższe wdrożenie tej gałęzi: spoza bazy (albo nowe) i przepisane. */
  readonly deploy: readonly { readonly idx: number; readonly tag: string }[];
}

export type MirrorMode = "write" | "check" | "dry-run";

const supabasePath = (file: string): string => `${SUPABASE_MIGRATIONS_DIR}/${file}`;
const drizzlePath = (tag: string): string => `${DRIZZLE_MIGRATIONS_DIR}/${tag}.sql`;
const snapshotPath = (idx: number): string =>
  `${DRIZZLE_META_DIR}/${String(idx).padStart(4, "0")}_snapshot.json`;
const isoTime = (ms: number): string => new Date(ms).toISOString();

/**
 * Tag wpisu: idx (4 cyfry, więcej, gdy trzeba) i etykieta ze źródła - bez
 * wersji, ASCII, małe litery, `_` zamiast reszty, najwyżej MIRROR_LABEL_MAX
 * znaków (cięcie na `_`, gdy wypada w drugiej połowie).
 */
export function mirrorTag(idx: number, sourceFile: string): string {
  let label = sourceFile
    .replace(/^\d{14}_/, "")
    .replace(/\.sql$/, "")
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  if (label.length > MIRROR_LABEL_MAX) {
    const cut = label.lastIndexOf("_", MIRROR_LABEL_MAX);
    label = label.slice(0, cut >= MIRROR_LABEL_MAX / 2 ? cut : MIRROR_LABEL_MAX).replace(/_+$/, "");
  }
  return `${String(idx).padStart(4, "0")}_${label === "" ? "migration" : label}`;
}

/** UUID v8 (RFC 9562) z sha256 - ten sam wpis i źródło dają ten sam id przy każdym przebiegu. */
export function mirrorSnapshotId(tag: string, sourceFile: string): string {
  const h = createHash("sha256").update(`drizzle-mirror\n${tag}\n${sourceFile}`).digest();
  h[6] = (h[6]! & 0x0f) | 0x80;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

/** Wersja migracji supabase (14 cyfr, UTC) dla chwili `ms`. */
export function utcVersion(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

/** Chwila (ms, UTC) wersji migracji supabase. */
export function versionToMs(version: string): number {
  const part = (from: number, to: number): number => Number(version.slice(from, to));
  return Date.UTC(part(0, 4), part(4, 6) - 1, part(6, 8), part(8, 10), part(10, 12), part(12, 14));
}

/** Format zapisu drizzle-kit (`JSON.stringify(j, null, 2)`) z końcowym `\n` jak w repo. */
export function journalText(journal: DrizzleJournal): string {
  return `${JSON.stringify(journal, null, 2)}\n`;
}

export function snapshotText(snapshot: DrizzleSnapshot): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

/** Początek instrukcji z pliku (pierwsza linia kodu, do 80 znaków) - do komunikatu z numerem linii. */
function statementStart(sql: string, segment: SqlSegment): string {
  const line = sql
    .slice(segment.codeStart)
    .split(/\r?\n|\r/, 1)[0]!
    .trim();
  return line.length > 80 ? `${line.slice(0, 77)}...` : line;
}

export interface MirrorLint {
  readonly errors: readonly MirrorIssue[];
  readonly warnings: readonly MirrorWarning[];
}

/**
 * Czy plik supabase da się dostarczyć lustrem w partii migratora. Instrukcje
 * ocenia SZKIELET leksera (literały i ciała `$$` zamaskowane), więc słowa
 * w napisie albo w ciele funkcji niczego nie zgłaszają.
 */
export function lintMirrorSource(file: string, sql: string, maxBytes: number): MirrorLint {
  const path = supabasePath(file);
  const errors: MirrorIssue[] = [];
  const warnings: MirrorWarning[] = [];
  const error = (kind: MirrorIssueKind, detail: string): void => {
    errors.push({ kind, path, detail });
  };
  if (mirrorSourceOf(mirrorHeader(file)) !== file) {
    error(
      "nazwa-zrodla",
      `nazwa spoza [A-Za-z0-9_.-]: nagłówek lustra nie wskazałby źródła (MIRROR_HEADER_RE), więc bramka nie rozpoznałaby lustra. Nadaj nazwę ASCII (git mv).`,
    );
  }
  if (executableSql(sql) === "") {
    error(
      "pusty-sql",
      "plik nie ma SQL-a wykonywalnego (same komentarze) - lustra nie da się rozpoznać po treści, więc plan nigdy nie byłby pusty. Usuń plik albo dopisz instrukcję.",
    );
  }
  if (sql.includes(DRIZZLE_BREAKPOINT)) {
    error(
      "znacznik-breakpoint",
      `napis „${DRIZZLE_BREAKPOINT}" (także w komentarzu, literale albo ciele $$): migrator Drizzle tnie tam plik ZAWSZE i wykonałby urwane instrukcje. Usuń ten napis.`,
    );
  }
  const bytes = utf8Length(mirrorHeader(file) + sql);
  if (bytes > maxBytes) {
    error(
      "za-duzy",
      `lustro (nagłówek + plik) ma ${bytes} B, limit wdrożenia Lovable to ${maxBytes} B. Potnij plik: bun run scripts/split-migration.ts ${path} - generator skopiuje każdą część osobno.`,
    );
  }
  let segments: SqlSegment[];
  try {
    segments = lexStatements(sql);
  } catch (caught) {
    if (!(caught instanceof MigrationLexError)) throw caught;
    error("sql-nieczytelny", caught.message);
    return { errors, warnings };
  }
  for (const segment of segments) {
    if (segment.codeStart === -1) continue;
    const skeleton = segment.skeleton.trim();
    const at = `linia ${segment.line}: „${statementStart(sql, segment)}"`;
    if (OUTSIDE_TX.test(skeleton)) {
      error(
        "poza-transakcja",
        `${at} nie wykona się w transakcji, a migrator stosuje całą partię w JEDNEJ transakcji (COMMIT zerwałby jej atomowość, CONCURRENTLY i VACUUM padają błędem 25001). Zapisz zmianę bez tej instrukcji.`,
      );
    } else if (ENUM_ADD_VALUE.test(skeleton)) {
      warnings.push({
        kind: "enum-nowa-wartosc",
        path,
        detail: `${at} - nowej wartości nie może użyć żaden wpis tej samej partii migratora (55P04 wycofuje całą partię). Wdróż ten plik osobnym uruchomieniem migratora, przed wpisami, które jej używają.`,
      });
    } else if (SESSION_SETTING.test(skeleton)) {
      warnings.push({
        kind: "ustawienie-sesji",
        path,
        detail: `${at} na najwyższym poziomie obowiązuje do końca CAŁEJ partii migratora (jedna transakcja na wszystkie oczekujące wpisy), więc także w kolejnych plikach. Świadome (np. SET lock_timeout) - w porządku; ustawienie jednej funkcji należy do jej definicji (SET w CREATE FUNCTION).`,
      });
    }
  }
  return { errors, warnings };
}

/** Odczyt z pamięcią na czas jednego planu - pliki czyta i gałąź luster, i pomiar pokrycia. */
function memoRead(read: ReadFile): ReadFile {
  const cache = new Map<string, string | null>();
  return (path) => {
    const hit = cache.get(path);
    if (hit !== undefined) return hit;
    const value = read(path);
    cache.set(path, value);
    return value;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Usterki kształtu dziennika: wersja, dialekt, typy pól, idx == pozycja == prefiks tagu, unikalne tagi. */
function journalShapeProblems(journal: unknown): string[] {
  if (!isRecord(journal)) return ["dziennik nie jest obiektem JSON"];
  const problems: string[] = [];
  if (journal.version !== "7")
    problems.push(`version ${JSON.stringify(journal.version)} zamiast "7"`);
  if (journal.dialect !== "postgresql")
    problems.push(`dialect ${JSON.stringify(journal.dialect)} zamiast "postgresql"`);
  if (!Array.isArray(journal.entries)) return [...problems, "entries nie jest tablicą"];
  const seen = new Set<string>();
  journal.entries.forEach((entry: unknown, k) => {
    if (!isRecord(entry)) {
      problems.push(`wpis na pozycji ${k} nie jest obiektem`);
      return;
    }
    const { idx, version, when, tag, breakpoints } = entry;
    if (idx !== k) problems.push(`wpis na pozycji ${k} ma idx ${JSON.stringify(idx)}`);
    if (typeof version !== "string" || typeof breakpoints !== "boolean")
      problems.push(`wpis ${k}: version albo breakpoints złego typu`);
    if (typeof when !== "number" || !Number.isSafeInteger(when))
      problems.push(`wpis ${k}: when ${JSON.stringify(when)} nie jest liczbą całkowitą`);
    if (typeof tag !== "string") {
      problems.push(`wpis ${k}: tag nie jest napisem`);
      return;
    }
    const prefix = JOURNAL_TAG_RE.exec(tag)?.[1];
    if (prefix === undefined)
      problems.push(`wpis ${k}: tag ${tag} spoza konwencji <idx>_[a-z0-9_]+`);
    else if (Number(prefix) !== k) problems.push(`wpis ${k}: prefiks tagu ${tag} różny od idx`);
    if (seen.has(tag)) problems.push(`tag ${tag} powtórzony`);
    seen.add(tag);
  });
  return problems;
}

/** Wpisy bazy, którym gałąź zmieniła idx albo `when` (przenumerowanie main po konflikcie). */
function changedBaseEntries(entries: readonly JournalEntry[], base: MirrorBase): string[] {
  const byTag = new Map(entries.map((e) => [e.tag, e]));
  return base.entries
    .filter((b) => {
      const own = byTag.get(b.tag);
      return own !== undefined && (own.idx !== b.idx || own.when !== b.when);
    })
    .map((b) => b.tag);
}

function sameEntry(a: JournalEntry | undefined, b: JournalEntry): boolean {
  return (
    a !== undefined &&
    a.idx === b.idx &&
    a.version === b.version &&
    a.when === b.when &&
    a.tag === b.tag &&
    a.breakpoints === b.breakpoints
  );
}

/** Snapshot poprzednika jak `preparePrevSnapshot` drizzle-kit: leksykograficznie ostatni z prefiksem <= idx. */
function parentSnapshot(
  snapshots: readonly string[],
  idx: number,
  read: ReadFile,
): DrizzleSnapshot | null {
  const names = snapshots
    .filter((name) => {
      const prefix = SNAPSHOT_RE.exec(name)?.[1];
      return prefix !== undefined && Number(prefix) <= idx;
    })
    .sort();
  const last = names.at(-1);
  return last === undefined ? DRY_SNAPSHOT : parseSnapshot(read(`${DRIZZLE_META_DIR}/${last}`));
}

/** Snapshot w formacie, który drizzle-kit przyjmie (v7, postgresql, napisowe id i prevId); `null` - nie. */
function parseSnapshot(text: string | null): DrizzleSnapshot | null {
  if (text === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  return isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.prevId === "string" &&
    value.version === "7" &&
    value.dialect === "postgresql"
    ? (value as DrizzleSnapshot)
    : null;
}

const SNAPSHOT_SILENT_EXIT =
  "drizzle-kit generate (narzędzie migracji Lovable) kończy się wtedy po cichu kodem 0 i nie tworzy migracji";

/**
 * Końcowe meta/ (istniejące pliki bez usuniętych, nadpisane zapisami) tak, jak
 * czyta je `prepareMigrationFolder` drizzle-kit: KAŻDY plik bez `_` to snapshot,
 * poprawny, bez wspólnego `prevId` (kolizja) i bez wspólnego `id`.
 */
function snapshotIssues(
  names: readonly string[],
  writes: ReadonlyMap<string, string>,
  read: ReadFile,
): MirrorIssue[] {
  const issues: MirrorIssue[] = [];
  const byField = { prevId: new Map<string, string[]>(), id: new Map<string, string[]>() };
  for (const name of [...names].sort()) {
    const path = `${DRIZZLE_META_DIR}/${name}`;
    if (!SNAPSHOT_RE.test(name)) {
      issues.push({
        kind: "snapshot-uszkodzony",
        path,
        detail: `nazwa spoza konwencji NNNN_snapshot.json, a drizzle-kit czyta każdy plik meta/ bez prefiksu _ jako snapshot (ostatni w kolejności nazw bierze za rodzica następnej migracji). Usuń plik z meta/.`,
      });
    }
    const snapshot = parseSnapshot(writes.get(path) ?? read(path));
    if (snapshot === null) {
      issues.push({
        kind: "snapshot-uszkodzony",
        path,
        detail: `nie jest snapshotem v7 postgresql z napisowym id i prevId - ${SNAPSHOT_SILENT_EXIT}. Przywróć plik: ${JOURNAL_CONFLICT_FIX}.`,
      });
      continue;
    }
    for (const field of ["prevId", "id"] as const) {
      const group = byField[field].get(snapshot[field]);
      if (group) group.push(name);
      else byField[field].set(snapshot[field], [name]);
    }
  }
  for (const field of ["prevId", "id"] as const) {
    for (const [value, group] of byField[field]) {
      if (group.length < 2) continue;
      issues.push({
        kind: "snapshot-kolizja",
        path: DRIZZLE_META_DIR,
        detail: `${group.join(", ")} mają ten sam ${field} ${value} - ${SNAPSHOT_SILENT_EXIT}. ${JOURNAL_CONFLICT_FIX}.`,
      });
    }
  }
  return issues;
}

function blocked(error: MirrorIssue): MirrorPlan {
  return {
    entries: [],
    rewritten: [],
    files: [],
    deletions: [],
    errors: [error],
    warnings: [],
    lastCarried: null,
    deploy: [],
  };
}

const inLaneScope = (file: string): boolean =>
  (supabaseMigrationVersion(file) ?? "") >= DRIZZLE_LANE_START;

/** Kształt dziennika i wpisy bazy bez przenumerowania - bez tego planu nie da się liczyć. */
function journalIssue(journal: DrizzleJournal, base: MirrorBase | null): MirrorIssue | null {
  const shape = journalShapeProblems(journal);
  if (shape.length > 0) {
    return {
      kind: "dziennik-ksztalt",
      path: DRIZZLE_JOURNAL,
      detail: `${shape.join("; ")}. Dziennik po złym rozwiązaniu konfliktu albo ręcznej przeróbce: ${JOURNAL_CONFLICT_FIX}.`,
    };
  }
  const changed = base === null ? [] : changedBaseEntries(journal.entries, base);
  if (base === null || changed.length === 0) return null;
  return {
    kind: "wpis-bazy-zmieniony",
    path: DRIZZLE_JOURNAL,
    detail: `wpisy ${base.ref} mają w tej gałęzi inny idx albo when: ${changed.join(", ")}. Wpisów bazy nie przenumerowuje się (produkcja mogła je wykonać): ${JOURNAL_CONFLICT_FIX}.`,
  };
}

interface Generated {
  readonly source: string;
  readonly text: string;
}

/** Lustra dziennika: wpisy, których plik ma nagłówek generatora (tag -> źródło i treść). */
function generatedMirrors(
  entries: readonly JournalEntry[],
  read: ReadFile,
): ReadonlyMap<string, Generated> {
  const generated = new Map<string, Generated>();
  for (const entry of entries) {
    const text = read(drizzlePath(entry.tag));
    const source = mirrorSourceOf(text);
    if (text !== null && source !== null) generated.set(entry.tag, { source, text });
  }
  return generated;
}

/**
 * Ile wpisów zostaje bez zmian: wszystkie poza lustrami lokalnymi gałęzi (spoza
 * bazy), które generator przepisuje od nowa - więc muszą stać na końcu dziennika.
 */
function keptPrefix(
  entries: readonly JournalEntry[],
  generated: ReadonlyMap<string, Generated>,
  base: MirrorBase | null,
): number | MirrorIssue {
  if (base === null) return entries.length;
  const baseTags = new Set(base.entries.map((e) => e.tag));
  const local = entries.filter((e) => generated.has(e.tag) && !baseTags.has(e.tag));
  const first = entries.length - local.length;
  if (local.every((e, k) => e.idx === first + k)) return first;
  return {
    kind: "lokalne-nie-na-koncu",
    path: DRIZZLE_JOURNAL,
    detail: `lustra lokalne gałęzi (spoza ${base.ref}): ${local.map((e) => e.tag).join(", ")} - a między nimi albo za nimi stoją inne wpisy. Generator przepisuje lustra lokalne od nowa, więc muszą stać na końcu dziennika: ${JOURNAL_CONFLICT_FIX}.`,
  };
}

/**
 * Wpisy bez pliku (np. lustro skasowane cofnięciem commita): migrator przerwie na
 * nich wdrożenie, a ich źródło wyglądałoby na niewysłane - generator nie dołoży
 * DRUGIEJ dostawy.
 */
function missingFileIssues(entries: readonly JournalEntry[], read: ReadFile): MirrorIssue[] {
  return entries
    .filter((entry) => read(drizzlePath(entry.tag)) === null)
    .map((entry) => ({
      kind: "brak-pliku-wpisu",
      path: drizzlePath(entry.tag),
      detail: `wpis dziennika (idx ${entry.idx}) nie ma pliku - migrator Drizzle przerwie na nim wdrożenie, a jego źródło dostałoby drugi wpis. Przywróć plik z historii gita (git checkout origin/main -- ${drizzlePath(entry.tag)}).`,
    }));
}

/** `--rewrite` dla tagu spoza dziennika albo wpisu bez nagłówka to błąd; dla lustra lokalnego - zbędne. */
function rewriteRequestLint(
  rewrite: ReadonlySet<string>,
  entries: readonly JournalEntry[],
  generated: ReadonlyMap<string, Generated>,
  kept: ReadonlySet<string>,
  base: MirrorBase | null,
): MirrorLint {
  const tags = new Set(entries.map((e) => e.tag));
  const errors: MirrorIssue[] = [];
  const warnings: MirrorWarning[] = [];
  for (const tag of [...rewrite].sort()) {
    const path = drizzlePath(tag);
    if (!tags.has(tag)) {
      errors.push({
        kind: "przepisanie-niedozwolone",
        path,
        detail: `--rewrite ${tag}: takiego wpisu nie ma w ${DRIZZLE_JOURNAL}.`,
      });
    } else if (!generated.has(tag)) {
      errors.push({
        kind: "przepisanie-niedozwolone",
        path,
        detail: `--rewrite ${tag}: wpis nie ma nagłówka generatora, a przepisuje się wyłącznie lustro pliku ${SUPABASE_MIGRATIONS_DIR}. Wpis panelu Lovable albo historyczny bliźniak zostaje, jaki jest (adopcja: docs/RUNBOOK_MIGRACJE_LOVABLE.md §5).`,
      });
    } else if (!kept.has(tag)) {
      warnings.push({
        kind: "przepisanie-zbedne",
        path,
        detail: `${tag} to lustro lokalne gałęzi (spoza ${base?.ref}) - generator przepisuje je przy każdym przebiegu, --rewrite nie jest potrzebne.`,
      });
    }
  }
  return { errors, warnings };
}

interface BaseMirrorReview extends MirrorLint {
  /** Nowa treść luster przepisanych `--rewrite` (ścieżka -> treść). */
  readonly overlay: ReadonlyMap<string, string>;
  /** Źródła rozjechane z lustrem - nigdy nie wysyłane drugi raz. */
  readonly drifted: ReadonlySet<string>;
  readonly rewritten: readonly MirrorRewrite[];
}

/** Lustra z bazy: forward-only; `rewrite` daje nową treść pod tym samym wpisem. */
function reviewBaseMirrors(
  kept: readonly JournalEntry[],
  generated: ReadonlyMap<string, Generated>,
  rewrite: ReadonlySet<string>,
  read: ReadFile,
  maxBytes: number,
): BaseMirrorReview {
  const errors: MirrorIssue[] = [];
  const warnings: MirrorWarning[] = [];
  const overlay = new Map<string, string>();
  const drifted = new Set<string>();
  const rewritten: MirrorRewrite[] = [];
  for (const entry of kept) {
    const mirror = generated.get(entry.tag);
    if (mirror === undefined) continue;
    const path = drizzlePath(entry.tag);
    const sourceSql = read(supabasePath(mirror.source));
    if (sourceSql === null) {
      errors.push({
        kind: "zrodlo-brak",
        path,
        detail: `nagłówek lustra wskazuje ${supabasePath(mirror.source)}, a tego pliku nie ma. Źródła wysłanej migracji nie usuwa się ani nie przemianowuje (forward-only) - przywróć plik pod tą nazwą.`,
      });
    } else if (rewrite.has(entry.tag)) {
      const content = mirrorHeader(mirror.source) + sourceSql;
      if (content === mirror.text) {
        warnings.push({
          kind: "przepisanie-zbedne",
          path,
          detail: `treść lustra jest już równa nagłówkowi i ${supabasePath(mirror.source)} - nie ma czego przepisać.`,
        });
        continue;
      }
      const lint = lintMirrorSource(mirror.source, sourceSql, maxBytes);
      errors.push(...lint.errors);
      warnings.push(...lint.warnings);
      overlay.set(path, content);
      rewritten.push({
        idx: entry.idx,
        tag: entry.tag,
        source: mirror.source,
        bytes: utf8Length(content),
      });
    } else if (executableSql(sourceSql) !== executableSql(mirror.text)) {
      drifted.add(mirror.source);
      errors.push({
        kind: "zrodlo-rozjechane",
        path,
        detail: `SQL wykonywalny ${supabasePath(mirror.source)} różni się od lustra (idx ${entry.idx}). Lustro z bazy mogło już wykonać się na produkcji (forward-only): cofnij zmianę źródła i dodaj NOWĄ migrację. Lustro lokalne gałęzi przepisze \`bun run migrations:mirror\` z bazą (domyślnie origin/main). Wpis, którego produkcja nie zapisała (\`bun run migrations:deploy-sql -- --verify --from ${entry.idx} --to ${entry.idx}\` zgłasza „brak w rejestrze"), przepisuje \`bun run migrations:mirror --rewrite ${entry.tag}\` (docs/RUNBOOK_MIGRACJE_LOVABLE.md §6.3).`,
      });
    }
  }
  return { errors, warnings, overlay, drifted, rewritten };
}

/**
 * Pliki do skopiowania = `brak-kopii-drizzle` kierunku odwrotnego bramki,
 * liczony na zachowanym dzienniku (po przepisaniach), bez źródeł rozjechanych.
 * Do tego najnowszy plik, który dziennik już niesie (poza `appliedOutOfBand`).
 */
function mirrorCandidates(
  input: MirrorInput,
  kept: readonly JournalEntry[],
  read: ReadFile,
  drifted: ReadonlySet<string>,
): { readonly candidates: readonly string[]; readonly carriedBefore: string | null } {
  const gaps = input.gaps ?? SUPABASE_LANE_GAPS;
  const coverage = analyzeSupabaseCoverage(
    kept.map((e) => e.tag),
    {
      gaps,
      read,
      listSupabase: () => input.supabaseSql,
      lanes: input.lanes ?? MIGRATION_LANES,
      preLane: null,
      exceptions: input.exceptions ?? GAP_EXCEPTIONS_AT_GATE_START,
    },
  );
  const candidates = coverage.violations
    .filter((v) => v.kind === "brak-kopii-drizzle" && !drifted.has(v.file))
    .map((v) => v.file)
    .sort();
  const skipped = new Set([
    ...candidates,
    ...gaps.flatMap((g) => ("appliedOutOfBand" in g ? [g.file] : [])),
  ]);
  const carriedBefore =
    input.supabaseSql
      .filter((f) => inLaneScope(f) && !skipped.has(f))
      .sort()
      .at(-1) ?? null;
  return { candidates, carriedBefore };
}

interface MirrorSource {
  readonly file: string;
  readonly sql: string;
}

/**
 * Treść kandydatów i ich reguły: plik lustra (`lintMirrorSource`) oraz kolejność -
 * produkcja wykonuje dziennik po kolei, a pgTAP składa bazę po wersjach, więc
 * kandydat musi być nowszy od wszystkiego, co dziennik już niesie.
 */
function lintCandidates(
  candidates: readonly string[],
  carriedBefore: string | null,
  read: ReadFile,
  maxBytes: number,
  now: number | undefined,
): MirrorLint & { readonly sources: readonly MirrorSource[] } {
  const errors: MirrorIssue[] = [];
  const warnings: MirrorWarning[] = [];
  const sources: MirrorSource[] = [];
  const lastVersion = carriedBefore === null ? null : supabaseMigrationVersion(carriedBefore)!;
  let backdated = 0;
  for (const file of candidates) {
    const sql = read(supabasePath(file));
    if (sql === null) {
      errors.push({
        kind: "zrodlo-brak",
        path: supabasePath(file),
        detail: "pliku nie da się odczytać.",
      });
      continue;
    }
    const lint = lintMirrorSource(file, sql, maxBytes);
    errors.push(...lint.errors);
    warnings.push(...lint.warnings);
    if (lastVersion !== null && supabaseMigrationVersion(file)! <= lastVersion) {
      const from = Math.max(now ?? 0, versionToMs(lastVersion) + 1000);
      const renamed = `${utcVersion(from + backdated * 1000)}_${file.replace(/^\d{14}_/, "")}`;
      backdated += 1;
      errors.push({
        kind: "wersja-wsteczna",
        path: supabasePath(file),
        detail: `wersja nie jest późniejsza niż ${carriedBefore} (najnowszy plik niesiony przez dziennik): produkcja wykonałaby ją PO nim, a pgTAP i bramki check:sql-* PRZED nim. Nadaj nową wersję: git mv ${supabasePath(file)} ${supabasePath(renamed)}`,
      });
    }
    sources.push({ file, sql });
  }
  return { errors, warnings, sources };
}

interface Appended {
  readonly added: readonly JournalEntry[];
  readonly mirrors: readonly MirrorEntry[];
  readonly sqlWrites: readonly FileWrite[];
  readonly snapshotWrites: readonly FileWrite[];
  readonly errors: readonly MirrorIssue[];
}

/**
 * Nowe wpisy za zachowanym dziennikiem: kolejny idx, `when` = maksimum + k * 60 s
 * (nie zegar), snapshot = poprzednik z nowym, deterministycznym id w łańcuchu `prevId`.
 */
function appendMirrors(
  kept: readonly JournalEntry[],
  sources: readonly MirrorSource[],
  parent: DrizzleSnapshot,
  now: number | undefined,
): Appended {
  const last = kept.at(-1);
  const idx0 = last?.idx ?? -1;
  const when0 = kept.reduce((max, e) => Math.max(max, e.when), 0);
  const version = last?.version ?? "7";
  const added: JournalEntry[] = [];
  const mirrors: MirrorEntry[] = [];
  const sqlWrites: FileWrite[] = [];
  const snapshotWrites: FileWrite[] = [];
  const errors: MirrorIssue[] = [];
  let prev = parent;
  sources.forEach(({ file, sql }, k) => {
    const idx = idx0 + k + 1;
    const tag = mirrorTag(idx, file);
    const when = when0 + (k + 1) * WHEN_STEP_MS;
    if (now !== undefined && when > now) {
      errors.push({
        kind: "when-w-przyszlosci",
        path: DRIZZLE_JOURNAL,
        detail: `${tag}: when ${when} (${isoTime(when)}) wypada po chwili uruchomienia (${isoTime(now)}); maksimum dziennika to ${when0}${last ? ` (${last.tag})` : ""}. Następny wpis narzędzia Lovable dostanie when = chwilę wdrożenia, mniejsze od tego, i migrator pominie go po cichu. Uruchom generator ponownie za ${Math.ceil((when - now) / 1000)} s albo wyjaśnij when z przyszłości w dzienniku.`,
      });
    }
    const content = mirrorHeader(file) + sql;
    const snapshot = { ...prev, id: mirrorSnapshotId(tag, file), prevId: prev.id };
    prev = snapshot;
    added.push({ idx, version, when, tag, breakpoints: true });
    mirrors.push({ idx, tag, when, source: file, bytes: utf8Length(content) });
    sqlWrites.push({ path: drizzlePath(tag), content });
    snapshotWrites.push({ path: snapshotPath(idx), content: snapshotText(snapshot) });
  });
  return { added, mirrors, sqlWrites, snapshotWrites, errors };
}

/** Do usunięcia: lustra spoza końcowego dziennika (sieroty generatora) i snapshoty za jego końcem. */
function orphanPaths(
  input: MirrorInput,
  finalEntries: readonly JournalEntry[],
  read: ReadFile,
): string[] {
  const finalTags = new Set(finalEntries.map((e) => e.tag));
  return [
    ...input.drizzleSql
      .map((name) => name.replace(/\.sql$/, ""))
      .filter((tag) => !finalTags.has(tag) && mirrorSourceOf(read(drizzlePath(tag))) !== null)
      .map(drizzlePath),
    ...input.snapshots
      .filter((name) => Number(SNAPSHOT_RE.exec(name)?.[1] ?? -1) > finalEntries.length - 1)
      .map((name) => `${DRIZZLE_META_DIR}/${name}`),
  ].sort();
}

/**
 * Plan lustra: co dopisać, przepisać i usunąć w `drizzle/`, żeby dziennik niósł
 * każdą migrację supabase bez decyzji w SUPABASE_LANE_GAPS. Czysty
 * i deterministyczny - nie czyta zegara (`now` tylko pilnuje), więc plan po
 * zastosowaniu jest pusty.
 */
export function planMirror(input: MirrorInput): MirrorPlan {
  const read = memoRead(input.read);
  const base = input.base ?? null;
  const journalProblem = journalIssue(input.journal, base);
  if (journalProblem !== null) return blocked(journalProblem);
  const current = input.journal.entries;
  const generated = generatedMirrors(current, read);
  const keptCount = keptPrefix(current, generated, base);
  if (typeof keptCount !== "number") return blocked(keptCount);
  const kept = current.slice(0, keptCount);
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES;
  const rewrite = input.rewrite ?? new Set<string>();

  const requests = rewriteRequestLint(
    rewrite,
    current,
    generated,
    new Set(kept.map((e) => e.tag)),
    base,
  );
  const review = reviewBaseMirrors(kept, generated, rewrite, read, maxBytes);
  const { candidates, carriedBefore } = mirrorCandidates(
    input,
    kept,
    (path) => review.overlay.get(path) ?? read(path),
    review.drifted,
  );
  const linted = lintCandidates(candidates, carriedBefore, read, maxBytes, input.now);
  const parent = parentSnapshot(input.snapshots, kept.at(-1)?.idx ?? -1, read) ?? DRY_SNAPSHOT;
  const appended = appendMirrors(kept, linted.sources, parent, input.now);

  const finalEntries = [...kept, ...appended.added];
  const journalChanged =
    finalEntries.length !== current.length ||
    finalEntries.some((e, k) => !sameEntry(current[k], e));
  const journalWrites: FileWrite[] = journalChanged
    ? [{ path: DRIZZLE_JOURNAL, content: journalText({ ...input.journal, entries: finalEntries }) }]
    : [];
  const deletions = orphanPaths(input, finalEntries, read);
  const finalSnapshots = new Set([
    ...input.snapshots.filter((name) => !deletions.includes(`${DRIZZLE_META_DIR}/${name}`)),
    ...appended.snapshotWrites.map((w) => w.path.slice(DRIZZLE_META_DIR.length + 1)),
  ]);
  const errors = [
    ...missingFileIssues(current, read),
    ...requests.errors,
    ...review.errors,
    ...linted.errors,
    ...appended.errors,
    ...snapshotIssues(
      [...finalSnapshots],
      new Map(appended.snapshotWrites.map((w) => [w.path, w.content])),
      read,
    ),
  ];
  const warnings = [...requests.warnings, ...review.warnings, ...linted.warnings];

  const files = [
    ...[...review.overlay].map(([path, content]) => ({ path, content })),
    ...appended.sqlWrites,
    ...appended.snapshotWrites,
    ...journalWrites,
  ].filter((w) => read(w.path) !== w.content);
  const touched = new Set(files.map((w) => w.path));
  const entries = appended.mirrors.filter(
    (m, k) =>
      touched.has(drizzlePath(m.tag)) ||
      touched.has(snapshotPath(m.idx)) ||
      !sameEntry(current[m.idx], appended.added[k]!),
  );
  const lastCarried =
    [carriedBefore, ...linted.sources.map((s) => s.file)]
      .filter((file): file is string => file !== null)
      .sort()
      .at(-1) ?? null;
  const { rewritten } = review;
  if (errors.length > 0) {
    return {
      entries,
      rewritten,
      files: [],
      deletions: [],
      errors,
      warnings,
      lastCarried,
      deploy: [],
    };
  }
  const baseTags = new Set(base?.entries.map((e) => e.tag));
  const deployed = base === null ? entries : finalEntries.filter((e) => !baseTags.has(e.tag));
  const deploy = [...rewritten, ...deployed]
    .map(({ idx, tag }) => ({ idx, tag }))
    .sort((a, b) => a.idx - b.idx);
  return { entries, rewritten, files, deletions, errors, warnings, lastCarried, deploy };
}

export function mirrorFresh(plan: MirrorPlan): boolean {
  return plan.files.length === 0 && plan.deletions.length === 0 && plan.errors.length === 0;
}

/**
 * Kroki po zapisie lustra - w kolejności. Numery sekcji to
 * docs/RUNBOOK_MIGRACJE_LOVABLE.md (§3.1 sekcja PR, §4 wdrożenie, §5 adopcja).
 */
export const MIRROR_NEXT_STEPS: readonly string[] = [
  "zatwierdź drizzle/ w tym samym commicie co supabase/migrations; plików drizzle nie poprawiasz ręcznie - zła treść = popraw plik supabase i uruchom generator ponownie",
  "bun run generate:authz-snapshot  (snapshot liczy pliki supabase/migrations; inaczej authzSnapshotParity.test jest czerwony)",
  "bun run check:migration-lanes  (lustra jako zapisy wdrożenia, pokrycie pasa supabase, lustro aktualne; wpis-spoza-zrodla = wpis bota Lovable do adopcji wg docs/RUNBOOK_MIGRACJE_LOVABLE.md §5)",
  'linię „Wpisy dziennika do wdrożenia" wklej do sekcji „Wdrożenie bazy" opisu PR (docs/RUNBOOK_MIGRACJE_LOVABLE.md §3.1)',
  `po każdym git merge origin/main: bun run migrations:mirror ponownie (bot Lovable mógł dopisać wpis na main); konflikt dziennika: ${JOURNAL_CONFLICT_FIX}`,
  "po scaleniu produkcję zmienia dopiero wdrożenie - jedno wywołanie narzędzia migracji Lovable z kanonicznym wyzwalaczem (docs/RUNBOOK_MIGRACJE_LOVABLE.md §4); dowód: bun run migrations:deploy-sql -- --verify --from <idx>",
];

/** Linia do sekcji „Wdrożenie bazy" opisu PR (runbook §3.1). */
export function deployLine(deploy: MirrorPlan["deploy"]): string {
  return `Wpisy dziennika do wdrożenia: idx ${deploy[0]!.idx}-${deploy.at(-1)!.idx} (${deploy.map((d) => d.tag).join(", ")})`;
}

function rewriteNotice(r: MirrorRewrite): string {
  return `UWAGA --rewrite ${r.tag} (idx ${r.idx}): wolno WYŁĄCZNIE dla wpisu, którego produkcja NIE zapisała w drizzle.__drizzle_migrations (docs/RUNBOOK_MIGRACJE_LOVABLE.md §6.3). Przed scaleniem wykonaj tylko do odczytu SQL z \`bun run migrations:deploy-sql -- --verify --from ${r.idx} --to ${r.idx}\` - wynik musi zgłosić „brak w rejestrze"; wpis już zapisany = cofnij przepisanie i dodaj NOWĄ migrację.`;
}

/** Raport planu; w zapisie i podglądzie także uwagi `--rewrite` i linia do opisu PR. */
export function renderMirrorPlan(plan: MirrorPlan, mode: MirrorMode): string {
  const lines: string[] = [];
  if (mirrorFresh(plan)) {
    lines.push(
      `✓ Lustro drizzle aktualne: każda migracja ${SUPABASE_MIGRATIONS_DIR} od ${DRIZZLE_LANE_START} ma kopię w dzienniku albo decyzję w SUPABASE_LANE_GAPS (ostatnia niesiona: ${plan.lastCarried ?? "brak"}).`,
    );
  } else {
    const counts = `wpisy do wygenerowania: ${plan.entries.length}, do przepisania: ${plan.rewritten.length}, pliki do usunięcia: ${plan.deletions.length}, błędy: ${plan.errors.length}`;
    lines.push(
      plan.errors.length > 0
        ? `✗ Lustro drizzle: plan ma błędy - generator niczego nie zapisze, dopóki ich nie usuniesz (${counts}):`
        : mode === "check"
          ? `✗ Lustro drizzle NIEAKTUALNE (${counts}):`
          : `Lustro drizzle do aktualizacji (${counts}):`,
    );
    for (const e of plan.entries)
      lines.push(`  + ${e.tag} <- ${supabasePath(e.source)} (when ${e.when}, ${e.bytes} B)`);
    for (const r of plan.rewritten)
      lines.push(
        `  ~ ${r.tag} <- ${supabasePath(r.source)} (--rewrite: idx, when i snapshot bez zmian, ${r.bytes} B)`,
      );
    for (const path of plan.deletions)
      lines.push(
        `  - ${path} (${path.endsWith("_snapshot.json") ? "snapshot za ostatnim wpisem dziennika" : "osierocony plik generatora"})`,
      );
    for (const e of plan.errors) lines.push(`  [${e.kind}] ${e.path}: ${e.detail}`);
    if (mode === "check" && plan.errors.length === 0)
      lines.push(
        "Naprawa: bun run migrations:mirror - i zatwierdź drizzle/ razem z migracją supabase (plików drizzle nie piszesz ręcznie).",
      );
  }
  for (const w of plan.warnings) lines.push(`UWAGA [${w.kind}] ${w.path}: ${w.detail}`);
  if (mode !== "check" && plan.errors.length === 0) {
    for (const r of plan.rewritten) lines.push(rewriteNotice(r));
    if (plan.deploy.length > 0)
      lines.push('Do sekcji „Wdrożenie bazy" opisu PR:', deployLine(plan.deploy));
  }
  return lines.join("\n");
}
