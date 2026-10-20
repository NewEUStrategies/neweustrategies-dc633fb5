// JSONB agregatów finansowych huba (S2) -> DTO z `dto.ts`, pole po polu.
//
// DLACZEGO PARSER RZUCA, A NIE ZERUJE (wzór `revenue/email/parse.ts`). Zero
// jest tu WYNIKIEM („0 zł churnu w tym miesiącu"), a `null` znaczy „nie da się
// policzyć" (brak mianownika, okno przed początkiem księgi). Parser, który
// zamienia brak pola albo śmieć w 0, zamazałby dokładnie tę różnicę - a zły
// kształt to rozjazd kontraktu SQL <-> TS, więc ma być głośny
// (`RevenueFinanceShapeError` ze ścieżką pola).
//
// STAŁE `*_KEYS` (komentarz `// rpc-shape: <funkcja>`) SĄ KONTRAKTEM: pgTAP
// sprawdza `set_eq` kluczy dokładnie tymi listami (etykieta asercji nazywa
// stałą), a `__tests__/parse.test.ts` porównuje listy z plikami pgTAP
// i z treścią migracji. Zmiana kształtu = jedna linia tu + jedna w SQL.
//
// Moduł czysty (bez Reacta i sieci): czytają go server fns, testy i - przez
// import typów - zakładki S7.
import { REVENUE_INPUT_KINDS, type RevenueInputKind } from "@/lib/revenue/limits";
import { type MoneyByCurrency, parseMoneyByCurrency } from "@/lib/revenue/money";
import {
  CHURN_REASONS,
  OFFER_PLAN_ISSUES,
  OFFER_TIER_ISSUES,
  REALIZED_CATEGORIES,
  type ChurnDto,
  type ChurnReason,
  type CohortsDto,
  type DunningDto,
  type EconomicsDto,
  type EconomicsMonth,
  type MrrBridgeCurrencyRow,
  type MrrBridgeDto,
  type MrrSeriesDto,
  type MrrSeriesGrain,
  type OfferMatrixDto,
  type RealizedDto,
  type RetentionOffersDto,
  type RevenueBasisMix,
  type RevenueInputRow,
  type RevenueInputSaveResult,
  type RevenueInputsDto,
  type RuleOf40,
} from "./dto";
import { bridgeReconciles, bridgeResidualMinor, type BridgeParts } from "./mrrMath";

// ── Kontrakt kształtu ───────────────────────────────────────────────────────

// rpc-shape: admin_revenue_mrr_bridge
export const MRR_BRIDGE_KEYS = {
  root: [
    "since",
    "until",
    "segment",
    "data_since",
    "basis_mix",
    "currencies",
    "active_subscriptions",
    "active_customers",
  ],
  currency: [
    "currency",
    "start_minor",
    "opening_minor",
    "new_minor",
    "expansion_minor",
    "reactivation_minor",
    "contraction_minor",
    "churn_minor",
    "net_new_minor",
    "end_minor",
    "active_subscriptions",
    "active_customers",
  ],
  basisMix: ["provider", "catalog"],
} as const;

// rpc-shape: admin_revenue_mrr_series
export const MRR_SERIES_KEYS = {
  root: ["since", "until", "grain", "time_zone", "points"],
  point: [
    "bucket_start",
    "at",
    "currency",
    "mrr_minor",
    "active_subscriptions",
    "snapshot_mrr_minor",
  ],
} as const;

// rpc-shape: admin_revenue_churn
export const CHURN_KEYS = {
  root: [
    "since",
    "until",
    "customers_start",
    "customers_churned",
    "logo_churn_rate",
    "involuntary_share",
    "currencies",
    "reasons",
  ],
  currency: [
    "currency",
    "mrr_start_minor",
    "churn_minor",
    "contraction_minor",
    "expansion_minor",
    "reactivation_minor",
    "gross_revenue_churn",
    "gross_revenue_retention",
    "net_revenue_retention",
  ],
  reason: ["reason", "movements", "amounts"],
} as const;

