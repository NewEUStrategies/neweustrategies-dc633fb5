// Kształt WARTOŚCI kolorów globalnych - wydzielony z `globalColors.ts`.
//
// PO CO OSOBNY PLIK. `globalColors.ts` to 44 kB źródeł: katalog slotów
// (`GLOBAL_COLOR_GROUPS`) i generator CSS (`globalColorsToCss`). Hook zapytania
// (`hooks/useGlobalColors`) i loader korzenia (`routes/__root.tsx`) potrzebują
// z niego WYŁĄCZNIE typu i pustego domyślnego - a jeden statyczny import po te
// dwa symbole trzymał cały katalog w chunku wejściowym każdej strony
// publicznej (audyt PSI 2026-10-02). `globalColors.ts` re-eksportuje oba, więc
// dotychczasowi importerzy (panel admina) nie widzą zmiany, a tożsamość
// `EMPTY_GLOBAL_COLORS` jest jedna.

export type GlobalColorsValue = Record<
  string,
  {
    light?: string;
    dark?: string;
    hoverLight?: string;
    hoverDark?: string;
    fontFamily?: string;
    fontSize?: string;
    /** "normal" | "500" | "600" | "700" */
    fontWeight?: string;
    /** "normal" | "italic" */
    fontStyle?: string;
    /** "none" | "underline" */
    textDecoration?: string;
  }
>;

export const EMPTY_GLOBAL_COLORS: GlobalColorsValue = {};
