// Jedno źródło prawdy dla atrybutu `sizes` obrazów slidera - współdzielone
// przez renderer (sliderVariants) i budowniczego preloadu LCP (heroImage).
// Preload `<link rel="preload" imagesizes>` MUSI być bajtowo identyczny
// z `<img sizes>`, inaczej przeglądarka pobiera INNY wariant niż maluje
// (podwójny transfer zamiast przyspieszenia).
//
// Świadomie ZERO zależności: moduł trafia i do lekkiego grafu loaderów tras
// (preload), i do leniwego chunka renderera sliderów (~53 kB źródła) - nie
// może przeciągnąć żadnego z nich w drugą stronę.

/**
 * Warianty jednoslajdowe (editorial-hero, cinematic-overlay, minimal-strip)
 * malują obraz na pełnej szerokości widgetu. "100vw" to uczciwa GÓRNA granica:
 * szerokość kolumny buildera nie jest znana na serwerze, a zaniżenie `sizes`
 * kosztuje ostrość hero - najbardziej eksponowanego obrazu serwisu.
 */
export const SLIDER_FULL_BLEED_SIZES = "100vw";

/** Split-feature: obraz zajmuje połowę widgetu od breakpointu md (768 px). */
export const SLIDER_SPLIT_SIZES = "(max-width: 767px) 100vw, 50vw";

/**
 * Multi-card: tor renderuje `columns` kart obok siebie NA KAŻDEJ szerokości
 * (cardWidth = (100% - odstępy) / columns), więc karta nigdy nie jest szersza
 * niż 100/columns szerokości widgetu. Dotychczasowe "100vw" pobierało wariant
 * ~3x za szeroki dla domyślnych 3 kolumn - czysty narzut transferu na ścieżce
 * LCP bez żadnego zysku wizualnego.
 */
export function sliderMultiCardSizes(columns: number): string {
  const cols = Math.min(4, Math.max(1, Math.round(columns)));
  if (cols === 1) return SLIDER_FULL_BLEED_SIZES;
  return `${Math.round(100 / cols)}vw`;
}

/** `sizes` pierwszego (LCP) obrazu slidera dla danego wariantu. */
export function sliderImageSizes(variant: string, columns: number): string {
  if (variant === "multi-card") return sliderMultiCardSizes(columns);
  if (variant === "split-feature") return SLIDER_SPLIT_SIZES;
  return SLIDER_FULL_BLEED_SIZES;
}
