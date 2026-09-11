// Model wykresu skrzynkowego (boxplot).
//
// PYTANIE ANALITYCZNE, KTÓREGO DOTYCZY. Tabela doboru formy (sekcja 1
// specyfikacji) stawia go w wierszu "Rozkład wartości", obok histogramu
// i beeswarma, a w kolumnie "Czego unikać" ma jedną pozycję: "średnia bez
// rozproszenia". To jest cała racja bytu tego rodzaju. Jedna liczba na
// kategorię ("średnie wynagrodzenie", "mediana marży", "przeciętny czas
// procedury") wygląda na fakt, a jest streszczeniem, które gubi to, o co
// zwykle pytamy: czy rozkład jest wąski czy szeroki, czy jest skośny, czy są
// obserwacje odstające. Skrzynka pokazuje pięć liczb naraz i dlatego
// odpowiada na pytanie o ROZKŁAD, a nie o poziom.
//
// CZEGO DLA TEGO RODZAJU NIE WOLNO:
//   * nie wolno rysować skrzynki z kilku obserwacji. Skrzynka z czterech
//     liczb udaje statystykę rzędu, której nie ma - dlatego poniżej
//     BOXPLOT_MIN_SAMPLE model MILCZY o kwartylach i oddaje surowe
//     obserwacje do narysowania jako punkty;
//   * nie wolno pokazywać skrzynek obok siebie bez podania `n`. Skrzynka
//     z próby pięciu i z próby pięciuset wygląda identycznie, a znaczy co
//     innego (sekcja 8: "Podaj n") - dlatego model liczy `n` per grupa
//     i porównuje krotność prób między grupami;
//   * nie wolno ukrywać rozkładu zdegenerowanego. IQR równe zeru zwija
//     skrzynkę w linię i taki obrazek wygląda na błąd renderu, a jest
//     właściwością danych - trzeba go NAZWAĆ, nie zamiatać;
//   * nie wolno ciągnąć wąsa do OGRODZENIA (q1 - 1,5*IQR). Ogrodzenie jest
//     progiem obliczonym, a nie zmierzoną wartością; wąs zakończony na
//     ogrodzeniu rysuje obserwację, której nikt nie zmierzył. Wąs kończy się
//     na najbardziej skrajnej obserwacji LEŻĄCEJ WEWNĄTRZ ogrodzenia;
//   * nie wolno milcząco odrzucać obserwacji odstających. Punkt za wąsem
//     zostaje na wykresie i w tabeli - "odstająca" znaczy "leży dalej niż
//     1,5 IQR od skrzynki", a nie "błąd pomiaru".
//
// REGUŁY OGÓLNE, KTÓRE GO DOTYCZĄ:
//   * pozycja na wspólnej skali jest najwyższym kanałem hierarchii
//     percepcyjnej Clevelanda i McGilla, a skrzynka koduje pozycją
//     wszystko, więc kolor niesie tu tylko TOŻSAMOŚĆ grupy i nic więcej
//     (sekcja 2);
//   * grafika nigdy nie jest jedyną drogą do liczby (sekcja 8), dlatego
//     `boxplotTable` oddaje pełny pięcioliczbowy zestaw plus wartości
//     obserwacji odstających - te same liczby, z których powstał rysunek,
//     nie policzone po raz drugi inną metodą;
//   * strefa trafienia nigdy nie jest kształtem elementu (sekcja 6), dlatego
//     model podaje `band`, czyli całe pasmo kolumny, obok samej skrzynki;
//   * hover zmienia stan powierzchni, nigdy kodowanie (sekcja 6): żadne pole
//     tego modelu nie zmienia się pod kursorem, bo wszystkie kodują wartość.
//
// KONWENCJA DANYCH. Silnik daje `categories` i `series` (patrz `../types`),
// czyli JEDNĄ liczbę na przecięciu serii i kategorii. Rozkład potrzebuje
// SUROWYCH OBSERWACJI, więc czytamy ten sam arkusz inaczej: jedna seria to
// jedna grupa, a jej `values` to obserwacje tej grupy. Etykiety kategorii są
// wtedy etykietami wierszy arkusza (numer obserwacji, identyfikator badanego
// podmiotu), a oś kategorii nosi nazwy SERII, bo to one są grupami. Dla
// arkusza transponowanego jest tryb `groupBy: "category"`. Żadne z tych dwóch
// odczytań nie wymaga zmiany schematu bloku; propozycja jawnego pola jest
// w raporcie.
import { quantile } from "../stats";
import type { ChartConfig, ChartSeries } from "../types";

/**
 * METODA INTERPOLACJI KWANTYLI: liniowa interpolacja statystyk pozycyjnych,
 * h = (n - 1) * p, w literaturze typ 7 (Hyndman i Fan 1996).
 *
 * DLACZEGO TA, A NIE ZAWIASY TUKEYA. Różne metody dają na małej próbie RÓŻNE
 * kwartyle i jest to realne, mierzalne źródło rozjazdu między wykresem
 * a tabelą, a nie subtelność akademicka: dla próby [1, 2, 3, 4, 5, 6, 7, 8]
 * typ 7 daje q1 = 2,75, a zawiasy Tukeya (typ 2, mediana dolnej połowy) dają
 * q1 = 2,5. Rozjazd o ćwierć jednostki na wykresie, który ma służyć odczytowi
 * rozkładu, jest defektem, jeśli czytelnik przelicza liczby u siebie
 * i dostaje inne.
 *
 * Wybór jest podyktowany tym, GDZIE czytelnik przelicza. Typ 7 jest domyślny
 * w R (`quantile`), w numpy i pandas (`percentile`, `quantile`) oraz
 * w arkuszach: Excel `PERCENTILE.INC` / `QUARTILE.INC` i Google Sheets
 * `QUARTILE`. Zawiasy Tukeya są historycznie związane z samą formą wykresu,
 * ale nie ma ich w żadnym narzędziu, do którego czytelnik sięgnie, żeby nas
 * sprawdzić. Wybieramy więc metodę WERYFIKOWALNĄ, a nie metodę wierną
 * pierwszej publikacji formy.
 *
 * Konsekwencja, którą trzeba unieść: przy zawiasach Tukeya kwartyle na próbie
 * nieparzystej są zawsze OBSERWACJAMI, przy typie 7 mogą być wartościami
 * interpolowanymi, czyli liczbami, których w danych nie ma. Dlatego nazwa
 * metody jedzie w przypisie pod tabelą (`BoxplotTable.method`), a nie zostaje
 * ukryta w kodzie - czytelnik ma wiedzieć, czym liczyliśmy. Wąsy tego
 * problemu nie mają: ich końce są zawsze obserwacjami i pilnuje tego
 * sprawdzenie `whiskersAreObservations`.
 */
export const QUANTILE_METHOD = "linear-r7";
export type QuantileMethod = typeof QUANTILE_METHOD;

/**
 * Mnożnik IQR dla ogrodzeń wąsów. **To jest KONWENCJA Tukeya (1977), a nie
 * prawo natury.**
 *
 * 1,5 nie wynika z żadnego rozkładu ani z żadnego testu istotności. Tukey
 * podał je jako liczbę wygodną: dla rozkładu normalnego ogrodzenia leżą wtedy
 * około 2,7 odchylenia standardowego od średniej i poza nimi zostaje około
 * 0,7% obserwacji, czyli tyle, żeby "odstająca" znaczyło "rzadka", a nie "co
 * dziesiąta". Przy 1,0 skrzynka wyrzuca za wąsy kilka procent każdej
 * normalnej próby, przy 3,0 przestaje wyrzucać cokolwiek.
 *
 * Wniosek praktyczny jest jeden i jest istotny dla uczciwości wykresu:
 * "obserwacja odstająca" na skrzynce NIE ZNACZY "błąd pomiaru" ani "wartość
 * do usunięcia". Znaczy dokładnie "leży dalej niż 1,5 IQR od skrzynki".
 * Dlatego mnożnik jedzie w przypisie tabeli razem z metodą kwantyli.
 */
