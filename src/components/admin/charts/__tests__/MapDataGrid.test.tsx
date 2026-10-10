// ARKUSZ DANYCH MAPY (`MapDataGrid`) - kontrakt PR2 „DataGrid behaviour"
// przeniesiony na mapę:
//   1. komórka wartości trzyma SZKIC i zatwierdza go przez `parseImportedCell`;
//      wpis, który liczbą nie jest, dostaje `aria-invalid` i zdanie, a pusta
//      komórka to brak danych (kreskowanie), nie zero;
//   2. komórki to natywne pola `<input>`;
//   3. zakres wklejony w środek siatki trafia od komórki kotwicy JEDNYM
//      `onChange`; cała tabela wklejona w pustą siatkę otwiera podgląd;
//   4. klawiatura arkusza, przyciski wierszy poza Tabem, nazwa dostępna
//      komórki „{kraj} - wartość";
//   6. Ctrl+Z przy niezatwierdzonym wpisie cofa wpis i nie idzie dalej.
// Plus mapa: kod albo NAZWA kraju w komórce kodu (rozwiązywana do ISO-2),
// nazwa kraju w języku dokumentu i uwagi wierszy w tekście i dla czytnika.
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import "@/lib/i18n-map-editor";
import type { GeoAsset } from "@/lib/charts/types";
import { MAP_GRID_MAX_ROWS } from "@/lib/charts/gridModel";
import { MapDataGrid } from "../MapDataGrid";
import type { MapGridRow } from "../mapGridState";
import { CHART_GRID_ATTR, GRID_FLUSH_EVENT } from "../gridKeyboard";

vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(React);
});

const EUROPA = (JSON.parse(readFileSync("public/geo/europe-50m.v2.json", "utf8")) as GeoAsset)
  .countries;

function zamontuj(
  opts: {
    rows?: MapGridRow[];
    docLang?: "pl" | "en";
    countries?: typeof EUROPA | undefined;
    onFlush?: () => boolean | void;
  } = {},
) {
  const onChange = vi.fn<(rows: readonly MapGridRow[]) => void>();
  let biezace: readonly MapGridRow[] = opts.rows ?? [
    { id: "PL", value: 12 },
    { id: "DE", value: 30 },
  ];
  function Host() {
    const [rows, setRows] = useState(biezace);
    return (
      <MapDataGrid
        rows={rows}
        onChange={(next) => {
          biezace = next;
          onChange(next);
          setRows(next);
        }}
        countries={"countries" in opts ? opts.countries : EUROPA}
        docLang={opts.docLang ?? "pl"}
        lang="pl"
        onFlush={opts.onFlush}
      />
    );
  }
  const view = render(<Host />);
  return { onChange, stan: () => biezace, ...view };
}

const pole = (nazwa: string) => screen.getByRole("textbox", { name: nazwa }) as HTMLInputElement;
const kod = (n: number) => pole(`Kod albo nazwa kraju, wiersz ${n}`);

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

function wpisz(input: HTMLInputElement, tekst: string) {
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: tekst } });
  fireEvent.blur(input);
}

