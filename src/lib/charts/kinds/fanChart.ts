// Model wachlarza scenariuszy (prognoza z zagnieżdżonymi pasmami niepewności).
//
// PYTANIE ANALITYCZNE, KTÓREGO DOTYCZY. Tabela doboru formy (sekcja 1
// specyfikacji) stawia ten rodzaj w wierszu "Scenariusze w czasie", a
// w kolumnie "Czego unikać" ma dokładnie jedną pozycję: "pojedyncza linia
// prognozy". I to jest cała racja bytu tego modelu. Prognoza narysowana jedną
// linią mówi czytelnikowi, że autor ZNA przyszłą wartość - a autor zna
// najwyżej rozkład. Sekcja 8 nazywa to wprost: "prognoza jako pojedyncza
// linia bez przedziału to najczęstsza forma kłamstwa na wykresie". Wachlarz
// jest odpowiedzią na to samo pytanie ("jak to pójdzie dalej") narysowaną
// tak, że niepewność jest widoczna, a nie dopisana w przypisie.
//
// CZEGO DLA TEGO RODZAJU NIE WOLNO:
//   * nie wolno rysować prognozy bez pasma. Model dlatego nie ma trybu
//     "sama linia": jeśli nie ma z czego zbudować ani jednego poziomu
//     pewności, `FanModel.levels` jest PUSTE, a `honesty.forecastDistinguished`
//     wychodzi `false` - czyli rodzaj mówi o sobie, że nie jest jeszcze
//     wachlarzem, zamiast udawać, że jest;
//   * nie wolno rysować pasm NIEZAGNIEŻDŻONYCH. Pasmo 50% musi w każdym
//     kroku leżeć CAŁE wewnątrz pasma 80%, a to wewnątrz 95%. Przecięcie
//     krawędzi dwóch poziomów nie jest kwestią gustu ani zaokrąglenia:
//     oznacza, że co najmniej jedna z tych liczb nie pochodzi z tego
//     rozkładu, o którym mówi jej etykieta. Sprawdzamy to arytmetycznie
//     w każdym kroku (`honesty.bandsNested`);
//   * nie wolno rysować pasma, które NIE ZAWIERA ścieżki centralnej. Pasmo
//     jest przedziałem wokół centrum; centrum poza przedziałem znaczy, że
//     ścieżka centralna i krawędzie policzono z dwóch różnych prognoz.
//     To jest defekt tej samej klasy co mostek, którego składniki nie sumują
//     się do różnicy stanów (`honesty.bandsContainCentral`);
//   * nie wolno przyjmować, że wyższa pewność daje węższe pasmo. Pasmo 95%
//     WĘŻSZE od pasma 80% jest defektem deklaracji, nie ciekawostką - i tego
//     defektu nie da się wykryć, jeśli model sam posortuje poziomy po
//     zmierzonej szerokości i przyklei etykiety po kolei. Dlatego kolejność
//     warstw bierzemy Z DEKLARACJI autora (pewność malejąco), a potem
//     PYTAMY, czy zmierzone szerokości się z nią zgadzają
//     (`honesty.confidenceMatchesWidth`). To ta sama lekcja, którą zapisał
//     `pieModel`: sprawdza się dane autora, nie własną arytmetykę;
//   * nie wolno rysować pasma o szerokości zero na kroku prognozy. Zerowa
//     szerokość udaje pewność, której nie ma - w kroku prognozowanym jest
//     twierdzeniem "tę wartość znam dokładnie". Jedyne miejsce, gdzie zero
//     jest poprawne, to KOTWICA na granicy (ostatnia obserwacja: tam wartość
//     naprawdę jest pomiarem), i dlatego kotwica jest osobno oznaczona
//     i wypada ze sprawdzenia (`FanBandStep.isAnchor`);
//   * nie wolno symetryzować pasma po cichu. Przedział niesymetryczny wokół
//     centrum ("w dół może spaść o 40, w górę urosnąć o 8") jest TREŚCIĄ
//     prognozy, nie usterką kolumn w arkuszu, więc obie krawędzie liczą się
//     osobno i żadna nie jest wyprowadzana z drugiej;
//   * nie wolno rysować punktów obserwacji na odcinku prognozy. Punkt jest
//     znacznikiem POMIARU (sekcja 3: "warunek uczciwości wygładzenia:
//     widoczne punkty obserwacji"), a w prognozie nie ma pomiarów - ich brak
//     sam mówi, gdzie kończą się dane. Model nie zostawia tu miejsca na
//     pomyłkę renderera: `FanStep.isObservation` jest `false` w całej
//     prognozie bez wyjątku.
//
// REGUŁY OGÓLNE, KTÓRE GO DOTYCZĄ:
//   * PROGNOZA ODRÓŻNIONA TRZEMA NOŚNIKAMI JEDNOCZEŚNIE (sekcja 8): pasmem
//     niepewności, tłem strefy prognozy i pionowym separatorem z etykietą.
//     Model oddaje wszystkie trzy jako dane, a nie jako sugestię: pasma
//     w `levels`, strefę w `boundary.zoneFrom` / `zoneTo`, separator
//     w `boundary.separatorAt`. Czwartego nośnika NIE MA i nie ma go
//     świadomie - linia serii zostaje CIĄGŁA, bo trzy nośniki wystarczają,
//     a kreskowana linia zaczyna wyglądać na artefakt renderu. Dlatego
//     w tym modelu nie istnieje żadne pole w rodzaju `dashed`;
//   * ZERO LINII KRESKOWANYCH JAKO RUSZTOWANIA (sekcja 3). Separator strefy
//     prognozy jest linią CIĄGŁĄ 1 px w `--linia-mocna`; jedyna dozwolona
//     nieciągłość to kreskowanie strefy jako TEKSTURY POWIERZCHNI, i to
//     dlatego, że płaski tint 2,2% znika w druku i w skali szarości;
//   * PASMO NIEPEWNOŚCI JEST PŁASKIE, NIGDY GRADIENTOWE (sekcja 3): gradient
//     oznacza obszar danych, płaskie wypełnienie oznacza niepewność. Gdyby
//     oba były gradientowe, czytelnik nie odróżniłby wielkości od nieznanego.
//     Model nie oddaje więc żadnej rampy - oddaje warstwy;
//   * HOVER DODAJE PRECYZJĘ, NIGDY NIE NIESIE TREŚCI (sekcja 6). Żadne pole
//     tego modelu nie zmienia się pod kursorem, bo wszystkie kodują wartość.
//     Strefa trafienia nie jest kształtem pasma, tylko całą kolumną kroku -
//     dlatego model podaje pozycje kroków w jednostkach indeksu kategorii,
//     a nie wielokąt pasma;
//   * GRAFIKA NIGDY NIE JEST JEDYNĄ DROGĄ DO LICZBY (sekcja 8), dlatego
//     `fanTable` oddaje pełny zestaw liczb w tej samej kolejności i Z TYCH
//     SAMYCH pól modelu, z których powstaje rysunek - nie policzonych po raz
//     drugi inną drogą. Przy wachlarzu to szczególnie ważne, bo krawędź
//     pasma jest jedyną liczbą, której z rysunku nie da się odczytać
//     dokładnie: pasmo ma 10-11% krycia i nie ma przy sobie podziałki.
//
// KONWENCJA DANYCH. Silnik daje `categories` (kroki czasu) i `series`
// (nazwa, slot palety, wartości albo luki) - patrz `../types`. Obecny kształt
// NIE MA pola na poziomy pewności, więc model czyta je trzema drogami, w tej
// kolejności pierwszeństwa:
//
//   (1) Z NAZW SERII. Para "dolna"/"górna" (albo lower/upper, min/max,
//       pesymistyczny/optymistyczny) z liczbą pewności w nazwie tworzy jeden
//       poziom: "80% dolna" + "80% górna" to pasmo 80%. Rozpoznajemy też
//       zapis percentylowy: "P10" + "P90" to pasmo 80%, bo obejmuje 80%
//       masy rozkładu, a "P50" to ścieżka centralna. Ta droga wyraża
//       WIELE poziomów w obecnym schemacie, bez żadnego rozszerzenia -
//       i jest drogą zalecaną, bo krawędzie pochodzą wtedy z modelu autora,
//       a nie z założenia silnika.
//   (2) Z OPCJI `levels` - miejsce na proponowane rozszerzenie konfiguracji
//       `fanLevels` (lista par pewność + połowa szerokości w procentach
//       wartości centralnej). Każdy poziom jest tu podany JAWNIE.
//   (3) Z ISTNIEJĄCEGO POLA `forecastBandPct`. Daje DOKŁADNIE JEDEN poziom
//       i - to jest istotne - poziom o pewności NIEZNANEJ (`confidence:
//       null`). Pole deklaruje szerokość ("±12%"), a nie pewność, więc model
//       nie wolno mu dopisać "95%". Degradacja do jednego poziomu jest tu
//       jedynym uczciwym wyjściem: rozłożenie jednej podanej szerokości na
//       trzy zagnieżdżone pasma wymagałoby ZAŁOŻENIA o kształcie rozkładu
//       (na przykład normalności), którego dane nie zawierają, a wykres
//       pokazywałby wtedy trzy liczby, z których autor podał jedną.
//
// Bez żadnej z tych trzech dróg model nie zmyśla pasma. Oddaje ścieżkę,
// granicę i strefę, a `honesty.forecastDistinguished` mówi `false` - czyli
// dokładnie to, co wykrywa `isForecastMissingBand` w `../honesty`, tylko
// z rozbiciem na nośniki.
import type { ChartConfig, ChartSeries } from "../types";

/* ------------------------------------------------------------------ *
 * STAŁE I PROGI                                                       *
 * ------------------------------------------------------------------ */

/**
 * Górna granica wartości, którą model wpuszcza do środka.
 *
 * Treść bloku pochodzi z bazy i może być z przyszłej albo cofniętej wersji
 * edytora, więc do serii trafia czasem liczba, która przeszła `Number.isFinite`,
 * ale w arytmetyce pasm zamienia się w `Infinity`: `1e308 + 1e308`. Pasmo
 * liczy sumy i różnice krawędzi, więc taka liczba wychodzi z modelu jako
 * `Infinity`, a `Intl.NumberFormat.format(Infinity)` wypisuje w stronie
 * literalny napis. Odcinamy ją na wejściu i MÓWIMY o tym
 * (`honesty.droppedValueCount`), bo wiersz bez liczby wygląda na
 * niekompletny i czytelnik ma prawo wiedzieć, dlaczego.
 */
export const FAN_VALUE_LIMIT = Number.MAX_SAFE_INTEGER;

