// Inwariant CI: BAZĘ MUSI DAĆ SIĘ ODTWORZYĆ Z MIGRACJI.
//
// Jeden moduł na jedno pytanie: czy `supabase db start` (świeża baza, migracje od
// zera) dobiegnie do końca. Obie klasy błędów zebrane tu razem mają wspólną,
// paskudną własność: są NIEWIDOCZNE dla każdego, kto odtwarza bazę przyrostowo
// (`db push` na produkcję), i obie ubijają joby `pgtap`, `e2e` oraz `e2e-seeded`
// ZANIM cokolwiek się uruchomi - a przy okazji sprawiają, że żadna migracja po
// feralnej nie jest już w CI walidowana.
//
// ── INWARIANT 1: unikalność wersji ──────────────────────────────────────────
// `supabase_migrations.schema_migrations.version` to KLUCZ GŁÓWNY, a wersja to
// prefiks timestampu z nazwy pliku. Trzy pliki dzieliły `20260803090000`
// (`harden_enqueue_notification_acl`, `link_monitor_archive_and_alerts`,
// `payment_orders_gdpr_retention`). Audyt 2026-08-03 (korekta 5, P1, rekomendacja
// powtarzana od trzech wydań) opisał skutek słowo w słowo: „różnica między
// »działa« a »nie da się odtworzyć bazy z migracji« jest tu kwestią kolejności
// alfabetycznej". Zmaterializował się jako:
//   ERROR: duplicate key value violates unique constraint "schema_migrations_pkey"
//
// ── INWARIANT 2: zapisy do storage.objects tylko przez sankcjonowaną furtkę ──
// storage-api >= 0055 (w CI od pinu supabase/setup-cli 2.111.0) zakłada
// statementowy trigger `protect_objects_delete`: `DELETE`/`UPDATE` na
// `storage.objects` bez GUC `storage.allow_delete_query` rzuca 42501 „Direct
// deletion from storage tables is not allowed". Repo sankcjonuje furtkę od
// 20260801122000 (`tg_messages_purge_attachment`), ale DWIE późniejsze migracje
// (`20260803085428`, `20260803120000`) miały wykonywane bloki `DO $$` bez niej -
// i każda z nich osobno przerywała odtwarzanie bazy.
//
// KLUCZOWE ROZRÓŻNIENIE: liczą się WYŁĄCZNIE bloki WYKONYWANE przy migracji.
// Ten sam `DELETE` w ciele `CREATE FUNCTION` jest bezpieczny - to tylko
// przechowywany tekst, wykonywany później z GUC-iem ustawionym przez wołającego
// (tak działają `20260712190000` i `20260712192421`, których bramka słusznie nie
// rusza). Bramka, która by ich nie odróżniała, byłaby fałszywie czerwona.
//
// Warstwa wykonawcza (odczyt katalogu + exit code) żyje w
// `scripts/check-sql-migration-replay.ts`; ten moduł jest czysty i testowalny.

/** `20260803090000_opis.sql` -> wersja + opis. */
const FILE_RE = /^(\d{14})_(.+)\.sql$/;

/** Zapis do storage.objects, który trigger `protect_objects_delete` blokuje. */
const STORAGE_WRITE_RE = /\b(?:DELETE\s+FROM|UPDATE)\s+storage\.objects\b/i;

/** Sankcjonowana furtka z 20260801122000. */
const STORAGE_GUC = "storage.allow_delete_query";

export interface MigrationFileName {
  readonly file: string;
  readonly version: string;
  readonly name: string;
}

export interface MigrationReplayReport {
  /** Liczba plików z poprawnie sparsowaną wersją. */
  readonly total: number;
  /** Pliki, których nazwa nie daje się sparsować na wersję + opis. */
  readonly unparsable: readonly string[];
  /** Kolizje: wersja -> pliki, które ją dzielą (zawsze >= 2). */
  readonly duplicates: ReadonlyMap<string, readonly string[]>;
  /** Miejsca, gdzie porządek nazw rozjeżdża się z porządkiem wersji. */
  readonly outOfOrder: readonly string[];
  /** Pliki z WYKONYWANYM zapisem do storage.objects bez furtki GUC. */
  readonly unguardedStorageWrites: readonly string[];
}

