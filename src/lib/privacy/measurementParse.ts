// Odpowiedzi RPC panelu pomiaru otwarć i kliknięć (I9d-Y2) -> DTO panelu.
//
// Kształty (`rpc-shape`) z migracji 20261020162400 i 20261020162500:
//   * `admin_newsletter_measurement_preview` - podgląd „Poproś o zgodę na
//     pomiar" (kandydaci, stan próśb bieżącej wersji, limit dzienny);
//   * `admin_newsletter_measurement_request` - wynik startu;
//   * `admin_newsletter_consent_measurement_get`/`_mark` - stan treści zgody
//     per pole i oznaczenie admina „mój tekst obejmuje pomiar";
//   * `admin_newsletter_campaign_measurement` - mianownik wskaźników kampanii.
//
// Zawężanie zamiast rzutowania: rozjazd kontraktu rzuca błąd (granica ekranu),
// a liczniki `bigint` z Postgresa (napis w JSON-ie) stają się liczbami.
// Moduł czysty - importują go funkcje serwerowe i testy.

export class MeasurementShapeError extends Error {
  constructor(path: string, reason: string) {
    super(`measurement rpc: ${path} - ${reason}`);
    this.name = "MeasurementShapeError";
  }
}

function record(raw: unknown, path: string): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new MeasurementShapeError(path, "oczekiwano obiektu");
  }
  return raw as Record<string, unknown>;
}

function count(row: Record<string, unknown>, key: string, path: string): number {
  const value = row[key];
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number.parseInt(value, 10)
        : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new MeasurementShapeError(`${path}.${key}`, "oczekiwano liczby >= 0");
  }
  return parsed;
}

function bool(row: Record<string, unknown>, key: string, path: string): boolean {
  const value = row[key];
  if (typeof value !== "boolean")
    throw new MeasurementShapeError(`${path}.${key}`, "oczekiwano bool");
  return value;
}

function text(row: Record<string, unknown>, key: string, path: string): string {
  const value = row[key];
  if (typeof value !== "string" || !value) {
    throw new MeasurementShapeError(`${path}.${key}`, "oczekiwano napisu");
  }
  return value;
}

function instantOrNull(row: Record<string, unknown>, key: string, path: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new MeasurementShapeError(`${path}.${key}`, "oczekiwano znacznika czasu");
  }
  return value;
}

// ── „Poproś o zgodę na pomiar" ──────────────────────────────────────────────

export interface NewsletterMeasurementPreviewDto {
  /** Wersja treści z pomiarem, o którą prosimy. */
  version: string;
  /** Wspólny przełącznik najemcy (ścieżki i kampanie) - wyłączony = prośba bez skutku do czasu włączenia. */
  enabled: boolean;
  /** Aktywni subskrybenci i ci z nich, którzy mają już zgodę na pomiar. */
  subscribers: number;
  withConsent: number;
  /** Kandydaci do prośby (bez zgody, bez prośby dla tej wersji, bez własnego „nie mierz"). */
  candidates: number;
  /** Kandydaci na liście wyłączeń - prośba ich nie obejmie. */
  suppressed: number;
  /** Stan próśb bieżącej wersji. */
  requested: number;
  pending: number;
  mailed: number;
  blocked: number;
  skipped: number;
  failed: number;
  confirmed: number;
  /** Dzienny limit jednorazowych maili najemcy (wspólny z prośbami wygaszania). */
  dailyCap: number;
  lastRequestedAt: string | null;
}

export function parseNewsletterMeasurementPreview(raw: unknown): NewsletterMeasurementPreviewDto {
  const row = record(raw, "$");
  return {
    version: text(row, "version", "$"),
    enabled: bool(row, "enabled", "$"),
    subscribers: count(row, "subscribers", "$"),
    withConsent: count(row, "with_consent", "$"),
    candidates: count(row, "candidates", "$"),
    suppressed: count(row, "suppressed", "$"),
    requested: count(row, "requested", "$"),
    pending: count(row, "pending", "$"),
    mailed: count(row, "mailed", "$"),
    blocked: count(row, "blocked", "$"),
    skipped: count(row, "skipped", "$"),
    failed: count(row, "failed", "$"),
    confirmed: count(row, "confirmed", "$"),
    dailyCap: count(row, "daily_cap", "$"),
    lastRequestedAt: instantOrNull(row, "last_requested_at", "$"),
  };
}

export interface NewsletterMeasurementRequestDto {
  /** Liczba założonych próśb (0 = nikt nowy - powtórny start nie dubluje). */
  requested: number;
  version: string;
}

export function parseNewsletterMeasurementRequest(raw: unknown): NewsletterMeasurementRequestDto {
  const row = record(raw, "$");
  return { requested: count(row, "requested", "$"), version: text(row, "version", "$") };
}

// ── Treść zgody: „mój tekst obejmuje pomiar" ────────────────────────────────

