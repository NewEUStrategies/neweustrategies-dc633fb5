// Model histogramu - rozkład wartości JEDNEJ zmiennej.
//
// PO CO TEN RODZAJ ISTNIEJE. Tabela doboru formy z sekcji 1 specyfikacji
// przypisuje histogram (obok boxplotu i beeswarma) pytaniu "Rozkład
// wartości", a w kolumnie "Czego unikać" stawia przy nim jedno hasło:
// "średnia bez rozproszenia". To jest cała racja bytu tego modelu. Średnia
// jest JEDNĄ liczbą i wygląda identycznie dla zbioru skupionego wokół niej
// i dla zbioru rozstrzelonego na dwa bieguny, a te dwa zbiory znaczą co
// innego i prowadzą do innych decyzji. Histogram pokazuje KSZTAŁT: gdzie
// leży masa, czy szczyt jest jeden czy dwa, jak długi jest ogon.
//
// CZEGO TEMU RODZAJOWI NIE WOLNO, czyli co ten moduł wymusza po stronie
// danych, zamiast liczyć na czujność autora:
//   * NIE WOLNO oddawać samej średniej. Alternatywa tekstowa (`histogramTable`)
//     podaje ZAWSZE komplet pozycyjny - min, Q1, mediana, Q3, max, IQR - obok
//     średniej, bo tabela pod wykresem popełniałaby inaczej dokładnie ten
//     błąd, przed którym histogram miał chronić;
//   * NIE WOLNO przyjmować kategorii jako gotowych przedziałów. Wejściem są
//     SUROWE OBSERWACJE, a przedziały wylicza reguła. Autor, który wpisuje
//     własne przedziały, wybiera jednocześnie kształt rozkładu: te same dane
//     w trzech przedziałach mają jeden szczyt, a w dwunastu dwa. Dlatego
//     `edges` w opcjach jest wyjściem awaryjnym z własnym zestawem
//     sprawdzeń, a nie drogą domyślną;
//   * NIE WOLNO kodować wysokością licznosci, gdy przedziały są NIERÓWNE -
//     patrz `valueEncodes` niżej;
//   * NIE WOLNO rysować histogramu z dwóch serii naraz. Dwie serie to dwie
//     populacje, a ich zsypanie do wspólnych przedziałów daje rozkład
//     zbiorowiska, którego nikt nie badał. Model czyta jedną serię i mówi
//     wprost, ile pominął (`ignoredSeries`); dwie populacje to small
//     multiples, czyli dwa bloki.
//
// REGUŁY OGÓLNE ZE SPECYFIKACJI, KTÓRE GO DOTYCZĄ:
//   * sekcja 8 - oś wartości słupków ZAWSZE od zera; histogram jest słupkowy,
//     więc `histogramExtent` startuje w zerze bez wyjątku. Z tej samej sekcji
//     "podaj n": liczba obserwacji jest polem modelu, a nie ozdobą podpisu,
//     i rozjazd z zadeklarowanym `sampleSize` jest wykrywany arytmetycznie;
//   * sekcja 3 - słupki histogramu przylegają do siebie, bo przedziały są
//     ciągłe; podstawa zostaje kwadratowa, zaokrągla się wyłącznie koniec
//     danych, a prześwit między słupkami jest prześwitem RYSUNKU (`BAR_GAP`),
//     nie przerwą w danych. Model nie zna pikseli, więc oddaje krawędzie
//     w jednostkach danych i `domain`, po którym render je przeskaluje;
//   * sekcja 2 - histogram jest jednoseryjny, więc blady wariant wypełnienia
//     jest dla niego wariantem docelowym: tożsamość niesie obwódka, a nie ma
//     drugiej serii, z którą blade wnętrze mogłoby się zlać;
//   * sekcja 6 - strefa trafienia to cała kolumna przedziału, od góry obszaru
//     kreślenia do linii zera; słupek jednego przedziału o licznosci 1 jest
//     inaczej nietrafialny.
//
// GĘSTOŚĆ, NIE LICZNOŚĆ, PRZY NIERÓWNYCH PRZEDZIAŁACH - i to jest jedyna
// nieoczywista arytmetyka w tym pliku. Oko czyta ze słupka POWIERZCHNIĘ tak
// samo jak wysokość, a przy nierównych przedziałach te dwie rzeczy przestają
// mówić to samo: przedział dwa razy szerszy zbiera przy tej samej gęstości
// dwa razy więcej obserwacji, więc słupek licznosci wyskakuje dwa razy wyżej
// i sugeruje szczyt, którego w rozkładzie nie ma. Dlatego przy przedziałach
// nierównych `plotValue` niesie GĘSTOŚĆ `count / (n * width)`, przy której
// POLE słupka równa się udziałowi obserwacji, a suma pól wszystkich słupków
// równa się jedności. Przy przedziałach równych gęstość jest licznością
// przemnożoną przez stałą, więc wysokość jest już uczciwa i `plotValue` to
// wprost licznosć - bo licznosć czyta się bez tłumaczenia, a gęstość
// wymagałaby podpisu przy osi. `valueEncodes` mówi renderowi, którą z tych
// dwóch rzeczy trzyma w ręku, i to on ma obowiązek nazwać to na osi.
//
// JEDNOSTKI. `from`, `to`, `width` i `domain` są w jednostkach DANYCH (osi
// poziomej), `count` w sztukach, `share` w zakresie 0..1, `density`
// w jednostkach "udział na jednostkę danych". Pikseli w tym module nie ma.
import type { ChartConfig } from "../types";

