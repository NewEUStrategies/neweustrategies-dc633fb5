// Inwariant CI: WYGENEROWANE TYPY NIE ODSTAJĄ OD MIGRACJI.
//
// PRZYCZYNA ŹRÓDŁOWA - I POWÓD, DLA KTÓREGO REPO MA 349 `as unknown as`.
// `src/integrations/supabase/types.ts` jest generowany z bazy. Migracje są
// forward-only i jest ich 760. Gdy ktoś doda kolumnę migracją i nie zregeneruje
// typów, kod czytający tę kolumnę NIE KOMPILUJE SIĘ - i wtedy najtańszym
// wyjściem jest `as unknown as JakiśRow` z ręcznie przepisanym kształtem.
// Cast działa, ale od tej chwili kasuje KAŻDĄ różnicę między kodem a bazą -
// także tę, która pojawi się rok później. Czyli: nieświeże typy PRODUKUJĄ
// casty, a casty ukrywają kolejne rozjazdy. Bramka wchodzi na początek tego
// łańcucha.
//
// STAN ZMIERZONY PRZY WDROŻENIU: 28 kolumn z 11 tabel istnieje w migracjach
// i nie ma ich w wygenerowanych typach. Cztery z nich to `tenant_id`
// (`research_program_items`, `_members`, `_partners`, `_projects`) - czyli
// kolumna, na której stoi izolacja najemców. Kod, który ma ją ustawić, nie
// może tego zrobić w sposób typowany.
//
// DLACZEGO BASELINE, A NIE ZERO. Regeneracja `types.ts` wymaga dostępu do
// projektu Supabase (CLI + klucz), więc nie jest zmianą, którą wolno zrobić
// „po drodze" w PR o czymś innym: przepisuje 20 tysięcy linii wygenerowanego
// pliku i dotyka każdego zapytania w repo. Bramka zamraża dług na dokładnej
// liście i oblewa, gdy ktoś dopisze kolumnę BEZ regeneracji. Lista ma tylko
// maleć - i zniknąć w całości przy najbliższej regeneracji.
//
// CZEGO NIE MIERZY - świadomie:
//   * kolumn z `CREATE TABLE` - te wchodzą do typów razem z tabelą, a tabela
//     bez typów w ogóle się nie skompiluje, więc nie umie zniknąć po cichu;
//   * typów kolumn (`text` vs `uuid`) - do tego trzeba pełnego parsera DDL,
//     a pytanie „czy kolumna w ogóle jest" łapie tę klasę błędu najtaniej;
//   * widoków i RPC - istnienie obiektów pilnuje `check:db-contract`.

/** Migracja poddana skanowi (nazwa pliku + treść). */
export interface ScannedMigration {
  readonly file: string;
  readonly sql: string;
}

/** Kolumna dopisana migracją, której nie ma w wygenerowanych typach. */
export interface StaleColumn {
  readonly table: string;
  readonly column: string;
  /** Migracja, która ją dodała - żeby review wiedziało, od kiedy jest dług. */
  readonly file: string;
}

/** Kolumny zadeklarowane w wygenerowanych typach, per tabela. */
export type GeneratedColumns = ReadonlyMap<string, ReadonlySet<string>>;

/**
 * `Row` każdej tabeli z wygenerowanych typów.
 *
 * Parsujemy WYŁĄCZNIE blok `Row: {` na ustalonym wcięciu - `Insert` i `Update`
 * opisują to samo innymi modyfikatorami, a `Relationships` to już nie kolumny.
 */
export function readGeneratedColumns(types: string): GeneratedColumns {
  const out = new Map<string, Set<string>>();
  const table = /\n {6}([a-z0-9_]+): \{\n {8}Row: \{\n([\s\S]*?)\n {8}\}\n/g;
  let match = table.exec(types);
  while (match !== null) {
    const columns = new Set<string>();
    for (const line of match[2].split("\n")) {
      const column = /^\s+([a-z0-9_]+)\??:/.exec(line);
      if (column !== null) columns.add(column[1]);
    }
    out.set(match[1], columns);
    match = table.exec(types);
  }
  return out;
}

/** Usuwa komentarze liniowe, żeby zakomentowany `ADD COLUMN` nie liczył się. */
function stripLineComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}

interface ColumnEvent {
  readonly table: string;
  readonly column: string;
  readonly file: string;
  readonly dropped: boolean;
}

/**
 * `ADD COLUMN` i `DROP COLUMN` ze wszystkich `ALTER TABLE`, w kolejności
 * migracji. Kolejność ma znaczenie: kolumna dodana i później skreślona nie
 * jest długiem typów.
 */
