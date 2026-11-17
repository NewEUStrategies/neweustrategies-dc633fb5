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
//      zniknąć niezauważony), nienadpisanymi później ani tą samą własnością, ani
//      skrótem (`font`), ani częścią (`padding-inline`, `background-color`);
//   2. emitery klasy (także budowanej dynamicznie: `cms-h${level}`, `"cms-h" + n`)
//      leżą wyłącznie w kodzie panelu;
//   3. każde wejście, z którego (przechodnio, także przez `import()`) da się dojść
//      do emitera, jest trasą pod `/admin` - czyli dostaje arkusz. Wejściem jest
//      plik trasy, moduł ładowany przez framework na każdej trasie (`router.tsx`,
//      `start.ts`, `server.ts`) i każdy plik albo cykl importów bez importera z zewnątrz.
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

/** Wzorzec wartości deklaracji: wyrażenie regularne albo dopasowanie składniowe (`tokenVars`). */
interface ValuePattern {
  test(value: string): boolean;
}

/** Reguła, którą przeniesiony blok daje w arkuszu panelu. */
interface RequiredRule {
  /** Selektor złożony z listy selektorów reguły (po normalizacji białych znaków). */
  readonly selector: string;
  /** Własność -> wzorzec wartości OBOWIĄZUJĄCEJ dla selektora w arkuszu panelu. */
  readonly declarations: Readonly<Record<string, ValuePattern>>;
}

interface AdminOnlyFamily {
  /** Nazwa rodziny w komunikatach. */
  readonly name: string;
  /** Reguły przeniesione z `styles.css` (S4, commit e470cc07), które markup panelu wykorzystuje. */
  readonly sheetRules: readonly RequiredRule[];
  /** Wystąpienie klasy w źródle TS/TSX - także fragment do sklejenia. */
  readonly emitted: RegExp;
}

