// Model small multiples (paneli) - jeden rysunek na podmiot, JEDNA os wartosci.
//
// PO CO TEN RODZAJ ISTNIEJE. Tabela doboru formy z sekcji 1 specyfikacji
// przypisuje small multiples DWÓM pytaniom analitycznym naraz, i to jest
// rzadkie:
//   * "Wiele podmiotów na wielu wskaźnikach" - w kolumnie "Czego unikać"
//     stoi przy nim jedno słowo: RADAR;
//   * "Kilka szeregów o różnej skali" - tu w kolumnie "Czego unikać" stoją
//     DWIE OSIE Y (alternatywą dopuszczoną obok paneli jest linia na indeksie
//     z bazą 100, i to nie jest przypadek - patrz `mode` niżej).
// Oba zakazy są w specyfikacji zakazami BEZ WYJĄTKÓW i oba mają tę samą
// przyczynę: wynik wizualny zależy tam od decyzji autora, a nie od danych.
// W radarze powierzchnia zależy od arbitralnej kolejności osi, więc ten sam
// podmiot wygląda dobrze albo źle w zależności od ustawienia. Przy dwóch
// osiach Y relacja między szeregami zależy od dobranych zakresów, czyli
// znowu od autora. Small multiples usuwają obie te dźwignie: każdy podmiot
// dostaje własny panel, wszystkie panele mają TĘ SAMĄ oś wartości, a to, co
// czytelnik porównuje, jest POZYCJĄ NA WSPÓLNEJ SKALI - kanałem najwyższym
// w hierarchii percepcyjnej Clevelanda i McGilla.
//
// DLATEGO NAJWAŻNIEJSZĄ DECYZJĄ TEGO MODELU JEST SKALA, NIE SIATKA. Siatka
// paneli jest arytmetyką (ile kolumn, ile wierszy); skala jest rozstrzygnięciem
// o tym, czy rysunek w ogóle mówi prawdę. Panele z OSOBNYMI osiami wartości
// wyglądają identycznie jak panele ze wspólną, a znaczą coś zupełnie innego:
// przy osobnych skalach dwa panele o tej samej wysokości linii mogą różnić
// się o trzy rzędy wielkości. Czytelnik tego nie widzi, bo panele wyglądają
// jak jeden rysunek pocięty na kawałki. To jest ten sam gatunek kłamstwa co
// dwie osie Y, tylko rozłożony na n paneli zamiast na dwa szeregi - i dlatego
// wspólna oś jest tu domyślna, a osobna jest DEFEKTEM, dopóki nie została
// jawnie zadeklarowana i opisana (`freeScaleDeclaredOk`).
//
// CZEGO TEMU RODZAJOWI NIE WOLNO, czyli co ten moduł wymusza po stronie
// danych, zamiast liczyć na czujność autora:
//   * NIE WOLNO dać panelom osobnych skal po cichu. Wspólna domena jest
//     domyślna, a przełączenie na osobne wymaga i żądania, i opisu; brak
//     opisu jest zgłaszany (`commonScaleOk`, `freeScaleDeclaredOk`);
//   * NIE WOLNO POMINĄĆ panelu bez danych. Pominięcie zmienia siatkę - po
//     usunięciu jednego panelu pozostałe przeskakują o jedno miejsce, więc
//     czytelnik, który zna zestaw podmiotów, nie zauważy, że jednego nie ma;
//     zauważy tylko, że siatka jest inna niż poprzednio. Panel pusty jest
//     informacją ("dla tego podmiotu nie ma danych"), a panel usunięty jest
//     jej brakiem. Model NIGDY nie usuwa panelu i zgłasza żądanie usunięcia
//     jako defekt (`emptyPanelsKeptOk`);
//   * NIE WOLNO brać kolejności paneli Z ARKUSZA. Kolejność jest w small
//     multiples nośnikiem informacji tak samo jak w posortowanych słupkach
//     poziomych: czytelnik czyta panele rzędami i pierwsze wrażenie bierze
//     z pierwszego rzędu. Kolejność z arkusza jest przypadkowa, więc to
//     wrażenie jest przypadkowe - a przy następnym wklejeniu danych
//     w innej kolejności ten sam zestaw opowiada inną historię. Model
//     porządkuje panele KLUCZEM Z DANYCH i zgłasza, gdy o porządek nie ma
//     na czym stanąć (`orderFromDataOk`);
//   * NIE WOLNO mieszać jednostek na jednej osi. Wspólna oś dla panelu
//     w procentach i panelu w mld EUR porównuje rzeczy nieporównywalne
//     dokładnie tak, jak to robią dwie osie Y. Gdy autor poda jednostki
//     per panel i te się różnią, model SCHODZI do skal osobnych (bo to
//     mniejsze zło) i zgłasza to (`sameUnitOk`);
//   * NIE WOLNO milczeć, gdy wspólna oś SPŁASZCZA panele. To jest odwrotna
//     pułapka niż osobne skale i dokładnie ta, dla której specyfikacja
//     wymienia obok paneli "liniowy na indeksie (baza = 100)": jeżeli jeden
//     podmiot jest o dwa rzędy wielkości większy od pozostałych, wspólna oś
//     jest uczciwa, ale bezużyteczna - dziewięć paneli to płaskie kreski,
//     a zmiany, po które czytelnik przyszedł, są niewidoczne. Uczciwą
//     odpowiedzią NIE jest wtedy rozpuszczenie skal (to by dopiero było
//     kłamstwo), a INDEKS BAZOWY: wszystkie panele wyrażone jako 100
//     w kategorii bazowej, czyli wspólna oś TEMPA zamiast wspólnej osi
//     poziomu. Model to wykrywa (`sharedScaleReadableOk`,
//     `indexBaseAdvised`) i umie policzyć (`mode: "index"`).
//
// REGUŁY OGÓLNE ZE SPECYFIKACJI, KTÓRE GO DOTYCZĄ:
//   * sekcja 2 - "maksymalnie 5-6 kolorów kategorialnych, powyżej grupuj albo
//     idź w small multiples". Ten rodzaj jest ODPOWIEDZIĄ na przepełniony
//     budżet koloru, więc sam koloru na kategorie nie wydaje: tożsamość
//     podmiotu niesie POZYCJA panelu i jego podpis, a wszystkie panele mają
//     domyślnie JEDEN slot palety. Kolor per panel jest tu redundantny,
//     a przy liczbie paneli większej niż zestaw slotów wręcz kłamie, bo
//     paleta się zawija i dwa panele dostają ten sam kolor, nie będąc
//     w żadnej relacji (`paletteWrapOk`);
//   * sekcja 3 - "Wariant solidny bierz tam, gdzie ani blade wnętrze, ani
//     gradient nic nie wnoszą: słupki węższe niż 24 px, SMALL MULTIPLES,
//     gęste panele". Model nie rysuje, ale niesie tę dyrektywę jako fakt
//     o gęstości (`grid`, `smallMultiplesFit`), bo o wariancie decyduje
//     rozmiar panelu, a rozmiar panelu wynika z siatki;
//   * sekcja 8 - "Domyślnie pokazuj cały dostępny szereg" i "Podaj n".
//     Model nie skraca ani nie przycina niczego (dane, których nie widać na
//     rysunku, są defektem - `inGridOk`) i liczy `n` jako liczbę realnych
//     obserwacji, którą porównuje z `sampleSize` z konfiguracji
//     (`declaredSampleOk`);
//   * sekcja 8 - "Oś Y słupków zawsze od zera". Gdy panele rysują wartość
//     DŁUGOŚCIĄ (słupki, pola), wspólna domena musi obejmować zero; model
//     wymusza to sam, a domenę podaną z zewnątrz i nieobejmującą zera
//     zgłasza (`zeroBaselineOk`);
//   * sekcja 9 - "silnik rysujący nie zawiera ani jednego zapisanego na
//     sztywno koloru". W tym pliku nie ma żadnego heksa i nie może być:
//     model oddaje SLOT palety, a nie kolor.
//
// JEDNOSTKI. Wartości są w jednostkach DANYCH i model ich nie skaluje do
// pikseli. Geometria SIATKI jest jednak istotą tego rodzaju (bez niej render
// musiałby wyliczyć ją sam, a wtedy dwa rendery policzyłyby dwie różne
// siatki z tych samych danych), więc jest policzona - w jednostkach
// WZGLĘDNYCH obszaru kreślenia: `x`, `y`, `w`, `h` panelu to ułamki, gdzie 0
// jest lewą albo górną krawędzią, a 1 prawą albo dolną. Render mnoży je przez
// swoje piksele. Tak samo bezwymiarowe są pozycje punktów: `t` to pozycja na
// osi kategorii (0..1 w panelu), a `v` to pozycja na osi wartości (0..1
// w domenie panelu, licząc od DOŁU, bo oś wartości rośnie w górę, a render
// odwraca ją sobie sam przy przeliczaniu na współrzędną SVG). Jedyne dwie
// liczby pikselowe w tym pliku (`SMALL_MULTIPLES_MIN_PANEL_W` i `_H`) są
// PROGAMI dla renderu, nie geometrią, i wchodzą do modelu wyłącznie przez
// `smallMultiplesFit`.
import { niceScale } from "../scale";
import { INDEX_BASE, baseUsable, indexAgainst } from "../stats";
import { MAX_SERIES } from "../types";
import type { ChartConfig } from "../types";

/**
 * Minimalna liczba paneli. Jeden panel nie jest small multiples, tylko
 * wykresem - i to wykresem, któremu siatka paneli odebrała miejsce na osie
 * i etykiety. Poniżej tego progu właściwą formą jest zwykły wykres liniowy
 * albo słupkowy.
 */
export const SMALL_MULTIPLES_MIN_PANELS = 2;

/**
 * Powyżej tylu paneli forma przestaje być wygodna, choć jeszcze działa.
 *
 * Dwanaście, bo tyle mieści siatka 4 na 3 - czyli taka, w której przy typowym
 * polu 640 na 320 px panel ma jeszcze 160 na 106 px i utrzymuje się nad
 * progiem `SMALL_MULTIPLES_MIN_PANEL_W` / `_H` z zapasem. Przy dwudziestu
 * czterech panelach ta sama powierzchnia daje 106 na 80 px, czyli panele
 * spadają do rozmiaru sparkline: kształt jeszcze widać, ale osi wartości już
 * się nie odczyta, a podpis panelu trzeba skrócić. Wtedy uczciwszą formą jest
 * TABELA ZE SPARKLINES, którą tabela doboru form wymienia obok small
 * multiples przy tym samym pytaniu - bo tam liczba stoi w kolumnie obok
 * kształtu, a nie zamiast niego.
 *
 * Próg jest DORADCZY (patrz `smallMultiplesFormAdvice`), nie przycinający:
 * model nie ma prawa wyrzucić podmiotu, którego autor policzył, bo panel
 * usunięty jest gorszy od panelu ciasnego.
 */
export const SMALL_MULTIPLES_MAX_COMFORT = 12;

