// Model skrzynki. Najważniejsze asercje w tym pliku są trzy i wszystkie
// dotyczą uczciwości, a nie wyglądu: wąs kończy się na OBSERWACJI (nie na
// ogrodzeniu), próba poniżej progu MILCZY o kwartylach (nie zgaduje ich),
// a model nie wypuszcza NaN ani Infinity (bo `Intl.NumberFormat.format(NaN)`
// zwraca literalny napis "NaN", który bramka `blockMatrix` znajduje
// w `textContent` strony).
//
// Testy pinują ZACHOWANIE modelu, nie jego implementację: sprawdzają liczby,
// które czytelnik odczyta z rysunku i z tabeli, a nie kolejność kroków, która
// do nich doprowadziła.
import { describe, expect, it } from "vitest";
import type { Json } from "@/lib/content-model/json";
import { parseChartConfig } from "@/lib/charts/parse";
import type { ChartSeries } from "@/lib/charts/types";
import {
  BOXPLOT_MIN_SAMPLE,
  BOXPLOT_SAMPLE_RATIO_MAX,
  BOX_WIDTH_RATIO,
  FAR_OUT_IQR_FACTOR,
  QUANTILE_METHOD,
  WHISKER_IQR_FACTOR,
  boxplotExtent,
  boxplotFormAdvice,
  boxplotModel,
  boxplotModelFromConfig,
  boxplotTable,
  quantileR7,
  type BoxplotInput,
} from "@/lib/charts/kinds/boxplot";

function seria(name: string, values: (number | null)[], colorSlot = 1): ChartSeries {
  return { name, values, colorSlot };
}

/**
 * Wejście modelu z serii. `categories` są etykietami WIERSZY arkusza (numer
 * obserwacji), bo w trybie domyślnym grupami są serie - dlatego generujemy je
 * z długości najdłuższej serii, dokładnie tak, jak zrobiłby to arkusz.
 */
function wejscie(series: ChartSeries[], sampleSize: number | null = null): BoxplotInput {
  const rows = Math.max(0, ...series.map((s) => s.values.length));
  return {
    categories: Array.from({ length: rows }, (_, i) => `obs ${i + 1}`),
    series,
    sampleSize,
  };
}

const PROBA_9 = [1, 2, 3, 4, 5, 6, 7, 8, 9];

describe("boxplot - kwantyle i metoda ich liczenia", () => {
  it("kwartyle liczy metodą linear-r7, tą samą, którą ma arkusz czytelnika", () => {
    // Bez tego testu wolno byłoby podmienić metodę na zawiasy Tukeya i nikt
    // by nie zauważył, dopóki czytelnik nie przeliczył próby w Excelu:
    // dla [1..8] typ 7 daje q1 = 2,75, a zawiasy 2,5. Model deklaruje metodę
    // w `quantileMethod`, więc deklaracja i arytmetyka muszą się zgadzać.
    expect(quantileR7([1, 2, 3, 4, 5, 6, 7, 8], 0.25)).toBeCloseTo(2.75, 10);
    expect(quantileR7([1, 2, 3, 4, 5, 6, 7, 8], 0.5)).toBeCloseTo(4.5, 10);
    expect(quantileR7([1, 2, 3, 4, 5, 6, 7, 8], 0.75)).toBeCloseTo(6.25, 10);
    expect(boxplotModel(wejscie([seria("A", PROBA_9)])).quantileMethod).toBe(QUANTILE_METHOD);
  });

  it("kwartyl na styku skrajnych wykładników MIESZA, a nie interpoluje różnicą", () => {
    // REGRESJA NA UDOWODNIONY DEFEKT. Poprzednia postać liczyła interpolację
    // różnicą (`a + (b - a) * f`) i miała na niej osłonę wyświetlania: dla tej
    // próby `b - a` przepełnia do nieskończoności, osłona cofała wynik do `a`
    // i funkcja ogłaszała pierwszy kwartyl RÓWNY NAJMNIEJSZEJ OBSERWACJI.
    // To nie jest awaria, którą czytelnik zauważy - to zła liczba na rysunku
    // i w tabeli, wyglądająca dokładnie jak liczba policzona z danych.
    const skrajna = [-1e308, 1e308, 1e308, 1e308];
    expect(quantileR7(skrajna, 0.25)).toBe(5e307);
    expect(quantileR7(skrajna, 0.25)).not.toBe(skrajna[0]);
    // Mieszanie `a*(1-t) + b*t` jest kombinacją wypukłą, więc kwantyl nigdy
    // nie wychodzi poza parę obserwacji, między którymi leży.
    const wynik = quantileR7(skrajna, 0.25) ?? 0;
    expect(wynik).toBeGreaterThan(-1e308);
    expect(wynik).toBeLessThan(1e308);
  });

  it("na zwykłych próbach daje DOKŁADNIE te same liczby co przed zmianą wzoru", () => {
    // Zmiana wzoru interpolacji ma naprawiać skrajne wykładniki i nie ruszać
    // niczego innego: dla próby, która mieści się w podwójnej precyzji, obie
    // postacie są tą samą liczbą co do bitu. Bez tego testu poprawka mogłaby
    // po cichu przesunąć kwartyle na każdym wykresie w repozytorium.
    for (const p of [0.25, 0.5, 0.75]) {
      const roznica = (a: number, b: number, t: number) => a + (b - a) * t;
      const proba = [1, 2, 3, 4, 5, 6, 7, 8];
      const h = (proba.length - 1) * p;
      const lo = Math.floor(h);
      const hi = Math.min(lo + 1, proba.length - 1);
      expect(quantileR7(proba, p)).toBe(roznica(proba[lo], proba[hi], h - lo));
    }
  });

  it("rząd kwantyla spoza [0, 1] daje MILCZENIE, a nie kwantyl przycięty do skraju", () => {
    // "Kwantyl rzędu -0,5" jest błędem wywołania, a nie danymi do przycięcia:
    // zaciśnięcie do zakresu podawało minimum próby jako odpowiedź na pytanie,
    // którego nikt nie zadał.
    expect(quantileR7(PROBA_9, -0.5)).toBeNull();
    expect(quantileR7(PROBA_9, 1.5)).toBeNull();
    expect(quantileR7(PROBA_9, NaN)).toBeNull();
    expect(quantileR7([], 0.5)).toBeNull();
  });

  it("pięcioliczbowy zestaw na próbie dziewięciu obserwacji", () => {
    // Pin na całą arytmetykę skrzynki naraz. Gdyby ktoś przesunął pozycję
    // kwantyla o jeden (klasyczny błąd `n * p` zamiast `(n - 1) * p`), q1
    // wyszłoby 3,5 zamiast 3 i pudło byłoby o ćwierć szersze niż dane.
    const box = boxplotModel(wejscie([seria("A", PROBA_9)])).boxes[0];
    expect(box.n).toBe(9);
    expect(box.min).toBe(1);
    expect(box.q1).toBe(3);
    expect(box.median).toBe(5);
    expect(box.q3).toBe(7);
    expect(box.max).toBe(9);
    expect(box.iqr).toBe(4);
    expect(box.hasQuartiles).toBe(true);
    expect(box.outliers).toEqual([]);
  });

  it("obserwacje sortuje NUMERYCZNIE, nie leksykograficznie", () => {
    // `sort()` bez komparatora porównuje napisy, więc [10, 2, 33, 4, 5]
    // zostawałoby w tej kolejności i mediana lądowała na 33. Błąd jest cichy:
    // nic nie rzuca, wszystkie liczby są skończone, a wykres pokazuje
    // nieprawdę - dlatego ten test jest tu, a nie w opisie.
    const box = boxplotModel(wejscie([seria("A", [10, 2, 33, 4, 5])])).boxes[0];
    expect(box.median).toBe(5);
    expect(box.q1).toBe(4);
    expect(box.q3).toBe(10);
    expect(box.min).toBe(2);
    expect(box.max).toBe(33);
  });

  it("nie mutuje tablicy wartości, którą dostał", () => {
    // Sortowanie w miejscu psułoby wywołującego: tabela danych dostawałaby
    // obserwacje w innej kolejności niż arkusz autora, a defekt ujawniałby się
    // dopiero poza modelem.
    const wartosci = [10, 2, 33, 4, 5];
    boxplotModel(wejscie([seria("A", wartosci)]));
    expect(wartosci).toEqual([10, 2, 33, 4, 5]);
  });
});

