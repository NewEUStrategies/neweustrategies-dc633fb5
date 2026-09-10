// Model histogramu. Ten plik pinuje ZACHOWANIE, nie implementację: liczby
// przedziałów pinujemy tam, gdzie wynikają z reguły podanej w specyfikacji
// (Freedman-Diaconis, Sturges), a wszędzie indziej sprawdzamy własności,
// które muszą zostać prawdziwe po każdej przebudowie - sumę kontrolną
// licznosci, pole słupka gęstości równe udziałowi i to, że model NIGDY nie
// produkuje NaN ani nieskończoności.
//
// Najważniejsza grupa w tym pliku to "dane z bazy": treść bloku przychodzi
// z bazy i może być z wersji edytora, której ten kod nie zna, a bramka
// `blockMatrix` sprawdza `textContent` bloków na obecność napisu "NaN" -
// `Intl.NumberFormat.format(NaN)` zwraca literalnie "NaN", więc jedna
// nieosłonięta dzielnia w modelu wychodzi na stronie jako tekst.
import { describe, expect, it } from "vitest";
import {
  HISTOGRAM_MAX_BINS,
  HISTOGRAM_SHAPE_MIN_OBSERVATIONS,
  histogramExtent,
  histogramFormAdvice,
  histogramModel,
  histogramModelFromConfig,
  histogramTable,
  type HistogramModel,
} from "@/lib/charts/kinds/histogram";
import { defaultChartConfig } from "@/lib/charts/parse";
import type { ChartConfig } from "@/lib/charts/types";

/** Dwadzieścia kolejnych liczb całkowitych - rozkład płaski, IQR dodatni. */
const ROWNOMIERNE = Array.from({ length: 20 }, (_, i) => i);

/** Wszystkie liczby w modelu, także zagnieżdżone w przedziałach. */
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

/** Wszystkie napisy w modelu - do sprawdzenia, czy nie wyciekł "NaN". */
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

function config(over: Partial<ChartConfig>): ChartConfig {
  return { ...defaultChartConfig(), ...over };
}

describe("histogram - dobór przedziałów", () => {
  it("domyślnie liczy przedziały regułą Freedmana-Diaconisa", () => {
    // Bez tego histogram bierze liczbę przedziałów "na oko" albo z Sturgesa,
    // który liczy z samego n i przy jednym wyrzutku rozciąga przedziały na
    // pusty obszar. FD liczy z IQR, czyli z rdzenia rozkładu.
    // 2 * IQR / n^(1/3) = 2 * 9,5 / 20^(1/3) = 7,0 przy zakresie 19,
    // więc reguła zamawia trzy przedziały.
    const model = histogramModel(ROWNOMIERNE);
    expect(model.rule).toBe("freedman-diaconis");
    expect(model.binCount).toBe(3);
    expect(model.summary.iqr).toBeCloseTo(9.5, 10);
  });

  it("przy IQR równym zero schodzi na Sturgesa, a nie dzieli przez zero", () => {
    // Skupisko powtórzonej wartości plus wyrzutek: Q1 = Q3, więc szerokość FD
    // wychodzi zero i iloraz zakresu przez nią jest nieskończonością. Bez
    // tego zejścia model zamawiałby nieskończenie wiele przedziałów albo
    // zwracał NaN w krawędziach.
    const dane = [...Array.from({ length: 9 }, () => 5), 100];
    const model = histogramModel(dane);
    expect(model.summary.iqr).toBe(0);
    expect(model.rule).toBe("sturges");
    // ceil(log2 10) + 1 = 5
    expect(model.binCount).toBe(5);
    expect(model.bins.every((b) => Number.isFinite(b.from) && Number.isFinite(b.to))).toBe(true);
  });

  it("twardy sufit przycina liczbę przedziałów i MÓWI, że przyciął", () => {
    // Wąski rdzeń plus odległy wyrzutek: FD zamawia miliony przedziałów,
    // czyli pustą płytę z jednym pikselem przy krawędzi. Bez `binCountClamped`
    // rozdzielczość narzucona rysunkiem wyglądałaby na wybraną regułą.
    const dane = [...Array.from({ length: 40 }, (_, i) => i * 0.001), 1_000_000];
    const model = histogramModel(dane);
    expect(model.binCount).toBe(HISTOGRAM_MAX_BINS);
    expect(model.binCountClamped).toBe(true);
    expect(histogramFormAdvice(model)).toContain("clamped");
  });

  it("krawędzie liczone przechodzą DOKŁADNIE przez minimum i maksimum", () => {
    // Krawędź ostatnia liczona narastającym dodawaniem wypada o kilka
    // epsilonów pod maksimum, a wtedy największa obserwacja jest "poza
    // zakresem" własnych krawędzi i model zgłasza defekt, który sam
    // wyprodukował. Ta seria (0,1 .. 0,7) właśnie tak się rozjeżdżała.
    const model = histogramModel([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7], { binCount: 7 });
    expect(model.bins[0].from).toBe(0.1);
    expect(model.bins[model.bins.length - 1].to).toBe(0.7);
    expect(model.inRangeOk).toBe(true);
    expect(model.outOfRange).toBe(0);
  });

  it("maksimum należy do OSTATNIEGO przedziału, nie wypada z rozkładu", () => {
    // Przedziały są domknięte z lewej i otwarte z prawej; bez wyjątku dla
    // ostatniego maksimum nie należałoby do żadnego przedziału.
    const model = histogramModel(ROWNOMIERNE);
    const ostatni = model.bins[model.bins.length - 1];
    expect(ostatni.closedRight).toBe(true);
    expect(model.bins.reduce((a, b) => a + b.count, 0)).toBe(20);
  });
});

