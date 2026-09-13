// Bramka dwóch pasów migracji: każdy plik w `drizzle/migrations/` ma w rejestrze
// DECYZJĘ - albo bliźniaka w `supabase/migrations/` o tym samym SQL-u, albo jawny
// powód, dla którego bliźniaka nie ma.
//
// PRZYCZYNA ŹRÓDŁOWA. Repozytorium ma DWA pasy migracji i oba jadą na produkcję,
// co `docs/MAIN_RECOVERY_2026-09-12.md` mówi wprost: „Drizzle i Supabase mają
// odrębne rejestry; samo wykonanie `0002` w Drizzle nie dowodzi obecności wersji
// w rejestrze Supabase". Cała warstwa dowodowa repozytorium patrzy jednak
// WYŁĄCZNIE na pas supabase: `MIGRATIONS_DIR = "supabase/migrations"`
// (scripts/lib/sqlMigrations.ts) zasila każdą bramkę `check:sql-*`, a bazę pgTAP
// stawia `supabase db start` z tego samego katalogu. Plik dołożony tylko do
// drizzle/ jest dla nich NIEWIDZIALNY.
//
// Tak przeszło `0001_profiles_discoverable_default_true`: przestawiło
// `profiles.discoverable` na DEFAULT true i przepisało wszystkie wiersze, podczas
// gdy pas supabase trzymał NOT NULL DEFAULT false, a późniejsza migracja opierała
// na tym argument prawny listy uczestników. Żadna bramka nie miała jak tego zobaczyć.
//
// CO ZNACZY „TEN SAM SQL". Pliki obu pasów NIE są bajt w bajt i nie taka jest
// konwencja - ZMIERZONE na wszystkich parach: pas supabase niesie długi nagłówek
// po polsku, pas drizzle zaczyna się od pierwszej instrukcji, a polskie znaki
// diakrytyczne w literałach `COMMENT ON` są w pasie drizzle złożone do ASCII
// („ktorego" wobec „którego"). Porównujemy więc SQL WYKONYWALNY: bez komentarzy,
// ze złożonymi diakrytykami, ze znormalizowaną spacją i z treścią literałów
// `COMMENT ON ... IS '...'` zastąpioną znacznikiem.
//
// CZEGO TA BRAMKA ŚWIADOMIE NIE ŁAPIE, powiedziane wprost: rozjazdu PROZY
// w literałach `COMMENT ON` (dziś realnie różni się tak para 0010). To
// dokumentacja zapisana w bazie - nie zmienia ani schematu, ani zachowania,
// a traktowanie jej na równi z DDL-em zapaliłoby bramkę na każdej poprawce
// literówki i skończyło się jej wyłączeniem.
//
// DLACZEGO REJESTR, A NIE REGUŁA „każdy plik musi mieć bliźniaka". Bo to
// nieprawda: dwa pliki pasa drizzle powstały jako operacje jednorazowe na
// produkcji i bliźniaka mieć nie powinny. Reguła, której stan faktyczny nie
// spełnia, zostaje wyłączona pierwszego dnia. Rejestr wymusza coś słabszego, ale
// wykonalnego: KAŻDY nowy plik w drizzle/ wymaga świadomego wpisu - wskazania
// bliźniaka albo napisania, czemu go nie ma. Nie da się już dołożyć pliku po cichu.
import { readFileSync } from "node:fs";

import { stripSqlComments } from "../../../scripts/lib/sqlMigrations";

export const DRIZZLE_DIR = "drizzle/migrations";
export const SUPABASE_DIR = "supabase/migrations";

/** Wpis rejestru: pas drizzle ma bliźniaka albo ma powód, dla którego go nie ma. */
export type LaneEntry =
  | {
      readonly tag: string;
      /** Nazwa pliku w `supabase/migrations/` o tym samym SQL-u wykonywalnym. */
      readonly twin: string;
    }
  | {
      readonly tag: string;
      /** Powód, dla którego ten plik świadomie nie ma bliźniaka. */
      readonly drizzleOnly: string;
    };

