// Injects brand design tokens AND global colors as CSS variables on :root / .dark
// so values like `var(--brand-primary)` and overrides of semantic shadcn tokens
// (--primary, --background, …) take effect on every page. Mount once near the app root.
import { useDesignTokens, tokensToCss } from "@/lib/builder/designTokens";
import { useGlobalColors, globalColorsToCss } from "@/hooks/useGlobalColors";
import { useFontScale, fontScaleToCss } from "@/hooks/useFontScale";
import { hardenStyleCss } from "@/lib/sanitizePure";

export function DesignTokensStyle() {
  const { data: tokens } = useDesignTokens();
  const { data: globals } = useGlobalColors();
  // Tabela rozmiarów czcionek (admin → Wygląd → Rozmiary czcionek).
  const { data: fontScale } = useFontScale();
  const css =
    (tokens ? tokensToCss(tokens) : "") +
    (globals ? globalColorsToCss(globals) : "") +
    (fontScale ? fontScaleToCss(fontScale) : "");
  if (!css) return null;
  // Stored token/colour/font values are interpolated into this CSS; harden it
  // so an injected `</style>` can't break out into HTML.
  return <style data-brand-tokens dangerouslySetInnerHTML={{ __html: hardenStyleCss(css) }} />;
}
