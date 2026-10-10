// ARKUSZ WIDGETU - zapisany napis, którego parser wykresu nie odczyta.
//
// „12%", „−3" (minus U+2212) i „7 p" (flaga Eurostatu) w polu danych widgetu
// wykres rysuje jako luki. Do przeglądu końcowego PR2 arkusz pokazywał je jako
// puste komórki bez słowa, a pierwsza edycja INNEJ komórki zapisywała pustkę
// w ich miejsce. Teraz komórka pokazuje napis z `aria-invalid` i zdaniem,
// a zapis innej komórki oddaje go bez zmian.
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@/lib/i18n-chart-data-editor";
import { ChartDataGrid } from "../ChartDataGrid";
import { readWidgetGrid, widgetGridPatch, type ChartGridValue } from "../chartGridState";

vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(React);
});

const ZAPISANE = "; Eksport; Import\n2021; 12%; 5\n2022; −3; 7 p";

function zamontuj() {
  let biezacy = readWidgetGrid(ZAPISANE, {}, "pl");
  function Host() {
    const [v, setV] = useState<ChartGridValue>(biezacy);
    return (
      <ChartDataGrid
        value={v}
        onChange={(next) => {
          biezacy = next;
          setV(next);
        }}
        kind="bar"
        palette="focus"
        docLang="pl"
        lang="pl"
      />
    );
  }
  render(<Host />);
  return { dane: () => String(widgetGridPatch(biezacy, "data").data) };
}

const komorka = (nazwa: string) => screen.getByRole("textbox", { name: nazwa }) as HTMLInputElement;

describe("arkusz widgetu - zapisany napis spoza liczb", () => {
  it("komórka pokazuje napis z aria-invalid i zdaniem o zapisanej wartości", () => {
    zamontuj();
    const pole = komorka("2021 - Eksport");
    expect(pole.value).toBe("12%");
    expect(pole.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getAllByText(/Wykres nie odczyta tej zapisanej wartości/).length).toBe(3);
  });

  it("zatwierdzenie innej komórki oddaje napisy bez zmian", () => {
    const { dane } = zamontuj();
    const pole = komorka("2021 - Import");
    fireEvent.change(pole, { target: { value: "6" } });
    fireEvent.blur(pole);
    expect(dane()).toBe("; Eksport; Import\n2021; 12%; 6\n2022; −3; 7 p");
  });

  it("poprawiona komórka zapisuje liczbę i zdejmuje uwagę", () => {
    const { dane } = zamontuj();
    const pole = komorka("2022 - Eksport");
    fireEvent.change(pole, { target: { value: "-3" } });
    fireEvent.blur(pole);
    expect(dane()).toBe("; Eksport; Import\n2021; 12%; 5\n2022; -3; 7 p");
    expect(komorka("2022 - Eksport").getAttribute("aria-invalid")).toBeNull();
  });
});
