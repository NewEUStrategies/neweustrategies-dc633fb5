// Model wykresu tornado (wrażliwość wyniku na wiele parametrów).
//
// PYTANIE ANALITYCZNE, KTÓREGO DOTYCZY. Tabela doboru formy (sekcja 1
// specyfikacji) stawia tornado w wierszu "Wrażliwość na wiele parametrów",
// a w kolumnie "Czego unikać" ma jedną pozycję: "seria osobnych wykresów".
// I to jest cała racja bytu tego rodzaju. Dziesięć osobnych paneli, po jednym
// na parametr, nie odpowiada na pytanie, które autor faktycznie zadaje -
// KTÓRY parametr rusza wynikiem najmocniej. Odpowiedź na to pytanie jest
// PORÓWNANIEM DŁUGOŚCI, a długości leżące na dziesięciu różnych panelach,
// każda przy własnej osi, porównuje się w głowie i z błędem. Tornado kładzie
// wszystkie rozpiętości na JEDNEJ osi i porządkuje je malejąco, więc ranking
// wrażliwości czyta się z sylwetki wykresu, a nie odtwarza z pamięci.
//
// CZEGO DLA TEGO RODZAJU NIE WOLNO:
//   * nie wolno rysować słupków bez przypadku bazowego. Słupek tornada
//     wychodzi Z LINII BAZOWEJ i jego długość koduje odchylenie od niej;
//     bez bazy nie ma od czego się rozchodzić, a słupek liczony od zera
//     kodowałby POZIOM wyniku przebrany za wrażliwość. Dlatego przy braku
//     bazy model MILCZY: oddaje wiersze i liczby do tabeli, ale nie oddaje
//     ani jednej nogi do narysowania (patrz `TornadoModel.base`);
//   * przypadek bazowy musi być JEDEN. Kilka różnych wartości bazowych to
//     kilka różnych wykresów wrzuconych w jeden - słupki rozchodziłyby się
//     od różnych linii, a ich długości przestałyby być porównywalne, czyli
//     ginęłaby jedyna rzecz, po którą się tu przychodzi;
//   * nie wolno normalizować pary "dolna/górna" po cichu. Parametr, którego
//     wartość dolna wypada WYŻEJ od górnej, jest defektem danych (odwrócona
//     para) i model musi go NAZWAĆ. Ciche posortowanie pary od mniejszej do
//     większej ukrywa defekt i dodatkowo gubi informację o kierunku wpływu:
//     "wynik rośnie, gdy parametr maleje" to treść analityczna, nie usterka
//     kolejności kolumn w arkuszu;
//   * nie wolno symetryzować rozpiętości wokół bazy. Asymetria ("w dół
//     wynik może spaść o 40, w górę urosnąć o 8") jest INFORMACJĄ o kształcie
//     wrażliwości, więc obie nogi liczą się osobno i żadna nie jest
//     wyprowadzana z drugiej;
//   * nie wolno milczeć o parametrze o zerowej rozpiętości. Taki wiersz nie
//     wnosi nic do rankingu, a zajmuje w nim miejsce i wygląda na pomiar -
//     trzeba go nazwać (patrz `TornadoHonesty.zeroSpanLabels`);
//   * nie wolno zmieniać kolejności wierszy na inną niż malejąca po
//     rozpiętości. Kolejność alfabetyczna albo arkuszowa likwiduje kształt
//     tornada, a z nim jedyny powód, dla którego ta forma istnieje.
//
// REGUŁY OGÓLNE, KTÓRE GO DOTYCZĄ:
//   * ZNAK KODUJEMY POZYCJĄ I KOLOREM JEDNOCZEŚNIE (sekcja 2). Model oddaje
//     dla każdej nogi `direction` ("above" / "below" / "flat") ORAZ krawędzie
//     `from` / `to` po właściwej stronie linii bazowej. Kolor semantyczny
//     (ujemny czerwień, dodatni teal niebieski) jest wtedy drugim nośnikiem
//     znaku, nie pierwszym - około 8% mężczyzn nie odróżnia czerwieni od
//     zieleni i dla nich wykres kodowany samym kolorem jest pusty;
//   * skoro znak jedzie czerwienią, na tym wykresie NIE MOŻE wystąpić
//     terakota jako seria kategorialna (`SLOTS_CLASHING_WITH_SIGN`
//     w `../palette`). Model nie przydziela wierszom slotów palety
//     w ogóle - i to jest decyzja, nie przeoczenie: tożsamość parametru
//     niesie etykieta wiersza i pozycja w rankingu, a kolor niesie WYŁĄCZNIE
//     znak odchylenia. Dwa kodowania na jednym kanale to jedno kodowanie za
//     dużo;
//   * krawędzią odniesienia jest linia bazowa, więc po jej stronie słupek ma
//     podstawę KWADRATOWĄ, a zaokrągla się tylko na końcu danych (sekcja 3).
//     Model mówi rendererowi, która krawędź jest która: dla `direction`
//     "above" odniesieniem jest `from`, dla "below" - `to`;
//   * grafika nigdy nie jest jedyną drogą do liczby (sekcja 8), dlatego
//     `tornadoTable` oddaje pełny zestaw liczb w TEJ SAMEJ kolejności, w
//     której są rysowane, i z tych samych pól modelu - nie policzonych po raz
//     drugi inną drogą;
//   * strefa trafienia nigdy nie jest kształtem elementu (sekcja 6), dlatego
//     model podaje `bandCenter` i `bandThickness`, czyli całe pasmo wiersza,
//     obok samej grubości słupka;
//   * hover zmienia stan powierzchni, nigdy kodowanie (sekcja 6): żadne pole
//     tego modelu nie zmienia się pod kursorem, bo wszystkie kodują wartość.
//
// KONWENCJA DANYCH. Silnik daje `categories` i `series` (patrz `../types`),
// czyli jedną liczbę na przecięciu serii i kategorii. Tornado czyta ten sam
// arkusz tak: JEDNA KATEGORIA TO JEDEN PARAMETR (wiersz tornada), pierwsza
// seria niosąca liczby to noga DOLNA (wynik przy dolnym końcu przedziału
// parametru), druga to noga GÓRNA. Przypadek bazowy nie ma w obecnym
// schemacie własnego pola, więc model przyjmuje go trzema drogami, w tej
// kolejności pierwszeństwa: (1) jawnie z opcji `base` - to jest miejsce dla
// proponowanego rozszerzenia konfiguracji `tornadoBase`; (2) z serii, której
// NAZWA mówi, że jest bazą ("baza", "bazowy", "base", "baseline", "punkt
// odniesienia") i która ma jedną wartość stałą; (3) z trybu `deviation`,
// w którym liczby SĄ odchyleniami od bazy, więc linia bazowa leży w zerze
// z definicji. Bez żadnej z tych trzech dróg model milczy, zamiast dorysować
// bazę z mediany albo ze średniej nóg - baza wyliczona z wyników nie jest
// przypadkiem bazowym, tylko środkiem rozkładu, a podstawianie jednego pod
// drugie jest dokładnie tym kłamstwem, przed którym cały ten moduł stoi.
import type { ChartSeries } from "../types";

