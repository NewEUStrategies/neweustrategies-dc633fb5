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
 *   bun run generate:ts-sql-contract              # zapis do supabase/tests/
 *   bun run generate:ts-sql-contract --stdout     # na standardowe wyjście
 *   bun run check:ts-sql-contract                 # bez bazy: zasięg ekstrakcji i listy
 *   bun run generate:ts-sql-contract --guest-gaps # klucze (plik, funkcja, relacja) padające jako gość (SQL)
 *   bun run generate:ts-sql-contract --measure    # pełna miara z podsumowaniem sond (SQL)
 *
 * Bramka (plik pgTAP i `--check`) liczy fakty MIARY (`SeamFacts.observed`):
 * rolę klienta ustaloną szerzej niż reguły bramki, kolumny filtrów,
 * sortowania i upsertu, zasoby osadzone, zapytania do sond wykonania i wiersze
 * gościa (`anon`) faktów klienta przeglądarki w plikach osiągalnych dla
 * gościa (`src/lib/ci/guestReach.ts`). `--check` (bez bazy) pilnuje list
 * przejrzanych (`UNKNOWN_ROLE_REVIEWED`, `GUEST_LOGIN_ONLY_REVIEWED`,
 * `GATED_ROUTES_REVIEWED` - trasy z bramką sesji, `src/lib/ci/guestReach.ts`) i zapadek
 * filtrów nieczytelnych.
 *
 * `--guest-gaps` drukuje zwykły SQL (nie pgTAP) z tymi samymi tabelami,
 * sondami i widokami naruszeń co plik pgTAP; na bazie JEDNORAZOWEJ po
 * migracjach (`psql -f`) zwraca klucze (plik wywołania, funkcja, relacja),
 * które jako gość padają, ze szkieletem wpisu (liczba faktów, kształt) -
 * wejście przeglądu `GUEST_LOGIN_ONLY_REVIEWED` (wpis wyłącznie dla miejsca
 * tylko po zalogowaniu, z dowodem bramki `plik:linia`; reszta to defekty do
 * naprawy).
 *
 * `--measure` drukuje zwykły SQL (nie pgTAP) pełnej miary - wszystkie
 * naruszenia z drogą ustalenia roli, osiągalnością i podsumowaniem sond -
 * do uruchomienia ręcznie na bazie po migracjach; podsumowanie i miejsca
 * nieczytelne idą na stderr.
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
 * osadzonej, sprawdzane i sondowane ze złączeniem po kluczu obcym. Kolumna
 * `reach` naruszeń to osiągalność pliku wywołania dla gościa
 * (`src/lib/ci/guestReach.ts`): `public` - kandydat na defekt widoczny dla
 * gościa (do przeczytania: `enabled: !!user`, render tylko z sesją),
 * `session-gate`/`admin` - za logowaniem, `none` - bez ścieżki z trasy.
 */
import { writeFileSync } from "node:fs";
import { gatedRouteProblems, guestReach } from "../src/lib/ci/guestReach";
import {
  checkedRoles,
  extractSeamFacts,
  renderContractTest,
  renderGuestGaps,
  renderObservedQueries,
  seamCoverageProblems,
} from "../src/lib/ci/tsSqlContract";
import { loadProductionSources } from "./lib/onConflictArbitersInputs";

const OUTPUT = "supabase/tests/ts_sql_contract_test.sql";

function measure(): void {
  const sources = loadProductionSources();
  const facts = extractSeamFacts(sources, undefined, undefined, { observe: true });
  const reach = guestReach(sources);
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
      `  kolumny wyniku RPC (filtry, sortowanie, select łańcucha .rpc): ${o.rpcColumns.length}`,
      `  zasoby osadzone: ${o.embeds.length} (${count(o.embeds, (e) => e.role)})`,
      `  fakty klienta przeglądarki (także jako gość anon): RPC ${o.rpcs.filter((x) => x.guest).length}, tabele ${o.tables.filter((x) => x.guest).length}, filtry ${o.filters.filter((x) => x.guest).length}, osadzenia ${o.embeds.filter((x) => x.guest).length}, zapytania sond ${o.statements.filter((x) => x.guest).length}`,
      `  zapytania do sond wykonania: ${o.statements.length} (${count(o.statements, (s) => s.role)})`,
      `  pliki z faktami gościa wg osiągalności: ${count(
        [
          ...new Set(
            [...o.rpcs, ...o.tables, ...o.filters, ...o.embeds]
              .filter((x) => x.guest)
              .map((x) => x.site),
          ),
        ],
        (site) => reach.get(site)?.cls ?? "none",
      )}`,
      `  miejsca filtrów nieczytelne: ${o.unresolvedFilters.length}`,
      `  wywołania filtra poza rozpoznanym budowniczym: ${o.filtersOutsideChains.length}`,
      ...o.unresolvedFilters.map((x) => `    ? ${x}`),
      ...o.filtersOutsideChains.map((x) => `    ~ ${x}`),
    ].join("\n"),
  );
  process.stdout.write(renderObservedQueries(facts, reach));
}