/**
 * Minimalny rozmiar panelu w pikselach - poniżej tego rodzaj PRZESTAJE
 * DZIAŁAĆ, a nie tylko wygląda ciasno.
 *
 * SZEROKOŚĆ 96 px, i te 96 px składa się z trzech rzeczy, które muszą się
 * zmieścić naraz: obszaru kreślenia (podłoga `MIN_INNER_W` w `geometry.ts`
 * wynosi 40 px), podpisu panelu pisanego fontem osi (`FONT_AXIS` = 11 px daje
 * około 6 px na znak, więc siedmioznakowa nazwa podmiotu to ~42 px, a nazwy
 * krótsze niż siedem znaków są w praktyce rzadkością) oraz powietrza po obu
 * stronach ze skali odstępów (2 razy 8 px). 40 + 42 = 82, plus 16 px
 * powietrza daje 98, zaokrąglone w dół do siatki 4 px z `snapToGrid` - 96.
 * Poniżej tego albo podpis panelu jest ucięty (a wtedy czytelnik nie wie,
 * który podmiot widzi, czyli panel przestaje być panelem podmiotu), albo
 * obszar kreślenia schodzi pod podłogę i rysunek przestaje być rysunkiem.
 *
 * WYSOKOŚĆ 72 px: 40 px obszaru kreślenia (`MIN_INNER_H`), 16 px na wiersz
 * podpisu panelu, 8 px odstępu między podpisem a rysunkiem i 8 px na wiersz
 * etykiet kategorii pod ostatnim rzędem paneli. Suma to dokładnie 72 i jest
 * wielokrotnością 4 px.
 *
 * Poniżej progu render NIE ma cichego wariantu awaryjnego: właściwą reakcją
 * jest zejście do jednej kolumny paneli (wtedy szerokość rośnie na powrót),
 * a gdy i to nie wystarcza - do tabeli ze sparklines albo do samej tabeli
 * danych, którą ten model i tak zawsze wylicza (`smallMultiplesTable`).
 */
export const SMALL_MULTIPLES_MIN_PANEL_W = 96;
export const SMALL_MULTIPLES_MIN_PANEL_H = 72;

/**
 * Docelowy stosunek szerokości do wysokości JEDNEGO panelu.
 *
 * 1,6 nie jest estetyką. Panel small multiples niesie prawie zawsze szereg
 * w czasie, a kąt nachylenia linii jest w takim panelu głównym nośnikiem
 * treści; kąt zależy od proporcji pola, więc panel wysoki i wąski przesadza
 * ze zmianami, a niski i szeroki je gasi. Proporcja bliska złotej (1,6) jest
 * tym samym kompromisem, który stosuje się do pojedynczego wykresu czasowego,
 * i przede wszystkim jest TA SAMA dla wszystkich paneli - bo panele
 * o różnych proporcjach pokazywałyby ten sam wzrost pod różnym kątem, czyli
 * kodowałyby coś, czego w danych nie ma.
 */
export const SMALL_MULTIPLES_PANEL_ASPECT = 1.6;

/**
 * Domyślna proporcja CAŁEGO obszaru paneli (szerokość przez wysokość), gdy
 * wywołujący jej nie podał. Dwa, bo typowe pole wykresu w tym silniku to
 * około 640 na 320 px. Siatka policzona przy złej proporcji nie jest błędem
 * arytmetycznym, tylko marnuje miejsce (kolumny za wąskie albo wiersze za
 * niskie), dlatego render, który zna swoje piksele, powinien podać
 * `areaAspect` i przeliczyć siatkę na powrót.
 */
export const SMALL_MULTIPLES_DEFAULT_AREA_ASPECT = 2;

/**
 * Poniżej tego udziału wspólnej osi panel jest SPŁASZCZONY.
 *
 * Dziesięć procent, i wynika to z pikseli, nie z gustu: przy panelu
 * o wysokości 106 px (siatka 4 na 3 w polu 640 na 320) dziesięć procent osi
 * to około 10 px, czyli mniej niż podwójna grubość linii serii (2 px) plus
 * średnica kropki obserwacji (2,8 px z obwódką 1,6 px, więc realnie 6 px).
 * Zmiana, która na rysunku mieści się w grubości własnej linii, nie jest
 * zmianą widoczną - a czytelnik odczyta z takiego panelu "nic się nie
 * działo", co jest zdaniem o danych, którego dane nie potwierdzają.
 */
export const SMALL_MULTIPLES_FLATTENED_SHARE = 0.1;

/**
 * Baza indeksu. Sto, bo tak brzmi reguła z tabeli doboru form ("liniowy na
 * indeksie (baza = 100)") i tak czyta się indeks w każdym opracowaniu
 * statystycznym - odczyt "112" jako "o 12% więcej niż w bazie" jest wtedy
 * natychmiastowy i nie wymaga podpisu.
 *
 * NAZWA ZOSTAJE, LICZBA PRZYCHODZI Z `stats.ts`. Defekt, który przez to
 * znika, jest defektem rozjazdu: ta sama setka stała wcześniej osobno tutaj
 * i osobno w modelu indeksu bazowego, a zgodności obu pilnował KOMENTARZ
 * ("ta sama liczba stoi w modelu paneli"), czyli nic - dwa rodzaje wykresu
 * odpowiadające na to samo pytanie analityczne mogły rozjechać się linią
 * odniesienia, a czytelnik zobaczyłby oba w jednym opracowaniu. Teraz
 * pilnuje jej import. Alias zostaje, bo to jego nazwy używa render i przypis.
 */
export const SMALL_MULTIPLES_INDEX_BASE = INDEX_BASE;

/**
 * Docelowa liczba podziałek wspólnej osi wartości.
 *
 * Trzy, nie pięć jak w `valueTickTarget` dla pełnowymiarowego wykresu: panel
 * jest niski (podłoga to 40 px obszaru kreślenia), a pięć podziałek na 40 px
 * daje linie siatki co 10 px, czyli gęstość, przy której siatka przestaje być
 * "wyczuwalna, nie widoczna" i zaczyna konkurować z danymi. Trzy podziałki
 * (dół, środek, góra) wystarczają, bo dokładny odczyt idzie z tabeli danych,
 * a panel odpowiada na pytanie o KSZTAŁT i o pozycję wobec pozostałych paneli.
 */
export const SMALL_MULTIPLES_TARGET_TICKS = 3;

/** Znak braku wartości - ten sam, którym `format.ts` oznacza lukę. */
const BRAK_LICZBY = "-";

/**
 * Co jest panelem. Konfiguracja silnika ma dwa wymiary (serie i kategorie),
 * więc panel może powstać z każdego z nich - i oba odczyty odpowiadają na
 * inne pytanie z tabeli doboru form:
 *   * "series" - panel na SERIĘ, oś kategorii wspólna. To odczyt dla pytania
 *     "kilka szeregów o różnej skali": każdy szereg dostaje własny panel
 *     zamiast drugiej osi Y;
 *   * "category" - panel na KATEGORIĘ, oś zbudowana z nazw serii. To odczyt
 *     dla pytania "wiele podmiotów na wielu wskaźnikach", gdy w arkuszu
 *     podmioty stoją w kategoriach, a wskaźniki w seriach.
 * Transpozycja jest tu tanim rozstrzygnięciem układu arkusza, a nie nowym
 * modelem - dlatego jest opcją, a nie drugim rodzajem wykresu.
 */
export type SmallMultiplesPanelBy = "series" | "category";

/**
 * Czym jest oś wartości: POZIOMEM (jednostki danych) albo INDEKSEM (baza 100
 * w kategorii bazowej). Tryb indeksu jest jedyną uczciwą odpowiedzią na
 * panele o różnych rzędach wielkości - patrz nagłówek pliku.
 */
export type SmallMultiplesMode = "level" | "index";

/**
 * Czy panele dzielą jedną oś wartości. "shared" jest domyślne; "free" jest
 * defektem, dopóki nie zostało opisane (`freeScaleNote`).
 */
export type SmallMultiplesScaleMode = "shared" | "free";

/**
 * Czym panel koduje wartość. Wchodzi do modelu wyłącznie po to, żeby
 * rozstrzygnąć o zerze w domenie: znacznik kodujący DŁUGOŚĆ (słupek, pole)
 * wymaga osi od zera, bo ucięta oś wprost zniekształca proporcję długości;
 * znacznik kodujący POŁOŻENIE (linia) zera nie wymaga, ale ucięcie musi być
 * nazwane (sekcja 8).
 */
export type SmallMultiplesMark = "line" | "area" | "bar";

/**
 * Czym porządkujemy panele. Wszystkie warianty poza "input" są kluczem
 * Z DANYCH; "input" jest kolejnością arkusza i jest defektem - jest w tej
 * unii tylko dlatego, że autor może go świadomie zażądać (na przykład gdy
 * kolejność w arkuszu jest kolejnością chronologiczną albo urzędową),
 * a wtedy model to zgłasza, zamiast po cichu przestawiać panele.
 */
export type SmallMultiplesOrder = "mean" | "max" | "span" | "last" | "label" | "input";

/** Stan punktu. Dwa stany, nie jeden z wartością nullable - render musi mieć
 * jawną gałąź na lukę: linia się w luce PRZERYWA, a nie schodzi do zera. */
export type SmallMultiplesPointState = "value" | "gap";

export interface SmallMultiplesPoint {
  /** Indeks kategorii w konfiguracji - identyfikuje pozycję na wspólnej osi X. */
  category: number;
  label: string;
  /** Wartość w jednostkach DANYCH. `null` = luka, NIE zero. */
  value: number | null;
  state: SmallMultiplesPointState;
  /**
   * Pozycja na osi kategorii, 0..1 w panelu. Przy jednej kategorii 0,5, bo
   * jeden punkt nie ma lewej ani prawej krawędzi i postawiony na 0 wyglądałby
   * na początek szeregu, który został ucięty.
   */
  t: number;
  /**
   * Pozycja na osi wartości, 0..1 w domenie panelu, licząc OD DOŁU. `null`
   * przy luce - i to jest najważniejszy `null` w tym pliku, bo zero zamiast
   * niego postawiłoby lukę na dolnej krawędzi panelu, czyli w miejscu
   * prawdziwej wartości minimalnej.
   */
  v: number | null;
  /**
   * Wartość przeliczona na indeks (baza = `SMALL_MULTIPLES_INDEX_BASE`).
   * `null`, gdy panel nie ma użytecznej bazy, gdy w tym punkcie jest luka
   * albo gdy iloraz wobec bazy WYCHODZI POZA podwójną precyzję. Ten trzeci
   * przypadek jest osobny i jest tu przez `indexAgainst`: przepełnienie
   * przepuszczone przez osłonę wyświetlania wracało jako indeks 0, czyli
   * jako liczba wyglądająca na policzoną i mówiąca coś przeciwnego niż dane.
   * Liczona ZAWSZE, także w trybie "level", bo tabela danych pokazuje indeks
   * obok poziomu i wtedy czytelnik widzi, dlaczego panel wygląda płasko.
   */
  indexed: number | null;
  /**
   * Czy wartość została przycięta do domeny. Przycięcie znaczy, że punkt
   * leży na krawędzi panelu w miejscu, w którym danych nie ma - patrz
   * `inDomainOk`.
   */
  clamped: boolean;
  /** Etykieta liczbowa punktu. Przy luce znak braku. */
  text: string;
}

/** Domena osi wartości jednego panelu albo całej siatki. */
export interface SmallMultiplesDomain {
  min: number;
  max: number;
  /** `max - min`. Zawsze dodatnie (`niceScale` rozsuwa płaski szereg). */
  span: number;
  /** Podziałki - te same we wszystkich panelach, gdy skala jest wspólna. */
  ticks: number[];
  includesZero: boolean;
}

