// @vitest-environment node
//
// `nes:client-only-route-stub` (scripts/lib/clientOnlyRouteStubPlugin.ts): w środowisku `ssr`
// moduły komponentów tras-dzieci layoutu `/admin` są zaślepką, bo serwer renderuje panel tylko
// jako szkielet (`<Outlet/>` po hydratacji). Testy pilnują trzech rzeczy: relacji „potomek
// layoutu" z PRAWDZIWEGO `src/routeTree.gen.ts` (nie z nazw plików), tego, że grupa podziału
// z `loader` nigdy nie jest podmieniana, i tego, że zaślepka eksportuje dokładnie nazwy, po
// które sięga `lazyRouteComponent`. Wynik na artefakcie pilnuje `check:server-entry-purity`.
//
// Druga klasa (2026-11-15): trasy z `ssr: false`. Tu zaślepkę dostają `component`,
// `errorComponent` i `notFoundComponent`, ale NIGDY `pendingComponent` - to on jest serwerowym
// `fallback` granicy `ClientOnly`. Wykrycie opcji jest wzorcem na linii źródła, więc test
// porównuje je z drzewem składni (parser TypeScriptu) dla KAŻDEGO pliku trasy w repozytorium.
//
// i18n: brak treści dla użytkownika - narzędzie CI.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { ssrFalseRoutePaths, type SourceFile } from "@/lib/ci/serverEntryPurity";
import { bezKomentarzy } from "@/lib/ci/sourceScan";

import {
  CLIENT_ONLY_LAYOUTS,
  clientOnlyRouteStub,
  clientOnlyRouteStubPlugin,
  declaresSsrFalse,
  routeDescendants,
  routeTreeFiles,
  ssrFalseRouteFiles,
} from "../../../../scripts/lib/clientOnlyRouteStubPlugin";

const DRZEWO = [
  "import { Route as rootRouteImport } from './routes/__root'",
  "import { Route as AdminRouteImport } from './routes/admin'",
  "import { Route as AdminPostsRouteImport } from './routes/admin.posts'",
  "import { Route as AdminPostsSlugRouteImport } from './routes/admin.posts.$slug'",
  "import { Route as AdminEventsEventIdOnsiteDeskRouteImport } from './routes/admin.events_.$eventId.onsite.desk'",
  "import { Route as AdminPreviewRouteImport } from './routes/admin_.preview'",
  "import { Route as BlogRouteImport } from './routes/blog'",
  "",
  "const AdminRoute = AdminRouteImport.update({",
  "  id: '/admin',",
  "  path: '/admin',",
  "  getParentRoute: () => rootRouteImport,",
  "} as any)",
  "const AdminPostsRoute = AdminPostsRouteImport.update({",
  "  id: '/posts',",
  "  path: '/posts',",
  "  getParentRoute: () => AdminRoute,",
  "} as any)",
  "const AdminPostsSlugRoute = AdminPostsSlugRouteImport.update({",
  "  id: '/$slug',",
  "  path: '/$slug',",
  "  getParentRoute: () => AdminPostsRoute,",
  "} as any)",
  "const AdminEventsEventIdOnsiteDeskRoute =",
  "  AdminEventsEventIdOnsiteDeskRouteImport.update({",
  "    id: '/events_/$eventId/onsite/desk',",
  "    path: '/events/$eventId/onsite/desk',",
  "    getParentRoute: () => AdminRoute,",
  "  } as any)",
  "const AdminPreviewRoute = AdminPreviewRouteImport.update({",
  "  id: '/admin_/preview',",
  "  path: '/admin/preview',",
  "  getParentRoute: () => rootRouteImport,",
  "} as any)",
  "const BlogRoute = BlogRouteImport.update({",
  "  id: '/blog',",
  "  path: '/blog',",
  "  getParentRoute: () => rootRouteImport,",
  "} as any)",
].join("\n");