describe("histogram - skala: gęstość zamiast licznosci", () => {
  it("przy przedziałach RÓWNYCH wysokość koduje licznosć", () => {
    // Przy równych przedziałach gęstość jest licznością przemnożoną przez
    // stałą, więc licznosć czyta się bez tłumaczenia i bez podpisu przy osi.
    const model = histogramModel(ROWNOMIERNE);
    expect(model.uniformWidth).toBe(true);
    expect(model.valueEncodes).toBe("count");
    expect(model.bins.map((b) => b.plotValue)).toEqual(model.bins.map((b) => b.count));
  });

  it("przy przedziałach NIERÓWNYCH wysokość koduje gęstość, a pole udział", () => {
    // To jest sedno rodzaju: przedział szerszy zbiera przy tej samej gęstości
    // więcej obserwacji, więc słupek licznosci wyskakuje wyżej i sugeruje
    // szczyt, którego w rozkładzie nie ma. Tu przedział z TRZEMA
    // obserwacjami musi być NIŻSZY od przedziału z dwiema, bo jest cztery
    // razy szerszy - i to jest cała różnica między histogramem a słupkami.
    const model = histogramModel([0.5, 2, 2.5, 4, 5, 6], { edges: [0, 1, 3, 7] });
    expect(model.uniformWidth).toBe(false);
    expect(model.valueEncodes).toBe("density");
    expect(model.bins.map((b) => b.count)).toEqual([1, 2, 3]);
    expect(model.bins[2].plotValue).toBeLessThan(model.bins[1].plotValue);
    // Suma PÓL słupków to jedność - pole niesie udział.
    const pole = model.bins.reduce((a, b) => a + b.density * b.width, 0);
    expect(pole).toBeCloseTo(1, 10);
  });

  it("równość szerokości mierzy się z tolerancją, nie przez '==='", () => {
    // Krawędzie równych przedziałów liczone w podwójnej precyzji różnią się
    // na ostatnich bitach. Porównanie dokładne uznawałoby własne równe
    // przedziały za nierówne i podmieniało oś wykresu na gęstość z powodu
    // błędu zaokrąglenia.
    const model = histogramModel([0.1, 0.15, 0.22, 0.31, 0.44, 0.58, 0.7], { binCount: 7 });
    expect(model.uniformWidth).toBe(true);
    expect(model.valueEncodes).toBe("count");
  });

  it("oś wartości zaczyna się w zerze", () => {
    // Sekcja 8: słupek koduje długością, więc ucięta oś zniekształca
    // proporcję między przedziałami.
    const model = histogramModel(ROWNOMIERNE);
    expect(histogramExtent(model)).toEqual({ min: 0, max: model.plotMax });
    expect(model.plotMax).toBeGreaterThan(0);
  });
});

