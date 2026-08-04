/**
 * Gate: strona publiczna nie może przesuwać się w bok (tylko góra/dół).
 *
 * Incydent, którego pilnuje ten test (nagranie z iPhone'a, sierpień 2026):
 * na wpisie dało się przesunąć CAŁĄ stronę w prawo o kilkadziesiąt pikseli.
 * Złożyły się na to trzy rzeczy i każda ma tu swoje zabezpieczenie:
 *
 *   1. Zwijanie headera trzyma `.site-header-chrome` w układzie o 1/scale
 *      szerszy niż viewport (125% przy scale 0.8) - wizualnie skorygowane
 *      transformem, ale WebKit liczył z tego poziomy zakres przewijania.
 *      => header musi przycinać w poziomie.
 *   2. `overflow-x: clip` na korzeniu nie zatrzymuje gestu na iOS, gdy poza
 *      szerokość wyjdzie element `fixed`.
 *      => dokument dostaje twardą blokadę gestu `touch-action: pan-y`.
 *   3. Pasek czytania sam zdejmował sobie clip regułą `:has()` pisaną dla
 *      popovera wyszukiwarki.
 *      => reguła musi omijać wiersz paska (`[data-reading-row]`).
 *
 * Test czyta źródła (CSS/TSX), bo to jedyny sposób, by trzymać te trzy
 * warunki bez uruchamiania prawdziwej przeglądarki; wymiary sprawdza
 * dodatkowo e2e/no-horizontal-pan.spec.ts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CSS = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
const READING_HEADER = readFileSync(
  resolve(process.cwd(), "src/components/share/ReadingHeader.tsx"),
  "utf8",
);

/** Ciało pierwszej reguły o dokładnie takim selektorze (bez zagnieżdżeń). */
function ruleBody(css: string, selector: string): string {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) return "";
  const open = css.indexOf("{", at);
  const close = css.indexOf("}", open);
  return close < 0 ? "" : css.slice(open + 1, close);
}

describe("dokument nie przesuwa się w poziomie", () => {
  const root = ruleBody(CSS, "html,\nbody");

  it("korzeń przycina poziomo i blokuje gest poziomy", () => {
    expect(root).toMatch(/overflow-x:\s*clip/);
    expect(root).toMatch(/overscroll-behavior-x:\s*none/);
    expect(root).toMatch(/touch-action:\s*pan-y/);
  });

  it("blokada gestu zostawia pinch-zoom (WCAG 1.4.4)", () => {
    // `touch-action: pan-y` bez pinch-zoom odbiera powiększanie dwoma palcami.
    expect(root).toMatch(/touch-action:\s*pan-y\s+pinch-zoom/);
  });
});

describe("zwijany header nie poszerza dokumentu", () => {
  it("chrome nadal jest szerszy w układzie (technika skalowania bez zmian)", () => {
    // Gdyby ktoś zmienił technikę zwijania, poniższy warunek na clip przestaje
    // mieć sens - test ma wtedy upaść, a nie milcząco przepuścić zmianę.
    expect(CSS).toMatch(/width:\s*calc\(100%\s*\/\s*var\(--hdr-scale\)\)/);
  });

  it("header przycina nadmiarową szerokość, ale nie tnie dropdownów w pionie", () => {
    const shrink = ruleBody(CSS, "header[data-site-header].site-header-shrink");
    expect(shrink).toMatch(/overflow-x:\s*clip/);
    expect(shrink).toMatch(/overflow-y:\s*visible/);
  });
});

describe("pasek czytania trzyma się szerokości ekranu", () => {
  it("wiersz paska ma poziomy clip", () => {
    expect(READING_HEADER).toContain("data-reading-row");
    expect(READING_HEADER).toMatch(
      /\[data-reading-header\]\s*\[data-reading-row\]\s*\{[^}]*overflow-x:\s*clip/,
    );
  });

  it("reguła bezpiecznej przestrzeni dla popovera nie zdejmuje clipa z wiersza", () => {
    const unsafe = /:has\((?:>\s*)?\.builder-search-widget\)(?!:not\(\[data-reading-row\]\))/g;
    expect(READING_HEADER.match(unsafe)).toBeNull();
  });
});
