// Testy spisu tras publicznych i ich loaderów (`report:route-loaders`).
//
// PO CO TE TESTY, A NIE SAM PRZEBIEG SKRYPTU. Bo dwa defekty tego parsera
// przeszły niezauważone na prawdziwym drzewie i ZANIŻYŁY wynik, nie zawyżyły -
// czyli raport wyglądał wiarygodnie i był fałszywy:
//
//   1. `DECL_RE` bez `=\s*` gubiło 79 z 368 wpisów `routeTree.gen.ts`, bo
//      prettier łamie długie deklaracje po znaku równości. Spis pokazywał 289 tras.
//   2. `routeOptionsBlock` kotwiczone na `indexOf("createFileRoute")` trafiało
//      w IMPORT identyfikatora, nie w wywołanie, więc opcje trasy czytało
//      z następnego importu. Efekt: 143 trasy „bez komponentu" (zamiast 56)
//      i JEDNA trasa publiczna w całym raporcie.
//
// Oba defekty są ciche z konstrukcji: nie rzucają, tylko oddają mniejszą liczbę.
// Dlatego niżej stoją asercje na KSZTAŁT wejścia (jednolinijkowe opcje, złamana
// deklaracja), a nie na wynik przebiegu.
import { describe, expect, it } from "vitest";
import {
  analysePublicRouteLoaders,
  balancedArgs,
  findQuerySites,
  keyFactorySymbols,
  loaderWarmedSymbols,
  routesGuestViewOnly,
  hasSessionGate,
  hasSsrDisabled,
  readLoaderFacts,
  rendersHtml,
  renderPublicRouteLoaderReport,
  resolveSpecifier,
  routeOptionsBlock,
  routesMissingWarmedLoader,
  staticImportClosure,
  staticImportSpecifiers,
  topLevelOption,
  type PublicRouteLoaderInput,
} from "../publicRouteLoaders";

function sources(entries: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(entries));
}

const ROOT = `
import { createRootRouteWithContext } from "@tanstack/react-router";
import { Footer } from "../components/Footer";
export const Route = createRootRouteWithContext()({ component: () => null });
`;

/** Minimalne `routeTree.gen.ts` - tylko to, co czyta parser. */
function routeTree(
  rows: ReadonlyArray<{ ident: string; file: string; path: string; parent: string }>,
) {
  const imports = rows.map((r) => `import { Route as ${r.ident}Import } from './${r.file}'`);
  const decls = rows.map(
    (r) =>
      `const ${r.ident} = ${r.ident}Import.update({\n  id: '${r.path}',\n  path: '${r.path}',\n  getParentRoute: () => ${r.parent},\n} as any)`,
  );
  return [...imports, ...decls].join("\n");
}

describe("staticImportSpecifiers", () => {
  it("bierze importy wartościowe, pomija `import type` i dynamiczne `import()`", () => {
    const out = staticImportSpecifiers(
      [
        `import { A } from "@/lib/a";`,
        `import type { B } from "@/lib/b";`,
        `import "@/lib/side-effect";`,
        `export { C } from "@/lib/c";`,
        `export type { D } from "@/lib/d";`,
        `const lazy = () => import("@/lib/lazy");`,
      ].join("\n"),
    );
    expect(out).toContain("@/lib/a");
    expect(out).toContain("@/lib/side-effect");
    expect(out).toContain("@/lib/c");
    expect(out).not.toContain("@/lib/b");
    expect(out).not.toContain("@/lib/d");
    // `React.lazy` renderuje na serwerze fallback - leniwy moduł nie jest
    // częścią SSR-owego HTML-a trasy, więc nie tworzy krawędzi w tym grafie.
    expect(out).not.toContain("@/lib/lazy");
  });

  it("radzi się z importem wielolinijkowym (prettier łamie listy nazw)", () => {
    const out = staticImportSpecifiers(`import {\n  A,\n  B,\n} from "@/lib/wide";`);
    expect(out).toEqual(["@/lib/wide"]);
  });

  it("nie widzi importu ZAKOMENTOWANEGO", () => {
    expect(staticImportSpecifiers(`// import { X } from "@/lib/x";`)).toEqual([]);
  });
});

