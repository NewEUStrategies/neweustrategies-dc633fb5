// Model rodzaju "liniowy na indeksie, baza = 100". Ten plik pinuje
// ZACHOWANIE, nie implementację: liczby pinujemy tam, gdzie wynikają
// z definicji indeksu (`v / baza * 100`) albo z konwencji Tukeya, a wszędzie
// indziej sprawdzamy własności, które muszą zostać prawdziwe po każdej
// przebudowie - wspólność okresu bazowego, zachowanie wartości źródłowych
// i to, że model NIGDY nie produkuje NaN ani nieskończoności.
//
// Dwie grupy są w tym pliku najważniejsze. Pierwsza to "okres bazowy
// odstający": pilnuje ona rozstrzygnięcia, że ostrzeżenie odpala ogrodzenie
// Tukeya, a nie próg na stosunku bazy do mediany - bez tego testu ktoś
// "uprości" warunek do stosunku i wykres zacznie ostrzegać o każdym rosnącym
// szeregu. Druga to "dane z bazy": treść bloku przychodzi z bazy i może być
// z wersji edytora, której ten kod nie zna, a bramka `blockMatrix` sprawdza
// `textContent` bloków na obecność napisu "NaN" - `Intl.NumberFormat` na NaN
// zwraca literalnie "NaN", więc jedno nieosłonięte dzielenie wychodzi na
// stronie jako tekst.
//
// KWANTYL I OGRODZENIE SPRAWDZAMY PARYTETEM ZE `stats.ts`, a nie liczbami
// przepisanymi ręcznie. Wynik wpisany na sztywno przechodzi także wtedy, gdy
// model liczy kwantyl własną kopią wzoru - bo dwie definicje typu 7
// (`a + (b-a)*t` i `a*(1-t) + b*t`) zgadzają się na danych spokojnych
// i rozjeżdżają dopiero na skrajnych. Parytet pada w chwili, w której model
// przestaje liczyć TĄ SAMĄ funkcją, co skrzynka, więc pilnuje rzeczy, o którą
// tu chodzi, zamiast pilnować jednej próby.
import { describe, expect, it } from "vitest";
import {
  INDEX_BASE_COLUMNS,
  INDEX_BASE_COMPARABLE_RATIO,
  INDEX_BASE_FENCE_IQR_FACTOR,
  INDEX_BASE_FENCE_MIN_POINTS,
  INDEX_BASE_MAX_PERIODS,
  INDEX_BASE_VALUE,
  indexBaseExtent,
  indexBaseFormAdvice,
  indexBaseModel,
  indexBaseModelFromConfig,
  indexBaseTable,
  type IndexBaseModel,
} from "@/lib/charts/kinds/indexBase";
import { defaultChartConfig } from "@/lib/charts/parse";
import { INDEX_BASE, quantile } from "@/lib/charts/stats";
import { CATEGORICAL_SAFE_SERIES } from "@/lib/charts/types";
import type { ChartConfig, ChartSeries } from "@/lib/charts/types";

function seria(name: string, values: (number | null)[], colorSlot = 1): ChartSeries {
  return { name, values, colorSlot };
}

function config(over: Partial<ChartConfig>): ChartConfig {
  return { ...defaultChartConfig(), ...over };
}

/** Pięć okresów, dwa szeregi o skali różniącej się o dwa rzędy wielkości. */
const OKRESY = ["2019", "2020", "2021", "2022", "2023"];
const PKB = seria("PKB", [500, 480, 520, 545, 560], 1);
const INFLACJA = seria("Inflacja", [1.4, 0.9, 3.4, 12.3, 6.2], 2);

/** Wszystkie liczby w modelu, także zagnieżdżone w seriach i ogrodzeniach. */
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

