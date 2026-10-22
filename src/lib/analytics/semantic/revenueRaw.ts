/**
 * SUROWE ODPOWIEDZI RPC HUBA „PRZYCHÓD I LEJEK” - kontrakt kształtu i parsery.
 *
 * `getRevenueSnapshot` czyta pięć funkcji SQL, które powstają w INNYCH
 * wycinkach (S1-S4): migawkę przychodu, lejek, wydarzenia, kluby i zdrowie
 * newslettera. Ten plik jest jedynym miejscem, które wie, jak wygląda ich jsonb:
 * stałe `*_KEYS` (z komentarzem `// rpc-shape: <funkcja>`) są KONTRAKTEM
 * dla autorów SQL (Z-S6-05), a parsery czytają odpowiedź defensywnie.
 *
 * REGUŁY, KTÓRYCH TO PILNUJE:
 *  - `null` ≠ 0. Brak klucza, zły typ albo wartość spoza dziedziny to `null`
 *    („nie wiemy”), nigdy zero („zmierzyliśmy nic”). Kwota `[]` to zmierzone
 *    zero, kwota `null` - brak danych (jak `parseMoneyByCurrency`).
 *  - Rozjazd kształtu to BRAK DANYCH, nie błąd: RPC dopisane później albo
 *    w starszej wersji nie wywraca panelu, tylko gasi swoje pola.
 *  - Ułamki w [0, 1]. Wskaźnik 1,7 w polu „udział” to nie 170 %, tylko błąd
 *    jednostki po stronie SQL (procenty zamiast ułamka) - odrzucamy go.
 *  - Kwoty per waluta, NIGDY suma (`MoneyByCurrency[]`).
 *  - Iloraz liczony tutaj bierze licznik i mianownik z JEDNEJ odpowiedzi,
 *    czyli z jednego strumienia (polityka `assertSameStreamRatio`).
 *
 * Moduł czysty: zero I/O, jedyny import wartości to parser kwot.
 */
import { type MoneyByCurrency, parseMoneyByCurrency } from "@/lib/revenue/money";
import type { MetricId } from "./metrics";
import type { StreamObservation } from "./reconcile";

// ---------------------------------------------------------------------------
// Kontrakt kształtu (Z-S6-05) - klucze jsonb w snake_case, jak kolumny SQL
// ---------------------------------------------------------------------------

// rpc-shape: admin_revenue_semantic_snapshot
export const REVENUE_SNAPSHOT_KEYS = {
  /** Metadane pochodzenia liczb (nagłówek huba, `ProvenanceNote`). */
  meta: ["data_since", "computed_at", "basis_mix"],
  /** `basis_mix` - udziały podstawy kwot: od dostawcy płatności vs katalogowa. */
  basisMix: ["provider", "catalog"],
  /** Kwoty `MoneyByCurrency[]` (`[{ currency, amount_minor }]`). */
  money: [
    "mrr",
    "arr",
    "arpa",
    "arpu",
    "net_new_mrr",
    "mrr_start",
    "mrr_end",
    "revenue_realized",
    "revenue_realized_orders",
  ],
  /** `movements` - ruchy MRR w oknie, każdy jako `MoneyByCurrency[]`. */
  movements: ["new", "expansion", "reactivation", "contraction", "churn"],
  /** Liczności (nieujemne liczby całkowite). */
  counts: ["active_subscriptions", "active_customers", "customers_start", "customers_churned"],
  /** Ułamki w [0, 1]. */
  fractions: [
    "expansion_share_new_mrr",
    "annual_plan_share",
    "gross_revenue_churn",
    "gross_revenue_retention",
    "involuntary_churn_share",
    "dunning_recovery_rate",
    "winback_rate_12m",
    "returning_subscriber_share",
    "cohort_retention_m1",
    "cohort_retention_m3",
    "cohort_retention_m12",
    "trial_to_paid_rate",
    "average_discount",
  ],
  /** Ilorazy nieujemne bez górnej granicy (NRR > 100 %, QR > 1, cena ponad katalog). */
  nonNegative: ["net_revenue_retention", "saas_quick_ratio", "price_realization"],
  /** Wartości ze znakiem (spadek MRR jest ujemny). */
  signed: ["mrr_growth_mom"],
} as const;

