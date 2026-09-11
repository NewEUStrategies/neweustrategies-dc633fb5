// Model rozrzutu ulowego (beeswarm). Ten plik pinuje ZACHOWANIE, nie
// implementację: nie sprawdzamy, jakie dokładnie przesunięcie dostał
// siedemnasty punkt, tylko własności, które muszą zostać prawdziwe po każdej
// przebudowie algorytmu rozsuwania - że pozycja na osi wartości się nie
// ruszyła, że żaden punkt nie zginął, że żadna para się nie nakłada i że ten
// sam zestaw danych daje ten sam obrazek. Wyjątkiem są trzy testy geometrii
// kolumny remisów, gdzie liczby (0, -2, +2) wynikają wprost ze styku dwóch kół
// o promieniu jeden i są własnością formy, a nie wyborem implementacji.
//
// Najważniejsza grupa w tym pliku to "dane z bazy": treść bloku przychodzi
// z bazy i może być z wersji edytora, której ten kod nie zna, a bramka
// `blockMatrix` sprawdza `textContent` bloków na obecność napisu "NaN" -
// `Intl.NumberFormat.format(NaN)` zwraca literalnie "NaN", więc jedna
// nieosłonięta dzielnia w modelu wychodzi na stronie jako słowo.
import { describe, expect, it } from "vitest";
import {
  BEESWARM_DEFAULT_HALF_BAND_RADII,
  BEESWARM_DEFAULT_SPAN_RADII,
  BEESWARM_MAX_COMFORT,
  BEESWARM_MIN_OBSERVATIONS,
  BEESWARM_SUMMARY_COLUMNS,
  POINT_CLEARANCE_RADII,
  beeswarmExtent,
  beeswarmFormAdvice,
  beeswarmModel,
  beeswarmModelFromConfig,
  beeswarmTable,
  type BeeswarmInput,
  type BeeswarmModel,
} from "@/lib/charts/kinds/beeswarm";
import { defaultChartConfig } from "@/lib/charts/parse";
import { quantile } from "@/lib/charts/stats";
import { MAX_COLOR_SLOT, type ChartSeries } from "@/lib/charts/types";

/* -------------------------------------------------------------------------- */
/*  Narzędzia testowe                                                         */
/* -------------------------------------------------------------------------- */

function seria(name: string, values: (number | null)[], colorSlot = 1): ChartSeries {
  return { name, values, colorSlot };
}

function wejscie(
  values: (number | null)[],
  opts: { sampleSize?: number | null } = {},
): BeeswarmInput {
  return {
    categories: values.map((_v, i) => `obs-${i + 1}`),
    series: [seria("grupa", values)],
    sampleSize: opts.sampleSize ?? null,
  };
}

/** Wszystkie liczby w strukturze, także zagnieżdżone w punktach i rojach. */
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
 * Najmniejsza odległość między parą punktów tego samego roju, w promieniach
 * punktu. Liczona NIEZALEŻNIE od modelu (pełny przegląd par, bez skanu
 * z przerwaniem), żeby sprawdzenie `noOverlap` z modelu nie było jedynym
 * świadkiem samego siebie.
 */
function najmniejszaOdleglosc(model: BeeswarmModel): number {
  let min = Infinity;
  for (const roj of model.swarms) {
    for (let i = 0; i < roj.points.length; i++) {
      for (let j = i + 1; j < roj.points.length; j++) {
        const a = roj.points[i];
        const b = roj.points[j];
        const dv = a.valueRadii - b.valueRadii;
        const dof = a.offset - b.offset;
        min = Math.min(min, Math.sqrt(dv * dv + dof * dof));
      }
    }
  }
  return min;
}

/* -------------------------------------------------------------------------- */

describe("beeswarm: pozycja na osi wartości jest danymi", () => {
  it("nie rusza ani jednej wartości przy rozsuwaniu", () => {
    // Bez tego rozsuwanie mogłoby "poprawiać" pozycję na osi wartości, żeby
    // punkty ładniej się układały - a wtedy czytelnik odczytuje wartość,
    // której nikt nie zmierzył. To jest jedyna rzecz, której temu rodzajowi
    // nie wolno zrobić, więc sprawdzamy ją na danych gęstych, gdzie pokusa
    // przesunięcia jest największa.
    const dane = [10, 10.1, 10.2, 10.2, 10.3, 10.4, 10.4, 10.5, 10.6, 10.6];
    const model = beeswarmModel(wejscie(dane), { spanRadii: 20, halfBandRadii: 50 });
    const narysowane = model.swarms[0].points.map((p) => p.value).sort((a, b) => a - b);
    expect(narysowane).toEqual([...dane].sort((a, b) => a - b));
    expect(model.honesty.valuesPreserved).toBe(true);
  });

  it("zgłasza defekt, gdy wielozbiór wartości się nie zgadza (sufit punktów)", () => {
    // Sufit punktów jest jedynym miejscem, w którym model świadomie oddaje
    // mniej obserwacji, niż przeczytał - i właśnie dlatego musi to WYKRYĆ,
    // a nie przemilczeć. Gdyby `valuesPreserved` liczyło się z własnego
    // wyjścia, wychodziłoby prawdziwe z definicji i nie mogłoby złapać ani
    // sufitu, ani żadnego innego gubienia punktów.
    const model = beeswarmModel(wejscie([1, 2, 3, 4, 5]), { maxPoints: 3 });
    expect(model.honesty.valuesPreserved).toBe(false);
    expect(model.honesty.pointCountOk).toBe(false);
    expect(model.swarms[0].truncated).toBe(2);
  });
});

