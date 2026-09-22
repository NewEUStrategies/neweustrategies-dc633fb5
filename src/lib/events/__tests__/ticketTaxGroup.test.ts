import { describe, expect, it } from "vitest";
import {
  clampGroupSize,
  groupTotalCents,
  guestIssues,
  guestsToPayload,
  parseTicketTaxMode,
} from "@/lib/events/ticketTaxGroup";

describe("ticketTaxGroup", () => {
  it("parses tax mode strictly", () => {
    expect(parseTicketTaxMode("inclusive")).toBe("inclusive");
    expect(parseTicketTaxMode("exclusive")).toBe("exclusive");
    expect(parseTicketTaxMode("x")).toBeNull();
    expect(parseTicketTaxMode(null)).toBeNull();
  });

  it("clamps group size to 2-50", () => {
    expect(clampGroupSize(1)).toBe(2);
    expect(clampGroupSize(99)).toBe(50);
    expect(clampGroupSize(Number.NaN)).toBe(10);
    expect(clampGroupSize(7.9)).toBe(7);
  });

  it("validates guests and blocks duplicates including the lead", () => {
    const issues = guestIssues(
      [
        { firstName: "Anna", lastName: "Nowak", email: "anna@example.com" },
        { firstName: "", lastName: "X", email: "x@example.com" },
        { firstName: "Jan", lastName: "Kow", email: "bad" },
        { firstName: "Ewa", lastName: "Lis", email: "ANNA@example.com" },
        { firstName: "Lead", lastName: "Self", email: "lead@example.com" },
      ],
      "lead@example.com",
    );
    expect(issues).toEqual([null, "name", "email", "duplicate", "duplicate"]);
  });

  it("normalises payload and totals", () => {
    expect(guestsToPayload([{ firstName: " A ", lastName: " B ", email: " A@X.PL " }])).toEqual([
      { first_name: "A", last_name: "B", email: "a@x.pl" },
    ]);
    expect(groupTotalCents(1000, 2)).toBe(3000);
    expect(groupTotalCents(1000, 0)).toBe(1000);
  });
});
