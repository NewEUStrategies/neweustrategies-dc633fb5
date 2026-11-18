// Tytuł etykiety sekcji jako `h2.cms-sl` ma wyglądać jak dawny `span`.
//
// Arkusze i generatory CSS mają reguły na `h2` (typografia nagłówków widgetów,
// skala motywu, interlinia z „Rozmiarów czcionek", most kolorów globalnych z
// hoverem, kolor nagłówków sekcji, admin). Każda z nich omija `.cms-sl`, więc:
//  1. w kontekstach buildera tytuł `h2` pasuje do DOKŁADNIE tych samych reguł
//     co dawny `span` (porównanie na poziomie reguły: lista selektorów reguły
//     ma jedne deklaracje, więc szablon typografii `[data-title-root]` /
//     `:is(h1..h6)` liczy się raz);
//  2. wyłączenie nie zmienia wagi reguł poza warstwą `base` (inne `h2` wygrywają
//     i przegrywają jak dotąd);
//  3. generatory inline emitują wyłączenie (asercje tekstowe).
// Samą kaskadę (style obliczone, jasny/ciemny, hover) sprawdza Chromium -
// happy-dom nie liczy kaskady, tu porównujemy dopasowanie selektorów.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import { parseCssRules, specificity, splitSelectors, type CssRule } from "@/test/cssRules";
import { globalColorsToCss } from "@/lib/builder/globalColors";
import { typographyCss as sectionTypographyCss } from "@/lib/builder/sectionStyles";
import { FONT_SIZES_DEFAULTS, fontSizesToCss } from "@/lib/theme/fontSizes";

const STYLES = readFileSync("src/styles.css", "utf8");
const ADMIN_STYLES = readFileSync("src/admin-styles.css", "utf8");

/** Konteksty, w których renderuje się etykieta sekcji (strona, telefon, kanwa, podgląd). */
const CONTEXTS: ReadonlyArray<readonly [string, (title: string) => string]> = [
  [
    "strona",
    (t) =>
      `<main><div data-theme-typography data-builder-renderer data-device="desktop"><section data-sec-id="s1"><div data-w-id="w1" data-wt="fs tfs dfs g"><div class="flex">${t}</div></div></section></div></main>`,
  ],
  [
    "telefon",
    (t) =>
      `<main><article><div data-theme-typography data-builder-renderer data-device="mobile"><section data-sec-id="s1"><div data-w-id="w1"><div>${t}</div></div></section></div></article></main>`,
  ],
  [
    "kanwa i podgląd",
    (t) =>
      `<div class="admin-compact cms-builder-compact"><div data-visual-canvas><div class="cms-widget"><div data-w-id="w1"><div>${t}</div></div></div></div></div>`,
  ],
];

/** Dawny tytuł (`span`) i nowy (`h2.cms-sl`) - z klasą rozmiaru i bez niej (skala motywu). */
const TITLES: ReadonlyArray<readonly [string, string]> = [
  [
    `<span data-title-root class="font-display text-[11px] font-bold uppercase tracking-wider min-w-0">T</span>`,
    `<h2 data-title-root class="font-display text-[11px] font-bold uppercase tracking-wider min-w-0 inline cms-sl">T</h2>`,
  ],
  [
    `<span data-title-root class="block break-words whitespace-normal">T</span>`,
    `<h2 data-title-root class="block break-words whitespace-normal cms-sl">T</h2>`,
  ],
];

function titleIn(html: string, selector = "[data-title-root]"): Element {
  document.body.innerHTML = html;
  return document.querySelector(selector)!;
}

/** Selektory, których happy-dom nie parsuje (zagnieżdżenie `&` itp.) - patrz test niżej. */
const unparsed = new Set<string>();

/** Wyłączenie przodka w ostatnim członie: `:where(:not(A *, B *))` (bez kombinatora za nim). */
const ANCESTOR_EXCLUSION = /:where\(:not\(((?:[^()]|\([^()]*\))*)\)\)(?=[^\s>+~]*$)/;

