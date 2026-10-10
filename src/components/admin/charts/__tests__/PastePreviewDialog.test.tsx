// PODGLĄD TABELI PRZED ZASTĄPIENIEM DANYCH (`PastePreviewDialog`).
//
// Przełączniki układu (nagłówek, obrót, format liczb, kolumna wartości mapy)
// mają położenia początkowe z rozpoznania, a wynik podglądu liczą TE SAME
// funkcje, które zastosuje edytor - więc podgląd nie może pokazać czegoś
// innego niż zapis. „Zastosuj" oddaje wybrany układ.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@/lib/i18n-chart-data-editor";
import { buildCountryIndex } from "@/lib/charts/importTable";
import { PastePreviewDialog } from "../PastePreviewDialog";
import type { TableLayout } from "../tableLayout";

vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(React);
});

function zamontuj(rows: string[][], opts: Partial<Parameters<typeof PastePreviewDialog>[0]> = {}) {
  const onApply = vi.fn<(l: TableLayout) => void>();
  const onCancel = vi.fn();
  render(
    <PastePreviewDialog
      open
      rows={rows}
      mode="chart"
      source="paste"
      lang="pl"
      onApply={onApply}
      onCancel={onCancel}
      {...opts}
    />,
  );
  return { onApply, onCancel };
}

const podglad = () => within(screen.getByTestId("paste-preview"));

describe("podgląd tabeli wykresu", () => {
  const EUROSTAT = [
    ["Kraj", "2019", "2020", "2021"],
    ["PL", "1,5", "2", "3"],
    ["DE", "4", "5", "6,5"],
  ];

  it("położenia początkowe z rozpoznania: nagłówek i serie w wierszach (Eurostat)", () => {
    zamontuj(EUROSTAT);
    expect(screen.getByRole("checkbox", { name: "Pierwszy wiersz to nagłówek" })).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Serie w wierszach (zamień wiersze z kolumnami)" }),
    ).toBeChecked();
    expect(screen.getByText("Kategorie: 3, serie: 2")).toBeInTheDocument();
    expect(podglad().getByText("PL")).toBeInTheDocument();
    expect(podglad().getByText("1.5")).toBeInTheDocument();
  });

  it("przełącznik obrotu zmienia wynik podglądu i trafia do układu", () => {
    const { onApply } = zamontuj(EUROSTAT);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Serie w wierszach (zamień wiersze z kolumnami)" }),
    );
    expect(screen.getByText("Kategorie: 2, serie: 3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Zastosuj" }));
    expect(onApply).toHaveBeenCalledWith({
      header: true,
      transpose: false,
      locale: "auto",
      valueColumn: 1,
    });
  });

  it("format liczb wymuszony na angielski czyta „1,234” jako tysiąc", () => {
    const { onApply } = zamontuj([
      ["", "A"],
      ["x", "1,234"],
    ]);
    expect(podglad().getByText("1.234")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Format liczb" }), {
      target: { value: "en" },
    });
    expect(podglad().getByText("1234")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Zastosuj" }));
    expect(onApply.mock.calls[0][0].locale).toBe("en");
  });

  it("problemy odczytu stoją obok problemów układu", () => {
    zamontuj(
      [
        ["", "A"],
        ["x", "abc"],
      ],
      { readProblems: [{ code: "pasteTruncated" }] },
    );
    expect(
      screen.getByText("Wklejone dane przekraczają limit - wczytano tylko ich początek."),
    ).toBeInTheDocument();
    expect(screen.getByText(/1 komórek nie jest liczbą/)).toBeInTheDocument();
  });

  it("tabela bez danych w wybranym układzie nie daje się zastosować", () => {
    zamontuj([["tylko", "nagłówek"]]);
    expect(screen.getByRole("button", { name: "Zastosuj" })).toBeDisabled();
  });

  it("anulowanie woła `onCancel`, nie `onApply`", () => {
    const { onApply, onCancel } = zamontuj(EUROSTAT);
    fireEvent.click(screen.getByRole("button", { name: "Anuluj" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });
});

describe("podgląd tabeli mapy - kolumna wartości", () => {
  const index = buildCountryIndex([
    { id: "PL", pl: "Polska", en: "Poland" },
    { id: "DE", pl: "Niemcy", en: "Germany" },
  ]);
  const TABELA = [
    ["Kraj", "2019", "2020"],
    ["Polska", "1", "2"],
    ["Germany", "3", "4"],
  ];

  it("lista kolumn wartości i wynik z wybranej kolumny", () => {
    const { onApply } = zamontuj(TABELA, { mode: "map", countryIndex: index });
    expect(screen.getByText("Kraje: 2")).toBeInTheDocument();
    expect(podglad().getByText("1")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Kolumna wartości" }), {
      target: { value: "2" },
    });
    expect(podglad().getByText("2")).toBeInTheDocument();
    expect(podglad().queryByText("1")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Zastosuj" }));
    expect(onApply.mock.calls[0][0].valueColumn).toBe(2);
  });

  it("tryb mapy nie oferuje obrotu serii wykresu (obrót mapy ma własną etykietę)", () => {
    zamontuj(TABELA, { mode: "map", countryIndex: index });
    expect(screen.queryByRole("checkbox", { name: /Serie w wierszach/ })).toBeNull();
  });
});
