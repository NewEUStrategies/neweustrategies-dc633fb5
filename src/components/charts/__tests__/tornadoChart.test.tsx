// TORNADO - CO MUSI BYĆ PRAWDĄ O RYSUNKU.
//
// SKĄD BIORĘ LICZBY. `useContainerWidth` czyta `clientWidth`, które
// w happy-dom wynosi 0, więc szerokość zostaje na wartości startowej 720 -
// geometria jest w pełni deterministyczna i można asertować piksele.
// `useRevealOnScroll` nigdy nie dostaje callbacku IntersectionObservera, więc
// stan to zawsze "static", czyli dokładnie to, co widzi crawler. Wysokość pola
// rysunku (`innerH`) i pozycję linii bazowej czytam z DOM-u, a nie liczę
// drugi raz w teście - marginesy zależą od pomiaru etykiet i drugie liczenie
// byłoby kopią implementacji, nie sprawdzeniem jej.
//
// CZEGO TU NIE MA. Kolejność wierszy, rozpiętości, udziały, asymetria,
// wykrycie odwróconej pary i rozstrzygnięcie bazy mają własny plik testowy
// przy modelu. Tutaj sprawdzam wyłącznie to, czego model sprawdzić nie może:
// czy RYSUNEK mówi to, co model policzył - i czy mówi to pozycją, a nie samym
// kolorem.
import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import type { Json } from "@/lib/content-model/json";
import { parseChartConfig } from "@/lib/charts/parse";
import type { ChartConfig } from "@/lib/charts/types";
import { formatChartValue } from "@/lib/charts/format";
import { BAR_EDGE_INSET, BAR_MAX } from "@/lib/charts/geometry";
import { TORNADO_COLUMNS } from "@/lib/charts/kinds/tornado";
import { TornadoChart } from "../TornadoChart";

function cfg(data: Record<string, Json>): ChartConfig {
  return parseChartConfig({ kind: "bar", animate: false, ...data });
}

const all = (root: HTMLElement, sel: string): Element[] => [...root.querySelectorAll(sel)];
const attr = (el: Element, name: string): number => Number(el.getAttribute(name));

/**
 * Arkusz w kolejności NIEPOSORTOWANEJ: rozpiętości to 2, 40 i 13, więc
 * kolejność rysowania musi być inna niż kolejność kategorii. Baza jedzie
 * trzecią serią o nazwie bazowej - dzisiaj to jedyna droga, którą autor wpisu
 * może podać przypadek bazowy bez zmiany schematu bloku.
 */
const ARKUSZ: Record<string, Json> = {
  categories: ["Wolumen", "Kurs EUR", "Cena energii"],
  series: [
    { name: "Dolny koniec", values: [99, 90, 95] },
    { name: "Górny koniec", values: [101, 130, 108] },
    { name: "Baza", values: [100, 100, 100] },
  ],
};

/** Ten sam arkusz bez serii bazowej - model milczy wtedy o geometrii. */
const BEZ_BAZY: Record<string, Json> = {
  categories: ARKUSZ.categories,
  series: [
    { name: "Dolny koniec", values: [99, 90, 95] },
    { name: "Górny koniec", values: [101, 130, 108] },
  ],
};

/** Dwa parametry z bazą 100, pierwszy o zadanej parze. */
function para(label: string, low: number, high: number): Record<string, Json> {
  return {
    categories: [label, "Drugi"],
    series: [
      { name: "Dolny koniec", values: [low, 80] },
      { name: "Górny koniec", values: [high, 130] },
      { name: "Baza", values: [100, 100] },
    ],
  };
}

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

/** Warstwa trafień razem z podmienionym prostokątem - wzorzec ze skrzynki. */
function hitLayer(container: HTMLElement): Element {
  const hit = container.querySelector("rect.neh-hit[data-role='hits']");
  if (!hit) throw new Error("brak warstwy trafień");
  stubPlotRect(hit, attr(hit, "width"), attr(hit, "height"));
  return hit;
}

/**
 * Pozycja linii bazowej - krawędzi odniesienia, wobec której mierzy się każde
 * odchylenie. Czytana z DOM-u, a nie liczona w teście: lewy margines zależy od
 * pomiaru etykiet, więc drugie liczenie byłoby kopią implementacji.
 */
function bazaLinii(container: HTMLElement): number {
  const linia = container.querySelector("line[data-role='base-line']");
  if (!linia) throw new Error("brak linii bazowej");
  return attr(linia, "x1");
}

