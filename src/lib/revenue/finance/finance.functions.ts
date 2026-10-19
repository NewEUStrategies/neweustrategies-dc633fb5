// Server fns finansów huba (S2): księga MRR, churn, kohorty, windykacja,
// przychód zrealizowany, przepływ anulowania, macierz oferty, dane wejściowe
// i ekonomika (SPEC §8.3, kontrakt §4.5).
//
// BRAMKA = BRAMKA SQL. Middleware `requireCrmStaff` (admin/editor/super_admin)
// odcina autorów i gości; o kwotach decyduje SQL (`has_role(admin)` - editor
// widzi macierz oferty bez liczby płacących, resztę jako 42501). Odmowa wraca
// jako STAN `forbidden`, nie wyjątek - karta pokazuje `RoleGateNotice`
// zamiast toastu „błąd", którego ponowienie nie naprawi.
//
// NAJEMCA NIGDY W PARAMETRACH. RPC bierze go z sesji (`current_tenant_id()`),
// a klient użytkownika (`context.supabase`) niesie tę sesję (AGENTS: tenant
// z sesji, nigdy z payloadu).
//
// NAZWY RPC SĄ LITERAŁAMI w miejscu wywołania - bramka
// `generate:ts-sql-contract` czyta je ze źródła i sprawdza granty.
// Rzutowanie na `RpcCallable`: sygnatury funkcji huba dopisuje do `types.ts`
// dopiero I9 (N19).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireCrmStaff } from "@/integrations/supabase/require-staff";
import { REVENUE_INPUT_KINDS, REVENUE_LIMITS } from "@/lib/revenue/limits";
import type { RpcCallable } from "@/lib/revenue/rpcCallable";
import {
  REVENUE_INPUT_INVALID_CODES,
  type ChurnDto,
  type CohortsDto,
  type DunningDto,
  type EconomicsDto,
  type MrrBridgeDto,
  type MrrSeriesDto,
  type OfferMatrixDto,
  type RealizedDto,
  type RetentionOffersDto,
  type RevenueFinanceRead,
  type RevenueInputInvalidCode,
  type RevenueInputSaveRead,
  type RevenueInputsDto,
} from "./dto";
import {
  parseChurn,
  parseCohorts,
  parseDunning,
  parseEconomics,
  parseMrrBridge,
  parseMrrSeries,
  parseOfferMatrix,
  parseRealized,
  parseRetentionOffers,
  parseRevenueInputSave,
  parseRevenueInputs,
} from "./parse";

/** Najdłuższe okno agregatów okresowych (SQL: 22023 `window_invalid`). */
export const FINANCE_MAX_WINDOW_DAYS = 400;
/** Najdłuższe okno szeregu dziennego (SQL: 22023 `grain_invalid`). */
export const FINANCE_DAY_GRAIN_MAX_DAYS = 120;
/** Najdłuższy zakres miesięcy kohort, danych wejściowych i ekonomiki (24 miesiące). */
export const FINANCE_MAX_MONTH_SPAN = 23;

const DAY_MS = 86_400_000;

/**
 * Błędy znaczące „funkcji jeszcze nie ma w tej bazie": migracje wdrażają się
 * osobno od aplikacji, więc przez kilka minut publikacji to stan normalny.
 */
const MISSING_SOURCE = new Set(["42883", "PGRST202"]);

type RpcError = { message: string; code?: string } | null;

/** Wspólne rozstrzygnięcie odczytu: dane, odmowa, brak funkcji albo błąd. */
function settle<T>(
  raw: unknown,
  error: RpcError,
  parse: (raw: unknown) => T,
): RevenueFinanceRead<T> {
  if (error) {
    if (error.code === "42501") return { state: "forbidden" };
    if (error.code !== undefined && MISSING_SOURCE.has(error.code)) return { state: "unavailable" };
    throw new Error(error.message);
  }
  return { state: "ready", data: parse(raw) };
}

function asRpc(client: unknown): RpcCallable {
  return client as RpcCallable;
}

// ── Walidacja wejścia ───────────────────────────────────────────────────────

const Instant = z.string().datetime({ offset: true });
const MonthStart = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/, "month_invalid");
const SegmentFilter = z
  .enum(["all", "b2c_individual", "b2c_reduced", "b2b_institution", "other"])
  .nullable()
  .default(null);
/** Strefa IANA; SQL i tak sprawdza `pg_timezone_names` (22023). */
const TimeZone = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/, "time_zone_invalid")
  .default("Europe/Warsaw");

function windowSchema<T extends z.ZodRawShape>(extra: T) {
  return z
    .object({ sinceIso: Instant, untilIso: Instant, ...extra })
    .refine((w) => Date.parse(w.untilIso) > Date.parse(w.sinceIso), { message: "window_invalid" })
    .refine(
      (w) => Date.parse(w.untilIso) - Date.parse(w.sinceIso) <= FINANCE_MAX_WINDOW_DAYS * DAY_MS,
      { message: "window_invalid" },
    );
}

