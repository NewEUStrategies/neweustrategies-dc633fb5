// WYKRES PUNKTOWY - CO MUSI BYĆ PRAWDĄ O RYSUNKU.
//
// SKĄD BIORĘ LICZBY. `useContainerWidth` czyta `clientWidth`, które
// w happy-dom wynosi 0, więc szerokość zostaje na wartości startowej 720 -
// geometria jest w pełni deterministyczna i można asertować piksele.
// `useRevealOnScroll` nigdy nie dostaje callbacku IntersectionObservera, więc
// stan to zawsze "static", czyli dokładnie to, co widzi crawler.
//
// CZEGO TU NIE MA. Arytmetyka zależności (źródło osi X, regresja, R²,
// korelacja, zasłanianie plamek, domena, samosprawdzenia uczciwości) ma własny
// plik testowy przy modelu. Tutaj sprawdzam wyłącznie to, czego model
// sprawdzić nie może: czy RYSUNEK mówi to, co model policzył - i czy nie mówi
// nic więcej.
//
// DLACZEGO ASERTUJĘ TREŚĆ SŁOWNIKA. Klucze `charts.scatter.*` są już
// w repozytorium (PL i EN), więc test na napis nie jest testem tłumaczenia,
// tylko testem tego, że render woła TĘ ścieżkę klucza, którą powinien: zdanie
// o współzmienności i ostrzeżenie o R² pod progiem są WYMAGANE obok trendu,
// a pomyłka w ścieżce daje pod rysunkiem surowy klucz albo pustkę.
import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import type { Json } from "@/lib/content-model/json";
import { parseChartConfig } from "@/lib/charts/parse";
import type { ChartConfig } from "@/lib/charts/types";
import { HIT_RADIUS_PX } from "@/lib/charts/plot";
import { SCATTER_MARKER_R, SCATTER_MARKER_STROKE } from "@/lib/charts/kinds/scatter";
import { ScatterChart } from "../ScatterChart";
import { Chart } from "../Chart";

function cfg(data: Record<string, Json>): ChartConfig {
  return parseChartConfig(data);
}

const all = (root: HTMLElement, sel: string): Element[] => [...root.querySelectorAll(sel)];
const num = (el: Element, attr: string): number => Number(el.getAttribute(attr));
const punkty = (root: HTMLElement): Element[] => all(root, "circle[data-role='cloud-point']");
const dymek = (root: HTMLElement): string => root.querySelector(".neh-tooltip")?.textContent ?? "";
const nota = (root: HTMLElement, key: string): string =>
  root.querySelector(`[data-note='${key}']`)?.textContent ?? "";

/**
 * Dwanaście par o zależności, której nie da się podważyć: `y` rośnie dwa razy
 * szybciej niż `x`, z jednym reszt na co drugiej obserwacji. R² wychodzi
 * niedoskonałe (0,99), a nie równe jedności - inaczej test na zaokrąglenie
 * etykiety trendu nie miałby czego sprawdzić.
 */
const X_ROSNIE = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const Y_ROSNIE = [2, 4, 5, 8, 9, 12, 13, 16, 17, 20, 21, 24];

/**
 * Ta sama oś X, a `y` skacze między dwiema wartościami. R² = 0,02, czyli pod
 * progiem `SCATTER_R2_MEANINGLESS`: model policzy nachylenie, ale nazwie je
 * nieznaczącym.
 */
const Y_SZUM = [10, 1, 10, 1, 10, 1, 10, 1, 10, 1, 10, 1];

/**
 * Wykres punktowy potrzebuje DWÓCH zmiennych, a konfiguracja nie ma pola na
 * ciągłą oś X - model bierze ją więc z PIERWSZEJ serii, a każda następna jest
 * osobną chmurą przeciw temu samemu `x` (`xSource: "series"`). Etykiety
 * wierszy zostają nieliczbowe, żeby to rozstrzygnięcie było jednoznaczne.
 */
function baza(
  x: (number | null)[],
  y: (number | null)[],
  extra: Record<string, Json> = {},
): Record<string, Json> {
  return {
    // `kind` zostaje przy "bar": podłączenie rodzaju do rozdzielnika i do
    // schematu robi osobny commit, a komponent `config.kind` w ogóle nie czyta.
    kind: "bar",
    categories: x.map((_, i) => `obs-${i + 1}`),
    series: [
      { name: "PKB per capita", values: x },
      { name: "Zaufanie", values: y },
    ],
    animate: false,
    ...extra,
  };
}

/** happy-dom nie mierzy elementów - bez podmiany każdy `pointermove` to NaN. */
function stubPlotRect(
  hit: Element,
  left: number,
  top: number,
  width: number,
  height: number,
): void {
  Object.defineProperty(hit, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: left,
      y: top,
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
      toJSON: () => ({}),
    }),
  });
}

/**
 * Warstwa trafień z podmienionym prostokątem. Jej atrybuty SĄ polem rysunku,
 * a `left`/`top` prostokąta są jego przesunięciem w SVG, więc po podmianie
 * `clientX` równa się `cx` znacznika - test nie musi znać marginesów.
 */
function warstwa(root: HTMLElement): { hit: Element; x: number; y: number; w: number; h: number } {
  const hit = root.querySelector("rect.neh-hit");
  if (!hit) throw new Error("brak warstwy trafień");
  const x = num(hit, "x");
  const y = num(hit, "y");
  const w = num(hit, "width");
  const h = num(hit, "height");
  stubPlotRect(hit, x, y, w, h);
  return { hit, x, y, w, h };
}

/** Najkrótsza odległość od punktu ekranu do którejkolwiek kropki. */
function najblizszaKropka(root: HTMLElement, clientX: number, clientY: number): number {
  return Math.min(
    ...punkty(root).map((k) => Math.hypot(num(k, "cx") - clientX, num(k, "cy") - clientY)),
  );
}

