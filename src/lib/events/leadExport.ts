// EKSPORT LEADÓW WYSTAWCY - kolumny i budowa pliku.
//
// KOLUMNA ZGODY IDZIE ZAWSZE. Sponsor dostaje też wiersze bez zgody (rozlicza
// się z liczby skanów przy stoisku), ale w takich wierszach kontakt jest pusty,
// a kolumna „zgoda" mówi wprost dlaczego. Ukrycie takiego wiersza dawałoby
// sponsorowi wrażenie, że skan się nie zapisał, i wywoływało ponowny skan.
//
// CSV Z BOM. Excel bez BOM czyta UTF-8 jako stronę kodową systemu i rozsypuje
// polskie znaki w nazwiskach - a to jest plik czytany poza systemem.
import { toCsv } from "@/lib/csv/formatCsv";
import type { LeadExportRow } from "@/lib/events/onsiteApi";

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

/** Jeden wiersz eksportu w kolejności kolumn. */
export function leadExportCells(
  row: LeadExportRow,
  lang: string,
): ReadonlyArray<string | number | null> {
  const yes = lang === "en" ? "yes" : "tak";
  const no = lang === "en" ? "no" : "nie";
  return [
    row.sponsor_name,
    row.first_name,
    row.last_name,
    row.company,
    row.job_title,
    row.email,
    row.phone,
    row.consent === true ? yes : no,
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

/** Buduje plik eksportu w żądanym formacie (XLSX ładowany leniwie). */
export async function buildLeadExport(
  rows: readonly LeadExportRow[],
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

  const XLSX = await import("xlsx");
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([[...columns], ...cells.map((row) => [...row])]),
    options.lang === "en" ? "Leads" : "Leady",
  );
  const bytes = XLSX.write(book, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  return {
    fileName: leadExportFileName(options.prefix, options.nowIso, "xlsx"),
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    data: bytes,
  };
}

/** Zrzuca plik na dysk operatora - jedyny fragment zależny od przeglądarki. */
export function downloadLeadExport(file: LeadExportFile): void {
  const blob = new Blob([file.data], { type: file.mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.fileName;
  link.click();
  URL.revokeObjectURL(url);
}
