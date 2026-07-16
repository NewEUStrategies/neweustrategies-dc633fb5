import { beforeEach, describe, expect, it, vi } from "vitest";

import { consumeLastCapturedError, recordCapturedError } from "./ssr-error-capture";

describe("SSR error capture", () => {
  beforeEach(() => {
    vi.useRealTimers();
    consumeLastCapturedError();
  });

  it("preserves the original error object and consumes it once", () => {
    const error = new Error("database request failed");

    recordCapturedError(error);

    expect(consumeLastCapturedError()).toBe(error);
    expect(consumeLastCapturedError()).toBeUndefined();
  });

  it("discards stale errors so unrelated requests are not correlated", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T21:00:00Z"));
    recordCapturedError(new Error("old request"));

    vi.advanceTimersByTime(5_001);

    expect(consumeLastCapturedError()).toBeUndefined();
    vi.useRealTimers();
  });
});