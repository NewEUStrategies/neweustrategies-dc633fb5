// Model mapy ciepła (macierzy) - wrażliwość wyniku na DWA parametry naraz.
//
// PO CO TEN RODZAJ ISTNIEJE. Tabela doboru formy z sekcji 1 specyfikacji
// przypisuje mapę ciepła pytaniu "Wrażliwość na dwa parametry", a w kolumnie
// "Czego unikać" stawia przy niej jedno hasło: "tabela liczb". To jest cała
// racja bytu tego modelu. Tabela 9 na 9 liczb zawiera dokładnie tę samą
// informację co mapa ciepła i jest od niej DOKŁADNIEJSZA, tylko że czytelnik
// nie zobaczy w niej tego, po co przyszedł: KIERUNKU, w którym wynik rośnie,
// i tego, KTÓRY z dwóch parametrów rusza nim mocniej. Osiemdziesiąt liczb
// czyta się po kolei, a gradient widzi się od razu. Mapa ciepła jest więc
// zamianą precyzji odczytu jednej komórki na czytelność całego pola - i to
// jest wymiana świadoma, dlatego dokładne liczby MUSZĄ zostać dostępne
// w tabeli danych pod wykresem (`heatmapTable`), a nie zniknąć razem
// z tabelą, którą mapa zastąpiła.
//
// CZEGO TEMU RODZAJOWI NIE WOLNO, czyli co ten moduł wymusza po stronie
// danych, zamiast liczyć na czujność autora:
//   * NIE WOLNO oddać LUKI jako zera. Komórka bez wartości i komórka
//     o wartości zero to dwa różne zdania: pierwsze mówi "nie policzono",
//     drugie "policzono i wyszło zero". Luka dostaje więc OSOBNY STAN
//     (`state: "gap"`, `t: null`), a nie pozycję na rampie - render ma
//     obowiązek narysować ją teksturą albo pustym polem, bo najjaśniejszy
//     stopień rampy jest już zajęty przez prawdziwą, najmniejszą wartość.
//     Pole `zeroInData` mówi wprost, kiedy ta kolizja jest realna;
//   * NIE WOLNO brać skali ROZBIEŻNEJ bez sensownego punktu zerowego.
//     Sekcja 2 kończy się zdaniem "skale sekwencyjne (jeden odcień, zmiana
//     jasności) do wielkości, rozbieżne (dwa odcienie, neutralny środek)
//     tylko gdy istnieje sensowny punkt zerowy". Rozbieżna rampa na danych
//     leżących całych po jednej stronie zera oddaje połowę odcieni pod
//     wartości, których nie ma, a czytelnik odczytuje z niej znak, którego
//     dane nie zawierają. Ten model o skali DECYDUJE (patrz `wybierzSkale`)
//     i nie zostawia decyzji renderowi, bo render nie widzi danych;
//   * NIE WOLNO zgubić znaku w jasności. Odwrotność poprzedniego: skala
//     sekwencyjna na danych o obu znakach koduje -5 i +5 dwoma odcieniami
//     tego samego koloru, więc "spadek" i "wzrost" różnią się wyłącznie
//     natężeniem. Wykrywa to `signEncodedOk`;
//   * NIE WOLNO wypuścić wartości poza zakres skali. Wartość przycięta do
//     domeny ma ten sam kolor co wartość na jej krańcu, czyli dwie różne
//     liczby wyglądają identycznie. Model przycina (inaczej render dostałby
//     pozycję poza rampą), ale przycięcie ZGŁASZA: `cell.clamped`
//     i `inDomainOk`;
//   * NIE WOLNO nazywać macierzą czegoś, co ma jeden wiersz albo jedną
//     kolumnę. Jeden wiersz to szereg, a szereg czyta się słupkami
//     poziomymi, w których wartość koduje DŁUGOŚĆ, czyli kanał z górnej
//     połowy hierarchii percepcyjnej - nasycenie jest w niej ostatnie.
//     Mapa ciepła z jednego wiersza to zejście o pięć kanałów w dół bez
//     żadnego zysku. Wykrywa to `matrixShapeOk`, i liczy przy tym wiersze
//     oraz kolumny NIEPUSTE, bo pięć wierszy, z których cztery są pustymi
//     rzędami luk, jest tym samym defektem co jeden wiersz.
//
// REGUŁY OGÓLNE ZE SPECYFIKACJI, KTÓRE GO DOTYCZĄ:
//   * sekcja 2 - "najważniejszą zmienną koduj pozycją, najmniej ważną
//     kolorem". Mapa ciepła jest jedynym rodzajem, w którym WARTOŚĆ jedzie
//     kolorem, a pozycją jadą dwa parametry; dlatego kolor musi tu być
//     policzony wyjątkowo starannie i dlatego liczba w komórce jest
//     pełnoprawnym nośnikiem, a nie ozdobą (patrz `valueLabelsFit`);
//   * sekcja 2 - rampa sekwencyjna to JEDEN odcień ze zmianą jasności, więc
//     model oddaje pozycję na rampie (`t` w zakresie 0..1) i slot odcienia,
//     a nie kolor. Żadnego hexa w tym pliku nie ma i nie może być: sekcja 9
//     stawia warunek "silnik rysujący nie zawiera ani jednego zapisanego na
//     sztywno koloru", bo inaczej tryb ciemny jest już zepsuty;
//   * sekcja 6 - "hover dodaje precyzję, nigdy nie niesie treści". Liczba
//     z komórki nie może istnieć wyłącznie w tooltipie, więc przy siatce
//     dość rzadkiej etykiety liczbowe idą do komórek, a przy gęstej -
//     do tabeli danych, nigdy w niebyt;
//   * sekcja 8 - "podaj n". Liczbą obserwacji mapy ciepła jest liczba
//     WYPEŁNIONYCH komórek (`filled`), nie rozmiar siatki; rozjazd
//     z zadeklarowanym `sampleSize` jest wykrywany arytmetycznie;
//   * sekcja 9 - druk wymusza tryb jasny, a wypełnienia o niskim kontraście
//     giną w skali szarości. To kolejny powód, dla którego luka nie może być
//     bladym stopniem rampy: w druku blady stopień i puste pole zbiegają się
//     do jednego, a tekstura zostaje.
//
// JEDNOSTKI. Wartości komórek są w jednostkach DANYCH. Pozycje `t` i `signed`
// są bezwymiarowe (0..1 i -1..1). Geometria komórki (`x`, `y`, `w`, `h`) jest
// w jednostkach WZGLĘDNYCH obszaru kreślenia: 0 to lewa albo górna krawędź,
// 1 to prawa albo dolna, więc render mnoży je przez swoją szerokość
// i wysokość i nie musi liczyć niczego sam. Siatka mapy ciepła jest
// równomierna z definicji (każda para parametrów zajmuje tyle samo miejsca,
// bo inaczej powierzchnia komórki zaczęłaby kodować wagę, której dane nie
// mają), więc `w` i `h` są stałe i wynoszą 1/kolumny oraz 1/wiersze. Pikseli
// w tym module nie ma; jedyne dwie stałe pikselowe (`HEATMAP_LABEL_CELL_MIN_W`
// i `HEATMAP_LABEL_CELL_MIN_H`) są PROGAMI dla renderu, a nie geometrią,
// i wchodzą do modelu wyłącznie przez `heatmapValueLabelFit`.
import type { ChartConfig } from "../types";
import { MAX_SERIES } from "../types";

