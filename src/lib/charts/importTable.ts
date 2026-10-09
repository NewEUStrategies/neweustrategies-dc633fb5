// Import danych wykresu i mapy Z PLIKU: arkusze (xlsx, xls, ods i pokrewne)
// oraz tekst rozdzielany (csv / tsv / txt).
//
// DLACZEGO OSOBNY MODUŁ, A NIE ROZBUDOWA `csv.ts`. Tamten plik parsuje JEDEN
// format - textarea widgetu, pisaną ręcznie, zawsze średnikiem i zawsze w
// jednej konwencji liczbowej. Plik z Excela nie ma żadnej z tych gwarancji:
// separator bywa przecinkiem, średnikiem albo tabulatorem, liczba przychodzi
// jako `number`, `Date` albo napis z rozdzielaczem tysięcy, a arkuszy w
// skoroszycie jest kilka. Wmieszanie tego w `csv.ts` zmieniłoby semantykę
// parsera, który czyta JUŻ ZAPISANĄ treść - czyli po cichu przerysowałoby
// istniejące wykresy. Import jest więc warstwą WEJŚCIOWĄ: czyta plik, zwraca
// ten sam kształt danych co edytor, i na tym się kończy.
//
// WSZYSTKO, CO ZOSTAŁO ODRZUCONE, JEST RAPORTOWANE. Import, który po cichu
// obcina jedenastą serię albo gubi wiersz z nieznanym kodem kraju, jest
// gorszy niż brak importu: redaktor zobaczy wykres, uzna go za kompletny
// i opublikuje. Dlatego każda funkcja zwraca `problems` obok danych, a UI ma
// obowiązek to pokazać. To samo dotyczy ZMIAN: alias kraju, zdjęta flaga
// Eurostatu i zgadnięta konwencja liczb też trafiają do `problems`.
//
// SKOROSZYT CZYTA PROCES ARKUSZY, NIE TA STRONA. `xlsx` to kilkaset kilobajtów
// i nie ma prawa wejść do grafu komuś, kto nigdy nie kliknie „Importuj" -
// a od 2026-09-23 nie wchodzi do grafu głównego wątku W OGÓLE: ta sama kopia
// biblioteki obsługuje podgląd załączników w klubach, import i eksport leadów
// (`src/lib/files/spreadsheetProtocol.ts`). Wcześniej import ładował `xlsx`
// drugi raz, obok kopii w procesie - 159 KB gzip tego samego kodu.
//
// SCHOWEK MÓWI TYM SAMYM JĘZYKIEM. Wklejenie z Excela, Arkuszy Google albo
// LibreOffice czyta `clipboardTable.ts`; tu trafia już jako `string[][]` i
// przechodzi przez te same funkcje co plik - ta sama komórka daje tę samą
// liczbę bez względu na drogę.
import { MAX_SERIES, type ChartSeries, type MapDatum } from "./types";
import { MAX_CATEGORIES } from "./parse";
import { SLOT_SEQUENCE, slotForSeries } from "@/lib/charts/palette";
import { readSpreadsheetRowsInWorker } from "@/lib/files/spreadsheetWorker";
import { SPREADSHEET_IMPORT_EXTENSIONS } from "@/lib/files/spreadsheetProtocol";
import {
  CODE_ALIASES,
  countryAliasKey,
  normaliseCountryName,
  resolveCountryAlias,
} from "./countryAliases";
import { canonicalNumber } from "./clipboardTable";
import {
  numberStyle,
  readImportedNumber,
  type NumberLocale,
  type NumberRule as Rule,
} from "./importNumber";

export { normaliseCountryName } from "./countryAliases";
export {
  numberStyle,
  parseImportedCell,
  parseImportedNumber,
  readImportedNumber,
  type ImportedCell,
  type NumberLocale,
  type NumberReading,
  type NumberStyle,
} from "./importNumber";

/** Górny limit rozmiaru importowanego pliku. */
export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;

/** Pliki tekstowe - czyta je strona, własnym parserem, bez procesu arkuszy. */
export const TEXT_IMPORT_EXTENSIONS = ["csv", "tsv", "txt"] as const;

/**
 * Rozszerzenia, które umiemy przeczytać. Bez kropki, małymi literami. Część
 * skoroszytowa pochodzi z protokołu procesu arkuszy - jedna lista dla `accept`,
 * dla odmowy przed odczytem i dla rdzenia procesu.
 */
export const IMPORT_EXTENSIONS = [
  ...SPREADSHEET_IMPORT_EXTENSIONS,
  ...TEXT_IMPORT_EXTENSIONS,
] as const;

export type ImportExtension = (typeof IMPORT_EXTENSIONS)[number];

/** Atrybut `accept` dla `<input type="file">`. */
export const IMPORT_ACCEPT = IMPORT_EXTENSIONS.map((e) => `.${e}`).join(",");

/**
 * Co import ODRZUCIŁ albo ZMIENIŁ. Kod jest stabilny (i18n po stronie UI),
 * liczby są dokładne - „pominięto 3 wiersze" ma znaczyć dokładnie trzy.
 */
export type ImportProblem =
  | { code: "seriesTruncated"; dropped: number }
  | { code: "categoriesTruncated"; dropped: number }
  | { code: "nonNumericCells"; count: number }
  | { code: "rowsSkipped"; count: number }
  | { code: "unknownCountries"; labels: readonly string[] }
  | { code: "duplicateCountries"; labels: readonly string[] }
  | { code: "labelsAdjusted"; count: number }
  /** Rozpoznanie nie znalazło wiersza nagłówka: pierwszy wiersz to dane, serie mają numery. */
  | { code: "headerAssumed" }
  /** Mapa: kolumny z liczbami inne niż wybrana kolumna wartości (nagłówek albo litera kolumny). */
  | { code: "columnsIgnored"; labels: readonly string[] }
  /** Mapa: kraje rozpoznane przez alias - „etykieta (ID)". */
  | { code: "aliasesApplied"; labels: readonly string[] }
  /** Liczby, z których zdjęto flagę statystyczną (Eurostat: p, e, b, ...). */
  | { code: "dataFlags"; count: number }
  /** Plik tekstowy nie był w UTF-8 i został odczytany w kodowaniu zastępczym. */
  | { code: "encodingFallback"; encoding: "windows-1250" }
  /** Liczby z jednym rozdzielaczem i trzema cyframi po nim, gdy konwencji nie dało się rozpoznać. */
  | { code: "localeAmbiguous"; count: number }
  /** Arkusz za limitem odczytu procesu - dokładne liczby pominiętych wierszy i kolumn. */
  | { code: "cellsTruncated"; rows: number; columns: number }
  /** Skoroszyt za limitem liczby arkuszy - ostatnie arkusze nie zostały przeczytane. */
  | { code: "sheetsTruncated"; dropped: number }
  /** Schowek ponad `CLIPBOARD_MAX_CHARS` - wczytano tylko początek. */
  | { code: "pasteTruncated" };

