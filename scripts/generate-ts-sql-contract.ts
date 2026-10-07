/**
 * Generator kontraktu TypeScript <-> SQL: fakty szwu z kodu produkcyjnego
 * `src/**` -> test pgTAP `supabase/tests/ts_sql_contract_test.sql`.
 *
 * Cienki runner - ekstrakcja (drzewo składniowe kompilatora TS), reguły
 * i render SQL żyją w `src/lib/ci/tsSqlContract.ts`, z testem jednostkowym
 * `src/lib/ci/__tests__/tsSqlContract.test.ts`. Wejście czyta TEN SAM loader co
 * bramka arbitrów onConflict (`scripts/lib/onConflictArbitersInputs.ts`).
 *
 * PLIK NIE JEST W REPOZYTORIUM (`.gitignore`). Kontrakt wynika z bieżącego
 * kodu, więc job `pgtap` w CI generuje go tuż przed `supabase test db`, a lokalny
 * runner (`bun run test:pgtap-local`) - przed testami. Commitowany plik
 * czerwieniłby CI po każdej zmianie zapytania w edytorze (Lovable nie uruchamia
 * generatora), a nie wnosiłby nic ponad sam kod.
 *
 * Usage:
 *   bun run generate:ts-sql-contract            # zapis do supabase/tests/
 *   bun run generate:ts-sql-contract --stdout   # na standardowe wyjście
 *   bun run check:ts-sql-contract               # bez bazy: zasięg ekstrakcji
 */
import { writeFileSync } from "node:fs";
import {
  extractSeamFacts,
  renderContractTest,
  seamCoverageProblems,
} from "../src/lib/ci/tsSqlContract";
import { loadProductionSources } from "./lib/onConflictArbitersInputs";

const OUTPUT = "supabase/tests/ts_sql_contract_test.sql";

function main(): void {
  const started = Date.now();
  const facts = extractSeamFacts(loadProductionSources());
  const elapsed = `${((Date.now() - started) / 1000).toFixed(2)} s`;
  const c = facts.coverage;
  const summary =
    `kontrakt TS <-> SQL: ${facts.rpcs.length} wywołań RPC, ${facts.tables.length} operacji na tabelach, ` +
    `${facts.literals.length} literałów, ${facts.conflicts.length} celów onConflict, ` +
    `${facts.publicColumns.length} stałych kolumn publicznych (${c.files} plików, ${elapsed})`;

  const problems = seamCoverageProblems(facts);
  if (process.argv.includes("--check")) {
    if (problems.length > 0) {
      console.error(`✗ ${summary}\n${problems.map((p) => `    • ${p}`).join("\n")}`);
      process.exit(1);
    }
    console.log(`✓ ${summary}`);
    return;
  }

  const sql = renderContractTest(facts);
  if (process.argv.includes("--stdout")) {
    process.stdout.write(sql);
    return;
  }
  writeFileSync(OUTPUT, sql);
  for (const p of problems) console.warn(`  ! ${p}`);
  console.log(`✓ ${OUTPUT} - ${summary}`);
}

main();