// rpc-shape: admin_revenue_funnel
export const REVENUE_FUNNEL_KEYS = {
  counts: [
    "accounts",
    "paywall_hit_accounts",
    "active_accounts",
    "checkout_started",
    "checkout_paid",
    "checkout_abandoned",
    "first_payments",
    "signup_form_views",
    "signup_form_submits",
  ],
  fractions: [
    "registered_to_paid_rate",
    "paywall_conversion_rate",
    "paywall_hit_rate",
    "checkout_conversion_rate",
    "checkout_abandonment_rate",
    "coupon_redemption_rate",
  ],
  /**
   * Odwiedzający anonimowi z `first_party` - INNY strumień (zgoda analityczna),
   * pokazywany obok lejka jako osobna liczba, nigdy jako mianownik.
   */
  separate: ["visitors_first_party"],
} as const;

// rpc-shape: admin_revenue_events_summary
export const REVENUE_EVENTS_KEYS = {
  /** `by_currency` - `[{ currency, ticket_revenue_net_minor }]`; `null` dla editora. */
  money: ["by_currency"],
  byCurrency: ["currency", "ticket_revenue_net_minor"],
  counts: ["registrations", "paid", "attended", "no_show"],
} as const;

// rpc-shape: admin_revenue_clubs_summary
export const REVENUE_CLUBS_KEYS = {
  counts: ["members", "active_members", "contributors"],
  /** `applications` - zgłoszenia rozpatrywane w oknie, po statusach. */
  applications: ["submitted", "accepted", "rejected"],
  /** Mediana godzin od zgłoszenia do decyzji (nieujemna, ułamkowa). */
  hours: ["decision_hours_median"],
} as const;

// rpc-shape: admin_revenue_email_health
export const REVENUE_EMAIL_KEYS = {
  counts: [
    "delivered",
    "unique_opens",
    "unique_clicks",
    "hard_bounces",
    "soft_bounces",
    "complaints",
    "unsubscribes",
    "list_base",
    "doi_started",
    "doi_confirmed",
  ],
  /** Wzrost listy netto - ujemny, gdy lista się skurczyła. */
  signed: ["list_net_growth"],
} as const;

/** Unia kluczy jednej grupy kontraktu - typy niżej idą z list, nie z kopii. */
type KeysOf<T extends readonly string[]> = T[number];

// ---------------------------------------------------------------------------
// Typy po parsowaniu - camelCase po naszej stronie granicy
// ---------------------------------------------------------------------------

export interface RawRevenueSnapshot {
  /** `YYYY-MM-DD` albo instant ISO - pierwszy dzień księgi. */
  readonly dataSince: string | null;
  readonly computedAt: string | null;
  readonly basisMix: { readonly provider: number; readonly catalog: number } | null;
  readonly money: Readonly<
    Record<KeysOf<typeof REVENUE_SNAPSHOT_KEYS.money>, MoneyByCurrency[] | null>
  >;
  readonly movements: Readonly<
    Record<KeysOf<typeof REVENUE_SNAPSHOT_KEYS.movements>, MoneyByCurrency[] | null>
  > | null;
  readonly counts: Readonly<Record<KeysOf<typeof REVENUE_SNAPSHOT_KEYS.counts>, number | null>>;
  readonly rates: Readonly<
    Record<
      | KeysOf<typeof REVENUE_SNAPSHOT_KEYS.fractions>
      | KeysOf<typeof REVENUE_SNAPSHOT_KEYS.nonNegative>
      | KeysOf<typeof REVENUE_SNAPSHOT_KEYS.signed>,
      number | null
    >
  >;
}

export interface RawRevenueFunnel {
  readonly counts: Readonly<Record<KeysOf<typeof REVENUE_FUNNEL_KEYS.counts>, number | null>>;
  readonly rates: Readonly<Record<KeysOf<typeof REVENUE_FUNNEL_KEYS.fractions>, number | null>>;
  readonly visitorsFirstParty: number | null;
}

export interface RawRevenueEvents {
  /** `null` = brak kwot (rola bez dostępu albo kształt zły); `[]` = zero sprzedaży. */
  readonly ticketRevenue: MoneyByCurrency[] | null;
  readonly counts: Readonly<Record<KeysOf<typeof REVENUE_EVENTS_KEYS.counts>, number | null>>;
}

export interface RawRevenueClubs {
  readonly counts: Readonly<Record<KeysOf<typeof REVENUE_CLUBS_KEYS.counts>, number | null>>;
  readonly applications: Readonly<
    Record<KeysOf<typeof REVENUE_CLUBS_KEYS.applications>, number | null>
  > | null;
  readonly decisionHoursMedian: number | null;
}