export type ImportProblemCode = ImportProblem["code"];

export interface ImportedSheet {
  name: string;
  /** Komórki w kolejności wierszy; prostokąt dociągnięty pustymi napisami. */
  rows: string[][];
  /** Co odczyt TEGO arkusza obciął (limit wierszy i kolumn procesu). */
  problems: ImportProblem[];
}

export interface ImportedWorkbook {
  sheets: ImportedSheet[];
  /** Problemy całego pliku: kodowanie zastępcze, arkusze ponad limit. */
  problems: ImportProblem[];
}

export interface ImportedChartData {
  categories: string[];
  series: ChartSeries[];
  problems: ImportProblem[];
}

export interface ImportedMapData {
  values: MapDatum[];
  problems: ImportProblem[];
}

/** Wyciąga rozszerzenie z nazwy pliku (małymi literami, bez kropki). */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

export function isImportableName(name: string): boolean {
  return (IMPORT_EXTENSIONS as readonly string[]).includes(fileExtension(name));
}

function isTextExtension(ext: string): boolean {
  return (TEXT_IMPORT_EXTENSIONS as readonly string[]).includes(ext);
}

// ---------------------------------------------------------------------------
// Liczby - reguła w `importNumber.ts` (czysty moduł, wspólny ze schowkiem)
// ---------------------------------------------------------------------------

/** Wybór konwencji przy imporcie: „auto" rozpoznaje ją z danych (`analyseTable`). */
export type NumberLocaleChoice = "auto" | NumberLocale;

// ---------------------------------------------------------------------------
// Tekst rozdzielany (csv / tsv)
// ---------------------------------------------------------------------------

/** BOM z Excela i końce linii: CRLF oraz samotny CR sprowadzone do LF. */
function znormalizuj(text: string): string {
  const bez = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return bez.replace(/\r\n?/g, "\n");
}

/** Ile znaków tekstu wystarczy, żeby rozpoznać separator. */
const SNIFF_LIMIT = 64 * 1024;

interface ProfilSeparatora {
  /** Liczba separatorów POZA cudzysłowami w każdym niepustym rekordzie. */
  counts: number[];
  /** Tekst tych rekordów - do sprawdzenia przecinka dziesiętnego. */
  lines: string[];
}

/**
 * Liczy separator rekord po rekordzie, POZA polami cytowanymi.
 *
 * STAN CYTOWANIA PRZECHODZI PRZEZ KOŃCE WIERSZY, bo RFC 4180 pozwala na znak
 * nowej linii WEWNĄTRZ pola w cudzysłowach. Liczenie wiersz po wierszu, z
 * zerowaniem stanu na każdym z nich, wywracało się na takim pliku: separator
 * ukryty w wielowierszowym polu był liczony jako prawdziwy i wygrywał, a
 * dwukolumnowa tabela wychodziła jednokolumnowa.
 *
 * Cudzysłów otwiera pole TYLKO na jego początku - inaczej cal w „Rura 5\" DN"
 * przełączał tryb i reszta pliku lądowała w jednej komórce.
 */
function profilSeparatora(body: string, sep: string): ProfilSeparatora {
  const counts: number[] = [];
  const lines: string[] = [];
  let count = 0;
  let start = 0;
  let inQuotes = false;
  let atFieldStart = true;
  const zamknij = (end: number) => {
    const line = body.slice(start, end);
    if (line.trim() !== "") {
      counts.push(count);
      lines.push(line);
    }
    count = 0;
    start = end + 1;
  };
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (inQuotes) {
      if (ch === '"') {
        if (body[i + 1] === '"') i += 1;
        else inQuotes = false;
      }
      continue;
    }
    if (ch === '"' && atFieldStart) {
      inQuotes = true;
      atFieldStart = false;
    } else if (ch === sep) {
      count += 1;
      atFieldStart = true;
    } else if (ch === "\n") {
      zamknij(i);
      atFieldStart = true;
    } else {
      atFieldStart = false;
    }
  }
  zamknij(body.length);
  return { counts, lines };
}

/** Najczęstsza wartość; przy remisie większa (rekord z separatorami bije pusty). */
function dominanta(values: readonly number[]): number {
  const freq = new Map<number, number>();
  for (const v of values) freq.set(v, (freq.get(v) ?? 0) + 1);
  let best = 0;
  let bestFreq = 0;
  for (const [v, f] of freq) {
    if (f > bestFreq || (f === bestFreq && v > best)) {
      best = v;
      bestFreq = f;
    }
  }
  return best;
}

/**
 * Zgaduje separator po ZGODNOŚCI liczby pól między rekordami, nie po sumie
 * wystąpień.
 *
 * DLACZEGO NIE SUMA. Wklejka z Excela w polskiej lokalizacji to tabulator
 * i przecinki dziesiętne: „Kraków, Małopolska<TAB>1,5". Przecinków jest więcej
 * niż tabulatorów, więc liczenie sumy wybierało przecinek i rozcinało liczby
 * na pół - a tabela traciła wszystkie serie bez słowa. Prawdziwy separator
 * daje TĘ SAMĄ liczbę pól w każdym rekordzie; przypadkowy znak - nie.
 *
 * Wynik: kandydat, dla którego największy odsetek rekordów ma dominującą
 * liczbę separatorów (dominanta > 0). Remis rozstrzyga kolejność: tabulator,
 * średnik, przecinek - tabulator w tekście prawie nigdy nie jest przypadkiem.
 *
 * PRZECINEK DZIESIĘTNY TO NIE SEPARATOR. Plik jednokolumnowy
 * „Wartość / 1,5 / 2,5" ma przecinek w każdym wierszu danych, a w nagłówku
 * żadnego. Gdy WSZYSTKIE rekordy z przecinkiem są w całości liczbą
 * w zapisie polskim, a jakiś rekord przecinka nie ma, przecinek jest częścią
 * liczb i tabela ma jedną kolumnę.
 */
