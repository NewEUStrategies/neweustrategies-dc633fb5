// JSONB RPC karty „Retencja danych" -> DTO panelu, pole po polu (I9c-X2).
//
// PARSER RZUCA, A NIE ZERUJE (jak `journeys/parse.ts`): `0` rekordów do
// usunięcia to WYNIK, a `null` - „kategoria wyłączona, nic nie liczono". Zły
// kształt to rozjazd kontraktu SQL <-> TS (migracja 20261020161400), więc
// ma być głośny, a nie zamieniony na pustą kartę.
//
// WYJĄTEK: NIEZNANA KATEGORIA (I9d-Y1). Klucz spoza stałej TS w odczycie karty
// i podglądzie to nie zły kształt, tylko baza NOWSZA niż front (migracja
// katalogu wdrożona przed frontem - pułapka 5 pakietu I9d-1: karta całego
// najemcy pokazywała wtedy „nie udało się wczytać"). Taki wiersz jest
// POMIJANY (front nie ma dla niego słownika ani reguł), reszta kategorii
// parsuje się ściśle. W drugą stronę (front nowszy niż baza) kategorii po
// prostu brakuje w odpowiedzi, a wynik przebiegu iteruje stałą TS.
//
// Moduł czysty (bez Reacta i I/O): czyta go funkcja serwerowa i testy.
import { DATA_RETENTION_RUN_CATEGORIES, type DataRetentionRunCategory } from "./dataRetention";

export type DataRetentionMode = "preview" | "execute";
export type DataRetentionTrigger = "schedule" | "manual";

export interface DataRetentionRunDto {
  mode: DataRetentionMode;
  trigger: DataRetentionTrigger;
  affected: number;
  backlog: boolean;
  errorCode: string | null;
  cutoff: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface DataRetentionCategoryDto {
  key: DataRetentionRunCategory;
  editable: boolean;
  /** `null` dla kategorii ustawowej (reguła stała, bez okresu). */
  periodMonths: number | null;
  defaultMonths: number | null;
  minMonths: number | null;
  maxMonths: number | null;
  enabled: boolean;
  /** Od tej chwili zadanie usuwa (wcześniej - tylko liczy). */
  enforceAfter: string;
  enforced: boolean;
  cutoff: string | null;
  /** Token zapisu (CAS); `null` = brak wiersza (wartości domyślne). */
  updatedAt: string | null;
  stored: boolean;
  lastRun: DataRetentionRunDto | null;
}

export interface DataRetentionStateDto {
  categories: DataRetentionCategoryDto[];
  grace: {
    enforceAfter: string | null;
    enforceAfterMax: string | null;
    enforced: boolean;
    anyPreview: boolean;
  };
  /** Dni lejka < tej daty czytane z agregatu dziennego. */
  funnelCut: string | null;
  /** Statystyki ścieżek zapieczętowane do tego dnia (włącznie). */
  journeySealed: string | null;
  openTrackingEnabled: boolean;
  journeySettingsUpdatedAt: string | null;
  lastScheduledRunAt: string | null;
}

export interface DataRetentionPreviewItem {
  key: DataRetentionRunCategory;
  enabled: boolean;
  mode: DataRetentionMode;
  cutoff: string | null;
  /** `null` = kategoria wyłączona (nie liczono). */
  count: number | null;
  capped: boolean;
}

export interface DataRetentionPreviewDto {
  cap: number;
  categories: DataRetentionPreviewItem[];
}

export interface DataRetentionCrmDueItem {
  leadId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  lastActivity: string;
  dueAt: string;
  customer: boolean;
}

export interface DataRetentionCrmDueDto {
  noticeDays: number;
  enabled: boolean;
  enforced: boolean;
  items: DataRetentionCrmDueItem[];
}

export interface DataRetentionRunResultDto {
  busy: boolean;
  categories: {
    key: DataRetentionRunCategory;
    mode: DataRetentionMode | null;
    affected: number | null;
    error: string | null;
  }[];
}

export class DataRetentionShapeError extends Error {
  readonly path: string;

  constructor(path: string, reason: string) {
    super(`data retention: ${path} - ${reason}`);
    this.name = "DataRetentionShapeError";
    this.path = path;
  }
}

type Bag = Readonly<Record<string, unknown>>;

function fail(path: string, reason: string): never {
  throw new DataRetentionShapeError(path, reason);
}

function bag(value: unknown, path: string): Bag {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    fail(path, "oczekiwano obiektu");
  return value as Bag;
}

function list(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, "oczekiwano tablicy");
  return value;
}

