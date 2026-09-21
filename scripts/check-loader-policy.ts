/**
 * Bramka POLITYKI LOADERA TRASY PUBLICZNEJ - trzy wzorce systemowe z audytu
 * CWV 2026-09-20 (§4.4), których do tej pory nie pilnowało nic:
 *
 *   W1. loader, który MOŻE ZDEGRADOWAĆ, ogłasza WŁASNĄ politykę `Cache-Control`.
 *       Bez tego odpowiedź dostaje z `defaultCacheControlMiddleware` domyślne
 *       `public, s-maxage=900, stale-while-revalidate=86400` - czyli render
 *       niepełny utrwala się na brzegu na 15 minut świeżości plus dobę okna
 *       stale. Audyt naliczył 42 takie trasy (F07); ta bramka zamyka wzorzec.
 *   W2. publiczny loader wołający SIEĆ ma BUDŻET czasu - inaczej czas do
 *       pierwszego bajtu ogranicza wyłącznie watchdog zapytań SSR, a ten
 *       kończy się rzutem, czyli statusem 500.
 *   W4. PARYTET KLUCZY: loader grzeje TEN klucz, który czyta komponent.
 *       Rozjazd (`xKeys.bySlug` vs `xKeys.bySlugViewer`) daje dwa odczyty tej
 *       samej karty i szkielet w SSR - tak działało czternaście tras
 *       `/club/$clubSlug/**` (F09).
 *
 * Bramka czyta WYŁĄCZNIE ŹRÓDŁA - nie potrzebuje builda, artefaktu, bazy ani
 * przeglądarki - dlatego biegnie w jobie `verify`, a nie `build`, i jej wynik
 * jest identyczny na każdej maszynie.
 *
 * Cienki runner: inwariant, zamrożone listy wyjątków i ich uzasadnienie żyją
 * w `src/lib/ci/loaderPolicy.ts` (konwencja jak `check-ssr-budgets.ts`).
 * Dzięki temu inwariant ma TEST JEDNOSTKOWY Z KONTROLĄ NEGATYWNĄ
 * (`src/lib/ci/__tests__/loaderPolicy.test.ts`) - czyli dowód, że bramka
 * oblewa na zepsutym wejściu - a nie tylko przebieg w CI.
 *
 * Usage: bun run check:loader-policy
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  analyzeLoaderPolicy,
  loaderPolicyFailed,
  renderLoaderPolicyReport,
  type LoaderPolicySource,
} from "../src/lib/ci/loaderPolicy";

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "coverage", "__tests__"]);

/**
 * Skanujemy WYŁĄCZNIE `src/routes` - wszystkie trzy reguły dotyczą opcji trasy
 * i jej komponentu, a te mieszkają w jednym pliku. Odsiew gałęzi niepublicznych
 * (`admin`, `api`, `platform`, `preview`, …) i plików bez loadera robi
 * `isPublicRouteFile` / `loaderPolicyFacts`, żeby reguła doboru plików miała
 * jedno miejsce i własny test, a nie żyła w runnerze.
 */
const SCAN_ROOT = "src/routes";

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function collect(): LoaderPolicySource[] {
  return walk(SCAN_ROOT, [])
    .map((path) => relative(process.cwd(), path).replaceAll("\\", "/"))
    .filter((file) => /\.tsx?$/.test(file) && !file.endsWith(".d.ts"))
    .map((file) => ({ file, source: readFileSync(file, "utf8") }));
}

function main(): void {
  const report = analyzeLoaderPolicy({ sources: collect() });
  const rendered = renderLoaderPolicyReport(report);

  if (loaderPolicyFailed(report)) {
    console.error(rendered);
    process.exit(1);
  }
  console.log(rendered);
}

main();