export function sniffDelimiter(text: string): string {
  const body = znormalizuj(text).slice(0, SNIFF_LIMIT);
  let best = ";";
  let bestScore = 0;
  for (const sep of ["\t", ";", ","]) {
    const { counts, lines } = profilSeparatora(body, sep);
    const mode = dominanta(counts);
    if (mode === 0) continue;
    if (
      sep === "," &&
      counts.some((c) => c === 0) &&
      lines.every((l, i) => counts[i] === 0 || readImportedNumber(l, "pl").status === "number")
    ) {
      continue;
    }
    const score = counts.filter((c) => c === mode).length / counts.length;
    if (score > bestScore) {
      bestScore = score;
      best = sep;
    }
  }
  return best;
}

interface Komorka {
  text: string;
  /** Czy pole było w cudzysłowach - wtedy spacje brzegowe są CELOWE. */
  quoted: boolean;
}

/**
 * Jeden przebieg tokenizacji. Zwraca `null`, gdy plik kończy się w niedomkniętym
 * cudzysłowie - wywołujący powtarza wtedy przebieg BEZ cytowania, zamiast
 * oddać sklejone wiersze. Ciche sklejenie jest najgorszym wyjściem: dane
 * znikają, a wynik wygląda na poprawny.
 */
function tokenizuj(body: string, sep: string, honorujCudzyslow: boolean): Komorka[][] | null {
  const rows: Komorka[][] = [];
  let row: Komorka[] = [];
  let cell = "";
  let cellQuoted = false;
  let inQuotes = false;
  let atFieldStart = true;

  const zamknijKomorke = () => {
    row.push({ text: cell, quoted: cellQuoted });
    cell = "";
    cellQuoted = false;
    atFieldStart = true;
  };
  const zamknijWiersz = () => {
    zamknijKomorke();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (inQuotes) {
      if (ch === '"') {
        if (body[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else inQuotes = false;
      } else cell += ch;
      continue;
    }
    if (honorujCudzyslow && ch === '"' && atFieldStart) {
      inQuotes = true;
      cellQuoted = true;
      atFieldStart = false;
    } else if (ch === sep) {
      zamknijKomorke();
    } else if (ch === "\n") {
      zamknijWiersz();
    } else {
      cell += ch;
      atFieldStart = false;
    }
  }
  if (inQuotes) return null;
  zamknijWiersz();
  return rows;
}

/**
 * Parser CSV/TSV zgodny z RFC 4180 w zakresie, który spotyka się w plikach
 * z Excela: cudzysłowy, podwojone `""`, pola wielowierszowe.
 *
 * Spacje brzegowe obcinamy WYŁĄCZNIE w polach niecytowanych. W cytowanych są
 * częścią wartości - autor, który napisał `"  wcięcie  "`, poprosił o nie
 * wprost.
 */
export function parseDelimitedText(text: string, delimiter?: string): string[][] {
  const body = znormalizuj(text);
  const sep = delimiter ?? sniffDelimiter(body);
  const rows = tokenizuj(body, sep, true) ?? tokenizuj(body, sep, false) ?? [];
  return rows
    .map((r) => r.map((c) => (c.quoted ? c.text : c.text.trim())))
    .filter((r) => r.some((c) => c !== ""));
}

/** Kodowanie, w którym odczytano plik tekstowy. */
export type TextEncodingName = "utf-8" | "utf-16le" | "utf-16be" | "windows-1250";

export interface DecodedText {
  text: string;
  encoding: TextEncodingName;
  /** Czy to kodowanie ZASTĘPCZE (plik nie był poprawnym UTF-8) - do zgłoszenia. */
  fallback: boolean;
}

/** UTF-16 bez BOM: tekst łaciński ma wtedy zero w co drugim bajcie. */
function utf16BezBom(bytes: Uint8Array): "utf-16le" | "utf-16be" | null {
  const n = Math.min(bytes.length, 1024) & ~1;
  if (n < 4) return null;
  let zeroEven = 0;
  let zeroOdd = 0;
  for (let i = 0; i < n; i += 2) {
    if (bytes[i] === 0) zeroEven += 1;
    if (bytes[i + 1] === 0) zeroOdd += 1;
  }
  const half = n / 2;
  if (zeroOdd / half > 0.4 && zeroEven / half < 0.05) return "utf-16le";
  if (zeroEven / half > 0.4 && zeroOdd / half < 0.05) return "utf-16be";
  return null;
}

/**
 * Bajty pliku tekstowego -> tekst.
 *
 * `file.text()` zakładało UTF-8, a polski Excel zapisuje „CSV (rozdzielany
 * przecinkami)" w Windows-1250, „Tekst Unicode" zaś w UTF-16LE. Oba kończyły
 * się znakami zastępczymi w etykietach - i rozpoznawanie krajów po polskiej
 * nazwie („Węgry") przestawało działać, bez słowa.
 *
 * Kolejność: BOM (UTF-8, UTF-16LE, UTF-16BE), UTF-16 rozpoznany po zerach,
 * ŚCISŁY UTF-8 (`fatal`), a dopiero gdy ten odmówi - Windows-1250, zgłaszany
 * jako kodowanie zastępcze.
 */
export function decodeTextBytes(bytes: Uint8Array): DecodedText {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return {
      text: new TextDecoder("utf-8").decode(bytes.subarray(3)),
      encoding: "utf-8",
      fallback: false,
    };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return {
      text: new TextDecoder("utf-16le").decode(bytes.subarray(2)),
      encoding: "utf-16le",
      fallback: false,
    };
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return {
      text: new TextDecoder("utf-16be").decode(bytes.subarray(2)),
      encoding: "utf-16be",
      fallback: false,
    };
  }
  const utf16 = utf16BezBom(bytes);
  if (utf16 !== null)
    return { text: new TextDecoder(utf16).decode(bytes), encoding: utf16, fallback: false };
  try {
    return {
      text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      encoding: "utf-8",
      fallback: false,
    };
  } catch {
    try {
      return {
        text: new TextDecoder("windows-1250").decode(bytes),
        encoding: "windows-1250",
        fallback: true,
      };
    } catch {
      return { text: new TextDecoder("utf-8").decode(bytes), encoding: "utf-8", fallback: false };
    }
  }
}

// ---------------------------------------------------------------------------
// Skoroszyt (xlsx / xls / ods i pokrewne)
// ---------------------------------------------------------------------------

/**
 * Data w komórce -> „RRRR-MM-DD" (z godziną tylko, gdy nie jest północą).
 *
 * KOMPONENTY LOKALNE, NIE `toISOString()`. SheetJS buduje `Date` w czasie
 * LOKALNYM, więc konwersja do UTC cofała dzień wszędzie na wschód od
 * Greenwich - czyli u polskiego redaktora komórka „2024-01-15" wychodziła jako
 * „2024-01-14 23:00:00". Etykieta kategorii z błędną datą i doklejoną
 * godziną to nie kosmetyka: tak wygląda oś czasu na opublikowanym wykresie.
 *
 * Liczba wychodzi w zapisie kanonicznym (`canonicalNumber`) - tym samym, co
 * surowa liczba ze schowka - żeby rozpoznawanie konwencji nie wzięło jej
 * za zapis z separatorem tysięcy.
 */
export function formatImportedCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return "";
    const dwie = (n: number) => String(n).padStart(2, "0");
    const dzien = `${v.getFullYear()}-${dwie(v.getMonth() + 1)}-${dwie(v.getDate())}`;
    if (v.getHours() === 0 && v.getMinutes() === 0 && v.getSeconds() === 0) return dzien;
    return `${dzien} ${dwie(v.getHours())}:${dwie(v.getMinutes())}:${dwie(v.getSeconds())}`;
  }
  if (typeof v === "number") return canonicalNumber(v);
  if (typeof v === "boolean") return v ? "1" : "0";
  return String(v).trim();
}

