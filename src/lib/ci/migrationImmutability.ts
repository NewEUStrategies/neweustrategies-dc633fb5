// Bramka niezmienności migracji: plik migracji, który istnieje w bazie
// porównania, nie znika i nie zmienia treści, a dziennik drizzle rośnie
// wyłącznie przez dopisywanie wpisów na końcu.
//
// DLACZEGO. Produkcja wykonuje `drizzle/migrations/meta/_journal.json`
// migratorem Drizzle: wpis wykonany raz trafia do `drizzle.__drizzle_migrations`
// i nikt go już nie czyta. Edycja takiego pliku nie zmienia bazy - zmienia
// tylko to, co repozytorium twierdzi o bazie, a CI od tej chwili testuje SQL,
// którego produkcja nie wykonała. Usunięcie pliku (rewert bota Lovable) nie
// cofa zmiany w bazie, a gubi jej jedyny zapis. Zmiana `when`, kolejności albo
// usunięcie wpisu dziennika przestawia to, co migrator uzna za oczekujące:
// wpis pominięty po cichu albo wykonany drugi raz. Pas `supabase/migrations`
// jest źródłem prawdy, z którego `bun run migrations:mirror` generuje lustro
// drizzle, więc ta sama zasada obowiązuje oba pasy i snapshoty.
//
// CO SPRAWDZA. Diff dwóch drzew: baza porównania -> HEAD (commity; zmiany
// niezatwierdzone się nie liczą), wyłącznie `supabase/migrations/*.sql`,
// `drizzle/migrations/*.sql`, `drizzle/migrations/meta/*_snapshot.json`
// i `_journal.json`. Nowe pliki przechodzą - pilnują ich bramki pasów
// i lustra. Plik istniejący w bazie, a w HEAD usunięty albo zmieniony,
// czerwieni CI. Dziennik porównujemy po sparsowaniu (formatowanie się nie
// liczy): nagłówek bez zmian, każdy dawny wpis z identycznymi polami (`idx`,
// `version`, `when`, `tag`, `breakpoints`), dawne wpisy w dawnej kolejności,
// nowe wyłącznie za nimi.
//
// WYJĄTKI. Forward-only ma jeden prawomocny wyjątek (runbook §6.3): wpis
// scalony, ale NIEWDROŻONY (`bun run migrations:deploy-sql -- --verify` daje
// „brak w rejestrze"), wolno poprawić w miejscu przez `bun run
// migrations:mirror --rewrite <tag>`. Bot Lovable też poprawiał niewdrożone
// wpisy w miejscu (30ff38a1e: 0367 i jego źródło, 9f6173f2a: plik i `when`
// 0312) i usuwał sieroty (08d183bd0: 0305/0306). Reguła bez wyjątków nie
// przetrwałaby pierwszego takiego przypadku, więc każdy wyjątek to wpis
// MIGRATION_EDIT_ALLOWLIST: ścieżka, rodzaj, powód i SHA bloba PO zmianie
// (przy usunięciu - SHA USUNIĘTEJ treści, `blobBefore`). SHA wiąże wpis z jedną
// konkretną treścią: po scaleniu wpis jest martwy i nie otwiera furtki dla
// następnej edycji ani następnego usunięcia tej samej ścieżki, więc nie trzeba
// go sprzątać, a rejestr zostaje historią świadomych wyjątków.
//
// BAZA PORÓWNANIA. `MIGRATION_IMMUTABILITY_BASE` (CI: SHA bazy PR, a na main
// ostatni commit, na którym bramka przeszła - patrz niżej), a bez niej `git
// merge-base HEAD origin/main`. Pierwszy push gałęzi (SHA z samych zer) też
// idzie przez merge-base. Gdy klon nie ma commitu bazy, bramka lokalnie drukuje
// ostrzeżenie i przechodzi - nie udaje porównania z czymś innym niż ta baza;
// z `MIGRATION_IMMUTABILITY_REQUIRE_BASE=1` (CI: PR i main) to błąd, bo pominięte
// porównanie wyglądałoby jak zielone.
//
// PUSH NA MAIN. Commit bota trafia na main bez PR-a. Porównanie z
// `github.event.before` byłoby alarmem jednego przebiegu (następny push
// porównuje się już z commitem bota), a przebieg anulowany przez nowszy push
// (concurrency) nie zgłosiłby niczego. Dlatego na main bazą jest ostatni commit,
// na którym ta bramka PRZESZŁA (CI zapamiętuje go po zielonym przebiegu):
// czerwień trwa przy każdym kolejnym pushu, aż naprawa trafi na main, a pominięty
// albo anulowany przebieg niczego nie przesuwa. Naprawa idzie PR-em: usunięty
// plik wraca z tą samą treścią (porównanie z bazą nie widzi wtedy zmiany),
// a świadomy wyjątek dostaje wpis rejestru.
//
// Warstwa czysta (parser diffu, klasyfikacja, dziennik, rejestr, wybór bazy,
// raport); git siedzi w `scripts/check-migration-immutability.ts`.
import { DRIZZLE_DIR, SUPABASE_DIR } from "./migrationLaneParity";

