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
//   * zaokrąglenie 6px na złym końcu pasa (spec dataviz: TYLKO koniec
//     z danymi) - odrębna arytmetyka dla stacka, dla wartości ujemnej i dla
//     słupka poziomego;
//   * gałąź wybraną wcześniej niż dane: `stacked` wymaga >=2 serii i typu
//     słupkowego, seria z samymi `null` wypada przed geometrią, a pusty
//     zestaw musi dać `null` zamiast pustego SVG;
//   * stan interakcji, który przeżywa podmianę configu - to jest wektor
//     wycieku między przestrzeniami roboczymi, więc pilnujemy zarówno
//     przemalowania tooltipa na nowe dane, jak i klamry na aktywnym indeksie,
//     gdy nowy zestaw jest KRÓTSZY od poprzedniego.
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
import { BAR_EDGE_INSET } from "@/lib/charts/geometry";
import { defaultChartConfig, parseChartConfig } from "@/lib/charts/parse";
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
  // Etykiety bezpośrednie mają wspólną klasę, a NIE wspólny kolor: na słupku
  // idą tuszem tekstu, a na końcu linii WARIANTEM TEKSTOWYM slotu serii (bo
  // tam identyfikują serię, a próg kontrastu dla napisu to 4,5:1, nie 3,0:1).
  valueLabel: "text.neh-value-label",
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
    // odsianie serii NIE przenumerowuje palety. Wypełnieniem jest teraz BLADE
    // WNĘTRZE slotu (wariant domyślny przy jednej serii), a tożsamość niesie
    // obwódka - dlatego pytamy o oba i oba muszą wskazywać slot 2.
    const bars = all(container, SEL.bar);
    expect(bars).toHaveLength(2);
    expect(bars.map((b) => b.getAttribute("fill"))).toEqual([
      "var(--chart-2-inner)",
      "var(--chart-2-inner)",
    ]);
    expect(bars.map((b) => b.getAttribute("stroke"))).toEqual([
      "var(--chart-2-edge)",
      "var(--chart-2-edge)",
    ]);
  });

  it("tytuł trafia do aria-label, a jego brak nie zostawia pustego atrybutu", () => {
    const data = { categories: ["a"], series: [{ name: "A", values: [1] }] };
    const withTitle = render(
      <CartesianChart config={cfg({ ...data, title: "Eksport 2026" })} lang="pl" />,
    );
    // Etykieta a11y idzie ze słownika i NAZYWA RODZAJ OBIEKTU: sam tytuł
    // wpisu ("Eksport 2026") nie mówi czytnikowi ekranu, że to wykres,
    // a rola `img` sama tego nie powie.
    expect(box(withTitle.container).getAttribute("aria-label")).toBe("Wykres: Eksport 2026");

    const noTitle = render(<CartesianChart config={cfg(data)} lang="pl" />);
    // Bez tytułu zostaje sama nazwa rodzaju - PUSTY atrybut byłby gorszy niż
    // jego brak, ale brak jest gorszy niż "Wykres".
    expect(box(noTitle.container).getAttribute("aria-label")).toBe("Wykres");
  });
});

