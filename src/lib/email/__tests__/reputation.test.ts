import { describe, it, expect } from "vitest";
import {
  computeReputation,
  deliveredBase,
  EMPTY_COUNTS,
  formatRate,
  safeRate,
  SPAM_RATE_LIMIT,
  worseStatus,
  type DeliverabilityCounts,
} from "../reputation";

function counts(patch: Partial<DeliverabilityCounts>): DeliverabilityCounts {
  return { ...EMPTY_COUNTS, ...patch };
}

describe("safeRate", () => {
  it("never divides by zero or returns NaN", () => {
    expect(safeRate(5, 0)).toBe(0);
    expect(safeRate(Number.NaN, 10)).toBe(0);
    expect(safeRate(-3, 10)).toBe(0);
    expect(safeRate(1, 4)).toBe(0.25);
  });
});

describe("deliveredBase", () => {
  it("prefers delivered and falls back to accepted minus bounced", () => {
    expect(deliveredBase(counts({ sent: 1000, delivered: 900, bounced: 100 }))).toBe(900);
    // Webhook 'delivered' wyłączony: mianownik konserwatywny (mniejszy),
    // więc wskaźnik skarg wychodzi WYŻSZY - nigdy fałszywie uspokajający.
    expect(deliveredBase(counts({ sent: 1000, delivered: 0, bounced: 100 }))).toBe(900);
    expect(deliveredBase(counts({ sent: 0, delivered: 0, bounced: 0 }))).toBe(0);
  });
});

describe("computeReputation - progi Google", () => {
  it("stays healthy below the 0.10% target", () => {
    const r = computeReputation(counts({ sent: 10_000, delivered: 10_000, complained: 5 }));
    expect(r.complaint.rate).toBeCloseTo(0.0005, 6);
    expect(r.complaint.status).toBe("healthy");
    expect(r.blocksSending).toBe(false);
  });

  it("escalates to 'watch' between the target and the hard limit", () => {
    const r = computeReputation(counts({ sent: 10_000, delivered: 10_000, complained: 20 }));
    expect(r.complaint.rate).toBeCloseTo(0.002, 6);
    expect(r.complaint.status).toBe("watch");
    expect(r.blocksSending).toBe(false);
  });

  it("blocks sending once the complaint rate reaches 0.30%", () => {
    const r = computeReputation(counts({ sent: 10_000, delivered: 10_000, complained: 30 }));
    expect(r.complaint.rate).toBeCloseTo(SPAM_RATE_LIMIT, 6);
    expect(r.complaint.status).toBe("critical");
    expect(r.overall).toBe("critical");
    expect(r.blocksSending).toBe(true);
    expect(r.blockReasons).toContain("complaint_rate");
  });

  it("blocks on a critical hard-bounce rate too", () => {
    const r = computeReputation(
      counts({ sent: 10_000, delivered: 9_400, hardBounced: 600, bounced: 600 }),
    );
    expect(r.blockReasons).toContain("hard_bounce_rate");
    expect(r.blocksSending).toBe(true);
  });

  it("never blocks on a statistically meaningless sample", () => {
    // 1 skarga na 50 dostarczonych to 2% - alarmująco wygląda, nic nie znaczy.
    const r = computeReputation(counts({ sent: 50, delivered: 50, complained: 1 }));
    expect(r.complaint.rate).toBeCloseTo(0.02, 6);
    expect(r.complaint.status).toBe("insufficient_data");
    expect(r.blocksSending).toBe(false);
  });

  it("returns a neutral verdict for an empty history", () => {
    const r = computeReputation(EMPTY_COUNTS);
    expect(r.overall).toBe("insufficient_data");
    expect(r.blocksSending).toBe(false);
    expect(r.deliveryRate).toBe(0);
  });
});

describe("worseStatus", () => {
  it("orders severity and ignores missing data", () => {
    expect(worseStatus("healthy", "critical")).toBe("critical");
    expect(worseStatus("watch", "healthy")).toBe("watch");
    expect(worseStatus("insufficient_data", "healthy")).toBe("healthy");
  });
});

describe("formatRate", () => {
  it("keeps enough precision to read sub-promille thresholds", () => {
    // 0,05% zaokrąglone do jednego miejsca byłoby "0,1%" - czyli progiem celu.
    expect(formatRate(0.0005, "en-GB")).toBe("0.050%");
    expect(formatRate(0.003, "en-GB")).toBe("0.30%");
    expect(formatRate(0.052, "en-GB")).toBe("5.2%");
    expect(formatRate(0, "en-GB")).toBe("0%");
  });
});