export const IMMUTABILITY_BASE_ENV = "MIGRATION_IMMUTABILITY_BASE";
export const IMMUTABILITY_FALLBACK_REF = "origin/main";
export const MIGRATION_JOURNAL_PATH = `${DRIZZLE_DIR}/meta/_journal.json`;

const SUPABASE_SQL = new RegExp(`^${SUPABASE_DIR}/[^/]+\\.sql$`);
const DRIZZLE_SQL = new RegExp(`^${DRIZZLE_DIR}/[^/]+\\.sql$`);
const DRIZZLE_SNAPSHOT = new RegExp(`^${DRIZZLE_DIR}/meta/[^/]+_snapshot\\.json$`);
// Obiekt gita: SHA-1 (40 znaków) albo SHA-256 (64) - zależnie od formatu repozytorium.
const OBJECT_SHA = "[0-9a-f]{40}(?:[0-9a-f]{24})?";
const BLOB_SHA = new RegExp(`^${OBJECT_SHA}$`);
const ZERO_SHA = /^0+$/;

export type GuardedMigrationPath =
  "supabase-sql" | "drizzle-sql" | "drizzle-snapshot" | "drizzle-journal";

/** Rodzaj pilnowanego pliku albo `null` dla ścieżki spoza bramki. */
export function guardedMigrationPath(path: string): GuardedMigrationPath | null {
  if (path === MIGRATION_JOURNAL_PATH) return "drizzle-journal";
  if (SUPABASE_SQL.test(path)) return "supabase-sql";
  if (DRIZZLE_SQL.test(path)) return "drizzle-sql";
  if (DRIZZLE_SNAPSHOT.test(path)) return "drizzle-snapshot";
  return null;
}

/**
 * `rewrite-unapplied` - jedyny wyjątek forward-only (runbook §6.3): wpis
 * scalony, a `migrations:deploy-sql -- --verify` dowodzi, że produkcja go nie
 * wykonała; `bot-pending-fix` - bot Lovable poprawił w miejscu wpis jeszcze
 * niewdrożony; `other` - wszystko inne, z pełnym uzasadnieniem w `reason`.
 */
export type MigrationEditKind = "rewrite-unapplied" | "bot-pending-fix" | "other";

export interface MigrationEditAllowance {
  /** Ścieżka względem korzenia repozytorium. */
  readonly path: string;
  readonly kind: MigrationEditKind;
  /** Co się zmieniło, dlaczego i jaki jest dowód (np. wynik `--verify`). */
  readonly reason: string;
  /**
   * SHA bloba pliku PO zmianie (`git hash-object <ścieżka>`; raport bramki
   * drukuje gotowy wpis), `null` = zgoda na usunięcie.
   */
  readonly blobAfter: string | null;
  /**
   * Wyłącznie przy usunięciu (`blobAfter: null`): SHA bloba USUWANEJ treści
   * (raport bramki drukuje gotowy wpis). Ta sama ścieżka dodana później z inną
   * treścią i znowu usunięta nie przejdzie po starej zgodzie.
   */
  readonly blobBefore?: string;
}

/**
 * Rejestr świadomych wyjątków od niezmienności. Każdy wpis to zdanie, które
 * ktoś musi napisać i obronić w przeglądzie PR - nie domyślne zachowanie.
 * Wpisy zostają po scaleniu jako historia (SHA wygasza je same).
 */
export const MIGRATION_EDIT_ALLOWLIST: readonly MigrationEditAllowance[] = [];