describe("beeswarm: liczba punktów równa się liczbie obserwacji", () => {
  it("nie gubi ani jednego punktu na próbie gęstszej niż pasmo", () => {
    // NAJŁATWIEJSZY BŁĄD TEGO ALGORYTMU: punkt, dla którego nie znalazło się
    // wolne miejsce, wypada z pętli, a chmura z jednym punktem mniej wygląda
    // równie wiarygodnie. Próba jest tu celowo szersza niż pasmo (halfBand 2
    // przy dwudziestu remisujących wartościach), więc gdyby model odrzucał
    // punkty bez miejsca, ten test by to złapał.
    const dane = Array.from({ length: 20 }, () => 5);
    const model = beeswarmModel(wejscie(dane), { spanRadii: 100, halfBandRadii: 2 });
    expect(model.drawn).toBe(20);
    expect(model.observations).toBe(20);
    expect(model.honesty.pointCountOk).toBe(true);
    expect(model.swarms[0].points).toHaveLength(20);
  });

  it("liczy obserwacje osobno w każdym roju i sumuje je w modelu", () => {
    // Bez tego rój pusty albo krótszy potrafiłby przesunąć liczenie w innych
    // rojach (wspólny licznik, indeks liczony globalnie) i suma kontrolna
    // punktów przestawałaby cokolwiek znaczyć.
    const model = beeswarmModel({
      categories: ["a", "b", "c"],
      series: [seria("x", [1, 2, 3]), seria("y", [4, null, 6]), seria("z", [null, null, null])],
    });
    expect(model.swarms.map((s) => s.n)).toEqual([3, 2, 0]);
    expect(model.drawn).toBe(5);
    expect(model.honesty.pointCountOk).toBe(true);
    expect(model.honesty.emptySwarms).toEqual(["z"]);
  });
});

describe("beeswarm: rozsuwanie nie pozwala punktom się nakładać", () => {
  it("trzyma każdą parę na odległości co najmniej dwóch promieni", () => {
    // To jest CEL tego rodzaju: nakładające się punkty zaniżają widzianą
    // liczebność dokładnie tam, gdzie dane są najgęstsze, więc rozkład
    // wygląda na płaski w miejscu, w którym ma szczyt. Odległość liczymy tu
    // własnym, pełnym przeglądem par, a nie polem `noOverlap` - inaczej
    // sprawdzalibyśmy tylko zgodność modelu z samym sobą.
    const dane = Array.from({ length: 40 }, (_v, i) => Math.round(Math.sin(i) * 5 * 10) / 10);
    const model = beeswarmModel(wejscie(dane), { spanRadii: 30, halfBandRadii: 40 });
    expect(najmniejszaOdleglosc(model)).toBeGreaterThan(POINT_CLEARANCE_RADII - 1e-6);
    expect(model.honesty.noOverlap).toBe(true);
  });

  it("nie nakłada punktów nawet wtedy, gdy rój nie mieści się w pasmie", () => {
    // Cicha nakładka jest tu gorsza od jawnego przepełnienia: obrazek
    // wyglądałby poprawnie i nikt nie dowiedziałby się, że gęstość jest
    // zaniżona. Model ma zamiast tego podnieść flagę i zostawić punkty
    // rozsunięte - to sprawdzamy jednocześnie.
    const dane = Array.from({ length: 30 }, () => 1);
    const model = beeswarmModel(wejscie(dane), { spanRadii: 50, halfBandRadii: 3 });
    expect(model.honesty.fitsInBand).toBe(false);
    expect(model.honesty.noOverlap).toBe(true);
    expect(najmniejszaOdleglosc(model)).toBeGreaterThan(POINT_CLEARANCE_RADII - 1e-6);
  });

  it("milczy o nakładaniu, gdy żadna para nie jest dość blisko", () => {
    // Konwencja repo: `null` znaczy NIE MA CZEGO SPRAWDZAĆ. Zaświadczanie
    // "nic się nie nakłada" na jednej obserwacji byłoby prawdą pustą i mieszało
    // sprawdzony algorytm z brakiem czego sprawdzać.
    const jeden = beeswarmModel(wejscie([7]));
    expect(jeden.honesty.noOverlap).toBeNull();
    const rozstrzelone = beeswarmModel(wejscie([0, 100]), { spanRadii: 100 });
    expect(rozstrzelone.honesty.noOverlap).toBeNull();
  });
});

