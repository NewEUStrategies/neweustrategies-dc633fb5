// Model mapy ciepła. Ten plik pinuje ZACHOWANIE, nie implementację: pozycje
// na rampie pinujemy tam, gdzie wynikają z reguły podanej w specyfikacji
// (sekwencyjna liniowo po zakresie, rozbieżna symetrycznie wokół punktu
// neutralnego), a wszędzie indziej sprawdzamy własności, które muszą zostać
// prawdziwe po każdej przebudowie: że luka NIGDY nie dostaje pozycji na
// rampie, że skala rozbieżna nie wchodzi bez punktu zerowego w danych, że
// wartość poza domeną jest zgłoszona, a nie wygładzona, i że model NIGDY nie
// produkuje NaN ani nieskończoności.
//
// Najważniejsza grupa w tym pliku to "dane z bazy": treść bloku przychodzi
// z bazy i może pochodzić z wersji edytora, której ten kod nie zna, a bramka
// `src/components/blocks/__tests__/blockMatrix.test.tsx` sprawdza
// `textContent` bloków na obecność napisu "NaN" - `Intl.NumberFormat.format`
// zwraca dla nieliczby literalne "NaN", więc jedna nieosłonięta dzielnia
// w modelu wychodzi na stronie jako tekst.
import { describe, expect, it } from "vitest";
import {
  HEATMAP_DOMINANCE_TOLERANCE,
  HEATMAP_LABEL_CELL_MIN_H,
  HEATMAP_LABEL_CELL_MIN_W,
  HEATMAP_MAX_CELLS,
  HEATMAP_VALUE_LABEL_MAX_CELLS,
  heatmapExtent,
  heatmapFormAdvice,
  heatmapModel,
  heatmapModelFromConfig,
  heatmapTable,
  heatmapValueLabelFit,
  type HeatmapModel,
} from "@/lib/charts/kinds/heatmap";
import { defaultChartConfig } from "@/lib/charts/parse";
import type { ChartConfig, ChartSeries } from "@/lib/charts/types";

/** Wszystkie liczby w strukturze, także zagnieżdżone w komórkach i brzegach. */
function zbierzLiczby(wartosc: unknown, out: number[] = []): number[] {
  if (typeof wartosc === "number") {
    out.push(wartosc);
    return out;
  }
  if (Array.isArray(wartosc)) {
    for (const el of wartosc) zbierzLiczby(el, out);
    return out;
  }
  if (wartosc !== null && typeof wartosc === "object") {
    for (const el of Object.values(wartosc)) zbierzLiczby(el, out);
  }
  return out;
}

/** Wszystkie napisy w strukturze - do sprawdzenia, czy nie wyciekł "NaN". */
function zbierzNapisy(wartosc: unknown, out: string[] = []): string[] {
  if (typeof wartosc === "string") {
    out.push(wartosc);
    return out;
  }
  if (Array.isArray(wartosc)) {
    for (const el of wartosc) zbierzNapisy(el, out);
    return out;
  }
  if (wartosc !== null && typeof wartosc === "object") {
    for (const el of Object.values(wartosc)) zbierzNapisy(el, out);
  }
  return out;
}

/**
 * Jedno wspólne sprawdzenie dla całego pliku: model, tabela i doradzanie
 * formy nie zawierają ani jednej nieliczby i ani jednego napisu, który
 * bramka `blockMatrix` czyta jako defekt.
 */
function bezNieliczb(model: HeatmapModel): void {
  const struktury: unknown[] = [model, heatmapTable(model), heatmapFormAdvice(model)];
  for (const struktura of struktury) {
    for (const liczba of zbierzLiczby(struktura)) {
      expect(Number.isFinite(liczba)).toBe(true);
    }
    for (const napis of zbierzNapisy(struktura)) {
      expect(napis).not.toContain("NaN");
      expect(napis).not.toContain("undefined");
      expect(napis).not.toContain("[object Object]");
    }
  }
}

/** Macierz 2 na 2 z pełnym wypełnieniem - punkt odniesienia większości grup. */
function macierz2x2(): HeatmapModel {
  return heatmapModel(
    ["10", "20"],
    ["1", "2"],
    [
      [1, 2],
      [3, 4],
    ],
  );
}

function config(
  series: readonly Partial<ChartSeries>[],
  categories: readonly string[],
): ChartConfig {
  return {
    ...defaultChartConfig(),
    categories: categories.map((c) => c),
    series: series.map((s, i) => ({
      name: s.name ?? `S${i + 1}`,
      values: s.values ?? [],
      colorSlot: s.colorSlot ?? i + 1,
    })),
  };
}

