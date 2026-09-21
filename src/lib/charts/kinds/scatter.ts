// Model wykresu punktowego (scatter) - zależność DWÓCH zmiennych.
//
// PO CO TEN RODZAJ ISTNIEJE. Tabela doboru formy z sekcji 1 specyfikacji
// przypisuje wykres punktowy ("punktowy, opcjonalnie z linią trendu")
// pytaniu "Zależność dwóch zmiennych", a w kolumnie "Czego unikać" stawia
// przy nim jedno hasło: "linia łącząca punkty". To jest cała racja bytu tego
// modelu i jednocześnie jego jedyny bezwzględny zakaz.
//
// DLACZEGO PUNKTÓW NIE WOLNO ŁĄCZYĆ. Linia między punktami twierdzi dwie
// rzeczy naraz, i obie są tu fałszywe: że obserwacje mają KOLEJNOŚĆ (bo
// linia biegnie od jednej do drugiej) i że między nimi istnieją wartości
// pośrednie (bo linia je rysuje). W chmurze punktów kolejność wiersza
// w arkuszu nie jest kolejnością zjawiska, a między dwoma krajami o PKB 12
// i 31 nie ma kraju o PKB 21, którego linia domalowuje. Dlatego model
// zwraca `mayConnectPoints: false` jako POLE, a nie jako uwagę w komentarzu:
// render, który kiedyś zechce łączyć punkty, musi wprost zignorować
// oświadczenie modelu, a nie tylko nie doczytać nagłówka pliku.
//
// CZEGO TEMU RODZAJOWI NIE WOLNO POZA TYM, czyli co ten moduł wymusza po
// stronie danych, zamiast liczyć na czujność autora:
//   * NIE WOLNO rysować linii trendu bez R2 i bez n. Linia regresji jest
//     TWIERDZENIEM ("y rośnie z x"), a twierdzenie bez dowodu jest ozdobą.
//     Dlatego `ScatterTrend` nie da się zbudować bez `r2` i `n` - są polami
//     wymaganymi, nie opcjonalnymi, a przy R2 nieokreślonym pole jest `null`
//     i model MILCZY, zamiast podać nachylenie bez miary dopasowania;
//   * NIE WOLNO ekstrapolować. Odcinek trendu ma końce dokładnie na
//     najmniejszej i największej obserwacji `x` tej serii, a `scatterTrendAt`
//     ODMAWIA policzenia wartości poza tym zakresem (zwraca `null`).
//     Regresja opisuje zakres, w którym zebrano dane; przedłużona do
//     krawędzi rysunku zaczyna twierdzić o obszarze bez ani jednego pomiaru;
//   * NIE WOLNO drgać punktami (jitter). Beeswarm rozsuwa punkty, bo jego
//     druga współrzędna jest DOPEŁNIENIEM RYSUNKU; tutaj obie współrzędne są
//     danymi, więc przesunięcie punktu o pół markera jest przesunięciem
//     pomiaru. Zasłanianie się punktów jest tu POLICZONE
//     (`overplottedShare`), a nie zamiatane ruchem;
//   * NIE WOLNO zsypywać serii do jednej regresji. Trend jest liczony PER
//     SERIA i nigdy zbiorczo: regresja na dwóch chmurach o różnych średnich
//     potrafi mieć nachylenie przeciwne do nachylenia każdej z nich osobno
//     (paradoks Simpsona), czyli pokazuje zależność, której nie ma w żadnej
//     z badanych populacji.
//
// REGUŁY OGÓLNE ZE SPECYFIKACJI, KTÓRE GO DOTYCZĄ:
//   * sekcja 8 - dla wykresu, który koduje POŁOŻENIEM (a nie długością),
//     zero na osi nie jest wymagane, ale ucięcie musi być NAZWANE. Punktowy
//     koduje położeniem obie zmienne, więc obie osie wolno uciąć i obie
//     trzeba oznaczyć: `honesty.zeroInDomain` mówi renderowi, o której osi
//     ma to napisać. Z tej samej sekcji "podaj n": liczba par jest polem
//     modelu (i każdego trendu), a rozjazd z zadeklarowanym `sampleSize`
//     jest wykrywany arytmetycznie;
//   * sekcja 3 - punkt obserwacji to kropka o promieniu 2,5-3 px w kolorze
//     płyty z obwódką 1,6 px w kolorze serii. Te dwie liczby SĄ pikselami
//     i takimi zostają (`SCATTER_MARKER_R`, `SCATTER_MARKER_STROKE`), bo nie
//     kodują żadnej wartości - marker o stałym rozmiarze nie może skłamać
//     wielkością. Wszystko, co wartość NIESIE, jest w jednostkach danych
//     i przeskaluje je render;
//   * sekcja 6 - strefa trafienia nigdy nie jest kształtem elementu, więc
//     promień trafienia (`SCATTER_HIT_R`) jest wyraźnie większy od markera;
//     hover wolno zmienić promień markera o 1 px, bo promień markera nie
//     koduje wartości;
//   * sekcja 2 - liczba chmur to liczba serii, a kolor jest tu JEDYNYM
//     nośnikiem tożsamości chmury (punkty nie mają osi, do której dałoby się
//     je przypiąć etykietą), więc powyżej `CATEGORICAL_SAFE_SERIES` chmury
//     przestają być rozdzielne i trzeba iść w small multiples.
//
// OŚ X JEST CIĄGŁA, I TO JEST NOWOŚĆ W TYM SILNIKU. Wszystkie dotychczasowe
// rodzaje mają oś kategorialną: `categories[i]` to napis, a pozycja punktu
// wynika z INDEKSU. Tutaj pozycja pozioma wynika z LICZBY, więc dwa punkty
// mogą leżeć na sobie, a odstępy między nimi są nierówne i to jest właśnie
// treść wykresu. Model rozstrzyga, skąd bierze `x`, i mówi to wprost
// w `xSource` - patrz `ScatterXSource`, gdzie opisana jest cała kolejność
// degradacji obecnego kształtu konfiguracji do pary (x, y).
//
// JEDNOSTKI. `x`, `y`, `domain`, końce odcinka trendu, `slope` i `intercept`
// są w jednostkach DANYCH. `r`, `r2`, `overplottedShare` są bezwymiarowe
// w zakresie 0..1 (`r` w -1..1). Tolerancja zasłaniania
// (`SCATTER_OVERPLOT_TOLERANCE`) jest WZGLĘDNA - liczona jako część
// rozpiętości domeny, żeby model nie musiał znać szerokości rysunku. Pikseli
// w tym module nie ma poza trzema stałymi delikatności wymienionymi wyżej,
// które specyfikacja podaje w pikselach i które nie kodują wartości.
import type { ChartConfig, ChartSeries } from "../types";

/* -------------------------------------------------------------------------- */
/*  Progi i stałe                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Poniżej tylu par regresja nie jest twierdzeniem o danych.
 *
 * TRZY, bo przy DWÓCH punktach prosta przechodzi dokładnie przez oba i R2
 * wychodzi równo 1 - z arytmetyki, nie z siły zależności. Linia trendu
 * z R2 = 1,00 przy n = 2 jest najgorszym możliwym wykresem: wygląda na
 * dowód idealnego dopasowania, a jest tylko rysunkiem prostej przez dwa
 * punkty, którą można poprowadzić zawsze. Dlatego przy n < 3 model NIE
 * ZWRACA trendu (nie zwraca go z niskim R2, nie zwraca z ostrzeżeniem -
 * nie zwraca wcale) i zgłasza `enoughForTrendOk: false`.
 */
export const SCATTER_TREND_MIN_N = 3;

/**
 * Poniżej tego R2 linia trendu niczego nie pokazuje, a mimo to wygląda jak
 * twierdzenie.
 *
 * R2 jest udziałem wariancji `y` wyjaśnionym przez `x`, więc 0,1 znaczy
 * "dziewięć dziesiątych zmienności zostaje niewyjaśnione". Prosta narysowana
 * przez taką chmurę jest kreską o dowolnym nachyleniu: dorzucenie jednej
 * obserwacji potrafi je odwrócić. Czytelnik czyta z niej jednak kierunek
 * zależności, bo linia na wykresie ZAWSZE czyta się jako wniosek. Dlatego
 * to jest FLAGA (`trendMeaningfulOk: false`), a nie ciche przemilczenie:
 * model podaje nachylenie i R2, a decyzję o rysowaniu podejmuje render, mając
 * w ręku liczbę, nie wrażenie.
 */