describe("beeswarm: determinizm", () => {
  it("daje ten sam obrazek dla tego samego zestawu", () => {
    // Repo zabrania `Math.random`, ale tu chodzi o coś więcej: zrzut ekranu
    // z wpisu musi zgadzać się z wpisem, a dwa przeliczenia tego samego bloku
    // nie mogą różnić się bez powodu w danych. Bez tego testu wystarczyłoby
    // niestabilne sortowanie remisów, żeby obrazek zmieniał się przy każdym
    // renderze.
    const dane = [3, 1, 2, 2, 5, 1, 4, 2];
    const a = beeswarmModel(wejscie(dane), { spanRadii: 12, halfBandRadii: 10 });
    const b = beeswarmModel(wejscie(dane), { spanRadii: 12, halfBandRadii: 10 });
    expect(b).toEqual(a);
  });

  it("porządkuje punkty rosnąco po wartości i rozstrzyga remisy indeksem", () => {
    // Wynik rozsuwania zależy od KOLEJNOŚCI stawiania punktów, więc kolejność
    // musi być funkcją danych, a nie kolejności wpisania. Drugi klucz
    // (indeks źródłowy) jest tu tym, co czyni ją jednoznaczną dla remisów -
    // bez niego dwie implementacje `sort` mogłyby dać dwa różne obrazki.
    const model = beeswarmModel(wejscie([5, 1, 5, 1]), { spanRadii: 8, halfBandRadii: 10 });
    const punkty = model.swarms[0].points;
    expect(punkty.map((p) => p.value)).toEqual([1, 1, 5, 5]);
    expect(punkty.map((p) => p.sourceIndex)).toEqual([1, 3, 0, 2]);
  });
});

describe("beeswarm: geometria kolumny remisów", () => {
  it("układa identyczne wartości w kolumnę co dwa promienie, symetrycznie", () => {
    // Trzy obserwacje o tej samej wartości nie mają na osi wartości ani
    // milimetra luzu, więc muszą stanąć jedna nad drugą dokładnie w styku
    // kół - stąd 0, -2, +2. Liczby wynikają ze styku dwóch kół o promieniu
    // jeden, a nie z wyboru implementacji; symetria wynika z reguły remisu
    // (strona ujemna pierwsza), dzięki której rój nie ucieka w jedną stronę.
    const model = beeswarmModel(wejscie([4, 4, 4]), { spanRadii: 10, halfBandRadii: 10 });
    expect(model.swarms[0].points.map((p) => p.offset)).toEqual([0, -2, 2]);
    expect(model.swarms[0].points.every((p) => p.valueRadii === 0)).toBe(true);
  });

  it("nie rozsuwa punktów, które i tak są dalej niż dwa promienie", () => {
    // Przesunięcie w poprzek jest zabiegiem czytelności, więc stosuje się je
    // TYLKO tam, gdzie jest konieczne. Rozsuwanie punktów, które się nie
    // nakładają, dawałoby rój szeroki bez powodu i sugerowało strukturę
    // w drugim wymiarze, której dane nie mają.
    const model = beeswarmModel(wejscie([0, 50, 100]), { spanRadii: 100 });
    expect(model.swarms[0].points.map((p) => p.offset)).toEqual([0, 0, 0]);
  });
});

describe("beeswarm: pasmo, przepełnienie i podpowiedź promienia", () => {
  it("nazywa roje, które nie zmieściły się w pasmie", () => {
    // "Zbyt wiele obserwacji na dostępną szerokość" ma być FLAGĄ, nie cichym
    // nakładaniem - render dostaje wtedy wybór: zmniejszyć promień albo
    // zmienić rodzaj. Bez tej flagi decyzję podjęłoby za niego rozsuwanie,
    // i podjęłoby ją źle.
    const model = beeswarmModel(
      {
        categories: ["a", "b"],
        series: [
          seria(
            "ciasny",
            Array.from({ length: 24 }, () => 1),
          ),
          seria("luźny", [1, 2]),
        ],
      },
      { spanRadii: 40, halfBandRadii: 4 },
    );
    expect(model.honesty.overflowSwarms).toEqual(["ciasny"]);
    expect(model.swarms[0].fitsInBand).toBe(false);
    expect(model.swarms[1].fitsInBand).toBe(true);
  });

  it("podaje korektę promienia w przedziale (0, 1] i nigdy jej nie zeruje", () => {
    // Korekta idzie do renderu jako mnożnik promienia. Zero albo liczba
    // ujemna oznaczałaby punkt o zerowym albo odwróconym promieniu, czyli
    // niewidoczny punkt - a to jest gorsze niż przepełnione pasmo, bo
    // obserwacja znika z obrazka bez śladu.
    const model = beeswarmModel(wejscie(Array.from({ length: 30 }, () => 2)), {
      spanRadii: 40,
      halfBandRadii: 3,
    });
    expect(model.radiusScaleToFit).toBeGreaterThan(0);
    expect(model.radiusScaleToFit).toBeLessThan(1);
    const mieszczacy = beeswarmModel(wejscie([1, 5, 9]), { spanRadii: 40, halfBandRadii: 8 });
    expect(mieszczacy.radiusScaleToFit).toBe(1);
  });

  it("dzieli oś kategorii na równe pasma i podaje całe pasmo do trafień", () => {
    // Strefa trafienia nigdy nie jest kształtem elementu (sekcja 6): punkt
    // o promieniu 3 px jest nietrafialny kursorem i niedostępny z klawiatury,
    // więc render potrzebuje CAŁEGO pasma roju, a nie samych kół.
    const model = beeswarmModel({
      categories: ["a"],
      series: [seria("x", [1]), seria("y", [2]), seria("z", [3])],
    });
    expect(model.swarms.map((s) => s.center)).toEqual([1 / 6, 0.5, 5 / 6]);
    expect(model.swarms[1].band).toEqual({ start: 1 / 3, end: 2 / 3 });
  });

  it("oznacza punkty wystające z pasma całym kołem, nie środkiem", () => {
    // Punkt, którego środek jeszcze mieści się w pasmie, wystaje z niego
    // krawędzią i zostaje ucięty - a ucięty punkt to obserwacja pokazana
    // częściowo. Dlatego warunek liczy |offset| + 1, nie |offset|.
    const model = beeswarmModel(wejscie([1, 1, 1]), { spanRadii: 10, halfBandRadii: 2.5 });
    const przy2 = model.swarms[0].points.filter((p) => Math.abs(p.offset) === 2);
    expect(przy2.length).toBeGreaterThan(0);
    expect(przy2.every((p) => p.insideBand)).toBe(false);
  });
});

