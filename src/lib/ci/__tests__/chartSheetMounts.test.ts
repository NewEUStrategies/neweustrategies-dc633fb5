/**
 * ARKUSZ WYKRESÓW DOCIERA DO KAŻDEGO MIEJSCA, KTÓRE NIM MALUJE (roadmapa 9.3, S1).
 *
 * Reguły silnika wykresów (`.neh-*`), kartogramu, "digital features" (`.nes-sankey-*`,
 * `.nes-feature-reveal`...), paleta `--chart-*` obu motywów i druk wykresu wyszły z arkusza
 * głównego (blokującego KAŻDĄ stronę) do `src/components/charts/chart-sheet.css`, który
 * ładuje `<ChartStylesheet />` (link `precedence` w renderze) albo `head()` trasy `/admin`.
 * Moduł, który maluje tą powierzchnią bez linku, na stronie bez wykresu traci style po
 * cichu: `var(--chart-1)` bez definicji to brak koloru, nie błąd. Ten test pilnuje:
 *   1. arkusz główny nie deklaruje `--chart-*` ani reguł na klasach rodziny, a arkusz
 *      wykresów nie ma `@layer` (stoi za arkuszem głównym; warstwa przestawiłaby kolejność
 *      warstw strony);
 *   2. każdy moduł, który odwołuje się do rodziny (klasa z arkusza wykresów albo `--chart-`
 *      w napisie, szablonie lub atrybucie JSX), jest POKRYTY: renderuje `<ChartStylesheet />`
 *      albo każdy moduł, który bierze od niego eksport niosący odwołanie, jest pokryty
 *      (rekurencyjnie, skażenie po deklaracjach najwyższego poziomu). Trasa pod `/admin` jest
 *      pokryta przez `head()` układu panelu.
 *
 * SAM IMPORT KOMPONENTU Z LINKIEM NIE POKRYWA. Moduł, który importuje ramę i wkłada w nią
 * rysunek (mapa danych), wygląda w grafie importów tak samo jak rejestr, który importuje
 * dziesięć widoków i tylko jeden z nich ma link - reguła "importuje renderujący" przepuściłaby
 * widok bez linku, bo jego rejestr importuje inny widok z linkiem (sprawdzone mutacją). Ramy
 * i mapy renderują więc link same, nawet gdy rama w środku też go ma (React deduplikuje zasób).
 *
 * Granica metody: łańcuch importów przybliża łańcuch przodków w drzewie renderu, a analiza
 * nie widzi gałęzi renderu (wczesny `return` przed ramą). Dlatego link stoi w głównej gałęzi
 * ram i widoków, a puste stany, które malują tokenem (pusty wykres w `Chart.tsx`), mają go same.
 *
 * i18n: brak treści dla użytkownika - inwariant CI.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { buildImportGraph } from "@/lib/ci/moduleImportGraph";
import { parseCssRules } from "@/test/cssRules";

const ROOT = process.cwd();
const rel = (file: string) => relative(ROOT, file).replace(/\\/g, "/");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const CHART_SHEET = "src/components/charts/chart-sheet.css";
const ROOT_SHEET = "src/styles.css";
const ADMIN_LAYOUT = "src/routes/admin.tsx";
const STYLESHEET_COMPONENT = "src/components/charts/ChartStylesheet.tsx";

/** Pliki składające arkusz wykresów - z jego własnych `@import`, nie z listy w teście. */
const SHEET_PARTS = [...read(CHART_SHEET).matchAll(/@import\s+["']([^"']+)["']/g)].map((m) =>
  rel(join(ROOT, "src/components/charts", m[1])),
);

/** Klasy-przodkowie z arkusza głównego, które reguły wykresów jedynie zawężają (`.dark .neh-chart`). */
const CONTEXT_CLASSES = new Set(["dark", "light"]);

const CLASS_IN_SELECTOR = /\.(-?[_a-zA-Z][\w-]*)/g;
const selectorClasses = (css: string): Set<string> => {
  const out = new Set<string>();
  for (const rule of parseCssRules(css))
    for (const selector of rule.selectors)
      for (const match of selector.matchAll(CLASS_IN_SELECTOR)) out.add(match[1]);
  return out;
};