export const SCATTER_R2_MEANINGLESS = 0.1;

/**
 * Kiedy dwa punkty są NA RYSUNKU jednym punktem - tolerancja WZGLĘDNA, jako
 * część rozpiętości domeny na danej osi.
 *
 * Model nie zna szerokości rysunku, więc nie może liczyć zasłaniania
 * w pikselach; liczy je w części domeny, a render tę część przeskaluje.
 * 0,005 to pół procenta rozpiętości: przy typowym obszarze kreślenia
 * szerokim 600 px daje 3 px, czyli dokładnie promień markera
 * (`SCATTER_MARKER_R`). Dwa punkty bliższe niż to nie są "prawie na sobie" -
 * są jedną plamką i czytelnik widzi jeden pomiar tam, gdzie było ich dwa.
 *
 * LICZONE SIATKĄ KUBEŁKÓW, nie porównaniem każdej pary, więc dwa punkty
 * leżące po dwóch stronach granicy kubełka policzą się jako rozdzielne.
 * Wynik jest przez to DOLNYM oszacowaniem zasłaniania - i to jest właściwy
 * kierunek błędu dla ostrzeżenia, które ma odpalić na chmurze zasłoniętej
 * masowo, a nie na dwóch punktach, które prawie się dotykają. Porównanie
 * każdej pary jest kwadratowe wobec liczby punktów, a odpowiedź "20% czy 21%"
 * niczego w decyzji autora nie zmienia.
 */
export const SCATTER_OVERPLOT_TOLERANCE = 0.005;

/**
 * Powyżej tego udziału punktów zasłoniętych chmura kłamie o liczności.
 *
 * Jedna piąta, bo przy takim udziale wykres pokazuje najwyżej cztery piąte
 * zebranych obserwacji, a `n` w podpisie mówi o wszystkich. Rozjazd między
 * "n = 100" i osiemdziesięcioma widocznymi plamkami czytelnik odczyta jako
 * nieuwagę autora - i będzie miał rację, bo formą dla gęstej chmury jest
 * mapa ciepła albo hexbin (sekcja 1: "Wrażliwość na dwa parametry - mapa
 * ciepła / macierz"), nie punktowy z przezroczystością.
 */
export const SCATTER_OVERPLOT_SHARE = 0.2;

/**
 * Od tylu par rosnący ciąg `x` przestaje być przypadkiem.
 *
 * CZTERY, tą samą liczbą, którą silnik przyjmuje za progiem sensownego
 * wygładzania linii (`effectiveSmoothing` w `geometry.ts`): trzy narastające
 * liczby zdarzają się w każdym arkuszu, cztery i więcej to już
 * uporządkowany szereg. Rosnący i niepowtarzalny `x` w kolejności wierszy
 * znaczy, że autor wpisał SZEREG (lata, kwartały, kolejne pomiary),
 * a pytanie "jak zmieniało się w czasie" ma w tabeli doboru formy inną
 * odpowiedź: liniowy. Advice, nie defekt - i nie furtka do łączenia punktów:
 * lekarstwem jest ZMIANA RODZAJU, nie dorysowanie linii do chmury.
 */
export const SCATTER_SEQUENCE_MIN_N = 4;

/**
 * Promień kropki obserwacji, w pikselach (sekcja 3: 2,5-3 px w kolorze płyty
 * z obwódką 1,6 px w kolorze serii). Piksele, a nie jednostki danych, bo ten
 * rozmiar NICZEGO NIE KODUJE - stały marker nie może skłamać wielkością.
 * Kodowanie rozmiarem (bubble chart) jest osobnym rodzajem i osobną decyzją,
 * bo powierzchnia siedzi w dolnej połowie hierarchii percepcyjnej.
 */
export const SCATTER_MARKER_R = 3;

/** Grubość obwódki markera, w pikselach (sekcja 3). */
export const SCATTER_MARKER_STROKE = 1.6;

/**
 * Promień strefy trafienia, w pikselach. Trzykrotność markera, bo sekcja 6
 * mówi wprost: strefa trafienia nigdy nie jest kształtem elementu. Kropka
 * o promieniu 3 px jest celem, w który nie da się trafić myszą, a palcem tym
 * bardziej - i wtedy połowa precyzji wykresu (tooltip z dokładną parą) jest
 * niedostępna, mimo że została zaimplementowana.
 */
export const SCATTER_HIT_R = 10;

/**
 * Metoda regresji, nazwana i zwracana w modelu.
 *
 * Zwykła metoda najmniejszych kwadratów `y` po `x` jest UMOWĄ, nie faktem:
 * minimalizuje odchylenia w pionie, więc regresja `x` po `y` daje INNĄ
 * prostą na tych samych danych (regresja ortogonalna jeszcze inną). Dlatego
 * metoda jedzie do przypisu pod tabelą - czytelnik przeliczający dane u siebie
 * inaczej dostanie inne nachylenie i będzie miał rację.
 */
export const REGRESSION_METHOD = "ordinary-least-squares";
export type RegressionMethod = typeof REGRESSION_METHOD;

/* -------------------------------------------------------------------------- */
/*  Typy wejścia i wyjścia                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Skąd model wziął współrzędną `x`. Pole jest w modelu, bo od niego zależy,
 * czy wykres w ogóle odpowiada na pytanie o zależność dwóch zmiennych:
 *
 *   * `explicit` - z jawnej tablicy `opts.xValues`. To DROGA DOCELOWA
 *     i jedyna, która nie zgaduje: patrz `ScatterOptions.xValues` po opis
 *     proponowanego rozszerzenia konfiguracji;
 *   * `categories` - z `categories`, gdy wszystkie niepuste etykiety dają się
 *     odczytać jako liczby. W tekstowym formacie widgetu (`csv.ts`) pierwsza
 *     kolumna JEST osią X, więc kolumna liczbowa jest zmienną X, a nie
 *     zbiorem nazw, które przypadkiem są liczbami;
 *   * `series` - z PIERWSZEJ serii, gdy jest ich co najmniej dwie. Arkusz
 *     "Polska; 12,5; 3,4" ma etykiety nieliczbowe i dwie kolumny liczb, więc
 *     pierwsza kolumna liczb to `x`, a każda następna to osobna chmura
 *     przeciw temu samemu `x`;
 *   * `index` - z numeru wiersza, gdy nie ma ani liczbowych etykiet, ani
 *     drugiej serii. To DEGRADACJA, nie tryb: X nie jest wtedy drugą
 *     zmienną, więc wykres nie odpowiada na pytanie, dla którego istnieje.
 *     Model to zgłasza (`xIsSecondVariableOk: false`) i doradza inną formę,
 *     ale rysuje, bo blok z bazy ma pokazać dane autora, a nie pustą płytę;
 *   * `none` - nie ma żadnej serii, więc nie ma czego rysować.
 */
export type ScatterXSource = "explicit" | "categories" | "series" | "index" | "none";

export interface ScatterPoint {
  /** Indeks wiersza danych - klucz do etykiety, tabeli i strefy trafienia. */
  index: number;
  /** Współrzędna pozioma w jednostkach danych. Zawsze skończona. */
  x: number;
  /** Współrzędna pionowa w jednostkach danych. Zawsze skończona. */
  y: number;
  /** Etykieta wiersza (`categories[index]`); "" gdy autor nie podał. */
  label: string;
  /** Indeks serii w wejściu - do warstwy trafień i legendy. */
  seriesIndex: number;
  /** Slot palety 1..10. */
  colorSlot: number;
  /**
   * Czy w tolerancji `SCATTER_OVERPLOT_TOLERANCE` leży inny punkt, czyli czy
   * ta plamka na rysunku jest wspólna dla kilku obserwacji. Render może z tego
   * zrobić przypis albo obwódkę; czego NIE MOŻE, to przesunąć punktu.
   */
  overplotted: boolean;
}

/**
 * Wiersz, który nie stał się punktem, bo brakowało JEDNEJ współrzędnej.
 *
 * Zachowujemy go z zawartością, a nie tylko zliczamy, bo tabela danych jest
 * JEDYNYM miejscem, w którym taka obserwacja może się pojawić: na rysunku jej
 * nie ma i nie może być (punkt bez `x` nie ma gdzie stanąć), a bez wiersza
 * w tabeli czytelnik nie dowie się, że w arkuszu było coś więcej.
 */