describe("boxplot - wąsy i obserwacje odstające", () => {
  it("wąs kończy się na OBSERWACJI, nigdy na ogrodzeniu", () => {
    // Najczęstszy błąd implementacji skrzynki. Dla tej próby górne ogrodzenie
    // wypada na 14,5, a największa obserwacja wewnątrz to 9 - wąs pociągnięty
    // do 14,5 rysowałby pomiar, którego nikt nie wykonał.
    const box = boxplotModel(wejscie([seria("A", [...PROBA_9, 100])])).boxes[0];
    expect(box.fenceHigh).toBeCloseTo(14.5, 10);
    expect(box.whiskerHigh).toBe(9);
    expect(box.whiskerLow).toBe(1);
    expect(box.outliers.map((p) => p.value)).toEqual([100]);
  });

  it("odstającą dalej niż 3 IQR oznacza osobno", () => {
    // Kilkadziesiąt punktów za wąsem czyta się jako jednolita chmura, a dwa
    // z nich mogą leżeć dziesięć razy dalej - bez stopnia render nie ma czym
    // tego odróżnić.
    // Dla tej próby ogrodzenie 1,5 IQR wypada na 16, a 3 IQR na 23,5: 20 leży
    // między nimi (odstająca zwyczajna), 100 daleko za drugim (skrajna).
    const box = boxplotModel(wejscie([seria("A", [...PROBA_9, 20, 100])])).boxes[0];
    const daleko = box.outliers.filter((p) => p.severity === "far").map((p) => p.value);
    const blisko = box.outliers.filter((p) => p.severity === "mild").map((p) => p.value);
    expect(daleko).toEqual([100]);
    expect(blisko).toEqual([20]);
    expect(box.whiskerHigh).toBe(9);
    expect(FAR_OUT_IQR_FACTOR).toBeGreaterThan(WHISKER_IQR_FACTOR);
  });

  it("obserwacje odstające łapie po obu stronach", () => {
    // Skan liczony tylko od góry (typowa oszczędność) gubi cały dolny ogon,
    // a rozkład skośny w lewo wygląda wtedy na symetryczny.
    const box = boxplotModel(wejscie([seria("A", [-100, ...PROBA_9, 100])])).boxes[0];
    expect(box.outliers.map((p) => p.value)).toEqual([-100, 100]);
    expect(box.whiskerLow).toBe(1);
    expect(box.whiskerHigh).toBe(9);
  });

  it("obserwacje odstające o tej samej wartości rozsuwa, więc widać je wszystkie", () => {
    // Bez rozsunięcia trzy obserwacje o wartości 100 rysują się jako jedna
    // kropka i wykres pokazuje jedną obserwację tam, gdzie są trzy.
    const box = boxplotModel(wejscie([seria("A", [...PROBA_9, 100, 100, 100])])).boxes[0];
    const offsety = box.outliers.map((p) => p.offset);
    expect(box.outliers).toHaveLength(3);
    expect(new Set(offsety).size).toBe(3);
    // Wachlarz jest symetryczny wokół środka, bo oś pozioma w paśmie grupy nie
    // niesie żadnej informacji - przesunięcie nie może sugerować wielkości.
    expect(offsety.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 10);
  });

  it("wachlarz remisów nie wychodzi poza skrzynkę, nawet przy dwudziestu remisach", () => {
    // Stały krok rozsunąłby dwadzieścia punktów na trzy szerokości pudła
    // i wjechałyby w kolumnę sąsiedniej grupy, czyli przypisałyby obserwacje
    // grupie, z której nie pochodzą.
    const remisy = Array.from({ length: 20 }, () => 100);
    const box = boxplotModel(wejscie([seria("A", [...PROBA_9, ...remisy])])).boxes[0];
    for (const p of box.outliers) {
      expect(Math.abs(p.offset)).toBeLessThanOrEqual(0.5);
    }
  });

  it("mnożnik ogrodzenia da się zmienić, a model podaje użytą wartość", () => {
    // 1,5 jest KONWENCJĄ Tukeya, nie prawem natury, więc model nie może
    // zakładać, że czytelnik zna domyślną liczbę: przypis tabeli bierze ją
    // z `whiskerFactor`.
    const model = boxplotModel(wejscie([seria("A", PROBA_9)]), { whiskerFactor: 0 });
    expect(model.whiskerFactor).toBe(0);
    expect(model.boxes[0].whiskerLow).toBe(3);
    expect(model.boxes[0].whiskerHigh).toBe(7);
    expect(model.boxes[0].outliers.map((p) => p.value)).toEqual([1, 2, 8, 9]);
    // Podział nadal domyka próbę - zmiana progu nie może gubić obserwacji.
    expect(model.honesty.outlierPartitionOk).toBe(true);
  });
});

