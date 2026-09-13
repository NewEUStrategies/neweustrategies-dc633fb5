// Bramka dwóch pasów migracji: każdy plik w `drizzle/migrations/` ma w rejestrze
// DECYZJĘ - albo bliźniaka w `supabase/migrations/` bajt w bajt, albo jawny powód,
// dla którego bliźniaka nie ma.
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
// gdy pas supabase trzymał NOT NULL DEFAULT false, a dwie późniejsze migracje
// opierały na tym drugim argument prawny. Żadna bramka nie miała jak tego zobaczyć.
//
// DLACZEGO REJESTR, A NIE REGUŁA „każdy plik musi mieć bliźniaka". Bo to nieprawda:
// z sześciu plików pasa drizzle tylko dwa mają dziś bliźniaka bajt w bajt, a reszta
// powstała jako operacje jednorazowe na produkcji. Reguła, której stan faktyczny nie
// spełnia, zostaje wyłączona pierwszego dnia. Rejestr wymusza coś słabszego, ale
// wykonalnego: KAŻDY nowy plik w drizzle/ wymaga świadomego wpisu - wskazania
// bliźniaka albo napisania, czemu go nie ma. Nie da się już dołożyć pliku po cichu.
import { readFileSync } from "node:fs";

export const DRIZZLE_DIR = "drizzle/migrations";
export const SUPABASE_DIR = "supabase/migrations";

/** Wpis rejestru: pas drizzle ma bliźniaka albo ma powód, dla którego go nie ma. */
export type LaneEntry =
  | {
      readonly tag: string;
      /** Nazwa pliku w `supabase/migrations/`, porównywana BAJT W BAJT. */
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
      "Regresja prywatności zastosowana wyłącznie na tym pasie - przestawiła profiles.discoverable na DEFAULT true i przepisała wszystkie wiersze. Pas supabase NIE dostaje bliźniaka: oba pasy jadą na produkcję, więc skopiowanie tego pliku uruchomiłoby jego hurtowy UPDATE DRUGI RAZ i ponownie przestawiło każdego, kto od tamtej pory się wypisał. Stan naprawia forward-only 0006 (DEFAULT false) obecne w OBU pasach. Pliku nie usuwamy - repozytorium jest forward-only, a usunięcie nie cofa tego, co już zastosowane.",
  },
  {
    tag: "0002_pr350_member_crm_sync_and_chat_compat",
    drizzleOnly:
      "Uzgodnienie stanu produkcyjnego po scaleniu #350, wykonane na pasie drizzle. Odpowiadający SQL wszedł do pasa supabase osobnymi migracjami o innej treści, więc porównanie bajt w bajt nie ma tu sensu.",
  },
  {
    tag: "0003_read_only_schema_contract",
    twin: "20260912170000_read_only_schema_contract.sql",
  },
  {
    tag: "0004_read_only_schema_contract",
    drizzleOnly:
      "Powtórzenie 0003 bez nagłówka własnicielskiego, zastosowane na produkcji zanim ustalono wersję kanoniczną. Bliźniakiem kanonicznym jest 0003; osobnego pliku w pasie supabase ta wersja nie ma i mieć nie powinna.",
  },
  {
    tag: "0005_pr353_admin_dashboard_aggregates",
    drizzleOnly:
      "Agregaty panelu admina zastosowane na pasie drizzle po scaleniu #353. Pas supabase niesie tę funkcjonalność własnymi migracjami; treść nie jest identyczna.",
  },
  {
    tag: "0006_profiles_discoverable_opt_in_restore",
    twin: "20260913090000_profiles_discoverable_opt_in_restore.sql",
  },
];

export type LaneViolationKind =
  "brak-wpisu" | "wpis-bez-pliku" | "brak-blizniaka" | "rozjazd-tresci";

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
        detail: `Plik ${DRIZZLE_DIR}/${tag}.sql nie ma wpisu w MIGRATION_LANES. Dopisz bliźniaka z ${SUPABASE_DIR}/ albo napisz, czemu go nie ma.`,
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
    if (supabaseSql === null) {
      violations.push({
        kind: "brak-blizniaka",
        tag,
        detail: `Wpis wskazuje na ${SUPABASE_DIR}/${entry.twin}, ale tego pliku nie ma.`,
      });
      continue;
    }
    if (drizzleSql !== supabaseSql) {
      violations.push({
        kind: "rozjazd-tresci",
        tag,
        detail: `${DRIZZLE_DIR}/${tag}.sql i ${SUPABASE_DIR}/${entry.twin} różnią się treścią. Bliźniak znaczy BAJT W BAJT - inaczej produkcja i pgTAP testują dwie różne rzeczy.`,
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
