// SYSTEM WYKRESÓW / ODNIESIENIA W EDYTORZE BLOKU - kontrakt ZAPISU.
//
// PO CO. Tabela edytorów (`blockEditMatrix`) dowodzi niezmienników ogólnych:
// zapis nie gubi `id`, nie wpisuje `undefined`, lista wyboru nie pokazuje
// wartości spoza opcji. Nie wie natomiast, JAKI KSZTAŁT ma mieć zapis tej
// sekcji, a to on decyduje, czy wykres narysuje cel i pasmo:
//   * cel to `{ value: liczba }` albo BRAK klucza - nie `{ value: null }`,
//   * przecinek dziesiętny jest liczbą, nie śmieciem,
//   * nowe źródło dostaje JAWNY identyfikator (pasmo musi na coś wskazać),
//   * usunięcie źródła, na które wskazuje pasmo, zdejmuje wskazanie w tym
//     samym zapisie.
//
// GRANICE. Mocki i render niesie moduł wspólny tabeli edytorów, dlatego jego
// import jest PIERWSZY. i18n jest PRAWDZIWE (polski panel) - asercje na
// tekście ostrzeżeń sprawdzają przy okazji, że klucze istnieją w słowniku.
import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";

import { renderEditor } from "./blockEditMatrix.shared";
import type { Block, Json } from "@/lib/blocks/types";
import { ChartBlock } from "../DataVizBlocks";

function blok(data: Record<string, Json>): Block {
  return {
    id: "blk-chart-ref",
    type: "chart",
    data: {
      animate: false,
      categories: ["2024", "2025"],
      series: [{ name: "Marża", values: [2, 3] }],
      ...data,
    },
  };
}

const TARGET = "Linia celu - wartość (puste = brak)";
const BAND_WITHOUT_SOURCE = "Pasmo bez źródła nie zostanie narysowane";

function lastData(changes: readonly Block[]): Record<string, Json> {
  const last = changes.at(-1);
  if (!last) throw new Error("edytor nie zapisał niczego");
  return last.data;
}

describe("edytor bloku wykresu - system wykresów / odniesienia", () => {
  it("cel zapisuje `{ value }` z przecinkiem dziesiętnym, a pusty wpis USUWA klucz", () => {
    const { changes } = renderEditor(ChartBlock, blok({ target: { value: 5 } }));
    const pole = screen.getByRole("textbox", { name: TARGET });
    expect((pole as HTMLInputElement).value).toBe("5");

    fireEvent.change(pole, { target: { value: "2,5" } });
    expect(lastData(changes).target).toEqual({ value: 2.5 });

    fireEvent.change(pole, { target: { value: "" } });
    expect("target" in lastData(changes)).toBe(false);
  });

  it("wpis niebędący liczbą nie zostawia STAREGO celu pod polem", () => {
    // Podgląd nad formą ma pokazywać to, co narysuje wykres - a wpis „abc"
    // nie narysuje żadnej linii.
    const { changes } = renderEditor(ChartBlock, blok({ target: { value: 5 } }));
    fireEvent.change(screen.getByRole("textbox", { name: TARGET }), {
      target: { value: "abc" },
    });
    expect("target" in lastData(changes)).toBe(false);
  });

  it("pasmo bez źródła i bez flagi demo dostaje ostrzeżenie „brak benchmarku”", () => {
    const { container } = renderEditor(ChartBlock, blok({ band: { min: 2, max: 4 } }));
    expect(container.textContent).toContain(BAND_WITHOUT_SOURCE);
  });

  it("pasmo demonstracyjne i pasmo ze źródłem z listy NIE dostają ostrzeżenia", () => {
    const demo = renderEditor(ChartBlock, blok({ band: { min: 2, max: 4, demo: true } }));
    expect(demo.container.textContent).not.toContain(BAND_WITHOUT_SOURCE);
    demo.unmount();

    const zrodlo = renderEditor(
      ChartBlock,
      blok({
        band: { min: 2, max: 4, sourceId: "s1" },
        sources: [{ id: "s1", author: "Eurostat", title: "Raport", url: "" }],
      }),
    );
    expect(zrodlo.container.textContent).not.toContain(BAND_WITHOUT_SOURCE);
  });

  it("krawędź pasma zapisuje cały obiekt pasma, zachowując źródło i flagę demo", () => {
    const { changes } = renderEditor(
      ChartBlock,
      blok({ band: { min: 2, max: 4, sourceId: "s1", demo: true } }),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Pasmo optimum - od" }), {
      target: { value: "1,5" },
    });
    expect(lastData(changes).band).toEqual({ min: 1.5, max: 4, sourceId: "s1", demo: true });
  });

  it("nowe źródło dostaje jawny, wolny identyfikator", () => {
    const { changes } = renderEditor(
      ChartBlock,
      blok({ sources: [{ id: "s2", title: "Pierwsze" }] }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Dodaj źródło" }));
    const sources = lastData(changes).sources;
    expect(Array.isArray(sources)).toBe(true);
    const ids = (sources as Json[]).map((s) => (s as Record<string, Json>).id);
    // `s2` jest zajęte, więc nowy wiersz nie może dostać tego samego.
    expect(ids).toEqual(["s2", "s3"]);
  });

  it("pole źródła zapisuje się pod swoim kluczem bibliograficznym", () => {
    const { changes } = renderEditor(ChartBlock, blok({ sources: [{ id: "s1", title: "" }] }));
    fireEvent.change(screen.getByRole("textbox", { name: "Wydawca" }), {
      target: { value: "Urząd Publikacji UE" },
    });
    const [zrodlo] = lastData(changes).sources as Json[];
    expect(zrodlo).toMatchObject({ id: "s1", publisher: "Urząd Publikacji UE" });
  });

  it("usunięcie źródła, na które wskazuje pasmo, zdejmuje wskazanie W TYM SAMYM zapisie", () => {
    const { changes } = renderEditor(
      ChartBlock,
      blok({
        band: { min: 2, max: 4, sourceId: "s1" },
        sources: [{ id: "s1", title: "Raport" }],
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Usuń źródło Raport" }));
    expect(changes).toHaveLength(1);
    const data = lastData(changes);
    expect("sources" in data).toBe(false);
    expect(data.band).toEqual({ min: 2, max: 4, sourceId: "", demo: false });
  });

  it("podpowiedź palety ról stoi przy arkuszu tylko w palecie `focus`", () => {
    const hint = "Kolory daje paleta ról";
    const focus = renderEditor(ChartBlock, blok({}));
    expect(focus.container.textContent).toContain(hint);
    expect(focus.container.textContent).not.toContain("{{");
    focus.unmount();

    const categorical = renderEditor(ChartBlock, blok({ palette: "categorical" }));
    expect(categorical.container.textContent).not.toContain(hint);
  });

  it("podpis jako OBIEKT nie wchodzi do pola jako „[object Object]”", () => {
    renderEditor(ChartBlock, blok({ caption: { pl: "Podpis" } }));
    const pole = screen.getByRole("textbox", { name: "Podpis pod wykresem (opcjonalny)" });
    expect((pole as HTMLTextAreaElement).value).toBe("");
  });
});
