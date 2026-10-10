// ARKUSZ DANYCH WYKRESU (`ChartDataGrid`) - kontrakt PR2 „DataGrid behaviour".
//
//   1. komórka liczby trzyma SZKIC i zatwierdza go przez `parseImportedCell`
//      przy opuszczeniu pola, Enterze i Tabie; wpis, który liczbą nie jest,
//      dostaje `aria-invalid` i zdanie, a NIE cichą lukę;
//   2. komórki to natywne pola `<input>`;
//   3. zakres wklejony w środek siatki trafia od komórki kotwicy JEDNYM
//      `onChange`, problemy stoją pod siatką; cała tabela wklejona w pustą
//      siatkę albo w pierwszą komórkę otwiera podgląd układu;
//   4. klawiatura arkusza, przyciski wierszy i kolumn poza Tabem, nazwa
//      dostępna komórki „{kategoria} - {seria}";
//   6. Ctrl+Z przy niezatwierdzonym szkicu cofa szkic i nie idzie dalej.
// Plus kolory: próbka to kolor narysowany, pod paletą ról pierwsze serie mają
// etykietę roli, a przesunięcie serii nie odrywa od niej akcentu.
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import "@/lib/i18n-chart-data-editor";
import i18n from "@/lib/i18n";
import { ROLE } from "@/lib/charts/roles";
import type { ChartPalette } from "@/lib/charts/seriesStyle";
import type { ChartKind } from "@/lib/charts/types";
import { ChartDataGrid } from "../ChartDataGrid";
import type { ChartGridValue } from "../chartGridState";
import { GRID_FLUSH_EVENT } from "../gridKeyboard";

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
        { name: "Eksport", values: [10, 12], colorSlot: 3 },
        { name: "Import", values: [5, 8], colorSlot: 4 },
      ],
    },
    accentSeries: 0,
    accentCategory: null,
  };
}

function zamontuj(
  opts: {
    value?: ChartGridValue;
    kind?: ChartKind;
    palette?: ChartPalette;
    onFlush?: () => void;
  } = {},
) {
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
        onFlush={opts.onFlush}
      />
    );
  }
  const view = render(<Host />);
  return { onChange, stan: () => biezacy, ...view };
}

const komorka = (nazwa: string) => screen.getByRole("textbox", { name: nazwa }) as HTMLInputElement;

/** Zdarzenie wklejenia z obiema postaciami schowka (jsdom/happy-dom nie ma `DataTransfer`). */
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