describe("beeswarm: dane z bazy nie mogą wysadzić modelu", () => {
  it("nie rzuca i milczy na pustej serii", () => {
    // Blok z bazy może mieć serię bez ani jednej liczby (kategorie wklejone
    // z arkusza, wartości jeszcze nieuzupełnione). Model nie ma wtedy czego
    // sprawdzać, więc wszystkie pola uczciwości są `null` - nie `true`, bo
    // zaświadczanie na pustym zbiorze jest prawdą pustą i uczy ignorowania
    // ostrzeżeń.
    const model = beeswarmModel({ categories: [], series: [] });
    expect(model.observations).toBe(0);
    expect(model.honesty.pointCountOk).toBeNull();
    expect(model.honesty.valuesPreserved).toBeNull();
    expect(model.honesty.noOverlap).toBeNull();
    expect(model.honesty.spreadOk).toBeNull();
    expect(model.honesty.fitsInBand).toBeNull();
    expect(model.honesty.offsetsFinite).toBeNull();
    expect(beeswarmFormAdvice(model)).toEqual([]);
  });

  it("traktuje samą lukę jak brak pomiaru, a nie jak zero", () => {
    // Zero jest POMIAREM i weszłoby do rozkładu, dokładając punkt w miejscu,
    // którego dane nie potwierdzają, oraz przesuwając medianę i średnią.
    const model = beeswarmModel(wejscie([null, null, null]));
    expect(model.observations).toBe(0);
    expect(model.missing).toBe(3);
    expect(model.swarms[0].points).toEqual([]);
    expect(model.swarms[0].summary).toBeNull();
  });

  it("traktuje nieskończoność i nieliczbę jak lukę", () => {
    // `Infinity` w arkuszu bierze się z dzielenia przez zero w formule
    // autora. Wpuszczony do rozkładu rozciągałby domenę do nieskończoności
    // i cała reszta punktów siadałaby na jednej krawędzi.
    const model = beeswarmModel(wejscie([1, Number.POSITIVE_INFINITY, 3, Number.NaN]));
    expect(model.observations).toBe(2);
    expect(model.missing).toBe(2);
    expect(model.swarms[0].points.map((p) => p.value)).toEqual([1, 3]);
  });

  it("nie produkuje NaN ani nieskończoności przy zerowym i ujemnym spanie", () => {
    // TWARDE WYMAGANIE, nie higiena: `spanRadii` przychodzi z renderu, który
    // liczy je z szerokości pola, a ta bywa zerem w pierwszym przebiegu
    // layoutu albo liczbą ujemną po odjęciu marginesów od zbyt małego pola.
    // Bez osłony mianownika model oddawał NaN w każdej pozycji, a bramka
    // `blockMatrix` sprawdza `textContent` bloków na napis "NaN".
    for (const span of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
      const model = beeswarmModel(wejscie([1, 2, 2, 3]), { spanRadii: span });
      expect(model.spanRadii).toBe(BEESWARM_DEFAULT_SPAN_RADII);
      expect(zbierzLiczby(model).every((n) => Number.isFinite(n))).toBe(true);
    }
    for (const pasmo of [0, -3, Number.NaN]) {
      const model = beeswarmModel(wejscie([1, 2, 2, 3]), { halfBandRadii: pasmo });
      expect(model.halfBandRadii).toBe(BEESWARM_DEFAULT_HALF_BAND_RADII);
      expect(zbierzLiczby(model).every((n) => Number.isFinite(n))).toBe(true);
    }
  });

  it("nie produkuje NaN przy jednej obserwacji i przy zerowej rozpiętości", () => {
    // Zerowa rozpiętość domeny to dzielenie zera przez zero w przeliczeniu
    // wartości na promienie - klasyczne miejsce, z którego NaN wychodzi na
    // stronę jako słowo. Jedna obserwacja jest tym samym przypadkiem, tylko
    // trudniejszym do zauważenia, bo wykres wygląda sensownie.
    for (const dane of [[42], [7, 7, 7, 7], [0, 0]]) {
      const model = beeswarmModel(wejscie(dane));
      const liczby = zbierzLiczby(model).concat(zbierzLiczby(beeswarmTable(model)));
      expect(liczby.every((n) => Number.isFinite(n))).toBe(true);
    }
  });

  it("nie wypuszcza napisów NaN, undefined ani [object Object]", () => {
    // Dokładnie te trzy napisy sprawdza bramka `blockMatrix` na
    // `textContent` bloków, bo każdy z nich powstaje z niedomkniętej
    // arytmetyki albo z obiektu wstawionego tam, gdzie miał być tekst.
    const model = beeswarmModel(
      { categories: ["a", "b"], series: [seria("x", [1, null]), seria("", [2, 2])] },
      { spanRadii: 4, halfBandRadii: 1 },
    );
    const napisy = zbierzNapisy(model).concat(zbierzNapisy(beeswarmTable(model)));
    for (const s of napisy) {
      expect(s).not.toContain("NaN");
      expect(s).not.toContain("undefined");
      expect(s).not.toContain("[object Object]");
    }
  });

  it("znosi wartości ujemne, bo pozycja na osi je unosi", () => {
    // Beeswarm koduje wartość POZYCJĄ, nie długością, więc wartość ujemna
    // jest tu w pełni legalna - inaczej niż w słupku. Model nie ma prawa jej
    // obcinać ani przenosić na zero.
    const model = beeswarmModel(wejscie([-5, -1, 0, 3]), { spanRadii: 40 });
    expect(model.domain).toEqual({ min: -5, max: 3 });
    expect(model.swarms[0].points.map((p) => p.value)).toEqual([-5, -1, 0, 3]);
    expect(model.swarms[0].summary?.min).toBe(-5);
  });

  it("zawija slot palety poza zakresem, bo slotu za ostatnim nie ma", () => {
    // Slot z bazy może być z przyszłej wersji edytora albo zwyczajnie
    // popsuty. Slot o numerze wyższym niż `MAX_COLOR_SLOT` nie istnieje w palecie,
    // więc render sięgnąłby po `undefined` i punkt zostałby bez koloru.
    // Numer bierzemy ze stałej, bo paleta rośnie, a reguła zostaje ta sama.
    const model = beeswarmModel({
      categories: ["a"],
      series: [seria("x", [1], MAX_COLOR_SLOT + 1), seria("y", [2], 0), seria("z", [3], -4)],
    });
    for (const roj of model.swarms) {
      expect(roj.colorSlot).toBeGreaterThanOrEqual(1);
      expect(roj.colorSlot).toBeLessThanOrEqual(MAX_COLOR_SLOT);
    }
  });

  it("czyta blok w domyślnym kształcie konfiguracji bez żadnego nowego pola", () => {
    // Beeswarm musi umieć zbudować się z tego, co silnik JUŻ ma - inaczej
    // każdy istniejący blok w bazie renderowałby się jako pusty wykres.
    const config = { ...defaultChartConfig(), categories: ["a", "b", "c"] };
    const puste = beeswarmModelFromConfig(config);
    expect(puste.swarms.length).toBe(config.series.length);
    expect(zbierzLiczby(puste).every((n) => Number.isFinite(n))).toBe(true);

    const zDanymi = beeswarmModelFromConfig({
      ...config,
      series: [seria("x", [1, 2, 3])],
      sampleSize: 3,
    });
    expect(zDanymi.observations).toBe(3);
    expect(zDanymi.honesty.declaredSampleSizeOk).toBe(true);
  });
});

