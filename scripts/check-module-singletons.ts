/**
 * Bramka CI: pakiety ze stanem modułu mają w `bun.lock` jedną kopię.
 *
 * Dwa incydenty z 2026-09-22 (PR #389 - dwie kopie warstw Radixa, okno w oknie
 * zamykało się przy pierwszym kliknięciu; PR #390 - druga kopia `@babel/traverse`,
 * siedem stron przestało się ładować) miały jedną przyczynę: zagnieżdżony wpis
 * w pliku blokady. Oba wyszły dopiero na czerwonym e2e, po godzinach diagnozy.
 *
 * Logika jest czysta i otestowana w `src/lib/ci/__tests__/moduleSingletons.test.ts`
 * - ten skrypt tylko czyta `bun.lock` i ustawia kod wyjścia.
 *
 * Tryby:
 *   bun run check:module-singletons   - bramka: kod 1 przy drugiej kopii,
 *   ... --warn                        - ostrzeżenie bez kodu błędu; tak woła go
 *                                       `postinstall`, żeby komunikat padł przy
 *                                       pierwszym `bun install`, a instalacja
 *                                       nigdy nie została przerwana.
 */
import { readFileSync } from "node:fs";
import {
  findSingletonDuplicates,
  lockPackages,
  renderSingletonReport,
  singletonCheckFailed,
} from "../src/lib/ci/moduleSingletons";

const warnOnly = process.argv.includes("--warn");

function main(): void {
  const report = findSingletonDuplicates(lockPackages(readFileSync("bun.lock", "utf8")));
  const rendered = renderSingletonReport(report);
  if (!singletonCheckFailed(report)) {
    if (!warnOnly) console.log(rendered);
    return;
  }
  console.error(rendered);
  if (!warnOnly) process.exit(1);
}

try {
  main();
} catch (error) {
  // Tryb `--warn` biegnie w `postinstall`: niespodziewany format pliku blokady
  // ma dać ostrzeżenie, nie przerwaną instalację. Bramka w CI pada głośno.
  if (!warnOnly) throw error;
  console.error(`[module-singletons] ! nie udało się odczytać bun.lock: ${String(error)}`);
}