describe("ScatterChart - punktów NIE WOLNO łączyć linią", () => {
  it("dwanaście par daje dwanaście kropek i ANI JEDNEJ ścieżki między nimi", () => {
    // NAJWAŻNIEJSZA ASERCJA TEGO PLIKU, bo kolumna "czego unikać" ma dla tego
    // rodzaju jedno hasło. Łamana przez chmurę twierdzi dwie rzeczy naraz
    // i obie są tu fałszywe: że obserwacje mają kolejność i że między dwoma
    // krajami o PKB 12 i 31 istnieje kraj o PKB 21. Czytelnik przeczytałby
    // z niej przebieg zjawiska, którego dane nie opisują.
    const { container } = render(<ScatterChart config={cfg(baza(X_ROSNIE, Y_ROSNIE))} lang="pl" />);
    expect(punkty(container)).toHaveLength(X_ROSNIE.length);
    expect(all(container, "path")).toHaveLength(0);
    expect(all(container, "polyline")).toHaveLength(0);
  });

  it("render publikuje oświadczenie modelu `mayConnectPoints` na rysunku", () => {
    // Zakaz wyrażony atrybutem, a nie komentarzem: gdyby model kiedyś zwrócił
    // `true`, ta wartość zmieni się razem z nim i bramka zapali się, zanim
    // ktokolwiek zobaczy chmurę spiętą łamaną. Komentarza żadna bramka nie
    // czyta.
    const { container } = render(<ScatterChart config={cfg(baza(X_ROSNIE, Y_ROSNIE))} lang="pl" />);
    expect(container.querySelector("svg")?.getAttribute("data-connect-points")).toBe("false");
  });
});

describe("ScatterChart - kropka obserwacji", () => {
  it("ma promień i obwódkę ze STAŁYCH MODELU, nie z tokena markera linii", () => {
    // Reguła `.neh-dot { r: var(--chart-dot) }` nadpisuje atrybut `r` (CSS
    // wygrywa z prezentacyjnym atrybutem SVG), więc kropka z tą klasą
    // rysowałaby się promieniem markera linii, a nie tym, który dla tego
    // rodzaju podaje model. Czytelnik nie zobaczyłby różnicy, a dwie jedyne
    // stałe delikatności tego rodzaju przestałyby cokolwiek znaczyć.
    const { container } = render(<ScatterChart config={cfg(baza(X_ROSNIE, Y_ROSNIE))} lang="pl" />);
    for (const k of punkty(container)) {
      expect(num(k, "r")).toBe(SCATTER_MARKER_R);
      expect(num(k, "stroke-width")).toBe(SCATTER_MARKER_STROKE);
      expect(k.getAttribute("class") ?? "").not.toContain("neh-dot");
    }
  });

  it("obwódka niesie kolor serii, a wnętrze kolor płyty - oba TOKENAMI", () => {
    // Punkty nie mają osi, do której dałoby się je przypiąć etykietą, więc
    // obwódka jest jedynym nośnikiem tożsamości chmury. Wnętrze w kolorze
    // płyty (nie w bieli) sprawia, że w trybie ciemnym kropka sama staje się
    // ciemna i nadal odcina się od tła - hex w kodzie rysującym psuje tryb
    // ciemny w tym jednym miejscu, którego nikt potem nie szuka.
    const { container } = render(<ScatterChart config={cfg(baza(X_ROSNIE, Y_ROSNIE))} lang="pl" />);
    const pierwsza = punkty(container)[0];
    expect(pierwsza.getAttribute("stroke")).toMatch(/^var\(--chart-\d\)$/);
    expect(pierwsza.getAttribute("fill")).toBe("var(--card)");
  });

  it("żadna kropka nie wychodzi z pola rysunku", () => {
    // Punkt ucięty krawędzią to obserwacja niepokazana, a ucina się zawsze
    // obserwację SKRAJNĄ - czyli tę, która najmocniej ciągnie nachylenie
    // i o którą czytelnik pyta najpierw.
    const { container } = render(<ScatterChart config={cfg(baza(X_ROSNIE, Y_ROSNIE))} lang="pl" />);
    const { x, y, w, h } = warstwa(container);
    for (const k of punkty(container)) {
      const r = num(k, "r") + SCATTER_MARKER_STROKE / 2;
      expect(num(k, "cx")).toBeGreaterThanOrEqual(x + r - 0.01);
      expect(num(k, "cx")).toBeLessThanOrEqual(x + w - r + 0.01);
      expect(num(k, "cy")).toBeGreaterThanOrEqual(y + r - 0.01);
      expect(num(k, "cy")).toBeLessThanOrEqual(y + h - r + 0.01);
    }
  });

  it("punkt zdublowany jest OZNACZONY, ale nie przesunięty", () => {
    // Obie współrzędne punktu są danymi, więc drgnięcie o pół markera jest
    // przesunięciem pomiaru - to jest różnica wobec roju, gdzie druga
    // współrzędna jest dopełnieniem rysunku. Bez oznaczenia czytelnik widzi
    // jedną obserwację tam, gdzie były dwie, i liczy chmurę o jeden krócej,
    // niż mówi `n` w podpisie.
    const x = [...X_ROSNIE, 6];
    const y = [...Y_ROSNIE, 12];
    const { container } = render(<ScatterChart config={cfg(baza(x, y))} lang="pl" />);
    const zdublowane = all(container, "circle[data-role='cloud-point'][data-overplotted='true']");
    expect(zdublowane).toHaveLength(2);
    expect(num(zdublowane[0], "cx")).toBeCloseTo(num(zdublowane[1], "cx"), 6);
    expect(num(zdublowane[0], "cy")).toBeCloseTo(num(zdublowane[1], "cy"), 6);
    // Wypełnienie jest jedynym dozwolonym nośnikiem tej informacji na rysunku.
    expect(zdublowane[0].getAttribute("fill")).toMatch(/^var\(--chart-\d-inner\)$/);
  });
});

