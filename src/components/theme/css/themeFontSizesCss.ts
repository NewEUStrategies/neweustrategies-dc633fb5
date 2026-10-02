// Generator CSS bloku `<style data-theme-font-sizes>` (`<ThemeFontSizesStyle/>`).
//
// Celowo poza komponentem: ciągnie `lib/theme/fontSizes.ts` (schemat zod,
// domyślne, generator; 7,5 kB źródeł). W przeglądarce dojeżdża wyłącznie
// przez `import()` przy zmianie wiersza `font_sizes` po hydratacji - patrz
// `useDeferredStyleCss`. Wejściem jest SUROWY wiersz z mapy ustawień (ta sama
// projekcja, którą robi `useFontSizes`).
import { fontSizesFromRaw, fontSizesToCss } from "@/lib/theme/fontSizes";
import { hardenStyleCss } from "@/lib/sanitizePure";

export function themeFontSizesStyleCss(raw: unknown): string {
  return hardenStyleCss(fontSizesToCss(fontSizesFromRaw(raw)));
}