/**
 * Sufit liczby przedziałów. TWARDY, bo reguła Freedmana-Diaconisa nie ma
 * własnego ograniczenia górnego: przy rozkładzie z wąskim rdzeniem i jednym
 * odległym wyrzutkiem (IQR rzędu tysięcznych, zakres rzędu milionów) wychodzi
 * z niej sześciocyfrowa liczba przedziałów, czyli tyle słupków o zerowej
 * licznosci, że rysunek jest pustą płytą z jednym pikselem przy krawędzi.
 *
 * SZEŚĆDZIESIĄT, bo tyle wynosi `MAX_CATEGORIES` w `parse.ts` - histogram
 * rysuje słupki tym samym rusztowaniem co wykres słupkowy, więc nie ma prawa
 * zamawiać więcej znaczników, niż silnik obsługuje dla kategorii. Przycięcie
 * nie jest ciche: `binCountClamped` mówi, że rozdzielczość rozkładu jest
 * ograniczona sufitem, a nie wybrana regułą.
 */
export const HISTOGRAM_MAX_BINS = 60;

/**
 * Poniżej tylu obserwacji nie ma rozkładu. JEDNA obserwacja to punkt: nie ma
 * rozproszenia, kwartyle sprowadzają się do niej samej, a słupek o pełnej
 * wysokości sugeruje "wszystko jest tutaj" na zbiorze, w którym nie ma czego
 * porównać z czym. Model taki przypadek ZGŁASZA (`enoughObservationsOk`),
 * a nie rysuje tak, jakby wszystko było w porządku.
 */
export const HISTOGRAM_MIN_OBSERVATIONS = 2;

/**
 * Poniżej tylu obserwacji KSZTAŁT histogramu jest funkcją granic przedziałów,
 * a nie rozkładu: przesunięcie pierwszej krawędzi o pół szerokości zamienia
 * jeden szczyt na dwa i odwrotnie. Próg jest z praktyki, nie z pomiaru,
 * i dlatego nie stoi przy sprawdzeniach uczciwości, tylko przy doradzaniu
 * FORMY (`histogramFormAdvice`): przy takiej próbce beeswarm albo wykres
 * punktowy pokazuje każdą obserwację i nie wymyśla kształtu.
 */
export const HISTOGRAM_SHAPE_MIN_OBSERVATIONS = 20;

/**
 * Reguła, która wyznaczyła przedziały. Jedzie do podpisu, bo liczba
 * przedziałów jest wyborem, a każdy wybór na wykresie ma być nazwany:
 *   * `freedman-diaconis` - domyślna, szerokość `2 * IQR / n^(1/3)`; odporna
 *     na wyrzutki, bo IQR nie zna ogonów;
 *   * `sturges` - awaryjna, `ceil(log2 n) + 1` przedziałów; wchodzi, gdy IQR
 *     wynosi zero (skupisko powtórzonej wartości plus wyrzutek), bo FD dzieli
 *     wtedy przez zero;
 *   * `explicit-edges` / `explicit-count` - krawędzie albo ich liczba podane
 *     z zewnątrz; model wtedy nie ręczy za kształt, tylko sprawdza podane;
 *   * `degenerate` - wszystkie obserwacje równe, więc zakresu nie ma;
 *   * `none` - nie ma żadnej obserwacji, model milczy.
 */
export const HISTOGRAM_RULES = [
  "freedman-diaconis",
  "sturges",
  "explicit-edges",
  "explicit-count",
  "degenerate",
  "none",
] as const;

/** Nazwa reguły doboru przedziałów. Tablica wyżej istnieje, bo render SKŁADA
 *  z niej klucz słownika (`histogram.rule.${rule}`), a klucza sklejonego nie
 *  widzi ani parytet PL/EN, ani bramka rozjazdu - jedyną drogą do pełnego
 *  pokrycia jest przejście bramki po wszystkich wartościach unii. */
export type HistogramRule = (typeof HISTOGRAM_RULES)[number];

export interface HistogramBin {
  index: number;
  /** Lewa krawędź, w jednostkach danych; ZAWSZE domknięta. */
  from: number;
  /** Prawa krawędź; domknięta wyłącznie w ostatnim przedziale. */
  to: number;
  /** `to - from`; zawsze dodatnia i skończona (przedziały puste nie wchodzą). */
  width: number;
  count: number;
  /** Udział obserwacji, 0..1. */
  share: number;
  /** `count / (n * width)`; pole słupka gęstości równa się udziałowi. */
  density: number;
  /** Co render ma odłożyć na osi wartości - patrz `valueEncodes`. */
  plotValue: number;
  /** Czy prawa krawędź należy do tego przedziału (tylko ostatni). */
  closedRight: boolean;
  /**
   * `range` - normalny przedział. `point` - wszystkie obserwacje mają jedną
   * wartość, więc szerokość przedziału jest DOPEŁNIENIEM RYSUNKU, a nie
   * rozpiętością danych; etykieta niesie wtedy samą wartość, nie zakres.
   */
  kind: "range" | "point";
  label: string;
  /**
   * Etykiety obserwacji, które wpadły do tego przedziału - w histogramie
   * `categories` z konfiguracji nie są przedziałami, tylko IDENTYFIKATORAMI
   * obserwacji (kraj, spółka, kwartał), i to jest jedyne miejsce, w którym
   * przeżywają. Tooltip odpowiada z nich na pytanie "kto tu jest", którego
   * histogram normalnie nie umie zadać. Pusta tablica, gdy autor nie podał
   * etykiet.
   */
  members: string[];
}