/** Dociąga wiersze do prostokąta i wyrzuca wiersze całkiem puste. */
export function rectangularTable(rows: readonly (readonly string[])[]): string[][] {
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  return rows
    .map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ""))
    .filter((r) => r.some((c) => c !== ""));
}

/**
 * Czyta plik do postaci arkuszy z komórkami jako napisy.
 *
 * Pliki tekstowe (csv/tsv/txt) idą WŁASNYM parserem, nie przez `xlsx`:
 * biblioteka zgaduje wtedy typy komórek i potrafi zamienić „2024-01" na datę
 * albo kod kraju „NA" (Namibia) na wartość pustą. Własny parser nie ma prawa
 * niczego przetypować - napis zostaje napisem. Bajty dekoduje
 * `decodeTextBytes`; tekst UTF-16 z tabulatorami to „Tekst Unicode" Excela,
 * więc dzieli się go tabulatorem bez zgadywania.
 *
 * Skoroszyt czyta proces arkuszy W TRYBIE IMPORTU WYKRESU (`chartImport` -
 * włączany tylko stąd: procent · 100 jak ze schowka, błąd jako tekst, HTML bez
 * zgadywania typów) i w limitach `IMPORT_MAX_*`; to, co obcięły, wraca jako
 * `cellsTruncated` przy arkuszu i `sheetsTruncated` przy pliku.
 */
export async function readWorkbook(file: File): Promise<ImportedWorkbook> {
  if (file.size > IMPORT_MAX_BYTES) {
    throw new Error(`file too large: ${file.size} > ${IMPORT_MAX_BYTES}`);
  }
  const ext = fileExtension(file.name);
  if (isTextExtension(ext)) {
    const decoded = decodeTextBytes(new Uint8Array(await file.arrayBuffer()));
    const utf16Tsv = decoded.encoding !== "utf-8" && decoded.encoding !== "windows-1250";
    const sep = ext === "tsv" || (utf16Tsv && decoded.text.includes("\t")) ? "\t" : undefined;
    const problems: ImportProblem[] =
      decoded.fallback && decoded.encoding === "windows-1250"
        ? [{ code: "encodingFallback", encoding: "windows-1250" }]
        : [];
    const rows = rectangularTable(parseDelimitedText(decoded.text, sep));
    return { sheets: [{ name: file.name, rows, problems: [] }], problems };
  }
  const book = await readSpreadsheetRowsInWorker(await file.arrayBuffer(), { chartImport: true });
  const sheets: ImportedSheet[] = book.sheets.map(
    ({ name, rows, rowsDropped, columnsDropped }) => ({
      name,
      rows: rectangularTable(rows.map((r) => r.map(formatImportedCell))),
      problems:
        rowsDropped > 0 || columnsDropped > 0
          ? [{ code: "cellsTruncated", rows: rowsDropped, columns: columnsDropped }]
          : [],
    }),
  );
  const problems: ImportProblem[] =
    book.sheetsDropped > 0 ? [{ code: "sheetsTruncated", dropped: book.sheetsDropped }] : [];
  return { sheets, problems };
}

// ---------------------------------------------------------------------------
// Rozpoznanie układu tabeli
// ---------------------------------------------------------------------------

/** Co `analyseTable` rozpoznało w tabeli - domyślne położenia przełączników podglądu. */
export interface TableAnalysis {
  /** Pierwszy wiersz to etykiety (nazwy serii albo okresy), nie dane. */
  headerRow: boolean;
  /** Serie leżą w wierszach (układ Eurostatu i GUS: kraje w wierszach, lata w kolumnach). */
  seriesInRows: boolean;
  /** Konwencja liczb; „ambiguous", gdy dane jej nie rozstrzygają, a trzeba. */
  numberLocale: NumberLocale | "ambiguous";
}

type RodzajKomorki = "empty" | "value" | "text";

