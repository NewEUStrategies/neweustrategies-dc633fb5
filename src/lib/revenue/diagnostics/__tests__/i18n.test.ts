// Słownik diagnostyki (S7, SPEC §6.7) - parytet kodów unii z napisami.
//
// Klucze reguł i dowodów składa się z identyfikatorów (`findingText.ts`),
// więc ogólna bramka parytetu nie wie, KTÓRE identyfikatory muszą mieć
// napis. Ten test zestawia słownik z zamkniętymi listami: każdy
// `RevenueCheckId` i `RevenueFixDialogId` ma tytuł i opis PL i EN (różne),
// każdy klucz dowodu użyty w `checks/*.ts` istnieje w obu językach
// z kompletem form liczebnika, a nakładka nie dubluje gałęzi powłoki S6.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { revenueDiagnosticsDictionaries } from "@/lib/i18n-admin-revenue-diagnostics";
import { realT } from "@/test/i18nReal";
import { REVENUE_CHECK_IDS, REVENUE_FIX_DIALOG_IDS } from "../registry";

type Tree = { readonly [key: string]: string | Tree };

const { pl, en } = revenueDiagnosticsDictionaries as unknown as { pl: Tree; en: Tree };

function at(tree: Tree, path: string): string | Tree | undefined {
  let node: string | Tree | undefined = tree;
  for (const part of path.split(".")) {
    if (node === undefined || typeof node === "string") return undefined;
    node = node[part];
  }
  return node;
}

function leaf(tree: Tree, path: string): string | undefined {
  const value = at(tree, path);
  return typeof value === "string" ? value : undefined;
}

const PL_PLURALS = ["_one", "_few", "_many", "_other"] as const;
const EN_PLURALS = ["_one", "_other"] as const;

/** Klucz prosty albo komplet form liczebnika (PL: 4 formy, EN: co najmniej 2). */
function hasKey(tree: Tree, path: string, plurals: readonly string[]): boolean {
  if (leaf(tree, path) !== undefined) return true;
  return plurals.every((suffix) => (leaf(tree, `${path}${suffix}`) ?? "").length > 0);
}

/** Klucze dowodów z `ev("…")` w regułach (także gałęzie warunkowe `a ? "x" : "y"`). */
function evidenceKeys(): string[] {
  const dir = join(process.cwd(), "src/lib/revenue/diagnostics/checks");
  const keys = new Set<string>();
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".ts"))) {
    const source = readFileSync(join(dir, file), "utf8");
    for (const [, first] of source.matchAll(/\bev\(\s*([^,)]+?)\s*[,)]/g)) {
      for (const [, key] of first!.matchAll(/"([A-Za-z0-9]+)"/g)) keys.add(key!);
    }
    // Ślepe zaułki paywalla podają klucz pomocnikowi (`deadEnd(fakt, "klucz")`).
    for (const [, key] of source.matchAll(
      /\bdeadEnd\(\s*areaFacts\([^)]*\)\?\.\w+,\s*"([A-Za-z0-9]+)"\s*\)/g,
    )) {
      keys.add(key!);
    }
  }
  return [...keys].sort();
}

describe("reguły: każdy RevenueCheckId ma napis PL i EN", () => {
  it.each(REVENUE_CHECK_IDS.map((id) => [id] as const))("%s", (id) => {
    for (const part of ["title", "description"] as const) {
      const key = `adminRevenue.checks.${id}.${part}`;
      const plText = leaf(pl, key);
      const enText = leaf(en, key);
      expect(plText, `PL ${key}`).toBeTruthy();
      expect(enText, `EN ${key}`).toBeTruthy();
      expect(enText, `PL = EN ${key}`).not.toBe(plText);
    }
  });

  it("gałąź reguł nie ma wpisów spoza rejestru (martwe klucze)", () => {
    const checks = at(pl, "adminRevenue.checks") as Tree;
    const ids = Object.entries(checks).flatMap(([area, rules]) =>
      Object.keys(rules as Tree).map((rule) => `${area}.${rule}`),
    );
    expect(ids.sort()).toEqual([...REVENUE_CHECK_IDS].sort());
  });
});

