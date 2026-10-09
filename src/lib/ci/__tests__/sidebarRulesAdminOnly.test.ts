/**
 * REGUŁY KOLORÓW PASKA BOCZNEGO ŻYJĄ W ARKUSZU PANELU (P3.7a, krok S3).
 *
 * Do P3.7a 16 reguł `[data-sidebar...]` jechało w moście `globalColorsToCss`, czyli
 * w inline `<style data-brand-tokens>` KAŻDEGO dokumentu publicznego (3,6 KB martwego
 * CSS-u: pasek renderują wyłącznie komponenty panelu). Teraz stoją na końcu
 * `src/admin-styles.css`, który ładuje trasa `/admin` (`head().links`). Ten test pilnuje
 * trzech warunków, bez których przeniesienie zmieniłoby wygląd panelu albo zgubiło kolory:
 *   1. `data-sidebar` w JSX emitują wyłącznie moduły `src/components/admin/**`;
 *   2. każda trasa, która je (przechodnio) importuje, leży pod `/admin` - czyli dostaje arkusz;
 *   3. każda zmienna koloru slotu paska z panelu (`--gc-sidebar-*`, emitowana dalej przez
 *      `globalColorsToCss`) ma konsumenta w arkuszu panelu, a reguły kolorów stoją ZA
 *      regułami stylów paska (dawny blok inline szedł po arkuszu - kolejność kaskady).
 *
 * i18n: brak treści dla użytkownika - inwariant CI.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { GLOBAL_COLOR_GROUPS, globalColorsToCss } from "@/lib/builder/globalColors";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const ROUTES = join(SRC, "routes");
const ADMIN_SHEET = readFileSync(join(SRC, "admin-styles.css"), "utf8");

/** Moduły aplikacji (bez testów, pomocników testowych i wygenerowanego drzewa tras). */
const MODULES = (readdirSync(SRC, { recursive: true }) as string[])
  .map((file) => join(SRC, file))
  .filter(
    (file) =>
      /\.(ts|tsx)$/.test(file) &&
      !/[\\/]__tests__[\\/]|\.(test|spec)\.tsx?$|[\\/]src[\\/]test[\\/]/.test(file) &&
      !file.endsWith("routeTree.gen.ts"),
  );
const SOURCE = new Map(MODULES.map((file) => [file, readFileSync(file, "utf8")]));

const SPECIFIER = /(?:from\s*|import\s*\(\s*|import\s+)["']([^"']+)["']/g;

function resolveSpecifier(from: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = join(SRC, specifier.slice(2));
  else if (specifier.startsWith(".")) base = resolve(dirname(from), specifier);
  else return null;
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Odwrotny graf importów (statycznych i dynamicznych). */
const IMPORTERS = new Map<string, Set<string>>();
for (const [file, source] of SOURCE) {
  for (const match of source.matchAll(SPECIFIER)) {
    const target = resolveSpecifier(file, match[1]);
    if (!target) continue;
    if (!IMPORTERS.has(target)) IMPORTERS.set(target, new Set());
    IMPORTERS.get(target)!.add(file);
  }
}

/** Moduły stawiające atrybut `data-sidebar` w JSX (`data-sidebar="..."` / `data-sidebar={...}`). */
const EMITTERS = [...SOURCE]
  .filter(([, source]) => /data-sidebar=["{]/.test(source))
  .map(([f]) => f);

/** Trasy osiągalne z emiterów w odwrotnym grafie (przejście zatrzymuje się na pliku trasy). */
function routesRendering(files: readonly string[]): string[] {
  const seen = new Set(files);
  const queue = [...files];
  const routes = new Set<string>();
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (file.startsWith(ROUTES)) {
      routes.add(relative(ROUTES, file).replace(/\\/g, "/"));
      continue;
    }
    for (const importer of IMPORTERS.get(file) ?? []) {
      if (seen.has(importer)) continue;
      seen.add(importer);
      queue.push(importer);
    }
  }
  return [...routes].sort();
}

/** Plik trasy pod `/admin`: pierwszy segment to dokładnie `admin` (nie `admin_`). */
const isAdminRouteFile = (file: string) => /^admin(\.|\/)/.test(file);

describe("pasek boczny renderuje wyłącznie panel", () => {
  it("`data-sidebar` w JSX emitują tylko moduły src/components/admin/**", () => {
    expect(EMITTERS.length).toBeGreaterThan(0);
    for (const file of EMITTERS) {
      expect(relative(SRC, file).replace(/\\/g, "/")).toMatch(/^components\/admin\//);
    }
  });

  it("każda trasa, która je importuje, leży pod /admin (ładuje admin-styles.css)", () => {
    const routes = routesRendering(EMITTERS);
    expect(routes).toContain("admin.tsx");
    expect(routes.filter((file) => !isAdminRouteFile(file))).toEqual([]);
    // Trasa `/admin` deklaruje arkusz - inaczej reguły z arkusza nie dotarłyby nigdzie.
    expect(SOURCE.get(join(ROUTES, "admin.tsx"))).toMatch(
      /import adminCss from "@\/admin-styles\.css\?url"[\s\S]*rel: "stylesheet", href: adminCss/,
    );
  });

  it("kontrola negatywna: trasa publiczna z emiterem zostałaby wykryta", () => {
    expect(isAdminRouteFile("index.tsx")).toBe(false);
    expect(isAdminRouteFile("admin_.preview.tsx")).toBe(false);
    expect(isAdminRouteFile("admin.events_.new.tsx")).toBe(true);
  });
});

describe("kolory paska z panelu docierają do arkusza panelu", () => {
  const sidebarSlots = GLOBAL_COLOR_GROUPS.filter((g) => g.id === "sidebar").flatMap(
    (g) => g.slots,
  );

  it("dokument publiczny nie niesie reguł paska, tylko jego zmienne", () => {
    const out = globalColorsToCss({ "sidebar-bg": { light: "#101010", dark: "#efefef" } });
    expect(out).not.toContain("data-sidebar");
    expect(out).not.toMatch(/var\(--gc-sidebar-/);
    expect(out).toContain("--gc-sidebar-bg: #101010;");
  });

  it("każdy slot paska ma konsumenta swojej zmiennej w admin-styles.css", () => {
    expect(sidebarSlots.length).toBeGreaterThan(0);
    for (const slot of sidebarSlots) {
      // Odporne na łamanie `var(` przez prettiera; `(?![\w-])` - pełna nazwa zmiennej.
      expect(ADMIN_SHEET, slot.key).toMatch(new RegExp(`var\\(\\s*--gc-${slot.key}(?![\\w-])`));
    }
  });

  it("reguły kolorów paska stoją ZA regułami stylów paska (kolejność kaskady)", () => {
    const lastStyleRule = ADMIN_SHEET.lastIndexOf("[data-sidebar-style=");
    const firstColorRule = ADMIN_SHEET.search(/var\(\s*--gc-sidebar-/);
    expect(lastStyleRule).toBeGreaterThan(-1);
    expect(firstColorRule).toBeGreaterThan(lastStyleRule);
  });
});