describe("histogram - sprawdzenia uczciwości", () => {
  it("suma licznosci równa się liczbie obserwacji", () => {
    // Suma kontrolna rodzaju: histogram, pod którego słupkami siedzi mniej
    // obserwacji niż w danych, zawyża udział wszystkiego, co pokazał.
    const model = histogramModel([1, 2, 2, 3, 5, 8, 13, 21]);
    expect(model.bins.reduce((a, b) => a + b.count, 0)).toBe(model.summary.n);
    expect(model.countChecksumOk).toBe(true);
    expect(model.bins.reduce((a, b) => a + b.share, 0)).toBeCloseTo(1, 10);
  });

  it("obserwacja poza podanymi krawędziami jest DEFEKTEM, nie jest wciskana do skrajnego przedziału", () => {
    // Domknięcie indeksu przez `Math.min(k-1, ...)` schowałoby obie
    // obserwacje spoza zakresu w słupkach skrajnych i histogram wyglądałby
    // na poprawny - a właśnie tam kłamie najbardziej, bo w tych słupkach
    // siedzą wartości, których krawędzie nie obejmują.
    const model = histogramModel([-5, 5, 50], { edges: [0, 10] });
    expect(model.outOfRange).toBe(2);
    expect(model.inRangeOk).toBe(false);
    expect(model.countChecksumOk).toBe(false);
    expect(model.bins[0].count).toBe(1);
  });

  it("przedział zerowej szerokości jest defektem i nie rodzi nieskończonej gęstości", () => {
    // Dwie równe krawędzie dają przedział, którego nie da się narysować,
    // a jego gęstość byłaby dzieleniem przez zero, czyli napisem "∞"
    // w tabeli danych. Przedział wypada z rysunku, defekt zostaje zapisany.
    const model = histogramModel([1, 6], { edges: [0, 5, 5, 10] });
    expect(model.binWidthOk).toBe(false);
    expect(model.binCount).toBe(2);
    expect(model.bins.every((b) => Number.isFinite(b.density) && b.width > 0)).toBe(true);
    // Żadna obserwacja nie zginęła, więc suma kontrolna milczy - oba pola
    // liczone są niezależnie i mówią o różnych rzeczach.
    expect(model.countChecksumOk).toBe(true);
  });

  it("jedna obserwacja to nie rozkład", () => {
    // Jedna obserwacja nie ma rozproszenia, kwartyle sprowadzają się do niej
    // samej, a pełny słupek sugeruje "wszystko jest tutaj" na zbiorze,
    // w którym nie ma czego porównać z czym.
    const model = histogramModel([42]);
    expect(model.enoughObservationsOk).toBe(false);
    expect(model.summary.n).toBe(1);
    expect(model.bins).toHaveLength(1);
  });

  it("brak rozproszenia jest zgłaszany, a przedział ma dodatnią szerokość", () => {
    // Wszystkie obserwacje równe: zakres zero. Bez dopełnienia krawędzi
    // przedział miałby zerową szerokość, czyli nierysowalny słupek
    // i dzielenie przez zero w gęstości; bez `spreadOk` podpis mówiłby
    // "rozkład" o zbiorze, w którym rozkładu nie ma.
    const model = histogramModel([7, 7, 7, 7]);
    expect(model.rule).toBe("degenerate");
    expect(model.spreadOk).toBe(false);
    expect(model.bins).toHaveLength(1);
    expect(model.bins[0].width).toBeGreaterThan(0);
    expect(model.bins[0].kind).toBe("point");
    // Etykieta niesie SAMĄ wartość, nie zakres: rozpiętości w danych nie ma,
    // a dopełnienie krawędzi jest artefaktem rysunku.
    expect(model.bins[0].label).not.toContain(" - ");
    // Nie ma czego dzielić na przedziały, więc model nie odpowiada na
    // pytanie o ich liczbę.
    expect(model.enoughBinsOk).toBeNull();
    expect(histogramFormAdvice(model)).toContain("noSpread");
  });

  it("jeden przedział na rozstrzelonych danych to rysunek bez informacji", () => {
    const model = histogramModel([1, 5, 9, 40], { binCount: 1 });
    expect(model.enoughBinsOk).toBe(false);
    expect(histogramFormAdvice(model)).toContain("tooCoarse");
  });

  it("rozjazd zadeklarowanego n z liczbą obserwacji jest wykrywany", () => {
    // Sekcja 8 każe podać n w podpisie. Jeżeli autor wpisze 300, a w bloku
    // siedzi dwadzieścia wierszy, to podpis kłamie o próbce - i jest to
    // rozjazd wykrywalny arytmetycznie, więc się go wykrywa.
    expect(histogramModel(ROWNOMIERNE, { declaredSampleSize: 300 }).declaredSampleOk).toBe(false);
    expect(histogramModel(ROWNOMIERNE, { declaredSampleSize: 20 }).declaredSampleOk).toBe(true);
    // Autor nie podał - nie ma czego sprawdzać, model milczy.
    expect(histogramModel(ROWNOMIERNE).declaredSampleOk).toBeNull();
  });

  it("przy zerze obserwacji model MILCZY, a nie zaświadcza", () => {
    // Konwencja repo: `null` znaczy "nie ma czego sprawdzać". Gdyby pola
    // wychodziły tu jako `true`, model twierdziłby, że sprawdził rozkład,
    // którego nie ma - i pod pustym wykresem nie byłoby ani jednego
    // ostrzeżenia.
    const model = histogramModel([null, null]);
    expect(model.bins).toEqual([]);
    expect(model.rule).toBe("none");
    expect(model.summary.missing).toBe(2);
    expect([
      model.countChecksumOk,
      model.inRangeOk,
      model.binWidthOk,
      model.spreadOk,
      model.enoughObservationsOk,
      model.enoughBinsOk,
      model.declaredSampleOk,
    ]).toEqual([null, null, null, null, null, null, null]);
  });

  it("mała próbka jest złym wyborem formy, ale nie defektem arytmetycznym", () => {
    // Poniżej progu kształt histogramu jest funkcją położenia krawędzi,
    // a nie rozkładu. To nie defekt danych, więc siedzi w doradzaniu formy,
    // a nie w polach uczciwości.
    const model = histogramModel([1, 2, 3, 4, 5, 9]);
    expect(model.summary.n).toBeLessThan(HISTOGRAM_SHAPE_MIN_OBSERVATIONS);
    expect(histogramFormAdvice(model)).toContain("tooFew");
    expect(model.countChecksumOk).toBe(true);
  });
});