export interface RawRevenueEmailHealth {
  readonly counts: Readonly<Record<KeysOf<typeof REVENUE_EMAIL_KEYS.counts>, number | null>>;
  readonly listNetGrowth: number | null;
}

/** Komplet odczytów jednego okna + to, czego parsery nie wiedzą o oknie. */
export interface RevenueRawBundle {
  /** `null` = nie czytano (editor), RPC padło albo kształt był zły. */
  readonly snapshot: RawRevenueSnapshot | null;
  readonly funnel: RawRevenueFunnel | null;
  readonly events: RawRevenueEvents | null;
  readonly clubs: RawRevenueClubs | null;
  readonly email: RawRevenueEmailHealth | null;
  /**
   * Okno: długość w dobach (do przeliczenia churnu na miesiąc) i to, czy jest
   * 12 pełnymi miesiącami (tylko wtedy istnieje churn ROCZNY).
   */
  readonly window: { readonly days: number; readonly annual: boolean };
  /** Waluta wiodąca wybrana filtrem; bez filtra - pierwsza pozycja listy. */
  readonly currency?: string;
}

// ---------------------------------------------------------------------------
// Czytniki pól (wzór `num()`/`isRecord` z `snapshot.functions.ts`)
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Liczba albo `null`. Napis liczbowy jest liczbą: Postgres oddaje `bigint`
 * i `numeric` w jsonb jako napis, a to nadal zmierzona wartość. Pusty napis
 * i `true` to nie liczby.
 */
function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Liczność: nieujemna liczba całkowita w zakresie bezpiecznym. */
function count(v: unknown): number | null {
  const n = num(v);
  return n !== null && n >= 0 && Number.isSafeInteger(n) ? n : null;
}

/** Ułamek w [0, 1] - inaczej błąd jednostki po stronie SQL. */
function fraction(v: unknown): number | null {
  const n = num(v);
  return n !== null && n >= 0 && n <= 1 ? n : null;
}

function nonNegative(v: unknown): number | null {
  const n = num(v);
  return n !== null && n >= 0 ? n : null;
}

function signedInt(v: unknown): number | null {
  const n = num(v);
  return n !== null && Number.isSafeInteger(n) ? n : null;
}

/** Napis daty/instantu, który `Date.parse` rozumie; reszta to `null`. */
function isoText(v: unknown): string | null {
  return typeof v === "string" && Number.isFinite(Date.parse(v)) ? v : null;
}

// ---------------------------------------------------------------------------
// Parsery - wynik `null` wyłącznie, gdy odpowiedź w ogóle nie jest obiektem
// ---------------------------------------------------------------------------

// Pola wypisane JAWNIE, nie pętlą po `*_KEYS`: rekord złożony w pętli wymaga
// rzutowania (`{} as Record<…>`), a jawny literał typ sprawdza w całości.
// Zgodność z kontraktem `*_KEYS` przypina test (`snapshot.functions.test.ts`).

/** Kwoty jednego obiektu jsonb - każde pole osobno, zły kształt gasi tylko je. */
function moneyOf(raw: Record<string, unknown>, key: string): MoneyByCurrency[] | null {
  return parseMoneyByCurrency(raw[key]);
}