function guestGaps(): void {
  const sources = loadProductionSources();
  const facts = extractSeamFacts(sources, undefined, undefined, { observe: true });
  const reach = guestReach(sources);
  const keys = new Map<string, string>();
  for (const x of [
    ...facts.observed.rpcs,
    ...facts.observed.tables,
    ...facts.observed.filters,
    ...facts.observed.embeds,
    ...facts.observed.statements,
  ]) {
    if (checkedRoles(x).some((c) => c.guest && c.role === "authenticated")) {
      keys.set(`${x.site}: ${x.fn}`, reach.get(x.site)?.cls ?? "none");
    }
  }
  const byClass = [...keys.values()].reduce<Record<string, number>>((m, cls) => {
    m[cls] = (m[cls] ?? 0) + 1;
    return m;
  }, {});
  console.error(
    `kontrakt TS <-> SQL --guest-gaps: ${keys.size} par (plik, funkcja) z faktami klienta przeglądarki ` +
      `(${Object.entries(byClass)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([cls, n]) => `${cls}=${n}`)
        .join(", ")}); jako gość sprawdzane public i none bez wpisu GUEST_LOGIN_ONLY_REVIEWED ` +
      `(klucz: plik, funkcja, relacja - kolumna \`key\`; szkielet wpisu z liczbą i kształtem - kolumna \`entry\`). ` +
      `SQL na stdout - uruchom na bazie jednorazowej po migracjach (psql -f).`,
  );
  process.stdout.write(renderGuestGaps(facts, { reach }));
}

function main(): void {
  if (process.argv.includes("--measure")) {
    measure();
    return;
  }
  if (process.argv.includes("--guest-gaps")) {
    guestGaps();
    return;
  }
  const started = Date.now();
  const sources = loadProductionSources();
  const facts = extractSeamFacts(sources, undefined, undefined, { observe: true });
  const reach = guestReach(sources);
  const elapsed = `${((Date.now() - started) / 1000).toFixed(2)} s`;
  const c = facts.coverage;
  const o = facts.observed;
  const summary =
    `kontrakt TS <-> SQL: ${facts.rpcs.length} wywołań RPC, ${facts.tables.length} operacji na tabelach ` +
    `(+${facts.withheld.length} wstrzymanych w przeglądzie: bez uprawnień), ` +
    `${facts.literals.length} literałów, ${facts.conflicts.length} celów onConflict, ` +
    `${facts.publicColumns.length} stałych kolumn publicznych; miara: ${o.filters.length} kolumn filtrów, ` +
    `${o.rpcColumns.length} kolumn wyniku RPC, ` +
    `${o.embeds.length} osadzeń, ${o.statements.length} zapytań do sond, ` +
    `${[...o.rpcs, ...o.tables].filter((x) => x.role === "unknown").length} faktów z rolą nieustaloną ` +
    `(bez kandydata roli: ${[...o.rpcs, ...o.tables].filter((x) => checkedRoles(x).length === 0).length}) ` +
    `(${c.files} plików, ${c.parseErrors.length} z błędami składni, ${elapsed})`;

  // Trasy z bramką sesji zwalniają poddrzewo z wierszy gościa - lista
  // przejrzana (`GATED_ROUTES_REVIEWED`) musi być równa bramkom w kodzie.
  const problems = [
    ...seamCoverageProblems(facts, undefined, {
      reach,
      sources: new Map(sources.map((s) => [s.file, s.code])),
    }),
    ...gatedRouteProblems(sources),
  ];
  if (process.argv.includes("--check")) {
    if (problems.length > 0) {
      console.error(`✗ ${summary}\n${problems.map((p) => `    • ${p}`).join("\n")}`);
      process.exit(1);
    }
    console.log(`✓ ${summary}`);
    return;
  }

  const sql = renderContractTest(facts, undefined, { reach });
  if (process.argv.includes("--stdout")) {
    process.stdout.write(sql);
    return;
  }
  writeFileSync(OUTPUT, sql);
  for (const p of problems) console.warn(`  ! ${p}`);
  console.log(`✓ ${OUTPUT} - ${summary}`);
}

main();
