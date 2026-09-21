import { afterEach, expect, it, vi } from "vitest";
import { crossesDay, dayLabel, relTime } from "../time";
afterEach(() => vi.useRealTimers());
it("handles first messages and dates across calendar years", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-12T12:00:00Z"));
  expect(crossesDay(undefined, "2026-09-12T12:00:00Z")).toBe(true);
  expect(
    dayLabel("2025-09-12T12:00:00Z", "en", { today: "Today", yesterday: "Yesterday" }),
  ).toContain("2025");
  expect(relTime("2026-08-01T12:00:00Z", "en")).toBe("1 Aug");
});
