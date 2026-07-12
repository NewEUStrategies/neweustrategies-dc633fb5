import { describe, expect, it } from "vitest";
import { isLiveNow, LIVE_WINDOW_MS } from "@/lib/queries/liveBlogs";

describe("isLiveNow", () => {
  const now = Date.parse("2026-07-13T12:00:00Z");

  it("treats an entry inside the window as live", () => {
    expect(isLiveNow("2026-07-13T11:30:00Z", now)).toBe(true);
  });

  it("treats an entry older than the window as ended", () => {
    expect(isLiveNow(new Date(now - LIVE_WINDOW_MS - 1000).toISOString(), now)).toBe(false);
  });

  it("rejects malformed timestamps", () => {
    expect(isLiveNow("not-a-date", now)).toBe(false);
  });
});
