// POLA WIDGETU WYKRESU IDĄ ZA RYSUNKIEM RODZAJU (PR2).
//
// PO CO. Panel widgetu oferował cel i pasmo optimum każdemu rodzajowi,
// a rysuje je tylko rysownik kartezjański (`KIND_CAPS.band`/`.target`).
// Wybór palety stał też przy mostku, mapie ciepła i tornadzie, gdzie kolor
// koduje znak albo wartość (`KIND_CAPS.palette`), a granica prognozy przy
// indeksie, którego rysownik `forecastFrom` nie czyta. Autor wpisywał wartość
// i nie widział nic - bez słowa, dlaczego - a edytor bloku CMS te same pola
// już chował, więc dwie powierzchnie mówiły co innego.
//
// PODZIAŁ DOWODU. Bramka `src/lib/charts/__tests__/kindCaps.test.tsx`
// dowodzi RENDEREM, że flagi mówią prawdę o rysunku; ten plik dowodzi, że
// panel czyta TE flagi. Razem: pole jest w panelu dokładnie tam, gdzie rysunek
// go używa. Prognoza nie ma flagi w tabeli, więc jej zbiór rodzajów stoi tu
// jawnie, z adresem rysownika, a indeks ma własny dowód renderem.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { Json } from "@/lib/content-model/json";
import { WIDGET_SCHEMAS } from "../schemas";
import { CHART_KINDS, type ChartKind } from "@/lib/charts/types";
import { KIND_CAPS } from "@/lib/charts/kindCaps";
import { parseChartConfig } from "@/lib/charts/parse";
import { Chart } from "@/components/charts/Chart";

afterEach(cleanup);

/** Czy panel pokazuje pole przy tej treści (pole bez warunku jest zawsze). */
function widoczne(key: string, content: Record<string, unknown>): boolean {
  const field = (WIDGET_SCHEMAS.chart ?? []).find((f) => f.key === key);
  if (!field) throw new Error(`brak pola "${key}" w schemacie widgetu "chart"`);
  return field.visibleWhen ? field.visibleWhen(content) : true;
}

const PRZYPIS_PASMA = [
  "bandSourceAuthor",
  "bandSourceTitle",
  "bandSourceContainer",
  "bandSourcePublisher",
  "bandSourcePublished",
  "bandSourceAccessed",
  "bandSourceUrl",
  "bandSourceReliability",
] as const;

/**
 * Kto czyta `forecastFrom`: `CartesianChart` (strefa i linia granicy, nota
 * „prognoza” w tooltipie - słupki poziome bez strefy, ale z notą i kolumną
 * tabeli `SeriesDataTable`) oraz wachlarz (`fanChart.ts`). Indeks bazy 100
 * nie czyta go wcale (`indexBase.ts`: okres bazowy jest jawnym wyborem, nie
 * granicą prognozy). Mapa wyczerpująca po `ChartKind`, więc nowy rodzaj nie
 * skompiluje się bez deklaracji.
 */
const RYSUJE_PROGNOZE: Record<ChartKind, boolean> = {
  line: true,
  area: true,
  bar: true,
  "bar-horizontal": true,
  waterfall: true,
  pie: false,
  donut: false,
  histogram: false,
  boxplot: false,
  beeswarm: false,
  scatter: false,
  heatmap: false,
  tornado: false,
  fan: true,
  "index-base": false,
  "percent-stacked": false,
  "small-multiples": false,
};

describe("widget wykresu - pole jest w panelu tam, gdzie rodzaj je rysuje", () => {
  for (const kind of CHART_KINDS) {
    const caps = KIND_CAPS[kind];

    it(`${kind}: paleta ${caps.palette ? "JEST" : "NIE jest"} w panelu (KIND_CAPS.palette)`, () => {
      expect(widoczne("palette", { kind })).toBe(caps.palette);
    });

    it(`${kind}: linia celu ${caps.target ? "JEST" : "NIE jest"} w panelu (KIND_CAPS.target)`, () => {
      expect(widoczne("target", { kind })).toBe(caps.target);
    });

    it(`${kind}: pasmo optimum i jego przypis ${caps.band ? "SĄ" : "NIE są"} w panelu (KIND_CAPS.band)`, () => {
      const zPasmem = { kind, bandMin: "10", bandMax: "20" };
      expect(widoczne("bandMin", zPasmem)).toBe(caps.band);
      expect(widoczne("bandMax", zPasmem)).toBe(caps.band);
      for (const key of PRZYPIS_PASMA) expect(widoczne(key, zPasmem), key).toBe(caps.band);
    });

    it(`${kind}: granica prognozy ${RYSUJE_PROGNOZE[kind] ? "JEST" : "NIE jest"} w panelu`, () => {
      expect(widoczne("forecastFrom", { kind })).toBe(RYSUJE_PROGNOZE[kind]);
    });
  }
});

describe("indeks bazy 100 - granica prognozy nie zmienia rysunku", () => {
  const dane = (kind: ChartKind, extra: Record<string, Json> = {}): Record<string, Json> => ({
    kind,
    categories: ["2019", "2020", "2021", "2022", "2023"],
    series: [
      { name: "A", values: [10, 12, 14, 13, 15] },
      { name: "B", values: [20, 21, 23, 25, 27] },
    ],
    animate: false,
    ...extra,
  });

  /**
   * Znaczniki rysunku bez identyfikatorów `useId` - ten sam wykres
   * wyrenderowany drugi raz dostaje inne, choć niczym się nie różni.
   */
  function znaczniki(kind: ChartKind, extra: Record<string, Json> = {}): string {
    const { container, unmount } = render(
      <Chart config={parseChartConfig(dane(kind, extra))} lang="pl" />,
    );
    const html = container.innerHTML.replace(/«r[0-9a-z]+»|:r[0-9a-z]+:|_r_[0-9a-z]+_/g, "#id");
    unmount();
    return html;
  }

  it("index-base rysuje to samo z granicą prognozy i bez niej - pole byłoby bez skutku", () => {
    expect(znaczniki("index-base", { forecastFrom: 3 })).toBe(znaczniki("index-base"));
  });

  it("kontrola porównania: linia z granicą prognozy rysuje się inaczej", () => {
    expect(znaczniki("line", { forecastFrom: 3 })).not.toBe(znaczniki("line"));
  });
});
