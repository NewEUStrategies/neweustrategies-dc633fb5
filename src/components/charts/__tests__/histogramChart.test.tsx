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
import { Chart } from "../Chart";

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

// ---------------------------------------------------------------------------
// ROZDZIELNIK RODZAJÓW - czy `Chart` naprawdę oddaje rysunek właściwemu
// komponentowi.
//
// PO CO TO SPRAWDZAĆ, skoro `Record<ChartKind, ...>` jest wyczerpujący.
// Wyczerpujący typ pilnuje, że KAŻDY rodzaj ma wpis; nie pilnuje, że wpis
// wskazuje WŁAŚCIWY komponent. Literówka `boxplot: BeeswarmChart` kompiluje
// się bez słowa protestu, a autor dostaje inny wykres, niż wybrał - i to jest
// dokładnie ta klasa defektu, przed którą ten PR broni się od początku.
//
// Rozpoznajemy komponent po ZNACZNIKU, który tylko on rysuje, a nie po
// nazwie klasy CSS wspólnej dla silnika.
describe("Chart - rozdzielnik oddaje rodzaj właściwemu renderowi", () => {
  const OBSERWACJE = [4, 8, 15, 16, 23, 42, 7, 11, 19, 27, 33, 5, 9, 14, 21];

  function render_(kind: string) {
    return render(
      <Chart
        config={cfg({
          kind,
          categories: OBSERWACJE.map((_, i) => `obs-${i + 1}`),
          series: [{ name: "Marża", values: OBSERWACJE }],
          animate: false,
        })}
        lang="pl"
      />,
    );
  }

  it("histogram dostaje stykające się prostokąty przedziałów", () => {
    const { container } = render_("histogram");
    expect(container.querySelectorAll("rect.neh-bar").length).toBeGreaterThan(1);
    // ...i nie dostaje znaczników pozostałych dwóch rodzajów rozkładu.
    expect(container.querySelector("[data-role='median']")).toBeNull();
    expect(container.querySelectorAll("circle.neh-bee-dot").length).toBe(0);
  });

  it("boxplot dostaje KRESKĘ MEDIANY - znacznik, którego nie ma żaden inny rodzaj", () => {
    const { container } = render_("boxplot");
    // Mediana jest rysowana OSOBNĄ, mocniejszą kreską, a nie jako granica
    // między dwoma prostokątami: czytelnik musi ją ODCZYTAĆ, nie zgadnąć.
    // Dzięki temu jest też jednoznacznym znacznikiem tego rodzaju - pudełko
    // dzieli klasę `neh-bar` ze słupkiem, więc sama obecność prostokąta nie
    // odróżniłaby boxplota od histogramu, i asercja na niej niczego nie
    // dowodziłaby o rozdzielniku.
    expect(container.querySelector("[data-role='median']")).not.toBeNull();
    expect(container.querySelectorAll("circle.neh-bee-dot").length).toBe(0);
  });

  it("rój dostaje plamki obserwacji, po jednej na obserwację", () => {
    const { container } = render_("beeswarm");
    // Beeswarm obiecuje, że widać KAŻDĄ obserwację - liczba plamek jest więc
    // asercją o obietnicy formy, nie o szczególe implementacji.
    expect(container.querySelectorAll("circle.neh-bee-dot").length).toBeGreaterThanOrEqual(
      OBSERWACJE.length,
    );
    expect(container.querySelector("[data-role='median']")).toBeNull();
  });

  it("każdy z trzech rodzajów rozkładu dostaje TABELĘ, nie kolumny szeregu", () => {
    // Tabela dobrana gałęzią domyślną pokazywałaby dla rozkładu kolumny
    // szeregu czasowego, czyli liczby, których na rysunku nie ma. Mediana jest
    // nagłówkiem, którego tabela szeregu nie zna.
    for (const kind of ["boxplot", "beeswarm"]) {
      const { container } = render_(kind);
      expect(container.textContent ?? "", kind).toContain("Mediana");
    }
    const { container } = render_("histogram");
    expect(container.textContent ?? "").toContain("Przedział");
  });

  it("żaden z trzech nie wypisuje nie-liczby na ekran", () => {
    for (const kind of ["histogram", "boxplot", "beeswarm"]) {
      const { container } = render_(kind);
      const tekst = container.textContent ?? "";
      expect(tekst, kind).not.toContain("NaN");
      expect(tekst, kind).not.toContain("undefined");
      expect(tekst, kind).not.toContain("Infinity");
    }
  });
});

