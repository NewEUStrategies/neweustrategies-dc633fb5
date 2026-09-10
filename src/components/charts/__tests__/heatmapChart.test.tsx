// MAPA CIEPŁA - CO MUSI BYĆ PRAWDĄ O RYSUNKU.
//
// SKĄD BIORĘ LICZBY. `useContainerWidth` czyta `clientWidth`, które
// w happy-dom wynosi 0, więc szerokość zostaje na wartości startowej 720 -
// geometria jest w pełni deterministyczna i można asertować piksele.
// `useRevealOnScroll` nigdy nie dostaje callbacku IntersectionObservera, więc
// stan to zawsze "static", czyli dokładnie to, co widzi crawler. Szerokość
// i wysokość pola rysunku czytam z warstwy trafień, a nie liczę drugi raz
// w teście: lewy margines zależy od pomiaru etykiet wierszy, a drugie liczenie
// byłoby kopią implementacji, nie sprawdzeniem jej.
//
// CZEGO TU NIE MA. Wybór skali, pozycja na rampie, symetria wokół punktu
// neutralnego, brzegi obu osi, rozstrzygnięcie dominacji i wszystkie
// sprawdzenia uczciwości mają własny plik testowy przy modelu
// (`lib/charts/kinds/__tests__/heatmap.test.ts`). Tutaj sprawdzam wyłącznie to,
// czego model sprawdzić nie może: czy RYSUNEK mówi to, co model policzył.
//
// DWIE ŚCIEŻKI, KTÓRYCH Z KONFIGURACJI BLOKU NIE DA SIĘ WYWOŁAĆ, więc ich tu
// nie ma: `ChartConfig` nie ma pola na ŻĄDANIE skali ani na punkt neutralny
// inny niż zero, a `parseChartSeries` dopina każdą serię dokładnie do liczby
// kategorii. Dlatego z bloku nie powstanie ani macierz z wartościami poza
// siatką (`inGridOk`), ani skala sekwencyjna na danych obu znaków
// (`signEncodedOk`), ani rampa rozbieżna zdegradowana do sekwencyjnej. Render
// obsługuje wszystkie trzy, a wywołać je umie tylko test modelu.
import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import type { Json } from "@/lib/content-model/json";
import { parseChartConfig } from "@/lib/charts/parse";
import type { ChartConfig } from "@/lib/charts/types";
import { formatAxisTick, formatChartValue } from "@/lib/charts/format";
import { heatmapModelFromConfig, heatmapValueLabelFit } from "@/lib/charts/kinds/heatmap";
import { HeatmapChart } from "../HeatmapChart";

function cfg(data: Record<string, Json>): ChartConfig {
  return parseChartConfig(data);
}

const all = (root: HTMLElement, sel: string): Element[] => [...root.querySelectorAll(sel)];
const attr = (el: Element, name: string): number => Number(el.getAttribute(name));
const text = (el: Element | null): string => el?.textContent ?? "";

/**
 * Macierz 3 na 4: trzy poziomy ceny (wiersze) na cztery poziomy wolumenu
 * (kolumny). Wszystkie wartości dodatnie, więc model wybiera rampę
 * SEKWENCYJNĄ; zakres 10-56, więc granice kubełków wypadają na 10 / 19,2 /
 * 28,4 / 37,6 / 46,8 / 56. Średnie kolumnowe rozjeżdżają się mocniej niż
 * wierszowe (36 wobec 10), więc dominującym parametrem są kolumny.
 */
const BAZA: Record<string, Json> = {
  kind: "bar",
  categories: ["10", "20", "30", "40"],
  series: [
    { name: "Cena 90", values: [10, 20, 30, 40], colorSlot: 3 },
    { name: "Cena 100", values: [12, 24, 36, 48] },
    { name: "Cena 110", values: [14, 28, 42, 56] },
  ],
  animate: false,
};

/**
 * Macierz przechodząca przez zero: model bierze rampę ROZBIEŻNĄ i normalizuje
 * symetrycznie, bo większe odchylenie od punktu neutralnego wynosi 4 po obu
 * stronach. Sześć kubełków, siedem granic, punkt neutralny na granicy nr 3.
 */
const ZNAKI: Record<string, Json> = {
  kind: "bar",
  categories: ["10", "20", "30"],
  series: [
    { name: "A", values: [-4, -1, 2] },
    { name: "B", values: [-2, 1, 4] },
  ],
  animate: false,
};

/** Macierz z JEDNĄ luką i z prawdziwym zerem - dwie rzeczy, które nie mogą wyglądać tak samo. */
const LUKA: Record<string, Json> = {
  kind: "bar",
  categories: ["a", "b", "c"],
  series: [
    { name: "R1", values: [0, 5, 10] },
    { name: "R2", values: [null, 5, 10] },
    { name: "R3", values: [3, 6, 9] },
  ],
  animate: false,
};

/** happy-dom nie mierzy elementów - bez podmiany każdy `pointermove` to NaN. */
function stubPlotRect(hit: Element, width: number, height: number): void {
  Object.defineProperty(hit, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      width,
      height,
      toJSON: () => ({}),
    }),
  });
}

/** Warstwa trafień razem z podmienionym prostokątem - wzorzec z histogramu. */
function hitLayer(container: HTMLElement): Element {
  const hit = container.querySelector("rect.neh-hit[data-role='hits']");
  if (!hit) throw new Error("brak warstwy trafień");
  stubPlotRect(hit, attr(hit, "width"), attr(hit, "height"));
  return hit;
}

/** Komórka o podanym adresie - tak samo, jak ją znajduje czytelnik: po osiach. */
function komorka(container: HTMLElement, row: number, column: number): Element {
  const cell = container.querySelector(
    `rect[data-role='cell'][data-row='${row}'][data-column='${column}']`,
  );
  if (!cell) throw new Error(`brak komórki ${row}/${column}`);
  return cell;
}

