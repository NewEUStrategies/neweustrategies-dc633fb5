// Injects brand design tokens AND global colors as CSS variables on :root / .dark
// so values like `var(--brand-primary)` and overrides of semantic shadcn tokens
// (--primary, --background, …) take effect on every page. Mount once near the app root.
//
// Blok emitujemy ZAWSZE, także bez danych (wzorzec ThemeFontSizesStyle): bez
// wiersza w bazie `globalColorsToCss` i tak zwraca pełny zestaw `--gc-*`
// z domyślnych slotów, więc dawne `return null` znaczyło "SSR bez kolorów
// globalnych, klient z kolorami" - czyli zmiana typografii i barw całego
// dokumentu tuż po hydratacji (audyt CWV, F29a).
import { useMemo } from "react";
import { useDesignTokens, tokensToCss, EMPTY_TOKENS } from "@/lib/builder/designTokens";
import { useGlobalColors, globalColorsToCss } from "@/hooks/useGlobalColors";
import { EMPTY_GLOBAL_COLORS } from "@/lib/builder/globalColors";
import { useFontScale, fontScaleToCss } from "@/hooks/useFontScale";
import { EMPTY_FONT_SCALE } from "@/lib/theme/fontScale";
import { hardenStyleCss } from "@/lib/sanitizePure";

export function DesignTokensStyle() {
  const { data: tokens } = useDesignTokens();
  const { data: globals } = useGlobalColors();
  // Tabela rozmiarów czcionek (admin → Wygląd → Rozmiary czcionek).
  const { data: fontScale } = useFontScale();
  // Stored token/colour/font values are interpolated into this CSS; harden it
  // so an injected `</style>` can't break out into HTML. `useMemo` trzyma
  // budowanie i utwardzanie CSS poza ciałem renderu - komponent siedzi przy
  // korzeniu aplikacji, więc przeliczał się przy KAŻDYM renderze drzewa.
  const css = useMemo(
    () =>
      hardenStyleCss(
        tokensToCss(tokens ?? EMPTY_TOKENS) +
          globalColorsToCss(globals ?? EMPTY_GLOBAL_COLORS) +
          fontScaleToCss(fontScale ?? EMPTY_FONT_SCALE),
      ),
    [tokens, globals, fontScale],
  );
  return <style data-brand-tokens dangerouslySetInnerHTML={{ __html: css }} />;
}