describe("heatmapModel - siatka i geometria", () => {
  it("buduje komórkę na każdą parę wiersz-kolumna", () => {
    // Bez tego render musiałby sam iterować po seriach i kategoriach, czyli
    // powtarzać logikę odczytu luk - a każda druga kopia tego odczytu jest
    // miejscem, w którym luka znów staje się zerem.
    const model = macierz2x2();
    expect(model.cells).toHaveLength(4);
    expect(model.cellCount).toBe(4);
    expect(model.rows).toBe(2);
    expect(model.columns).toBe(2);
    expect(model.filled).toBe(4);
    expect(model.gaps).toBe(0);
  });

  it("oddaje geometrię w jednostkach WZGLĘDNYCH obszaru kreślenia", () => {
    // Model nie zna pikseli. Gdyby liczył w nich, ten sam blok na telefonie
    // i na desktopie potrzebowałby dwóch modeli, a `ResizeObserver`
    // przeliczałby wartości danych zamiast samego rozkładu.
    const model = heatmapModel(
      ["a", "b"],
      ["x", "y", "z"],
      [
        [1, 2, 3],
        [4, 5, 6],
      ],
    );
    expect(model.cells[0]).toMatchObject({ x: 0, y: 0 });
    expect(model.cells[0].w).toBeCloseTo(1 / 3, 12);
    expect(model.cells[0].h).toBeCloseTo(1 / 2, 12);
    const ostatnia = model.cells[model.cells.length - 1];
    expect(ostatnia.x + ostatnia.w).toBeCloseTo(1, 12);
    expect(ostatnia.y + ostatnia.h).toBeCloseTo(1, 12);
  });

  it("pierwsza seria jest PIERWSZYM wierszem, pierwsza kategoria pierwszą kolumną", () => {
    // Kolejność musi zgadzać się z tym, co autor widzi w edytorze; odwrócenie
    // wierszy dawałoby mapę będącą lustrem arkusza i każdy wniosek
    // o kierunku gradientu wychodziłby na opak.
    const model = heatmapModel(
      ["gora", "dol"],
      ["lewo", "prawo"],
      [
        [1, 2],
        [3, 4],
      ],
    );
    expect(model.cells[0]).toMatchObject({ rowLabel: "gora", columnLabel: "lewo", value: 1 });
    expect(model.cells[3]).toMatchObject({ rowLabel: "dol", columnLabel: "prawo", value: 4 });
  });
});

describe("heatmapModel - skala sekwencyjna", () => {
  it("normalizuje liniowo po zakresie danych", () => {
    // To jest cała umowa z renderem: render dostaje `t` w 0..1 i miesza
    // kotwice rampy, nie licząc niczego sam. Gdyby liczył, legenda i komórki
    // mogłyby rozjechać się na dwóch różnych zakresach.
    const model = heatmapModel(
      ["a", "b"],
      ["x", "y"],
      [
        [0, 5],
        [10, null],
      ],
    );
    expect(model.scale.type).toBe("sequential");
    expect(model.scale.min).toBe(0);
    expect(model.scale.max).toBe(10);
    expect(model.cells.map((c) => c.t)).toEqual([0, 0.5, 1, null]);
  });

  it("nie nadaje pozycji na rampie znakowi wartości i to zgłasza", () => {
    // Skala sekwencyjna na danych o obu znakach koduje spadek i wzrost dwoma
    // odcieniami tego samego koloru, więc czytelnik odczytuje różnicę
    // natężenia tam, gdzie w danych jest różnica znaku. Bez `signEncodedOk`
    // ten defekt nie miałby żadnego nośnika.
    const model = heatmapModel(
      ["a", "b"],
      ["x", "y"],
      [
        [-5, 0],
        [5, 2],
      ],
      { scale: "sequential" },
    );
    expect(model.scale.type).toBe("sequential");
    expect(model.signEncodedOk).toBe(false);
    bezNieliczb(model);
  });

  it("MILCZY o kodowaniu znaku, gdy dane są jednoznakowe", () => {
    // Konwencja repo: `null` znaczy NIE MA CZEGO SPRAWDZAĆ. Model, który
    // zwracałby tu `true`, zaświadczałby o osłonie, której nie badał.
    const model = macierz2x2();
    expect(model.signEncodedOk).toBeNull();
  });

  it("niesie slot odcienia rampy, a przy rozbieżnej go nie ma", () => {
    // Rampa sekwencyjna to JEDEN odcień ze zmianą jasności (sekcja 2), więc
    // model mówi, KTÓRY odcień; rampa rozbieżna bierze parę semantyczną,
    // a nie kolor kategorii, i slot byłby tam bełkotem.
    const sekwencyjna = heatmapModel(
      ["a", "b"],
      ["x", "y"],
      [
        [1, 2],
        [3, 4],
      ],
      { colorSlot: 4 },
    );
    expect(sekwencyjna.scale.slot).toBe(4);
    const rozbiezna = heatmapModel(
      ["a", "b"],
      ["x", "y"],
      [
        [-1, 2],
        [3, 4],
      ],
      { colorSlot: 4 },
    );
    expect(rozbiezna.scale.type).toBe("diverging");
    expect(rozbiezna.scale.slot).toBeNull();
  });
});