/**
 * Geometria nogi ODCZYTANA Z KSZTAŁTU, bo kształt jest tym, co widzi
 * czytelnik: krawędź przy bazie, długość odchylenia i koniec danych. Ścieżka,
 * a nie `<rect>`, bo `rx` zaokrągla wszystkie cztery narożniki, a podstawa
 * słupka musi zostać kwadratowa - dlatego test rozbiera `d`, zamiast czytać
 * atrybuty prostokąta, których ten kształt nie ma.
 */
function noga(el: Element): { baseX: number; length: number; endX: number } {
  const d = el.getAttribute("d") ?? "";
  const n = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const ujemna = el.getAttribute("data-direction") === "below";
  // Wariant bez zaokrąglenia (promień przycięty do zera przy krótkiej nodze):
  // M x y h w v h h -w Z.
  if (n.length <= 5) {
    const [x, , w] = n;
    return ujemna ? { baseX: x + w, length: w, endX: x } : { baseX: x, length: w, endX: x + w };
  }
  if (ujemna) {
    // M (x+w) y v h h -(w-r) q -r 0 -r -r ...
    const length = -(n[3] + n[4]);
    return { baseX: n[0], length, endX: n[0] - length };
  }
  // M x y h (w-r) q r 0 r r ...
  const length = n[2] + n[3];
  return { baseX: n[0], length, endX: n[0] + length };
}

describe("TornadoChart - kolejność rankingu", () => {
  it("rysuje wiersze MALEJĄCO po rozpiętości, nie w kolejności arkusza", () => {
    // To jest cała treść tej formy: czytelnik odczytuje hierarchię
    // wrażliwości z góry na dół. Kolejność arkuszowa likwiduje kształt leja,
    // a z nim jedyny powód, dla którego ten rodzaj istnieje - i nic na
    // rysunku by tego nie zdradziło, bo etykieta idzie razem z wierszem.
    const { container } = render(<TornadoChart config={cfg(ARKUSZ)} lang="pl" />);
    const etykiety = all(container, "text[data-role='param-label']").map((e) => e.textContent);
    expect(etykiety).toEqual(["Kurs EUR", "Cena energii", "Wolumen"]);
    // Numer arkuszowy jedzie obok pozycji w rankingu, więc widać, że wiersze
    // FAKTYCZNIE zostały przestawione, a nie że arkusz był już posortowany.
    const wiersze = all(container, "g[data-role='row']");
    expect(wiersze.map((g) => g.getAttribute("data-index"))).toEqual(["1", "2", "0"]);
    expect(wiersze.map((g) => g.getAttribute("data-rank"))).toEqual(["0", "1", "2"]);
  });

  it("najszerszy wiersz stoi u góry, więc sylwetka jest lejem", () => {
    // Ranking odczytuje się z sylwetki, nie z liczb: gdyby dłuższy pasek
    // wypadł niżej, wykres pokazywałby kolejność inną niż ta, po której sam
    // posortował wiersze.
    const { container } = render(<TornadoChart config={cfg(ARKUSZ)} lang="pl" />);
    const dlugosci = all(container, "g[data-role='row']").map((g) =>
      [...g.querySelectorAll("path[data-role='leg']")].reduce((acc, p) => acc + noga(p).length, 0),
    );
    expect(dlugosci[0]).toBeGreaterThan(dlugosci[1]);
    expect(dlugosci[1]).toBeGreaterThan(dlugosci[2]);
  });

  it("pasek nie jest grubszy od sufitu `BAR_MAX`, choć pasmo bywa czterokrotnie szersze", () => {
    // Przy trzech parametrach pasmo ma ponad 80 px, a udział z modelu dałby
    // pasek grubszy niż wysoki na własną długość - wtedy oko zaczyna czytać
    // grubość, jakby coś niosła, a nie niesie NICZEGO.
    const { container } = render(<TornadoChart config={cfg(ARKUSZ)} lang="pl" />);
    const g = container.querySelector("g[data-role='row']");
    if (!g) throw new Error("brak wiersza");
    const paski = [...g.querySelectorAll("path[data-role='leg']")];
    // Grubość czytam z drugiej współrzędnej pionowej ścieżki: dla nogi
    // dodatniej jest to `v(h - 2*inset)` po dwóch łukach promienia.
    const d = paski[0].getAttribute("d") ?? "";
    const n = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    const grubosc = n[7] + 2 * n[3] + 2 * BAR_EDGE_INSET;
    expect(grubosc).toBeLessThanOrEqual(BAR_MAX + 0.01);
  });
});