/**
 * Tryb odczytu liczb z arkusza.
 *
 * "absolute" - `low` i `high` są POZIOMAMI wyniku (EBITDA w mln EUR, marża
 * w procentach). Linia bazowa musi być podana osobno, bo poziom wyniku
 * w przypadku bazowym nie da się wyprowadzić z dwóch skrajnych poziomów:
 * dla pary (90, 110) bazą może być 100, ale równie dobrze 95 albo 108,
 * i to jest różnica między "parametr jest symetryczny" a "parametr grozi
 * głównie w dół".
 *
 * "deviation" - `low` i `high` są ODCHYLENIAMI od przypadku bazowego
 * (-10, +12). Linia bazowa leży wtedy w zerze Z DEFINICJI, więc tornado
 * rysuje się bez żadnego dodatkowego pola konfiguracji - i to jest ścieżka,
 * którą obecny schemat bloku obsługuje w całości. Jeśli baza JEST znana,
 * podaj ją mimo to: model doda ją do odchyleń i tabela pokaże obok
 * odchyleń również poziomy bezwzględne.
 */
export type TornadoMode = "absolute" | "deviation";

/** Skąd wzięła się linia bazowa - do przypisu pod wykresem. */
export type TornadoBaseSource = "config" | "series" | "zero" | "none";

/**
 * Po której stronie linii bazowej leży koniec danych. To pole jest nośnikiem
 * znaku RAZEM z krawędziami `from` / `to`, a kolor semantyczny jest trzecim
 * nośnikiem - nigdy jedynym.
 */
export type TornadoDirection = "above" | "below" | "flat";

/** Która noga pary: dolny czy górny koniec przedziału parametru. */
export type TornadoSide = "low" | "high";

/**
 * Grubość słupka jako udział wysokości pasma wiersza.
 *
 * 0,72 zostawia 28% pasma na przerwę, czyli przy dwunastu wierszach i paśmie
 * 30 px daje słupek ~21,6 px i przerwę ~8,4 px. Dwie rzeczy jednocześnie:
 * słupek nie schodzi pod `BAR_MAX` (24 px w `../geometry`), więc render nie
 * musi go przycinać, a przerwa zostaje wyraźnie większa od podwójnej obwódki
 * (2 x 1,5 px), więc obwódki dwóch sąsiednich wierszy się nie stykają. Bez
 * tej przerwy sąsiadujące słupki dawałyby na styku fałszywą trzecią krawędź,
 * dokładnie tak jak łuki pierścienia bez przerwy 2,5 px (sekcja 3).
 *
 * Model nie liczy pikseli: oddaje udziały i pozwala rendererowi je
 * przeskalować, bo wysokość pola rysunku zna dopiero on.
 */
export const TORNADO_BAR_RATIO = 0.72;

/**
 * Poniżej tylu parametrów tornado nie jest tornadem. Jeden wiersz to zwykły
 * słupek dwustronny i lepiej podać liczbę w zdaniu; PORADA FORMY, nie próg
 * milczenia - model narysuje i jeden wiersz, bo jego zadaniem nie jest
 * odmawianie autorowi.
 */
export const TORNADO_MIN_PARAMS = 2;

/**
 * Powyżej tylu wierszy sylwetka tornada przestaje być czytelna: pasmo
 * wiersza schodzi pod grubość, przy której obwódka 1,5 px zjada istotną
 * część słupka, a etykiety parametrów zaczynają na siebie wchodzić. Wtedy
 * grupuj ogon albo pokaż górną część rankingu i podaj resztę w tabeli.
 * Model NIGDY nie ucina wierszy sam - obcięcie rankingu bez powiedzenia
 * o tym jest manipulacją przez kadrowanie (sekcja 8).
 */
export const TORNADO_ROWS_ADVICE_MAX = 12;

/**
 * Iloraz największej i najmniejszej rozpiętości, poniżej którego ranking
 * niczego nie rozstrzyga.
 *
 * Gdy wszystkie parametry mają rozpiętość w granicach 10%, sylwetka tornada
 * i tak układa się w klin i czytelnik odczyta z niej ranking - a tego
 * rankingu w danych nie ma, bo różnice są rzędu grubości obwódki. To nie
 * defekt danych, tylko zły dobór formy: przy płaskim rankingu lepiej podać
 * tabelę albo powiedzieć wprost, że parametry są równie ważne.
 */
export const TORNADO_FLAT_RANKING_RATIO = 1.1;

/**
 * Tolerancja remisu rozpiętości, względna.
 *
 * 0,5% to poziom, poniżej którego różnica długości jest niewidoczna: na
 * słupku 300 px daje 1,5 px, czyli mniej niż grubość obwódki. Dwa parametry
 * różniące się o tyle stoją w rankingu w kolejności, której dane nie
 * rozstrzygają, więc kolejność między nimi jest arbitralna - i trzeba to
 * powiedzieć, a nie zostawić czytelnika z przekonaniem, że wyżej znaczy
 * bardziej wrażliwy.
 */
export const SPAN_TIE_TOLERANCE_RATIO = 0.005;

/**
 * Tolerancja porównań, która odsiewa szum arytmetyki zmiennoprzecinkowej od
 * różnicy realnej. Względna, bo model nie zna swojej skali: tornado w mln
 * EUR i tornado w punktach procentowych nie mogą dzielić progu bezwzględnego
 * (ta sama zasada, co przy sumie kontrolnej mostka w `../waterfall`).
 *
 * Używana w dwóch miejscach: przy sprawdzaniu, czy kandydaci na bazę są
 * TĄ SAMĄ liczbą (0,1 + 0,2 z arkusza to 0,30000000000000004, a nie inna
 * baza), i przy wykrywaniu odwróconej pary (bez tolerancji para równa
 * z dokładnością do ostatniego bitu byłaby zgłaszana jako defekt).
 */
export const COMPARISON_TOLERANCE_RATIO = 1e-9;

/**
 * Poniżej tej części największej rozpiętości słupek jest krótszy niż
 * cokolwiek, co da się narysować, więc jego rozpiętość NAZYWAMY ZEROWĄ.
 * Miliardowa część najszerszego słupka to przy szerokości 1000 px milionowa
 * część piksela; upieranie się, że taki parametr "coś wnosi", byłoby
 * upieraniem się przy szumie ostatniego bitu.
 */
export const ZERO_SPAN_TOLERANCE_RATIO = 1e-9;