describe("HeatmapChart - siatka komórek", () => {
  it("rysuje komórkę na KAŻDĄ parę wiersz-kolumna, w kolejności arkusza", () => {
    // Gdyby komórek było mniej niż par, część policzonych wyników nie miałaby
    // na rysunku miejsca i czytelnik nie miałby jak zauważyć ich braku -
    // macierz z dziurą po prostu wygląda jak macierz mniejsza.
    const { container } = render(<HeatmapChart config={cfg(BAZA)} lang="pl" />);
    expect(all(container, "rect[data-role='cell']")).toHaveLength(12);
    // Pierwsza seria jest PIERWSZYM wierszem od góry, pierwsza kategoria
    // pierwszą kolumną od lewej: pomyłka o jeden wiersz nie wygląda na błąd,
    // wygląda na inne dane.
    expect(attr(komorka(container, 0, 0), "y")).toBeLessThan(attr(komorka(container, 1, 0), "y"));
    expect(attr(komorka(container, 0, 0), "x")).toBeLessThan(attr(komorka(container, 0, 1), "x"));
  });

  it("komórki STYKAJĄ SIĘ krawędziami i wypełniają całe pole rysunku", () => {
    // Odstęp między komórkami twierdziłby, że między dwiema parami parametrów
    // jest zakres, którego w siatce nie ma - a siatka mapy ciepła jest
    // wyczerpująca: prawa krawędź jednej komórki JEST lewą krawędzią następnej.
    const { container } = render(<HeatmapChart config={cfg(BAZA)} lang="pl" />);
    const hit = hitLayer(container);
    const a = komorka(container, 0, 0);
    const b = komorka(container, 0, 1);
    expect(attr(a, "x") + attr(a, "width")).toBeCloseTo(attr(b, "x"), 6);
    expect(attr(a, "x")).toBeCloseTo(attr(hit, "x"), 6);
    expect(attr(komorka(container, 0, 3), "x") + attr(a, "width")).toBeCloseTo(
      attr(hit, "x") + attr(hit, "width"),
      6,
    );
  });

  it("wszystkie komórki mają JEDNAKOWY rozmiar", () => {
    // Powierzchnia komórki zaczęłaby kodować wagę, której dane nie mają:
    // każda para parametrów jest jednym policzonym scenariuszem i żaden nie
    // jest ważniejszy od drugiego.
    const { container } = render(<HeatmapChart config={cfg(BAZA)} lang="pl" />);
    const rozmiary = new Set(
      all(container, "rect[data-role='cell']").map(
        (c) => `${attr(c, "width").toFixed(4)}x${attr(c, "height").toFixed(4)}`,
      ),
    );
    expect(rozmiary.size).toBe(1);
  });
});