/**
 * Minimalny rozmiar macierzy. Dwa na dwa, bo poniżej tego nie ma dwóch
 * parametrów: jeden wiersz to szereg (słupki poziome), jedna kolumna to ten
 * sam szereg obrócony, a jedna komórka to liczba w zdaniu.
 */
export const HEATMAP_MIN_ROWS = 2;
export const HEATMAP_MIN_COLUMNS = 2;

/**
 * Sufit czytelności siatki, w komórkach.
 *
 * LICZBA KOMÓREK DECYDUJE O CZYTELNOŚCI MAPY MOCNIEJ NIŻ COKOLWIEK INNEGO,
 * bo pole kreślenia jest stałe, a komórka dzieli je na tyle części, ile jest
 * par parametrów. Przy typowym polu 640 na 320 px siatka 24 na 25 daje
 * komórkę około 27 na 13 px: mniejszą niż cel dotykowy, węższą niż
 * dwucyfrowa liczba i tak niską, że obwódka komórki (1 px) zaczyna zjadać
 * jej powierzchnię. Powyżej sześciuset komórek mapa przestaje być macierzą
 * do odczytu i staje się teksturą do oglądania - wtedy sensowniejsze jest
 * zgrubienie siatki (mniej progów parametru) albo dwa przekroje liniowe.
 *
 * Sufit jest DORADCZY, nie przycinający (patrz `heatmapFormAdvice`): model
 * nie ma prawa wyrzucić danych, które autor policzył, bo wtedy tabela pod
 * wykresem przestałaby zgadzać się z arkuszem. Ostrzega i rysuje wszystko.
 */
export const HEATMAP_MAX_CELLS = 600;

/**
 * Powyżej tylu komórek trzeba ZREZYGNOWAĆ Z ETYKIET LICZBOWYCH w komórkach.
 *
 * Sto czterdzieści cztery to siatka 12 na 12. Przy polu 640 na 320 px daje
 * komórkę 53 na 27 px, czyli akurat tyle, ile potrzebuje liczba pisana
 * fontem osi (11 px, `FONT_AXIS` w `geometry.ts`) z marginesem 4 px ze skali
 * odstępów po każdej stronie: cztery znaki mieszczą się w 53 px z zapasem,
 * a wysokość wiersza 14 px w 27 px. Przy 13 na 13 komórka schodzi do 49 na
 * 25 px i liczba czterocyfrowa z separatorem tysięcy zaczyna dotykać
 * krawędzi, a etykieta dotykająca krawędzi łamie pierwsze z czterech
 * wymagań bezwzględnych ("nic nie jest ucięte").
 *
 * Próg z liczby komórek jest przybliżeniem wygodnym dla modelu, który nie
 * zna pikseli. Render, który zna swoje wymiary, ma dokładniejsze narzędzie:
 * `heatmapValueLabelFit`. Gdy oba się rozejdą, obowiązuje pomiar.
 *
 * REZYGNACJA Z LICZB W KOMÓRKACH NIE JEST REZYGNACJĄ Z LICZB. Sekcja 6 mówi
 * wprost: "jeśli liczba istnieje tylko w tooltipie, wykres jest niekompletny".
 * Przy gęstej siatce komplet liczb niesie `heatmapTable`, która jest zawsze
 * pod wykresem, a nie tooltip.
 */
export const HEATMAP_VALUE_LABEL_MAX_CELLS = 144;

/**
 * Minimalna szerokość i wysokość komórki (w px), przy której liczba wpisana
 * w komórkę jeszcze się w niej mieści. Font osi to 11 px, wysokość wiersza
 * około 14 px, margines 4 px ze skali odstępów sekcji 3 po każdej stronie;
 * cztery znaki fontem 11 px mają około 26 px, więc 40 px szerokości daje
 * zapas na separator tysięcy i znak minus. To jedyne dwie liczby pikselowe
 * w tym module i są PROGIEM, nie geometrią.
 */
export const HEATMAP_LABEL_CELL_MIN_W = 40;
export const HEATMAP_LABEL_CELL_MIN_H = 24;

/**
 * Udział wypełnionych komórek, poniżej którego mapa jest bardziej dziurą niż
 * macierzą. Połowa, bo przy mniejszym wypełnieniu gradient przestaje być
 * ciągły: oko łączy sąsiadujące wypełnione komórki w kierunek, którego
 * w danych nie ma, bo pomiędzy nimi nikt nic nie policzył. Taką siatkę
 * czyta się jako wykres punktowy dwóch parametrów, nie jako pole.
 */
export const HEATMAP_SPARSE_SHARE = 0.5;

/** Znak braku wartości - ten sam, którym `format.ts` oznacza lukę. */
const BRAK_LICZBY = "-";

/** Rodzaj skali koloru. Decyzja modelu, nie renderu - patrz `wybierzSkale`. */
export type HeatmapScaleType = "sequential" | "diverging";

/** Czego autor zażądał. "auto" znaczy "zdecyduj z danych". */
export type HeatmapScaleRequest = HeatmapScaleType | "auto";

/**
 * Stan komórki. Dwa stany, nie jeden z wartością nullable, bo render musi
 * mieć jawną gałąź na lukę: luka nie dostaje koloru z rampy, tylko własną
 * teksturę albo puste pole z obwódką.
 */
export type HeatmapCellState = "value" | "gap";

export interface HeatmapCell {
  /** Indeks wiersza, 0 na GÓRZE (pierwsza seria jest pierwszym wierszem). */
  row: number;
  /** Indeks kolumny, 0 po LEWEJ (pierwsza kategoria jest pierwszą kolumną). */
  column: number;
  rowLabel: string;
  columnLabel: string;
  /** Wartość w jednostkach danych. `null` = luka, NIE zero. */
  value: number | null;
  state: HeatmapCellState;
  /**
   * Pozycja na rampie, 0..1. `null` przy luce - i to jest najważniejszy
   * `null` w tym pliku, bo zero zamiast niego oddałoby luce najjaśniejszy
   * stopień rampy, czyli kolor prawdziwej najmniejszej wartości.
   */
  t: number | null;
  /**
   * Odchylenie od punktu neutralnego w zakresie -1..1, SYMETRYCZNE: równe
   * odchylenia w górę i w dół dostają równe natężenie koloru. `null` przy
   * luce i przy skali sekwencyjnej, która punktu neutralnego nie ma.
   *
   * Symetria jest tu warunkiem uczciwości, nie estetyką. Normalizacja
   * osobno po każdej stronie (dodatnie przez `max`, ujemne przez `|min|`)
   * daje przy zakresie od -1 do +9 ten sam nasyconą barwę dla -1 i dla +9,
   * więc czytelnik odczytuje spadek o jeden jako równie mocny co wzrost
   * o dziewięć. Dlatego mianownikiem jest WIĘKSZE z dwóch odchyleń.
   */
  signed: number | null;
  /**
   * Czy wartość została przycięta do domeny skali. Przycięcie znaczy, że dwie
   * różne liczby mają na rysunku ten sam kolor, więc jest defektem - patrz
   * `inDomainOk`.
   */
  clamped: boolean;
  /** Etykieta liczbowa do wpisania w komórkę. Przy luce znak braku. */
  text: string;
  /** Lewa krawędź komórki, 0..1 obszaru kreślenia. */
  x: number;
  /** Górna krawędź komórki, 0..1 obszaru kreślenia. */
  y: number;
  /** Szerokość komórki jako ułamek obszaru kreślenia. */
  w: number;
  /** Wysokość komórki jako ułamek obszaru kreślenia. */
  h: number;
}

