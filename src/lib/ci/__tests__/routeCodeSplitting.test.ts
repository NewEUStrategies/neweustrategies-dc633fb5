/**
 * Reguła podziału tras (`scripts/lib/routeCodeSplitting.ts`) - kontrakt,
 * którego dotąd nie pilnował żaden test, a który decyduje o zawartości chunku
 * wejściowego dla KAŻDEGO odwiedzającego.
 *
 * DLACZEGO TEST, SKORO TO TRZY LINIE. Lista wyjątków ma naturalną tendencję do
 * rośnięcia („ta trasa też jest ważna"): 2026-10-02 pięć pozornie tanich
 * wyjątków (`/blog`, `/post/`, `/category/`, `/tag/`, `/author/`) kosztowało
 * ~75 KB kodu przed minifikacją w entry. Test przypina ZAMKNIĘTĄ listę
 * gorących ścieżek i dowodzi na kontrprzykładach, że archiwa i profile autora
 * są dzielone jak każda inna trasa.
 *
 * i18n: brak treści dla użytkownika - narzędzie CI.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { routeSplitBehavior } from "../../../../scripts/lib/routeCodeSplitting";

const ROUTES_DIR = join(process.cwd(), "src/routes");
const SPLIT_ALL = [["loader"], ["component"], ["errorComponent", "notFoundComponent"]];

describe("routeSplitBehavior - zamknięta lista gorących ścieżek", () => {
  it("`__root__` zostaje przy `undefined` - wtyczka korzenia nie dzieli", () => {
    expect(routeSplitBehavior({ routeId: "__root__" })).toBeUndefined();
  });

  it.each(["/", "/$", "/en", "/en/", "/en/$"])(
    "%s: komponent, błąd i 404 w JEDNYM chunku podziału (jeden plik w serii bootu)",
    (routeId) => {
      // Nie `undefined`: wtyczka zamieniłaby je na domyślny podział na trzy chunki.
      expect(routeSplitBehavior({ routeId })).toEqual([
        ["component", "errorComponent", "notFoundComponent"],
      ]);
    },
  );

  it.each([
    "/blog/",
    "/post/$slug",
    "/category/$slug",
    "/tag/$slug",
    "/author/$slug",
    "/search",
    "/club/",
    "/admin/settings",
  ])("%s jest dzielony na loader/komponenty", (routeId) => {
    expect(routeSplitBehavior({ routeId })).toEqual(SPLIT_ALL);
  });

  it("prefiks `/en` nie łapie tras, które tylko zaczynają się od tych liter", () => {
    expect(routeSplitBehavior({ routeId: "/english-digest" })).toEqual(SPLIT_ALL);
    expect(routeSplitBehavior({ routeId: "/events/" })).toEqual(SPLIT_ALL);
  });

  it("kokpit `/admin/` trzyma loader w grupie z komponentem, a reszta panelu nie", () => {
    // Loader i komponent dzielą dynamiczny import pulpitu analityki. Osobne
    // grupy wydzielały go do mikromodułu `tsr-shared`, który Rollup doklejał do
    // przypadkowego (także publicznego) chunku - patrz komentarz reguły.
    expect(routeSplitBehavior({ routeId: "/admin/" })).toEqual([
      ["loader", "component"],
      ["errorComponent", "notFoundComponent"],
    ]);
    expect(routeSplitBehavior({ routeId: "/admin/analytics" })).toEqual(SPLIT_ALL);
  });

  it("żadna trasa nie dzieli komponentu między DWIE grupy podziału (wyścig splittera)", () => {
    // Komponent wspólny dla dwóch grup trafia do `?tsr-shared`, a ten mechanizm splittera
    // niedeterministycznie wywracał build (`Export 'SplitErrorComponent' is not defined`).
    const violations: string[] = [];
    const routeFiles = readdirSync(ROUTES_DIR, { recursive: true, encoding: "utf8" }).filter(
      (file) => /\.tsx?$/.test(file) && !file.includes("__tests__"),
    );
    for (const file of routeFiles) {
      const source = readFileSync(join(ROUTES_DIR, file), "utf8");
      const options = /createFileRoute\([^)]*\)\(\{/.exec(source);
      if (!options) continue;
      const rest = source.slice(options.index + options[0].length);
      const owners = new Map<string, string[]>();
      for (const key of ["loader", "component", "errorComponent", "notFoundComponent"]) {
        const value = new RegExp(`\\n\\s*${key}:\\s*([A-Za-z_]\\w*)\\s*[,\\n]`).exec(rest)?.[1];
        if (value) owners.set(value, [...(owners.get(value) ?? []), key]);
      }
      const routeId = /createFileRoute\(\s*["'`]([^"'`]+)["'`]/.exec(source)?.[1] ?? file;
      const groups = routeSplitBehavior({ routeId }) ?? [];
      for (const [binding, keys] of owners) {
        const groupOf = (key: string) => groups.findIndex((group) => group.some((n) => n === key));
        if (new Set(keys.map(groupOf).filter((i) => i >= 0)).size > 1) {
          violations.push(`${file}: ${binding} w ${keys.join(" + ")}`);
        }
      }
    }
    expect(routeFiles.length).toBeGreaterThan(100);
    expect(violations).toEqual([]);
  });

  it("splitter nie dzieli `pendingComponent` - szkielet pokazuje się bez skoku po chunk", () => {
    // Celowo: pending jest widoczny PRZED załadowaniem komponentu, więc jego
    // wydzielenie dodałoby round-trip dokładnie tam, gdzie ma go zasłaniać.
    const groups = routeSplitBehavior({ routeId: "/organization/$slug" }) ?? [];
    expect(groups.flat()).not.toContain("pendingComponent");
  });
});
