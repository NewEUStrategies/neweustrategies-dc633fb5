/**
 * RAPORT: trasy publiczne z SSR a ich loadery.
 *
 * PO CO. Audyt SSR (2026-09-01) zapisał ustalenie „59 tras publicznych z SSR bez
 * loadera" bez metody, więc rozdz. 6 raportu
 * `docs/WDROZENIE_SSR_HYDRATACJA_PIERWSZE_WCZYTANIE_2026-09-01.md` odsyłał do
 * skryptu spisu, którego nie było. To jest ten skrypt. Liczby, które oddaje, są
 * zdefiniowane i sprawdzalne - inwariant, kryteria i granice metody stoją
 * w `src/lib/ci/publicRouteLoaders.ts` (cienki runner, konwencja jak
 * `check-content-layering.ts`), a dzięki temu mają test jednostkowy
 * (`src/lib/ci/__tests__/publicRouteLoaders.test.ts`), nie tylko przebieg w CI.
 *
 * NIE WYMAGA BUILDA. Spis tras stoi na `src/routeTree.gen.ts` i na źródłach
 * w `src/**`, więc działa na czystym klonie i nie zagląda do `.output/`.
 * Manifest builda nie wniósłby tu nic: `.output/` zna nazwy chunków, a nie
 * to, czy loader trasy rozgrzewa klucz zapytania.
 *
 * DENY-LISTA NES EDGE CACHE. Werdykt „SSR bez treści" nie jest jeszcze kosztem:
 * dokument, którego cache NIGDY nie zapisuje, oddaje szkielet ładowania tylko
 * temu jednemu żądaniu. Dlatego runner rozbija listę na tę część, która wchodzi
 * do NES Edge Cache, i tę spod `PUBLIC_DOCUMENT_DENY_PREFIXES` - lista jest
 * IMPORTOWANA z `src/lib/http/documentCache.ts`, nie przepisana, bo to ta sama
 * tablica, którą konsumują `planDocumentCache` i generator Speculation Rules.
 * Rozbicie, nie odfiltrowanie: trasa spod deny-listy i tak jest wymieniona,
 * bo bez treści w SSR zostaje wolniejszy first paint dla użytkownika.
 *
 * Usage:
 *   bun run report:route-loaders                  # raport, kod wyjścia 0
 *   bun run report:route-loaders --gate           # + kod 1, gdy lista rośnie
 *   npx tsx scripts/report-public-route-loaders.ts
 *
 * Sprawdzone w tym środowisku: `bun` 1.3.11 (jak pozostałe skrypty w `scripts/`)
 * oraz `npx tsx` na node 22.22.2 - oba dają identyczny wynik, bo skrypt używa
 * tylko `node:fs`/`node:path`.
 *
 * --gate JEST DOMYŚLNIE WYŁĄCZONE i to jest decyzja, nie przeoczenie. Bramka na
 * „zero tras o samych zimnych kluczach" byłaby dziś czerwona na `main` (patrz liczby
 * niżej), a bramka czerwona na wejściu nie pilnuje niczego - uczy tylko
 * obchodzenia. Wariant `--gate` porównuje z ZAMROŻONYM stanem wejściowym, czyli
 * nie pozwala listy WYDŁUŻYĆ i wymaga obniżenia progu przy każdej naprawie -
 * ten sam wzorzec, co `budget()` w `check-bundle-size.ts`.
 *
 * PROGI - ZMIERZONE 2026-09-01 tym skryptem, gałąź
 * `claude/ssr-hydration-public-page-wkrnre`, HEAD `1e3e1a4`:
 *   368 tras w `routeTree.gen.ts` -> 82 publiczne strony SSR
 *   -> 21 czyta WYŁĄCZNIE zimne klucze (13 bez loadera w łańcuchu + 8
 *      z loaderem, który tych kluczy nie grzeje) -> z tego 16 wchodzi do NES
 *      Edge Cache, 5 stoi na deny-liście.
 * `FROZEN_MISSING` = 21 pilnuje całości, `FROZEN_CACHEABLE` = 16 tej części,
 * która realnie kosztuje. Oba są SUFITAMI, nie podłogami: rosnąć nie wolno
 * żadnemu, a naprawa obniża oba.
 *
 * POPRAWKA WZGLĘDEM PIERWSZEJ WERSJI (progi 24/19). Spis nie zaliczał loaderów
 * tras PRZODKÓW, więc `/events/$slug` i `/events/$slug/speakers` wychodziły na
 * zimne, choć ich nagłówek grzeje loader powłoki `events.$slug.tsx:116`.
 * W drugą stronę spis zaliczał loader po samym fakcie, że coś grzeje - stąd
 * cztery strony dokumentowe (`/polityka-prywatnosci`, `/regulamin`,
 * `/zwroty-i-reklamacje`, `/zatrudniamy`) uchodziły za rozgrzane, choć ich
 * loader grzeje tylko `staticPageSeoQueryOptions`, a treść schodzi z innego
 * klucza. Poprawka dodała też kubełek dla pięciu podstron modułowych wydarzeń
 * (treść dowozi przodek) - stąd 24 -> 21.
 *
 * ILE Z „59" ZOSTAŁO. Ustalenie audytu nie potwierdza się w żadnym czytaniu:
 * tras publicznych z SSR jest 82, a takich, których żadnego klucza nie grzeje
 * loader w łańcuchu - 21 (13 bez loadera w łańcuchu + 8 z loaderem, który tych
 * kluczy nie dotyka). Liczba 59 nie wychodzi też z żadnego naiwnego pomiaru:
 * `grep -L "loader:" src/routes/*.tsx` bez `admin*` daje 65, po odjęciu gałęzi
 * `/profile` - 42, po odjęciu tras `ssr: false` - 56. Metoda, która dała 59,
 * nie jest w audycie zapisana i nie da się jej odtworzyć.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  analysePublicRouteLoaders,
  renderPublicRouteLoaderReport,
  routesMissingWarmedLoader,
  type RouteFacts,
} from "../src/lib/ci/publicRouteLoaders";
import { PUBLIC_DOCUMENT_DENY_PREFIXES } from "../src/lib/http/documentCache";

const SCAN_ROOT = "src";
const ROUTE_TREE = "src/routeTree.gen.ts";
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "coverage"]);
const SCANNABLE = /\.(ts|tsx)$/;
/** Stan wejściowy całej listy „SSR bez treści" - sufit dla `--gate`. Obniżaj przy naprawach. */
const FROZEN_MISSING = 21;
/** Ta część listy, której pusty dokument NAPRAWDĘ wchodzi do NES Edge Cache. */
const FROZEN_CACHEABLE = 16;
const RULE = "-".repeat(78);

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function collectSources(): Map<string, string> {
  const sources = new Map<string, string>();
  for (const path of walk(SCAN_ROOT, [])) {
    const file = relative(process.cwd(), path).replaceAll("\\", "/");
    if (!SCANNABLE.test(file)) continue;
    sources.set(file, readFileSync(file, "utf8"));
  }
  return sources;
}

