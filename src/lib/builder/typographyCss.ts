// GENERATOR reguł typografii per widget (`[data-w-id="…"][data-w-id][data-w-id] …`).
//
// Od fali 2 programu PSI 85/95 (P2.4, HW-2) ramka widgetu NIE woła tego
// modułu dla rozmiarów czcionek ani odstępu tytuł-opis - te idą szablonem z
// `styles.css` i zmiennymi `--wt-*` (patrz `liveTypography.ts`). Generator
// zostaje dla reszty: krój, grubość, styl, interlinia, światło, transformacja,
// dekoracja, wyrównanie oraz rozmiary spoza białej listy szablonu.
//
// GRANICA CHUNKÓW. Ten moduł NIE MOŻE być statycznie osiągalny z chunku
// wejściowego przeglądarki (strażnik w `scripts/check-entry-purity.ts`,
// znacznik `:not(.post-list-numbered-index)`): ramka bierze go statycznie
// wyłącznie w gałęzi `.server()` funkcji izomorficznej, a w przeglądarce przez
// `import()` - dopiero gdy dane typografii zmienią się po hydratacji. Lekkie
// pomocniki wspólne z ramką żyją w `liveTypography.ts` i są stamtąd
// re-eksportowane, żeby dotychczasowi importerzy (`PostListView`) nie musieli
// się zmieniać.
import type { Device, WidgetTypography } from "./types";
import {
  cleanCssValue,
  cssAttributeValue,
  hasTypographyKeys,
  normalizeTypographyGapPx,
  pickFontSize,
  resolveWidgetTypography,
  widgetTypographyTemplate,
} from "./liveTypography";

export { normalizeTypographyGapPx, resolveWidgetTypography };

type Specificity = 1 | 2 | 3;

/** Grupy reguł generatora (wszystkie domyślnie włączone). */
interface RuleGroups {
  /** Rozmiary tytułu, opisu i ogólny (z placeholderami). */
  readonly fontSize: boolean;
  /** Odstęp tytuł-opis (`--cms-title-description-gap` i `margin-top`). */
  readonly gap: boolean;
  /** Krój, grubość, styl, interlinia, światło, transformacja, dekoracja, wyrównanie. */
  readonly common: boolean;
}

const ALL_GROUPS: RuleGroups = { fontSize: true, gap: true, common: true };

interface RuleOptions {
  ancestor?: string;
  specificity?: Specificity;
  groups?: RuleGroups;
}

export function buildWidgetTypographyCss(
  widgetId: string,
  typography: WidgetTypography | undefined,
  device: Device,
  options: { ancestor?: string; specificity?: Specificity } = {},
): string {
  if (!hasTypographyKeys(typography)) return "";
  return buildWidgetTypographyRules(widgetId, typography, device, options).join("\n");
}

/** Wejście bloku generatora ramki (dane deterministyczne - skrót `data-css-hash`). */
export interface LegacyWidgetTypographyInput {
  readonly widgetId: string;
  readonly typography: WidgetTypography | undefined;
  /** Urządzenie - tylko gdy rozmiary idą generatorem; inaczej `null`. */
  readonly device: Device | null;
}

/**
 * Blok `<style>` ramki dla tego, czego nie pokrywa szablon HW-2: rozmiary
 * tylko wtedy, gdy szablon je odrzucił (wartość spoza białej listy), odstęp
 * nigdy (zawsze szablon), reszta właściwości zawsze. Kolejność reguł jest ta
 * sama co w pełnym generatorze.
 */
export function buildLegacyWidgetTypographyCss(input: LegacyWidgetTypographyInput): string {
  const { widgetId, typography, device } = input;
  if (!hasTypographyKeys(typography)) return "";
  const template = widgetTypographyTemplate(typography);
  if (!template.legacy) return "";
  return buildWidgetTypographyRules(widgetId, typography, device ?? "desktop", {
    specificity: 3,
    groups: { fontSize: template.legacyFontSize, gap: false, common: true },
  }).join("\n");
}

