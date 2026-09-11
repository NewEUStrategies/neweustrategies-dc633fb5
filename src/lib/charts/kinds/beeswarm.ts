// Model rozrzutu ulowego (beeswarm).
//
// PYTANIE ANALITYCZNE, KTÓREGO DOTYCZY. Tabela doboru formy (sekcja 1
// specyfikacji) stawia beeswarm w wierszu "Rozkład wartości", razem
// z histogramem i skrzynką, a w kolumnie "Czego unikać" ma jedną pozycję:
// "średnia bez rozproszenia". To jest cała racja bytu tego rodzaju. Jedna
// liczba na grupę ("przeciętny czas procedury", "mediana marży") wygląda na
// fakt, a jest streszczeniem, które gubi to, o co zwykle pytamy: ile
// obserwacji jest, gdzie się skupiają, czy rozkład ma dwa wierzchołki, czy
// któraś obserwacja leży daleko od reszty.
//
// CO BEESWARM MA NAD HISTOGRAMEM I SKRZYNKĄ. Histogram pokazuje kształt, ale
// dopiero po zsypaniu obserwacji do przedziałów, a kształt zależy wtedy od
// położenia krawędzi. Skrzynka pokazuje pięć liczb pozycyjnych i ukrywa
// wszystko pomiędzy (rozkład dwumodalny wygląda na skrzynce identycznie jak
// jednomodalny o tym samym IQR). Beeswarm nie zsypuje i nie streszcza: KAŻDA
// obserwacja jest osobnym punktem na dokładnej pozycji swojej wartości. Za tę
// wierność płaci się miejscem, więc rodzaj działa przy próbie kilkudziesięciu
// obserwacji, a nie kilku tysięcy - patrz `beeswarmFormAdvice`.
//
// JEDNA RZECZ, KTÓREJ TU NIE WOLNO NARUSZYĆ. Pozycja na osi wartości JEST
// DANYMI, przesunięcie w poprzek jest WYŁĄCZNIE zabiegiem czytelności.
// Rozsuwanie, które choćby trochę ruszy pozycję na osi wartości, żeby punkty
// ładniej się ułożyły, przestaje być wykresem tej próby: czytelnik odczytuje
// wtedy wartość, której nikt nie zmierzył. Dlatego `value` i `valueRadii`
// wychodzą z modelu jako pochodne wyłącznie danych, a cały wynik rozsuwania
// siedzi w osobnym polu `offset`, i dlatego sprawdzenie `valuesPreserved`
// porównuje wielozbiór wartości narysowanych z wielozbiorem wartości
// z arkusza.
//
// CZEGO DLA TEGO RODZAJU NIE WOLNO:
//   * nie wolno gubić obserwacji przy rozsuwaniu. To najłatwiejszy błąd tego
//     algorytmu: punkt, dla którego nie znalazło się wolne miejsce, po prostu
//     wypada z pętli i nikt tego nie widzi, bo chmura punktów wygląda równie
//     wiarygodnie z jednym punktem mniej. Dlatego liczba punktów na obrazku
//     jest sprawdzana arytmetycznie (`pointCountOk`);
//   * nie wolno cicho nakładać punktów. Przy zbyt wielu obserwacjach na
//     dostępną szerokość pasma rozsuwanie przestaje być wykonalne
//     i wtedy rodzaj jest złym wyborem. Model NIE dociska wtedy punktów do
//     pasma (to dawałoby nakładki, czyli kłamstwo o gęstości) - zwraca flagę
//     `fitsInBand` i podpowiedź `radiusScaleToFit`;
//   * nie wolno losować przesunięć. Zero `Math.random` w kodzie, i nie jest to
//     tylko reguła repo: ten sam zestaw danych musi dać ten sam obrazek, bo
//     inaczej zrzut ekranu z wpisu nie zgadza się z wpisem, a dwa
//     przeliczenia tego samego bloku różnią się bez powodu w danych;
//   * nie wolno rysować beeswarma bez podania `n`. Chmura kilkudziesięciu
//     i kilkuset punktów wygląda podobnie, a znaczy co innego (sekcja 8);
//   * nie wolno podawać samej średniej pod wykresem - patrz kolumna "Czego
//     unikać". Dlatego `beeswarmTable` oddaje komplet pozycyjny obok pełnej
//     listy obserwacji, a nie jedną liczbę.
//
// REGUŁY OGÓLNE, KTÓRE GO DOTYCZĄ:
//   * pozycja na wspólnej skali jest najwyższym kanałem hierarchii
//     percepcyjnej Clevelanda i McGilla (sekcja 1), a beeswarm koduje pozycją
//     całą wartość, więc kolor niesie tu tylko TOŻSAMOŚĆ grupy (sekcja 2);
//   * wszystkie roje dzielą JEDNĄ oś wartości - `domain` jest wspólna dla
//     całego modelu. Rój z własną skalą byłby tym samym błędem co dwie osie Y:
//     relacja wizualna między grupami zależałaby od dobranych zakresów,
//     a nie od danych;
//   * grafika nigdy nie jest jedyną drogą do liczby (sekcja 8), dlatego
//     `beeswarmTable` oddaje te same liczby, z których powstał rysunek, a nie
//     policzone po raz drugi inną metodą;
//   * strefa trafienia nigdy nie jest kształtem elementu (sekcja 6): punkt
//     o promieniu 3 px jest praktycznie nietrafialny, dlatego model podaje
//     `band`, czyli całe pasmo roju, a render dokłada w nim trafianie po
//     najbliższej wartości;
//   * hover zmienia stan powierzchni, nigdy kodowanie (sekcja 6): żadne pole
//     tego modelu nie zmienia się pod kursorem, bo wszystkie kodują wartość.
//     Dozwolona zmiana geometrii to WYŁĄCZNIE promień markera, a promień jest
//     parametrem renderu, nie modelu.
//
// JEDNOSTKI. Model nie zna pikseli. Pozycja na osi wartości wychodzi
// w JEDNOSTKACH DANYCH (`value`), a geometria rozsuwania w PROMIENIACH PUNKTU
// (`valueRadii`, `offset`), bo rozstaw beeswarma jest istotą tego rodzaju
// i nie da się go policzyć bez relacji "ile promieni punktu mieści się na
// osi". Tę relację podaje render przez `spanRadii` (długość osi wartości
// podzielona przez promień punktu) i `halfBandRadii` (połowa szerokości pasma
// roju podzielona przez promień punktu). Render mnoży `offset` przez promień
// w pikselach i dostaje przesunięcie - nic więcej nie liczy.
//
// KONWENCJA DANYCH. Silnik daje `categories` i `series` (patrz `../types`),
// czyli JEDNĄ liczbę na przecięciu serii i kategorii. Rozkład potrzebuje
// SUROWYCH OBSERWACJI, więc ten sam arkusz czytamy inaczej: jedna seria to
// jeden rój, a jej `values` to obserwacje tej grupy; `categories` są wtedy
// etykietami wierszy arkusza (numer obserwacji, identyfikator podmiotu). Dla
// arkusza transponowanego jest tryb `groupBy: "category"`. Żadne z tych dwóch
// odczytań nie wymaga zmiany schematu bloku - propozycja jawnego pola jest
// w raporcie.
import { quantile } from "../stats";
import { MAX_SERIES } from "../types";
import type { ChartConfig, ChartSeries } from "../types";

/* -------------------------------------------------------------------------- */
/*  Stałe z uzasadnieniem                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Odległość, poniżej której dwa punkty się nakładają, w promieniach punktu.
 *
 * Dwa koła o promieniu r stykają się, gdy ich środki są od siebie o 2r, więc
 * w jednostkach promienia progiem jest 2 i jest to liczba geometryczna, a nie
 * dobrana. Styk jest DOZWOLONY: punkty stykające się krawędziami nadal dają
 * się policzyć na obrazku, a wymaganie luki między nimi rozdmuchałoby rój bez
 * zysku dla odczytu.
 */
