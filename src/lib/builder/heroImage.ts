import type { ImageSlot } from "./imageSlot";
import {
  isPostListLeadVariant,
  lcpCandidates,
  type LcpCandidateViewport,
  type PostListLeadVariant,
} from "./lcpCandidate";
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
// Odmowy dotyczące SAMEGO WIDGETU (para light/dark, logo, wyłączona okładka,
// wariant miniaturowy) rozstrzyga `lcpCandidateKind` - tutaj trafia wyłącznie
// kandydat, więc te reguły nie są powtarzane (jedno miejsce, mniej kodu
// w chunku wejściowym - recenzja P1.4, M3).
//
// TYLKO SERWER (runda poprawek 9). Trasy (`index.tsx`, `$.tsx`) wołają ten
// moduł wyłącznie w gałęzi `isServerRender()` loadera (pilnuje tego test
// źródeł w `lcpCandidate.test.ts`), więc bundel przeglądarki go nie
// zawiera (PROVE P1.4: moduł razem z `lcpCandidate.ts` kosztował chunk
// wejściowy +1,1 KB gzip). Nawigacja SPA nie preloaduje obrazu: render czysto
// kliencki nie ma też kandydata (aboveFold.tsx), więc preload byłby
// priorytetem dla obrazu leniwego.
//
// DOSTĘP: loader liczy kandydatów DLA GOŚCIA (`GUEST_ACCESS_CONTEXT`). Na
// serwerze dokument jest już odarty z węzłów zamkniętych dla gościa, więc
// predykat jest tu bezpiecznikiem: preload nie może wskazać obrazu sekcji
// „tylko dla zalogowanych" (recenzja P1.4, B1).
import type { QueryClient } from "@tanstack/react-query";
import type { BuilderDocument, WidgetContent, WidgetNode } from "@/lib/builder/types";
import type { Lang } from "@/lib/builder/postListQuery";
import { imagePreloadLinkHeaderValue } from "@/lib/seo/meta";
import { lcpImagePreloadKey, type LcpImagePreload } from "@/lib/builder/aboveFold";
import { GUEST_ACCESS_CONTEXT, evaluateAccess } from "@/lib/builder/accessControl";
import { resolveContentEngine, type ContentEngineInput } from "@/lib/content/contentEngine";
import { asNumInRange, asOneOf, asStr } from "@/lib/content-model/contentValue";
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
function preloadOf(href: string, sizes: string): LcpImagePreload | null {
  return href ? { href, imageSrcSet: buildImageSrcSet(href), imageSizes: sizes } : null;
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
): LcpImagePreload | null {
  const c = widget.content;
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
  return preloadOf(firstImage, sizes);
}

/**
 * Widget "image" i dark-featured-card: jednoźródłowy obraz z treści (para
 * light/dark i logo nie są kandydatami - `lcpCandidateKind`).
 */
function contentImagePreload(widget: WidgetNode, slot?: ImageSlot): LcpImagePreload | null {
  const c = widget.content;
  return widget.type === "image"
    ? preloadOf(safeImageUrl(getStr(c, "src")), imageWidgetSizes(c, slot))
    : preloadOf(safeImageUrl(getStr(c, "image")), WIDGET_MEDIA_SPLIT_SIZES);
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
): LcpImagePreload | null {
  const c = widget.content;
  // Karuzela renderuje KAŻDY wariant przez PostCard (overlay/minimal/default
  // card - wszystkie z sizes siatki), więc wariant "classic"/"flex-grid" na
  // karuzeli nadal maluje GRID - preload musi liczyć tę samą wartość.
  // Wariant spoza `POST_LIST_LEAD_VARIANTS` nie jest kandydatem (`lcpCandidateKind`).
  const variant = getStr(c, "variant") || "card";
  const sizes =
    widget.type === "carousel" || !isPostListLeadVariant(variant)
      ? POST_LIST_GRID_COVER_SIZES
      : POST_LIST_LEAD_SIZES[variant];
  const first = queryClient.getQueryData<PostRow[]>(
    postListQueryOptions(c, lang, widget.type).queryKey,
  )?.[0];
  if (!first) return null;
  return preloadOf(
    safeImageUrl(readThumbnailOverrides(c)[first.id] ?? first.cover_image_url ?? ""),
    sizes,
  );
}