describe("HeatmapChart - kolor wynika z numeru kubełka", () => {
  it("kolor komórki jest DOKŁADNIE kolorem próbki legendy o tym samym numerze", () => {
    // To jest jedyna rzecz, którą czytelnik robi z legendą mapy ciepła:
    // przenosi wzrok z komórki na pasek i odczytuje przedział. Rozjazd
    // choćby o jeden stopień krycia znaczy, że odczyta przedział sąsiedni,
    // i nic na rysunku tego nie zdradzi.
    const { container } = render(<HeatmapChart config={cfg(BAZA)} lang="pl" />);
    const probki = new Map(
      all(container, "rect[data-role='legend-swatch']").map((s) => [
        s.getAttribute("data-bucket"),
        `${s.getAttribute("fill")}|${s.getAttribute("fill-opacity")}`,
      ]),
    );
    expect(probki.size).toBe(5);
    for (const cell of all(container, "rect[data-role='cell']")) {
      const kubelek = cell.getAttribute("data-bucket");
      expect(probki.get(kubelek)).toBe(
        `${cell.getAttribute("fill")}|${cell.getAttribute("fill-opacity")}`,
      );
    }
  });

  it("najmniejsza wartość dostaje najsłabszy kubełek, największa najmocniejszy", () => {
    // Odwrócona albo pozlepiana rampa zamienia mapę wrażliwości w ozdobę:
    // czytelnik czyta z niej KIERUNEK, w którym wynik rośnie, i to jest cała
    // treść rysunku.
    const { container } = render(<HeatmapChart config={cfg(BAZA)} lang="pl" />);
    expect(komorka(container, 0, 0).getAttribute("data-bucket")).toBe("0");
    expect(komorka(container, 2, 3).getAttribute("data-bucket")).toBe("4");
    const krycia = all(container, "rect[data-role='legend-swatch']").map((s) =>
      attr(s, "fill-opacity"),
    );
    for (let i = 1; i < krycia.length; i++) expect(krycia[i]).toBeGreaterThan(krycia[i - 1]);
  });

  it("rampa sekwencyjna bierze JEDEN odcień, i to ten ze slotu z arkusza", () => {
    // Dwa odcienie na jednej rampie sekwencyjnej dawałyby kolor kodujący
    // jednocześnie wielkość i coś jeszcze; a slot wzięty z wyczucia zamiast
    // z arkusza rozjeżdżałby mapę z resztą wykresów na tej samej stronie.
    const { container } = render(<HeatmapChart config={cfg(BAZA)} lang="pl" />);
    const odcienie = new Set(
      all(container, "rect[data-role='cell']").map((c) => c.getAttribute("fill")),
    );
    expect([...odcienie]).toEqual(["var(--chart-3)"]);
  });

  it("kolor jedzie WYŁĄCZNIE tokenem, nigdy hexem", () => {
    // Hex w silniku znaczy, że tryb ciemny i druk są już zepsute: rampa
    // policzona pod białą płytę na ciemnej płycie idzie w stronę tła.
    const { container } = render(<HeatmapChart config={cfg(BAZA)} lang="pl" />);
    expect(container.innerHTML).not.toMatch(/(fill|stroke)="#/);
    expect(container.innerHTML).not.toMatch(/rgb\(/);
  });
});

describe("HeatmapChart - skala rozbieżna i punkt neutralny", () => {
  it("zero wypada na GRANICY kubełków, czyli w punkcie neutralnym rampy", () => {
    // Kubełek, w którego środku leży zero, obejmowałby wartości obu znaków
    // pod jednym kolorem - czyli najważniejsza granica w całej macierzy
    // (wzrost wobec spadku) byłaby niewidoczna.
    const { container } = render(<HeatmapChart config={cfg(ZNAKI)} lang="pl" />);
    const granice = all(container, "text[data-role='legend-bound']");
    expect(granice).toHaveLength(7);
    const neutralna = granice.find((g) => g.getAttribute("data-bound") === "3");
    expect(text(neutralna ?? null)).toBe(formatAxisTick(0, "pl"));
  });

  it("strony punktu neutralnego mają różne ODCIENIE, a nie różne natężenia", () => {
    // Znak zakodowany samą jasnością znika u czytelnika, który nie rozróżnia
    // odcieni, i w wydruku w skali szarości: "spadek o 4" i "wzrost o 4"
    // wyglądałyby wtedy identycznie.
    const { container } = render(<HeatmapChart config={cfg(ZNAKI)} lang="pl" />);
    expect(komorka(container, 0, 0).getAttribute("fill")).toBe("var(--chart-negative)");
    expect(komorka(container, 1, 2).getAttribute("fill")).toBe("var(--chart-positive)");
    const probki = all(container, "rect[data-role='legend-swatch']");
    expect(probki).toHaveLength(6);
    expect(probki[2].getAttribute("fill")).toBe("var(--chart-negative)");
    expect(probki[3].getAttribute("fill")).toBe("var(--chart-positive)");
  });

  it("równe odchylenia w obie strony dostają RÓWNE natężenie", () => {
    // Normalizacja osobno po każdej stronie dawałaby przy zakresie od -1 do
    // +9 tę samą nasyconą barwę dla -1 i dla +9, więc spadek o jeden czytałby
    // się jako równie mocny co wzrost o dziewięć.
    const { container } = render(<HeatmapChart config={cfg(ZNAKI)} lang="pl" />);
    expect(attr(komorka(container, 0, 0), "fill-opacity")).toBeCloseTo(
      attr(komorka(container, 1, 2), "fill-opacity"),
      6,
    );
    expect(attr(komorka(container, 0, 1), "fill-opacity")).toBeCloseTo(
      attr(komorka(container, 1, 1), "fill-opacity"),
      6,
    );
  });

  it("rampa rozbieżna ma PARZYSTĄ liczbę kubełków, sekwencyjna nieparzystą", () => {
    // Parzystość nie jest estetyką: tylko przy niej granica kubełków może
    // wypaść dokładnie na punkcie neutralnym. Przy rampie sekwencyjnej
    // punktu neutralnego nie ma, więc nie ma czego trafiać.
    const { container: dwa } = render(<HeatmapChart config={cfg(ZNAKI)} lang="pl" />);
    const { container: jeden } = render(<HeatmapChart config={cfg(BAZA)} lang="pl" />);
    expect(all(dwa, "rect[data-role='legend-swatch']").length % 2).toBe(0);
    expect(dwa.querySelector("g[data-role='cells']")?.getAttribute("data-scale")).toBe("diverging");
    expect(jeden.querySelector("g[data-role='cells']")?.getAttribute("data-scale")).toBe(
      "sequential",
    );
  });
});

describe("HeatmapChart - luka nie jest zerem", () => {
  it("komórka bez wartości bierze TEKSTURĘ, nie stopień rampy", () => {
    // Najjaśniejszy stopień rampy jest już zajęty przez prawdziwą najmniejszą
    // wartość, więc luka pomalowana tym stopniem twierdziłaby, że coś tam
    // policzono i wyszło mało.
    const { container } = render(<HeatmapChart config={cfg(LUKA)} lang="pl" />);
    const luka = komorka(container, 1, 0);
    expect(luka.getAttribute("data-state")).toBe("gap");
    expect(luka.getAttribute("fill") ?? "").toMatch(/^url\(#/);
    expect(luka.getAttribute("data-bucket")).toBeNull();
    expect(container.querySelector("pattern")).not.toBeNull();
  });

  it("komórka o wartości ZERO ma kolor, nie teksturę", () => {
    // To jest cała różnica między "nie policzono" i "policzono, wyszło zero".
    // Dwa różne zdania o danych nie mogą wyglądać tak samo.
    const { container } = render(<HeatmapChart config={cfg(LUKA)} lang="pl" />);
    const zero = komorka(container, 0, 0);
    expect(zero.getAttribute("data-state")).toBe("value");
    expect(zero.getAttribute("data-bucket")).toBe("0");
    expect(zero.getAttribute("fill")).not.toBe(komorka(container, 1, 0).getAttribute("fill"));
  });

  it("legenda TŁUMACZY teksturę, gdy w macierzy jest luka", () => {
    // Kreskowanie bez klucza jest wzorkiem, a nie informacją "nie policzono" -
    // czytelnik zgadywałby, czy to dane, czy artefakt renderu.
    const { container } = render(<HeatmapChart config={cfg(LUKA)} lang="pl" />);
    expect(text(container.querySelector("text[data-role='legend-gap-label']"))).toBe("brak danych");
    expect(container.querySelector("rect[data-role='legend-gap-swatch']")).not.toBeNull();
  });

  it("macierz bez luk nie dostaje ani klucza luki, ani definicji tekstury", () => {
    // Klucz do stanu, którego na rysunku nie ma, uczy nie czytać legendy;
    // definicja wzoru bez odbiorcy jest czystym kosztem.
    const { container } = render(<HeatmapChart config={cfg(BAZA)} lang="pl" />);
    expect(container.querySelector("[data-role='legend-gap']")).toBeNull();
    expect(container.querySelector("pattern")).toBeNull();
  });
});

describe("HeatmapChart - liczby w komórkach", () => {
  it("wpisuje liczbę w komórkę, gdy się mieści, i robi to dla KAŻDEJ komórki", () => {
    // Z komórki mapy ciepła nie odczyta się wartości dokładniej niż
    // "ciemniejsza niż tamta", a dymka nie ma ani w druku, ani na zrzucie
    // ekranu. Liczba w komórce jest tu pełnoprawnym nośnikiem, nie ozdobą.
    const { container } = render(<HeatmapChart config={cfg(BAZA)} lang="pl" />);
    const liczby = all(container, "text[data-role='cell-value']");
    expect(liczby).toHaveLength(12);
    expect(text(liczby[0])).toBe(formatChartValue(10, "pl", ""));
  });

  it("liczba ma OTOK w kolorze płyty, rysowany pod literą", () => {
    // Rampa przechodzi przez półtony, na których ani ciemny, ani jasny tusz
    // nie sięga progu tekstowego 4,5:1. Otok przenosi rachunek kontrastu
    // z wypełnienia komórki na płytę, więc jeden tusz obsługuje całą rampę.
    const { container } = render(<HeatmapChart config={cfg(BAZA)} lang="pl" />);
    const liczba = all(container, "text[data-role='cell-value']")[0];
    expect(liczba.getAttribute("stroke")).toBe("var(--card)");
    expect(liczba.getAttribute("paint-order")).toBe("stroke");
    expect(liczba.getAttribute("fill")).toBe("var(--foreground)");
  });

  it("POMIAR RENDERU ma ostatnie słowo nad progiem gęstości z modelu", () => {
    // Model liczy gęstość siatki i nie zna pikseli; przy osiemnastu kolumnach
    // mówi "liczby się zmieszczą", a komórka ma wtedy 37 px, czyli mniej niż
    // czterocyfrowa liczba. Etykieta dotykająca krawędzi łamie wymaganie
    // "nic nie jest ucięte", a ucięta cyfra kłamie o wartości.
    const ciasna = {
      ...BAZA,
      categories: Array.from({ length: 18 }, (_, i) => String(i + 1)),
      series: [
        { name: "R1", values: Array.from({ length: 18 }, (_, i) => i + 1) },
        { name: "R2", values: Array.from({ length: 18 }, (_, i) => 2 * i + 2) },
      ],
    };
    const config = cfg(ciasna);
    // Model sam z siebie liczb nie odwołuje - to render mierzy i odwołuje.
    expect(heatmapValueLabelFit(heatmapModelFromConfig(config))).toBe(true);
    const { container } = render(<HeatmapChart config={config} lang="pl" />);
    expect(all(container, "text[data-role='cell-value']")).toHaveLength(0);
    // Rezygnacja z liczb W KOMÓRKACH nie jest rezygnacją z liczb: komplet
    // niesie tabela, która jest pod rysunkiem zawsze.
    expect(text(container.querySelector("table"))).toContain(formatChartValue(36, "pl", ""));
  });

  it("w komórce liczba jest BEZ jednostki, a w tabeli z jednostką", () => {
    // Jednostka należy do skali, nie do każdej z kilkudziesięciu komórek:
    // powtórzona przy każdej liczbie jest szumem i jest dokładnie tym, przez
    // co liczba przestaje się mieścić. Stoi więc raz, w nagłówku legendy.
    const { container } = render(<HeatmapChart config={cfg({ ...BAZA, unit: "%" })} lang="pl" />);
    expect(text(all(container, "text[data-role='cell-value']")[0])).toBe("10");
    expect(text(container.querySelector("table tbody td"))).toBe("10%");
    expect(text(container.querySelector("text[data-role='legend-head']"))).toContain("(%)");
  });
});

describe("HeatmapChart - legenda z granicami kubełków", () => {
  it("podpisuje GRANICE kubełków, czyli liczby, które zdecydowały o przydziale", () => {
    // Legenda z ładną podziałką mówiłaby o innym przydziale niż narysowany:
    // czytelnik odczytałby z niej przedział, do którego komórka nie należy.
    const { container } = render(<HeatmapChart config={cfg(BAZA)} lang="pl" />);
    const granice = all(container, "text[data-role='legend-bound']").map((g) => text(g));
    expect(granice).toHaveLength(6);
    expect(granice[0]).toBe(formatAxisTick(10, "pl"));
    expect(granice[5]).toBe(formatAxisTick(56, "pl"));
    // Kubełki równej szerokości: (56 - 10) / 5 = 9,2 na kubełek.
    expect(granice[1]).toBe(formatAxisTick(19.2, "pl"));
  });

  it("przy braku rozproszenia pokazuje JEDNĄ próbkę i JEDNĄ liczbę", () => {
    // Pięć próbek nad macierzą, w której wszystkie wartości są równe,
    // obiecywałoby porównanie, którego w danych nie ma - a jednolite pole
    // sugerowałoby pomiar wrażliwości, którego nikt nie zrobił.
    const rowne = {
      ...BAZA,
      series: [
        { name: "R1", values: [7, 7, 7, 7] },
        { name: "R2", values: [7, 7, 7, 7] },
      ],
    };
    const { container } = render(<HeatmapChart config={cfg(rowne)} lang="pl" />);
    expect(all(container, "rect[data-role='legend-swatch']")).toHaveLength(1);
    expect(all(container, "text[data-role='legend-bound']")).toHaveLength(1);
    expect(container.querySelector("[data-note='reading.noSpread']")).not.toBeNull();
  });

  it("podaje `n` jako liczbę WYPEŁNIONYCH komórek, nie rozmiar siatki", () => {
    // Siatka 3 na 3 z ośmioma policzonymi parami wygląda tak samo jak
    // wypełniona, a znaczy co innego (sekcja 8: podaj n). Liczba stoi
    // w legendzie, a nie w dymku, bo dymka nie ma w druku.
    const { container } = render(<HeatmapChart config={cfg(LUKA)} lang="pl" />);
    const naglowek = text(container.querySelector("text[data-role='legend-head']"));
    expect(naglowek).toContain("Skala");
    expect(naglowek).toContain(formatChartValue(8, "pl", ""));
  });

  it("macierz z samych luk nie dostaje paska skali", () => {
    // Próbki obiecywałyby klasy, których nie zajmuje ani jedna komórka -
    // legenda mówiłaby o rampie rozłożonej na danych, których nie ma.
    const puste = {
      ...BAZA,
      series: [
        { name: "R1", values: [null, null, null, null] },
        { name: "R2", values: [null, null, null, null] },
      ],
    };
    const { container } = render(<HeatmapChart config={cfg(puste)} lang="pl" />);
    expect(all(container, "rect[data-role='legend-swatch']")).toHaveLength(0);
    expect(container.querySelector("rect[data-role='legend-gap-swatch']")).not.toBeNull();
    expect(text(container.querySelector("[role='img']"))).not.toContain("NaN");
  });
});

describe("HeatmapChart - strefa trafienia", () => {
  it("wskaźnik wskazuje KOMÓRKĘ, a nie kolumnę: ten sam X, inny Y to inny wiersz", () => {
    // To jest cała różnica wobec pozostałych rodzajów. Adres z jednej
    // współrzędnej wskazywałby kolumnę, więc dymek pokazywałby wartość
    // z wiersza wybranego przez implementację, a nie przez czytelnika.
    const { container } = render(<HeatmapChart config={cfg(BAZA)} lang="pl" />);
    const hit = hitLayer(container);
    const w = attr(hit, "width");
    const h = attr(hit, "height");
    fireEvent.pointerMove(hit, { clientX: (w * 2.5) / 4, clientY: (h * 0.5) / 3 });
    expect(text(container.querySelector(".neh-tooltip"))).toContain("Cena 90");
    fireEvent.pointerMove(hit, { clientX: (w * 2.5) / 4, clientY: (h * 1.5) / 3 });
    const dymek = text(container.querySelector(".neh-tooltip"));
    expect(dymek).toContain("Cena 100");
    expect(dymek).toContain("30");
    expect(dymek).toContain(formatChartValue(36, "pl", ""));
  });

  it("POZA SIATKĄ nie ma dymka, bez dociskania do skrajnej komórki", () => {
    // Docisk twierdziłby, że wskaźnik stoi nad wartością, której w tym
    // miejscu nie ma - a wskaźnik bywa poza polem przy każdym zejściu na
    // etykiety kolumn i na legendę.
    const { container } = render(<HeatmapChart config={cfg(BAZA)} lang="pl" />);
    const hit = hitLayer(container);
    fireEvent.pointerMove(hit, {
      clientX: attr(hit, "width") * 0.5,
      clientY: attr(hit, "height") + 20,
    });
    expect(container.querySelector(".neh-tooltip")).toBeNull();
    expect(container.querySelector("rect[data-role='cell-active']")).toBeNull();
  });

  it("wskazana komórka dostaje obwódkę, a nie nowy rozmiar ani nowy kubełek", () => {
    // Hover zmienia stan POWIERZCHNI, nigdy kodowanie: komórka, która pod
    // wskaźnikiem rośnie albo zmienia stopień rampy, przez chwilę pokazuje
    // wartość, której nie ma.
    const { container } = render(<HeatmapChart config={cfg(BAZA)} lang="pl" />);
    const hit = hitLayer(container);
    const przed = komorka(container, 0, 0).getAttribute("fill-opacity");
    const rozmiar = attr(komorka(container, 0, 0), "width");
    fireEvent.pointerMove(hit, { clientX: 1, clientY: 1 });
    const obwodka = container.querySelector("rect[data-role='cell-active']");
    expect(obwodka).not.toBeNull();
    if (!obwodka) throw new Error("brak obwódki");
    expect(attr(obwodka, "width")).toBeLessThan(rozmiar);
    expect(komorka(container, 0, 0).getAttribute("fill-opacity")).toBe(przed);
    expect(attr(komorka(container, 0, 0), "width")).toBe(rozmiar);
  });

  it("dymek podaje dokładną liczbę I przedział kubełka, w który wpadła", () => {
    // Kolor daje klasę, nie liczbę; liczba bez klasy nie tłumaczy koloru.
    // Dopiero para jedno i drugie zamyka drogę od komórki do legendy.
    const { container } = render(<HeatmapChart config={cfg(BAZA)} lang="pl" />);
    const hit = hitLayer(container);
    fireEvent.pointerMove(hit, { clientX: 1, clientY: 1 });
    const wiersze = all(container, ".neh-tooltip dl > div");
    expect(wiersze).toHaveLength(2);
    expect(text(wiersze[0])).toContain(formatChartValue(10, "pl", ""));
    expect(text(wiersze[1])).toContain(formatAxisTick(19.2, "pl"));
  });

  it("dymek nad LUKĄ mówi, że to luka, a nie milczy", () => {
    // Pusty dymek nad komórką z teksturą wygląda na zepsuty wykres, a nie na
    // brak pomiaru - a to jest różnica między defektem renderu i faktem
    // o danych.
    const { container } = render(<HeatmapChart config={cfg(LUKA)} lang="pl" />);
    const hit = hitLayer(container);
    fireEvent.pointerMove(hit, { clientX: 1, clientY: attr(hit, "height") * 0.5 });
    expect(text(container.querySelector(".neh-tooltip"))).toContain("brak danych");
  });

  it("dotyk NIE gasi dymka przy opuszczeniu warstwy, mysz gasi", () => {
    // Palec schodzi z ekranu po każdym stuknięciu, więc `pointerleave`
    // z dotyku gasiłby dymek zawsze natychmiast po jego pokazaniu, czyli mapa
    // byłaby na telefonie martwa. Przy myszy odwrotnie: dymek zostawiony po
    // zejściu kursora wisi nad wykresem, z którego czytelnik już zszedł.
    const { container } = render(<HeatmapChart config={cfg(BAZA)} lang="pl" />);
    const hit = hitLayer(container);
    fireEvent.pointerDown(hit, { clientX: 1, clientY: 1, pointerType: "touch" });
    fireEvent.pointerLeave(hit, { pointerType: "touch" });
    expect(container.querySelector(".neh-tooltip")).not.toBeNull();
    fireEvent.pointerLeave(hit, { pointerType: "mouse" });
    expect(container.querySelector(".neh-tooltip")).toBeNull();
  });
});

describe("HeatmapChart - klawiatura i dostępność", () => {
  it("strzałki poziome zmieniają KOLUMNĘ, pionowe WIERSZ", () => {
    // Dwa parametry potrzebują dwóch wymiarów nawigacji. Z samymi strzałkami
    // poziomymi czytelnik bez wskaźnika dosięgnąłby jednego wiersza macierzy,
    // czyli jednej trzeciej rysunku.
    const { container } = render(<HeatmapChart config={cfg(BAZA)} lang="pl" />);
    const box = container.querySelector<HTMLElement>("[role='img']");
    if (!box) throw new Error("brak kontenera");
    fireEvent.keyDown(box, { key: "ArrowRight" });
    expect(text(container.querySelector(".neh-tooltip"))).toContain("Cena 90");
    fireEvent.keyDown(box, { key: "ArrowRight" });
    expect(text(container.querySelector(".neh-tooltip"))).toContain("20");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    const dymek = text(container.querySelector(".neh-tooltip"));
    expect(dymek).toContain("Cena 100");
    expect(dymek).toContain(formatChartValue(24, "pl", ""));
  });

  it("nawigacja nie wychodzi za krawędź macierzy", () => {
    // Adres poza siatką pokazałby dymek bez komórki albo wywrócił render na
    // niezdefiniowanym elemencie tablicy.
    const { container } = render(<HeatmapChart config={cfg(BAZA)} lang="pl" />);
    const box = container.querySelector<HTMLElement>("[role='img']");
    if (!box) throw new Error("brak kontenera");
    for (let i = 0; i < 9; i++) fireEvent.keyDown(box, { key: "ArrowUp" });
    for (let i = 0; i < 9; i++) fireEvent.keyDown(box, { key: "ArrowLeft" });
    const dymek = text(container.querySelector(".neh-tooltip"));
    expect(dymek).toContain("Cena 90");
    expect(dymek).toContain(formatChartValue(10, "pl", ""));
  });

  it("Escape czyści zaznaczenie, utrata focusu też", () => {
    // Zaznaczenie zostawione po zejściu focusu wisi nad wykresem, na którym
    // czytelnik już nie stoi, i przy następnym Tabie wygląda jak stan aktywny.
    const { container } = render(<HeatmapChart config={cfg(BAZA)} lang="pl" />);
    const box = container.querySelector<HTMLElement>("[role='img']");
    if (!box) throw new Error("brak kontenera");
    fireEvent.keyDown(box, { key: "ArrowRight" });
    fireEvent.keyDown(box, { key: "Escape" });
    expect(container.querySelector("rect[data-role='cell-active']")).toBeNull();
    fireEvent.keyDown(box, { key: "ArrowRight" });
    fireEvent.blur(box);
    expect(container.querySelector("rect[data-role='cell-active']")).toBeNull();
  });

  it("nazwa dostępna niesie ZAKRES SKALI, `n` i brzeg każdego wiersza", () => {
    // Czytnik ekranu nie widzi ani rampy, ani legendy, ani gradientu, więc
    // "mapa ciepła" nie mówi mu o danych niczego. Liczby muszą być w nazwie.
    const { container } = render(<HeatmapChart config={cfg(BAZA)} lang="pl" />);
    const label = container.querySelector("[role='img']")?.getAttribute("aria-label") ?? "";
    expect(label).toContain(formatAxisTick(10, "pl"));
    expect(label).toContain(formatAxisTick(56, "pl"));
    expect(label).toContain("Cena 110");
    expect(label).toContain(formatChartValue(35, "pl", ""));
    expect(label).toContain("Wynikiem mocniej rusza parametr z kolumn");
    expect(label).not.toContain("NaN");
    // Kropki stawia spójka wyliczenia, nie treść: dwie obok siebie czytnik
    // ekranu czyta jako koniec wypowiedzi w środku listy wierszy.
    expect(label).not.toContain("..");
  });

  it("podpowiedź klawiatury jest OPISEM, nie nazwą", () => {
    // `aria-label` niesie treść analityczną, a instrukcja obsługi idzie osobno
    // przez `aria-describedby` - inaczej czytnik czytałby instrukcję przed
    // liczbami przy każdym wejściu na wykres.
    const { container } = render(<HeatmapChart config={cfg(BAZA)} lang="pl" />);
    const id = container.querySelector("[role='img']")?.getAttribute("aria-describedby");
    expect(id).toBeTruthy();
    expect(text(container.querySelector(`#${id}`)).length).toBeGreaterThan(0);
  });
});

describe("HeatmapChart - odpowiedź na pytanie analityczne", () => {
  it("mówi ZDANIEM, który parametr rusza wynikiem mocniej", () => {
    // Po to czytelnik przychodzi do macierzy wrażliwości, a z gradientu tego
    // nie odczyta liczbą: różnica rozstępów średnich brzegowych (36 wobec 10)
    // jest arytmetyką, nie kształtem plamy. Zdanie jest WIDOCZNE, bo dymka
    // nie ma w druku, a treść dla czytnika ekranu nie dojedzie do wzroku.
    const { container } = render(<HeatmapChart config={cfg(BAZA)} lang="pl" />);
    expect(text(container.querySelector("[data-role='dominant']"))).toBe(
      "Wynikiem mocniej rusza parametr z kolumn.",
    );
  });

  it("mówi o REMISIE, gdy oba parametry ruszają wynikiem podobnie", () => {
    // Wskazanie zwycięzcy przy różnicy w granicach zaokrągleń arkusza byłoby
    // zdaniem o zaokrągleniu, nie o zależności.
    const symetryczna = {
      ...BAZA,
      categories: ["10", "20"],
      series: [
        { name: "R1", values: [1, 2] },
        { name: "R2", values: [2, 3] },
      ],
    };
    const { container } = render(<HeatmapChart config={cfg(symetryczna)} lang="pl" />);
    expect(text(container.querySelector("[data-role='dominant']"))).toBe(
      "Oba parametry ruszają wynikiem podobnie mocno.",
    );
  });
});

describe("HeatmapChart - etykiety osi", () => {
  it("podpisuje każdy wiersz i każdą kolumnę, gdy jest miejsce", () => {
    // Etykieta osi mapy ciepła jest WARTOŚCIĄ PARAMETRU: bez niej nie wiadomo,
    // czego dotyczy cały wiersz, a komórka bez adresu nie jest danymi.
    const { container } = render(<HeatmapChart config={cfg(BAZA)} lang="pl" />);
    expect(all(container, "text[data-role='row-label']").map((e) => text(e))).toEqual([
      "Cena 90",
      "Cena 100",
      "Cena 110",
    ]);
    expect(all(container, "text[data-role='column-label']").map((e) => text(e))).toEqual([
      "10",
      "20",
      "30",
      "40",
    ]);
  });

  it("przy ciasnej siatce PRZERZEDZA etykiety kolumn, zostawiając pierwszą i ostatnią", () => {
    // Sześćdziesiąt etykiet na 660 px zlepiłoby się w pasek szumu, a każda
    // przycięta do jednego znaku nie identyfikuje już wartości parametru.
    // Pierwsza i ostatnia zostają, bo bez nich nie wiadomo, jaki zakres
    // parametru pokazuje rysunek.
    const gesta = {
      ...BAZA,
      categories: Array.from({ length: 60 }, (_, i) => `krok-${i + 1}`),
      series: [
        { name: "R1", values: Array.from({ length: 60 }, (_, i) => i) },
        { name: "R2", values: Array.from({ length: 60 }, (_, i) => 60 - i) },
      ],
    };
    const { container } = render(<HeatmapChart config={cfg(gesta)} lang="pl" />);
    const etykiety = all(container, "text[data-role='column-label']");
    expect(etykiety.length).toBeGreaterThan(1);
    expect(etykiety.length).toBeLessThan(60);
    expect(etykiety[0].getAttribute("data-column")).toBe("0");
    expect(etykiety[etykiety.length - 1].getAttribute("data-column")).toBe("59");
  });

  it("etykieta dłuższa od marginesu jest przycięta Z PEŁNĄ TREŚCIĄ w `<title>`", () => {
    // Wielokropek bez dostępu do pełnego napisu jest zakazany: czytelnik
    // widzi wtedy, że nazwa parametru została ucięta, i nie ma jak jej poznać.
    const dlugie = {
      ...BAZA,
      series: [
        { name: "Scenariusz bazowy z bardzo długą nazwą parametru", values: [1, 2, 3, 4] },
        { name: "Scenariusz alternatywny z równie długą nazwą", values: [2, 3, 4, 5] },
      ],
    };
    const { container } = render(<HeatmapChart config={cfg(dlugie)} lang="pl" />);
    const etykieta = all(container, "text[data-role='row-label']")[0];
    expect(text(etykieta)).toContain("…");
    expect(text(etykieta.querySelector("title"))).toBe(
      "Scenariusz bazowy z bardzo długą nazwą parametru",
    );
  });
});

describe("HeatmapChart - alternatywa tekstowa", () => {
  it("ma wiersz na każdy wiersz macierzy, kolumnę na każdą kolumnę i BRZEGI obu osi", () => {
    // Kolumna "Czego unikać" zabrania przy tym pytaniu tabeli liczb, więc
    // tabela pod mapą nie może być tą samą tabelą, którą mapa zastąpiła:
    // dokłada brzegi, czyli odpowiedź na pytanie o wrażliwość podaną liczbą.
    const { container } = render(<HeatmapChart config={cfg(BAZA)} lang="pl" />);
    const wiersze = all(container, "table tbody tr");
    expect(wiersze).toHaveLength(3);
    // 1 nagłówek wiersza + 4 kolumny + 5 brzegów wiersza.
    expect(all(container, "table thead th")).toHaveLength(10);
    const pierwszy = [...wiersze[0].querySelectorAll("td")].map((td) => text(td));
    expect(pierwszy.slice(0, 4)).toEqual(
      [10, 20, 30, 40].map((v) => formatChartValue(v, "pl", "")),
    );
    // Brzeg wiersza: cztery komórki, od 10 do 40, średnia 25, rozstęp 30.
    expect(pierwszy).toContain(formatChartValue(25, "pl", ""));
    expect(all(container, "table tfoot tr")).toHaveLength(4);
  });

  it("luki jadą do tabeli jako LUKI, nie jako zera", () => {
    // Tabela i mapa muszą kłamać tak samo albo nie kłamać wcale - rozjazd
    // między nimi jest defektem samym w sobie, bo tabela jest tą wersją,
    // którą czytelnik uzna za dokładniejszą.
    const { container } = render(<HeatmapChart config={cfg(LUKA)} lang="pl" />);
    const drugi = [...all(container, "table tbody tr")[1].querySelectorAll("td")].map((td) =>
      text(td),
    );
    expect(drugi[0]).toBe("-");
    // Brzeg tego wiersza liczy DWIE komórki, nie trzy: luka nie wchodzi do
    // średniej jako zero.
    expect(drugi).toContain(formatChartValue(2, "pl", ""));
  });
});

describe("HeatmapChart - dane z bazy", () => {
  it("pusta macierz nie renderuje NICZEGO, nie pustego <svg>", () => {
    const { container } = render(
      <HeatmapChart config={cfg({ ...BAZA, series: [], categories: [] })} lang="pl" />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("NaN i Infinity nie docierają na ekran jako napisy", () => {
    // `Intl.NumberFormat.format(NaN)` zwraca literalny napis "NaN", a bramka
    // `blockMatrix.test.tsx` szuka go w `textContent` całej strony.
    const { container } = render(
      <HeatmapChart
        config={cfg({
          ...BAZA,
          series: [
            { name: "Zepsute", values: [Number.NaN, 2, Number.POSITIVE_INFINITY, 4] },
            { name: "Drugie", values: [1, 2, 3, 4] },
          ],
        })}
        lang="pl"
      />,
    );
    const tekst = container.textContent ?? "";
    expect(tekst).not.toContain("NaN");
    expect(tekst).not.toContain("Infinity");
    expect(tekst).not.toContain("undefined");
    expect(tekst).not.toContain("∞");
  });

  it("każdy atrybut liczbowy jest SKOŃCZONY także dla macierzy jednowartościowej", () => {
    // Nieskończoność w atrybucie SVG nie zapala żadnego błędu - element po
    // prostu nie jest rysowany, więc defekt wygląda jak brak danych.
    const { container } = render(
      <HeatmapChart
        config={cfg({
          ...BAZA,
          categories: ["a"],
          series: [{ name: "x", values: [42] }],
        })}
        lang="pl"
      />,
    );
    for (const el of all(container, "rect, line, text, pattern")) {
      for (const name of ["x", "y", "x1", "x2", "y1", "y2", "width", "height", "fill-opacity"]) {
        const raw = el.getAttribute(name);
        if (raw === null) continue;
        expect(Number.isFinite(Number(raw)), `${name}="${raw}"`).toBe(true);
      }
    }
  });

  it("macierz o jednym wierszu jest NAZWANA pod rysunkiem", () => {
    // Jeden wiersz to szereg, a szereg czyta się słupkami poziomymi, w których
    // wartość koduje DŁUGOŚĆ - kanał z górnej połowy hierarchii percepcyjnej.
    // Nasycenie jest w niej przedostatnie, więc mapa z jednego wiersza to
    // zejście o pięć kanałów bez żadnego zysku.
    const { container } = render(
      <HeatmapChart
        config={cfg({ ...BAZA, series: [{ name: "Jedyny", values: [1, 2, 3, 4] }] })}
        lang="pl"
      />,
    );
    expect(container.querySelector("[data-note='reading.notMatrix']")).not.toBeNull();
  });

  it("pełna macierz nie dostaje ŻADNEJ porady", () => {
    // Ostrzeżenie, które widać zawsze, uczy ignorowania wszystkich ostrzeżeń.
    const { container } = render(<HeatmapChart config={cfg(BAZA)} lang="pl" />);
    expect(all(container, "[data-note]")).toHaveLength(0);
  });

  it("siatka w większości pusta jest NAZWANA", () => {
    // Gradient zszywany przez dziury pokazuje kierunek, którego nikt nie
    // policzył: oko łączy sąsiadujące wypełnione komórki, choć pomiędzy nimi
    // nie ma pomiaru.
    const dziurawa = {
      ...BAZA,
      series: [
        { name: "R1", values: [1, null, null, null] },
        { name: "R2", values: [null, null, null, 8] },
      ],
    };
    const { container } = render(<HeatmapChart config={cfg(dziurawa)} lang="pl" />);
    expect(container.querySelector("[data-note='reading.sparse']")).not.toBeNull();
  });

  it("zadeklarowane `n` niezgodne z liczbą policzonych par jest widoczne", () => {
    // Realny defekt: podpis mówi "n = 300", bo tyle scenariuszy zamówiono,
    // a w macierzy jest dwanaście policzonych par. Wtedy podpis i rysunek
    // mówią o dwóch różnych analizach.
    const { container } = render(
      <HeatmapChart config={cfg({ ...BAZA, sampleSize: 300 })} lang="pl" />,
    );
    expect(container.querySelector("[data-note='honesty.declaredSampleOk']")).not.toBeNull();
  });

  it("powtórzona etykieta osi jest NAZWANA jako defekt adresu", () => {
    // Dwa wiersze o tej samej nazwie znaczą, że dwie komórki mają ten sam
    // adres i czytelnik nie wie, którą wartość parametru odczytuje.
    const bliznieta = {
      ...BAZA,
      series: [
        { name: "Ten sam", values: [1, 2, 3, 4] },
        { name: "Ten sam", values: [2, 3, 4, 5] },
      ],
    };
    const { container } = render(<HeatmapChart config={cfg(bliznieta)} lang="pl" />);
    expect(container.querySelector("[data-note='honesty.uniqueOk']")).not.toBeNull();
  });

  it("nie ma `viewBox` na <svg>", () => {
    // Brak `viewBox` znaczy, że jedna jednostka użytkownika to jeden piksel
    // CSS, czyli że próg odległości w `plot.ts` mierzy piksele ekranu -
    // a strefa trafienia komórki liczy się dokładnie w nich.
    const { container } = render(<HeatmapChart config={cfg(BAZA)} lang="pl" />);
    expect(container.querySelector("svg")?.getAttribute("viewBox")).toBeNull();
  });
});
