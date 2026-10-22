// Model zakładki „Wskaźniki" - wartości słownika S6 i powód każdego braku.
//
// SKĄD LICZBA. Słownik (`MetricDictionary` S6) ocenia wartości 5 progami
// rejestru benchmarków, ale sam niczego nie liczy - dostaje mapę
// `values: ReadonlyMap<MetricId, number | null>`. Mapa powstaje tu z dwóch
// producentów, bez trzeciego źródła:
//   * migawka S6 (`revenueSnapshotQueryOptions`, klucz BI) - `canonicalValue`
//     każdego wpisu; kwoty w JEDNEJ walucie słownika (z listy `money`, nigdy
//     suma walut, brak waluty na liście = `null`, nie 0);
//   * ekonomika jednostkowa S2 (`revenueEconomicsQueryOptions`, tylko
//     administrator) - CAC, LTV, LTV/CAC, zwrot CAC, marża brutto i Reguła 40
//     z OSTATNIEGO miesiąca okna w walucie słownika.
//
// „BRAK DANYCH" MÓWI CZEGO BRAKUJE (SPEC §6.5). Każdy wskaźnik huba bez
// wartości dostaje jeden powód - z tego, co wiadomo z odpowiedzi
// producentów, bez zgadywania: strumień niedostępny (rola, źródło
// niepodłączone, awaria), historia krótsza niż 12 miesięcy („dane od …"),
// okno inne niż 12 pełnych miesięcy, brak danych wejściowych (lista z SQL
// `missing[]` przecięta z wejściami danego wskaźnika), kwoty tylko w innych
// walutach, brak mianownika albo wskaźnik, którego hub jeszcze nie liczy.
//
// MODUŁ CZYSTY - bez Reacta; testy liczą na nim każdy powód.
import { bi } from "@/lib/analytics/semantic/benchmarks/adapter";
import { primaryBenchmarkFor } from "@/lib/analytics/semantic/benchmarks/index";
import type { BenchContextSegment } from "@/lib/analytics/semantic/benchmarks/types";
import { abbreviationOf } from "@/lib/analytics/semantic/metricHelp";
import {
  HUB_METRIC_IDS,
  METRICS,
  authoritativeBinding,
  metricById,
  type MetricGroup,
  type MetricId,
} from "@/lib/analytics/semantic/metrics";
import type { RevenueSnapshotResult } from "@/lib/analytics/semantic/revenueSnapshot.functions";
import type { EconomicsDto, EconomicsMonth } from "@/lib/revenue/finance/dto";
import type { RevenueFinanceRead } from "@/lib/revenue/finance/dto";
import type { RevenueInputKind } from "@/lib/revenue/limits";
import type { ChartLang } from "@/lib/charts/format";
import type { RevenueSegment } from "@/lib/revenue/search";
import type { RevenueRange } from "@/lib/revenue/window";

/** Grupy słownika huba - wszystko poza ruchem stron (ten ma ekran BI). */
export const HUB_DICTIONARY_GROUPS: readonly MetricGroup[] = [
  "revenue",
  "retention",
  "funnel",
  "economics",
  "email",
  "community",
  "crm",
];

/** Skrót i pełna nazwa wskaźnika - tak samo jak w wierszu słownika S6. */
export function metricNames(id: MetricId, lang: ChartLang): { abbr: string; label: string } {
  const def = metricById(id);
  const label = bi({ pl: def.labelPl, en: def.labelEn }, lang);
  return { abbr: primaryBenchmarkFor(id)?.abbr ?? abbreviationOf(label), label };
}

/** Ile miesięcy historii potrzeba do pełnego wyniku (jak `FULL_HISTORY_MONTHS`). */
export const FULL_HISTORY_MONTHS = 12;

/**
 * Wskaźniki liczone z historii 12 miesięcy wstecz (NRR/GRR porównują MRR
 * kohorty sprzed roku, M12 i powroty patrzą rok wstecz) - przed upływem
 * roku od początku księgi wynik jest „dane od …", nigdy 0 (SPEC §6.2).
 */
const HISTORY_METRICS: ReadonlySet<MetricId> = new Set<MetricId>([
  "net_revenue_retention",
  "gross_revenue_retention",
  "cohort_retention_m12",
  "winback_rate_12m",
  "logo_churn_annual",
]);