describe("resolveSpecifier", () => {
  const files = sources({
    "src/lib/a.ts": "",
    "src/lib/b/index.tsx": "",
    "src/components/C.tsx": "",
  });

  it("rozwija alias @/ i dobiera rozszerzenie oraz index", () => {
    expect(resolveSpecifier("@/lib/a", "src/routes/x.tsx", files)).toBe("src/lib/a.ts");
    expect(resolveSpecifier("@/lib/b", "src/routes/x.tsx", files)).toBe("src/lib/b/index.tsx");
  });

  it("rozwija ścieżki relatywne z wyjściem w górę", () => {
    expect(resolveSpecifier("../components/C", "src/lib/a.ts", files)).toBe("src/components/C.tsx");
  });

  it("zwraca null dla pakietów, assetów i nieistniejących plików", () => {
    expect(resolveSpecifier("@tanstack/react-query", "src/routes/x.tsx", files)).toBeNull();
    expect(resolveSpecifier("../styles.css?url", "src/routes/x.tsx", files)).toBeNull();
    expect(resolveSpecifier("@/lib/nie-ma", "src/routes/x.tsx", files)).toBeNull();
  });
});

describe("staticImportClosure", () => {
  it("liczy ODLEGŁOŚĆ, nie tylko przynależność - dowód ma wskazywać treść, nie atom", () => {
    const files = sources({
      "src/routes/r.tsx": `import { A } from "@/lib/a";`,
      "src/lib/a.ts": `import { B } from "@/lib/b";`,
      "src/lib/b.ts": "",
    });
    const closure = staticImportClosure("src/routes/r.tsx", files);
    expect(closure.get("src/routes/r.tsx")).toBe(0);
    expect(closure.get("src/lib/a.ts")).toBe(1);
    expect(closure.get("src/lib/b.ts")).toBe(2);
  });

  it("nie zapętla się na cyklu importów", () => {
    const files = sources({
      "src/lib/a.ts": `import { B } from "@/lib/b";`,
      "src/lib/b.ts": `import { A } from "@/lib/a";`,
    });
    expect([...staticImportClosure("src/lib/a.ts", files).keys()].sort()).toEqual([
      "src/lib/a.ts",
      "src/lib/b.ts",
    ]);
  });
});

describe("routeOptionsBlock / topLevelOption", () => {
  it("kotwiczy się na WYWOŁANIU createFileRoute, nie na jego imporcie", () => {
    // Regresja: `indexOf("createFileRoute")` trafiało w listę importów i opcje
    // trasy czytało z następnego importu (143 trasy „bez komponentu").
    const block = routeOptionsBlock(
      [
        `import { createFileRoute } from "@tanstack/react-router";`,
        `import { useSuspenseQuery } from "@tanstack/react-query";`,
        `export const Route = createFileRoute("/x")({`,
        `  component: Page,`,
        `});`,
      ].join("\n"),
    );
    expect(block).not.toBeNull();
    expect(block).toContain("component: Page");
    expect(block).not.toContain("useSuspenseQuery");
  });

  it("czyta opcje z definicji JEDNOLINIJKOWEJ (11 plików tras w repo)", () => {
    const source = `import { createFileRoute, Outlet } from "@tanstack/react-router";
export const Route = createFileRoute("/events")({ component: EventsLayout });`;
    expect(rendersHtml(source)).toBe(true);
    expect(readLoaderFacts(source).hasLoader).toBe(false);
  });

  it("ignoruje opcję o tej samej nazwie z ZAGNIEŻDŻONEGO obiektu", () => {
    const block = routeOptionsBlock(
      [
        `export const Route = createFileRoute("/x")({`,
        `  server: { handlers: { GET: () => new Response(null) } },`,
        `  head: () => ({ meta: [{ component: "nie-to" }] }),`,
        `});`,
      ].join("\n"),
    );
    expect(block).not.toBeNull();
    expect(topLevelOption(block ?? "", "server")).not.toBeNull();
    expect(topLevelOption(block ?? "", "component")).toBeNull();
  });
});

