// RETENCJA DANYCH (I9c-X2, Z-I9b-10) - JEDNO źródło okresów, zakresów
// i reguł po stronie TS. Lustro SQL: `_data_retention_catalog()`, CHECK
// `data_retention_settings_period_check` i stałe funkcji wykonawczych
// (migracje 2026102016100…161300). Parytet przypina
// `src/lib/privacy/__tests__/dataRetentionParity.test.ts` - rozjazd jednej
// strony (np. panel pozwala wybrać 30 miesięcy, a CHECK bazy kończy się na 25)
// dawałby albo odrzucony zapis bez wyjaśnienia, albo okres, którego panel nie
// umie pokazać.
//
// SKĄD LICZBY. Wartości domyślne i zakresy to decyzja administratora danych
// z 2026-10-20 (polecenie właściciela: „zgodnie z polskim i europejskim prawem
// oraz rynkowymi standardami") - tabela kategorii w dzienniku wdrożenia
// (§21.21). Podstawy prawne i standardy rynkowe w panelu pokazują dymki
// (słownik `i18n-admin-data-retention.ts`), a nie ten moduł: tu są tylko
// liczby, które muszą się zgadzać z bazą.
//
// MODUŁ CZYSTY: bez I/O, bez Reacta - czyta go panel, serwer i testy.

/** Kategorie z okresem edytowalnym w panelu (zakres w miesiącach). */
export const DATA_RETENTION_EDITABLE_CATEGORIES = [
  "paywall_metering",
  "email_engagement",
  "email_send_log",
  "crm_inactive_contacts",
  "audit_log",
  "journey_enrollments",
  "cancellation_surveys",
] as const;
export type DataRetentionEditableCategory = (typeof DATA_RETENTION_EDITABLE_CATEGORIES)[number];

/**
 * Kategorie wykonywane przez zadanie, ale z regułą ustawową albo stałą -
 * okresu nie da się zmienić ani kategorii wyłączyć (minimum ustawowe).
 */
export const DATA_RETENTION_STATUTORY_CATEGORIES = ["crm_customers", "consent_log"] as const;
export type DataRetentionStatutoryCategory = (typeof DATA_RETENTION_STATUTORY_CATEGORIES)[number];

/** Wszystko, co zapisuje wiersz w dzienniku przebiegów (`data_retention_runs`). */
export const DATA_RETENTION_RUN_CATEGORIES = [
  ...DATA_RETENTION_EDITABLE_CATEGORIES,
  ...DATA_RETENTION_STATUTORY_CATEGORIES,
] as const;
export type DataRetentionRunCategory = (typeof DATA_RETENTION_RUN_CATEGORIES)[number];

export interface DataRetentionPeriodRule {
  /** Okres domyślny (miesiące). */
  readonly defaultMonths: number;
  /** Najkrótszy okres, jaki panel pozwala ustawić. */
  readonly minMonths: number;
  /** Najdłuższy okres, jaki panel pozwala ustawić. */
  readonly maxMonths: number;
}

/**
 * Okresy kategorii edytowalnych. Wartość spoza zakresu jest ODRZUCANA
 * (walidator serwera, RPC `22023`, CHECK tabeli `23514`), nigdy przycinana.
 */
export const DATA_RETENTION_PERIODS: Readonly<
  Record<DataRetentionEditableCategory, DataRetentionPeriodRule>
> = {
  paywall_metering: { defaultMonths: 13, minMonths: 3, maxMonths: 25 },
  email_engagement: { defaultMonths: 13, minMonths: 3, maxMonths: 25 },
  email_send_log: { defaultMonths: 13, minMonths: 6, maxMonths: 25 },
  crm_inactive_contacts: { defaultMonths: 24, minMonths: 12, maxMonths: 36 },
  audit_log: { defaultMonths: 24, minMonths: 12, maxMonths: 60 },
  journey_enrollments: { defaultMonths: 13, minMonths: 6, maxMonths: 25 },
  cancellation_surveys: { defaultMonths: 24, minMonths: 12, maxMonths: 36 },
};