/**
 * Wskaźniki liczone wyłącznie dla okna 12 PEŁNYCH miesięcy (`revenueRaw`:
 * churn roczny poza takim oknem to `null` z powodem). Inne okno to nie
 * „brak danych", tylko zły okres - powód mówi, który wybrać.
 */
const FULL_YEAR_WINDOW_METRICS: ReadonlySet<MetricId> = new Set<MetricId>(["logo_churn_annual"]);

/**
 * Wskaźniki ekonomiki jednostkowej i dane wejściowe, bez których SQL
 * (`admin_revenue_economics`, migracja 20261020110700) zwraca `NULL`:
 * CAC = koszt sprzedaży i marketingu ÷ nowi klienci; LTV = ARPA × marża
 * brutto ÷ churn; zwrot CAC = CAC ÷ (ARPA × marża); marża z wejścia albo
 * z kosztu własnego; Reguła 40 = wzrost r/r + marża EBITDA. Marża brutto
 * jest jednym wpisem `missing` (`gross_margin_pct`) także wtedy, gdy da się
 * ją policzyć z kosztu własnego - tak raportuje ją SQL.
 */
export const ECONOMICS_INPUTS = {
  cac: ["sales_marketing_cost"],
  ltv: ["gross_margin_pct"],
  ltv_cac_ratio: ["sales_marketing_cost", "gross_margin_pct"],
  cac_payback_months: ["sales_marketing_cost", "gross_margin_pct"],
  subscription_gross_margin: ["gross_margin_pct"],
  rule_of_40: ["ebitda_margin_pct"],
} as const satisfies Partial<Record<MetricId, readonly RevenueInputKind[]>>;

export type EconomicsMetricId = keyof typeof ECONOMICS_INPUTS;

const ECONOMICS_IDS = Object.keys(ECONOMICS_INPUTS) as EconomicsMetricId[];

export function isEconomicsMetric(id: MetricId): id is EconomicsMetricId {
  return (ECONOMICS_IDS as readonly MetricId[]).includes(id);
}

/** Przyczyna braku wartości - jedna na wskaźnik, w kolejności sprawdzania. */
export type MissingReason =
  | { kind: "admin_only" }
  | { kind: "not_configured" }
  | { kind: "read_failed" }
  | { kind: "no_data" }
  | { kind: "history"; since: string; full: string }
  | { kind: "full_year" }
  | { kind: "inputs"; inputs: readonly RevenueInputKind[] }
  | { kind: "other_currency"; currencies: readonly string[] }
  | { kind: "no_base" }
  | { kind: "not_measured" };

export type MissingReasonKind = MissingReason["kind"];

/** Kolejność grup na karcie: najpierw to, co admin może naprawić sam. */
export const MISSING_REASON_ORDER: readonly MissingReasonKind[] = [
  "inputs",
  "full_year",
  "other_currency",
  "history",
  "not_configured",
  "read_failed",
  "no_data",
  "no_base",
  "admin_only",
  "not_measured",
];

/** Stan odczytu ekonomiki (tylko administrator; redaktor - `skipped`). */
export type EconomicsState =
  | { state: "ready"; dto: EconomicsDto }
  | { state: "loading" | "skipped" | "unavailable" | "error" };

export function economicsStateOf(
  read: RevenueFinanceRead<EconomicsDto> | undefined,
  opts: { enabled: boolean; isError: boolean },
): EconomicsState {
  if (!opts.enabled) return { state: "skipped" };
  if (read?.state === "ready") return { state: "ready", dto: read.data };
  if (read?.state === "unavailable") return { state: "unavailable" };
  if (read?.state === "forbidden") return { state: "skipped" };
  return { state: opts.isError ? "error" : "loading" };
}

/** Wynik modelu: wartości dla słownika, liczebności i powody braków. */
export interface MetricValuesModel {
  /** Waluta kwot w słowniku (filtr `?cur=` albo waluta wiodąca MRR). */
  currency: string | null;
  values: ReadonlyMap<MetricId, number | null>;
  samples: ReadonlyMap<MetricId, number>;
  /** Powód braku dla każdego wskaźnika huba bez wartości. */
  missing: ReadonlyMap<MetricId, MissingReason>;
}

