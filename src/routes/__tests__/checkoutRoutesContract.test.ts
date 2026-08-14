// Bramka: KONTRAKT LEJKA CHECKOUTU JAKO CAŁOŚCI.
//
// Trzy trasy (`/checkout/$planId`, `/checkout/success`, `/checkout/cancel`)
// tworzą jeden przepływ pieniędzy, ale każda mieszka w osobnym pliku i osobno
// można ją zepsuć. Te asercje pilnują inwariantów, które łatwo zgubić przy
// dokładaniu czwartej trasy albo przy refaktorze - i których nie widać
// w testach zachowania pojedynczej trasy:
//
//   1. REJESTRACJA - trasa dopięta do drzewa pod dokładnie tą ścieżką, pod którą
//      linkuje ją reszta aplikacji i na którą odsyła operator płatności.
//   2. NOINDEX - żadna strona lejka nie może trafić do wyszukiwarki. Zaindeksowany
//      `/checkout/success` to publiczny dowód zakupu w wynikach Google.
//   3. WALIDACJA WEJŚCIA - trasy powrotu od operatora czytają query string, więc
//      MUSZĄ mieć `validateSearch`; bez niego surowy payload wchodzi w stan trasy.
//   4. CZYSTOŚĆ WEJŚCIA - żadna trasa nie importuje statycznie SDK operatora,
//      bo wspólny przodek dwóch takich importerów to chunk entry pobierany przez
//      KAŻDEGO czytelnika (patrz `EmbeddedCheckoutFrame` i `check:entry-purity`).
//   5. OSIĄGALNOŚĆ W OBIE STRONY - każdy literał `/checkout/...` w kodzie trafia
//      w istniejącą trasę, i każda trasa lejka jest z czegoś linkowana.
//   6. ADRES POWROTU - sanityzacja idzie przez współdzielony `safeReturnPath`,
//      a nie przez lokalne „zaczyna się od /" (to przepuszcza `//host`).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// Kurs NBP strzela do sieci przy imporcie w przeglądarce - bramka czyta wyłącznie
// metadane tras, więc odcinamy tę zależność zamiast wozić ją przez CI.
vi.mock("@/lib/billing/fxRate", () => ({
  getEurPlnRate: () => 4,
  ensureFxRateLoaded: async () => 4,
  forceRefreshFxRate: async () => 4,
  getFxState: () => ({ eurPln: 4, source: "nbp" as const }),
  setEurPlnRateForTests: () => {},
}));

import { routeMeta } from "@/test/routeHarness";
import { Route as PlanRoute } from "@/routes/checkout.$planId";
import { Route as SuccessRoute } from "@/routes/checkout.success";
import { Route as CancelRoute } from "@/routes/checkout.cancel";

const ROUTE_TREE = "src/routeTree.gen.ts";

const CHECKOUT_ROUTES = [
  { path: "/checkout/$planId", file: "src/routes/checkout.$planId.tsx", route: PlanRoute },
  { path: "/checkout/success", file: "src/routes/checkout.success.tsx", route: SuccessRoute },
  { path: "/checkout/cancel", file: "src/routes/checkout.cancel.tsx", route: CancelRoute },
] as const;

/** Trasy, na które operator odsyła kupującego z parametrami w adresie. */
const RETURN_ROUTES = CHECKOUT_ROUTES.filter((r) => r.path !== "/checkout/$planId");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

// Katalogi z TREŚCIĄ PRZYKŁADOWĄ i rusztowaniem testów: `patterns` to gotowce
// wstawiane redaktorowi do buildera (adresy CTA są tam zaślepkami, które
// redakcja podmienia na własne), a `test` to atrapy danych dla testów. Ani
// jedne, ani drugie nie są linkami produkcyjnymi.
const NON_PRODUCT_DIRS = ["src/lib/patterns", "src/test"];

/** Pliki źródłowe aplikacji - bez generowanych artefaktów i bez testów. */
function sourceFiles(dir = "src", out: string[] = []): string[] {
  if (NON_PRODUCT_DIRS.includes(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== "__tests__") sourceFiles(full, out);
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    if (/\.(test|spec)\.tsx?$/.test(entry)) continue;
    if (full === ROUTE_TREE) continue;
    out.push(full);
  }
  return out;
}