export interface HeatmapScale {
  type: HeatmapScaleType;
  /** Czego zażądał autor - do porównania z tym, co model wybrał. */
  requested: HeatmapScaleRequest;
  /** Dolna i górna granica domeny koloru, w jednostkach danych. */
  min: number;
  max: number;
  /** Punkt neutralny skali rozbieżnej. `null` przy sekwencyjnej. */
  neutral: number | null;
  /** Większe z odchyleń od punktu neutralnego - mianownik `signed`. */
  spread: number;
  /**
   * Slot palety niosący ODCIEŃ rampy sekwencyjnej (1..MAX_SERIES). `null`
   * przy skali rozbieżnej, bo ta bierze parę semantyczną (ujemny, dodatni),
   * a nie kolor kategorii.
   */
  slot: number | null;
  /** Czy domena została wyliczona z danych (a nie podana z zewnątrz). */
  domainFromData: boolean;
}

/**
 * Oś macierzy razem ze swoimi sprawdzeniami uczciwości. Sprawdzenia siedzą
 * przy osi, której dotyczą, bo mapa ciepła ma DWIE osie kategorialne i pole
 * `duplicateLabelsOk` bez informacji, o którą oś chodzi, nie nadaje się do
 * pokazania czytelnikowi.
 */
export interface HeatmapAxis {
  labels: string[];
  /**
   * Liczby odczytane z etykiet - tylko gdy CAŁA oś jest liczbowa. `null`
   * przy osi nazwanej słownie (scenariusze, kraje, warianty).
   */
  numeric: number[] | null;
  /**
   * Czy etykiety są unikalne. `false` = dwa wiersze albo dwie kolumny mają
   * tę samą nazwę, czyli etykieta nie identyfikuje już swojej serii komórek
   * i czytelnik nie wie, którą wartość parametru czyta. `null` przy mniej
   * niż dwóch etykietach - nie ma czego porównać.
   */
  uniqueOk: boolean | null;
  /**
   * Czy każda etykieta ma treść. `false` = któryś wiersz albo kolumna jest
   * bez nazwy, więc komórki w niej nie mają przypisanej wartości parametru.
   * `null` przy pustej osi.
   */
  namedOk: boolean | null;
  /**
   * Czy oś LICZBOWA jest monotoniczna. `false` = progi parametru idą
   * w nieuporządkowanej kolejności (10, 30, 20), a wtedy gradient na
   * rysunku pokazuje zygzak, którego w zależności nie ma: oko czyta
   * z mapy ciepła KIERUNEK, więc oś, która nie ma kierunku, kłamie
   * kształtem. `null` przy osi nieliczbowej (wtedy nie ma czego uporządkować)
   * i przy mniej niż trzech etykietach (dwie są monotoniczne zawsze).
   */
  orderOk: boolean | null;
  /** Etykiety występujące więcej niż raz - do pokazania w ostrzeżeniu. */
  duplicates: string[];
}

/**
 * Brzeg macierzy: co mówi jeden wiersz albo jedna kolumna jako całość.
 * Brzegi są tu treścią, nie podsumowaniem: pytanie "wrażliwość na dwa
 * parametry" to w praktyce pytanie, KTÓRY z dwóch parametrów rusza wynikiem
 * mocniej, a odpowiedź na nie jest różnicą rozstępów brzegowych.
 */
export interface HeatmapMargin {
  label: string;
  /** Ile komórek w tym wierszu albo kolumnie ma wartość. */
  count: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  /** `max - min`; `null` gdy nie ma ani jednej wartości. */
  range: number | null;
}

export interface HeatmapModel {
  /** Komórki wiersz po wierszu, od lewej do prawej. */
  cells: HeatmapCell[];
  rows: number;
  columns: number;
  rowAxis: HeatmapAxis;
  columnAxis: HeatmapAxis;
  scale: HeatmapScale;
  /** Liczba komórek siatki (wiersze razy kolumny). */
  cellCount: number;
  /** Komórki z wartością - to jest `n` mapy ciepła. */
  filled: number;
  /** Komórki bez wartości. Luki, nie zera. */
  gaps: number;
  /**
   * Liczby, które nie trafiły w siatkę: wartości za ostatnią kolumną albo
   * wiersze za ostatnią serią. Każda taka liczba jest w danych i NIE MA JEJ
   * na rysunku ani w tabeli, więc jest defektem - patrz `inGridOk`.
   */
  valuesOutsideGrid: number;
  /** Wiersze i kolumny bez ani jednej wartości. */
  emptyRows: number;
  emptyColumns: number;
  /** Wiersze i kolumny, które NIOSĄ jakąkolwiek wartość. */
  effectiveRows: number;
  effectiveColumns: number;
  rowMargins: HeatmapMargin[];
  columnMargins: HeatmapMargin[];
  /**
   * Czy w danych jest prawdziwe ZERO. Nie jest to sprawdzenie uczciwości,
   * ale dyrektywa dla renderu: gdy zero występuje, jego kolor jest zajęty
   * przez wartość, więc luka MUSI dostać osobny nośnik (tekstura, puste
   * pole), a nie najjaśniejszy stopień rampy. Przy braku zera i braku luk
   * pytanie jest bezprzedmiotowe, ale reguła obowiązuje tak samo, bo render
   * nie ma dwóch trybów rysowania luki.
   */
  zeroInData: boolean;
  /**
   * Czy liczby zmieszczą się w komórkach przy tej gęstości siatki
   * (`HEATMAP_VALUE_LABEL_MAX_CELLS`). Render, który zna swoje piksele,
   * dokłada do tego `heatmapValueLabelFit`.
   */
  valueLabelsFit: boolean;

  // --- Sprawdzenia uczciwości. Konwencja repo: `null` = NIE MA CZEGO
  // --- SPRAWDZAĆ (model MILCZY, nie zaświadcza), `false` = wykryty defekt.