export interface SmallMultiplesPanel {
  /** Indeks w danych wejściowych - tożsamość panelu, niezależna od kolejności. */
  index: number;
  /** Pozycja w siatce po uporządkowaniu, 0 = pierwszy panel czytany rzędami. */
  position: number;
  /** Wiersz siatki, 0 na górze. */
  row: number;
  /** Kolumna siatki, 0 po lewej. */
  column: number;
  label: string;
  /**
   * Jednostka panelu albo `null`, gdy autor jej nie podał. Wymaga rozszerzenia
   * konfiguracji (patrz `SmallMultiplesInput`); jest tu, bo różne jednostki
   * są jedynym przypadkiem, w którym osobne skale są uzasadnione.
   */
  unit: string | null;
  /** Slot palety 1..MAX_SERIES. Domyślnie ten sam we wszystkich panelach. */
  colorSlot: number;
  points: SmallMultiplesPoint[];
  /** Liczba punktów Z WARTOŚCIĄ - to jest `n` panelu. */
  n: number;
  /** Luki w panelu. Nie zera. */
  gaps: number;
  /** Panel bez ani jednej wartości. Zostaje w siatce jako PUSTY. */
  empty: boolean;
  min: number | null;
  max: number | null;
  mean: number | null;
  /** `max - min` panelu; `null` gdy panel jest pusty. */
  span: number | null;
  /** Pierwsza i ostatnia wartość NIEPUSTA - do kolumny zmiany w tabeli. */
  first: number | null;
  last: number | null;
  /** `last - first`; `null` gdy panel ma mniej niż dwie wartości. */
  change: number | null;
  /**
   * Zmiana w procentach pierwszej wartości. `null` gdy pierwsza wartość jest
   * zerem albo panel ma mniej niż dwie wartości - procent od zera nie
   * istnieje, a podany jako "nieskończony wzrost" byłby dosłownie nieliczbą
   * na stronie.
   */
  changePct: number | null;
  /** Domena, w której panel jest rysowany. Przy skali wspólnej ta sama dla wszystkich. */
  domain: SmallMultiplesDomain;
  /**
   * Jaką część wspólnej osi zajmuje własna zmienność panelu, 0..1. `null` gdy
   * panel jest pusty albo gdy wspólna oś nie ma rozpiętości. To jest liczba,
   * z której bierze się rozstrzygnięcie o indeksie bazowym.
   */
  occupancy: number | null;
  /**
   * Czy panel jest spłaszczony przez wspólną oś, czyli czy jego zmiany
   * mieszczą się w grubości własnej linii - patrz
   * `SMALL_MULTIPLES_FLATTENED_SHARE`.
   */
  flattened: boolean;
  /** Wartość w kategorii bazowej indeksu. `null` gdy jej nie ma. */
  indexBase: number | null;
  /**
   * Czy panel da się zaindeksować. `false` przy bazie brakującej, zerowej
   * albo ujemnej: dzielenie przez zero daje nieliczbę, a dzielenie przez
   * liczbę ujemną ODWRACA kierunek (spadek wychodzi jako wzrost), więc oba
   * przypadki są wykluczone, a nie "obsłużone".
   */
  indexable: boolean;
  /** Lewa krawędź panelu, 0..1 obszaru siatki. */
  x: number;
  /** Górna krawędź panelu, 0..1 obszaru siatki. */
  y: number;
  /** Szerokość panelu jako ułamek obszaru siatki. */
  w: number;
  /** Wysokość panelu jako ułamek obszaru siatki. */
  h: number;
}

export interface SmallMultiplesGrid {
  columns: number;
  rows: number;
  /** Liczba komórek siatki - może być większa od liczby paneli (ostatni rząd). */
  cells: number;
  /** Ile paneli stoi w ostatnim, niepełnym rzędzie. Równe `columns`, gdy pełny. */
  lastRowPanels: number;
  /** Szerokość i wysokość komórki jako ułamek obszaru siatki. */
  cellWidth: number;
  cellHeight: number;
  /** Proporcja obszaru, z której siatka została policzona. */
  areaAspect: number;
  /** Proporcja jednej komórki, jaka z tej siatki wyszła (do porównania z celem). */
  cellAspect: number;
}

export interface SmallMultiplesScale {
  mode: SmallMultiplesMode;
  scaleMode: SmallMultiplesScaleMode;
  /** Czego autor zażądał - do porównania z tym, co model wybrał. */
  requestedScaleMode: SmallMultiplesScaleMode;
  /**
   * Wspólna domena. Przy skali osobnej NADAL policzona i zwrócona, bo jest
   * jedyną miarą tego, o ile panele się rozjeżdżają, i bo tabela danych
   * podaje ją w podpisie, żeby czytelnik wiedział, czego panele NIE dzielą.
   */
  shared: SmallMultiplesDomain;
  /** Czy domena wyszła z danych, a nie została podana z zewnątrz. */
  domainFromData: boolean;
  /**
   * Indeks kategorii bazowej indeksu. Rozstrzygnięty ZAWSZE (domyślnie
   * pierwsza kategoria), bo kolumna indeksu w tabeli danych istnieje także
   * w trybie poziomu; `null` tylko wtedy, gdy nie ma ani jednej kategorii.
   */
  indexBaseAt: number | null;
  /**
   * Iloraz największego i najmniejszego POZIOMU paneli (po wartościach
   * bezwzględnych średnich). `null` gdy nie da się policzyć. To druga, obok
   * `occupancy`, diagnoza rozjazdu skal - i ta czytelniejsza w podpisie:
   * "panele różnią się poziomem 340-krotnie" mówi więcej niż udział osi.
   */
  levelRatio: number | null;
}

/**
 * SPRAWDZENIA UCZCIWOŚCI. Konwencja repo, ta sama co w sumie kontrolnej
 * mostka i w sumie udziałów tarczy: `null` znaczy NIE MA CZEGO SPRAWDZAĆ,
 * więc model MILCZY, a nie zaświadcza, że jest dobrze; `false` znaczy defekt
 * wykryty arytmetycznie.
 */
export interface SmallMultiplesHonesty {
  /**
   * Czy panele dzielą jedną oś wartości. `false` = każdy panel ma własną
   * domenę, czyli porównanie między panelami jest fałszywe (dwie linie na tej
   * samej wysokości mogą się różnić o rzędy wielkości). `null` = mniej niż
   * dwa panele z danymi, więc nie ma czego porównywać.
   */
  commonScaleOk: boolean | null;
  /**
   * Czy skala osobna została ZADEKLAROWANA I OPISANA. `false` = panele mają
   * własne osie i nic o tym nie mówi, więc rysunek wygląda na porównywalny,
   * nie będąc. `true` = autor podał opis, który render ma obowiązek wypisać
   * pod wykresem. `null` = skala jest wspólna, więc nie ma czego deklarować.
   */
  freeScaleDeclaredOk: boolean | null;
  /**
   * Czy wspólna oś jest CZYTELNA, czyli czy nie spłaszcza wszystkich paneli
   * poza jednym. `false` = spłaszcza; wtedy właściwą odpowiedzią jest indeks
   * bazowy (`indexBaseAdvised`), a NIE rozpuszczenie skal. `null` = mniej niż
   * dwa panele mają po dwie wartości (spłaszczenia nie da się orzec z jednego
   * punktu) albo wspólna oś nie ma rozpiętości.
   */
  sharedScaleReadableOk: boolean | null;
  /**
   * Czy panele mierzą TO SAMO. `false` = jednostki paneli się różnią, więc
   * wspólna oś porównuje nieporównywalne; model schodzi wtedy do skal
   * osobnych i to jest jedyny przypadek, w którym osobne skale są
   * uzasadnione. `null` = autor nie podał jednostek per panel, więc nie ma
   * czego porównać (i model nie udaje, że sprawdził).
   */
  sameUnitOk: boolean | null;
  /**
   * Czy panele bez danych zostały w siatce. `false` = ktoś zażądał ich
   * usunięcia (`dropEmptyPanels`); model żądania NIE spełnia i zgłasza je,
   * bo pominięcie panelu zmienia siatkę i czytelnik traci podmiot. `null` =
   * nie ma pustych paneli, więc nie ma czego pomijać.
   */
  emptyPanelsKeptOk: boolean | null;
  /**
   * Czy kolejność paneli wynika z DANYCH. `false` = z arkusza: albo autor
   * zażądał kolejności wejściowej, albo klucz porządkujący jest we wszystkich
   * panelach identyczny i o kolejności zadecydował rozstrzygacz remisów.
   * `null` = mniej niż dwa panele z danymi.
   */
  orderFromDataOk: boolean | null;
  /**
   * Czy każda liczba z danych trafiła w panel. `false` = w serii są wartości
   * za ostatnią kategorią (albo w kategoriach za ostatnią serią), czyli
   * liczby, których nie ma ani na rysunku, ani w tabeli. `null` = w danych nie
   * ma ani jednej liczby.
   */
  inGridOk: boolean | null;
  /**
   * Czy wszystkie wartości mieszczą się w domenie. `false` = któraś została
   * przycięta do krawędzi panelu, czyli punkt leży tam, gdzie danych nie ma.
   * `null` = domena wyliczona z danych, więc z definicji je obejmuje.
   */
  inDomainOk: boolean | null;
  /**
   * Czy oś wartości obejmuje zero tam, gdzie MUSI. `false` = znacznik koduje
   * DŁUGOŚĆ (słupek, pole), a podana z zewnątrz domena zera nie obejmuje.
   * `null` = znacznik koduje POŁOŻENIE (linia), więc sekcja 8 zera nie wymaga
   * - ale ucięcie i tak trzeba zaznaczyć, i o tym mówi `axisTruncated`.
   */
  zeroBaselineOk: boolean | null;
  /**
   * Czy tryb indeksu ma na czym stanąć. `false` = któryś panel nie ma
   * użytecznej bazy (brak wartości, zero albo liczba ujemna w kategorii
   * bazowej), więc jego linii w indeksie NIE MA - a panel bez linii przy
   * pozostałych z liniami czyta się jako "brak zmian", nie jako "brak bazy".
   * `null` = tryb indeksu nie jest włączony.
   */
  indexBaseOk: boolean | null;
  /**
   * Czy w danych jest ROZPROSZENIE. `false` = żaden panel nie ma rozpiętości,
   * czyli wszystkie linie są płaskie i rysunek nie mówi nic, czego nie
   * powiedziałoby jedno zdanie. `null` = brak wartości.
   */
  spreadOk: boolean | null;
  /**
   * Czy `sampleSize` z konfiguracji zgadza się z liczbą obserwacji. Sekcja 8
   * każe podać `n` w podpisie; jeśli autor wpisał inne `n`, niż jest realnych
   * punktów, podpis kłamie o próbce. `null` = autor nie podał `n` albo nie ma
   * obserwacji.
   */
  declaredSampleOk: boolean | null;
  /**
   * Czy paleta się NIE zawija. `false` = panele mają różne slot,y a paneli
   * jest więcej niż slotów, więc dwa panele dostają ten sam kolor, nie będąc
   * w żadnej relacji - kolor przestaje być kluczem, a jednocześnie nadal
   * wygląda jak klucz. `null` = wszystkie panele mają jeden slot (wariant
   * domyślny), więc kolor niczego nie koduje i nie ma czego zawijać.
   */
  paletteWrapOk: boolean | null;
}