describe("boxplot - próba za mała na kwartyle", () => {
  it("poniżej progu MILCZY o kwartylach i oddaje surowe obserwacje", () => {
    // Skrzynka z trzech liczb udaje statystykę rzędu, której nie ma: pudło ma
    // wtedy szerokość wynikającą z arytmetyki, nie z danych. Zgadywanie
    // kwartyli jest tu gorsze od milczenia, bo obrazek wygląda identycznie
    // jak skrzynka z próby trzystu.
    const model = boxplotModel(wejscie([seria("A", [4, 1, 9])]));
    const box = model.boxes[0];
    expect(box.n).toBe(3);
    expect(box.hasQuartiles).toBe(false);
    expect(box.q1).toBeNull();
    expect(box.median).toBeNull();
    expect(box.q3).toBeNull();
    expect(box.iqr).toBeNull();
    expect(box.whiskerLow).toBeNull();
    expect(box.whiskerHigh).toBeNull();
    // Obserwacje NIE GINĄ - render narysuje je jako kolumnę punktów.
    expect(box.points.map((p) => p.value)).toEqual([1, 4, 9]);
    // Min i max zostają, bo są POMIARAMI, a nie statystykami rzędu.
    expect(box.min).toBe(1);
    expect(box.max).toBe(9);
    expect(model.honesty.smallSamples).toEqual(["A"]);
  });

  it("milczy także w samosprawdzeniach, gdy żadna grupa nie ma kwartyli", () => {
    // Konwencja repo: `null` znaczy NIE MA CZEGO SPRAWDZAĆ. Zwrócenie `true`
    // byłoby zaświadczeniem, że mediana leży w pudle, którego nie ma.
    const h = boxplotModel(wejscie([seria("A", [1, 2]), seria("B", [3])])).honesty;
    expect(h.medianInsideBox).toBeNull();
    expect(h.whiskersInsideData).toBeNull();
    expect(h.whiskersAreObservations).toBeNull();
    expect(h.outlierPartitionOk).toBeNull();
    expect(h.smallSamples).toEqual(["A", "B"]);
  });

  it("dokładnie na progu kwartyle już są", () => {
    // Próg jest granicą ostrą: bez tego testu przesunięcie warunku o jeden
    // ("mniej lub równe") uciszałoby model na próbie pięciu obserwacji, która
    // ma pięć różnych pozycji, czyli pełny zestaw.
    const box = boxplotModel(wejscie([seria("A", [1, 2, 3, 4, 5])])).boxes[0];
    expect(BOXPLOT_MIN_SAMPLE).toBe(5);
    expect(box.hasQuartiles).toBe(true);
    expect(box.q1).toBe(2);
    expect(box.median).toBe(3);
    expect(box.q3).toBe(4);
    expect(box.points).toEqual([]);
  });
});

describe("boxplot - rozkład zdegenerowany", () => {
  it("IQR zero NAZYWA, a nie ukrywa", () => {
    // Skrzynka zwinięta w linię wygląda na błąd renderu, a jest właściwością
    // danych. Bez tej flagi podpis nie ma czym tego powiedzieć i czytelnik
    // uzna wykres za zepsuty albo, gorzej, za pusty.
    const model = boxplotModel(wejscie([seria("Stawka", [5, 5, 5, 5, 5, 5, 5, 42])]));
    const box = model.boxes[0];
    expect(box.iqr).toBe(0);
    expect(box.q1).toBe(5);
    expect(box.median).toBe(5);
    expect(box.q3).toBe(5);
    expect(box.collapsed).toBe(true);
    expect(model.honesty.collapsedSamples).toEqual(["Stawka"]);
    // Ogrodzenia zwijają się na tej samej liczbie, więc stopień odstawania
    // przestaje cokolwiek znaczyć - i dlatego nie udajemy, że znaczy.
    expect(box.outliers.map((p) => p.severity)).toEqual(["mild"]);
    expect(box.outliers.map((p) => p.value)).toEqual([42]);
  });

  it("próba z samych identycznych wartości nie produkuje ani jednej odstającej", () => {
    // Przy IQR = 0 ogrodzenia leżą na wartości próby. Warunek ostry ("poza
    // ogrodzeniem") musi zostać ostry, inaczej cała próba zostaje wyrzucona
    // za wąsy i wykres pokazuje same kropki bez skrzynki.
    const box = boxplotModel(wejscie([seria("A", [7, 7, 7, 7, 7, 7])])).boxes[0];
    expect(box.outliers).toEqual([]);
    expect(box.whiskerLow).toBe(7);
    expect(box.whiskerHigh).toBe(7);
    expect(box.collapsed).toBe(true);
  });
});

