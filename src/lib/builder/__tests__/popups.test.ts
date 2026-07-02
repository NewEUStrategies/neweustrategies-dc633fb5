// Popup settings parsing, path targeting and frequency capping.
import { beforeEach, describe, expect, it } from "vitest";
import {
  defaultPopupSettings,
  evaluatePopupTargeting,
  isPopupFrequencyOk,
  markPopupDismissed,
  matchesPathPattern,
  parsePopupSettings,
} from "../popups";

describe("parsePopupSettings", () => {
  it("returns full defaults for garbage input", () => {
    expect(parsePopupSettings(null)).toEqual(defaultPopupSettings());
    expect(parsePopupSettings("x")).toEqual(defaultPopupSettings());
    expect(parsePopupSettings([])).toEqual(defaultPopupSettings());
  });

  it("keeps valid values and coerces invalid ones", () => {
    const parsed = parsePopupSettings({
      trigger: "scroll",
      scrollPercent: 250,
      delaySeconds: -3,
      frequencyDays: 14,
      audience: "guest",
      devices: { desktop: false, tablet: "yes", mobile: true },
      includePaths: ["/pricing", 42, "", "/post/*"],
      width: "xl",
      position: "bottom",
      borderRadiusPx: -4,
      closeOnOverlay: false,
    });
    expect(parsed.trigger).toBe("scroll");
    expect(parsed.scrollPercent).toBe(100);
    expect(parsed.delaySeconds).toBe(0);
    expect(parsed.frequencyDays).toBe(14);
    expect(parsed.audience).toBe("guest");
    expect(parsed.devices).toEqual({ desktop: false, tablet: true, mobile: true });
    expect(parsed.includePaths).toEqual(["/pricing", "/post/*"]);
    expect(parsed.width).toBe("xl");
    expect(parsed.position).toBe("bottom");
    expect(parsed.borderRadiusPx).toBe(0);
    expect(parsed.closeOnOverlay).toBe(false);
    expect(parsed.showCloseButton).toBe(true);
  });
});

describe("matchesPathPattern", () => {
  it("matches exact paths (with optional trailing slash)", () => {
    expect(matchesPathPattern(["/pricing"], "/pricing")).toBe(true);
    expect(matchesPathPattern(["/pricing"], "/pricing/")).toBe(true);
    expect(matchesPathPattern(["/pricing"], "/pricing/pro")).toBe(false);
  });

  it("matches prefixes with a trailing asterisk", () => {
    expect(matchesPathPattern(["/post/*"], "/post/hello")).toBe(true);
    expect(matchesPathPattern(["/post/*"], "/posts")).toBe(false);
  });

  it("ignores empty patterns", () => {
    expect(matchesPathPattern(["", "  "], "/anything")).toBe(false);
  });
});

describe("evaluatePopupTargeting", () => {
  const base = defaultPopupSettings();
  const ctx = { path: "/", device: "desktop" as const, isLoggedIn: false };

  it("never shows on admin or login surfaces", () => {
    expect(evaluatePopupTargeting(base, { ...ctx, path: "/admin/pages" })).toBe(false);
    expect(evaluatePopupTargeting(base, { ...ctx, path: "/login" })).toBe(false);
  });

  it("respects device toggles", () => {
    const s = { ...base, devices: { desktop: false, tablet: true, mobile: true } };
    expect(evaluatePopupTargeting(s, ctx)).toBe(false);
    expect(evaluatePopupTargeting(s, { ...ctx, device: "mobile" })).toBe(true);
  });

  it("respects audience gating", () => {
    expect(
      evaluatePopupTargeting({ ...base, audience: "guest" }, { ...ctx, isLoggedIn: true }),
    ).toBe(false);
    expect(evaluatePopupTargeting({ ...base, audience: "user" }, ctx)).toBe(false);
    expect(
      evaluatePopupTargeting({ ...base, audience: "user" }, { ...ctx, isLoggedIn: true }),
    ).toBe(true);
  });

  it("applies include and exclude lists (exclude wins)", () => {
    const s = { ...base, includePaths: ["/post/*"], excludePaths: ["/post/secret"] };
    expect(evaluatePopupTargeting(s, { ...ctx, path: "/" })).toBe(false);
    expect(evaluatePopupTargeting(s, { ...ctx, path: "/post/hello" })).toBe(true);
    expect(evaluatePopupTargeting(s, { ...ctx, path: "/post/secret" })).toBe(false);
  });
});

describe("frequency capping", () => {
  beforeEach(() => window.localStorage.clear());

  it("allows the first show and blocks within the frequency window", () => {
    expect(isPopupFrequencyOk("p1", 7)).toBe(true);
    markPopupDismissed("p1");
    expect(isPopupFrequencyOk("p1", 7)).toBe(false);
    // Another popup is unaffected.
    expect(isPopupFrequencyOk("p2", 7)).toBe(true);
  });

  it("re-allows after the window elapses and always with frequency 0", () => {
    markPopupDismissed("p1");
    const eightDaysLater = Date.now() + 8 * 86_400_000;
    expect(isPopupFrequencyOk("p1", 7, eightDaysLater)).toBe(true);
    expect(isPopupFrequencyOk("p1", 0)).toBe(true);
  });
});