/** Indeks nawiasu zamykającego ten otwarty na pozycji `open` (z pominięciem napisów) albo -1. */
function closingParen(value: string, open: number): number {
  let depth = 0;
  for (let i = open; i < value.length; i += 1) {
    const char = value[i];
    if (char === "\\") {
      i += 1;
    } else if (char === '"' || char === "'") {
      i += 1;
      while (i < value.length && value[i] !== char) i += value[i] === "\\" ? 2 : 1;
    } else if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Cała wartość to ciąg `var(--token)` / `var(--token, zapas)` dla kolejnych tokenów,
 * rozdzielonych białymi znakami - i nic poza nim. Pilnujemy tokenu, nie wartości zapasowej
 * (dowolnej, także z zagnieżdżonym `var()`/`calc()`, byle nawiasy się domykały); doklejony
 * składnik (`var(--fs-h3, 1.625rem) 12px`) albo inny token to niezgodność.
 */
const tokenVars = (...tokens: readonly string[]): ValuePattern => ({
  test(value) {
    let rest = value.trim();
    for (const [position, token] of tokens.entries()) {
      if (position > 0) {
        if (!/^\s/.test(rest)) return false;
        rest = rest.trimStart();
      }
      if (/^var\(\s*(--[\w-]+)\s*(?=[,)])/i.exec(rest)?.[1] !== token) return false;
      const end = closingParen(rest, "var".length);
      if (end < 0) return false;
      rest = rest.slice(end + 1);
    }
    return rest === "";
  },
});

const tokenVar = (token: string): ValuePattern => tokenVars(token);

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
      padding: tokenVars("--td-si-py", "--td-si-px"),
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
 * Skrót -> własności, które ustawia (podskróty rozwijane dalej; aliasy dawnych nazw jako
 * skrót jednej własności). Tylko skróty dotykające przypinanych własności lub ich części.
 */
const SHORTHAND_PARTS: Readonly<Record<string, readonly string[]>> = {
  font: [
    "font-style",
    "font-variant",
    "font-weight",
    "font-stretch",
    "font-size",
    "line-height",
    "font-family",
  ],
  "place-items": ["align-items", "justify-items"],
  "place-content": ["align-content", "justify-content"],
  gap: ["row-gap", "column-gap"],
  "grid-gap": ["row-gap", "column-gap"],
  "grid-row-gap": ["row-gap"],
  "grid-column-gap": ["column-gap"],
  background: [
    "background-color",
    "background-image",
    "background-position",
    "background-size",
    "background-repeat",
    "background-attachment",
    "background-origin",
    "background-clip",
  ],
  "background-position": ["background-position-x", "background-position-y"],
  "border-radius": [
    "border-top-left-radius",
    "border-top-right-radius",
    "border-bottom-right-radius",
    "border-bottom-left-radius",
  ],
  padding: ["padding-top", "padding-right", "padding-bottom", "padding-left"],
  "padding-block": ["padding-block-start", "padding-block-end"],
  "padding-inline": ["padding-inline-start", "padding-inline-end"],
};

/**
 * Grupy własności logicznych i fizycznych, które kaskadują razem: późniejsza logiczna
 * nadpisuje wcześniejszą fizyczną i odwrotnie. Tryb pisania nie jest znany, więc każda
 * logiczna koliduje z każdą fizyczną swojej grupy (`inline-size` z `width` i `height`).
 */
const LOGICAL_GROUPS: readonly { physical: readonly string[]; logical: readonly string[] }[] = [
  {
    physical: SHORTHAND_PARTS.padding,
    logical: [...SHORTHAND_PARTS["padding-block"], ...SHORTHAND_PARTS["padding-inline"]],
  },
  {
    physical: SHORTHAND_PARTS["border-radius"],
    logical: [
      "border-start-start-radius",
      "border-start-end-radius",
      "border-end-start-radius",
      "border-end-end-radius",
    ],
  },
  { physical: ["width", "height"], logical: ["inline-size", "block-size"] },
];

/** Własności niepodzielne, które ustawia deklaracja `prop` (rozwinięcie skrótów). */
function longhands(prop: string): string[] {
  const parts = SHORTHAND_PARTS[prop];
  return parts ? parts.flatMap(longhands) : [prop];
}

const collide = (a: string, b: string): boolean =>
  a === b ||
  LOGICAL_GROUPS.some(
    ({ physical, logical }) =>
      (physical.includes(a) && logical.includes(b)) ||
      (logical.includes(a) && physical.includes(b)),
  );

/**
 * Czy deklaracja `later` nadpisuje (w całości albo w części) wartość przypiętej własności
 * `pinned`: ta sama własność, skrót, który ją obejmuje (`font` -> `font-size`), jej część
 * fizyczna lub logiczna (`padding-inline` -> `padding`, `background-color` -> `background`)
 * albo `all`.
 */
const overrides = (later: string, pinned: string): boolean =>
  later === "all" ||
  longhands(later).some((part) => longhands(pinned).some((own) => collide(part, own)));

/**
 * Braki względem wymaganych reguł, jako `selektor { własność: wartość | (brak) }` albo
 * `selektor { własność nadpisana przez inna: wartość }`.
 *
 * Liczą się tylko reguły NAJWYŻSZEGO poziomu arkusza (w `@media`/`@supports` reguła
 * działałaby warunkowo, w `@layer` przegrywałaby z regułami bez warstwy), których LISTA
 * selektorów zawiera wymagany selektor dokładnie - nie wystarczy wzmianka klasy w innym
 * selektorze. Wartość obowiązująca: ostatnia deklaracja w kolejności źródła, która tę
 * własność ustawia (ona sama, obejmujący ją skrót, jej część fizyczna lub logiczna, `all`),
 * chyba że wcześniejsza ma `!important`, a późniejsza nie. Późniejsze nadpisanie tego samego
 * selektora w arkuszu panelu - także skrótem albo częścią - jest więc brakiem.
 */
function missingDeclarations(css: string, required: readonly RequiredRule[]): string[] {
  const rules = parse(css).nodes.filter((node): node is Rule => node.type === "rule");
  const missing: string[] = [];
  for (const { selector, declarations } of required) {
    const pinned = Object.keys(declarations);
    const effective = new Map<string, Declaration>();
    for (const rule of rules) {
      if (!rule.selectors.map(normalizeSelector).includes(selector)) continue;
      rule.each((child) => {
        if (child.type !== "decl") return;
        // Nazwy własności CSS nie rozróżniają wielkości liter (custom properties - tak).
        const prop = child.prop.startsWith("--") ? child.prop : child.prop.toLowerCase();
        for (const own of pinned) {
          if (!overrides(prop, own)) continue;
          if (effective.get(own)?.important && !child.important) continue;
          effective.set(own, child);
        }
      });
    }
    for (const [prop, pattern] of Object.entries(declarations)) {
      const winner = effective.get(prop);
      if (winner === undefined) {
        missing.push(`${selector} { ${prop}: (brak) }`);
      } else if (winner.prop.toLowerCase() !== prop) {
        missing.push(`${selector} { ${prop} nadpisana przez ${winner.prop}: ${winner.value} }`);
      } else if (!pattern.test(winner.value)) {
        missing.push(`${selector} { ${prop}: ${winner.value} }`);
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
 * Silnie spójne składowe grafu (Tarjan, iteracyjnie - bez limitu głębokości stosu wywołań)
 * rozpiętego na `nodes` z krawędziami `next`.
 */
function stronglyConnectedComponents(
  nodes: readonly string[],
  next: (node: string) => readonly string[],
): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];
  const visit = (node: string): void => {
    index.set(node, index.size);
    low.set(node, index.get(node) as number);
    stack.push(node);
    onStack.add(node);
  };
  for (const root of nodes) {
    if (index.has(root)) continue;
    visit(root);
    const frames = [{ node: root, edge: 0 }];
    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      const edges = next(frame.node);
      if (frame.edge < edges.length) {
        const child = edges[frame.edge];
        frame.edge += 1;
        if (!index.has(child)) {
          visit(child);
          frames.push({ node: child, edge: 0 });
        } else if (onStack.has(child)) {
          low.set(frame.node, Math.min(low.get(frame.node) as number, index.get(child) as number));
        }
        continue;
      }
      frames.pop();
      const parent = frames[frames.length - 1];
      if (parent) {
        low.set(
          parent.node,
          Math.min(low.get(parent.node) as number, low.get(frame.node) as number),
        );
      }
      if (low.get(frame.node) !== index.get(frame.node)) continue;
      const component: string[] = [];
      let member: string;
      do {
        member = stack.pop() as string;
        onStack.delete(member);
        component.push(member);
      } while (member !== frame.node);
      components.push(component);
    }
  }
  return components;
}

/**
 * Wejścia, z których przez odwrotny graf importów da się dojść do plików `targets`:
 * pliki tras, korzenie publiczne i nieznane wejścia - nieznane (np. moduł podpięty
 * konfiguracją frameworka) liczy się jak publiczne, zamiast znikać z wyniku. Nieznanym
 * wejściem jest każda osiągnięta silnie spójna składowa bez importera spoza siebie
 * i bez trasy/korzenia w środku: plik bez importerów, ale też martwy cykl importów (każdy
 * jego plik ma importera, więc sama reguła „bez importerów" by go zgubiła). Przejście nie
 * zatrzymuje się na trasie ani korzeniu, więc trasa importowana przez inny moduł też
 * prowadzi dalej, do jego wejść.
 */
function entriesReaching(
  targets: readonly string[],
  importers: ReadonlyMap<string, readonly string[]>,
): string[] {
  const importersOf = (file: string): readonly string[] => importers.get(file) ?? [];
  const isKnownEntry = (file: string): boolean =>
    file.startsWith("src/routes/") || PUBLIC_ROOTS.has(file);
  const reached = new Set(targets);
  const queue = [...targets];
  while (queue.length > 0) {
    for (const importer of importersOf(queue.shift() as string)) {
      if (reached.has(importer)) continue;
      reached.add(importer);
      queue.push(importer);
    }
  }
  const entries = new Set([...reached].filter(isKnownEntry));
  for (const component of stronglyConnectedComponents([...reached], importersOf)) {
    const members = new Set(component);
    const importedFromOutside = component.some((file) =>
      importersOf(file).some((importer) => !members.has(importer)),
    );
    if (importedFromOutside || component.some(isKnownEntry)) continue;
    for (const file of component) entries.add(file);
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

  it("kontrola negatywna: wartość to dokładnie jedno var(--token[, zapas]), nic doklejonego", () => {
    const fontSize = tokenVar("--fs-h3");
    expect(fontSize.test("var(--fs-h3, 1.625rem)")).toBe(true);
    expect(fontSize.test("var( --fs-h3 )")).toBe(true);
    expect(fontSize.test("var(--fs-h3, calc(1rem + var(--x, 2px)))")).toBe(true);
    expect(fontSize.test('var(--fs-h3, ")")')).toBe(true);
    expect(fontSize.test("var(--fs-h3, 1.625rem) 12px")).toBe(false);
    expect(fontSize.test("var(--fs-h3, 1.625rem)12px")).toBe(false);
    expect(fontSize.test("var(--fs-h3, 1)(2)")).toBe(false);
    expect(fontSize.test("var(--fs-h3, (1.625rem)")).toBe(false);
    expect(fontSize.test("calc(var(--fs-h3, 1rem) * 2)")).toBe(false);
    expect(fontSize.test("var(--fs-h30, 1rem)")).toBe(false);
    const padding = tokenVars("--td-si-py", "--td-si-px");
    expect(padding.test("var(--td-si-py, 6px) var(--td-si-px, 6px)")).toBe(true);
    expect(padding.test("var(--td-si-py, 6px)var(--td-si-px, 6px)")).toBe(false);
    expect(padding.test("var(--td-si-py, 6px) var(--td-si-px, 6px) 0")).toBe(false);
    expect(padding.test("var(--td-si-py, 6px)")).toBe(false);
    // Doklejony składnik w arkuszu to brak (mutacja `var(--fs-h1, 2.5rem) 12px`).
    const h1Tail = `.cms-h1 { font-size: var(--fs-h1, 2.5rem) 12px; }`;
    expect(
      missingDeclarations(h1Tail, [
        { selector: ".cms-h1", declarations: { "font-size": tokenVar("--fs-h1") } },
      ]),
    ).toEqual([".cms-h1 { font-size: var(--fs-h1, 2.5rem) 12px }"]);
  });

  it("kontrola negatywna: późniejszy skrót albo część przypiętej własności to brak", () => {
    const h1 = headingRules(1).filter((rule) => rule.selector === ".cms-h1");
    const intact = `.cms-h1 {
        font-size: var(--fs-h1, 2.5rem);
        line-height: var(--lh-h1, 1.15);
        letter-spacing: var(--ls-h1, -0.5px);
        font-weight: var(--fw-h1, 800);
        text-transform: var(--tt-h1, none);
      }`;
    expect(missingDeclarations(intact, h1)).toEqual([]);
    // Skrót `font` obejmuje rozmiar, interlinię i grubość (nie odstępy liter ani transformację).
    expect(missingDeclarations(`${intact} .cms-h1 { font: 400 12px/1 sans-serif; }`, h1)).toEqual([
      ".cms-h1 { font-size nadpisana przez font: 400 12px/1 sans-serif }",
      ".cms-h1 { line-height nadpisana przez font: 400 12px/1 sans-serif }",
      ".cms-h1 { font-weight nadpisana przez font: 400 12px/1 sans-serif }",
    ]);
    // `all` nadpisuje wszystko; nazwa własności bez względu na wielkość liter.
    expect(missingDeclarations(`${intact} .cms-h1 { all: unset; }`, h1)).toHaveLength(5);
    expect(missingDeclarations(`${intact} .cms-h1 { FONT-SIZE: 12px; }`, h1)).toEqual([
      ".cms-h1 { font-size: 12px }",
    ]);
    // Skrót PRZED przypiętą własnością jej nie nadpisuje; `!important` wygrywa z późniejszym skrótem.
    expect(missingDeclarations(`.cms-h1 { font: inherit; } ${intact}`, h1)).toEqual([]);
    const important = intact.replace("2.5rem);", "2.5rem) !important;");
    expect(missingDeclarations(`${important} .cms-h1 { font: 12px serif; }`, h1)).toEqual([
      ".cms-h1 { line-height nadpisana przez font: 12px serif }",
      ".cms-h1 { font-weight nadpisana przez font: 12px serif }",
    ]);
    expect(
      missingDeclarations(`${important} .cms-h1 { font: 12px serif !important; }`, h1),
    ).toHaveLength(3);

    const button = SOCIAL_RULES.filter(({ selector }) => selector.startsWith(".cms-social__btn"));
    const social = `
      .cms-social__btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: var(--td-si-color, var(--foreground));
        background: var(--td-si-bg, transparent);
        border-radius: var(--td-si-radius, 9999px);
        padding: var(--td-si-py, 6px) var(--td-si-px, 6px);
        transition: color 0.15s ease, background-color 0.15s ease;
        border: 0;
      }
      .cms-social__btn svg { width: var(--td-si-size, 18px); height: var(--td-si-size, 18px); }
      .cms-social__btn:hover {
        color: var(--td-si-hover-color, #fa9346);
        background: var(--td-si-hover-bg, transparent);
      }`;
    // `transition`, `border` i `height` po `width` niczego przypiętego nie nadpisują.
    expect(missingDeclarations(social, button)).toEqual([]);
    // Część (logiczna) skrótu: `padding-inline`, `background-color`, róg `border-radius`.
    expect(
      missingDeclarations(
        `${social} .cms-social__btn { padding-inline: 0; background-color: red; border-start-end-radius: 0; }`,
        button,
      ),
    ).toEqual([
      ".cms-social__btn { background nadpisana przez background-color: red }",
      ".cms-social__btn { border-radius nadpisana przez border-start-end-radius: 0 }",
      ".cms-social__btn { padding nadpisana przez padding-inline: 0 }",
    ]);
    expect(missingDeclarations(`${social} .cms-social__btn { padding-top: 0; }`, button)).toEqual([
      ".cms-social__btn { padding nadpisana przez padding-top: 0 }",
    ]);
    expect(
      missingDeclarations(`${social} .cms-social__btn { place-items: start; }`, button),
    ).toEqual([".cms-social__btn { align-items nadpisana przez place-items: start }"]);
    // Logiczny odpowiednik rozmiaru nadpisuje szerokość i wysokość (tryb pisania nieznany).
    expect(
      missingDeclarations(`${social} .cms-social__btn svg { inline-size: 0; }`, button),
    ).toEqual([
      ".cms-social__btn svg { width nadpisana przez inline-size: 0 }",
      ".cms-social__btn svg { height nadpisana przez inline-size: 0 }",
    ]);
    expect(
      missingDeclarations(
        `.cms-social { display: inline-flex; align-items: center; gap: var(--td-si-gap, 8px); row-gap: 0; }`,
        SOCIAL_RULES.slice(0, 1),
      ),
    ).toEqual([".cms-social { gap nadpisana przez row-gap: 0 }"]);
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

  it("kontrola negatywna: martwy cykl importów bez importera z zewnątrz jest wejściem", () => {
    const emitter = "src/components/admin/blocks/edit/Heading.tsx";
    // Dwa pliki importują się nawzajem i nikt spoza nich ich nie importuje: każdy ma
    // importera, a mimo to cykl jest nieznanym wejściem (liczy się jak publiczne).
    const deadCycle = new Map([
      [emitter, ["src/routes/admin.posts.tsx", "src/lib/cycleA.tsx"]],
      ["src/lib/cycleA.tsx", ["src/lib/cycleB.tsx"]],
      ["src/lib/cycleB.tsx", ["src/lib/cycleA.tsx"]],
    ]);
    expect(entriesReaching([emitter], deadCycle)).toEqual([
      "src/lib/cycleA.tsx",
      "src/lib/cycleB.tsx",
      "src/routes/admin.posts.tsx",
    ]);
    // Plik importujący sam siebie to cykl jednoelementowy - też wejście.
    const selfImport = new Map([
      [emitter, ["src/lib/selfLoop.tsx"]],
      ["src/lib/selfLoop.tsx", ["src/lib/selfLoop.tsx"]],
    ]);
    expect(entriesReaching([emitter], selfImport)).toEqual(["src/lib/selfLoop.tsx"]);
    // Cykl importowany z zewnątrz prowadzi do wejść importera, sam wejściem nie jest.
    const importedCycle = new Map([
      ...deadCycle,
      ["src/lib/cycleB.tsx", ["src/lib/cycleA.tsx", "src/routes/admin.tsx"]],
    ]);
    expect(entriesReaching([emitter], importedCycle)).toEqual([
      "src/routes/admin.posts.tsx",
      "src/routes/admin.tsx",
    ]);
    // Cykl z trasą w środku: wejściem jest trasa, nie pozostałe pliki cyklu.
    const routeCycle = new Map([
      [emitter, ["src/lib/cycleA.tsx"]],
      ["src/lib/cycleA.tsx", ["src/routes/admin.posts.tsx"]],
      ["src/routes/admin.posts.tsx", ["src/lib/cycleA.tsx"]],
    ]);
    expect(entriesReaching([emitter], routeCycle)).toEqual(["src/routes/admin.posts.tsx"]);
  });
});