describe("wiersz = kraj: kod, nazwa w języku dokumentu, wartość", () => {
  it("komórki to natywne pola, a wartość nazywa się „{kraj} - wartość”", () => {
    zamontuj();
    expect(kod(1).tagName).toBe("INPUT");
    expect(kod(1).value).toBe("PL");
    expect(pole("Polska - wartość").value).toBe("12");
    expect(screen.getByText("Niemcy")).toBeInTheDocument();
  });

  it("dokument angielski: nazwy krajów po angielsku", () => {
    zamontuj({ docLang: "en" });
    expect(pole("Poland - wartość").value).toBe("12");
    expect(screen.getByText("Germany")).toBeInTheDocument();
  });

  it.each([
    ["Czechy", "CZ"],
    ["Czech Republic", "CZ"],
    ["UK", "GB"],
  ])("nazwa „%s” wpisana w komórkę kodu zamienia się na %s", (wpis, iso) => {
    const { onChange, stan } = zamontuj();
    wpisz(kod(1), wpis);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(stan()[0].id).toBe(iso);
    expect(kod(1).value).toBe(iso);
  });

  it("Enter zatwierdza kod raz i przenosi fokus wiersz niżej", () => {
    const { onChange } = zamontuj();
    const k = kod(1);
    k.focus();
    fireEvent.change(k, { target: { value: "Francja" } });
    fireEvent.keyDown(k, { key: "Enter" });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(kod(2));
    fireEvent.blur(k);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe("komórka wartości - szkic i zatwierdzenie", () => {
  it("„1,5” zatwierdza się jako 1.5 jednym zapisem", () => {
    const { onChange, stan } = zamontuj();
    wpisz(pole("Polska - wartość"), "1,5");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(stan()[0].value).toBe(1.5);
  });

  it("wpis nieliczbowy: aria-invalid i zdanie, a NIE cicha luka", () => {
    const { onChange } = zamontuj();
    const p = pole("Polska - wartość");
    wpisz(p, "abc");
    expect(onChange).not.toHaveBeenCalled();
    expect(p).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(/To nie jest liczba/)).toBeInTheDocument();
  });

  it("pusta komórka to brak danych - uwaga mówi o kreskowaniu", () => {
    const { stan } = zamontuj();
    wpisz(pole("Polska - wartość"), "");
    expect(stan()[0]).toEqual({ id: "PL", value: null });
    expect(
      screen.getByText("Brak wartości - kraj będzie kreskowany jako brak danych."),
    ).toBeInTheDocument();
  });
});

describe("uwagi wierszy - w tekście i dla czytnika ekranu", () => {
  it("nieznany kod: aria-invalid na komórce kodu, uwaga podpięta przez aria-describedby", () => {
    zamontuj({ rows: [{ id: "QQ", value: 1 }] });
    const k = kod(1);
    expect(k).toHaveAttribute("aria-invalid", "true");
    const opis = document.getElementById(k.getAttribute("aria-describedby") ?? "");
    expect(opis?.textContent).toBe("Nieznany kod albo nazwa kraju - wiersz nie trafi na mapę.");
  });

  it("kraj powtórzony i kraj spoza regionu", () => {
    zamontuj({
      rows: [
        { id: "PL", value: 1 },
        { id: "PL", value: 2 },
        { id: "US", value: 3 },
      ],
    });
    expect(
      screen.getByText("Kraj powtórzony - mapa pokaże wartość z wiersza 1."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Poza wybranym regionem - kraj trafi do noty pod mapą, nie na rysunek."),
    ).toBeInTheDocument();
  });

  it("zatwierdzenie wiersza z uwagą ogłasza ją czytnikowi ekranu", () => {
    zamontuj();
    wpisz(kod(1), "Narnia");
    expect(
      screen.getByText("Wiersz 1: Nieznany kod albo nazwa kraju - wiersz nie trafi na mapę.", {
        selector: "[aria-live] , [aria-live] *",
      }),
    ).toBeInTheDocument();
  });

  it("przed wczytaniem zasobu uwaga „poza regionem” milczy", () => {
    zamontuj({ rows: [{ id: "US", value: 1 }], countries: undefined });
    expect(screen.queryByText(/Poza wybranym regionem/)).toBeNull();
  });
});

describe("wklejenie", () => {
  it("zakres w środku siatki: od komórki kotwicy, JEDNYM zapisem, z uwagami pod siatką", () => {
    const { onChange, stan } = zamontuj();
    const ev = wklej(pole("Niemcy - wartość"), { text: "40\n50,5" });
    expect(ev.defaultPrevented).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(stan()).toEqual([
      { id: "PL", value: 12 },
      { id: "DE", value: 40 },
      { id: "", value: 50.5 },
    ]);
    expect(screen.getByText("Wklejono dane z arkusza.")).toBeInTheDocument();
  });

  it("kraj i wartość wklejone w kolumnę kodu - nazwa kraju też jest rozwiązywana", () => {
    const { onChange, stan } = zamontuj();
    wklej(kod(2), { text: "Czechy\t7\nFrancja\t8" });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(stan()).toEqual([
      { id: "PL", value: 12 },
      { id: "CZ", value: 7 },
      { id: "FR", value: 8 },
    ]);
  });

  it("cała tabela w PUSTEJ siatce otwiera podgląd; „Zastosuj” zastępuje dane jednym zapisem", () => {
    const { onChange, stan } = zamontuj({ rows: [] });
    wklej(kod(1), { text: "Kraj\tWartość\nPolska\t1\nNiemcy\t2" });
    expect(onChange).not.toHaveBeenCalled();
    const okno = screen.getByRole("dialog", { name: "Wklejanie tabeli" });
    fireEvent.click(within(okno).getByRole("button", { name: "Zastosuj" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(stan()).toEqual([
      { id: "PL", value: 1 },
      { id: "DE", value: 2 },
    ]);
  });

  it("pusta siatka pokazuje wiersz-zachętę; wpis w nim tworzy pierwszy wiersz", () => {
    const { stan } = zamontuj({ rows: [] });
    wpisz(kod(1), "pl");
    expect(stan()).toEqual([{ id: "PL", value: null }]);
  });
});

describe("menu wiersza i klawiatura", () => {
  it("przycisk menu jest poza Tabem, a „Wstaw wiersz poniżej” to jeden zapis", () => {
    const { onChange, stan } = zamontuj();
    const przycisk = screen.getByRole("button", { name: "Działania na wierszu Polska" });
    expect(przycisk).toHaveAttribute("tabIndex", "-1");
    fireEvent.click(przycisk);
    fireEvent.click(screen.getByRole("menuitem", { name: "Wstaw wiersz poniżej" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(stan()).toHaveLength(3);
    expect(stan()[1]).toEqual({ id: "", value: null });
  });

  it("przesuń w dół i usuń", () => {
    const { stan } = zamontuj();
    fireEvent.click(screen.getByRole("button", { name: "Działania na wierszu Polska" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Przesuń w dół" }));
    expect(stan().map((r) => r.id)).toEqual(["DE", "PL"]);
    fireEvent.click(screen.getByRole("button", { name: "Działania na wierszu Polska" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Usuń wiersz" }));
    expect(stan().map((r) => r.id)).toEqual(["DE"]);
  });

  it("Shift+F10 w komórce otwiera menu wiersza", () => {
    zamontuj();
    fireEvent.keyDown(kod(1), { key: "F10", shiftKey: true });
    expect(screen.getByRole("menu", { name: "Działania na wierszu Polska" })).toBeInTheDocument();
  });

  it("Ctrl+Z przy niezatwierdzonym wpisie cofa wpis i nie idzie dalej", () => {
    zamontuj();
    const k = kod(1);
    fireEvent.change(k, { target: { value: "Czec" } });
    const ev = new KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    const nasluch = vi.fn();
    document.addEventListener("keydown", nasluch);
    act(() => {
      k.dispatchEvent(ev);
    });
    document.removeEventListener("keydown", nasluch);
    expect(ev.defaultPrevented).toBe(true);
    expect(nasluch).not.toHaveBeenCalled();
    expect(k.value).toBe("PL");
  });

  it("dodawanie kończy się na limicie wierszy - z komunikatem", () => {
    const pelne = Array.from({ length: MAP_GRID_MAX_ROWS }, () => ({ id: "", value: null }));
    zamontuj({ rows: pelne });
    expect(screen.getByRole("button", { name: "Dodaj kraj" })).toBeDisabled();
    expect(screen.getByText(`Osiągnięto limit wierszy: ${MAP_GRID_MAX_ROWS}.`)).toBeInTheDocument();
  });

  it("korzeń siatki niesie atrybut Ctrl+Z i przyjmuje zdarzenie opróżnienia", () => {
    const onFlush = vi.fn(() => true);
    const { container } = zamontuj({ onFlush });
    const root = container.querySelector(`[${CHART_GRID_ATTR}]`);
    expect(root).not.toBeNull();
    const detail = { flushed: false };
    root?.dispatchEvent(new CustomEvent(GRID_FLUSH_EVENT, { detail }));
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(detail.flushed).toBe(true);
  });
});
