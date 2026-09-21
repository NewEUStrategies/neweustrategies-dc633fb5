// Model rodzaju "liniowy na indeksie, baza = 100" - kilka szeregów o różnej
// skali na JEDNEJ osi wartości.
//
// PO CO TEN RODZAJ ISTNIEJE. Tabela doboru formy z sekcji 1 specyfikacji
// stawia przy pytaniu "Kilka szeregów o różnej skali?" dwie dopuszczone
// formy - "liniowy na indeksie (baza = 100)" i small multiples - a w kolumnie
// "Czego unikać" jedno hasło: DWIE OSIE Y. Specyfikacja wymienia je wśród
// trzech zakazów bez wyjątków i podaje przyczynę: przy dwóch osiach Y
// "relacja wizualna między szeregami zależy od dobranych zakresów, czyli od
// Ciebie, a nie od danych". Ten model jest wykonaniem tego zakazu, a nie
// komentarzem do niego: przelicza każdą serię na indeks `v / baza * 100`,
// więc wszystkie szeregi trafiają na JEDNĄ skalę, której nikt nie dobiera,
// bo wynika ona z arytmetyki. Czytelnik porównuje wtedy POZYCJĘ NA WSPÓLNEJ
// SKALI, czyli kanał najwyższy w hierarchii percepcyjnej Clevelanda
// i McGilla, zamiast porównywać dwa układy współrzędnych naraz.
//
// CO TEN RODZAJ ODDAJE, A CO ODBIERA - trzeba to wiedzieć, żeby doradzać
// formę uczciwie. Indeks odbiera POZIOM (nie widać, że jedna seria jest
// w milionach, a druga w procentach) i odbiera JEDNOSTKĘ (patrz niżej),
// a oddaje TEMPO (od bazy wszystkie szeregi startują w tym samym punkcie).
// Dlatego wartości źródłowe zostają w modelu i idą do tabeli tekstowej obok
// indeksu: rysunek pokazuje tempo, a tabela poziom, i żadna z tych dwóch
// rzeczy nie znika.
//
// CZEGO TEMU RODZAJOWI NIE WOLNO, czyli co ten moduł wymusza po stronie
// danych, zamiast liczyć na czujność autora:
//   * NIE WOLNO okresu bazowego OSOBNEGO DLA SERII. To jest dokładnie to samo
//     kłamstwo co dwie osie Y, tylko trudniejsze do zauważenia: przy dwóch
//     osiach czytelnik widzi przynajmniej dwie podziałki i może się
//     zaniepokoić, a przy bazie liczonej per seria widzi jedną oś, jedną
//     linię odniesienia w stu i nie ma z czego wywnioskować, że dwa szeregi
//     startują z różnych momentów. Okres bazowy jest tu więc JEDNĄ LICZBĄ
//     w opcjach (`baseAt`), a nie tablicą - defektu, którego nie da się
//     wyrazić, nie trzeba sprawdzać w czasie działania i nie trzeba o nim
//     ostrzegać. Baza WSPÓLNA jest okresem; wartość bazowa jest oczywiście
//     inna w każdej serii i to jest cała treść tego rodzaju;
//   * NIE WOLNO podstawić cichej jedynki w mianowniku. Baza równa zeru,
//     ujemna albo nieistniejąca czyni serię NIEINDEKSOWALNĄ i taka seria
//     wypada z rysunku z NAZWANĄ przyczyną (`rejection`), zostając w tabeli
//     z wartościami źródłowymi. Podstawienie jedynki dałoby indeks, który
//     wygląda jak każdy inny, a znaczy "wartość razy sto";
//   * NIE WOLNO indeksować przez bazę UJEMNĄ, choć dzielenie jest wtedy
//     legalne arytmetycznie. Dzielenie przez liczbę ujemną ODWRACA kierunek:
//     pogłębiający się deficyt daje rosnący indeks, więc wykres pokazuje
//     wzrost tam, gdzie jest spadek. To samo rozstrzygnięcie stoi w modelu
//     paneli (`indexable` w `smallMultiples.ts`) i musi być identyczne, bo
//     oba rodzaje odpowiadają na to samo pytanie z tabeli doboru form;
//   * NIE WOLNO przenieść jednostki wejścia na oś wyniku. Indeks jest
//     BEZWYMIAROWY: iloraz dwóch wartości w mld EUR nie jest w mld EUR.
//     Dlatego `unit` modelu jest twardym `null`, a jednostka autora jedzie
//     osobnym polem (`sourceUnit`) wyłącznie do kolumny wartości źródłowych.
//     Oś podpisana jednostką wejścia byłaby zdaniem fałszywym o każdej
//     liczbie na rysunku;
//   * NIE WOLNO zgubić wartości źródłowych. Tabela tekstowa pokazuje OBA
//     odczyty (`source` i `indexed`) dla każdego okresu, także dla serii
//     odrzuconej - bo dane, których autor nie zobaczy nigdzie, są dla niego
//     tym samym co dane, których nie ma;
//   * NIE WOLNO indeksować JEDNEJ serii. Indeks jednej serii nie wnosi nic:
//     kształt linii jest ten sam co przy poziomach (przekształcenie jest
//     liniowe), a czytelnik traci jednostkę i poziom. Model to zgłasza
//     (`singleSeries`).
//
// DECYZJE ARCHITEKTONICZNE I ODRZUCONE ALTERNATYWY:
//   * "BAZA ODSTAJĄCA" MIERZONA OGRODZENIEM TUKEYA, NIE PROGIEM NA STOSUNKU
//     BAZY DO MEDIANY. Okres bazowy odstający od reszty szeregu wyolbrzymia
//     cały indeks - jeden zły rok bazowy i wszystkie szeregi rosną o 300% -
//     więc stosunek bazy do mediany jest w modelu policzony i wypisany
//     (`baseToMedian`, do podpisu). Nie jest jednak WYZWALACZEM ostrzeżenia
//     i to jest tu rozstrzygnięcie, bo alternatywa jest gorsza: próg na samym
//     stosunku odpala na KAŻDYM silnie rosnącym szeregu. Dla serii 100, 200,
//     400, 800, 1600 stosunek bazy do mediany wynosi 0,25, choć pierwszy
//     okres jest bazą całkowicie poprawną, a odczyt "1600" jako "szesnaście
//     razy więcej niż w bazie" jest prawdą i jest dokładnie tym, po co się
//     ten wykres rysuje. Ostrzeżenie, które widać zawsze, uczy ignorowania
//     wszystkich ostrzeżeń (to ta sama decyzja, którą przy progu drzazgi
//     podjął `pieFormAdvice` w `../honesty`). Ogrodzenie Tukeya pyta o coś
//     innego i o to właściwego: czy baza leży dalej od skrzynki własnego
//     szeregu niż `INDEX_BASE_FENCE_IQR_FACTOR` rozstępów
//     międzykwartylowych. Dla szeregu rosnącego nie leży, dla roku
//     kryzysowego pośrodku spokojnego szeregu leży;
//   * BRAK SUMY KONTROLNEJ "INDEKS W OKRESIE BAZOWYM RÓWNA SIĘ STU". Byłaby
//     samospełniająca, bo `baza / baza` daje w podwójnej precyzji dokładną
//     jedynkę dla każdej skończonej niezerowej bazy - a suma kontrolna,
//     która nie może zawieść, jest ozdobą podającą się za sprawdzenie. To ta
//     sama pułapka, którą opisuje `countChecksumOk` w `histogram.ts`
//     i `pieModel`. Sprawdzane jest natomiast to, co realnie zawodzi:
//     REPREZENTOWALNOŚĆ ilorazu (`indexRepresentableOk`), bo przy bazie
//     rzędu 1e-300 i wartości rzędu 1e10 indeks wychodzi z podwójnej
//     precyzji;
//   * SERIE NIE SĄ SORTOWANE. W tornadzie kolejność jest częścią formy, tu
//     jest odwrotnie: kolejność serii jest kolejnością legendy, a sekcja 4
//     wymaga legendy "w kolejności odpowiadającej kolejności szeregów, nie
//     alfabetycznej". Przestawienie serii rozjechałoby legendę z podpisami
//     przy końcach linii.
//
// REGUŁY OGÓLNE ZE SPECYFIKACJI, KTÓRE GO DOTYCZĄ:
//   * sekcja 8 - "Dla liniowego zero nie jest wymagane, ale ucięcie zaznacz".
//     Oś indeksu prawie nigdy nie obejmuje zera (wartości mieszkają wokół
//     stu), a wymuszenie zera zepchnęłoby całą zmienność w górne dziesięć
//     procent osi. Ucięcie jest więc dopuszczone i NAZWANE
//     (`axisTruncatedFromZero`), a zakres osi zawsze obejmuje linię
//     odniesienia sto, bo od niej czyta się każdą wartość - oś bez stu
//     pokazywałaby odchylenia bez punktu, od którego są liczone (ten sam
//     argument stoi za `tornadoExtent`);
//   * sekcja 8 - "Podaj n": liczba okresów z danymi jest polem modelu
//     i rozjazd z `sampleSize` z konfiguracji jest wykrywany arytmetycznie
//     (`declaredSampleOk`);
//   * sekcja 8 - "Domyślnie pokazuj cały dostępny szereg": model niczego nie
//     przycina i nie skraca, a liczby, które nie mają swojego okresu na osi,
//     liczy jawnie (`droppedValueCount`, `pointsInPeriodsOk`);
//   * sekcja 3 - luka zostaje luką (`null`), a nie zerem i nie interpolacją;
//     linia ma się przerwać, bo zero wpadłoby do indeksu jako spadek do zera,
//     którego nie zmierzono;
//   * sekcja 2 - "maksymalnie 5-6 kolorów kategorialnych": ten rodzaj rysuje
//     kilka linii, więc budżet koloru jest jego realnym ograniczeniem;
//     powyżej `CATEGORICAL_SAFE_SERIES` model odsyła do small multiples,
//     czyli do drugiej formy z tego samego wiersza tabeli doboru. Koloru sam
//     nie zna: oddaje SLOT palety, nigdy wartości barwy;
//   * sekcja 4 - przy nie więcej niż czterech szeregach etykietuje się końce
//     linii zamiast legendy, więc model podaje ostatni policzony indeks
//     serii (`lastIndex`) i nie każe renderowi szukać go po tablicy z lukami.
//
// JEDNOSTKI. `source` i `base` są w jednostkach DANYCH (jednostka autora
// siedzi w `sourceUnit`), `indexed`, `baseline`, `indexMin`, `indexMax`
// i `lastIndex` są w PUNKTACH INDEKSU (bezwymiarowo, baza = 100),
// `baseToMedian` i `levelRatio` są KROTNOŚCIAMI. Pikseli w tym module nie ma
// i nie może być: model jest czysty, nie zna Reacta, DOM-u, koloru ani
// języka, a doradztwo i przypisy oddaje jako KLUCZE, które słownik tłumaczy
// poza tym plikiem.
import { INDEX_BASE, baseUsable, indexAgainst, iqr, quantile, tukeyFence } from "../stats";
import { CATEGORICAL_SAFE_SERIES } from "../types";
import type { ChartConfig, ChartSeries } from "../types";

