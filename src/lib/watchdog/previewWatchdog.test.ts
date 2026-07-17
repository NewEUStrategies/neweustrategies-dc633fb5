import { describe, it, expect, vi } from "vitest";
import {
  triggerWatchdogReload,
  __watchdogInternals,
} from "./previewWatchdog";

function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: (i) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

describe("triggerWatchdogReload", () => {
  it("reloads up to MAX_RELOADS times inside the cooldown window", () => {
    const storage = makeStorage();
    const reload = vi.fn();
    const now = vi.fn(() => 1_000);
    for (let i = 0; i < __watchdogInternals.MAX_RELOADS; i++) {
      const fired = triggerWatchdogReload({
        reason: "boot-timeout",
        now,
        storage,
        reload,
      });
      expect(fired).toBe(true);
    }
    expect(reload).toHaveBeenCalledTimes(__watchdogInternals.MAX_RELOADS);
  });

  it("suppresses the (MAX_RELOADS + 1)th reload within the cooldown window", () => {
    const storage = makeStorage();
    const reload = vi.fn();
    const now = vi.fn(() => 1_000);
    for (let i = 0; i < __watchdogInternals.MAX_RELOADS; i++) {
      triggerWatchdogReload({ reason: "boot-timeout", now, storage, reload });
    }
    const fired = triggerWatchdogReload({
      reason: "boot-timeout",
      now,
      storage,
      reload,
    });
    expect(fired).toBe(false);
    expect(reload).toHaveBeenCalledTimes(__watchdogInternals.MAX_RELOADS);
  });

  it("resets the counter once the cooldown window elapses", () => {
    const storage = makeStorage();
    const reload = vi.fn();
    let t = 1_000;
    for (let i = 0; i < __watchdogInternals.MAX_RELOADS; i++) {
      triggerWatchdogReload({
        reason: "boot-timeout",
        now: () => t,
        storage,
        reload,
      });
    }
    t += __watchdogInternals.COOLDOWN_MS + 1;
    const fired = triggerWatchdogReload({
      reason: "main-thread-freeze",
      now: () => t,
      storage,
      reload,
    });
    expect(fired).toBe(true);
    expect(reload).toHaveBeenCalledTimes(__watchdogInternals.MAX_RELOADS + 1);
  });
});
