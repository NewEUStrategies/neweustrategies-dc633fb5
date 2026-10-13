import { describe, it, expect } from "vitest";
import {
  currentMeterPeriod,
  formatMeterResetDate,
  latestMeterNumbers,
  meterCounterVisible,
  meteringApplies,
  meterPaywallVariant,
  nextMeterResetDate,
  normalizeMeteringPolicy,
  quotaFromMeterState,
  DEFAULT_METERING_SETTINGS,
  type MeteringSettings,
  type MeterQuota,
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

describe("meterCounterVisible", () => {
  it("licznik widoczny wyłącznie dla granted + show_counter + realny limit", () => {
    expect(meterCounterVisible(state({ granted: true, used: 1 }))).toBe(true);
  });

  it("każdy brakujący warunek ukrywa licznik", () => {
    expect(meterCounterVisible(null)).toBe(false);
    expect(meterCounterVisible(undefined)).toBe(false);
    expect(meterCounterVisible(state({ granted: false }))).toBe(false);
    expect(meterCounterVisible(state({ granted: true, showCounter: false }))).toBe(false);
    // Uprawniony czytelnik: RPC zwraca monthly_limit=0 - licznik nie istnieje.
    expect(meterCounterVisible(state({ granted: true, monthlyLimit: 0 }))).toBe(false);
  });
});

describe("latestMeterNumbers", () => {
  const entity = state({ granted: true, used: 1, monthlyLimit: 5, remaining: 4 });
  const quota = (partial: Partial<MeterQuota>): MeterQuota => ({
    enabled: true,
    monthlyLimit: 5,
    used: 1,
    remaining: 4,
    requiresRegistration: false,
    showCounter: true,
    ...partial,
  });

  it("bez quoty (lub z wyłączoną) zwraca zamrożony stan bytu", () => {
    expect(latestMeterNumbers(entity, null)).toEqual({ used: 1, monthlyLimit: 5, remaining: 4 });
    expect(latestMeterNumbers(entity, quota({ enabled: false, used: 3 }))).toEqual({
      used: 1,
      monthlyLimit: 5,
      remaining: 4,
    });
    expect(latestMeterNumbers(entity, quota({ monthlyLimit: 0, used: 3 }))).toEqual({
      used: 1,
      monthlyLimit: 5,
      remaining: 4,
    });
  });

  it("świeższa quota wygrywa: powrót do artykułu pokazuje bieżące zużycie", () => {
    // Czytelnik przeczytał w międzyczasie 2 kolejne artykuły.
    expect(latestMeterNumbers(entity, quota({ used: 3, remaining: 2 }))).toEqual({
      used: 3,
      monthlyLimit: 5,
      remaining: 2,
    });
  });

  it("zużycie jest monotoniczne - starsza quota nie cofa licznika", () => {
    const consumed = state({ granted: true, used: 4, monthlyLimit: 5, remaining: 1 });
    expect(latestMeterNumbers(consumed, quota({ used: 2, remaining: 3 }))).toEqual({
      used: 4,
      monthlyLimit: 5,
      remaining: 1,
    });
  });

  it("zmiana limitu przez admina w trakcie miesiąca liczy się od quoty", () => {
    expect(latestMeterNumbers(entity, quota({ monthlyLimit: 10, used: 3, remaining: 7 }))).toEqual({
      used: 3,
      monthlyLimit: 10,
      remaining: 7,
    });
    // Obniżony limit poniżej zużycia nie schodzi poniżej zera.
    expect(latestMeterNumbers(entity, quota({ monthlyLimit: 1, used: 3, remaining: 0 }))).toEqual({
      used: 3,
      monthlyLimit: 1,
      remaining: 0,
    });
  });
});

describe("quotaFromMeterState", () => {
  it("mapuje werdykt konsumpcji na stan miesiąca (enabled=true)", () => {
    const s = state({ granted: true, used: 2, monthlyLimit: 5, remaining: 3 });
    expect(quotaFromMeterState(s)).toEqual({
      enabled: true,
      monthlyLimit: 5,
      used: 2,
      remaining: 3,
      requiresRegistration: false,
      showCounter: true,
    });
  });
});

describe("currentMeterPeriod", () => {
  it("liczy okres w UTC (parytet z serwerowym date_trunc('month'))", () => {
    expect(currentMeterPeriod(new Date(Date.UTC(2026, 6, 15, 12)))).toBe("2026-07");
    // Tuż przed północą UTC ostatniego dnia miesiąca - wciąż stary okres.
    expect(currentMeterPeriod(new Date(Date.UTC(2026, 6, 31, 23, 59, 59)))).toBe("2026-07");
    // Sekundę po północy UTC - nowy okres (zamrożone stany lipca odpadają z kluczy).
    expect(currentMeterPeriod(new Date(Date.UTC(2026, 7, 1, 0, 0, 1)))).toBe("2026-08");
    expect(currentMeterPeriod(new Date(Date.UTC(2026, 11, 31, 23)))).toBe("2026-12");
    expect(currentMeterPeriod(new Date(Date.UTC(2027, 0, 1, 1)))).toBe("2027-01");
  });
});

describe("nextMeterResetDate / formatMeterResetDate", () => {
  it("wskazuje pierwszy dzień kolejnego miesiąca (UTC)", () => {
    const d = nextMeterResetDate(new Date(Date.UTC(2026, 6, 31, 12)));
    expect([d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()]).toEqual([2026, 7, 1]);
  });

  it("przechodzi przez granicę roku", () => {
    const d = nextMeterResetDate(new Date(Date.UTC(2026, 11, 15)));
    expect([d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()]).toEqual([2027, 0, 1]);
  });

  it("formatuje datę w języku czytelnika, w strefie UTC (bez cofnięcia o dzień)", () => {
    const now = new Date(Date.UTC(2026, 6, 31, 12));
    expect(formatMeterResetDate("pl", now)).toBe("1 sierpnia");
    expect(formatMeterResetDate("en", now)).toBe("1 August");
  });
});