describe("heatmapModel - skala rozbieżna", () => {
  it("wchodzi sama, gdy dane leżą po OBU stronach zera", () => {
    // Reguła z sekcji 2 mówi "rozbieżne tylko gdy istnieje sensowny punkt
    // zerowy", a to jest fakt o danych, nie o gustach - dlatego decyduje
    // model, nie render, który rozkładu wartości nie widzi.
    const model = heatmapModel(
      ["a", "b"],
      ["x", "y"],
      [
        [-4, 0],
        [8, null],
      ],
    );
    expect(model.scale.type).toBe("diverging");
    expect(model.scale.neutral).toBe(0);
    expect(model.scale.spread).toBe(8);
    expect(model.divergingJustifiedOk).toBe(true);
    expect(model.cells.map((c) => c.signed)).toEqual([-0.5, 0, 1, null]);
    expect(model.cells.map((c) => c.t)).toEqual([0.25, 0.5, 1, null]);
  });

  it("normalizuje SYMETRYCZNIE wokół punktu neutralnego", () => {
    // Normalizacja osobno po każdej stronie dawałaby przy zakresie od -2 do
    // 10 tę samą siłę koloru dla -2 i dla +10, czyli czytelnik odczytywałby
    // spadek o dwa jako równie mocny co wzrost o dziesięć. Mianownikiem musi
    // być WIĘKSZE odchylenie i to pinuje ten test.
    const model = heatmapModel(["a"], ["u", "v", "w"], [[-2, 2, 10]]);
    expect(model.scale.type).toBe("diverging");
    expect(model.scale.spread).toBe(10);
    const [minus, plus, maks] = model.cells;
    expect(minus.signed).toBeCloseTo(-0.2, 12);
    expect(plus.signed).toBeCloseTo(0.2, 12);
    expect(Math.abs(minus.signed ?? 0)).toBeCloseTo(Math.abs(plus.signed ?? 0), 12);
    expect(maks.signed).toBe(1);
  });

  it("punkt neutralny siada DOKŁADNIE na środku rampy przy niesymetrycznych danych", () => {
    // To jest sens neutralnego środka: kolor środkowy znaczy "bez zmiany".
    // Gdyby środek jechał ze środka zakresu danych, na macierzy od -1 do +9
    // "bez zmiany" wypadłoby w kolorze wzrostu.
    const model = heatmapModel(["a"], ["u", "v", "w"], [[-1, 0, 9]]);
    const zerowa = model.cells[1];
    expect(zerowa.value).toBe(0);
    expect(zerowa.t).toBe(0.5);
  });

  it("przyjmuje punkt neutralny INNY niż zero", () => {
    // Sensowny punkt neutralny nie zawsze jest zerem: w macierzy wskaźnika
    // indeksowanego bazą 100 neutralnym jest scenariusz bazowy. Bez tej opcji
    // taka macierz dostawałaby rampę sekwencyjną i "poniżej bazy" byłoby
    // tylko ciemniejsze, a nie inne.
    const model = heatmapModel(["a"], ["u", "v", "w"], [[90, 100, 120]], { neutral: 100 });
    expect(model.scale.type).toBe("diverging");
    expect(model.scale.neutral).toBe(100);
    expect(model.cells[1].t).toBe(0.5);
    expect(model.cells[0].signed).toBeLessThan(0);
    expect(model.cells[2].signed).toBe(1);
  });

  it("ODMAWIA rampy rozbieżnej na danych bez punktu zerowego i mówi o tym", () => {
    // To jest defekt wprost z zadania: "skala rozbieżna bez punktu zerowego
    // to defekt". Milczące spełnienie żądania oddałoby połowę odcieni
    // wartościom, których nie ma, a milcząca degradacja zostawiłaby autora
    // z przekonaniem, że patrzy na rampę rozbieżną.
    const model = heatmapModel(
      ["a", "b"],
      ["x", "y"],
      [
        [1, 2],
        [3, 4],
      ],
      { scale: "diverging" },
    );
    expect(model.scale.requested).toBe("diverging");
    expect(model.scale.type).toBe("sequential");
    expect(model.divergingJustifiedOk).toBe(false);
    expect(heatmapFormAdvice(model)).toContain("divergingDowngraded");
  });

  it("traktuje zero na KRAŃCU zakresu jako brak punktu zerowego", () => {
    // Nierówność nieostra przepuszczałaby macierz o wartościach od 0 do 9
    // jako "rozbieżną wokół zera", a w takiej macierzy nie ma ani jednej
    // wartości ujemnej - połowa rampy zostałaby pusta.
    const model = heatmapModel(
      ["a", "b"],
      ["x", "y"],
      [
        [0, 3],
        [6, 9],
      ],
      { scale: "diverging" },
    );
    expect(model.scale.type).toBe("sequential");
    expect(model.divergingJustifiedOk).toBe(false);
  });

  it("MILCZY o skali rozbieżnej, gdy nikt jej nie chciał i model jej nie wybrał", () => {
    // Trzeci stan konwencji: brak pytania, więc brak odpowiedzi. `false`
    // byłoby tu ostrzeżeniem widocznym na każdej mapie wielkości, a
    // ostrzeżenie widoczne zawsze uczy ignorowania wszystkich ostrzeżeń.
    expect(macierz2x2().divergingJustifiedOk).toBeNull();
  });
});

describe("heatmapModel - luka nie jest zerem", () => {
  it("daje luce osobny stan i BRAK pozycji na rampie", () => {
    // Najważniejszy test w pliku. `t: 0` zamiast `null` oddałoby luce
    // najjaśniejszy stopień rampy, czyli kolor prawdziwej najmniejszej
    // wartości - i czytelnik przeczytałby "policzono, wyszło mało" tam, gdzie
    // nikt nic nie policzył.
    const model = heatmapModel(
      ["a", "b"],
      ["x", "y"],
      [
        [0, 5],
        [null, 10],
      ],
    );
    const luka = model.cells[2];
    expect(luka.state).toBe("gap");
    expect(luka.value).toBeNull();
    expect(luka.t).toBeNull();
    expect(luka.signed).toBeNull();
    expect(luka.text).toBe("-");
    expect(model.gaps).toBe(1);
    expect(model.filled).toBe(3);
  });

  it("odróżnia lukę od prawdziwego zera i sygnalizuje kolizję rampy", () => {
    // Gdy w danych JEST zero, jasny koniec rampy jest zajęty przez wartość,
    // więc render nie ma prawa użyć go na lukę. `zeroInData` jest po to, żeby
    // ta dyrektywa nie zależała od czujności renderu.
    const model = heatmapModel(
      ["a", "b"],
      ["x", "y"],
      [
        [0, 5],
        [null, 10],
      ],
    );
    expect(model.zeroInData).toBe(true);
    const zero = model.cells[0];
    expect(zero.state).toBe("value");
    expect(zero.value).toBe(0);
    expect(zero.t).not.toBeNull();
  });

  it("traktuje NaN i nieskończoność z bazy jako lukę, nie jako liczbę", () => {
    // Blok pochodzi z bazy i po deserializacji bywa nosicielem nieliczby.
    // Wpuszczona do zakresu zamieniłaby całą domenę w NaN, a stąd na stronę
    // wyszedłby napis "NaN" przez `Intl.NumberFormat`.
    const model = heatmapModel(
      ["a", "b"],
      ["x", "y"],
      [
        [Number.NaN, 5],
        [Number.POSITIVE_INFINITY, 10],
      ],
    );
    expect(model.filled).toBe(2);
    expect(model.cells[0].state).toBe("gap");
    expect(model.cells[2].state).toBe("gap");
    expect(model.scale.min).toBe(5);
    expect(model.scale.max).toBe(10);
    bezNieliczb(model);
  });
});

