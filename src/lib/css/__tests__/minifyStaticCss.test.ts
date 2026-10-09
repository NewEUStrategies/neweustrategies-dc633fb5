/**
 * `minifyStaticCss` (P3.7a, krok S1): białe znaki i komentarze statycznych literałów CSS,
 * bez transformacji składni. Złote przypadki, idempotencja, błędy i niezmienność napisów.
 * Równoważność semantyczną z oryginałem na prawdziwych arkuszach sprawdza wyrocznia
 * lightningcss w dowodzie P3.7a (lightningcss nie jest zależnością repo).
 *
 * i18n: brak treści dla użytkownika - narzędzie builda.
 */
import { describe, expect, it } from "vitest";

import { minifyStaticCss } from "../minifyStaticCss";

/** Napisy CSS (`"..."`, `'...'`) w kolejności wystąpienia - do testu niezmienności. */
function quotedStrings(css: string): string[] {
  return [...css.matchAll(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g)].map((m) => m[0]);
}

describe("minifyStaticCss - złote przypadki", () => {
  it.each([
    [
      "reguła z wcięciami",
      "\n  .a {\n    color: red;\n    margin: 0 auto;\n  }\n",
      ".a{color:red;margin:0 auto}",
    ],
    [
      "komentarz między regułami",
      ".a { color: red } /* opis */ .b { top: 0 }",
      ".a{color:red}.b{top:0}",
    ],
    ["komentarz w deklaracji", ".a { color: /* x */ red; }", ".a{color:red}"],
    [
      "napis z `/*` i `;` w środku",
      '.a::after { content: "/* ; } {"; }',
      '.a::after{content:"/* ; } {"}',
    ],
    [
      "`url()` z cudzysłowami",
      '.a { background: url("x y.svg") no-repeat; }',
      '.a{background:url("x y.svg") no-repeat}',
    ],
    [
      "`@media (prefers-reduced-motion: reduce)`",
      "@media (prefers-reduced-motion: reduce) {\n  .a { animation: none !important }\n}",
      "@media (prefers-reduced-motion: reduce){.a{animation:none !important}}",
    ],
    [
      "`@container (max-width: 1024px)`",
      "@container (max-width: 1024px) {\n  .t { --cols: min(2, var(--c, 3)); }\n}",
      "@container (max-width: 1024px){.t{--cols:min(2, var(--c, 3))}}",
    ],
    [
      "`@layer utilities` z `:where(a, b)`",
      "@layer utilities {\n  :where(main a, article a) { color: var(--x, inherit); }\n}",
      "@layer utilities{:where(main a, article a){color:var(--x, inherit)}}",
    ],
    ["`var()` z fallbackiem", ".a { width: var(--x, 2px); }", ".a{width:var(--x, 2px)}"],
    [
      "`color-mix(in srgb, ...)`",
      ".a { border: 1px solid color-mix(in srgb, var(--l) 34%, transparent); }",
      ".a{border:1px solid color-mix(in srgb, var(--l) 34%, transparent)}",
    ],
    ["`!important`", ".a { display: none !important; }", ".a{display:none !important}"],
    ["kombinator `>` traci spacje", ".a > .b , .c > .d { top: 0 }", ".a>.b,.c>.d{top:0}"],
    ["kombinatory `+` i `~` zostają", ".a + .b, .a ~ .c { top: 0 }", ".a + .b,.a ~ .c{top:0}"],
    ["potomek z pseudoklasą zostaje (`.a :hover`)", ".a :hover { top: 0 }", ".a :hover{top:0}"],
    [
      "`@keyframes`",
      "@keyframes f {\n  from { opacity: 0 }\n  to { opacity: 1 }\n}",
      "@keyframes f{from{opacity:0}to{opacity:1}}",
    ],
    [
      "drugi `:` deklaracji zostaje",
      ".a { background: url(data:image/png;base64,AA) }",
      ".a{background:url(data:image/png;base64,AA)}",
    ],
    ["pusta wartość właściwości niestandardowej", ".a { --x: ; }", ".a{--x: }"],
    ["atrybut ze spacją i flagą", '[data-x="a b" i] .y { top: 0 }', '[data-x="a b" i] .y{top:0}'],
    ["ucieczka poza napisem", ".md\\:flex { display: flex }", ".md\\:flex{display:flex}"],
    ["dwa średniki przed klamrą", ".a { top: 0; ; }", ".a{top:0}"],
  ])("%s", (_, input, expected) => {
    expect(minifyStaticCss(input)).toBe(expected);
  });

  it("zostawia dwie deklaracje tej samej właściwości (fallback przed `lh`)", () => {
    // Lightningcss przy `minify` zjada fallback - dlatego własny minifikator (P3.7 §3.1).
    const css = ".t { height: calc(3 * 1.25em); height: calc(3lh); }";
    expect(minifyStaticCss(css)).toBe(".t{height:calc(3 * 1.25em);height:calc(3lh)}");
  });

  it("pusty i biały wsad daje pusty napis", () => {
    expect(minifyStaticCss("")).toBe("");
    expect(minifyStaticCss("  \n /* tylko komentarz */ \n")).toBe("");
  });
});

describe("minifyStaticCss - idempotencja", () => {
  const samples = [
    '\n  .cms-trending, .cms-trending * {\n    font-family: var(--font-display, "Red Hat Display", system-ui, sans-serif);\n  }\n',
    '@media (max-width: 768px) {\n  [data-device="mobile"] .x > * { margin: 0 }\n}\n/* k */ .y { --a: ; }',
    '.a { top: 0; ; } .b { content: "; }" }',
  ];
  it.each(samples)("f(f(x)) === f(x) dla %#", (css) => {
    const once = minifyStaticCss(css);
    expect(minifyStaticCss(once)).toBe(once);
  });
});

describe("minifyStaticCss - błędy przy niedomkniętych konstrukcjach", () => {
  it.each([
    ["napis", '.a { content: "x; }'],
    ["napis przez koniec linii", '.a { content: "x\n"; }'],
    ["komentarz", ".a { top: 0 } /* bez końca"],
    ["nawias", ".a { width: calc(1px + 2px; }"],
    ["nadmiarowy nawias", ".a { width: 1px); }"],
    ["klamra", ".a { top: 0"],
    ["nadmiarowa klamra", ".a { top: 0 } }"],
  ])("%s", (_, css) => {
    expect(() => minifyStaticCss(css)).toThrow(/minifyStaticCss/);
  });
});

describe("minifyStaticCss - napisy przechodzą bajt w bajt", () => {
  it("zbiór napisów przed i po jest równy (stos fontów Red Hat Display)", () => {
    // Jedynym fontem ścieżki krytycznej jest Red Hat Display: minifikacja nie może dotknąć
    // nazwy kroju ani żadnego innego napisu (selektory atrybutów, `content`, `url()`).
    const css = `
      .cms-trending, .cms-trending * {
        font-family: var(--font-display, "Red Hat Display", system-ui, sans-serif);
      }
      .s { font-family: "Red Hat Display", system-ui, sans-serif !important; }
      .tt-glass [style*="animation"] { animation: none !important }
      .e[data-pos="mid-outside"]::after { content: '  dwie  spacje  '; }
    `;
    const out = minifyStaticCss(css);
    expect(quotedStrings(out)).toEqual(quotedStrings(css));
    expect(out).toContain('var(--font-display, "Red Hat Display", system-ui, sans-serif)');
  });
});