/**
 * Względna tolerancja porównań geometrycznych (zawieranie centrum,
 * zagnieżdżenie pasm, uporządkowanie pary).
 *
 * WZGLĘDNA, nie bezwzględna, i to z tego samego powodu, dla którego mostek ma
 * `CHECKSUM_TOLERANCE_RATIO`: pasmo w milionach euro i pasmo w punktach
 * procentowych nie mogą dzielić jednego progu. Wartość jest jednak o rzędy
 * ostrzejsza niż tam (1e-9 wobec 0,005), bo tu nie chodzi o błąd zaokrąglenia
 * w arkuszu autora, tylko o błąd reprezentacji binarnej: krawędź policzona
 * jako `central - central * 0.12` i ta sama krawędź wpisana ręcznie różnią się
 * na ostatnim bicie. Luźniejszy próg oślepiłby sprawdzenia dokładnie tam,
 * gdzie przecięcie pasm jest małe, a więc najtrudniejsze do zauważenia okiem.
 */
export const FAN_COMPARISON_TOLERANCE_RATIO = 1e-9;

/**
 * Podłoga tolerancji dla porównań przy krawędziach bliskich zeru.
 *
 * Bez podłogi tolerancja względna przy wartościach rzędu 1e-15 spada do zera
 * i porównanie staje się dokładne - a wtedy pasmo policzone z zera
 * (`0 - 0 * 0.12`) wychodziło raz jako zerowej szerokości, raz jako
 * ujemnej szerokości 1e-18, w zależności od kolejności działań.
 */
export const FAN_ABSOLUTE_TOLERANCE = 1e-12;

/**
 * Udział szerokości pasma w PIERWSZYM kroku prognozy, powyżej którego
 * wachlarz jest podejrzany. Liczony wobec największej szerokości tego samego
 * poziomu.
 *
 * TO NIE JEST DEFEKT i dlatego nie ma dla tej sytuacji pola `boolean` obok
 * orzeczeń uczciwości - jest osobne pole informacyjne. Wachlarz, który
 * w pierwszym kroku ma już połowę swojej końcowej rozpiętości, może być
 * prawdziwy: przy prognozie kwartalnej pierwszy kwartał bywa równie niepewny
 * jak czwarty, a przy szeregu o dużym szumie jednokrokowym niepewność
 * startowa jest po prostu duża. Bywa też objawem pomyłki - wklejenia pasma
 * o stałej szerokości albo przesunięcia granicy prognozy o jeden krok.
 * Model podaje fakt i udział, a rozstrzyga autor.
 *
 * Pół szerokości końcowej to granica, w której wachlarz przestaje opowiadać
 * o tym, że niepewność ROŚNIE z horyzontem: przy udziale 0,5 pierwszy krok
 * i ostatni różnią się dwukrotnie, przy 0,8 kształt jest już prostokątem.
 */
export const FAN_WIDE_START_SHARE = 0.5;

/**
 * Powyżej tylu poziomów pewności wachlarz przestaje być czytelny.
 *
 * Liczba jest wyprowadzona z palety, nie z gustu. Pasmo prognozy ma kontrast
 * do płyty w korytarzu 1,10-1,17:1 (`BAND_CONTRAST_RANGE` w `../palette`) -
 * to jest o włos nad siatką (1,18:1). Cztery zagnieżdżone pasma dzielą ten
 * korytarz na cztery stopnie po około 0,02 kontrastu; piąty stopień jest
 * poniżej progu rozróżnialności powierzchni i czytelnik przestaje widzieć,
 * gdzie kończy się jeden poziom, a zaczyna drugi. Trzy poziomy (50/80/95)
 * z przykładu specyfikacji mieszczą się z zapasem.
 */
export const FAN_LEVELS_ADVICE_MAX = 4;

/**
 * Minimalna liczba kroków prognozy, przy której wachlarz ma sens.
 *
 * Jeden krok prognozy to nie wachlarz, tylko słupek błędu przy ostatnim
 * punkcie - pasmo nie ma się od czego rozchodzić, bo ma jedną kolumnę. Dwa
 * kroki są minimum, przy którym widać kierunek rozchodzenia się.
 */
export const FAN_MIN_FORECAST_STEPS = 2;

/**
 * Rdzenie nazw serii oznaczających ŚCIEŻKĘ CENTRALNĄ.
 *
 * Rozpoznajemy po nazwie, a nie po pozycji w arkuszu, bo pozycja jest
 * przypadkowa: autor dopisujący pasmo 95% wstawia kolumny tam, gdzie mu
 * wygodnie, i ścieżka centralna wcale nie musi być pierwsza. Nazwa jest
 * deklaracją autora o tym, co kolumna znaczy, i to jest właściwa podstawa -
 * ta sama decyzja, którą podjął `isPercentUnit` w `pieModel`.
 */
export const FAN_CENTRAL_STEMS: readonly string[] = [
  "centralna",
  "centralny",
  "centralne",
  "central",
  "sciezka",
  "mediana",
  "median",
  "baza",
  "bazowa",
  "bazowy",
  "base",
  "baseline",
];

/** Rdzenie nazw dolnej krawędzi pasma. */
export const FAN_LOWER_STEMS: readonly string[] = [
  "dolna",
  "dolny",
  "dolne",
  "dol",
  "lower",
  "low",
  "min",
  "minimum",
  "pesymistyczny",
  "pesymistyczna",
  "pesymistyczne",
  "pessimistic",
  "worst",
];

/** Rdzenie nazw górnej krawędzi pasma. */
export const FAN_UPPER_STEMS: readonly string[] = [
  "gorna",
  "gorny",
  "gorne",
  "gora",
  "upper",
  "high",
  "max",
  "maksimum",
  "maksymalny",
  "optymistyczny",
  "optymistyczna",
  "optymistyczne",
  "optimistic",
  "best",
];

/* ------------------------------------------------------------------ *
 * TYPY WEJŚCIA                                                        *
 * ------------------------------------------------------------------ */

/**
 * Jawny poziom pewności - kształt proponowanego rozszerzenia konfiguracji
 * `fanLevels`.
 *
 * `pct` to POŁOWA szerokości pasma w procentach wartości centralnej, czyli ta
 * sama jednostka, w której już mówi istniejące `forecastBandPct` ("pasmo
 * niepewności ±%"). Trzymamy tę jednostkę, żeby rozszerzenie było nadzbiorem
 * obecnego pola, a nie drugą, konkurencyjną konwencją: `forecastBandPct: 12`
 * jest dokładnie równoważne `fanLevels: [{ confidence: null, pct: 12 }]`.
 */
export interface FanLevelSpec {
  /**
   * Pewność w procentach (50, 80, 95). `null` znaczy NIEZNANA - i to jest
   * wartość dopuszczalna, nie brak danych: autor deklarujący "±12%" bez
   * poziomu pewności podał szerokość i nic więcej. Model tego nie uzupełnia.
   */
  confidence: number | null;
  /** Połowa szerokości pasma w procentach wartości centralnej. */
  pct: number;
}

export interface FanInput {
  /** Kroki czasu - jedna kategoria to jeden krok. */
  categories: readonly string[];
  series: readonly ChartSeries[];
}

export interface FanOptions {
  /**
   * Indeks PIERWSZEJ kategorii prognozowanej (jak `ChartConfig.forecastFrom`).
   * Poza zakresem 1..count-1 jest ignorowany: prognoza od kroku zerowego
   * znaczyłaby wykres bez ani jednej obserwacji, a prognoza od kroku za
   * ostatnią kategorią - strefę o zerowej szerokości. Oba przypadki są
   * treścią z cofniętej wersji edytora, nie deklaracją.
   */
  forecastFrom?: number | null;
  /** Istniejące `ChartConfig.forecastBandPct` - droga (3). */
  bandPct?: number;
  /** Jawne poziomy - droga (2), proponowane `fanLevels`. */
  levels?: readonly FanLevelSpec[];
  /**
   * Indeks serii ze ścieżką centralną. Podanie go jest jedyną drogą do
   * nadpisania rozpoznania z nazwy - model NIGDY nie zmienia zdania sam,
   * bo wtedy nie umiałby powiedzieć, skąd wzięło się centrum
   * (`FanModel.centralSource`).
   */
  centralSeriesIndex?: number;
}

/* ------------------------------------------------------------------ *
 * TYPY WYJŚCIA                                                        *
 * ------------------------------------------------------------------ */

/** Skąd wzięły się pasma - do przypisu pod wykresem. */
export type FanBandSource = "series" | "levels" | "bandPct" | "none";

/** Skąd wzięła się ścieżka centralna. */
export type FanCentralSource = "option" | "name" | "fallback" | "none";

/** Który z trzech nośników odróżnienia prognozy jest obecny. */
export type FanCarrier = "band" | "zone" | "separator";

/** Krok czasu - jedna kategoria. */
export interface FanStep {
  /** Indeks kategorii w konfiguracji; renderer mapuje go na pozycję X. */
  index: number;
  label: string;
  /** Wartość ścieżki centralnej; `null` = luka w danych. */
  central: number | null;
  /** Czy krok leży w strefie prognozy. */
  isForecast: boolean;
  /**
   * Czy w tym kroku wolno postawić PUNKT OBSERWACJI. Warunek jest podwójny:
   * krok jest historyczny I ma wartość. W prognozie zawsze `false` - patrz
   * nagłówek pliku.
   */
  isObservation: boolean;
}

/** Ciągły odcinek ścieżki centralnej - luka przerywa wielokąt i linię. */
export interface FanCentralPoint {
  index: number;
  value: number;
  isForecast: boolean;
}

/** Jeden krok jednego pasma. */
export interface FanBandStep {
  index: number;
  /** Dolna krawędź w jednostkach danych (po naprawie odwróconej pary). */
  lower: number;
  /** Górna krawędź w jednostkach danych. */
  upper: number;
  /** `upper - lower`, zawsze nieujemna. */
  width: number;
  isForecast: boolean;
  /**
   * Czy para w arkuszu była ODWRÓCONA (dolna wyżej od górnej). Geometria
   * jest naprawiona, żeby wielokąt dał się narysować, ale FAKT zostaje -
   * ciche posortowanie pary ukrywa defekt danych.
   */
  inverted: boolean;
  /**
   * KOTWICA na granicy historia/prognoza: krok o zerowej szerokości, dołożony
   * po to, żeby wielokąt pasma wychodził z ostatniej obserwacji, a nie
   * zaczynał się w powietrzu pół kroku dalej. Zerowa szerokość jest tu
   * POPRAWNA (ostatnia obserwacja jest pomiarem), więc kotwica wypada ze
   * sprawdzenia zerowych szerokości. Kotwicę dokłada wyłącznie droga
   * pochodna (`levels`, `bandPct`); krawędzie podane wprost przez autora są
   * autorytatywne i model nic do nich nie dodaje.
   */
  isAnchor: boolean;
}