describe("TornadoChart - linia bazowa", () => {
  it("rysuje pionową linię bazy przez CAŁĄ wysokość pola i wypisuje jej wartość", () => {
    // Bez liczby linia mówi tylko "tu jest baza", a czytelnik musi wiedzieć,
    // od jakiego wyniku liczą się wszystkie odchylenia - inaczej długości są
    // bez punktu odniesienia, czyli bez znaczenia.
    const { container } = render(<TornadoChart config={cfg(ARKUSZ)} lang="pl" />);
    const hit = hitLayer(container);
    const linia = container.querySelector("line[data-role='base-line']");
    if (!linia) throw new Error("brak linii bazowej");
    expect(attr(linia, "y1")).toBeCloseTo(attr(hit, "y"), 6);
    expect(attr(linia, "y2")).toBeCloseTo(attr(hit, "y") + attr(hit, "height"), 6);
    const podpis = container.querySelector("text[data-role='base-label']")?.textContent ?? "";
    expect(podpis).toContain("Wynik bazowy");
    expect(podpis).toContain(formatChartValue(100, "pl", ""));
  });

  it("każda noga wychodzi Z LINII BAZOWEJ, a nie z krawędzi pola", () => {
    // Noga liczona od krawędzi osi kodowałaby POZIOM wyniku przebrany za
    // wrażliwość: dwa parametry o tej samej rozpiętości, ale innym poziomie,
    // dostałyby paski różnej długości.
    const { container } = render(<TornadoChart config={cfg(ARKUSZ)} lang="pl" />);
    const bazaX = bazaLinii(container);
    const nogi = all(container, "path[data-role='leg']");
    expect(nogi.length).toBeGreaterThan(0);
    for (const el of nogi) {
      // Kształt jest wsunięty o połowę grubości obwódki, żeby obwódka nie
      // zjadała długości - dlatego tolerancja to dokładnie to wsunięcie.
      expect(Math.abs(noga(el).baseX - bazaX)).toBeLessThanOrEqual(BAR_EDGE_INSET + 0.01);
    }
  });

  it("bez wyniku bazowego NIE MA ani jednego paska, a liczby zostają w tabeli", () => {
    // Model milczy o geometrii, bo słupek bez linii bazowej nie ma od czego
    // się odchylać, a baza wyliczona ze średniej nóg nie jest przypadkiem
    // bazowym. Rysunek nie może wtedy udawać kompletnego.
    const { container } = render(<TornadoChart config={cfg(BEZ_BAZY)} lang="pl" />);
    expect(all(container, "path[data-role='leg']")).toHaveLength(0);
    expect(container.querySelector("line[data-role='base-line']")).toBeNull();
    // Etykiety wierszy i liczby zostają: brak bazy nie jest brakiem danych.
    expect(all(container, "text[data-role='param-label']")).toHaveLength(3);
    const tabela = container.textContent ?? "";
    expect(tabela).toContain(formatChartValue(130, "pl", ""));
    // OBSERWACJA, nie zalecenie: czytelnik widzi etykiety parametrów nad
    // pustym polem i musi wiedzieć, że to brak bazy, a nie awaria. Zalecenie
    // („podaj wartość bazową") jest w nakładce edytora.
    expect(container.querySelector("[data-note='reading.noBase']")).not.toBeNull();
  });
});

