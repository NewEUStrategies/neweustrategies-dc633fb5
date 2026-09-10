// Model punktowego. Najważniejsze asercje w tym pliku są cztery i wszystkie
// dotyczą uczciwości, a nie wyglądu: linia trendu ZAWSZE przychodzi z R2 i n
// (albo nie przychodzi wcale), odcinek trendu KOŃCZY SIĘ NA OBSERWACJI (nigdy
// na krawędzi rysunku), para z brakującą współrzędną jest POLICZONA, a model
// nie wypuszcza NaN ani Infinity - bo `Intl.NumberFormat.format(NaN)` zwraca
// literalny napis "NaN", którego bramka `blockMatrix` szuka w `textContent`
// strony.
//
// Testy pinują ZACHOWANIE modelu, nie jego implementację: sprawdzają liczby,
// które czytelnik odczyta z rysunku i z tabeli, oraz decyzje, które model
// podejmuje w imieniu autora (kiedy milczy, kiedy zgłasza defekt), a nie
// kolejność kroków, która do nich doprowadziła.
import { describe, expect, it } from "vitest";
import type { ChartSeries } from "@/lib/charts/types";
import {
  REGRESSION_METHOD,
  SCATTER_HIT_R,
  SCATTER_MARKER_R,
  SCATTER_OVERPLOT_SHARE,
  SCATTER_R2_MEANINGLESS,
  SCATTER_TREND_MIN_N,
  leastSquaresTrend,
  scatterExtent,
  scatterFormAdvice,
  scatterModel,
  scatterModelFromConfig,
  scatterTable,
  scatterTrendAt,
  type ScatterInput,
  type ScatterModel,
} from "@/lib/charts/kinds/scatter";
import { defaultChartConfig } from "@/lib/charts/parse";

function seria(name: string, values: (number | null)[], colorSlot = 1): ChartSeries {
  return { name, values, colorSlot };
}

/** Wejście z liczbowymi etykietami wierszy, czyli z ciągłą osią X w kategoriach. */
function zKategorii(xs: (number | string)[], ys: (number | null)[]): ScatterInput {
  return {
    categories: xs.map((x) => String(x)),
    series: [seria("Y", ys)],
  };
}

/**
 * Rekursywny obchód całego modelu w poszukiwaniu liczby, która nie jest
 * liczbą. Osobna funkcja, a nie asercja na wybranych polach, bo pól jest
 * kilkadziesiąt i pole dopisane w przyszłości ma być objęte tą bramką bez
 * dopisywania testu - inaczej pierwszy nowy licznik wyjedzie na stronę jako
 * napis "NaN".
 */
function nieliczby(wartosc: unknown, sciezka = "model"): string[] {
  if (typeof wartosc === "number") {
    return Number.isFinite(wartosc) ? [] : [`${sciezka} = ${String(wartosc)}`];
  }
  if (Array.isArray(wartosc)) {
    return wartosc.flatMap((el, i) => nieliczby(el, `${sciezka}[${i}]`));
  }
  if (wartosc !== null && typeof wartosc === "object") {
    return Object.entries(wartosc).flatMap(([k, v]) => nieliczby(v, `${sciezka}.${k}`));
  }
  return [];
}

/** Model plus jego alternatywa tekstowa - obchód NaN musi objąć oba. */
function calosc(model: ScatterModel): { model: ScatterModel; table: unknown } {
  return { model, table: scatterTable(model) };
}

