// ARKUSZ DANYCH WIDGETU - JEDNA ŁATKA NA DZIAŁANIE (kontrakt PR2, „Colour
// picker behaviour" (d) i „DataGrid behaviour" 6).
//
// Z historią buildera (`setContentPatch`) arkusz zapisuje dane, pozycyjne
// kolory serii i oba wskaźniki akcentu JEDNĄ łatką - jedno działanie autora
// to jeden krok cofania - a przesunięcie albo usunięcie serii nie odrywa
// koloru ani wyróżnienia od serii. Zdarzenie opróżnienia (Ctrl+Z w builderze)
// wysyła odłożoną edycję etykiety od razu.
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ContentPatch } from "@/lib/builder/schemas";
import { slotForSeries } from "@/lib/charts/palette";
import { GRID_FLUSH_EVENT } from "@/components/admin/charts/gridKeyboard";
import { ChartDataSpreadsheetDialog } from "../ChartDataSpreadsheetDialog";

vi.mock("@/components/charts/Chart", () => ({
  Chart: ({ config }: { config: Record<string, unknown> }) => (
    <div data-testid="podglad" data-config={JSON.stringify(config)} />
  ),
}));
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(React);
});

const CSV = "; Eksport; Import; Saldo\n2023; 1; 2; 3\n2024; 4; 5; 6";

function zamontuj(start: Record<string, unknown>) {
  const patches: ContentPatch[] = [];
  const onChange = vi.fn();
  function Host() {
    const [content, setContent] = useState<Record<string, unknown>>(start);
    return (
      <ChartDataSpreadsheetDialog
        value={String(content.data ?? "")}
        onChange={onChange}
        content={content}
        lang="pl"
        setContentPatch={(p) => {
          patches.push(p);
          setContent((c) => {
            const next = { ...c };
            for (const [k, v] of Object.entries(p)) {
              if (v === undefined) delete next[k];
              else next[k] = v;
            }
            return next;
          });
        }}
      />
    );
  }
  render(<Host />);
  fireEvent.click(screen.getByRole("button", { name: "Otwórz arkusz" }));
  return { patches, onChange };
}

const config = () =>
  JSON.parse(screen.getByTestId("podglad").getAttribute("data-config") ?? "{}") as {
    series: Array<{ name: string; colorSlot: number }>;
    accentSeries: number;
  };

describe("arkusz widgetu - jedna łatka z danymi, kolorami i akcentem", () => {
  it("przesunięcie serii to jedna łatka; kolor i akcent idą za serią", () => {
    const { patches, onChange } = zamontuj({
      data: CSV,
      kind: "bar",
      palette: "categorical",
      seriesColors: ";12",
      accentSeries: 1,
    });
    fireEvent.click(screen.getByRole("button", { name: "Działania na serii Import" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Przesuń w prawo" }));
    expect(patches).toHaveLength(1);
    expect(onChange).not.toHaveBeenCalled();
    expect(patches[0]).toEqual({
      data: "; Eksport; Saldo; Import\n2023; 1; 3; 2\n2024; 4; 6; 5",
      seriesColors: `;${slotForSeries(2)};12`,
      accentSeries: 2,
      accentCategory: undefined,
    });
    // Podgląd czyta stan tym samym adapterem, co widget na stronie.
    expect(config().series.map((s) => [s.name, s.colorSlot])).toEqual([
      ["Eksport", slotForSeries(0)],
      ["Saldo", slotForSeries(2)],
      ["Import", 12],
    ]);
    expect(config().accentSeries).toBe(2);
  });

  it("usunięcie serii wyróżnionej oddaje akcent pierwszej i zdejmuje klucz", () => {
    const { patches } = zamontuj({ data: CSV, kind: "bar", accentSeries: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Działania na serii Import" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Usuń serię" }));
    expect(patches).toHaveLength(1);
    expect(patches[0].accentSeries).toBeUndefined();
    expect("accentSeries" in patches[0]).toBe(true);
  });

  it("wybór koloru serii zapisuje napis pozycyjny tą samą łatką", () => {
    const { patches } = zamontuj({ data: CSV, kind: "bar", palette: "categorical" });
    fireEvent.click(screen.getByRole("button", { name: "Kolor serii Saldo" }));
    fireEvent.click(screen.getByRole("radio", { name: "bordo" }));
    expect(patches).toHaveLength(1);
    expect(patches[0].seriesColors).toBe(";;16");
  });

  it("zdarzenie opróżnienia (Ctrl+Z w builderze) wysyła odłożoną etykietę od razu", () => {
    const { patches } = zamontuj({ data: CSV, kind: "bar" });
    fireEvent.change(screen.getByRole("textbox", { name: "Etykieta kategorii 1" }), {
      target: { value: "2022" },
    });
    expect(patches).toHaveLength(0);
    act(() => {
      document.querySelector("[data-chart-grid]")?.dispatchEvent(new Event(GRID_FLUSH_EVENT));
    });
    expect(patches).toHaveLength(1);
    expect(patches[0].data).toContain("2022; 1; 2; 3");
  });
});
