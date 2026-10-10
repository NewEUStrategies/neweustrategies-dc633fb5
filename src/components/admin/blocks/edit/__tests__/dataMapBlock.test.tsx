// EDYTOR BLOKU MAPY DANYCH (`DataMapBlock`) - kontrakt PR2 (W6).
//
//   * siatka kraj - wartość, import, wklejenie i wybór skali barw zapisują
//     JEDNYM `onChange` (jeden krok cofania w historii bloku);
//   * tabela wklejona na kanwie przy zaznaczonym bloku trafia do podglądu
//     siatki (`useBlockTablePaste`), a nie do nowego bloku tabeli;
//   * odniesienia mapy: pochodzenie liczb, źródła, podpis, data danych, `n`,
//     trzy zdania - te same klocki co przy wykresie (`dataVizShared`);
//   * nowa mapa z rejestru startuje od klas (niebieski, 5 klas, kwantyle),
//     a treść bez tych kluczy zostaje skalą ciągłą (wygląd opublikowany);
//   * niezmienniki tabeli edytorów (`defineBlockEditMatrix`) dla tego bloku.
//
// GRANICE. Mocki i render niesie moduł wspólny tabeli edytorów, dlatego jego
// import jest PIERWSZY. Zasób geometrii serwuje `installWidgetGateFetch`
// z `public/geo` (nazwy krajów takie, jakie zobaczy autor).
import { describe, expect, it } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";

import { defineBlockEditMatrix, renderEditor } from "./blockEditMatrix.shared";
import type { Block, Json } from "@/lib/blocks/types";
import { BLOCK_SPECS } from "@/lib/blocks/registry";
import { parseDataMapConfig } from "@/lib/charts/parse";
import { readClipboardTable } from "@/lib/charts/clipboardTable";
import { installWidgetGateFetch } from "@/test/widgetGateEnvironment";
import { dispatchBlockTablePaste } from "@/components/admin/charts/blockTablePaste";
import { CHART_GRID_ATTR } from "@/components/admin/charts/gridKeyboard";
import { DataMapBlock } from "../DataVizBlocks";

installWidgetGateFetch();

function blok(data: Record<string, Json> = {}): Block {
  return {
    id: "blk-map",
    type: "data-map",
    data: {
      region: "europe",
      animate: false,
      values: [
        { id: "PL", value: 12 },
        { id: "DE", value: 30 },
      ],
      ...data,
    },
  };
}

function ostatnie(changes: readonly Block[]): Record<string, Json> {
  const last = changes.at(-1);
  if (!last) throw new Error("edytor nie zapisał niczego");
  return last.data;
}

const pole = (nazwa: string | RegExp) =>
  screen.getByRole("textbox", { name: nazwa }) as HTMLInputElement;

describe("rejestr - domyślne nowej mapy", () => {
  it("nowa mapa: niebieski, 5 klas, kwantyle", () => {
    const data = BLOCK_SPECS["data-map"].create().data;
    expect(data).toMatchObject({ scheme: "blue", classes: 5, method: "quantile" });
    const cfg = parseDataMapConfig(data);
    expect(cfg).toMatchObject({ scheme: "blue", classes: 5, method: "quantile" });
  });

  it("treść bez kluczy skali zostaje skalą ciągłą (wygląd opublikowanych map)", () => {
    expect(parseDataMapConfig({ values: [] })).toMatchObject({ scheme: "blue", classes: 0 });
  });
});