describe("indeks - wspólna baza zamiast dwóch osi Y", () => {
  it("linia odniesienia i mnożnik ilorazu to JEDNA liczba, nie dwie zgodne", () => {
    // Dopóki setka stała w tym pliku własną stałą, a druga siedziała wpisana
    // we wzorze indeksowania, były to dwie niezależne liczby, które zgadzały
    // się wyłącznie dlatego, że autor wpisał tę samą cyfrę dwa razy. Rozjazd
    // nie wyglądałby na błąd: wykres rysowałby się normalnie, tylko linia
    // odniesienia leżałaby gdzie indziej niż punkt startu serii.
    expect(INDEX_BASE_VALUE).toBe(INDEX_BASE);
    const model = indexBaseModel({ categories: OKRESY, series: [PKB] });
    expect(model.baseline).toBe(INDEX_BASE);
    expect(model.series[0].indexed[0]).toBe(INDEX_BASE);
  });

  it("przelicza każdą serię na v / baza * 100", () => {
    // Gdyby model oddawał poziomy, dwa szeregi o skali różniącej się
    // stukrotnie wymagałyby dwóch osi Y - a wtedy relacja wizualna między
    // nimi zależy od dobranych zakresów, czyli od autora, a nie od danych.
    // Tu obie linie startują w setce i czytelnik porównuje TEMPO.
    const model = indexBaseModel({ categories: OKRESY, series: [PKB, INFLACJA] });
    // Porównanie z tolerancją, bo model NIE ZAOKRĄGLA: 545 / 500 * 100 daje
    // w podwójnej precyzji 109,00000000000001, a zaokrąglanie w modelu byłoby
    // decyzją o WYŚWIETLANIU podjętą w miejscu, które o wyświetlaniu nic nie
    // wie - liczbę do pokazania formatuje `format.ts` i on jeden ma prawo
    // ucinać miejsca po przecinku.
    const oczekiwane = [100, 96, 104, 109, 112];
    for (let i = 0; i < oczekiwane.length; i++) {
      expect(model.series[0].indexed[i]).toBeCloseTo(oczekiwane[i], 10);
    }
    expect(model.series[1].indexed[0]).toBe(100);
    expect(model.series[1].indexed[2]).toBeCloseTo(242.857, 3);
    expect(model.indexedCount).toBe(2);
  });

  it("okres bazowy jest JEDEN dla wszystkich serii", () => {
    // Baza liczona per seria to dokładnie to samo kłamstwo co dwie osie Y,
    // tylko trudniejsze do zauważenia: czytelnik widzi jedną linię
    // odniesienia w stu i nie ma z czego wywnioskować, że dwa szeregi
    // startują z różnych momentów. Tu wspólny okres bazowy jest jedną liczbą
    // i w wierszu bazowym KAŻDA seria na rysunku ma dokładnie sto.
    const model = indexBaseModel({ categories: OKRESY, series: [PKB, INFLACJA] }, { baseAt: 2 });
    expect(model.baseAt).toBe(2);
    expect(model.baseLabel).toBe("2021");
    expect(model.series.every((s) => s.indexed[2] === INDEX_BASE_VALUE)).toBe(true);
    // Baza serii jest jej WŁASNĄ wartością w tym okresie - to jedyna rzecz,
    // która różni się między seriami.
    expect(model.series.map((s) => s.base)).toEqual([520, 3.4]);
  });

  it("domyślnym okresem bazowym jest PIERWSZY, i model to nazywa", () => {
    // Wybór bazy jest wyborem analitycznym, więc musi być widoczny w podpisie
    // (`baseSource`). Bez tego pola czytelnik nie wie, czy okres bazowy
    // wybrał autor, czy silnik.
    const model = indexBaseModel({ categories: OKRESY, series: [PKB] });
    expect(model.baseAt).toBe(0);
    expect(model.baseSource).toBe("first");
    // Nikt bazy nie żądał, więc nie ma czego sprawdzać - model milczy.
    expect(model.honesty.baseInRangeOk).toBeNull();
    expect(model.honesty.baseNamedOk).toBe(true);
  });

  it("żądanie okresu bazowego spoza zakresu jest DOCISKANE I ZGŁASZANE", () => {
    // Ciche dociśnięcie znaczy, że podpis mówi "2019 = 100", a rysunek liczy
    // od innego roku - i nie widać tego nigdzie. Dlatego rozjazd żądania
    // z użytym okresem jest osobnym polem uczciwości.
    const model = indexBaseModel({ categories: OKRESY, series: [PKB] }, { baseAt: 99 });
    expect(model.baseAt).toBe(4);
    expect(model.honesty.baseInRangeOk).toBe(false);
    expect(
      indexBaseModel({ categories: OKRESY, series: [PKB] }, { baseAt: 1 }).honesty.baseInRangeOk,
    ).toBe(true);
  });

  it("kolejność serii NIE jest przestawiana", () => {
    // W tornadzie kolejność jest częścią formy, tu jest odwrotnie: kolejność
    // serii jest kolejnością legendy (sekcja 4 wymaga legendy w kolejności
    // szeregów, nie alfabetycznej). Sortowanie po tempie rozjechałoby legendę
    // z podpisami przy końcach linii.
    const model = indexBaseModel({
      categories: OKRESY,
      series: [INFLACJA, PKB],
    });
    expect(model.series.map((s) => s.name)).toEqual(["Inflacja", "PKB"]);
    expect(model.series.map((s) => s.index)).toEqual([0, 1]);
  });

  it("luka zostaje luką, a nie zerem i nie interpolacją", () => {
    // Zero wpadłoby do indeksu jako spadek do zera, którego nie zmierzono,
    // a interpolacja postawiłaby punkt w miejscu bez pomiaru. Linia ma się
    // przerwać - i to render robi z `null`.
    const model = indexBaseModel({
      categories: OKRESY,
      series: [seria("Z luką", [200, null, 240, null, 260])],
    });
    expect(model.series[0].indexed).toEqual([100, null, 120, null, 130]);
    expect(model.series[0].missing).toBe(2);
    expect(model.series[0].n).toBe(3);
  });
});