describe("scatter - skąd bierze się ciągła oś X", () => {
  it("liczbowe etykiety wierszy SĄ zmienną X, nie nazwami kategorii", () => {
    // Bez tego oś X byłaby indeksem wiersza, więc dane [1, 2, 10] rysowałyby
    // się w równych odstępach i wykres pokazywałby zależność liniową tam,
    // gdzie w danych jest przerwa. To jest cała nowość tego rodzaju wobec
    // reszty silnika: pozycja pozioma wynika z LICZBY, nie z indeksu.
    const m = scatterModel(zKategorii([1, 2, 10], [3, 4, 20]));
    expect(m.xSource).toBe("categories");
    expect(m.points.map((p) => p.x)).toEqual([1, 2, 10]);
    expect(m.domain.x).toEqual({ min: 1, max: 10 });
    expect(m.honesty.xIsSecondVariableOk).toBe(true);
  });

  it("etykieta nieliczbowa dyskwalifikuje CAŁĄ kolumnę, nie tylko siebie", () => {
    // Ciche pominięcie wiersza "Razem" zabrałoby jeden punkt, a pozostałe
    // zostawiłoby na miejscach - czyli nic nie wyglądałoby na błąd, a chmura
    // miałaby o jedną obserwację mniej, niż mówi arkusz. Model woli zmienić
    // tryb (tu: na numer wiersza) i to zgłosić.
    const m = scatterModel(zKategorii([1, 2, "Razem"], [3, 4, 7]));
    expect(m.xSource).toBe("index");
    expect(m.honesty.xIsSecondVariableOk).toBe(false);
  });

  it("dwie kolumny liczb bez liczbowych etykiet: pierwsza seria jest osią X", () => {
    // Naturalny arkusz punktowego w formacie widgetu: "Polska; 12,5; 3,4".
    // Bez tej degradacji model nie zbudowałby się z obecnego kształtu
    // konfiguracji, bo `ChartConfig` nie ma pola na drugą zmienną.
    const m = scatterModel({
      categories: ["Polska", "Niemcy", "Czechy"],
      series: [seria("PKB", [10, 20, 30], 1), seria("Inflacja", [2, 3, 5], 2)],
    });
    expect(m.xSource).toBe("series");
    expect(m.xName).toBe("PKB");
    expect(m.clouds).toHaveLength(1);
    expect(m.clouds[0].name).toBe("Inflacja");
    expect(m.clouds[0].colorSlot).toBe(2);
    expect(m.points.map((p) => [p.x, p.y])).toEqual([
      [10, 2],
      [20, 3],
      [30, 5],
    ]);
  });

  it("osią X jest seria PIERWSZA POZYCYJNIE, także gdy jest jeszcze pusta", () => {
    // Gdyby model przeskakiwał serie bez danych (tak jak robi to histogram
    // przy wyborze rozkładu), oś X po dopisaniu kolumny w edytorze
    // zmieniałaby się z "PKB" na "Inflacja" bez śladu w konfiguracji -
    // i wykres pokazywałby zależność innej pary kolumn, niż mówi podpis.
    const m = scatterModel({
      categories: ["A", "B"],
      series: [seria("Pusta", [null, null], 1), seria("Y", [4, 6], 2)],
    });
    expect(m.xSource).toBe("series");
    expect(m.xName).toBe("Pusta");
    expect(m.n).toBe(0);
    expect(m.honesty.droppedPairs).toBe(2);
  });

  it("jedna seria i nieliczbowe etykiety: X degraduje do numeru wiersza I MÓWI O TYM", () => {
    // Model musi się zbudować z każdego kształtu, jaki może przyjść z bazy,
    // ale nie wolno mu udawać, że pokazuje zależność dwóch zmiennych, kiedy
    // drugiej zmiennej w danych nie ma. Numeracja od jedynki, bo to etykieta
    // wiersza arkusza, a nie indeks tablicy.
    const m = scatterModel({ categories: ["a", "b", "c"], series: [seria("Y", [5, 6, 7])] });
    expect(m.xSource).toBe("index");
    expect(m.points.map((p) => p.x)).toEqual([1, 2, 3]);
    expect(m.honesty.xIsSecondVariableOk).toBe(false);
    expect(scatterFormAdvice(m)).toContain("syntheticX");
  });

  it("jawna tablica X (proponowane rozszerzenie konfiguracji) ma pierwszeństwo", () => {
    // Droga docelowa: gdy silnik dostanie pole `xValues`, model nie zgaduje
    // niczego. Test pinuje pierwszeństwo, bo bez niego liczbowe etykiety
    // przykrywałyby jawnie podaną oś.
    const m = scatterModel(zKategorii([1, 2, 3], [10, 20, 30]), {
      xValues: [100, 200, 300],
      xName: "Wydatki",
    });
    expect(m.xSource).toBe("explicit");
    expect(m.xName).toBe("Wydatki");
    expect(m.points.map((p) => p.x)).toEqual([100, 200, 300]);
  });

  it("jedna liczbowa etykieta to za mało na oś ciągłą", () => {
    // "2024" jako jedyna etykieta jest nieodróżnialne od nazwy kategorii,
    // która przypadkiem jest liczbą, a z jednej pozycji nie da się zmierzyć
    // odstępu - czyli nie da się zrobić osi ciągłej.
    const m = scatterModel(zKategorii(["2024"], [5]));
    expect(m.xSource).toBe("index");
  });
});

