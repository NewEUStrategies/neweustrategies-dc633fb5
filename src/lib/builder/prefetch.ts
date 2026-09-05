import type { FetchQueryOptions, QueryClient, QueryKey } from "@tanstack/react-query";
import type {
  BuilderDocument,
  SectionChild,
  SectionNode,
  WidgetContent,
  WidgetNode,
} from "@/lib/builder/types";
import type { Lang } from "@/lib/builder/postListQuery";
import { postListQueryOptions } from "@/lib/builder/postListQuery";
import { menuWithItemsQueryOptions } from "@/lib/menus/queries";
import { newsTickerQueryOptions } from "@/lib/builder/newsTickerQuery";
import { postRefQueryOptions } from "@/lib/builder/contentRefs";
// Z sliderFallbackQuery (nie sliderVariants): prefetch trafia do bundla
// loadera każdej trasy i nie może ciągnąć całego renderera sliderów.
import { sliderFallbackImagesQueryOptions } from "@/lib/builder/sliderFallbackQuery";
import {
  sliderPostsLimit,
  sliderPostsQueryOptions,
  sliderUsesPostsSource,
  type SliderPostRow,
} from "@/lib/builder/sliderPostsQuery";
import { sliderAuthorIds, sliderAuthorsQueryOptions } from "@/lib/builder/sliderAuthorsQuery";
import { eventByIdQueryOptions, eventsListQueryOptions } from "@/lib/builder/eventsQuery";
import { clubCardQueryOptions, clubThreadsQueryOptions } from "@/lib/builder/clubsQuery";
import { categoriesQueryOptions, tagsQueryOptions } from "@/lib/builder/taxonomyQuery";
import {
  podcastLatestQueryOptions,
  webStoriesCarouselQueryOptions,
} from "@/lib/builder/mediaListQuery";
// Cennik przez cienki moduł w lib/builder, nie wprost z lib/billing: uzasadnienie
// kosztu bootu (krawędź do `billing/queries` JUŻ jest w chunku wejściowym,
// wciągnięta przez loadery /pricing, /membership-join i /plans/$planId) stoi
// w nagłówku `pricingPlansQuery.ts` - razem z pomiarem, na którym się opiera.
import { activePlansQueryOptions, pricingUsesPlansSource } from "@/lib/builder/pricingPlansQuery";
import { ratedListQueryOptions, ratedListUsesDynamicSource } from "@/lib/builder/ratedListQuery";
import {
  speakersByIdsQueryOptions,
  speakersQueryOptions,
  speakersSource,
} from "@/lib/builder/speakersQuery";
import { worldMapProfileIds } from "@/lib/builder/worldMapContent";
import { collectProfileSpeakerIds, parseScheduleDays } from "@/lib/events/schedule";
import { safeParseBuilderDoc } from "@/lib/builder/schema";

/** A single cache target for a widget: its query key + matching stale-time. */
export interface WidgetCacheTarget {
  key: QueryKey;
  staleTime: number;
}

function isWidget(node: SectionChild | WidgetNode): node is WidgetNode {
  return !!node && node.kind === "widget";
}

function collectWidgetsFromChild(child: SectionChild | null | undefined, out: WidgetNode[]) {
  if (!child) return;
  if (child.kind === "column") {
    (child.children ?? []).forEach((node) => {
      if (node) out.push(node);
    });
    return;
  }
  (child.columns ?? []).forEach((column) =>
    (column?.children ?? []).forEach((node) => {
      if (node) out.push(node);
    }),
  );
}

export function collectSectionWidgets(section: SectionNode): WidgetNode[] {
  const widgets: WidgetNode[] = [];
  (Array.isArray(section?.children) ? section.children : []).forEach((child) =>
    collectWidgetsFromChild(child, widgets),
  );
  return widgets.filter(isWidget);
}

export function collectBuilderWidgets(doc: BuilderDocument): WidgetNode[] {
  const safeDoc = safeParseBuilderDoc(doc);
  const widgets: WidgetNode[] = [];
  safeDoc.sections.forEach((section) =>
    collectSectionWidgets(section).forEach((w) => widgets.push(w)),
  );
  return widgets;
}