/**
 * Górny kres wartości, którą model uznaje za daną.
 *
 * TO JEST OSŁONA PRZED NIESKOŃCZONOŚCIĄ, NIE KAPRYS. Model liczy różnice
 * (`value - base`), a różnica dwóch liczb bliskich `Number.MAX_VALUE`
 * przekręca się w `Infinity`, które potem wchodzi do `Intl.NumberFormat` i
 * ląduje w `textContent` jako literalny napis. Przy |wartość| <= 2^53 - 1
 * i takiej samej bazie różnica nie przekracza 2^54, czyli zostaje skończona
 * zawsze. Drugi powód jest merytoryczny: powyżej 2^53 arytmetyka liczb
 * całkowitych w IEEE 754 przestaje być dokładna, więc taka wartość nie jest
 * pomiarem, tylko uszkodzonym rekordem - i idzie do
 * `TornadoHonesty.outOfRangeLabels`, zamiast po cichu zniknąć.
 */
export const TORNADO_VALUE_LIMIT = Number.MAX_SAFE_INTEGER;

/**
 * Rdzenie nazw, po których rozpoznajemy serię z przypadkiem bazowym.
 *
 * ROZPOZNAJEMY PO NAZWIE, NIE PO KSZTAŁCIE LICZB, i to jest ta sama decyzja,
 * którą podjął `pieModel` przy jednostce procentowej: nazwa serii jest
 * DEKLARACJĄ AUTORA, widoczną w edytorze i w legendzie, a "seria, której
 * wszystkie wartości są równe" to heurystyka, która odpaliłaby na dowolnej
 * płaskiej serii pomiarowej i nie odpaliłaby na bazie wpisanej przez pomyłkę
 * z jedną literówką. Rdzenie, a nie pełne nazwy, bo polska odmiana daje
 * "bazowy", "bazowa", "bazowe", "bazowym".
 *
 * Dopasowanie jest zawężone do serii, która NIE jest nogą pary (patrz
 * `resolveLegIndices`), więc seria pomiarowa nazwana "Scenariusz bazowy"
 * i stojąca na pierwszym miejscu zostaje nogą, a nie bazą.
 */
export const BASE_SERIES_STEMS = [
  "baza",
  "bazow",
  "podstawow",
  "odniesieni",
  "base",
  "baseline",
  "reference",
] as const;

/**
 * Jedna noga pary: słupek od linii bazowej do wyniku przy jednym końcu
 * przedziału parametru.
 */
export interface TornadoLeg {
  /** Który koniec przedziału parametru dał ten wynik. */
  side: TornadoSide;
  /** Poziom wyniku w jednostkach danych (w trybie odchyleń: baza + odchylenie). */
  value: number;
  /** Odchylenie od bazy, ze znakiem. To ONO koduje długość słupka. */
  delta: number;
  /**
   * Dolna krawędź słupka w jednostkach danych. Dla `direction` "above" jest
   * to krawędź ODNIESIENIA (linia bazowa), czyli ta z kwadratową podstawą.
   */
  from: number;
  /**
   * Górna krawędź słupka w jednostkach danych. Dla `direction` "below" jest
   * to krawędź ODNIESIENIA, czyli ta z kwadratową podstawą; koniec danych
   * jest wtedy na dole (patrz sekcja 3: kierunek gradientu i zaokrąglenia
   * idzie za znakiem wartości, nie za pionem).
   */
  to: number;
  /**
   * Strona linii bazowej. Nośnik znaku RAZEM z pozycją; render dokłada kolor
   * semantyczny jako trzeci nośnik, nigdy jako jedyny.
   */
  direction: TornadoDirection;
}

/** Kompletność pary dla jednego parametru. */
export type TornadoPairState = "complete" | "lowOnly" | "highOnly" | "empty";

export interface TornadoRow {
  /** Indeks kategorii w konfiguracji - PRZED sortowaniem. */
  index: number;
  /** Pozycja po sortowaniu, 0 = najszerszy słupek (wierzch tornada). */
  rank: number;
  label: string;
  /**
   * Poziom wyniku przy dolnym końcu parametru; `null` = autor nie podał
   * liczby. W trybie odchyleń to baza plus odchylenie, więc liczba jest
   * porównywalna z `high` bez dalszych przeliczeń.
   */
  low: number | null;
  /** Poziom wyniku przy górnym końcu parametru; `null` = brak liczby. */
  high: number | null;
  /** `low` minus baza. `null`, gdy nie ma nogi albo nie ma bazy. */
  lowDelta: number | null;
  /** `high` minus baza. `null`, gdy nie ma nogi albo nie ma bazy. */
  highDelta: number | null;
  /**
   * `high` minus `low` - KIERUNEK WPŁYWU parametru na wynik, ze znakiem.
   * Ujemny znaczy "wynik rośnie, gdy parametr maleje" i jest treścią
   * analityczną, nie usterką kolejności kolumn. `null` = para niekompletna.
   */
  swing: number | null;
  /**
   * ROZPIĘTOŚĆ WIDOCZNA: odległość między skrajnymi krawędziami wiersza,
   * czyli `max(to) - min(from)` po nogach, z linią bazową włączoną.
   *
   * TO ONA SORTUJE, I NIE JEST TO TO SAMO CO |high - low|. Dla pary, która
   * bazę obejmuje (low pod bazą, high nad bazą), obie liczby są równe. Gdy
   * jednak oba końce parametru pchają wynik w TĘ SAMĄ stronę (baza 0, low 5,
   * high 9 - odpowiedź nie jest monotoniczna albo baza nie leży między
   * końcami), słupek jest rysowany od bazy do 9, czyli ma szerokość 9, a nie
   * 4. Sortowanie po |high - low| dawałoby wtedy wiersz szerszy NIŻEJ
   * i sylwetka przestawałaby być klinem, czyli wykres pokazywałby ranking
   * inny niż ten, który sam narysował.
   *
   * Rozpiętość widoczna ma przy tym sens merytoryczny, nie tylko graficzny:
   * jest to pełny zakres, w jakim wynik może się znaleźć na przedziale
   * parametru RAZEM z przypadkiem bazowym, czyli dokładnie to, o co pyta
   * analiza wrażliwości.
   */
  span: number;
  /** Udział rozpiętości w największej rozpiętości modelu, 0..1. */
  spanShare: number;
  /**
   * Asymetria rozpiętości wokół bazy: (|góra - baza| - |baza - dół|) / span,
   * zakres -1..1. Dodatnia znaczy "więcej miejsca w górę".
   *
   * To POLE INFORMACYJNE, nie ostrzeżenie. Asymetria jest właściwością
   * wrażliwości i nie wolno jej symetryzować (uśredniać nóg, dorysowywać
   * brakującej strony), bo "wynik może spaść o 40, a urosnąć o 8" jest
   * całą treścią takiego wiersza. `null` = nie ma czego mierzyć: brak bazy,
   * niekompletna para albo zerowa rozpiętość.
   */
  asymmetry: number | null;
  /**
   * Nogi do narysowania, w kolejności dolna, górna - tylko te, które mają
   * liczbę. PUSTA TABLICA, GDY NIE MA BAZY: bez linii bazowej słupek nie ma
   * od czego się rozchodzić, więc model nie oddaje geometrii, choć liczby
   * (`low`, `high`, `span`) zostają do tabeli.
   */
  legs: TornadoLeg[];
  /** Kompletność pary - do przypisu przy wierszu. */
  pair: TornadoPairState;
  /** Dolna wartość wyżej od górnej: odwrócona para, DEFEKT danych. */
  inverted: boolean;
  /** Rozpiętość zerowa: parametr nie wnosi nic do rankingu. */
  zeroSpan: boolean;
  /**
   * Czy końce leżą po PRZECIWNYCH stronach bazy. `false` przy parze
   * jednostronnej i przy niekompletnej. Informacja, nie defekt - patrz
   * `TornadoHonesty.oneSidedLabels`.
   */
  straddlesBase: boolean;
  /** Rozpiętość praktycznie równa sąsiadowi w rankingu - kolejność arbitralna. */
  tiedWithNeighbour: boolean;
  /** Środek pasma wiersza jako udział wysokości obszaru kreślenia, 0..1. */
  bandCenter: number;
  /** Wysokość pasma wiersza jako udział wysokości obszaru kreślenia. */
  bandThickness: number;
  /** Grubość słupka jako udział wysokości obszaru kreślenia. */
  barThickness: number;
}