  /**
   * Czy to w ogóle macierz: co najmniej `HEATMAP_MIN_ROWS` niepustych
   * wierszy i `HEATMAP_MIN_COLUMNS` niepustych kolumn. `false` przy jednym
   * wierszu, jednej kolumnie oraz przy siatce, z której realnie zostało
   * jedno pasmo, bo reszta jest pustymi rzędami luk. `null` gdy nie ma ani
   * jednej wartości - nie ma jeszcze czego oceniać.
   */
  matrixShapeOk: boolean | null;
  /**
   * Czy skala ROZBIEŻNA ma w danych punkt zerowy. `false` = autor zażądał
   * rozbieżnej, a dane leżą całe po jednej stronie punktu neutralnego, więc
   * połowa rampy koduje wartości, których nie ma (model degraduje wtedy do
   * sekwencyjnej i nadal to zgłasza). `true` = skala jest rozbieżna i punkt
   * neutralny leży wewnątrz zakresu danych. `null` = nikt rozbieżnej nie
   * chciał i model jej nie wybrał, więc nie ma czego sprawdzać.
   */
  divergingJustifiedOk: boolean | null;
  /**
   * Czy znak wartości jest zakodowany czymś więcej niż jasnością. `false`
   * = dane mają oba znaki, a skala jest sekwencyjna, więc spadek i wzrost
   * różnią się wyłącznie natężeniem jednego odcienia. `null` = dane są
   * jednoznakowe, więc znak nie ma czego kodować.
   */
  signEncodedOk: boolean | null;
  /**
   * Czy wszystkie wartości mieszczą się w domenie skali. `false` = któraś
   * została przycięta, czyli dwie różne liczby mają ten sam kolor. `null`
   * = domena wyliczona z danych, więc z definicji je obejmuje i nie ma czego
   * sprawdzać (ta sama cisza co suma kontrolna mostka bez stanu końcowego).
   */
  inDomainOk: boolean | null;
  /**
   * Czy w danych jest ROZPROSZENIE. `false` = wszystkie wartości równe, więc
   * kolor nie niesie nic, a jednolite pole sugeruje pomiar, którego nie było.
   * `null` = brak wartości.
   */
  spreadOk: boolean | null;
  /**
   * Czy każda liczba z danych trafiła w siatkę. `false` = są wartości za
   * ostatnią kolumną albo za ostatnim wierszem, czyli liczby niewidoczne
   * nigdzie. `null` = w danych nie ma ani jednej liczby.
   */
  inGridOk: boolean | null;
  /**
   * Czy `sampleSize` z konfiguracji zgadza się z liczbą wypełnionych
   * komórek. Sekcja 8 każe podać `n` w podpisie; jeśli autor wpisał inne `n`,
   * niż jest policzonych par parametrów, podpis kłamie o próbce. `null`
   * = autor nie podał `n` albo nie ma wartości.
   */
  declaredSampleOk: boolean | null;
}

export interface HeatmapOptions {
  /**
   * Czego autor chce od skali. Domyślnie "auto", czyli decyduje model.
   * Żądanie "diverging" na danych bez punktu zerowego NIE jest spełniane -
   * model degraduje do sekwencyjnej i zgłasza defekt.
   */
  scale?: HeatmapScaleRequest;
  /**
   * Punkt neutralny skali rozbieżnej. Domyślnie zero. Sensowny punkt
   * neutralny nie zawsze jest zerem: przy macierzy wskaźnika
   * indeksowanego bazą 100 neutralnym jest scenariusz bazowy, czyli 100.
   */
  neutral?: number | null;
  /**
   * Domena koloru podana z zewnątrz - do porównywania kilku mapek jedną
   * skalą (small multiples). Model jej NIE rozszerza do danych: wartość poza
   * domeną jest defektem, a nie powodem do przeskalowania, bo ciche
   * rozszerzenie odbiera porównywalności sens, po który wspólną domenę się
   * podaje.
   */
  domain?: { min: number; max: number } | null;
  /** Slot palety niosący odcień rampy sekwencyjnej. Domyślnie 1. */
  colorSlot?: number;
  /**
   * Formatowanie liczby w komórce. Render wstrzykuje tu `formatChartValue`
   * związane z językiem i jednostką; domyślna implementacja jest bez Intl
   * i bez locale, żeby moduł został czysty.
   */
  formatValue?: (value: number) => string;
  /** `ChartConfig.sampleSize` - do sprawdzenia zgodności podpisu z próbką. */
  declaredSampleSize?: number | null;
}

/**
 * Domyślne formatowanie wartości komórki: ASCII, bez Intl, bez locale.
 *
 * OSŁONA NA NIELICZBĘ JEST TU OBOWIĄZKOWA, a nie ostrożnościowa:
 * `Intl.NumberFormat.format(NaN)` zwraca literalny napis "NaN", a bramka
 * `src/components/blocks/__tests__/blockMatrix.test.tsx` sprawdza
 * `textContent` bloków właśnie na obecność takich napisów. Model nieliczb
 * nie produkuje, więc ta gałąź nie ma prawa się wykonać - zostaje na wypadek
 * formatera wstrzykniętego z zewnątrz i zwraca ten sam znak braku, którym
 * `format.ts` oznacza lukę, żeby czytelnik widział spójny brak, a nie
 * techniczny bełkot.
 */
function domyslnyFormat(value: number): string {
  if (!Number.isFinite(value)) return BRAK_LICZBY;
  const abs = Math.abs(value);
  const miejsca = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return value.toFixed(miejsca);
}

/**
 * Odczyt wartości: wszystko, co nie jest skończoną liczbą, jest LUKĄ.
 * Rozróżnienie luki od zera jest w tym modelu osią wszystkiego, więc odczyt
 * ma jedno miejsce i nie sprowadza braku do zera nigdzie.
 */