describe("beeswarm: sprawdzenia danych autora", () => {
  it("wykrywa rozjazd między zadeklarowanym n a liczbą wierszy w arkuszu", () => {
    // Realny defekt: podpis mówi "n = 300", bo tyle ankiet zebrano, a w bloku
    // siedzi 12 wierszy, bo ktoś wkleił próbkę. Wtedy wykres i podpis mówią
    // o dwóch różnych badaniach, a czytelnik nie ma jak tego zauważyć.
    const zgodny = beeswarmModel(wejscie([1, 2, 3], { sampleSize: 3 }));
    expect(zgodny.honesty.declaredSampleSizeOk).toBe(true);
    const rozjazd = beeswarmModel(wejscie([1, 2, 3], { sampleSize: 300 }));
    expect(rozjazd.honesty.declaredSampleSizeOk).toBe(false);
  });

  it("milczy o zadeklarowanym n, gdy nie ma czego z nim porównać", () => {
    // `sampleSize` jest liczbą obserwacji NA SERIĘ, więc przy grupowaniu po
    // kategoriach nie ma czego z nią porównać - a zaświadczanie zgodności
    // w takim trybie byłoby zgadywaniem, nie sprawdzeniem.
    const bezDeklaracji = beeswarmModel(wejscie([1, 2, 3]));
    expect(bezDeklaracji.honesty.declaredSampleSizeOk).toBeNull();
    const poKategoriach = beeswarmModel(
      { categories: ["a", "b"], series: [seria("x", [1, 2])], sampleSize: 2 },
      { groupBy: "category" },
    );
    expect(poKategoriach.honesty.declaredSampleSizeOk).toBeNull();
  });

  it("nazywa brak rozproszenia, bo bez niego nie ma rozkładu", () => {
    // Rój o jednej wartości zwija się w prostą kolumnę punktów. To nie jest
    // błąd renderu, tylko właściwość danych - i trzeba ją NAZWAĆ, bo inaczej
    // słowo "rozkład" w podpisie zostaje bez treści.
    const bez = beeswarmModel(wejscie([9, 9, 9, 9]));
    expect(bez.honesty.spreadOk).toBe(false);
    expect(beeswarmFormAdvice(bez)).toContain("noSpread");
    const z = beeswarmModel(wejscie([9, 10]));
    expect(z.honesty.spreadOk).toBe(true);
  });

  it("wykrywa domenę, która ucina część obserwacji", () => {
    // Render może dostać domenę wymuszoną przez autora albo policzoną z innej
    // serii. Punkt poza domeną zostaje ucięty krawędzią rysunku, czyli jest
    // obserwacją niepokazaną - a to jest ten sam gatunek defektu co ucięta oś.
    const model = beeswarmModel(wejscie([1, 5, 50]), { domain: { min: 0, max: 10 } });
    expect(model.honesty.domainCoversData).toBe(false);
    expect(model.swarms[0].points.map((p) => p.insideDomain)).toEqual([true, true, false]);
    const pelna = beeswarmModel(wejscie([1, 5, 9]), { domain: { min: 0, max: 10 } });
    expect(pelna.honesty.domainCoversData).toBe(true);
  });

  it("podaje udział remisów jako liczbę, bo remis nie jest defektem", () => {
    // Remisy są właściwością danych (oceny w skali 1-5, wartości zaokrąglone
    // do pełnych procentów), ale są przyczyną pęcznienia roju niezależną od
    // liczebności. Flaga zamiast liczby kazałaby renderowi zgadywać, czy
    // przepełnienie bierze się z liczby obserwacji, czy z ziarna danych.
    const model = beeswarmModel(wejscie([1, 1, 2, 3]));
    expect(model.honesty.tiedShare).toBe(0.5);
    expect(beeswarmModel(wejscie([1, 2, 3])).honesty.tiedShare).toBe(0);
  });

  it("odrzuca domenę odwróconą i wraca do zakresu danych", () => {
    // Domena z `max` mniejszym od `min` odwróciłaby oś, czyli pokazała
    // rozkład w lustrze - a wtedy "więcej" jest po lewej i każdy wniosek
    // z wykresu wychodzi odwrotny.
    const model = beeswarmModel(wejscie([1, 2, 3]), { domain: { min: 10, max: 0 } });
    expect(model.domain).toEqual({ min: 1, max: 3 });
    expect(model.honesty.domainCoversData).toBe(true);
  });
});