/**
 * Widgety odliczania czytajace wydarzenie po id (eventByIdQueryOptions).
 * "event-countdown-card" dlugo brakowalo na tej liscie, wiec premium karta w
 * trybie "event" nie miala prefetchu SSR: serwer renderowal placeholdery, a
 * tytul/okladka/data wskakiwaly dopiero po hydratacji i osobnym fetchu.
 */
const COUNTDOWN_WIDGET_TYPES: ReadonlySet<string> = new Set([
  "event-countdown",
  "event-countdown-card",
]);

function isCountdownWidget(widget: WidgetNode): boolean {
  return COUNTDOWN_WIDGET_TYPES.has(widget.type);
}

/** Id wydarzenia dla widgetu odliczania w trybie "event" (inaczej pusty string). */
function countdownEventId(c: WidgetContent): string {
  const mode = typeof c.mode === "string" ? c.mode : "custom";
  const eventId = typeof c.eventId === "string" ? c.eventId : "";
  return mode === "event" ? eventId : "";
}

function contentItems(c: WidgetContent): Record<string, unknown>[] {
  const raw = c.items;
  if (!Array.isArray(raw)) return [];
  const items: Record<string, unknown>[] = [];
  raw.forEach((item: unknown) => {
    if (typeof item === "object" && item !== null && !Array.isArray(item)) {
      items.push(item as Record<string, unknown>);
    }
  });
  return items;
}

/** Adres klubu z treści widgetu. Pusty = widget nieskonfigurowany, bez zapytania. */
function clubWidgetSlug(content: unknown): string {
  const raw = (content as { clubSlug?: unknown } | undefined)?.clubSlug;
  return typeof raw === "string" ? raw.trim() : "";
}

/** Wejście strumienia wątków - te same wartości domyślne, co w widoku widgetu. */
function clubThreadsInput(content: unknown): { sort: string; policyArea: string; limit: number } {
  const c = content as { sort?: unknown; policyArea?: unknown; limit?: unknown } | undefined;
  return {
    sort: typeof c?.sort === "string" ? c.sort : "hot",
    policyArea: typeof c?.policyArea === "string" ? c.policyArea : "",
    limit: typeof c?.limit === "number" ? c.limit : 4,
  };
}

/**
 * Every concrete query-options shape a data-bound builder widget can produce.
 * The union is precise (no `any`) so a value carries a strongly-typed
 * `queryKey`, which is what the Suspense-streaming gate inspects via
 * `getQueryState` to observe the EXACT cache entries the widgets read - the key
 * to streamed sections never re-fetching after hydration.
 */
export type BuilderSectionQuery =
  | ReturnType<typeof postListQueryOptions>
  | ReturnType<typeof newsTickerQueryOptions>
  | ReturnType<typeof postRefQueryOptions>
  | ReturnType<typeof categoriesQueryOptions>
  | ReturnType<typeof tagsQueryOptions>
  | ReturnType<typeof podcastLatestQueryOptions>
  | ReturnType<typeof webStoriesCarouselQueryOptions>
  | ReturnType<typeof activePlansQueryOptions>
  | ReturnType<typeof ratedListQueryOptions>
  | ReturnType<typeof sliderFallbackImagesQueryOptions>
  | ReturnType<typeof sliderPostsQueryOptions>
  | ReturnType<typeof menuWithItemsQueryOptions>
  | ReturnType<typeof eventsListQueryOptions>
  | ReturnType<typeof eventByIdQueryOptions>
  | ReturnType<typeof speakersQueryOptions>
  | ReturnType<typeof speakersByIdsQueryOptions>
  | ReturnType<typeof clubCardQueryOptions>
  | ReturnType<typeof clubThreadsQueryOptions>;

/**
 * Warm one builder query. BuilderSectionQuery is a union of three differently
 * parameterized option objects, so `prefetchQuery` cannot infer a single generic
 * instantiation across the union. Widening to the base FetchQueryOptions shape
 * is sound here: every builder query function takes no arguments, so the cache
 * payload type is irrelevant to prefetching - only the (runtime-intact)
 * queryKey/queryFn/staleTime drive the fetch. Centralizing the widening in one
 * helper keeps the cast out of every call site.
 */
