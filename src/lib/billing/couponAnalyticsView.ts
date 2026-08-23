// Agregaty analityki kuponów B2B - cztery kafle, TOP 10 i opcja wykresu.
//
// PO CO OSOBNO. To są PIENIĄDZE liczone w ciele komponentu trasy
// (`admin.coupons.analytics.tsx`, dawne 63-99): trzy sumy, konwersja i wykres
// powstawały między `useQuery` a JSX-em, więc jedyną drogą do ich sprawdzenia
// było zamontowanie całej trasy z atrapą RPC i czytanie napisów z ekranu.
// Tutaj każde dzielenie i każda konwersja `Number()` ma własny, tani test.
//
// PRZENIESIONE ZNAK W ZNAK, RAZEM Z WADAMI:
//   * sumy idą przez `Number(...)` bez zacisku, więc BRAK KOLUMNY w odpowiedzi
//     RPC (`undefined`) zatruwa całą sumę i kafel pokazuje „NaN"; `null` cichnie
//     do zera, czyli awarii danych nie da się odróżnić od zera przychodu;
//   * TOP 10 to `rows.slice(0, 10)` BEZ własnego sortowania - kolejność jest
//     w całości zapożyczona z `ORDER BY` w funkcji SQL;
//   * `coupons` to długość odpowiedzi, a funkcja ma `LIMIT 100`, więc przy 100+
//     kuponach kafel pokazuje „100" i nic nie mówi o obcięciu.
// Defekty są zgłoszone przez `it.fails` w `couponAnalyticsView.test.ts`.
import type { EChartsCoreOption } from "echarts/core";

/** Wiersz odpowiedzi RPC `b2b_coupons_analytics`. */
export interface CouponAnalyticsRow {
  readonly coupon_id: string;
  readonly code: string;
  readonly name: string | null;
  readonly redemptions: number;
  /** Przychód NETTO (original_cents - applied_cents). */
  readonly revenue_cents: number;
  /** Udzielony RABAT (applied_cents). */
  readonly discount_cents_total: number;
}

/** Wartości czterech kafli + suma rabatów pod tabelą. */
export interface CouponAnalyticsSummary {
  /** Liczba kuponów W ODPOWIEDZI (RPC ma LIMIT 100). */
  readonly coupons: number;
  readonly totalRedemptions: number;
  readonly totalRevenueCents: number;
  readonly totalDiscountCents: number;
  /** Odsetek kuponów z co najmniej jedną realizacją, już sformatowany. */
  readonly conversion: string;
}

export function summarizeCouponAnalytics(
  rows: readonly CouponAnalyticsRow[],
): CouponAnalyticsSummary {
  const totalRedemptions = rows.reduce((s, r) => s + Number(r.redemptions), 0);
  const totalRevenueCents = rows.reduce((s, r) => s + Number(r.revenue_cents), 0);
  const totalDiscountCents = rows.reduce((s, r) => s + Number(r.discount_cents_total), 0);
  // JEDYNE dzielenie przez wartość zmienną w tej powierzchni - i jedyne
  // osłonięte warunkiem. Pusty zbiór daje "0", nie "NaN".
  const conversion =
    rows.length > 0
      ? ((rows.filter((r) => Number(r.redemptions) > 0).length / rows.length) * 100).toFixed(1)
      : "0";
  return {
    coupons: rows.length,
    totalRedemptions,
    totalRevenueCents,
    totalDiscountCents,
    conversion,
  };
}

/** Słupek wykresu TOP 10. */
export interface CouponTopBar {
  readonly code: string;
  readonly redemptions: number;
}

/**
 * Pierwsze dziesięć wierszy odpowiedzi - BEZ sortowania po stronie klienta.
 * Nazwa mówi „by redemptions", bo tak nazywa to interfejs; kolejność zapewnia
 * wyłącznie `ORDER BY COUNT(...) DESC` w funkcji SQL.
 */
export function top10ByRedemptions(rows: readonly CouponAnalyticsRow[]): CouponTopBar[] {
  return rows.slice(0, 10).map((r) => ({
    code: r.code,
    redemptions: Number(r.redemptions),
  }));
}

/** Opcja ECharts wykresu słupkowego TOP 10 (etykieta serii przychodzi z zewnątrz). */
export function top10BarOption(
  top10: readonly CouponTopBar[],
  seriesLabel: string,
): EChartsCoreOption {
  return {
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    grid: { left: 8, right: 8, top: 16, bottom: 8, containLabel: true },
    xAxis: {
      type: "category",
      data: top10.map((r) => r.code),
      axisLabel: { rotate: 30, fontSize: 11, overflow: "truncate", width: 110 },
    },
    yAxis: { type: "value", axisLabel: { fontSize: 11 } },
    series: [
      {
        name: seriesLabel,
        type: "bar",
        data: top10.map((r) => r.redemptions),
        barMaxWidth: 36,
        itemStyle: { borderRadius: [6, 6, 0, 0], color: "#2a78d6" },
        label: { show: true, position: "top", fontSize: 10 },
      },
    ],
  };
}
