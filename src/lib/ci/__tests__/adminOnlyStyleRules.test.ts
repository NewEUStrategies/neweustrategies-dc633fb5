// @vitest-environment node
//
// REGUŁY WYŁĄCZNIE PANELOWE ŻYJĄ W ARKUSZU PANELU (roadmapa ładowania §9.3, S4).
//
// `src/styles.css` blokuje render KAŻDEJ strony publicznej, więc reguły, których
// selektory pasują tylko do markupu panelu, stoją w `src/admin-styles.css`
// (linkuje go wyłącznie trasa `/admin`, `head().links`). Przeniesienie jest
// bezpieczne tylko dopóty, dopóki klasy tych reguł emituje wyłącznie kod panelu
// renderowany pod `/admin`. Gdyby klasę zaczął stawiać komponent publiczny albo
// trasa spoza `/admin` (np. `admin_.preview`, która arkusza panelu NIE ładuje),
// element zostałby bez stylów. Ten test pilnuje dla każdej przeniesionej rodziny:
//   1. arkusz panelu ma JEJ reguły: samodzielny selektor rodziny na najwyższym
//      poziomie arkusza z przeniesionymi deklaracjami (parser CSS, nie regex -
//      inaczej wystarczyłaby dowolna wzmianka klasy, np. wcześniejsza reguła
//      `.block-canvas :is(.cms-h1, ...) p { margin: 0 }`, a blok rozmiarów mógłby
//      zniknąć niezauważony);
//   2. emitery klasy (także budowanej dynamicznie: `cms-h${level}`, `"cms-h" + n`)
//      leżą wyłącznie w kodzie panelu;
//   3. każde wejście, z którego (przechodnio, także przez `import()`) da się dojść
//      do emitera, jest trasą pod `/admin` - czyli dostaje arkusz. Wejściem jest
//      plik trasy, moduł ładowany przez framework na każdej trasie (`router.tsx`,
//      `start.ts`, `server.ts`) i każdy plik bez importerów.
//
// Granica: kod źródłowy. Klas zapisanych w treści CMS (HTML w bazie) test nie widzi.
//
// i18n: brak treści dla użytkownika - inwariant CI.
import { readFileSync, readdirSync } from "node:fs";
// postcss nie jest bezpośrednią zależnością repo - Vite 8 ciągnie go przechodnio
// (`vite` -> `postcss ^8.5`), tak jak lightningcss w `viteChunkParity.test.ts`.
import { parse, type Declaration, type Rule } from "postcss";
import { describe, expect, it } from "vitest";
import { buildImportGraph } from "../moduleImportGraph";

/** Reguła, którą przeniesiony blok daje w arkuszu panelu. */
interface RequiredRule {
  /** Selektor złożony z listy selektorów reguły (po normalizacji białych znaków). */
  readonly selector: string;
  /** Własność -> wzorzec wartości OBOWIĄZUJĄCEJ dla selektora w arkuszu panelu. */
  readonly declarations: Readonly<Record<string, RegExp>>;
}

interface AdminOnlyFamily {
  /** Nazwa rodziny w komunikatach. */
  readonly name: string;
  /** Reguły przeniesione z `styles.css` (S4, commit e470cc07), które markup panelu wykorzystuje. */
  readonly sheetRules: readonly RequiredRule[];
  /** Wystąpienie klasy w źródle TS/TSX - także fragment do sklejenia. */
  readonly emitted: RegExp;
}

/** `var(--token, …)` / `var(--token)`: pilnujemy tokenu, nie wartości zapasowej. */
const tokenVar = (token: string): RegExp => new RegExp(`^var\\(${token}(?=[\\s,)])`);

/**
 * Edytor bloku nagłówka (TipTap: `.cms-hN > .ProseMirror > p`) - akapit i kontener biorą
 * te same globalne tokeny `--fs/--lh/--ls/--fw/--tt-hN` co strona publiczna (AGENTS.md:
 * kanwa buildera pokazuje wpisane wartości).
 */
function headingRules(level: number): RequiredRule[] {
  const declarations = {
    "font-size": tokenVar(`--fs-h${level}`),
    "line-height": tokenVar(`--lh-h${level}`),
    "letter-spacing": tokenVar(`--ls-h${level}`),
    "font-weight": tokenVar(`--fw-h${level}`),
    "text-transform": tokenVar(`--tt-h${level}`),
  };
  return [
    `:is(.block-canvas, [data-builder-renderer]) .cms-h${level} p`,
    `.cms-h${level}`,
    `[data-builder-renderer] .cms-h${level}`,
  ].map((selector) => ({ selector, declarations }));
}