describe("boxplot - wiele grup obok siebie", () => {
  const model = boxplotModel(
    wejscie([
      seria("Polska", [10, 12, 14, 16, 18, 20], 1),
      seria("Czechy", [11, 13, 15, 17, 19], 3),
      seria("Słowacja", [9, 11, 13, 15, 17, 19, 21], 4),
    ]),
  );

  it("pasma grup są rozłączne, przyległe i pokrywają całą szerokość", () => {
    // Główny sposób użycia tego rodzaju to skrzynki obok siebie. Pasma
    // nachodzące dają skrzynki wjeżdżające jedna w drugą, a pasma z luką dają
    // rysunek, który nie wypełnia obszaru kreślenia i wygląda na ucięty.
    expect(model.boxes.map((b) => b.band.start)).toEqual([0, 1 / 3, 2 / 3]);
    expect(model.boxes[2].band.end).toBeCloseTo(1, 10);
    for (const box of model.boxes) {
      expect(box.center).toBeGreaterThan(box.band.start);
      expect(box.center).toBeLessThan(box.band.end);
      // Skrzynka jest węższa od pasma, bo obwódki dwóch sąsiednich skrzynek
      // stykając się dają fałszywy trzeci kształt na granicy.
      expect(box.width).toBeLessThan(box.band.end - box.band.start);
      expect(box.width).toBeCloseTo(BOX_WIDTH_RATIO / 3, 10);
    }
  });

  it("każda grupa zachowuje swój slot palety z konfiguracji", () => {
    // Kolor niesie TOŻSAMOŚĆ grupy. Przeliczanie slotu z pozycji zamieniałoby
    // kolory po usunięciu serii w edytorze i ten sam kraj miałby na dwóch
    // wykresach dwa kolory.
    expect(model.boxes.map((b) => b.colorSlot)).toEqual([1, 3, 4]);
    expect(model.boxes.map((b) => b.label)).toEqual(["Polska", "Czechy", "Słowacja"]);
  });

  it("samosprawdzenia przechodzą dla każdej grupy naraz", () => {
    expect(model.honesty.medianInsideBox).toBe(true);
    expect(model.honesty.whiskersInsideData).toBe(true);
    expect(model.honesty.whiskersAreObservations).toBe(true);
    expect(model.honesty.outlierPartitionOk).toBe(true);
  });

  it("jedna grupa zdegenerowana nie zataja się za poprawnymi", () => {
    // Listy etykiet, a nie flaga zbiorcza: podpis ma powiedzieć, KTÓRA
    // skrzynka jest zwinięta, bo przy sześciu grupach "jedna z grup" nie jest
    // informacją użyteczną.
    const mieszany = boxplotModel(
      wejscie([seria("Równa", [4, 4, 4, 4, 4]), seria("Różna", PROBA_9), seria("Pusta", [])]),
    );
    expect(mieszany.honesty.collapsedSamples).toEqual(["Równa"]);
    expect(mieszany.honesty.emptySamples).toEqual(["Pusta"]);
    expect(mieszany.honesty.medianInsideBox).toBe(true);
  });

  it("tryb transponowany grupuje po kategoriach", () => {
    // Blok w bazie może pochodzić z wykresu słupkowego, w którym seria była
    // powtórzeniem pomiaru (trzy laboratoria), a grupami są kategorie.
    // Bez tego trybu model czytałby taki arkusz jako pięć rozkładów po dwie
    // obserwacje, czyli milczałby o wszystkim.
    const transponowany = boxplotModel(
      {
        categories: ["Kwiecień", "Maj"],
        series: [
          seria("Lab 1", [1, 21]),
          seria("Lab 2", [2, 22]),
          seria("Lab 3", [3, 23]),
          seria("Lab 4", [4, 24]),
          seria("Lab 5", [5, 25]),
        ],
      },
      { groupBy: "category" },
    );
    expect(transponowany.groupBy).toBe("category");
    expect(transponowany.boxes.map((b) => b.label)).toEqual(["Kwiecień", "Maj"]);
    expect(transponowany.boxes.map((b) => b.n)).toEqual([5, 5]);
    expect(transponowany.boxes[0].median).toBe(3);
    expect(transponowany.boxes[1].median).toBe(23);
    // Slot z POZYCJI grupy, bo tylko pierwsze sloty są rozdzielne dla
    // daltonizmu, a indeks kategorii nie ma górnej granicy.
    expect(transponowany.boxes.map((b) => b.colorSlot)).toEqual([1, 2]);
  });
});

describe("boxplot - uczciwość wobec danych autora", () => {
  it("rozbieżność z zadeklarowanym n wykrywa", () => {
    // Realny defekt: podpis mówi "n = 300", bo tyle ankiet zebrano, a arkusz
    // bloku ma dziewięć wierszy, bo ktoś wkleił próbkę. Wykres i podpis mówią
    // wtedy o dwóch różnych badaniach.
    expect(boxplotModel(wejscie([seria("A", PROBA_9)], 300)).honesty.declaredSampleSizeOk).toBe(
      false,
    );
    expect(boxplotModel(wejscie([seria("A", PROBA_9)], 9)).honesty.declaredSampleSizeOk).toBe(true);
  });

  it("bez deklaracji autora milczy, a nie zaświadcza", () => {
    expect(boxplotModel(wejscie([seria("A", PROBA_9)])).honesty.declaredSampleSizeOk).toBeNull();
    // W trybie transponowanym `sampleSize` (liczba obserwacji NA SERIĘ) opisuje
    // co innego niż próba grupy, więc nie ma czego porównać.
    const transponowany = boxplotModel(
      { categories: ["A", "B"], series: [seria("s1", [1, 2]), seria("s2", [3, 4])], sampleSize: 2 },
      { groupBy: "category" },
    );
    expect(transponowany.honesty.declaredSampleSizeOk).toBeNull();
  });

  it("skrajnie nierówne próby nazywa, bo skrzynki wyglądają równoważnie", () => {
    // Skrzynki stoją obok siebie o tej samej szerokości, więc czytelnik czyta
    // je jako równoważne. Przy n = 5 i n = 60 nie są, a nic na rysunku tego
    // nie mówi.
    const duza = Array.from({ length: 60 }, (_, i) => i);
    const nierowne = boxplotModel(wejscie([seria("Mała", [1, 2, 3, 4, 5]), seria("Duża", duza)]));
    expect(nierowne.honesty.sampleRatio).toBe(12);
    expect(nierowne.honesty.sampleSizesBalanced).toBe(false);

    const rowne = boxplotModel(wejscie([seria("A", PROBA_9), seria("B", PROBA_9)]));
    expect(rowne.honesty.sampleRatio).toBe(1);
    expect(rowne.honesty.sampleSizesBalanced).toBe(true);
    expect(BOXPLOT_SAMPLE_RATIO_MAX).toBeGreaterThan(1);
  });

  it("same puste serie nie dają krotności prób do porównania", () => {
    // Bez osłony mianownika krotność wychodziła jako 0/0, czyli NaN, i szła
    // prosto do podpisu jako napis "NaN".
    const h = boxplotModel(wejscie([seria("A", []), seria("B", [null, null])])).honesty;
    expect(h.sampleRatio).toBeNull();
    expect(h.sampleSizesBalanced).toBeNull();
    expect(h.emptySamples).toEqual(["A", "B"]);
  });
});

