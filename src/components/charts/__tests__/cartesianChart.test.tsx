// Render kartezjański (`src/components/charts/CartesianChart.tsx`) - pierwszy
// test tego pliku poza jednym przebiegiem a11y.
//
// PO CO. Reguły, z których ten komponent korzysta, są już dowiedzione osobno
// i w 100%: `scale.ts` (domeny, ładne podziałki, kumulacja), `format.ts`
// (Intl per język), `parse.ts` (koercja z Json), `csv.ts`. Czego NIE dowodzi
// żaden z tamtych plików, to PRZEJŚCIE tych reguł przez render - a wszystkie
// decyzje wizualne siedzą właśnie tutaj, w jednym `useMemo` z geometrią i
// w drabinie ternarnych operatorów na znacznikach. Klasa defektu jest zawsze
// ta sama: wykres NADAL SIĘ RYSUJE, tylko kłamie.
//
// KONKRETNIE ŁAPIEMY:
//   * odwrócone gałęzie orientacji (`horizontal`) - wykres poziomy, który
//     mierzy wartość po osi Y, wygląda jak wykres, a jest bełkotem;
//   * dziurę w danych zamalowaną interpolacją. Kontrakt (`types.ts`:
//     "null = luka w danych") mówi, że linia MA SIĘ PRZERWAĆ; test czyta
//     atrybut `d` i sprawdza liczbę podpoleceń `M`, bo tylko to odróżnia
//     przerwę od zmyślonego odcinka;
//   * słupek, który kłamie wysokością - baza musi siedzieć na zerze skali
//     (`includeZero`), a wartość ujemna rosnąć W DÓŁ od tej samej bazy;
//   * zaokrąglenie 4px na złym końcu pasa (spec dataviz: TYLKO koniec
//     z danymi) - odrębna arytmetyka dla stacka, dla wartości ujemnej i dla
//     słupka poziomego;
//   * gałąź wybraną wcześniej niż dane: `stacked` wymaga >=2 serii i typu
//     słupkowego, seria z samymi `null` wypada przed geometrią, a pusty
//     zestaw musi dać `null` zamiast pustego SVG;
//   * stan interakcji, który przeżywa podmianę configu - to jest wektor
//     wycieku między przestrzeniami roboczymi i ma tu zapięty własny
//     `it.fails`.
//
// SKĄD BIORĘ LICZBY. `useContainerWidth` czyta `clientWidth`, które w
// happy-dom wynosi 0, więc szerokość zostaje na wartości startowej 720 -
// geometria jest w pełni deterministyczna i można asertować piksele.
// `useRevealOnScroll` nigdy nie dostaje callbacku IntersectionObservera,
// więc stan to zawsze "static", czyli dokładnie to, co widzi crawler.
//
// I18N. Ten komponent nie ma ANI JEDNEGO klucza słownika - cały tekst
// widoczny dla użytkownika to liczby z `Intl` (pl-PL / en-GB) i etykiety
// kategorii przekazane w configu. Dlatego nie ma tu `realT`, a "oba języki"
// znaczy: te same dane w `lang="pl"` i `lang="en"` dają ODMIENNE, poprawne
// napisy na osi i w tooltipie.
import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import type { Json } from "@/lib/content-model/json";
import { parseChartConfig } from "@/lib/charts/parse";
import type { ChartConfig } from "@/lib/charts/types";
import { CartesianChart } from "../CartesianChart";

/** Konfiguracja tą samą drogą, którą idzie blok CMS / widget buildera. */
function cfg(data: Record<string, Json>): ChartConfig {
  return parseChartConfig(data);
}

const all = (root: HTMLElement, sel: string): Element[] => [...root.querySelectorAll(sel)];
const d = (el: Element | null | undefined): string => el?.getAttribute("d") ?? "";
const ds = (root: HTMLElement, sel: string): string[] => all(root, sel).map(d);
const textOf = (root: HTMLElement, sel: string): string[] =>
  all(root, sel).map((e) => e.textContent ?? "");

const SEL = {
  bar: "path.neh-bar",
  line: "path.neh-line",
  area: "path.neh-fade",
  dot: "circle",
  grid: "line[stroke='var(--chart-grid)']",
  axis: "line[stroke='var(--chart-axis)']",
  crosshair: "line.neh-crosshair",
  band: "rect[fill='var(--foreground)']",
  hit: "rect.neh-hit",
  tooltip: ".neh-tooltip",
  tick: "text.tabular-nums[fill='var(--muted-foreground)']",
  catLabel: "text[fill='var(--muted-foreground)']:not(.tabular-nums)",
  valueLabel: "text[fill='var(--foreground)']",
} as const;

const box = (root: HTMLElement): HTMLElement => {
  const el = root.querySelector<HTMLElement>("[role='img']");
  if (!el) throw new Error("brak kontenera wykresu");
  return el;
};

/**
 * happy-dom zwraca z `getBoundingClientRect()` same zera, a `indexFromPointer`
 * dzieli przez `rect.width` - bez podmiany każdy `pointermove` dawałby NaN.
 * Podstawiamy prostokąt równy obszarowi rysunku, żeby współrzędne wskaźnika
 * znaczyły to samo, co w przeglądarce.
 */
function stubPlotRect(hit: Element, width: number, height: number): void {
  const rect: DOMRect = {
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: width,
    bottom: height,
    width,
    height,
    toJSON: () => ({}),
  };
  Object.defineProperty(hit, "getBoundingClientRect", { value: () => rect, configurable: true });
}

// ---------------------------------------------------------------------------

