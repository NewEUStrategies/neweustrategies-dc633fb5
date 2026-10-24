// Wtyczka: komponenty podstron panelu poza artefaktem serwera (środowisko `ssr`, tylko build).
//
// PO CO. Speed Index strony głównej to w ~90 % TTFB zimnego izolatu, a ten płaci kompilację
// KAŻDEGO modułu skryptu Workera - także takiego, którego żądanie nigdy nie wykona (pomiar:
// docs/performance/2026-10-24-zimny-start-workera.md, lokalny workerd ~26 ms/MB). Podstrony
// `/admin/*` serwer renderuje wyłącznie jako szkielet: `AdminLayout` (src/routes/admin.tsx)
// zwraca przed hydratacją `AdminShellSkeleton`, a `<Outlet/>` panelu montuje dopiero
// `AdminSession` po `useHydrated()`. Komponenty tras-dzieci `/admin` NIGDY nie renderują się na
// serwerze - ani `component`, ani `errorComponent`/`notFoundComponent`/`pendingComponent`, bo
// granice błędów dziecka siedzą w `<Outlet/>` rodzica. Mimo to ich kod (edytor wpisów, studio
// wydarzeń, CRM, billing - 7,2 MB z 22,5 MB artefaktu) jechał w Workerze i był kompilowany przy
// każdym zimnym starcie strony publicznej.
//
// CO ROBI. W środowisku `ssr` podmienia moduł podziału trasy (`<plik trasy>?tsr-split=<grupa>`,
// router-plugin TanStacka) na zaślepkę, gdy (1) plik trasy jest POTOMKIEM layoutu `/admin`
// według `src/routeTree.gen.ts` (`getParentRoute`, nie nazwa pliku - `admin_.x` wychodzi poza
// layout) i (2) grupa podziału zawiera wyłącznie komponenty. Grupa z `loader` (kokpit `/admin/`,
// `ADMIN_COCKPIT_SPLIT` w routeCodeSplitting.ts) zostaje nietknięta. Zaślepka eksportuje te
// same nazwy (`component`, ... - `exporterIdent` router-plugin), więc `lazyRouteComponent` na
// serwerze ładuje ją jak zwykły chunk; render jej nigdy nie dosięga. Klient, manifest
// i modulepreloady są bez zmian (środowisko `client` nie jest dotykane), a funkcje serwerowe
// panelu zostają: resolver Startu importuje moduły `*.functions` własną krawędzią.
//
// `enforce: "post"` + `order: "post"`: zaślepka zastępuje WYNIK splittera, nie plik trasy - na
// etapie `load` splitter przepisałby ją jeszcze raz jako plik trasy. Ta sama wtyczka w obu
// presetach (parytet: src/lib/ci/__tests__/viteChunkParity.test.ts).
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";

/** Węzły podziału, które są komponentami (`SPLIT_NODES_CONFIG` router-plugin). */
const COMPONENT_NODES = new Set([
  "component",
  "pendingComponent",
  "errorComponent",
  "notFoundComponent",
]);

/** Layouty, których dzieci renderują się wyłącznie po hydratacji (patrz nagłówek). */
export const CLIENT_ONLY_LAYOUTS = ["admin"] as const;

const IMPORT_RE = /^import \{ Route as (\w+)Import \} from '\.\/routes\/([^']+)'$/gm;
/** `const X =` i `XImport.update({` bywają w dwóch liniach (prettier łamie długie nazwy). */
const UPDATE_RE = /^const (\w+) =\s+(\w+)Import\.update\(\{[^]*?getParentRoute: \(\) => (\w+),/gm;

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
 * Zaślepka modułu podziału albo `null`, gdy modułu nie wolno podmienić. `stubbedFiles` -
 * absolutne ścieżki plików tras (z rozszerzeniem).
 */
export function clientOnlyRouteStub(id: string, stubbedFiles: ReadonlySet<string>): string | null {
  const queryAt = id.indexOf("?");
  if (queryAt === -1) return null;
  const file = id.slice(0, queryAt);
  if (!stubbedFiles.has(file)) return null;
  const grouping = new URLSearchParams(id.slice(queryAt + 1)).get("tsr-split");
  if (!grouping) return null;
  const nodes = grouping.split("---");
  if (!nodes.every((node) => COMPONENT_NODES.has(node))) return null;
  const exports = nodes.map((node) => `SsrClientOnlyRouteStub as ${node}`).join(", ");
  return `function SsrClientOnlyRouteStub() {\n  return null;\n}\nexport { ${exports} };\n`;
}

export function clientOnlyRouteStubPlugin(): Plugin {
  let stubbedFiles = new Set<string>();
  let stubbed = 0;
  return {
    name: "nes:client-only-route-stub",
    apply: "build",
    enforce: "post",
    applyToEnvironment: (environment) => environment.name === "ssr",
    configResolved(config) {
      const routesDir = resolve(config.root, "src/routes");
      const routeTree = readFileSync(resolve(config.root, "src/routeTree.gen.ts"), "utf8");
      const files = new Set<string>();
      for (const layout of CLIENT_ONLY_LAYOUTS) {
        for (const route of routeDescendants(routeTree, layout)) {
          const file = [".tsx", ".ts"]
            .map((ext) => resolve(routesDir, `${route}${ext}`))
            .find((candidate) => existsSync(candidate));
          if (file) files.add(file);
        }
      }
      stubbedFiles = files;
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
        const stub = clientOnlyRouteStub(id, stubbedFiles);
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