export function scanColumnEvents(migrations: readonly ScannedMigration[]): ColumnEvent[] {
  const out: ColumnEvent[] = [];
  for (const { file, sql } of migrations) {
    const clean = stripLineComments(sql);
    const alters = clean.matchAll(
      /ALTER TABLE\s+(?:IF EXISTS\s+)?(?:public\.)?"?([a-z0-9_]+)"?([\s\S]*?);/gi,
    );
    for (const alter of alters) {
      const table = alter[1];
      for (const add of alter[2].matchAll(/ADD COLUMN\s+(?:IF NOT EXISTS\s+)?"?([a-z0-9_]+)"?/gi)) {
        out.push({ table, column: add[1], file, dropped: false });
      }
      for (const drop of alter[2].matchAll(/DROP COLUMN\s+(?:IF EXISTS\s+)?"?([a-z0-9_]+)"?/gi)) {
        out.push({ table, column: drop[1], file, dropped: true });
      }
    }
  }
  return out;
}

/**
 * Kolumny żywe po migracjach, których nie ma w wygenerowanych typach.
 *
 * Tabele nieznane typom są pomijane: świeżo utworzona tabela nie skompiluje się
 * w kodzie w ogóle, więc nie potrzebuje tej bramki, a jej `ALTER`-y dawałyby
 * tu wyłącznie szum.
 */
export function findStaleColumns(
  migrations: readonly ScannedMigration[],
  generated: GeneratedColumns,
): StaleColumn[] {
  const live = new Map<string, string>();
  for (const event of scanColumnEvents(migrations)) {
    const key = `${event.table}.${event.column}`;
    if (event.dropped) live.delete(key);
    else live.set(key, event.file);
  }
  const out: StaleColumn[] = [];
  for (const [key, file] of live) {
    const cut = key.indexOf(".");
    const table = key.slice(0, cut);
    const column = key.slice(cut + 1);
    const columns = generated.get(table);
    if (columns === undefined) continue;
    if (!columns.has(column)) out.push({ table, column, file });
  }
  return out.sort((a, b) => `${a.table}.${a.column}`.localeCompare(`${b.table}.${b.column}`));
}

/** `tabela.kolumna` - postać wpisu w zamrożonym długu. */
export function columnKey(entry: StaleColumn): string {
  return `${entry.table}.${entry.column}`;
}

export interface FreshnessReport {
  /** Nowy dług: kolumna dopisana migracją bez regeneracji typów. */
  readonly fresh: readonly StaleColumn[];
  /** Wpisy z baseline'u, które przestały być potrzebne - lista ma maleć. */
  readonly resolved: readonly string[];
  readonly total: number;
}

export function compareWithBaseline(
  stale: readonly StaleColumn[],
  baseline: readonly string[],
): FreshnessReport {
  const known = new Set(baseline);
  const seen = new Set(stale.map(columnKey));
  return {
    fresh: stale.filter((entry) => !known.has(columnKey(entry))),
    resolved: baseline.filter((key) => !seen.has(key)),
    total: stale.length,
  };
}

export function freshnessFailed(report: FreshnessReport): boolean {
  return report.fresh.length > 0 || report.resolved.length > 0;
}

export function renderFreshnessReport(report: FreshnessReport, baselineSize: number): string {
  if (!freshnessFailed(report)) {
    return `[types-freshness] OK - ${report.total} znanych kolumn poza wygenerowanymi typami (baseline: ${baselineSize}).`;
  }
  const lines: string[] = [];
  if (report.fresh.length > 0) {
    lines.push(
      `[types-freshness] ${report.fresh.length} NOWYCH kolumn dopisanych migracją bez regeneracji typów:`,
      ...report.fresh.map(
        (entry) => `  - ${entry.table}.${entry.column}  (dodana w ${entry.file})`,
      ),
      "",
      "Kod czytający taką kolumnę nie skompiluje się - i wtedy najtańszym wyjściem jest",
      "`as unknown as JakiśRow`, który od tej chwili ukrywa KAŻDY przyszły rozjazd",
      "z bazą. Dlatego to jest bramka, a nie ostrzeżenie.",
      "Napraw regeneracją typów:  supabase gen types typescript --linked > src/integrations/supabase/types.ts",
    );
  }
  if (report.resolved.length > 0) {
    lines.push(
      `[types-freshness] ${report.resolved.length} wpisów baseline'u jest już nieaktualnych - USUŃ je z listy:`,
      ...report.resolved.map((key) => `  - ${key}`),
      "",
      "Martwy wpis to przyszła furtka: nazwa zostaje, a wraz z nią zgoda na brak",
      "kolumny, o której nikt już nie pamięta.",
    );
  }
  return lines.join("\n");
}
