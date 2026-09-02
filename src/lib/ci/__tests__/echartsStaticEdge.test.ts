// Bramka statyczna: JEDYNYM plikiem, który WARTOŚCIOWO importuje ECharts, jest
// `EChartClient.tsx` - a jego jedyną drogą do grafu jest `import()`.
//
// PO CO, SKORO JEST `check:entry-purity`. Bo tamta bramka mierzy co innego, i to
// jest różnica, którą łatwo przeoczyć. `check-entry-purity.ts` liczy DOMKNIĘCIE
// ŚCIEŻKI BOOTOWANIA KLIENTA: startuje od chunków wstrzykiwanych przez SSR jako
// `<script type="module">` i idzie po STATYCZNYCH krawędziach chunk -> chunk.
// Niezmienność z nagłówka `EChart.tsx` dotyczy natomiast grafu SSR - OOM V8
// wywalał renderer chunków Rollupa na przebiegu Cloudflare/Nitro.
//
// Prześledźmy, co się stanie, gdy ktoś dopisze `import { EChartClient } from
// "./EChartClient"` do `EChart.tsx`. Wszyscy importerzy `EChart` siedzą na
// powierzchniach tras leniwych (ChartCard, KpiTile, panele BI, ClubInsights,
// admin.coupons.analytics), a `manualChunks` w `vite.config.ts` nie ma kubełka
// na echarts ani łapacza końcowego. Biblioteka wyląduje więc w chunku
// osiągalnym WYŁĄCZNIE z chunków leniwych, czyli POZA domknięciem bootu -
// `check:entry-purity` zostanie ZIELONA, a build SSR padnie.
//
// Stąd ta bramka: nie liczy chunków, tylko czyta ŹRÓDŁA. Jest tańsza (nie
// wymaga builda), wcześniejsza (zapala się w PR, nie po pełnym buildzie) i
// mówi wprost, który plik złamał regułę. Trzy dowody, żaden nie zastępuje
// pozostałych:
//   * TU - krawędź statyczna w źródłach,
//   * `entryPurityEchartsMarkers.test.ts` - że markery bramki chunkowej mają
//     czego szukać w wydaniu produkcyjnym,
//   * `components/admin/analytics/__tests__/EChart.test.tsx` - że render
//     serwerowy faktycznie kończy się na szkielecie i nie woła `import()`.
//
// `import type` JEST DOZWOLONE i to nie jest furtka: importy typów są kasowane
// przy kompilacji, więc nie tworzą żadnej krawędzi w grafie modułów. Dokładnie
// tak korzysta z `echarts/core` dziesięć plików tego modułu - biorą stamtąd
// wyłącznie `EChartsCoreOption` i `ECharts`.
import { describe, it, expect } from "vitest";
import { readFileSync, globSync } from "node:fs";

/** Jedyny plik, któremu wolno wciągnąć ECharts wartościowo. */
const CHART_MODULE = "src/components/admin/analytics/EChartClient.tsx";
/** Plik, który wciąga go WYŁĄCZNIE przez `import()`. */
const LAZY_BRIDGE = "src/components/admin/analytics/EChart.tsx";

function productionSources(): string[] {
  return globSync("src/**/*.{ts,tsx}")
    .map((p) => p.split("\\").join("/"))
    .filter((p) => !p.includes("/__tests__/") && !/\.(test|spec)\.tsx?$/.test(p))
    .filter((p) => !p.startsWith("src/test/"));
}

/**
 * Statyczne importy WARTOŚCIOWE z danego pliku.
 *
 * Odsiewa dwie rzeczy, i obie celowo: `import type ...` (kasowane przy
 * kompilacji, zero krawędzi) oraz `import(` (leniwe, to jest właśnie wzorzec,
 * którego ta reguła broni).
 */
