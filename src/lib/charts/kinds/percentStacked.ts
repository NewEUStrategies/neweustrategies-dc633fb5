// Model słupka skumulowanego 100% - STRUKTURA CAŁOŚCI.
//
// PYTANIE ANALITYCZNE, KTÓREGO DOTYCZY. Tabela doboru formy (sekcja 1
// specyfikacji) stawia ten rodzaj w wierszu "Struktura całości", a w kolumnie
// "Czego unikać" ma przy nim dwie pozycje: "kołowy pełny, pierścień z >5
// kategoriami". To jest cała racja bytu tego modelu - jest ZAMIENNIKIEM
// tarczy kołowej powyżej pięciu kategorii, a nie jej ozdobniejszą wersją.
// Tarcza koduje udział KĄTEM i POWIERZCHNIĄ, czyli dwoma kanałami z dolnej
// połowy hierarchii percepcyjnej Clevelanda i McGilla; słupek 100% koduje go
// DŁUGOŚCIĄ.
//
// I tu jedna uczciwa uwaga, bo hasło "wspólna skala" jest w tym rodzaju
// prawdziwe tylko w połowie: na wspólnej skali (kanał pierwszy) leży
// wyłącznie segment PRZY KRAWĘDZI ODNIESIENIA, bo tylko on zaczyna się
// w zerze. Segmenty środkowe leżą na skalach równoległych, ale przesuniętych
// (kanał drugi), a ich długość odczytuje się jako różnicę dwóch krawędzi.
// Nadal są to dwa kanały WYŻEJ niż kąt i powierzchnia, więc zamiana tarczy na
// ten rodzaj jest wygraną - ale wynikają z niej dwie rzeczy, które ten moduł
// realizuje wprost:
//   * kolejność serii JEST decyzją analityczną, bo pierwsza seria dostaje
//     wspólną skalę. Dlatego model NIGDY nie sortuje (patrz niżej);
//   * porównanie segmentu środkowego MIĘDZY słupkami jest tym, co rysunek
//     robi najsłabiej, więc tabela musi podać tę liczbę wprost -
//     `percentStackedTable` oddaje dla każdej serii rozpiętość udziału
//     i przesunięcie między pierwszym i ostatnim słupkiem
//     (`PercentStackedSeriesSummary`). Tabela nie jest tu zapisem rysunku,
//     jest jego dopełnieniem w miejscu, w którym rysunek jest najtrudniejszy.
//
// CZEGO DLA TEGO RODZAJU NIE WOLNO, czyli co ten moduł wymusza po stronie
// danych, zamiast liczyć na czujność autora:
//   * NIE WOLNO sortować segmentów per kategoria. Posortowanie każdego słupka
//     malejąco (odruch przeniesiony z tarczy, gdzie jest OBOWIĄZKOWE) niszczy
//     jedyną rzecz, po którą się do tej formy przychodzi: ta sama seria
//     musi w każdym słupku leżeć na tej samej wysokości stosu, inaczej oko
//     nie ma czego prowadzić wzdłuż wykresu. Model oddaje segmenty w STAŁEJ
//     kolejności serii, jednej dla wszystkich słupków, i nie zmienia
//     kolejności kategorii - odwrotnie niż `tornado.ts`, gdzie sortowanie
//     JEST formą;
//   * NIE WOLNO liczyć udziałów z wartości UJEMNYCH. Udział ujemny nie ma
//     długości, więc stos 100% z ujemnym składnikiem jest bezsensem
//     arytmetycznym, a nie trudnym przypadkiem - patrz decyzja (A) niżej;
//   * NIE WOLNO rysować pełnego słupka pierwszej serii, gdy kategoria sumuje
//     się do ZERA. To jest błąd, który powstaje sam: `v / total` przy zerowym
//     mianowniku daje NaN, a osłona napisana odruchowo ("gdy nie ma sumy,
//     weź pierwszą serię") stawia w tym miejscu słupek pełny w 100% jednej
//     kategorii. Kategoria bez sumy nie ma struktury, więc zostaje LUKĄ
//     (`state: "zeroTotal"`, `drawable: false`);
//   * NIE WOLNO zaokrąglać każdego udziału osobno. Sześć udziałów po 16,66%
//     zaokrąglonych niezależnie daje 102, trzy po 33,33% dają 99 - a czytelnik
//     te liczby DODAJE, bo etykiety stoją jedna nad drugą w jednym słupku.
//     Dlatego udział wyświetlany liczy metoda największych reszt (Hare),
//     patrz decyzja (B);
//   * NIE WOLNO przemilczeć, że słupki mają różne SKŁADNIKI. Struktura dwóch
//     słupków jest porównywalna tylko wtedy, gdy oba są zbudowane z tych
//     samych serii; słupek, w którym brakuje jednej z nich, pokazuje udziały
//     policzone z innego mianownika i wygląda dokładnie tak samo
//     (`structureComparableOk`).
//
// DECYZJE ARCHITEKTONICZNE I DLACZEGO ALTERNATYWA BYŁA GORSZA.
//
// (A) UJEMNY SKŁADNIK ODRZUCA CAŁY SŁUPEK, a nie tylko siebie. Alternatywą
// była konwencja `pieModel`: mianownikiem jest suma DODATNICH, a wartość,
// której forma nie umie narysować, zajmuje 0%. Dla tarczy jest to
// rozstrzygnięcie dobre, bo tarcza pokazuje JEDNĄ całość i czytelnik nie ma
// jej z czym zestawić. Tutaj jest gorsze, i to w sposób, którego nie widać:
// cała ta forma istnieje dla PORÓWNANIA słupków, więc słupek, który po cichu
// wyrzucił ujemny składnik, byłby zestawiony ze słupkiem, który nie wyrzucił
// nic - dwie różne całości, obie podpisane "100%", jedna obok drugiej.
// Sumowanie po modułach jest jeszcze gorsze, bo daje udziały, które sumują
// się do stu i wyglądają poprawnie, a mianownik jest sumą rzeczy, których
// znaki się wykluczają. Dlatego słupek z ujemną wartością nie dostaje ani
// jednego segmentu do narysowania, jego liczby zostają w tabeli, a autor
// dostaje klucz doradztwa `negativeValues` i etykietę kategorii, w której
// defekt siedzi. Model milczy o strukturze, której nie ma, zamiast policzyć
// ją inaczej niż obiecuje oś.
//
// (B) HARE ZAOKRĄGLA WYŁĄCZNIE ETYKIETĘ, NIGDY GEOMETRIĘ. Krawędzie `from`
// i `to` idą z udziałów DOKŁADNYCH, a `displayShare` z metody największych
// reszt. Alternatywą było zaokrąglić raz i użyć tej jednej liczby w obu
// miejscach, co ma pozorną zaletę: etykieta zgadzałaby się z długością
// segmentu co do piksela. Jest gorsza, bo przenosi zaokrąglenie na KODOWANIE:
// przy domyślnej wysokości rysunku 320 px (`CHART_HEIGHT_DEFAULT` w
// `../parse`) jeden punkt procentowy to 3,2 px, więc pół jednostki
// wyświetlania przesuwa krawędź o 1,6 px - a wtedy rysunek koduje etykietę,
// nie dane. Zaokrąglenie zostaje tam, gdzie jest nieszkodliwe: w napisie.
// Rozminięcie się tych dwóch liczb jest mierzone i podane
// (`maxRoundingShiftPp`), bo czytelnik ma prawo wiedzieć, że etykieta jest
// zaokrągleniem, a nie pomiarem.
//
// (C) MODEL NIE ZNA PIKSELI ANI KOLORU. Krawędzie są w PUNKTACH PROCENTOWYCH
// (0..100), udziały w zakresie 0..1 (konwencja `formatPercent` z `../format`
// i `pieModel`), a przesunięcia w punktach procentowych i tak nazwane
// przyrostkiem `Pp`. Jedyne pole zależne od rysunku, `labelInside`, liczy się
// z progu podanego z zewnątrz (`labelMinShare`), bo o wysokości słupka wie
// render, a nie model - i przy bloku o wysokości 640 px ten próg jest dwa
// razy mniejszy niż domyślny.
//
// REGUŁY OGÓLNE ZE SPECYFIKACJI, KTÓRE GO DOTYCZĄ:
//   * sekcja 8 - oś wartości słupków ZAWSZE od zera; tutaj dodatkowo zawsze
//     DO STU, bo całość jest osią (patrz `percentStackedExtent`);
//   * sekcja 3 - podstawa słupka jest kwadratowa, a zaokrągla się tylko
//     koniec danych. W stosie 100% końcem danych jest górna krawędź
//     OSTATNIEGO widocznego segmentu, więc model mówi wprost, który to
//     segment (`isLastVisible`), zamiast kazać renderowi zgadywać po
//     wartościach;
//   * sekcja 2 - blade wnętrze NIE NIESIE tożsamości serii (odległość
//     CIELAB między wypełnieniami spada po symulacji daltonizmu do 0,0-0,6),
//     a stos ma z definicji więcej niż jedną serię. Dlatego model podaje
//     `labelInside`: segment, który unosi swoją liczbę, jest etykietowany
//     bezpośrednio, a pozostałe idą do tabeli. Powyżej
//     `CATEGORICAL_SAFE_SERIES` serii kolor przestaje nieść kategorię
//     w ogóle i model doradza inną formę;
//   * sekcja 6 - strefa trafienia to CAŁA KOLUMNA kategorii, jedna na
//     kategorię, nie kształt segmentu: segment o udziale 1% ma przy domyślnej
//     wysokości 3,2 px i jest nietrafialny. Model oddaje słupki i segmenty
//     w kolejności rysowania, więc nawigacja klawiaturą idzie strzałkami
//     w poziomie po słupkach i w pionie po segmentach;
//   * sekcja 6 - hover zmienia stan powierzchni, nigdy kodowanie: żadne pole
//     tego modelu nie zależy od wskaźnika, bo wszystkie kodują wartość.
//
// KONWENCJA DANYCH. Silnik daje `categories` i `series` (patrz `../types`),
// czyli jedną liczbę na przecięciu serii i kategorii. Ten rodzaj czyta ten sam
// arkusz tak: JEDNA KATEGORIA TO JEDEN SŁUPEK, jedna seria to jeden SEGMENT
// stosu, a kolejność serii jest kolejnością stosu od krawędzi odniesienia.
// Każdy słupek dostaje segment dla KAŻDEJ serii, także dla serii bez liczby -
// inaczej indeksowanie po serii (legenda, podświetlenie, klawiatura) musiałoby
// szukać segmentu po nazwie, a dwie serie mogą nazywać się tak samo.
//
// KONWENCJA UCZCIWOŚCI (wspólna z `waterfall.ts`, `pieModel.ts` i `tornado.ts`):
//   * `null` znaczy NIE MA CZEGO SPRAWDZAĆ - model wtedy MILCZY, a nie
//     zaświadcza, że jest dobrze;
//   * `false` znaczy WYKRYTY DEFEKT;
//   * `true` znaczy sprawdzone i w porządku.
// Listy etykiet są osobne od orzeczeń, bo podpis pod wykresem musi umieć
// powiedzieć, KTÓRA kategoria jest wadliwa, a nie tylko że któraś jest.
import { CATEGORICAL_SAFE_SERIES, MAX_SERIES, type ChartConfig, type ChartSeries } from "../types";