describe("siatka danych w bloku", () => {
  it("zatwierdzony kraj to JEDEN zapis; wiersze niedokończone zostają w treści", async () => {
    const { changes } = renderEditor(DataMapBlock, blok());
    // Skorowidz nazw regionu przychodzi z zasobu geometrii.
    const siatka = screen.getByRole("table", { name: "Dane mapy - kraj i wartość" });
    await within(siatka).findByText("Polska");
    const kod = pole("Kod albo nazwa kraju, wiersz 2");
    fireEvent.focus(kod);
    fireEvent.change(kod, { target: { value: "Czechy" } });
    fireEvent.blur(kod);
    expect(changes).toHaveLength(1);
    expect(ostatnie(changes).values).toEqual([
      { id: "PL", value: 12 },
      { id: "CZ", value: 30 },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Dodaj kraj" }));
    expect(changes).toHaveLength(2);
    expect(ostatnie(changes).values).toEqual([
      { id: "PL", value: 12 },
      { id: "DE", value: 30 },
      { id: "", value: null },
    ]);
  });

  it("nazwy krajów w języku DOKUMENTU, siatka jest celem Ctrl+Z historii bloku", async () => {
    const { container } = renderEditor(DataMapBlock, blok());
    const siatka = screen.getByRole("table", { name: "Dane mapy - kraj i wartość" });
    expect(await within(siatka).findByText("Polska")).toBeInTheDocument();
    expect(container.querySelector(`[${CHART_GRID_ATTR}]`)).not.toBeNull();
  });

  it("tabela wklejona na KANWIE przy zaznaczonym bloku otwiera podgląd; „Zastosuj” to jeden zapis", () => {
    const { changes } = renderEditor(DataMapBlock, blok());
    const table = readClipboardTable({ text: "Kraj\tWartość\nPL\t1\nFR\t2" });
    if (table === null) throw new Error("schowek bez tabeli");
    let przyjeta = false;
    act(() => {
      przyjeta = dispatchBlockTablePaste("blk-map", table);
    });
    expect(przyjeta).toBe(true);
    const okno = screen.getByRole("dialog", { name: "Wklejanie tabeli" });
    expect(changes).toHaveLength(0);
    fireEvent.click(within(okno).getByRole("button", { name: "Zastosuj" }));
    expect(changes).toHaveLength(1);
    expect(ostatnie(changes).values).toEqual([
      { id: "PL", value: 1 },
      { id: "FR", value: 2 },
    ]);
  });

  it("tabela ogłoszona dla INNEGO bloku nie jest przyjmowana", () => {
    renderEditor(DataMapBlock, blok());
    const table = readClipboardTable({ text: "a\tb\n1\t2" });
    if (table === null) throw new Error("schowek bez tabeli");
    expect(dispatchBlockTablePaste("inny-blok", table)).toBe(false);
  });
});

describe("skala barw w bloku", () => {
  it("schemat, liczba klas i metoda - każde jednym zapisem pod swoim kluczem", () => {
    const { changes } = renderEditor(DataMapBlock, blok({ classes: 5 }));
    fireEvent.click(screen.getByRole("radio", { name: /łupkowy/ }));
    expect(ostatnie(changes)).toMatchObject({ scheme: "slate" });
    fireEvent.change(screen.getByRole("combobox", { name: "Liczba klas" }), {
      target: { value: "0" },
    });
    expect(ostatnie(changes)).toMatchObject({ classes: 0 });
    expect(changes).toHaveLength(2);
  });

  it("metoda podziału przy klasach", () => {
    const { changes } = renderEditor(DataMapBlock, blok({ classes: 5 }));
    fireEvent.change(screen.getByRole("combobox", { name: "Metoda podziału" }), {
      target: { value: "equal" },
    });
    expect(ostatnie(changes)).toMatchObject({ method: "equal" });
  });

  it("środek skali rozbieżnej: przecinek dziesiętny; puste pole USUWA klucz", () => {
    const { changes } = renderEditor(DataMapBlock, blok({ scheme: "diverging", midpoint: 2 }));
    const srodek = pole(/Środek skali/);
    fireEvent.change(srodek, { target: { value: "0,5" } });
    expect(ostatnie(changes).midpoint).toBe(0.5);
    fireEvent.change(srodek, { target: { value: "" } });
    expect("midpoint" in ostatnie(changes)).toBe(false);
  });
});

describe("odniesienia mapy", () => {
  it("pochodzenie liczb, podpis, data danych, n, trzy zdania i źródła", () => {
    const { changes } = renderEditor(DataMapBlock, blok());
    fireEvent.change(screen.getByRole("textbox", { name: "Podpis pod mapą" }), {
      target: { value: "Dane za 2025 r." },
    });
    expect(ostatnie(changes).caption).toBe("Dane za 2025 r.");
    fireEvent.click(screen.getByRole("button", { name: "Dodaj źródło" }));
    const zrodla = ostatnie(changes).sources;
    expect(Array.isArray(zrodla) && zrodla.length).toBe(1);
    expect(screen.getByRole("combobox", { name: "Pochodzenie liczb" })).toBeInTheDocument();
  });
});

defineBlockEditMatrix([["DataMapBlock", DataMapBlock, "data-map"]]);