/** Liczba miesięcy między dwoma `YYYY-MM-01` (bez `Date` - bez przesunięcia strefy). */
export function monthSpan(fromMonth: string, toMonth: string): number {
  const [fy, fm] = fromMonth.split("-").map(Number);
  const [ty, tm] = toMonth.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

const MonthRange = z.object({ fromMonth: MonthStart, toMonth: MonthStart }).refine(
  (r) => {
    const span = monthSpan(r.fromMonth, r.toMonth);
    return span >= 0 && span <= FINANCE_MAX_MONTH_SPAN;
  },
  { message: "window_invalid" },
);

const PlainWindow = windowSchema({});
const BridgeInput = windowSchema({ segment: SegmentFilter });
const SeriesInput = windowSchema({
  grain: z.enum(["day", "week", "month"]).default("month"),
  timeZone: TimeZone,
}).refine(
  (w) =>
    w.grain !== "day" ||
    Date.parse(w.untilIso) - Date.parse(w.sinceIso) <= FINANCE_DAY_GRAIN_MAX_DAYS * DAY_MS,
  { message: "grain_invalid" },
);
const EconomicsInput = z
  .object({ fromMonth: MonthStart, toMonth: MonthStart, timeZone: TimeZone })
  .refine(
    (r) => {
      const span = monthSpan(r.fromMonth, r.toMonth);
      return span >= 0 && span <= FINANCE_MAX_MONTH_SPAN;
    },
    { message: "window_invalid" },
  );

export type FinanceWindowInput = z.input<typeof PlainWindow>;
export type MrrBridgeInput = z.input<typeof BridgeInput>;
export type MrrSeriesInput = z.input<typeof SeriesInput>;
export type FinanceMonthRangeInput = z.input<typeof MonthRange>;
export type EconomicsInput = z.input<typeof EconomicsInput>;

// ── Odczyty ─────────────────────────────────────────────────────────────────

export const getRevenueMrrBridge = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((input: unknown) => BridgeInput.parse(input))
  .handler(async ({ data, context }): Promise<RevenueFinanceRead<MrrBridgeDto>> => {
    const { data: raw, error } = await asRpc(context.supabase).rpc("admin_revenue_mrr_bridge", {
      p_since: data.sinceIso,
      p_until: data.untilIso,
      p_segment: data.segment,
    });
    return settle(raw, error, parseMrrBridge);
  });

export const getRevenueMrrSeries = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((input: unknown) => SeriesInput.parse(input))
  .handler(async ({ data, context }): Promise<RevenueFinanceRead<MrrSeriesDto>> => {
    const { data: raw, error } = await asRpc(context.supabase).rpc("admin_revenue_mrr_series", {
      p_since: data.sinceIso,
      p_until: data.untilIso,
      p_grain: data.grain,
      p_time_zone: data.timeZone,
    });
    return settle(raw, error, parseMrrSeries);
  });

export const getRevenueChurn = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((input: unknown) => PlainWindow.parse(input))
  .handler(async ({ data, context }): Promise<RevenueFinanceRead<ChurnDto>> => {
    const { data: raw, error } = await asRpc(context.supabase).rpc("admin_revenue_churn", {
      p_since: data.sinceIso,
      p_until: data.untilIso,
    });
    return settle(raw, error, parseChurn);
  });

export const getRevenueCohorts = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((input: unknown) => MonthRange.parse(input))
  .handler(async ({ data, context }): Promise<RevenueFinanceRead<CohortsDto>> => {
    const { data: raw, error } = await asRpc(context.supabase).rpc("admin_revenue_cohorts", {
      p_from_month: data.fromMonth,
      p_to_month: data.toMonth,
    });
    return settle(raw, error, parseCohorts);
  });

export const getRevenueDunning = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((input: unknown) => PlainWindow.parse(input))
  .handler(async ({ data, context }): Promise<RevenueFinanceRead<DunningDto>> => {
    const { data: raw, error } = await asRpc(context.supabase).rpc("admin_revenue_dunning", {
      p_since: data.sinceIso,
      p_until: data.untilIso,
    });
    return settle(raw, error, parseDunning);
  });

/**
 * Przychód zrealizowany - JEDNA funkcja dla huba, `/admin/billing`, pulpitu
 * i BI (ta sama RPC, ten sam klucz `revenueKeys.query("realized", …)`).
 */
export const getRevenueRealized = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((input: unknown) => PlainWindow.parse(input))
  .handler(async ({ data, context }): Promise<RevenueFinanceRead<RealizedDto>> => {
    const { data: raw, error } = await asRpc(context.supabase).rpc("admin_revenue_realized", {
      p_since: data.sinceIso,
      p_until: data.untilIso,
    });
    return settle(raw, error, parseRealized);
  });

export const getRevenueRetentionOffers = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((input: unknown) => PlainWindow.parse(input))
  .handler(async ({ data, context }): Promise<RevenueFinanceRead<RetentionOffersDto>> => {
    const { data: raw, error } = await asRpc(context.supabase).rpc(
      "admin_revenue_retention_offers",
      { p_since: data.sinceIso, p_until: data.untilIso },
    );
    return settle(raw, error, parseRetentionOffers);
  });

export const getRevenueOfferMatrix = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .handler(async ({ context }): Promise<RevenueFinanceRead<OfferMatrixDto>> => {
    const { data: raw, error } = await asRpc(context.supabase).rpc(
      "admin_revenue_offer_matrix",
      {},
    );
    return settle(raw, error, parseOfferMatrix);
  });

export const getRevenueInputs = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((input: unknown) => MonthRange.parse(input))
  .handler(async ({ data, context }): Promise<RevenueFinanceRead<RevenueInputsDto>> => {
    const { data: raw, error } = await asRpc(context.supabase).rpc("admin_revenue_inputs", {
      p_from_month: data.fromMonth,
      p_to_month: data.toMonth,
    });
    return settle(raw, error, parseRevenueInputs);
  });

export const getRevenueEconomics = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((input: unknown) => EconomicsInput.parse(input))
  .handler(async ({ data, context }): Promise<RevenueFinanceRead<EconomicsDto>> => {
    const { data: raw, error } = await asRpc(context.supabase).rpc("admin_revenue_economics", {
      p_from_month: data.fromMonth,
      p_to_month: data.toMonth,
      p_time_zone: data.timeZone,
    });
    return settle(raw, error, parseEconomics);
  });

// ── Zapis danej wejściowej ──────────────────────────────────────────────────

/**
 * Wejście zapisu. Kwota i iloraz nie są obcinane ani zaokrąglane po cichu -
 * wartość spoza zakresu odpada w walidacji (AGENTS: limity = zapis, nigdy
 * `slice`), a SQL powtarza te same reguły (`value_invalid`).
 */
export const RevenueInputSaveInput = z
  .object({
    periodMonth: MonthStart,
    kind: z.enum(REVENUE_INPUT_KINDS),
    segment: z.enum(["all", "b2c_individual", "b2c_reduced", "b2b_institution"]).default("all"),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    amountMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
    ratio: z
      .number()
      .finite()
      .min(REVENUE_LIMITS.inputRatioMin)
      .max(REVENUE_LIMITS.inputRatioMax)
      .nullable(),
    // Limit po `btrim`, jak w SQL - inaczej spacje na końcu odrzucałyby
    // notatkę, którą baza przyjęłaby (i odwrotnie).
    note: z
      .string()
      .refine((n) => n.trim().length <= REVENUE_LIMITS.inputNoteMax, { message: "note_too_long" })
      .nullable(),
    /** Surowy `updated_at` z odczytu; `null` = wiersz nowy. */
    expectedUpdatedAt: Instant.nullable(),
  })
  .refine(
    (v) =>
      v.kind === "gross_margin_pct" || v.kind === "ebitda_margin_pct"
        ? v.amountMinor === null && v.currency === null
        : v.ratio === null && v.currency !== null,
    { message: "value_invalid" },
  );

export type RevenueInputSaveInput = z.input<typeof RevenueInputSaveInput>;

const INVALID_CODES = new Set<string>(REVENUE_INPUT_INVALID_CODES);

export const saveRevenueInput = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((input: unknown) => RevenueInputSaveInput.parse(input))
  .handler(async ({ data, context }): Promise<RevenueInputSaveRead> => {
    const { data: raw, error } = await asRpc(context.supabase).rpc("admin_revenue_input_upsert", {
      p_period_month: data.periodMonth,
      p_kind: data.kind,
      p_segment: data.segment,
      p_currency: data.currency,
      p_amount_minor: data.amountMinor,
      p_ratio: data.ratio,
      p_note: data.note,
      p_expected_updated_at: data.expectedUpdatedAt,
    });
    if (error) {
      if (error.code === "42501") return { state: "forbidden" };
      if (error.code === "40001") return { state: "conflict" };
      if (error.code !== undefined && MISSING_SOURCE.has(error.code))
        return { state: "unavailable" };
      if (error.code === "22023" && INVALID_CODES.has(error.message)) {
        return { state: "invalid", code: error.message as RevenueInputInvalidCode };
      }
      throw new Error(error.message);
    }
    return { state: "saved", result: parseRevenueInputSave(raw) };
  });
