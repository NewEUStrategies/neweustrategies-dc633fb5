// ARKUSZ DANYCH WIDGETU - ZAMKNIĘCIE NIE GUBI WPISANEJ LICZBY.
//
// Komórka liczby trzyma szkic i zatwierdza go przy utracie fokusu, Enterze
// albo Tabie. Escape zamyka okno z fokusem wciąż w komórce, a pole znika po
// animacji wyjścia BEZ utraty fokusu - wpisana liczba przepadała, a widget
// zostawał ze starą wartością. Zamknięcie najpierw zatwierdza szkic komórki,
// potem wysyła odłożony zapis etykiet.
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ContentPatch } from "@/lib/builder/schemas";
import { ChartDataSpreadsheetDialog } from "../ChartDataSpreadsheetDialog";

vi.mock("@/components/charts/Chart", () => ({
  Chart: () => <div data-testid="podglad" />,
}));
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(React);
});

const CSV = "; Eksport; Import; Saldo\n2023; 1; 2; 3\n2024; 4; 5; 6";

function zamontuj() {
  const patches: ContentPatch[] = [];
  function Host() {
    const [content, setContent] = useState<Record<string, unknown>>({ data: CSV, kind: "bar" });
    return (
      <ChartDataSpreadsheetDialog
        value={String(content.data ?? "")}
        onChange={() => {}}
        content={content}
        lang="pl"
        setContentPatch={(p) => {
          patches.push(p);
          setContent((c) => ({ ...c, ...p }));
        }}
      />
    );
  }
  render(<Host />);
  fireEvent.click(screen.getByRole("button", { name: "Otwórz arkusz" }));
  return { patches };
}

describe("arkusz widgetu - zamknięcie z niezatwierdzoną liczbą", () => {
  it("Escape zapisuje wpisaną liczbę przed zamknięciem", () => {
    const { patches } = zamontuj();
    const pole = screen.getByRole("textbox", { name: "2023 - Eksport" });
    pole.focus();
    fireEvent.change(pole, { target: { value: "42" } });
    expect(patches).toHaveLength(0);
    fireEvent.keyDown(pole, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(patches).toHaveLength(1);
    expect(patches[0].data).toContain("2023; 42; 2; 3");
  });

  it("wpis, który liczbą nie jest, niczego nie zapisuje (komórka go zgłasza, treść trzyma starą liczbę)", () => {
    const { patches } = zamontuj();
    const pole = screen.getByRole("textbox", { name: "2023 - Eksport" });
    pole.focus();
    fireEvent.change(pole, { target: { value: "abc" } });
    fireEvent.keyDown(pole, { key: "Escape" });
    expect(patches).toHaveLength(0);
  });
});
