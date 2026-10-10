// WYBÓR SKALI BARW MAPY (`MapScalePicker`) - wspólny dla bloku i buildera.
//
//   * schemat to grupa przycisków radiowych, a każda opcja ma PRAWDZIWE
//     próbki (klasy policzone modelem skali mapy, na tokenach - bez hexa)
//     i nazwę kanoniczną - kolor nigdy nie jest jedynym nośnikiem wyboru;
//   * liczba klas (skala ciągła albo 3-7), metoda (ukryta przy skali
//     ciągłej), środek skali (tylko w schemacie rozbieżnym, przecinek
//     dziesiętny dozwolony);
//   * mini-legenda liczy klasy `mapScale` na AKTUALNYCH danych.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@/lib/i18n-map-editor";
import { MAP_SCHEMES } from "@/lib/charts/types";
import { MapScalePicker, type MapScaleValue } from "../MapScalePicker";

vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(React);
});

const WARTOSCI = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

function zamontuj(value: Partial<MapScaleValue> = {}, extra: Record<string, unknown> = {}) {
  const onChange = vi.fn<(p: Partial<MapScaleValue>) => void>();
  const view = render(
    <MapScalePicker
      value={{ scheme: "blue", classes: 5, method: "quantile", midpoint: null, ...value }}
      onChange={onChange}
      values={WARTOSCI}
      showNoData={false}
      unit="%"
      docLang="pl"
      lang="pl"
      {...extra}
    />,
  );
  return { onChange, ...view };
}