export const WHISKER_IQR_FACTOR = 1.5;

/**
 * Drugi próg Tukeya: obserwacje dalej niż 3 IQR od skrzynki. W oryginalnej
 * nomenklaturze "far out" wobec "outside". Rozróżnienie ma sens tam, gdzie
 * ogon jest długi: kilkadziesiąt punktów za wąsem czyta się jako jednolitą
 * chmurę, a dwa z nich mogą leżeć dziesięć razy dalej niż reszta.
 */
export const FAR_OUT_IQR_FACTOR = 3;

/**
 * Próg liczebności, poniżej którego model MILCZY o kwartylach.
 *
 * Pięć obserwacji to minimum, przy którym zestaw pięciu liczb (min, q1,
 * mediana, q3, max) składa się z pięciu RÓŻNYCH pozycji w próbie, czyli
 * skrzynka opisuje rozkład, a nie samą siebie. Przy n = 4 kwartyle typu 7 są
 * interpolacjami między dwiema sąsiednimi obserwacjami i skrzynka pokazuje
 * odstęp między dwiema liczbami przebrany za rozproszenie; przy n = 3 mediana
 * jest środkową obserwacją, a "kwartyle" to punkty w połowie drogi do
 * skrajnych, więc pudło ma szerokość wynikającą z arytmetyki, nie z danych.
 *
 * Zachowanie modelu jest tu takie samo jak przy sumie kontrolnej mostka:
 * skoro nie ma czego policzyć, model nie zgaduje i nie zaświadcza - oddaje
 * surowe obserwacje w `points`, żeby render narysował je jako punkty,
 * i wpisuje grupę do `honesty.smallSamples`, żeby podpis to powiedział.
 */
export const BOXPLOT_MIN_SAMPLE = 5;

/**
 * Poniżej tylu obserwacji na grupę skrzynka nic nie wnosi wobec pokazania
 * wszystkich punktów. To PORADA FORMY, nie próg milczenia.
 *
 * Przy dziesięciu obserwacjach kolumna punktów zajmuje tyle samo miejsca co
 * skrzynka, pokazuje KAŻDĄ wartość i nie wymaga od czytelnika zaufania do
 * metody kwantyli. Skrzynka zaczyna się opłacać, gdy punktów jest więcej, niż
 * oko zliczy - wtedy pięć liczb streszcza to, czego z chmury nie da się
 * odczytać.
 */
export const BOXPLOT_DOTS_BETTER_N = 10;

/**
 * Powyżej tego udziału jednej powtarzającej się wartości skrzynka przestaje
 * opisywać kształt: kwartyle składają się na tej samej liczbie, pudło zwija
 * się albo prawie zwija, a rozkład ma w rzeczywistości gęsty atom w jednym
 * punkcie i ogon. Histogram albo beeswarm pokazują to od razu.
 */
export const BOXPLOT_TIE_DOMINANT_SHARE = 0.5;

/**
 * Krotność, powyżej której próby grup przestają być porównywalne "na oko".
 *
 * Skrzynki stoją obok siebie o tej samej szerokości, więc czytelnik czyta je
 * jako równoważne. Przy n = 6 i n = 600 nie są: wąskie pudło drugiej grupy
 * jest właściwością rozkładu, a szerokie pudło pierwszej w dużej części
 * właściwością próby. Próg dziesięciokrotności jest umowny i wybrany tak, żeby
 * ostrzeżenie nie odpalało na naturalnie nierównych próbach (dwa razy, pięć
 * razy), bo ostrzeżenie, które widać zawsze, uczy ignorowania wszystkich
 * ostrzeżeń - to ta sama decyzja, która w module uczciwości stoi za progiem
 * drzazgi na tarczy kołowej.
 */
export const BOXPLOT_SAMPLE_RATIO_MAX = 10;

/**
 * Szerokość skrzynki jako udział pasma grupy. 0,62 zostawia po obu stronach
 * po ~19% pasma, czyli przerwę wyraźną na tyle, żeby obwódki dwóch sąsiednich
 * skrzynek nie zlały się w fałszywy trzeci kształt (ten sam powód, dla
 * którego pierścień ma przerwę 2,5 px między łukami), i wąską na tyle, żeby
 * pudło pozostało dominującym kształtem kolumny.
 */
export const BOX_WIDTH_RATIO = 0.62;

/**
 * Szerokość poprzeczki na końcu wąsa jako udział szerokości skrzynki. Połowa,
 * bo poprzeczka ma zaznaczyć koniec wąsa, a nie konkurować z krawędzią pudła
 * o rolę granicy odczytu.
 */
export const WHISKER_CAP_RATIO = 0.5;

/**
 * Rozsunięcie punktów o IDENTYCZNEJ wartości, jako udział szerokości
 * skrzynki.
 *
 * Bez rozsunięcia dziesięć obserwacji odstających o tej samej wartości rysuje
 * się jako jedna kropka i wykres pokazuje jedną obserwację tam, gdzie jest
 * dziesięć. Rozsunięcie jest DETERMINISTYCZNE (symetryczne wachlowanie wokół
 * środka), a nie losowe: losowy jitter zmienia obrazek przy każdym renderze,
 * psuje zrzuty i migawki testowe, a przy dwóch punktach potrafi zasugerować
 * różnicę, której nie ma.
 *
 * OŚ POZIOMA W PAŚMIE GRUPY NIE NIESIE ŻADNEJ INFORMACJI i to jest warunek
 * uczciwości tego rozsunięcia. Punkt przesunięty w prawo nie jest "większy",
 * "późniejszy" ani "ważniejszy" - jest tylko widoczny. Dlatego offset zależy
 * wyłącznie od liczności remisu, a nigdy od wartości.
 */
export const TIE_OFFSET_STEP = 0.18;

/** Jak grupujemy obserwacje: seria jest grupą (domyślnie) albo kategoria. */
export type BoxplotGroupBy = "series" | "category";

/**
 * Punkt rysowany osobno: obserwacja odstająca albo obserwacja z próby za
 * małej na kwartyle.
 */
export interface BoxplotPoint {
  /** Wartość w jednostkach danych - pozycja na osi wartości. */
  value: number;
  /**
   * Przesunięcie poziome jako udział szerokości skrzynki, w zakresie
   * [-0,5; 0,5]. Render liczy `x = (center + offset * width) * innerWidth`.
   * Zero dla punktu bez remisu.
   */
  offset: number;
  /**
   * `mild` = poza ogrodzeniem 1,5 IQR, `far` = poza 3 IQR, `raw` = obserwacja
   * z próby poniżej progu (nie jest odstająca, bo nie ma od czego odstawać).
   */
  severity: "mild" | "far" | "raw";
}

/** Jedna skrzynka: jedna grupa obserwacji. */
export interface BoxplotBox {
  /** Pozycja grupy w układzie (0-indeksowana) - decyduje o paśmie. */
  index: number;
  label: string;
  /** Slot palety 1..8. Kolor niesie TOŻSAMOŚĆ grupy i nic więcej. */
  colorSlot: number;
  /** Liczebność próby po odfiltrowaniu luk i wartości nieskończonych. */
  n: number;

