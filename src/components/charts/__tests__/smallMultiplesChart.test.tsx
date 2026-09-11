// SMALL MULTIPLES - CO MUSI BYĆ PRAWDĄ O SIATCE PANELI.
//
// KONFIGURACJA BEZ KLUCZA `kind`, i to jest świadome: model paneli czyta
// `categories` i `series`, a nie `config.kind` (`grep -n "config.kind"
// src/lib/charts/kinds/smallMultiples.ts` nie zwraca NIC), więc rodzaj
// w konfiguracji nie ma tu żadnego znaczenia i wpisanie go sugerowałoby
// zależność, której nie ma. Tego, czy rozdzielnik `Chart.tsx` oddaje rodzaj
// "small-multiples" TEMU renderowi, pilnuje osobna bramka
// `everyKindRenders.test.tsx` - i to jest jej jedyne zadanie, którego ten plik
// nie dubluje.
//
// SKĄD BIORĘ LICZBY. `useContainerWidth` czyta `clientWidth`, które
// w happy-dom wynosi 0, więc szerokość zostaje na wartości startowej 720.
// Dla płyty 320 px daje to margines lewy 32 px, obszar siatki 676 na 272 px,
// siatkę 2 na 2 (trzy panele, czwarta komórka wolna) i pole panelu 330 na
// 112 px - geometria jest w pełni deterministyczna i wolno asertować piksele.
// `useRevealOnScroll` nigdy nie dostaje callbacku IntersectionObservera, więc
// stan to zawsze "static", czyli dokładnie to, co widzi crawler.
//
// CZEGO TU NIE MA. Arytmetyka modelu (siatka, kolejność, wspólna domena,
// spłaszczenie, indeks bazowy, trzynaście sprawdzeń uczciwości) ma własny plik
// testowy przy modelu. Tutaj sprawdzam wyłącznie to, czego model sprawdzić nie
// może: czy RYSUNEK mówi to, co model policzył.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fireEvent, render } from "@testing-library/react";
import type { Json } from "@/lib/content-model/json";
import { parseChartConfig } from "@/lib/charts/parse";
import { FONT_AXIS } from "@/lib/charts/geometry";
import { estimateLabelWidth } from "@/lib/charts/measureText";
import i18n from "@/lib/i18n";
import { maTresc } from "@/lib/ci/i18nForms";
import "@/lib/i18n-charts";
import { MAX_SERIES } from "@/lib/charts/types";
import type { ChartConfig, ChartSeries } from "@/lib/charts/types";
import { SmallMultiplesChart, type SmallMultiplesRenderOptions } from "../SmallMultiplesChart";

function cfg(data: Record<string, Json>): ChartConfig {
  return parseChartConfig(data);
}

const all = (root: HTMLElement, sel: string): Element[] => [...root.querySelectorAll(sel)];
const num = (el: Element, attr: string): number => Number(el.getAttribute(attr));

/** Trzy podmioty na czterech okresach - najmniejszy sensowny zestaw tej formy. */
const BAZA: Record<string, Json> = {
  categories: ["2019", "2020", "2021", "2022"],
  series: [
    { name: "Polska", values: [10, 12, 14, 18] },
    { name: "Czechy", values: [8, 9, 11, 12] },
    { name: "Węgry", values: [6, 7, 6, 9] },
  ],
  unit: " mld EUR",
  animate: false,
};

function rysuj(
  dane: Record<string, Json> = {},
  options?: SmallMultiplesRenderOptions,
  lang: "pl" | "en" = "pl",
) {
  return render(
    <SmallMultiplesChart config={cfg({ ...BAZA, ...dane })} lang={lang} options={options} />,
  );
}

/** Treść uwagi po jej uchwycie `data-note`; pusty napis, gdy uwagi nie ma. */
const nota = (root: HTMLElement, klucz: string): string =>
  root.querySelector(`[data-note='${klucz}']`)?.textContent ?? "";

const uchwyty = (root: HTMLElement): string[] =>
  all(root, "[data-note]").map((e) => e.getAttribute("data-note") ?? "");

/** Pole rysunku panelu o tej nazwie - uchwyt geometrii. */
function pole(root: HTMLElement, label: string): Element {
  const g = root.querySelector(`g[data-role='panel'][data-panel-label='${label}']`);
  const rect = g?.querySelector("[data-role='panel-field']");
  if (!rect) throw new Error(`brak panelu ${label}`);
  return rect;
}