describe("scatter - linia trendu jako twierdzenie z dowodem", () => {
  it("regresja najmniejszych kwadratów na zależności dokładnej", () => {
    // Pin na całą arytmetykę naraz. Gdyby ktoś odwrócił rolę zmiennych
    // (regresja x po y), na tych danych nachylenie wyszłoby 0,5 zamiast 2 -
    // i to jest błąd cichy, bo obie proste wyglądają jak trend.
    const t = scatterModel(zKategorii([1, 2, 3], [2, 4, 6])).clouds[0].trend;
    expect(t).not.toBeNull();
    expect(t?.slope).toBeCloseTo(2, 10);
    expect(t?.intercept).toBeCloseTo(0, 10);
    expect(t?.r2).toBeCloseTo(1, 10);
    expect(t?.r).toBeCloseTo(1, 10);
    expect(t?.n).toBe(3);
  });

  it("R2 i n są POLAMI trendu, nie ozdobą podpisu", () => {
    // To jest wymaganie wprost z zadania: linia trendu bez R2 i bez n jest
    // twierdzeniem bez dowodu. Test pilnuje, że nie da się dostać nachylenia
    // bez obu tych liczb - w modelu i w tabeli danych.
    const m = scatterModel(zKategorii([1, 2, 3, 4], [1, 2, 2, 4]));
    const t = m.clouds[0].trend;
    expect(t?.r2).not.toBeUndefined();
    expect(t?.n).toBe(4);
    const wiersz = scatterTable(m).trends[0];
    expect(wiersz.slope).not.toBeNull();
    expect(wiersz.r2).not.toBeNull();
    expect(wiersz.n).toBe(4);
  });

  it("R2 zgadza się z ręcznym rachunkiem na chmurze niedokładnej", () => {
    // Dane: (1,1), (2,2), (3,2). Sxx = 2, Sxy = 1, Syy = 2/3, więc nachylenie
    // 0,5 i R2 = 0,75. Bez tego testu wolno byłoby policzyć R2 jako samą
    // korelację (0,866) i wykres podawałby w podpisie dopasowanie lepsze,
    // niż jest.
    const t = scatterModel(zKategorii([1, 2, 3], [1, 2, 2])).clouds[0].trend;
    expect(t?.slope).toBeCloseTo(0.5, 10);
    expect(t?.intercept).toBeCloseTo(2 / 3, 10);
    expect(t?.r2).toBeCloseTo(0.75, 10);
    expect(t?.meaningful).toBe(true);
  });

  it("znak korelacji zgadza się ze znakiem nachylenia", () => {
    // R2 gubi kierunek: chmura opadająca i rosnąca mogą mieć to samo R2,
    // a czytelnik podpisu "R2 = 0,90" nie wie, w którą stronę. Rozjazd znaków
    // między `r` i `slope` znaczyłby, że jedno z nich jest policzone błędnie.
    const t = scatterModel(zKategorii([1, 2, 3, 4], [9, 7, 5, 2])).clouds[0].trend;
    expect(t?.slope).toBeLessThan(0);
    expect(t?.r).toBeLessThan(0);
    expect(t?.r2).toBeGreaterThan(0.9);
  });

  it("dwie pary NIE dają trendu, choć prosta przez nie przechodzi idealnie", () => {
    // Najważniejszy pojedynczy test w tym pliku. Przez dwa punkty prosta
    // przechodzi zawsze i R2 wychodzi równo 1 z arytmetyki, nie z siły
    // zależności - podpis "R2 = 1,00" przy n = 2 byłby najlepiej wyglądającym
    // kłamstwem, jakie ten wykres potrafi wyprodukować.
    const m = scatterModel(zKategorii([1, 2], [5, 7]));
    expect(m.clouds[0].n).toBe(2);
    expect(m.clouds[0].trend).toBeNull();
    expect(m.honesty.enoughForTrendOk).toBe(false);
    expect(SCATTER_TREND_MIN_N).toBe(3);
    expect(scatterFormAdvice(m)).toContain("tooFewPoints");
  });

  it("zerowa wariancja X: regresji NIE MA, więc model milczy zamiast zgadywać", () => {
    // Mianownik nachylenia (Sxx) jest wtedy zerem. Bez osłony wychodziłoby
    // Infinity albo NaN, a podstawienie zera twierdziłoby, że y nie zależy
    // od x - czego dane o kolumnie punktów nie mówią.
    const m = scatterModel(zKategorii([5, 5, 5, 5], [1, 2, 3, 4]));
    expect(m.clouds[0].trend).toBeNull();
    expect(m.honesty.xVarianceOk).toBe(false);
    expect(m.honesty.trendMeaningfulOk).toBeNull();
    expect(nieliczby(calosc(m))).toEqual([]);
    expect(scatterFormAdvice(m)).toContain("noXVariance");
  });

  it("zerowa wariancja Y: nachylenie jest, R2 NIE ISTNIEJE", () => {
    // Chmura płaska jak stół. Iloraz R2 jest wtedy 0/0, a podstawienie
    // jedynki dałoby w podpisie "R2 = 1,00" przy zależności, której nie ma.
    // Konwencja repo: `null` znaczy nie ma czego pokazać.
    const t = scatterModel(zKategorii([1, 2, 3], [7, 7, 7])).clouds[0].trend;
    expect(t?.slope).toBe(0);
    expect(t?.r2).toBeNull();
    expect(t?.r).toBeNull();
    expect(t?.meaningful).toBeNull();
  });

  it("R2 przy zerze podnosi flagę, mimo że linia wygląda jak wniosek", () => {
    // Dane symetryczne: Sxy = 0, więc prosta jest pozioma i R2 = 0. Model
    // MUSI to zgłosić, bo linia na wykresie zawsze czyta się jako wniosek,
    // a ta nie wyjaśnia ani jednej setnej zmienności.
    const m = scatterModel(zKategorii([1, 2, 3, 4], [1, 3, 3, 1]));
    const t = m.clouds[0].trend;
    expect(t?.r2).toBeCloseTo(0, 10);
    expect(t?.meaningful).toBe(false);
    expect(m.honesty.trendMeaningfulOk).toBe(false);
    expect(SCATTER_R2_MEANINGLESS).toBeGreaterThan(0);
    expect(scatterFormAdvice(m)).toContain("trendShowsNothing");
  });

  it("nachylenie jest dokładne także dla X daleko od zera", () => {
    // Wzór jednoprzebiegowy (n*Sxy - Sx*Sy) odejmuje tu dwie prawie równe,
    // duże liczby i traci precyzję nachylenia; przy wartościach rzędu 1e200
    // sumy kwadratów wychodzą z podwójnej precyzji i nachylenie robi się NaN.
    // Ten test pinuje wynik, nie metodę - ale bez dwuprzebiegowej metody nie
    // przechodzi.
    const t = leastSquaresTrend(
      [1_000_000, 1_000_001, 1_000_002].map((x, i) => ({
        index: i,
        x,
        y: 1 + 2 * i,
        label: "",
        seriesIndex: 0,
        colorSlot: 1,
        overplotted: false,
      })),
    );
    expect(t?.slope).toBeCloseTo(2, 6);
    expect(t?.r2).toBeCloseTo(1, 6);
  });
});