/**
 * Media kandydata JEDNEGO urządzenia (recenzja P1.4, m2): granica 768 px to
 * granica reguły `order.mobile` renderera (`@media (max-width: 767px)`).
 */
const LCP_VIEWPORT_MEDIA: Readonly<Record<LcpCandidateViewport, string>> = {
  desktop: "(min-width: 768px)",
  mobile: "(max-width: 767px)",
};

/**
 * Deskryptory preloadu obrazów LCP dokumentu buildera - po jednym na kandydata
 * z `lcpCandidates` (maks. 2, najpierw desktopowy; reguły dostępu GOŚCIA), bez
 * duplikatów. Przy dwóch kandydatach każdy deskryptor niesie `media` swojego
 * urządzenia; ten sam zasób u obu kandydatów to jeden deskryptor bez `media`.
 * Wołać PO rozgrzaniu zapytań widgetów (loader trasy), inaczej tryby danych dadzą
 * pustą listę. Nigdy nie rzuca.
 */
export function builderHeroPreloads(
  doc: BuilderDocument | null | undefined,
  queryClient: QueryClient,
  lang: Lang,
  aboveFoldSections: number = ABOVE_FOLD_SECTION_COUNT,
): LcpImagePreload[] {
  try {
    const out: LcpImagePreload[] = [];
    const candidates = lcpCandidates(safeParseBuilderDoc(doc), {
      sections: aboveFoldSections,
      isAccessible: (rule) => evaluateAccess(rule, GUEST_ACCESS_CONTEXT),
    });
    for (const { widget, slot, viewports } of candidates) {
      // Kandydat bez wyznaczalnego obrazu: brak preloadu, BEZ przejścia do
      // następnego widgetu (ten jest leniwy - preload byłby stratą pasma).
      const preload =
        widget.type === "slider"
          ? sliderPreload(widget, queryClient, lang, slot)
          : widget.type === "image" || widget.type === "dark-featured-card"
            ? contentImagePreload(widget, slot)
            : postListPreload(widget, queryClient, lang);
      if (!preload) continue;
      const key = lcpImagePreloadKey(preload);
      const same = out.findIndex((p) => lcpImagePreloadKey(p) === key);
      // Ten sam zasób u obu kandydatów: jeden preload dla obu urządzeń.
      if (same >= 0) out[same] = preload;
      else
        out.push(
          viewports.length === 1
            ? { ...preload, media: LCP_VIEWPORT_MEDIA[viewports[0]] }
            : preload,
        );
    }
    return out;
  } catch {
    // Preload jest czystą optymalizacją - żaden kształt dokumentu nie może
    // wywrócić loadera trasy.
    return [];
  }
}

/**
 * Preloady kandydatów treści STRONY - tylko gdy treść maluje silnik buildera
 * (`resolveContentEngine`, ta sama decyzja co `ContentRenderer`). Strona
 * w edytorze html/bloków z pozostałym `builder_data` nie dostaje preloadu
 * obrazu, którego nikt nie namaluje (recenzja P1.4, m7).
 */
export function builderContentHeroPreloads(
  content: ContentEngineInput,
  queryClient: QueryClient,
  lang: Lang,
): LcpImagePreload[] {
  return resolveContentEngine(content) === "builder"
    ? builderHeroPreloads(content.builderDoc, queryClient, lang)
    : [];
}

/** Wartość nagłówka `Link` dla preloadu kandydata - z `media` kandydata jednego urządzenia. */
export function lcpPreloadLinkHeaderValue(input: LcpImagePreload): string {
  const value = imagePreloadLinkHeaderValue(input);
  return input.media ? `${value}; media="${input.media}"` : value;
}
