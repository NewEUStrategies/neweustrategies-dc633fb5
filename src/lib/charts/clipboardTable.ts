// Tabela ze SCHOWKA: Excel, Arkusze Google, LibreOffice, Numbers i strony WWW.
//
// CZYSTY MODUŁ, BEZ `xlsx` I BEZ ZALEŻNOŚCI. Jedyne, czego potrzebuje ze
// środowiska, to `DOMParser` (przeglądarka, a w testach happy-dom). Wynik to
// `string[][]` - ten sam kształt, który czyta `importTable.ts`, więc wklejenie
// i plik przechodzą przez te same funkcje i dają te same liczby.
//
// HTML PRZED TEKSTEM. Arkusz wkłada do schowka dwie postaci: `text/plain`
// z tekstem WYŚWIETLANYM („1 234,50 zł", „12,5%", „1,234" w lokalizacji
// angielskiej) i `text/html` z tabelą, w której komórka liczbowa niesie też
// SUROWĄ wartość - Excel w atrybucie `x:num`, Arkusze Google w JSON-ie
// `data-sheets-value` (klucz „3"), LibreOffice w `sdval`. Surowa wartość nie
// zależy od lokalizacji, więc „1,234" przestaje być zagadką. Tekst jest
// planem B: gdy HTML-a nie ma, gdy nie ma w nim tabeli albo gdy jest za duży.
//
// SUROWA WARTOŚĆ TYLKO DLA LICZB. W komórce z DATĄ `x:num` to numer dnia
// Excela (45306 zamiast 15.01.2024) - na osi kategorii byłaby to katastrofa.
// Dlatego surowa wartość wygrywa wyłącznie wtedy, gdy format komórki nie jest
// datą ANI czasem, a tekst wyświetlany JEST liczbą według tej samej reguły,
// którą czyta się komórkę pliku (`importNumber.parseImportedCell`, w
// którejkolwiek konwencji). Etykiety, daty, braki danych („:") i wszystko
// inne zostają tekstem, który redaktor widzi w arkuszu; puste `x:num`
// (Excel tak oznacza komórkę, której tekst JEST wartością) - też.
//
// TEKST, KTÓRY SAM NIESIE LICZBĘ, ZOSTAJE. Schowek nie wie, która komórka
// bloku będzie etykietą (kategoria, nazwa serii), a która wartością. Tekst
// bez rozdzielacza dziesiętnego i tysięcy („5%", „001", „1 234 zł") czyta się
// w każdej konwencji tak samo; gdy daje dokładnie liczbę surową, zostaje -
// jako wartość daje tę samą liczbę, a jako etykieta nie traci „%" ani zer
// wiodących. Tekst z przecinkiem albo kropką („1,23" nad 1,234, „1,234") albo
// zaokrąglony („13%" nad 0,125) ustępuje surowej wartości w zapisie
// kanonicznym - także w etykiecie: bez pozycji w bloku nie da się odróżnić
// etykiety od wartości, a wartość nie może być zgadywana.
//
// PROCENT jak w pliku: „12,5%" z surową wartością 0,125 daje 12,5 - ta sama
// reguła co w procesie arkuszy (`isPercentFormat`, wartość · 100,
// `toPrecision(15)`) i w `parseImportedCell` (procent nie dzieli przez sto,
// jednostka jest osobnym polem). Procentem jest komórka, której format jest
// procentowy, albo - gdy żaden format nie mówi o procencie - której tekst
// kończy się znakiem „%". Format z „%" wyłącznie jako LITERAŁEM (`0" %"`,
// `0\%`) procentem nie jest, tak jak w pliku.
//
// JEDNA KOMÓRKA TO NIE TABELA. Wklejenie pojedynczej wartości (jeden wiersz
// bez tabulatora, tabela 1×1) daje `null` - wołający oddaje wtedy zdarzenie
// zwykłemu polu tekstowemu, które wklei napis po swojemu.
import type { ClipboardEvent as ReactClipboardEvent } from "react";
import { isPercentFormat } from "@/lib/files/spreadsheetProtocol";
import { isImportedNumber, readImportedNumber } from "./importNumber";