function buildWidgetTypographyRules(
  widgetId: string,
  typography: WidgetTypography,
  device: Device,
  options: RuleOptions = {},
): string[] {
  const id = cssAttributeValue(widgetId);
  const ancestor = options.ancestor ?? "";
  const specificity = options.specificity ?? 3;
  const groups = options.groups ?? ALL_GROUPS;
  const repeat = "[data-w-id]".repeat(Math.max(0, specificity - 1));
  const sel = `${ancestor}[data-w-id="${id}"]${repeat}`;
  const notCounters = ":not(.post-list-numbered-index):not(.rl-num)";
  // Atomic controls and microcopy can opt out of broad widget typography.
  // Without this guard a generated `[data-w-id]... span { ... !important }`
  // rule overrides their intentional compact type, even when it is scoped.
  const notExempt = ":not([data-typography-exempt])";
  // ...i całe ich PODDRZEWO (forma przodka): wykres (`figure.neh-chart`) i jego
  // dymek niosą znacznik raz, na korzeniu, a reguła nie może dosięgnąć
  // `span`/`dd` w środku. Te same selektory stoją w szablonie `styles.css`.
  const notExemptAncestor = ":not([data-typography-exempt] *)";
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
    `${sel} :is(h1,h2,h3,h4,h5,h6)${notExemptAncestor}${notCounters}`,
  ];
  const descriptionTargets = [
    `${sel} .cms-post-excerpt`,
    `${sel} [data-description-root]`,
    `${sel}[data-description-root]`,
    `${sel} [data-typography-role="description"]`,
    `${sel}[data-typography-role="description"]`,
    `${sel} :is(p,li,dd,blockquote,figcaption,small):not(.cms-post-title)${notExempt}${notExemptAncestor}${notCounters}`,
    `${sel} .prose p${notExemptAncestor}`,
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
    `${sel} :is(${genericTextTags.join(",")}):not(.cms-post-title):not(.cms-post-excerpt)${notExempt}${notExemptAncestor}${notCounters}`,
    `${sel} .prose`,
    `${sel} .prose *:not(.cms-post-title):not(.cms-post-excerpt)${notExemptAncestor}${notCounters}`,
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

  if (fontFamily && groups.common) {
    commonDeclarations.push(`font-family:${fontFamily} !important;`);
    rules.push(
      `${sel} input::placeholder, ${sel} textarea::placeholder{font-family:${fontFamily} !important;}`,
    );
  }

  if (fontSize && groups.fontSize) {
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
  if (descriptionFontSize && groups.fontSize) {
    rules.push(`${descriptionClassSel}{font-size:${descriptionFontSize} !important;}`);
    if (descriptionFallbackSel)
      rules.push(`${descriptionFallbackSel}{font-size:${descriptionFontSize} !important;}`);
  }

  const gapPx = normalizeTypographyGapPx(typography.titleDescriptionGapPx);
  if (typeof gapPx === "number" && groups.gap) {
    const gap = `${gapPx}px`;
    rules.push(`${sel}{--cms-title-description-gap:${gap};}`);
    rules.push(
      `${sel} .cms-post-title + .cms-post-excerpt, ${sel} .cms-post-title ~ .cms-post-excerpt, ${sel} [data-title-root] + [data-description-root], ${sel} [data-title-root] ~ [data-description-root], ${sel} [data-typography-gap-target]{margin-top:${gap} !important;}`,
    );
    // Tytuł opakowany odnośnikiem, po nim zajawka: `a + .cms-post-excerpt`
    // zamiast `a:has(> .cms-post-title) + .cms-post-excerpt` - w ramce
    // widgetu jedynym odnośnikiem bezpośrednio przed zajawką jest tytuł,
    // a `:has()` jest w publicznym CSS zakazane (pomiar 2026-10-02).
    rules.push(`${sel} a + .cms-post-excerpt{margin-top:${gap} !important;}`);
  }

  if (groups.common) {
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
  }
  if (commonDeclarations.length) rules.push(`${allText}{${commonDeclarations.join("")}}`);

  return rules;
}

/**
 * CSS bloku podglądu na żywo w `<head>` (`liveTypography.ts`) - wyłącznie
 * część generatora: zmienne szablonu dopisuje sam moduł podglądu. Urządzenie
 * wybiera ten sam przodek co szablon (`[data-builder-renderer][data-device]`,
 * a w kanwie edytora także `[data-visual-canvas][data-device]`), bez `@media`.
 */
export function buildLiveWidgetTypographyCss(
  widgetId: string,
  typography: WidgetTypography,
): string {
  const template = widgetTypographyTemplate(typography);
  if (!template.legacy) return "";
  const groups: RuleGroups = { fontSize: template.legacyFontSize, gap: false, common: true };
  const base = buildWidgetTypographyRules(widgetId, typography, "desktop", {
    specificity: 3,
    groups,
  }).join("\n");
  if (!template.legacyFontSize) return base;
  // Rozmiary spoza białej listy zależą od urządzenia: tylko one dostają
  // warianty z przodkiem urządzenia (wyższa specyficzność niż baza).
  const sizesOnly: RuleGroups = { fontSize: true, gap: false, common: false };
  const variants = (["tablet", "mobile"] as const).flatMap((device) =>
    [
      `[data-builder-renderer][data-device="${device}"] `,
      `[data-visual-canvas][data-device="${device}"] `,
    ].map((ancestor) =>
      buildWidgetTypographyRules(widgetId, typography, device, {
        ancestor,
        specificity: 3,
        groups: sizesOnly,
      }).join("\n"),
    ),
  );
  return [base, ...variants].filter(Boolean).join("\n");
}
