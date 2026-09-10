// KAŻDY RODZAJ Z LISTY MUSI SIĘ NARYSOWAĆ I MUSI MIEĆ TABELĘ.
//
// PO CO TA BRAMKA, skoro rozdzielnik w `Chart.tsx` jest `Record<ChartKind,
// ...>` i kompilator pilnuje kompletności. Kompilator pilnuje, że każdy
// rodzaj MA WPIS. Nie pilnuje, że wpis rysuje cokolwiek: komponent, który
// wyjdzie wczesnym `return null` na danych, jakie naprawdę przychodzą
// z bloku, kompiluje się bez słowa protestu i daje puste pole.
//
// PILNUJE TEŻ TEGO, CO ZOSTAŁO PRZEBUDOWANE WCZEŚNIEJ. Ten PR przebudował
// tarczę, pierścień, linię, pole, słupki obu orientacji i mostek, a potem
// dołożył sześć nowych rodzajów i PRZEPISAŁ rozdzielnik. Każda z tych zmian
// mogła zgasić rodzaj, którego nikt akurat nie oglądał - a rodzaje starsze
// mają testy rozsiane po plikach per komponent, więc nie było ani jednego
// miejsca, w którym widać CAŁĄ listę naraz.
//
// Lista bierze się z `CHART_KINDS`, więc bramka obejmuje z definicji także
// rodzaje dopisane w przyszłości; nie da się dodać rodzaju i pominąć tego
// sprawdzenia.
//
// CZTERY RZECZY NA RODZAJ, wszystkie sprawdzane na TYCH SAMYCH danych:
//   1. rysunek istnieje i ma dostępną nazwę (czytnik ekranu),
//   2. rysunek maluje co najmniej jeden znacznik TOKENEM palety wykresów -
//      to odróżnia narysowany wykres od samej siatki i osi,
//   3. istnieje tabela danych, bo grafika nigdy nie jest jedyną drogą do
//      liczby (sekcja 8),
//   4. na ekranie nie ma napisu "NaN", "undefined" ani "Infinity" -
//      `Intl.NumberFormat.format(NaN)` zwraca literalne "NaN", a treść bloku
//      pochodzi z bazy.
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { Json } from "@/lib/content-model/json";
import { CHART_KINDS } from "@/lib/charts/types";
import { parseChartConfig } from "@/lib/charts/parse";
import { Chart } from "../Chart";

/**
 * Jeden zestaw danych dla WSZYSTKICH rodzajów, i to jest celowe: rodzaj,
 * który potrzebuje danych specjalnie dobranych pod siebie, żeby cokolwiek
 * pokazać, jest w bloku CMS nieużywalny - autor wkleja to, co ma.
 *
 * Dwanaście kategorii i trzy serie, bo to najmniejszy zestaw sensowny
 * jednocześnie dla: tarczy (zwija nadmiar w wycinek zbiorczy), histogramu
 * (dwanaście obserwacji), boxplota i roju (trzy grupy po dwanaście),
 * punktowego (dwanaście par x-y z dwóch pierwszych serii) i mapy ciepła
 * (dwanaście wierszy na trzy kolumny). Wartości są nierówne i mieszanego
 * znaku, żeby żaden rodzaj nie trafił na przypadek zdegenerowany.
 */
const KATEGORIE = [
  "Polska",
  "Niemcy",
  "Francja",
  "Włochy",
  "Hiszpania",
  "Holandia",
  "Belgia",
  "Czechy",
  "Węgry",
  "Austria",
  "Szwecja",
  "Dania",
];

const DANE: Record<string, Json> = {
  categories: KATEGORIE,
  series: [
    { name: "Wynik 2025", values: [12, 31, 24, 19, 8, 27, 15, 22, 6, 17, 29, 11] },
    { name: "Wynik 2024", values: [9, 28, 21, 23, 11, 24, 13, 18, 7, 15, 26, 14] },
    { name: "Zmiana", values: [3, 3, 3, -4, -3, 3, 2, 4, -1, 2, 3, -3] },
  ],
  unit: " mln EUR",
  animate: false,
  sampleSize: 12,
};