/**
 * Wartość bazy. Sto, bo tak brzmi reguła z tabeli doboru form ("liniowy na
 * indeksie (baza = 100)") i tak czyta się indeks w każdym opracowaniu
 * statystycznym: odczyt "112" jako "o 12% więcej niż w bazie" jest wtedy
 * natychmiastowy i nie wymaga podpisu. Ta sama liczba stoi w modelu paneli
 * (`SMALL_MULTIPLES_INDEX_BASE`) i musi być ta sama, bo oba rodzaje
 * odpowiadają na to samo pytanie analityczne i czytelnik może zobaczyć oba
 * w jednym opracowaniu.
 *
 * NAZWA ZOSTAJE, LICZBA PRZYCHODZI Z `stats.ts`. Wcześniej stała tu własna
 * setka, a obok - w kodzie indeksowania - druga, wpisana wprost we wzorze.
 * Defekt, który przez to znika, jest defektem rozjazdu: linia odniesienia
 * rysunku i mnożnik ilorazu mogły się rozejść, bo nic ich nie wiązało poza
 * tym, że autor wpisał dwa razy tę samą cyfrę. `INDEX_BASE` jest jedną
 * definicją "bazy = 100" dla całego silnika, a ten alias trzyma nazwę,
 * której używa render i przypis.
 */
export const INDEX_BASE_VALUE = INDEX_BASE;

/**
 * Poniżej tylu serii indeks nie wnosi nic.
 *
 * DWIE, bo indeksowanie jest przekształceniem LINIOWYM: dzielenie całej serii
 * przez stałą nie zmienia kształtu linii ani proporcji jej zmian. Przy jednej
 * serii rysunek jest więc identyczny co do kształtu z rysunkiem poziomów,
 * tylko podziałki mówią "100" zamiast "12,4 mld EUR" - czytelnik traci
 * jednostkę i poziom, a nie dostaje w zamian ani jednego porównania, bo nie
 * ma z czym porównywać. Wartość tego rodzaju powstaje dopiero przy DRUGIM
 * szeregu, gdy wspólny start w stu pozwala porównać tempa.
 */
export const INDEX_BASE_MIN_SERIES = 2;

/**
 * Poniżej tylu okresów nie ma czego indeksować.
 *
 * DWA, bo przy jednym okresie każda seria ma indeks dokładnie sto: rysunek
 * pokazuje wtedy DEFINICJĘ indeksu, a nie dane. Nie jest to defekt
 * arytmetyczny (nic się nie dzieli przez zero), więc próg stoi przy
 * doradzaniu formy, nie przy uczciwości.
 */
export const INDEX_BASE_MIN_PERIODS = 2;

/**
 * Mnożnik rozstępu międzykwartylowego dla ogrodzenia, za którym okres bazowy
 * uznajemy za ODSTAJĄCY od własnego szeregu.
 *
 * 1,5 to KONWENCJA TUKEYA (1977), ta sama, którą dla wąsów skrzynki trzyma
 * `WHISKER_IQR_FACTOR` w `boxplot.ts`. Stała jest tu zdublowana świadomie,
 * a nie z zapomnienia: tam opisuje, które obserwacje rysuje się osobno, tu
 * decyduje, kiedy podpis ostrzega o bazie, i te dwie decyzje wolno w
 * przyszłości rozstrzygnąć inaczej. Uzasadnienie liczby jest wspólne: dla
 * rozkładu normalnego ogrodzenia leżą około 2,7 odchylenia standardowego od
 * średniej, więc poza nimi zostaje około 0,7% obserwacji - tyle, żeby
 * "odstająca" znaczyło "rzadka", a nie "co dziesiąta". Ta rzadkość jest
 * jednocześnie osłoną przed ostrzeżeniem, które widać zawsze: przy 1,0
 * ostrzegałoby o co kilkunastej bazie, przy 3,0 nie ostrzegałoby prawie
 * nigdy.
 */
export const INDEX_BASE_FENCE_IQR_FACTOR = 1.5;

/**
 * Poniżej tylu obserwacji w serii model MILCZY o odstawaniu bazy.
 *
 * PIĘĆ, z tego samego powodu, dla którego `BOXPLOT_MIN_SAMPLE` milczy
 * o kwartylach: przy pięciu obserwacjach zestaw min, Q1, mediana, Q3, max
 * składa się z pięciu RÓŻNYCH pozycji w próbie, czyli ogrodzenie opisuje
 * szereg, a nie samo siebie. Przy n = 4 kwartyle są interpolacjami między
 * dwiema sąsiednimi obserwacjami, więc ogrodzenie wynika z arytmetyki, a nie
 * z danych - a ostrzeżenie wyprowadzone z arytmetyki własnego wzoru jest
 * gorsze niż jego brak, bo autor zacznie przestawiać bazę z powodu, którego
 * w danych nie ma. Konwencja repo: nie ma czego sprawdzać, to model milczy
 * (`null`), a nie zaświadcza.
 */
