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
// BAZOWA LINIA = 20260926100000 i zamknieta lista wdrozonych plikow ponad
// limit (`DEPLOYED_OVERSIZE`) - uzasadnienie z historii w migrationDeployed.ts
// (wspolne z planem podzialu, ktory wdrozonej migracji nie tnie). Linia NIE
// zwalnia hurtem wszystkiego, co pod nia: zwolniony jest wylacznie plik
// z listy, i to tylko przy DOKLADNIE zapisanym rozmiarze.
//
// PAS DRIZZLE. Lovable czyta takze pliki `drizzle/migrations/`, wiec blizniak
// pliku objetego bramka podlega temu samemu limitowi. Zwolnienie idzie za
// blizniakiem supabase: blizniak wdrozonego pliku z listy jest wdrozony razem
// z nim. Pliki `drizzleOnly` to zapisy wykonania z panelu (juz wykonane) -
// bramka ich nie mierzy.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { DEPLOYED_OVERSIZE, MIGRATION_SIZE_BASELINE } from "./migrationDeployed";
import type { LaneEntry } from "./migrationLaneParity";
import { parseMigrationFile } from "./migrationLedger";
import { DEFAULT_MAX_BYTES } from "./migrationSplit";
import {
  DRIZZLE_MIGRATIONS_DIR,
  SUPABASE_MIGRATIONS_DIR,
  continuationParts,
} from "./migrationSplitPlan";

export const MIGRATION_MAX_BYTES = DEFAULT_MAX_BYTES;

export { DEPLOYED_OVERSIZE, MIGRATION_SIZE_BASELINE };

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
