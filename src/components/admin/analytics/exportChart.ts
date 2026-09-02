/**
 * Chart data export helpers. Kept dependency-free so importing them does NOT
 * drag the ECharts module graph into the SSR bundle - `exportPng` receives an
 * `ECharts` instance as a parameter (already client-side by construction) and
 * asks it for a base64 canvas via `getDataURL`, no static echarts import here.
 *
 * CSV export follows RFC 4180 with CRLF line endings and quotes any cell that
 * contains a delimiter, quote, or newline. The BOM prefix makes Excel treat
 * the file as UTF-8 without prompting for encoding - and because the file
 * declares a spreadsheet as its reader, cells that a spreadsheet would take for
 * a formula are neutralised on the way out (see `neutralizeFormula`).
 */
import type { ECharts } from "echarts/core";

/**
 * Znaki, od których arkusz zaczyna czytać komórkę jako FORMUŁĘ, a nie jako
 * tekst. `=` i `@` otwierają formułę wprost, `+` i `-` przez skrót zapisu
 * (`+A1`, `-A1`), a TAB i CR są w tej liście, bo arkusze obcinają wiodące
 * białe znaki przed rozpoznaniem zawartości, więc `\t=1+1` wraca do `=1+1`.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * Liczba w zapisie, który arkusz i tak przeczyta jako LICZBĘ: opcjonalny znak,
 * część całkowita i ułamkowa (kropka albo przecinek - dane panelu jadą przez
 * `toLocaleString("pl-PL")`), notacja wykładnicza, opcjonalny procent.
 */
const PLAIN_NUMBER = /^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)(?:[eE][+-]?\d+)?%?$/;

/**
 * Neutralizacja wstrzyknięcia formuły do arkusza (CWE-1236).
 *
 * DROGA WEJŚCIA JEST ZEWNĘTRZNA. `GscBiDashboard` buduje wiersze eksportu z
 * `r.keys[0]`, czyli z FRAZY WYSZUKIWANIA z Search Console - wstawia ją dowolna
 * osoba, która wyszuka spreparowany napis i wejdzie na stronę tenanta, bo GSC
 * raportuje zapytanie już od jednej wyświetlonej pozycji. Cytowanie z RFC 4180
 * jej nie dotyka: `=cmd|'/c calc'!A0` nie ma przecinka ani cudzysłowa, więc dla
 * formatu CSV jest zwykłym tekstem i wychodzi z pliku nietknięty - a plik sam
 * deklaruje arkusz jako odbiorcę (BOM „dla Excela" w nagłówku wyżej), więc
 * ładunek wykonuje się na komputerze redaktora otwierającego raport.
 *
 * WYBÓR TECHNIKI. Prefiks apostrofu, ale WYŁĄCZNIE dla komórek zaczynających
 * się od znaku ryzykownego i NIEBĘDĄCYCH liczbą. Apostrof jest w Excelu,
 * LibreOffice i Arkuszach Google znacznikiem „to jest tekst" - dokładnie tym,
 * co wpisuje człowiek, gdy chce zobaczyć `=1+1` zamiast `2` - więc wartość
 * zostaje CZYTELNA w całości (żadnego kodowania, obcinania ani podmiany znaków)
 * i nie wymaga dodatkowego cytowania.
 *
 * Trzy warunki, których nie wolno przy tym złamać, i sposób, w jaki są tu
 * spełnione:
 *  - LICZBY. Najprostsze rozwiązanie - apostrof przed KAŻDĄ komórką - psuje
 *    kolumnę liczbową: `-12.5` stałoby się tekstem, a suma i wykres w arkuszu
 *    przestałyby działać. Dlatego przed prefiksem stoi `PLAIN_NUMBER`: wartość,
 *    którą arkusz przeczyta jako liczbę, przechodzi BEZ ZMIAN, bo liczba nie
 *    jest formułą.
 *  - DATY. Reguła patrzy tylko na PIERWSZY znak, a `2026-08-30` zaczyna się od
 *    cyfry, więc data nie jest nawet kandydatem do neutralizacji. Odwrotny
 *    pomysł („komórka zawiera `-`, `+` albo `=`") zamieniłby każdą datę ISO w
 *    tekst - i o tę różnicę idzie tu gra.
 *  - ŁADUNEK. `=cmd|'/c calc'!A0` liczbą nie jest, więc wychodzi jako
 *    `'=cmd|'/c calc'!A0`: arkusz pokazuje napis, nie uruchamia DDE.
 */
function neutralizeFormula(s: string): string {
  if (!FORMULA_LEAD.test(s) || PLAIN_NUMBER.test(s)) return s;
  return `'${s}`;
}

function escapeCell(v: unknown): string {
  // Kolejność jest istotna: najpierw neutralizacja, potem cytowanie z RFC 4180.
  // Apostrof ląduje więc WEWNĄTRZ pola cytowanego, a nie przed cudzysłowem
  // otwierającym - inaczej parser CSV zobaczyłby pole niecytowane zaczynające
  // się od apostrofu i cudzysłów w środku.
  if (v === null || v === undefined) return "";
  const s = neutralizeFormula(String(v));
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function buildCsv(headers: string[], rows: readonly (readonly unknown[])[]): string {
  const bom = "\uFEFF";
  const head = headers.map(escapeCell).join(",");
  const body = rows.map((r) => r.map(escapeCell).join(",")).join("\r\n");
  return `${bom}${head}\r\n${body}`;
}

function triggerDownload(filename: string, blob: Blob): void {
  if (typeof window === "undefined") return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportCsv(
  filename: string,
  headers: string[],
  rows: readonly (readonly unknown[])[],
): void {
  const blob = new Blob([buildCsv(headers, rows)], { type: "text/csv;charset=utf-8" });
  triggerDownload(filename.endsWith(".csv") ? filename : `${filename}.csv`, blob);
}

export function exportPng(filename: string, instance: ECharts | null | undefined): void {
  if (!instance) return;
  const url = instance.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: "#fff" });
  const bin = atob(url.split(",")[1] ?? "");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  triggerDownload(
    filename.endsWith(".png") ? filename : `${filename}.png`,
    new Blob([bytes], { type: "image/png" }),
  );
}
