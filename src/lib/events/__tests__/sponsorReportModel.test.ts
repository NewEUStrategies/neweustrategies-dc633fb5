// Model raportu dla sponsorów (`sponsorReportModel.ts`) - czyste funkcje
// wspólne dla studia i strony dla sponsora.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. „0%" ZAMIAST KRESKI. CTR przy zerze wyświetleń jest nieokreślony -
//      zero procent mówiłoby sponsorowi, że logo widziano i nikt nie kliknął.
//   2. NULL Z BAZY JAKO LICZBA. Generator typów udaje, że pola RETURNS TABLE są
//      niepuste; `NaN` w kaflu albo w pliku to skutek wprost.
//   3. WYKRES Z DZIURAMI. Dzień bez pomiaru musi być zerem na osi, a nie
//      brakiem punktu, który rysuje linię prosto przez pusty dzień.
//   4. KOLEJNOŚĆ TABELI. Wiersze idą w kolejności sponsorów z podsumowania,
//      a miejsca w kolejności listy `SPONSOR_PLACEMENTS`.
import { describe, expect, it } from "vitest";

import {
  ctrPercent,
  eachDay,
  fillDailyGaps,
  formatCtr,
  reportNumber,
  reportRating,
  sponsorCtr,
  sponsorPlacementRows,
  sponsorReportChartConfig,
  sponsorReportDaily,
  sponsorReportTotals,
  type SponsorDailyPoint,
} from "@/lib/events/sponsorReportModel";
import type {
  SponsorReportLeadsSeriesRow,
  SponsorReportSeriesRow,
  SponsorReportSummaryRow,
} from "@/lib/events/sponsorReportApi";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function summary(patch: Partial<SponsorReportSummaryRow>): SponsorReportSummaryRow {
  return {
    active_links: 0,
    clicks_total: 0,
    clicks_unique: 0,
    company_id: "c",
    is_published: true,
    lead_scans_total: 0,
    leads_avg_rating: 0,
    leads_consented: 0,
    leads_total: 0,
    material_opens: 0,
    meetings_accepted: 0,
    meetings_held: 0,
    meetings_total: 0,
    role: "sponsor",
    sponsor_id: A,
    sponsor_logo_url: "",
    sponsor_name: "Acme",
    tier_id: "",
    tier_name_en: "",
    tier_name_pl: "",
    tier_rank: 0,
    views_total: 0,
    views_unique: 0,
    ...patch,
  };
}

function series(patch: Partial<SponsorReportSeriesRow>): SponsorReportSeriesRow {
  return {
    clicks_total: 0,
    clicks_unique: 0,
    day: "2099-06-15",
    material_opens: 0,
    placement: "home_strip",
    sponsor_id: A,
    views_total: 0,
    views_unique: 0,
    ...patch,
  };
}

function leads(day: string, leadsNew: number): SponsorReportLeadsSeriesRow {
  return { day, leads_new: leadsNew, leads_new_consented: 0, sponsor_id: A };
}

