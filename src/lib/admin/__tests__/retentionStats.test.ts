// OKNO STATYSTYK RETENCJI - to samo w zapytaniu i w liczeniu (def. 13, Z-08).
//
// Samą regułę `retentionStats` (mianownik, odpowiedzi z powodem, `null` przy
// zerze ofert) przypina `pricingRules.test.ts` (I0). Tu dowodzimy kontraktu
// S1: okno jest JEDNĄ stałą, granica odczytu jest stabilna przez dobę (część
// klucza zapytania) i nigdy węższa od okna, w którym liczy `retentionStats`.
import { describe, expect, it } from "vitest";

import {
  RETENTION_STATS_WINDOW_DAYS,
  retentionStats,
  retentionStatsSinceIso,
} from "../retentionStats";
import type { RetentionFeedbackRow } from "@/lib/retention/queries";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-10-19T15:42:10.000Z");

function row(overrides: Partial<RetentionFeedbackRow>): RetentionFeedbackRow {
  return {
    reason_label: "price",
    offer_shown: true,
    offer_accepted: false,
    created_at: new Date(NOW - DAY).toISOString(),
    ...overrides,
  } as RetentionFeedbackRow;
}

describe("RETENTION_STATS_WINDOW_DAYS", () => {
  it("okno to 90 dni", () => {
    expect(RETENTION_STATS_WINDOW_DAYS).toBe(90);
  });
});

describe("retentionStatsSinceIso", () => {
  it("początek doby UTC sprzed okna - stały przez całą dobę (stabilny klucz zapytania)", () => {
    expect(retentionStatsSinceIso(NOW)).toBe("2026-07-21T00:00:00.000Z");
    expect(retentionStatsSinceIso(Date.parse("2026-10-19T00:00:00.000Z"))).toBe(
      retentionStatsSinceIso(Date.parse("2026-10-19T23:59:59.999Z")),
    );
  });

  it("odczyt nigdy nie jest węższy od okna liczenia", () => {
    for (const now of [
      NOW,
      Date.parse("2026-01-01T00:00:00.000Z"),
      Date.parse("2026-03-29T01:30:00Z"),
    ]) {
      expect(Date.parse(retentionStatsSinceIso(now))).toBeLessThanOrEqual(
        now - RETENTION_STATS_WINDOW_DAYS * DAY,
      );
    }
  });

  it("wiersz z nadmiarowego brzegu odczytu nie wchodzi do statystyk (sygnatura `retentionStats` bez zmian)", () => {
    const sinceMs = Date.parse(retentionStatsSinceIso(NOW));
    const edge = row({
      created_at: new Date(sinceMs + 60_000).toISOString(),
      offer_accepted: true,
    });
    const inside = row({});
    const stats = retentionStats([edge, inside], NOW);
    expect(stats.total).toBe(1);
    expect(stats.accepted).toBe(0);
  });
});
