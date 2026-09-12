// SŁUPEK SKUMULOWANY 100% - CO MUSI BYĆ PRAWDĄ O RYSUNKU.
//
// DLACZEGO KONFIGURACJA JEST BEZ KLUCZA `kind`. Model czyta `categories`
// i `series`, a nie `config.kind` (sprawdzone: `grep -n "config.kind"
// src/lib/charts/kinds/percentStacked.ts` nie zwraca nic), więc rodzaj
// w konfiguracji nie ma dla tych testów znaczenia - a rodzaj "percent-stacked"
// nie jest jeszcze w `CHART_KINDS`, bo podłączenie robi osobna zmiana.
// Podłączenia pilnuje bramka `everyKindRenders.test.tsx`, nie ten plik.
//
// SKĄD BIORĘ LICZBY. `useContainerWidth` czyta `clientWidth`, które w happy-dom
// wynosi 0, więc szerokość zostaje na wartości startowej 720 - geometria jest
// w pełni deterministyczna i wolno asertować piksele. Przy domyślnej wysokości
// 320 px: padLeft 40 (szerokość napisu „100%" plus odstęp), innerW 668,
// padTop 12, padBottom 24, innerH 284, więc krawędź odniesienia leży na
// y = 296, a szczyt stosu na y = 12.
// `useRevealOnScroll` nigdy nie dostaje callbacku IntersectionObservera, więc
// stan to zawsze "static", czyli dokładnie to, co widzi crawler.
//
// CZEGO TU NIE MA. Arytmetyka udziałów (metoda największych reszt, odrzucanie
// słupków, brzeg serii, sumy kontrolne) ma własny plik testowy przy modelu.
// Tutaj sprawdzam wyłącznie to, czego model sprawdzić nie może: czy RYSUNEK
// mówi to, co model policzył.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import type { Json } from "@/lib/content-model/json";
import { parseChartConfig } from "@/lib/charts/parse";
import type { ChartConfig } from "@/lib/charts/types";
import { PERCENT_STACKED_LABEL_MIN_SHARE } from "@/lib/charts/kinds/percentStacked";
import { FONT_AXIS } from "@/lib/charts/geometry";
import { WRAP_LINE_EM } from "@/lib/charts/labels";
import { estimateLabelWidth } from "@/lib/charts/measureText";
import { PercentStackedChart } from "../PercentStackedChart";
import { slotForSeries } from "@/lib/charts/palette";

function cfg(data: Record<string, Json>): ChartConfig {
  return parseChartConfig({ animate: false, ...data });
}

const all = (root: HTMLElement, sel: string): Element[] => [...root.querySelectorAll(sel)];
const num = (el: Element, attr: string): number => Number(el.getAttribute(attr));
const tekst = (root: HTMLElement, sel: string): string[] =>
  all(root, sel).map((e) => e.textContent ?? "");

/** Krawędź odniesienia i szczyt stosu przy domyślnej wysokości - patrz nagłówek. */
const Y_ZERA = 296;
const Y_STU = 12;
const INNER_H = 284;

/**
 * Pionowy zasięg segmentu odczytany ze ŚCIEŻKI, bo segment jest `<path>`, nie
 * `<rect>`: zaokrągla się wyłącznie koniec danych, więc kształty są dwa.
 * Segment zwykły idzie `M x y h w v h ...` (punkt startowy w lewym GÓRNYM
 * narożniku), segment domykający stos `M x y v -(h-r) q ...` (punkt startowy
 * w lewym DOLNYM narożniku, bo od niego zaczyna się prosta krawędź).
 */
