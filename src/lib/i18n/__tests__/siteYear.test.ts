import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SITE_TIME_ZONE, siteYear } from "../format";

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-30T23:30:00.000Z"));
});
afterEach(() => vi.restoreAllMocks());

describe("siteYear", () => {
  it("uses the current year when no timestamp is supplied", () => {
    expect(siteYear()).toBe(2026);
  });

  it("matches the editorial timezone throughout ordinary, leap and century years", () => {
    const reference = new Intl.DateTimeFormat("en-CA", {
      timeZone: SITE_TIME_ZONE,
      year: "numeric",
    });
    for (const year of [1900, 2000, 2026, 2028, 2100]) {
      const end = Date.UTC(year + 1, 0, 2);
      for (let ms = Date.UTC(year, 0, 1); ms < end; ms += 12 * 60 * 60 * 1000) {
        expect(siteYear(ms)).toBe(Number.parseInt(reference.format(ms), 10));
      }
    }
  });

  it.each([
    ["2026-12-31T22:59:59.999Z", 2026],
    ["2026-12-31T23:00:00.000Z", 2027],
    ["2027-01-01T00:00:00.000Z", 2027],
  ])("uses Warsaw's year at %s", (iso, expected) => {
    expect(siteYear(Date.parse(iso))).toBe(expected);
  });

  it("does not initialize Intl for a copyright year away from New Year", () => {
    const formatter = vi.spyOn(Intl, "DateTimeFormat");
    expect(siteYear(Date.parse("2026-09-30T23:30:00.000Z"))).toBe(2026);
    expect(formatter).not.toHaveBeenCalled();
  });

  it("preserves the UTC fallback when timezone formatting is unavailable", () => {
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function () {
      throw new RangeError("Timezone unavailable");
    });
    expect(siteYear(Date.parse("2026-12-31T23:30:00.000Z"))).toBe(2026);
    expect(siteYear(Number.NaN)).toBeNaN();
  });
});