export interface SmallMultiplesModel {
  /** Panele w kolejności RYSOWANIA (rzędami, od lewej). */
  panels: SmallMultiplesPanel[];
  /** Etykiety wspólnej osi kategorii - te same dla każdego panelu. */
  categories: string[];
  grid: SmallMultiplesGrid;
  scale: SmallMultiplesScale;
  order: SmallMultiplesOrder;
  mark: SmallMultiplesMark;
  panelCount: number;
  /** Panele, które cokolwiek rysują. */
  drawablePanels: number;
  /** Panele bez ani jednej wartości. Zostają w siatce. */
  emptyPanels: number;
  /** Panele spłaszczone przez wspólną oś. */
  flattenedPanels: number;
  /** Wszystkie punkty z wartością - to jest `n` całego rysunku. */
  observations: number;
  /** Wszystkie luki. */
  gaps: number;
  /**
   * Liczby, które nie trafiły w siatkę: wartości za ostatnią kategorią.
   * Każda taka liczba jest w danych i NIE MA JEJ ani na rysunku, ani
   * w tabeli - patrz `inGridOk`.
   */
  valuesOutsideGrid: number;
  /**
   * Czy właściwą odpowiedzią jest INDEKS BAZOWY, a nie osobne skale. Wprost
   * z reguły z tabeli doboru form: przy szeregach o różnej skali dopuszczone
   * są dwa wyjścia - panele i linia na indeksie - a to pole mówi, kiedy
   * pierwsze przestaje wystarczać.
   */
  indexBaseAdvised: boolean;
  /**
   * Czy oś wartości nie obejmuje zera. Nie jest to defekt przy linii
   * (sekcja 8: "Dla liniowego zero nie jest wymagane, ale ucięcie zaznacz"),
   * ale jest FAKTEM, który render ma obowiązek wypisać.
   */
  axisTruncated: boolean;
  /** Czy wszystkie panele mają jeden slot palety - wariant domyślny. */
  slotsUniform: boolean;
  honesty: SmallMultiplesHonesty;
}

/**
 * Panel na wejściu. NEUTRALNY wobec kształtu konfiguracji, bo model musi dać
 * się zbudować i z obecnego `ChartConfig` (przez
 * `smallMultiplesModelFromConfig`), i z macierzy przyszłego edytora.
 *
 * ROZSZERZENIE, KTÓREGO TEN RODZAJ WYMAGA, jest tu dokładnie jedno i jest to
 * `unit`. `ChartConfig` ma JEDNĄ jednostkę na cały wykres, więc pytanie
 * "wiele podmiotów na wielu wskaźnikach" nie da się w nim wyrazić uczciwie:
 * gdy panele są wskaźnikami, każdy ma własną jednostkę, a wspólna oś dla
 * procentu i mld EUR jest tym samym błędem co dwie osie Y. Model degraduje
 * do sensownego przypadku (bez jednostek per panel milczy - `sameUnitOk`
 * zwraca `null`, a nie `true`), ale render nie ma szans wykryć kolizji
 * jednostek bez tego pola.
 */
export interface SmallMultiplesPanelInput {
  label: string;
  values: readonly (number | null)[];
  /** Slot palety; gdy pominięty, model nadaje wszystkim panelom `colorSlot`. */
  colorSlot?: number;
  /** Jednostka panelu. Wymaga rozszerzenia `ChartConfig` - patrz wyżej. */
  unit?: string | null;
}

export interface SmallMultiplesInput {
  /** Wspólna oś kategorii - ta sama dla każdego panelu. */
  categories: readonly string[];
  panels: readonly SmallMultiplesPanelInput[];
}

export interface SmallMultiplesOptions {
  /**
   * Czy panele dzielą oś. Domyślnie "shared". Żądanie "free" jest spełniane
   * (autor ma prawo do osobnych skal), ale bez `freeScaleNote` jest
   * zgłaszane jako defekt.
   */
  scaleMode?: SmallMultiplesScaleMode;
  /**
   * Opis, dlaczego panele mają osobne skale. Pusty napis znaczy BRAK opisu -
   * i wtedy `freeScaleDeclaredOk` jest `false`. Model nie sprawdza treści
   * opisu (tego nie da się sprawdzić arytmetycznie), tylko jego OBECNOŚĆ.
   */
  freeScaleNote?: string;
  /** Poziom albo indeks. Domyślnie poziom. */
  mode?: SmallMultiplesMode;
  /**
   * Kategoria bazowa indeksu. Domyślnie pierwsza. MUSI być ta sama dla
   * wszystkich paneli - baza wybierana per panel (na przykład "pierwsza
   * niepusta") dawałaby indeksy liczone od różnych momentów, czyli tempo
   * mierzone od różnych punktów, a to jest kłamstwo trudniejsze do
   * zauważenia niż osobne skale.
   */
  indexBaseAt?: number;
  /** Czym porządkujemy panele. Domyślnie malejąco po średniej. */
  order?: SmallMultiplesOrder;
  /** Czym panel koduje wartość - decyduje o zerze w domenie. Domyślnie linia. */
  mark?: SmallMultiplesMark;
  /**
   * Proporcja obszaru paneli (szerokość przez wysokość). Render, który zna
   * swoje piksele, powinien ją podać - siatka policzona przy domyślnej
   * proporcji nie kłamie, tylko marnuje miejsce.
   */
  areaAspect?: number;
  /** Docelowa proporcja jednego panelu. Domyślnie `SMALL_MULTIPLES_PANEL_ASPECT`. */
  panelAspect?: number;
  /** Wymuszona liczba kolumn. Render zejdzie tu do 1 przy wąskim ekranie. */
  columns?: number;
  /**
   * Slot palety wspólny dla wszystkich paneli. Domyślnie 1, bo w small
   * multiples kolor nie koduje kategorii - tożsamość niesie pozycja panelu
   * i podpis.
   */
  colorSlot?: number;
  /**
   * Czy zachować sloty podane per panel (czyli sloty serii z konfiguracji).
   * Domyślnie NIE: kolor per panel jest tu redundantny, a przy liczbie paneli
   * większej niż zestaw slotów zaczyna kłamać (`paletteWrapOk`).
   */
  keepPanelSlots?: boolean;
  /**
   * Domena podana z zewnątrz - do porównywania kilku rysunków jedną skalą.
   * Model jej NIE rozszerza do danych: wartość poza domeną jest defektem,
   * a nie powodem do przeskalowania, bo ciche rozszerzenie odbiera
   * porównywalności sens, po który wspólną domenę się podaje.
   */
  domain?: { min: number; max: number } | null;
  /**
   * Żądanie usunięcia paneli bez danych. Model go NIE SPEŁNIA i zgłasza jako
   * defekt (`emptyPanelsKeptOk`) - jest w opcjach wyłącznie po to, żeby
   * żądanie z przyszłej albo cofniętej wersji edytora dało się nazwać,
   * zamiast wykonać po cichu.
   */
  dropEmptyPanels?: boolean;
  /**
   * Formatowanie liczby. Render wstrzykuje tu `formatChartValue` związane
   * z językiem i jednostką; domyślna implementacja jest bez Intl i bez
   * locale, żeby moduł został czysty.
   */
  formatValue?: (value: number) => string;
  /** `ChartConfig.sampleSize` - do sprawdzenia zgodności podpisu z próbką. */
  declaredSampleSize?: number | null;
  /**
   * Ile liczb ODRZUCIŁ JUŻ WYWOŁUJĄCY, bo nie miały swojej kategorii.
   *
   * Model liczy nadmiar sam, ale widzi tylko to, co do niego dotarło - a na
   * drodze z bloku parser przycina serie do liczby kategorii, ZANIM model je
   * zobaczy (musi: rendery kartezjańskie chodzą po `values` bez ograniczenia,
   * więc nadmiarowa liczba narysowałaby punkt za osią). Bez tej opcji
   * orzeczenie `inGridOk` było na tej drodze martwe: zapalało się wyłącznie
   * w testach, które budowały wejście z ręki.
   */
  valuesBeyondCategories?: number;
}

/**
 * Domyślne formatowanie wartości: ASCII, bez Intl, bez locale.
 *
 * OSŁONA NA NIELICZBĘ JEST TU OBOWIĄZKOWA, a nie ostrożnościowa:
 * `Intl.NumberFormat.format(NaN)` zwraca literalny napis "NaN", a bramka
 * `src/components/blocks/__tests__/blockMatrix.test.tsx` sprawdza
 * `textContent` bloków właśnie na obecność takich napisów. Model nieliczb nie
 * produkuje, więc ta gałąź nie ma prawa się wykonać - zostaje na wypadek
 * formatera wstrzykniętego z zewnątrz i zwraca ten sam znak braku, którym
 * `format.ts` oznacza lukę.
 */
function domyslnyFormat(value: number): string {
  if (!Number.isFinite(value)) return BRAK_LICZBY;
  const abs = Math.abs(value);
  const miejsca = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return value.toFixed(miejsca);
}

/**
 * Odczyt wartości: wszystko, co nie jest skończoną liczbą, jest LUKĄ.
 * Rozróżnienie luki od zera jest w tym modelu osią wszystkiego (luka
 * przerywa linię, zero jest jej punktem), więc odczyt ma jedno miejsce
 * i nigdzie nie sprowadza braku do zera.
 */
