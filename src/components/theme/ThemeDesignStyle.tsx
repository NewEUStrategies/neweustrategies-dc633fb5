// Injects Theme Design tokens as CSS variables under :root. Pairs with the
// utility classes defined in styles.css (`.cms-block-heading`, `.cms-thumb`,
// `.cms-read-more`, `.cms-meta-info`).
//
// Language-aware: when the admin sets Theme Design to "split per lang",
// consumers browsing EN receive the EN token set (falling back to PL if the
// EN row is empty). This keeps public pages, CMS builders (Gutenberg /
// Elementor-style) and every widget visually consistent per language.
//
// Blok emitujemy ZAWSZE, także zanim zapytanie wróci: dawne `return null`
// znaczyło "SSR bez tokenów motywu, klient z tokenami", więc nagłówki bloków,
// przyciski „czytaj dalej" i meta zmieniały rozmiar tuż po hydratacji (audyt
// CWV, F29a). `THEME_DESIGN_DEFAULTS` to ten sam obiekt po obu stronach, a
// zapytanie i tak degraduje do niego przy braku wiersza w bazie.
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  useThemeDesign,
  useThemeDesignEn,
  useThemeDesignLangMode,
  themeDesignToCss,
  THEME_DESIGN_DEFAULTS,
} from "@/lib/theme/themeDesign";
import { hardenStyleCss } from "@/lib/sanitizePure";

export function ThemeDesignStyle() {
  const { i18n } = useTranslation();
  const lang = (i18n.language ?? "pl").startsWith("en") ? "en" : "pl";
  const { data: pl } = useThemeDesign();
  const { data: en } = useThemeDesignEn();
  const { data: modeRow } = useThemeDesignLangMode();
  const mode = modeRow?.mode ?? "shared";
  const effective = (mode === "split" && lang === "en" ? (en ?? pl) : pl) ?? THEME_DESIGN_DEFAULTS;
  // Komponent wisi przy korzeniu aplikacji - bez memo budował i utwardzał
  // kilkadziesiąt zmiennych CSS przy każdym renderze drzewa.
  const css = useMemo(() => hardenStyleCss(themeDesignToCss(effective)), [effective]);
  return (
    <style
      data-theme-design
      data-lang={lang}
      data-mode={mode}
      dangerouslySetInnerHTML={{ __html: css }}
    />
  );
}