describe("naprawy: każdy RevenueFixDialogId ma napis PL i EN", () => {
  it.each(REVENUE_FIX_DIALOG_IDS.map((id) => [id] as const))("%s", (id) => {
    for (const part of ["title", "description"] as const) {
      const key = `adminRevenue.fix.${id}.${part}`;
      const plText = leaf(pl, key);
      const enText = leaf(en, key);
      expect(plText, `PL ${key}`).toBeTruthy();
      expect(enText, `EN ${key}`).toBeTruthy();
      expect(enText, `PL = EN ${key}`).not.toBe(plText);
    }
    expect(at(pl, `adminRevenue.fix.${id}.option`), `opcje ${id}`).toBeTypeOf("object");
  });
});

describe("dowody z reguł", () => {
  const keys = evidenceKeys();

  it("skan reguł znalazł klucze dowodów", () => {
    expect(keys.length).toBeGreaterThanOrEqual(50);
  });

  it.each(keys.map((key) => [key] as const))("%s ma PL i EN (z formami liczebnika)", (key) => {
    expect(hasKey(pl, `adminRevenue.evidence.${key}`, PL_PLURALS), `PL ${key}`).toBe(true);
    expect(hasKey(en, `adminRevenue.evidence.${key}`, EN_PLURALS), `EN ${key}`).toBe(true);
  });

  it("gałąź dowodów nie ma kluczy, których żadna reguła nie emituje", () => {
    const evidence = at(pl, "adminRevenue.evidence") as Tree;
    const base = new Set(Object.keys(evidence).map((k) => k.replace(/_(one|few|many|other)$/, "")));
    expect([...base].sort()).toEqual(keys);
  });

  it("liczebnik PL rozwiązuje się w prawdziwym i18next (2 → few, 5 → many)", () => {
    const t = realT("pl");
    expect(t("adminRevenue.evidence.planWithoutTier", { count: 2, selling: 1 })).toBe(
      "2 plany bez warstwy (w sprzedaży: 1)",
    );
    expect(t("adminRevenue.evidence.planWithoutTier", { count: 5, selling: 0 })).toBe(
      "5 planów bez warstwy (w sprzedaży: 0)",
    );
    expect(realT("en")("adminRevenue.checks.sync.emit_errors.title")).toBe(
      leaf(en, "adminRevenue.checks.sync.emit_errors.title"),
    );
  });
});

describe("granice nakładki", () => {
  it("nie dubluje gałęzi powłoki S6 (`adminRevenue.area`, `adminRevenue.severity`)", () => {
    const root = at(pl, "adminRevenue") as Tree;
    expect(Object.keys(root)).not.toContain("area");
    expect(Object.keys(root)).not.toContain("severity");
  });

  it("korzenie gałęzi = zakres karty S7 (diagnostics, attention, signal, snooze, fix, evidence, checks)", () => {
    expect(Object.keys(at(pl, "adminRevenue") as Tree).sort()).toEqual(
      ["attention", "checks", "diagnostics", "evidence", "fix", "signal", "snooze"].sort(),
    );
  });

  it("napisy bez PII i bez rozbieżnych zmiennych interpolacji PL ↔ EN", () => {
    const vars = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map(([, v]) => v).sort();
    const walk = (node: Tree, path: string[]) => {
      for (const [key, value] of Object.entries(node)) {
        const here = [...path, key];
        if (typeof value === "string") {
          const enValue = leaf(en, here.join("."));
          expect(enValue, here.join(".")).toBeDefined();
          // Formy `_few`/`_many` w EN są wymuszone typem (`typeof pl`) - zmienne te same.
          expect(vars(enValue ?? ""), here.join(".")).toEqual(vars(value));
          expect(value).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
        } else {
          walk(value, here);
        }
      }
    };
    walk(pl, []);
  });
});
