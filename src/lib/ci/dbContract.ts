import { splitSqlStatements } from "./authzGates";
import { replayLiveColumns } from "./generatedTypesFreshness";
// Kontrakt schematu bazy dla bramki CI "po każdym wdrożeniu".
//
// Migracje są forward-only, więc oczekiwany stan bazy = wszystkie obiekty
// utworzone w migracjach MINUS te, które później zostały usunięte lub
// przemianowane. Ten moduł jest CZYSTY (bez I/O, bez sieci) - skrypt
// scripts/check-db-contract.ts dokłada odczyt plików i sondowanie PostgREST,
// dzięki czemu cała logika parsowania jest testowalna jednostkowo.
export type DbObjectKind = "table" | "view" | "function";

export interface DbObject {
  readonly kind: DbObjectKind;
  /** Nazwa bez schematu (kontrakt dotyczy wyłącznie schematu `public`). */
  readonly name: string;
  /** Plik migracji, w którym obiekt pojawił się po raz ostatni. */
  readonly file: string;
}

export interface MigrationFile {
  readonly file: string;
  readonly sql: string;
}

export interface ExpectedContract {
  readonly tables: readonly DbObject[];
  readonly views: readonly DbObject[];
  readonly functions: readonly DbObject[];
}

/** Wynik sondy pojedynczego obiektu przez Data API. */
export type ProbeVerdict = "present" | "missing" | "inconclusive";

const PUBLIC_PREFIX = /^public\./;