function has(source: Bag, path: string, key: string): unknown {
  if (!Object.hasOwn(source, key)) fail(`${path}${key}`, "brak pola");
  return source[key];
}

function bool(source: Bag, path: string, key: string): boolean {
  const value = has(source, path, key);
  if (typeof value !== "boolean") fail(`${path}${key}`, "oczekiwano boolean");
  return value;
}

function count(source: Bag, path: string, key: string): number {
  const value = has(source, path, key);
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    fail(`${path}${key}`, "oczekiwano liczby całkowitej >= 0");
  }
  return value;
}

function nullableCount(source: Bag, path: string, key: string): number | null {
  return has(source, path, key) === null ? null : count(source, path, key);
}

function text(source: Bag, path: string, key: string): string {
  const value = has(source, path, key);
  if (typeof value !== "string") fail(`${path}${key}`, "oczekiwano napisu");
  return value;
}

function nullableText(source: Bag, path: string, key: string): string | null {
  const value = has(source, path, key);
  if (value === null) return null;
  if (typeof value !== "string") fail(`${path}${key}`, "oczekiwano napisu albo null");
  return value;
}

function instant(source: Bag, path: string, key: string): string {
  const value = text(source, path, key);
  if (!Number.isFinite(Date.parse(value))) fail(`${path}${key}`, "oczekiwano znacznika czasu");
  return value;
}

function nullableInstant(source: Bag, path: string, key: string): string | null {
  return has(source, path, key) === null ? null : instant(source, path, key);
}

function isKnownCategory(value: unknown): value is DataRetentionRunCategory {
  return (
    typeof value === "string" && (DATA_RETENTION_RUN_CATEGORIES as readonly string[]).includes(value)
  );
}

/**
 * Klucz kategorii: napis wymagany (inaczej rozjazd kontraktu), a nieznany
 * napis = `null` - wiersz kategorii nowszej niż front jest pomijany.
 */
function category(source: Bag, path: string, key: string): DataRetentionRunCategory | null {
  const value = has(source, path, key);
  if (typeof value !== "string" || value === "") fail(`${path}${key}`, "oczekiwano klucza kategorii");
  return isKnownCategory(value) ? value : null;
}

function mode(source: Bag, path: string, key: string): DataRetentionMode {
  const value = has(source, path, key);
  if (value !== "preview" && value !== "execute")
    fail(`${path}${key}`, "oczekiwano preview|execute");
  return value;
}

function parseRun(raw: unknown, path: string): DataRetentionRunDto | null {
  if (raw === null) return null;
  const r = bag(raw, path);
  const trigger = has(r, path, "run_trigger");
  if (trigger !== "schedule" && trigger !== "manual")
    fail(`${path}run_trigger`, "oczekiwano schedule|manual");
  return {
    mode: mode(r, path, "mode"),
    trigger,
    affected: count(r, path, "affected"),
    backlog: bool(r, path, "backlog"),
    errorCode: nullableText(r, path, "error_code"),
    cutoff: nullableInstant(r, path, "cutoff"),
    startedAt: instant(r, path, "started_at"),
    finishedAt: nullableInstant(r, path, "finished_at"),
  };
}

// rpc-shape: admin_data_retention_get
export function parseDataRetentionState(raw: unknown): DataRetentionStateDto {
  const s = bag(raw, "$");
  const g = bag(has(s, "", "grace"), "grace.");
  return {
    categories: list(has(s, "", "categories"), "categories").flatMap((entry, i) => {
      const p = `categories[${i}].`;
      const c = bag(entry, p);
      const key = category(c, p, "key");
      if (key === null) return [];
      return {
        key,
        editable: bool(c, p, "editable"),
        periodMonths: nullableCount(c, p, "period_months"),
        defaultMonths: nullableCount(c, p, "default_months"),
        minMonths: nullableCount(c, p, "min_months"),
        maxMonths: nullableCount(c, p, "max_months"),
        enabled: bool(c, p, "enabled"),
        enforceAfter: instant(c, p, "enforce_after"),
        enforced: bool(c, p, "enforced"),
        cutoff: nullableInstant(c, p, "cutoff"),
        updatedAt: nullableInstant(c, p, "updated_at"),
        stored: bool(c, p, "stored"),
        lastRun: parseRun(has(c, p, "last_run"), `${p}last_run.`),
      };
    }),
    grace: {
      enforceAfter: nullableInstant(g, "grace.", "enforce_after"),
      enforceAfterMax: nullableInstant(g, "grace.", "enforce_after_max"),
      enforced: g.enforced === null ? true : bool(g, "grace.", "enforced"),
      anyPreview: g.any_preview === null ? false : bool(g, "grace.", "any_preview"),
    },
    funnelCut: nullableText(s, "", "funnel_cut"),
    journeySealed: nullableText(s, "", "journey_sealed"),
    openTrackingEnabled: bool(s, "", "open_tracking_enabled"),
    journeySettingsUpdatedAt: nullableInstant(s, "", "journey_settings_updated_at"),
    lastScheduledRunAt: nullableInstant(s, "", "last_scheduled_run_at"),
  };
}

