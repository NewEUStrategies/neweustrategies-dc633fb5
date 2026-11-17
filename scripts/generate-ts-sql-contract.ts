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
 *   bun run generate:ts-sql-contract --measure  # MIARA poza bramką (stdout)
 *
 * `--measure` NIE zmienia bramki: drukuje zwykły SQL (nie pgTAP) z faktami
 * miary - kolumny filtrów/sortowania/upsertu i rola klienta ustalona szerzej
 * (`SeamFacts.observed`) - do uruchomienia ręcznie na bazie po migracjach;
 * podsumowanie i miejsca nieczytelne idą na stderr. Plik w `supabase/tests`
 * i wynik `--check` są bajt w bajt te same co bez tej flagi.
 *
 * SQL miary oprócz sprawdzenia uprawnień uruchamia SONDY WYKONANIA (każde
 * zapytanie łańcucha, każda kolumna filtra i RPC funkcji SECURITY INVOKER -
 * jako rola zmierzona, w podtransakcjach, całość w `ROLLBACK`), więc wolno
 * go puszczać WYŁĄCZNIE na bazie jednorazowej (lokalny klaster po
 * migracjach), nigdy na produkcji: wywołania RPC wykonują ciała funkcji.
 * Wynik: podsumowanie sond, potem naruszenia z kolumną `caught_by`.
 *
 * Klient przeglądarki (`@/integrations/supabase/client`) ma w SQL miary DWA
 * wiersze każdego faktu: `authenticated` (z sesją) i `anon` (gość, SSR,
 * handler serwera - klient bez sesji idzie z kluczem publicznym). Zasoby
 * osadzone list `select` (`profiles(slug, ...)`) to osobne fakty na relacji
 * osadzonej, sprawdzane i sondowane ze złączeniem po kluczu obcym.
 */
import { writeFileSync } from "node:fs";
import {
  extractSeamFacts,
  renderContractTest,
  renderObservedQueries,
  seamCoverageProblems,
} from "../src/lib/ci/tsSqlContract";
import { loadProductionSources } from "./lib/onConflictArbitersInputs";

const OUTPUT = "supabase/tests/ts_sql_contract_test.sql";

function measure(): void {
  const facts = extractSeamFacts(loadProductionSources(), undefined, undefined, { observe: true });
  const o = facts.observed;
  const all = [...o.rpcs, ...o.tables];
  const count = <T>(xs: readonly T[], key: (x: T) => string): string =>
    Object.entries(
      xs.reduce<Record<string, number>>((m, x) => {
        m[key(x)] = (m[key(x)] ?? 0) + 1;
        return m;
      }, {}),
    )
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, n]) => `${k}=${n}`)
      .join(", ");
  console.error(
    [
      `miara kontraktu TS <-> SQL (poza bramką):`,
      `  fakty RPC i tabel z rolą unknown: bramka ${all.filter((x) => x.enforcedRole === "unknown").length}, miara ${all.filter((x) => x.role === "unknown").length}`,
      `  rola bramka->miara: ${count(all, (x) => `${x.enforcedRole}->${x.role}`)}`,
      `  kolumny filtrów: ${o.filters.length} (${count(o.filters, (f) => f.role)})`,
      `  zasoby osadzone: ${o.embeds.length} (${count(o.embeds, (e) => e.role)})`,
      `  fakty klienta przeglądarki (także jako gość anon): RPC ${o.rpcs.filter((x) => x.guest).length}, tabele ${o.tables.filter((x) => x.guest).length}, filtry ${o.filters.filter((x) => x.guest).length}, osadzenia ${o.embeds.filter((x) => x.guest).length}, zapytania sond ${o.statements.filter((x) => x.guest).length}`,
      `  zapytania do sond wykonania: ${o.statements.length} (${count(o.statements, (s) => s.role)})`,
      `  miejsca filtrów nieczytelne: ${o.unresolvedFilters.length}`,
      `  wywołania filtra poza rozpoznanym budowniczym: ${o.filtersOutsideChains.length}`,
      ...o.unresolvedFilters.map((x) => `    ? ${x}`),
      ...o.filtersOutsideChains.map((x) => `    ~ ${x}`),
    ].join("\n"),
  );
  process.stdout.write(renderObservedQueries(facts));
}

function main(): void {
  if (process.argv.includes("--measure")) {
    measure();
    return;
  }
  const started = Date.now();
  const facts = extractSeamFacts(loadProductionSources());
  const elapsed = `${((Date.now() - started) / 1000).toFixed(2)} s`;
  const c = facts.coverage;
  const summary =
    `kontrakt TS <-> SQL: ${facts.rpcs.length} wywołań RPC, ${facts.tables.length} operacji na tabelach ` +
    `(+${facts.withheld.length} wstrzymanych w przeglądzie: bez uprawnień), ` +
    `${facts.literals.length} literałów, ${facts.conflicts.length} celów onConflict, ` +
    `${facts.publicColumns.length} stałych kolumn publicznych (${c.files} plików, ` +
    `${c.parseErrors.length} z błędami składni, ${elapsed})`;

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