export const POINT_CLEARANCE_RADII = 2;

/**
 * Domyślna długość osi wartości w promieniach punktu.
 *
 * Wartość odpowiada typowemu wykresowi w tym silniku: pole rysunku około
 * 600 px przy punkcie o promieniu 3 px z sekcji 3 daje 200. Domyślna jest
 * tylko awaryjnie - render ZAWSZE zna swoją szerokość i powinien ją podać,
 * bo od tej liczby zależy, jak ciasno rój się układa.
 */
export const BEESWARM_DEFAULT_SPAN_RADII = 200;

/**
 * Domyślna połowa szerokości pasma roju w promieniach punktu.
 *
 * Osiem promieni na stronę to pasmo szerokie na szesnaście promieni, czyli
 * osiem punktów w najgęstszej kolumnie - tyle mieści się w kolumnie
 * wykresu o wysokości około 50 px przy promieniu 3 px. Znowu: render zna
 * prawdziwą liczbę i ma ją podać, bo od niej zależy flaga `fitsInBand`.
 */
export const BEESWARM_DEFAULT_HALF_BAND_RADII = 8;

/**
 * Zapas na krawędziach osi wartości, w promieniach punktu.
 *
 * Punkt jest kołem, a nie kreską: obserwacja o wartości równej krańcowi
 * domeny wystaje poza pole rysunku dokładnie o promień i zostaje ucięta
 * krawędzią. Ucięty punkt skrajny jest defektem tej samej klasy co ucięta
 * oś - obserwacja odstająca, czyli często najważniejsza liczba na wykresie,
 * przestaje być widoczna w całości. Render rozszerza domenę o tyle promieni
 * z każdej strony.
 */
export const BEESWARM_EDGE_PAD_RADII = 1;

/**
 * Poniżej tylu obserwacji w największym roju nie ma o czym mówić.
 *
 * Dwie obserwacje to nie rozkład, to dwie liczby - w tekście czytają się
 * lepiej niż na wykresie, bo wykres każe je najpierw odczytać z osi. Próg
 * jest NISKI (a nie dwadzieścia jak w histogramie), i to jest świadome: mała
 * próba jest właśnie tym przypadkiem, w którym beeswarm bije histogram, bo
 * pokazuje każdą obserwację i nie wymyśla wierzchołków z położenia krawędzi.
 */
export const BEESWARM_MIN_OBSERVATIONS = 3;

/**
 * Powyżej tylu obserwacji w jednym roju forma przestaje działać.
 *
 * Beeswarm obiecuje jedno: każdą obserwację widać osobno. Przy około stu
 * pięćdziesięciu punktach w roju punkty stykają się na całej wysokości pasma,
 * chmura zlewa się w kształt i ta obietnica przestaje być prawdziwa -
 * czytelnik i tak odczytuje wtedy tylko obrys, czyli robi to, co dałby mu
 * histogram albo skrzynka, tylko z gorszą rozdzielczością wartości. Liczba
 * jest umowna i dlatego jest STAŁĄ Z NAZWĄ, a nie wpisana w warunek.
 */
export const BEESWARM_MAX_COMFORT = 150;

/**
 * Twardy sufit liczby punktów w jednym roju.
 *
 * Treść bloku pochodzi z bazy i nikt nie obiecał, że w arkuszu jest
 * kilkadziesiąt wierszy - może być dziesięć tysięcy z importu CSV. Rozsuwanie
 * porównuje każdy punkt z sąsiadami w promieniu dwóch jednostek, więc dla
 * próby, w której wszystkie wartości są równe, koszt rośnie kwadratowo i przy
 * dziesięciu tysiącach punktów blok zablokowałby wątek renderujący na
 * sekundy. Sufit jest więc osłoną wydajności, ale NIE JEST cichy: obserwacje
 * ponad sufit są policzone w `truncated`, a `pointCountOk` schodzi na `false`,
 * bo na obrazku jest wtedy mniej punktów niż w danych. Przy takiej próbie
 * właściwą formą jest histogram, i to mówi porada formy.
 */
export const BEESWARM_MAX_POINTS = 2000;

/**
 * Metoda interpolacji kwantyli do kompletu pozycyjnego w tabeli: liniowa
 * interpolacja statystyk pozycyjnych, h = (n - 1) * p, w literaturze typ 7
 * (Hyndman i Fan 1996).
 *
 * DLACZEGO TA. Czytelnik, który chce nas sprawdzić, wpisze liczby do arkusza
 * albo do `numpy`, a typ 7 jest domyślny w R (`quantile`), w numpy i pandas,
 * w Excelu (`QUARTILE.INC`) oraz w Arkuszach Google. Zawiasy Tukeya są
 * historycznie związane ze skrzynką, ale nie ma ich w żadnym narzędziu, do
 * którego czytelnik sięgnie. Wybieramy metodę WERYFIKOWALNĄ i podajemy jej
 * nazwę w przypisie tabeli, bo przy tej metodzie kwartyl może być liczbą,
 * której w danych nie ma.
 *
 * ARYTMETYKĘ TRZYMA `quantile` ZE `stats.ts`, a ta stała jest wyłącznie NAZWĄ
 * dla przypisu. Dopóki liczba i jej nazwa powstawały w tym samym pliku, nic
 * nie pilnowało, żeby wszystkie rodzaje liczyły ten sam typ 7 tak samo -
 * i nie liczyły: cztery kopie tej definicji stały w silniku w DWÓCH różnych
 * wzorach (interpolacja różnicą i mieszaniem), więc ten sam szereg dawał różne
 * kwartyle w różnych rodzajach, każdy podpisany jako typ 7.
 */
export const BEESWARM_QUANTILE_METHOD = "linear-r7";
export type BeeswarmQuantileMethod = typeof BEESWARM_QUANTILE_METHOD;

/**
 * Tolerancja porównań geometrycznych.
 *
 * Rozsuwanie liczy pierwiastki i różnice, więc styk dwóch punktów wypada
 * w podwójnej precyzji o kilka bitów obok dokładnego 2. Bez tolerancji
 * sprawdzenie `noOverlap` zgłaszałoby nakładkę na parze, która dokładnie się
 * styka (czyli na własnym, poprawnym wyniku algorytmu), a wybór wolnego
 * miejsca odrzucałby miejsca leżące dokładnie na krawędzi zajętego
 * przedziału i rój puchłby bez powodu.
 */
const EPS = 1e-9;

/** Tolerancja sprawdzenia nakładania - luźniejsza, bo kumuluje pierwiastki. */
const OVERLAP_EPS = 1e-6;

/* -------------------------------------------------------------------------- */
/*  Typy wyjścia                                                              */
/* -------------------------------------------------------------------------- */

/** Jak grupujemy obserwacje: seria jest rojem (domyślnie) albo kategoria. */
export type BeeswarmGroupBy = "series" | "category";

/** Jedna obserwacja na obrazku. */
export interface BeeswarmPoint {
  /** Indeks w tablicy źródłowej - pozwala renderowi wrócić do arkusza. */
  sourceIndex: number;
  /** Etykieta obserwacji (wiersz arkusza albo nazwa serii - zależnie od trybu). */
  label: string;
  /**
   * Wartość w jednostkach danych. TO SĄ DANE: render skaluje ją tą samą
   * skalą, którą rysuje oś, i nie wolno jej modyfikować rozsuwaniem.
   */
  value: number;
  /**
   * Ta sama pozycja wyrażona w promieniach punktu, czyli w jednostkach,
   * w których liczone jest rozsuwanie. Wychodzi z modelu, żeby render (i test)
   * mógł sprawdzić brak nakładek bez powtarzania przeliczenia.
   */
  valueRadii: number;
  /**
   * Przesunięcie w poprzek osi wartości, w promieniach punktu. Zero to środek
   * pasma roju. TO NIE SĄ DANE - to jedyny zabieg czytelności w tym modelu.
   */
  offset: number;
  /** Czy całe koło punktu mieści się w dostępnym pasmie roju. */
  insideBand: boolean;
  /** Czy wartość mieści się w domenie osi (poza nią render by ją uciął). */
  insideDomain: boolean;
}

