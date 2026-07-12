// Strażnik kontrastu tokenów marki. happy-dom nie liczy stylów, więc reguła
// color-contrast w axe jest wyłączona w testach komponentowych - zamiast tego
// ten test liczy kontrast WCAG wprost z wartości tokenów w styles.css.
// Gwarancje:
//   - --brand-ink (jasny motyw) vs --background >= 4.5:1 (AA dla tekstu),
//   - --brand-ink (ciemny motyw) vs ciemne tło >= 4.5:1,
//   - regresja: sam --brand NIE przechodzi na jasnym tle (2.2:1) - jeśli ktoś
//     kiedyś podniesie --brand do AA, ten test przypomni, że tokeny można scalić.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function relativeLuminance(hex: string): number {
  const c = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

const css = readFileSync(resolve(__dirname, "../../styles.css"), "utf8");

/** Wyciąga kolejne wartości hex danego tokenu (jasny motyw pierwszy). */
function tokenValues(name: string): string[] {
  const re = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`, "g");
  const out: string[] = [];
  for (let m = re.exec(css); m; m = re.exec(css)) out.push(m[1].toLowerCase());
  return out;
}

// Tła: --background to oklch(0.99 0 0) ~ #fcfcfc (jasny) i ~#1c1c1c (ciemny).
const LIGHT_BG = "#fcfcfc";
const DARK_BG = "#1c1c1c";

describe("brand token contrast (WCAG AA)", () => {
  it("declares --brand-ink for both themes", () => {
    expect(tokenValues("--brand-ink").length).toBeGreaterThanOrEqual(2);
  });

  it("--brand-ink passes AA as text on the light background", () => {
    const [lightInk] = tokenValues("--brand-ink");
    expect(contrastRatio(lightInk, LIGHT_BG)).toBeGreaterThanOrEqual(4.5);
  });

  it("--brand-ink passes AA as text on the dark background", () => {
    const inks = tokenValues("--brand-ink");
    const darkInk = inks[1] ?? inks[0];
    expect(contrastRatio(darkInk, DARK_BG)).toBeGreaterThanOrEqual(4.5);
  });

  it("documents why the ink token exists: raw --brand fails AA on light", () => {
    const [brand] = tokenValues("--brand");
    expect(contrastRatio(brand, LIGHT_BG)).toBeLessThan(4.5);
  });
});