describe("heatmapModel - domena i wartości poza skalą", () => {
  it("zgłasza wartość poza PODANĄ domeną i przycina ją do rampy", () => {
    // "Wartość poza zakresem skali to defekt": po przycięciu dwie różne
    // liczby mają ten sam kolor. Model przycina, bo pozycja poza 0..1
    // wyszłaby renderowi kolorem poza rampą, ale przycięcie zgłasza.
    const model = heatmapModel(
      ["a", "b"],
      ["x", "y"],
      [
        [0, 5],
        [12, 10],
      ],
      { domain: { min: 0, max: 10 } },
    );
    expect(model.inDomainOk).toBe(false);
    const poza = model.cells[2];
    expect(poza.clamped).toBe(true);
    expect(poza.t).toBe(1);
    expect(poza.value).toBe(12);
    expect(model.scale.domainFromData).toBe(false);
  });

  it("MILCZY o domenie wyliczonej z danych", () => {
    // Domena z danych obejmuje je z definicji, więc sprawdzanie jej byłoby
    // sprawdzaniem własnej arytmetyki - ta sama pułapka, którą opisuje suma
    // udziałów w `pieModel`.
    const model = macierz2x2();
    expect(model.scale.domainFromData).toBe(true);
    expect(model.inDomainOk).toBeNull();
  });

  it("odrzuca domenę odwróconą albo zdegenerowaną i wraca do danych", () => {
    // Domena o zerowej albo ujemnej rozpiętości dałaby dzielenie przez zero
    // przy każdej komórce. Wejście przychodzi z konfiguracji, więc taki
    // kształt jest realny, a nie hipotetyczny.
    const model = heatmapModel(
      ["a", "b"],
      ["x", "y"],
      [
        [1, 2],
        [3, 4],
      ],
      { domain: { min: 7, max: 7 } },
    );
    expect(model.scale.domainFromData).toBe(true);
    expect(model.scale.min).toBe(1);
    expect(model.scale.max).toBe(4);
    bezNieliczb(model);
  });

  it("zakres legendy jest DOKŁADNIE domeną komórek", () => {
    // Legenda z innym zakresem niż komórki jest kłamstwem, którego nikt nie
    // zauważy: paskowi legendy nikt nie sprawdza podziałki wobec pola.
    const model = heatmapModel(
      ["a", "b"],
      ["x", "y"],
      [
        [2, 4],
        [6, 8],
      ],
    );
    expect(heatmapExtent(model)).toEqual({ min: 2, max: 8 });
  });
});

describe("heatmapModel - macierz musi być macierzą", () => {
  it("odrzuca jeden wiersz", () => {
    // Jeden wiersz to szereg, a szereg czyta się długością słupka, czyli
    // kanałem z górnej połowy hierarchii percepcyjnej. Mapa ciepła schodzi
    // wtedy na nasycenie bez żadnego zysku.
    const model = heatmapModel(["a"], ["x", "y", "z"], [[1, 2, 3]]);
    expect(model.matrixShapeOk).toBe(false);
    expect(heatmapFormAdvice(model)).toContain("notMatrix");
  });

  it("odrzuca jedną kolumnę", () => {
    // Symetrycznie: jedna kolumna to ten sam szereg obrócony.
    const model = heatmapModel(["a", "b", "c"], ["x"], [[1], [2], [3]]);
    expect(model.matrixShapeOk).toBe(false);
  });

  it("liczy wiersze i kolumny NIEPUSTE, nie zadeklarowane", () => {
    // Cztery serie, z których trzy są rzędami luk, dają na rysunku jedno
    // pasmo - czyli dokładnie ten defekt, który sprawdzenie ma łapać.
    // Liczenie po `rows` przepuszczałoby go, bo `rows` wynosi cztery.
    const model = heatmapModel(
      ["a", "b", "c", "d"],
      ["x", "y"],
      [
        [1, 2],
        [null, null],
        [null, null],
        [null, null],
      ],
    );
    expect(model.rows).toBe(4);
    expect(model.effectiveRows).toBe(1);
    expect(model.emptyRows).toBe(3);
    expect(model.matrixShapeOk).toBe(false);
  });

  it("przyjmuje macierz 2 na 2", () => {
    // Dolna granica, przy której dwa parametry naprawdę są dwoma parametrami.
    expect(macierz2x2().matrixShapeOk).toBe(true);
  });

  it("MILCZY, gdy nie ma ani jednej wartości", () => {
    // Kategorie z arkusza z jeszcze niewpisanymi liczbami to normalny stan
    // bloku w trakcie pisania, a nie defekt kształtu. Ostrzeżenie o kształcie
    // macierzy w tym momencie mówiłoby o czymś, czego autor jeszcze nie
    // zadeklarował.
    const model = heatmapModel(
      ["a", "b"],
      ["x", "y"],
      [
        [null, null],
        [null, null],
      ],
    );
    expect(model.matrixShapeOk).toBeNull();
    expect(model.spreadOk).toBeNull();
    expect(heatmapFormAdvice(model)).toEqual([]);
  });
});

