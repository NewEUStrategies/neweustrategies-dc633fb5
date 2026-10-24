// @vitest-environment node
//
// `nes:client-only-route-stub` (scripts/lib/clientOnlyRouteStubPlugin.ts): w środowisku `ssr`
// moduły komponentów tras-dzieci layoutu `/admin` są zaślepką, bo serwer renderuje panel tylko
// jako szkielet (`<Outlet/>` po hydratacji). Testy pilnują trzech rzeczy: relacji „potomek
// layoutu" z PRAWDZIWEGO `src/routeTree.gen.ts` (nie z nazw plików), tego, że grupa podziału
// z `loader` nigdy nie jest podmieniana, i tego, że zaślepka eksportuje dokładnie nazwy, po
// które sięga `lazyRouteComponent`. Wynik na artefakcie pilnuje `check:server-entry-purity`.
//
// i18n: brak treści dla użytkownika - narzędzie CI.
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  CLIENT_ONLY_LAYOUTS,
  clientOnlyRouteStub,
  clientOnlyRouteStubPlugin,
  routeDescendants,
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