/**
 * Reguły stałe (nie do zmiany w panelu):
 *   * `auditNetworkMonths` - IP i przeglądarka w dzienniku audytu znikają po
 *     tylu miesiącach, nawet gdy wpis zostaje dłużej;
 *   * `consentProofYears` - łańcuch zgód kontaktu znika tyle lat po
 *     wycofaniu albo wygaśnięciu zgody (wykazanie zgody i przedawnienie);
 *   * `claimsLimitationYears` - przedawnienie roszczeń liczone z końcem roku
 *     kalendarzowego ostatniej transakcji (klient CRM); późniejsza z tej daty
 *     i reguły dowodów księgowych (`accounting_retention_until`);
 *   * `graceDays` - po wdrożeniu (i dla nowego najemcy) zadanie tyle dni
 *     tylko liczy (tryb podglądu);
 *   * `postponeMaxDays` - najdalszy termin, na jaki admin przesuwa włączenie
 *     usuwania (liczony od dziś);
 *   * `crmExtensionMonths` / `crmNoticeDays` - przedłużenie kontaktu CRM
 *     z listy „do anonimizacji" i wyprzedzenie, z jakim kontakt na nią trafia;
 *   * `crmExtensionReason*` - długość powodu przedłużenia (po obcięciu
 *     białych znaków z brzegów; dłuższy jest odrzucany, nie skracany).
 */
export const DATA_RETENTION_RULES = {
  auditNetworkMonths: 12,
  consentProofYears: 6,
  claimsLimitationYears: 6,
  graceDays: 14,
  postponeMaxDays: 90,
  crmExtensionMonths: 12,
  crmNoticeDays: 30,
  crmExtensionReasonMin: 3,
  crmExtensionReasonMax: 500,
  /** Wierszy na kategorię na przebieg (domyślnie / najwięcej). */
  batchDefault: 5000,
  batchMax: 50000,
} as const;

/**
 * Dziennik audytu: wpisy operacji finansowych (zwroty, ręczne płatności,
 * ceny, nadania członkostwa, rabaty, faktury) żyją tak długo jak dowody
 * księgowe (`accounting_retention_until`), a nie okres kategorii. Prefiksy
 * akcji i typy encji - lustro `_data_retention_audit_is_financial` (SQL).
 */
export const AUDIT_FINANCIAL_ACTION_PREFIXES = [
  "membership.",
  "billing.",
  "payment.",
  "refund",
  "price",
  "pricing.",
  "coupon",
  "discount",
  "event.invoice.",
  "order.",
] as const;
export const AUDIT_FINANCIAL_ENTITY_TYPES = [
  "membership_grant",
  "payment_order",
  "billing_document",
  "access_plan",
  "b2b_coupon",
  "b2b_coupon_campaign",
  "event_invoice",
  "subscription",
] as const;

/** Czy wpis audytu jest operacją finansową (lustro SQL). */
export function isFinancialAuditEntry(action: string, entityType: string): boolean {
  const a = action.toLowerCase();
  return (
    AUDIT_FINANCIAL_ACTION_PREFIXES.some((prefix) => a.startsWith(prefix)) ||
    (AUDIT_FINANCIAL_ENTITY_TYPES as readonly string[]).includes(entityType.toLowerCase())
  );
}

/** Znacznik zredagowanego adresu (ten sam co przy usunięciu konta, I9c-X1). */
export const DATA_RETENTION_REDACTED = "[redacted]";
/** Domena zastępcza adresu zanonimizowanego kontaktu CRM (RFC 2606 - nie istnieje). */
export const DATA_RETENTION_ANON_EMAIL_DOMAIN = "anonymized.invalid";

export function isEditableCategory(value: string): value is DataRetentionEditableCategory {
  return (DATA_RETENTION_EDITABLE_CATEGORIES as readonly string[]).includes(value);
}

/** Okres w zakresie kategorii (liczba całkowita) - ten sam predykat co CHECK bazy. */
export function isRetentionPeriodAllowed(
  category: DataRetentionEditableCategory,
  months: number,
): boolean {
  const rule = DATA_RETENTION_PERIODS[category];
  return Number.isInteger(months) && months >= rule.minMonths && months <= rule.maxMonths;
}