describe("heatmapModel - osie i ich uczciwość", () => {
  it("wykrywa powtórzoną etykietę osi", () => {
    // Dwa wiersze o tej samej nazwie znaczą, że etykieta nie identyfikuje
    // już swojego pasma komórek: czytelnik nie wie, którą wartość parametru
    // czyta, a mapa ciepła nie ma innego nośnika tożsamości wiersza.
    const model = heatmapModel(
      ["10", "10"],
      ["x", "y"],
      [
        [1, 2],
        [3, 4],
      ],
    );
    expect(model.rowAxis.uniqueOk).toBe(false);
    expect(model.rowAxis.duplicates).toEqual(["10"]);
    expect(model.columnAxis.uniqueOk).toBe(true);
  });

  it("wykrywa etykietę bez treści", () => {
    // Kolumna bez nazwy nie ma przypisanej wartości parametru, więc komórki
    // w niej są bezadresowe. Osobno od duplikatu, bo to inne zdanie o danych.
    const model = heatmapModel(
      ["a", "b"],
      ["x", "  "],
      [
        [1, 2],
        [3, 4],
      ],
    );
    expect(model.columnAxis.namedOk).toBe(false);
    expect(model.rowAxis.namedOk).toBe(true);
  });

  it("wykrywa nieuporządkowaną oś LICZBOWĄ", () => {
    // Progi parametru w kolejności 10, 30, 20 dają na rysunku zygzak, choć
    // zależność jest monotoniczna: oko czyta z mapy ciepła KIERUNEK, więc oś
    // bez kierunku kłamie kształtem.
    const model = heatmapModel(
      ["a", "b"],
      ["10", "30", "20"],
      [
        [1, 2, 3],
        [4, 5, 6],
      ],
    );
    expect(model.columnAxis.numeric).toEqual([10, 30, 20]);
    expect(model.columnAxis.orderOk).toBe(false);
    expect(heatmapFormAdvice(model)).toContain("unorderedAxis");
  });

  it("przyjmuje oś malejącą i przecinek dziesiętny", () => {
    // Malejąca oś jest uporządkowana tak samo dobrze jak rosnąca, a zapis
    // z przecinkiem jest domyślny w polskim arkuszu - odrzucenie go dawałoby
    // ostrzeżenie o nieuporządkowanej osi na osi poprawnej.
    const model = heatmapModel(
      ["a", "b"],
      ["1,5", "1,0", "0,5"],
      [
        [1, 2, 3],
        [4, 5, 6],
      ],
    );
    expect(model.columnAxis.numeric).toEqual([1.5, 1, 0.5]);
    expect(model.columnAxis.orderOk).toBe(true);
  });

  it("MILCZY o porządku osi nazwanej słownie i osi dwuelementowej", () => {
    // Scenariusze ("bazowy", "szok") nie mają porządku z natury, a dwie
    // etykiety są monotoniczne zawsze - sprawdzenie na nich zaświadczałoby
    // o czymś, czego nie badało.
    const slowna = heatmapModel(
      ["a", "b"],
      ["bazowy", "szok", "recesja"],
      [
        [1, 2, 3],
        [4, 5, 6],
      ],
    );
    expect(slowna.columnAxis.numeric).toBeNull();
    expect(slowna.columnAxis.orderOk).toBeNull();
    expect(macierz2x2().columnAxis.orderOk).toBeNull();
  });
});