function liczba(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Ostatnia osłona przed NaN i nieskończonością w polu liczbowym modelu.
 * Twarde wymaganie z zadania: model NIGDY nie zwraca NaN ani Infinity, bo
 * `Intl.NumberFormat.format(NaN)` wychodzi na stronie jako napis "NaN".
 * Każde dzielenie w tym pliku przechodzi albo przez jawną osłonę mianownika,
 * albo przez tę funkcję.
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
 * Liczba odczytana z etykiety osi - do sprawdzenia monotoniczności progów
 * parametru. Konserwatywnie: przecinek dziesiętny i procent na końcu
 * przechodzą, wszystko inne (kwartały, nazwy scenariuszy, przedziały
 * "10-20") daje `null`, bo z takiej osi nie da się wnioskować o kolejności,
 * a fałszywe rozpoznanie liczby dałoby ostrzeżenie o nieuporządkowanej osi
 * tam, gdzie porządku nie ma z natury.
 */
function liczbaZEtykiety(label: string): number | null {
  const oczyszczone = label
    .trim()
    .replace(/[\s\u00a0]/g, "")
    .replace(",", ".")
    .replace(/%$/, "");
  if (!/^[+-]?\d+(\.\d+)?$/.test(oczyszczone)) return null;
  const value = Number(oczyszczone);
  return Number.isFinite(value) ? value : null;
}

/** Oś razem ze swoimi sprawdzeniami. Wspólna dla wierszy i kolumn. */
function zbudujOs(labels: readonly string[]): HeatmapAxis {
  const kopia = labels.map((l) => l);
  if (kopia.length === 0) {
    return {
      labels: kopia,
      numeric: null,
      uniqueOk: null,
      namedOk: null,
      orderOk: null,
      duplicates: [],
    };
  }

  const widziane = new Map<string, number>();
  for (const label of kopia) {
    const klucz = label.trim();
    widziane.set(klucz, (widziane.get(klucz) ?? 0) + 1);
  }
  const duplicates = [...widziane.entries()].filter(([, ile]) => ile > 1).map(([label]) => label);

  // Etykieta pusta nie identyfikuje wiersza ani kolumny, więc jest osobnym
  // defektem od duplikatu: duplikat mówi "dwie te same nazwy", brak nazwy
  // mówi "nie wiadomo, jaka wartość parametru". Dwie puste etykiety trafiają
  // do obu sprawdzeń jednocześnie i to jest poprawne.
  const namedOk = kopia.every((label) => label.trim() !== "");

  const numeryczne = kopia.map((label) => liczbaZEtykiety(label));
  const numeric = numeryczne.every((n): n is number => n !== null) ? numeryczne : null;

  // MONOTONICZNOŚĆ SPRAWDZANA OD TRZECH ETYKIET. Dwie etykiety są
  // monotoniczne zawsze, więc sprawdzenie na dwóch zaświadczałoby o porządku,
  // którego nie badało - a umowa modelu mówi, że przy braku czego sprawdzać
  // milczy.
  let orderOk: boolean | null = null;
  if (numeric !== null && numeric.length >= 3) {
    let rosnie = true;
    let maleje = true;
    for (let i = 1; i < numeric.length; i++) {
      if (numeric[i] < numeric[i - 1]) rosnie = false;
      if (numeric[i] > numeric[i - 1]) maleje = false;
    }
    orderOk = rosnie || maleje;
  }

  return {
    labels: kopia,
    numeric,
    uniqueOk: kopia.length >= 2 ? duplicates.length === 0 : null,
    namedOk,
    orderOk,
    duplicates,
  };
}

/** Brzeg macierzy z jednego pasma wartości. Osłona na puste pasmo. */
function brzeg(label: string, values: readonly number[]): HeatmapMargin {
  if (values.length === 0) {
    return { label, count: 0, min: null, max: null, mean: null, range: null };
  }
  let min = values[0];
  let max = values[0];
  let suma = 0;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
    suma += v;
  }
  // Mianownik jest tu z definicji dodatni (pasmo niepuste), ale dzielenie
  // przechodzi przez `pewna`, bo suma nieskończoności przy wartościach
  // wstrzykniętych z zewnątrz dałaby NaN, a bramka `blockMatrix` czyta ten
  // napis wprost ze strony.
  return {
    label,
    count: values.length,
    min,
    max,
    mean: pewna(suma / values.length),
    range: pewna(max - min),
  };
}

/**
 * WYBÓR SKALI - to jest miejsce, w którym model wykonuje regułę z sekcji 2
 * specyfikacji zamiast zostawiać ją renderowi.
 *
 * Reguła brzmi: sekwencyjna (jeden odcień, zmiana jasności) do wielkości,
 * rozbieżna (dwa odcienie, neutralny środek) TYLKO gdy istnieje sensowny
 * punkt zerowy. "Sensowny punkt zerowy" nie jest cechą jednostki ani gustu
 * autora, tylko faktem o danych: punkt neutralny musi leżeć WEWNĄTRZ
 * zakresu wartości. Gdy leży na krańcu albo poza nim, wszystkie wartości są
 * po jednej stronie i połowa rampy zostaje pusta, a rozbieżna rampa
 * z niewykorzystaną połową czyta się tak, jakby wartości ujemnych po prostu
 * nie było W TYM WYCINKU macierzy, co jest zdaniem o danych, którego dane
 * nie potwierdzają.
 *
 * Dlaczego decyduje model, a nie render: render widzi konfigurację i piksele,
 * nie widzi rozkładu wartości. Zostawienie mu tej decyzji znaczy w praktyce
 * oddanie jej autorowi bloku, a autor wybiera skalę raz i zapomina o niej,
 * gdy dane się zmienią - a wtedy ta sama mapa z rozbieżną rampą pokazuje
 * po aktualizacji danych zero, którego już w nich nie ma.
 */
function wybierzSkale(
  request: HeatmapScaleRequest,
  dataMin: number,
  dataMax: number,
  neutral: number,
  hasValues: boolean,
): { type: HeatmapScaleType; justified: boolean | null } {
  // Punkt neutralny STRICTLY wewnątrz zakresu. Nierówność nieostra
  // przepuszczałaby macierz o wartościach od 0 do 9 jako "rozbieżną wokół
  // zera", a taka macierz nie ma ani jednej wartości ujemnej.
  const straddles = hasValues && dataMin < neutral && neutral < dataMax;
  if (request === "sequential") {
    return { type: "sequential", justified: null };
  }
  if (request === "diverging") {
    // Żądanie niespełnialne: degradacja do sekwencyjnej PLUS zgłoszenie.
    // Milczące spełnienie żądania byłoby defektem, a milcząca degradacja
    // zostawiłaby autora z przekonaniem, że patrzy na rampę rozbieżną.
    return { type: straddles ? "diverging" : "sequential", justified: straddles };
  }
  return straddles
    ? { type: "diverging", justified: true }
    : { type: "sequential", justified: null };
}

/**
 * Model mapy ciepła. Wejściem są etykiety obu osi i siatka wartości wiersz po
 * wierszu - dokładnie to, co silnik ma w `ChartConfig` (serie jako wiersze,
 * kategorie jako kolumny), rozpięte na czysty kształt, żeby model dał się
 * zbudować także z macierzy przyszłego edytora.
 */
