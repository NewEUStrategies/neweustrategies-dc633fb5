// KSZTAŁTY DANYCH FINANSOWYCH HUBA „PRZYCHÓD I LEJEK" (S2).
//
// MODUŁ BEZ ZALEŻNOŚCI RUNTIME poza stałymi list (`as const`) - import z
// tego pliku (zakładki S7, pulpit, BI, `/admin/billing`) nie wciąga Reacta,
// klienta Supabase ani arytmetyki do chunku odbiorcy.
//
// ZASADY, KTÓRE TYPY WYMUSZAJĄ:
//   * `null` ≠ 0 - liczba, której nie da się policzyć (brak mianownika, okno
//     przed początkiem księgi, brak wsadu do ekonomiki), jest `null`;
//     zmierzone „nic" to 0 albo `[]`;
//   * pieniądze WYŁĄCZNIE per waluta (`MoneyByCurrency[]` albo wiersz
//     z polem `currency`) - nigdy suma walut;
//   * kwoty w jednostkach drobnych (grosze, centy), ilorazy jako ułamki 0-1
//     (NRR, quick ratio i realizacja ceny mogą przekraczać 1);
//   * D-05: podstawa kwoty (`basisMix`) jest częścią wyniku - panel podpisuje,
//     ile MRR pochodzi z migawki operatora, a ile z katalogu.
import type { RevenueInputKind } from "@/lib/revenue/limits";
import type { MoneyByCurrency } from "@/lib/revenue/money";
import type { BridgeParts } from "./mrrMath";

/**
 * Wynik odczytu dla panelu. Odmowa roli (42501) i brak funkcji w bazie
 * (migracja w drodze) są STANAMI karty, nie wyjątkami - toast „błąd" i
 * ponawianie nie naprawią ani decyzji uprawnień, ani okna wdrożenia.
 */
export type RevenueFinanceRead<T> =
  { state: "ready"; data: T } | { state: "forbidden" } | { state: "unavailable" };

/** Udział podstawy kwot aktywnych subskrypcji (D-05). */
export interface RevenueBasisMix {
  provider: number;
  catalog: number;
}

// ── Most MRR ────────────────────────────────────────────────────────────────

export interface MrrBridgeCurrencyRow extends BridgeParts {
  currency: string;
  netNewMinor: number;
  activeSubscriptions: number;
  activeCustomers: number;
  /** Koniec − (start + otwarcie + Σ ruchów); 0 w poprawnej księdze. */
  residualMinor: number;
  /** Most domyka się w tolerancji ±0,5 % (`BRIDGE_TOLERANCE`). */
  reconciled: boolean;
}

export interface MrrBridgeDto {
  since: string;
  until: string;
  segment: string;
  /** Pierwszy ruch księgi `live`; `null` = księga pusta. */
  dataSince: string | null;
  basisMix: RevenueBasisMix | null;
  /** `null` = księga nie zna okna (są subskrypcje, nie ma ruchów). */
  currencies: MrrBridgeCurrencyRow[] | null;
  activeSubscriptions: number;
  activeCustomers: number;
}

// ── Szereg MRR ──────────────────────────────────────────────────────────────

export type MrrSeriesGrain = "day" | "week" | "month";

export interface MrrSeriesPoint {
  /** `YYYY-MM-DD` - pierwszy dzień kubełka w strefie najemcy. */
  bucketStart: string;
  /** Chwila pomiaru (koniec kubełka albo okna) w ISO. */
  at: string;
  currency: string;
  mrrMinor: number;
  activeSubscriptions: number;
  /** MRR z migawki dziennej (drugi pomiar); `null` = brak migawki z tego dnia. */
  snapshotMrrMinor: number | null;
  /** Migawka − księga; `null` bez migawki. */
  driftMinor: number | null;
}

export interface MrrSeriesDto {
  since: string;
  until: string;
  grain: MrrSeriesGrain;
  timeZone: string;
  points: MrrSeriesPoint[];
}

// ── Churn ───────────────────────────────────────────────────────────────────

export interface ChurnCurrencyRow {
  currency: string;
  mrrStartMinor: number;
  churnMinor: number;
  contractionMinor: number;
  expansionMinor: number;
  reactivationMinor: number;
  grossRevenueChurn: number | null;
  grossRevenueRetention: number | null;
  netRevenueRetention: number | null;
}