/** Kropka pomiaru w panelu o tej nazwie, w tej kategorii. */
function kropka(root: HTMLElement, label: string, category: number): Element {
  const g = root.querySelector(`g[data-role='panel'][data-panel-label='${label}']`);
  const c = g?.querySelector(`[data-role='panel-point'][data-category='${category}']`);
  if (!c) throw new Error(`brak kropki ${label}/${category}`);
  return c;
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

/** Seria gotowa do podstawienia W OBEJŚCIU parsera - patrz komentarze niżej. */
function seria(name: string, values: (number | null)[], colorSlot = 1): ChartSeries {
  return { name, values, colorSlot };
}

describe("SmallMultiplesChart - siatka paneli", () => {
  it("KOMÓRKI SIATKI SĄ RÓWNE, także gdy ostatni rząd jest niepełny", () => {
    // GDYBY TEGO TESTU NIE BYŁO, przeszłoby rozciągnięcie ostatniego panelu na
    // wolną komórkę - kuszące, bo "nie marnuje miejsca". Panel o innej
    // proporcji pokazuje ten sam wzrost pod INNYM KĄTEM, a kąt nachylenia
    // linii jest w tej formie głównym nośnikiem treści. Trzy panele w siatce
    // 2 na 2 są dokładnie tym przypadkiem: czwarta komórka zostaje wolna.
    const { container } = rysuj();
    const pola = all(container, "[data-role='panel-field']");
    expect(pola).toHaveLength(3);
    const szerokosci = new Set(pola.map((p) => num(p, "width")));
    const wysokosci = new Set(pola.map((p) => num(p, "height")));
    expect(szerokosci.size, `szerokości: ${[...szerokosci].join(", ")}`).toBe(1);
    expect(wysokosci.size, `wysokości: ${[...wysokosci].join(", ")}`).toBe(1);
  });

  it("WSPÓLNA OŚ: ta sama wartość w dwóch panelach leży na tym samym pikselu", () => {
    // To jest najważniejsza asercja tego pliku i cała wartość tej formy.
    // Panele porównuje się WZROKIEM, więc wartość 12 w panelu Polski i wartość
    // 12 w panelu Czech muszą leżeć na tej samej wysokości; gdyby każdy panel
    // dostał własną domenę (a wygląda to identycznie), dwie linie na tej samej
    // wysokości znaczyłyby dwie różne liczby.
    const { container } = rysuj();
    const polska = kropka(container, "Polska", 1); // 12 mld EUR
    const czechy = kropka(container, "Czechy", 3); // też 12 mld EUR
    // Oba panele stoją w pierwszym rzędzie, więc ta sama wartość to ta sama
    // współrzędna BEZWZGLĘDNA, nie tylko ten sam ułamek pola.
    expect(num(polska, "cy")).toBeCloseTo(num(czechy, "cy"), 6);
    expect(num(polska, "cx")).not.toBeCloseTo(num(czechy, "cx"), 6);
  });

  it("POZYCJA W PIONIE koduje wartość: większa liczba leży wyżej", () => {
    // Bez tej asercji przeszłoby odwrócenie osi (model podaje `v` licząc OD
    // DOŁU, render rysuje w układzie SVG, w którym y rośnie w dół) - a wykres
    // z odwróconą osią wygląda jak poprawny wykres innych danych.
    const { container } = rysuj();
    const cy = [0, 1, 2, 3].map((c) => num(kropka(container, "Polska", c), "cy"));
    // Szereg 10, 12, 14, 18 rośnie, więc współrzędna y musi MALEĆ.
    for (let i = 1; i < cy.length; i += 1) expect(cy[i]).toBeLessThan(cy[i - 1]);
  });

  it("przy słupkach ZERO jest wspólną linią bazową wszystkich paneli", () => {
    // Sekcja 8: "Oś Y słupków zawsze od zera". Znacznik kodujący DŁUGOŚĆ
    // wymaga zera w domenie, więc dolna krawędź każdego słupka musi leżeć na
    // dolnej krawędzi pola - w tej samej odległości od niej w każdym panelu.
    // Gdyby render rysował słupki od dolnej krawędzi DOMENY uciętej, długości
    // przestałyby być proporcjonalne do wartości.
    const { container } = rysuj({}, { mark: "bar" });
    const slupki = all(container, "[data-role='panel-bar']");
    expect(slupki.length).toBe(12);
    for (const s of slupki) {
      const g = s.closest("g[data-role='panel']");
      const p = g?.querySelector("[data-role='panel-field']");
      if (!p) throw new Error("słupek bez panelu");
      expect(num(s, "y") + num(s, "height")).toBeCloseTo(num(p, "y") + num(p, "height"), 6);
    }
  });

  it("PODZIAŁKI WARTOŚCI stoją RAZ, przy kolumnie zerowej - nie przy każdym panelu", () => {
    // Defekt, który ten test wyłapuje, jest defektem UBYTKU MIEJSCA: podpis
    // przy każdym panelu zabiera trzecią część jego szerokości (przy progu
    // 96 px), więc panele przestają być rysunkami. Przy siatce 2 na 2
    // podziałek jest tyle, ile RZĘDÓW razy liczba podziałek, a nie tyle, ile
    // paneli razy liczba podziałek.
    const { container } = rysuj();
    const podzialki = all(container, "[data-role='value-tick']");
    expect(podzialki.length).toBe(8); // dwa rzędy po cztery podziałki
    const lewaKolumna = num(pole(container, "Polska"), "x");
    const prawaKolumna = num(pole(container, "Czechy"), "x");
    expect(prawaKolumna).toBeGreaterThan(lewaKolumna);
    for (const p of podzialki) {
      // Wszystkie na LEWO od pola rysunku pierwszej kolumny, więc żadna nie
      // stoi w drugiej kolumnie ani nie wchodzi w pole panelu.
      expect(num(p, "x")).toBeLessThanOrEqual(lewaKolumna);
    }
  });

  it("ETYKIETY KATEGORII stoją pod NAJNIŻSZYM panelem każdej kolumny", () => {
    // "Ostatni rząd" nie wystarcza, bo ostatni rząd bywa niepełny: przy trzech
    // panelach w siatce 2 na 2 kolumna druga kończy się w rzędzie pierwszym.
    // Bez tej reguły druga kolumna zostałaby BEZ OSI KATEGORII, czyli z liniami
    // bez podpisanego czasu.
    const { container } = rysuj();
    const etykiety = all(container, "[data-role='category-tick']");
    expect(etykiety.length).toBe(8); // dwie kolumny po cztery okresy
    const kolumny = new Set<number>();
    for (const e of etykiety) {
      const g = e.closest("g[data-role='panel']");
      const p = g?.querySelector("[data-role='panel-field']");
      if (!p) throw new Error("etykieta bez panelu");
      // Pod dolną krawędzią swojego panelu, a nie w środku pola rysunku.
      expect(num(e, "y")).toBeGreaterThan(num(p, "y") + num(p, "height"));
      kolumny.add(num(p, "x"));
    }
    expect(kolumny.size, "etykiety muszą być pod każdą kolumną").toBe(2);
  });

  it("ETYKIETA BEZPOŚREDNIA stoi TYLKO przy ostatnim pomiarze panelu", () => {
    // Defekt, który ten test wyłapuje: `showValues` obsłużone tak jak
    // w wykresie kartezjańskim, czyli liczbą przy każdym punkcie. W polu
    // 330 na 112 px dwanaście etykiet zajmuje więcej miejsca niż linia, którą
    // opisują, a przy panelu 96 px nie mieści się ani jedna para. Ostatni
    // pomiar jest tym jednym, po który czytelnik sięga najczęściej.
    const { container } = rysuj({ showValues: true });
    const etykiety = all(container, "[data-role='panel-value']");
    expect(etykiety).toHaveLength(3); // po jednej na panel, nie po jednej na punkt
    expect(etykiety.map((e) => e.textContent)).toEqual(["18 mld EUR", "12 mld EUR", "9 mld EUR"]);
    // Bez żądania autora nie ma ani jednej.
    expect(all(rysuj().container, "[data-role='panel-value']")).toHaveLength(0);
  });

  it("ETYKIETA BEZPOŚREDNIA W TRYBIE INDEKSU pokazuje INDEKS, nie poziom", () => {
    // Model podaje w etykiecie punktu ZAWSZE poziom (indeks stoi w osobnej
    // kolumnie tabeli), ale w trybie indeksu linia leży na osi indeksu - więc
    // poziom wypisany przy niej opisywałby inną liczbę niż ta, którą czytelnik
    // odmierzy podziałką. Etykieta bezpośrednia musi zgadzać się z POZYCJĄ.
    const { container } = rysuj({ showValues: true }, { mode: "index" });
    const etykiety = all(container, "[data-role='panel-value']").map((e) => e.textContent);
    // Polska: 10 -> 18, czyli indeks 180; Czechy: 8 -> 12, czyli 150.
    expect(etykiety).toContain("180");
    expect(etykiety).toContain("150");
    expect(etykiety).not.toContain("18 mld EUR");
  });

  it("PANEL PONIŻEJ PROGU NIE JEST RYSOWANY, a uwagi zostają", () => {
    // Model orzeka o tym `smallMultiplesFit`, a render ma to USZANOWAĆ.
    // Dwanaście paneli na płycie 160 px daje komórki 56 px wysokości, czyli
    // poniżej `SMALL_MULTIPLES_MIN_PANEL_H`; nawet zejście do jednej kolumny
    // nie pomaga (`suggestedColumns` wychodzi `null`). Gdyby render rysował na
    // siłę, czytelnik dostałby dwanaście plam z podpisami, z których nie da
    // się odczytać ani kształtu, ani podziałek - i wyglądałoby to na rysunek.
    const { container } = rysuj({
      height: 160,
      series: Array.from({ length: 12 }, (_, i) => ({
        name: `S${i}`,
        values: [i + 1, i + 2, i + 3, i + 4],
      })),
    });
    expect(all(container, "[data-role='panel']")).toHaveLength(0);
    expect(container.querySelector("svg")).toBeNull();
    // WCZESNE WYJŚCIE NIE GUBI UWAG (histogram miał ten defekt): deklaracje
    // skali i porządku są wtedy jedyną informacją obok tabeli danych.
    expect(uchwyty(container)).toContain("scale.shared");
    expect(uchwyty(container)).toContain("order");
  });
});

describe("SmallMultiplesChart - panele i ich kolejność", () => {
  it("KAŻDY panel jest nazwany", () => {
    // Tożsamość podmiotu niesie w tej formie WYŁĄCZNIE pozycja panelu i jego
    // podpis - kolor nie koduje niczego (wszystkie panele mają jeden slot).
    // Panel bez podpisu jest więc kształtem bez podmiotu.
    const { container } = rysuj();
    const podpisy = all(container, "[data-role='panel-label']").map((e) => e.textContent);
    expect(podpisy).toEqual(["Polska", "Czechy", "Węgry"]);
  });

  it("KOLEJNOŚĆ PANELI JEST Z DANYCH, nie z arkusza", () => {
    // Pierwszy rząd siatki niesie pierwsze wrażenie, więc kolejność jest
    // nośnikiem informacji. Arkusz podaje serie w kolejności Polska, Czechy,
    // Węgry; po średniej malejąco wychodzi ta sama kolejność, więc dowód
    // wymaga arkusza POTASOWANEGO - inaczej test przechodziłby też dla
    // renderu, który kolejność bierze z arkusza.
    const { container } = rysuj({
      series: [
        { name: "Węgry", values: [6, 7, 6, 9] },
        { name: "Polska", values: [10, 12, 14, 18] },
        { name: "Czechy", values: [8, 9, 11, 12] },
      ],
    });
    expect(all(container, "[data-role='panel-label']").map((e) => e.textContent)).toEqual([
      "Polska",
      "Czechy",
      "Węgry",
    ]);
  });

  it("PANEL PUSTY ZOSTAJE W SIATCE, z nazwaną pustką i tą samą komórką", () => {
    // Usunięcie pustego panelu przesuwa sąsiadów i zmienia siatkę, a czytelnik,
    // który zna zestaw podmiotów, nie zauważy, że jednego nie ma - zauważy
    // tylko, że siatka jest inna. Dlatego panel zostaje, a jego pustka jest
    // NAZWANA kreską braku, nie zerem.
    const { container } = rysuj({
      series: [
        { name: "Polska", values: [10, 12, 14, 18] },
        { name: "Czechy", values: [null, null, null, null] },
        { name: "Węgry", values: [6, 7, 6, 9] },
      ],
    });
    expect(all(container, "[data-role='panel-field']")).toHaveLength(3);
    expect(all(container, "[data-role='panel-label']").map((e) => e.textContent)).toContain(
      "Czechy",
    );
    expect(all(container, "[data-role='panel-missing']")).toHaveLength(1);
    // Ta sama komórka co przy pełnym arkuszu - siatka się nie przebudowała.
    const { container: pelny } = rysuj();
    expect(num(pole(container, "Polska"), "width")).toBe(num(pole(pelny, "Polska"), "width"));
    expect(num(pole(container, "Polska"), "height")).toBe(num(pole(pelny, "Polska"), "height"));
    // Pusty panel nie ma linii - i nie ma też kropki na dolnej krawędzi, bo
    // luka NIE JEST zerem.
    const g = container.querySelector("g[data-panel-label='Czechy']");
    expect(g?.querySelector("[data-role='panel-line']")).toBeNull();
    expect(g?.querySelectorAll("[data-role='panel-point']").length).toBe(0);
  });

  it("LUKA PRZERYWA LINIĘ, a nie sprowadza jej do zera", () => {
    // Linia przeprowadzona przez lukę twierdzi, że między pomiarami zmierzono
    // wartość pośrednią; linia zjeżdżająca w luce do zera twierdzi, że
    // zmierzono zero. Oba zdania są o danych, których nie ma - dlatego ścieżka
    // musi mieć DWA polecenia `M`, czyli dwa osobne odcinki.
    const { container } = rysuj({
      categories: ["a", "b", "c", "d", "e"],
      series: [
        { name: "Polska", values: [10, 12, null, 18, 20] },
        { name: "Czechy", values: [8, 9, 11, 12, 13] },
      ],
    });
    const d = container
      .querySelector("g[data-panel-label='Polska'] [data-role='panel-line']")
      ?.getAttribute("d");
    expect(d, "brak ścieżki panelu").toBeTruthy();
    expect((d ?? "").match(/M/g) ?? []).toHaveLength(2);
  });
});

describe("SmallMultiplesChart - dostępność", () => {
  it("kontener rysunku ma rolę, fokus i nazwę z tytułu", () => {
    const { container } = rysuj({ title: "Wzrost w regionie" });
    const box = container.querySelector<HTMLElement>("[role='img']");
    expect(box).not.toBeNull();
    expect(box?.getAttribute("tabindex")).toBe("0");
    expect(box?.getAttribute("aria-label") ?? "").toContain("Wzrost w regionie");
  });

  it("podpowiedź klawiatury jest OPISEM, nie nazwą", () => {
    // Sama obsługa klawiszy nie wystarcza: czytelnik, który nie wie, że
    // strzałki coś robią, ich nie naciśnie.
    const { container } = rysuj();
    const box = container.querySelector<HTMLElement>("[role='img']");
    const id = box?.getAttribute("aria-describedby");
    expect(id).toBeTruthy();
    expect(container.querySelector(`#${id}`)?.textContent ?? "").toContain("Strzałkami");
  });

  it("nazwa dostępna niesie KOMPLET liczb każdego panelu, nie samą średnią", () => {
    // Czytelnik ekranu jest jedynym czytelnikiem, który siatki nie zobaczy.
    // Rodzaj, który istnieje po to, żeby porównać podmioty, musi mu oddać
    // wszystkie liczby, po których się porównuje - i w tej samej kolejności,
    // co tabela danych (`SMALL_MULTIPLES_SUMMARY_COLUMNS`).
    const { container } = rysuj();
    const label = container.querySelector("[role='img']")?.getAttribute("aria-label") ?? "";
    for (const podmiot of ["Polska", "Czechy", "Węgry"]) expect(label).toContain(podmiot);
    for (const kolumna of [
      "Obserwacje",
      "Minimum",
      "Maksimum",
      "Średnia",
      "Wartość pierwsza",
      "Wartość ostatnia",
      "Zmiana",
      "Udział we wspólnej osi",
    ]) {
      expect(label, `brak kolumny ${kolumna}`).toContain(kolumna);
    }
    // Deklaracje skali i porządku też, bo żadnej z nich nie da się usłyszeć
    // z liczb.
    expect(label).toContain("Wszystkie panele dzielą jedną oś wartości.");
    expect(label).toContain("Panele uporządkowane średnią.");
  });

  it("panel spłaszczony NAZYWA SIĘ spłaszczonym w nazwie dostępnej", () => {
    // To jedyny rodzaj, w którym część danych jest nieczytelna Z ZAŁOŻENIA.
    // Czytelnik ekranu dostaje liczby panelu, ale bez tego zdania nie wie, że
    // czytelnik widzący ma na tym samym panelu płaską kreskę.
    const { container } = rysuj({
      series: [
        { name: "Wielki", values: [100, 400, 900, 1600] },
        { name: "Mały", values: [8, 9, 11, 12] },
        { name: "Mniejszy", values: [6, 7, 6, 9] },
      ],
    });
    const label = container.querySelector("[role='img']")?.getAttribute("aria-label") ?? "";
    expect(label).toContain("panel spłaszczony wspólną osią");
  });
});

describe("SmallMultiplesChart - klawiatura chodzi po PANELACH", () => {
  it("strzałka w prawo ustawia panel czynny, Escape przywraca stan sprzed", () => {
    // Porównanie migawek HTML, bo tego samego pyta bramka `everyKindRenders`:
    // Escape musi przywrócić drzewo DOKŁADNIE do stanu sprzed strzałki, a nie
    // tylko zgasić podświetlenie. Bez tego zaznaczenie zostawia po sobie
    // element, który czytelnik zdejmie tylko przeładowaniem strony.
    const { container } = rysuj();
    const box = container.querySelector<HTMLElement>("[role='img']");
    if (!box) throw new Error("brak kontenera");
    const przed = container.innerHTML;
    fireEvent.keyDown(box, { key: "ArrowRight" });
    expect(container.innerHTML).not.toBe(przed);
    expect(container.querySelector("g[data-role='panel'][data-active='true']")).not.toBeNull();
    fireEvent.keyDown(box, { key: "Escape" });
    expect(container.innerHTML).toBe(przed);
  });

  it("strzałka pozioma idzie po KOLEJNOŚCI CZYTANIA, pionowa po kolumnie siatki", () => {
    // Strzałka po PUNKTACH w panelu byłaby złą decyzją i ten test ją wyklucza:
    // jednostką porównania jest panel, a przy dziewięciu panelach po dwanaście
    // kategorii dojście do ostatniego podmiotu to ponad sto naciśnięć. Pion
    // chodzi po kolumnie, bo tak biegnie wzrok po siatce.
    const { container } = rysuj();
    const box = container.querySelector<HTMLElement>("[role='img']");
    if (!box) throw new Error("brak kontenera");
    const czynny = (): string | null =>
      container
        .querySelector("g[data-role='panel'][data-active='true']")
        ?.getAttribute("data-panel-label") ?? null;
    fireEvent.keyDown(box, { key: "ArrowRight" });
    expect(czynny()).toBe("Polska");
    fireEvent.keyDown(box, { key: "ArrowRight" });
    expect(czynny()).toBe("Czechy"); // sąsiad w tym samym rzędzie
    fireEvent.keyDown(box, { key: "ArrowLeft" });
    expect(czynny()).toBe("Polska");
    // Siatka jest 2 na 2, więc w dół to skok o dwie pozycje: z pierwszej
    // kolumny rzędu pierwszego do pierwszej kolumny rzędu drugiego.
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(czynny()).toBe("Węgry");
    // Krańce PRZYCINAMY, nie zawijamy: pierwszy i ostatni panel są krańcami
    // porządku, więc przeskok z jednego na drugi czytałby się jak zmiana danych.
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(czynny()).toBe("Węgry");
  });

  it("klawisze nieobsługiwane nie wywracają rysunku", () => {
    const { container } = rysuj();
    const box = container.querySelector<HTMLElement>("[role='img']");
    if (!box) throw new Error("brak kontenera");
    for (const key of ["Tab", "Enter", " ", "a", "F5", "PageDown", "Home"]) {
      expect(() => fireEvent.keyDown(box, { key }), `klawisz ${key} rzucił`).not.toThrow();
    }
    expect(container.textContent ?? "").not.toContain("NaN");
  });

  it("wskaźnik nad WOLNĄ komórką ostatniego rzędu nie wskazuje panelu", () => {
    // Trzy panele w siatce 2 na 2 zostawiają wolną komórkę. Dymek nad nią
    // twierdziłby, że stoi tam podmiot - a nie stoi tam żaden.
    const { container } = rysuj();
    const hit = container.querySelector("rect.neh-hit");
    if (!hit) throw new Error("brak warstwy trafień");
    stubPlotRect(hit, 676, 272);
    // Prawy dolny narożnik siatki: kolumna druga, rząd drugi.
    fireEvent.pointerMove(hit, { clientX: 600, clientY: 240 });
    expect(container.querySelector(".neh-tooltip")).toBeNull();
    // ...a nad panelem istniejącym dymek jest, z jego nazwą.
    fireEvent.pointerMove(hit, { clientX: 100, clientY: 60 });
    expect(container.querySelector(".neh-tooltip")?.textContent ?? "").toContain("Polska");
  });
});

describe("SmallMultiplesChart - i18n", () => {
  it("ten sam zestaw daje odmienne POPRAWNE napisy w pl i en", () => {
    const dane = {
      series: [
        { name: "Polska", values: [10000, 12000, 15000, 18000] },
        { name: "Czechy", values: [8000, 9000, 11000, 12000] },
      ],
    };
    const pl = rysuj(dane).container;
    const en = rysuj(dane, undefined, "en").container;
    expect(nota(pl, "scale.shared")).toContain("Wszystkie panele dzielą jedną oś wartości.");
    expect(nota(en, "scale.shared")).toContain("All panels share one value axis.");
    expect(nota(pl, "order")).toBe("Panele uporządkowane średnią.");
    expect(nota(en, "order")).toBe("Panels ordered by mean.");
    // GRUPOWANIE TYSIĘCY: pl-PL stawia TWARDĄ SPACJĘ (U+00A0), en-GB przecinek.
    // Znak twardej spacji jest tu wpisany wprost, bo o to właśnie idzie - test
    // ze zwykłą spacją przechodziłby dla renderu, który liczby sklejałby sam.
    const labelPl = pl.querySelector("[role='img']")?.getAttribute("aria-label") ?? "";
    const labelEn = en.querySelector("[role='img']")?.getAttribute("aria-label") ?? "";
    expect(labelPl).toContain("18 000 mld EUR");
    expect(labelEn).toContain("18,000 mld EUR");
    expect(labelPl).not.toContain("18,000");
  });

  it("żadna uwaga nie zostawia surowej wstawki ani ścieżki słownika", () => {
    // Brakująca liczba nie jest błędem kompilacji ani rozjazdem klucza:
    // i18next zostawia w zdaniu surowe `{{count}}` i jedyne, co to wyłapie, to
    // tekst na ekranie. Przechodzimy przez arkusze, które zapalają WSZYSTKIE
    // komunikaty z wstawkami.
    const przypadki: Array<[Record<string, Json>, SmallMultiplesRenderOptions | undefined]> = [
      [{ sampleSize: 300 }, undefined],
      [{}, { scaleMode: "free" }],
      [{}, { scaleMode: "free", freeScaleNote: "różne jednostki" }],
      [{}, { order: "input" }],
      [{}, { domainMin: 10, domainMax: 14 }],
      [{}, { mark: "bar", domainMin: 10, domainMax: 20 }],
      [
        {
          series: [
            { name: "Wielki", values: [100, 400, 900, 1600] },
            { name: "Mały", values: [8, 9, 11, 12] },
            { name: "Mniejszy", values: [6, 7, 6, 9] },
          ],
        },
        undefined,
      ],
      [
        {
          series: [
            { name: "Polska", values: [10, 12, 14, 18] },
            { name: "Czechy", values: [0, 9, 11, 12] },
          ],
        },
        { mode: "index" },
      ],
      [
        {
          height: 640,
          categories: Array.from({ length: 13 }, (_, i) => `K${i}`),
          series: [{ name: "x", values: Array.from({ length: 13 }, (_, i) => i + 1) }],
        },
        { panelBy: "category" },
      ],
      // Stany, w których render SKŁADA zdania sam: tytuł w nazwie dostępnej,
      // etykiety bezpośrednie, podpowiedzi paneli przy osobnych skalach,
      // żądanie usunięcia pustych paneli, jedna kategoria i pusty zestaw.
      [{ title: "Handel & usługi", showValues: true, showGrid: true }, { mark: "area" }],
      [
        {
          series: [
            { name: "A", values: [1, 2, 3, 4] },
            { name: "B", values: [null, null, null, null] },
          ],
        },
        { dropEmptyPanels: true },
      ],
      [
        {
          categories: ["2020"],
          series: [
            { name: "A", values: [1] },
            { name: "B", values: [2] },
          ],
        },
        undefined,
      ],
      [
        {
          categories: ["a", "b"],
          series: [
            { name: "A", values: [null, null] },
            { name: "B", values: [null, null] },
          ],
        },
        undefined,
      ],
      [
        {
          height: 160,
          series: Array.from({ length: 12 }, (_, i) => ({
            name: `S${i}`,
            values: [i + 1, i + 2, i + 3, i + 4],
          })),
        },
        undefined,
      ],
    ];
    for (const [dane, opts] of przypadki) {
      for (const lang of ["pl", "en"] as const) {
        const { container } = rysuj(dane, opts, lang);
        // CAŁY RYSUNEK, nie same uwagi: wstawka bez wartości wychodzi tak samo
        // surowo w nazwie dostępnej, w podpowiedzi panelu i w podpisie osi,
        // a te trzy miejsca są dla czytelnika ekranu CAŁYM wykresem. Zbieramy
        // więc tekst i WSZYSTKIE wartości atrybutów.
        const atrybuty = all(container, "*")
          .flatMap((el) => [...el.attributes].map((a) => a.value))
          .join(" ");
        const wszystko = `${container.textContent ?? ""} ${atrybuty}`;
        const gdzie = `${JSON.stringify(dane).slice(0, 60)} ${JSON.stringify(opts)} (${lang})`;
        expect(wszystko, gdzie).not.toContain("{{");
        // Klucz bez treści wychodzi na stronę jako własna ścieżka słownika.
        expect(wszystko, gdzie).not.toMatch(/smallMultiples\.[a-z]/);
        expect(wszystko, gdzie).not.toMatch(/\ba11y\.[a-z]/);
        expect(wszystko, gdzie).not.toMatch(/\bframe\.[a-z]/);
      }
    }
  });

  it("uwaga o progu komfortu niesie LICZBĘ paneli i sam próg", () => {
    // Zdanie "paneli jest za dużo" bez liczby nie jest informacją, a przy
    // brakującej wstawce i18next wypisuje `{{count}}` wprost na stronę.
    const { container } = rysuj(
      {
        height: 640,
        categories: Array.from({ length: 13 }, (_, i) => `K${i}`),
        series: [{ name: "x", values: Array.from({ length: 13 }, (_, i) => i + 1) }],
      },
      { panelBy: "category" },
    );
    const tekst = nota(container, "reading.tooManyPanels");
    expect(tekst).toContain("13");
    expect(tekst).toContain("12");
  });
});

describe("SmallMultiplesChart - uczciwość: każde pole modelu wtedy i tylko wtedy", () => {
  it("commonScaleOk: osobne skale są NAZWANE, wspólne milczą", () => {
    // Panele z osobnymi osiami wyglądają IDENTYCZNIE jak panele ze wspólną,
    // a znaczą coś zupełnie innego. Bez tego komunikatu rysunek wygląda na
    // porównywalny, nie będąc - i to jest defekt, którego czytelnik nie ma
    // jak zauważyć.
    const wolna = rysuj({}, { scaleMode: "free" }).container;
    expect(nota(wolna, "honesty.commonScaleOk")).toContain("własną oś wartości");
    expect(
      wolna.querySelector("[data-note='honesty.commonScaleOk']")?.getAttribute("style") ?? "",
    ).toContain("--chart-negative-text");
    expect(nota(rysuj().container, "honesty.commonScaleOk")).toBe("");
  });

  it("freeScaleDeclaredOk: brak opisu to DEFEKT, opis jest WYPISANY", () => {
    const bezOpisu = rysuj({}, { scaleMode: "free" }).container;
    expect(nota(bezOpisu, "honesty.freeScaleDeclaredOk")).toContain("nie podał");
    const zOpisem = rysuj(
      {},
      { scaleMode: "free", freeScaleNote: "wskaźniki w różnych jednostkach" },
    ).container;
    expect(nota(zOpisem, "honesty.freeScaleDeclaredOk")).toBe("");
    // Opis autora MUSI być wypisany - model sprawdza tylko jego obecność, więc
    // render, który by go nie pokazał, zamieniłby defekt na milczenie.
    expect(nota(zOpisem, "scale.free")).toContain("wskaźniki w różnych jednostkach");
    // ...a przy wspólnej osi nie ma czego deklarować.
    expect(nota(rysuj().container, "honesty.freeScaleDeclaredOk")).toBe("");
  });

  it("OSOBNA SKALA JEST WIDOCZNA PRZY KAŻDYM PANELU, nie tylko pod siatką", () => {
    // Deklaracja pod rysunkiem to za mało: panele z osobnymi osiami czyta się
    // jak jeden wykres pocięty na kawałki, a czytelnik porównuje WZROKIEM, nie
    // czytając wcześniej przypisów. Dlatego każdy panel dostaje własne krańce
    // osi w polu rysunku (podziałki na brzegu siatki byłyby wtedy kłamstwem,
    // bo opisywałyby jeden panel, a wyglądały na opis wszystkich) oraz zdanie
    // o osobnej skali w swojej podpowiedzi.
    const { container } = rysuj({}, { scaleMode: "free", freeScaleNote: "różne jednostki" });
    const panele = all(container, "g[data-role='panel']");
    expect(panele).toHaveLength(3);
    expect(all(container, "[data-role='panel-axis']")).toHaveLength(3);
    // Podziałek wspólnej osi NIE MA, bo wspólnej osi nie ma.
    expect(all(container, "[data-role='value-tick']")).toHaveLength(0);
    for (const g of panele) {
      expect(g.querySelector("title")?.textContent ?? "").toContain("własną oś wartości");
    }
    // Przy osi wspólnej odwrotnie: podziałki są, a własnych osi nie ma.
    const wspolna = rysuj().container;
    expect(all(wspolna, "[data-role='panel-axis']")).toHaveLength(0);
    expect(all(wspolna, "[data-role='value-tick']").length).toBeGreaterThan(0);
  });

  it("sharedScaleReadableOk: spłaszczenie niesie LICZNIK, MIANOWNIK i iloraz poziomów", () => {
    // Mianownik nie jest liczbą paneli: model orzeka o panelach mających PO
    // DWIE wartości, bo z jednego punktu spłaszczenia nie da się orzec.
    // Podstawienie `panelCount` dałoby zdanie, w którym mianownik nie jest tą
    // liczbą, z której wyszedł licznik.
    const { container } = rysuj({
      series: [
        { name: "Wielki", values: [100, 400, 900, 1600] },
        { name: "Mały", values: [8, 9, 11, 12] },
        { name: "Mniejszy", values: [6, 7, 6, 9] },
      ],
    });
    const tekst = nota(container, "honesty.sharedScaleReadableOk");
    expect(tekst).toContain("2 z 3");
    // Iloraz poziomów jest tu liczbą, która TŁUMACZY spłaszczenie - "panele
    // różnią się poziomem 107-krotnie" mówi więcej niż udział osi. Pytamy
    // o WŁASNOŚĆ tej liczby, a nie o jej zapis: iloraz jest ilorazem poziomów,
    // więc podniesienie poziomu panelu najniższego DZIESIĘCIOKROTNIE musi
    // zmniejszyć go dziesięciokrotnie. Przepisana stała ("107") przeszłaby
    // także dla renderu, który wstawia w to miejsce dowolną inną liczbę
    // modelu - na przykład udział osi albo liczbę paneli.
    const iloraz = (t: string): number =>
      Number(
        (t.match(/poziomem ([\d\u00a0 ,.]+)-krotnie/)?.[1] ?? "")
          .replace(/[\u00a0\s.]/g, "")
          .replace(",", "."),
      );
    const dziesiecKrotnieWyzej = rysuj({
      series: [
        { name: "Wielki", values: [100, 400, 900, 1600] },
        { name: "Mały", values: [80, 90, 110, 120] },
        { name: "Mniejszy", values: [60, 70, 60, 90] },
      ],
    }).container;
    const a = iloraz(tekst);
    const b = iloraz(nota(dziesiecKrotnieWyzej, "honesty.sharedScaleReadableOk"));
    expect(a).toBeGreaterThan(1);
    expect(b).toBeGreaterThan(1);
    expect(a / b).toBeCloseTo(10, 0);
    expect(nota(rysuj().container, "honesty.sharedScaleReadableOk")).toBe("");
  });

  it("iloraz poziomów MILCZY, gdy po zaokrągleniu wychodzi jeden", () => {
    // "Panele różnią się poziomem 1-krotnie" znaczy "nie różnią się", czyli
    // tłumaczyłoby spłaszczenie czymś, czego nie ma: płaskie serie spłaszcza
    // rozsunięcie zakresu przez `niceScale`, a nie rozjazd poziomów.
    const { container } = rysuj({
      series: [
        { name: "A", values: [5, 5, 5, 5] },
        { name: "B", values: [5, 5, 5, 5] },
      ],
    });
    const tekst = nota(container, "honesty.sharedScaleReadableOk");
    expect(tekst).toContain("2 z 2");
    expect(tekst).not.toContain("1-krotnie");
  });

  it("sameUnitOk: z konfiguracji bloku ten defekt nie ma jak powstać", () => {
    // `ChartConfig` ma JEDNĄ jednostkę na cały wykres, więc przy panelach
    // z serii wszystkie panele mają tę samą jednostkę (`sameUnitOk` = true),
    // a przy panelach z kategorii żadnej (`null` - model MILCZY, zamiast
    // zaświadczać zgodność, której nie sprawdził). Ten test pilnuje kierunku
    // "tylko wtedy": komunikat o różnych jednostkach nie ma prawa pojawić się
    // pod rysunkiem, którego dane go nie uzasadniają.
    for (const opts of [undefined, { panelBy: "category" as const }]) {
      const { container } = rysuj({ unit: "%" }, opts);
      expect(nota(container, "honesty.sameUnitOk")).toBe("");
    }
  });

  it("emptyPanelsKeptOk: żądanie usunięcia pustych paneli jest ZGŁOSZONE", () => {
    const zZadaniem = rysuj(
      {
        series: [
          { name: "Polska", values: [10, 12, 14, 18] },
          { name: "Czechy", values: [null, null, null, null] },
        ],
      },
      { dropEmptyPanels: true },
    ).container;
    expect(nota(zZadaniem, "honesty.emptyPanelsKeptOk")).toContain("pominięcia");
    // Panel mimo żądania ZOSTAJE - model go nie usuwa, a render nie udaje, że
    // usunął.
    expect(all(zZadaniem, "[data-role='panel-field']")).toHaveLength(2);
    // Bez żądania pusty panel jest informacją, nie defektem.
    const bezZadania = rysuj({
      series: [
        { name: "Polska", values: [10, 12, 14, 18] },
        { name: "Czechy", values: [null, null, null, null] },
      ],
    }).container;
    expect(nota(bezZadania, "honesty.emptyPanelsKeptOk")).toBe("");
    expect(nota(bezZadania, "note.empty")).toContain("brak danych o tym podmiocie");
  });

  it("orderFromDataOk: kolejność arkusza jest NAZWANA", () => {
    const arkuszowa = rysuj({}, { order: "input" }).container;
    expect(nota(arkuszowa, "honesty.orderFromDataOk")).toContain("nie wynika z danych");
    expect(nota(arkuszowa, "order")).toBe("Panele stoją w kolejności arkusza.");
    expect(nota(rysuj().container, "honesty.orderFromDataOk")).toBe("");
  });

  it("inGridOk: liczby za ostatnią kategorią są POLICZONE i NAZWANE", () => {
    // Stan osiągalny tylko przez wywołującego, który OMIJA `parseChartConfig`
    // (parser buduje wartości serii dokładnie na liczbę kategorii, więc przez
    // blok CMS ta gałąź nie przechodzi). Render i tak musi o niej mówić: to
    // liczby, których nie ma ani na rysunku, ani w tabeli, a treść bloku
    // przychodzi z bazy i bywa z wersji edytora, której ten kod nie zna.
    const bazowa = cfg(BAZA);
    const { container } = render(
      <SmallMultiplesChart
        config={{
          ...bazowa,
          series: [seria("Polska", [10, 12, 14, 18, 20, 22]), seria("Czechy", [8, 9, 11, 12], 2)],
        }}
        lang="pl"
      />,
    );
    expect(nota(container, "honesty.inGridOk")).toContain("2");
    expect(nota(rysuj().container, "honesty.inGridOk")).toBe("");
  });

  it("inDomainOk: wartość przycięta do krawędzi panelu jest NAZWANA", () => {
    // Domena podana z zewnątrz (do porównywania kilku rysunków jedną skalą)
    // nie jest rozszerzana do danych - wartość poza nią leży na krawędzi
    // panelu, czyli tam, gdzie danych nie ma.
    const waska = rysuj({}, { domainMin: 10, domainMax: 14 }).container;
    expect(nota(waska, "honesty.inDomainOk")).toContain("przycięta");
    expect(nota(waska, "note.clamped")).toContain("krawędzi panelu");
    const szeroka = rysuj({}, { domainMin: 0, domainMax: 40 }).container;
    expect(nota(szeroka, "honesty.inDomainOk")).toBe("");
    expect(nota(szeroka, "note.clamped")).toBe("");
  });

  it("zeroBaselineOk: znacznik kodujący DŁUGOŚĆ bez zera w osi jest defektem", () => {
    const slupki = rysuj({}, { mark: "bar", domainMin: 10, domainMax: 20 }).container;
    expect(nota(slupki, "honesty.zeroBaselineOk")).toContain("nie obejmuje zera");
    // Ta sama domena przy LINII nie jest defektem (sekcja 8: "Dla liniowego
    // zero nie jest wymagane, ale ucięcie zaznacz") - i wtedy mówi o tym
    // `axisTruncated`, a nie komunikat o zerze.
    const linia = rysuj({}, { mark: "line", domainMin: 10, domainMax: 20 }).container;
    expect(nota(linia, "honesty.zeroBaselineOk")).toBe("");
    expect(nota(linia, "axisTruncated")).toContain("nie zaczyna się od zera");
  });

  it("indexBaseOk: panel bez bazy indeksu jest NAZWANY z nazwy", () => {
    // Panel bez użytecznej bazy nie ma w indeksie ani jednej linii, a panel
    // bez linii wśród paneli z liniami czyta się jako "brak zmian", nie jako
    // "brak bazy". Dlatego komunikat podaje NAZWY paneli, nie ich liczbę.
    const zeroWBazie = rysuj(
      {
        series: [
          { name: "Polska", values: [10, 12, 14, 18] },
          { name: "Czechy", values: [0, 9, 11, 12] },
        ],
      },
      { mode: "index" },
    ).container;
    expect(nota(zeroWBazie, "honesty.indexBaseOk")).toContain("Czechy");
    expect(nota(zeroWBazie, "note.noIndexBase")).toContain("kategorii bazowej");
    // Baza użyteczna w każdym panelu - model milczy.
    const zBaza = rysuj({}, { mode: "index" }).container;
    expect(nota(zBaza, "honesty.indexBaseOk")).toBe("");
    expect(nota(zBaza, "note.noIndexBase")).toBe("");
    // W trybie indeksu oś nazywa się INDEKSEM, nie wartością - inaczej
    // czytelnik odczytałby "112" jako poziom.
    expect(zBaza.querySelector("[data-role='axis-value']")?.textContent).toBe(
      "Indeks (baza = 100)",
    );
  });

  it("spreadOk: brak rozproszenia jest NAZWANY", () => {
    const plaskie = rysuj({
      series: [
        { name: "A", values: [5, 5, 5, 5] },
        { name: "B", values: [5, 5, 5, 5] },
      ],
    }).container;
    expect(nota(plaskie, "honesty.spreadOk")).toContain("nie ma zmiany");
    expect(nota(rysuj().container, "honesty.spreadOk")).toBe("");
  });

  it("declaredSampleOk: niezgodne `n` z podpisu jest DEFEKTEM z dwiema liczbami", () => {
    // Podpis mówi "n = 300", bo tyle pomiarów zebrano, a w arkuszu siedzi
    // dwanaście punktów: rysunek jest wtedy o innej próbce niż podpis.
    const zle = rysuj({ sampleSize: 300 }).container;
    expect(nota(zle, "honesty.declaredSampleOk")).toContain("300");
    expect(nota(zle, "honesty.declaredSampleOk")).toContain("12");
    expect(nota(rysuj({ sampleSize: 12 }).container, "honesty.declaredSampleOk")).toBe("");
  });

  it("paletteWrapOk: zawinięta paleta przy różnych slotach jest NAZWANA", () => {
    // Znowu stan spoza parsera (ten obcina serie do `MAX_SERIES`, a próg
    // zawinięcia to WIĘCEJ niż osiem paneli o różnych slotach). Render musi
    // o nim mówić, bo dwa panele w tym samym kolorze, nie będąc w żadnej
    // relacji, robią z koloru klucz, którym on nie jest.
    const bazowa = cfg(BAZA);
    const { container } = render(
      <SmallMultiplesChart
        config={{
          ...bazowa,
          series: Array.from({ length: MAX_SERIES + 1 }, (_, i) =>
            seria(`S${i}`, [i + 1, i + 2, i + 3, i + 4], (i % MAX_SERIES) + 1),
          ),
        }}
        lang="pl"
        options={{ keepPanelSlots: true }}
      />,
    );
    expect(nota(container, "honesty.paletteWrapOk")).toContain("slotów palety");
    // Wariant domyślny (jeden slot na wszystkie panele) nie ma czego zawijać.
    expect(nota(rysuj().container, "honesty.paletteWrapOk")).toBe("");
  });

  it("CZYSTY ARKUSZ dostaje same DEKLARACJE, ani jednego defektu", () => {
    // Uwaga, którą widać zawsze, uczy ignorowania wszystkich uwag - dlatego
    // pod rysunkiem bez defektu stoją wyłącznie dwa zdania o tym, co rysunek
    // TWIERDZI (wspólna oś, czym uporządkowane), a oba są tam, bo ŻADNEGO
    // z nich nie da się odczytać z obrazka. Zestaw obejmuje zero, więc nie ma
    // nawet uwagi o uciętej osi.
    const { container } = rysuj({
      series: [
        { name: "Polska", values: [0, 12, 14, 18] },
        { name: "Czechy", values: [8, 9, 11, 12] },
      ],
    });
    expect(uchwyty(container)).toEqual(["scale.shared", "order"]);
    for (const el of all(container, "[data-note]")) {
      expect(el.getAttribute("style") ?? "").not.toContain("--chart-negative-text");
    }
  });
});

describe("SmallMultiplesChart - przypadki brzegowe", () => {
  it("PUSTO nie renderuje niczego, nawet pustego <svg>", () => {
    const { container } = render(
      <SmallMultiplesChart config={cfg({ categories: [], series: [] })} lang="pl" />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("JEDNA OBSERWACJA jest widoczna jako KROPKA, bo odcinek bez długości nie istnieje", () => {
    // Defekt, który ten test wyłapuje, jest defektem PUSTEGO PANELU: ścieżka
    // z jednego punktu nie ma długości, więc panel z jedną wartością byłby
    // niewidoczny - a pusty panel znaczy w tej formie "brak danych o tym
    // podmiocie", czyli coś zupełnie innego.
    const { container } = rysuj({
      categories: ["a", "b", "c"],
      series: [
        { name: "Polska", values: [42, null, null] },
        { name: "Czechy", values: [8, 9, 11] },
      ],
    });
    const g = container.querySelector("g[data-panel-label='Polska']");
    expect(g?.querySelector("[data-role='panel-line']")).toBeNull();
    expect(g?.querySelectorAll("[data-role='panel-point']").length).toBe(1);
    expect(g?.querySelector("[data-role='panel-missing']")).toBeNull();
    expect(container.textContent ?? "").not.toContain("NaN");
  });

  it("SAME LUKI: panele zostają, bez wymyślonych podziałek", () => {
    // Domena pustego zestawu wychodzi z modelu jako 0..1, bo skala musi mieć
    // rozpiętość. Podpisane podziałki pod pustymi panelami niosłyby zakres,
    // którego w danych nie ma - to ten sam defekt, którego model odmawia
    // w `domenaWlasna` dla panelu pustego.
    const { container } = rysuj({
      categories: ["a", "b"],
      series: [
        { name: "A", values: [null, null] },
        { name: "B", values: [null, null] },
      ],
    });
    expect(all(container, "[data-role='panel-field']")).toHaveLength(2);
    expect(all(container, "[data-role='panel-missing']")).toHaveLength(2);
    expect(all(container, "[data-role='value-tick']")).toHaveLength(0);
    // Deklaracja wspólnej osi też nie - nie ma osi, o której dałoby się coś
    // powiedzieć; zostaje zdanie o pustych panelach.
    expect(uchwyty(container)).toEqual(["note.empty"]);
  });

  it("WSZYSTKIE WARTOŚCI RÓWNE nie dzielą przez zero", () => {
    const { container } = rysuj({
      series: [
        { name: "A", values: [5, 5, 5, 5] },
        { name: "B", values: [5, 5, 5, 5] },
      ],
    });
    expect(container.textContent ?? "").not.toContain("NaN");
    for (const el of all(container, "svg *")) {
      for (const attr of ["x", "y", "cx", "cy", "r", "width", "height", "d", "x1", "y1"]) {
        const v = el.getAttribute(attr);
        if (v === null) continue;
        expect(/NaN|Infinity/.test(v), `${attr}="${v}"`).toBe(false);
      }
    }
  });

  it("NIELICZBY I WARTOŚCI SKRAJNE nie docierają na ekran jako napisy", () => {
    // `Intl.NumberFormat.format(NaN)` zwraca literalny napis "NaN", a na
    // nieskończoności "∞"; bramka `blockMatrix.test.tsx` szuka ich
    // w `textContent` całej strony.
    for (const values of [
      [1, Number.NaN, Number.POSITIVE_INFINITY, 4],
      [5e307, 1e308, 1, 2],
      [-4, -9, -2, 0],
    ]) {
      const { container } = rysuj({
        series: [
          { name: "A", values },
          { name: "B", values: [2, 3, 4, 5] },
        ],
      });
      const tekst = container.textContent ?? "";
      for (const zly of ["NaN", "undefined", "Infinity", "∞", "[object Object]"]) {
        expect(tekst.includes(zly), `${zly} przy ${JSON.stringify(values)}`).toBe(false);
      }
    }
  });

  it("TRANSPOZYCJA: panelem jest kategoria, a osią nazwy serii", () => {
    // Ten sam arkusz czyta się dwiema drogami, bo w jednym podmioty stoją
    // w seriach, a w drugim w kategoriach - i to jest rozstrzygnięcie układu
    // arkusza, nie nowy rodzaj wykresu.
    const { container } = rysuj({}, { panelBy: "category" });
    expect(all(container, "[data-role='panel-label']").map((e) => e.textContent)).toEqual([
      "2022",
      "2021",
      "2020",
      "2019",
    ]);
    // Oś kategorii niesie teraz nazwy serii - pierwsza i ostatnia z nich.
    const etykiety = all(container, "[data-role='category-tick']").map((e) => e.textContent);
    expect(etykiety).toContain("Polska");
    expect(etykiety).toContain("Węgry");
  });
});

describe("SmallMultiplesChart - nazwa dostępna nie wymyśla osi", () => {
  it("BRAK JAKIEJKOLWIEK LICZBY: nazwa dostępna nie podaje zakresu osi", () => {
    // Defekt, który ten test wyłapuje, jest defektem WYMYŚLONEJ OSI i widać go
    // wyłącznie z czytnika ekranu: domena pustego zestawu wychodzi z modelu
    // jako 0..1 (skala musi mieć rozpiętość), więc nazwa dostępna niosła
    // zdanie "Wartość: 0 mld EUR - 1 mld EUR" o zestawie, w którym nie ma ANI
    // JEDNEJ liczby. Rysunek w tym samym stanie nie stawia ani jednej
    // podziałki - i to jest ta sama decyzja, więc oba odczyty muszą mówić to
    // samo.
    const { container } = rysuj({
      categories: ["a", "b"],
      series: [
        { name: "A", values: [null, null] },
        { name: "B", values: [null, null] },
      ],
    });
    const label = container.querySelector("[role='img']")?.getAttribute("aria-label") ?? "";
    expect(all(container, "[data-role='value-tick']")).toHaveLength(0);
    expect(label).not.toContain("Wartość:");
    expect(label).not.toContain("0 mld EUR");
    expect(label).not.toContain("1 mld EUR");
    // ...a panele nadal są opisane, razem z nazwaną pustką.
    expect(label).toContain("A: Obserwacje 0");
    expect(label).toContain("brak danych o tym podmiocie");
  });

  it("SKALE OSOBNE: nazwa dostępna nie podaje wspólnego zakresu, a KAŻDY panel podaje własny", () => {
    // Przy osobnych skalach wspólna domena jest policzona, ale nie opisuje
    // żadnego panelu - dlatego rysunek nie stawia podziałek na brzegu siatki,
    // tylko krańce osi przy KAŻDYM panelu. Nazwa dostępna podawała mimo to
    // wspólny zakres, czyli czytelnik ekranu dostawał jedyny zakres liczbowy
    // całego wykresu wzięty z osi, której na rysunku nie ma, i to tuż przed
    // zdaniem "każdy panel ma własną oś".
    const { container } = rysuj(
      {
        series: [
          { name: "Wielki", values: [100, 400, 900, 1600] },
          { name: "Mały", values: [8, 9, 11, 12] },
        ],
      },
      { scaleMode: "free", freeScaleNote: "różne rzędy wielkości" },
    );
    const label = container.querySelector("[role='img']")?.getAttribute("aria-label") ?? "";
    // Wspólna domena tego zestawu to 0-1800; żaden panel jej nie ma.
    expect(label).not.toContain("1 800");
    // Zakres osi pada dopiero PRZY PANELU, nigdy przed nim: pierwszy napis
    // "Wartość:" stoi za nazwą pierwszego panelu, a jest ich tyle, ile paneli.
    expect(label).toContain("Wielki: ");
    expect(label.indexOf("Wartość:")).toBeGreaterThan(label.indexOf("Wielki:"));
    expect(label.match(/Wartość:/g) ?? []).toHaveLength(2);
    // ...i są to krańce WŁASNEJ osi panelu, te same, które stoją przy nim
    // w `panel-axis` - inaczej czytelnik ekranu nie ma z czego odczytać
    // wysokości linii.
    expect(label).toContain("Wartość: 8 mld EUR - 12 mld EUR");
    const krance = all(container, "g[data-panel-label='Mały'] [data-role='panel-axis'] text").map(
      (e) => e.textContent,
    );
    expect(krance).toEqual(["12", "8"]);
    // Przy osi wspólnej odwrotnie: jeden zakres na cały rysunek, PRZED
    // panelami, i przy żadnym panelu z osobna.
    const wspolna =
      rysuj().container.querySelector("[role='img']")?.getAttribute("aria-label") ?? "";
    expect(wspolna).toContain("Wykres. Wartość: 5 mld EUR - 20 mld EUR");
    expect(wspolna.match(/Wartość:/g) ?? []).toHaveLength(1);
  });

  it("JEDNA KATEGORIA nie jest przedziałem", () => {
    // "Kategoria: 2020 - 2020" czyta się jak przedział, a jest punktem - ten
    // sam gatunek zdania co "panele różnią się poziomem 1-krotnie", które ten
    // render wycisza z tego samego powodu.
    const { container } = rysuj({
      categories: ["2020"],
      series: [
        { name: "A", values: [1] },
        { name: "B", values: [2] },
      ],
    });
    const label = container.querySelector("[role='img']")?.getAttribute("aria-label") ?? "";
    expect(label).toContain("Kategoria: 2020.");
    expect(label).not.toContain("2020 - 2020");
    // Forma jest wtedy zła i render to mówi wprost.
    expect(nota(container, "reading.oneCategory")).toContain("jeden punkt");
  });

  it("TYTUŁ wpisu wchodzi do nazwy dostępnej, brak tytułu daje nazwę rodzajową", () => {
    const zTytulem = rysuj({ title: "Handel zagraniczny" }).container;
    expect(zTytulem.querySelector("[role='img']")?.getAttribute("aria-label") ?? "").toContain(
      "Wykres: Handel zagraniczny.",
    );
    const bez = rysuj().container.querySelector("[role='img']")?.getAttribute("aria-label") ?? "";
    expect(bez.startsWith("Wykres.")).toBe(true);
  });
});

describe("SmallMultiplesChart - podziałka stoi tam, gdzie wartość", () => {
  it("DOMENA BEZ ROZPIĘTOŚCI: podziałka leży na wysokości kropki, nie na dolnej krawędzi", () => {
    // Domena podana z zewnątrz NIE przechodzi przez `niceScale` (autor podał
    // ją dokładnie), więc `domainMin === domainMax` daje rozpiętość zero.
    // Model stawia wtedy każdy punkt w POŁOWIE wysokości panelu, bo dolna
    // i górna krawędź znaczą to samo. Render liczył pozycję podziałki własnym
    // wzorem bez tej osłony: dzielenie przez zero schodziło przez `finite` na
    // DOLNĄ krawędź pola, więc podpis "5" stał 56 px pod kropką o wartości 5.
    // Czytelnik odmierzający kropkę tą podziałką odczytywał liczbę, której
    // w danych nie ma.
    const { container } = rysuj({ showGrid: true }, { domainMin: 5, domainMax: 5 });
    const p = pole(container, "Polska");
    const gora = num(p, "y");
    const dol = gora + num(p, "height");
    const kropki = all(container, "g[data-panel-label='Polska'] [data-role='panel-point']");
    expect(kropki.length).toBeGreaterThan(0);
    const podzialki = all(container, "g[data-panel-label='Polska'] [data-role='value-tick']");
    expect(podzialki.length).toBeGreaterThan(0);
    for (const t of podzialki) {
      // Podziałka opisuje wartość 5, a wartość 5 leży w połowie wysokości.
      expect(t.textContent).toBe("5");
      expect(num(t, "y")).toBeGreaterThan(gora + 10);
      expect(num(t, "y")).toBeLessThan(dol - 10);
    }
    // ...i leży dokładnie tam, gdzie kropka (z dokładnością do zejścia linii
    // bazowej tekstu do środka wiersza).
    const cy = num(kropki[0], "cy");
    const ty = num(podzialki[0], "y");
    expect(Math.abs(ty - cy)).toBeLessThanOrEqual(4);
    // Siatka idzie tym samym wzorem co podziałka - inaczej linia siatki
    // biegłaby pod podpisem, który ją nazywa.
    const siatka = all(container, "g[data-panel-label='Polska'] line[stroke='var(--chart-grid)']")
      .map((l) => num(l, "y1"))
      .filter((y) => y < dol);
    expect(siatka.length).toBeGreaterThan(0);
    for (const y of siatka) expect(Math.abs(y - cy)).toBeLessThanOrEqual(0.5);
  });

  it("PODZIAŁKA SPOZA DOMENY nie jest rysowana", () => {
    // `niceScale` liczy podziałki ZAOKRĄGLONE na zewnątrz podanego zakresu,
    // więc przy domenie 10,5-13,5 model oddaje podziałki 10..14. Podziałka 10
    // narysowana w panelu o domenie od 10,5 stałaby POD dolną krawędzią pola,
    // czyli opisywałaby miejsce, którego panel nie pokazuje.
    const { container } = rysuj({ showGrid: true }, { domainMin: 10.5, domainMax: 13.5 });
    const p = pole(container, "Polska");
    const gora = num(p, "y");
    const dol = gora + num(p, "height");
    const podzialki = all(container, "g[data-panel-label='Polska'] [data-role='value-tick']");
    expect(podzialki.map((t) => t.textContent)).toEqual(["11", "12", "13"]);
    for (const t of podzialki) {
      expect(num(t, "y")).toBeGreaterThanOrEqual(gora);
      expect(num(t, "y")).toBeLessThanOrEqual(dol + 4);
    }
  });
});

describe("SmallMultiplesChart - etykieta bezpośrednia stoi nad swoim pomiarem", () => {
  it("ETYKIETA idzie za OSTATNIM POMIAREM, a nie za prawą krawędzią panelu", () => {
    // Defekt, który ten test wyłapuje: etykieta przypięta do prawej krawędzi
    // pola. Szereg urwany lukami (10, 12, brak, brak) pokazywał wtedy "12"
    // nad ostatnią kategorią, czyli nad okresem, którego NIE ZMIERZONO -
    // a pozycja etykiety bezpośredniej jest twierdzeniem o tym, kiedy ta
    // liczba obowiązuje.
    const { container } = rysuj({
      showValues: true,
      series: [
        { name: "Polska", values: [10, 12, null, null] },
        { name: "Czechy", values: [8, 9, 11, 12] },
      ],
    });
    const g = container.querySelector("g[data-panel-label='Polska']");
    const etykieta = g?.querySelector("[data-role='panel-value']");
    const ostatniaKropka = kropka(container, "Polska", 1);
    if (!etykieta) throw new Error("brak etykiety");
    expect(etykieta.textContent).toBe("12 mld EUR");
    expect(num(etykieta, "x")).toBeCloseTo(num(ostatniaKropka, "cx"), 6);
    // Prawa krawędź pola jest daleko - etykieta nie ma prawa tam stać.
    const p = pole(container, "Polska");
    expect(num(etykieta, "x")).toBeLessThan(num(p, "x") + num(p, "width") - 50);
    // Panel pełny ma etykietę dokładnie przy ostatniej kategorii, czyli na
    // prawej krawędzi - i to nadal musi być prawdą.
    const czechy = container.querySelector("g[data-panel-label='Czechy']");
    const etCzechy = czechy?.querySelector("[data-role='panel-value']");
    expect(num(etCzechy!, "x")).toBeCloseTo(num(kropka(container, "Czechy", 3), "cx"), 6);
  });

  it("ETYKIETA przy pomiarze w pierwszej kategorii nie wychodzi poza pole panelu", () => {
    // Kotwica "end" postawiona na lewej krawędzi pola wysunęłaby napis w lewo,
    // czyli w kolumnę podziałek albo w panel sąsiada. Napis, który wjeżdża
    // w cudzą oś, czyta się jako jej podpis.
    const { container } = rysuj({
      showValues: true,
      series: [
        { name: "Polska", values: [42, null, null, null] },
        { name: "Czechy", values: [8, 9, 11, 12] },
      ],
    });
    const g = container.querySelector("g[data-panel-label='Polska']");
    const etykieta = g?.querySelector("[data-role='panel-value']");
    if (!etykieta) throw new Error("brak etykiety");
    const p = pole(container, "Polska");
    expect(etykieta.getAttribute("text-anchor")).toBe("start");
    expect(num(etykieta, "x")).toBeGreaterThanOrEqual(num(p, "x"));
  });
});

describe("SmallMultiplesChart - podpisy kategorii się nie nakładają", () => {
  it("ŻADNE DWA PODPISY NIE ZACHODZĄ NA SIEBIE, a pierwszy i ostatni zostają", () => {
    // Reguła "co n-tą, a ostatnia ZAWSZE" nakłada napisy na siebie i to nie
    // teoretycznie: dwadzieścia kategorii w panelu 330 px daje krok 5, więc
    // podpis kategorii szesnastej (kotwiczony środkiem) wchodził 32 px
    // w podpis kategorii dwudziestej (kotwiczony końcem). Dwa napisy jeden na
    // drugim nie są etykietą, tylko plamą - a czytelnik nie ma jak zgadnąć,
    // który okres opisuje który koniec osi.
    const kategorie = Array.from({ length: 20 }, (_, i) => `Kwartał ${i + 1}`);
    const { container } = rysuj({
      categories: kategorie,
      series: [
        { name: "A", values: kategorie.map((_, i) => i + 1) },
        { name: "B", values: kategorie.map((_, i) => 20 - i) },
      ],
    });
    const wszystkie = all(container, "[data-role='category-tick']");
    const teksty = wszystkie.map((e) => e.textContent ?? "");
    expect(teksty).toContain("Kwartał 1");
    expect(teksty).toContain("Kwartał 20");
    // Pola tekstu liczone z kotwicy i szerokości napisu - to jest ta sama
    // heurystyka, z której render wylicza krok, ale sprawdzana na WYNIKU:
    // pytamy o rozdzielność pól, a nie o powtórzenie wzoru.
    for (const g of all(container, "g[data-role='panel']")) {
      const wPanelu = [...g.querySelectorAll("[data-role='category-tick']")];
      const pola = wPanelu.map((e) => {
        const x = num(e, "x");
        const w = estimateLabelWidth(e.textContent ?? "", FONT_AXIS);
        const kotwica = e.getAttribute("text-anchor");
        const lewo = kotwica === "start" ? x : kotwica === "end" ? x - w : x - w / 2;
        return [lewo, lewo + w] as const;
      });
      pola.sort((a, b) => a[0] - b[0]);
      for (let i = 1; i < pola.length; i++) {
        expect(
          pola[i][0] >= pola[i - 1][1],
          `podpisy ${wPanelu[i - 1]?.textContent} i ${wPanelu[i]?.textContent} zachodzą na siebie`,
        ).toBe(true);
      }
    }
  });

  it("PODPIS UCIĘTY niesie pełną treść w podpowiedzi, podpis pełny jej nie powtarza", () => {
    // Sekcja 4 zabrania wielokropka bez podpowiedzi: napis ucięty krawędzią
    // bez sposobu na dojście do pełnej treści jest danymi, których nie ma.
    const dlugie = [
      "Pierwszy kwartał roku dwutysięcznego dwudziestego",
      "b",
      "c",
      "Ostatni kwartał roku dwutysięcznego dwudziestego drugiego",
    ];
    const { container } = rysuj({
      categories: dlugie,
      series: [
        { name: "A", values: [1, 2, 3, 4] },
        { name: "B", values: [4, 3, 2, 1] },
      ],
    });
    const uciete = all(container, "[data-role='category-tick']").filter((e) =>
      (e.textContent ?? "").includes("…"),
    );
    expect(uciete.length).toBeGreaterThan(0);
    for (const e of uciete) {
      const tytul = e.querySelector("title")?.textContent ?? "";
      expect(dlugie).toContain(tytul);
    }
    // Podpis panelu rządzi się tą samą regułą - pełna nazwa idzie do
    // podpowiedzi panelu.
    const dlugaNazwa = "Rzeczpospolita Polska w granicach obecnych i historycznych";
    const drugi = rysuj({
      series: [
        { name: dlugaNazwa, values: [10, 12, 14, 18] },
        { name: "Czechy", values: [8, 9, 11, 12] },
      ],
    }).container;
    const podpis = all(drugi, "[data-role='panel-label']").map((e) => e.textContent ?? "");
    expect(podpis.some((s) => s.endsWith("…"))).toBe(true);
    expect(
      drugi.querySelector(`g[data-panel-label='${dlugaNazwa}'] title`)?.textContent ?? "",
    ).toContain(dlugaNazwa);
  });
});

describe("SmallMultiplesChart - siatka bierze liczbę kolumn Z MODELU", () => {
  it("PANELE PONIŻEJ PROGU: render bierze podpowiedź modelu, także gdy znaczy WIĘCEJ kolumn", () => {
    // Sześć paneli na płycie 160 px daje przy siatce z proporcji trzy kolumny
    // i dwa rzędy, czyli komórkę 56 px wysokości - poniżej progu
    // `SMALL_MULTIPLES_MIN_PANEL_H`. Wysokość odzyskuje się ZMNIEJSZENIEM
    // LICZBY RZĘDÓW, czyli zwiększeniem liczby kolumn, i dokładnie to podaje
    // `smallMultiplesFit.suggestedColumns` (6). Render, który miałby tu własne
    // zdanie o kierunku ("zawsze mniej kolumn"), nie narysowałby nic.
    const { container } = rysuj({
      height: 160,
      series: Array.from({ length: 6 }, (_, i) => ({
        name: `S${i}`,
        values: [i + 1, i + 2, i + 3, i + 4],
      })),
    });
    const pola = all(container, "[data-role='panel-field']");
    expect(pola).toHaveLength(6);
    // Jeden rząd: wszystkie panele na tej samej wysokości, każdy szerszy niż
    // próg 96 px.
    expect(new Set(pola.map((p) => num(p, "y"))).size).toBe(1);
    for (const p of pola) expect(num(p, "width")).toBeGreaterThanOrEqual(96);
    // Wymuszenia autora render NIE nadpisuje, nawet gdy skutkuje brakiem
    // rysunku - kto podał liczbę kolumn, ten dostaje swoją.
    const wymuszone = rysuj(
      {
        height: 160,
        series: Array.from({ length: 6 }, (_, i) => ({
          name: `S${i}`,
          values: [i + 1, i + 2, i + 3, i + 4],
        })),
      },
      { columns: 3 },
    ).container;
    expect(all(wymuszone, "[data-role='panel-field']")).toHaveLength(0);
    expect(uchwyty(wymuszone)).toContain("order");
  });
});

describe("SmallMultiplesChart - wskaźnik i stan czynny", () => {
  it("STUKNIĘCIE ustawia panel czynny, zejście MYSZĄ go gasi, a DOTYK nie", () => {
    // Palec schodzi z ekranu po każdym stuknięciu, więc gaszenie dymka przy
    // opuszczeniu warstwy trafień zgasiłoby go na dotyku ZAWSZE, natychmiast
    // po pokazaniu. Mysz odwrotnie: kursor zsunięty z rysunku musi dymek
    // zabrać, bo inaczej zostaje na ekranie nad niczym.
    const { container } = rysuj();
    const hit = container.querySelector("rect.neh-hit");
    if (!hit) throw new Error("brak warstwy trafień");
    stubPlotRect(hit, 676, 272);
    fireEvent.pointerDown(hit, { clientX: 100, clientY: 60 });
    expect(container.querySelector(".neh-tooltip")?.textContent ?? "").toContain("Polska");
    fireEvent.pointerLeave(hit, { pointerType: "touch" });
    expect(container.querySelector(".neh-tooltip")).not.toBeNull();
    fireEvent.pointerLeave(hit, { pointerType: "mouse" });
    expect(container.querySelector(".neh-tooltip")).toBeNull();
  });

  it("WSKAŹNIK POZA SIATKĄ i płyta BEZ WYMIARU nie wskazują żadnego panelu", () => {
    // Dwa stany, w których arytmetyka trafienia daje NaN albo liczbę spoza
    // siatki: płyta niezmierzona (SSR, happy-dom, kontener bez rozmiaru)
    // i wskaźnik poza polem. Oba muszą kończyć się BRAKIEM wskazania, a nie
    // dymkiem nad przypadkowym panelem.
    const { container } = rysuj();
    const hit = container.querySelector("rect.neh-hit");
    if (!hit) throw new Error("brak warstwy trafień");
    // Bez podmiany `getBoundingClientRect` happy-dom oddaje zera.
    fireEvent.pointerMove(hit, { clientX: 100, clientY: 60 });
    expect(container.querySelector(".neh-tooltip")).toBeNull();
    stubPlotRect(hit, 676, 272);
    fireEvent.pointerMove(hit, { clientX: 5000, clientY: 60 });
    expect(container.querySelector(".neh-tooltip")).toBeNull();
    expect(container.querySelector("g[data-role='panel'][data-active='true']")).toBeNull();
  });

  it("UTRATA FOKUSU gasi panel czynny", () => {
    // Zaznaczenie, które zostaje po odejściu z wykresu, wygląda na stan
    // strony, a nie na ślad czytania - i następny czytelnik zastaje panel
    // podświetlony bez powodu.
    const { container } = rysuj();
    const box = container.querySelector<HTMLElement>("[role='img']");
    if (!box) throw new Error("brak kontenera");
    fireEvent.keyDown(box, { key: "ArrowRight" });
    expect(container.querySelector("g[data-active='true']")).not.toBeNull();
    fireEvent.blur(box);
    expect(container.querySelector("g[data-active='true']")).toBeNull();
  });

  it("STRZAŁKA W LEWO z pustego stanu bierze panel OSTATNI, w górę wraca kolumną", () => {
    // Wejście strzałką wstecz musi zaczynać od KOŃCA porządku, a nie od jego
    // początku - inaczej "w lewo" z pustego stanu i "w prawo" z pustego stanu
    // dawałyby ten sam panel, czyli jedna z tych strzałek nic by nie znaczyła.
    const { container } = rysuj();
    const box = container.querySelector<HTMLElement>("[role='img']");
    if (!box) throw new Error("brak kontenera");
    const czynny = (): string | null =>
      container
        .querySelector("g[data-role='panel'][data-active='true']")
        ?.getAttribute("data-panel-label") ?? null;
    fireEvent.keyDown(box, { key: "ArrowLeft" });
    expect(czynny()).toBe("Węgry"); // ostatni panel porządku
    fireEvent.keyDown(box, { key: "ArrowUp" });
    expect(czynny()).toBe("Polska"); // ta sama kolumna, rząd wyżej
    fireEvent.keyDown(box, { key: "ArrowUp" });
    expect(czynny()).toBe("Polska"); // kraniec PRZYCINAMY, nie zawijamy
  });

  it("ZMIANA DANYCH pod czynnym panelem nie zostawia dymka nad nieistniejącym", () => {
    // Stan czynny przeżywa zmianę propsów (to ten sam komponent), więc po
    // wymianie arkusza na krótszy indeks czynnego panelu wskazuje poza siatkę.
    // Bez osłony dymek czytałby wtedy z `undefined`, a rysunek znikałby przy
    // przewijaniu strony z podmienionymi danymi.
    const { container, rerender } = rysuj();
    const box = container.querySelector<HTMLElement>("[role='img']");
    if (!box) throw new Error("brak kontenera");
    fireEvent.keyDown(box, { key: "ArrowRight" });
    fireEvent.keyDown(box, { key: "ArrowRight" });
    fireEvent.keyDown(box, { key: "ArrowRight" });
    expect(container.querySelector("g[data-active='true']")).not.toBeNull();
    rerender(
      <SmallMultiplesChart
        config={cfg({
          ...BAZA,
          series: [
            { name: "Polska", values: [10, 12, 14, 18] },
            { name: "Czechy", values: [8, 9, 11, 12] },
          ],
        })}
        lang="pl"
      />,
    );
    expect(all(container, "[data-role='panel-field']")).toHaveLength(2);
    expect(container.querySelector(".neh-tooltip")).toBeNull();
    expect(container.textContent ?? "").not.toContain("undefined");
  });
});

describe("SmallMultiplesChart - znacznik decyduje o zerze i o kropkach", () => {
  it("POLE (area) jest zamknięte NA ZERZE, a zero jest podpisane", () => {
    // Znacznik kodujący POWIERZCHNIĘ wymaga zera w osi (sekcja 8), bo pole
    // liczone od dowolnej dolnej krawędzi ma powierzchnię proporcjonalną do
    // niczego. Test pilnuje, że domknięcie ścieżki leży na tej samej
    // wysokości, co podziałka "0".
    const { container } = rysuj({}, { mark: "area" });
    const pola = all(container, "[data-role='panel-area']");
    expect(pola.length).toBeGreaterThan(0);
    const podzialki = all(container, "g[data-panel-label='Polska'] [data-role='value-tick']");
    const zero = podzialki.find((t) => t.textContent === "0");
    if (!zero) throw new Error("brak podziałki zera");
    const d = pola[0].getAttribute("d") ?? "";
    const liczby = [...d.matchAll(/[ML]([\d.-]+) ([\d.-]+)/g)].map((m) => Number(m[2]));
    const podstawa = liczby[0];
    expect(liczby[liczby.length - 1]).toBeCloseTo(podstawa, 6);
    expect(podstawa).toBeCloseTo(num(zero, "y") - 3.5, 1);
    // Linia jest rysowana także przy polu - pole bez obrysu gubi przebieg
    // w miejscu, w którym dwa panele mają tę samą wysokość.
    expect(all(container, "[data-role='panel-line']").length).toBeGreaterThan(0);
  });

  it("SZEREG GĘSTY nie dostaje kropek, ale punkt OSAMOTNIONY dostaje zawsze", () => {
    // Kropka przy każdym pomiarze zlewa się w pasek przy gęstości powyżej
    // progu - ale odcinek z JEDNEGO pomiaru nie ma długości, więc bez kropki
    // panel byłby pusty, a pusty panel znaczy w tej formie "brak danych o tym
    // podmiocie".
    const kategorie = Array.from({ length: 25 }, (_, i) => `K${i}`);
    const { container } = rysuj({
      categories: kategorie,
      series: [
        { name: "Gęsty", values: kategorie.map((_, i) => i + 1) },
        { name: "Jeden", values: kategorie.map((_, i) => (i === 0 ? 12 : null)) },
      ],
    });
    const gesty = container.querySelector("g[data-panel-label='Gęsty']");
    expect(gesty?.querySelectorAll("[data-role='panel-point']").length).toBe(0);
    expect(gesty?.querySelector("[data-role='panel-line']")).not.toBeNull();
    const jeden = container.querySelector("g[data-panel-label='Jeden']");
    expect(jeden?.querySelectorAll("[data-role='panel-point']").length).toBe(1);
    expect(jeden?.querySelector("[data-role='panel-line']")).toBeNull();
  });
});

describe("SmallMultiplesChart - słownik ma treść dla KAŻDEJ ścieżki z tego renderu", () => {
  it("każda ścieżka słownika wypisana w źródle renderu ma treść w PL I W EN", () => {
    // Klucz bez treści nie jest błędem kompilacji: i18next oddaje wtedy WŁASNĄ
    // NAZWĘ KLUCZA, więc na stronie publicznej staje napis
    // "smallMultiples.note.gap". Obie bramki słownikowe silnika szukają bloku
    // wzorcem `\n    ${kind}: {`, a blok tego rodzaju nazywa się `smallMultiples`,
    // gdy rodzaj nazywa się `small-multiples` - i przez to OBIE ten rodzaj
    // pomijają (zgłoszone osobno, pliki bramek są poza zakresem tej pracy).
    // Do czasu ich naprawy to jest jedyne miejsce, które pilnuje parytetu
    // treści dla paneli, więc lista kluczy NIE jest tu przepisana ręcznie:
    // czytamy ją ze ŹRÓDŁA renderu.
    const zrodlo = readFileSync("src/components/charts/SmallMultiplesChart.tsx", "utf8");
    const sciezki = [
      ...new Set(
        [...zrodlo.matchAll(/"((?:smallMultiples|a11y|frame)\.[A-Za-z.]+)"/g)].map((m) => m[1]),
      ),
    ];
    // Gdyby wyrażenie przestało cokolwiek znajdować, test byłby zielony,
    // nie sprawdzając niczego - stąd podłoga na liczbie ścieżek.
    expect(sciezki.length).toBeGreaterThan(40);
    for (const sciezka of sciezki) {
      for (const lng of ["pl", "en"] as const) {
        // Klucz z formami liczebnika stoi w słowniku pod `_one`/`_few`/`_many`,
        // a render woła nazwę bazową - `exists` na samej bazie zwraca `false`.
        expect(
          maTresc((k) => i18n.exists(k, { lng }), `charts.${sciezka}`),
          `${sciezka} (${lng})`,
        ).toBe(true);
      }
    }
  });

  it("KAŻDY z sześciu porządków paneli ma zdanie, a nie ścieżkę słownika", () => {
    // Kolejność paneli jest w tej formie nośnikiem informacji, więc zdanie
    // o niej stoi pod rysunkiem ZAWSZE. Unia ma sześć wartości i mapa
    // `ORDER_KEYS` musi mieć sześć treści - brak jednej wychodzi surową
    // ścieżką w miejscu, w którym czytelnik szuka klucza do pierwszego rzędu.
    for (const order of ["mean", "max", "span", "last", "label", "input"] as const) {
      const { container } = rysuj({}, { order });
      const tekst = nota(container, "order");
      expect(tekst, order).not.toMatch(/smallMultiples\./);
      expect(tekst.length, order).toBeGreaterThan(10);
      // Ta sama treść musi być w nazwie dostępnej - czytelnik ekranu nie widzi
      // uwag pod rysunkiem przed samym rysunkiem.
      expect(
        container.querySelector("[role='img']")?.getAttribute("aria-label") ?? "",
        order,
      ).toContain(tekst);
    }
  });
});