describe("TornadoChart - znak, pozycja i asymetria", () => {
  it("znak koduje POZYCJĄ wzgledem bazy I kolorem jednocześnie", () => {
    // Około 8% mężczyzn nie odróżnia czerwieni od zieleni i dla nich wykres
    // kodowany samym kolorem jest pusty. Noga nad bazą musi więc leżeć po
    // prawej, a pod bazą po lewej - kolor jest drugim nośnikiem, nie
    // pierwszym.
    const { container } = render(<TornadoChart config={cfg(ARKUSZ)} lang="pl" />);
    const bazaX = bazaLinii(container);
    const nad = container.querySelector("path[data-role='leg'][data-direction='above']");
    const pod = container.querySelector("path[data-role='leg'][data-direction='below']");
    if (!nad || !pod) throw new Error("brak nóg po obu stronach bazy");
    expect(noga(nad).endX).toBeGreaterThan(bazaX);
    expect(noga(pod).endX).toBeLessThan(bazaX);
    expect(nad.getAttribute("fill")).toContain("--chart-positive");
    expect(pod.getAttribute("fill")).toContain("--chart-negative");
  });

  it("asymetrii NIE wysrodkowuje: +2 w górę i -8 w dół wygląda jak +2 i -8", () => {
    // Asymetria jest WŁAŚCIWOŚCIĄ wrażliwości ("wynik może spaść o 8,
    // a urosnąć o 2"), więc obie nogi mierzą się od bazy osobno. Paski
    // wyśrodkowane wokół bazy pokazywałyby rozkład symetryczny, którego
    // w danych nie ma.
    const { container } = render(
      <TornadoChart config={cfg(para("Asymetryczny", 92, 102))} lang="pl" />,
    );
    const wiersz = container.querySelector("g[data-role='row'][data-index='0']");
    if (!wiersz) throw new Error("brak wiersza asymetrycznego");
    const wDol = wiersz.querySelector("path[data-direction='below']");
    const wGore = wiersz.querySelector("path[data-direction='above']");
    if (!wDol || !wGore) throw new Error("brak obu nóg");
    // Osiem jednostek wobec dwóch: stosunek długości musi wynosić cztery,
    // z dokładnością do wsunięcia obwódki po obu końcach.
    const dol = noga(wDol).length + 2 * BAR_EDGE_INSET;
    const gora = noga(wGore).length + 2 * BAR_EDGE_INSET;
    expect(dol / gora).toBeCloseTo(4, 1);
  });

  it("para jednostronna: bliższy koniec jest KRESKĄ w poprzek paska, nie drugim paskiem", () => {
    // Dwie nogi z tej samej strony bazy nakładałyby się i dawały na styku
    // fałszywą trzecią krawędź, a wymaganie sekcji 1 mówi: nic się nie
    // nakłada. Bliższy koniec zostaje więc granicą odczytu wewnątrz paska,
    // a paskiem jest ta noga, która wyznacza rozpiętość widoczną.
    const { container } = render(
      <TornadoChart config={cfg(para("Jednostronny", 105, 109))} lang="pl" />,
    );
    const bazaX = bazaLinii(container);
    const wiersz = container.querySelector("g[data-role='row'][data-index='0']");
    if (!wiersz) throw new Error("brak wiersza jednostronnego");
    const paski = [...wiersz.querySelectorAll("path[data-role='leg']")];
    expect(paski).toHaveLength(1);
    expect(paski[0].getAttribute("data-side")).toBe("high");
    const kreska = wiersz.querySelector("line[data-role='near-end']");
    if (!kreska) throw new Error("brak kreski bliższego końca");
    expect(kreska.getAttribute("data-side")).toBe("low");
    // Kreska stoi MIĘDZY bazą a końcem danych, bo taki jest bliższy koniec.
    expect(attr(kreska, "x1")).toBeGreaterThan(bazaX);
    expect(attr(kreska, "x1")).toBeLessThan(noga(paski[0]).endX);
    // Liczba bliższego końca nie ginie: jest w tytule kreski i w tabeli.
    expect(kreska.querySelector("title")?.textContent ?? "").toContain(
      formatChartValue(105, "pl", ""),
    );
  });

  it("parametr odwrotny jest NAZWANY przy etykiecie i pod rysunkiem", () => {
    // Para, w której wartość dolna daje wynik wyższy od górnej, to defekt
    // danych i zarazem najciekawsza informacja analizy. Ciche posortowanie
    // pary zabrałoby czytelnikowi jedno i drugie.
    const { container } = render(
      <TornadoChart config={cfg(para("Odwrotny", 130, 90))} lang="pl" />,
    );
    const wiersz = container.querySelector("g[data-role='row'][data-index='0']");
    expect(wiersz?.getAttribute("data-inverted")).toBe("true");
    const znacznik = container.querySelector("text[data-role='inverted-mark']");
    expect(znacznik).not.toBeNull();
    expect(znacznik?.querySelector("title")?.textContent ?? "").toContain("parametr odwrotny");
    const przypis = container.querySelector("[data-note='honesty.pairsOrdered']");
    expect(przypis?.textContent ?? "").toContain("Odwrotny");
    // Kierunek wpływu zostaje widoczny: noga DOLNA leży nad bazą.
    expect(wiersz?.querySelector("path[data-side='low']")?.getAttribute("data-direction")).toBe(
      "above",
    );
  });

  it("wiersz o zerowej rozpiętości zostaje w rankingu, choć nie ma czego narysować", () => {
    // Parametr, który nie rusza wynikiem, zajmuje miejsce w rankingu
    // i wygląda na pomiar. Usunięcie go byłoby obcięciem rankingu bez
    // powiedzenia o tym, a pasek o zerowej długości - odchyleniem, którego
    // nie ma. Zostaje więc etykieta i przypis.
    const { container } = render(<TornadoChart config={cfg(para("Płaski", 100, 100))} lang="pl" />);
    const wiersz = container.querySelector("g[data-role='row'][data-index='0']");
    expect(wiersz?.getAttribute("data-zero-span")).toBe("true");
    expect(wiersz?.querySelectorAll("path[data-role='leg']")).toHaveLength(0);
    expect(all(container, "text[data-role='param-label']").map((e) => e.textContent)).toContain(
      "Płaski",
    );
    expect(
      container.querySelector("[data-note='honesty.allSpansContribute']")?.textContent ?? "",
    ).toContain("Płaski");
  });
});