describe("scatter - zakaz ekstrapolacji", () => {
  it("odcinek trendu kończy się na OBSERWACJI, nie na krawędzi rysunku", () => {
    // Prosta przedłużona do brzegu obszaru kreślenia twierdzi o obszarze,
    // w którym nie ma ani jednego pomiaru, a wygląda identycznie jak część
    // opisująca dane. Końce muszą być dokładnie skrajnymi obserwacjami.
    const m = scatterModel(zKategorii([2, 4, 6], [1, 3, 5]));
    const t = m.clouds[0].trend;
    expect(t?.from.x).toBe(2);
    expect(t?.to.x).toBe(6);
    expect(t?.from.y).toBeCloseTo(1, 10);
    expect(t?.to.y).toBeCloseTo(5, 10);
    expect(m.honesty.trendWithinDataOk).toBe(true);
  });

  it("wartość trendu POZA zakresem obserwacji jest odmawiana, nie liczona", () => {
    // Odmowa jest funkcją, a nie komentarzem, bo ekstrapolacja powstaje przez
    // wygodę: render potrzebuje y na krawędzi rysunku, wzór prostej chętnie je
    // podaje i nikt nie zauważy, że dane kończą się w dwóch trzecich osi.
    const t = scatterModel(zKategorii([2, 4, 6], [1, 3, 5])).clouds[0].trend;
    expect(scatterTrendAt(t, 3)).toBeCloseTo(2, 10);
    expect(scatterTrendAt(t, 2)).toBeCloseTo(1, 10);
    expect(scatterTrendAt(t, 6)).toBeCloseTo(5, 10);
    expect(scatterTrendAt(t, 6.0001)).toBeNull();
    expect(scatterTrendAt(t, 100)).toBeNull();
    expect(scatterTrendAt(t, -100)).toBeNull();
    expect(scatterTrendAt(null, 3)).toBeNull();
    expect(scatterTrendAt(t, Number.NaN)).toBeNull();
  });
});

describe("scatter - pary niekompletne", () => {
  it("para z brakującą współrzędną wypada z regresji i jest POLICZONA", () => {
    // Wymaganie wprost z zadania. Bez licznika chmura miałaby n = 3 przy
    // pięciu wierszach w arkuszu, a podpis mówiłby o pięciu obserwacjach -
    // czyli wykres i podpis opisywałyby dwa różne zbiory.
    const m = scatterModel({
      categories: ["1", "2", "3", "", "5"],
      series: [seria("Y", [1, 2, null, 9, 5])],
    });
    expect(m.n).toBe(3);
    expect(m.clouds[0].dropped.missingY).toBe(1);
    expect(m.clouds[0].dropped.missingX).toBe(1);
    expect(m.honesty.droppedPairs).toBe(2);
    expect(m.honesty.pairsCompleteOk).toBe(false);
    expect(m.clouds[0].trend?.n).toBe(3);
  });

  it("wiersz bez OBU współrzędnych to brak obserwacji, nie odrzucenie", () => {
    // Zlanie tych dwóch zdarzeń kazałoby renderowi pisać "odrzucono 4 pary"
    // o arkuszu, w którym autor dopiero wpisuje dane i nikt nic nie odrzucił.
    const m = scatterModel({
      categories: ["1", "2", "", ""],
      series: [seria("Y", [1, 2, null, null])],
    });
    expect(m.clouds[0].dropped.emptyRows).toBe(2);
    expect(m.honesty.droppedPairs).toBe(0);
    expect(m.honesty.pairsCompleteOk).toBe(true);
  });

  it("NaN i Infinity w wartościach są luką, nie liczbą", () => {
    // Konfiguracja przychodzi z bazy: `Infinity` po dzieleniu w arkuszu
    // autora albo `NaN` z pustej komórki przemnożonej przez liczbę. Punkt
    // o współrzędnej nieskończonej nie ma gdzie stanąć, a NaN wychodzi
    // z `Intl` na stronę jako napis.
    const m = scatterModel({
      categories: ["1", "2", "3"],
      series: [seria("Y", [1, Number.NaN, Number.POSITIVE_INFINITY])],
    });
    expect(m.n).toBe(1);
    expect(m.honesty.droppedPairs).toBe(2);
    expect(nieliczby(calosc(m))).toEqual([]);
  });
});

