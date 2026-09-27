// BRAMKA ROZMIARU MIGRACJI: plik, ktorego panel Lovable nie wdrozy, nie
// wchodzi do repozytorium.
//
// PRZYCZYNA ZRODLOWA. Migracje tego projektu wdraza Lovable i robi to tylko
// dla plikow do ok. 52 KB: wdrozyl 52 653 B (zapis wdrozenia
// `drizzle/migrations/0057_event_group_guests_follow_lead.sql`, commit
// eaf5f5e88 bota gpt-engineer-app, 2026-09-26 14:53 UTC), a pliki od 62 KB do
// 199 KB odrzucil w calosci ("the files are too large and cannot be split").
// Zadna bramka tego nie widziala: CI jest zielone, harness zielony, a
// produkcja nie dostaje migracji, od ktorej zalezy kod juz scalony na main.
// Bramka zapala sie, ZANIM taki plik trafi do galezi, i mowi, czym go pociac
// (`scripts/split-migration.ts`, logika w `migrationSplit.ts`).
//
// LIMIT = 45 KiB (46 080 B): ponizej najwiekszego wdrozonego pliku (52 653 B)
// z zapasem na naglowek i na to, ze prawdziwy prog Lovable nie jest znany
// dokladniej niz "miedzy 52 a 62 KB".
//
// BAZOWA LINIA = 20260926100000. Uzasadnienie z historii:
//   * 20260926100000_event_group_guests_follow_lead.sql (52 653 B) to
//     NAJWIEKSZY i NAJPOZNIEJSZY duzy plik, ktory Lovable wdrozyl (zapis 0057,
//     commit eaf5f5e88). Po nim Lovable zapisal juz tylko male pliki:
//     0058 (455d88c20, zrodlo 19 737 B), 0062-0064 (15bc840a7, 61d07f5ad,
//     f43c99209, zrodla 13-26 KB), 0065 (c6412fd0a, zrodlo 2 201 B) i 0066
//     (4ac6622c7, zrodlo 30 152 B). Najwiekszy zapis wdrozenia w calym pasie
//     drizzle to wlasnie 0057 - kazdy inny ma ponizej 34 KB.
//   * Kazdy plik ponad limit z wersja WYZSZA od linii (faktury, lejek, plan
//     sali, raport sponsora, skaner offline, fundament uczestnika, braki cz. 3)
//     jest NIEWDROZONY - to dokladnie te, ktore Lovable odrzucil.
//   * Starsze duze pliki (lipiec-sierpien) sa wdrozone: ich tabele sa
//     w `src/integrations/supabase/types.ts` generowanym z bazy produkcyjnej
//     (np. `event_meeting_tables`, `event_checkpoints`, `event_people`,
//     `programs`, `club_thread_documents`), a 20260830090000 ma w
//     `supabase/migration-ledger.json` uzgodnienie na wersje wykonana
//     20260830172534.
// Linia NIE zwalnia hurtem wszystkiego, co pod nia: zwolniony jest wylacznie
// plik z listy `DEPLOYED_OVERSIZE`, i to tylko przy DOKLADNIE zapisanym
// rozmiarze. To nie jest pedanteria: na main w chwili wprowadzenia bramki
// `20260926100000_event_cfp.sql` (203 KB, NIEWDROZONY) dzieli wersje z
// wdrozonym plikiem grup - sama linia by go przepuscila.
//
// PAS DRIZZLE. Lovable czyta takze pliki `drizzle/migrations/`, wiec blizniak
// pliku objetego bramka podlega temu samemu limitowi. Zwolnienie idzie za
// blizniakiem supabase: blizniak wdrozonego pliku z listy jest wdrozony razem
// z nim. Pliki `drizzleOnly` to zapisy wykonania z panelu (juz wykonane) -
// bramka ich nie mierzy.
import { readFileSync, readdirSync, statSync } from "node:fs";
import type { LaneEntry } from "./migrationLaneParity";
import { parseMigrationFile } from "./migrationLedger";
import { DEFAULT_MAX_BYTES } from "./migrationSplit";
import {
  DRIZZLE_MIGRATIONS_DIR,
  SUPABASE_MIGRATIONS_DIR,
  continuationParts,
} from "./migrationSplitPlan";

export const MIGRATION_MAX_BYTES = DEFAULT_MAX_BYTES;

/** Migracje o wersji <= linii moga byc zwolnione (tylko z listy nizej). */
export const MIGRATION_SIZE_BASELINE = "20260926100000";