describe("TornadoChart - strefa trafienia i dymek", () => {
  it("wskaźnik nad drugim PASMEM od góry zaznacza drugi wiersz rankingu", () => {
    // Kształt strefą trafienia być nie może: noga o odchyleniu bliskim zeru
    // ma szerokość obwódki, a wiersz o rozpiętości zerowej nie ma kształtu
    // w ogóle - oba muszą pozostać trafialne, bo oba mają liczby.
    const { container } = render(<TornadoChart config={cfg(ARKUSZ)} lang="pl" />);
    const hit = hitLayer(container);
    fireEvent.pointerMove(hit, { clientX: 200, clientY: attr(hit, "height") * 0.5 });
    const wiersze = all(container, "g[data-role='row']");
    expect(wiersze[0].querySelector("path[data-active='true']")).toBeNull();
    expect(wiersze[1].querySelector("path[data-active='true']")).not.toBeNull();
  });

  it("adres bierze się z osi PIONOWEJ, więc ruch w poziomie nie zmienia wiersza", () => {
    // Parametry siedzą w pasmach, a wykres jest poziomy: gdyby adres szedł
    // z osi wartości, przesunięcie kursora wzdłuż paska przeskakiwałoby na
    // inny parametr, czyli dymek pokazywałby liczby nie tego wiersza,
    // na którym stoi wskaźnik.
    const { container } = render(<TornadoChart config={cfg(ARKUSZ)} lang="pl" />);
    const hit = hitLayer(container);
    const y = attr(hit, "height") * 0.9;
    fireEvent.pointerMove(hit, { clientX: attr(hit, "width") * 0.05, clientY: y });
    const pierwszy = container.querySelector(".neh-tooltip")?.textContent ?? "";
    fireEvent.pointerMove(hit, { clientX: attr(hit, "width") * 0.95, clientY: y });
    const drugi = container.querySelector(".neh-tooltip")?.textContent ?? "";
    expect(pierwszy).toContain("Wolumen");
    expect(drugi).toBe(pierwszy);
  });

  it("dymek podaje OBA końce, OBA odchylenia i rozpiętość", () => {
    // Jedna liczba w dymku sprowadzałaby wrażliwość do pojedynczego
    // scenariusza, a pytanie brzmi: o ile wynik może się ruszyć w każdą
    // stronę i ile wynosi cały zasięg, po którym wiersz stoi w rankingu.
    const { container } = render(<TornadoChart config={cfg(ARKUSZ)} lang="pl" />);
    const hit = hitLayer(container);
    fireEvent.pointerMove(hit, { clientX: 200, clientY: attr(hit, "height") * 0.1 });
    expect(all(container, ".neh-tooltip dl > div")).toHaveLength(5);
    const tekst = container.querySelector(".neh-tooltip")?.textContent ?? "";
    expect(tekst).toContain("Kurs EUR");
    expect(tekst).toContain(formatChartValue(90, "pl", ""));
    expect(tekst).toContain(formatChartValue(130, "pl", ""));
    // Odchylenie w dół jest ujemne i takie musi zostać: "-10" mówi kierunek,
    // "10" udawałoby, że wynik rośnie w obie strony.
    expect(tekst).toContain(formatChartValue(-10, "pl", ""));
  });

  it("dymek nazywa parametr odwrotny dopiskiem, a nie samym kolorem paska", () => {
    // Liczby w dymku odwróconej pary czyta się inaczej niż w każdej innej:
    // bez dopisku wyglądają na pomyłkę w kolejności kolumn arkusza.
    const { container } = render(
      <TornadoChart config={cfg(para("Odwrotny", 130, 90))} lang="pl" />,
    );
    const hit = hitLayer(container);
    // "Odwrotny" ma rozpiętość 40, a "Drugi" 50, więc w rankingu stoi NIŻEJ -
    // wskaźnik idzie w dolne pasmo, bo kolejność wierszy jest kolejnością
    // rozpiętości, nie arkusza.
    fireEvent.pointerMove(hit, { clientX: 200, clientY: attr(hit, "height") * 0.75 });
    const dymek = container.querySelector(".neh-tooltip")?.textContent ?? "";
    expect(dymek).toContain("Odwrotny");
    expect(dymek).toContain("parametr odwrotny");
  });

  it("dotyk NIE gasi dymka przy opuszczeniu warstwy", () => {
    // Palec schodzi z ekranu po każdym stuknięciu, więc `pointerleave`
    // z dotyku gasiłby dymek zawsze natychmiast po jego pokazaniu, czyli
    // wykres byłby na telefonie martwy.
    const { container } = render(<TornadoChart config={cfg(ARKUSZ)} lang="pl" />);
    const hit = hitLayer(container);
    fireEvent.pointerDown(hit, { clientX: 200, clientY: 40, pointerType: "touch" });
    fireEvent.pointerLeave(hit, { pointerType: "touch" });
    expect(container.querySelector(".neh-tooltip")).not.toBeNull();
  });

  it("wskaźnik myszy schodzący z pola gasi dymek", () => {
    // Lustro poprzedniego przypadku: przy myszy stan zdejmuje `pointerleave`,
    // bo inaczej dymek zostawałby nad wykresem, z którego kursor już zszedł.
    const { container } = render(<TornadoChart config={cfg(ARKUSZ)} lang="pl" />);
    const hit = hitLayer(container);
    fireEvent.pointerMove(hit, { clientX: 200, clientY: 40 });
    fireEvent.pointerLeave(hit, { pointerType: "mouse" });
    expect(container.querySelector(".neh-tooltip")).toBeNull();
  });
});