/** Powody ruchu `churn` w księdze (CHECK `mrr_movements.reason`). */
export const CHURN_REASONS = ["canceled", "unpaid", "paused", "currency_switch"] as const;
export type ChurnReason = (typeof CHURN_REASONS)[number];

export interface ChurnReasonRow {
  reason: ChurnReason;
  movements: number;
  amounts: MoneyByCurrency[];
}

export interface ChurnDto {
  since: string;
  until: string;
  customersStart: number;
  customersChurned: number;
  logoChurnRate: number | null;
  involuntaryShare: number | null;
  currencies: ChurnCurrencyRow[];
  reasons: ChurnReasonRow[];
}

// ── Kohorty ─────────────────────────────────────────────────────────────────

export interface CohortCell {
  monthOffset: number;
  active: number;
  share: number | null;
}

export interface CohortRow {
  /** `YYYY-MM-01`. */
  cohortMonth: string;
  size: number;
  retained: CohortCell[];
}

export interface CohortsDto {
  fromMonth: string;
  toMonth: string;
  maxOffset: number;
  cohorts: CohortRow[];
}

// ── Windykacja ──────────────────────────────────────────────────────────────

export interface DunningDto {
  since: string;
  until: string;
  started: number;
  recovered: number;
  lost: number;
  open: number;
  recoveryRate: number | null;
  medianDaysToRecover: number | null;
  atRisk: MoneyByCurrency[];
  recoveredMrr: MoneyByCurrency[];
  lostMrr: MoneyByCurrency[];
}

// ── Przychód zrealizowany ───────────────────────────────────────────────────

export const REALIZED_CATEGORIES = [
  "subscription",
  "event",
  "content",
  "plan_one_time",
  "other",
] as const;
export type RealizedCategory = (typeof REALIZED_CATEGORIES)[number];

export interface RealizedCategoryRow {
  category: RealizedCategory;
  currency: string;
  grossMinor: number;
  refundsMinor: number;
  netMinor: number;
  documents: number;
}

export interface RealizedTotalRow {
  currency: string;
  grossMinor: number;
  refundsMinor: number;
  netMinor: number;
}

export interface RealizedOrdersRow {
  currency: string;
  amountMinor: number;
  orders: number;
}

export interface RealizedDto {
  since: string;
  until: string;
  categories: RealizedCategoryRow[];
  totals: RealizedTotalRow[];
  /** Drugie źródło (zamówienia opłacone) do uzgodnienia z dokumentami. */
  orders: RealizedOrdersRow[];
  /** Dokumenty bez rozpoznanego środowiska - poza przychodem (jakość danych). */
  unknownEnvironmentDocuments: number;
}

// ── Przepływ anulowania ─────────────────────────────────────────────────────

export interface RetentionReasonRow {
  reasonId: string | null;
  reasonLabel: string;
  responses: number;
}

export interface RetentionOffersDto {
  since: string;
  until: string;
  flowsStarted: number;
  saved: number;
  canceled: number;
  abandoned: number;
  open: number;
  offersShown: number;
  offersAccepted: number;
  saveRateGross: number | null;
  saveRateNet: number | null;
  /** „Anuluj mimo to" przed wyborem powodu (Z-09) - nie jest powodem. */
  reasonNotGiven: number;
  /** Ankiety sprzed S2 (bez `outcome`). */
  legacyResponses: number;
  reasons: RetentionReasonRow[];
}

// ── Macierz oferty ──────────────────────────────────────────────────────────

export const OFFER_PLAN_ISSUES = [
  "no_catalog_pair",
  "tier_missing",
  "tier_inactive",
  "tier_hidden",
  "inactive_for_sale",
] as const;
export type OfferPlanIssue = (typeof OFFER_PLAN_ISSUES)[number];

export const OFFER_TIER_ISSUES = ["visible_without_plan"] as const;
export type OfferTierIssue = (typeof OFFER_TIER_ISSUES)[number];

