// Custom web-font management for the per-tenant brand theme.
//
// Storage layout: `<tenantId>/fonts/<slug>.<ext>` inside the public `media`
// bucket (already CDN-friendly, tenant-scoped via existing storage policies).
//
// Each uploaded font is stored as one entry inside
// `site_design_tokens.fonts.custom[]` and rendered as an `@font-face` rule by
// <DesignTokensStyle />. The font also appears in the global <FontPicker /> so
// editors can use it for headings/body text just like any built-in option.
//
// Wgrywanie fontu (`uploadCustomFont`, `slugifyFontName`) mieszka
// w `customFontUpload.ts`: ten moduł czyta `designTokens.ts` (reguły
// `@font-face` w chunku startowym), a wgrywanie woła wyłącznie panel. Nie
// importuj go stąd (roadmapa ładowania §9.1 J3).

export interface CustomFont {
  /** Stable id used as the CSS font-family name (slug). */
  id: string;
  /** Display label shown in the picker. */
  label: string;
  /** Public CDN URL of the .woff2/.woff/.ttf file. */
  url: string;
  /** CSS font-weight (400, 700, "100 900" for variable, …). Defaults to 400. */
  weight?: string;
  /** CSS font-style (normal/italic). Defaults to normal. */
  style?: "normal" | "italic";
  /** font-display strategy. Defaults to "swap". */
  display?: "auto" | "block" | "swap" | "fallback" | "optional";
}

const FONT_SLUG_RE = /^[a-z0-9-]{1,40}$/;

export function fontFaceCss(f: CustomFont): string {
  if (!f.id || !f.url || !FONT_SLUG_RE.test(f.id)) return "";
  const format = guessFormat(f.url);
  const weight = f.weight ?? "400";
  const style = f.style ?? "normal";
  const display = f.display ?? "swap";
  return [
    "@font-face{",
    `font-family:"${f.id}";`,
    `src:url("${f.url}")${format ? ` format("${format}")` : ""};`,
    `font-weight:${weight};font-style:${style};font-display:${display};`,
    "}",
  ].join("");
}

export function customFontsCss(fonts: readonly CustomFont[] | undefined): string {
  if (!fonts?.length) return "";
  return fonts.map(fontFaceCss).filter(Boolean).join("");
}

function guessFormat(url: string): string | null {
  const u = url.split("?")[0].toLowerCase();
  if (u.endsWith(".woff2")) return "woff2";
  if (u.endsWith(".woff")) return "woff";
  if (u.endsWith(".ttf")) return "truetype";
  if (u.endsWith(".otf")) return "opentype";
  return null;
}
