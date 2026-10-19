// Kontrakt `?tab=` cennika i `?tab=&tier=` członkostwa (SPEC §2.6). Oba
// walidatory jadą w powłokach tras (chunk wejściowy) - stąd test zera importów.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { bezKomentarzy } from "@/lib/ci/sourceScan";
import {
  MEMBERSHIP_TABS,
  PRICING_TABS,
  isMembershipTab,
  isPricingTab,
  parseMembershipSearch,
  parsePricingSearch,
} from "../pricingTabs";

describe("pricingTabs.ts - liść bez importów", () => {
  it("źródło nie importuje niczego (jedzie w chunku wejściowym)", () => {
    const kod = bezKomentarzy(readFileSync("src/lib/admin/pricingTabs.ts", "utf8"));
    expect(kod).not.toMatch(/^\s*import\b/m);
    expect(kod).not.toMatch(/\bimport\s*\(|\brequire\s*\(|^\s*export\s+[^;]*\bfrom\b/m);
  });
});

describe("listy zakładek", () => {
  it("cennik i członkostwo mają dokładnie zakładki paneli", () => {
    expect(PRICING_TABS).toEqual(["audiences", "tiers", "faq", "retention"]);
    expect(MEMBERSHIP_TABS).toEqual(["tiers", "mapping", "grants", "orgs"]);
  });

  it("predykaty nie mieszają list", () => {
    expect(PRICING_TABS.every(isPricingTab)).toBe(true);
    expect(MEMBERSHIP_TABS.every(isMembershipTab)).toBe(true);
    expect(isPricingTab("grants")).toBe(false);
    expect(isMembershipTab("faq")).toBe(false);
    expect(isPricingTab(null)).toBe(false);
  });
});

describe("parsePricingSearch", () => {
  it.each([
    [{}, {}],
    [{ tab: "retention" }, { tab: "retention" }],
    [{ tab: "grants" }, { tab: undefined }],
    [{ tab: 1 }, { tab: undefined }],
  ])("%j → %j", (raw, expected) => {
    expect(parsePricingSearch(raw)).toEqual(expected);
  });

  it("odrzucona wartość nadpisuje surowy adres po złożeniu przez router", () => {
    const raw = { tab: "x" };
    expect({ ...raw, ...parsePricingSearch(raw) }.tab).toBeUndefined();
  });
});

describe("parseMembershipSearch", () => {
  it.each([
    [{}, {}],
    [{ tab: "grants" }, { tab: "grants" }],
    [{ tier: "premium_plus" }, { tier: "premium_plus" }],
    [
      { tab: "tiers", tier: "essential" },
      { tab: "tiers", tier: "essential" },
    ],
    // `?tier=2026` przychodzi z routera jako liczba - wraca jako klucz.
    [{ tier: 2026 }, { tier: "2026" }],
    [{ tier: "Premium" }, { tier: undefined }],
    [{ tier: "a b" }, { tier: undefined }],
    [{ tier: "x".repeat(65) }, { tier: undefined }],
    [{ tier: -1 }, { tier: undefined }],
    [{ tier: 1.5 }, { tier: undefined }],
    [{ tab: "faq" }, { tab: undefined }],
  ])("%j → %j", (raw, expected) => {
    expect(parseMembershipSearch(raw)).toEqual(expected);
  });
});