export const INDEX_BASE_FENCE_MIN_POINTS = 5;

/**
 * Krotność różnicy rzędów wielkości, od której szeregi uznajemy za "o różnej
 * skali", czyli za takie, dla których tabela doboru form przewiduje ten
 * rodzaj.
 *
 * DZIESIĘĆ, i wynika to z pomiaru cudzego, nie z gustu: przy wspólnej osi
 * liniowej seria, której wielkość jest dziesięciokrotnie mniejsza od
 * największej, zajmuje mniej niż dziesiątą część wysokości osi -
 * a `SMALL_MULTIPLES_FLATTENED_SHARE` w `smallMultiples.ts` mierzy właśnie
 * ten próg w pikselach: dziesięć procent osi panelu to około 10 px, czyli
 * mniej niż podwójna grubość linii serii plus średnica kropki obserwacji.
 * Zmiana, która mieści się w grubości własnej linii, nie jest zmianą
 * widoczną. Poniżej tej krotności wspólna oś poziomów jest czytelna, więc
 * indeks nie jest potrzebny i kosztuje czytelnika jednostkę oraz poziom -
 * model to wtedy mówi (`scaleComparable`), ale nie odmawia rysunku:
 * indeksowanie szeregów o zbliżonej skali jest poprawnym sposobem
 * porównywania TEMPA i bywa tym, po co autor przyszedł.
 */
export const INDEX_BASE_COMPARABLE_RATIO = 10;

/**
 * Poniżej tego odchylenia od bazy (w punktach indeksu) uznajemy serię za
 * płaską.
 *
 * 0,05 punktu, bo tyle wynosi połowa ostatniej WYŚWIETLANEJ cyfry:
 * `formatChartValue` w `format.ts` podaje wartości o module co najmniej
 * dziesięć z jednym miejscem po przecinku, więc indeks 100,04 i indeks 100,0
 * są w tabeli i w tooltipie tym samym napisem. Różnica, której nie widać ani
 * na osi, ani w tabeli, nie jest zmiennością, a próg oparty na dokładnym
 * porównaniu z setką uznawałby za zmienność błąd zaokrąglenia podwójnej
 * precyzji na ostatnich bitach.
 */
export const INDEX_BASE_FLAT_TOLERANCE_POINTS = 0.05;

/**
 * Sufit liczby okresów w trybie awaryjnym, gdy autor nie podał ani jednej
 * etykiety osi poziomej.
 *
 * SZEŚĆDZIESIĄT, bo tyle wynosi `MAX_CATEGORIES` w `parse.ts`: konfiguracja
 * z bazy ma najwyżej tyle kategorii, więc model nie ma prawa zamawiać więcej
 * okresów, niż silnik obsługuje. Przy etykietach obecnych sufit nie wchodzi
 * w grę, bo liczbę okresów wyznaczają wtedy same etykiety, już przycięte
 * parserem.
 */
export const INDEX_BASE_MAX_PERIODS = 60;

/**
 * Dlaczego seria wypadła z rysunku. Klucze, nie zdania - słownik tłumaczy je
 * poza tym plikiem.
 *
 *   * `missingBase` - w okresie bazowym seria nie ma wartości. Indeksu nie ma
 *     od czego liczyć;
 *   * `zeroBase` - baza równa zeru. Dzielenie przez zero, a nie "sto
 *     procent";
 *   * `negativeBase` - baza ujemna. Dzielenie jest legalne, ale odwraca
 *     kierunek, więc spadek wyszedłby jako wzrost.
 */
export type IndexBaseRejection = "missingBase" | "zeroBase" | "negativeBase";

/** Skąd wziął się okres bazowy - do podpisu, bo każdy wybór ma być nazwany. */
export type IndexBaseSource = "explicit" | "first" | "none";

/**
 * Przypis przy serii w tabeli danych. Te same fakty co w `honesty`, tylko
 * przypisane do wiersza, bo podpis musi umieć powiedzieć, KTÓRA seria jest
 * wadliwa, a nie tylko że któraś jest.
 */
export type IndexBaseSeriesNote =
  "noBase" | "extremeBase" | "mixedSign" | "unrepresentable" | "flat";

export interface IndexBaseFence {
  lower: number;
  upper: number;
}

export interface IndexBaseSeriesModel {
  /** Pozycja serii w konfiguracji. Kolejność wejściowa jest ZACHOWANA. */
  index: number;
  name: string;
  /** Slot palety 1..10. Model oddaje slot, nigdy koloru. */
  colorSlot: number;
  /**
   * Wartości ŹRÓDŁOWE, w jednostkach danych, tablica długości `periodCount`.
   * `null` = luka. Zostają w modelu, bo tabela tekstowa pokazuje oba odczyty.
   */
  source: (number | null)[];
  /**
   * Indeks, baza = `INDEX_BASE_VALUE`. `null` = luka w danych, brak bazy albo
   * iloraz spoza podwójnej precyzji. Nigdy NaN i nigdy nieskończoność.
   */
  indexed: (number | null)[];
  /** Wartość serii we WSPÓLNYM okresie bazowym; `null` = nie ma jej. */
  base: number | null;
  /** Czy seria wchodzi na rysunek. */
  indexable: boolean;
  /** Nazwana przyczyna wypadnięcia; `null` = seria jest na rysunku ALBO pusta. */
  rejection: IndexBaseRejection | null;
  /** Liczba realnych obserwacji serii. */
  n: number;
  /** Luki w okresach. */
  missing: number;
  /** Mediana wartości źródłowych; `null` = brak obserwacji. */
  median: number | null;
  /**
   * Rozstęp międzykwartylowy; `null` = próba poniżej progu ogrodzenia ALBO
   * różnica kwartyli poza podwójną precyzją (szereg od -1,5e308 do 1,5e308).
   */
  iqr: number | null;
  /**
   * Ogrodzenie Tukeya wokół skrzynki; `null` = próba poniżej progu ALBO
   * granica nie da się zapisać w podwójnej precyzji.
   *
   * TA DRUGA PRZYCZYNA JEST TU NAJWAŻNIEJSZA i nie jest teoretyczna: przy
   * q1 = -5e307 i q3 = 5e307 rozstęp jest SKOŃCZONY (1e308), a obie granice
   * przepełniają się dopiero po pomnożeniu przez `INDEX_BASE_FENCE_IQR_FACTOR`.
   * Wcześniej zapora wyświetlania mapowała je na zero i model orzekał
   * ogrodzeniem `{ lower: 0, upper: 0 }`, wobec którego każda niezerowa baza
   * jest odstająca. `null` znaczy "nie ma czego orzekać" i nic nie orzeka.
   */
  fence: IndexBaseFence | null;
  /**
   * Stosunek bazy do mediany serii - liczba do podpisu, nie wyzwalacz
   * ostrzeżenia (patrz nagłówek pliku). `null`, gdy mediana jest zerem albo
   * gdy nie ma czego dzielić.
   */
  baseToMedian: number | null;
  /**
   * Czy baza leży za ogrodzeniem Tukeya własnego szeregu.
   *
   * `false` znaczy TAKŻE "nie ma ogrodzenia, więc nie ma czym orzekać" - i to
   * jest tu celowe, bo pole musi zgadzać się z agregatem: gdy `fence` jest
   * `null`, `baseTypicalOk` też jest `null`, a seria nie może jednocześnie
   * stać na liście `extremeBaseSeries` pod orzeczeniem, którego nie ma.
   * Twierdzeniem tego pola jest wyłącznie `true`.
   */
  baseIsExtreme: boolean;
  /**
   * Rząd wielkości serii: mediana wartości BEZWZGLĘDNYCH. Z tego liczy się
   * krotność różnicy skal między seriami, bo mediana ze znakiem dawałaby dla
   * szeregu ujemnego liczbę ujemną, a pytanie brzmi o wielkość, nie o znak.
   */
  magnitude: number | null;
  /**
   * Czy seria ma wartości po obu stronach zera przy dodatniej bazie. Indeks
   * jest wtedy raz dodatni, raz ujemny, a odczyt "procent bazy" przestaje
   * być intuicyjny, choć arytmetycznie zostaje poprawny.
   */
  mixedSign: boolean;
  /** Ile punktów wypadło, bo iloraz wyszedł z podwójnej precyzji. */
  unrepresentable: number;
  /** Najniższy i najwyższy policzony indeks; `null` = serii nie ma na rysunku. */
  indexMin: number | null;
  indexMax: number | null;
  /**
   * OSTATNI policzony indeks - do etykiety przy końcu linii (sekcja 4,
   * etykietowanie bezpośrednie przy nie więcej niż czterech szeregach).
   * `null` = serii nie ma na rysunku.
   */
  lastIndex: number | null;
  notes: IndexBaseSeriesNote[];
}

