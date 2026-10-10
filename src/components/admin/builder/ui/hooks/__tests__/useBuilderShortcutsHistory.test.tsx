// SKRÓTY BUILDERA + PRAWDZIWA HISTORIA - Ctrl+Z w arkuszu danych wykresu.
//
// Arkusz odkłada zapis pisanej etykiety. Ctrl+Z najpierw go opróżnia
// (zdarzenie na korzeniu siatki), a dopiero potem cofa. Zapis opróżniony
// TERAZ wchodzi do historii przez stan Reacta, więc `undo` z renderu
// sprzed klawisza go nie widzi: gdy był to pierwszy krok, `canUndo` było
// jeszcze fałszem i Ctrl+Z tylko zapisywał etykietę; w innych razach
// komunikat nazywał krok wcześniejszy. Ten test składa skróty z PRAWDZIWYM
// `useHistory` i strażnikiem `canUndo` takim jak w `Builder.tsx`.
import { describe, expect, it } from "vitest";
import { useCallback, useEffect, useRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { useHistory } from "@/hooks/useHistory";
import { useBuilderShortcuts } from "../useBuilderShortcuts";
import { GRID_FLUSH_EVENT, type GridFlushDetail } from "@/components/admin/charts/gridKeyboard";

interface Stan {
  label: string;
}

function Host({ cofniete }: { cofniete: (string | null)[] }) {
  const history = useHistory<Stan>({ label: "2023" });
  const { canUndo, lastLabel, undo: historyUndo, redo: historyRedo, canRedo } = history;
  // Strażnik jak w `Builder.tsx`: domknięcie czyta `canUndo` i etykietę z renderu.
  const undo = useCallback(() => {
    if (!canUndo) return;
    cofniete.push(lastLabel);
    historyUndo();
  }, [canUndo, lastLabel, historyUndo, cofniete]);
  const redo = useCallback(() => {
    if (canRedo) historyRedo();
  }, [canRedo, historyRedo]);
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

  // Siatka z ODŁOŻONYM zapisem etykiety (jak arkusz widgetu).
  const gridRef = useRef<HTMLDivElement | null>(null);
  const pending = useRef<string | null>(null);
  const set = history.set;
  useEffect(() => {
    const el = gridRef.current;
    if (el === null) return;
    const h = (e: Event) => {
      if (pending.current === null) return;
      const label = pending.current;
      pending.current = null;
      set({ label }, { label: "Etykieta kategorii", coalesceKey: "w:chart" });
      (e as CustomEvent<GridFlushDetail>).detail.flushed = true;
    };
    el.addEventListener(GRID_FLUSH_EVENT, h);
    return () => el.removeEventListener(GRID_FLUSH_EVENT, h);
  }, [set]);

  return (
    <>
      <div data-chart-grid="" ref={gridRef}>
        <input
          aria-label="komórka"
          onChange={(e) => {
            pending.current = e.target.value;
          }}
        />
      </div>
      <output aria-label="stan">{history.state.label}</output>
    </>
  );
}

describe("useBuilderShortcuts - opróżnienie arkusza i prawdziwa historia", () => {
  it("pierwsza edycja: jedno Ctrl+Z zapisuje odłożoną etykietę i ją cofa", () => {
    const cofniete: (string | null)[] = [];
    render(<Host cofniete={cofniete} />);
    const pole = screen.getByLabelText("komórka");
    fireEvent.change(pole, { target: { value: "2022" } });
    expect(screen.getByLabelText("stan").textContent).toBe("2023");
    fireEvent.keyDown(pole, { key: "z", ctrlKey: true });
    expect(screen.getByLabelText("stan").textContent).toBe("2023");
    // Komunikat nazywa krok, który został cofnięty - opróżniony przed chwilą.
    expect(cofniete).toEqual(["Etykieta kategorii"]);
  });

  it("drugie Ctrl+Z (nic odłożonego, historia pusta) nic nie cofa; Ctrl+Y przywraca etykietę", () => {
    const cofniete: (string | null)[] = [];
    render(<Host cofniete={cofniete} />);
    const pole = screen.getByLabelText("komórka");
    fireEvent.change(pole, { target: { value: "2022" } });
    fireEvent.keyDown(pole, { key: "z", ctrlKey: true });
    fireEvent.keyDown(pole, { key: "z", ctrlKey: true });
    // Drugie Ctrl+Z nie ma już czego cofać - historia jest pusta.
    expect(cofniete).toEqual(["Etykieta kategorii"]);
    fireEvent.keyDown(pole, { key: "y", ctrlKey: true });
    expect(screen.getByLabelText("stan").textContent).toBe("2022");
  });
});