/**
 * Całość w punktach procentowych. NIE JEST TO PRÓG, tylko definicja formy -
 * stoi tu jako stała, bo ta sama setka pojawia się w trzech miejscach
 * (krawędzie segmentów, liczba jednostek wyświetlania, zakres osi), a trzy
 * literały to trzy okazje do rozjazdu.
 */
export const PERCENT_STACKED_WHOLE_PP = 100;

/**
 * Ile miejsc po przecinku ma UDZIAŁ WYŚWIETLANY. Zero, i liczba jest
 * z geometrii, nie z gustu: przy domyślnej wysokości rysunku 320 px
 * (`CHART_HEIGHT_DEFAULT` w `../parse`) jeden punkt procentowy to 3,2 px,
 * a jego dziesiąta część 0,32 px - mniej niż grubość włosowej linii. Etykieta
 * "12,3%" obiecywałaby wtedy rozdzielczość, której rysunek nie ma, a przy
 * segmencie stosu jest to obietnica podwójnie fałszywa, bo jego długość
 * czyta się jako RÓŻNICĘ dwóch krawędzi, czyli z błędem obu.
 *
 * Autor sprawozdania, który potrzebuje dziesiątych części (udziały rynkowe,
 * struktura kapitału), podaje `displayDecimals` w opcjach - suma po Hare
 * domyka się do stu przy każdej z dozwolonych dokładności.
 */
export const PERCENT_STACKED_DISPLAY_DECIMALS = 0;

/**
 * Sufit dokładności wyświetlania. Dwa miejsca po przecinku, bo jednostka
 * wyświetlania schodzi wtedy do 0,01 pp, czyli do 0,032 px przy domyślnej
 * wysokości - dalsze cyfry nie są już zaokrągleniem czegokolwiek widocznego,
 * tylko dekoracją, a każda z nich wydłuża etykietę, która musi zmieścić się
 * w segmencie.
 */
export const PERCENT_STACKED_MAX_DISPLAY_DECIMALS = 2;

/**
 * Poniżej tego udziału liczba nie mieści się WEWNĄTRZ segmentu.
 *
 * Wyprowadzenie: etykieta jest pisana fontem 11 px (sekcja 4 specyfikacji),
 * a odstęp od krawędzi bierze się ze skali 4 px (sekcja 3), więc segment musi
 * mieć co najmniej 11 + 2 * 4 = 19 px grubości. Przy domyślnej wysokości
 * rysunku 320 px (`CHART_HEIGHT_DEFAULT` w `../parse`) daje to 19 / 320
 * = 5,9%, czyli 6% po zaokrągleniu w stronę bezpieczną. Dla porównania ten
 * sam rachunek dla pierścienia grubego 38 px stoi w sekcji 3 i daje około
 * 11% - tutaj jest łagodniejszy, bo słupek jest wyższy niż pierścień jest
 * gruby.
 *
 * Próg jest tylko DOMYŚLNY: wysokość rysunku jest polem konfiguracji bloku
 * (160..640 px), więc render, który zna swoją wysokość, podaje próg
 * dokładniejszy przez `labelMinShare`.
 */
export const PERCENT_STACKED_LABEL_MIN_SHARE = 0.06;

/**
 * Poniżej tylu segmentów forma nie odpowiada na swoje pytanie. Jedna seria
 * daje w każdym słupku jeden segment o udziale 100% - rysunek pełnych słupków
 * jednakowej długości, z którego nie da się odczytać niczego, bo struktura
 * jednoskładnikowa nie jest strukturą. Wartości bezwzględne pokazuje wtedy
 * zwykły słupek, a nie stos.
 */
export const PERCENT_STACKED_MIN_SEGMENTS = 2;

/**
 * Poniżej tylu słupków forma nie odpowiada na swoje pytanie z drugiej strony.
 * Stos 100% został tu wybrany, żeby PORÓWNAĆ strukturę między kategoriami;
 * jeden słupek nie ma z czym być porównany, a wtedy tabela doboru formy
 * dopuszcza dla tego samego pytania pierścień (do pięciu kategorii), który
 * czyta się jednym spojrzeniem.
 */
export const PERCENT_STACKED_MIN_BARS = 2;

/**
 * Tolerancja sumy udziałów PODANYCH W DANYCH, w punktach procentowych.
 *
 * Ta sama liczba i to samo uzasadnienie co `SHARE_TOLERANCE_PP` w
 * `src/components/charts/pieModel.ts`: pół punktu jest granicą, poniżej której
 * mówimy o zaokrągleniu w arkuszu autora (trzy równe udziały podane jako 33,3
 * sumują się do 99,9), a powyżej - o brakującej albo podwójnie liczonej
 * kategorii. Stała jest tu POWTÓRZONA, nie zaimportowana, bo tamta mieszka
 * w komponencie renderującym, a moduł z `lib/` nie ma prawa zależeć od
 * `components/` - kierunek zależności jest tu ważniejszy niż jedna liczba.
 * Miejscem docelowym dla obu jest `../format`.
 */