describe("komórka liczby - szkic i zatwierdzenie", () => {
  it("komórki to natywne pola z nazwą „kategoria - seria”", () => {
    zamontuj();
    const pole = komorka("2023 - Eksport");
    expect(pole.tagName).toBe("INPUT");
    expect(pole.value).toBe("10");
  });

  it("pisanie nie zapisuje niczego; opuszczenie pola zapisuje liczbę w konwencji z przecinkiem", () => {
    const { onChange, stan } = zamontuj();
    const pole = komorka("2023 - Eksport");
    fireEvent.change(pole, { target: { value: "1," } });
    expect(pole.value).toBe("1,");
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(pole, { target: { value: "1 234,5" } });
    fireEvent.blur(pole);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(stan().model.series[0].values).toEqual([1234.5, 12]);
  });

  it("wpis niebędący liczbą dostaje aria-invalid i zdanie, a treść trzyma starą liczbę", () => {
    const { onChange } = zamontuj();
    const pole = komorka("2023 - Eksport");
    fireEvent.change(pole, { target: { value: "abc" } });
    fireEvent.blur(pole);
    expect(pole.getAttribute("aria-invalid")).toBe("true");
    expect(
      screen.getByText("To nie jest liczba - popraw wpis albo wyczyść komórkę."),
    ).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("pusta komórka i jawny brak danych („:”) są luką, nie błędem", () => {
    const { stan } = zamontuj();
    const pole = komorka("2023 - Eksport");
    fireEvent.change(pole, { target: { value: ":" } });
    fireEvent.blur(pole);
    expect(pole.getAttribute("aria-invalid")).toBeNull();
    expect(stan().model.series[0].values[0]).toBeNull();
  });

  it("Enter zatwierdza i schodzi wiersz niżej; Tab idzie do następnej komórki", () => {
    const { stan } = zamontuj();
    const pole = komorka("2023 - Eksport");
    pole.focus();
    fireEvent.change(pole, { target: { value: "7" } });
    fireEvent.keyDown(pole, { key: "Enter" });
    expect(stan().model.series[0].values[0]).toBe(7);
    expect(document.activeElement).toBe(komorka("2024 - Eksport"));
    fireEvent.keyDown(document.activeElement as Element, { key: "Tab" });
    expect(document.activeElement).toBe(komorka("2024 - Import"));
    fireEvent.keyDown(document.activeElement as Element, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(komorka("2024 - Eksport"));
  });

  it("strzałki w górę i w dół zawsze, w lewo dopiero na początku tekstu", () => {
    zamontuj();
    const pole = komorka("2024 - Import");
    pole.focus();
    fireEvent.keyDown(pole, { key: "ArrowUp" });
    expect(document.activeElement).toBe(komorka("2023 - Import"));
    const gora = komorka("2023 - Import");
    gora.setSelectionRange(1, 1);
    fireEvent.keyDown(gora, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(gora);
    gora.setSelectionRange(0, 0);
    fireEvent.keyDown(gora, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(komorka("2023 - Eksport"));
  });

  it("Ctrl+Z przy niezatwierdzonym szkicu cofa szkic i nie dociera do historii", () => {
    zamontuj();
    const historia = vi.fn();
    window.addEventListener("keydown", historia);
    try {
      const pole = komorka("2023 - Eksport");
      fireEvent.change(pole, { target: { value: "99" } });
      fireEvent.keyDown(pole, { key: "z", ctrlKey: true });
      expect(pole.value).toBe("10");
      expect(historia).not.toHaveBeenCalled();
      // Bez szkicu Ctrl+Z idzie dalej - do historii bloku albo buildera.
      fireEvent.keyDown(pole, { key: "z", ctrlKey: true });
      expect(historia).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("keydown", historia);
    }
  });
});

describe("wklejenie zakresu", () => {
  it("zakres w środku siatki trafia od komórki kotwicy jednym zapisem, z problemami pod siatką", () => {
    const { onChange, stan } = zamontuj();
    const ev = wklej(komorka("2024 - Eksport"), { text: "20\t30\tx\n40\t50\t60" });
    expect(ev.defaultPrevented).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
    const v = stan();
    expect(v.model.categories).toHaveLength(3);
    expect(v.model.series[0].values).toEqual([10, 20, 40]);
    expect(v.model.series[1].values).toEqual([5, 30, 50]);
    // Kolumna za krawędzią dokłada serię z nazwą domyślną w języku dokumentu.
    expect(v.model.series[2].name).toBe("Seria C");
    expect(screen.getByText(/1 komórek nie jest liczbą/)).toBeInTheDocument();
  });

  it("pojedyncza wartość wkleja się w pole i od razu zatwierdza", () => {
    const { stan } = zamontuj();
    const pole = komorka("2023 - Import");
    pole.setSelectionRange(0, pole.value.length);
    wklej(pole, { text: "3,5" });
    expect(stan().model.series[1].values[0]).toBe(3.5);
  });

  it("cała tabela z nagłówkiem wklejona w pierwszą komórkę otwiera podgląd, a „Zastosuj” zastępuje dane", () => {
    const { onChange, stan } = zamontuj({ palette: "categorical" });
    wklej(komorka("Etykieta kategorii 1"), {
      text: "\tImport\tNowa\n2021\t1\t2\n2022\t3\t4\n2023\t5\t6",
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Wklejanie tabeli" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Zastosuj" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const v = stan();
    expect(v.model.categories).toEqual(["2021", "2022", "2023"]);
    expect(v.model.series.map((s) => s.name)).toEqual(["Import", "Nowa"]);
    // Kolor idzie za NAZWĄ serii.
    expect(v.model.series[0].colorSlot).toBe(4);
  });

  it("anulowany podgląd nie zmienia danych", () => {
    const { onChange } = zamontuj();
    wklej(komorka("Etykieta kategorii 1"), { text: "\tA\tB\n2021\t1\t2" });
    fireEvent.click(screen.getByRole("button", { name: "Anuluj" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("kolory i seria wyróżniona", () => {
  it("pod paletą ról serie mają etykietę roli i próbkę koloru narysowanego", () => {
    const { container } = zamontuj();
    expect(screen.getByText("Akcent")).toBeInTheDocument();
    expect(screen.getByText("Tło 1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Kolor serii/ })).toBeNull();
    const probki = Array.from(container.querySelectorAll<HTMLElement>("thead span[aria-hidden]"))
      .map((el) => el.style.background)
      .filter((c) => c !== "");
    expect(probki[0]).toBe(ROLE.acc);
    expect(screen.getByText(/Kolory własne działają w palecie kategorialnej/)).toBeInTheDocument();
  });

  it("pod paletą kategorialną kolor wybiera się z próbek, a wybór zapisuje slot serii", () => {
    const { stan } = zamontuj({ palette: "categorical" });
    fireEvent.click(screen.getByRole("button", { name: "Kolor serii Import" }));
    const radio = screen.getByRole("radio", {
      name: String(i18n.t("chartEditor.colors.slots.bordo")),
    });
    fireEvent.click(radio);
    expect(stan().model.series[1].colorSlot).toBe(16);
    expect(screen.queryByText("Akcent")).toBeNull();
  });

  it("wybór serii wyróżnionej i przesunięcie serii - akcent zostaje przy serii", () => {
    const { stan } = zamontuj();
    fireEvent.change(screen.getByRole("combobox", { name: "Seria wyróżniona" }), {
      target: { value: "1" },
    });
    expect(stan().accentSeries).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Działania na serii Import" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Przesuń w lewo" }));
    const v = stan();
    expect(v.model.series.map((s) => s.name)).toEqual(["Import", "Eksport"]);
    expect(v.accentSeries).toBe(0);
  });

  it("tarcza wyróżnia WYCINEK - z listy albo z menu wiersza", () => {
    const { stan } = zamontuj({ kind: "pie" });
    expect(screen.queryByRole("combobox", { name: "Seria wyróżniona" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Działania na kategorii 2024" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Wyróżnij ten wycinek" }));
    expect(stan().accentCategory).toBe(1);
  });
});

describe("struktura i klawiatura menu", () => {
  it("przyciski menu wierszy i kolumn są poza kolejnością Tab", () => {
    zamontuj();
    for (const nazwa of ["Działania na serii Eksport", "Działania na kategorii 2023"]) {
      expect(screen.getByRole("button", { name: nazwa }).getAttribute("tabindex")).toBe("-1");
    }
  });

  it("klawisz menu kontekstowego w komórce otwiera menu jej wiersza", () => {
    const { stan } = zamontuj();
    fireEvent.keyDown(komorka("2024 - Import"), { key: "ContextMenu" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Wstaw kategorię powyżej" }));
    expect(stan().model.categories).toEqual(["2023", "", "2024"]);
  });

  it("zdarzenie opróżnienia na korzeniu siatki woła `onFlush`", () => {
    const onFlush = vi.fn();
    const { container } = zamontuj({ onFlush });
    const root = container.querySelector("[data-chart-grid]");
    root?.dispatchEvent(new Event(GRID_FLUSH_EVENT));
    expect(onFlush).toHaveBeenCalledTimes(1);
  });

  it("obrót zamienia kategorie z seriami jednym zapisem", () => {
    const { onChange, stan } = zamontuj();
    fireEvent.click(screen.getByRole("button", { name: "Zamień wiersze z kolumnami" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(stan().model.categories).toEqual(["Eksport", "Import"]);
  });
});
