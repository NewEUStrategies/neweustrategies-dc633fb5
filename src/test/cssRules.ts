// Pomocnik testów: reguły CSS `src/styles.css` jako DANE - z kontekstem at-reguł
// i specyficznością selektorów.
//
// PO CO. jsdom nie liczy kaskady (`@media`, `@layer`, `var()`, `!important`
// arkusza), więc kontrakty kaskady (szablon typografii HW-2 vs generator,
// akcja Kinetic Signal Notch, wartości zastępcze bylinu, animacje przy
// ładowaniu) testy sprawdzają na sparsowanych regułach: zbiory selektorów,
// `element.matches(selektor)`, specyficzność i deklaracje rozwiązane względem
// stylu inline elementu - zamiast szukać fragmentów tekstu w pliku.
// Wydajność PSI 85/95, fala 2, P2.4 (recenzja m1).

/** Blok CSS: prelude (selektor albo at-reguła), deklaracje i bloki zagnieżdżone. */
export interface CssBlock {
  prelude: string;
  declarations: string[];
  children: CssBlock[];
}

/** Reguła stylu z łańcuchem at-reguł nad nią (`[]` = niewarstwowa, najwyższy poziom). */
export interface CssRule {
  context: string[];
  selectors: string[];
  /** `właściwość` -> `wartość` (z `!important`, białe znaki zwinięte). */
  declarations: Map<string, string>;
}

/** Parser blokowy (komentarze wycięte; zagnieżdżenia `@media`, `@layer`, `@utility`, `&`). */
export function parseCssBlocks(source: string): CssBlock[] {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, "");
  let i = 0;
  const readBody = (): { declarations: string[]; children: CssBlock[] } => {
    const declarations: string[] = [];
    const children: CssBlock[] = [];
    let buffer = "";
    const flush = () => {
      const text = buffer.trim();
      if (text) declarations.push(text);
      buffer = "";
    };
    while (i < css.length) {
      const ch = css[i++];
      if (ch === "{") {
        const prelude = buffer.trim();
        buffer = "";
        children.push({ prelude, ...readBody() });
      } else if (ch === "}") {
        flush();
        return { declarations, children };
      } else if (ch === ";") {
        flush();
      } else {
        buffer += ch;
      }
    }
    flush();
    return { declarations, children };
  };
  return readBody().children;
}

/** Przecinki poza nawiasami rozdzielają selektory. */
export function splitSelectors(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of list) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(current.trim());
      current = "";
    } else current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

const squash = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * Reguły stylu w kolejności źródła. Bloki `@keyframes`/`@font-face` i inne
 * at-reguły bez selektorów są pomijane; reguła zagnieżdżona w regule stylu
 * (`&`) dostaje prelude rodzica w kontekście.
 */
export function parseCssRules(source: string): CssRule[] {
  const out: CssRule[] = [];
  const walk = (blocks: CssBlock[], context: string[]) => {
    for (const block of blocks) {
      if (block.prelude.startsWith("@")) {
        if (/^@(?:-webkit-)?keyframes\b|^@font-face\b/.test(block.prelude)) continue;
        walk(block.children, [...context, squash(block.prelude)]);
        continue;
      }
      const declarations = new Map<string, string>();
      for (const declaration of block.declarations) {
        const colon = declaration.indexOf(":");
        if (colon <= 0) continue;
        declarations.set(
          declaration.slice(0, colon).trim(),
          squash(declaration.slice(colon + 1)).replace(/\s*!\s*important$/, " !important"),
        );
      }
      out.push({
        context,
        selectors: splitSelectors(block.prelude).map(squash),
        declarations,
      });
      walk(block.children, [...context, squash(block.prelude)]);
    }
  };
  walk(parseCssBlocks(source), []);
  return out;
}

export type Specificity = readonly [number, number, number];

/** Specyficzność [a, b, c]; `:is()`/`:not()` biorą maksimum argumentów, `:where()` zero. */
export function specificity(selector: string): Specificity {
  let a = 0;
  let b = 0;
  let c = 0;
  let rest = selector;
  for (;;) {
    const m = /:(is|not|where)\(/.exec(rest);
    if (!m) break;
    let depth = 1;
    let i = m.index + m[0].length;
    while (depth > 0 && i < rest.length) {
      if (rest[i] === "(") depth++;
      if (rest[i] === ")") depth--;
      i++;
    }
    if (m[1] !== "where") {
      const inner = rest.slice(m.index + m[0].length, i - 1);
      const best = splitSelectors(inner)
        .map((s) => specificity(s))
        .sort((x, y) => y[0] - x[0] || y[1] - x[1] || y[2] - x[2])[0] ?? [0, 0, 0];
      a += best[0];
      b += best[1];
      c += best[2];
    }
    rest = rest.slice(0, m.index) + " " + rest.slice(i);
  }
  a += (rest.match(/#[\w-]+/g) ?? []).length;
  b += (rest.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? []).length;
  c += (rest.match(/(^|[\s>+~])[a-z][\w-]*|::[\w-]+/gi) ?? []).length;
  return [a, b, c];
}

/** `x` ma WYŻSZĄ specyficzność niż `y`. */
export function specificityAbove(x: Specificity, y: Specificity): boolean {
  return x[0] !== y[0] ? x[0] > y[0] : x[1] !== y[1] ? x[1] > y[1] : x[2] > y[2];
}

/**
 * Wartość deklaracji z `var(--x, zapas)` rozwiązana względem stylu inline
 * elementu i jego przodków (custom properties dziedziczą), bez `!important`.
 */
export function resolveCssVars(value: string, element: Element): string {
  const plain = value.replace(/\s*!important$/, "");
  return plain.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g, (_, name: string, fallback) => {
    for (let node: Element | null = element; node; node = node.parentElement) {
      const own = (node as HTMLElement).style?.getPropertyValue(name).trim();
      if (own) return own;
    }
    return (fallback as string | undefined)?.trim() ?? "";
  });
}
