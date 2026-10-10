// ARKUSZ DANYCH WYKRESU - poprawki po przeglądzie PR2 (W5).
//
//   * „pusta siatka" to siatka bez liczb I bez etykiet autora (`gridIsBlank`):
//     w siatce z wpisanymi latami i nazwami serii blok samych liczb wklejony
//     w pierwszą komórkę wartości trafia od kotwicy, a nie do podglądu, który
//     zastąpiłby wpisane etykiety (kontrakt, „DataGrid behaviour" 3);
//   * komunikat wklejenia stoi tylko przy danych, które wklejenie dało;
//   * seria wyróżniona jest do wyboru w OBU paletach (ranga steruje też
//     kształtem), a rodzaj bez palety jej nie pokazuje;
//   * jedna komórka z arkusza daje tę samą liczbę co w zakresie (surowa
//     wartość z HTML-a);
//   * po działaniu z menu wiersza albo kolumny fokus wraca do siatki.
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import "@/lib/i18n-chart-data-editor";
import { slotForSeries } from "@/lib/charts/palette";
import type { ChartPalette } from "@/lib/charts/seriesStyle";
import type { ChartKind } from "@/lib/charts/types";
import { ChartDataGrid } from "../ChartDataGrid";
import { gridIsBlank, type ChartGridValue } from "../chartGridState";

vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(React);
});

function siatka(
  categories: string[],
  series: Array<{ name: string; values: (number | null)[] }>,
): ChartGridValue {
  return {
    model: {
      categories,
      series: series.map((s, i) => ({ ...s, colorSlot: slotForSeries(i) })),
    },
    accentSeries: 0,
    accentCategory: null,
  };
}

const startowy = () =>
  siatka(
    ["2023", "2024"],
    [
      { name: "Eksport", values: [10, 12] },
      { name: "Import", values: [5, 8] },
    ],
  );

function zamontuj(opts: { value?: ChartGridValue; kind?: ChartKind; palette?: ChartPalette } = {}) {
  const onChange = vi.fn<(v: ChartGridValue) => void>();
  let biezacy = opts.value ?? startowy();
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
        kind={opts.kind ?? "bar"}
        palette={opts.palette ?? "focus"}
        docLang="pl"
        lang="pl"
      />
    );
  }
  render(<Host />);
  return { onChange, stan: () => biezacy };
}

const komorka = (nazwa: string) => screen.getByRole("textbox", { name: nazwa }) as HTMLInputElement;

function wklej(cel: Element, s: { text?: string; html?: string }) {
  const ev = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", {
    value: {
      getData: (typ: string) => (typ === "text/html" ? (s.html ?? "") : (s.text ?? "")),
    },
  });
  act(() => {
    cel.dispatchEvent(ev);
  });
  return ev;
}

/** Odczekanie oddania fokusu po zamknięciu Popovera (Radix robi to w `setTimeout`). */
async function poZamknieciu() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}

describe("gridIsBlank - kiedy wklejka całej tabeli ZASTĘPUJE siatkę", () => {
  it("start widgetu i nazwy wstawione przez arkusz to pustka", () => {
    expect(gridIsBlank(siatka(["2024"], [{ name: "Seria A", values: [null] }]))).toBe(true);
    expect(
      gridIsBlank(
        siatka(
          ["", "2"],
          [
            { name: "Series A", values: [null, null] },
            { name: "", values: [null, null] },
          ],
        ),
      ),
    ).toBe(true);
  });

  it("etykiety autora albo choć jedna liczba - to już nie jest pustka", () => {
    expect(gridIsBlank(siatka(["2019", "2020"], [{ name: "Seria A", values: [null, null] }]))).toBe(
      false,
    );
    expect(gridIsBlank(siatka(["2024"], [{ name: "Eksport", values: [null] }]))).toBe(false);
    expect(gridIsBlank(siatka(["2024"], [{ name: "Seria A", values: [0] }]))).toBe(false);
  });
});

