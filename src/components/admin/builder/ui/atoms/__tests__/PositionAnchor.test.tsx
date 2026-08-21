// Kotwica 3x3 („dokąd wyrównać widget w komórce kolumny"). Atom zapisuje DWIE
// osie jednym kliknięciem, więc test sprawdza każdą z dziewięciu kombinacji -
// pomyłka w indeksowaniu wiersz/kolumna daje efekt, którego na oko nie widać
// (poprawne wyrównanie w pionie, przekręcone w poziomie).
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PositionAnchor } from "../PositionAnchor";

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});

const ROW_KEY = {
  start: "builder.common.top",
  center: "builder.common.center",
  end: "builder.common.bottom",
} as const;
const COL_KEY = {
  start: "builder.common.left",
  center: "builder.common.center",
  end: "builder.common.right",
} as const;

/** Kratka kotwicy adresowana tak, jak ją widzi użytkownik: wiersz x kolumna. */
function cell(row: keyof typeof ROW_KEY, col: keyof typeof COL_KEY): HTMLElement {
  const title = `${ROW_KEY[row]} • ${COL_KEY[col]}`;
  const found = document.querySelector<HTMLElement>(`button[title="${title}"]`);
  if (!found) throw new Error(`test: brak kratki ${title}`);
  return found;
}

describe("PositionAnchor - zapis obu osi", () => {
  it.each([
    ["start", "start"],
    ["start", "center"],
    ["start", "end"],
    ["center", "start"],
    ["center", "center"],
    ["center", "end"],
    ["end", "start"],
    ["end", "center"],
    ["end", "end"],
  ] as const)("kratka %s x %s zapisuje oba wymiary", (row, col) => {
    const onChange = vi.fn();
    render(<PositionAnchor justify={undefined} align={undefined} onChange={onChange} />);
    fireEvent.click(cell(row, col));
    expect(onChange).toHaveBeenCalledWith({ justify: col, align: row });
  });

  it("rysuje dokładnie dziewięć kratek", () => {
    render(<PositionAnchor justify={undefined} align={undefined} onChange={vi.fn()} />);
    expect(document.querySelectorAll("button[title]")).toHaveLength(9);
  });
});

describe("PositionAnchor - stan aktywny", () => {
  it("podświetla tylko kratkę odpowiadającą obu osiom", () => {
    render(<PositionAnchor justify="end" align="center" onChange={vi.fn()} />);
    expect(cell("center", "end").className).toContain("bg-brand");
    // Sąsiedzi na tej samej osi NIE mogą być aktywni - stan jest iloczynem
    // obu wymiarów, nie sumą.
    expect(cell("center", "start").className).not.toContain("bg-brand");
    expect(cell("start", "end").className).not.toContain("bg-brand");
  });

  it("bez ustawionych osi żadna kratka nie jest aktywna", () => {
    render(<PositionAnchor justify={undefined} align={undefined} onChange={vi.fn()} />);
    for (const b of document.querySelectorAll("button[title]")) {
      expect(b.className).not.toContain("bg-brand");
    }
  });

  it("ustawiona tylko jedna oś nie aktywuje żadnej kratki", () => {
    render(<PositionAnchor justify="start" align={undefined} onChange={vi.fn()} />);
    for (const b of document.querySelectorAll("button[title]")) {
      expect(b.className).not.toContain("bg-brand");
    }
  });
});

describe("PositionAnchor - reset i rozciąganie", () => {
  it("reset czyści obie osie", () => {
    const onChange = vi.fn();
    render(<PositionAnchor justify="end" align="end" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "builder.position.default" }));
    // `undefined` na obu osiach, a nie „start/start" - dokument ma wrócić do
    // dziedziczenia z sekcji, nie dostać jawnego wyrównania do lewej.
    expect(onChange).toHaveBeenLastCalledWith({ justify: undefined, align: undefined });
  });

  it("rozciąganie w pionie włącza się bez ruszania osi poziomej", () => {
    const onChange = vi.fn();
    render(<PositionAnchor justify="center" align="start" onChange={onChange} />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenLastCalledWith({ justify: "center", align: "stretch" });
  });

  it("wyłączenie rozciągania wraca do auto", () => {
    const onChange = vi.fn();
    render(<PositionAnchor justify="center" align="stretch" onChange={onChange} />);
    const box = screen.getByRole("checkbox") as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    expect(onChange).toHaveBeenLastCalledWith({ justify: "center", align: "auto" });
  });

  it("rozciąganie zachowuje brak osi poziomej", () => {
    const onChange = vi.fn();
    render(<PositionAnchor justify={undefined} align={undefined} onChange={onChange} />);
    fireEvent.click(screen.getByRole("checkbox"));
    // Zapis NIE może dorzucić `justify: "auto"` z powietrza - w dokumencie
    // brak klucza znaczy „dziedzicz", a „auto" to już jawna wartość.
    expect(onChange).toHaveBeenLastCalledWith({ justify: undefined, align: "stretch" });
  });
});
