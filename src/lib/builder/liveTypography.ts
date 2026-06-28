import type { WidgetTypography } from "./types";

const CHANNEL_NAME = "builder-widget-typography";
const EVENT_NAME = "builder:widget-typography";
const STORAGE_PREFIX = "builder:widget-typography:";

export interface WidgetTypographyLivePayload {
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
    typography: typography === undefined ? undefined : typography as WidgetTypography,
    updatedAt,
  };
}

function storageKey(widgetId: string): string {
  return `${STORAGE_PREFIX}${widgetId}`;
}

export function broadcastWidgetTypography(widgetId: string, typography: WidgetTypography | undefined): void {
  if (typeof window === "undefined") return;
  const payload: WidgetTypographyLivePayload = { widgetId, typography, updatedAt: Date.now() };

  window.dispatchEvent(new CustomEvent<WidgetTypographyLivePayload>(EVENT_NAME, { detail: payload }));

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

export function subscribeWidgetTypography(
  widgetId: string,
  onChange: (typography: WidgetTypography | undefined) => void,
): () => void {
  if (typeof window === "undefined") return () => {};

  try {
    const raw = window.sessionStorage.getItem(storageKey(widgetId));
    const payload = raw ? normalizePayload(JSON.parse(raw) as unknown) : null;
    if (payload?.widgetId === widgetId) onChange(payload.typography);
  } catch {
    // Ignore stale or unavailable storage.
  }

  const handlePayload = (value: unknown) => {
    const payload = normalizePayload(value);
    if (payload?.widgetId === widgetId) onChange(payload.typography);
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
