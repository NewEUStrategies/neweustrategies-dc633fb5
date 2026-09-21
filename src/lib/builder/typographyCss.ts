import type { Device, Mode, Themed, WidgetTypography } from "./types";
import { pickMode } from "./themed";

type Specificity = 1 | 2 | 3;

// The id is interpolated into a quoted attribute value, where a leading digit
// is already valid CSS and must not be escaped. Escape only characters that can
// terminate that quoted value. Keeping this implementation independent from the
// browser-only `CSS.escape` guarantees byte-identical SSR and hydration output.
function cssAttributeValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\n\r\f]/g, "\\a ");
}

/** Najmniejszy rozmiar, jaki ma sens dla realnego tekstu (px). */
const MIN_READABLE_FONT_PX = 6;

/**
 * Rozmiar czcionki bywa zapisany per urządzenie z czasów, gdy panel pozwalał
 * ustawiać każdy breakpoint osobno - w danych zostały wartości typu `1px`
 * (przypadkowy klik w stepper), przez które etykieta sekcji na mobile była
 * praktycznie niewidoczna. Traktujemy taką wartość jak brak i schodzimy po
 * łańcuchu urządzeń do pierwszej czytelnej.
 */
function isUnreadableFontSize(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const match = value.trim().match(/^(-?[\d.]+)\s*px$/i);
  if (!match) return false;
  const px = Number(match[1]);
  return Number.isFinite(px) && px < MIN_READABLE_FONT_PX;
}

function pickFontSize(
  value: { desktop?: string; tablet?: string; mobile?: string } | undefined,
  device: Device,
): string | undefined {
  if (!value) return undefined;
  const chain = [value[device], value.desktop, value.tablet, value.mobile];
  return chain.find((candidate) => candidate && !isUnreadableFontSize(candidate));
}

function cleanCssValue(value: string | undefined): string | undefined {
  const next = value?.trim();
  if (!next) return undefined;
  // Keep authored CSS values usable (font stacks, calc(), var(), etc.) while
  // preventing accidental rule breaks from panel text inputs. `{};` guard against
  // declaration/rule breakout; `<>` guard against `</style>`-based HTML breakout
  // (defence in depth - the `<style>` sink also runs hardenStyleCss). None of
  // these characters are legitimate in a font/size/weight/line-height value.
  return next.replace(/[{};<>]/g, "");
}

function hasKeys(value: WidgetTypography | undefined): value is WidgetTypography {
  return !!value && Object.values(value).some((v) => v !== undefined && v !== "");
}

export function normalizeTypographyGapPx(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.min(200, value));
  if (typeof value === "string") {
    const n = Number(value.replace(/[^0-9.]/g, ""));
    if (Number.isFinite(n)) return Math.max(0, Math.min(200, n));
  }
  return undefined;
}

export function resolveWidgetTypography(
  stored: Themed<WidgetTypography> | undefined,
  mode: Mode,
  live?: WidgetTypography,
): WidgetTypography | undefined {
  if (hasKeys(live)) return live;
  const opposite: Mode = mode === "dark" ? "light" : "dark";
  return pickMode<WidgetTypography>(stored, mode) ?? pickMode<WidgetTypography>(stored, opposite);
}

export function buildWidgetTypographyCss(
  widgetId: string,
  typography: WidgetTypography | undefined,
  device: Device,
  options: { ancestor?: string; specificity?: Specificity } = {},
): string {
  if (!hasKeys(typography)) return "";
  return buildWidgetTypographyRules(widgetId, typography, device, options).join("\n");
}