/** Błędy rejestru - każdy czerwieni bramkę. */
export function allowlistErrors(list: readonly MigrationEditAllowance[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const entry of list) {
    const guarded = guardedMigrationPath(entry.path);
    const where = `${entry.path} [${entry.kind}]`;
    if (guarded === null) {
      errors.push(`${where}: ścieżka spoza plików pilnowanych przez bramkę`);
    }
    if (entry.reason.trim() === "") errors.push(`${where}: pusty powód`);
    if (entry.blobAfter !== null && !BLOB_SHA.test(entry.blobAfter)) {
      errors.push(`${where}: blobAfter musi być pełnym SHA bloba (git hash-object) albo null`);
    }
    if (entry.blobAfter === null && !BLOB_SHA.test(entry.blobBefore ?? "")) {
      errors.push(
        `${where}: zgoda na usunięcie (blobAfter: null) wymaga blobBefore - pełnego SHA bloba usuwanej treści, inaczej otwierałaby każde przyszłe usunięcie tej ścieżki`,
      );
    }
    if (entry.blobAfter !== null && entry.blobBefore !== undefined) {
      errors.push(`${where}: blobBefore dotyczy wyłącznie usunięcia (blobAfter: null)`);
    }
    if (
      entry.kind === "rewrite-unapplied" &&
      (entry.blobAfter === null || (guarded !== "supabase-sql" && guarded !== "drizzle-sql"))
    ) {
      errors.push(
        `${where}: rewrite-unapplied zmienia treść pliku .sql (migrations:mirror --rewrite) - nie usuwa plików i nie dotyka dziennika ani snapshotów`,
      );
    }
    const key = allowanceKey(entry.path, entry.blobAfter, entry.blobBefore);
    if (seen.has(key)) errors.push(`${where}: zdublowany wpis tej samej zmiany`);
    seen.add(key);
  }
  return errors;
}

/** Klucz zmiany: treść po zmianie, a przy usunięciu - usunięta treść. */
function allowanceKey(path: string, blobAfter: string | null, blobBefore?: string | null): string {
  return blobAfter === null ? `${path}\0usuniety\0${blobBefore ?? ""}` : `${path}\0${blobAfter}`;
}

/** Zmiana jednej ścieżki między bazą a HEAD; SHA to bloby gita. */
export type MigrationDiffEntry =
  | { readonly change: "added"; readonly path: string; readonly blobAfter: string }
  | { readonly change: "deleted"; readonly path: string; readonly blobBefore: string }
  | {
      readonly change: "modified";
      readonly path: string;
      readonly blobBefore: string;
      readonly blobAfter: string;
    };

const RAW_META = new RegExp(`^:\\d{6} \\d{6} (${OBJECT_SHA}) (${OBJECT_SHA}) ([A-Z])\\d*$`);

/**
 * Parser `git diff --raw -z --no-renames --no-abbrev <baza> <head>`: pary pól
 * `:<tryb> <tryb> <sha> <sha> <status>` i ścieżka. Zmiana typu pliku (`T`) to
 * zmiana istniejącego pliku. Zmiana nazwy albo kopia to błąd wywołania: bez
 * `--no-renames` usunięcie starej ścieżki zniknęłoby z diffu.
 */
export function parseRawDiff(raw: string): MigrationDiffEntry[] {
  const fields = raw.split("\0");
  if (fields.at(-1) === "") fields.pop();
  const entries: MigrationDiffEntry[] = [];
  for (let i = 0; i < fields.length; i += 2) {
    const meta = RAW_META.exec(fields[i]);
    if (meta === null) {
      throw new Error(`nieoczekiwane pole git diff --raw: ${JSON.stringify(fields[i])}`);
    }
    const [, before, after, status] = meta;
    if (status === "R" || status === "C") {
      throw new Error(
        `zmiana nazwy albo kopia w diffie (${status}) - wywołaj git diff z --no-renames`,
      );
    }
    const path = fields[i + 1];
    if (path === undefined || path === "") {
      throw new Error(`wpis git diff --raw bez ścieżki: ${JSON.stringify(fields[i])}`);
    }
    if (status === "A" && ZERO_SHA.test(before)) {
      entries.push({ change: "added", path, blobAfter: after });
    } else if (status === "D" && ZERO_SHA.test(after)) {
      entries.push({ change: "deleted", path, blobBefore: before });
    } else if (
      (status === "M" || status === "T") &&
      !ZERO_SHA.test(before) &&
      !ZERO_SHA.test(after)
    ) {
      entries.push({ change: "modified", path, blobBefore: before, blobAfter: after });
    } else {
      throw new Error(`nieobsługiwany status git diff --raw: ${JSON.stringify(fields[i])}`);
    }
  }
  return entries;
}