/** Obie postaci schowka; brak albo pusty napis znaczy „tej postaci nie ma". */
export interface ClipboardPayload {
  html?: string | null;
  text?: string | null;
}

export interface ClipboardTable {
  /** Prostokąt komórek; puste wiersze i kolumny z końca obcięte. */
  rows: string[][];
  /** Skąd tabela: tabela HTML, tekst z tabulatorami albo tekst bez nich (jedna kolumna). */
  source: "html" | "tsv" | "text";
  /** Liczba komórek prostokąta (wiersze × kolumny). */
  cells: number;
  /**
   * Czy wczytano tylko początek: schowek przekroczył `CLIPBOARD_MAX_CHARS`
   * albo tabela - `MAX_GRID_CELLS`.
   */
  truncated: boolean;
}

/**
 * Górny limit długości postaci schowka, sprawdzany PRZED parsowaniem. HTML
 * z Excela niesie style każdej komórki i bywa wielokrotnie dłuższy od tekstu;
 * ponad limit idzie plan B (tekst), a tekst ponad limit jest ucinany na
 * granicy wiersza i zgłaszany (`truncated`). Wykres i tak bierze najwyżej
 * kilkadziesiąt kategorii - limit chroni wątek strony, nie dane.
 */
export const CLIPBOARD_MAX_CHARS = 2_000_000;

/** Górny limit `colspan`/`rowspan` jednej komórki. */
const MAX_SPAN = 256;

/**
 * Górny limit komórek tabeli - zadeklarowanych w HTML-u ORAZ prostokąta po
 * dociągnięciu wierszy do najszerszego (HTML i tekst). `CLIPBOARD_MAX_CHARS`
 * nie ogranicza prostokąta: tysiące pustych linii pod jedną linią z tysiącami
 * tabulatorów to kilkanaście kilobajtów tekstu i dziesiątki milionów komórek.
 * Ponad limit zostaje początek tabeli, a obcięcie jest zgłaszane (`truncated`).
 */
export const MAX_GRID_CELLS = 500_000;

/** Najdłuższy kod formatu liczby w Excelu; dłuższy nie jest formatem i nie idzie do wzorców. */
const MAX_FORMAT_CHARS = 255;

/**
 * Liczba -> zapis kanoniczny: kropka dziesiętna, bez grupowania, bez ogona
 * binarnego. Liczba z JEDNĄ do TRZECH cyfr przed kropką i DOKŁADNIE trzema po
 * niej („1.234") dostaje czwartą cyfrę („1.2340"): w tej postaci nikt - ani
 * rozpoznanie konwencji, ani redaktor - nie weźmie jej za tysiąc dwieście
 * trzydzieści cztery.
 */
export function canonicalNumber(n: number): string {
  if (!Number.isFinite(n)) return "";
  const s = String(n);
  return /^-?[1-9]\d{0,2}\.\d{3}$/.test(s) ? `${s}0` : s;
}

/** Ogon binarny po mnożeniu: 0,07 · 100 = 7,000000000000001. */
function bezOgona(n: number): number {
  return Number(n.toPrecision(15));
}

// ---------------------------------------------------------------------------
// Formaty komórek
// ---------------------------------------------------------------------------

/** Nazwane formaty Excela, które datą nie są, choć mają w nazwie „d" albo „s". */
const NAMED_NUMBER_FORMATS = /^(?:general|standard|fixed|percent|scientific|currency)$/i;

/**
 * Czy kod formatu liczby to data albo czas (Excel, LibreOffice, Arkusze
 * Google). Literały w cudzysłowach, znaki po ukośniku i nawiasy lokalizacji
 * („[$-415]", „[Red]") nie liczą się; nawiasy czasu upływającego („[h]",
 * „[mm]") - tak. Fałszywy alarm jest tani (zostaje tekst wyświetlany),
 * przeoczona data - nie (numer dnia na osi), więc w razie wątpliwości: data.
 */