describe("indeks - uczciwość: baza nieindeksowalna", () => {
  it("baza równa zeru odrzuca serię z nazwaną przyczyną, a nie podstawia jedynki", () => {
    // Podstawienie cichej jedynki dałoby indeks, który wygląda jak każdy inny,
    // a znaczy "wartość razy sto" - czytelnik odczytałby z niego wzrost
    // o tysiące procent. Bez odrzucenia z nazwaną przyczyną w tabeli byłoby
    // "∞" albo "NaN".
    const model = indexBaseModel({
      categories: OKRESY,
      series: [PKB, seria("Od zera", [0, 5, 10, 15, 20], 2)],
    });
    expect(model.series[1].rejection).toBe("zeroBase");
    expect(model.series[1].indexable).toBe(false);
    expect(model.series[1].indexed.every((v) => v === null)).toBe(true);
    // Wartości źródłowe ZOSTAJĄ - tabela tekstowa musi pokazać oba odczyty.
    expect(model.series[1].source).toEqual([0, 5, 10, 15, 20]);
    expect(model.honesty.baseUsableOk).toBe(false);
    expect(model.honesty.noBaseSeries).toEqual(["Od zera"]);
    expect(indexBaseFormAdvice(model)).toContain("seriesDropped");
  });

  it("brak wartości w okresie bazowym to inna przyczyna niż zero", () => {
    // Autor musi wiedzieć, CO zrobić: przy braku wartości przestawia okres
    // bazowy, przy zerze zmienia szereg albo formę. Jeden wspólny komunikat
    // nie mówi ani jednego, ani drugiego.
    const model = indexBaseModel({
      categories: OKRESY,
      series: [seria("Późny start", [null, 10, 12, 14, 16])],
    });
    expect(model.series[0].rejection).toBe("missingBase");
    expect(model.firstUsableBaseAt).toBe(1);
  });

  it("baza ujemna jest odrzucana, bo ODWRACAŁABY kierunek", () => {
    // Dzielenie przez liczbę ujemną jest legalne arytmetycznie i właśnie
    // dlatego jest tu groźne: pogłębiający się deficyt dałby rosnący indeks,
    // więc wykres pokazywałby wzrost tam, gdzie jest spadek. To samo
    // rozstrzygnięcie stoi w modelu paneli.
    const model = indexBaseModel({
      categories: OKRESY,
      series: [seria("Saldo", [-100, -120, -140, -160, -180])],
    });
    expect(model.series[0].rejection).toBe("negativeBase");
    expect(model.series[0].indexed.every((v) => v === null)).toBe(true);
    expect(indexBaseFormAdvice(model)).toEqual(["baseUnusable"]);
  });

  it("gdy nie da się zaindeksować NICZEGO, porada jest jedna i mówi, który okres wybrać", () => {
    // Lista ostrzeżeń pod wykresem, którego nie ma, uczy ignorowania
    // wszystkich ostrzeżeń. Zostaje jedno - a bez `firstUsableBaseAt` porada
    // "wybierz inny okres bazowy" nie mówi, który okres wybrać, czyli jest
    // bezużyteczna.
    const model = indexBaseModel({
      categories: ["I", "II", "III"],
      series: [seria("A", [0, 4, 8]), seria("B", [null, 9, 18], 2)],
    });
    expect(model.indexedCount).toBe(0);
    expect(indexBaseFormAdvice(model)).toEqual(["baseUnusable"]);
    expect(model.firstUsableBaseAt).toBe(1);
  });

  it("seria PUSTA nie jest odrzucona - jej po prostu nie ma", () => {
    // Seria dopisana w edytorze i jeszcze niewypełniona to świadomy stan
    // pracy autora, a nie defekt danych. Ostrzeżenie "seria wypadła
    // z rysunku" byłoby wtedy ostrzeżeniem o niczym i przyzwyczajałoby do
    // ignorowania tych prawdziwych.
    const model = indexBaseModel({
      categories: OKRESY,
      series: [seria("Puste", [null, null, null, null, null]), PKB],
    });
    expect(model.series[0].rejection).toBeNull();
    expect(model.droppedCount).toBe(0);
    expect(model.honesty.baseUsableOk).toBe(true);
    expect(model.honesty.noBaseSeries).toEqual([]);
  });

  it("iloraz spoza podwójnej precyzji gubi PUNKT, a nie kłamie o nim zerem", () => {
    // Baza rzędu 1e-320 przy wartości rzędu 1e10 daje indeks poza zakresem
    // liczb. Zapora sprowadzająca nieskończoność do zera postawiłaby punkt na
    // dnie osi, czyli skłamała o liczbie zamiast o niej zamilczeć.
    const model = indexBaseModel({
      categories: ["baza", "potem"],
      series: [seria("Mikrobaza", [1e-320, 1e10])],
    });
    expect(model.series[0].indexed[0]).toBe(100);
    expect(model.series[0].indexed[1]).toBeNull();
    expect(model.series[0].unrepresentable).toBe(1);
    expect(model.honesty.indexRepresentableOk).toBe(false);
    expect(model.honesty.unrepresentableSeries).toEqual(["Mikrobaza"]);
  });

  it("szereg przechodzący przez zero jest zgłaszany, nie ukrywany", () => {
    // Indeks -50 nie czyta się jako "spadek o 50%", więc przy szeregu
    // zmieniającym znak odczyt "procent bazy" przestaje być czytelny - choć
    // arytmetycznie zostaje poprawny. Model podaje fakt, rozstrzyga autor.
    const model = indexBaseModel({
      categories: ["I", "II", "III"],
      series: [seria("Marża", [4, -2, 3])],
    });
    expect(model.series[0].indexed).toEqual([100, -50, 75]);
    expect(model.series[0].mixedSign).toBe(true);
    expect(model.honesty.signStableOk).toBe(false);
    expect(indexBaseFormAdvice(model)).toContain("mixedSign");
  });

  it("liczba bez swojego okresu na osi jest policzona, nie przemilczana", () => {
    // Wartość za ostatnią kategorią nie ma czym być opisana, więc nie ma jej
    // ani na rysunku, ani w tabeli. Bez tego licznika czytelnik nie
    // dowiedziałby się, że część szeregu zniknęła.
    const model = indexBaseModel({
      categories: ["I", "II"],
      series: [seria("Dłuższa", [10, 20, 30, 40])],
    });
    expect(model.periodCount).toBe(2);
    expect(model.honesty.droppedValueCount).toBe(2);
    expect(model.honesty.pointsInPeriodsOk).toBe(false);
  });

  it("rozjazd zadeklarowanego n z liczbą okresów jest wykrywany", () => {
    // Sekcja 8 każe podać n w podpisie. Jeżeli autor wpisze 300, a w bloku
    // siedzi pięć okresów, to podpis kłamie o próbce - i jest to rozjazd
    // wykrywalny arytmetycznie, więc się go wykrywa.
    const wejscie = { categories: OKRESY, series: [PKB] };
    expect(indexBaseModel(wejscie, { declaredSampleSize: 5 }).honesty.declaredSampleOk).toBe(true);
    expect(indexBaseModel(wejscie, { declaredSampleSize: 300 }).honesty.declaredSampleOk).toBe(
      false,
    );
    expect(indexBaseModel(wejscie).honesty.declaredSampleOk).toBeNull();
  });

  it("przy zerze danych model MILCZY, a nie zaświadcza", () => {
    // Konwencja repo: `null` znaczy "nie ma czego sprawdzać". Gdyby pola
    // wychodziły tu jako `true`, model twierdziłby, że sprawdził indeks,
    // którego nie ma - i pod pustym wykresem nie byłoby ani jednego
    // ostrzeżenia.
    const model = indexBaseModel({ categories: OKRESY, series: [] });
    expect([
      model.honesty.baseUsableOk,
      model.honesty.baseTypicalOk,
      model.honesty.indexRepresentableOk,
      model.honesty.signStableOk,
      model.honesty.spreadOk,
      model.honesty.pointsInPeriodsOk,
      model.honesty.declaredSampleOk,
    ]).toEqual([null, null, null, null, null, null, null]);
    expect(indexBaseFormAdvice(model)).toEqual([]);
  });
});