/**
 * Wycina ciała `CREATE [OR REPLACE] FUNCTION ... $tag$ ... $tag$`, zostawiając
 * wszystko, co migracja realnie WYKONUJE (w tym bloki `DO $$`).
 *
 * Dopasowanie idzie po znaczniku dolarowym otwierającym ciało, więc `$$`, `$fn$`
 * i każdy inny wariant zamykają się poprawnie i funkcja z `$$` w treści komentarza
 * nie urywa wycinania w złym miejscu.
 */
export function stripFunctionBodies(sql: string): string {
  const createFn = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/gi;
  let out = "";
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = createFn.exec(sql)) !== null) {
    if (match.index < cursor) continue;
    // Znacznik otwierający ciało: pierwszy $tag$ po nagłówku funkcji.
    const tagMatch = /\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(match.index));
    if (!tagMatch) break;
    const tag = tagMatch[0];
    const bodyStart = match.index + (tagMatch.index ?? 0) + tag.length;
    const bodyEnd = sql.indexOf(tag, bodyStart);
    if (bodyEnd === -1) break; // niedomknięte ciało - nie zgaduj

    out += sql.slice(cursor, match.index + (tagMatch.index ?? 0));
    cursor = bodyEnd + tag.length;
    createFn.lastIndex = cursor;
  }
  return out + sql.slice(cursor);
}

/**
 * Czy plik wykonuje zapis do `storage.objects` BEZ sankcjonowanej furtki.
 *
 * Furtka sprawdzana jest w obrębie CAŁEGO wykonywanego fragmentu (a nie linia po
 * linii), bo `set_config` stoi kilka wierszy nad `DELETE`, w tym samym bloku.
 */
export function hasUnguardedStorageWrite(sql: string): boolean {
  const executed = stripFunctionBodies(sql);
  if (!STORAGE_WRITE_RE.test(executed)) return false;
  return !executed.includes(STORAGE_GUC);
}

export interface MigrationSource {
  readonly file: string;
  readonly sql: string;
}

/**
 * Czysta analiza migracji. `sources` jest opcjonalne: bez treści plików bramka
 * sprawdza tylko inwariant wersji (nazwy), co pozwala testować go w izolacji.
 *
 * Sortowanie po nazwie jest ISTOTNE, nie kosmetyczne: dokładnie w tej kolejności
 * Supabase CLI aplikuje pliki, więc to ona decyduje, który plik zapisze się
 * w ledgerze pod wspólną wersją.
 */
export function analyzeMigrationReplay(
  files: readonly string[],
  sources: readonly MigrationSource[] = [],
): MigrationReplayReport {
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

  const unguardedStorageWrites = [...sources]
    .filter(({ sql }) => hasUnguardedStorageWrite(sql))
    .map(({ file }) => file)
    .sort();

  return { total: parsed.length, unparsable, duplicates, outOfOrder, unguardedStorageWrites };
}

export function migrationReplayFailed(report: MigrationReplayReport): boolean {
  return (
    report.duplicates.size > 0 ||
    report.unparsable.length > 0 ||
    report.outOfOrder.length > 0 ||
    report.unguardedStorageWrites.length > 0
  );
}

export function renderMigrationReplayReport(report: MigrationReplayReport): string {
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

  if (report.unguardedStorageWrites.length > 0) {
    lines.push("✗ Wykonywany zapis do storage.objects BEZ furtki `storage.allow_delete_query`:");
    for (const file of report.unguardedStorageWrites) lines.push(`    - ${file}`);
    lines.push(
      "  storage-api >= 0055 rzuca 42501 i PRZERYWA `supabase db start`.",
      "  Napraw wzorem 20260801122000: transakcyjne",
      "  `set_config('storage.allow_delete_query','true',true)` wokół zapisu,",
      "  przywrócenie poprzedniej wartości i blok EXCEPTION.",
      "  (Ten sam zapis w ciele CREATE FUNCTION jest OK - nie wykonuje się przy migracji.)",
    );
  }

  if (lines.length === 0) {
    lines.push(
      `✓ Inwariant odtwarzalności migracji OK (${report.total} plików: zero kolizji wersji, ` +
        "zero niezabezpieczonych zapisów do storage.objects).",
    );
  }
  return lines.join("\n");
}
