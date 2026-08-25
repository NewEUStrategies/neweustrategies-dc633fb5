// Bramka: TRASA Z DZIEĆMI MUSI RENDEROWAĆ `<Outlet />`.
//
// PRZYCZYNA ŹRÓDŁOWA (zmierzona, nie hipotetyczna). W TanStack Router `Match`
// renderuje ALBO `route.options.component`, ALBO `<Outlet />` - nigdy oba:
//
//     const Comp = route.options.component ?? router.options.defaultComponent;
//     return Comp ? jsx(Comp) : jsx(Outlet);
//
// Rodzic, który ma własny komponent i nie woła w nim `<Outlet />`, montuje się
// sam i na tym kończy. Dzieci zostają w drzewie tras, mają swoje `head()`,
// swoje loadery i swoje testy - i są NIEOSIĄGALNE z przeglądarki.
//
// Dokładnie to stało się `/events`: lista wydarzeń siedziała w `events.tsx`,
// a `events.$slug.tsx` (strona wydarzenia), `events.$slug_.register.tsx`
// (formularz zapisu) i `events.$slug_.manage.tsx` (samoobsługa zgłoszenia)
// były jej DZIEĆMI. Każde wejście na `/events/<slug>` pokazywało listę.
// Defekt nie zapalał ani jednej istniejącej bramki: typy się zgadzały, testy
// komponentów przechodziły, generator drzewa był zadowolony.
//
// Ta bramka czyta STAN KOŃCOWY drzewa (`routeTree.gen.ts`): wyciąga wszystkie
// trasy, które są czyimś rodzicem, i sprawdza ich pliki źródłowe. Trasa bez
// własnego komponentu jest w porządku - router renderuje wtedy `<Outlet />`
// sam z siebie.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const TREE = "src/routeTree.gen.ts";

/**
 * ZMROŻONY DŁUG: trasy, które mają dzieci rysujące interfejs i NIE wołają
 * `<Outlet />`. Stan zmierzony 2026-08-25 przy naprawie `/events`, nie
 * przepisany z pamięci. Każda pozycja to konkretne adresy nieosiągalne
 * z przeglądarki:
 *
 *   admin.organizations -> /admin/organizations/$id, /admin/organizations/new
 *   admin.seo           -> /admin/seo/search-console
 *   network             -> /network/mutual/$userId
 *   qa                  -> /qa/$slug
 *
 * Naprawa każdej z nich jest ta sama i mechaniczna (podział na układ
 * `x.tsx` z `<Outlet />` i treść `x.index.tsx`), ale należy do właścicieli
 * tamtych modułów - dopisanie jej do zmiany o wydarzeniach ukryłoby cztery
 * osobne regresje w jednym przeglądzie. Lista ma TYLKO MALEĆ; nowy rodzic
 * musi mieć `<Outlet />` od pierwszego dnia.
 */
const KNOWN_BROKEN: readonly string[] = [
  "src/routes/admin.organizations",
  "src/routes/admin.seo",
  "src/routes/network",
  "src/routes/qa",
];

/** `import { Route as FooRouteImport } from './routes/foo'` -> `FooRoute` => `src/routes/foo`. */
function importedRouteFiles(tree: string): Map<string, string> {
  const files = new Map<string, string>();
  const rx = /import \{ Route as (\w+)RouteImport \} from '\.\/routes\/([^']+)'/g;
  for (const match of tree.matchAll(rx)) {
    files.set(`${match[1]}Route`, `src/routes/${match[2]}`);
  }
  return files;
}

/**
 * Rodzic -> jego dzieci, z bloków `const FooRoute = FooRouteImport.update({ … })`.
 *
 * Bierzemy PARY, a nie same nazwy rodziców, bo rodzic z samymi dziećmi
 * SERWEROWYMI (kanał RSS, mapa strony, webhook) nie ma żadnego problemu:
 * trasa bez komponentu nie przechodzi przez `Match`, więc `<Outlet />`
 * rodzica jest jej niepotrzebny.
 */
function childrenByParent(tree: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const rx = /const (\w+Route) = \w+RouteImport\.update\(\{[\s\S]*?getParentRoute: \(\) => (\w+),/g;
  for (const match of tree.matchAll(rx)) {
    const [, child, parent] = match;
    if (parent === "rootRouteImport") continue;
    const known = map.get(parent);
    if (known === undefined) map.set(parent, [child]);
    else known.push(child);
  }
  return map;
}

function sourceOf(base: string): string | null {
  for (const ext of [".tsx", ".ts"]) {
    const path = resolve(process.cwd(), `${base}${ext}`);
    if (existsSync(path)) return readFileSync(path, "utf8");
  }
  return null;
}

/** Komentarze maskujemy, żeby wzmianka o `<Outlet />` w prozie nie liczyła się jak kod. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("trasa z dziećmi renderuje <Outlet />", () => {
  const tree = readFileSync(resolve(process.cwd(), TREE), "utf8");
  const files = importedRouteFiles(tree);
  const children = childrenByParent(tree);
  const parents = [...children.keys()].sort();

  /** Czy trasa rysuje interfejs - tylko taka potrzebuje `<Outlet />` rodzica. */
  function rendersUi(routeName: string): boolean {
    const base = files.get(routeName);
    if (base === undefined) return false;
    const source = sourceOf(base);
    if (source === null) return false;
    return /\bcomponent:\s*\w/.test(withoutComments(source));
  }

  it("drzewo tras w ogóle ma rodziców (bramka nie mierzy pustki)", () => {
    expect(parents.length).toBeGreaterThan(5);
  });

  it("każdy rodzic z własnym komponentem woła <Outlet />", () => {
    const broken: string[] = [];
    for (const parent of parents) {
      const base = files.get(parent);
      if (base === undefined) continue;
      const source = sourceOf(base);
      if (source === null) continue;
      const code = withoutComments(source);
      // Trasa bez `component` jest w porządku - router renderuje wtedy Outlet sam.
      const hasComponent = /\bcomponent:\s*\w/.test(code);
      const hasOutlet = /<Outlet\b/.test(code);
      const hasUiChild = (children.get(parent) ?? []).some(rendersUi);
      if (hasComponent && !hasOutlet && hasUiChild) broken.push(base);
    }
    expect(broken.filter((file) => !KNOWN_BROKEN.includes(file))).toEqual([]);
  });

  it("zmrożony dług nie rośnie i nie zawiera pozycji już naprawionych", () => {
    const broken: string[] = [];
    for (const parent of parents) {
      const base = files.get(parent);
      if (base === undefined) continue;
      const source = sourceOf(base);
      if (source === null) continue;
      const code = withoutComments(source);
      const hasComponent = /\bcomponent:\s*\w/.test(code);
      const hasOutlet = /<Outlet\b/.test(code);
      const hasUiChild = (children.get(parent) ?? []).some(rendersUi);
      if (hasComponent && !hasOutlet && hasUiChild) broken.push(base);
    }
    // Pozycja zdjęta z długu MUSI zniknąć z listy - inaczej lista przestaje
    // opisywać stan repozytorium i zaczyna go tylko wspominać.
    expect(KNOWN_BROKEN.filter((file) => !broken.includes(file))).toEqual([]);
  });
});
