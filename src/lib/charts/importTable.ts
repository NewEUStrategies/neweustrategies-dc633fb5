// Import danych wykresu i mapy Z PLIKU: xlsx / xls / ods / csv / tsv.
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
// obowiązek to pokazać.
//
// BIBLIOTEKA JEST ŁADOWANA LENIWIE - `xlsx` to kilkaset kilobajtów i nie ma
// prawa wejść do grafu komuś, kto nigdy nie kliknie „Importuj". Ten sam
// wzorzec co `src/lib/files/officeParse.ts`.
import { MAX_SERIES, type ChartSeries, type MapDatum } from "./types";
import { MAX_CATEGORIES } from "./parse";
import { slotForSeries } from "@/lib/charts/palette";

/** Górny limit rozmiaru importowanego pliku. */
export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;

/** Rozszerzenia, które umiemy przeczytać. Bez kropki, małymi literami. */
export const IMPORT_EXTENSIONS = ["xlsx", "xlsm", "xls", "ods", "csv", "tsv", "txt"] as const;

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
  | { code: "colorsDropped"; labels: readonly string[] };

export interface ImportedSheet {
  name: string;
  /** Komórki w kolejności wierszy; prostokąt dociągnięty pustymi napisami. */
  rows: string[][];
}

export interface ImportedWorkbook {
  sheets: ImportedSheet[];
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

// ---------------------------------------------------------------------------
// Liczby
// ---------------------------------------------------------------------------

/**
 * Liczba z KOMÓRKI PLIKU. Świadomie mądrzejsza niż parser textarei, bo materiał
 * jest inny: textareę pisze człowiek w jednej konwencji, a plik przychodzi
 * z Excela sformatowany pod lokalizację autora.
 *
 * Reguła rozdzielaczy, gdy w napisie są OBA znaki: ten, który stoi DALEJ,
 * jest dziesiętny, a drugi jest rozdzielaczem tysięcy. Dzięki temu
 * „1.234,56" (PL) i „1,234.56" (EN) dają tę samą liczbę, i żadna z nich nie
 * daje 1,23456. Gdy znak jest jeden, przecinek jest dziesiętny - to zgodne
 * z `parseNumber` w `csv.ts`, więc import i textarea nie rozjeżdżają się na
 * tym samym napisie.
 *
 * Spacje (ze spacją nierozdzielającą i wąską włącznie) lecą w całości - Excel
 * wstawia je jako rozdzielacz tysięcy. Znak procentu NIE dzieli przez sto:
 * jednostka jest osobnym polem konfiguracji, a ciche dzielenie zmieniałoby
 * wartość, której redaktor nie prosił o zmianę.
 */
export function parseImportedNumber(raw: string): number | null {
  let s = raw.replace(/[\s\u00a0\u202f\u2009]/g, "").replace(/%$/, "");
  if (s === "") return null;
  // Zapis księgowy: (123) znaczy -123.
  const bracketed = /^\((.*)\)$/.exec(s);
  if (bracketed) s = `-${bracketed[1]}`;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma !== -1 && lastDot !== -1) {
    const decimal = lastComma > lastDot ? "," : ".";
    const thousands = decimal === "," ? "." : ",";
    const di = s.lastIndexOf(decimal);
    const grupy = odgrupuj(s.slice(0, di), thousands);
    if (grupy === null) return null;
    s = `${grupy}.${s.slice(di + 1)}`;
  } else if (lastComma !== -1) {
    s = s.replace(",", ".");
  }
  if (!/^[+-]?\d*\.?\d+(?:[eE][+-]?\d+)?$/.test(s)) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

/**
 * Zdejmuje rozdzielacz tysięcy, ale tylko z zapisu, który NAPRAWDĘ grupuje po
 * trzy. Bez tej kontroli „1.2.3,4" wychodziło jako 123,4 - czyli śmieć
 * zamieniony w wiarygodnie wyglądającą liczbę, a to jest gorsze niż odrzucenie:
 * liczba bez ostrzeżenia trafia na wykres i nikt jej nie kwestionuje.
 */
function odgrupuj(intPart: string, thousands: string): string | null {
  const parts = intPart.split(thousands);
  if (parts.length === 1) return parts[0];
  if (!/^[+-]?\d{1,3}$/.test(parts[0])) return null;
  for (let i = 1; i < parts.length; i += 1) {
    if (!/^\d{3}$/.test(parts[i])) return null;
  }
  return parts.join("");
}

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

/**
 * Zgaduje separator, licząc wystąpienia POZA polami cytowanymi.
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
export function sniffDelimiter(text: string): string {
  const body = znormalizuj(text).slice(0, SNIFF_LIMIT);
  const candidates = [";", "\t", ","];
  let best = ";";
  let bestScore = -1;
  for (const sep of candidates) {
    let score = 0;
    let inQuotes = false;
    let atFieldStart = true;
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
        score += 1;
        atFieldStart = true;
      } else if (ch === "\n") {
        atFieldStart = true;
      } else {
        atFieldStart = false;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = sep;
    }
  }
  return bestScore > 0 ? best : ";";
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

// ---------------------------------------------------------------------------
// Skoroszyt (xlsx / xls / ods)
// ---------------------------------------------------------------------------

/**
 * Data w komórce -> „RRRR-MM-DD" (z godziną tylko, gdy nie jest północą).
 *
 * KOMPONENTY LOKALNE, NIE `toISOString()`. SheetJS buduje `Date` w czasie
 * LOKALNYM, więc konwersja do UTC cofała dzień wszędzie na wschód od
 * Greenwich - czyli u polskiego redaktora komórka „2024-01-15" wychodziła jako
 * „2024-01-14 23:00:00". Etykieta kategorii z błędną datą i doklejoną
 * godziną to nie kosmetyka: tak wygląda oś czasu na opublikowanym wykresie.
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
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "1" : "0";
  return String(v).trim();
}

/** Dociąga wiersze do prostokąta i wyrzuca wiersze całkiem puste. */
function rectangular(rows: string[][]): string[][] {
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
 * niczego przetypować - napis zostaje napisem.
 */
export async function readWorkbook(file: File): Promise<ImportedWorkbook> {
  if (file.size > IMPORT_MAX_BYTES) {
    throw new Error(`file too large: ${file.size} > ${IMPORT_MAX_BYTES}`);
  }
  const ext = fileExtension(file.name);
  if (ext === "csv" || ext === "tsv" || ext === "txt") {
    const text = await file.text();
    const sep = ext === "tsv" ? "\t" : undefined;
    return { sheets: [{ name: file.name, rows: rectangular(parseDelimitedText(text, sep)) }] };
  }
  const XLSX = await import("xlsx");
  const book = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const sheets: ImportedSheet[] = [];
  for (const name of book.SheetNames) {
    const sheet = book.Sheets[name];
    if (sheet === undefined) continue;
    const raw = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: false,
    }) as unknown[][];
    sheets.push({ name, rows: rectangular(raw.map((r) => r.map(formatImportedCell))) });
  }
  return { sheets };
}