export function parseRevenueSemanticSnapshot(raw: unknown): RawRevenueSnapshot | null {
  if (!isRecord(raw)) return null;
  const mix = raw.basis_mix;
  const provider = isRecord(mix) ? nonNegative(mix.provider) : null;
  const catalog = isRecord(mix) ? nonNegative(mix.catalog) : null;
  const mv = raw.movements;
  return {
    dataSince: isoText(raw.data_since),
    computedAt: isoText(raw.computed_at),
    // Połowa pary to nie proporcja - albo obie liczby, albo nic.
    basisMix: provider !== null && catalog !== null ? { provider, catalog } : null,
    money: {
      mrr: moneyOf(raw, "mrr"),
      arr: moneyOf(raw, "arr"),
      arpa: moneyOf(raw, "arpa"),
      arpu: moneyOf(raw, "arpu"),
      net_new_mrr: moneyOf(raw, "net_new_mrr"),
      mrr_start: moneyOf(raw, "mrr_start"),
      mrr_end: moneyOf(raw, "mrr_end"),
      revenue_realized: moneyOf(raw, "revenue_realized"),
      revenue_realized_orders: moneyOf(raw, "revenue_realized_orders"),
    },
    movements: isRecord(mv)
      ? {
          new: moneyOf(mv, "new"),
          expansion: moneyOf(mv, "expansion"),
          reactivation: moneyOf(mv, "reactivation"),
          contraction: moneyOf(mv, "contraction"),
          churn: moneyOf(mv, "churn"),
        }
      : null,
    counts: {
      active_subscriptions: count(raw.active_subscriptions),
      active_customers: count(raw.active_customers),
      customers_start: count(raw.customers_start),
      customers_churned: count(raw.customers_churned),
    },
    rates: {
      expansion_share_new_mrr: fraction(raw.expansion_share_new_mrr),
      annual_plan_share: fraction(raw.annual_plan_share),
      gross_revenue_churn: fraction(raw.gross_revenue_churn),
      gross_revenue_retention: fraction(raw.gross_revenue_retention),
      involuntary_churn_share: fraction(raw.involuntary_churn_share),
      dunning_recovery_rate: fraction(raw.dunning_recovery_rate),
      winback_rate_12m: fraction(raw.winback_rate_12m),
      returning_subscriber_share: fraction(raw.returning_subscriber_share),
      cohort_retention_m1: fraction(raw.cohort_retention_m1),
      cohort_retention_m3: fraction(raw.cohort_retention_m3),
      cohort_retention_m12: fraction(raw.cohort_retention_m12),
      trial_to_paid_rate: fraction(raw.trial_to_paid_rate),
      average_discount: fraction(raw.average_discount),
      net_revenue_retention: nonNegative(raw.net_revenue_retention),
      saas_quick_ratio: nonNegative(raw.saas_quick_ratio),
      price_realization: nonNegative(raw.price_realization),
      mrr_growth_mom: num(raw.mrr_growth_mom),
    },
  };
}

export function parseRevenueFunnel(raw: unknown): RawRevenueFunnel | null {
  if (!isRecord(raw)) return null;
  return {
    counts: {
      accounts: count(raw.accounts),
      paywall_hit_accounts: count(raw.paywall_hit_accounts),
      active_accounts: count(raw.active_accounts),
      checkout_started: count(raw.checkout_started),
      checkout_paid: count(raw.checkout_paid),
      checkout_abandoned: count(raw.checkout_abandoned),
      first_payments: count(raw.first_payments),
      signup_form_views: count(raw.signup_form_views),
      signup_form_submits: count(raw.signup_form_submits),
    },
    rates: {
      registered_to_paid_rate: fraction(raw.registered_to_paid_rate),
      paywall_conversion_rate: fraction(raw.paywall_conversion_rate),
      paywall_hit_rate: fraction(raw.paywall_hit_rate),
      checkout_conversion_rate: fraction(raw.checkout_conversion_rate),
      checkout_abandonment_rate: fraction(raw.checkout_abandonment_rate),
      coupon_redemption_rate: fraction(raw.coupon_redemption_rate),
    },
    visitorsFirstParty: count(raw.visitors_first_party),
  };
}

export function parseRevenueEventsSummary(raw: unknown): RawRevenueEvents | null {
  if (!isRecord(raw)) return null;
  // Kolumna SQL nazywa kwotę `ticket_revenue_net_minor`; parser kwot zna
  // `amount_minor`. Przemianowanie TUTAJ, żeby reguły kwot (waluta ISO,
  // liczba całkowita, łączenie tej samej waluty) zostały w jednym miejscu.
  const byCurrency = raw.by_currency;
  const ticketRevenue = Array.isArray(byCurrency)
    ? parseMoneyByCurrency(
        byCurrency.map((entry: unknown) =>
          isRecord(entry)
            ? { currency: entry.currency, amount_minor: entry.ticket_revenue_net_minor }
            : entry,
        ),
      )
    : null;
  return {
    ticketRevenue,
    counts: {
      registrations: count(raw.registrations),
      paid: count(raw.paid),
      attended: count(raw.attended),
      no_show: count(raw.no_show),
    },
  };
}

export function parseRevenueClubsSummary(raw: unknown): RawRevenueClubs | null {
  if (!isRecord(raw)) return null;
  const apps = raw.applications;
  return {
    counts: {
      members: count(raw.members),
      active_members: count(raw.active_members),
      contributors: count(raw.contributors),
    },
    applications: isRecord(apps)
      ? {
          submitted: count(apps.submitted),
          accepted: count(apps.accepted),
          rejected: count(apps.rejected),
        }
      : null,
    decisionHoursMedian: nonNegative(raw.decision_hours_median),
  };
}

