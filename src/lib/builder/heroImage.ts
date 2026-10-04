import type { ImageSlot } from "./imageSlot";
import { isPostListLeadVariant, lcpCandidates, type PostListLeadVariant } from "./lcpCandidate";
// Preload LCP dla dokumentów buildera (strona główna, strony publiczne).
//
// Wpisy mają kontrakt loader->head() z preloadem okładki od dawna ($.tsx +
// buildCoverPreload); dokumenty buildera były wykluczone, bo ich hero żyje
// w drzewie sekcji. Ten moduł domyka lukę: po rozgrzaniu zapytań widgetów
// (prefetchCachedRouteQueries / prefetchAboveFoldQueries) pierwszy malowany
// obraz sekcji nad zgięciem jest w pełni wyznaczalny na serwerze - z treści
// widgetu albo z cache React Query.
//
// KONTRAKT PARYTETU: zwracany deskryptor (href + imageSrcSet + imageSizes)
// musi być bajtowo identyczny z tym, co wyrenderuje widget - `sizes` pochodzą
// z tych samych modułów (sliderSizes / widgetImageSizes), a srcSet z tego
// samego buildImageSrcSet. Preload innego kandydata niż malowany to podwójny
// transfer zamiast przyspieszenia.
//
// JEDNO ŹRÓDŁO KANDYDATA (P1.4, werdykt LP-2). Który widget jest obrazem LCP,
// rozstrzyga WYŁĄCZNIE `lcpCandidates` (lcpCandidate.ts) - ta sama czysta
// funkcja dokumentu, z której renderer bierze priorytet i znacznik
// `data-lcp-candidate`. Ten moduł dokłada do kandydata tylko to, czego
// dokument nie zna: adres obrazu z treści albo z cache React Query. Gdy dla
// kandydata adresu nie da się wyznaczyć (pusty cache, wiersz bez okładki),
// preloadu NIE MA - nie przechodzimy do kolejnego widgetu, bo ten po P1.4 jest
// leniwy (preload leniwego obrazu = podwójny priorytet dla nie-LCP, F4).
//
// Zasada ostrożności: gdy pierwszego obrazu nie da się wyznaczyć jednoznacznie
// (para light/dark, logo, placeholder) - zwracamy null. Brak preloadu kosztuje
// tylko tyle, co dotychczas; zły preload zawsze kosztuje podwójny transfer.
import type { QueryClient } from "@tanstack/react-query";
import type { BuilderDocument, WidgetContent, WidgetNode } from "@/lib/builder/types";
import type { Lang } from "@/lib/builder/postListQuery";
import type { ImagePreloadInput } from "@/lib/seo/meta";
import { asBool, asNumInRange, asOneOf, asStr } from "@/lib/content-model/contentValue";
import { safeImageUrl } from "@/lib/sanitizePure";
import { buildImageSrcSet } from "@/lib/cropSizes";
import { safeParseBuilderDoc } from "@/lib/builder/schema";
import { SLIDER_VARIANT_VALUES } from "@/lib/builder/sliderOptions";
import {
  sliderPostsLimit,
  sliderPostsQueryOptions,
  sliderUsesPostsSource,
  type SliderPostRow,
} from "@/lib/builder/sliderPostsQuery";
import { sliderFallbackImagesQueryOptions } from "@/lib/builder/sliderFallbackQuery";
import { sliderImageSizes } from "@/lib/builder/sliderSizes";
import { postListQueryOptions, type PostRow } from "@/lib/builder/postListQuery";
import { readThumbnailOverrides } from "@/lib/builder/thumbnailOverrides";
import { ABOVE_FOLD_SECTION_COUNT } from "@/lib/builder/prefetch";
import {
  POST_LIST_CLASSIC_COVER_SIZES,
  POST_LIST_FLEX_LEAD_SIZES,
  POST_LIST_GRID_COVER_SIZES,
  WIDGET_MEDIA_SPLIT_SIZES,
  imageWidgetSizes,
} from "@/lib/builder/widgetImageSizes";

function getStr(c: WidgetContent, key: string): string {
  return asStr(c[key]);
}

/** Deskryptor preloadu z parą srcSet/sizes zbudowaną z jednego URL-a. */
function preloadOf(href: string, sizes: string): ImagePreloadInput {
  return { href, imageSrcSet: buildImageSrcSet(href), imageSizes: sizes };
}

