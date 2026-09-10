// BOXPLOT - CO MUSI BYĆ PRAWDĄ O RYSUNKU.
//
// SKĄD BIORĘ LICZBY. `useContainerWidth` czyta `clientWidth`, które
// w happy-dom wynosi 0, więc szerokość zostaje na wartości startowej 720 -
// geometria jest w pełni deterministyczna i można asertować piksele.
// `useRevealOnScroll` nigdy nie dostaje callbacku IntersectionObservera, więc
// stan to zawsze "static", czyli dokładnie to, co widzi crawler. Szerokość
// pola rysunku (`innerW`) czytam z warstwy trafień, a nie liczę drugi raz
// w teście - marginesy zależą od pomiaru etykiet podziałki i drugie liczenie
// byłoby kopią implementacji, nie sprawdzeniem jej.
//
// CZEGO TU NIE MA. Arytmetyka rozkładu (kwartyle, ogrodzenia, końce wąsów,
// podział na obserwacje odstające, samosprawdzenia) ma własny plik testowy
// przy modelu. Tutaj sprawdzam wyłącznie to, czego model sprawdzić nie może:
// czy RYSUNEK mówi to, co model policzył. Nie ma tu też ani jednej asercji na
// treść słownika - klucze `charts.boxplot.*` dojeżdżają osobnym commitem, więc
// test na polski napis byłby czerwony nie z winy renderu.
import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import type { Json } from "@/lib/content-model/json";
import { parseChartConfig } from "@/lib/charts/parse";
import type { ChartConfig } from "@/lib/charts/types";
import { formatChartValue } from "@/lib/charts/format";
import {
  BOXPLOT_COLUMNS,
  BOX_WIDTH_RATIO,
  WHISKER_CAP_RATIO,
} from "@/lib/charts/kinds/boxplot";
import { BoxplotChart } from "../BoxplotChart";

function cfg(data: Record<string, Json>): ChartConfig {
  return parseChartConfig(data);
}

const all = (root: HTMLElement, sel: string): Element[] => [...root.querySelectorAll(sel)];
const attr = (el: Element, name: string): number => Number(el.getAttribute(name));

/** Dwanaście obserwacji bez ogona. Mediana 15,5, q1 = 12,75, q3 = 18,25. */
const CZYSTA = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
/**
 * Ta sama próba z DWOMA obserwacjami odstającymi różnego stopnia: ogrodzenie
 * 1,5 IQR wypada na 26,5, a 3 IQR na 34,75 - więc 30 jest "mild", a 80 "far".
 * Wąs kończy się na 19, czyli na OBSERWACJI, nie na ogrodzeniu.
 */
const Z_OGONEM = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 30, 80];

/** Etykiety wierszy arkusza - w tym trybie grupami są SERIE, nie kategorie. */
const WIERSZE = CZYSTA.map((_, i) => `obs-${i + 1}`);

