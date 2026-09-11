// BEESWARM - CO MUSI BYĆ PRAWDĄ O RYSUNKU.
//
// SKĄD BIORĘ LICZBY. `useContainerWidth` czyta `clientWidth`, które
// w happy-dom wynosi 0, więc szerokość zostaje na wartości startowej 720 -
// geometria jest w pełni deterministyczna i można asertować piksele.
// `useRevealOnScroll` nigdy nie dostaje callbacku IntersectionObservera, więc
// stan to zawsze "static", czyli dokładnie to, co widzi crawler.
//
// CZEGO TU NIE MA. Arytmetyka roju (podział arkusza, kolejność, rozsuwanie,
// komplet pozycyjny, sufit punktów, sprawdzenia uczciwości) ma własny plik
// testowy przy modelu. Tutaj sprawdzam wyłącznie to, czego model sprawdzić nie
// może: czy RYSUNEK mówi to, co model policzył.
//
// CZEGO TU NIE MA, CZĘŚĆ DRUGA. Ani jednej asercji na treść słownika. Klucze
// `charts.beeswarm.*` dojeżdżają osobnym commitem, więc test na polski napis
// byłby czerwony nie z winy tego komponentu. Asercje idą na STRUKTURĘ,
// GEOMETRIĘ i LICZBY - te są własnością rysunku, nie tłumaczenia.
import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import type { Json } from "@/lib/content-model/json";
import { parseChartConfig } from "@/lib/charts/parse";
import type { ChartConfig } from "@/lib/charts/types";
import { BeeswarmChart } from "../BeeswarmChart";

function cfg(data: Record<string, Json>): ChartConfig {
  return parseChartConfig(data);
}

const all = (root: HTMLElement, sel: string): Element[] => [...root.querySelectorAll(sel)];
const num = (el: Element, attr: string): number => Number(el.getAttribute(attr));
const kropki = (root: HTMLElement): Element[] => all(root, "circle.neh-bee-dot");

/**
 * Dwanaście obserwacji o rozpoznawalnym komplecie pozycyjnym: mediana 14
 * (liczba, KTÓREJ W DANYCH NIE MA - kwantyl interpolowany), Q1 = 8,5,
 * Q3 = 21,75, średnia = 15,583. Dobrane tak, żeby każda z tych liczb dała inny
 * napis po sformatowaniu - inaczej asercja na komplet pozycyjny przechodziłaby
 * także dla wykresu, który pokazuje samą średnią.
 */
const DWANASCIE = [4, 7, 7, 9, 11, 13, 15, 18, 21, 24, 28, 30];

/** Pięć obserwacji o TEJ SAMEJ wartości plus dwie odstające. */
const REMISY = [10, 10, 10, 10, 10, 20, 30];