describe("TornadoChart - klawiatura i dostępność", () => {
  it("strzałki PIONOWE przesuwają wiersz, Escape czyści", () => {
    // Pasma są pionowe, więc strzałki poziome przesuwałyby zaznaczenie wzdłuż
    // osi WARTOŚCI, na której nie ma czego wybierać. Bez nawigacji klawiaturą
    // połowa precyzji wykresu jest niedostępna.
    const { container } = render(<TornadoChart config={cfg(ARKUSZ)} lang="pl" />);
    const box = container.querySelector<HTMLElement>("[role='img']");
    if (!box) throw new Error("brak kontenera");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(
      all(container, "g[data-role='row']")[0].querySelector("path[data-active='true']"),
    ).not.toBeNull();
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(
      all(container, "g[data-role='row']")[1].querySelector("path[data-active='true']"),
    ).not.toBeNull();
    fireEvent.keyDown(box, { key: "ArrowUp" });
    expect(
      all(container, "g[data-role='row']")[0].querySelector("path[data-active='true']"),
    ).not.toBeNull();
    fireEvent.keyDown(box, { key: "Escape" });
    expect(all(container, "path[data-role='leg'][data-active='true']")).toHaveLength(0);
  });

  it("utrata focusu czyści zaznaczenie", () => {
    // Zaznaczenie zostawione po zejściu focusu wisi nad wykresem, na którym
    // czytelnik już nie stoi, i przy następnym Tabie wygląda na stan aktywny.
    const { container } = render(<TornadoChart config={cfg(ARKUSZ)} lang="pl" />);
    const box = container.querySelector<HTMLElement>("[role='img']");
    if (!box) throw new Error("brak kontenera");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.blur(box);
    expect(all(container, "path[data-role='leg'][data-active='true']")).toHaveLength(0);
  });

  it("nazwa dostępna niesie BAZĘ, końce i kolejność wierszy, nie nazwę rodzaju", () => {
    // Czytnik ekranu nie widzi ani sylwetki leja, ani linii bazowej, więc
    // "wykres tornado" nie mówi mu niczego. Hierarchia wrażliwości musi być
    // w nazwie dostępnej, w tej samej kolejności, w której jest narysowana.
    const { container } = render(<TornadoChart config={cfg(ARKUSZ)} lang="pl" />);
    const label =
      container.querySelector<HTMLElement>("[role='img']")?.getAttribute("aria-label") ?? "";
    expect(label).toContain("Wynik bazowy");
    expect(label.indexOf("Kurs EUR")).toBeLessThan(label.indexOf("Wolumen"));
    expect(label).toContain(formatChartValue(130, "pl", ""));
    expect(label).not.toContain("NaN");
  });

  it("podpowiedź klawiatury jest OPISEM, nie nazwą", () => {
    // `aria-label` niesie treść analityczną, a instrukcja obsługi idzie
    // osobno przez `aria-describedby` - inaczej czytnik czytałby instrukcję
    // przed liczbami przy każdym wejściu na wykres.
    const { container } = render(<TornadoChart config={cfg(ARKUSZ)} lang="pl" />);
    const id = container
      .querySelector<HTMLElement>("[role='img']")
      ?.getAttribute("aria-describedby");
    expect(id).toBeTruthy();
    expect((container.querySelector(`#${id}`)?.textContent ?? "").length).toBeGreaterThan(0);
  });
});