export interface ScatterDroppedRow {
  index: number;
  label: string;
  /** Ta współrzędna, która jest. Druga jest `null` - i to jest powód odrzucenia. */
  x: number | null;
  y: number | null;
}

/** Ile i jakich par nie ma na rysunku. Każda liczba tu jest czyjąś stratą. */
export interface ScatterDropped {
  /** Wierszy z `y`, ale bez `x`. */
  missingX: number;
  /** Wierszy z `x`, ale bez `y`. */
  missingY: number;
  /**
   * Wierszy bez obu współrzędnych. LICZONE OSOBNO od par niekompletnych, bo
   * to nie to samo zdarzenie: wiersz puszczony pusty (kategoria wpisana,
   * liczby jeszcze nie) nie jest odrzuconą obserwacją, tylko brakiem
   * obserwacji. Zsypanie obu do jednego licznika kazałoby renderowi pisać
   * "odrzucono 12 par" o arkuszu, w którym autor dopiero wpisuje dane.
   */
  emptyRows: number;
}

/**
 * Linia trendu. Istnieje TYLKO wtedy, gdy da się ją policzyć uczciwie - przy
 * n < `SCATTER_TREND_MIN_N`, przy zerowej wariancji `x` oraz przy nachyleniu
 * lub wyrazie wolnym poza podwójną precyzją pole `trend` chmury jest `null`
 * i model MILCZY, bo konwencja repo mówi, że `null` znaczy "nie ma czego
 * pokazać", a nie "policzone i wyszło zero".
 */
export interface ScatterTrend {
  /** Nachylenie w jednostkach `y` na jednostkę `x`. */
  slope: number;
  /** Wyraz wolny, czyli `y` przy `x` = 0 - także wtedy, gdy zera nie ma w danych. */
  intercept: number;
  /**
   * Współczynnik determinacji, 0..1. `null` = NIEOKREŚLONY, i jest dokładnie
   * jeden taki przypadek: zerowa wariancja `y` (wszystkie obserwacje na
   * jednej wysokości). Nie ma wtedy zmienności, którą prosta miałaby
   * wyjaśnić, więc iloraz jest 0/0 - a 0/0 to nie "doskonałe dopasowanie",
   * tylko brak pytania. Modelowi wolno wtedy podać nachylenie (jest zerowe
   * i prawdziwe), ale nie wolno podać miary dopasowania, której nie ma.
   */
  r2: number | null;
  /**
   * Korelacja Pearsona, -1..1. Osobne pole od R2, bo R2 gubi ZNAK: dwie
   * chmury o R2 = 0,8 mogą mieć zależność przeciwną, a czytelnik podpisu
   * "R2 = 0,80" nie wie, w którą stronę. Znak `r` zgadza się ze znakiem
   * `slope` i to jest samosprawdzenie tej arytmetyki.
   */
  r: number | null;
  /** Liczba par, na których policzono trend. Nigdy nie jest ozdobą podpisu. */
  n: number;
  /**
   * Lewy koniec odcinka, który WOLNO narysować: najmniejsze `x` w tej serii
   * i wartość prostej w tym punkcie. Nie krawędź rysunku i nie minimum osi.
   */
  from: { x: number; y: number };
  /** Prawy koniec odcinka - największe `x` w tej serii. */
  to: { x: number; y: number };
  /**
   * Czy R2 przekracza `SCATTER_R2_MEANINGLESS`. `false` = prosta jest kreską
   * o dowolnym nachyleniu, którą czytelnik przeczyta jako wniosek.
   * `null` = R2 nieokreślone, więc pytanie nie ma odpowiedzi.
   */
  meaningful: boolean | null;
}

/** Jedna chmura punktów, czyli jedna seria przeciw wspólnej osi X. */
export interface ScatterCloud {
  seriesIndex: number;
  name: string;
  colorSlot: number;
  /** Punkty w kolejności WIERSZY, nie posortowane po `x`. */
  points: ScatterPoint[];
  /** Liczba kompletnych par - to samo `n`, które musi być w podpisie. */
  n: number;
  /** Zakres obserwacji `x` w tej chmurze. `null` = brak par. */
  xRange: { min: number; max: number } | null;
  /** Zakres obserwacji `y` w tej chmurze. `null` = brak par. */
  yRange: { min: number; max: number } | null;
  dropped: ScatterDropped;
  /**
   * Pary niekompletne z zawartością - w kolejności wierszy. Wiersze bez OBU
   * współrzędnych tu nie wchodzą: nie ma w nich czego wypisać, a tabela
   * z pustym wierszem na każdy niewypełniony wiersz arkusza jest nieczytelna.
   */
  droppedRows: ScatterDroppedRow[];
  /** Regresja tej chmury albo `null` - patrz `ScatterTrend`. */
  trend: ScatterTrend | null;
}

/**
 * SPRAWDZENIA UCZCIWOŚCI. Konwencja repo, ta sama co w sumie kontrolnej
 * mostka (`waterfall.ts`) i w sumie udziałów (`pieModel`): `null` znaczy NIE
 * MA CZEGO SPRAWDZAĆ, więc model milczy zamiast zaświadczać, a `false` znaczy
 * defekt WYKRYTY ARYTMETYCZNIE.
 *
 * Pola `pointsInDomainOk` i `trendWithinDataOk` to SAMOSPRAWDZENIA modelu:
 * liczone niezależnie od tego, co model policzył wcześniej, bo sprawdzenie
 * wyprowadzone z własnego wyniku wychodziłoby prawdziwe z definicji i nie
 * mogłoby niczego wykryć. Pozostałe dotyczą DANYCH AUTORA.
 */
export interface ScatterHonesty {
  /**
   * Ile par odrzucono, bo brakowało jednej współrzędnej. Punkt bez `x` nie ma
   * gdzie stanąć, a punkt bez `y` nie ma wysokości - oba znikają z rysunku
   * i z regresji, więc `n` liczy mniej obserwacji, niż jest w arkuszu.
   * To sekcja 8 ("podaj n") widziana od strony arytmetyki: podaj n, które
   * naprawdę widać.
   */
  droppedPairs: number;
  /** Wierszy bez obu współrzędnych - brak obserwacji, nie odrzucenie. */
  emptyRows: number;
  /** `false` = choć jedna para niekompletna. `null` = nie ma ani jednego wiersza. */
  pairsCompleteOk: boolean | null;
  /**
   * `false` = w którejś chmurze z danymi jest mniej par niż
   * `SCATTER_TREND_MIN_N`, więc trendu dla niej nie ma. `null` = nie ma ani
   * jednej chmury z danymi.
   */
  enoughForTrendOk: boolean | null;
  /**
   * `false` = w którejś chmurze wariancja `x` jest zerowa, czyli wszystkie
   * punkty stoją w jednej kolumnie i REGRESJA NIE ISTNIEJE (mianownik
   * `sxx` jest zerem). Model wtedy nie rysuje prostej pionowej i nie
   * podstawia zera - MILCZY. `null` = za mało par, żeby pytać o wariancję.
   */
  xVarianceOk: boolean | null;
  /**
   * `false` = któryś policzony trend ma R2 poniżej progu, czyli linia
   * niczego nie pokazuje, a wygląda jak twierdzenie. `null` = nie ma ani
   * jednego trendu albo żadne R2 nie jest określone.
   */
  trendMeaningfulOk: boolean | null;
  /**
   * `false` = odcinek trendu wychodzi poza zakres obserwacji `x`, czyli
   * wykres ekstrapoluje. SAMOSPRAWDZENIE: końce odcinka są porównywane
   * z zakresem policzonym z punktów, a nie przyjmowane na słowo od funkcji,
   * która je ustawiła. `null` = nie ma ani jednego trendu.
   */
  trendWithinDataOk: boolean | null;
  /**
   * `false` = któryś punkt leży poza zwróconą domeną, więc render przyciąłby
   * go krawędzią rysunku. SAMOSPRAWDZENIE domeny. `null` = brak punktów.
   */
  pointsInDomainOk: boolean | null;
  /**
   * `false` = `x` jest numerem wiersza (`xSource: "index"`), a nie drugą
   * zmienną. Wykres punktowy odpowiada na pytanie o ZALEŻNOŚĆ dwóch
   * zmiennych; z osią X zrobioną z numeracji wierszy odpowiada na pytanie,
   * którego nikt nie zadał. `null` = nie ma czego rysować.
   */
  xIsSecondVariableOk: boolean | null;
  /** Udział punktów, na których leży inny punkt, 0..1. */
  overplottedShare: number;
  /** Liczba rozdzielnych plamek na rysunku - tyle punktów czytelnik ZOBACZY. */
  distinctPositions: number;
  /** `false` = zasłanianie powyżej `SCATTER_OVERPLOT_SHARE`. `null` = brak punktów. */
  overplotOk: boolean | null;
  /**
   * Czy zadeklarowane w konfiguracji `sampleSize` zgadza się z liczbą par
   * w każdej niepustej chmurze. Realny defekt: podpis mówi "n = 300", bo tyle
   * ankiet zebrano, a w bloku jest 40 wierszy, bo ktoś wkleił próbkę - wtedy
   * wykres i podpis mówią o dwóch różnych badaniach. `null` = autor nie podał
   * albo nie ma ani jednej niepustej chmury.
   */
  declaredSampleSizeOk: boolean | null;
  /**
   * Czy zero mieści się w zakresie danych na każdej osi. NIE JEST TO DEFEKT:
   * punktowy koduje położeniem, więc sekcja 8 zera nie wymaga - wymaga
   * OZNACZENIA ucięcia. `false` znaczy więc "napisz przy tej osi, że nie
   * zaczyna się od zera", a nie "napraw skalę".
   */
  zeroInDomain: { x: boolean; y: boolean };
}