function baza(values: number[], nazwa = "Marża"): Record<string, Json> {
  return {
    // `kind` zostaje przy "bar", bo podłączenie rodzaju do silnika i schematu
    // robi osobny commit, a komponent `config.kind` w ogóle nie czyta.
    kind: "bar",
    categories: values.map((_, i) => `obs-${i + 1}`),
    series: [{ name: nazwa, values }],
    animate: false,
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

/** Warstwa trafień razem z podmienionym prostokątem - jej atrybuty SĄ polem
 *  rysunku, więc test nie musi znać marginesów. */
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

const dymek = (root: HTMLElement): string => root.querySelector(".neh-tooltip")?.textContent ?? "";

describe("BeeswarmChart - każda obserwacja jest na rysunku", () => {
  it("dwanaście obserwacji daje dwanaście kropek", () => {
    // NAJWAŻNIEJSZA ASERCJA TEGO PLIKU. Cała obietnica tego rodzaju brzmi
    // "widać każdą obserwację". Chmura z jednym punktem mniej wygląda
    // dokładnie tak samo wiarygodnie, więc czytelnik zobaczyłby PRÓBĘ MNIEJSZĄ
    // niż ta w arkuszu i nie miałby jak tego zauważyć.
    const { container } = render(<BeeswarmChart config={cfg(baza(DWANASCIE))} lang="pl" />);
    expect(kropki(container)).toHaveLength(DWANASCIE.length);
  });

  it("żadna kropka nie wychodzi z pola rysunku", () => {
    // Punkt ucięty krawędzią to obserwacja niepokazana, a ucina się zawsze
    // punkt SKRAJNY - czyli obserwacja odstająca, najczęściej najważniejsza
    // liczba na wykresie.
    const { container } = render(<BeeswarmChart config={cfg(baza(DWANASCIE))} lang="pl" />);
    const { x, y, w, h } = warstwa(container);
    for (const k of kropki(container)) {
      const r = num(k, "r");
      expect(num(k, "cx")).toBeGreaterThanOrEqual(x - r);
      expect(num(k, "cx")).toBeLessThanOrEqual(x + w + r);
      expect(num(k, "cy")).toBeGreaterThanOrEqual(y);
      expect(num(k, "cy")).toBeLessThanOrEqual(y + h);
    }
  });

  it("kolejność kropek na rysunku jest kolejnością ROSNĄCĄ wartości", () => {
    // Model oddaje punkty roju posortowane po wartości, więc pozioma
    // współrzędna nie może maleć wzdłuż tej kolejności. Gdyby malała, oś
    // byłaby odbita i czytelnik odczytałby rozkład lustrzanie: ogon w lewo
    // zamiast w prawo, czyli inny wniosek o tych samych danych.
    const { container } = render(<BeeswarmChart config={cfg(baza(DWANASCIE))} lang="pl" />);
    const xs = kropki(container).map((k) => num(k, "cx"));
    expect(xs).toHaveLength(DWANASCIE.length);
    for (let i = 1; i < xs.length; i += 1) {
      expect(xs[i]).toBeGreaterThanOrEqual(xs[i - 1] - 0.01);
    }
  });
});

describe("BeeswarmChart - pozycja z danych, przesunięcie z modelu", () => {
  it("obserwacje o tej samej wartości dzielą pozycję na osi i rozjeżdżają się TYLKO w poprzek", () => {
    // TO JEST DEFEKT, KTÓRY POPEŁNIA WIĘKSZOŚĆ IMPLEMENTACJI BEESWARMA:
    // rozsunięcie "trochę na boki" wzdłuż osi wartości, żeby punkty ładniej
    // się ułożyły. Czytelnik odczytuje wtedy z osi wartość, której nikt nie
    // zmierzył. Pozycja wzdłuż osi JEST daną, przesunięcie prostopadłe nie.
    const { container } = render(<BeeswarmChart config={cfg(baza(REMISY))} lang="pl" />);
    const ks = kropki(container);
    expect(ks).toHaveLength(REMISY.length);
    const xs = ks.map((k) => num(k, "cx"));
    const najmniejszy = Math.min(...xs);
    const remis = ks.filter((k) => Math.abs(num(k, "cx") - najmniejszy) < 0.01);
    // Pięć dziesiątek stoi na jednej pozycji osi...
    expect(remis).toHaveLength(5);
    // ...i na pięciu różnych wysokościach.
    expect(new Set(remis.map((k) => num(k, "cy"))).size).toBe(5);
  });

  it("kropki na jednej pozycji osi nie nakładają się na siebie", () => {
    // Nakładające się punkty zaniżają widzianą liczebność DOKŁADNIE tam, gdzie
    // dane są najgęstsze, więc rozkład wygląda na płaski w miejscu, w którym
    // ma szczyt. Odstęp dwóch promieni to warunek geometryczny styku dwóch kół,
    // nie liczba z gustu.
    const { container } = render(<BeeswarmChart config={cfg(baza(REMISY))} lang="pl" />);
    const ks = kropki(container);
    const r = num(ks[0], "r");
    const najmniejszy = Math.min(...ks.map((k) => num(k, "cx")));
    const ys = ks
      .filter((k) => Math.abs(num(k, "cx") - najmniejszy) < 0.01)
      .map((k) => num(k, "cy"))
      .sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i += 1) {
      expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(2 * r - 0.05);
    }
  });

  it("wszystkie kropki mają JEDNAKOWY promień", () => {
    // Kropki różnej wielkości kodowałyby rozmiarem wartość, której na tym
    // wykresie nie ma - a rozmiar czyta się jako "ważniejsza obserwacja".
    const { container } = render(<BeeswarmChart config={cfg(baza(DWANASCIE))} lang="pl" />);
    const rs = kropki(container).map((k) => num(k, "r"));
    expect(new Set(rs).size).toBe(1);
    expect(rs[0]).toBeGreaterThan(0);
  });

  it("kropka NIE ma klasy .neh-dot, bo arkusz nadpisałby jej promień", () => {
    // `.neh-chart .neh-dot { r: var(--chart-dot) }` wygrywa z atrybutem `r`.
    // Kropka roju o innym promieniu niż jednostka, w której policzono
    // rozsunięcie, nakłada się z sąsiadami - czyli sam arkusz stylów
    // zniszczyłby brak nakładek, o który cały ten rodzaj walczy.
    const { container } = render(<BeeswarmChart config={cfg(baza(REMISY))} lang="pl" />);
    expect(container.querySelector("circle.neh-dot")).toBeNull();
    expect(kropki(container).length).toBeGreaterThan(0);
  });

  it("promień MALEJE, gdy rój inaczej nie mieści się w pasmie - punkty się nie zlepiają", () => {
    // Sześćdziesiąt obserwacji o jednej wartości stoi jedna nad drugą, więc
    // przy promieniu wyjściowym kolumna byłaby wyższa niż pasmo. Model NIE
    // dociska punktów (to dałoby nakładki), więc render musi zmniejszyć
    // promień i PRZELICZYĆ rozsunięcie. Bez tego czytelnik zobaczyłby
    // kolumnę wychodzącą na podpisy albo słupek zlepionych kropek.
    const rowne = Array.from({ length: 60 }, () => 10);
    const { container } = render(<BeeswarmChart config={cfg(baza(rowne))} lang="pl" />);
    const ks = kropki(container);
    expect(ks).toHaveLength(60);
    const r = num(ks[0], "r");
    expect(r).toBeLessThan(3);
    expect(r).toBeGreaterThan(1);
    const { y, h } = warstwa(container);
    const ys = ks.map((k) => num(k, "cy")).sort((a, b) => a - b);
    expect(ys[0]).toBeGreaterThanOrEqual(y);
    expect(ys[ys.length - 1]).toBeLessThanOrEqual(y + h);
    for (let i = 1; i < ys.length; i += 1) {
      expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(2 * r - 0.05);
    }
  });
});

describe("BeeswarmChart - kolor i płyta", () => {
  it("wypełnienie niesie kolor grupy, obwódka jest w kolorze PŁYTY", () => {
    // Obwódka w kolorze płyty rozdziela stykające się punkty BEZ wprowadzania
    // drugiego koloru; obwódka w kolorze serii (jak przy kropce na linii)
    // zlewałaby sąsiadów w jedną plamę, a wypełnienie płytą odebrałoby chmurze
    // kolor grupy.
    const { container } = render(<BeeswarmChart config={cfg(baza(REMISY))} lang="pl" />);
    for (const k of kropki(container)) {
      expect(k.getAttribute("fill")).toMatch(/^var\(--chart-\d+\)$/);
      expect(k.getAttribute("stroke")).toBe("var(--card)");
    }
  });

  it("w rysunku nie ma ani jednego heksa", () => {
    // Hex w kodzie rysującym znaczy, że tryb ciemny i druk są już zepsute -
    // kropka nie stanie się ciemna razem z płytą i przestanie się od niej
    // odcinać.
    const { container } = render(<BeeswarmChart config={cfg(baza(DWANASCIE))} lang="pl" />);
    expect(container.innerHTML).not.toMatch(/(fill|stroke)="#/);
  });

  it("svg nie ma viewBox", () => {
    // Brak `viewBox` znaczy, że jedna jednostka użytkownika to jeden piksel
    // CSS - a od tego zależy, czy próg `HIT_RADIUS_PX` (24 px, WCAG 2.5.8)
    // znaczy to, co mówi jego nazwa. Z `viewBox` obie osie mogłyby dostać
    // różne współczynniki i "najbliższy punkt" zależałby od proporcji
    // elementu, a nie od danych.
    const { container } = render(<BeeswarmChart config={cfg(baza(DWANASCIE))} lang="pl" />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.hasAttribute("viewBox")).toBe(false);
  });
});

describe("BeeswarmChart - grupy", () => {
  const dwieSerie: Record<string, Json> = {
    kind: "bar",
    categories: ["a", "b", "c", "d", "e", "f"],
    series: [
      { name: "Kohorta 2024", values: [4, 8, 12, 16, 20, 24] },
      { name: "Kohorta 2025", values: [4, 8, 12, 16, 20, 24] },
    ],
    animate: false,
  };

  it("każdy rój ma własne pasmo - roje się nie przeplatają", () => {
    // Przy nachodzących pasmach podpis grupy wskazuje chmurę, która nie jest
    // tylko jego - czytelnik przypisałby obserwacje do złej kohorty, a kolor
    // jest wtedy jedynym nośnikiem różnicy (czyli w druku w skali szarości nie
    // ma żadnego).
    const { container } = render(<BeeswarmChart config={cfg(dwieSerie)} lang="pl" />);
    const pierwszy = all(container, 'circle[data-swarm="0"]').map((k) => num(k, "cy"));
    const drugi = all(container, 'circle[data-swarm="1"]').map((k) => num(k, "cy"));
    expect(pierwszy).toHaveLength(6);
    expect(drugi).toHaveLength(6);
    expect(Math.max(...pierwszy)).toBeLessThan(Math.min(...drugi));
  });

  it("podpis grupy niesie JEJ liczebność, nie wspólną", () => {
    // Sekcja 8: "Podaj n". Jedno `n` pod całym wykresem przy dwóch rojach
    // o różnej liczebności mówiłoby o próbie, której nie ma - a chmura
    // trzydziestu i trzystu punktów wygląda podobnie.
    const { container } = render(<BeeswarmChart config={cfg(dwieSerie)} lang="pl" />);
    const podpisy = all(container, "text.neh-bee-n");
    expect(podpisy).toHaveLength(2);
    podpisy.forEach((p, i) => {
      const ile = all(container, `circle[data-swarm="${i}"]`).length;
      expect(p.textContent ?? "").toContain(String(ile));
    });
  });

  it("nazwa grupy stoi na rysunku, a nie tylko w dymku", () => {
    // Hover nigdy nie niesie treści (sekcja 6): na wydruku i na zrzucie ekranu
    // kursora nie ma, więc bez podpisu obie chmury są bezimienne.
    const { container } = render(<BeeswarmChart config={cfg(dwieSerie)} lang="pl" />);
    const napisy = all(container, "text.neh-bee-label").map((e) => e.textContent ?? "");
    expect(napisy.join(" ")).toContain("Kohorta 2024");
    expect(napisy.join(" ")).toContain("Kohorta 2025");
  });

  it("strzałka w pionie przechodzi do sąsiedniego roju przy NAJBLIŻSZEJ wartości", () => {
    // Pion odpowiada na pytanie "co ma druga grupa w tym samym miejscu osi".
    // Przeskok na "tę samą pozycję w tablicy" trafiałby w innym roju w inne
    // miejsce rozkładu, bo roje mają różne liczebności.
    const { container } = render(<BeeswarmChart config={cfg(dwieSerie)} lang="pl" />);
    const box = container.querySelector<HTMLElement>("[role='img']");
    if (!box) throw new Error("brak kontenera");
    fireEvent.keyDown(box, { key: "ArrowRight" });
    const pierwszy = container.querySelector("circle[data-active='true']");
    if (!pierwszy) throw new Error("strzałka nie wskazała obserwacji");
    const x = num(pierwszy, "cx");
    expect(pierwszy.getAttribute("data-swarm")).toBe("0");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    const drugi = container.querySelector("circle[data-active='true']");
    expect(drugi?.getAttribute("data-swarm")).toBe("1");
    // Obie kohorty mają w danych tę samą wartość, więc najbliższa jest
    // dokładnie ta sama pozycja na osi.
    expect(num(drugi as Element, "cx")).toBeCloseTo(x, 5);
  });
});

describe("BeeswarmChart - strefa trafienia idzie po CHMURZE", () => {
  it("dymek pokazuje obserwację najbliższą wskaźnikowi, nie pierwszą z brzegu", () => {
    // Na jednej pozycji osi leży wiele obserwacji, więc jedna współrzędna nie
    // wskazuje żadnej z nich. Wskaźnik nad skrajnie prawą kropką musi dać
    // MAKSIMUM próby - inaczej dymek mówi o innej obserwacji niż ta, na której
    // stoi kursor.
    const { container } = render(<BeeswarmChart config={cfg(baza(DWANASCIE))} lang="pl" />);
    const { hit } = warstwa(container);
    const ks = kropki(container);
    const prawa = ks.reduce((a, b) => (num(a, "cx") >= num(b, "cx") ? a : b));
    fireEvent.pointerMove(hit, { clientX: num(prawa, "cx"), clientY: num(prawa, "cy") });
    expect(dymek(container)).toContain("30");
    const lewa = ks.reduce((a, b) => (num(a, "cx") <= num(b, "cx") ? a : b));
    fireEvent.pointerMove(hit, { clientX: num(lewa, "cx"), clientY: num(lewa, "cy") });
    expect(dymek(container)).toContain("4");
  });

  it("poza progiem odległości żadna obserwacja nie jest wskazana", () => {
    // Dymek pokazywany w każdym miejscu płyty twierdzi, że wskaźnik jest nad
    // obserwacją, której tam nie ma. Przy rozkładzie skupionym w środku pasma
    // górna krawędź pola jest o ponad sto pikseli od najbliższej kropki.
    const { container } = render(<BeeswarmChart config={cfg(baza(DWANASCIE))} lang="pl" />);
    const { hit, x, y, w } = warstwa(container);
    fireEvent.pointerMove(hit, { clientX: x + w / 2, clientY: y });
    expect(container.querySelector(".neh-tooltip")).toBeNull();
    expect(container.querySelector("circle[data-active='true']")).toBeNull();
  });

  it("dymek niesie wartość, nazwę obserwacji i nazwę grupy", () => {
    // Sam numer bez wartości nie odpowiada na żadne pytanie, a sama wartość
    // bez nazwy obserwacji odbiera beeswarmowi to, czego histogram nie umie:
    // "kto tu leży".
    const { container } = render(<BeeswarmChart config={cfg(baza(DWANASCIE))} lang="pl" />);
    const { hit } = warstwa(container);
    const prawa = kropki(container).reduce((a, b) => (num(a, "cx") >= num(b, "cx") ? a : b));
    fireEvent.pointerMove(hit, { clientX: num(prawa, "cx"), clientY: num(prawa, "cy") });
    const tresc = dymek(container);
    expect(tresc).toContain("obs-12");
    expect(tresc).toContain("Marża");
    expect(tresc).toContain("30");
  });

  it("dotyk NIE gasi dymka przy opuszczeniu warstwy", () => {
    // Palec schodzi z ekranu po każdym stuknięciu, więc `pointerleave`
    // z dotyku gasiłby dymek zawsze natychmiast po jego pokazaniu - wykres
    // byłby na telefonie martwy.
    const { container } = render(<BeeswarmChart config={cfg(baza(DWANASCIE))} lang="pl" />);
    const { hit } = warstwa(container);
    const prawa = kropki(container).reduce((a, b) => (num(a, "cx") >= num(b, "cx") ? a : b));
    fireEvent.pointerDown(hit, {
      clientX: num(prawa, "cx"),
      clientY: num(prawa, "cy"),
      pointerType: "touch",
    });
    fireEvent.pointerLeave(hit, { pointerType: "touch" });
    expect(container.querySelector(".neh-tooltip")).not.toBeNull();
  });

  it("kropka pod wskaźnikiem rośnie o piksel i NIC poza tym się nie rusza", () => {
    // Promień markera jest jedyną dozwoloną zmianą geometrii na hover, bo nie
    // koduje wartości (koduje ją pozycja). Gdyby ruszyła się pozycja, wykres
    // przez chwilę pokazywałby wartość, której nie ma.
    const { container } = render(<BeeswarmChart config={cfg(baza(DWANASCIE))} lang="pl" />);
    const { hit } = warstwa(container);
    const ks = kropki(container);
    const spokoj = num(ks[0], "r");
    const prawa = ks.reduce((a, b) => (num(a, "cx") >= num(b, "cx") ? a : b));
    const x = num(prawa, "cx");
    const y = num(prawa, "cy");
    fireEvent.pointerMove(hit, { clientX: x, clientY: y });
    const czynna = container.querySelector("circle[data-active='true']");
    if (!czynna) throw new Error("wskaźnik nie wskazał obserwacji");
    expect(num(czynna, "r")).toBeCloseTo(spokoj + 1, 5);
    expect(num(czynna, "cx")).toBeCloseTo(x, 5);
    expect(num(czynna, "cy")).toBeCloseTo(y, 5);
  });
});

describe("BeeswarmChart - klawiatura i dostępność", () => {
  it("strzałki czytają rój w kolejności rosnącej wartości, Escape czyści", () => {
    // Nawigacja klawiaturą jest jedynym sposobem odczytania wartości bez
    // wskaźnika. Gdyby strzałka skakała po kolejności z arkusza, czytelnik
    // przechodziłby rozkład losowo, a nie od najmniejszej obserwacji.
    const { container } = render(<BeeswarmChart config={cfg(baza(DWANASCIE))} lang="pl" />);
    const box = container.querySelector<HTMLElement>("[role='img']");
    if (!box) throw new Error("brak kontenera");
    fireEvent.keyDown(box, { key: "ArrowRight" });
    const pierwsza = container.querySelector("circle[data-active='true']");
    if (!pierwsza) throw new Error("brak zaznaczenia po strzałce");
    const x1 = num(pierwsza, "cx");
    fireEvent.keyDown(box, { key: "ArrowRight" });
    const druga = container.querySelector("circle[data-active='true']");
    expect(num(druga as Element, "cx")).toBeGreaterThanOrEqual(x1);
    fireEvent.keyDown(box, { key: "Escape" });
    expect(container.querySelector("circle[data-active='true']")).toBeNull();
  });

  it("nazwa dostępna niesie KOMPLET POZYCYJNY, nie samą średnią", () => {
    // Kolumna "Czego unikać" dla rozkładu ma jedną pozycję: "średnia bez
    // rozproszenia". Czytelnik ekranu chmury punktów nie zobaczy, więc jeśli
    // nazwa dostępna niesie jedną liczbę, to dla niego ten wykres JEST średnią
    // bez rozproszenia. Liczby policzone poza modelem: mediana 14 (interpolowana,
    // w danych jej nie ma), Q1 8,5, Q3 21,75, średnia 15,583, IQR 13,25.
    const { container } = render(<BeeswarmChart config={cfg(baza(DWANASCIE))} lang="pl" />);
    const label = container.querySelector("[role='img']")?.getAttribute("aria-label") ?? "";
    expect(label).toContain("8,5");
    expect(label).toContain("14");
    expect(label).toContain("21,8");
    expect(label).toContain("15,6");
    expect(label).toContain("13,3");
    expect(label).toContain("30");
  });

  it("nazwa dostępna niesie tytuł wykresu", () => {
    const { container } = render(
      <BeeswarmChart config={cfg({ ...baza(DWANASCIE), title: "Marże spółek" })} lang="pl" />,
    );
    const label = container.querySelector("[role='img']")?.getAttribute("aria-label") ?? "";
    expect(label).toContain("Marże spółek");
  });

  it("podpowiedź klawiatury jest OPISEM, nie nazwą", () => {
    // W nazwie dostępnej podpowiedź obsługi zabrałaby miejsce liczbom
    // i czytnik przeczytałby instrukcję przed danymi.
    const { container } = render(<BeeswarmChart config={cfg(baza(DWANASCIE))} lang="pl" />);
    const box = container.querySelector<HTMLElement>("[role='img']");
    const ids = (box?.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);
    expect(ids.length).toBeGreaterThanOrEqual(1);
    for (const id of ids) {
      const el = container.querySelector(`[id="${id}"]`);
      expect(el).not.toBeNull();
      expect((el?.textContent ?? "").length).toBeGreaterThan(0);
    }
  });

  it("porada formy dociera do OPISU, gdy rozproszenia nie ma", () => {
    // Rój bez rozproszenia jest prostą kolumną punktów, więc słowo "rozkład"
    // jest wtedy bez treści - i czytelnik ma prawo o tym wiedzieć. Sprawdzam
    // sam FAKT dojścia komunikatu (liczba opisów rośnie), nie jego treść:
    // treść pisze słownik.
    const { container: zRozproszeniem } = render(
      <BeeswarmChart config={cfg(baza(DWANASCIE))} lang="pl" />,
    );
    const { container: bezRozproszenia } = render(
      <BeeswarmChart config={cfg(baza([7, 7, 7, 7, 7, 7]))} lang="pl" />,
    );
    const opisy = (root: HTMLElement): number =>
      (root.querySelector("[role='img']")?.getAttribute("aria-describedby") ?? "")
        .split(" ")
        .filter(Boolean).length;
    expect(opisy(bezRozproszenia)).toBeGreaterThan(opisy(zRozproszeniem));
  });
});

describe("BeeswarmChart - dane z bazy", () => {
  it("brak obserwacji nie renderuje NICZEGO, nie pustego <svg>", () => {
    const { container } = render(
      <BeeswarmChart config={cfg({ ...baza(DWANASCIE), series: [], categories: [] })} lang="pl" />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("NaN i Infinity nie docierają na ekran jako napisy", () => {
    // `Intl.NumberFormat.format(NaN)` zwraca literalny napis "NaN", a bramka
    // `blockMatrix.test.tsx` szuka go w `textContent` całej strony.
    const { container } = render(
      <BeeswarmChart
        config={cfg({
          kind: "bar",
          categories: ["a", "b", "c", "d", "e", "f"],
          series: [
            {
              name: "Zepsute",
              values: [1, 2, Number.NaN, 8, Number.POSITIVE_INFINITY, 13],
            },
          ],
          animate: false,
        })}
        lang="pl"
      />,
    );
    const tekst = container.textContent ?? "";
    expect(tekst).not.toContain("NaN");
    expect(tekst).not.toContain("Infinity");
    expect(tekst).not.toContain("undefined");
    expect(tekst).not.toContain("∞");
    // Luka jest brakiem pomiaru, nie zerem, więc kropek jest tyle, ile liczb.
    expect(kropki(container)).toHaveLength(4);
    for (const k of kropki(container)) {
      expect(Number.isFinite(num(k, "cx"))).toBe(true);
      expect(Number.isFinite(num(k, "cy"))).toBe(true);
      expect(Number.isFinite(num(k, "r"))).toBe(true);
    }
  });

  it("JEDNA obserwacja nie wywraca rysunku", () => {
    const { container } = render(
      <BeeswarmChart
        config={cfg({ kind: "bar", categories: ["a"], series: [{ name: "x", values: [42] }] })}
        lang="pl"
      />,
    );
    expect(kropki(container)).toHaveLength(1);
    expect(container.textContent ?? "").not.toContain("NaN");
    expect(Number.isFinite(num(kropki(container)[0], "cx"))).toBe(true);
  });

  it("wszystkie wartości RÓWNE nie dzielą przez zero", () => {
    // Zerowa rozpiętość domeny to dzielenie zera przez zero w każdej pozycji,
    // czyli "NaN" w atrybutach i - po sformatowaniu - na stronie.
    const { container } = render(<BeeswarmChart config={cfg(baza([5, 5, 5, 5]))} lang="pl" />);
    const ks = kropki(container);
    expect(ks).toHaveLength(4);
    const xs = ks.map((k) => num(k, "cx"));
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(0.01);
    for (const x of xs) expect(Number.isFinite(x)).toBe(true);
    expect(container.textContent ?? "").not.toContain("NaN");
  });

  it("wersja angielska formatuje liczby po europejsku i nie gubi kropek", () => {
    const { container } = render(<BeeswarmChart config={cfg(baza(DWANASCIE))} lang="en" />);
    expect(kropki(container)).toHaveLength(DWANASCIE.length);
    const label = container.querySelector("[role='img']")?.getAttribute("aria-label") ?? "";
    expect(label).toContain("15.6");
    expect(label).not.toContain("NaN");
  });
});
