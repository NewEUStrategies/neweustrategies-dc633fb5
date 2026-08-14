// Jedno źródło prawdy dla atrybutu `sizes` obrazów widgetów buildera
// (poza sliderem - ten ma własny lib/builder/sliderSizes.ts). Współdzielone
// przez renderery widgetów i budowniczego preloadu LCP (heroImage), żeby
// `imagesizes` preloadu było bajtowo identyczne z `<img sizes>` renderu.
// Świadomie ZERO zależności - moduł trafia do grafu loaderów tras.

/** Widget "image" i dark-featured-card: pełna szerokość na mobile, ~pół na desktopie. */
export const WIDGET_MEDIA_SPLIT_SIZES = "(max-width: 767px) 100vw, 50vw";

/** Post-lista, siatka kart 1-4 kolumny (card / minimal / overlay / boxed-grid). */
export const POST_LIST_GRID_COVER_SIZES =
  "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw";

/** Post-lista, wariant "classic" - jedna kolumna z dużą okładką (maks. ~900 px). */
export const POST_LIST_CLASSIC_COVER_SIZES = "(max-width: 1024px) 100vw, 900px";

/** Post-lista, wariant "flex-grid" - duży lead (~58vw) + kompaktowa kolumna boczna. */
export const POST_LIST_FLEX_LEAD_SIZES = "(max-width: 768px) 100vw, 58vw";