describe("indeks - uczciwość: okres bazowy odstający", () => {
  it("rok kryzysowy jako baza wyolbrzymia cały indeks i jest zgłaszany", () => {
    // To jest sedno tego sprawdzenia: jeden zły rok bazowy i wszystkie
    // szeregi "rosną o 300%". Bez ostrzeżenia czytelnik odczyta z rysunku
    // skok, który jest artefaktem wyboru bazy, a nie zdarzeniem w danych.
    const model = indexBaseModel(
      {
        categories: ["a", "b", "c", "d", "e", "f"],
        series: [seria("Ruch", [100, 98, 20, 99, 101, 102])],
      },
      { baseAt: 2 },
    );
    expect(model.series[0].base).toBe(20);
    expect(model.series[0].baseIsExtreme).toBe(true);
    expect(model.series[0].baseToMedian).toBeCloseTo(0.201, 3);
    expect(model.honesty.baseTypicalOk).toBe(false);
    expect(model.honesty.extremeBaseSeries).toEqual(["Ruch"]);
    expect(indexBaseFormAdvice(model)).toContain("extremeBase");
    // Indeks jest policzony mimo ostrzeżenia: model nie odmawia rysunku,
    // tylko nazywa jego wadę.
    expect(model.series[0].indexed[0]).toBe(500);
  });

  it("szereg silnie rosnący NIE jest ostrzegany, choć baza jest daleko od mediany", () => {
    // NAJWAŻNIEJSZY TEST W TYM PLIKU. Próg na samym stosunku bazy do mediany
    // odpaliłby tutaj (0,25), a ostrzeżenie byłoby fałszywe: pierwszy okres
    // jest bazą poprawną, a odczyt "1600" jako "szesnaście razy więcej niż
    // w bazie" jest prawdą i jest tym, po co ten wykres się rysuje.
    // Ostrzeżenie, które widać zawsze, uczy ignorowania wszystkich ostrzeżeń.
    const model = indexBaseModel({
      categories: ["a", "b", "c", "d", "e"],
      series: [seria("Wzrost", [100, 200, 400, 800, 1600])],
    });
    expect(model.series[0].baseToMedian).toBeCloseTo(0.25, 10);
    expect(model.series[0].baseIsExtreme).toBe(false);
    expect(model.honesty.baseTypicalOk).toBe(true);
    expect(indexBaseFormAdvice(model)).not.toContain("extremeBase");
  });

  it("ogrodzenie liczy się z tego samego kwantyla, co skrzynka", () => {
    // Rozstęp międzykwartylowy policzony inną metodą niż na skrzynce dałby
    // ostrzeżenie, którego autor nie umiałby odtworzyć w arkuszu - a wtedy
    // ostrzeżenie brzmi jak kaprys silnika.
    //
    // PARYTET, A NIE LICZBY WPISANE NA SZTYWNO. Wcześniej stały tu wyniki
    // przepisane ręcznie (45 oraz 432,5 i 612,5) i taki test przechodził
    // także wtedy, gdy model liczył kwantyl WŁASNYM wzorem - bo na próbie
    // spokojnej `a + (b-a)*t` i `a*(1-t) + b*t` dają to samo. Rozjazd, który
    // trzeba złapać, jest dokładnie taki: dwie definicje zgodne na danych
    // łagodnych i rozjeżdżające się na skrajnych. Dlatego oczekiwanie liczy
    // się TĄ SAMĄ funkcją, której używa skrzynka, i test pada w chwili,
    // w której model dorobi sobie kopię kwantyla.
    const probka = [480, 500, 520, 545, 560];
    const model = indexBaseModel({
      categories: ["a", "b", "c", "d", "e"],
      series: [seria("Szereg", probka)],
    });
    const posortowana = [...probka].sort((a, b) => a - b);
    const q1 = quantile(posortowana, 0.25);
    const q3 = quantile(posortowana, 0.75);
    if (q1 === null || q3 === null) {
      throw new Error("kwartyle pięcioelementowej próby skończonej muszą być liczbami");
    }
    expect(model.series[0].median).toBe(quantile(posortowana, 0.5));
    expect(model.series[0].iqr).toBe(q3 - q1);
    expect(model.series[0].fence).toEqual({
      lower: q1 - INDEX_BASE_FENCE_IQR_FACTOR * (q3 - q1),
      upper: q3 + INDEX_BASE_FENCE_IQR_FACTOR * (q3 - q1),
    });
  });

  it("ogrodzenie spoza podwójnej precyzji MILCZY, zamiast ogłaszać granice zerowe", () => {
    // KONTRPRZYKŁAD, PRZEZ KTÓRY TEN MODEL SIĘ ZMIENIŁ. Przy q1 = -5e307
    // i q3 = 5e307 rozstęp wynosi 1e308 i JEST skończony, więc sprawdzenie
    // samego rozstępu przepuszczało szereg dalej - a obie granice przepełniały
    // się dopiero po pomnożeniu przez 1,5 i zapora wyświetlania mapowała je
    // na zero. Model orzekał wtedy ogrodzeniem `{ lower: 0, upper: 0 }`, a to
    // nie jest awaria, którą ktoś zauważy: zero jest legalną granicą, wobec
    // której KAŻDA baza różna od zera jest odstająca. Ta seria dostawała przez
    // to `baseIsExtreme`, `extremeBaseSeries` i poradę "extremeBase" bez
    // jednego powodu w danych.
    const model = indexBaseModel({
      categories: ["a", "b", "c", "d", "e"],
      series: [seria("Skrajna", [5e307, -1e308, -5e307, 0, 1e308])],
    });
    const s = model.series[0];
    // Seria JEST na rysunku i indeks jest policzony - milczy samo ogrodzenie,
    // a nie cały model. Inaczej test przechodziłby też dla serii odrzuconej.
    expect(s.indexable).toBe(true);
    expect(s.indexed).toEqual([100, -200, -100, 0, 200]);
    // Rozstęp jest skończony i dlatego sprawdzenie go NIE wystarczało.
    expect(s.iqr).toBe(1e308);
    expect(s.fence).toBeNull();
    // Pole per-seria nie przeczy agregatowi: nie ma orzeczenia ani tu, ani tam.
    expect(s.baseIsExtreme).toBe(false);
    expect(s.notes).not.toContain("extremeBase");
    expect(model.honesty.baseTypicalOk).toBeNull();
    expect(model.honesty.extremeBaseSeries).toEqual([]);
    expect(indexBaseFormAdvice(model)).not.toContain("extremeBase");
  });

  it("przy próbie poniżej progu model o odstawaniu MILCZY", () => {
    // Przy trzech obserwacjach kwartyle są interpolacjami między dwiema
    // sąsiednimi liczbami, więc ogrodzenie wynika z arytmetyki wzoru, a nie
    // z danych. Autor przestawiałby okres bazowy z powodu, którego w danych
    // nie ma.
    const model = indexBaseModel({
      categories: ["a", "b", "c"],
      series: [seria("Krótki", [10, 50, 90])],
    });
    expect(model.series[0].n).toBeLessThan(INDEX_BASE_FENCE_MIN_POINTS);
    expect(model.series[0].fence).toBeNull();
    expect(model.series[0].iqr).toBeNull();
    expect(model.series[0].baseIsExtreme).toBe(false);
    expect(model.honesty.baseTypicalOk).toBeNull();
  });

  it("odstawanie orzeka się tylko dla serii, która jest na rysunku", () => {
    // Seria odrzucona nie ma indeksu, który baza mogłaby wyolbrzymić,
    // a przyczynę jej wypadnięcia mówi już `rejection`. Dwa ostrzeżenia o tej
    // samej serii z dwóch różnych powodów to szum.
    const model = indexBaseModel(
      {
        categories: ["a", "b", "c", "d", "e"],
        series: [seria("Zero w bazie", [0, 98, 99, 100, 101])],
      },
      { baseAt: 0 },
    );
    expect(model.series[0].rejection).toBe("zeroBase");
    expect(model.series[0].baseIsExtreme).toBe(false);
    expect(model.honesty.baseTypicalOk).toBeNull();
  });
});

