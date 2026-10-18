import { afterEach, describe, expect, it } from "vitest";
import { Constants } from "@/integrations/supabase/types";
import {
  dateRangeToIso,
  deriveSettlementStatus,
  filterSettlementRows,
  type SettlementRow,
} from "@/lib/billing/settlementStatus";

describe("deriveSettlementStatus", () => {
  it("opłacone z częściowym zwrotem to zwrot częściowy", () => {
    expect(deriveSettlementStatus("paid", 4900, 1000)).toBe("partially_refunded");
  });
  it("opłacone ze zwrotem całej kwoty to zwrócone", () => {
    expect(deriveSettlementStatus("paid", 4900, 4900)).toBe("refunded");
  });
  it("opłacone bez zwrotu zostaje opłacone", () => {
    expect(deriveSettlementStatus("paid", 4900, 0)).toBe("paid");
  });
  it("opłacone z kwotą zero i niezerowym zwrotem to zwrot częściowy, nie całkowity", () => {
    expect(deriveSettlementStatus("paid", 0, 100)).toBe("partially_refunded");
  });
  it("każdy inny status bazy jest stanem rozliczenia wprost - także przy kwocie zwrotu", () => {
    for (const status of Constants.public.Enums.order_status) {
      if (status === "paid") continue;
      expect(deriveSettlementStatus(status, 4900, 0)).toBe(status);
      expect(deriveSettlementStatus(status, 4900, 1000)).toBe(status);
    }
  });
});

describe("dateRangeToIso", () => {
  it("dzień 'do' jest włączny - koniec to północ dnia następnego", () => {
    const { fromIso, toIso } = dateRangeToIso("2026-10-01", "2026-10-01");
    expect(fromIso).not.toBeNull();
    expect(toIso).not.toBeNull();
    expect(new Date(toIso ?? "").getTime() - new Date(fromIso ?? "").getTime()).toBe(86_400_000);
  });
  it("puste lub błędne daty nie ograniczają zakresu", () => {
    expect(dateRangeToIso("", "abc")).toEqual({ fromIso: null, toIso: null });
  });

  describe("w strefie Europe/Warsaw", () => {
    const ORIGINAL_TZ = process.env.TZ;
    afterEach(() => {
      if (ORIGINAL_TZ === undefined) delete process.env.TZ;
      else process.env.TZ = ORIGINAL_TZ;
    });

    it("granice to lokalne północe, a doba zmiany czasu ma 25 godzin", () => {
      // Dzień z pola daty jest dniem LOKALNYM administratora: 1 października
      // zaczyna się w Warszawie o 22:00 UTC dnia poprzedniego. 25 października
      // 2026 zegar cofa się o godzinę - koniec tej doby to 23:00 UTC.
      process.env.TZ = "Europe/Warsaw";
      expect(dateRangeToIso("2026-10-01", "2026-10-25")).toEqual({
        fromIso: "2026-09-30T22:00:00.000Z",
        toIso: "2026-10-25T23:00:00.000Z",
      });
      expect(dateRangeToIso("2026-10-25", "")).toEqual({
        fromIso: "2026-10-24T22:00:00.000Z",
        toIso: null,
      });
    });
  });
});

describe("filterSettlementRows", () => {
  const row = (id: string, status: SettlementRow["status"]): SettlementRow => ({
    id,
    createdAt: "2026-10-01T10:00:00.000Z",
    kind: "one_time",
    status,
    amountCents: 100,
    refundedCents: 0,
    currency: "PLN",
    environment: "sandbox",
    refundJobState: null,
    refundJobError: null,
    needsReview: false,
  });
  it("filtruje po statusie, 'all' zwraca wszystko", () => {
    const rows = [row("a", "paid"), row("b", "refunded")];
    expect(filterSettlementRows(rows, "refunded").map((r) => r.id)).toEqual(["b"]);
    expect(filterSettlementRows(rows, "all")).toHaveLength(2);
  });
});