/** Cały selektor to `:where(...)`/`:is(...)` - zwraca listę wewnątrz. */
function wholeGroup(selector: string): string | null {
  const m = /^:(?:where|is)\(/.exec(selector);
  if (!m) return null;
  let depth = 1;
  let i = m[0].length;
  for (; i < selector.length && depth > 0; i++) {
    if (selector[i] === "(") depth++;
    if (selector[i] === ")") depth--;
  }
  return i === selector.length ? selector.slice(m[0].length, -1) : null;
}

/**
 * `matches()` z poprawkami na happy-dom: `:hover` jest spełniony (tytuł „pod
 * kursorem"), a złożone selektory w `:where()` (most kolorów: `main h2`) i
 * wyłączenie przodka w `:not()` liczymy ręcznie - happy-dom ich nie rozwiązuje.
 * Pseudoelementy nie dotyczą elementu tytułu.
 */
function selectorMatches(raw: string, el: Element): boolean {
  if (raw.includes("::")) return false;
  const group = wholeGroup(raw);
  if (group !== null) return splitSelectors(group).some((s) => selectorMatches(s, el));
  let selector = raw.replace(/:hover\b/g, ":is(*)");
  const ancestors: string[] = [];
  const m = ANCESTOR_EXCLUSION.exec(selector);
  if (m) {
    const items = splitSelectors(m[1]);
    if (items.every((item) => /\s\*$/.test(item))) {
      ancestors.push(...items.map((item) => item.replace(/\s\*$/, "")));
      selector = selector.slice(0, m.index) + selector.slice(m.index + m[0].length);
    }
  }
  try {
    if (!el.matches(selector)) return false;
  } catch {
    unparsed.add(raw);
    return false;
  }
  return !ancestors.some((a) => el.parentElement?.closest(a));
}

function ruleMatches(rule: CssRule, el: Element): boolean {
  return rule.selectors.some((selector) => selectorMatches(selector, el));
}

/**
 * Reguła rysuje? Pomijamy wydruk i reguły wyłącznie ze zmiennymi (`--*`): np.
 * `h2:not([class*="text-"]) { --tt-heading-*: … }` ustawia na tytule zmienne,
 * które czyta tylko reguła skali motywu - a ta tytuł omija.
 */
const renders = (rule: CssRule) =>
  !rule.context.some((c) => c.startsWith("@media print")) &&
  [...rule.declarations.keys()].some((property) => !property.startsWith("--"));

/** Reguły dopasowane do dawnego `span` i do nowego `h2` różnią się? Zwraca różnice. */
function mismatches(source: readonly CssRule[]): string[] {
  const rules = source.filter(renders);
  const matched = (html: string) => {
    const el = titleIn(html);
    return rules.map((rule) => ruleMatches(rule, el));
  };
  const out: string[] = [];
  for (const [name, context] of CONTEXTS) {
    for (const [oldTitle, newTitle] of TITLES) {
      const before = matched(context(oldTitle));
      const after = matched(context(newTitle));
      rules.forEach((rule, i) => {
        if (before[i] !== after[i]) out.push(`${name}: ${rule.selectors.join(", ")}`);
      });
    }
  }
  return out;
}

/** Ten sam tekst bez wyłączeń `.cms-sl` (kontrola negatywna i porównanie wag). */
const strip = (css: string) =>
  css
    .replace(/:where\(:not\(\.cms-sl\)\)/g, "")
    .replace(/,\s*\.cms-sl\)/g, ")")
    .replace(/:not\(\.cms-sl\)/g, "");

afterEach(() => {
  document.body.innerHTML = "";
});