describe("beeswarm: tryby odczytu arkusza", () => {
  it("czyta arkusz transponowany, gdy rojem jest kategoria", () => {
    // Ten sam arkusz da się wpisać w dwie strony i żadna nie jest błędem.
    // Bez trybu `category` autor arkusza transponowanego dostawałby po jednej
    // obserwacji na rój, czyli wykres bez rozkładu.
    const model = beeswarmModel(
      {
        categories: ["kraj A", "kraj B"],
        series: [seria("2024", [1, 10]), seria("2025", [2, 20]), seria("2026", [3, 30])],
      },
      { groupBy: "category" },
    );
    expect(model.groupBy).toBe("category");
    expect(model.swarms.map((s) => s.label)).toEqual(["kraj A", "kraj B"]);
    expect(model.swarms[0].points.map((p) => p.value)).toEqual([1, 2, 3]);
    expect(model.swarms[0].points.map((p) => p.label)).toEqual(["2024", "2025", "2026"]);
  });

  it("dzieli wspólną domenę między roje, a nie liczy jej per rój", () => {
    // Rój z własną skalą byłby tym samym błędem co dwie osie Y: relacja
    // wizualna między grupami zależałaby od dobranych zakresów, a nie od
    // danych. Wspólna domena jest tu warunkiem porównywalności.
    const model = beeswarmModel({
      categories: ["a", "b"],
      series: [seria("mała", [1, 2]), seria("duża", [100, 200])],
    });
    expect(model.domain).toEqual({ min: 1, max: 200 });
    expect(model.swarms[0].points[0].valueRadii).toBe(0);
    expect(model.swarms[1].points[1].valueRadii).toBe(model.spanRadii);
  });
});