/**
 * Komplet pozycyjny. Nie sama średnia, i to jest cała treść tej struktury -
 * patrz nagłówek pliku. Wartości w jednostkach danych; `n` w sztukach.
 */
export interface HistogramSummary {
  n: number;
  /** Luki i nieliczby pominięte przy budowie rozkładu. */
  missing: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  mean: number;
  iqr: number;
}

export interface HistogramModel {
  /** Przedziały od lewej do prawej. Puste, gdy nie ma obserwacji. */
  bins: HistogramBin[];
  summary: HistogramSummary;
  rule: HistogramRule;
  binCount: number;
  /** Czy `HISTOGRAM_MAX_BINS` przyciął liczbę zamówioną regułą. */
  binCountClamped: boolean;
  /** Czy wszystkie przedziały mają tę samą szerokość (z tolerancją float). */
  uniformWidth: boolean;
  /** `count` przy przedziałach równych, `density` przy nierównych. */
  valueEncodes: "count" | "density";
  /** Górna granica osi wartości w jednostkach `plotValue`; dolna to zero. */
  plotMax: number;
  /** Zakres osi poziomej: pierwsza i ostatnia krawędź. */
  domain: { min: number; max: number };
  /** Nazwa serii, z której policzono rozkład. */
  seriesName: string;
  colorSlot: number;
  /** Ile serii z danymi model POMINĄŁ (histogram czyta jedną). */
  ignoredSeries: number;
  /** Obserwacje, które nie trafiły w żadną krawędź. Każda jest defektem. */
  outOfRange: number;

  /**
   * SUMA KONTROLNA: czy licznosci przedziałów sumują się do liczby
   * obserwacji. `null` = nie ma czego sprawdzać (zero obserwacji), `false`
   * = wykryty defekt.
   *
   * NIE JEST TO SPRAWDZANIE WŁASNEGO DODAWANIA, i to jest tu istotne, bo
   * suma kontrolna liczona z tego, co model sam rozsypał do kubełków,
   * domykałaby się z definicji i nie mogłaby wykryć niczego (ta sama pułapka,
   * którą opisuje suma udziałów w `pieModel`). Pytanie brzmi inaczej: czy
   * KAŻDA przyjęta obserwacja jest na rysunku widoczna. Zawodzi wtedy, gdy
   * krawędzie przyszły z zewnątrz i nie obejmują danych, albo gdy przedział
   * o zerowej szerokości wypadł z rysunku razem ze swoimi obserwacjami.
   * Histogram, w którym pod słupkami siedzi mniej obserwacji, niż jest
   * w danych, zawyża udział wszystkiego, co pokazał.
   */
  countChecksumOk: boolean | null;
  /**
   * Czy wszystkie obserwacje mieszczą się między pierwszą i ostatnią
   * krawędzią. `null` = zero obserwacji.
   *
   * OSOBNE POLE OD SUMY KONTROLNEJ, choć przy dzisiejszym kodzie oba mówią
   * o tym samym zdarzeniu: to pole nazywa PRZYCZYNĘ (krawędzie nie obejmują
   * danych), suma kontrolna nazywa SKUTEK (na rysunku brakuje obserwacji).
   * Liczone są niezależnie - jedno z licznika odrzuceń, drugie z sumy
   * licznosci - więc rozejście się tych dwóch pól znaczy, że zepsuło się samo
   * rozsypywanie do kubełków. Render pokazuje przyczynę, bramka skutek.
   */
  inRangeOk: boolean | null;
  /**
   * Czy każdy przedział ma dodatnią szerokość. `false` = wśród podanych
   * krawędzi były dwie równe (albo nieuporządkowane), czyli przedział
   * o zerowej szerokości: nie da się go narysować, a jego gęstość byłaby
   * dzieleniem przez zero. Taki przedział wypada z rysunku, więc obserwacje
   * z jego wnętrza gubi też suma kontrolna. `null` = nie ma czego sprawdzać.
   */
  binWidthOk: boolean | null;
  /**
   * Czy w danych JEST rozproszenie. `false` = wszystkie obserwacje mają jedną
   * wartość, więc rozkładu nie ma; histogram pokazuje wtedy jeden słupek
   * i słowo "rozkład" jest w podpisie bez treści. `null` = zero obserwacji.
   */
  spreadOk: boolean | null;
  /**
   * Czy obserwacji jest dość, żeby mówić o rozkładzie
   * (`HISTOGRAM_MIN_OBSERVATIONS`). `false` przy jednej obserwacji.
   */
  enoughObservationsOk: boolean | null;
  /**
   * Czy przedziałów jest co najmniej dwa przy istniejącym rozproszeniu.
   * Jeden przedział na rozstrzelonych danych to słupek "wszystko", czyli
   * rysunek bez informacji. `null`, gdy rozproszenia i tak nie ma.
   */
  enoughBinsOk: boolean | null;
  /**
   * Czy `sampleSize` z konfiguracji zgadza się z liczbą policzonych
   * obserwacji. Sekcja 8 każe podać `n` w podpisie; jeżeli autor podaje je
   * ręcznie, a w bloku siedzi inna liczba wierszy, to podpis kłamie o próbce.
   * `null` = autor nie podał `n` albo nie ma obserwacji.
   */
  declaredSampleOk: boolean | null;
}

