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
// BAZOWA LINIA = 20260926100001 i zamknieta lista wdrozonych plikow ponad
// limit (`DEPLOYED_OVERSIZE`) - uzasadnienie z historii w migrationDeployed.ts
// (wspolne z planem podzialu, ktory wdrozonej migracji nie tnie). Linia NIE
// zwalnia hurtem wszystkiego, co pod nia: zwolniony jest wylacznie plik
// z listy, i to tylko przy DOKLADNIE zapisanym rozmiarze.
//
// PAS DRIZZLE. Lustro z `bun run migrations:mirror` to naglowek generatora
// i plik supabase bajt w bajt, a migrator czyta je z repozytorium - wiec limit
// obowiazuje plik supabase razem z naglowkiem. Mierzy go generator na
// DOSTARCZANYM pliku (blad `za-duzy` w `check:migration-lanes`); za duza
// migracje tnie sie w pasie supabase, a lustra czesci generuje on sam.
// Prog 52-62 KB zmierzono, gdy panel Lovable przepisywal migracje na wpisy
// dziennika (faza A, do 2026-10-18); bez nowego pomiaru limitu nie luzujemy.
// Pliki `drizzleOnly` to zapisy wykonania z panelu (juz wykonane) - limit ich
// nie dotyczy.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { DEPLOYED_OVERSIZE, MIGRATION_SIZE_BASELINE } from "./migrationDeployed";
import { DEFAULT_MAX_BYTES } from "./migrationSplit";
import { continuationParts } from "./migrationSplitPlan";

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
