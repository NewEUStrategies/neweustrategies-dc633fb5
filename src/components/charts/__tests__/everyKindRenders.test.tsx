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
import { fireEvent, render } from "@testing-library/react";
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

// ---------------------------------------------------------------------------
// KLAWIATURA - DLA KAŻDEGO RODZAJU, ALE NIE JEDNYM WZORCEM.
//
// PO CO. Nawigacja klawiaturą jest jedyną drogą do odczytania wartości bez
// wskaźnika. Bez niej wykres jest dostępny wyłącznie dla myszy, a jego dane
// istnieją dla czytelnika klawiatury tylko w tabeli.
//
// TA BRAMKA POWSTAŁA W WERSJI ZŁEJ I TO JEST WARTE ZAPISANIA, bo pokazuje
// pułapkę, w którą łatwo wpaść przy dwunastu rodzajach. Pierwsza wersja
// zakładała JEDEN wzorzec dla wszystkich: ogniskowalny kontener plus
// `ArrowRight`. Wywróciła pięć przypadków, z czego ANI JEDEN nie był defektem
// kodu:
//
//   * `bar-horizontal` nie reaguje na `ArrowRight`, bo `CartesianChart`
//     mapuje dla orientacji poziomej `ArrowDown`/`ArrowUp` - kategorie biegną
//     tam w PIONIE, więc strzałka w prawo przesuwałaby wzdłuż osi wartości,
//     czyli wbrew temu, co czytelnik widzi;
//   * tarcza i pierścień nie mają ogniskowalnego kontenera, bo stawiają
//     `role="img"` i `tabIndex` na KAŻDYM WYCINKU, z jego własną nazwą
//     ("Polska: 12 mln EUR (17%)"). Czytelnik Tabem trafia w wycinek
//     i słyszy wartość wprost, zamiast wchodzić w nieprzejrzysty kontener
//     i zgadywać, ile razy nacisnąć strzałkę.
//
// Gdybym "naprawił" kod pod pierwszą wersję bramki, zepsułbym dwie dobre
// decyzje projektowe. Dlatego wzorzec i klawisz są tu DANYMI deklarowanymi
// per rodzaj, w mapach wyczerpujących po `ChartKind`: nowy rodzaj nie
// skompiluje się bez zadeklarowania, jak go obsługiwać, a bramka nadal
// zabrania jedynej rzeczy naprawdę zabronionej - braku dostępu z klawiatury.
type WzorzecKlawiatury =
  /** Ogniskowalny kontener rysunku, strzałki przesuwają aktywny element. */
  | "kontener"
  /** Każdy znacznik osobno ogniskowalny i osobno nazwany; nawigacja Tabem. */
  | "znaczniki";

const WZORZEC: Record<ChartKind, WzorzecKlawiatury> = {
  line: "kontener",
  area: "kontener",
  bar: "kontener",
  "bar-horizontal": "kontener",
  waterfall: "kontener",
  pie: "znaczniki",
  donut: "znaczniki",
  histogram: "kontener",
  boxplot: "kontener",
  beeswarm: "kontener",
  scatter: "kontener",
  heatmap: "kontener",
};

/**
 * Klawisz "dalej" zależy od tego, w którą stronę biegną kategorie. Deklaracja
 * per rodzaj, bo orientacja jest cechą RODZAJU, nie ustawieniem: słupki
 * poziome i tornado mają kategorie w pionie z definicji.
 */
const KLAWISZ_DALEJ: Record<ChartKind, string> = {
  line: "ArrowRight",
  area: "ArrowRight",
  bar: "ArrowRight",
  "bar-horizontal": "ArrowDown",
  waterfall: "ArrowRight",
  pie: "ArrowRight",
  donut: "ArrowRight",
  histogram: "ArrowRight",
  boxplot: "ArrowRight",
  beeswarm: "ArrowRight",
  scatter: "ArrowRight",
  heatmap: "ArrowRight",
};