export const PERCENT_STACKED_DECLARED_TOLERANCE_PP = 0.5;

/**
 * Od tej krotności różnica SUM między słupkami jest treścią, a nie szumem.
 *
 * Ten rodzaj normalizuje każdy słupek do stu procent, więc WSZYSTKIE słupki
 * mają tę samą długość z konstrukcji - a to znaczy, że długość nie mówi nic
 * o wielkości. Słupek zbudowany z dziesięciu obserwacji wygląda dokładnie tak
 * samo, jak słupek zbudowany z dziesięciu tysięcy, i czytelnik nie ma z czego
 * tego odczytać: sumy stoją dopiero w tabeli danych.
 *
 * Dziesięć, czyli rząd wielkości - ta sama granica i to samo uzasadnienie co
 * `INDEX_BASE_COMPARABLE_RATIO` w `./indexBase`: przy różnicy poniżej rzędu
 * wielkości struktury porównuje się bez zastrzeżeń, powyżej - porównuje się
 * strukturę zjawiska masowego ze strukturą przypadku jednostkowego. Zdanie
 * wypisywane przy KAŻDEJ różnicy sum byłoby widoczne na prawie każdym
 * wykresie tego rodzaju, a uwaga widoczna zawsze uczy pomijania całej listy.
 */
export const PERCENT_STACKED_TOTAL_RATIO = 10;

/**
 * Powyżej tego modułu wartość nie wchodzi do mianownika.
 *
 * `Number.MAX_SAFE_INTEGER`, i to jest liczba z arytmetyki, nie z ostrożności:
 * powyżej 2^53-1 sąsiednie liczby całkowite przestają być rozróżnialne, więc
 * suma przestaje być mianownikiem, który ktokolwiek może sprawdzić. Sufit ma
 * też drugi skutek, ten ważniejszy: `MAX_SERIES` w `../types` wynosi 8, więc
 * suma ośmiu wartości poniżej sufitu to najwyżej ~7,2e16 - a to jest ponad
 * 290 rzędów wielkości od `Number.MAX_VALUE`. Mianownik nie może więc
 * przepełnić się do nieskończoności, przez którą dzielilibyśmy każdy udział
 * do zera, i cały słupek zszedłby do luki bez podania przyczyny.
 */
export const PERCENT_STACKED_VALUE_LIMIT = Number.MAX_SAFE_INTEGER;

/**
 * Stan segmentu. Sześć wartości, bo sześć różnych przyczyn wymaga sześciu
 * różnych zdań w podpisie, a nie jednego zdania o "braku danych":
 *   * `share` - udział dodatni, segment jest na rysunku;
 *   * `zero` - autor podał ZERO, czyli zadeklarował, że składnika nie ma;
 *     segment ma zerową długość, ale kategoria go zna;
 *   * `missing` - liczby nie podano; to NIE to samo co zero, bo zero jest
 *     pomiarem, a brak jest nieuzupełnionym polem;
 *   * `negative` - wartość ujemna, czyli defekt: udział ujemny nie ma
 *     długości. Ten segment nazywa przyczynę odrzucenia całego słupka;
 *   * `tooLarge` - wartość poza `PERCENT_STACKED_VALUE_LIMIT`;
 *   * `noShare` - wartość jest DODATNIA i w porządku, ale słupek nie ma
 *     mianownika (jest odrzucony), więc udziału nie ma czym policzyć.
 */
export type PercentStackedSegmentState =
  "share" | "zero" | "missing" | "negative" | "tooLarge" | "noShare";

/**
 * Stan słupka:
 *   * `stacked` - mianownik dodatni, udziały policzone, słupek do narysowania;
 *   * `empty` - żadna seria nie podała liczby; kategoria jest w arkuszu, ale
 *     nie ma w niej nic do rozłożenia;
 *   * `zeroTotal` - liczby są, ich suma jest zerem; struktury nie ma, więc
 *     słupek jest LUKĄ, a nie pełnym słupkiem pierwszej serii;
 *   * `rejected` - w słupku jest wartość ujemna albo poza sufitem; udziałów
 *     nie liczymy, bo byłyby udziałami z mianownika, którego forma nie unosi.
 */
export type PercentStackedBarState = "stacked" | "empty" | "zeroTotal" | "rejected";

export interface PercentStackedSegment {
  /**
   * Indeks serii w arkuszu. TOŻSAMOŚĆ segmentu idzie z niego, a nie z pozycji
   * w tablicy: pozycja jest ta sama we wszystkich słupkach (i taka ma być),
   * ale legenda, podświetlenie i klawiatura muszą wskazać serię, a dwie serie
   * mogą nazywać się identycznie.
   */
  seriesIndex: number;
  seriesName: string;
  colorSlot: number;
  /** Wartość bezwzględna z arkusza; `null` = luka. Nie zero - brak. */
  value: number | null;
  /**
   * Udział DOKŁADNY, 0..1 - konwencja `formatPercent` z `../format`. Z niego
   * liczy się geometria, nie z `displayShare`.
   */
  share: number;
  /** Dolna krawędź segmentu w PUNKTACH PROCENTOWYCH, 0..100. */
  from: number;
  /** Górna krawędź w punktach procentowych; `to - from` to długość segmentu. */
  to: number;
  /**
   * Udział WYŚWIETLANY w punktach procentowych, po metodzie największych
   * reszt. Udziały wyświetlane w jednym słupku sumują się DOKŁADNIE do 100
   * (patrz `PercentStackedBar.displayTotal`), bo czytelnik dodaje etykiety
   * stojące jedna nad drugą.
   */
  displayShare: number;
  state: PercentStackedSegmentState;
  /** Czy segment ma dodatnią długość, czyli czy jest co narysować. */
  visible: boolean;
  /**
   * Czy to OSTATNI widoczny segment słupka, czyli koniec danych. Sekcja 3:
   * zaokrągla się wyłącznie koniec danych, podstawa zostaje kwadratowa -
   * render nie ma tego wyprowadzać z wartości po raz drugi.
   */
  isLastVisible: boolean;
  /**
   * Czy liczba mieści się WEWNĄTRZ segmentu (udział co najmniej
   * `labelMinShare`). Sekcja 2: przy więcej niż jednej serii tożsamości nie
   * niesie blade wnętrze, więc etykieta bezpośrednia jest drugim nośnikiem -
   * a segment, który jej nie unosi, oddaje swoją liczbę tabeli.
   */
  labelInside: boolean;
}

export interface PercentStackedBar {
  /** Indeks kategorii w arkuszu. Model nie sortuje, więc równy pozycji. */
  index: number;
  label: string;
  /**
   * Mianownik udziału: suma wartości w tej kategorii. Zero, gdy nie ma czego
   * sumować albo słupek jest odrzucony.
   */
  total: number;
  /** Segmenty w STAŁEJ kolejności serii - identycznej w każdym słupku. */
  segments: PercentStackedSegment[];
  state: PercentStackedBarState;
  /** Czy słupek ma strukturę do narysowania (`state === "stacked"`). */
  drawable: boolean;
  /** Ile serii podało w tej kategorii liczbę (także zero). */
  filled: number;
  /**
   * Suma udziałów WYŚWIETLANYCH, w punktach procentowych. Dla słupka
   * rysowanego jest to dokładnie 100 - i jest to LICZBA, nie orzeczenie
   * uczciwości. Suma kontrolna liczona z własnego zaokrąglenia domykałaby
   * się z definicji i nie mogłaby wykryć niczego poza błędem w tym module
   * (ta sama pułapka, którą opisuje `shareSum` w `pieModel`), więc jej
   * miejsce jest w bramce testowej, a nie w podpisie pod wykresem.
   */
  displayTotal: number;
  /**
   * Czy model PRZESKALOWAŁ udziały podane przez autora. `true` tylko wtedy,
   * gdy dane są udziałami (`valuesAreShares`), a ich suma w tej kategorii
   * odbiega od stu bardziej niż `PERCENT_STACKED_DECLARED_TOLERANCE_PP`.
   * Wtedy liczba na segmencie jest inna niż liczba w arkuszu i nikt tego nie
   * powie, jeśli nie powie tego model.
   */
  rescaled: boolean;
}

