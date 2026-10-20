// @vitest-environment node
//
// Grupy `codeSplitting` bundla przeglądarki (scripts/lib/clientChunkGroups.ts) - dwie warstwy
// dowodu, bo żadna z nich nie wystarcza sama.
//
// 1. ZASADA PRIORYTETÓW NA ZAINSTALOWANYCH PAKIETACH. Grupa o wyższym priorytecie wybiera moduły
//    pierwsza i zabiera ich statyczne zależności, więc priorytet grupy musi być WYŻSZY niż
//    priorytet każdej grupy, której moduły ją importują - inaczej grupa połknie cudzy pakiet,
//    a krawędź pobiegnie w drugą stronę (droga do cyklu chunków z 2026-07-20). Ręczna lista
//    zależności starzałaby się po cichu przy każdym bumpie, więc graf bierzemy z `package.json`
//    pakietów w node_modules, a dla grup kodu aplikacji - z ich importów w źródle.
// 2. PRAWDZIWY BUILD Vite 8 na fiksturze o kształcie aplikacji: wejście pod ścieżką, którą łapie
//    test grupy (pułapka 2026-08-06), barrel w kształcie `lucide-react`, CJS-owy React
//    z `use-sync-external-store`, leniwe moduły z przypiętymi nazwami. Tego testy jednostkowe
//    z atrapami grafu (dawny `bootVendorSplit.test.ts`) dać nie mogły: `$initial` liczy Rolldown,
//    a o tym, kto zabiera zależność, decyduje jego algorytm, nie nasz kod.
//
// Granica dowodu: fikstura ma po kilka modułów na pakiet. Skład chunków na pełnym grafie
// aplikacji pokazuje `BUNDLE_INVENTORY=1 bun run build && bun run report:chunk-inventory`,
// a bramki po buildzie (check:chunks, check:entry-purity) pilnują go w CI.
//
// i18n: brak treści dla użytkownika - narzędzie CI.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { build, type Rolldown } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CHUNK_PRIORITY,
  CLIENT_CHUNK_GROUPS,
  clientCodeSplitting,
} from "../../../../scripts/lib/clientChunkGroups";

type Group = Rolldown.CodeSplittingGroup;

const REPO = process.cwd();
const NODE_MODULES = join(REPO, "node_modules");

const nameOf = (group: Group): string => {
  if (!group.debugName) throw new Error("grupa bez debugName");
  return group.debugName;
};

/**
 * Grupa reszty bootu (`app-initial`): `test` łapie KAŻDY moduł, zawęża ją tag `$initial`, a wybiera
 * ostatnia. Nie jest rodziną po ścieżce, więc reguły pakietów niżej jej nie liczą - własny test
 * konstrukcji i build fikstury.
 */
const APP_INITIAL = "app-initial";
const PATH_GROUPS = CLIENT_CHUNK_GROUPS.filter((group) => nameOf(group) !== APP_INITIAL);

function matches(group: Group, id: string): boolean {
  const { test } = group;
  if (test instanceof RegExp) return test.test(id);
  if (typeof test === "function") return test(id) === true;
  throw new Error(`${nameOf(group)}: nieobsługiwany kształt \`test\``);
}

/**
 * RODZINA = grupy o tym samym `test` (część bootowa `$initial` i reszta). Zależność wewnątrz
 * rodziny rozstrzyga `$initial` (domknięcie statyczne), więc reguła priorytetów dotyczy krawędzi
 * MIĘDZY rodzinami: najwyższy priorytet importującej < najniższego priorytetu importowanej.
 */
interface Family {
  readonly names: readonly string[];
  readonly min: number;
  readonly max: number;
}

function familyOf(id: string): Family | undefined {
  const hits = PATH_GROUPS.filter((group) => matches(group, id));
  if (hits.length === 0) return undefined;
  const test = hits[0]!.test;
  const family = PATH_GROUPS.filter((group) => group.test === test);
  expect(
    hits.every((group) => group.test === test),
    `${id} pasuje do grup z RÓŻNYCH rodzin: ${hits.map(nameOf).join(", ")}`,
  ).toBe(true);
  const priorities = family.map((group) => group.priority ?? 0);
  return {
    names: family.map(nameOf),
    min: Math.min(...priorities),
    max: Math.max(...priorities),
  };
}

/** Reprezentatywne id modułu pakietu - testy grup patrzą wyłącznie na ścieżkę. */
const packageModuleId = (pkg: string) => `${NODE_MODULES}/${pkg}/dist/index.mjs`;

/** Zainstalowane pakiety najwyższego poziomu -> zależności runtime (deps + peers). */
function installedPackages(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const read = (name: string) => {
    try {
      const pkg = JSON.parse(readFileSync(join(NODE_MODULES, name, "package.json"), "utf8")) as {
        dependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
      };
      out.set(name, [
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.peerDependencies ?? {}),
      ]);
    } catch {
      // Katalog bez package.json (np. `.bin`, `.cache`) - nie pakiet.
    }
  };
  for (const entry of readdirSync(NODE_MODULES)) {
    if (entry.startsWith(".")) continue;
    if (entry.startsWith("@")) {
      for (const scoped of readdirSync(join(NODE_MODULES, entry))) read(`${entry}/${scoped}`);
    } else {
      read(entry);
    }
  }
  return out;
}