export function heatmapModel(
  rowLabels: readonly string[],
  columnLabels: readonly string[],
  values: readonly (readonly (number | null)[])[],
  opts: HeatmapOptions = {},
): HeatmapModel {
  const rowAxis = zbudujOs(rowLabels);
  const columnAxis = zbudujOs(columnLabels);
  const rows = rowAxis.labels.length;
  const columns = columnAxis.labels.length;
  const cellCount = rows * columns;
  const format = opts.formatValue ?? domyslnyFormat;
  const request: HeatmapScaleRequest = opts.scale ?? "auto";
  const slot = przytnij(Math.round(opts.colorSlot ?? 1), 1, MAX_SERIES);

  // ODCZYT SIATKI. Osobno od rysowania, bo domena skali musi być znana,
  // zanim policzymy pozycję pierwszej komórki na rampie.
  const grid: (number | null)[][] = [];
  let filled = 0;
  let dataMin = 0;
  let dataMax = 0;
  let zeroInData = false;
  for (let r = 0; r < rows; r++) {
    const wiersz: (number | null)[] = [];
    for (let c = 0; c < columns; c++) {
      const v = liczba(values[r]?.[c]);
      wiersz.push(v);
      if (v === null) continue;
      if (filled === 0) {
        dataMin = v;
        dataMax = v;
      } else {
        if (v < dataMin) dataMin = v;
        if (v > dataMax) dataMax = v;
      }
      if (v === 0) zeroInData = true;
      filled++;
    }
    grid.push(wiersz);
  }

  // LICZBY, KTÓRE NIE TRAFIŁY W SIATKĘ. Wiersz dłuższy niż liczba kategorii
  // albo więcej wierszy niż etykiet znaczy, że blok pochodzi z innej wersji
  // edytora niż siatka etykiet - i te wartości nie są nigdzie widoczne, ani
  // na rysunku, ani w tabeli danych. Wiersz KRÓTSZY nie jest tu defektem:
  // brakujący ogon to luki, a luka jest legalnym stanem komórki.
  let valuesOutsideGrid = 0;
  for (let r = 0; r < values.length; r++) {
    const wiersz = values[r];
    if (!wiersz) continue;
    const od = r < rows ? columns : 0;
    for (let c = od; c < wiersz.length; c++) {
      if (liczba(wiersz[c]) !== null) valuesOutsideGrid++;
    }
  }

  const neutral = liczba(opts.neutral) ?? 0;
  const { type, justified } = wybierzSkale(request, dataMin, dataMax, neutral, filled > 0);

  // DOMENA. Podana z zewnątrz służy porównywalności kilku mapek, więc model
  // jej nie rozszerza do danych; wartość poza nią jest defektem do zgłoszenia,
  // nie powodem do cichego przeskalowania.
  const podana = opts.domain ?? null;
  const domainPodana =
    podana !== null &&
    liczba(podana.min) !== null &&
    liczba(podana.max) !== null &&
    podana.min < podana.max;
  const domainMin = domainPodana ? podana.min : dataMin;
  const domainMax = domainPodana ? podana.max : dataMax;
  // Rozpiętość domeny bywa zerem (jedna wartość powtórzona w całej macierzy),
  // więc jest jawnie osłonięta przy każdym dzieleniu niżej.
  const rozpietosc = domainMax - domainMin;
  const spread =
    type === "diverging"
      ? Math.max(Math.abs(domainMax - neutral), Math.abs(neutral - domainMin))
      : 0;

  // Geometria względna. Mianowniki osłonięte, bo macierz pusta (zero wierszy
  // albo zero kolumn) jest realnym wejściem z bazy, a 1/0 to Infinity, które
  // wypłynęłoby do atrybutów SVG.
  const w = columns > 0 ? 1 / columns : 0;
  const h = rows > 0 ? 1 / rows : 0;

  const cells: HeatmapCell[] = [];
  let clampedCount = 0;
  const rowValues: number[][] = Array.from({ length: rows }, () => []);
  const columnValues: number[][] = Array.from({ length: columns }, () => []);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const value = grid[r][c];
      const wspolne = {
        row: r,
        column: c,
        rowLabel: rowAxis.labels[r] ?? "",
        columnLabel: columnAxis.labels[c] ?? "",
        x: pewna(c * w),
        y: pewna(r * h),
        w: pewna(w),
        h: pewna(h),
      };

      if (value === null) {
        // LUKA. Osobny stan i `t: null`, nie zero - patrz nagłówek pliku.
        cells.push({
          ...wspolne,
          value: null,
          state: "gap",
          t: null,
          signed: null,
          clamped: false,
          text: BRAK_LICZBY,
        });
        continue;
      }

      rowValues[r].push(value);
      columnValues[c].push(value);

      const clamped = value < domainMin || value > domainMax;
      if (clamped) clampedCount++;
      const wDomenie = przytnij(value, domainMin, domainMax);

      let t: number;
      let signed: number | null = null;
      if (type === "diverging") {
        // Mianownikiem jest WIĘKSZE odchylenie od punktu neutralnego, więc
        // równe odchylenia w obie strony dostają równe natężenie. Przy
        // odchyleniu zerowym (cała macierz równa punktowi neutralnemu) rampa
        // nie ma czego rozłożyć i wszystko siada na środku.
        signed = spread > 0 ? przytnij((wDomenie - neutral) / spread, -1, 1) : 0;
        t = przytnij(0.5 + signed / 2, 0, 1);
      } else if (rozpietosc > 0) {
        t = przytnij((wDomenie - domainMin) / rozpietosc, 0, 1);
      } else {
        // BRAK ROZPROSZENIA. Rampa nie ma czego rozłożyć, więc każda komórka
        // dostaje ŚRODEK, a nie kraniec: najjaśniejszy stopień powiedziałby
        // "wszędzie mało", najciemniejszy "wszędzie dużo", a prawda jest, że
        // porównania nie ma. Defekt zgłasza `spreadOk`, po którym render
        // dokłada podpis i wypisuje liczby.
        t = 0.5;
      }

      cells.push({
        ...wspolne,
        value,
        state: "value",
        t: pewna(t),
        signed: signed === null ? null : pewna(signed),
        clamped,
        text: format(value),
      });
    }
  }

  const rowMargins = rowAxis.labels.map((label, r) => brzeg(label, rowValues[r] ?? []));
  const columnMargins = columnAxis.labels.map((label, c) => brzeg(label, columnValues[c] ?? []));
  const emptyRows = rowMargins.filter((m) => m.count === 0).length;
  const emptyColumns = columnMargins.filter((m) => m.count === 0).length;
  const effectiveRows = rows - emptyRows;
  const effectiveColumns = columns - emptyColumns;
  const gaps = cellCount - filled;

  // ZNAK ZAKODOWANY JASNOŚCIĄ. Sprawdzane po WYBORZE skali, bo pytanie
  // brzmi "czy to, co narysujemy, unosi znak", a nie "czy dane mają znak".
  const obaZnaki = filled > 0 && dataMin < 0 && dataMax > 0;
  const signEncodedOk = obaZnaki ? type === "diverging" : null;

  const declared = liczba(opts.declaredSampleSize);

  return {
    cells,
    rows,
    columns,
    rowAxis,
    columnAxis,
    scale: {
      type,
      requested: request,
      min: pewna(domainMin),
      max: pewna(domainMax),
      neutral: type === "diverging" ? pewna(neutral) : null,
      spread: pewna(spread),
      slot: type === "sequential" ? slot : null,
      domainFromData: !domainPodana,
    },
    cellCount,
    filled,
    gaps,
    valuesOutsideGrid,
    emptyRows,
    emptyColumns,
    effectiveRows,
    effectiveColumns,
    rowMargins,
    columnMargins,
    zeroInData,
    valueLabelsFit: cellCount > 0 && cellCount <= HEATMAP_VALUE_LABEL_MAX_CELLS,
    matrixShapeOk:
      filled === 0
        ? null
        : effectiveRows >= HEATMAP_MIN_ROWS && effectiveColumns >= HEATMAP_MIN_COLUMNS,
    divergingJustifiedOk: justified,
    signEncodedOk,
    // Domena z danych obejmuje je z definicji, więc sprawdzanie jej byłoby
    // sprawdzaniem własnej arytmetyki - a to jest pułapka opisana przy sumie
    // udziałów w `pieModel`. Model milczy dokładnie wtedy, gdy nie ma czego
    // wykryć.
    inDomainOk: domainPodana && filled > 0 ? clampedCount === 0 : null,
    spreadOk: filled === 0 ? null : dataMax > dataMin,
    inGridOk: filled === 0 && valuesOutsideGrid === 0 ? null : valuesOutsideGrid === 0,
    declaredSampleOk: declared === null || filled === 0 ? null : declared === filled,
  };
}

