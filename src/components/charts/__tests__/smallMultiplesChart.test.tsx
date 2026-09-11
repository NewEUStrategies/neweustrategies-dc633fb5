// SMALL MULTIPLES - CO MUSI BYĆ PRAWDĄ O SIATCE PANELI.
//
// KONFIGURACJA BEZ KLUCZA `kind`, i to jest świadome: model paneli czyta
// `categories` i `series`, a nie `config.kind` (`grep -n "config.kind"
// src/lib/charts/kinds/smallMultiples.ts` nie zwraca nic), więc rodzaj
// w konfiguracji nie ma tu żadnego znaczenia - rodzaj "small-multiples" nie
// jest jeszcze w `CHART_KINDS`, a podlaczenia rozdzielnika pilnuje osobna
// bramka `everyKindRenders.test.tsx`.
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
import { fireEvent, render } from "@testing-library/react";
import type { Json } from "@/lib/content-model/json";
import { parseChartConfig } from "@/lib/charts/parse";
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
    ];
    for (const [dane, opts] of przypadki) {
      for (const lang of ["pl", "en"] as const) {
        const { container } = rysuj(dane, opts, lang);
        for (const el of all(container, "[data-note]")) {
          const tekst = el.textContent ?? "";
          expect(tekst, `${el.getAttribute("data-note")} (${lang})`).not.toContain("{{");
          expect(tekst, `${el.getAttribute("data-note")} (${lang})`).not.toMatch(
            /smallMultiples\.[a-z]/,
          );
        }
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
    // różnią się poziomem 107-krotnie" mówi więcej niż udział osi.
    expect(tekst).toMatch(/107/);
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
    // Znowu stan spoza parsera (ten obcina serie do `MAX_SERIES` = 8, a próg
    // zawinięcia to WIĘCEJ niż osiem paneli o różnych slotach). Render musi
    // o nim mówić, bo dwa panele w tym samym kolorze, nie będąc w żadnej
    // relacji, robią z koloru klucz, którym on nie jest.
    const bazowa = cfg(BAZA);
    const { container } = render(
      <SmallMultiplesChart
        config={{
          ...bazowa,
          series: Array.from({ length: 9 }, (_, i) =>
            seria(`S${i}`, [i + 1, i + 2, i + 3, i + 4], (i % 8) + 1),
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