/**
 * Grupy kodu aplikacji NAD `app-initial` -> plik modułu (test grupy musi go łapać - sprawdzane
 * niżej). Moduł takiej grupy może importować wyłącznie vendorów i grupy wyżej.
 */
const APP_GROUP_MODULES: Readonly<Record<string, string>> = {
  "legal-links": "src/components/footer/LegalLinks.tsx",
  "vendor-sonner": "src/components/ui/sonner.tsx",
};

/**
 * Rodziny leniwe POD `app-initial` -> ich pliki. Importują kod bootu (zabrany wcześniej przez
 * `app-initial`), więc reguła importów wyżej ich nie dotyczy - pilnujemy, że każdy plik istnieje
 * i łapie go dokładnie jego grupa (zmiana nazwy pliku cicho wyłączyłaby grupę).
 */
const LAZY_FAMILY_MODULES: Readonly<Record<string, readonly string[]>> = {
  sanitize: ["src/lib/sanitize.ts", "src/lib/sanitizeEngineGuard.ts"],
  "post-content": [
    "src/components/Footnotes.tsx",
    "src/lib/footnotes/navigation.ts",
    "src/lib/content/prepareContent.ts",
    "src/lib/manualToc.ts",
    "src/lib/content/contentEngine.ts",
    "src/lib/builder/headings.ts",
  ],
  conversions: ["src/lib/analytics/conversions.ts"],
  "post-card": [
    "src/components/molecules/PostListCard.tsx",
    "src/components/post/SponsoredBadge.tsx",
    "src/lib/i18n-sponsored.ts",
  ],
  overlay: ["src/lib/overlayCoordinator.ts", "src/components/popups/sinceNavigationStart.ts"],
  "club-thread-kind-icon": ["src/components/clubs/atoms/ClubThreadKindIcon.tsx"],
  "chart-palette": ["src/lib/charts/palette.ts"],
  "dataviz-core": [
    "src/lib/charts/types.ts",
    "src/lib/charts/roles.ts",
    "src/lib/charts/status.ts",
    "src/lib/charts/smooth.ts",
    "src/lib/charts/sources.ts",
    "src/lib/charts/seriesStyle.ts",
    "src/lib/charts/parse.ts",
    "src/hooks/useRevealOnScroll.ts",
  ],
  "share-surface": [
    "src/lib/i18n-share.ts",
    "src/components/atoms/SaveArticleButton.tsx",
    "src/hooks/useSaveArticle.ts",
    "src/hooks/useBookmarks.ts",
    "src/lib/rafThrottle.ts",
  ],
  "archive-grid": [
    "src/components/archive/PaginatedPostGrid.tsx",
    "src/components/archive/layouts/ArchivePagination.tsx",
    "src/components/archive/ArchivePostList.tsx",
    "src/components/ads/useInFeedAds.tsx",
  ],
};

/** Specyfikatory importów WARTOŚCIOWYCH (bez `import type`/`export type`) w źródle modułu. */
function valueImports(source: string): string[] {
  const out: string[] = [];
  const re = /(?:^|[\n;])\s*(import|export)(\s+type\b)?[^;]*?from\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(re)) if (!match[2]) out.push(match[3]!);
  for (const match of source.matchAll(/(?:^|[\n;])\s*import\s*["']([^"']+)["']/g)) {
    out.push(match[1]!);
  }
  return out;
}

/** Id modułu, na który wskazuje specyfikator importu z `file` (dla testów grup). */
function importedId(file: string, specifier: string): string {
  if (specifier.startsWith("@/")) return join(REPO, "src", specifier.slice(2));
  if (specifier.startsWith(".")) return resolve(REPO, dirname(file), specifier);
  const parts = specifier.split("/");
  const pkg = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
  return packageModuleId(pkg);
}

