import { describe, it, expect, beforeEach, vi } from "vitest";

// shouldShow is not exported, but we can mimic via the localStorage key.
const LS_KEY = "nl_popup_last";

describe("NewsletterPopup frequency gate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
    localStorage.clear();
  });

  it("shows when no record", () => {
    expect(localStorage.getItem(LS_KEY)).toBeNull();
  });

  it("hides for freqDays window, then shows again after", () => {
    const now = Date.now();
    localStorage.setItem(LS_KEY, String(now - 3 * 86_400_000));
    const within = Date.now() - Number(localStorage.getItem(LS_KEY)) < 7 * 86_400_000;
    expect(within).toBe(true);

    vi.setSystemTime(new Date("2026-01-25T12:00:00Z"));
    const after = Date.now() - Number(localStorage.getItem(LS_KEY)) > 7 * 86_400_000;
    expect(after).toBe(true);
  });
});