export function isDateFormatCode(code: string): boolean {
  const f = code.trim();
  if (f === "") return false;
  if (/date|time/i.test(f)) return true;
  const bezLiteralow = f.replace(/"[^"]*"/g, "").replace(/\\./g, "");
  if (/\[(?:h+|m+|s+)\]/i.test(bezLiteralow)) return true;
  const bezNawiasow = bezLiteralow.replace(/\[[^\]]*\]/g, "").trim();
  if (NAMED_NUMBER_FORMATS.test(bezNawiasow)) return false;
  return /[dmyhs]/i.test(bezNawiasow.replace(/general/gi, ""));
}

/** Ucieczki CSS z wartości `mso-number-format` („\0022" to cudzysłów). */
function bezUcieczekCss(value: string): string {
  return value
    .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/\\(.)/g, "$1");
}

/** `mso-number-format` z deklaracji CSS (klasy z `<style>` albo atrybutu `style`). */
function msoFormat(declarations: string): string | null {
  const m = /mso-number-format\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^;]+)/i.exec(
    declarations,
  );
  if (!m) return null;
  const raw = m[1].trim();
  const unquoted = /^["'].*["']$/.test(raw) ? raw.slice(1, -1) : raw;
  return bezUcieczekCss(unquoted);
}

/**
 * Klasa -> format liczby z arkuszy stylów, które Excel wkłada do schowka.
 *
 * Reguła po regule, cięciem na „}" - liniowo. Wzorzec globalny
 * „\.klasa\s*\{[^}]*\}" przy regułach bez domknięcia („.a{" sto tysięcy razy)
 * od KAŻDEJ kropki czytał arkusz do końca: sekundy na jedno wklejenie.
 * Klasa to ostatni selektor przed klamrą, tak jak we wzorcu.
 */
function formatyKlas(doc: Document): Map<string, string> {
  const out = new Map<string, string>();
  for (const style of Array.from(doc.querySelectorAll("style"))) {
    const reguly = (style.textContent ?? "").split("}");
    // Ostatni kawałek nie ma domknięcia - nie jest regułą.
    for (const regula of reguly.slice(0, -1)) {
      const klamra = regula.lastIndexOf("{");
      if (klamra === -1) continue;
      const klasa = /\.([A-Za-z0-9_-]+)\s*$/.exec(regula.slice(0, klamra));
      if (klasa === null) continue;
      const format = msoFormat(regula.slice(klamra + 1));
      if (format !== null) out.set(klasa[1], format);
    }
  }
  return out;
}