/**
 * Wdrozone pliki ponad limit, z rozmiarem w bajtach w chwili wdrozenia.
 * Lista jest ZAMKNIETA: nowy wpis znaczylby, ze ktos wdrozyl duzy plik bez
 * Lovable albo zmienil wdrozona migracje - oba przypadki wymagaja przegladu.
 */
export const DEPLOYED_OVERSIZE: Readonly<Record<string, number>> = {
  "20260712224838_5de38579-3d42-4cfa-a8bc-d87e799bbc2c.sql": 48312,
  "20260714130000_expert_hub.sql": 142589,
  "20260721120000_crm_tasks_followups.sql": 51077,
  "20260725120000_analytics_semantic_layer.sql": 53990,
  "20260808110000_discussion_clubs_a8_hardening.sql": 75506,
  "20260808300000_discussion_clubs_a28_workspace.sql": 51914,
  "20260808310000_discussion_clubs_a28_thread_workspace.sql": 85259,
  "20260810105134_d5d870da-90ed-455b-b950-3764d7a62e17.sql": 51140,
  "20260810120000_discussion_clubs_a32_networking.sql": 51141,
  "20260811150000_discussion_clubs_a35_applications_fixes.sql": 72885,
  "20260822171037_bea8e790-36d6-4b46-b752-c39b673da2ea.sql": 53149,
  "20260823140000_event_sessions.sql": 128510,
  "20260823150000_event_people_registration.sql": 182867,
  "20260823160000_event_sponsors_companies.sql": 116140,
  "20260823170000_event_front_binding.sql": 65071,
  "20260823180000_event_onsite.sql": 193011,
  "20260823190000_event_meetings.sql": 204500,
  "20260824080000_event_admissions_packages_coupons.sql": 76879,
  "20260825191948_ab7f57aa-961d-436a-ba0f-2fd114f42844.sql": 53740,
  "20260830090000_event_registration_checkout_binding.sql": 47447,
  "20260926100000_event_group_guests_follow_lead.sql": 52653,
};

export interface SizeConfig {
  readonly baseline: string;
  readonly limit: number;
  readonly deployed: Readonly<Record<string, number>>;
}

export const SIZE_CONFIG: SizeConfig = {
  baseline: MIGRATION_SIZE_BASELINE,
  limit: MIGRATION_MAX_BYTES,
  deployed: DEPLOYED_OVERSIZE,
};

export interface SizedFile {
  /** Nazwa pliku (`20260926180000_x.sql`, `0067_x.sql`). */
  readonly name: string;
  readonly bytes: number;
}

export type SizeViolationKind =
  "za-duza" | "za-duza-pod-linia" | "za-duzy-blizniak" | "zwolnienie-nieaktualne";

export interface SizeViolation {
  readonly kind: SizeViolationKind;
  readonly file: string;
  readonly detail: string;
}

export interface SizeReport {
  readonly checked: number;
  readonly exempt: number;
  readonly violations: readonly SizeViolation[];
}

const splitHint = (file: string): string =>
  `Pociac: bun run scripts/split-migration.ts ${SUPABASE_MIGRATIONS_DIR}/${file} (--dry-run najpierw).`;

