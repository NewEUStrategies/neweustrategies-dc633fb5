// Model zakładki „Przychód" (S7-C) - czyste reguły bez renderu.
//
// CO TEN PLIK DOWODZI.
//   1. Segment w kluczu mostu jest lustrem `MrrBridgeCard` („wszystkie" = null).
//   2. Ziarno szeregu idzie za kubełkiem okna, a punkty dzienne tylko do
//      limitu walidatora server fn (stała-lustro równa oryginałowi).
//   3. Szereg per waluta: największa różnica migawki i księgi, brak migawki
//      to brak (nie zero).
//   4. Tabela ruchów: waluty jako kolumny, otwarcie tylko gdy jest, powody pod
//      odejściami; waluta spoza mostu = null, powód bez kwoty w walucie = 0.
//   5. Zgodność źródeł: werdykt rejestru S6, zamówienia ponad pustą księgą =
//      odwrócony porządek, waluta bez obu stron - pominięta.
import { describe, expect, it } from "vitest";

import { FINANCE_DAY_GRAIN_MAX_DAYS } from "@/lib/revenue/finance/finance.functions";
import type {
  ChurnReasonRow,
  MrrBridgeCurrencyRow,
  MrrSeriesPoint,
  RealizedDto,
} from "@/lib/revenue/finance/dto";
import { resolveRevenueRange } from "@/lib/revenue/window";
import {
  SERIES_DAY_GRAIN_MAX_DAYS,
  bridgeSegmentKeyOf,
  localDay,
  movementTable,
  reconciliationRows,
  segmentNarrowed,
  seriesByCurrency,
  seriesGrainOf,
  seriesTimeZone,
} from "../mrrModel";
import { MRR_BRIDGE, NOW_MS, clone } from "../../overview/__tests__/hubFixtures";
import { CHURN, MRR_SERIES, REALIZED } from "./financeFixtures";

const BRIDGE = (clone(MRR_BRIDGE) as { currencies: MrrBridgeCurrencyRow[] }).currencies;

describe("klucz mostu i segment", () => {
  it("„wszystkie” i brak filtra to ten sam klucz (null)", () => {
    expect(bridgeSegmentKeyOf(null)).toBeNull();
    expect(bridgeSegmentKeyOf("all")).toBeNull();
    expect(bridgeSegmentKeyOf("b2b_institution")).toBe("b2b_institution");
    expect(segmentNarrowed("all")).toBe(false);
    expect(segmentNarrowed("b2c_reduced")).toBe(true);
  });
});

describe("ziarno i strefa szeregu", () => {
  it("stała-lustro limitu punktów dziennych jest równa limitowi server fn", () => {
    expect(SERIES_DAY_GRAIN_MAX_DAYS).toBe(FINANCE_DAY_GRAIN_MAX_DAYS);
  });

  it("kubełek okna wyznacza ziarno; długie okno dzienne spada do tygodni", () => {
    expect(seriesGrainOf(resolveRevenueRange("month", NOW_MS))).toBe("day");
    expect(seriesGrainOf(resolveRevenueRange("prev-month", NOW_MS))).toBe("day");
    expect(seriesGrainOf(resolveRevenueRange("year", NOW_MS))).toBe("month");
    const long = {
      bucket: "day" as const,
      current: { sinceIso: "2026-01-01T00:00:00.000Z", untilIso: "2026-06-01T00:00:00.000Z" },
    };
    expect(seriesGrainOf(long)).toBe("week");
    expect(seriesGrainOf({ ...long, bucket: "week" })).toBe("week");
  });

  it("strefa przeglądarki pasuje do walidatora server fn", () => {
    expect(seriesTimeZone()).toMatch(/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/);
  });

  it("dzień YYYY-MM-DD to lokalna północ, bez przesunięcia", () => {
    const day = localDay("2026-03-01");
    expect([day.getFullYear(), day.getMonth(), day.getDate(), day.getHours()]).toEqual([
      2026, 2, 1, 0,
    ]);
  });
});