describe("schemat - grupa radiowa z próbkami i nazwą", () => {
  it("cztery schematy z nazwami kanonicznymi; zaznaczony jest bieżący", () => {
    zamontuj({ scheme: "slate" });
    const grupa = screen.getByRole("radiogroup", { name: "Schemat barw" });
    const opcje = within(grupa).getAllByRole("radio");
    expect(opcje).toHaveLength(MAP_SCHEMES.length);
    expect(within(grupa).getByRole("radio", { name: /łupkowy/ })).toBeChecked();
    for (const nazwa of [
      "niebieski",
      "łupkowy",
      "pomarańczowy (akcent)",
      "rozbieżny (spadek - wzrost)",
    ]) {
      expect(within(grupa).getByText(nazwa)).toBeInTheDocument();
    }
  });

  it("próbki to klasy na tokenach mapy - bez jednego hexa", () => {
    const { container } = zamontuj();
    for (const scheme of MAP_SCHEMES) {
      const opcja = container.querySelector(`[data-map-scheme="${scheme}"]`);
      const probki = Array.from(opcja?.querySelectorAll<HTMLElement>(".neh-map-swatch") ?? []);
      expect(probki, scheme).toHaveLength(5);
      for (const p of probki) {
        const farba = p.style.getPropertyValue("--neh-map-swatch");
        expect(farba, scheme).toMatch(/var\(--chart-/);
        expect(farba, scheme).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      }
    }
    // Rozbieżny: środkowa próbka to neutralny środek skali.
    const srodek = container
      .querySelectorAll<HTMLElement>('[data-map-scheme="diverging"] .neh-map-swatch')[2]
      ?.style.getPropertyValue("--neh-map-swatch");
    expect(srodek).toBe("var(--chart-map-div-mid)");
  });

  it("wybór schematu oddaje łatkę z samym schematem", () => {
    const { onChange } = zamontuj();
    fireEvent.click(screen.getByRole("radio", { name: /pomarańczowy/ }));
    expect(onChange).toHaveBeenCalledWith({ scheme: "accent" });
  });
});

describe("klasy, metoda, środek skali", () => {
  it("liczba klas: skala ciągła i 3-7 klas", () => {
    const { onChange } = zamontuj();
    const lista = screen.getByRole("combobox", { name: "Liczba klas" }) as HTMLSelectElement;
    expect(Array.from(lista.options).map((o) => o.textContent)).toEqual([
      "skala ciągła",
      "3 klasy",
      "4 klasy",
      "5 klas",
      "6 klas",
      "7 klas",
    ]);
    fireEvent.change(lista, { target: { value: "3" } });
    expect(onChange).toHaveBeenCalledWith({ classes: 3 });
  });

  it("metoda podziału jest ukryta przy skali ciągłej", () => {
    zamontuj({ classes: 0 });
    expect(screen.queryByRole("combobox", { name: "Metoda podziału" })).toBeNull();
  });

  it("metoda podziału przy klasach - nazwy kanoniczne", () => {
    const { onChange } = zamontuj();
    const lista = screen.getByRole("combobox", { name: "Metoda podziału" }) as HTMLSelectElement;
    expect(Array.from(lista.options).map((o) => o.textContent)).toEqual([
      "kwantyle (równe liczebności)",
      "równe przedziały",
    ]);
    fireEvent.change(lista, { target: { value: "equal" } });
    expect(onChange).toHaveBeenCalledWith({ method: "equal" });
  });

  it("środek skali tylko w schemacie rozbieżnym - przecinek dziesiętny dozwolony", () => {
    zamontuj();
    expect(screen.queryByRole("textbox", { name: /Środek skali/ })).toBeNull();
    const { onChange } = zamontuj({ scheme: "diverging" });
    fireEvent.change(screen.getByRole("textbox", { name: /Środek skali/ }), {
      target: { value: "1,5" },
    });
    expect(onChange).toHaveBeenCalledWith({ midpoint: 1.5 });
  });

  it('builder (`parts="scheme"`): sam schemat i legenda - reszta to pola panelu', () => {
    zamontuj({ scheme: "diverging" }, { parts: "scheme" });
    expect(screen.getByRole("radiogroup")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Liczba klas" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: /Środek skali/ })).toBeNull();
  });
});

// ŚRODEK SKALI - wpis, który nie jest liczbą, nie może cicho zamienić się
// w 0. Pusty środek znaczy 0, a 0 to prawdziwy środek: mapa przemalowałaby
// się wokół niego, a pole dalej pokazywałoby wpis autora. Pole czyta liczby
// regułą komórki arkusza (minus typograficzny, spacja tysięcy z Excela),
// a wpis nie do odczytania zostawia zapisany środek i dostaje `aria-invalid`
// ze zdaniem - jak komórka siatki danych.
describe("środek skali - wpis spoza liczb", () => {
  const pole = (): HTMLInputElement =>
    screen.getByRole("textbox", { name: /Środek skali/ }) as HTMLInputElement;

  it.each([
    ["37\u00a0600", 37600],
    ["1 234,5", 1234.5],
    ["\u22122", -2],
    ["2,5", 2.5],
  ])("„%s” czyta się jak w arkuszu: %d", (wpis, liczba) => {
    const { onChange } = zamontuj({ scheme: "diverging" });
    fireEvent.change(pole(), { target: { value: wpis } });
    expect(onChange).toHaveBeenCalledWith({ midpoint: liczba });
  });

  it("wpis nie do odczytania nie zapisuje braku - środek zostaje, pole mówi, co jest nie tak", () => {
    const { onChange } = zamontuj({ scheme: "diverging", midpoint: 5 });
    fireEvent.change(pole(), { target: { value: "pięć" } });
    fireEvent.blur(pole());
    expect(onChange).not.toHaveBeenCalled();
    expect(pole().value).toBe("pięć");
    expect(pole()).toHaveAttribute("aria-invalid", "true");
    const opis = document.getElementById(pole().getAttribute("aria-describedby") ?? "");
    expect(opis?.textContent).toBe(
      "To nie jest liczba - mapa zostaje przy poprzednim środku skali. Popraw wpis albo wyczyść pole (puste = 0).",
    );
  });

  it("poprawka zdejmuje uwagę i zapisuje liczbę", () => {
    const { onChange } = zamontuj({ scheme: "diverging", midpoint: 5 });
    fireEvent.change(pole(), { target: { value: "x" } });
    fireEvent.blur(pole());
    fireEvent.change(pole(), { target: { value: "7" } });
    expect(onChange).toHaveBeenCalledWith({ midpoint: 7 });
    expect(pole()).not.toHaveAttribute("aria-invalid");
  });

  it("puste pole to świadome 0 (brak klucza), bez uwagi", () => {
    const { onChange } = zamontuj({ scheme: "diverging", midpoint: 5 });
    fireEvent.change(pole(), { target: { value: "" } });
    fireEvent.blur(pole());
    expect(onChange).toHaveBeenCalledWith({ midpoint: null });
    expect(pole()).not.toHaveAttribute("aria-invalid");
  });

  it("panel angielski: zdanie po angielsku", () => {
    zamontuj({ scheme: "diverging", midpoint: 5 }, { lang: "en" });
    const pl = screen.getByRole("textbox", { name: /Scale midpoint/ });
    fireEvent.change(pl, { target: { value: "five" } });
    fireEvent.blur(pl);
    expect(
      screen.getByText(
        "This is not a number - the map keeps the previous midpoint. Correct the entry or clear the field (empty = 0).",
      ),
    ).toBeInTheDocument();
  });
});

describe("mini-legenda na aktualnych danych", () => {
  it("pięć klas kwantylowych z przedziałami w jednostce", () => {
    const { container } = zamontuj();
    const podglad = container.querySelector("[data-map-legend-preview]");
    expect(podglad?.querySelectorAll("[data-map-class]")).toHaveLength(5);
    expect(podglad?.textContent).toMatch(/%/);
    expect(podglad?.textContent).toMatch(/kwantyle/);
  });

  it("skala ciągła: gradient zamiast klas", () => {
    const { container } = zamontuj({ classes: 0 });
    const legenda = container.querySelector(".neh-map-legend");
    expect(legenda?.getAttribute("data-scale")).toBe("continuous");
  });

  it("bez wartości i bez krajów bez danych - zdanie zamiast pustej legendy", () => {
    zamontuj({}, { values: [] });
    expect(screen.getByText("Legenda pojawi się, gdy mapa dostanie wartości.")).toBeInTheDocument();
  });
});
