import { describe, expect, it } from "vitest";

import { buildSpeculationRules, speculationRulesJson } from "../speculationRules";

type Rules = ReturnType<typeof buildSpeculationRules>;

function denyList(where: Rules["prefetch"][number]["where"]): string[] {
  const clause = where.and.find(
    (item): item is { not: { href_matches: string[] } } =>
      "not" in item && "href_matches" in item.not,
  );
  return clause ? clause.not.href_matches : [];
}

function selectorClauses(where: Rules["prerender"][number]["where"]): string[] {
  return where.and.flatMap((item) => {
    if ("selector_matches" in item) return [item.selector_matches];
    if ("not" in item && "selector_matches" in item.not)
      return [`not:${item.not.selector_matches}`];
    return [];
  });
}

describe("speculationRules", () => {
  it("prefetchuje całą witrynę z eagerness moderate", () => {
    const rules = buildSpeculationRules();
    expect(rules.prefetch).toHaveLength(1);
    expect(rules.prefetch[0].eagerness).toBe("moderate");
  });

  it("prerenderuje WYŁĄCZNIE linki w treści artykułu", () => {
    // Poza treścią anchor powstaje jako <AppLink>, który robi preventDefault()
    // i router.navigate() - nawigacja dokumentowa nie zachodzi, więc
    // prerenderowany dokument poszedłby do kosza. Prose wchodzi przez
    // dangerouslySetInnerHTML, czyli surowym <a> - i tam prerender działa.
    const rules = buildSpeculationRules();
    expect(rules.prerender).toHaveLength(1);
    expect(rules.prerender[0].eagerness).toBe("moderate");
    expect(selectorClauses(rules.prerender[0].where)).toContain(".single-post-content a");
  });

  it("prerender pomija nową kartę i pobierane pliki", () => {
    const selectors = selectorClauses(buildSpeculationRules().prerender[0].where);
    expect(selectors).toContain("not:[target]");
    expect(selectors).toContain("not:[download]");
  });

  it("oba zestawy wykluczają powierzchnie zalogowane/transakcyjne w obu językach", () => {
    const parsed = JSON.parse(speculationRulesJson()) as Rules;
    for (const where of [parsed.prefetch[0].where, parsed.prerender[0].where]) {
      const deny = denyList(where);
      for (const expected of ["/admin", "/admin/*", "/en/admin/*", "/checkout/*", "/api/*"]) {
        expect(deny).toContain(expected);
      }
    }
  });

  it("oba zestawy honorują opt-out per link przez data-no-speculate", () => {
    const parsed = JSON.parse(speculationRulesJson()) as Rules;
    for (const where of [parsed.prefetch[0].where, parsed.prerender[0].where]) {
      expect(selectorClauses(where)).toContain("not:[data-no-speculate]");
    }
  });

  it("dokument jest identyczny dla wszystkich - bezpieczny dla cache dokumentów", () => {
    expect(speculationRulesJson()).toBe(speculationRulesJson());
  });
});