export interface HistogramOptions {
  /** Identyfikatory obserwacji, pozycyjnie do wartości. */
  labels?: readonly string[];
  /**
   * Gotowe krawędzie (k+1 liczb) - wyjście awaryjne dla rozkładów o umownych
   * progach (przedziały wiekowe, widełki dochodowe). Model ich NIE poprawia:
   * sortuje, odrzuca nieliczby i sprawdza, czy obejmują dane.
   */
  edges?: readonly number[] | null;
  /** Wymuszona liczba przedziałów. Przycinana sufitem jak każda inna. */
  binCount?: number | null;
  maxBins?: number;
  /**
   * Formatowanie liczby w etykiecie przedziału. Render wstrzykuje tu
   * `formatChartValue` związane z językiem i jednostką; domyślna
   * implementacja jest bez locale i bez Intl, żeby moduł został czysty.
   */
  formatValue?: (value: number) => string;
  /** `ChartConfig.sampleSize` - do sprawdzenia zgodności podpisu z próbką. */
  declaredSampleSize?: number | null;
  seriesName?: string;
  colorSlot?: number;
  ignoredSeries?: number;
}

/**
 * Domyślne formatowanie krawędzi: ASCII, bez Intl, bez locale.
 *
 * OSŁONA NA NIELICZBĘ JEST TU OBOWIĄZKOWA, a nie ostrożnościowa:
 * `Intl.NumberFormat.format(NaN)` zwraca literalny napis "NaN", a bramka
 * `blockMatrix` sprawdza `textContent` bloków właśnie na obecność takich
 * napisów. Model nie produkuje nieskończoności ani NaN, więc ta gałąź nie ma
 * prawa się wykonać - zostaje na wypadek krawędzi wstrzykniętych z zewnątrz
 * i zwraca tę samą kreskę, którą `format.ts` oznacza brak wartości, żeby
 * czytelnik widział spójny brak, a nie techniczny bełkot.
 */
const BRAK_LICZBY = "-";

function domyslnyFormat(value: number): string {
  if (!Number.isFinite(value)) return BRAK_LICZBY;
  const abs = Math.abs(value);
  const miejsca = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return value.toFixed(miejsca);
}

/** Liczba albo `null`. Jedno miejsce, w którym `Infinity` i `NaN` z bazy giną. */
function liczba(value: number | null | undefined): number | null {
  return value === null || value === undefined || !Number.isFinite(value) ? null : value;
}

/**
 * Ostatnia zapora przed NaN i nieskończonością w polu modelu.
 *
 * Nie zastępuje osłon przy dzieleniu - te są w miejscach, gdzie mianownik
 * może być zerem, i tam wynikiem jest przemyślane zero, a nie zamiatanie.
 * Ta funkcja jest bramką na wyjściu: konfiguracja przychodzi z bazy i może
 * być z wersji edytora, której ten kod nie zna, a jedno `NaN` w polu modelu
 * wychodzi na stronie jako napis "NaN" w tabeli danych.
 */
function pewna(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/**
 * Kwantyl z interpolacją liniową po pozycji `(n-1) * p` - ta sama definicja,
 * którą stosuje domyślnie R i większość arkuszy, więc IQR policzone tutaj
 * zgadza się z IQR, które autor widzi u siebie. Wejście MUSI być posortowane
 * rosnąco; tablica pusta daje zero, bo wywołujący i tak nie dochodzi do tego
 * miejsca bez obserwacji.
 */
function kwantyl(posortowane: readonly number[], p: number): number {
  const n = posortowane.length;
  if (n === 0) return 0;
  if (n === 1) return posortowane[0];
  const pozycja = (n - 1) * Math.min(1, Math.max(0, p));
  const dol = Math.floor(pozycja);
  const reszta = pozycja - dol;
  const a = posortowane[dol];
  const b = posortowane[Math.min(n - 1, dol + 1)];
  return a + (b - a) * reszta;
}

/**
 * Liczba przedziałów ZAMÓWIONA regułą, jeszcze przed sufitem.
 *
 * Zwracamy liczbę surową, a nie już przyciętą, bo inaczej `binCountClamped`
 * nie miałby czego porównać z sufitem i histogram o rozdzielczości narzuconej
 * rysunkiem wyglądałby na histogram o rozdzielczości wybranej regułą.
 *
 * Nieskończoność i NaN zamieniają się w największą zapisywalną liczbę
 * całkowitą, a nie w wyjątek: przy zakresie rzędu 1e300 i szerokości rzędu
 * 1e-300 iloraz wychodzi z podwójnej precyzji, a "więcej, niż da się
 * zapisać" jest tu prawdziwą odpowiedzią - sufit i tak ją przytnie.
 */
function liczbaZSzerokosci(zakres: number, szerokosc: number): number {
  const surowa = szerokosc > 0 ? zakres / szerokosc : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(surowa)) return Number.MAX_SAFE_INTEGER;
  return Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, Math.ceil(surowa)));
}

/** Sufit z opcji, sprowadzony do sensownego zakresu całkowitego. */
function sufitPrzedzialow(maxBins: number | undefined): number {
  const surowy = liczba(maxBins ?? null);
  if (surowy === null) return HISTOGRAM_MAX_BINS;
  return Math.min(HISTOGRAM_MAX_BINS, Math.max(1, Math.floor(surowy)));
}

