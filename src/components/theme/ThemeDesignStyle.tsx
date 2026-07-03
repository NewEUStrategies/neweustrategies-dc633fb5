// Injects Theme Design tokens as CSS variables under :root. Pairs with the
// utility classes defined in styles.css (`.cms-block-heading`, `.cms-thumb`,
// `.cms-read-more`, `.cms-meta-info`).
import { useThemeDesign, themeDesignToCss } from "@/lib/theme/themeDesign";

export function ThemeDesignStyle() {
  const { data } = useThemeDesign();
  if (!data) return null;
  return <style data-theme-design dangerouslySetInnerHTML={{ __html: themeDesignToCss(data) }} />;
}
