// Wspólny zegar czasu względnego (`feedClock.ts`).
//
// CO TEN PLIK DOWODZI. Jeden interwał na cały strumień: startuje przy
// pierwszej subskrypcji, powiadamia wszystkich i przesuwa migawkę, a znika
// razem z ostatnią kartą. Migawka serwera to zero (data zamiast czasu
// względnego - zero rozjazdu hydracji).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLUB_FEED_CLOCK_TICK_MS,
  feedClockServerSnapshot,
  feedClockSnapshot,
  subscribeFeedClock,
} from "@/lib/clubs/feedClock";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-06T10:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("feedClock", () => {
  it("migawka serwera to zero, klienta - bieżąca chwila stała do tyknięcia", () => {
    expect(feedClockServerSnapshot()).toBe(0);
    const stop = subscribeFeedClock(() => undefined);
    const first = feedClockSnapshot();
    expect(first).toBe(Date.parse("2026-10-06T10:00:00.000Z"));
    vi.setSystemTime(new Date("2026-10-06T10:00:10.000Z"));
    expect(feedClockSnapshot()).toBe(first);
    stop();
  });

  it("jedno tyknięcie powiadamia wszystkich subskrybentów i przesuwa migawkę", () => {
    const a = vi.fn();
    const b = vi.fn();
    const stopA = subscribeFeedClock(a);
    const stopB = subscribeFeedClock(b);
    const before = feedClockSnapshot();

    vi.advanceTimersByTime(CLUB_FEED_CLOCK_TICK_MS);

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(feedClockSnapshot()).toBe(before + CLUB_FEED_CLOCK_TICK_MS);
    expect(vi.getTimerCount()).toBe(1);
    stopA();
    stopB();
  });

  it("ostatnia rezygnacja zatrzymuje zegar", () => {
    const stop = subscribeFeedClock(() => undefined);
    expect(vi.getTimerCount()).toBe(1);
    stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});
