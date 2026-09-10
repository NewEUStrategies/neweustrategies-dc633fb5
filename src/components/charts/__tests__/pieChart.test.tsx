// Wykres kołowy / pierścieniowy (`src/components/charts/PieChart.tsx`) -
// pierwszy test tego pliku poza jednym przebiegiem `Chart.a11y.test.tsx`.
//
// PO CO. Tarcza kołowa jest jedynym znacznikiem w silniku, w którym KĄT niesie
// wartość, a etykieta leży WEWNĄTRZ wypełnienia. Obie te cechy dają klasę
// defektów, której nie widać na oko: wykres nadal jest okrągły, kolorowy
// i podpisany, tylko udziały są policzone z innego mianownika niż tekst obok,
// albo etykieta stoi w wycinku innego koloru niż jej tło.
//
// KONKRETNIE ŁAPIEMY:
//   * mianownik udziału. Model tarczy (`pieModel`) odsiewa `null`, zero
//     i wartości UJEMNE przed sumowaniem, więc suma to suma DODATNICH -
//     i tym SAMYM mianownikiem liczy udziały tabela danych w `Chart.tsx`.
//     Pilnujemy, żeby zestaw z wartością ujemną nie dawał grafiki i jej
//     alternatywy tekstowej z dwoma różnymi udziałami;
//   * dzielenie przez zero. Zestaw z samymi zerami MUSI zniknąć przed
//     geometrią, a nie wyprodukować tarczy z `NaN` w ścieżkach;
//   * łuk 100%. Jeden wycinek zamyka pełny obrót; gdyby oba końce łuku wypadły
//     IDENTYCZNE, SVG pomija segment i cała tarcza znika (spec: "if the
//     endpoints are identical ... equivalent to omitting the arc");
//   * slot palety. Etykieta bierze `--chart-ink-N` z TEGO SAMEGO N co
//     wypełnienie - rozjazd numeru daje czarny tekst na granacie. Do tego
//     nadmiar kategorii nie może zawijać palety na `--chart-1` (kolor
//     przestałby identyfikować wycinek) ani wypadać z mianownika - schodzi do
//     jednego wycinka zbiorczego w ostatnim slocie;
//   * kontrast pary wypełnienie/etykieta w OBU motywach - liczony wprost
//     z `src/styles.css`, bo happy-dom nie ma silnika stylów, a reguła
//     `color-contrast` w axe jest z tego powodu wyłączona;
//   * alternatywę tekstową. Sam `PieChart` rysuje tylko grafikę; tabela
//     i legenda mieszkają w `ChartFrame`, więc dostępność dowodzimy przez
//     `Chart` - dokładnie tak, jak montuje ją blok CMS i widget buildera;
//   * stan interakcji przeżywający podmianę configu - wektor wycieku danych
//     między przestrzeniami roboczymi.
//
// SKĄD BIORĘ LICZBY. `useContainerWidth` czyta `clientWidth`, w happy-dom
// zerowe, więc szerokość zostaje na starcie 720 px. Domyślna wysokość z
// `parse.ts` to 320 px. Stąd: cx = 360, cy = 160,
// rOuter = min(720, 320) / 2 - 12 = 148, rInner (donut) = 0,62 * 148 = 91,76.
// `useRevealOnScroll` nie dostaje callbacku IntersectionObservera, więc stan
// to zawsze "static" - czyli to, co widzi crawler i czytelnik bez JS.
//
// I18N. Jedyny klucz słownika komponentu to podpis sumy w pierścieniu
// ("Suma" / "Total") - sprawdzany w obu językach. Reszta tekstu widocznego
// dla użytkownika to liczby z `Intl` (pl-PL / en-GB) i etykiety z configu,
// więc "oba języki" znaczy tu: te same dane dają ODMIENNE, poprawne napisy.
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import type { Json } from "@/lib/content-model/json";
import { parseChartConfig } from "@/lib/charts/parse";
import type { ChartConfig } from "@/lib/charts/types";
import { MAX_SERIES, PIE_MAX_SLICES } from "@/lib/charts/types";
import { ARC_GAP_PX } from "@/lib/charts/geometry";
import { axeViolations, summarize } from "@/test/axe";
import { PieChart } from "../PieChart";
import { Chart } from "../Chart";

/** Konfiguracja tą samą drogą, którą idzie blok CMS / widget buildera. */
function cfg(data: Record<string, Json>): ChartConfig {
  return parseChartConfig(data);
}

// Geometria wyliczona z harnessu - patrz nagłówek pliku.
const CX = 360;
const CY = 160;
const R_OUTER = 148;
const R_INNER = 91.76;

const SEL = {
  slice: "g.neh-pie-group path",
  label: "g.neh-pie-group text",
  center: "g.neh-fade text",
  tooltip: ".neh-tooltip",
  value: "text.neh-pie-value",
} as const;

/**
 * Kąty początku i końca ZEWNĘTRZNEGO łuku, odczytane wprost ze ścieżki.
 *
 * Testy geometrii tarczy porównywały wcześniej cały ciąg `d` ze wzorcem
 * wpisanym w test. Po wprowadzeniu przerwy kątowej 2,5 px wzorzec przestał
 * być czytelny (końce łuku wypadają na niecałkowitych współrzędnych), a co
 * ważniejsze: był tautologią - przepisywał wynik implementacji, zamiast
 * sprawdzać WŁASNOŚĆ, której wymaga specyfikacja. Kąty pozwalają sprawdzić
 * to, o co naprawdę chodzi: gdzie łuk się zaczyna, gdzie kończy i ile
 * pikseli mierzy szczelina między sąsiadami.
 */