describe("heatmapModel - pozostałe sprawdzenia uczciwości", () => {
  it("wykrywa brak rozproszenia i nie stawia rampy na krańcu", () => {
    // Jednolite pole sugeruje pomiar, którego nie było. Środek rampy zamiast
    // krańca, bo najjaśniejszy stopień powiedziałby "wszędzie mało",
    // a najciemniejszy "wszędzie dużo" - obie wersje to zdanie o danych,
    // którego dane nie zawierają.
    const model = heatmapModel(
      ["a", "b"],
      ["x", "y"],
      [
        [7, 7],
        [7, 7],
      ],
    );
    expect(model.spreadOk).toBe(false);
    expect(model.cells.every((c) => c.t === 0.5)).toBe(true);
    expect(heatmapFormAdvice(model)).toContain("noSpread");
    bezNieliczb(model);
  });

  it("wykrywa liczby, które nie trafiły w siatkę", () => {
    // Wiersz dłuższy niż liczba kategorii znaczy, że blok pochodzi z innej
    // wersji edytora niż siatka etykiet - i te liczby nie są widoczne ani na
    // rysunku, ani w tabeli danych. Cichy brak jest gorszy od ostrzeżenia.
    const model = heatmapModel(
      ["a", "b"],
      ["x", "y"],
      [
        [1, 2, 99],
        [3, 4],
        [5, 6],
      ],
    );
    expect(model.valuesOutsideGrid).toBe(3);
    expect(model.inGridOk).toBe(false);
  });

  it("nie uznaje krótszego wiersza za defekt siatki", () => {
    // Brakujący ogon wiersza to luki, a luka jest legalnym stanem komórki.
    // Ostrzeganie tutaj mieszałoby "nie policzono" z "policzono i zgubiono".
    const model = heatmapModel(["a", "b"], ["x", "y", "z"], [[1, 2], [3]]);
    expect(model.inGridOk).toBe(true);
    expect(model.gaps).toBe(3);
  });

  it("porównuje zadeklarowane n z liczbą wypełnionych komórek", () => {
    // Sekcja 8 każe podać `n` w podpisie. Liczbą obserwacji mapy ciepła jest
    // liczba policzonych par parametrów, więc inne `n` w podpisie kłamie
    // o próbce, choćby rysunek był poprawny.
    const zgodne = heatmapModel(
      ["a", "b"],
      ["x", "y"],
      [
        [1, 2],
        [3, null],
      ],
      { declaredSampleSize: 3 },
    );
    expect(zgodne.declaredSampleOk).toBe(true);
    const niezgodne = heatmapModel(
      ["a", "b"],
      ["x", "y"],
      [
        [1, 2],
        [3, null],
      ],
      { declaredSampleSize: 4 },
    );
    expect(niezgodne.declaredSampleOk).toBe(false);
    expect(macierz2x2().declaredSampleOk).toBeNull();
  });

  it("ostrzega o siatce dziurawej i o siatce zbyt gęstej", () => {
    // Rzadkie wypełnienie zszywa gradient przez dziury i pokazuje kierunek,
    // którego nikt nie policzył; gęsta siatka schodzi komórką pod cel
    // dotykowy. Oba są wyborem formy, nie defektem arytmetycznym, więc jadą
    // przez doradzanie, a nie przez pola uczciwości.
    const dziurawa = heatmapModel(
      ["a", "b"],
      ["x", "y"],
      [
        [1, null],
        [null, null],
      ],
    );
    expect(heatmapFormAdvice(dziurawa)).toContain("sparse");

    const kolumny = Array.from({ length: 40 }, (_, i) => String(i));
    const wiersze = Array.from({ length: 20 }, (_, i) => `w${i}`);
    const gesta = heatmapModel(
      wiersze,
      kolumny,
      wiersze.map((_, r) => kolumny.map((_, c) => r + c)),
    );
    expect(gesta.cellCount).toBeGreaterThan(HEATMAP_MAX_CELLS);
    expect(heatmapFormAdvice(gesta)).toContain("tooManyCells");
    bezNieliczb(gesta);
  });
});

describe("heatmapModel - etykiety liczbowe w komórkach", () => {
  it("rezygnuje z liczb w komórkach powyżej progu gęstości", () => {
    // Liczba, która nie mieści się w komórce, zostaje ucięta albo nachodzi na
    // sąsiednią - a to łamie dwa z czterech wymagań bezwzględnych. Model
    // mówi renderowi wprost, kiedy przestać je stawiać.
    const male = heatmapModel(
      ["a", "b"],
      ["x", "y"],
      [
        [1, 2],
        [3, 4],
      ],
    );
    expect(male.valueLabelsFit).toBe(true);

    const kolumny = Array.from({ length: 13 }, (_, i) => String(i));
    const wiersze = Array.from({ length: 13 }, (_, i) => `w${i}`);
    const duze = heatmapModel(
      wiersze,
      kolumny,
      wiersze.map((_, r) => kolumny.map((_, c) => r * c)),
    );
    expect(duze.cellCount).toBeGreaterThan(HEATMAP_VALUE_LABEL_MAX_CELLS);
    expect(duze.valueLabelsFit).toBe(false);
  });

  it("oddaje ostatnie słowo POMIAROWI komórki, gdy render zna piksele", () => {
    // Próg z liczby komórek jest przybliżeniem dla modelu bez pikseli.
    // Na wąskim ekranie ta sama siatka ma komórkę o połowę węższą, więc
    // pomiar musi móc odebrać zgodę, której gęstość udzieliła.
    const model = macierz2x2();
    expect(heatmapValueLabelFit(model)).toBe(true);
    expect(
      heatmapValueLabelFit(model, {
        cellWidth: HEATMAP_LABEL_CELL_MIN_W,
        cellHeight: HEATMAP_LABEL_CELL_MIN_H,
      }),
    ).toBe(true);
    expect(
      heatmapValueLabelFit(model, {
        cellWidth: HEATMAP_LABEL_CELL_MIN_W - 1,
        cellHeight: HEATMAP_LABEL_CELL_MIN_H,
      }),
    ).toBe(false);
    expect(heatmapValueLabelFit(model, { cellWidth: Number.NaN, cellHeight: 100 })).toBe(false);
  });
});