describe("scatter - zasłanianie punktów", () => {
  it("policzone, nie zamiatane drganiem", () => {
    // Punktów nie wolno rozsuwać (jitter), bo obie współrzędne są danymi -
    // przesunięcie punktu o pół markera jest przesunięciem pomiaru. Zamiast
    // tego model mówi, ile plamek czytelnik ZOBACZY, a ile było obserwacji.
    const m = scatterModel(
      { categories: ["a", "b", "c", "d"], series: [seria("Y", [5, 5, 5, 9])] },
      { xValues: [1, 1, 1, 2] },
    );
    expect(m.n).toBe(4);
    expect(m.honesty.distinctPositions).toBe(2);
    expect(m.honesty.overplottedShare).toBeCloseTo(0.5, 10);
    expect(m.honesty.overplotOk).toBe(false);
    expect(m.points.map((p) => p.overplotted)).toEqual([true, true, true, false]);
    expect(m.honesty.overplottedShare).toBeGreaterThan(SCATTER_OVERPLOT_SHARE);
    expect(scatterFormAdvice(m)).toContain("overplotted");
    // Współrzędne zostają nietknięte - to jest właściwa reakcja na zasłanianie.
    expect(m.points.map((p) => p.x)).toEqual([1, 1, 1, 2]);
  });

  it("punkty bliższe niż tolerancja są jedną plamką, nawet gdy nie są równe", () => {
    // Tolerancja jest WZGLĘDNA (część rozpiętości domeny), bo model nie zna
    // szerokości rysunku. Przy rozpiętości 100 pół procenta to 0,5, więc
    // 100 i 100,1 to jedna plamka - i tak też wygląda na ekranie.
    const m = scatterModel(
      { categories: ["a", "b", "c"], series: [seria("Y", [0, 50, 50])] },
      { xValues: [0, 100, 100.1] },
    );
    expect(m.honesty.distinctPositions).toBe(2);
  });

  it("chmura bez powtórzeń nie zgłasza zasłaniania", () => {
    // Ostrzeżenie, które widać zawsze, uczy ignorowania wszystkich ostrzeżeń.
    const m = scatterModel(zKategorii([1, 2, 3, 4], [1, 5, 2, 9]));
    expect(m.honesty.overplottedShare).toBe(0);
    expect(m.honesty.overplotOk).toBe(true);
    expect(scatterFormAdvice(m)).not.toContain("overplotted");
  });
});

describe("scatter - domena, osie i zakaz łączenia punktów", () => {
  it("punktów NIE WOLNO łączyć i model mówi to wprost", () => {
    // Jedyny zakaz z kolumny "Czego unikać" dla tego rodzaju. Pole jest
    // maszynowo czytelne, żeby render, który zechce łączyć punkty, musiał
    // wprost zignorować oświadczenie modelu, a nie tylko nie doczytać
    // nagłówka pliku.
    expect(scatterModel(zKategorii([1, 2, 3], [1, 2, 3])).mayConnectPoints).toBe(false);
  });

  it("punkty zostają w kolejności WIERSZY, model ich nie sortuje", () => {
    // Sortowanie po x zmieniłoby kolejność rysowania i - co ważniejsze -
    // odebrało modelowi możliwość powiedzenia, że autor wpisał uporządkowany
    // szereg (advice `lineBetter`). Kolejność wierszy jest informacją.
    const m = scatterModel(zKategorii([9, 1, 5], [1, 2, 3]));
    expect(m.points.map((p) => p.x)).toEqual([9, 1, 5]);
    expect(m.domain.x).toEqual({ min: 1, max: 9 });
  });

  it("żadna oś nie musi obejmować zera, ale ucięcie jest OZNACZONE", () => {
    // Sekcja 8: dla wykresu kodującego POŁOŻENIEM zero nie jest wymagane,
    // ucięcie trzeba nazwać. Punktowy koduje położeniem obie zmienne, więc
    // model raportuje to osobno dla każdej osi.
    const m = scatterModel(zKategorii([100, 200, 300], [-5, -3, -1]));
    expect(m.domain.y).toEqual({ min: -5, max: -1 });
    expect(m.honesty.zeroInDomain).toEqual({ x: false, y: false });
    const zZerem = scatterModel(zKategorii([0, 1, 2], [-1, 0, 1]));
    expect(zZerem.honesty.zeroInDomain).toEqual({ x: true, y: true });
  });

  it("każdy punkt mieści się w zwróconej domenie", () => {
    // Samosprawdzenie, które dziś wychodzi prawdziwe zawsze - i o to chodzi.
    // Gdyby ktoś kiedyś policzył domenę z surowych kolumn (razem z parami
    // odrzuconymi) albo z pierwszej serii, pole zapali się, zanim czytelnik
    // zobaczy punkt przycięty krawędzią rysunku.
    const m = scatterModel({
      categories: ["1", "2", "3"],
      series: [seria("A", [5, null, 7], 1), seria("B", [1, 2, 3], 2)],
    });
    expect(m.honesty.pointsInDomainOk).toBe(true);
    expect(scatterExtent(m)).toEqual(m.domain);
  });

  it("jedna para: domena zwija się do punktu, a nie do NaN", () => {
    // Rozsunięcie tej domeny należy do `niceScale` w `scale.ts` (min === max
    // rozsuwa symetrycznie), więc model oddaje ją bez udawania rozpiętości,
    // której nie ma. Ważne jest tylko to, żeby nie było tu dzielenia przez
    // zero ani nieskończoności.
    const m = scatterModel(zKategorii([4, 4], [8, null]));
    expect(m.n).toBe(1);
    expect(m.domain).toEqual({ x: { min: 4, max: 4 }, y: { min: 8, max: 8 } });
    expect(nieliczby(calosc(m))).toEqual([]);
  });
});