export type ImmutabilityViolationKind =
  | "plik-usuniety"
  | "plik-zmieniony"
  | "dziennik-usuniety"
  | "dziennik-nieczytelny"
  | "dziennik-naglowek"
  | "wpis-usuniety"
  | "wpis-zmieniony"
  | "wpis-przestawiony"
  | "wpis-wstawiony";

export interface ImmutabilityViolation {
  readonly kind: ImmutabilityViolationKind;
  readonly path: string;
  /** SHA bloba w HEAD (`null` = plik usunięty) - wartość do wpisu rejestru. */
  readonly blobAfter: string | null;
  /** Przy usunięciu: SHA bloba usuniętej treści (do wpisu rejestru); inaczej `null`. */
  readonly blobBefore: string | null;
  readonly detail: string;
}

export interface ImmutabilityReport {
  /** Nowe pliki migracji - poza zakresem tej bramki. */
  readonly added: readonly string[];
  /** Tagi dopisane na końcu dziennika. */
  readonly appendedEntries: readonly string[];
  readonly violations: readonly ImmutabilityViolation[];
  /** Wpisy rejestru, które dopuściły zmianę w tym porównaniu. */
  readonly allowed: readonly MigrationEditAllowance[];
  readonly registryErrors: readonly string[];
}

type JournalRecord = Readonly<Record<string, unknown>>;

interface ParsedJournal {
  readonly header: JournalRecord;
  readonly entries: readonly JournalRecord[];
  readonly tags: readonly string[];
}

type JournalParse =
  | { readonly ok: true; readonly journal: ParsedJournal }
  | { readonly ok: false; readonly error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJournal(text: string): JournalParse {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: `niepoprawny JSON (${(error as Error).message})` };
  }
  if (!isRecord(value)) return { ok: false, error: "korzeń nie jest obiektem" };
  const { entries, ...header } = value;
  if (!Array.isArray(entries)) return { ok: false, error: "brak tablicy `entries`" };
  const records: JournalRecord[] = [];
  for (const [position, entry] of entries.entries()) {
    if (!isRecord(entry) || typeof entry.tag !== "string") {
      return { ok: false, error: `wpis na pozycji ${position} bez tekstowego \`tag\`` };
    }
    records.push(entry);
  }
  return {
    ok: true,
    journal: { header, entries: records, tags: records.map((e) => e.tag as string) },
  };
}

/** JSON z kluczami obiektów w stałej kolejności - porównanie wartości, nie zapisu. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  }
  return value === undefined ? "brak" : JSON.stringify(value);
}

/** Pola różniące dwa rekordy jako `pole stara -> nowa` (pole nieobecne = `brak`). */
function changedFields(before: JournalRecord, after: JournalRecord): string[] {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return keys
    .filter((k) => canonicalJson(before[k]) !== canonicalJson(after[k]))
    .map((k) => `${k} ${canonicalJson(before[k])} -> ${canonicalJson(after[k])}`);
}

interface JournalProblem {
  readonly kind: ImmutabilityViolationKind;
  readonly detail: string;
}

interface JournalComparison {
  readonly appended: readonly string[];
  readonly problems: readonly JournalProblem[];
}

