// Ticker variants storage - up to 5 named presets with an active one.
//
// Backward-compat: legacy header.trending stored a single flat TickerConfig.
// normalizeTickerSettings() accepts either shape and always returns
// { activeVariantId, variants } - the runtime resolves the active variant's
// config through resolveActiveTickerConfig().
import type { TickerConfig, TickerMode, TickerSource } from "@/lib/views/headerTickerQuery";

export const MAX_TICKER_VARIANTS = 5;

export type IconAnimation = "none" | "pulse" | "flicker" | "spin" | "wave";
export type MixedFill = "trending" | "latest";
/** Visual layout of the bar.
 *  - `classic`       - flame + text label, items scrolled horizontally.
 *  - `badge`         - solid colored block on the left, dot separators.
 *  - `glassMarquee`  - seamless horizontal marquee in a gradient glass frame (v7).
 *  - `glassCards`    - vertically rotating floating glass cards (v5).
 *  - `glassRibbon`   - horizontal marquee on an animated gradient ribbon (v9).
 *  - `glassSpotlight`- vertical rotation with a spotlight glow and large index (v11).
 *  - `glassTape`     - horizontal ticker tape, monospaced with cut corners (v13).
 *  - `glassLive`     - widget "Na czasie": skośny badge + karta z numerem, tytułem
 *                     i inline'owym autorem (awatar + nazwisko). */
export type LayoutStyle =
  | "classic"
  | "badge"
  | "glassMarquee"
  | "glassCards"
  | "glassRibbon"
  | "glassSpotlight"
  | "glassTape"
  | "glassLive";

/** Kierunek ruchu dla stylu `glassLive`. */
export type LiveDirection = "vertical" | "horizontal";
export const LIVE_DIRECTIONS: readonly LiveDirection[] = ["vertical", "horizontal"];

export interface TickerColors {
  bg: string;
  border: string;
  label: string;
  item: string;
  itemHover: string;
  counter: string;
  /** Optional - used only by the `badge` layout. Defaults derive from `label`. */
  labelBg?: string;
  labelFg?: string;
  /** Optional - dot separator between items in `badge` layout. */
  dot?: string;
}

export interface TickerColorScheme {
  light: TickerColors;
  dark: TickerColors;
}

export interface TickerVariant {
  id: string;
  name: string;
  config: TickerConfig;
}

export interface TickerSettings {
  activeVariantId: string;
  variants: TickerVariant[];
}

export const DEFAULT_LIGHT_COLORS: TickerColors = {
  bg: "color-mix(in oklab, var(--muted) 30%, transparent)",
  border: "var(--border)",
  label: "var(--brand)",
  item: "var(--foreground)",
  itemHover: "var(--brand)",
  counter: "var(--muted-foreground)",
  labelBg: "var(--brand)",
  labelFg: "#ffffff",
  dot: "color-mix(in oklab, var(--brand) 70%, transparent)",
};

export const DEFAULT_DARK_COLORS: TickerColors = {
  bg: "color-mix(in oklab, var(--muted) 30%, transparent)",
  border: "var(--border)",
  label: "var(--brand)",
  item: "var(--foreground)",
  itemHover: "var(--brand)",
  counter: "var(--muted-foreground)",
  labelBg: "var(--brand)",
  labelFg: "#ffffff",
  dot: "color-mix(in oklab, var(--brand) 70%, transparent)",
};

export const DEFAULT_TICKER_COLORS: TickerColorScheme = {
  light: { ...DEFAULT_LIGHT_COLORS },
  dark: { ...DEFAULT_DARK_COLORS },
};