  /** Środek pasma grupy jako udział szerokości obszaru kreślenia (0..1). */
  center: number;
  /** Szerokość skrzynki jako udział szerokości obszaru kreślenia. */
  width: number;
  /** Szerokość poprzeczki wąsa jako udział szerokości obszaru kreślenia. */
  capWidth: number;
  /**
   * CAŁE pasmo kolumny (udziały szerokości), do warstwy trafień. Strefa
   * trafienia nigdy nie jest kształtem elementu: skrzynka o zerowym IQR ma
   * wysokość obwódki i jest nietrafialna.
   */
  band: { start: number; end: number };

  /** Skrajne obserwacje. Uczciwe przy każdym n >= 1, więc nie milczą. */
  min: number | null;
  max: number | null;

  /**
   * Pięcioliczbowy zestaw. `null` znaczy NIE MA CZEGO POKAZAĆ (próba pusta
   * albo poniżej `BOXPLOT_MIN_SAMPLE`), a nie "zero".
   */
  q1: number | null;
  median: number | null;
  q3: number | null;
  /**
   * Rozstęp międzykwartylowy - TA SAMA LICZBA I TO SAMO MILCZENIE co `iqr`
   * ze `stats.ts`. `null` znaczy tu także "różnicy `q3 - q1` nie da się
   * zapisać w podwójnej precyzji" (kwartyle po przeciwnych krańcach zakresu
   * double), a nie "rozstęp wynosi zero".
   */
  iqr: number | null;

  /** Końce wąsów - ZAWSZE obserwacje, nigdy ogrodzenia. */
  whiskerLow: number | null;
  whiskerHigh: number | null;
  /**
   * Ogrodzenia Tukeya. Wychodzą z modelu, żeby render mógł je podać
   * w tooltipie danych i żeby tabela mogła powiedzieć, skąd wzięta jest
   * granica odstawania - ale NIE RYSUJE SIĘ ich jako wąsów.
   */
  fenceLow: number | null;
  fenceHigh: number | null;

  /** Obserwacje poza ogrodzeniami, każda osobno. */
  outliers: BoxplotPoint[];
  /**
   * Surowe obserwacje do narysowania jako kolumna punktów - niepuste TYLKO
   * dla próby poniżej progu, bo wtedy skrzynki nie ma.
   */
  points: BoxplotPoint[];

  /** Czy kwartyle mają sens (n >= BOXPLOT_MIN_SAMPLE). */
  hasQuartiles: boolean;
  /**
   * IQR = 0, czyli rozkład zdegenerowany: skrzynka zwija się w linię. Nie
   * jest to błąd modelu ani renderu, tylko właściwość danych - i dlatego ma
   * osobne pole, żeby podpis mógł ją nazwać zamiast pozwolić czytelnikowi
   * uznać zwiniętą skrzynkę za artefakt.
   */
  collapsed: boolean;
  /**
   * Udział najczęstszej wartości w próbie (0..1). Zero dla próby pustej.
   *
   * Liczba dla PORADY FORMY, nie do rysowania: rozkład, w którym jedna
   * wartość zajmuje połowę próby, jest atomem z ogonem, a nie rozkładem
   * ciągłym, i skrzynka pokazuje z niego wyłącznie ogon.
   */
  modeShare: number;
}

/**
 * SPRAWDZENIA UCZCIWOŚCI. Konwencja repo: `null` znaczy NIE MA CZEGO
 * SPRAWDZAĆ (model milczy, nie zaświadcza), `false` znaczy defekt wykryty.
 *
 * Cztery pierwsze pola to SAMOSPRAWDZENIA arytmetyki modelu liczone
 * z surowej próby, a nie z własnego wyniku - gdyby liczyć je z pól modelu,
 * wychodziłyby prawdziwe z definicji i nie mogłyby niczego wykryć. Jeśli
 * którekolwiek wyjdzie `false`, obrazek kłamie o własnych liczbach. Pola
 * dalsze dotyczą DANYCH AUTORA.
 */
export interface BoxplotHonesty {
  /**
   * Mediana leży w skrzynce (q1 <= mediana <= q3) w KAŻDEJ grupie, która ma
   * kwartyle. Mediana poza pudłem to obrazek, na którym linia środkowa leży
   * na krawędzi albo za nią, czyli wprost sprzeczność: pudło miałoby
   * zawierać środkową połowę obserwacji wokół mediany.
   */
  medianInsideBox: boolean | null;
  /**
   * Końce wąsów leżą w zakresie danych ([min, max] próby). Wykrywa
   * najczęstszy błąd implementacji skrzynki: wąs pociągnięty do OGRODZENIA
   * zamiast do obserwacji. Ogrodzenie leży zwykle poza zakresem danych, więc
   * wykres pokazuje wtedy pomiar, którego nie było.
   */
  whiskersInsideData: boolean | null;
  /**
   * Końce wąsów SĄ obserwacjami z próby, a nie dowolnymi liczbami z zakresu.
   * Warunek mocniejszy od poprzedniego i wykrywający cichszy błąd: wąs
   * zatrzymany na interpolacji albo na wartości ogrodzenia, która
   * przypadkiem mieści się w zakresie danych (a mieści się zawsze, gdy IQR
   * jest mały wobec rozstępu).
   */
  whiskersAreObservations: boolean | null;
  /**
   * Podział próby jest zupełny i rozłączny: liczba obserwacji między końcami
   * wąsów plus liczba obserwacji odstających daje dokładnie `n`. Wykrywa
   * i gubienie obserwacji (punkt, który nie zmieścił się ani w wąsie, ani
   * w liście odstających, po prostu znika z wykresu), i liczenie ich dwa
   * razy. To odpowiednik sumy kontrolnej mostka: składniki muszą zamknąć
   * całość.
   */
  outlierPartitionOk: boolean | null;

  /**
   * Czy zadeklarowane w konfiguracji `sampleSize` zgadza się z liczbą
   * obserwacji, które model faktycznie zliczył w każdej niepustej grupie.
   *
   * SPRAWDZAMY DANE AUTORA, NIE WŁASNĄ ARYTMETYKĘ - tak jak suma udziałów na
   * tarczy kołowej. Realny defekt: podpis mówi "n = 300", bo tyle ankiet
   * zebrano, a w arkuszu bloku jest 12 wierszy, bo ktoś wkleił próbkę.
   * Wtedy wykres i podpis mówią o dwóch różnych badaniach. `null` = autor nie
   * zadeklarował, nie ma ani jednej niepustej grupy, albo tryb grupowania nie
   * odpowiada deklaracji (`sampleSize` jest liczbą obserwacji NA SERIĘ, więc
   * przy `groupBy: "category"` nie ma czego z nią porównać).
   */
  declaredSampleSizeOk: boolean | null;
  /** Krotność największej próby wobec najmniejszej. `null` = brak niepustych grup. */
  sampleRatio: number | null;
  /** Czy próby grup są porównywalne (patrz `BOXPLOT_SAMPLE_RATIO_MAX`). */
  sampleSizesBalanced: boolean | null;