describe("routeDescendants - potomkowie layoutu z drzewa tras", () => {
  it("bierze rodzica z `getParentRoute`, także dla definicji złamanej na dwie linie", () => {
    expect([...routeDescendants(DRZEWO, "admin")].sort()).toEqual([
      "admin.events_.$eventId.onsite.desk",
      "admin.posts",
      "admin.posts.$slug",
    ]);
  });

  it("nie obejmuje samego layoutu, tras wychodzących z niego (`admin_`) ani tras publicznych", () => {
    const set = routeDescendants(DRZEWO, "admin");
    expect(set.has("admin")).toBe(false);
    expect(set.has("admin_.preview")).toBe(false);
    expect(set.has("blog")).toBe(false);
  });

  it("nieznany layout daje pusty zbiór; cykl rodziców nie zapętla przejścia", () => {
    expect(routeDescendants(DRZEWO, "studio").size).toBe(0);
    const cykl = [
      "import { Route as AdminRouteImport } from './routes/admin'",
      "import { Route as ARouteImport } from './routes/a'",
      "import { Route as BRouteImport } from './routes/b'",
      "const AdminRoute = AdminRouteImport.update({",
      "  getParentRoute: () => rootRouteImport,",
      "} as any)",
      "const ARoute = ARouteImport.update({",
      "  getParentRoute: () => BRoute,",
      "} as any)",
      "const BRoute = BRouteImport.update({",
      "  getParentRoute: () => ARoute,",
      "} as any)",
    ].join("\n");
    expect(routeDescendants(cykl, "admin").size).toBe(0);
  });

  it("na PRAWDZIWYM drzewie: każdy plik `admin.*` poza layoutem jest potomkiem i nic więcej", () => {
    const tree = readFileSync(resolve(process.cwd(), "src/routeTree.gen.ts"), "utf8");
    const set = routeDescendants(tree, "admin");
    const files = readdirSync(resolve(process.cwd(), "src/routes"))
      .filter((file) => /\.tsx?$/.test(file) && !/\.(test|spec)\.tsx?$/.test(file))
      .map((file) => file.replace(/\.tsx?$/, ""));
    const expected = files.filter((file) => file.startsWith("admin.")).sort();
    expect(expected.length).toBeGreaterThan(150);
    expect([...set].sort()).toEqual(expected);
    expect(CLIENT_ONLY_LAYOUTS).toEqual(["admin"]);
  });
});

describe("clientOnlyRouteStub - zaślepka modułu podziału trasy", () => {
  const FILE = "/repo/src/routes/admin.posts.$slug.tsx";
  const files = new Set([FILE]);

  it("grupa samych komponentów dostaje zaślepkę z tymi samymi nazwami eksportów", () => {
    expect(clientOnlyRouteStub(`${FILE}?tsr-split=component`, files)).toBe(
      "function SsrClientOnlyRouteStub() {\n  return null;\n}\nexport { SsrClientOnlyRouteStub as component };\n",
    );
    expect(
      clientOnlyRouteStub(`${FILE}?tsr-split=errorComponent---notFoundComponent`, files),
    ).toContain(
      "export { SsrClientOnlyRouteStub as errorComponent, SsrClientOnlyRouteStub as notFoundComponent };",
    );
  });

  it("grupa z loaderem, moduł współdzielony, plik trasy i obca trasa zostają nietknięte", () => {
    expect(clientOnlyRouteStub(`${FILE}?tsr-split=component---loader`, files)).toBeNull();
    expect(clientOnlyRouteStub(`${FILE}?tsr-split=loader`, files)).toBeNull();
    expect(clientOnlyRouteStub(`${FILE}?tsr-shared=1`, files)).toBeNull();
    expect(clientOnlyRouteStub(FILE, files)).toBeNull();
    expect(clientOnlyRouteStub("/repo/src/routes/blog.tsx?tsr-split=component", files)).toBeNull();
  });

  it("zaślepka to poprawny moduł ESM, którego komponent renderuje `null`", async () => {
    const code = clientOnlyRouteStub(
      `${FILE}?tsr-split=component---errorComponent---notFoundComponent---pendingComponent`,
      files,
    );
    expect(code).not.toBeNull();
    const mod = (await import(
      /* @vite-ignore */ `data:text/javascript,${encodeURIComponent(code!)}`
    )) as Record<string, () => unknown>;
    for (const name of ["component", "errorComponent", "notFoundComponent", "pendingComponent"]) {
      expect(mod[name](), name).toBeNull();
    }
  });
});