/** Jeden poziom pewności - jedno pasmo. */
export interface FanLevel {
  /**
   * Trwały identyfikator poziomu (nie tekst do wyświetlenia). Renderer
   * i tabela indeksują po nim, bo `layer` zmienia się przy zmianie
   * deklaracji, a klucz nie.
   */
  key: string;
  /** Pewność w procentach; `null` = nieznana (patrz `FanLevelSpec`). */
  confidence: number | null;
  /**
   * Warstwa rysowania: 0 to pasmo NAJSZERSZE, malowane pierwsze i leżące
   * najgłębiej. Kolejność bierze się z DEKLARACJI (pewność malejąco), a nie
   * ze zmierzonej szerokości - patrz nagłówek pliku.
   */
  layer: number;
  /**
   * Ile pasm leży NA tym pasmie, gdy renderer maluje pełne pasma jedno na
   * drugim. Równa się `layer`, ale jest osobnym polem, bo to nie ta sama
   * informacja: `layer` mówi o kolejności, `overlapDepth` o KRYCIU.
   *
   * Po co to renderowi: paleta trzyma JEDNĄ alfę pasma na slot serii,
   * policzoną pod kontrast 1,10-1,17:1 do płyty. Przy nakładaniu k pasm
   * o alfie a krycie wypadkowe wynosi `1 - (1 - a)^k`, więc najwęższe pasmo
   * przy trzech poziomach i alfie 0,10 wychodzi na 0,271 - dwa i pół raza
   * ciemniejsze od projektu i już poza korytarzem. Renderer ma dwa wyjścia:
   * albo policzyć alfę per warstwa z tego wzoru, albo malować PIERŚCIENIE
   * (`FanModel.rings`), które się nie nakładają.
   */
  overlapDepth: number;
  /**
   * Kroki pasma w kolejności indeksów - tylko te, które mają OBIE krawędzie.
   * Krok z jedną krawędzią nie jest pasmem o zerowej szerokości, tylko
   * brakiem danych, i dlatego wypada, a nie zwęża się do linii.
   */
  steps: FanBandStep[];
  /**
   * Kroki pocięte na CIĄGŁE odcinki. Wielokąt pasma z luką w środku nie jest
   * jednym wielokątem, a wypełnienie przeciągnięte przez lukę twierdziłoby,
   * że w kroku bez danych niepewność jest znana.
   */
  segments: FanBandStep[][];
  /** Największa szerokość pasma; 0, gdy nie ma czego mierzyć. */
  maxWidth: number;
  /** Średnia szerokość po krokach NIEKOTWICZNYCH; 0 przy braku takich. */
  meanWidth: number;
  /**
   * Największa asymetria wokół centrum, 0..1: `|(g - c) - (c - d)| / szer`.
   * `null` = nie ma ani jednego kroku z centrum i szerokością dodatnią.
   * POLE INFORMACYJNE - asymetria jest treścią prognozy, nie usterką.
   */
  maxAsymmetry: number | null;
}

/**
 * Pierścień: część pasma warstwy `layer`, która NIE JEST przykryta pasmem
 * węższym. Suma pierścieni pokrywa dokładnie pasmo najszersze, a żadne dwa
 * pierścienie się nie nakładają - dzięki temu renderer może dać każdemu
 * warstwową alfę bez składania krycia (patrz `FanLevel.overlapDepth`).
 */
export interface FanRingStep {
  index: number;
  /** Dolna krawędź paska w jednostkach danych. */
  from: number;
  /** Górna krawędź paska. */
  to: number;
  isForecast: boolean;
}

export interface FanRing {
  layer: number;
  /**
   * "lower" - pasek pod pasmem węższym, "upper" - nad nim, "core" - całe
   * pasmo najwęższe (ono nie ma nic pod sobą, więc jest jednym paskiem).
   */
  side: "lower" | "core" | "upper";
  segments: FanRingStep[][];
}

/**
 * Granica historia/prognoza. Pozycje są w JEDNOSTKACH INDEKSU KATEGORII,
 * nie w pikselach: renderer ma już skalę pasmową kategorii i sam wie, ile
 * pikseli ma krok. Wartość 0,5 znaczy "w połowie odstępu między kategorią
 * a następną".
 */
export interface FanBoundary {
  /** Indeks pierwszej kategorii prognozowanej. */
  forecastFrom: number;
  /** Indeks ostatniej obserwacji: `forecastFrom - 1`. */
  lastObservation: number;
  /**
   * Pozycja pionowego separatora, w jednostkach indeksu kategorii. Leży
   * MIĘDZY ostatnią obserwacją a pierwszą prognozą, a nie na środku
   * którejkolwiek z nich: separator postawiony na kategorii dzieli jej
   * kolumnę i czytelnik nie wie, po której stronie granicy ona jest.
   */
  separatorAt: number;
  /** Lewa krawędź prostokąta strefy prognozy - ta sama co separator. */
  zoneFrom: number;
  /** Prawa krawędź strefy: pół kroku za ostatnią kategorią. */
  zoneTo: number;
  historyCount: number;
  forecastCount: number;
}

/**
 * SPRAWDZENIA UCZCIWOŚCI. Konwencja repo, ta sama co w sumie kontrolnej
 * mostka i sumie udziałów tarczy:
 *   * `null` znaczy NIE MA CZEGO SPRAWDZAĆ - model wtedy MILCZY, a nie
 *     zaświadcza, że jest dobrze;
 *   * `false` znaczy WYKRYTY DEFEKT;
 *   * `true` znaczy sprawdzone i w porządku.
 * Listy etykiet są osobne od orzeczeń, bo podpis pod wykresem musi umieć
 * powiedzieć, KTÓRY krok jest wadliwy, a nie tylko że któryś jest.
 */
export interface FanHonesty {
  /**
   * Czy każde pasmo zawiera ścieżkę centralną w każdym kroku. `false` =
   * co najmniej jedno pasmo mija centrum, czyli krawędzie i centrum
   * pochodzą z dwóch różnych prognoz. `null` = nie ma ani jednego kroku,
   * w którym są jednocześnie centrum i obie krawędzie.
   */
  bandsContainCentral: boolean | null;
  /** Etykiety kroków, w których pasmo nie zawiera centrum. */
  centralOutsideLabels: string[];
  /**
   * Czy pasma są ZAGNIEŻDŻONE: węższe całe wewnątrz szerszego, w każdym
   * kroku. `null` = mniej niż dwa poziomy, więc nie ma czego zagnieżdżać.
   */
  bandsNested: boolean | null;
  /** Etykiety kroków, w których krawędzie dwóch poziomów się przecinają. */
  crossingLabels: string[];
  /**
   * Czy ZADEKLAROWANA pewność zgadza się ze ZMIERZONĄ szerokością: pasmo
   * o wyższej pewności musi być szersze. `false` = deklaracja i liczby
   * mówią co innego (na przykład pasmo 95% węższe od 80%). `null` = nie ma
   * dwóch poziomów o ZNANEJ pewności, więc nie ma czego z czym zestawić -
   * i to jest jedyna uczciwa odpowiedź, bo poziomy o pewności nieznanej
   * model sam sortuje po szerokości, a sprawdzanie własnego sortowania nie
   * może wykryć niczego.
   */
  confidenceMatchesWidth: boolean | null;
  /** Pewności poziomów, które wypadły niezgodnie z deklaracją. */
  misorderedConfidences: number[];
  /**
   * Czy każde pasmo ma w każdym kroku prognozy szerokość dodatnią. `false` =
   * jest krok, w którym pasmo zwężyło się do linii, czyli udaje pewność,
   * której nie ma. Kotwice na granicy nie wchodzą - tam zero jest poprawne.
   * `null` = nie ma ani jednego niekotwicznego kroku pasma.
   */
  bandsHaveWidth: boolean | null;
  /** Etykiety kroków o zerowej szerokości pasma. */
  zeroWidthLabels: string[];
  /**
   * Czy pary krawędzi są uporządkowane (dolna nie wyżej od górnej). `false` =
   * jest co najmniej jedna para odwrócona, czyli kolumny w arkuszu są
   * zamienione albo jedna z nich nie jest tym, co mówi jej nazwa. `null` =
   * nie ma ani jednej pary do porównania.
   */
  bandPairsOrdered: boolean | null;
  /** Etykiety kroków z odwróconą parą krawędzi. */
  invertedLabels: string[];
  /**
   * Czy prognoza jest odróżniona TRZEMA nośnikami jednocześnie (sekcja 8).
   * `false` = jest granica, ale brakuje przynajmniej jednego nośnika -
   * w praktyce prawie zawsze pasma. `null` = nie ma prognozy, więc nie ma
   * czego odróżniać.
   */
  forecastDistinguished: boolean | null;
  /** Które nośniki są obecne - do przypisu, żeby dało się powiedzieć który. */
  carriers: FanCarrier[];
  /**
   * Czy ścieżka centralna jest ciągła w całej prognozie. `false` = w
   * prognozie jest luka, więc linia się przerywa, a pasmo wokół niej nie ma
   * do czego się odnieść. `null` = nie ma prognozy.
   */
  centralContinuousInForecast: boolean | null;
  /** Etykiety kroków bez wartości centralnej (w obu fazach). */
  centralGapLabels: string[];
  /**
   * Udział szerokości pasma najszerszego w PIERWSZYM kroku prognozy wobec
   * jego szerokości największej, 0..1. `null` = nie ma czego liczyć.
   * POLE INFORMACYJNE, nie orzeczenie - patrz `FAN_WIDE_START_SHARE`.
   */
  firstStepWidthShare: number | null;
  /** Czy wachlarz zaczyna się szeroko. Informacja, nie defekt. */
  wideAtStart: boolean;
  /**
   * Etykiety kroków, w których pasmo najszersze ZWĘŻA SIĘ wobec kroku
   * poprzedniego. Informacja: malejąca niepewność z horyzontem bywa
   * prawdziwa (prognoza domykana twardym celem, kontrakt z ceną z góry), ale
   * bywa też objawem odwróconej kolejności kolumn.
   */
  narrowingLabels: string[];
  /**
   * Czy pasmo ma w prognozie STAŁĄ szerokość. Informacja: pasmo stałe nie
   * mówi nic o horyzoncie, więc wachlarz przestaje być wachlarzem, choć
   * żadna liczba nie jest fałszywa. `null` = mniej niż dwa kroki prognozy
   * z pasmem.
   */
  constantWidth: boolean | null;
  /**
   * Etykiety kroków HISTORYCZNYCH, w których jest pasmo o dodatniej
   * szerokości. Informacja: pasmo nad historią bywa prawdziwe (przedział
   * dopasowania modelu, dane wstępne przed rewizją), ale częściej znaczy, że
   * granica prognozy jest przesunięta.
   */
  bandOverHistoryLabels: string[];
  /**
   * Nazwy serii, które zadeklarowały krawędź bez pary (sama "dolna 80%" bez
   * górnej). Taki poziom NIE JEST rysowany, bo jedna krawędź nie jest
   * pasmem - i trzeba powiedzieć, czego brakuje, zamiast pomijać serię.
   */
  unpairedEdgeNames: string[];
  /**
   * Nazwy serii, które zgłosiły się do już obsadzonej krawędzi tego samego
   * poziomu (dwie różne "górna 80%"). Druga i dalsze są pomijane; bez tej
   * listy autor widzi wykres bez własnej kolumny i nie wie dlaczego.
   */
  duplicateEdgeNames: string[];
  /**
   * Liczby pewności odrzucone jako niemożliwe (poza przedziałem 0..100).
   * Pewność 120% albo 0% nie jest pewnością, więc poziom dostaje
   * `confidence: null` i traci prawo do sprawdzenia kolejności.
   */
  outOfRangeConfidences: number[];
  /**
   * Nazwy serii, których wachlarz NIE CZYTA. Rodzaj bierze jedno centrum
   * i pary krawędzi; seria, która nie jest ani jednym, ani drugim, znaczy,
   * że autor spodziewał się czegoś innego (na przykład trzech osobnych
   * scenariuszy zamiast pasm) i lepiej mu to powiedzieć.
   */
  extraSeriesNames: string[];
  /**
   * Ile liczb odpadło na wejściu: poza zakresem kategorii (dopisana wartość
   * bez dopisanej kategorii) albo poza `FAN_VALUE_LIMIT`. Bez tej liczby
   * wiersz wygląda na niekompletny bez powodu.
   */
  droppedValueCount: number;
  /**
   * Czy zadeklarowana granica prognozy była nie do użycia (poza zakresem
   * 1..count-1) i została odrzucona. Wtedy `FanModel.boundary` jest `null`,
   * a cały szereg jest historią - i to musi być widoczne, bo autor
   * deklarację złożył.
   */
  boundaryDropped: boolean;
  /**
   * Liczba obserwacji na ścieżce centralnej (kroki historyczne z wartością).
   * Do podpisu: wykres na trzech i na trzystu obserwacjach wygląda tak samo,
   * a znaczy co innego (sekcja 8).
   */
  observationCount: number;
}

