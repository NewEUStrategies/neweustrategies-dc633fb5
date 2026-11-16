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
//   1. arkusz panelu ma jej reguły;
//   2. emitery klasy (także budowanej dynamicznie: `cms-h${level}`, `"cms-h" + n`)
//      leżą wyłącznie w kodzie panelu;
//   3. każda trasa, która (przechodnio, także przez `import()`) dosięga emitera,
//      leży pod `/admin` - czyli dostaje arkusz.
//
// Granica: kod źródłowy. Klas zapisanych w treści CMS (HTML w bazie) test nie widzi.
//
// i18n: brak treści dla użytkownika - inwariant CI.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildImportGraph } from "../moduleImportGraph";

interface AdminOnlyFamily {
  /** Nazwa rodziny w komunikatach. */
  readonly name: string;
  /** Selektor klasy, który musi mieć regułę w arkuszu panelu. */
  readonly sheetSelector: RegExp;
  /** Wystąpienie klasy w źródle TS/TSX - także fragment do sklejenia. */
  readonly emitted: RegExp;
}

const FAMILIES: readonly AdminOnlyFamily[] = [
  {
    name: "cms-social / cms-social__btn (podgląd ikon społecznościowych w Theme Design)",
    sheetSelector: /\.cms-social__btn\b|\.cms-social(?![\w-])/,
    // `cms-social-list` to inna, publiczna rodzina (normalizeRichHtmlRules) - nie pasuje.
    emitted: /(?<![\w-])cms-social(?:__btn|__)?(?=["'`\s}]|\$\{)/,
  },
  {
    name: "cms-h1...cms-h5 (edytor bloku nagłówka)",
    sheetSelector: /\.cms-h[1-5](?![\w-])/,
    // Pełna klasa, interpolacja `cms-h${level}` albo prefiks do konkatenacji `"cms-h" + n`.
    emitted: /(?<![\w-])cms-h(?:[1-6](?![\w-])|\$\{|["'`])/,
  },
];

const PRODUCTION_SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const NOT_PRODUCTION = /(^|\/)(__tests__|test)\/|\.(test|spec|stories)\.|\.d\.ts$/;

function productionFiles(): string[] {
  return (readdirSync("src", { recursive: true }) as string[])
    .map((entry) => `src/${entry.split("\\").join("/")}`)
    .filter((path) => PRODUCTION_SOURCE.test(path) && !NOT_PRODUCTION.test(path))
    .filter((path) => path !== "src/routeTree.gen.ts")
    .sort();
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

  /** Trasy osiągalne z plików w odwrotnym grafie (przejście zatrzymuje się na pliku trasy). */
  function routesReaching(roots: readonly string[]): string[] {
    const seen = new Set(roots);
    const queue = [...roots];
    const routes = new Set<string>();
    while (queue.length > 0) {
      const file = queue.shift() as string;
      if (file.startsWith("src/routes/")) {
        routes.add(file);
        continue;
      }
      for (const importer of importers.get(file) ?? []) {
        if (seen.has(importer)) continue;
        seen.add(importer);
        queue.push(importer);
      }
    }
    return [...routes].sort();
  }

  const emittersOf = (family: AdminOnlyFamily): string[] =>
    files.filter((path) => family.emitted.test(source.get(path) as string));

  it.each(FAMILIES)("$name: arkusz panelu ma reguły rodziny", (family) => {
    expect(adminSheet).toMatch(family.sheetSelector);
  });

  it.each(FAMILIES)("$name: klasę emituje wyłącznie kod panelu", (family) => {
    const emitters = emittersOf(family);
    // Zero emiterów znaczyłoby, że wzorzec rozjechał się z kodem - strażnik nic by nie sprawdzał.
    expect(emitters.length).toBeGreaterThan(0);
    expect(emitters.filter((path) => !isAdminCode(path))).toEqual([]);
  });

  it.each(FAMILIES)("$name: każda trasa z emiterem leży pod /admin", (family) => {
    const routes = routesReaching(emittersOf(family));
    expect(routes.length).toBeGreaterThan(0);
    expect(routes.filter((path) => !isAdminRouteFile(path))).toEqual([]);
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
});
