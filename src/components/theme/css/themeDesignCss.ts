// Generator CSS bloku `<style data-theme-design>` (`<ThemeDesignStyle/>`).
//
// CIĘŻKI MODUŁ - celowo poza komponentem: ciągnie `lib/theme/themeDesign.ts`
// (schemat zod, domyślne, generator; 22 kB źródeł). W przeglądarce dojeżdża
// wyłącznie przez `import()` przy zmianie danych po hydratacji - patrz
// `useDeferredStyleCss`.
//
// Wejściem są SUROWE wiersze `site_settings` (plus ewentualne wpisy pochodne
// z cache'u, już sparsowane - `themeDesignFromRaw` jest idempotentne), więc
// serwer renderuje prawdziwe tokeny najemcy już w pierwszym HTML-u. Dawniej
// komponent czytał zapytania pochodne, których SSR nigdy nie wypełniał
// (`useQuery` nie pobiera na serwerze), i wysyłał domyślne, a klient tuż po
// hydratacji podmieniał je na właściwe.
import {
  themeDesignFromRaw,
  themeDesignLangModeFromRaw,
  themeDesignToCss,
  type ThemeDesignLang,
} from "@/lib/theme/themeDesign";
import { hardenStyleCss } from "@/lib/sanitizePure";

export interface ThemeDesignStyleInput {
  lang: ThemeDesignLang;
  /** Surowy wiersz `theme_design` albo sparsowany wpis pochodny z cache'u. */
  pl: unknown;
  /** Surowy wiersz `theme_design_en` albo sparsowany wpis pochodny z cache'u. */
  en: unknown;
  /** Surowy wiersz `theme_design_lang_mode` albo wpis pochodny `{ mode }`. */
  mode: unknown;
}

/**
 * Tryb wspólny: zawsze wiersz bazowy (PL). Tryb osobny + EN: wiersz EN
 * (bez wiersza w bazie - domyślne, dokładnie jak `useThemeDesignEn`).
 */
export function themeDesignStyleCss({ lang, pl, en, mode }: ThemeDesignStyleInput): string {
  const split = themeDesignLangModeFromRaw(mode).mode === "split";
  const effective = themeDesignFromRaw(split && lang === "en" ? en : pl);
  return hardenStyleCss(themeDesignToCss(effective));
}