export interface FanModel {
  /** Wszystkie kroki czasu w kolejności arkuszowej. */
  steps: FanStep[];
  /**
   * Ścieżka centralna pocięta na CIĄGŁE odcinki. Linia zostaje ciągła jako
   * styl (bez kreskowania w prognozie), ale luka w danych ją przerywa - to
   * dwie różne rzeczy i model nie miesza ich w jedną.
   */
  centralSegments: FanCentralPoint[][];
  /** Poziomy od NAJSZERSZEGO (`layer` 0). */
  levels: FanLevel[];
  /**
   * Pierścienie: nienakładające się paski, których suma pokrywa pasmo
   * najszersze. Puste, gdy nie ma pasm.
   */
  rings: FanRing[];
  /**
   * Czy pierścienie pokrywają wszystkie kroki, w których jest jakiekolwiek
   * pasmo. `false` = poziomy mają różne zbiory kroków (jeden ma lukę tam,
   * gdzie drugi jej nie ma), więc renderer musi wziąć pełne pasma
   * (`levels[].segments`) i policzyć alfę z `overlapDepth`.
   */
  ringsComplete: boolean;
  /** Granica historia/prognoza; `null` = cały szereg jest historią. */
  boundary: FanBoundary | null;
  bandSource: FanBandSource;
  centralSource: FanCentralSource;
  honesty: FanHonesty;
}

/* ------------------------------------------------------------------ *
 * NARZĘDZIA WEWNĘTRZNE                                                *
 * ------------------------------------------------------------------ */

/**
 * Napis do porównywania nazw serii: bez diakrytyków, małymi literami,
 * z separatorami zwiniętymi do jednej spacji.
 *
 * "ł" NIE ROZKŁADA SIĘ w NFD (jest osobnym punktem kodowym, nie l + kreska),
 * więc samo `normalize` nie wystarcza i trzeba go podmienić ręcznie. Bez tego
 * "dolna" pisane przez kogoś jako "dolność" łapało się, a "górna" nie -
 * niespójność, której nikt by nie znalazł, bo obie nazwy wyglądają na
 * obsłużone.
 */
function normalizuj(raw: string): string {
  return raw
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9%.,]+/g, " ")
    .trim();
}

/** Czy w znormalizowanej nazwie stoi którykolwiek z rdzeni jako osobne słowo. */
function maRdzen(name: string, stems: readonly string[]): boolean {
  const words = name.split(" ");
  return stems.some((stem) => words.some((word) => word === stem || word.startsWith(stem)));
}

/** Rola serii w wachlarzu. */
type FanRole = "central" | "lower" | "upper" | "other";

interface FanSeriesReading {
  role: FanRole;
  /** Pewność wyczytana z nazwy; `null` = nie podano albo poza zakresem. */
  confidence: number | null;
  /** Liczba pewności odrzucona jako niemożliwa - do `outOfRangeConfidences`. */
  rejectedConfidence: number | null;
}

/**
 * Odczyt roli i pewności z nazwy serii.
 *
 * KOLEJNOŚĆ SPRAWDZEŃ JEST ISTOTNA i wynika z tego, która deklaracja jest
 * mocniejsza. Zapis percentylowy idzie pierwszy, bo "P10" niesie
 * JEDNOCZEŚNIE stronę i pewność, i to bez dwuznaczności - podczas gdy słowo
 * "dolna" mówi tylko stronę, a liczba w nazwie może być czymkolwiek. Dalej
 * idzie strona ze słowa, a rozpoznanie centrum jest OSTATNIE, bo nazwa
 * "prognoza dolna" zawiera i stronę, i słowo kojarzone z centrum: gdyby
 * centrum sprawdzać pierwsze, dolna krawędź zostałaby ścieżką centralną
 * i wachlarz stracił jedną krawędź bez ani jednego ostrzeżenia.
 */
function odczytajSerie(rawName: string): FanSeriesReading {
  const name = normalizuj(rawName);

  // Percentyl: "p10", "p 90", "p97,5". Symetryczne percentyle domykają pasmo,
  // więc pewność liczymy z odległości od ogonów: p10 i p90 obejmują 80% masy.
  const pMatch = /(?:^| )p ?([0-9]{1,2}(?:[.,][0-9]+)?)(?![0-9])/.exec(name);
  if (pMatch) {
    const p = Number(pMatch[1].replace(",", "."));
    if (Number.isFinite(p) && p > 0 && p < 100) {
      // Percentyl 50 to mediana, czyli ścieżka centralna, a nie krawędź.
      if (Math.abs(p - 50) < 1e-9) {
        return { role: "central", confidence: null, rejectedConfidence: null };
      }
      const ogon = Math.min(p, 100 - p);
      return {
        role: p < 50 ? "lower" : "upper",
        confidence: zaokraglijPewnosc(100 - 2 * ogon),
        rejectedConfidence: null,
      };
    }
  }

  const dolna = maRdzen(name, FAN_LOWER_STEMS);
  const gorna = maRdzen(name, FAN_UPPER_STEMS);
  // Nazwa mówiąca jednocześnie "dolna" i "górna" nie mówi nic - takiej serii
  // nie przydzielamy do żadnej krawędzi, zamiast wybierać za autora.
  if (dolna !== gorna) {
    const { confidence, rejected } = pewnoscZNazwy(name);
    return {
      role: dolna ? "lower" : "upper",
      confidence,
      rejectedConfidence: rejected,
    };
  }

  if (maRdzen(name, FAN_CENTRAL_STEMS)) {
    return { role: "central", confidence: null, rejectedConfidence: null };
  }
  return { role: "other", confidence: null, rejectedConfidence: null };
}

/**
 * Pewność z nazwy krawędzi. Bierzemy PIERWSZĄ liczbę, bo nazwy mają postać
 * "80% dolna" albo "dolna 95", a nie "dolna 2 z 3 przy 80%": druga liczba
 * w nazwie krawędzi jest w praktyce numerem wariantu, nie pewnością.
 */
function pewnoscZNazwy(name: string): { confidence: number | null; rejected: number | null } {
  const match = /([0-9]{1,3}(?:[.,][0-9]+)?)/.exec(name);
  if (!match) return { confidence: null, rejected: null };
  const value = Number(match[1].replace(",", "."));
  if (!Number.isFinite(value)) return { confidence: null, rejected: null };
  if (value <= 0 || value >= 100) return { confidence: null, rejected: value };
  return { confidence: zaokraglijPewnosc(value), rejected: null };
}

/**
 * Pewność zaokrąglona do jednego miejsca po przecinku.
 *
 * Nie kosmetyka: pewność jest KLUCZEM GRUPOWANIA pary krawędzi, a "P2,5"
 * i "P97,5" dają przez arytmetykę zmiennoprzecinkową 94,99999999999999
 * i 95,00000000000001. Bez zaokrąglenia te dwie krawędzie trafiały do dwóch
 * różnych poziomów, każdy z jedną krawędzią, i wachlarz gubił całe pasmo 95%
 * zgłaszając za to dwie krawędzie bez pary.
 */
