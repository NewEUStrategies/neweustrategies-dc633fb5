// JSONB `admin_revenue_funnel` -> `RevenueFunnelDto`, pole po polu.
//
// PARSER RZUCA, A NIE ZERUJE (jak `revenue/email/parse.ts`). Tu zero jest
// WYNIKIEM („0 porzuconych kas"), a `null` znaczy „nie da się policzyć" -
// parser, który zamienia brak albo śmieć w 0, zamazałby dokładnie tę różnicę.
// Zły kształt to rozjazd kontraktu SQL <-> TS, więc ma być głośny.
//
// Wyjątek świadomy: tor. Pola samoobsługi są w odpowiedzi tylko dla toru
// `self_serve|all`, a `sales` jest `null` dla `self_serve` - to kształt
// kontraktu, nie brak danych, więc parser czyta tor z odpowiedzi i wymaga
// dokładnie tych sekcji, które tor obiecuje.
//
// Moduł bez zależności runtime poza listami (liście bez importów): czyta go
// też migawka huba (S6) po stronie serwera, a test parytetu porównuje
// `FUNNEL_KEYS` z treścią migracji (`-- rpc-shape`).
import { PAYWALL_HIT_REASONS, type PaywallHitReason } from "@/lib/revenue/limits";
import { parseMoneyByCurrency } from "@/lib/revenue/money";
import {
  REVENUE_SEGMENTS,
  REVENUE_TRACKS,
  type RevenueSegment,
  type RevenueTrack,
} from "@/lib/revenue/search";
import type {
  RevenueFunnelDto,
  RevenueFunnelPaywallReason,
  RevenueFunnelSales,
  RevenueFunnelSelfServe,
  RevenueFunnelSignupSource,
} from "./dto";
import { SALES_FUNNEL_STAGES, isSignupSource, type SalesFunnelStage } from "./funnelStages";

// rpc-shape: admin_revenue_funnel
export const FUNNEL_KEYS = {
  root: ["since", "until", "segment", "track", "amounts_visible", "sales"],
  counts: [
    "accounts",
    "active_accounts",
    "paywall_hit_accounts",
    "paywall_hit_visitors",
    "paywall_hits",
    "paywall_converted_accounts",
    "checkout_started",
    "checkout_paid",
    "checkout_abandoned",
    "checkout_expired",
    "first_payments",
    "registered_paid",
    "signup_form_views",
    "signup_form_submits",
    "visitors_first_party",
  ],
  fractions: [
    "registered_to_paid_rate",
    "paywall_conversion_rate",
    "paywall_hit_rate",
    "checkout_conversion_rate",
    "checkout_abandonment_rate",
    "coupon_redemption_rate",
  ],
  lists: ["paid_amount", "signup_sources", "paywall_reasons", "paywall_data_since"],
  sales: ["stages", "open_tasks", "overdue_tasks", "done_tasks"],
} as const;

/** Rozjazd kontraktu RPC: ścieżka pola i powód. */
export class RevenueFunnelShapeError extends Error {
  readonly path: string;

  constructor(path: string, reason: string) {
    super(`admin_revenue_funnel: ${path} - ${reason}`);
    this.name = "RevenueFunnelShapeError";
    this.path = path;
  }
}

type Bag = Readonly<Record<string, unknown>>;

function isBag(value: unknown): value is Bag {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(path: string, reason: string): never {
  throw new RevenueFunnelShapeError(path, reason);
}

/**
 * Liczba całkowita >= 0. `count(*)` to `bigint`, który przy dużych wartościach
 * bywa napisem - napis cyfr przyjmujemy, każdy inny typ odrzucamy.
 */
function count(source: Bag, path: string, key: string): number {
  if (!(key in source)) fail(`${path}${key}`, "brak pola");
  const value = source[key];
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value.trim())
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    fail(`${path}${key}`, "oczekiwano liczby całkowitej >= 0");
  }
  return parsed;
}

/** Ułamek w [0, 1] albo `null`. Numeric z SQL bywa napisem - też przyjmujemy. */
function fraction(source: Bag, key: string): number | null {
  if (!(key in source)) fail(key, "brak pola");
  const value = source[key];
  if (value === null) return null;
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  // 1,7 w polu „udział" to nie 170 %, tylko procenty zamiast ułamka po
  // stronie SQL - odrzucamy głośno, zamiast pokazać bzdurę.
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    fail(key, "oczekiwano ułamka w [0, 1] albo null");
  }
  return parsed;
}

function instant(source: Bag, key: string, nullable: boolean): string | null {
  if (!(key in source)) fail(key, "brak pola");
  const value = source[key];
  if (value === null && nullable) return null;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    fail(key, "oczekiwano znacznika czasu ISO");
  }
  return value;
}

function oneOf<T extends string>(source: Bag, key: string, allowed: readonly T[]): T {
  const value = source[key];
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    fail(key, `oczekiwano jednej z: ${allowed.join(", ")}`);
  }
  return value as T;
}

function signupSources(raw: unknown): RevenueFunnelSignupSource[] {
  if (!Array.isArray(raw)) fail("signup_sources", "oczekiwano tablicy");
  return raw.map((entry, i) => {
    if (!isBag(entry) || !isSignupSource(entry.source)) {
      fail(`signup_sources[${i}].source`, "nieznane źródło rejestracji");
    }
    return { source: entry.source, accounts: count(entry, `signup_sources[${i}].`, "accounts") };
  });
}