describe("scatter - odporność na dane z bazy", () => {
  const przypadki: { nazwa: string; input: ScatterInput }[] = [
    { nazwa: "zero serii", input: { categories: [], series: [] } },
    { nazwa: "seria bez wartości", input: { categories: [], series: [seria("A", [])] } },
    {
      nazwa: "sama luka",
      input: { categories: ["a", "b"], series: [seria("A", [null, null])] },
    },
    { nazwa: "jedna kategoria", input: { categories: ["1"], series: [seria("A", [2])] } },
    {
      nazwa: "wartości ujemne",
      input: { categories: ["-3", "-2", "-1"], series: [seria("A", [-9, -4, -1])] },
    },
    {
      nazwa: "wszystkie X równe",
      input: { categories: ["7", "7", "7"], series: [seria("A", [1, 2, 3])] },
    },
    {
      nazwa: "wszystkie Y równe",
      input: { categories: ["1", "2", "3"], series: [seria("A", [4, 4, 4])] },
    },
    {
      nazwa: "liczby na granicy podwójnej precyzji",
      input: {
        categories: ["-1e308", "0", "1e308"],
        series: [seria("A", [-1e308, 0, 1e308])],
      },
    },
    {
      nazwa: "seria krótsza niż kategorie",
      input: { categories: ["1", "2", "3", "4"], series: [seria("A", [1, 2])] },
    },
    {
      nazwa: "seria dłuższa niż kategorie",
      input: { categories: ["1"], series: [seria("A", [1, 2, 3])] },
    },
    {
      nazwa: "colorSlot spoza zakresu i nieliczbowy",
      input: {
        categories: ["1", "2", "3"],
        series: [seria("A", [1, 2, 3], Number.NaN), seria("B", [3, 2, 1], 99)],
      },
    },
    {
      nazwa: "osiem serii z lukami",
      input: {
        categories: ["1", "2", "3"],
        series: Array.from({ length: 8 }, (_, i) => seria(`S${i}`, [i, null, i * 2], i + 1)),
      },
    },
  ];

  for (const { nazwa, input } of przypadki) {
    it(`nie rzuca, nie zwraca NaN ani Infinity: ${nazwa}`, () => {
      // Bramka `src/components/blocks/__tests__/blockMatrix.test.tsx` sprawdza
      // `textContent` bloków na obecność napisów "NaN" i "undefined",
      // a `Intl.NumberFormat.format(NaN)` zwraca literalny napis "NaN" -
      // jedno niedomknięte dzielenie w modelu wychodzi więc na stronę jako
      // słowo. Obchodzimy CAŁY model i całą tabelę, a nie wybrane pola.
      const m = scatterModel(input);
      expect(nieliczby(calosc(m))).toEqual([]);
      expect(() => scatterFormAdvice(m)).not.toThrow();
      expect(() => scatterTable(m)).not.toThrow();
    });
  }

  it("brak serii: model milczy o wszystkim, o czym nie ma czego powiedzieć", () => {
    // Konwencja repo: `null` znaczy NIE MA CZEGO SPRAWDZAĆ. Model, który przy
    // pustych danych zwraca `true`, zaświadcza o uczciwości wykresu, którego
    // nie ma - a rama wykresu wypisuje to zaświadczenie pod rysunkiem.
    const m = scatterModel({ categories: [], series: [] });
    expect(m.xSource).toBe("none");
    expect(m.n).toBe(0);
    expect(m.honesty.pairsCompleteOk).toBeNull();
    expect(m.honesty.enoughForTrendOk).toBeNull();
    expect(m.honesty.xVarianceOk).toBeNull();
    expect(m.honesty.trendMeaningfulOk).toBeNull();
    expect(m.honesty.trendWithinDataOk).toBeNull();
    expect(m.honesty.pointsInDomainOk).toBeNull();
    expect(m.honesty.xIsSecondVariableOk).toBeNull();
    expect(m.honesty.overplotOk).toBeNull();
    expect(m.honesty.declaredSampleSizeOk).toBeNull();
    expect(m.domain).toEqual({ x: { min: 0, max: 1 }, y: { min: 0, max: 1 } });
    expect(scatterFormAdvice(m)).toEqual([]);
  });

  it("kolumna X krótsza od serii Y nie produkuje punktów z niczego", () => {
    // Kolumny z bazy mogą być nierówne (wiersz dopisany w jednej serii,
    // w drugiej nie). Brak elementu tablicy jest brakiem współrzędnej,
    // a nie zerem - zero wpadłoby na oś jako pomiar, którego nie było.
    const m = scatterModel(
      { categories: ["a", "b", "c"], series: [seria("Y", [1, 2, 3])] },
      { xValues: [10] },
    );
    expect(m.n).toBe(1);
    expect(m.points[0]).toMatchObject({ x: 10, y: 1 });
    expect(m.honesty.droppedPairs).toBe(2);
  });
});

