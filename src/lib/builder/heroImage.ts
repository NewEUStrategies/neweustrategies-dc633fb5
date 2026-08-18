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
// Zasada ostrożności: gdy pierwszego obrazu nie da się wyznaczyć jednoznacznie
// (sekcja z eksperymentem A/B, para light/dark, logo, placeholder) - zwracamy
// null. Brak preloadu kosztuje tylko tyle, co dotychczas; zły preload zawsze
// kosztuje podwójny transfer.
import type { QueryClient } from "@tanstack/react-query";
import type {
  BuilderDocument,
  SectionChild,
  SectionNode,
  WidgetContent,
  WidgetNode,
} from "@/lib/builder/types";
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
): ImagePreloadInput | null {
  const c = widget.content;
  if (!asBool(c.showCover, true)) return null;
  const variant = asOneOf(c.variant, SLIDER_VARIANT_VALUES, "editorial-hero");
  const columns = Math.round(asNumInRange(c.columns, 3, 1, 4));
  const sizes = sliderImageSizes(variant, columns);

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
function imageWidgetPreload(widget: WidgetNode): ImagePreloadInput | null {
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
  return preloadOf(src, WIDGET_MEDIA_SPLIT_SIZES);
}

function darkFeaturedCardPreload(widget: WidgetNode): ImagePreloadInput | null {
  const img = safeImageUrl(getStr(widget.content, "image"));
  if (!img) return null;
  return preloadOf(img, WIDGET_MEDIA_SPLIT_SIZES);
}

/** Warianty post-listy, których obraz WIODĄCY dostaje priority w renderze
 *  (PostListView) - tylko dla nich preload ma parytet z malowanym `<img>`. */
const POST_LIST_LEAD_SIZES: Readonly<Record<string, string>> = {
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
  const sizes = isCarousel ? POST_LIST_GRID_COVER_SIZES : POST_LIST_LEAD_SIZES[variant];
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
): ImagePreloadInput | null {
  switch (widget.type) {
    case "slider":
      return sliderPreload(widget, queryClient, lang);
    case "image":
      return imageWidgetPreload(widget);
    case "dark-featured-card":
      return darkFeaturedCardPreload(widget);
    case "post-list":
    case "carousel":
      return postListPreload(widget, queryClient, lang);
    default:
      return null;
  }
}

/** Widget schowany na desktopie nie jest malowany w SSR (pierwszy render jest
 *  deterministycznie desktopowy - patrz BuilderRenderer). */
function hiddenOnDesktop(widget: WidgetNode): boolean {
  return Boolean(widget.advanced?.hideOn?.desktop);
}

/** Kolumny/inner-sekcje widoczne przy pierwszym malowaniu (aktywna zakładka). */
function visibleChildren(section: SectionNode): SectionChild[] {
  const children = (Array.isArray(section.children) ? section.children : []).filter(
    (child): child is NonNullable<typeof child> => Boolean(child),
  );
  const tabs = section.tabs;
  if (!tabs?.enabled || !tabs.items || tabs.items.length === 0) return children;
  const initialTabId =
    tabs.defaultTabId && tabs.items.some((t) => t.id === tabs.defaultTabId)
      ? tabs.defaultTabId
      : tabs.items[0].id;
  return children.filter((child) => !child.tabId || child.tabId === initialTabId);
}

function sectionWidgetsInPaintOrder(section: SectionNode): WidgetNode[] {
  const out: WidgetNode[] = [];
  for (const child of visibleChildren(section)) {
    if (child.kind === "column") {
      (child.children ?? []).forEach((w) => {
        if (w) out.push(w);
      });
      continue;
    }
    (child.columns ?? []).forEach((column) =>
      (column?.children ?? []).forEach((w) => {
        if (w) out.push(w);
      }),
    );
  }
  return out.filter((w) => w.kind === "widget");
}

/**
 * Deskryptor preloadu LCP dla dokumentu buildera: pierwszy jednoznacznie
 * wyznaczalny obraz z sekcji nad zgięciem. Wołać PO rozgrzaniu zapytań
 * widgetów (loader trasy), inaczej tryby danych zwrócą null. Nigdy nie rzuca.
 */
export function builderHeroPreload(
  doc: BuilderDocument,
  queryClient: QueryClient,
  lang: Lang,
  aboveFoldSections: number = ABOVE_FOLD_SECTION_COUNT,
): ImagePreloadInput | null {
  try {
    const safeDoc = safeParseBuilderDoc(doc);
    for (const section of safeDoc.sections.slice(0, Math.max(0, aboveFoldSections))) {
      if (!section) continue;
      // Sekcje eksperymentów A/B: wariant losuje się na kliencie, więc SSR
      // nie wie, który obraz zostanie pokazany - ostrożnie odpuszczamy.
      if (section.advanced?.abTest) continue;
      for (const widget of sectionWidgetsInPaintOrder(section)) {
        if (hiddenOnDesktop(widget)) continue;
        const preload = widgetPreload(widget, queryClient, lang);
        if (preload) return preload;
      }
    }
    return null;
  } catch {
    // Preload jest czystą optymalizacją - żaden kształt dokumentu nie może
    // wywrócić loadera trasy.
    return null;
  }
}