/**
 * SPRAWDZENIA UCZCIWOŚCI. Konwencja repo, ta sama co w sumie kontrolnej
 * mostka (`waterfall.ts`) i w sumie udziałów tarczy (`pieModel`): `null`
 * znaczy NIE MA CZEGO SPRAWDZAĆ, więc model MILCZY, a nie zaświadcza, że
 * jest dobrze; `false` znaczy defekt wykryty arytmetycznie; `true` znaczy
 * sprawdzone i w porządku.
 *
 * Listy nazw są osobne od orzeczeń, bo podpis musi umieć wskazać serię.
 */
export interface IndexBaseHonesty {
  /**
   * Czy żądany okres bazowy leżał w zakresie osi. `false` = żądanie było
   * poza zakresem i model je docisnął do krawędzi, więc baza NIE JEST tą,
   * którą autor podał, i podpis o niej kłamałby. `null` = nikt bazy nie
   * żądał (model wziął pierwszy okres) albo osi nie ma.
   */
  baseInRangeOk: boolean | null;
  /**
   * Czy okres bazowy MA NAZWĘ. `false` = etykieta jest pusta, więc podpis nie
   * ma czym dokończyć zdania "... = 100", a czytelnik nie wie, wobec czego
   * czyta cały wykres. `null` = osi nie ma.
   */
  baseNamedOk: boolean | null;
  /**
   * Czy każda seria Z DANYMI ma użyteczną bazę. `false` = co najmniej jedna
   * wypadła (brak wartości, zero albo liczba ujemna w okresie bazowym), więc
   * na rysunku jej NIE MA - a seria nieobecna wśród obecnych czyta się jako
   * "nie było takiego szeregu", nie jako "nie dało się go zaindeksować".
   * `null` = żadna seria nie ma danych.
   */
  baseUsableOk: boolean | null;
  /** Nazwy serii, które wypadły z rysunku. */
  noBaseSeries: string[];
  /**
   * Czy okres bazowy jest TYPOWY dla szeregów. `false` = w co najmniej
   * jednej serii baza leży za ogrodzeniem Tukeya, czyli cały indeks tej serii
   * jest wyolbrzymiony jednym nietypowym okresem. `null` = ani jedna seria na
   * rysunku nie ma ogrodzenia: albo próba jest za mała, żeby cokolwiek
   * znaczyło, albo granice wyszły poza podwójną precyzję. Milczenie jest tu
   * jedynym uczciwym wyjściem - `false` z ogrodzenia sprowadzonego zaporą do
   * `{ lower: 0, upper: 0 }` ostrzegałoby o każdej niezerowej bazie.
   */
  baseTypicalOk: boolean | null;
  /** Nazwy serii, dla których baza jest odstająca. */
  extremeBaseSeries: string[];
  /**
   * Czy indeks każdego punktu daje się zapisać w podwójnej precyzji. `false`
   * = iloraz przekroczył zakres liczb (baza rzędu 1e-300 przy wartościach
   * rzędu 1e10) i punkt wypadł. Wypadnięcie jest tu jedynym uczciwym
   * wyjściem: zapora sprowadzająca nieskończoność do zera postawiłaby punkt
   * na dnie osi, czyli skłamała o liczbie zamiast o niej zamilczeć.
   * `null` = nie ma ani jednego punktu na rysunku.
   */
  indexRepresentableOk: boolean | null;
  /** Nazwy serii, w których jakiś punkt wypadł z powodu zakresu liczb. */
  unrepresentableSeries: string[];
  /**
   * Czy szeregi trzymają jeden znak. `false` = któryś przechodzi przez zero,
   * więc jego indeks jest raz dodatni, raz ujemny, a odczyt "procent bazy"
   * przestaje być czytelny (indeks -40 nie znaczy "spadek o 40%").
   * `null` = nic nie jest indeksowane.
   */
  signStableOk: boolean | null;
  /** Nazwy serii przechodzących przez zero. */
  mixedSignSeries: string[];
  /**
   * Czy na rysunku JEST zmienność. `false` = wszystkie indeksy siedzą
   * w setce, czyli wszystkie linie leżą na linii odniesienia i rysunek nie
   * mówi nic, czego nie powiedziałoby jedno zdanie. `null` = nie ma ani
   * jednego punktu.
   */
  spreadOk: boolean | null;
  /**
   * Czy każda liczba z danych ma swój okres na osi. `false` = w serii są
   * wartości za ostatnią kategorią, czyli liczby, których nie ma ani na
   * rysunku, ani w tabeli. `null` = w danych nie ma ani jednej liczby.
   */
  pointsInPeriodsOk: boolean | null;
  /** Ile liczb wypadło poza oś okresów. */
  droppedValueCount: number;
  /**
   * Czy `sampleSize` z konfiguracji zgadza się z liczbą okresów, w których
   * cokolwiek zmierzono. Sekcja 8 każe podać `n` w podpisie; jeżeli autor
   * podaje je ręcznie, a w bloku siedzi inna liczba okresów, to podpis kłamie
   * o próbce. `null` = autor nie podał `n` albo nie ma danych.
   */
  declaredSampleOk: boolean | null;
  /**
   * Liczba okresów, W KTÓRYCH COKOLWIEK ZMIERZONO - czyli dokładnie ta liczba,
   * którą `declaredSampleOk` porównuje z `sampleSize` z konfiguracji.
   *
   * Pole istnieje, bo samo orzeczenie nie wystarcza do napisania zdania:
   * „w podpisie stoi n = X, a okresów z pomiarem jest Y" nie ma skąd wziąć Y.
   * Render liczył je sobie drugi raz tym samym `reduce`, a drugi zapis tej
   * samej decyzji rozjeżdża się przy pierwszej zmianie definicji - i wtedy
   * zdanie mówi co innego niż orzeczenie, które je wywołało.
   */
  measuredPeriods: number;
}

