// Model zakładki „Wskaźniki" - wartości słownika i powód każdego braku.
//
// CO TEN PLIK DOWODZI.
//   1. Wartości pochodzą z migawki S6 (kanoniczna liczba wpisu) i z ekonomiki
//      S2 (ostatni miesiąc okna w walucie słownika) - bez trzeciego źródła.
//   2. Kwoty w JEDNEJ walucie słownika: pozycja listy `money`, nigdy suma;
//      brak waluty na liście = `null` z powodem „inne waluty", nie 0.
//   3. Każdy wskaźnik huba bez wartości ma powód: rola, źródło, historia
//      krótsza niż 12 miesięcy („dane od …"), okno inne niż 12 miesięcy,
//      brakujące dane wejściowe (przecięcie `missing[]` z wejściami
//      wskaźnika), brak mianownika albo „hub jeszcze nie liczy".
//   4. Redaktor: ekonomika i kwoty = „widzi administrator", bez odczytu.
//   5. Grupy powodów: najpierw to, co admin naprawi sam (dane wejściowe).
//   6. Adres: `?metric=` tylko z rejestru, miesiące ekonomiki lokalne.
import { describe, expect, it } from "vitest";

import { HUB_METRIC_IDS, METRICS, type MetricId } from "@/lib/analytics/semantic/metrics";
import type { RevenueSnapshotResult } from "@/lib/analytics/semantic/revenueSnapshot.functions";
import type { EconomicsDto } from "@/lib/revenue/finance/dto";
import { resolveRevenueRange } from "@/lib/revenue/window";
import {
  ECONOMICS_INPUTS,
  addMonthsToDay,
  benchSegmentOf,
  dictionaryCurrencyOf,
  economicsMonthsOf,
  economicsStateOf,
  metricOfParam,
  metricValuesModel,
  missingGroups,
  type EconomicsState,
} from "../metricsModel";
import { NOW_MS, clone } from "../../overview/__tests__/hubFixtures";
import { ECONOMICS, metricsSnapshot } from "./metricsFixtures";

const RANGE = resolveRevenueRange("prev-month", NOW_MS);

function ready(dto: unknown = ECONOMICS): EconomicsState {
  return { state: "ready", dto: clone(dto) as EconomicsDto };
}

function model(snapshot: RevenueSnapshotResult, economics: EconomicsState = ready()) {
  return metricValuesModel({ snapshot, economics, currencyFilter: null, range: RANGE });
}

describe("wartości słownika", () => {
  it("migawka: kanoniczna liczba wpisu; kwota w walucie wiodącej z listy, bez sumy", () => {
    const m = model(metricsSnapshot("admin"));
    expect(m.currency).toBe("PLN");
    expect(m.values.get("logo_churn_monthly")).toBe(0.03);
    // MRR w PLN i EUR - słownik bierze PLN (1 200 000), nie 1 310 000.
    expect(m.values.get("mrr")).toBe(1_200_000);
  });

  it("filtr waluty: kwota z pozycji EUR; brak EUR na liście = null z powodem, nie 0", () => {
    const m = metricValuesModel({
      snapshot: metricsSnapshot("admin"),
      economics: ready(),
      currencyFilter: "EUR",
      range: RANGE,
    });
    expect(m.values.get("mrr")).toBe(110_000);
    expect(m.values.get("revenue_realized")).toBeNull();
    expect(m.missing.get("revenue_realized")).toEqual({
      kind: "other_currency",
      currencies: ["PLN"],
    });
  });

  it("ekonomika: ostatni miesiąc okna w walucie słownika", () => {
    const m = model(metricsSnapshot("admin"));
    expect(m.values.get("cac")).toBe(25_000);
    expect(m.values.get("subscription_gross_margin")).toBe(0.7);
    expect(m.values.get("ltv")).toBe(800_000);
    expect(m.missing.has("cac")).toBe(false);
  });

  it("dictionaryCurrencyOf: filtr, potem pierwsza pozycja MRR, potem dowolna kwota", () => {
    expect(dictionaryCurrencyOf({ money: {} }, "EUR")).toBe("EUR");
    expect(dictionaryCurrencyOf(metricsSnapshot("admin"), null)).toBe("PLN");
    expect(
      dictionaryCurrencyOf({ money: { arpa: [{ currency: "CZK", amountMinor: 1 }] } }, null),
    ).toBe("CZK");
    expect(dictionaryCurrencyOf({ money: {} }, null)).toBeNull();
  });
});

