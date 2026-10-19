// `queryOptions` finansów huba (S2, SPEC §5.4) - JEDNO źródło klucza
// i `queryFn` dla każdego ekranu, który pokazuje te liczby.
//
// DLACZEGO TO WAŻNE. `/admin/billing` (P10) i karta MRR huba pokazują ten sam
// most MRR; pulpit, hub i BI - ten sam przychód zrealizowany. Dwie definicje
// pod jednym kluczem to kolizja cache (defekt V30 retencji), a dwie różne
// RPC pod dwoma kluczami to dwie różne liczby jednego wskaźnika. Dlatego
// każdy ekran woła TĘ fabrykę - ta sama RPC i ten sam klucz.
//
// KLUCZE z fabryki I0 (`revenueKeys`): prefiks `["admin-revenue", dziedzina,
// najemca]` trafia regułą szyny zdarzeń (`eventInvalidationMap.admin.ts`)
// w każde zapamiętane okno, a obie granice okna w kluczu rozdzielają „ten
// miesiąc" w październiku i w listopadzie. Wspólne (§5.4): `retry: 1`,
// `gcTime` 10 min, bez `refetchInterval`, `enabled` = najemca i rola.
import { keepPreviousData, queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { revenueKeys } from "@/lib/revenue/keys";
import type { RevenueRange } from "@/lib/revenue/window";
import type {
  ChurnDto,
  CohortsDto,
  DunningDto,
  EconomicsDto,
  MrrBridgeDto,
  MrrSeriesDto,
  MrrSeriesGrain,
  OfferMatrixDto,
  RealizedDto,
  RetentionOffersDto,
  RevenueFinanceRead,
  RevenueInputSaveRead,
  RevenueInputsDto,
} from "./dto";
import {
  getRevenueChurn,
  getRevenueCohorts,
  getRevenueDunning,
  getRevenueEconomics,
  getRevenueInputs,
  getRevenueMrrBridge,
  getRevenueMrrSeries,
  getRevenueOfferMatrix,
  getRevenueRealized,
  getRevenueRetentionOffers,
  saveRevenueInput,
  type RevenueInputSaveInput,
} from "./finance.functions";

/** Pas szybki (okno otwarte) - liczby zmieniają się z każdym webhookiem. */
export const FINANCE_STALE_OPEN_MS = 60_000;
/** Pas szybki (okno domknięte) - zmienia je już tylko spóźnione zdarzenie. */
export const FINANCE_STALE_COMPLETE_MS = 30 * 60_000;
/** Pas wolny: churn, kohorty, windykacja, dane wejściowe, ekonomika. */
export const FINANCE_STALE_SLOW_MS = 5 * 60_000;
/** Macierz oferty - konfiguracja, którą admin właśnie naprawia obok. */
export const FINANCE_STALE_OFFER_MS = 30_000;
export const FINANCE_GC_MS = 10 * 60_000;

type RangeInput = Pick<RevenueRange, "period" | "current" | "complete">;

/** Wspólne: rola i najemca włączają zapytanie (§5.4). */
export interface FinanceQueryGate {
  /** Rola widzi kwoty (admin) - bez niej karta pokazuje `RoleGateNotice` bez odczytu. */
  roleOk?: boolean;
}

function fastStale(range: RangeInput): number {
  return range.complete ? FINANCE_STALE_COMPLETE_MS : FINANCE_STALE_OPEN_MS;
}

function windowOf(range: RangeInput) {
  return { sinceIso: range.current.sinceIso, untilIso: range.current.untilIso };
}

function on(tenantId: string | null, gate: FinanceQueryGate | undefined): boolean {
  return Boolean(tenantId) && (gate?.roleOk ?? true);
}

// Bez najemcy zapytanie jest wyłączone; pusty napis trzyma tylko kształt
// klucza i nigdy nie trafia do cache z danymi.
const t = (tenantId: string | null) => tenantId ?? "";

// ── Pas szybki ──────────────────────────────────────────────────────────────

/**
 * Most MRR (start + Σ ruchów = koniec). Ten sam klucz w hubie i w
 * `/admin/billing` - KPI „aktywne subskrypcje" i „MRR" panelu płatności to
 * `activeSubscriptions` i `endMinor` z tej odpowiedzi.
 */
export function revenueMrrBridgeQueryOptions(
  tenantId: string | null,
  range: RangeInput,
  segment: string | null = null,
  gate?: FinanceQueryGate,
) {
  return queryOptions<RevenueFinanceRead<MrrBridgeDto>>({
    queryKey: revenueKeys.query("mrr", t(tenantId), range, { segment }),
    queryFn: () => getRevenueMrrBridge({ data: { ...windowOf(range), segment } }),
    enabled: on(tenantId, gate),
    staleTime: fastStale(range),
    gcTime: FINANCE_GC_MS,
    retry: 1,
    placeholderData: keepPreviousData,
  });
}

/**
 * Szereg MRR z drugim pomiarem (migawka dzienna). Ziarno w kluczu rozdziela
 * go od mostu w tej samej dziedzinie `mrr`; strefa - bo kubełki stoją na
 * lokalnych północach.
 */
export function revenueMrrSeriesQueryOptions(
  tenantId: string | null,
  range: RangeInput,
  grain: MrrSeriesGrain,
  timeZone: string,
  gate?: FinanceQueryGate,
) {
  return queryOptions<RevenueFinanceRead<MrrSeriesDto>>({
    queryKey: [...revenueKeys.query("mrr", t(tenantId), range, { grain }), timeZone] as const,
    queryFn: () => getRevenueMrrSeries({ data: { ...windowOf(range), grain, timeZone } }),
    enabled: on(tenantId, gate),
    staleTime: fastStale(range),
    gcTime: FINANCE_GC_MS,
    retry: 1,
    placeholderData: keepPreviousData,
  });
}

/** Przychód zrealizowany - jedna RPC i jeden klucz dla pulpitu, huba i BI. */
export function revenueRealizedQueryOptions(
  tenantId: string | null,
  range: RangeInput,
  gate?: FinanceQueryGate,
) {
  return queryOptions<RevenueFinanceRead<RealizedDto>>({
    queryKey: revenueKeys.query("realized", t(tenantId), range),
    queryFn: () => getRevenueRealized({ data: windowOf(range) }),
    enabled: on(tenantId, gate),
    staleTime: fastStale(range),
    gcTime: FINANCE_GC_MS,
    retry: 1,
    placeholderData: keepPreviousData,
  });
}

export function revenueRetentionOffersQueryOptions(
  tenantId: string | null,
  range: RangeInput,
  gate?: FinanceQueryGate,
) {
  return queryOptions<RevenueFinanceRead<RetentionOffersDto>>({
    queryKey: revenueKeys.query("retention", t(tenantId), range),
    queryFn: () => getRevenueRetentionOffers({ data: windowOf(range) }),
    enabled: on(tenantId, gate),
    staleTime: fastStale(range),
    gcTime: FINANCE_GC_MS,
    retry: 1,
    placeholderData: keepPreviousData,
  });
}

// ── Pas wolny ───────────────────────────────────────────────────────────────

export function revenueChurnQueryOptions(
  tenantId: string | null,
  range: RangeInput,
  gate?: FinanceQueryGate,
) {
  return queryOptions<RevenueFinanceRead<ChurnDto>>({
    queryKey: revenueKeys.query("churn", t(tenantId), range),
    queryFn: () => getRevenueChurn({ data: windowOf(range) }),
    enabled: on(tenantId, gate),
    staleTime: FINANCE_STALE_SLOW_MS,
    gcTime: FINANCE_GC_MS,
    retry: 1,
    placeholderData: keepPreviousData,
  });
}

export function revenueDunningQueryOptions(
  tenantId: string | null,
  range: RangeInput,
  gate?: FinanceQueryGate,
) {
  return queryOptions<RevenueFinanceRead<DunningDto>>({
    queryKey: revenueKeys.query("dunning", t(tenantId), range),
    queryFn: () => getRevenueDunning({ data: windowOf(range) }),
    enabled: on(tenantId, gate),
    staleTime: FINANCE_STALE_SLOW_MS,
    gcTime: FINANCE_GC_MS,
    retry: 1,
    placeholderData: keepPreviousData,
  });
}

/** Kohorty miesięczne (`YYYY-MM-01` .. `YYYY-MM-01`, do 24 miesięcy). */
export function revenueCohortsQueryOptions(
  tenantId: string | null,
  fromMonth: string,
  toMonth: string,
  gate?: FinanceQueryGate,
) {
  return queryOptions<RevenueFinanceRead<CohortsDto>>({
    queryKey: [...revenueKeys.domainTenant("cohorts", t(tenantId)), fromMonth, toMonth] as const,
    queryFn: () => getRevenueCohorts({ data: { fromMonth, toMonth } }),
    enabled: on(tenantId, gate),
    staleTime: FINANCE_STALE_SLOW_MS,
    gcTime: FINANCE_GC_MS,
    retry: 1,
    placeholderData: keepPreviousData,
  });
}

export function revenueInputsQueryOptions(
  tenantId: string | null,
  fromMonth: string,
  toMonth: string,
  gate?: FinanceQueryGate,
) {
  return queryOptions<RevenueFinanceRead<RevenueInputsDto>>({
    queryKey: revenueKeys.manualInputs(t(tenantId), fromMonth, toMonth),
    queryFn: () => getRevenueInputs({ data: { fromMonth, toMonth } }),
    enabled: on(tenantId, gate),
    staleTime: FINANCE_STALE_SLOW_MS,
    gcTime: FINANCE_GC_MS,
    retry: 1,
  });
}

export function revenueEconomicsQueryOptions(
  tenantId: string | null,
  fromMonth: string,
  toMonth: string,
  timeZone: string,
  gate?: FinanceQueryGate,
) {
  return queryOptions<RevenueFinanceRead<EconomicsDto>>({
    queryKey: [
      ...revenueKeys.domainTenant("economics", t(tenantId)),
      fromMonth,
      toMonth,
      timeZone,
    ] as const,
    queryFn: () => getRevenueEconomics({ data: { fromMonth, toMonth, timeZone } }),
    enabled: on(tenantId, gate),
    staleTime: FINANCE_STALE_SLOW_MS,
    gcTime: FINANCE_GC_MS,
    retry: 1,
    placeholderData: keepPreviousData,
  });
}

// ── Oferta ──────────────────────────────────────────────────────────────────

/** Macierz oferty - czyta też redaktor (bez liczby płacących). */
export function revenueOfferMatrixQueryOptions(tenantId: string | null, gate?: FinanceQueryGate) {
  return queryOptions<RevenueFinanceRead<OfferMatrixDto>>({
    queryKey: revenueKeys.offerMatrix(t(tenantId)),
    queryFn: () => getRevenueOfferMatrix(),
    enabled: on(tenantId, gate),
    staleTime: FINANCE_STALE_OFFER_MS,
    gcTime: FINANCE_GC_MS,
    retry: 1,
  });
}

// ── Zapis ───────────────────────────────────────────────────────────────────

/**
 * Klucze do odświeżenia po zapisie danej wejściowej: lista danych i ekonomika
 * (CAC, LTV, realizacja planu). Szyna zdarzeń (`revenue_input.changed.v1`)
 * robi to samo w innych kartach; tu - od razu, bez czekania na zdarzenie.
 */
export function revenueInputSaveInvalidationKeys(tenantId: string) {
  return [
    revenueKeys.domainTenant("inputs", tenantId),
    revenueKeys.domainTenant("economics", tenantId),
  ] as const;
}

export function useSaveRevenueInput(tenantId: string | null) {
  const qc = useQueryClient();
  return useMutation<RevenueInputSaveRead, Error, RevenueInputSaveInput>({
    mutationFn: (input) => saveRevenueInput({ data: input }),
    onSettled: (result) => {
      // Konflikt też odświeża: formularz ma pokazać wartość, która wygrała.
      if (!tenantId || result?.state === "forbidden" || result?.state === "unavailable") return;
      for (const queryKey of revenueInputSaveInvalidationKeys(tenantId)) {
        void qc.invalidateQueries({ queryKey });
      }
    },
  });
}