export function prefetchBuilderSectionQuery(
  queryClient: QueryClient,
  options: BuilderSectionQuery,
): Promise<void> {
  return queryClient.prefetchQuery(options as FetchQueryOptions);
}

/**
 * The data-bound query options a single widget feeds (post-list / carousel ->
 * one list query; slider -> one ref per referenced post + one fallback-images
 * query). Single source of truth shared by prefetch and the streaming gate, so
 * the two can never drift apart on which queries back a widget.
 *
 * DWA WARUNKI, KTÓRYCH NIE PILNUJE KOMPILATOR - oba zamykają awarie CICHE:
 *  1. KLUCZ MUSI BYĆ DOKŁADNIE TEN, KTÓRY CZYTA WIDOK. Klucz rozjechany choćby
 *     o koercję liczby daje rozgrzany wpis, w który widget nigdy nie trafia:
 *     SSR zostaje pusty, nic nie zgłasza błędu, a klient płaci drugie
 *     zapytanie. Dlatego każda gałąź woła TĘ SAMĄ fabrykę, po którą sięga
 *     widok (albo helper, który liczy wejście do klucza w jednym miejscu).
 *  2. KAŻDA GAŁĄŹ MUSI MIEĆ ODBICIE W {@link widgetCacheTargets}. Tamta
 *     funkcja zasila bramkę SWR `useSectionPreload.isSectionFresh`, która na
 *     liście DŁUGOŚCI ZERO zwraca "świeże" - brak odbicia po cichu wyłącza
 *     klientowy prefetch przy przewijaniu dla całej sekcji.
 */
