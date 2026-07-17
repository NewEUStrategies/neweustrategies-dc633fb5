// Preview iframe watchdog. Monitors two failure modes that leave the Lovable
// editor preview looking "zawieszone" (czarny prostokąt, spinner bez końca):
//
//  1. Boot hang - React hydration never commits (network, HMR, SSR mismatch
//     regenerate loop) and window.__nesAppReady is never set. If we don't see
//     the ready flag within BOOT_TIMEOUT_MS from load, reload once.
//
//  2. Main-thread freeze - a long task, infinite loop or fetch/deadlock keeps
//     the event loop blocked. requestAnimationFrame stops ticking; when it
//     resumes we can measure the gap. If the gap exceeds FREEZE_THRESHOLD_MS
//     while the tab is visible, reload once.
//
// A sessionStorage cooldown prevents a reload loop when the underlying problem
// is deterministic (max MAX_RELOADS reloads per COOLDOWN_MS window). The
// watchdog runs only inside an iframe (window.self !== window.top) so it never
// reloads the published site for real end users.

const READY_FLAG_KEY = "__nesAppReady";
const RELOAD_COUNTER_KEY = "nes:preview-watchdog:reloads";
const BOOT_TIMEOUT_MS = 15_000;
const FREEZE_THRESHOLD_MS = 8_000;
const HEARTBEAT_INTERVAL_MS = 500;
const COOLDOWN_MS = 60_000;
const MAX_RELOADS = 2;

type ReloadCounter = { count: number; since: number };

declare global {
  interface Window {
    __nesAppReady?: boolean;
    __nesPreviewWatchdogStarted?: boolean;
  }
}

function isInsideIframe(): boolean {
  try {
    return typeof window !== "undefined" && window.self !== window.top;
  } catch {
    // Cross-origin frame access throws - that means we ARE inside an iframe.
    return true;
  }
}

function readReloadCounter(storage: Storage | null): ReloadCounter {
  if (!storage) return { count: 0, since: Date.now() };
  try {
    const raw = storage.getItem(RELOAD_COUNTER_KEY);
    if (!raw) return { count: 0, since: Date.now() };
    const parsed = JSON.parse(raw) as Partial<ReloadCounter>;
    const count = typeof parsed.count === "number" ? parsed.count : 0;
    const since = typeof parsed.since === "number" ? parsed.since : Date.now();
    return { count, since };
  } catch {
    return { count: 0, since: Date.now() };
  }
}

function writeReloadCounter(storage: Storage | null, next: ReloadCounter): void {
  if (!storage) return;
  try {
    storage.setItem(RELOAD_COUNTER_KEY, JSON.stringify(next));
  } catch {
    /* quota / disabled storage - watchdog degrades gracefully */
  }
}

export interface WatchdogTriggerOptions {
  reason: "boot-timeout" | "main-thread-freeze";
  now?: () => number;
  storage?: Storage | null;
  reload?: () => void;
  logger?: (message: string, meta: Record<string, unknown>) => void;
}

/**
 * Decide whether a reload should actually fire and, if so, execute it.
 * Exposed for unit tests - the runtime watchdog delegates every reload here.
 */
export function triggerWatchdogReload(options: WatchdogTriggerOptions): boolean {
  const now = options.now ?? Date.now;
  const storage =
    options.storage !== undefined
      ? options.storage
      : typeof window !== "undefined"
        ? window.sessionStorage
        : null;
  const currentTime = now();
  const counter = readReloadCounter(storage);
  const hasActiveWindow = counter.count > 0;
  const withinWindow = hasActiveWindow && currentTime - counter.since < COOLDOWN_MS;
  const nextCount = withinWindow ? counter.count + 1 : 1;
  const nextSince = withinWindow ? counter.since : currentTime;

  if (nextCount > MAX_RELOADS) {
    options.logger?.("preview-watchdog: reload suppressed (cooldown)", {
      reason: options.reason,
      count: counter.count,
    });
    return false;
  }

  writeReloadCounter(storage, { count: nextCount, since: nextSince });
  options.logger?.("preview-watchdog: reloading", {
    reason: options.reason,
    count: nextCount,
  });

  const reload =
    options.reload ?? (typeof window !== "undefined" ? () => window.location.reload() : () => {});
  reload();
  return true;
}

/**
 * Start the preview watchdog. Idempotent - safe to call from React effects.
 * Returns a cleanup callback that stops all timers/listeners.
 */
export function startPreviewWatchdog(): () => void {
  if (typeof window === "undefined") return () => {};
  if (!isInsideIframe()) return () => {};
  if (window.__nesPreviewWatchdogStarted) return () => {};
  window.__nesPreviewWatchdogStarted = true;

  let stopped = false;
  let lastHeartbeat = Date.now();
  let lastFrame = performance.now();
  let rafId = 0;
  const logger = (message: string, meta: Record<string, unknown>) => {
    try {
      console.warn(`[watchdog] ${message}`, meta);
    } catch {
      /* console may be unavailable in exotic sandboxes */
    }
  };

  const tick = (frameTime: number) => {
    if (stopped) return;
    lastFrame = frameTime;
    lastHeartbeat = Date.now();
    rafId = window.requestAnimationFrame(tick);
  };
  rafId = window.requestAnimationFrame(tick);

  const bootTimer = window.setTimeout(() => {
    if (stopped) return;
    if (window[READY_FLAG_KEY]) return;
    triggerWatchdogReload({ reason: "boot-timeout", logger });
  }, BOOT_TIMEOUT_MS);

  const heartbeatTimer = window.setInterval(() => {
    if (stopped) return;
    if (document.visibilityState !== "visible") return;
    const wallGap = Date.now() - lastHeartbeat;
    const frameGap = performance.now() - lastFrame;
    // Both timers must confirm the freeze - guards against a paused rAF
    // (some browsers pause rAF for background tabs even while "visible" in
    // an off-screen iframe).
    if (wallGap > FREEZE_THRESHOLD_MS && frameGap > FREEZE_THRESHOLD_MS) {
      triggerWatchdogReload({ reason: "main-thread-freeze", logger });
    }
  }, HEARTBEAT_INTERVAL_MS);

  return () => {
    stopped = true;
    window.cancelAnimationFrame(rafId);
    window.clearTimeout(bootTimer);
    window.clearInterval(heartbeatTimer);
    window.__nesPreviewWatchdogStarted = false;
  };
}

/**
 * Signal that the app has finished its initial commit. Called from the root
 * component's mount effect - it flips the READY flag so the boot-timeout arm
 * of the watchdog stands down.
 */
export function markPreviewAppReady(): void {
  if (typeof window === "undefined") return;
  window[READY_FLAG_KEY] = true;
}

export const __watchdogInternals = {
  BOOT_TIMEOUT_MS,
  FREEZE_THRESHOLD_MS,
  HEARTBEAT_INTERVAL_MS,
  COOLDOWN_MS,
  MAX_RELOADS,
  RELOAD_COUNTER_KEY,
} as const;
