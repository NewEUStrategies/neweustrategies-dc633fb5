// Model zakładki „Retencja" (S7-C) - czyste reguły bez renderu.
//
// CO TEN PLIK DOWODZI.
//   1. Zakres kohort kończy się na miesiącu ostatniego dnia okna (lokalnie),
//      ma `COHORT_ROWS` miesięcy i mieści się w limicie RPC.
//   2. Siatka kohort: komórka miesiąca, który nie minął, to `null` - nigdy 0;
//      wierszy najwyżej `COHORT_ROWS`, najnowsze.
//   3. Ranking powodów: `not_given` poza rankingiem, `stripe:<kod>` jako
//      odpowiedź portalu, udział z odpowiedzi Z POWODEM.
//   4. Przepływ anulowania ma 1 albo 2 kroki - z tych samych warunków co
//      dialog czytelnika (oferta tylko przy rabacie > 0).
import { describe, expect, it } from "vitest";

import { FINANCE_MAX_MONTH_SPAN, monthSpan } from "@/lib/revenue/finance/finance.functions";
import type { CohortsDto, RetentionReasonRow } from "@/lib/revenue/finance/dto";
import { resolveRevenueRange } from "@/lib/revenue/window";
import {
  COHORT_ROWS,
  cancelFlowSteps,
  cohortGrid,
  cohortWindowOf,
  rankReasons,
} from "../retentionModel";
import { NOW_MS, clone } from "../../overview/__tests__/hubFixtures";
import { COHORTS, RETENTION_OFFERS } from "../../mrr/__tests__/financeFixtures";

describe("zakres kohort", () => {
  it("kończy się na miesiącu ostatniego dnia okna i obejmuje COHORT_ROWS miesięcy", () => {
    const range = resolveRevenueRange("prev-month", NOW_MS);
    expect(cohortWindowOf(range)).toEqual({ fromMonth: "2025-12-01", toMonth: "2026-09-01" });
    const span = monthSpan("2025-12-01", "2026-09-01");
    expect(span).toBe(COHORT_ROWS - 1);
    expect(span).toBeLessThanOrEqual(FINANCE_MAX_MONTH_SPAN);
  });

  it("okno otwarte (ten miesiąc) kończy zakres na bieżącym miesiącu", () => {
    expect(cohortWindowOf(resolveRevenueRange("month", NOW_MS)).toMonth).toBe("2026-10-01");
  });
});

describe("siatka kohort", () => {
  it("komórka miesiąca, który nie minął, to null - nigdy zero", () => {
    const grid = cohortGrid(clone(COHORTS) as CohortsDto);
    expect(grid.offsets).toHaveLength(13);
    expect(grid.rows.map((r) => r.cohortMonth)).toEqual(["2026-08-01", "2026-09-01"]);
    expect(grid.rows[0]?.shares.slice(0, 3)).toEqual([1, 0.8, null]);
    expect(grid.rows[1]?.shares.slice(0, 2)).toEqual([1, null]);
    expect(grid.rows.flatMap((r) => r.shares).filter((s) => s === 0)).toEqual([]);
  });

  it("najwyżej COHORT_ROWS najnowszych kohort", () => {
    const many: CohortsDto = {
      fromMonth: "2024-01-01",
      toMonth: "2025-12-01",
      maxOffset: 12,
      // 14 miesięcy: 2025-01 … 2026-02.
      cohorts: Array.from({ length: 14 }, (_, i) => ({
        cohortMonth: `${2025 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-01`,
        size: 1,
        retained: [{ monthOffset: 0, active: 1, share: 1 }],
      })),
    };
    const grid = cohortGrid(many);
    expect(grid.rows).toHaveLength(COHORT_ROWS);
    expect(grid.rows.at(-1)?.cohortMonth).toBe("2026-02-01");
  });
});

describe("ranking powodów rezygnacji", () => {
  it("malejąco po odpowiedziach; stripe:<kod> jako portal; udział bez „bez powodu”", () => {
    const ranked = rankReasons(
      (clone(RETENTION_OFFERS) as { reasons: RetentionReasonRow[] }).reasons,
    );
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(ranked[0]?.label).toEqual({ kind: "text", text: "Za drogo" });
    expect(ranked[1]?.label).toEqual({ kind: "stripe", code: "too_expensive" });
    expect(ranked[0]?.share).toBeCloseTo(0.5);
    expect(ranked.reduce((sum, r) => sum + (r.share ?? 0), 0)).toBeCloseTo(1);
  });

  it("not_given nie wchodzi do rankingu ani do mianownika udziału", () => {
    const ranked = rankReasons([
      { reasonId: null, reasonLabel: "not_given", responses: 50 },
      { reasonId: "a", reasonLabel: "Cena", responses: 1 },
    ]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.share).toBe(1);
    expect(rankReasons([])).toEqual([]);
  });

  it("pusty kod portalu nie zostawia pustej etykiety", () => {
    expect(
      rankReasons([{ reasonId: null, reasonLabel: "stripe:", responses: 1 }])[0]?.label,
    ).toEqual({ kind: "stripe", code: "-" });
  });
});

describe("kroki przepływu anulowania (≤ 2)", () => {
  const base = { enabled: true, discount_pct: 20, discount_periods: 3 };

  it("brak ustawień albo retencja wyłączona: samo potwierdzenie", () => {
    expect(cancelFlowSteps(null)).toEqual([{ kind: "confirm" }]);
    expect(cancelFlowSteps({ ...base, enabled: false })).toEqual([{ kind: "confirm" }]);
  });

  it("włączona bez rabatu: tylko powód; z rabatem: powód i oferta", () => {
    expect(cancelFlowSteps({ ...base, discount_pct: 0 })).toEqual([{ kind: "reason" }]);
    expect(cancelFlowSteps(base)).toEqual([
      { kind: "reason" },
      { kind: "offer", pct: 20, periods: 3 },
    ]);
  });

  it("nigdy więcej niż dwa kroki", () => {
    for (const settings of [
      null,
      base,
      { ...base, enabled: false },
      { ...base, discount_pct: 0 },
    ]) {
      expect(cancelFlowSteps(settings).length).toBeLessThanOrEqual(2);
    }
  });
});
