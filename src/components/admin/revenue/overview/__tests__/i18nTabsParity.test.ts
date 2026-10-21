// Słownik zakładek S7 (`i18n-admin-revenue-tabs.ts`) - parytet PL/EN,
// liczebniki, gałęzie i klucze zarezerwowane dla S7-C.
//
// CO TEN PLIK DOWODZI.
//   1. Słownik dokłada WYŁĄCZNIE swoje gałęzie (`overview`, `funnelTab`,
//      `accessTab`, `offer`, `inputs` i zarezerwowane `mrr`, `retention`,
//      `metrics`, `communityTab`) - żadnego klucza S2/S3/S4/S6.
//   2. Każdy napis ma PL i EN, RÓŻNE w obu językach, z tym samym zestawem
//      zmiennych `{{…}}` (zmienna zgubiona w jednym języku to pusta liczba).
//   3. Liczebniki: PL ma `_one/_few/_many/_other`, EN - `_one/_other`.
//   4. Klucze, które czyta S7-C (zakładki Przychód, Retencja, Wskaźniki,
//      Społeczność), istnieją i rozwiązują się w obu językach.
//   5. Angielskie napisy nie zawierają słów będących klasami narzędziowymi -
//      generator publicznego arkusza skanuje `src/lib/i18n-*.ts`.
import { describe, expect, it } from "vitest";

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { revenueTabsDictionaries } from "@/lib/i18n-admin-revenue-tabs";

type Tree = { readonly [key: string]: string | Tree };

function leaves(tree: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.set(path, value);
    else for (const [k, v] of leaves(value, path)) out.set(k, v);
  }
  return out;
}

const PL = leaves(revenueTabsDictionaries.pl as unknown as Tree);
const EN = leaves(revenueTabsDictionaries.en as unknown as Tree);

const PLURAL = /_(one|few|many|other)$/;
const BRANCHES = [
  "overview",
  "funnelTab",
  "accessTab",
  "offer",
  "inputs",
  "mrr",
  "retention",
  "metrics",
  "communityTab",
] as const;

/** Klucze czytane przez S7-C - kontrakt rezerwacji (STAN S7, S7.2 pkt 1). */
const RESERVED_FOR_S7C = [
  "adminRevenue.mrr.kpiHeading",
  "adminRevenue.mrr.seriesTitle",
  "adminRevenue.mrr.movementsTitle",
  "adminRevenue.mrr.movementsCaption",
  "adminRevenue.mrr.reconciliationTitle",
  "adminRevenue.mrr.reconciliationHint",
  "adminRevenue.mrr.categoriesCaption",
  "adminRevenue.retention.kpiHeading",
  "adminRevenue.retention.cancelFlowTitle",
  "adminRevenue.retention.cancelFlowSteps",
  "adminRevenue.retention.winbackTitle",
  "adminRevenue.retention.reasonsTitle",
  "adminRevenue.retention.reasonsCaption",
  "adminRevenue.retention.cohortsCaption",
  "adminRevenue.retention.notGivenOutsideRanking",
  "adminRevenue.retention.stripePortalReason",
  "adminRevenue.metrics.title",
  "adminRevenue.metrics.valuesNote",
  "adminRevenue.metrics.missingReason",
  "adminRevenue.metrics.inputsLink",
  "adminRevenue.metrics.sheetTitle",
  "adminRevenue.metrics.contextLabel",
  "adminRevenue.communityTab.sectionLabel",
  "adminRevenue.communityTab.journeysNote",
] as const;

/**
 * Słowa, które generator arkusza publicznego potraktowałby jako klasy
 * narzędziowe (wyświetlanie, pozycja, typografia, efekty).
 */
const UTILITY_WORDS = [
  "hidden",
  "visible",
  "invisible",
  "block",
  "inline",
  "flex",
  "grid",
  "table",
  "contents",
  "static",
  "fixed",
  "absolute",
  "relative",
  "sticky",
  "border",
  "shadow",
  "outline",
  "ring",
  "rounded",
  "truncate",
  "italic",
  "underline",
  "uppercase",
  "lowercase",
  "capitalize",
  "filter",
  "blur",
  "invert",
  "transform",
  "transition",
  "grow",
  "shrink",
  "collapse",
  "isolate",
  "container",
  "ordinal",
] as const;

function variables(text: string): string[] {
  return [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1] as string).sort();
}

describe("słownik zakładek S7 - gałęzie i parytet", () => {
  it("dokłada wyłącznie swoje gałęzie pod adminRevenue", () => {
    expect(Object.keys(revenueTabsDictionaries.pl)).toEqual(["adminRevenue"]);
    expect(Object.keys(revenueTabsDictionaries.pl.adminRevenue).sort()).toEqual(
      [...BRANCHES].sort(),
    );
  });

  it("PL i EN mają ten sam zbiór kluczy", () => {
    expect([...EN.keys()].sort()).toEqual([...PL.keys()].sort());
  });

  it.each([...PL.keys()])("%s: PL ≠ EN i te same zmienne", (key) => {
    const pl = PL.get(key) as string;
    const en = EN.get(key) as string;
    expect(pl.trim().length, key).toBeGreaterThan(0);
    expect(en.trim().length, key).toBeGreaterThan(0);
    expect(pl, key).not.toBe(en);
    expect(variables(en), key).toEqual(variables(pl));
  });

  it("liczebniki: PL _one/_few/_many/_other, EN co najmniej _one/_other", () => {
    const families = new Set(
      [...PL.keys()].filter((k) => PLURAL.test(k)).map((k) => k.replace(PLURAL, "")),
    );
    expect(families.size).toBeGreaterThan(5);
    for (const family of families) {
      for (const form of ["one", "few", "many", "other"]) {
        expect(PL.has(`${family}_${form}`), `${family}_${form}`).toBe(true);
      }
      for (const form of ["one", "other"]) {
        expect(EN.has(`${family}_${form}`), `${family}_${form}`).toBe(true);
      }
      expect(PL.get(`${family}_one`), family).toContain("{{count}}");
    }
  });

  it("angielskie napisy nie zawierają słów-klas narzędziowych", () => {
    const pattern = new RegExp(`\\b(${UTILITY_WORDS.join("|")})\\b`, "i");
    const offenders = [...EN.entries()].filter(([, text]) => pattern.test(text));
    expect(offenders).toEqual([]);
  });
});

describe("klucze zarezerwowane dla S7-C (Przychód, Retencja, Wskaźniki, Społeczność)", () => {
  it.each(RESERVED_FOR_S7C)("%s rozwiązuje się po polsku i po angielsku", (key) => {
    const pl = i18n.getFixedT("pl")(key, { count: 2, code: "x", reason: "y", name: "z" });
    const en = i18n.getFixedT("en")(key, { count: 2, code: "x", reason: "y", name: "z" });
    expect(pl, key).not.toBe(key);
    expect(en, key).not.toBe(key);
    expect(pl).not.toBe(en);
  });

  it("liczebnik kroków anulowania odmienia się po polsku", () => {
    const t = i18n.getFixedT("pl");
    expect(t("adminRevenue.retention.cancelFlowSteps", { count: 1 })).toBe("1 krok do anulowania");
    expect(t("adminRevenue.retention.cancelFlowSteps", { count: 2 })).toBe("2 kroki do anulowania");
    expect(t("adminRevenue.retention.cancelFlowSteps", { count: 5 })).toBe(
      "5 kroków do anulowania",
    );
  });
});
