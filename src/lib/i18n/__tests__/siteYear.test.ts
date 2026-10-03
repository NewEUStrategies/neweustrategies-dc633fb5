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

  it.each([
    // Year 0 is 1 BC and -5 is 6 BC: Intl reports the era year, and siteYear
    // keeps that instead of printing a proleptic 0 or a negative number.
    ["0000-06-15T12:00:00.000Z", 1],
    ["-000005-06-15T12:00:00.000Z", 6],
    // 23:30 UTC on 31 Dec of 1 BC is already 1 January AD 1 in Warsaw.
    ["0000-12-31T23:30:00.000Z", 1],
  ])("delegates years before AD 1 to Intl's era year at %s", (iso, expected) => {
    const ms = Date.parse(iso);
    const reference = new Intl.DateTimeFormat("en-CA", {
      timeZone: SITE_TIME_ZONE,
      year: "numeric",
    });
    expect(siteYear(ms)).toBe(expected);
    expect(siteYear(ms)).toBe(Number.parseInt(reference.format(ms), 10));
  });

  it("falls back to the UTC year before AD 1 when Intl is unavailable", () => {
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function () {
      throw new RangeError("Timezone unavailable");
    });
    expect(siteYear(Date.parse("0000-06-15T12:00:00.000Z"))).toBe(0);
    expect(siteYear(Date.parse("-000005-06-15T12:00:00.000Z"))).toBe(-5);
  });

  it("preserves the UTC fallback when timezone formatting is unavailable", () => {
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function () {
      throw new RangeError("Timezone unavailable");
    });
    expect(siteYear(Date.parse("2026-12-31T23:30:00.000Z"))).toBe(2026);
    expect(siteYear(Number.NaN)).toBeNaN();
  });
});
