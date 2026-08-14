// Jedno źródło prawdy dla atrybutu `sizes` okładek kart wpisów (molekuła
// PostListCard) - współdzielone przez komponenty ORAZ preload LCP w head()
// tras archiwów. Preload `imagesizes` musi być bajtowo identyczny z malowanym
// `<img sizes>`, inaczej przeglądarka pobiera inny wariant niż renderuje.
// Moduł bez zależności - bezpieczny w grafie loaderów tras.

/** Karty w siatce 1/2/3 kolumny w kontenerze max 1200 px. */
export const CARD_IMAGE_SIZES = "(min-width: 1024px) 360px, (min-width: 768px) 45vw, 92vw";

/**
 * Karta WYRÓŻNIONA (featured na górze archiwum / lead magazynowy) maluje się
 * na ~660-1200 px szerokości. Dziedziczenie CARD_IMAGE_SIZES (360 px) kazało
 * przeglądarce brać wariant ~360*DPR i rozciągać go do ~800 px - rozmyta
 * okładka na najbardziej eksponowanej karcie archiwum.
 */
export const FEATURED_CARD_IMAGE_SIZES = "(min-width: 1024px) 800px, 92vw";
