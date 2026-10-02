/**
 * Gate: znacznik `data-search-overflow` naprawdę zdejmuje clip - kaskada,
 * nie tylko atrybut.
 *
 * Renderer wypisuje znacznik w HTML-u SSR na opakowaniach nad widgetem
 * wyszukiwarki (`src/lib/builder/searchOverflow.ts`), a reguła
 * `[data-search-overflow]:not([data-reading-row]) { overflow: visible !important }`
 * ma specyficzność (0,2,0). Każda reguła `overflow: hidden|clip !important`
 * o wyższej specyficzności, celująca w te same opakowania, wygrywa mimo
 * znacznika - tak było z kreską między kolumnami (`[data-columns-row] >
 * [data-column-slot] + [data-column-slot]`, (0,3,0)): popover wyszukiwarki
 * w drugiej i dalszej kolumnie był ucinany, a test renderera (atrybuty
 * w `renderToString`) tego nie widział. Ten gate czyta `styles.css` i wymaga,
 * żeby każda taka reguła na opakowaniu buildera wyłączała oznaczone elementy
 * przez `:not([data-search-overflow])` w samym podmiocie selektora.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CSS = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

/** Atrybuty i klasy opakowań, które renderer oznacza znacznikiem. */
const WRAPPER_TOKENS = [
  "[data-column-slot]",
  "[data-columns-row]",
  "[data-sec-id",
  "[data-w-id",
  "[data-section-kind",
  ".overflow-hidden",
];
const EXEMPTION = ":not([data-search-overflow])";
const CLIP_IMPORTANT = /(^|[;{\s])overflow(-x|-y)?\s*:\s*(hidden|clip)\s*!important/;

interface CssRule {
  selector: string;
  declarations: string;
}

function matchingBrace(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return i;
  }
  throw new Error(`niedomknięty blok od pozycji ${open}`);
}

/** Płaska lista reguł: bloki `@media`/`@supports` rozwinięte, zagnieżdżenie `&` rozwiązane. */
function cssRules(source: string): CssRule[] {
  const src = source.replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length));
  const out: CssRule[] = [];
  const walk = (start: number, end: number, parent: string | null): void => {
    let preludeStart = start;
    let i = start;
    while (i < end) {
      const ch = src[i];
      if (ch === "{") {
        const close = matchingBrace(src, i);
        const prelude = src.slice(preludeStart, i).trim();
        if (prelude.startsWith("@")) {
          walk(i + 1, close, parent);
        } else {
          const selector =
            parent === null
              ? prelude
              : prelude.includes("&")
                ? prelude.replace(/&/g, parent)
                : `${parent} ${prelude}`;
          const body = src.slice(i + 1, close);
          // Własne deklaracje reguły - bez zagnieżdżonych bloków.
          let own = body;
          for (let prev = ""; prev !== own;) {
            prev = own;
            own = own.replace(/[^;{}]*\{[^{}]*\}/g, "");
          }
          out.push({ selector, declarations: own });
          if (body.includes("{")) walk(i + 1, close, selector);
        }
        i = close + 1;
        preludeStart = i;
      } else {
        if (ch === ";" || ch === "}") preludeStart = i + 1;
        i++;
      }
    }
  };
  walk(0, src.length, null);
  return out;
}

/** Rozbija listę selektorów po przecinkach najwyższego poziomu. */
function splitSelectors(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of list) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** Podmiot selektora - ostatni złożony selektor po ostatnim kombinatorze. */
function subjectCompound(selector: string): string {
  let depth = 0;
  for (let i = selector.length - 1; i >= 0; i--) {
    const ch = selector[i];
    if (ch === ")" || ch === "]") depth++;
    else if (ch === "(" || ch === "[") depth--;
    else if (depth === 0 && (ch === " " || ch === ">" || ch === "+" || ch === "~")) {
      return selector.slice(i + 1).trim();
    }
  }
  return selector.trim();
}

/** Selektory, które przycinają opakowanie buildera z !important i nie wyłączają znacznika. */
function unexemptedWrapperClips(source: string): string[] {
  const offenders: string[] = [];
  for (const rule of cssRules(source)) {
    if (!CLIP_IMPORTANT.test(rule.declarations)) continue;
    for (const selector of splitSelectors(rule.selector)) {
      if (/::(before|after)/.test(selector)) continue;
      const subject = subjectCompound(selector);
      if (!WRAPPER_TOKENS.some((t) => subject.includes(t))) continue;
      if (!subject.includes(EXEMPTION)) offenders.push(selector.replace(/\s+/g, " "));
    }
  }
  return offenders;
}

describe("znacznik data-search-overflow wygrywa kaskadę w styles.css", () => {
  it("reguła znacznika stoi w arkuszu globalnym i omija wiersz paska czytania", () => {
    const marker = cssRules(CSS).filter(
      (r) => r.selector.replace(/\s+/g, " ") === "[data-search-overflow]:not([data-reading-row])",
    );
    expect(marker).toHaveLength(1);
    expect(marker[0].declarations).toMatch(/overflow\s*:\s*visible\s*!important/);
  });

  it("żadne !important przycięcie opakowania buildera nie pomija znacznika", () => {
    expect(unexemptedWrapperClips(CSS)).toEqual([]);
  });

  it("skan widzi regułę kreski między kolumnami (blok @media rozwinięty)", () => {
    const divider = cssRules(CSS).filter(
      (r) =>
        r.selector.includes("[data-column-slot] + [data-column-slot]") &&
        CLIP_IMPORTANT.test(r.declarations),
    );
    expect(divider.length).toBeGreaterThan(0);
    expect(divider.every((r) => subjectCompound(r.selector).includes(EXEMPTION))).toBe(true);
  });

  it("KONTROLA NEGATYWNA: dawna reguła kreski (bez wyłączenia) OBLEWA gate", () => {
    const before = `@media (min-width: 768px) {
      [data-columns-row] > [data-column-slot] + [data-column-slot] {
        overflow: clip !important;
        overflow-clip-margin: 24px;
      }
    }`;
    expect(unexemptedWrapperClips(before)).toEqual([
      "[data-columns-row] > [data-column-slot] + [data-column-slot]",
    ]);
  });

  it("KONTROLA NEGATYWNA: wyłączenie poza podmiotem selektora nie wystarcza", () => {
    const wrongPlace = `[data-columns-row]:not([data-search-overflow]) > [data-column-slot] {
      overflow: hidden !important;
    }`;
    expect(unexemptedWrapperClips(wrongPlace)).toHaveLength(1);
  });

  it("reguły bez !important i pseudo-elementy nie są przedmiotem gate'u", () => {
    const fine = `[data-column-slot] { overflow: hidden; }
      [data-column-slot]::before { overflow: clip !important; }
      .card { overflow: hidden !important; }`;
    expect(unexemptedWrapperClips(fine)).toEqual([]);
  });
});