describe("readLoaderFacts", () => {
  const withLoader = (body: string) =>
    `export const Route = createFileRoute("/x")({\n  loader: async ({ context }) => {\n${body}\n  },\n  component: Page,\n});`;

  it("loader z ensureQueryData GRZEJE dane", () => {
    expect(
      readLoaderFacts(withLoader("    await context.queryClient.ensureQueryData(o());")),
    ).toEqual({ hasLoader: true, warms: true });
  });

  it("loadResilient też grzeje - to fail-soft wrapper repo", () => {
    expect(
      readLoaderFacts(withLoader("    await loadResilient(context.queryClient, o(), []);")).warms,
    ).toBe(true);
  });

  it("loader z samym nagłówkiem cache albo redirectem jest TRYWIALNY", () => {
    expect(readLoaderFacts(withLoader("    setCacheControlHeader(NO_STORE);"))).toEqual({
      hasLoader: true,
      warms: false,
    });
    expect(readLoaderFacts(withLoader('    throw redirect({ to: "/blog" });')).warms).toBe(false);
  });

  it("ensureQueryData w beforeLoad NIE robi z trasy trasy z loaderem", () => {
    const source = [
      `export const Route = createFileRoute("/x")({`,
      `  beforeLoad: async ({ context }) => {`,
      `    await context.queryClient.ensureQueryData(o());`,
      `  },`,
      `  component: Page,`,
      `});`,
    ].join("\n");
    expect(readLoaderFacts(source)).toEqual({ hasLoader: false, warms: false });
  });

  it("ZAKOMENTOWANY loader się nie liczy - inaczej spis dałoby się uciszyć komentarzem", () => {
    const source = [
      `export const Route = createFileRoute("/x")({`,
      `  // loader: async ({ context }) => context.queryClient.ensureQueryData(o()),`,
      `  component: Page,`,
      `});`,
    ].join("\n");
    expect(readLoaderFacts(source).hasLoader).toBe(false);
  });
});

describe("hasSsrDisabled / hasSessionGate / findQuerySites", () => {
  it("rozpoznaje ssr: false tylko jako opcję trasy", () => {
    expect(hasSsrDisabled(`export const Route = createFileRoute("/x")({ ssr: false });`)).toBe(
      true,
    );
    expect(hasSsrDisabled(`export const Route = createFileRoute("/x")({ component: Page });`)).toBe(
      false,
    );
  });

  it("bramkę sesji widzi w <AuthGate> i w nawigacji na /login", () => {
    expect(hasSessionGate(`return <AuthGate><Panel /></AuthGate>;`)).toBe(true);
    expect(hasSessionGate(`return <AuthGate fallbackTitle="x" />;`)).toBe(true);
    expect(hasSessionGate(`if (!isStaff) navigate({ to: "/login" });`)).toBe(true);
    expect(hasSessionGate(`const x = useAuth();`)).toBe(false);
  });

  it("liczy czytające hooki, pomija useMutation i useQueryClient", () => {
    const found = findQuerySites(
      "src/x.ts",
      [
        `const a = useQuery(o());`,
        `const b = useSuspenseQuery(o());`,
        `const c = useInfiniteQuery(o());`,
        `const d = useQueries({ queries: [] });`,
        `const e = useMutation({});`,
        `const f = useQueryClient();`,
      ].join("\n"),
    );
    expect(found.map((s) => s.hook)).toEqual([
      "useQuery",
      "useSuspenseQuery",
      "useInfiniteQuery",
      "useQueries",
    ]);
    expect(found[0].line).toBe(1);
  });
});

