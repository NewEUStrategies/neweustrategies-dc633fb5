/**
 * BI chart theme wired to the project's semantic CSS tokens (--chart-1..5,
 * --primary, --muted-foreground, --border). ECharts is themed at runtime rather
 * than statically so it follows theme-mode changes without a rebuild.
 *
 * Guiding principles:
 * - Never hardcode colours in individual charts; consume `getChartPalette()`.
 * - Tooltip/axis/legend copy comes from the caller's option; this file only
 *   sets primitives (colours, grid, animation, font).
 * - SSR-safe: `getComputedStyle` is guarded and falls back to a light-mode set.
 */
import type { EChartsCoreOption } from "echarts/core";

const FALLBACK_PALETTE = ["#2a78d6", "#1baf7a", "#eda100", "#008300", "#4a3aa7"] as const;
const FALLBACK_MUTED = "#6b7280";
const FALLBACK_BORDER = "#e5e7eb";
const FALLBACK_FOREGROUND = "#111827";
const FALLBACK_BG = "#ffffff";

interface ResolvedTheme {
  palette: string[];
  muted: string;
  border: string;
  foreground: string;
  background: string;
  primary: string;
  success: string;
  warning: string;
  danger: string;
}

function readVar(root: HTMLElement, name: string, fallback: string): string {
  const raw = getComputedStyle(root).getPropertyValue(name).trim();
  if (!raw) return fallback;
  // Support both raw colours ("#123abc") and hsl-triplet tokens ("221 83% 53%").
  if (raw.startsWith("#") || raw.startsWith("rgb") || raw.startsWith("hsl")) return raw;
  return `hsl(${raw})`;
}

export function resolveChartTheme(): ResolvedTheme {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return {
      palette: [...FALLBACK_PALETTE],
      muted: FALLBACK_MUTED,
      border: FALLBACK_BORDER,
      foreground: FALLBACK_FOREGROUND,
      background: FALLBACK_BG,
      primary: FALLBACK_PALETTE[0],
      success: "#16a34a",
      warning: "#f59e0b",
      danger: "#dc2626",
    };
  }
  const root = document.documentElement;
  const palette = [1, 2, 3, 4, 5].map((i) =>
    readVar(root, `--chart-${i}`, FALLBACK_PALETTE[(i - 1) % FALLBACK_PALETTE.length]),
  );
  return {
    palette,
    muted: readVar(root, "--muted-foreground", FALLBACK_MUTED),
    border: readVar(root, "--border", FALLBACK_BORDER),
    foreground: readVar(root, "--foreground", FALLBACK_FOREGROUND),
    background: readVar(root, "--background", FALLBACK_BG),
    primary: readVar(root, "--primary", palette[0]),
    success: "#16a34a",
    warning: "#f59e0b",
    danger: "#dc2626",
  };
}

/** Baseline option every chart merges over — dark-mode aware axes + tooltip. */
export function baseOption(theme: ResolvedTheme): EChartsCoreOption {
  return {
    color: theme.palette,
    backgroundColor: "transparent",
    textStyle: {
      color: theme.foreground,
      fontFamily:
        '"Red Hat Display", "Red Hat Display Fallback", system-ui, -apple-system, "Segoe UI", sans-serif',
    },
    animationDuration: 400,
    animationEasing: "cubicOut",
    grid: { left: 44, right: 20, top: 32, bottom: 32, containLabel: true },
    legend: {
      textStyle: { color: theme.muted, fontSize: 11 },
      icon: "roundRect",
      itemWidth: 10,
      itemHeight: 6,
      top: 4,
      right: 4,
    },
    tooltip: {
      trigger: "axis",
      backgroundColor: theme.background,
      borderColor: theme.border,
      borderWidth: 1,
      padding: [8, 10],
      textStyle: { color: theme.foreground, fontSize: 12 },
      extraCssText: "box-shadow: 0 6px 20px -6px rgba(0,0,0,0.18); border-radius: 8px;",
    },
    xAxis: {
      axisLine: { lineStyle: { color: theme.border } },
      axisTick: { lineStyle: { color: theme.border } },
      splitLine: { show: false },
      axisLabel: { color: theme.muted, fontSize: 11 },
    },
    yAxis: {
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: theme.border, type: "dashed" } },
      axisLabel: { color: theme.muted, fontSize: 11 },
    },
  };
}

export type { ResolvedTheme };
