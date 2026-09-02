// Zapis CSV - JEDNA reguła cytowania i JEDNA reguła neutralizacji dla całego repo.
//
// PO CO. Repo ma wspólny PARSER (`parseCsv`), ale zapis był kopiowany: panel
// subskrybentów i lista wykluczeń miały własne, identyczne funkcje cytujące.
// Dwie kopie tej samej reguły to dwie okazje, żeby jedna z nich się rozjechała
// przy następnej zmianie - a konsekwencja jest cicha i poważna: wartość
// z przecinkiem (nazwa „Nowak, Anna”, diagnostyka odbicia „550, mailbox full”)
// rozjeżdża kolumny w pliku, który operator otwiera POZA systemem. Wiersz
// przesunięty o jedną kolumnę przypisuje komuś cudzą zgodę albo cudzy powód
// blokady.
//
// Komórka przechodzi tu DWA niezależne zabezpieczenia, w tej kolejności:
//
//   1. NEUTRALIZACJA FORMUŁY (CWE-1236) - patrz `neutralizeCsvFormula`. Chroni
//      komputer operatora, który otwiera plik w arkuszu.
//   2. CYTOWANIE ZGODNE Z RFC 4180 - cytujemy tylko wtedy, gdy trzeba, a
//      cudzysłów w treści podwajamy. Chroni STRUKTURĘ pliku.
//
// Kolejność jest częścią zabezpieczenia, nie stylem - uzasadnienie stoi przy
// `csvCell`.

/**
 * Znaki, od których arkusz zaczyna czytać komórkę jako FORMUŁĘ, a nie jako
 * tekst. `=` i `@` otwierają formułę wprost, `+` i `-` przez skrót zapisu
 * (`+A1`, `-A1`), a TAB i CR są w tej liście, bo arkusze obcinają wiodące
 * białe znaki przed rozpoznaniem zawartości, więc `\t=1+1` wraca do `=1+1`.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * Liczba w zapisie, który arkusz i tak przeczyta jako LICZBĘ: opcjonalny znak,
 * część całkowita i ułamkowa (kropka albo przecinek - kwoty w tym repo jadą
 * i przez `toFixed`, i przez `toLocaleString("pl-PL")`), notacja wykładnicza,
 * opcjonalny procent.
 */
const PLAIN_NUMBER = /^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)(?:[eE][+-]?\d+)?%?$/;

/** Znaki, które muszą wylądować w cudzysłowach, inaczej rozsypują plik. */
const NEEDS_QUOTING = /[",\n\r]/;

/**
 * Neutralizacja wstrzyknięcia formuły (CSV injection, CWE-1236).
 *
 * DROGA WEJŚCIA DANYCH. Wektor nie wymaga od napastnika żadnego dostępu do
 * panelu. Wpisuje `=cmd|'/c calc'!A0` w PUBLICZNY formularz zapisu do
 * newslettera (pole nazwy), wpis ląduje w bazie jako zwykły tekst, operator
 * eksportuje listę subskrybentów przez `subscribersToCsv` i otwiera plik
 * lokalnie w Excelu - arkusz wykonuje formułę na jego komputerze. Tą samą
 * drogą idą: diagnostyka od dostawcy poczty (`suppressionsToCsv`), dane
 * uczestnika wydarzenia (`leadExport`) i pola zamówienia od operatora płatności
 * (`audit.server`). Wspólne dla wszystkich jest to, że autorem treści jest
 * KTOŚ INNY niż osoba, która plik otwiera.
 *
 * WYBÓR TECHNIKI: PREFIKS APOSTROFA. Apostrof jest własnym znacznikiem arkusza
 * („to jest tekst”) w Excelu, LibreOffice i Arkuszach Google - wartość zostaje
 * w pliku w całości i pozostaje czytelna dla człowieka, a nie jest kasowana ani
 * okrajana. Odrzucone alternatywy: usuwanie wiodącego znaku (niszczy dane
 * operatora - `-15%` to prawdziwa wartość), cytowanie samo w sobie (arkusze
 * i tak interpretują zawartość pola cytowanego) oraz prefiks apostrofa NA
 * WSZYSTKIM (patrz niżej).
 *
 * DLACZEGO WYJĄTEK NA LICZBY. Prefiks nałożony bez rozróżnienia zamienia
 * `-12.5` w tekst, a kolumna liczbowa przestaje się sumować i przestaje dawać
 * wykres - eksport traci swoje jedyne zastosowanie. Dlatego apostrof dostaje
 * tylko komórka, która zaczyna się od znaku formuły i NIE jest liczbą.
 * Daty (`2026-08-30`) nie są w ogóle kandydatami: reguła patrzy WYŁĄCZNIE na
 * pierwszy znak, a on jest cyfrą.
 *
 * Ta sama technika stoi w `components/admin/analytics/exportChart.ts`
 * (eksport wykresu BI) - opis tamtego wyboru jest wcześniejszy, ten moduł go
 * powtarza dla wszystkich POZOSTAŁYCH eksportów repo.
 */
export function neutralizeCsvFormula(value: string): string {
  if (!FORMULA_LEAD.test(value) || PLAIN_NUMBER.test(value)) return value;
  return `'${value}`;
}

/**
 * Jedna komórka CSV: neutralizacja formuły, potem cytowanie tylko wtedy, gdy
 * treść tego wymaga.
 *
 * KOLEJNOŚĆ JEST ISTOTNA. Apostrof ląduje WEWNĄTRZ pola cytowanego, a nie przed
 * cudzysłowem otwierającym - odwrotnie parser CSV zobaczyłby pole niecytowane
 * zaczynające się od apostrofu i cudzysłów w środku, czyli neutralizacja
 * zepsułaby strukturę pliku, którego druga reguła ma pilnować.
 *
 * CR jest w zestawie znaków wymuszających cytowanie razem z LF: samo `\r`
 * kończy wiersz w większości parserów, a po neutralizacji ładunku `\r=1+1`
 * musi zostać w polu cytowanym, żeby nie rozciął rekordu.
 */
export function csvCell(value: string | number | null | undefined): string {
  const v = neutralizeCsvFormula(String(value ?? ""));
  return NEEDS_QUOTING.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * Tekst CSV z wierszem nagłówka.
 *
 * `rows` to gotowe krotki wartości w kolejności kolumn - dobór kolumn należy
 * do wołającego, bo to on wie, co wolno wynieść z systemu.
 */
export function toCsv(
  columns: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>,
): string {
  return [columns.join(",")].concat(rows.map((row) => row.map(csvCell).join(","))).join("\n");
}

/** Nazwa pliku eksportu: prefiks plus dzień (z podanego znacznika ISO). */
export function csvFileNameFor(prefix: string, nowIso: string): string {
  return `${prefix}-${nowIso.slice(0, 10)}.csv`;
}