describe("lejek checkoutu - kontrakt tras", () => {
  it.each(CHECKOUT_ROUTES)("$path jest zarejestrowana w drzewie tras", ({ path, file }) => {
    const tree = read(ROUTE_TREE);
    const module = file.replace(/^src\//, "./").replace(/\.tsx$/, "");

    expect(tree, `brak importu pliku trasy ${file}`).toContain(`from '${module}'`);
    // Generator wypisuje `id` i `path` osobno - obie muszą być tą samą ścieżką,
    // inaczej link z aplikacji trafia gdzie indziej niż powrót od operatora.
    expect(tree).toContain(`id: '${path}'`);
    expect(tree).toContain(`path: '${path}'`);
  });

  it.each(CHECKOUT_ROUTES)("$path trzyma wyszukiwarki poza lejkiem", async ({ route }) => {
    const meta = await routeMeta(route);

    expect(meta).toContainEqual({ name: "robots", content: "noindex, nofollow" });
  });

  it.each(CHECKOUT_ROUTES)("$path ma tytuł strony", async ({ route }) => {
    const meta = await routeMeta(route);

    expect(meta.some((entry) => typeof entry.title === "string" && entry.title.length > 0)).toBe(
      true,
    );
  });

  it.each(RETURN_ROUTES)("$path waliduje parametry z adresu powrotu", ({ route }) => {
    expect(typeof route.options.validateSearch).toBe("function");
  });

  it.each(CHECKOUT_ROUTES)("$path nie ciągnie SDK operatora do chunku trasy", ({ file }) => {
    const source = read(file);

    expect(source).not.toMatch(/^import[^\n]*from\s+"@stripe\//m);
    expect(source).not.toMatch(/^import\s+"@stripe\//m);
  });

  it("każdy adres `/checkout/...` w kodzie wskazuje na istniejącą trasę", () => {
    // Adresy powrotu od operatora są rozsiane po powierzchniach zakupowych
    // (paywall, bilet na wydarzenie, panel diagnostyczny, sama trasa planu) jako
    // literały. Zmiana nazwy pliku trasy nie zepsułaby żadnego z nich w czasie
    // kompilacji - kupujący zobaczyłby 404 PO obciążeniu karty. Ta asercja
    // trzyma cały ten zbiór w jednym kawałku.
    const known = new Set<string>(CHECKOUT_ROUTES.map((r) => r.path));
    const found = new Map<string, string[]>();

    // Literał adresu, a nie ścieżka modułu: `/checkout/...` musi zaczynać string
    // (opcjonalnie po wstawce z originem), więc `@/components/checkout/Foo` odpada.
    const HREF = /(["'`])(?:\$\{[^}]*\})?(\/checkout\/[$A-Za-z0-9-]+)/g;
    for (const file of sourceFiles()) {
      for (const [, , href] of read(file).matchAll(HREF)) {
        // Segment dynamiczny - `/checkout/$planId` (Link) albo `/checkout/${id}`
        // (kotwica widgetu) - sprowadza się do tej samej trasy z parametrem.
        const canonical = href.replace(/\/checkout\/\$.*$/, "/checkout/$planId");
        found.set(canonical, [...(found.get(canonical) ?? []), file]);
      }
    }

    for (const [href, files] of found) {
      expect(known, `${href} (${files.join(", ")}) nie odpowiada żadnej trasie`).toContain(href);
    }
    // Odwrotny kierunek: każda trasa lejka jest z czegoś osiągalna. Trasa, do
    // której nic nie linkuje, to albo martwy kod, albo zgubiony krok lejka -
    // i jednocześnie dowód, że powyższy skan naprawdę czyta kod aplikacji.
    for (const { path } of CHECKOUT_ROUTES) {
      expect([...found.keys()], `${path} nie jest osiągalna z żadnej powierzchni`).toContain(path);
    }
  });

  it("adres powrotu z sessionStorage przechodzi przez współdzieloną sanityzację", () => {
    const source = read("src/routes/checkout.success.tsx");

    expect(source).toContain("safeReturnPath");
    // Lokalny warunek „zaczyna się od /" przepuszczał `//host` i `/\host`, czyli
    // adres protocol-relative - czyli open redirect zaraz po zapłaceniu.
    expect(source).not.toMatch(/startsWith\("\/"\)/);
  });
});
