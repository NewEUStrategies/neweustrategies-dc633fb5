// Generator CSS bloku `<style data-brand-tokens>` (`<DesignTokensStyle/>`).
//
// CIĘŻKI MODUŁ - celowo poza komponentem. Ciągnie `lib/builder/globalColors.ts`
// (44 kB katalogu slotów), który przez ten import siedział w chunku wejściowym
// każdej strony publicznej. Komponent importuje go statycznie wyłącznie w
// gałęzi serwerowej `createIsomorphicFn` (wycinanej z bundla przeglądarki),
// a w przeglądarce dociąga przez `import()` dopiero, gdy dane po hydratacji
// różnią się od migawki SSR - patrz `useDeferredStyleCss`.
import { tokensToCss, type DesignTokens } from "@/lib/builder/designTokens";
import { globalColorsToCss } from "@/lib/builder/globalColors";
import type { GlobalColorsValue } from "@/lib/builder/globalColorsValue";
import { fontScaleToCss, type FontScaleValue } from "@/lib/theme/fontScale";
import { hardenStyleCss } from "@/lib/sanitizePure";

export interface DesignTokensStyleInput {
  tokens: DesignTokens;
  globals: GlobalColorsValue;
  fontScale: FontScaleValue;
}

/**
 * Tokeny marki + kolory globalne + tabela rozmiarów czcionek, utwardzone.
 * Wartości z bazy trafiają do arkusza wprost, więc `hardenStyleCss` pilnuje,
 * żeby wstrzyknięte `</style>` nie wyszło poza blok.
 */
export function designTokensStyleCss({ tokens, globals, fontScale }: DesignTokensStyleInput) {
  return hardenStyleCss(
    tokensToCss(tokens) + globalColorsToCss(globals) + fontScaleToCss(fontScale),
  );
}