/** Klasy rodziny: każda klasa z selektorów arkusza wykresów poza klasami kontekstu motywu. */
const FAMILY_CLASSES = [...new Set(SHEET_PARTS.flatMap((p) => [...selectorClasses(read(p))]))]
  .filter((name) => !CONTEXT_CLASSES.has(name))
  .sort();

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
const FAMILY_CLASS = new RegExp(`(?<![\\w-])(?:${FAMILY_CLASSES.map(escape).join("|")})(?![\\w-])`);
const CHART_TOKEN = /--chart-/;

/** Odwołanie do rodziny w samym tekście (wstępne sito przed parserem). */
const mentionsFamily = (text: string) => CHART_TOKEN.test(text) || FAMILY_CLASS.test(text);

// ---------------------------------------------------------------------------
// Moduły i graf importów wartości (bez `import type` - wymazywanych przez kompilator).
// ---------------------------------------------------------------------------
const MODULES = (readdirSync(join(ROOT, "src"), { recursive: true }) as string[])
  .map((file) => `src/${file.replace(/\\/g, "/")}`)
  .filter(
    (file) =>
      /\.(ts|tsx)$/.test(file) &&
      !/\/__tests__\/|\.(test|spec)\.tsx?$|^src\/test\//.test(file) &&
      !file.endsWith("routeTree.gen.ts"),
  );
const SOURCE = new Map(MODULES.map((file) => [file, read(file)]));
const EDGES = buildImportGraph(MODULES, (file) => SOURCE.get(file) ?? "");
const IMPORTERS = new Map<string, Set<string>>();
for (const { from, to } of EDGES) {
  if (!IMPORTERS.has(to)) IMPORTERS.set(to, new Set());
  IMPORTERS.get(to)!.add(from);
}

const parsed = new Map<string, ts.SourceFile>();
function sourceFile(file: string): ts.SourceFile {
  let sf = parsed.get(file);
  if (!sf) {
    const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    sf = ts.createSourceFile(file, SOURCE.get(file) ?? "", ts.ScriptTarget.Latest, true, kind);
    parsed.set(file, sf);
  }
  return sf;
}

/** Węzły napisów kodu (literały, części szablonów, tekst JSX) - komentarze się nie liczą. */
function familyNodes(file: string): ts.Node[] {
  const raw = SOURCE.get(file) ?? "";
  if (!mentionsFamily(raw)) return [];
  const found: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isStringLiteralLike(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node) ||
        ts.isJsxText(node)) &&
      mentionsFamily(node.text)
    ) {
      found.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile(file));
  return found;
}

/** Moduły odwołujące się do rodziny w kodzie. */
const USERS = MODULES.filter((file) => familyNodes(file).length > 0);

const RENDERS_LINK = /<ChartStylesheet\s*\/>/;
const rendersLink = (file: string) => RENDERS_LINK.test(SOURCE.get(file) ?? "");

/** Trasa w układzie `/admin` (pierwszy segment dokładnie `admin`, nie `admin_`). */
const isAdminRoute = (file: string) => /^src\/routes\/admin(\.|\/)/.test(file);
const ADMIN_LINKS_SHEET =
  /import (\w+) from "@\/components\/charts\/chart-sheet\.css\?url"[\s\S]*links:\s*\[[\s\S]*rel: "stylesheet", href: \1 \}/.test(
    SOURCE.get(ADMIN_LAYOUT) ?? "",
  );

/** Nazwy deklarowane przez instrukcję najwyższego poziomu i to, czy jest eksportowana. */
function declared(stmt: ts.Statement): { names: string[]; exported: boolean } {
  const exported =
    ts.canHaveModifiers(stmt) &&
    (ts.getModifiers(stmt) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  if (ts.isVariableStatement(stmt))
    return {
      names: stmt.declarationList.declarations.flatMap((d) =>
        ts.isIdentifier(d.name) ? [d.name.text] : [],
      ),
      exported,
    };
  if (
    (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt) || ts.isEnumDeclaration(stmt)) &&
    stmt.name
  )
    return { names: [stmt.name.text], exported };
  return { names: [], exported };
}