function compareJournals(baseText: string, headText: string): JournalComparison {
  const base = parseJournal(baseText);
  const head = parseJournal(headText);
  if (!base.ok || !head.ok) {
    const problems: JournalProblem[] = [];
    if (!base.ok) problems.push({ kind: "dziennik-nieczytelny", detail: `baza: ${base.error}` });
    if (!head.ok) problems.push({ kind: "dziennik-nieczytelny", detail: `HEAD: ${head.error}` });
    return { appended: [], problems };
  }
  const problems: JournalProblem[] = [];
  const header = changedFields(base.journal.header, head.journal.header);
  if (header.length > 0) problems.push({ kind: "dziennik-naglowek", detail: header.join(", ") });

  const baseTags = new Set(base.journal.tags);
  const headTags = new Set(head.journal.tags);
  for (const entry of base.journal.entries) {
    const tag = entry.tag as string;
    const now = head.journal.entries.find((e) => e.tag === tag);
    if (now === undefined) {
      problems.push({
        kind: "wpis-usuniety",
        detail: `${tag}: wpis zniknął z dziennika - migrator traci plik, a baza produkcji zostaje ze zmianą`,
      });
      continue;
    }
    const fields = changedFields(entry, now);
    if (fields.length > 0)
      problems.push({ kind: "wpis-zmieniony", detail: `${tag}: ${fields.join(", ")}` });
  }

  const keptInHeadOrder = head.journal.tags.filter((t) => baseTags.has(t));
  const keptInBaseOrder = base.journal.tags.filter((t) => headTags.has(t));
  const longest = Math.max(keptInHeadOrder.length, keptInBaseOrder.length);
  const at = Array.from({ length: longest }, (_, i) => i).find(
    (i) => keptInHeadOrder[i] !== keptInBaseOrder[i],
  );
  if (at !== undefined) {
    problems.push({
      kind: "wpis-przestawiony",
      detail: `kolejność dawnych wpisów zmieniona od pozycji ${at}: oczekiwany ${keptInBaseOrder[at] ?? "koniec"}, jest ${keptInHeadOrder[at] ?? "koniec"}`,
    });
  }

  const lastOld = head.journal.tags.reduce((last, t, i) => (baseTags.has(t) ? i : last), -1);
  const fresh = head.journal.tags
    .map((tag, i) => ({ tag, i }))
    .filter(({ tag }) => !baseTags.has(tag));
  for (const { tag } of fresh.filter(({ i }) => i < lastOld)) {
    problems.push({
      kind: "wpis-wstawiony",
      detail: `${tag}: nowy wpis przed ostatnim dawnym wpisem - dopisuj wyłącznie na końcu dziennika`,
    });
  }
  return { appended: fresh.filter(({ i }) => i > lastOld).map(({ tag }) => tag), problems };
}

/**
 * Klasyfikacja diffu baza -> HEAD. Rejestr konsultujemy tylko wtedy, gdy jest
 * co usprawiedliwić: dopisany dziennik albo nowy plik nie zużywa wpisu.
 */
export function analyzeMigrationImmutability(
  diff: readonly MigrationDiffEntry[],
  readBlob: (sha: string) => string,
  allowlist: readonly MigrationEditAllowance[] = MIGRATION_EDIT_ALLOWLIST,
): ImmutabilityReport {
  const allowances = new Map(
    allowlist.map((a) => [allowanceKey(a.path, a.blobAfter, a.blobBefore), a]),
  );
  const added: string[] = [];
  const appendedEntries: string[] = [];
  const violations: ImmutabilityViolation[] = [];
  const allowed: MigrationEditAllowance[] = [];

  for (const entry of diff) {
    const guarded = guardedMigrationPath(entry.path);
    if (guarded === null) continue;
    if (entry.change === "added") {
      added.push(entry.path);
      continue;
    }
    const blobAfter = entry.change === "deleted" ? null : entry.blobAfter;
    const blobBefore = entry.change === "deleted" ? entry.blobBefore : null;
    let problems: readonly JournalProblem[];
    if (entry.change === "deleted") {
      problems = [
        guarded === "drizzle-journal"
          ? { kind: "dziennik-usuniety", detail: "plik dziennika usunięty" }
          : { kind: "plik-usuniety", detail: "plik usunięty" },
      ];
    } else if (guarded === "drizzle-journal") {
      const comparison = compareJournals(readBlob(entry.blobBefore), readBlob(entry.blobAfter));
      appendedEntries.push(...comparison.appended);
      problems = comparison.problems;
    } else {
      problems = [{ kind: "plik-zmieniony", detail: "treść zmieniona w miejscu" }];
    }
    if (problems.length === 0) continue;
    const allowance = allowances.get(allowanceKey(entry.path, blobAfter, blobBefore));
    if (allowance !== undefined) {
      allowed.push(allowance);
      continue;
    }
    for (const p of problems) violations.push({ ...p, path: entry.path, blobAfter, blobBefore });
  }

  return {
    added,
    appendedEntries,
    violations,
    allowed,
    registryErrors: allowlistErrors(allowlist),
  };
}