/**
 * Komplet pozycyjny roju. NIE SAMA ŚREDNIA, i to jest tu najważniejsze -
 * kolumna "Czego unikać" zabrania przy rozkładzie "średniej bez rozproszenia",
 * a podpis pod wykresem jest miejscem, w którym ten błąd popełnia się
 * najłatwiej.
 */
export interface BeeswarmSummary {
  n: number;
  /** Luki i nieliczby pominięte przy budowie roju. */
  missing: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  mean: number;
  /**
   * Rozstęp międzykwartylowy - TA SAMA LICZBA I TO SAMO MILCZENIE co `iqr`
   * ze `stats.ts`. `null` znaczy "różnicy `q3 - q1` nie da się zapisać
   * w podwójnej precyzji" (kwartyle po przeciwnych krańcach zakresu double),
   * a NIE "rozstęp wynosi zero" - zero jest orzeczeniem o rozkładzie
   * zdegenerowanym i wygląda tak samo wiarygodnie jak liczba policzona.
   */
  iqr: number | null;
}

/** Jeden rój: jedna grupa obserwacji. */
export interface BeeswarmSwarm {
  /** Pozycja roju w układzie (0-indeksowana) - decyduje o pasmie. */
  index: number;
  label: string;
  /** Slot palety 1..MAX_SERIES. Kolor niesie TOŻSAMOŚĆ grupy i nic więcej. */
  colorSlot: number;
  /** Liczebność próby po odfiltrowaniu luk i nieliczb. */
  n: number;
  /** Ile pozycji w arkuszu tej grupy było luką albo nieliczbą. */
  missing: number;
  /** Punkty w kolejności ROSNĄCEJ po wartości (i po indeksie przy remisie). */
  points: BeeswarmPoint[];
  /**
   * Komplet pozycyjny. `null` = nie ma czego pokazać - próba pusta albo
   * kwantyl, którego nie da się policzyć. Model milczy w obu przypadkach,
   * zamiast wpisywać w kolumny liczbę zastępczą.
   */
  summary: BeeswarmSummary | null;

  /** Środek pasma roju jako udział szerokości osi kategorii (0..1). */
  center: number;
  /**
   * CAŁE pasmo roju (udziały osi kategorii), do warstwy trafień. Strefa
   * trafienia nigdy nie jest kształtem elementu - punkt o promieniu 3 px jest
   * nietrafialny kursorem i całkowicie niedostępny z klawiatury.
   */
  band: { start: number; end: number };

  /** Najmniejsze i największe użyte przesunięcie, w promieniach punktu. */
  offsetMin: number;
  offsetMax: number;
  /**
   * Ile promieni na stronę rój FAKTYCZNIE zajął (największe |offset| plus
   * jeden promień na samo koło punktu). Render porównuje to z miejscem, które
   * ma.
   */
  neededHalfSpanRadii: number;
  /** Czy rój mieści się w podanym pasmie. `false` = rodzaj jest złym wyborem. */
  fitsInBand: boolean;
  /**
   * Ile razy trzeba zmniejszyć promień punktu, żeby rój zmieścił się w pasmie.
   * 1 = mieści się.
   *
   * PODPOWIEDŹ, NIE WYNIK, i trzeba to czytać dosłownie: mniejszy promień to
   * inna jednostka, więc oś wartości ma wtedy WIĘCEJ promieni długości, punkty
   * rozjeżdżają się wzdłuż niej i rój układa się płaściej niż wynikałoby
   * z prostego przeskalowania. Po zmianie promienia model trzeba przeliczyć
   * (nowy `spanRadii` i `halfBandRadii`), a nie przemnożyć jego wynik. Liczba
   * jest więc dolnym oszacowaniem korekty.
   */
  radiusScaleToFit: number;
  /** Ile obserwacji odrzucił sufit `BEESWARM_MAX_POINTS`. */
  truncated: number;
  /** Czy rój przekroczył `BEESWARM_MAX_COMFORT`, czyli zlewa się w kształt. */
  crowded: boolean;
}

/**
 * SPRAWDZENIA UCZCIWOŚCI. Konwencja repo: `null` znaczy NIE MA CZEGO
 * SPRAWDZAĆ (model wtedy MILCZY, nie zaświadcza), `false` znaczy defekt
 * wykryty.
 *
 * Cztery pierwsze pola to SAMOSPRAWDZENIA arytmetyki rozsuwania: liczone
 * z wyniku, ale porównywane z danymi wejściowymi albo z warunkiem
 * geometrycznym, którego algorytm miał dopilnować - czyli mogą wyjść `false`.
 * To jest różnica wobec pułapki opisanej w `pieModel`: udziały policzone
 * z własnej sumy domykają się z definicji i ich sprawdzanie nie wykrywa
 * niczego. Tu jest odwrotnie - "żaden punkt nie zginął" i "żadna para się nie
 * nakłada" to dwa najczęstsze defekty implementacji beeswarma i oba są
 * wyrażalne arytmetycznie. Pola dalsze dotyczą DANYCH AUTORA.
 */
export interface BeeswarmHonesty {
  /**
   * Liczba punktów na obrazku równa się liczbie obserwacji w danych.
   *
   * NAJWAŻNIEJSZE SPRAWDZENIE TEGO RODZAJU. Rozsuwanie zachłanne szuka
   * wolnego miejsca dla każdego punktu po kolei i najłatwiejszy błąd w takim
   * algorytmie polega na tym, że punkt bez wolnego miejsca wypada z pętli
   * (przerwane `for`, `continue` w gałęzi braku miejsca, przepełniony bufor
   * pozycji). Chmura punktów z jednym punktem mniej wygląda dokładnie tak
   * samo wiarygodnie, więc nikt tego nie zauważy - a wykres pokazuje wtedy
   * inną próbę niż arkusz. `null` = zero obserwacji.
   */
  pointCountOk: boolean | null;
  /**
   * Wielozbiór wartości narysowanych jest identyczny z wielozbiorem wartości
   * z arkusza.
   *
   * Warunek MOCNIEJSZY od poprzedniego i wykrywający cichszy błąd: liczba
   * punktów się zgadza, ale któryś został po drodze przesunięty na osi
   * wartości, żeby zrobić miejsce (klasyczny "jitter" wzdłuż osi wartości albo
   * zaokrąglenie pozycji do siatki). Pozycja na osi wartości JEST DANYMI, więc
   * takie przesunięcie to wykres cudzej próby. `null` = zero obserwacji.
   */
  valuesPreserved: boolean | null;
  /**
   * Żadna para punktów w tym samym roju nie jest bliżej niż
   * `POINT_CLEARANCE_RADII`, czyli nie nakłada się.
   *
   * To jest sprawdzenie CELU tego rodzaju: nakładające się punkty zaniżają
   * widzianą liczebność dokładnie tam, gdzie dane są najgęstsze, więc rozkład
   * wygląda na płaski w miejscu, w którym ma szczyt. `null` = mniej niż dwie
   * obserwacje, więc żadnej pary nie ma.
   */
  noOverlap: boolean | null;
  /**
   * Wszystkie liczby geometrii są skończone.
   *
   * Nie jest to higiena, tylko bramka: `Intl.NumberFormat.format(NaN)` zwraca
   * literalny napis "NaN", a `blockMatrix` sprawdza `textContent` bloków
   * właśnie na taki napis, więc jedno niedomknięte dzielenie wychodzi z modelu
   * prosto na stronę jako słowo. `null` = zero obserwacji.
   */
  offsetsFinite: boolean | null;

