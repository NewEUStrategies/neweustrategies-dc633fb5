// Kontrakt rdzenia Global Privacy Control.
//
// Testy pilnują pięciu rzeczy, z których każda była realnym ryzykiem wdrożenia:
// 1) parser sygnału jest ŚCIŚLE „1" - liberalne parsowanie ("true", "0", "yes")
//    zamieniłoby literówkę w cudzy opt-out albo, gorzej, w jego zignorowanie,
// 2) odczyt cookie nie łapie sufiksów (`x_nes_gpc=1` nie udaje `nes_gpc=1`),
// 3) klamra zdejmuje DOKŁADNIE analytics + marketing - functional i necessary
//    zostają (uzasadnienie zakresu w nagłówku `gpc.ts`),
// 4) świadomy override zdejmuje klamrę, ale sam brak znacznika NIGDY jej nie
//    zdejmuje - to jest cała istota mechanizmu,
// 5) deklaracja `/.well-known/gpc.json` ma kształt ze speca i nie przepuszcza
//    zepsutej daty na produkcję.
import { describe, expect, it } from "vitest";
import {
  GPC_CLAMPED_CMP_CATEGORIES,
  GPC_CLAMPED_REGISTRY_KEYS,
  GPC_COOKIE,
  GPC_HEADER,
  GPC_INACTIVE,
  GPC_WELL_KNOWN_PATH,
  buildGpcDeclaration,
  clampCategoriesForGpc,
  clampRegistryValueForGpc,
  isGpcClampedCategory,
  isGpcClampedRegistryKey,
  isGpcHonored,
  isGpcOverrideValid,
  parseGpcValue,
  readGpcCookie,
  readGpcFromHeaders,
  readGpcFromNavigator,
  resolveClientGpc,
} from "@/lib/consent/gpc";
import { CONSENT_CATALOG } from "@/lib/notifications/consentCatalog";

const cats = (over: Partial<Record<string, boolean>> = {}) => ({
  necessary: true,
  functional: true,
  analytics: true,
  marketing: true,
  ...over,
});

describe("parseGpcValue", () => {
  it('accepts only the literal "1" (with surrounding whitespace)', () => {
    expect(parseGpcValue("1")).toBe(true);
    expect(parseGpcValue(" 1 ")).toBe(true);
  });

  it("rejects every other truthy-looking value", () => {
    for (const raw of ["0", "true", "yes", "on", "", "01", "1,1", "11", null, undefined]) {
      expect(parseGpcValue(raw), `wartość ${JSON.stringify(raw)} nie jest sygnałem`).toBe(false);
    }
  });
});

describe("readGpcFromHeaders", () => {
  it("reads Sec-GPC: 1 and reports the header as the source", () => {
    const signal = readGpcFromHeaders(new Headers({ [GPC_HEADER]: "1" }));
    expect(signal).toEqual({ active: true, source: "header" });
  });

  it("is case-insensitive about the header name (Headers semantics)", () => {
    expect(readGpcFromHeaders(new Headers({ "Sec-GPC": "1" })).active).toBe(true);
  });

  it("returns the inactive signal for a missing header or missing headers object", () => {
    expect(readGpcFromHeaders(new Headers())).toEqual(GPC_INACTIVE);
    expect(readGpcFromHeaders(null)).toEqual(GPC_INACTIVE);
  });

  it("does not treat Sec-GPC: 0 as a signal", () => {
    expect(readGpcFromHeaders(new Headers({ [GPC_HEADER]: "0" })).active).toBe(false);
  });
});

describe("readGpcCookie", () => {
  it("finds the cookie among others, regardless of position", () => {
    expect(readGpcCookie(`theme=dark; ${GPC_COOKIE}=1; nes_lang=pl`)).toBe(true);
    expect(readGpcCookie(`${GPC_COOKIE}=1`)).toBe(true);
  });

  it("does not match a cookie whose name merely ENDS with the signal name", () => {
    expect(readGpcCookie(`x_${GPC_COOKIE}=1`)).toBe(false);
    expect(readGpcCookie(`${GPC_COOKIE}_shadow=1`)).toBe(false);
  });

  it('rejects a cleared cookie and a non-"1" value', () => {
    expect(readGpcCookie(`${GPC_COOKIE}=`)).toBe(false);
    expect(readGpcCookie(`${GPC_COOKIE}=0`)).toBe(false);
  });

  it("handles an empty or absent Cookie header", () => {
    expect(readGpcCookie("")).toBe(false);
    expect(readGpcCookie(null)).toBe(false);
  });
});

describe("readGpcFromNavigator", () => {
  it('accepts boolean true (spec) and string "1" (extension quirk)', () => {
    expect(readGpcFromNavigator({ globalPrivacyControl: true })).toEqual({
      active: true,
      source: "navigator",
    });
    expect(readGpcFromNavigator({ globalPrivacyControl: "1" }).active).toBe(true);
  });

  it("rejects false, absent and other types", () => {
    expect(readGpcFromNavigator({ globalPrivacyControl: false }).active).toBe(false);
    expect(readGpcFromNavigator({}).active).toBe(false);
    expect(readGpcFromNavigator({ globalPrivacyControl: 1 }).active).toBe(false);
    expect(readGpcFromNavigator(null).active).toBe(false);
  });
});