export function widgetQueryOptionsList(widget: WidgetNode, lang: Lang): BuilderSectionQuery[] {
  const out: BuilderSectionQuery[] = [];
  // Nawigacja (widget "menu" w chrome i dokumentach buildera): bez SSR-owego
  // prefetchu serwer renderował fallback "Menu jest puste..." mimo
  // skonfigurowanego menu, a prawdziwa nawigacja wskakiwała dopiero po
  // hydratacji + fetchu (długo widoczny brak menu + przesunięcie układu).
  if (widget.type === "menu") {
    const rawKey = (widget.content as { menu_key?: unknown } | undefined)?.menu_key;
    const key = typeof rawKey === "string" && rawKey.length > 0 ? rawKey : "main";
    out.push(menuWithItemsQueryOptions(key));
  }
  if (widget.type === "post-list" || widget.type === "carousel") {
    out.push(postListQueryOptions(widget.content, lang));
  }
  if (widget.type === "news-ticker" || widget.type === "trending-now") {
    out.push(newsTickerQueryOptions(widget.content, lang));
  }
  // Taksonomie: zapytania siedziały WPROST w widokach, więc rejestr ich nie
  // widział - sekcja z samymi chipami miała pustą listę zapytań, liczyła się
  // jako statyczna (`shouldStreamSection`) i wychodziła z serwera pusta.
  // Zapytania nie mają wejścia z treści: jeden klucz na cały dokument, więc
  // kilka takich widgetów dzieli jeden wpis cache i jedno rozgrzanie.
  if (widget.type === "categories") {
    out.push(categoriesQueryOptions());
  }
  if (widget.type === "tags") {
    out.push(tagsQueryOptions());
  }
  if (widget.type === "event-list") {
    out.push(eventsListQueryOptions(widget.content, lang));
  }
  // Kluby: bez rozgrzania widget na stronie głównej renderuje pustkę w HTML-u
  // i dociąga treść dopiero po hydratacji - czyli dokładnie tam, gdzie ma
  // przyciągać uwagę, przez chwilę nie ma nic.
  if (widget.type === "club-card") {
    const slug = clubWidgetSlug(widget.content);
    if (slug !== "") out.push(clubCardQueryOptions(slug));
  }
  if (widget.type === "club-threads") {
    out.push(clubThreadsQueryOptions(clubThreadsInput(widget.content)));
  }
  // `club-hub` grzeje TYLKO naglowek klubu: listy sekcji zaleza od identyfikatora,
  // ktory poznajemy dopiero z odpowiedzi `club_view`, wiec ich prefetch
  // wymagalby drugiej rundy zapytan po stronie serwera.
  if (widget.type === "club-hub") {
    const slug = clubWidgetSlug(widget.content);
    if (slug !== "") out.push(clubCardQueryOptions(slug));
  }
  // Podcast i Web Stories: fabryki zapytań były gotowe i już grzane serwerowo
  // w loaderach `/podcasts` i `/web-stories`, brakowało TYLKO wpisu w rejestrze
  // widgetów. Bez niego karta odcinka i kafelek historii wychodziły z SSR jako
  // stan `isLoading` („…") i doskakiwały po hydratacji razem z okładką - czyli
  // wewnątrz obszaru LCP na stronach z tymi sekcjami.
  if (widget.type === "podcast-latest") {
    out.push(podcastLatestQueryOptions(widget.content));
  }
  if (widget.type === "web-stories-carousel") {
    out.push(webStoriesCarouselQueryOptions(widget.content));
  }
  // Cennik zsynchronizowany z katalogiem: zapytanie ma WYŁĄCZNIE tryb "plans"
  // (tryb domyślny renderuje ręczne wartości z treści widgetu i danych nie
  // czyta), stąd bramka na źródło - precedens stylu to gałąź `speakers` niżej.
  if (widget.type === "pricing" && pricingUsesPlansSource(widget.content)) {
    out.push(activePlansQueryOptions());
  }
  // Lista oceniana/rankingowa w trybie dynamicznym. Klucz i `queryFn` stały
  // WPROST w `RatedListView.tsx` (12 pól wejścia + ~135 linii zapytania), więc
  // rejestr tego typu nie widział: siatka wychodziła z serwera bez wierszy
  // (same numery tła), a tytuły i byline doskakiwały po hydratacji. Zapytanie
  // przeniesiono do `ratedListQuery.ts`, więc widok i rejestr czytają JEDNĄ
  // fabrykę - rozjazd klucza jest niewyrażalny. Tryb `manual` renderuje
  // pozycje z treści widgetu i danych nie czyta, stąd bramka źródła.
  if (widget.type === "rated-list" && ratedListUsesDynamicSource(widget.content)) {
    out.push(ratedListQueryOptions(widget.content, lang));
  }
  if (isCountdownWidget(widget)) {
    const eventId = countdownEventId(widget.content);
    if (eventId) out.push(eventByIdQueryOptions(eventId));
  }
  if (widget.type === "speakers" && speakersSource(widget.content) !== "manual") {
    out.push(speakersQueryOptions(widget.content, lang));
  }
  if (widget.type === "event-schedule") {
    const ids = collectProfileSpeakerIds(parseScheduleDays(widget.content));
    if (ids.length > 0) out.push(speakersByIdsQueryOptions(ids));
  }
  // Mapa świata w trybie eksperckim: bez rozgrzania serwer narysowałby łuki
  // z zapasowymi etykietami, a żywe imiona wskoczyłyby dopiero po hydratacji.
  if (widget.type === "world-map") {
    const ids = worldMapProfileIds(widget.content);
    if (ids.length > 0) out.push(speakersByIdsQueryOptions(ids));
  }
  if (widget.type === "slider") {
    const items = contentItems(widget.content);
    if (sliderUsesPostsSource(widget.content)) {
      // Posts-sourced slider (the homepage hero): one list query feeds the
      // slides; the fallback-images count mirrors SliderRender's
      // `Math.max(3, items.length)` for a full result.
      out.push(sliderPostsQueryOptions(widget.content, lang));
      out.push(sliderFallbackImagesQueryOptions(Math.max(3, sliderPostsLimit(widget.content))));
    } else {
      const postIds = Array.from(
        new Set(
          items
            .map((item) => item.postId)
            .filter((id): id is string => typeof id === "string" && id.length > 0),
        ),
      );
      postIds.forEach((id) => out.push(postRefQueryOptions(id, lang)));
      out.push(sliderFallbackImagesQueryOptions(Math.max(3, items.length || 3)));
    }
  }
  return out;
}

/** Flatten every data-bound query a section's widgets feed into one list. */
export function sectionQueryOptionsList(section: SectionNode, lang: Lang): BuilderSectionQuery[] {
  return collectSectionWidgets(section).flatMap((widget) => widgetQueryOptionsList(widget, lang));
}

