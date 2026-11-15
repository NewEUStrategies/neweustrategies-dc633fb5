// Wtyczka: komponenty tras, których serwer nigdy nie renderuje, poza artefaktem serwera
// (środowisko `ssr`, tylko build).
//
// PO CO. Speed Index strony głównej to w ~90 % TTFB zimnego izolatu, a ten płaci kompilację
// KAŻDEGO modułu skryptu Workera - także takiego, którego żądanie nigdy nie wykona (pomiary:
// docs/performance/2026-10-24-zimny-start-workera.md i 2026-11-15-zimny-start-c2.md, lokalny
// workerd ~30 ms CPU na MB). Dwie klasy tras mają komponenty, których serwer nie renderuje
// Z KONSTRUKCJI, a nie z obserwacji:
//
// 1. POTOMKOWIE LAYOUTU BEZ SERWEROWEGO `<Outlet/>` (`CLIENT_ONLY_LAYOUTS`). Podstrony
//    `/admin/*` serwer renderuje wyłącznie jako szkielet: `AdminLayout` (src/routes/admin.tsx)
//    zwraca przed hydratacją `AdminShellSkeleton`, a `<Outlet/>` panelu montuje dopiero
//    `AdminSession` po `useHydrated()`. Komponenty tras-dzieci NIGDY nie renderują się na
//    serwerze - ani `component`, ani `errorComponent`/`notFoundComponent`/`pendingComponent`,
//    bo granice błędów dziecka siedzą w `<Outlet/>` rodzica (7,2 MB z 22,5 MB artefaktu).
//    Podstrony `/profile/*` (od 2026-11-15): `ProfileLayout` (src/routes/profile.tsx) owija
//    `<Outlet/>` w `AuthGate`, który renderuje dzieci wyłącznie przy obecnej sesji, a sesja
//    Supabase żyje w `localStorage` - `AuthProvider` zaczyna od `session: null` i ustawia ją
//    tylko w efektach, więc serwer oddaje sam spinner bramki (0,40 MB artefaktu; dowód na
//    prawdziwym dostawcy: src/routes/__tests__/profileRouteSsr.test.tsx). Layout, który
//    zacznie renderować `<Outlet/>` na serwerze, MUSI zniknąć z tej listy.
//
// 2. TRASY Z `ssr: false` (i ich potomkowie - router dziedziczy `ssr: false` w dół drzewa,
//    `resolveSsr` w router-core `load-server.ts`). Dopasowanie takiej trasy router owija w
//    `<ClientOnly fallback={pendingElement}>` (`matchView` w react-router `Match.tsx`), a
//    `ClientOnly` na serwerze zwraca wyłącznie `fallback`. `MatchInner` - jedyne miejsce, które
//    renderuje `component`, a na serwerze także `errorComponent` i `notFoundComponent` trasy -
//    siedzi w środku, więc serwer go nie dotyka; granice błędów (`CatchBoundary`,
//    `CatchNotFound`) w renderze serwerowym nie przechwytują niczego. `pendingComponent` jest
//    WYJĄTKIEM: to on jest tym `fallback` i serwer go renderuje, więc zaślepki nie dostaje
//    (router-plugin i tak go u nas nie wydziela - `routeSplitBehavior`). Skaner, bilety, studio
//    uczestnika, wiadomości: 15 tras, 0,37 MB artefaktu z 2026-11-14.
//
// CO ROBI. W środowisku `ssr` podmienia moduł podziału trasy (`<plik trasy>?tsr-split=<grupa>`,
// router-plugin TanStacka) na zaślepkę, gdy plik trasy należy do jednej z klas, a grupa podziału
// zawiera wyłącznie węzły, których serwer dla tej klasy nie renderuje. Przynależność do klasy 1
// pochodzi z `src/routeTree.gen.ts` (`getParentRoute`, nie nazwa pliku - `admin_.x` wychodzi
// poza layout), do klasy 2 - z opcji `ssr: false` w pliku trasy i tego samego drzewa. Grupa
// z `loader` (kokpit `/admin/`, `ADMIN_COCKPIT_SPLIT` w routeCodeSplitting.ts) zostaje
// nietknięta, tak jak `loader`, `beforeLoad` i `head` w pliku trasy. Zaślepka eksportuje te same
// nazwy (`component`, ... - `exporterIdent` router-plugin), więc `lazyRouteComponent` na
// serwerze ładuje ją jak zwykły chunk; render jej nigdy nie dosięga. Klient, manifest
// i modulepreloady są bez zmian (środowisko `client` nie jest dotykane), a funkcje serwerowe
// zostają: resolver Startu importuje moduły `*.functions` własną krawędzią.
//
// `enforce: "post"` + `order: "post"`: zaślepka zastępuje WYNIK splittera, nie plik trasy - na
// etapie `load` splitter przepisałby ją jeszcze raz jako plik trasy. Ta sama wtyczka w obu
// presetach (parytet: src/lib/ci/__tests__/viteChunkParity.test.ts). Wynik na artefakcie
// pilnuje `check:server-entry-purity`: zaślepki tam, gdzie mają być, i NIGDZIE indziej.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";