describe("resolveClientGpc", () => {
  it("prefers navigator over the transport cookie", () => {
    expect(resolveClientGpc({ globalPrivacyControl: true }, `${GPC_COOKIE}=1`).source).toBe(
      "navigator",
    );
  });

  it("falls back to the cookie when navigator says nothing", () => {
    expect(resolveClientGpc({}, `${GPC_COOKIE}=1`)).toEqual({ active: true, source: "cookie" });
  });

  it("ORs the carriers - a signal from either one counts", () => {
    expect(resolveClientGpc({ globalPrivacyControl: true }, null).active).toBe(true);
    expect(resolveClientGpc(null, `${GPC_COOKIE}=1`).active).toBe(true);
    expect(resolveClientGpc(null, null).active).toBe(false);
  });
});

describe("clampCategoriesForGpc", () => {
  it("clamps exactly analytics + marketing when the signal is honoured", () => {
    expect(clampCategoriesForGpc(cats(), true)).toEqual({
      necessary: true,
      functional: true,
      analytics: false,
      marketing: false,
    });
  });

  it("leaves the input untouched (same identity) when the signal is not honoured", () => {
    const input = cats();
    expect(clampCategoriesForGpc(input, false)).toBe(input);
  });

  it("returns the same identity when there is nothing to clamp (stable deps)", () => {
    const input = cats({ analytics: false, marketing: false });
    expect(clampCategoriesForGpc(input, true)).toBe(input);
  });

  it("never turns a denied category ON", () => {
    const clamped = clampCategoriesForGpc(cats({ functional: false }), true);
    expect(clamped.functional).toBe(false);
    expect(clamped.necessary).toBe(true);
  });
});

describe("clampRegistryValueForGpc", () => {
  it("clamps every GPC-scoped registry key", () => {
    for (const key of GPC_CLAMPED_REGISTRY_KEYS) {
      expect(clampRegistryValueForGpc(key, true, true), key).toBe(false);
    }
  });

  it("leaves keys outside the scope alone", () => {
    for (const key of ["cookies_functional", "transactional", "marketing_email", "analytics"]) {
      expect(clampRegistryValueForGpc(key, true, true), key).toBe(true);
    }
  });

  it("is a no-op when the signal is not honoured", () => {
    expect(clampRegistryValueForGpc("personalization", true, false)).toBe(true);
  });
});

describe("clamp scope predicates", () => {
  it("agrees with the exported category list", () => {
    expect(GPC_CLAMPED_CMP_CATEGORIES.every(isGpcClampedCategory)).toBe(true);
    expect(isGpcClampedCategory("functional")).toBe(false);
    expect(isGpcClampedCategory("necessary")).toBe(false);
  });

  it("points every clamped registry key at a real catalog entry", () => {
    const known = new Set(CONSENT_CATALOG.map((d) => d.key));
    for (const key of GPC_CLAMPED_REGISTRY_KEYS) {
      expect(known.has(key), `klucz "${key}" musi istnieć w consentCatalog`).toBe(true);
      expect(isGpcClampedRegistryKey(key)).toBe(true);
    }
  });

  it("never clamps a required consent (te i tak nie podlegają wycofaniu)", () => {
    const required = CONSENT_CATALOG.filter((d) => d.required).map((d) => d.key);
    for (const key of required) {
      expect(isGpcClampedRegistryKey(key), `zgoda wymagana "${key}" nie może być klamrowana`).toBe(
        false,
      );
    }
  });
});

describe("isGpcOverrideValid / isGpcHonored", () => {
  const active = { active: true, source: "navigator" } as const;

  it("treats a positive finite marker as a valid override", () => {
    expect(isGpcOverrideValid({ gpcOverrideAt: 1_735_689_600_000 })).toBe(true);
  });

  it("rejects a missing, zero, negative or non-finite marker", () => {
    expect(isGpcOverrideValid(null)).toBe(false);
    expect(isGpcOverrideValid({})).toBe(false);
    expect(isGpcOverrideValid({ gpcOverrideAt: 0 })).toBe(false);
    expect(isGpcOverrideValid({ gpcOverrideAt: -1 })).toBe(false);
    expect(isGpcOverrideValid({ gpcOverrideAt: Number.NaN })).toBe(false);
    expect(isGpcOverrideValid({ gpcOverrideAt: Number.POSITIVE_INFINITY })).toBe(false);
  });

  it("honours an active signal when there is no override", () => {
    expect(isGpcHonored(active, null)).toBe(true);
    expect(isGpcHonored(active, {})).toBe(true);
  });

  it("stops honouring it once an informed override exists", () => {
    expect(isGpcHonored(active, { gpcOverrideAt: 1_735_689_600_000 })).toBe(false);
  });

  it("is never honoured without a signal, override or not", () => {
    expect(isGpcHonored(GPC_INACTIVE, null)).toBe(false);
    expect(isGpcHonored(GPC_INACTIVE, { gpcOverrideAt: 1 })).toBe(false);
  });
});

describe("buildGpcDeclaration", () => {
  it("emits the spec shape and nothing else", () => {
    const declaration = buildGpcDeclaration("2026-08-03");
    expect(declaration).toEqual({ gpc: true, lastUpdate: "2026-08-03" });
    expect(Object.keys(declaration).sort()).toEqual(["gpc", "lastUpdate"]);
  });

  it("uses the shipped constant by default", () => {
    expect(buildGpcDeclaration().gpc).toBe(true);
    expect(buildGpcDeclaration().lastUpdate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("refuses a malformed date instead of shipping it", () => {
    expect(() => buildGpcDeclaration("03-08-2026")).toThrow(/YYYY-MM-DD/);
    expect(() => buildGpcDeclaration("")).toThrow();
  });

  it("keeps the well-known path exactly where the spec expects it", () => {
    expect(GPC_WELL_KNOWN_PATH).toBe("/.well-known/gpc.json");
  });
});
