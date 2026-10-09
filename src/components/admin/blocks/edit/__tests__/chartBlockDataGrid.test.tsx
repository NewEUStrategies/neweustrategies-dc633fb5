// EDYTOR BLOKU WYKRESU - arkusz danych, kolory i wklejanie (PR2).
//
// Blok CMS ma te same możliwości co arkusz widgetu buildera (wspólna siatka
// `ChartDataGrid`), a ten plik dowodzi PODŁĄCZENIA do treści bloku:
//   * każde działanie w arkuszu to JEDEN `onChange` (jeden krok cofania),
//   * seria wyróżniona i kolory zapisują się w treści bloku i idą za serią,
//   * tabela wklejona na kanwie w zaznaczony blok trafia do podglądu tego
//     bloku (`dispatchBlockTablePaste`), a nie do nowego bloku tabeli,
//   * podgląd wykresu mówi językiem DOKUMENTU i reaguje na kursor.
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { Block } from "@/lib/blocks/types";
import { BlockEditorProvider } from "../../BlockEditorContext";
import { ChartBlock } from "../DataVizBlocks";
import { dispatchBlockTablePaste } from "@/components/admin/charts/blockTablePaste";

vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(React);
});

vi.mock("@/components/charts/Chart", () => ({
  Chart: ({ lang }: { lang: string }) => <div data-testid="podglad" data-lang={lang} />,
}));

function blok(data: Record<string, unknown> = {}): Block {
  return {
    id: "blk-wykres",
    type: "chart",
    data: {
      kind: "bar",
      categories: ["2023", "2024"],
      series: [
        { name: "Eksport", values: [10, 12], colorSlot: 3 },
        { name: "Import", values: [5, 8], colorSlot: 4 },
      ],
      ...data,
    } as Block["data"],
  };
}

function zamontuj(b: Block = blok(), lang: "pl" | "en" = "pl") {
  const changes: Block[] = [];
  const view = render(
    <BlockEditorProvider lang={lang}>
      <ChartBlock block={b} onChange={(next) => changes.push(next)} />
    </BlockEditorProvider>,
  );
  return { changes, ...view };
}

function wklej(cel: Element, text: string) {
  const ev = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", {
    value: { getData: (typ: string) => (typ === "text/plain" ? text : "") },
  });
  act(() => {
    cel.dispatchEvent(ev);
  });
}

describe("podgląd wykresu w edytorze bloku", () => {
  it("mówi językiem dokumentu, nie panelu, i nie jest wyłączony z kursora", () => {
    const { container } = zamontuj(blok(), "en");
    const podglad = screen.getByTestId("podglad");
    expect(podglad.dataset.lang).toBe("en");
    expect(podglad.closest(".pointer-events-none")).toBeNull();
    expect(container.querySelector("[data-chart-grid]")).not.toBeNull();
  });
});

describe("arkusz danych bloku - jeden zapis na działanie", () => {
  it("zakres wklejony w komórkę to jeden `onChange` z nowymi danymi", () => {
    const { changes } = zamontuj();
    wklej(screen.getByRole("textbox", { name: "2024 - Eksport" }), "20\t30\n40\t50");
    expect(changes).toHaveLength(1);
    expect(changes[0].data.categories).toEqual(["2023", "2024", "3"]);
    expect(changes[0].data.series).toEqual([
      { name: "Eksport", values: [10, 20, 40], colorSlot: 3 },
      { name: "Import", values: [5, 30, 50], colorSlot: 4 },
    ]);
  });

  it("seria wyróżniona zapisuje się w treści, a pierwsza seria zdejmuje klucz", () => {
    const { changes } = zamontuj(blok({ accentSeries: 1 }));
    const lista = screen.getByRole("combobox", { name: "Seria wyróżniona" });
    expect((lista as HTMLSelectElement).value).toBe("1");
    fireEvent.change(lista, { target: { value: "0" } });
    expect(changes).toHaveLength(1);
    expect("accentSeries" in changes[0].data).toBe(false);
  });

  it("przesunięcie serii zabiera kolor i wyróżnienie", () => {
    const { changes } = zamontuj(blok({ accentSeries: 1, palette: "categorical" }));
    fireEvent.click(screen.getByRole("button", { name: "Działania na serii Import" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Przesuń w lewo" }));
    expect(changes).toHaveLength(1);
    const series = changes[0].data.series as Array<{ name: string; colorSlot: number }>;
    expect(series.map((s) => [s.name, s.colorSlot])).toEqual([
      ["Import", 4],
      ["Eksport", 3],
    ]);
    // Pod paletą kategorialną akcent nie jest rysowany, ale zostaje przy
    // serii - po powrocie do palety ról wyróżniona jest ta sama seria.
    expect("accentSeries" in changes[0].data).toBe(false);
  });

  it("wybór palety stoi przy arkuszu tylko dla rodzajów, w których paleta coś zmienia", () => {
    zamontuj(blok({ kind: "line" }));
    expect(screen.getByRole("combobox", { name: "Paleta kolorów" })).toBeInTheDocument();
  });
});

describe("tabela wklejona na kanwie w zaznaczony blok wykresu", () => {
  it("edytor bloku przyjmuje tabelę, pokazuje podgląd i zastępuje dane jednym zapisem", () => {
    const { changes } = zamontuj(blok({ palette: "categorical" }));
    let przyjeta = false;
    act(() => {
      przyjeta = dispatchBlockTablePaste("blk-wykres", {
        rows: [
          ["", "Import", "Nowa"],
          ["2021", "1", "2"],
        ],
        source: "tsv",
        cells: 6,
        truncated: false,
      });
    });
    expect(przyjeta).toBe(true);
    expect(screen.getByRole("dialog", { name: "Wklejanie tabeli" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Zastosuj" }));
    expect(changes).toHaveLength(1);
    const series = changes[0].data.series as Array<{ name: string; colorSlot: number }>;
    expect(series.map((s) => s.name)).toEqual(["Import", "Nowa"]);
    expect(series[0].colorSlot).toBe(4);
    expect(changes[0].data.categories).toEqual(["2021"]);
  });

  it("tabela dla INNEGO bloku nie jest przyjmowana", () => {
    zamontuj();
    let przyjeta = true;
    act(() => {
      przyjeta = dispatchBlockTablePaste("inny-blok", {
        rows: [["a", "1"]],
        source: "tsv",
        cells: 2,
        truncated: false,
      });
    });
    expect(przyjeta).toBe(false);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
