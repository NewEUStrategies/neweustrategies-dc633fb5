// Bramka listy adresów tras kodowych (`codeRoutes.ts`).
//
// Lista decyduje, czy pozycja menu wskazująca niepubliczny wiersz `pages`
// jest martwym linkiem (ukryta), czy linkiem do trasy kodowej, która działa
// bez względu na status wiersza (`/pricing`, `/club`, `/membership-join`).
// Rozjazd w którąkolwiek stronę jest widoczny publicznie:
//   * trasa spoza listy - menu ukrywa działający link,
//   * ścieżka bez trasy - menu pokazuje link na 404.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CODE_ROUTE_PATHS, isCodeRoutePath } from "../codeRoutes";

const ROUTES_DIR = join(process.cwd(), "src/routes");

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== "__tests__") out.push(...routeFiles(full));
      continue;
    }
    // Pliki z `-` TanStack Router pomija; testy nie są trasami.
    if (!/\.tsx?$/.test(name) || name.startsWith("-") || /\.test\.tsx?$/.test(name)) continue;
    out.push(full);
  }
  return out;
}

/** Jednosegmentowe, statyczne ścieżki publiczne z `createFileRoute("...")`. */
function singleSegmentRoutePaths(): Set<string> {
  const out = new Set<string>();
  for (const file of routeFiles(ROUTES_DIR)) {
    const match = /createFileRoute\("([^"]+)"\)/.exec(readFileSync(file, "utf8"));
    if (!match) continue;
    const segments = match[1].split("/").filter(Boolean);
    if (segments.length !== 1) continue;
    const [segment] = segments;
    if (segment === "admin" || segment.startsWith("$") || segment.startsWith("_")) continue;
    out.add(`/${segment}`);
  }
  return out;
}

describe("CODE_ROUTE_PATHS - lista zgodna z trasami", () => {
  it("zbiór jest DOKŁADNIE zbiorem jednosegmentowych tras publicznych", () => {
    expect([...CODE_ROUTE_PATHS].sort()).toEqual([...singleSegmentRoutePaths()].sort());
  });

  it("isCodeRoutePath: dokładna ścieżka, prefiks /en, ukośnik i query - tak; podstrona - nie", () => {
    expect(isCodeRoutePath("/pricing")).toBe(true);
    expect(isCodeRoutePath("/en/club/")).toBe(true);
    expect(isCodeRoutePath("/membership-join?plan=pro")).toBe(true);
    // `/blog/x` obsługuje resolver CMS - to nie jest adres trasy kodowej.
    expect(isCodeRoutePath("/blog/analiza")).toBe(false);
    expect(isCodeRoutePath("/o-nas")).toBe(false);
    expect(isCodeRoutePath("https://example.com/pricing")).toBe(false);
    expect(isCodeRoutePath("")).toBe(false);
    expect(isCodeRoutePath(null)).toBe(false);
  });
});
