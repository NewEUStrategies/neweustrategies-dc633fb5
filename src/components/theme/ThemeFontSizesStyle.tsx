// Injects font-size tokens (H1-H6, body, small, lead, blockquote, code) as
// :root CSS custom properties. Consumed by global selectors in styles.css.
// Dopóki bulk-query site_settings nie wróci, emitujemy defaulty - dzięki temu
// tytuł wpisu i lead nigdy nie renderują się bez tokenów motywu.
import { useMemo } from "react";
import { useFontSizes, fontSizesToCss, FONT_SIZES_DEFAULTS } from "@/lib/theme/fontSizes";
import { hardenStyleCss } from "@/lib/sanitizePure";

export function ThemeFontSizesStyle() {
  const { data } = useFontSizes();
  // Komponent wisi przy korzeniu aplikacji - bez memo budował i utwardzał ten
  // sam CSS przy każdym renderze drzewa.
  const css = useMemo(() => hardenStyleCss(fontSizesToCss(data ?? FONT_SIZES_DEFAULTS)), [data]);
  return <style data-theme-font-sizes dangerouslySetInnerHTML={{ __html: css }} />;
}