  /** Etykiety grup z próbą 1..4 - rysowane punktami, bez skrzynki. */
  smallSamples: string[];
  /**
   * Etykiety grup, w których kwantyl wyszedł NIEPOLICZALNY mimo próby powyżej
   * progu - skrzynki nie ma, obserwacje idą punktami jak przy próbie za małą.
   *
   * OSOBNA LISTA, A NIE `smallSamples`, i to jest cała treść tego pola.
   * Powód milczenia jest tu inny (arytmetyka nie domknęła kwantyla, a nie
   * "za mało obserwacji"), a wpisanie takiej grupy do `smallSamples`
   * powiedziałoby o próbie trzystu obserwacji, że ma ich mniej niż pięć -
   * czyli osłona przestałaby milczeć i zaczęła zaświadczać nieprawdę
   * o danych autora, dokładnie tak jak kwartyl cofnięty do najmniejszej
   * obserwacji przed poprawką `quantileR7`.
   */
  unquantifiableSamples: string[];
  /** Etykiety grup bez ani jednej obserwacji - kolumna zostaje pusta. */
  emptySamples: string[];
  /** Etykiety grup o IQR = 0 - skrzynka zwinięta w linię. */
  collapsedSamples: string[];
}

export interface BoxplotModel {
  boxes: BoxplotBox[];
  honesty: BoxplotHonesty;
  /** Metoda kwantyli - do przypisu, żeby tabela i rysunek mówiły jednym głosem. */
  quantileMethod: QuantileMethod;
  /** Użyty mnożnik ogrodzenia (domyślnie konwencja Tukeya). */
  whiskerFactor: number;
  groupBy: BoxplotGroupBy;
}

export interface BoxplotInput {
  categories: readonly string[];
  series: readonly ChartSeries[];
  /** `ChartConfig.sampleSize` - deklaracja autora, `null` gdy nie podał. */
  sampleSize?: number | null;
}

export interface BoxplotOptions {
  groupBy?: BoxplotGroupBy;
  /**
   * Mnożnik ogrodzenia. Zmiana jest dopuszczalna (to konwencja, nie prawo),
   * ale wtedy przypis pod tabelą musi podać nową liczbę - dlatego model
   * zwraca ją w `whiskerFactor`, a nie zakłada, że czytelnik zna domyślną.
   */
  whiskerFactor?: number;
}

/* -------------------------------------------------------------------------- */
/*  Prymitywy odporne na dane z bazy                                          */
/* -------------------------------------------------------------------------- */

/**
 * Liczba skończona albo wartość zastępcza.
 *
 * Model NIGDY nie zwraca NaN ani Infinity, i to jest wymaganie twarde, a nie
 * higiena: bramka `blockMatrix` sprawdza `textContent` na obecność napisu
 * "NaN", a `Intl.NumberFormat.format(NaN)` zwraca literalny napis "NaN",
 * czyli jedna niedomknięta operacja arytmetyczna wychodzi z modelu prosto na
 * stronę jako słowo. Każde dzielenie i każda różnica, która może przepełnić,
 * przechodzi więc przez ten filtr.
 */
function fin(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Obserwacje z surowego wiersza konfiguracji. Luka (`null`), brak elementu
 * (tablica krótsza niż `categories`) i wartość nieskończona są TYM SAMYM:
 * brakiem pomiaru. Nie są zerem - zero jest pomiarem i weszłoby do kwartyli,
 * przesuwając medianę w stronę, której dane nie potwierdzają.
 */
function observations(values: readonly (number | null)[]): number[] {
  const out: number[] = [];
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v)) out.push(v);
  }
  return out;
}

/**
 * Kwantyl typu 7 na tablicy JUŻ POSORTOWANEJ rosnąco - JEDNO WYWOŁANIE
 * wspólnej `quantile` ze `stats.ts` i nic ponadto.
 *
 * NAZWA ZOSTAJE, BO JEST WEJŚCIEM DO TEGO MODUŁU: wołają ją testy i sąsiedni
 * kod, a przemianowanie eksportu byłoby zmianą niezwiązaną z defektem, który
 * ta poprawka usuwa. Ciało jest przekierowaniem, żeby definicja kwantyla
 * została w repozytorium JEDNA - cztery kopie w dwóch różnych wzorach to nie
 * powielony kod, tylko cztery definicje, z których każda daje na skrajnych
 * danych inną liczbę.
 *
 * JAKI DEFEKT ZNIKA. Poprzednia postać interpolowała RÓŻNICĄ (`a + (b-a)*f`)
 * i miała na niej osłonę wyświetlania (`fin(..., a)`). Dla
 * `quantileR7([-1e308, 1e308, 1e308, 1e308], 0.25)` różnica `b - a`
 * przepełniała do nieskończoności, osłona cofała wynik do `a` i funkcja
 * ogłaszała pierwszy kwartyl RÓWNY NAJMNIEJSZEJ OBSERWACJI (-1e308) tam, gdzie
 * poprawną odpowiedzią jest 5e+307. Nie była to awaria, którą ktoś zauważy:
 * była to zła liczba na rysunku i w tabeli, wyglądająca dokładnie tak samo
 * wiarygodnie jak liczba policzona z danych. `quantile` interpoluje
 * MIESZANIEM (`a*(1-t) + b*t`), które nie liczy różnicy, więc nie ma czym
 * przepełnić, a gdy wyniku policzyć się nie da, MILCZY (`null`) zamiast
 * podawać wartość zastępczą.
 *
 * Konsekwencja kontraktu: `p` poza [0, 1] daje `null`, a nie kwantyl
 * przycięty do skraju próby - "kwantyl rzędu -0,5" jest błędem wywołania,
 * a nie danymi do przycięcia.
 */
export function quantileR7(sorted: readonly number[], p: number): number | null {
  return quantile(sorted, p);
}

/**
 * Deterministyczne rozsunięcie punktów o identycznej wartości.
 *
 * Krok maleje razem z licznością remisu (`min(TIE_OFFSET_STEP, 1 / k)`), żeby
 * wachlarz nigdy nie wyszedł poza skrzynkę: przy dwudziestu remisach stały
 * krok 0,18 rozsunąłby je na trzy szerokości pudła i punkty wjechałyby
 * w kolumnę sąsiedniej grupy, czyli przypisałyby obserwacje nie tej grupie,
 * z której pochodzą.
 */
function tieOffsets(count: number): number[] {
  if (count <= 1) return [0];
  const step = Math.min(TIE_OFFSET_STEP, fin(1 / count, 0));
  const mid = (count - 1) / 2;
  return Array.from({ length: count }, (_, i) => fin((i - mid) * step));
}

/** Punkty z rozsunięciem remisów. Wejście posortowane rosnąco. */
function spreadPoints(
  values: readonly number[],
  severityOf: (v: number) => BoxplotPoint["severity"],
): BoxplotPoint[] {
  const out: BoxplotPoint[] = [];
  let i = 0;
  while (i < values.length) {
    let j = i;
    while (j + 1 < values.length && values[j + 1] === values[i]) j++;
    const offsets = tieOffsets(j - i + 1);
    for (let k = i; k <= j; k++) {
      const value = fin(values[k]);
      out.push({ value, offset: fin(offsets[k - i]), severity: severityOf(value) });
    }
    i = j + 1;
  }
  return out;
}

/** Udział najczęstszej wartości w próbie. Mianownik osłonięty, bo `n` bywa zerem. */
function modeShareOf(sorted: readonly number[]): number {
  if (sorted.length === 0) return 0;
  let best = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    run = sorted[i] === sorted[i - 1] ? run + 1 : 1;
    if (run > best) best = run;
  }
  return fin(best / Math.max(1, sorted.length));
}

/* -------------------------------------------------------------------------- */
/*  Model                                                                     */
/* -------------------------------------------------------------------------- */

interface RawGroup {
  label: string;
  colorSlot: number;
  values: number[];
}

