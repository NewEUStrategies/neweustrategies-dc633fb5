// Injects font-size tokens (H1-H6, body, small, lead, blockquote, code) as
// :root CSS custom properties. Consumed by global selectors in styles.css.
// Dopóki bulk-query site_settings nie wróci, emitujemy defaulty - dzięki temu
// tytuł wpisu i lead nigdy nie renderują się bez tokenów motywu.
import { useFontSizes, fontSizesToCss, FONT_SIZES_DEFAULTS } from "@/lib/theme/fontSizes";
import { hardenStyleCss } from "@/lib/sanitizePure";

export function ThemeFontSizesStyle() {
  const { data } = useFontSizes();
  return (
    <style
      data-theme-font-sizes
      dangerouslySetInnerHTML={{
        __html: hardenStyleCss(fontSizesToCss(data ?? FONT_SIZES_DEFAULTS)),
      }}
    />
  );
}
