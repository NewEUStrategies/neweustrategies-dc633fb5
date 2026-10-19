// Arkusz danych widgetu: IMPORT Z PLIKU i KANAŁ ZAPISU BEZ HISTORII.
//
// 1. Import zastępuje całą siatkę. Etykieta ze średnikiem („Kraków; Polska")
//    rozbiłaby format średnikowy widgetu na dwie kolumny i przesunęła
//    wszystkie wartości w wierszu - arkusz zamienia średnik na przecinek
//    i ZGŁASZA, ile etykiet zmienił (`labelsAdjusted`), zamiast zmieniać cicho.
//    Układ wybrany w podglądzie importu (nagłówek, obrót) dociera do parsera.
// 2. Wołający bez `setContentPatch` (edytory niestandardowe): dane idą przez
//    `onChange`, a pozostałe klucze łatki przez `setContent` - wyłącznie te,
//    które naprawdę się zmieniły, a zdjęte jako `null` (nie `undefined`,
//    którego JSON dokumentu nie uniesie).
//
// Atrapy: `Chart` (silnik wykresów ma własne testy), Radix Select (wzorzec
// sąsiednich testów) i `DataImportControl` - czytanie pliku (xlsx/csv,
// kodowania, wybór arkusza) jest jego własnym kontraktem; tu przechwytujemy
// `onRows`, czyli dokładnie to, co arkusz robi z wierszami pliku.
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { Json } from "@/lib/builder/types";
import type { ImportProblem } from "@/lib/charts/importTable";
import type { TableLayout } from "@/components/admin/charts/tableLayout";
import { ChartDataSpreadsheetDialog } from "../ChartDataSpreadsheetDialog";

const importer = vi.hoisted(() => ({
  onRows: null as ((rows: string[][], layout?: TableLayout) => ImportProblem[]) | null,
}));

vi.mock("@/components/charts/Chart", () => ({
  Chart: () => <div data-testid="podglad" />,
}));
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(React);
});
vi.mock("@/components/admin/blocks/DataImportControl", () => ({
  DataImportControl: ({
    onRows,
  }: {
    onRows: (rows: string[][], layout?: TableLayout) => ImportProblem[];
  }) => {
    importer.onRows = onRows;
    return null;
  },
}));

const CSV = "; Eksport; Import\n2023; 1; 2\n2024; 3; 4";

function mount(content: Record<string, unknown>) {
  const onChange = vi.fn<(v: string) => void>();
  const setContent = vi.fn<(key: string, value: Json) => void>();
  function Host() {
    const [value, setValue] = useState(String(content.data ?? ""));
    return (
      <ChartDataSpreadsheetDialog
        value={value}
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
        content={{ ...content, data: value }}
        setContent={setContent}
        lang="pl"
      />
    );
  }
  render(<Host />);
  fireEvent.click(screen.getByRole("button", { name: "Otwórz arkusz" }));
  return { onChange, setContent };
}

function runImport(rows: string[][], layout?: TableLayout): ImportProblem[] {
  const onRows = importer.onRows;
  if (!onRows) throw new Error("test: arkusz nie zamontował importu");
  let problems: ImportProblem[] = [];
  act(() => {
    problems = onRows(rows, layout);
  });
  return problems;
}

/** Każdy wiersz CSV ma tyle samo pól - etykieta nie rozbiła kolumny. */
function columnsPerLine(csv: string): number[] {
  return csv.split("\n").map((line) => line.split(";").length);
}

describe("arkusz widgetu - import z pliku", () => {
  it("etykiety ze średnikiem są poprawione i policzone, kolumny się nie przesuwają", () => {
    const { onChange } = mount({ data: CSV });
    const problems = runImport([
      ["", "Kraków; Polska", "Import"],
      ["2023", "10", "20"],
      ["2024;Q1", "30", "40"],
    ]);
    const csv = onChange.mock.calls.at(-1)?.[0] ?? "";
    expect(csv).toContain("Kraków, Polska");
    expect(csv).toContain("2024,Q1");
    expect(new Set(columnsPerLine(csv))).toEqual(new Set([3]));
    expect(problems).toContainEqual({ code: "labelsAdjusted", count: 2 });
  });

  it("czyste etykiety nie dostają zgłoszenia o poprawce", () => {
    mount({ data: CSV });
    const problems = runImport([
      ["", "Eksport", "Import"],
      ["2025", "5", "6"],
    ]);
    expect(problems.some((p) => p.code === "labelsAdjusted")).toBe(false);
  });

  it("układ z podglądu importu (obrót tabeli) trafia do parsera", () => {
    const { onChange } = mount({ data: CSV });
    // Serie w WIERSZACH (tabela GUS/Eurostatu): po obróceniu lata stają się
    // kategoriami, a „Eksport" serią.
    runImport(
      [
        ["", "2023", "2024"],
        ["Eksport", "7", "8"],
      ],
      { header: true, transpose: true, locale: "auto", valueColumn: 1 },
    );
    expect(onChange).toHaveBeenLastCalledWith("; Eksport\n2023; 7\n2024; 8");
  });
});

describe("arkusz widgetu - zapis bez historii buildera", () => {
  it("dane idą przez onChange, a zdjęty akcent serii przez setContent jako null", () => {
    // Akcent na drugiej serii („Import"); import bez tej serii nie ma czego
    // wyróżnić, więc wskaźnik musi zniknąć z treści.
    const { onChange, setContent } = mount({ data: CSV, accentSeries: 1 });
    runImport([
      ["", "Eksport"],
      ["2023", "9"],
    ]);
    expect(onChange).toHaveBeenLastCalledWith("; Eksport\n2023; 9");
    expect(setContent).toHaveBeenCalledWith("accentSeries", null);
    // Klucze, których wartość się nie zmieniła, nie są wysyłane.
    expect(setContent.mock.calls.map(([key]) => key)).not.toContain("data");
    expect(setContent.mock.calls.map(([key]) => key)).not.toContain("accentCategory");
  });
});