/**
 * Pierwszy obraz slidera - dokładnie ta sama droga rozstrzygania co
 * SliderRender: jawny obraz slajdu -> okładka wpisu (tryb posts) -> obraz
 * zapasowy (najnowsze okładki). Placeholder (inline SVG) nie jest siecią,
 * więc nie ma czego preloadować.
 */
function sliderPreload(
  widget: WidgetNode,
  queryClient: QueryClient,
  lang: Lang,
  slot?: ImageSlot,
): ImagePreloadInput | null {
  const c = widget.content;
  if (!asBool(c.showCover, true)) return null;
  const variant = asOneOf(c.variant, SLIDER_VARIANT_VALUES, "editorial-hero");
  const columns = Math.round(asNumInRange(c.columns, 3, 1, 4));
  const sizes = sliderImageSizes(variant, columns, slot);

  let firstImage = "";
  let fallbackCount = 3;
  if (sliderUsesPostsSource(c)) {
    const rows = queryClient.getQueryData<SliderPostRow[]>(
      sliderPostsQueryOptions(c, lang).queryKey,
    );
    // Cache pusty = prefetch nie zdążył/nie wystartował - nie zgadujemy.
    // Zero WIERSZY = slider renderuje pusty stan bez żadnego obrazu, więc
    // preload obrazu zapasowego byłby czystym marnowaniem transferu.
    if (!rows || rows.length === 0) return null;
    firstImage = safeImageUrl(rows[0]?.cover_image_url ?? "");
    fallbackCount = Math.max(3, sliderPostsLimit(c));
  } else {
    const items = Array.isArray(c.items) ? (c.items as unknown[]) : [];
    const first = items.find(
      (x): x is Record<string, unknown> => typeof x === "object" && x !== null,
    );
    // Bez slajdów renderer maluje pusty stan - nie ma czego preloadować.
    if (!first) return null;
    firstImage = safeImageUrl(typeof first.image === "string" ? first.image : "");
    fallbackCount = Math.max(3, items.length || 3);
  }
  // Slajd ISTNIEJE, ale bez poprawnej okładki: renderer podstawia obraz
  // zapasowy (najnowsze okładki) - dokładnie ten preloadujemy.
  if (!firstImage) {
    const fallback = queryClient.getQueryData<string[]>(
      sliderFallbackImagesQueryOptions(fallbackCount).queryKey,
    );
    firstImage = safeImageUrl(fallback?.[0] ?? "");
  }
  if (!firstImage) return null;
  return preloadOf(firstImage, sizes);
}

/**
 * Widget "image": tylko wariant jednoźródłowy i nie-logo. Para light/dark
 * wybiera się motywem czytelnika (nieznanym na serwerze), a logo podmienia
 * się na asset z ustawień - w obu przypadkach preload zgadywałby.
 */
function imageWidgetPreload(widget: WidgetNode, slot?: ImageSlot): ImagePreloadInput | null {
  const c = widget.content;
  const src = safeImageUrl(getStr(c, "src"));
  const srcDark = safeImageUrl(getStr(c, "srcDark"));
  if (!src) return null;
  if (srcDark && srcDark !== src) return null;
  // Heurystyka logo sprawdza OBA alty: renderer czyta `alt_${lang}` z
  // fallbackiem na alt_pl, więc "Logo" w którymkolwiek języku może podmienić
  // src na asset z ustawień - preload zgadywałby.
  if (
    getStr(c, "useSiteLogo") ||
    /logo/i.test(getStr(c, "alt_pl")) ||
    /logo/i.test(getStr(c, "alt_en"))
  ) {
    return null;
  }
  return preloadOf(src, imageWidgetSizes(c, slot));
}

function darkFeaturedCardPreload(widget: WidgetNode): ImagePreloadInput | null {
  const img = safeImageUrl(getStr(widget.content, "image"));
  if (!img) return null;
  return preloadOf(img, WIDGET_MEDIA_SPLIT_SIZES);
}

/** Warianty post-listy, których obraz WIODĄCY dostaje priority w renderze
 *  (PostListView) - tylko dla nich preload ma parytet z malowanym `<img>`.
 *  Klucze typuje zbiór kandydatów z lcpCandidate.ts (kompilator trzyma oba
 *  miejsca razem). */