describe("TornadoChart - alternatywa tekstowa", () => {
  it("ma kolumnę na każdą pozycję modelu i wiersze w KOLEJNOŚCI RYSOWANIA", () => {
    // Tabela ma pozwolić odczytać liczbę tego paska, na który czytelnik
    // patrzy. Przy kolejności arkuszowej musiałby najpierw szukać nazwy,
    // a to jest dokładnie ten koszt, którego tornado go pozbawia.
    const { container } = render(<TornadoChart config={cfg(ARKUSZ)} lang="pl" />);
    expect(all(container, "table th")).toHaveLength(TORNADO_COLUMNS.length);
    const wiersze = all(container, "table tbody tr");
    expect(wiersze).toHaveLength(3);
    const pierwszy = [...wiersze[0].querySelectorAll("td")].map((td) => td.textContent);
    expect(pierwszy[0]).toBe("Kurs EUR");
    expect(pierwszy).toContain(formatChartValue(40, "pl", ""));
    // Udział w największej rozpiętości: wiersz na szczycie leja ma 100%.
    expect(pierwszy[pierwszy.length - 1]).toContain("100");
  });

  it("kolumny odchyleń MILCZĄ bez bazy, a poziomy wyniku zostają", () => {
    // Alternatywa tekstowa nie może być bardziej stanowcza od rysunku: skoro
    // nie ma od czego liczyć odchyleń, tabela ich nie podaje. Poziomy
    // z arkusza są uczciwe zawsze.
    const { container } = render(<TornadoChart config={cfg(BEZ_BAZY)} lang="pl" />);
    const komorki = [...all(container, "table tbody tr")[0].querySelectorAll("td")].map(
      (td) => td.textContent,
    );
    const pary = TORNADO_COLUMNS.map((k, i) => [k, komorki[i]] as const);
    for (const [key, wartosc] of pary) {
      if (key === "lowDelta" || key === "highDelta") expect(wartosc).toBe("-");
      if (key === "low") expect(wartosc).toBe(formatChartValue(90, "pl", ""));
    }
  });

  it("przypisy wiersza jadą atrybutem, więc żaden fakt nie ginie bez klucza słownika", () => {
    // Słownik ma dziś zdania dla parametru odwrotnego, rozpiętości zerowej
    // i bazy poza przedziałem, ale nie dla pary niekompletnej. Podpisanie
    // takiego wiersza najbliższym istniejącym zdaniem byłoby podpisaniem go
    // cudzą treścią, więc fakt zostaje w atrybucie.
    const { container } = render(
      <TornadoChart
        config={cfg({
          categories: ["Jednonożny", "Drugi"],
          series: [
            { name: "Dolny koniec", values: [null, 80] },
            { name: "Górny koniec", values: [140, 130] },
            { name: "Baza", values: [100, 100] },
          ],
        })}
        lang="pl"
      />,
    );
    // Wiersz szukany po nazwie, nie po pozycji: w rankingu stoi tam, gdzie
    // postawiła go rozpiętość, a nie tam, gdzie autor wpisał go w arkuszu.
    const wiersz = all(container, "table tbody tr").find(
      (tr) => tr.querySelector("td")?.textContent === "Jednonożny",
    );
    expect(wiersz?.getAttribute("data-notes") ?? "").toContain("oneLegged");
  });
});