export function immutabilityFailed(report: ImmutabilityReport): boolean {
  return report.violations.length > 0 || report.registryErrors.length > 0;
}

/** Sondy gita wstrzykiwane przez runner - tu bez IO. */
export interface GitBaseProbe {
  /** Pełny SHA commitu dla refa albo `null`, gdy klon go nie ma. */
  readonly resolveCommit: (ref: string) => string | null;
  /** `git merge-base HEAD origin/main` albo `null` (brak refa, płytki klon). */
  readonly mergeBaseWithMain: () => string | null;
}

export type ImmutabilityBase =
  | { readonly kind: "base"; readonly sha: string; readonly source: string }
  | { readonly kind: "unavailable"; readonly reason: string };

const MERGE_BASE_SOURCE = `merge-base HEAD ${IMMUTABILITY_FALLBACK_REF}`;

/** Wybór bazy porównania: jawna zmienna, potem merge-base z main, inaczej brak. */
export function resolveImmutabilityBase(
  envValue: string | undefined,
  probe: GitBaseProbe,
): ImmutabilityBase {
  const requested = envValue?.trim() ?? "";
  const firstPush = requested !== "" && ZERO_SHA.test(requested);
  if (requested !== "" && !firstPush) {
    const sha = probe.resolveCommit(requested);
    return sha !== null
      ? { kind: "base", sha, source: IMMUTABILITY_BASE_ENV }
      : {
          kind: "unavailable",
          reason: `commit bazy ${requested} (${IMMUTABILITY_BASE_ENV}) nie istnieje w klonie - płytki klon? CI musi go pobrać przed bramką: git fetch --no-tags --depth=1 origin ${requested}`,
        };
  }
  const mergeBase = probe.mergeBaseWithMain();
  const context = firstPush ? `pierwszy push gałęzi - ${IMMUTABILITY_BASE_ENV} z samych zer` : null;
  if (mergeBase !== null) {
    return {
      kind: "base",
      sha: mergeBase,
      source: context === null ? MERGE_BASE_SOURCE : `${MERGE_BASE_SOURCE}, ${context}`,
    };
  }
  return {
    kind: "unavailable",
    reason: `${context ?? `brak ${IMMUTABILITY_BASE_ENV}`} i brak ${MERGE_BASE_SOURCE} (nie ma ${IMMUTABILITY_FALLBACK_REF} albo klon jest płytki)`,
  };
}

export interface ImmutabilityRange {
  readonly base: string;
  readonly source: string;
  readonly head: string;
}

const VIOLATION_SECTIONS: readonly (readonly [
  string,
  (k: ImmutabilityViolationKind) => boolean,
])[] = [
  [
    "USUNIĘTE PLIKI MIGRACJI - plik znika, a zmiana w bazie produkcji zostaje",
    (k) => k === "plik-usuniety",
  ],
  [
    "ZMIENIONE PLIKI MIGRACJI - produkcja wykonała albo wykona inną treść niż ta w repozytorium",
    (k) => k === "plik-zmieniony",
  ],
  [
    `DZIENNIK ${MIGRATION_JOURNAL_PATH} - wolno wyłącznie dopisywać wpisy na końcu`,
    (k) => k.startsWith("dziennik-") || k.startsWith("wpis-"),
  ],
];

function allowanceLiteral(v: ImmutabilityViolation): string {
  const blob =
    v.blobAfter === null
      ? `null, blobBefore: ${JSON.stringify(v.blobBefore)}`
      : JSON.stringify(v.blobAfter);
  return `{ path: ${JSON.stringify(v.path)}, kind: "other", reason: "", blobAfter: ${blob} },`;
}

