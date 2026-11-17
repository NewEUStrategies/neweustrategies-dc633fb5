// @vitest-environment node
//
// Moduły chunku startowego nie sięgają do liści czytanych wyłącznie przez
// leniwe chunki stron publicznych (roadmapa ładowania §9.10 - ciąg dalszy J3
// z §9.8, gdzie te same reguły chronią liście panelu:
// `bootAdminLeaves.gate.test.ts`).
//
// Moduł importowany statycznie przez kod bootu trafia do `app-initial`
// W CAŁOŚCI. Dlatego kod, którego boot nie woła (popup rejestracji, zapytania
// stron podcastów, sekcje widgetu „Klub: strona", próbka kanwy buildera),
// mieszka w osobnych liściach, a ten test pilnuje obu kierunków:
//   1. moduł bootu nie dosięga liścia statycznym importem - wprost, reeksportem
//      ani przez pośrednika;
//   2. liść importują wyłącznie WYMIENIENI z nazwy leniwi odbiorcy (komponenty
//      funkcji, trasy, których import czyta podzielony loader/komponent, panel)
//      i żaden z nich nie leży w statycznym domknięciu korzenia ani modułów
//      bootu z listy. Nowy importer musi trafić tu świadomie, z uzasadnieniem.
//   3. plik trasy importujący liść czyta jego wiązania wyłącznie w częściach,
//      które splitter TanStacka wydziela z modułu trasy (`routeSplitBehavior`:
//      loader, komponenty). Powłoka trasy (`head`, `beforeLoad`,
//      `validateSearch`, `loaderDeps`, `pendingComponent`, eksporty, kod
//      najwyższego poziomu) jest w `app-initial`, więc jedno odwołanie stamtąd
//      wciąga cały liść z powrotem do bootu (znalezisko przeglądu partii 4:
//      mutacja `head()` trasy /podcasts przechodziła przez wszystkie bramki).
//
// Granica testu: graf źródeł, nie artefakt. Że liść naprawdę wyszedł
// z `app-initial` i dokąd poszedł, mierzy build (`check:bundle`,
// `chunk-inventory`). Graf źródeł przeszacowuje boot (liczy też importy
// wycinane z klienta, np. serwerowe widgety czytelnicze `lazyWidgets`), więc
// sprawdzenie (2) jest ostrożne, nie dziurawe.
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { routeSplitBehavior } from "../../../../scripts/lib/routeCodeSplitting";
import { buildImportGraph, resolveImport } from "../moduleImportGraph";

const POST_CONTEXT_PREVIEW = "src/lib/content-model/postContextPreview.ts";
const PODCAST_PAGE_QUERIES = "src/lib/queries/podcasts.ts";
// Sekcje „Podcasty" stron kategorii/tagu i autora: osobne liście, żeby trafiły
// do chunków tych stron, a nie do wspólnego chunku `podcasts` (dodatkowe
// żądanie w zestawie startowym /category, /tag, /author - przegląd partii 4).
const PODCASTS_BY_CATEGORY = "src/lib/queries/podcastsByCategory.ts";
const PODCASTS_BY_PROFILE = "src/lib/queries/podcastsByProfile.ts";
const POPUP_DESIGN_RESOLVE = "src/lib/newsletter/popupDesignResolve.ts";
const CLUB_HUB_QUERY = "src/lib/builder/clubHubQuery.ts";
const LAZY_LEAVES = [
  POST_CONTEXT_PREVIEW,
  PODCAST_PAGE_QUERIES,
  PODCASTS_BY_CATEGORY,
  PODCASTS_BY_PROFILE,
  POPUP_DESIGN_RESOLVE,
  CLUB_HUB_QUERY,
] as const;

const PODCAST_LEAVES = [PODCAST_PAGE_QUERIES, PODCASTS_BY_CATEGORY, PODCASTS_BY_PROFILE];

/** Moduł bootu -> liście, których jego statyczne domknięcie nie może zawierać. */
const BOOT_MODULE_LAZY_LEAVES: ReadonlyArray<readonly [string, readonly string[]]> = [
  // Korzeń layoutu nie jest dzielony - całe jego domknięcie jest bootem.
  ["src/routes/__root.tsx", LAZY_LEAVES],
  // Rejestr prefetchu widgetów (statyczny import korzenia) - przez niego do
  // bootu wchodziły zapytania podcastów, klubów i ustawienia popupu.
  ["src/lib/builder/prefetch.ts", LAZY_LEAVES],
  ["src/lib/content-model/postContext.tsx", [POST_CONTEXT_PREVIEW]],
  ["src/lib/builder/mediaListQuery.ts", PODCAST_LEAVES],
  ["src/lib/queries/podcastsLatest.ts", PODCAST_LEAVES],
  ["src/hooks/useNewsletterSettings.ts", [POPUP_DESIGN_RESOLVE]],
  ["src/lib/newsletter/popupDesign.ts", [POPUP_DESIGN_RESOLVE]],
  ["src/lib/builder/clubsQuery.ts", [CLUB_HUB_QUERY]],
];

