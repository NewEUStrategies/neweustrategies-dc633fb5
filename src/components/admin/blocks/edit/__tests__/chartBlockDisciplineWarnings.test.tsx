// EDYTOR BLOKU WYKRESU - OSTRZEŻENIA DYSCYPLINY obok podglądu.
//
// PO CO. Reguły doboru formy i palety, których kod nie może wymusić (mają
// wyjątki), edytor mówi autorowi ostrzeżeniem nad formą - liczonym z TEGO
// SAMEGO configu, który rysuje podgląd. `chartFormAdvice.test.tsx` dowodzi
// zaleceń formy (`advice.*`); tu są pozostałe ostrzeżenia: za dużo serii dla
// palety rozdzielnej, za dużo wycinków tarczy, udziały nieodróżnialne na
// pierścieniu, kolor serii kolidujący ze znakiem na mostku, prognoza bez
// pasma niepewności - oraz zgłoszenie obciętej wklejki w podglądzie tabeli.
// Żadne z nich nie miało dowodu, że w ogóle się pojawia.
//
// KAŻDY PRZYPADEK MA PARĘ: ten sam blok bez warunku NIE dostaje ostrzeżenia.
// Ostrzeżenie widoczne zawsze uczy ignorowania wszystkich ostrzeżeń.
//
// GRANICE. Mocki i render niesie moduł wspólny tabeli edytorów, dlatego jego
// import jest PIERWSZY. i18n PRAWDZIWE - asercje idą po polskim zdaniu.
import { describe, expect, it } from "vitest";
import { act, screen, within } from "@testing-library/react";

import { renderEditor } from "./blockEditMatrix.shared";
import type { Block, Json } from "@/lib/blocks/types";
import { dispatchBlockTablePaste } from "@/components/admin/charts/blockTablePaste";
import { ChartBlock } from "../DataVizBlocks";

function wykres(data: Record<string, Json>): Block {
  return { id: "blk-chart-warn", type: "chart", data: { animate: false, ...data } };
}

function serie(n: number, values: number[]): Json[] {
  return Array.from({ length: n }, (_, i) => ({ name: `S${i + 1}`, values }));
}

/** Ostrzeżenie widoczne dla wskazanego bloku albo `null`. */
function ostrzezenie(b: Block, tekst: RegExp): HTMLElement | null {
  const widok = renderEditor(ChartBlock, b);
  const znalezione = screen.queryByText(tekst);
  widok.unmount();
  return znalezione;
}

describe("ostrzeżenia dyscypliny", () => {
  it("więcej serii niż paleta rozdzielna dla daltonizmu (6) - ostrzeżenie; 6 serii - nie", () => {
    const tekst = /Powyżej 6 kolorów kategorialnych/;
    const dane = { kind: "line", categories: ["a", "b"] };
    expect(ostrzezenie(wykres({ ...dane, series: serie(7, [1, 2]) }), tekst)).not.toBeNull();
    expect(ostrzezenie(wykres({ ...dane, series: serie(6, [1, 2]) }), tekst)).toBeNull();
  });

  it("tarcza z więcej niż 5 kategoriami - ostrzeżenie; te same kategorie na słupkach - nie", () => {
    const tekst = /Tarcza powyżej 5 kategorii/;
    const dane = {
      categories: ["a", "b", "c", "d", "e", "f", "g"],
      series: serie(1, [30, 20, 15, 12, 10, 8, 5]),
    };
    expect(ostrzezenie(wykres({ ...dane, kind: "pie" }), tekst)).not.toBeNull();
    expect(ostrzezenie(wykres({ ...dane, kind: "bar" }), tekst)).toBeNull();
  });

  it("pierścień z udziałami różniącymi się o mniej niż 3 pp - ostrzeżenie; wyraźne udziały - nie", () => {
    const tekst = /Udziały różnią się o mniej niż 3 punkty procentowe/;
    const dane = { kind: "donut", categories: ["a", "b", "c", "d"] };
    expect(
      ostrzezenie(wykres({ ...dane, series: serie(1, [26, 25, 30, 19]) }), tekst),
    ).not.toBeNull();
    expect(ostrzezenie(wykres({ ...dane, series: serie(1, [10, 20, 30, 40]) }), tekst)).toBeNull();
  });

  it("mostek z serią w kolorze kolidującym ze znakiem (terakota) - ostrzeżenie; słupki - nie", () => {
    // Wodospad koduje znak czerwienią; na zwykłych kolumnach ta reguła nie
    // obowiązuje, więc krzyczenie o niej byłoby szumem.
    const tekst = /terakota \(slot 6\) nie może być na nim kategorią/;
    const dane = {
      categories: ["Start", "Zmiana", "Koniec"],
      series: [{ name: "EBITDA", values: [100, -20, 80], colorSlot: 6 }],
    };
    expect(ostrzezenie(wykres({ ...dane, kind: "waterfall" }), tekst)).not.toBeNull();
    expect(ostrzezenie(wykres({ ...dane, kind: "bar" }), tekst)).toBeNull();
  });

  it("prognoza bez pasma niepewności - ostrzeżenie; z pasmem ±10% - nie", () => {
    const tekst = /Prognoza bez pasma niepewności/;
    const dane = {
      kind: "line",
      categories: ["2024", "2025", "2026"],
      series: serie(1, [1, 2, 3]),
      forecastFrom: 1,
    };
    expect(ostrzezenie(wykres(dane), tekst)).not.toBeNull();
    expect(ostrzezenie(wykres({ ...dane, forecastBandPct: 10 }), tekst)).toBeNull();
  });
});

describe("wklejka tabeli na kanwie", () => {
  it("OBCIĘTA tabela otwiera podgląd ze zgłoszeniem obcięcia - autor wie, że wczytano początek", () => {
    renderEditor(ChartBlock, wykres({ categories: ["a"], series: serie(1, [1]) }));
    act(() => {
      dispatchBlockTablePaste("blk-chart-warn", {
        rows: [
          ["", "S1"],
          ["2024", "1"],
        ],
        source: "tsv",
        cells: 4,
        truncated: true,
      });
    });
    const okno = screen.getByRole("dialog", { name: "Wklejanie tabeli" });
    expect(
      within(okno).getByText("Wklejone dane przekraczają limit - wczytano tylko ich początek."),
    ).toBeInTheDocument();
  });

  it("tabela NIEOBCIĘTA nie dostaje zgłoszenia obcięcia", () => {
    renderEditor(ChartBlock, wykres({ categories: ["a"], series: serie(1, [1]) }));
    act(() => {
      dispatchBlockTablePaste("blk-chart-warn", {
        rows: [
          ["", "S1"],
          ["2024", "1"],
        ],
        source: "tsv",
        cells: 4,
        truncated: false,
      });
    });
    const okno = screen.getByRole("dialog", { name: "Wklejanie tabeli" });
    expect(within(okno).queryByText(/przekraczają limit/)).toBeNull();
  });
});