  /**
   * Wszystkie roje mieszczą się w dostępnym pasmie.
   *
   * `false` znaczy: obserwacji jest za wiele na dostępną szerokość i beeswarm
   * jest tu złym wyborem. Model NIE dociska punktów do pasma - dociśnięcie
   * dałoby nakładki, czyli kłamstwo o gęstości, i to jest dokładnie ten "cichy
   * błąd", którego ta flaga ma nie dopuścić. `null` = zero obserwacji.
   */
  fitsInBand: boolean | null;
  /**
   * Czy w danych JEST rozproszenie. `false` = wszystkie obserwacje mają jedną
   * wartość, więc rozkładu nie ma; rój zwija się wtedy w prostą kolumnę
   * punktów i słowo "rozkład" w podpisie jest bez treści. `null` = zero
   * obserwacji.
   */
  spreadOk: boolean | null;
  /**
   * Czy domena osi obejmuje wszystkie obserwacje. `false` = render dostał
   * domenę (np. wymuszoną przez autora albo policzoną z innej serii), która
   * ucina część punktów krawędzią rysunku, a ucięty punkt to obserwacja
   * niepokazana. `null` = zero obserwacji.
   */
  domainCoversData: boolean | null;
  /**
   * Czy `sampleSize` z konfiguracji zgadza się z liczbą obserwacji policzoną
   * w każdym niepustym roju.
   *
   * SPRAWDZAMY DANE AUTORA, NIE WŁASNĄ ARYTMETYKĘ - tak jak suma udziałów na
   * tarczy. Realny defekt: podpis mówi "n = 300", bo tyle ankiet zebrano,
   * a w arkuszu bloku siedzi 12 wierszy, bo ktoś wkleił próbkę. Wtedy wykres
   * i podpis mówią o dwóch różnych badaniach. `null` = autor nie zadeklarował,
   * nie ma ani jednego niepustego roju, albo tryb grupowania nie odpowiada
   * deklaracji (`sampleSize` jest liczbą obserwacji NA SERIĘ, więc przy
   * `groupBy: "category"` nie ma czego z nią porównać).
   */
  declaredSampleSizeOk: boolean | null;

  /**
   * Udział obserwacji, których wartość powtarza się w danych (0..1).
   *
   * LICZBA, NIE FLAGA, bo nie ma tu defektu - remisy są właściwością danych
   * (wartości zaokrąglone do pełnych procentów, oceny w skali 1-5). Ale są
   * powodem, dla którego rój puchnie w poprzek: punkty o identycznej wartości
   * muszą stanąć jeden nad drugim. Render i edytor czytają z tej liczby, czy
   * przepełnienie pasma bierze się z liczebności, czy z ziarna danych.
   */
  tiedShare: number;

  /** Etykiety rojów, które nie zmieściły się w pasmie. */
  overflowSwarms: string[];
  /** Etykiety rojów bez ani jednej obserwacji - pasmo zostaje puste. */
  emptySwarms: string[];
  /** Etykiety rojów powyżej `BEESWARM_MAX_COMFORT` - punkty zlewają się. */
  crowdedSwarms: string[];
  /** Etykiety rojów przyciętych sufitem `BEESWARM_MAX_POINTS`. */
  truncatedSwarms: string[];
}

export interface BeeswarmModel {
  swarms: BeeswarmSwarm[];
  groupBy: BeeswarmGroupBy;
  /** WSPÓLNA oś wartości wszystkich rojów - patrz nagłówek pliku. */
  domain: { min: number; max: number };
  /** Długość osi wartości w promieniach punktu (wejście renderu). */
  spanRadii: number;
  /** Połowa szerokości pasma roju w promieniach punktu (wejście renderu). */
  halfBandRadii: number;
  /** Liczba obserwacji w danych (przed sufitem punktów). */
  observations: number;
  /** Liczba punktów, które model faktycznie oddał do narysowania. */
  drawn: number;
  /** Liczba luk i nieliczb w odczytanym zakresie arkusza. */
  missing: number;
  /** Najmniejsza korekta promienia po rojach; 1 = wszystko się mieści. */
  radiusScaleToFit: number;
  honesty: BeeswarmHonesty;
}

export interface BeeswarmInput {
  categories: readonly string[];
  series: readonly ChartSeries[];
  /** `ChartConfig.sampleSize` - deklaracja autora, `null` gdy nie podał. */
  sampleSize?: number | null;
}

export interface BeeswarmOptions {
  groupBy?: BeeswarmGroupBy;
  /** Długość osi wartości podzielona przez promień punktu. */
  spanRadii?: number;
  /** Połowa szerokości pasma roju podzielona przez promień punktu. */
  halfBandRadii?: number;
  /**
   * Domena osi wartości. Render, który rysuje oś `niceScale`, MUSI ją tu
   * podać: rozsuwanie liczy odległości w promieniach punktu, czyli przez
   * skalę, więc policzone dla innej domeny niż rysowana daje punkty
   * nakładające się na obrazku, choć model twierdzi, że rozsunął. `null`
   * = policz z danych.
   */
  domain?: { min: number; max: number } | null;
  /** Sufit punktów w roju - do testów i do renderów o innym budżecie. */
  maxPoints?: number;
}

/* -------------------------------------------------------------------------- */
/*  Prymitywy odporne na dane z bazy                                          */
/* -------------------------------------------------------------------------- */

/**
 * Liczba skończona albo wartość zastępcza. Każde dzielenie i każda różnica,
 * która może przepełnić, przechodzi przez ten filtr - patrz `offsetsFinite`.
 */
