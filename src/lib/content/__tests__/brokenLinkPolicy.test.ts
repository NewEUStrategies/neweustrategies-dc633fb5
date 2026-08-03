import { describe, expect, it } from "vitest";
import {
  BROKEN_LINK_ALERT_COOLDOWN_MS,
  BROKEN_LINK_ALERT_THRESHOLD,
  parseWaybackAvailability,
  shouldAlertBrokenLinks,
  waybackAvailabilityUrl,
  waybackSearchUrl,
  waybackTimestampToIso,
} from "@/lib/content/brokenLinkPolicy";

const DEAD = "https://example.org/raport-2019.pdf";

describe("wayback suggestion", () => {
  it("builds a nearest-snapshot URL without calling the API", () => {
    expect(waybackSearchUrl(DEAD)).toBe(`https://web.archive.org/web/2/${DEAD}`);
  });

  it("URL-encodes the target in the availability query", () => {
    expect(waybackAvailabilityUrl("https://a.example/x?y=1&z=2")).toBe(
      "https://archive.org/wayback/available?url=https%3A%2F%2Fa.example%2Fx%3Fy%3D1%26z%3D2",
    );
  });

  it("parses a present snapshot and upgrades http to https", () => {
    expect(
      parseWaybackAvailability({
        archived_snapshots: {
          closest: {
            available: true,
            url: "http://web.archive.org/web/20190101120000/https://example.org/",
            timestamp: "20190101120000",
            status: "200",
          },
        },
      }),
    ).toEqual({
      url: "https://web.archive.org/web/20190101120000/https://example.org/",
      timestamp: "20190101120000",
    });
  });

  it("returns null for every shape that means no snapshot", () => {
    // Brak migawki to PUSTY obiekt, nie błąd HTTP - najczęstszy realny przypadek.
    expect(parseWaybackAvailability({ archived_snapshots: {} })).toBeNull();
    expect(parseWaybackAvailability({})).toBeNull();
    expect(parseWaybackAvailability(null)).toBeNull();
    expect(parseWaybackAvailability("nope")).toBeNull();
    expect(
      parseWaybackAvailability({ archived_snapshots: { closest: { available: false } } }),
    ).toBeNull();
    expect(
      parseWaybackAvailability({ archived_snapshots: { closest: { available: true } } }),
    ).toBeNull();
  });

  it("formats a wayback timestamp as ISO and rejects junk", () => {
    expect(waybackTimestampToIso("20190101120000")).toBe("2019-01-01T12:00:00Z");
    expect(waybackTimestampToIso("2019")).toBeNull();
    expect(waybackTimestampToIso(null)).toBeNull();
    expect(waybackTimestampToIso("")).toBeNull();
  });
});

describe("broken link threshold alert", () => {
  const NOW = Date.parse("2026-08-03T12:00:00Z");

  it("stays silent below the threshold", () => {
    expect(
      shouldAlertBrokenLinks({
        brokenTotal: BROKEN_LINK_ALERT_THRESHOLD - 1,
        lastNotifiedCount: null,
        lastNotifiedAt: null,
        now: NOW,
      }),
    ).toBe(false);
  });

  it("fires on the first crossing of the threshold", () => {
    expect(
      shouldAlertBrokenLinks({
        brokenTotal: BROKEN_LINK_ALERT_THRESHOLD,
        lastNotifiedCount: null,
        lastNotifiedAt: null,
        now: NOW,
      }),
    ).toBe(true);
  });

  it("does not repeat the same alert inside the cooldown", () => {
    expect(
      shouldAlertBrokenLinks({
        brokenTotal: BROKEN_LINK_ALERT_THRESHOLD + 2,
        lastNotifiedCount: BROKEN_LINK_ALERT_THRESHOLD,
        lastNotifiedAt: new Date(NOW - 3_600_000).toISOString(),
        now: NOW,
      }),
    ).toBe(false);
  });

  it("fires again once the cooldown expires", () => {
    expect(
      shouldAlertBrokenLinks({
        brokenTotal: BROKEN_LINK_ALERT_THRESHOLD,
        lastNotifiedCount: BROKEN_LINK_ALERT_THRESHOLD,
        lastNotifiedAt: new Date(NOW - BROKEN_LINK_ALERT_COOLDOWN_MS - 1).toISOString(),
        now: NOW,
      }),
    ).toBe(true);
  });

  it("breaks the cooldown when the problem grows by another full threshold", () => {
    // Padła cała domena źródłowa - fala nowych 404 nie może czekać doby.
    expect(
      shouldAlertBrokenLinks({
        brokenTotal: BROKEN_LINK_ALERT_THRESHOLD * 2,
        lastNotifiedCount: BROKEN_LINK_ALERT_THRESHOLD,
        lastNotifiedAt: new Date(NOW - 60_000).toISOString(),
        now: NOW,
      }),
    ).toBe(true);
  });

  it("treats an unparsable stored timestamp as never notified", () => {
    expect(
      shouldAlertBrokenLinks({
        brokenTotal: BROKEN_LINK_ALERT_THRESHOLD,
        lastNotifiedCount: BROKEN_LINK_ALERT_THRESHOLD,
        lastNotifiedAt: "not-a-date",
        now: NOW,
      }),
    ).toBe(true);
  });

  it("honours an explicit threshold override", () => {
    expect(
      shouldAlertBrokenLinks({
        brokenTotal: 3,
        threshold: 3,
        lastNotifiedCount: null,
        lastNotifiedAt: null,
        now: NOW,
      }),
    ).toBe(true);
  });
});
