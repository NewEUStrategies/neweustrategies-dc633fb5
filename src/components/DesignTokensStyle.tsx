// Injects brand design tokens AND global colors as CSS variables on :root / .dark
// so values like `var(--brand-primary)` and overrides of semantic shadcn tokens
// (--primary, --background, …) take effect on every page. Mount once near the app root.
//
// Blok emitujemy ZAWSZE, także bez danych (wzorzec ThemeFontSizesStyle): bez
// wiersza w bazie `globalColorsToCss` i tak zwraca pełny zestaw `--gc-*`
// z domyślnych slotów, więc dawne `return null` znaczyło "SSR bez kolorów
// globalnych, klient z kolorami" - czyli zmiana typografii i barw całego
// dokumentu tuż po hydratacji (audyt CWV, F29a).
//
// GENERATOR POZA BOOTEM KLIENTA (audyt PSI 2026-10-02). `globalColors.ts` to
// 44 kB katalogu slotów - największy pojedynczy moduł aplikacji w chunku
// wejściowym. Serwer liczy CSS synchronicznie (gałąź `.server()`, wycinana
// z bundla przeglądarki razem z importem generatora), klient przy hydratacji
// przepisuje gotowy blok z HTML-a, a generator dociąga przez `import()`
// dopiero przy zmianie danych (zapis w panelu, zapytanie po terminie SSR).
// Szczegóły i kontrakt hydratacji: `theme/useDeferredStyleCss`.
import { useMemo } from "react";
import { createIsomorphicFn } from "@tanstack/react-start";
import { useDesignTokens, EMPTY_TOKENS } from "@/lib/builder/designTokens";
import { useGlobalColors } from "@/hooks/useGlobalColors";
import { EMPTY_GLOBAL_COLORS } from "@/lib/builder/globalColorsValue";
import { useFontScale } from "@/hooks/useFontScale";
import { EMPTY_FONT_SCALE } from "@/lib/theme/fontScale";
import { useDeferredStyleCss, type StyleGenerator } from "@/components/theme/useDeferredStyleCss";
import { StyleSink } from "@/components/theme/StyleSink";
import {
  designTokensStyleCss as serverDesignTokensStyleCss,
  type DesignTokensStyleInput,
} from "@/components/theme/css/designTokensCss";

const MARKER = "data-brand-tokens";

// Kompilator Start wycina gałąź `.server()` z bundla przeglądarki razem
// z nieużywanym już importem generatora (wzorzec: widget-view/lazySliderRender).
const getServerGenerate = createIsomorphicFn()
  .server((): StyleGenerator<DesignTokensStyleInput> | null => serverDesignTokensStyleCss)
  .client((): StyleGenerator<DesignTokensStyleInput> | null => null);
const serverGenerate = getServerGenerate();

const loadGenerate = () =>
  import("@/components/theme/css/designTokensCss").then((m) => m.designTokensStyleCss);

export function DesignTokensStyle() {
  const { data: tokens } = useDesignTokens();
  const { data: globals } = useGlobalColors();
  // Tabela rozmiarów czcionek (admin → Wygląd → Rozmiary czcionek).
  const { data: fontScale } = useFontScale();
  // Stabilna tożsamość wejścia: skrót liczy się tylko przy zmianie danych,
  // a nie przy każdym renderze korzenia aplikacji.
  const input = useMemo<DesignTokensStyleInput>(
    () => ({
      tokens: tokens ?? EMPTY_TOKENS,
      globals: globals ?? EMPTY_GLOBAL_COLORS,
      fontScale: fontScale ?? EMPTY_FONT_SCALE,
    }),
    [tokens, globals, fontScale],
  );
  const { css, hash } = useDeferredStyleCss({
    marker: MARKER,
    input,
    serverGenerate,
    loadGenerate,
  });
  // `data-css-hash` czyta `readStyleSnapshot` (STYLE_HASH_ATTR); bez skrótu
  // (render bez SSR) atrybutu nie ma, tak jak w starszym HTML-u z brzegu.
  // `StyleSink` (memo po surowym napisie, `hardenStyleCss` w miejscu renderu):
  // re-render korzenia z tym samym CSS-em nie przepisuje 26,6 KB arkusza
  // `:root` - React 19 porównuje obiekt `{__html}` po tożsamości (P1.2).
  return <StyleSink data-brand-tokens data-css-hash={hash || undefined} css={css} />;
}
