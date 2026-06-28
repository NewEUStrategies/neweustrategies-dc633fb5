import type { WidgetTypography } from "./types";

const CHANNEL_NAME = "builder-widget-typography";
const EVENT_NAME = "builder:widget-typography";
const STORAGE_PREFIX = "builder:widget-typography:";
const STYLE_ID_PREFIX = "builder-live-typography-style-";

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

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function styleElementId(widgetId: string): string {
  return `${STYLE_ID_PREFIX}${widgetId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function pickResponsiveValue<T>(
  value: { desktop?: T; tablet?: T; mobile?: T } | undefined,
  device: "desktop" | "tablet" | "mobile",
): T | undefined {
  if (!value) return undefined;
  return value[device] ?? value.desktop ?? value.tablet ?? value.mobile;
}

function typographyRules(widgetId: string, typography: WidgetTypography, device: "desktop" | "tablet" | "mobile", ancestor = ""): string[] {
  const id = cssEscape(widgetId);
  // Triple widget attribute intentionally outranks stale per-widget style tags
  // that may still contain the previous value during React/history updates.
  const sel = `${ancestor}[data-w-id="${id}"][data-w-id][data-w-id]`;
  const descendants = `${sel}, ${sel} :is(p,span,a,strong,em,small,li,dt,dd,blockquote,cite,label,button,input,textarea,select,option,figcaption,legend,time,h1,h2,h3,h4,h5,h6,.prose,.prose *):not(.cms-post-title):not(.cms-post-excerpt):not(.post-list-numbered-index):not(.rl-num)`;
  const headingSel = `${sel} :is(h1,h2,h3,h4,h5,h6):not(.cms-post-title):not(.post-list-numbered-index):not(.rl-num), ${sel}[data-title-root]`;
  const descriptionSel = `${sel} :is(p,.prose p,li,dd,blockquote,figcaption,small)`;
  const titleClassSel = `${sel} .cms-post-title`;
  const excerptClassSel = `${sel} .cms-post-excerpt`;
  const rules: string[] = [];

  if (typography.fontFamily) {
    rules.push(`${descendants}{font-family:${typography.fontFamily} !important;}`);
    rules.push(`${sel} input::placeholder, ${sel} textarea::placeholder{font-family:${typography.fontFamily} !important;}`);
  }

  const fontSize = pickResponsiveValue(typography.fontSize, device);
  const descriptionFontSize = pickResponsiveValue(typography.descriptionFontSize, device);
  if (fontSize) {
    if (descriptionFontSize) {
      rules.push(`${headingSel}{font-size:${fontSize} !important;}`);
      rules.push(`${titleClassSel}{font-size:${fontSize} !important;}`);
    } else {
      rules.push(`${descendants}{font-size:${fontSize} !important;}`);
      rules.push(`${titleClassSel}{font-size:${fontSize} !important;}`);
      rules.push(`${sel} input::placeholder, ${sel} textarea::placeholder{font-size:${fontSize} !important;}`);
    }
  }
  if (descriptionFontSize) {
    rules.push(`${descriptionSel}{font-size:${descriptionFontSize} !important;}`);
    rules.push(`${excerptClassSel}{font-size:${descriptionFontSize} !important;}`);
  }
  if (typeof typography.titleDescriptionGapPx === "number" && typography.titleDescriptionGapPx >= 0) {
    const gap = `${typography.titleDescriptionGapPx}px`;
    rules.push(`${sel} :is(h1,h2,h3,h4,h5,h6) + :is(p,.prose p,ul,ol,blockquote,figcaption,small){margin-top:${gap} !important;}`);
    rules.push(`${sel} a:has(> :is(h1,h2,h3,h4,h5,h6)) + :is(p,blockquote,small){margin-top:${gap} !important;}`);
  }

  if (typography.fontWeight) rules.push(`${descendants}{font-weight:${typography.fontWeight} !important;}`);
  if (typography.fontStyle) rules.push(`${descendants}{font-style:${typography.fontStyle} !important;}`);
  if (typography.lineHeight) rules.push(`${descendants}{line-height:${typography.lineHeight} !important;}`);
  if (typography.letterSpacing) rules.push(`${descendants}{letter-spacing:${typography.letterSpacing} !important;}`);
  if (typography.textTransform) rules.push(`${descendants}{text-transform:${typography.textTransform} !important;}`);
  if (typography.textDecoration) rules.push(`${descendants}{text-decoration:${typography.textDecoration} !important;}`);
  if (typography.textAlign) rules.push(`${descendants}{text-align:${typography.textAlign} !important;}`);

  return rules;
}

function liveTypographyCss(widgetId: string, typography: WidgetTypography): string {
  const base = typographyRules(widgetId, typography, "desktop");
  const tablet = typographyRules(widgetId, typography, "tablet", `[data-builder-renderer][data-device="tablet"] `);
  const tabletCanvas = typographyRules(widgetId, typography, "tablet", `[data-visual-canvas][data-device="tablet"] `);
  const mobile = typographyRules(widgetId, typography, "mobile", `[data-builder-renderer][data-device="mobile"] `);
  const mobileCanvas = typographyRules(widgetId, typography, "mobile", `[data-visual-canvas][data-device="mobile"] `);
  return [
    ...base,
    `@media (max-width: 1023px) and (min-width: 768px){${tablet.join("")}}`,
    `@media (max-width: 1023px) and (min-width: 768px){${tabletCanvas.join("")}}`,
    `@media (max-width: 767px){${mobile.join("")}}`,
    `@media (max-width: 767px){${mobileCanvas.join("")}}`,
  ].filter(Boolean).join("\n");
}

function applyLiveTypographyStyle(widgetId: string, typography: WidgetTypography | undefined): void {
  if (typeof document === "undefined") return;
  const id = styleElementId(widgetId);
  const existing = document.getElementById(id);
  if (!typography) {
    existing?.remove();
    return;
  }
  const css = liveTypographyCss(widgetId, typography);
  const style = existing instanceof HTMLStyleElement ? existing : document.createElement("style");
  style.id = id;
  style.textContent = css;
  if (!existing) document.head.appendChild(style);
}

export function broadcastWidgetTypography(widgetId: string, typography: WidgetTypography | undefined): void {
  if (typeof window === "undefined") return;
  const payload: WidgetTypographyLivePayload = { widgetId, typography, updatedAt: Date.now() };

  applyLiveTypographyStyle(widgetId, typography);

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