/**
 * Podsumowanie serii PO WSZYSTKICH SŁUPKACH - to jest ta część modelu, która
 * odpowiada na pytanie najtrudniejsze dla rysunku. Segment środkowy nie leży
 * na wspólnej skali, więc odpowiedź "czy udział tej serii rośnie" odczytuje
 * się z wykresu przez porównanie dwóch różnic - a tu jest podana liczbą.
 * Udziały w zakresie 0..1, przesunięcia w punktach procentowych.
 */
export interface PercentStackedSeriesSummary {
  seriesIndex: number;
  name: string;
  colorSlot: number;
  /** W ilu RYSOWANYCH słupkach ta seria ma udział dodatni. */
  bars: number;
  /** Suma wartości bezwzględnych tej serii po słupkach rysowanych. */
  total: number;
  /** Najmniejszy i największy udział po słupkach rysowanych; `null` = brak. */
  minShare: number | null;
  maxShare: number | null;
  /** Rozpiętość udziału w punktach procentowych; `null` = brak. */
  spanPp: number | null;
  /**
   * Udział w PIERWSZYM i OSTATNIM rysowanym słupku, w którym ta seria ma
   * udział dodatni; `null` = nie ma takiego słupka. Liczone po słupkach
   * z udziałem, a nie po wszystkich rysowanych, bo brak serii w słupku nie
   * jest jej udziałem zerowym - kategoria, w której składnika nie podano,
   * nie mówi, że składnik zniknął.
   */
  firstShare: number | null;
  lastShare: number | null;
  /**
   * Przesunięcie struktury: udział w ostatnim słupku minus udział
   * w pierwszym, w punktach procentowych. `null`, gdy ta seria ma udział
   * w mniej niż dwóch rysowanych słupkach - różnica policzona z jednego
   * słupka byłaby zerem podanym jako "nic się nie zmieniło".
   */
  shiftPp: number | null;
}

export interface PercentStackedHonesty {
  /**
   * Czy wszystkie wartości są nieujemne. `false` = wykryty defekt: udział
   * ujemny nie ma długości, więc stos 100% z takim składnikiem nie istnieje.
   * `null` = nie ma ani jednej liczby.
   */
  valuesNonNegativeOk: boolean | null;
  /** Etykiety kategorii z wartością ujemną. */
  negativeLabels: string[];
  /**
   * Czy każda kategoria z liczbami ma DODATNI mianownik. `false` = jest
   * kategoria sumująca się do zera, czyli luka w miejscu, w którym czytelnik
   * spodziewa się słupka. `null` = nie ma ani jednej kategorii z liczbami.
   */
  totalsPositiveOk: boolean | null;
  /** Etykiety kategorii, których suma jest zerem. */
  zeroTotalLabels: string[];
  /** Etykiety kategorii bez ani jednej liczby. */
  emptyLabels: string[];
  /**
   * Czy wszystkie rysowane słupki mają TE SAME składniki. `false` = w co
   * najmniej jednym brakuje serii, którą mają pozostałe, więc jego udziały
   * są policzone z innego mianownika przy identycznym wyglądzie. `null` =
   * mniej niż dwa słupki rysowane, czyli nie ma czego porównywać.
   */
  structureComparableOk: boolean | null;
  /** Etykiety słupków, którym brakuje składnika obecnego w innych. */
  incompleteLabels: string[];
  /** Etykiety kategorii z wartością poza `PERCENT_STACKED_VALUE_LIMIT`. */
  outOfRangeLabels: string[];
  /**
   * Powtórzone etykiety kategorii. Dwa słupki o tej samej nazwie są dla
   * czytelnika nierozróżnialne, a w tej formie nie ma drugiego nośnika
   * tożsamości kategorii - jest tylko etykieta pod słupkiem.
   */
  duplicateLabels: string[];
  /**
   * Powtórzone nazwy serii. W stosie tożsamość segmentu niesie WYŁĄCZNIE
   * legenda albo etykieta bezpośrednia (blade wnętrze jej nie niesie, sekcja
   * 2), więc dwie serie o tej samej nazwie dają dwa segmenty, których nie da
   * się rozdzielić żadnym kanałem.
   */
  duplicateSeriesNames: string[];
  /**
   * Czy udziały PODANE PRZEZ AUTORA domykają sto w każdej kategorii. `null` =
   * dane nie są udziałami, więc nie ma czego sprawdzać.
   *
   * SPRAWDZAMY DANE AUTORA, NIE WŁASNĄ ARYTMETYKĘ - to samo rozstrzygnięcie
   * co przy `shareSum` w `pieModel`. Udziały policzone przez model dzielą
   * wartości przez ich własną sumę, więc domykają się z definicji. Realny
   * defekt jest inny: autor wkleja gotowe udziały sumujące się do 96 (bo
   * brakuje kategorii, bo dwie się nakładają), a stos PRZESKALOWUJE je po
   * cichu do pełnej całości - i liczba na segmencie przestaje być liczbą
   * z arkusza.
   */
  declaredTotalsOk: boolean | null;
  /** Etykiety kategorii, w których model przeskalował podane udziały. */
  rescaledLabels: string[];
  /**
   * Ile serii z danymi przekracza zestaw rozdzielny dla każdego rodzaju
   * widzenia barw (`CATEGORICAL_SAFE_SERIES`). 0 = w normie. Ta sama
   * arytmetyka co `seriesOverSafePalette` w `../honesty`, liczona tutaj, bo
   * tamta funkcja czyta cały `ChartConfig`, a ten model musi działać także
   * na samym wejściu (podgląd w edytorze woła go bez konfiguracji bloku).
   */
  segmentsOverSafePalette: number;
  /**
   * Największe rozminięcie udziału wyświetlanego z dokładnym, w punktach
   * procentowych. POLE INFORMACYJNE, nie orzeczenie: zaokrąglenie jest tu
   * konieczne (patrz decyzja B), a jego wielkość jest ograniczona jednostką
   * wyświetlania. `null` = nie ma ani jednego rysowanego słupka.
   */
  maxRoundingShiftPp: number | null;
  /**
   * Ile liczb leżało poza zakresem kategorii, czyli nie miało słupka, do
   * którego mogłoby wejść. Zdarza się przy treści z cofniętej wersji
   * edytora - wartość dopisano, kategorii nie. Bez kategorii nie ma czego
   * narysować, więc liczba wypada, i to musi być widoczne.
   */
  droppedValueCount: number;
}

export interface PercentStackedModel {
  /**
   * Słupki w kolejności ARKUSZOWEJ. Model NIGDY nie sortuje - ani kategorii,
   * ani segmentów - bo kolejność w tej formie jest decyzją analityczną
   * autora, a nie porządkiem prezentacji (patrz nagłówek pliku).
   */
  bars: PercentStackedBar[];
  /** Serie w kolejności arkuszowej, czyli w kolejności stosu. */
  series: PercentStackedSeriesSummary[];
  /** Ile słupków ma strukturę do narysowania. */
  drawableBars: number;
  /** Ile serii niesie choć jedną liczbę w choć jednym rysowanym słupku. */
  filledSeries: number;
  /** Dokładność udziału wyświetlanego, po zastosowaniu sufitu z opcji. */
  displayDecimals: number;
  /** Próg etykiety wewnątrz segmentu, po rozstrzygnięciu opcji. */
  labelMinShare: number;
  /** Czy dane BYŁY już udziałami - od tego zależy `declaredTotalsOk`. */
  valuesAreShares: boolean;
  /**
   * Krotność różnicy SUM między słupkami rysowanymi (największa przez
   * najmniejszą); `null` = mniej niż dwa słupki z sumą dodatnią.
   *
   * Liczba istnieje po to, żeby dało się powiedzieć czytelnikowi rzecz, której
   * z rysunku nie da się odczytać w ogóle: wszystkie słupki mają tę samą
   * długość z konstrukcji, więc struktura zbudowana z dziesięciu obserwacji
   * stoi obok struktury zbudowanej z dziesięciu tysięcy jako równa jej.
   * Same sumy są w tabeli, ale tabela odpowiada na pytanie dopiero zadane -
   * a tego pytania czytelnik nie zada, bo rysunek nie daje powodu.
   */
  totalRatio: number | null;
  honesty: PercentStackedHonesty;
}