describe("histogram - dane z bazy nie wywracają modelu", () => {
  const przypadki: [string, () => HistogramModel][] = [
    ["pusta seria", () => histogramModel([])],
    ["sama luka", () => histogramModel([null, null, null])],
    ["jedna obserwacja", () => histogramModel([3])],
    ["jedna obserwacja zerowa", () => histogramModel([0])],
    ["wszystkie równe zeru", () => histogramModel([0, 0, 0])],
    ["wartości ujemne", () => histogramModel([-9, -4, -4, -1, 0, 2])],
    ["same ujemne i równe", () => histogramModel([-5, -5, -5])],
    ["nieskończoności z zepsutej wersji", () => histogramModel([Infinity, -Infinity, 1, 2, 3])],
    ["NaN w wektorze", () => histogramModel([Number.NaN, 1, 2, 3, 4])],
    ["krawędzie odwrócone", () => histogramModel([1, 2, 3], { edges: [10, 0] })],
    ["krawędzie zdublowane", () => histogramModel([1, 2, 3], { edges: [0, 0, 0] })],
    ["krawędzie z nieliczbami", () => histogramModel([1, 2], { edges: [Number.NaN, 0, 5] })],
    ["jedna krawędź", () => histogramModel([1, 2, 3], { edges: [4] })],
    ["liczba przedziałów zero", () => histogramModel([1, 2, 3], { binCount: 0 })],
    ["liczba przedziałów ujemna", () => histogramModel([1, 2, 3], { binCount: -8 })],
    ["liczba przedziałów ułamkowa", () => histogramModel([1, 2, 3], { binCount: 2.7 })],
    ["liczba przedziałów nieskończona", () => histogramModel([1, 2, 3], { binCount: Infinity })],
    ["sufit zero", () => histogramModel(ROWNOMIERNE, { maxBins: 0 })],
    ["sufit nieskończony", () => histogramModel(ROWNOMIERNE, { maxBins: Infinity })],
    ["skrajne wielkości", () => histogramModel([-1e308, 0, 1e308])],
    ["wartości bliskie sobie", () => histogramModel([1, 1 + 1e-15, 1 + 2e-15])],
    ["wyrzutek przy wąskim rdzeniu", () => histogramModel([...ROWNOMIERNE, 1e9])],
  ];

  for (const [nazwa, buduj] of przypadki) {
    it(`nie rzuca i nie produkuje NaN: ${nazwa}`, () => {
      // Twarde wymaganie: bramka `blockMatrix` sprawdza `textContent` bloków
      // na obecność napisów "NaN" i "undefined", a `Intl` na NaN zwraca
      // literalnie "NaN". Jedno nieosłonięte dzielenie w modelu wychodzi
      // więc na stronie jako tekst, a nie jako pusty wykres.
      const model = buduj();
      const liczby = zbierzLiczby(model);
      expect(liczby.length).toBeGreaterThan(0);
      expect(liczby.every((v) => Number.isFinite(v))).toBe(true);
      for (const napis of zbierzNapisy(model)) {
        expect(napis).not.toContain("NaN");
        expect(napis).not.toContain("undefined");
        expect(napis).not.toContain("Infinity");
      }
      // Kolejność krawędzi jest niezmiennikiem rysunku - słupki idą od lewej.
      // `width` sprawdzamy OSOBNO od pary krawędzi, bo to dwa różne pola
      // i mogą się rozejść: przy zakresie przekraczającym podwójną precyzję
      // (-1e308 do 1e308) szerokość wychodziła nieskończona, a zapora na
      // wyjściu sprowadzała ją do zera - czyli słupek o krawędziach oddalonych
      // o pół osi i o szerokości nic. Render dzieli przez tę szerokość.
      for (const bin of model.bins) {
        expect(bin.to).toBeGreaterThan(bin.from);
        expect(bin.width).toBeGreaterThan(0);
        expect(bin.count).toBeGreaterThanOrEqual(0);
      }
      expect(model.domain.max).toBeGreaterThanOrEqual(model.domain.min);
      // ŻADNA OBSERWACJA NIE GINIE PO CICHU: każda albo siedzi w słupku,
      // albo jest policzona jako leżąca poza krawędziami. Bez tego
      // niezmiennika histogram mógłby zawyżać udziały wszystkiego, co
      // pokazał, i żadne pole modelu by o tym nie powiedziało.
      const wSlupkach = model.bins.reduce((a, b) => a + b.count, 0);
      expect(wSlupkach + model.outOfRange).toBe(model.summary.n);
    });
  }

  it("nieliczby są LUKAMI, a nie zerami", () => {
    // Zero wpadłoby do przedziału i przesunęło masę rozkładu, a brak pomiaru
    // nie jest pomiarem o wartości zero. Tu wyrzutki z zepsutej wersji
    // edytora (Infinity, NaN) muszą wyjść z rozkładu i policzyć się jako
    // luki, żeby n w podpisie zostało prawdziwe.
    const model = histogramModel([Number.NaN, Infinity, 10, 20, 30, null]);
    expect(model.summary.n).toBe(3);
    expect(model.summary.missing).toBe(3);
    expect(model.summary.min).toBe(10);
    expect(model.summary.max).toBe(30);
  });

  it("średnia nie przepełnia się na wielkich wartościach", () => {
    // Suma trzech wartości rzędu 1e308 wychodzi z podwójnej precyzji, więc
    // średnia liczona jako suma przez n dawała nieskończoność, a zapora na
    // wyjściu sprowadzała ją do ZERA - czyli tabela pod wykresem podawała
    // średnią zero dla zbioru samych ogromnych liczb. Kłamstwo o liczbie
    // jest gorsze niż jej brak, więc średnia liczy się przyrostowo.
    const model = histogramModel([1e308, 1e308, 1e308]);
    expect(model.summary.mean).toBe(1e308);
  });

  it("wartości ujemne są poprawnym rozkładem, nie błędem", () => {
    // Histogram nie ma osi udziałów, więc ujemna obserwacja (marża, saldo,
    // zmiana) jest normalną obserwacją i musi trafić do przedziału,
    // a nie wypaść z rozkładu.
    const model = histogramModel([-9, -4, -4, -1, 0, 2]);
    expect(model.summary.min).toBe(-9);
    expect(model.bins.reduce((a, b) => a + b.count, 0)).toBe(6);
    expect(model.countChecksumOk).toBe(true);
  });
});