describe("wklejenie do siatki z etykietami autora", () => {
  const zEtykietami = () =>
    siatka(
      ["2019", "2020", "2021"],
      [
        { name: "Eksport", values: [null, null, null] },
        { name: "Import", values: [null, null, null] },
      ],
    );

  it("blok samych liczb w pierwszej komórce wartości trafia od kotwicy, etykiety zostają", () => {
    const { onChange, stan } = zamontuj({ value: zEtykietami() });
    const ev = wklej(komorka("2019 - Eksport"), { text: "1\t2\n3\t4\n5\t6" });
    expect(ev.defaultPrevented).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(1);
    const v = stan();
    expect(v.model.categories).toEqual(["2019", "2020", "2021"]);
    expect(v.model.series.map((s) => s.name)).toEqual(["Eksport", "Import"]);
    expect(v.model.series[0].values).toEqual([1, 3, 5]);
    expect(v.model.series[1].values).toEqual([2, 4, 6]);
  });

  it("pusta siatka (start widgetu) nadal otwiera podgląd zastąpienia", () => {
    const { onChange } = zamontuj({
      value: siatka(["2024"], [{ name: "Seria A", values: [null] }]),
    });
    wklej(komorka("2024 - Seria A"), { text: "1\t2\n3\t4" });
    expect(screen.getByRole("dialog", { name: "Wklejanie tabeli" })).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("komunikat wklejenia", () => {
  it("znika po następnej edycji", () => {
    zamontuj();
    wklej(komorka("2024 - Eksport"), { text: "20\tx\n40\t50" });
    expect(screen.getByText("Wklejono dane z arkusza.")).toBeInTheDocument();
    expect(screen.getByText(/1 komórek nie jest liczbą/)).toBeInTheDocument();
    const pole = komorka("2023 - Eksport");
    fireEvent.change(pole, { target: { value: "11" } });
    fireEvent.blur(pole);
    expect(screen.queryByText("Wklejono dane z arkusza.")).toBeNull();
    expect(screen.queryByText(/1 komórek nie jest liczbą/)).toBeNull();
  });

  it("znika, gdy dane wracają sprzed wklejenia (Ctrl+Z w historii bloku)", () => {
    const onChange = vi.fn<(v: ChartGridValue) => void>();
    const przed = startowy();
    const props = {
      onChange,
      kind: "bar" as const,
      palette: "focus" as const,
      docLang: "pl" as const,
    };
    const { rerender } = render(<ChartDataGrid value={przed} lang="pl" {...props} />);
    wklej(komorka("2024 - Eksport"), { text: "20\t30\n40\t50" });
    const po = onChange.mock.calls[0][0];
    // Edytor bloku odtwarza stan z treści - NOWY obiekt o tych samych danych.
    rerender(<ChartDataGrid value={structuredClone(po)} lang="pl" {...props} />);
    expect(screen.getByText("Wklejono dane z arkusza.")).toBeInTheDocument();
    rerender(<ChartDataGrid value={structuredClone(przed)} lang="pl" {...props} />);
    expect(screen.queryByText("Wklejono dane z arkusza.")).toBeNull();
  });
});

describe("seria wyróżniona w obu paletach", () => {
  it("w palecie kategorialnej wybór zostaje, ze zdaniem o kształcie zamiast koloru", () => {
    const { stan } = zamontuj({ palette: "categorical" });
    fireEvent.change(screen.getByRole("combobox", { name: "Seria wyróżniona" }), {
      target: { value: "1" },
    });
    expect(stan().accentSeries).toBe(1);
    expect(
      screen.getByText(/W palecie kategorialnej seria wyróżniona zachowuje swój kolor/),
    ).toBeInTheDocument();
    // Ta sama możliwość w menu kolumny - i powrót do pierwszej serii.
    fireEvent.click(screen.getByRole("button", { name: "Działania na serii Eksport" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Wyróżnij tę serię" }));
    expect(stan().accentSeries).toBe(0);
  });

  it("rodzaj, który palety nie stosuje (mapa ciepła - kolor koduje wartość), nie pokazuje wyboru", () => {
    zamontuj({ kind: "heatmap" });
    expect(screen.queryByRole("combobox", { name: "Seria wyróżniona" })).toBeNull();
  });

  it("punktowy stosuje paletę ról (chmura serii w akcencie), więc pokazuje wybór", () => {
    zamontuj({ kind: "scatter" });
    expect(screen.getByRole("combobox", { name: "Seria wyróżniona" })).toBeInTheDocument();
  });

  it("zdanie o palecie ról mówi o tle porównania, nie o odcieniach neutralnych", () => {
    zamontuj();
    expect(screen.getByText(/pozostałe jako tło porównania/)).toBeInTheDocument();
    expect(screen.queryByText(/odcieniach neutralnych/)).toBeNull();
  });
});

describe("jedna komórka z arkusza - ta sama liczba co w zakresie", () => {
  const HTML_JEDNA =
    '<html><body><table><tr><td x:num="1234">1,234</td></tr></table></body></html>';
  const HTML_ZAKRES =
    '<html><body><table><tr><td x:num="1234">1,234</td><td x:num="5">5</td></tr></table></body></html>';

  it("„1,234” z angielskiego Excela daje 1234 w jednej komórce i w zakresie", () => {
    const { stan } = zamontuj();
    wklej(komorka("2023 - Eksport"), { text: "1,234", html: HTML_JEDNA });
    expect(stan().model.series[0].values[0]).toBe(1234);
    // Wpis pokazuje liczbę w konwencji dokumentu.
    expect(komorka("2023 - Eksport").value).toBe("1234");
    wklej(komorka("2024 - Eksport"), { text: "1,234\t5", html: HTML_ZAKRES });
    expect(stan().model.series[0].values[1]).toBe(1234);
  });

  it("procent z arkusza: surowa wartość · 100, jak w zakresie", () => {
    const { stan } = zamontuj();
    wklej(komorka("2023 - Import"), {
      text: "12,5%",
      html: '<table><tr><td x:num="0.125">12,5%</td></tr></table>',
    });
    expect(stan().model.series[1].values[0]).toBe(12.5);
    expect(komorka("2023 - Import").value).toBe("12,5");
  });

  it("bez HTML-a zwykły tekst wkleja się w miejsce zaznaczenia, jak dotąd", () => {
    const { stan } = zamontuj();
    const pole = komorka("2023 - Import");
    pole.setSelectionRange(0, pole.value.length);
    wklej(pole, { text: "3,5" });
    expect(stan().model.series[1].values[0]).toBe(3.5);
  });
});

describe("fokus po menu wiersza i kolumny", () => {
  it("po usunięciu kategorii fokus stoi w najbliższej komórce, a nie na body", async () => {
    zamontuj();
    const pole = komorka("2024 - Import");
    pole.focus();
    fireEvent.keyDown(pole, { key: "ContextMenu" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Usuń kategorię" }));
    await poZamknieciu();
    expect(document.activeElement).toBe(komorka("2023 - Import"));
  });

  it("Escape w menu oddaje fokus komórce, z której je otwarto", async () => {
    zamontuj();
    const pole = komorka("2023 - Eksport");
    pole.focus();
    fireEvent.keyDown(pole, { key: "ContextMenu" });
    const pozycja = screen.getByRole("menuitem", { name: "Wstaw kategorię powyżej" });
    fireEvent.keyDown(pozycja, { key: "Escape" });
    await poZamknieciu();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(komorka("2023 - Eksport"));
  });

  it("przesunięcie wiersza albo serii - fokus idzie za przesuniętym miejscem", async () => {
    const { stan } = zamontuj();
    const pole = komorka("2023 - Eksport");
    pole.focus();
    fireEvent.keyDown(pole, { key: "ContextMenu" });
    // Klawisz menu w komórce wartości otwiera menu WIERSZA; menu kolumny
    // otwiera się z nazwy serii.
    fireEvent.click(screen.getByRole("menuitem", { name: "Przesuń w dół" }));
    await poZamknieciu();
    expect(stan().model.categories).toEqual(["2024", "2023"]);
    expect(document.activeElement).toBe(komorka("2023 - Eksport"));
    const nazwa = screen.getByRole("textbox", { name: "Nazwa serii 1" });
    nazwa.focus();
    fireEvent.keyDown(nazwa, { key: "F10", shiftKey: true });
    fireEvent.click(screen.getByRole("menuitem", { name: "Przesuń w prawo" }));
    await poZamknieciu();
    expect(stan().model.series.map((s) => s.name)).toEqual(["Import", "Eksport"]);
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Nazwa serii 2" }));
  });
});