export interface PercentStackedInput {
  /** Etykiety słupków - jedna kategoria to jeden słupek. */
  categories: readonly string[];
  /** Serie w kolejności stosu, od krawędzi odniesienia. */
  series: readonly ChartSeries[];
}

export interface PercentStackedOptions {
  /**
   * Miejsca po przecinku udziału wyświetlanego; przycinane sufitem
   * `PERCENT_STACKED_MAX_DISPLAY_DECIMALS`.
   */
  displayDecimals?: number;
  /**
   * Czy liczby w arkuszu SĄ udziałami (jednostka procentowa). Rozstrzyga
   * o tym wywołujący, bo o jednostce mówi konfiguracja bloku, a nie kształt
   * liczb: heurystyka "sumują się blisko stu" odpalałaby na czterech
   * kwartałach po 25 mln i milczałaby na udziałach sumujących się do 60,
   * czyli dokładnie tam, gdzie ostrzeżenie jest potrzebne.
   */
  valuesAreShares?: boolean;
  /**
   * Próg udziału, od którego liczba mieści się wewnątrz segmentu. Domyślnie
   * `PERCENT_STACKED_LABEL_MIN_SHARE`, wyprowadzony dla domyślnej wysokości
   * rysunku; render, który zna swoją wysokość, podaje próg dokładniejszy.
   */
  labelMinShare?: number;
}

/**
 * Ostatnia zapora przed NaN i nieskończonością w polu modelu. Nie zastępuje
 * osłon przy dzieleniu - te są tam, gdzie mianownik może być zerem, i tam
 * wynikiem jest przemyślane zero. Ta funkcja jest bramką na wyjściu:
 * konfiguracja przychodzi z bazy i może być z wersji edytora, której ten kod
 * nie zna, a jedno `NaN` w polu modelu wychodzi na stronie jako napis "NaN"
 * w tabeli danych (`Intl.NumberFormat.format(NaN)` zwraca literalnie "NaN").
 *
 * Zero ujemne sprowadzamy do dodatniego, bo `Intl` formatuje `-0` jako "-0"
 * i etykieta segmentu bez składnika czytałaby się jako "-0%".
 */
function pewna(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value === 0 ? 0 : value;
}

/**
 * Liczba nadająca się do stosu albo `null`. Jedno miejsce, w którym giną
 * `NaN` i nieskończoność z bazy - tak samo jak w `stackSeries` z `../scale`,
 * gdzie nieliczba jest luką, a nie defektem: nieskończoność w arkuszu jest
 * skutkiem dzielenia w innym narzędziu, nie deklaracją wartości.
 */
function liczba(value: number | null | undefined): number | null {
  return value === null || value === undefined || !Number.isFinite(value) ? null : value;
}

/**
 * Slot palety segmentu: podany, jeśli mieści się w palecie, w przeciwnym razie
 * POZYCJA w stosie.
 *
 * TA SAMA REGUŁA CO `parseChartSeries` w `../parse`, i to nie jest zgodność
 * dla zgodności. Odruchowe `Math.max(1, ...)` (tak robi jednoseryjny
 * `histogram.ts`, i tam jest to bez znaczenia) sprowadziłoby każdy slot poza
 * zakresem do jedynki - a w stosie dwa segmenty w jednym kolorze przestają
 * być kluczem legendy i tożsamość serii ginie, bo blade wnętrze jej nie
 * niesie (sekcja 2). Pozycja jest z definicji unikalna, więc wybór między
 * tymi dwiema osłonami jest wyborem między wykresem czytelnym i nieczytelnym.
 */
function slotKoloru(colorSlot: number, position: number): number {
  const slot = liczba(colorSlot);
  if (slot === null || slot < 1 || slot > MAX_SERIES) return position + 1;
  return Math.round(slot);
}

/** Nazwy powtórzone w tablicy, po jednej sztuce, w kolejności pierwszego wystąpienia. */
function powtorzone(names: readonly string[]): string[] {
  const widziane = new Set<string>();
  const duble = new Set<string>();
  for (const raw of names) {
    const name = raw.trim();
    if (name === "") continue;
    if (widziane.has(name)) duble.add(name);
    else widziane.add(name);
  }
  return [...duble];
}

/** Liczba jednostek wyświetlania w całości: 100, 1000 albo 10000. */
function jednostekWCalosci(decimals: number): number {
  return PERCENT_STACKED_WHOLE_PP * Math.pow(10, decimals);
}

/**
 * Minimum i maksimum PĘTLĄ, nie przez `Math.min(...tablica)`.
 *
 * Spread przekazuje każdy element jako osobny argument wywołania, a przy
 * tablicy liczonej w dziesiątkach tysięcy elementów silnik rzuca
 * `RangeError: too many arguments`. Wejście modelu nie jest ograniczone
 * niczym, co ten moduł kontroluje (`MAX_CATEGORIES` przycina konfigurację
 * bloku, ale nie wywołanie z podglądu), a model NIE MA PRAWA RZUCIĆ -
 * wyjątek w modelu wywraca cały wpis, nie tylko wykres. Ta sama decyzja
 * i to samo uzasadnienie co przy `minOf` w `tornado.ts`.
 */
function minOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let min = values[0];
  for (const value of values) if (value < min) min = value;
  return min;
}

function maxOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let max = values[0];
  for (const value of values) if (value > max) max = value;
  return max;
}

/**
 * METODA NAJWIĘKSZYCH RESZT (Hare). Wejściem są udziały dokładne (0..1),
 * wyjściem liczby CAŁKOWITE jednostek wyświetlania, których suma równa się
 * całości co do jednostki.
 *
 * Dlaczego nie zaokrąglenie każdego udziału osobno: sześć udziałów po 16,66%
 * daje wtedy 102, trzy po 33,33% dają 99, a czytelnik dodaje te liczby, bo
 * stoją jedna nad drugą w jednym słupku. Hare rozdaje brakujące jednostki
 * po jednej, kolejno największym RESZTOM - to jest ten sam algorytm, którym
 * rozdziela się mandaty, i jego jedyna wada (paradoks Alabamy) dotyczy zmiany
 * liczby mandatów, a nie sumy, która nas tu interesuje.
 *
 * ROZSTRZYGANIE REMISÓW JEST DETERMINISTYCZNE I ZAPISANE W TEJ KOLEJNOŚCI:
 * większa reszta, potem większy udział dokładny, potem niższy indeks serii.
 *
 * Drugie kryterium ma uzasadnienie policzalne: jednostka wyświetlania dołożona
 * do segmentu większego jest mniejszym zniekształceniem RELATYWNYM. Jeden
 * punkt procentowy dołożony do 62% zmienia wyświetlaną liczbę o 1,6% jej
 * wartości, ten sam punkt dołożony do 3% zmienia ją o 33%. Skoro trzeba
 * skłamać o pół jednostki, kłamiemy tam, gdzie kłamstwo waży najmniej.
 *
 * Trzecie kryterium jest kolejnością serii, tą samą, która rządzi całym
 * stosem: przy udziałach równych co do bitu wybór jest arbitralny, więc
 * rozstrzyga go porządek, który czytelnik i tak widzi. Ten sam zbiór danych
 * musi zawsze dać ten sam wynik - i to jest wymóg, nie wygoda: `Math.random`
 * ani `Date.now` nie mają w modelu czego szukać.
 */