describe("indeks - jednostka i zakres osi", () => {
  it("jednostka wyniku NIE jest jednostką wejścia", () => {
    // Iloraz dwóch wartości w mld EUR nie jest w mld EUR. Oś podpisana
    // jednostką wejścia byłaby zdaniem fałszywym o każdej liczbie na rysunku,
    // więc `unit` modelu jest twardym `null`, a jednostka autora jedzie
    // osobnym polem tylko do kolumny wartości źródłowych.
    const model = indexBaseModel({ categories: OKRESY, series: [PKB] }, { sourceUnit: " mld EUR" });
    expect(model.unit).toBeNull();
    expect(model.sourceUnit).toBe(" mld EUR");
    expect(model.valueEncodes).toBe("index");
    expect(indexBaseTable(model).indexUnit).toBeNull();
  });

  it("zakres osi ZAWSZE obejmuje linię odniesienia", () => {
    // Oś, która setki nie zawiera, pokazuje odchylenia bez punktu, od którego
    // są liczone - ten sam argument stoi za linią bazową tornada. Tu cały
    // szereg leży pod bazą, a sto zostaje w zakresie.
    const model = indexBaseModel({
      categories: ["a", "b", "c"],
      series: [seria("Spadek", [200, 120, 80])],
    });
    const zakres = indexBaseExtent(model);
    expect(zakres.min).toBe(40);
    expect(zakres.max).toBe(INDEX_BASE_VALUE);
  });

  it("oś indeksu NIE jest dociągana do zera, ale ucięcie jest NAZWANE", () => {
    // Sekcja 8 wymaga zera dla znaczników kodujących długość, a indeks jest
    // linią, czyli koduje położenie. Wymuszenie zera zepchnęłoby zmienność
    // między 96 a 112 w górne dziesięć procent osi, czyli oś "uczciwa" dałaby
    // rysunek mówiący "nic się nie działo".
    const model = indexBaseModel({ categories: OKRESY, series: [PKB] });
    expect(indexBaseExtent(model).min).toBe(96);
    expect(model.axisTruncatedFromZero).toBe(true);
  });

  it("model bez ani jednego punktu ma zakres skończony", () => {
    // Zakres [Infinity, -Infinity] z pustego zwijania wyszedłby na stronę
    // jako "∞" na podziałce osi.
    const zakres = indexBaseExtent(indexBaseModel({ categories: [], series: [] }));
    expect(zakres).toEqual({ min: INDEX_BASE_VALUE, max: INDEX_BASE_VALUE });
  });
});