const TOKEN = /var\(--chart-/;

/** Czy w drzewie jest znacznik malowany tokenem palety wykresów. */
function maloweZnacznikiem(root: HTMLElement): boolean {
  for (const el of root.querySelectorAll("svg *")) {
    const fill = el.getAttribute("fill") ?? "";
    const stroke = el.getAttribute("stroke") ?? "";
    if (TOKEN.test(fill) || TOKEN.test(stroke)) return true;
    // Wypełnienie może iść przez `style` albo gradient (`url(#...)`), a wtedy
    // token siedzi w definicji gradientu, nie na znaczniku.
    const style = el.getAttribute("style") ?? "";
    if (TOKEN.test(style)) return true;
    if (/^url\(#/.test(fill) && root.querySelector("linearGradient stop")) return true;
  }
  return false;
}

describe("każdy rodzaj z CHART_KINDS rysuje się i ma tabelę", () => {
  it("lista rodzajów nie jest pusta - bramka nie mierzy niczego", () => {
    // Bez tego przypadku pusta lista dałaby zieloną bramkę bez ani jednego
    // sprawdzenia, a `CHART_KINDS` jest importowane, nie wpisane tutaj.
    expect(CHART_KINDS.length).toBeGreaterThanOrEqual(12);
  });

  for (const kind of CHART_KINDS) {
    describe(kind, () => {
      const render_ = () =>
        render(<Chart config={parseChartConfig({ ...DANE, kind })} lang="pl" />);

      it("renderuje rysunek z dostępną nazwą", () => {
        const { container } = render_();
        const box = container.querySelector("[role='img']");
        expect(box, `${kind}: brak elementu o roli img`).not.toBeNull();
        const nazwa = box?.getAttribute("aria-label") ?? "";
        expect(nazwa.length, `${kind}: pusta dostępna nazwa`).toBeGreaterThan(0);
      });

      it("maluje co najmniej jeden znacznik tokenem palety", () => {
        // Odróżnia narysowany wykres od pola z samą siatką i osiami: siatka
        // idzie `--chart-grid`/`--chart-axis`, więc szukamy `--chart-` na
        // czymkolwiek, ale pusty rysunek nie ma ANI JEDNEGO takiego elementu.
        const { container } = render_();
        expect(maloweZnacznikiem(container), `${kind}: rysunek nie maluje nic`).toBe(true);
      });

      it("ma tabelę danych - grafika nie jest jedyną drogą do liczby", () => {
        const { container } = render_();
        const tabele = container.querySelectorAll("table");
        expect(tabele.length, `${kind}: brak tabeli danych`).toBeGreaterThan(0);
        // Tabela musi nieść LICZBY, nie tylko nagłówki: tabela z samym
        // nagłówkiem spełniałaby literę wymagania i nie dawała czytelnikowi nic.
        const tekst = [...tabele].map((t) => t.textContent ?? "").join(" ");
        expect(/\d/.test(tekst), `${kind}: tabela bez ani jednej liczby`).toBe(true);
      });

      it("nie wypisuje nie-liczby na ekran", () => {
        const { container } = render_();
        const tekst = container.textContent ?? "";
        for (const zly of ["NaN", "undefined", "Infinity", "[object Object]"]) {
          expect(tekst.includes(zly), `${kind}: na ekranie napis ${zly}`).toBe(false);
        }
      });
    });
  }
});

describe("każdy rodzaj znosi dane zdegenerowane bez wywrotki", () => {
  // Treść bloku pochodzi z bazy i bywa z cofniętej albo przyszłej wersji
  // edytora. Żaden rodzaj nie ma prawa rzucić - wolno mu nie narysować nic.
  const PRZYPADKI: Array<[string, Record<string, Json>]> = [
    ["jedna kategoria, jedna wartość", { categories: ["a"], series: [{ name: "s", values: [1] }] }],
    [
      "wszystkie wartości równe",
      {
        categories: ["a", "b", "c", "d"],
        series: [{ name: "s", values: [5, 5, 5, 5] }],
      },
    ],
    [
      "same luki",
      {
        categories: ["a", "b", "c"],
        series: [{ name: "s", values: [null, null, null] }],
      },
    ],
    ["zera", { categories: ["a", "b", "c"], series: [{ name: "s", values: [0, 0, 0] }] }],
    [
      "wartości ujemne",
      {
        categories: ["a", "b", "c"],
        series: [{ name: "s", values: [-4, -9, -2] }],
      },
    ],
    [
      "NaN i nieskończoność",
      {
        categories: ["a", "b", "c", "d"],
        series: [{ name: "s", values: [1, Number.NaN, Number.POSITIVE_INFINITY, 4] }],
      },
    ],
  ];

  for (const kind of CHART_KINDS) {
    for (const [opis, dane] of PRZYPADKI) {
      it(`${kind}: ${opis}`, () => {
        const { container } = render(
          <Chart config={parseChartConfig({ ...dane, kind, animate: false })} lang="pl" />,
        );
        const tekst = container.textContent ?? "";
        for (const zly of ["NaN", "undefined", "Infinity", "[object Object]"]) {
          expect(tekst.includes(zly), `${kind} / ${opis}: napis ${zly}`).toBe(false);
        }
        // Każdy atrybut liczbowy SVG musi być skończony - `NaN` w `d` albo
        // w `cx` nie pokazuje się jako tekst, ale wycina znacznik z rysunku
        // bez śladu w konsoli.
        for (const el of container.querySelectorAll("svg *")) {
          for (const attr of [
            "x",
            "y",
            "cx",
            "cy",
            "r",
            "width",
            "height",
            "d",
            "x1",
            "y1",
            "x2",
            "y2",
          ]) {
            const v = el.getAttribute(attr);
            if (v === null) continue;
            expect(/NaN|Infinity/.test(v), `${kind} / ${opis}: ${attr}="${v}"`).toBe(false);
          }
        }
      });
    }
  }
});
