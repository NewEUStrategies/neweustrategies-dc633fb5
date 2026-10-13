import { describe, expect, it } from "vitest";
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
  it("cancelled mapuje się na canceled", () => {
    expect(deriveSettlementStatus("cancelled", 100, 0)).toBe("canceled");
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
});

describe("filterSettlementRows", () => {
  const row = (id: string, status: SettlementRow["status"]): SettlementRow => ({
    id,
    createdAt: "2026-10-01T10:00:00.000Z",
    kind: "one_time",
    status,
    rawStatus: status,
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