describe("TornadoChart - dane z bazy", () => {
  it("brak parametrów nie renderuje NICZEGO, nie pustego <svg>", () => {
    const { container } = render(
      <TornadoChart config={cfg({ categories: [], series: [] })} lang="pl" />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("jeden parametr z treścią jest NAZWANY pod rysunkiem", () => {
    // Jeden wiersz nie tworzy hierarchii wrażliwości, a po nią przychodzi się
    // do tornada - wystarczy zdanie z dwiema liczbami.
    const { container } = render(
      <TornadoChart
        config={cfg({
          categories: ["Jedyny"],
          series: [
            { name: "Dolny koniec", values: [90] },
            { name: "Górny koniec", values: [130] },
            { name: "Baza", values: [100] },
          ],
        })}
        lang="pl"
      />,
    );
    expect(container.querySelector("[data-note='reading.singleParameter']")).not.toBeNull();
    // Porada nie odbiera rysunku: model narysuje i jeden wiersz.
    expect(all(container, "path[data-role='leg']")).toHaveLength(2);
  });

  it("kompletne tornado nie zbiera ani jednego przypisu", () => {
    // Ostrzeżenie, które widać zawsze, uczy ignorowania wszystkich ostrzeżeń.
    const { container } = render(<TornadoChart config={cfg(ARKUSZ)} lang="pl" />);
    expect(all(container, "[data-note]")).toHaveLength(0);
  });

  it("NaN, Infinity i undefined nie docierają na ekran jako napisy", () => {
    // `Intl.NumberFormat.format(NaN)` zwraca literalny napis "NaN", a bramka
    // `blockMatrix.test.tsx` szuka go w `textContent` całej strony.
    const { container } = render(
      <TornadoChart
        config={cfg({
          categories: ["A", "B", "C"],
          series: [
            { name: "Dolny koniec", values: [Number.NaN, null, Number.NEGATIVE_INFINITY] },
            { name: "Górny koniec", values: [Number.POSITIVE_INFINITY, 108, 101] },
            { name: "Baza", values: [100, 100, 100] },
          ],
          showValues: true,
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

  it("dane zdegenerowane nie dają ani jednego atrybutu niepoliczalnego", () => {
    // Jedna kategoria, para równych wartości i baza w tym samym punkcie: to
    // wszystko są stany, w których mianownik skali bywa zerem, a `<svg>`
    // z atrybutem NaN nie rysuje elementu w ogóle.
    const { container } = render(
      <TornadoChart
        config={cfg({
          categories: ["Jedna"],
          series: [
            { name: "Dolny koniec", values: [100] },
            { name: "Górny koniec", values: [100] },
            { name: "Baza", values: [100] },
          ],
          showValues: true,
        })}
        lang="pl"
      />,
    );
    expect(container.textContent ?? "").not.toContain("NaN");
    for (const el of all(container, "circle, rect, line, path, text")) {
      for (const name of ["x", "y", "cx", "cy", "x1", "x2", "y1", "y2", "width", "height", "r"]) {
        const raw = el.getAttribute(name);
        if (raw === null) continue;
        expect(Number.isFinite(Number(raw)), `${name}="${raw}"`).toBe(true);
      }
      const d = el.getAttribute("d");
      if (d !== null) expect(d).not.toContain("NaN");
    }
  });

  it("etykiety bezpośrednie stoją na KOŃCACH DANYCH po właściwej stronie", () => {
    // Liczba przy końcu paska jest odczytem tej samej pozycji, którą pokazuje
    // oś - dlatego stoi na końcu danych, a nie przy bazie, i po zewnętrznej
    // stronie paska, żeby nie zasłaniać jego krawędzi.
    const { container } = render(
      <TornadoChart config={cfg({ ...ARKUSZ, showValues: true })} lang="pl" />,
    );
    const bazaX = bazaLinii(container);
    const wiersz = container.querySelector("g[data-role='row'][data-index='1']");
    if (!wiersz) throw new Error("brak wiersza");
    const dolna = wiersz.querySelector("text[data-role='leg-label'][data-side='low']");
    const gorna = wiersz.querySelector("text[data-role='leg-label'][data-side='high']");
    if (!dolna || !gorna) throw new Error("brak etykiet bezpośrednich");
    expect(dolna.textContent).toBe(formatChartValue(90, "pl", ""));
    expect(gorna.textContent).toBe(formatChartValue(130, "pl", ""));
    expect(attr(dolna, "x")).toBeLessThan(bazaX);
    expect(attr(gorna, "x")).toBeGreaterThan(bazaX);
    expect(dolna.getAttribute("text-anchor")).toBe("end");
    expect(gorna.getAttribute("text-anchor")).toBe("start");
  });

  it("w kodzie rysującym nie ma ani jednego hexa i nie ma viewBox", () => {
    // Hex w silniku znaczy, że tryb ciemny i druk są już zepsute. Brak
    // `viewBox` znaczy, że jedna jednostka użytkownika to jeden piksel CSS,
    // czyli że próg odległości w `plot.ts` mierzy piksele ekranu.
    const { container } = render(<TornadoChart config={cfg(ARKUSZ)} lang="pl" />);
    expect(container.innerHTML).not.toMatch(/(fill|stroke)="#/);
    expect(container.querySelector("svg")?.getAttribute("viewBox")).toBeNull();
  });
});
