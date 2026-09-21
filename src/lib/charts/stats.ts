// Statystyka pozycyjna silnika wykresów: kwantyl typu 7, mediana, rozstęp
// międzykwartylowy, ogrodzenie Tukeya i indeks wobec bazy. Jedna definicja
// na jedno pojęcie, zależność WYŁĄCZNIE od `num.ts`.
//
// DLACZEGO TEN MODUŁ ISTNIEJE. Kwantyl typu 7 miał w tym repozytorium cztery
// implementacje w dwóch różnych wzorach (`boxplot`, `histogram`, `beeswarm`,
// `indexBase`), a komentarz przy jednej z nich zapewniał, że to "ta sama
// definicja, którą trzyma boxplot.ts" - i było to nieprawdą, bo tamta liczy
// interpolację różnicą, a ta mieszaniem. Rozjazd nie jest teoretyczny: te dwa
// wzory dają na skrajnych danych RÓŻNE LICZBY, więc ten sam szereg pokazywał
// inny kwartyl na skrzynce i inny w indeksie. Cztery kopie definicji to nie
// powielony kod - to cztery definicje.
//
// KONWENCJA ZWROTU: `number | null` wszędzie, gdzie model ORZEKA. Kwantyl,
// rozstęp, ogrodzenie i indeks nie są współrzędnymi rysunku, tylko
// twierdzeniami o danych, a na twierdzenie, którego nie da się policzyć,
// jedyną uczciwą odpowiedzią jest milczenie. Wartość zastępcza jest tu
// gorsza niż brak odpowiedzi, bo zero i jedynka wyglądają dokładnie tak samo
// wiarygodnie jak liczba policzona z danych - patrz nagłówek `num.ts`.

import { orNull } from "./num";

/**
 * Nazwa metody kwantylowej - do przypisu pod tabelą, nie tylko do kodu.
 *
 * Typ 7 to domyślna metoda R-a i arkuszy kalkulacyjnych, więc kwartyl
 * policzony tutaj zgadza się z tym, który autor widzi u siebie. Nazwa jedzie
 * do modelu, bo konsekwencją typu 7 jest to, że kwartyl bywa liczbą
 * INTERPOLOWANĄ, której w danych nie ma - czytelnik ma prawo wiedzieć, czym
 * liczyliśmy, zanim porówna nasz kwartyl ze swoim.
 */
export const QUANTILE_METHOD = "type-7" as const;

/** Nazwa metody kwantylowej wpisywana do modelu. */
export type QuantileMethod = typeof QUANTILE_METHOD;

/**
 * Kwantyl metodą typu 7 na tablicy JUŻ POSORTOWANEJ rosnąco.
 *
 * WEJŚCIE MUSI BYĆ POSORTOWANE i mówi to nazwa parametru. Funkcja nie sortuje
 * kopii po cichu, bo sortowanie jest kosztem, który wywołujący i tak już
 * poniósł (kwartyle liczy się po trzy z tej samej tablicy), a ukryte `[...t]`
 * w każdym wywołaniu zamieniłoby trzy odczyty w trzy sortowania. Nie sprawdza
 * też posortowania - sprawdzenie kosztuje tyle, co przejście tablicy, czyli
 * dokładnie ten koszt, którego kontrakt unika.
 *
 * INTERPOLACJA MIESZANIEM `a*(1-t) + b*t`, NIE `a + (b-a)*t`, i to jest
 * różnica arytmetyczna, nie stylistyczna. Postać z różnicą liczy `b - a`,
 * które dla szeregu od -1e308 do 1e308 wychodzi poza podwójną precyzję:
 * `quantile([-1e308, 1e308, 1e308, 1e308], 0.25)` dawało przez to
 * nieskończoność, a osłona cofała wynik do `a`, czyli ogłaszała pierwszy
 * kwartyl RÓWNY NAJMNIEJSZEJ OBSERWACJI (-1e308) tam, gdzie prawdziwą
 * odpowiedzią jest 5e+307. Mieszanie nie liczy różnicy, więc nie ma czym
 * przepełnić: `a*(1-t)` i `b*t` są kombinacją wypukłą i nie wychodzą poza
 * przedział [a, b], którego oba końce są z założenia zapisywalne.
 *
 * `null` gdy: tablica pusta, `p` poza [0, 1] (albo `NaN`), wynik
 * nieskończony - czyli gdy w tablicy siedzi `Infinity` albo `NaN` z importu.
 */