// rpc-shape: admin_data_retention_preview
export function parseDataRetentionPreview(raw: unknown): DataRetentionPreviewDto {
  const s = bag(raw, "$");
  return {
    cap: count(s, "", "cap"),
    categories: list(has(s, "", "categories"), "categories").flatMap((entry, i) => {
      const p = `categories[${i}].`;
      const c = bag(entry, p);
      const key = category(c, p, "key");
      if (key === null) return [];
      return {
        key,
        enabled: bool(c, p, "enabled"),
        mode: mode(c, p, "mode"),
        cutoff: nullableInstant(c, p, "cutoff"),
        count: nullableCount(c, p, "count"),
        capped: bool(c, p, "capped"),
      };
    }),
  };
}

// rpc-shape: admin_data_retention_crm_due
export function parseDataRetentionCrmDue(raw: unknown): DataRetentionCrmDueDto {
  const s = bag(raw, "$");
  return {
    noticeDays: count(s, "", "notice_days"),
    enabled: bool(s, "", "enabled"),
    enforced: bool(s, "", "enforced"),
    items: list(has(s, "", "items"), "items").map((entry, i) => {
      const p = `items[${i}].`;
      const c = bag(entry, p);
      return {
        leadId: text(c, p, "lead_id"),
        email: text(c, p, "email"),
        firstName: nullableText(c, p, "first_name"),
        lastName: nullableText(c, p, "last_name"),
        company: nullableText(c, p, "company"),
        lastActivity: instant(c, p, "last_activity"),
        dueAt: instant(c, p, "due_at"),
        customer: bool(c, p, "customer"),
      };
    }),
  };
}

/** Wynik `admin_data_retention_run_now`: kategoria -> {mode, affected | error}. */
export function parseDataRetentionRunResult(raw: unknown): DataRetentionRunResultDto {
  const s = bag(raw, "$");
  const categories: DataRetentionRunResultDto["categories"] = [];
  for (const key of DATA_RETENTION_RUN_CATEGORIES) {
    if (!Object.hasOwn(s, key)) continue;
    const p = `${key}.`;
    const c = bag(s[key], p);
    categories.push({
      key,
      mode: Object.hasOwn(c, "mode") ? mode(c, p, "mode") : null,
      affected: Object.hasOwn(c, "affected") ? nullableCount(c, p, "affected") : null,
      error: Object.hasOwn(c, "error") ? nullableText(c, p, "error") : null,
    });
  }
  return { busy: s.busy === true, categories };
}

/** Wynik przedłużenia kontaktu CRM. */
export function parseCrmExtension(raw: unknown): { leadId: string; extendedUntil: string } {
  const s = bag(raw, "$");
  return { leadId: text(s, "", "lead_id"), extendedUntil: instant(s, "", "extended_until") };
}

// ── Wygaszanie nieaktywnych subskrybentów newslettera (I9d-Y1) ───────────────

/** Etap subskrybenta na liście „do wygaszenia". */
export type NewsletterSunsetState = "candidate" | "requested" | "mailed";
/** Wynik wysyłki prośby zapisany w cyklu (lustro CHECK `mail_outcome`). */
export type NewsletterSunsetMailOutcome = "queued" | "duplicate" | "suppressed";

export interface DataRetentionNewsletterDueItem {
  subscriberId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  language: "pl" | "en";
  /**
   * `candidate` - prośba wyjdzie w najbliższym przebiegu; `requested` -
   * czeka na wysyłkę (okno dzienne, limit najemcy); `mailed` - wysłana,
   * biegnie termin reakcji.
   */
  state: NewsletterSunsetState;
  lastEngagedAt: string | null;
  requestedAt: string | null;
  mailedAt: string | null;
  mailOutcome: NewsletterSunsetMailOutcome | null;
  /** Najwcześniejsza chwila usunięcia (wysłana prośba + termin reakcji). */
  deleteAfter: string | null;
}