export interface ScatterModel {
  /** Chmury w kolejności serii wejściowych. */
  clouds: ScatterCloud[];
  /**
   * Wszystkie punkty wszystkich chmur w kolejności rysowania - gotowa
   * warstwa trafień. Osobne pole, bo strefa trafienia szuka NAJBLIŻSZEGO
   * punktu w dwóch wymiarach (nie bisekcją po X, jak linia), a szukanie po
   * chmurach osobno dawałoby najbliższy punkt każdej z nich, czyli kilka
   * tooltipów na jedno kliknięcie.
   */
  points: ScatterPoint[];
  /** Liczba kompletnych par we wszystkich chmurach. */
  n: number;
  xSource: ScatterXSource;
  /** Nazwa zmiennej X, gdy model ją zna (tryb `series` albo `opts.xName`). */
  xName: string;
  /**
   * Zakresy obu osi w jednostkach danych. Render dociąga je do ładnych
   * podziałek (`niceScale`) i sam zamienia na piksele - model nie zna ani
   * szerokości rysunku, ani marginesów.
   */
  domain: { x: { min: number; max: number }; y: { min: number; max: number } };
  honesty: ScatterHonesty;
  regression: RegressionMethod;
  /**
   * ZAWSZE `false`. Punktów nie wolno łączyć linią - to jedyny zakaz
   * z kolumny "Czego unikać" dla tego rodzaju, a pole jest tu, żeby zakaz
   * dał się przeczytać maszynowo i przetestować, a nie tylko przeoczyć
   * w nagłówku pliku.
   */
  mayConnectPoints: false;
}

export interface ScatterInput {
  /** Etykiety wierszy. W trybie `categories` są jednocześnie wartościami X. */
  categories: readonly string[];
  series: readonly ChartSeries[];
  /** `ChartConfig.sampleSize` - deklaracja autora, `null` gdy nie podał. */
  sampleSize?: number | null;
}

export interface ScatterOptions {
  /**
   * PROPONOWANE ROZSZERZENIE KONFIGURACJI: jawna, ciągła oś X.
   *
   * Obecny `ChartConfig` nie ma pola na drugą zmienną - ma `categories`
   * (napisy) i `series[].values` (liczby), bo wszystkie dotychczasowe rodzaje
   * mają oś kategorialną. Minimalne rozszerzenie to JEDNO pole
   * `xValues: (number | null)[] | null` obok `categories`, pozycyjnie z nimi
   * zgodne, gdzie `null` znaczy brak współrzędnej. Nic więcej nie jest
   * potrzebne: nazwa zmiennej X mieści się w istniejącym `unit`/`title`
   * albo w tym samym polu co nazwa serii.
   *
   * DOPÓKI TEGO POLA NIE MA, model buduje się z obecnego kształtu - patrz
   * `ScatterXSource`. Żadna z tych dróg nie wymyśla kodowania: albo `x` jest
   * w danych (etykiety liczbowe, pierwsza seria), albo model mówi wprost, że
   * go nie ma (`xSource: "index"` plus `xIsSecondVariableOk: false`).
   */
  xValues?: readonly (number | null)[] | null;
  /** Nazwa zmiennej X do podpisu osi i do tabeli. */
  xName?: string;
  /**
   * Wymuszenie źródła X. `"auto"` (domyślnie) idzie kolejnością z
   * `ScatterXSource`. Wymuszenie jest potrzebne, bo kolejność automatyczna
   * rozstrzyga ambiwalencję ("liczbowe etykiety to zmienna X"), a autor,
   * który chce inaczej, musi mieć to gdzie powiedzieć - inaczej jedynym
   * sposobem byłoby przerobienie danych.
   */
  xSource?: "auto" | ScatterXSource;
  /** Tolerancja zasłaniania, względna. Domyślnie `SCATTER_OVERPLOT_TOLERANCE`. */
  overplotTolerance?: number;
}

/* -------------------------------------------------------------------------- */
/*  Prymitywy odporne na dane z bazy                                          */
/* -------------------------------------------------------------------------- */

/**
 * Ostatnia zapora przed NaN i nieskończonością w polu modelu.
 *
 * Nie zastępuje osłon przy dzieleniu - te są w miejscach, gdzie mianownik
 * może być zerem, i tam odpowiedzią jest `null` ("nie ma czego pokazać"),
 * a nie podstawione zero. Ta funkcja jest bramką na wyjściu: treść bloku
 * przychodzi z bazy i może być z wersji edytora, której ten kod nie zna,
 * a jedno `NaN` w polu modelu wychodzi na stronie jako napis "NaN" - bo
 * `Intl.NumberFormat.format(NaN)` zwraca literalny napis "NaN", którego
 * bramka `src/components/blocks/__tests__/blockMatrix.test.tsx` szuka
 * w `textContent`.
 */
