// Słownik lejka i dostępu (S3): kody unii mają etykietę PL i EN, a PL ≠ EN.
//
// Bramka parytetu (`i18nParity.gate.test.ts`) pilnuje kluczy całego prefiksu
// `adminRevenue`, ale nie wie, KTÓRE kody muszą mieć etykietę - nowy etap
// lejka albo nowe źródło rejestracji dopisane w TS bez słownika dałoby surowy
// klucz na ekranie. Ten test czyta listy z kontraktu i sprawdza słownik.
import { describe, expect, it } from "vitest";
import { revenueFunnelDictionaries } from "@/lib/i18n-admin-revenue-funnel";
import {
  REVENUE_FUNNEL_STAGES,
  SALES_FUNNEL_STAGES,
  SIGNUP_SOURCES,
} from "@/lib/revenue/funnel/funnelStages";
import { PAYWALL_HIT_REASONS } from "@/lib/revenue/limits";
import { REVENUE_TRACKS } from "@/lib/revenue/search";
import { ACCESS_MODES } from "@/lib/revenue/access/parse";

const { pl, en } = revenueFunnelDictionaries;

type Tree = { [key: string]: string | Tree };

function leaves(tree: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.set(path, value);
    else for (const [k, v] of leaves(value, path)) out.set(k, v);
  }
  return out;
}

const plLeaves = leaves(pl as unknown as Tree);
const enLeaves = leaves(en as unknown as Tree);

describe("parytet słownika lejka i dostępu", () => {
  it("te same klucze w PL i EN", () => {
    expect([...plLeaves.keys()].sort()).toEqual([...enLeaves.keys()].sort());
  });

  it("żaden napis nie jest identyczny w PL i EN (twarda bramka adminRevenue)", () => {
    const same = [...plLeaves].filter(([key, value]) => enLeaves.get(key) === value);
    expect(same).toEqual([]);
  });

  it("żaden napis nie jest pusty", () => {
    const blank = [...plLeaves, ...enLeaves].filter(([, value]) => value.trim() === "");
    expect(blank).toEqual([]);
  });
});

describe("kody unii mają etykiety", () => {
  const f = pl.adminRevenue.funnel;
  const a = pl.adminRevenue.access;

  it("etapy lejka", () => {
    for (const stage of REVENUE_FUNNEL_STAGES) {
      expect(f.stage[stage].label, stage).toBeTruthy();
      expect(en.adminRevenue.funnel.stage[stage].hint, stage).toBeTruthy();
    }
  });

  it("źródła rejestracji (z unknown)", () => {
    for (const source of [...SIGNUP_SOURCES, "unknown" as const]) {
      expect(f.signupSource[source], source).toBeTruthy();
      expect(en.adminRevenue.funnel.signupSource[source], source).toBeTruthy();
    }
  });

  it("powody uderzeń w paywall", () => {
    for (const reason of PAYWALL_HIT_REASONS) {
      expect(f.paywallReason[reason], reason).toBeTruthy();
      expect(en.adminRevenue.funnel.paywallReason[reason], reason).toBeTruthy();
    }
  });

  it("etapy toru sprzedaży i tory", () => {
    for (const stage of SALES_FUNNEL_STAGES) expect(f.sales.stage[stage], stage).toBeTruthy();
    for (const track of REVENUE_TRACKS) expect(f.track[track], track).toBeTruthy();
  });

  it("tryby dostępu, polityki licznika i rodzaje treści", () => {
    for (const mode of ACCESS_MODES) expect(a.mode[mode], mode).toBeTruthy();
    for (const policy of ["inherit", "metered", "exempt"] as const) {
      expect(a.policy[policy], policy).toBeTruthy();
    }
    for (const entity of ["post", "page", "media"] as const) {
      expect(a.entity[entity], entity).toBeTruthy();
    }
  });

  it("liczebniki PL mają formy one/few/many/other", () => {
    for (const base of ["accounts", "visitors"] as const) {
      for (const form of ["one", "few", "many", "other"] as const) {
        expect(f.paywallReasons[`${base}_${form}`], `${base}_${form}`).toContain("{{count}}");
      }
    }
  });
});