describe("h2.cms-sl pasuje do tych samych reguł co dawny span", () => {
  it("styles.css", () => {
    expect(mismatches(parseCssRules(STYLES))).toEqual([]);
  });

  it("admin-styles.css (kanwa buildera i podgląd na żywo)", () => {
    expect(mismatches(parseCssRules(ADMIN_STYLES))).toEqual([]);
  });

  it("most kolorów globalnych (z hoverem)", () => {
    expect(mismatches(parseCssRules(globalColorsToCss({})))).toEqual([]);
  });

  it("interlinia i odstępy z „Rozmiarów czcionek”", () => {
    expect(mismatches(parseCssRules(fontSizesToCss(FONT_SIZES_DEFAULTS)))).toEqual([]);
  });

  it("kolor nagłówków sekcji", () => {
    const css = sectionTypographyCss("s1", { headingColor: "#123456" });
    expect(mismatches(parseCssRules(css))).toEqual([]);
  });

  it("selektory nieczytelne dla happy-dom nie dotyczą tytułów", () => {
    mismatches(parseCssRules(STYLES));
    mismatches(parseCssRules(ADMIN_STYLES));
    for (const selector of unparsed) {
      expect(selector).not.toMatch(/\bh[1-6]\b|\bspan\b|data-title-root|cms-sl/);
    }
  });

  it("kontrola negatywna: bez wyłączeń h2 łapie typografię nagłówków", () => {
    // Krój/światło (`base`), nagłówki widgetów (+ telefon), skala `--fs-h2`, skala motywu.
    expect(mismatches(parseCssRules(strip(STYLES))).length).toBeGreaterThanOrEqual(6);
    expect(mismatches(parseCssRules(strip(ADMIN_STYLES)))).not.toEqual([]);
    expect(mismatches(parseCssRules(strip(globalColorsToCss({}))))).not.toEqual([]);
    expect(mismatches(parseCssRules(strip(fontSizesToCss(FONT_SIZES_DEFAULTS))))).not.toEqual([]);
  });

  it("kontrola negatywna: zwykły h2 nadal łapie reguły nagłówków", () => {
    const plain = titleIn(CONTEXTS[0][1](`<h2 class="text-[11px]">T</h2>`), "h2");
    const hits = parseCssRules(STYLES).filter((rule) => ruleMatches(rule, plain));
    expect(hits.some((r) => r.selectors.some((s) => s.includes("h2:not(.cms-post-title")))).toBe(
      true,
    );
  });
});

describe("wyłączenie `.cms-sl` nie zmienia wagi reguł", () => {
  // `:not(a, .cms-sl)` waży tyle co `:not(a)`, `:where()` zero. Wyjątek: warstwa
  // `base` (`h2:not(.cms-sl)` krojem i światłem) - nic innego w tej warstwie nie
  // ustawia tych właściwości na `h2`, a warstwy wyżej wygrywają bez względu na wagę.

  it.each([
    ["styles.css", STYLES],
    ["admin-styles.css", ADMIN_STYLES],
  ])("%s", (_name, source) => {
    const touched = parseCssRules(source)
      .filter((rule) => !rule.context.some((c) => c.startsWith("@layer base")))
      .flatMap((rule) => rule.selectors.filter((s) => s.includes("cms-sl")));
    expect(touched.length).toBeGreaterThan(0);
    for (const selector of touched) {
      expect(specificity(selector), selector).toEqual(specificity(strip(selector)));
    }
  });
});

describe("generatory CSS inline emitują wyłączenie etykiety", () => {
  it("most kolorów globalnych: reguła H2 i jej hover", () => {
    const css = globalColorsToCss({});
    expect(css).toContain(
      ":where(main h2:not(.cms-sl), article h2:not(.cms-sl)){color:var(--gc-h2",
    );
    expect(css).toContain(
      ":where(main h2:hover:not(.text-gradient-brand):not(.bg-clip-text):not(.cms-sl), article h2:hover:not(.text-gradient-brand):not(.bg-clip-text):not(.cms-sl))",
    );
    // Pozostałe poziomy bez zmian.
    expect(css).toContain(":where(main h3, article h3){");
  });

  it("interlinia H2 w rendererze buildera", () => {
    const css = fontSizesToCss(FONT_SIZES_DEFAULTS);
    expect(css).toContain(
      "[data-builder-renderer] h2:where(:not(.cms-sl)){line-height:var(--lh-h2);}",
    );
    expect(css).toContain("[data-builder-renderer] h3{line-height:var(--lh-h3);}");
  });

  it("kolor nagłówków sekcji", () => {
    expect(sectionTypographyCss("s1", { headingColor: "#123456" })).toBe(
      '[data-sec-id="s1"] :is(h1,h2,h3,h4,h5,h6):where(:not(.cms-sl)){color:#123456;}',
    );
  });
});
