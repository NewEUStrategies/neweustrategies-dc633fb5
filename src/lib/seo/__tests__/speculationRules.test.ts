import { describe, expect, it } from "vitest";

import { PUBLIC_DOCUMENT_DENY_PREFIXES } from "@/lib/http/documentCache";
import { buildSpeculationRules, speculationRulesJson } from "../speculationRules";

type Rules = ReturnType<typeof buildSpeculationRules>;

/**
 * Rozwija grupy opcjonalne wzorca URLPattern (`{tekst}?`) do wszystkich
 * wariantów bez grup - pomocnik testu, który pozwala porównać jeden wzorzec
 * z grupami z dawną listą wzorców płaskich.
 */
function expandUrlPatternGroups(pattern: string): string[] {
  const group = /\{([^{}]*)\}\?/.exec(pattern);
  if (!group) return [pattern];
  const head = pattern.slice(0, group.index);
  const tail = pattern.slice(group.index + group[0].length);
  return [`${head}${tail}`, `${head}${group[1]}${tail}`].flatMap(expandUrlPatternGroups);
}

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
    // P3.7b, X1: jeden wzorzec z grupami URLPattern na prefiks. Rozwinięcie
    // grup opcjonalnych daje DOKŁADNIE dawną listę (4 wzorce x każdy prefiks).
    const legacy = PUBLIC_DOCUMENT_DENY_PREFIXES.flatMap((prefix) => [
      prefix,
      `${prefix}/*`,
      `/en${prefix}`,
      `/en${prefix}/*`,
    ]);
    const parsed = JSON.parse(speculationRulesJson()) as Rules;
    for (const where of [parsed.prefetch[0].where, parsed.prerender[0].where]) {
      const deny = denyList(where);
      expect(deny).toHaveLength(PUBLIC_DOCUMENT_DENY_PREFIXES.length);
      expect(deny).toContain("/{en/}?admin{/*}?");
      // Wzorzec ścieżki absolutnej: napis od `{` byłby względny wobec katalogu.
      for (const pattern of deny) expect(pattern.startsWith("/")).toBe(true);
      expect(new Set(deny.flatMap(expandUrlPatternGroups))).toEqual(new Set(legacy));
      expect(deny.flatMap(expandUrlPatternGroups)).toHaveLength(legacy.length);
    }
  });

  it("reguły są krótsze niż w wersji z czterema wzorcami na prefiks (-1,1 KB w `<head>`)", () => {
    // 2 zestawy x 17 prefiksów; dawny dokument: 2 334 B.
    expect(speculationRulesJson().length).toBeLessThan(1300);
  });

  // Node 22 nie ma `URLPattern` (jest w Chromium i w Bun) - semantykę w
  // przeglądarce sprawdza raport P3.7b (Chromium); tu biegnie tam, gdzie jest.
  const URLPatternCtor = (globalThis as { URLPattern?: new (p: string, b: string) => unknown })
    .URLPattern as (new (p: string, b: string) => { test(u: string): boolean }) | undefined;
  it.skipIf(!URLPatternCtor)("semantyka URLPattern = dawne cztery wzorce", () => {
    const base = "https://nes.test/";
    const deny = denyList(buildSpeculationRules().prefetch[0].where);
    const match = (path: string) =>
      deny.some((pattern) =>
        new URLPatternCtor!(pattern, base).test(`${base.slice(0, -1)}${path}`),
      );
    for (const path of ["/admin", "/admin/", "/admin/x/y", "/en/admin", "/en/admin/x", "/_/a"]) {
      expect(match(path), path).toBe(true);
    }
    for (const path of ["/administrator", "/en/adminx", "/enadmin", "/x/admin", "/", "/en"]) {
      expect(match(path), path).toBe(false);
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
