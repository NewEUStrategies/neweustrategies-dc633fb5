// EKSPORT LEADÓW WYSTAWCY - kolumny i budowa pliku.
//
// KOLUMNA ZGODY IDZIE ZAWSZE. Sponsor dostaje też wiersze bez zgody (rozlicza
// się z liczby skanów przy stoisku), ale w takich wierszach NIE MA NICZEGO, co
// identyfikuje osobę: imię, nazwisko, firma, stanowisko, e-mail i telefon są
// puste, a kolumna „zgoda" mówi wprost dlaczego. Ukrycie takiego wiersza
// dawałoby sponsorowi wrażenie, że skan się nie zapisał, i wywoływało ponowny
// skan. Zgoda to zgoda na przekazanie danych partnerom TEGO wydarzenia
// (`_event_partner_consent_at`) - zgoda z innego wydarzenia jej nie zastępuje.
//
// Zostają: sponsor, zgoda i jej stempel, ocena, NOTATKA, liczniki i urządzenie.
// Notatkę wpisała obsługa stoiska na własnym urządzeniu - sponsor widzi ją też
// na liście stoiska i w linku raportu, więc plik oddaje mu jego własny zapis,
// a nie dane z kartoteki organizatora (ta sama decyzja w SQL, migracja
// `20261013110200`).
//
// TOŻSAMOŚĆ ZERUJE TEN MODUŁ, NIE TYLKO SQL. RPC też redaguje te pola, ale
// to jest OSTATNIA bramka przed dyskiem sponsora: regresja po stronie zapytania
// (nowa kolumna w SELECT, zmieniony warunek, wiersz z innego źródła) wynosi
// dane osoby z budynku nieodwracalnie. Dlatego reguła stoi po obu stronach.
//
// CSV Z BOM. Excel bez BOM czyta UTF-8 jako stronę kodową systemu i rozsypuje
// polskie znaki w nazwiskach - a to jest plik czytany poza systemem.
import { toCsv } from "@/lib/csv/formatCsv";
import type { LeadExportRow } from "@/lib/events/onsiteApi";
import { downloadBlob } from "@/lib/files/downloadBlob";
import { writeSpreadsheetInWorker } from "@/lib/files/spreadsheetWorker";

/**
 * Wiersz eksportu z polami, które MOGĄ być puste. Wiersze z RPC panelu
 * (`LeadExportRow`) pasują tu bez zmian; wiersze z raportu dla sponsora
 * przychodzą z jsonb i puste pola mają jawnie jako `null`.
 */
export type LeadExportCellsRow = { [K in keyof LeadExportRow]: LeadExportRow[K] | null };

export interface LeadExportFile {
  fileName: string;
  mimeType: string;
  /** Zawartość gotowa do `Blob` - tekst dla CSV, bajty dla XLSX. */
  data: string | ArrayBuffer;
}

const COLUMNS_PL = [
  "Sponsor",
  "Imię",
  "Nazwisko",
  "Firma",
  "Stanowisko",
  "E-mail",
  "Telefon",
  "Zgoda",
  "Zgoda zapisana",
  "Ocena",
  "Notatka",
  "Liczba skanów",
  "Pierwszy skan",
  "Ostatni skan",
  "Urządzenie",
] as const;

const COLUMNS_EN = [
  "Sponsor",
  "First name",
  "Last name",
  "Company",
  "Job title",
  "Email",
  "Phone",
  "Consent",
  "Consent recorded",
  "Rating",
  "Note",
  "Scans",
  "First scan",
  "Last scan",
  "Device",
] as const;

export function leadExportColumns(lang: string): readonly string[] {
  return lang === "en" ? COLUMNS_EN : COLUMNS_PL;
}

/**
 * Komórka danych osoby w wierszu BEZ zgody: każda treść staje się `null` -
 * tak samo jak z RPC. Komórka, która przyszła już pusta (`null` albo `""`),
 * zostaje w tej postaci: redakcja niczego nie dopisuje.
 */
function redactedIdentity(value: string | null): string | null {
  return value === "" ? "" : null;
}

/** Jeden wiersz eksportu w kolejności kolumn. */
export function leadExportCells(
  row: LeadExportCellsRow,
  lang: string,
): ReadonlyArray<string | number | null> {
  const yes = lang === "en" ? "yes" : "tak";
  const no = lang === "en" ? "no" : "nie";
  // Zgoda rozstrzyga o danych osoby PRZED zapisem do pliku - patrz nagłówek
  // modułu. Brak flagi (`null`, starsza odpowiedź) to brak zgody.
  const consented = row.consent === true;
  const identity = (value: string | null): string | null =>
    consented ? value : redactedIdentity(value);
  return [
    row.sponsor_name,
    identity(row.first_name),
    identity(row.last_name),
    identity(row.company),
    identity(row.job_title),
    identity(row.email),
    identity(row.phone),
    consented ? yes : no,
    row.consent_snapshot_at,
    row.interest_rating,
    row.note,
    row.scan_count,
    row.first_scanned_at,
    row.last_scanned_at,
    row.device_label,
  ];
}

/** Nazwa pliku: prefiks, dzień z ISO i rozszerzenie. */
export function leadExportFileName(prefix: string, nowIso: string, extension: string): string {
  const slug = prefix
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug === "" ? "leady" : slug}-${nowIso.slice(0, 10)}.${extension}`;
}

/** Buduje plik eksportu w żądanym formacie (XLSX zapisuje proces arkuszy). */
export async function buildLeadExport(
  rows: readonly LeadExportCellsRow[],
  options: { format: "csv" | "xlsx"; lang: string; prefix: string; nowIso: string },
): Promise<LeadExportFile> {
  const columns = leadExportColumns(options.lang);
  const cells = rows.map((row) => leadExportCells(row, options.lang));

  if (options.format === "csv") {
    return {
      fileName: leadExportFileName(options.prefix, options.nowIso, "csv"),
      mimeType: "text/csv;charset=utf-8",
      data: `\uFEFF${toCsv(columns, cells)}`,
    };
  }

  const bytes = await writeSpreadsheetInWorker(options.lang === "en" ? "Leads" : "Leady", [
    columns,
    ...cells,
  ]);
  return {
    fileName: leadExportFileName(options.prefix, options.nowIso, "xlsx"),
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    data: bytes,
  };
}

/**
 * Zrzuca plik na dysk operatora - jedyny fragment zależny od przeglądarki.
 * Wspólny `downloadBlob` zwalnia adres dopiero po chwili: zwolnienie zaraz po
 * `click()` bywa szybsze niż start pobierania (Safari, Chrome na Androidzie).
 */
export function downloadLeadExport(file: LeadExportFile): void {
  downloadBlob(new Blob([file.data], { type: file.mimeType }), file.fileName);
}