describe("ScatterChart - odcinek trendu jest twierdzeniem i musi mieć dowód", () => {
  it("kończy się na skrajnych OBSERWACJACH, nie na krawędzi rysunku", () => {
    // Prosta przedłużona do brzegu płyty twierdzi o obszarze, w którym nie ma
    // ani jednego pomiaru, a wygląda dokładnie tak samo jak jej część opisująca
    // dane - czytelnik nie ma czym tych dwóch odcinków odróżnić.
    const { container } = render(<ScatterChart config={cfg(baza(X_ROSNIE, Y_ROSNIE))} lang="pl" />);
    const trend = container.querySelector("[data-role='trend']");
    if (!trend) throw new Error("brak odcinka trendu");
    const cx = punkty(container).map((k) => num(k, "cx"));
    expect(num(trend, "x1")).toBeCloseTo(Math.min(...cx), 6);
    expect(num(trend, "x2")).toBeCloseTo(Math.max(...cx), 6);
    const { x, w } = warstwa(container);
    expect(num(trend, "x1")).toBeGreaterThan(x);
    expect(num(trend, "x2")).toBeLessThan(x + w);
  });

  it("przy odcinku stoją R² ORAZ n, w jednej etykiecie", () => {
    // Nachylenie bez miary dopasowania i bez liczby obserwacji jest ozdobą:
    // "y rośnie z x" na trzech punktach i na trzystu wygląda identycznie.
    // Rozdzielenie tych liczb na dwa miejsca rysunku pozwoliłoby przeczytać
    // jedną bez drugiej, więc stoją w tym samym napisie.
    const { container } = render(<ScatterChart config={cfg(baza(X_ROSNIE, Y_ROSNIE))} lang="pl" />);
    const etykieta = container.querySelector("[data-role='trend-label']")?.textContent ?? "";
    expect(etykieta).toContain("R²");
    expect(etykieta).toContain("n = 12");
  });

  it("R² niedoskonałe NIE zaokrągla się do jedynki", () => {
    // Dopasowanie 0,99 wypisane jako "R² = 1" jest artefaktem zaokrąglenia tej
    // samej klasy co suma udziałów 99,9% pokazana jako 100%: czytelnik czyta
    // z tego doskonałe wyjaśnienie zmienności, którego dane nie dają.
    const { container } = render(<ScatterChart config={cfg(baza(X_ROSNIE, Y_ROSNIE))} lang="pl" />);
    const etykieta = container.querySelector("[data-role='trend-label']")?.textContent ?? "";
    expect(etykieta).toMatch(/R² = 0,\d\d/);
  });

  it("zdanie o współzmienności stoi pod rysunkiem razem z metodą regresji", () => {
    // Nachylenie opisuje WSPÓŁZMIENNOŚĆ, a czytelnik czyta z linii przyczynę -
    // i nie jest to jego wina, tylko właściwość formy. Metoda jest umową
    // (najmniejsze kwadraty `y` po `x` dają inną prostą niż `x` po `y`), więc
    // ktoś przeliczający te dane u siebie musi wiedzieć, co przeliczać.
    const { container } = render(<ScatterChart config={cfg(baza(X_ROSNIE, Y_ROSNIE))} lang="pl" />);
    expect(nota(container, "trend.notCausal")).toContain("Współzmienność");
    expect(nota(container, "trend.method")).toContain("najmniejszych kwadratów");
  });

  it("R² pod progiem: odcinka NIE MA, jest zdanie o tym, czego nie widać", () => {
    // Prosta o R² = 0,02 jest kreską o dowolnym nachyleniu - jedna dodana
    // obserwacja potrafi je odwrócić. Narysowana, czyta się jako wniosek,
    // a ostrzeżenie pod rysunkiem przegrywa z tym, co oko już przeczytało.
    const { container } = render(<ScatterChart config={cfg(baza(X_ROSNIE, Y_SZUM))} lang="pl" />);
    expect(container.querySelector("[data-role='trend']")).toBeNull();
    expect(container.querySelector("[data-role='trend-label']")).toBeNull();
    expect(nota(container, "reading.trendShowsNothing")).toContain("0,1");
  });

  it("SKALA OBEJMUJE odcinek, więc jego koniec nie schodzi pod oś", () => {
    // Wartość dopasowana na skrajnej obserwacji `x` potrafi wypaść poza zakres
    // obserwacji `y`: przy tych danych regresja startuje z 1,87, a najmniejsza
    // obserwacja to 2. Odcinek wychodziłby wtedy pod oś, w pas podziałki,
    // i czytałby się jako artefakt renderu. Przycięcie go do krawędzi byłoby
    // gorsze: skrócony odcinek ma inne nachylenie niż policzona regresja.
    const { container } = render(
      <ScatterChart config={cfg(baza([1, 2, 3, 4, 5, 6], [2, 4, 5, 8, 9, 12]))} lang="pl" />,
    );
    const trend = container.querySelector("[data-role='trend']");
    if (!trend) throw new Error("brak odcinka trendu");
    const { y, h } = warstwa(container);
    for (const attr of ["y1", "y2"]) {
      expect(num(trend, attr)).toBeGreaterThanOrEqual(y);
      expect(num(trend, attr)).toBeLessThanOrEqual(y + h);
    }
  });

  it("poniżej trzech par nie ma ani odcinka, ani zdania o współzmienności", () => {
    // Przy dwóch punktach prosta przechodzi dokładnie przez oba i R² wychodzi
    // równo 1 z arytmetyki, nie z siły zależności. "R² = 1,00 przy n = 2" jest
    // najgorszym możliwym wykresem: wygląda na dowód, a jest rysunkiem prostej,
    // którą przez dwa punkty da się poprowadzić zawsze.
    const { container } = render(<ScatterChart config={cfg(baza([1, 2], [5, 9]))} lang="pl" />);
    expect(punkty(container)).toHaveLength(2);
    expect(container.querySelector("[data-role='trend']")).toBeNull();
    expect(nota(container, "trend.notCausal")).toBe("");
    // Zamiast trendu stoi zdanie o tym, dlaczego go nie ma - inaczej czytelnik
    // szuka na rysunku elementu, którego render świadomie nie narysował.
    expect(nota(container, "honesty.enoughForTrendOk")).toContain("3");
  });

  it("wszystkie X równe: regresji nie ma i render jej nie podstawia", () => {
    // Kolumna punktów to rozkład JEDNEJ zmiennej, a nie zależność dwóch -
    // prosta pionowa nie jest funkcją y(x), a nachylenie zerowe twierdziłoby,
    // że `y` od `x` nie zależy, czego te dane nie mówią.
    const { container } = render(
      <ScatterChart config={cfg(baza([4, 4, 4, 4, 4], [1, 2, 3, 4, 5]))} lang="pl" />,
    );
    expect(container.querySelector("[data-role='trend']")).toBeNull();
    expect(nota(container, "reading.noXVariance")).toContain("jednej kolumnie");
    for (const k of punkty(container)) expect(Number.isFinite(num(k, "cx"))).toBe(true);
  });
});

