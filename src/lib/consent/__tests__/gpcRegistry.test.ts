// Kontrakt mostu GPC -> rejestr RODO.
//
// Sygnał GPC to sprzeciw (art. 21 RODO) i wycofanie zgody (art. 7 ust. 3), więc
// nie może zostać wyłącznie klamrą w runtime - musi zostawić ślad w audycie.
// Testy pilnują, że:
//  1) `gpc_signal` jest ROZPOZNAWANYM źródłem decyzji (inaczej normalizator
//     cicho podmieniłby je na "cmp_banner" i audyt kłamałby o pochodzeniu),
//  2) wpisy wycofania pokrywają WSZYSTKIE klamrowane klucze - w tym
//     `personalization`, którego CMP nie zna,
//  3) `gpcWithdrawalsNeeded` nie generuje szumu: klucz już wycofany nie dostaje
//     drugiego identycznego wpisu,
//  4) znacznik `gpc` w zwykłych decyzjach CMP odzwierciedla AKTYWNOŚĆ sygnału
//     (a nie jego honorowanie) - to on odróżnia „zgodę" od „zgody wbrew
//     sygnałowi opt-outu".
import { describe, expect, it } from "vitest";
import {
  buildGpcWithdrawalEntries,
  buildRegistryEntries,
  gpcWithdrawalsNeeded,
  normalizeDecisionSource,
  AUDITABLE_CMP_CATEGORIES,
} from "@/lib/consent/registryBridge";
import { GPC_CLAMPED_REGISTRY_KEYS } from "@/lib/consent/gpc";
import { getConsentDefinition } from "@/lib/notifications/consentCatalog";
import type { ConsentState } from "@/lib/ads/consent";

function state(over: Partial<Record<"functional" | "analytics" | "marketing", boolean>>) {
  return {
    version: 2,
    ts: 1_735_689_600_000,
    categories: {
      necessary: true,
      functional: !!over.functional,
      analytics: !!over.analytics,
      marketing: !!over.marketing,
    },
  } satisfies ConsentState;
}

describe("normalizeDecisionSource", () => {
  it("keeps gpc_signal as a first-class decision source", () => {
    expect(normalizeDecisionSource("gpc_signal")).toBe("gpc_signal");
  });

  it("still falls back to cmp_banner for junk (accidental MouseEvent argument)", () => {
    expect(normalizeDecisionSource({ type: "click" })).toBe("cmp_banner");
    expect(normalizeDecisionSource("gpc")).toBe("cmp_banner");
    expect(normalizeDecisionSource(undefined)).toBe("cmp_banner");
  });
});

describe("buildGpcWithdrawalEntries", () => {
  const entries = buildGpcWithdrawalEntries("pl");

  it("covers every GPC-clamped registry key, including non-cookie ones", () => {
    expect(entries.map((e) => e.key).sort()).toEqual([...GPC_CLAMPED_REGISTRY_KEYS].sort());
    expect(entries.map((e) => e.key)).toContain("personalization");
  });

  it("records a withdrawal, flags the signal and names the source", () => {
    for (const entry of entries) {
      expect(entry.given, entry.key).toBe(false);
      expect(entry.gpc, entry.key).toBe(true);
      expect(entry.source, entry.key).toBe("gpc_signal");
      expect(entry.lang, entry.key).toBe("pl");
    }
  });

  it("carries the catalog version for each key (audit needs the content version)", () => {
    for (const entry of entries) {
      expect(entry.version).toBe(getConsentDefinition(entry.key)?.version);
    }
  });

  it("never withdraws a category outside the GPC scope", () => {
    expect(entries.map((e) => e.key)).not.toContain("cookies_functional");
    expect(entries.map((e) => e.key)).not.toContain("transactional");
  });
});

describe("gpcWithdrawalsNeeded", () => {
  it("asks for every clamped key when the register knows nothing yet", () => {
    expect(gpcWithdrawalsNeeded(new Map())).toEqual([...GPC_CLAMPED_REGISTRY_KEYS]);
  });

  it("skips keys already recorded as withdrawn (no duplicate audit rows)", () => {
    const current = new Map<string, boolean>(GPC_CLAMPED_REGISTRY_KEYS.map((k) => [k, false]));
    expect(gpcWithdrawalsNeeded(current)).toEqual([]);
  });

  it("asks only for the keys that still stand as granted", () => {
    const current = new Map<string, boolean>([
      ["cookies_analytics", false],
      ["cookies_marketing", true],
      ["personalization", true],
    ]);
    expect(gpcWithdrawalsNeeded(current)).toEqual(["cookies_marketing", "personalization"]);
  });
});

describe("buildRegistryEntries - znacznik GPC", () => {
  it("stamps gpc = true on a decision taken while the signal is active", () => {
    const entries = buildRegistryEntries(
      AUDITABLE_CMP_CATEGORIES,
      state({ functional: true, analytics: true, marketing: true }),
      "cmp_banner",
      "en",
      true,
    );
    expect(entries).toHaveLength(AUDITABLE_CMP_CATEGORIES.length);
    // Zgoda udzielona przy aktywnym sygnale MUSI być rozpoznawalna w audycie -
    // to ona jest wyjątkiem wymagającym uzasadnienia, nie odmowa.
    expect(entries.every((e) => e.gpc === true && e.given === true)).toBe(true);
  });

  it("defaults to gpc = false so a missing signal is never invented", () => {
    const entries = buildRegistryEntries(
      AUDITABLE_CMP_CATEGORIES,
      state({ analytics: true }),
      "profile_privacy",
    );
    expect(entries.every((e) => e.gpc === false)).toBe(true);
  });
});