describe("beeswarm: zakres osi i porada formy", () => {
  it("nie dociąga osi wartości do zera", () => {
    // Beeswarm koduje wartość pozycją, nie długością, więc zero nie musi być
    // w domenie (sekcja 8). Dociągnięcie osi płac od zera zepchnęłoby cały
    // rozkład w jeden pasek u krawędzi i zniszczyło to, po co ten wykres jest.
    const model = beeswarmModel(wejscie([1200, 1250, 1310]));
    expect(beeswarmExtent(model)).toEqual({ min: 1200, max: 1310 });
  });

  it("oddaje neutralny zakres, gdy nie ma ani jednej obserwacji", () => {
    // Render dzieli przez rozpiętość zakresu przy rysowaniu osi, więc zakres
    // musi być JAKIŚ także dla pustego bloku - inaczej pusty wykres wysadza
    // stronę zamiast pokazać puste pole.
    expect(beeswarmExtent(beeswarmModel({ categories: [], series: [] }))).toEqual({
      min: 0,
      max: 1,
    });
  });

  it("mówi, że próba jest za mała na rozkład", () => {
    // Dwie obserwacje to nie rozkład, to dwie liczby - w tekście czytają się
    // lepiej. Próg jest niski celowo: mała próba jest tym przypadkiem,
    // w którym beeswarm bije histogram, więc nie wolno go ustawić wysoko.
    const male = beeswarmModel(wejscie([1, 2]));
    expect(male.swarms[0].n).toBeLessThan(BEESWARM_MIN_OBSERVATIONS);
    expect(beeswarmFormAdvice(male)).toContain("tooFew");
    expect(beeswarmFormAdvice(beeswarmModel(wejscie([1, 2, 3])))).not.toContain("tooFew");
  });

  it("mówi, że obserwacji jest za wiele, żeby widzieć je osobno", () => {
    // Beeswarm obiecuje jedno: widać każdą obserwację. Powyżej progu punkty
    // stykają się na całej wysokości pasma, chmura zlewa się w kształt
    // i obietnica przestaje być prawdziwa - wtedy histogram albo skrzynka
    // mówią to samo czytelniej.
    const duzy = beeswarmModel(
      wejscie(Array.from({ length: BEESWARM_MAX_COMFORT + 1 }, (_v, i) => i)),
      { spanRadii: 300, halfBandRadii: 40 },
    );
    expect(duzy.swarms[0].crowded).toBe(true);
    expect(duzy.honesty.crowdedSwarms).toEqual(["grupa"]);
    expect(beeswarmFormAdvice(duzy)).toContain("tooMany");
  });

  it("mówi, że rozsunięcie nie mieści się w miejscu, które dostało", () => {
    // To nie jest wada danych ani modelu, tylko za mało miejsca na tyle
    // obserwacji. Porada formy jest tu drugą, jawną drogą do tej samej
    // informacji co flaga `fitsInBand`, bo decyzję podejmuje autor, nie kod.
    const model = beeswarmModel(wejscie(Array.from({ length: 20 }, () => 3)), {
      spanRadii: 50,
      halfBandRadii: 2,
    });
    expect(beeswarmFormAdvice(model)).toContain("doesNotFit");
  });

  it("mówi o przycięciu sufitem punktów", () => {
    // Sufit chroni wątek renderujący przed próbą z importu CSV, ale skutkiem
    // jest obrazek z mniejszą liczbą punktów niż w danych - i to musi być
    // widoczne, a nie schowane w wydajności.
    const model = beeswarmModel(wejscie([1, 2, 3, 4, 5, 6]), { maxPoints: 2 });
    expect(beeswarmFormAdvice(model)).toContain("truncated");
    expect(model.honesty.truncatedSwarms).toEqual(["grupa"]);
  });
});

describe("beeswarm: alternatywa tekstowa", () => {
  it("oddaje komplet pozycyjny, a nie samą średnią", () => {
    // Kolumna "Czego unikać" zabrania przy rozkładzie "średniej bez
    // rozproszenia", a podpis pod wykresem jest miejscem, w którym ten błąd
    // popełnia się najłatwiej: jedna liczba na dole i sprawa zamknięta.
    // Kwartyle pinujemy na próbie 1..8, bo dla niej metoda `linear-r7` daje
    // liczby podane w dokumentacji metody (2,75 / 4,5 / 6,25).
    const model = beeswarmModel(wejscie([1, 2, 3, 4, 5, 6, 7, 8]));
    const tabela = beeswarmTable(model);
    expect(tabela.groups[0].summary).toEqual({
      n: 8,
      missing: 0,
      min: 1,
      q1: 2.75,
      median: 4.5,
      q3: 6.25,
      max: 8,
      mean: 4.5,
      iqr: 3.5,
    });
    expect(tabela.quantileMethod).toBe("linear-r7");
  });

  it("wypisuje KAŻDĄ obserwację, bo tyle samo widać na obrazku", () => {
    // Beeswarm obiecuje, że widać każdą obserwację, więc tabela musi unieść
    // tę samą obietnicę - inaczej czytelnik, który nie widzi obrazka (ekran
    // czytający, wydruk w skali szarości), dostaje mniej informacji niż ten,
    // który go widzi.
    const model = beeswarmModel({
      categories: ["Polska", "Czechy", "Węgry"],
      series: [seria("2026", [3, 1, 2])],
    });
    const tabela = beeswarmTable(model);
    expect(tabela.total).toBe(model.drawn);
    expect(tabela.groups[0].observations).toEqual([
      { label: "Czechy", value: 1 },
      { label: "Węgry", value: 2 },
      { label: "Polska", value: 3 },
    ]);
  });

  it("milczy o streszczeniu pustego roju i nie udaje zer", () => {
    // Zera w kolumnie mediany dla grupy bez obserwacji czytają się jak
    // pomiar. `null` znaczy "nie ma czego pokazać" i tylko to.
    const tabela = beeswarmTable(beeswarmModel(wejscie([null, null])));
    expect(tabela.groups[0].summary).toBeNull();
    expect(tabela.groups[0].observations).toEqual([]);
    expect(tabela.total).toBe(0);
  });

  it("liczy braki per rój, żeby podpis mógł je podać obok n", () => {
    // Liczba luk jest częścią opisu próby: dziesięć wierszy z czterema
    // brakami to inna próba niż sześć wierszy pełnych, choć rój wygląda
    // identycznie.
    const tabela = beeswarmTable(beeswarmModel(wejscie([1, null, 3, null, 5])));
    expect(tabela.groups[0].n).toBe(3);
    expect(tabela.groups[0].missing).toBe(2);
    expect(tabela.groups[0].summary?.missing).toBe(2);
  });
});