describe("ScatterChart - dwie chmury przeciw jednej osi X", () => {
  /** Trzy kolumny: X wspólne, dwie zmienne Y o PRZECIWNYM nachyleniu. */
  function dwieChmury(): Record<string, Json> {
    const x = [1, 2, 3, 4, 5, 6, 7, 8];
    return {
      kind: "bar",
      categories: x.map((_, i) => `obs-${i + 1}`),
      series: [
        { name: "PKB per capita", values: x },
        { name: "Zaufanie", values: x.map((v) => v * 2) },
        { name: "Obawa", values: x.map((v) => 30 - v) },
      ],
      animate: false,
    };
  }

  it("każda chmura ma WŁASNY kolor i WŁASNY odcinek trendu", () => {
    // Regresja policzona na dwóch chmurach razem potrafi mieć nachylenie
    // przeciwne do nachylenia każdej z nich osobno (paradoks Simpsona), czyli
    // pokazywać zależność, której nie ma w żadnej z badanych populacji. Jeden
    // odcinek na dwie chmury byłby dokładnie tym rysunkiem.
    const { container } = render(<ScatterChart config={cfg(dwieChmury())} lang="pl" />);
    expect(punkty(container)).toHaveLength(16);
    const trendy = all(container, "[data-role='trend']");
    expect(trendy).toHaveLength(2);
    const kolory = new Set(trendy.map((e) => e.getAttribute("stroke")));
    expect(kolory.size).toBe(2);
    // Przeciwne nachylenia: jeden odcinek idzie w górę, drugi w dół. W SVG
    // „w górę" znaczy malejące `y`, więc znaki muszą być różne.
    const kierunki = trendy.map((e) => Math.sign(num(e, "y2") - num(e, "y1")));
    expect(new Set(kierunki).size).toBe(2);
  });

  it("strzałka pionowa przechodzi do DRUGIEJ chmury przy najbliższym x", () => {
    // Strzałka pozioma czyta jedną zależność, pionowa odpowiada na pytanie
    // „co ma druga seria przy tej samej wartości X". Bez tego rozdzielenia
    // nawigacja klawiaturą przeskakiwałaby między chmurami w środku odczytu
    // jednej z nich i czytelnik nie wiedziałby, którą właśnie czyta.
    const { container } = render(<ScatterChart config={cfg(dwieChmury())} lang="pl" />);
    const box = container.querySelector<HTMLElement>("[role='img']");
    if (!box) throw new Error("brak kontenera");
    fireEvent.keyDown(box, { key: "ArrowRight" });
    const pierwszy = container.querySelector("circle[data-active='true']");
    if (!pierwszy) throw new Error("brak punktu czynnego");
    expect(pierwszy.getAttribute("data-cloud")).toBe("0");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    const drugi = container.querySelector("circle[data-active='true']");
    if (!drugi) throw new Error("brak punktu czynnego po zmianie chmury");
    expect(drugi.getAttribute("data-cloud")).toBe("1");
    // TA SAMA wartość X, czyli ta sama pozycja pozioma - inaczej pion
    // przenosiłby czytelnika w inne miejsce zależności.
    expect(num(drugi, "cx")).toBeCloseTo(num(pierwszy, "cx"), 6);
  });

  it("dymek nazywa serię, gdy chmur jest więcej niż jedna", () => {
    // Przy jednej chmurze nazwa serii stoi już przy osi Y i wiersz w dymku
    // byłby powtórzeniem; przy dwóch kolor jest jedynym nośnikiem tożsamości
    // na rysunku, więc dymek musi powiedzieć słowem, w którą chmurę czytelnik
    // właśnie celuje.
    const { container } = render(<ScatterChart config={cfg(dwieChmury())} lang="pl" />);
    const { hit } = warstwa(container);
    const k = all(container, "circle[data-cloud='1']")[2];
    fireEvent.pointerMove(hit, { clientX: num(k, "cx"), clientY: num(k, "cy") });
    const tekst = dymek(container);
    expect(tekst).toContain("Seria");
    expect(tekst).toContain("Obawa");
    // Tytuł osi Y przestaje być nazwą serii, bo serii jest kilka.
    expect(container.querySelector("[data-role='axis-y-title']")?.textContent).toBe("Zmienna Y");
  });
});

describe("ScatterChart - dwie osie, dwa własne zakresy", () => {
  it("podziałka jest na OBU osiach, ze skrajnymi wartościami podpisanymi", () => {
    // Obie osie są tu danymi i z obu odczytuje się liczbę. Podziałka tylko na
    // jednej zamieniłaby drugą współrzędną w informację jakościową
    // ("wyżej/niżej"), czyli w połowę wykresu, której nie da się odczytać.
    const { container } = render(<ScatterChart config={cfg(baza(X_ROSNIE, Y_ROSNIE))} lang="pl" />);
    const os = (rola: string): number[] =>
      all(container, `[data-role='${rola}']`)
        .map((e) => Number((e.textContent ?? "").replace(/\s/g, "").replace(",", ".")))
        .filter((v) => Number.isFinite(v));
    const x = os("tick-x");
    const y = os("tick-y");
    expect(x.length).toBeGreaterThan(1);
    expect(y.length).toBeGreaterThan(1);
    // Zakres podziałki musi obejmować dane - inaczej rysunek ucina obserwację.
    expect(Math.max(...x)).toBeGreaterThanOrEqual(Math.max(...X_ROSNIE));
    expect(Math.max(...y)).toBeGreaterThanOrEqual(Math.max(...Y_ROSNIE));
  });

  it("etykieta punktu skrajnego ucieka na lewo, zamiast wyjść za pole rysunku", () => {
    // Punkt o najwyższym `x` zawsze leży u prawej krawędzi, więc etykieta
    // odsunięta w prawo wychodzi za płytę ZAWSZE, a nie w rzadkim przypadku.
    // Nazwa najciekawszej obserwacji jest wtedy ucięta krawędzią karty, czego
    // sekcja 1 nie dopuszcza.
    const { container } = render(
      <ScatterChart
        config={cfg({
          kind: "bar",
          categories: ["Polska", "Litwa", "Łotwa", "Estonia", "Finlandia-Zachodnia"],
          series: [
            { name: "PKB per capita", values: [10, 20, 30, 40, 50] },
            { name: "Zaufanie", values: [11, 19, 32, 38, 51] },
          ],
          animate: false,
          showValues: true,
        })}
        lang="pl"
      />,
    );
    const { x, w } = warstwa(container);
    const etykiety = all(container, "[data-role='point-label']");
    expect(etykiety.length).toBeGreaterThan(0);
    for (const e of etykiety) {
      expect(num(e, "x")).toBeGreaterThanOrEqual(x);
      expect(num(e, "x")).toBeLessThanOrEqual(x + w);
    }
    const ostatnia = etykiety[etykiety.length - 1];
    expect(ostatnia.textContent).toBe("Finlandia-Zachodnia");
    expect(ostatnia.getAttribute("text-anchor")).toBe("end");
  });

  it("przy osiach stoją NAZWY zmiennych, wzięte z arkusza autora", () => {
    // Bez nazw czytelnik widzi kształt zależności, nie wiedząc, między czym
    // a czym ona zachodzi - a to jest jedyne pytanie, na które ten rodzaj
    // odpowiada. Nazwa osi X jest nazwą pierwszej serii, bo to ona jest osią.
    const { container } = render(<ScatterChart config={cfg(baza(X_ROSNIE, Y_ROSNIE))} lang="pl" />);
    expect(container.querySelector("[data-role='axis-x-title']")?.textContent).toBe(
      "PKB per capita",
    );
    expect(container.querySelector("[data-role='axis-y-title']")?.textContent).toBe("Zaufanie");
  });

  it("ucięcie osi jest NAZWANE, gdy narysowana podziałka nie obejmuje zera", () => {
    // Punktowy koduje położeniem, więc sekcja 8 zera nie wymaga - wymaga
    // OZNACZENIA ucięcia. Ostrzeżenie o uciętej osi z ramy karty dotyczy
    // wyłącznie linii i pola, więc dla tego rodzaju nikt inny tego nie powie.
    const daleko = X_ROSNIE.map((v) => v + 100);
    const { container } = render(
      <ScatterChart
        config={cfg(
          baza(
            daleko,
            Y_ROSNIE.map((v) => v + 200),
          ),
        )}
        lang="pl"
      />,
    );
    expect(nota(container, "axis.truncated")).toContain("PKB per capita");
    expect(nota(container, "axis.truncated")).toContain("Zaufanie");
  });

  it("nie NAZYWA ucięcia, gdy podziałka wciągnęła zero z powrotem", () => {
    // `niceScale` dociąga oś do ładnych krawędzi, więc dane 2..24 dają oś
    // 0..25. Nota o uciętej osi pod rysunkiem, na którym oś WIDOCZNIE zaczyna
    // się od zera, uczy czytelnika ignorowania wszystkich not.
    const { container } = render(<ScatterChart config={cfg(baza(X_ROSNIE, Y_ROSNIE))} lang="pl" />);
    expect(container.querySelector("[data-note='axis.truncated']")).toBeNull();
  });
});

