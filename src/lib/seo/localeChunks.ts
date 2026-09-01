// Adresy chunków rdzenia słownika, PODMIENIANE W BUILDZIE.
//
// Ten plik jest w źródłach po to, żeby nie było modułu wirtualnego: vitest
// używa własnej konfiguracji (`vitest.config.ts`), a moduł wirtualny
// zarejestrowany tylko w `vite.config.ts` wywracałby każdy test importujący
// korzeń drzewa tras. Tutaj fallback jest JAWNY i jest tym, co widzi test:
// brak nazw = brak hintu = dokładnie dzisiejsze zachowanie.
//
// Wartości wstawia `scripts/lib/localeChunkPlugin.ts` hookiem `transform`,
// w środowisku SERWEROWYM builda - patrz nagłówek tej wtyczki, w którym stoi
// pełne uzasadnienie (dlaczego nie `?url`, dlaczego nie manifest i dlaczego
// WYŁĄCZNIE nagłówek HTTP `Link`, a nigdy `<link>` w `<head>`).
//
// NIE ZMIENIAJ KSZTAŁTU TEGO LITERAŁU bez zmiany wtyczki: podmiana jest
// dopasowaniem tekstowym i celowo jest wąska, żeby cicha zmiana nazwy pola nie
// zostawiła po sobie hintu wskazującego w nic.
export const LOCALE_CHUNK_URLS: Readonly<Record<"pl" | "en", string | null>> = {
  pl: null,
  en: null,
};