function fin(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

/** Liczba albo `null`. Jedno miejsce, w którym `Infinity` i `NaN` z bazy giną. */
function liczba(value: number | null | undefined): number | null {
  return value === null || value === undefined || !Number.isFinite(value) ? null : value;
}

/** Czy mianownik wolno użyć: skończony i dodatni. */
function mianownikOk(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * Kształt liczby dopuszczalny w etykiecie liczbowej. REGEX, a nie samo
 * `Number()`, bo `Number()` przyjmuje zapisy, które w kolumnie etykiet nie są
 * liczbami: "0x10" daje 16, "Infinity" daje nieskończoność, a puste i samo
 * spacje dają zero. Etykieta "0x10" zamieniona na 16 to wartość, której autor
 * nie wpisał, czyli wymyślona współrzędna.
 */
const KSZTALT_LICZBY = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

/**
 * Etykieta na liczbę, TĄ SAMĄ REGUŁĄ, którą czyta tekstowy format widgetu
 * (`parseNumber` w `csv.ts`): białe znaki lecą, pierwszy przecinek staje się
 * kropką dziesiętną. Wspólna reguła jest tu warunkiem, nie estetyką - gdyby
 * model czytał "1,5" inaczej niż textarea, ten sam arkusz dawałby dwa różne
 * wykresy w zależności od drogi, którą trafił do bloku.
 */
function etykietaNaLiczbe(raw: string): number | null {
  const tekst = raw.replace(/\s/g, "").replace(",", ".");
  if (tekst === "" || !KSZTALT_LICZBY.test(tekst)) return null;
  const v = Number(tekst);
  return Number.isFinite(v) ? v : null;
}

/**
 * Etykiety jako ciągła oś X, albo `null`, gdy nią nie są.
 *
 * WSZYSTKO ALBO NIC, z jednym wyjątkiem: etykieta PUSTA jest brakiem
 * współrzędnej (para niekompletna), a etykieta nieliczbowa dyskwalifikuje
 * CAŁĄ kolumnę. Ciche pominięcie nieliczbowych etykiet byłoby najgorszym
 * z wariantów: arkusz z wierszem podsumowania ("Razem") straciłby jeden
 * punkt, a pozostałe zostałyby na swoich miejscach, więc nic nie wyglądałoby
 * na błąd.
 *
 * DWIE LICZBY TO MINIMUM. Jedna liczbowa etykieta jest nieodróżnialna od
 * nazwy kategorii, która przypadkiem jest liczbą ("2024"), a z jednej
 * pozycji nie da się zrobić osi ciągłej - nie ma czym zmierzyć odstępu.
 */
function kategorieJakoOsX(categories: readonly string[]): (number | null)[] | null {
  const out: (number | null)[] = [];
  let ile = 0;
  for (const raw of categories) {
    const tekst = typeof raw === "string" ? raw : "";
    if (tekst.trim() === "") {
      out.push(null);
      continue;
    }
    const v = etykietaNaLiczbe(tekst);
    if (v === null) return null;
    out.push(v);
    ile++;
  }
  return ile >= 2 ? out : null;
}

/* -------------------------------------------------------------------------- */
/*  Regresja                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Regresja najmniejszych kwadratów na gotowych parach.
 *
 * DWA PRZEBIEGI, NIE JEDEN, i to nie jest ostrożność akademicka. Wzór
 * jednoprzebiegowy (`n * Sxy - Sx * Sy`) na danych oddalonych od zera odejmuje
 * dwie prawie równe, duże liczby: dla `x` rzędu 1e6 i rozproszenia rzędu
 * jedności traci prawie całą precyzję nachylenia, a przy wartościach rzędu
 * 1e200 sumy kwadratów WYCHODZĄ Z PODWÓJNEJ PRECYZJI i nachylenie wychodzi
 * jako NaN. Wersja z odjętą średnią liczy sumy na wartościach wyśrodkowanych,
 * więc nie odejmuje wielkich liczb od siebie.
 *
 * `null` GDY REGRESJI NIE MA, w trzech przypadkach i każdy jest prawdziwym
 * brakiem, nie awarią: mniej niż `SCATTER_TREND_MIN_N` par, zerowa (albo
 * nieskończona po przepełnieniu) wariancja `x` oraz nachylenie lub wyraz
 * wolny, które wychodzą poza podwójną precyzję. Model wtedy milczy - prosta
 * pionowa nie jest funkcją `y(x)`, a podstawienie zerowego nachylenia
 * twierdziłoby, że `y` nie zależy od `x`, czego dane nie mówią. Trzeci
 * przypadek jest tym samym zdaniem o niezapisywalnym wyniku: nachylenie 1e310
 * nie jest "nachyleniem zerowym", tylko nachyleniem, którego nie da się podać.
 */
export function leastSquaresTrend(points: readonly ScatterPoint[]): ScatterTrend | null {
  const n = points.length;
  if (n < SCATTER_TREND_MIN_N) return null;

  let sumX = 0;
  let sumY = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
  }
  const sredniaX = sumX / n;
  const sredniaY = sumY / n;
  if (!Number.isFinite(sredniaX) || !Number.isFinite(sredniaY)) return null;

  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    const dx = p.x - sredniaX;
    const dy = p.y - sredniaY;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
  }

  // OSŁONA MIANOWNIKA, obowiązkowa: `sxx` jest zerem, gdy wszystkie `x` są
  // równe (kolumna punktów), i wtedy nachylenie byłoby dzieleniem przez zero,
  // czyli Infinity albo NaN. Nieskończone `sxx` (przepełnienie na danych
  // rzędu 1e200) traktujemy identycznie: nie da się z niego policzyć liczby,
  // której czytelnik mógłby zaufać.
  if (!mianownikOk(sxx)) return null;

  // NACHYLENIE I WYRAZ WOLNY MUSZĄ WYJŚĆ SKOŃCZONE, inaczej TRENDU NIE MA -
  // i to jest ta sama decyzja, którą podjęto wierszem wyżej dla `sxx`, tylko
  // zastosowana do wyniku, a nie do mianownika. `fin(sxy / sxx)` cofało
  // przepełniony iloraz do ZERA, czyli podstawiało prostą poziomą, która
  // twierdzi "y nie zależy od x" - dokładnie o dane rosnące monotonicznie.
  // Kontrprzykłady, oba policzone: dla x = [-1e-160, 0, 1e-160],
  // y = [-1e150, 0, 1e150] (chmura IDEALNIE WSPÓŁLINIOWA, nachylenie 1e310
  // jest niezapisywalne) wychodziło `slope: 0` przy `r2: 1` - podpis
  // "R2 = 100%" nad linią poziomą, czyli dwa wykluczające się twierdzenia
  // naraz. Dla x = [1.999, 2, 2.001], y = [-1e305, 0, 1e305] przepełniał się
  // z kolei `slope * sredniaX` i osłona podstawiała wyraz wolny 0, przez co
  // oba końce odcinka lądowały na `y = 0`. `liczba`, nie `fin`, bo nachylenie
  // i wyraz wolny są ORZECZENIEM o zależności, a nie współrzędną rysunku.
  const slope = liczba(sxy / sxx);
  if (slope === null) return null;
  const intercept = liczba(sredniaY - slope * sredniaX);
  if (intercept === null) return null;

  // R2 NIEOKREŚLONE PRZY ZEROWEJ WARIANCJI `y`, i to jest rozstrzygnięcie,
  // nie zaniechanie. Wszystkie obserwacje na jednej wysokości znaczą, że nie
  // ma zmienności, którą prosta miałaby wyjaśnić: iloraz wychodzi 0/0.
  // Podstawienie jedynki ("prosta wyjaśnia wszystko") byłoby najgorszą
  // odpowiedzią, bo chmura płaska jak stół dostawałaby R2 = 1,00 w podpisie.
  //
  // ILOCZYNU MIANOWNIKÓW TU NIE MA i to jest cała poprawka tego wiersza.
  // `sxy / Math.sqrt(sxx * syy)` przepełniało się na SAMYM ILOCZYNIE
  // `sxx * syy`, choć każdy czynnik z osobna był skończony i sprawdzony przez
  // `mianownikOk` - a `mianownikOk` sprawdza je OSOBNO, nie ich iloczyn.
  // Skutek nie wyglądał na awarię: `Math.sqrt(Infinity)` to `Infinity`,
  // a dzielenie liczby skończonej przez nieskończoność daje ZERO, NIE `NaN`,
  // więc osłona nie miała czego złapać. Kontrprzykład: dla
  // x = y = [-2e100, -1e100, 0, 1e100, 2e100] - chmury IDEALNIE
  // WSPÓŁLINIOWEJ - wychodziło `{ slope: 1, r2: 0, meaningful: false }`,
  // czyli render (zgodnie z własną, poprawną regułą) chował odcinek i pisał,
  // że linia niczego nie wyjaśnia. Dzielenie po kolei przez każdy pierwiastek
  // osobno nie ma czym przepełnić: z nierówności Schwarza
  // |sxy| <= sqrt(sxx) * sqrt(syy), więc pierwszy iloraz jest co do modułu
  // nie większy niż `Math.sqrt(syy)`, a drugi nie większy niż jeden.
  //
  // `liczba`, nie `fin`: współczynnik korelacji jest ORZECZENIEM o danych,
  // więc odpowiedzią na niepoliczalność jest milczenie. Zero wygląda
  // dokładnie tak samo wiarygodnie jak korelacja policzona z danych - i to
  // właśnie podstawione zero było wyżej opisanym defektem.
  const r = mianownikOk(syy) ? liczba(sxy / Math.sqrt(sxx) / Math.sqrt(syy)) : null;
  // Zaciśnięcie do [-1, 1] po zaokrągleniach podwójnej precyzji: bez tego
  // R2 wychodziło 1,0000000000000002, a "R2 = 100,00%" z nadmiarem jest
  // liczbą, której nie da się obronić przed czytelnikiem z arkuszem.
  const rClamped = r === null ? null : Math.min(1, Math.max(-1, r));
  const r2 = rClamped === null ? null : fin(rClamped * rClamped);

  const from = fin(minX);
  const to = fin(maxX);
  return {
    slope,
    intercept,
    r2,
    r: rClamped,
    n,
    // KOŃCE ODCINKA SĄ OBSERWACJAMI, nie krawędziami rysunku. Prosta
    // przedłużona do brzegu obszaru kreślenia twierdzi o obszarze, w którym
    // nie ma ani jednego pomiaru, a wygląda dokładnie tak samo jak część
    // opisująca dane - czytelnik nie ma czym tych dwóch odcinków odróżnić.
    from: { x: from, y: fin(intercept + slope * from) },
    to: { x: to, y: fin(intercept + slope * to) },
    meaningful: r2 === null ? null : r2 >= SCATTER_R2_MEANINGLESS,
  };
}

