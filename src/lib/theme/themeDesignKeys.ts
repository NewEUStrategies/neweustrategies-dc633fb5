// Klucze Theme Design: wiersze `site_settings` i klucze zapytań pochodnych.
//
// Osobny plik, bo `<ThemeDesignStyle/>` potrzebuje z `themeDesign.ts`
// WYŁĄCZNIE tych kluczy (czyta surowe wiersze z mapy ustawień i nasłuchuje
// wpisów pochodnych w cache'u), a każdy import z tamtego modułu - schemat zod,
// domyślne, generator; 22 kB źródeł - trzymałby go w chunku wejściowym.
// `themeDesign.ts` używa tych samych stałych, więc klucze mają jedno źródło.

export const THEME_DESIGN_KEY = "theme_design";
export const THEME_DESIGN_KEY_EN = "theme_design_en";
export const THEME_DESIGN_LANG_MODE_KEY = "theme_design_lang_mode";

export const THEME_DESIGN_QUERY_KEY = ["site_settings", THEME_DESIGN_KEY] as const;
export const THEME_DESIGN_QUERY_KEY_EN = ["site_settings", THEME_DESIGN_KEY_EN] as const;
export const THEME_DESIGN_LANG_MODE_QUERY_KEY = [
  "site_settings",
  THEME_DESIGN_LANG_MODE_KEY,
] as const;