/**
 * Adapter kształtu S1 (I9, Z-S7-10 / Z-S6-17 / Z-S1-01). Funkcja
 * `admin_revenue_email_health` (S1, `EMAIL_HEALTH_KEYS`) oddaje grupy
 * zagnieżdżone - `campaigns.*`, `list.{start,net_growth}`,
 * `doi.{started,confirmed_7d}` - a kontrakt migawki (`REVENUE_EMAIL_KEYS`)
 * jest płaski. Bez spłaszczenia tolerancyjny parser dałby ciche „brak danych"
 * dla każdej liczby. Odpowiedź już płaska przechodzi bez zmian.
 */
function flattenEmailHealth(raw: Record<string, unknown>): Record<string, unknown> {
  const { campaigns, list, doi } = raw;
  if (!isRecord(campaigns) && !isRecord(list) && !isRecord(doi)) return raw;
  const c = isRecord(campaigns) ? campaigns : {};
  const l = isRecord(list) ? list : {};
  const d = isRecord(doi) ? doi : {};
  return {
    delivered: c.delivered,
    unique_opens: c.unique_opens,
    unique_clicks: c.unique_clicks,
    hard_bounces: c.hard_bounces,
    soft_bounces: c.soft_bounces,
    complaints: c.complaints,
    unsubscribes: c.unsubscribes,
    list_base: l.start,
    list_net_growth: l.net_growth,
    doi_started: d.started,
    doi_confirmed: d.confirmed_7d,
  };
}

export function parseRevenueEmailHealth(input: unknown): RawRevenueEmailHealth | null {
  if (!isRecord(input)) return null;
  const raw = flattenEmailHealth(input);
  return {
    counts: {
      delivered: count(raw.delivered),
      unique_opens: count(raw.unique_opens),
      unique_clicks: count(raw.unique_clicks),
      hard_bounces: count(raw.hard_bounces),
      soft_bounces: count(raw.soft_bounces),
      complaints: count(raw.complaints),
      unsubscribes: count(raw.unsubscribes),
      list_base: count(raw.list_base),
      doi_started: count(raw.doi_started),
      doi_confirmed: count(raw.doi_confirmed),
    },
    listNetGrowth: signedInt(raw.list_net_growth),
  };
}

// ---------------------------------------------------------------------------
// Ilorazy w obrębie jednej odpowiedzi
// ---------------------------------------------------------------------------

export interface RevenueRatio {
  readonly metricId: MetricId;
  readonly value: number | null;
  /** Powód braku wartości - opis techniczny, jak w `safeRatio`. */
  readonly reason?: string;
}

const NO_BASE = "numerator or denominator unavailable";
const ZERO_BASE = "denominator is zero";

/** Iloraz z jednej odpowiedzi: mianownik zerowy albo brakujący daje `null` z powodem. */
function ratio(metricId: MetricId, n: number | null, d: number | null): RevenueRatio {
  if (n === null || d === null) return { metricId, value: null, reason: NO_BASE };
  if (d <= 0) return { metricId, value: null, reason: ZERO_BASE };
  return { metricId, value: n / d };
}

/** Suma liczności - `null`, gdy brakuje którejkolwiek (brak nie jest zerem). */
function sum(...values: readonly (number | null)[]): number | null {
  let total = 0;
  for (const v of values) {
    if (v === null) return null;
    total += v;
  }
  return total;
}

/** Średnia długość miesiąca kalendarzowego w dobach (365,25 / 12). */
const DAYS_PER_MONTH = 30.4375;

/**
 * Churn z okna przeliczony GEOMETRYCZNIE na miesiąc: 1 − (1 − c)^(30,4375 / D).
 * Nie liniowo (c / D × 30): churn kwartalny 30 % to ~11,2 % miesięcznie,
 * a nie 10 % - liniowe dzielenie zaniża churn każdego dłuższego okna.
 */
function monthlyChurn(windowRate: number, days: number): number | null {
  if (!(days > 0)) return null;
  if (windowRate >= 1) return 1;
  return 1 - (1 - windowRate) ** (DAYS_PER_MONTH / days);
}

/**
 * Ilorazy, które liczy TS (SQL oddaje liczności). Każdy z JEDNEJ odpowiedzi,
 * więc z jednego strumienia. Kolejność = kolejność rejestru.
 */