export function renderImmutabilityReport(
  report: ImmutabilityReport,
  range: ImmutabilityRange,
): string {
  const failed = immutabilityFailed(report);
  const lines = [
    `${failed ? "✗" : "✓"} Niezmienność migracji: baza ${range.base.slice(0, 8)} (${range.source}) -> HEAD ${range.head.slice(0, 8)}; nowe pliki migracji: ${report.added.length}, dopisane wpisy dziennika: ${report.appendedEntries.length}, wyjątki z rejestru: ${report.allowed.length}, naruszenia: ${report.violations.length}.`,
  ];
  if (report.allowed.length > 0) {
    lines.push(`ZMIANY DOPUSZCZONE REJESTREM MIGRATION_EDIT_ALLOWLIST (${report.allowed.length}):`);
    for (const a of report.allowed) {
      lines.push(
        `  [${a.kind}] ${a.path} (${a.blobAfter === null ? "usunięty" : "zmieniony"}): ${a.reason}`,
      );
    }
  }
  for (const [label, matches] of VIOLATION_SECTIONS) {
    const list = report.violations.filter((v) => matches(v.kind));
    if (list.length === 0) continue;
    lines.push(`${label} (${list.length}):`);
    for (const v of list) {
      lines.push(v.kind.startsWith("plik-") ? `  ${v.path}` : `  [${v.kind}] ${v.detail}`);
    }
  }
  if (report.registryErrors.length > 0) {
    lines.push(`BŁĘDNE WPISY MIGRATION_EDIT_ALLOWLIST (${report.registryErrors.length}):`);
    for (const e of report.registryErrors) lines.push(`  ${e}`);
  }
  if (report.violations.length === 0) return lines.join("\n");

  const base = range.base.slice(0, 12);
  const files = report.violations.filter((v) => v.kind.startsWith("plik-")).map((v) => v.path);
  const pasteable = new Map(
    report.violations.map((v) => [allowanceKey(v.path, v.blobAfter, v.blobBefore), v]),
  );
  lines.push("Naprawa:");
  if (files.length > 0) {
    lines.push(`  - przywróć pliki z bazy: git checkout ${base} -- ${files.join(" ")}`);
  }
  if (files.length < report.violations.length) {
    lines.push(
      `  - przywróć dawne wpisy dziennika, a własne wygeneruj na końcu: git checkout ${base} -- ${DRIZZLE_DIR}/meta && bun run migrations:mirror`,
    );
  }
  lines.push(
    `  - zmiana schematu to NOWA migracja w ${SUPABASE_DIR}, potem bun run migrations:mirror; scalonych plików i wpisów się nie poprawia.`,
    "  - wyjątek tylko świadomie, w przeglądzie PR: wpis MIGRATION_EDIT_ALLOWLIST w src/lib/ci/migrationImmutability.ts (uzupełnij kind i reason):",
    ...[...pasteable.values()].map((v) => `      ${allowanceLiteral(v)}`),
    "    rewrite-unapplied: wyłącznie wpis, dla którego `bun run migrations:deploy-sql -- --verify --from <idx> --to <idx>` daje „brak w rejestrze” (docs/RUNBOOK_MIGRACJE_LOVABLE.md §6.3, bun run migrations:mirror --rewrite <tag>);",
    "    bot-pending-fix: poprawka bota Lovable we wpisie jeszcze niewdrożonym; other: pełny powód w reason.",
  );
  return lines.join("\n");
}

/** `MIGRATION_IMMUTABILITY_REQUIRE_BASE=1` (CI: PR i main): brak bazy to błąd, nie ostrzeżenie. */
export const IMMUTABILITY_REQUIRE_BASE_ENV = "MIGRATION_IMMUTABILITY_REQUIRE_BASE";

export function immutabilityBaseRequired(envValue: string | undefined): boolean {
  return envValue?.trim() === "1";
}

export function renderImmutabilitySkipped(reason: string, required = false): string {
  return [
    required
      ? `✗ Niezmienność migracji: BEZ PORÓWNANIA - ${reason}.`
      : `⚠ Niezmienność migracji: POMINIĘTA - ${reason}.`,
    `  Bramka niczego nie porównała. W CI ${IMMUTABILITY_BASE_ENV} = SHA bazy PR albo (na main) ostatni commit z zieloną bramką, a commit bazy musi być w klonie (git fetch --no-tags --depth=1 origin <sha>).`,
    ...(required
      ? [
          `  ${IMMUTABILITY_REQUIRE_BASE_ENV}=1: pominięte porównanie wyglądałoby jak zielone, więc to błąd - pobierz commit bazy i uruchom ponownie.`,
        ]
      : []),
  ].join("\n");
}
