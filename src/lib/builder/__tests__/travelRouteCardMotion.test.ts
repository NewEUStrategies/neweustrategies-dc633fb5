// Wejście karty trasy NIE MOŻE utrwalać swojego końcowego `transform`.
//
// REGRESJA, KTÓRĄ TEN PLIK ZAMYKA
// `.trc-rise` miał `animation-fill-mode: both`. Po zakończeniu wejścia `both`
// utrzymuje końcową klatkę (`transform: none`) w nieskończoność, a wartości
// animowane stoją w kaskadzie WYŻEJ niż zwykłe deklaracje - więc
// `.trc-lift:hover { transform: scale(1.03) }` nie robił absolutnie nic.
// Ustawienie „powiększ kartę pod kursorem" było martwe, a defekt jest
// niewidoczny w DOM: klasy są na miejscu, tylko przeglądarka rysuje inaczej.
// Dlatego inwariant pilnuje ARKUSZA, nie drzewa.
//
// `backwards` wypełnia wyłącznie stan SPRZED animacji (to on zapobiega
// mignięciu karty przy pierwszym malowaniu), a po jej końcu element wraca pod
// kontrolę zwykłych reguł.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

/** Treść reguły o podanym selektorze (pierwsze wystąpienie). */
function rule(selector: string): string {
  const at = css.indexOf(`${selector} {`);
  expect(at, `nie znaleziono reguły ${selector}`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf("}", at));
}

describe("ruch karty trasy", () => {
  it("wejście nie utrwala końcowej klatki", () => {
    const rise = rule(".trc-rise");
    expect(rise).toContain("backwards");
    expect(rise, "`both`/`forwards` utrwala transform i zabija hover").not.toMatch(
      /\b(both|forwards)\b/,
    );
  });

  it("hover nadal deklaruje powiększenie", () => {
    expect(rule(".trc-lift:hover")).toContain("scale(1.03)");
  });

  it("obie klasy są wyciszane przy ograniczeniu animacji", () => {
    const reduced = css.slice(css.indexOf(".trc-rise"));
    const block = reduced.slice(reduced.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(block).toContain(".trc-rise");
    expect(block).toContain(".trc-lift");
  });
});