function outerArc(path: string): { a0: number; a1: number } {
  const n = (path.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  // Koło: "M cx cy L x0 y0 A r r 0 f 1 x1 y1 Z" - punkty na 2-3 i 9-10.
  // Pierścień: "M x0 y0 A r r 0 f 1 x1 y1 L ..." - punkty na 0-1 i 7-8.
  const kolo = path.startsWith(`M${CX} ${CY} L`);
  const [x0, y0] = kolo ? [n[2], n[3]] : [n[0], n[1]];
  const [x1, y1] = kolo ? [n[9], n[10]] : [n[7], n[8]];
  return { a0: Math.atan2(y0 - CY, x0 - CX), a1: Math.atan2(y1 - CY, x1 - CX) };
}

/**
 * Różnica kątów zwinięta do (-pi, pi]. `atan2` zwraca kąt z tego zakresu, więc
 * granica wypadająca na godzinie dziewiątej jest raz odczytywana jako +pi,
 * a raz jako -pi - bez zwinięcia szczelina między tymi dwoma łukami wychodzi
 * jako pełny obrót ze znakiem minus.
 */
const roznicaKatow = (a: number, b: number): number =>
  ((a - b + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;

const all = (root: HTMLElement, sel: string): Element[] => [...root.querySelectorAll(sel)];
const slices = (root: HTMLElement): Element[] => all(root, SEL.slice);
const d = (el: Element | undefined): string => el?.getAttribute("d") ?? "";
const num = (el: Element | undefined, attr: string): number => Number(el?.getAttribute(attr));
const tip = (root: HTMLElement): Element | null => root.querySelector(SEL.tooltip);

/** Cztery równe wycinki - kąty środkowe wypadają dokładnie na +-45 stopni. */
const CWIARTKI: Record<string, Json> = {
  categories: ["A", "B", "C", "D"],
  series: [{ name: "Udział", values: [1, 1, 1, 1] }],
};

afterEach(() => {
  document.documentElement.classList.remove("dark");
});

// ---------------------------------------------------------------------------

describe("PieChart - filtr danych i mianownik udziału", () => {
  it("bez kategorii nie renderuje NICZEGO (nie pustego <svg>)", () => {
    const { container } = render(
      <PieChart config={cfg({ kind: "pie", categories: [] })} lang="pl" />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("zestaw z samymi ZERAMI znika przed geometrią - zero dzielenia przez zero", () => {
    // Gdyby zera przeszły filtr, `sum` byłoby 0 i każdy udział wyszedłby
    // z dzielenia 0/0, czyli `NaN` w atrybucie `d`. Tarcza ma nie powstać.
    const { container } = render(
      <PieChart
        config={cfg({
          kind: "pie",
          categories: ["A", "B"],
          series: [{ name: "S", values: [0, 0] }],
        })}
        lang="pl"
      />,
    );
    expect(container.innerHTML).toBe("");
    expect(container.innerHTML).not.toContain("NaN");
  });

  it("luki i wartości UJEMNE wypadają z tarczy, a udziały liczą się z samych dodatnich", () => {
    const { container } = render(
      <PieChart
        config={cfg({
          kind: "pie",
          categories: ["ujemna", "luka", "trzy", "jeden"],
          series: [{ name: "S", values: [-100, null, 3, 1] }],
        })}
        lang="pl"
      />,
    );
    const rysowane = slices(container);
    expect(rysowane).toHaveLength(2);
    // Mianownik to 3 + 1 = 4, a NIE -100 + 3 + 1 = -96.
    expect(rysowane.map((s) => s.getAttribute("aria-label"))).toEqual([
      "trzy: 3 (75%)",
      "jeden: 1 (25%)",
    ]);
  });

  it("slot idzie z POZYCJI WYCINKA, nie z indeksu kategorii w konfiguracji", () => {
    // Jedyny rysowany wycinek dostaje slot 1, choć jego kategoria stoi na
    // trzeciej pozycji. Liczenie po indeksie kategorii wyglądało spójniej
    // (kategoria "trzymała" swój kolor), ale ROZWALAŁO LIMIT WYCINKÓW: limit
    // jest wyrażony w wycinkach, więc musi je liczyć. Przy ośmiu kategoriach
    // z wartościami tylko na pozycjach 5-8 wszystkie cztery wpadały w ogon,
    // głowa wychodziła pusta i tarcza pokazywała JEDEN wycinek "Pozostałe"
    // ze stoma procentami - patrz test poniżej. Slot z pozycji ma dodatkowo
    // tę cechę, że nigdy nie wychodzi poza 1-5, czyli poza zestaw bezpieczny
    // dla daltonizmu (sloty 7-8 wymagają kreskowania, a wycinka nie da się
    // zakreskować).
    const { container } = render(
      <PieChart
        config={cfg({
          kind: "pie",
          categories: ["a", "b", "c"],
          series: [{ name: "S", values: [0, null, 5] }],
        })}
        lang="pl"
      />,
    );
    // Wypełnienie to BLADE WNĘTRZE slotu, obwódka to jego mocna krawędź -
    // wariant blady, ten sam co w słupkach. Sam token serii (`--chart-1`)
    // nie pojawia się już jako `fill`: nasycona płaszczyzna pod etykietą była
    // najciemniejszym elementem wykresu i przeciągała na siebie uwagę, którą
    // ma nieść linia danych.
    expect(slices(container).map((s) => s.getAttribute("fill"))).toEqual(["var(--chart-1-inner)"]);
    expect(slices(container).map((s) => s.getAttribute("stroke"))).toEqual(["var(--chart-1-edge)"]);
  });

  it("wiodące luki NIE zwijają tarczy, a wycinki idą MALEJĄCO od godziny 12", () => {
    // DWIE REGUŁY W JEDNYM ZESTAWIE.
    //
    // Pierwsza to regresja: limit liczony po indeksie kategorii dawał tu głowę
    // pustą (żaden indeks < 4) i cały zestaw w ogonie, czyli JEDEN wycinek
    // "Pozostałe: 100 (100%)". Cztery odczytywalne kategorie znikały z tarczy
    // bez śladu, a limit pięciu wycinków nie był nawet napięty.
    //
    // Druga to kolejność. Wycinki idą teraz MALEJĄCO, zgodnie z ruchem
    // wskazówek od godziny dwunastej, a nie w kolejności z arkusza. Kąt
    // i powierzchnia siedzą w dolnej połowie hierarchii percepcyjnej
    // Clevelanda i McGilla, więc porównanie dwóch wycinków oddalonych o pół
    // obwodu jest praktycznie niewykonalne; kolejność malejąca stawia obok
    // siebie wielkości, które czytelnik faktycznie porównuje. Sortowanie
    // dzieje się PRZED podziałem na głowę i ogon, więc w wycinku zbiorczym
    // ląduje faktyczny ogon rozkładu, a nie koniec arkusza.
    const { container } = render(
      <PieChart
        config={cfg({
          kind: "pie",
          categories: ["a", "b", "c", "d", "e", "f", "g", "h"],
          series: [{ name: "S", values: [null, null, null, null, 10, 20, 30, 40] }],
        })}
        lang="pl"
      />,
    );
    expect(slices(container).map((s) => s.getAttribute("aria-label"))).toEqual([
      "h: 40 (40%)",
      "g: 30 (30%)",
      "f: 20 (20%)",
      "e: 10 (10%)",
    ]);
    // Slot idzie z POZYCJI po sortowaniu, więc największy wycinek dostaje
    // slot 1 - czyli kolor o najwyższym kontraście do płyty trafia na
    // wielkość, która i tak jest najlepiej widoczna. To zamierzone: paleta
    // ma identyfikować, a nie hierarchizować.
    expect(slices(container).map((s) => s.getAttribute("fill"))).toEqual([
      "var(--chart-1-inner)",
      "var(--chart-2-inner)",
      "var(--chart-3-inner)",
      "var(--chart-4-inner)",
    ]);
  });

  it("JEDEN wycinek zamyka pełny obrót łukiem o RÓŻNYCH końcach", () => {
    // SVG pomija łuk, którego oba końce są identyczne - tarcza 100% zniknęłaby
    // bez śladu. Kontrakt: końce łuku muszą się różnić.
    const { container } = render(
      <PieChart
        config={cfg({ kind: "pie", categories: ["Całość"], series: [{ name: "S", values: [42] }] })}
        lang="pl"
      />,
    );
    const [tarcza] = slices(container);
    expect(tarcza.getAttribute("aria-label")).toBe("Całość: 42 (100%)");
    const [, startX, , , , , , endX] = d(tarcza)
      .split(/[ MLA]+/)
      .filter(Boolean);
    expect(Number(startX)).not.toBe(Number(endX));
    // Duży łuk (flaga large-arc = 1) - inaczej pełny obrót rysuje się jako pół.
    expect(d(tarcza)).toContain(`A${R_OUTER} ${R_OUTER} 0 1 1`);
  });
});

describe("PieChart - geometria tarczy i pierścienia", () => {
  it("pierwszy wycinek startuje na godzinie 12 i idzie zgodnie z ruchem wskazówek", () => {
    const { container } = render(<PieChart config={cfg({ kind: "pie", ...CWIARTKI })} lang="pl" />);
    const luki = slices(container).map((s) => outerArc(d(s)));
    // Przerwa kątowa odjęta z każdej strony: pół przerwy pikselowej podzielone
    // przez promień, na którym się ją mierzy (dla koła to połowa promienia
    // zewnętrznego). Start pierwszego wycinka leży więc o tyle ZA godziną
    // dwunastą, a nie dokładnie na niej.
    const rMid = R_OUTER / 2;
    const luz = ARC_GAP_PX / 2 / rMid;
    expect(luki[0].a0).toBeCloseTo(-Math.PI / 2 + luz, 9);
    // Koniec pierwszej ćwiartki: godzina trzecia, minus ta sama przerwa.
    expect(luki[0].a1).toBeCloseTo(-luz, 9);
    // Druga ćwiartka podejmuje po drugiej stronie tej samej szczeliny.
    expect(luki[1].a0).toBeCloseTo(luz, 9);
    // Flaga sweep = 1 w każdym wycinku: zawsze w prawo (clockwise).
    expect(slices(container).every((s) => d(s).includes("0 0 1 "))).toBe(true);
  });

  it("szczelina między sąsiednimi łukami mierzy 2,5 px NA OSI PIERŚCIENIA", () => {
    // PIKSELE, NIE STOPNIE. Ten sam kąt daje przy różnej geometrii różną
    // szczelinę: przy tarczy o promieniu 148 px i przy pierścieniu, którego oś
    // leży na 119,88 px, stały kąt rozjeżdżałby się o połowę. Przerwa liczona
    // w pikselach na osi pierścienia jest optycznie ta sama w obu.
    //
    // PO CO PRZERWA. Bez niej obwódki dwóch sąsiednich łuków stykają się
    // i dają na granicy fałszywy trzeci kolor. Wcześniejsza wersja rozdzielała
    // je obrysem w kolorze karty - ten zajmował miejsce, które należy się
    // obwódce serii, i znikał w druku jednobarwnym razem z całą granicą.
    for (const [kind, rMid] of [
      ["pie", R_OUTER / 2],
      ["donut", (R_OUTER + R_INNER) / 2],
    ] as const) {
      const { container } = render(<PieChart config={cfg({ kind, ...CWIARTKI })} lang="pl" />);
      const luki = slices(container).map((s) => outerArc(d(s)));
      for (let i = 1; i < luki.length; i++) {
        const szczelina = roznicaKatow(luki[i].a0, luki[i - 1].a1) * rMid;
        expect(szczelina).toBeCloseTo(ARC_GAP_PX, 5);
      }
    }
  });

  it("łuk nie ma zaokrąglenia na ŻADNYM końcu - oba są granicami kategorii", () => {
    // W słupku jeden koniec jest krawędzią odniesienia (zero albo poziom
    // skumulowany), a drugi końcem danych, więc jeden jest kwadratowy, a drugi
    // zaokrąglony. W pierścieniu OBA końce łuku są granicami MIĘDZY
    // KATEGORIAMI, czyli oba są krawędziami odniesienia - zaokrąglenie
    // któregokolwiek przesuwa granicę i zaniża udział. To ta sama reguła co
    // przy podstawie słupka, tylko zastosowana dwa razy.
    const { container } = render(
      <PieChart config={cfg({ kind: "donut", ...CWIARTKI })} lang="pl" />,
    );
    for (const wycinek of slices(container)) {
      expect(wycinek.getAttribute("stroke-linecap")).toBeNull();
      expect(wycinek.getAttribute("stroke-linejoin")).toBe("miter");
    }
  });

  it("koło rysuje wycinki OD ŚRODKA, pierścień zostawia otwór 0,62 promienia", () => {
    const kolo = render(<PieChart config={cfg({ kind: "pie", ...CWIARTKI })} lang="pl" />);
    expect(d(slices(kolo.container)[0]).startsWith(`M${CX} ${CY} L`)).toBe(true);

    const pierscien = render(<PieChart config={cfg({ kind: "donut", ...CWIARTKI })} lang="pl" />);
    const sciezka = d(slices(pierscien.container)[0]);
    // Pierścień nie dotyka środka: brak segmentu "M cx cy L".
    expect(sciezka.startsWith(`M${CX} ${CY} L`)).toBe(false);
    // Drugi łuk ma promień wewnętrzny i biegnie W PRZECIWNĄ stronę (sweep 0).
    expect(sciezka).toContain(`A${R_INNER} ${R_INNER} 0 0 0`);
  });

  it("wysokość z configu NIE jest cicho przycinana - suwak działa do 640 px", () => {
    // Regresja opisana w komentarzu komponentu: wcześniejsze przycięcie do
    // 420 px sprawiało, że suwak powyżej tej wartości nic nie robił.
    const { container } = render(
      <PieChart
        config={cfg({
          kind: "pie",
          height: 640,
          categories: ["A"],
          series: [{ name: "S", values: [1] }],
        })}
        lang="pl"
      />,
    );
    expect(num(container.querySelector("svg") ?? undefined, "height")).toBe(640);
    // cy = 320, rOuter = min(720, 640)/2 - 12 = 308.
    expect(d(slices(container)[0])).toContain("A308 308");
    // Łuk startuje na promieniu 308 px i o pół przerwy kątowej za godziną
    // dwunastą. Sprawdzamy promień i kąt, a nie przepisany ciąg `d`: przerwa
    // wypada na niecałkowitych współrzędnych, a interesuje nas to, że wycinek
    // rozpiął się na pełnej dostępnej średnicy.
    const [x0, y0] = (d(slices(container)[0]).match(/-?\d+(?:\.\d+)?/g) ?? [])
      .slice(2, 4)
      .map(Number);
    expect(Math.hypot(x0 - 360, y0 - 320)).toBeCloseTo(308, 6);
    expect(Math.atan2(y0 - 320, x0 - 360)).toBeCloseTo(-Math.PI / 2 + ARC_GAP_PX / 2 / 154, 9);
  });

  it("skrajnie wąski kontener trzyma PODŁOGĘ promienia 40 px", () => {
    // `Math.max(40, ...)` to świadoma podłoga: na 60-pikselowej karcie tarcza
    // jest przycięta krawędzią SVG, ale nie kurczy się do nieczytelnej kropki.
    const spy = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(60);
    try {
      const { container } = render(
        <PieChart
          config={cfg({
            kind: "pie",
            height: 160,
            categories: ["A"],
            series: [{ name: "S", values: [1] }],
          })}
          lang="pl"
        />,
      );
      expect(num(container.querySelector("svg") ?? undefined, "width")).toBe(60);
      expect(d(slices(container)[0])).toContain("A40 40");
    } finally {
      spy.mockRestore();
    }
  });

  it("tytuł trafia do aria-label grupy, a jego brak nie zostawia pustego atrybutu", () => {
    const zTytulem = render(
      <PieChart
        config={cfg({ kind: "pie", title: "Struktura eksportu", ...CWIARTKI })}
        lang="pl"
      />,
    );
    const grupa = zTytulem.container.querySelector("[role='group']");
    // Etykieta a11y idzie ze słownika i NAZYWA RODZAJ OBIEKTU - sam tytuł
    // nie mówi czytnikowi ekranu, że patrzy na wykres.
    expect(grupa?.getAttribute("aria-label")).toBe("Wykres: Struktura eksportu");

    const bezTytulu = render(<PieChart config={cfg({ kind: "pie", ...CWIARTKI })} lang="pl" />);
    // role="group", nie "img": wycinki w środku są fokusowalne, a rola img
    // uczyniłaby je prezentacyjnymi dla czytnika ekranu.
    const anonimowa = bezTytulu.container.querySelector("[role='group']");
    expect(anonimowa).not.toBeNull();
    // Bez tytułu zostaje sama nazwa rodzaju obiektu: "Wykres" jest dla
    // czytnika ekranu lepsze niż brak nazwy, a puste `aria-label` byłoby
    // gorsze od obu.
    expect(anonimowa?.getAttribute("aria-label")).toBe("Wykres");
  });
});

describe("PieChart - etykiety wewnątrz wycinków", () => {
  const struktura: Record<string, Json> = {
    kind: "pie",
    unit: " mld",
    categories: ["duża", "średnia", "drobna"],
    series: [{ name: "S", values: [70, 25, 5] }],
  };

  it("wycinek poniżej 8% NIE dostaje etykiety - wartość niesie tabela i tooltip", () => {
    const { container } = render(<PieChart config={cfg(struktura)} lang="pl" />);
    expect(slices(container)).toHaveLength(3);
    // 5% jest za wąskie na tekst w wypełnieniu; 70% i 25% dostają etykietę.
    expect(all(container, SEL.label).map((t) => t.textContent)).toEqual(["70%", "25%"]);
  });

  it("etykieta siedzi w kątowym środku wycinka i na promieniu 0,66 (koło)", () => {
    const { container } = render(<PieChart config={cfg({ kind: "pie", ...CWIARTKI })} lang="pl" />);
    const [pierwsza] = all(container, SEL.label);
    const rLabel = R_OUTER * 0.66;
    const mid = -Math.PI / 4; // środek pierwszej ćwiartki startującej na 12:00
    expect(num(pierwsza, "x")).toBeCloseTo(CX + rLabel * Math.cos(mid), 5);
    // dy = 4 przy wyłączonych etykietach wartości (wyśrodkowanie optyczne).
    expect(num(pierwsza, "y")).toBeCloseTo(CY + rLabel * Math.sin(mid) + 4, 5);
    expect(pierwsza.getAttribute("text-anchor")).toBe("middle");
  });

  it("w pierścieniu etykieta ląduje w POŁOWIE obwódki, nie w otworze", () => {
    const { container } = render(
      <PieChart config={cfg({ kind: "donut", ...CWIARTKI })} lang="pl" />,
    );
    const [pierwsza] = all(container, SEL.label);
    const rLabel = (R_OUTER + R_INNER) / 2;
    const promien = Math.hypot(num(pierwsza, "x") - CX, num(pierwsza, "y") - 4 - CY);
    expect(promien).toBeCloseTo(rLabel, 5);
    // Twardy warunek: etykieta jest MIĘDZY otworem a krawędzią.
    expect(promien).toBeGreaterThan(R_INNER);
    expect(promien).toBeLessThan(R_OUTER);
  });

  it("etykieta w bladym wnętrzu idzie TUSZEM, nie inkiem slotu", () => {
    // ODWRÓCENIE WCZEŚNIEJSZEJ REGUŁY, i to świadome.
    //
    // Dopóki wycinek był wypełniony NASYCONYM tokenem serii, etykieta musiała
    // brać `--chart-ink-N` z tego samego slotu: ink jest dobrany kontrastem do
    // tego konkretnego wypełnienia i na granacie wychodzi biały, a na ochrze
    // ciemny. Po przejściu na wariant blady wypełnienie ma do płyty
    // 1,20-1,28:1, czyli jest niemal białe - a biały ink slotu granatowego
    // dawał na nim około 1,2:1, czyli napis nieczytelny.
    //
    // Blade wnętrze jest tak jasne, że NIE POTRZEBUJE własnego tuszu: ciemny
    // tusz semantyczny ma na nim 12,6-14,9:1 w motywie jasnym i tyle samo po
    // odwróceniu w ciemnym. Jeden token na wszystkie sloty jest tu więc
    // i prostszy, i bezpieczniejszy - a wyjątek "tekst w tokenach slotu"
    // znika razem z powodem, dla którego istniał.
    const { container } = render(
      <PieChart
        config={cfg({
          kind: "pie",
          categories: ["a", "b", "c", "d", "e"],
          series: [{ name: "S", values: [1, 1, 1, 1, 1] }],
        })}
        lang="pl"
      />,
    );
    const fills = slices(container).map((s) => s.getAttribute("fill"));
    const inks = all(container, SEL.label).map((t) => t.getAttribute("fill"));
    expect(fills).toEqual([1, 2, 3, 4, 5].map((n) => `var(--chart-${n}-inner)`));
    expect(inks).toEqual(Array.from({ length: 5 }, () => "var(--foreground)"));
    // Ink slotu jest PODANY na elemencie, ale nie użyty jako `fill`: arkusz
    // przełącza na niego dopiero w druku, gdzie łuk wraca do wariantu
    // solidnego i ten sam napis leży na nasyconym kolorze (tusz semantyczny
    // ma na granacie 2,25:1, a ink slotu 8,07:1). Warunek jest więc taki:
    // ink jest dostępny, ale ŻADEN `fill` na niego nie wskazuje.
    const grupy = [...container.querySelectorAll("g[style*='--neh-arc-ink']")];
    expect(grupy).toHaveLength(5);
    expect(grupy[0].getAttribute("style")).toContain("--chart-ink-1");
    expect(container.innerHTML).not.toContain('fill="var(--chart-ink-');
  });

  it("przełącznik 'Etykiety wartości' dokłada DRUGĄ linię z wartością i podnosi udział", () => {
    // Wcześniej `showValues` był dla koła cichym no-opem - przełącznik w
    // edytorze nie robił nic, mimo że w wykresach kartezjańskich działa.
    const bez = render(<PieChart config={cfg(struktura)} lang="pl" />);
    expect(all(bez.container, SEL.value)).toHaveLength(0);
    const yUdzialu = num(all(bez.container, SEL.label)[0], "y");

    const z = render(<PieChart config={cfg({ ...struktura, showValues: true })} lang="pl" />);
    const wartosci = all(z.container, SEL.value);
    expect(wartosci.map((t) => t.textContent)).toEqual(["70 mld", "25 mld"]);
    // Udział podjeżdża o 6 px (dy 4 -> -2), wartość ląduje 13 px pod nim.
    const yUdzialuZ = num(all(z.container, SEL.label)[0], "y");
    expect(yUdzialuZ).toBeCloseTo(yUdzialu - 6, 5);
    expect(num(wartosci[0], "y")).toBeCloseTo(yUdzialuZ + 13, 5);
    // Etykiety nie przechwytują wskaźnika - hover należy do wycinka.
    expect(wartosci[0].parentElement?.getAttribute("pointer-events")).toBe("none");
  });
});

describe("PieChart - suma w środku pierścienia", () => {
  const dane: Record<string, Json> = {
    kind: "donut",
    unit: " mld",
    categories: ["A", "B"],
    series: [{ name: "S", values: [1200, 800] }],
  };

  it("środek niesie JEDNĄ liczbę, a jednostka jest jej podpisem POD nią", () => {
    // ROZDZIELENIE LICZBY I JEDNOSTKI. Wcześniej środek pierścienia niósł
    // "2000 mld" w jednym napisie 22 px, a pod nim słowo "Suma". Przy dłuższej
    // jednostce (np. "mln EUR (ceny stałe)") ten sklejony napis wychodził
    // poza otwór pierścienia i nachodził na łuki. Środek ma niepodzielnie
    // JEDNĄ liczbę nagłówkową; jednostka jest jej podpisem, więc schodzi
    // linijkę niżej mniejszym stopniem i przestaje konkurować o szerokość
    // otworu.
    const pl = render(<PieChart config={cfg(dane)} lang="pl" />);
    expect(all(pl.container, SEL.center).map((t) => t.textContent)).toEqual(["2000", "Suma · mld"]);

    const en = render(<PieChart config={cfg(dane)} lang="en" />);
    // en-GB dokłada separator tysięcy - ten sam zestaw, inny napis.
    expect(all(en.container, SEL.center).map((t) => t.textContent)).toEqual([
      "2,000",
      "Total · mld",
    ]);
  });

  it("bez jednostki podpisem zostaje słowo 'Suma' - w obu językach", () => {
    // Liczba bez żadnego podpisu w środku pierścienia nie mówi, czego jest
    // sumą, a autor nie zawsze podaje jednostkę (udziały, wskaźniki
    // bezwymiarowe). Wtedy podpisem zostaje klucz słownika - jedyny tekst
    // komponentu, który idzie z tłumaczeń.
    const bez: Record<string, Json> = { ...dane, unit: "" };
    const pl = render(<PieChart config={cfg(bez)} lang="pl" />);
    expect(all(pl.container, SEL.center).map((t) => t.textContent)).toEqual(["2000", "Suma"]);
    const en = render(<PieChart config={cfg(bez)} lang="en" />);
    expect(all(en.container, SEL.center).map((t) => t.textContent)).toEqual(["2,000", "Total"]);
  });

  it("środek PRZEŁĄCZA się na wskazany segment i WRACA do sumy", () => {
    // Wolno, bo pod dwoma warunkami, które spec nazywa wprost: podpis mówi,
    // który stan jest widoczny (nazwa segmentu wobec "Suma"), a po zejściu
    // wskaźnika liczba wraca do sumy. Środek, który zostaje na ostatnim
    // segmencie, kłamie o całości - i to jest dokładnie ten defekt, przed
    // którym broni druga połowa tego testu.
    const { container } = render(<PieChart config={cfg(dane)} lang="pl" />);
    expect(all(container, SEL.center).map((t) => t.textContent)).toEqual(["2000", "Suma · mld"]);
    fireEvent.pointerEnter(slices(container)[0]);
    expect(all(container, SEL.center).map((t) => t.textContent)).toEqual(["1200", "A · mld"]);
    fireEvent.pointerLeave(slices(container)[0]);
    expect(all(container, SEL.center).map((t) => t.textContent)).toEqual(["2000", "Suma · mld"]);
  });

  it("suma w środku liczy się z DODATNICH - tyle, ile pokazuje tarcza", () => {
    const { container } = render(
      <PieChart
        config={cfg({
          ...dane,
          categories: ["A", "B", "C"],
          series: [{ name: "S", values: [1200, 800, -500] }],
        })}
        lang="pl"
      />,
    );
    expect(all(container, SEL.center).map((t) => t.textContent)).toEqual(["2000", "Suma · mld"]);
  });

  it("koło NIE dostaje sumy w środku (nie ma tam otworu)", () => {
    const { container } = render(<PieChart config={cfg({ ...dane, kind: "pie" })} lang="pl" />);
    expect(all(container, SEL.center)).toHaveLength(0);
  });
});

describe("PieChart - paleta i nadmiar kategorii", () => {
  const dziesiec: Record<string, Json> = {
    kind: "pie",
    categories: Array.from({ length: 10 }, (_, i) => `K${i + 1}`),
    series: [{ name: "S", values: Array.from({ length: 10 }, () => 10) }],
  };

  it("tarcza kończy się na PIĘCIU wycinkach, a nadmiar schodzi do zbiorczego", () => {
    // ZMIANA ŚWIADOMA: limit zszedł z ośmiu wycinków na pięć.
    //
    // Tarcza koduje kątem i powierzchnią, czyli kanałami z DOLNEJ POŁOWY
    // hierarchii percepcyjnej Clevelanda i McGilla. Przy ośmiu wycinkach
    // czytelnik nie porówna już żadnej pary - a im więcej wycinków, tym
    // mniejsza szansa, że którykolwiek da się odczytać. Limit pięciu jest
    // regułą doboru formy, nie ograniczeniem technicznym.
    //
    // ŻADNA LICZBA NIE GINIE: ogon zwija się w jeden wycinek zbiorczy, jego
    // wartość wchodzi do mianownika, a pełne wartości KAŻDEJ kategorii niesie
    // tabela danych, która jest zawsze pod wykresem.
    const { container } = render(<PieChart config={cfg(dziesiec)} lang="pl" />);
    expect(slices(container).map((s) => s.getAttribute("fill"))).toEqual(
      Array.from({ length: PIE_MAX_SLICES }, (_, i) => `var(--chart-${i + 1}-inner)`),
    );
    const etykiety = slices(container).map((s) => s.getAttribute("aria-label"));
    expect(etykiety).toHaveLength(PIE_MAX_SLICES);
    // Mianownik obejmuje CAŁY zestaw (100), a nie pięć narysowanych pozycji:
    // 4 x 10% + 60% domyka 100%.
    expect(etykiety[0]).toBe("K1: 10 (10%)");
    expect(etykiety[PIE_MAX_SLICES - 1]).toBe("Pozostałe: 60 (60%)");
  });

  it("nazwa wycinka zbiorczego jest przetłumaczona; dwie dane w dziesięciu kategoriach to dwa wycinki", () => {
    const en = render(<PieChart config={cfg(dziesiec)} lang="en" />);
    expect(slices(en.container).at(-1)?.getAttribute("aria-label")).toBe("Other: 60 (60%)");

    // Dziesięć KATEGORII, ale tylko dwie z wartością - więc limit pięciu
    // wycinków nie jest napięty i wycinka zbiorczego nie ma wcale. Wcześniej,
    // przy liczeniu po indeksie kategorii, "K10" trafiało do ogona i było
    // rysowane JAKO wycinek zbiorczy (slot 5): tarcza pokazywała realną
    // kategorię w kolorze zarezerwowanym dla agregatu.
    const jedna = render(
      <PieChart
        config={cfg({
          kind: "pie",
          categories: Array.from({ length: 10 }, (_, i) => `K${i + 1}`),
          series: [{ name: "S", values: [10, null, null, null, null, null, null, null, null, 5] }],
        })}
        lang="pl"
      />,
    );
    expect(slices(jedna.container).map((s) => s.getAttribute("aria-label"))).toEqual([
      "K1: 10 (67%)",
      "K10: 5 (33%)",
    ]);
    expect(slices(jedna.container).map((s) => s.getAttribute("fill"))).toEqual([
      "var(--chart-1-inner)",
      "var(--chart-2-inner)",
    ]);
  });

  it("kolor identyfikuje wycinek: dwie kategorie nie dostają tego samego slotu palety", () => {
    // Reguła palety z `src/styles.css`: "Sloty przypisuje się sekwencyjnie
    // serii 1..8 - NIGDY po obwodzie". Zawijanie modulo dawało przy >=9
    // kategoriach próbkę w legendzie wskazującą DWA wycinki naraz, czyli
    // klucz, który przestaje być kluczem. Nadmiar schodzi więc do jednego
    // wycinka zbiorczego w ostatnim slocie.
    const { container } = render(<PieChart config={cfg(dziesiec)} lang="pl" />);
    const uzyte = slices(container).map((s) => s.getAttribute("fill"));
    expect(new Set(uzyte).size).toBe(uzyte.length);
  });
});

describe("PieChart - tooltip i fokus", () => {
  it("wskazanie wycinka pokazuje nazwę, udział i wartość z jednostką", () => {
    const { container } = render(
      <PieChart
        config={cfg({
          kind: "pie",
          unit: " mld EUR",
          categories: ["Eksport", "Import"],
          series: [{ name: "S", values: [3, 1] }],
        })}
        lang="pl"
      />,
    );
    expect(tip(container)).toBeNull();
    fireEvent.pointerEnter(slices(container)[0]);
    expect(tip(container)?.textContent).toBe("Eksport75%3 mld EUR");
    // Tooltip to wizualny duplikat - dla czytnika jest schowany.
    expect(tip(container)?.getAttribute("aria-hidden")).toBe("true");
  });

  it("kotwica tooltipa siada w POŁOWIE promienia wycinka", () => {
    const { container } = render(<PieChart config={cfg({ kind: "pie", ...CWIARTKI })} lang="pl" />);
    fireEvent.pointerEnter(slices(container)[0]);
    // r = (rOuter + rInner) / 2 = 74; mid = -45 stopni.
    const x = Math.round(CX + 74 * Math.cos(-Math.PI / 4));
    const y = Math.round(CY + 74 * Math.sin(-Math.PI / 4));
    expect(tip(container)?.getAttribute("style")).toContain(`translate3d(${x}px, ${y}px, 0)`);
  });

  it("tooltip przy prawej krawędzi odbija się w lewo zamiast wyjeżdżać z karty", () => {
    const { container } = render(
      <PieChart config={cfg({ kind: "donut", ...CWIARTKI })} lang="pl" />,
    );
    const wycinki = slices(container);
    // Kotwica pierścienia siedzi na promieniu 119,88 - prawa ćwiartka wypada
    // za progiem 0,6 szerokości kontenera (432 px), lewa nie.
    fireEvent.pointerEnter(wycinki[1]);
    expect(tip(container)?.getAttribute("style")).toContain("-100%");
    fireEvent.pointerLeave(wycinki[1]);
    fireEvent.pointerEnter(wycinki[2]);
    expect(tip(container)?.getAttribute("style")).toContain("translate(12px");
  });

  it("opuszczenie wskaźnikiem chowa tooltip", () => {
    const { container } = render(<PieChart config={cfg({ kind: "pie", ...CWIARTKI })} lang="pl" />);
    fireEvent.pointerEnter(slices(container)[0]);
    expect(tip(container)).not.toBeNull();
    fireEvent.pointerLeave(slices(container)[0]);
    expect(tip(container)).toBeNull();
  });

  it("FOKUS zmienia POWIERZCHNIĘ, a nie geometrię łuku", () => {
    // ODWRÓCENIE WCZEŚNIEJSZEGO ZACHOWANIA, i to jest poprawka uczciwości,
    // nie estetyki. Wskazany wycinek wysuwał się 4 px na zewnątrz po kącie
    // środkowym. Wysunięcie zwiększa promień, na którym leży łuk zewnętrzny,
    // więc DŁUGOŚĆ tego łuku rośnie - a to jest dokładnie ta cecha, którą oko
    // czyta jako "większy udział". Podświetlenie nie może zmieniać kodowania:
    // wskazanie mówi "to jest ten wycinek", a nie "ten wycinek jest większy".
    //
    // W zamian zmienia się POWIERZCHNIA: wypełnienie idzie o krok w stronę
    // nasycenia, obwódka na czysty token serii (obie podstawienia przez
    // własności `--neh-arc-*`, bo jedna reguła arkusza obsługuje wszystkie
    // sloty), a grubość obwódki i ścieżka zostają bez zmian.
    const { container } = render(<PieChart config={cfg({ kind: "pie", ...CWIARTKI })} lang="pl" />);
    const spoczynek = d(slices(container)[0]);
    fireEvent.focus(slices(container)[0]);
    expect(tip(container)?.textContent).toBe("A25%1");
    expect(d(slices(container)[0])).toBe(spoczynek);
    expect(slices(container)[0].getAttribute("data-active")).toBe("true");
    // Podstawienia stanu stoją na elemencie, więc arkusz ma czym podmienić
    // wypełnienie i obwódkę bez znajomości numeru slotu.
    const styl = slices(container)[0].getAttribute("style") ?? "";
    expect(styl).toContain("--neh-arc-hover: var(--chart-1-hover)");
    expect(styl).toContain("--neh-arc-token: var(--chart-1)");
    // POZOSTAŁE WYCINKI NIE GASNĄ. Przygaszanie tła podświetlenia zmienia
    // wygląd danych, których czytelnik nie wskazał, a przy tarczy odbiera mu
    // jedyne odniesienie, względem którego może ocenić wskazany udział.
    for (const inny of slices(container).slice(1)) {
      expect(inny.getAttribute("data-active")).toBeNull();
      expect(inny.getAttribute("opacity")).toBeNull();
      expect(inny.getAttribute("fill-opacity")).toBeNull();
    }
    fireEvent.blur(slices(container)[0]);
    expect(tip(container)).toBeNull();
    expect(slices(container)[0].getAttribute("data-active")).toBeNull();
    expect(d(slices(container)[0])).toBe(spoczynek);
  });

  it("TAPNIĘCIE trzyma stan, a tapnięcie POZA tarczą go zdejmuje", () => {
    // Na dotyku `pointerleave` przychodzi natychmiast po podniesieniu palca,
    // więc tarcza oparta na parze enter/leave migała tooltipem i gasła.
    const { container } = render(<PieChart config={cfg({ kind: "pie", ...CWIARTKI })} lang="pl" />);
    fireEvent.pointerEnter(slices(container)[0], { pointerType: "touch" });
    expect(tip(container)).not.toBeNull();
    fireEvent.pointerLeave(slices(container)[0], { pointerType: "touch" });
    expect(tip(container)).not.toBeNull();

    fireEvent.pointerDown(document.body, { pointerType: "touch" });
    expect(tip(container)).toBeNull();
  });

  it("tapnięcie w TABELĘ KLUCZA nie zdejmuje wskazania z łuku", () => {
    // Tabela i pierścień są jednym elementem interfejsu rozłożonym na dwie
    // części, więc nasłuch "tapnięcie poza" musi obejmować oba - inaczej
    // przejście palcem z łuku na wiersz gasiłoby stan w połowie drogi.
    const { container } = render(<Chart config={cfg({ kind: "donut", ...CWIARTKI })} lang="pl" />);
    fireEvent.pointerEnter(slices(container)[0], { pointerType: "touch" });
    const wiersz = container.querySelectorAll("table.neh-pie-key tbody tr")[0];
    fireEvent.pointerDown(wiersz, { pointerType: "touch" });
    expect(slices(container)[0].getAttribute("data-active")).toBe("true");
  });

  it("każdy wycinek jest OSIĄGALNY Z KLAWIATURY i nazwany bez pomocy koloru", () => {
    const { container } = render(
      <PieChart
        config={cfg({
          kind: "pie",
          unit: "%",
          categories: ["Za", "Przeciw"],
          series: [{ name: "S", values: [60, 40] }],
        })}
        lang="pl"
      />,
    );
    for (const s of slices(container)) expect(s.getAttribute("tabindex")).toBe("0");
    expect(slices(container).map((s) => s.getAttribute("aria-label"))).toEqual([
      "Za: 60% (60%)",
      "Przeciw: 40% (40%)",
    ]);
  });
});

describe("PieChart - i18n liczb (pl-PL vs en-GB)", () => {
  const dane: Record<string, Json> = {
    kind: "pie",
    unit: " mln",
    categories: ["A", "B", "C"],
    series: [{ name: "S", values: [12345.6, 1000, 54.5] }],
  };

  it("ten sam zestaw daje ODMIENNE, poprawne napisy w obu językach", () => {
    const pl = render(<PieChart config={cfg(dane)} lang="pl" />);
    const en = render(<PieChart config={cfg(dane)} lang="en" />);
    const etykieta = (root: HTMLElement, i: number): string =>
      slices(root)[i].getAttribute("aria-label") ?? "";

    // pl-PL grupuje tysiące TWARDĄ spacją (U+00A0) - zapisana wprost, żeby
    // różnicy nie dało się zgubić przy kopiowaniu.
    expect(etykieta(pl.container, 0)).toBe("A: 12\u00a0345,6 mln (92%)");
    expect(etykieta(en.container, 0)).toBe("A: 12,345.6 mln (92%)");
    // Udział poniżej 10% dostaje jedno miejsce po przecinku (i przecinek w PL).
    expect(etykieta(pl.container, 2)).toBe("C: 54,5 mln (0,4%)");
    expect(etykieta(en.container, 2)).toBe("C: 54.5 mln (0.4%)");
  });
});

describe("PieChart w ramie Chart - alternatywa tekstowa, legenda, axe", () => {
  const struktura: Record<string, Json> = {
    kind: "donut",
    title: "Struktura eksportu",
    description: "Udział rynków w wartości",
    unit: " mld",
    categories: ["Niemcy", "Czechy", "drobnica"],
    series: [{ name: "Udział", values: [70, 25, 5] }],
    source: "Źródło: test",
  };

  // TABELA DANYCH RAMY, nie tabela klucza przy pierścieniu. Od kiedy klucz
  // tarczy jest tabelą obok łuków, `querySelector("table")` trafiał w niego,
  // a nie w panel danych - i asercje o nagłówkach kolumn oblewały się na
  // tabeli, która nagłówków kolumn nie ma. Idziemy więc przez `aria-controls`
  // przycisku, czyli tą samą drogą, którą panel znajduje czytnik ekranu.
  const openTable = (root: HTMLElement, name: string): HTMLTableElement => {
    const button = within(root).getByRole("button", { name });
    fireEvent.click(button);
    const panel = document.getElementById(button.getAttribute("aria-controls") ?? "");
    const table = panel?.querySelector("table");
    if (!table) throw new Error("brak tabeli danych");
    return table as HTMLTableElement;
  };

  /** Wiersze tabeli klucza obok pierścienia: nazwa, udział, wartość. */
  const keyRows = (root: HTMLElement): string[][] =>
    [...root.querySelectorAll("table.neh-pie-key tbody tr")].map((tr) =>
      [...tr.children].map((cell) => cell.textContent ?? ""),
    );

  it("KAŻDA kategoria ma wiersz z wartością i udziałem - także ta bez jednostki na tarczy", () => {
    // To jest ekwiwalent `ChartDataTable` z panelu BI: grafika nigdy nie jest
    // jedyną drogą do liczby. W łuku mieści się co najwyżej UDZIAŁ; wartość
    // bezwzględna z jednostką ("5 mld") jest dostępna tylko przez tabelę albo
    // tooltip, a tooltipa nie ma ani czytnik ekranu, ani czytelnik na papierze.
    //
    // Próg etykiety idzie z GEOMETRII, nie ze stałej procentowej: te same 5%
    // mieszczą napis w pierścieniu (oś na promieniu 119,88 px daje łuk 35 px),
    // a w kole o tej samej średnicy już nie (oś na 74 px, łuk 21 px). Dlatego
    // pierścień pokazuje tu trzy etykiety, a koło z tego samego zestawu dwie -
    // i jest to poprawne w obu przypadkach, bo pyta o miejsce, nie o udział.
    const { container } = render(<Chart config={cfg(struktura)} lang="pl" />);
    expect(all(container, SEL.label).map((t) => t.textContent)).toEqual(["70%", "25%", "5%"]);
    const table = openTable(container, "Pokaż dane");
    const naglowki = [...table.querySelectorAll("th[scope='col']")].map((th) => th.textContent);
    expect(naglowki).toEqual(["Kategoria", "Wartość", "Udział"]);
    const wiersz = within(table).getByRole("row", { name: /drobnica/ });
    expect(wiersz.textContent).toBe("drobnica5 mld5%");
  });

  // UWAGA NA RÓŻNICĘ WZGLĘDEM PANELU BI. `ChartDataTable`
  // (`src/components/admin/analytics/ChartDataTable.tsx`) trzyma tabelę
  // w `<details>`, więc zostaje ona w DRZEWIE DOSTĘPNOŚCI także zamknięta.
  // `ChartFrame` używa atrybutu `hidden`, który tabelę z tego drzewa WYJMUJE -
  // droga do liczb prowadzi tu przez nazwany, fokusowalny przycisk z
  // `aria-expanded`/`aria-controls` (poprawny wzorzec ujawniania), ale jest
  // o jedno działanie dłuższa. Test przypina oba końce tego kontraktu.
  it("tabela danych jest sterowalna z klawiatury i opisana dla czytnika", () => {
    const { container, getByRole } = render(<Chart config={cfg(struktura)} lang="pl" />);
    const przycisk = getByRole("button", { name: "Pokaż dane" });
    expect(przycisk.getAttribute("aria-expanded")).toBe("false");
    const panel = document.getElementById(przycisk.getAttribute("aria-controls") ?? "");
    expect(panel?.hasAttribute("hidden")).toBe(true);
    expect(panel?.querySelector(".sr-only")?.textContent).toBe("Dane wykresu");

    fireEvent.click(przycisk);
    expect(getByRole("button", { name: "Ukryj dane" }).getAttribute("aria-expanded")).toBe("true");
    expect(panel?.hasAttribute("hidden")).toBe(false);
    expect(container.querySelector("figure")).not.toBeNull();
  });

  it("przełącznik tabeli i nagłówki są przetłumaczone (pl/en)", () => {
    const { container, getByRole } = render(<Chart config={cfg(struktura)} lang="en" />);
    const table = openTable(container, "Show data");
    expect([...table.querySelectorAll("th[scope='col']")].map((th) => th.textContent)).toEqual([
      "Category",
      "Value",
      "Share",
    ]);
    expect(getByRole("button", { name: "Hide data" })).toBeTruthy();
  });

  it("klucz tarczy to TABELA obok pierścienia, a nie legenda z próbkami", () => {
    // ODWRÓCENIE WCZEŚNIEJSZEGO ROZWIĄZANIA. Legenda podawała wyłącznie parę
    // kolor-nazwa, więc odczyt jednej kategorii wymagał trzech skoków wzroku
    // (łuk, próbka, nazwa) i na końcu nie dawał liczby. Tabela stawia próbkę,
    // nazwę, udział i wartość bezwzględną w JEDNYM wierszu, w tej samej
    // kolejności co łuki - a w wariancie bladym jest nośnikiem WYMAGANYM, bo
    // obwódka 1,5 px na pierścieniu grubym 38 px to około 4% powierzchni łuku
    // i z odległości koloru nie niesie.
    const { container } = render(<Chart config={cfg(struktura)} lang="pl" />);
    expect(keyRows(container)).toEqual([
      ["Niemcy", "70%", "70 mld"],
      ["Czechy", "25%", "25 mld"],
      ["drobnica", "5%", "5 mld"],
    ]);
    // Nazwa w nagłówku WIERSZA - czytnik ekranu czyta liczbę razem z tym,
    // czego dotyczy, bez pytania o kolumnę.
    const pierwszy = container.querySelectorAll("table.neh-pie-key tbody tr")[0];
    expect(pierwszy.firstElementChild?.tagName).toBe("TH");
    expect(pierwszy.firstElementChild?.getAttribute("scope")).toBe("row");
    // Próbka niesie PARĘ wnętrze plus obwódka, dokładnie jak łuk. Sama obwódka
    // nie wskazywałaby wycinka: na łuku kolor niesie blade wnętrze.
    const probka = pierwszy.querySelector("span[aria-hidden]");
    const styl = probka?.getAttribute("style") ?? "";
    expect(styl).toContain("var(--chart-1-inner)");
    expect(styl).toContain("var(--chart-1-edge)");
    expect(probka?.textContent).toBe("");
    // Legendy z próbkami na tarczy NIE MA - dwa klucze do jednej grafiki
    // byłyby dwoma miejscami, w których kolejność wycinków może się rozjechać.
    expect(container.querySelector("ul[role='list']")).toBeNull();
  });

  it("tabela klucza ma NAGŁÓWKI KOLUMN, choć niewidoczne", () => {
    // REGRESJA z przeglądu. Tabela startowała od `<tbody>` i miała wyłącznie
    // nagłówki WIERSZY, więc czytelnik z czytnikiem ekranu dostawał nazwę
    // kategorii i dwie liczby bez informacji, która jest udziałem, a która
    // wartością bezwzględną - czyli tracił całą treść tej tabeli. Wzrokiem
    // rozróżnia je układ i jednostka, dla czytnika układ nie istnieje.
    //
    // Ukrywamy TREŚĆ KOMÓREK, nie cały `<thead>`: `sr-only` to pozycja
    // absolutna, a nałożona na grupę wierszy wyjmuje ją ze struktury tabeli
    // i `scope="col"` przestaje cokolwiek wiązać.
    const { container } = render(<Chart config={cfg(struktura)} lang="pl" />);
    const tabela = container.querySelector("table.neh-pie-key");
    const naglowki = [...(tabela?.querySelectorAll("thead th[scope='col']") ?? [])];
    expect(naglowki.map((th) => th.textContent)).toEqual(["Kategoria", "Udział", "Wartość"]);
    // Treść jest schowana wzrokowo, ale komórka zostaje w tabeli.
    for (const th of naglowki) {
      expect(th.querySelector("span")?.className).toContain("sr-only");
    }
    // Kolejność kolumn nagłówka odpowiada kolejności w wierszach danych.
    const wiersz = tabela?.querySelector("tbody tr");
    expect(wiersz?.children).toHaveLength(naglowki.length);
  });

  it("tabela klucza jest ODPORNA na przełącznik legendy i na jedną kategorię", () => {
    // Klucz tarczy nie jest ozdobą do wyłączenia: przy jednym wycinku nadal
    // niesie jedyną drogę do wartości bezwzględnej widoczną bez hovera,
    // a wyłączony przełącznik „Legenda” dotyczy legendy, której tarcza nie ma.
    const jedna = render(
      <Chart
        config={cfg({
          ...struktura,
          categories: ["Niemcy"],
          series: [{ name: "Udział", values: [70] }],
        })}
        lang="pl"
      />,
    );
    expect(keyRows(jedna.container)).toEqual([["Niemcy", "100%", "70 mld"]]);

    const bezLegendy = render(
      <Chart config={cfg({ ...struktura, showLegend: false })} lang="pl" />,
    );
    expect(keyRows(bezLegendy.container)).toHaveLength(3);
    expect(bezLegendy.container.querySelector("ul[role='list']")).toBeNull();
  });

  it("wskazanie WIERSZA klucza podświetla łuk - i odwrotnie", () => {
    // Klucz i grafika odpowiadają na to samo wskazanie, bo są jednym
    // elementem interfejsu rozłożonym na dwie części. Klucz, który nie
    // reaguje, zmusza czytelnika do szukania łuku po kolorze - czyli do tego,
    // czego tabela miała go oszczędzić.
    const { container } = render(<Chart config={cfg(struktura)} lang="pl" />);
    const wiersze = [...container.querySelectorAll("table.neh-pie-key tbody tr")];
    fireEvent.pointerEnter(wiersze[1]);
    expect(slices(container)[1].getAttribute("data-active")).toBe("true");
    expect(wiersze[1].getAttribute("data-active")).toBe("true");
    fireEvent.pointerLeave(wiersze[1]);
    expect(slices(container)[1].getAttribute("data-active")).toBeNull();

    fireEvent.pointerEnter(slices(container)[2]);
    expect(wiersze[2].getAttribute("data-active")).toBe("true");
  });

  it("PODNIESIENIE PALCA z wiersza klucza nie zdejmuje wskazania", () => {
    // Tabela klucza jest drugą połową tego samego elementu interfejsu co
    // tarcza, więc obowiązuje ją ta sama reguła dotyku, co łuki: na dotyku
    // `pointerleave` przychodzi NATYCHMIAST po podniesieniu palca, w tej samej
    // chwili, w której wskazanie się pojawiło. Wiersz oparty na parze
    // enter/leave tylko mrugał: tapnięcie w nazwę kategorii podświetlało łuk
    // i gasiło go, zanim czytelnik zdążył spojrzeć na tarczę - czyli klucz był
    // na telefonie martwy dokładnie tam, gdzie jest najbardziej potrzebny,
    // bo na małym ekranie łuki są najwęższe.
    //
    // Warunek nazywa DOTYK, nie mysz: rysik ma hover jak mysz, a środowisko,
    // które rodzaju wskaźnika nie podaje, ma dostać zachowanie mysie.
    const { container } = render(
      <PieChart config={cfg({ kind: "donut", ...CWIARTKI })} lang="pl" />,
    );
    const wiersze = [...container.querySelectorAll("table.neh-pie-key tbody tr")];
    fireEvent.pointerEnter(wiersze[2]);
    expect(slices(container)[2].getAttribute("data-active")).toBe("true");

    fireEvent.pointerLeave(wiersze[2], { pointerType: "touch" });
    expect(slices(container)[2].getAttribute("data-active")).toBe("true");
    expect(wiersze[2].getAttribute("data-active")).toBe("true");

    // Zjazd MYSZY zdejmuje - i tak samo zdejmuje wskaźnik bez podanego
    // rodzaju, bo wyjątkiem jest dotyk.
    fireEvent.pointerLeave(wiersze[2], { pointerType: "mouse" });
    expect(slices(container)[2].getAttribute("data-active")).toBeNull();
  });

  it("pusty zestaw daje notę, nie pustą kartę wykresu", () => {
    const pl = render(
      <Chart config={cfg({ kind: "pie", categories: [], series: [] })} lang="pl" />,
    );
    expect(pl.getByText("Brak danych wykresu.")).toBeTruthy();
    const en = render(
      <Chart config={cfg({ kind: "pie", categories: [], series: [] })} lang="en" />,
    );
    expect(en.getByText("No chart data.")).toBeTruthy();
  });

  it("koło i pierścień przechodzą axe w obu językach", async () => {
    for (const lang of ["pl", "en"] as const) {
      for (const kind of ["pie", "donut"] as const) {
        const { container, unmount } = render(
          <Chart config={cfg({ ...struktura, kind })} lang={lang} />,
        );
        fireEvent.click(within(container).getByRole("button", { name: /dane|data/i }));
        const naruszenia = await axeViolations(container);
        expect(naruszenia, `${kind}/${lang}: ${summarize(naruszenia)}`).toEqual([]);
        unmount();
      }
    }
  });

  it("tabela danych podaje TEN SAM udział co tarcza, choć zestaw ma wartość ujemną", () => {
    // Jeden mianownik dla obu dróg: suma DODATNICH (`pieModel`). Rację ma
    // grafika, bo kąt nie umie zakodować wartości ujemnej - gdy tabela
    // sumowała wszystko (mianownik 90 wobec 100 na tarczy), przy "B = 100%"
    // na rysunku jej alternatywa tekstowa podawała "B = 111%" i
    // "A = -11,1%", a udział poza zakresem 0..100% jest bełkotem. Wiersz
    // wartości ujemnej zostaje w tabeli - zajmuje na tarczy 0%.
    const { container } = render(
      <Chart
        config={cfg({
          kind: "pie",
          title: "Saldo",
          categories: ["korekta", "obrót"],
          series: [{ name: "S", values: [-10, 100] }],
        })}
        lang="pl"
      />,
    );
    expect(slices(container)).toHaveLength(1);
    expect(slices(container)[0].getAttribute("aria-label")).toBe("obrót: 100 (100%)");
    const table = openTable(container, "Pokaż dane");
    const udzialy = [...table.querySelectorAll("td.text-right:last-child")].map(
      (td) => td.textContent,
    );
    for (const u of udzialy) {
      expect(u).not.toContain("-");
      expect(Number.parseFloat((u ?? "").replace(",", "."))).toBeLessThanOrEqual(100);
    }
    // Konkretnie: korekta zajmuje 0% tarczy, obrót całe 100%.
    expect(udzialy).toEqual(["0%", "100%"]);
  });
});

describe("PieChart - kontrast palety w OBU motywach", () => {
  // happy-dom nie liczy stylów, więc reguła color-contrast w axe jest
  // wyłączona (`src/test/axe.ts`). Kontrast liczymy wprost z tokenów -
  // ten sam wzorzec, co `src/lib/__tests__/brandContrast.test.ts`.
  const css = readFileSync("src/styles.css", "utf8");
  const LIGHT = css.slice(css.indexOf(":root,"), css.indexOf(".dark {"));
  const DARK = css.slice(css.indexOf(".dark {"), css.indexOf("@layer base"));

  function token(block: string, name: string): string {
    const m = block.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
    if (!m) throw new Error(`brak tokenu ${name}`);
    return m[1].toLowerCase();
  }

  function luminancja(hex: string): number {
    const c = hex.replace("#", "");
    const [r, g, b] = [0, 2, 4]
      .map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function kontrast(a: string, b: string): number {
    const [l1, l2] = [luminancja(a), luminancja(b)].sort((x, y) => y - x);
    return (l1 + 0.05) / (l2 + 0.05);
  }

  const MOTYWY = [
    ["jasny", LIGHT],
    ["ciemny", DARK],
  ] as const;

  it("każdy slot ma zdefiniowany kolor i ink w OBU motywach", () => {
    for (const [nazwa, block] of MOTYWY) {
      for (let n = 1; n <= MAX_SERIES; n++) {
        expect(token(block, `--chart-${n}`), nazwa).toMatch(/^#[0-9a-f]{6}$/);
        expect(token(block, `--chart-ink-${n}`), nazwa).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it("etykieta w wypełnieniu trzyma minimum 3:1 w obu motywach", () => {
    for (const [nazwa, block] of MOTYWY) {
      for (let n = 1; n <= MAX_SERIES; n++) {
        const r = kontrast(token(block, `--chart-${n}`), token(block, `--chart-ink-${n}`));
        expect(r, `${nazwa} slot ${n}: ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("etykieta 12 px w wypełnieniu ma 4,5:1 (WCAG AA) w KAŻDYM slocie i obu motywach", () => {
    // Etykieta udziału to 12 px / waga 600, a linia wartości 11 px / 500 -
    // żadna nie jest "dużym tekstem" (18,66 px bold albo 24 px), więc próg
    // AA wynosi 4,5:1, nie 3:1.
    //
    // NAPRAWIONE W TOKENIE, NIE W KOMPONENCIE, i to jest tu istotne: asercja
    // czyta WYŁĄCZNIE `src/styles.css`, więc żadna zmiana w silniku wykresów
    // nie mogłaby jej spełnić. Para #2a78d6 / #0b0b0b w motywie jasnym dawała
    // 4,458:1 - pękała o cztery setne. Pomiar wszystkich szesnastu par pokazał,
    // że była to JEDYNA poniżej progu (pozostałe od 4,945:1 do 9,090:1),
    // a slot 1 to pierwszy wycinek KAŻDEJ tarczy, czyli najczęstsza etykieta
    // w całym silniku. Tusz slotu 1 w motywie jasnym to teraz czerń pełna:
    // 4,756:1.
    //
    // Ta pętla jest ZAPADKĄ NA CAŁĄ PALETĘ, nie na jeden slot. Dowolna zmiana
    // któregokolwiek z szesnastu tokenów - wypełnienia albo tuszu, w jasnym
    // albo ciemnym motywie - oblewa ją natychmiast, i to jest jedyny sposób,
    // w jaki paleta może być pilnowana: kontrast nie jest widoczny w DOM,
    // więc test renderujący nigdy go nie zobaczy.
    for (const [nazwa, block] of MOTYWY) {
      for (let n = 1; n <= MAX_SERIES; n++) {
        const r = kontrast(token(block, `--chart-${n}`), token(block, `--chart-ink-${n}`));
        expect(r, `${nazwa} slot ${n}: ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("granicę wycinka niesie OBWÓDKA SERII i przerwa, a nie obrys w kolorze karty", () => {
    // ODWRÓCENIE WCZEŚNIEJSZEJ REGUŁY. Obrys 2 px w kolorze karty rozdzielał
    // sąsiednie łuki, ale zajmował miejsce, które w wariancie bladym należy
    // się OBWÓDCE SERII - a obwódka jest tu jedynym nośnikiem tożsamości
    // koloru, bo blade wnętrze go nie niesie (1,20-1,28:1 do płyty). Do tego
    // obrys w kolorze płyty znikał razem z całą granicą wszędzie, gdzie płyta
    // nie jest tym, co pod spodem: w druku, w eksporcie na przezroczystość,
    // na karcie o innym tle.
    //
    // Granicę niosą teraz DWA nośniki naraz: obwódka w mocnym tokenie serii
    // (jej grubość podaje arkusz tokenem `--chart-bar-edge`, bo `var()`
    // w atrybutach prezentacyjnych SVG nie jest wspierane wszędzie)
    // i geometryczna przerwa 2,5 px, która działa również w skali szarości.
    const { container } = render(<PieChart config={cfg({ kind: "pie", ...CWIARTKI })} lang="pl" />);
    slices(container).forEach((s, i) => {
      expect(s.getAttribute("stroke")).toBe(`var(--chart-${i + 1}-edge)`);
      expect(s.getAttribute("fill")).toBe(`var(--chart-${i + 1}-inner)`);
      // Grubość NIE stoi w atrybucie - niesie ją arkusz, więc w motywie
      // ciemnym może zejść do 1,25 px bez gałęzi motywu w JS.
      expect(s.getAttribute("stroke-width")).toBeNull();
    });
    // Kolor karty nie pojawia się już w grafice tarczy.
    expect(container.innerHTML).not.toContain("var(--card)");
  });

  it("grubość obwódki wycinka niesie ARKUSZ, i realnie ją tam podaje", () => {
    // REGRESJA z przeglądu. Wycinek dostawał kolor obwódki, ale ani atrybutu
    // `stroke-width`, ani reguły w arkuszu - jedyny selektor z tokenem
    // `--chart-bar-edge` celował w `.neh-bar[data-edged="true"]`. Łuk jechał
    // więc domyślną grubością SVG (1 px) w obu motywach, a obwódka jest
    // w wariancie bladym JEDYNYM nośnikiem koloru serii, bo wnętrze ma do
    // płyty 1,20-1,28:1.
    //
    // Test czyta ARKUSZ, nie DOM: happy-dom nie ma silnika stylów, więc
    // renderowany wycinek nie powie, jaką grubość dostanie w przeglądarce.
    const regula = css.slice(css.indexOf(".neh-chart .neh-slice {"));
    const blok = regula.slice(0, regula.indexOf("}"));
    expect(blok).toContain("stroke-width: var(--chart-bar-edge");
    // Token jest zdefiniowany w obu motywach i w ciemnym jest CIEŃSZY:
    // jasna linia na ciemnym tle optycznie grubieje. Czytamy go osobnym
    // odczytem, bo `token` wyżej przyjmuje wyłącznie hexy.
    const px = (block: string): number => {
      const m = block.match(/--chart-bar-edge:\s*([\d.]+)px/);
      if (!m) throw new Error("brak tokenu --chart-bar-edge");
      return Number.parseFloat(m[1]);
    };
    const jasny = px(LIGHT);
    const ciemny = px(DARK);
    expect(jasny).toBeGreaterThan(ciemny);
    expect(ciemny).toBeGreaterThan(1);
  });

  it("przełączenie motywu NIE zmienia DOM - kolory jadą tokenami, zero zapieczonego hexa", () => {
    // Identyfikatory z `useId` LICZĄ SIĘ OD MONTOWANIA, nie od motywu: drugi
    // render tego samego komponentu dostaje `_r_29_` tam, gdzie pierwszy miał
    // `_r_28_`. Porównanie bajt w bajt zapaliłoby się więc na zmianie, która
    // z motywem nie ma nic wspólnego - a pytanie tego testu brzmi wyłącznie
    // „czy motyw zmienia rysunek". Normalizujemy je przed porównaniem.
    const bezId = (html: string): string => html.replace(/_r_[0-9a-z]+_/g, "ID");
    const config = cfg({ kind: "donut", unit: " mld", ...CWIARTKI });
    const jasny = render(<PieChart config={config} lang="pl" />);
    const html = jasny.container.innerHTML;
    jasny.unmount();

    document.documentElement.classList.add("dark");
    const ciemny = render(<PieChart config={config} lang="pl" />);
    expect(bezId(ciemny.container.innerHTML)).toBe(bezId(html));
    // Cały kolor grafiki to var(...) - inaczej motyw ciemny dostałby jasną paletę.
    expect(html).not.toMatch(/(fill|stroke)="#[0-9a-f]{3,8}"/i);
  });
});

describe("PieChart - izolacja przestrzeni roboczych", () => {
  const alfa = parseChartConfig({
    kind: "donut",
    title: "Leady - workspace alfa",
    unit: " szt.",
    categories: ["Alfa Q1", "Alfa Q2"],
    series: [{ name: "Kampania alfa", values: [33, 11] }],
  });
  const beta = parseChartConfig({
    kind: "donut",
    title: "Leady - workspace beta",
    unit: " szt.",
    categories: ["Beta Q1", "Beta Q2"],
    series: [{ name: "Kampania beta", values: [70, 30] }],
  });

  it("podmiana configu wymiata dane poprzedniej przestrzeni z tarczy, sumy i tooltipa", () => {
    const { container, rerender } = render(<PieChart config={alfa} lang="pl" />);
    fireEvent.pointerEnter(slices(container)[0]);
    expect(tip(container)?.textContent).toBe("Alfa Q175%33 szt.");

    rerender(<PieChart config={beta} lang="pl" />);

    // Ten sam, ŻYWY komponent - hover z alfy musi się przemalować na betę.
    expect(tip(container)?.textContent).toBe("Beta Q170%70 szt.");
    expect(container.querySelector("[role='group']")?.getAttribute("aria-label")).toBe(
      "Wykres: Leady - workspace beta",
    );
    // Wskazanie z alfy zostaje na tej samej POZYCJI, więc środek pokazuje
    // pierwszy segment BETY, nie sumę - i to jest poprawne: gdyby pokazywał
    // dalej 44 szt. (sumę alfy) albo "Alfa Q1", byłby to wyciek danych
    // z poprzedniej przestrzeni roboczej. Po zejściu wskaźnika wraca do sumy
    // bety, co pilnuje test przełączania środka wyżej.
    expect(all(container, SEL.center).map((t) => t.textContent)).toEqual(["70", "Beta Q1 · szt."]);
    const html = container.innerHTML;
    for (const slad of ["Alfa", "alfa", "33 szt.", "11 szt.", "44 szt."]) {
      expect(html, slad).not.toContain(slad);
    }
  });

  it("podmiana na KRÓTSZY zestaw przy aktywnym wycinku nie zostawia widmowego tooltipa", () => {
    const waski = parseChartConfig({
      kind: "pie",
      categories: ["Beta Q1"],
      series: [{ name: "Kampania beta", values: [9] }],
    });
    const { container, rerender } = render(<PieChart config={alfa} lang="pl" />);
    fireEvent.pointerEnter(slices(container)[1]);
    expect(tip(container)?.textContent).toContain("Alfa Q2");

    // `active` = 1 przeżywa podmianę, a nowy zestaw ma jeden wycinek.
    expect(() => rerender(<PieChart config={waski} lang="pl" />)).not.toThrow();
    expect(tip(container)).toBeNull();
    expect(container.innerHTML).not.toContain("Alfa");
  });
});

describe("PieChart - suma kontrolna udziałów", () => {
  // Ta sama reguła co suma kontrolna mostka: struktura, która się nie domyka,
  // jest BŁĘDEM, a nie kwestią gustu - i jest to defekt sprawdzalny
  // arytmetycznie, więc się go sprawdza, zamiast liczyć na czujność autora.
  //
  // SPRAWDZANE SĄ DANE AUTORA, NIE ARYTMETYKA MODELU. Udziały policzone przez
  // model dzielą wartości przez ich własną sumę, więc sumują się do stu
  // procent z definicji; sprawdzanie ich nie mogłoby wykryć niczego. Realny
  // defekt jest inny: autor wkleja gotowe udziały sumujące się do 90%, a
  // tarcza przeskalowuje je po cichu, więc liczba na łuku (33%) rozjeżdża się
  // z liczbą w tabeli danych (30%).
  const udzialy = (values: (number | null)[], unit = "%"): Record<string, Json> => ({
    kind: "donut",
    unit,
    categories: values.map((_, i) => `K${i + 1}`),
    series: [{ name: "Udział", values }],
  });

  it("udziały sumujące się do 90% dostają ostrzeżenie z PODANĄ sumą", () => {
    const { container } = render(<Chart config={cfg(udzialy([30, 30, 30]))} lang="pl" />);
    expect(container.textContent).toContain("sumują się do 90,0%");
    // Dowód rozjazdu, o którym mówi ostrzeżenie: łuk pokazuje 33%, a tabela
    // danych wartość podaną przez autora, czyli 30%.
    expect(all(container, SEL.label).map((t) => t.textContent)).toEqual(["33%", "33%", "33%"]);
  });

  it("104% też jest błędem - nadmiar znaczy podwójnie liczoną kategorię", () => {
    const { container } = render(<Chart config={cfg(udzialy([54, 30, 20]))} lang="pl" />);
    expect(container.textContent).toContain("sumują się do 104,0%");
  });

  it("trzy równe udziały podane jako 33,3 MILCZĄ - to zaokrąglenie autora", () => {
    // 99,9% mieści się w tolerancji pół punktu. Ostrzeżenie o zaokrągleniu
    // w arkuszu byłoby ostrzeżeniem, które widać zawsze.
    const { container } = render(<Chart config={cfg(udzialy([33.3, 33.3, 33.3]))} lang="pl" />);
    expect(container.textContent).not.toContain("sumują się do");
  });

  it("UJEMNY udział nie umyka sumie kontrolnej", () => {
    // REGRESJA z przeglądu. Suma kontrolna liczyła z MIANOWNIKA TARCZY, czyli
    // z sumy dodatnich - a zestaw [-10, 100] daje mianownik 100, więc suma
    // wychodziła "domknięta", choć autor podał udziały sumujące się do 90
    // i jedna kategoria w ogóle nie weszła na tarczę. Ujemny udział jest sam
    // w sobie bezsensem, więc ostrzeżenie jest tam tym bardziej na miejscu.
    const { container } = render(<Chart config={cfg(udzialy([-10, 100]))} lang="pl" />);
    expect(container.textContent).toContain("sumują się do 90,0%");
  });

  it("BRAK wartości nie jest deklaracją zera - luka nie psuje sumy", () => {
    // Kategoria bez liczby to kategoria nieuzupełniona, a nie zerowa: gdyby
    // luki wchodziły do sumy jako zera, każdy zestaw w trakcie wypełniania
    // krzyczałby ostrzeżeniem. Zero podane WPROST jest deklaracją i wchodzi.
    const zLuka = render(<Chart config={cfg(udzialy([60, 40, null]))} lang="pl" />);
    expect(zLuka.container.textContent).not.toContain("sumują się do");
    const zZerem = render(<Chart config={cfg(udzialy([60, 40, 0]))} lang="pl" />);
    expect(zZerem.container.textContent).not.toContain("sumują się do");
  });

  it("dane, które NIE są udziałami, nie mają czego sprawdzać", () => {
    // Cztery kwartały po 25 mln sumują się do 100, a cztery po 30 mln do 120 -
    // i ani jedno, ani drugie nie jest błędem struktury. Model MILCZY
    // (`shareSumOk === null`), zamiast zaświadczać albo ostrzegać, dokładnie
    // jak mostek bez jawnego stanu końcowego.
    for (const zestaw of [
      udzialy([30, 30, 30], " mln"),
      udzialy([25, 25, 25, 25], " mln"),
      udzialy([30, 30, 30], ""),
    ]) {
      const { container } = render(<Chart config={cfg(zestaw)} lang="pl" />);
      expect(container.textContent).not.toContain("sumują się do");
    }
  });

  it("ostrzeżenie jest przetłumaczone i stoi PRZY RYSUNKU, nie w tabeli", () => {
    // Nie jest to przypis do tabeli danych: mówi, że struktura POKAZANA NA
    // RYSUNKU się nie domyka, więc musi być widoczne bez rozwijania panelu -
    // tak samo jak ostrzeżenie o uciętej osi.
    const { container } = render(<Chart config={cfg(udzialy([30, 30, 30]))} lang="en" />);
    expect(container.textContent).toContain("add up to 90.0%");
    const panel = container.querySelector("[hidden]");
    expect(panel?.textContent).not.toContain("add up to");
  });
});
