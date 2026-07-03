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

export interface TickerColors {
  bg: string;
  border: string;
  label: string;
  item: string;
  itemHover: string;
  counter: string;
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
  bg: "hsl(var(--muted) / 0.3)",
  border: "hsl(var(--border))",
  label: "hsl(var(--brand))",
  item: "hsl(var(--foreground))",
  itemHover: "hsl(var(--brand))",
  counter: "hsl(var(--muted-foreground))",
};

export const DEFAULT_DARK_COLORS: TickerColors = {
  bg: "hsl(var(--muted) / 0.3)",
  border: "hsl(var(--border))",
  label: "hsl(var(--brand))",
  item: "hsl(var(--foreground))",
  itemHover: "hsl(var(--brand))",
  counter: "hsl(var(--muted-foreground))",
};

export const DEFAULT_TICKER_COLORS: TickerColorScheme = {
  light: { ...DEFAULT_LIGHT_COLORS },
  dark: { ...DEFAULT_DARK_COLORS },
};

export const DEFAULT_TICKER_CONFIG: TickerConfig = {
  enabled: true,
  source: "trending",
  mode: "scroll",
  days: 7,
  limit: 8,
  visibleCount: 1,
  intervalSec: 6,
  pinnedPostId: undefined,
  pinnedUntil: null,
  selectedPostIds: [],
  mixedFill: "trending",
  labelPl: "",
  labelEn: "",
  iconAnimation: "flicker",
  colors: DEFAULT_TICKER_COLORS,
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
    days: Math.max(1, Math.min(90, safeNumber(r.days, 7))),
    limit: Math.max(1, Math.min(50, safeNumber(r.limit, 8))),
    visibleCount: Math.max(1, Math.min(5, safeNumber(r.visibleCount, 1))),
    intervalSec: Math.max(2, Math.min(120, safeNumber(r.intervalSec, 6))),
    pinnedPostId: typeof r.pinnedPostId === "string" && r.pinnedPostId ? r.pinnedPostId : undefined,
    pinnedUntil: typeof r.pinnedUntil === "string" ? r.pinnedUntil : null,
    selectedPostIds: selected,
    mixedFill: safeEnum<MixedFill>(r.mixedFill, MIX_FILLS, "trending"),
    labelPl: safeString(r.labelPl, ""),
    labelEn: safeString(r.labelEn, ""),
    iconAnimation: safeEnum<IconAnimation>(r.iconAnimation, ICON_ANIMS, "flicker"),
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
      .map((v): TickerVariant => ({
        id: safeString(v.id, "") || genId(),
        name: safeString(v.name, "Wariant"),
        config: normalizeTickerConfig(v.config),
      }));
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