/**
 * SPRAWDZENIA UCZCIWOŚCI. Konwencja repo, ta sama co przy sumie kontrolnej
 * mostka (`../waterfall`) i sumie udziałów tarczy (`pieModel`):
 *   * `null` znaczy NIE MA CZEGO SPRAWDZAĆ - model wtedy MILCZY, a nie
 *     zaświadcza, że jest dobrze;
 *   * `false` znaczy WYKRYTY DEFEKT;
 *   * `true` znaczy sprawdzone i w porządku.
 * Listy etykiet są osobne od orzeczeń, bo podpis pod wykresem musi umieć
 * powiedzieć, KTÓRY parametr jest wadliwy, a nie tylko że któryś jest.
 */
export interface TornadoHonesty {
  /**
   * Czy przypadek bazowy jest JEDEN. `false` = kandydaci byli, ale różni
   * (seria bazowa o zmiennych wartościach albo jawna baza sprzeczna
   * z serią) - wtedy `TornadoModel.base` jest `null` w trybie bezwzględnym,
   * bo słupki rozchodzące się od dwóch różnych linii nie są porównywalne.
   * `null` = nie było ani jednego kandydata, czyli nie ma czego sprawdzać.
   */
  baseIsSingle: boolean | null;
  /** Rozrzut kandydatów na bazę (max - min). 0, gdy nie ma czego mierzyć. */
  baseSpread: number;
  /**
   * Czy pary są uporządkowane (dolna nie wyżej od górnej). `false` = jest
   * co najmniej jedna odwrócona para. `null` = żaden parametr nie ma OBU
   * nóg, więc nie ma czego porównywać.
   */
  pairsOrdered: boolean | null;
  /** Etykiety parametrów z odwróconą parą. */
  invertedLabels: string[];
  /**
   * Czy każdy parametr z liczbami ma parę kompletną. `false` = jest wiersz
   * z jedną nogą, czyli połowa przedziału parametru nie została podana
   * i słupek pokazuje wrażliwość mniejszą niż faktyczna. `null` = nie ma ani
   * jednego wiersza z liczbą.
   */
  pairsComplete: boolean | null;
  /** Etykiety parametrów z jedną nogą. */
  oneLeggedLabels: string[];
  /**
   * Czy każdy parametr z liczbami wnosi coś do rankingu. `false` = jest
   * wiersz o zerowej rozpiętości. `null` = nie ma ani jednego wiersza
   * z liczbą.
   */
  allSpansContribute: boolean | null;
  /** Etykiety parametrów o zerowej rozpiętości. */
  zeroSpanLabels: string[];
  /** Etykiety parametrów bez ani jednej liczby - wiersz zostaje pusty. */
  emptyLabels: string[];
  /**
   * Etykiety parametrów, których oba końce leżą po TEJ SAMEJ stronie bazy.
   *
   * INFORMACJA, NIE ORZECZENIE, i dlatego nie ma tu boolean. Para
   * jednostronna bywa prawdziwa: odpowiedź wyniku na parametr nie musi być
   * monotoniczna (oba końce przedziału kursu walutowego mogą obniżać zysk),
   * a wtedy słupek po jednej stronie bazy jest poprawnym obrazem. Bywa też
   * objawem pomyłki - odchylenia wpisane w trybie bezwzględnym albo baza
   * wzięta z innego scenariusza. Model podaje fakt, a rozstrzyga autor.
   */
  oneSidedLabels: string[];
  /**
   * Etykiety parametrów, których rozpiętość jest praktycznie równa
   * sąsiadowi w rankingu. Kolejność między nimi jest arbitralna, a wykres
   * i tak ustawia je jeden nad drugim, więc przypis musi to powiedzieć.
   */
  tiedSpanLabels: string[];
  /**
   * Powtórzone etykiety parametrów. Po sortowaniu duplikaty nie sąsiadują,
   * więc czytelnik widzi dwa wiersze o tej samej nazwie w dwóch różnych
   * miejscach rankingu i nie ma jak ich rozróżnić.
   */
  duplicateLabels: string[];
  /**
   * Etykiety parametrów, których wartość wypadła poza `TORNADO_VALUE_LIMIT`.
   * Taka liczba nie weszła do modelu (patrz komentarz przy stałej), więc
   * wiersz wygląda na niekompletny i trzeba powiedzieć, dlaczego.
   */
  outOfRangeLabels: string[];
  /**
   * Ile liczb z serii leżało poza zakresem kategorii, czyli nie miało nazwy
   * parametru. Zdarza się przy treści z cofniętej wersji edytora, gdzie
   * dopisano wartość, a nie dopisano kategorii. Bez nazwy nie ma czego
   * narysować, więc wartość wypada - i to musi być widoczne.
   */
  droppedValueCount: number;
  /**
   * Nazwy serii, których tornado nie czyta. Rodzaj bierze dokładnie dwie
   * nogi i najwyżej jedną bazę; trzecia seria pomiarowa znaczy, że autor
   * spodziewał się czegoś innego (na przykład trzech scenariuszy) i lepiej
   * mu to powiedzieć, niż ją przemilczeć.
   */
  extraSeriesNames: string[];
  /**
   * Największa bezwzględna asymetria rozpiętości wokół bazy, 0..1. `null` =
   * nie ma ani jednego wiersza z bazą i kompletną parą. Pole informacyjne:
   * wysoka asymetria jest treścią wykresu, nie jego usterką.
   */
  maxAsymmetry: number | null;
}