/** Wartość to liczba w KTÓREJKOLWIEK konwencji albo jawny brak danych. */
function rodzajKomorki(cell: string): RodzajKomorki {
  const pl = readImportedNumber(cell, "pl");
  if (pl.status === "empty") return "empty";
  if (pl.status !== "invalid") return "value";
  return readImportedNumber(cell, "en").status === "number" ? "value" : "text";
}

/**
 * Etykieta okresu: rok (1800-2199), kwartał, miesiąc, półrocze albo tydzień
 * w zapisach Eurostatu, GUS i arkuszy („2024Q1", „2024-K1", „Q1 2024",
 * „2024M01", „2024-01", „01.2024", „15.01.2024").
 */
export function isPeriodLabel(raw: string): boolean {
  const s = raw.trim();
  return (
    /^(?:1[89]|2[01])\d{2}$/.test(s) ||
    /^\d{4}\s*[-_/ .]?\s*(?:Q|K|M|H|S|W|T)\s*\d{1,2}$/i.test(s) ||
    /^(?:Q|K|H|S)\s*[1-4]\s*[-_/ .]?\s*\d{2,4}$/i.test(s) ||
    /^\d{4}-\d{2}(?:-\d{2})?$/.test(s) ||
    /^\d{1,2}[./-]\d{4}$/.test(s) ||
    /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(s)
  );
}

/**
 * NAGŁÓWEK. Pierwszy wiersz jest nagłówkiem, gdy jego komórki poza narożnikiem
 * są w większości tekstem. Gdy są liczbami, nagłówkiem jest tylko wtedy, gdy
 * narożnik jest pusty (klasyczny układ tabeli przestawnej) albo gdy są to same
 * okresy pod tekstowym narożnikiem („Kraj | 2019 | 2020"). Wiersz
 * „2021 | 120 | 80" jest daną - do 2026-10 import robił z niego serie „120"
 * i „80" i gubił pierwszy wiersz bez słowa.
 */
function wykryjNaglowek(table: readonly (readonly string[])[]): boolean {
  const first = table[0];
  if (first === undefined) return false;
  const corner = first[0] ?? "";
  const reszta = first.slice(1).filter((c) => rodzajKomorki(c) !== "empty");
  if (reszta.length === 0) {
    // Tabela jednokolumnowa albo nagłówek z samym narożnikiem.
    if (table.length < 2 || rodzajKomorki(corner) !== "text") return false;
    return table.slice(1).some((r) => r.some((c) => rodzajKomorki(c) === "value"));
  }
  const tekst = reszta.filter((c) => rodzajKomorki(c) === "text").length;
  if (tekst * 2 >= reszta.length) return table.length > 1 || tekst === reszta.length;
  if (corner.trim() === "") return true;
  return rodzajKomorki(corner) === "text" && reszta.every(isPeriodLabel);
}

function wykryjSerieWWierszach(table: readonly (readonly string[])[], header: boolean): boolean {
  const width = table[0]?.length ?? 0;
  const body = header ? table.slice(1) : table;
  if (header) {
    const okresyWNaglowku = table[0].slice(1).filter((c) => c.trim() !== "");
    const pierwszaKolumna = body.map((r) => r[0] ?? "").filter((c) => c.trim() !== "");
    if (
      okresyWNaglowku.length >= 2 &&
      okresyWNaglowku.every(isPeriodLabel) &&
      pierwszaKolumna.length > 0 &&
      !pierwszaKolumna.every(isPeriodLabel)
    ) {
      return true;
    }
  }
  // Tabela, która mieści się w limitach WYŁĄCZNIE po obróceniu.
  return width - 1 > MAX_SERIES && body.length <= MAX_SERIES;
}

/**
 * Konwencja liczb z komórek WARTOŚCI (bez etykiet). Świadectwo jednej strony
 * przesądza; świadectwa sprzeczne rozstrzyga większość, a remis jest
 * niejasny. Brak świadectw przy liczbach niejasnych to „ambiguous"; brak
 * świadectw i brak niejasnych - konwencja domowa „pl", która wtedy niczego
 * nie zmienia.
 */
export function detectNumberLocale(cells: Iterable<string>): NumberLocale | "ambiguous" {
  let pl = 0;
  let en = 0;
  let ambiguous = 0;
  for (const cell of cells) {
    const style = numberStyle(cell);
    if (style === "pl") pl += 1;
    else if (style === "en") en += 1;
    else if (style === "ambiguous") ambiguous += 1;
  }
  if (pl === 0 && en === 0) return ambiguous > 0 ? "ambiguous" : "pl";
  if (pl > en) return "pl";
  if (en > pl) return "en";
  return "ambiguous";
}

function* komorkiWartosci(table: readonly (readonly string[])[], header: boolean) {
  for (let r = header ? 1 : 0; r < table.length; r += 1) {
    for (let c = 1; c < table[r].length; c += 1) yield table[r][c];
  }
}

/**
 * Rozpoznaje układ tabeli: nagłówek, orientację serii i konwencję liczb.
 *
 * To są DOMYŚLNE położenia przełączników w podglądzie wklejenia i importu, nie
 * wyrok. Konwencja jest jedna na tabelę, bo tabela przychodzi z jednego
 * źródła: komórka „12,5" przesądza o polskiej, „3.5" albo „1,234.5" - o
 * angielskiej. „ambiguous" znaczy, że są liczby, które w obu konwencjach
 * dają co innego („1,234"), a żadna komórka nie przesądza.
 */
export function analyseTable(rows: readonly (readonly string[])[]): TableAnalysis {
  const table = rectangularTable(rows);
  const headerRow = wykryjNaglowek(table);
  return {
    headerRow,
    seriesInRows: table.length > 0 && wykryjSerieWWierszach(table, headerRow),
    numberLocale: detectNumberLocale(komorkiWartosci(table, headerRow)),
  };
}

/** Transpozycja prostokąta: wiersze stają się kolumnami. */
export function transposeTable(rows: readonly (readonly string[])[]): string[][] {
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  return Array.from({ length: width }, (_, c) => rows.map((r) => r[c] ?? ""));
}