function normalizeName(raw: string): string | null {
  const cleaned = raw.replace(/"/g, "").trim().toLowerCase();
  // Kontrakt obejmuje tylko schemat public (auth/storage/realtime są zarządzane).
  if (cleaned.includes(".") && !PUBLIC_PREFIX.test(cleaned)) return null;
  const name = cleaned.replace(PUBLIC_PREFIX, "");
  return /^[a-z0-9_]+$/.test(name) ? name : null;
}

/**
 * Funkcje wyzwalaczy (RETURNS trigger) NIE są wystawiane przez PostgREST,
 * więc nie da się ich sondować przez Data API - wypadają z kontraktu.
 */
function returnsTrigger(sqlAfterSignature: string): boolean {
  return /\breturns\s+trigger\b/i.test(sqlAfterSignature.slice(0, 400));
}

/**
 * Buduje oczekiwany zbiór obiektów `public` ze wszystkich migracji
 * (posortowanych chronologicznie - kolejność wejścia jest kolejnością stosowania).
 */
export function extractExpectedContract(files: readonly MigrationFile[]): ExpectedContract {
  const tables = new Map<string, DbObject>();
  const views = new Map<string, DbObject>();
  const functions = new Map<string, DbObject>();

  const createTable = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_."]+)/gi;
  const createView =
    /CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_."]+)/gi;
  const createFn = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([A-Za-z0-9_."]+)\s*\(/gi;
  const dropTable = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([A-Za-z0-9_."]+)/gi;
  const dropView = /DROP\s+(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+EXISTS\s+)?([A-Za-z0-9_."]+)/gi;
  const dropFn = /DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?([A-Za-z0-9_."]+)/gi;
  const renameTable =
    /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([A-Za-z0-9_."]+)\s+RENAME\s+TO\s+([A-Za-z0-9_."]+)/gi;

  const runCreate = (
    re: RegExp,
    sql: string,
    file: string,
    target: Map<string, DbObject>,
    kind: DbObjectKind,
  ) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) {
      const name = normalizeName(m[1]);
      if (name === null) continue;
      if (kind === "function" && returnsTrigger(sql.slice(m.index + m[0].length))) continue;
      target.set(name, { kind, name, file });
    }
  };

  const runDrop = (re: RegExp, sql: string, target: Map<string, DbObject>) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) {
      const name = normalizeName(m[1]);
      if (name !== null) target.delete(name);
    }
  };

  for (const { file, sql: migration } of files) {
    // Preserve DROP/CREATE and RENAME order within one migration.
    for (const sql of splitSqlStatements(migration)) {
      runCreate(createTable, sql, file, tables, "table");
      runCreate(createView, sql, file, views, "view");
      runCreate(createFn, sql, file, functions, "function");
      runDrop(dropTable, sql, tables);
      runDrop(dropView, sql, views);
      runDrop(dropFn, sql, functions);

      renameTable.lastIndex = 0;
      let rename: RegExpExecArray | null;
      while ((rename = renameTable.exec(sql)) !== null) {
        const from = normalizeName(rename[1]);
        const to = normalizeName(rename[2]);
        if (from === null) continue;
        tables.delete(from);
        if (to !== null) tables.set(to, { kind: "table", name: to, file });
      }
    }
  }

  const sorted = (map: Map<string, DbObject>): DbObject[] =>
    [...map.values()].sort((a, b) => a.name.localeCompare(b.name));

  return { tables: sorted(tables), views: sorted(views), functions: sorted(functions) };
}

export interface ContractReport {
  readonly checked: number;
  readonly missing: readonly DbObject[];
  readonly inconclusive: readonly DbObject[];
}

/** Czy raport powinien zablokować CI. */
export function contractFailed(report: ContractReport): boolean {
  return report.checked === 0 || report.missing.length > 0 || report.inconclusive.length > 0;
}

/** Renderuje raport w formacie Markdown (do logu CI / GitHub Step Summary). */
export function renderContractReport(report: ContractReport): string {
  const lines: string[] = [
    "## Kontrakt bazy danych (tabele / widoki / RPC)",
    "",
    `- Sprawdzonych obiektów: **${report.checked}**`,
    `- Brakujących: **${report.missing.length}**`,
    `- Nierozstrzygniętych: **${report.inconclusive.length}**`,
  ];
  if (report.missing.length > 0) {
    lines.push("", "### Brakujące obiekty");
    for (const o of report.missing) lines.push(`- \`${o.kind} ${o.name}\` (migracja: ${o.file})`);
  }
  if (report.inconclusive.length > 0) {
    lines.push("", "### Nierozstrzygnięte (do ręcznego sprawdzenia)");
    for (const o of report.inconclusive) lines.push(`- \`${o.kind} ${o.name}\``);
  }
  return lines.join("\n");
}

// ── Kontrakt KOLUMN ─────────────────────────────────────────────────────────
//
// Tabele, widoki i funkcje to za mało: migracja, która dodaje WYŁĄCZNIE
// kolumny, może nigdy nie pójść na produkcję, a kontrakt obiektowy i tak
// świeci na zielono. Tak było z 20260725090500 (metadane Apple Podcasts):
// 2026-10-09 PostgREST odpowiadał 42703 „column podcasts.explicit does not
// exist" i katalog /podcasts renderował wyłącznie komunikat awarii. Rejestr
// migracji (`check:migration-ledger`) tego nie widział, bo egzekwuje wersje
// dopiero od baseline 20260825230232.
//
// Oczekiwany zbiór to kolumny wprowadzone przez `ALTER TABLE … ADD COLUMN`
// i `RENAME COLUMN` - to samo odtworzenie, którego używa bramka świeżości
// typów (`replayLiveColumns`), więc obie bramki pytają o JEDEN zbiór. Kolumny
// z `CREATE TABLE` nie wchodzą: tabela i jej kolumny powstają jedną
// instrukcją, a istnienie tabeli pilnuje już kontrakt obiektowy.

/** Kolumna, której baza oczekuje po migracjach. */
export interface DbColumn {
  readonly table: string;
  readonly column: string;
  /** Migracja, która wprowadziła kolumnę pod tą nazwą. */
  readonly file: string;
}

/** `tabela.kolumna` - klucz rejestru znanego dryfu i raportu. */
export function dbColumnKey(column: Pick<DbColumn, "table" | "column">): string {
  return `${column.table}.${column.column}`;
}

/**
 * Kolumny dopisane migracjami do tabel, które kontrakt obiektowy uznaje za
 * żywe. Odsiew po `tables` usuwa fantomy skanera (np. `ALTER TABLE auth.users`
 * czytane jako tabela `auth`) i kolumny tabel później skasowanych.
 */
export function expectedColumns(
  files: readonly MigrationFile[],
  tables: readonly DbObject[],
): DbColumn[] {
  const live = new Set(tables.map((t) => t.name));
  const out: DbColumn[] = [];
  for (const [key, file] of replayLiveColumns(files)) {
    const cut = key.indexOf(".");
    const table = key.slice(0, cut).toLowerCase();
    const column = key.slice(cut + 1).toLowerCase();
    if (live.has(table)) out.push({ table, column, file });
  }
  return out.sort((a, b) => dbColumnKey(a).localeCompare(dbColumnKey(b)));
}

/**
 * Wspólny dowód dla `tenant_id` czterech tabel `research_program_*`.
 * Tabele powstały w 20260713181044 bez tej kolumny; expert_hub dosypuje ją
 * `ADD COLUMN` w JEDNEJ transakcji z wyzwalaczami i politykami, które jej
 * używają - kształt tabel w types.ts to dokładnie 20260713181044, a żadna
 * zmiana właściwa tylko expert_hub na produkcji nie istnieje.
 */
const EXPERT_HUB_NEVER_RAN =
  "20260714130000_expert_hub nie wykonała się na produkcji w ogóle (jedna transakcja; tabela w kształcie z 20260713181044). Izolacja najemców trzyma się polityk przez `programs.tenant_id` rodzica (20260714112155, 20260815110437) - to brak warstwy obrony, nie wyciek. Ponowienie: kolumna nullable, backfill z `programs.tenant_id` po `program_id`, dopiero potem NOT NULL i wyzwalacz - NIE `DEFAULT public.public_tenant_id()` z expert_hub, który ostemplowałby każdy istniejący wiersz domyślnym najemcą.";

/**
 * ZNANY DRYF PRODUKCJI: kolumny, które migracje dodają, a których produkcja
 * NIE MA - zmierzone, nie przepisane. Lista może TYLKO maleć: każdy wpis
 * znika migracją, która kolumnę faktycznie zakłada, a bramka oblewa, gdy
 * wpis przestanie odpowiadać brakowi (martwy wpis to przyszła furtka).
 * Wartość to dowód i skutek - zdanie, które ktoś musi napisać w przeglądzie.
 *
 * Pomiar 2026-10-09 (anonimowy PostgREST, `select=<kolumna>&limit=0`):
 * każdy wpis -> 400/42703, kolumna kontrolna tej samej tabeli -> 200.
 * Te same kolumny figurują w zamrożonym długu bramki świeżości typów
 * (`scripts/check-generated-types-freshness.ts`), bo `types.ts` generuje się
 * z produkcji - to był sygnał dryfu, czytany dotąd jako nieświeże typy.
 */
export const KNOWN_COLUMN_DRIFT: Readonly<Record<string, string>> = {
  "membership_grants.source_coupon_id":
    "20260725090300 (apply_coupon_effects_after_payment) weszła na produkcję częściowo: `effects_applied_at` z tego pliku jest, ta kolumna nie. SKUTEK (ścieżka pieniędzy): `apply_b2b_coupon_effects` (20260801214845) wstawia ją do `membership_grants`, więc kupon z `grants_tier_key` po opłaceniu nie nadaje warstwy - błąd 42703 kończy się wyłącznie `console.error` w couponEffects.server.ts, zamówienie zostaje `paid`, webhook nie ponawia.",
  "notifications.meta":
    "Dodawana przez 20260711100000 i 20260711120000 (engagement); produkcyjna tabela `notifications` jej nie ma. SKUTEK: `notify_profile_welcome` i `notify_new_follower` łapią 42703 (EXCEPTION WHEN OTHERS), więc żadna akcja użytkownika nie pada, ale powiadomienie powitalne ginie, a powiadomienia o obserwacji tracą 7-dniową deduplikację albo nie powstają.",
  "research_program_items.tenant_id": EXPERT_HUB_NEVER_RAN,
  "research_program_members.id":
    "20260714130000_expert_hub nie wykonała się na produkcji (patrz pozostałe wpisy research_program_*). Tabela ma klucz (program_id, profile_id) z 20260713181044 i na nim stoi kod panelu oraz deduplikacja w 20260815110844 (po ctid, bo `id` nie ma); ponowienie dodaje `id` z gen_random_uuid() i indeksem UNIQUE, bez zmiany klucza głównego.",
  "research_program_members.tenant_id": EXPERT_HUB_NEVER_RAN,
  "research_program_partners.tenant_id": EXPERT_HUB_NEVER_RAN,
  "research_program_projects.tenant_id": EXPERT_HUB_NEVER_RAN,
};

/**
 * Na jaką bazę patrzy sonda. Dryf z `KNOWN_COLUMN_DRIFT` to fakt o PRODUKCJI;
 * baza odtworzona z migracji (krok e2e-seeded przed scaleniem) ma każdą
 * oczekiwaną kolumnę, więc tam rejestr nie obowiązuje: każdy brak to błąd,
 * a obecność kolumny z rejestru nie jest „martwym wpisem".
 */
export type ContractTarget = "production" | "replay";

/** `DB_CONTRACT_TARGET`: brak = produkcja (post-deploy); literówka to błąd, nie cicha produkcja. */
export function parseContractTarget(raw: string | undefined): ContractTarget {
  if (raw === undefined || raw === "" || raw === "production") return "production";
  if (raw === "replay") return "replay";
  throw new Error(`DB_CONTRACT_TARGET: nieznany cel "${raw}" (production | replay)`);
}

/** Rejestr znanego dryfu dla celu sondy. */
export function columnDriftRegistry(target: ContractTarget): Readonly<Record<string, string>> {
  return target === "replay" ? {} : KNOWN_COLUMN_DRIFT;
}

export interface ColumnDriftReport {
  readonly checked: number;
  /** Kolumn brak, a rejestr ich nie zna - NOWY dryf. */
  readonly missing: readonly DbColumn[];
  /** Kolumn brak i rejestr je zna - dług z uzasadnieniem. */
  readonly known: readonly DbColumn[];
  /** Wpisy rejestru, których baza już nie potwierdza - do usunięcia. */
  readonly resolved: readonly string[];
  /** Powód, dla którego sondy nie dało się wykonać; `null`, gdy wykonana. */
  readonly inconclusive: string | null;
}

/** Rozdziela brakujące kolumny na nowy dryf, znany dług i martwe wpisy rejestru. */
export function compareColumnDrift(
  expected: readonly DbColumn[],
  missing: readonly DbColumn[],
  known: Readonly<Record<string, string>>,
): ColumnDriftReport {
  const missingKeys = new Set(missing.map(dbColumnKey));
  return {
    checked: expected.length,
    missing: missing.filter((c) => !(dbColumnKey(c) in known)),
    known: missing.filter((c) => dbColumnKey(c) in known),
    resolved: Object.keys(known)
      .filter((key) => !missingKeys.has(key))
      .sort(),
    inconclusive: null,
  };
}

/** Raport, gdy sonda kolumn nie mogła się wykonać (np. brak RPC na bazie). */
export function inconclusiveColumnDrift(
  expected: readonly DbColumn[],
  reason: string,
): ColumnDriftReport {
  return { checked: expected.length, missing: [], known: [], resolved: [], inconclusive: reason };
}

/** Czy raport kolumn powinien zablokować CI. */
export function columnDriftFailed(report: ColumnDriftReport): boolean {
  return (
    report.inconclusive !== null ||
    report.checked === 0 ||
    report.missing.length > 0 ||
    report.resolved.length > 0
  );
}

/** Renderuje raport kolumn w formacie Markdown (log CI / GitHub Step Summary). */
export function renderColumnDriftReport(report: ColumnDriftReport): string {
  const lines: string[] = [
    "## Kontrakt bazy danych (kolumny dopisane migracjami)",
    "",
    `- Sprawdzonych kolumn: **${report.checked}**`,
    `- Brakujących (nowy dryf): **${report.missing.length}**`,
    `- Znanego dryfu (rejestr \`KNOWN_COLUMN_DRIFT\`): **${report.known.length}**`,
  ];
  if (report.inconclusive !== null) {
    lines.push("", "### Sonda kolumn nie wykonana", "", report.inconclusive);
  }
  if (report.missing.length > 0) {
    lines.push("", "### Brakujące kolumny");
    for (const c of report.missing) lines.push(`- \`${dbColumnKey(c)}\` (migracja: ${c.file})`);
    lines.push(
      "",
      "Migracja dodająca te kolumny nie wykonała się na tej bazie. Ponów ją idempotentną",
      "migracją o NOWEJ wersji (wzór: 20261009100000) - nie dopisuj braku do rejestru dryfu.",
    );
  }
  if (report.resolved.length > 0) {
    lines.push("", "### Wpisy rejestru dryfu do usunięcia (baza ich już nie potwierdza)");
    for (const key of report.resolved) lines.push(`- \`${key}\``);
  }
  if (report.known.length > 0) {
    lines.push("", "### Znany dryf (dług z uzasadnieniem)");
    for (const c of report.known) lines.push(`- \`${dbColumnKey(c)}\``);
  }
  return lines.join("\n");
}
