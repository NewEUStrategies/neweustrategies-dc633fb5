import { describe, it, expect } from "vitest";
import {
  meteringApplies,
  meterPaywallVariant,
  normalizeMeteringPolicy,
  DEFAULT_METERING_SETTINGS,
  type MeteringSettings,
  type MeterState,
} from "@/lib/access/metering";

const on: MeteringSettings = {
  ...DEFAULT_METERING_SETTINGS,
  enabled: true,
  member_monthly_limit: 3,
  anon_monthly_limit: 0,
};

function state(partial: Partial<MeterState>): MeterState {
  return {
    granted: false,
    consumed: false,
    used: 0,
    monthlyLimit: 3,
    remaining: 3,
    requiresRegistration: false,
    showCounter: true,
    ...partial,
  };
}

describe("normalizeMeteringPolicy", () => {
  it("przepuszcza znane polityki i sprowadza resztę do inherit", () => {
    expect(normalizeMeteringPolicy("metered")).toBe("metered");
    expect(normalizeMeteringPolicy("exempt")).toBe("exempt");
    expect(normalizeMeteringPolicy("inherit")).toBe("inherit");
    expect(normalizeMeteringPolicy(null)).toBe("inherit");
    expect(normalizeMeteringPolicy(undefined)).toBe("inherit");
    expect(normalizeMeteringPolicy("bogus")).toBe("inherit");
  });
});

describe("meteringApplies", () => {
  it("wyłączony metering nigdy nie uczestniczy", () => {
    expect(meteringApplies({ ...on, enabled: false }, "paid", "inherit")).toBe(false);
    expect(meteringApplies(null, "paid", "metered")).toBe(false);
    expect(meteringApplies(undefined, "paid", "metered")).toBe(false);
  });

  it("dotyczy tylko trybów members/paid - public i password nigdy", () => {
    expect(meteringApplies(on, "public", "inherit")).toBe(false);
    expect(meteringApplies(on, "password", "metered")).toBe(false);
    expect(meteringApplies(on, null, "inherit")).toBe(false);
    expect(meteringApplies(on, "paid", "inherit")).toBe(true);
    expect(meteringApplies(on, "members", "inherit")).toBe(true);
  });

  it("polityka exempt wyklucza, metered wymusza mimo wyłączonych trybów", () => {
    expect(meteringApplies(on, "paid", "exempt")).toBe(false);
    const paidOff = { ...on, meter_paid: false };
    expect(meteringApplies(paidOff, "paid", "inherit")).toBe(false);
    expect(meteringApplies(paidOff, "paid", "metered")).toBe(true);
  });

  it("inherit respektuje przełączniki per tryb", () => {
    const membersOff = { ...on, meter_members: false };
    expect(meteringApplies(membersOff, "members", "inherit")).toBe(false);
    expect(meteringApplies(membersOff, "paid", "inherit")).toBe(true);
  });
});

describe("meterPaywallVariant", () => {
  it("anonim bez limitu anonimowego dostaje wariant rejestracyjny", () => {
    expect(
      meterPaywallVariant({ isLoggedIn: false, settings: on, applies: true, state: null }),
    ).toBe("register");
  });

  it("bez zastosowania meteringu nie zmienia komunikatu", () => {
    expect(
      meterPaywallVariant({ isLoggedIn: false, settings: on, applies: false, state: null }),
    ).toBe(null);
    expect(
      meterPaywallVariant({ isLoggedIn: false, settings: null, applies: true, state: null }),
    ).toBe(null);
  });

  it("rejestracja bez wartości (limit kont = 0) nie obiecuje darmowych artykułów", () => {
    const zero = { ...on, member_monthly_limit: 0 };
    expect(
      meterPaywallVariant({ isLoggedIn: false, settings: zero, applies: true, state: null }),
    ).toBe(null);
  });

  it("wyczerpany limit daje wariant exhausted (konto i anonim z limitem)", () => {
    const exhausted = state({ granted: false, used: 3, monthlyLimit: 3, remaining: 0 });
    expect(
      meterPaywallVariant({ isLoggedIn: true, settings: on, applies: true, state: exhausted }),
    ).toBe("exhausted");
    const anonQuota = { ...on, anon_monthly_limit: 2 };
    const anonExhausted = state({ granted: false, used: 2, monthlyLimit: 2, remaining: 0 });
    expect(
      meterPaywallVariant({
        isLoggedIn: false,
        settings: anonQuota,
        applies: true,
        state: anonExhausted,
      }),
    ).toBe("exhausted");
  });

  it("stan granted lub niewykorzystany limit nie nadpisuje komunikatu", () => {
    const granted = state({ granted: true, used: 1, monthlyLimit: 3 });
    expect(
      meterPaywallVariant({ isLoggedIn: true, settings: on, applies: true, state: granted }),
    ).toBe(null);
    const fresh = state({ granted: false, used: 0, monthlyLimit: 3 });
    expect(
      meterPaywallVariant({ isLoggedIn: true, settings: on, applies: true, state: fresh }),
    ).toBe(null);
  });
});