describe("indeks - doradzanie formy", () => {
  it("indeks JEDNEJ serii nie wnosi nic", () => {
    // Indeksowanie jest przekształceniem liniowym, więc kształt linii jest
    // ten sam co przy poziomach - czytelnik traci jednostkę i poziom, a nie
    // dostaje w zamian ani jednego porównania.
    expect(indexBaseFormAdvice(indexBaseModel({ categories: OKRESY, series: [PKB] }))).toContain(
      "singleSeries",
    );
    expect(
      indexBaseFormAdvice(indexBaseModel({ categories: OKRESY, series: [PKB, INFLACJA] })),
    ).not.toContain("singleSeries");
  });

  it("szeregi tego samego rzędu wielkości nie potrzebują indeksu", () => {
    // Przesłanki z tabeli doboru form ("kilka szeregów o różnej skali") nie
    // ma, a indeks kosztuje jednostkę i poziom. Porada, nie zakaz: model
    // nadal liczy indeks, bo porównywanie tempa jest poprawnym powodem.
    const bliskie = indexBaseModel({
      categories: ["a", "b"],
      series: [seria("A", [10, 11]), seria("B", [12, 13], 2)],
    });
    expect(bliskie.levelRatio).toBeLessThan(INDEX_BASE_COMPARABLE_RATIO);
    expect(indexBaseFormAdvice(bliskie)).toContain("scaleComparable");
    expect(bliskie.series.every((s) => s.indexable)).toBe(true);

    const rozne = indexBaseModel({ categories: OKRESY, series: [PKB, INFLACJA] });
    expect(rozne.levelRatio).toBeGreaterThan(INDEX_BASE_COMPARABLE_RATIO);
    expect(indexBaseFormAdvice(rozne)).not.toContain("scaleComparable");
  });

  it("wszystkie linie na linii odniesienia to informacja na jedno zdanie", () => {
    // Rysunek, na którym nic nie odchodzi od setki, nie mówi nic, czego nie
    // powiedziałoby jedno zdanie - a wygląda jak wykres, więc czytelnik szuka
    // na nim treści.
    const model = indexBaseModel({
      categories: ["a", "b", "c"],
      series: [seria("Stała", [7, 7, 7]), seria("Też stała", [9, 9, 9], 2)],
    });
    expect(model.honesty.spreadOk).toBe(false);
    expect(model.series[0].notes).toContain("flat");
    expect(indexBaseFormAdvice(model)).toContain("noSpread");
  });

  it("płaskość mierzy się progiem widoczności, nie porównaniem do setki", () => {
    // Różnica 0,04 punktu indeksu jest w tabeli i w tooltipie tym samym
    // napisem co równe sto, więc nie jest zmiennością. Dokładne porównanie
    // uznawałoby za zmienność błąd zaokrąglenia na ostatnich bitach.
    const model = indexBaseModel({
      categories: ["a", "b"],
      series: [seria("Prawie stała", [10000, 10003])],
    });
    expect(model.series[0].indexed[1]).toBeCloseTo(100.03, 10);
    expect(model.honesty.spreadOk).toBe(false);
    expect(model.series[0].notes).toContain("flat");
  });

  it("jeden okres pokazuje definicję indeksu, nie dane", () => {
    // Przy jednym okresie każda seria ma indeks dokładnie sto. Rysunek jest
    // wtedy ilustracją wzoru.
    const model = indexBaseModel({
      categories: ["2023"],
      series: [seria("A", [5]), seria("B", [9], 2)],
    });
    expect(indexBaseFormAdvice(model)).toContain("shortSeries");
  });

  it("powyżej zestawu bezpiecznego dla daltonizmu odsyła do small multiples", () => {
    // Sekcja 2: powyżej pięciu-sześciu kolorów kategorialnych kolor przestaje
    // nieść kategorię. Druga forma z tego samego wiersza tabeli doboru
    // (small multiples) nie wydaje koloru na kategorie w ogóle.
    const serie = Array.from({ length: CATEGORICAL_SAFE_SERIES + 1 }, (_, i) =>
      seria(`S${i}`, [10 + i, 20 + i], i + 1),
    );
    const model = indexBaseModel({ categories: ["a", "b"], series: serie });
    expect(model.indexedCount).toBe(CATEGORICAL_SAFE_SERIES + 1);
    expect(indexBaseFormAdvice(model)).toContain("tooManySeries");
  });
});

