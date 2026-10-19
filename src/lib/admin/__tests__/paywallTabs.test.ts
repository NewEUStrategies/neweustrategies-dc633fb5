// Kontrakt `?tab=&plan=` paywalla (SPEC §2.6). Walidator jedzie w powłoce
// trasy, czyli w chunku WEJŚCIOWYM - stąd test zera importów na źródle.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { bezKomentarzy } from "@/lib/ci/sourceScan";
import { PAYWALL_TABS, isPaywallTab, parsePaywallSearch } from "../paywallTabs";

/** Tak router składa wyszukiwanie: surowy adres nadpisany walidatorem. */
const poRouterze = (raw: Record<string, unknown>): Record<string, unknown> => ({
  ...raw,
  ...parsePaywallSearch(raw),
});

const PLAN = "3f1c2a4b-5d6e-4f70-8a9b-0c1d2e3f4a5b";

describe("paywallTabs.ts - liść bez importów", () => {
  it("źródło nie importuje niczego (jedzie w chunku wejściowym)", () => {
    const kod = bezKomentarzy(readFileSync("src/lib/admin/paywallTabs.ts", "utf8"));
    expect(kod).not.toMatch(/^\s*import\b/m);
    expect(kod).not.toMatch(/\bimport\s*\(|\brequire\s*\(|^\s*export\s+[^;]*\bfrom\b/m);
  });
});

describe("PAYWALL_TABS", () => {
  it("zakładki są dokładnie takie, do jakich linkuje hub", () => {
    expect(PAYWALL_TABS).toEqual(["plans", "metering", "overrides", "checkout"]);
  });

  it("isPaywallTab przyjmuje wyłącznie zakładki z listy", () => {
    expect(PAYWALL_TABS.every(isPaywallTab)).toBe(true);
    for (const raw of ["Plans", "", "coupons", 1, null, undefined, ["plans"]]) {
      expect(isPaywallTab(raw)).toBe(false);
    }
  });
});

describe("parsePaywallSearch", () => {
  it.each([
    [{}, {}],
    [{ tab: "metering" }, { tab: "metering" }],
    [
      { tab: "checkout", plan: PLAN },
      { tab: "checkout", plan: PLAN },
    ],
    [{ plan: PLAN.toUpperCase() }, { plan: PLAN }],
    [{ tab: "nope" }, { tab: undefined }],
    [{ tab: 3 }, { tab: undefined }],
    [{ plan: "not-a-uuid" }, { plan: undefined }],
    [{ plan: `${PLAN}x` }, { plan: undefined }],
    [{ plan: 42 }, { plan: undefined }],
  ])("%j → %j", (raw, expected) => {
    expect(parsePaywallSearch(raw)).toEqual(expected);
  });

  it("nieobecne klucze nie pojawiają się w wyniku (zero śmieciowych undefined)", () => {
    expect(Object.keys(parsePaywallSearch({ tab: "plans" }))).toEqual(["tab"]);
  });

  it("odrzucona wartość nadpisuje surowy adres po złożeniu przez router", () => {
    const merged = poRouterze({ tab: "<script>", plan: "x", other: "zostaje" });
    expect(merged.tab).toBeUndefined();
    expect(merged.plan).toBeUndefined();
    expect(merged.other).toBe("zostaje");
  });
});
