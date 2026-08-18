// Mapowanie kolumn pliku CSV na pola leada CRM.
//
// DLACZEGO OSOBNY MODUŁ. To jest reguła obchodzenia się z DANYMI OSOBOWYMI:
// decyduje, czy kolumna „Adres" wyląduje w polu e-mail, czy kolumna „Zgoda"
// w czymkolwiek. Dopóki żyła wewnątrz dialogu (`ImportLeadsCsvDialog.tsx`),
// jedynym sposobem jej sprawdzenia było wyrenderowanie okna i podanie pliku -
// więc nie była sprawdzana wcale (0 z 29 funkcji pliku miało pokrycie).
//
// TRZY REGUŁY, KTÓRE TU OBOWIĄZUJĄ:
//
//   1. KOLUMNA NIEROZPOZNANA ZOSTAJE NIEZMAPOWANA. Nigdy nie zgadujemy - lepiej
//      zaimportować mniej pól niż wpisać cudzą treść w pole kontaktowe.
//   2. ZGODY NIE DA SIĘ ZAIMPORTOWAĆ. Kolumny wyglądające na zgodę marketingową
//      (zgoda / consent / marketing / RODO / opt-in / newsletter) są odrzucane
//      PRZED wszystkimi innymi regułami. Zgoda wymaga dowodu (crm_consent_log),
//      a RPC importu (`crm_import_leads`, migracja 20260721120000) nie przyjmuje
//      takiego pola - plik CSV nie może wyprodukować zgody.
//   3. PIERWSZA KOLUMNA WYGRYWA. Gdy dwie kolumny pasują do tego samego pola,
//      druga zostaje niezmapowana; inaczej ta sama informacja nadpisywałaby się
//      zależnie od kolejności kolumn w pliku.
//
// Parsowanie samego CSV nie jest sprawą tego modułu - robi je `lib/csv/parseCsv`.
import type { CrmImportRow } from "@/lib/crm-tasks.functions";

/** Pola leada, które import potrafi wypełnić (zgodne z `crm_import_leads`). */
export const LEAD_IMPORT_FIELDS = [
  "email",
  "first_name",
  "last_name",
  "phone",
  "company",
  "position",
  "country",
  "linkedin_url",
  "tags",
] as const;

export type LeadImportField = (typeof LEAD_IMPORT_FIELDS)[number];

/** `""` = kolumna świadomie pominięta przy imporcie. */
export type LeadImportFieldChoice = LeadImportField | "";

/** Kolejność wyboru w interfejsie: pola, a na końcu „pomiń". */
export const LEAD_IMPORT_FIELD_CHOICES: readonly LeadImportFieldChoice[] = [
  ...LEAD_IMPORT_FIELDS,
  "",
];

/** Mapowanie pozycyjne: i-ta kolumna pliku -> pole leada (albo pominięta). */
export type LeadImportMapping = LeadImportFieldChoice[];

/** Twardy sufit wierszy na jeden import (klient stronicuje większe pliki). */
export const IMPORT_MAX_ROWS = 5000;
/** Maksymalna liczba tagów z jednej komórki. */
export const IMPORT_MAX_TAGS = 20;
/** Sufit długości wartości - RPC i tak przycina, ale nie wysyłamy śmieci. */
export const IMPORT_VALUE_MAX_LENGTH = 300;

/**
 * Nagłówki, które NIGDY nie mogą zostać zmapowane. Reguła stoi przed wszystkimi
 * innymi, więc „E-mail marketing" albo „Zgoda newsletter" nie przemyci się do
 * pola kontaktowego tylko dlatego, że zawiera słowo „mail".
 */
const NEVER_MAPPED = /(zgod|consent|marketing|rodo|gdpr|opt[-_\s]?in|newsletter|subskryp)/;

interface HeaderRule {
  readonly field: LeadImportField;
  readonly pattern: RegExp;
}

/**
 * Reguły rozpoznawania nagłówka - PIERWSZE dopasowanie wygrywa, więc kolejność
 * jest częścią kontraktu (np. „Nazwa firmy" ma trafić w firmę, nie w nazwisko).
 */
