// ARKUSZ DANYCH MAPY - poprawki po przeglądzie W6, sprawdzane na siatce.
//
//   * Tabela bez nagłówka z dodatkową kolumną tekstu („kod | nazwa |
//     wartość") wklejona w pustą siatkę: podgląd NIE zaznacza nagłówka,
//     a „Zastosuj" zapisuje wszystkie kraje - także pierwszy.
//   * Jeden wiersz z flagą („IT | 59 | p") w pierwszej komórce niepustej
//     siatki to wklejenie od kotwicy, nie tabela zastępująca siatkę.
//   * Napis zapisany w treści, którego mapa nie odczyta, stoi w komórce
//     z `aria-invalid`, zdaniem i uwagą wiersza, a zapis innego wiersza go
//     nie kasuje.
//   * Kraj spoza regionu bez wartości ma własną uwagę (nie „kreskowany").
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import "@/lib/i18n-map-editor";
import type { GeoAsset } from "@/lib/charts/types";
import { MapDataGrid } from "../MapDataGrid";
import type { MapEditorRow } from "../mapGridState";

vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(React);
});

const EUROPA = (JSON.parse(readFileSync("public/geo/europe-50m.v2.json", "utf8")) as GeoAsset)
  .countries;

function zamontuj(rows: MapEditorRow[]) {
  const onChange = vi.fn<(rows: readonly MapEditorRow[]) => void>();
  let biezace: readonly MapEditorRow[] = rows;
  function Host() {
    const [stan, setStan] = useState(biezace);
    return (
      <MapDataGrid
        rows={stan}
        onChange={(next) => {
          biezace = next;
          onChange(next);
          setStan(next);
        }}
        countries={EUROPA}
        docLang="pl"
        lang="pl"
      />
    );
  }
  render(<Host />);
  return { onChange, stan: () => biezace };
}

const pole = (nazwa: string) => screen.getByRole("textbox", { name: nazwa }) as HTMLInputElement;
const kod = (n: number) => pole(`Kod albo nazwa kraju, wiersz ${n}`);

function wklej(cel: Element, text: string) {
  const ev = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", {
    value: { getData: (typ: string) => (typ === "text/html" ? "" : text) },
  });
  act(() => {
    cel.dispatchEvent(ev);
  });
}

describe("wklejenie tabeli bez nagłówka", () => {
  it("„kod | nazwa | wartość” w pustej siatce: nagłówek wyłączony, trzy kraje po „Zastosuj”", () => {
    const { onChange, stan } = zamontuj([]);
    wklej(kod(1), "PL\tPolska\t5\nDE\tNiemcy\t7\nFR\tFrancja\t9");
    const okno = screen.getByRole("dialog", { name: "Wklejanie tabeli" });
    expect(
      within(okno).getByRole("checkbox", { name: "Pierwszy wiersz to nagłówek" }),
    ).not.toBeChecked();
    expect(within(okno).getByText("Kraje: 3")).toBeInTheDocument();
    fireEvent.click(within(okno).getByRole("button", { name: "Zastosuj" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(stan()).toEqual([
      { id: "PL", value: 5 },
      { id: "DE", value: 7 },
      { id: "FR", value: 9 },
    ]);
  });

  it("jeden wiersz z flagą w pierwszej komórce niepustej siatki - od kotwicy, bez podglądu", () => {
    const { onChange, stan } = zamontuj([
      { id: "PL", value: 1 },
      { id: "DE", value: 2 },
    ]);
    wklej(kod(1), "IT\t59\tp");
    expect(screen.queryByRole("dialog", { name: "Wklejanie tabeli" })).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(stan()).toEqual([
      { id: "IT", value: 59 },
      { id: "DE", value: 2 },
    ]);
  });
});

describe("napis zapisany w treści, którego mapa nie odczyta", () => {
  const WIERSZE: MapEditorRow[] = [
    { id: "PL", value: null, raw: "12%" },
    { id: "DE", value: 30 },
  ];

  it("komórka pokazuje napis z aria-invalid i zdaniem, wiersz - uwagę", () => {
    zamontuj(WIERSZE);
    const p = pole("Polska - wartość");
    expect(p.value).toBe("12%");
    expect(p).toHaveAttribute("aria-invalid", "true");
    expect(
      screen.getByText(/Mapa nie odczyta tej zapisanej wartości jako liczby/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Zapisana wartość nie jest liczbą, którą mapa odczyta/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Brak wartości - kraj będzie kreskowany/)).toBeNull();
  });

  it("zapis INNEGO wiersza oddaje napis bez zmian", () => {
    const { onChange, stan } = zamontuj(WIERSZE);
    const p = pole("Niemcy - wartość");
    fireEvent.focus(p);
    fireEvent.change(p, { target: { value: "31" } });
    fireEvent.blur(p);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(stan()).toEqual([
      { id: "PL", value: null, raw: "12%" },
      { id: "DE", value: 31 },
    ]);
  });

  it("poprawka w komórce zapisuje liczbę i zdejmuje napis", () => {
    const { stan } = zamontuj(WIERSZE);
    const p = pole("Polska - wartość");
    fireEvent.focus(p);
    fireEvent.change(p, { target: { value: "12" } });
    fireEvent.blur(p);
    expect(stan()[0]).toEqual({ id: "PL", value: 12 });
    expect(p).not.toHaveAttribute("aria-invalid");
  });
});

describe("kraj spoza regionu bez wartości", () => {
  it("uwaga mówi, że kraju nie będzie ani na rysunku, ani w nocie", () => {
    zamontuj([{ id: "JP", value: null }]);
    expect(
      screen.getByText(
        "Poza wybranym regionem i bez wartości - kraju nie będzie ani na rysunku, ani w nocie pod mapą.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/kreskowany/)).toBeNull();
  });
});