export interface IndexBaseModel {
  /** Serie w KOLEJNOŚCI WEJŚCIOWEJ - patrz nagłówek pliku. */
  series: IndexBaseSeriesModel[];
  /** Etykiety okresów, dokładnie `periodCount` sztuk. */
  periods: string[];
  periodCount: number;
  /** WSPÓLNY okres bazowy (indeks kategorii); `null` = osi nie ma. */
  baseAt: number | null;
  /** Etykieta okresu bazowego - do podpisu "... = 100". */
  baseLabel: string;
  baseSource: IndexBaseSource;
  /** Linia odniesienia na osi wartości, czyli `INDEX_BASE_VALUE`. */
  baseline: number;
  /** Co niesie oś wartości. Jedna możliwość, bo rodzaj ma jeden odczyt. */
  valueEncodes: "index";
  /** Jednostka osi wartości: NIE MA. Indeks jest bezwymiarowy. */
  unit: null;
  /** Jednostka wejścia - WYŁĄCZNIE do kolumny wartości źródłowych. */
  sourceUnit: string;
  /** Ile serii jest na rysunku. */
  indexedCount: number;
  /** Ile serii Z DANYMI wypadło. Seria pusta nie jest odrzucona - jej nie ma. */
  droppedCount: number;
  /**
   * Najwcześniejszy okres, w którym KAŻDA seria z danymi ma bazę użyteczną.
   * `null` = takiego okresu nie ma. Bez tego pola porada "wybierz inny okres
   * bazowy" nie mówi, który okres wybrać, więc jest poradą bezużyteczną.
   */
  firstUsableBaseAt: number | null;
  /**
   * Krotność różnicy rzędów wielkości między seriami (największa wielkość
   * przez najmniejszą). To liczba, która ODPOWIADA NA PYTANIE Z TABELI
   * doboru form ("kilka szeregów o różnej skali?") i jedzie do podpisu.
   * `null` = mniej niż dwie serie z niezerową wielkością.
   */
  levelRatio: number | null;
  /**
   * Czy oś wartości NIE obejmuje zera. Prawie zawsze prawda i to jest w tym
   * rodzaju w porządku (sekcja 8 nie wymaga zera dla linii), ale ucięcie
   * musi być NAZWANE - dlatego jest polem modelu, a nie milczącym założeniem.
   */
  axisTruncatedFromZero: boolean;
  honesty: IndexBaseHonesty;
}

export interface IndexBaseInput {
  /** Etykiety okresów - oś pozioma. Jedna kategoria to jeden okres. */
  categories: readonly string[];
  series: readonly ChartSeries[];
}

export interface IndexBaseOptions {
  /**
   * WSPÓLNY okres bazowy. Jedna liczba, nie tablica, i to jest osłona
   * strukturalna, nie oszczędność zapisu (patrz nagłówek pliku). Domyślnie
   * pierwszy okres, bo tak czyta się indeks w opracowaniach statystycznych
   * i bo wybór jest wtedy WIDOCZNY: wiersz bazowy jest w tabeli oznaczony,
   * a podpis nazywa okres. `null` i `undefined` znaczą "nie podano".
   */
  baseAt?: number | null;
  /** `ChartConfig.sampleSize` - do sprawdzenia zgodności podpisu z próbką. */
  declaredSampleSize?: number | null;
  /** `ChartConfig.unit` - jednostka WEJŚCIA, nie osi. */
  sourceUnit?: string;
  /**
   * Ile liczb ODRZUCIŁ JUŻ WYWOŁUJĄCY, bo nie miały swojej kategorii.
   *
   * Model liczy nadmiar sam, ale widzi tylko to, co do niego dotarło - a na
   * drodze z bloku parser przycina serie do liczby kategorii, ZANIM model je
   * zobaczy (musi: rendery kartezjańskie chodzą po `values` bez ograniczenia,
   * więc nadmiarowa liczba narysowałaby punkt za osią). Bez tej opcji
   * orzeczenie o liczbach bez kategorii było na tej drodze martwe: zapalało
   * się wyłącznie w testach, które budowały wejście z ręki.
   */
  valuesBeyondCategories?: number;
}

/** Liczba albo `null`. Jedno miejsce, w którym `Infinity` i `NaN` z bazy giną. */
function liczba(value: number | null | undefined): number | null {
  return value === null || value === undefined || !Number.isFinite(value) ? null : value;
}

/**
 * Ostatnia zapora przed nieliczbą w polu modelu. Nie zastępuje osłon przy
 * dzieleniu - tam wynikiem jest przemyślany `null`, a nie zamiatanie. Ta
 * funkcja jest bramką na wyjściu: konfiguracja przychodzi z bazy i może być
 * z wersji edytora, której ten kod nie zna, a jedno NaN w polu modelu wychodzi
 * na stronie jako napis "NaN" w tabeli danych (bramka `blockMatrix` sprawdza
 * `textContent` bloków właśnie na te napisy).
 */