describe("histogram - wejście z obecnego kształtu konfiguracji", () => {
  it("czyta wektor obserwacji z pierwszej serii Z DANYMI, a kategorie jako identyfikatory", () => {
    // Seria dopisana w edytorze i jeszcze niewypełniona stoi często na
    // pierwszej pozycji. Sztywne `series[0]` wygaszałoby cały rozkład
    // i ukrywało dane, które autor już wpisał.
    const model = histogramModelFromConfig(
      config({
        categories: ["PL", "DE", "FR", "ES"],
        series: [
          { name: "Puste", values: [null, null, null, null], colorSlot: 1 },
          { name: "Udział", values: [1, 2, 8, 9], colorSlot: 2 },
        ],
        sampleSize: 4,
      }),
    );
    expect(model.seriesName).toBe("Udział");
    expect(model.colorSlot).toBe(2);
    expect(model.summary.n).toBe(4);
    expect(model.declaredSampleOk).toBe(true);
    // Kategorie NIE są przedziałami - są etykietami obserwacji i przeżywają
    // wyłącznie tutaj, w składzie przedziału.
    expect(model.bins.flatMap((b) => b.members).sort()).toEqual(["DE", "ES", "FR", "PL"]);
  });

  it("druga populacja jest POLICZONA, nie zsypana do wspólnych przedziałów", () => {
    // Zsypanie dwóch serii dałoby rozkład zbiorowiska, którego nikt nie
    // badał. Model rysuje jedną populację i mówi, ile ich nie widać.
    const model = histogramModelFromConfig(
      config({
        categories: ["a", "b", "c"],
        series: [
          { name: "Kraje", values: [1, 2, 3], colorSlot: 1 },
          { name: "Regiony", values: [40, 50, 60], colorSlot: 2 },
        ],
      }),
    );
    expect(model.seriesName).toBe("Kraje");
    expect(model.ignoredSeries).toBe(1);
    expect(model.summary.max).toBe(3);
  });

  it("konfiguracja domyślna (zero serii) daje pusty, milczący model", () => {
    const model = histogramModelFromConfig(defaultChartConfig());
    expect(model.bins).toEqual([]);
    expect(model.spreadOk).toBeNull();
    expect(zbierzLiczby(model).every((v) => Number.isFinite(v))).toBe(true);
  });
});