// rpc-shape: admin_revenue_cohorts
export const COHORTS_KEYS = {
  root: ["from_month", "to_month", "max_offset", "cohorts"],
  cohort: ["cohort_month", "size", "retained"],
  cell: ["month_offset", "active", "share"],
} as const;

// rpc-shape: admin_revenue_dunning
export const DUNNING_KEYS = {
  root: [
    "since",
    "until",
    "started",
    "recovered",
    "lost",
    "open",
    "recovery_rate",
    "median_days_to_recover",
    "at_risk",
    "recovered_mrr",
    "lost_mrr",
  ],
} as const;

// rpc-shape: admin_revenue_realized
export const REALIZED_KEYS = {
  root: ["since", "until", "categories", "totals", "orders", "unknown_environment_documents"],
  category: ["category", "currency", "gross_minor", "refunds_minor", "net_minor", "documents"],
  total: ["currency", "gross_minor", "refunds_minor", "net_minor"],
  order: ["currency", "amount_minor", "orders"],
} as const;

// rpc-shape: admin_revenue_retention_offers
export const RETENTION_OFFERS_KEYS = {
  root: [
    "since",
    "until",
    "flows_started",
    "saved",
    "canceled",
    "abandoned",
    "open",
    "offers_shown",
    "offers_accepted",
    "save_rate_gross",
    "save_rate_net",
    "reason_not_given",
    "legacy_responses",
    "reasons",
  ],
  reason: ["reason_id", "reason_label", "responses"],
} as const;

// rpc-shape: admin_revenue_offer_matrix
export const OFFER_MATRIX_KEYS = {
  root: ["plans", "tiers"],
  plan: [
    "plan_id",
    "tier_key",
    "interval",
    "price_cents",
    "currency",
    "active",
    "for_sale",
    "catalog_price_id",
    "tier_active",
    "pricing_visible",
    "active_subscriptions",
    "issues",
  ],
  tier: ["key", "rank", "active", "pricing_visible", "is_default", "plans_for_sale", "issues"],
} as const;

// rpc-shape: admin_revenue_inputs
export const REVENUE_INPUTS_KEYS = {
  root: ["from_month", "to_month", "rows"],
  row: [
    "id",
    "period_month",
    "kind",
    "segment",
    "currency",
    "amount_minor",
    "ratio",
    "note",
    "updated_at",
    "updated_by",
  ],
} as const;

// rpc-shape: admin_revenue_input_upsert
export const REVENUE_INPUT_SAVE_KEYS = {
  root: ["op", "row"],
} as const;

// rpc-shape: admin_revenue_economics
export const ECONOMICS_KEYS = {
  root: ["from_month", "to_month", "time_zone", "months", "missing", "rule_of_40"],
  month: [
    "month",
    "currency",
    "mrr_end_minor",
    "customers_end",
    "arpa_minor",
    "new_customers",
    "logo_churn_rate",
    "realized_net_minor",
    "sales_marketing_cost_minor",
    "cogs_minor",
    "gross_margin",
    "ebitda_margin",
    "cac_minor",
    "ltv_minor",
    "ltv_cac_ratio",
    "cac_payback_months",
    "mrr_plan_minor",
    "plan_attainment",
    "new_customers_plan",
    "missing",
  ],
  ruleOf40: ["month", "currency", "growth_yoy", "ebitda_margin", "value"],
} as const;

// ── Narzędzia ───────────────────────────────────────────────────────────────

/** Rozjazd kontraktu RPC: funkcja, ścieżka pola i powód. */
export class RevenueFinanceShapeError extends Error {
  readonly rpc: string;
  readonly path: string;

  constructor(rpc: string, path: string, reason: string) {
    super(`${rpc}: ${path} - ${reason}`);
    this.name = "RevenueFinanceShapeError";
    this.rpc = rpc;
    this.path = path;
  }
}

type Bag = Readonly<Record<string, unknown>>;