/** JSON z atrybutu `data-sheets-*`; śmieć to `null`, nie wyjątek. */
function jsonAtrybutu(el: Element, name: string): Record<string, unknown> | null {
  const raw = el.getAttribute(name);
  if (raw === null || raw === "") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Format komórki w którymkolwiek dialekcie. */
interface FormatKomorki {
  /**
   * „date" (data albo czas), „number" (format jest i datą nie jest) albo
   * `null` - formatu brak (komórka w formacie ogólnym albo HTML spoza arkusza).
   */
  rodzaj: "date" | "number" | null;
  /**
   * Czy format mówi o procencie: `true` - format procentowy, `false` - „%"
   * jest w formacie wyłącznie literałem, `null` - żaden format o procencie
   * nie mówi (rozstrzyga wtedy tekst wyświetlany).
   */
  procent: boolean | null;
}

function formatKomorki(el: Element, klasy: ReadonlyMap<string, string>): FormatKomorki {
  const kody: string[] = [];
  const inline = msoFormat(el.getAttribute("style") ?? "");
  if (inline !== null) kody.push(inline);
  for (const cls of (el.getAttribute("class") ?? "").split(/\s+/)) {
    const format = klasy.get(cls);
    if (format !== undefined) kody.push(format);
  }
  // Arkusze Google: {"1": typ, "2": wzorzec}; typy 5-7 to data, czas, data z czasem.
  const sheets = jsonAtrybutu(el, "data-sheets-numberformat");
  let dataArkuszy = false;
  if (sheets !== null) {
    dataArkuszy = sheets["1"] === 5 || sheets["1"] === 6 || sheets["1"] === 7;
    const wzorzec = sheets["2"];
    kody.push(typeof wzorzec === "string" ? wzorzec : "General");
  }
  // LibreOffice: sdnum="1045;1045;DD.MM.YYYY" - trzecia część to kod formatu.
  const sdnum = el.getAttribute("sdnum");
  if (sdnum !== null) kody.push(sdnum.split(";").slice(2).join(";") || "General");
  // Kod dłuższy niż pozwala Excel formatem nie jest - i nie idzie do wzorców
  // literałów („\[[^\]]*\]" na tysiącach „[" to kwadrat długości).
  const prawdziwe = kody.filter((k) => k.length <= MAX_FORMAT_CHARS);
  const procentowe = prawdziwe.filter((k) => isPercentFormat(k));
  const zZnakiem = prawdziwe.filter((k) => k.includes("%"));
  const procent = procentowe.length > 0 ? true : zZnakiem.length > 0 ? false : null;
  if (prawdziwe.length === 0) return { rodzaj: null, procent: null };
  return {
    rodzaj: dataArkuszy || prawdziwe.some(isDateFormatCode) ? "date" : "number",
    procent,
  };
}

/** Surowa wartość liczbowa komórki: `x:num`, `data-sheets-value["3"]`, `sdval`. */
function surowaLiczba(el: Element): number | null {
  const kandydaci: unknown[] = [];
  const excel = el.getAttribute("x:num");
  if (excel !== null && excel.trim() !== "") kandydaci.push(Number(excel));
  const sheets = jsonAtrybutu(el, "data-sheets-value");
  if (sheets !== null && (sheets["1"] === undefined || sheets["1"] === 3))
    kandydaci.push(sheets["3"]);
  const libre = el.getAttribute("sdval");
  if (libre !== null && libre.trim() !== "") kandydaci.push(Number(libre));
  for (const k of kandydaci) if (typeof k === "number" && Number.isFinite(k)) return k;
  return null;
}

/**
 * Czy tekst wyświetlany wygląda na datę z samych cyfr („15.01", „01.2024",
 * „15.01.2024", „2024/01/15"). Używane TYLKO dla komórki bez żadnego formatu:
 * gdy format jest, rozstrzyga on, a „25.00" w formacie procentowym datą nie
 * jest.
 */
function wygladaNaDate(display: string): boolean {
  const s = display.trim();
  return (
    /^\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?$/.test(s) ||
    /^\d{1,2}[./-]\d{4}$/.test(s) ||
    /^\d{4}[./-]\d{1,2}(?:[./-]\d{1,2})?$/.test(s)
  );
}

/** Tekst komórki: odstępy HTML zwinięte, `<br>` jako złamanie wiersza. */
function tekstKomorki(el: Element): string {
  let out = "";
  const zbierz = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        out += (child.nodeValue ?? "").replace(/[\t\n\r\f ]+/g, " ");
      } else if (child.nodeType === 1) {
        const tag = (child as Element).tagName;
        if (tag === "BR") out += "\n";
        else if (tag !== "STYLE" && tag !== "SCRIPT" && tag !== "TEMPLATE") zbierz(child);
      }
    }
  };
  zbierz(el);
  return out
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

/**
 * Wartość komórki HTML jako napis dla importu. Surowa liczba wygrywa tylko
 * wtedy, gdy format komórki nie jest datą, a tekst wyświetlany JEST liczbą
 * (`isImportedNumber` - ta sama reguła co komórka pliku); komórka BEZ
 * formatu, której tekst wygląda na datę z samych cyfr, zostaje tekstem.
 * Procent (format procentowy albo, bez rozstrzygającego formatu, „%" na końcu
 * tekstu) to surowa wartość · 100 bez ogona binarnego. Tekst, który sam niesie
 * dokładnie tę liczbę (`tekstWystarcza`), zostaje tekstem.
 */