describe("ScatterChart - strefa trafienia ma PRÓG", () => {
  it("wspólna warstwa wskazuje dokładnie najbliższy punkt i uruchamia wybór", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <ScatterChart config={cfg(baza(X_ROSNIE, Y_ROSNIE))} lang="pl" onSelect={onSelect} />,
    );
    const { hit } = warstwa(container);
    const punkt = punkty(container)[3];
    fireEvent.pointerMove(hit, {
      clientX: num(punkt, "cx"),
      clientY: num(punkt, "cy"),
      pointerType: "mouse",
    });
    expect(container.querySelector(".neh-tooltip")).not.toBeNull();
    expect(dymek(container)).toContain("obs-4");
    fireEvent.pointerDown(hit, {
      clientX: num(punkt, "cx"),
      clientY: num(punkt, "cy"),
      pointerType: "mouse",
    });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0].category).toBe("obs-4");
  });

  it("dymek nad kropką podaje obie współrzędne i nazwę obserwacji", () => {
    // Z plamki na przecięciu dwóch osi nie odczyta się pary dokładniej niż
    // "mniej więcej", więc dymek jest tu jedyną drogą do liczby pod
    // wskaźnikiem. Jedna współrzędna w dymku byłaby połową odpowiedzi.
    const { container } = render(<ScatterChart config={cfg(baza(X_ROSNIE, Y_ROSNIE))} lang="pl" />);
    const { hit } = warstwa(container);
    const k = punkty(container)[3];
    fireEvent.pointerMove(hit, { clientX: num(k, "cx"), clientY: num(k, "cy") });
    const tekst = dymek(container);
    expect(tekst).toContain("Zaufanie");
    expect(tekst).toContain("PKB per capita");
    expect(tekst).toContain("obs-4");
  });

  it("nad PUSTYM miejscem płyty dymka NIE MA", () => {
    // To jest cały sens progu `HIT_RADIUS_PX`. Bez niego "najbliższy wygrywa"
    // i chmura z dwunastoma obserwacjami pokazuje dymek w każdym miejscu
    // rysunku, czyli twierdzi, że wskaźnik stoi nad obserwacją, której tam nie
    // ma. Punkt kontrolny wybieram w narożniku i najpierw dowodzę, że jest
    // dalej niż próg - inaczej test przechodziłby z przypadku.
    const { container } = render(<ScatterChart config={cfg(baza(X_ROSNIE, Y_ROSNIE))} lang="pl" />);
    const { hit, x, y } = warstwa(container);
    const cx = x + 2;
    const cy = y + 2;
    expect(najblizszaKropka(container, cx, cy)).toBeGreaterThan(HIT_RADIUS_PX);
    fireEvent.pointerMove(hit, { clientX: cx, clientY: cy });
    expect(container.querySelector(".neh-tooltip")).toBeNull();
  });

  it("dymek nad punktem zdublowanym mówi, że plamka jest dzielona", () => {
    // Dymek podaje jedną parę liczb, a pod markerem stoją dwie obserwacje -
    // bez dopisku czytelnik odczytałby wartość jednej z nich jako całą treść
    // tego miejsca rysunku.
    const { container } = render(
      <ScatterChart config={cfg(baza([...X_ROSNIE, 6], [...Y_ROSNIE, 12]))} lang="pl" />,
    );
    const { hit } = warstwa(container);
    const k = all(container, "circle[data-overplotted='true']")[0];
    fireEvent.pointerMove(hit, { clientX: num(k, "cx"), clientY: num(k, "cy") });
    expect(dymek(container)).toContain("plamka dzielona");
  });

  it("dotyk NIE gasi dymka przy opuszczeniu warstwy", () => {
    // Palec schodzi z ekranu po każdym stuknięciu, więc `pointerleave`
    // z dotyku gasiłby dymek zawsze natychmiast po jego pokazaniu - wykres
    // byłby na telefonie martwy.
    const { container } = render(<ScatterChart config={cfg(baza(X_ROSNIE, Y_ROSNIE))} lang="pl" />);
    const { hit } = warstwa(container);
    const k = punkty(container)[5];
    fireEvent.pointerDown(hit, {
      clientX: num(k, "cx"),
      clientY: num(k, "cy"),
      pointerType: "touch",
    });
    fireEvent.pointerLeave(hit, { pointerType: "touch" });
    expect(container.querySelector(".neh-tooltip")).not.toBeNull();
  });
});