export interface TornadoModel {
  /**
   * Wiersze w kolejności MALEJĄCEJ po rozpiętości - jedyna poprawna
   * kolejność tornada. Wiersze bez liczb i o zerowej rozpiętości spadają na
   * koniec (rozpiętość 0), a nie wypadają: ich etykiety zostają w rankingu
   * i w tabeli, bo "nie podano" jest informacją.
   */
  rows: TornadoRow[];
  /**
   * Poziom przypadku bazowego w jednostkach danych. `null` znaczy NIE
   * PODANO, a to znaczy, że model MILCZY: żaden wiersz nie ma nóg, bo słupek
   * bez linii bazowej nie ma od czego się rozchodzić. Liczby zostają
   * w wierszach i w tabeli.
   */
  base: number | null;
  /** Tryb odczytu liczb, po rozstrzygnięciu opcji. */
  mode: TornadoMode;
  /** Skąd wzięła się baza - do przypisu. */
  baseSource: TornadoBaseSource;
  /** Największa rozpiętość w modelu; 0, gdy nie ma czego mierzyć. */
  maxSpan: number;
  /** Najmniejsza NIEZEROWA rozpiętość; `null`, gdy takiej nie ma. */
  minSpan: number | null;
  /**
   * Czy model przestawił kolejność wobec arkusza. Renderer i tabela muszą to
   * wiedzieć: po sortowaniu `rows[k].index` nie jest równy `k`, więc
   * cokolwiek indeksuje po kategorii, musi przejść przez `index`.
   */
  reordered: boolean;
  honesty: TornadoHonesty;
}

export interface TornadoInput {
  /** Nazwy parametrów - jedna kategoria to jeden wiersz tornada. */
  categories: readonly string[];
  series: readonly ChartSeries[];
}

export interface TornadoOptions {
  /** Tryb odczytu liczb; domyślnie poziomy bezwzględne. */
  mode?: TornadoMode;
  /**
   * Jawny przypadek bazowy. Tu wchodzi proponowane rozszerzenie
   * konfiguracji (`tornadoBase`); `null` i `undefined` znaczą "nie podano".
   */
  base?: number | null;
  /**
   * Indeksy serii z nogami pary. Domyślnie dwie pierwsze serie, które nie
   * są serią bazową. Podanie indeksów jest jedyną drogą do zamiany
   * kolejności nóg - model NIGDY nie robi tego sam, bo wtedy nie umiałby
   * wykryć odwróconej pary.
   */
  legs?: { low: number; high: number };
  /** Indeks serii z bazą; domyślnie pierwsza seria o nazwie bazowej. */
  baseSeriesIndex?: number;
}

/**
 * Minimum i maksimum PĘTLĄ, nie przez `Math.min(...tablica)`.
 *
 * Spread przekazuje każdy element jako osobny argument wywołania, a przy
 * tablicy liczonej w dziesiątkach tysięcy elementów silnik rzuca
 * `RangeError: too many arguments`. Liczba kategorii pochodzi z bazy, więc nie
 * jest ograniczona niczym, co ten moduł kontroluje, a model NIE MA PRAWA
 * RZUCIĆ - wyjątek w modelu wywraca cały wpis, nie tylko wykres.
 */
function minOf(values: readonly number[]): number {
  let min = values[0] ?? 0;
  for (const value of values) if (value < min) min = value;
  return min;
}

function maxOf(values: readonly number[]): number {
  let max = values[0] ?? 0;
  for (const value of values) if (value > max) max = value;
  return max;
}

/** Czy liczba jest daną: skończona i w zakresie dokładnej arytmetyki. */
function isUsable(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value) <= TORNADO_VALUE_LIMIT;
}

/**
 * Odczyt wartości z serii. Trzy stany, nie dwa: liczba, brak (`null`) i
 * "poza zakresem" - ten trzeci trafia do listy etykiet, zamiast udawać brak,
 * bo brak znaczy "autor nie podał", a uszkodzony rekord znaczy coś innego.
 */
function readValue(
  series: ChartSeries | undefined,
  index: number,
): { value: number | null; outOfRange: boolean } {
  if (!series) return { value: null, outOfRange: false };
  const raw = series.values[index];
  if (raw === null || raw === undefined || Number.isNaN(raw)) {
    return { value: null, outOfRange: false };
  }
  if (!isUsable(raw)) return { value: null, outOfRange: true };
  return { value: raw, outOfRange: false };
}

/** Czy dwie liczby są tą samą liczbą z dokładnością do szumu arytmetyki. */
function nearlyEqual(a: number, b: number): boolean {
  const scale = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) <= scale * COMPARISON_TOLERANCE_RATIO;
}

/** Czy `a` jest istotnie większe od `b` (a nie tylko o ostatni bit). */
function clearlyGreater(a: number, b: number): boolean {
  return a > b && !nearlyEqual(a, b);
}

/** Nazwa serii bez ogonków i wielkich liter - do dopasowania rdzeni. */
function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ł/g, "l")
    .toLowerCase()
    .trim();
}

/** Czy nazwa serii deklaruje przypadek bazowy. */
function looksLikeBaseSeries(name: string): boolean {
  const normalized = normalizeName(name);
  if (normalized.length === 0) return false;
  return BASE_SERIES_STEMS.some((stem) => normalized.includes(stem));
}

/**
 * Indeks serii z bazą. Jawna opcja ma pierwszeństwo nad nazwą, bo opcja
 * pochodzi z konfiguracji, a nazwa jest tylko jej rozpoznaniem z tekstu.
 */
function resolveBaseSeriesIndex(
  series: readonly ChartSeries[],
  explicit: number | undefined,
): number {
  if (
    explicit !== undefined &&
    Number.isInteger(explicit) &&
    explicit >= 0 &&
    explicit < series.length
  ) {
    return explicit;
  }
  for (let i = 0; i < series.length; i++) {
    if (looksLikeBaseSeries(series[i]?.name ?? "")) return i;
  }
  return -1;
}

/**
 * Indeksy nóg. Kolejność serii JEST znacząca (pierwsza to dolna) i model jej
 * nie kwestionuje - inaczej odwrócona para przestałaby być wykrywalna, patrz
 * nagłówek pliku.
 */
function resolveLegIndices(
  series: readonly ChartSeries[],
  baseSeriesIndex: number,
  explicit: { low: number; high: number } | undefined,
): { low: number; high: number } {
  const valid = (i: number): boolean => Number.isInteger(i) && i >= 0 && i < series.length;
  if (explicit && valid(explicit.low)) {
    // Ta sama seria po obu stronach dałaby każdemu parametrowi zerową
    // rozpiętość i wykres bez treści, więc druga noga wtedy nie istnieje.
    const high = valid(explicit.high) && explicit.high !== explicit.low ? explicit.high : -1;
    return { low: explicit.low, high };
  }
  const legs: number[] = [];
  for (let i = 0; i < series.length && legs.length < 2; i++) {
    if (i === baseSeriesIndex) continue;
    legs.push(i);
  }
  return { low: legs[0] ?? -1, high: legs[1] ?? -1 };
}