/**
 * Grupy obserwacji z konfiguracji.
 *
 * `groupBy: "series"` - jedna seria to jedna grupa, jej `values` to
 * obserwacje. To jest odczyt domyślny i naturalny: arkusz ma kolumnę na
 * grupę, wiersz na obserwację, a nazwa serii jest nazwą grupy.
 *
 * `groupBy: "category"` - arkusz transponowany: jedna kategoria to jedna
 * grupa, a obserwacje leżą w poprzek serii. Ten odczyt jest potrzebny, bo
 * blok w bazie może pochodzić z wykresu słupkowego, w którym seria była
 * powtórzeniem pomiaru (trzy laboratoria, cztery kwartały), i wtedy grupami
 * są kategorie. Slot palety idzie wtedy z POZYCJI grupy, bo indeks kategorii
 * i pozycja rysowanej skrzynki to dwie różne liczby, a kolor musi zostać
 * w zakresie slotów rozdzielnych dla daltonizmu.
 */
function groupsOf(input: BoxplotInput, groupBy: BoxplotGroupBy): RawGroup[] {
  if (groupBy === "category") {
    return input.categories.map((label, index) => ({
      label,
      colorSlot: index + 1,
      values: observations(input.series.map((s) => s.values[index] ?? null)),
    }));
  }
  return input.series.map((s, index) => ({
    label: s.name,
    // Slot z konfiguracji, ale nigdy zerowy ani ujemny: seria z cofniętej
    // wersji edytora może nie mieć tego pola, a paleta liczy sloty od jednego.
    colorSlot:
      Number.isFinite(s.colorSlot) && s.colorSlot >= 1 ? Math.floor(s.colorSlot) : index + 1,
    values: observations(s.values),
  }));
}

/** Skrzynka razem z próbą, z której powstała - do samosprawdzeń. */
interface BoxWithSample {
  box: BoxplotBox;
  sorted: number[];
}

/**
 * Model skrzynek. Nigdy nie rzuca i nigdy nie zwraca NaN ani Infinity -
 * także dla serii pustej, serii z samych luk, jednej kategorii, wartości
 * ujemnych i próby jednoelementowej.
 *
 * UKŁAD W JEDNOSTKACH WZGLĘDNYCH, NIE W PIKSELACH. Model nie zna szerokości
 * rysunku, więc pasmo i-tej z k grup to `[i/k, (i+1)/k]` udziału szerokości
 * obszaru kreślenia, środek `(i + 0,5)/k`, a szerokość skrzynki
 * `BOX_WIDTH_RATIO / k`. Render mnoży to przez `innerWidth` i może dodatkowo
 * przyciąć szerokość do maksimum w pikselach - przycięcie jest jego decyzją,
 * bo zależy od rozmiaru, którego model nie widzi. Oś wartości pozostaje
 * w jednostkach danych; skalowanie jest w `scale.ts`.
 */
