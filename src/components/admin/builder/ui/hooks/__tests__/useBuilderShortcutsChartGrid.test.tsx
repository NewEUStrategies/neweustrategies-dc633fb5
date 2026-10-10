// SKRÓTY BUILDERA W ARKUSZU DANYCH WYKRESU (kontrakt PR2, „DataGrid
// behaviour" 6).
//
// Arkusz widgetu odkłada zapis pisanej etykiety o kilkadziesiąt milisekund.
// Ctrl+Z wciśnięty w tym oknie cofnąłby zmianę SPRZED niej, a odłożony zapis
// wróciłby zaraz potem. Dlatego skrót cofania (i ponowienia) najpierw wysyła
// zdarzenie opróżnienia na korzeń siatki, w której stoi fokus - i dopiero
// potem woła historię buildera. Poza siatką nic się nie zmienia.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { useBuilderShortcuts } from "../useBuilderShortcuts";
import { GRID_FLUSH_EVENT } from "@/components/admin/charts/gridKeyboard";

function Host({ undo, redo }: { undo: () => void; redo: () => void }) {
  useBuilderShortcuts({
    selection: { kind: null, id: null },
    setSelection: () => {},
    undo,
    redo,
    copySelection: () => {},
    cutSelection: () => {},
    pasteFromClipboard: () => {},
    duplicateSection: () => {},
    duplicateColumn: () => {},
    duplicateWidget: () => {},
    askRemoveSection: () => {},
    askRemoveColumn: () => {},
    askRemoveWidget: () => {},
    moveSection: () => {},
  });
  return (
    <>
      <div data-chart-grid="">
        <input aria-label="komórka" />
      </div>
      <input aria-label="poza siatką" />
    </>
  );
}

function zamontuj() {
  const kolejnosc: string[] = [];
  const undo = vi.fn(() => kolejnosc.push("undo"));
  const redo = vi.fn(() => kolejnosc.push("redo"));
  const view = render(<Host undo={undo} redo={redo} />);
  const grid = view.container.querySelector("[data-chart-grid]");
  grid?.addEventListener(GRID_FLUSH_EVENT, () => kolejnosc.push("flush"));
  return { kolejnosc, undo, redo, ...view };
}

describe("useBuilderShortcuts - arkusz danych wykresu", () => {
  it("Ctrl+Z w komórce: najpierw opróżnienie siatki, potem cofnięcie", () => {
    const { kolejnosc, getByLabelText } = zamontuj();
    fireEvent.keyDown(getByLabelText("komórka"), { key: "z", ctrlKey: true });
    expect(kolejnosc).toEqual(["flush", "undo"]);
  });

  it("Ctrl+Shift+Z i Ctrl+Y w komórce: opróżnienie przed ponowieniem", () => {
    const { kolejnosc, getByLabelText } = zamontuj();
    fireEvent.keyDown(getByLabelText("komórka"), { key: "Z", ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(getByLabelText("komórka"), { key: "y", ctrlKey: true });
    expect(kolejnosc).toEqual(["flush", "redo", "flush", "redo"]);
  });

  it("poza siatką cofnięcie działa jak dotąd, bez zdarzenia opróżnienia", () => {
    const { kolejnosc, getByLabelText } = zamontuj();
    fireEvent.keyDown(getByLabelText("poza siatką"), { key: "z", ctrlKey: true });
    expect(kolejnosc).toEqual(["undo"]);
  });
});
