import { describe, it, expect } from "vitest";
import { escapeLike } from "@/lib/admin/listFilters";

describe("escapeLike", () => {
  it("strips LIKE wildcards and PostgREST .or() metacharacters", () => {
    // %, _, comma, parentheses, double-quote and backslash must all be removed
    // so a search phrase cannot inject extra filter conditions.
    expect(escapeLike('a,b(c)%_"\\')).toBe("abc");
  });

  it("leaves ordinary text untouched", () => {
    expect(escapeLike("hello world")).toBe("hello world");
    expect(escapeLike("Zażółć gęślą jaźń")).toBe("Zażółć gęślą jaźń");
  });

  it("neutralizes an .or()-injection attempt", () => {
    // Without escaping, this could break out of the ilike value and add
    // conditions; every dangerous character is stripped.
    const malicious = "x,status.eq.published)";
    const cleaned = escapeLike(malicious);
    expect(cleaned).not.toContain(",");
    expect(cleaned).not.toContain("(");
    expect(cleaned).not.toContain(")");
    // The comma is removed, so the injected condition collapses into the term.
    expect(cleaned).toBe("xstatus.eq.published");
  });

  it("removes standalone wildcards", () => {
    expect(escapeLike("100%_off")).toBe("100off");
  });
});
