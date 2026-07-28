// Kontrakt czystej logiki odliczania (event-countdown).
import { describe, it, expect } from "vitest";
import {
  countdownParts,
  daysUntil,
  isStartingSoon,
  pad2,
  parseCountdownTarget,
} from "@/lib/events/countdown";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("parseCountdownTarget", () => {
  it("parses ISO timestamps and rejects empty/garbage", () => {
    expect(parseCountdownTarget("2026-10-12T09:00:00Z")).toBe(Date.parse("2026-10-12T09:00:00Z"));
    expect(parseCountdownTarget("")).toBeNull();
    expect(parseCountdownTarget("   ")).toBeNull();
    expect(parseCountdownTarget("garbage")).toBeNull();
  });
});

describe("countdownParts", () => {
  it("splits the distance into days/hours/minutes/seconds", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    const target = now + 2 * DAY + 3 * HOUR + 4 * 60_000 + 5_000;
    expect(countdownParts(target, now)).toEqual({
      days: 2,
      hours: 3,
      minutes: 4,
      seconds: 5,
      done: false,
    });
  });

  it("returns done with zeroed parts for past targets", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(countdownParts(now - 1, now)).toEqual({
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      done: true,
    });
    expect(countdownParts(now, now)).toMatchObject({ done: true });
  });
});

describe("pad2", () => {
  it("zero-pads and clamps negatives", () => {
    expect(pad2(7)).toBe("07");
    expect(pad2(59)).toBe("59");
    expect(pad2(-3)).toBe("00");
  });
});

describe("daysUntil", () => {
  it("ceils to whole days and returns 0 for past/now", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(daysUntil(now + 1, now)).toBe(1);
    expect(daysUntil(now + DAY, now)).toBe(1);
    expect(daysUntil(now + DAY + 1, now)).toBe(2);
    expect(daysUntil(now, now)).toBe(0);
    expect(daysUntil(now - DAY, now)).toBe(0);
  });
});

describe("isStartingSoon", () => {
  const now = Date.parse("2026-01-01T12:00:00Z");
  it("true dla startu w ciagu 24h", () => {
    expect(isStartingSoon(now + 3_600_000, now)).toBe(true);
  });
  it("false dla startu dalej niz 24h", () => {
    expect(isStartingSoon(now + 48 * 3_600_000, now)).toBe(false);
  });
  it("false dla celu w przeszlosci", () => {
    expect(isStartingSoon(now - 1000, now)).toBe(false);
  });
  it("respektuje wlasne okno godzinowe", () => {
    expect(isStartingSoon(now + 5 * 3_600_000, now, 2)).toBe(false);
    expect(isStartingSoon(now + 1 * 3_600_000, now, 2)).toBe(true);
  });
});
