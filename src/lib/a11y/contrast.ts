/** WCAG sRGB luminance, for stored opaque hex colors. CSS variables continue
 * to inherit the theme's semantic foreground token. */
function luminance(color: string): number | null {
  const match = /^#([a-f\d]{3}|[a-f\d]{6})$/i.exec(color.trim());
  if (!match) return null;
  const hex = match[1].length === 3 ? [...match[1]].map((c) => c + c).join("") : match[1];
  const rgb = [0, 2, 4].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

export function contrastRatio(foreground: string, background: string): number | null {
  const a = luminance(foreground);
  const b = luminance(background);
  return a === null || b === null ? null : (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function readableForeground(background: string, preferred: string): string {
  const light = luminance(background);
  if (light === null) return preferred;
  const ratio = contrastRatio(preferred, background);
  if (ratio !== null && ratio >= 4.5) return preferred;
  return (light + 0.05) / 0.05 >= 1.05 / (light + 0.05) ? "#000000" : "#ffffff";
}

/** Brand fills stay orange; text uses the theme's readable orange ink. */
export function readableBrandText(color: string | undefined): string {
  return !color || /^(?:#FA9346|#FA9346|var\(--(?:brand|primary)\))$/i.test(color.trim())
    ? "var(--brand-ink)"
    : color;
}
