/**
 * Bramka po-wdrożeniowa, warstwa czysta: czy KAŻDA migracja z gałęzi jest
 * zapisana w rejestrze wykonanych migracji bazy.
 *
 * Kontrakt obiektowy (`src/lib/ci/dbContract.ts`) sprawdza, czy tabele, widoki
 * i RPC istnieją. Nie widzi jednak migracji, które nie tworzą nowego obiektu -
 * ALTER kolumny, nowa polityka RLS, GRANT, `CREATE OR REPLACE` istniejącej
 * funkcji, seed. Taka migracja może nigdy się nie wykonać, a bramka obiektowa
 * i tak świeci na zielono (dokładnie ten scenariusz zdarzył się przy PR #286).
 * Ten moduł zamyka lukę po stronie rejestru: porównuje wersje plików
 * `supabase/migrations/<version>_<nazwa>.sql` z odpowiedzią bazy.
 *
 * Trzy świadome ustępstwa wobec realiów tego repo:
 *
 *  1. BAZOWA LINIA (`baseline`). Rejestr bazy zaczął być kompletny dopiero od
 *     pewnego momentu; wcześniejsze migracje pilnuje bramka obiektowa. Bramka
 *     rejestru egzekwuje więc wersje NOWSZE niż baseline - linia może tylko
 *     rosnąć i tylko wtedy, gdy wszystko powyżej jest zielone.
 *  2. UZGODNIENIA (`reconciled`). Migracja przyniesiona w PR-ze bywa wykonywana
 *     przez pipeline pod własną wersją, więc wersja pliku nigdy nie trafi do
 *     rejestru. Wpis uzgodnienia nie zwalnia z kontroli: wskazuje wersję, pod
 *     którą SQL faktycznie poszedł, i bramka sprawdza właśnie ją.
 *  3. LUSTRO DRIZZLE (`drizzleProven`). Plik niesiony przez wpis dziennika
 *     drizzle PO ZAMROŻENIU (lustro z `bun run migrations:mirror` albo wpis
 *     bota Lovable, którego SQL adoptował plik supabase - runbook §5.4 pkt 1)
 *     trafia na produkcję migratorem Drizzle, który zapisuje go
 *     w `drizzle.__drizzle_migrations`, a nie w tym rejestrze. Wierszy
 *     w `supabase_migrations.schema_migrations` nikt już nie dopisuje ręcznie
 *     (taki wiersz nie dowodzi, że SQL się wykonał), więc bramka rejestru tych
 *     plików nie egzekwuje. Który wpis niesie który plik, rozstrzyga kierunek
 *     odwrotny bramki pasów (`analyzeSupabaseCoverage`, ta sama definicja co
 *     w `check:migration-lanes`) - `drizzleProvenFiles`. Wdrożenie potwierdza
 *     zapytanie `bun run migrations:deploy-sql -- --verify`.
 *
 * Cała logika jest czysta i testowalna - IO (fetch, fs) siedzi w
 * `scripts/check-migration-ledger.ts`.
 */

/** Nazwa pliku migracji rozłożona na wersję (prefiks) i etykietę. */
export interface MigrationFile {
  readonly file: string;
  readonly version: string;
  readonly label: string;
}

/** Migracja wymagana od bazy wraz z wersją, której faktycznie szukamy w rejestrze. */
export interface LedgerRequirement {
  readonly file: string;
  /** Wersja z nazwy pliku. */
  readonly version: string;
  /** Wersja pilnowana w rejestrze (różna od `version` tylko przy uzgodnieniu). */
  readonly ledgerVersion: string;
  readonly reconciled: boolean;
}

export interface LedgerConfig {
  /** Migracje o wersji <= baseline są poza zakresem bramki rejestru. */
  readonly baseline: string;
  /** `nazwa pliku` → `wersja w rejestrze, pod którą SQL został wykonany`. */
  readonly reconciled: Readonly<Record<string, string>>;
  /**
   * Nazwy plików niesionych przez wpisy dziennika po zamrożeniu
   * (`drizzleProvenFiles`) - poza zakresem bramki, bo ich dowodem jest rejestr
   * migratora Drizzle, nie `schema_migrations`.
   */
  readonly drizzleProven?: ReadonlySet<string>;
}

/**
 * Pliki, których dowodem wdrożenia jest rejestr migratora Drizzle: niesione
 * (`copies`: plik -> tag z przydziału `analyzeSupabaseCoverage`) przez wpis
 * dziennika o idx większym niż `freezeIdx` (JOURNAL_FREEZE_IDX). Historia do
 * zamrożenia - bliźniaki i kopie panelu - zostaje w bramce rejestru jak dotąd.
 */
export function drizzleProvenFiles(
  copies: ReadonlyMap<string, string>,
  freezeIdx: number,
): Set<string> {
  const idxOf = (tag: string): number =>
    Number(/^(\d+)_/.exec(tag)?.[1] ?? Number.POSITIVE_INFINITY);
  return new Set([...copies].filter(([, tag]) => idxOf(tag) > freezeIdx).map(([file]) => file));
}

