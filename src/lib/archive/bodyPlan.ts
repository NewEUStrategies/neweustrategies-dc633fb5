// Reguły układu archiwum - wyprowadzone z `components/archive/layouts/ArchiveBody.tsx`
// i z wariantu magazynowego.
//
// DLACZEGO OSOBNY MODUŁ. Archiwa kategorii i tagów to druga najczęściej
// odwiedzana powierzchnia serwisu po wpisach, a 13 z 16 jej plików stało na
// zerze. Decyzje układu (czy wchodzi karta wyróżniona, ILE kart zostaje na
// siatkę, czy pokazujemy pasek stron, czy sidebar idzie z lewej) mieszkały
// w ciele komponentu obok reklam in-feed, slide-upu stopki i zapytań do bazy -
// więc sprawdzenie „czy przy jednej stronie wyników nie ma paska stron"
// wymagało wyrenderowania całego archiwum razem z Supabase.
//
// Moduł zwraca WYŁĄCZNIE decyzje i dane. Żadnych napisów.
import type { ArchiveLayoutSettings } from "@/lib/archive-layout-settings";

/** Liczba kart w kolumnie pomocniczej wariantu magazynowego. */
export const MAGAZINE_SECONDARY_COUNT = 4;

export interface ArchiveBodyInput<TPost> {
  settings: Pick<
    ArchiveLayoutSettings,
    "show_sidebar" | "sidebar_position" | "show_featured_top" | "show_related_taxonomies"
  >;
  posts: readonly TPost[];
  total: number;
  pageSize: number;
  /** Wariant renderuje własną kartę wyróżnioną (magazyn) - generyczna odpada. */
  hasCustomFeaturedTop?: boolean;
  /** Podgląd w panelu admina: bez reklam, bez slide-upu, kontrolki zablokowane. */
  previewMode?: boolean;
}

export interface ArchiveBodyPlan<TPost> {
  /** Karta wyróżniona nad siatką (pierwszy wpis strony). */
  featured: TPost | undefined;
  showFeaturedTop: boolean;
  /** Wpisy, które zostają na siatkę PO odjęciu karty wyróżnionej. */
  gridPosts: readonly TPost[];
  totalPages: number;
  showPagination: boolean;
  withSidebar: boolean;
  sidebarLeft: boolean;
  showRelated: boolean;
  /** Reklamy in-feed i slide-up stopki - wyłączone w podglądzie admina. */
  withAds: boolean;
  /**
   * Pierwsza karta siatki jako kandydat LCP. Tylko wtedy, gdy NAD siatką nie ma
   * żadnej karty wyróżnionej (ani generycznej, ani własnej wariantu) - inaczej
   * dwa obrazy walczyłyby o priorytet i przegrałby ten właściwy.
   */
  firstCardPriority: boolean;
}

/**
 * Liczba stron wyników. Zawsze co najmniej 1: archiwum bez wpisów ma jedną
 * (pustą) stronę, a nie zero - inaczej pasek stron liczyłby „stronę 1 z 0".
 */
export function archiveTotalPages(total: number, pageSize: number): number {
  if (!Number.isFinite(total) || !Number.isFinite(pageSize) || pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(Math.max(0, total) / pageSize));
}

export function archiveBodyPlan<TPost>(input: ArchiveBodyInput<TPost>): ArchiveBodyPlan<TPost> {
  const { settings, posts, total, pageSize, hasCustomFeaturedTop, previewMode } = input;
  const featured = posts[0];
  const showFeaturedTop = Boolean(settings.show_featured_top && !hasCustomFeaturedTop && featured);
  const totalPages = archiveTotalPages(total, pageSize);
  return {
    featured,
    showFeaturedTop,
    gridPosts: showFeaturedTop ? posts.slice(1) : posts,
    totalPages,
    showPagination: totalPages > 1,
    withSidebar: Boolean(settings.show_sidebar),
    sidebarLeft: settings.sidebar_position === "left",
    showRelated: Boolean(settings.show_related_taxonomies),
    withAds: !previewMode,
    firstCardPriority: !showFeaturedTop && !hasCustomFeaturedTop,
  };
}

export interface MagazineSplit<TPost> {
  /** Lead magazynowy - kandydat LCP strony. */
  featured: TPost | undefined;
  /** Kolumna pomocnicza obok leadu (do czterech kart). */
  secondary: readonly TPost[];
  /** Reszta idzie do zwykłej siatki pod spodem. */
  rest: readonly TPost[];
  showFeatured: boolean;
}

/**
 * Podział wpisów w wariancie magazynowym: lead + cztery karty obok + reszta.
 *
 * Gdy karta wyróżniona jest wyłączona w ustawieniach albo strona jest pusta,
 * wszystkie wpisy idą do siatki - inaczej pierwsze pięć znikałoby bez śladu.
 */
export function magazineSplit<TPost>(
  posts: readonly TPost[],
  showFeaturedTop: boolean,
): MagazineSplit<TPost> {
  const [featured, ...rest] = posts;
  const showFeatured = Boolean(showFeaturedTop && featured);
  if (!showFeatured) {
    return { featured: undefined, secondary: [], rest: posts, showFeatured: false };
  }
  return {
    featured,
    secondary: rest.slice(0, MAGAZINE_SECONDARY_COUNT),
    rest: rest.slice(MAGAZINE_SECONDARY_COUNT),
    showFeatured: true,
  };
}