export function boxplotModel(input: BoxplotInput, opts: BoxplotOptions = {}): BoxplotModel {
  const groupBy: BoxplotGroupBy = opts.groupBy === "category" ? "category" : "series";
  const whiskerFactor =
    typeof opts.whiskerFactor === "number" &&
    Number.isFinite(opts.whiskerFactor) &&
    opts.whiskerFactor >= 0
      ? opts.whiskerFactor
      : WHISKER_IQR_FACTOR;

  const groups = groupsOf(input, groupBy);
  const count = groups.length;
  // Pasmo liczone tylko wtedy, gdy jest co dzielić. Zero grup (blok bez ani
  // jednej serii, czyli stan świeżo dodanego wykresu w edytorze) nie może
  // wyprodukować dzielenia przez zero - a wyprodukowałoby, gdyby szerokość
  // pasma była policzona przed sprawdzeniem liczby grup.
  const bandWidth = count > 0 ? fin(1 / count, 1) : 1;

  const built: BoxWithSample[] = groups.map((group, index) => {
    // KOPIA, a nie sortowanie w miejscu: mutowanie wejścia modelu jest
    // defektem, który ujawnia się dopiero u wywołującego (tabela danych
    // dostawałaby obserwacje w innej kolejności niż arkusz).
    //
    // KOMPARATOR NUMERYCZNY. `sort()` bez komparatora porównuje napisy, więc
    // [10, 2, 33] wychodzi jako [10, 2, 33] i mediana lądowała na 2. Kwartyle
    // liczone z takiej tablicy są cicho fałszywe: nic nie rzuca, liczby są
    // skończone, a wykres pokazuje nieprawdę.
    const sorted = group.values.slice().sort((a, b) => a - b);
    const n = sorted.length;
    const start = fin(index * bandWidth);
    const width = fin(bandWidth * BOX_WIDTH_RATIO);
    const base = {
      index,
      label: group.label,
      colorSlot: group.colorSlot,
      n,
      center: fin(start + bandWidth / 2),
      width,
      capWidth: fin(width * WHISKER_CAP_RATIO),
      band: { start, end: fin(start + bandWidth) },
      modeShare: modeShareOf(sorted),
    };

    if (n === 0) {
      return {
        sorted,
        box: {
          ...base,
          min: null,
          max: null,
          q1: null,
          median: null,
          q3: null,
          iqr: null,
          whiskerLow: null,
          whiskerHigh: null,
          fenceLow: null,
          fenceHigh: null,
          outliers: [],
          points: [],
          hasQuartiles: false,
          collapsed: false,
        },
      };
    }

    const min = fin(sorted[0]);
    const max = fin(sorted[n - 1]);

    if (n < BOXPLOT_MIN_SAMPLE) {
      // MILCZENIE, NIE ZGADYWANIE. Kwartyle są `null`, a obserwacje idą do
      // `points` jako kolumna kropek. Skrajne wartości zostają, bo min i max
      // są uczciwe przy każdej liczności - to POMIARY, nie statystyki rzędu.
      return {
        sorted,
        box: {
          ...base,
          min,
          max,
          q1: null,
          median: null,
          q3: null,
          iqr: null,
          whiskerLow: null,
          whiskerHigh: null,
          fenceLow: null,
          fenceHigh: null,
          outliers: [],
          points: spreadPoints(sorted, () => "raw"),
          hasQuartiles: false,
          collapsed: false,
        },
      };
    }

    // KWARTYL JEST ORZECZENIEM O DANYCH, NIE WSPÓŁRZĘDNĄ RYSUNKU, więc jego
    // brak nie ma prawa cofnąć się do żadnej liczby zastępczej. Poprzednia
    // postać (`fin(quantileR7(...) ?? min)`) domykała drugą połowę defektu
    // opisanego przy `quantileR7`: nawet gdyby wspólna funkcja zamilkła,
    // model wpisałby w pole `q1` najmniejszą obserwację próby i podał ją
    // czytelnikowi jako pierwszy kwartyl. Milczenie wspólnej funkcji musi
    // zostać milczeniem modelu.
    const q1 = quantile(sorted, 0.25);
    const median = quantile(sorted, 0.5);
    const q3 = quantile(sorted, 0.75);

    if (q1 === null || median === null || q3 === null) {
      // Ta sama cisza co poniżej progu próby - kwartyle `null`, obserwacje
      // w `points`, żeby żadna nie zniknęła z wykresu - ale NAZWANA INACZEJ
      // w uczciwości (`unquantifiableSamples`, a nie `smallSamples`), bo
      // próba jest tu dostatecznie liczna i powód milczenia jest inny.
      return {
        sorted,
        box: {
          ...base,
          min,
          max,
          q1: null,
          median: null,
          q3: null,
          iqr: null,
          whiskerLow: null,
          whiskerHigh: null,
          fenceLow: null,
          fenceHigh: null,
          outliers: [],
          points: spreadPoints(sorted, () => "raw"),
          hasQuartiles: false,
          collapsed: false,
        },
      };
    }

    // Maksimum z zerem, bo IQR jest DŁUGOŚCIĄ: ujemny rozstęp między
    // kwartylami nie ma sensu i przy takiej wartości ogrodzenia odwróciłyby
    // się stronami, czyli cały zakres danych stałby się odstający.
    //
    // PRZEPEŁNIENIE COFA SIĘ DO NAJWIĘKSZEJ LICZBY SKOŃCZONEJ, NIE DO ZERA.
    // Różnica kwartyli leżących po obu stronach zera przy wartościach rzędu
    // 1e308 (uszkodzony import, kolumna z błędem jednostki) przepełnia do
    // Infinity. Zero jako wartość zastępcza oznaczałoby tu rozkład
    // ZDEGENEROWANY, czyli dokładną odwrotność prawdy o danych o skrajnym
    // rozproszeniu, i model zacząłby wpisywać taką grupę do
    // `collapsedSamples`.
    const iqrRaw = q3 - q1;
    const iqr = Math.max(0, Number.isFinite(iqrRaw) ? iqrRaw : Number.MAX_VALUE);
    // ROZSTĘP ROBI TU DWIE RÓŻNE ROBOTY I DLATEGO SĄ DWIE ZMIENNE.
    //
    // `iqr` powyżej jest WEJŚCIEM DO RYSUNKU: rozsuwa ogrodzenia, dzieli
    // punkty na odstające i zwykłe, odpowiada na pytanie `collapsed`.
    // Nasycenie do największej liczby skończonej jest tam właściwe, bo daje
    // ogrodzenia szersze niż dane, czyli "nic tu nie odstaje" - odpowiedź
    // ostrożną i zgodną z prawdą o szeregu rozpiętym na cały zakres double.
    //
    // `rozstepOrzeczony` jest LICZBĄ W TABELI, czyli twierdzeniem o danych,
    // i nie wolno mu być nasyconym: 1,7976931348623157e+308 wpisane
    // w kolumnę IQR wygląda jak pomiar, a jest sufitem arytmetyki. Tu
    // obowiązuje konwencja `stats.ts` - milczenie - i dzięki temu ta sama
    // próba daje tę samą liczbę na skrzynce, w histogramie i w roju
    // (pilnuje tego `statsParity.test.ts`).
    const rozstepOrzeczony = Number.isFinite(iqrRaw) ? iqrRaw : null;
    const fenceLow = fin(q1 - whiskerFactor * iqr, min);
    const fenceHigh = fin(q3 + whiskerFactor * iqr, max);
    const farLow = fin(q1 - FAR_OUT_IQR_FACTOR * iqr, fenceLow);
    const farHigh = fin(q3 + FAR_OUT_IQR_FACTOR * iqr, fenceHigh);

    // WĄS KOŃCZY SIĘ NA OBSERWACJI. Skanujemy posortowaną tablicę i bierzemy
    // pierwszą wartość, która mieści się w ogrodzeniu, oraz ostatnią taką.
    // Nie bierzemy wartości ogrodzenia, bo ogrodzenie jest progiem
    // obliczonym, a nie zmierzonym - wąs do ogrodzenia rysuje pomiar, którego
    // nie było, i jest to ten sam gatunek błędu co ucięta oś.
    let lowIdx = 0;
    while (lowIdx < n && sorted[lowIdx] < fenceLow) lowIdx++;
    let highIdx = n - 1;
    while (highIdx >= 0 && sorted[highIdx] > fenceHigh) highIdx--;
    // Osłona na wypadek ogrodzenia, które nie objęło ani jednej obserwacji.
    // Arytmetycznie nie powinno się zdarzyć, bo ogrodzenia obejmują [q1, q3],
    // ale model nie ma prawa zwrócić `undefined` przy ŻADNYCH danych - wtedy
    // wąsy zwijają się do skrajnych obserwacji, czyli do zakresu, który na
    // pewno istnieje.
    const okScan = lowIdx <= highIdx;
    const whiskerLow = okScan ? fin(sorted[lowIdx], min) : min;
    const whiskerHigh = okScan ? fin(sorted[highIdx], max) : max;

    const below = okScan ? sorted.slice(0, lowIdx) : [];
    const above = okScan ? sorted.slice(highIdx + 1) : [];
    // Przy IQR = 0 oba ogrodzenia leżą na tej samej liczbie, więc podział na
    // "outside" i "far out" traci sens: każda inna wartość jest jednocześnie
    // poza 1,5 i poza 3 IQR. Nazywanie ich wtedy skrajnie odstającymi byłoby
    // artefaktem arytmetyki zdegenerowanej, a nie odczytem danych - mówi
    // o tym flaga `collapsed`, nie stopień odstawania.
    const severityOf = (value: number): BoxplotPoint["severity"] =>
      iqr === 0 ? "mild" : value < farLow || value > farHigh ? "far" : "mild";

    return {
      sorted,
      box: {
        ...base,
        min,
        max,
        q1,
        median,
        q3,
        iqr: rozstepOrzeczony,
        whiskerLow,
        whiskerHigh,
        fenceLow,
        fenceHigh,
        outliers: [...spreadPoints(below, severityOf), ...spreadPoints(above, severityOf)],
        points: [],
        hasQuartiles: true,
        collapsed: iqr === 0,
      },
    };
  });

  return {
    boxes: built.map((b) => b.box),
    honesty: honestyOf(built, input.sampleSize ?? null, groupBy),
    quantileMethod: QUANTILE_METHOD,
    whiskerFactor,
    groupBy,
  };
}

/**
 * Tolerancja samosprawdzeń arytmetycznych, względna wobec skali liczb.
 *
 * Interpolacja liniowa `a + (b - a) * f` może dać przy skrajnych wykładnikach
 * różnicę ostatniego bitu, więc porównanie `q1 <= median` na gołym operatorze
 * potrafi odpalić ostrzeżenie o medianie poza pudłem na danych, które są
 * w porządku. Ostrzeżenie fałszywe jest gorsze od braku ostrzeżenia, bo uczy
 * ignorowania wszystkich - to ta sama decyzja, która w module uczciwości stoi
 * za liczeniem różnicy udziałów na jednym miejscu po przecinku.
 */
const SELF_CHECK_EPS = 1e-9;

function within(value: number, lo: number, hi: number, scale: number): boolean {
  const eps = SELF_CHECK_EPS * Math.max(1, Math.abs(scale));
  return value >= lo - eps && value <= hi + eps;
}