/** Reguła rozdzielaczy z wyboru użytkownika i rozpoznania; `liczNiejasne` - zgłaszać niejasne. */
function ustalRegule(
  choice: NumberLocaleChoice,
  rozpoznana: () => NumberLocale | "ambiguous",
): { rule: Rule; liczNiejasne: boolean } {
  if (choice !== "auto") return { rule: choice, liczNiejasne: false };
  const locale = rozpoznana();
  return locale === "ambiguous"
    ? { rule: "legacy", liczNiejasne: true }
    : { rule: locale, liczNiejasne: false };
}

// ---------------------------------------------------------------------------
// Tabela -> dane wykresu
// ---------------------------------------------------------------------------

/** Wybory układu przy imporcie i wklejeniu. Pole nieustawione = rozpoznanie. */
export interface ChartTableOptions {
  /** Czy PIERWSZY WIERSZ tabeli źródłowej to etykiety (w orientacji, w jakiej ją widać). */
  header?: boolean;
  /** Serie w wierszach: kolumny stają się kategoriami (tabela Eurostatu, GUS). */
  transpose?: boolean;
  locale?: NumberLocaleChoice;
}

/**
 * Pierwszy wiersz to nazwy serii (pierwsza komórka - róg tabeli - jest
 * ignorowana), pierwsza kolumna to kategorie. Dokładnie ten układ, który
 * czyta `parseChartData`, więc import i textarea opisują to samo.
 *
 * Kolumna bez nagłówka DALEJ jest serią - dostaje nazwę zastępczą z numeru.
 * Odrzucenie jej byłoby gorsze: liczby są w pliku, autor je widzi, a wykres
 * pokazałby o jedną serię mniej bez słowa wyjaśnienia.
 *
 * BEZ `opts` - zachowanie zastane: nagłówek zawsze, bez obrotu, reguła
 * rozdzielaczy sprzed wyboru konwencji. Z `opts` - pola nieustawione
 * rozpoznaje `analyseTable`, a decyzja „brak nagłówka" podjęta automatycznie
 * jest zgłaszana (`headerAssumed`), bo zmienia nazwy serii.
 *
 * Nagłówek i obrót opisują tabelę TAK, JAK JĄ WIDAĆ w podglądzie: przy obrocie
 * wiersz nagłówka (np. lata) staje się kolumną kategorii, a pierwsza kolumna
 * (np. kraje) - nazwami serii.
 */
export function tableToChartData(
  rows: readonly (readonly string[])[],
  opts?: ChartTableOptions,
): ImportedChartData {
  if (opts === undefined) return naDaneWykresu(rows, "legacy", false, []);
  const problems: ImportProblem[] = [];
  let table = rectangularTable(rows);
  if (table.length === 0) return { categories: [], series: [], problems };
  const analysis = analyseTable(table);
  const header = opts.header ?? analysis.headerRow;
  if (opts.header === undefined && !analysis.headerRow) problems.push({ code: "headerAssumed" });
  if (!header) {
    const width = table[0].length;
    table = [["", ...Array.from({ length: width - 1 }, (_, i) => String(i + 1))], ...table];
  }
  if (opts.transpose ?? analysis.seriesInRows) table = transposeTable(table);
  const { rule, liczNiejasne } = ustalRegule(opts.locale ?? "auto", () => analysis.numberLocale);
  return naDaneWykresu(table, rule, liczNiejasne, problems);
}

function naDaneWykresu(
  rows: readonly (readonly string[])[],
  rule: Rule,
  liczNiejasne: boolean,
  problems: ImportProblem[],
): ImportedChartData {
  if (rows.length < 2) return { categories: [], series: [], problems };

  const header = rows[0];
  const width = header.length;
  const seriesCount = Math.max(0, width - 1);
  const kept = Math.min(seriesCount, MAX_SERIES);
  if (seriesCount > kept) problems.push({ code: "seriesTruncated", dropped: seriesCount - kept });

  const bodyAll = rows.slice(1);
  const body = bodyAll.slice(0, MAX_CATEGORIES);
  if (bodyAll.length > body.length) {
    problems.push({ code: "categoriesTruncated", dropped: bodyAll.length - body.length });
  }

  const locale = rule === "legacy" ? undefined : rule;
  let nonNumeric = 0;
  let flags = 0;
  let niejasne = 0;
  const categories = body.map((r, i) => ((r[0] ?? "") !== "" ? r[0] : String(i + 1)));
  const series: ChartSeries[] = Array.from({ length: kept }, (_, si) => {
    const raw = header[si + 1] ?? "";
    const name = raw !== "" ? raw : `${si + 1}`;
    const values = body.map((r) => {
      const cell = r[si + 1] ?? "";
      const reading = readImportedNumber(cell, locale);
      if (reading.status === "invalid") nonNumeric += 1;
      if (reading.flagged) flags += 1;
      if (liczNiejasne && reading.status === "number" && numberStyle(cell) === "ambiguous") {
        niejasne += 1;
      }
      return reading.value;
    });
    return { name, values, colorSlot: slotForSeries(si) };
  });
  if (nonNumeric > 0) problems.push({ code: "nonNumericCells", count: nonNumeric });
  if (flags > 0) problems.push({ code: "dataFlags", count: flags });
  if (niejasne > 0) problems.push({ code: "localeAmbiguous", count: niejasne });
  return { categories, series, problems };
}

/**
 * Kolory po ponownym imporcie albo wklejeniu w ISTNIEJĄCY wykres.
 *
 * Import nadaje slot z pozycji, więc kolor wybrany przez redaktora ginął przy
 * każdym ponownym wczytaniu poprawionego pliku. Kolejność dopasowania:
 *   1. seria o tej samej nazwie (bez wielkości liter i spacji brzegowych) -
 *      kolor idzie za serią, nawet gdy w pliku zmieniła miejsce;
 *   2. seria na tej samej pozycji, jeśli jej nie zabrała już nazwa -
 *      przemianowana seria zachowuje kolor;
 *   3. slot z sekwencji dla pozycji, a gdy jest zajęty - pierwszy wolny,
 *      żeby nowa seria nie dostała koloru zachowanej.
 */