/**
 * Wartość trendu w punkcie `x` albo `null` POZA ZAKRESEM OBSERWACJI.
 *
 * Odmowa jest tu funkcją, a nie komentarzem, bo ekstrapolacja jest defektem,
 * który powstaje przez wygodę: render potrzebuje `y` na krawędzi rysunku, wzór
 * prostej chętnie je podaje i nikt nie zauważy, że ostatnia obserwacja
 * skończyła się w dwóch trzecich osi. Skoro jedyna droga do wartości trendu
 * przechodzi tędy, to render, który chce ekstrapolować, musi to zrobić WPROST.
 */
export function scatterTrendAt(trend: ScatterTrend | null, x: number): number | null {
  if (trend === null || !Number.isFinite(x)) return null;
  if (x < trend.from.x || x > trend.to.x) return null;
  const y = trend.intercept + trend.slope * x;
  return Number.isFinite(y) ? y : null;
}

/* -------------------------------------------------------------------------- */
/*  Model                                                                     */
/* -------------------------------------------------------------------------- */

/** Rozstrzygnięcie źródła X - cała degradacja obecnego kształtu w jednym miejscu. */
function ustalZrodloX(
  input: ScatterInput,
  opts: ScatterOptions,
): { source: ScatterXSource; xs: (number | null)[]; xName: string; yIndeksy: number[] } {
  const wiersze = liczbaWierszy(input);
  const jawne = opts.xValues ? opts.xValues.map((v) => liczba(v)) : null;
  const zJawnych = jawne !== null && jawne.some((v) => v !== null);
  const zKategorii = kategorieJakoOsX(input.categories);
  const wszystkieSerie = input.series.map((_, i) => i);
  const zadane = opts.xSource ?? "auto";

  const pusty = { source: "none" as ScatterXSource, xs: [], xName: "", yIndeksy: [] };
  if (input.series.length === 0 || wiersze === 0) return pusty;

  const jawnyTryb =
    zadane === "explicit" && zJawnych
      ? "explicit"
      : zadane === "categories" && zKategorii !== null
        ? "categories"
        : zadane === "series" && input.series.length >= 2
          ? "series"
          : zadane === "index"
            ? "index"
            : null;

  const tryb: ScatterXSource =
    jawnyTryb ??
    (zJawnych
      ? "explicit"
      : zKategorii !== null
        ? "categories"
        : input.series.length >= 2
          ? "series"
          : "index");

  if (tryb === "explicit" && jawne !== null) {
    return { source: tryb, xs: jawne, xName: opts.xName ?? "", yIndeksy: wszystkieSerie };
  }
  if (tryb === "categories" && zKategorii !== null) {
    return { source: tryb, xs: zKategorii, xName: opts.xName ?? "", yIndeksy: wszystkieSerie };
  }
  if (tryb === "series" && input.series.length >= 2) {
    // X TO SERIA PIERWSZA POZYCYJNIE, a nie pierwsza z danymi. Pozycja jest
    // umową ("pierwsza kolumna liczb to X"), więc przeskoczenie serii pustej
    // po cichu zmieniłoby, KTÓRA zmienna jest na osi poziomej - i wykres
    // pokazałby zależność między inną parą kolumn, niż autor opisał
    // w podpisie.
    const os = input.series[0];
    return {
      source: tryb,
      xs: os.values.map((v) => liczba(v)),
      xName: opts.xName ?? os.name,
      yIndeksy: input.series.map((_, i) => i).slice(1),
    };
  }
  // DEGRADACJA: `x` z numeru wiersza. Numeracja od jedynki, nie od zera, bo
  // jest etykietą wiersza arkusza, a nie indeksem tablicy.
  return {
    source: "index",
    xs: Array.from({ length: wiersze }, (_, i) => i + 1),
    xName: opts.xName ?? "",
    yIndeksy: wszystkieSerie,
  };
}

/** Ile wierszy danych ma blok - najdłuższa z kolumn, także gdy są nierówne. */
function liczbaWierszy(input: ScatterInput): number {
  let n = input.categories.length;
  for (const s of input.series) if (s.values.length > n) n = s.values.length;
  return n;
}

/**
 * Klucz komórki siatki zasłaniania. Tolerancja niedodatnia (domena o zerowej
 * rozpiętości, wszystkie punkty w jednym miejscu) znaczy, że siatki nie ma
 * i porównujemy wartości dokładnie - bez tej gałęzi dzielenie przez zero
 * dałoby Infinity, wszystkie klucze byłyby równe i model twierdziłby, że
 * KAŻDY punkt kogoś zasłania.
 */
function kluczKomorki(v: number, tol: number): string {
  if (!mianownikOk(tol)) return String(v);
  return String(fin(Math.round(v / tol)));
}

/**
 * Model wykresu punktowego z tego, co silnik ma: etykiet wierszy i serii.
 *
 * Funkcja NIGDY nie rzuca i nigdy nie zwraca NaN ani nieskończoności, bo
 * treść bloku przychodzi z bazy i może być z wersji edytora, której ten kod
 * nie zna: pusta seria, sama luka, jedna kategoria, jedna para, wszystkie
 * `x` równe, wartości ujemne, liczby rzędu 1e300.
 */