describe("keyFactorySymbols / loaderWarmedSymbols", () => {
  it("rozpoznaje fabryki `*QueryOptions`, `*QueryKey` i `xKeys.y`", () => {
    expect(keyFactorySymbols("...publicEventBySlugQueryOptions(slug)")).toEqual([
      "publicEventBySlugQueryOptions",
    ]);
    expect(keyFactorySymbols("queryKey: legalVersionQueryKey(key)")).toEqual([
      "legalVersionQueryKey",
    ]);
    expect(keyFactorySymbols("queryKey: publicEventKeys.sections(slug, viewer)")).toEqual([
      "publicEventKeys.sections",
    ]);
    // Literał klucza NIE jest fabryką - `BrandIcon` woła `["icon-library", …]`.
    expect(keyFactorySymbols('queryKey: ["icon-library", kind]')).toEqual([]);
  });

  it("czyta fabryki z loadera - także przez ALIAS lokalny", () => {
    // Regresja: `tracker.index.tsx:68` grzeje przez
    // `const itemsOptions = publishedItemsQueryOptions()`, a czytanie samego
    // argumentu `ensureQueryData(itemsOptions)` nie widziało tam fabryki.
    const source = [
      `export const Route = createFileRoute("/tracker/")({`,
      `  loader: async ({ context }) => {`,
      `    const itemsOptions = publishedItemsQueryOptions();`,
      `    await context.queryClient.ensureQueryData(itemsOptions);`,
      `  },`,
      `  component: Page,`,
      `});`,
    ].join("\n");
    expect(loaderWarmedSymbols(source)).toEqual(["publishedItemsQueryOptions"]);
  });

  it("loader BEZ wywołania grzejącego nie zalicza żadnej fabryki", () => {
    // `/qa` ściąga dane dla `head()` i nie wpisuje ich do cache zapytań.
    const source = [
      `export const Route = createFileRoute("/qa")({`,
      `  loader: async () => {`,
      `    const sessions = await fetchPublicQaSessions();`,
      `    return { sessions, key: qaListQueryOptions };`,
      `  },`,
      `  component: Page,`,
      `});`,
    ].join("\n");
    expect(loaderWarmedSymbols(source)).toEqual([]);
  });

  it("balancedArgs bierze argument z zagnieżdżonymi nawiasami", () => {
    const text = "useQuery({ ...o(a, [1, 2]), enabled: x })";
    expect(balancedArgs(text, text.indexOf("("))).toBe("{ ...o(a, [1, 2]), enabled: x }");
  });
});