describe("CartesianChart - kolumny pionowe", () => {
  const base: Record<string, Json> = {
    kind: "bar",
    categories: ["2021", "2022", "2023"],
    series: [{ name: "Eksport", values: [10, -5, 20] }],
  };

  it("baza kolumny siedzi na zerze skali, a wartość ujemna rośnie W DÓŁ", () => {
    const { container } = render(<CartesianChart config={cfg({ ...base })} lang="pl" />);
    const [dodatni, ujemny] = ds(container, SEL.bar);
    const zeroY = Number(all(container, SEL.axis)[0].getAttribute("y1"));

    // Obie kolumny startują na osi zera - jedna idzie w górę (ujemne `v`),
    // druga w dół (dodatnie `v`).
    //
    // BAZA JEST SKORYGOWANA O WSUNIĘCIE OBWÓDKI, i to nie jest przesunięcie
    // bazy: `stroke` leży NA ścieżce, więc kształt wsunięty o połowę grubości
    // (0,75 px) ma ZEWNĘTRZNĄ krawędź obwódki dokładnie na zerze. Bez tej
    // korekty obwódka zjadałaby wysokość, czyli po prostu zmniejszała wartość.
    // Asercja pyta więc o relację, a nie o przypięty napis - inaczej zmiana
    // grubości obwódki wywracałaby test, nie mówiąc, co się zepsuło.
    const startY = (path: string): number => Number(/^M[\d.]+ ([\d.]+)/.exec(path)?.[1]);
    expect(startY(dodatni)).toBeCloseTo(zeroY - BAR_EDGE_INSET, 6);
    expect(startY(ujemny)).toBeCloseTo(zeroY + BAR_EDGE_INSET, 6);
    expect(dodatni).toMatch(/^M[\d.]+ [\d.]+v-/);
    expect(ujemny).toMatch(/^M[\d.]+ [\d.]+v[\d.]/);
  });

  it("zaokrąglenie 6px dostaje szczyt kolumny dodatniej i SPÓD ujemnej", () => {
    const { container } = render(<CartesianChart config={cfg({ ...base })} lang="pl" />);
    const [dodatni, ujemny] = ds(container, SEL.bar);
    // "top": łuk skręca w prawo-w-górę (q0 -6 6 -6); "bottom": w prawo-w-dół.
    // JEDEN promień 6 px na wszystkim - karty, słupki, tooltipy, strefa
    // prognozy; poprzednie 4 px istniało tylko dla słupków.
    expect(dodatni).toContain("q0 -6 6 -6");
    expect(ujemny).toContain("q0 6 6 6");
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
    // ZNAKIEM KATEGORII Z ZEREM JEST OBWÓDKA, nie podłoga wysokości - i to
    // jest zmiana na lepsze. Wcześniej silnik rysował włos 0,5 px, czyli
    // wysokość, której w danych nie ma; teraz kształt ma wysokość dokładnie 0,
    // a widoczną kreską jest obwódka 1,5 px stojąca DOKŁADNIE na zerze.
    // Skutek uboczny wsunięcia okazał się właściwym mechanizmem: kreska jest
    // w prawidłowym miejscu i nie udaje danych.
    expect(bars[0]).toContain("v0");
    expect(bars[0]).not.toContain("v-0.25");
    expect(all(container, SEL.bar)[0].getAttribute("data-edged")).toBe("true");
    // 276,5 zamiast 278: wysokość rysowana jest mniejsza o dwa wsunięcia
    // (2 x 0,75 px), a zewnętrzna krawędź obwódki nadal sięga tam, gdzie
    // sięgała wartość.
    expect(bars[1]).toContain("v-276.5");
  });

  it("szerokość kolumny nie przekracza 24px przy garstce kategorii", () => {
    const { container } = render(
      <CartesianChart
        config={cfg({ kind: "bar", categories: ["a"], series: [{ name: "A", values: [5] }] })}
        lang="pl"
      />,
    );
    // 24 px nominalnej szerokości = 1,5 px zjedzone przez wsunięcie obwódki
    // (2 x 0,75) + 12 px na dwa promienie 6 px + 10,5 px prostej ścianki.
    expect(d(all(container, SEL.bar)[0])).toContain("h10.5");
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
    // slotW = band*0.72/2 = 243.36; barW = min(24, slotW - BAR_GAP) = 24,
    // więc sąsiednie kolumny dzieli cała szerokość slotu, nie zero.
    expect(xs[1] - xs[0]).toBeCloseTo(243.36, 1);
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
    // 8 x 40 znaczników - żadna kategoria nie wypada, mimo że barW schodzi
    // do 0. Sloty 7 i 8 dokładają do swoich znaczników nakładkę wzoru (drugi
    // nośnik różnicy, bo ich odcień jest od slotów 1-2 oddalony o ~10-12
    // jednostek CIELAB po symulacji), więc ścieżek jest 320 + 2 x 40.
    const sciezki = all(container, SEL.bar);
    expect(sciezki).toHaveLength(400);
    const wypelnione = sciezki.filter((b) => (b.getAttribute("fill") ?? "").startsWith("var("));
    expect(wypelnione).toHaveLength(320);
    expect(d(wypelnione[0])).toContain("h0");
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

  it("długa etykieta kategorii NIE jest ucinana wielokropkiem - jest cała", () => {
    // ZMIANA ŚWIADOMA. Wcześniej etykieta powyżej 12 znaków dostawała
    // wielokropek: "Wielkopolsk…". Wielokropek bez pełnej treści obok jest
    // bezużyteczny - "Wielkopolsk…" i "Wielkopolska Wschodnia" wyglądają
    // identycznie, a to dwie różne kategorie. Zamiast tego działa drabina
    // z `lib/charts/labels.ts`: przerzedź -> skróć semantycznie -> obróć.
    // Przy dwóch kategoriach na 676 px nie trzeba żadnego szczebla.
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
    expect(textOf(container, SEL.catLabel)).toEqual(["Wielkopolskie", "Śląsk"]);
    // Skoro nic nie ucięto, nie ma po co dawać tooltipa z pełną treścią.
    expect(container.querySelectorAll("text > title")).toHaveLength(0);
  });

  it("etykiety, które się nie mieszczą, są OBRACANE, a pełna treść zostaje w tooltipie", () => {
    // Trzeci szczebel drabiny. Dwadzieścia długich nazw na 676 px daje krok
    // przerzedzania 5, czyli powyżej progu 3; skrót semantyczny nic tu nie da
    // (to nie zapisy czasu), więc plan schodzi do obrotu -45 stopni
    // z `text-anchor: end`. Przy dwunastu takich nazwach krok wychodzi 3
    // i drabina zatrzymuje się na przerzedzeniu - obrót jest OSTATNIM
    // szczeblem, nie pierwszym odruchem.
    const dlugie = Array.from({ length: 20 }, (_, i) => `Województwo numer ${i + 1}`);
    const { container } = render(
      <CartesianChart
        config={cfg({
          kind: "bar",
          categories: dlugie,
          series: [{ name: "A", values: dlugie.map((_, i) => i + 1) }],
        })}
        lang="pl"
      />,
    );
    const etykiety = all(container, SEL.catLabel);
    expect(etykiety.length).toBeGreaterThan(0);
    for (const el of etykiety) {
      expect(el.getAttribute("transform")).toMatch(/^rotate\(-45 /);
      expect(el.getAttribute("text-anchor")).toBe("end");
    }
    // Obrót kupuje miejsce w pionie, więc obszar kreślenia jest NIŻSZY niż
    // przy etykietach poziomych - i o tyle, ile naprawdę zajmuje rzut
    // najdłuższego napisu, a nie o stałą wartość.
    const poziome = render(
      <CartesianChart
        config={cfg({
          kind: "bar",
          categories: ["a", "b"],
          series: [{ name: "A", values: [1, 2] }],
        })}
        lang="pl"
      />,
    );
    const wysokoscPola = (root: HTMLElement): number =>
      Number(all(root, SEL.hit)[0].getAttribute("height"));
    expect(wysokoscPola(container)).toBeLessThan(wysokoscPola(poziome.container));
  });

  it("skrót semantyczny zapisu czasu wchodzi PRZED obrotem - nic nie traci", () => {
    // Drugi szczebel. "2024-Q1" -> "Q1'24" niesie tę samą informację
    // w krótszym zapisie, więc jest tańszy od obrotu i od przerzedzania.
    // Czterdzieści kwartałów: pełny zapis "2020-Q1" (7 znaków, ~48 px) daje
    // na pasmo 676/40 = 16,9 px krok 4, czyli powyżej progu przerzedzania;
    // skrót "Q1'20" (5 znaków, ~34 px) sprowadza go do 3 i drabina kończy
    // się tutaj, bez obrotu. Przy dwudziestu czterech kwartałach samo
    // przerzedzenie wystarcza i skrót się nie włącza - i tak ma być.
    const kwartaly = Array.from(
      { length: 40 },
      (_, i) => `${2020 + Math.floor(i / 4)}-Q${(i % 4) + 1}`,
    );
    const { container } = render(
      <CartesianChart
        config={cfg({
          kind: "bar",
          categories: kwartaly,
          series: [{ name: "A", values: kwartaly.map((_, i) => i + 1) }],
        })}
        lang="pl"
      />,
    );
    // `textContent` zlepia napis z `<title>`, więc czytamy je osobno.
    const pierwsza = all(container, SEL.catLabel)[0];
    expect(pierwsza.childNodes[0].textContent).toBe("Q1'20");
    // Pełny zapis zostaje dostępny w tooltipie etykiety - skrót semantyczny
    // niczego nie ukrywa, tylko zapisuje krócej.
    expect(pierwsza.querySelector("title")?.textContent).toBe("2020-Q1");
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
    // Krok bierze się teraz ze ZMIERZONEJ szerokości najdłuższej etykiety,
    // nie ze stałej 64 px na napis: 3 znaki po 11 px daje ~20 px, plus 6 px
    // prześwitu, na pasmo 676/40 = 16,9 px, czyli krok 2. Poprzednia formuła
    // (`ceil(n * 64 / innerW)` = 4) wycinała trzy z czterech etykiet, mimo że
    // co druga MIEŚCI SIĘ bez kolizji - przerzedzała na zapas.
    const napisy = textOf(container, SEL.catLabel);
    expect(napisy.slice(0, 4)).toEqual(["k0", "k2", "k4", "k6"]);
    // PIERWSZA I OSTATNIA zostają ZAWSZE - niosą zakres osi, bez nich
    // czytelnik nie wie, gdzie szereg się zaczyna i kończy. Stara formuła
    // kończyła na "k36" i ostatnia kategoria była bezimienna.
    expect(napisy[0]).toBe("k0");
    expect(napisy.at(-1)).toBe("k39");
    // Znaczniki są komplet - przerzedzanie dotyczy WYŁĄCZNIE napisów.
    expect(all(container, SEL.bar)).toHaveLength(40);
  });
});

describe("CartesianChart - słupki poziome", () => {
  const base: Record<string, Json> = {
    kind: "bar-horizontal",
    categories: ["Polska", "Niemcy"],
    series: [{ name: "PKB", values: [10, -4] }],
  };

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
    expect(dodatni).toContain("q6 0 6 6");
    expect(ujemny).toContain("q-6 0 -6 -6");
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
    // Widoczny napis jest ucięty, ale PEŁNA treść jedzie w `<title>`, czyli
    // jako tooltip i nazwa dostępnościowa - wielokropek bez pełnej treści
    // obok jest zakazany. `textContent` zlepia oba, więc czytamy je osobno.
    const etykieta = all(dlugie.container, SEL.catLabel)[0];
    expect(etykieta.childNodes[0].textContent).toBe("Województwo zachodniopo…");
    expect(etykieta.querySelector("title")?.textContent).toBe(
      "Województwo zachodniopomorskie i okolice",
    );

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
  const stos: Record<string, Json> = {
    kind: "bar",
    stacked: true,
    categories: ["2025", "2026"],
    series: [
      { name: "A", values: [10, 6] },
      { name: "B", values: [5, 4] },
    ],
  };

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
    expect(b0).toContain("q0 -6 6 -6");
    expect(b1).toContain("q0 -6 6 -6");
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
    // Prześwit w kolorze płyty istnieje tylko w prawdziwym stosie. Przy jednej
    // ocalałej serii wariant wraca do bladego, więc obwódka jest KRAWĘDZIĄ
    // SERII, a jej grubość niesie arkusz (`--chart-bar-edge`), nie atrybut -
    // `var()` w atrybutach prezentacyjnych SVG nie jest wspierane wszędzie.
    const bar = all(container, SEL.bar)[0];
    expect(bar.getAttribute("stroke")).toBe("var(--chart-1-edge)");
    expect(bar.getAttribute("stroke")).not.toBe("var(--card)");
    expect(bar.getAttribute("stroke-width")).toBeNull();
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
    expect(b).toContain("q0 6 6 6");
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
    expect(b0).toContain("q6 0 6 6");
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
    expect(path.startsWith("M370.0 ")).toBe(true);
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
    // Krycie idzie TOKENEM PER SLOT, nie stałą 0,12: różnica jasności odcienia
    // wobec płyty jest bardzo nierówna, więc jedna alfa dawała pola raz
    // niewidoczne, raz krzyczące. Wartość liczona jest pod kontrast
    // 1,10-1,17:1 do płyty i pilnuje jej bramka palety.
    // Krycie jedzie w `style`, NIE w atrybucie prezentacyjnym: `var()`
    // w atrybutach SVG nie jest wspierane wszędzie, a nierozwiązane krycie to
    // pełna nieprzezroczystość - czyli pole zamalowałoby wykres. Ten sam
    // powód, dla którego mapa-choropleta podaje `fill` w `style`.
    expect(all(container, SEL.area)[0].getAttribute("fill-opacity")).toBeNull();
    expect(all(container, SEL.area)[0].getAttribute("style")).toContain(
      "fill-opacity: var(--chart-band-1)",
    );
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
    expect(axisY).toBe("12");
    expect(d(all(container, SEL.area)[0])).toContain("12.0 Z");
  });

  it("pojedynczy punkt linii ląduje na środku pasa i zostaje widoczny jako kropka", () => {
    const { container } = render(
      <CartesianChart
        config={cfg({ kind: "line", categories: ["jedyna"], series: [{ name: "A", values: [7] }] })}
        lang="pl"
      />,
    );
    // Brak "L" - ścieżka to samo "M", więc czytelność niesie kropka.
    expect(d(all(container, SEL.line)[0])).toBe("M370.0 154.0");
    const dot = all(container, SEL.dot)[0];
    expect(dot.getAttribute("cx")).toBe("370");
    // Kropka obserwacji jest MNIEJSZA i ma inne role kolorów: wypełnienie
    // w kolorze PŁYTY, obwódka w kolorze serii. Widać sam pierścień, a on
    // czyta się jako "tu jest pomiar", nie jako kolejny znacznik danych.
    // Atrybut niesie wartość jasną awaryjnie; realny rozmiar przychodzi
    // z tokena `--chart-dot` (2,8 px na jasnym, 2,6 px na ciemnym).
    expect(dot.getAttribute("r")).toBe("2.8");
    expect(dot.getAttribute("fill")).toBe("var(--card)");
    expect(dot.getAttribute("stroke")).toBe("var(--chart-1)");
    expect(dot.getAttribute("class")).toContain("neh-dot");
  });

  it("WYGŁADZENIE WYMUSZA kropki, a brak miejsca na kropki wyłącza wygładzenie", () => {
    // WARUNEK UCZCIWOŚCI, nie preferencja: wygładzona linia bez widocznych
    // punktów nie mówi, gdzie kończą się dane, a gdzie zaczyna interpolacja,
    // więc czytelnik odczytuje wartość z miejsca, w którym jej nie zmierzono.
    // Zamiast "wygładzać i mieć nadzieję" silnik pyta, czy kropki się
    // ZMIESZCZĄ: przy odstępie punktów poniżej 6 px wyłącza wygładzanie
    // i rysuje łamaną, na której każdy wierzchołek JEST pomiarem.
    const many = (count: number) =>
      cfg({
        kind: "line",
        categories: Array.from({ length: count }, (_, i) => `k${i}`),
        series: [{ name: "A", values: Array.from({ length: count }, (_, i) => i + 1) }],
      });

    // 25 punktów na 676 px to odstęp ~28 px - wygładzanie działa, więc kropki
    // MUSZĄ być. Poprzednia wersja gasiła je powyżej 24 punktów i zostawiała
    // wygładzoną krzywą bez informacji, gdzie leżą pomiary.
    const gesty = render(<CartesianChart config={many(25)} lang="pl" />);
    expect(all(gesty.container, SEL.dot)).toHaveLength(25);
    expect(d(all(gesty.container, SEL.line)[0])).toContain("C");

    // Bez wygładzania (autor ustawił 0) kropki wracają do progu gęstości:
    // przy łamanej wierzchołek widać jako zmianę kierunku, więc kropka jest
    // tam wygodą, nie warunkiem.
    const lamana = render(
      <CartesianChart
        config={cfg({
          kind: "line",
          smoothing: 0,
          categories: Array.from({ length: 25 }, (_, i) => `k${i}`),
          series: [{ name: "A", values: Array.from({ length: 25 }, (_, i) => i + 1) }],
        })}
        lang="pl"
      />,
    );
    expect(all(lamana.container, SEL.dot)).toHaveLength(0);
    expect(d(all(lamana.container, SEL.line)[0])).not.toContain("C");

    // Trzeci przypadek - odstęp punktów poniżej 6 px, przy którym wygładzanie
    // wyłącza się samo - jest NIEOSIĄGALNY przez ten render: parser klamruje
    // liczbę kategorii do 60 (`MAX_CATEGORIES`), a `useContainerWidth` zwraca
    // w happy-dom stałe 720 px, więc odstęp nie zejdzie poniżej 11,5 px.
    // Sama reguła jest czystą funkcją i ma dowód u siebie:
    // `src/lib/charts/__tests__/geometry.test.ts`.
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
      ...defaultChartConfig(),
      kind: "bar",
      categories: ["a"],
      series: [{ name: "A", values: [10], colorSlot: 1 }],
      height: 60,
      showLegend: false,
      animate: false,
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

    expect(textOf(pl.container, SEL.tick).join("|")).toMatch(/5[\s\u00a0]mln/);
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

    expect(textOf(pl.container, SEL.valueLabel)[0]).toMatch(/^1[\s\u00a0\u202f]?234,5%$/);
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
  const dwieSerie: Record<string, Json> = {
    kind: "bar",
    unit: "%",
    categories: ["a", "b", "c"],
    series: [
      { name: "Alfa", values: [1, null, 3] },
      { name: "Beta", values: [2, 5, 6] },
    ],
  };

  it("strzałka w prawo aktywuje pierwszą kategorię i pokazuje WSZYSTKIE serie w JEDNYM tooltipie", () => {
    const { container } = render(<CartesianChart config={cfg({ ...dwieSerie })} lang="pl" />);
    fireEvent.keyDown(box(container), { key: "ArrowRight" });
    const tip = container.querySelector(SEL.tooltip);
    // SERIE SORTOWANE MALEJĄCO PO WARTOŚCI, nie w kolejności definicji - i to
    // jest zmiana reguły. Beta ma tu 2, Alfa 1, więc Beta jest pierwsza,
    // choć w konfiguracji stoi druga. Czytelnik porównuje wtedy dokładnie to,
    // co widzi na prowadnicy: kolejność wiersza w dymku odpowiada kolejności
    // serii w pionie na wykresie. Kolejność definicji jest wobec danych
    // przypadkowa i zmusza do wodzenia wzrokiem tam i z powrotem.
    expect(tip?.textContent).toBe("aBeta2%Alfa1%");
  });

  it("seria o NAJWYŻSZEJ wartości na prowadnicy dostaje mocniejszą wagę pisma", () => {
    // Wyróżnienie wagą, nie tłem wiersza: tło wprowadziłoby do dymka drugą
    // powierzchnię konkurującą z próbką koloru. Przy jednej serii nie ma czego
    // wyróżniać, więc wyróżnienie nie powstaje.
    const { container } = render(<CartesianChart config={cfg({ ...dwieSerie })} lang="pl" />);
    fireEvent.keyDown(box(container), { key: "ArrowRight" });
    const wiersze = [...(container.querySelector(SEL.tooltip)?.querySelectorAll("dd") ?? [])];
    expect(wiersze).toHaveLength(2);
    expect(wiersze[0].className).toContain("font-bold");
    expect(wiersze[1].className).not.toContain("font-bold");
  });

  it("PRÓBKA W TOOLTIPIE JEST KWADRATOWA, nie kreską", () => {
    // Kreska czyta się jako fragment linii serii, czyli jako znacznik danych;
    // kwadrat czyta się jako klucz. Ta sama forma co próbka legendy.
    const { container } = render(<CartesianChart config={cfg({ ...dwieSerie })} lang="pl" />);
    fireEvent.keyDown(box(container), { key: "ArrowRight" });
    const probka = container.querySelector(`${SEL.tooltip} dt span[aria-hidden]`);
    expect(probka?.className).toContain("h-2");
    expect(probka?.className).toContain("w-2");
    expect(probka?.className).not.toContain("rounded-full");
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
    // 337,77 a nie 338: margines lewy to teraz max(32, zmierzona szerokość
    // najdłuższej podziałki + 12), czyli 32,46 px dla podziałek "0,5".
    expect(pas.getAttribute("width")).toBe("337.77");
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

  it("TAPNIĘCIE ustawia stan i go TRZYMA - bez tego wykres jest na telefonie martwy", () => {
    // Na dotyku nie ma hovera: `pointerenter`/`pointermove` przychodzą przy
    // dotknięciu, a `pointerleave` NATYCHMIAST po podniesieniu palca. Wykres
    // oparty wyłącznie na parze enter/leave migał więc tooltipem i gasł.
    // Reguła: tapnięcie USTAWIA stan, tapnięcie poza elementem go ZDEJMUJE.
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

    // Samo dotknięcie, bez ruchu - `pointerdown` musi wystarczyć.
    fireEvent.pointerDown(hit, { clientX: 600, clientY: 100, pointerType: "touch" });
    expect(container.querySelector(SEL.tooltip)?.textContent).toBe("cA3");
    // Podniesienie palca NIE zdejmuje stanu.
    fireEvent.pointerLeave(hit, { pointerType: "touch" });
    expect(container.querySelector(SEL.tooltip)?.textContent).toBe("cA3");
    // Ale zjazd MYSZY zdejmuje - i tak samo zdejmuje go wskaźnik, którego
    // rodzaju środowisko nie podaje (warunek nazywa DOTYK, nie mysz).
    fireEvent.pointerLeave(hit, { pointerType: "mouse" });
    expect(container.querySelector(SEL.tooltip)).toBeNull();
  });

  it("TAPNIĘCIE POZA wykresem zdejmuje stan ustawiony dotykiem", () => {
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
    fireEvent.pointerDown(hit, { clientX: 600, clientY: 100, pointerType: "touch" });
    expect(container.querySelector(SEL.tooltip)).not.toBeNull();

    // Tapnięcie WEWNĄTRZ wykresu stanu nie zdejmuje - inaczej dotknięcie
    // sąsiedniej kategorii najpierw gasiłoby tooltip, a potem go zapalało.
    fireEvent.pointerDown(hit, { clientX: 10, clientY: 100, pointerType: "touch" });
    expect(container.querySelector(SEL.tooltip)?.textContent).toBe("aA1");

    // Tapnięcie poza - zdejmuje.
    fireEvent.pointerDown(document.body, { pointerType: "touch" });
    expect(container.querySelector(SEL.tooltip)).toBeNull();
  });

  it("PODŚWIETLENIE PASA leży POD znacznikami, więc nie przyciemnia wypełnień", () => {
    // Pas jest afordancją strefy trafienia ("kursor jest w tej kategorii"),
    // a nie podświetleniem danych. Rysowany PO słupkach kładł 5% tuszu wprost
    // na wypełnieniu: blade wnętrze siedzi na 1,20-1,28:1 do płyty, więc
    // pięcioprocentowa zasłona realnie je przyciemniała - czyli wskazanie
    // zmieniało wygląd zakodowanej wartości.
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

    const pas = [...container.querySelectorAll("rect[fill-opacity='0.05']")];
    expect(pas).toHaveLength(1);
    const slupek = container.querySelector(SEL.bar);
    expect(slupek).not.toBeNull();
    // Kolejność dokumentu: pas PRZED słupkiem, czyli pod nim w kolejności
    // rysowania SVG.
    expect(
      pas[0].compareDocumentPosition(slupek as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("nawigacja strzałkami jest OPISANA, a obramowanie focusu idzie z arkusza", () => {
    // Nawigacja strzałkami po kategoriach jest jedynym sposobem odczytania
    // wartości bez wskaźnika, a nic o niej nie mówiło: klucz słownika istniał
    // i nie był używany, czyli funkcja była dostępna wyłącznie dla kogoś, kto
    // się jej domyślił.
    const { container } = render(
      <CartesianChart
        config={cfg({
          kind: "bar",
          categories: ["a", "b"],
          series: [{ name: "A", values: [1, 2] }],
        })}
        lang="pl"
      />,
    );
    const canvas = box(container);
    const hintId = canvas.getAttribute("aria-describedby");
    expect(hintId).toBeTruthy();
    expect(document.getElementById(hintId ?? "")?.textContent).toBe(
      "Strzałkami przesuwasz aktywną kategorię, Escape czyści zaznaczenie.",
    );
    // OBRAMOWANIE FOCUSU W ARKUSZU, nie w klasach narzędziowych: spec żąda
    // linii CIĄGŁEJ 2 px w tuszu trzecim odsuniętej o 2 px, a `ring-*`
    // rysowało cień w kolorze `--ring`. Tu pilnujemy tylko tego, że kanwa
    // nosi klasę, na której arkusz to wiesza - samego koloru nie widać
    // w happy-dom, bo nie ma silnika stylów.
    expect(canvas.className).toContain("neh-canvas");
    expect(canvas.className).not.toContain("focus-visible:ring");
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
    // Rozmiar kropki NIE jest już kodowany w atrybucie `r` per stan: atrybut
    // niesie wartość jasną awaryjnie, a realny promień - i jego powiększenie
    // pod kursorem - przychodzi z tokena przez CSS
    // (`.neh-dot` / `.neh-dot[data-active="true"]`). Dzięki temu korekta
    // irradiacji w trybie ciemnym dzieje się bez gałęzi w JS. Aktywny punkt
    // jest w DOM oznaczony atrybutem, nie liczbą.
    expect(all(container, SEL.dot).map((c) => c.getAttribute("r"))).toEqual([
      "2.8",
      "2.8",
      "2.8",
      "2.8",
    ]);
    expect(all(container, SEL.dot).map((c) => c.getAttribute("data-active"))).toEqual([
      null,
      null,
      "true",
      null,
    ]);
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
    expect(container.querySelector(SEL.tooltip)?.getAttribute("style")).toContain("translate(12px");
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
    // Nakładki wzoru (sloty 7-8) odsiane: pytamy o KOLORY serii, a wzór
    // kolorem serii nie jest - jego paski są w kolorze płyty.
    const fills = all(container, SEL.bar)
      .map((b) => b.getAttribute("fill"))
      .filter((f) => (f ?? "").startsWith("var("));
    // MAX_SERIES = 8: dziewiąta seria nie wraca na --chart-1, tylko nie istnieje.
    expect(fills).toEqual(Array.from({ length: 8 }, (_, i) => `var(--chart-${i + 1})`));
  });

  it("SŁUPEK w slocie poza zestawem bezpiecznym dostaje WZÓR, tak jak obiecuje legenda", () => {
    // REGRESJA. Legenda znaczy sloty 7-8 próbką w paski, bo ich odcień jest od
    // slotów 1-2 oddalony o ~10-12 jednostek CIELAB po symulacji daltonizmu -
    // za mało, żeby sam kolor je odróżnił. Linia dostawała na to
    // `neh-line-pattern` z arkusza, ale słupki zostawały JEDNOLITE: klucz
    // pokazywał różnicę, której w rysunku nie było. Słupka nie da się
    // zakreskować `stroke-dasharray` - różnicę niesie jego wypełnienie, więc
    // wzór wchodzi nakładką na tym samym kształcie.
    const { container } = render(
      <CartesianChart
        config={cfg({
          kind: "bar",
          categories: ["a", "b"],
          series: [
            { name: "Bezpieczna", values: [3, 4], colorSlot: 1 },
            { name: "Rozszerzenie", values: [5, 6], colorSlot: 7 },
          ],
        })}
        lang="pl"
      />,
    );
    const sciezki = all(container, SEL.bar);
    const wzory = sciezki.filter((b) =>
      (b.getAttribute("fill") ?? "").startsWith("url(#neh-hatch"),
    );
    // Po jednej nakładce na każdy znacznik serii ze slotu 7 - i ani jednej
    // dla serii ze slotu 1, która różni się samym odcieniem wystarczająco.
    expect(wzory).toHaveLength(2);
    // Nakładka leży na TYM SAMYM kształcie, co znacznik: inny kształt znaczyłby
    // wzór przesunięty względem słupka, czyli nowy defekt w miejscu naprawy.
    const slupki7 = sciezki.filter((b) => b.getAttribute("fill") === "var(--chart-7)");
    expect(slupki7).toHaveLength(2);
    expect(wzory.map(d).sort()).toEqual(slupki7.map(d).sort());
    // Definicja wzoru istnieje i jego paski są w kolorze PŁYTY, nie serii -
    // dzięki temu jedna definicja obsługuje każdy slot.
    const pattern = container.querySelector("pattern");
    expect(pattern).not.toBeNull();
    expect(pattern?.querySelector("rect")?.getAttribute("fill")).toBe("var(--card)");
  });

  it("wykres BEZ slotów rozszerzonych nie płaci za wzór ani jedną definicją", () => {
    const { container } = render(
      <CartesianChart
        config={cfg({
          kind: "bar",
          categories: ["a"],
          series: [{ name: "S", values: [3], colorSlot: 2 }],
        })}
        lang="pl"
      />,
    );
    expect(container.querySelector("pattern")).toBeNull();
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
    expect(box(container).getAttribute("aria-label")).toBe("Wykres: Leady - workspace beta");
    const html = container.innerHTML;
    for (const slad of ["Alfa", "alfa", "11 szt.", "22 szt."]) {
      expect(html).not.toContain(slad);
    }
  });
});

describe("CartesianChart - odporność stanu interakcji i pas wyłącznie ujemny", () => {
  it("podmiana configu na krótszy nie wywraca wykresu: aktywny indeks z poprzedniego zestawu wraca w zakres nowej tablicy", () => {
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

    // Aktywny indeks przeżywa podmianę - to ten sam, ŻYWY komponent - więc
    // przy krótszym zestawie musi zostać przyklamrowany do jego zakresu:
    // tooltip przeskakuje na jedyną kategorię nowego configu. Bez klamry
    // indeks 2 czytałby poza jednoelementową tablicą i render padał na
    // "Cannot read properties of undefined (reading 'toLocaleString')".
    rerender(<CartesianChart config={waski} lang="pl" />);
    expect(container.querySelector(SEL.tooltip)?.textContent).toBe("b1SB9");
  });

  it("pas wyłącznie ujemny, którego OSTATNIA seria ma lukę, i tak dostaje zaokrąglony koniec z danymi", () => {
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
    // `lastStackIndexFor` szuka domknięcia PO ZNAKU segmentu, więc nie
    // spada na fallback `series.length - 1` - czyli na serię B, która w tej
    // kategorii nic nie rysuje i zabrałaby zaokrąglenie całemu pasowi.
    const [luka] = ds(container, SEL.bar);
    expect(luka).toContain("q0 6 6 6");
  });
});