describe("liczby z bazy", () => {
  it("reportNumber: wszystko poza skończoną liczbą to zero", () => {
    expect(reportNumber(7)).toBe(7);
    expect(reportNumber(null)).toBe(0);
    expect(reportNumber(undefined)).toBe(0);
    expect(reportNumber("5")).toBe(0);
    expect(reportNumber(Number.NaN)).toBe(0);
    expect(reportNumber(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("reportRating: brak ocen (NULL) to null, nie zero", () => {
    expect(reportRating(4.25)).toBe(4.25);
    expect(reportRating(null)).toBeNull();
    expect(reportRating(Number.NaN)).toBeNull();
  });
});

describe("CTR", () => {
  it("zero wyświetleń to null (kreska), nie 0%", () => {
    expect(sponsorCtr(0, 0)).toBeNull();
    expect(sponsorCtr(3, 0)).toBeNull();
    expect(formatCtr(null, "pl")).toBeNull();
    expect(ctrPercent(null)).toBeNull();
  });

  it("ułamek, procent z jedną cyfrą i zapis w języku panelu", () => {
    expect(sponsorCtr(1, 3)).toBeCloseTo(0.3333, 4);
    expect(ctrPercent(1 / 3)).toBe(33.3);
    expect(ctrPercent(0)).toBe(0);
    expect(formatCtr(0.034, "en")).toBe("3.4%");
    expect(formatCtr(0.034, "pl")).toBe("3,4%");
    expect(formatCtr(0, "en")).toBe("0%");
  });
});

describe("sponsorReportTotals", () => {
  const rows = [
    summary({
      sponsor_id: A,
      views_unique: 10,
      views_total: 14,
      clicks_unique: 2,
      clicks_total: 3,
      material_opens: 1,
      leads_total: 4,
      leads_consented: 2,
      meetings_total: 3,
      meetings_held: 1,
    }),
    summary({
      sponsor_id: B,
      views_unique: 5,
      views_total: null as unknown as number,
      clicks_unique: 1,
      clicks_total: 1,
      leads_total: 1,
    }),
  ];

  it("sumuje wszystkich sponsorów, a NULL liczy jak zero", () => {
    expect(sponsorReportTotals(rows, null)).toEqual({
      viewsUnique: 15,
      viewsTotal: 14,
      clicksUnique: 3,
      clicksTotal: 4,
      materialOpens: 1,
      leadsTotal: 5,
      leadsConsented: 2,
      meetingsTotal: 3,
      meetingsHeld: 1,
    });
  });

  it("z filtrem liczy tylko jednego sponsora; nieznany sponsor to same zera", () => {
    expect(sponsorReportTotals(rows, B)).toMatchObject({ viewsUnique: 5, leadsTotal: 1 });
    expect(sponsorReportTotals(rows, "x").viewsUnique).toBe(0);
    expect(sponsorReportTotals([], null).meetingsHeld).toBe(0);
  });
});

describe("dni", () => {
  it("eachDay: kolejne dni włącznie, także przez koniec miesiąca", () => {
    expect(eachDay("2099-06-29", "2099-07-02")).toEqual([
      "2099-06-29",
      "2099-06-30",
      "2099-07-01",
      "2099-07-02",
    ]);
    expect(eachDay("2099-06-15", "2099-06-15")).toEqual(["2099-06-15"]);
    expect(eachDay("2099-06-16", "2099-06-15")).toEqual([]);
  });

  it("eachDay: zły kształt daty to pusta lista, a zakres jest ucięty do 400 dni", () => {
    expect(eachDay("2099-6-1", "2099-06-02")).toEqual([]);
    expect(eachDay("2099-06-01", "jutro")).toEqual([]);
    expect(eachDay("2099-01-01", "2101-01-01")).toHaveLength(400);
  });

  const point = (day: string, viewsUnique = 1): SponsorDailyPoint => ({
    day,
    viewsUnique,
    clicksUnique: 0,
    materialOpens: 0,
    leadsNew: 0,
  });

  it("fillDailyGaps: dzień bez pomiaru to zero, kolejność rosnąca, zły dzień odpada", () => {
    expect(fillDailyGaps([point("2099-06-17", 3), point("2099-06-15", 2), point("zly")])).toEqual([
      point("2099-06-15", 2),
      point("2099-06-16", 0),
      point("2099-06-17", 3),
    ]);
    expect(fillDailyGaps([])).toEqual([]);
  });

  it("fillDailyGaps: zakres dłuższy niż limit zostaje bez wypełniania luk", () => {
    const out = fillDailyGaps([point("2099-01-01"), point("2101-01-01")]);
    expect(out.map((p) => p.day)).toEqual(["2099-01-01", "2101-01-01"]);
  });
});

describe("sponsorReportDaily", () => {
  it("łączy ekspozycje wszystkich miejsc i kontakty w jeden szereg bez luk", () => {
    const out = sponsorReportDaily(
      [
        series({ day: "2099-06-15", views_unique: 4, clicks_unique: 1 }),
        series({ day: "2099-06-15", placement: "materials", material_opens: 2 }),
        series({ day: "2099-06-17", views_unique: 1 }),
      ],
      [leads("2099-06-16", 3), leads("2099-06-18", 1)],
    );
    expect(out).toEqual([
      { day: "2099-06-15", viewsUnique: 4, clicksUnique: 1, materialOpens: 2, leadsNew: 0 },
      { day: "2099-06-16", viewsUnique: 0, clicksUnique: 0, materialOpens: 0, leadsNew: 3 },
      { day: "2099-06-17", viewsUnique: 1, clicksUnique: 0, materialOpens: 0, leadsNew: 0 },
      { day: "2099-06-18", viewsUnique: 0, clicksUnique: 0, materialOpens: 0, leadsNew: 1 },
    ]);
    expect(sponsorReportDaily([], [])).toEqual([]);
  });
});

describe("sponsorPlacementRows", () => {
  it("sumuje dni per sponsor x miejsce i sortuje: sponsor z podsumowania, potem miejsce", () => {
    const out = sponsorPlacementRows(
      [
        series({ sponsor_id: B, placement: "home_ad", views_unique: 1 }),
        series({ sponsor_id: A, placement: "materials", material_opens: 2 }),
        series({ sponsor_id: A, placement: "home_strip", views_unique: 2, views_total: 3 }),
        series({
          sponsor_id: A,
          placement: "home_strip",
          day: "2099-06-16",
          views_unique: 1,
          views_total: 1,
          clicks_unique: 1,
          clicks_total: 2,
        }),
        series({ sponsor_id: "nieznany", placement: "home_strip", views_unique: 9 }),
        series({ sponsor_id: A, placement: "billboard", views_unique: 100 }),
      ],
      [A, B],
    );
    expect(out.map((r) => [r.sponsorId, r.placement])).toEqual([
      [A, "home_strip"],
      [A, "materials"],
      [B, "home_ad"],
      ["nieznany", "home_strip"],
    ]);
    expect(out[0]).toEqual({
      sponsorId: A,
      placement: "home_strip",
      viewsUnique: 3,
      viewsTotal: 4,
      clicksUnique: 1,
      clicksTotal: 2,
      materialOpens: 0,
    });
  });
});

describe("sponsorReportChartConfig", () => {
  it("wykres liniowy bez wygładzania i animacji, legenda tylko przy kilku seriach", () => {
    const one = sponsorReportChartConfig(["a", "b"], [{ name: "Views", values: [1, 2] }]);
    expect(one).toMatchObject({
      kind: "line",
      title: "",
      categories: ["a", "b"],
      smoothing: 0,
      animate: false,
      showGrid: true,
      showLegend: false,
    });
    expect(one.series).toEqual([{ name: "Views", values: [1, 2], colorSlot: expect.any(Number) }]);
    const two = sponsorReportChartConfig(
      ["a"],
      [
        { name: "Views", values: [1] },
        { name: "Clicks", values: [0] },
      ],
    );
    expect(two.showLegend).toBe(true);
    expect(two.series[0].colorSlot).not.toBe(two.series[1].colorSlot);
  });
});
