// Injects font-size tokens (H1-H6, body, small, lead, blockquote, code) as
// :root CSS custom properties. Consumed by global selectors in styles.css.
import { useFontSizes, fontSizesToCss } from "@/lib/theme/fontSizes";
import { hardenStyleCss } from "@/lib/sanitize";

export function ThemeFontSizesStyle() {
  const { data } = useFontSizes();
  if (!data) return null;
  return (
    <style
      data-theme-font-sizes
      dangerouslySetInnerHTML={{ __html: hardenStyleCss(fontSizesToCss(data)) }}
    />
  );
}