describe("szereg per waluta", () => {
  it("grupuje, sortuje po dniu i wskazuje największą różnicę migawki", () => {
    const groups = seriesByCurrency((clone(MRR_SERIES) as { points: MrrSeriesPoint[] }).points);
    expect(groups.map((g) => g.currency)).toEqual(["PLN", "EUR"]);
    const pln = groups[0];
    expect(pln?.points.map((p) => p.bucketStart)).toEqual(["2026-09-01", "2026-09-02"]);
    expect(pln?.maxDrift?.driftMinor).toBe(4_900);
    expect(pln?.missingSnapshots).toBe(0);
    const eur = groups[1];
    expect(eur?.maxDrift).toBeNull();
    expect(eur?.missingSnapshots).toBe(1);
  });
});

describe("tabela ruchów MRR", () => {
  const reasons = (clone(CHURN) as { reasons: ChurnReasonRow[] }).reasons;

  it("waluty jako kolumny, bez otwarcia księgi, powody pod odejściami", () => {
    const table = movementTable(BRIDGE, reasons);
    expect(table.currencies).toEqual(["PLN", "EUR"]);
    expect(table.rows.map((r) => `${r.kind}:${r.reason ?? "all"}`)).toEqual([
      "new:all",
      "expansion:all",
      "reactivation:all",
      "contraction:all",
      "churn:all",
      "churn:canceled",
      "churn:unpaid",
    ]);
    const canceled = table.rows.find((r) => r.reason === "canceled");
    expect(canceled?.movements).toBe(3);
    expect(canceled?.amounts.get("PLN")).toBe(-30_000);
    // Powód bez ruchu w EUR to zmierzone zero, nie brak danych.
    expect(canceled?.amounts.get("EUR")).toBe(0);
    expect(table.rows[0]?.amounts.get("PLN")).toBe(200_000);
  });

  it("otwarcie księgi pojawia się, gdy któraś waluta je ma; bez powodów - same rodzaje", () => {
    const withOpening = BRIDGE.map((row, i) => (i === 0 ? { ...row, openingMinor: 5_000 } : row));
    const table = movementTable(withOpening, null);
    expect(table.rows[0]?.kind).toBe("opening");
    expect(table.rows.every((r) => r.reason === null)).toBe(true);
  });

  it("waluta znana tylko z powodów: wiersze rodzajów mają brak danych, nie zero", () => {
    const usd: ChurnReasonRow = {
      reason: "currency_switch",
      movements: 1,
      amounts: [{ currency: "USD", amountMinor: -1_000 }],
    };
    const table = movementTable(BRIDGE, [usd]);
    expect(table.currencies).toEqual(["PLN", "EUR", "USD"]);
    expect(table.rows.find((r) => r.kind === "new")?.amounts.get("USD")).toBeNull();
    expect(table.rows.find((r) => r.reason === "currency_switch")?.amounts.get("USD")).toBe(-1_000);
  });
});

describe("zgodność dokumentów i zamówień", () => {
  it("werdykt z rejestru S6; zamówienia ponad księgą = odwrócony porządek", () => {
    const rows = reconciliationRows(clone(REALIZED) as RealizedDto);
    expect(rows.map((r) => r.currency)).toEqual(["PLN", "EUR"]);
    const pln = rows[0];
    expect(pln?.documentsMinor).toBe(1_180_000);
    expect(pln?.ordersMinor).toBe(900_000);
    expect(pln?.differenceMinor).toBe(280_000);
    expect(pln?.documents).toBe(100);
    expect(["aligned", "expected_drift"]).toContain(pln?.verdict);
    expect(rows[1]?.verdict).toBe("order_inverted");
  });

  it("zamówienia przy pustej księdze to zgubione dokumenty; waluta bez obu stron znika", () => {
    const dto = clone(REALIZED) as RealizedDto;
    const rows = reconciliationRows({
      ...dto,
      categories: [],
      totals: [{ currency: "USD", grossMinor: 0, refundsMinor: 0, netMinor: 0 }],
      orders: [{ currency: "CHF", amountMinor: 5_000, orders: 1 }],
    });
    expect(rows).toEqual([
      expect.objectContaining({ currency: "CHF", documentsMinor: 0, verdict: "order_inverted" }),
    ]);
  });
});