function udzialyHare(shares: readonly number[], jednostek: number): number[] {
  const podlogi: number[] = [];
  const kandydaci: { i: number; reszta: number; share: number }[] = [];
  let suma = 0;
  shares.forEach((share, i) => {
    const dokladnie = share * jednostek;
    const podloga = Number.isFinite(dokladnie) ? Math.max(0, Math.floor(dokladnie)) : 0;
    podlogi.push(podloga);
    suma += podloga;
    if (share > 0) kandydaci.push({ i, reszta: dokladnie - podloga, share });
  });
  if (kandydaci.length === 0) return podlogi;
  kandydaci.sort((a, b) => b.reszta - a.reszta || b.share - a.share || a.i - b.i);
  let brak = jednostek - suma;
  for (let p = 0; p < kandydaci.length && brak > 0; p++) {
    podlogi[kandydaci[p].i] += 1;
    brak -= 1;
  }
  // ZAPORA NA WYPADEK, GDY SUMA UDZIAŁÓW ROZJEDZIE SIĘ Z JEDNOŚCIĄ. Przy
  // udziałach domykających całość pętla wyżej rozdaje wszystko: reszt jest
  // zawsze mniej niż kandydatów, bo każda jest poniżej jedności, a ich suma
  // jest liczbą całkowitą. Rozjazd zostaje możliwy tylko na skrajnych
  // zakresach wartości, gdzie iloraz `v / total` traci cyfry (bilion obok
  // jedynki, liczby denormalne). Etykiety w jednym słupku MUSZĄ sumować się
  // do stu, bo czytelnik je dodaje, więc różnicę domykamy na największym
  // segmencie - tam jedna jednostka wyświetlania waży relatywnie najmniej,
  // dokładnie z tego samego powodu co przy remisie reszt.
  const domkniecie = jednostek - podlogi.reduce((a, b) => a + b, 0);
  if (domkniecie !== 0) {
    const najwiekszy = kandydaci.reduce((a, b) => (b.share > a.share ? b : a), kandydaci[0]);
    podlogi[najwiekszy.i] = Math.max(0, podlogi[najwiekszy.i] + domkniecie);
  }
  return podlogi;
}

/**
 * Model słupka skumulowanego 100%. Funkcja NIGDY nie rzuca i nigdy nie zwraca
 * NaN ani nieskończoności, bo treść bloku przychodzi z bazy i może być
 * z wersji edytora, której ten kod nie zna: brak kategorii, brak serii, sama
 * luka, kategoria sumująca się do zera, wartości ujemne, jedna seria, dziesięć
 * serii, liczby poza podwójną precyzją.
 */