/**
 * Krawędzie równych przedziałów na `[min, max]`.
 *
 * PIERWSZA I OSTATNIA KRAWĘDŹ SĄ DOKŁADNIE MIN I MAX, a nie wynikiem
 * `min + k * szerokosc`, i to nie jest kosmetyka. Przy `min = 0,1`,
 * `max = 0,7` i siedmiu przedziałach akumulacja błędu podwójnej precyzji
 * stawia ostatnią krawędź o kilka epsilonów PONIŻEJ maksimum - a wtedy
 * największa obserwacja wypada poza zakres własnych krawędzi i model zgłasza
 * defekt, który sam wyprodukował.
 *
 * KRAWĘDZIE WEWNĘTRZNE LICZYMY MIESZANIEM `min*(1-t) + max*t`, a nie
 * `min + szerokosc * i`. Dwa powody, oba wykryte na danych brzegowych:
 * dodawanie narastające kumuluje błąd zaokrąglenia wzdłuż całej osi, a wzór
 * przez szerokość PRZEPEŁNIA SIĘ, gdy zakres przekracza podwójną precyzję.
 * Dla serii od -1e308 do 1e308 `max - min` wychodzi nieskończonością, więc
 * wszystkie krawędzie wewnętrzne były nieskończone, szerokości przedziałów
 * też, a zapora na wyjściu modelu sprowadzała je do zera - słupek miał
 * krawędzie oddalone o pół osi i szerokość nic, a render dzieli przez tę
 * szerokość. Mieszanie nie liczy różnicy, więc nie ma czym przepełnić.
 */
function rowneKrawedzie(min: number, max: number, ile: number): number[] {
  const k = Math.max(1, Math.floor(ile));
  const krawedzie: number[] = [min];
  for (let i = 1; i < k; i++) {
    const t = i / k;
    krawedzie.push(min * (1 - t) + max * t);
  }
  krawedzie.push(max);
  return krawedzie;
}

/**
 * Model histogramu z surowych obserwacji. `values` to WEKTOR OBSERWACJI,
 * pozycyjnie zgodny z `opts.labels`; `null` i nieliczby są lukami i nie
 * wchodzą do rozkładu (brak pomiaru nie jest pomiarem o wartości zero -
 * zero wpadłoby do przedziału i przesunęło masę rozkładu).
 *
 * Funkcja NIGDY nie rzuca i nigdy nie zwraca NaN ani nieskończoności, bo
 * treść bloku przychodzi z bazy i może być z wersji edytora, której ten kod
 * nie zna: pusta seria, sama luka, jedna obserwacja, wartości ujemne, jedna
 * wartość powtórzona sto razy.
 */