describe("ScatterChart - klawiatura i dostępność", () => {
  it("strzałka wchodzi w chmurę od NAJMNIEJSZEGO x, Escape czyści", () => {
    // Kolejność wierszy arkusza nie jest tu żadnym porządkiem (punktowy
    // istnieje właśnie dlatego, że kolejność wiersza nie jest kolejnością
    // zjawiska), więc nawigacja klawiaturą czyta zależność od lewej do prawej,
    // czyli w tę stronę, w którą się ją opowiada.
    const { container } = render(<ScatterChart config={cfg(baza(X_ROSNIE, Y_ROSNIE))} lang="pl" />);
    const box = container.querySelector<HTMLElement>("[role='img']");
    if (!box) throw new Error("brak kontenera");
    const najmniejszeX = Math.min(...punkty(container).map((k) => num(k, "cx")));
    fireEvent.keyDown(box, { key: "ArrowRight" });
    const czynny = container.querySelector("circle[data-active='true']");
    if (!czynny) throw new Error("brak punktu czynnego");
    expect(num(czynny, "cx")).toBeCloseTo(najmniejszeX, 6);
    fireEvent.keyDown(box, { key: "Escape" });
    expect(container.querySelector("circle[data-active='true']")).toBeNull();
  });

  it("kolejne strzałki idą rosnąco po x, a nie po numerze wiersza", () => {
    // Arkusz wpisany w kolejności alfabetycznej albo losowej dawałby inaczej
    // skoki w tę i w tamtą stronę chmury, a czytelnik nawigujący klawiaturą
    // nie ma czym zauważyć, gdzie właśnie jest.
    const kolejnosc = [7, 3, 11, 1, 9, 5];
    const y = kolejnosc.map((v) => v * 2);
    const { container } = render(<ScatterChart config={cfg(baza(kolejnosc, y))} lang="pl" />);
    const box = container.querySelector<HTMLElement>("[role='img']");
    if (!box) throw new Error("brak kontenera");
    const odwiedzone: number[] = [];
    for (let i = 0; i < kolejnosc.length; i += 1) {
      fireEvent.keyDown(box, { key: "ArrowRight" });
      const czynny = container.querySelector("circle[data-active='true']");
      if (!czynny) throw new Error("brak punktu czynnego");
      odwiedzone.push(num(czynny, "cx"));
    }
    expect(odwiedzone).toEqual([...odwiedzone].sort((a, b) => a - b));
  });

  it("marker pod zaznaczeniem rośnie o piksel, ale NIE DRGA", () => {
    // Sekcja 6: hover zmienia stan powierzchni, nigdy kodowanie. Promień
    // markera nie koduje wartości i wolno go zmienić, ale pozycja JEST
    // wartością - punkt, który przeskakuje pod wskaźnikiem, przez chwilę
    // pokazuje pomiar, którego nie ma.
    const { container } = render(<ScatterChart config={cfg(baza(X_ROSNIE, Y_ROSNIE))} lang="pl" />);
    const box = container.querySelector<HTMLElement>("[role='img']");
    if (!box) throw new Error("brak kontenera");
    const przed = punkty(container).map((k) => ({ cx: num(k, "cx"), cy: num(k, "cy") }));
    fireEvent.keyDown(box, { key: "ArrowRight" });
    const czynny = container.querySelector("circle[data-active='true']");
    if (!czynny) throw new Error("brak punktu czynnego");
    expect(num(czynny, "r")).toBe(SCATTER_MARKER_R + 1);
    const pasujacy = przed.some(
      (p) => Math.abs(p.cx - num(czynny, "cx")) < 1e-6 && Math.abs(p.cy - num(czynny, "cy")) < 1e-6,
    );
    expect(pasujacy).toBe(true);
  });

  it("punkt czynny jest rysowany NA KOŃCU, czyli na wierzchu", () => {
    // Powiększony o piksel marker schowany pod sąsiadem narysowanym później
    // wskazywałby nie ten punkt, o którym mówi dymek - a przy chmurze gęstej
    // w jednym miejscu to jest różnica między dwiema różnymi obserwacjami.
    const { container } = render(<ScatterChart config={cfg(baza(X_ROSNIE, Y_ROSNIE))} lang="pl" />);
    const box = container.querySelector<HTMLElement>("[role='img']");
    if (!box) throw new Error("brak kontenera");
    fireEvent.keyDown(box, { key: "ArrowRight" });
    const wszystkie = punkty(container);
    expect(wszystkie[wszystkie.length - 1].getAttribute("data-active")).toBe("true");
  });

  it("nazwa dostępna niesie zakresy OBU zmiennych, n i dowód trendu", () => {
    // Czytnik ekranu nie widzi ani osi, ani podpisu pod rysunkiem, więc to
    // jedyne miejsce, w którym dostaje to samo, co widzący czytelnik odczytuje
    // z podziałek i z etykiety przy odcinku. Nazwa rodzaju wykresu nie jest
    // treścią analityczną i nie zastępuje liczb.
    const { container } = render(<ScatterChart config={cfg(baza(X_ROSNIE, Y_ROSNIE))} lang="pl" />);
    const label = container.querySelector("[role='img']")?.getAttribute("aria-label") ?? "";
    expect(label).toContain("PKB per capita");
    expect(label).toContain("Zaufanie");
    expect(label).toContain("n = 12");
    expect(label).toContain("R²");
    expect(label).toContain("Współzmienność");
  });

  it("podpowiedź klawiatury jest OPISEM, nie nazwą", () => {
    // `aria-label` mówi, co pokazuje wykres; `aria-describedby` mówi, co można
    // z nim zrobić. Wsadzenie podpowiedzi do nazwy kazałoby czytnikowi ekranu
    // czytać instrukcję obsługi za każdym razem, gdy ogłasza element.
    const { container } = render(<ScatterChart config={cfg(baza(X_ROSNIE, Y_ROSNIE))} lang="pl" />);
    const box = container.querySelector<HTMLElement>("[role='img']");
    const id = box?.getAttribute("aria-describedby");
    expect(id).toBeTruthy();
    expect(container.querySelector(`#${id}`)?.textContent).toContain("Strzałkami");
  });
});

