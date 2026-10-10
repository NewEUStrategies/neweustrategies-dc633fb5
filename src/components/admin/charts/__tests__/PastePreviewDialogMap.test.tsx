// PODGLĄD TABELI W TRYBIE MAPY - kolumna krajów i obrót (PR2, W6).
//
// Tabela z arkusza rzadko ma kraj w pierwszej kolumnie i wartość w drugiej.
// Podgląd mapy rozpoznaje kolumnę krajów i orientację (`initialMapTableLayout`),
// pokazuje je jako przełączniki, a „Zastosuj" oddaje układ, który edytor
// mapy czyta tą samą funkcją (`mapTableValues`) - podgląd nie może pokazać
// czegoś innego niż zapis.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@/lib/i18n-chart-data-editor";
import "@/lib/i18n-map-editor";
import { buildCountryIndex } from "@/lib/charts/importTable";
import { PastePreviewDialog } from "../PastePreviewDialog";
import { mapTableValues, type MapTableLayout } from "../mapTableLayout";

vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(React);
});

const index = buildCountryIndex([
  { id: "PL", pl: "Polska", en: "Poland" },
  { id: "DE", pl: "Niemcy", en: "Germany" },
  { id: "FR", pl: "Francja", en: "France" },
  { id: "CZ", pl: "Czechy", en: "Czech Republic" },
]);

function zamontuj(rows: string[][]) {
  const onApply = vi.fn<(l: MapTableLayout) => void>();
  render(
    <PastePreviewDialog
      open
      rows={rows}
      mode="map"
      source="paste"
      lang="pl"
      countryIndex={index}
      onApply={onApply}
      onCancel={vi.fn()}
    />,
  );
  return { onApply };
}

const podglad = () => within(screen.getByTestId("paste-preview"));
const obrot = () =>
  screen.getByRole("checkbox", {
    name: "Kraje w kolumnach (zamień wiersze z kolumnami)",
  }) as HTMLInputElement;
const kolumnaKrajow = () =>
  screen.getByRole("combobox", { name: "Kolumna krajów" }) as HTMLSelectElement;
const kolumnaWartosci = () =>
  screen.getByRole("combobox", { name: "Kolumna wartości" }) as HTMLSelectElement;

describe("podgląd mapy - kolumna krajów", () => {
  const LP = [
    ["Lp.", "Kraj", "Wartość", "Uwagi"],
    ["1", "Polska", "12,5", "x"],
    ["2", "Czechy", "7", "y"],
  ];

  it("rozpoznaje kraje w drugiej kolumnie i wartość za nimi", () => {
    const { onApply } = zamontuj(LP);
    expect(kolumnaKrajow().value).toBe("1");
    expect(kolumnaWartosci().value).toBe("2");
    expect(screen.getByText("Kraje: 2")).toBeInTheDocument();
    expect(podglad().getByText("PL")).toBeInTheDocument();
    expect(podglad().getByText("12.5")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Zastosuj" }));
    const layout = onApply.mock.calls[0][0];
    expect(layout).toMatchObject({ countryColumn: 1, valueColumn: 2, transpose: false });
    // Zapis czyta TĄ SAMĄ funkcją, co podgląd.
    expect(mapTableValues(LP, index, layout).values).toEqual([
      { id: "PL", value: 12.5 },
      { id: "CZ", value: 7 },
    ]);
  });

  it("lista wartości nie oferuje kolumny krajów", () => {
    zamontuj(LP);
    const opcje = Array.from(kolumnaWartosci().options).map((o) => o.value);
    expect(opcje).not.toContain("1");
    expect(opcje).toEqual(["0", "2", "3"]);
  });

  it("kolumna krajów przestawiona na kolumnę wartości przenosi wartość obok", () => {
    zamontuj(LP);
    fireEvent.change(kolumnaKrajow(), { target: { value: "2" } });
    expect(kolumnaKrajow().value).toBe("2");
    expect(kolumnaWartosci().value).not.toBe("2");
  });
});

describe("podgląd mapy - obrót", () => {
  const W_NAGLOWKU = [
    ["Rok", "PL", "DE", "FR"],
    ["2024", "10", "20", "30"],
  ];

  it("kraje w nagłówku: przełącznik obrotu startuje zaznaczony, a mapa ma trzy kraje", () => {
    const { onApply } = zamontuj(W_NAGLOWKU);
    expect(obrot().checked).toBe(true);
    expect(screen.getByText("Kraje: 3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Zastosuj" }));
    expect(onApply.mock.calls[0][0]).toMatchObject({ transpose: true, countryColumn: 0 });
  });

  it("odznaczenie obrotu rozpoznaje kolumny od nowa - bez krajów w kolumnach mapa jest pusta", () => {
    zamontuj(W_NAGLOWKU);
    fireEvent.click(obrot());
    expect(obrot().checked).toBe(false);
    expect(screen.getByText("W tym układzie tabela nie daje żadnych danych.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zastosuj" })).toBeDisabled();
  });

  it("tryb wykresu zachowuje swój napis obrotu (o seriach, nie o krajach)", () => {
    render(
      <PastePreviewDialog
        open
        rows={[
          ["", "A"],
          ["x", "1"],
        ]}
        mode="chart"
        source="paste"
        lang="pl"
        onApply={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("checkbox", { name: "Serie w wierszach (zamień wiersze z kolumnami)" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Kolumna krajów" })).toBeNull();
  });
});