describe("boxplot - zakres osi", () => {
  it("zakres obejmuje obserwacje odstające", () => {
    // Zakres policzony z samych wąsów zostawia odstające poza obszarem
    // kreślenia, gdzie są przycinane krawędzią - a wykres bez ogona wygląda na
    // kompletny, więc to przemilczenie jest niewykrywalne dla czytelnika.
    const model = boxplotModel(wejscie([seria("A", [-100, ...PROBA_9, 100])]));
    expect(boxplotExtent(model)).toEqual({ min: -100, max: 100 });
  });

  it("zakresu NIE rozciąga do zera", () => {
    // Skrzynka koduje położenie na wspólnej skali, a nie długość od zera. Oś
    // od zera przy próbie 980-1020 ścisnęłaby rozkład w jedną kreskę, czyli
    // wymazała to, co wykres ma pokazać.
    const model = boxplotModel(wejscie([seria("A", [980, 990, 1000, 1010, 1020])]));
    expect(boxplotExtent(model).min).toBeGreaterThan(0);
  });

  it("brak danych daje zakres jałowy, a nie wywrócony", () => {
    // Zwrócenie [Infinity, -Infinity] przenosiłoby nieskończoność do
    // `niceScale`, a stamtąd do etykiet osi.
    expect(boxplotExtent(boxplotModel(wejscie([seria("A", [null])])))).toEqual({ min: 0, max: 1 });
    expect(boxplotExtent(boxplotModel(wejscie([])))).toEqual({ min: 0, max: 1 });
  });
});

describe("boxplot - alternatywa tekstowa", () => {
  it("tabela podaje pięć liczb, odstające i parametry metody", () => {
    // Grafika nigdy nie jest jedyną drogą do liczby. Metoda kwantyli
    // i mnożnik ogrodzenia są UMOWAMI, więc muszą być w przypisie - inaczej
    // czytelnik przeliczający próbę u siebie dostanie inne kwartyle i będzie
    // miał rację.
    const tabela = boxplotTable(boxplotModel(wejscie([seria("A", [...PROBA_9, 100])])));
    expect(tabela.columns).toContain("median");
    expect(tabela.columns).toContain("outliers");
    expect(tabela.method).toEqual({
      quantile: QUANTILE_METHOD,
      whiskerFactor: WHISKER_IQR_FACTOR,
      minSample: BOXPLOT_MIN_SAMPLE,
    });
    const [wiersz] = tabela.rows;
    expect(wiersz.n).toBe(10);
    expect(wiersz.median).toBeCloseTo(5.5, 10);
    expect(wiersz.outliers).toEqual([100]);
    expect(wiersz.observations).toBeNull();
  });

  it("tabela liczy z TEGO SAMEGO modelu co rysunek", () => {
    // Dwa liczenia to dwa źródła prawdy, a rozjazd między nimi jest defektem
    // samym w sobie: czytelnik widzi medianę 5,5 na rysunku i 5 w tabeli i nie
    // ma sposobu rozstrzygnąć, która jest prawdziwa.
    const model = boxplotModel(wejscie([seria("A", PROBA_9), seria("B", [2, 4, 6, 8, 10, 12])]));
    const tabela = boxplotTable(model);
    expect(tabela.rows.map((r) => r.median)).toEqual(model.boxes.map((b) => b.median));
    expect(tabela.rows.map((r) => r.q1)).toEqual(model.boxes.map((b) => b.q1));
    expect(tabela.rows.map((r) => r.q3)).toEqual(model.boxes.map((b) => b.q3));
    expect(tabela.rows.map((r) => r.n)).toEqual(model.boxes.map((b) => b.n));
  });

  it("dla próby poniżej progu podaje obserwacje, a kwartyle zostawia puste", () => {
    // Alternatywa tekstowa nie może być bardziej stanowcza od rysunku: jeśli
    // model milczy o kwartylach, tabela też nie ma prawa ich podać. Cztery
    // liczby wypisane wprost są i tak ściślejsze od statystyki z czterech
    // liczb.
    const [wiersz] = boxplotTable(boxplotModel(wejscie([seria("A", [3, 1, 2])]))).rows;
    expect(wiersz.observations).toEqual([1, 2, 3]);
    expect(wiersz.q1).toBeNull();
    expect(wiersz.median).toBeNull();
    expect(wiersz.belowMinSample).toBe(true);
    expect(wiersz.min).toBe(1);
    expect(wiersz.max).toBe(3);
  });

  it("wiersz zwiniętej skrzynki jest oznaczony", () => {
    const [wiersz] = boxplotTable(boxplotModel(wejscie([seria("A", [2, 2, 2, 2, 2])]))).rows;
    expect(wiersz.collapsed).toBe(true);
    expect(wiersz.iqr).toBe(0);
  });
});

