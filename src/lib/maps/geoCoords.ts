// Walidacja współrzędnych geograficznych - osobno od geometrii mapy.
//
// `lib/builder/worldMapContent.ts` (parsowanie treści widgetu) czyta rejestr
// prefetchu SSR (`lib/builder/prefetch.ts`), który jest w chunku wejściowym.
// Gdy brał te dwie funkcje z `worldMapGeo.ts`, cały moduł geometrii (rzutowanie,
// klatki kluczowe łuków, dopasowanie widoku - ~8 KB przed minifikacją) jechał
// w boocie KAŻDEJ strony, choć rysuje go wyłącznie leniwy widget mapy.
// `worldMapGeo.ts` re-eksportuje je bez zmian dla pozostałych importerów.

/** Współrzędna geograficzna po walidacji; poza zakresem -> `null`. */
export function coerceLat(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n >= -90 && n <= 90 ? n : null;
}

export function coerceLng(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n >= -180 && n <= 180 ? n : null;
}