describe("indeks - dane z bazy nie wywracają modelu", () => {
  const przypadki: [string, () => IndexBaseModel][] = [
    ["zero serii", () => indexBaseModel({ categories: OKRESY, series: [] })],
    ["zero okresów", () => indexBaseModel({ categories: [], series: [PKB] })],
    ["wszystko puste", () => indexBaseModel({ categories: [], series: [] })],
    ["sama luka", () => indexBaseModel({ categories: OKRESY, series: [seria("L", [null, null])] })],
    ["jeden okres", () => indexBaseModel({ categories: ["x"], series: [seria("A", [3])] })],
    ["baza zerowa", () => indexBaseModel({ categories: ["a", "b"], series: [seria("A", [0, 5])] })],
    [
      "baza ujemna",
      () => indexBaseModel({ categories: ["a", "b"], series: [seria("A", [-4, -8])] }),
    ],
    [
      "wartości ujemne przy dodatniej bazie",
      () => indexBaseModel({ categories: ["a", "b"], series: [seria("A", [4, -8])] }),
    ],
    [
      "wszystkie wartości równe",
      () => indexBaseModel({ categories: ["a", "b", "c"], series: [seria("A", [2, 2, 2])] }),
    ],
    [
      "nieskończoności z zepsutej wersji",
      () =>
        indexBaseModel({
          categories: ["a", "b", "c"],
          series: [seria("A", [Infinity, -Infinity, 5])],
        }),
    ],
    [
      "NaN w szeregu",
      () =>
        indexBaseModel({ categories: ["a", "b", "c"], series: [seria("A", [Number.NaN, 2, 4])] }),
    ],
    [
      "skrajne wielkości",
      () =>
        indexBaseModel({
          categories: ["a", "b", "c", "d", "e"],
          series: [seria("A", [-1e308, 0, 1e308, 1, -1])],
        }),
    ],
    [
      "ogrodzenie poza podwójną precyzją przy skończonym rozstępie",
      () =>
        indexBaseModel({
          categories: ["a", "b", "c", "d", "e"],
          series: [seria("A", [5e307, -1e308, -5e307, 0, 1e308])],
        }),
    ],
    [
      "baza denormalna",
      () => indexBaseModel({ categories: ["a", "b"], series: [seria("A", [1e-320, 1e10])] }),
    ],
    [
      "wartości bliskie sobie",
      () =>
        indexBaseModel({
          categories: ["a", "b", "c"],
          series: [seria("A", [1, 1 + 1e-15, 1 + 2e-15])],
        }),
    ],
    [
      "okres bazowy ułamkowy",
      () => indexBaseModel({ categories: OKRESY, series: [PKB] }, { baseAt: 2.7 }),
    ],
    [
      "okres bazowy ujemny",
      () => indexBaseModel({ categories: OKRESY, series: [PKB] }, { baseAt: -5 }),
    ],
    [
      "okres bazowy nieskończony",
      () => indexBaseModel({ categories: OKRESY, series: [PKB] }, { baseAt: Infinity }),
    ],
    [
      "seria dłuższa od osi",
      () => indexBaseModel({ categories: ["a"], series: [seria("A", [1, 2, 3, 4])] }),
    ],
    [
      "seria krótsza od osi",
      () => indexBaseModel({ categories: OKRESY, series: [seria("A", [1, 2])] }),
    ],
    [
      "slot palety nieliczbowy",
      () => indexBaseModel({ categories: ["a", "b"], series: [seria("A", [1, 2], Number.NaN)] }),
    ],
    [
      "zadeklarowane n nieliczbowe",
      () => indexBaseModel({ categories: OKRESY, series: [PKB] }, { declaredSampleSize: Infinity }),
    ],
  ];

  for (const [nazwa, buduj] of przypadki) {
    it(`nie rzuca i nie produkuje NaN: ${nazwa}`, () => {
      // Twarde wymaganie: bramka `blockMatrix` sprawdza `textContent` bloków
      // na obecność napisów "NaN" i "undefined", a `Intl` na NaN zwraca
      // literalnie "NaN". Jedno nieosłonięte dzielenie wychodzi więc na
      // stronie jako tekst, a nie jako pusty wykres.
      const model = buduj();
      const liczby = zbierzLiczby(model);
      expect(liczby.length).toBeGreaterThan(0);
      expect(liczby.every((v) => Number.isFinite(v))).toBe(true);
      for (const napis of zbierzNapisy(model)) {
        expect(napis).not.toContain("NaN");
        expect(napis).not.toContain("undefined");
        expect(napis).not.toContain("Infinity");
      }
      // Zakres osi jest uporządkowany i obejmuje linię odniesienia - inaczej
      // render dzieliłby przez ujemną rozpiętość albo rysował oś bez punktu
      // odniesienia.
      const zakres = indexBaseExtent(model);
      expect(zakres.max).toBeGreaterThanOrEqual(zakres.min);
      expect(zakres.min).toBeLessThanOrEqual(INDEX_BASE_VALUE);
      expect(zakres.max).toBeGreaterThanOrEqual(INDEX_BASE_VALUE);
      // Tablice mają długość osi - render iteruje po okresach i przy krótszej
      // tablicy odczytywałby `undefined` jako wartość.
      for (const s of model.series) {
        expect(s.source).toHaveLength(model.periodCount);
        expect(s.indexed).toHaveLength(model.periodCount);
        // Seria na rysunku ma w okresie bazowym DOKŁADNIE sto: gdyby miała
        // 99,999, czytelnik zobaczyłby linie startujące z różnych punktów,
        // czyli dokładnie to, czemu wspólna baza ma zapobiegać.
        if (s.indexable && model.baseAt !== null && s.unrepresentable === 0) {
          expect(s.indexed[model.baseAt]).toBe(INDEX_BASE_VALUE);
        }
        // Punkt bez indeksu jest albo luką, albo policzoną stratą - żadna
        // wartość nie znika po cichu.
        const bezIndeksu = s.source.filter((v, i) => v !== null && s.indexed[i] === null).length;
        if (s.indexable) expect(bezIndeksu).toBe(s.unrepresentable);
      }
      expect(indexBaseFormAdvice(model).length).toBeGreaterThanOrEqual(0);
    });
  }

  it("nieliczby są LUKAMI, a nie zerami", () => {
    // Zero w mianowniku albo w liczniku przesunęłoby cały indeks, a brak
    // pomiaru nie jest pomiarem o wartości zero. Wyrzutki z zepsutej wersji
    // edytora (Infinity, NaN) muszą wyjść z szeregu i policzyć się jako luki,
    // żeby n w podpisie zostało prawdziwe.
    const model = indexBaseModel({
      categories: ["a", "b", "c", "d"],
      series: [seria("A", [10, Number.NaN, Infinity, 15])],
    });
    expect(model.series[0].source).toEqual([10, null, null, 15]);
    expect(model.series[0].n).toBe(2);
    expect(model.series[0].missing).toBe(2);
    expect(model.series[0].indexed).toEqual([100, null, null, 150]);
  });

  it("bez etykiet oś ma sufit okresów, a nadmiar jest policzony", () => {
    // Bez sufitu szereg z tysiąca liczb zamówiłby tysiąc okresów, czyli
    // więcej znaczników, niż silnik obsługuje dla kategorii - render
    // narysowałby oś, na której nie da się odczytać ani jednej etykiety.
    // Przycięcie nie jest ciche: nadmiar liczy się jako liczby bez okresu.
    const model = indexBaseModel({
      categories: [],
      series: [
        seria(
          "Długa",
          Array.from({ length: INDEX_BASE_MAX_PERIODS + 10 }, (_, i) => i + 1),
        ),
      ],
    });
    expect(model.periodCount).toBe(INDEX_BASE_MAX_PERIODS);
    expect(model.honesty.droppedValueCount).toBe(10);
    expect(model.honesty.pointsInPeriodsOk).toBe(false);
  });

  it("brak etykiet nie kasuje danych, ale zabiera podpisowi bazę", () => {
    // Odwrotna decyzja - zero okresów przy braku etykiet - usunęłaby
    // z rysunku dane, które autor widzi w arkuszu, i nie dałaby mu żadnej
    // wskazówki, czego brakuje. Tu dane zostają, a model mówi, że okres
    // bazowy nie ma nazwy, więc podpis nie ma czym dokończyć zdania "... = 100".
    const model = indexBaseModel({ categories: [], series: [seria("A", [10, 20, 30])] });
    expect(model.periodCount).toBe(3);
    expect(model.series[0].indexed).toEqual([100, 200, 300]);
    expect(model.baseLabel).toBe("");
    expect(model.honesty.baseNamedOk).toBe(false);
  });
});