function liczba(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Ostatnia osłona przed NaN i nieskończonością w polu liczbowym modelu.
 * Twarde wymaganie: model NIGDY nie zwraca NaN ani Infinity, bo taka liczba
 * wychodzi na stronie jako napis "NaN" i bramka `blockMatrix` czyta go
 * wprost z `textContent`. Każde dzielenie w tym pliku przechodzi albo przez
 * jawną osłonę mianownika, albo przez tę funkcję - najczęściej przez oba.
 */
function pewna(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/** Przycięcie do przedziału z osłoną na nieliczbę. */
function przytnij(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return value < min ? min : value > max ? max : value;
}

/**
 * SIATKA PANELI - ile kolumn i ile wierszy przy danej liczbie paneli
 * i danych proporcjach.
 *
 * Formuła bierze się z jednego warunku: komórka siatki ma mieć proporcję jak
 * najbliższą docelowej proporcji panelu. Obszar o proporcji `A` podzielony na
 * `k` kolumn i `w` wierszy daje komórkę o proporcji `(A / k) * w`, a przy
 * `k * w = n` wychodzi `k = sqrt(n * A / P)`, gdzie `P` to proporcja
 * docelowa. To jest cała arytmetyka; wszystko poniżej to osłony.
 *
 * ZAOKRĄGLENIE, POTEM DOCIŚNIĘCIE. Po zaokrągleniu liczby kolumn liczba
 * wierszy wychodzi z sufitu (`ceil`), ale wtedy zdarza się, że przy tej
 * liczbie wierszy wystarczy MNIEJ kolumn - na przykład dla pięciu paneli
 * wychodzą 3 kolumny i 2 wiersze, a te same 5 paneli mieści się w 2 rzędach
 * po 3, czyli trzecia kolumna ostatniego rzędu i tak zostaje pusta. Dociśnięcie
 * `columns = ceil(n / rows)` usuwa kolumny, które są puste W CAŁOŚCI, i nie
 * dotyka niepełnego OSTATNIEGO RZĘDU, który jest nieunikniony, gdy `n` nie
 * dzieli się przez liczbę kolumn.
 *
 * KOMÓRKI SĄ RÓWNE, także w ostatnim, niepełnym rzędzie - i to nie jest
 * kosmetyka. Panel rozciągnięty na wolne miejsce miałby inną proporcję niż
 * pozostałe, a więc ten sam wzrost pokazywałby pod innym kątem. Wolne miejsce
 * w ostatnim rzędzie zostaje wolne.
 */
export function smallMultiplesGrid(
  count: number,
  opts: { areaAspect?: number; panelAspect?: number; columns?: number } = {},
): SmallMultiplesGrid {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  // Proporcje muszą być DODATNIE I SKOŃCZONE, bo obie są mianownikami.
  // Zero i nieskończoność (kontener bez rozmiaru w SSR, `width/height` liczone
  // z pustego prostokąta) schodzą do wartości domyślnych, a nie do NaN -
  // NaN w liczbie kolumn daje siatkę bez ani jednego panelu.
  const zadanyObszar = liczba(opts.areaAspect);
  const zadanyPanel = liczba(opts.panelAspect);
  const areaAspect =
    zadanyObszar !== null && zadanyObszar > 0 ? zadanyObszar : SMALL_MULTIPLES_DEFAULT_AREA_ASPECT;
  const panelAspect =
    zadanyPanel !== null && zadanyPanel > 0 ? zadanyPanel : SMALL_MULTIPLES_PANEL_ASPECT;

  if (n === 0) {
    // Siatka bez paneli. Zwracamy 0 na 0, a nie 1 na 1: komórka o zerowej
    // powierzchni jest uczciwsza niż jedna komórka, w której nic nie ma,
    // bo render nie narysuje wtedy pustej ramki udającej panel.
    return {
      columns: 0,
      rows: 0,
      cells: 0,
      lastRowPanels: 0,
      cellWidth: 0,
      cellHeight: 0,
      areaAspect,
      cellAspect: 0,
    };
  }

  let columns: number;
  const wymuszone = liczba(opts.columns);
  if (wymuszone !== null && wymuszone >= 1) {
    // Wymuszenie z renderu (wąski ekran zjeżdża do jednej kolumny). Nigdy
    // więcej kolumn niż paneli, bo puste kolumny to tylko zmarnowane miejsce.
    columns = przytnij(Math.floor(wymuszone), 1, n);
  } else {
    const surowe = Math.sqrt((n * areaAspect) / panelAspect);
    // Mianowniki są tu dodatnie z definicji (obie proporcje przeszły
    // walidację wyżej), ale `pewna` zostaje: `Infinity / Infinity` przy
    // proporcji wstrzykniętej z zewnątrz dałoby NaN, a NaN w liczbie kolumn
    // wychodzi jako siatka bez paneli.
    columns = przytnij(Math.round(pewna(surowe)) || 1, 1, n);
  }

  const rows = Math.max(1, Math.ceil(n / columns));
  // Dociśnięcie - patrz komentarz nad funkcją.
  columns = Math.max(1, Math.min(columns, Math.ceil(n / rows)));

  const cells = columns * rows;
  const cellWidth = pewna(1 / columns);
  const cellHeight = pewna(1 / rows);
  const reszta = n % columns;
  return {
    columns,
    rows,
    cells,
    lastRowPanels: reszta === 0 ? columns : reszta,
    cellWidth,
    cellHeight,
    areaAspect,
    // Proporcja komórki w tych samych jednostkach co `areaAspect`, żeby
    // render mógł sprawdzić, jak daleko siatka odeszła od celu.
    cellAspect: pewna((areaAspect / columns) * rows),
  };
}

/**
 * Domena z surowego zakresu. Przechodzi przez `niceScale`, czyli przez TĘ
 * SAMĄ skalę, którą rysuje silnik - inaczej podziałki paneli i podpis
 * "oś nie zaczyna się od zera" mówiłyby o dwóch różnych skalach (dokładnie ten
 * powód, dla którego `honesty.ts` liczy skalę wspólnym `valueTickTarget`).
 *
 * `niceScale` rozsuwa też zakres płaski (min równe max), więc `span` jest po
 * jej przejściu zawsze dodatni i normalizacja punktów nie dzieli przez zero.
 * Osłona i tak zostaje, bo od tego zależy, czy na stronie pojawi się "NaN".
 */
function domena(rawMin: number, rawMax: number, includeZero: boolean): SmallMultiplesDomain {
  let min = Number.isFinite(rawMin) ? rawMin : 0;
  let max = Number.isFinite(rawMax) ? rawMax : 0;
  if (includeZero) {
    min = Math.min(min, 0);
    max = Math.max(max, 0);
  }
  const nice = niceScale(min, max, SMALL_MULTIPLES_TARGET_TICKS);
  const span = pewna(nice.max - nice.min);
  return {
    min: pewna(nice.min),
    max: pewna(nice.max),
    span,
    ticks: nice.ticks.filter((t) => Number.isFinite(t)),
    includesZero: nice.min <= 0 && nice.max >= 0,
  };
}

/** Domena podana z zewnątrz - bez `niceScale`, bo autor podał ją dokładnie. */
function domenaZewnetrzna(raw: { min: number; max: number }): SmallMultiplesDomain {
  const a = liczba(raw.min) ?? 0;
  const b = liczba(raw.max) ?? 0;
  const min = Math.min(a, b);
  const max = Math.max(a, b);
  const span = pewna(max - min);
  return {
    min,
    max,
    span,
    // Podziałki wyliczamy `niceScale` w granicach podanej domeny, bo podziałki
    // są rusztowaniem, nie danymi - ale samej domeny nie ruszamy.
    ticks: niceScale(min, max, SMALL_MULTIPLES_TARGET_TICKS).ticks.filter((t) =>
      Number.isFinite(t),
    ),
    includesZero: min <= 0 && max >= 0,
  };
}

/** Pozycja wartości w domenie, 0..1 od dołu. Osłona mianownika obowiązkowa. */
function pozycja(value: number, dom: SmallMultiplesDomain): { v: number; clamped: boolean } {
  if (!(dom.span > 0)) {
    // Domena bez rozpiętości: jedyną uczciwą pozycją jest środek, bo dolna
    // i górna krawędź panelu znaczą wtedy to samo.
    return { v: 0.5, clamped: false };
  }
  const surowa = pewna((value - dom.min) / dom.span);
  const przycieta = przytnij(surowa, 0, 1);
  return { v: przycieta, clamped: przycieta !== surowa };
}

/** Statystyki jednego panelu z jego wartości. Osłona na panel pusty. */
interface Statystyki {
  n: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  span: number | null;
  first: number | null;
  last: number | null;
  change: number | null;
  changePct: number | null;
}

function statystyki(values: readonly (number | null)[]): Statystyki {
  const obecne: number[] = [];
  for (const v of values) {
    const l = liczba(v);
    if (l !== null) obecne.push(l);
  }
  if (obecne.length === 0) {
    return {
      n: 0,
      min: null,
      max: null,
      mean: null,
      span: null,
      first: null,
      last: null,
      change: null,
      changePct: null,
    };
  }
  let min = obecne[0];
  let max = obecne[0];
  let suma = 0;
  for (const v of obecne) {
    if (v < min) min = v;
    if (v > max) max = v;
    suma += v;
  }
  const first = obecne[0];
  const last = obecne[obecne.length - 1];
  const change = obecne.length >= 2 ? pewna(last - first) : null;
  // PROCENT OD ZERA NIE ISTNIEJE, więc go nie ma - a nie "jest
  // nieskończonością". Mianownik jest wartością bezwzględną pierwszej
  // wartości, bo przy pierwszej wartości ujemnej iloraz odwróciłby znak
  // zmiany: spadek z -10 do -20 wyszedłby jako wzrost o 100%.
  const changePct = change !== null && first !== 0 ? pewna((change / Math.abs(first)) * 100) : null;
  return {
    n: obecne.length,
    min,
    max,
    mean: pewna(suma / obecne.length),
    span: pewna(max - min),
    first,
    last,
    change,
    changePct,
  };
}

/**
 * Klucz porządkujący panele. Zwraca `null`, gdy panel nie ma na czym stanąć -
 * takie panele idą na KONIEC siatki, bo pusty panel na pierwszym miejscu
 * mówiłby czytelnikowi, że najważniejszy podmiot nie ma danych, a mówi tylko,
 * że alfabet albo arkusz tak ustawiły.
 */
function kluczPorzadku(
  stat: Statystyki,
  label: string,
  order: SmallMultiplesOrder,
): number | string | null {
  switch (order) {
    case "mean":
      return stat.mean;
    case "max":
      return stat.max;
    case "span":
      return stat.span;
    case "last":
      return stat.last;
    case "label":
      return label;
    case "input":
      return null;
  }
}

/**
 * Model small multiples. Wejściem są etykiety wspólnej osi kategorii i lista
 * paneli - dokładnie to, co silnik ma w `ChartConfig` (serie jako panele,
 * kategorie jako oś), rozpięte na czysty kształt, żeby model dał się zbudować
 * także z macierzy przyszłego edytora.
 */
export function smallMultiplesModel(
  input: SmallMultiplesInput,
  opts: SmallMultiplesOptions = {},
): SmallMultiplesModel {
  const categories = input.categories.map((c) => c);
  const categoryCount = categories.length;
  const wejscie = input.panels.map((p) => p);
  const panelCount = wejscie.length;

  const mode: SmallMultiplesMode = opts.mode === "index" ? "index" : "level";
  const mark: SmallMultiplesMark =
    opts.mark === "bar" ? "bar" : opts.mark === "area" ? "area" : "line";
  const order: SmallMultiplesOrder = opts.order ?? "mean";
  const requestedScaleMode: SmallMultiplesScaleMode = opts.scaleMode === "free" ? "free" : "shared";
  const format = opts.formatValue ?? domyslnyFormat;
  const wspolnySlot = przytnij(Math.round(opts.colorSlot ?? 1), 1, MAX_SERIES);
  // KATEGORIA BAZOWA JEST ROZSTRZYGNIĘTA ZAWSZE, nie tylko w trybie indeksu.
  // Kolumna indeksu w tabeli danych istnieje także wtedy, gdy oś pokazuje
  // poziomy - i jest tam po to, żeby czytelnik zobaczył, DLACZEGO panel
  // wygląda płasko: "112" obok płaskiej kreski mówi, że wzrost był
  // dwunastoprocentowy, a nie żadny. Wiązanie bazy z trybem osi odbierałoby
  // tabeli tę kolumnę dokładnie tam, gdzie jest najbardziej potrzebna.
  const indexBaseAt =
    categoryCount > 0 ? przytnij(Math.round(opts.indexBaseAt ?? 0), 0, categoryCount - 1) : null;

  // ODCZYT DANYCH PRZED GEOMETRIĄ. Domena musi być znana, zanim policzymy
  // pozycje punktów, a kolejność paneli - zanim przypiszemy im komórki
  // siatki; dlatego pierwsze przejście liczy tylko statystyki i indeksy.
  interface Surowy {
    wejscieIndex: number;
    label: string;
    unit: string | null;
    slot: number;
    values: (number | null)[];
    stat: Statystyki;
    indexBase: number | null;
    indexable: boolean;
  }

  let valuesOutsideGrid = Math.max(0, Math.trunc(opts.valuesBeyondCategories ?? 0));
  const surowe: Surowy[] = wejscie.map((panel, i) => {
    // Wartości OBCIĘTE do liczby kategorii, ale obcięcie jest LICZONE.
    // Liczba za ostatnią kategorią nie ma na osi miejsca, w które mogłaby
    // trafić, więc nie ma jej ani na rysunku, ani w tabeli - i to jest
    // defekt, nie szczegół implementacyjny.
    const values: (number | null)[] = [];
    for (let c = 0; c < categoryCount; c++) values.push(liczba(panel.values[c]));
    for (let c = categoryCount; c < panel.values.length; c++) {
      if (liczba(panel.values[c]) !== null) valuesOutsideGrid++;
    }
    const stat = statystyki(values);
    const base = indexBaseAt === null ? null : liczba(values[indexBaseAt]);
    const wlasnySlot = liczba(panel.colorSlot);
    return {
      wejscieIndex: i,
      label: panel.label,
      unit: panel.unit ?? null,
      slot:
        opts.keepPanelSlots === true && wlasnySlot !== null
          ? przytnij(Math.round(wlasnySlot), 1, MAX_SERIES)
          : wspolnySlot,
      values,
      stat,
      indexBase: base,
      // BAZA MUSI BYĆ DODATNIA. Zero daje dzielenie przez zero, a liczba
      // ujemna ODWRACA kierunek (spadek wychodzi jako wzrost) - oba
      // przypadki są wykluczone, a nie "obsłużone", bo indeks policzony od
      // ujemnej bazy jest liczbą, której nie da się przeczytać.
      //
      // O UŻYTECZNOŚCI BAZY ROZSTRZYGA `baseUsable` I NIKT INNY. Defekt,
      // który przez to znika: ta sama decyzja stała dotąd tutaj i w modelu
      // indeksu bazowego jako dwa niezależne warunki, a zgodności pilnował
      // komentarz. Wspólna funkcja jest też tą samą, którą pyta
      // `indexAgainst`, więc werdykt panelu i przeliczenie punktu nie mają
      // się już czym rozjechać.
      indexable: baseUsable(base) === "ok",
    };
  });

  // JEDNOSTKI DECYDUJĄ O TYM, CZY WSPÓLNA OŚ JEST W OGÓLE MOŻLIWA. Panele
  // w różnych jednostkach na jednej osi to dwie osie Y rozłożone na n paneli,
  // więc gdy autor podał jednostki i te się różnią, model SCHODZI do skal
  // osobnych i zgłasza to - milczące spełnienie żądania wspólnej osi byłoby
  // tu defektem, a milcząca degradacja zostawiłaby autora w przekonaniu, że
  // panele są porównywalne.
  const jednostki = surowe.map((s) => s.unit).filter((u): u is string => u !== null && u !== "");
  const jednostkiZnane = jednostki.length === surowe.length && surowe.length > 0;
  const jednostkiZgodne = jednostkiZnane ? new Set(jednostki).size === 1 : null;
  const scaleMode: SmallMultiplesScaleMode =
    jednostkiZgodne === false ? "free" : requestedScaleMode;

  // PORZĄDEK PANELI. Klucz z danych, malejąco (poza porządkiem po etykiecie,
  // gdzie rosnąco jest jedyną sensowną kolejnością). Rozstrzygacz remisów jest
  // dwustopniowy - etykieta, potem indeks wejściowy - żeby kolejność była
  // DETERMINISTYCZNA: siatka, która przy dwóch przebudowach z tych samych
  // danych wychodzi inna, uczy czytelnika, że pozycja panelu nic nie znaczy.
  const posortowane = surowe.map((s) => s).sort(porzadek(order));
  // Czy o kolejności zadecydowały DANE, czy arkusz. Gdy wszystkie klucze są
  // równe (albo puste), decyduje rozstrzygacz remisów, czyli w praktyce
  // alfabet i arkusz - i wtedy model nie może twierdzić, że panele są
  // uporządkowane danymi.
  const klucze = surowe
    .map((s) => kluczPorzadku(s.stat, s.label, order))
    .filter((k): k is number | string => k !== null);
  const kluczeRozne = new Set(klucze).size > 1;

  const grid = smallMultiplesGrid(panelCount, {
    areaAspect: opts.areaAspect,
    panelAspect: opts.panelAspect,
    columns: opts.columns,
  });

  // DOMENA WSPÓLNA. Liczona ZAWSZE, także przy skalach osobnych, bo jest
  // jedyną miarą tego, o ile panele się rozjeżdżają, i bo tabela danych
  // podaje ją w podpisie - czytelnik ma wiedzieć, czego panele nie dzielą.
  //
  // PRZELICZENIE NA INDEKS LICZY `indexAgainst`, a nie ten plik, i defekt,
  // który przez to znika, jest arytmetyczny oraz cichy. Wzór stał tu wprost
  // i szedł przez `pewna`, czyli przez osłonę WYŚWIETLANIA, a ta mapuje
  // nieskończoność na ZERO. Dla bazy 1e-5 i wartości 1e308 iloraz wychodzi
  // poza podwójną precyzję, więc panel rosnący o piętnaście rzędów wielkości
  // dostawał indeks 0 i był rysowany na samym DOLE osi - odczyt dokładnie
  // odwrotny do prawdy, i to bez napisu "NaN", który zauważyłaby bramka.
  // Indeks jest ORZECZENIEM o danych, więc odpowiedzią na przepełnienie jest
  // `null`: punkt staje się luką, a linia się przerywa, zamiast schodzić
  // do zera. Kolejność działań (dzielenie PRZED mnożeniem) też jest teraz
  // jedna dla całego silnika, a nie przepisana z sąsiedniego pliku.
  const aktywna = (s: Surowy): (number | null)[] =>
    mode === "index" ? s.values.map((v) => indexAgainst(v, s.indexBase)) : s.values;

  let dataMin = Infinity;
  let dataMax = -Infinity;
  for (const s of surowe) {
    for (const v of aktywna(s)) {
      if (v === null) continue;
      if (v < dataMin) dataMin = v;
      if (v > dataMax) dataMax = v;
    }
  }
  const maDane = dataMin !== Infinity;
  // ZERO W DOMENIE WYMUSZONE TAM, GDZIE ZNACZNIK KODUJE DŁUGOŚĆ (sekcja 8).
  // Przy linii zero nie jest wymagane, ale ucięcie musi być nazwane -
  // i o tym mówi `axisTruncated`, nie ta gałąź.
  const includeZero = mark !== "line";
  const zewnetrzna = opts.domain ?? null;
  const shared = zewnetrzna
    ? domenaZewnetrzna(zewnetrzna)
    : domena(maDane ? dataMin : 0, maDane ? dataMax : 1, includeZero);

  // POZIOMY PANELI - iloraz największej i najmniejszej średniej bezwzględnej.
  // To druga, obok udziału osi, diagnoza rozjazdu skal i ta czytelniejsza
  // w podpisie. Mianownik jest osłonięty: przy średniej zerowej iloraz nie
  // istnieje i wtedy jest `null`, a nie nieskończonością.
  const poziomy = surowe
    .map((s) => s.stat.mean)
    .filter((m): m is number => m !== null)
    .map((m) => Math.abs(m));
  const poziomMin = poziomy.length > 0 ? Math.min(...poziomy) : null;
  const poziomMax = poziomy.length > 0 ? Math.max(...poziomy) : null;
  const levelRatio =
    poziomMin !== null && poziomMax !== null && poziomMin > 0 ? pewna(poziomMax / poziomMin) : null;

  // DRUGIE PRZEJŚCIE: geometria, pozycje punktów i spłaszczenie.
  // OBSERWACJE LICZONE Z POZIOMÓW, NIE Z NARYSOWANYCH PUNKTÓW, i to jest
  // rozróżnienie, które ma znaczenie w trybie indeksu: panel bez użytecznej
  // bazy nie ma w indeksie ani jednego punktu do narysowania, ale pomiary
  // w nim SĄ. `n` w podpisie mówi, ile jest pomiarów (sekcja 8), a nie ile
  // punktów zmieściło się na tym konkretnym rysunku - inaczej przełączenie
  // na indeks zmieniałoby zadeklarowaną próbkę, czyli zdanie o danych.
  // O punktach, których w indeksie nie ma, mówi osobno `indexBaseOk`.
  let observations = 0;
  let gaps = 0;
  let emptyPanels = 0;
  let flattenedPanels = 0;
  let poza = false;

  const panels: SmallMultiplesPanel[] = posortowane.map((s, position) => {
    const row = grid.columns > 0 ? Math.floor(position / grid.columns) : 0;
    const column = grid.columns > 0 ? position % grid.columns : 0;
    const wartosci = aktywna(s);
    // Domena panelu: wspólna albo własna. Przy własnej NADAL przechodzi przez
    // `niceScale`, bo panel z podziałkami spoza progresji 1-2-5 czyta się
    // gorzej niż panel spłaszczony.
    const panelDomain =
      scaleMode === "shared" ? shared : domenaWlasna(wartosci, shared, includeZero);

    const points: SmallMultiplesPoint[] = categories.map((label, c) => {
      const poziom = s.values[c] ?? null;
      const aktywnaWartosc = wartosci[c] ?? null;
      // POZYCJA POJEDYNCZEGO PUNKTU NA ŚRODKU, nie na lewej krawędzi. Jeden
      // punkt nie ma początku ani końca szeregu; postawiony na 0 wyglądałby
      // na szereg ucięty z prawej strony.
      const t = categoryCount > 1 ? pewna(c / (categoryCount - 1)) : 0.5;
      if (aktywnaWartosc === null) {
        return {
          category: c,
          label,
          value: poziom,
          state: "gap",
          t,
          v: null,
          indexed: null,
          clamped: false,
          text: BRAK_LICZBY,
        };
      }
      const { v, clamped } = pozycja(aktywnaWartosc, panelDomain);
      if (clamped) poza = true;
      // Ten sam `indexAgainst` co w `aktywna` - kolumna indeksu w tabeli
      // i pozycja punktu na osi nie mogą powstawać z dwóch wzorów.
      const indeks = indexAgainst(poziom, s.indexBase);
      return {
        category: c,
        label,
        value: poziom,
        state: "value",
        t,
        v,
        indexed: indeks,
        clamped,
        // Etykieta zawsze z wartości W JEDNOSTKACH DANYCH, także w trybie
        // indeksu: indeks jest sposobem PATRZENIA na szereg, a nie nową
        // liczbą, i czytelnik, który chce wiedzieć "ile", pyta o poziom.
        // Indeks stoi w osobnej kolumnie tabeli (`indexed`).
        //
        // Gałąź na brak poziomu jest nieosiągalna (wartość aktywna powstaje
        // z poziomu, więc jedna nie istnieje bez drugiej), ale zostaje jawna:
        // gdyby kiedyś przestała być nieosiągalna, punkt dostałby znak braku,
        // a nie napis "null" wprost na rysunku.
        text: poziom === null ? BRAK_LICZBY : format(poziom),
      };
    });

    const empty = s.stat.n === 0;
    if (empty) emptyPanels++;
    observations += s.stat.n;
    gaps += Math.max(0, categoryCount - s.stat.n);

    // UDZIAŁ WŁASNEJ ZMIENNOŚCI W OSI - liczba, z której bierze się
    // rozstrzygnięcie o indeksie bazowym. Liczona zawsze wobec domeny
    // WSPÓLNEJ, także gdy panel jest rysowany we własnej: pytanie brzmi
    // "co by się stało na wspólnej osi", a nie "jak wygląda teraz".
    const wlasnySpan = rozpietosc(wartosci);
    const occupancy =
      wlasnySpan !== null && shared.span > 0
        ? przytnij(pewna(wlasnySpan / shared.span), 0, 1)
        : null;
    // SPŁASZCZENIE ORZEKAMY OD DWÓCH PUNKTÓW. Panel z jedną wartością ma
    // rozpiętość zero z definicji, a nie z powodu skali - nazwanie go
    // spłaszczonym byłoby zdaniem o osi tam, gdzie nie ma czego spłaszczać.
    const flattened =
      occupancy !== null && s.stat.n >= 2 && occupancy < SMALL_MULTIPLES_FLATTENED_SHARE;
    if (flattened) flattenedPanels++;

    return {
      index: s.wejscieIndex,
      position,
      row,
      column,
      label: s.label,
      unit: s.unit,
      colorSlot: s.slot,
      points,
      n: s.stat.n,
      gaps: Math.max(0, categoryCount - s.stat.n),
      empty,
      min: s.stat.min,
      max: s.stat.max,
      mean: s.stat.mean,
      span: s.stat.span,
      first: s.stat.first,
      last: s.stat.last,
      change: s.stat.change,
      changePct: s.stat.changePct,
      domain: panelDomain,
      occupancy,
      flattened,
      indexBase: s.indexBase,
      indexable: s.indexable,
      x: pewna(column * grid.cellWidth),
      y: pewna(row * grid.cellHeight),
      w: grid.cellWidth,
      h: grid.cellHeight,
    };
  });

  const drawablePanels = panelCount - emptyPanels;
  // Panele, o których spłaszczenie da się w ogóle orzec - czyli mające po
  // dwie wartości. Panel z jedną wartością nie wchodzi do mianownika,
  // bo inaczej zestaw "jeden szereg i dziewięć pojedynczych punktów"
  // wychodziłby jako "wszystkie panele poza jednym spłaszczone".
  const orzekalne = panels.filter((p) => p.n >= 2).length;
  // "WSZYSTKIE PANELE POZA JEDNYM" to dosłownie `orzekalne - 1`, i nierówność
  // jest nieostra świadomie: przy dwóch panelach, z których jeden jest płaski,
  // a drugi nie, defekt JUŻ zachodzi - to jest dokładnie przypadek dwóch
  // szeregów o różnej skali, dla którego tabela doboru form zabrania dwóch osi
  // Y i wskazuje indeks bazowy albo panele. Panel spłaszczony nie przestaje
  // być spłaszczony przez to, że jest ich mało.
  const sharedScaleReadableOk =
    orzekalne >= 2 && shared.span > 0 ? flattenedPanels < orzekalne - 1 : null;

  const spreadOk = observations === 0 ? null : panels.some((p) => (p.span ?? 0) > 0);
  const declared = liczba(opts.declaredSampleSize ?? null);
  const rozneSloty = new Set(panels.map((p) => p.colorSlot)).size > 1;

  const honesty: SmallMultiplesHonesty = {
    commonScaleOk: drawablePanels < 2 ? null : scaleMode === "shared",
    freeScaleDeclaredOk:
      scaleMode === "shared" ? null : (opts.freeScaleNote ?? "").trim().length > 0,
    sharedScaleReadableOk,
    sameUnitOk: jednostkiZgodne,
    emptyPanelsKeptOk: emptyPanels === 0 ? null : opts.dropEmptyPanels !== true,
    orderFromDataOk: drawablePanels < 2 ? null : order !== "input" && kluczeRozne,
    inGridOk: observations === 0 && valuesOutsideGrid === 0 ? null : valuesOutsideGrid === 0,
    // Domena z zewnątrz jest domeną RYSOWANIA tylko przy skali wspólnej; przy
    // osobnej każdy panel ma własną i nic nie wychodzi poza nią z definicji.
    // Zaświadczanie wtedy "wszystko się mieści" mówiłoby o domenie, w której
    // rysunek i tak nie powstał - więc model milczy.
    inDomainOk: zewnetrzna === null || scaleMode !== "shared" ? null : !poza,
    zeroBaselineOk: mark === "line" ? null : shared.includesZero,
    indexBaseOk: mode !== "index" ? null : panels.every((p) => p.empty || p.indexable),
    spreadOk,
    declaredSampleOk:
      declared === null || observations === 0 ? null : Math.round(declared) === observations,
    paletteWrapOk: rozneSloty ? panelCount <= MAX_SERIES : null,
  };

  return {
    panels,
    categories,
    grid,
    scale: {
      mode,
      scaleMode,
      requestedScaleMode,
      shared,
      domainFromData: zewnetrzna === null,
      indexBaseAt,
      levelRatio,
    },
    order,
    mark,
    panelCount,
    drawablePanels,
    emptyPanels,
    flattenedPanels,
    observations,
    gaps,
    valuesOutsideGrid,
    // INDEKS BAZOWY JEST ODPOWIEDZIĄ NA SPŁASZCZENIE, nie na wszystko: gdy
    // panele są już w indeksie, doradzanie indeksu byłoby doradzaniem stanu,
    // w którym rysunek już jest.
    indexBaseAdvised: mode === "level" && sharedScaleReadableOk === false,
    axisTruncated: !shared.includesZero,
    slotsUniform: !rozneSloty,
    honesty,
  };
}

/**
 * Domena WŁASNA panelu - używana wyłącznie przy skali osobnej.
 *
 * Panel PUSTY dostaje domenę wspólną, a nie własną: własna domena z pustego
 * zbioru nie istnieje, a wymyślona (na przykład 0..1) postawiłaby pod pustym
 * panelem podziałki, których nic nie dotyczy, i czytelnik odczytałby je jako
 * zakres danych. Pusty panel ma być pusty, razem z osią.
 */
function domenaWlasna(
  values: readonly (number | null)[],
  fallback: SmallMultiplesDomain,
  includeZero: boolean,
): SmallMultiplesDomain {
  let mn = Infinity;
  let mx = -Infinity;
  for (const v of values) {
    if (v === null) continue;
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  return mn === Infinity ? fallback : domena(mn, mx, includeZero);
}

/** Rozpiętość wartości panelu w AKTYWNEJ jednostce; `null` przy panelu pustym. */
function rozpietosc(values: readonly (number | null)[]): number | null {
  let mn = Infinity;
  let mx = -Infinity;
  for (const v of values) {
    if (v === null) continue;
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  return mn === Infinity ? null : pewna(mx - mn);
}

/**
 * Komparator paneli. Malejąco po kluczu liczbowym (bo pierwszy rząd siatki
 * ma nieść największe podmioty), rosnąco po etykiecie (bo alfabet czyta się
 * tylko w jedną stronę), panele bez klucza na koniec. Rozstrzygacz remisów
 * jest dwustopniowy, żeby kolejność była deterministyczna.
 */
function porzadek(
  order: SmallMultiplesOrder,
): (
  a: { stat: Statystyki; label: string; wejscieIndex: number },
  b: { stat: Statystyki; label: string; wejscieIndex: number },
) => number {
  return (a, b) => {
    const ka = kluczPorzadku(a.stat, a.label, order);
    const kb = kluczPorzadku(b.stat, b.label, order);
    if (ka === null && kb === null) return a.wejscieIndex - b.wejscieIndex;
    if (ka === null) return 1;
    if (kb === null) return -1;
    if (typeof ka === "string" || typeof kb === "string") {
      const sa = String(ka);
      const sb = String(kb);
      // Porównanie po jednostkach kodowych, nie `localeCompare`: model jest
      // czysty i nie zna języka, a kolejność zależna od locale dawałaby dwie
      // różne siatki dla dwóch wersji językowych tego samego wpisu.
      if (sa !== sb) return sa < sb ? -1 : 1;
      return a.wejscieIndex - b.wejscieIndex;
    }
    if (ka !== kb) return kb - ka;
    if (a.label !== b.label) return a.label < b.label ? -1 : 1;
    return a.wejscieIndex - b.wejscieIndex;
  };
}

/**
 * Model z konfiguracji silnika. `panelBy` rozstrzyga, który wymiar arkusza
 * jest podmiotem - patrz `SmallMultiplesPanelBy`.
 *
 * DEGRADACJA DO SENSOWNEGO PRZYPADKU jest tu jawna: `ChartConfig` nie ma
 * jednostki per panel, więc przy `panelBy: "series"` wszystkie panele
 * dostają jednostkę wykresu (a więc `sameUnitOk` wychodzi `true` i jest to
 * prawda), a przy `panelBy: "category"` panelami są kategorie i jednostka
 * wykresu nadal jest jedna dla wszystkich - co przy panelach będących
 * WSKAŹNIKAMI byłoby nieprawdą, dlatego wtedy jednostek nie podajemy wcale
 * i model MILCZY (`sameUnitOk: null`), zamiast zaświadczać zgodność, której
 * nie sprawdził.
 */
export function smallMultiplesModelFromConfig(
  config: ChartConfig,
  opts: SmallMultiplesOptions & { panelBy?: SmallMultiplesPanelBy } = {},
): SmallMultiplesModel {
  const { panelBy: zadanyPanelBy, ...reszta } = opts;
  const panelBy: SmallMultiplesPanelBy = zadanyPanelBy === "category" ? "category" : "series";
  const jednostka = config.unit.trim();
  // `sampleSize` z konfiguracji jest DOMYŚLNY, nie nadrzędny: wywołujący,
  // który zna próbkę lepiej (bo na przykład rysuje wycinek danych), podaje
  // własną i model porównuje się z jego liczbą.
  const wspolne: SmallMultiplesOptions = {
    ...reszta,
    declaredSampleSize: reszta.declaredSampleSize ?? config.sampleSize,
    valuesBeyondCategories: config.valuesBeyondCategories,
  };

  if (panelBy === "category") {
    // TRANSPOZYCJA. Panelem jest kategoria, osią - nazwy serii. Jednostki per
    // panel nie podajemy, bo panele są tu wskaźnikami, a konfiguracja ma
    // jedną jednostkę na cały wykres; udawanie, że wszystkie wskaźniki mają
    // tę samą jednostkę, byłoby zaświadczeniem bez sprawdzenia.
    return smallMultiplesModel(
      {
        categories: config.series.map((s) => s.name),
        panels: config.categories.map((label, c) => ({
          label,
          values: config.series.map((s) => s.values[c] ?? null),
        })),
      },
      wspolne,
    );
  }

  return smallMultiplesModel(
    {
      categories: config.categories,
      panels: config.series.map((s) => ({
        label: s.name,
        values: s.values,
        colorSlot: s.colorSlot,
        unit: jednostka === "" ? null : jednostka,
      })),
    },
    wspolne,
  );
}

/**
 * Domena WSPÓLNEJ osi wartości - to, co render ma podać wszystkim panelom.
 *
 * Zero jest wymuszone tylko przy znaczniku kodującym długość, bo tylko tam
 * ucięcie osi zniekształca proporcję (sekcja 8). Przy linii domena idzie
 * z danych, a fakt ucięcia niesie `model.axisTruncated`.
 */
export function smallMultiplesExtent(model: SmallMultiplesModel): { min: number; max: number } {
  return { min: pewna(model.scale.shared.min), max: pewna(model.scale.shared.max) };
}

export interface SmallMultiplesFit {
  /** Czy panele osiągają minimalny rozmiar, przy którym rodzaj działa. */
  ok: boolean;
  /** Rozmiar jednego panelu w pikselach przy tej siatce. */
  panelWidth: number;
  panelHeight: number;
  /** Ile kolumn i wierszy zmieściłoby się na tej powierzchni z zapasem progu. */
  maxColumns: number;
  maxRows: number;
  /** Ile paneli w ogóle wchodzi na tę powierzchnię. */
  maxPanels: number;
  /**
   * Ile kolumn render powinien wziąć, żeby zejść nad próg. `null`, gdy nawet
   * jedna kolumna nie mieści się w wysokości - wtedy rodzaj nie ma wyjścia
   * awaryjnego w siatce i trzeba zejść do tabeli ze sparklines albo do samej
   * tabeli danych.
   */
  suggestedColumns: number | null;
}

/**
 * Czy panele MIESZCZĄ SIĘ przy znanych pikselach. Model liczy siatkę
 * w jednostkach względnych i nie wie, jak duża jest powierzchnia; render wie,
 * a przy wąskim ekranie te dwie odpowiedzi się rozchodzą i wtedy obowiązuje
 * pomiar - dokładnie jak przy etykietach liczbowych mapy ciepła.
 *
 * PODAJEMY TEŻ WYJŚCIE, nie tylko diagnozę: `suggestedColumns` mówi, ile
 * kolumn utrzymuje panele nad progiem, bo właściwą reakcją na ciasną siatkę
 * jest zwężenie liczby kolumn (panele stają się szersze i schodzą w dół),
 * a nie zmniejszenie paneli albo usunięcie któregoś.
 */
export function smallMultiplesFit(
  model: SmallMultiplesModel,
  size: { width: number; height: number },
): SmallMultiplesFit {
  const width = Math.max(0, liczba(size.width) ?? 0);
  const height = Math.max(0, liczba(size.height) ?? 0);
  const columns = Math.max(1, model.grid.columns);
  const rows = Math.max(1, model.grid.rows);
  // Mianowniki są tu dodatnie z definicji (oba przeszły `Math.max(1, ...)`),
  // ale iloraz idzie przez `pewna`, bo szerokość wstrzyknięta z zewnątrz
  // bywa nieskończonością (kontener bez rozmiaru w SSR).
  const panelWidth = pewna(width / columns);
  const panelHeight = pewna(height / rows);
  const maxColumns = Math.floor(width / SMALL_MULTIPLES_MIN_PANEL_W);
  const maxRows = Math.floor(height / SMALL_MULTIPLES_MIN_PANEL_H);
  const maxPanels = Math.max(0, maxColumns) * Math.max(0, maxRows);

  // Ile kolumn utrzyma WSZYSTKIE panele nad progiem. Szukamy od najwęższej
  // siatki, bo im mniej kolumn, tym szersze panele - ale wierszy jest wtedy
  // więcej, więc warunek wysokości może nie przejść i wtedy nie ma wyjścia
  // w siatce.
  let suggestedColumns: number | null = null;
  const panele = Math.max(1, model.panelCount);
  for (let k = Math.min(panele, Math.max(1, maxColumns)); k >= 1; k--) {
    const w = Math.ceil(panele / k);
    if (
      pewna(width / k) >= SMALL_MULTIPLES_MIN_PANEL_W &&
      pewna(height / w) >= SMALL_MULTIPLES_MIN_PANEL_H
    ) {
      suggestedColumns = k;
      break;
    }
  }

  return {
    ok: panelWidth >= SMALL_MULTIPLES_MIN_PANEL_W && panelHeight >= SMALL_MULTIPLES_MIN_PANEL_H,
    panelWidth,
    panelHeight,
    maxColumns: Math.max(0, maxColumns),
    maxRows: Math.max(0, maxRows),
    maxPanels,
    suggestedColumns,
  };
}

/**
 * Kiedy small multiples są ZŁYM WYBOREM formy - odpowiednik `pieFormAdvice`
 * i `heatmapFormAdvice`. Osobno od sprawdzeń uczciwości, bo tu nie zawsze
 * jest defekt arytmetyczny: dane bywają w porządku, a forma o nich kłamie
 * kształtem albo po prostu nic nie pokazuje.
 *
 *   * `singlePanel` - jeden panel (albo jeden z danymi). To nie są small
 *     multiples, tylko wykres, któremu siatka odebrała miejsce na osie;
 *   * `tooManyPanels` - powyżej `SMALL_MULTIPLES_MAX_COMFORT` panele schodzą
 *     do rozmiaru sparkline i osi wartości nie da się odczytać; wtedy
 *     tabela ze sparklines mówi to samo, a liczba stoi w kolumnie obok;
 *   * `indexBaseBetter` - wspólna oś spłaszcza wszystkie panele poza jednym;
 *     właściwą odpowiedzią jest indeks bazowy (baza = 100), a NIE osobne
 *     skale, bo te odbierają porównaniu sens;
 *   * `undeclaredFreeScale` - panele mają osobne osie i nikt tego nie
 *     napisał, więc rysunek wygląda na porównywalny, nie będąc;
 *   * `mixedUnits` - panele mierzą różne rzeczy, więc wspólna oś jest
 *     niemożliwa; przy wskaźnikach o różnych jednostkach uczciwe są indeks
 *     bazowy albo osobne skale Z OPISEM;
 *   * `noSpread` - żaden panel nie ma rozpiętości; wszystkie linie płaskie,
 *     a jedno zdanie mówi to samo bez rysunku;
 *   * `sheetOrder` - kolejność paneli jest kolejnością arkusza; posortuj
 *     kluczem z danych, bo pierwszy rząd siatki niesie pierwsze wrażenie;
 *   * `oneCategory` - oś kategorii ma jeden punkt, więc panel nie pokazuje
 *     ani przebiegu, ani rozkładu; przy jednej kategorii porównanie podmiotów
 *     robi się posortowanymi słupkami poziomymi, gdzie wartość koduje
 *     długość.
 */
export type SmallMultiplesFormAdvice =
  | "singlePanel"
  | "tooManyPanels"
  | "indexBaseBetter"
  | "undeclaredFreeScale"
  | "mixedUnits"
  | "noSpread"
  | "sheetOrder"
  | "oneCategory";

export function smallMultiplesFormAdvice(model: SmallMultiplesModel): SmallMultiplesFormAdvice[] {
  const advice: SmallMultiplesFormAdvice[] = [];
  if (model.observations === 0) return advice;
  if (model.drawablePanels < SMALL_MULTIPLES_MIN_PANELS) advice.push("singlePanel");
  if (model.panelCount > SMALL_MULTIPLES_MAX_COMFORT) advice.push("tooManyPanels");
  if (model.indexBaseAdvised) advice.push("indexBaseBetter");
  if (model.honesty.freeScaleDeclaredOk === false) advice.push("undeclaredFreeScale");
  if (model.honesty.sameUnitOk === false) advice.push("mixedUnits");
  if (model.honesty.spreadOk === false) advice.push("noSpread");
  if (model.honesty.orderFromDataOk === false) advice.push("sheetOrder");
  if (model.categories.length < 2) advice.push("oneCategory");
  return advice;
}

/**
 * Kolumny podsumowania panelu w tabeli danych. Lista jest tu stałą, bo pytają
 * o nią dwa miejsca (nagłówek tabeli i słownik nazw kolumn), a rozjazd między
 * nimi dawałby tabelę z nagłówkiem o jednej kolumnie mniej niż wiersze.
 *
 * `occupancy` jest w tej liście świadomie: to jedyna kolumna, która oddaje
 * czytelnikowi TO, CO WIDZI (jaką część osi zajmuje ten panel), a nie liczbę,
 * z której to wynikło. Bez niej czytelnik nie ma z czego wywnioskować,
 * dlaczego dziewięć paneli jest płaskich.
 */
export const SMALL_MULTIPLES_SUMMARY_COLUMNS = [
  "panel",
  "n",
  "min",
  "max",
  "mean",
  "first",
  "last",
  "change",
  "changePct",
  "occupancy",
] as const;

export type SmallMultiplesSummaryColumn = (typeof SMALL_MULTIPLES_SUMMARY_COLUMNS)[number];

export interface SmallMultiplesTableCell {
  categoryLabel: string;
  /** Wartość w jednostkach danych. `null` = luka. */
  value: number | null;
  /** Ta sama wartość jako indeks; `null` gdy panel nie ma bazy. */
  indexed: number | null;
  state: SmallMultiplesPointState;
  /** Ta sama etykieta, którą niesie punkt na rysunku. */
  text: string;
}

export interface SmallMultiplesTableRow {
  /** Pozycja w siatce, ta sama co na rysunku - tabela i rysunek czytają się rzędami. */
  position: number;
  label: string;
  unit: string | null;
  cells: SmallMultiplesTableCell[];
  n: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  first: number | null;
  last: number | null;
  change: number | null;
  changePct: number | null;
  /** Jaką część wspólnej osi zajmuje ten panel, 0..1. */
  occupancy: number | null;
  flattened: boolean;
  empty: boolean;
  indexBase: number | null;
}

export interface SmallMultiplesTable {
  /** Nagłówek: etykiety wspólnej osi kategorii w kolejności rysowania. */
  categoryLabels: string[];
  /** Wiersze W KOLEJNOŚCI PANELI, nie arkusza. */
  rows: SmallMultiplesTableRow[];
  columns: readonly SmallMultiplesSummaryColumn[];
  mode: SmallMultiplesMode;
  scaleMode: SmallMultiplesScaleMode;
  /** Wspólna domena - także wtedy, gdy panele jej nie dzielą. */
  shared: SmallMultiplesDomain;
  /** Iloraz poziomów paneli - liczba do podpisu przy spłaszczeniu. */
  levelRatio: number | null;
  observations: number;
  gaps: number;
  emptyPanels: number;
  flattenedPanels: number;
  /** Które panele są spłaszczone - to ich liczb NIE DA SIĘ odczytać z rysunku. */
  flattenedLabels: string[];
}

/**
 * ALTERNATYWA TEKSTOWA: co ma pokazać tabela danych pod wykresem. Grafika
 * nigdy nie jest jedyną drogą do liczby - z panelu o wysokości 100 px nie
 * odczyta się wartości dokładniej niż "wyżej niż tamta", a przy spłaszczeniu
 * nawet tego.
 *
 * TABELA JEST TU RATUNKIEM, NIE ZAPISEM RYSUNKU, i to jest jej najważniejsza
 * cecha. Small multiples są jedynym rodzajem, w którym część danych bywa
 * NIECZYTELNA Z ZAŁOŻENIA: panel spłaszczony przez wspólną oś pokazuje
 * płaską kreskę, a jego liczby istnieją wyłącznie w tabeli. Dlatego tabela
 * niesie nie tylko wartości, ale też `occupancy` i listę spłaszczonych
 * paneli - żeby czytelnik wiedział, KTÓRYCH paneli nie wolno mu czytać
 * z obrazka.
 *
 * Luki jadą do tabeli jako luki (`state: "gap"`, znak braku), a nie zera,
 * dokładnie tak samo jak na rysunku. Tabela i panele muszą kłamać tak samo
 * albo nie kłamać wcale, bo rozjazd między nimi jest defektem samym w sobie.
 *
 * Kolejność wierszy jest kolejnością PANELI, nie arkusza - czytelnik, który
 * szuka w tabeli podmiotu widzianego w drugim rzędzie, ma go znaleźć na tej
 * samej pozycji.
 */
export function smallMultiplesTable(model: SmallMultiplesModel): SmallMultiplesTable {
  const rows: SmallMultiplesTableRow[] = model.panels.map((panel) => ({
    position: panel.position,
    label: panel.label,
    unit: panel.unit,
    cells: panel.points.map((point) => ({
      categoryLabel: point.label,
      value: point.value,
      indexed: point.indexed,
      state: point.state,
      text: point.text,
    })),
    n: panel.n,
    min: panel.min,
    max: panel.max,
    mean: panel.mean,
    first: panel.first,
    last: panel.last,
    change: panel.change,
    changePct: panel.changePct,
    occupancy: panel.occupancy,
    flattened: panel.flattened,
    empty: panel.empty,
    indexBase: panel.indexBase,
  }));

  return {
    categoryLabels: model.categories.map((c) => c),
    rows,
    columns: SMALL_MULTIPLES_SUMMARY_COLUMNS,
    mode: model.scale.mode,
    scaleMode: model.scale.scaleMode,
    shared: model.scale.shared,
    levelRatio: model.scale.levelRatio,
    observations: model.observations,
    gaps: model.gaps,
    emptyPanels: model.emptyPanels,
    flattenedPanels: model.flattenedPanels,
    flattenedLabels: model.panels.filter((p) => p.flattened).map((p) => p.label),
  };
}