export function histogramModel(
  values: readonly (number | null)[],
  opts: HistogramOptions = {},
): HistogramModel {
  const format = opts.formatValue ?? domyslnyFormat;
  const sufit = sufitPrzedzialow(opts.maxBins);
  const podstawa = {
    seriesName: opts.seriesName ?? "",
    colorSlot: opts.colorSlot === undefined ? 1 : Math.max(1, Math.floor(opts.colorSlot)),
    ignoredSeries: Math.max(0, Math.floor(liczba(opts.ignoredSeries ?? null) ?? 0)),
  };

  // Obserwacje razem z etykietami, bo do przedziału wpada obserwacja, a nie
  // sama liczba - `members` odpowiada potem na pytanie "kto tu jest".
  const przyjete: { value: number; label: string }[] = [];
  let missing = 0;
  for (let i = 0; i < values.length; i++) {
    const v = liczba(values[i]);
    if (v === null) {
      missing++;
      continue;
    }
    przyjete.push({ value: v, label: opts.labels?.[i] ?? "" });
  }

  const n = przyjete.length;
  if (n === 0) {
    // Zero obserwacji to NIE MA CZEGO SPRAWDZAĆ - każde pole uczciwości
    // milczy (`null`), zamiast zaświadczać, że rozkład jest w porządku.
    // Domena 0..1 jest tym samym neutralnym zastępnikiem, który przy pustej
    // serii zwraca `niceScale`, więc skala renderu nie dzieli przez zero.
    return {
      bins: [],
      summary: { n: 0, missing, min: 0, q1: 0, median: 0, q3: 0, max: 0, mean: 0, iqr: 0 },
      rule: "none",
      binCount: 0,
      binCountClamped: false,
      uniformWidth: true,
      valueEncodes: "count",
      plotMax: 0,
      domain: { min: 0, max: 1 },
      ...podstawa,
      outOfRange: 0,
      countChecksumOk: null,
      inRangeOk: null,
      binWidthOk: null,
      spreadOk: null,
      enoughObservationsOk: null,
      enoughBinsOk: null,
      declaredSampleOk: null,
    };
  }

  const posortowane = [...przyjete].sort((a, b) => a.value - b.value);
  const wartosci = posortowane.map((o) => o.value);
  const min = wartosci[0];
  const max = wartosci[n - 1];
  const zakres = max - min;
  const q1 = kwantyl(wartosci, 0.25);
  const median = kwantyl(wartosci, 0.5);
  const q3 = kwantyl(wartosci, 0.75);
  const iqr = q3 - q1;
  // ŚREDNIA PRZYROSTOWA, nie suma przez n. Suma trzech wartości rzędu 1e308
  // wychodzi z podwójnej precyzji, więc iloraz był nieskończonością, a zapora
  // na wyjściu modelu sprowadzała go do ZERA - tabela pod wykresem podawała
  // średnią zero dla zbioru samych ogromnych liczb. Kłamstwo o liczbie jest
  // gorsze niż jej brak. Postać `mean += (v - mean) / i` nie sumuje niczego,
  // co mogłoby przepełnić, i po drodze mniej gubi na dodawaniu wartości
  // różnych rzędów.
  let mean = 0;
  for (let i = 0; i < n; i++) mean += (wartosci[i] - mean) / (i + 1);

  // WYBÓR KRAWĘDZI. Kolejność jest hierarchią zaufania: podane krawędzie biją
  // wszystko (autor deklaruje umowne progi), potem zwyrodniały brak zakresu,
  // potem podana liczba przedziałów, na końcu reguły. FD jest domyślna, bo
  // jej szerokość zależy od IQR, czyli od rdzenia rozkładu, a nie od ogonów -
  // Sturges liczy z samego `n` i przy jednym wyrzutku rozciąga przedziały na
  // pusty obszar. Sturges wchodzi dokładnie tam, gdzie FD nie ma czym
  // podzielić: IQR równe zero (skupisko powtórzonej wartości plus wyrzutek).
  let rule: HistogramRule;
  let krawedzie: number[];
  let zamowione = 0;
  let binCountClamped = false;

  const podaneKrawedzie = (opts.edges ?? [])
    .map((e) => liczba(e))
    .filter((e): e is number => e !== null)
    .sort((a, b) => a - b);

  if (podaneKrawedzie.length >= 2) {
    // KRAWĘDZIE PODANE PRZECHODZĄ BEZ PRZYCINANIA SUFITEM. Obcięcie ich do
    // sufitu podmieniłoby autorowi progi, które właśnie zadeklarował (widełki
    // dochodowe, przedziały wiekowe), a to jest gorsze niż rysunek z dużą
    // liczbą słupków: liczba przedziałów jest widoczna na obrazku, a podmiana
    // progu nie jest widoczna nigdzie.
    rule = "explicit-edges";
    krawedzie = podaneKrawedzie;
  } else if (!(zakres > 0)) {
    // ZWYRODNIENIE: wszystkie obserwacje mają jedną wartość. Przedział
    // o zerowej szerokości byłby nierysowalny, a jego gęstość dzieleniem
    // przez zero, więc krawędzie dostają symetryczne DOPEŁNIENIE - to samo,
    // którym `niceScale` rozsuwa płaską serię (20% wartości albo jedność przy
    // zerze). Dopełnienie jest jawnie ARTEFAKTEM RYSUNKU: prawdę o braku
    // rozproszenia niesie `spreadOk`, a przedział ma `kind: "point"`
    // i etykietę z samą wartością, żeby nikt nie odczytał z niej rozpiętości,
    // której w danych nie ma.
    const dopelnienie = Math.abs(min) > 0 ? Math.abs(min) * 0.2 : 1;
    rule = "degenerate";
    krawedzie = [min - dopelnienie / 2, min + dopelnienie / 2];
  } else {
    const podanaLiczba = liczba(opts.binCount ?? null);
    if (podanaLiczba !== null && podanaLiczba >= 1) {
      rule = "explicit-count";
      zamowione = Math.floor(podanaLiczba);
    } else if (iqr > 0) {
      rule = "freedman-diaconis";
      // Freedman-Diaconis: h = 2 * IQR / n^(1/3). `Math.cbrt(n)` jest dla
      // n >= 1 zawsze >= 1, więc mianownik nie zeruje się nigdy.
      zamowione = liczbaZSzerokosci(zakres, (2 * iqr) / Math.cbrt(n));
    } else {
      rule = "sturges";
      // Sturges: k = ceil(log2 n) + 1. Dla n = 1 daje jeden przedział, co
      // jest zgodne z prawdą - jedna obserwacja nie dzieli się na przedziały.
      zamowione = Math.ceil(Math.log2(n)) + 1;
    }
    binCountClamped = zamowione > sufit;
    krawedzie = rowneKrawedzie(min, max, Math.min(sufit, Math.max(1, zamowione)));
  }

  // ROZSYPYWANIE DO KUBEŁKÓW JEDNĄ ŚCIEŻKĄ dla krawędzi liczonych i podanych.
  // Osobna, szybsza ścieżka dla równych przedziałów (indeks z dzielenia)
  // byłaby drugim źródłem prawdy o tym, gdzie leży obserwacja, i mogłaby się
  // rozejść z tą wolniejszą przy krawędziach na granicy precyzji. Przedziałów
  // jest najwyżej sześćdziesiąt, a obserwacji tyle, ile wierszy w bloku, więc
  // przeszukanie liniowe jest tu bez znaczenia dla kosztu.
  //
  // PRZEDZIAŁY DOMKNIĘTE Z LEWEJ, OTWARTE Z PRAWEJ, a ostatni domknięty
  // z obu stron - bez tego wyjątku maksimum nie należałoby do żadnego
  // przedziału i wypadałoby z rozkładu jako "poza zakresem".
  const pary: { from: number; to: number; count: number; members: string[] }[] = [];
  let zeroSzerokosci = false;
  for (let i = 0; i < krawedzie.length - 1; i++) {
    const from = krawedzie[i];
    const to = krawedzie[i + 1];
    if (!(to - from > 0)) {
      // Przedział o zerowej (albo odwróconej) szerokości nie da się narysować
      // i nie da się z niego policzyć gęstości. Wypada z rysunku, ale defekt
      // zostaje zapisany - a obserwacje, które w nim siedziały, zgubi suma
      // kontrolna, co jest właściwym drugim ostrzeżeniem.
      zeroSzerokosci = true;
      continue;
    }
    pary.push({ from, to, count: 0, members: [] });
  }

  const ostatni = pary.length - 1;
  let outOfRange = 0;
  for (const obs of posortowane) {
    let trafiony = -1;
    for (let i = 0; i < pary.length; i++) {
      const domknietyZPrawej = i === ostatni;
      const w = domknietyZPrawej
        ? obs.value >= pary[i].from && obs.value <= pary[i].to
        : obs.value >= pary[i].from && obs.value < pary[i].to;
      if (w) {
        trafiony = i;
        break;
      }
    }
    if (trafiony < 0) {
      outOfRange++;
      continue;
    }
    pary[trafiony].count++;
    if (obs.label !== "") pary[trafiony].members.push(obs.label);
  }

  const szerokosci = pary.map((p) => p.to - p.from);
  // RÓWNOŚĆ SZEROKOŚCI Z TOLERANCJĄ WZGLĘDNĄ, nie przez `===`. Krawędzie
  // równych przedziałów liczone w podwójnej precyzji różnią się na ostatnich
  // bitach, więc porównanie dokładne uznawałoby własne równe przedziały za
  // nierówne i przełączało kodowanie na gęstość - czyli podmieniało oś
  // wykresu z powodu błędu zaokrąglenia.
  const srednia =
    szerokosci.length > 0 ? szerokosci.reduce((a, w) => a + w, 0) / szerokosci.length : 0;
  const uniformWidth =
    szerokosci.length <= 1 ||
    (srednia > 0 && szerokosci.every((w) => Math.abs(w - srednia) <= srednia * 1e-9));
  const valueEncodes: "count" | "density" = uniformWidth ? "count" : "density";

  const bins: HistogramBin[] = pary.map((p, index) => {
    const width = p.to - p.from;
    const share = p.count / n;
    // Mianownik gęstości ma OBIE osłony, choć przy tych krawędziach żadna nie
    // ma prawa się odpalić: `n` jest tu z definicji dodatnie, a `width`
    // przeszło filtr dodatniej szerokości. Osłona zostaje, bo gęstość jest
    // jedynym dzieleniem w tym pliku, którego mianownik pochodzi z danych
    // autora, a `Infinity` w polu modelu wychodzi na stronie jako napis.
    const density = width > 0 && n > 0 ? p.count / (n * width) : 0;
    const punkt = rule === "degenerate";
    const label = punkt ? format(min) : `${format(p.from)} - ${format(p.to)}`;
    return {
      index,
      from: pewna(p.from),
      to: pewna(p.to),
      width: pewna(width),
      count: p.count,
      share: pewna(share),
      density: pewna(density),
      plotValue: pewna(valueEncodes === "density" ? density : p.count),
      closedRight: index === ostatni,
      kind: punkt ? "point" : "range",
      label,
      members: p.members,
    };
  });

  const zsumowane = bins.reduce((a, b) => a + b.count, 0);
  const plotMax = bins.reduce((a, b) => Math.max(a, b.plotValue), 0);
  const declared = liczba(opts.declaredSampleSize ?? null);

  return {
    bins,
    summary: {
      n,
      missing,
      min: pewna(min),
      q1: pewna(q1),
      median: pewna(median),
      q3: pewna(q3),
      max: pewna(max),
      mean: pewna(mean),
      iqr: pewna(iqr),
    },
    rule,
    binCount: bins.length,
    binCountClamped,
    uniformWidth,
    valueEncodes,
    plotMax: pewna(plotMax),
    domain: {
      min: pewna(krawedzie[0] ?? 0),
      max: pewna(krawedzie[krawedzie.length - 1] ?? 1),
    },
    ...podstawa,
    outOfRange,
    countChecksumOk: zsumowane === n,
    inRangeOk: outOfRange === 0,
    binWidthOk: zeroSzerokosci ? false : bins.length > 0,
    spreadOk: zakres > 0,
    enoughObservationsOk: n >= HISTOGRAM_MIN_OBSERVATIONS,
    // Rozproszenia nie ma - nie ma czego dzielić na przedziały, więc pytanie
    // o ich liczbę nie ma sensu i model na nie nie odpowiada.
    enoughBinsOk: zakres > 0 ? bins.length >= 2 : null,
    declaredSampleOk: declared === null ? null : Math.floor(declared) === n,
  };
}

