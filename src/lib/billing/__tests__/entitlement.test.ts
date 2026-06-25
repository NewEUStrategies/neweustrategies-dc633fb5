import { describe, it, expect } from "vitest";
import { periodEndFor, entitlementForOrder } from "@/lib/billing/entitlement";

const from = new Date("2026-01-15T12:00:00.000Z");

describe("periodEndFor", () => {
  it("adds the right window per interval", () => {
    expect(periodEndFor("year", from).toISOString()).toBe("2027-01-15T12:00:00.000Z");
    expect(periodEndFor("week", from).toISOString()).toBe("2026-01-22T12:00:00.000Z");
    expect(periodEndFor("day", from).toISOString()).toBe("2026-01-16T12:00:00.000Z");
    expect(periodEndFor("month", from).toISOString()).toBe("2026-02-15T12:00:00.000Z");
  });
  it("defaults to a month for unknown/missing intervals", () => {
    expect(periodEndFor("one_time", from).toISOString()).toBe("2026-02-15T12:00:00.000Z");
    expect(periodEndFor(null, from).toISOString()).toBe("2026-02-15T12:00:00.000Z");
    expect(periodEndFor(undefined, from).toISOString()).toBe("2026-02-15T12:00:00.000Z");
  });
  it("does not mutate the input date", () => {
    const snapshot = from.toISOString();
    periodEndFor("year", from);
    expect(from.toISOString()).toBe(snapshot);
  });
});

describe("entitlementForOrder", () => {
  it("maps a subscription order to its plan", () => {
    expect(
      entitlementForOrder({
        kind: "subscription",
        plan_id: "p1",
        entity_type: null,
        entity_id: null,
      }),
    ).toEqual({ type: "subscription", planId: "p1" });
  });
  it("maps a one-time order to its entity", () => {
    expect(
      entitlementForOrder({
        kind: "one_time",
        plan_id: null,
        entity_type: "post",
        entity_id: "e1",
      }),
    ).toEqual({ type: "purchase", entityType: "post", entityId: "e1" });
  });
  it("grants nothing for incomplete orders", () => {
    expect(
      entitlementForOrder({
        kind: "subscription",
        plan_id: null,
        entity_type: null,
        entity_id: null,
      }).type,
    ).toBe("none");
    expect(
      entitlementForOrder({ kind: "one_time", plan_id: null, entity_type: "post", entity_id: null })
        .type,
    ).toBe("none");
  });
});