export function mergeSeriesColors(
  next: readonly ChartSeries[],
  previous: readonly ChartSeries[],
): ChartSeries[] {
  const klucz = (name: string) => name.trim().toLowerCase();
  const zajete = new Set<number>();
  const sloty: (number | null)[] = next.map(() => null);
  next.forEach((s, i) => {
    const k = klucz(s.name);
    if (k === "") return;
    const j = previous.findIndex((p, pj) => !zajete.has(pj) && klucz(p.name) === k);
    if (j === -1) return;
    zajete.add(j);
    sloty[i] = previous[j].colorSlot;
  });
  next.forEach((_, i) => {
    if (sloty[i] !== null || i >= previous.length || zajete.has(i)) return;
    zajete.add(i);
    sloty[i] = previous[i].colorSlot;
  });
  const uzyte = new Set(sloty.filter((s): s is number => s !== null));
  return next.map((s, i) => {
    let slot = sloty[i];
    if (slot === null) {
      const naPozycji = slotForSeries(i);
      slot = uzyte.has(naPozycji)
        ? (SLOT_SEQUENCE.find((candidate) => !uzyte.has(candidate)) ?? naPozycji)
        : naPozycji;
      uzyte.add(slot);
    }
    return { ...s, colorSlot: slot };
  });
}

// ---------------------------------------------------------------------------
// Tabela -> dane mapy
// ---------------------------------------------------------------------------

const ISO2 = /^[A-Z]{2}$/;

/** Skorowidz nazw krajów -> kod ISO-2, budowany z zasobu geometrii. */
export interface CountryIndex {
  byName: ReadonlyMap<string, string>;
  ids: ReadonlySet<string>;
}

/**
 * Skorowidz zasobu: każda nazwa pod kluczem `normaliseCountryName` ORAZ pod
 * kluczem aliasu (`countryAliasKey`: „&" jako „and", bez początkowego „the") -
 * żeby „Republic of North Macedonia" trafiało tam, gdzie zasób ma
 * „The Republic of North Macedonia".
 */
export function buildCountryIndex(
  countries: readonly { id: string; pl: string; en: string }[],
): CountryIndex {
  const byName = new Map<string, string>();
  const ids = new Set<string>();
  for (const c of countries) {
    const id = c.id.toUpperCase();
    ids.add(id);
    for (const label of [c.pl, c.en]) {
      for (const key of [normaliseCountryName(label), countryAliasKey(label)]) {
        if (key !== "" && !byName.has(key)) byName.set(key, id);
      }
    }
  }
  return { byName, ids };
}

/** Wybory układu tabeli mapy. Pole nieustawione = zachowanie zastane albo rozpoznanie. */
export interface MapTableOptions {
  /** Kolumna wartości (0 to kolumna kraju). Domyślnie druga kolumna. */
  valueColumn?: number;
  /** Czy pierwszy wiersz to nagłówek. Brak = rozpoznanie. */
  header?: boolean;
  locale?: NumberLocaleChoice;
}

