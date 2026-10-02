// Klucz wiersza `site_settings` z rozmiarami czcionek motywu.
//
// Osobny plik, bo `<ThemeFontSizesStyle/>` czyta z mapy ustawień wyłącznie ten
// klucz - a import czegokolwiek z `fontSizes.ts` (schemat zod, hooki, generator;
// 7,5 kB źródeł) trzymałby cały moduł w chunku wejściowym. `fontSizes.ts`
// re-eksportuje stałą, więc dotychczasowi importerzy nie widzą zmiany.
export const FONT_SIZES_KEY = "font_sizes";