describe("ScatterChart - alternatywa tekstowa i pary odrzucone", () => {
  /**
   * Tabela danych należy do RAMKI karty (`Chart` -> `TABLE_BY_KIND`), a nie do
   * rysunku. Do tego PR-a render niósł własną kopię w `sr-only` i te testy
   * czytały właśnie ją - a po podłączeniu rodzaju do ramki czytnik ekranu
   * dostawał te same liczby dwa razy, bez sygnału, że to ta sama tabela. Kopia
   * zniknęła, więc testy tabeli renderują `Chart`: czytają to, co naprawdę
   * dostaje czytelnik po naciśnięciu „Pokaż dane".
   */
  const zTabela = (dane: Record<string, Json>) =>
    render(<Chart config={cfg({ ...dane, kind: "scatter" })} lang="pl" />);

  /** PIERWSZA tabela ramki to pary współrzędnych; druga opisuje CHMURĘ (trend). */
  const tabelaPar = (root: HTMLElement): Element => {
    const t = all(root, "table")[0];
    if (!t) throw new Error("brak tabeli par w ramce");
    return t;
  };

  it("para bez jednej współrzędnej NIE JEST na rysunku, ale jest w tabeli", () => {
    // Punkt bez `x` nie ma gdzie stanąć, a bez `y` nie ma wysokości - obie
    // takie obserwacje znikają z rysunku i z regresji. Tabela jest JEDYNYM
    // miejscem, w którym czytelnik dowie się, że w arkuszu było coś więcej,
    // a `n` liczy mniej par, niż ma kolumna.
    const x: (number | null)[] = [...X_ROSNIE];
    const y: (number | null)[] = [...Y_ROSNIE];
    y[4] = null;
    const { container } = zTabela(baza(x, y));
    expect(punkty(container)).toHaveLength(X_ROSNIE.length - 1);
    // Wiersz odrzucony poznajemy po DOPISKU, a nie po `data-dropped`: usunięta
    // kopia znakowała go atrybutem, a tabela ramki wypisuje powód pominięcia
    // słowem w ostatniej kolumnie - czyli treścią, którą czytnik ekranu
    // przeczyta. Atrybut widział tylko test, dopisek widzi czytelnik.
    const odrzucone = [...tabelaPar(container).querySelectorAll("tbody tr")].filter((r) =>
      (r.textContent ?? "").includes("pominięta"),
    );
    expect(odrzucone).toHaveLength(1);
    expect(odrzucone[0].textContent ?? "").toContain("obs-5");
    expect(nota(container, "honesty.pairsCompleteOk")).toContain("1");
  });

  it("tabela ma nagłówki ze słownika i wiersz na każdą parę", () => {
    // Grafika nigdy nie jest jedyną drogą do liczby: dymek nie istnieje ani
    // w druku, ani na zrzucie ekranu, ani dla czytnika ekranu. Tabela liczy
    // z TEGO SAMEGO modelu co rysunek, bo dwa liczenia to dwa źródła prawdy.
    const { container } = zTabela(baza(X_ROSNIE, Y_ROSNIE));
    // Nagłówki liczymy w `thead`: tabela ramki daje etykiecie obserwacji
    // `th scope="row"` (nazwa wiersza JEST jego nagłówkiem, nie daną), więc
    // samo `th` policzyłoby też dwanaście wierszy.
    const naglowki = [...tabelaPar(container).querySelectorAll("thead th")].map(
      (e) => e.textContent ?? "",
    );
    expect(naglowki).toEqual(["Obserwacja", "Seria", "X", "Y"]);
    expect([...tabelaPar(container).querySelectorAll("tbody tr")]).toHaveLength(X_ROSNIE.length);
  });
});

