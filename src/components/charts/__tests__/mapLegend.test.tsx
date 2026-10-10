// LEGENDA KARTOGRAMU (`MapLegend.tsx`) - klucz koloru mapy danych.
//
// Legenda jest JEDYNYM miejscem, w którym kolor mapy dostaje liczbę: tabela
// podaje wartości krajów, ale nie mówi, co znaczy odcień. Pilnujemy więc
// czterech rzeczy, które dotąd nie istniały (stara legenda była paskiem
// min-max):
//   * KLASY - każdy stopień ma próbkę w kolorze klasy i przedział w formacie
//     jednostki („od 10 do 20 mld EUR"), a pod listą stoi nazwa metody
//     podziału - kanoniczna, ta sama co w edytorze;
//   * SKALA CIĄGŁA - gradient od koloru minimum do koloru maksimum i dwie
//     liczby (jedna przy zdegenerowanej domenie);
//   * SCHEMAT ROZBIEŻNY - punkt środkowy słowami, a w skali ciągłej także
//     przystanek gradientu w jego POŁOŻENIU w domenie;
//   * BRAK DANYCH - próbka kreskowana z tokenów, ta sama co na mapie.
//
// Farby próbek i paska jadą własnościami niestandardowymi (`--neh-map-swatch`,
// `--neh-map-bar`) - patrz `paint()` w `MapLegend.tsx` - więc test czyta je
// przez `getPropertyValue`.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { mapScale, type MapScale } from "@/lib/charts/kinds/mapScale";
import type { MapMethod } from "@/lib/charts/types";
import { MapLegend } from "../MapLegend";

afterEach(cleanup);

const WARTOSCI = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

function legenda(
  scale: MapScale,
  opts: {
    lang?: "pl" | "en";
    unit?: string;
    method?: MapMethod;
    showNoData?: boolean;
    colorOf?: (v: number) => string;
  } = {},
) {
  return render(
    <MapLegend
      scale={scale}
      colorOf={opts.colorOf ?? ((v) => scale.colorOf(v))}
      method={opts.method ?? "quantile"}
      lang={opts.lang ?? "pl"}
      unit={opts.unit ?? ""}
      showNoData={opts.showNoData ?? false}
    />,
  );
}

const pozycje = (root: HTMLElement): HTMLElement[] => [
  ...root.querySelectorAll<HTMLElement>("[data-map-class]"),
];

describe("legenda klas", () => {
  it("każdy stopień ma próbkę w kolorze klasy i przedział w formacie jednostki", () => {
    const scale = mapScale(WARTOSCI, "blue", 5, "equal", null);
    const { container } = legenda(scale, { unit: " mld EUR", method: "equal" });
    const items = pozycje(container);
    expect(items).toHaveLength(scale.classes.length);
    expect(items.map((li) => li.textContent)).toEqual([
      "od 10 do 28 mld EUR",
      "od 28 do 46 mld EUR",
      "od 46 do 64 mld EUR",
      "od 64 do 82 mld EUR",
      "od 82 do 100 mld EUR",
    ]);
    items.forEach((li, i) => {
      const probka = li.querySelector<HTMLElement>(".neh-map-swatch");
      expect(probka?.getAttribute("aria-hidden")).toBe("true");
      expect(probka?.style.getPropertyValue("--neh-map-swatch")).toBe(scale.classes[i].color);
    });
  });

  it("procent przykleja się do górnej granicy, a angielski mówi „to”", () => {
    const scale = mapScale(WARTOSCI, "slate", 3, "equal", null);
    const { container } = legenda(scale, { lang: "en", unit: "%", method: "equal" });
    expect(pozycje(container).map((li) => li.textContent)).toEqual([
      "10 to 40%",
      "40 to 70%",
      "70 to 100%",
    ]);
  });

  it("pod listą stoi KANONICZNA nazwa metody podziału (PL i EN)", () => {
    const scale = mapScale(WARTOSCI, "blue", 4, "quantile", null);
    const pl = legenda(scale, { method: "quantile" });
    expect(pl.container.textContent).toContain("Podział: kwantyle (równe liczebności)");
    pl.unmount();
    const en = legenda(scale, { lang: "en", method: "equal" });
    expect(en.container.textContent).toContain("Classes: Equal intervals");
  });

  it("klasa zerowej szerokości (jedna wartość) to jedna liczba, nie „od 5 do 5”", () => {
    const scale = mapScale([5, 5, 5], "accent", 5, "quantile", null);
    const { container } = legenda(scale, { unit: " pkt" });
    expect(pozycje(container).map((li) => li.textContent)).toEqual(["5 pkt"]);
  });

  it("grupa ma nazwę dla czytnika ekranu w języku strony", () => {
    const scale = mapScale(WARTOSCI, "blue", 5, "quantile", null);
    const pl = legenda(scale);
    expect(pl.container.querySelector("[role='group']")?.getAttribute("aria-label")).toBe(
      "Legenda mapy",
    );
    pl.unmount();
    const en = legenda(scale, { lang: "en" });
    expect(en.container.querySelector("[role='group']")?.getAttribute("aria-label")).toBe(
      "Map legend",
    );
  });
});

