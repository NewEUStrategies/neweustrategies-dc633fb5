// BRAMKA RÓL KOLORYSTYCZNYCH systemu wykresów (specyfikacja 2026-10).
//
// Dwie rzeczy naraz, tak samo jak bramka palety slotów:
//   1. arkusz i moduł `roles.ts` mówią to samo co do hexa - w obu motywach
//      i w druku;
//   2. role spełniają progi, które im przypisano: grafika 3,0:1, tekst
//      4,5:1, siatka wyczuwalna (< 1,3:1), oś mocniejsza od siatki.
// Plus dwie decyzje, które w tym module są ZASADĄ, nie gustem: żadnego
// bursztynu (odcienie z rodziny pomarańczu marki są zastrzeżone dla marki)
// i dodatni, który rozchodzi się z czerwienią przy protanopii.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CHART_PLATE,
  CHART_SEMANTIC,
  contrastRatio,
  cvdDistance,
  oklchOf,
} from "@/lib/charts/palette";
import {
  ROLE,
  ROLE_GRAPHIC_TOKENS,
  ROLE_TEXT_TOKENS,
  ROLE_TOKEN_VALUES,
  ROLE_TOOLTIP_TEXT_TOKENS,
  TOOLTIP_STATUS_TEXT,
} from "@/lib/charts/roles";

const css = ["src/styles.css", "src/components/charts/charts.css"]
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");
const LIGHT_BLOCK = css.slice(css.indexOf(":root,"), css.indexOf(".dark {"));
const DARK_BLOCK = css.slice(css.indexOf(".dark {"), css.indexOf("@layer base"));
const PRINT_BLOCK = css.slice(css.lastIndexOf("@media print", css.indexOf(".dark .neh-chart,")));