function zasieg(el: Element): { gora: number; dol: number; x: number } {
  const d = el.getAttribute("d") ?? "";
  const proste = /^M([-\d.]+) ([-\d.]+)h([-\d.]+)v([-\d.]+)h/.exec(d);
  if (proste) {
    const gora = Number(proste[2]);
    return { gora, dol: gora + Number(proste[4]), x: Number(proste[1]) };
  }
  const zaokraglone = /^M([-\d.]+) ([-\d.]+)v([-\d.]+)q0 ([-\d.]+) /.exec(d);
  if (zaokraglone === null) throw new Error(`nieznany kształt segmentu: ${d}`);
  const dol = Number(zaokraglone[2]);
  return {
    dol,
    gora: dol + Number(zaokraglone[3]) + Number(zaokraglone[4]),
    x: Number(zaokraglone[1]),
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

/**
 * Trzy kategorie o TEJ SAMEJ strukturze co do kolejności serii i CAŁKOWICIE
 * różnych wielkościach całości: 100 000, 10 000 i 5 000. To jest zestaw
 * dobrany pod ryzyko tej formy - trzy słupki równej wysokości, z których
 * pierwszy jest dwudziestokrotnie większy od trzeciego.
 */
const BAZA: Record<string, Json> = {
  categories: ["Polska", "Niemcy", "Francja"],
  series: [
    { name: "Usługi", values: [60000, 5000, 2000] },
    { name: "Przemysł", values: [30000, 3000, 2000] },
    { name: "Rolnictwo", values: [10000, 2000, 1000] },
  ],
  unit: "",
};

const SEG = "[data-role='segment']";
const ETYKIETA = "[data-role='segment-label']";
const PODZIALKA = "text.tabular-nums[fill='var(--muted-foreground)']";

describe("PercentStackedChart - geometria: co koduje długość, gdzie jest zero", () => {
  it("DŁUGOŚĆ SEGMENTU koduje UDZIAŁ, nie wartość bezwzględną", () => {
    // TO JEST NAJWAŻNIEJSZA ASERCJA TEGO PLIKU i jednocześnie definicja
    // rodzaju. Usługi w Niemcach to 5 000 wobec 30 000 przemysłu w Polsce,
    // czyli SZEŚĆ RAZY MNIEJ - a ich segment musi być DŁUŻSZY, bo udział
    // wynosi 50% wobec 30%. Defekt, który ten test łapie: narysowanie stosu
    // na wartościach surowych (czyli kartezjański `stacked` bez normalizacji),
    // po którym wszystkie trzy słupki miałyby różną wysokość, a rysunek
    // odpowiadałby na inne pytanie niż to, po które się do tej formy przyszło.
    const { container } = render(<PercentStackedChart config={cfg(BAZA)} lang="pl" />);
    const dlugosc = (bar: number, seria: number): number => {
      const el = container.querySelector(`${SEG}[data-bar='${bar}'][data-series='${seria}']`);
      if (!el) throw new Error(`brak segmentu ${bar}/${seria}`);
      const z = zasieg(el);
      return z.dol - z.gora;
    };
    // 60% i 30% tej samej całości: dokładnie dwa razy.
    expect(dlugosc(0, 0) / dlugosc(0, 1)).toBeCloseTo(2, 5);
    // 50% z 10 000 wobec 30% z 100 000.
    expect(dlugosc(1, 0)).toBeGreaterThan(dlugosc(0, 1));
    // Ten sam udział (20%) w dwóch całościach różniących się dwukrotnie daje
    // DOKŁADNIE tę samą długość - i to jest cała obietnica normalizacji.
    expect(dlugosc(1, 2)).toBeCloseTo(dlugosc(2, 2), 5);
  });

  it("KAŻDY słupek kończy się dokładnie na stu procentach, bez szczeliny u szczytu", () => {
    // Defekt, który to łapie: liczenie mianownika inną drogą niż suma
    // narastająca krawędzi. Różnica o epsilon zostawia u szczytu stosu
    // włosową szczelinę, którą czytelnik czyta jako „czegoś tu brakuje" -
    // a w formie, której cała treść to „to jest całość", jest to kłamstwo.
    const { container } = render(<PercentStackedChart config={cfg(BAZA)} lang="pl" />);
    for (const bar of [0, 1, 2]) {
      const segmenty = all(container, `${SEG}[data-bar='${bar}']`).map(zasieg);
      expect(segmenty.length, `słupek ${bar}`).toBe(3);
      const suma = segmenty.reduce((a, z) => a + (z.dol - z.gora), 0);
      // Suma długości segmentów równa się wysokości pola rysunku, czyli oś
      // od zera do stu jest wypełniona co do piksela.
      expect(suma, `słupek ${bar}`).toBeCloseTo(INNER_H, 5);
      expect(Math.min(...segmenty.map((z) => z.gora)), `szczyt ${bar}`).toBeCloseTo(Y_STU, 5);
      expect(Math.max(...segmenty.map((z) => z.dol)), `podstawa ${bar}`).toBeCloseTo(Y_ZERA, 5);
    }
  });

  it("segmenty STYKAJĄ SIĘ krawędziami - stos nie ma przerw w środku", () => {
    // Przerwa między segmentami twierdziłaby, że w strukturze jest część
    // nieprzypisana do żadnej serii. Prześwit jest tu OBWÓDKĄ w kolorze płyty,
    // czyli nie zabiera miejsca geometrii - dlatego krawędzie muszą się
    // pokrywać co do piksela, a nie „prawie".
    const { container } = render(<PercentStackedChart config={cfg(BAZA)} lang="pl" />);
    const segmenty = all(container, `${SEG}[data-bar='0']`).map(zasieg);
    for (let i = 1; i < segmenty.length; i += 1) {
      expect(segmenty[i].dol).toBeCloseTo(segmenty[i - 1].gora, 5);
    }
  });

  it("ZERO leży na krawędzi odniesienia, a zaokrąglony jest TYLKO koniec danych", () => {
    // Sekcja 3: podstawa słupka jest kwadratowa, zaokrągla się wyłącznie
    // koniec danych. Defekt, który to łapie: zaokrąglenie podstawy odsuwa masę
    // słupka od zera i sugeruje, że struktura zaczyna się gdzieś wyżej - ten
    // sam błąd co ucięta oś, tylko wyglądający nieszkodliwie. W stosie końcem
    // danych jest górna krawędź OSTATNIEGO widocznego segmentu, więc łuk ma
    // prawo być dokładnie w jednym segmencie na słupek.
    const { container } = render(<PercentStackedChart config={cfg(BAZA)} lang="pl" />);
    const os = all(container, "line[stroke='var(--chart-axis)']");
    expect(os).toHaveLength(1);
    expect(num(os[0], "y1")).toBeCloseTo(Y_ZERA, 5);
    for (const bar of [0, 1, 2]) {
      const zLukiem = all(container, `${SEG}[data-bar='${bar}']`).filter((el) =>
        (el.getAttribute("d") ?? "").includes("q"),
      );
      expect(zLukiem, `słupek ${bar}`).toHaveLength(1);
      // Łuk siedzi w segmencie NAJWYŻSZYM, nie w pierwszym z arkusza.
      expect(zLukiem[0].getAttribute("data-series")).toBe("2");
    }
  });

  it("KOLEJNOŚĆ SEGMENTÓW JEST ARKUSZOWA I TA SAMA W KAŻDYM SŁUPKU", () => {
    // Odruch przeniesiony z tarczy (gdzie sortowanie malejące jest
    // OBOWIĄZKOWE) niszczy tu jedyną rzecz, po którą się do tej formy
    // przychodzi: ta sama seria musi leżeć w każdym słupku na tej samej
    // wysokości stosu, inaczej oko nie ma czego prowadzić wzdłuż wykresu.
    // Model nie sortuje - ten test pilnuje, żeby render też nie.
    const { container } = render(
      <PercentStackedChart
        config={cfg({
          ...BAZA,
          // Największa seria raz na dole, raz w środku, raz na górze - gdyby
          // render sortował per słupek, kolejność by się rozjechała.
          series: [
            { name: "A", values: [70, 10, 20] },
            { name: "B", values: [20, 70, 10] },
            { name: "C", values: [10, 20, 70] },
          ],
        })}
        lang="pl"
      />,
    );
    for (const bar of [0, 1, 2]) {
      const kolejnosc = all(container, `${SEG}[data-bar='${bar}']`).map((el) =>
        el.getAttribute("data-series"),
      );
      expect(kolejnosc, `słupek ${bar}`).toEqual(["0", "1", "2"]);
      // ...i rosnący indeks serii idzie W GÓRĘ stosu, czyli od krawędzi
      // odniesienia, a nie od szczytu.
      const z = all(container, `${SEG}[data-bar='${bar}']`).map(zasieg);
      expect(z[0].dol, `słupek ${bar}`).toBeCloseTo(Y_ZERA, 5);
      expect(z[2].gora, `słupek ${bar}`).toBeCloseTo(Y_STU, 5);
    }
  });

  it("słupek stoi DOKŁADNIE NAD SWOJĄ ETYKIETĄ i nie wchodzi w pasmo sąsiada", () => {
    // WŁASNOŚĆ, NIE PRZEPISANE LICZBY. Poprzednia wersja tego testu wpisywała
    // wprost szerokość słupka (36) i wzór na pasmo (668/3), czyli powtarzała
    // implementację - taki test przechodzi także wtedy, gdy oba rachunki są
    // zgodnie przesunięte. Pytanie, na które ta geometria musi odpowiadać, jest
    // inne: czy podpis pod rysunkiem wskazuje TEN słupek, nad którym stoi,
    // i czy dwa sąsiednie słupki się nie stykają. Pierwsze czytam z ETYKIETY
    // KATEGORII (jedyny nośnik tożsamości słupka na rysunku), drugie z odstępu
    // między kształtami.
    const { container } = render(<PercentStackedChart config={cfg(BAZA)} lang="pl" />);
    const podpisy = all(container, "text[fill='var(--muted-foreground)']:not(.tabular-nums)");
    expect(tekst(container, "text[fill='var(--muted-foreground)']:not(.tabular-nums)")).toEqual([
      "Polska",
      "Niemcy",
      "Francja",
    ]);
    const pudelka = [0, 1, 2].map((bar) => {
      const el = container.querySelector(`${SEG}[data-bar='${bar}'][data-series='0']`);
      if (!el) throw new Error(`brak segmentu ${bar}`);
      const prosty = /^M([-\d.]+) [-\d.]+h([-\d.]+)v/.exec(el.getAttribute("d") ?? "");
      if (prosty === null) throw new Error("segment przy krawędzi odniesienia ma być prosty");
      const od = Number(prosty[1]);
      const szer = Number(prosty[2]);
      // Wszystkie segmenty jednego słupka stoją na tej samej krawędzi lewej -
      // stos przesunięty w poprzek byłby schodkiem, a nie słupkiem.
      for (const z of all(container, `${SEG}[data-bar='${bar}']`).map(zasieg)) {
        expect(z.x, `słupek ${bar}`).toBeCloseTo(od, 5);
      }
      return { od, do: od + szer, srodek: od + szer / 2 };
    });
    for (const bar of [0, 1, 2]) {
      // Podpis wskazuje TEN słupek, nad którym stoi.
      expect(num(podpisy[bar], "x"), `słupek ${bar}`).toBeCloseTo(pudelka[bar].srodek, 5);
    }
    // Sąsiednie słupki zostawiają między sobą prześwit: stykające się kolumny
    // czyta się jako jedną powierzchnię, a to już inna forma.
    expect(pudelka[1].od).toBeGreaterThan(pudelka[0].do);
    expect(pudelka[2].od).toBeGreaterThan(pudelka[1].do);
    // ...i wszystkie są tej samej szerokości, bo szerokość niczego tu nie
    // koduje - kodowaniem jest wyłącznie długość segmentu.
    expect(pudelka[1].do - pudelka[1].od).toBeCloseTo(pudelka[0].do - pudelka[0].od, 5);
    expect(pudelka[2].do - pudelka[2].od).toBeCloseTo(pudelka[0].do - pudelka[0].od, 5);
  });

  it("oś całości ma podziałkę od zera DO STU, a jej gęstość zależy od wysokości", () => {
    // Oś nie jest tu wyprowadzana z danych - osią JEST całość, więc ani dolna,
    // ani górna granica nie zależy od arkusza. Defekt, który to łapie:
    // dociągnięcie osi `niceScale` do najwyższej sumy, po którym pełny słupek
    // przestaje znaczyć „całość".
    const zwykly = render(<PercentStackedChart config={cfg(BAZA)} lang="pl" />);
    expect(tekst(zwykly.container, PODZIALKA)).toEqual(["0%", "25%", "50%", "75%", "100%"]);
    // Blok niski (160 px) nie ma miejsca na pięć wierszy pisma bez nachodzenia,
    // więc podziałka schodzi do połówek - ale zero i sto zostają, bo bez nich
    // oś nie mówi, czego jest połowa.
    const niski = render(<PercentStackedChart config={cfg({ ...BAZA, height: 160 })} lang="pl" />);
    expect(tekst(niski.container, PODZIALKA)).toEqual(["0%", "50%", "100%"]);
    // Blok wysoki (640 px) ma miejsce na dziesiątki.
    const wysoki = render(<PercentStackedChart config={cfg({ ...BAZA, height: 640 })} lang="pl" />);
    expect(tekst(wysoki.container, PODZIALKA)).toHaveLength(11);
  });
});

describe("PercentStackedChart - suma bezwzględna, czyli to, co ta forma ukrywa", () => {
  it("NAZWA DOSTĘPNA podaje sumę KAŻDEJ kategorii", () => {
    // Równa wysokość słupków ukrywa różne wielkości całości: Polska jest tu
    // dwudziestokrotnie większa od Francji i wygląda dokładnie tak samo.
    // Czytelnik ekranu nie ma ani dymka, ani możliwości porównania grubości -
    // więc brak sum w nazwie dostępnej znaczy, że dla niego ta informacja nie
    // istnieje w ogóle. Defekt, który to łapie: nazwa dostępna z samym
    // tytułem („Wykres: X"), czyli rysunek bez alternatywy tekstowej.
    const { container } = render(
      <PercentStackedChart config={cfg({ ...BAZA, title: "Struktura" })} lang="pl" />,
    );
    const nazwa = container.querySelector("[role='img']")?.getAttribute("aria-label") ?? "";
    expect(nazwa).toContain("Wykres: Struktura");
    expect(nazwa).toContain("Suma kategorii");
    // Separator tysięcy w pl-PL to TWARDA SPACJA U+00A0 - wpisana wprost
    // sekwencją `\u00a0`, a nie znakiem, bo znak jest w źródle nieodróżnialny
    // od zwykłej spacji, a `/\s/` przepuszczałby oba i test nie sprawdzałby
    // tego, o czym mówi jego tytuł.
    expect(nazwa).toContain("100\u00a0000");
    expect(nazwa).toContain("10\u00a0000");
    expect(nazwa).toContain("5000");
  });

  it("przy etykietach wartości nad słupkiem stoi SUMA, a nie sto procent", () => {
    // Nad stosem 100% sto procent jest tautologią - jedyną liczbą wartą
    // postawienia jest mianownik. Defekt, który to łapie: przeniesienie
    // etykiety wartości z kartezjańskiego, czyli podpisanie każdego słupka
    // napisem „100%".
    const { container } = render(
      <PercentStackedChart config={cfg({ ...BAZA, showValues: true })} lang="pl" />,
    );
    expect(tekst(container, "[data-role='bar-total']")).toEqual([
      "100\u00a0000",
      "10\u00a0000",
      "5000",
    ]);
    // Etykiety sumy stoją NAD szczytem stosu, a nie na nim: włączenie
    // etykiet podnosi margines górny (`PAD_TOP_WITH_LABELS`), więc miejsce na
    // liczbę jest ZAREZERWOWANE, a nie wzięte ze stosu. Szczyt czytam
    // z rysunku, nie ze stałej, bo to właśnie on się przy tym przesuwa.
    const szczyt = Math.min(...all(container, SEG).map((el) => zasieg(el).gora));
    expect(szczyt).toBeGreaterThan(Y_STU);
    for (const el of all(container, "[data-role='bar-total']")) {
      expect(num(el, "y")).toBeLessThan(szczyt);
    }
  });

  it("bez etykiet wartości nad słupkami nie ma ŻADNEJ liczby", () => {
    // Przełącznik autora musi coś robić w obie strony: etykieta, której nie
    // da się wyłączyć, jest ścianą liczb nad każdym słupkiem.
    const { container } = render(<PercentStackedChart config={cfg(BAZA)} lang="pl" />);
    expect(all(container, "[data-role='bar-total']")).toHaveLength(0);
  });

  it("dymek podaje udział, wartość bezwzględną ORAZ sumę kategorii", () => {
    // Udział bez wartości bezwzględnej jest w tej formie informacją niepełną:
    // stos 100% z definicji wyrzuca poziom. Defekt, który to łapie: dymek
    // z samym procentem, po którym nie da się odróżnić 50% z pięciu tysięcy
    // od 50% ze stu tysięcy.
    const { container } = render(<PercentStackedChart config={cfg(BAZA)} lang="pl" />);
    const hit = container.querySelector("rect.neh-hit");
    if (!hit) throw new Error("brak warstwy trafień");
    stubPlotRect(hit, 668, INNER_H);
    // x = 100 wpada w pasmo pierwszej kategorii, y = 100 w segment leżący
    // między 60% i 90% stosu, czyli w „Przemysł".
    fireEvent.pointerMove(hit, { clientX: 100, clientY: 100 });
    const dymek = container.querySelector(".neh-tooltip")?.textContent ?? "";
    expect(dymek).toContain("Polska");
    expect(dymek).toContain("Przemysł");
    expect(dymek).toContain("30%");
    expect(dymek).toContain("30\u00a0000");
    expect(dymek).toContain("Suma kategorii");
    expect(dymek).toContain("100\u00a0000");
  });

  it("dotyk NIE gasi dymka przy opuszczeniu warstwy", () => {
    // Palec schodzi z ekranu po każdym stuknięciu, więc `pointerleave`
    // z dotyku gasiłby dymek zawsze natychmiast po jego pokazaniu.
    const { container } = render(<PercentStackedChart config={cfg(BAZA)} lang="pl" />);
    const hit = container.querySelector("rect.neh-hit");
    if (!hit) throw new Error("brak warstwy trafień");
    stubPlotRect(hit, 668, INNER_H);
    fireEvent.pointerDown(hit, { clientX: 100, clientY: 100, pointerType: "touch" });
    fireEvent.pointerLeave(hit, { pointerType: "touch" });
    expect(container.querySelector(".neh-tooltip")).not.toBeNull();
  });
});

describe("PercentStackedChart - etykieta udziału wchodzi do segmentu warunkowo", () => {
  it("etykiety w JEDNYM słupku sumują się dokładnie do stu", () => {
    // Czytelnik DODAJE liczby stojące jedna nad drugą w jednym słupku. Trzy
    // udziały po 33,33% zaokrąglone niezależnie dają 99 - i to jest defekt,
    // który ten test łapie: render, który formatuje `share` zamiast
    // `displayShare` z metody największych reszt.
    const { container } = render(
      <PercentStackedChart
        config={cfg({
          categories: ["A"],
          series: [
            { name: "X", values: [1] },
            { name: "Y", values: [1] },
            { name: "Z", values: [1] },
          ],
        })}
        lang="pl"
      />,
    );
    const liczby = tekst(container, ETYKIETA).map((s) => Number(s.replace("%", "")));
    expect(liczby).toHaveLength(3);
    expect(liczby.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("PRÓG ETYKIETY JEST OSTRZEJSZY NIŻ DOMYŚLNY MODELU, bo pole rysunku jest niższe od karty", () => {
    // Model liczy próg jako 19 px podzielone przez wysokość KARTY (320 px),
    // czyli 0,06. Stos nie zajmuje całej karty - nad polem leży margines
    // górny, pod nim miejsce na etykiety kategorii - więc przy domyślnej
    // wysokości pole ma 284 px i prawdziwy próg to 19/284 = 0,067.
    //
    // Udział 6,3% leży DOKŁADNIE między tymi dwiema liczbami. Defekt, który
    // ten test łapie: zostawienie progu modelu, po którym liczba pisana pismem
    // 11 px wchodzi do segmentu grubego 17,9 px - czyli styka się z obiema
    // krawędziami i wygląda na przypisaną do sąsiada.
    const arkusz = {
      categories: ["A"],
      series: [
        { name: "Mały", values: [63] },
        { name: "Duży", values: [937] },
      ],
    };
    expect(0.063).toBeGreaterThan(PERCENT_STACKED_LABEL_MIN_SHARE);
    const domyslny = render(<PercentStackedChart config={cfg(arkusz)} lang="pl" />);
    expect(
      domyslny.container.querySelector(`${ETYKIETA}[data-role='segment-label']`),
    ).not.toBeNull();
    const opisane = all(domyslny.container, ETYKIETA).map((e) => e.textContent);
    expect(opisane).toEqual(["94%"]);

    // Ten sam udział w bloku wysokim 640 px: pole ma 604 px, próg schodzi do
    // 0,031, a segment 6,3% ma 38 px grubości - liczba się mieści i musi tam
    // być, bo inaczej render nie korzysta z tego, że zna swoją wysokość.
    const wysoki = render(
      <PercentStackedChart config={cfg({ ...arkusz, height: 640 })} lang="pl" />,
    );
    expect(tekst(wysoki.container, ETYKIETA).sort()).toEqual(["6%", "94%"]);
  });

  it("etykieta ustępuje, gdy nie mieści się W POPRZEK słupka", () => {
    // Model mierzy tylko GRUBOŚĆ segmentu - w poprzek mierzy słupek, a słupek
    // zwęża się razem z pasmem, gdy kategorii jest wiele. Przy trzydziestu
    // kategoriach pasmo ma 22 px, więc „33%" (20 px plus odstępy) nie wchodzi.
    // Defekt, który to łapie: napis szerszy od słupka, wystający na sąsiada.
    const ile = 30;
    const { container } = render(
      <PercentStackedChart
        config={cfg({
          categories: Array.from({ length: ile }, (_, i) => `k${i}`),
          series: [
            { name: "X", values: Array.from({ length: ile }, () => 1) },
            { name: "Y", values: Array.from({ length: ile }, () => 1) },
          ],
        })}
        lang="pl"
      />,
    );
    // Segmenty są - to nie jest test o pustym rysunku.
    expect(all(container, SEG)).toHaveLength(2 * ile);
    expect(all(container, ETYKIETA)).toHaveLength(0);
  });

  it("etykieta bierze wspólny tusz semantyczny na jasnym wnętrzu segmentu", () => {
    // Wszystkie słupki i segmenty są wizualnie normalizowane przez arkusz do
    // jasnego wnętrza z ciemniejszym obrysem, tak jak pie/donut. Etykieta musi
    // więc używać tuszu strony, a nie inku dobranego do dawnego, nasyconego
    // wypełnienia slotu.
    const { container } = render(<PercentStackedChart config={cfg(BAZA)} lang="pl" />);
    const kolory = all(container, `${SEG}[data-bar='0']`).map((e) => e.getAttribute("fill"));
    expect(kolory).toEqual([0, 1, 2].map((i) => `var(--chart-${slotForSeries(i)})`));
    const tusze = all(container, `${ETYKIETA}`)
      .slice(0, 3)
      .map((e) => e.getAttribute("fill"));
    expect(tusze).toEqual(Array.from({ length: 3 }, () => "var(--foreground)"));
  });
});

describe("PercentStackedChart - wypełnienie segmentów", () => {
  it("stos schodzi z wariantu bladego do SOLIDNEGO, bo blade wnętrze nie niesie serii", () => {
    // `resolveBarStyle` z `stacked: true` sprowadza blady do solidnego:
    // odległość CIELAB między bladymi wypełnieniami spada po symulacji
    // daltonizmu praktycznie do zera, a stos ma z definicji więcej niż jeden
    // segment i nie ma osi, do której można by przypiąć każdy osobno. Defekt,
    // który to łapie: kilka segmentów o tym samym, niemal białym wnętrzu.
    const { container } = render(<PercentStackedChart config={cfg(BAZA)} lang="pl" />);
    for (const el of all(container, SEG)) {
      expect(el.getAttribute("data-style")).toBe("solid");
      expect(el.getAttribute("data-edged")).toBeNull();
      expect(el.getAttribute("fill")).toMatch(/^var\(--chart-\d\)$/);
    }
  });

  it("WĄSKI segment idzie solidem, choć cały wykres jest gradientowy - i nie znika", () => {
    // Specyfikacja każe dla wąskich segmentów solid, i to jest arytmetyka,
    // nie gust: obwódka wsuwa kształt o 0,75 px z każdej strony, a prześwit
    // stosu zabiera jeszcze pół grubości linii - segment o udziale 0,1%
    // (0,28 px przy tej wysokości) zostałby po tych korektach niczym. Defekt,
    // który to łapie: udział dodatni pokazany jako udział zerowy.
    const { container } = render(
      <PercentStackedChart
        config={cfg({
          categories: ["A"],
          barStyle: "gradient",
          series: [
            { name: "Ogon", values: [1] },
            { name: "Reszta", values: [999] },
          ],
        })}
        lang="pl"
      />,
    );
    const waski = container.querySelector(`${SEG}[data-series='0']`);
    const szeroki = container.querySelector(`${SEG}[data-series='1']`);
    if (!waski || !szeroki) throw new Error("brak segmentów");
    expect(waski.getAttribute("data-style")).toBe("solid");
    expect(waski.getAttribute("data-edged")).toBeNull();
    expect(waski.getAttribute("stroke")).toBeNull();
    expect(szeroki.getAttribute("data-style")).toBe("gradient");
    expect(szeroki.getAttribute("data-edged")).toBe("true");
    // Segment o dodatnim udziale MUSI być widoczny - podłoga pół piksela.
    const z = zasieg(waski);
    expect(z.dol - z.gora).toBeGreaterThanOrEqual(0.5);
  });

  it("każdy segment stosu zachowuje pełne wypełnienie bez wzoru", () => {
    const { container } = render(
      <PercentStackedChart
        config={cfg({
          categories: ["A"],
          series: [
            { name: "X", values: [1], colorSlot: 9 },
            { name: "Y", values: [1], colorSlot: 16 },
          ],
        })}
        lang="pl"
      />,
    );
    const segmenty = all(container, SEG);
    expect(segmenty).toHaveLength(2);
    expect(
      segmenty.every((segment) => segment.getAttribute("fill")?.startsWith("var(--chart-")),
    ).toBe(true);
    expect(container.querySelector("pattern[id$='-hatch']")).toBeNull();
  });

  it("nie zapieka koloru: każde wypełnienie i każda kreska idą tokenem", () => {
    // Sekcja 2 i 5: w kodzie rysującym nie ma ani jednego hexa, bo tryb ciemny
    // i druk dostają swoje wartości bez gałęzi w JavaScripcie.
    const { container } = render(
      <PercentStackedChart config={cfg({ ...BAZA, showValues: true })} lang="pl" />,
    );
    for (const el of all(container, "svg *")) {
      for (const attr of ["fill", "stroke", "stop-color"]) {
        const v = el.getAttribute(attr);
        if (v === null) continue;
        expect(v, `${el.tagName}.${attr}`).not.toMatch(/#[0-9a-fA-F]{3}|rgba?\(/);
      }
    }
  });
});

describe("PercentStackedChart - dostępność i klawiatura", () => {
  it("rysunek ma rolę, fokus, nazwę z tytułu i OPIS obsługi", () => {
    const { container } = render(
      <PercentStackedChart config={cfg({ ...BAZA, title: "Struktura" })} lang="pl" />,
    );
    const box = container.querySelector<HTMLElement>("[role='img']");
    expect(box).not.toBeNull();
    expect(box?.getAttribute("tabindex")).toBe("0");
    expect(box?.getAttribute("aria-label")).toContain("Wykres: Struktura");
    // Opis, nie nazwa: nazwa mówi CO to jest, opis - JAK tego użyć.
    const opis = (box?.getAttribute("aria-describedby") ?? "").split(" ");
    expect(opis.length).toBe(2);
    expect(container.querySelector(`#${opis[0]}`)?.textContent).toContain("Strzałkami");
  });

  it("wykres bez tytułu ma nazwę zastępczą, a nie pustą", () => {
    // Nazwa dostępna o zerowej długości znaczy dla czytnika ekranu element
    // bez etykiety - czyli rysunek, o którym nie wiadomo nawet, że jest
    // rysunkiem.
    const { container } = render(<PercentStackedChart config={cfg(BAZA)} lang="pl" />);
    const nazwa = container.querySelector("[role='img']")?.getAttribute("aria-label") ?? "";
    expect(nazwa.startsWith("Wykres")).toBe(true);
    expect(nazwa).not.toContain("Wykres: ");
  });

  it("BRZEG SERII jedzie w opisie, bo tych liczb na rysunku nie ma", () => {
    // Segment środkowy leży na skali przesuniętej, więc „czy udział tej serii
    // rośnie" odczytuje się z wykresu przez porównanie dwóch różnic. Dla
    // czytelnika ekranu nie ma nawet tego - więc przesunięcie i rozpiętość
    // muszą być podane liczbą. Defekt, który to łapie: opis z samą
    // podpowiedzią klawiatury, czyli rodzaj odpowiadający na pytanie
    // o ZMIANĘ struktury i milczący o niej tam, gdzie rysunku nie widać.
    const { container } = render(<PercentStackedChart config={cfg(BAZA)} lang="pl" />);
    const box = container.querySelector<HTMLElement>("[role='img']");
    const opis = (box?.getAttribute("aria-describedby") ?? "").split(" ")[1];
    const brzeg = container.querySelector(`#${opis}`)?.textContent ?? "";
    expect(brzeg).toContain("Przesunięcie");
    expect(brzeg).toContain("Rozpiętość udziału");
    expect(brzeg).toContain("Udział w pierwszym słupku");
    // Usługi: 60% w pierwszym słupku, 40% w ostatnim, czyli -20 punktów.
    expect(brzeg).toContain("-20,0%");
    // SUMA WARTOŚCI SERII po wszystkich rysowanych słupkach: 60 000 + 5 000
    // + 2 000. Stos 100% wyrzuca poziom, więc bez tej liczby opis mówiłby
    // wyłącznie o proporcjach - tak samo jak rysunek.
    expect(brzeg).toContain("Suma wartości");
    expect(brzeg).toContain("67\u00a0000");
    expect(brzeg).not.toContain("{{");
  });

  it("w kolejności tabulacji stoi JEDEN element - kontener, nie każdy segment", () => {
    // Wzorzec „kontener" z bramki rodzajów: dziewięć ogniskowalnych segmentów
    // znaczyłoby dziewięć przystanków tabulacji bez własnych nazw.
    const { container } = render(<PercentStackedChart config={cfg(BAZA)} lang="pl" />);
    expect(all(container, "[tabindex='0']")).toHaveLength(1);
  });

  it("ArrowRight zmienia stan czynny, Escape przywraca rysunek DOKŁADNIE do stanu sprzed", () => {
    // O to pyta bramka `everyKindRenders`. Escape jest jedyną drogą zdjęcia
    // wskazania na klawiaturze: stuknięcie w tło jest akcją WSKAŹNIKOWĄ,
    // której na klawiaturze nie ma.
    const { container } = render(<PercentStackedChart config={cfg(BAZA)} lang="pl" />);
    const box = container.querySelector<HTMLElement>("[role='img']");
    if (!box) throw new Error("brak kontenera");
    const przed = container.innerHTML;
    fireEvent.keyDown(box, { key: "ArrowRight" });
    expect(container.innerHTML).not.toBe(przed);
    expect(container.querySelector("[data-role='segment'][data-active='true']")).toBeNull();
    fireEvent.keyDown(box, { key: "Escape" });
    expect(container.innerHTML).toBe(przed);
  });

  it("POZIOM chodzi po słupkach, PION po segmentach - tak, jak biegnie rysunek", () => {
    // Kategorie stoją w poziomie, stos rośnie w pionie. Defekt, który to
    // łapie: jedna oś nawigacji, po której segmentu środkowego nie da się
    // wskazać w ogóle - a to jest ten segment, o który w tej formie najtrudniej
    // zapytać.
    const { container } = render(<PercentStackedChart config={cfg(BAZA)} lang="pl" />);
    const box = container.querySelector<HTMLElement>("[role='img']");
    if (!box) throw new Error("brak kontenera");
    fireEvent.keyDown(box, { key: "ArrowRight" });
    fireEvent.keyDown(box, { key: "ArrowRight" });
    // Drugi słupek: dymek mówi o Niemcach, nie o Polsce.
    expect(container.querySelector(".neh-tooltip")?.textContent).toContain("Niemcy");
    fireEvent.keyDown(box, { key: "ArrowUp" });
    const pierwszy = container.querySelector("[data-role='segment'][data-active='true']");
    expect(pierwszy?.getAttribute("data-bar")).toBe("1");
    expect(pierwszy?.getAttribute("data-series")).toBe("0");
    fireEvent.keyDown(box, { key: "ArrowUp" });
    expect(
      container
        .querySelector("[data-role='segment'][data-active='true']")
        ?.getAttribute("data-series"),
    ).toBe("1");
    // Zmiana słupka ZERUJE segment: ten sam numer serii w sąsiednim słupku
    // jest innym udziałem, a dymek po poprzednim słupku pokazywałby liczbę
    // nie z tego miejsca, na które patrzy czytelnik.
    fireEvent.keyDown(box, { key: "ArrowLeft" });
    expect(container.querySelector("[data-role='segment'][data-active='true']")).toBeNull();
  });

  it("klawisze nieobsługiwane nie wywracają rysunku", () => {
    const { container } = render(<PercentStackedChart config={cfg(BAZA)} lang="pl" />);
    const box = container.querySelector<HTMLElement>("[role='img']");
    if (!box) throw new Error("brak kontenera");
    for (const key of ["Tab", "Enter", " ", "a", "F5", "PageDown", "Home"]) {
      expect(() => fireEvent.keyDown(box, { key }), key).not.toThrow();
    }
    expect(container.textContent ?? "").not.toContain("NaN");
  });
});

describe("PercentStackedChart - i18n jedzie propsem, nie singletonem", () => {
  it("ten sam arkusz daje odmienne POPRAWNE napisy w pl i en", () => {
    const config = cfg({ ...BAZA, showValues: true, title: "Struktura" });
    const pl = render(<PercentStackedChart config={config} lang="pl" />);
    const en = render(<PercentStackedChart config={config} lang="en" />);
    // Separator tysięcy: pl-PL stawia TWARDĄ SPACJĘ U+00A0 (wpisaną wprost
    // sekwencją `\u00a0`), en-GB przecinek. To jest cała asercja o i18n:
    // te same dane, dwa RÓŻNE i oba POPRAWNE napisy.
    expect(tekst(pl.container, "[data-role='bar-total']")[0]).toBe("100\u00a0000");
    expect(tekst(en.container, "[data-role='bar-total']")[0]).toBe("100,000");
    const nazwaPl = pl.container.querySelector("[role='img']")?.getAttribute("aria-label") ?? "";
    const nazwaEn = en.container.querySelector("[role='img']")?.getAttribute("aria-label") ?? "";
    expect(nazwaPl).toContain("Udział w całości");
    expect(nazwaPl).toContain("Suma kategorii");
    expect(nazwaEn).toContain("Share of the whole");
    expect(nazwaEn).toContain("Category total");
    // ...i ani jedna ścieżka słownika nie wyciekła na ekran zamiast zdania.
    for (const root of [pl.container, en.container]) {
      expect(root.textContent ?? "").not.toContain("percentStacked.");
    }
  });

  it("przypis o skali jest w obu językach zdaniem, nie kluczem", () => {
    const config = cfg(BAZA);
    const pl = render(<PercentStackedChart config={config} lang="pl" />);
    const en = render(<PercentStackedChart config={config} lang="en" />);
    const nota = (root: HTMLElement): string =>
      root.querySelector("[data-note='scaleNote']")?.textContent ?? "";
    expect(nota(pl.container)).toContain("krawędzi odniesienia");
    expect(nota(en.container)).toContain("reference edge");
  });
});

describe("PercentStackedChart - przypisy pod rysunkiem", () => {
  const nota = (root: HTMLElement, klucz: string): string =>
    root.querySelector(`[data-note='${klucz}']`)?.textContent ?? "";
  const klucze = (root: HTMLElement): (string | null)[] =>
    all(root, "[data-note]").map((el) => el.getAttribute("data-note"));

  it("zdrowy arkusz dostaje zdanie o skali - i NIC ponad to, co z danych wynika", () => {
    // Zdanie o skali jest tu obowiązkowe, bo segment środkowy nie leży na
    // wspólnej skali i bez tego czyta się go jak segment przy krawędzi
    // odniesienia. Wszystko inne byłoby ostrzeżeniem bez powodu - a lista,
    // na której zawsze coś stoi, uczy ignorowania całej listy.
    //
    // Drugie zdanie NIE jest ostrzeżeniem bez powodu: sumy w `BAZA` to 100 000,
    // 10 000 i 5 000, czyli różnią się dwudziestokrotnie, a wszystkie trzy
    // słupki mają tę samą długość z konstrukcji rodzaju.
    const { container } = render(<PercentStackedChart config={cfg(BAZA)} lang="pl" />);
    expect(klucze(container)).toEqual(["scaleNote", "totalRatioNote"]);
    expect(nota(container, "totalRatioNote")).toContain("20");
  });

  it("o różnicy sum MILCZY, gdy sumy są porównywalne", () => {
    // Druga strona umowy. Przy sumach tego samego rzędu wielkości zdanie
    // stałoby pod prawie każdym wykresem tego rodzaju - a uwaga widoczna
    // zawsze uczy pomijania całej listy.
    const { container } = render(
      <PercentStackedChart
        config={cfg({
          ...BAZA,
          series: [
            { name: "Usługi", values: [60, 55, 50] },
            { name: "Przemysł", values: [30, 33, 35] },
            { name: "Rolnictwo", values: [10, 12, 15] },
          ],
        })}
        lang="pl"
      />,
    );
    expect(klucze(container)).toEqual(["scaleNote"]);
  });

  it("zdanie o skali MILCZY przy jednej serii, bo nie ma wtedy skal przesuniętych", () => {
    // Jedyny segment zaczyna się w zerze, więc zdanie „pozostałe leżą na
    // skalach przesuniętych" byłoby fałszem. Zamiast niego stoi obserwacja
    // o formie: struktura jednoskładnikowa nie jest strukturą.
    const { container } = render(
      <PercentStackedChart
        config={cfg({ categories: ["A", "B"], series: [{ name: "X", values: [1, 2] }] })}
        lang="pl"
      />,
    );
    expect(klucze(container)).not.toContain("scaleNote");
    expect(nota(container, "reading.singleSegment")).toContain("pełny w stu procentach");
  });

  it("JEDEN słupek jest nazwany, bo struktury nie ma z czym porównać", () => {
    // Cała ta forma istnieje dla PORÓWNANIA słupków; dla jednej całości
    // tabela doboru formy dopuszcza pierścień do pięciu kategorii.
    const { container } = render(
      <PercentStackedChart
        config={cfg({
          categories: ["A"],
          series: [
            { name: "X", values: [1] },
            { name: "Y", values: [1] },
          ],
        })}
        lang="pl"
      />,
    );
    expect(nota(container, "reading.singleBar")).toContain("jeden słupek");
  });

  it("zbyt wiele segmentów jest nazwane RAZEM Z PROGIEM", () => {
    // „Za dużo" bez liczby nie jest informacją. Defekt, który to łapie:
    // pominięta wstawka - i18next zostawia wtedy w zdaniu surowe `{{max}}`
    // i żadna bramka tego nie widzi.
    const ile = 8;
    const { container } = render(
      <PercentStackedChart
        config={cfg({
          categories: ["A", "B"],
          series: Array.from({ length: ile }, (_, i) => ({
            name: `S${i}`,
            values: [1, 2],
            colorSlot: i + 1,
          })),
        })}
        lang="pl"
      />,
    );
    const tresc = nota(container, "reading.tooManySegments");
    expect(tresc).toContain("6");
    expect(tresc).not.toContain("{{");
  });

  it("żaden przypis nie zostawia surowych klamer wstawki", () => {
    // Jedna asercja na WSZYSTKIE przypisy naraz: brakująca liczba nie jest
    // błędem kompilacji ani rozjazdem klucza, więc jedyne, co ją wyłapie, to
    // tekst na ekranie.
    const arkusze: Record<string, Json>[] = [
      BAZA,
      { categories: ["A", "B"], series: [{ name: "X", values: [1, -2] }] },
      { categories: ["A", "B"], series: [{ name: "X", values: [0, 0] }] },
      { categories: ["A", "A"], series: [{ name: "X", values: [1, 1] }] },
      {
        categories: ["A", "B"],
        unit: "%",
        series: [
          { name: "X", values: [40, 50] },
          { name: "X", values: [56, 50] },
        ],
      },
      { categories: ["A"], series: [{ name: "X", values: [1e300] }] },
    ];
    for (const arkusz of arkusze) {
      const { container } = render(<PercentStackedChart config={cfg(arkusz)} lang="pl" />);
      for (const el of all(container, "[data-note]")) {
        expect(el.textContent ?? "", el.getAttribute("data-note") ?? "").not.toContain("{{");
      }
    }
  });
});

describe("PercentStackedChart - uczciwość: każde orzeczenie modelu wtedy i tylko wtedy", () => {
  const nota = (root: HTMLElement, klucz: string): string =>
    root.querySelector(`[data-note='${klucz}']`)?.textContent ?? "";
  const jest = (root: HTMLElement, klucz: string): boolean =>
    root.querySelector(`[data-note='${klucz}']`) !== null;

  it("WARTOŚĆ UJEMNA: słupek nie ma ani jednego segmentu, a przypis nazywa kategorię", () => {
    // Udział ujemny nie ma długości, więc model odrzuca CAŁY słupek - i to
    // jest decyzja, nie awaria: forma istnieje dla porównania słupków, więc
    // słupek, który po cichu wyrzucił ujemny składnik, stałby obok słupka,
    // który nie wyrzucił nic, i oba byłyby podpisane „100%". Defekt, który ten
    // test łapie: policzenie udziałów po modułach albo po sumie dodatnich.
    const { container } = render(
      <PercentStackedChart
        config={cfg({
          categories: ["Dobra", "Zepsuta"],
          series: [
            { name: "X", values: [60, 60] },
            { name: "Y", values: [40, -10] },
          ],
        })}
        lang="pl"
      />,
    );
    expect(all(container, `${SEG}[data-bar='1']`)).toHaveLength(0);
    expect(all(container, `${SEG}[data-bar='0']`)).toHaveLength(2);
    const tresc = nota(container, "honesty.valuesNonNegativeOk");
    expect(tresc).toContain("Zepsuta");
    expect(tresc).not.toContain("Dobra");
    // Defekt danych, nie obserwacja o formie - lista, na której wszystko
    // krzyczy, uczy ignorowania całej listy.
    expect(
      container.querySelector("[data-note='honesty.valuesNonNegativeOk']")?.getAttribute("style") ??
        "",
    ).toContain("--chart-negative-text");
    // ...i zdrowy arkusz tego przypisu nie dostaje.
    const zdrowy = render(<PercentStackedChart config={cfg(BAZA)} lang="pl" />);
    expect(jest(zdrowy.container, "honesty.valuesNonNegativeOk")).toBe(false);
  });

  it("SUMA ZEROWA: w miejscu słupka jest kreska, a nie pełny słupek pierwszej serii", () => {
    // To jest błąd, który powstaje sam: `v / total` przy zerowym mianowniku
    // daje NaN, a osłona napisana odruchowo („gdy nie ma sumy, weź pierwszą
    // serię") stawia tam słupek pełny w 100% jednej kategorii. Kategoria bez
    // sumy nie ma struktury, więc zostaje LUKĄ - i luka musi być widoczna,
    // bo puste miejsce czyta się jako „tu nic nie zmierzono".
    const { container } = render(
      <PercentStackedChart
        config={cfg({
          categories: ["Dobra", "Zerowa"],
          series: [
            { name: "X", values: [60, 0] },
            { name: "Y", values: [40, 0] },
          ],
        })}
        lang="pl"
      />,
    );
    expect(all(container, `${SEG}[data-bar='1']`)).toHaveLength(0);
    const luka = container.querySelector("[data-role='gap'][data-bar='1']");
    expect(luka).not.toBeNull();
    expect(num(luka as Element, "y1")).toBeCloseTo(Y_ZERA, 5);
    expect(nota(container, "honesty.totalsPositiveOk")).toContain("Zerowa");
    expect(jest(container, "honesty.valuesNonNegativeOk")).toBe(false);
  });

  it("KATEGORIA BEZ ANI JEDNEJ LICZBY stoi na osi bez słupka i jest nazwana", () => {
    // Brak nie jest zerem: zero jest pomiarem, brak nieuzupełnionym polem.
    // Kategoria usunięta z rysunku przestawiłaby pozostałe, więc zostaje na
    // osi - i dlatego musi być powiedziane, dlaczego jest pusta.
    const { container } = render(
      <PercentStackedChart
        config={cfg({
          categories: ["Dobra", "Pusta"],
          series: [
            { name: "X", values: [60, null] },
            { name: "Y", values: [40, null] },
          ],
        })}
        lang="pl"
      />,
    );
    expect(all(container, `${SEG}[data-bar='1']`)).toHaveLength(0);
    expect(container.querySelector("[data-role='gap'][data-bar='1']")).not.toBeNull();
    expect(nota(container, "honesty.emptyCategories")).toContain("Pusta");
    // ...a etykieta kategorii zostaje pod luką, żeby oś nie skłamała o tym,
    // ile kategorii porównujemy.
    expect(tekst(container, "text[fill='var(--muted-foreground)']:not(.tabular-nums)")).toEqual([
      "Dobra",
      "Pusta",
    ]);
  });

  it("BRAKUJĄCY SKŁADNIK: słupki o różnych składnikach są nazwane, bo wyglądają identycznie", () => {
    // Struktura dwóch słupków jest porównywalna tylko wtedy, gdy oba są
    // zbudowane z tych samych serii. Słupek, w którym brakuje jednej, ma
    // udziały policzone z innego mianownika i wygląda dokładnie tak samo -
    // to jest defekt, którego na rysunku NIE DA SIĘ zobaczyć, więc jedyne, co
    // go pokazuje, to zdanie pod wykresem.
    const { container } = render(
      <PercentStackedChart
        config={cfg({
          categories: ["Pełna", "Ułomna"],
          series: [
            { name: "X", values: [10, 10] },
            { name: "Y", values: [10, null] },
          ],
        })}
        lang="pl"
      />,
    );
    const tresc = nota(container, "honesty.structureComparableOk");
    expect(tresc).toContain("Ułomna");
    expect(tresc).not.toContain("Pełna");
    const zdrowy = render(<PercentStackedChart config={cfg(BAZA)} lang="pl" />);
    expect(jest(zdrowy.container, "honesty.structureComparableOk")).toBe(false);
  });

  it("PRZESKALOWANE UDZIAŁY: liczba na segmencie jest inna niż w arkuszu i to jest nazwane", () => {
    // Autor wkleja gotowe udziały sumujące się do 96 (bo brakuje kategorii,
    // bo dwie się nakładają), a stos przeskalowuje je po cichu do pełnej
    // całości. Sprawdzenie odpala się WYŁĄCZNIE przy jednostce udziału, bo
    // o jednostce mówi konfiguracja bloku, a nie kształt liczb.
    const arkusz = {
      categories: ["A", "B"],
      series: [
        { name: "X", values: [40, 50] },
        { name: "Y", values: [56, 50] },
      ],
    };
    const udzialy = render(
      <PercentStackedChart config={cfg({ ...arkusz, unit: "%" })} lang="pl" />,
    );
    expect(nota(udzialy.container, "honesty.declaredTotalsOk")).toContain("A");
    // Te same liczby BEZ jednostki procentowej nie są udziałami, więc nie ma
    // czego sprawdzać - i model wtedy MILCZY, a nie zaświadcza, że jest dobrze.
    const kwoty = render(<PercentStackedChart config={cfg(arkusz)} lang="pl" />);
    expect(jest(kwoty.container, "honesty.declaredTotalsOk")).toBe(false);
  });

  it("POWTÓRZONA ETYKIETA KATEGORII jest nazwana, bo pod słupkiem nie ma drugiego nośnika", () => {
    const { container } = render(
      <PercentStackedChart
        config={cfg({
          categories: ["A", "A"],
          series: [
            { name: "X", values: [1, 2] },
            { name: "Y", values: [1, 2] },
          ],
        })}
        lang="pl"
      />,
    );
    expect(nota(container, "honesty.duplicateCategories")).toContain("A");
  });

  it("POWTÓRZONA NAZWA SERII jest nazwana, bo w stosie tożsamość niesie tylko nazwa", () => {
    // Dwa segmenty o tej samej nazwie nie są rozdzielone żadnym kanałem:
    // blade wnętrze tożsamości nie niesie, a legenda pokaże dwa razy to samo.
    const { container } = render(
      <PercentStackedChart
        config={cfg({
          categories: ["A", "B"],
          series: [
            { name: "Ta sama", values: [1, 2] },
            { name: "Ta sama", values: [1, 2] },
          ],
        })}
        lang="pl"
      />,
    );
    expect(nota(container, "honesty.duplicateSeries")).toContain("Ta sama");
    const zdrowy = render(<PercentStackedChart config={cfg(BAZA)} lang="pl" />);
    expect(jest(zdrowy.container, "honesty.duplicateSeries")).toBe(false);
  });

  it("WARTOŚĆ POZA ZAKRESEM SPRAWDZALNOŚCI odrzuca słupek i jest nazwana", () => {
    // Powyżej 2^53-1 sąsiednie liczby całkowite przestają być rozróżnialne,
    // więc suma przestaje być mianownikiem, który ktokolwiek może sprawdzić.
    const { container } = render(
      <PercentStackedChart
        config={cfg({
          categories: ["Dobra", "Wielka"],
          series: [
            { name: "X", values: [60, 1e300] },
            { name: "Y", values: [40, 1] },
          ],
        })}
        lang="pl"
      />,
    );
    expect(nota(container, "honesty.outOfRange")).toContain("Wielka");
    expect(all(container, `${SEG}[data-bar='1']`)).toHaveLength(0);
    expect(container.textContent ?? "").not.toContain("Infinity");
  });

  it("ZAOKRĄGLENIE ETYKIETY jest zgłaszane tylko wtedy, gdy jest na TYM rysunku widoczne", () => {
    // Zaokrąglenie jest w tej formie konieczne (etykiety w jednym słupku muszą
    // sumować się do stu), a jego wielkość ograniczona jednostką wyświetlania
    // - więc zdanie ma sens tylko wtedy, gdy rozminięcie przesuwa krawędź
    // segmentu o co najmniej piksel. Przy polu 284 px piksel to 0,35 punktu,
    // przy polu 604 px - 0,17 punktu.
    //
    // Udziały 12,25% i 87,75% rozmijają się z etykietą o 0,25 punktu, czyli
    // MIĘDZY tymi progami. Defekt, który to łapie: przypis widoczny zawsze
    // (bo jakiekolwiek zaokrąglenie jest prawie zawsze) albo nigdy.
    const arkusz = {
      categories: ["A"],
      series: [
        { name: "X", values: [49] },
        { name: "Y", values: [351] },
      ],
    };
    const niski = render(<PercentStackedChart config={cfg(arkusz)} lang="pl" />);
    expect(jest(niski.container, "honesty.roundingShift")).toBe(false);
    const wysoki = render(
      <PercentStackedChart config={cfg({ ...arkusz, height: 640 })} lang="pl" />,
    );
    expect(nota(wysoki.container, "honesty.roundingShift")).toContain("0,25");
    // Udziały DOKŁADNE nie rozmijają się z niczym, więc milczy nawet na
    // najwyższym bloku.
    const dokladny = render(
      <PercentStackedChart
        config={cfg({
          categories: ["A"],
          height: 640,
          series: [
            { name: "X", values: [1] },
            { name: "Y", values: [1] },
          ],
        })}
        lang="pl"
      />,
    );
    expect(jest(dokladny.container, "honesty.roundingShift")).toBe(false);
  });

  it("LICZBY BEZ KATEGORII są nazwane, a przypis PRZEŻYWA wczesne wyjście", () => {
    // Histogram miał tu defekt: brak czego narysować oddawał `null`, więc
    // przypis o defekcie danych ginął razem z rysunkiem. Tu nie ma ani jednej
    // kategorii, czyli nie ma ani jednego słupka - a jedyne, co mówi o dwóch
    // liczbach, które wypadły, to ten przypis.
    //
    // Konfiguracja jest tu SKŁADANA PO PARSOWANIU i to jest wyjątek od reguły
    // z nagłówka pliku: `parseChartSeries` obcina tablicę wartości do liczby
    // kategorii, więc przez parser bloku ten stan jest NIEOSIĄGALNY (zgłoszone
    // przy modelu). Model jest jednak wołany także z podglądu edytora, na
    // surowym wejściu, i wtedy stan jest realny.
    const surowy: ChartConfig = {
      ...cfg(BAZA),
      categories: [],
      series: [{ name: "X", values: [1, 2], colorSlot: 1 }],
    };
    const { container } = render(<PercentStackedChart config={surowy} lang="pl" />);
    expect(container.querySelector("svg")).toBeNull();
    expect(nota(container, "honesty.droppedValues")).toContain("2");
    // Zdrowy arkusz z parsera NIGDY tego przypisu nie dostaje.
    const zdrowy = render(<PercentStackedChart config={cfg(BAZA)} lang="pl" />);
    expect(jest(zdrowy.container, "honesty.droppedValues")).toBe(false);
  });

  it("SŁUPEK ODRZUCONY podaje POWÓD w dymku i w nazwie dostępnej", () => {
    // Luka bez słowa nie różni się niczym od miejsca, w którym nic nie
    // zmierzono. Powód musi być osiągalny wskaźnikiem (dymek), klawiaturą
    // (ten sam dymek) i czytnikiem ekranu (nazwa dostępna), bo każdy z tych
    // czytelników ma tylko jeden z tych kanałów.
    const config = cfg({
      categories: ["Dobra", "Zepsuta"],
      series: [
        { name: "X", values: [60, 60] },
        { name: "Y", values: [40, -10] },
      ],
    });
    const { container } = render(<PercentStackedChart config={config} lang="pl" />);
    const box = container.querySelector<HTMLElement>("[role='img']");
    if (!box) throw new Error("brak kontenera");
    fireEvent.keyDown(box, { key: "ArrowRight" });
    fireEvent.keyDown(box, { key: "ArrowRight" });
    const dymek = container.querySelector(".neh-tooltip")?.textContent ?? "";
    expect(dymek).toContain("Zepsuta");
    expect(dymek.toLowerCase()).toContain("odrzucony");
    // Suma kategorii odrzuconej to KRESKA, nie zero: model wpisuje tam zero
    // jako wartość techniczną, a zero na ekranie twierdziłoby, że zmierzono
    // całość równą zeru.
    expect(dymek).toContain("-");
    const nazwa = box.getAttribute("aria-label") ?? "";
    expect(nazwa.toLowerCase()).toContain("odrzucony");
  });

  it("SEGMENT BEZ DŁUGOŚCI podaje w dymku, DLACZEGO go nie ma", () => {
    // Zero i brak są osobnymi stanami: zero jest pomiarem, brak
    // nieuzupełnionym polem. Segment o zerowej grubości jest nietrafialny
    // wskaźnikiem, więc jedyną drogą do tej odpowiedzi jest klawiatura - i po
    // to strzałka pionowa chodzi po WSZYSTKICH segmentach, nie tylko po
    // widocznych.
    const { container } = render(
      <PercentStackedChart
        config={cfg({
          categories: ["A", "B"],
          series: [
            { name: "Jest", values: [10, 10] },
            { name: "Zero", values: [0, 5] },
          ],
        })}
        lang="pl"
      />,
    );
    const box = container.querySelector<HTMLElement>("[role='img']");
    if (!box) throw new Error("brak kontenera");
    fireEvent.keyDown(box, { key: "ArrowRight" });
    fireEvent.keyDown(box, { key: "ArrowDown" });
    const dymek = container.querySelector(".neh-tooltip")?.textContent ?? "";
    expect(dymek).toContain("Zero");
    expect(dymek).toContain("zero podane w arkuszu");
    // Wartość jest podana, a udziału nie ma czym pokazać - i to jest kreska,
    // nie „0%".
    expect(dymek).not.toContain("0%");
  });
});

describe("PercentStackedChart - przypadki brzegowe arkusza", () => {
  it("PUSTY arkusz nie renderuje NICZEGO, nie pustego <svg>", () => {
    const { container } = render(
      <PercentStackedChart config={cfg({ categories: [], series: [] })} lang="pl" />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("JEDNA kategoria i JEDNA seria nie wywracają rysunku", () => {
    const { container } = render(
      <PercentStackedChart
        config={cfg({ categories: ["A"], series: [{ name: "X", values: [42] }] })}
        lang="pl"
      />,
    );
    expect(all(container, SEG)).toHaveLength(1);
    // Jedyny segment jest pełny, czyli od zera do stu - i to jest właśnie
    // powód, dla którego stoi tu obserwacja o formie.
    const z = zasieg(all(container, SEG)[0]);
    expect(z.dol).toBeCloseTo(Y_ZERA, 5);
    expect(z.gora).toBeCloseTo(Y_STU, 5);
    expect(container.textContent ?? "").not.toContain("NaN");
  });

  it("SAME LUKI: każdy słupek jest kreską, a rysunek nie wypisuje nie-liczby", () => {
    const { container } = render(
      <PercentStackedChart
        config={cfg({
          categories: ["A", "B", "C"],
          series: [{ name: "X", values: [null, null, null] }],
        })}
        lang="pl"
      />,
    );
    expect(all(container, SEG)).toHaveLength(0);
    expect(all(container, "[data-role='gap']")).toHaveLength(3);
    expect(container.textContent ?? "").not.toContain("NaN");
  });

  it("NaN, nieskończoność i wartości skrajne nie docierają na ekran jako napisy", () => {
    // `Intl.NumberFormat.format(NaN)` zwraca literalny napis „NaN", a bramka
    // `blockMatrix.test.tsx` szuka go w `textContent` całej strony. Treść
    // bloku przychodzi z bazy i bywa z cofniętej wersji edytora.
    const { container } = render(
      <PercentStackedChart
        config={cfg({
          categories: ["A", "B", "C", "D"],
          showValues: true,
          series: [
            { name: "X", values: [1, Number.NaN, Number.POSITIVE_INFINITY, 1e308] },
            { name: "Y", values: [1, 1, 1, 1] },
          ],
        })}
        lang="pl"
      />,
    );
    const tresc = container.textContent ?? "";
    for (const zly of ["NaN", "Infinity", "undefined", "∞", "[object Object]"]) {
      expect(tresc, zly).not.toContain(zly);
    }
    // Nieskończoność w atrybucie nie pokazuje się jako tekst, ale wycina
    // znacznik z rysunku bez śladu w konsoli.
    for (const el of all(container, "svg *")) {
      for (const attr of ["x", "y", "width", "height", "d", "x1", "y1", "x2", "y2"]) {
        const v = el.getAttribute(attr);
        if (v === null) continue;
        expect(/NaN|Infinity/.test(v), `${attr}="${v}"`).toBe(false);
      }
    }
  });

  it("PUSTA NAZWA SERII nie daje dymka bez nazwy wiersza", () => {
    // `parseChartSeries` przepuszcza pustą nazwę, a dymek bez nazwy wiersza
    // nie mówi, czego dotyczy liczba - wtedy nagłówek kolumny tabeli danych
    // jest jedyną uczciwą nazwą.
    const { container } = render(
      <PercentStackedChart
        config={cfg({
          categories: ["A"],
          series: [
            { name: "", values: [1] },
            { name: "", values: [1] },
          ],
        })}
        lang="pl"
      />,
    );
    const box = container.querySelector<HTMLElement>("[role='img']");
    if (!box) throw new Error("brak kontenera");
    fireEvent.keyDown(box, { key: "ArrowRight" });
    fireEvent.keyDown(box, { key: "ArrowUp" });
    expect(container.querySelector(".neh-tooltip")?.textContent).toContain("Seria");
  });

  it("wysokość pola nigdy nie schodzi pod podłogę, choćby etykiety chciały więcej", () => {
    // Obrócone etykiety potrafią zażądać więcej miejsca, niż wykres ma
    // wysokości. Wcześniej ta nadwyżka schodziła z płótna na podpis pod
    // wykresem; tu limit idzie do drabiny, a pole kreślenia zostaje.
    const { container } = render(
      <PercentStackedChart
        config={cfg({
          height: 160,
          categories: Array.from({ length: 12 }, () => "Województwo mazowieckie"),
          series: [
            { name: "X", values: Array.from({ length: 12 }, () => 1) },
            { name: "Y", values: Array.from({ length: 12 }, () => 1) },
          ],
        })}
        lang="pl"
      />,
    );
    const hit = container.querySelector("rect.neh-hit");
    expect(Number(hit?.getAttribute("height"))).toBeGreaterThanOrEqual(40);
    expect(all(container, SEG).length).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */
/*  PRZEGLĄD ADWERSARIALNY                                                    */
/*                                                                            */
/*  Poniższe testy powstały PO renderze, z założeniem, że coś jest zepsute,   */
/*  i każdy z nich był CZERWONY przed poprawką, którą opisuje. Trzymam je      */
/*  osobno, bo ich tytuły mówią o defektach, a nie o wymaganiach - a defekt    */
/*  raz znaleziony ma zostać przypięty testem, nawet gdy wymaganie wyglądało   */
/*  na spełnione.                                                             */
/* -------------------------------------------------------------------------- */

describe("PercentStackedChart - odwołania do definicji w <defs>", () => {
  /** Wszystkie adresy `url(#...)` użyte jako farba na tym rysunku. */
  const odwolania = (root: HTMLElement): string[] =>
    all(root, "svg *")
      .flatMap((el) => ["fill", "stroke"].map((a) => el.getAttribute(a) ?? ""))
      .filter((v) => v.startsWith("url(#"))
      .map((v) => v.slice(5, -1));

  it("SEGMENTY nie dostają kreskowanej nakładki także w wariancie gradientowym", () => {
    const { container } = render(
      <PercentStackedChart
        config={cfg({
          categories: ["A", "B"],
          barStyle: "gradient",
          series: [
            { name: "X", values: [1, 1], colorSlot: 9 },
            { name: "Y", values: [1, 1], colorSlot: 16 },
          ],
        })}
        lang="pl"
      />,
    );
    const adresy = odwolania(container);
    expect(adresy.some((id) => id.endsWith("-hatch"))).toBe(false);
    // WŁASNOŚĆ: każda farba przez odwołanie ma pod tym adresem definicję.
    // Pytam o wszystkie, nie tylko o kreskowanie - ta sama pułapka czeka przy
    // każdej rampie gradientu dopisanej kiedyś warunkowo.
    for (const id of adresy) {
      expect(container.querySelector(`[id='${id}']`), id).not.toBeNull();
    }
  });

  it("dwie serie na TYM SAMYM slocie nie dublują identyfikatora rampy", () => {
    // ZNALEZIONY DEFEKT. `colorSlot` przepuszcza z arkusza każdy numer od 1 do
    // 8, więc autor wolno posadzi dwie serie na jednym slocie - a rampa była
    // wypisywana po SERIACH, nie po slotach. W dokumencie stawały wtedy dwa
    // elementy o jednym `id` (dokument niepoprawny, a odwołanie wskazuje
    // pierwszy z brzegu) i React dostawał dwoje dzieci o tym samym kluczu.
    const { container } = render(
      <PercentStackedChart
        config={cfg({
          categories: ["A"],
          barStyle: "gradient",
          series: [
            { name: "X", values: [1], colorSlot: 3 },
            { name: "Y", values: [1], colorSlot: 3 },
          ],
        })}
        lang="pl"
      />,
    );
    const ids = all(container, "[id]").map((e) => e.getAttribute("id"));
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size, ids.join(" ")).toBe(ids.length);
    // ...a rampa dla tego slotu nadal jest, czyli odsianie powtórzeń nie
    // zabrało definicji, której rysunek używa.
    expect(all(container, "linearGradient")).toHaveLength(1);
    for (const id of odwolania(container)) {
      expect(container.querySelector(`[id='${id}']`), id).not.toBeNull();
    }
  });
});

describe("PercentStackedChart - wskazanie starsze niż arkusz", () => {
  /** Arkusz skrócony do jednej kategorii i jednej serii. */
  const KROTKI: Record<string, Json> = {
    categories: ["Polska"],
    series: [{ name: "Usługi", values: [7] }],
  };

  it("PODŚWIETLENIE KOLUMNY NIE ZOSTAJE POZA POLEM po skróceniu arkusza", () => {
    // ZNALEZIONY DEFEKT. Stan trzyma numery, a podgląd edytora podmienia
    // konfigurację pod tym samym komponentem: po skróceniu arkusza z trzech
    // kategorii do jednej `activeBar` wskazywał słupek, którego już nie ma.
    // Podświetlenie pytało o SAM NUMER (`activeBar !== null`), więc rysowało
    // się pod `catCenter(2)` przy paśmie liczonym dla jednej kategorii: x =
    // 1376 na płótnie szerokim 720 px. `overflow-visible` wypuszcza taki
    // prostokąt na sąsiedni blok strony - i to przy dymku, którego już nie ma,
    // bo dymek pyta o SŁUPEK. Poprawka: jeden warunek dla obu.
    const { container, rerender } = render(<PercentStackedChart config={cfg(BAZA)} lang="pl" />);
    const box = container.querySelector<HTMLElement>("[role='img']");
    if (!box) throw new Error("brak kontenera");
    fireEvent.keyDown(box, { key: "ArrowRight" });
    fireEvent.keyDown(box, { key: "ArrowRight" });
    fireEvent.keyDown(box, { key: "ArrowRight" });
    fireEvent.keyDown(box, { key: "ArrowUp" });
    expect(container.querySelector("rect[fill='var(--foreground)']")).not.toBeNull();

    rerender(<PercentStackedChart config={cfg(KROTKI)} lang="pl" />);
    // Kategorii numer trzy nie ma, więc nie ma czego podświetlać.
    expect(container.querySelector("rect[fill='var(--foreground)']")).toBeNull();
    expect(container.querySelector(".neh-tooltip")).toBeNull();
    // WŁASNOŚĆ OGÓLNA: żaden prostokąt nie wychodzi poza płótno. Rysunek
    // z `overflow-visible` nie ma krawędzi, która by go przycięła, więc to
    // jedyne miejsce, w którym da się to sprawdzić.
    const plotno = Number(container.querySelector("svg")?.getAttribute("width"));
    for (const r of all(container, "svg rect")) {
      expect(num(r, "x"), r.getAttribute("class") ?? "").toBeGreaterThanOrEqual(0);
      expect(num(r, "x") + num(r, "width")).toBeLessThanOrEqual(plotno);
    }
  });

  it("STRZAŁKA PIONOWA DAJE SIĘ RUSZYĆ po skróceniu arkusza", () => {
    // ZNALEZIONY DEFEKT, druga strona tego samego. Pion czytał segmenty spod
    // `activeBar ?? 0` przez osłonę „nie ma słupka - nic nie rób", więc po
    // skróceniu arkusza strzałka pionowa milczała w nieskończoność: wskazanie
    // dawało się zdjąć wyłącznie Escapem albo strzałką poziomą. Przycięcie
    // indeksu do zakresu LECZY stan zamiast go omijać.
    const { container, rerender } = render(<PercentStackedChart config={cfg(BAZA)} lang="pl" />);
    const box = container.querySelector<HTMLElement>("[role='img']");
    if (!box) throw new Error("brak kontenera");
    fireEvent.keyDown(box, { key: "ArrowRight" });
    fireEvent.keyDown(box, { key: "ArrowRight" });
    fireEvent.keyDown(box, { key: "ArrowRight" });
    rerender(<PercentStackedChart config={cfg(KROTKI)} lang="pl" />);
    fireEvent.keyDown(box, { key: "ArrowUp" });
    const czynny = container.querySelector("[data-role='segment'][data-active='true']");
    expect(czynny?.getAttribute("data-bar")).toBe("0");
    expect(container.querySelector(".neh-tooltip")?.textContent).toContain("Polska");
  });

  it("segment spoza skróconego stosu nie wypisuje cudzej liczby", () => {
    // Ten sam mechanizm na drugiej osi: po skróceniu listy serii `activeSeg`
    // wskazuje segment, którego nie ma. Dymek ma wtedy pokazać sumę kategorii
    // (to jedyne, co o tym słupku nadal wiadomo), a nie liczbę z pamięci.
    const { container, rerender } = render(<PercentStackedChart config={cfg(BAZA)} lang="pl" />);
    const box = container.querySelector<HTMLElement>("[role='img']");
    if (!box) throw new Error("brak kontenera");
    fireEvent.keyDown(box, { key: "ArrowRight" });
    fireEvent.keyDown(box, { key: "ArrowUp" });
    fireEvent.keyDown(box, { key: "ArrowUp" });
    fireEvent.keyDown(box, { key: "ArrowUp" });
    rerender(
      <PercentStackedChart
        config={cfg({ ...BAZA, series: [{ name: "Usługi", values: [60000, 5000, 2000] }] })}
        lang="pl"
      />,
    );
    const dymek = container.querySelector(".neh-tooltip")?.textContent ?? "";
    expect(dymek).toContain("Polska");
    expect(dymek).toContain("Suma kategorii");
    expect(dymek).not.toContain("Rolnictwo");
  });
});

describe("PercentStackedChart - etykieta sumy ustępuje, gdy nie ma dla niej pasma", () => {
  /** Arkusz o zadanej liczbie kategorii i sumie 100 000 w każdej. */
  const arkusz = (ile: number): Record<string, Json> => ({
    showValues: true,
    categories: Array.from({ length: ile }, (_, i) => `k${i}`),
    series: [
      { name: "A", values: Array.from({ length: ile }, () => 60000) },
      { name: "B", values: Array.from({ length: ile }, () => 40000) },
    ],
  });

  it("sąsiednie sumy NIE NACHODZĄ NA SIEBIE, gdy kategorii jest niewiele", () => {
    // Własność, nie liczba: pudełka napisów liczone z narysowanego `x`
    // i zmierzonej szerokości tekstu muszą być rozłączne.
    const { container } = render(<PercentStackedChart config={cfg(arkusz(6))} lang="pl" />);
    const sumy = all(container, "[data-role='bar-total']");
    expect(sumy).toHaveLength(6);
    const pudelka = sumy.map((el) => {
      const w = estimateLabelWidth(el.textContent ?? "", FONT_AXIS);
      return { od: num(el, "x") - w / 2, do: num(el, "x") + w / 2 };
    });
    for (let i = 1; i < pudelka.length; i += 1) {
      expect(pudelka[i].od, `sumy ${i - 1} i ${i}`).toBeGreaterThan(pudelka[i - 1].do);
    }
  });

  it("PRZY WIELU KATEGORIACH ZNIKA CAŁY RZĄD, a liczba zostaje w dymku", () => {
    // ZNALEZIONY DEFEKT. Etykieta udziału ustępuje, gdy nie mieści się
    // w poprzek segmentu, ale suma nad słupkiem nie pytała o nic: przy
    // dwudziestu kategoriach pasmo ma 33 px, a napis „100 000" 47,7 px, więc
    // sąsiednie liczby wchodziły jedna w drugą o czternaście pikseli i nie dało
    // się przeczytać żadnej. Ustępują WSZYSTKIE, bo rząd, w którym część
    // słupków ma sumę, a część nie, czytałby się jako „tamtych nie zmierzono".
    const { container } = render(<PercentStackedChart config={cfg(arkusz(20))} lang="pl" />);
    expect(all(container, SEG).length).toBeGreaterThan(0);
    expect(all(container, "[data-role='bar-total']")).toHaveLength(0);
    // Liczba nie ginie: wszystkie trzy kanały sumy bezwzględnej stoją.
    const box = container.querySelector<HTMLElement>("[role='img']");
    if (!box) throw new Error("brak kontenera");
    expect(box.getAttribute("aria-label")).toContain("100 000");
    fireEvent.keyDown(box, { key: "ArrowRight" });
    expect(container.querySelector(".neh-tooltip")?.textContent).toContain("100 000");
  });
});

describe("PercentStackedChart - wskaźnik na polu rysunku", () => {
  it("wskaźnik nad polem NIEZMIERZONYM nie wskazuje niczego", () => {
    // Przed pierwszym układem (i w SSR) prostokąt trafień ma zerowe wymiary,
    // więc przeliczenie na punkty procentowe dzieliłoby przez zero. Defekt,
    // który to łapie: dymek o kategorii wybranej z nie-liczby.
    const { container } = render(<PercentStackedChart config={cfg(BAZA)} lang="pl" />);
    const hit = container.querySelector("rect.neh-hit");
    if (!hit) throw new Error("brak warstwy trafień");
    fireEvent.pointerMove(hit, { clientX: 100, clientY: 100 });
    expect(container.querySelector(".neh-tooltip")).toBeNull();
    expect(container.querySelector("[data-active='true']")).toBeNull();
  });

  it("wskaźnik nad LUKĄ podaje powód, a nie segment sąsiada", () => {
    // Kolumna bez struktury jest pełnoprawnym celem: strefa trafienia to CAŁE
    // pasmo, więc nad luką dymek musi powiedzieć, czego tam nie ma. Defekt,
    // który to łapie: wskazanie „przyklejone" do ostatniego trafionego
    // segmentu, czyli liczba z sąsiedniej kategorii pod kursorem w tej.
    const { container } = render(
      <PercentStackedChart
        config={cfg({
          categories: ["Dobra", "Pusta"],
          series: [
            { name: "X", values: [60, null] },
            { name: "Y", values: [40, null] },
          ],
        })}
        lang="pl"
      />,
    );
    const hit = container.querySelector("rect.neh-hit");
    if (!hit) throw new Error("brak warstwy trafień");
    stubPlotRect(hit, 668, INNER_H);
    fireEvent.pointerMove(hit, { clientX: 100, clientY: 100 });
    expect(container.querySelector(".neh-tooltip")?.textContent).toContain("Dobra");
    fireEvent.pointerMove(hit, { clientX: 500, clientY: 100 });
    const dymek = container.querySelector(".neh-tooltip")?.textContent ?? "";
    expect(dymek).toContain("Pusta");
    expect(dymek).toContain("żadna seria nie podała");
    // Suma kategorii bez ani jednej liczby to KRESKA, nie zero.
    expect(dymek).toContain("-");
    expect(container.querySelector("[data-role='segment'][data-active='true']")).toBeNull();
  });

  it("MYSZKA opuszczająca pole gasi dymek, w odróżnieniu od palca", () => {
    // Dwa urządzenia, dwie reguły: mysz ma kursor, który naprawdę wyszedł poza
    // wykres, a palec schodzi z ekranu po każdym stuknięciu. Defekt, który to
    // łapie: jedna reguła dla obu, czyli dymek, który albo zostaje po wyjściu
    // kursora, albo gaśnie natychmiast po stuknięciu.
    const { container } = render(<PercentStackedChart config={cfg(BAZA)} lang="pl" />);
    const hit = container.querySelector("rect.neh-hit");
    if (!hit) throw new Error("brak warstwy trafień");
    stubPlotRect(hit, 668, INNER_H);
    fireEvent.pointerMove(hit, { clientX: 100, clientY: 100, pointerType: "mouse" });
    expect(container.querySelector(".neh-tooltip")).not.toBeNull();
    fireEvent.pointerLeave(hit, { pointerType: "mouse" });
    expect(container.querySelector(".neh-tooltip")).toBeNull();
    expect(container.querySelector("rect[fill='var(--foreground)']")).toBeNull();
  });
});

describe("PercentStackedChart - klawiatura wchodzi z obu stron", () => {
  const dymek = (root: HTMLElement): string =>
    root.querySelector(".neh-tooltip")?.textContent ?? "";

  it("ArrowLeft z pustego wskazania wchodzi od KOŃCA osi", () => {
    // Wejście od lewej zawsze w pierwszy słupek znaczyłoby, że strzałka
    // w lewo z niczego robi to samo co strzałka w prawo - a kierunek ma tu
    // znaczyć kierunek.
    const { container } = render(<PercentStackedChart config={cfg(BAZA)} lang="pl" />);
    const box = container.querySelector<HTMLElement>("[role='img']");
    if (!box) throw new Error("brak kontenera");
    fireEvent.keyDown(box, { key: "ArrowLeft" });
    expect(dymek(container)).toContain("Francja");
  });

  it("strzałka PIONOWA bez wcześniejszej poziomej wchodzi w pierwszy słupek", () => {
    // Czytelnik klawiatury nie musi wiedzieć, że najpierw trzeba wybrać
    // kolumnę: pion bez wybranej kolumny ma wejść w pierwszą, a nie milczeć.
    const { container } = render(<PercentStackedChart config={cfg(BAZA)} lang="pl" />);
    const box = container.querySelector<HTMLElement>("[role='img']");
    if (!box) throw new Error("brak kontenera");
    fireEvent.keyDown(box, { key: "ArrowUp" });
    const czynny = container.querySelector("[data-role='segment'][data-active='true']");
    expect(czynny?.getAttribute("data-bar")).toBe("0");
    expect(czynny?.getAttribute("data-series")).toBe("0");
    // ...a wejście od góry wskazuje szczyt stosu, nie krawędź odniesienia.
    fireEvent.keyDown(box, { key: "Escape" });
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(
      container
        .querySelector("[data-role='segment'][data-active='true']")
        ?.getAttribute("data-series"),
    ).toBe("2");
  });

  it("ARKUSZ BEZ ANI JEDNEJ SERII: pion nie ma po czym chodzić i nic nie wybucha", () => {
    // Kategorie bez serii to legalna treść bloku (autor wpisał nagłówki
    // i jeszcze nie wpisał liczb). Słupek nie ma wtedy segmentów, więc pion
    // nie ma czego wskazać - ale musi o tym MILCZEĆ, a nie rzucić.
    const { container } = render(
      <PercentStackedChart config={cfg({ categories: ["A", "B"], series: [] })} lang="pl" />,
    );
    const box = container.querySelector<HTMLElement>("[role='img']");
    if (!box) throw new Error("brak kontenera");
    expect(all(container, "[data-role='gap']")).toHaveLength(2);
    fireEvent.keyDown(box, { key: "ArrowUp" });
    expect(container.querySelector("[data-active='true']")).toBeNull();
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(container.querySelector("[data-active='true']")).toBeNull();
    // ...a strzałka pozioma nadal chodzi po słupkach, bo „dlaczego tu nic nie
    // ma" jest pytaniem, na które ten rysunek musi odpowiedzieć.
    fireEvent.keyDown(box, { key: "ArrowRight" });
    expect(dymek(container)).toContain("A");
    expect(container.textContent ?? "").not.toContain("NaN");
  });
});

describe("PercentStackedChart - milczenie modelu zostaje kreską", () => {
  it("SERIA BEZ UDZIAŁU w jakimkolwiek słupku ma w opisie KRESKI, nie zera", () => {
    // Seria, która wszędzie wpisała zero, nie ma udziału najmniejszego ani
    // największego - model milczy (`null`). Zero wyświetlone w tym miejscu
    // wygląda tak samo wiarygodnie jak liczba policzona i twierdzi, że udział
    // ZMIERZONO i wynosi on zero procent.
    const { container } = render(
      <PercentStackedChart
        config={cfg({
          categories: ["A", "B"],
          series: [
            { name: "Jest", values: [10, 10] },
            { name: "Pusta", values: [0, 0] },
          ],
        })}
        lang="pl"
      />,
    );
    const box = container.querySelector<HTMLElement>("[role='img']");
    const opis = (box?.getAttribute("aria-describedby") ?? "").split(" ")[1];
    const brzeg = container.querySelector(`#${opis}`)?.textContent ?? "";
    const pusta = brzeg.slice(brzeg.indexOf("Seria Pusta"));
    expect(pusta).toContain("Udział najmniejszy -");
    expect(pusta).toContain("Rozpiętość udziału -");
    expect(pusta).toContain("Przesunięcie -");
    expect(pusta).not.toContain("Udział najmniejszy 0");
    // ...a seria, która udział ma, dostaje liczbę - więc kreska niesie
    // różnicę, a nie jest domyślnym napisem.
    expect(brzeg).toContain("Udział najmniejszy 100%");
  });

  it("SEGMENT BEZ LICZBY ma w dymku kreskę przy wartości, a nie zero", () => {
    // Brak nie jest zerem: zero jest pomiarem, brak nieuzupełnionym polem.
    // Wartość bezwzględna wypisana jako „0" przy niewypełnionym polu jest
    // liczbą, której nikt nie zmierzył.
    const { container } = render(
      <PercentStackedChart
        config={cfg({
          categories: ["A", "B"],
          series: [
            { name: "Jest", values: [10, 10] },
            { name: "Brak", values: [10, null] },
          ],
        })}
        lang="pl"
      />,
    );
    const box = container.querySelector<HTMLElement>("[role='img']");
    if (!box) throw new Error("brak kontenera");
    fireEvent.keyDown(box, { key: "ArrowRight" });
    fireEvent.keyDown(box, { key: "ArrowRight" });
    fireEvent.keyDown(box, { key: "ArrowUp" });
    fireEvent.keyDown(box, { key: "ArrowUp" });
    const dymek = container.querySelector(".neh-tooltip")?.textContent ?? "";
    expect(dymek).toContain("Brak");
    expect(dymek).toContain("liczby nie podano");
    expect(dymek).not.toContain("0%");
    // Wiersz wartości i wiersz udziału są OBA kreską - segment bez liczby nie
    // ma ani jednego, ani drugiego.
    expect(dymek.match(/-/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});

describe("PercentStackedChart - drabina etykiet kategorii", () => {
  const podpisy = (root: HTMLElement): Element[] =>
    all(root, "text[fill='var(--muted-foreground)']:not(.tabular-nums)");
  const arkusz = (etykiety: string[], height = 320): Record<string, Json> => ({
    height,
    categories: etykiety,
    series: [
      { name: "X", values: etykiety.map(() => 1) },
      { name: "Y", values: etykiety.map(() => 1) },
    ],
  });

  it("etykieta szersza od pasma ZAWIJA SIĘ, zamiast zniknąć", () => {
    // Przerzedzenie zabiera z osi połowę etykiet, a zawinięcie nie zabiera
    // żadnej. Defekt, który to łapie: render rysujący `plan.labels` jednym
    // `<text>` także w trybie zawiniętym - napis stoi wtedy w jednej linii
    // szerszej niż pasmo i wchodzi na sąsiada.
    const { container } = render(
      <PercentStackedChart
        config={cfg(arkusz(Array.from({ length: 6 }, (_, i) => `Polska Wschodnia ${i + 1}`)))}
        lang="pl"
      />,
    );
    const teksty = podpisy(container);
    expect(teksty).toHaveLength(6);
    for (const el of teksty) {
      const linie = [...el.querySelectorAll("tspan")];
      expect(linie.length).toBeGreaterThan(1);
      // Druga linia jest PRZESUNIĘTA W DÓŁ i wraca na tę samą pionową oś -
      // bez `x` na każdym `tspan` druga linia ucieka w prawo.
      expect(linie[1].getAttribute("dy")).toBe(`${WRAP_LINE_EM}em`);
      expect(linie[1].getAttribute("x")).toBe(linie[0].getAttribute("x"));
    }
  });

  it("gdy zawinięcie nie wystarcza, etykiety OBRACAJĄ SIĘ wokół swojego punktu", () => {
    // Obrót kupuje miejsce w poziomie za miejsce w pionie. Defekt, który to
    // łapie: obrót wokół początku układu zamiast wokół punktu etykiety -
    // napisy lądują wtedy w zupełnie innym miejscu rysunku.
    const { container } = render(
      <PercentStackedChart
        config={cfg(arkusz(Array.from({ length: 12 }, (_, i) => `Województwo mazowieckie ${i}`)))}
        lang="pl"
      />,
    );
    const teksty = podpisy(container);
    expect(teksty.length).toBeGreaterThan(0);
    for (const el of teksty) {
      const transform = el.getAttribute("transform") ?? "";
      expect(transform).toMatch(/^rotate\(-45 /);
      // Punkt obrotu to punkt etykiety, co do piksela.
      expect(transform).toContain(`${el.getAttribute("x")} ${el.getAttribute("y")}`);
      expect(el.getAttribute("text-anchor")).toBe("end");
    }
  });

  it("etykieta SKRÓCONA niesie pełną treść w <title>", () => {
    // Reguła silnika: nigdy skrót bez podpowiedzi. Defekt, który to łapie:
    // oś z napisami „01.01", po której nie da się dojść, którego to roku.
    const dni = Array.from({ length: 40 }, (_, i) =>
      i < 31
        ? `2024-01-${String(i + 1).padStart(2, "0")}`
        : `2024-02-${String(i - 30).padStart(2, "0")}`,
    );
    const { container } = render(<PercentStackedChart config={cfg(arkusz(dni))} lang="pl" />);
    const teksty = podpisy(container);
    expect(teksty.length).toBeGreaterThan(0);
    expect(teksty.length).toBeLessThan(dni.length);
    for (const el of teksty) {
      const tytul = el.querySelector("title")?.textContent ?? "";
      const data = /^2024-(\d{2})-(\d{2})$/.exec(tytul);
      if (data === null) throw new Error(`podpowiedź nie jest pełną datą: ${tytul}`);
      // SKRÓT JEST BEZSTRATNYM ZAPISEM TEJ SAMEJ DATY, a nie innym napisem:
      // „2024-01-15" schodzi do „15.01", więc z podpowiedzi i skrótu da się
      // odtworzyć jedno z drugiego. Defekt, który to łapie: podpowiedź
      // przyklejona do nie swojej etykiety (przerzedzenie zmienia indeksy).
      const skrot = (el.textContent ?? "").replace(tytul, "");
      expect(skrot).toBe(`${data[2]}.${data[1]}`);
    }
  });
});

describe("PercentStackedChart - ani jedna wstawka nie wychodzi surowa", () => {
  /**
   * ARKUSZE DOBRANE TAK, ŻEBY ODPALIĆ KAŻDE ZDANIE, które ten render umie
   * wypisać: wszystkie przypisy uczciwości, wszystkie obserwacje o formie,
   * oba dopiski dymka i nazwę dostępną w obu wariantach (z tytułem i bez).
   */
  const ARKUSZE: Record<string, Json>[] = [
    { ...BAZA, title: "Struktura", showValues: true },
    BAZA,
    { categories: ["A", "B"], series: [{ name: "X", values: [1, -2] }] },
    { categories: ["A", "B"], series: [{ name: "X", values: [0, 0] }] },
    { categories: ["A", "B"], series: [{ name: "X", values: [null, null] }] },
    {
      categories: ["A", "A"],
      series: [
        { name: "S", values: [1, 1] },
        { name: "S", values: [1, 1] },
      ],
    },
    {
      categories: ["A", "B"],
      unit: "%",
      series: [
        { name: "X", values: [40, 50] },
        { name: "Y", values: [56, 50] },
      ],
    },
    { categories: ["A"], series: [{ name: "X", values: [1e300] }] },
    {
      categories: ["A", "B"],
      series: [
        { name: "X", values: [10, 10] },
        { name: "Y", values: [10, null] },
      ],
    },
    {
      categories: ["A"],
      height: 640,
      series: [
        { name: "X", values: [49] },
        { name: "Y", values: [351] },
      ],
    },
    {
      categories: ["A", "B"],
      series: Array.from({ length: 8 }, (_, i) => ({
        name: `S${i}`,
        values: [1, 2],
        colorSlot: i + 1,
      })),
    },
  ];

  it("NIGDZIE NA STRONIE NIE MA CIĄGU {{ - ani w tekście, ani w atrybucie", () => {
    // TO JEST NAJTAŃSZY SPOSÓB, ŻEBY TEN SILNIK SKŁAMAŁ. i18next nie
    // podstawia wstawki, której nie dostał, i ZOSTAWIA ją w zdaniu surową -
    // klucz istnieje, tłumaczenie istnieje, brakuje wyłącznie liczby, więc
    // ani typy, ani bramka parytetu PL/EN, ani bramka rozjazdu kod-słownik
    // tego nie widzą. Jedyne, co to łapie, to napis na ekranie.
    //
    // Pytam o WSZYSTKIE atrybuty, nie tylko o tekst: nazwa dostępna
    // (`aria-label`) niesie tu tytuł przez wstawkę `{{title}}`, a jej treść
    // w `textContent` nie występuje.
    for (const lang of ["pl", "en"] as const) {
      for (const arkusz of ARKUSZE) {
        const config = cfg(arkusz);
        const { container } = render(<PercentStackedChart config={config} lang={lang} />);
        const box = container.querySelector<HTMLElement>("[role='img']");
        const gdzie = `${lang} ${JSON.stringify(arkusz).slice(0, 70)}`;
        /** Wszystko, co w tej chwili widać: tekst plus KAŻDY atrybut. */
        const napisy = (): string =>
          [
            container.textContent ?? "",
            ...all(container, "*").flatMap((el) => [...el.attributes].map((a) => a.value)),
          ].join(" | ");
        const sprawdz = (co: string): void => {
          expect(napisy().includes("{{"), `${gdzie} ${co}`).toBe(false);
          // ...i żadna ŚCIEŻKA SŁOWNIKA nie wyszła na wierzch zamiast zdania.
          // Klucz bez treści i18next zwraca jako własną nazwę, więc pod
          // rysunkiem stanęłoby „percentStacked.note.rescaled".
          expect(/percentStacked\.|a11y\./.test(napisy()), `${gdzie} ${co}`).toBe(false);
        };
        sprawdz("bez wskazania");
        // DYMEK I JEGO DOPISEK POWSTAJĄ DOPIERO PO WSKAZANIU, a zdań jest
        // tam tyle, ile stanów segmentu - więc obchodzę KAŻDY słupek i KAŻDY
        // segment. Jedno wskazanie sprawdzałoby jedno zdanie z kilkunastu.
        for (let b = 0; box !== null && b < config.categories.length; b += 1) {
          fireEvent.keyDown(box, { key: "ArrowRight" });
          sprawdz(`słupek ${b}`);
          for (let s = 0; s < config.series.length; s += 1) {
            fireEvent.keyDown(box, { key: "ArrowUp" });
            sprawdz(`słupek ${b}, segment ${s}`);
          }
        }
      }
    }
  });
});

it("emits the category and segment selected by touch", () => {
  const selected = vi.fn();
  const { container } = render(
    <PercentStackedChart config={cfg(BAZA)} lang="pl" onSelect={selected} />,
  );
  const hit = container.querySelector("rect.neh-hit");
  if (!hit) throw new Error("missing hit layer");
  stubPlotRect(hit, 668, INNER_H);
  fireEvent.pointerDown(hit, { clientX: 100, clientY: 100, pointerType: "touch" });
  expect(selected).toHaveBeenCalledWith(
    expect.objectContaining({ categoryIndex: 0, seriesName: "Przemysł" }),
  );
});

it("selects a whole category from the keyboard without inventing a segment", () => {
  const selected = vi.fn();
  const { container } = render(
    <PercentStackedChart config={cfg(BAZA)} lang="pl" onSelect={selected} />,
  );
  const chart = container.querySelector('[role="img"]');
  if (!chart) throw new Error("missing chart");
  fireEvent.keyDown(chart, { key: "ArrowRight" });
  fireEvent.keyDown(chart, { key: "Enter" });
  expect(selected).toHaveBeenCalledWith(
    expect.objectContaining({ categoryIndex: 0, seriesIndex: null, seriesName: null, value: null }),
  );
});

it("selects only the category when a captured pointer moves above the stack", () => {
  const selected = vi.fn();
  const { container } = render(
    <PercentStackedChart config={cfg(BAZA)} lang="pl" onSelect={selected} />,
  );
  const hit = container.querySelector("rect.neh-hit");
  if (!hit) throw new Error("missing hit layer");
  stubPlotRect(hit, 668, INNER_H);
  fireEvent.pointerDown(hit, { clientX: -10, clientY: -10, pointerType: "touch" });
  expect(selected).toHaveBeenCalledWith(
    expect.objectContaining({ categoryIndex: 0, seriesIndex: null, seriesName: null, value: null }),
  );
});
