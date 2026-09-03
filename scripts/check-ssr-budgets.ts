/**
 * Bramka BUDŻETÓW WEWNĘTRZNYCH POTOKU SSR - trzech liczb, których do
 * 2026-09-03 nie pilnowało nic:
 *
 *   1. szeregowany budżet rozgrzewki PRZED PIERWSZYM BAJTEM (fale loadera
 *      korzenia oraz najdłuższy łańcuch `await withBudget` w loaderze trasy);
 *   2. liczba RÓWNOLEGŁYCH podżądań w jednej tablicy `Promise.all*` loadera -
 *      runtime Cloudflare Workers odrzuca siódmy subrequest na żądanie;
 *   3. DEHYDRATOWANY STAN wstrzykiwany do HTML-a: trzy inwarianty strukturalne
 *      z `src/router.tsx` plus proxy liczby wpisów zasilających payload.
 *
 * Bramka czyta WYŁĄCZNIE ŹRÓDŁA - nie potrzebuje builda, artefaktu, bazy ani
 * przeglądarki - dlatego biegnie w jobie `verify`, a nie `build`, i jej wynik
 * jest identyczny na każdej maszynie.
 *
 * Cienki runner - inwariant, sufity i ich uzasadnienie żyją w
 * `src/lib/ci/ssrBudgets.ts` (konwencja jak `check-content-layering.ts`).
 * Dzięki temu inwariant ma TEST JEDNOSTKOWY Z KONTROLĄ NEGATYWNĄ
 * (`src/lib/ci/__tests__/ssrBudgets.test.ts`) - czyli dowód, że bramka oblewa
 * na zepsutym wejściu - a nie tylko przebieg w CI.
 *
 * Usage: bun run check:ssr-budgets
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  analyzeSsrBudgets,
  renderSsrBudgetReport,
  ssrBudgetsFailed,
  type SsrBudgetSource,
} from "../src/lib/ci/ssrBudgets";

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "coverage", "__tests__"]);

/**
 * Skanujemy trasy (tam mieszkają loadery i ich budżety), `src/router.tsx`
 * (tam mieszkają inwarianty dehydracji) oraz `src/lib` - to ostatnie WYŁĄCZNIE
 * po to, żeby rozwiązać stałe budżetowe IMPORTOWANE do tras
 * (`src/routes/support.tsx:38` bierze `SUPPORT_DOC_BUDGET_MS` z
 * `@/lib/supportRouteConfig`). Pliki `src/lib` nie mają opcji trasy, więc nie
 * wnoszą loaderów - wnoszą tylko liczby.
 *
 * Katalogi testowe są pomijane: plik testowy cytujący `await withBudget(...)`
 * nie jest loaderem produkcyjnym.
 */
const SCAN_TARGETS = ["src/routes", "src/router.tsx", "src/lib"] as const;

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function collect(): SsrBudgetSource[] {
  const paths: string[] = [];
  for (const target of SCAN_TARGETS) {
    if (statSync(target).isDirectory()) walk(target, paths);
    else paths.push(target);
  }
  return (
    paths
      .map((path) => relative(process.cwd(), path).replaceAll("\\", "/"))
      .filter((file) => /\.tsx?$/.test(file) && !file.endsWith(".d.ts"))
      // `routeTree.gen.ts` jest generowany i nie zawiera loaderów - tylko sklejenie.
      .filter((file) => !file.endsWith("routeTree.gen.ts"))
      .map((file) => ({ file, source: readFileSync(file, "utf8") }))
  );
}

function main(): void {
  const report = analyzeSsrBudgets({ sources: collect() });
  const rendered = renderSsrBudgetReport(report);

  if (ssrBudgetsFailed(report)) {
    console.error(rendered);
    process.exit(1);
  }
  console.log(rendered);
}

main();
