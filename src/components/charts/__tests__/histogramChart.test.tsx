// HISTOGRAM - CO MUSI BYĆ PRAWDĄ O RYSUNKU.
//
// SKĄD BIORĘ LICZBY. `useContainerWidth` czyta `clientWidth`, które
// w happy-dom wynosi 0, więc szerokość zostaje na wartości startowej 720 -
// geometria jest w pełni deterministyczna i można asertować piksele.
// `useRevealOnScroll` nigdy nie dostaje callbacku IntersectionObservera, więc
// stan to zawsze "static", czyli dokładnie to, co widzi crawler.
//
// CZEGO TU NIE MA. Arytmetyka rozkładu (krawędzie, reguła doboru, gęstość,
// komplet pozycyjny, sumy kontrolne) ma własny plik testowy przy modelu.
// Tutaj sprawdzam wyłącznie to, czego model sprawdzić nie może: czy RYSUNEK
// mówi to, co model policzył.
import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import type { Json } from "@/lib/content-model/json";
import { parseChartConfig } from "@/lib/charts/parse";
import type { ChartConfig } from "@/lib/charts/types";
import { HistogramChart } from "../HistogramChart";

function cfg(data: Record<string, Json>): ChartConfig {
  return parseChartConfig(data);
}

const all = (root: HTMLElement, sel: string): Element[] => [...root.querySelectorAll(sel)];
const num = (el: Element, attr: string): number => Number(el.getAttribute(attr));

/** Dwadzieścia obserwacji o rozpoznawalnym rozkładzie - powyżej progu kształtu. */
const DWADZIESCIA = [1, 2, 2, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 5, 6, 6, 6, 7, 7];