function honestyOf(
  built: readonly BoxWithSample[],
  declared: number | null,
  groupBy: BoxplotGroupBy,
): BoxplotHonesty {
  // `null` startowo i koniunkcja przy każdej grupie, która ma co sprawdzić:
  // model, który nie miał czego sprawdzić, MILCZY, a nie zaświadcza.
  let medianInsideBox: boolean | null = null;
  let whiskersInsideData: boolean | null = null;
  let whiskersAreObservations: boolean | null = null;
  let outlierPartitionOk: boolean | null = null;
  let declaredSampleSizeOk: boolean | null = null;

  const smallSamples: string[] = [];
  const unquantifiableSamples: string[] = [];
  const emptySamples: string[] = [];
  const collapsedSamples: string[] = [];
  let minN = Infinity;
  let maxN = 0;

  // Deklaracja `sampleSize` mówi o liczbie obserwacji NA SERIĘ, więc ma sens
  // wyłącznie w trybie, w którym seria jest grupą. W trybie transponowanym
  // model milczy, zamiast porównywać dwie różne liczby.
  const declarationComparable =
    declared !== null && Number.isFinite(declared) && declared >= 0 && groupBy === "series";

  for (const { box, sorted } of built) {
    if (box.n === 0) {
      emptySamples.push(box.label);
      continue;
    }
    if (box.n < minN) minN = box.n;
    if (box.n > maxN) maxN = box.n;
    if (declarationComparable) {
      declaredSampleSizeOk = (declaredSampleSizeOk ?? true) && box.n === declared;
    }
    if (!box.hasQuartiles) {
      // DWA RÓŻNE POWODY MILCZENIA, DWIE RÓŻNE LISTY. Poniżej progu to
      // decyzja modelu o próbie ("pięć liczb z czterech obserwacji udaje
      // statystykę rzędu"), powyżej progu - kwantyl, którego nie dało się
      // policzyć. Jedna lista nazwałaby drugi przypadek pierwszym, czyli
      // podałaby czytelnikowi nieprawdziwy powód.
      if (box.n < BOXPLOT_MIN_SAMPLE) smallSamples.push(box.label);
      else unquantifiableSamples.push(box.label);
      continue;
    }
    if (box.collapsed) collapsedSamples.push(box.label);

    const q1 = box.q1 ?? 0;
    const q3 = box.q3 ?? 0;
    const med = box.median ?? 0;
    const lo = box.whiskerLow ?? 0;
    const hi = box.whiskerHigh ?? 0;
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const scale = Math.max(Math.abs(min), Math.abs(max), box.iqr ?? 0);

    medianInsideBox = (medianInsideBox ?? true) && within(med, q1, q3, scale);
    whiskersInsideData =
      (whiskersInsideData ?? true) && within(lo, min, max, scale) && within(hi, min, max, scale);
    // RÓWNOŚĆ DOKŁADNA, bez tolerancji, i to jest cała treść tego
    // sprawdzenia: koniec wąsa ma być TĄ SAMĄ liczbą co jakaś obserwacja,
    // a nie liczbą do niej zbliżoną. Tolerancja przepuściłaby wąs zatrzymany
    // na wartości ogrodzenia leżącej blisko obserwacji, czyli dokładnie to, co
    // ten warunek ma wykryć. Porównujemy z SUROWĄ próbą, a nie z polami
    // modelu - inaczej warunek byłby prawdziwy z definicji i nie wykrywałby
    // niczego.
    whiskersAreObservations =
      (whiskersAreObservations ?? true) &&
      sorted.some((v) => v === lo) &&
      sorted.some((v) => v === hi);

    // ZUPEŁNOŚĆ I ROZŁĄCZNOŚĆ PODZIAŁU, liczona z surowej próby: ile
    // obserwacji mieści się między końcami wąsów, ile jest odstających i czy
    // razem dają `n`. Odpowiednik sumy kontrolnej mostka - składniki muszą
    // zamknąć całość, inaczej któraś obserwacja znika z wykresu bez śladu.
    const inside = sorted.filter((v) => v >= lo && v <= hi).length;
    outlierPartitionOk =
      (outlierPartitionOk ?? true) &&
      inside >= 1 &&
      inside + box.outliers.length === box.n &&
      box.outliers.every((p) => p.value < lo || p.value > hi);
  }

  const sampleRatio = minN !== Infinity && minN > 0 ? fin(maxN / minN, 1) : null;

  return {
    medianInsideBox,
    whiskersInsideData,
    whiskersAreObservations,
    outlierPartitionOk,
    declaredSampleSizeOk,
    sampleRatio,
    sampleSizesBalanced: sampleRatio === null ? null : sampleRatio <= BOXPLOT_SAMPLE_RATIO_MAX,
    smallSamples,
    unquantifiableSamples,
    emptySamples,
    collapsedSamples,
  };
}

/* -------------------------------------------------------------------------- */
/*  Model z konfiguracji bloku                                                */
/* -------------------------------------------------------------------------- */

/**
 * Model z tego, co silnik już ma w `ChartConfig` - jedyne wejście, którego
 * render potrzebuje, żeby nie znać konwencji odczytu arkusza.
 *
 * KTO JEST GRUPĄ. Konfiguracja daje `categories` i `series`, czyli JEDNĄ
 * liczbę na przecięciu. Rozkład potrzebuje SUROWYCH OBSERWACJI, więc ten sam
 * arkusz czytamy inaczej: jedna seria to jedna grupa, a jej `values` to
 * obserwacje tej grupy (patrz nagłówek pliku). Etykiety kategorii są wtedy
 * identyfikatorami wierszy, nie osią kategorii wykresu.
 *
 * ADAPTER NIE ZGADUJE TRYBU GRUPOWANIA, i to jest tu jedyna decyzja warta
 * uzasadnienia. Kuszące jest wykrycie arkusza transponowanego z kształtu
 * danych ("więcej kategorii niż serii, więc grupami są serie"), ale każda taka
 * reguła jest zgadywaniem INTENCJI autora, a pomyłka nie wygląda na błąd -
 * wygląda na inne dane, dokładnie jak pomyłka o jeden wiersz w mapie ciepła.
 * Dlatego `groupBy` zostaje w `opts` z wartością domyślną "series", a wybór
 * należy do wywołującego, który zna pole bloku.
 *
 * NIE FILTRUJEMY SERII BEZ DANYCH, i tym ten adapter różni się od
 * `histogramModelFromConfig`. Histogram czyta JEDNĄ serię, więc musi wybrać
 * pierwszą niepustą, inaczej wygaszałby rozkład z powodu wiersza dopisanego
 * w edytorze. Skrzynka czyta WSZYSTKIE serie jako grupy, a seria bez ani
 * jednej liczby jest GRUPĄ PUSTĄ, którą model nazywa w `honesty.emptySamples`.
 * Odrzucenie jej tutaj uciszyłoby to sprawdzenie na zawsze i - co gorsze -
 * przesunęłoby pasma pozostałych grup, czyli zmieniałoby pozycje i kolory
 * kolumn w trakcie wpisywania danych.
 *
 * `sampleSize` jedzie w komplecie, bo bez niego `declaredSampleSizeOk` nie ma
 * czego porównać: to sprawdzenie dotyczy DANYCH AUTORA (podpis mówi "n = 300",
 * a w arkuszu jest dwanaście wierszy), a nie arytmetyki modelu.
 */
export function boxplotModelFromConfig(
  config: ChartConfig,
  opts: BoxplotOptions = {},
): BoxplotModel {
  return boxplotModel(
    {
      categories: config.categories,
      series: config.series,
      sampleSize: config.sampleSize,
    },
    opts,
  );
}

/**
 * Zakres osi wartości: wszystko, co model każe narysować.
 *
 * WCHODZĄ TU TAKŻE OBSERWACJE ODSTAJĄCE, i to nie jest oczywiste - zakres
 * policzony z samych wąsów zostawia je poza obszarem kreślenia, gdzie są
 * przycinane krawędzią. Przycięty punkt odstający jest gorszy od jego braku:
 * wykres pokazuje wtedy rozkład bez ogona i wygląda na kompletny.
 *
 * ZERO NIE JEST WYMUSZANE. Skrzynka koduje POŁOŻENIE na wspólnej skali, a nie
 * długość od zera, więc oś obejmująca zero przy próbie z zakresu 980-1020
 * ścisnęłaby wszystkie skrzynki w jedną kreskę i rozkład, który miał być
 * widoczny, zniknąłby. Ucięciu towarzyszy jednak obowiązek nazwania go
 * w podpisie (sekcja 8) - patrz raport, `honesty.isZeroBaselineBroken` dzisiaj
 * nie zna tego rodzaju.
 */
