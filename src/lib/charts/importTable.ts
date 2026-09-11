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
  | { code: "duplicateCountries"; labels: readonly string[] };

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
    s = s.split(thousands).join("");
    s = s.replace(decimal, ".");
  } else if (lastComma !== -1) {
    s = s.replace(",", ".");
  }
  if (!/^[+-]?\d*\.?\d+(?:[eE][+-]?\d+)?$/.test(s)) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

// ---------------------------------------------------------------------------
// Tekst rozdzielany (csv / tsv)
// ---------------------------------------------------------------------------

/**
 * Zgaduje separator, licząc wystąpienia POZA cudzysłowami w kilku pierwszych
 * niepustych wierszach. Liczenie w całym napisie myliło się na danych, gdzie
 * przecinek siedzi w nazwie kategorii („Warszawa, Polska") - a taki plik jest
 * w praktyce średnikowy.
 */
export function sniffDelimiter(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .slice(0, 10);
  const candidates = [";", "\t", ","];
  let best = ";";
  let bestScore = -1;
  for (const sep of candidates) {
    let score = 0;
    for (const line of lines) {
      let inQuotes = false;
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (ch === '"') inQuotes = !inQuotes;
        else if (ch === sep && !inQuotes) score += 1;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = sep;
    }
  }
  return bestScore > 0 ? best : ";";
}

/** Parser CSV/TSV z obsługą cudzysłowów i podwojonego `""` w środku pola. */
export function parseDelimitedText(text: string, delimiter?: string): string[][] {
  const sep = delimiter ?? sniffDelimiter(text);
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
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
    if (ch === '"') inQuotes = true;
    else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") cell += ch;
  }
  row.push(cell);
  rows.push(row);
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ""));
}

// ---------------------------------------------------------------------------
// Skoroszyt (xlsx / xls / ods)
// ---------------------------------------------------------------------------

/** Data w komórce -> ISO bez czasu; Excel i tak trzyma dzień jako liczbę. */
function cellToString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) {
    const iso = v.toISOString();
    return iso.slice(11) === "00:00:00.000Z"
      ? iso.slice(0, 10)
      : iso.slice(0, 19).replace("T", " ");
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
    sheets.push({ name, rows: rectangular(raw.map((r) => r.map(cellToString))) });
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
export function tableToMapValues(rows: readonly string[][], index?: CountryIndex): ImportedMapData {
  const problems: ImportProblem[] = [];
  const values: MapDatum[] = [];
  const seen = new Set<string>();
  const unknown: string[] = [];
  const duplicate: string[] = [];
  let skipped = 0;

  const body =
    rows.length > 0 && parseImportedNumber(rows[0][1] ?? "") === null ? rows.slice(1) : rows;

  for (const row of body) {
    const label = (row[0] ?? "").trim();
    const value = parseImportedNumber(row[1] ?? "");
    if (label === "" && value === null) continue;

    const upper = label.toUpperCase();
    let id: string | null = null;
    if (ISO2.test(upper) && (index === undefined || index.ids.has(upper))) id = upper;
    else if (index !== undefined) id = index.byName.get(normaliseCountryName(label)) ?? null;
    else if (ISO2.test(upper)) id = upper;

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
    values.push({ id, value });
  }

  if (unknown.length > 0) problems.push({ code: "unknownCountries", labels: unknown });
  if (duplicate.length > 0) problems.push({ code: "duplicateCountries", labels: duplicate });
  if (skipped > 0) problems.push({ code: "rowsSkipped", count: skipped });
  return { values, problems };
}

// ---------------------------------------------------------------------------
// Serializacja do textarei widgetu buildera
// ---------------------------------------------------------------------------

/** Liczba w zapisie kanonicznym: kropka dziesiętna, bez rozdzielacza tysięcy. */
function num(v: number | null): string {
  return v === null ? "" : String(v);
}

/**
 * Dane wykresu -> tekst textarei (`csv.ts`). Kropka dziesiętna jest ŚWIADOMA:
 * `parseNumber` czyta oba znaki, więc kropka jest bezpieczna zawsze, a
 * przecinek zderzyłby się z separatorem kolumn w plikach przecinkowych.
 */
export function chartDataToText(data: { categories: string[]; series: ChartSeries[] }): string {
  const header = ["", ...data.series.map((s) => s.name)].join("; ");
  const lines = data.categories.map((cat, ci) =>
    [cat, ...data.series.map((s) => num(s.values[ci] ?? null))].join("; "),
  );
  return [header, ...lines].join("\n");
}

/** Dane mapy -> tekst textarei: „PL; 12.5" na wiersz. */
export function mapValuesToText(values: readonly MapDatum[]): string {
  return values.map((v) => `${v.id}; ${v.value}`).join("\n");
}