const ADMIN_CODE = [/^src\/components\/admin\//, /^src\/routes\/admin[./]/] as const;

/** Liść -> jedyni dozwoleni importerzy statyczni (poza innymi liśćmi z listy). */
const LAZY_LEAF_IMPORTERS: Readonly<Record<string, readonly (string | RegExp)[]>> = {
  [POST_CONTEXT_PREVIEW]: [
    // Widgety tagów dynamicznych - leniwy chunk rejestru `lazyWidgets`.
    "src/components/builder/organisms/widget-view/DynamicTagWidgets.tsx",
    // Zbiór napisów próbki dla bramki wycieku (czytają go wyłącznie testy).
    "src/lib/builder/ci/sampleTokens.ts",
    ...ADMIN_CODE,
  ],
  [PODCAST_PAGE_QUERIES]: [
    // Trasy: import czytają podzielony loader i komponent, nie powłoka.
    "src/routes/podcasts.index.tsx",
    "src/routes/podcasts.$show.tsx",
    "src/routes/podcast.$slug.tsx",
    // Zapytania panelu podcastów.
    "src/lib/podcast/queries.ts",
    ...ADMIN_CODE,
  ],
  // Wyłącznie strona kategorii/tagu (komponent dzielony przez obie trasy).
  [PODCASTS_BY_CATEGORY]: ["src/components/archive/TaxonomyPage.tsx"],
  // Wyłącznie trasa autora (loader i komponent - część podzielona).
  [PODCASTS_BY_PROFILE]: ["src/routes/author.$slug.tsx"],
  [POPUP_DESIGN_RESOLVE]: [
    // Popup rejestracji i jego części.
    "src/components/NewsletterPopup.tsx",
    "src/components/PopupSignupForm.tsx",
    "src/components/popups/SignupPopupPanel.tsx",
    "src/components/ui/signup-showcase.tsx",
    "src/lib/newsletter/popupImages.ts",
    // Ciała odczytu ustawień - hook ładuje je importem dynamicznym.
    "src/hooks/newsletterSettingsData.ts",
    ...ADMIN_CODE,
  ],
  [CLUB_HUB_QUERY]: ["src/components/builder/organisms/widget-view/ClubHubView.tsx"],
};

/**
 * Trasy, których `head()` (powłoka trasy, chunk startowy) czyta wyłącznie
 * importy. Lokalna stała wspólna dla `head()` i komponentu ląduje w module
 * `?tsr-shared`, który powłoka importuje statycznie razem z KAŻDĄ inną stałą
 * wspólną dla części trasy (wzorzec `lib/legal/meta.ts`).
 */
const HEAD_READS_ONLY_IMPORTS = ["src/routes/sitemap.tsx"] as const;

const PRODUCTION_SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const NOT_PRODUCTION = /(^|\/)(__tests__|test)\/|\.(test|spec|stories)\.|\.d\.ts$/;

function productionFiles(): string[] {
  return (readdirSync("src", { recursive: true }) as string[])
    .map((entry) => `src/${entry.split("\\").join("/")}`)
    .filter((path) => PRODUCTION_SOURCE.test(path) && !NOT_PRODUCTION.test(path))
    .sort();
}

const matches = (path: string, rule: string | RegExp): boolean =>
  typeof rule === "string" ? rule === path : rule.test(path);

/** Nazwy deklaracji najwyższego poziomu pliku (bez importów). */
function topLevelLocalNames(file: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of file.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
      }
    } else if (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
      statement.name
    ) {
      names.add(statement.name.text);
    }
  }
  return names;
}