function isBag(value: unknown): value is Bag {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const CURRENCY = /^[A-Z]{3}$/;
const LOCAL_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Czytnik jednej odpowiedzi: zna nazwę RPC, więc każdy błąd mówi, KTÓRA
 * funkcja i KTÓRE pole rozjechały się z kontraktem.
 */
function reader(rpc: string) {
  const fail = (path: string, reason: string): never => {
    throw new RevenueFinanceShapeError(rpc, path, reason);
  };

  const at = (path: string, key: string) => (path === "$" ? key : `${path}.${key}`);

  function present(src: Bag, path: string, key: string): unknown {
    if (!(key in src)) fail(at(path, key), "brak pola");
    return src[key];
  }

  function bag(raw: unknown, path: string): Bag {
    if (!isBag(raw)) fail(path, "oczekiwano obiektu");
    return raw as Bag;
  }

  function list(src: Bag, path: string, key: string): unknown[] {
    const value = present(src, path, key);
    if (!Array.isArray(value)) fail(at(path, key), "oczekiwano tablicy");
    return value as unknown[];
  }

  function nullableList(src: Bag, path: string, key: string): unknown[] | null {
    const value = present(src, path, key);
    if (value === null) return null;
    if (!Array.isArray(value)) fail(at(path, key), "oczekiwano tablicy albo null");
    return value as unknown[];
  }

  /**
   * Liczba całkowita. `count(*)`/`sum(bigint)` to `bigint`, który przy dużych
   * wartościach bywa napisem cyfr - ten przyjmujemy, każdy inny typ nie.
   */
  function intOrNull(src: Bag, path: string, key: string, signed = false): number | null {
    const value = present(src, path, key);
    if (value === null) return null;
    const parsed =
      typeof value === "number"
        ? value
        : typeof value === "string" && /^-?\d+$/.test(value.trim())
          ? Number(value)
          : Number.NaN;
    if (!Number.isSafeInteger(parsed) || (!signed && parsed < 0)) {
      fail(
        at(path, key),
        signed ? "oczekiwano liczby całkowitej" : "oczekiwano liczby całkowitej >= 0",
      );
    }
    return parsed;
  }

  function int(src: Bag, path: string, key: string, signed = false): number {
    const value = intOrNull(src, path, key, signed);
    if (value === null) fail(at(path, key), "null niedozwolony");
    return value as number;
  }

  /** Iloraz z `round(numeric, 4)`; `bounds` odrzuca błąd jednostki (procenty). */
  function ratio(
    src: Bag,
    path: string,
    key: string,
    bounds: { min?: number; max?: number } = { min: 0, max: 1 },
  ): number | null {
    const value = present(src, path, key);
    if (value === null) return null;
    const parsed =
      typeof value === "number"
        ? value
        : typeof value === "string" && value.trim() !== ""
          ? Number(value)
          : Number.NaN;
    if (!Number.isFinite(parsed)) fail(at(path, key), "oczekiwano liczby");
    if (bounds.min !== undefined && parsed < bounds.min)
      fail(at(path, key), `poniżej ${bounds.min}`);
    if (bounds.max !== undefined && parsed > bounds.max)
      fail(at(path, key), `powyżej ${bounds.max}`);
    return parsed;
  }

  function bool(src: Bag, path: string, key: string): boolean {
    const value = present(src, path, key);
    if (typeof value !== "boolean") fail(at(path, key), "oczekiwano wartości logicznej");
    return value as boolean;
  }

  function boolOrNull(src: Bag, path: string, key: string): boolean | null {
    const value = present(src, path, key);
    if (value === null) return null;
    if (typeof value !== "boolean") fail(at(path, key), "oczekiwano wartości logicznej albo null");
    return value as boolean;
  }

  function text(src: Bag, path: string, key: string): string {
    const value = present(src, path, key);
    if (typeof value !== "string") fail(at(path, key), "oczekiwano napisu");
    return value as string;
  }

  function textOrNull(src: Bag, path: string, key: string): string | null {
    const value = present(src, path, key);
    if (value === null) return null;
    if (typeof value !== "string") fail(at(path, key), "oczekiwano napisu albo null");
    return value as string;
  }

  function instant(src: Bag, path: string, key: string): string {
    const value = text(src, path, key);
    if (Number.isNaN(Date.parse(value))) fail(at(path, key), "oczekiwano znacznika czasu ISO");
    return value;
  }

  function instantOrNull(src: Bag, path: string, key: string): string | null {
    const value = textOrNull(src, path, key);
    if (value !== null && Number.isNaN(Date.parse(value))) {
      fail(at(path, key), "oczekiwano znacznika czasu ISO albo null");
    }
    return value;
  }

  /** Dzień lokalny `YYYY-MM-DD` - zostaje napisem (bez `Date`, bez przesunięcia strefy). */
  function day(src: Bag, path: string, key: string): string {
    const value = text(src, path, key);
    if (!LOCAL_DAY.test(value)) fail(at(path, key), "oczekiwano dnia YYYY-MM-DD");
    return value;
  }

  function currency(src: Bag, path: string, key = "currency"): string {
    const value = text(src, path, key);
    if (!CURRENCY.test(value)) fail(at(path, key), "oczekiwano kodu ISO 4217");
    return value;
  }

  function money(src: Bag, path: string, key: string): MoneyByCurrency[] {
    const value = parseMoneyByCurrency(present(src, path, key));
    if (value === null) fail(at(path, key), "oczekiwano listy kwot per waluta");
    return value as MoneyByCurrency[];
  }

  function oneOf<T extends string>(src: Bag, path: string, key: string, allowed: readonly T[]): T {
    const value = text(src, path, key);
    if (!(allowed as readonly string[]).includes(value)) {
      fail(at(path, key), `wartość spoza słownika: ${value}`);
    }
    return value as T;
  }

  function enumList<T extends string>(
    src: Bag,
    path: string,
    key: string,
    allowed: readonly T[],
  ): T[] {
    return list(src, path, key).map((item, i) => {
      if (typeof item !== "string" || !(allowed as readonly string[]).includes(item)) {
        fail(`${at(path, key)}[${i}]`, `wartość spoza słownika: ${String(item)}`);
      }
      return item as T;
    });
  }

  return {
    fail,
    bag,
    list,
    nullableList,
    int,
    intOrNull,
    ratio,
    bool,
    boolOrNull,
    text,
    textOrNull,
    instant,
    instantOrNull,
    day,
    currency,
    money,
    oneOf,
    enumList,
  };
}

const UNBOUNDED_POSITIVE = { min: 0 } as const;
const SIGNED = {} as const;

function basisMix(r: ReturnType<typeof reader>, src: Bag, path: string): RevenueBasisMix | null {
  const raw = (src as Record<string, unknown>).basis_mix;
  if (!("basis_mix" in src)) r.fail(path === "$" ? "basis_mix" : `${path}.basis_mix`, "brak pola");
  if (raw === null) return null;
  const mix = r.bag(raw, "basis_mix");
  return {
    provider:
      r.ratio(mix, "basis_mix", "provider") ?? r.fail("basis_mix.provider", "null niedozwolony"),
    catalog:
      r.ratio(mix, "basis_mix", "catalog") ?? r.fail("basis_mix.catalog", "null niedozwolony"),
  };
}

// ── Most MRR ────────────────────────────────────────────────────────────────

/** Parser `admin_revenue_mrr_bridge`; most domyka się z konstrukcji (start + Σ = koniec). */
export function parseMrrBridge(raw: unknown): MrrBridgeDto {
  const r = reader("admin_revenue_mrr_bridge");
  const root = r.bag(raw, "$");
  const currencies = r.nullableList(root, "$", "currencies");
  return {
    since: r.instant(root, "$", "since"),
    until: r.instant(root, "$", "until"),
    segment: r.text(root, "$", "segment"),
    dataSince: r.instantOrNull(root, "$", "data_since"),
    basisMix: basisMix(r, root, "$"),
    currencies:
      currencies === null
        ? null
        : currencies.map((item, i): MrrBridgeCurrencyRow => {
            const path = `currencies[${i}]`;
            const c = r.bag(item, path);
            const parts: BridgeParts = {
              startMinor: r.int(c, path, "start_minor", true),
              openingMinor: r.int(c, path, "opening_minor", true),
              newMinor: r.int(c, path, "new_minor", true),
              expansionMinor: r.int(c, path, "expansion_minor", true),
              reactivationMinor: r.int(c, path, "reactivation_minor", true),
              contractionMinor: r.int(c, path, "contraction_minor", true),
              churnMinor: r.int(c, path, "churn_minor", true),
              endMinor: r.int(c, path, "end_minor", true),
            };
            return {
              currency: r.currency(c, path),
              ...parts,
              netNewMinor: r.int(c, path, "net_new_minor", true),
              activeSubscriptions: r.int(c, path, "active_subscriptions"),
              activeCustomers: r.int(c, path, "active_customers"),
              residualMinor: bridgeResidualMinor(parts),
              reconciled: bridgeReconciles(parts),
            };
          }),
    activeSubscriptions: r.int(root, "$", "active_subscriptions"),
    activeCustomers: r.int(root, "$", "active_customers"),
  };
}

// ── Szereg MRR ──────────────────────────────────────────────────────────────

const GRAINS: readonly MrrSeriesGrain[] = ["day", "week", "month"];

export function parseMrrSeries(raw: unknown): MrrSeriesDto {
  const r = reader("admin_revenue_mrr_series");
  const root = r.bag(raw, "$");
  return {
    since: r.instant(root, "$", "since"),
    until: r.instant(root, "$", "until"),
    grain: r.oneOf(root, "$", "grain", GRAINS),
    timeZone: r.text(root, "$", "time_zone"),
    points: r.list(root, "$", "points").map((item, i) => {
      const path = `points[${i}]`;
      const p = r.bag(item, path);
      const mrrMinor = r.int(p, path, "mrr_minor", true);
      const snapshotMrrMinor = r.intOrNull(p, path, "snapshot_mrr_minor", true);
      return {
        bucketStart: r.day(p, path, "bucket_start"),
        at: r.instant(p, path, "at"),
        currency: r.currency(p, path),
        mrrMinor,
        activeSubscriptions: r.int(p, path, "active_subscriptions"),
        snapshotMrrMinor,
        driftMinor: snapshotMrrMinor === null ? null : snapshotMrrMinor - mrrMinor,
      };
    }),
  };
}

// ── Churn ───────────────────────────────────────────────────────────────────

export function parseChurn(raw: unknown): ChurnDto {
  const r = reader("admin_revenue_churn");
  const root = r.bag(raw, "$");
  return {
    since: r.instant(root, "$", "since"),
    until: r.instant(root, "$", "until"),
    customersStart: r.int(root, "$", "customers_start"),
    customersChurned: r.int(root, "$", "customers_churned"),
    logoChurnRate: r.ratio(root, "$", "logo_churn_rate"),
    involuntaryShare: r.ratio(root, "$", "involuntary_share"),
    currencies: r.list(root, "$", "currencies").map((item, i) => {
      const path = `currencies[${i}]`;
      const c = r.bag(item, path);
      return {
        currency: r.currency(c, path),
        mrrStartMinor: r.int(c, path, "mrr_start_minor", true),
        churnMinor: r.int(c, path, "churn_minor", true),
        contractionMinor: r.int(c, path, "contraction_minor", true),
        expansionMinor: r.int(c, path, "expansion_minor", true),
        reactivationMinor: r.int(c, path, "reactivation_minor", true),
        // GRC/GRR liczą się z kwot ze znakiem - ujemny wynik to też informacja
        // (rozjazd księgi), więc bez dolnej granicy; NRR nieujemny.
        grossRevenueChurn: r.ratio(c, path, "gross_revenue_churn", SIGNED),
        grossRevenueRetention: r.ratio(c, path, "gross_revenue_retention", SIGNED),
        netRevenueRetention: r.ratio(c, path, "net_revenue_retention", UNBOUNDED_POSITIVE),
      };
    }),
    reasons: r.list(root, "$", "reasons").map((item, i) => {
      const path = `reasons[${i}]`;
      const x = r.bag(item, path);
      return {
        reason: r.oneOf<ChurnReason>(x, path, "reason", CHURN_REASONS),
        movements: r.int(x, path, "movements"),
        amounts: r.money(x, path, "amounts"),
      };
    }),
  };
}

// ── Kohorty ─────────────────────────────────────────────────────────────────

export function parseCohorts(raw: unknown): CohortsDto {
  const r = reader("admin_revenue_cohorts");
  const root = r.bag(raw, "$");
  return {
    fromMonth: r.day(root, "$", "from_month"),
    toMonth: r.day(root, "$", "to_month"),
    maxOffset: r.int(root, "$", "max_offset"),
    cohorts: r.list(root, "$", "cohorts").map((item, i) => {
      const path = `cohorts[${i}]`;
      const c = r.bag(item, path);
      return {
        cohortMonth: r.day(c, path, "cohort_month"),
        size: r.int(c, path, "size"),
        retained: r.list(c, path, "retained").map((cell, j) => {
          const cellPath = `${path}.retained[${j}]`;
          const x = r.bag(cell, cellPath);
          return {
            monthOffset: r.int(x, cellPath, "month_offset"),
            active: r.int(x, cellPath, "active"),
            share: r.ratio(x, cellPath, "share"),
          };
        }),
      };
    }),
  };
}

// ── Windykacja ──────────────────────────────────────────────────────────────

export function parseDunning(raw: unknown): DunningDto {
  const r = reader("admin_revenue_dunning");
  const root = r.bag(raw, "$");
  return {
    since: r.instant(root, "$", "since"),
    until: r.instant(root, "$", "until"),
    started: r.int(root, "$", "started"),
    recovered: r.int(root, "$", "recovered"),
    lost: r.int(root, "$", "lost"),
    open: r.int(root, "$", "open"),
    recoveryRate: r.ratio(root, "$", "recovery_rate"),
    medianDaysToRecover: r.ratio(root, "$", "median_days_to_recover", UNBOUNDED_POSITIVE),
    atRisk: r.money(root, "$", "at_risk"),
    recoveredMrr: r.money(root, "$", "recovered_mrr"),
    lostMrr: r.money(root, "$", "lost_mrr"),
  };
}

// ── Przychód zrealizowany ───────────────────────────────────────────────────

export function parseRealized(raw: unknown): RealizedDto {
  const r = reader("admin_revenue_realized");
  const root = r.bag(raw, "$");
  return {
    since: r.instant(root, "$", "since"),
    until: r.instant(root, "$", "until"),
    categories: r.list(root, "$", "categories").map((item, i) => {
      const path = `categories[${i}]`;
      const c = r.bag(item, path);
      return {
        category: r.oneOf(c, path, "category", REALIZED_CATEGORIES),
        currency: r.currency(c, path),
        grossMinor: r.int(c, path, "gross_minor"),
        refundsMinor: r.int(c, path, "refunds_minor"),
        netMinor: r.int(c, path, "net_minor", true),
        documents: r.int(c, path, "documents"),
      };
    }),
    totals: r.list(root, "$", "totals").map((item, i) => {
      const path = `totals[${i}]`;
      const t = r.bag(item, path);
      return {
        currency: r.currency(t, path),
        grossMinor: r.int(t, path, "gross_minor"),
        refundsMinor: r.int(t, path, "refunds_minor"),
        netMinor: r.int(t, path, "net_minor", true),
      };
    }),
    orders: r.list(root, "$", "orders").map((item, i) => {
      const path = `orders[${i}]`;
      const o = r.bag(item, path);
      return {
        currency: r.currency(o, path),
        amountMinor: r.int(o, path, "amount_minor", true),
        orders: r.int(o, path, "orders"),
      };
    }),
    unknownEnvironmentDocuments: r.int(root, "$", "unknown_environment_documents"),
  };
}

// ── Przepływ anulowania ─────────────────────────────────────────────────────

export function parseRetentionOffers(raw: unknown): RetentionOffersDto {
  const r = reader("admin_revenue_retention_offers");
  const root = r.bag(raw, "$");
  return {
    since: r.instant(root, "$", "since"),
    until: r.instant(root, "$", "until"),
    flowsStarted: r.int(root, "$", "flows_started"),
    saved: r.int(root, "$", "saved"),
    canceled: r.int(root, "$", "canceled"),
    abandoned: r.int(root, "$", "abandoned"),
    open: r.int(root, "$", "open"),
    offersShown: r.int(root, "$", "offers_shown"),
    offersAccepted: r.int(root, "$", "offers_accepted"),
    saveRateGross: r.ratio(root, "$", "save_rate_gross"),
    saveRateNet: r.ratio(root, "$", "save_rate_net"),
    reasonNotGiven: r.int(root, "$", "reason_not_given"),
    legacyResponses: r.int(root, "$", "legacy_responses"),
    reasons: r.list(root, "$", "reasons").map((item, i) => {
      const path = `reasons[${i}]`;
      const x = r.bag(item, path);
      return {
        reasonId: r.textOrNull(x, path, "reason_id"),
        reasonLabel: r.text(x, path, "reason_label"),
        responses: r.int(x, path, "responses"),
      };
    }),
  };
}

// ── Macierz oferty ──────────────────────────────────────────────────────────

export function parseOfferMatrix(raw: unknown): OfferMatrixDto {
  const r = reader("admin_revenue_offer_matrix");
  const root = r.bag(raw, "$");
  return {
    plans: r.list(root, "$", "plans").map((item, i) => {
      const path = `plans[${i}]`;
      const p = r.bag(item, path);
      return {
        planId: r.text(p, path, "plan_id"),
        tierKey: r.textOrNull(p, path, "tier_key"),
        interval: r.text(p, path, "interval"),
        priceCents: r.int(p, path, "price_cents"),
        currency: r.currency(p, path),
        active: r.bool(p, path, "active"),
        forSale: r.bool(p, path, "for_sale"),
        catalogPriceId: r.textOrNull(p, path, "catalog_price_id"),
        tierActive: r.boolOrNull(p, path, "tier_active"),
        pricingVisible: r.boolOrNull(p, path, "pricing_visible"),
        activeSubscriptions: r.intOrNull(p, path, "active_subscriptions"),
        issues: r.enumList(p, path, "issues", OFFER_PLAN_ISSUES),
      };
    }),
    tiers: r.list(root, "$", "tiers").map((item, i) => {
      const path = `tiers[${i}]`;
      const t = r.bag(item, path);
      return {
        key: r.text(t, path, "key"),
        rank: r.int(t, path, "rank", true),
        active: r.bool(t, path, "active"),
        pricingVisible: r.bool(t, path, "pricing_visible"),
        isDefault: r.bool(t, path, "is_default"),
        plansForSale: r.int(t, path, "plans_for_sale"),
        issues: r.enumList(t, path, "issues", OFFER_TIER_ISSUES),
      };
    }),
  };
}

// ── Dane wejściowe i ekonomika ──────────────────────────────────────────────

function inputRow(r: ReturnType<typeof reader>, raw: unknown, path: string): RevenueInputRow {
  const x = r.bag(raw, path);
  const currency = r.textOrNull(x, path, "currency");
  if (currency !== null && !/^[A-Z]{3}$/.test(currency))
    r.fail(`${path}.currency`, "oczekiwano kodu ISO 4217");
  return {
    id: r.text(x, path, "id"),
    periodMonth: r.day(x, path, "period_month"),
    kind: r.oneOf<RevenueInputKind>(x, path, "kind", REVENUE_INPUT_KINDS),
    segment: r.text(x, path, "segment"),
    currency,
    amountMinor: r.intOrNull(x, path, "amount_minor"),
    ratio: r.ratio(x, path, "ratio", { min: -1, max: 1 }),
    note: r.textOrNull(x, path, "note"),
    // Surowy napis z mikrosekundami - wraca do RPC jako token współbieżności;
    // `Date` obcięłoby go do milisekund i każdy zapis kończyłby się 40001.
    updatedAt: r.instant(x, path, "updated_at"),
    updatedBy: r.textOrNull(x, path, "updated_by"),
  };
}

export function parseRevenueInputs(raw: unknown): RevenueInputsDto {
  const r = reader("admin_revenue_inputs");
  const root = r.bag(raw, "$");
  return {
    fromMonth: r.day(root, "$", "from_month"),
    toMonth: r.day(root, "$", "to_month"),
    rows: r.list(root, "$", "rows").map((item, i) => inputRow(r, item, `rows[${i}]`)),
  };
}

const SAVE_OPS: readonly RevenueInputSaveResult["op"][] = ["insert", "update", "delete", "noop"];

export function parseRevenueInputSave(raw: unknown): RevenueInputSaveResult {
  const r = reader("admin_revenue_input_upsert");
  const root = r.bag(raw, "$");
  const op = r.oneOf(root, "$", "op", SAVE_OPS);
  if (!("row" in root)) r.fail("row", "brak pola");
  const row = root.row === null ? null : inputRow(r, root.row, "row");
  if ((op === "insert" || op === "update") && row === null) r.fail("row", "zapis bez wiersza");
  return { op, row };
}

function economicsMonth(r: ReturnType<typeof reader>, raw: unknown, path: string): EconomicsMonth {
  const m = r.bag(raw, path);
  return {
    month: r.day(m, path, "month"),
    currency: r.currency(m, path),
    mrrEndMinor: r.intOrNull(m, path, "mrr_end_minor", true),
    customersEnd: r.intOrNull(m, path, "customers_end"),
    arpaMinor: r.intOrNull(m, path, "arpa_minor", true),
    newCustomers: r.int(m, path, "new_customers"),
    logoChurnRate: r.ratio(m, path, "logo_churn_rate"),
    realizedNetMinor: r.intOrNull(m, path, "realized_net_minor", true),
    salesMarketingCostMinor: r.intOrNull(m, path, "sales_marketing_cost_minor"),
    cogsMinor: r.intOrNull(m, path, "cogs_minor"),
    grossMargin: r.ratio(m, path, "gross_margin", { min: -1, max: 1 }),
    ebitdaMargin: r.ratio(m, path, "ebitda_margin", { min: -1, max: 1 }),
    cacMinor: r.intOrNull(m, path, "cac_minor"),
    ltvMinor: r.intOrNull(m, path, "ltv_minor", true),
    ltvCacRatio: r.ratio(m, path, "ltv_cac_ratio", SIGNED),
    cacPaybackMonths: r.ratio(m, path, "cac_payback_months", UNBOUNDED_POSITIVE),
    mrrPlanMinor: r.intOrNull(m, path, "mrr_plan_minor"),
    planAttainment: r.ratio(m, path, "plan_attainment", SIGNED),
    newCustomersPlan: r.intOrNull(m, path, "new_customers_plan"),
    missing: r.enumList(m, path, "missing", REVENUE_INPUT_KINDS),
  };
}

export function parseEconomics(raw: unknown): EconomicsDto {
  const r = reader("admin_revenue_economics");
  const root = r.bag(raw, "$");
  if (!("rule_of_40" in root)) r.fail("rule_of_40", "brak pola");
  let ruleOf40: RuleOf40 | null = null;
  if (root.rule_of_40 !== null) {
    const x = r.bag(root.rule_of_40, "rule_of_40");
    const need = (key: string) =>
      r.ratio(x, "rule_of_40", key, SIGNED) ?? r.fail(`rule_of_40.${key}`, "null niedozwolony");
    ruleOf40 = {
      month: r.day(x, "rule_of_40", "month"),
      currency: r.currency(x, "rule_of_40"),
      growthYoy: need("growth_yoy"),
      ebitdaMargin: need("ebitda_margin"),
      value: need("value"),
    };
  }
  return {
    fromMonth: r.day(root, "$", "from_month"),
    toMonth: r.day(root, "$", "to_month"),
    timeZone: r.text(root, "$", "time_zone"),
    months: r.list(root, "$", "months").map((item, i) => economicsMonth(r, item, `months[${i}]`)),
    missing: r.enumList(root, "$", "missing", REVENUE_INPUT_KINDS),
    ruleOf40,
  };
}