function wartoscKomorki(el: Element, klasy: ReadonlyMap<string, string>): string {
  const display = tekstKomorki(el);
  const format = formatKomorki(el, klasy);
  if (format.rodzaj === "date") return display;
  const raw = surowaLiczba(el);
  if (raw === null || !isImportedNumber(display)) return display;
  if (format.rodzaj === null && wygladaNaDate(display)) return display;
  const procent = format.procent ?? /%\s*$/.test(display);
  const value = procent ? bezOgona(raw * 100) : raw;
  return tekstWystarcza(display, value) ? display : canonicalNumber(value);
}

/**
 * Czy tekst wyświetlany SAM niesie liczbę: nie ma przecinka ani kropki (więc
 * konwencja nie ma czego rozstrzygać), nie ma flagi i daje dokładnie `value`.
 * „5%" nad 0,05, „001" nad 1 i „1 234 zł" nad 1234 - tak; „13%" nad 0,125
 * (zaokrąglenie) i „1,234" (konwencja) - nie.
 */
function tekstWystarcza(display: string, value: number): boolean {
  if (/[.,]/.test(display)) return false;
  const reading = readImportedNumber(display);
  return reading.value === value && !reading.flagged;
}

function spanOf(el: Element, attr: "colspan" | "rowspan"): number {
  const n = Number.parseInt(el.getAttribute(attr) ?? "1", 10);
  return Number.isFinite(n) && n > 1 ? Math.min(n, MAX_SPAN) : 1;
}

/**
 * Pierwsza tabela HTML -> siatka napisów. Komórki scalone (`colspan`,
 * `rowspan`) zajmują swoje miejsca w siatce, a wartość stoi w lewym górnym
 * rogu scalenia - pozostałe pozycje są puste, tak jak w `text/plain` Excela.
 * Bez tego rozwinięcia każda komórka za scaleniem lądowała o kolumnę za
 * wcześnie. Wiersze tabel ZAGNIEŻDŻONYCH w komórkach nie są wierszami tej
 * tabeli (ten sam wzorzec co `wordPaste.ts`).
 */
function tabelaHtml(html: string): { rows: string[][]; truncated: boolean } | null {
  if (typeof DOMParser === "undefined" || !/<table[\s>]/i.test(html)) return null;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const table = doc.querySelector("table");
  if (table === null) return null;
  const klasy = formatyKlas(doc);
  const grid: string[][] = [];
  const zajete: boolean[][] = [];
  let komorki = 0;
  let truncated = false;
  const wiersze = Array.from(table.querySelectorAll("tr")).filter(
    (tr) => tr.closest("table") === table,
  );
  wiersze.forEach((tr, r) => {
    if (truncated) return;
    let c = 0;
    for (const td of Array.from(tr.children)) {
      if (td.tagName !== "TD" && td.tagName !== "TH") continue;
      while (zajete[r]?.[c]) c += 1;
      const cs = spanOf(td, "colspan");
      const rs = spanOf(td, "rowspan");
      komorki += cs * rs;
      if (komorki > MAX_GRID_CELLS) {
        truncated = true;
        return;
      }
      const value = wartoscKomorki(td, klasy);
      for (let dr = 0; dr < rs; dr += 1) {
        for (let dc = 0; dc < cs; dc += 1) {
          (zajete[r + dr] ??= [])[c + dc] = true;
          (grid[r + dr] ??= [])[c + dc] = dr === 0 && dc === 0 ? value : "";
        }
      }
      c += cs;
    }
  });
  // `Array.from`, nie `map`: wiersz bez komórek zostawia w siatce DZIURĘ,
  // którą `map` przepuściłby dalej jako `undefined` zamiast pustego wiersza.
  return {
    rows: Array.from(grid, (row) => Array.from(row ?? [], (cell) => cell ?? "")),
    truncated,
  };
}

// ---------------------------------------------------------------------------
// Tekst z tabulatorami
// ---------------------------------------------------------------------------

