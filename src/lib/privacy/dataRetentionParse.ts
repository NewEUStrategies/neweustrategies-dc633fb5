// JSONB RPC karty „Retencja danych" -> DTO panelu, pole po polu (I9c-X2).
//
// PARSER RZUCA, A NIE ZERUJE (jak `journeys/parse.ts`): `0` rekordów do
// usunięcia to WYNIK, a `null` - „kategoria wyłączona, nic nie liczono". Zły
// kształt to rozjazd kontraktu SQL <-> TS (migracja 20261020161400), więc
// ma być głośny, a nie zamieniony na pustą kartę.
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

function category(source: Bag, path: string, key: string): DataRetentionRunCategory {
  const value = has(source, path, key);
  if (
    typeof value !== "string" ||
    !(DATA_RETENTION_RUN_CATEGORIES as readonly string[]).includes(value)
  ) {
    fail(`${path}${key}`, "nieznana kategoria");
  }
  return value as DataRetentionRunCategory;
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
    categories: list(has(s, "", "categories"), "categories").map((entry, i) => {
      const p = `categories[${i}].`;
      const c = bag(entry, p);
      return {
        key: category(c, p, "key"),
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
    categories: list(has(s, "", "categories"), "categories").map((entry, i) => {
      const p = `categories[${i}].`;
      const c = bag(entry, p);
      return {
        key: category(c, p, "key"),
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