function zaokraglijPewnosc(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Odczyt liczby z serii wraz z informacją, czy została ODRZUCONA. */
function odczytajLiczbe(
  values: readonly (number | null)[] | undefined,
  i: number,
): { value: number | null; rejected: boolean } {
  if (!values || i < 0 || i >= values.length) return { value: null, rejected: false };
  const raw = values[i];
  if (raw === null || raw === undefined) return { value: null, rejected: false };
  if (typeof raw !== "number" || !Number.isFinite(raw) || Math.abs(raw) > FAN_VALUE_LIMIT) {
    return { value: null, rejected: true };
  }
  return { value: raw, rejected: false };
}

/** Tolerancja porównania dla podanej skali wartości. */
function tolerancja(...values: readonly number[]): number {
  let scale = 0;
  for (const v of values) {
    const abs = Math.abs(v);
    if (Number.isFinite(abs) && abs > scale) scale = abs;
  }
  return Math.max(scale * FAN_COMPARISON_TOLERANCE_RATIO, FAN_ABSOLUTE_TOLERANCE);
}

/**
 * Liczba, która NA PEWNO wyjdzie z modelu jako skończona.
 *
 * Ostatnia bramka przed polem wyjściowym. Twarde wymaganie modułu brzmi
 * "nigdy NaN, nigdy Infinity", bo `Intl.NumberFormat.format(NaN)` zwraca
 * literalny napis "NaN", a bramka `blockMatrix` szuka go w `textContent`
 * strony. Osłony przy każdym dzieleniu są pierwszą linią obrony, ta funkcja
 * drugą - i jest tu dlatego, że pierwsza linia zależy od pamięci autora
 * kolejnej zmiany, a druga nie.
 */
function pewnaLiczba(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Udział z OSŁONIONYM mianownikiem, przycięty do 0..1.
 *
 * Przycięcie nie jest kosmetyką: udział szerokości powyżej jedynki znaczy, że
 * krok jest szerszy od maksimum, czyli że maksimum policzono z innego zbioru
 * kroków. Zamiast wypuszczać liczbę, która w kolumnie udziałów jest
 * bełkotem, przycinamy i pozostawiamy defekt do wykrycia sprawdzeniom
 * geometrycznym, które mówią o nim wprost.
 */
function udzial(part: number, whole: number): number {
  if (!(whole > 0) || !Number.isFinite(part)) return 0;
  const value = part / whole;
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Ciągłe odcinki po indeksie - luka przerywa wielokąt. */
function nasegmenty<T extends { index: number }>(steps: readonly T[]): T[][] {
  const out: T[][] = [];
  let current: T[] = [];
  for (const step of steps) {
    const previous = current[current.length - 1];
    if (previous && step.index !== previous.index + 1) {
      out.push(current);
      current = [];
    }
    current.push(step);
  }
  if (current.length > 0) out.push(current);
  return out;
}

/* ------------------------------------------------------------------ *
 * MODEL                                                               *
 * ------------------------------------------------------------------ */

/** Zebrane w jednym miejscu krawędzie jednego poziomu przed złożeniem. */
interface SurowyPoziom {
  key: string;
  confidence: number | null;
  lowerIndex: number | null;
  upperIndex: number | null;
  /** Jawna połowa szerokości w procentach - tylko dla drogi pochodnej. */
  pct: number | null;
}

/**
 * Model wachlarza: kroki, ścieżka centralna, zagnieżdżone pasma, granica
 * historia/prognoza i orzeczenia uczciwości.
 *
 * Funkcja NIE RZUCA I NIE ZWRACA NaN ANI Infinity w żadnym polu, przy żadnym
 * wejściu - to jest wymaganie twarde, nie ambicja. Treść bloku pochodzi
 * z bazy i może być z przyszłej albo cofniętej wersji edytora: pusta seria,
 * sama luka, jedna kategoria, ujemna szerokość pasma, centrum równe zero przy
 * pasmie liczonym procentowo. Każde dzielenie w tym pliku ma osłonięty
 * mianownik (`udzial`), a każda liczba wychodząca w pole modelu przechodzi
 * przez `pewnaLiczba`.
 */
export function fanModel(input: FanInput, opts: FanOptions = {}): FanModel {
  const labels: string[] = [];
  for (const raw of input.categories) labels.push(typeof raw === "string" ? raw : "");
  const count = labels.length;
  const series: readonly ChartSeries[] = Array.isArray(input.series) ? input.series : [];

  let droppedValueCount = 0;
  const outOfRangeConfidences: number[] = [];
  const unpairedEdgeNames: string[] = [];
  const duplicateEdgeNames: string[] = [];
  const extraSeriesNames: string[] = [];

  /* --- GRANICA HISTORIA/PROGNOZA -------------------------------------- */

  // Deklaracja poza zakresem 1..count-1 jest ODRZUCANA, nie przycinana.
  // Przycięcie do jedynki byłoby zgadywaniem: autor, który wpisał granicę
  // w kroku 40 na szeregu o dwunastu krokach, pomylił się o coś innego niż
  // jeden krok, a wykres z granicą w losowym miejscu kłamie mocniej niż
  // wykres bez granicy.
  const declaredFrom = opts.forecastFrom ?? null;
  const boundaryUsable =
    declaredFrom !== null &&
    Number.isFinite(declaredFrom) &&
    Number.isInteger(declaredFrom) &&
    declaredFrom >= 1 &&
    declaredFrom <= count - 1;
  const forecastFrom = boundaryUsable ? declaredFrom : null;
  const boundaryDropped = declaredFrom !== null && !boundaryUsable;

  const boundary: FanBoundary | null =
    forecastFrom === null
      ? null
      : {
          forecastFrom,
          lastObservation: forecastFrom - 1,
          separatorAt: forecastFrom - 0.5,
          zoneFrom: forecastFrom - 0.5,
          zoneTo: count - 0.5,
          historyCount: forecastFrom,
          forecastCount: count - forecastFrom,
        };
  const isForecast = (i: number): boolean => forecastFrom !== null && i >= forecastFrom;

  /* --- ROLE SERII ----------------------------------------------------- */

  const readings = series.map((s) => odczytajSerie(typeof s?.name === "string" ? s.name : ""));
  for (const reading of readings) {
    if (reading.rejectedConfidence !== null) outOfRangeConfidences.push(reading.rejectedConfidence);
  }

  // Wybór ścieżki centralnej. Opcja bije nazwę, nazwa bije pozycję - i ta
  // ostatnia droga (pierwsza seria, która nie jest krawędzią) jest tu po to,
  // żeby OBECNY kształt konfiguracji działał bez zmian: autor ma jedną serię
  // "PKB" plus `forecastFrom` i `forecastBandPct`, a nazwa "PKB" nie mówi
  // o centralności niczego. Odrzucenie takiej serii dałoby wachlarz bez
  // ścieżki, czyli pasmo wokół niczego.
  let centralIndex: number | null = null;
  let centralSource: FanCentralSource = "none";
  const optionIndex = opts.centralSeriesIndex;
  if (
    optionIndex !== undefined &&
    Number.isInteger(optionIndex) &&
    optionIndex >= 0 &&
    optionIndex < series.length
  ) {
    centralIndex = optionIndex;
    centralSource = "option";
  }
  if (centralIndex === null) {
    const named = readings.findIndex((r) => r.role === "central");
    if (named >= 0) {
      centralIndex = named;
      centralSource = "name";
    }
  }
  if (centralIndex === null) {
    const fallback = readings.findIndex((r) => r.role === "other");
    if (fallback >= 0) {
      centralIndex = fallback;
      centralSource = "fallback";
    }
  }

  for (let i = 0; i < series.length; i++) {
    if (i === centralIndex) continue;
    const role = readings[i]?.role;
    if (role === "other" || role === "central") {
      extraSeriesNames.push(typeof series[i]?.name === "string" ? series[i].name : "");
    }
  }

  /* --- KROKI I ŚCIEŻKA CENTRALNA -------------------------------------- */

  const centralValues = centralIndex === null ? undefined : series[centralIndex]?.values;
  const steps: FanStep[] = [];
  const centralPoints: FanCentralPoint[] = [];
  const centralGapLabels: string[] = [];
  let observationCount = 0;
  for (let i = 0; i < count; i++) {
    const read = odczytajLiczbe(centralValues, i);
    if (read.rejected) droppedValueCount += 1;
    const forecast = isForecast(i);
    const observation = !forecast && read.value !== null;
    if (observation) observationCount += 1;
    if (read.value === null) centralGapLabels.push(labels[i]);
    else centralPoints.push({ index: i, value: read.value, isForecast: forecast });
    steps.push({
      index: i,
      label: labels[i],
      central: read.value,
      isForecast: forecast,
      isObservation: observation,
    });
  }
  // Liczby dopisane za ostatnią kategorią. Zdarzają się przy treści
  // z cofniętej wersji edytora, gdzie skrócono listę kategorii, a wartości
  // zostały. Bez nazwy kroku nie ma czego narysować, więc wartość wypada -
  // i to musi być widoczne, a nie przemilczane.
  if (centralValues) droppedValueCount += Math.max(0, centralValues.length - count);
  const centralSegments = nasegmenty(centralPoints);
  const centralValueByIndex = new Map<number, number>();
  for (const point of centralPoints) centralValueByIndex.set(point.index, point.value);

  /* --- SUROWE POZIOMY ------------------------------------------------- */

  let bandSource: FanBandSource = "none";
  const surowe: SurowyPoziom[] = [];

  // DROGA (1): pary krawędzi z nazw serii. Grupujemy po pewności, bo to ona
  // jest tożsamością poziomu: "80% dolna" i "dolna" to dwa różne pasma, a nie
  // dwa zapisy jednego.
  const edgeIndexes = readings
    .map((r, i) => ({ role: r.role, confidence: r.confidence, index: i }))
    .filter((e) => e.index !== centralIndex && (e.role === "lower" || e.role === "upper"));
  if (edgeIndexes.length > 0) {
    bandSource = "series";
    const groups = new Map<string, SurowyPoziom>();
    for (const edge of edgeIndexes) {
      const key = edge.confidence === null ? "auto" : `c${edge.confidence}`;
      let group = groups.get(key);
      if (!group) {
        group = {
          key,
          confidence: edge.confidence,
          lowerIndex: null,
          upperIndex: null,
          pct: null,
        };
        groups.set(key, group);
        surowe.push(group);
      }
      const name = typeof series[edge.index]?.name === "string" ? series[edge.index].name : "";
      if (edge.role === "lower") {
        if (group.lowerIndex === null) group.lowerIndex = edge.index;
        else duplicateEdgeNames.push(name);
      } else {
        if (group.upperIndex === null) group.upperIndex = edge.index;
        else duplicateEdgeNames.push(name);
      }
    }
    // Poziom z jedną krawędzią NIE JEST rysowany. Dorysowanie drugiej
    // krawędzi przez odbicie względem centrum byłoby wymyśleniem liczby:
    // przedział niesymetryczny jest normą, nie wyjątkiem, więc odbicie
    // podałoby zmyśloną krawędź jako prognozę autora.
    for (let i = surowe.length - 1; i >= 0; i--) {
      const level = surowe[i];
      if (level.lowerIndex !== null && level.upperIndex !== null) continue;
      const orphan = level.lowerIndex ?? level.upperIndex;
      if (orphan !== null) {
        unpairedEdgeNames.push(typeof series[orphan]?.name === "string" ? series[orphan].name : "");
      }
      surowe.splice(i, 1);
    }
  }

  // DROGA (2): jawne poziomy z opcji (proponowane `fanLevels`).
  if (surowe.length === 0 && opts.levels && opts.levels.length > 0) {
    for (let i = 0; i < opts.levels.length; i++) {
      const spec = opts.levels[i];
      const pct = typeof spec?.pct === "number" && Number.isFinite(spec.pct) ? spec.pct : 0;
      // Ujemna połowa szerokości nie ma sensu: pasmo "±-12%" to pasmo
      // odwrócone, czyli krawędź dolna nad górną. Zamiast naprawiać znak po
      // cichu, odrzucamy poziom - jego brak jest widoczny, a odwrócone pasmo
      // wygląda jak poprawne.
      if (!(pct > 0)) continue;
      const declared =
        typeof spec.confidence === "number" && Number.isFinite(spec.confidence)
          ? spec.confidence
          : null;
      let confidence: number | null = null;
      if (declared !== null) {
        if (declared > 0 && declared < 100) confidence = zaokraglijPewnosc(declared);
        else outOfRangeConfidences.push(declared);
      }
      surowe.push({
        key: confidence === null ? `pct${i}` : `c${confidence}`,
        confidence,
        lowerIndex: null,
        upperIndex: null,
        pct,
      });
    }
    if (surowe.length > 0) bandSource = "levels";
  }

  // DROGA (3): istniejące `forecastBandPct` - dokładnie jeden poziom
  // o pewności NIEZNANEJ. Patrz nagłówek pliku: pole deklaruje szerokość,
  // nie pewność, i model nie ma prawa dopisać za autora "95%".
  const bandPct =
    typeof opts.bandPct === "number" && Number.isFinite(opts.bandPct) ? opts.bandPct : 0;
  if (surowe.length === 0 && bandPct > 0 && forecastFrom !== null) {
    bandSource = "bandPct";
    surowe.push({
      key: "band",
      confidence: null,
      lowerIndex: null,
      upperIndex: null,
      pct: bandPct,
    });
  }
  if (surowe.length === 0) bandSource = "none";

  /* --- KROKI PASM ----------------------------------------------------- */

  const invertedLabels: string[] = [];
  const zbudowane: { level: SurowyPoziom; steps: FanBandStep[] }[] = [];
  for (const level of surowe) {
    const bandSteps: FanBandStep[] = [];
    if (level.lowerIndex !== null && level.upperIndex !== null) {
      const lowerValues = series[level.lowerIndex]?.values;
      const upperValues = series[level.upperIndex]?.values;
      if (lowerValues) droppedValueCount += Math.max(0, lowerValues.length - count);
      if (upperValues) droppedValueCount += Math.max(0, upperValues.length - count);
      for (let i = 0; i < count; i++) {
        const low = odczytajLiczbe(lowerValues, i);
        const high = odczytajLiczbe(upperValues, i);
        if (low.rejected) droppedValueCount += 1;
        if (high.rejected) droppedValueCount += 1;
        // Krok z jedną krawędzią WYPADA. Domknięcie go centrum albo drugą
        // krawędzią dałoby pasmo o szerokości połowicznej i wyglądające na
        // policzone - a brak danych ma wyglądać na brak danych.
        if (low.value === null || high.value === null) continue;
        const inverted = high.value < low.value - tolerancja(low.value, high.value);
        if (inverted) invertedLabels.push(labels[i]);
        const lower = Math.min(low.value, high.value);
        const upper = Math.max(low.value, high.value);
        bandSteps.push({
          index: i,
          lower: pewnaLiczba(lower),
          upper: pewnaLiczba(upper),
          width: pewnaLiczba(Math.max(0, upper - lower)),
          isForecast: isForecast(i),
          inverted,
          isAnchor: false,
        });
      }
    } else if (level.pct !== null && level.pct > 0) {
      // Droga pochodna: pasmo liczone jako procent WARTOŚCI CENTRALNEJ, więc
      // istnieje tylko tam, gdzie centrum jest znane, i tylko na prognozie -
      // pasmo nad pomiarem twierdziłoby, że pomiar jest przedziałem.
      const half = level.pct / 100;
      const from = forecastFrom ?? count;
      // KOTWICA na ostatniej obserwacji: wielokąt pasma musi wychodzić
      // z punktu, w którym prognoza się odrywa od danych. Bez niej pasmo
      // startuje pół kroku za granicą i między linią a pasmem zostaje
      // przerwa, którą czytelnik odczytuje jako "tu jeszcze wiemy dokładnie".
      if (from >= 1 && from <= count - 1) {
        const anchor = centralValueByIndex.get(from - 1);
        if (anchor !== undefined) {
          bandSteps.push({
            index: from - 1,
            lower: pewnaLiczba(anchor),
            upper: pewnaLiczba(anchor),
            width: 0,
            isForecast: false,
            inverted: false,
            isAnchor: true,
          });
        }
      }
      for (let i = from; i < count; i++) {
        const central = centralValueByIndex.get(i);
        if (central === undefined) continue;
        const spread = Math.abs(central) * half;
        const lower = central - spread;
        const upper = central + spread;
        bandSteps.push({
          index: i,
          lower: pewnaLiczba(lower),
          upper: pewnaLiczba(upper),
          width: pewnaLiczba(Math.max(0, upper - lower)),
          isForecast: true,
          inverted: false,
          isAnchor: false,
        });
      }
    }
    zbudowane.push({ level, steps: bandSteps });
  }

  /* --- KOLEJNOŚĆ WARSTW ----------------------------------------------- */

  // Szerokości POTRZEBNE DO SORTOWANIA liczymy przed przypisaniem warstw, bo
  // bez zadeklarowanej pewności to one są jedyną podstawą kolejności.
  const zmierzone = zbudowane.map((entry) => {
    const real = entry.steps.filter((s) => !s.isAnchor);
    let max = 0;
    let sum = 0;
    for (const step of real) {
      if (step.width > max) max = step.width;
      sum += step.width;
    }
    return {
      ...entry,
      maxWidth: pewnaLiczba(max),
      meanWidth: real.length > 0 ? pewnaLiczba(sum / real.length) : 0,
    };
  });

  // KOLEJNOŚĆ Z DEKLARACJI, GDY DEKLARACJA JEST PEŁNA. To jest ta decyzja,
  // która pozwala wykryć pasmo 95% węższe od 80%: gdyby model sortował po
  // zmierzonej szerokości, przykleiłby etykiety po kolei i defekt
  // zniknąłby bez śladu. Przy pewnościach nieznanych nie ma deklaracji, więc
  // sortujemy po szerokości - i wtedy sprawdzenie kolejności MILCZY (`null`),
  // bo sprawdzałoby własne sortowanie.
  const wszystkieZnane =
    zmierzone.length > 0 && zmierzone.every((e) => e.level.confidence !== null);
  const posortowane = [...zmierzone].sort((a, b) => {
    if (wszystkieZnane) {
      const ca = a.level.confidence ?? 0;
      const cb = b.level.confidence ?? 0;
      if (cb !== ca) return cb - ca;
    }
    if (b.maxWidth !== a.maxWidth) return b.maxWidth - a.maxWidth;
    return b.meanWidth - a.meanWidth;
  });

  const levels: FanLevel[] = posortowane.map((entry, layer) => {
    let maxAsymmetry: number | null = null;
    for (const step of entry.steps) {
      if (step.isAnchor || !(step.width > 0)) continue;
      const central = centralValueByIndex.get(step.index);
      if (central === undefined) continue;
      const gora = step.upper - central;
      const dol = central - step.lower;
      const value = udzial(Math.abs(gora - dol), step.width);
      if (maxAsymmetry === null || value > maxAsymmetry) maxAsymmetry = value;
    }
    return {
      key: entry.level.key,
      confidence: entry.level.confidence,
      layer,
      overlapDepth: layer,
      steps: entry.steps,
      segments: nasegmenty(entry.steps),
      maxWidth: entry.maxWidth,
      meanWidth: entry.meanWidth,
      maxAsymmetry,
    };
  });

  /* --- PIERŚCIENIE ---------------------------------------------------- */

  const { rings, ringsComplete } = zbudujPierscienie(levels);

  /* --- UCZCIWOŚĆ ------------------------------------------------------ */

  const honesty = policzUczciwosc({
    labels,
    steps,
    levels,
    boundary,
    centralValueByIndex,
    centralGapLabels,
    invertedLabels,
    unpairedEdgeNames,
    duplicateEdgeNames,
    extraSeriesNames,
    outOfRangeConfidences,
    droppedValueCount,
    boundaryDropped,
    observationCount,
    wszystkieZnane,
    bandSource,
  });

  return {
    steps,
    centralSegments,
    levels,
    rings,
    ringsComplete,
    boundary,
    bandSource,
    centralSource,
    honesty,
  };
}

/**
 * Pierścienie z gotowych warstw.
 *
 * Warstwa `k` daje dwa paski: dolny między jej dolną krawędzią a dolną
 * krawędzią warstwy `k+1`, i górny między górną krawędzią `k+1` a jej własną.
 * Najwęższa warstwa nie ma nic pod sobą, więc daje jeden pasek "core" równy
 * całemu jej pasmu.
 *
 * PIERŚCIENIE POWSTAJĄ WYŁĄCZNIE NA KROKACH WSPÓLNYCH dla obu warstw. Gdyby
 * pasek dolny liczyć tam, gdzie węższej warstwy nie ma, sięgałby do krawędzi
 * warstwy szerszej, czyli pokrywałby obszar, który należy do pasma węższego -
 * i najwęższy poziom pewności zniknąłby dokładnie w tym kroku, w którym ma
 * lukę. Zamiast tego mówimy o tym wprost (`ringsComplete: false`), a renderer
 * bierze wtedy pełne pasma.
 */
function zbudujPierscienie(levels: readonly FanLevel[]): {
  rings: FanRing[];
  ringsComplete: boolean;
} {
  if (levels.length === 0) return { rings: [], ringsComplete: true };
  const byIndex = levels.map((level) => {
    const map = new Map<number, FanBandStep>();
    for (const step of level.steps) map.set(step.index, step);
    return map;
  });
  const rings: FanRing[] = [];
  let covered = 0;
  const innermost = levels.length - 1;

  for (let layer = 0; layer < innermost; layer++) {
    const inner = byIndex[layer + 1];
    const lower: FanRingStep[] = [];
    const upper: FanRingStep[] = [];
    for (const step of levels[layer].steps) {
      const narrower = inner.get(step.index);
      if (!narrower) continue;
      lower.push({
        index: step.index,
        from: Math.min(step.lower, narrower.lower),
        to: Math.max(step.lower, narrower.lower),
        isForecast: step.isForecast,
      });
      upper.push({
        index: step.index,
        from: Math.min(narrower.upper, step.upper),
        to: Math.max(narrower.upper, step.upper),
        isForecast: step.isForecast,
      });
    }
    if (lower.length > 0) rings.push({ layer, side: "lower", segments: nasegmenty(lower) });
    if (upper.length > 0) rings.push({ layer, side: "upper", segments: nasegmenty(upper) });
  }

  const core: FanRingStep[] = levels[innermost].steps.map((step) => ({
    index: step.index,
    from: step.lower,
    to: step.upper,
    isForecast: step.isForecast,
  }));
  if (core.length > 0) {
    rings.push({ layer: innermost, side: "core", segments: nasegmenty(core) });
  }

  // Kompletność: czy każdy krok, w którym JAKAKOLWIEK warstwa ma pasmo,
  // jest obecny we WSZYSTKICH warstwach. Tylko wtedy suma pierścieni pokrywa
  // pasmo najszersze bez dziur.
  const wszystkie = new Set<number>();
  for (const level of levels) for (const step of level.steps) wszystkie.add(step.index);
  for (const index of wszystkie) {
    if (byIndex.every((map) => map.has(index))) covered += 1;
  }
  return { rings, ringsComplete: covered === wszystkie.size };
}

/** Wejście liczenia uczciwości - zebrane, żeby sprawdzenia miały jedno miejsce. */
interface WejscieUczciwosci {
  labels: readonly string[];
  steps: readonly FanStep[];
  levels: readonly FanLevel[];
  boundary: FanBoundary | null;
  centralValueByIndex: ReadonlyMap<number, number>;
  centralGapLabels: readonly string[];
  invertedLabels: readonly string[];
  unpairedEdgeNames: readonly string[];
  duplicateEdgeNames: readonly string[];
  extraSeriesNames: readonly string[];
  outOfRangeConfidences: readonly number[];
  droppedValueCount: number;
  boundaryDropped: boolean;
  observationCount: number;
  wszystkieZnane: boolean;
  bandSource: FanBandSource;
}

/**
 * Wszystkie sprawdzenia uczciwości wachlarza w jednym miejscu.
 *
 * Rozbicie na osobne funkcje per orzeczenie wyglądałoby czyściej, ale
 * kosztowałoby to, na czym tu najbardziej zależy: sprawdzenia dzielą jedno
 * przejście po tych samych krokach i te same tolerancje, a rozjazd tolerancji
 * między dwoma sprawdzeniami dałby model, który jednocześnie twierdzi, że
 * pasma są zagnieżdżone i że się przecinają.
 */
function policzUczciwosc(w: WejscieUczciwosci): FanHonesty {
  const centralOutsideLabels: string[] = [];
  const crossingLabels: string[] = [];
  const zeroWidthLabels: string[] = [];
  const narrowingLabels: string[] = [];
  const bandOverHistoryLabels: string[] = [];
  const misorderedConfidences: number[] = [];

  const etykieta = (index: number): string => w.labels[index] ?? "";

  /* --- ZAWIERANIE CENTRUM ------------------------------------------- */

  let containCheckable = 0;
  for (const level of w.levels) {
    for (const step of level.steps) {
      const central = w.centralValueByIndex.get(step.index);
      if (central === undefined) continue;
      containCheckable += 1;
      const tol = tolerancja(step.lower, step.upper, central);
      if (central < step.lower - tol || central > step.upper + tol) {
        if (!centralOutsideLabels.includes(etykieta(step.index))) {
          centralOutsideLabels.push(etykieta(step.index));
        }
      }
    }
  }
  const bandsContainCentral = containCheckable === 0 ? null : centralOutsideLabels.length === 0;

  /* --- ZAGNIEŻDŻENIE ------------------------------------------------- */

  let nestCheckable = 0;
  for (let layer = 0; layer + 1 < w.levels.length; layer++) {
    const inner = new Map<number, FanBandStep>();
    for (const step of w.levels[layer + 1].steps) inner.set(step.index, step);
    for (const step of w.levels[layer].steps) {
      const narrower = inner.get(step.index);
      if (!narrower) continue;
      nestCheckable += 1;
      const tol = tolerancja(step.lower, step.upper, narrower.lower, narrower.upper);
      const zagniezdzone = narrower.lower >= step.lower - tol && narrower.upper <= step.upper + tol;
      if (!zagniezdzone && !crossingLabels.includes(etykieta(step.index))) {
        crossingLabels.push(etykieta(step.index));
      }
    }
  }
  const bandsNested =
    w.levels.length < 2 || nestCheckable === 0 ? null : crossingLabels.length === 0;

  /* --- DEKLARACJA WOBEC ZMIERZONEJ SZEROKOŚCI ------------------------ */

  // Sprawdzamy DANE AUTORA, nie własne sortowanie - dlatego warunkiem jest
  // pełna deklaracja pewności na wszystkich poziomach. Porównanie idzie po
  // szerokości ŚREDNIEJ, a nie maksymalnej: maksimum jest jedną liczbą z
  // jednego kroku i wystarczy jeden odstający krok, żeby o kolejności całego
  // pasma orzekł przypadek.
  let confidenceMatchesWidth: boolean | null = null;
  if (w.wszystkieZnane && w.levels.length >= 2) {
    confidenceMatchesWidth = true;
    for (let layer = 0; layer + 1 < w.levels.length; layer++) {
      const szerszy = w.levels[layer];
      const wezszy = w.levels[layer + 1];
      const tol = tolerancja(szerszy.meanWidth, wezszy.meanWidth);
      if (szerszy.meanWidth < wezszy.meanWidth - tol) {
        confidenceMatchesWidth = false;
        for (const level of [szerszy, wezszy]) {
          if (level.confidence !== null && !misorderedConfidences.includes(level.confidence)) {
            misorderedConfidences.push(level.confidence);
          }
        }
      }
    }
  }

  /* --- SZEROKOŚĆ DODATNIA, PASMO NAD HISTORIĄ ------------------------ */

  let widthCheckable = 0;
  for (const level of w.levels) {
    for (const step of level.steps) {
      if (step.isAnchor) continue;
      widthCheckable += 1;
      const tol = tolerancja(step.lower, step.upper);
      if (!(step.width > tol)) {
        if (!zeroWidthLabels.includes(etykieta(step.index))) {
          zeroWidthLabels.push(etykieta(step.index));
        }
      } else if (!step.isForecast) {
        if (!bandOverHistoryLabels.includes(etykieta(step.index))) {
          bandOverHistoryLabels.push(etykieta(step.index));
        }
      }
    }
  }
  const bandsHaveWidth = widthCheckable === 0 ? null : zeroWidthLabels.length === 0;

  /* --- NOŚNIKI ODRÓŻNIENIA PROGNOZY ---------------------------------- */

  const carriers: FanCarrier[] = [];
  const pasmoWPrognozie = w.levels.some((level) =>
    level.steps.some((step) => !step.isAnchor && step.isForecast && step.width > 0),
  );
  if (pasmoWPrognozie) carriers.push("band");
  if (w.boundary !== null && w.boundary.forecastCount > 0) carriers.push("zone");
  if (w.boundary !== null) carriers.push("separator");
  const forecastDistinguished = w.boundary === null ? null : carriers.length === 3;

  /* --- CIĄGŁOŚĆ ŚCIEŻKI W PROGNOZIE ---------------------------------- */

  let centralContinuousInForecast: boolean | null = null;
  if (w.boundary !== null) {
    const prognoza = w.steps.filter((s) => s.isForecast);
    centralContinuousInForecast =
      prognoza.length === 0 ? null : prognoza.every((s) => s.central !== null);
  }

  /* --- SZEROKI START, ZWĘŻANIE, STAŁA SZEROKOŚĆ ---------------------- */

  let firstStepWidthShare: number | null = null;
  let constantWidth: boolean | null = null;
  // Podejrzenie o szeroki start ma sens WYŁĄCZNIE przy co najmniej dwóch
  // krokach prognozy z pasmem. Przy jednym kroku udział pierwszego kroku
  // wobec maksimum wynosi 1 z definicji (pierwszy krok JEST maksimum), więc
  // ostrzeżenie odpalałoby się zawsze i nie mówiłoby niczego o danych.
  let porownywalnaPrognoza = false;
  const najszerszy = w.levels[0];
  if (najszerszy && w.boundary !== null) {
    const prognoza = najszerszy.steps.filter((s) => !s.isAnchor && s.isForecast);
    if (prognoza.length > 0) {
      firstStepWidthShare = udzial(prognoza[0].width, najszerszy.maxWidth);
    }
    if (prognoza.length >= FAN_MIN_FORECAST_STEPS) {
      porownywalnaPrognoza = true;
      const pierwsza = prognoza[0].width;
      constantWidth = prognoza.every(
        (s) => Math.abs(s.width - pierwsza) <= tolerancja(s.width, pierwsza),
      );
      for (let i = 1; i < prognoza.length; i++) {
        const poprzednia = prognoza[i - 1].width;
        const teraz = prognoza[i].width;
        if (teraz < poprzednia - tolerancja(teraz, poprzednia)) {
          narrowingLabels.push(etykieta(prognoza[i].index));
        }
      }
    }
  }
  const wideAtStart =
    porownywalnaPrognoza &&
    firstStepWidthShare !== null &&
    firstStepWidthShare >= FAN_WIDE_START_SHARE;

  return {
    bandsContainCentral,
    centralOutsideLabels,
    bandsNested,
    crossingLabels,
    confidenceMatchesWidth,
    misorderedConfidences,
    bandsHaveWidth,
    zeroWidthLabels,
    bandPairsOrdered: bandPairsOrdered(w),
    invertedLabels: [...w.invertedLabels],
    forecastDistinguished,
    carriers,
    centralContinuousInForecast,
    centralGapLabels: [...w.centralGapLabels],
    firstStepWidthShare,
    wideAtStart,
    narrowingLabels,
    constantWidth,
    bandOverHistoryLabels,
    unpairedEdgeNames: [...w.unpairedEdgeNames],
    duplicateEdgeNames: [...w.duplicateEdgeNames],
    outOfRangeConfidences: [...w.outOfRangeConfidences],
    extraSeriesNames: [...w.extraSeriesNames],
    droppedValueCount: Math.max(0, Math.round(pewnaLiczba(w.droppedValueCount))),
    boundaryDropped: w.boundaryDropped,
    observationCount: Math.max(0, Math.round(pewnaLiczba(w.observationCount))),
  };
}

/**
 * Czy pary krawędzi są uporządkowane (dolna nie wyżej od górnej).
 *
 * ODPOWIEDŹ ZALEŻY OD ŹRÓDŁA PASM, i to jest tu cała treść. Odwrócona para
 * jest wyrażalna tylko wtedy, gdy autor podał DWIE kolumny; droga pochodna
 * (`levels`, `bandPct`) liczy obie krawędzie z jednej liczby i z jednego
 * znaku, więc odwrócenie jest tam niewyrażalne. Bez tego rozróżnienia model
 * odpowiadałby `true` na pytanie, którego nie da się postawić - czyli
 * zaświadczałby zamiast milczeć, a to jest dokładnie ten defekt, przed którym
 * suma kontrolna mostka broni się polem `checkable`.
 */
function bandPairsOrdered(w: WejscieUczciwosci): boolean | null {
  if (w.bandSource !== "series") return null;
  const maPary = w.levels.some((level) => level.steps.some((step) => !step.isAnchor));
  if (!maPary) return null;
  return w.invertedLabels.length === 0;
}

/**
 * Model z konfiguracji bloku - jedyna droga, którą silnik musi znać.
 *
 * Czyta OBECNE pola (`forecastFrom`, `forecastBandPct`) i nazwy serii, więc
 * działa bez żadnego rozszerzenia schematu. Proponowane `fanLevels` wchodzi
 * przez `opts.levels` i wtedy bije drogę procentową.
 */
export function fanModelFromConfig(config: ChartConfig, opts: FanOptions = {}): FanModel {
  return fanModel(
    { categories: config.categories, series: config.series },
    {
      forecastFrom: opts.forecastFrom ?? config.forecastFrom,
      bandPct: opts.bandPct ?? config.forecastBandPct,
      levels: opts.levels,
      centralSeriesIndex: opts.centralSeriesIndex,
    },
  );
}

/**
 * Zakres wartości wachlarza - domena osi. Obejmuje KRAWĘDZIE PASM, nie tylko
 * ścieżkę centralną.
 *
 * To nie jest szczegół. Skala policzona z samej linii pozwala pasmu wyjść
 * ponad najwyższą podziałkę i zostać przyciętym krawędzią rysunku, a przycięte
 * pasmo niepewności jest GORSZE od braku pasma: sugeruje, że niepewność
 * kończy się tam, gdzie kończy się obszar kreślenia. Ta sama reguła stoi za
 * `forecastBandExtent` w `../scale`.
 *
 * Zero NIE JEST tu domykane. Wachlarz jest rodzajem liniowym, a dla linii
 * zero nie jest wymagane (sekcja 8) - wymagane jest OZNACZENIE ucięcia, i to
 * robi `isZeroBaselineBroken` w `../honesty`. Domknięcie zera na szeregu
 * dużych poziomów spłaszczyłoby pasma do niewidoczności, czyli usunęłoby
 * z wykresu jego treść.
 */
export function fanExtent(model: FanModel): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const point of model.centralSegments.flat()) {
    if (point.value < min) min = point.value;
    if (point.value > max) max = point.value;
  }
  for (const level of model.levels) {
    for (const step of level.steps) {
      if (step.lower < min) min = step.lower;
      if (step.upper > max) max = step.upper;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };
  return { min, max };
}

/* ------------------------------------------------------------------ *
 * ALTERNATYWA TEKSTOWA                                                *
 * ------------------------------------------------------------------ */

/**
 * STAŁE kolumny tabeli danych pod wykresem. Kolumny pasm są dynamiczne (po
 * dwie na poziom pewności), więc idą osobno w `FanTable.levels` - inaczej ta
 * lista musiałaby zmieniać długość razem z danymi, a wtedy przestałaby być
 * kontraktem.
 *
 * "phase" jest w tej liście, bo tabela musi nieść to samo rozróżnienie, które
 * na rysunku niosą trzy nośniki. Tabela bez kolumny fazy podaje prognozę
 * i pomiar w jednej kolumnie liczb - i cała ostrożność wykresu kończy się
 * w miejscu, w którym ktoś skopiuje liczby do arkusza.
 */
export const FAN_COLUMNS = ["step", "phase", "central"] as const;

export type FanColumnKey = (typeof FAN_COLUMNS)[number];

/** Przypis przy wierszu tabeli - dokładnie te same fakty co w `honesty`. */
export type FanRowNote =
  | "gap"
  | "centralOutside"
  | "crossing"
  | "zeroWidth"
  | "inverted"
  | "bandOverHistory"
  | "narrowing"
  | "anchor"
  | "boundary";

/** Jedna komórka pasma: krawędzie i szerokość jednego poziomu w jednym kroku. */
export interface FanTableBand {
  levelKey: string;
  confidence: number | null;
  lower: number | null;
  upper: number | null;
  width: number | null;
}

export interface FanTableRow {
  index: number;
  label: string;
  phase: "history" | "forecast";
  central: number | null;
  /** Pasma w kolejności warstw - ta sama, w której są rysowane. */
  bands: FanTableBand[];
  notes: FanRowNote[];
}

export interface FanTable {
  /**
   * Wiersze w kolejności KROKÓW CZASU, czyli tej samej co na osi. Wachlarz
   * niczego nie sortuje (inaczej niż tornado), bo czas ma jedną poprawną
   * kolejność i przestawienie go byłoby zmianą treści.
   */
  rows: FanTableRow[];
  /** Poziomy w kolejności warstw - nagłówki kolumn pasm. */
  levels: { key: string; confidence: number | null; layer: number }[];
  boundary: FanBoundary | null;
  bandSource: FanBandSource;
  /**
   * Czy którykolwiek poziom ma ZNANĄ pewność. `false` znaczy, że nagłówki
   * kolumn pasm nie mogą powiedzieć "80%" - tylko "pasmo". Renderer, który
   * dopisze tam procent, dopisze liczbę, której autor nie podał.
   */
  hasKnownConfidence: boolean;
  /**
   * Liczba obserwacji na odcinku historycznym - do podpisu razem ze źródłem
   * i datą danych.
   */
  observationCount: number;
}

/**
 * Tabela danych z GOTOWEGO modelu - te same liczby, z których powstał
 * rysunek, a nie policzone po raz drugi inną drogą.
 *
 * Przy wachlarzu ta zasada waży więcej niż przy innych rodzajach. Krawędź
 * pasma jest jedyną liczbą na tym wykresie, której nie da się odczytać
 * z rysunku: pasmo ma 10-11% krycia, nie ma przy sobie podziałki, a przy
 * trzech zagnieżdżonych poziomach czytelnik nie odróżni krawędzi 80% od 95%
 * na oko. Gdyby tabela liczyła krawędzie samodzielnie (na przykład z centrum
 * i procentu), różniłaby się od rysunku przy każdym pasmie podanym wprost -
 * i nikt by tego nie zauważył, bo obie liczby wyglądałyby wiarygodnie.
 */
export function fanTable(model: FanModel): FanTable {
  const outside = new Set(model.honesty.centralOutsideLabels);
  const crossing = new Set(model.honesty.crossingLabels);
  const zeroWidth = new Set(model.honesty.zeroWidthLabels);
  const inverted = new Set(model.honesty.invertedLabels);
  const overHistory = new Set(model.honesty.bandOverHistoryLabels);
  const narrowing = new Set(model.honesty.narrowingLabels);

  const byLevel = model.levels.map((level) => {
    const map = new Map<number, FanBandStep>();
    for (const step of level.steps) map.set(step.index, step);
    return { level, map };
  });

  const rows: FanTableRow[] = model.steps.map((step) => {
    const notes: FanRowNote[] = [];
    if (step.central === null) notes.push("gap");
    if (outside.has(step.label)) notes.push("centralOutside");
    if (crossing.has(step.label)) notes.push("crossing");
    if (zeroWidth.has(step.label)) notes.push("zeroWidth");
    if (inverted.has(step.label)) notes.push("inverted");
    if (overHistory.has(step.label)) notes.push("bandOverHistory");
    if (narrowing.has(step.label)) notes.push("narrowing");
    if (model.boundary !== null && step.index === model.boundary.lastObservation) {
      notes.push("boundary");
    }
    if (byLevel.some((entry) => entry.map.get(step.index)?.isAnchor === true)) {
      notes.push("anchor");
    }
    const bands: FanTableBand[] = byLevel.map((entry) => {
      const band = entry.map.get(step.index);
      return {
        levelKey: entry.level.key,
        confidence: entry.level.confidence,
        lower: band ? band.lower : null,
        upper: band ? band.upper : null,
        width: band ? band.width : null,
      };
    });
    return {
      index: step.index,
      label: step.label,
      phase: step.isForecast ? "forecast" : "history",
      central: step.central,
      bands,
      notes,
    };
  });

  return {
    rows,
    levels: model.levels.map((level) => ({
      key: level.key,
      confidence: level.confidence,
      layer: level.layer,
    })),
    boundary: model.boundary,
    bandSource: model.bandSource,
    hasKnownConfidence: model.levels.some((level) => level.confidence !== null),
    observationCount: model.honesty.observationCount,
  };
}

/* ------------------------------------------------------------------ *
 * DOBÓR FORMY                                                         *
 * ------------------------------------------------------------------ */

/**
 * PORADY DOBORU FORMY - osobno od uczciwości, bo to nie defekty danych, tylko
 * sygnały, że pytanie analityczne lepiej postawić inną formą. Tak samo jak
 * `pieFormAdvice` w `../honesty` i `tornadoFormAdvice`.
 */
export type FanFormAdvice =
  | "noForecast"
  | "noBand"
  | "noCentral"
  | "singleForecastStep"
  | "singleLevel"
  | "tooManyLevels"
  | "constantBand";

export function fanFormAdvice(model: FanModel): FanFormAdvice[] {
  const advice: FanFormAdvice[] = [];
  // Bez granicy prognozy wachlarz jest zwykłym wykresem liniowym - i to nie
  // jest wada, tylko inny rodzaj. Autor musi jednak dostać jedno zdanie,
  // czego brakuje, bo wybrał formę, która bez prognozy nie ma treści.
  if (model.boundary === null) advice.push("noForecast");
  if (model.levels.length === 0) advice.push("noBand");
  if (model.centralSegments.length === 0) advice.push("noCentral");
  if (
    model.boundary !== null &&
    model.boundary.forecastCount > 0 &&
    model.boundary.forecastCount < FAN_MIN_FORECAST_STEPS
  ) {
    advice.push("singleForecastStep");
  }
  // Jeden poziom nie jest defektem: pasmo jest, prognoza jest odróżniona,
  // a "±12%" bywa wszystkim, co autor ma. Jest natomiast sygnałem, że
  // wachlarz nie robi tu tego, po co się go bierze - nie pokazuje KSZTAŁTU
  // niepewności, tylko jej jedną szerokość.
  if (model.levels.length === 1) advice.push("singleLevel");
  if (model.levels.length > FAN_LEVELS_ADVICE_MAX) advice.push("tooManyLevels");
  if (model.honesty.constantWidth === true) advice.push("constantBand");
  return advice;
}