describe("clientChunkGroups - konstrukcja grup", () => {
  it("każda grupa ma unikalną nazwę i priorytet z tabeli, w kolejności priorytetów", () => {
    const names = CLIENT_CHUNK_GROUPS.map(nameOf);
    expect(new Set(names).size).toBe(names.length);
    const allowed = new Set<number>(Object.values(CHUNK_PRIORITY));
    const priorities = CLIENT_CHUNK_GROUPS.map((group) => group.priority);
    for (const [i, priority] of priorities.entries()) {
      expect(allowed.has(priority ?? Number.NaN), names[i]).toBe(true);
      if (i > 0) expect(priority!, names[i]).toBeLessThanOrEqual(priorities[i - 1]!);
    }
  });

  it("`name` każdej grupy wyjmuje moduł WEJŚCIOWY (pułapka zapadania się grupy)", () => {
    for (const group of CLIENT_CHUNK_GROUPS) {
      expect(typeof group.name, nameOf(group)).toBe("function");
      if (typeof group.name !== "function") continue;
      const ctx = (isEntry: boolean): Rolldown.ChunkingContext => ({
        getModuleInfo: () => ({ isEntry }) as Rolldown.ModuleInfo,
      });
      expect(group.name("/repo/x.js", ctx(true)), nameOf(group)).toBeNull();
      expect(group.name("/repo/x.js", ctx(false)), nameOf(group)).toBe(nameOf(group));
    }
  });

  it("tag `$initial` mają WYŁĄCZNIE części bootowe rodzin, wyżej niż reszta rodziny", () => {
    const tagged = PATH_GROUPS.filter((group) => group.tags?.includes("$initial"));
    expect(tagged.map(nameOf)).toEqual(["vendor-lucide-boot", "vendor-radix-boot"]);
    for (const boot of tagged) {
      const rest = PATH_GROUPS.filter((g) => g.test === boot.test && g !== boot);
      expect(rest.map(nameOf), nameOf(boot)).toEqual([nameOf(boot).replace(/-boot$/, "")]);
      expect(boot.priority!).toBeGreaterThan(rest[0]!.priority!);
    }
  });

  it("`app-initial`: najniższy poziom bootu, łapie wszystko, zawężona tagiem `$initial`", () => {
    const at = CLIENT_CHUNK_GROUPS.findIndex((group) => nameOf(group) === APP_INITIAL);
    const appInitial = CLIENT_CHUNK_GROUPS[at]!;
    expect(appInitial.priority).toBe(CHUNK_PRIORITY.initial);
    expect(appInitial.tags).toEqual(["$initial"]);
    for (const id of [`${REPO}/src/routes/index.tsx`, packageModuleId("clsx")]) {
      expect(matches(appInitial, id), id).toBe(true);
    }
    // Wyżej: grupy bootowe, vendorowe i przypięte (wybierają przed nią). Niżej: WYŁĄCZNIE
    // rodziny leniwe - bez tagu, niższy priorytet, każda z listy `LAZY_FAMILY_MODULES`.
    for (const group of CLIENT_CHUNK_GROUPS.slice(0, at))
      expect(group.priority!, nameOf(group)).toBeGreaterThan(appInitial.priority!);
    const lazy = CLIENT_CHUNK_GROUPS.slice(at + 1);
    expect(lazy.map(nameOf).sort()).toEqual(Object.keys(LAZY_FAMILY_MODULES).sort());
    for (const group of lazy) {
      expect(group.priority!, nameOf(group)).toBeLessThan(appInitial.priority!);
      expect(group.tags, nameOf(group)).toBeUndefined();
    }
  });

  it("rodziny leniwe: każdy plik istnieje i łapie go dokładnie jego grupa", () => {
    for (const [name, files] of Object.entries(LAZY_FAMILY_MODULES)) {
      for (const file of files) {
        expect(existsSync(join(REPO, file)), file).toBe(true);
        expect(familyOf(join(REPO, file))?.names, file).toEqual([name]);
      }
    }
    // Pakiet dompurify jedzie z modułem sanityzacji.
    expect(familyOf(packageModuleId("dompurify"))?.names).toEqual(["sanitize"]);
  });

  it("`clientCodeSplitting()` daje świeżą tablicę tych samych grup", () => {
    const first = clientCodeSplitting();
    expect(first.groups).toEqual([...CLIENT_CHUNK_GROUPS]);
    expect(first.groups).not.toBe(clientCodeSplitting().groups);
  });

  it("reguły pakietów: zagnieżdżona kopia prymitywu radixa i zagnieżdżony zod", () => {
    // Ciężka kontrolka po OSTATNIM segmencie node_modules: prymityw zagnieżdżony pod pakietem
    // `react-select` zostaje w rodzinie; tylko zod najwyższego poziomu ma własną grupę.
    const nested = `${NODE_MODULES}/@radix-ui/react-select/node_modules/@radix-ui/react-primitive/dist/index.mjs`;
    expect(familyOf(nested)?.names).toEqual(["vendor-radix-boot", "vendor-radix"]);
    expect(familyOf(packageModuleId("@radix-ui/react-context-menu"))?.names).toEqual([
      "vendor-radix-menu",
    ]);
    expect(familyOf(packageModuleId("zod"))?.names).toEqual(["vendor-zod"]);
    expect(
      familyOf(`${NODE_MODULES}/@tanstack/react-start/node_modules/zod/index.js`),
    ).toBeUndefined();
    // Bootstrap Start ŚWIADOMIE poza grupami (nagłówek grupy vendor-tanstack).
    expect(familyOf(packageModuleId("@tanstack/react-start"))).toBeUndefined();
    expect(familyOf(packageModuleId("@tanstack/start-client-core"))).toBeUndefined();
  });
});