describe("boxplot - kiedy forma jest zła", () => {
  it("jedna grupa i małe próby dostają wskazanie lepszej formy", () => {
    // Dla jednej próby histogram mówi więcej tym samym miejscem, bo pokazuje
    // kształt, a nie pięć liczb. Bez tej porady edytor pozwalałby rysować
    // skrzynkę tam, gdzie nie ma czego porównywać.
    const rada = boxplotFormAdvice(boxplotModel(wejscie([seria("A", [1, 2, 3, 4, 5, 6])])));
    expect(rada).toContain("singleGroup");
    expect(rada).toContain("dotsBetter");
  });

  it("rozkład z atomem w jednym punkcie dostaje wskazanie histogramu", () => {
    // Gdy jedna wartość zajmuje więcej niż połowę próby, pięć liczb składa się
    // na tej samej liczbie i skrzynka pokazuje wyłącznie ogon rozkładu.
    const duza = [...Array.from({ length: 12 }, () => 5), 1, 2, 3, 40, 50];
    expect(boxplotFormAdvice(boxplotModel(wejscie([seria("A", duza)])))).toContain("tiesDominant");
  });

  it("dwie zdrowe grupy nie dostają żadnej porady", () => {
    // Ostrzeżenie, które widać zawsze, uczy ignorowania wszystkich ostrzeżeń.
    const duza = Array.from({ length: 30 }, (_, i) => i);
    const model = boxplotModel(
      wejscie([
        seria("A", duza),
        seria(
          "B",
          duza.map((v) => v + 5),
        ),
      ]),
    );
    expect(boxplotFormAdvice(model)).toEqual([]);
  });

  it("brak danych nie generuje porad", () => {
    expect(boxplotFormAdvice(boxplotModel(wejscie([])))).toEqual([]);
    expect(boxplotFormAdvice(boxplotModel(wejscie([seria("A", [null, null])])))).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/*  Odporność na dane z bazy                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Wszystkie liczby modelu wraz ze ścieżką, pod którą siedzą. Chodzimy po
 * strukturze, a nie po wybranych polach, bo test ma pilnować CAŁEGO modelu -
 * także pól dodanych po jego napisaniu.
 */
function liczbyModelu(node: unknown, sciezka = "model", out: [string, number][] = []) {
  if (typeof node === "number") {
    out.push([sciezka, node]);
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => liczbyModelu(v, `${sciezka}[${i}]`, out));
    return out;
  }
  if (node !== null && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) liczbyModelu(v, `${sciezka}.${k}`, out);
  }
  return out;
}

/**
 * Treść bloku pochodzi z bazy i może być z przyszłej albo cofniętej wersji
 * edytora, więc wejście modelu nie jest kontraktem, tylko danymi. Każdy z tych
 * przypadków był kiedyś źródłem NaN albo wyjątku w silnikach wykresów.
 */
const PRZYPADKI_BRZEGOWE: [string, BoxplotInput][] = [
  ["blok bez serii", { categories: [], series: [] }],
  ["seria pusta", wejscie([seria("A", [])])],
  ["seria z samych luk", wejscie([seria("A", [null, null, null, null, null, null])])],
  ["jedna kategoria", { categories: ["jedna"], series: [seria("A", [7])] }],
  ["jedna obserwacja", wejscie([seria("A", [42])])],
  ["wartości ujemne", wejscie([seria("A", [-9, -7, -5, -3, -1, -100])])],
  ["same zera", wejscie([seria("A", [0, 0, 0, 0, 0])])],
  ["luki wśród liczb", wejscie([seria("A", [1, null, 3, null, 5, null, 7])])],
  [
    "NaN i nieskończoności w wartościach",
    wejscie([seria("A", [NaN, Infinity, -Infinity, 1, 2, 3, 4, 5])]),
  ],
  ["wartości na granicy zakresu liczb", wejscie([seria("A", [-1e308, -1e308, 0, 1e308, 1e308])])],
  [
    // Kwantyl wypada tu MIĘDZY obserwacjami o przeciwnych skrajnych
    // wykładnikach, czyli dokładnie tam, gdzie interpolacja różnicą
    // przepełniała.
    "kwartyl interpolowany między skrajnymi wykładnikami",
    wejscie([seria("A", [-1e308, -1e308, 1e308, 1e308, 1e308, 1e308])]),
  ],
  ["slot palety zerowy", wejscie([seria("A", PROBA_9, 0)])],
  ["kategorii więcej niż wartości", { categories: ["a", "b", "c"], series: [seria("A", [1])] }],
  ["wartości więcej niż kategorii", { categories: ["a"], series: [seria("A", PROBA_9)] }],
  ["zadeklarowane n ujemne", wejscie([seria("A", PROBA_9)], -5)],
  ["dwadzieścia grup", wejscie(Array.from({ length: 20 }, (_, i) => seria(`g${i}`, PROBA_9)))],
];

describe("boxplot - odporność na dane z bazy", () => {
  for (const [nazwa, wejscieTestu] of PRZYPADKI_BRZEGOWE) {
    it(`nie rzuca i nie produkuje NaN ani Infinity: ${nazwa}`, () => {
      // WYMAGANIE TWARDE, nie higiena. Bramka `blockMatrix` sprawdza
      // `textContent` na obecność napisu "NaN", a `Intl.NumberFormat` zwraca
      // dla NaN literalny napis "NaN" - czyli jedno niedomknięte dzielenie
      // w modelu wychodzi na stronę jako słowo.
      for (const tryb of ["series", "category"] as const) {
        const model = boxplotModel(wejscieTestu, { groupBy: tryb });
        for (const [sciezka, liczba] of liczbyModelu(model)) {
          expect(Number.isFinite(liczba), `${sciezka} = ${liczba}`).toBe(true);
        }
        for (const [sciezka, liczba] of liczbyModelu(boxplotTable(model))) {
          expect(Number.isFinite(liczba), `${sciezka} = ${liczba}`).toBe(true);
        }
        const zakres = boxplotExtent(model);
        expect(Number.isFinite(zakres.min)).toBe(true);
        expect(Number.isFinite(zakres.max)).toBe(true);
        expect(zakres.min).toBeLessThanOrEqual(zakres.max);
        expect(() => boxplotFormAdvice(model)).not.toThrow();
      }
    });
  }

  it("NaN i nieskończoność w wartościach traktuje jak lukę, nie jak zero", () => {
    // Zero jest POMIAREM i weszłoby do kwartyli, przesuwając medianę w stronę,
    // której dane nie potwierdzają. Uszkodzona komórka nie jest pomiarem.
    const box = boxplotModel(wejscie([seria("A", [NaN, Infinity, 1, 2, 3, 4, 5])])).boxes[0];
    expect(box.n).toBe(5);
    expect(box.median).toBe(3);
    expect(box.min).toBe(1);
    expect(box.max).toBe(5);
  });

  it("skrajne wartości nie zamieniają rozkładu w zdegenerowany", () => {
    // Różnica kwartyli leżących po obu stronach zera przy 1e308 przepełnia do
    // Infinity. Zero jako wartość zastępcza oznaczałoby rozkład
    // ZDEGENEROWANY, czyli dokładną odwrotność prawdy o danych o skrajnym
    // rozproszeniu - i model wpisałby taką grupę do `collapsedSamples`.
    const model = boxplotModel(wejscie([seria("A", [-1e308, -1e308, 0, 1e308, 1e308])]));
    expect(model.boxes[0].collapsed).toBe(false);
    expect(model.honesty.collapsedSamples).toEqual([]);
    // ROZSTĘP W TABELI MILCZY, ZAMIAST NASYCAĆ SIĘ DO SUFITU ARYTMETYKI.
    // Stało tu wcześniej 1,7976931348623157e+308 - największa zapisywalna
    // liczba, podstawiona za różnicę, której zapisać się nie da. W kolumnie
    // IQR wygląda ona jak pomiar, a jest granicą typu `double`, i ta sama
    // próba dawała przez to trzy różne rozstępy w trzech rodzajach wykresu
    // (skrzynka 1,79e+308, histogram i rój 0). Nasycenie zostaje TAM, gdzie
    // jest wejściem do rysunku - rozsuwa ogrodzenia tak, że nic nie odstaje.
    expect(model.boxes[0].iqr).toBeNull();
    expect(model.boxes[0].iqr).not.toBe(0);
    // Ogrodzenie objęło całą próbę, więc żadna obserwacja nie została
    // ogłoszona odstającą - to jest ostrożna odpowiedź, o którą tu chodzi.
    expect(model.boxes[0].outliers).toEqual([]);
    expect(model.boxes[0].whiskerLow).toBe(-1e308);
    expect(model.boxes[0].whiskerHigh).toBe(1e308);
  });

  it("pierwszy kwartyl NIE cofa się do najmniejszej obserwacji przy skrajnych wykładnikach", () => {
    // REGRESJA NA UDOWODNIONY DEFEKT, tym razem na poziomie modelu. Pozycja
    // q1 wypada tu między -1e308 a 1e308, więc stara interpolacja różnicą
    // przepełniała, a osłona cofała wynik do dolnej obserwacji: model podawał
    // q1 = -1e308, czyli pierwszy kwartyl RÓWNY MINIMUM próby, w której trzy
    // czwarte obserwacji leży po drugiej stronie zera. Poprawną odpowiedzią
    // jest -5e+307 i to jest liczba, którą czytelnik odczyta z krawędzi pudła.
    const box = boxplotModel(wejscie([seria("A", [-1e308, -1e308, 1e308, 1e308, 1e308, 1e308])]))
      .boxes[0];
    expect(box.hasQuartiles).toBe(true);
    expect(box.q1).toBe(-5e307);
    expect(box.q1).not.toBe(box.min);
    expect(box.median).toBe(1e308);
    expect(box.q3).toBe(1e308);
    // Rozstęp liczy się tu normalnie (1,5e308 mieści się w podwójnej
    // precyzji), więc żadna osłona nie musi się odzywać.
    expect(box.iqr).toBe(1.5e308);
    expect(box.collapsed).toBe(false);
  });

  it("kwartyl niepoliczalny nazywa się INACZEJ niż próba za mała", () => {
    // Dwa różne powody milczenia nie mogą dzielić jednej listy: grupa
    // z trzystoma obserwacjami wpisana do `smallSamples` mówiłaby podpisowi,
    // że obserwacji jest mniej niż pięć. Dziś żadne wejście po
    // `observations` nie potrafi zamilczeć kwantyla, więc lista jest pusta -
    // i test pilnuje właśnie tego, żeby milczenie nie zaczęło się nazywać
    // cudzym powodem.
    const model = boxplotModel(
      wejscie([seria("Duża", [-1e308, -1e308, 1e308, 1e308, 1e308, 1e308]), seria("Mała", [1, 2])]),
    );
    expect(model.honesty.unquantifiableSamples).toEqual([]);
    expect(model.honesty.smallSamples).toEqual(["Mała"]);
  });

  it("slot palety z cofniętej wersji edytora podmienia na pozycję", () => {
    // Paleta liczy sloty od jednego, a seria zapisana starszym schematem może
    // nie mieć tego pola. Slot zerowy trafiał do `slotAt(0)` i wykres tracił
    // kolor.
    const model = boxplotModel(wejscie([seria("A", PROBA_9, 0), seria("B", PROBA_9, 2)]));
    expect(model.boxes.map((b) => b.colorSlot)).toEqual([1, 2]);
  });

  it("samosprawdzenia przechodzą na każdym przypadku brzegowym, który ma co sprawdzać", () => {
    // Test lustrzany do poprzedniego: brak NaN nie wystarcza, bo model mógłby
    // nie rzucać i jednocześnie rysować wąs poza zakresem danych.
    for (const [nazwa, wejscieTestu] of PRZYPADKI_BRZEGOWE) {
      const h = boxplotModel(wejscieTestu).honesty;
      for (const [pole, wynik] of [
        ["medianInsideBox", h.medianInsideBox],
        ["whiskersInsideData", h.whiskersInsideData],
        ["whiskersAreObservations", h.whiskersAreObservations],
        ["outlierPartitionOk", h.outlierPartitionOk],
      ] as const) {
        // `null` wolno (nie ma czego sprawdzać), `false` nie - to defekt.
        expect(wynik, `${nazwa}: ${pole}`).not.toBe(false);
      }
    }
  });
});

/* -------------------------------------------------------------------------- */
/*  Adapter z ChartConfig                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Konfiguracja przechodzi przez `parseChartConfig`, a nie jest sklejana
 * literałem, bo to jest DOKŁADNIE ta droga, którą blok idzie z bazy do
 * renderu: koercja liczb, przycięcie wartości do liczby kategorii i domyślne
 * pola robią różnicę, której literał by nie pokazał. `kind` jest tu obojętny
 * (adapter go nie czyta), więc zostaje przy rodzaju, który dziś istnieje.
 */
const konfig = (data: Record<string, Json>) => parseChartConfig({ kind: "bar", ...data });

/** Etykiety wierszy arkusza dla próby dziewięciu obserwacji. */
const WIERSZE_9 = PROBA_9.map((_, i) => `obs ${i + 1}`);

describe("boxplot - model z konfiguracji bloku", () => {
  it("czyta SERIĘ jako grupę, a jej wartości jako obserwacje", () => {
    // To jest cała konwencja odczytu arkusza dla rozkładu: kolumna na grupę,
    // wiersz na obserwację. Gdyby adapter czytał kategorie jako grupy,
    // dziewięć obserwacji zamieniłoby się w dziewięć grup po jednej
    // obserwacji, czyli wykres pokazałby dziewięć kropek zamiast dwóch
    // rozkładów - i nic w konfiguracji by tego nie zdradziło.
    const model = boxplotModelFromConfig(
      konfig({
        categories: WIERSZE_9,
        series: [
          { name: "Alfa", values: PROBA_9 },
          { name: "Beta", values: PROBA_9.map((v) => v * 2) },
        ],
      }),
    );
    expect(model.boxes.map((b) => b.label)).toEqual(["Alfa", "Beta"]);
    expect(model.boxes.map((b) => b.n)).toEqual([9, 9]);
    expect(model.boxes[1].median).toBe(10);
    expect(model.groupBy).toBe("series");
  });

  it("w trybie transponowanym grupą jest KATEGORIA, a obserwacje leżą w poprzek serii", () => {
    // Blok w bazie może pochodzić z wykresu słupkowego, w którym seria była
    // powtórzeniem pomiaru (pięć laboratoriów, cztery kwartały) - wtedy
    // grupami są kategorie. Bez tego trybu ten sam arkusz dałby pięć grup po
    // trzy obserwacje, czyli rozkład laboratoriów zamiast rozkładu pomiarów.
    const model = boxplotModelFromConfig(
      konfig({
        categories: ["Q1", "Q2", "Q3"],
        series: Array.from({ length: 5 }, (_, i) => ({
          name: `lab ${i + 1}`,
          values: [10 + i, 20 + i, 30 + i],
        })),
      }),
      { groupBy: "category" },
    );
    expect(model.boxes.map((b) => b.label)).toEqual(["Q1", "Q2", "Q3"]);
    expect(model.boxes.map((b) => b.n)).toEqual([5, 5, 5]);
    // Pięć obserwacji to próg kwartyli, więc grupa ma pełny zestaw pięciu
    // liczb, a nie kolumnę kropek.
    expect(model.boxes[0].hasQuartiles).toBe(true);
    expect(model.boxes[0].median).toBe(12);
  });

  it("seria bez ani jednej liczby zostaje PUSTĄ grupą i nie przesuwa pozostałych", () => {
    // Odrzucenie takiej serii uciszyłoby `honesty.emptySamples` na zawsze,
    // a przy okazji przesunęłoby pasma pozostałych grup - czyli pozycje
    // i kolory kolumn zmieniałyby się w trakcie wpisywania danych, bo autor
    // dopisał w edytorze wiersz, którego jeszcze nie wypełnił.
    const model = boxplotModelFromConfig(
      konfig({
        categories: WIERSZE_9,
        series: [
          { name: "Alfa", values: PROBA_9 },
          { name: "Pusta", values: [] },
          { name: "Beta", values: PROBA_9 },
        ],
      }),
    );
    expect(model.boxes.map((b) => b.label)).toEqual(["Alfa", "Pusta", "Beta"]);
    expect(model.honesty.emptySamples).toEqual(["Pusta"]);
    // Trzy pasma po jednej trzeciej szerokości - Beta stoi na trzecim, nie na
    // drugim.
    expect(model.boxes[2].band.start).toBeCloseTo(2 / 3, 10);
    expect(model.boxes[1].q1).toBeNull();
  });

  it("deklaracja `n` z podpisu dojeżdża do sprawdzenia uczciwości", () => {
    // Sprawdzamy DANE AUTORA, nie własną arytmetykę: podpis mówi "n = 300",
    // bo tyle ankiet zebrano, a w arkuszu jest dziewięć wierszy, bo ktoś
    // wkleił próbkę. Adapter, który gubi `sampleSize`, wycisza to na zawsze -
    // i nic nigdy nie zapali się na czerwono.
    const rozjazd = boxplotModelFromConfig(
      konfig({ categories: WIERSZE_9, series: [{ name: "A", values: PROBA_9 }], sampleSize: 300 }),
    );
    expect(rozjazd.honesty.declaredSampleSizeOk).toBe(false);

    const zgodne = boxplotModelFromConfig(
      konfig({ categories: WIERSZE_9, series: [{ name: "A", values: PROBA_9 }], sampleSize: 9 }),
    );
    expect(zgodne.honesty.declaredSampleSizeOk).toBe(true);

    // Bez deklaracji model MILCZY, a nie zaświadcza zgodność.
    const bezDeklaracji = boxplotModelFromConfig(
      konfig({ categories: WIERSZE_9, series: [{ name: "A", values: PROBA_9 }] }),
    );
    expect(bezDeklaracji.honesty.declaredSampleSizeOk).toBeNull();
  });

  it("slot palety z arkusza zostaje tożsamością grupy", () => {
    // Kolor niesie tu WYŁĄCZNIE tożsamość grupy, więc slot wybrany przez
    // autora musi przejść przez adapter bez zmiany - inaczej ta sama grupa
    // miałaby na dwóch wykresach dwa różne kolory i przestałaby być tą samą
    // grupą dla czytelnika.
    const model = boxplotModelFromConfig(
      konfig({
        categories: WIERSZE_9,
        series: [
          { name: "A", values: PROBA_9, colorSlot: 5 },
          { name: "B", values: PROBA_9, colorSlot: 3 },
        ],
      }),
    );
    expect(model.boxes.map((b) => b.colorSlot)).toEqual([5, 3]);
  });

  it("blok świeżo dodany w edytorze nie wywraca modelu", () => {
    // Stan początkowy bloku wykresu: zero kategorii, zero serii. Pasmo
    // liczone przed sprawdzeniem liczby grup dałoby tu dzielenie przez zero,
    // a `Math.max(...[])` w zakresie osi dałoby `-Infinity`.
    const model = boxplotModelFromConfig(konfig({ categories: [], series: [] }));
    expect(model.boxes).toEqual([]);
    expect(model.honesty.medianInsideBox).toBeNull();
    expect(model.honesty.sampleRatio).toBeNull();
    expect(boxplotExtent(model)).toEqual({ min: 0, max: 1 });
  });

  it("wartości poza liczbą kategorii nie wchodzą do próby", () => {
    // `parseChartConfig` przycina wektor wartości do liczby kategorii, więc
    // arkusz z trzema wierszami i dziewięcioma liczbami w serii daje próbę
    // trzech obserwacji. Adapter nie ma prawa tego obchodzić: liczby bez
    // wiersza nie mają identyfikatora, a próba, która rośnie o dane niewidoczne
    // w arkuszu, jest nieweryfikowalna.
    const model = boxplotModelFromConfig(
      konfig({ categories: ["a", "b", "c"], series: [{ name: "A", values: PROBA_9 }] }),
    );
    expect(model.boxes[0].n).toBe(3);
    expect(model.boxes[0].hasQuartiles).toBe(false);
  });
});