function token(block: string, name: string): string {
  const m = block.match(new RegExp(`\\s${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`brak tokenu ${name}`);
  return m[1].trim();
}

const THEMES = [
  ["jasny", LIGHT_BLOCK, ROLE_TOKEN_VALUES.light, CHART_PLATE.light] as const,
  ["ciemny", DARK_BLOCK, ROLE_TOKEN_VALUES.dark, CHART_PLATE.dark] as const,
];

describe("role wykresów - arkusz zgadza się z modułem", () => {
  it.each(THEMES)("motyw %s: każdy token roli co do hexa", (_name, block, values) => {
    for (const [name, value] of Object.entries(values)) {
      expect(token(block, name), name).toBe(value);
    }
  });

  it("druk odtwarza wartości JASNE - wykres na papierze nie jedzie na tokenach ciemnych", () => {
    for (const [name, value] of Object.entries(ROLE_TOKEN_VALUES.light)) {
      if (name.startsWith("--chart-tip-")) continue; // tooltip w druku jest schowany
      expect(token(PRINT_BLOCK, name), name).toBe(value);
    }
  });

  it("kod rysujący dostaje role jako `var(...)`, nigdy hex", () => {
    for (const [role, expr] of Object.entries(ROLE)) {
      expect(expr, role).toMatch(/^var\(--[a-z0-9-]+\)$/);
    }
  });
});

describe("role wykresów - progi", () => {
  it.each(THEMES)("motyw %s: role graficzne >= 3,0:1 na płycie", (_name, _block, values, plate) => {
    for (const name of ROLE_GRAPHIC_TOKENS) {
      expect(contrastRatio(values[name], plate), name).toBeGreaterThanOrEqual(3);
    }
  });

  it.each(THEMES)("motyw %s: role tekstowe >= 4,5:1 na płycie", (_name, _block, values, plate) => {
    for (const name of ROLE_TEXT_TOKENS) {
      expect(contrastRatio(values[name], plate), name).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(THEMES)("motyw %s: napisy tooltipa >= 4,5:1 na tle tooltipa", (_n, _b, values) => {
    for (const name of ROLE_TOOLTIP_TEXT_TOKENS) {
      expect(contrastRatio(values[name], values["--chart-tip-bg"]), name).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });

  it("napisy oceny w tooltipie mają >= 4,5:1 na tle tooltipa w OBU motywach - i stoją w arkuszu", () => {
    const rule = css.slice(css.indexOf(".neh-tooltip {"));
    const body = rule.slice(0, rule.indexOf("}"));
    for (const [name, value] of Object.entries(TOOLTIP_STATUS_TEXT)) {
      expect(token(body, name), name).toBe(value);
      for (const bg of [
        ROLE_TOKEN_VALUES.light["--chart-tip-bg"],
        ROLE_TOKEN_VALUES.dark["--chart-tip-bg"],
      ]) {
        expect(contrastRatio(value, bg), `${name} na ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it.each(THEMES)("motyw %s: siatka wyczuwalna, oś mocniejsza od niej", (_n, _b, values, plate) => {
    const grid = contrastRatio(values["--chart-grid"], plate);
    const axis = contrastRatio(values["--chart-axis"], plate);
    expect(grid).toBeGreaterThan(1.05);
    expect(grid).toBeLessThan(1.3);
    expect(axis).toBeGreaterThan(grid);
    expect(axis).toBeLessThan(1.6);
  });

  it("tusz ma trzy UPORZĄDKOWANE stopnie: tytuł > etykiety danych > opisy osi", () => {
    for (const [, , values, plate] of THEMES) {
      const c = (n: string): number => contrastRatio(values[n as keyof typeof values], plate);
      expect(c("--chart-ink")).toBeGreaterThan(c("--chart-ink2"));
      expect(c("--chart-ink2")).toBeGreaterThan(c("--chart-ink3"));
    }
  });

  it("łupek główny jest mocniejszy od łupka drugiego w obu motywach", () => {
    for (const [, , values, plate] of THEMES) {
      expect(contrastRatio(values["--chart-s-main"], plate)).toBeGreaterThan(
        contrastRatio(values["--chart-s-alt"], plate),
      );
    }
  });
});

describe("role wykresów - decyzje kolorystyczne", () => {
  it("ŻADNEGO BURSZTYNU: „powyżej przedziału” nie leży w rodzinie pomarańczu marki", () => {
    // Bursztyn (#B7791F we wzorcu) ma odcień OKLCh ~75°, pomarańcz marki ~54°.
    // Rola „powyżej" stoi poza całym pasmem ciepłych żółci i pomarańczy.
    for (const values of [ROLE_TOKEN_VALUES.light, ROLE_TOKEN_VALUES.dark]) {
      const hue = oklchOf(values["--chart-warn"]).h;
      expect(hue < 30 || hue > 110, `odcień ${hue.toFixed(0)}°`).toBe(true);
    }
  });

  it("dodatni rozchodzi się z czerwienią przy KAŻDYM rodzaju widzenia barw", () => {
    // Wzorcowy #2d7a6a dawał z #ef5454 przy protanopii 8,5 - dla protanopa
    // wzrost i spadek byłyby tym samym kolorem. Nasz morski daje 34,6.
    for (const kind of ["deutan", "protan", "tritan"] as const) {
      expect(
        cvdDistance(CHART_SEMANTIC.positiveLight, CHART_SEMANTIC.negativeLight, kind),
        kind,
      ).toBeGreaterThan(30);
    }
  });

  it("akcent jest kolorem marki i NIE przechodzi progu grafiki na bieli - stąd drugie nośniki", () => {
    // Fakt zapisany wprost: seria w akcencie nie może być jedynym nośnikiem,
    // więc rysunek daje jej kształt punktu, etykietę przy końcu linii,
    // tooltip i tabelę danych. Gdyby ktoś przyciemnił akcent, ta asercja
    // każe zaktualizować także ten opis.
    expect(token(LIGHT_BLOCK, "--chart-accent")).toBe("#fa9346");
    expect(contrastRatio("#fa9346", CHART_PLATE.light)).toBeLessThan(3);
    // Napisy akcentu idą wariantem audytowym, który próg tekstu przechodzi.
    expect(ROLE.accText).toBe("var(--chart-accent-audit)");
    expect(
      contrastRatio(token(LIGHT_BLOCK, "--chart-accent-audit"), CHART_PLATE.light),
    ).toBeGreaterThanOrEqual(4.5);
  });
});