describe("clientChunkGroups - zasada priorytetów na zainstalowanym grafie", () => {
  const packages = installedPackages();

  it("pakiety grup importują wyłącznie grupy o WYŻSZYM priorytecie", () => {
    const violations: string[] = [];
    let edges = 0;
    for (const [pkg, deps] of packages) {
      const from = familyOf(packageModuleId(pkg));
      if (!from) continue;
      for (const dep of deps) {
        if (!packages.has(dep)) continue;
        const to = familyOf(packageModuleId(dep));
        if (!to || to.names.join() === from.names.join()) continue;
        edges++;
        if (!(from.max < to.min)) {
          violations.push(`${pkg} (${from.names.join("/")}) -> ${dep} (${to.names.join("/")})`);
        }
      }
    }
    expect(violations).toEqual([]);
    // Kontrola, że skan cokolwiek zmierzył (np. react-i18next -> react, radix -> react).
    expect(edges).toBeGreaterThan(20);
  });

  it("pakiety, których wymaga reguła, są zainstalowane (inaczej test nic nie mierzy)", () => {
    for (const pkg of [
      "react",
      "react-dom",
      "use-sync-external-store",
      "@tanstack/react-router",
      "@tanstack/router-core",
      "@supabase/supabase-js",
      "react-i18next",
      "lucide-react",
      "@radix-ui/react-slot",
      "@radix-ui/react-context-menu",
      "@radix-ui/react-menu",
      "sonner",
      "jszip",
    ]) {
      expect(packages.has(pkg), pkg).toBe(true);
      expect(familyOf(packageModuleId(pkg)), pkg).toBeDefined();
    }
  });

  it("moduły grup aplikacji importują wyłącznie grupy o WYŻSZYM priorytecie", () => {
    const byName = new Map(CLIENT_CHUNK_GROUPS.map((group) => [nameOf(group), group]));
    expect(Object.keys(APP_GROUP_MODULES).sort()).toEqual(
      PATH_GROUPS.filter(
        (group) =>
          (group.priority ?? 0) <= CHUNK_PRIORITY.app &&
          (group.priority ?? 0) > CHUNK_PRIORITY.initial,
      )
        .map(nameOf)
        .sort(),
    );
    const violations: string[] = [];
    for (const [name, file] of Object.entries(APP_GROUP_MODULES)) {
      const group = byName.get(name)!;
      expect(matches(group, join(REPO, file)), `${name} nie łapie ${file}`).toBe(true);
      const imports = valueImports(readFileSync(join(REPO, file), "utf8"));
      expect(imports.length, file).toBeGreaterThan(0);
      for (const specifier of imports) {
        const id = importedId(file, specifier);
        const target = familyOf(id) ?? familyOf(`${id}.tsx`) ?? familyOf(`${id}.ts`);
        // Import spoza grup (moduł aplikacji) trafiłby DO TEJ grupy jako jej zależność -
        // moduły przypięte mają importować tylko vendorów i inne grupy.
        if (!target) {
          violations.push(`${file}: "${specifier}" spoza grup`);
          continue;
        }
        // Ta sama grupa (opakowanie `ui/sonner.tsx` -> biblioteka `sonner`) - jeden chunk.
        if (target.names.includes(name)) continue;
        if (!((group.priority ?? 0) < target.min)) {
          violations.push(`${file} (${name}) -> "${specifier}" (${target.names.join("/")})`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

// ── PRAWDZIWY BUILD ──────────────────────────────────────────────────────────────────────────

/** Wejście pod `@tanstack/react-router/` - ścieżka, którą łapie test grupy vendor-tanstack. */
const ENTRY = "node_modules/@tanstack/react-router/dist/fixture-entry.js";

const pkgJson = (name: string, main: string, extra: object = {}) =>
  JSON.stringify({ name, version: "0.0.0", main, module: main, ...extra });
const esm = { type: "module", sideEffects: false };

const icon = (name: string) =>
  `import createLucideIcon from '../createLucideIcon.js';\n` +
  `const Icon = createLucideIcon(${JSON.stringify(name)}, [["path", { d: "M0 0" }]]);\n` +
  "export { Icon as default };\n";

const FILES: Record<string, string> = {
  // React jako CJS (jak prawdziwy) - interop wymaga modułu pomocniczego Rolldowna.
  "node_modules/react/package.json": pkgJson("react", "index.js"),
  "node_modules/react/index.js":
    '"use strict";\nexports.createElement = function (t, p) { return { t, p }; };\n' +
    'exports.version = "fixture-" + globalThis.__v;\n',
  "node_modules/use-sync-external-store/package.json": pkgJson(
    "use-sync-external-store",
    "index.js",
  ),
  "node_modules/use-sync-external-store/shim/index.js":
    '"use strict";\nvar React = require("react");\n' +
    "exports.useSyncExternalStore = function () { return React.version; };\n",
  [ENTRY]:
    'import { start } from "../../../../src/app.js";\nimport { Link } from "./index.js";\n' +
    "start(Link);\n",
  "node_modules/@tanstack/react-router/package.json": pkgJson(
    "@tanstack/react-router",
    "dist/index.js",
    esm,
  ),
  "node_modules/@tanstack/react-router/dist/index.js":
    'import { coreValue } from "@tanstack/router-core";\nexport const Link = () => coreValue();\n',
  "node_modules/@tanstack/router-core/package.json": pkgJson(
    "@tanstack/router-core",
    "dist/index.js",
    esm,
  ),
  "node_modules/@tanstack/router-core/dist/index.js":
    'import { serialize } from "seroval";\nexport const coreValue = () => serialize("router-core");\n',
  "node_modules/seroval/package.json": pkgJson("seroval", "index.js", esm),
  "node_modules/seroval/index.js":
    "export const serialize = (v) => JSON.stringify(v) + globalThis.__seroval;\n",
  "node_modules/react-i18next/package.json": pkgJson("react-i18next", "index.js", esm),
  "node_modules/react-i18next/index.js":
    'import { createElement } from "react";\n' +
    'export const useTranslation = () => createElement("i18n-" + globalThis.__t);\n',
  "node_modules/dompurify/package.json": pkgJson("dompurify", "index.js", esm),
  "node_modules/dompurify/index.js":
    'export const sanitize = (v) => String(v) + globalThis.__purify + "dompurify-fixture";\n',
  "node_modules/sonner/package.json": pkgJson("sonner", "index.js", esm),
  "node_modules/sonner/index.js":
    'import { createElement } from "react";\n' +
    'export const Toaster = () => createElement("sonner-" + globalThis.__s);\n',
  // Barrel w kształcie lucide-react 0.5xx: przestrzeń nazw `icons` + nazwane re-eksporty.
  "node_modules/lucide-react/package.json": pkgJson(
    "lucide-react",
    "dist/esm/lucide-react.js",
    esm,
  ),
  "node_modules/lucide-react/dist/esm/lucide-react.js":
    "import * as index from './icons/index.js';\nexport { index as icons };\n" +
    "export { default as Check, default as CheckIcon } from './icons/check.js';\n" +
    "export { default as Trash2 } from './icons/trash-2.js';\n" +
    "export { default as Unused } from './icons/unused.js';\n" +
    "export { default as createLucideIcon } from './createLucideIcon.js';\n" +
    "export { default as Icon } from './Icon.js';\n",
  "node_modules/lucide-react/dist/esm/icons/index.js":
    "export { default as Check } from './check.js';\n" +
    "export { default as Trash2 } from './trash-2.js';\n" +
    "export { default as Unused } from './unused.js';\n",
  "node_modules/lucide-react/dist/esm/icons/check.js": icon("lucide-check"),
  "node_modules/lucide-react/dist/esm/icons/trash-2.js": icon("lucide-trash-2"),
  "node_modules/lucide-react/dist/esm/icons/unused.js": icon("lucide-unused"),
  "node_modules/lucide-react/dist/esm/createLucideIcon.js":
    "import { createElement } from 'react';\nimport Icon from './Icon.js';\n" +
    "const createLucideIcon = (name, node) => () => createElement(Icon, { name, node });\n" +
    "export { createLucideIcon as default };\n",
  "node_modules/lucide-react/dist/esm/Icon.js":
    "import { createElement } from 'react';\n" +
    'const Icon = (props) => createElement("svg-" + globalThis.__i, props);\n' +
    "export { Icon as default };\n",
  "node_modules/@radix-ui/react-slot/package.json": pkgJson(
    "@radix-ui/react-slot",
    "dist/index.mjs",
    esm,
  ),
  "node_modules/@radix-ui/react-slot/dist/index.mjs":
    'import { composeRefs } from "@radix-ui/react-compose-refs";\n' +
    'import { createElement } from "react";\n' +
    'export const Slot = (p) => createElement("radix-slot", composeRefs(p));\n',
  "node_modules/@radix-ui/react-compose-refs/package.json": pkgJson(
    "@radix-ui/react-compose-refs",
    "dist/index.mjs",
    esm,
  ),
  "node_modules/@radix-ui/react-compose-refs/dist/index.mjs":
    "export const composeRefs = (p) => [p, globalThis.__refs];\n",
  // Niebootowy radix: zależy od części bootowej rodziny i od `use-sync-external-store`
  // (incydent 2026-07-20 - shim rozdzielony od Reacta).
  "node_modules/@radix-ui/react-dialog/package.json": pkgJson(
    "@radix-ui/react-dialog",
    "dist/index.mjs",
    esm,
  ),
  "node_modules/@radix-ui/react-dialog/dist/index.mjs":
    'import { Slot } from "@radix-ui/react-slot";\n' +
    'import { useSyncExternalStore } from "use-sync-external-store/shim";\n' +
    'import { createElement } from "react";\n' +
    'export const Dialog = () => createElement(Slot, { dialog: "radix-dialog", v: useSyncExternalStore() });\n',
  // `LegalLinksSsr`: statyczny import dla gałęzi SSR, martwej w kliencie (jak `Footer.tsx`) -
  // Rolldown liczy `$initial` przed tree-shakingiem, więc listwa jest `$initial`.
  "src/app.js":
    'import { Check } from "lucide-react";\nimport { Slot } from "@radix-ui/react-slot";\n' +
    'import { DynamicIcon } from "./lib/icons/DynamicIcon.tsx";\n' +
    'import LegalLinksSsr from "./components/footer/LegalLinks.tsx";\n' +
    'import { routeOptions } from "./routes/options.js";\n' +
    "export function start(link) {\n" +
    "  if (import.meta.env.SSR) globalThis.__ssr = LegalLinksSsr;\n" +
    "  globalThis.__fixture = [link, Check, Slot, DynamicIcon, routeOptions,\n" +
    '    () => import("./components/footer/LegalLinks.tsx"),\n' +
    '    () => import("./routes/lazy.js"),\n' +
    '    () => import("./components/ui/sonner.tsx")];\n' +
    "}\n",
  "src/lib/icons/DynamicIcon.tsx":
    'import { Check } from "lucide-react";\n' +
    'export const DynamicIcon = () => [Check, () => import("./DynamicIconChunk.js")];\n',
  "src/lib/icons/DynamicIconChunk.js": 'export default () => "dynamic-icon-chunk";\n',
  "src/components/footer/LegalLinks.tsx":
    'import { Link } from "@tanstack/react-router";\nimport { useTranslation } from "react-i18next";\n' +
    'export default function LegalLinks() { return [Link, useTranslation(), "legal-links-fixture"]; }\n',
  // Moduł opcji trasy (`createFileRoute` bez `?tsr-split`): importuje go wejście (drzewo tras)
  // i chunk komponentu trasy (po `Route`). Bez `app-initial` dostawał własny chunk wspólny.
  "src/routes/options.js":
    'export const routeOptions = { id: "route-options-fixture", component: () => import("./options.component.js") };\n',
  "src/routes/options.component.js":
    'import { routeOptions } from "./options.js";\nexport default () => [routeOptions.id, "route-component-fixture"];\n',
  "src/routes/lazy.js":
    'import { Trash2 } from "lucide-react";\nimport { Dialog } from "@radix-ui/react-dialog";\n' +
    'import { ClubThreadKindIcon } from "../components/clubs/atoms/ClubThreadKindIcon.tsx";\n' +
    'import { clean } from "../lib/sanitize.ts";\n' +
    "export default () => [Trash2, Dialog, ClubThreadKindIcon, clean];\n",
  // Rodzina leniwa POD `app-initial`: moduł grupy importuje kod bootu (`DynamicIcon`) i pakiet
  // rodziny (dompurify) - kod bootu ma zostać w `app-initial`, pakiet jechać z grupą.
  "src/lib/sanitize.ts":
    'import { sanitize } from "dompurify";\n' +
    'import { DynamicIcon } from "./icons/DynamicIcon.tsx";\n' +
    'export const clean = (v) => [sanitize(v), DynamicIcon, "sanitize-fixture"];\n',
  "src/components/clubs/atoms/ClubThreadKindIcon.tsx":
    'import { Trash2 } from "lucide-react";\n' +
    'import { DynamicIcon } from "../../../lib/icons/DynamicIcon.tsx";\n' +
    "export const ClubThreadKindIcon = () => [Trash2, DynamicIcon];\n",
  "src/components/ui/sonner.tsx":
    'import { useTranslation } from "react-i18next";\nimport { Toaster } from "sonner";\n' +
    "export default () => [Toaster, useTranslation()];\n",
};

let workspace = "";
let runs = 0;

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), "nes-client-chunk-groups-"));
});

afterAll(() => {
  if (workspace) rmSync(workspace, { recursive: true, force: true });
});

interface Built {
  readonly chunks: Rolldown.OutputChunk[];
  /** Nazwa chunku (`[name]`) -> chunk; nazwy w tej fiksturze są unikalne. */
  readonly byName: Map<string, Rolldown.OutputChunk>;
  /** Nazwa chunku, w którym jest moduł o danym sufiksie id. */
  readonly ownerOf: (suffix: string) => string | undefined;
  readonly entry: Rolldown.OutputChunk;
}

/** Buduje fiksturę jak bundel klienta produkcji: Oxc, bez hoistowania, wejście `index`. */
async function buildFixture(groups: Group[]): Promise<Built> {
  const root = join(workspace, `app-${++runs}`);
  for (const [file, content] of Object.entries(FILES)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content);
  }
  const result = await build({
    configFile: false,
    envFile: false,
    root,
    publicDir: false,
    logLevel: "silent",
    build: {
      write: false,
      minify: "oxc",
      modulePreload: { polyfill: false },
      rolldownOptions: {
        input: { index: join(root, ENTRY) },
        output: { hoistTransitiveImports: false, codeSplitting: { groups } },
      },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]) as Rolldown.RolldownOutput[];
  const chunks = outputs
    .flatMap((o) => o.output)
    .filter((o): o is Rolldown.OutputChunk => o.type === "chunk");
  const byName = new Map(chunks.map((chunk) => [chunk.name, chunk]));
  expect(byName.size, "nazwy chunków fikstury mają być unikalne").toBe(chunks.length);
  const entry = chunks.find((chunk) => chunk.isEntry);
  if (!entry) throw new Error("build bez chunku wejściowego");
  const ownerOf = (suffix: string) =>
    chunks.find((chunk) => chunk.moduleIds.some((id) => id.endsWith(suffix)))?.name;
  return { chunks, byName, ownerOf, entry };
}

const nameOfFile = (built: Built, file: string) =>
  built.chunks.find((chunk) => chunk.fileName === file)?.name ?? file;

/** Nazwy chunków statycznego domknięcia wejścia (to, co boot pobiera seria `modulepreload`). */
function bootClosure(built: Built): string[] {
  const seen = new Set<string>();
  const stack = [built.entry];
  while (stack.length > 0) {
    const chunk = stack.pop()!;
    if (seen.has(chunk.fileName)) continue;
    seen.add(chunk.fileName);
    for (const file of chunk.imports) {
      const next = built.chunks.find((candidate) => candidate.fileName === file);
      if (next) stack.push(next);
    }
  }
  return [...seen].map((file) => nameOfFile(built, file));
}

/**
 * Chunki z kodem za leniwymi `import()` chunku. Dynamiczne wejście złapane przez grupę Rolldown
 * wystawia przez FASADĘ (pusty chunk reeksportujący grupę) - za nią liczy się chunk grupy.
 */
function lazyTargets(built: Built, chunk: Rolldown.OutputChunk): string[] {
  return chunk.dynamicImports.flatMap((file) => {
    const target = built.chunks.find((candidate) => candidate.fileName === file)!;
    if (target.moduleIds.length > 0) return [target.name];
    return target.imports.map((imported) => nameOfFile(built, imported));
  });
}

describe("clientChunkGroups - prawdziwy build Vite 8 / Rolldown", () => {
  let built: Built;
  const priority = new Map(CLIENT_CHUNK_GROUPS.map((group) => [nameOf(group), group.priority!]));

  beforeAll(async () => {
    built = await buildFixture(clientCodeSplitting().groups ?? []);
  });

  it("wejście pod ścieżką grupy zostaje w `index`, a grupa vendor-tanstack powstaje", () => {
    expect(built.entry.name).toBe("index");
    expect(built.ownerOf("/dist/fixture-entry.js")).toBe("index");
    // Kod aplikacji bootu - w `app-initial`, który importuje wejście.
    expect(built.ownerOf("/src/app.js")).toBe(APP_INITIAL);
    expect(built.ownerOf("/@tanstack/react-router/dist/index.js")).toBe("vendor-tanstack");
    expect(built.ownerOf("/@tanstack/router-core/dist/index.js")).toBe("vendor-tanstack");
    // Domknięcie: zależność routera spoza listy pakietów idzie za nim, nie do wejścia.
    expect(built.ownerOf("/seroval/index.js")).toBe("vendor-tanstack");
  });

  it("React i `use-sync-external-store` w vendor-react - także gdy pierwszy sięga po nie radix", () => {
    expect(built.ownerOf("/react/index.js")).toBe("vendor-react");
    expect(built.ownerOf("/use-sync-external-store/shim/index.js")).toBe("vendor-react");
  });

  it("`$initial` dzieli barrel lucide po FAKTYCZNIE użytych ikonach", () => {
    expect(built.ownerOf("/icons/check.js")).toBe("vendor-lucide-boot");
    expect(built.ownerOf("/createLucideIcon.js")).toBe("vendor-lucide-boot");
    expect(built.ownerOf("/lucide-react/dist/esm/Icon.js")).toBe("vendor-lucide-boot");
    // Ikona re-eksportowana przez barrel, ale importowana tylko leniwie - poza bootem.
    expect(built.ownerOf("/icons/trash-2.js")).toBe("vendor-lucide");
    // Ikony nieużytej nie ma w żadnym chunku.
    for (const chunk of built.chunks) {
      expect(chunk.code, chunk.fileName).not.toContain("lucide-unused");
    }
  });

  it("radix: część bootowa = domknięcie statyczne z wejścia, reszta osobno", () => {
    expect(built.ownerOf("/@radix-ui/react-slot/dist/index.mjs")).toBe("vendor-radix-boot");
    expect(built.ownerOf("/@radix-ui/react-compose-refs/dist/index.mjs")).toBe("vendor-radix-boot");
    expect(built.ownerOf("/@radix-ui/react-dialog/dist/index.mjs")).toBe("vendor-radix");
  });

  it("przypięte moduły aplikacji mają własne chunki o stałych nazwach", () => {
    // `DynamicIcon` (chrome nagłówka) jest kodem bootu - w `app-initial`, choć importują go też
    // dwie rodziny leniwe (atom ikon klubu, sanityzacja); z nim helper preloadu Vite.
    expect(built.ownerOf("/src/lib/icons/DynamicIcon.tsx")).toBe(APP_INITIAL);
    expect(built.ownerOf("vite/preload-helper.js")).toBe(APP_INITIAL);
    expect(built.ownerOf("/src/components/footer/LegalLinks.tsx")).toBe("legal-links");
    expect(built.ownerOf("/src/components/clubs/atoms/ClubThreadKindIcon.tsx")).toBe(
      "club-thread-kind-icon",
    );
    expect(built.ownerOf("/src/components/ui/sonner.tsx")).toBe("vendor-sonner");
    expect(built.ownerOf("/sonner/index.js")).toBe("vendor-sonner");
    expect(built.ownerOf("/react-i18next/index.js")).toBe("vendor-i18n");
  });

  it("domknięcie bootu = wejście, `app-initial` i grupy bootowe - bez chunków wspólnych", () => {
    const boot = bootClosure(built);
    for (const lazy of [
      "vendor-lucide",
      "vendor-radix",
      "legal-links",
      "club-thread-kind-icon",
      "vendor-sonner",
      "sanitize",
    ]) {
      expect(boot, lazy).not.toContain(lazy);
    }
    expect(boot).toEqual(
      expect.arrayContaining(["index", APP_INITIAL, "vendor-lucide-boot", "vendor-radix-boot"]),
    );
    // Regresja z Rolldowna bez `app-initial`: moduł osiągalny z wejścia I z chunku leniwego
    // (opcje trasy) dostawał własny chunk wspólny - na aplikacji 337 chunków w domknięciu.
    // Poza grupami wyłącznie runtime Rolldowna (osobny chunk - komentarz grupy vendor-react).
    expect(
      boot.filter((name) => !["index", "rolldown-runtime"].includes(name) && !priority.has(name)),
    ).toEqual([]);
    expect(built.ownerOf("/src/routes/options.js")).toBe(APP_INITIAL);
    expect(built.ownerOf("/src/routes/options.component.js")).not.toBe(APP_INITIAL);
    // Wejście trzyma wyłącznie moduł wejściowy.
    expect(built.byName.get("index")!.moduleIds.map((id) => id.slice(-30))).toEqual([
      expect.stringMatching(/\/fixture-entry\.js$/),
    ]);
  });

  it("listwa: `$initial` przez martwy import SSR, a i tak we własnym chunku, leniwie", () => {
    // `legal-links` wybiera przed `app-initial`, więc martwy import gałęzi SSR (`$initial`
    // przed tree-shakingiem) nie wciąga kodu listwy do bootu.
    expect(built.byName.get("legal-links")!.moduleIds.map((id) => id.slice(-30))).toEqual([
      expect.stringMatching(/\/LegalLinks\.tsx$/),
    ]);
    expect(built.byName.get(APP_INITIAL)!.code).not.toContain("legal-links-fixture");
    expect(lazyTargets(built, built.byName.get(APP_INITIAL)!)).toContain("legal-links");
  });

  it("rodzina leniwa pod `app-initial`: pakiet z grupą, kod bootu zostaje w bocie", () => {
    // Gdyby `sanitize` wybierała przed `app-initial`, zabrałaby `DynamicIcon` jako zależność,
    // a `app-initial` importowałby chunk leniwy (cała rodzina w domknięciu wejścia).
    expect(built.ownerOf("/src/lib/sanitize.ts")).toBe("sanitize");
    expect(built.ownerOf("/dompurify/index.js")).toBe("sanitize");
    expect(built.byName.get(APP_INITIAL)!.code).not.toContain("dompurify-fixture");
    expect(built.byName.get("sanitize")!.imports.map((file) => nameOfFile(built, file))).toContain(
      APP_INITIAL,
    );
  });

  it("krawędzie między grupami biegną WYŁĄCZNIE do wyższego priorytetu", () => {
    const violations: string[] = [];
    let edges = 0;
    for (const chunk of built.chunks) {
      const from = priority.get(chunk.name);
      if (from === undefined) continue;
      for (const file of chunk.imports) {
        const target = nameOfFile(built, file);
        expect(target, `${chunk.name} importuje chunk wejściowy`).not.toBe("index");
        const to = priority.get(target);
        if (to === undefined) continue;
        edges++;
        if (!(to > from)) violations.push(`${chunk.name} (${from}) -> ${target} (${to})`);
      }
    }
    expect(violations).toEqual([]);
    expect(edges).toBeGreaterThan(5);
  });

  it("dowód pułapki: grupa z nazwą-napisem zapada się w chunk wejściowy", async () => {
    // Te same grupy, ale bez wyjątku dla modułu wejściowego. Gdyby Rolldown przestał zapadać
    // grupę, ten przypadek się zapali - wtedy wyjątek w `name` można uprościć.
    const naive = CLIENT_CHUNK_GROUPS.map((group) => ({ ...group, name: nameOf(group) }));
    const trapped = await buildFixture(naive);
    expect(trapped.byName.has("vendor-tanstack")).toBe(false);
    expect(trapped.ownerOf("/@tanstack/router-core/dist/index.js")).toBe("index");
  });
});