const HEADER_RULES: readonly HeaderRule[] = [
  // E-mail: „e-mail", „email", „mail", „adres e-mail". SAMO „adres" NIE JEST
  // e-mailem - wcześniejsza reguła (`/^(e-?mail|mail|adres)/`) wpisywała ulicę
  // z kolumny „Adres" w pole e-mail.
  { field: "email", pattern: /(e[-_\s]?mail|(^|\s)mail(\s|$))/ },
  // Kolumna z PEŁNĄ nazwą („Imię i nazwisko", „Full name") ląduje w imieniu
  // w całości - import nie ma jak podzielić nazwiska za człowieka, a zgadywanie
  // podziału psułoby dane osobowe. Reguła stoi przed regułami części nazwy, bo
  // taki nagłówek pasuje do obu.
  {
    field: "first_name",
    pattern:
      /(imi[eę]\s*i\s*nazwisk|nazwisk\w*\s*i\s*imi|full[\s_-]?name|name\s*(and|&)\s*surname)/,
  },
  { field: "last_name", pattern: /(nazwisk|last[\s_-]?name|surname|family[\s_-]?name)/ },
  { field: "first_name", pattern: /(imi|first[\s_-]?name|given[\s_-]?name)/ },
  { field: "phone", pattern: /(phone|telefon|(^|\s)tel(\s|\.|$)|komórk|komork|mobile)/ },
  { field: "company", pattern: /(company|firm|organi|instytucj|pracodawc)/ },
  {
    field: "position",
    pattern: /(position|stanowisk|job[\s_-]?title|(^|\s)title|rola|role|funkcj)/,
  },
  { field: "country", pattern: /(country|kraj|panstw|państw)/ },
  { field: "linkedin_url", pattern: /linked/ },
  { field: "tags", pattern: /(tagi|tags?(\s|$)|etykiet|label)/ },
];

/** Nagłówek po normalizacji: bez BOM, bez skrajnych spacji, małymi literami. */
export function normalizeHeader(raw: string): string {
  return raw
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** Pole dla pojedynczego nagłówka - bez pamięci o innych kolumnach. */
export function fieldForHeader(raw: string): LeadImportFieldChoice {
  const header = normalizeHeader(raw);
  if (!header) return "";
  if (NEVER_MAPPED.test(header)) return "";
  return HEADER_RULES.find((rule) => rule.pattern.test(header))?.field ?? "";
}

/**
 * Automatyczne mapowanie całego nagłówka pliku. Pole może zostać przypisane
 * TYLKO RAZ - druga kolumna pasująca do zajętego pola zostaje niezmapowana.
 */
export function autoMapHeaders(header: readonly string[]): LeadImportMapping {
  const taken = new Set<LeadImportField>();
  return header.map((raw) => {
    const field = fieldForHeader(raw);
    if (!field) return "";
    if (taken.has(field)) return "";
    taken.add(field);
    return field;
  });
}

/** Podział komórki z tagami: separatory `|`, `;`, `,`; puste odpadają. */
export function splitTags(value: string): string[] {
  return value
    .split(/[|;,]/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .slice(0, IMPORT_MAX_TAGS);
}

/** E-mail „wygląda jak e-mail" - twardą walidację robi baza. */
export function looksLikeEmail(value: string): boolean {
  return /.+@.+\..+/.test(value);
}

export interface MappedImportRows {
  /** Wiersze gotowe do wysłania do `crm_import_leads`. */
  rows: CrmImportRow[];
  /** Ile wierszy odpadło jako powtórzony e-mail W TYM SAMYM pliku. */
  inFileDuplicates: number;
  /** Ile wierszy odpadło z braku poprawnego e-maila. */
  skippedWithoutEmail: number;
  /** Ile wierszy nie zmieściło się w limicie `IMPORT_MAX_ROWS`. */
  droppedOverLimit: number;
}

/**
 * Wiersze pliku + mapowanie -> wiersze importu.
 *
 * Bez kolumny e-mail nie ma czego importować (dedup w bazie idzie po
 * `email_norm`), więc wynik jest wtedy pusty - a nie „zgadnięty".
 */
export function mapImportRows(
  rows: readonly (readonly string[])[],
  mapping: LeadImportMapping,
): MappedImportRows {
  const emailIndex = mapping.indexOf("email");
  const empty: MappedImportRows = {
    rows: [],
    inFileDuplicates: 0,
    skippedWithoutEmail: 0,
    droppedOverLimit: 0,
  };
  if (emailIndex < 0) return { ...empty, skippedWithoutEmail: rows.length };

  const seen = new Set<string>();
  const out: CrmImportRow[] = [];
  let inFileDuplicates = 0;
  let skippedWithoutEmail = 0;
  let droppedOverLimit = 0;

  for (const raw of rows) {
    const email = (raw[emailIndex] ?? "").trim();
    if (!looksLikeEmail(email)) {
      skippedWithoutEmail += 1;
      continue;
    }
    const normalized = email.toLowerCase();
    if (seen.has(normalized)) {
      inFileDuplicates += 1;
      continue;
    }
    if (out.length >= IMPORT_MAX_ROWS) {
      droppedOverLimit += 1;
      continue;
    }
    seen.add(normalized);

    const row: CrmImportRow = { email };
    mapping.forEach((field, index) => {
      if (!field || field === "email") return;
      // Wiersz krótszy od nagłówka = brakujące komórki puste; wiersz dłuższy =
      // nadmiarowe kolumny bez mapowania, więc po prostu ich tu nie ma.
      const value = (raw[index] ?? "").trim();
      if (!value) return;
      if (field === "tags") {
        const tags = splitTags(value);
        if (tags.length > 0) row.tags = tags;
        return;
      }
      row[field] = value.slice(0, IMPORT_VALUE_MAX_LENGTH);
    });
    out.push(row);
  }

  return { rows: out, inFileDuplicates, skippedWithoutEmail, droppedOverLimit };
}