function fin(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Odczyt jednej komórki arkusza. Luka (`null`), brak elementu (tablica
 * krótsza niż `categories`) i nieskończoność są TYM SAMYM: brakiem pomiaru.
 * NIE są zerem - zero jest pomiarem i weszłoby do rozkładu, dokładając punkt
 * w miejscu, którego dane nie potwierdzają.
 */
function liczba(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Dodatnia liczba z opcji albo wartość domyślna. Render przychodzi z bazy
 * przez konfigurację bloku, więc `spanRadii` może być zerem (pole
 * nieuzupełnione), liczbą ujemną (ktoś odjął marginesy od zbyt małego pola)
 * albo `NaN`. Zero w mianowniku dałoby `Infinity` w pozycji punktu, a liczba
 * ujemna odwróciłaby oś - jedno i drugie jest gorsze od wartości domyślnej.
 */
function dodatnia(raw: number | undefined, domyslna: number): number {
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : domyslna;
}

/** Slot palety 1..MAX_SERIES; poza zakresem zawija, bo slotu 9 nie ma. */
function slot(raw: number | undefined, pozycja: number): number {
  const surowy = typeof raw === "number" && Number.isFinite(raw) ? Math.trunc(raw) : pozycja + 1;
  const w1 = surowy >= 1 ? surowy : pozycja + 1;
  return ((w1 - 1) % MAX_SERIES) + 1;
}

/* -------------------------------------------------------------------------- */
/*  Rozsuwanie: deterministyczne, zachłanne, po najbliższym wolnym miejscu    */
/* -------------------------------------------------------------------------- */

/**
 * Najbliższe zera wolne miejsce przy zadanych przedziałach zajętych.
 *
 * DLACZEGO SCALANIE PRZEDZIAŁÓW, A NIE PRZEGLĄD KANDYDATÓW. Naiwna wersja
 * bierze jako kandydatów zero i wszystkie krańce przedziałów, a potem
 * sprawdza każdego kandydata wobec każdego przedziału - czyli kwadratowo
 * w liczbie sąsiadów, a sąsiadów w roju o identycznych wartościach jest tyle,
 * ile punktów. Na próbie 2000 równych liczb dawało to sześcian liczby punktów
 * i blok zawieszał wątek na kilkadziesiąt sekund. Po scaleniu przedziałów
 * odpowiedź jest jednoznaczna i wynika z definicji scalenia: albo zero jest
 * wolne, albo leży w dokładnie jednym scalonym bloku, a wtedy najbliższym
 * wolnym miejscem jest jeden z jego dwóch krańców (wszystko między nimi jest
 * zajęte, a poza blokiem jest przerwa, więc krańce są wolne).
 *
 * REMIS ROZSTRZYGA SIĘ NA STRONĘ UJEMNĄ, i to jest jedyne miejsce, w którym
 * ten model podejmuje decyzję estetyczną. Musi być deterministyczna, bo ten
 * sam zestaw danych ma dać ten sam obrazek - losowanie strony jest tu
 * zakazane podwójnie: przez regułę repo o `Math.random` i przez powtarzalność
 * obrazka we wpisie. Efekt uboczny jest pożyteczny: po odesłaniu drugiego
 * punktu w dół trzeci trafia w górę, więc rój wychodzi symetryczny bez
 * osobnego wyśrodkowania.
 */
function najblizszeWolneMiejsce(przedzialy: { lo: number; hi: number }[]): number {
  if (przedzialy.length === 0) return 0;
  przedzialy.sort((a, b) => a.lo - b.lo);
  const scalone: { lo: number; hi: number }[] = [];
  for (const p of przedzialy) {
    const ostatni = scalone[scalone.length - 1];
    if (ostatni && p.lo <= ostatni.hi + EPS) {
      if (p.hi > ostatni.hi) ostatni.hi = p.hi;
      continue;
    }
    scalone.push({ lo: p.lo, hi: p.hi });
  }
  for (const blok of scalone) {
    // Punkt jest zablokowany tylko WEWNĄTRZ bloku; styk z krańcem to styk
    // dwóch kół, a ten jest dozwolony (patrz POINT_CLEARANCE_RADII).
    if (blok.lo < -EPS && blok.hi > EPS) {
      return Math.abs(blok.lo) <= Math.abs(blok.hi) ? blok.lo : blok.hi;
    }
  }
  return 0;
}

/**
 * Rozsunięcie jednego roju. Wejście: pozycje na osi wartości w promieniach
 * punktu, POSORTOWANE ROSNĄCO. Wyjście: przesunięcia w poprzek, pozycyjnie.
 *
 * ALGORYTM. Idziemy punktami w kolejności rosnącej wartości i dla każdego
 * pytamy: gdzie najbliżej środka pasma może stanąć, żeby nie dotknąć żadnego
 * z już postawionych. Punkt postawiony w odległości `dv` na osi wartości
 * zajmuje w poprzek przedział o połowie szerokości `sqrt(4 - dv*dv)` wokół
 * swojego przesunięcia - to jest twierdzenie Pitagorasa, a nie heurystyka:
 * dwa koła o promieniu 1 (jednostką jest promień punktu) stykają się, gdy ich
 * środki są od siebie o 2, więc przy różnicy `dv` wzdłuż osi wystarczy
 * różnica `sqrt(4 - dv*dv)` w poprzek.
 *
 * DLACZEGO NIE SIATKA HEKSAGONALNA. Wariant heksagonalny (kubełkowanie
 * wartości do kolumn i układanie punktów w plaster miodu) daje ładniejszy,
 * bardziej regularny rój - ale kubełkowanie PRZESUWA punkt na osi wartości do
 * środka kolumny, a to jest jedyna rzecz, której temu rodzajowi nie wolno
 * zrobić. Zysk estetyczny za cenę zmiany danych jest tu wykluczony
 * z definicji, więc siatka odpada i zostaje wariant zachłanny, który pozycję
 * na osi wartości zachowuje dokładnie.
 *
 * KOSZT. Skan wstecz przerywa się na pierwszym punkcie dalszym niż dwa
 * promienie, więc przy danych rozproszonych koszt jest liniowy z małą stałą.
 * Kwadratowo rośnie tylko dla próby o wartościach niemal identycznych - i tam
 * pilnuje go sufit `BEESWARM_MAX_POINTS`.
 */
function rozsunRoj(valueRadii: readonly number[]): number[] {
  const offsets = new Array<number>(valueRadii.length).fill(0);
  for (let i = 0; i < valueRadii.length; i++) {
    const vi = valueRadii[i];
    const przedzialy: { lo: number; hi: number }[] = [];
    for (let j = i - 1; j >= 0; j--) {
      const dv = vi - valueRadii[j];
      // Tablica jest posortowana rosnąco, więc dalej wstecz różnica tylko
      // rośnie - pierwszy punkt spoza zasięgu kończy skan.
      if (dv >= POINT_CLEARANCE_RADII - OVERLAP_EPS) break;
      const kwadrat = POINT_CLEARANCE_RADII * POINT_CLEARANCE_RADII - dv * dv;
      // Osłona mianownika pierwiastka: `dv` bywa minimalnie większe od dwóch
      // po błędzie zaokrąglenia, a `Math.sqrt` liczby ujemnej to NaN, czyli
      // napis "NaN" na stronie.
      const h = Math.sqrt(kwadrat > 0 ? kwadrat : 0);
      przedzialy.push({ lo: offsets[j] - h, hi: offsets[j] + h });
    }
    offsets[i] = fin(najblizszeWolneMiejsce(przedzialy));
  }
  return offsets;
}

/* -------------------------------------------------------------------------- */
/*  Odczyt arkusza                                                            */
/* -------------------------------------------------------------------------- */

interface SurowaObserwacja {
  sourceIndex: number;
  label: string;
  value: number;
}

interface SurowaGrupa {
  label: string;
  colorSlot: number;
  obserwacje: SurowaObserwacja[];
  missing: number;
}

/**
 * Podział arkusza na roje. Dwa odczytania tego samego kształtu danych, żaden
 * nie wymaga rozszerzenia schematu bloku:
 *
 *   * `series` (domyślne) - jedna seria jest jednym rojem, jej `values` to
 *     obserwacje, a `categories` to etykiety wierszy arkusza. Tak wygląda
 *     arkusz wpisany "w słupkach", czyli tak, jak wpisuje się próbę;
 *   * `category` - jedna kategoria jest jednym rojem, obserwacje leżą w tej
 *     kolumnie we wszystkich seriach, a etykietą punktu jest nazwa serii. Tak
 *     wygląda arkusz transponowany.
 *
 * DEGRADACJA JEST SENSOWNA, NIE AWARYJNA. Blok wypełniony po staremu (jedna
 * liczba na przecięciu, pięć kategorii i trzy serie) w trybie `series` daje
 * trzy roje po pięć obserwacji - czyli dokładnie to, co widać w arkuszu, tylko
 * czytane jako rozkład. Model nie udaje, że ma więcej danych, niż dostał.
 */
function grupuj(input: BeeswarmInput, groupBy: BeeswarmGroupBy): SurowaGrupa[] {
  const categories = input.categories;
  const series = input.series;
  if (groupBy === "category") {
    return categories.map((label, i) => {
      const obserwacje: SurowaObserwacja[] = [];
      let missing = 0;
      series.forEach((s, si) => {
        const v = liczba(s.values[i]);
        if (v === null) {
          missing += 1;
          return;
        }
        obserwacje.push({ sourceIndex: si, label: s.name, value: v });
      });
      return { label, colorSlot: slot(undefined, i), obserwacje, missing };
    });
  }
  return series.map((s, si) => {
    const obserwacje: SurowaObserwacja[] = [];
    let missing = 0;
    for (let i = 0; i < s.values.length; i++) {
      const v = liczba(s.values[i]);
      if (v === null) {
        missing += 1;
        continue;
      }
      obserwacje.push({ sourceIndex: i, label: categories[i] ?? "", value: v });
    }
    return { label: s.name, colorSlot: slot(s.colorSlot, si), obserwacje, missing };
  });
}

/* -------------------------------------------------------------------------- */
/*  Model                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Model rozrzutu ulowego: gdzie stoi każda obserwacja, jakim slotem palety
 * i czy rozsunięcie w ogóle się udało.
 *
 * JEDNA FUNKCJA DLA GRAFIKI, LEGENDY I TABELI DANYCH - inaczej alternatywa
 * tekstowa liczy komplet pozycyjny z innej próby niż ta, którą widać na
 * obrazku, a rozjazd między trzema drogami do tej samej liczby jest defektem
 * samym w sobie.
 */
export function beeswarmModel(input: BeeswarmInput, opts: BeeswarmOptions = {}): BeeswarmModel {
  const groupBy: BeeswarmGroupBy = opts.groupBy === "category" ? "category" : "series";
  const spanRadii = dodatnia(opts.spanRadii, BEESWARM_DEFAULT_SPAN_RADII);
  const halfBandRadii = dodatnia(opts.halfBandRadii, BEESWARM_DEFAULT_HALF_BAND_RADII);
  const maxPoints = Math.max(1, Math.trunc(dodatnia(opts.maxPoints, BEESWARM_MAX_POINTS)));
  const grupy = grupuj(input, groupBy);

  // Zakres danych liczony PRZED rozsuwaniem i niezależnie od domeny podanej
  // przez render - służy zarówno domenie domyślnej, jak i sprawdzeniu, czy
  // domena narzucona z zewnątrz obejmuje obserwacje.
  let dataMin = Infinity;
  let dataMax = -Infinity;
  let obserwacjeRazem = 0;
  let brakiRazem = 0;
  for (const g of grupy) {
    brakiRazem += g.missing;
    for (const o of g.obserwacje) {
      obserwacjeRazem += 1;
      if (o.value < dataMin) dataMin = o.value;
      if (o.value > dataMax) dataMax = o.value;
    }
  }
  const pustaProba = obserwacjeRazem === 0;
  // Bez obserwacji domena musi być JAKAŚ, żeby render nie dzielił przez zero
  // przy rysowaniu osi. Zero do jedynki jest tu neutralnym wyborem: nie
  // twierdzi niczego o danych, których nie ma.
  if (pustaProba) {
    dataMin = 0;
    dataMax = 1;
  }

  const zewnetrzna = opts.domain;
  const domenaOk =
    zewnetrzna != null &&
    Number.isFinite(zewnetrzna.min) &&
    Number.isFinite(zewnetrzna.max) &&
    zewnetrzna.max >= zewnetrzna.min;
  const domain = domenaOk
    ? { min: zewnetrzna.min, max: zewnetrzna.max }
    : { min: dataMin, max: dataMax };
  const rozpietosc = domain.max - domain.min;

  /**
   * Wartość na pozycję w promieniach punktu. OSŁONA MIANOWNIKA JEST TU
   * OBOWIĄZKOWA: domena o zerowej szerokości (wszystkie obserwacje równe albo
   * jedna obserwacja) dawała bez niej dzielenie zera przez zero, czyli NaN
   * w każdej pozycji, a `Intl.NumberFormat.format(NaN)` zwraca literalny napis
   * "NaN". Zero jest właściwą odpowiedzią, bo przy zerowej rozpiętości
   * wszystkie punkty leżą w tym samym miejscu osi - i rój wychodzi wtedy
   * prostą kolumną, co jest uczciwym obrazem takich danych.
   */
  const naPromienie = (v: number): number =>
    rozpietosc > 0 ? fin(((v - domain.min) / rozpietosc) * spanRadii) : 0;

  const liczbaRojow = grupy.length;
  const swarms: BeeswarmSwarm[] = grupy.map((g, index) => {
    // KOLEJNOŚĆ JEST DETERMINISTYCZNA I MUSI BYĆ. Sortowanie po wartości
    // z indeksem źródłowym jako drugim kluczem daje jedną, powtarzalną
    // kolejność także dla remisów - a od kolejności zależy wynik rozsuwania,
    // więc bez drugiego klucza ten sam arkusz mógłby dać dwa różne obrazki
    // przy dwóch różnych implementacjach `sort`.
    const posortowane = [...g.obserwacje].sort(
      (a, b) => a.value - b.value || a.sourceIndex - b.sourceIndex,
    );
    const truncated = Math.max(0, posortowane.length - maxPoints);
    const uzyte = truncated > 0 ? posortowane.slice(0, maxPoints) : posortowane;

    const valueRadii = uzyte.map((o) => naPromienie(o.value));
    const offsets = rozsunRoj(valueRadii);

    let offsetMin = 0;
    let offsetMax = 0;
    let szczyt = 0;
    const points: BeeswarmPoint[] = uzyte.map((o, i) => {
      const offset = fin(offsets[i]);
      if (offset < offsetMin) offsetMin = offset;
      if (offset > offsetMax) offsetMax = offset;
      const abs = Math.abs(offset);
      if (abs > szczyt) szczyt = abs;
      return {
        sourceIndex: o.sourceIndex,
        label: o.label,
        value: o.value,
        valueRadii: fin(valueRadii[i]),
        offset,
        // Całe koło punktu, nie jego środek: punkt, którego środek jeszcze
        // mieści się w pasmie, wystaje z niego krawędzią i zostaje ucięty.
        insideBand: abs + 1 <= halfBandRadii + EPS,
        insideDomain: o.value >= domain.min - EPS && o.value <= domain.max + EPS,
      };
    });

    const wartosci = uzyte.map((o) => o.value);
    // KWANTYL LICZY WSPÓLNA `quantile` ZE `stats.ts`, a nie kopia w tym pliku,
    // i jest to naprawa arytmetyki, nie sprzątanie powtórzeń.
    //
    // JAKI DEFEKT ZNIKA. Tutejsza kopia interpolowała RÓŻNICĄ (`a + (b-a)*f`)
    // i miała pod spodem osłonę wyświetlania (`fin(..., a)`). Dla próby
    // rozpiętej na cały zakres podwójnej precyzji różnica `b - a` przepełnia
    // się do nieskończoności, więc osłona cofała wynik do `a`: dla
    // `[-1e308, 1e308, 1e308, 1e308]` model ogłaszał pierwszy kwartyl RÓWNY
    // NAJMNIEJSZEJ OBSERWACJI (-1e308) tam, gdzie prawdziwą odpowiedzią jest
    // 5e+307. Ta liczba szła wprost do tabeli danych i do nazwy dostępnej
    // roju, czyli do jedynej drogi, którą czytelnik ekranu ma do kompletu
    // pozycyjnego - i wyglądała dokładnie tak wiarygodnie jak policzona.
    // `quantile` interpoluje MIESZANIEM (`a*(1-t) + b*t`), które nie liczy
    // różnicy, więc nie ma czym przepełnić.
    const q1 = quantile(wartosci, 0.25);
    const mediana = quantile(wartosci, 0.5);
    const q3 = quantile(wartosci, 0.75);
    // MILCZENIE WSPÓLNEJ FUNKCJI ZOSTAJE MILCZENIEM MODELU: `null` z któregoś
    // kwantyla zabiera CAŁY komplet pozycyjny, zamiast podstawiać w to jedno
    // pole liczbę zastępczą - podstawienie byłoby drugą połową tego samego
    // defektu, czyli kwartylem, którego nie policzono, podanym jako kwartyl.
    // Dla danych, które ten model wpuszcza, gałąź jest NIEOSIĄGALNA (`liczba`
    // przepuszcza wyłącznie liczby skończone, a mieszanie nie wychodzi poza
    // `[a, b]`), więc czytelnikowi ekranu nie ma jak zniknąć kolumna kompletu
    // - pinuje to test „nie gubi ani jednego pola kompletu pozycyjnego".
    const summary: BeeswarmSummary | null =
      wartosci.length === 0 || q1 === null || mediana === null || q3 === null
        ? null
        : {
            n: wartosci.length,
            missing: g.missing,
            min: fin(wartosci[0]),
            // Bez `fin`: `quantile` oddaje albo liczbę skończoną, albo `null`,
            // a osłona wyświetlania postawiona na jej wyniku byłaby dokładnie
            // tym, co przed chwilą zdjęliśmy - drugą definicją kwantyla.
            q1,
            median: mediana,
            q3,
            max: fin(wartosci[wartosci.length - 1]),
            // Suma podzielona przez długość, a nie `reduce` z dzieleniem
            // w środku: przy pustej tablicy ta gałąź się nie wykonuje, więc
            // mianownik jest zawsze dodatni.
            mean: fin(wartosci.reduce((a, v) => a + v, 0) / wartosci.length),
            // RÓŻNICA KWARTYLI MILCZY TAK SAMO JAK `iqr` ZE `stats.ts`,
            // a nie cofa się pod osłonę wyświetlania. `q3 - q1` przepełnia
            // się, gdy kwartyle stoją po przeciwnych krańcach zakresu double
            // (`[-1e308, -1e308, 1e308, 1e308]` daje 2e308), a stojące tu
            // wcześniej `fin` zamieniało to na ZERO - czyli na „rozstępu nie
            // ma" przy danych najbardziej rozproszonych, jakie da się
            // zapisać. Zero szło wprost do tabeli i do nazwy dostępnej roju,
            // więc czytelnik ekranu dostawał orzeczenie o rozkładzie
            // zdegenerowanym, którego nikt nie policzył.
            //
            // `null` w tym polu jest zmianą kontraktu WIDZIANĄ PRZEZ RENDER
            // i render ją obsługuje: komórka tabeli pokazuje wtedy kreskę
            // braku, tę samą, którą pokazuje dla całego roju bez kompletu.
            iqr: Number.isFinite(q3 - q1) ? q3 - q1 : null,
          };

    const neededHalfSpanRadii = points.length === 0 ? 0 : szczyt + 1;
    const fitsInBand = points.length === 0 || neededHalfSpanRadii <= halfBandRadii + EPS;
    const skala = fitsInBand
      ? 1
      : neededHalfSpanRadii > 0
        ? fin(halfBandRadii / neededHalfSpanRadii, 1)
        : 1;
    return {
      index,
      label: g.label,
      colorSlot: g.colorSlot,
      n: points.length,
      missing: g.missing,
      points,
      summary,
      // Pasma dzielą oś kategorii na równe części - jeden rój zajmuje wtedy
      // całą szerokość, dwa po połowie. Osłona mianownika na wypadek zera
      // rojów (arkusz bez ani jednej serii).
      center: liczbaRojow > 0 ? fin((index + 0.5) / liczbaRojow, 0.5) : 0.5,
      band: {
        start: liczbaRojow > 0 ? fin(index / liczbaRojow) : 0,
        end: liczbaRojow > 0 ? fin((index + 1) / liczbaRojow, 1) : 1,
      },
      offsetMin,
      offsetMax,
      neededHalfSpanRadii,
      fitsInBand,
      radiusScaleToFit: skala > 0 && skala < 1 ? skala : 1,
      truncated,
      crowded: points.length > BEESWARM_MAX_COMFORT,
    };
  });

  /* ---------------------------- Uczciwość -------------------------------- */

  const narysowane = swarms.reduce((a, s) => a + s.points.length, 0);

  // WIELOZBIÓR WARTOŚCI: porównanie tego, co model oddał do narysowania,
  // z tym, co przeczytał z arkusza. Liczone z DWÓCH niezależnych źródeł
  // (surowe grupy wobec punktów modelu), bo sprawdzenie liczone z jednego
  // byłoby prawdziwe z definicji i nie mogłoby niczego wykryć.
  const zArkusza = grupy.flatMap((g) => g.obserwacje.map((o) => o.value)).sort((a, b) => a - b);
  const zModelu = swarms.flatMap((s) => s.points.map((p) => p.value)).sort((a, b) => a - b);
  const valuesPreserved = pustaProba
    ? null
    : zArkusza.length === zModelu.length && zArkusza.every((v, i) => v === zModelu[i]);

  // BRAK NAKŁADEK sprawdzany na wyniku, para po parze, tym samym warunkiem
  // geometrycznym, którego pilnowało rozsuwanie. Skan ograniczony do sąsiadów
  // w promieniu dwóch jednostek, bo dalsze pary nie mogą się nakładać - punkty
  // są posortowane po wartości.
  let paryRazem = 0;
  let noOverlap = true;
  for (const s of swarms) {
    for (let i = 1; i < s.points.length; i++) {
      const a = s.points[i];
      for (let j = i - 1; j >= 0; j--) {
        const b = s.points[j];
        const dv = a.valueRadii - b.valueRadii;
        if (dv >= POINT_CLEARANCE_RADII - OVERLAP_EPS) break;
        paryRazem += 1;
        const dof = a.offset - b.offset;
        const dist = Math.sqrt(fin(dv * dv + dof * dof));
        if (dist < POINT_CLEARANCE_RADII - OVERLAP_EPS) noOverlap = false;
      }
    }
  }

  const offsetsFinite = pustaProba
    ? null
    : swarms.every((s) =>
        s.points.every(
          (p) =>
            Number.isFinite(p.offset) && Number.isFinite(p.valueRadii) && Number.isFinite(p.value),
        ),
      );

  // REMISY liczone na całej próbie: wartość powtórzona w danych zmusza punkty
  // do stania jeden nad drugim, więc jest przyczyną pęcznienia roju niezależną
  // od liczebności.
  const licznik = new Map<number, number>();
  for (const v of zArkusza) licznik.set(v, (licznik.get(v) ?? 0) + 1);
  let wRemisach = 0;
  for (const [, ile] of licznik) if (ile > 1) wRemisach += ile;
  const tiedShare = obserwacjeRazem > 0 ? fin(wRemisach / obserwacjeRazem) : 0;

  const niepuste = swarms.filter((s) => s.n > 0);
  const zadeklarowane = input.sampleSize;
  const deklaracjaPorownywalna =
    groupBy === "series" &&
    typeof zadeklarowane === "number" &&
    Number.isFinite(zadeklarowane) &&
    zadeklarowane > 0 &&
    niepuste.length > 0;

  const honesty: BeeswarmHonesty = {
    pointCountOk: pustaProba ? null : narysowane === obserwacjeRazem,
    valuesPreserved,
    // MILCZY, gdy nie ma ani jednej pary dostatecznie bliskiej, żeby mogła
    // się nałożyć (jedna obserwacja albo obserwacje rozstrzelone dalej niż
    // dwa promienie). Zaświadczanie "nic się nie nakłada" na zbiorze bez par
    // byłoby prawdą pustą i mieszałoby dwie różne rzeczy: sprawdzony
    // algorytm i brak czego sprawdzać.
    noOverlap: paryRazem === 0 ? null : noOverlap,
    offsetsFinite,
    fitsInBand: pustaProba ? null : swarms.every((s) => s.fitsInBand),
    spreadOk: pustaProba ? null : dataMax > dataMin,
    domainCoversData: pustaProba
      ? null
      : dataMin >= domain.min - EPS && dataMax <= domain.max + EPS,
    declaredSampleSizeOk: deklaracjaPorownywalna
      ? niepuste.every((s) => s.n === zadeklarowane)
      : null,
    tiedShare,
    overflowSwarms: swarms.filter((s) => !s.fitsInBand).map((s) => s.label),
    emptySwarms: swarms.filter((s) => s.n === 0).map((s) => s.label),
    crowdedSwarms: swarms.filter((s) => s.crowded).map((s) => s.label),
    truncatedSwarms: swarms.filter((s) => s.truncated > 0).map((s) => s.label),
  };

  return {
    swarms,
    groupBy,
    domain,
    spanRadii,
    halfBandRadii,
    observations: obserwacjeRazem,
    drawn: narysowane,
    missing: brakiRazem,
    radiusScaleToFit: swarms.reduce((a, s) => Math.min(a, s.radiusScaleToFit), 1),
    honesty,
  };
}

/**
 * Model z konfiguracji bloku. Czyta `categories`, `series` i `sampleSize`,
 * czyli to, co silnik już ma - beeswarm nie potrzebuje ani jednego nowego pola
 * i degraduje się do sensownego przypadku na każdym istniejącym bloku.
 *
 * Tryb grupowania nie ma dziś swojego pola w `ChartConfig`, więc przychodzi
 * przez opcje (propozycja jawnego pola jest w raporcie). Domyślny `series`
 * jest zgodny z tym, jak wpisuje się próbę: jedna kolumna arkusza to jedna
 * grupa.
 */
export function beeswarmModelFromConfig(
  config: ChartConfig,
  opts: BeeswarmOptions = {},
): BeeswarmModel {
  return beeswarmModel(
    { categories: config.categories, series: config.series, sampleSize: config.sampleSize },
    opts,
  );
}

/**
 * Zakres osi wartości.
 *
 * BEZ WYMUSZANIA ZERA, i to jest różnica wobec histogramu i słupków. Beeswarm
 * koduje wartość POZYCJĄ, nie długością, więc zero nie musi być w domenie
 * (sekcja 8: "Dla liniowego zero nie jest wymagane") - dociąganie osi płac od
 * zera zepchnęłoby cały rozkład w jeden pasek u prawej krawędzi i zniszczyło
 * to, po co ten wykres istnieje. Ucięcie osi trzeba jednak NAZWAĆ w podpisie,
 * bo różnice wyglądają wtedy na większe niż są - i to jest zadanie ramy
 * wykresu, nie modelu.
 *
 * Render dorzuca `BEESWARM_EDGE_PAD_RADII` promienia z każdej strony, żeby
 * skrajne punkty nie zostały ucięte krawędzią.
 */
export function beeswarmExtent(model: BeeswarmModel): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const s of model.swarms) {
    for (const p of s.points) {
      if (p.value < min) min = p.value;
      if (p.value > max) max = p.value;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };
  return { min, max };
}

/* -------------------------------------------------------------------------- */
/*  Porada formy                                                              */
/* -------------------------------------------------------------------------- */

export type BeeswarmFormAdvice = "tooFew" | "tooMany" | "noSpread" | "doesNotFit" | "truncated";

/**
 * Kiedy beeswarm jest ZŁYM WYBOREM formy - odpowiednik `pieFormAdvice`
 * i `histogramFormAdvice`. Osobno od sprawdzeń uczciwości, bo tu nie ma
 * defektu arytmetycznego: dane są w porządku, tylko forma o nich kłamie
 * kształtem albo nic o nich nie mówi.
 *
 *   * `tooFew` - dwie obserwacje w największym roju. To nie rozkład, to dwie
 *     liczby; w tekście czytają się lepiej niż na wykresie;
 *   * `tooMany` - powyżej `BEESWARM_MAX_COMFORT` punkty stykają się na całej
 *     wysokości pasma i chmura zlewa się w kształt, czyli obietnica "widać
 *     każdą obserwację" przestaje być prawdziwa. Wtedy histogram albo
 *     skrzynka mówią to samo czytelniej;
 *   * `noSpread` - rozproszenia nie ma, więc nie ma rozkładu; rój jest wtedy
 *     prostą kolumną punktów, a jedna liczba w tekście mówi to samo;
 *   * `doesNotFit` - rozsunięcie nie mieści się w pasmie. To NIE jest wada
 *     danych ani modelu, tylko za mało miejsca na tyle obserwacji: render
 *     zmniejsza promień punktu i przelicza, a jeśli nie ma już czego
 *     zmniejszać, rodzaj jest tu złym wyborem;
 *   * `truncated` - sufit punktów odrzucił część próby, czyli na obrazku jest
 *     mniej obserwacji niż w danych. Przy takiej liczebności histogram jest
 *     jedyną sensowną formą.
 */
export function beeswarmFormAdvice(model: BeeswarmModel): BeeswarmFormAdvice[] {
  const advice: BeeswarmFormAdvice[] = [];
  if (model.observations === 0) return advice;
  const najwiekszy = model.swarms.reduce((a, s) => Math.max(a, s.n), 0);
  if (najwiekszy < BEESWARM_MIN_OBSERVATIONS) advice.push("tooFew");
  if (model.swarms.some((s) => s.crowded)) advice.push("tooMany");
  if (model.honesty.spreadOk === false) advice.push("noSpread");
  if (model.honesty.fitsInBand === false) advice.push("doesNotFit");
  if (model.swarms.some((s) => s.truncated > 0)) advice.push("truncated");
  return advice;
}

/* -------------------------------------------------------------------------- */
/*  Alternatywa tekstowa                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Kolumny kompletu pozycyjnego w tabeli, w stałej kolejności. Render bierze
 * z tej listy nagłówki (przez słownik i18n) i porządek, żeby czytelnik uczył
 * się, gdzie czego szukać - dokładnie tak jak w tooltipie objaśniającym
 * z sekcji 5.
 */
export const BEESWARM_SUMMARY_COLUMNS = [
  "n",
  "min",
  "q1",
  "median",
  "q3",
  "max",
  "mean",
  "iqr",
] as const;

export type BeeswarmSummaryColumn = (typeof BEESWARM_SUMMARY_COLUMNS)[number];

export interface BeeswarmTableObservation {
  label: string;
  value: number;
}

export interface BeeswarmTableGroup {
  label: string;
  colorSlot: number;
  n: number;
  missing: number;
  /** `null` = nie ma czego streścić: rój pusty albo kwantyl niepoliczalny. */
  summary: BeeswarmSummary | null;
  /** WSZYSTKIE obserwacje roju, rosnąco - tyle samo, ile punktów na obrazku. */
  observations: BeeswarmTableObservation[];
  /** Ile obserwacji nie weszło na obrazek ani do tej listy. */
  truncated: number;
}

export interface BeeswarmTable {
  groups: BeeswarmTableGroup[];
  /** Suma obserwacji wiersz po wierszu - ta sama liczba co `model.drawn`. */
  total: number;
  /** Metoda kwantyli do przypisu, żeby tabela i rysunek mówiły jednym głosem. */
  quantileMethod: BeeswarmQuantileMethod;
}

/**
 * ALTERNATYWA TEKSTOWA: co ma pokazać tabela danych pod wykresem. Grafika
 * nigdy nie jest jedyną drogą do liczby - chmury punktów nie odczyta ekran
 * czytający, wydruk w skali szarości gubi kolor grupy, a z samego punktu nie
 * da się odczytać wartości dokładniej niż "mniej więcej".
 *
 * TABELA NIESIE OBIE RZECZY: komplet pozycyjny ORAZ pełną listę obserwacji.
 * Sam komplet pozycyjny byłby tu za mało, i to jest różnica wobec skrzynki:
 * beeswarm obiecuje, że widać KAŻDĄ obserwację, więc tabela musi unieść tę
 * samą obietnicę - inaczej czytelnik, który nie widzi obrazka, dostaje mniej
 * informacji niż ten, który go widzi. Sama średnia byłaby dokładnie tym, co
 * kolumna "Czego unikać" zabrania.
 *
 * Liczby pochodzą z TEGO SAMEGO modelu, z którego powstał rysunek, a nie
 * z powtórnego przeliczenia arkusza - rozjazd między obrazkiem a tabelą jest
 * defektem samym w sobie.
 */
export function beeswarmTable(model: BeeswarmModel): BeeswarmTable {
  return {
    groups: model.swarms.map((s) => ({
      label: s.label,
      colorSlot: s.colorSlot,
      n: s.n,
      missing: s.missing,
      summary: s.summary,
      observations: s.points.map((p) => ({ label: p.label, value: p.value })),
      truncated: s.truncated,
    })),
    total: model.swarms.reduce((a, s) => a + s.points.length, 0),
    quantileMethod: BEESWARM_QUANTILE_METHOD,
  };
}