describe("powody braków", () => {
  it("brak danych wejściowych - tylko wejścia, których potrzebuje dany wskaźnik", () => {
    const m = model(metricsSnapshot("admin"));
    // W fiksturze brakuje marży EBITDA - Reguła 40 jej potrzebuje, CAC nie.
    expect(m.missing.get("rule_of_40")).toEqual({ kind: "inputs", inputs: ["ebitda_margin_pct"] });
    expect(m.values.get("rule_of_40")).toBeNull();
  });

  it("NRR przed upływem 12 miesięcy od początku księgi - „dane od …”, nie 0", () => {
    const m = model(metricsSnapshot("admin", { dataSince: "2026-03-01" }));
    expect(m.values.get("net_revenue_retention")).toBeNull();
    expect(m.missing.get("net_revenue_retention")).toEqual({
      kind: "history",
      since: "2026-03-01",
      full: "2027-03-01",
    });
  });

  it("churn roczny poza oknem 12 miesięcy - powód „wybierz 12 miesięcy”", () => {
    const m = model(metricsSnapshot("admin"));
    expect(m.missing.get("logo_churn_annual")).toEqual({ kind: "full_year" });
  });

  it("strumień niedostępny i brak mianownika", () => {
    const m = model(metricsSnapshot("admin"));
    expect(m.missing.get("email_open_rate")).toEqual({ kind: "not_configured" });
    expect(m.missing.get("checkout_conversion_rate")).toEqual({ kind: "no_base" });
  });

  it("wskaźnik, którego hub nie liczy - „nie liczy jeszcze”, bez wartości w mapie", () => {
    const m = model(metricsSnapshot("admin"));
    expect(m.values.has("dau_mau")).toBe(false);
    expect(m.missing.get("dau_mau")).toEqual({ kind: "not_measured" });
  });

  it("redaktor: kwoty i ekonomika = „widzi administrator”", () => {
    const m = model(metricsSnapshot("editor"), { state: "skipped" });
    const adminOnly: MetricId[] = ["mrr", "revenue_realized", "logo_churn_monthly", "cac", "ltv"];
    for (const id of [...adminOnly, "rule_of_40" as const]) {
      expect(m.missing.get(id), id).toEqual({ kind: "admin_only" });
    }
    // Strumień społeczności redaktor czyta - liczba zostaje.
    expect(m.values.get("event_attendance_rate")).toBe(0.75);
  });

  it("ekonomika w drodze albo z awarią - powód stanu, nie „brak danych”", () => {
    expect(model(metricsSnapshot("admin"), { state: "loading" }).missing.has("cac")).toBe(false);
    expect(model(metricsSnapshot("admin"), { state: "unavailable" }).missing.get("cac")).toEqual({
      kind: "not_configured",
    });
    expect(model(metricsSnapshot("admin"), { state: "error" }).missing.get("cac")).toEqual({
      kind: "read_failed",
    });
  });

  it("każdy wskaźnik huba ma wartość albo powód (żadnej cichej kreski)", () => {
    const m = model(metricsSnapshot("admin"));
    for (const id of HUB_METRIC_IDS) {
      const value = m.values.get(id);
      expect(value !== undefined && value !== null ? true : m.missing.has(id), id).toBe(true);
    }
  });

  it("grupy: najpierw dane wejściowe, wskaźniki w kolejności rejestru", () => {
    const groups = missingGroups(model(metricsSnapshot("admin")).missing);
    expect(groups[0].reason.kind).toBe("inputs");
    for (const group of groups) {
      const order = group.metricIds.map((id) => HUB_METRIC_IDS.indexOf(id));
      expect(order).toEqual([...order].sort((a, b) => a - b));
    }
  });

  it("mapa wejść ekonomiki: wskaźniki z rejestru, wejścia z listy rodzajów", () => {
    for (const id of Object.keys(ECONOMICS_INPUTS)) {
      expect(HUB_METRIC_IDS).toContain(id as MetricId);
    }
  });
});

describe("adres i okno", () => {
  it("?metric= tylko z rejestru", () => {
    expect(metricOfParam("net_revenue_retention")).toBe("net_revenue_retention");
    expect(metricOfParam(METRICS[0].id)).toBe(METRICS[0].id);
    expect(metricOfParam("nope")).toBeNull();
    expect(metricOfParam(undefined)).toBeNull();
  });

  it("miesiące ekonomiki: od miesiąca początku do miesiąca OSTATNIEGO dnia okna", () => {
    expect(economicsMonthsOf(RANGE)).toEqual({ fromMonth: "2026-09-01", toMonth: "2026-09-01" });
    expect(economicsMonthsOf(resolveRevenueRange("ltm", NOW_MS))).toEqual({
      fromMonth: "2025-10-01",
      toMonth: "2026-09-01",
    });
  });

  it("addMonthsToDay: koniec miesiąca nie przeskakuje", () => {
    expect(addMonthsToDay("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsToDay("2026-03-01", 12)).toBe("2027-03-01");
  });

  it("segment huba jako kontekst benchmarku; „wszystkie” = domyślny", () => {
    expect(benchSegmentOf(null)).toBeUndefined();
    expect(benchSegmentOf("all")).toBeUndefined();
    expect(benchSegmentOf("b2b_institution")).toBe("b2b_institution");
  });

  it("stan ekonomiki: wyłączona = pominięta, odmowa = pominięta", () => {
    expect(economicsStateOf(undefined, { enabled: false, isError: false })).toEqual({
      state: "skipped",
    });
    expect(economicsStateOf({ state: "forbidden" }, { enabled: true, isError: false })).toEqual({
      state: "skipped",
    });
    expect(economicsStateOf(undefined, { enabled: true, isError: true })).toEqual({
      state: "error",
    });
  });
});
