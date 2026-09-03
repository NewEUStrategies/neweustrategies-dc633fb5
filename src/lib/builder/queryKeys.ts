// Kanoniczne korzenie kluczy react-query dla widgetów buildera.
//
// PROBLEM, KTÓRY TEN MODUŁ LIKWIDUJE
// Lista `WIDGET_LIVE_QUERY_PREFIXES` (inwalidacja realtime + sygnał między
// kartami) była utrzymywana ręcznie, jako zbiór literałów stringowych
// niezależny od literałów użytych w `queryKey`. Rozjazd nazw był niewidoczny:
// `invalidateQueries` po prostu nie trafiał w żadne zapytanie i nic nie
// sygnalizowało błędu. Sześć widgetów (post-list, carousel, news-ticker,
// rated-list, categories, tags) nie odświeżało się po zmianie treści w bazie.
//
// Rozwiązanie: JEDEN literał na zapytanie, importowany zarówno przez moduł
// zapytania, jak i przez zbiór inwalidacji. Rozjazd staje się niewyrażalny -
// nie da się zarejestrować do inwalidacji korzenia, który nie istnieje, bo
// obie strony sięgają po tę samą stałą.
//
// Dodawanie nowego zapytania widgetowego:
//   1. dopisz korzeń do `WIDGET_QUERY_ROOTS`,
//   2. użyj go w `queryKey: [WIDGET_QUERY_ROOTS.mojeZapytanie, input]`,
//   3. jeśli zapytanie zależy od treści redakcyjnej (posty/strony/taksonomie),
//      dopisz je do `LIVE_INVALIDATED_ROOTS`.
// Test `queryKeys.test.ts` pilnuje spójności obu zbiorów.

/**
 * Wszystkie korzenie kluczy zapytań używane przez widgety buildera.
 *
 * Wartości są celowo takie same jak historyczne literały - zmiana napisu
 * unieważniłaby cache SSR i zdehydratowane dane w locie podczas wdrożenia.
 */
export const WIDGET_QUERY_ROOTS = {
  // --- referencje encji (contentRefs.ts) ---
  postRef: "post-ref",
  pageRef: "page-ref",
  categoryRef: "category-ref",
  tagRef: "tag-ref",

  // --- listy treści ---
  postList: "builder-post-list",
  newsTicker: "builder-news-ticker",
  ratedList: "rated-list-dyn",
  categories: "builder-cats",
  tags: "builder-tags",
  // Kluby dyskusyjne (spec §5.5): karta klubu i strumień wątków ponad klubami.
  clubCard: "builder-club-card",
  clubThreads: "builder-club-threads",
  // Widget „Klub: strona" - trzy sekcje jednego klubu (artykuły/komentarze/zapisy).
  clubHubArticles: "builder-club-hub-articles",
  clubHubComments: "builder-club-hub-comments",
  clubHubMembers: "builder-club-hub-members",
  sliderPosts: "builder-slider-posts",
  sliderFallbackImages: "builder-slider-fallback-images",
  recommendedPosts: "recommended-posts",
  postViewCount: "post-view-count",

  // --- widgety globalne / popupy ---
  globalWidget: "global-widget",
  globalWidgets: "global-widgets",
  globalWidgetMeta: "global-widget-meta",
  popupsActive: "builder-popups-active",

  // --- ekosystem wydarzeń ---
  eventList: "builder-event-list",
  eventById: "builder-event-by-id",
  eventRsvpCounts: "builder-event-rsvp-counts",
  speakers: "builder-speakers",
  speakersByIds: "builder-speakers-by-ids",
  publicSpeakerProfile: "public-speaker-profile",
  publicSpeakerEngagements: "public-speaker-engagements",
  meetingSlots: "builder-meeting-slots",
} as const satisfies Readonly<Record<string, string>>;

export type WidgetQueryRoot = (typeof WIDGET_QUERY_ROOTS)[keyof typeof WIDGET_QUERY_ROOTS];

/**
 * Korzenie, które muszą zostać unieważnione, gdy zmieni się treść redakcyjna
 * (posty / strony / kategorie / tagi / widgety globalne / popupy).
 *
 * Zapytania niezależne od treści (np. sloty spotkań, które mają własną,
 * krótką świeżość i własną inwalidację po mutacji) świadomie NIE są tu
 * wymienione - globalne unieważnianie ich tylko generowałoby ruch.
 */
export const LIVE_INVALIDATED_ROOTS: ReadonlyArray<WidgetQueryRoot> = [
  WIDGET_QUERY_ROOTS.postRef,
  // UWAGA: pageRef / categoryRef / tagRef sa CELOWO nieobecne - zaden resolver
  // nie wystawia jeszcze zapytania o tych korzeniach (tylko postRef istnieje w
  // contentRefs.ts), wiec ich rejestracja byla martwa: `invalidateQueries` nie
  // trafial w nic, a lista sugerowala pokrycie, ktorego nie bylo. Dopisz je
  // TUTAJ w tym samym commicie, w ktorym powstanie realne zapytanie.
  // Pilnuje tego test `__tests__/queryKeys.test.ts`.
  WIDGET_QUERY_ROOTS.postList,
  WIDGET_QUERY_ROOTS.newsTicker,
  WIDGET_QUERY_ROOTS.ratedList,
  WIDGET_QUERY_ROOTS.categories,
  WIDGET_QUERY_ROOTS.tags,
  WIDGET_QUERY_ROOTS.sliderPosts,
  // Czyta okladki opublikowanych wpisow, wiec publikacja lub zmiana okladki
  // musi je odswiezyc - inaczej slider bez wlasnych zdjec trzyma stary zestaw.
  WIDGET_QUERY_ROOTS.sliderFallbackImages,
  WIDGET_QUERY_ROOTS.recommendedPosts,
  WIDGET_QUERY_ROOTS.globalWidget,
  WIDGET_QUERY_ROOTS.globalWidgets,
  WIDGET_QUERY_ROOTS.globalWidgetMeta,
  WIDGET_QUERY_ROOTS.popupsActive,
  WIDGET_QUERY_ROOTS.eventList,
  WIDGET_QUERY_ROOTS.eventById,
  WIDGET_QUERY_ROOTS.eventRsvpCounts,
  WIDGET_QUERY_ROOTS.speakers,
  WIDGET_QUERY_ROOTS.speakersByIds,
  WIDGET_QUERY_ROOTS.publicSpeakerProfile,
  WIDGET_QUERY_ROOTS.publicSpeakerEngagements,
];

/** Zbiór do szybkiego `has()` w predykacie `invalidateQueries`. */
export const WIDGET_LIVE_QUERY_PREFIXES: ReadonlySet<string> = new Set(LIVE_INVALIDATED_ROOTS);
