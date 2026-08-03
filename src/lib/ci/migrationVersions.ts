// Inwariant CI: KAŻDA MIGRACJA MA UNIKALNĄ WERSJĘ.
//
// PRZYCZYNA ŹRÓDŁOWA (audyt 2026-08-03, korekta 5 - rekomendacja P1 powtarzana
// od trzech wydań): `supabase_migrations.schema_migrations` ma kolumnę `version`
// jako KLUCZ GŁÓWNY, a wersja to prefiks timestampu z nazwy pliku. Trzy pliki
// dzieliły prefiks `20260803090000` (`harden_enqueue_notification_acl`,
// `link_monitor_archive_and_alerts`, `payment_orders_gdpr_retention`).
//
// Audyt opisał skutek słowo w słowo: „różnica między »działa« a »nie da się
// odtworzyć bazy z migracji« jest tu kwestią kolejności alfabetycznej". I się
// zmaterializował - `supabase db start` przerywał odtwarzanie bazy na:
//
//   ERROR: duplicate key value violates unique constraint "schema_migrations_pkey"
//   Key (version)=(20260803090000) already exists.
//
// co wywracało joby `pgtap`, `e2e` i `e2e-seeded`, a przy okazji sprawiało, że
// ŻADNA późniejsza migracja nie była już w CI walidowana. Kolizja jest
// niewidoczna dla każdego, kto nie odtwarza bazy od zera - dokładnie ta klasa
// błędu, która bez statycznej bramki wraca (wróciła trzy razy).
//
// Warstwa wykonawcza (odczyt katalogu + exit code) żyje w
// `scripts/check-sql-migration-versions.ts`; ten moduł jest czysty i testowalny.

/** `20260803090000_opis.sql` -> wersja + opis. */
const FILE_RE = /^(\d{14})_(.+)\.sql$/;

export interface MigrationFileName {
  readonly file: string;
  readonly version: string;
  readonly name: string;
}

export interface MigrationVersionReport {
  /** Liczba plików z poprawnie sparsowaną wersją. */
  readonly total: number;
  /** Pliki, których nazwa nie daje się sparsować na wersję + opis. */
  readonly unparsable: readonly string[];
  /** Kolizje: wersja -> pliki, które ją dzielą (zawsze >= 2). */
  readonly duplicates: ReadonlyMap<string, readonly string[]>;
  /** Miejsca, gdzie porządek nazw rozjeżdża się z porządkiem wersji. */
  readonly outOfOrder: readonly string[];
}

/**
 * Czysta analiza listy nazw plików migracji.
 *
 * Sortowanie po nazwie jest tu ISTOTNE, nie kosmetyczne: dokładnie w tej
 * kolejności Supabase CLI aplikuje pliki, więc to ona decyduje, który plik
 * zapisze się w ledgerze pod wspólną wersją.
 */
export function analyzeMigrationVersions(files: readonly string[]): MigrationVersionReport {
  const sorted = [...files].sort();
  const unparsable: string[] = [];
  const parsed: MigrationFileName[] = [];

  for (const file of sorted) {
    const match = FILE_RE.exec(file);
    if (!match) {
      unparsable.push(file);
      continue;
    }
    parsed.push({ file, version: match[1], name: match[2] });
  }

  const byVersion = new Map<string, string[]>();
  for (const { version, file } of parsed) {
    const bucket = byVersion.get(version);
    if (bucket) bucket.push(file);
    else byVersion.set(version, [file]);
  }
  const duplicates = new Map<string, readonly string[]>();
  for (const [version, group] of byVersion) {
    if (group.length > 1) duplicates.set(version, group);
  }

  // Wersje muszą rosnąć w tym samym porządku, w którym CLI aplikuje pliki.
  // Rozjazd znaczy, że ledger dostanie wersję „z przeszłości" po nowszej -
  // a wtedy `supabase db push` uzna ją za już zastosowaną i ją POMINIE.
  const outOfOrder: string[] = [];
  for (let i = 1; i < parsed.length; i += 1) {
    if (parsed[i].version < parsed[i - 1].version) {
      outOfOrder.push(`${parsed[i].file} (wersja starsza niż ${parsed[i - 1].file})`);
    }
  }

  return { total: parsed.length, unparsable, duplicates, outOfOrder };
}

export function migrationVersionsFailed(report: MigrationVersionReport): boolean {
  return report.duplicates.size > 0 || report.unparsable.length > 0 || report.outOfOrder.length > 0;
}

export function renderMigrationVersionReport(report: MigrationVersionReport): string {
  const lines: string[] = [];

  if (report.duplicates.size > 0) {
    lines.push("✗ Zduplikowane wersje migracji (schema_migrations.version to KLUCZ GŁÓWNY):");
    for (const [version, group] of report.duplicates) {
      lines.push(`  wersja ${version} dzielona przez ${group.length} plików:`);
      for (const file of group) lines.push(`    - ${file}`);
    }
    lines.push(
      "  Napraw: przenumeruj wszystkie POZA pierwszym alfabetycznie (ten zapisał się",
      "  w ledgerze) na kolejne sekundy, zachowując względną kolejność -",
      "  konwencja repo: ...0000 / ...0001 / ...0002 (patrz 20260731210000/210001).",
    );
  }

  if (report.unparsable.length > 0) {
    lines.push("✗ Nazwy bez parsowalnej wersji (oczekiwane: 14 cyfr + '_' + opis + '.sql'):");
    for (const file of report.unparsable) lines.push(`    - ${file}`);
  }

  if (report.outOfOrder.length > 0) {
    lines.push("✗ Porządek nazw plików rozjeżdża się z porządkiem wersji:");
    for (const entry of report.outOfOrder) lines.push(`    - ${entry}`);
  }

  if (lines.length === 0) {
    lines.push(`✓ Inwariant wersji migracji OK (${report.total} plików, zero kolizji).`);
  }
  return lines.join("\n");
}