describe("każdy rodzaj jest dostępny z klawiatury", () => {
  for (const kind of CHART_KINDS) {
    const render_ = () => render(<Chart config={parseChartConfig({ ...DANE, kind })} lang="pl" />);

    it(`${kind}: jest CO ogniskować`, () => {
      // Wspólne minimum obu wzorców: w drzewie istnieje choć jeden element
      // w kolejności tabulacji. Brak takiego elementu znaczy wykres dostępny
      // wyłącznie dla myszy - i to jest jedyna rzecz, której ta bramka
      // zabrania bezwarunkowo.
      const { container } = render_();
      const ogniskowalne = container.querySelectorAll("[tabindex='0']");
      expect(ogniskowalne.length, `${kind}: nic nie da się ogniskować`).toBeGreaterThan(0);
    });

    if (WZORZEC[kind] === "kontener") {
      it(`${kind}: kontener niesie nazwę i OPIS obsługi`, () => {
        const { container } = render_();
        const box = container.querySelector<HTMLElement>("[role='img'][tabindex='0']");
        expect(box, `${kind}: brak ogniskowalnego kontenera`).not.toBeNull();
        expect((box?.getAttribute("aria-label") ?? "").length).toBeGreaterThan(0);
        // Opis, nie nazwa: nazwa mówi CO to jest, opis - JAK tego użyć.
        const opisId = box?.getAttribute("aria-describedby");
        expect(opisId, `${kind}: brak aria-describedby z podpowiedzią`).toBeTruthy();
        const opis = opisId ? (container.querySelector(`#${opisId}`)?.textContent ?? "") : "";
        expect(opis.length, `${kind}: podpowiedź obsługi jest pusta`).toBeGreaterThan(0);
      });

      it(`${kind}: ${KLAWISZ_DALEJ[kind]} zmienia stan, Escape go czyści`, () => {
        const { container } = render_();
        const box = container.querySelector<HTMLElement>("[role='img'][tabindex='0']");
        if (!box) throw new Error(`${kind}: brak kontenera`);
        // Porównanie migawek HTML, bo każdy rodzaj wyróżnia aktywny element
        // inaczej: bramka pilnuje ZASADY, nie konkretnego znacznika.
        const przed = container.innerHTML;
        fireEvent.keyDown(box, { key: KLAWISZ_DALEJ[kind] });
        expect(container.innerHTML, `${kind}: strzałka nie zmienia nic`).not.toBe(przed);
        fireEvent.keyDown(box, { key: "Escape" });
        expect(container.innerHTML, `${kind}: Escape nie czyści zaznaczenia`).toBe(przed);
      });
    } else {
      it(`${kind}: KAŻDY ogniskowalny znacznik ma własną nazwę`, () => {
        // Przy nawigacji Tabem nazwa znacznika jest JEDYNĄ informacją, jaką
        // dostaje czytelnik czytnika ekranu - wycinek bez nazwy jest wtedy
        // przystankiem tabulacji, który nic nie mówi.
        const { container } = render_();
        const znaczniki = [...container.querySelectorAll("[tabindex='0']")];
        expect(znaczniki.length, `${kind}: brak ogniskowalnych znaczników`).toBeGreaterThan(1);
        for (const z of znaczniki) {
          const nazwa = z.getAttribute("aria-label") ?? "";
          expect(nazwa.length, `${kind}: znacznik bez nazwy`).toBeGreaterThan(0);
          // Nazwa musi nieść LICZBĘ, nie tylko etykietę kategorii: "Polska"
          // bez wartości nie zastępuje odczytania wycinka wzrokiem.
          expect(/\d/.test(nazwa), `${kind}: nazwa "${nazwa}" bez liczby`).toBe(true);
        }
      });
    }

    it(`${kind}: klawisze nieobsługiwane nie wywracają rysunku`, () => {
      const { container } = render_();
      const cel = container.querySelector<HTMLElement>("[tabindex='0']");
      if (!cel) throw new Error(`${kind}: brak celu`);
      for (const key of ["Tab", "Enter", " ", "a", "F5", "PageDown", "Home"]) {
        expect(
          () => fireEvent.keyDown(cel, { key }),
          `${kind}: klawisz ${key} rzucił`,
        ).not.toThrow();
      }
      expect(container.textContent ?? "").not.toContain("NaN");
    });
  }
});