/**
 * The subset of a section's data queries that have NOT yet settled - i.e. there
 * is no cache entry, or the entry is still in its initial `pending` fetch. A
 * query that resolved OR errored counts as settled: the widget renders its own
 * data / empty / error state from there, so the streaming gate only ever waits
 * on genuinely-unresolved data and never blocks a section on a failed query.
 *
 * Pure (no React, no side effects) so the streaming gate's suspend decision is
 * unit-testable without rendering.
 */
export function pendingSectionQueries(
  queryClient: QueryClient,
  section: SectionNode,
  lang: Lang,
): BuilderSectionQuery[] {
  return sectionQueryOptionsList(section, lang).filter((options) => {
    const status = queryClient.getQueryState(options.queryKey)?.status;
    return status !== "success" && status !== "error";
  });
}

/**
 * Prefetch all data-bound queries for a set of widgets.
 * Reused by both whole-document prefetch (SSR/loader) and per-section
 * lazy prefetch driven by IntersectionObserver.
 */
async function prefetchWidgets(
  queryClient: QueryClient,
  widgets: WidgetNode[],
  lang: Lang,
): Promise<void> {
  // Guard against sync throws in query-options builders or the prefetch call
  // itself: any escape here would bubble up through the SSR loader and
  // corrupt the dehydrated $_TSR.router payload (client would then blank).
  const tasks: Promise<unknown>[] = [];
  for (const widget of widgets) {
    let optionsList: ReturnType<typeof widgetQueryOptionsList> = [];
    try {
      optionsList = widgetQueryOptionsList(widget, lang);
    } catch {
      continue;
    }
    for (const options of optionsList) {
      try {
        tasks.push(
          Promise.resolve(prefetchBuilderSectionQuery(queryClient, options)).catch(() => undefined),
        );
      } catch {
        /* swallow - a broken single widget must never fail the whole prefetch */
      }
    }
    // Byline slidera (autorzy slajdów) ZALEŻY od wyniku zapytania o wpisy -
    // rejestr statyczny nie może jej wyrazić, więc rozgrzewamy ją łańcuchem:
    // po rozstrzygnięciu wpisów wyprowadzamy identyczną listę id co widget
    // (sliderAuthorIds - kolejność jest częścią klucza) i grzejemy dokładnie
    // ten wpis cache, który odczyta PostsSliderWidget. Bez tego hero wychodził
    // z SSR bez nazwiska i awatara autora, a byline doskakiwała po hydratacji
    // wewnątrz obszaru LCP.
    if (widget.type === "slider" && sliderUsesPostsSource(widget.content)) {
      try {
        const postsOptions = sliderPostsQueryOptions(widget.content, lang);
        tasks.push(
          Promise.resolve(prefetchBuilderSectionQuery(queryClient, postsOptions))
            .then(() => {
              const rows = queryClient.getQueryData<SliderPostRow[]>(postsOptions.queryKey);
              const ids = sliderAuthorIds(rows);
              if (ids.length === 0) return undefined;
              return queryClient.prefetchQuery(sliderAuthorsQueryOptions(ids));
            })
            .catch(() => undefined),
        );
      } catch {
        /* jw. - best-effort */
      }
    }
  }
  await Promise.allSettled(tasks);
}

export async function prefetchSectionQueries(
  queryClient: QueryClient,
  section: SectionNode,
  lang: Lang,
): Promise<void> {
  await prefetchWidgets(queryClient, collectSectionWidgets(section), lang);
}

/**
 * Enumerate the cache targets (query key + stale-time) covered by a widget.
 * Used by the SWR gate in useSectionPreload to decide whether a prefetch is
 * even necessary.
 */
function coerceStaleTime(st: unknown): number {
  return typeof st === "number" ? st : 0;
}