/** Pola z edytowalną treścią zgody newslettera (lustro CHECK tabeli oznaczeń). */
export const CONSENT_MEASUREMENT_FIELDS = [
  "policy_html_pl",
  "policy_html_en",
  "popup_privacy_html_pl",
  "popup_privacy_html_en",
] as const;
export type ConsentMeasurementField = (typeof CONSENT_MEASUREMENT_FIELDS)[number];

export interface ConsentMeasurementFieldDto {
  field: ConsentMeasurementField;
  lang: "pl" | "en";
  /** Pole ma zapisany tekst (puste = formularz pokazuje treść domyślną z TS). */
  textPresent: boolean;
  /** Zapisany tekst to bieżąca treść domyślna (z pomiarem). */
  isDefault: boolean;
  /** Oznaczenie admina pasuje do zapisanego tekstu. */
  marked: boolean;
  /** Tekst zmieniono po oznaczeniu - oznaczenie nie działa. */
  stale: boolean;
  /** Treść obejmuje pomiar (domyślna albo oznaczona); `null` = pole puste. */
  covers: boolean | null;
  markedAt: string | null;
}

export interface ConsentMeasurementDto {
  version: string;
  fields: ConsentMeasurementFieldDto[];
}

export function parseConsentMeasurement(raw: unknown): ConsentMeasurementDto {
  const row = record(raw, "$");
  const fields = row.fields;
  if (!Array.isArray(fields)) throw new MeasurementShapeError("$.fields", "oczekiwano tablicy");
  return {
    version: text(row, "version", "$"),
    fields: fields.map((entry, index) => {
      const path = `$.fields[${index}]`;
      const item = record(entry, path);
      const field = item.field;
      if (!(CONSENT_MEASUREMENT_FIELDS as readonly unknown[]).includes(field)) {
        throw new MeasurementShapeError(`${path}.field`, "nieznane pole");
      }
      const lang = item.lang;
      if (lang !== "pl" && lang !== "en") {
        throw new MeasurementShapeError(`${path}.lang`, "oczekiwano pl|en");
      }
      const covers = item.covers;
      if (covers !== null && covers !== undefined && typeof covers !== "boolean") {
        throw new MeasurementShapeError(`${path}.covers`, "oczekiwano bool albo null");
      }
      return {
        field: field as ConsentMeasurementField,
        lang,
        textPresent: bool(item, "text_present", path),
        isDefault: bool(item, "is_default", path),
        marked: bool(item, "marked", path),
        stale: bool(item, "stale", path),
        covers: typeof covers === "boolean" ? covers : null,
        markedAt: instantOrNull(item, "marked_at", path),
      };
    }),
  };
}

/**
 * Ostrzeżenie panelu: pole z WŁASNYM tekstem, który nie obejmuje pomiaru
 * (nie jest bieżącą treścią domyślną i nie ma ważnego oznaczenia admina).
 * Puste pole nie ostrzega - formularz pokazuje wtedy treść domyślną z TS.
 * Zapis z takiego formularza nie daje zgody na pomiar - osoba dostaje
 * newsletter bez piksela i linków z identyfikatorem.
 */
export function consentFieldNeedsWarning(field: ConsentMeasurementFieldDto): boolean {
  return field.textPresent && field.covers === false;
}

// ── Mianownik wskaźników kampanii ───────────────────────────────────────────

export interface CampaignMeasurementDto {
  campaignId: string;
  /** Odbiorcy ze statusem `sent`. */
  sent: number;
  /** Mail z pikselem i linkami z tokenem (zgoda na pomiar i przełącznik w chwili wysyłki). */
  measured: number;
  unmeasured: number;
  /** Wysyłka sprzed I9d-Y2 (stan nieznany). */
  unknown: number;
}

export function parseCampaignMeasurement(raw: unknown): CampaignMeasurementDto {
  const row = record(raw, "$");
  return {
    campaignId: text(row, "campaign_id", "$"),
    sent: count(row, "sent", "$"),
    measured: count(row, "measured", "$"),
    unmeasured: count(row, "unmeasured", "$"),
    unknown: count(row, "unknown", "$"),
  };
}

/**
 * Mianownik wskaźnika otwarć/kliknięć kampanii: odbiorcy MIERZENI, gdy
 * kampania ma choć jednego odbiorcę ze znanym stanem pomiaru (wysyłka po
 * I9d-Y2); kampania w całości sprzed Y2 (stan nieznany) - wszyscy wysłani,
 * jak dotąd. Kampania wznowiona w chwili wdrożenia (część nieznana) liczy
 * tylko mierzonych - niedoszacowanie mianownika jest bezpieczniejsze niż
 * wskaźnik ponad 100%.
 */
export function campaignMeasuredDenominator(dto: CampaignMeasurementDto): number {
  return dto.measured + dto.unmeasured > 0 ? dto.measured : dto.sent;
}
