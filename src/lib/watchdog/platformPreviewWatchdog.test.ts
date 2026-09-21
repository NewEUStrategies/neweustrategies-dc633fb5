// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  startPreviewWatchdog,
  triggerWatchdogReload,
  markPreviewAppReady,
  __watchdogInternals as K,
} from "./previewWatchdog";
import { isAppReady } from "./appReady";

let frame: FrameRequestCallback;
let boot: () => void;
let heartbeat: () => void;
let wall = 1_000;
let monotonic = 1_000;
let store: Map<string, string>;
let fakeWindow: Window;
const reload = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  wall = 1_000;
  monotonic = 1_000;
  store = new Map();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
  fakeWindow = {
    self: {},
    top: {},
    sessionStorage: storage,
    location: { reload },
    requestAnimationFrame: vi.fn((cb) => {
      frame = cb;
      return 11;
    }),
    cancelAnimationFrame: vi.fn(),
    setTimeout: vi.fn((cb) => {
      boot = cb;
      return 22;
    }),
    clearTimeout: vi.fn(),
    setInterval: vi.fn((cb) => {
      heartbeat = cb;
      return 33;
    }),
    clearInterval: vi.fn(),
  } as unknown as Window;
  vi.stubGlobal("window", fakeWindow);
  vi.stubGlobal("document", { visibilityState: "visible" });
  vi.spyOn(Date, "now").mockImplementation(() => wall);
  vi.spyOn(performance, "now").mockImplementation(() => monotonic);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("preview watchdog lifecycle", () => {
  it("does nothing in SSR or a top-level published page", () => {
    vi.stubGlobal("window", undefined);
    startPreviewWatchdog()();
    vi.stubGlobal("window", fakeWindow);
    Object.assign(fakeWindow, { top: fakeWindow.self });
    startPreviewWatchdog()();
    expect(fakeWindow.requestAnimationFrame).not.toHaveBeenCalled();
  });
  it("starts once, refreshes both clocks, and completely cleans up", () => {
    const stop = startPreviewWatchdog();
    startPreviewWatchdog()();
    expect(fakeWindow.setTimeout).toHaveBeenCalledWith(expect.any(Function), K.BOOT_TIMEOUT_MS);
    expect(fakeWindow.setInterval).toHaveBeenCalledWith(
      expect.any(Function),
      K.HEARTBEAT_INTERVAL_MS,
    );
    wall += K.FREEZE_THRESHOLD_MS + 1;
    monotonic = wall;
    frame(monotonic);
    heartbeat();
    expect(reload).not.toHaveBeenCalled();
    stop();
    expect(fakeWindow.cancelAnimationFrame).toHaveBeenCalledWith(11);
    expect(fakeWindow.clearTimeout).toHaveBeenCalledWith(22);
    expect(fakeWindow.clearInterval).toHaveBeenCalledWith(33);
    expect(fakeWindow.__nesPreviewWatchdogStarted).toBe(false);
    frame(monotonic);
    boot();
    heartbeat();
    expect(reload).not.toHaveBeenCalled();
    startPreviewWatchdog()();
    expect(fakeWindow.setInterval).toHaveBeenCalledTimes(2);
  });
  it("reloads a boot that never commits, but stands down once ready", () => {
    const stop = startPreviewWatchdog();
    boot();
    expect(reload).toHaveBeenCalledTimes(1);
    markPreviewAppReady();
    expect(isAppReady()).toBe(true);
    boot();
    expect(reload).toHaveBeenCalledTimes(1);
    stop();
  });
  it.each(["hidden", "wall-only", "frame-only", "both"])(
    "requires a visible tab and both clocks: %s",
    (mode) => {
      const stop = startPreviewWatchdog();
      if (mode === "hidden") vi.stubGlobal("document", { visibilityState: "hidden" });
      if (mode !== "frame-only") wall += K.FREEZE_THRESHOLD_MS + 1;
      if (mode !== "wall-only") monotonic += K.FREEZE_THRESHOLD_MS + 1;
      heartbeat();
      expect(reload).toHaveBeenCalledTimes(mode === "both" ? 1 : 0);
      stop();
    },
  );
  it("handles cross-origin top access and an unavailable console", () => {
    Object.defineProperty(fakeWindow, "top", {
      get() {
        throw new Error("cross-origin");
      },
    });
    vi.mocked(console.warn).mockImplementation(() => {
      throw new Error("unavailable");
    });
    const stop = startPreviewWatchdog();
    boot();
    expect(reload).toHaveBeenCalledTimes(1);
    stop();
  });
});

describe("watchdog storage failure and cooldown", () => {
  it.each([null, "not json", "null", "{}", '{"count":"bad","since":"bad"}'])(
    "recovers from missing/corrupt counters: %s",
    (value) => {
      if (value !== null) store.set(K.RELOAD_COUNTER_KEY, value);
      expect(triggerWatchdogReload({ reason: "boot-timeout" })).toBe(true);
      expect(JSON.parse(store.get(K.RELOAD_COUNTER_KEY)!)).toEqual({ count: 1, since: wall });
    },
  );
  it("survives denied access to the sessionStorage getter", () => {
    Object.defineProperty(fakeWindow, "sessionStorage", {
      get() {
        throw new Error("storage denied");
      },
    });
    expect(triggerWatchdogReload({ reason: "boot-timeout" })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it("survives read and write failures and explicit storage opt-out", () => {
    const storage = {
      getItem() {
        throw new Error("denied");
      },
      setItem() {
        throw new Error("quota");
      },
    } as unknown as Storage;
    expect(triggerWatchdogReload({ reason: "boot-timeout", storage })).toBe(true);
    expect(triggerWatchdogReload({ reason: "boot-timeout", storage: null })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });
  it("logs a suppressed reload and resets an expired window", () => {
    store.set(K.RELOAD_COUNTER_KEY, JSON.stringify({ count: K.MAX_RELOADS, since: wall }));
    const logger = vi.fn();
    expect(triggerWatchdogReload({ reason: "boot-timeout", logger })).toBe(false);
    expect(logger).toHaveBeenCalledWith(expect.stringContaining("suppressed"), {
      reason: "boot-timeout",
      count: K.MAX_RELOADS,
    });
    wall += K.COOLDOWN_MS;
    expect(triggerWatchdogReload({ reason: "main-thread-freeze", logger })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it("has safe SSR defaults, including its no-op reload", () => {
    vi.stubGlobal("window", undefined);
    expect(triggerWatchdogReload({ reason: "boot-timeout" })).toBe(true);
    expect(reload).not.toHaveBeenCalled();
    markPreviewAppReady();
    expect(isAppReady()).toBe(false);
  });
});