/**
 * Model z konfiguracji bloku - degradacja OBECNEGO kształtu do macierzy.
 *
 * SERIA JEST WIERSZEM, KATEGORIA KOLUMNĄ, i to jest jedyne odwzorowanie,
 * które nie wymaga rozszerzenia schematu: `series[i].values[j]` jest już
 * siatką dwuwymiarową, tylko nikt jej dotąd tak nie czytał. Wiersz pierwszy
 * jest na górze, bo lista serii w edytorze jest czytana od góry i mapa musi
 * zgadzać się z kolejnością, którą autor widzi przy wpisywaniu.
 *
 * CZEGO TEN KSZTAŁT NIE WYRAŻA: nazw obu parametrów (są tytuły osi, a nie ma
 * na nie pola), jawnego punktu neutralnego innego niż zero oraz limitu
 * wierszy - `MAX_SERIES` wynosi osiem, bo tyle jest slotów palety, a mapa
 * ciepła slotów kategorialnych nie używa w ogóle (bierze jedną rampę), więc
 * ośmiowierszowy sufit jest dla niej ograniczeniem przypadkowym. Wszystkie
 * trzy braki są opisane w raporcie jako wymaganie do silnika; model działa
 * bez nich, tylko punkt neutralny musi wtedy przyjść przez `opts`.
 *
 * `colorSlot` PIERWSZEJ serii wybiera odcień rampy sekwencyjnej. Sloty
 * pozostałych serii są przy mapie ciepła bez znaczenia i to nie jest
 * przeoczenie: gdyby każdy wiersz miał własny odcień, kolor kodowałby
 * jednocześnie wiersz i wartość, czyli dwie rzeczy jednym kanałem.
 */
export function heatmapModelFromConfig(
  config: ChartConfig,
  opts: HeatmapOptions = {},
): HeatmapModel {
  const rowLabels = config.series.map((s) => s.name);
  const values = config.series.map((s) => s.values);
  return heatmapModel(rowLabels, config.categories, values, {
    colorSlot: config.series[0]?.colorSlot ?? 1,
    declaredSampleSize: config.sampleSize,
    ...opts,
  });
}

/**
 * Zakres LEGENDY koloru, czyli domena skali. Osobna funkcja, bo render
 * potrzebuje jej do podziałki paska legendy i nie ma prawa liczyć jej sam -
 * legenda z inną domeną niż komórki jest kłamstwem, którego nikt nie zauważy.
 *
 * Zero NIE jest tu wymuszane, i to jest różnica wobec słupków z sekcji 8:
 * słupek koduje wartość długością od zera, a komórka koduje ją kolorem, więc
 * ucięcie skali koloru nie zniekształca żadnej proporcji. Ucina natomiast
 * rozdzielczość, dlatego domena idzie z danych, a nie z ładnej podziałki.
 */
export function heatmapExtent(model: HeatmapModel): { min: number; max: number } {
  return { min: pewna(model.scale.min), max: pewna(model.scale.max) };
}

/**
 * Czy liczby zmieszczą się w komórkach PRZY ZNANYCH PIKSELACH. Model liczy
 * gęstość siatki (`valueLabelsFit`), render zna swoje wymiary - a przy
 * wąskim ekranie te dwie odpowiedzi się rozchodzą i wtedy obowiązuje pomiar.
 * Wywołanie bez wymiarów wraca do progu z liczby komórek.
 */
export function heatmapValueLabelFit(
  model: HeatmapModel,
  size?: { cellWidth: number; cellHeight: number },
): boolean {
  if (!model.valueLabelsFit) return false;
  if (!size) return true;
  const szer = liczba(size.cellWidth) ?? 0;
  const wys = liczba(size.cellHeight) ?? 0;
  return szer >= HEATMAP_LABEL_CELL_MIN_W && wys >= HEATMAP_LABEL_CELL_MIN_H;
}

export type HeatmapFormAdvice =
  "notMatrix" | "tooManyCells" | "sparse" | "noSpread" | "divergingDowngraded" | "unorderedAxis";

/**
 * Kiedy mapa ciepła jest ZŁYM WYBOREM formy - odpowiednik `pieFormAdvice`
 * i `histogramFormAdvice`. Osobno od sprawdzeń uczciwości, bo tu nie zawsze
 * jest defekt arytmetyczny: dane bywają w porządku, a forma o nich kłamie
 * kształtem albo po prostu nic nie pokazuje.
 *
 *   * `notMatrix` - jeden wiersz albo jedna kolumna niosą dane; wartość
 *     powinna jechać DŁUGOŚCIĄ (słupki poziome, posortowane), a nie
 *     nasyceniem, które jest w hierarchii percepcyjnej przedostatnie;
 *   * `tooManyCells` - powyżej `HEATMAP_MAX_CELLS` komórka schodzi pod cel
 *     dotykowy i pod szerokość liczby; zgrub siatkę albo pokaż dwa przekroje;
 *   * `sparse` - mniej niż `HEATMAP_SPARSE_SHARE` komórek ma wartość, więc
 *     gradient jest zszywany przez dziury i pokazuje kierunek, którego nikt
 *     nie policzył; przy takim wypełnieniu uczciwszy jest wykres punktowy;
 *   * `noSpread` - wszystkie wartości równe; kolor nie niesie nic, a jedno
 *     zdanie mówi to samo bez rysunku;
 *   * `divergingDowngraded` - autor chciał rampy rozbieżnej, a dane nie mają
 *     punktu zerowego; model zszedł do sekwencyjnej i mówi o tym wprost;
 *   * `unorderedAxis` - oś liczbowa nie jest monotoniczna, więc gradient
 *     rysuje zygzak zamiast kierunku; posortuj progi parametru.
 */