describe("scatter - budowa z obecnego kształtu konfiguracji", () => {
  it("model buduje się z ChartConfig bez żadnego rozszerzenia schematu", () => {
    // Wymaganie zadania: model musi umieć zbudować się także z obecnego
    // kształtu, chociażby degradując do sensownego przypadku. Bez tego
    // testu rodzaj byłby zależny od pola `xValues`, którego w bazie jeszcze
    // nie ma, i blok z bazy renderowałby pustą płytę.
    const m = scatterModelFromConfig({
      ...defaultChartConfig(),
      categories: ["10", "20", "30"],
      series: [seria("Y", [1, 3, 5], 1)],
      sampleSize: 3,
    });
    expect(m.xSource).toBe("categories");
    expect(m.n).toBe(3);
    expect(m.clouds[0].trend?.slope).toBeCloseTo(0.2, 10);
    expect(m.honesty.declaredSampleSizeOk).toBe(true);
    expect(nieliczby(calosc(m))).toEqual([]);
  });

  it("domyślna konfiguracja (blok świeżo wstawiony) nie rzuca i o niczym nie zaświadcza", () => {
    // Blok wstawiony w edytorze ma domyślne dane i chwilę czeka na wpisanie
    // liczb. W tym stanie model musi milczeć, a nie ostrzegać - ostrzeżenie
    // widoczne zawsze uczy ignorowania wszystkich ostrzeżeń.
    const m = scatterModelFromConfig(defaultChartConfig());
    expect(() => scatterTable(m)).not.toThrow();
    expect(nieliczby(calosc(m))).toEqual([]);
    expect(m.honesty.pairsCompleteOk === false).toBe(false);
  });
});

describe("scatter - deklaracja n autora", () => {
  it("rozjazd zadeklarowanego n z liczbą par jest wykrywany", () => {
    // Realny defekt: podpis mówi "n = 300", bo tyle ankiet zebrano, a w bloku
    // jest kilka wierszy, bo ktoś wkleił próbkę. Wtedy wykres i podpis mówią
    // o dwóch różnych badaniach.
    const dane: ScatterInput = {
      categories: ["1", "2", "3"],
      series: [seria("Y", [1, 2, 3])],
      sampleSize: 300,
    };
    expect(scatterModel(dane).honesty.declaredSampleSizeOk).toBe(false);
    expect(scatterModel({ ...dane, sampleSize: 3 }).honesty.declaredSampleSizeOk).toBe(true);
    expect(scatterModel({ ...dane, sampleSize: null }).honesty.declaredSampleSizeOk).toBeNull();
  });
});

describe("scatter - kiedy forma jest zła", () => {
  it("rosnący i niepowtarzalny X to szereg, a szereg ma inną formę", () => {
    // Tabela doboru formy przypisuje pytaniu "jak zmieniało się w czasie"
    // wykres liniowy. UWAGA: advice nie jest zgodą na dorysowanie linii do
    // chmury - lekarstwem jest ZMIANA RODZAJU, bo w liniowym kolejność
    // punktów jest treścią danych, a w punktowym nie jest.
    const m = scatterModel(zKategorii([2020, 2021, 2022, 2023], [1, 3, 2, 5]));
    expect(scatterFormAdvice(m)).toContain("lineBetter");
    expect(m.mayConnectPoints).toBe(false);
  });

  it("X pomieszany w kolejności wierszy NIE jest szeregiem", () => {
    // Bez tego rozróżnienia advice `lineBetter` odpalałby na każdej chmurze,
    // którą autor przypadkiem wpisał rosnąco, i przestałby cokolwiek znaczyć.
    const m = scatterModel(zKategorii([2021, 2020, 2023, 2022], [1, 3, 2, 5]));
    expect(scatterFormAdvice(m)).not.toContain("lineBetter");
  });

  it("chmura w porządku nie zbiera ani jednej rady o formie", () => {
    // Dane: sensowna zależność, brak powtórzeń, X pomieszany, dość par.
    const m = scatterModel(zKategorii([3, 1, 4, 2, 6, 5], [7, 2, 8, 4, 12, 11]));
    expect(scatterFormAdvice(m)).toEqual([]);
  });
});