describe("analysePublicRouteLoaders", () => {
  /**
   * Drzewo zastępcze pokrywające wszystkie kubełki werdyktu i wykluczenia.
   * `ParentGated` sprawdza DZIEDZICZENIE bramki sesji w dół drzewa - to ono
   * odpowiada za 23 z 27 tras w kubełku „bramka-sesji" na prawdziwym drzewie.
   */
  const input: PublicRouteLoaderInput = {
    routeTree: routeTree([
      { ident: "IndexRoute", file: "routes/index", path: "/", parent: "rootRouteImport" },
      { ident: "AdminRoute", file: "routes/admin", path: "/admin", parent: "rootRouteImport" },
      { ident: "StaticRoute", file: "routes/static", path: "/static", parent: "rootRouteImport" },
      { ident: "WarmRoute", file: "routes/warm", path: "/warm", parent: "rootRouteImport" },
      { ident: "ColdRoute", file: "routes/cold", path: "/cold", parent: "rootRouteImport" },
      {
        ident: "TrivialRoute",
        file: "routes/trivial",
        path: "/trivial",
        parent: "rootRouteImport",
      },
      { ident: "FeedRoute", file: "routes/feed", path: "/feed", parent: "rootRouteImport" },
      { ident: "NoSsrRoute", file: "routes/nossr", path: "/nossr", parent: "rootRouteImport" },
      { ident: "GatedRoute", file: "routes/gated", path: "/gated", parent: "rootRouteImport" },
      {
        ident: "GatedChildRoute",
        file: "routes/gated.child",
        path: "/child",
        parent: "GatedRoute",
      },
    ]),
    sources: sources({
      "src/routes/__root.tsx": ROOT,
      "src/components/Footer.tsx": `import { useQuery } from "@tanstack/react-query";\nconst x = useQuery(siteSettingsQueryOptions);`,
      "src/routes/index.tsx": `export const Route = createFileRoute("/")({ component: Page });`,
      "src/routes/admin.tsx": `export const Route = createFileRoute("/admin")({ ssr: false, component: Page });`,
      // Statyczna: importuje `Footer` (POWŁOKA), więc jej jedyne zapytanie zostaje odjęte.
      "src/routes/static.tsx": `import { Footer } from "../components/Footer";\nexport const Route = createFileRoute("/static")({ component: Page });`,
      "src/routes/warm.tsx": `import { useRows } from "@/lib/rows";\nexport const Route = createFileRoute("/warm")({\n  loader: ({ context }) => context.queryClient.ensureQueryData(rowsQueryOptions()),\n  component: Page,\n});`,
      "src/routes/cold.tsx": `import { useRows } from "@/lib/rows";\nexport const Route = createFileRoute("/cold")({ component: Page });`,
      "src/routes/trivial.tsx": `import { useRows } from "@/lib/rows";\nexport const Route = createFileRoute("/trivial")({\n  loader: () => setCacheControlHeader(NO_STORE),\n  component: Page,\n});`,
      "src/routes/feed.ts": `export const Route = createFileRoute("/feed")({ server: { handlers: { GET: () => new Response(null) } } });`,
      "src/routes/nossr.tsx": `import { useRows } from "@/lib/rows";\nexport const Route = createFileRoute("/nossr")({ ssr: false, component: Page });`,
      "src/routes/gated.tsx": `export const Route = createFileRoute("/gated")({ component: () => <AuthGate><Outlet /></AuthGate> });`,
      "src/routes/gated.child.tsx": `import { useRows } from "@/lib/rows";\nexport const Route = createFileRoute("/gated/child")({ component: Page });`,
      "src/lib/rows.ts": `import { useQuery } from "@tanstack/react-query";\nexport function useRows() {\n  return useQuery(rowsQueryOptions());\n}`,
    }),
  };

  const report = analysePublicRouteLoaders(input);
  const at = (path: string) => report.routes.find((route) => route.fullPath === path);

  it("wyklucza panel, ssr: false, trasy serwerowe i bramkę sesji (z dziedziczeniem)", () => {
    expect(at("/admin")?.exclusion).toBe("panel-admin");
    expect(at("/nossr")?.exclusion).toBe("ssr-wylaczony");
    expect(at("/feed")?.exclusion).toBe("bez-komponentu");
    expect(at("/gated")?.exclusion).toBe("bramka-sesji");
    expect(at("/gated/child")?.exclusion).toBe("bramka-sesji");
    // Dziecko nie ma własnej bramki - odziedziczyło ją po rodzicu.
    expect(at("/gated/child")?.exclusionFrom).toBe("/gated");
    expect(at("/gated")?.exclusionFrom).toBeNull();
  });

  it("odejmuje POWŁOKĘ: zapytanie z Footera nie robi z trasy statycznej defektu", () => {
    expect(at("/static")?.verdict).toBe("bez-zapytan");
    expect(at("/static")?.queryCount).toBe(0);
    expect(at("/")?.verdict).toBe("bez-zapytan");
  });

  it("rozdziela trzy stany trasy czytającej dane", () => {
    expect(at("/warm")?.verdict).toBe("loader-grzeje");
    expect(at("/trivial")?.verdict).toBe("loader-trywialny");
    expect(at("/cold")?.verdict).toBe("brak-loadera");
    expect(at("/cold")?.queryCount).toBe(1);
    // Zapytanie stoi w `lib/rows.ts`, nie w pliku trasy - hop 1.
    expect(at("/cold")?.coldQueriesInRouteFile).toBe(false);
    expect(at("/cold")?.querySites[0]).toMatchObject({ file: "src/lib/rows.ts", distance: 1 });
  });

  it("lista do roboty = brak loadera + loader trywialny, nic więcej", () => {
    expect(
      routesMissingWarmedLoader(report)
        .map((route) => route.fullPath)
        .sort(),
    ).toEqual(["/cold", "/trivial"]);
  });

  it("raport tekstowy podaje liczby i nazwy plików - da się go sprawdzić w edytorze", () => {
    const rendered = renderPublicRouteLoaderReport(report);
    expect(rendered).toContain("PUBLICZNE STRONY SSR");
    expect(rendered).toContain("src/routes/cold.tsx");
    expect(rendered).toContain("src/lib/rows.ts:3");
    // 5 publicznych stron SSR z 10 tras drzewa: /, /static, /warm, /cold, /trivial.
    expect(rendered).toContain("DO ROBOTY: 2 z 5");
  });
});