describe("legenda skali ciągłej", () => {
  it("gradient idzie od koloru minimum do koloru maksimum, liczby stoją po bokach", () => {
    const scale = mapScale(WARTOSCI, "slate", 0, "quantile", null);
    const { container } = legenda(scale, { unit: " mld" });
    const pasek = container.querySelector<HTMLElement>("span[aria-hidden].rounded-full");
    const tlo = pasek?.style.getPropertyValue("--neh-map-bar") ?? "";
    expect(tlo).toContain("linear-gradient");
    expect(tlo).toContain(scale.colorOf(10));
    expect(tlo).toContain(scale.colorOf(100));
    expect(
      [...container.querySelectorAll(".neh-map-legend-scale span.tabular-nums")].map(
        (s) => s.textContent,
      ),
    ).toEqual(["10 mld", "100 mld"]);
    // Skala ciągła nie ma metody podziału - nie ma czego nazywać.
    expect(container.textContent).not.toContain("Podział");
  });

  it("legenda maluje tą samą farbą co mapa (`colorOf` od mapy wygrywa z modelem)", () => {
    const scale = mapScale(WARTOSCI, "blue", 0, "quantile", null);
    const { container } = legenda(scale, { colorOf: (v) => `var(--probe-${v})` });
    const tlo =
      container
        .querySelector<HTMLElement>("span[aria-hidden].rounded-full")
        ?.style.getPropertyValue("--neh-map-bar") ?? "";
    expect(tlo).toContain("var(--probe-10)");
    expect(tlo).toContain("var(--probe-100)");
  });

  it("zdegenerowana domena: jedna próbka i jedna liczba", () => {
    const scale = mapScale([42], "blue", 0, "quantile", null);
    const { container } = legenda(scale, { unit: " mld" });
    expect(
      [...container.querySelectorAll(".neh-map-legend-scale span.tabular-nums")].map(
        (s) => s.textContent,
      ),
    ).toEqual(["42 mld"]);
    expect(container.innerHTML).not.toContain("linear-gradient");
  });

  it("brak wartości = brak legendy", () => {
    const { container } = legenda(mapScale([], "blue", 0, "quantile", null));
    expect(container.innerHTML).toBe("");
  });
});

describe("schemat rozbieżny - punkt środkowy", () => {
  it("skala ciągła: przystanek środka w jego położeniu w domenie i podpis słowami", () => {
    // Domena -20..80, środek 0 -> 20% szerokości paska, nie połowa.
    const scale = mapScale([-20, 10, 80], "diverging", 0, "quantile", 0);
    const { container } = legenda(scale, { unit: " p.p." });
    const tlo =
      container
        .querySelector<HTMLElement>("span[aria-hidden].rounded-full")
        ?.style.getPropertyValue("--neh-map-bar") ?? "";
    expect(tlo).toContain("var(--chart-map-div-mid) 20%");
    expect(container.querySelector("[data-map-midpoint]")?.textContent).toBe(
      "Punkt środkowy: 0 p.p.",
    );
  });

  it("klasy: punkt środkowy też jest w legendzie (EN)", () => {
    const scale = mapScale([-30, -10, 5, 20, 40], "diverging", 5, "equal", 2.5);
    const { container } = legenda(scale, { lang: "en", method: "equal" });
    expect(container.querySelector("[data-map-midpoint]")?.textContent).toBe("Midpoint: 2.5");
  });

  it("schemat sekwencyjny nie ma punktu środkowego", () => {
    const scale = mapScale(WARTOSCI, "blue", 5, "quantile", 50);
    const { container } = legenda(scale);
    expect(container.querySelector("[data-map-midpoint]")).toBeNull();
  });
});

describe("brak danych", () => {
  it("próbka jest KRESKOWANA z tokenów - ten sam wzór co na mapie", () => {
    const scale = mapScale(WARTOSCI, "blue", 5, "quantile", null);
    const { container } = legenda(scale, { showNoData: true });
    const pozycja = container.querySelector<HTMLElement>("[data-map-nodata]");
    expect(pozycja?.textContent).toBe("brak danych");
    const tlo =
      pozycja
        ?.querySelector<HTMLElement>(".neh-map-swatch")
        ?.style.getPropertyValue("--neh-map-swatch") ?? "";
    expect(tlo).toContain("repeating-linear-gradient");
    expect(tlo).toContain("var(--chart-map-nodata-hatch)");
    expect(tlo).toContain("var(--chart-map-nodata)");
  });

  it("bez krajów bez danych nie ma pozycji „brak danych” (EN: „no data”)", () => {
    const scale = mapScale(WARTOSCI, "blue", 0, "quantile", null);
    const bez = legenda(scale, { showNoData: false });
    expect(bez.container.querySelector("[data-map-nodata]")).toBeNull();
    bez.unmount();
    const en = legenda(scale, { lang: "en", showNoData: true });
    expect(en.container.querySelector("[data-map-nodata]")?.textContent).toBe("no data");
  });
});