/**
 * Model z konfiguracji bloku, czyli z tego, co silnik już ma.
 *
 * ODWZOROWANIE OBECNEGO KSZTAŁTU: `series[i].values` to WEKTOR OBSERWACJI
 * (jedna liczba na wiersz danych), a `categories[i]` to IDENTYFIKATOR tej
 * obserwacji, nie przedział. W formacie tekstowym widgetu (`csv.ts`) jeden
 * wiersz to jedna obserwacja: "Polska; 12,5". Konfiguracja nie ma osobnego
 * pola na obserwacje i nie musi go mieć - histogram degraduje się tu do
 * sensownego przypadku bez żadnego rozszerzenia schematu.
 *
 * CZYTANA JEST PIERWSZA SERIA Z DANYMI, nie `series[0]` na sztywno: seria
 * dopisana w edytorze i jeszcze niewypełniona stoi często na pierwszej
 * pozycji, a wygaszenie całego rozkładu z jej powodu ukrywałoby dane, które
 * autor już wpisał. Pozostałe serie z danymi są POLICZONE, nie zsypane -
 * `ignoredSeries` mówi renderowi, ile populacji nie widać, bo zsypanie dwóch
 * populacji do wspólnych przedziałów daje rozkład zbiorowiska, którego nikt
 * nie badał.
 */