/**
 * MODEL TORNADA: z konfiguracji na strukturę gotową do rysowania.
 *
 * Kolejność kroków jest istotna i wygląda tak: rozdziel serie na nogi i bazę,
 * rozstrzygnij bazę (albo ustal, że jej nie ma i model milczy), zbuduj
 * wiersze w kolejności arkuszowej, POSORTUJ po rozpiętości malejąco, dopiero
 * potem policz udziały rozpiętości, pasma i remisy - bo udział liczy się
 * z największej rozpiętości, a remis dotyczy SĄSIADÓW W RANKINGU, których
 * przed sortowaniem nie ma.
 *
 * Model nie rzuca wyjątków i nie zwraca NaN ani Infinity przy żadnym
 * wejściu: treść bloku pochodzi z bazy i może być z przyszłej albo cofniętej
 * wersji edytora (pusta seria, sama luka, jedna kategoria, wartości ujemne
 * tam, gdzie nie mają sensu). Każde dzielenie w tym pliku ma osłonięty
 * mianownik, a każda liczba wejściowa przechodzi przez `readValue`.
 * Wymaganie jest twarde, bo `Intl.NumberFormat.format(NaN)` zwraca literalny
 * napis "NaN", którego bramka `blockMatrix` szuka w `textContent` strony.
 */