const BAZA: Record<string, Json> = {
  kind: "bar",
  categories: WIERSZE,
  series: [
    { name: "Alfa", values: CZYSTA },
    { name: "Beta", values: Z_OGONEM },
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

describe("BoxplotChart - kolumna grupy", () => {
  it("rysuje jedno pudło na grupę, w kolejności arkusza", () => {
    // Gdyby kolumny szły w innej kolejności niż serie, czytelnik przypisałby
    // rozkład do nie tej grupy - a nic na rysunku by tego nie zdradziło, bo
    // etykieta idzie razem z kolumną.
    const { container } = render(<BoxplotChart config={cfg(BAZA)} lang="pl" />);
    const boxes = all(container, "rect[data-role='box']");
    expect(boxes).toHaveLength(2);
    expect(attr(boxes[0], "x")).toBeLessThan(attr(boxes[1], "x"));
    const labels = all(container, "text[data-role='group-label']").map((e) => e.textContent);
    expect(labels).toEqual(["Alfa", "Beta"]);
  });

  it("szerokość pudła to PROPORCJA PASMA z modelu, a nie liczba z wyczucia", () => {
    // `BOX_WIDTH_RATIO` zostawia po bokach pasma po ~19%, czyli przerwę
    // wyraźną na tyle, żeby obwódki dwóch sąsiednich pudeł nie zlały się
    // w fałszywy trzeci kształt. Render, który dobiera własną proporcję,
    // rozjeżdża się z tym uzasadnieniem po cichu.
    const szesc = {
      ...BAZA,
      series: Array.from({ length: 6 }, (_, i) => ({ name: `G${i}`, values: CZYSTA })),
    };
    const { container } = render(<BoxplotChart config={cfg(szesc)} lang="pl" />);
    const innerW = attr(hitLayer(container), "width");
    const boxes = all(container, "rect[data-role='box']");
    expect(boxes).toHaveLength(6);
    expect(attr(boxes[0], "width")).toBeCloseTo((BOX_WIDTH_RATIO * innerW) / 6, 1);
  });

  it("poprzeczka wąsa ma POŁOWĘ szerokości pudła także po przycięciu sufitem", () => {
    // Sufit szerokości dotyczy pudła, ale gdyby nie objął poprzeczki, ta -
    // liczona z pudła NIEPRZYCIĘTEGO - wyszłaby szersza od pudła i czytałaby
    // się jako druga, szersza granica odczytu, czyli jako informacja, której
    // w danych nie ma.
    const jedna = { ...BAZA, series: [{ name: "Alfa", values: CZYSTA }] };
    const { container } = render(<BoxplotChart config={cfg(jedna)} lang="pl" />);
    const innerW = attr(hitLayer(container), "width");
    const boxW = attr(all(container, "rect[data-role='box']")[0], "width");
    const cap = all(container, "line[data-role='cap'][data-end='high']")[0];
    const capW = attr(cap, "x2") - attr(cap, "x1");
    // Sufit zadziałał: jedna grupa nie rozlewa pudła na 62% pola rysunku.
    expect(boxW).toBeLessThan(BOX_WIDTH_RATIO * innerW);
    expect(capW).toBeCloseTo(boxW * WHISKER_CAP_RATIO, 6);
  });

  it("poprzeczka jest wyśrodkowana w tym samym miejscu co pudło", () => {
    // Poprzeczka przesunięta względem pudła sugerowałaby, że wąs należy do
    // sąsiedniej kolumny - przy sześciu grupach obok siebie to realny defekt
    // przypisania obserwacji do grupy.
    const { container } = render(<BoxplotChart config={cfg(BAZA)} lang="pl" />);
    const box = all(container, "rect[data-role='box']")[0];
    const cap = all(container, "line[data-role='cap'][data-end='low']")[0];
    const srodekPudla = attr(box, "x") + attr(box, "width") / 2;
    const srodekPoprzeczki = (attr(cap, "x1") + attr(cap, "x2")) / 2;
    expect(srodekPoprzeczki).toBeCloseTo(srodekPudla, 6);
  });
});

describe("BoxplotChart - mediana", () => {
  it("jest OSOBNYM elementem leżącym MIĘDZY krawędziami pudła", () => {
    // Mediana narysowana jako krawędź pudła albo jako szew dwóch wypełnień
    // zostawia czytelnikowi trzy granice poziome i pytanie, która z nich jest
    // medianą. Odczyt mediany nie może być domysłem - to jedyna liczba
    // skrzynki, która mówi o POZIOMIE.
    const { container } = render(<BoxplotChart config={cfg(BAZA)} lang="pl" />);
    const box = all(container, "rect[data-role='box']")[0];
    const median = all(container, "line[data-role='median']")[0];
    const gora = attr(box, "y");
    const dol = gora + attr(box, "height");
    expect(attr(median, "y1")).toBeGreaterThan(gora);
    expect(attr(median, "y1")).toBeLessThan(dol);
  });

  it("spina CAŁĄ szerokość pudła", () => {
    // Kreska krótsza od pudła czyta się jako znacznik przy krawędzi, a nie
    // jako podział skrzynki na dwie połowy obserwacji.
    const { container } = render(<BoxplotChart config={cfg(BAZA)} lang="pl" />);
    const box = all(container, "rect[data-role='box']")[0];
    const median = all(container, "line[data-role='median']")[0];
    expect(attr(median, "x1")).toBeCloseTo(attr(box, "x"), 6);
    expect(attr(median, "x2")).toBeCloseTo(attr(box, "x") + attr(box, "width"), 6);
  });

  it("utrzymuje na rysunku grupę o ZEROWYM IQR, której pudło ma wysokość zero", () => {
    // `<rect>` o zerowej wysokości nie jest w SVG rysowany w ogóle, nawet
    // z obwódką. Bez osobnej kreski mediany grupa o rozkładzie
    // zdegenerowanym - co jest WŁAŚCIWOŚCIĄ DANYCH, nie błędem - zniknęłaby
    // z wykresu bez śladu, a czytelnik zobaczyłby puste pasmo.
    const rowne = {
      ...BAZA,
      series: [{ name: "Płaska", values: CZYSTA.map(() => 5) }],
    };
    const { container } = render(<BoxplotChart config={cfg(rowne)} lang="pl" />);
    expect(attr(all(container, "rect[data-role='box']")[0], "height")).toBe(0);
    const median = all(container, "line[data-role='median']")[0];
    expect(median).toBeDefined();
    expect(Number.isFinite(attr(median, "y1"))).toBe(true);
    expect(attr(median, "x2") - attr(median, "x1")).toBeGreaterThan(0);
  });
});

describe("BoxplotChart - wąsy i obserwacje odstające", () => {
  it("wąs kończy się na OBSERWACJI i nie dosięga wyrzutka", () => {
    // Wąs pociągnięty do ogrodzenia albo do wyrzutka rysuje pomiar, którego
    // nikt nie zrobił, i kłamie o zasięgu rozkładu: czytelnik odczytuje
    // z końca wąsa "najdalszą typową obserwację", a dostałby próg obliczony.
    const { container } = render(<BoxplotChart config={cfg(BAZA)} lang="pl" />);
    const wasy = all(container, "line[data-role='whisker']");
    const gornyKoniec = Math.min(attr(wasy[1], "y1"), attr(wasy[1], "y2"));
    const wyrzutki = all(container, "circle[data-role='outlier']").map((c) => attr(c, "cy"));
    // Wyrzutek leży WYŻEJ (mniejsze y) niż koniec wąsa, czyli wąs się do
    // niego nie ciągnie.
    expect(Math.min(...wyrzutki)).toBeLessThan(gornyKoniec);
  });

  it("każda obserwacja odstająca jest POJEDYNCZĄ kropką, ze stopniem odstawania", () => {
    // Dwie obserwacje za wąsem zsypane w jeden znacznik pokazują jedną
    // obserwację tam, gdzie są dwie. Stopień ma znaczenie osobno: 80 leży
    // dalej niż 3 IQR, a 30 tylko za 1,5 IQR - w długim ogonie to różnica
    // między "rzadka" i "zupełnie inna liczba".
    const { container } = render(<BoxplotChart config={cfg(BAZA)} lang="pl" />);
    const wyrzutki = all(container, "circle[data-role='outlier']");
    expect(wyrzutki).toHaveLength(2);
    const stopnie = wyrzutki.map((c) => c.getAttribute("data-severity")).sort();
    expect(stopnie).toEqual(["far", "mild"]);
  });

  it("grupa bez ogona nie dostaje ani jednej kropki", () => {
    // Kropka bez obserwacji odstającej to twierdzenie, że rozkład ma ogon,
    // którego nie ma.
    const czysta = { ...BAZA, series: [{ name: "Alfa", values: CZYSTA }] };
    const { container } = render(<BoxplotChart config={cfg(czysta)} lang="pl" />);
    expect(all(container, "circle[data-role='outlier']")).toHaveLength(0);
  });

  it("próba poniżej progu kwartyli to KOLUMNA KROPEK, bez pudła", () => {
    // Skrzynka z czterech liczb udaje statystykę rzędu, której nie ma:
    // kwartyle są wtedy interpolacjami między dwiema sąsiednimi
    // obserwacjami, a pudło pokazuje odstęp między nimi przebrany za
    // rozproszenie. Model milczy o kwartylach, więc render nie ma czego
    // narysować i pokazuje każdą obserwację osobno.
    const mala = { ...BAZA, series: [{ name: "Mała", values: [3, 7, 11, 19] }] };
    const { container } = render(<BoxplotChart config={cfg(mala)} lang="pl" />);
    expect(all(container, "rect[data-role='box']")).toHaveLength(0);
    expect(all(container, "line[data-role='median']")).toHaveLength(0);
    expect(all(container, "circle[data-role='point']")).toHaveLength(4);
  });

  it("kropki o TEJ SAMEJ wartości są rozsunięte, więc widać, ile ich jest", () => {
    // Bez rozsunięcia cztery obserwacje o tej samej wartości rysują się jako
    // jedna kropka i wykres pokazuje jedną obserwację tam, gdzie są cztery.
    // Rozsunięcie idzie z modelu (`offset`), jest deterministyczne i nie
    // zależy od wartości - oś pozioma w paśmie nic nie niesie.
    const remis = { ...BAZA, series: [{ name: "Remis", values: [5, 5, 5, 5] }] };
    const { container } = render(<BoxplotChart config={cfg(remis)} lang="pl" />);
    const kropki = all(container, "circle[data-role='point']");
    expect(kropki).toHaveLength(4);
    const iksy = new Set(kropki.map((c) => attr(c, "cx")));
    expect(iksy.size).toBe(4);
    // Wszystkie na tej samej wysokości, bo mają tę samą wartość - rozsunięcie
    // jest wyłącznie poziome i nie udaje różnicy wartości.
    expect(new Set(kropki.map((c) => attr(c, "cy"))).size).toBe(1);
  });
});

describe("BoxplotChart - liczebność próby", () => {
  it("podaje `n` KAŻDEJ grupy na rysunku, nie tylko w dymku", () => {
    // Skrzynka z próby pięciu i z próby pięciuset wygląda IDENTYCZNIE
    // (sekcja 8: "Podaj n"), a dymek nie istnieje ani w druku, ani na zrzucie
    // ekranu, ani u czytelnika nawigującego klawiaturą bez wskaźnika.
    const { container } = render(<BoxplotChart config={cfg(BAZA)} lang="pl" />);
    const podpisy = all(container, "text[data-role='group-n']");
    expect(podpisy).toHaveLength(2);
    for (const p of podpisy) {
      expect(p.textContent ?? "").toContain(formatChartValue(12, "pl", ""));
    }
  });

  it("podaje `n` także dla grupy poniżej progu kwartyli", () => {
    // To jest przypadek, w którym `n` jest NAJWAŻNIEJSZE: kolumna czterech
    // kropek bez liczebności wygląda jak rozkład, a jest czterema pomiarami.
    const mala = { ...BAZA, series: [{ name: "Mała", values: [3, 7, 11, 19] }] };
    const { container } = render(<BoxplotChart config={cfg(mala)} lang="pl" />);
    expect(all(container, "text[data-role='group-n']")[0].textContent ?? "").toContain(
      formatChartValue(4, "pl", ""),
    );
  });
});

describe("BoxplotChart - strefa trafienia i dymek", () => {
  it("wskaźnik nad drugim PASMEM zaznacza drugą grupę", () => {
    // Grupa jest kategorią i nie ma szerokości, więc adres idzie z pasma
    // (`bandIndex`), a nie z kształtu pudła. Pudło o zerowym IQR ma wysokość
    // obwódki i byłoby nietrafialne, gdyby strefą trafienia był kształt.
    const { container } = render(<BoxplotChart config={cfg(BAZA)} lang="pl" />);
    const hit = hitLayer(container);
    fireEvent.pointerMove(hit, { clientX: attr(hit, "width") * 0.75, clientY: 100 });
    const boxes = all(container, "rect[data-role='box']");
    expect(boxes[0].getAttribute("data-active")).toBeNull();
    expect(boxes[1].getAttribute("data-active")).toBe("true");
  });

  it("podświetla CAŁE pasmo pod wskaźnikiem, nie sam kształt", () => {
    // Podświetlenie jest afordancją strefy trafienia: czytelnik ma widzieć,
    // gdzie kończy się obszar, który odpowiada na ruch wskaźnika.
    const { container } = render(<BoxplotChart config={cfg(BAZA)} lang="pl" />);
    const hit = hitLayer(container);
    fireEvent.pointerMove(hit, { clientX: attr(hit, "width") * 0.25, clientY: 100 });
    const pasmo = container.querySelector("rect[data-role='band'][data-active='true']");
    expect(pasmo).not.toBeNull();
    if (!pasmo) throw new Error("brak podświetlenia pasma");
    // Pasmo jest szersze od pudła - inaczej podświetlenie kłamałoby o tym,
    // skąd wykres przyjmuje wskazanie.
    expect(attr(pasmo, "width")).toBeGreaterThan(
      attr(all(container, "rect[data-role='box']")[0], "width"),
    );
  });

  it("dymek podaje PIĘĆ LICZB rozkładu, a nie jedną wartość", () => {
    // Cała racja bytu tego rodzaju: "średnia bez rozproszenia" jest tym,
    // czego zabrania tabela doboru formy. Dymek z jedną liczbą sprowadzałby
    // skrzynkę do średniej.
    const { container } = render(<BoxplotChart config={cfg(BAZA)} lang="pl" />);
    const hit = hitLayer(container);
    fireEvent.pointerMove(hit, { clientX: attr(hit, "width") * 0.25, clientY: 100 });
    const wiersze = all(container, ".neh-tooltip dl > div");
    // mediana, kwartyle, wąsy, n - grupa bez ogona nie ma wiersza ogona.
    expect(wiersze).toHaveLength(4);
    const tekst = container.querySelector(".neh-tooltip")?.textContent ?? "";
    expect(tekst).toContain("Alfa");
    expect(tekst).toContain(formatChartValue(15.5, "pl", ""));
    expect(tekst).toContain(formatChartValue(12.75, "pl", ""));
  });

  it("wiersz ogona pojawia się TYLKO w grupie, która ma ogon", () => {
    // "0 obserwacji odstających" jest wierszem bez informacji, który rozsadza
    // dymek i uczy go nie czytać.
    const { container } = render(<BoxplotChart config={cfg(BAZA)} lang="pl" />);
    const hit = hitLayer(container);
    fireEvent.pointerMove(hit, { clientX: attr(hit, "width") * 0.75, clientY: 100 });
    expect(all(container, ".neh-tooltip dl > div")).toHaveLength(5);
  });

  it("dotyk NIE gasi dymka przy opuszczeniu warstwy", () => {
    // Palec schodzi z ekranu po każdym stuknięciu, więc `pointerleave`
    // z dotyku gasiłby dymek zawsze natychmiast po jego pokazaniu, czyli
    // wykres byłby na telefonie martwy.
    const { container } = render(<BoxplotChart config={cfg(BAZA)} lang="pl" />);
    const hit = hitLayer(container);
    fireEvent.pointerDown(hit, {
      clientX: attr(hit, "width") * 0.25,
      clientY: 100,
      pointerType: "touch",
    });
    fireEvent.pointerLeave(hit, { pointerType: "touch" });
    expect(container.querySelector(".neh-tooltip")).not.toBeNull();
  });

  it("wskaźnik myszy schodzący z pola gasi dymek", () => {
    // Lustro poprzedniego przypadku: przy myszy stan zdejmuje `pointerleave`,
    // bo inaczej dymek zostawałby nad wykresem, z którego kursor już zszedł.
    const { container } = render(<BoxplotChart config={cfg(BAZA)} lang="pl" />);
    const hit = hitLayer(container);
    fireEvent.pointerMove(hit, { clientX: attr(hit, "width") * 0.25, clientY: 100 });
    fireEvent.pointerLeave(hit, { pointerType: "mouse" });
    expect(container.querySelector(".neh-tooltip")).toBeNull();
  });
});

describe("BoxplotChart - klawiatura i dostępność", () => {
  it("strzałki przesuwają aktywną grupę, Escape czyści", () => {
    // Nawigacja klawiaturą jest jedynym sposobem odczytania liczb bez
    // wskaźnika - bez niej połowa precyzji wykresu jest niedostępna.
    const { container } = render(<BoxplotChart config={cfg(BAZA)} lang="pl" />);
    const box = container.querySelector<HTMLElement>("[role='img']");
    if (!box) throw new Error("brak kontenera");
    fireEvent.keyDown(box, { key: "ArrowRight" });
    expect(all(container, "rect[data-role='box'][data-active='true']")).toHaveLength(1);
    fireEvent.keyDown(box, { key: "ArrowRight" });
    expect(all(container, "rect[data-role='box']")[1].getAttribute("data-active")).toBe("true");
    fireEvent.keyDown(box, { key: "Escape" });
    expect(all(container, "rect[data-role='box'][data-active='true']")).toHaveLength(0);
  });

  it("utrata focusu czyści zaznaczenie", () => {
    // Zaznaczenie zostawione po zejściu focusu wisi nad wykresem, na którym
    // czytelnik już nie stoi, i przy następnym Tabie wygląda jak stan aktywny.
    const { container } = render(<BoxplotChart config={cfg(BAZA)} lang="pl" />);
    const box = container.querySelector<HTMLElement>("[role='img']");
    if (!box) throw new Error("brak kontenera");
    fireEvent.keyDown(box, { key: "ArrowRight" });
    fireEvent.blur(box);
    expect(all(container, "rect[data-role='box'][data-active='true']")).toHaveLength(0);
  });

  it("nazwa dostępna niesie MEDIANĘ i `n` każdej grupy, nie nazwę rodzaju", () => {
    // Czytnik ekranu nie widzi ani osi, ani etykiet pod kolumnami, więc
    // "wykres skrzynkowy" nie mówi mu niczego o danych. Liczby muszą być
    // w nazwie dostępnej.
    const { container } = render(<BoxplotChart config={cfg(BAZA)} lang="pl" />);
    const label =
      container.querySelector<HTMLElement>("[role='img']")?.getAttribute("aria-label") ?? "";
    expect(label).toContain(formatChartValue(15.5, "pl", ""));
    expect(label).toContain(formatChartValue(12, "pl", ""));
    expect(label).toContain("Alfa");
    expect(label).toContain("Beta");
    expect(label).not.toContain("NaN");
  });

  it("podpowiedź klawiatury jest OPISEM, nie nazwą", () => {
    // `aria-label` niesie treść analityczną, a instrukcja obsługi idzie
    // osobno przez `aria-describedby` - inaczej czytnik czytałby instrukcję
    // przed liczbami przy każdym wejściu na wykres.
    const { container } = render(<BoxplotChart config={cfg(BAZA)} lang="pl" />);
    const id = container.querySelector<HTMLElement>("[role='img']")?.getAttribute("aria-describedby");
    expect(id).toBeTruthy();
    expect((container.querySelector(`#${id}`)?.textContent ?? "").length).toBeGreaterThan(0);
  });
});

describe("BoxplotChart - alternatywa tekstowa", () => {
  it("ma kolumnę na każdą pozycję modelu i wiersz na każdą grupę", () => {
    // Grafika nigdy nie jest jedyną drogą do liczby (sekcja 8). Kolejność
    // kolumn jest kolejnością odczytu skrzynki od dołu do góry, więc wiersz
    // tabeli da się przełożyć na rysunek bez szukania.
    const { container } = render(<BoxplotChart config={cfg(BAZA)} lang="pl" />);
    expect(all(container, "table th")).toHaveLength(BOXPLOT_COLUMNS.length);
    const wiersze = all(container, "table tbody tr");
    expect(wiersze).toHaveLength(2);
    const komorki = [...wiersze[0].querySelectorAll("td")].map((td) => td.textContent);
    expect(komorki[0]).toBe("Alfa");
    expect(komorki).toContain(formatChartValue(15.5, "pl", ""));
  });

  it("wypisuje WARTOŚCI obserwacji odstających, a nie samą ich liczbę", () => {
    // Liczba wyrzutków mówi, ile ich jest; tabela ma powiedzieć, JAKIE są -
    // bez tego "dwie obserwacje odstające" jest informacją, której nie da się
    // sprawdzić ani powtórzyć.
    const { container } = render(<BoxplotChart config={cfg(BAZA)} lang="pl" />);
    const ogon = [...all(container, "table tbody tr")[1].querySelectorAll("td")]
      .map((td) => td.textContent ?? "")
      .join("|");
    expect(ogon).toContain(formatChartValue(30, "pl", ""));
    expect(ogon).toContain(formatChartValue(80, "pl", ""));
  });

  it("kolumny kwartyli MILCZĄ przy próbie poniżej progu", () => {
    // Alternatywa tekstowa nie może być bardziej stanowcza od rysunku: skoro
    // pudła nie ma, tabela nie podaje kwartyli.
    const mala = { ...BAZA, series: [{ name: "Mała", values: [3, 7, 11, 19] }] };
    const { container } = render(<BoxplotChart config={cfg(mala)} lang="pl" />);
    const komorki = [...all(container, "table tbody tr")[0].querySelectorAll("td")].map(
      (td) => td.textContent,
    );
    // Kolumny min i max zostają (skrajne obserwacje są uczciwe przy każdym n),
    // kwartyle i wąsy są puste.
    const kwartyle = BOXPLOT_COLUMNS.map((k, i) => [k, komorki[i]] as const).filter(([k]) =>
      ["q1", "median", "q3", "iqr", "whiskerLow", "whiskerHigh"].includes(k),
    );
    for (const [, wartosc] of kwartyle) expect(wartosc).toBe("-");
  });
});

describe("BoxplotChart - porada formy i uczciwość danych", () => {
  it("jedna grupa dostaje wskazanie lepszej formy", () => {
    // Skrzynka jest formą PORZĄDKUJĄCĄ porównanie rozkładów między grupami;
    // dla jednej próby histogram mówi więcej tym samym miejscem, bo pokazuje
    // kształt, a nie pięć liczb.
    const jedna = { ...BAZA, series: [{ name: "Alfa", values: CZYSTA }] };
    const { container } = render(<BoxplotChart config={cfg(jedna)} lang="pl" />);
    expect(container.querySelector("[data-note='advice.singleGroup']")).not.toBeNull();
  });

  it("dwie pełne grupy nie dostają żadnej porady", () => {
    // Ostrzeżenie, które widać zawsze, uczy ignorowania wszystkich ostrzeżeń.
    const { container } = render(<BoxplotChart config={cfg(BAZA)} lang="pl" />);
    expect(all(container, "[data-note]")).toHaveLength(0);
  });

  it("jedna wartość zajmująca połowę próby jest NAZWANA", () => {
    // Rozkład, w którym jedna wartość zajmuje połowę próby, jest atomem
    // z ogonem, a nie rozkładem ciągłym - skrzynka pokazuje z niego wyłącznie
    // ogon i nie ma sposobu, żeby czytelnik to zobaczył z samego rysunku.
    const atom = {
      ...BAZA,
      series: [{ name: "Atom", values: [5, 5, 5, 5, 5, 5, 5, 6, 7, 8, 9, 40] }],
    };
    const { container } = render(<BoxplotChart config={cfg(atom)} lang="pl" />);
    expect(container.querySelector("[data-note='advice.tiesDominant']")).not.toBeNull();
  });

  it("zadeklarowane `n` niezgodne z arkuszem jest widoczne pod rysunkiem", () => {
    // Realny defekt: podpis mówi "n = 300", bo tyle ankiet zebrano, a arkusz
    // ma dwanaście wierszy, bo ktoś wkleił próbkę. Wtedy wykres i podpis mówią
    // o dwóch różnych badaniach.
    const { container } = render(
      <BoxplotChart config={cfg({ ...BAZA, sampleSize: 300 })} lang="pl" />,
    );
    expect(container.querySelector("[data-note='honesty.declaredSampleSizeOk']")).not.toBeNull();
  });

  it("zadeklarowane `n` zgodne z arkuszem nie generuje ostrzeżenia", () => {
    const { container } = render(
      <BoxplotChart config={cfg({ ...BAZA, sampleSize: 12 })} lang="pl" />,
    );
    expect(container.querySelector("[data-note='honesty.declaredSampleSizeOk']")).toBeNull();
  });
});

describe("BoxplotChart - dane z bazy", () => {
  it("brak grup nie renderuje NICZEGO, nie pustego <svg>", () => {
    const { container } = render(
      <BoxplotChart config={cfg({ ...BAZA, series: [], categories: [] })} lang="pl" />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("seria z samych luk zostaje PUSTĄ kolumną, a nie znika", () => {
    // Odrzucenie takiej serii przesunęłoby pasma pozostałych grup, czyli
    // zmieniłoby pozycje i kolory kolumn w trakcie wpisywania danych.
    const zLuka = {
      ...BAZA,
      series: [{ name: "Alfa", values: CZYSTA }, { name: "Pusta", values: [] }],
    };
    const { container } = render(<BoxplotChart config={cfg(zLuka)} lang="pl" />);
    expect(all(container, "text[data-role='group-label']").map((e) => e.textContent)).toEqual([
      "Alfa",
      "Pusta",
    ]);
    // Pusta grupa nie ma czego narysować, więc pudło jest jedno.
    expect(all(container, "rect[data-role='box']")).toHaveLength(1);
    expect(container.textContent ?? "").not.toContain("NaN");
  });

  it("NaN i Infinity nie docierają na ekran jako napisy", () => {
    // `Intl.NumberFormat.format(NaN)` zwraca literalny napis "NaN", a bramka
    // `blockMatrix.test.tsx` szuka go w `textContent` całej strony.
    const { container } = render(
      <BoxplotChart
        config={cfg({
          ...BAZA,
          series: [
            {
              name: "Zepsute",
              values: [1, 2, Number.NaN, 4, 5, Number.POSITIVE_INFINITY, 7, 8, 9, 10, 11, 12],
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
      <BoxplotChart
        config={cfg({ ...BAZA, categories: ["a"], series: [{ name: "x", values: [42] }] })}
        lang="pl"
      />,
    );
    expect(container.textContent ?? "").not.toContain("NaN");
    for (const el of all(container, "circle, rect, line")) {
      for (const name of ["x", "y", "cx", "cy", "x1", "x2", "y1", "y2", "width", "height", "r"]) {
        const raw = el.getAttribute(name);
        if (raw === null) continue;
        expect(Number.isFinite(Number(raw)), `${name}="${raw}"`).toBe(true);
      }
    }
  });

  it("wartości ujemne i skrajne nie dzielą przez zero", () => {
    const { container } = render(
      <BoxplotChart
        config={cfg({
          ...BAZA,
          series: [{ name: "x", values: [-1e6, -50, -1, 0, 1, 2, 3, 4, 5, 6, 7, 1e6] }],
        })}
        lang="pl"
      />,
    );
    expect(container.textContent ?? "").not.toContain("NaN");
    const box = all(container, "rect[data-role='box']")[0];
    expect(Number.isFinite(attr(box, "y"))).toBe(true);
    expect(attr(box, "height")).toBeGreaterThanOrEqual(0);
  });

  it("w kodzie rysującym nie ma ani jednego hexa i nie ma viewBox", () => {
    // Hex w silniku znaczy, że tryb ciemny i druk są już zepsute. Brak
    // `viewBox` znaczy, że jedna jednostka użytkownika to jeden piksel CSS,
    // czyli że próg odległości w `plot.ts` mierzy piksele ekranu.
    const { container } = render(<BoxplotChart config={cfg(BAZA)} lang="pl" />);
    expect(container.innerHTML).not.toMatch(/(fill|stroke)="#/);
    expect(container.querySelector("svg")?.getAttribute("viewBox")).toBeNull();
  });
});