describe("heatmapTable - alternatywa tekstowa", () => {
  it("oddaje wszystkie komórki wiersz po wierszu, z lukami jako lukami", () => {
    // Tabela i mapa muszą kłamać tak samo albo nie kłamać wcale: gdyby luka
    // w tabeli była zerem, dwie drogi do tej samej liczby dawałyby dwie
    // różne liczby.
    const model = heatmapModel(
      ["a", "b"],
      ["x", "y"],
      [
        [1, null],
        [3, 4],
      ],
    );
    const tabela = heatmapTable(model);
    expect(tabela.columnLabels).toEqual(["x", "y"]);
    expect(tabela.rows).toHaveLength(2);
    expect(tabela.rows[0].cells.map((c) => c.value)).toEqual([1, null]);
    expect(tabela.rows[0].cells[1].state).toBe("gap");
    expect(tabela.rows[0].cells[1].text).toBe("-");
    expect(tabela.gaps).toBe(1);
    expect(tabela.filled).toBe(3);
  });

  it("niesie BRZEGI obu osi, a nie tylko same komórki", () => {
    // Kolumna "Czego unikać" zabrania przy tym pytaniu "tabeli liczb", więc
    // tabela pod mapą nie może być tą samą tabelą, którą mapa zastąpiła.
    // Brzegi są tym, co mapa pokazuje gradientem, podane liczbą.
    const model = heatmapModel(
      ["a", "b"],
      ["x", "y"],
      [
        [1, 3],
        [5, 11],
      ],
    );
    const tabela = heatmapTable(model);
    expect(tabela.rows[0].margin).toMatchObject({ count: 2, min: 1, max: 3, mean: 2, range: 2 });
    expect(tabela.columnMargins[1]).toMatchObject({ count: 2, min: 3, max: 11, range: 8 });
  });

  it("rozstrzyga, KTÓRY parametr rusza wynikiem mocniej", () => {
    // To jest odpowiedź na pytanie analityczne z tabeli doboru formy podana
    // liczbą, a nie kierunkiem gradientu - bez niej mapa ciepła jest
    // ładniejszą tabelą, czyli dokładnie tym, czego miała uniknąć.
    const wiersze = heatmapTable(
      heatmapModel(
        ["a", "b"],
        ["x", "y"],
        [
          [1, 2],
          [9, 10],
        ],
      ),
    );
    expect(wiersze.rowMeanRange).toBe(8);
    expect(wiersze.columnMeanRange).toBe(1);
    expect(wiersze.dominantAxis).toBe("rows");

    const kolumny = heatmapTable(
      heatmapModel(
        ["a", "b"],
        ["x", "y"],
        [
          [1, 9],
          [2, 10],
        ],
      ),
    );
    expect(kolumny.dominantAxis).toBe("columns");
  });

  it("mówi REMIS, gdy różnica rozstępów jest w granicach zaokrąglenia", () => {
    // Zdanie "wynik jest wrażliwszy na X" postawione na różnicy poniżej
    // progu jest zdaniem o zaokrągleniu arkusza, nie o zależności.
    const model = heatmapModel(
      ["a", "b"],
      ["x", "y"],
      [
        [1, 2],
        [2, 3],
      ],
    );
    const tabela = heatmapTable(model);
    expect(tabela.rowMeanRange).toBe(1);
    expect(tabela.columnMeanRange).toBe(1);
    expect(tabela.dominantAxis).toBe("tie");
    expect(HEATMAP_DOMINANCE_TOLERANCE).toBeGreaterThan(0);
  });

  it("MILCZY o dominacji, gdy jedna oś ma mniej niż dwa niepuste pasma", () => {
    // Rozstęp z jednego pasma jest zerem, a zero podane jako "ten parametr
    // nic nie zmienia" byłoby wnioskiem z braku danych.
    const tabela = heatmapTable(heatmapModel(["a"], ["x", "y"], [[1, 5]]));
    expect(tabela.rowMeanRange).toBeNull();
    expect(tabela.dominantAxis).toBeNull();
  });

  it("używa wstrzykniętego formatowania wartości", () => {
    // Render wstrzykuje `formatChartValue` związane z językiem i jednostką;
    // gdyby model formatował sam, liczba w komórce i liczba w tabeli miałyby
    // inny separator dziesiętny niż resztą strony.
    const model = heatmapModel(
      ["a", "b"],
      ["x", "y"],
      [
        [1, 2],
        [3, 4],
      ],
      { formatValue: (v) => `${v} pp` },
    );
    expect(model.cells[0].text).toBe("1 pp");
    expect(heatmapTable(model).rows[0].cells[0].text).toBe("1 pp");
  });
});

describe("heatmapModelFromConfig - degradacja obecnego kształtu", () => {
  it("czyta serie jako wiersze, a kategorie jako kolumny", () => {
    // Obecny `ChartConfig` wyraża macierz bez żadnego rozszerzenia: `series
    // [i].values[j]` jest już siatką dwuwymiarową. Ten test pinuje, że model
    // buduje się z tego, co silnik MA, a nie z tego, co chciałby mieć.
    const model = heatmapModelFromConfig(
      config(
        [
          { name: "10", values: [1, 2, 3] },
          { name: "20", values: [4, 5, 6] },
        ],
        ["1", "2", "3"],
      ),
    );
    expect(model.rows).toBe(2);
    expect(model.columns).toBe(3);
    expect(model.rowAxis.labels).toEqual(["10", "20"]);
    expect(model.columnAxis.labels).toEqual(["1", "2", "3"]);
    expect(model.matrixShapeOk).toBe(true);
    bezNieliczb(model);
  });

  it("bierze odcień rampy ze slotu PIERWSZEJ serii", () => {
    // Gdyby każdy wiersz miał własny odcień, kolor kodowałby jednocześnie
    // wiersz i wartość, czyli dwie rzeczy jednym kanałem - a wartość
    // przegrywa taki spór zawsze, bo różnicy jasności w dwóch odcieniach nie
    // da się porównać.
    const model = heatmapModelFromConfig(
      config(
        [
          { name: "a", values: [1, 2], colorSlot: 5 },
          { name: "b", values: [3, 4], colorSlot: 2 },
        ],
        ["x", "y"],
      ),
    );
    expect(model.scale.slot).toBe(5);
  });

  it("przenosi zadeklarowane n z konfiguracji", () => {
    // `sampleSize` jest polem konfiguracji, więc sprawdzenie podpisu nie może
    // wymagać od renderu ręcznego podania go modelowi - render by o tym
    // zapomniał, a sprawdzenie milczałoby zamiast ostrzegać.
    const model = heatmapModelFromConfig({
      ...config([{ values: [1, 2] }, { values: [3, 4] }], ["x", "y"]),
      sampleSize: 99,
    });
    expect(model.declaredSampleOk).toBe(false);
  });
});

