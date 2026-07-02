// Pure A/B experiment logic: deterministic bucketing, section visibility and
// the two-proportion z-test used by the admin results page.
import { describe, expect, it } from "vitest";
import {
  assignVariant,
  collectExperimentIds,
  conversionRate,
  fnv1a,
  isSectionVisibleForAssignments,
  zScore,
} from "../experiments";
import type { SectionNode } from "../types";

const section = (
  id: string,
  abTest?: { experimentId: string; variant: "a" | "b" },
): SectionNode => ({
  id,
  kind: "section",
  children: [],
  ...(abTest ? { advanced: { abTest } } : {}),
});

describe("fnv1a", () => {
  it("is deterministic and input-sensitive", () => {
    expect(fnv1a("abc")).toBe(fnv1a("abc"));
    expect(fnv1a("abc")).not.toBe(fnv1a("abd"));
    expect(fnv1a("")).toBe(0x811c9dc5);
  });
});

describe("assignVariant", () => {
  it("is stable for the same visitor + experiment", () => {
    const v = assignVariant("exp-1", "visitor-1");
    for (let i = 0; i < 10; i++) expect(assignVariant("exp-1", "visitor-1")).toBe(v);
  });

  it("falls back to variant A without a visitor id (SSR)", () => {
    expect(assignVariant("exp-1", "")).toBe("a");
  });

  it("splits a population roughly 50/50 and independently per experiment", () => {
    let b1 = 0;
    let b2 = 0;
    const n = 2000;
    for (let i = 0; i < n; i++) {
      if (assignVariant("exp-1", `visitor-${i}`) === "b") b1++;
      if (assignVariant("exp-2", `visitor-${i}`) === "b") b2++;
    }
    expect(b1 / n).toBeGreaterThan(0.4);
    expect(b1 / n).toBeLessThan(0.6);
    expect(b2 / n).toBeGreaterThan(0.4);
    expect(b2 / n).toBeLessThan(0.6);
  });
});

describe("collectExperimentIds", () => {
  it("returns unique experiment ids in document order", () => {
    const sections = [
      section("s1", { experimentId: "x1", variant: "a" }),
      section("s2", { experimentId: "x1", variant: "b" }),
      section("s3"),
      section("s4", { experimentId: "x2", variant: "a" }),
    ];
    expect(collectExperimentIds(sections)).toEqual(["x1", "x2"]);
  });
});

describe("isSectionVisibleForAssignments", () => {
  const a = section("s1", { experimentId: "x1", variant: "a" });
  const b = section("s2", { experimentId: "x1", variant: "b" });
  const plain = section("s3");

  it("shows untagged sections always", () => {
    expect(isSectionVisibleForAssignments(plain, null)).toBe(true);
    expect(isSectionVisibleForAssignments(plain, new Map([["x1", "b"]]))).toBe(true);
  });

  it("shows variant A until assignments resolve (SSR parity)", () => {
    expect(isSectionVisibleForAssignments(a, null)).toBe(true);
    expect(isSectionVisibleForAssignments(b, null)).toBe(false);
  });

  it("shows exactly the assigned variant", () => {
    const assignments = new Map<string, "a" | "b">([["x1", "b"]]);
    expect(isSectionVisibleForAssignments(a, assignments)).toBe(false);
    expect(isSectionVisibleForAssignments(b, assignments)).toBe(true);
  });
});

describe("stats helpers", () => {
  it("computes conversion rate with a zero guard", () => {
    expect(conversionRate(0, 0)).toBe(0);
    expect(conversionRate(200, 30)).toBeCloseTo(0.15);
  });

  it("returns 0 z-score without exposures and detects a strong winner", () => {
    expect(zScore({ exposures: { a: 0, b: 100 }, conversions: { a: 0, b: 10 } })).toBe(0);
    const strong = zScore({ exposures: { a: 1000, b: 1000 }, conversions: { a: 50, b: 150 } });
    expect(strong).toBeGreaterThan(1.96);
    const inverse = zScore({ exposures: { a: 1000, b: 1000 }, conversions: { a: 150, b: 50 } });
    expect(inverse).toBeLessThan(-1.96);
  });

  it("stays below significance for near-identical variants", () => {
    const z = zScore({ exposures: { a: 500, b: 500 }, conversions: { a: 51, b: 49 } });
    expect(Math.abs(z)).toBeLessThan(1.96);
  });
});
