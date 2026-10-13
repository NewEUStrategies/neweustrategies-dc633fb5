// Bramka listy tras kodowych z bezwarunkowym `noindex` (`noindexCodeRoutes.ts`).
//
// Lista decyduje, które strony CMS mapa XML i mapa HTML pomijają, bo pod ich
// adresem renderuje się trasa kodowa z `noindex`. Rozjazd w którąkolwiek stronę
// jest błędem widocznym w Search Console:
//   * ścieżka na liście bez trasy z `noindex` - mapa gubi indeksowalną stronę,
//   * trasa z `noindex` spoza listy - mapa ogłasza adres oznaczony `noindex`
//     („Przesłany URL oznaczony tagiem noindex", audyt 2026-10: `/login`, `/club`).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NOINDEX_CODE_ROUTE_PATHS, isNoindexCodeRoutePath } from "@/lib/seo/noindexCodeRoutes";

const ROUTES_DIR = join(process.cwd(), "src/routes");

/** Literalne `noindex` w `head()` trasy - bez gałęzi warunkowych (`if (seo.noindex)`). */
const LITERAL_NOINDEX = /(content|robots): *"noindex|forceNoindex: *true/;

interface RouteFile {
  file: string;
  path: string;
  source: string;
}

/** Statyczne trasy publiczne: bez admina, layoutów (`_`), parametrów (`$`) i plików specjalnych. */
function staticPublicRoutes(): RouteFile[] {
  const out: RouteFile[] = [];
  for (const file of readdirSync(ROUTES_DIR)) {
    if (!file.endsWith(".tsx")) continue;
    if (/^(admin|_)|[$[]/.test(file)) continue;
    const source = readFileSync(join(ROUTES_DIR, file), "utf8");
    const match = /createFileRoute\("([^"]+)"\)/.exec(source);
    if (!match) continue;
    // `profile_.portal` -> `/profile_/portal`: podkreślnik na końcu segmentu
    // to znacznik TanStack „bez layoutu rodzica", nie część adresu URL.
    const path = match[1].replace(/_(?=\/|$)/g, "").replace(/\/$/, "") || "/";
    out.push({ file, path, source });
  }
  return out;
}

function hasLiteralNoindex(source: string): boolean {
  return source.split("\n").some((line) => LITERAL_NOINDEX.test(line) && !line.includes("if ("));
}

describe("NOINDEX_CODE_ROUTE_PATHS - lista zgodna z trasami", () => {
  const routes = staticPublicRoutes();

  it("każda ścieżka z listy ma trasę z literalnym `noindex`", () => {
    for (const path of NOINDEX_CODE_ROUTE_PATHS) {
      // Ścieżka bywa w dwóch plikach (layout `profile.tsx` + `profile.index.tsx`);
      // `head()` layoutu obowiązuje też trasę indeksu.
      const matching = routes.filter((r) => r.path === path);
      expect(matching.length, `brak trasy dla ${path}`).toBeGreaterThan(0);
      expect(
        matching.some((route) => hasLiteralNoindex(route.source)),
        `${matching.map((r) => r.file).join(", ")} bez literalnego noindex`,
      ).toBe(true);
    }
  });

  it("każda statyczna trasa publiczna z literalnym `noindex` jest na liście", () => {
    const missing = routes
      .filter((route) => hasLiteralNoindex(route.source))
      .filter((route) => !NOINDEX_CODE_ROUTE_PATHS.has(route.path))
      .map((route) => `${route.file} (${route.path})`);
    expect(missing).toEqual([]);
  });

  it("isNoindexCodeRoutePath normalizuje ukośniki i nie łapie stron podobnych", () => {
    expect(isNoindexCodeRoutePath("/login")).toBe(true);
    expect(isNoindexCodeRoutePath("login")).toBe(true);
    expect(isNoindexCodeRoutePath("/club/")).toBe(true);
    expect(isNoindexCodeRoutePath("/club/klub-dyskusyjny")).toBe(false);
    expect(isNoindexCodeRoutePath("/login-help")).toBe(false);
    expect(isNoindexCodeRoutePath("/o-nas")).toBe(false);
  });
});
