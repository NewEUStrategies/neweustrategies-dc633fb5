// Stan „w przygotowaniu" zakładek huba (I9a): dane z `tabPreparing.ts`.
//
// CO TEN PLIK DOWODZI.
//   1. Każda zakładka ma etap zgodny z kolejką (S7; Ścieżki S5+S8; Wskaźniki
//      - słownik S6 już działa, wartości S7) - zmiana planu bez zmiany tu ma
//      się zapalić.
//   2. Każdy odnośnik prowadzi na STAŁĄ trasę z `routeTree.gen.ts` (nie 404,
//      nie szablon z parametrem) z parametrami z kontraktu deep linków SPEC
//      §2.6 i nigdy z powrotem do huba.
//   3. Razem odnośniki pokrywają moduły, w których dane huba są dziś
//      (paywall, cennik, rozliczenia, CRM, newsletter, kupony, wydarzenia,
//      kluby, BI) - zakładka nie zostawia admina bez następnego kroku.
//   4. Każdy klucz ma napis PL i EN, różny w obu językach.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import "@/lib/i18n-admin-revenue";
import "@/lib/i18n-admin-revenue-shell";
import "@/lib/i18n-admin-revenue-preparing";
import {
  TAB_PREPARING,
  TAB_STAGE_KEY,
  TAB_TITLE_KEY,
  type RevenueTabStage,
} from "@/lib/admin/revenue/tabPreparing";
import { REVENUE_TABS, type RevenueTabId } from "@/lib/revenue/search";

const ROUTE_PATHS: ReadonlySet<string> = new Set(
  [...readFileSync("src/routeTree.gen.ts", "utf8").matchAll(/fullPath: '([^']+)'/g)].map((m) =>
    m[1] === "/" ? "/" : m[1].replace(/\/$/, ""),
  ),
);

/** Wartości `search` z kontraktu deep linków SPEC §2.6 (lustro `hubTabs.test.ts`). */
const MODULE_SEARCH_CONTRACT: Readonly<
  Record<string, Readonly<Record<string, readonly string[]>>>
> = {
  "/admin/paywall": { tab: ["plans", "metering", "checkout", "overrides"] },
  "/admin/pricing": { tab: ["audiences", "tiers", "faq", "retention"] },
  "/admin/billing": { tab: ["subscriptions", "orders", "events"] },
  "/admin/workflows": { tab: ["definitions"] },
};

function bothLanguages(key: string): { pl: string; en: string } {
  return { pl: i18n.getFixedT("pl")(key), en: i18n.getFixedT("en")(key) };
}

const EXPECTED_STAGE: Readonly<Record<RevenueTabId, RevenueTabStage>> = {
  overview: "s7",
  mrr: "s7",
  funnel: "s7",
  retention: "s7",
  community: "s7",
  diagnostics: "s7",
  offer: "s7",
  access: "s7",
  journeys: "s5s8",
  metrics: "s6s7",
  inputs: "s7",
};

describe("TAB_PREPARING - etap, opis i odnośniki każdej zakładki", () => {
  it.each(REVENUE_TABS)("%s: etap zgodny z kolejką S5 → S7 → S8 → I9", (tab) => {
    expect(TAB_PREPARING[tab].stage).toBe(EXPECTED_STAGE[tab]);
  });

  it.each(REVENUE_TABS)("%s: odnośniki na stałe trasy z parametrami z kontraktu", (tab) => {
    const { links } = TAB_PREPARING[tab];
    expect(links.length).toBeGreaterThan(0);
    expect(new Set(links.map((l) => l.labelKey)).size).toBe(links.length);
    for (const link of links) {
      expect(ROUTE_PATHS.has(link.to), link.to).toBe(true);
      expect(link.to.startsWith("/admin/revenue"), link.to).toBe(false);
      for (const [key, value] of Object.entries(link.search ?? {})) {
        expect(MODULE_SEARCH_CONTRACT[link.to]?.[key], `${link.to}?${key}`).toContain(value);
      }
    }
  });

  it("razem pokrywają moduły, w których dane huba są już dziś", () => {
    const targets = new Set(
      REVENUE_TABS.flatMap((tab) => TAB_PREPARING[tab].links.map((link) => link.to)),
    );
    for (const module of [
      "/admin/paywall",
      "/admin/pricing",
      "/admin/billing",
      "/admin/crm",
      "/admin/newsletter",
      "/admin/coupons",
      "/admin/events",
      "/admin/community/clubs",
      "/admin/analytics/bi",
    ]) {
      expect(targets.has(module), module).toBe(true);
    }
  });

  it("dostęp prowadzi do ustawień kasy - tam admin ustawia okno porzucenia", () => {
    expect(TAB_PREPARING.access.links).toContainEqual(
      expect.objectContaining({ to: "/admin/paywall", search: { tab: "checkout" } }),
    );
  });
});

describe("słownik stanu „w przygotowaniu” - PL i EN", () => {
  const keys = new Set<string>([
    "adminRevenue.common.pending",
    "adminRevenue.preparing.partial",
    "adminRevenue.preparing.whatLabel",
    "adminRevenue.preparing.whenLabel",
    "adminRevenue.preparing.todayLabel",
    ...Object.values(TAB_STAGE_KEY),
    ...Object.values(TAB_TITLE_KEY),
    ...REVENUE_TABS.flatMap((tab) => [
      TAB_PREPARING[tab].whatKey,
      ...TAB_PREPARING[tab].links.map((link) => link.labelKey),
    ]),
  ]);

  it.each([...keys])("%s ma napis PL i EN, różny w obu językach", (key) => {
    expect(i18n.exists(key, { lng: "pl", fallbackLng: false }), key).toBe(true);
    expect(i18n.exists(key, { lng: "en", fallbackLng: false }), key).toBe(true);
    const { pl, en } = bothLanguages(key);
    expect(pl).not.toBe(en);
  });

  it("etap mówi o kolejności prac, a Ścieżki o obu wycinkach (S5 i S8)", () => {
    expect(bothLanguages(TAB_STAGE_KEY.s7).pl).toContain("S5 → S7 → S8 → I9");
    const journeys = bothLanguages(TAB_STAGE_KEY.s5s8);
    expect(journeys.pl).toMatch(/S5.*S8/);
    expect(journeys.en).toMatch(/S5.*S8/);
  });
});