/** Węzły podziału, które są komponentami (`SPLIT_NODES_CONFIG` router-plugin). */
const COMPONENT_NODES: ReadonlySet<string> = new Set([
  "component",
  "pendingComponent",
  "errorComponent",
  "notFoundComponent",
]);

/**
 * Węzły, których serwer nie renderuje dla trasy z `ssr: false`. Bez `pendingComponent` - to
 * on jest serwerowym `fallback` granicy `ClientOnly` (nagłówek pliku, klasa 2).
 */
const SSR_FALSE_NODES: ReadonlySet<string> = new Set([
  "component",
  "errorComponent",
  "notFoundComponent",
]);

/** Layouty, których dzieci renderują się wyłącznie po hydratacji (nagłówek pliku, klasa 1). */
export const CLIENT_ONLY_LAYOUTS = ["admin", "profile"] as const;

const IMPORT_RE = /^import \{ Route as (\w+)Import \} from '\.\/routes\/([^']+)'$/gm;
/** `const X =` i `XImport.update({` bywają w dwóch liniach (prettier łamie długie nazwy). */
const UPDATE_RE = /^const (\w+) =\s+(\w+)Import\.update\(\{[^]*?getParentRoute: \(\) => (\w+),/gm;

/** Pliki tras (ścieżka względem `src/routes`, bez rozszerzenia) z wygenerowanego drzewa. */
export function routeTreeFiles(routeTreeSource: string): string[] {
  return [...routeTreeSource.matchAll(IMPORT_RE)].map((match) => match[2]);
}

/**
 * Pliki tras (ścieżka względem `src/routes`, bez rozszerzenia) będące ŚCISŁYMI potomkami
 * layoutu `layoutFile` w wygenerowanym drzewie tras.
 */
export function routeDescendants(routeTreeSource: string, layoutFile: string): Set<string> {
  const fileOf = new Map<string, string>();
  for (const match of routeTreeSource.matchAll(IMPORT_RE)) fileOf.set(match[1], match[2]);
  const parentOf = new Map<string, string>();
  const constFile = new Map<string, string>();
  for (const match of routeTreeSource.matchAll(UPDATE_RE)) {
    const file = fileOf.get(match[2]);
    if (file === undefined) continue;
    parentOf.set(match[1], match[3]);
    constFile.set(match[1], file);
  }
  const layoutConst = [...constFile].find(([, file]) => file === layoutFile)?.[0];
  const out = new Set<string>();
  if (!layoutConst) return out;
  for (const [name, file] of constFile) {
    const seen = new Set<string>();
    let parent = parentOf.get(name);
    while (parent !== undefined && !seen.has(parent)) {
      if (parent === layoutConst) {
        out.add(file);
        break;
      }
      seen.add(parent);
      parent = parentOf.get(parent);
    }
  }
  return out;
}

/**
 * Opcja trasy `ssr: false`: własność NAJWYŻSZEGO poziomu obiektu opcji `createFileRoute(…)({…})`,
 * czyli po prettierze osobna linia z wcięciem dwóch spacji. Wzorzec jest celowo wąski:
 * komentarz (`// ssr: false`), opcja zagnieżdżona głębiej i `ssr: "data-only"` go nie
 * spełniają, a trasa niewykryta po prostu zostaje w artefakcie w całości. Zgodność wzorca
 * z drzewem składni KAŻDEGO pliku trasy pilnuje test wtyczki (parser TypeScriptu), więc plik,
 * w którym taka linia nie byłaby opcją trasy, obleje CI zamiast dostać zaślepkę.
 */
const SSR_FALSE_OPTION_RE = /^ {2}ssr: false,?[ \t]*$/m;

/** Czy źródło pliku trasy deklaruje `ssr: false` w opcjach trasy. */
export function declaresSsrFalse(routeSource: string): boolean {
  return SSR_FALSE_OPTION_RE.test(routeSource);
}

/**
 * Pliki tras (jak w `routeTreeFiles`) z `ssr: false` razem z ich potomkami. `readRoute` oddaje
 * źródło pliku trasy albo `null`, gdy pliku nie ma.
 */
export function ssrFalseRouteFiles(
  routeTreeSource: string,
  readRoute: (routeFile: string) => string | null,
): Set<string> {
  const out = new Set<string>();
  for (const route of routeTreeFiles(routeTreeSource)) {
    const source = readRoute(route);
    if (source === null || !declaresSsrFalse(source)) continue;
    out.add(route);
    for (const descendant of routeDescendants(routeTreeSource, route)) out.add(descendant);
  }
  return out;
}

const NO_FILES: ReadonlySet<string> = new Set();

/**
 * Zaślepka modułu podziału albo `null`, gdy modułu nie wolno podmienić. Oba zbiory to absolutne
 * ścieżki plików tras (z rozszerzeniem): `stubbedFiles` - potomkowie layoutów bez serwerowego
 * `<Outlet/>` (każdy węzeł-komponent), `ssrFalseFiles` - trasy z `ssr: false` i ich potomkowie
 * (komponenty poza `pendingComponent`).
 */
export function clientOnlyRouteStub(
  id: string,
  stubbedFiles: ReadonlySet<string>,
  ssrFalseFiles: ReadonlySet<string> = NO_FILES,
): string | null {
  const queryAt = id.indexOf("?");
  if (queryAt === -1) return null;
  const file = id.slice(0, queryAt);
  const allowed = stubbedFiles.has(file)
    ? COMPONENT_NODES
    : ssrFalseFiles.has(file)
      ? SSR_FALSE_NODES
      : null;
  if (allowed === null) return null;
  const grouping = new URLSearchParams(id.slice(queryAt + 1)).get("tsr-split");
  if (!grouping) return null;
  const nodes = grouping.split("---");
  if (!nodes.every((node) => allowed.has(node))) return null;
  const exports = nodes.map((node) => `SsrClientOnlyRouteStub as ${node}`).join(", ");
  return `function SsrClientOnlyRouteStub() {\n  return null;\n}\nexport { ${exports} };\n`;
}

export function clientOnlyRouteStubPlugin(): Plugin {
  let stubbedFiles = new Set<string>();
  let ssrFalseFiles = new Set<string>();
  let stubbed = 0;
  return {
    name: "nes:client-only-route-stub",
    apply: "build",
    enforce: "post",
    applyToEnvironment: (environment) => environment.name === "ssr",
    configResolved(config) {
      const routesDir = resolve(config.root, "src/routes");
      const routeTree = readFileSync(resolve(config.root, "src/routeTree.gen.ts"), "utf8");
      const routeFile = (route: string): string | undefined =>
        [".tsx", ".ts"]
          .map((ext) => resolve(routesDir, `${route}${ext}`))
          .find((candidate) => existsSync(candidate));
      const absolute = (routes: Iterable<string>): Set<string> => {
        const files = new Set<string>();
        for (const route of routes) {
          const file = routeFile(route);
          if (file) files.add(file);
        }
        return files;
      };
      stubbedFiles = absolute(
        CLIENT_ONLY_LAYOUTS.flatMap((layout) => [...routeDescendants(routeTree, layout)]),
      );
      ssrFalseFiles = absolute(
        ssrFalseRouteFiles(routeTree, (route) => {
          const file = routeFile(route);
          return file ? readFileSync(file, "utf8") : null;
        }),
      );
    },
    buildStart() {
      stubbed = 0;
      if (stubbedFiles.size === 0) {
        this.warn(
          "nes:client-only-route-stub: brak potomków layoutów w src/routeTree.gen.ts - " +
            "komponenty panelu zostają w artefakcie serwera (zmieniony format drzewa tras?)",
        );
      }
    },
    transform: {
      order: "post",
      handler(_code, id) {
        const stub = clientOnlyRouteStub(id, stubbedFiles, ssrFalseFiles);
        if (stub === null) return null;
        stubbed += 1;
        return { code: stub, map: null };
      },
    },
    buildEnd() {
      if (stubbedFiles.size > 0 && stubbed === 0) {
        this.warn(
          "nes:client-only-route-stub: żaden moduł podziału trasy nie został podmieniony - " +
            "sprawdź format `?tsr-split=` router-plugin",
        );
      }
    },
  };
}