describe("beeswarm: kwantyl ma JEDNĄ definicję, wspólną ze `stats.ts`", () => {
  it("nie cofa pierwszego kwartyla do najmniejszej obserwacji przy końcach rzędu 1e308", () => {
    // KONTRPRZYKŁAD Z DOWODU, uruchomiony przez model. Kopia kwantyla w tym
    // module interpolowała różnicą (`a + (b-a)*f`), a `b - a` dla tych czterech
    // liczb wychodzi poza podwójną precyzję; osłona `fin(..., a)` cofała wtedy
    // wynik do `a`, więc tabela danych i nazwa dostępna roju dostawały
    // pierwszy kwartyl RÓWNY -1e308 zamiast 5e+307 - liczbę wyglądającą
    // dokładnie tak wiarygodnie jak policzona z danych.
    const komplet = beeswarmModel(wejscie([-1e308, 1e308, 1e308, 1e308])).swarms[0].summary;
    expect(komplet?.q1).toBe(5e307);
    expect(komplet?.median).toBe(1e308);
    expect(komplet?.q3).toBe(1e308);
    expect(komplet?.iqr).toBe(5e307);
  });

  it("liczy medianę dwóch środkowych obserwacji, choć ich różnica przepełnia", () => {
    // Ta próba ma medianę dokładnie zero (środek między -1e308 i 1e308) i to
    // jest jedyna poprawna odpowiedź. Wzór z różnicą dawał tu `Infinity`,
    // osłona cofała wynik do dolnej obserwacji i model orzekał medianę
    // -1e308, czyli podawał jako środek próby jej najmniejszą obserwację.
    // Zero jest tu POLICZONE, a nie podstawione - mieszanie
    // `a*(1-t) + b*t` nie ma czym przepełnić.
    const komplet = beeswarmModel(wejscie([-1e308, -1e308, 1e308, 1e308])).swarms[0].summary;
    expect(komplet?.median).toBe(0);
    expect(komplet?.q1).toBe(-1e308);
    expect(komplet?.q3).toBe(1e308);
  });

  it("podaje te same kwartyle co wspólna `quantile`", () => {
    // Rozjazd między modelem a wspólną definicją jest defektem samym w sobie:
    // ten sam szereg pokazywałby wtedy inny kwartyl w roju i inny w skrzynce,
    // choć oba podpisy mówią „linear-r7". Cztery kopie wzoru w tym silniku
    // nie były powielonym kodem, tylko czterema definicjami.
    const dane = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3];
    const posortowane = [...dane].sort((a, b) => a - b);
    const komplet = beeswarmModel(wejscie(dane)).swarms[0].summary;
    expect(komplet?.q1).toBe(quantile(posortowane, 0.25));
    expect(komplet?.median).toBe(quantile(posortowane, 0.5));
    expect(komplet?.q3).toBe(quantile(posortowane, 0.75));
  });

  it("nie gubi ani jednego pola kompletu pozycyjnego, choćby dane były skrajne", () => {
    // KOMPLET POZYCYJNY JEST DROGĄ CZYTELNIKA EKRANU DO LICZB: render składa
    // z `BEESWARM_SUMMARY_COLUMNS` nazwę dostępną roju i nagłówki tabeli,
    // a chmury punktów nie odczyta ani ekran czytający, ani wydruk w skali
    // szarości. Wspólna `quantile` milczy `null`-em, a model zamienia to
    // milczenie na `summary: null` - czyli na rój bez ani jednej liczby
    // pozycyjnej. Ten test pinuje, że dla danych, które model wpuszcza
    // (wyłącznie liczby skończone), komplet nie znika, a KOLUMNY POZYCYJNE
    // są policzalne zawsze: mieszanie nie wychodzi poza `[a, b]`, a oba
    // końce są z założenia zapisywalne.
    //
    // ROZSTĘP JEST TU JEDYNYM WYJĄTKIEM I JEST NIM Z ARYTMETYKI, nie
    // z niedbałości: `q3 - q1` dla kwartyli po przeciwnych krańcach zakresu
    // double przekracza podwójną precyzję, więc model o nim MILCZY. Kiedyś
    // stało tam `fin(q3 - q1)`, czyli ZERO - i ten test przechodził właśnie
    // dlatego, że zero jest liczbą skończoną. Pinujemy więc obie rzeczy
    // naraz: że kolumna nie znika bez powodu i że powodem nie wolno być
    // zeru, które czyta się jako rozkład zdegenerowany.
    const proby = [
      [5],
      [0, 0],
      [7, 7, 7, 7],
      [-1e308, 1e308, 1e308, 1e308],
      [-1e308, -1e308, 1e308, 1e308],
      [Number.MIN_VALUE, 1e308],
      [-1.5e308 / 2, 1.5e308 / 2],
    ];
    for (const dane of proby) {
      const komplet = beeswarmModel(wejscie(dane)).swarms[0].summary;
      expect(komplet).not.toBeNull();
      for (const kolumna of BEESWARM_SUMMARY_COLUMNS) {
        if (kolumna === "iqr") continue;
        expect(Number.isFinite(komplet?.[kolumna])).toBe(true);
      }
      const posortowane = [...dane].sort((a, b) => a - b);
      const q1 = quantile(posortowane, 0.25) ?? 0;
      const q3 = quantile(posortowane, 0.75) ?? 0;
      if (Number.isFinite(q3 - q1)) {
        expect(komplet?.iqr).toBe(q3 - q1);
      } else {
        // Milczenie, a nie zero: zero orzekałoby brak rozproszenia o próbie
        // rozpiętej na cały zakres podwójnej precyzji.
        expect(komplet?.iqr).toBeNull();
        expect(komplet?.iqr).not.toBe(0);
      }
    }
  });
});
