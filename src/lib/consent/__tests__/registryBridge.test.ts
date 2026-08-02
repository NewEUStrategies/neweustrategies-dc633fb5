// Kontrakt mostu CMP -> rejestr RODO. Pilnuje trzech inwariantów unifikacji:
// 1) każda audytowalna kategoria CMP ma klucz w katalogu zgód (i odwrotnie),
// 2) wersja wpisów cookie w katalogu odpowiada CONSENT_VERSION z CMP
//    (bump schematu CMP bez bumpa katalogu = czerwony test, nie cichy dryf),
// 3) diff decyzji: pierwsza decyzja loguje wszystko, brak zmian nie loguje nic.
import { describe, expect, it } from "vitest";
import {
  AUDITABLE_CMP_CATEGORIES,
  CMP_TO_REGISTRY,
  REGISTRY_TO_CMP,
  buildRegistryEntries,
  diffCmpCategories,
  missingRegistryCategories,
  normalizeDecisionSource,
} from "@/lib/consent/registryBridge";
import { CONSENT_CATALOG, getConsentDefinition } from "@/lib/notifications/consentCatalog";
import type { ConsentState } from "@/lib/ads/consent";

function state(
  cats: Partial<Record<"functional" | "analytics" | "marketing", boolean>>,
): ConsentState {
  return {
    version: 2,
    ts: 1735689600000,
    categories: {
      necessary: true,
      functional: !!cats.functional,
      analytics: !!cats.analytics,
      marketing: !!cats.marketing,
    },
  };
}

describe("CMP <-> registry mapping", () => {
  it("maps every auditable CMP category to an existing catalog key", () => {
    for (const cat of AUDITABLE_CMP_CATEGORIES) {
      const key = CMP_TO_REGISTRY[cat];
      expect(key, `brak klucza rejestru dla kategorii CMP "${cat}"`).toBeTruthy();
      expect(
        getConsentDefinition(key),
        `klucz "${key}" nie istnieje w consentCatalog`,
      ).toBeDefined();
    }
  });

  it("is a bijection (REGISTRY_TO_CMP inverts CMP_TO_REGISTRY)", () => {
    for (const cat of AUDITABLE_CMP_CATEGORIES) {
      expect(REGISTRY_TO_CMP[CMP_TO_REGISTRY[cat]]).toBe(cat);
    }
    expect(Object.keys(REGISTRY_TO_CMP)).toHaveLength(AUDITABLE_CMP_CATEGORIES.length);
  });

  it("keeps catalog cookie versions in lockstep with CMP CONSENT_VERSION (=2)", () => {
    const cookieDefs = CONSENT_CATALOG.filter((d) => d.category === "cookies");
    expect(cookieDefs).toHaveLength(AUDITABLE_CMP_CATEGORIES.length);
    for (const def of cookieDefs) {
      expect(def.version, `wersja ${def.key} musi zaczynać się od "2."`).toMatch(/^2\./);
      expect(def.required).not.toBe(true);
    }
  });
});

describe("diffCmpCategories", () => {
  it("returns all auditable categories on the first decision (no prev)", () => {
    expect(diffCmpCategories(null, state({ analytics: true }))).toEqual([
      ...AUDITABLE_CMP_CATEGORIES,
    ]);
  });

  it("returns only categories whose value actually changed", () => {
    const prev = state({ functional: true, analytics: false, marketing: false });
    const next = state({ functional: true, analytics: true, marketing: false });
    expect(diffCmpCategories(prev, next)).toEqual(["analytics"]);
  });

  it("returns nothing when the decision is identical (no audit noise)", () => {
    const prev = state({ functional: true, analytics: true, marketing: false });
    const next = state({ functional: true, analytics: true, marketing: false });
    expect(diffCmpCategories(prev, next)).toEqual([]);
  });
});

describe("buildRegistryEntries", () => {
  it("builds entries with catalog version, decision value, lang and source", () => {
    const entries = buildRegistryEntries(
      ["analytics", "marketing"],
      state({ analytics: true, marketing: false }),
      "profile_privacy",
      "pl",
    );
    expect(entries).toEqual([
      {
        key: "cookies_analytics",
        given: true,
        version: getConsentDefinition("cookies_analytics")?.version,
        lang: "pl",
        source: "profile_privacy",
      },
      {
        key: "cookies_marketing",
        given: false,
        version: getConsentDefinition("cookies_marketing")?.version,
        lang: "pl",
        source: "profile_privacy",
      },
    ]);
  });
});

describe("missingRegistryCategories (backfill przy logowaniu)", () => {
  it("returns all categories for an empty registry (pre-unification account)", () => {
    expect(missingRegistryCategories(new Set())).toEqual([...AUDITABLE_CMP_CATEGORIES]);
  });

  it("returns only categories without a cookies_* row", () => {
    const present = new Set(["cookies_analytics", "marketing_email", "transactional"]);
    expect(missingRegistryCategories(present)).toEqual(["functional", "marketing"]);
  });

  it("returns nothing when every cookie key already has a row", () => {
    const present = new Set(Object.values(CMP_TO_REGISTRY));
    expect(missingRegistryCategories(present)).toEqual([]);
  });
});

describe("normalizeDecisionSource", () => {
  it("passes through known sources", () => {
    expect(normalizeDecisionSource("login_sync")).toBe("login_sync");
    expect(normalizeDecisionSource("profile_privacy")).toBe("profile_privacy");
  });

  it("falls back to cmp_banner for anything else (e.g. a MouseEvent)", () => {
    expect(normalizeDecisionSource({ type: "click" })).toBe("cmp_banner");
    expect(normalizeDecisionSource(undefined)).toBe("cmp_banner");
    expect(normalizeDecisionSource("evil".repeat(20))).toBe("cmp_banner");
  });
});