/** Wszystkie dozwolone okresy kategorii - opcje wspólnego atomu listy. */
export function retentionPeriodOptions(category: DataRetentionEditableCategory): number[] {
  const rule = DATA_RETENTION_PERIODS[category];
  const out: number[] = [];
  for (let m = rule.minMonths; m <= rule.maxMonths; m += 1) out.push(m);
  return out;
}

/** Powód przedłużenia po obcięciu brzegów albo `null`, gdy długość spoza zakresu. */
export function normalizeExtensionReason(raw: string): string | null {
  const reason = raw.trim();
  const { crmExtensionReasonMin: min, crmExtensionReasonMax: max } = DATA_RETENTION_RULES;
  // Znaki jak `char_length` w SQL (punkty kodowe), nie jednostki UTF-16 -
  // emoji liczone podwójnie dawałyby inny limit w panelu niż w CHECK bazy.
  const length = [...reason].length;
  return length >= min && length <= max ? reason : null;
}

/**
 * Okresy, które ISTNIEJĄ już w repozytorium (inne mechanizmy) albo są
 * bezterminowe z mocy prawa - karta pokazuje je tylko do odczytu, żeby nie
 * dublować okresu w dwóch miejscach. Liczby są przepisane z migracji
 * wskazanej w `source`; `dataRetentionParity.test.ts` sprawdza, że literał
 * okresu (`periodLiteral`) nadal stoi w tej migracji - zmiana okresu w SQL bez
 * zmiany tutaj zaczerwieni test.
 *   * `schedule`: `pg_cron` - zadanie bazy; `pending` - funkcja istnieje,
 *     harmonogram podpina I9 (runner ścieżek w `jobs-tick`); `none` - brak
 *     usuwania z założenia.
 */
export interface DataRetentionExistingItem {
  readonly key: string;
  readonly mechanism: string | null;
  readonly source: string | null;
  readonly periodLiteral: string | null;
  readonly schedule: "pg_cron" | "pending" | "none";
}

export const DATA_RETENTION_EXISTING: readonly DataRetentionExistingItem[] = [
  {
    key: "suppression_list",
    mechanism: null,
    source: null,
    periodLiteral: null,
    schedule: "none",
  },
  {
    key: "domain_events",
    mechanism: "prune_domain_events",
    source: "20260711220607",
    periodLiteral: "interval '90 days'",
    schedule: "pg_cron",
  },
  {
    key: "analytics_events",
    mechanism: "telemetry_retention_prune",
    source: "20261003190000",
    periodLiteral: "interval '12 months'",
    schedule: "pg_cron",
  },
  {
    key: "web_vitals",
    mechanism: "telemetry_retention_prune",
    source: "20261003190000",
    periodLiteral: "interval '200 days'",
    schedule: "pg_cron",
  },
  {
    key: "client_errors",
    mechanism: "telemetry_retention_prune",
    source: "20261003190000",
    periodLiteral: "interval '90 days'",
    schedule: "pg_cron",
  },
  {
    key: "journey_inbox",
    mechanism: "journey_purge",
    source: "20261020140100",
    periodLiteral: "interval '30 days'",
    schedule: "pending",
  },
  {
    key: "integration_deliveries",
    mechanism: "prune_integration_deliveries",
    source: "20260711220935",
    periodLiteral: "interval '14 days'",
    schedule: "pg_cron",
  },
  {
    key: "email_dlq",
    mechanism: "email_dlq_prune",
    source: "20261012182200",
    periodLiteral: "interval '30 days'",
    schedule: "pg_cron",
  },
  {
    key: "sms_send_log",
    mechanism: "sms_send_log_prune",
    source: "20261012131000",
    periodLiteral: "interval '30 days'",
    schedule: "pg_cron",
  },
  {
    key: "payment_webhook_events",
    mechanism: "payment_webhook_events_redact_expired",
    source: "20261013090100",
    periodLiteral: "interval '30 days'",
    schedule: "pg_cron",
  },
  {
    key: "accounting_evidence",
    mechanism: "purge_expired_payment_orders",
    source: "20261012121000",
    periodLiteral: "::int + 6, 12, 31",
    schedule: "pg_cron",
  },
] as const;