function pewna(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/**
 * Zakres osi wartości POLICZONY W JEDNYM MIEJSCU, żeby model i `indexBaseExtent`
 * nie mogły się rozejść. Zawsze obejmuje linię odniesienia, bo od niej czyta
 * się każdą wartość - oś bez setki pokazywałaby odchylenia bez punktu, od
 * którego są liczone.
 */
function granice(
  series: readonly IndexBaseSeriesModel[],
  baseline: number,
): {
  min: number;
  max: number;
} {
  let min = baseline;
  let max = baseline;
  for (const s of series) {
    if (s.indexMin !== null && s.indexMin < min) min = s.indexMin;
    if (s.indexMax !== null && s.indexMax > max) max = s.indexMax;
  }
  return { min: pewna(min), max: pewna(max) };
}

/**
 * Model indeksu z wejścia silnika. Funkcja NIGDY nie rzuca i nigdy nie
 * zwraca NaN ani nieskończoności, bo treść bloku przychodzi z bazy i może być
 * z wersji edytora, której ten kod nie zna: zero serii, seria samych luk,
 * jeden okres, baza zerowa, wartości ujemne, wartości na krawędzi podwójnej
 * precyzji.
 *
 * Funkcja jest DETERMINISTYCZNA: nie ma w niej ani `Math.random`, ani
 * `Date.now`, więc ten sam zbiór danych zawsze daje ten sam wynik - inaczej
 * migawki testowe i zrzuty ekranu byłyby nieporównywalne między renderami.
 */
export function indexBaseModel(input: IndexBaseInput, opts: IndexBaseOptions = {}): IndexBaseModel {
  const sourceUnit = opts.sourceUnit ?? "";
  const wejscie = input.series;

  // LICZBA OKRESÓW. Etykiety są osią poziomą, więc gdy autor je podał, one
  // rozstrzygają - a parser i tak przyciął je do `MAX_CATEGORIES`. Gdy nie
  // podał ani jednej, seria nie może wyparować: oś dostaje tyle okresów, ile
  // ma najdłuższa seria (do sufitu), etykiety zostają puste, a `baseNamedOk`
  // mówi, że podpis nie ma czym dokończyć zdania o bazie. Odwrotna decyzja -
  // zero okresów przy braku etykiet - kasowałaby z rysunku dane, które autor
  // widzi w arkuszu, i nie dawałaby mu żadnej wskazówki, czego brakuje.
  const najdluzsza = wejscie.reduce((a, s) => Math.max(a, s.values.length), 0);
  const periodCount =
    input.categories.length > 0
      ? input.categories.length
      : Math.min(INDEX_BASE_MAX_PERIODS, najdluzsza);
  const periods = Array.from({ length: periodCount }, (_, i) => input.categories[i] ?? "");

  // OKRES BAZOWY. Żądanie spoza zakresu jest dociskane do krawędzi
  // i ZGŁASZANE: baza podmieniona po cichu znaczy, że podpis mówi o innym
  // okresie niż rysunek, a tego nie widać nigdzie.
  const zadany = liczba(opts.baseAt ?? null);
  let baseAt: number | null = null;
  let baseSource: IndexBaseSource = "none";
  let baseInRangeOk: boolean | null = null;
  if (periodCount > 0) {
    if (zadany === null) {
      baseAt = 0;
      baseSource = "first";
    } else {
      const zaokraglony = Math.round(zadany);
      baseAt = Math.min(periodCount - 1, Math.max(0, zaokraglony));
      baseSource = "explicit";
      baseInRangeOk = baseAt === zaokraglony;
    }
  }

  let droppedValueCount = Math.max(0, Math.trunc(opts.valuesBeyondCategories ?? 0));
  const series: IndexBaseSeriesModel[] = wejscie.map((s, seriesIndex) => {
    const source = Array.from({ length: periodCount }, (_, i) => liczba(s.values[i]));
    // Liczby za ostatnim okresem nie mają czym być opisane, więc nie ma ich
    // ani na rysunku, ani w tabeli - i to musi być widoczne, a nie
    // przemilczane.
    for (let i = periodCount; i < s.values.length; i++) {
      if (liczba(s.values[i]) !== null) droppedValueCount++;
    }

    const obserwacje = source.filter((v): v is number => v !== null);
    const n = obserwacje.length;
    const posortowane = [...obserwacje].sort((a, b) => a - b);
    // KWANTYL PRZYCHODZI ZE `stats.ts`, a nie stoi tu własną kopią - i nie
    // jest to sprzątanie powtórzeń. Kopia liczyła interpolację inaczej niż
    // skrzynka (`a + (b-a)*t` zamiast mieszania `a*(1-t) + b*t`), a komentarz
    // nad nią ZAPEWNIAŁ, że to "ta sama definicja, którą trzyma boxplot.ts".
    // Dla szeregu rozciągniętego od -1e308 do 1e308 różnica `b - a` wychodzi
    // z podwójnej precyzji, więc ten sam szereg pokazywał inny kwartyl na
    // skrzynce i inny w indeksie. Teraz gwarancją jest IMPORT, nie obietnica
    // w komentarzu, a `null` znaczy "nie ma czego orzekać".
    const median = n > 0 ? quantile(posortowane, 0.5) : null;

    // OGRODZENIE TUKEYA liczone na całym szeregu, RAZEM z bazą. Baza jest
    // jedną z obserwacji tego szeregu, więc wyjęcie jej z próby zmieniałoby
    // kwartyle po to, żeby ocenić ją samą - tak samo skrzynka wyznacza wąsy
    // na próbie zawierającej obserwacje odstające.
    //
    // GRANICE LICZY `tukeyFence`, KTÓRE MILCZY, i to jest naprawa defektu
    // arytmetycznego, nie zmiana stylu. Poprzednia wersja sprawdzała na
    // skończoność sam ROZSTĘP, a granice przepuszczała przez `pewna`. Przy
    // q1 = -5e307 i q3 = 5e307 rozstęp wynosi 1e308 i JEST skończony, więc
    // sprawdzenie go przepuszczało szereg dalej, a obie granice przepełniały
    // się dopiero po pomnożeniu przez 1,5 - i `pewna` mapowała je na zero.
    // Ogrodzenie `{ lower: 0, upper: 0 }` nie jest awarią, którą ktoś
    // zauważy: jest legalnym ogrodzeniem, wobec którego KAŻDA baza różna od
    // zera zostaje ogłoszona odstającą. Na granicy orzeczenia jedyną uczciwą
    // odpowiedzią jest `null`, dokładnie tak jak przy niepoliczalnym
    // rozstępie.
    const ogrodzenieMaSens = n >= INDEX_BASE_FENCE_MIN_POINTS;
    const rozstep = ogrodzenieMaSens ? iqr(posortowane) : null;
    const fence = ogrodzenieMaSens ? tukeyFence(posortowane, INDEX_BASE_FENCE_IQR_FACTOR) : null;

    const base = baseAt === null ? null : source[baseAt];
    // O UŻYTECZNOŚCI BAZY ROZSTRZYGA `baseUsable` I NIKT INNY. Ta sama
    // decyzja stała dotąd w dwóch miejscach tego pliku (tu i w
    // `firstUsableBaseAt`) oraz w modelu paneli, a pilnował jej komentarz -
    // czyli nic. Werdykt jest nazwany, bo każdy z trzech powodów jest dla
    // czytelnika innym zdaniem, a `rejection` musi mieć czym je rozróżnić.
    const uzytecznosc = baseUsable(base);
    const indexable = uzytecznosc === "ok";
    // Seria BEZ ANI JEDNEJ LICZBY nie jest odrzucona - nie ma jej. Serię
    // dopisaną w edytorze i jeszcze niewypełnioną autor widzi jako pusty
    // wiersz, więc ostrzeżenie "seria wypadła z rysunku" byłoby ostrzeżeniem
    // o jego własnym, świadomym stanie pracy (ta sama decyzja, którą przy
    // pierwszej serii z danymi podejmuje `histogramModelFromConfig`).
    const rejection: IndexBaseRejection | null =
      n === 0 || indexable
        ? null
        : uzytecznosc === "missing"
          ? "missingBase"
          : uzytecznosc === "zero"
            ? "zeroBase"
            : "negativeBase";

    const indexed: (number | null)[] = new Array<number | null>(periodCount).fill(null);
    let unrepresentable = 0;
    let indexMin: number | null = null;
    let indexMax: number | null = null;
    let lastIndex: number | null = null;
    if (indexable && base !== null) {
      for (let i = 0; i < periodCount; i++) {
        const v = source[i];
        if (v === null) continue;
        // PRZELICZENIE LICZY `indexAgainst`, więc kolejność działań stoi
        // w jednym miejscu dla całego silnika. Dzieli PRZED mnożeniem
        // (`(v / baza) * 100`, nigdy `v * 100 / baza`), bo druga postać
        // przepełnia się dla wartości rzędu 1e307, choć sam iloraz jest tam
        // malutki - czyli gubiłaby punkty, którym nic nie zagraża. Defekt,
        // który znika: setka we wzorze i setka na linii odniesienia były
        // dwiema niezależnymi liczbami.
        const idx = indexAgainst(v, base);
        if (idx === null) {
          unrepresentable++;
          continue;
        }
        indexed[i] = idx;
        if (indexMin === null || idx < indexMin) indexMin = idx;
        if (indexMax === null || idx > indexMax) indexMax = idx;
        lastIndex = idx;
      }
    }

    const magnitude =
      n > 0
        ? quantile(
            obserwacje.map((v) => Math.abs(v)).sort((a, b) => a - b),
            0.5,
          )
        : null;
    const baseToMedian =
      base !== null && median !== null && median !== 0 && Number.isFinite(base / median)
        ? base / median
        : null;
    // Odstawanie bazy orzekamy TYLKO dla serii, która jest na rysunku:
    // w serii odrzuconej nie ma indeksu, który baza mogłaby wyolbrzymić,
    // a przyczynę wypadnięcia mówi już `rejection`.
    const baseIsExtreme =
      indexable && base !== null && fence !== null && (base < fence.lower || base > fence.upper);
    const mixedSign = indexable && obserwacje.some((v) => v < 0);
    const plaska =
      indexable &&
      indexMin !== null &&
      indexMax !== null &&
      Math.abs(indexMin - INDEX_BASE_VALUE) <= INDEX_BASE_FLAT_TOLERANCE_POINTS &&
      Math.abs(indexMax - INDEX_BASE_VALUE) <= INDEX_BASE_FLAT_TOLERANCE_POINTS;

    const notes: IndexBaseSeriesNote[] = [];
    if (rejection !== null) notes.push("noBase");
    if (baseIsExtreme) notes.push("extremeBase");
    if (mixedSign) notes.push("mixedSign");
    if (unrepresentable > 0) notes.push("unrepresentable");
    if (plaska) notes.push("flat");

    return {
      index: seriesIndex,
      name: s.name,
      colorSlot: Math.max(1, Math.floor(liczba(s.colorSlot) ?? seriesIndex + 1)),
      source,
      indexed,
      base: base === null ? null : pewna(base),
      indexable,
      rejection,
      n,
      missing: periodCount - n,
      // BEZ `pewna` NA TRZECH STATYSTYKACH POZYCYJNYCH. To nie współrzędne
      // rysunku, tylko twierdzenia o danych, a `stats.ts` oddaje je już jako
      // `number | null` - zapora sprowadzająca przepełnienie do zera dopisałaby
      // tu z powrotem defekt, który właśnie zniknął z ogrodzenia: medianę
      // równą zeru dla szeregu, w którym zera nie ma.
      median,
      iqr: rozstep,
      fence,
      baseToMedian: baseToMedian === null ? null : pewna(baseToMedian),
      baseIsExtreme,
      magnitude,
      mixedSign,
      unrepresentable,
      indexMin: indexMin === null ? null : pewna(indexMin),
      indexMax: indexMax === null ? null : pewna(indexMax),
      lastIndex: lastIndex === null ? null : pewna(lastIndex),
      notes,
    };
  });

  const zDanymi = series.filter((s) => s.n > 0);
  const naRysunku = series.filter((s) => s.indexable);
  const odrzucone = series.filter((s) => s.rejection !== null);
  const zOgrodzeniem = naRysunku.filter((s) => s.fence !== null);
  const zPunktami = naRysunku.filter((s) => s.indexMin !== null);

  // Najwcześniejszy okres, w którym KAŻDA seria z danymi ma bazę użyteczną.
  // Bez tej liczby porada "wybierz inny okres bazowy" nie mówi, który.
  let firstUsableBaseAt: number | null = null;
  if (zDanymi.length > 0) {
    for (let p = 0; p < periodCount; p++) {
      // Ten sam werdykt, którym o bazie rozstrzyga pętla wyżej. Wcześniej
      // stał tu drugi, ręcznie przepisany warunek - a dwa zapisy tej samej
      // decyzji to dwie decyzje, które wolno rozjechać jedną poprawką.
      const wszystkie = zDanymi.every((s) => baseUsable(s.source[p]) === "ok");
      if (wszystkie) {
        firstUsableBaseAt = p;
        break;
      }
    }
  }

  // KROTNOŚĆ RÓŻNICY SKAL liczona na wielkościach wszystkich serii z danymi,
  // także odrzuconych: pytanie "czy szeregi są o różnej skali" dotyczy
  // DANYCH, a nie tego, które z nich udało się zaindeksować.
  const wielkosci = zDanymi.map((s) => s.magnitude).filter((m): m is number => m !== null && m > 0);
  const levelRatio =
    wielkosci.length >= 2 && Math.min(...wielkosci) > 0
      ? pewna(Math.max(...wielkosci) / Math.min(...wielkosci))
      : null;

  const okresyZDanymi = periods.reduce(
    (a, _label, i) => a + (series.some((s) => s.source[i] !== null) ? 1 : 0),
    0,
  );
  const declared = liczba(opts.declaredSampleSize ?? null);
  const wszystkieLiczby = zDanymi.reduce((a, s) => a + s.n, 0) + droppedValueCount;
  const zmiennosc = zPunktami.some(
    (s) =>
      (s.indexMin !== null &&
        Math.abs(s.indexMin - INDEX_BASE_VALUE) > INDEX_BASE_FLAT_TOLERANCE_POINTS) ||
      (s.indexMax !== null &&
        Math.abs(s.indexMax - INDEX_BASE_VALUE) > INDEX_BASE_FLAT_TOLERANCE_POINTS),
  );

  const honesty: IndexBaseHonesty = {
    baseInRangeOk,
    baseNamedOk: baseAt === null ? null : periods[baseAt].trim() !== "",
    baseUsableOk: zDanymi.length === 0 ? null : odrzucone.length === 0,
    noBaseSeries: odrzucone.map((s) => s.name),
    baseTypicalOk: zOgrodzeniem.length === 0 ? null : zOgrodzeniem.every((s) => !s.baseIsExtreme),
    extremeBaseSeries: naRysunku.filter((s) => s.baseIsExtreme).map((s) => s.name),
    indexRepresentableOk:
      naRysunku.length === 0 ? null : naRysunku.every((s) => s.unrepresentable === 0),
    unrepresentableSeries: naRysunku.filter((s) => s.unrepresentable > 0).map((s) => s.name),
    signStableOk: naRysunku.length === 0 ? null : naRysunku.every((s) => !s.mixedSign),
    mixedSignSeries: naRysunku.filter((s) => s.mixedSign).map((s) => s.name),
    spreadOk: zPunktami.length === 0 ? null : zmiennosc,
    pointsInPeriodsOk: wszystkieLiczby === 0 ? null : droppedValueCount === 0,
    droppedValueCount,
    declaredSampleOk:
      declared === null || okresyZDanymi === 0 ? null : Math.floor(declared) === okresyZDanymi,
    measuredPeriods: okresyZDanymi,
  };

  const zakres = granice(series, INDEX_BASE_VALUE);

  return {
    series,
    periods,
    periodCount,
    baseAt,
    baseLabel: baseAt === null ? "" : periods[baseAt],
    baseSource,
    baseline: INDEX_BASE_VALUE,
    valueEncodes: "index",
    unit: null,
    sourceUnit,
    indexedCount: naRysunku.length,
    droppedCount: odrzucone.length,
    firstUsableBaseAt,
    levelRatio,
    axisTruncatedFromZero: zakres.min > 0,
    honesty,
  };
}

/**
 * Model z konfiguracji bloku, czyli z tego, co silnik już ma. `categories` to
 * OKRESY (oś pozioma), a `series[i].values` to szeregi - dokładnie tak, jak
 * wygląda wejście wykresu liniowego, bo indeks jest wykresem liniowym
 * o przeliczonej osi wartości, a nie osobnym kształtem danych.
 *
 * OKRES BAZOWY ZOSTAJE W OPCJACH, a nie jest zgadywany z konfiguracji. Można
 * by go wziąć z `forecastFrom` albo z pierwszego okresu, w którym wszystkie
 * serie mają dane - i to drugie model nawet liczy (`firstUsableBaseAt`) - ale
 * jedno i drugie byłoby zgadywaniem intencji autora, a pomyłka nie wyglądałaby
 * na błąd: wykres rysuje się normalnie, tylko wszystkie liczby są odniesione
 * do innego roku. Wybór bazy jest wyborem analitycznym i musi być jawny.
 */
export function indexBaseModelFromConfig(
  config: ChartConfig,
  opts: Omit<IndexBaseOptions, "declaredSampleSize" | "sourceUnit"> = {},
): IndexBaseModel {
  return indexBaseModel(
    { categories: config.categories, series: config.series },
    {
      ...opts,
      declaredSampleSize: config.sampleSize,
      sourceUnit: config.unit,
      valuesBeyondCategories: config.valuesBeyondCategories,
    },
  );
}

/**
 * Zakres osi wartości w PUNKTACH INDEKSU.
 *
 * ZAWSZE OBEJMUJE LINIĘ ODNIESIENIA (sto), bo od niej czyta się każdą
 * wartość: oś, która setki nie zawiera, pokazuje odchylenia bez punktu, od
 * którego są liczone - ten sam argument stoi za `tornadoExtent` i za linią
 * bazową mostka.
 *
 * NIE OBEJMUJE ZERA I NIE MA GO OBEJMOWAĆ. Sekcja 8 wymaga zera dla
 * znaczników kodujących DŁUGOŚĆ (słupki, pola), a indeks jest linią, czyli
 * koduje POŁOŻENIE. Wymuszenie zera zepchnęłoby tu całą zmienność w górne
 * dziesięć procent osi - przy indeksach od 96 do 118 zmiany zniknęłyby
 * w grubości linii, czyli oś "uczciwa" dałaby rysunek mówiący "nic się nie
 * działo". Ucięcie jest za to NAZWANE (`axisTruncatedFromZero`), żeby podpis
 * je wypisał.
 */
export function indexBaseExtent(model: IndexBaseModel): { min: number; max: number } {
  return granice(model.series, model.baseline);
}

/**
 * PORADY DOBORU FORMY - osobno od uczciwości, bo to nie defekty arytmetyczne,
 * tylko sygnały, że pytanie analityczne lepiej postawić inaczej. Tak samo jak
 * `pieFormAdvice` w `../honesty` i `histogramFormAdvice`.
 *
 *   * `baseUnusable` - żadnej serii nie da się zaindeksować, więc wykresu nie
 *     ma; autor musi zmienić okres bazowy (`firstUsableBaseAt` mówi, na
 *     który);
 *   * `seriesDropped` - część serii wypadła. Wykres jest, ale niekompletny,
 *     a seria nieobecna wśród obecnych czyta się jako "nie było takiego
 *     szeregu";
 *   * `singleSeries` - indeks jednej serii nie wnosi nic; wykres liniowy
 *     w jednostkach autora pokaże ten sam kształt i zostawi poziom;
 *   * `shortSeries` - poniżej dwóch okresów rysunek pokazuje definicję
 *     indeksu, nie dane;
 *   * `extremeBase` - okres bazowy odstaje od szeregu, więc cały indeks jest
 *     wyolbrzymiony jednym nietypowym okresem;
 *   * `mixedSign` - szereg przechodzi przez zero, więc odczyt "procent bazy"
 *     przestaje być czytelny; wtedy uczciwsze są poziomy albo panele;
 *   * `noSpread` - wszystkie linie leżą na linii odniesienia; to informacja
 *     na jedno zdanie, nie na rysunek;
 *   * `scaleComparable` - szeregi są tego samego rzędu wielkości, czyli
 *     przesłanki z tabeli doboru form nie ma; wspólna oś poziomów jest
 *     czytelna i zostawia jednostkę;
 *   * `tooManySeries` - powyżej zestawu bezpiecznego dla daltonizmu kolor
 *     przestaje nieść kategorię (sekcja 2); wtedy właściwa jest druga forma
 *     z tego samego wiersza tabeli, czyli small multiples.
 */
export type IndexBaseFormAdvice =
  | "baseUnusable"
  | "seriesDropped"
  | "singleSeries"
  | "shortSeries"
  | "extremeBase"
  | "mixedSign"
  | "noSpread"
  | "scaleComparable"
  | "tooManySeries";

export function indexBaseFormAdvice(model: IndexBaseModel): IndexBaseFormAdvice[] {
  const advice: IndexBaseFormAdvice[] = [];
  // Brak danych to brak porad: pusty blok w edytorze nie jest błędem doboru
  // formy, a lista ostrzeżeń pod pustym wykresem uczy ignorowania ostrzeżeń.
  const zDanymi = model.series.filter((s) => s.n > 0);
  if (zDanymi.length === 0) return advice;

  if (model.indexedCount === 0) {
    // Wykresu nie ma - to jedyna porada, która ma tu sens, więc reszta nie
    // dopisuje szumu do komunikatu o rzeczy najważniejszej.
    advice.push("baseUnusable");
    return advice;
  }
  if (model.droppedCount > 0) advice.push("seriesDropped");
  if (model.indexedCount < INDEX_BASE_MIN_SERIES) advice.push("singleSeries");
  if (model.periodCount < INDEX_BASE_MIN_PERIODS) advice.push("shortSeries");
  if (model.honesty.baseTypicalOk === false) advice.push("extremeBase");
  if (model.honesty.signStableOk === false) advice.push("mixedSign");
  if (model.honesty.spreadOk === false) advice.push("noSpread");
  if (model.levelRatio !== null && model.levelRatio < INDEX_BASE_COMPARABLE_RATIO) {
    advice.push("scaleComparable");
  }
  if (model.indexedCount > CATEGORICAL_SAFE_SERIES) advice.push("tooManySeries");
  return advice;
}

/**
 * Kolumny tabeli danych. Klucze, nie nagłówki - słownik tłumaczy je poza tym
 * plikiem.
 *
 * `source` I `index` STOJĄ OBOK SIEBIE i to jest najważniejsza cecha tej
 * tabeli. Rysunek pokazuje TEMPO i nie ma na nim ani jednostki, ani poziomu;
 * gdyby tabela powtarzała sam indeks, wartości źródłowe nie istniałyby
 * w bloku nigdzie, a wtedy indeks nie byłby przeliczeniem, tylko podmianą
 * danych.
 */
export const INDEX_BASE_COLUMNS = ["period", "source", "index"] as const;

export type IndexBaseColumnKey = (typeof INDEX_BASE_COLUMNS)[number];

export interface IndexBaseTableCell {
  /** Pozycja serii w konfiguracji - kolejność kolumn jest kolejnością legendy. */
  seriesIndex: number;
  series: string;
  /** Wartość źródłowa w jednostkach danych; `null` = luka. */
  source: number | null;
  /** Indeks; `null` = luka, brak bazy albo iloraz spoza podwójnej precyzji. */
  indexed: number | null;
}

export interface IndexBaseTableRow {
  /** Pozycja okresu na osi. */
  period: number;
  label: string;
  /**
   * Czy to WIERSZ BAZOWY. Render ma go oznaczyć, bo w nim każda seria
   * na rysunku ma dokładnie sto - i to jest jedyne miejsce, w którym
   * czytelnik widzi, wobec czego czyta cały wykres.
   */
  isBase: boolean;
  cells: IndexBaseTableCell[];
}

export interface IndexBaseTableSeries {
  index: number;
  name: string;
  /** Wartość bazowa w jednostkach danych; `null` = nie ma jej. */
  base: number | null;
  /** Stosunek bazy do mediany serii - liczba stojąca za ostrzeżeniem o bazie. */
  baseToMedian: number | null;
  rejection: IndexBaseRejection | null;
  notes: IndexBaseSeriesNote[];
}

export interface IndexBaseTable {
  columns: readonly IndexBaseColumnKey[];
  /** Wiersze w kolejności OKRESÓW, czyli tej samej co oś pozioma. */
  rows: IndexBaseTableRow[];
  /**
   * Podsumowanie serii - także tych, które wypadły z rysunku. Ich liczby
   * źródłowe zostają w wierszach, bo dane, których autor nie zobaczy nigdzie,
   * są dla niego tym samym co dane, których nie ma.
   */
  series: IndexBaseTableSeries[];
  baseAt: number | null;
  baseLabel: string;
  baseSource: IndexBaseSource;
  baseline: number;
  /** Jednostka kolumny `source`. */
  sourceUnit: string;
  /** Jednostka kolumny `index`: NIE MA. Indeks jest bezwymiarowy. */
  indexUnit: null;
}

/**
 * ALTERNATYWA TEKSTOWA: co ma pokazać tabela danych pod wykresem. Grafika
 * nigdy nie jest jedyną drogą do liczby - linii na indeksie nie odczyta ekran
 * czytający, wydruk w skali szarości gubi kolory serii, a z samej linii nie
 * da się odczytać wartości dokładniej niż "mniej więcej".
 *
 * TABELA LICZY Z GOTOWEGO MODELU, a nie po raz drugi z danych. Gdyby liczyła
 * sama, mogłaby wziąć inną bazę niż rysunek - i czytelnik miałby dwie różne
 * liczby na to samo, co jest gorsze niż brak tabeli.
 */
export function indexBaseTable(model: IndexBaseModel): IndexBaseTable {
  return {
    columns: INDEX_BASE_COLUMNS,
    rows: model.periods.map((label, i) => ({
      period: i,
      label,
      isBase: model.baseAt === i,
      cells: model.series.map((s) => ({
        seriesIndex: s.index,
        series: s.name,
        source: s.source[i],
        indexed: s.indexed[i],
      })),
    })),
    series: model.series.map((s) => ({
      index: s.index,
      name: s.name,
      base: s.base,
      baseToMedian: s.baseToMedian,
      rejection: s.rejection,
      notes: s.notes,
    })),
    baseAt: model.baseAt,
    baseLabel: model.baseLabel,
    baseSource: model.baseSource,
    baseline: model.baseline,
    sourceUnit: model.sourceUnit,
    indexUnit: null,
  };
}