/**
 * Podgląd sekcji „Social" (`SocialSection`: `.cms-social > button.cms-social__btn > svg`).
 * Formy `.cms-social a` przeniesiono razem z blokiem, ale markup ich nie używa.
 */
const SOCIAL_RULES: readonly RequiredRule[] = [
  {
    selector: ".cms-social",
    declarations: {
      display: /^inline-flex$/,
      "align-items": /^center$/,
      gap: tokenVar("--td-si-gap"),
    },
  },
  {
    selector: ".cms-social__btn",
    declarations: {
      display: /^inline-flex$/,
      "align-items": /^center$/,
      "justify-content": /^center$/,
      color: tokenVar("--td-si-color"),
      background: tokenVar("--td-si-bg"),
      "border-radius": tokenVar("--td-si-radius"),
      padding: /^var\(--td-si-py(?=[\s,)])[^)]*\)\s+var\(--td-si-px(?=[\s,)])[^)]*\)$/,
    },
  },
  {
    selector: ".cms-social__btn svg",
    declarations: { width: tokenVar("--td-si-size"), height: tokenVar("--td-si-size") },
  },
  {
    selector: ".cms-social__btn:hover",
    declarations: {
      color: tokenVar("--td-si-hover-color"),
      background: tokenVar("--td-si-hover-bg"),
    },
  },
];