export function boxplotExtent(model: BoxplotModel): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  const take = (v: number | null): void => {
    if (v === null || !Number.isFinite(v)) return;
    if (v < min) min = v;
    if (v > max) max = v;
  };
  for (const box of model.boxes) {
    take(box.whiskerLow);
    take(box.whiskerHigh);
    take(box.q1);
    take(box.q3);
    take(box.median);
    for (const p of box.outliers) take(p.value);
    for (const p of box.points) take(p.value);
  }
  // Brak jakiejkolwiek liczby (blok bez danych): zwracamy zakres jałowy
  // zamiast [Infinity, -Infinity], żeby wywołujący nie musiał odróżniać
  // "brak danych" od "zakres wywrócony", a `niceScale` nie dostał
  // nieskończoności.
  if (min === Infinity) return { min: 0, max: 1 };
  return { min, max };
}

/* -------------------------------------------------------------------------- */
/*  Alternatywa tekstowa                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Kolumny tabeli danych. KLUCZE, nie napisy - nagłówki tłumaczy render ze
 * słownika i18n, bo są niezależne od treści bloku (inaczej niż nazwy grup,
 * które idą z arkusza autora). Kolejność jest kolejnością odczytu skrzynki od
 * dołu do góry, żeby wiersz tabeli dał się przełożyć na rysunek bez szukania.
 */
export const BOXPLOT_COLUMNS = [
  "label",
  "n",
  "min",
  "whiskerLow",
  "q1",
  "median",
  "q3",
  "whiskerHigh",
  "max",
  "iqr",
  "outliers",
] as const;
export type BoxplotColumnKey = (typeof BOXPLOT_COLUMNS)[number];

export interface BoxplotTableRow {
  label: string;
  n: number;
  min: number | null;
  max: number | null;
  q1: number | null;
  median: number | null;
  q3: number | null;
  iqr: number | null;
  whiskerLow: number | null;
  whiskerHigh: number | null;
  /** Wartości obserwacji odstających, rosnąco. Pusta tablica = nie ma. */
  outliers: number[];
  /**
   * Surowe obserwacje - wypełnione TYLKO dla próby poniżej progu kwartyli.
   *
   * Dla n <= 4 wypisanie czterech liczb jest ściślejsze od jakiejkolwiek
   * statystyki policzonej z czterech liczb, więc tabela podaje same
   * obserwacje, a kolumny kwartyli zostają puste. To jest ta sama decyzja co
   * milczenie modelu, przeniesiona na alternatywę tekstową: alternatywa nie
   * może być bardziej stanowcza od rysunku.
   */
  observations: number[] | null;
  /** Skrzynka zwinięta w linię (IQR = 0) - do przypisu przy wierszu. */
  collapsed: boolean;
  /** Próba poniżej progu kwartyli - do przypisu przy wierszu. */
  belowMinSample: boolean;
}

export interface BoxplotTable {
  columns: readonly BoxplotColumnKey[];
  rows: BoxplotTableRow[];
  /**
   * Parametry, bez których liczb w tabeli nie da się odtworzyć. Metoda
   * kwantyli i mnożnik ogrodzenia są UMOWAMI, nie faktami, więc muszą być
   * napisane pod tabelą - inaczej czytelnik przeliczający dane u siebie
   * dostanie inne kwartyle i będzie miał rację.
   */
  method: {
    quantile: QuantileMethod;
    whiskerFactor: number;
    minSample: number;
  };
}

/**
 * Tabela danych pod wykresem. Grafika nigdy nie jest jedyną drogą do liczby
 * (sekcja 8), a tabela liczy Z TEGO SAMEGO MODELU co rysunek - nie po raz
 * drugi z surowych danych, bo dwa liczenia to dwa źródła prawdy i rozjazd
 * między nimi jest defektem samym w sobie.
 */
export function boxplotTable(model: BoxplotModel): BoxplotTable {
  return {
    columns: BOXPLOT_COLUMNS,
    rows: model.boxes.map((box) => ({
      label: box.label,
      n: box.n,
      min: box.min,
      max: box.max,
      q1: box.q1,
      median: box.median,
      q3: box.q3,
      iqr: box.iqr,
      whiskerLow: box.whiskerLow,
      whiskerHigh: box.whiskerHigh,
      // Sortujemy WYNIK `map`, czyli nową tablicę: `box.outliers` jest
      // kolejnością RYSOWANIA (najpierw dolny ogon, potem górny) i tabela nie
      // ma prawa jej przestawić. W tabeli kolejność jest rosnąca, bo kolumnę
      // liczb czyta się od najmniejszej.
      outliers: box.outliers.map((p) => p.value).sort((a, b) => a - b),
      observations: box.points.length > 0 ? box.points.map((p) => p.value) : null,
      collapsed: box.collapsed,
      belowMinSample: box.n > 0 && box.n < BOXPLOT_MIN_SAMPLE,
    })),
    method: {
      quantile: model.quantileMethod,
      whiskerFactor: model.whiskerFactor,
      minSample: BOXPLOT_MIN_SAMPLE,
    },
  };
}

/* -------------------------------------------------------------------------- */
/*  Kiedy skrzynka jest złą formą                                             */
/* -------------------------------------------------------------------------- */

/**
 * Przypadki, w których lepszą formą jest coś innego - wyłącznie takie, które
 * da się WYLICZYĆ z danych. Wzorem `pieFormAdvice` funkcja odpowiada tylko na
 * pytanie o formę i nie zna konfiguracji.
 *
 *   * `dotsBetter` - w każdej niepustej grupie mniej obserwacji, niż oko
 *     zliczy. Kolumna punktów (beeswarm) pokazuje wtedy KAŻDĄ wartość i nie
 *     każe czytelnikowi wierzyć w metodę kwantyli;
 *   * `tiesDominant` - jedna wartość zajmuje więcej niż połowę próby. Pięć
 *     liczb składa się wtedy na tej samej liczbie, pudło jest zwinięte albo
 *     prawie zwinięte, a rozkład ma atom i ogon - histogram pokazuje to od
 *     razu, skrzynka nie pokazuje tego wcale;
 *   * `singleGroup` - jedna grupa. Skrzynka jest formą PORZĄDKUJĄCĄ
 *     porównanie rozkładów między grupami; dla jednej próby histogram mówi
 *     więcej tym samym miejscem, bo pokazuje kształt, a nie pięć liczb. To
 *     nie zakaz, tylko wskazanie lepszej formy.
 */
export type BoxplotFormAdvice = "dotsBetter" | "tiesDominant" | "singleGroup";

export function boxplotFormAdvice(model: BoxplotModel): BoxplotFormAdvice[] {
  const advice: BoxplotFormAdvice[] = [];
  const nonEmpty = model.boxes.filter((b) => b.n > 0);
  if (nonEmpty.length === 0) return advice;
  if (nonEmpty.length === 1) advice.push("singleGroup");
  if (nonEmpty.every((b) => b.n < BOXPLOT_DOTS_BETTER_N)) advice.push("dotsBetter");
  if (nonEmpty.some((b) => b.modeShare > BOXPLOT_TIE_DOMINANT_SHARE)) advice.push("tiesDominant");
  return advice;
}
