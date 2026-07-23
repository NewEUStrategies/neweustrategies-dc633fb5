import { describe, expect, it } from "vitest";

import { buildSpeculationRules, speculationRulesJson } from "../speculationRules";

describe("speculationRules", () => {
  it("prefetches moderately and emits no prerender set", () => {
    const rules = buildSpeculationRules();
    expect(rules.prefetch).toHaveLength(1);
    expect(rules.prefetch[0].eagerness).toBe("moderate");
    // Prerender jest świadomie usunięty - AppLink przechwytuje nawigacje SPA,
    // więc przeglądarka nigdy nie skonsumowałaby prerenderowanego dokumentu.
    expect((rules as unknown as Record<string, unknown>).prerender).toBeUndefined();
    expect(speculationRulesJson()).not.toContain("prerender");
  });

  it("excludes logged-in/transactional surfaces in both languages", () => {
    const json = speculationRulesJson();
    const parsed = JSON.parse(json) as ReturnType<typeof buildSpeculationRules>;
    const notClause = parsed.prefetch[0].where.and.find(
      (clause): clause is { not: { href_matches: string[] } } =>
        "not" in clause && "href_matches" in clause.not,
    );
    expect(notClause).toBeDefined();
    const deny = notClause ? notClause.not.href_matches : [];
    for (const expected of ["/admin", "/admin/*", "/en/admin/*", "/checkout/*", "/api/*"]) {
      expect(deny).toContain(expected);
    }
  });

  it("keeps a per-link opt-out via data-no-speculate", () => {
    expect(speculationRulesJson()).toContain("[data-no-speculate]");
  });
});