export function scatterModel(input: ScatterInput, opts: ScatterOptions = {}): ScatterModel {
  const { source, xs, xName, yIndeksy } = ustalZrodloX(input, opts);
  const wiersze = liczbaWierszy(input);
  const etykieta = (i: number): string => {
    const raw = input.categories[i];
    return typeof raw === "string" ? raw : "";
  };

  const clouds: ScatterCloud[] = [];
  const points: ScatterPoint[] = [];

  for (const si of yIndeksy) {
    const seria: ChartSeries | undefined = input.series[si];
    if (!seria) continue;
    const cloudPoints: ScatterPoint[] = [];
    const droppedRows: ScatterDroppedRow[] = [];
    const dropped: ScatterDropped = { missingX: 0, missingY: 0, emptyRows: 0 };
    let xMin = Number.POSITIVE_INFINITY;
    let xMax = Number.NEGATIVE_INFINITY;
    let yMin = Number.POSITIVE_INFINITY;
    let yMax = Number.NEGATIVE_INFINITY;

    for (let i = 0; i < wiersze; i++) {
      const x = liczba(xs[i]);
      const y = liczba(seria.values[i]);
      // TRZY OSOBNE LICZNIKI, nie jeden. Brak obu współrzędnych jest brakiem
      // obserwacji (autor jeszcze nie wpisał wiersza); brak jednej jest
      // ODRZUCONĄ PARĄ, czyli obserwacją, która była, a na wykresie jej nie
      // ma. Zlanie tych zdarzeń kazałoby renderowi pisać o odrzuceniach
      // w bloku, w którym nikt nic nie odrzucił.
      if (x === null && y === null) {
        dropped.emptyRows++;
        continue;
      }
      if (x === null) {
        dropped.missingX++;
        droppedRows.push({ index: i, label: etykieta(i), x: null, y });
        continue;
      }
      if (y === null) {
        dropped.missingY++;
        droppedRows.push({ index: i, label: etykieta(i), x, y: null });
        continue;
      }
      if (x < xMin) xMin = x;
      if (x > xMax) xMax = x;
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
      cloudPoints.push({
        index: i,
        x,
        y,
        label: etykieta(i),
        seriesIndex: si,
        colorSlot: liczba(seria.colorSlot) ?? si + 1,
        // Zasłanianie liczymy dopiero, gdy znamy CAŁĄ domenę, bo tolerancja
        // jest jej częścią - tu stawiamy wartość domyślną.
        overplotted: false,
      });
    }

    const n = cloudPoints.length;
    clouds.push({
      seriesIndex: si,
      name: seria.name,
      colorSlot: liczba(seria.colorSlot) ?? si + 1,
      points: cloudPoints,
      n,
      xRange: n > 0 ? { min: fin(xMin), max: fin(xMax) } : null,
      yRange: n > 0 ? { min: fin(yMin), max: fin(yMax) } : null,
      dropped,
      droppedRows,
      trend: leastSquaresTrend(cloudPoints),
    });
    for (const p of cloudPoints) points.push(p);
  }

  /* --- Domena obu osi, liczona z PUNKTÓW, nie z surowych kolumn ---------- */
  let dxMin = Number.POSITIVE_INFINITY;
  let dxMax = Number.NEGATIVE_INFINITY;
  let dyMin = Number.POSITIVE_INFINITY;
  let dyMax = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    if (p.x < dxMin) dxMin = p.x;
    if (p.x > dxMax) dxMax = p.x;
    if (p.y < dyMin) dyMin = p.y;
    if (p.y > dyMax) dyMax = p.y;
  }
  // Brak punktów: [0, 1] na obu osiach, ta sama awaryjna domena, którą
  // przyjmuje `seriesExtent` w `scale.ts`. Nie [0, 0], bo rozpiętość zerowa
  // jest mianownikiem w każdym przeliczeniu na piksele u renderu.
  const domain =
    points.length > 0
      ? {
          x: { min: fin(dxMin), max: fin(dxMax) },
          y: { min: fin(dyMin), max: fin(dyMax) },
        }
      : { x: { min: 0, max: 1 }, y: { min: 0, max: 1 } };

  /* --- Zasłanianie, w jednostkach WZGLĘDNYCH ----------------------------- */
  const tolRel = liczba(opts.overplotTolerance ?? SCATTER_OVERPLOT_TOLERANCE) ?? 0;
  const tolX = Math.max(0, fin((domain.x.max - domain.x.min) * tolRel));
  const tolY = Math.max(0, fin((domain.y.max - domain.y.min) * tolRel));
  const komorki = new Map<string, number>();
  for (const p of points) {
    const klucz = `${kluczKomorki(p.x, tolX)}|${kluczKomorki(p.y, tolY)}`;
    komorki.set(klucz, (komorki.get(klucz) ?? 0) + 1);
  }
  for (const p of points) {
    const klucz = `${kluczKomorki(p.x, tolX)}|${kluczKomorki(p.y, tolY)}`;
    p.overplotted = (komorki.get(klucz) ?? 0) > 1;
  }
  const distinctPositions = komorki.size;
  const zaslonione = Math.max(0, points.length - distinctPositions);
  const overplottedShare = points.length > 0 ? fin(zaslonione / points.length) : 0;

  /* --- Sprawdzenia uczciwości -------------------------------------------- */
  const zDanymi = clouds.filter((c) => c.n > 0);
  const trendy = clouds.map((c) => c.trend).filter((t): t is ScatterTrend => t !== null);
  const droppedPairs = clouds.reduce((a, c) => a + c.dropped.missingX + c.dropped.missingY, 0);
  const emptyRows = clouds.reduce((a, c) => a + c.dropped.emptyRows, 0);

  // Wariancja `x` per chmura, liczona TU PONOWNIE, a nie odczytana z tego,
  // czy `leastSquaresTrend` zwróciła trend: trend jest `null` także przy n < 3,
  // więc wnioskowanie z niego mieszałoby dwa różne defekty w jeden komunikat.
  const wariancjaX = zDanymi.map((c) => {
    if (c.n < 2 || c.xRange === null) return null;
    return c.xRange.max > c.xRange.min;
  });
  const doOceny = wariancjaX.filter((v): v is boolean => v !== null);

  const zR2 = trendy.filter((t) => t.r2 !== null);
  const deklarowane = liczba(input.sampleSize ?? null);

  // SAMOSPRAWDZENIE DOMENY: każdy punkt musi się w niej mieścić. Przy
  // dzisiejszym kodzie wychodzi prawdziwe zawsze, bo domena jest z tych samych
  // punktów - i o to chodzi. Gdyby ktoś kiedyś policzył domenę z surowych
  // kolumn (razem z parami odrzuconymi) albo z pierwszej serii, to pole
  // zapali się, zanim czytelnik zobaczy punkt przycięty krawędzią rysunku.
  const pointsInDomainOk =
    points.length === 0
      ? null
      : points.every(
          (p) =>
            p.x >= domain.x.min &&
            p.x <= domain.x.max &&
            p.y >= domain.y.min &&
            p.y <= domain.y.max,
        );

  // SAMOSPRAWDZENIE EKSTRAPOLACJI: końce odcinka trendu porównane z zakresem
  // `x` policzonym z punktów tej chmury. To jest odpowiednik sprawdzenia
  // "wąs kończy się na obserwacji" ze skrzynki: nie pytamy, czy funkcja
  // ustawiła końce zgodnie z zamiarem, tylko czy leżą tam, gdzie są dane.
  const zTrendem = clouds.filter((c) => c.trend !== null);
  const trendWithinDataOk =
    zTrendem.length === 0
      ? null
      : zTrendem.every((c) => {
          const t = c.trend;
          if (t === null || c.xRange === null) return false;
          return t.from.x >= c.xRange.min && t.to.x <= c.xRange.max;
        });

  const honesty: ScatterHonesty = {
    droppedPairs,
    emptyRows,
    pairsCompleteOk: wiersze === 0 || clouds.length === 0 ? null : droppedPairs === 0,
    enoughForTrendOk:
      zDanymi.length === 0 ? null : zDanymi.every((c) => c.n >= SCATTER_TREND_MIN_N),
    xVarianceOk: doOceny.length === 0 ? null : doOceny.every((v) => v),
    trendMeaningfulOk: zR2.length === 0 ? null : zR2.every((t) => t.meaningful === true),
    trendWithinDataOk,
    pointsInDomainOk,
    xIsSecondVariableOk: source === "none" ? null : source !== "index",
    overplottedShare,
    distinctPositions,
    overplotOk: points.length === 0 ? null : overplottedShare <= SCATTER_OVERPLOT_SHARE,
    // Deklaracja dotyczy liczby obserwacji NA SERIĘ, więc porównujemy ją
    // z każdą niepustą chmurą osobno; jedna niezgodna wystarcza, żeby podpis
    // mówił o innym badaniu niż rysunek.
    declaredSampleSizeOk:
      deklarowane === null || zDanymi.length === 0
        ? null
        : zDanymi.every((c) => c.n === Math.floor(deklarowane)),
    zeroInDomain: {
      x: domain.x.min <= 0 && domain.x.max >= 0,
      y: domain.y.min <= 0 && domain.y.max >= 0,
    },
  };

  return {
    clouds,
    points,
    n: points.length,
    xSource: source,
    xName,
    domain,
    honesty,
    regression: REGRESSION_METHOD,
    mayConnectPoints: false,
  };
}

/**
 * Model z konfiguracji bloku, czyli z tego, co silnik już ma.
 *
 * Konfiguracja nie ma pola na ciągłą oś X (patrz `ScatterOptions.xValues`),
 * więc `x` bierze się z etykiet albo z pierwszej serii - a gdy nie ma ani
 * jednego, ani drugiego, model degraduje do numeru wiersza i MÓWI O TYM
 * (`xIsSecondVariableOk: false`), zamiast udawać, że pokazuje zależność.
 */
export function scatterModelFromConfig(
  config: ChartConfig,
  opts: ScatterOptions = {},
): ScatterModel {
  return scatterModel(
    {
      categories: config.categories,
      series: config.series,
      sampleSize: config.sampleSize,
    },
    opts,
  );
}

/**
 * Zakresy obu osi - domena dla renderu. OBIE OSIE SĄ CIĄGŁE i żadna nie musi
 * obejmować zera: punktowy koduje POŁOŻENIEM, a nie długością, więc ucięta oś
 * nie zniekształca proporcji (sekcja 8 wymaga wtedy nie zera, a oznaczenia
 * ucięcia - patrz `honesty.zeroInDomain`). Render dociąga to do ładnych
 * podziałek `niceScale` osobno dla każdej osi.
 */
export function scatterExtent(model: ScatterModel): {
  x: { min: number; max: number };
  y: { min: number; max: number };
} {
  return model.domain;
}

/* -------------------------------------------------------------------------- */
/*  Kiedy punktowy jest złą formą                                             */
/* -------------------------------------------------------------------------- */

