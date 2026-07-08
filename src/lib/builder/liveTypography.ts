import type { WidgetTypography } from "./types";
import { buildLiveWidgetTypographyCss } from "./typographyCss";

const CHANNEL_NAME = "builder-widget-typography";
const EVENT_NAME = "builder:widget-typography";
const STORAGE_PREFIX = "builder:widget-typography:";
const STYLE_ID_PREFIX = "builder-live-typography-style-";

interface WidgetTypographyLivePayload {
  widgetId: string;
  typography: WidgetTypography | undefined;
  updatedAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePayload(value: unknown): WidgetTypographyLivePayload | null {
  if (!isRecord(value) || typeof value.widgetId !== "string") return null;
  const typography = value.typography;
  if (typography !== undefined && !isRecord(typography)) return null;
  const updatedAt = typeof value.updatedAt === "number" ? value.updatedAt : Date.now();
  return {
    widgetId: value.widgetId,
    typography: typography === undefined ? undefined : (typography as WidgetTypography),
    updatedAt,
  };
}

function storageKey(widgetId: string): string {
  return `${STORAGE_PREFIX}${widgetId}`;
}

function styleElementId(widgetId: string): string {
  return `${STYLE_ID_PREFIX}${widgetId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function applyLiveTypographyStyle(
  widgetId: string,
  typography: WidgetTypography | undefined,
): void {
  if (typeof document === "undefined") return;
  const id = styleElementId(widgetId);
  const existing = document.getElementById(id);
  if (!typography) {
    existing?.remove();
    return;
  }
  const css = buildLiveWidgetTypographyCss(widgetId, typography);
  const style = existing instanceof HTMLStyleElement ? existing : document.createElement("style");
  style.id = id;
  style.textContent = css;
  if (!existing) document.head.appendChild(style);
}

export function broadcastWidgetTypography(
  widgetId: string,
  typography: WidgetTypography | undefined,
): void {
  if (typeof window === "undefined") return;
  const payload: WidgetTypographyLivePayload = { widgetId, typography, updatedAt: Date.now() };

  applyLiveTypographyStyle(widgetId, typography);

  window.dispatchEvent(
    new CustomEvent<WidgetTypographyLivePayload>(EVENT_NAME, { detail: payload }),
  );

  try {
    if (typography === undefined) window.sessionStorage.removeItem(storageKey(widgetId));
    else window.sessionStorage.setItem(storageKey(widgetId), JSON.stringify(payload));
  } catch {
    // sessionStorage can be disabled - live same-document updates still work.
  }

  if (typeof BroadcastChannel === "undefined") return;
  try {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage(payload);
    channel.close();
  } catch {
    // BroadcastChannel is best-effort; React state update remains authoritative.
  }
}

/**
 * Drop every live typography override (same-document): removes the injected
 * <style> nodes + sessionStorage snapshots and notifies subscribers with
 * `undefined` so widgets fall back to the DOCUMENT's typography.
 *
 * Needed around undo/redo: the live broadcast otherwise shadows the restored
 * document value and the canvas visibly "ignores" the undo.
 */
export function clearAllLiveWidgetTypography(): void {
  if (typeof window === "undefined") return;
  const widgetIds = new Set<string>();
  try {
    for (let i = window.sessionStorage.length - 1; i >= 0; i--) {
      const key = window.sessionStorage.key(i);
      if (key && key.startsWith(STORAGE_PREFIX)) {
        widgetIds.add(key.slice(STORAGE_PREFIX.length));
        window.sessionStorage.removeItem(key);
      }
    }
  } catch {
    // sessionStorage can be disabled — style/subscriber cleanup still runs.
  }
  if (typeof document !== "undefined") {
    document.querySelectorAll(`style[id^="${STYLE_ID_PREFIX}"]`).forEach((el) => el.remove());
  }
  widgetIds.forEach((widgetId) => {
    window.dispatchEvent(
      new CustomEvent<WidgetTypographyLivePayload>(EVENT_NAME, {
        detail: { widgetId, typography: undefined, updatedAt: Date.now() },
      }),
    );
  });
}

export function subscribeWidgetTypography(
  widgetId: string,
  onChange: (typography: WidgetTypography | undefined) => void,
): () => void {
  if (typeof window === "undefined") return () => {};

  try {
    const raw = window.sessionStorage.getItem(storageKey(widgetId));
    const payload = raw ? normalizePayload(JSON.parse(raw) as unknown) : null;
    if (payload?.widgetId === widgetId) {
      applyLiveTypographyStyle(widgetId, payload.typography);
      onChange(payload.typography);
    }
  } catch {
    // Ignore stale or unavailable storage.
  }

  const handlePayload = (value: unknown) => {
    const payload = normalizePayload(value);
    if (payload?.widgetId === widgetId) {
      applyLiveTypographyStyle(widgetId, payload.typography);
      onChange(payload.typography);
    }
  };

  const handleEvent = (event: Event) => {
    if (event instanceof CustomEvent) handlePayload(event.detail as unknown);
  };

  window.addEventListener(EVENT_NAME, handleEvent);

  let channel: BroadcastChannel | null = null;
  if (typeof BroadcastChannel !== "undefined") {
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = (event: MessageEvent<unknown>) => handlePayload(event.data);
    } catch {
      channel = null;
    }
  }

  return () => {
    window.removeEventListener(EVENT_NAME, handleEvent);
    channel?.close();
  };
}