export function revenueRatios(input: RevenueRawBundle): readonly RevenueRatio[] {
  const s = input.snapshot?.counts;
  const f = input.funnel?.counts;
  const e = input.email?.counts;
  const ev = input.events?.counts;
  const c = input.clubs;

  const churn = ratio(
    "logo_churn_monthly",
    s?.customers_churned ?? null,
    s?.customers_start ?? null,
  );
  const monthly: RevenueRatio =
    churn.value === null
      ? churn
      : {
          metricId: "logo_churn_monthly",
          value: monthlyChurn(churn.value, input.window.days),
        };
  // Churn roczny istnieje wyłącznie na 12 pełnych miesiącach - na innym oknie
  // „roczny” byłby przeskalowaną zgadywanką, nie pomiarem.
  const annual: RevenueRatio = input.window.annual
    ? { ...churn, metricId: "logo_churn_annual" }
    : { metricId: "logo_churn_annual", value: null, reason: "window is not twelve full months" };

  const sent = sum(e?.delivered ?? null, e?.hard_bounces ?? null, e?.soft_bounces ?? null);
  const negative = sum(
    e?.unsubscribes ?? null,
    e?.complaints ?? null,
    e?.hard_bounces ?? null,
    e?.soft_bounces ?? null,
  );
  const decided = sum(c?.applications?.accepted ?? null, c?.applications?.rejected ?? null);

  return [
    monthly,
    annual,
    ratio(
      "signup_form_conversion_rate",
      f?.signup_form_submits ?? null,
      f?.signup_form_views ?? null,
    ),
    ratio("email_open_rate", e?.unique_opens ?? null, e?.delivered ?? null),
    ratio("email_ctr_delivered", e?.unique_clicks ?? null, e?.delivered ?? null),
    ratio("email_unsubscribe_rate", e?.unsubscribes ?? null, e?.delivered ?? null),
    ratio("email_hard_bounce_rate", e?.hard_bounces ?? null, sent),
    ratio("email_soft_bounce_rate", e?.soft_bounces ?? null, sent),
    ratio("email_spam_complaint_rate", e?.complaints ?? null, e?.delivered ?? null),
    ratio("newsletter_list_growth_rate", input.email?.listNetGrowth ?? null, e?.list_base ?? null),
    ratio("doi_confirmation_rate", e?.doi_confirmed ?? null, e?.doi_started ?? null),
    ratio("email_disaffection_rate", negative, e?.unique_clicks ?? null),
    ratio("event_attendance_rate", ev?.attended ?? null, ev?.registrations ?? null),
    ratio("no_show_rate", ev?.no_show ?? null, ev?.registrations ?? null),
    ratio("club_application_acceptance", c?.applications?.accepted ?? null, decided),
    ratio("club_active_member_rate", c?.counts.active_members ?? null, c?.counts.members ?? null),
    ratio(
      "club_contributor_rate",
      c?.counts.contributors ?? null,
      c?.counts.active_members ?? null,
    ),
  ];
}

// ---------------------------------------------------------------------------
// Kwoty i obserwacje
// ---------------------------------------------------------------------------

/**
 * Pełne listy kwot per metryka pieniężna - DTO niesie je OBOK liczby
 * kanonicznej, bo ta jest kwotą tylko w walucie wiodącej. Brak listy
 * (`null`) = brak klucza w wyniku, nie pusta lista.
 */
export function revenueMoney(
  input: RevenueRawBundle,
): Partial<Record<MetricId, MoneyByCurrency[]>> {
  const out: Partial<Record<MetricId, MoneyByCurrency[]>> = {};
  const money = input.snapshot?.money;
  const put = (id: MetricId, list: MoneyByCurrency[] | null | undefined) => {
    if (list) out[id] = list;
  };
  put("mrr", money?.mrr);
  put("arr", money?.arr);
  put("arpa", money?.arpa);
  put("arpu", money?.arpu);
  put("net_new_mrr", money?.net_new_mrr);
  put("revenue_realized", money?.revenue_realized);
  put("event_ticket_revenue", input.events?.ticketRevenue);
  return out;
}

/**
 * Waluta wiodąca: filtr, a bez niego pierwsza pozycja listy AUTORYTATYWNEJ
 * (serwer porządkuje waluty - wiodąca pierwsza). Pusta lista bez filtra nie
 * ma waluty wiodącej.
 */
