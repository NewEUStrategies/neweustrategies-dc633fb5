// Injects Theme Design tokens as CSS variables under :root. Pairs with the
// utility classes defined in styles.css (`.cms-block-heading`, `.cms-thumb`,
// `.cms-read-more`, `.cms-meta-info`).
//
// Language-aware: when the admin sets Theme Design to "split per lang",
// consumers browsing EN receive the EN token set (falling back to PL if the
// EN row is empty). This keeps public pages, CMS builders (Gutenberg /
// Elementor-style) and every widget visually consistent per language.
import { useTranslation } from "react-i18next";
import {
  useThemeDesign,
  useThemeDesignEn,
  useThemeDesignLangMode,
  themeDesignToCss,
} from "@/lib/theme/themeDesign";
import { hardenStyleCss } from "@/lib/sanitize";

export function ThemeDesignStyle() {
  const { i18n } = useTranslation();
  const lang = (i18n.language ?? "pl").startsWith("en") ? "en" : "pl";
  const { data: pl } = useThemeDesign();
  const { data: en } = useThemeDesignEn();
  const { data: modeRow } = useThemeDesignLangMode();
  const mode = modeRow?.mode ?? "shared";
  const effective = mode === "split" && lang === "en" ? (en ?? pl) : pl;
  if (!effective) return null;
  return (
    <style
      data-theme-design
      data-lang={lang}
      data-mode={mode}
      dangerouslySetInnerHTML={{ __html: hardenStyleCss(themeDesignToCss(effective)) }}
    />
  );
}