export function quantile(sorted: readonly number[], p: number): number | null {
  const n = sorted.length;
  if (n === 0) return null;
  // `p` poza zakresem to nie dane do przycięcia, tylko błąd wywołania:
  // zaciśnięcie do [0, 1] podałoby minimum jako "kwantyl rzędu -0,5", czyli
  // liczbę odpowiadającą na pytanie, którego nikt nie zadał. Warunek jest
  // napisany przez negację, bo `NaN < 0` i `NaN > 1` są oba fałszem.
  if (!(p >= 0 && p <= 1)) return null;
  if (n === 1) return orNull(sorted[0]);

  const pozycja = (n - 1) * p;
  const dol = Math.floor(pozycja);
  const gora = dol + 1 >= n ? n - 1 : dol + 1;
  const t = pozycja - dol;
  const a = sorted[dol];
  // Kwantyl leżący DOKŁADNIE na obserwacji nie interpoluje niczego, więc nie
  // wolno mu wciągać sąsiada: `b * 0` dla `b = Infinity` z uszkodzonego
  // importu daje `NaN` i zabrałoby minimum (p = 0) albo maksimum (p = 1),
  // które są w tej tablicy policzalne i prawdziwe.
  if (t === 0) return orNull(a);
  return orNull(a * (1 - t) + sorted[gora] * t);
}

/** Mediana (kwantyl 0,5) na tablicy JUŻ POSORTOWANEJ rosnąco. */
export function median(sorted: readonly number[]): number | null {
  return quantile(sorted, 0.5);
}

/**
 * Rozstęp międzykwartylowy `q3 - q1` na tablicy JUŻ POSORTOWANEJ rosnąco.
 *
 * `null` TAKŻE WTEDY, gdy sama różnica przepełnia, choć oba kwartyle są
 * skończone: dla szeregu rozciągniętego od -1,5e308 do 1,5e308 `q3 - q1`
 * wychodzi poza podwójną precyzję. Rozstęp jest podstawą orzeczenia
 * o odstawaniu, więc model o takim szeregu MILCZY, zamiast zaświadczać na
 * podstawie nieskończoności.
 */
export function iqr(sorted: readonly number[]): number | null {
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  if (q1 === null || q3 === null) return null;
  return orNull(q3 - q1);
}

/** Granice ogrodzenia Tukeya w jednostkach danych. */
export interface TukeyFence {
  lower: number;
  upper: number;
}

/**
 * Ogrodzenie Tukeya `[q1 - factor*IQR, q3 + factor*IQR]` albo `null`.
 *
 * `null` GDY KTÓRAKOLWIEK GRANICA WYCHODZI NIESKOŃCZONA, a nie tylko wtedy,
 * gdy niepoliczalny jest rozstęp - i to jest sedno tej funkcji. Przy
 * `q1 = -5e307`, `q3 = 5e307` rozstęp wynosi 1e308 i jest SKOŃCZONY, więc
 * sprawdzenie samego rozstępu przepuszcza taki szereg dalej, a obie granice
 * przepełniają się dopiero po pomnożeniu przez 1,5. Osłona wyświetlania
 * mapowała je wtedy na zero i produkowała ogrodzenie `{ lower: 0, upper: 0 }`
 * - a to nie jest awaria, którą ktoś zauważy: zero jest legalną granicą,
 * wobec której KAŻDA obserwacja różna od zera zostaje ogłoszona odstającą.
 *
 * Ujemny (albo nieskończony) `factor` też daje `null`: ogrodzenie z ujemnym
 * mnożnikiem ma dolną granicę powyżej górnej, czyli orzeka, że odstają
 * wszystkie obserwacje naraz - to ta sama klasa defektu, tylko wchodząca
 * konfiguracją zamiast danymi.
 */