function leadingCurrency(
  list: readonly MoneyByCurrency[] | null,
  preferred: string | undefined,
): string | null {
  if (preferred) return preferred;
  return list?.[0]?.currency ?? null;
}

/**
 * Kwota w walucie wiodącej. Zmierzona lista BEZ tej waluty to zero w tej
 * walucie (zmierzyliśmy - nie było sprzedaży), lista `null` to brak danych.
 */
function amountIn(list: readonly MoneyByCurrency[] | null, currency: string | null): number | null {
  if (list === null || currency === null) return null;
  return list.find((m) => m.currency === currency)?.amountMinor ?? 0;
}

/**
 * Metryki, które migawka przychodu UMIE policzyć z pięciu odczytów - w
 * kolejności rejestru (SPEC §5.5). Reszta metryk huba ma własne źródła
 * (ekonomika, ścieżki, CRM, pierwsza strona) i nie udaje tu „braku wartości”.
 */
export const REVENUE_SNAPSHOT_METRICS = [
  "mrr",
  "arr",
  "arpa",
  "arpu",
  "active_subscriptions",
  "mrr_growth_mom",
  "net_new_mrr",
  "saas_quick_ratio",
  "expansion_share_new_mrr",
  "annual_plan_share",
  "revenue_realized",
  "price_realization",
  "average_discount",
  "coupon_redemption_rate",
  "logo_churn_monthly",
  "logo_churn_annual",
  "gross_revenue_churn",
  "net_revenue_retention",
  "gross_revenue_retention",
  "involuntary_churn_share",
  "dunning_recovery_rate",
  "winback_rate_12m",
  "returning_subscriber_share",
  "cohort_retention_m1",
  "cohort_retention_m3",
  "cohort_retention_m12",
  "registered_to_paid_rate",
  "paywall_conversion_rate",
  "paywall_hit_rate",
  "trial_to_paid_rate",
  "checkout_conversion_rate",
  "checkout_abandonment_rate",
  "signup_form_conversion_rate",
  "email_open_rate",
  "email_ctr_delivered",
  "email_unsubscribe_rate",
  "email_hard_bounce_rate",
  "email_soft_bounce_rate",
  "email_spam_complaint_rate",
  "newsletter_list_growth_rate",
  "doi_confirmation_rate",
  "email_disaffection_rate",
  "event_ticket_revenue",
  "event_attendance_rate",
  "no_show_rate",
  "club_application_acceptance",
  "club_decision_time",
  "club_active_member_rate",
  "club_contributor_rate",
] as const satisfies readonly MetricId[];

export type RevenueSnapshotMetricId = (typeof REVENUE_SNAPSHOT_METRICS)[number];

/**
 * Obserwacje per metryka, podpisane strumieniem - wejście `reconcileAll`.
 * Kolejność = `REVENUE_SNAPSHOT_METRICS`. Metryka pieniężna niesie kwotę
 * w walucie wiodącej; obserwacja potwierdzająca przychodu (zamówienia) -
 * w TEJ SAMEJ walucie, inaczej uzgodnienie porównywałoby złotówki z euro.
 */
