// Kontrakt `?tab=&status=` rozliczeń (SPEC §2.6, PLAN S1 §3.3 - kontrakt z S2).
// Walidator jedzie w powłoce trasy (chunk wejściowy) - stąd test zera importów.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { bezKomentarzy } from "@/lib/ci/sourceScan";
import { BILLING_TABS, isBillingTab, parseBillingSearch } from "../billingTabs";

describe("billingTabs.ts - liść bez importów", () => {
  it("źródło nie importuje niczego (jedzie w chunku wejściowym)", () => {
    const kod = bezKomentarzy(readFileSync("src/lib/admin/billingTabs.ts", "utf8"));
    expect(kod).not.toMatch(/^\s*import\b/m);
    expect(kod).not.toMatch(/\bimport\s*\(|\brequire\s*\(|^\s*export\s+[^;]*\bfrom\b/m);
  });
});

describe("BILLING_TABS", () => {
  it("lista = wartości TabsTrigger w AdminBillingPanel (kontrakt z S2)", () => {
    expect(BILLING_TABS).toEqual(["subscriptions", "orders", "tickets", "events", "diagnostics"]);
    const panel = readFileSync("src/components/admin/billing/AdminBillingPanel.tsx", "utf8");
    const wartosci = [...panel.matchAll(/<TabsTrigger\s+value="([^"]+)"/g)].map((m) => m[1]);
    // Po podpięciu S2 panel może iterować po `BILLING_TABS` zamiast literałów
    // - wtedy lista JEST źródłem i porównywać nie ma czego.
    if (wartosci.length === 0) expect(panel).toMatch(/\bBILLING_TABS\b/);
    else expect(wartosci).toEqual([...BILLING_TABS]);
  });

  it("isBillingTab przyjmuje wyłącznie zakładki", () => {
    expect(BILLING_TABS.every(isBillingTab)).toBe(true);
    for (const raw of ["Orders", "", "payments", 0, undefined]) {
      expect(isBillingTab(raw)).toBe(false);
    }
  });
});

describe("parseBillingSearch", () => {
  it.each([
    [{}, {}],
    [
      { tab: "orders", status: "paid" },
      { tab: "orders", status: "paid" },
    ],
    [
      { tab: "subscriptions", status: "past_due" },
      { tab: "subscriptions", status: "past_due" },
    ],
    [{ tab: "nope" }, { tab: undefined }],
    [{ status: "PAID" }, { status: undefined }],
    [{ status: "paid;drop" }, { status: undefined }],
    [{ status: "a".repeat(33) }, { status: undefined }],
    [{ status: 1 }, { status: undefined }],
  ])("%j → %j", (raw, expected) => {
    expect(parseBillingSearch(raw)).toEqual(expected);
  });

  it("odrzucona wartość nadpisuje surowy adres po złożeniu przez router", () => {
    const raw = { tab: "x", status: "Y" };
    const merged = { ...raw, ...parseBillingSearch(raw) };
    expect(merged.tab).toBeUndefined();
    expect(merged.status).toBeUndefined();
  });
});