export function percentStackedModel(
  input: PercentStackedInput,
  opts: PercentStackedOptions = {},
): PercentStackedModel {
  const displayDecimals = Math.min(
    PERCENT_STACKED_MAX_DISPLAY_DECIMALS,
    Math.max(
      0,
      Math.floor(liczba(opts.displayDecimals ?? null) ?? PERCENT_STACKED_DISPLAY_DECIMALS),
    ),
  );
  const labelMinShare = Math.min(
    1,
    Math.max(0, liczba(opts.labelMinShare ?? null) ?? PERCENT_STACKED_LABEL_MIN_SHARE),
  );
  const valuesAreShares = opts.valuesAreShares === true;
  const jednostek = jednostekWCalosci(displayDecimals);
  const mianownikJednostek = Math.pow(10, displayDecimals);

  const categories = input.categories.map((c) => c);
  const series = input.series.map((s) => s);

  // Liczby bez kategorii nie mają słupka, do którego mogłyby wejść.
  let droppedValueCount = 0;
  for (const s of series) {
    for (let i = categories.length; i < s.values.length; i++) {
      if (liczba(s.values[i]) !== null) droppedValueCount += 1;
    }
  }

  const negativeLabels: string[] = [];
  const outOfRangeLabels: string[] = [];
  const zeroTotalLabels: string[] = [];
  const emptyLabels: string[] = [];
  const rescaledLabels: string[] = [];
  let anyNumber = false;
  let maxRoundingShiftPp: number | null = null;

  const bars: PercentStackedBar[] = categories.map((label, index) => {
    // PIERWSZY PRZEBIEG: odczyt i klasyfikacja. Mianownik liczymy TYM SAMYM
    // dodawaniem i w tej samej kolejności, w której potem narastają krawędzie
    // - dzięki temu suma narastająca dochodzi w ostatnim segmencie dokładnie
    // do mianownika bit w bit, a górna krawędź stosu wypada na 100 bez
    // domykania na siłę. Odwrotna kolejność (mianownik liczony osobno,
    // np. przez `reduce` na przefiltrowanej tablicy) różni się o epsilon
    // i zostawia u szczytu słupka włosową szczelinę, którą czytelnik czyta
    // jako "czegoś tu brakuje".
    const odczyt = series.map((s) => liczba(s.values[index]));
    let total = 0;
    let filled = 0;
    let hasNegative = false;
    let hasTooLarge = false;
    for (const v of odczyt) {
      if (v === null) continue;
      filled += 1;
      anyNumber = true;
      if (v < 0) hasNegative = true;
      else if (Math.abs(v) > PERCENT_STACKED_VALUE_LIMIT) hasTooLarge = true;
      else total += v;
    }
    if (hasNegative) negativeLabels.push(label);
    if (hasTooLarge) outOfRangeLabels.push(label);

    const rejected = hasNegative || hasTooLarge;
    const state: PercentStackedBarState =
      filled === 0 ? "empty" : rejected ? "rejected" : total > 0 ? "stacked" : "zeroTotal";
    if (state === "empty") emptyLabels.push(label);
    if (state === "zeroTotal") zeroTotalLabels.push(label);
    const drawable = state === "stacked";

    // MIANOWNIK JEST SUMĄ LICZB NIEUJEMNYCH, więc `total > 0` nie potrzebuje
    // tolerancji: znaki się nie znoszą, więc suma jest zerem tylko wtedy, gdy
    // każdy składnik jest zerem. Próg zamiast porównania z zerem byłby tu
    // liczbą bez źródła.
    const shares = odczyt.map((v) => (drawable && v !== null && v > 0 ? v / total : 0));
    const jednostki = drawable ? udzialyHare(shares, jednostek) : shares.map(() => 0);

    let prefix = 0;
    let ostatniWidoczny = -1;
    const segmenty: PercentStackedSegment[] = series.map((s, k) => {
      const v = odczyt[k];
      const share = pewna(shares[k]);
      const from = drawable ? pewna((PERCENT_STACKED_WHOLE_PP * prefix) / total) : 0;
      if (drawable && v !== null && v > 0) prefix += v;
      const to = drawable ? pewna((PERCENT_STACKED_WHOLE_PP * prefix) / total) : 0;
      const visible = drawable && share > 0;
      if (visible) ostatniWidoczny = k;
      // KOLEJNOŚĆ TYCH PYTAŃ JEST TREŚCIĄ, nie skrótem. Najpierw brak, potem
      // dwa defekty wartości, potem zero zadeklarowane - i dopiero na końcu
      // pytanie o mianownik. Zero postawione PRZED brakiem mianownika jest
      // celowe: w słupku sumującym się do zera każda liczba JEST zerem, więc
      // "autor wpisał zero" mówi czytelnikowi więcej niż "nie ma z czego
      // policzyć udziału", a przyczynę braku struktury niesie i tak przypis
      // przy całym słupku.
      const segmentState: PercentStackedSegmentState =
        v === null
          ? "missing"
          : v < 0
            ? "negative"
            : Math.abs(v) > PERCENT_STACKED_VALUE_LIMIT
              ? "tooLarge"
              : v === 0
                ? "zero"
                : drawable
                  ? "share"
                  : "noShare";
      return {
        seriesIndex: k,
        seriesName: s.name,
        colorSlot: slotKoloru(s.colorSlot, k),
        value: v,
        share,
        from,
        to,
        displayShare: pewna(jednostki[k] / mianownikJednostek),
        state: segmentState,
        visible,
        isLastVisible: false,
        labelInside: visible && share >= labelMinShare,
      };
    });
    if (ostatniWidoczny >= 0) {
      segmenty[ostatniWidoczny].isLastVisible = true;
      // KONIEC DANYCH LEŻY NA OSI, NIE OBOK NIEJ. Suma narastająca dochodzi
      // tu do mianownika bit w bit, więc ta linia niczego nie zmienia
      // w normalnym przebiegu - stoi jako gwarancja dla przypadków, w których
      // podwójna precyzja zawiedzie (wartości rozjechane o kilkanaście rzędów
      // wielkości), bo szczelina u szczytu stosu 100% jest kłamstwem o tym,
      // że struktura się nie domyka.
      segmenty[ostatniWidoczny].to = PERCENT_STACKED_WHOLE_PP;
    }

    const sumaJednostek = jednostki.reduce((a, b) => a + b, 0);
    // Suma z liczb CAŁKOWITYCH, nie z udziałów wyświetlanych: 33,3 nie ma
    // dokładnej reprezentacji binarnej, więc dodanie trzech takich liczb daje
    // 99,99999999999999, a iloraz dwóch liczb całkowitych (1000 / 10) daje
    // dokładnie 100.
    const displayTotal = pewna(sumaJednostek / mianownikJednostek);

    if (drawable) {
      for (const seg of segmenty) {
        if (!seg.visible) continue;
        const shift = Math.abs(seg.share * PERCENT_STACKED_WHOLE_PP - seg.displayShare);
        if (maxRoundingShiftPp === null || shift > maxRoundingShiftPp) {
          maxRoundingShiftPp = pewna(shift);
        }
      }
    }

    const rescaled =
      valuesAreShares &&
      drawable &&
      Math.abs(total - PERCENT_STACKED_WHOLE_PP) > PERCENT_STACKED_DECLARED_TOLERANCE_PP;
    if (rescaled) rescaledLabels.push(label);

    return {
      index,
      label,
      total: pewna(drawable ? total : 0),
      segments: segmenty,
      state,
      drawable,
      filled,
      displayTotal,
      rescaled,
    };
  });

  const rysowane = bars.filter((b) => b.drawable);

  // POKRYCIE SERII, czyli porównywalność struktury. Seria jest "w użyciu",
  // gdy niesie liczbę w choć jednym RYSOWANYM słupku; słupek jest niekompletny,
  // gdy brakuje mu serii, którą mają inne. Sprawdzenie milczy przy mniej niż
  // dwóch rysowanych słupkach, bo wtedy nie ma czego porównywać.
  const wUzyciu = series.map((_s, k) => rysowane.some((b) => b.segments[k].value !== null));
  const incompleteLabels = rysowane
    .filter((b) => series.some((_s, k) => wUzyciu[k] && b.segments[k].value === null))
    .map((b) => b.label);

  // LICZBA SERII Z DANYMI JEST LICZONA PO WSZYSTKICH SŁUPKACH, nie po
  // rysowanych, i to są dwie różne liczby. Legenda pokazuje każdą serię,
  // która wniosła liczbę - także tę, której słupek został odrzucony - więc
  // pytanie o rozdzielność palety dotyczy tej szerszej liczby. Gdyby
  // `filledSeries` liczyło tylko serie z rysowanych słupków, wykres o ośmiu
  // seriach i jednej wartości ujemnej nie dostałby ostrzeżenia o palecie:
  // ujemna wartość odrzuciłaby słupki, a z nimi ostrzeżenie o czymś, co
  // z ujemną wartością nie ma nic wspólnego.
  const filledSeries = series.filter((_s, k) =>
    bars.some((b) => b.segments[k].value !== null),
  ).length;

  const seriesSummary: PercentStackedSeriesSummary[] = series.map((s, k) => {
    const zUdzialem = rysowane.filter((b) => b.segments[k].share > 0);
    const udzialy = zUdzialem.map((b) => b.segments[k].share);
    const min = minOf(udzialy);
    const max = maxOf(udzialy);
    const first = udzialy.length > 0 ? udzialy[0] : null;
    const last = udzialy.length > 0 ? udzialy[udzialy.length - 1] : null;
    return {
      seriesIndex: k,
      name: s.name,
      colorSlot: slotKoloru(s.colorSlot, k),
      bars: zUdzialem.length,
      total: pewna(
        rysowane.reduce((a, b) => {
          const v = b.segments[k].value;
          return v === null ? a : a + v;
        }, 0),
      ),
      minShare: min === null ? null : pewna(min),
      maxShare: max === null ? null : pewna(max),
      spanPp: min === null || max === null ? null : pewna((max - min) * PERCENT_STACKED_WHOLE_PP),
      firstShare: first === null ? null : pewna(first),
      lastShare: last === null ? null : pewna(last),
      shiftPp:
        udzialy.length < 2 || first === null || last === null
          ? null
          : pewna((last - first) * PERCENT_STACKED_WHOLE_PP),
    };
  });

  const honesty: PercentStackedHonesty = {
    valuesNonNegativeOk: anyNumber ? negativeLabels.length === 0 : null,
    negativeLabels,
    totalsPositiveOk: bars.some((b) => b.filled > 0) ? zeroTotalLabels.length === 0 : null,
    zeroTotalLabels,
    emptyLabels,
    structureComparableOk: rysowane.length < 2 ? null : incompleteLabels.length === 0,
    incompleteLabels,
    outOfRangeLabels,
    duplicateLabels: powtorzone(categories),
    duplicateSeriesNames: powtorzone(series.map((s) => s.name)),
    declaredTotalsOk:
      !valuesAreShares || rysowane.length === 0 ? null : rescaledLabels.length === 0,
    rescaledLabels,
    segmentsOverSafePalette: Math.max(0, filledSeries - CATEGORICAL_SAFE_SERIES),
    maxRoundingShiftPp,
    droppedValueCount,
  };

  // KROTNOŚĆ SUM liczona z sum słupków RYSOWANYCH: słupek bez struktury nie
  // ma sumy, którą dałoby się z czymkolwiek porównać.
  const sumy = rysowane.map((b) => b.total).filter((t) => t > 0);
  const totalRatio = sumy.length < 2 ? null : Math.max(...sumy) / Math.min(...sumy);

  return {
    bars,
    series: seriesSummary,
    drawableBars: rysowane.length,
    filledSeries,
    displayDecimals,
    labelMinShare,
    valuesAreShares,
    totalRatio,
    honesty,
  };
}

/**
 * Model z konfiguracji bloku, czyli z tego, co silnik już ma.
 *
 * `config.stacked` JEST TU NIEISTOTNE, i to jest decyzja, nie przeoczenie:
 * normalizacja do całości JEST stosem, więc "słupek skumulowany 100%, który
 * nie jest skumulowany" nie jest żadną formą. Respektowanie tej flagi dawałoby
 * rodzaj, który po odkliknięciu jednego pola w edytorze zamienia się w coś,
 * czego tabela doboru formy nie zna.
 *
 * `valuesAreShares` rozstrzyga JEDNOSTKA, bo jednostka jest deklaracją autora
 * o tym, co liczby znaczą. Predykat jest tu lokalny, choć `pieModel` ma taki
 * sam: tamten mieszka w komponencie renderującym, a moduł z `lib/` nie
 * zaimportuje niczego z `components/` bez odwrócenia kierunku zależności
 * w całym silniku. Miejscem docelowym dla obu jest `../format`.
 */
export function percentStackedModelFromConfig(
  config: ChartConfig,
  opts: PercentStackedOptions = {},
): PercentStackedModel {
  return percentStackedModel(
    { categories: config.categories, series: config.series },
    { ...opts, valuesAreShares: opts.valuesAreShares ?? jednostkaUdzialu(config.unit) },
  );
}

/** Czy jednostka mówi, że liczby SĄ udziałami. Ta sama reguła co w `pieModel`. */
function jednostkaUdzialu(unit: string): boolean {
  const u = unit.trim().toLowerCase().replace(/\s+/g, "");
  return u === "%" || u === "pp" || u === "p.p." || u === "pkt%";
}