describe("HistogramChart - uwagi pod rysunkiem", () => {
  // DO TEGO PR-A HISTOGRAM MILCZAŁ CAŁKOWICIE: model liczy siedem flag
  // uczciwości, słownik ma dla nich treści w obu językach, a render nie wołał
  // ani jednej. Rysunek, pod którym suma liczebności nie zgadza się z liczbą
  // obserwacji, wyglądał więc dokładnie jak rysunek bez defektu. Te testy
  // pilnują obu rejestrów: OBSERWACJI o formie (`reading.*`) i DEFEKTÓW
  // danych (`honesty.*`).
  const nota = (root: HTMLElement, klucz: string): string =>
    root.querySelector(`[data-note='${klucz}']`)?.textContent ?? "";

  it("pełny arkusz nie dostaje ŻADNEJ uwagi", () => {
    // Uwaga, którą widać zawsze, uczy ignorowania wszystkich uwag.
    const { container } = render(<HistogramChart config={cfg(BAZA)} lang="pl" />);
    expect(all(container, "[data-note]")).toHaveLength(0);
  });

  it("mała próbka jest NAZWANA razem z progiem", () => {
    // Poniżej progu kształt histogramu zależy od położenia krawędzi tak samo
    // jak od rozkładu - czytelnik musi to wiedzieć, żeby nie odczytać szczytu
    // jako faktu o danych. Próg jedzie w zdaniu, bo „mało" bez liczby nie
    // jest informacją.
    const malo = [1, 2, 3, 4, 5];
    const { container } = render(
      <HistogramChart
        config={cfg({
          ...BAZA,
          categories: malo.map((_, i) => `o-${i}`),
          series: [{ name: "Marża", values: malo }],
        })}
        lang="pl"
      />,
    );
    const tekst = nota(container, "reading.tooFew");
    expect(tekst).toContain("20");
    // WSTAWKA PODSTAWIONA, nie zostawiona jako klamry - i18next zostawia
    // surowe `{{min}}`, gdy render nie podał liczby (tak zepsuł się rój).
    expect(tekst).not.toContain("{{");
  });

  it("brak rozproszenia jest NAZWANY", () => {
    const jedna = Array.from({ length: 24 }, () => 7);
    const { container } = render(
      <HistogramChart
        config={cfg({
          ...BAZA,
          categories: jedna.map((_, i) => `o-${i}`),
          series: [{ name: "Stała", values: jedna }],
        })}
        lang="pl"
      />,
    );
    expect(nota(container, "reading.noSpread")).toContain("jedną wartość");
  });

  it("niezgodne `n` z podpisu jest DEFEKTEM, nie obserwacją", () => {
    // Podpis mówi „n = 300", bo tyle ankiet zebrano, a w arkuszu siedzi
    // dwadzieścia wierszy: rysunek jest wtedy o innej próbce niż podpis.
    // Kolor tekstu odróżnia defekt danych od obserwacji o formie, bo lista,
    // na której wszystko krzyczy, uczy ignorowania całej listy.
    const { container } = render(
      <HistogramChart config={cfg({ ...BAZA, sampleSize: 300 })} lang="pl" />,
    );
    const el = container.querySelector("[data-note='honesty.declaredSampleFailed']");
    expect(el).not.toBeNull();
    expect(el?.textContent ?? "").toContain("300");
    expect(el?.getAttribute("style") ?? "").toContain("--chart-negative-text");
  });

  it("pominięte serie są NAZWANE, a nie ciche", () => {
    // Histogram czyta JEDNĄ serię. Autor, który wkleił dwie, widzi rozkład
    // pierwszej i bez tej uwagi nie ma sposobu, żeby to zauważyć.
    const { container } = render(
      <HistogramChart
        config={cfg({
          ...BAZA,
          series: [
            { name: "Marża", values: DWADZIESCIA },
            { name: "Druga", values: DWADZIESCIA },
          ],
        })}
        lang="pl"
      />,
    );
    expect(nota(container, "honesty.ignoredSeries")).toContain("1");
  });

  it("żadna uwaga nie zostawia surowych klamer wstawki", () => {
    // Jedna asercja na WSZYSTKIE uwagi naraz: brakująca liczba nie jest
    // błędem kompilacji ani rozjazdem klucza, więc jedyne, co ją wyłapie, to
    // tekst na ekranie.
    const arkusze: Record<string, Json>[] = [
      { ...BAZA, sampleSize: 300 },
      { ...BAZA, categories: ["a", "b", "c"], series: [{ name: "Mała", values: [1, 2, 3] }] },
      {
        ...BAZA,
        series: [
          { name: "Marża", values: DWADZIESCIA },
          { name: "Druga", values: DWADZIESCIA },
        ],
      },
    ];
    for (const arkusz of arkusze) {
      const { container } = render(<HistogramChart config={cfg(arkusz)} lang="pl" />);
      for (const el of all(container, "[data-note]")) {
        expect(el.textContent ?? "").not.toContain("{{");
      }
    }
  });
});