/**
 * Przypadki, w których lepszą formą jest coś innego - wyłącznie takie, które
 * da się WYLICZYĆ z danych. Wzorem `pieFormAdvice` i `boxplotFormAdvice`
 * funkcja odpowiada tylko na pytanie o formę i nie zna konfiguracji.
 *
 *   * `tooFewPoints` - mniej par niż `SCATTER_TREND_MIN_N`. Dwie pary to
 *     cztery liczby: zdanie w tekście jest od nich dokładniejsze, a chmura
 *     dwóch plamek sugeruje rozkład, którego nie ma;
 *   * `noXVariance` - wszystkie `x` równe, więc chmura jest kolumną punktów.
 *     To nie jest zależność dwóch zmiennych, to rozkład JEDNEJ - a na to
 *     tabela doboru formy odpowiada histogramem, boxplotem albo beeswarmem;
 *   * `syntheticX` - `x` jest numerem wiersza. Wykres nie odpowiada wtedy na
 *     pytanie o zależność; brakującą zmienną trzeba dodać do danych albo
 *     wziąć rodzaj kategorialny (słupki poziome, posortowane);
 *   * `trendShowsNothing` - policzony trend ma R2 pod progiem. Linia jest
 *     wtedy kreską o dowolnym nachyleniu, którą czytelnik przeczyta jako
 *     wniosek - i lepiej jej nie rysować, niż tłumaczyć w podpisie;
 *   * `overplotted` - zbyt duży udział punktów zasłoniętych. Mapa ciepła albo
 *     hexbin pokazuje gęstość, którą chmura już zgubiła;
 *   * `lineBetter` - `x` rośnie wiersz po wierszu i nie powtarza się, czyli
 *     autor wpisał uporządkowany szereg. Pytanie "jak zmieniało się w czasie"
 *     ma w tabeli formy odpowiedź "liniowy". UWAGA: to NIE JEST zgoda na
 *     dorysowanie linii do chmury - to wskazanie, żeby zmienić RODZAJ, bo
 *     w liniowym kolejność punktów jest treścią danych, a tutaj nie jest.
 */
export type ScatterFormAdvice =
  | "tooFewPoints"
  | "noXVariance"
  | "syntheticX"
  | "trendShowsNothing"
  | "overplotted"
  | "lineBetter";

export function scatterFormAdvice(model: ScatterModel): ScatterFormAdvice[] {
  const advice: ScatterFormAdvice[] = [];
  const zDanymi = model.clouds.filter((c) => c.n > 0);
  if (zDanymi.length === 0) return advice;

  if (zDanymi.every((c) => c.n < SCATTER_TREND_MIN_N)) advice.push("tooFewPoints");
  if (model.honesty.xVarianceOk === false) advice.push("noXVariance");
  if (model.honesty.xIsSecondVariableOk === false) advice.push("syntheticX");
  if (model.honesty.trendMeaningfulOk === false) advice.push("trendShowsNothing");
  if (model.honesty.overplotOk === false) advice.push("overplotted");
  if (
    // Rosnąco i bez powtórzeń W KOLEJNOŚCI WIERSZY - punktów nie sortujemy,
    // więc to jest wypowiedź o tym, co autor wpisał, a nie o tym, co model
    // poukładał.
    zDanymi.every(
      (c) =>
        c.n >= SCATTER_SEQUENCE_MIN_N &&
        c.points.every((p, i) => i === 0 || p.x > c.points[i - 1].x),
    )
  ) {
    advice.push("lineBetter");
  }
  return advice;
}

/* -------------------------------------------------------------------------- */
/*  Alternatywa tekstowa                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Kolumny tabeli danych. KLUCZE, nie napisy - nagłówki tłumaczy render ze
 * słownika i18n, bo są niezależne od treści bloku (inaczej niż nazwy serii
 * i etykiety wierszy, które idą z arkusza autora).
 */
export const SCATTER_COLUMNS = ["label", "series", "x", "y"] as const;
export type ScatterColumnKey = (typeof SCATTER_COLUMNS)[number];

export interface ScatterTableRow {
  label: string;
  series: string;
  seriesIndex: number;
  /** `null` = brak współrzędnej, czyli powód, dla którego para nie jest na rysunku. */
  x: number | null;
  y: number | null;
  /** Para niekompletna - jest w danych, nie ma jej na wykresie. */
  dropped: boolean;
  /** Punkt dzieli plamkę z innym - do przypisu przy wierszu. */
  overplotted: boolean;
}

/** Podsumowanie trendu jednej chmury - nachylenie NIGDY nie jedzie bez R2 i n. */
export interface ScatterTableTrend {
  series: string;
  seriesIndex: number;
  n: number;
  slope: number | null;
  intercept: number | null;
  r2: number | null;
  r: number | null;
  /** Zakres, w którym trend wolno rysować i w którym wolno go czytać. */
  fromX: number | null;
  toX: number | null;
  meaningful: boolean | null;
}

export interface ScatterTable {
  columns: readonly ScatterColumnKey[];
  rows: ScatterTableRow[];
  /**
   * Trendy per seria. Tabela jest jedynym miejscem, w którym nachylenie
   * DOSTAJE dowód: R2 i n stoją w tym samym wierszu co `slope`, więc nie da
   * się przeczytać jednego bez drugiego.
   */
  trends: ScatterTableTrend[];
  /**
   * Parametry, bez których liczb w tabeli nie da się odtworzyć. Metoda
   * regresji jest UMOWĄ (najmniejsze kwadraty `y` po `x` dają inną prostą niż
   * `x` po `y`), więc musi być napisana pod tabelą - inaczej czytelnik
   * przeliczający dane u siebie dostanie inne nachylenie i będzie miał rację.
   */
  method: {
    regression: RegressionMethod;
    minN: number;
    r2Meaningless: number;
    droppedPairs: number;
    emptyRows: number;
    xSource: ScatterXSource;
    xName: string;
  };
}

/**
 * ALTERNATYWA TEKSTOWA: co ma pokazać tabela danych pod wykresem. Grafika
 * nigdy nie jest jedyną drogą do liczby - chmury punktów nie odczyta ekran
 * czytający, a z plamki na przecięciu dwóch osi nie da się odczytać pary
 * dokładniej niż "mniej więcej".
 *
 * TABELA WYPISUJE TAKŻE PARY ODRZUCONE, i to jest jej najważniejsza cecha:
 * na rysunku ich nie ma i nie może być (punkt bez `x` nie ma gdzie stanąć),
 * więc jedynym miejscem, w którym czytelnik dowie się o ich istnieniu, jest
 * tekst. Wiersz z jedną kolumną pustą mówi dokładnie to, co się stało:
 * obserwacja była, jednej współrzędnej brakuje.
 *
 * LICZY Z TEGO SAMEGO MODELU CO RYSUNEK, nie po raz drugi z surowych danych -
 * dwa liczenia to dwa źródła prawdy, a rozjazd między nimi jest defektem
 * samym w sobie.
 */
export function scatterTable(model: ScatterModel): ScatterTable {
  const rows: ScatterTableRow[] = [];
  for (const cloud of model.clouds) {
    for (const p of cloud.points) {
      rows.push({
        label: p.label,
        series: cloud.name,
        seriesIndex: cloud.seriesIndex,
        x: p.x,
        y: p.y,
        dropped: false,
        overplotted: p.overplotted,
      });
    }
    // Pary odrzucone NA KOŃCU chmury, nie wplecione między punkty. Wiersz
    // z pustą kolumną w środku tabeli czyta się jak błąd renderu; wiersze
    // zebrane na końcu z zaznaczonym `dropped` czytają się jak to, czym są -
    // lista obserwacji, których na rysunku nie ma.
    for (const d of cloud.droppedRows) {
      rows.push({
        label: d.label,
        series: cloud.name,
        seriesIndex: cloud.seriesIndex,
        x: d.x,
        y: d.y,
        dropped: true,
        overplotted: false,
      });
    }
  }
  return {
    columns: SCATTER_COLUMNS,
    rows,
    trends: model.clouds.map((c) => ({
      series: c.name,
      seriesIndex: c.seriesIndex,
      n: c.n,
      slope: c.trend?.slope ?? null,
      intercept: c.trend?.intercept ?? null,
      r2: c.trend?.r2 ?? null,
      r: c.trend?.r ?? null,
      fromX: c.trend?.from.x ?? null,
      toX: c.trend?.to.x ?? null,
      meaningful: c.trend?.meaningful ?? null,
    })),
    method: {
      regression: model.regression,
      minN: SCATTER_TREND_MIN_N,
      r2Meaningless: SCATTER_R2_MEANINGLESS,
      droppedPairs: model.honesty.droppedPairs,
      emptyRows: model.honesty.emptyRows,
      xSource: model.xSource,
      xName: model.xName,
    },
  };
}