export function widgetCacheTargets(widget: WidgetNode, lang: Lang): WidgetCacheTarget[] {
  const out: WidgetCacheTarget[] = [];
  if (widget.type === "menu") {
    const rawKey = (widget.content as { menu_key?: unknown } | undefined)?.menu_key;
    const key = typeof rawKey === "string" && rawKey.length > 0 ? rawKey : "main";
    const opts = menuWithItemsQueryOptions(key);
    out.push({ key: opts.queryKey, staleTime: coerceStaleTime(opts.staleTime) });
  }
  if (widget.type === "post-list" || widget.type === "carousel") {
    const opts = postListQueryOptions(widget.content, lang);
    out.push({ key: opts.queryKey, staleTime: coerceStaleTime(opts.staleTime) });
  }
  if (widget.type === "news-ticker" || widget.type === "trending-now") {
    const opts = newsTickerQueryOptions(widget.content, lang);
    out.push({ key: opts.queryKey, staleTime: coerceStaleTime(opts.staleTime) });
  }
  if (widget.type === "categories") {
    const opts = categoriesQueryOptions();
    out.push({ key: opts.queryKey, staleTime: coerceStaleTime(opts.staleTime) });
  }
  if (widget.type === "tags") {
    const opts = tagsQueryOptions();
    out.push({ key: opts.queryKey, staleTime: coerceStaleTime(opts.staleTime) });
  }
  if (widget.type === "event-list") {
    const opts = eventsListQueryOptions(widget.content, lang);
    out.push({ key: opts.queryKey, staleTime: coerceStaleTime(opts.staleTime) });
  }
  if (widget.type === "club-card") {
    const slug = clubWidgetSlug(widget.content);
    if (slug !== "") {
      const opts = clubCardQueryOptions(slug);
      out.push({ key: opts.queryKey, staleTime: coerceStaleTime(opts.staleTime) });
    }
  }
  if (widget.type === "club-threads") {
    const opts = clubThreadsQueryOptions(clubThreadsInput(widget.content));
    out.push({ key: opts.queryKey, staleTime: coerceStaleTime(opts.staleTime) });
  }
  if (widget.type === "club-hub") {
    const slug = clubWidgetSlug(widget.content);
    if (slug !== "") {
      const opts = clubCardQueryOptions(slug);
      out.push({ key: opts.queryKey, staleTime: coerceStaleTime(opts.staleTime) });
    }
  }
  if (widget.type === "podcast-latest") {
    const opts = podcastLatestQueryOptions(widget.content);
    out.push({ key: opts.queryKey, staleTime: coerceStaleTime(opts.staleTime) });
  }
  if (widget.type === "web-stories-carousel") {
    const opts = webStoriesCarouselQueryOptions(widget.content);
    out.push({ key: opts.queryKey, staleTime: coerceStaleTime(opts.staleTime) });
  }
  if (widget.type === "pricing" && pricingUsesPlansSource(widget.content)) {
    const opts = activePlansQueryOptions();
    out.push({ key: opts.queryKey, staleTime: coerceStaleTime(opts.staleTime) });
  }
  if (widget.type === "rated-list" && ratedListUsesDynamicSource(widget.content)) {
    const opts = ratedListQueryOptions(widget.content, lang);
    out.push({ key: opts.queryKey, staleTime: coerceStaleTime(opts.staleTime) });
  }
  if (isCountdownWidget(widget)) {
    const eventId = countdownEventId(widget.content);
    if (eventId) {
      const opts = eventByIdQueryOptions(eventId);
      out.push({ key: opts.queryKey, staleTime: coerceStaleTime(opts.staleTime) });
    }
  }
  if (widget.type === "speakers" && speakersSource(widget.content) !== "manual") {
    const opts = speakersQueryOptions(widget.content, lang);
    out.push({ key: opts.queryKey, staleTime: coerceStaleTime(opts.staleTime) });
  }
  if (widget.type === "event-schedule") {
    const ids = collectProfileSpeakerIds(parseScheduleDays(widget.content));
    if (ids.length > 0) {
      const opts = speakersByIdsQueryOptions(ids);
      out.push({ key: opts.queryKey, staleTime: coerceStaleTime(opts.staleTime) });
    }
  }
  if (widget.type === "world-map") {
    const ids = worldMapProfileIds(widget.content);
    if (ids.length > 0) {
      const opts = speakersByIdsQueryOptions(ids);
      out.push({ key: opts.queryKey, staleTime: coerceStaleTime(opts.staleTime) });
    }
  }
  if (widget.type === "slider") {
    const items = contentItems(widget.content);
    if (sliderUsesPostsSource(widget.content)) {
      const postsOpts = sliderPostsQueryOptions(widget.content, lang);
      out.push({ key: postsOpts.queryKey, staleTime: coerceStaleTime(postsOpts.staleTime) });
      const fallbackOpts = sliderFallbackImagesQueryOptions(
        Math.max(3, sliderPostsLimit(widget.content)),
      );
      out.push({ key: fallbackOpts.queryKey, staleTime: coerceStaleTime(fallbackOpts.staleTime) });
      return out;
    }
    const postIds = Array.from(
      new Set(
        items
          .map((item) => item.postId)
          .filter((id): id is string => typeof id === "string" && id.length > 0),
      ),
    );
    postIds.forEach((id) => {
      const opts = postRefQueryOptions(id, lang);
      out.push({ key: opts.queryKey, staleTime: coerceStaleTime(opts.staleTime) });
    });
    const opts = sliderFallbackImagesQueryOptions(Math.max(3, items.length || 3));
    out.push({ key: opts.queryKey, staleTime: coerceStaleTime(opts.staleTime) });
  }
  return out;
}