function paywallReasons(raw: unknown): RevenueFunnelPaywallReason[] {
  if (!Array.isArray(raw)) fail("paywall_reasons", "oczekiwano tablicy");
  return raw.map((entry, i) => {
    const path = `paywall_reasons[${i}].`;
    if (!isBag(entry)) fail(path, "oczekiwano obiektu");
    if (!(PAYWALL_HIT_REASONS as readonly unknown[]).includes(entry.reason)) {
      fail(`${path}reason`, "nieznany powód uderzenia");
    }
    return {
      reason: entry.reason as PaywallHitReason,
      accounts: count(entry, path, "accounts"),
      visitors: count(entry, path, "visitors"),
      hits: count(entry, path, "hits"),
    };
  });
}

function selfServe(raw: Bag, amountsVisible: boolean): RevenueFunnelSelfServe {
  const c = (key: (typeof FUNNEL_KEYS.counts)[number]) => count(raw, "", key);
  if (!("paid_amount" in raw)) fail("paid_amount", "brak pola");
  // Kwoty: admin dostaje listę (także pustą - zmierzone zero), editor `null`.
  // Lista zdeformowana u admina to rozjazd kontraktu, nie „brak danych".
  const paidAmount = raw.paid_amount === null ? null : parseMoneyByCurrency(raw.paid_amount);
  if (raw.paid_amount !== null && paidAmount === null) {
    fail("paid_amount", "oczekiwano listy kwot per waluta");
  }
  return {
    accounts: c("accounts"),
    activeAccounts: c("active_accounts"),
    paywallHitAccounts: c("paywall_hit_accounts"),
    paywallHitVisitors: c("paywall_hit_visitors"),
    paywallHits: c("paywall_hits"),
    paywallConvertedAccounts: c("paywall_converted_accounts"),
    checkoutStarted: c("checkout_started"),
    checkoutPaid: c("checkout_paid"),
    checkoutAbandoned: c("checkout_abandoned"),
    checkoutExpired: c("checkout_expired"),
    firstPayments: c("first_payments"),
    registeredPaid: c("registered_paid"),
    signupFormViews: c("signup_form_views"),
    signupFormSubmits: c("signup_form_submits"),
    visitorsFirstParty: c("visitors_first_party"),
    rates: {
      registeredToPaid: fraction(raw, "registered_to_paid_rate"),
      paywallConversion: fraction(raw, "paywall_conversion_rate"),
      paywallHit: fraction(raw, "paywall_hit_rate"),
      checkoutConversion: fraction(raw, "checkout_conversion_rate"),
      checkoutAbandonment: fraction(raw, "checkout_abandonment_rate"),
      couponRedemption: fraction(raw, "coupon_redemption_rate"),
    },
    paidAmount: amountsVisible ? paidAmount : null,
    signupSources: signupSources(raw.signup_sources),
    paywallReasons: paywallReasons(raw.paywall_reasons),
    paywallDataSince: instant(raw, "paywall_data_since", true),
  };
}

function sales(raw: unknown): RevenueFunnelSales {
  if (!isBag(raw)) fail("sales", "oczekiwano obiektu");
  if (!Array.isArray(raw.stages)) fail("sales.stages", "oczekiwano tablicy");
  const stages = raw.stages.map((entry, i) => {
    const path = `sales.stages[${i}].`;
    if (!isBag(entry) || !(SALES_FUNNEL_STAGES as readonly unknown[]).includes(entry.stage)) {
      fail(`${path}stage`, "nieznany etap toru sprzedaży");
    }
    return { stage: entry.stage as SalesFunnelStage, leads: count(entry, path, "leads") };
  });
  return {
    stages,
    openTasks: count(raw, "sales.", "open_tasks"),
    overdueTasks: count(raw, "sales.", "overdue_tasks"),
    doneTasks: count(raw, "sales.", "done_tasks"),
  };
}

/** Parser wyniku RPC; rzuca `RevenueFunnelShapeError` przy złym kształcie. */
export function parseRevenueFunnel(raw: unknown): RevenueFunnelDto {
  if (!isBag(raw)) fail("$", "oczekiwano obiektu");
  const track: RevenueTrack = oneOf(raw, "track", REVENUE_TRACKS);
  const segment: RevenueSegment = oneOf(raw, "segment", REVENUE_SEGMENTS);
  if (typeof raw.amounts_visible !== "boolean") fail("amounts_visible", "oczekiwano boolean");
  const amountsVisible = raw.amounts_visible;
  const wantsSelf = track !== "sales";
  const wantsSales = track !== "self_serve";
  if (!("sales" in raw)) fail("sales", "brak pola");
  if (!wantsSales && raw.sales !== null) fail("sales", "tor self_serve nie niesie sprzedaży");
  return {
    since: instant(raw, "since", false) as string,
    until: instant(raw, "until", false) as string,
    segment,
    track,
    amountsVisible,
    selfServe: wantsSelf ? selfServe(raw, amountsVisible) : null,
    sales: wantsSales ? sales(raw.sales) : null,
  };
}
