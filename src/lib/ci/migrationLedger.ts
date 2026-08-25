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
 * Cała logika jest czysta i testowalna - IO (fetch, fs) siedzi w
 * `scripts/check-migration-ledger.ts`.
 */

/** Nazwa pliku migracji rozłożona na wersję (prefiks) i etykietę. */
export interface MigrationFile {
  readonly file: string;
  readonly version: string;
  readonly label: string;
}

export interface LedgerReport {
  /** Wersje migracji obecne w gałęzi. */
  readonly expected: readonly MigrationFile[];
  /** Wersje, których baza nie zna - wdrożenie jest niepełne. */
  readonly missing: readonly MigrationFile[];
  /** Pliki o nazwie spoza konwencji `<wersja>_<etykieta>.sql`. */
  readonly malformed: readonly string[];
}

const VERSION_RE = /^(\d{14})_(.+)\.sql$/;

/**
 * Wersja migracji to 14-cyfrowy prefiks nazwy pliku - dokładnie to, co Supabase
 * CLI zapisuje w `supabase_migrations.schema_migrations.version`.
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

/**
 * Zestawia oczekiwane wersje z listą braków zwróconą przez bazę. Baza nigdy nie
 * wylicza swojego rejestru - odpowiada wyłącznie na pytanie o podane wersje.
 */
export function buildLedgerReport(
  parsed: readonly MigrationFile[],
  malformed: readonly string[],
  missingVersions: readonly string[],
): LedgerReport {
  const missingSet = new Set(missingVersions);
  return {
    expected: parsed,
    missing: parsed.filter((m) => missingSet.has(m.version)),
    malformed: [...malformed],
  };
}

export function ledgerFailed(report: LedgerReport): boolean {
  return report.missing.length > 0 || report.malformed.length > 0;
}

export function renderLedgerReport(report: LedgerReport): string {
  const lines: string[] = ["## Rejestr migracji (gałąź ⇄ baza)", ""];
  lines.push(`- Migracji w gałęzi: **${report.expected.length}**`);
  lines.push(`- Niewykonanych w bazie: **${report.missing.length}**`);
  if (report.malformed.length > 0) {
    lines.push(`- Plików o złej nazwie: **${report.malformed.length}**`);
  }
  lines.push("");

  if (report.missing.length > 0) {
    lines.push("### Migracje, które nie wykonały się na bazie", "");
    for (const m of report.missing) lines.push(`- \`${m.file}\``);
    lines.push("");
  }
  if (report.malformed.length > 0) {
    lines.push("### Pliki spoza konwencji `<wersja>_<etykieta>.sql`", "");
    for (const f of report.malformed) lines.push(`- \`${f}\``);
    lines.push("");
  }
  if (!ledgerFailed(report)) {
    lines.push("Wszystkie migracje z gałęzi są wykonane na bazie.", "");
  }
  return lines.join("\n");
}