export function histogramModelFromConfig(
  config: ChartConfig,
  opts: Omit<HistogramOptions, "labels" | "declaredSampleSize" | "seriesName" | "colorSlot"> = {},
): HistogramModel {
  const zDanymi = config.series.filter((s) => s.values.some((v) => liczba(v) !== null));
  const seria = zDanymi[0] ?? config.series[0];
  return histogramModel(seria?.values ?? [], {
    ...opts,
    labels: config.categories,
    declaredSampleSize: config.sampleSize,
    seriesName: seria?.name ?? "",
    colorSlot: seria?.colorSlot ?? 1,
    ignoredSeries: Math.max(0, zDanymi.length - 1),
  });
}

/**
 * Zakres osi wartości. ZAWSZE OD ZERA, bez opcji i bez wyjątku: histogram
 * koduje licznosć (albo gęstość) DŁUGOŚCIĄ słupka, a ucięta oś wprost
 * zniekształca proporcję między przedziałami - sekcja 8. Górna granica to
 * najwyższy `plotValue`; render dociąga ją do ładnej podziałki `niceScale`.
 */
export function histogramExtent(model: HistogramModel): { min: number; max: number } {
  return { min: 0, max: pewna(Math.max(0, model.plotMax)) };
}

export type HistogramFormAdvice = "tooFew" | "noSpread" | "tooCoarse" | "clamped";

/**
 * Kiedy histogram jest ZŁYM WYBOREM formy - odpowiedniki `pieFormAdvice`
 * dla rozkładu. Osobno od sprawdzeń uczciwości, bo tu nie ma defektu
 * arytmetycznego: dane są w porządku, tylko forma o nich kłamie kształtem.
 *
 *   * `tooFew` - poniżej `HISTOGRAM_SHAPE_MIN_OBSERVATIONS` kształt jest
 *     funkcją położenia krawędzi, nie rozkładu; beeswarm albo wykres punktowy
 *     pokazuje każdą obserwację i nie wymyśla szczytów;
 *   * `noSpread` - rozproszenia nie ma, więc nie ma rozkładu; jedna liczba
 *     w tekście mówi to samo bez rysunku;
 *   * `tooCoarse` - jeden przedział na rozstrzelonych danych, czyli słupek
 *     "wszystko"; rysunek bez informacji;
 *   * `clamped` - sufit przyciął liczbę przedziałów, więc rozdzielczość
 *     rozkładu jest ograniczona rysunkiem; przy takim ogonie lepszy jest
 *     boxplot albo odcięcie wyrzutków NAZWANE w podpisie.
 */
export function histogramFormAdvice(model: HistogramModel): HistogramFormAdvice[] {
  const advice: HistogramFormAdvice[] = [];
  if (model.summary.n === 0) return advice;
  if (model.summary.n < HISTOGRAM_SHAPE_MIN_OBSERVATIONS) advice.push("tooFew");
  if (model.spreadOk === false) advice.push("noSpread");
  else if (model.enoughBinsOk === false) advice.push("tooCoarse");
  if (model.binCountClamped) advice.push("clamped");
  return advice;
}

export interface HistogramTableRow {
  label: string;
  count: number;
  share: number;
  /**
   * Gęstość wypisywana TYLKO przy nierównych przedziałach, bo tam jest tym,
   * co niesie wysokość słupka, a czytelnik musi mieć w tabeli tę samą liczbę,
   * którą widzi na rysunku. Przy przedziałach równych gęstość jest licznością
   * przemnożoną przez stałą, więc dodatkowa kolumna niczego nie dodaje,
   * a rozsadza tabelę - wtedy `null`.
   */
  density: number | null;
  /** Identyfikatory obserwacji w przedziale, gdy autor je podał. */
  members: string[];
}

export interface HistogramTable {
  rows: HistogramTableRow[];
  /** Suma licznosci wiersz po wierszu - ta sama liczba co suma kontrolna. */
  total: number;
  summary: HistogramSummary;
  valueEncodes: "count" | "density";
  rule: HistogramRule;
}

/**
 * ALTERNATYWA TEKSTOWA: co ma pokazać tabela danych pod wykresem. Grafika
 * nigdy nie jest jedyną drogą do liczby - histogramu nie odczyta ekran
 * czytający, wydruk w skali szarości gubi wypełnienia, a z samego słupka nie
 * da się odczytać licznosci dokładniej niż "mniej więcej".
 *
 * TABELA NIESIE KOMPLET POZYCYJNY, NIE ŚREDNIĄ, i to jest jej najważniejsza
 * cecha: kolumna "Czego unikać" z tabeli doboru formy zabrania przy rozkładzie
 * "średniej bez rozproszenia", a tabela pod wykresem jest miejscem, w którym
 * ten błąd popełnia się najłatwiej - jedna liczba na dole i sprawa zamknięta.
 * Dlatego `summary` jedzie tu w całości (min, Q1, mediana, Q3, max, IQR
 * i średnia), a nie w wyborze wywołującego.
 */
export function histogramTable(model: HistogramModel): HistogramTable {
  return {
    rows: model.bins.map((b) => ({
      label: b.label,
      count: b.count,
      share: b.share,
      density: model.valueEncodes === "density" ? b.density : null,
      members: b.members,
    })),
    total: model.bins.reduce((a, b) => a + b.count, 0),
    summary: model.summary,
    valueEncodes: model.valueEncodes,
    rule: model.rule,
  };
}