function buildWidgetTypographyRules(
  widgetId: string,
  typography: WidgetTypography,
  device: Device,
  options: { ancestor?: string; specificity?: Specificity } = {},
): string[] {
  const id = cssAttributeValue(widgetId);
  const ancestor = options.ancestor ?? "";
  const specificity = options.specificity ?? 3;
  const repeat = "[data-w-id]".repeat(Math.max(0, specificity - 1));
  const sel = `${ancestor}[data-w-id="${id}"]${repeat}`;
  const notCounters = ":not(.post-list-numbered-index):not(.rl-num)";
  // Atomic controls and microcopy can opt out of broad widget typography.
  // Without this guard a generated `[data-w-id]... span { ... !important }`
  // rule overrides their intentional compact type, even when it is scoped.
  const notExempt = ":not([data-typography-exempt])";
  // Group only fixed HTML tag names with identical specificity. The widget
  // scope and every exclusion remain outside :is(), so authored selectors
  // cannot invalidate the group or change its cascade weight. In particular
  // do not mix class/attribute selectors with tags inside these groups.
  const titleTargets = [
    `${sel} .cms-post-title`,
    `${sel} [data-title-root]`,
    `${sel}[data-title-root]`,
    `${sel} [data-typography-role="title"]`,
    `${sel}[data-typography-role="title"]`,
    `${sel} :is(h1,h2,h3,h4,h5,h6)${notCounters}`,
  ];
  const descriptionTargets = [
    `${sel} .cms-post-excerpt`,
    `${sel} [data-description-root]`,
    `${sel}[data-description-root]`,
    `${sel} [data-typography-role="description"]`,
    `${sel}[data-typography-role="description"]`,
    `${sel} :is(p,li,dd,blockquote,figcaption,small):not(.cms-post-title)${notExempt}${notCounters}`,
    `${sel} .prose p`,
  ];
  const genericTextTags = [
    "p",
    "span",
    "a",
    "strong",
    "em",
    "small",
    "li",
    "dt",
    "dd",
    "blockquote",
    "cite",
    "label",
    "button",
    "input",
    "textarea",
    "select",
    "option",
    "figcaption",
    "legend",
    "time",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
  ];
  const genericTextTargets = [
    sel,
    `${sel} :is(${genericTextTags.join(",")}):not(.cms-post-title):not(.cms-post-excerpt)${notExempt}${notCounters}`,
    `${sel} .prose`,
    `${sel} .prose *:not(.cms-post-title):not(.cms-post-excerpt)${notCounters}`,
  ];
  const allText = [...genericTextTargets, ...titleTargets, ...descriptionTargets].join(", ");
  const genericNoPost = genericTextTargets.join(", ");
  const titleClassSel = titleTargets[0];
  const titleFallbackSel = titleTargets.slice(1).join(", ");
  const descriptionClassSel = descriptionTargets[0];
  const descriptionFallbackSel = descriptionTargets.slice(1).join(", ");
  const rules: string[] = [];

  const fontFamily = cleanCssValue(typography.fontFamily);
  const fontSize = cleanCssValue(pickFontSize(typography.fontSize, device));
  const descriptionFontSize = cleanCssValue(pickFontSize(typography.descriptionFontSize, device));
  const fontWeight = cleanCssValue(typography.fontWeight);
  const lineHeight = cleanCssValue(typography.lineHeight);
  const letterSpacing = cleanCssValue(typography.letterSpacing);

  // Keep the exact selectors and specificity, but emit their shared
  // declarations together. Repeating this long selector list for each font
  // property added hundreds of KB of inline CSS to builder documents.
  const commonDeclarations: string[] = [];

  if (fontFamily) {
    commonDeclarations.push(`font-family:${fontFamily} !important;`);
    rules.push(
      `${sel} input::placeholder, ${sel} textarea::placeholder{font-family:${fontFamily} !important;}`,
    );
  }

  if (fontSize) {
    if (descriptionFontSize) {
      rules.push(`${titleClassSel}{font-size:${fontSize} !important;}`);
      if (titleFallbackSel) rules.push(`${titleFallbackSel}{font-size:${fontSize} !important;}`);
    } else {
      rules.push(`${genericNoPost}{font-size:${fontSize} !important;}`);
      rules.push(`${titleClassSel}{font-size:${fontSize} !important;}`);
      if (titleFallbackSel) rules.push(`${titleFallbackSel}{font-size:${fontSize} !important;}`);
      rules.push(
        `${sel} input::placeholder, ${sel} textarea::placeholder{font-size:${fontSize} !important;}`,
      );
    }
  }
  if (descriptionFontSize) {
    rules.push(`${descriptionClassSel}{font-size:${descriptionFontSize} !important;}`);
    if (descriptionFallbackSel)
      rules.push(`${descriptionFallbackSel}{font-size:${descriptionFontSize} !important;}`);
  }

  const gapPx = normalizeTypographyGapPx(typography.titleDescriptionGapPx);
  if (typeof gapPx === "number") {
    const gap = `${gapPx}px`;
    rules.push(`${sel}{--cms-title-description-gap:${gap};}`);
    rules.push(
      `${sel} .cms-post-title + .cms-post-excerpt, ${sel} .cms-post-title ~ .cms-post-excerpt, ${sel} [data-title-root] + [data-description-root], ${sel} [data-title-root] ~ [data-description-root], ${sel} [data-typography-gap-target]{margin-top:${gap} !important;}`,
    );
    rules.push(
      `${sel} a:has(> .cms-post-title) + .cms-post-excerpt{margin-top:${gap} !important;}`,
    );
  }

  if (fontWeight) commonDeclarations.push(`font-weight:${fontWeight} !important;`);
  if (typography.fontStyle)
    commonDeclarations.push(`font-style:${typography.fontStyle} !important;`);
  if (lineHeight) commonDeclarations.push(`line-height:${lineHeight} !important;`);
  if (letterSpacing) commonDeclarations.push(`letter-spacing:${letterSpacing} !important;`);
  if (typography.textTransform)
    commonDeclarations.push(`text-transform:${typography.textTransform} !important;`);
  if (typography.textDecoration)
    commonDeclarations.push(`text-decoration:${typography.textDecoration} !important;`);
  if (typography.textAlign)
    commonDeclarations.push(`text-align:${typography.textAlign} !important;`);
  if (commonDeclarations.length) rules.push(`${allText}{${commonDeclarations.join("")}}`);

  return rules;
}

export function buildLiveWidgetTypographyCss(
  widgetId: string,
  typography: WidgetTypography,
): string {
  const base = buildWidgetTypographyCss(widgetId, typography, "desktop", { specificity: 3 });
  const tablet = buildWidgetTypographyCss(widgetId, typography, "tablet", {
    ancestor: `[data-builder-renderer][data-device="tablet"] `,
    specificity: 3,
  });
  const tabletCanvas = buildWidgetTypographyCss(widgetId, typography, "tablet", {
    ancestor: `[data-visual-canvas][data-device="tablet"] `,
    specificity: 3,
  });
  const mobile = buildWidgetTypographyCss(widgetId, typography, "mobile", {
    ancestor: `[data-builder-renderer][data-device="mobile"] `,
    specificity: 3,
  });
  const mobileCanvas = buildWidgetTypographyCss(widgetId, typography, "mobile", {
    ancestor: `[data-visual-canvas][data-device="mobile"] `,
    specificity: 3,
  });
  return [
    base,
    tablet ? `@media (max-width: 1023px) and (min-width: 768px){${tablet}}` : "",
    tabletCanvas ? `@media (max-width: 1023px) and (min-width: 768px){${tabletCanvas}}` : "",
    mobile ? `@media (max-width: 767px){${mobile}}` : "",
    mobileCanvas ? `@media (max-width: 767px){${mobileCanvas}}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