/** Waluta słownika: wybrana filtrem albo pierwsza (wiodąca) z kwot MRR migawki. */
export function dictionaryCurrencyOf(
  snapshot: Pick<RevenueSnapshotResult, "money">,
  filter: string | null,
): string | null {
  if (filter) return filter;
  const lists = [snapshot.money.mrr, ...Object.values(snapshot.money)];
  for (const list of lists) {
    const head = list?.[0]?.currency;
    if (head) return head;
  }
  return null;
}

/** `YYYY-MM-DD` + `months` miesięcy - arytmetyka kalendarzowa, bez stref. */
export function addMonthsToDay(day: string, months: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1 + months, d));
  // Koniec miesiąca (31 stycznia + 1 = 28/29 lutego), nie przeskok w marzec.
  if (date.getUTCDate() !== d) date.setUTCDate(0);
  return date.toISOString().slice(0, 10);
}

/** Lokalny dzień `YYYY-MM-DD` chwili (okno huba stoi na lokalnych północach). */
function localDayOf(ms: number): string {
  const date = new Date(ms);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Miesiące ekonomiki dla okna (`YYYY-MM-01`): od miesiąca początku okna do
 * miesiąca jego OSTATNIEGO dnia (granica `untilIso` jest wyłączna).
 */
export function economicsMonthsOf(range: Pick<RevenueRange, "current">): {
  fromMonth: string;
  toMonth: string;
} {
  const since = localDayOf(Date.parse(range.current.sinceIso));
  const last = localDayOf(Date.parse(range.current.untilIso) - 1);
  return { fromMonth: `${since.slice(0, 7)}-01`, toMonth: `${last.slice(0, 7)}-01` };
}

/** Segment huba jako kontekst benchmarku (`all` = domyślny kontekst wpisu). */
export function benchSegmentOf(segment: RevenueSegment | null): BenchContextSegment | undefined {
  return segment === null || segment === "all" ? undefined : segment;
}

/** `?metric=` z adresu → wskaźnik rejestru (nieznany identyfikator = brak arkusza). */
export function metricOfParam(raw: string | undefined): MetricId | null {
  return METRICS.some((m) => m.id === raw) ? (raw as MetricId) : null;
}

function lastMonthIn(dto: EconomicsDto, currency: string | null): EconomicsMonth | null {
  if (currency === null) return null;
  const rows = dto.months.filter((row) => row.currency === currency);
  return rows.length === 0 ? null : (rows[rows.length - 1] as EconomicsMonth);
}

function economicsValue(
  id: EconomicsMetricId,
  row: EconomicsMonth | null,
  dto: EconomicsDto,
  currency: string | null,
): number | null {
  if (id === "rule_of_40") {
    return dto.ruleOf40 !== null && dto.ruleOf40.currency === currency ? dto.ruleOf40.value : null;
  }
  if (row === null) return null;
  switch (id) {
    case "cac":
      return row.cacMinor;
    case "ltv":
      return row.ltvMinor;
    case "ltv_cac_ratio":
      return row.ltvCacRatio;
    case "cac_payback_months":
      return row.cacPaybackMonths;
    case "subscription_gross_margin":
      return row.grossMargin;
  }
}

function economicsReason(
  id: EconomicsMetricId,
  row: EconomicsMonth | null,
  economics: EconomicsState,
): MissingReason | null {
  if (economics.state === "loading") return null;
  if (economics.state === "skipped") return { kind: "admin_only" };
  if (economics.state === "unavailable") return { kind: "not_configured" };
  if (economics.state === "error") return { kind: "read_failed" };
  const needed: readonly RevenueInputKind[] = ECONOMICS_INPUTS[id];
  const inputs = needed.filter((kind) => row?.missing.includes(kind) ?? false);
  if (inputs.length > 0) return { kind: "inputs", inputs };
  return { kind: "no_base" };
}

/**
 * Wartości i powody braków dla wszystkich wskaźników huba.
 *
 * `null` w `values` = wskaźnik znany, ale bez liczby (słownik rysuje kreskę
 * i ocenę „brak wartości"); wskaźnika spoza obu producentów nie ma w mapie
 * wcale - słownik pokazuje wtedy samą definicję.
 */
export function metricValuesModel(input: {
  snapshot: RevenueSnapshotResult;
  economics: EconomicsState;
  currencyFilter: string | null;
  /** Koniec okna (`untilIso`) - do „wynik pełny od …". */
  range: Pick<RevenueRange, "period" | "current">;
}): MetricValuesModel {
  const { snapshot, economics, range } = input;
  const currency = dictionaryCurrencyOf(snapshot, input.currencyFilter);
  const values = new Map<MetricId, number | null>();
  const samples = new Map<MetricId, number>();
  const missing = new Map<MetricId, MissingReason>();
  const entries = new Map(snapshot.entries.map((e) => [e.metricId, e]));
  const streams = new Map(snapshot.streams.map((s) => [s.streamId, s]));
  const windowEnd = localDayOf(Date.parse(range.current.untilIso) - 1);
  const row = economics.state === "ready" ? lastMonthIn(economics.dto, currency) : null;

  for (const id of HUB_METRIC_IDS) {
    const def = metricById(id);
    const stream = streams.get(authoritativeBinding(id).streamId);
    const entry = entries.get(id);

    if (isEconomicsMetric(id)) {
      const value =
        economics.state === "ready" ? economicsValue(id, row, economics.dto, currency) : null;
      if (economics.state === "ready") values.set(id, value);
      const reason = value === null ? economicsReason(id, row, economics) : null;
      if (reason) missing.set(id, reason);
      continue;
    }

    if (entry === undefined) {
      if (stream && !stream.available) missing.set(id, { kind: stream.reason ?? "no_data" });
      else missing.set(id, { kind: "not_measured" });
      continue;
    }

    // Kwota: pozycja listy w walucie słownika - nigdy suma walut.
    let value = entry.canonicalValue;
    const money = def.currencyBound ? snapshot.money[id] : undefined;
    if (def.currencyBound && money !== undefined) {
      value = money.find((m) => m.currency === currency)?.amountMinor ?? null;
    }
    values.set(id, value);
    const authoritative = entry.observations.find((o) => o.role === "authoritative");
    if (authoritative?.samples !== undefined) samples.set(id, authoritative.samples);
    if (value !== null) continue;

    if (stream && !stream.available) {
      missing.set(id, { kind: stream.reason ?? "no_data" });
    } else if (FULL_YEAR_WINDOW_METRICS.has(id) && range.period !== "ltm") {
      missing.set(id, { kind: "full_year" });
    } else if (
      HISTORY_METRICS.has(id) &&
      snapshot.dataSince !== null &&
      addMonthsToDay(snapshot.dataSince, FULL_HISTORY_MONTHS) > windowEnd
    ) {
      missing.set(id, {
        kind: "history",
        since: snapshot.dataSince,
        full: addMonthsToDay(snapshot.dataSince, FULL_HISTORY_MONTHS),
      });
    } else if (money !== undefined && money.length > 0) {
      missing.set(id, { kind: "other_currency", currencies: money.map((m) => m.currency) });
    } else {
      missing.set(id, { kind: "no_base" });
    }
  }
  return { currency, values, samples, missing };
}

/** Grupy powodów w kolejności karty - wskaźniki w kolejności rejestru. */
export interface MissingGroup {
  reason: MissingReason;
  metricIds: MetricId[];
}

/**
 * Wskaźniki z tym samym powodem w jednej grupie. Powody z parametrem
 * (brakujące wejścia, waluty, data) grupują się po pełnym opisie - dwie
 * różne listy braków to dwa różne zdania.
 */
export function missingGroups(missing: ReadonlyMap<MetricId, MissingReason>): MissingGroup[] {
  const groups = new Map<string, MissingGroup>();
  for (const id of HUB_METRIC_IDS) {
    const reason = missing.get(id);
    if (!reason) continue;
    const key = JSON.stringify(reason);
    const group = groups.get(key);
    if (group) group.metricIds.push(id);
    else groups.set(key, { reason, metricIds: [id] });
  }
  return [...groups.values()].sort(
    (a, b) =>
      MISSING_REASON_ORDER.indexOf(a.reason.kind) - MISSING_REASON_ORDER.indexOf(b.reason.kind),
  );
}
