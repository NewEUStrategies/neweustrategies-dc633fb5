// Pure visual helpers for research-program branding (accent colour + icon).
// No React here so the logic stays unit-testable; the icon component and the
// routes consume these.

/** Fallback accent used when a program has no (or an invalid) accent colour. */
export const DEFAULT_ACCENT = "#1e3a8a";

const HEX6 = /^#[0-9a-f]{6}$/i;

/** True when `hex` is a valid `#rrggbb` string. */
export function isHex6(hex: string | null | undefined): hex is string {
  return typeof hex === "string" && HEX6.test(hex);
}

/** Normalize to a valid `#rrggbb` accent, falling back to {@link DEFAULT_ACCENT}. */
export function safeAccent(hex: string | null | undefined): string {
  return isHex6(hex) ? (hex as string) : DEFAULT_ACCENT;
}

/** WCAG relative luminance of a `#rrggbb` colour (0 = black, 1 = white). */
export function relativeLuminance(hex: string): number {
  const c = safeAccent(hex).replace("#", "");
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Readable foreground (`#0b0b0d` dark or `#ffffff` white) for text placed on a
 * solid `hex` background, chosen by relative luminance. Mirrors the rule used
 * by category badges.
 */
export function readableTextColor(hex: string | null | undefined): string {
  return relativeLuminance(hex ?? DEFAULT_ACCENT) > 0.5 ? "#0b0b0d" : "#ffffff";
}

/** `rgba()` string from a `#rrggbb` accent + alpha (clamped 0–1). */
export function accentRgba(hex: string | null | undefined, alpha: number): string {
  const c = safeAccent(hex).replace("#", "");
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