export function heatmapFormAdvice(model: HeatmapModel): HeatmapFormAdvice[] {
  const advice: HeatmapFormAdvice[] = [];
  if (model.filled === 0) return advice;
  if (model.matrixShapeOk === false) advice.push("notMatrix");
  if (model.cellCount > HEATMAP_MAX_CELLS) advice.push("tooManyCells");
  // Udział wypełnienia liczony z osłoną mianownika: `cellCount` bywa zerem
  // przy macierzy bez etykiet, a wtedy funkcja i tak wyszła wyżej.
  if (model.cellCount > 0 && model.filled / model.cellCount < HEATMAP_SPARSE_SHARE) {
    advice.push("sparse");
  }
  if (model.spreadOk === false) advice.push("noSpread");
  if (model.divergingJustifiedOk === false) advice.push("divergingDowngraded");
  if (model.rowAxis.orderOk === false || model.columnAxis.orderOk === false) {
    advice.push("unorderedAxis");
  }
  return advice;
}

export interface HeatmapTableCell {
  columnLabel: string;
  value: number | null;
  state: HeatmapCellState;
  /** Ta sama etykieta, którą niesie komórka na rysunku. */
  text: string;
}

export interface HeatmapTableRow {
  label: string;
  cells: HeatmapTableCell[];
  /** Brzeg wiersza: ile, od ile do ile, średnio i jaki rozstęp. */
  margin: HeatmapMargin;
}

/**
 * Który parametr rusza wynikiem mocniej. `null` = nie da się rozstrzygnąć
 * (za mało niepustych wierszy albo kolumn), `"tie"` = różnica poniżej progu
 * rozstrzygalności.
 */
export type HeatmapDominantAxis = "rows" | "columns" | "tie" | null;

export interface HeatmapTable {
  /** Nagłówek tabeli: etykiety kolumn w kolejności rysowania. */
  columnLabels: string[];
  rows: HeatmapTableRow[];
  columnMargins: HeatmapMargin[];
  scale: HeatmapScale;
  filled: number;
  gaps: number;
  /**
   * Rozstęp ŚREDNICH wierszowych i kolumnowych - miara tego, ile wnosi każdy
   * z dwóch parametrów. Obie liczby jadą do tabeli, bo wniosek "wynik jest
   * wrażliwszy na parametr X" musi być odczytywalny z liczb, a nie tylko
   * z gradientu.
   */
  rowMeanRange: number | null;
  columnMeanRange: number | null;
  dominantAxis: HeatmapDominantAxis;
}

/**
 * Próg rozstrzygalności dominacji parametru, jako UŁAMEK większego
 * z rozstępów. Pięć procent, bo poniżej tego różnica dwóch rozstępów
 * średnich jest w granicach szumu zaokrągleń arkusza, z którego przyszły
 * dane, a zdanie "wynik jest wrażliwszy na X niż na Y" postawione na takiej
 * różnicy jest zdaniem o zaokrągleniu, nie o zależności.
 */
export const HEATMAP_DOMINANCE_TOLERANCE = 0.05;

/**
 * ALTERNATYWA TEKSTOWA: co ma pokazać tabela danych pod wykresem. Grafika
 * nigdy nie jest jedyną drogą do liczby - z komórki mapy ciepła nie odczyta
 * się wartości dokładniej niż "ciemniejsza niż tamta", wydruk w skali
 * szarości spłaszcza rampę, a czytnik ekranowy nie widzi koloru w ogóle.
 *
 * TABELA JEST TU CZYMŚ WIĘCEJ NIŻ ZAPISEM RYSUNKU, i to jest jej
 * najważniejsza cecha. Kolumna "Czego unikać" zabrania przy tym pytaniu
 * "tabeli liczb", więc tabela pod mapą nie może być tą samą tabelą, którą
 * mapa zastąpiła: dokłada BRZEGI (ile, od ile do ile, średnio, rozstęp
 * w każdym wierszu i w każdej kolumnie) oraz rozstrzygnięcie, KTÓRY
 * parametr rusza wynikiem mocniej. To jest odpowiedź na pytanie analityczne
 * podana liczbą, a nie kierunkiem gradientu - i dopiero razem z nią mapa
 * ciepła przestaje być ładniejszą tabelą.
 *
 * Luki jadą do tabeli jako luki (`state: "gap"`, znak braku), a nie zera,
 * dokładnie tak samo jak na rysunku. Tabela i mapa muszą kłamać tak samo
 * albo nie kłamać wcale, bo rozjazd między nimi jest defektem samym w sobie.
 */
export function heatmapTable(model: HeatmapModel): HeatmapTable {
  const rows: HeatmapTableRow[] = model.rowAxis.labels.map((label, r) => ({
    label,
    cells: model.cells
      .filter((cell) => cell.row === r)
      .map((cell) => ({
        columnLabel: cell.columnLabel,
        value: cell.value,
        state: cell.state,
        text: cell.text,
      })),
    margin: model.rowMargins[r] ?? brzeg(label, []),
  }));

  const rowMeanRange = rozstepSrednich(model.rowMargins);
  const columnMeanRange = rozstepSrednich(model.columnMargins);

  return {
    columnLabels: model.columnAxis.labels.map((l) => l),
    rows,
    columnMargins: model.columnMargins,
    scale: model.scale,
    filled: model.filled,
    gaps: model.gaps,
    rowMeanRange,
    columnMeanRange,
    dominantAxis: dominujacaOs(rowMeanRange, columnMeanRange),
  };
}

/**
 * Rozstęp średnich brzegowych. Liczony TYLKO ze pasm niepustych i tylko gdy
 * są co najmniej dwa: rozstęp z jednego pasma jest zerem, a zero podane jako
 * "ten parametr nic nie zmienia" byłoby wnioskiem z braku danych.
 */
function rozstepSrednich(margins: readonly HeatmapMargin[]): number | null {
  const srednie = margins
    .map((m) => m.mean)
    .filter((mean): mean is number => mean !== null && Number.isFinite(mean));
  if (srednie.length < 2) return null;
  let min = srednie[0];
  let max = srednie[0];
  for (const s of srednie) {
    if (s < min) min = s;
    if (s > max) max = s;
  }
  return pewna(max - min);
}

/**
 * Który parametr dominuje. Porównanie względne, nie bezwzględne: różnica
 * rozstępów jest ważona większym z nich, bo ta sama różnica 0,2 znaczy co
 * innego przy rozstępach 0,3 i 0,5, a co innego przy 30 i 30,2.
 */
function dominujacaOs(rowRange: number | null, columnRange: number | null): HeatmapDominantAxis {
  if (rowRange === null || columnRange === null) return null;
  const wieksze = Math.max(rowRange, columnRange);
  // Oba rozstępy zerowe znaczą, że żaden parametr nic nie zmienia (macierz
  // bez rozproszenia) - i wtedy nie ma dominacji, jest remis. Osłona
  // mianownika jest tu obowiązkowa, bo `wieksze` bywa zerem.
  if (wieksze <= 0) return "tie";
  const roznica = Math.abs(rowRange - columnRange) / wieksze;
  if (!Number.isFinite(roznica) || roznica < HEATMAP_DOMINANCE_TOLERANCE) return "tie";
  return rowRange > columnRange ? "rows" : "columns";
}