describe("indeks - wejście z obecnego kształtu konfiguracji", () => {
  it("czyta okresy z kategorii, a szeregi z serii", () => {
    // Indeks jest wykresem liniowym o przeliczonej osi wartości, a nie
    // osobnym kształtem danych - dlatego nie potrzebuje ani jednego nowego
    // pola w konfiguracji bloku.
    const model = indexBaseModelFromConfig(
      config({
        categories: OKRESY,
        series: [PKB, INFLACJA],
        unit: " mld EUR",
        sampleSize: 5,
      }),
    );
    expect(model.periods).toEqual(OKRESY);
    expect(model.series.map((s) => s.name)).toEqual(["PKB", "Inflacja"]);
    expect(model.series.map((s) => s.colorSlot)).toEqual([1, 2]);
    expect(model.sourceUnit).toBe(" mld EUR");
    expect(model.honesty.declaredSampleOk).toBe(true);
  });

  it("okres bazowy zostaje w opcjach, a nie jest zgadywany z konfiguracji", () => {
    // Zgadywanie bazy (na przykład z pierwszego okresu, w którym wszystkie
    // serie mają dane) dawałoby wykres, który rysuje się normalnie, tylko
    // wszystkie liczby są odniesione do innego roku - a pomyłka nie wygląda
    // na błąd. Wybór bazy jest wyborem analitycznym i musi być jawny.
    const cfg = config({
      categories: OKRESY,
      series: [seria("A", [null, 10, 20, 30, 40])],
    });
    expect(indexBaseModelFromConfig(cfg).series[0].rejection).toBe("missingBase");
    expect(indexBaseModelFromConfig(cfg, { baseAt: 1 }).series[0].indexed).toEqual([
      null,
      100,
      200,
      300,
      400,
    ]);
  });

  it("konfiguracja domyślna daje pusty, milczący model", () => {
    const model = indexBaseModelFromConfig(defaultChartConfig());
    expect(model.series).toEqual([]);
    expect(model.periodCount).toBe(0);
    expect(model.baseAt).toBeNull();
    expect(model.baseSource).toBe("none");
    expect(model.honesty.spreadOk).toBeNull();
    expect(zbierzLiczby(model).every((v) => Number.isFinite(v))).toBe(true);
  });
});

describe("indeks - alternatywa tekstowa", () => {
  it("tabela pokazuje OBA odczyty: wartość źródłową i indeks", () => {
    // Rysunek pokazuje tempo i nie ma na nim ani jednostki, ani poziomu.
    // Gdyby tabela powtarzała sam indeks, wartości źródłowe nie istniałyby
    // w bloku nigdzie - a wtedy indeks nie byłby przeliczeniem, tylko
    // podmianą danych.
    const tabela = indexBaseTable(
      indexBaseModel({ categories: OKRESY, series: [PKB, INFLACJA] }, { sourceUnit: "%" }),
    );
    expect(tabela.columns).toEqual(INDEX_BASE_COLUMNS);
    expect(tabela.rows).toHaveLength(OKRESY.length);
    expect(tabela.rows[1].cells[0]).toEqual({
      seriesIndex: 0,
      series: "PKB",
      source: 480,
      indexed: 96,
    });
    expect(tabela.sourceUnit).toBe("%");
  });

  it("wiersz bazowy jest oznaczony i w nim wszystkie serie mają sto", () => {
    // To jedyne miejsce, w którym czytelnik widzi, wobec czego czyta cały
    // wykres. Bez oznaczenia musiałby szukać wiersza z setkami.
    const tabela = indexBaseTable(
      indexBaseModel({ categories: OKRESY, series: [PKB, INFLACJA] }, { baseAt: 3 }),
    );
    expect(tabela.rows.filter((r) => r.isBase).map((r) => r.label)).toEqual(["2022"]);
    expect(tabela.rows[3].cells.every((c) => c.indexed === INDEX_BASE_VALUE)).toBe(true);
    expect(tabela.baseAt).toBe(3);
    expect(tabela.baseLabel).toBe("2022");
  });

  it("seria odrzucona zostaje w tabeli z wartościami źródłowymi", () => {
    // Dane, których autor nie zobaczy nigdzie, są dla niego tym samym co
    // dane, których nie ma. Wiersz z pustą kolumną indeksu i wypełnioną
    // kolumną źródłową mówi jednocześnie, ile było i dlaczego tego nie ma na
    // rysunku.
    const tabela = indexBaseTable(
      indexBaseModel({
        categories: ["a", "b"],
        series: [seria("Od zera", [0, 5])],
      }),
    );
    expect(tabela.rows.map((r) => r.cells[0].source)).toEqual([0, 5]);
    expect(tabela.rows.map((r) => r.cells[0].indexed)).toEqual([null, null]);
    expect(tabela.series[0].rejection).toBe("zeroBase");
    expect(tabela.series[0].notes).toContain("noBase");
  });

  it("tabela liczy z GOTOWEGO modelu, nie po raz drugi z danych", () => {
    // Gdyby liczyła sama, mogłaby wziąć inną bazę niż rysunek - i czytelnik
    // miałby dwie różne liczby na to samo, co jest gorsze niż brak tabeli.
    const model = indexBaseModel({ categories: OKRESY, series: [PKB, INFLACJA] }, { baseAt: 2 });
    const tabela = indexBaseTable(model);
    for (const row of tabela.rows) {
      for (const cell of row.cells) {
        expect(cell.indexed).toBe(model.series[cell.seriesIndex].indexed[row.period]);
        expect(cell.source).toBe(model.series[cell.seriesIndex].source[row.period]);
      }
    }
    expect(tabela.series.map((s) => s.base)).toEqual(model.series.map((s) => s.base));
  });
});