function valueImportSpecifiers(source: string): string[] {
  const out: string[] = [];
  const re = /(^|\n)\s*import\s+(type\s+)?([^;]*?)\s*from\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(re)) {
    const isTypeOnly = Boolean(match[2]);
    const clause = match[3] ?? "";
    if (isTypeOnly) continue;
    // `import { type A, type B } from "x"` też nie tworzy krawędzi runtime.
    const named = clause.match(/^\{([\s\S]*)\}$/);
    if (named && named[1].split(",").every((part) => part.trim() === "" || /^type\s/.test(part.trim()))) {
      continue;
    }
    out.push(match[4]);
  }
  // Side-effectowy import (`import "x";`) krawędź TWORZY - i jest najbardziej
  // podstępną z możliwych, bo nie ma referencji, po której dałoby się go
  // znaleźć wzrokiem w kodzie.
  for (const match of source.matchAll(/(^|\n)\s*import\s*["']([^"']+)["']/g)) {
    out.push(match[2]);
  }
  return out;
}

const ECHARTS_SPECIFIER = /^echarts(\/|$)|^echarts-for-react(\/|$)|^zrender(\/|$)/;

describe("krawędź statyczna do ECharts", () => {
  it("WARTOŚCIOWO importuje ECharts DOKŁADNIE JEDEN plik w całym src/", () => {
    const offenders: string[] = [];

    for (const file of productionSources()) {
      const specifiers = valueImportSpecifiers(readFileSync(file, "utf8"));
      if (specifiers.some((s) => ECHARTS_SPECIFIER.test(s))) offenders.push(file);
    }

    expect(offenders).toEqual([CHART_MODULE]);
  });

  it("`EChart.tsx` NIE importuje statycznie modułu wykresu - to jest cała treść reguły", () => {
    const source = readFileSync(LAZY_BRIDGE, "utf8");
    const specifiers = valueImportSpecifiers(source);

    expect(specifiers.filter((s) => s.includes("EChartClient"))).toEqual([]);
    // A jednocześnie MUSI go wciągać leniwie - inaczej wykres nigdy się nie
    // pokaże, a test wyżej przechodziłby na pustym pliku.
    expect(source).toMatch(/import\(\s*["']\.\/EChartClient["']\s*\)/);
  });

  it("modułu wykresu nie importuje statycznie NIKT poza jego własnym mostem", () => {
    // Gdyby panel BI sięgnął po `EChartClient` z pominięciem `EChart`, most
    // przestałby cokolwiek chronić, a `EChart.tsx` nadal wyglądałby czysto.
    const offenders: string[] = [];

    for (const file of productionSources()) {
      if (file === CHART_MODULE) continue;
      const specifiers = valueImportSpecifiers(readFileSync(file, "utf8"));
      if (specifiers.some((s) => s.endsWith("EChartClient"))) offenders.push(file);
    }

    expect(offenders).toEqual([]);
  });

  it("moduł wykresu nadal JEST tym, za co go uważamy - reguła nie broni pustego pliku", () => {
    const specifiers = valueImportSpecifiers(readFileSync(CHART_MODULE, "utf8"));

    expect(specifiers).toContain("echarts-for-react/lib/core");
    expect(specifiers).toContain("echarts/core");
    // Modularna rejestracja zamiast `import "echarts"` (kiedyś ~590 KB gzip):
    // pełny pakiet unieważniłby cały ten podział.
    expect(specifiers).not.toContain("echarts");
  });

  it("wykrywacz importów NIE myli importu typów z wartościowym", () => {
    // Sonda samego narzędzia: gdyby `import type` liczyło się jako krawędź,
    // pierwszy przypadek zapalałby się na dziesięciu plikach panelu i ktoś
    // rozbroiłby całą regułę, żeby uciszyć fałszywy alarm.
    const probe = [
      'import type { A } from "echarts/core";',
      'import { type B, type C } from "echarts/charts";',
      'import D from "echarts-for-react/lib/core";',
      'import "echarts/renderers";',
      'const x = import("echarts/components");',
    ].join("\n");

    expect(valueImportSpecifiers(probe).sort()).toEqual([
      "echarts-for-react/lib/core",
      "echarts/renderers",
    ]);
  });
});