export function tornadoModel(input: TornadoInput, opts: TornadoOptions = {}): TornadoModel {
  const mode: TornadoMode = opts.mode === "deviation" ? "deviation" : "absolute";
  const categories = input.categories ?? [];
  const series = input.series ?? [];
  const rowCount = categories.length;

  const baseSeriesIndex = resolveBaseSeriesIndex(series, opts.baseSeriesIndex);
  const legIndices = resolveLegIndices(series, baseSeriesIndex, opts.legs);
  const lowSeries = legIndices.low >= 0 ? series[legIndices.low] : undefined;
  const highSeries = legIndices.high >= 0 ? series[legIndices.high] : undefined;

  const outOfRangeLabels: string[] = [];

  // KANDYDACI NA BAZĘ. Zbieramy WSZYSTKICH, zamiast brać pierwszego lepszego,
  // bo pytanie tego sprawdzenia brzmi "czy baza jest jedna", a na to nie da
  // się odpowiedzieć, patrząc na jedną liczbę.
  const candidates: number[] = [];
  let fromConfig = false;
  if (opts.base !== null && opts.base !== undefined && isUsable(opts.base)) {
    candidates.push(opts.base);
    fromConfig = true;
  }
  if (baseSeriesIndex >= 0) {
    const baseSeries = series[baseSeriesIndex];
    for (let i = 0; i < rowCount; i++) {
      const read = readValue(baseSeries, i);
      if (read.outOfRange) outOfRangeLabels.push(categories[i] ?? "");
      const value = read.value;
      if (value === null) continue;
      // Powtórzona ta sama baza (typowy arkusz: kolumna wypełniona jedną
      // liczbą w każdym wierszu) nie jest drugim kandydatem.
      if (!candidates.some((candidate) => nearlyEqual(candidate, value))) candidates.push(value);
    }
  }

  const baseSpread = candidates.length > 1 ? maxOf(candidates) - minOf(candidates) : 0;
  const baseIsSingle = candidates.length === 0 ? null : candidates.length === 1;

  // ROZSTRZYGNIĘCIE BAZY.
  //
  // Przy jednym kandydacie mamy bazę. Przy wielu różnych baza jest NIEZNANA
  // w trybie bezwzględnym (słupki od dwóch linii nie są porównywalne, więc
  // model milczy), ale w trybie odchyleń wykres zostaje rysowalny: odchylenia
  // są samowystarczalne, linia bazowa leży w zerze z definicji, a sprzeczność
  // deklaracji i tak jedzie w `baseIsSingle`.
  let base: number | null = null;
  let baseSource: TornadoBaseSource = "none";
  if (candidates.length === 1) {
    base = candidates[0];
    baseSource = fromConfig ? "config" : "series";
  } else if (mode === "deviation") {
    base = 0;
    baseSource = "zero";
  }

  // KROK 1: wiersze w kolejności arkuszowej, bez udziałów i bez pasm.
  interface Draft {
    index: number;
    label: string;
    low: number | null;
    high: number | null;
    legs: TornadoLeg[];
    span: number;
    swing: number | null;
    lowDelta: number | null;
    highDelta: number | null;
    inverted: boolean;
    straddlesBase: boolean;
    pair: TornadoPairState;
  }

  const drafts: Draft[] = [];
  for (let i = 0; i < rowCount; i++) {
    const label = categories[i] ?? "";
    const lowRead = readValue(lowSeries, i);
    const highRead = readValue(highSeries, i);
    if (lowRead.outOfRange || highRead.outOfRange) outOfRangeLabels.push(label);

    // W trybie odchyleń liczby są odchyleniami, więc poziom to baza plus
    // odchylenie. Normalizujemy DO POZIOMÓW raz, tutaj, żeby wszystkie dalsze
    // porównania (odwrócona para, asymetria, rozpiętość) miały jedną
    // jednostkę - inaczej każda z nich musiałaby pamiętać o trybie i któraś
    // by o nim zapomniała.
    const shift = mode === "deviation" ? (base ?? 0) : 0;
    const low = lowRead.value === null ? null : lowRead.value + shift;
    const high = highRead.value === null ? null : highRead.value + shift;

    const pair: TornadoPairState =
      low !== null && high !== null
        ? "complete"
        : low !== null
          ? "lowOnly"
          : high !== null
            ? "highOnly"
            : "empty";

    // ODWRÓCONA PARA. Porównanie na POZIOMACH, nie na odchyleniach - w trybie
    // odchyleń oba przesunięte o tę samą bazę, więc wynik jest ten sam, ale
    // kod nie musi tego wiedzieć.
    const inverted = low !== null && high !== null && clearlyGreater(low, high);

    const legs: TornadoLeg[] = [];
    let span = 0;
    let straddlesBase = false;
    let lowDelta: number | null = null;
    let highDelta: number | null = null;

    if (base !== null) {
      const currentBase = base;
      const push = (side: TornadoSide, value: number): number => {
        const delta = value - currentBase;
        legs.push({
          side,
          value,
          delta,
          from: Math.min(currentBase, value),
          to: Math.max(currentBase, value),
          direction: delta > 0 ? "above" : delta < 0 ? "below" : "flat",
        });
        return delta;
      };
      if (low !== null) lowDelta = push("low", low);
      if (high !== null) highDelta = push("high", high);
      if (legs.length > 0) {
        let min = currentBase;
        let max = currentBase;
        for (const leg of legs) {
          min = Math.min(min, leg.from);
          max = Math.max(max, leg.to);
        }
        span = max - min;
      }
      straddlesBase = lowDelta !== null && highDelta !== null && lowDelta * highDelta < 0;
    } else if (low !== null && high !== null) {
      // BEZ BAZY MODEL MILCZY O GEOMETRII, ale nie o rankingu: rozpiętość
      // samej pary nie zależy od bazy, więc tabela dostaje sensowną kolejność,
      // a wykres nie dostaje ani jednej nogi do narysowania.
      span = Math.abs(high - low);
    }

    drafts.push({
      index: i,
      label,
      low,
      high,
      legs,
      span: Number.isFinite(span) ? span : 0,
      swing: low !== null && high !== null ? high - low : null,
      lowDelta,
      highDelta,
      inverted,
      straddlesBase,
      pair,
    });
  }

  // KROK 2: SORTOWANIE MALEJĄCO PO ROZPIĘTOŚCI. To jedyna poprawna kolejność
  // tego rodzaju - z niej bierze się kształt tornada, a kształt jest tu
  // nośnikiem rankingu wrażliwości. Remisy rozstrzyga indeks arkusza: nie
  // dlatego, że jest w czymkolwiek lepszy, ale dlatego, że jest STABILNY -
  // ta sama treść bloku musi dać ten sam wykres przy każdym renderze, także
  // po stronie serwera. Sam remis jest zgłaszany w `tiedSpanLabels`.
  const sorted = [...drafts].sort((a, b) => b.span - a.span || a.index - b.index);
  const reordered = sorted.some((d, position) => d.index !== position);

  const withNumbers = sorted.filter((d) => d.pair !== "empty");
  const maxSpan = withNumbers.reduce((acc, d) => Math.max(acc, d.span), 0);
  const zeroSpanOf = (span: number): boolean => span <= maxSpan * ZERO_SPAN_TOLERANCE_RATIO;
  const nonZeroSpans = withNumbers.filter((d) => !zeroSpanOf(d.span)).map((d) => d.span);
  const minSpan = nonZeroSpans.length > 0 ? minOf(nonZeroSpans) : null;

  // KROK 3: remisy sąsiadów w RANKINGU. Liczone po sortowaniu, bo przed nim
  // sąsiedztwa w rankingu nie ma. Wiersze puste i zerowe wypadają: o ich
  // kolejności nie ma co mówić, bo nic nie kodują.
  const tied = new Set<number>();
  for (let k = 1; k < sorted.length; k++) {
    const prev = sorted[k - 1];
    const current = sorted[k];
    if (prev.pair === "empty" || current.pair === "empty") continue;
    if (zeroSpanOf(prev.span) || zeroSpanOf(current.span)) continue;
    const scale = Math.max(prev.span, current.span);
    if (scale <= 0) continue;
    if (Math.abs(prev.span - current.span) <= scale * SPAN_TIE_TOLERANCE_RATIO) {
      tied.add(prev.index);
      tied.add(current.index);
    }
  }

  // KROK 4: pasma i udziały. `bandDivisor` osłania jedyne dzielenie po
  // wysokości: model bez wierszy nie ma pasm, ale nie może też oddać NaN.
  const bandDivisor = sorted.length > 0 ? sorted.length : 1;
  const bandThickness = 1 / bandDivisor;
  const rows: TornadoRow[] = sorted.map((d, rank) => {
    const zeroSpan = d.pair !== "empty" && zeroSpanOf(d.span);
    // ASYMETRIA. Mianownik osłonięty rozpiętością: przy zerowej rozpiętości
    // asymetria nie istnieje (nie ma czego dzielić), więc `null`, a nie 0 -
    // zero znaczyłoby "symetryczna", czyli zaświadczałoby o czymś, czego nie
    // sprawdziliśmy.
    const asymmetry =
      d.lowDelta !== null && d.highDelta !== null && d.span > 0
        ? (Math.abs(d.highDelta) - Math.abs(d.lowDelta)) / d.span
        : null;
    return {
      index: d.index,
      rank,
      label: d.label,
      low: d.low,
      high: d.high,
      lowDelta: d.lowDelta,
      highDelta: d.highDelta,
      swing: d.swing,
      span: d.span,
      spanShare: maxSpan > 0 ? d.span / maxSpan : 0,
      asymmetry,
      legs: d.legs,
      pair: d.pair,
      inverted: d.inverted,
      zeroSpan,
      straddlesBase: d.straddlesBase,
      tiedWithNeighbour: tied.has(d.index),
      bandCenter: (rank + 0.5) * bandThickness,
      bandThickness,
      barThickness: bandThickness * TORNADO_BAR_RATIO,
    };
  });

  // KROK 5: uczciwość. Orzeczenia liczone z gotowych wierszy, żeby podpis pod
  // wykresem i rysunek mówiły z jednego źródła.
  const invertedLabels = rows.filter((r) => r.inverted).map((r) => r.label);
  const oneLeggedLabels = rows
    .filter((r) => r.pair === "lowOnly" || r.pair === "highOnly")
    .map((r) => r.label);
  const zeroSpanLabels = rows.filter((r) => r.zeroSpan).map((r) => r.label);
  const emptyLabels = rows.filter((r) => r.pair === "empty").map((r) => r.label);
  const oneSidedLabels = rows
    .filter((r) => r.pair === "complete" && r.legs.length === 2 && !r.straddlesBase && !r.zeroSpan)
    .map((r) => r.label);
  const tiedSpanLabels = rows.filter((r) => r.tiedWithNeighbour).map((r) => r.label);
  const completePairs = rows.filter((r) => r.pair === "complete");
  const asymmetries = rows
    .map((r) => r.asymmetry)
    .filter((a): a is number => a !== null)
    .map((a) => Math.abs(a));

  const seen = new Map<string, number>();
  for (const row of rows) {
    const key = row.label.trim();
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const duplicateLabels = [...seen.entries()]
    .filter(([, count]) => count > 1)
    .map(([label]) => label);

  // Liczby bez nazwy parametru: wartość jest, kategorii nie ma. Liczymy tylko
  // te, które BYŁYBY daną - luka poza zakresem kategorii nie jest utratą.
  let droppedValueCount = 0;
  for (const legSeries of [lowSeries, highSeries]) {
    if (!legSeries) continue;
    for (let i = rowCount; i < legSeries.values.length; i++) {
      const raw = legSeries.values[i];
      if (raw === null || raw === undefined || Number.isNaN(raw)) continue;
      droppedValueCount++;
    }
  }

  const extraSeriesNames = series
    .filter((_s, i) => i !== baseSeriesIndex && i !== legIndices.low && i !== legIndices.high)
    .map((s) => s.name);

  const honesty: TornadoHonesty = {
    baseIsSingle,
    baseSpread: Number.isFinite(baseSpread) ? baseSpread : 0,
    pairsOrdered: completePairs.length === 0 ? null : invertedLabels.length === 0,
    invertedLabels,
    pairsComplete: withNumbers.length === 0 ? null : oneLeggedLabels.length === 0,
    oneLeggedLabels,
    allSpansContribute: withNumbers.length === 0 ? null : zeroSpanLabels.length === 0,
    zeroSpanLabels,
    emptyLabels,
    oneSidedLabels,
    tiedSpanLabels,
    duplicateLabels,
    outOfRangeLabels: [...new Set(outOfRangeLabels)],
    droppedValueCount,
    extraSeriesNames,
    maxAsymmetry: asymmetries.length > 0 ? maxOf(asymmetries) : null,
  };

  return { rows, base, mode, baseSource, maxSpan, minSpan, reordered, honesty };
}

/**
 * Domena osi wartości. ZAWSZE obejmuje linię bazową, bo od niej rozchodzą się
 * słupki: oś, która bazy nie zawiera, pokazywałaby słupki bez ich krawędzi
 * odniesienia, czyli długości bez punktu, od którego są liczone.
 *
 * Gdy nie ma bazy, nie ma też nóg i nie ma czego rysować - zwracamy wtedy
 * punkt, a renderer i tak musi najpierw sprawdzić `model.base` i zejść do
 * tabeli danych. Zakresu z samych `low` / `high` NIE budujemy, bo oś bez
 * linii bazowej sugerowałaby, że wykres jest kompletny.
 */
export function tornadoExtent(model: TornadoModel): { min: number; max: number } {
  const anchor = model.base ?? 0;
  let min = anchor;
  let max = anchor;
  for (const row of model.rows) {
    for (const leg of row.legs) {
      min = Math.min(min, leg.from);
      max = Math.max(max, leg.to);
    }
  }
  return {
    min: Number.isFinite(min) ? min : 0,
    max: Number.isFinite(max) ? max : 0,
  };
}

/**
 * ALTERNATYWA TEKSTOWA. Kolumny tabeli danych pod wykresem - grafika nigdy
 * nie jest jedyną drogą do liczby (sekcja 8).
 *
 * "spanShare" jest w tej liście świadomie: to jedyna kolumna, która oddaje
 * czytelnikowi TO, CO WIDZI (długość słupka względem najdłuższego), a nie
 * liczbę, z której ta długość powstała.
 */
export const TORNADO_COLUMNS = [
  "parameter",
  "low",
  "high",
  "lowDelta",
  "highDelta",
  "swing",
  "span",
  "spanShare",
] as const;

export type TornadoColumnKey = (typeof TORNADO_COLUMNS)[number];

/** Przypis przy wierszu tabeli - dokładnie te same fakty co w `honesty`. */
export type TornadoRowNote =
  "inverted" | "zeroSpan" | "oneLegged" | "empty" | "oneSided" | "tied" | "duplicate";

export interface TornadoTableRow {
  /** Pozycja w rankingu, ta sama co na rysunku. */
  rank: number;
  label: string;
  low: number | null;
  high: number | null;
  lowDelta: number | null;
  highDelta: number | null;
  swing: number | null;
  span: number;
  spanShare: number;
  notes: TornadoRowNote[];
}

export interface TornadoTable {
  /**
   * Wiersze W KOLEJNOŚCI RYSOWANIA, nie arkuszowej. Tabela ma pozwolić
   * odczytać liczbę tego słupka, na który czytelnik patrzy - przy innej
   * kolejności musiałby szukać nazwy, a to jest dokładnie ten koszt, którego
   * tornado go pozbawia.
   */
  rows: TornadoTableRow[];
  /** Poziom bazy do przypisu; `null` = nie podano, więc słupków nie ma. */
  base: number | null;
  mode: TornadoMode;
  baseSource: TornadoBaseSource;
  /**
   * Czy kolumny `low` / `high` są POZIOMAMI wyniku. W trybie odchyleń bez
   * podanej bazy poziomów nie znamy w ogóle, więc te kolumny powtarzałyby
   * odchylenia - renderer ma je wtedy pominąć, zamiast pokazywać liczbę,
   * która wygląda na poziom, a jest odchyleniem.
   */
  hasAbsoluteLevels: boolean;
}

/**
 * Tabela danych z GOTOWEGO modelu - te same liczby, z których powstał
 * rysunek, a nie policzone po raz drugi inną drogą. Ta zasada ma tu konkretny
 * ciężar: gdyby tabela sortowała po |high - low|, a rysunek po rozpiętości
 * widocznej, wiersz z parą jednostronną wypadłby w tabeli na innym miejscu
 * niż na wykresie i czytelnik odczytałby liczbę nie tego parametru.
 */
export function tornadoTable(model: TornadoModel): TornadoTable {
  const duplicates = new Set(model.honesty.duplicateLabels);
  const rows: TornadoTableRow[] = model.rows.map((row) => {
    const notes: TornadoRowNote[] = [];
    if (row.inverted) notes.push("inverted");
    if (row.pair === "empty") notes.push("empty");
    if (row.pair === "lowOnly" || row.pair === "highOnly") notes.push("oneLegged");
    if (row.zeroSpan) notes.push("zeroSpan");
    if (row.pair === "complete" && row.legs.length === 2 && !row.straddlesBase && !row.zeroSpan) {
      notes.push("oneSided");
    }
    if (row.tiedWithNeighbour) notes.push("tied");
    if (duplicates.has(row.label.trim())) notes.push("duplicate");
    return {
      rank: row.rank,
      label: row.label,
      low: row.low,
      high: row.high,
      lowDelta: row.lowDelta,
      highDelta: row.highDelta,
      swing: row.swing,
      span: row.span,
      spanShare: row.spanShare,
      notes,
    };
  });
  return {
    rows,
    base: model.base,
    mode: model.mode,
    baseSource: model.baseSource,
    hasAbsoluteLevels: model.mode === "absolute" || model.baseSource !== "zero",
  };
}

/**
 * PORADY DOBORU FORMY - osobno od uczciwości, bo to nie defekty danych, tylko
 * sygnały, że pytanie analityczne lepiej postawić inną formą. Tak samo jak
 * `pieFormAdvice` w `../honesty` i `boxplotFormAdvice`.
 */
export type TornadoFormAdvice = "noBase" | "singleParameter" | "flatRanking" | "tooManyRows";

export function tornadoFormAdvice(model: TornadoModel): TornadoFormAdvice[] {
  const advice: TornadoFormAdvice[] = [];
  // Brak bazy nie jest poradą stylistyczną: bez niej wykres nie istnieje,
  // a autor musi dostać jedno zdanie, co dopisać.
  if (model.base === null) advice.push("noBase");
  const informative = model.rows.filter((r) => r.pair !== "empty" && !r.zeroSpan);
  if (informative.length > 0 && informative.length < TORNADO_MIN_PARAMS) {
    advice.push("singleParameter");
  }
  // Płaski ranking: mianownik osłonięty, bo `minSpan` bywa `null`, a zero
  // nigdy tu nie wchodzi (rozpiętości zerowe są odfiltrowane przy liczeniu).
  const min = model.minSpan;
  if (
    informative.length >= TORNADO_MIN_PARAMS &&
    min !== null &&
    min > 0 &&
    model.maxSpan / min <= TORNADO_FLAT_RANKING_RATIO
  ) {
    advice.push("flatRanking");
  }
  if (informative.length > TORNADO_ROWS_ADVICE_MAX) advice.push("tooManyRows");
  return advice;
}