const FAMILIES: readonly AdminOnlyFamily[] = [
  {
    name: "cms-social / cms-social__btn (podgląd ikon społecznościowych w Theme Design)",
    sheetRules: SOCIAL_RULES,
    // `cms-social-list` to inna, publiczna rodzina (normalizeRichHtmlRules) - nie pasuje.
    emitted: /(?<![\w-])cms-social(?:__btn|__)?(?=["'`\s}]|\$\{)/,
  },
  {
    name: "cms-h1...cms-h5 (edytor bloku nagłówka)",
    sheetRules: [1, 2, 3, 4, 5].flatMap(headingRules),
    // Pełna klasa, interpolacja `cms-h${level}` albo prefiks do konkatenacji `"cms-h" + n`.
    emitted: /(?<![\w-])cms-h(?:[1-6](?![\w-])|\$\{|["'`])/,
  },
];

const normalizeSelector = (selector: string): string =>
  selector
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\(\s/g, "(")
    .replace(/\s\)/g, ")")
    .trim();

/**
 * Braki względem wymaganych reguł, jako `selektor { własność: wartość | (brak) }`.
 *
 * Liczą się tylko reguły NAJWYŻSZEGO poziomu arkusza (w `@media`/`@supports` reguła
 * działałaby warunkowo, w `@layer` przegrywałaby z regułami bez warstwy), których LISTA
 * selektorów zawiera wymagany selektor dokładnie - nie wystarczy wzmianka klasy w innym
 * selektorze. Wartość obowiązująca: ostatnia deklaracja w kolejności źródła, chyba że
 * wcześniejsza ma `!important`, a późniejsza nie - więc późniejsze nadpisanie tego
 * samego selektora w arkuszu panelu też jest brakiem.
 */
function missingDeclarations(css: string, required: readonly RequiredRule[]): string[] {
  const rules = parse(css).nodes.filter((node): node is Rule => node.type === "rule");
  const missing: string[] = [];
  for (const { selector, declarations } of required) {
    const effective = new Map<string, Declaration>();
    for (const rule of rules) {
      if (!rule.selectors.map(normalizeSelector).includes(selector)) continue;
      rule.each((child) => {
        if (child.type !== "decl") return;
        if (effective.get(child.prop)?.important && !child.important) return;
        effective.set(child.prop, child);
      });
    }
    for (const [prop, pattern] of Object.entries(declarations)) {
      const value = effective.get(prop)?.value;
      if (value === undefined || !pattern.test(value)) {
        missing.push(`${selector} { ${prop}: ${value ?? "(brak)"} }`);
      }
    }
  }
  return missing;
}

/**
 * Moduły ładowane przez framework na KAŻDEJ trasie, także publicznej: router (domyślne
 * komponenty pending/error/notFound), wejście Start i wejście serwera.
 */
const PUBLIC_ROOTS: ReadonlySet<string> = new Set([
  "src/router.tsx",
  "src/start.ts",
  "src/server.ts",
]);

/**
 * Wejścia, z których przez odwrotny graf importów da się dojść do plików `targets`:
 * pliki tras, korzenie publiczne i każdy plik bez importerów - nieznane wejście (np.
 * moduł podpięty konfiguracją frameworka) liczy się jak publiczne, zamiast znikać
 * z wyniku. Przejście nie zatrzymuje się na trasie ani korzeniu, więc trasa
 * importowana przez inny moduł też prowadzi dalej, do jego wejść.
 */
function entriesReaching(
  targets: readonly string[],
  importers: ReadonlyMap<string, readonly string[]>,
): string[] {
  const seen = new Set(targets);
  const queue = [...targets];
  const entries = new Set<string>();
  while (queue.length > 0) {
    const file = queue.shift() as string;
    const fileImporters = importers.get(file) ?? [];
    if (file.startsWith("src/routes/") || PUBLIC_ROOTS.has(file) || fileImporters.length === 0) {
      entries.add(file);
    }
    for (const importer of fileImporters) {
      if (seen.has(importer)) continue;
      seen.add(importer);
      queue.push(importer);
    }
  }
  return [...entries].sort();
}

const PRODUCTION_SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const NOT_PRODUCTION = /(^|\/)(__tests__|test)\/|\.(test|spec|stories)\.|\.d\.ts$/;

function productionFiles(): string[] {
  return (
    (readdirSync("src", { recursive: true }) as string[])
      .map((entry) => `src/${entry.split("\\").join("/")}`)
      .filter((path) => PRODUCTION_SOURCE.test(path) && !NOT_PRODUCTION.test(path))
      // Wygenerowane drzewo importuje KAŻDĄ trasę, a samo jest importowane przez
      // `router.tsx` - z nim każda trasa prowadziłaby do korzenia publicznego. Bez niego
      // plik trasy jest wejściem swojej strony.
      .filter((path) => path !== "src/routeTree.gen.ts")
      .sort()
  );
}

/** Kod panelu: komponenty, moduły i trasy pod `/admin` (pierwszy segment dokładnie `admin`). */
const isAdminCode = (path: string): boolean =>
  /^src\/(components\/admin\/|lib\/admin\/|routes\/admin(\.|\/))/.test(path);

/** Plik trasy pod `/admin`: pierwszy segment to dokładnie `admin` (nie `admin_`). */
const isAdminRouteFile = (path: string): boolean => /^src\/routes\/admin(\.|\/)/.test(path);

describe("reguły wyłącznie panelowe (S4) pasują tylko do markupu tras /admin", () => {
  const files = productionFiles();
  const source = new Map(files.map((path) => [path, readFileSync(path, "utf8")]));
  const adminSheet = readFileSync("src/admin-styles.css", "utf8");

  /** Odwrotny graf importów wartości (statycznych i `import()`). */
  const importers = new Map<string, string[]>();
  for (const edge of buildImportGraph(files, (path) => source.get(path) as string)) {
    const list = importers.get(edge.to) ?? [];
    list.push(edge.from);
    importers.set(edge.to, list);
  }

  const emittersOf = (family: AdminOnlyFamily): string[] =>
    files.filter((path) => family.emitted.test(source.get(path) as string));

  it.each(FAMILIES)("$name: arkusz panelu ma przeniesione reguły rodziny", (family) => {
    expect(missingDeclarations(adminSheet, family.sheetRules)).toEqual([]);
  });

  it.each(FAMILIES)("$name: klasę emituje wyłącznie kod panelu", (family) => {
    const emitters = emittersOf(family);
    // Zero emiterów znaczyłoby, że wzorzec rozjechał się z kodem - strażnik nic by nie sprawdzał.
    expect(emitters.length).toBeGreaterThan(0);
    expect(emitters.filter((path) => !isAdminCode(path))).toEqual([]);
  });

  it.each(FAMILIES)("$name: każde wejście prowadzące do emitera to trasa /admin", (family) => {
    const entries = entriesReaching(emittersOf(family), importers);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.filter((path) => !isAdminRouteFile(path))).toEqual([]);
  });

  it("trasa /admin linkuje arkusz panelu", () => {
    expect(source.get("src/routes/admin.tsx")).toMatch(
      /import adminCss from "@\/admin-styles\.css\?url"[\s\S]*rel: "stylesheet", href: adminCss/,
    );
  });

  it("kontrola negatywna: wzorce łapią klasy dynamiczne i pomijają rodziny publiczne", () => {
    const [social, heading] = FAMILIES;
    expect(heading.emitted.test("className={`cms-h${level} relative`}")).toBe(true);
    expect(heading.emitted.test('const c = "cms-h" + level;')).toBe(true);
    expect(heading.emitted.test('<div className="cms-h2">')).toBe(true);
    expect(heading.emitted.test('<div className="cms-hero">')).toBe(false);
    expect(social.emitted.test('<div className="cms-social">')).toBe(true);
    expect(social.emitted.test('<button className="cms-social__btn" />')).toBe(true);
    expect(social.emitted.test("`cms-social__${variant}`")).toBe(true);
    expect(social.emitted.test('<ul class="cms-social-list">')).toBe(false);
    expect(isAdminRouteFile("src/routes/admin_.preview.tsx")).toBe(false);
    expect(isAdminRouteFile("src/routes/admin.posts.tsx")).toBe(true);
    expect(isAdminCode("src/components/blocks/renderer/atoms.tsx")).toBe(false);
  });

  it("kontrola negatywna: regułę rodziny daje tylko jej selektor z deklaracjami, bez warunku", () => {
    const h1 = headingRules(1);
    const intact = `
      :is(.block-canvas, [data-builder-renderer]) .cms-h1 p,
      .cms-h1,
      [data-builder-renderer] .cms-h1 {
        font-size: var(--fs-h1, 2.5rem);
        line-height: var(--lh-h1, 1.15);
        letter-spacing: var(--ls-h1, -0.5px);
        font-weight: var(--fw-h1, 800);
        text-transform: var(--tt-h1, none);
      }`;
    expect(missingDeclarations(intact, h1)).toEqual([]);
    // Wzmianka klasy w innym selektorze (reguła `margin: 0` arkusza panelu) nie zastępuje bloku.
    const mentionOnly = ".block-canvas :is(.cms-h1, .cms-h2) p { margin: 0; }";
    expect(missingDeclarations(mentionOnly, h1)).toHaveLength(15);
    // Blok w `@media` / `@layer` działa warunkowo albo przegrywa kaskadę.
    expect(missingDeclarations(`@media (min-width: 1px) { ${intact} }`, h1)).toHaveLength(15);
    expect(missingDeclarations(`@layer components { ${intact} }`, h1)).toHaveLength(15);
    // Inny token i późniejsze nadpisanie tego samego selektora to braki.
    expect(missingDeclarations(intact.replace("--fs-h1", "--fs-h2"), h1)).toEqual([
      ":is(.block-canvas, [data-builder-renderer]) .cms-h1 p { font-size: var(--fs-h2, 2.5rem) }",
      ".cms-h1 { font-size: var(--fs-h2, 2.5rem) }",
      "[data-builder-renderer] .cms-h1 { font-size: var(--fs-h2, 2.5rem) }",
    ]);
    expect(missingDeclarations(`${intact} .cms-h1 { font-size: 12px; }`, h1)).toEqual([
      ".cms-h1 { font-size: 12px }",
    ]);
    // ...chyba że wcześniejsza deklaracja ma `!important`, a późniejsza nie.
    const important = intact.replace("2.5rem);", "2.5rem) !important;");
    expect(missingDeclarations(`${important} .cms-h1 { font-size: 12px; }`, h1)).toEqual([]);
    // Token z dłuższą nazwą (`--fs-h10`) nie udaje `--fs-h1`.
    expect(missingDeclarations(intact.replace("--fs-h1,", "--fs-h10,"), h1)).toHaveLength(3);
  });

  it("kontrola negatywna: wejściem jest trasa, korzeń publiczny i plik bez importerów", () => {
    const emitter = "src/components/admin/blocks/edit/Heading.tsx";
    const graph = new Map<string, string[]>([
      [emitter, ["src/components/admin/blocks/BlockEditor.tsx", "src/router.tsx"]],
      ["src/components/admin/blocks/BlockEditor.tsx", ["src/routes/admin.posts.$slug.tsx"]],
      // Korzeń publiczny liczy się także wtedy, gdy sam ma importera.
      ["src/router.tsx", ["src/start.ts"]],
    ]);
    expect(entriesReaching([emitter], graph)).toEqual([
      "src/router.tsx",
      "src/routes/admin.posts.$slug.tsx",
      "src/start.ts",
    ]);
    // Moduł spoza `src/routes/` bez importerów nie znika z wyniku.
    const orphan = new Map([[emitter, ["src/lib/orphanShell.tsx"]]]);
    expect(entriesReaching([emitter], orphan)).toEqual(["src/lib/orphanShell.tsx"]);
    // Trasa importowana przez inny moduł prowadzi dalej, do jego wejść.
    const routeImported = new Map([
      [emitter, ["src/routes/admin.posts.tsx"]],
      ["src/routes/admin.posts.tsx", ["src/lib/publicShell.tsx"]],
    ]);
    expect(entriesReaching([emitter], routeImported)).toEqual([
      "src/lib/publicShell.tsx",
      "src/routes/admin.posts.tsx",
    ]);
    expect(isAdminRouteFile("src/router.tsx")).toBe(false);
  });
});