/**
 * Zakres osi wartości. ZAWSZE OD ZERA I ZAWSZE DO STU, bez opcji i bez
 * wyjątku - w tym rodzaju oś nie jest wyprowadzana z danych, bo osią JEST
 * całość.
 *
 * Dolna granica z sekcji 8 (długość koduje wartość, więc ucięta oś wprost
 * zniekształca proporcję). Górna z definicji formy: oś dociągnięta do
 * najwyższej sumy albo "ładna" podziałka `niceScale` postawiłaby szczyt stosu
 * poniżej albo powyżej krawędzi rysunku, a wtedy pełny słupek przestałby
 * znaczyć "całość" - i to jest jedyny powód, dla którego ta funkcja nie woła
 * `niceScale` z `../scale`. Podziałki co 10 albo co 25 punktów render dobiera
 * na tym stałym zakresie.
 */
export function percentStackedExtent(): { min: number; max: number } {
  return { min: 0, max: PERCENT_STACKED_WHOLE_PP };
}

/**
 * PORADY DOBORU FORMY - osobno od uczciwości, bo to nie defekty arytmetyczne,
 * tylko sygnały, że pytanie analityczne lepiej postawić inną formą. Tak samo
 * jak `pieFormAdvice` w `../honesty` i `tornadoFormAdvice`.
 *
 *   * `negativeValues` - w danych jest wartość ujemna, więc stos 100% nie
 *     istnieje: udział ujemny nie ma długości. Model odrzucił dotknięte
 *     słupki, a nie posumował moduły (patrz decyzja A w nagłówku);
 *   * `tooManySegments` - powyżej `CATEGORICAL_SAFE_SERIES` serii kolor
 *     przestaje nieść kategorię dla każdego rodzaju widzenia barw; ogon
 *     trzeba zgrupować albo iść w small multiples;
 *   * `singleSegment` - jedna seria, czyli każdy słupek pełny w 100%: rysunek
 *     bez struktury;
 *   * `singleBar` - jeden słupek, czyli nie ma czego z czym porównać; dla tego
 *     samego pytania tabela doboru formy dopuszcza wtedy pierścień do pięciu
 *     kategorii;
 *   * `noStructure` - żaden słupek nie ma struktury do narysowania (same luki,
 *     zerowe sumy albo słupki odrzucone).
 */
export type PercentStackedFormAdvice =
  "negativeValues" | "tooManySegments" | "singleSegment" | "singleBar" | "noStructure";

export function percentStackedFormAdvice(model: PercentStackedModel): PercentStackedFormAdvice[] {
  const advice: PercentStackedFormAdvice[] = [];
  // Wartość ujemna nie jest poradą stylistyczną: przy niej ta forma nie
  // istnieje, więc idzie pierwsza i niezależnie od tego, co da się narysować.
  if (model.honesty.valuesNonNegativeOk === false) advice.push("negativeValues");
  if (model.honesty.segmentsOverSafePalette > 0) advice.push("tooManySegments");
  if (model.drawableBars === 0) {
    // Pusty blok nie dostaje porad o liczbie serii ani słupków - autor
    // dopiero wpisuje dane, a ostrzeżenie widoczne zawsze uczy ignorowania
    // wszystkich ostrzeżeń.
    if (model.bars.some((b) => b.filled > 0)) advice.push("noStructure");
    return advice;
  }
  if (model.filledSeries > 0 && model.filledSeries < PERCENT_STACKED_MIN_SEGMENTS) {
    advice.push("singleSegment");
  }
  if (model.drawableBars < PERCENT_STACKED_MIN_BARS) advice.push("singleBar");
  return advice;
}

/**
 * Kolumny tabeli danych. Klucze słownika, nie napisy - tłumaczy je warstwa
 * poza tym modułem.
 */
export const PERCENT_STACKED_COLUMNS = ["category", "series", "value", "share", "total"] as const;

export type PercentStackedColumnKey = (typeof PERCENT_STACKED_COLUMNS)[number];

/**
 * Przypis przy komórce tabeli - dokładnie te same fakty co w `honesty`,
 * tylko przypięte do miejsca, w którym czytelnik ich szuka.
 */
export type PercentStackedCellNote = "zero" | "missing" | "negative" | "tooLarge" | "noShare";

/** Przypis przy wierszu tabeli. */
export type PercentStackedRowNote =
  "empty" | "zeroTotal" | "rejected" | "incomplete" | "rescaled" | "duplicate";

export interface PercentStackedTableCell {
  seriesIndex: number;
  seriesName: string;
  /** Wartość bezwzględna z arkusza; `null` = luka. */
  value: number | null;
  /** Udział dokładny, 0..1. */
  share: number;
  /** Udział wyświetlany w punktach procentowych - ta sama liczba co na segmencie. */
  displayShare: number;
  notes: PercentStackedCellNote[];
}

export interface PercentStackedTableRow {
  /** Indeks kategorii w arkuszu, ta sama kolejność co na rysunku. */
  index: number;
  label: string;
  /** Mianownik udziału tej kategorii; 0, gdy słupek nie jest rysowany. */
  total: number;
  /** Suma udziałów wyświetlanych; 100 dla słupka rysowanego. */
  displayTotal: number;
  cells: PercentStackedTableCell[];
  notes: PercentStackedRowNote[];
}

export interface PercentStackedTable {
  /** Nagłówek: nazwy serii w kolejności stosu. */
  seriesLabels: string[];
  rows: PercentStackedTableRow[];
  /**
   * Brzeg serii: rozpiętość udziału i przesunięcie między pierwszym
   * i ostatnim rysowanym słupkiem. To jest ta część tabeli, która NIE jest
   * zapisem rysunku - patrz nagłówek pliku.
   */
  series: PercentStackedSeriesSummary[];
  drawableBars: number;
  displayDecimals: number;
  valuesAreShares: boolean;
}

/**
 * ALTERNATYWA TEKSTOWA: co ma pokazać tabela danych pod wykresem. Grafika
 * nigdy nie jest jedyną drogą do liczby (sekcja 8) - z segmentu stosu nie
 * odczyta się udziału dokładniej niż "mniej więcej", wydruk w skali szarości
 * gubi blade wypełnienia, a czytnik ekranowy nie widzi ani jednego z nich.
 *
 * TABELA NIESIE UDZIAŁ I WARTOŚĆ BEZWZGLĘDNĄ RAZEM, i to jest jej
 * najważniejsza cecha. Stos 100% z definicji WYRZUCA poziom: dwa słupki
 * o identycznej strukturze mogą różnić się rzędem wielkości i wyglądają
 * wtedy tak samo. Udział bez wartości bezwzględnej jest w tej formie
 * informacją niepełną, więc obie liczby stoją w jednej komórce.
 *
 * Liczby są PRZEPISANE Z MODELU, nie policzone po raz drugi inną drogą:
 * tabela, która dzieliłaby wartości przez własną sumę, podałaby przy słupku
 * odrzuconym udziały, których na rysunku nie ma.
 */
export function percentStackedTable(model: PercentStackedModel): PercentStackedTable {
  const niekompletne = new Set(model.honesty.incompleteLabels);
  const duble = new Set(model.honesty.duplicateLabels);
  const rows: PercentStackedTableRow[] = model.bars.map((bar) => {
    const notes: PercentStackedRowNote[] = [];
    if (bar.state === "empty") notes.push("empty");
    if (bar.state === "zeroTotal") notes.push("zeroTotal");
    if (bar.state === "rejected") notes.push("rejected");
    if (niekompletne.has(bar.label)) notes.push("incomplete");
    if (bar.rescaled) notes.push("rescaled");
    if (duble.has(bar.label.trim())) notes.push("duplicate");
    return {
      index: bar.index,
      label: bar.label,
      total: bar.total,
      displayTotal: bar.displayTotal,
      cells: bar.segments.map((seg) => ({
        seriesIndex: seg.seriesIndex,
        seriesName: seg.seriesName,
        value: seg.value,
        share: seg.share,
        displayShare: seg.displayShare,
        notes: seg.state === "share" ? [] : [seg.state],
      })),
      notes,
    };
  });
  return {
    seriesLabels: model.series.map((s) => s.name),
    rows,
    series: model.series,
    drawableBars: model.drawableBars,
    displayDecimals: model.displayDecimals,
    valuesAreShares: model.valuesAreShares,
  };
}
