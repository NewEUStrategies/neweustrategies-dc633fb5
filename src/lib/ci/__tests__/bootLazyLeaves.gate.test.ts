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
//
// Granica testu: graf źródeł, nie artefakt. Że liść naprawdę wyszedł
// z `app-initial` i dokąd poszedł, mierzy build (`check:bundle`,
// `chunk-inventory`). Graf źródeł przeszacowuje boot (liczy też importy
// wycinane z klienta, np. serwerowe widgety czytelnicze `lazyWidgets`), więc
// sprawdzenie (2) jest ostrożne, nie dziurawe.
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { buildImportGraph } from "../moduleImportGraph";

const POST_CONTEXT_PREVIEW = "src/lib/content-model/postContextPreview.ts";
const PODCAST_PAGE_QUERIES = "src/lib/queries/podcasts.ts";
const POPUP_DESIGN_RESOLVE = "src/lib/newsletter/popupDesignResolve.ts";
const CLUB_HUB_QUERY = "src/lib/builder/clubHubQuery.ts";
const LAZY_LEAVES = [
  POST_CONTEXT_PREVIEW,
  PODCAST_PAGE_QUERIES,
  POPUP_DESIGN_RESOLVE,
  CLUB_HUB_QUERY,
] as const;

/** Moduł bootu -> liście, których jego statyczne domknięcie nie może zawierać. */
const BOOT_MODULE_LAZY_LEAVES: ReadonlyArray<readonly [string, readonly string[]]> = [
  // Korzeń layoutu nie jest dzielony - całe jego domknięcie jest bootem.
  ["src/routes/__root.tsx", LAZY_LEAVES],
  // Rejestr prefetchu widgetów (statyczny import korzenia) - przez niego do
  // bootu wchodziły zapytania podcastów, klubów i ustawienia popupu.
  ["src/lib/builder/prefetch.ts", LAZY_LEAVES],
  ["src/lib/content-model/postContext.tsx", [POST_CONTEXT_PREVIEW]],
  ["src/lib/builder/mediaListQuery.ts", [PODCAST_PAGE_QUERIES]],
  ["src/lib/queries/podcastsLatest.ts", [PODCAST_PAGE_QUERIES]],
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
    "src/routes/author.$slug.tsx",
    // Sekcja podcastów strony kategorii i tagu.
    "src/components/archive/TaxonomyPage.tsx",
    // Zapytania panelu podcastów.
    "src/lib/podcast/queries.ts",
    ...ADMIN_CODE,
  ],
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
});
