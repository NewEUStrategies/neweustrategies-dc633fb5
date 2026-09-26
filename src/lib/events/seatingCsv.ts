// Eksport CSV planu sali: lista przy drzwiach, wszystkie miejsca, goscie firmy.
//
// TO SA DANE OSOBOWE, KTORE OPUSZCZAJA SYSTEM. Lista przy drzwiach trafia do
// hostess i firmy cateringowej, lista gosci firmy - do opiekuna klienta w CRM.
// Wynosimy to, czego potrzebuje obsluga sali (kto, gdzie, z jakim biletem, dla
// kogo zarezerwowane), bez identyfikatorow technicznych.
//
// CYTOWANIE Z `lib/crm/csv` - neutralizuje wiodace `=`, `+`, `-`, `@`, bo nazwa
// firmy i notatka rezerwacji sa wpisywane recznie, a w arkuszu organizatora
// "=HYPERLINK(...)" bylby wykonywalna formula.
//
// NAPIS MIEJSCA PODAJE WOLAJACY (przetlumaczony `seatLabelMessage`), zeby plik
// mowil tym samym zdaniem, co ekran - modul nie zna i18next.
import { csvDocument } from "@/lib/crm/csv";
import { csvFileNameFor } from "@/lib/csv/formatCsv";
import type { SeatExportRow } from "@/lib/events/seatingApi";

export const SEATING_CSV_COLUMNS = [
  "seat",
  "section",
  "row",
  "seat_number",
  "category",
  "seat_status",
  "accessible",
  "last_name",
  "first_name",
  "email",
  "company",
  "ticket",
  "registration_status",
  "held_for",
  "hold_note",
] as const;

/** `door` = tylko zajete miejsca, alfabetycznie po nazwisku; `seats` = kazde miejsce planu. */
export type SeatingCsvMode = "door" | "seats";

export interface SeatingCsvOptions {
  mode: SeatingCsvMode;
  lang: "pl" | "en";
  seatText: (row: SeatExportRow) => string;
}

function filled(value: string | null | undefined): string {
  return typeof value === "string" ? value : "";
}

function localized(pl: string | null, en: string | null, lang: "pl" | "en"): string {
  const first = lang === "en" ? en : pl;
  const second = lang === "en" ? pl : en;
  return filled(first) !== "" ? filled(first) : filled(second);
}

/** Wiersze do pliku w kolejnosci trybu. */
export function seatingCsvRows(
  rows: readonly SeatExportRow[],
  mode: SeatingCsvMode,
  lang: "pl" | "en",
): SeatExportRow[] {
  if (mode === "seats") return [...rows];
  const collator = new Intl.Collator(lang === "en" ? "en" : "pl", { sensitivity: "base" });
  return rows
    .filter((row) => filled(row.registration_id) !== "")
    .sort(
      (a, b) =>
        collator.compare(filled(a.last_name), filled(b.last_name)) ||
        collator.compare(filled(a.first_name), filled(b.first_name)),
    );
}

export function seatingExportToCsv(
  rows: readonly SeatExportRow[],
  options: SeatingCsvOptions,
): string {
  return csvDocument(
    SEATING_CSV_COLUMNS,
    seatingCsvRows(rows, options.mode, options.lang).map((row) => [
      options.seatText(row),
      row.section_label,
      filled(row.row_label),
      row.seat_number,
      localized(row.category_name_pl, row.category_name_en, options.lang),
      row.seat_status,
      row.is_accessible ? "yes" : "no",
      filled(row.last_name),
      filled(row.first_name),
      filled(row.email),
      filled(row.company),
      localized(row.ticket_name_pl, row.ticket_name_en, options.lang),
      filled(row.registration_status),
      filled(row.hold_company_name),
      filled(row.hold_note),
    ]),
  );
}

/** `plan-sali-<slug>-<plan>-<tryb>-<dzien>.csv`. */
export function seatingCsvFileName(
  eventSlug: string,
  mapName: string,
  mode: SeatingCsvMode | "company",
  nowIso: string,
): string {
  const slug = eventSlug.trim() === "" ? "event" : eventSlug.trim();
  const plan =
    mapName
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\u0142/g, "l")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "plan";
  return csvFileNameFor(`plan-sali-${slug}-${plan}-${mode}`, nowIso);
}