export function tukeyFence(sorted: readonly number[], factor: number): TukeyFence | null {
  if (!Number.isFinite(factor) || factor < 0) return null;
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  if (q1 === null || q3 === null) return null;
  const rozstep = orNull(q3 - q1);
  if (rozstep === null) return null;
  const lower = orNull(q1 - factor * rozstep);
  const upper = orNull(q3 + factor * rozstep);
  if (lower === null || upper === null) return null;
  return { lower, upper };
}

/**
 * Wartość linii odniesienia indeksu. Sto, bo "baza = 100" tak właśnie czyta
 * się w każdym opracowaniu i tego oczekuje czytelnik - podpis "... = 100"
 * i ta stała muszą być tą samą liczbą.
 */
export const INDEX_BASE = 100;

/** Werdykt o bazie indeksu: użyteczna albo powód, dla którego nie jest. */
export type BaseUsability = "ok" | "missing" | "zero" | "negative";

/**
 * Czy wobec tej bazy wolno liczyć indeks - i jeśli nie, to DLACZEGO NIE.
 *
 * Zwracamy powód, a nie `boolean`, bo każdy z trzech powodów jest dla
 * czytelnika innym zdaniem ("nie ma pomiaru w okresie bazowym", "baza jest
 * zerem", "baza jest ujemna") i model musi mieć czym je rozróżnić. Dziś ta
 * sama decyzja stoi w dwóch modelach naraz i jest pilnowana komentarzem,
 * a nie wspólną funkcją.
 *
 * Zero i liczba ujemna są osobno, bo są osobnymi defektami danych: przez zero
 * nie da się podzielić, a przez liczbę ujemną można - i właśnie dlatego jest
 * groźniejsza. Indeks wobec ujemnej bazy ODWRACA kierunek (spadek wychodzi
 * wzrostem powyżej setki), więc rysunek byłby czytelny, spójny i odwrotny do
 * prawdy. `NaN` i nieskończoność liczą się jako "missing", bo brak pomiaru
 * i pomiar niezapisywalny są dla indeksu tym samym: nie ma czym dzielić.
 */
export function baseUsable(base: number | null): BaseUsability {
  const liczba = orNull(base);
  if (liczba === null) return "missing";
  if (liczba === 0) return "zero";
  if (liczba < 0) return "negative";
  return "ok";
}

/**
 * Wartość przeliczona na indeks wobec bazy (`baza = INDEX_BASE`) albo `null`.
 *
 * DZIELENIE PRZED MNOŻENIEM: `(v / base) * INDEX_BASE`, nigdy
 * `(v * INDEX_BASE) / base`. Druga postać przepełnia się dla wartości rzędu
 * 1e307, choć sam iloraz jest tam malutki - czyli gubiłaby punkty, którym nic
 * nie zagraża (dla `v = 1e307` i `base = 1e305` pierwsza postać daje 10 000,
 * druga nieskończoność).
 *
 * NIGDY NIE PODSTAWIAMY JEDYNKI W MIANOWNIKU. Baza równa jeden to nie
 * "bezpieczny wariant braku bazy", tylko twierdzenie, że każda wartość
 * szeregu jest swoim własnym indeksem pomnożonym przez sto - liczba, która
 * wygląda na policzoną i nie ma nic wspólnego z danymi. Odpowiedzią na
 * nieużyteczną bazę jest `null`.
 */
export function indexAgainst(value: number | null, base: number | null): number | null {
  const v = orNull(value);
  const b = orNull(base);
  // O użyteczności bazy rozstrzyga `baseUsable` i nikt inny - `b !== null`
  // stoi obok wyłącznie dlatego, że werdykt "ok" nie zawęża typu, a nie
  // dlatego, że ta funkcja podejmuje tę decyzję drugi raz po swojemu.
  if (v === null || b === null || baseUsable(b) !== "ok") return null;
  return orNull((v / b) * INDEX_BASE);
}