/** Litera kolumny arkusza: 0 -> A, 25 -> Z, 26 -> AA. */
export function columnLetter(index: number): string {
  let n = Math.max(0, Math.floor(index));
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/** Wynik rozpoznania etykiety kraju; `alias` - czy trafiła przez tabelę aliasów. */
interface KrajZEtykiety {
  id: string;
  alias: boolean;
}

/**
 * Etykieta kraju -> ISO-2. Kolejność: kod ISO-2 z zasobu, nazwa z zasobu
 * (pl/en, także w postaci klucza aliasu), a dopiero potem tabela aliasów
 * (ISO-3, kody Eurostatu, nazwy zastępcze). Bez skorowidza kod ISO-2 przechodzi
 * na wiarę - z wyjątkiem „EL" i „UK", które są kodami Eurostatu, a nie ISO.
 */
function krajZEtykiety(label: string, idx: CountryIndex | undefined): KrajZEtykiety | null {
  const trimmed = label.trim();
  if (trimmed === "") return null;
  const upper = trimmed.toUpperCase();
  if (ISO2.test(upper)) {
    const znany = idx !== undefined ? idx.ids.has(upper) : !Object.hasOwn(CODE_ALIASES, upper);
    if (znany) return { id: upper, alias: false };
  }
  if (idx !== undefined) {
    const byName =
      idx.byName.get(normaliseCountryName(trimmed)) ?? idx.byName.get(countryAliasKey(trimmed));
    if (byName !== undefined) return { id: byName, alias: false };
  }
  const alias = resolveCountryAlias(trimmed);
  if (alias !== null && (idx === undefined || idx.ids.has(alias)))
    return { id: alias, alias: true };
  return null;
}

/**
 * Pierwsza kolumna to kraj (kod ISO-2, ISO-3, kod Eurostatu ALBO nazwa PL/EN),
 * wartość jest w drugiej - albo w kolumnie wskazanej `opts.valueColumn`.
 *
 * Wiersz nagłówka jest wykrywany, a nie zakładany: jeśli w pierwszym wierszu
 * druga komórka nie jest liczbą, traktujemy go jako nagłówek i pomijamy.
 * Zakładanie nagłówka na sztywno gubiłoby pierwszy kraj w plikach bez niego.
 *
 * Nazwa jest rozwiązywana tylko wtedy, gdy podano skorowidz - a ten powstaje
 * z TEGO SAMEGO zasobu geometrii, który rysuje mapę. Dzięki temu nie da się
 * zaimportować kraju, którego wybrany region i tak nie narysuje. Alias
 * (`countryAliases.ts`) też musi wskazać kraj ze skorowidza.
 *
 * INNE KOLUMNY Z LICZBAMI SĄ ZGŁASZANE. Tabela „kraj | 2019 | 2020 | 2021"
 * wchodziła jednym rokiem, a reszta znikała bez słowa (`columnsIgnored`).
 */
export function tableToMapValues(
  rows: readonly (readonly string[])[],
  index?: CountryIndex,
  opts?: MapTableOptions,
): ImportedMapData {
  const problems: ImportProblem[] = [];
  const values: MapDatum[] = [];
  const seen = new Set<string>();
  const unknown: string[] = [];
  const duplicate: string[] = [];
  const aliased: string[] = [];
  let skipped = 0;
  let flags = 0;
  let niejasne = 0;

  // PUSTY SKOROWIDZ ZNACZY „NIE MAM SKOROWIDZA", nie „nie ma takich krajów".
  // Zasób geometrii dociąga się fetchem i ma `retry: 1`; gdy nie zdążył albo
  // padł, wywołujący i tak przekazuje `buildCountryIndex([])`. Bez tej bramki
  // import poprawnego pliku kończył się komunikatem „nierozpoznane kraje:
  // PL, DE" - czyli odrzuceniem wszystkiego, co poprawne.
  const idx = index !== undefined && index.ids.size > 0 ? index : undefined;
  const valueCol = Math.max(1, Math.floor(opts?.valueColumn ?? 1));
  const { rule, liczNiejasne } =
    opts === undefined
      ? { rule: "legacy" as const, liczNiejasne: false }
      : ustalRegule(opts.locale ?? "auto", () => analyseTable(rows).numberLocale);
  const czytaj = (cell: string) => readImportedNumber(cell, rule === "legacy" ? undefined : rule);

  // NAGŁÓWEK WYMAGA OBU SYGNAŁÓW NARAZ: pierwsza komórka nie wskazuje kraju
  // ORAZ komórka wartości nie jest liczbą (albo cały wiersz to okresy: „Kraj |
  // 2019 | 2020" - lata SĄ liczbami, a mimo to są nagłówkiem).
  //
  // Sam test „druga komórka nie jest liczbą" zjadał pierwszy kraj MILCZĄCO,
  // gdy plik nie miał nagłówka, a pierwszemu krajowi brakowało wartości albo
  // stało w niej „b.d." - czyli w najczęstszym kształcie danych statystycznych.
  // Sam test „pierwsza komórka nie wskazuje kraju" zjadał z kolei jedyny
  // wiersz pliku, w którym kraj jest spoza wybranego regionu - a wtedy zamiast
  // komunikatu „nierozpoznany kraj" wychodziła pustka bez wyjaśnienia.
  // Koniunkcja nie ma obu tych dziur: wiersz z liczbą nigdy nie jest
  // nagłówkiem, a wiersz z rozpoznanym krajem nigdy nie jest nagłówkiem.
  const pierwszy = rows[0] ?? [];
  const toNaglowek =
    opts?.header ??
    (rows.length > 0 &&
      krajZEtykiety(pierwszy[0] ?? "", idx) === null &&
      (czytaj(pierwszy[valueCol] ?? "").value === null ||
        pierwszy.slice(1).every((c) => isPeriodLabel(c) || czytaj(c).value === null)));
  const body = toNaglowek ? rows.slice(1) : rows;

  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  const pominiete: string[] = [];
  for (let c = 1; c < width; c += 1) {
    if (c === valueCol) continue;
    if (!body.some((r) => czytaj(r[c] ?? "").status === "number")) continue;
    const nazwa = toNaglowek ? (pierwszy[c] ?? "").trim() : "";
    pominiete.push(nazwa !== "" ? nazwa : columnLetter(c));
  }

  for (const row of body) {
    const label = (row[0] ?? "").trim();
    const cell = row[valueCol] ?? "";
    const reading = czytaj(cell);
    if (label === "" && reading.value === null) continue;

    const hit = krajZEtykiety(label, idx);
    if (hit === null) {
      if (label !== "") unknown.push(label);
      else skipped += 1;
      continue;
    }
    if (reading.value === null) {
      skipped += 1;
      continue;
    }
    if (seen.has(hit.id)) {
      duplicate.push(label);
      continue;
    }
    seen.add(hit.id);
    if (hit.alias) aliased.push(`${label} (${hit.id})`);
    if (reading.flagged) flags += 1;
    if (liczNiejasne && numberStyle(cell) === "ambiguous") niejasne += 1;
    values.push({ id: hit.id, value: reading.value });
  }

  if (unknown.length > 0) problems.push({ code: "unknownCountries", labels: unknown });
  if (duplicate.length > 0) problems.push({ code: "duplicateCountries", labels: duplicate });
  if (skipped > 0) problems.push({ code: "rowsSkipped", count: skipped });
  if (aliased.length > 0) problems.push({ code: "aliasesApplied", labels: aliased });
  if (pominiete.length > 0) problems.push({ code: "columnsIgnored", labels: pominiete });
  if (flags > 0) problems.push({ code: "dataFlags", count: flags });
  if (niejasne > 0) problems.push({ code: "localeAmbiguous", count: niejasne });
  return { values, problems };
}

/**
 * Jedna etykieta kraju -> ISO-2 według tych samych reguł co import tabeli
 * (dla siatki mapy, która wkleja komórka po komórce). `alias` mówi, czy
 * trafienie wymaga zgłoszenia.
 */
export function resolveCountryLabel(
  label: string,
  index?: CountryIndex,
): { id: string; alias: boolean } | null {
  return krajZEtykiety(label, index !== undefined && index.ids.size > 0 ? index : undefined);
}

// ---------------------------------------------------------------------------
// Serializacja do textarei widgetu buildera
// ---------------------------------------------------------------------------

/**
 * Etykieta bezpieczna dla formatu średnikowego (`csv.ts`).
 *
 * Ten format NIE MA cytowania: dzieli wiersz po każdym średniku i łamie po
 * każdym znaku nowej linii. Etykieta „Kraków; Polska" rozpadała się więc na
 * dwie kolumny i przesuwała wszystkie wartości w wierszu, a kategoria
 * wielowierszowa - legalna w CSV wg RFC 4180 i przepuszczana przez nasz
 * parser - rozbijała jeden wiersz na dwa.
 *
 * Zamiana średnika na przecinek zmienia etykietę, więc NIE JEST cicha:
 * `tableToChartData` liczy takie podmiany i zgłasza je w `problems`.
 */
export function safeTextCell(raw: string): string {
  return raw
    .replace(/;/g, ",")
    .replace(/[\n\r]+/g, " ")
    .trim();
}

/** Czy etykieta wymaga podmiany, żeby przeżyć format średnikowy. */
export function needsTextCellFix(raw: string): boolean {
  return safeTextCell(raw) !== raw.trim();
}

/** Dane mapy -> tekst textarei: „PL; 12.5" na wiersz. */
export function mapValuesToText(values: readonly MapDatum[]): string {
  return values.map((v) => `${v.id}; ${v.value}`).join("\n");
}