/**
 * Rejestr pasów. Kolejność jak w `drizzle/migrations/meta/_journal.json`.
 *
 * Dopisanie pliku do `drizzle/migrations/` BEZ wpisu tutaj zapala bramkę - i o to
 * chodzi. `drizzleOnly` nie jest wytrychem: to zdanie, które ktoś musi napisać
 * i podpisać w przeglądzie, a nie domyślne zachowanie.
 */
export const MIGRATION_LANES: readonly LaneEntry[] = [
  {
    tag: "0000_search_people_super_admin_bypass",
    twin: "20260911160000_search_people_super_admin_bypass.sql",
  },
  {
    tag: "0001_profiles_discoverable_default_true",
    drizzleOnly:
      "Regresja prywatności zastosowana wyłącznie na tym pasie - przestawiła profiles.discoverable na DEFAULT true i przepisała wszystkie wiersze. Pas supabase NIE dostaje bliźniaka: oba pasy jadą na produkcję, więc skopiowanie tego pliku uruchomiłoby jego hurtowy UPDATE DRUGI RAZ i ponownie przestawiło każdego, kto od tamtej pory się wypisał. Stan naprawia forward-only 0011 (DEFAULT false) obecne w OBU pasach. Pliku nie usuwamy - repozytorium jest forward-only, a usunięcie nie cofa tego, co już zastosowane.",
  },
  {
    tag: "0002_pr350_member_crm_sync_and_chat_compat",
    drizzleOnly:
      "Uzgodnienie stanu produkcyjnego po scaleniu #350, wykonane na pasie drizzle. Odpowiadający SQL wszedł do pasa supabase osobnymi migracjami o innej treści, więc porównanie instrukcja po instrukcji nie ma tu sensu.",
  },
  {
    tag: "0003_read_only_schema_contract",
    twin: "20260912170000_read_only_schema_contract.sql",
  },
  {
    tag: "0004_read_only_schema_contract",
    twin: "20260912170000_read_only_schema_contract.sql",
  },
  {
    tag: "0005_pr353_admin_dashboard_aggregates",
    twin: "20260912110000_admin_dashboard_aggregates.sql",
  },
  {
    tag: "0006_impersonation_tenant_scope",
    twin: "20260912180000_impersonation_tenant_scope.sql",
  },
  {
    tag: "0007_job_runner_base_url_shape_guard",
    twin: "20260912181000_job_runner_base_url_shape_guard.sql",
  },
  {
    tag: "0008_payment_webhook_events_tenant_binding",
    twin: "20260913100000_payment_webhook_events_tenant_binding.sql",
  },
  {
    tag: "0009_email_log_tenant_scope",
    twin: "20260913101000_email_log_tenant_scope.sql",
  },
  {
    tag: "0010_email_send_log_tenant_producers",
    twin: "20260913140000_email_send_log_tenant_producers.sql",
  },
  {
    tag: "0011_profiles_discoverable_opt_in_restore",
    twin: "20260913090000_profiles_discoverable_opt_in_restore.sql",
  },
];

export type LaneViolationKind = "brak-wpisu" | "wpis-bez-pliku" | "brak-blizniaka" | "rozjazd-sql";

export interface LaneViolation {
  readonly kind: LaneViolationKind;
  readonly tag: string;
  readonly detail: string;
}

export interface LaneReport {
  readonly checked: number;
  readonly twins: number;
  readonly drizzleOnly: number;
  readonly violations: readonly LaneViolation[];
}

/** Odczyt pliku; `null`, gdy pliku nie ma. Wstrzykiwalny, żeby test nie dotykał dysku. */
export type ReadFile = (path: string) => string | null;

export const readFileOrNull: ReadFile = (path) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

/** Polskie znaki do ASCII - pas drizzle zapisuje literały bez diakrytyków. */
function foldDiacritics(sql: string): string {
  return sql.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l").replace(/Ł/g, "L");
}