describe("łańcuch przodków i tożsamość w kluczu", () => {
  /**
   * Drzewo odwzorowuje układ, który zawiódł na prawdziwym repo:
   * `/shell` = powłoka z loaderem (jak `events.$slug.tsx`), `/shell/` = jej
   * dziecko `index` czytające TĘ SAMĄ fabrykę (jak `events.$slug.index.tsx`),
   * `/shell/tab` = zakładka z WŁASNĄ, nierozgrzaną fabryką (jak
   * `events.$slug.agenda.tsx`).
   */
  const input: PublicRouteLoaderInput = {
    routeTree: routeTree([
      { ident: "ShellRoute", file: "routes/shell", path: "/shell", parent: "rootRouteImport" },
      { ident: "ShellIndexRoute", file: "routes/shell.index", path: "/", parent: "ShellRoute" },
      { ident: "ShellTabRoute", file: "routes/shell.tab", path: "/tab", parent: "ShellRoute" },
      { ident: "ViewerRoute", file: "routes/viewer", path: "/viewer", parent: "rootRouteImport" },
      { ident: "DecoyRoute", file: "routes/decoy", path: "/decoy", parent: "rootRouteImport" },
    ]),
    sources: sources({
      "src/routes/__root.tsx": ROOT,
      "src/components/Footer.tsx": "",
      "src/routes/shell.tsx": `import { useRows } from "@/lib/rows";\nexport const Route = createFileRoute("/shell")({\n  loader: ({ context }) => context.queryClient.ensureQueryData(rowsQueryOptions()),\n  component: Shell,\n});`,
      "src/routes/shell.index.tsx": `import { useRows } from "@/lib/rows";\nexport const Route = createFileRoute("/shell/")({ component: Page });`,
      "src/routes/shell.tab.tsx": `import { useOther } from "@/lib/other";\nexport const Route = createFileRoute("/shell/tab")({ component: Page });`,
      "src/routes/viewer.tsx": `import { useMine } from "@/lib/viewer";\nexport const Route = createFileRoute("/viewer")({ component: Page });`,
      // Loader JEST i grzeje - ale INNĄ fabrykę niż ta, którą czyta render.
      "src/routes/decoy.tsx": `import { useOther } from "@/lib/other";\nexport const Route = createFileRoute("/decoy")({\n  loader: ({ context }) => context.queryClient.ensureQueryData(decoyQueryOptions()),\n  component: Page,\n});`,
      "src/lib/rows.ts": `import { useQuery } from "@tanstack/react-query";\nexport function useRows() {\n  return useQuery(rowsQueryOptions());\n}`,
      "src/lib/other.ts": `import { useQuery } from "@tanstack/react-query";\nexport function useOther() {\n  return useQuery(otherQueryOptions());\n}`,
      "src/lib/viewer.ts": `import { useQuery } from "@tanstack/react-query";\nexport function useMine(viewer: string) {\n  return useQuery({ queryKey: mineKeys.own(viewer), queryFn: fetchMine });\n}`,
    }),
  };

  const report = analysePublicRouteLoaders(input);
  const at = (path: string, file?: string) =>
    report.routes.find(
      (route) => route.fullPath === path && (file === undefined || route.file === file),
    );

  it("dziecko bez loadera JEST rozgrzane, gdy loader PRZODKA grzeje tę samą fabrykę", () => {
    const child = at("/shell", "src/routes/shell.index.tsx");
    expect(child?.hasLoader).toBe(false);
    expect(child?.verdict).toBe("loader-grzeje");
    expect(child?.warmQueryCount).toBe(1);
    expect(child?.warmedByAncestors).toEqual(["/shell"]);
  });

  it("zakładka z WŁASNĄ zimną fabryką dostaje `tresc-z-przodka`, nie długu", () => {
    const tab = at("/shell/tab");
    expect(tab?.verdict).toBe("tresc-z-przodka");
    expect(tab?.coldQueryCount).toBe(1);
    expect(routesMissingWarmedLoader(report).map((r) => r.fullPath)).not.toContain("/shell/tab");
  });

  it("sama OBECNOŚĆ grzejącego loadera nie wystarcza - musi grzać CZYTANY klucz", () => {
    const decoy = at("/decoy");
    expect(decoy?.hasLoader).toBe(true);
    expect(decoy?.loaderWarms).toBe(true);
    expect(decoy?.verdict).toBe("loader-trywialny");
    expect(decoy?.coldQueryCount).toBe(1);
  });

  it("tożsamość czytelnika w kluczu to OSOBNA kategoria, nie dług SSR", () => {
    const viewer = at("/viewer");
    expect(viewer?.verdict).toBe("tylko-widok-goscia");
    expect(viewer?.viewerQueryCount).toBe(1);
    expect(viewer?.coldQueryCount).toBe(0);
    expect(routesGuestViewOnly(report).map((r) => r.fullPath)).toEqual(["/viewer"]);
    expect(routesMissingWarmedLoader(report).map((r) => r.fullPath)).not.toContain("/viewer");
  });
});