describe("histogram - alternatywa tekstowa", () => {
  it("tabela niesie komplet pozycyjny, nie samą średnią", () => {
    // Kolumna "Czego unikać" z tabeli doboru formy zabrania przy rozkładzie
    // "średniej bez rozproszenia", a tabela pod wykresem jest miejscem,
    // w którym ten błąd popełnia się najłatwiej: jedna liczba na dole
    // i sprawa zamknięta.
    const tabela = histogramTable(histogramModel(ROWNOMIERNE));
    expect(Object.keys(tabela.summary).sort()).toEqual(
      ["iqr", "max", "mean", "median", "min", "missing", "n", "q1", "q3"].sort(),
    );
    expect(tabela.summary.median).toBeCloseTo(9.5, 10);
    expect(tabela.summary.iqr).toBeCloseTo(9.5, 10);
    // Średnia liczona przyrostowo musi zgadzać się ze zwykłą średnią tam,
    // gdzie zwykła średnia się nie przepełnia - inaczej odporność na
    // przepełnienie kupilibyśmy błędem na każdym normalnym zbiorze.
    expect(tabela.summary.mean).toBeCloseTo(9.5, 10);
  });

  it("wiersze tabeli odpowiadają słupkom jeden do jednego, a suma zgadza się z n", () => {
    // Grafika nigdy nie jest jedyną drogą do liczby, ale tabela liczona
    // z innego źródła niż rysunek jest gorsza niż jej brak - czytelnik ma
    // wtedy dwie różne liczby na to samo.
    const model = histogramModel([1, 2, 2, 3, 5, 8, 13, 21]);
    const tabela = histogramTable(model);
    expect(tabela.rows.map((r) => r.count)).toEqual(model.bins.map((b) => b.count));
    expect(tabela.rows.map((r) => r.label)).toEqual(model.bins.map((b) => b.label));
    expect(tabela.total).toBe(model.summary.n);
  });

  it("kolumna gęstości pojawia się TYLKO przy nierównych przedziałach", () => {
    // Przy równych przedziałach gęstość jest licznością przemnożoną przez
    // stałą, więc dodatkowa kolumna niczego nie dodaje i rozsadza tabelę.
    // Przy nierównych jest tym, co niesie wysokość słupka - i czytelnik musi
    // mieć w tabeli tę samą liczbę, którą widzi na rysunku.
    expect(histogramTable(histogramModel(ROWNOMIERNE)).rows.every((r) => r.density === null)).toBe(
      true,
    );
    const nierowne = histogramTable(histogramModel([0.5, 2, 4], { edges: [0, 1, 3, 7] }));
    expect(nierowne.valueEncodes).toBe("density");
    expect(nierowne.rows.every((r) => r.density !== null)).toBe(true);
  });

  it("etykieta przedziału powstaje wstrzykniętym formaterem", () => {
    // Model jest czysty i nie zna ani języka, ani jednostki; render podaje
    // `formatChartValue` związane z jednym i drugim. Bez wstrzyknięcia
    // etykiety w tabeli miałyby inny separator dziesiętny niż wartości obok.
    const model = histogramModel([0, 10], { binCount: 1, formatValue: (v) => `${v} mld` });
    expect(model.bins[0].label).toBe("0 mld - 10 mld");
  });
});