/**
 * Tokenizacja tekstu schowka WYMUSZONYM tabulatorem. Arkusze zawsze kopiują
 * zakres jako TSV; zgadywanie separatora po liczbie wystąpień brało przecinki
 * polskich ułamków za separator i rozcinało liczby.
 *
 * Cytowanie tak, jak pisze je Excel: komórka z nową linią albo tabulatorem
 * jest w cudzysłowach, a cudzysłów w środku jest podwojony. Cudzysłów
 * zamyka pole tylko przed tabulatorem, końcem wiersza albo końcem tekstu;
 * inny cudzysłów w polu jest literą. `null`, gdy cytowanie nie domyka się
 * do końca tekstu - wołający bierze wtedy przebieg bez cytowania.
 */
function tokenizujTsv(body: string, cytowanie: boolean): string[][] | null {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let inQuotes = false;
  let atFieldStart = true;
  const zamknijKomorke = () => {
    row.push(quoted ? cell : cell.trim());
    cell = "";
    quoted = false;
    atFieldStart = true;
  };
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (inQuotes) {
      if (ch !== '"') cell += ch;
      else if (body[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (i + 1 === body.length || body[i + 1] === "\t" || body[i + 1] === "\n") {
        inQuotes = false;
      } else cell += ch;
      continue;
    }
    if (cytowanie && ch === '"' && atFieldStart) {
      inQuotes = true;
      quoted = true;
      atFieldStart = false;
    } else if (ch === "\t") {
      zamknijKomorke();
    } else if (ch === "\n") {
      zamknijKomorke();
      rows.push(row);
      row = [];
    } else {
      cell += ch;
      atFieldStart = false;
    }
  }
  if (inQuotes) return null;
  zamknijKomorke();
  rows.push(row);
  return rows;
}

/** Odsetek wierszy o dominującej szerokości - miara, który przebieg jest tabelą. */
function zgodnoscSzerokosci(rows: readonly (readonly string[])[]): number {
  const niepuste = rows.filter((r) => r.some((c) => c !== ""));
  if (niepuste.length === 0) return 0;
  const freq = new Map<number, number>();
  for (const r of niepuste) freq.set(r.length, (freq.get(r.length) ?? 0) + 1);
  return Math.max(...freq.values()) / niepuste.length;
}

/**
 * Tekst schowka -> wiersze. Gdy w tekście jest cudzysłów, liczą się DWA
 * przebiegi: z cytowaniem i bez. Komórka wielowierszowa z Excela jest
 * poprawnie zacytowana i tylko przebieg z cytowaniem daje równe wiersze;
 * zabłąkany cudzysłów z Arkuszy Google (komórka zaczynająca się od „"",
 * której Arkusze NIE cytują) skleja w nim kilka wierszy w jedną komórkę -
 * i wtedy równiejszy jest przebieg bez cytowania.
 *
 * Remis wygrywa cytowanie (RFC 4180) - chyba że zacytowana komórka zawiera
 * TABULATOR. Komórka arkusza z tabulatorem w środku to rzadkość, a cudzysłów
 * sklejający dwie komórki zawsze go połyka; bez tej reguły zabłąkany
 * cudzysłów, który akurat skleja wiersze „równo", wygrywałby remis.
 */
function tabelaTekstowa(text: string): string[][] {
  const body = text.replace(/\r\n?/g, "\n");
  const literalnie = tokenizujTsv(body, false) ?? [];
  if (!body.includes('"')) return literalnie;
  const zCytowaniem = tokenizujTsv(body, true);
  if (zCytowaniem === null) return literalnie;
  const a = zgodnoscSzerokosci(zCytowaniem);
  const b = zgodnoscSzerokosci(literalnie);
  if (a !== b) return a > b ? zCytowaniem : literalnie;
  return zCytowaniem.some((r) => r.some((c) => c.includes("\t"))) ? literalnie : zCytowaniem;
}

// ---------------------------------------------------------------------------
// Wejście
// ---------------------------------------------------------------------------

/**
 * Prostokąt bez pustych wierszy i kolumn na końcu, w limicie
 * `MAX_GRID_CELLS`. Szerokość to ostatnia niepusta komórka któregokolwiek
 * wiersza, liczona JEDNYM przejściem - zdejmowanie pustej kolumny z końca po
 * kolumnie, z przejściem przez wszystkie wiersze za każdym razem, było
 * kwadratem. Prostokąt ponad limit traci najpierw kolumny ponad limit,
 * potem wiersze z dołu (`cut`), ZANIM cokolwiek zostanie dociągnięte.
 */
function przytnij(rows: readonly (readonly string[])[]): { rows: string[][]; cut: boolean } {
  const pusta = (c: string | undefined) => c === undefined || c.trim() === "";
  const wysokosc = (h: number) => {
    let out = Math.min(h, rows.length);
    while (out > 0 && rows[out - 1].every((c) => pusta(c))) out -= 1;
    return out;
  };
  const szerokosc = (h: number) => {
    let w = 0;
    for (let r = 0; r < h; r += 1) {
      const row = rows[r];
      for (let i = row.length - 1; i >= w; i -= 1) {
        if (!pusta(row[i])) {
          w = i + 1;
          break;
        }
      }
    }
    return w;
  };
  let height = wysokosc(rows.length);
  let width = szerokosc(height);
  let cut = false;
  if (width > MAX_GRID_CELLS) {
    width = MAX_GRID_CELLS;
    cut = true;
  }
  if (height * width > MAX_GRID_CELLS) {
    height = wysokosc(Math.floor(MAX_GRID_CELLS / width));
    width = Math.min(width, szerokosc(height));
    cut = true;
  }
  return {
    rows: rows.slice(0, height).map((r) => Array.from({ length: width }, (_, i) => r[i] ?? "")),
    cut,
  };
}

function wynik(
  rows: readonly (readonly string[])[],
  source: ClipboardTable["source"],
  truncated: boolean,
): ClipboardTable | null {
  const { rows: table, cut } = przytnij(rows);
  const width = table[0]?.length ?? 0;
  const cells = table.length * width;
  return cells < 2 ? null : { rows: table, source, cells, truncated: truncated || cut };
}

/** Tekst ponad limit: ucięty na ostatniej granicy wiersza przed limitem. */
function przytnijTekst(text: string): { text: string; truncated: boolean } {
  if (text.length <= CLIPBOARD_MAX_CHARS) return { text, truncated: false };
  const head = text.slice(0, CLIPBOARD_MAX_CHARS);
  const nl = head.lastIndexOf("\n");
  return { text: nl > 0 ? head.slice(0, nl) : head, truncated: true };
}

/**
 * Schowek -> tabela albo `null`, gdy to nie jest tabela (nic, sam tekst
 * w jednym wierszu bez tabulatora, jedna komórka).
 *
 * Kolejność: tabela HTML (o ile HTML mieści się w limicie i ma `<table>`),
 * potem tekst. Tekst z tabulatorem to TSV; tekst wielowierszowy bez
 * tabulatora to jedna kolumna (kopia jednej kolumny z Excela tabulatorów nie
 * ma); jeden wiersz bez tabulatora to zwykły napis.
 */
export function readClipboardTable(p: ClipboardPayload): ClipboardTable | null {
  const html = p.html ?? "";
  if (html !== "" && html.length <= CLIPBOARD_MAX_CHARS) {
    const fromHtml = tabelaHtml(html);
    if (fromHtml !== null && fromHtml.rows.length > 0) {
      return wynik(fromHtml.rows, "html", fromHtml.truncated);
    }
  }
  const raw = p.text ?? "";
  if (raw.trim() === "") return null;
  const { text, truncated } = przytnijTekst(raw);
  const hasTab = text.includes("\t");
  if (!hasTab && !/[\r\n]/.test(text.trim())) return null;
  return wynik(tabelaTekstowa(text), hasTab ? "tsv" : "text", truncated);
}

/** Obie postaci schowka ze zdarzenia wklejenia - DOM albo React. */
export function clipboardPayloadOf(
  e: ClipboardEvent | ReactClipboardEvent<Element>,
): ClipboardPayload {
  const data = e.clipboardData;
  if (data === null || data === undefined) return { html: null, text: null };
  const html = data.getData("text/html");
  const text = data.getData("text/plain");
  return { html: html !== "" ? html : null, text: text !== "" ? text : null };
}