describe("CartesianChart - wczesne wyjścia i filtr serii", () => {
  it("bez kategorii nie renderuje NICZEGO (nie pustego <svg>)", () => {
    const { container } = render(<CartesianChart config={cfg({ categories: [] })} lang="pl" />);
    expect(container.innerHTML).toBe("");
  });

  it("seria z samymi lukami znika przed geometrią - zostaje pusty wykres", () => {
    const { container } = render(
      <CartesianChart
        config={cfg({
          categories: ["a", "b"],
          series: [{ name: "Pusta", values: [null, null] }],
        })}
        lang="pl"
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("seria z samymi lukami wypada, a pozostałe rysują się normalnie", () => {
    const { container } = render(
      <CartesianChart
        config={cfg({
          categories: ["a", "b"],
          series: [
            { name: "Pusta", values: [null, null] },
            { name: "Realna", values: [3, 4] },
          ],
        })}
        lang="pl"
      />,
    );
    // Dwa słupki (jedna ocalała seria x dwie kategorie), wszystkie w slocie 2 -
    // odsianie serii NIE przenumerowuje palety.
    const bars = all(container, SEL.bar);
    expect(bars).toHaveLength(2);
    expect(bars.map((b) => b.getAttribute("fill"))).toEqual(["var(--chart-2)", "var(--chart-2)"]);
  });

  it("tytuł trafia do aria-label, a jego brak nie zostawia pustego atrybutu", () => {
    const data = { categories: ["a"], series: [{ name: "A", values: [1] }] };
    const withTitle = render(
      <CartesianChart config={cfg({ ...data, title: "Eksport 2026" })} lang="pl" />,
    );
    expect(box(withTitle.container).getAttribute("aria-label")).toBe("Eksport 2026");

    const noTitle = render(<CartesianChart config={cfg(data)} lang="pl" />);
    expect(box(noTitle.container).hasAttribute("aria-label")).toBe(false);
  });
});

describe("CartesianChart - kolumny pionowe", () => {
  const base = {
    kind: "bar",
    categories: ["2021", "2022", "2023"],
    series: [{ name: "Eksport", values: [10, -5, 20] }],
  } as const;

  it("baza kolumny siedzi na zerze skali, a wartość ujemna rośnie W DÓŁ", () => {
    const { container } = render(<CartesianChart config={cfg({ ...base })} lang="pl" />);
    const [dodatni, ujemny] = ds(container, SEL.bar);
    const zeroY = Number(all(container, SEL.axis)[0].getAttribute("y1"));

    // Obie kolumny startują z tego samego Y (oś zera) - jedna idzie w górę
    // (ujemne `v`), druga w dół (dodatnie `v`).
    expect(dodatni.startsWith(`M134.33333333333331 ${zeroY}v-`)).toBe(true);
    expect(ujemny.startsWith(`M359 ${zeroY}v`)).toBe(true);
    expect(ujemny).not.toContain(`${zeroY}v-`);
  });

  it("zaokrąglenie 4px dostaje szczyt kolumny dodatniej i SPÓD ujemnej", () => {
    const { container } = render(<CartesianChart config={cfg({ ...base })} lang="pl" />);
    const [dodatni, ujemny] = ds(container, SEL.bar);
    // "top": łuk skręca w prawo-w-górę (q0 -4 4 -4); "bottom": w prawo-w-dół.
    expect(dodatni).toContain("q0 -4 4 -4");
    expect(ujemny).toContain("q0 4 4 4");
  });

  it("skala obejmuje zero także wtedy, gdy dane przecinają zero w obie strony", () => {
    const { container } = render(<CartesianChart config={cfg({ ...base })} lang="pl" />);
    const ticks = textOf(container, SEL.tick);
    expect(ticks).toEqual(["-5", "0", "5", "10", "15", "20"]);
    // Oś bazowa NIE leży na krawędzi rysunku - jest w środku pola.
    const zeroY = Number(all(container, SEL.axis)[0].getAttribute("y1"));
    expect(zeroY).toBeGreaterThan(24);
    expect(zeroY).toBeLessThan(294);
  });

  it("luka w ŚRODKU serii kasuje kolumnę zamiast rysować zero", () => {
    const { container } = render(
      <CartesianChart
        config={cfg({
          kind: "bar",
          categories: ["a", "b", "c"],
          series: [{ name: "A", values: [4, null, 6] }],
        })}
        lang="pl"
      />,
    );
    expect(all(container, SEL.bar)).toHaveLength(2);
    // Kategoria "b" ma etykietę osi, ale nie ma znacznika.
    expect(textOf(container, SEL.catLabel)).toEqual(["a", "b", "c"]);
  });

  it("wartość 0 poza stackiem rysuje włos przy bazie, a nie znika", () => {
    const { container } = render(
      <CartesianChart
        config={cfg({
          kind: "bar",
          categories: ["a", "b"],
          series: [{ name: "A", values: [0, 10] }],
        })}
        lang="pl"
      />,
    );
    const bars = ds(container, SEL.bar);
    expect(bars).toHaveLength(2);
    // Minimalna wysokość 0.5px - kategoria z zerem zostaje widoczna na osi.
    expect(bars[0]).toContain("v-0.25");
    expect(bars[1]).toContain("v-280");
  });

  it("szerokość kolumny nie przekracza 24px przy garstce kategorii", () => {
    const { container } = render(
      <CartesianChart
        config={cfg({ kind: "bar", categories: ["a"], series: [{ name: "A", values: [5] }] })}
        lang="pl"
      />,
    );
    // 24px = 16px prostej ścianki + 2 x 4px promienia.
    expect(d(all(container, SEL.bar)[0])).toContain("h16");
  });

  it("dwie serie grupują się w rozdzielnych slotach z 2px prześwitu", () => {
    const { container } = render(
      <CartesianChart
        config={cfg({
          kind: "bar",
          categories: ["a"],
          series: [
            { name: "A", values: [10] },
            { name: "B", values: [8] },
          ],
        })}
        lang="pl"
      />,
    );
    const xs = ds(container, SEL.bar).map((path) => Number(/^M([\d.]+) /.exec(path)?.[1]));
    expect(xs).toHaveLength(2);
    // slotW = band*0.72/2 = 242.64; barW = min(24, slotW - BAR_GAP) = 24,
    // więc sąsiednie kolumny dzieli cała szerokość slotu, nie zero.
    expect(xs[1] - xs[0]).toBeCloseTo(242.64, 1);
    expect(xs[1] - xs[0]).toBeGreaterThan(24);
  });

  it("przy 40 kategoriach x 8 seriach slot spada do podłogi 2px i znaczniki nadal powstają", () => {
    const { container } = render(
      <CartesianChart
        config={cfg({
          kind: "bar",
          categories: Array.from({ length: 40 }, (_, i) => `k${i}`),
          series: Array.from({ length: 8 }, (_, s) => ({
            name: `S${s}`,
            values: Array.from({ length: 40 }, () => s + 1),
          })),
        })}
        lang="pl"
      />,
    );
    // 8 x 40 ścieżek - żadna kategoria nie wypada, mimo że barW schodzi do 0.
    expect(all(container, SEL.bar)).toHaveLength(320);
    expect(d(all(container, SEL.bar)[0])).toContain("h0");
  });

  it("etykiety wartości dostaje TYLKO pojedyncza seria kolumn", () => {
    const jedna = render(
      <CartesianChart
        config={cfg({
          kind: "bar",
          showValues: true,
          unit: "%",
          categories: ["a", "b"],
          series: [{ name: "A", values: [10, -5] }],
        })}
        lang="pl"
      />,
    );
    // Dodatnia nad szczytem, ujemna pod spodem - obie z jednostką.
    expect(textOf(jedna.container, SEL.valueLabel)).toEqual(["10%", "-5%"]);

    const dwie = render(
      <CartesianChart
        config={cfg({
          kind: "bar",
          showValues: true,
          categories: ["a", "b"],
          series: [
            { name: "A", values: [10, -5] },
            { name: "B", values: [3, 4] },
          ],
        })}
        lang="pl"
      />,
    );
    expect(all(dwie.container, SEL.valueLabel)).toHaveLength(0);
  });

  it("etykieta wartości nie powstaje dla kategorii z luką", () => {
    const { container } = render(
      <CartesianChart
        config={cfg({
          kind: "bar",
          showValues: true,
          categories: ["a", "b", "c"],
          series: [{ name: "A", values: [10, null, 20] }],
        })}
        lang="pl"
      />,
    );
    // Trzy kategorie, dwie dane - i dokładnie dwie etykiety (żadnego "0").
    expect(textOf(container, SEL.valueLabel)).toEqual(["10", "20"]);
  });

  it("etykieta kategorii dłuższa niż 12 znaków jest skracana wielokropkiem", () => {
    const { container } = render(
      <CartesianChart
        config={cfg({
          kind: "bar",
          categories: ["Wielkopolskie", "Śląsk"],
          series: [{ name: "A", values: [1, 2] }],
        })}
        lang="pl"
      />,
    );
    expect(textOf(container, SEL.catLabel)).toEqual(["Wielkopolsk…", "Śląsk"]);
  });

  it("etykiety osi kategorii są próbkowane, gdy jest ich za dużo na piksele", () => {
    const { container } = render(
      <CartesianChart
        config={cfg({
          kind: "bar",
          categories: Array.from({ length: 40 }, (_, i) => `k${i}`),
          series: [{ name: "A", values: Array.from({ length: 40 }, (_, i) => i) }],
        })}
        lang="pl"
      />,
    );
    // labelEvery = ceil(40*64/674) = 4 - co czwarta etykieta, reszta pominięta.
    expect(textOf(container, SEL.catLabel)).toEqual([
      "k0",
      "k4",
      "k8",
      "k12",
      "k16",
      "k20",
      "k24",
      "k28",
      "k32",
      "k36",
    ]);
    // Znaczniki są komplet - próbkowanie dotyczy WYŁĄCZNIE napisów.
    expect(all(container, SEL.bar)).toHaveLength(40);
  });
});

describe("CartesianChart - słupki poziome", () => {
  const base = {
    kind: "bar-horizontal",
    categories: ["Polska", "Niemcy"],
    series: [{ name: "PKB", values: [10, -4] }],
  } as const;

  it("wartość mierzy się po osi X, a kategorie schodzą po osi Y", () => {
    const { container } = render(<CartesianChart config={cfg({ ...base })} lang="pl" />);
    // Oś bazowa jest PIONOWA (x1 === x2), siatka też.
    const axis = all(container, SEL.axis)[0];
    expect(axis.getAttribute("x1")).toBe(axis.getAttribute("x2"));
    expect(axis.getAttribute("y1")).not.toBe(axis.getAttribute("y2"));
    const grid = all(container, SEL.grid)[0];
    expect(grid.getAttribute("x1")).toBe(grid.getAttribute("x2"));
    // Podziałki wartości lądują POD rysunkiem, etykiety kategorii po lewej.
    expect(textOf(container, SEL.tick)).toEqual(["-5", "0", "5", "10"]);
    expect(textOf(container, SEL.catLabel)).toEqual(["Polska", "Niemcy"]);
  });

  it("zaokrąglenie idzie na prawy koniec paska dodatniego i lewy ujemnego", () => {
    const { container } = render(<CartesianChart config={cfg({ ...base })} lang="pl" />);
    const [dodatni, ujemny] = ds(container, SEL.bar);
    expect(dodatni).toContain("q4 0 4 4");
    expect(ujemny).toContain("q-4 0 -4 -4");
  });

  it("każda kategoria dostaje etykietę - poziomo nie ma próbkowania", () => {
    const { container } = render(
      <CartesianChart
        config={cfg({
          kind: "bar-horizontal",
          categories: Array.from({ length: 30 }, (_, i) => `k${i}`),
          series: [{ name: "A", values: Array.from({ length: 30 }, (_, i) => i + 1) }],
        })}
        lang="pl"
      />,
    );
    expect(all(container, SEL.catLabel)).toHaveLength(30);
  });

  it("lewy margines rośnie z etykietą, ale zatrzymuje się na 180px, a napis jest ucinany po 24 znakach", () => {
    const dlugie = render(
      <CartesianChart
        config={cfg({
          kind: "bar-horizontal",
          categories: ["Województwo zachodniopomorskie i okolice"],
          series: [{ name: "A", values: [1] }],
        })}
        lang="pl"
      />,
    );
    expect(all(dlugie.container, SEL.hit)[0].getAttribute("x")).toBe("180");
    expect(textOf(dlugie.container, SEL.catLabel)).toEqual(["Województwo zachodniopo…"]);

    const krotkie = render(
      <CartesianChart
        config={cfg({
          kind: "bar-horizontal",
          categories: ["PL"],
          series: [{ name: "A", values: [1] }],
        })}
        lang="pl"
      />,
    );
    // Podłoga 48px - krótka etykieta nie ściąga osi na zero.
    expect(all(krotkie.container, SEL.hit)[0].getAttribute("x")).toBe("48");
  });

  it("etykiety wartości stają po zewnętrznej stronie paska - z prawej dla dodatnich, z lewej dla ujemnych", () => {
    const { container } = render(
      <CartesianChart config={cfg({ ...base, showValues: true, unit: " mld" })} lang="pl" />,
    );
    const labels = all(container, SEL.valueLabel);
    expect(labels.map((l) => l.textContent)).toEqual(["10 mld", "-4 mld"]);
    expect(labels[0].getAttribute("text-anchor")).toBe("start");
    expect(labels[1].getAttribute("text-anchor")).toBe("end");
  });
});

describe("CartesianChart - stack", () => {
  const stos = {
    kind: "bar",
    stacked: true,
    categories: ["2025", "2026"],
    series: [
      { name: "A", values: [10, 6] },
      { name: "B", values: [5, 4] },
    ],
  } as const;

  it("segmenty stackują się na sobie, a skala sięga SUMY, nie maksimum serii", () => {
    const { container } = render(<CartesianChart config={cfg({ ...stos })} lang="pl" />);
    const ticks = textOf(container, SEL.tick).map(Number);
    // 10+5 = 15 musi się zmieścić; gdyby extent liczył maksimum serii (10),
    // górny segment wyszedłby poza rysunek.
    expect(Math.max(...ticks)).toBeGreaterThanOrEqual(15);

    const [a0, , b0] = ds(container, SEL.bar);
    const startY = (path: string): number => Number(/^M[\d.]+ ([\d.]+)/.exec(path)?.[1]);
    const rectH = (path: string): number => Number(/h24v([\d.]+)h-24Z$/.exec(path)?.[1]);
    const zeroY = Number(all(container, SEL.axis)[0].getAttribute("y1"));
    // Dolny segment stoi na zerze skali...
    expect(startY(a0) + rectH(a0)).toBeCloseTo(zeroY, 5);
    // ...a górny startuje DOKŁADNIE w punkcie styku - bez luki i bez zakładki.
    expect(startY(b0)).toBeCloseTo(startY(a0), 5);
  });

  it("tylko segment domykający pas dostaje zaokrąglenie, reszta jest prosta", () => {
    const { container } = render(<CartesianChart config={cfg({ ...stos })} lang="pl" />);
    const [a0, a1, b0, b1] = ds(container, SEL.bar);
    expect(a0).not.toContain("q");
    expect(a1).not.toContain("q");
    expect(b0).toContain("q0 -4 4 -4");
    expect(b1).toContain("q0 -4 4 -4");
  });

  it("stykające się segmenty rozdziela 2px obrysu w kolorze powierzchni", () => {
    const { container } = render(<CartesianChart config={cfg({ ...stos })} lang="pl" />);
    for (const bar of all(container, SEL.bar)) {
      expect(bar.getAttribute("stroke")).toBe("var(--card)");
      expect(bar.getAttribute("stroke-width")).toBe("1");
    }
  });

  it("zero w stacku nie rysuje włosa - segment po prostu nie istnieje", () => {
    const { container } = render(
      <CartesianChart
        config={cfg({
          kind: "bar",
          stacked: true,
          categories: ["a"],
          series: [
            { name: "A", values: [0] },
            { name: "B", values: [5] },
          ],
        })}
        lang="pl"
      />,
    );
    expect(all(container, SEL.bar)).toHaveLength(1);
  });

  it("`stacked` przy jednej ocalałej serii degraduje do grupowania (bez obrysu)", () => {
    const { container } = render(
      <CartesianChart
        config={cfg({
          kind: "bar",
          stacked: true,
          categories: ["a"],
          series: [{ name: "A", values: [5] }],
        })}
        lang="pl"
      />,
    );
    expect(all(container, SEL.bar)[0].getAttribute("stroke-width")).toBe("0");
  });

  it("`stacked` jest ignorowane dla linii - powstają dwie niezależne ścieżki", () => {
    const { container } = render(
      <CartesianChart
        config={cfg({
          kind: "line",
          stacked: true,
          categories: ["a", "b"],
          series: [
            { name: "A", values: [10, 12] },
            { name: "B", values: [5, 6] },
          ],
        })}
        lang="pl"
      />,
    );
    const [a, b] = ds(container, SEL.line);
    // Gdyby stack zadziałał, B leżałoby nad A (suma 15); tu B zostaje niżej.
    const yOf = (path: string): number => Number(/^M[\d.]+ ([\d.]+)/.exec(path)?.[1]);
    expect(yOf(b)).toBeGreaterThan(yOf(a));
  });

  it("pas wyłącznie ujemny domyka OSTATNIA seria stacka", () => {
    const { container } = render(
      <CartesianChart
        config={cfg({
          kind: "bar",
          stacked: true,
          categories: ["a"],
          series: [
            { name: "A", values: [-5] },
            { name: "B", values: [-2] },
          ],
        })}
        lang="pl"
      />,
    );
    const [a, b] = ds(container, SEL.bar);
    expect(a).not.toContain("q");
    expect(b).toContain("q0 4 4 4");
  });

  it("stack działa też poziomo: tylko segment domykający pas ma zaokrąglony koniec", () => {
    const { container } = render(
      <CartesianChart
        config={cfg({
          kind: "bar-horizontal",
          stacked: true,
          categories: ["a", "b"],
          series: [
            { name: "A", values: [10, 6] },
            { name: "B", values: [5, 4] },
          ],
        })}
        lang="pl"
      />,
    );
    const [a0, , b0] = ds(container, SEL.bar);
    expect(a0).not.toContain("q");
    expect(b0).toContain("q4 0 4 4");
    // Prześwit 2px w kolorze powierzchni obowiązuje w obu orientacjach.
    for (const bar of all(container, SEL.bar)) {
      expect(bar.getAttribute("stroke-width")).toBe("1");
    }
  });

  it("etykiety wartości nie pojawiają się na stacku", () => {
    const { container } = render(
      <CartesianChart config={cfg({ ...stos, showValues: true })} lang="pl" />,
    );
    expect(all(container, SEL.valueLabel)).toHaveLength(0);
  });
});

describe("CartesianChart - linie i pola", () => {
  it("luka w ŚRODKU serii PRZERYWA linię - nie ma interpolacji przez dziurę", () => {
    const { container } = render(
      <CartesianChart
        config={cfg({
          kind: "line",
          categories: ["a", "b", "c", "d"],
          series: [{ name: "A", values: [10, null, 20, 15] }],
        })}
        lang="pl"
      />,
    );
    const path = d(all(container, SEL.line)[0]);
    // Dwa podpolecenia "M" = dwa rozłączne odcinki. Interpolacja dałaby jedno.
    expect(path.match(/M/g)).toHaveLength(2);
    // Punkt danych z dziury nie dostaje kropki: 3 wartości = 3 kropki.
    expect(all(container, SEL.dot)).toHaveLength(3);
  });

  it("luka na POCZĄTKU serii nie ściąga linii do osi - wykres zaczyna się od pierwszej danej", () => {
    const { container } = render(
      <CartesianChart
        config={cfg({
          kind: "line",
          categories: ["a", "b", "c"],
          series: [{ name: "A", values: [null, 5, 8] }],
        })}
        lang="pl"
      />,
    );
    const path = d(all(container, SEL.line)[0]);
    // Jeden odcinek (jedno "M"), zaczęty na DRUGIEJ kategorii - pusty prefiks
    // nie generuje fałszywego punktu w x osi ani sklejenia z zerem.
    expect(path.match(/M/g)).toHaveLength(1);
    expect(path.startsWith("M371.0 ")).toBe(true);
    expect(all(container, SEL.dot)).toHaveLength(2);
  });

  it("pole (area) domyka KAŻDY odcinek osobno do osi zera", () => {
    const { container } = render(
      <CartesianChart
        config={cfg({
          kind: "area",
          categories: ["a", "b", "c", "d"],
          series: [{ name: "A", values: [10, null, 20, 15] }],
        })}
        lang="pl"
      />,
    );
    const areaPath = d(all(container, SEL.area)[0]);
    expect(areaPath.match(/Z/g)).toHaveLength(2);
    expect(all(container, SEL.area)[0].getAttribute("fill-opacity")).toBe("0.12");
  });

  it("linia bez pola nie generuje warstwy wypełnienia", () => {
    const { container } = render(
      <CartesianChart
        config={cfg({
          kind: "line",
          categories: ["a", "b"],
          series: [{ name: "A", values: [1, 2] }],
        })}
        lang="pl"
      />,
    );
    expect(all(container, SEL.area)).toHaveLength(0);
  });

  it("seria wyłącznie ujemna dociąga bazę pola do GÓRY rysunku", () => {
    const { container } = render(
      <CartesianChart
        config={cfg({
          kind: "area",
          categories: ["a", "b", "c"],
          series: [{ name: "A", values: [-10, -20, -5] }],
        })}
        lang="pl"
      />,
    );
    // Domena nie obejmuje zera (to nie słupki), więc "baza" to najwyższy
    // punkt skali - inaczej pole zamalowałoby cały wykres.
    const axisY = all(container, SEL.axis)[0].getAttribute("y1");
    expect(axisY).toBe("10");
    expect(d(all(container, SEL.area)[0])).toContain("10 Z");
  });

  it("pojedynczy punkt linii ląduje na środku pasa i zostaje widoczny jako kropka", () => {
    const { container } = render(
      <CartesianChart
        config={cfg({ kind: "line", categories: ["jedyna"], series: [{ name: "A", values: [7] }] })}
        lang="pl"
      />,
    );
    // Brak "L" - ścieżka to samo "M", więc czytelność niesie kropka.
    expect(d(all(container, SEL.line)[0])).toBe("M371.0 152.0");
    const dot = all(container, SEL.dot)[0];
    expect(dot.getAttribute("cx")).toBe("371");
    expect(dot.getAttribute("r")).toBe("4");
  });

  it("powyżej 24 kategorii kropki znikają, a linia zostaje", () => {
    const many = (count: number) =>
      cfg({
        kind: "line",
        categories: Array.from({ length: count }, (_, i) => `k${i}`),
        series: [{ name: "A", values: Array.from({ length: count }, (_, i) => i + 1) }],
      });

    const graniczny = render(<CartesianChart config={many(24)} lang="pl" />);
    expect(all(graniczny.container, SEL.dot)).toHaveLength(24);

    const zaDuzy = render(<CartesianChart config={many(25)} lang="pl" />);
    expect(all(zaDuzy.container, SEL.dot)).toHaveLength(0);
    expect(all(zaDuzy.container, SEL.line)).toHaveLength(1);
  });

  it("etykieta końca linii pokazuje OSTATNIĄ niepustą wartość, nie ostatnią kategorię", () => {
    const { container } = render(
      <CartesianChart
        config={cfg({
          kind: "line",
          showValues: true,
          unit: "%",
          categories: ["a", "b", "c"],
          series: [{ name: "A", values: [1, 42, null] }],
        })}
        lang="pl"
      />,
    );
    expect(textOf(container, SEL.valueLabel)).toEqual(["42%"]);
  });

  it("zbieżne serie rozsuwają etykiety końcowe o co najmniej 13px", () => {
    const { container } = render(
      <CartesianChart
        config={cfg({
          kind: "line",
          showValues: true,
          categories: ["a", "b"],
          series: [
            { name: "A", values: [1, 10] },
            { name: "B", values: [2, 10.1] },
            { name: "C", values: [3, 10.2] },
          ],
        })}
        lang="pl"
      />,
    );
    const ys = all(container, SEL.valueLabel)
      .map((t) => Number(t.getAttribute("y")))
      .sort((x, y) => x - y);
    expect(ys).toHaveLength(3);
    expect(ys[1] - ys[0]).toBeGreaterThanOrEqual(13);
    expect(ys[2] - ys[1]).toBeGreaterThanOrEqual(13);
  });

  it("etykiety końcowe dostają miejsce w prawym marginesie zamiast wypaść poza SVG", () => {
    const { container } = render(
      <CartesianChart
        config={cfg({
          kind: "line",
          showValues: true,
          categories: ["a", "b"],
          series: [{ name: "A", values: [1000, 123456] }],
        })}
        lang="pl"
      />,
    );
    const label = all(container, SEL.valueLabel)[0];
    const svgWidth = Number(container.querySelector("svg")?.getAttribute("width"));
    // Prawy margines liczony z najdłuższej etykiety - napis mieści się w SVG.
    expect(Number(label.getAttribute("x"))).toBeLessThan(svgWidth);
    expect(Number(all(container, SEL.hit)[0].getAttribute("width"))).toBeLessThan(674);
  });
});

describe("CartesianChart - oś wartości, siatka i języki", () => {
  it("showGrid=false gasi siatkę, ale ZOSTAWIA podziałki i oś bazową", () => {
    const config = {
      kind: "bar",
      categories: ["a", "b"],
      series: [{ name: "A", values: [1, 2] }],
    };
    const z = render(<CartesianChart config={cfg({ ...config })} lang="pl" />);
    expect(all(z.container, SEL.grid).length).toBeGreaterThan(0);

    const bez = render(<CartesianChart config={cfg({ ...config, showGrid: false })} lang="pl" />);
    expect(all(bez.container, SEL.grid)).toHaveLength(0);
    expect(all(bez.container, SEL.tick).length).toBeGreaterThan(0);
    expect(all(bez.container, SEL.axis)).toHaveLength(1);
  });

  it("gęstość podziałek zależy od wysokości rysunku", () => {
    const config = (height: number) =>
      cfg({ kind: "bar", height, categories: ["a"], series: [{ name: "A", values: [10] }] });

    const niski = render(<CartesianChart config={config(160)} lang="pl" />);
    const wysoki = render(<CartesianChart config={config(640)} lang="pl" />);
    expect(all(niski.container, SEL.tick)).toHaveLength(3);
    expect(all(wysoki.container, SEL.tick).length).toBeGreaterThan(
      all(niski.container, SEL.tick).length,
    );
  });

  it("obszar rysunku nie schodzi poniżej podłogi 40px, nawet gdy kontener jest niższy", () => {
    // Config budowany z ręki: `parseChartConfig` klamruje wysokość do >=160,
    // a podłoga geometrii broni się właśnie PONIŻEJ tej klamry.
    const tiny: ChartConfig = {
      kind: "bar",
      title: "",
      description: "",
      categories: ["a"],
      series: [{ name: "A", values: [10], colorSlot: 1 }],
      stacked: false,
      unit: "",
      height: 60,
      showLegend: false,
      showGrid: true,
      showValues: false,
      animate: false,
      source: "",
    };
    const { container } = render(<CartesianChart config={tiny} lang="pl" />);
    expect(container.querySelector("svg")?.getAttribute("height")).toBe("60");
    // 60 - 10 - 26 = 24, więc podłoga podnosi wysokość pola do 40.
    expect(all(container, SEL.hit)[0].getAttribute("height")).toBe("40");
  });

  it("oś skraca duże liczby wg konwencji języka (pl 'mln' vs en 'M')", () => {
    const config = cfg({
      kind: "bar",
      categories: ["a"],
      series: [{ name: "A", values: [12_500_000] }],
    });
    const pl = render(<CartesianChart config={config} lang="pl" />);
    const en = render(<CartesianChart config={config} lang="en" />);

    expect(textOf(pl.container, SEL.tick).join("|")).toMatch(/5 mln/);
    expect(textOf(en.container, SEL.tick)).toEqual(["0", "5M", "10M", "15M"]);
  });

  it("etykiety wartości używają separatorów właściwych dla języka", () => {
    const config = cfg({
      kind: "bar",
      showValues: true,
      unit: "%",
      categories: ["a"],
      series: [{ name: "A", values: [1234.5] }],
    });
    const pl = render(<CartesianChart config={config} lang="pl" />);
    const en = render(<CartesianChart config={config} lang="en" />);

    expect(textOf(pl.container, SEL.valueLabel)[0]).toMatch(/^1[\s  ]?234,5%$/);
    expect(textOf(en.container, SEL.valueLabel)).toEqual(["1,234.5%"]);
  });

  it("tekst osi nigdy nie jest w kolorze serii", () => {
    const { container } = render(
      <CartesianChart
        config={cfg({
          kind: "bar",
          categories: ["a"],
          series: [{ name: "A", values: [1] }],
        })}
        lang="pl"
      />,
    );
    for (const t of all(container, "text")) {
      expect(t.getAttribute("fill")).not.toMatch(/--chart-\d/);
    }
  });
});

describe("CartesianChart - interakcja", () => {
  const dwieSerie = {
    kind: "bar",
    unit: "%",
    categories: ["a", "b", "c"],
    series: [
      { name: "Alfa", values: [1, null, 3] },
      { name: "Beta", values: [2, 5, 6] },
    ],
  } as const;

  it("strzałka w prawo aktywuje pierwszą kategorię i pokazuje WSZYSTKIE serie w jednym tooltipie", () => {
    const { container } = render(<CartesianChart config={cfg({ ...dwieSerie })} lang="pl" />);
    fireEvent.keyDown(box(container), { key: "ArrowRight" });
    const tip = container.querySelector(SEL.tooltip);
    expect(tip?.textContent).toBe("aAlfa1%Beta2%");
  });

  it("tooltip pomija serię, która w tej kategorii ma lukę", () => {
    const { container } = render(<CartesianChart config={cfg({ ...dwieSerie })} lang="pl" />);
    fireEvent.keyDown(box(container), { key: "ArrowRight" });
    fireEvent.keyDown(box(container), { key: "ArrowRight" });
    const tip = container.querySelector(SEL.tooltip);
    expect(tip?.textContent).toBe("bBeta5%");
    expect(tip?.textContent).not.toContain("Alfa");
  });

  it("kursor klawiaturowy nie wychodzi poza zakres kategorii", () => {
    const { container } = render(<CartesianChart config={cfg({ ...dwieSerie })} lang="pl" />);
    for (let i = 0; i < 8; i++) fireEvent.keyDown(box(container), { key: "ArrowRight" });
    expect(container.querySelector(SEL.tooltip)?.textContent).toContain("c");
    for (let i = 0; i < 8; i++) fireEvent.keyDown(box(container), { key: "ArrowLeft" });
    expect(container.querySelector(SEL.tooltip)?.textContent).toContain("a");
  });

  it("strzałka w lewo ze stanu spoczynku też wchodzi na pierwszą kategorię", () => {
    const { container } = render(<CartesianChart config={cfg({ ...dwieSerie })} lang="pl" />);
    fireEvent.keyDown(box(container), { key: "ArrowLeft" });
    expect(container.querySelector(SEL.tooltip)?.textContent).toContain("a");
  });

  it("Escape, Tab i utrata fokusu czyszczą podświetlenie", () => {
    for (const key of ["Escape", "Tab"]) {
      const { container } = render(<CartesianChart config={cfg({ ...dwieSerie })} lang="pl" />);
      fireEvent.keyDown(box(container), { key: "ArrowRight" });
      expect(container.querySelector(SEL.tooltip)).not.toBeNull();
      fireEvent.keyDown(box(container), { key });
      expect(container.querySelector(SEL.tooltip)).toBeNull();
    }
    const { container } = render(<CartesianChart config={cfg({ ...dwieSerie })} lang="pl" />);
    fireEvent.keyDown(box(container), { key: "ArrowRight" });
    fireEvent.blur(box(container));
    expect(container.querySelector(SEL.tooltip)).toBeNull();
  });

  it("obojętny klawisz nie rusza stanu", () => {
    const { container } = render(<CartesianChart config={cfg({ ...dwieSerie })} lang="pl" />);
    fireEvent.keyDown(box(container), { key: "ArrowRight" });
    fireEvent.keyDown(box(container), { key: "a" });
    expect(container.querySelector(SEL.tooltip)?.textContent).toContain("a");
  });

  it("wykres poziomy słucha strzałek PIONOWYCH, poziome go nie ruszają", () => {
    const { container } = render(
      <CartesianChart
        config={cfg({
          kind: "bar-horizontal",
          categories: ["a", "b", "c"],
          series: [{ name: "A", values: [1, 2, 3] }],
        })}
        lang="pl"
      />,
    );
    fireEvent.keyDown(box(container), { key: "ArrowRight" });
    expect(container.querySelector(SEL.tooltip)).toBeNull();
    fireEvent.keyDown(box(container), { key: "ArrowDown" });
    fireEvent.keyDown(box(container), { key: "ArrowDown" });
    expect(container.querySelector(SEL.tooltip)?.textContent).toBe("bA2");
    fireEvent.keyDown(box(container), { key: "ArrowUp" });
    expect(container.querySelector(SEL.tooltip)?.textContent).toBe("aA1");
  });

  it("kolumny podświetlają CAŁY pas kategorii, linie dostają crosshair", () => {
    const slupki = render(
      <CartesianChart
        config={cfg({
          kind: "bar",
          categories: ["a", "b"],
          series: [{ name: "A", values: [1, 2] }],
        })}
        lang="pl"
      />,
    );
    fireEvent.keyDown(box(slupki.container), { key: "ArrowRight" });
    const pas = all(slupki.container, SEL.band)[0];
    expect(pas.getAttribute("width")).toBe("337");
    expect(pas.getAttribute("fill-opacity")).toBe("0.05");
    expect(all(slupki.container, SEL.crosshair)).toHaveLength(0);

    const linia = render(
      <CartesianChart
        config={cfg({
          kind: "line",
          categories: ["a", "b"],
          series: [{ name: "A", values: [1, 2] }],
        })}
        lang="pl"
      />,
    );
    fireEvent.keyDown(box(linia.container), { key: "ArrowRight" });
    const cross = all(linia.container, SEL.crosshair)[0];
    expect(cross.getAttribute("x1")).toBe(cross.getAttribute("x2"));
    expect(all(linia.container, SEL.band)).toHaveLength(0);
  });

  it("wykres poziomy podświetla pas POZIOMY na wysokości kategorii", () => {
    const { container } = render(
      <CartesianChart
        config={cfg({
          kind: "bar-horizontal",
          categories: ["a", "b"],
          series: [{ name: "A", values: [1, 2] }],
        })}
        lang="pl"
      />,
    );
    fireEvent.keyDown(box(container), { key: "ArrowDown" });
    const pas = all(container, SEL.band)[0];
    expect(pas.getAttribute("height")).toBe("142");
    expect(pas.getAttribute("x")).toBe("48");
  });

  it("kategoria bez żadnej wartości podświetla się, ale nie otwiera pustego tooltipa", () => {
    const { container } = render(
      <CartesianChart
        config={cfg({
          kind: "bar",
          categories: ["pusta", "pelna"],
          series: [{ name: "A", values: [null, 5] }],
        })}
        lang="pl"
      />,
    );
    fireEvent.keyDown(box(container), { key: "ArrowRight" });
    expect(all(container, SEL.band)).toHaveLength(1);
    expect(container.querySelector(SEL.tooltip)).toBeNull();
  });

  it("wskaźnik przyciąga do NAJBLIŻSZEJ kategorii pasa (słupki)", () => {
    const { container } = render(
      <CartesianChart
        config={cfg({
          kind: "bar",
          categories: ["a", "b", "c"],
          series: [{ name: "A", values: [1, 2, 3] }],
        })}
        lang="pl"
      />,
    );
    const hit = all(container, SEL.hit)[0];
    stubPlotRect(hit, 674, 270);

    fireEvent.pointerMove(hit, { clientX: 600, clientY: 100 });
    expect(container.querySelector(SEL.tooltip)?.textContent).toBe("cA3");
    fireEvent.pointerMove(hit, { clientX: 10, clientY: 100 });
    expect(container.querySelector(SEL.tooltip)?.textContent).toBe("aA1");
    fireEvent.pointerLeave(hit);
    expect(container.querySelector(SEL.tooltip)).toBeNull();
  });

  it("na wykresie liniowym wskaźnik zaokrągla do najbliższego PUNKTU, nie do pasa", () => {
    const { container } = render(
      <CartesianChart
        config={cfg({
          kind: "line",
          categories: ["a", "b", "c", "d"],
          series: [{ name: "A", values: [1, 2, 3, 4] }],
        })}
        lang="pl"
      />,
    );
    const hit = all(container, SEL.hit)[0];
    stubPlotRect(hit, 686, 284);

    // 60% szerokości leży bliżej punktu 3 (66,7%) niż 2 (33,3%).
    fireEvent.pointerMove(hit, { clientX: 686 * 0.6, clientY: 10 });
    expect(container.querySelector(SEL.tooltip)?.textContent).toBe("cA3");
    // Aktywny punkt puchnie z 4 na 5px.
    expect(all(container, SEL.dot).map((c) => c.getAttribute("r"))).toEqual(["4", "4", "5", "4"]);
  });

  it("wykres poziomy czyta wskaźnik z osi Y", () => {
    const { container } = render(
      <CartesianChart
        config={cfg({
          kind: "bar-horizontal",
          categories: ["a", "b"],
          series: [{ name: "A", values: [1, 2] }],
        })}
        lang="pl"
      />,
    );
    const hit = all(container, SEL.hit)[0];
    stubPlotRect(hit, 660, 284);
    // Ten sam X, dwa różne Y - orientacja poziomia MUSI rozróżnić kategorie.
    fireEvent.pointerMove(hit, { clientX: 300, clientY: 20 });
    expect(container.querySelector(SEL.tooltip)?.textContent).toBe("aA1");
    fireEvent.pointerMove(hit, { clientX: 300, clientY: 250 });
    expect(container.querySelector(SEL.tooltip)?.textContent).toBe("bA2");
  });

  it("poziomo pusta kategoria kotwiczy się na osi zera zamiast na nieistniejącym słupku", () => {
    const { container } = render(
      <CartesianChart
        config={cfg({
          kind: "bar-horizontal",
          categories: ["pusta", "pelna"],
          series: [{ name: "A", values: [null, 5] }],
        })}
        lang="pl"
      />,
    );
    fireEvent.keyDown(box(container), { key: "ArrowDown" });
    // Pas się podświetla, ale nie ma czego pokazać - tooltip nie powstaje.
    expect(all(container, SEL.band)).toHaveLength(1);
    expect(container.querySelector(SEL.tooltip)).toBeNull();

    fireEvent.keyDown(box(container), { key: "ArrowDown" });
    const tip = container.querySelector(SEL.tooltip);
    expect(tip?.textContent).toBe("pelnaA5");
    // Kotwica pełnej kategorii siada na końcu paska, czyli na prawej krawędzi.
    expect(tip?.getAttribute("style")).toContain("translate3d(708px");
  });

  it("tooltip przy prawej krawędzi odbija się w lewo zamiast wyjeżdżać poza kontener", () => {
    const { container } = render(
      <CartesianChart
        config={cfg({
          kind: "bar",
          categories: ["a", "b", "c", "d", "e"],
          series: [{ name: "A", values: [1, 2, 3, 4, 5] }],
        })}
        lang="pl"
      />,
    );
    fireEvent.keyDown(box(container), { key: "ArrowRight" });
    expect(container.querySelector(SEL.tooltip)?.getAttribute("style")).toContain(
      "translate(12px",
    );
    for (let i = 0; i < 4; i++) fireEvent.keyDown(box(container), { key: "ArrowRight" });
    expect(container.querySelector(SEL.tooltip)?.getAttribute("style")).toContain("-100%");
  });
});

describe("CartesianChart - paleta i izolacja konfiguracji", () => {
  it("każda seria maluje się swoim slotem palety, a nadmiar serii jest OBCINANY, nie zawijany", () => {
    const config = cfg({
      kind: "bar",
      categories: ["a"],
      series: Array.from({ length: 12 }, (_, i) => ({ name: `S${i}`, values: [i + 1] })),
    });
    const { container } = render(<CartesianChart config={config} lang="pl" />);
    const fills = all(container, SEL.bar).map((b) => b.getAttribute("fill"));
    // MAX_SERIES = 8: dziewiąta seria nie wraca na --chart-1, tylko nie istnieje.
    expect(fills).toEqual(Array.from({ length: 8 }, (_, i) => `var(--chart-${i + 1})`));
  });

  it("slot spoza zakresu 1..8 spada na pozycję serii", () => {
    const { container } = render(
      <CartesianChart
        config={cfg({
          kind: "bar",
          categories: ["a"],
          series: [
            { name: "A", values: [1], colorSlot: 99 },
            { name: "B", values: [2], colorSlot: 5 },
          ],
        })}
        lang="pl"
      />,
    );
    expect(all(container, SEL.bar).map((b) => b.getAttribute("fill"))).toEqual([
      "var(--chart-1)",
      "var(--chart-5)",
    ]);
  });

  it("podmiana configu wymiata dane poprzedniej przestrzeni roboczej - nic z niej nie zostaje w DOM", () => {
    const alfa = cfg({
      kind: "bar",
      title: "Leady - workspace alfa",
      unit: " szt.",
      categories: ["Alfa Q1", "Alfa Q2"],
      series: [{ name: "Kampania alfa", values: [11, 22] }],
    });
    const beta = cfg({
      kind: "bar",
      title: "Leady - workspace beta",
      unit: " szt.",
      categories: ["Beta Q1", "Beta Q2"],
      series: [{ name: "Kampania beta", values: [77, 88] }],
    });

    const { container, rerender } = render(<CartesianChart config={alfa} lang="pl" />);
    fireEvent.keyDown(box(container), { key: "ArrowRight" });
    expect(container.querySelector(SEL.tooltip)?.textContent).toBe("Alfa Q1Kampania alfa11 szt.");

    rerender(<CartesianChart config={beta} lang="pl" />);

    // Ten sam, żywy komponent - hover z alfy MUSI się przemalować na dane bety.
    expect(container.querySelector(SEL.tooltip)?.textContent).toBe("Beta Q1Kampania beta77 szt.");
    expect(box(container).getAttribute("aria-label")).toBe("Leady - workspace beta");
    const html = container.innerHTML;
    for (const slad of ["Alfa", "alfa", "11 szt.", "22 szt."]) {
      expect(html).not.toContain(slad);
    }
  });
});

describe("CartesianChart - defekty zapięte", () => {
  it.fails(
    "podmiana configu na krótszy NIE MOŻE wywracać wykresu: aktywny indeks z poprzedniego zestawu wychodzi poza tablicę i formatChartValue dostaje undefined",
    () => {
      const szeroki = cfg({
        kind: "bar",
        categories: ["a1", "a2", "a3"],
        series: [{ name: "SA", values: [1, 2, 3] }],
      });
      const waski = cfg({
        kind: "bar",
        categories: ["b1"],
        series: [{ name: "SB", values: [9] }],
      });

      const { container, rerender } = render(<CartesianChart config={szeroki} lang="pl" />);
      for (let i = 0; i < 3; i++) fireEvent.keyDown(box(container), { key: "ArrowRight" });
      expect(container.querySelector(SEL.tooltip)?.textContent).toBe("a3SA3");

      // Oczekiwane: tooltip przeskakuje na jedyną kategorię nowego configu.
      // Faktyczne: render rzuca "Cannot read properties of undefined
      // (reading 'toLocaleString')", bo `active.index` = 2 przeżył podmianę.
      rerender(<CartesianChart config={waski} lang="pl" />);
      expect(container.querySelector(SEL.tooltip)?.textContent).toBe("b1SB9");
    },
  );

  it.fails(
    "pas wyłącznie ujemny, którego OSTATNIA seria ma lukę, i tak musi dostać zaokrąglony koniec z danymi",
    () => {
      const { container } = render(
        <CartesianChart
          config={cfg({
            kind: "bar",
            stacked: true,
            categories: ["luka", "pelna"],
            series: [
              { name: "A", values: [-5, 3] },
              { name: "B", values: [null, 4] },
            ],
          })}
          lang="pl"
        />,
      );
      // W kategorii "luka" rysuje się TYLKO segment serii A i to on domyka pas
      // ujemny, więc spec dataviz każe zaokrąglić jego dolny koniec.
      // Faktycznie `lastStackIndexFor` zwraca fallback `series.length - 1`
      // (indeks serii B, która nic tu nie rysuje), więc rounding przepada.
      const [luka] = ds(container, SEL.bar);
      expect(luka).toContain("q0 4 4 4");
    },
  );
});