// ---------------------------------------------------------------------------
// Tabela -> dane wykresu
// ---------------------------------------------------------------------------

/**
 * Pierwszy wiersz to nazwy serii (pierwsza komórka - róg tabeli - jest
 * ignorowana), pierwsza kolumna to kategorie. Dokładnie ten układ, który
 * czyta `parseChartData`, więc import i textarea opisują to samo.
 *
 * Kolumna bez nagłówka DALEJ jest serią - dostaje nazwę zastępczą z numeru.
 * Odrzucenie jej byłoby gorsze: liczby są w pliku, autor je widzi, a wykres
 * pokazałby o jedną serię mniej bez słowa wyjaśnienia.
 */
export function tableToChartData(rows: readonly string[][]): ImportedChartData {
  const problems: ImportProblem[] = [];
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

  let nonNumeric = 0;
  const categories = body.map((r, i) => ((r[0] ?? "") !== "" ? r[0] : String(i + 1)));
  const series: ChartSeries[] = Array.from({ length: kept }, (_, si) => {
    const raw = header[si + 1] ?? "";
    const name = raw !== "" ? raw : `${si + 1}`;
    const values = body.map((r) => {
      const cell = r[si + 1] ?? "";
      if (cell === "") return null;
      const v = parseImportedNumber(cell);
      if (v === null) nonNumeric += 1;
      return v;
    });
    return { name, values, colorSlot: slotForSeries(si) };
  });
  if (nonNumeric > 0) problems.push({ code: "nonNumericCells", count: nonNumeric });
  return { categories, series, problems };
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

/** Normalizacja do porównań: bez ogonków, bez interpunkcji, małymi literami. */
export function normaliseCountryName(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ł/g, "l")
    .replace(/Ł/g, "l")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function buildCountryIndex(
  countries: readonly { id: string; pl: string; en: string }[],
): CountryIndex {
  const byName = new Map<string, string>();
  const ids = new Set<string>();
  for (const c of countries) {
    const id = c.id.toUpperCase();
    ids.add(id);
    for (const label of [c.pl, c.en]) {
      const key = normaliseCountryName(label);
      if (key !== "" && !byName.has(key)) byName.set(key, id);
    }
  }
  return { byName, ids };
}

/**
 * Pierwsza kolumna to kraj (kod ISO-2 ALBO nazwa PL/EN), druga to wartość.
 *
 * Wiersz nagłówka jest wykrywany, a nie zakładany: jeśli w pierwszym wierszu
 * druga komórka nie jest liczbą, traktujemy go jako nagłówek i pomijamy.
 * Zakładanie nagłówka na sztywno gubiłoby pierwszy kraj w plikach bez niego.
 *
 * Nazwa jest rozwiązywana tylko wtedy, gdy podano skorowidz - a ten powstaje
 * z TEGO SAMEGO zasobu geometrii, który rysuje mapę. Dzięki temu nie da się
 * zaimportować kraju, którego wybrany region i tak nie narysuje.
 */
/**
 * Wpisy mapy z tabeli importu.
 *
 * `poprzednie` TO NIE OZDOBNIK, tylko obrona przed cichą utratą pracy. Import
 * zastępuje dane, a plik ze statystyki nie niesie barw - bez tego parametru
 * odświeżenie liczb kasowało WSZYSTKIE barwy przypisane ręcznie, w obu
 * powierzchniach i bez jednego słowa. Autor, który pokolorował dwadzieścia
 * krajów i kliknął „Importuj", tracił całą tę pracę i dowiadywał się o tym
 * dopiero z podglądu. Barwę przenosimy po KODZIE KRAJU, bo tylko on jest
 * wspólny między starą treścią a nowym plikiem; kraj, którego w pliku nie ma,
 * znika razem z barwą - i to wychodzi jako `colorsDropped`.
 */
export function tableToMapValues(
  rows: readonly string[][],
  index?: CountryIndex,
  poprzednie?: readonly MapDatum[],
): ImportedMapData {
  const problems: ImportProblem[] = [];
  const values: MapDatum[] = [];
  const barwy = new Map<string, string>();
  for (const v of poprzednie ?? []) {
    if (v.color !== undefined) barwy.set(v.id, v.color);
  }
  const seen = new Set<string>();
  const unknown: string[] = [];
  const duplicate: string[] = [];
  let skipped = 0;

  // PUSTY SKOROWIDZ ZNACZY „NIE MAM SKOROWIDZA", nie „nie ma takich krajów".
  // Zasób geometrii dociąga się fetchem i ma `retry: 1`; gdy nie zdążył albo
  // padł, wywołujący i tak przekazuje `buildCountryIndex([])`. Bez tej bramki
  // import poprawnego pliku kończył się komunikatem „nierozpoznane kraje:
  // PL, DE" - czyli odrzuceniem wszystkiego, co poprawne.
  const idx = index !== undefined && index.ids.size > 0 ? index : undefined;

  /** Czy pierwsza komórka wiersza wskazuje kraj - po kodzie albo po nazwie. */
  const wskazujeKraj = (label: string): boolean => {
    const upper = label.trim().toUpperCase();
    if (idx !== undefined) {
      return idx.ids.has(upper) || idx.byName.has(normaliseCountryName(label));
    }
    return ISO2.test(upper);
  };

  // NAGŁÓWEK WYMAGA OBU SYGNAŁÓW NARAZ: pierwsza komórka nie wskazuje kraju
  // ORAZ druga nie jest liczbą.
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
    rows.length > 0 &&
    !wskazujeKraj(pierwszy[0] ?? "") &&
    parseImportedNumber(pierwszy[1] ?? "") === null;
  const body = toNaglowek ? rows.slice(1) : rows;

  for (const row of body) {
    const label = (row[0] ?? "").trim();
    const value = parseImportedNumber(row[1] ?? "");
    if (label === "" && value === null) continue;

    const upper = label.toUpperCase();
    let id: string | null = null;
    if (ISO2.test(upper) && (idx === undefined || idx.ids.has(upper))) id = upper;
    else if (idx !== undefined) id = idx.byName.get(normaliseCountryName(label)) ?? null;

    if (id === null) {
      if (label !== "") unknown.push(label);
      else skipped += 1;
      continue;
    }
    if (value === null) {
      skipped += 1;
      continue;
    }
    if (seen.has(id)) {
      duplicate.push(label);
      continue;
    }
    seen.add(id);
    const color = barwy.get(id);
    values.push(color === undefined ? { id, value } : { id, value, color });
  }

  // Kraje, które MIAŁY barwę, a w pliku ich nie ma - ich barwa przepada razem
  // z wierszem. Milczenie w tym miejscu jest dokładnie tą klasą błędu, przed
  // którą broni reszta tego modułu.
  const utracone = [...barwy.keys()].filter((id) => !seen.has(id));

  if (unknown.length > 0) problems.push({ code: "unknownCountries", labels: unknown });
  if (duplicate.length > 0) problems.push({ code: "duplicateCountries", labels: duplicate });
  if (skipped > 0) problems.push({ code: "rowsSkipped", count: skipped });
  if (utracone.length > 0) problems.push({ code: "colorsDropped", labels: utracone });
  return { values, problems };
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
  // Trzecia kolumna WYCHODZI, gdy barwa istnieje: inaczej serializacja po
  // imporcie kasowałaby to, co `tableToMapValues` właśnie ocaliło.
  return values
    .map((v) => {
      const liczba = v.value === null ? "" : String(v.value);
      return v.color === undefined ? `${v.id}; ${liczba}` : `${v.id}; ${liczba}; ${v.color}`;
    })
    .join("\n");
}
