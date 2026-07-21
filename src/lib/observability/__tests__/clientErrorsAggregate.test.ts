// Agregacja telemetrii błędów przeglądarki: fingerprint komunikatu,
// grupowanie, trend dzienny z zerami i metadane okna.
import { describe, it, expect } from "vitest";
import {
  aggregateClientErrors,
  normalizeErrorMessage,
  type ClientErrorSample,
} from "@/lib/observability/clientErrorsAggregate";

describe("normalizeErrorMessage", () => {
  it("skleja zmienne fragmenty: uuid, url, hex, liczby", () => {
    expect(
      normalizeErrorMessage(
        "Failed to fetch https://cdn.example.com/assets/chunk-4f2a9b1c.js for 123",
      ),
    ).toBe("Failed to fetch <url> for <n>");
    expect(
      normalizeErrorMessage("Row 6f1e0c1a-8b2d-4e3f-9a5c-2d7b8e9f0a1b not found (attempt 42)"),
    ).toBe("Row <uuid> not found (attempt <n>)");
    expect(normalizeErrorMessage("hash deadbeefcafe1234 mismatch")).toBe("hash <hex> mismatch");
  });

  it("normalizuje białe znaki i tnie do 300 znaków", () => {
    expect(normalizeErrorMessage("a\n  b\t c")).toBe("a b c");
    expect(normalizeErrorMessage("x".repeat(500))).toHaveLength(300);
  });

  it("te same defekty z różnymi wartościami dają jeden fingerprint", () => {
    const a = normalizeErrorMessage("Loading chunk 123 failed");
    const b = normalizeErrorMessage("Loading chunk 987 failed");
    expect(a).toBe(b);
  });
});

const NOW = Date.parse("2026-07-21T12:00:00Z");

function sample(overrides: Partial<ClientErrorSample>): ClientErrorSample {
  return {
    message: "boom",
    stack: null,
    source: "onerror",
    path: "/",
    created_at: "2026-07-21T11:00:00Z",
    ...overrides,
  };
}

describe("aggregateClientErrors", () => {
  it("grupuje po fingerprincie, liczy okno i sortuje malejąco", () => {
    const report = aggregateClientErrors(
      [
        sample({ message: "Loading chunk 11 failed", path: "/a" }),
        sample({
          message: "Loading chunk 22 failed",
          path: "/a",
          created_at: "2026-07-20T10:00:00Z",
        }),
        sample({ message: "Loading chunk 33 failed", path: "/b" }),
        sample({ message: "TypeError: x is undefined", source: "react_error_boundary" }),
      ],
      { windowDays: 7, windowTotal: 4, capped: false, nowMs: NOW },
    );

    expect(report.total).toBe(4);
    expect(report.uniqueGroups).toBe(2);
    expect(report.groups[0].fingerprint).toBe("Loading chunk <n> failed");
    expect(report.groups[0].count).toBe(3);
    expect(report.groups[0].topPaths).toEqual([
      { path: "/a", count: 2 },
      { path: "/b", count: 1 },
    ]);
    expect(report.groups[1].sources).toEqual(["react_error_boundary"]);
  });

  it("lastSeen niesie najświeższy komunikat i stack próbki", () => {
    const report = aggregateClientErrors(
      [
        sample({
          message: "Loading chunk 1 failed",
          created_at: "2026-07-19T10:00:00Z",
          stack: "old-stack",
        }),
        sample({
          message: "Loading chunk 2 failed",
          created_at: "2026-07-21T09:00:00Z",
          stack: "new-stack",
        }),
      ],
      { windowDays: 7, windowTotal: 2, capped: false, nowMs: NOW },
    );
    const group = report.groups[0];
    expect(group.message).toBe("Loading chunk 2 failed");
    expect(group.sampleStack).toBe("new-stack");
    expect(group.firstSeen).toBe("2026-07-19T10:00:00Z");
    expect(group.lastSeen).toBe("2026-07-21T09:00:00Z");
  });

  it("trend dzienny wypełnia zerami dni bez błędów (pełne okno)", () => {
    const report = aggregateClientErrors(
      [
        sample({ created_at: "2026-07-20T10:00:00Z" }),
        sample({ created_at: "2026-07-21T10:00:00Z" }),
      ],
      { windowDays: 3, windowTotal: 2, capped: false, nowMs: NOW },
    );
    expect(report.daily).toEqual([
      { day: "2026-07-19", count: 0 },
      { day: "2026-07-20", count: 1 },
      { day: "2026-07-21", count: 1 },
    ]);
  });

  it("liczy last24h względem punktu odniesienia", () => {
    const report = aggregateClientErrors(
      [
        sample({ created_at: "2026-07-21T11:59:00Z" }),
        sample({ created_at: "2026-07-20T11:00:00Z" }),
      ],
      { windowDays: 7, windowTotal: 2, capped: false, nowMs: NOW },
    );
    expect(report.last24h).toBe(1);
  });

  it("respektuje maxGroups i przenosi metadane capa", () => {
    const samples = Array.from({ length: 5 }, (_, i) =>
      sample({ message: `unikalny-${String.fromCharCode(97 + i)}` }),
    );
    const report = aggregateClientErrors(samples, {
      windowDays: 7,
      windowTotal: 9999,
      capped: true,
      nowMs: NOW,
      maxGroups: 2,
    });
    expect(report.groups).toHaveLength(2);
    expect(report.uniqueGroups).toBe(5);
    expect(report.windowTotal).toBe(9999);
    expect(report.capped).toBe(true);
  });

  it("puste wejście daje pusty, ale kompletny raport", () => {
    const report = aggregateClientErrors([], {
      windowDays: 2,
      windowTotal: 0,
      capped: false,
      nowMs: NOW,
    });
    expect(report.groups).toEqual([]);
    expect(report.daily).toHaveLength(2);
    expect(report.affectedPaths).toBe(0);
  });
});