describe("parser routeTree.gen.ts", () => {
  it("czyta deklarację ZŁAMANĄ przez prettier po znaku równości", () => {
    // Regresja: bez `=\s*` w DECL_RE spis gubił 79 z 368 wpisów w milczeniu.
    const tree = [
      `import { Route as LongRouteImport } from './routes/[.well-known]/gpc[.]json'`,
      `const LongRoute =`,
      `  LongRouteImport.update({`,
      `    id: '/.well-known/gpc.json',`,
      `    path: '/.well-known/gpc.json',`,
      `    getParentRoute: () => rootRouteImport,`,
      `  } as any)`,
    ].join("\n");
    const report = analysePublicRouteLoaders({
      routeTree: tree,
      sources: sources({
        "src/routes/__root.tsx": ROOT,
        "src/components/Footer.tsx": "",
        "src/routes/[.well-known]/gpc[.]json.ts": `export const Route = createFileRoute("/.well-known/gpc.json")({ server: {} });`,
      }),
    });
    expect(report.routes).toHaveLength(1);
    expect(report.routes[0].fullPath).toBe("/.well-known/gpc.json");
  });

  it("składa pełną ścieżkę z segmentów rodziców", () => {
    const tree = routeTree([
      { ident: "EventsRoute", file: "routes/events", path: "/events", parent: "rootRouteImport" },
      {
        ident: "EventsSlugRoute",
        file: "routes/events.$slug",
        path: "/$slug",
        parent: "EventsRoute",
      },
      {
        ident: "EventsSlugSpeakersRoute",
        file: "routes/events.$slug.speakers",
        path: "/speakers",
        parent: "EventsSlugRoute",
      },
    ]);
    const stub = `export const Route = createFileRoute("/x")({ component: Page });`;
    const report = analysePublicRouteLoaders({
      routeTree: tree,
      sources: sources({
        "src/routes/__root.tsx": ROOT,
        "src/components/Footer.tsx": "",
        "src/routes/events.tsx": stub,
        "src/routes/events.$slug.tsx": stub,
        "src/routes/events.$slug.speakers.tsx": stub,
      }),
    });
    expect(report.routes.map((route) => route.fullPath)).toEqual([
      "/events",
      "/events/$slug",
      "/events/$slug/speakers",
    ]);
  });
});