/**
 * Czy pusty dokument tej trasy WCHODZI do NES Edge Cache. Ta sama reguła co
 * `isDeniedPath` w `lib/http/documentCache.ts`, tylko na ścieżce trasy (bez
 * prefiksu języka - `routeTree.gen.ts` trzyma ścieżki gołe, a `/en` zdejmuje
 * `stripLangPrefix` po stronie runtime'u).
 */
function entersEdgeCache(route: RouteFacts): boolean {
  return !PUBLIC_DOCUMENT_DENY_PREFIXES.some(
    (prefix) => route.fullPath === prefix || route.fullPath.startsWith(`${prefix}/`),
  );
}

function main(): void {
  const sources = collectSources();
  const routeTree = sources.get(ROUTE_TREE);
  if (routeTree === undefined) {
    console.error(`✗ Brak ${ROUTE_TREE} - wygeneruj drzewo tras: node scripts/gen-routes.mjs`);
    process.exit(1);
  }

  const report = analysePublicRouteLoaders({ routeTree, sources });
  console.log(renderPublicRouteLoaderReport(report));

  const missing = routesMissingWarmedLoader(report);
  const cacheable = missing.filter(entersEdgeCache);
  const denied = missing.filter((route) => !entersEdgeCache(route));

  console.log("");
  console.log(RULE);
  console.log(
    `PUSTY DOKUMENT W NES EDGE CACHE: ${cacheable.length} z ${missing.length} tras o samych ` +
      "zimnych kluczach wchodzi do cache dokumentów",
  );
  console.log(
    `(reszta - ${denied.length} - stoi pod PUBLIC_DOCUMENT_DENY_PREFIXES, ` +
      "czyli szkielet dostaje jedno żądanie, nie kolejne 24 h czytelników).",
  );
  console.log("");
  for (const route of cacheable) {
    const flags = [route.noindex ? "noindex" : "indeksowana"];
    if (route.coldQueriesInRouteFile) flags.push("zimne zapytanie w pliku trasy");
    console.log(`  CACHE   ${route.fullPath.padEnd(40)} [${flags.join(", ")}]`);
  }
  for (const route of denied) {
    console.log(`  deny    ${route.fullPath.padEnd(40)} [poza cache dokumentów]`);
  }

  if (!process.argv.includes("--gate")) return;

  console.log("");
  console.log(RULE);
  const failures: string[] = [];
  if (missing.length > FROZEN_MISSING) {
    failures.push(
      `${missing.length} tras publicznych z SSR bez treści przy zamrożonym ${FROZEN_MISSING}`,
    );
  }
  if (cacheable.length > FROZEN_CACHEABLE) {
    failures.push(
      `${cacheable.length} z nich wchodzi do NES Edge Cache przy zamrożonym ${FROZEN_CACHEABLE}`,
    );
  }
  if (failures.length > 0) {
    console.error(
      `✗ BRAMKA: ${failures.join("; ")}.\n` +
        "  Nowa trasa publiczna czytająca dane MUSI mieć loader rozgrzewający jej klucze\n" +
        "  (wzorzec: routes/glossary.tsx - loadResilient + setCacheControlHeader).",
    );
    process.exit(1);
  }
  console.log(
    `✓ BRAMKA: ${missing.length} <= ${FROZEN_MISSING} (całość), ` +
      `${cacheable.length} <= ${FROZEN_CACHEABLE} (w cache dokumentów).`,
  );
  if (missing.length < FROZEN_MISSING || cacheable.length < FROZEN_CACHEABLE) {
    console.log(
      `  Zejście progu: ustaw FROZEN_MISSING = ${missing.length}, ` +
        `FROZEN_CACHEABLE = ${cacheable.length} w tym pliku.`,
    );
  }
}

main();