/**
 * SQL WYKONYWALNY: bez komentarzy, bez diakrytyków, ze znormalizowaną spacją
 * i bez treści literałów `COMMENT ON ... IS '...'`.
 *
 * Znacznik zamiast treści, a nie wycięcie całej instrukcji: gdyby jeden pas
 * przestał w ogóle komentować obiekt, różnica ma być nadal widoczna.
 */
export function executableSql(sql: string): string {
  return foldDiacritics(stripSqlComments(sql))
    .replace(/(COMMENT\s+ON\s+[\s\S]*?\sIS\s+)'(?:[^']|'')*'/gi, "$1'<proza>'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Porównuje pas drizzle z rejestrem i - dla wpisów z bliźniakiem - z pasem supabase.
 *
 * `tags` to nazwy plików `.sql` z `drizzle/migrations/` BEZ rozszerzenia, czyli
 * dokładnie `tag` z dziennika drizzle.
 */
export function analyzeMigrationLanes(
  tags: readonly string[],
  entries: readonly LaneEntry[] = MIGRATION_LANES,
  read: ReadFile = readFileOrNull,
): LaneReport {
  const byTag = new Map(entries.map((e) => [e.tag, e]));
  const violations: LaneViolation[] = [];
  let twins = 0;
  let drizzleOnly = 0;

  for (const tag of tags) {
    const entry = byTag.get(tag);
    if (!entry) {
      violations.push({
        kind: "brak-wpisu",
        tag,
        detail: `Plik ${DRIZZLE_DIR}/${tag}.sql nie ma wpisu w MIGRATION_LANES. Wskaż bliźniaka z ${SUPABASE_DIR}/ albo napisz, czemu go nie ma.`,
      });
      continue;
    }
    if (!("twin" in entry)) {
      drizzleOnly += 1;
      continue;
    }

    twins += 1;
    const drizzleSql = read(`${DRIZZLE_DIR}/${tag}.sql`);
    const supabaseSql = read(`${SUPABASE_DIR}/${entry.twin}`);
    if (drizzleSql === null) continue; // brak pliku łapie pętla niżej
    if (supabaseSql === null) {
      violations.push({
        kind: "brak-blizniaka",
        tag,
        detail: `Wpis wskazuje na ${SUPABASE_DIR}/${entry.twin}, ale tego pliku nie ma.`,
      });
      continue;
    }
    if (executableSql(drizzleSql) !== executableSql(supabaseSql)) {
      violations.push({
        kind: "rozjazd-sql",
        tag,
        detail: `${DRIZZLE_DIR}/${tag}.sql i ${SUPABASE_DIR}/${entry.twin} mają RÓŻNY SQL wykonywalny. Produkcja i pgTAP testowałyby wtedy dwie różne bazy.`,
      });
    }
  }

  const present = new Set(tags);
  for (const entry of entries) {
    if (!present.has(entry.tag)) {
      violations.push({
        kind: "wpis-bez-pliku",
        tag: entry.tag,
        detail: `Rejestr ma wpis dla ${entry.tag}, ale pliku ${DRIZZLE_DIR}/${entry.tag}.sql nie ma. Martwy wpis maskuje brak pliku.`,
      });
    }
  }

  return { checked: tags.length, twins, drizzleOnly, violations };
}

export function laneParityFailed(report: LaneReport): boolean {
  return report.violations.length > 0;
}

export function renderLaneReport(report: LaneReport): string {
  const head = `Pasy migracji: ${report.checked} plików drizzle (${report.twins} z bliźniakiem, ${report.drizzleOnly} świadomie bez).`;
  if (report.violations.length === 0) return `${head} Zgodne.`;
  const lines = report.violations.map((v) => `  [${v.kind}] ${v.tag}: ${v.detail}`);
  return [head, `NARUSZENIA (${report.violations.length}):`, ...lines].join("\n");
}