export const DEFAULT_TICKER_CONFIG: TickerConfig = {
  enabled: true,
  source: "trending",
  mode: "scroll",
  layoutStyle: "classic",
  days: 7,
  limit: 8,
  visibleCount: 1,
  intervalSec: 6,
  scrollSpeed: 60,
  pinnedPostId: undefined,
  pinnedUntil: null,
  selectedPostIds: [],
  mixedFill: "trending",
  labelPl: "",
  labelEn: "",
  iconAnimation: "flicker",
  colors: DEFAULT_TICKER_COLORS,
  liveDirection: "vertical",
  fullWidth: true,
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function safeString(v: unknown, fb = ""): string {
  return typeof v === "string" ? v : fb;
}

function safeNumber(v: unknown, fb: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fb;
}

function safeBool(v: unknown, fb: boolean): boolean {
  return typeof v === "boolean" ? v : fb;
}

const SOURCES: readonly TickerSource[] = ["trending", "latest", "pinned", "selected", "mixed"];
const MODES: readonly TickerMode[] = ["scroll", "rotate", "fade", "slide", "flip", "typewriter"];
const ICON_ANIMS: readonly IconAnimation[] = ["none", "pulse", "flicker", "spin", "wave"];
const MIX_FILLS: readonly MixedFill[] = ["trending", "latest"];
const LAYOUTS: readonly LayoutStyle[] = [
  "classic",
  "badge",
  "glassMarquee",
  "glassCards",
  "glassRibbon",
  "glassSpotlight",
  "glassTape",
  "glassLive",
];

/** Layouts that carry their own marquee motion - the `mode` knob does not apply. */
export const MARQUEE_LAYOUTS: readonly LayoutStyle[] = [
  "glassMarquee",
  "glassCards",
  "glassRibbon",
  "glassSpotlight",
  "glassTape",
  "glassLive",
];

export function isMarqueeLayout(layout: LayoutStyle | undefined): boolean {
  return MARQUEE_LAYOUTS.includes(layout ?? "classic");
}

function safeEnum<T extends string>(v: unknown, allowed: readonly T[], fb: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fb;
}

function normalizeColors(v: unknown): TickerColorScheme {
  if (!isRecord(v)) return { ...DEFAULT_TICKER_COLORS };
  const light = isRecord(v.light) ? v.light : {};
  const dark = isRecord(v.dark) ? v.dark : {};
  const pickColors = (raw: Record<string, unknown>, fb: TickerColors): TickerColors => ({
    bg: safeString(raw.bg, fb.bg),
    border: safeString(raw.border, fb.border),
    label: safeString(raw.label, fb.label),
    item: safeString(raw.item, fb.item),
    itemHover: safeString(raw.itemHover, fb.itemHover),
    counter: safeString(raw.counter, fb.counter),
    labelBg: safeString(raw.labelBg, fb.labelBg ?? ""),
    labelFg: safeString(raw.labelFg, fb.labelFg ?? ""),
    dot: safeString(raw.dot, fb.dot ?? ""),
  });
  return {
    light: pickColors(light, DEFAULT_LIGHT_COLORS),
    dark: pickColors(dark, DEFAULT_DARK_COLORS),
  };
}

export function normalizeTickerConfig(raw: unknown): TickerConfig {
  const r = isRecord(raw) ? raw : {};
  const selected = Array.isArray(r.selectedPostIds)
    ? r.selectedPostIds.filter((x): x is string => typeof x === "string").slice(0, 3)
    : [];
  return {
    enabled: safeBool(r.enabled, DEFAULT_TICKER_CONFIG.enabled ?? true),
    source: safeEnum<TickerSource>(r.source, SOURCES, "trending"),
    mode: safeEnum<TickerMode>(r.mode, MODES, "scroll"),
    layoutStyle: safeEnum<LayoutStyle>(r.layoutStyle, LAYOUTS, "classic"),
    days: Math.max(1, Math.min(90, safeNumber(r.days, 7))),
    limit: Math.max(1, Math.min(50, safeNumber(r.limit, 8))),
    visibleCount: Math.max(1, Math.min(5, safeNumber(r.visibleCount, 1))),
    intervalSec: Math.max(2, Math.min(120, safeNumber(r.intervalSec, 6))),
    scrollSpeed: Math.max(10, Math.min(400, safeNumber(r.scrollSpeed, 60))),
    pinnedPostId: typeof r.pinnedPostId === "string" && r.pinnedPostId ? r.pinnedPostId : undefined,
    pinnedUntil: typeof r.pinnedUntil === "string" ? r.pinnedUntil : null,
    selectedPostIds: selected,
    mixedFill: safeEnum<MixedFill>(r.mixedFill, MIX_FILLS, "trending"),
    labelPl: safeString(r.labelPl, ""),
    labelEn: safeString(r.labelEn, ""),
    iconAnimation: safeEnum<IconAnimation>(r.iconAnimation, ICON_ANIMS, "flicker"),
    liveDirection: safeEnum<LiveDirection>(r.liveDirection, LIVE_DIRECTIONS, "vertical"),
    colors: normalizeColors(r.colors),
    fullWidth: safeBool(r.fullWidth, true),
  };
}

function genId(): string {
  // crypto.randomUUID exists on modern runtimes we target (workerd + evergreen browsers).
  if (typeof globalThis !== "undefined" && typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function makeDefaultVariant(name = "Domyślny"): TickerVariant {
  return { id: genId(), name, config: { ...DEFAULT_TICKER_CONFIG } };
}

/** Accept either legacy `TickerConfig` or the new `TickerSettings` shape. */
export function normalizeTickerSettings(raw: unknown): TickerSettings {
  if (isRecord(raw) && Array.isArray(raw.variants) && raw.variants.length > 0) {
    const variants = raw.variants
      .slice(0, MAX_TICKER_VARIANTS)
      .filter(isRecord)
      .map(
        (v): TickerVariant => ({
          id: safeString(v.id, "") || genId(),
          name: safeString(v.name, "Wariant"),
          config: normalizeTickerConfig(v.config),
        }),
      );
    if (variants.length === 0) {
      const def = makeDefaultVariant();
      return { activeVariantId: def.id, variants: [def] };
    }
    const active = safeString(raw.activeVariantId, "");
    const activeVariantId = variants.some((v) => v.id === active) ? active : variants[0].id;
    return { activeVariantId, variants };
  }
  // Legacy flat config -> wrap in a single "Domyślny" variant.
  const legacy = normalizeTickerConfig(raw);
  const variant: TickerVariant = { id: genId(), name: "Domyślny", config: legacy };
  return { activeVariantId: variant.id, variants: [variant] };
}

export function resolveActiveTickerConfig(raw: unknown): TickerConfig {
  const s = normalizeTickerSettings(raw);
  const active = s.variants.find((v) => v.id === s.activeVariantId) ?? s.variants[0];
  return active.config;
}
