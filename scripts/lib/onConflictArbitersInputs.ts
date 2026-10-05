/**
 * Wejście bramki arbitrów `onConflict` - JEDEN loader dla runnera
 * (`scripts/check-on-conflict-arbiters.ts`) i testu stanu repozytorium
 * (`src/lib/ci/__tests__/onConflictArbiters.test.ts`).
 *
 * PO CO OSOBNY PLIK. Wcześniej runner i test miały każdy własny walker `src/**`
 * - dwie kopie zakresu skanu rozjeżdżają się po cichu (jedna dostaje nowy
 * katalog do pominięcia, druga nie) i test przestaje mierzyć to, co bramka
 * w CI.
 *
 * DLACZEGO MIGRACJE SĄ SUROWE. `loadMigrationFiles()` ze `sqlMigrations.ts`
 * przepuszcza tekst przez `stripSqlComments`, który nie zna dollar-quote:
 * `$$ SELECT '--' $$` otwiera tam „komentarz" i ucina resztę linii, a
 * niedomknięte przez to ciało połyka następne instrukcje - np. `ALTER TABLE
 * … DROP CONSTRAINT`. Model kluczy widziałby wtedy klucz, którego baza już
 * nie ma - fałszywa zieleń. Moduł bramki ma własny
 * lekser SQL (komentarze zagnieżdżone, `$tag$`, `E'…'`), więc dostaje plik
 * BAJT W BAJT. Zachowanie `loadMigrationFiles()` dla innych bramek zostaje
 * bez zmian.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { MigrationFile, SourceFile } from "../../src/lib/ci/onConflictArbiters";
import { MIGRATIONS_DIR } from "./sqlMigrations";

/** Migracje posortowane po nazwie pliku (= kolejność `db push`/`db reset`), tekst SUROWY. */
export function loadRawMigrationFiles(dir: string = MIGRATIONS_DIR): MigrationFile[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => ({ file, sql: readFileSync(join(dir, file), "utf8") }));
}

/**
 * Testy, atrapy i fixture'y cytują cele konfliktu celowo (także błędne, żeby
 * dowieść, że bramka je łapie) - skan po nich zapalałby bramkę na jej własnej
 * dokumentacji. Zakres jak w `scripts/check-feature-taxonomy.ts`.
 */
const SKIP_DIRS = new Set(["node_modules", "__tests__", "__snapshots__", "__mocks__"]);
const SOURCE_EXT = /\.(?:ts|tsx)$/;
const TEST_FILE = /\.(?:test|spec)\.(?:ts|tsx)$/;

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** Kod produkcyjny `src/**` (bez testów i `src/test/**`), ścieżki względne `/`, tekst surowy. */
export function loadProductionSources(root: string = "src"): SourceFile[] {
  return walk(root, [])
    .map((path) => relative(process.cwd(), path).replaceAll("\\", "/"))
    .filter((file) => SOURCE_EXT.test(file) && !TEST_FILE.test(file))
    .filter((file) => !file.startsWith("src/test/"))
    .sort()
    .map((file) => ({ file, code: readFileSync(file, "utf8") }));
}