/** Inicjalizator właściwości `head` w opcjach `createFileRoute(...)({...})`. */
function routeHeadInitializer(file: ts.SourceFile): ts.Node | null {
  let found: ts.Node | null = null;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (
      ts.isCallExpression(node) &&
      ts.isCallExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "createFileRoute"
    ) {
      const [options] = node.arguments;
      if (options && ts.isObjectLiteralExpression(options)) {
        for (const property of options.properties) {
          if (ts.isPropertyAssignment(property) && property.name.getText(file) === "head") {
            found = property.initializer;
          } else if (ts.isMethodDeclaration(property) && property.name.getText(file) === "head") {
            found = property;
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** Identyfikatory czytane w węźle (bez nazw właściwości i deklaracji w nim). */
function referencedNames(node: ts.Node): Set<string> {
  const declared = new Set<string>();
  const used = new Set<string>();
  const visit = (current: ts.Node) => {
    if (
      (ts.isVariableDeclaration(current) || ts.isParameter(current)) &&
      ts.isIdentifier(current.name)
    ) {
      declared.add(current.name.text);
    }
    if (ts.isIdentifier(current)) {
      const parent = current.parent;
      const isPropertyName =
        (ts.isPropertyAccessExpression(parent) && parent.name === current) ||
        (ts.isPropertyAssignment(parent) && parent.name === current);
      if (!isPropertyName) used.add(current.text);
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return new Set([...used].filter((name) => !declared.has(name)));
}

/** Domyślny podział TanStacka, gdy reguła zwraca `undefined` (tylko korzeń). */
const TANSTACK_DEFAULT_SPLIT = ["component", "errorComponent", "notFoundComponent"];

interface RouteShellRead {
  readonly route: string;
  readonly where: string;
  readonly names: readonly string[];
}

/**
 * Odwołania powłoki trasy do wiązań zaimportowanych z liści. Wiązanie liczy się
 * też pośrednio: deklaracja najwyższego poziomu, która go używa, sama staje się
 * „skażona" (splitter przenosi ją do części podzielonej tylko wtedy, gdy czyta ją
 * wyłącznie część podzielona; wspólną z powłoką wkłada do `?tsr-shared`).
 */
function routeShellLeafReads(
  route: string,
  source: string,
  isLeaf: (specifier: string) => boolean,
): RouteShellRead[] {
  const file = ts.createSourceFile(route, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const tainted = new Set<string>();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly || !isLeaf(statement.moduleSpecifier.text)) continue;
    if (clause.name) tainted.add(clause.name.text);
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) tainted.add(bindings.name.text);
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if (!element.isTypeOnly) tainted.add(element.name.text);
      }
    }
  }
  if (tainted.size === 0) return [];

  let options: ts.ObjectLiteralExpression | null = null;
  let routeId: string | null = null;
  let routeStatement: ts.Statement | null = null;
  for (const statement of file.statements) {
    const visit = (node: ts.Node) => {
      if (
        !options &&
        ts.isCallExpression(node) &&
        ts.isCallExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === "createFileRoute"
      ) {
        const [id] = node.expression.arguments;
        const [routeOptions] = node.arguments;
        if (id && ts.isStringLiteralLike(id)) routeId = id.text;
        if (routeOptions && ts.isObjectLiteralExpression(routeOptions)) {
          options = routeOptions;
          routeStatement = statement;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(statement);
  }
  if (!options || routeId === null) {
    return [
      { route, where: 'brak createFileRoute("…")({...}) do sprawdzenia', names: [...tainted] },
    ];
  }

  const declarations = file.statements.filter(
    (statement) =>
      statement !== routeStatement &&
      (ts.isVariableStatement(statement) ||
        ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement)),
  );
  const declaredNames = (statement: ts.Statement): string[] =>
    ts.isVariableStatement(statement)
      ? statement.declarationList.declarations.flatMap((d) =>
          ts.isIdentifier(d.name) ? [d.name.text] : [],
        )
      : (statement as ts.FunctionDeclaration | ts.ClassDeclaration).name
        ? [((statement as ts.FunctionDeclaration | ts.ClassDeclaration).name as ts.Identifier).text]
        : [];
  for (let changed = true; changed;) {
    changed = false;
    for (const statement of declarations) {
      const names = declaredNames(statement);
      if (names.every((name) => tainted.has(name))) continue;
      if ([...referencedNames(statement)].some((name) => tainted.has(name))) {
        for (const name of names) tainted.add(name);
        changed = true;
      }
    }
  }

  const split = new Set<string>(
    (routeSplitBehavior({ routeId }) ?? [TANSTACK_DEFAULT_SPLIT]).flat(),
  );
  const reads: RouteShellRead[] = [];
  const record = (where: string, node: ts.Node) => {
    const names = [...referencedNames(node)].filter((name) => tainted.has(name)).sort();
    if (names.length > 0) reads.push({ route, where, names });
  };
  for (const property of (options as ts.ObjectLiteralExpression).properties) {
    const name =
      property.name && !ts.isComputedPropertyName(property.name)
        ? property.name.getText(file)
        : property.getText(file);
    if (ts.isSpreadAssignment(property) || !split.has(name)) record(`opcja ${name}`, property);
  }
  for (const statement of file.statements) {
    if (statement === routeStatement || ts.isImportDeclaration(statement)) continue;
    const exported = ts.canHaveModifiers(statement)
      ? (ts.getModifiers(statement) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      : false;
    if (declarations.includes(statement) && !exported) continue;
    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) continue;
    record(exported ? "eksport najwyższego poziomu" : "kod najwyższego poziomu", statement);
  }
  return reads;
}

describe("chunk startowy: moduły bootu nie sięgają do liści stron publicznych", () => {
  const files = productionFiles();
  const known = new Set(files);
  const next = new Map<string, string[]>();
  for (const edge of buildImportGraph(files, (path) => readFileSync(path, "utf8"))) {
    if (edge.dynamic) continue;
    const list = next.get(edge.from) ?? [];
    list.push(edge.to);
    next.set(edge.from, list);
  }

  /** Statyczne domknięcie z pierwszą znalezioną ścieżką do każdego pliku. */
  function staticClosure(root: string): Map<string, string[]> {
    const paths = new Map<string, string[]>([[root, [root]]]);
    const queue = [root];
    while (queue.length > 0) {
      const from = queue.shift() as string;
      for (const to of next.get(from) ?? []) {
        if (paths.has(to)) continue;
        paths.set(to, [...(paths.get(from) as string[]), to]);
        queue.push(to);
      }
    }
    return paths;
  }

  it("każdy moduł, liść, importer i trasa z listy istnieje (przemianowanie nie wyłącza strażnika po cichu)", () => {
    const listed = [
      ...BOOT_MODULE_LAZY_LEAVES.flatMap(([boot, leaves]) => [boot, ...leaves]),
      ...Object.keys(LAZY_LEAF_IMPORTERS),
      ...Object.values(LAZY_LEAF_IMPORTERS)
        .flat()
        .filter((rule): rule is string => typeof rule === "string"),
      ...HEAD_READS_ONLY_IMPORTS,
    ];
    expect(listed.filter((path) => !known.has(path))).toEqual([]);
    expect(Object.keys(LAZY_LEAF_IMPORTERS).sort()).toEqual([...LAZY_LEAVES].sort());
  });

  it.each(BOOT_MODULE_LAZY_LEAVES)("%s nie importuje statycznie liści leniwych", (boot, leaves) => {
    const closure = staticClosure(boot);
    const reached = leaves
      .filter((leaf) => closure.has(leaf))
      .map((leaf) => (closure.get(leaf) as string[]).join(" -> "));
    expect(reached).toEqual([]);
  });

  it("liście importują statycznie tylko wymienieni leniwi odbiorcy i inne liście", () => {
    const leaves = new Set<string>(LAZY_LEAVES);
    const offenders: string[] = [];
    for (const [from, targets] of next) {
      if (leaves.has(from)) continue;
      for (const to of targets) {
        if (!leaves.has(to)) continue;
        if (LAZY_LEAF_IMPORTERS[to].some((rule) => matches(from, rule))) continue;
        offenders.push(`${from} -> ${to}`);
      }
    }
    expect(offenders.sort()).toEqual([]);
  });

  it("wymienieni importerzy liści nie leżą w statycznym domknięciu modułów bootu", () => {
    const bootClosure = new Map<string, string[]>();
    for (const [boot] of BOOT_MODULE_LAZY_LEAVES) {
      for (const [file, path] of staticClosure(boot)) {
        if (!bootClosure.has(file)) bootClosure.set(file, path);
      }
    }
    const importers = Object.values(LAZY_LEAF_IMPORTERS)
      .flat()
      .filter((rule): rule is string => typeof rule === "string");
    const inBoot = importers
      .filter((importer) => bootClosure.has(importer))
      .map((importer) => (bootClosure.get(importer) as string[]).join(" -> "));
    expect(inBoot).toEqual([]);
  });

  it.each(HEAD_READS_ONLY_IMPORTS)(
    "%s: head() czyta wyłącznie importy, nie stałe wspólne z komponentem",
    (route) => {
      const file = ts.createSourceFile(
        route,
        readFileSync(route, "utf8"),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      const head = routeHeadInitializer(file);
      expect(head, `brak head() w opcjach trasy ${route}`).not.toBeNull();
      const locals = topLevelLocalNames(file);
      const shared = [...referencedNames(head as ts.Node)].filter((name) => locals.has(name));
      expect(shared.sort()).toEqual([]);
    },
  );

  it("trasy importujące liście czytają je tylko w częściach podzielonych, nie w powłoce", () => {
    const leaves = new Set<string>(LAZY_LEAVES);
    const routes = [...next]
      .filter(
        ([from, targets]) => from.startsWith("src/routes/") && targets.some((to) => leaves.has(to)),
      )
      .map(([from]) => from)
      .sort();
    // Bez tras z importem liścia sprawdzenie byłoby puste i zielone z założenia.
    expect(routes).toContain("src/routes/author.$slug.tsx");
    expect(routes).toContain("src/routes/podcasts.index.tsx");
    const reads = routes.flatMap((route) =>
      routeShellLeafReads(route, readFileSync(route, "utf8"), (specifier) => {
        const target = resolveImport(route, specifier, (path) => known.has(path));
        return target !== null && leaves.has(target);
      }),
    );
    expect(reads.map((read) => `${read.route}: ${read.where} -> ${read.names.join(", ")}`)).toEqual(
      [],
    );
  });
});