export interface DataRetentionNewsletterExcludedItem {
  subscriberId: string;
  email: string;
  reason: string;
  createdAt: string;
}

export interface DataRetentionNewsletterDueDto {
  counts: {
    /** Prośby w najbliższym przebiegu (sufit jak podgląd karty). */
    candidates: number;
    /** Cykle czekające na wysyłkę prośby. */
    requested: number;
    /** Prośby wysłane, termin reakcji biegnie. */
    mailed: number;
    /** Po terminie - do usunięcia w najbliższym przebiegu. */
    due: number;
    excluded: number;
  };
  items: DataRetentionNewsletterDueItem[];
  excluded: DataRetentionNewsletterExcludedItem[];
  responseDays: number;
  dailyCap: number;
  /** `false` = zaangażowanie liczone bez otwarć (dymek w karcie). */
  openTrackingEnabled: boolean;
  enabled: boolean;
  enforced: boolean;
  cutoff: string | null;
  periodMonths: number | null;
}

function oneOf<T extends string>(
  source: Bag,
  path: string,
  key: string,
  allowed: readonly T[],
): T {
  const value = has(source, path, key);
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    fail(`${path}${key}`, `oczekiwano ${allowed.join("|")}`);
  }
  return value as T;
}

const SUNSET_STATES = ["candidate", "requested", "mailed"] as const;
const SUNSET_OUTCOMES = ["queued", "duplicate", "suppressed"] as const;

// rpc-shape: admin_data_retention_newsletter_due
export function parseDataRetentionNewsletterDue(raw: unknown): DataRetentionNewsletterDueDto {
  const s = bag(raw, "$");
  const counts = bag(has(s, "", "counts"), "counts.");
  return {
    counts: {
      candidates: count(counts, "counts.", "candidates"),
      requested: count(counts, "counts.", "requested"),
      mailed: count(counts, "counts.", "mailed"),
      due: count(counts, "counts.", "due"),
      excluded: count(counts, "counts.", "excluded"),
    },
    items: list(has(s, "", "items"), "items").map((entry, i) => {
      const p = `items[${i}].`;
      const c = bag(entry, p);
      const outcome = has(c, p, "mail_outcome");
      return {
        subscriberId: text(c, p, "subscriber_id"),
        email: text(c, p, "email"),
        firstName: nullableText(c, p, "first_name"),
        lastName: nullableText(c, p, "last_name"),
        language: oneOf(c, p, "language", ["pl", "en"] as const),
        state: oneOf(c, p, "state", SUNSET_STATES),
        lastEngagedAt: nullableInstant(c, p, "last_engaged_at"),
        requestedAt: nullableInstant(c, p, "requested_at"),
        mailedAt: nullableInstant(c, p, "mailed_at"),
        mailOutcome: outcome === null ? null : oneOf(c, p, "mail_outcome", SUNSET_OUTCOMES),
        deleteAfter: nullableInstant(c, p, "delete_after"),
      };
    }),
    excluded: list(has(s, "", "excluded"), "excluded").map((entry, i) => {
      const p = `excluded[${i}].`;
      const c = bag(entry, p);
      return {
        subscriberId: text(c, p, "subscriber_id"),
        email: text(c, p, "email"),
        reason: text(c, p, "reason"),
        createdAt: instant(c, p, "created_at"),
      };
    }),
    responseDays: count(s, "", "response_days"),
    dailyCap: count(s, "", "daily_cap"),
    openTrackingEnabled: bool(s, "", "open_tracking_enabled"),
    enabled: bool(s, "", "enabled"),
    enforced: bool(s, "", "enforced"),
    cutoff: nullableInstant(s, "", "cutoff"),
    periodMonths: nullableCount(s, "", "period_months"),
  };
}

/** Wynik wykluczenia albo cofnięcia wykluczenia adresu z wygaszania. */
export interface NewsletterExclusionResultDto {
  subscriberId: string;
  excluded: boolean;
  /** Tylko wykluczenie: prośba w toku została anulowana. */
  cycleCancelled: boolean;
}

// rpc-shape: admin_data_retention_newsletter_exclude, admin_data_retention_newsletter_include
export function parseNewsletterExclusionResult(raw: unknown): NewsletterExclusionResultDto {
  const s = bag(raw, "$");
  return {
    subscriberId: text(s, "", "subscriber_id"),
    excluded: bool(s, "", "excluded"),
    cycleCancelled: Object.hasOwn(s, "cycle_cancelled") ? bool(s, "", "cycle_cancelled") : false,
  };
}
