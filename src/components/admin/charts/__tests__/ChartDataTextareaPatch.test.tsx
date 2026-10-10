// TABELA WKLEJONA DO POLA DANYCH WIDGETU - kolory i akcent idą za nazwą serii.
//
// Pole tekstowe zapisywało samo `data`, więc indeksowe `accentSeries`,
// `accentCategory` i pozycyjne `seriesColors` zostawały na starych miejscach:
// tabela z kolumnami w innej kolejności przenosiła wyróżnienie i kolory na
// inne serie. Import tej samej tabeli w arkuszu idzie przez `gridReplace`
// (kolor i akcent za NAZWĄ) - teraz textarea robi to samo i zapisuje wynik
// JEDNĄ łatką (`setContentPatch`), czyli jednym krokiem historii.
import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import "@/lib/i18n-chart-data-editor";
import type { Json } from "@/lib/builder/types";
import type { ContentPatch, SchemaField } from "@/lib/builder/schemas";
import { SchemaFieldControl } from "@/components/admin/builder/ui/molecules/SchemaFieldControl";
import { parseSeriesColors } from "../chartGridState";

vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(React);
});

const DANE: SchemaField = { key: "data", type: "chartData", label: "Dane" };

function wklej(cel: Element, text: string) {
  const ev = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", {
    value: { getData: (typ: string) => (typ === "text/plain" ? text : "") },
  });
  act(() => {
    cel.dispatchEvent(ev);
  });
  return ev;
}

function zamontuj(content: Record<string, unknown>) {
  const written: Array<[string, Json]> = [];
  const setContentPatch = vi.fn<(patch: ContentPatch) => void>();
  render(
    <SchemaFieldControl
      field={DANE}
      lang="pl"
      content={content}
      setContent={(key, value) => written.push([key, value])}
      setContentPatch={setContentPatch}
    />,
  );
  return { written, setContentPatch };
}

describe("chartData - wklejona tabela przenosi kolory i akcent za nazwą serii", () => {
  it("kolumny w innej kolejności: akcent i kolory zostają przy swoich seriach, jedną łatką", () => {
    const { written, setContentPatch } = zamontuj({
      kind: "bar",
      palette: "categorical",
      data: "; Eksport; Import\n2023; 3; 5\n2024; 4; 6",
      // Wyróżniony Import (druga seria), kolory: Eksport 8, Import 9.
      accentSeries: 1,
      seriesColors: "8;9",
    });
    const ev = wklej(screen.getByRole("textbox"), "\tImport\tEksport\n2023\t5\t3\n2024\t6\t4");
    expect(ev.defaultPrevented).toBe(true);
    expect(written).toEqual([]);
    expect(setContentPatch).toHaveBeenCalledTimes(1);
    const patch = setContentPatch.mock.calls[0][0];
    expect(patch.data).toBe("; Import; Eksport\n2023; 5; 3\n2024; 6; 4");
    // Import stoi teraz pierwszy - wyróżnienie domyślne, klucz znika z treści.
    expect("accentSeries" in patch).toBe(true);
    expect(patch.accentSeries).toBeUndefined();
    expect(parseSeriesColors(patch.seriesColors)).toEqual([9, 8]);
  });

  it("seria wyróżniona, której w nowej tabeli nie ma, oddaje akcent pierwszej", () => {
    const { setContentPatch } = zamontuj({
      kind: "bar",
      data: "; Eksport; Import\n2023; 3; 5",
      accentSeries: 1,
    });
    wklej(screen.getByRole("textbox"), "\tA\tB\n2023\t1\t2");
    const patch = setContentPatch.mock.calls[0][0];
    expect(patch.data).toBe("; A; B\n2023; 1; 2");
    expect(patch.accentSeries).toBeUndefined();
  });
});