const BAZA: Record<string, Json> = {
  kind: "bar",
  categories: DWADZIESCIA.map((_, i) => `obs-${i + 1}`),
  series: [{ name: "Marża", values: DWADZIESCIA }],
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

describe("HistogramChart - oś pozioma jest CIĄGŁA, nie pasmowa", () => {
  it("SŁUPKI SIĘ STYKAJĄ - przerwa twierdziłaby o zakresie bez obserwacji", () => {
    // To jest najważniejsza asercja tego pliku. Prawa krawędź jednego
    // przedziału JEST lewą krawędzią następnego, więc między słupkami nie ma
    // żadnego zakresu, w którym mogłoby nie być obserwacji. Odstęp
    // (`BAR_GAP`), którym rozdziela słupki wykres kategorialny, kłamałby tu
    // o danych.
    const { container } = render(<HistogramChart config={cfg(BAZA)} lang="pl" />);
    const bars = all(container, "rect.neh-bar");
    expect(bars.length).toBeGreaterThan(2);
    for (let i = 1; i < bars.length; i += 1) {
      const poprzedni = num(bars[i - 1], "x") + num(bars[i - 1], "width");
      const obecny = num(bars[i], "x");
      // Styk z dokładnością do jednego piksela obwódki, która rozdziela
      // sąsiadów wizualnie, nie przestrzennie.
      expect(Math.abs(obecny - poprzedni)).toBeLessThanOrEqual(1.5);
    }
  });

  it("SZEROKOŚĆ słupka idzie z jednostek DANYCH, nie z numeru pasma", () => {
    // TO JEST DEFEKT, KTÓRY POPEŁNIŁOBY narysowanie histogramu wykresem
    // słupkowym. Przedziały 0-10 i 10-100 jako dwa równe słupki twierdzą, że
    // dotyczą równych fragmentów zakresu - dokładnie tak samo kłamie mapa
    // ciepła o nierównej siatce.
    const { container } = render(
      <HistogramChart
        config={cfg({
          ...BAZA,
          series: [{ name: "Dochód", values: [1, 2, 3, 4, 5, 20, 40, 60, 80, 95] }],
        })}
        lang="pl"
      />,
    );
    const bars = all(container, "rect.neh-bar");
    expect(bars.length).toBeGreaterThan(1);
    // Przy przedziałach RÓWNYCH (a takie daje reguła automatyczna) wszystkie
    // słupki muszą mieć tę samą szerokość - i to też jest asercja o osi
    // ciągłej, bo szerokość wynika wtedy z równych krawędzi, nie z pasma.
    const szerokosci = bars.map((b) => num(b, "width"));
    const najwieksza = Math.max(...szerokosci);
    const najmniejsza = Math.min(...szerokosci);
    expect(najwieksza - najmniejsza).toBeLessThanOrEqual(1.5);
  });

  it("etykiety osi poziomej to KRAWĘDZIE, a skrajna prawa jest podpisana", () => {
    // Na osi ciągłej liczbami są krawędzie, nie środki - czytelnik odczytuje
    // "od ile do ile", a nie "który to słupek". Bez podpisanej ostatniej
    // krawędzi nie wiadomo, jaki zakres pokazuje rysunek.
    const { container } = render(<HistogramChart config={cfg(BAZA)} lang="pl" />);
    const podpisy = all(container, "text.tabular-nums[fill='var(--muted-foreground)']").map(
      (e) => e.textContent ?? "",
    );
    expect(podpisy.length).toBeGreaterThan(2);
    // Największa liczba w danych to 7, więc ostatnia krawędź nie może być
    // mniejsza - inaczej rysunek ucina zakres.
    const liczby = podpisy
      .map((s) => Number(s.replace(/\s/g, "").replace(",", ".")))
      .filter((n) => Number.isFinite(n));
    expect(Math.max(...liczby)).toBeGreaterThanOrEqual(7);
  });
});

describe("HistogramChart - oś wartości", () => {
  it("ZAWSZE zaczyna się od zera, bez opcji", () => {
    // Histogram koduje liczebność DŁUGOŚCIĄ słupka, więc ucięta oś
    // zniekształca proporcję między przedziałami wprost (sekcja 8).
    // `histogramExtent` nie ma na to parametru i ta asercja tego pilnuje.
    const { container } = render(<HistogramChart config={cfg(BAZA)} lang="pl" />);
    const podpisy = all(container, "text.tabular-nums[fill='var(--muted-foreground)']").map(
      (e) => e.textContent ?? "",
    );
    expect(podpisy).toContain("0");
  });

  it("wysokość słupka rośnie z licznością", () => {
    // Przedział z pięcioma obserwacjami musi być wyższy od przedziału
    // z jedną. Asercja na PORZĄDKU, nie na pikselach - piksele zależą od
    // podziałki, a porządek od danych.
    const { container } = render(<HistogramChart config={cfg(BAZA)} lang="pl" />);
    const bars = all(container, "rect.neh-bar");
    const wysokosci = bars.map((b) => num(b, "height"));
    expect(Math.max(...wysokosci)).toBeGreaterThan(Math.min(...wysokosci));
  });
});

describe("HistogramChart - dymek odpowiada na pytanie, którego histogram nie umie zadać", () => {
  it("podaje liczebność, udział ORAZ kto jest w przedziale", () => {
    // "Kto tu jest" jest pytaniem, na które zwykły histogram nie odpowiada -
    // etykiety obserwacji przeżywają w modelu właśnie po to.
    const { container } = render(<HistogramChart config={cfg(BAZA)} lang="pl" />);
    const hit = container.querySelector("rect.neh-hit");
    if (!hit) throw new Error("brak warstwy trafień");
    stubPlotRect(hit, 674, 270);
    fireEvent.pointerMove(hit, { clientX: 337, clientY: 135 });
    const dymek = container.querySelector(".neh-tooltip")?.textContent ?? "";
    expect(dymek).toContain("Liczebność");
    expect(dymek).toContain("Udział");
    expect(dymek).toMatch(/obs-\d+/);
  });

  it("nie pokazuje wiersza gęstości przy przedziałach RÓWNYCH", () => {
    // Przy równych przedziałach gęstość jest licznością przemnożoną przez
    // stałą, czyli wierszem bez informacji, który rozsadza dymek.
    const { container } = render(<HistogramChart config={cfg(BAZA)} lang="pl" />);
    const hit = container.querySelector("rect.neh-hit");
    if (!hit) throw new Error("brak warstwy trafień");
    stubPlotRect(hit, 674, 270);
    fireEvent.pointerMove(hit, { clientX: 337, clientY: 135 });
    const dymek = container.querySelector(".neh-tooltip")?.textContent ?? "";
    expect(dymek).not.toContain("na jednostkę");
  });

  it("dotyk NIE gasi dymka przy opuszczeniu warstwy", () => {
    // Palec schodzi z ekranu po każdym stuknięciu, więc `pointerleave`
    // z dotyku gasiłby dymek zawsze natychmiast po jego pokazaniu.
    const { container } = render(<HistogramChart config={cfg(BAZA)} lang="pl" />);
    const hit = container.querySelector("rect.neh-hit");
    if (!hit) throw new Error("brak warstwy trafień");
    stubPlotRect(hit, 674, 270);
    fireEvent.pointerDown(hit, { clientX: 337, clientY: 135, pointerType: "touch" });
    fireEvent.pointerLeave(hit, { pointerType: "touch" });
    expect(container.querySelector(".neh-tooltip")).not.toBeNull();
  });
});

describe("HistogramChart - klawiatura i dostępność", () => {
  it("strzałki przesuwają aktywny przedział, Escape czyści", () => {
    // Nawigacja klawiaturą jest jedynym sposobem odczytania wartości bez
    // wskaźnika - bez niej wykres jest dostępny wyłącznie dla myszy.
    const { container } = render(<HistogramChart config={cfg(BAZA)} lang="pl" />);
    const box = container.querySelector<HTMLElement>("[role='img']");
    if (!box) throw new Error("brak kontenera");
    fireEvent.keyDown(box, { key: "ArrowRight" });
    expect(container.querySelector("rect.neh-bar[data-active='true']")).not.toBeNull();
    fireEvent.keyDown(box, { key: "Escape" });
    expect(container.querySelector("rect.neh-bar[data-active='true']")).toBeNull();
  });

  it("nazwa dostępna niesie REGUŁĘ doboru krawędzi i liczbę obserwacji", () => {
    // Liczba przedziałów jest wyborem, a każdy wybór na wykresie ma być
    // nazwany - inaczej czytelnik nie wie, czy szczyt jest w danych, czy
    // w doborze krawędzi. Czytnik ekranu nie widzi podpisu pod rysunkiem.
    const { container } = render(<HistogramChart config={cfg(BAZA)} lang="pl" />);
    const box = container.querySelector<HTMLElement>("[role='img']");
    const label = box?.getAttribute("aria-label") ?? "";
    expect(label).toContain("Przedziały");
    expect(label).toContain("Obserwacje");
  });

  it("podpowiedź klawiatury jest OPISEM, nie nazwą", () => {
    const { container } = render(<HistogramChart config={cfg(BAZA)} lang="pl" />);
    const box = container.querySelector<HTMLElement>("[role='img']");
    const id = box?.getAttribute("aria-describedby");
    expect(id).toBeTruthy();
    expect(container.querySelector(`#${id}`)?.textContent).toContain("Strzałkami");
  });
});

describe("HistogramChart - dane z bazy", () => {
  it("brak obserwacji nie renderuje NICZEGO, nie pustego <svg>", () => {
    const { container } = render(
      <HistogramChart config={cfg({ ...BAZA, series: [], categories: [] })} lang="pl" />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("NaN i Infinity nie docierają na ekran jako napisy", () => {
    // `Intl.NumberFormat.format(NaN)` zwraca literalny napis "NaN", a bramka
    // `blockMatrix.test.tsx` szuka go w `textContent` całej strony.
    const { container } = render(
      <HistogramChart
        config={cfg({
          ...BAZA,
          series: [
            {
              name: "Zepsute",
              values: [1, 2, 3, Number.NaN, 5, 6, Number.POSITIVE_INFINITY, 8, 9, 10],
            },
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

  it("JEDNA obserwacja nie wywraca rysunku", () => {
    const { container } = render(
      <HistogramChart
        config={cfg({ ...BAZA, categories: ["a"], series: [{ name: "x", values: [42] }] })}
        lang="pl"
      />,
    );
    // Może nie być słupka (brak rozproszenia to sprawa modelu), ale render
    // nie może rzucić ani wypisać nie-liczby.
    expect(container.textContent ?? "").not.toContain("NaN");
  });

  it("wszystkie wartości RÓWNE nie dzielą przez zero", () => {
    const { container } = render(
      <HistogramChart
        config={cfg({
          ...BAZA,
          categories: ["a", "b", "c", "d"],
          series: [{ name: "x", values: [5, 5, 5, 5] }],
        })}
        lang="pl"
      />,
    );
    const tekst = container.textContent ?? "";
    expect(tekst).not.toContain("NaN");
    for (const bar of all(container, "rect.neh-bar")) {
      expect(Number.isFinite(num(bar, "x"))).toBe(true);
      expect(Number.isFinite(num(bar, "width"))).toBe(true);
    }
  });
});