/** Zestawia rozmiary obu pasow z limitem, linia i lista wdrozonych wyjatkow. */
export function analyzeMigrationSizes(
  input: {
    readonly supabase: readonly SizedFile[];
    readonly drizzle: readonly SizedFile[];
    readonly lanes: readonly LaneEntry[];
  },
  config: SizeConfig = SIZE_CONFIG,
): SizeReport {
  const violations: SizeViolation[] = [];
  let exempt = 0;
  const bySupabase = new Map(input.supabase.map((f) => [f.name, f.bytes]));

  for (const file of input.supabase) {
    if (file.bytes <= config.limit) continue;
    const version = parseMigrationFile(file.name)?.version;
    const aboveLine = version === undefined || version > config.baseline;
    if (!aboveLine && config.deployed[file.name] === file.bytes) {
      exempt += 1;
      continue;
    }
    violations.push(
      aboveLine
        ? {
            kind: "za-duza",
            file: `${SUPABASE_MIGRATIONS_DIR}/${file.name}`,
            detail: `${file.bytes} B > limit ${config.limit} B - Lovable tego pliku nie wdrozy. ${splitHint(file.name)}`,
          }
        : {
            kind: "za-duza-pod-linia",
            file: `${SUPABASE_MIGRATIONS_DIR}/${file.name}`,
            detail: `${file.bytes} B > limit ${config.limit} B przy wersji <= ${config.baseline}, a pliku nie ma na liscie wdrozonych (DEPLOYED_OVERSIZE) w tym rozmiarze. Niewdrozona migracja ze stara wersja albo zmieniona wdrozona - nadaj nowa wersje i potnij. ${splitHint(file.name)}`,
          },
    );
  }

  for (const [name, bytes] of Object.entries(config.deployed)) {
    const actual = bySupabase.get(name);
    const version = parseMigrationFile(name)?.version;
    if (actual === bytes && version !== undefined && version <= config.baseline) continue;
    violations.push({
      kind: "zwolnienie-nieaktualne",
      file: `${SUPABASE_MIGRATIONS_DIR}/${name}`,
      detail:
        actual === undefined
          ? `Wpis DEPLOYED_OVERSIZE bez pliku - martwe zwolnienie maskuje znikniecie migracji.`
          : `Wpis DEPLOYED_OVERSIZE (${bytes} B) nie pasuje do pliku (${actual} B) albo lezy ponad linia ${config.baseline}. Wdrozonej migracji sie nie zmienia.`,
    });
  }

  const twinOf = new Map<string, string>();
  for (const entry of input.lanes) if ("twin" in entry) twinOf.set(`${entry.tag}.sql`, entry.twin);
  for (const file of input.drizzle) {
    const twin = twinOf.get(file.name);
    if (twin === undefined || file.bytes <= config.limit) continue;
    const version = parseMigrationFile(twin)?.version;
    if (
      version !== undefined &&
      version <= config.baseline &&
      config.deployed[twin] !== undefined
    ) {
      exempt += 1;
      continue;
    }
    violations.push({
      kind: "za-duzy-blizniak",
      file: `${DRIZZLE_MIGRATIONS_DIR}/${file.name}`,
      detail: `${file.bytes} B > limit ${config.limit} B (blizniak ${twin}). Skrypt tnie oba pasy naraz. ${splitHint(twin)}`,
    });
  }

  return {
    checked: input.supabase.length + input.drizzle.length,
    exempt,
    violations,
  };
}

export function renderSizeReport(report: SizeReport): string {
  const head = `Rozmiar migracji: ${report.checked} plikow, ${report.exempt} wdrozonych ponad limit zwolnionych.`;
  if (report.violations.length === 0) return `${head} Zgodne.`;
  return [
    head,
    `NARUSZENIA (${report.violations.length}):`,
    ...report.violations.map((v) => `  [${v.kind}] ${v.file}: ${v.detail}`),
  ].join("\n");
}

/** Dostep do dysku - wstrzykiwalny, zeby testy nie dotykaly repozytorium. */
export interface MigrationFs {
  readonly list: (dir: string) => string[];
  readonly size: (path: string) => number;
  readonly read: (path: string) => string | null;
}

export const nodeMigrationFs: MigrationFs = {
  list: (dir) => readdirSync(dir),
  size: (path) => statSync(path).size,
  read: (path) => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  },
};

/** Rozmiary plikow `.sql` obu pasow (bajty na dysku == bajty UTF-8). */
export function collectMigrationSizes(fs: MigrationFs = nodeMigrationFs): {
  supabase: SizedFile[];
  drizzle: SizedFile[];
} {
  const sized = (dir: string): SizedFile[] =>
    fs
      .list(dir)
      .filter((name) => name.endsWith(".sql"))
      .sort()
      .map((name) => ({ name, bytes: fs.size(`${dir}/${name}`) }));
  return { supabase: sized(SUPABASE_MIGRATIONS_DIR), drizzle: sized(DRIZZLE_MIGRATIONS_DIR) };
}

/**
 * Cala LOGICZNA migracja: plik i jego czesci 2..n (po naglowku
 * `migration-split`) sklejone znakiem nowej linii. Dla testow, ktore czytaja
 * tresc migracji po nazwie - po podziale plik `file` niesie tylko czesc 1.
 */
export function readLogicalMigration(
  dir: string,
  file: string,
  fs: MigrationFs = nodeMigrationFs,
): string {
  const read = (name: string): string | null => fs.read(`${dir}/${name}`);
  const main = read(file);
  if (main === null) throw new Error(`Brak migracji ${dir}/${file}.`);
  const parts = continuationParts(file, fs.list(dir), read);
  return [main, ...parts.map((name) => read(name)!)].join("\n");
}