/** `ssr: false` jako własność obiektu opcji `createFileRoute(…)({…})` - z drzewa składni. */
function ssrFalseWedlugSkladni(file: string, source: string): boolean {
  const tree = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  let found = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isCallExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "createFileRoute"
    ) {
      const options = node.arguments[0];
      if (options !== undefined && ts.isObjectLiteralExpression(options)) {
        for (const property of options.properties) {
          if (
            ts.isPropertyAssignment(property) &&
            ts.isIdentifier(property.name) &&
            property.name.text === "ssr" &&
            property.initializer.kind === ts.SyntaxKind.FalseKeyword
          ) {
            found = true;
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

describe("declaresSsrFalse - opcja trasy `ssr: false`", () => {
  const trasa = (linie: string[]) =>
    ['export const Route = createFileRoute("/x")({', ...linie, "  component: X,", "});"].join("\n");

  it("własność najwyższego poziomu obiektu opcji, z przecinkiem i bez", () => {
    expect(declaresSsrFalse(trasa(["  ssr: false,"]))).toBe(true);
    expect(declaresSsrFalse(trasa(["  head: () => ({}),", "  ssr: false"]))).toBe(true);
  });

  it("komentarz, inna wartość i opcja zagnieżdżona głębiej to nie `ssr: false` trasy", () => {
    expect(declaresSsrFalse(trasa(["  // ssr: false,"]))).toBe(false);
    expect(declaresSsrFalse(trasa(["  // Stało tu `ssr: false` z jednym uzasadnieniem."]))).toBe(
      false,
    );
    expect(declaresSsrFalse(trasa(['  ssr: "data-only",']))).toBe(false);
    expect(declaresSsrFalse(trasa(["  ssr: true,"]))).toBe(false);
    expect(declaresSsrFalse(trasa(["  ssr: () => false,"]))).toBe(false);
    expect(declaresSsrFalse(trasa(["  staticData: {", "    ssr: false,", "  },"]))).toBe(false);
  });

  it("na PRAWDZIWYCH plikach tras wzorzec zgadza się z drzewem składni każdego pliku", () => {
    const tree = readFileSync(resolve(process.cwd(), "src/routeTree.gen.ts"), "utf8");
    const routes = routeTreeFiles(tree);
    expect(routes.length).toBeGreaterThan(300);
    const wykryte: string[] = [];
    const zrodlaBramki: SourceFile[] = [];
    for (const route of routes) {
      const file = [".tsx", ".ts"]
        .map((ext) => resolve(process.cwd(), "src/routes", `${route}${ext}`))
        .find((candidate) => existsSync(candidate));
      expect(file, route).toBeDefined();
      const source = readFileSync(file!, "utf8");
      expect(declaresSsrFalse(source), route).toBe(ssrFalseWedlugSkladni(file!, source));
      if (declaresSsrFalse(source)) wykryte.push(route);
      zrodlaBramki.push({
        path: relative(process.cwd(), file!).split(sep).join("/"),
        source: bezKomentarzy(source),
      });
    }
    // Bramka artefaktu czyta te same pliki po wymaskowaniu komentarzy i własnym wzorcem
    // (`ssrFalseRoutePaths`): ma wymagać zaślepki dla dokładnie tych tras, które podmienia wtyczka.
    expect(ssrFalseRoutePaths(zrodlaBramki)).toHaveLength(wykryte.length);
    // Liczba kontrolna i znane przypadki: trasy z poświadczeniem w adresie i z sesją
    // z `localStorage`; `admin` i `membership-registration` wspominają opcję tylko w komentarzu.
    expect(wykryte.length).toBeGreaterThanOrEqual(15);
    expect(wykryte).toEqual(
      expect.arrayContaining(["scanner", "messages", "events.$slug_.ticket", "events.saved"]),
    );
    expect(wykryte).not.toContain("admin");
    expect(wykryte).not.toContain("membership-registration");
  });
});

describe("ssrFalseRouteFiles - trasy z `ssr: false` i ich potomkowie", () => {
  const zrodla: Record<string, string> = {
    admin: 'export const Route = createFileRoute("/admin")({\n  component: A,\n});',
    "admin.posts":
      'export const Route = createFileRoute("/admin/posts")({\n  ssr: false,\n  component: P,\n});',
    "admin.posts.$slug":
      'export const Route = createFileRoute("/admin/posts/$slug")({\n  component: S,\n});',
    blog: 'export const Route = createFileRoute("/blog")({\n  component: B,\n});',
  };

  it("bierze trasę z opcją i jej potomków; rodzeństwo i rodzic zostają", () => {
    const set = ssrFalseRouteFiles(DRZEWO, (route) => zrodla[route] ?? null);
    expect([...set].sort()).toEqual(["admin.posts", "admin.posts.$slug"]);
  });

  it("plik, którego nie ma, nie wywraca skanu", () => {
    expect(ssrFalseRouteFiles(DRZEWO, () => null).size).toBe(0);
  });
});

describe("clientOnlyRouteStub - trasa z `ssr: false`", () => {
  const FILE = "/repo/src/routes/scanner.tsx";
  const brak = new Set<string>();
  const ssrFalse = new Set([FILE]);

  it("`component` oraz grupa błędu i 404 dostają zaślepkę", () => {
    expect(clientOnlyRouteStub(`${FILE}?tsr-split=component`, brak, ssrFalse)).toContain(
      "export { SsrClientOnlyRouteStub as component };",
    );
    expect(
      clientOnlyRouteStub(`${FILE}?tsr-split=errorComponent---notFoundComponent`, brak, ssrFalse),
    ).toContain(
      "export { SsrClientOnlyRouteStub as errorComponent, SsrClientOnlyRouteStub as notFoundComponent };",
    );
  });

  it("`pendingComponent` zostaje - serwer renderuje go jako `fallback` granicy `ClientOnly`", () => {
    expect(clientOnlyRouteStub(`${FILE}?tsr-split=pendingComponent`, brak, ssrFalse)).toBeNull();
    expect(
      clientOnlyRouteStub(`${FILE}?tsr-split=component---pendingComponent`, brak, ssrFalse),
    ).toBeNull();
  });

  it("grupa z loaderem i trasa spoza zbioru zostają nietknięte", () => {
    expect(clientOnlyRouteStub(`${FILE}?tsr-split=loader`, brak, ssrFalse)).toBeNull();
    expect(clientOnlyRouteStub(`${FILE}?tsr-split=loader---component`, brak, ssrFalse)).toBeNull();
    expect(
      clientOnlyRouteStub("/repo/src/routes/blog.tsx?tsr-split=component", brak, ssrFalse),
    ).toBeNull();
    // Bez drugiego zbioru (wywołanie sprzed 2026-11-15) trasa `ssr: false` nie jest podmieniana.
    expect(clientOnlyRouteStub(`${FILE}?tsr-split=component`, brak)).toBeNull();
  });

  it("potomek layoutu bez serwerowego `<Outlet/>` ma pierwszeństwo: także `pendingComponent`", () => {
    const oba = new Set([FILE]);
    expect(clientOnlyRouteStub(`${FILE}?tsr-split=pendingComponent`, oba, oba)).not.toBeNull();
  });
});

describe("clientOnlyRouteStubPlugin - zakres", () => {
  it("tylko build, tylko środowisko `ssr`, po splitterze (`enforce: post`)", () => {
    const plugin = clientOnlyRouteStubPlugin();
    expect(plugin.apply).toBe("build");
    expect(plugin.enforce).toBe("post");
    const applies = plugin.applyToEnvironment as (env: { name: string }) => boolean;
    expect(applies({ name: "ssr" })).toBe(true);
    expect(applies({ name: "client" })).toBe(false);
  });
});
