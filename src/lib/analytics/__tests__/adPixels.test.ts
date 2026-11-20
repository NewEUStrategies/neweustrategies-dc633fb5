import { describe, expect, it } from "vitest";
import { aggregateAdPixelRows, conversionRate, decodePlatforms, encodePlatforms } from "../adPixels";

const now = new Date("2026-11-20T12:00:00Z");

describe("adPixels", () => {
  it("kodowanie platform jest kanoniczne i odrzuca nieznane", () => {
    expect(encodePlatforms(["linkedin", "meta"])).toBe("meta,linkedin");
    expect(decodePlatforms("meta,tiktok,google_ads")).toEqual(["meta", "google_ads"]);
    expect(decodePlatforms(42)).toEqual([]);
  });

  it("liczy wizyty i konwersje per platforma i dzień", () => {
    const s = aggregateAdPixelRows(
      [
        { event_name: "ad_pixel_visit", created_at: "2026-11-20T08:00:00Z", meta: { platforms: "meta,google_ads" } },
        { event_name: "ad_pixel_visit", created_at: "2026-11-19T08:00:00Z", meta: { platforms: "linkedin" } },
        { event_name: "ad_pixel_conversion", created_at: "2026-11-20T09:00:00Z", meta: { platforms: "meta", conversion: "form_submit" } },
        { event_name: "ad_pixel_visit", created_at: "2026-11-20T09:00:00Z", meta: { platforms: "" } },
      ],
      7,
      now,
    );
    expect(s.consentedVisits).toBe(2);
    expect(s.totals.meta).toEqual({ visits: 1, conversions: 1 });
    expect(s.totals.google_ads.visits).toBe(1);
    expect(s.totals.linkedin.visits).toBe(1);
    expect(s.conversionKinds).toEqual([{ kind: "form_submit", count: 1 }]);
    expect(s.daily).toHaveLength(7);
    expect(s.daily[6]?.visits.meta).toBe(1);
    expect(s.daily[5]?.visits.linkedin).toBe(1);
  });

  it("współczynnik konwersji", () => {
    expect(conversionRate(0, 3)).toBe(0);
    expect(conversionRate(200, 3)).toBe(1.5);
  });
});