/** Aggregate cache targets across all widgets in a list (e.g. one section). */
export function sectionCacheTargets(widgets: WidgetNode[], lang: Lang): WidgetCacheTarget[] {
  return widgets.flatMap((w) => widgetCacheTargets(w, lang));
}

export async function prefetchBuilderDocumentQueries(
  queryClient: QueryClient,
  doc: BuilderDocument,
  lang: Lang,
): Promise<void> {
  await prefetchWidgets(queryClient, collectBuilderWidgets(doc), lang);
}

/**
 * How many leading sections a route loader prefetches on the server. The rest
 * stream in lazily on the client via `useSectionPreload` (IntersectionObserver
 * with a 1200px lookahead), so they are usually warm before the reader scrolls
 * to them. Three covers a hero plus the first content rows on every breakpoint;
 * bump it if a layout puts more data-bound widgets above the fold.
 *
 * Od 2026-09-01 to jest okno OBOWIĄZUJĄCE TAKŻE dla tras edge-cache'owanych:
 * `$.tsx` (wpisy i wszystkie strony publiczne) oraz strona główna blokują
 * odpowiedź wyłącznie na tych pierwszych sekcjach, a reszta jedzie
 * strumieniem przez `ServerSectionGate` albo dogrzewa się po hydratacji.
 * (Stało tu wcześniej, że „trasy edge-cache'owane używają zamiast tego
 * {@link prefetchCachedRouteQueries}, które grzeje CAŁY dokument, a ta czapka
 * dotyczy tylko loaderów nie-cache'owanych" - nieprawda w obie strony:
 * `prefetchCachedRouteQueries` grzeje dziś już tylko chrome nagłówka i stopki
 * z loadera korzenia. To samo sprostowanie stoi w `useSectionPreload.ts`.)
 */
export const ABOVE_FOLD_SECTION_COUNT = 3;

/**
 * Upper bound (ms) on how long a loader will block waiting for above-the-fold
 * widget data before it hands control back and lets the cached/skeleton state
 * render. A generous safety net: real queries resolve well under it, but a
 * single pathologically slow query (or a cold upstream) can never hang the
 * whole server response. The widget then resolves client-side on hydration.
 */
const ABOVE_FOLD_PREFETCH_BUDGET_MS = 2500;

export interface AboveFoldPrefetchOptions {
  /** Leading sections to prefetch. Defaults to {@link ABOVE_FOLD_SECTION_COUNT}. */
  sections?: number;
  /**
   * Latency budget in ms. `0` / non-finite awaits the full prefetch with no
   * cap. Defaults to {@link ABOVE_FOLD_PREFETCH_BUDGET_MS}.
   */
  budgetMs?: number;
}

/** Collect data-bound widgets from the first `sectionCount` sections only. */
export function collectAboveFoldWidgets(doc: BuilderDocument, sectionCount: number): WidgetNode[] {
  const widgets: WidgetNode[] = [];
  doc.sections
    .slice(0, Math.max(0, sectionCount))
    .forEach((section) => collectSectionWidgets(section).forEach((w) => widgets.push(w)));
  return widgets;
}