const POST_LIST_LEAD_SIZES: Readonly<Record<PostListLeadVariant, string>> = {
  card: POST_LIST_GRID_COVER_SIZES,
  minimal: POST_LIST_GRID_COVER_SIZES,
  overlay: POST_LIST_GRID_COVER_SIZES,
  "boxed-grid": POST_LIST_GRID_COVER_SIZES,
  classic: POST_LIST_CLASSIC_COVER_SIZES,
  "flex-grid": POST_LIST_FLEX_LEAD_SIZES,
};

function postListPreload(
  widget: WidgetNode,
  queryClient: QueryClient,
  lang: Lang,
): ImagePreloadInput | null {
  const c = widget.content;
  if (getStr(c, "showCover") === "0") return null;
  // Karuzela renderuje KAŻDY wariant przez PostCard (overlay/minimal/default
  // card - wszystkie z sizes siatki), więc wariant "classic"/"flex-grid" na
  // karuzeli nadal maluje GRID - preload musi liczyć tę samą wartość.
  const isCarousel = widget.type === "carousel";
  const variant = getStr(c, "variant") || "card";
  const sizes = isCarousel
    ? POST_LIST_GRID_COVER_SIZES
    : isPostListLeadVariant(variant)
      ? POST_LIST_LEAD_SIZES[variant]
      : null;
  if (!sizes) return null;
  const rows = queryClient.getQueryData<PostRow[]>(postListQueryOptions(c, lang).queryKey);
  if (!rows || rows.length === 0) return null;
  const first = rows[0];
  const overrides = readThumbnailOverrides(c);
  const cover = safeImageUrl(overrides[first.id] ?? first.cover_image_url ?? "");
  if (!cover) return null;
  return preloadOf(cover, sizes);
}

function widgetPreload(
  widget: WidgetNode,
  queryClient: QueryClient,
  lang: Lang,
  slot?: ImageSlot,
): ImagePreloadInput | null {
  switch (widget.type) {
    case "slider":
      return sliderPreload(widget, queryClient, lang, slot);
    case "image":
      return imageWidgetPreload(widget, slot);
    case "dark-featured-card":
      return darkFeaturedCardPreload(widget);
    case "post-list":
    case "carousel":
      return postListPreload(widget, queryClient, lang);
    default:
      return null;
  }
}

/** Klucz deduplikacji - ten sam, którym React łączy preload z `<img>`. */
function preloadKey(input: ImagePreloadInput): string {
  return input.imageSrcSet ? `${input.imageSrcSet}\n${input.imageSizes ?? ""}` : input.href;
}

/**
 * Deskryptory preloadu obrazów LCP dokumentu buildera - po jednym na kandydata
 * z `lcpCandidates` (maks. 2, najpierw desktopowy), bez duplikatów. Wołać PO
 * rozgrzaniu zapytań widgetów (loader trasy), inaczej tryby danych dadzą pustą
 * listę. Nigdy nie rzuca.
 */
export function builderHeroPreloads(
  doc: BuilderDocument,
  queryClient: QueryClient,
  lang: Lang,
  aboveFoldSections: number = ABOVE_FOLD_SECTION_COUNT,
): ImagePreloadInput[] {
  try {
    const safeDoc = safeParseBuilderDoc(doc);
    const out: ImagePreloadInput[] = [];
    for (const candidate of lcpCandidates(safeDoc, { sections: aboveFoldSections })) {
      // Kandydat bez wyznaczalnego obrazu: brak preloadu, BEZ przejścia do
      // następnego widgetu (ten jest leniwy - preload byłby stratą pasma).
      const preload = widgetPreload(candidate.widget, queryClient, lang, candidate.slot);
      if (preload && !out.some((p) => preloadKey(p) === preloadKey(preload))) out.push(preload);
    }
    return out;
  } catch {
    // Preload jest czystą optymalizacją - żaden kształt dokumentu nie może
    // wywrócić loadera trasy.
    return [];
  }
}

/**
 * Pierwszy deskryptor z `builderHeroPreloads` (kandydat desktopowy, a gdy jego
 * obrazu nie da się wyznaczyć - mobilny) albo null. Nigdy nie rzuca.
 */
export function builderHeroPreload(
  doc: BuilderDocument,
  queryClient: QueryClient,
  lang: Lang,
  aboveFoldSections: number = ABOVE_FOLD_SECTION_COUNT,
): ImagePreloadInput | null {
  return builderHeroPreloads(doc, queryClient, lang, aboveFoldSections)[0] ?? null;
}
