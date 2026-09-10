// Pomiar etykiet. Najważniejsza asercja: heurystyka jest DOKŁADNIE ta, na
// której stoi geometria SSR, a brak kanwy daje `null` (czyli "nie wiem"),
// a nie zero (czyli "etykieta ma zerową szerokość").
//
// Zero wpuszczone do marginesu UCINA etykiety zamiast je pomieścić, więc ta
// różnica jest różnicą między poprawnym wykresem i wykresem z uciętą osią.
// W happy-dom kanwy nie ma, więc ten plik testuje właśnie tę gałąź.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHAR_WIDTH_RATIO,
  estimateLabelWidth,
  estimateMaxLabelWidth,
  measureLabelWidth,
  measureMaxLabelWidth,
  resetTextMeasureCache,
  resolveChartFontFamily,
} from "@/lib/charts/measureText";

describe("measureText - heurystyka", () => {
  it("stała szerokości znaku jest tą, na której stoi geometria SSR", () => {
    // Nie zmieniać bez przeliczenia pinowanych pozycji w testach silnika.
    expect(CHAR_WIDTH_RATIO).toBe(0.62);
    expect(estimateLabelWidth("abc", 11)).toBeCloseTo(3 * 11 * 0.62, 10);
  });

  it("pusty napis ma zerową szerokość, a nie NaN", () => {
    expect(estimateLabelWidth("", 11)).toBe(0);
    expect(estimateMaxLabelWidth([], 11)).toBe(0);
  });

  it("maksimum bierze NAJDŁUŻSZĄ etykietę, nie pierwszą ani ostatnią", () => {
    expect(estimateMaxLabelWidth(["a", "abcdef", "abc"], 11)).toBeCloseTo(
      estimateLabelWidth("abcdef", 11),
      10,
    );
  });
});

describe("measureText - brak kanwy zwraca null, nie zero", () => {
  it("pomiar niepustego napisu bez kanwy to `null`", () => {
    resetTextMeasureCache();
    // happy-dom nie implementuje kontekstu 2D. `null` znaczy "nie wiem",
    // więc wywołujący zostaje przy heurystyce.
    expect(measureLabelWidth("Województwo", 11)).toBeNull();
  });

  it("maksimum bez kanwy też jest `null`, ale PUSTY zestaw daje zero", () => {
    resetTextMeasureCache();
    expect(measureMaxLabelWidth(["a", "b"], 11)).toBeNull();
    // Pusty zestaw nie potrzebuje kanwy - jego maksimum to zero i to jest
    // prawda, nie brak wiedzy.
    expect(measureMaxLabelWidth([], 11)).toBe(0);
  });

  it("rodzina czcionki ma awaryjną wartość, gdy token nie jest rozwiązany", () => {
    // W happy-dom `getComputedStyle` nie rozwiązuje zmiennych CSS, więc
    // pomiar dostaje stos awaryjny - nigdy pusty napis, bo `ctx.font`
    // z pustą rodziną cofa się do domyślnej czcionki kanwy.
    const family = resolveChartFontFamily("awaryjny, sans-serif");
    expect(family.length).toBeGreaterThan(0);
  });
});

describe("higiena źródeł silnika wykresów", () => {
  // BRAMKA NA BAJT ZEROWY. Plik źródłowy z bajtem 0x00 w środku jest dla gita
  // PLIKIEM BINARNYM: `git diff` nie pokazuje ani jednej linii, `git blame`
  // nie działa, a przegląd kodu widzi "Bin 0 -> 7429 bytes" zamiast zmiany.
  // Nie jest to teoria - dokładnie to stało się temu plikowi, bo separator
  // klucza pamięci pomiaru został wpisany jako surowy bajt zamiast escape'u
  // `\u001f`. Kod działał, więc żaden test tego nie złapał; złapać to może
  // tylko bramka, która patrzy na BAJTY, nie na zachowanie.
  const roots = ["src/lib/charts", "src/components/charts"];
  const sources = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) return sources(path);
      return /\.(ts|tsx)$/.test(entry) ? [path] : [];
    });

  it("żaden plik silnika nie zawiera bajtu zerowego", () => {
    const files = roots.flatMap(sources);
    expect(files.length).toBeGreaterThan(10);
    const binarne = files.filter((path) => readFileSync(path).includes(0));
    expect(binarne).toEqual([]);
  });
});