export interface LedgerReport {
  /** Migracje faktycznie egzekwowane (po odcięciu baseline). */
  readonly required: readonly LedgerRequirement[];
  /** Migracje sprzed baseline - pilnuje ich bramka obiektowa. */
  readonly baselined: number;
  /** Migracje powyżej baseline z lustrem drizzle - dowodem rejestr migratora Drizzle. */
  readonly drizzleProven: number;
  /** Wymagania, których baza nie potwierdza - wdrożenie jest niepełne. */
  readonly missing: readonly LedgerRequirement[];
  /** Uzgodnienia wskazujące pliki, których w gałęzi już nie ma (martwy wpis). */
  readonly staleReconciliations: readonly string[];
  /** Pliki o nazwie spoza konwencji `<wersja>_<etykieta>.sql`. */
  readonly malformed: readonly string[];
}

const VERSION_RE = /^(\d{14})_(.+)\.sql$/;

/**
 * Wersja migracji to 14-cyfrowy prefiks nazwy pliku - dokładnie to, co Supabase
 * zapisuje w `supabase_migrations.schema_migrations.version`.
 */
export function parseMigrationFile(file: string): MigrationFile | null {
  const match = VERSION_RE.exec(file);
  if (!match) return null;
  return { file, version: match[1], label: match[2] };
}

export function parseMigrationFiles(files: readonly string[]): {
  parsed: MigrationFile[];
  malformed: string[];
} {
  const parsed: MigrationFile[] = [];
  const malformed: string[] = [];
  for (const file of [...files].filter((f) => f.endsWith(".sql")).sort()) {
    const entry = parseMigrationFile(file);
    if (entry) parsed.push(entry);
    else malformed.push(file);
  }
  return { parsed, malformed };
}

/** Migracja w zakresie bramki rejestru: nowsza niż baseline (lustro drizzle jeszcze nie odjęte). */
function aboveBaseline(m: MigrationFile, config: LedgerConfig): boolean {
  return m.version > config.baseline;
}

/** Zbiór wersji, o które trzeba zapytać bazę (już po odcięciu baseline i plików z lustrem). */
export function ledgerRequirements(
  parsed: readonly MigrationFile[],
  config: LedgerConfig,
): LedgerRequirement[] {
  return parsed
    .filter((m) => aboveBaseline(m, config) && !config.drizzleProven?.has(m.file))
    .map((m) => {
      const reconciledVersion = config.reconciled[m.file];
      return {
        file: m.file,
        version: m.version,
        ledgerVersion: reconciledVersion ?? m.version,
        reconciled: typeof reconciledVersion === "string",
      };
    });
}

/**
 * Zestawia wymagania z listą braków zwróconą przez bazę. Baza nigdy nie wylicza
 * swojego rejestru - odpowiada wyłącznie na pytanie o podane wersje.
 */
export function buildLedgerReport(
  parsed: readonly MigrationFile[],
  malformed: readonly string[],
  missingVersions: readonly string[],
  config: LedgerConfig,
): LedgerReport {
  const required = ledgerRequirements(parsed, config);
  const inScope = parsed.filter((m) => aboveBaseline(m, config)).length;
  const missingSet = new Set(missingVersions);
  const branchFiles = new Set(parsed.map((m) => m.file));
  return {
    required,
    baselined: parsed.length - inScope,
    drizzleProven: inScope - required.length,
    missing: required.filter((r) => missingSet.has(r.ledgerVersion)),
    staleReconciliations: Object.keys(config.reconciled)
      .filter((file) => !branchFiles.has(file))
      .sort(),
    malformed: [...malformed],
  };
}

export function ledgerFailed(report: LedgerReport): boolean {
  return (
    report.missing.length > 0 ||
    report.malformed.length > 0 ||
    report.staleReconciliations.length > 0
  );
}

export function renderLedgerReport(report: LedgerReport): string {
  const lines: string[] = ["## Rejestr migracji (gałąź ⇄ baza)", ""];
  lines.push(`- Egzekwowanych migracji: **${report.required.length}**`);
  lines.push(`- Poniżej bazowej linii (pilnuje bramka obiektowa): **${report.baselined}**`);
  lines.push(
    `- Z lustrem drizzle (dowód: rejestr migratora \`drizzle.__drizzle_migrations\`, zapytanie \`bun run migrations:deploy-sql -- --verify\`): **${report.drizzleProven}**`,
  );
  lines.push(`- Niewykonanych w bazie: **${report.missing.length}**`);
  if (report.malformed.length > 0) {
    lines.push(`- Plików o złej nazwie: **${report.malformed.length}**`);
  }
  if (report.staleReconciliations.length > 0) {
    lines.push(`- Martwych uzgodnień: **${report.staleReconciliations.length}**`);
  }
  lines.push("");

  if (report.missing.length > 0) {
    lines.push("### Migracje, które nie wykonały się na bazie", "");
    for (const m of report.missing) {
      lines.push(
        m.reconciled
          ? `- \`${m.file}\` (uzgodniona wersja \`${m.ledgerVersion}\` też nie istnieje w rejestrze)`
          : `- \`${m.file}\``,
      );
    }
    lines.push("");
  }
  if (report.malformed.length > 0) {
    lines.push("### Pliki spoza konwencji `<wersja>_<etykieta>.sql`", "");
    for (const f of report.malformed) lines.push(`- \`${f}\``);
    lines.push("");
  }
  if (report.staleReconciliations.length > 0) {
    lines.push("### Uzgodnienia wskazujące nieistniejące pliki - usuń wpisy", "");
    for (const f of report.staleReconciliations) lines.push(`- \`${f}\``);
    lines.push("");
  }
  if (!ledgerFailed(report)) {
    lines.push("Wszystkie migracje z gałęzi są wykonane na bazie.", "");
  }
  return lines.join("\n");
}
