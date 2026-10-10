// ARKUSZ DANYCH - wklejenie po przeglądzie końcowym PR2.
//
//   1. RÓG TABELI TO PIERWSZA ETYKIETA KATEGORII. Do tej poprawki „pierwszą
//      komórką" była każda z trzech: etykieta kategorii 1, NAZWA SERII 1
//      i pierwsza wartość. Wiersz nazw wklejony w nazwę serii 1 otwierał więc
//      podgląd zastąpienia całej tabeli (z nieaktywnym „Zastosuj"), a tabela
//      z nagłówkiem proponowała kolumnę liczb jako etykiety kategorii -
//      podczas gdy ta sama wklejka w nazwę serii 2 szła od kotwicy.
//   2. ZAPOWIEDŹ WYNIKU WKLEJENIA idzie do regionu `aria-live`, który stoi
//      w drzewie OD POCZĄTKU - czytniki ekranu ogłaszają zmianę treści
//      istniejącego regionu, a region wstawiony razem z tekstem zwykle
//      przemilczają. Dotyczy siatki wykresu i siatki mapy.
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { act, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import "@/lib/i18n-chart-data-editor";
import "@/lib/i18n-map-editor";
import type { GeoAsset } from "@/lib/charts/types";
import { ChartDataGrid } from "../ChartDataGrid";
import { MapDataGrid } from "../MapDataGrid";
import type { ChartGridValue } from "../chartGridState";
import type { MapGridRow } from "../mapGridState";

vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(React);
});

function startowy(): ChartGridValue {
  return {
    model: {
      categories: ["2023", "2024"],
      series: [
        { name: "Seria A", values: [10, 12], colorSlot: 3 },
        { name: "Seria B", values: [5, 8], colorSlot: 4 },
      ],
    },
    accentSeries: 0,
    accentCategory: null,
  };
}

function zamontujWykres() {
  const onChange = vi.fn<(v: ChartGridValue) => void>();
  let biezacy = startowy();
  function Host() {
    const [v, setV] = useState(biezacy);
    return (
      <ChartDataGrid
        value={v}
        onChange={(next) => {
          biezacy = next;
          onChange(next);
          setV(next);
        }}
        kind="bar"
        palette="focus"
        docLang="pl"
        lang="pl"
      />
    );
  }
  const view = render(<Host />);
  return { onChange, stan: () => biezacy, ...view };
}

const pole = (nazwa: string) => screen.getByRole("textbox", { name: nazwa }) as HTMLInputElement;

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

describe("wklejenie w nazwę pierwszej serii idzie od kotwicy", () => {
  it("wiersz nazw zastępuje nazwy serii od tej komórki, bez podglądu", () => {
    const { onChange, stan } = zamontujWykres();
    wklej(pole("Nazwa serii 1"), "Eksport\tImport");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(stan().model.series.map((s) => s.name)).toEqual(["Eksport", "Import"]);
    expect(stan().model.categories).toEqual(["2023", "2024"]);
  });

  it("nazwy z liczbami pod nimi wchodzą od kotwicy - etykiety kategorii autora zostają", () => {
    const { onChange, stan } = zamontujWykres();
    wklej(pole("Nazwa serii 1"), "Eksport\tImport\n1\t2\n3\t4");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(1);
    const v = stan();
    expect(v.model.categories).toEqual(["2023", "2024"]);
    expect(v.model.series.map((s) => [s.name, s.values])).toEqual([
      ["Eksport", [1, 3]],
      ["Import", [2, 4]],
    ]);
  });

  it("tabela z nagłówkiem w PIERWSZĄ ETYKIETĘ KATEGORII nadal otwiera podgląd", () => {
    const { onChange } = zamontujWykres();
    wklej(pole("Etykieta kategorii 1"), "\tA\tB\n2021\t1\t2");
    expect(screen.getByRole("dialog", { name: "Wklejanie tabeli" })).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("zapowiedź wyniku wklejenia - region istnieje przed wklejeniem", () => {
  /** Regiony `aria-live` siatki w chwili wywołania. */
  const regiony = (root: HTMLElement) => [...root.querySelectorAll("[aria-live]")];

  it("siatka wykresu: tekst wyniku trafia do regionu, który stał już przed wklejeniem", () => {
    const { container } = zamontujWykres();
    const przed = regiony(container);
    expect(przed.length).toBeGreaterThan(0);
    wklej(pole("2024 - Seria A"), "20\tx\n40\t50");
    const tekst = screen.getByText("Wklejono dane z arkusza.");
    const region = tekst.closest("[aria-live]");
    expect(region).not.toBeNull();
    expect(przed).toContain(region);
  });

  it("siatka mapy: tak samo", () => {
    const europa = (JSON.parse(readFileSync("public/geo/europe-50m.v2.json", "utf8")) as GeoAsset)
      .countries;
    function Host() {
      const [rows, setRows] = useState<readonly MapGridRow[]>([
        { id: "PL", value: 12 },
        { id: "DE", value: 30 },
      ]);
      return (
        <MapDataGrid rows={rows} onChange={setRows} countries={europa} docLang="pl" lang="pl" />
      );
    }
    const { container } = render(<Host />);
    const przed = regiony(container);
    wklej(pole("Niemcy - wartość"), "40\n50,5");
    const region = screen.getByText("Wklejono dane z arkusza.").closest("[aria-live]");
    expect(region).not.toBeNull();
    expect(przed).toContain(region);
  });
});