export interface OfferMatrixPlan {
  planId: string;
  tierKey: string | null;
  interval: string;
  priceCents: number;
  currency: string;
  active: boolean;
  forSale: boolean;
  catalogPriceId: string | null;
  tierActive: boolean | null;
  pricingVisible: boolean | null;
  /** `null` dla redaktora - liczba płacących to dana handlowa (tylko admin). */
  activeSubscriptions: number | null;
  issues: OfferPlanIssue[];
}

export interface OfferMatrixTier {
  key: string;
  rank: number;
  active: boolean;
  pricingVisible: boolean;
  isDefault: boolean;
  plansForSale: number;
  issues: OfferTierIssue[];
}

export interface OfferMatrixDto {
  plans: OfferMatrixPlan[];
  tiers: OfferMatrixTier[];
}

// ── Dane wejściowe i ekonomika ──────────────────────────────────────────────

// Rodzaje danych wejściowych: jedna lista z I0 (`limits.ts` = CHECK
// `revenue_manual_inputs.kind`, test parytetu limitów) - bez drugiej kopii.
export { REVENUE_INPUT_KINDS, type RevenueInputKind } from "@/lib/revenue/limits";

/** Rodzaje zapisywane jako stosunek w [-1, 1] (bez waluty). */
export const REVENUE_RATIO_INPUT_KINDS: readonly RevenueInputKind[] = [
  "gross_margin_pct",
  "ebitda_margin_pct",
];

export interface RevenueInputRow {
  id: string;
  /** `YYYY-MM-01`. */
  periodMonth: string;
  kind: RevenueInputKind;
  segment: string;
  currency: string | null;
  /** Kwota w jednostkach drobnych; dla `new_customers_plan` - LICZBA klientów. */
  amountMinor: number | null;
  ratio: number | null;
  note: string | null;
  /** Surowy napis z bazy - token współbieżności (bez `Date`, mikrosekundy). */
  updatedAt: string;
  updatedBy: string | null;
}

export interface RevenueInputsDto {
  fromMonth: string;
  toMonth: string;
  rows: RevenueInputRow[];
}

export interface RevenueInputSaveResult {
  op: "insert" | "update" | "delete" | "noop";
  row: RevenueInputRow | null;
}

export interface EconomicsMonth {
  month: string;
  currency: string;
  mrrEndMinor: number | null;
  customersEnd: number | null;
  arpaMinor: number | null;
  newCustomers: number;
  logoChurnRate: number | null;
  realizedNetMinor: number | null;
  salesMarketingCostMinor: number | null;
  cogsMinor: number | null;
  grossMargin: number | null;
  ebitdaMargin: number | null;
  cacMinor: number | null;
  ltvMinor: number | null;
  ltvCacRatio: number | null;
  cacPaybackMonths: number | null;
  mrrPlanMinor: number | null;
  planAttainment: number | null;
  newCustomersPlan: number | null;
  missing: RevenueInputKind[];
}

export interface RuleOf40 {
  month: string;
  currency: string;
  growthYoy: number;
  ebitdaMargin: number;
  value: number;
}

export interface EconomicsDto {
  fromMonth: string;
  toMonth: string;
  timeZone: string;
  months: EconomicsMonth[];
  missing: RevenueInputKind[];
  ruleOf40: RuleOf40 | null;
}

/**
 * Wynik zapisu danej wejściowej. `conflict` = ktoś zapisał wiersz po naszym
 * odczycie (40001 `stale_write`) - formularz przeładowuje wartość zamiast
 * nadpisywać cudzą; `invalid` niesie kod walidacji SQL (22023) do etykiety.
 */
export type RevenueInputSaveRead =
  | { state: "saved"; result: RevenueInputSaveResult }
  | { state: "conflict" }
  | { state: "invalid"; code: RevenueInputInvalidCode }
  | { state: "forbidden" }
  | { state: "unavailable" };

/** Kody `RAISE ... USING ERRCODE = '22023'` funkcji `admin_revenue_input_upsert`. */
export const REVENUE_INPUT_INVALID_CODES = [
  "period_invalid",
  "kind_invalid",
  "segment_invalid",
  "note_too_long",
  "value_invalid",
] as const;
export type RevenueInputInvalidCode = (typeof REVENUE_INPUT_INVALID_CODES)[number];