describe("scatter - alternatywa tekstowa", () => {
  it("tabela wypisuje pary odrzucone, bo na rysunku ich nie ma i być nie może", () => {
    // Punkt bez `x` nie ma gdzie stanąć, więc tabela jest JEDYNYM miejscem,
    // w którym czytelnik dowie się o jego istnieniu. Wiersz z jedną kolumną
    // pustą mówi dokładnie to, co się stało.
    const m = scatterModel({
      categories: ["1", "2", "", "4"],
      series: [seria("Y", [10, null, 30, 40])],
    });
    const t = scatterTable(m);
    expect(t.rows).toHaveLength(4);
    const odrzucone = t.rows.filter((r) => r.dropped);
    expect(odrzucone).toHaveLength(2);
    expect(odrzucone.map((r) => [r.x, r.y])).toEqual([
      [2, null],
      [null, 30],
    ]);
    expect(t.method.droppedPairs).toBe(2);
  });

  it("tabela niesie parę liczb, etykietę wiersza i nazwę serii", () => {
    // Grafika nigdy nie jest jedyną drogą do liczby: z plamki na przecięciu
    // dwóch osi nie da się odczytać pary dokładniej niż "mniej więcej",
    // a ekran czytający nie odczyta jej wcale.
    const m = scatterModel({
      categories: ["Polska", "Niemcy"],
      series: [seria("PKB", [10, 20], 1), seria("Inflacja", [2, 4], 2)],
    });
    const t = scatterTable(m);
    expect(t.columns).toEqual(["label", "series", "x", "y"]);
    expect(t.rows[0]).toMatchObject({ label: "Polska", series: "Inflacja", x: 10, y: 2 });
    expect(t.method.xSource).toBe("series");
    expect(t.method.xName).toBe("PKB");
  });

  it("tabela podaje metodę regresji, bo metoda jest umową, nie faktem", () => {
    // Najmniejsze kwadraty `y` po `x` dają inną prostą niż `x` po `y`, więc
    // czytelnik przeliczający dane u siebie inaczej dostanie inne nachylenie
    // i będzie miał rację. Bez nazwy metody pod tabelą nie ma jak tego
    // rozstrzygnąć.
    const t = scatterTable(scatterModel(zKategorii([1, 2, 3], [1, 2, 3])));
    expect(t.method.regression).toBe(REGRESSION_METHOD);
    expect(t.method.minN).toBe(SCATTER_TREND_MIN_N);
    expect(t.method.r2Meaningless).toBe(SCATTER_R2_MEANINGLESS);
  });

  it("tabela liczy Z MODELU, nie po raz drugi z surowych danych", () => {
    // Dwa liczenia to dwa źródła prawdy, a rozjazd między nimi jest defektem
    // samym w sobie: tabela pokazywałaby inne liczby niż rysunek, z którego
    // czytelnik je sprawdza.
    const m = scatterModel(zKategorii([1, 2, 3, 4], [2, 4, 5, 9]));
    const t = scatterTable(m);
    expect(t.rows.map((r) => r.x)).toEqual(m.points.map((p) => p.x));
    expect(t.trends[0].slope).toBe(m.clouds[0].trend?.slope);
    expect(t.trends[0].r2).toBe(m.clouds[0].trend?.r2);
    expect(t.trends[0].fromX).toBe(m.clouds[0].trend?.from.x);
  });

  it("chmura bez trendu ma w tabeli n, a nachylenie i R2 puste", () => {
    // Alternatywa tekstowa nie może być bardziej stanowcza od rysunku: skoro
    // model milczy o trendzie, tabela też milczy - ale liczbę obserwacji
    // podaje, bo ta jest znana i jest w sekcji 8 wymagana.
    const t = scatterTable(scatterModel(zKategorii([1, 2], [5, 7]))).trends[0];
    expect(t.n).toBe(2);
    expect(t.slope).toBeNull();
    expect(t.r2).toBeNull();
    expect(t.fromX).toBeNull();
    expect(t.meaningful).toBeNull();
  });
});

describe("scatter - stałe delikatności", () => {
  it("strefa trafienia jest WYRAŹNIE większa od markera", () => {
    // Sekcja 6: strefa trafienia nigdy nie jest kształtem elementu. Kropka
    // o promieniu 3 px jest celem, w który nie da się trafić myszą, a palcem
    // tym bardziej - i wtedy tooltip z dokładną parą jest niedostępny, mimo
    // że został zaimplementowany.
    expect(SCATTER_HIT_R).toBeGreaterThan(SCATTER_MARKER_R * 2);
  });
});
