// ORZECZENIE NIEOSIĄGALNE JEST ORZECZENIEM MARTWYM.
//
// CO SIĘ STAŁO. Cztery orzeczenia uczciwości - każde napisane po to, żeby
// powiedzieć autorowi, że część jego liczb nie weszła na rysunek - nie mogły
// zapalić się NIGDY na drodze z bloku, czyli na jedynej drodze, która istnieje
// w produkcji. Sonda przed poprawką (arkusz: dwie kategorie, dwie serie po
// cztery liczby):
//
//   percentStacked   ["scaleNote"]
//   indexBase        ["axis.unitless","base.source.first","axisTruncated","note.flat.1"]
//   smallMultiples   ["scale.shared","order",…]           <- bez `inGridOk`
//   fan (krok 40)    ["reading.noForecast","reading.noBand"]
//
// DLACZEGO. `parseChartSeries` przycina każdą serię do liczby kategorii, a
// `parseForecastFrom` zeruje granicę spoza zakresu - i JEDNO I DRUGIE MUSI
// ZOSTAĆ: rendery kartezjańskie chodzą po `values` bez ograniczenia, więc
// nadmiarowa liczba narysowałaby punkt za osią, a `forecastFrom` ma zostać
// liczbą, którą wolno bez sprawdzania wstawić do geometrii. Przycinany był
// jednak także SAM FAKT, że coś odrzucono - i modele, które liczą nadmiar
// same, nie miały go z czego policzyć.
//
// Testy modeli były zielone przez cały czas trwania defektu, bo budowały
// wejście z ręki. Ta bramka chodzi WYŁĄCZNIE drogą z bloku: `parseChartConfig`
// i render, bez ani jednego obiektu składanego ręcznie.
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { Json } from "@/lib/content-model/json";
import { parseChartConfig } from "@/lib/charts/parse";
import { FanChart } from "../FanChart";
import { IndexBaseChart } from "../IndexBaseChart";
import { PercentStackedChart } from "../PercentStackedChart";
import { SmallMultiplesChart } from "../SmallMultiplesChart";

const klucze = (root: HTMLElement): string[] =>
  [...root.querySelectorAll("[data-note]")].map((el) => el.getAttribute("data-note") ?? "");

/** Arkusz z nadmiarem: dwie kategorie, a w każdej serii cztery liczby. */
const NADMIAR: Record<string, Json> = {
  categories: ["I", "II"],
  series: [
    { name: "A", values: [10, 20, 30, 40] },
    { name: "B", values: [5, 5, 5, 5] },
  ],
  animate: false,
};

/** Ten sam arkusz BEZ nadmiaru - do sprawdzenia, że uwaga nie stoi zawsze. */
const ROWNO: Record<string, Json> = {
  categories: ["I", "II"],
  series: [
    { name: "A", values: [10, 20] },
    { name: "B", values: [5, 5] },
  ],
  animate: false,
};

const RODZAJE = [
  ["percentStacked", PercentStackedChart, "honesty.droppedValues"],
  ["indexBase", IndexBaseChart, "honesty.pointsInPeriodsOk"],
  ["smallMultiples", SmallMultiplesChart, "honesty.inGridOk"],
] as const;

describe("liczby bez kategorii docierają do uwagi DROGĄ Z BLOKU", () => {
  it("parser liczy odrzucone liczby, zamiast je tylko wycinać", () => {
    const cfg = parseChartConfig(NADMIAR);
    // Przycięcie ZOSTAJE - render nie może dostać punktu bez kategorii...
    expect(cfg.series[0].values).toHaveLength(2);
    // ...ale fakt odrzucenia jedzie dalej.
    expect(cfg.valuesBeyondCategories).toBe(4);
    expect(parseChartConfig(ROWNO).valuesBeyondCategories).toBe(0);
  });

  for (const [nazwa, Rodzaj, klucz] of RODZAJE) {
    it(`${nazwa}: ${klucz} zapala się na arkuszu z nadmiarem`, () => {
      const { container } = render(<Rodzaj config={parseChartConfig(NADMIAR)} lang="pl" />);
      expect(klucze(container), `${nazwa}: uwaga nieosiągalna z bloku`).toContain(klucz);
    });

    it(`${nazwa}: ${klucz} MILCZY, gdy nic nie odrzucono`, () => {
      // Bez tej połowy bramka byłaby spełniona również przez uwagę wypisywaną
      // ZAWSZE - a lista, na której zawsze coś stoi, uczy pomijania całej listy.
      const { container } = render(<Rodzaj config={parseChartConfig(ROWNO)} lang="pl" />);
      expect(klucze(container), `${nazwa}: uwaga widoczna bez powodu`).not.toContain(klucz);
    });
  }

  it("wachlarz: odrzucona granica prognozy też dociera do uwagi", () => {
    const poza = parseChartConfig({
      categories: ["2021", "2022", "2023", "2024"],
      series: [{ name: "PKB", values: [100, 104, 107, 111] }],
      forecastFrom: 40,
      animate: false,
    });
    // Wartość UŻYTECZNA nadal wycięta, deklaracja zachowana.
    expect(poza.forecastFrom).toBeNull();
    expect(poza.forecastFromDeclared).toBe(40);
    const { container } = render(<FanChart config={poza} lang="pl" />);
    expect(klucze(container)).toContain("honesty.boundaryDropped");
  });

  it("wachlarz: granica W ZAKRESIE nie jest nazwana odrzuconą", () => {
    const dobra = parseChartConfig({
      categories: ["2021", "2022", "2023", "2024"],
      series: [{ name: "PKB", values: [100, 104, 107, 111] }],
      forecastFrom: 2,
      animate: false,
    });
    expect(dobra.forecastFromDeclared).toBe(2);
    const { container } = render(<FanChart config={dobra} lang="pl" />);
    expect(klucze(container)).not.toContain("honesty.boundaryDropped");
  });
});
