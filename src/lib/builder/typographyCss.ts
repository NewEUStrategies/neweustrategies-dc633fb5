import type { Device, Mode, Themed, WidgetTypography } from "./types";
import { pickMode } from "./themed";

type Specificity = 1 | 2 | 3;

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

export function pickResponsiveValue<T>(
  value: { desktop?: T; tablet?: T; mobile?: T } | undefined,
  device: Device,
): T | undefined {
  if (!value) return undefined;
  return value[device] ?? value.desktop ?? value.tablet ?? value.mobile;
}

function cleanCssValue(value: string | undefined): string | undefined {
  const next = value?.trim();
  if (!next) return undefined;
  // Keep authored CSS values usable (font stacks, calc(), var(), etc.) while
  // preventing accidental rule breaks from panel text inputs.
  return next.replace(/[{};]/g, "");
}

function hasKeys(value: WidgetTypography | undefined): value is WidgetTypography {
  return !!value && Object.values(value).some((v) => v !== undefined && v !== "");
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

export function buildWidgetTypographyRules(
  widgetId: string,
  typography: WidgetTypography,
  device: Device,
  options: { ancestor?: string; specificity?: Specificity } = {},
): string[] {
  const id = cssEscape(widgetId);
  const ancestor = options.ancestor ?? "";
  const specificity = options.specificity ?? 3;
  const repeat = "[data-w-id]".repeat(Math.max(0, specificity - 1));
  const sel = `${ancestor}[data-w-id="${id}"]${repeat}`;
  const notCounters = ":not(.post-list-numbered-index):not(.rl-num)";
  // Keep these selectors intentionally boring. The previous compact `:is()`
  // groups were valid in modern browsers, but one invalid/unsupported selector
  // in an embedded preview stylesheet made everything except the dedicated
  // title-size rule look "dead". Generating explicit selectors gives every
  // control the same cascade path and is easier to verify in DevTools.
  const titleTargets = [
    `${sel} .cms-post-title`,
    `${sel} [data-title-root]`,
    `${sel}[data-title-root]`,
    `${sel} [data-typography-role="title"]`,
    `${sel}[data-typography-role="title"]`,
    ...["h1", "h2", "h3", "h4", "h5", "h6"].map((tag) => `${sel} ${tag}${notCounters}`),
  ];
  const descriptionTargets = [
    `${sel} .cms-post-excerpt`,
    `${sel} [data-description-root]`,
    `${sel}[data-description-root]`,
    `${sel} [data-typography-role="description"]`,
    `${sel}[data-typography-role="description"]`,
    ...["p", "li", "dd", "blockquote", "figcaption", "small"].map((tag) => `${sel} ${tag}:not(.cms-post-title)${notCounters}`),
    `${sel} .prose p`,
  ];
  const genericTextTags = [
    "p", "span", "a", "strong", "em", "small", "li", "dt", "dd", "blockquote",
    "cite", "label", "button", "input", "textarea", "select", "option", "figcaption",
    "legend", "time", "h1", "h2", "h3", "h4", "h5", "h6",
  ];
  const genericTextTargets = [
    sel,
    ...genericTextTags.map((tag) => `${sel} ${tag}:not(.cms-post-title):not(.cms-post-excerpt)${notCounters}`),
    `${sel} .prose`,
    `${sel} .prose *:not(.cms-post-title):not(.cms-post-excerpt)${notCounters}`,
  ];
  const allText = [...genericTextTargets, ...titleTargets, ...descriptionTargets].join(", ");
  const genericNoPost = genericTextTargets.join(", ");
  const titleSel = titleTargets.join(", ");
  const descriptionSel = descriptionTargets.join(", ");
  const rules: string[] = [];

  const fontFamily = cleanCssValue(typography.fontFamily);
  const fontSize = cleanCssValue(pickResponsiveValue(typography.fontSize, device));
  const descriptionFontSize = cleanCssValue(pickResponsiveValue(typography.descriptionFontSize, device));
  const fontWeight = cleanCssValue(typography.fontWeight);
  const lineHeight = cleanCssValue(typography.lineHeight);
  const letterSpacing = cleanCssValue(typography.letterSpacing);

  if (fontFamily) {
    rules.push(`${allText}{font-family:${fontFamily} !important;}`);
    rules.push(`${sel} input::placeholder, ${sel} textarea::placeholder{font-family:${fontFamily} !important;}`);
  }

  if (fontSize) {
    if (descriptionFontSize) {
      rules.push(`${titleSel}{font-size:${fontSize} !important;}`);
    } else {
      rules.push(`${genericNoPost}{font-size:${fontSize} !important;}`);
      rules.push(`${titleSel}{font-size:${fontSize} !important;}`);
      rules.push(`${sel} input::placeholder, ${sel} textarea::placeholder{font-size:${fontSize} !important;}`);
    }
  }
  if (descriptionFontSize) {
    rules.push(`${descriptionSel}{font-size:${descriptionFontSize} !important;}`);
  }

  if (typeof typography.titleDescriptionGapPx === "number" && typography.titleDescriptionGapPx >= 0) {
    const gap = `${Math.max(0, typography.titleDescriptionGapPx)}px`;
    rules.push(`${sel} .cms-post-title + .cms-post-excerpt, ${sel} [data-title-root] + [data-description-root]{margin-top:${gap} !important;}`);
    rules.push(`${sel} a:has(> .cms-post-title) + .cms-post-excerpt{margin-top:${gap} !important;}`);
    rules.push(`${sel} [data-title-root] + [data-description-root]{margin-top:${gap} !important;}`);
  }

  if (fontWeight) rules.push(`${allText}{font-weight:${fontWeight} !important;}`);
  if (typography.fontStyle) rules.push(`${allText}{font-style:${typography.fontStyle} !important;}`);
  if (lineHeight) rules.push(`${allText}{line-height:${lineHeight} !important;}`);
  if (letterSpacing) rules.push(`${allText}{letter-spacing:${letterSpacing} !important;}`);
  if (typography.textTransform) rules.push(`${allText}{text-transform:${typography.textTransform} !important;}`);
  if (typography.textDecoration) rules.push(`${allText}{text-decoration:${typography.textDecoration} !important;}`);
  if (typography.textAlign) rules.push(`${allText}{text-align:${typography.textAlign} !important;}`);

  return rules;
}

export function buildLiveWidgetTypographyCss(widgetId: string, typography: WidgetTypography): string {
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
  ].filter(Boolean).join("\n");
}