function containsSeed(node: ts.Node, strings: Set<ts.Node>, seeds: Set<string>): boolean {
  let hit = false;
  const visit = (n: ts.Node): void => {
    if (hit) return;
    if (strings.has(n) || (ts.isIdentifier(n) && seeds.has(n.text))) {
      hit = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return hit;
}

/**
 * Eksporty niosące odwołanie: skażenie po deklaracjach najwyższego poziomu. Ziarnem są
 * napisy z odwołaniem w module i lokalne wiązania importów, które niosą je z modułu niżej;
 * deklaracja, która używa skażonej nazwy, sama jest skażona (do punktu stałego). Skażona
 * instrukcja bez nazwy (efekt uboczny, `export default`) czyni nośnikiem każdy eksport.
 */
function carryingExports(file: string, seeds: Set<string>): Set<string> | "all" {
  const strings = new Set(familyNodes(file));
  const statements = sourceFile(file).statements.filter(
    (stmt) => !ts.isImportDeclaration(stmt) && !ts.isTypeAliasDeclaration(stmt),
  );
  const tainted = new Set<ts.Statement>();
  const names = new Set(seeds);
  for (let changed = true; changed;) {
    changed = false;
    for (const stmt of statements) {
      if (ts.isExportDeclaration(stmt)) continue; // `export { a as b }` - rozliczane niżej
      if (tainted.has(stmt) || !containsSeed(stmt, strings, names)) continue;
      tainted.add(stmt);
      changed = true;
      const { names: own } = declared(stmt);
      if (own.length === 0 && !ts.isInterfaceDeclaration(stmt)) return "all";
      for (const name of own) names.add(name);
    }
  }
  const out = new Set<string>();
  for (const stmt of statements) {
    const { names: own, exported } = declared(stmt);
    if (exported && tainted.has(stmt)) for (const name of own) out.add(name);
    if (ts.isExportDeclaration(stmt) && !stmt.moduleSpecifier && stmt.exportClause) {
      if (!ts.isNamedExports(stmt.exportClause)) return "all";
      for (const el of stmt.exportClause.elements)
        if (names.has((el.propertyName ?? el.name).text)) out.add(el.name.text);
    }
  }
  return out;
}

function resolvesTo(importer: string, specifier: string, target: string): boolean {
  const strip = (p: string) => p.replace(/\.(tsx?|jsx?)$/, "").replace(/\/index$/, "");
  const want = strip(target);
  if (specifier.startsWith("@/")) return strip(`src/${specifier.slice(2)}`) === want;
  if (specifier.startsWith(".")) {
    const parts = importer.split("/").slice(0, -1);
    for (const seg of specifier.split("/")) {
      if (seg === "..") parts.pop();
      else if (seg !== ".") parts.push(seg);
    }
    return strip(parts.join("/")) === want;
  }
  return false;
}

/**
 * Lokalne nazwy, pod którymi `importer` bierze od `target` eksporty niosące odwołanie;
 * `"all"`, gdy nie da się tego zawęzić (import domyślny, przestrzeń nazw, `import()`,
 * `export * from`, import z efektem ubocznym). Pusty zbiór = nie bierze nic z rodziny.
 */
function takenNames(
  importer: string,
  target: string,
  carrying: Set<string> | "all",
): Set<string> | "all" {
  const out = new Set<string>();
  for (const stmt of sourceFile(importer).statements) {
    if (
      !(ts.isImportDeclaration(stmt) || ts.isExportDeclaration(stmt)) ||
      !stmt.moduleSpecifier ||
      !ts.isStringLiteral(stmt.moduleSpecifier) ||
      !resolvesTo(importer, stmt.moduleSpecifier.text, target)
    )
      continue;
    if (ts.isExportDeclaration(stmt)) {
      if (stmt.isTypeOnly) continue;
      if (!stmt.exportClause || !ts.isNamedExports(stmt.exportClause)) return "all";
      for (const el of stmt.exportClause.elements)
        if (
          !el.isTypeOnly &&
          (carrying === "all" || carrying.has((el.propertyName ?? el.name).text))
        )
          return "all"; // reeksport niesie dalej - importujący reeksporter to też "wszystko"
      continue;
    }
    const clause = stmt.importClause;
    if (!clause) return "all";
    if (clause.isTypeOnly) continue;
    if (clause.name) return "all";
    const bindings = clause.namedBindings;
    if (!bindings || ts.isNamespaceImport(bindings)) return "all";
    for (const el of bindings.elements) {
      if (el.isTypeOnly) continue;
      if (carrying === "all" || carrying.has((el.propertyName ?? el.name).text))
        out.add(el.name.text);
    }
  }
  if (EDGES.some((e) => e.from === importer && e.to === target && e.dynamic)) return "all";
  return out;
}

/**
 * Ścieżka importu od modułu z odwołaniem do pierwszego niepokrytego modułu (pusta tablica =
 * pokryty). `seeds` to lokalne nazwy niosące odwołanie z modułu niżej (`"all"` = cały moduł).
 */
function uncoveredChain(
  file: string,
  seeds: Set<string> | "all" = new Set(),
  stack: readonly string[] = [],
): string[] {
  if (rendersLink(file)) return [];
  if (isAdminRoute(file) && ADMIN_LINKS_SHEET) return [];
  if (stack.includes(file)) return []; // cykl - rozstrzyga reszta ścieżki
  const carrying = seeds === "all" ? "all" : carryingExports(file, seeds);
  if (carrying !== "all" && carrying.size === 0 && familyNodes(file).length === 0) return [];
  const importers = [...(IMPORTERS.get(file) ?? [])];
  const takers = importers
    .map((importer) => [importer, takenNames(importer, file, carrying)] as const)
    .filter(([, taken]) => taken === "all" || taken.size > 0);
  if (takers.length === 0) {
    // Nikt nie bierze eksportu z odwołaniem: moduł sam coś maluje (komponent, trasa)
    // albo jest martwy - w obu przypadkach to on musi renderować link.
    return carrying === "all" || carrying.size > 0 || importers.length === 0
      ? [...stack, file]
      : [];
  }
  for (const [importer, taken] of takers) {
    const chain = uncoveredChain(importer, taken, [...stack, file]);
    if (chain.length > 0) return chain;
  }
  return [];
}

describe("arkusz wykresów: granica z arkuszem głównym", () => {
  it("składa się z reguł silnika, mapy, tokenów i features - w tej kolejności", () => {
    expect(SHEET_PARTS).toEqual([
      "src/components/charts/charts.css",
      "src/components/charts/map.css",
      "src/components/charts/chart-tokens.css",
      "src/components/features/features.css",
    ]);
    for (const part of SHEET_PARTS) expect(existsSync(join(ROOT, part)), part).toBe(true);
  });

  it("nie ma `@layer` (stoi za arkuszem głównym - warstwa przestawiłaby kolejność warstw)", () => {
    for (const part of [CHART_SHEET, ...SHEET_PARTS]) {
      const code = read(part).replace(/\/\*[\s\S]*?\*\//g, "");
      expect(code, part).not.toMatch(/@layer\b/);
    }
  });

  it("arkusz główny nie deklaruje `--chart-*` i nie importuje części arkusza wykresów", () => {
    const code = read(ROOT_SHEET).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/--chart-[\w-]+\s*:/);
    for (const part of SHEET_PARTS) {
      const name = part.split("/").pop()!;
      expect(code, name).not.toMatch(new RegExp(`@import[^;]*${escape(name)}`));
    }
  });

  it("arkusz główny nie ma reguły na klasie rodziny", () => {
    expect(FAMILY_CLASSES).toContain("neh-chart");
    expect(FAMILY_CLASSES).toContain("nes-sankey-band");
    const rootClasses = selectorClasses(read(ROOT_SHEET));
    expect(FAMILY_CLASSES.filter((name) => rootClasses.has(name))).toEqual([]);
  });

  it("tokeny obu motywów stoją w arkuszu wykresów", () => {
    const tokens = read("src/components/charts/chart-tokens.css");
    expect(tokens).toMatch(/:root,\s*\.light\s*\{[\s\S]*--chart-1:/);
    expect(tokens).toMatch(/\.dark\s*\{[\s\S]*--chart-1:/);
  });

  it("`color-mix()` w deklaracji tylko z zamiennikiem w `@supports` (arkusz nie idzie przez Tailwinda)", () => {
    // W arkuszu głównym kompilator Tailwinda dokładał do każdej takiej deklaracji kolor bez
    // mieszania dla przeglądarek bez `color-mix()`. Arkusz wykresów tego kroku nie ma, więc
    // mieszanka poza `@supports (color: color-mix(...))` znaczyłaby brak koloru w bazie
    // przeglądarek (Chrome 107, Safari 16.0, Firefox 104). Własności niestandardowe
    // (`--x: color-mix(...)`) Tailwind też zostawiał bez zamiennika.
    const naked: string[] = [];
    const guarded: string[] = [];
    for (const part of SHEET_PARTS) {
      for (const rule of parseCssRules(read(part))) {
        const inSupports = rule.context.some((c) => /^@supports \(color: ?color-mix\(/.test(c));
        for (const [name, value] of rule.declarations) {
          if (name.startsWith("--") || !value.includes("color-mix(")) continue;
          (inSupports ? guarded : naked).push(`${part}: ${rule.selectors.join(", ")} { ${name} }`);
        }
      }
    }
    expect(naked).toEqual([]);
    expect(guarded.length).toBeGreaterThan(0);
  });
});

describe("arkusz wykresów: każdy moduł, który nim maluje, go ładuje", () => {
  it("komponent linku: `?url` arkusza wykresów i `precedence` grupy arkusza głównego", () => {
    const source = SOURCE.get(STYLESHEET_COMPONENT) ?? "";
    expect(source).toMatch(/import (\w+) from "\.\/chart-sheet\.css\?url"/);
    expect(source).toMatch(/<link rel="stylesheet" href=\{\w+\} precedence="default" \/>/);
  });

  it("układ `/admin` linkuje arkusz wykresów w `head()`", () => {
    expect(ADMIN_LINKS_SHEET).toBe(true);
  });

  it("znajduje użytkowników rodziny (sito nie jest puste)", () => {
    expect(USERS).toContain("src/components/charts/ChartFrame.tsx");
    expect(USERS).toContain("src/components/features/SankeyDiagram.tsx");
    expect(USERS).toContain("src/lib/charts/seriesStyle.ts");
    expect(USERS.length).toBeGreaterThan(30);
  });

  it("każdy moduł z odwołaniem jest pokryty linkiem", () => {
    const uncovered = USERS.map((file) => uncoveredChain(file))
      .filter((chain) => chain.length > 0)
      .map((chain) => chain.join(" <- "));
    expect(uncovered).toEqual([]);
  });

  it("kontrola negatywna: odwołanie bez linku i bez importera zostałoby wykryte", () => {
    const fake = "src/__chart_sheet_fake__.tsx";
    SOURCE.set(fake, 'export const X = () => <i style={{ color: "var(--chart-1)" }} />;\n');
    try {
      expect(familyNodes(fake).length).toBe(1);
      expect(uncoveredChain(fake)).toEqual([fake]);
    } finally {
      SOURCE.delete(fake);
      parsed.delete(fake);
    }
  });

  it("kontrola negatywna: odwołanie w komentarzu się nie liczy", () => {
    const fake = "src/__chart_sheet_comment__.ts";
    SOURCE.set(fake, "// var(--chart-1) i .neh-chart tylko w komentarzu\nexport const Y = 1;\n");
    try {
      expect(familyNodes(fake)).toEqual([]);
    } finally {
      SOURCE.delete(fake);
      parsed.delete(fake);
    }
  });
});
