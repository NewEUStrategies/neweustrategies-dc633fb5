// MOTYW ZMIENIA WYŁĄCZNIE KOLORY - bramka na poziomie ARKUSZA.
//
// Bramka „motyw nie zmienia DOM-u" (`everyKindFocusPalette`) porównuje drzewo
// React z klasą `.dark` i bez niej. happy-dom nie ma silnika stylów, więc nie
// widzi geometrii jadącej TOKENEM: `--chart-bar-edge` ma 1,5 px w jasnym
// i 1,25 px w ciemnym, a wąsy pudełka, kreska końca bliższego w tornado
// i obwódka słupka w wariancie bladym czytały go wprost - przełączenie
// motywu przesuwało krawędzie odczytu, a DOM był ten sam.
//
// Ta bramka czyta arkusz: zbiera tokeny wykresu, które mają w motywach RÓŻNE
// wartości długości (px), i pilnuje, że żaden plik rysunku ich nie czyta.
// Tokeny krycia (`--chart-band-*`) są kolorem, nie geometrią, więc ich
// nie dotyczy.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EDGE_STROKE_PX } from "../kindPaint";
import { BAR_EDGE_INSET } from "@/lib/charts/geometry";

const styles = readFileSync("src/styles.css", "utf8");
const JASNY = styles.slice(styles.indexOf(":root,"), styles.indexOf(".dark {"));
const CIEMNY = styles.slice(styles.indexOf(".dark {"), styles.indexOf("@layer base"));

/** Tokeny `--chart-*` o wartości w px, z bloku motywu. */
function dlugosci(blok: string): Map<string, string> {
  const wynik = new Map<string, string>();
  for (const m of blok.matchAll(/(--chart-[a-z0-9-]+):\s*([0-9.]+px)\s*;/g)) {
    wynik.set(m[1], m[2]);
  }
  return wynik;
}

const KATALOG = "src/components/charts";
const PLIKI = readdirSync(KATALOG)
  .filter((f) => /\.(tsx?|css)$/.test(f))
  .map((f) => join(KATALOG, f));

describe("geometria wykresu nie zależy od motywu", () => {
  const jasny = dlugosci(JASNY);
  const ciemny = dlugosci(CIEMNY);
  const zmienne = [...jasny.keys()].filter((k) => ciemny.has(k) && ciemny.get(k) !== jasny.get(k));

  it("parser widzi tokeny długości obu motywów", () => {
    // Bez tego bramka niżej przeszłaby na pustym zbiorze.
    expect(jasny.has("--chart-bar-edge")).toBe(true);
    expect(ciemny.has("--chart-bar-edge")).toBe(true);
  });

  it("żaden plik rysunku nie czyta tokenu długości zależnego od motywu", () => {
    for (const plik of PLIKI) {
      // Komentarz wolno: tłumaczy, dlaczego tokenu tu nie ma.
      const kod = readFileSync(plik, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      for (const token of zmienne) {
        expect(kod.includes(`var(${token}`), `${plik}: var(${token})`).toBe(false);
      }
    }
  });

  it("obwódka słupka w arkuszu ma grubość `EDGE_STROKE_PX` - dwa wsunięcia kształtu", () => {
    expect(EDGE_STROKE_PX).toBe(2 * BAR_EDGE_INSET);
    const css = readFileSync(join(KATALOG, "charts.css"), "utf8");
    const regula = css.slice(css.indexOf('.neh-chart .neh-bar[data-edged="true"] {'));
    const blok = regula.slice(0, regula.indexOf("}"));
    expect(blok).toContain(`stroke-width: ${EDGE_STROKE_PX}px`);
  });
});

describe("rama wykresu nie dziedziczy interlinii widgetu", () => {
  it("`.neh-chart` ma jawną interlinię - legenda ma tę samą wysokość w bloku i w widgecie", () => {
    // Generator „Theme Design" stawia `line-height` z `!important` na SAMEJ
    // ramce widgetu, a interlinia się dziedziczy. Zwolnienie z typografii
    // (`data-typography-exempt`) zatrzymuje reguły, nie dziedziczenie.
    const css = readFileSync(join(KATALOG, "charts.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const regula = css.slice(css.indexOf(".neh-chart {"));
    const blok = regula.slice(0, regula.indexOf("}"));
    expect(blok).toMatch(/line-height:\s*1\.5\s*;/);
  });
});