describe("dane z bazy - model nigdy nie rzuca i nigdy nie zwraca nieliczby", () => {
  it("pusta konfiguracja", () => {
    // Blok świeżo dodany w edytorze nie ma ani serii, ani kategorii, a jest
    // renderowany od pierwszej klatki.
    const model = heatmapModelFromConfig(defaultChartConfig());
    expect(model.cells).toEqual([]);
    expect(model.cellCount).toBe(0);
    expect(model.matrixShapeOk).toBeNull();
    expect(model.valueLabelsFit).toBe(false);
    expect(heatmapFormAdvice(model)).toEqual([]);
    bezNieliczb(model);
  });

  it("zero kolumn i zero wierszy - geometria nie dzieli przez zero", () => {
    // 1/0 daje Infinity, które wypłynęłoby wprost do atrybutu SVG i dało
    // pusty wykres bez żadnego komunikatu.
    const bezKolumn = heatmapModel(["a", "b"], [], [[], []]);
    expect(bezKolumn.cells).toEqual([]);
    bezNieliczb(bezKolumn);
    const bezWierszy = heatmapModel([], ["x", "y"], []);
    expect(bezWierszy.cells).toEqual([]);
    bezNieliczb(bezWierszy);
  });

  it("sama luka", () => {
    // Kategorie wklejone z arkusza przed wpisaniem liczb. Zakres nie istnieje,
    // więc każde dzielenie po drodze musi być osłonięte.
    const model = heatmapModel(
      ["a", "b"],
      ["x", "y"],
      [
        [null, null],
        [null, null],
      ],
    );
    expect(model.filled).toBe(0);
    expect(model.gaps).toBe(4);
    expect(model.cells.every((c) => c.t === null)).toBe(true);
    expect(model.inGridOk).toBeNull();
    expect(model.declaredSampleOk).toBeNull();
    bezNieliczb(model);
  });

  it("jedna kategoria i jedna seria", () => {
    // Jedna komórka to liczba w zdaniu, nie macierz - i model musi to
    // powiedzieć, a nie rysować pojedynczy prostokąt jako mapę ciepła.
    const model = heatmapModel(["a"], ["x"], [[5]]);
    expect(model.matrixShapeOk).toBe(false);
    expect(model.cells).toHaveLength(1);
    expect(model.cells[0].t).toBe(0.5);
    bezNieliczb(model);
  });

  it("wartości ujemne tam, gdzie ich nikt nie oczekiwał", () => {
    // Macierz kosztu albo udziału z wartością ujemną z cofniętej wersji
    // edytora: model nie ma prawa jej odrzucić (byłaby cichą utratą liczby),
    // ale rampa musi ją unieść bez nieliczby i bez pozycji poza 0..1.
    const model = heatmapModel(
      ["a", "b"],
      ["x", "y"],
      [
        [-100, -50],
        [-25, -1],
      ],
    );
    expect(model.scale.type).toBe("sequential");
    expect(model.cells.every((c) => c.t !== null && c.t >= 0 && c.t <= 1)).toBe(true);
    bezNieliczb(model);
  });

  it("wartości ekstremalne obok siebie", () => {
    // Rozpiętość rzędu 1e308 przy odejmowaniu jeszcze się mieści, ale każde
    // dzielenie po niej jest kandydatem na nieliczbę.
    const model = heatmapModel(
      ["a", "b"],
      ["x", "y"],
      [
        [-Number.MAX_VALUE / 2, 0],
        [Number.MAX_VALUE / 2, 1],
      ],
    );
    expect(model.cells.every((c) => c.t === null || (c.t >= 0 && c.t <= 1))).toBe(true);
    bezNieliczb(model);
  });

  it("nieliczbowe żądania z opcji", () => {
    // Punkt neutralny i zadeklarowane n przychodzą z konfiguracji bloku,
    // więc bywają nieliczbą po deserializacji.
    const model = heatmapModel(
      ["a", "b"],
      ["x", "y"],
      [
        [-1, 2],
        [3, 4],
      ],
      {
        neutral: Number.NaN,
        declaredSampleSize: Number.NaN,
        colorSlot: Number.NaN,
      },
    );
    expect(model.scale.neutral).toBe(0);
    expect(model.declaredSampleOk).toBeNull();
    bezNieliczb(model);
  });

  it("model pozostaje spójny przy każdej wielkości siatki", () => {
    // Zamiatanie rozmiarów, bo defekty osłon mianownika wychodzą na
    // pojedynczych przypadkach brzegowych, a nie na typowej macierzy.
    for (let rows = 0; rows <= 4; rows++) {
      for (let columns = 0; columns <= 4; columns++) {
        const wiersze = Array.from({ length: rows }, (_, r) => `w${r}`);
        const kolumny = Array.from({ length: columns }, (_, c) => `k${c}`);
        const values = wiersze.map((_, r) =>
          kolumny.map((_, c) => ((r + c) % 3 === 0 ? null : r - c)),
        );
        const model = heatmapModel(wiersze, kolumny, values);
        expect(model.cells).toHaveLength(rows * columns);
        expect(model.filled + model.gaps).toBe(rows * columns);
        bezNieliczb(model);
      }
    }
  });
});