describe("ScatterChart - dane z bazy", () => {
  it("brak par nie renderuje NICZEGO, nie pustego <svg>", () => {
    // Puste `<svg>` z dwiema osiami i bez ani jednego punktu wygląda jak
    // wykres, który się zepsuł. Rama karty ma na ten stan własny komunikat.
    const { container } = render(
      <ScatterChart
        config={cfg({ kind: "bar", categories: [], series: [], animate: false })}
        lang="pl"
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("NaN i Infinity nie docierają na ekran jako napisy", () => {
    // `Intl.NumberFormat.format(NaN)` zwraca literalny napis "NaN", a bramka
    // `blockMatrix.test.tsx` szuka go w `textContent` całej strony - razem
    // z "undefined" i "∞".
    const { container } = render(
      <ScatterChart
        config={cfg(
          baza(
            [1, 2, Number.NaN, 4, Number.POSITIVE_INFINITY, 6],
            [2, Number.NaN, 6, 8, 10, Number.NEGATIVE_INFINITY],
          ),
        )}
        lang="pl"
      />,
    );
    const tekst = container.textContent ?? "";
    expect(tekst).not.toContain("NaN");
    expect(tekst).not.toContain("Infinity");
    expect(tekst).not.toContain("undefined");
    expect(tekst).not.toContain("∞");
  });

  it("JEDNA para nie wywraca rysunku i nie dzieli przez zero", () => {
    // Blok z bazy bywa w trakcie wpisywania: jedna para to stan, w którym
    // rozpiętość obu domen jest zerem, czyli mianownikiem każdego
    // przeliczenia na piksele.
    const { container } = render(<ScatterChart config={cfg(baza([5], [7]))} lang="pl" />);
    expect(punkty(container)).toHaveLength(1);
    for (const k of punkty(container)) {
      expect(Number.isFinite(num(k, "cx"))).toBe(true);
      expect(Number.isFinite(num(k, "cy"))).toBe(true);
    }
    expect(container.textContent ?? "").not.toContain("NaN");
  });

  it("wszystkie pary IDENTYCZNE nie dają nie-liczby w żadnym atrybucie", () => {
    // Zerowa rozpiętość na obu osiach jednocześnie plus zerowa wariancja `x`
    // i `y` - najgorszy przypadek arytmetyczny tego rodzaju.
    const { container } = render(
      <ScatterChart config={cfg(baza([3, 3, 3, 3], [8, 8, 8, 8]))} lang="pl" />,
    );
    for (const el of all(container, "circle, line, rect, text")) {
      for (const attr of ["cx", "cy", "x", "y", "x1", "x2", "y1", "y2", "width", "height"]) {
        const raw = el.getAttribute(attr);
        if (raw === null) continue;
        expect(Number.isFinite(Number(raw)), `${attr}=${raw}`).toBe(true);
      }
    }
    expect(container.textContent ?? "").not.toContain("NaN");
  });

  it("degradacja osi X do numeru wiersza jest POWIEDZIANA, nie ukryta", () => {
    // Jedna seria i nieliczbowe etykiety znaczą, że drugiej zmiennej NIE MA -
    // na osi X stoi wtedy pozycja w szeregu. Wykres rysuje się, bo blok ma
    // pokazać dane autora, ale bez tego zdania odpowiadałby na pytanie
    // o zależność, którego te dane nie zadają.
    const { container } = render(
      <ScatterChart
        config={cfg({
          kind: "bar",
          categories: ["Polska", "Litwa", "Łotwa", "Estonia", "Finlandia"],
          series: [{ name: "Zaufanie", values: [12, 15, 9, 21, 30] }],
          animate: false,
        })}
        lang="pl"
      />,
    );
    expect(punkty(container)).toHaveLength(5);
    // Treść dla CZYTELNIKA mówi to samo bez wersalików i bez zalecenia:
    // wersja z „POZYCJA W SZEREGU" i radą, co zrobić, została w nakładce
    // edytora bloku.
    expect(nota(container, "reading.syntheticX")).toContain("pozycja w szeregu");
  });

  it("n zadeklarowane w podpisie sprzeczne z danymi jest zgłaszane jako defekt", () => {
    // "n = 300" w podpisie i czterdzieści wierszy w bloku znaczy, że wykres
    // i podpis mówią o dwóch różnych badaniach - to nie jest kwestia
    // zaokrąglenia, tylko dwóch źródeł.
    const { container } = render(
      <ScatterChart config={cfg(baza(X_ROSNIE, Y_ROSNIE, { sampleSize: 300 }))} lang="pl" />,
    );
    expect(nota(container, "honesty.declaredSampleSizeOk")).toContain("300");
    expect(nota(container, "honesty.declaredSampleSizeOk")).toContain("12");
  });
});

describe("ScatterChart - język jedzie propsem", () => {
  it("angielski dostaje angielskie zdanie o współzmienności i nagłówki", () => {
    // Strony publiczne są cache'owane na brzegu sieci, więc odczyt języka
    // z globalnego `i18n.language` mógłby zserwować polski tekst pod
    // angielskim adresem. Test pilnuje, że `lang` z propsa naprawdę decyduje.
    const { container } = render(
      <Chart config={cfg({ ...baza(X_ROSNIE, Y_ROSNIE), kind: "scatter" })} lang="en" />,
    );
    expect(nota(container, "trend.notCausal")).toContain("Covariation");
    // Nagłówki z `thead` PIERWSZEJ tabeli ramki - reszta `th` to nagłówki
    // wierszy i kolumny tabeli trendu, czyli inna treść.
    const pary = all(container, "table")[0];
    expect([...pary.querySelectorAll("thead th")].map((e) => e.textContent ?? "")).toEqual([
      "Observation",
      "Series",
      "X",
      "Y",
    ]);
  });
});

describe("ScatterChart - tabela odcinków trendu w ramce wykresu", () => {
  // Tabela trendów mieszka w `Chart.tsx` (TABLE_BY_KIND), więc te dwa testy
  // renderują `Chart`. Powód jest konkretny: nagłówki kolumn brały klucze
  // `scatter.trend.n` i `scatter.trend.r2`, które są ZDANIAMI z wstawką
  // („n = {{count}}"), a nagłówek nie ma czym wstawki wypełnić - w nagłówku
  // kolumny stała surowa klamra. Zdania zostają przy odcinku na rysunku,
  // nagłówki mają własne, krótkie klucze.
  const arkusz: Record<string, Json> = {
    kind: "scatter",
    animate: false,
    categories: X_ROSNIE.map((x) => String(x)),
    series: [{ name: "Marża", values: Y_ROSNIE }],
  };

  it("nagłówki kolumn nie mają niewypełnionej wstawki", () => {
    const { container } = render(<Chart config={parseChartConfig(arkusz)} lang="pl" />);
    const naglowki = all(container, "th").map((el) => el.textContent ?? "");
    expect(naglowki.length).toBeGreaterThan(0);
    for (const n of naglowki) {
      expect(n.includes("{{"), `nagłówek "${n}" z niewypełnioną wstawką`).toBe(false);
    }
    expect(naglowki.join("|")).toContain("R²");
  });

  it("cały wykres nie wypisuje surowej ścieżki słownika", () => {
    const { container } = render(<Chart config={parseChartConfig(arkusz)} lang="pl" />);
    const tekst = container.textContent ?? "";
    expect(/scatter\.[a-z]+\./.test(tekst)).toBe(false);
    expect(tekst.includes("{{")).toBe(false);
  });
});

describe("ScatterChart - jednostka w tabeli ramki należy do JEDNEJ osi", () => {
  // REGUŁA JEST STARSZA OD TEJ TABELI i zapisana wprost przy dymku rysunku:
  // konfiguracja ma JEDNO pole `unit` i opisuje nim wartości serii, a X
  // pochodzi z etykiet albo z innej kolumny. Tabela ramki dokleiła jednostkę
  // do OBU kolumn, więc przy `unit: " %"` wypisywała procenty przy liczbach,
  // które procentami nie są. Zła jednostka jest gorsza niż jej brak: brak
  // każe czytelnikowi sprawdzić w podpisie, zła każe mu uwierzyć.
  const arkusz: Record<string, Json> = {
    kind: "scatter",
    animate: false,
    unit: " %",
    categories: X_ROSNIE.map((x) => String(x)),
    series: [{ name: "Marża", values: Y_ROSNIE }],
  };

  it("kolumna X nie dostaje jednostki serii, kolumna Y dostaje", () => {
    const { container } = render(<Chart config={parseChartConfig(arkusz)} lang="pl" />);
    const wiersz = all(container, "table tbody tr")[0];
    const komorki = [...wiersz.querySelectorAll("td")].map((td) => td.textContent ?? "");
    // Kolejność kolumn: seria, X, Y (etykieta obserwacji jest `th`).
    const [, x, y] = komorki;
    expect(x.includes("%"), `kolumna X z cudzą jednostką: "${x}"`).toBe(false);
    expect(y.includes("%"), `kolumna Y bez jednostki serii: "${y}"`).toBe(true);
  });

  it("obserwacja bez nazwy dostaje myślnik, nie pusty nagłówek wiersza", () => {
    // Pusty `th scope="row"` to dla czytnika ekranu wiersz, którego nie da się
    // zapowiedzieć - myślnik mówi wprost, że nazwy nie ma.
    const bezNazw: Record<string, Json> = {
      ...arkusz,
      categories: X_ROSNIE.map(() => ""),
    };
    const { container } = render(<Chart config={parseChartConfig(bezNazw)} lang="pl" />);
    const naglowki = all(container, "table tbody th").map((el) => el.textContent ?? "");
    expect(naglowki.length).toBeGreaterThan(0);
    for (const n of naglowki) expect(n.trim().length).toBeGreaterThan(0);
  });
});

it("keyboard navigation respects the first and last point boundaries", () => {
  const { container } = render(<ScatterChart config={cfg(baza(X_ROSNIE, Y_ROSNIE))} lang="pl" />);
  const box = container.querySelector<HTMLElement>("[role='img']");
  if (!box) throw new Error("missing chart");
  fireEvent.keyDown(box, { key: "ArrowLeft" });
  expect(container.querySelector(".neh-tooltip")).not.toBeNull();
  fireEvent.keyDown(box, { key: "ArrowRight" });
  expect(container.querySelector(".neh-tooltip")).not.toBeNull();
  fireEvent.keyDown(box, { key: "Escape" });
  fireEvent.keyDown(box, { key: "ArrowUp" });
  expect(container.querySelector(".neh-tooltip")).not.toBeNull();
  fireEvent.keyDown(box, { key: "x" });
  expect(container.querySelector(".neh-tooltip")).not.toBeNull();
});