/**
 * Resolve when `work` settles or `ms` elapses, whichever is first - without
 * leaving a dangling timer on the (server) event loop. `work` is expected to
 * never reject (callers pass an already-`allSettled` prefetch), but rejections
 * are swallowed so a budget race can never surface an unhandled error.
 */
function raceBudget(work: Promise<unknown>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    // Node keeps the process alive for pending timers; edge runtimes lack unref.
    const maybeUnref = timer as unknown as { unref?: () => void };
    if (typeof maybeUnref.unref === "function") maybeUnref.unref();
    work.then(finish, finish);
  });
}

/**
 * Prefetch only the above-the-fold sections of a builder document, bounded by a
 * latency budget. This is the loader-friendly counterpart to
 * {@link prefetchBuilderDocumentQueries}: the server renders the critical, first
 * sections with live data while below-the-fold sections hydrate progressively
 * on the client. Net effect - a far lower TTFB on content-heavy pages with no
 * change to the rendered layout.
 */
export async function prefetchAboveFoldQueries(
  queryClient: QueryClient,
  doc: BuilderDocument,
  lang: Lang,
  options: AboveFoldPrefetchOptions = {},
): Promise<void> {
  const sectionCount = options.sections ?? ABOVE_FOLD_SECTION_COUNT;
  const widgets = collectAboveFoldWidgets(doc, sectionCount);
  if (widgets.length === 0) return;

  const work = prefetchWidgets(queryClient, widgets, lang);
  const budgetMs = options.budgetMs ?? ABOVE_FOLD_PREFETCH_BUDGET_MS;
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) {
    await work;
    return;
  }
  await raceBudget(work, budgetMs);
}

/**
 * Prefetch EVERY section's data of the document it is handed, in parallel,
 * bounded by `budgetMs` - so a single slow upstream can never hang the SSR
 * response. Where {@link prefetchAboveFoldQueries} caps at the first
 * {@link ABOVE_FOLD_SECTION_COUNT} sections, this one has no cap: it is for
 * documents that are SHORT and needed WHOLE.
 *
 * KTO TO WOŁA (2026-09-01): wyłącznie loader korzenia, dla chrome nagłówka
 * i stopki. Wcześniej stało tu, że funkcja obsługuje „edge-cached content route
 * (home, public page/post)" i że grzeje cały dokument, „bo trasa jest
 * share-cached, więc koszt płaci się raz na rewalidację" - to już nieprawda
 * w obu członach: strona główna i `$.tsx` przeszły na
 * {@link prefetchAboveFoldQueries} plus strumieniowanie sekcji właśnie dlatego,
 * że przy cache MISS pierwszy bajt wisiał na najwolniejszym zapytaniu spod
 * zgięcia. Dokumenty chrome mają po kilka sekcji, więc dla nich brak czapki
 * jest w porządku.
 *
 * `budgetMs` JEST WYMAGANY. Parametr miał domyślne 6000 ms - dokładnie tę
 * liczbę, na której wisiał pierwszy bajt strony głównej. Po tamtej naprawie
 * żaden caller już z niej nie korzystał (oba pozostałe podają
 * `CHROME_WARM_BUDGET_MS` jawnie), a martwa domyślna wartość tej wielkości to
 * pułapka: następne wywołanie bez argumentu po cichu wróciłoby do 6 s. Budżet
 * jest więc częścią kontraktu - każdy nowy caller musi go NAZWAĆ. `0` (albo
 * wartość nieskończona) znaczy "czekaj do końca, bez czapki".
 */
export async function prefetchCachedRouteQueries(
  queryClient: QueryClient,
  doc: BuilderDocument,
  lang: Lang,
  budgetMs: number,
): Promise<void> {
  // Fully isolate: a throw here would propagate into the route loader and
  // desynchronize SSR HTML from the dehydrated router bootstrap.
  try {
    await prefetchAboveFoldQueries(queryClient, doc, lang, {
      sections: doc.sections.length,
      budgetMs,
    });
  } catch {
    /* prefetch is best-effort; widgets fall back to their client fetch */
  }
}