export function revenueObservations(
  input: RevenueRawBundle,
): ReadonlyArray<{ metricId: MetricId; observations: readonly StreamObservation[] }> {
  const snap = input.snapshot;
  const money = snap?.money;
  const rates = snap?.rates;
  const counts = snap?.counts;
  const funnel = input.funnel?.rates;
  const derived = new Map(revenueRatios(input).map((r) => [r.metricId, r.value]));

  const billingMoney = (list: MoneyByCurrency[] | null | undefined): StreamObservation => {
    const l = list ?? null;
    return { streamId: "billing", value: amountIn(l, leadingCurrency(l, input.currency)) };
  };
  const billing = (value: number | null | undefined): StreamObservation => ({
    streamId: "billing",
    value: value ?? null,
  });
  const lifecycle = (value: number | null | undefined): StreamObservation => ({
    streamId: "lifecycle",
    value: value ?? null,
  });
  const newsletter = (id: MetricId): StreamObservation => ({
    streamId: "newsletter",
    value: derived.get(id) ?? null,
  });
  const community = (value: number | null | undefined): StreamObservation => ({
    streamId: "community",
    value: value ?? null,
  });

  const realized = money?.revenue_realized ?? null;
  const realizedCurrency = leadingCurrency(
    realized ?? money?.revenue_realized_orders ?? null,
    input.currency,
  );
  const tickets = input.events?.ticketRevenue ?? null;

  // Rekord WYCZERPUJĄCY po liście metryk migawki: nowa pozycja na liście bez
  // obserwacji nie skompiluje się, zamiast cicho zwrócić „brak wartości”.
  const byMetric: Readonly<Record<RevenueSnapshotMetricId, readonly StreamObservation[]>> = {
    mrr: [billingMoney(money?.mrr)],
    arr: [billingMoney(money?.arr)],
    arpa: [billingMoney(money?.arpa)],
    arpu: [billingMoney(money?.arpu)],
    active_subscriptions: [billing(counts?.active_subscriptions)],
    mrr_growth_mom: [billing(rates?.mrr_growth_mom)],
    net_new_mrr: [billingMoney(money?.net_new_mrr)],
    saas_quick_ratio: [billing(rates?.saas_quick_ratio)],
    expansion_share_new_mrr: [billing(rates?.expansion_share_new_mrr)],
    annual_plan_share: [billing(rates?.annual_plan_share)],
    revenue_realized: [
      { streamId: "billing", value: amountIn(realized, realizedCurrency) },
      {
        streamId: "lifecycle",
        value: amountIn(money?.revenue_realized_orders ?? null, realizedCurrency),
      },
    ],
    price_realization: [billing(rates?.price_realization)],
    average_discount: [billing(rates?.average_discount)],
    coupon_redemption_rate: [lifecycle(funnel?.coupon_redemption_rate)],
    logo_churn_monthly: [billing(derived.get("logo_churn_monthly"))],
    logo_churn_annual: [billing(derived.get("logo_churn_annual"))],
    gross_revenue_churn: [billing(rates?.gross_revenue_churn)],
    net_revenue_retention: [billing(rates?.net_revenue_retention)],
    gross_revenue_retention: [billing(rates?.gross_revenue_retention)],
    involuntary_churn_share: [billing(rates?.involuntary_churn_share)],
    dunning_recovery_rate: [billing(rates?.dunning_recovery_rate)],
    winback_rate_12m: [billing(rates?.winback_rate_12m)],
    returning_subscriber_share: [billing(rates?.returning_subscriber_share)],
    cohort_retention_m1: [billing(rates?.cohort_retention_m1)],
    cohort_retention_m3: [billing(rates?.cohort_retention_m3)],
    cohort_retention_m12: [billing(rates?.cohort_retention_m12)],
    registered_to_paid_rate: [lifecycle(funnel?.registered_to_paid_rate)],
    paywall_conversion_rate: [lifecycle(funnel?.paywall_conversion_rate)],
    paywall_hit_rate: [lifecycle(funnel?.paywall_hit_rate)],
    trial_to_paid_rate: [billing(rates?.trial_to_paid_rate)],
    checkout_conversion_rate: [lifecycle(funnel?.checkout_conversion_rate)],
    checkout_abandonment_rate: [lifecycle(funnel?.checkout_abandonment_rate)],
    signup_form_conversion_rate: [lifecycle(derived.get("signup_form_conversion_rate"))],
    email_open_rate: [newsletter("email_open_rate")],
    email_ctr_delivered: [newsletter("email_ctr_delivered")],
    email_unsubscribe_rate: [newsletter("email_unsubscribe_rate")],
    email_hard_bounce_rate: [newsletter("email_hard_bounce_rate")],
    email_soft_bounce_rate: [newsletter("email_soft_bounce_rate")],
    email_spam_complaint_rate: [newsletter("email_spam_complaint_rate")],
    newsletter_list_growth_rate: [newsletter("newsletter_list_growth_rate")],
    doi_confirmation_rate: [newsletter("doi_confirmation_rate")],
    email_disaffection_rate: [newsletter("email_disaffection_rate")],
    event_ticket_revenue: [
      {
        streamId: "community",
        value: amountIn(tickets, leadingCurrency(tickets, input.currency)),
      },
    ],
    event_attendance_rate: [community(derived.get("event_attendance_rate"))],
    no_show_rate: [community(derived.get("no_show_rate"))],
    club_application_acceptance: [community(derived.get("club_application_acceptance"))],
    club_decision_time: [community(input.clubs?.decisionHoursMedian)],
    club_active_member_rate: [community(derived.get("club_active_member_rate"))],
    club_contributor_rate: [community(derived.get("club_contributor_rate"))],
  };

  return REVENUE_SNAPSHOT_METRICS.map((metricId) => ({
    metricId,
    observations: byMetric[metricId],
  }));
}
