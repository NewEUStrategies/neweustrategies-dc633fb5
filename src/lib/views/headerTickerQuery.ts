// Shared query options for the header "Na czasie / Trending" ticker.
//
// One definition consumed by BOTH the root-route loader (SSR prefetch) and
// <TrendingTicker/> (useQuery), so the server render and the client resolve the
// SAME cache entry: the ticker ships inside the SSR HTML and never pops in
// after hydration (which used to push the whole page down ~40px).
// Trzeci odbiorca: `HeaderSkeleton` czyta ten sam wpis (`peekHeaderTickerPosts`),
// żeby nie rezerwować pasa, który pasek i tak zwinie do zera.
import { keepPreviousData, queryOptions, type QueryClient } from "@tanstack/react-query";
import { currentLang } from "@/lib/i18n/localeRuntime";
import type { AppLang } from "@/lib/i18n/localePath";
import {
  getTrendingPosts,
  getTickerPosts,
  type TrendingPost,
} from "@/lib/views/postViews.functions";
import type {
  IconAnimation,
  LiveDirection,
  LayoutStyle,
  MixedFill,
  TickerColorScheme,
} from "@/lib/views/tickerVariants";

export type TickerSource = "trending" | "latest" | "pinned" | "selected" | "mixed";
// `rotate` retained as legacy alias for `slide` (single, slides up).
export type TickerMode = "scroll" | "rotate" | "fade" | "slide" | "flip" | "typewriter";

/** Header ticker knobs as stored in site_settings.header.trending. */
export interface TickerConfig {
  enabled?: boolean;
  source?: TickerSource;
  mode?: TickerMode;
  /** Visual layout of the bar. Defaults to `classic`. */
  layoutStyle?: LayoutStyle;
  days?: number;
  limit?: number;
  /** Rotate modes only: how many posts visible side-by-side at once. */
  visibleCount?: number;
  intervalSec?: number;
  /** Horizontal marquee layouts: scroll speed in px per second. */
  scrollSpeed?: number;
  pinnedPostId?: string;
  pinnedUntil?: string | null;
  /** Selected source: up to 3 hand-picked post IDs, order preserved. */
  selectedPostIds?: string[];
  /** Mixed source: how to fill the remainder after pinned/selected. */
  mixedFill?: MixedFill;
  /** Custom label overrides ("Na czasie" / "Trending" when empty). */
  labelPl?: string;
  labelEn?: string;
  /** Flame icon animation preset. */
  iconAnimation?: IconAnimation;
  /** `glassLive`: pionowy slide (domyślnie) albo poziomy marquee. */
  liveDirection?: LiveDirection;
  /** Per-mode (light/dark) color palette. */
  colors?: TickerColorScheme;
  fullWidth?: boolean;
}

/** Honor "pinned until" - fall back to latest once it expires. */
export function resolveTickerSource(
  cfg: Pick<TickerConfig, "source" | "pinnedPostId" | "pinnedUntil" | "selectedPostIds">,
  now: number = Date.now(),
): TickerSource {
  const source = cfg.source ?? "trending";
  if (source === "selected") {
    return (cfg.selectedPostIds?.filter(Boolean).length ?? 0) > 0 ? "selected" : "latest";
  }
  if (source === "mixed") return "mixed";
  if (source !== "pinned") return source;
  if (!cfg.pinnedPostId) return "latest";
  if (cfg.pinnedUntil && new Date(cfg.pinnedUntil).getTime() < now) return "latest";
  return "pinned";
}

/**
 * Wpis paska w cache - wyłącznie pola, które pasek RENDERUJE (`TrendingTicker`:
 * tytuł w języku klucza, adres, autor stylu `glassLive`; `slug` jako zapas
 * adresu, tylko gdy adresu brak). Okładka, data, `parent_page_id` i licznik
 * wyświetleń wracają z server fn, ale pasek ich nie czyta.
 */
export type HeaderTickerPost = Pick<
  TrendingPost,
  "id" | "author_display_name" | "author_avatar_url"
> &
  Partial<Pick<TrendingPost, "slug" | "href" | "title_pl" | "title_en">>;

/**
 * DIETA STANU ODWODNIONEGO (P2.5, HW-3b): projekcja wpisów paska na pola
 * renderowane. Pasek jedzie w stanie `$tsr` KAŻDEGO dokumentu z chrome, a
 * okładka (pełny URL storage), data, `parent_page_id` i `views_count` nie mają
 * w nim odbiorcy.
 *
 * TYLKO SERWER (runda poprawek 9 P3.7b, budżet domknięcia bootu): projekcja stoi
 * w `queryFn` za bramką `import.meta.env.SSR`, więc jej kod nie trafia do chunku
 * wejściowego, a jej odbiorcą jest wyłącznie stan odwodniony. Refetch klienta
 * (miękka zmiana języka, koniec świeżości) trzyma pełny wiersz z server fn -
 * pasek liczy z niego ten sam tytuł i adres (`itemTitle`, `itemHref`), więc
 * znacznik jest ten sam.
 *
 * JEDEN JĘZYK (fala 3, P3.7b, T4b - przekazanie z P2.5). Klucz paska niesie
 * język (`headerTickerQueryOptions(cfg, lang)`), więc wpis niesie tytuł
 * WYŁĄCZNIE w języku klucza: łańcuch `itemTitle` paska
 * (`<lang> || <drugi> || ""`) wpieczony w pole `title_<lang>`, pole drugiego
 * języka zdjęte. Pasek liczy z wiersza zrzutowanego ten sam tytuł co z pełnego.
 * Miękka zmiana języka trzyma poprzedni wpis jako `placeholderData`
 * (`keepPreviousData`), aż przyjdzie nowy - pasek się nie zapada.
 *
 * `slug` jest zapasem adresu (`href ?? /post/<slug>`, `itemHref`), więc jedzie
 * WYŁĄCZNIE przy wierszu bez `href` (T4a).
 */
export function projectHeaderTickerPosts(
  rows: readonly TrendingPost[],
  lang: AppLang,
): HeaderTickerPost[] {
  return rows.map((row) => {
    const title =
      lang === "en" ? row.title_en || row.title_pl || "" : row.title_pl || row.title_en || "";
    return {
      id: row.id,
      ...(row.href == null && { slug: row.slug }),
      ...(lang === "en" ? { title_en: title } : { title_pl: title }),
      href: row.href,
      author_display_name: row.author_display_name,
      author_avatar_url: row.author_avatar_url,
    };
  });
}

/**
 * Opcje zapytania paska. JĘZYK W KLUCZU (P3.7b, T4b): domyślnie `currentLang()`,
 * czyli język ŻĄDANIA na serwerze (`localeRuntime.ts`: z adresu żądania, dla
 * stron bez prefiksu językowego z ciasteczka żądania) i żywy język klienta
 * w przeglądarce, który przy starcie wyprowadza się z tego samego adresu i tego
 * samego ciasteczka. Rozgrzewka w loaderze korzenia (`__root.tsx`) i
 * `peekHeaderTickerPosts` wołają bez `lang`, a `TrendingTicker` podaje język
 * renderu jawnie - na serwerze to ten sam język (klon i18n żądania z
 * `currentLang()`), więc klucz SSR i klucz hydratacji są identyczne.
 *
 * (Sprostowanie komentarza z P2.5: `currentLang()` po stronie serwera JEST
 * bezpiecznym źródłem - liczy się per żądanie, nie z modułowego stanu.)
 */
export function headerTickerQueryOptions(cfg: TickerConfig, lang: AppLang = currentLang()) {
  const source = resolveTickerSource(cfg);
  const days = cfg.days ?? 7;
  const limit = cfg.limit ?? 8;
  const pinnedPostId = cfg.pinnedPostId;
  const selectedIds = (cfg.selectedPostIds ?? []).filter(Boolean).slice(0, 3);
  const mixedFill: MixedFill = cfg.mixedFill ?? "trending";
  const fetchRows = (): Promise<TrendingPost[]> => {
    if (source === "trending") return getTrendingPosts({ data: { days, limit } });
    if (source === "selected")
      return getTickerPosts({
        data: { source: "selected", limit, selectedPostIds: selectedIds },
      });
    if (source === "mixed")
      return getTickerPosts({
        data: {
          source: "mixed",
          limit,
          days,
          mixedFill,
          pinnedPostId,
          selectedPostIds: selectedIds,
        },
      });
    return getTickerPosts({ data: { source, limit, pinnedPostId } });
  };
  return queryOptions<HeaderTickerPost[]>({
    // Język PO źródle: etykieta zapytania w logu dokumentu (`queryLabel`, dwa
    // wiodące napisy) zostaje `header_ticker.<źródło>`.
    queryKey: [
      "header_ticker",
      source,
      lang,
      days,
      limit,
      pinnedPostId ?? null,
      selectedIds.join(","),
      mixedFill,
    ] as const,
    queryFn: async () => {
      const rows = await fetchRows();
      return import.meta.env.SSR ? projectHeaderTickerPosts(rows, lang) : rows;
    },
    // Miękka zmiana języka: nowy klucz pokazuje poprzednie wpisy, aż przyjdą
    // nowe - pasek nie zwija się do rezerwy wysokości (CLS 0).
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });
}

/**
 * Wpisy paska z cache'a - BEZ subskrypcji i BEZ fetcha (`getQueryData`), więc
 * wolno to wołać w renderze szkieletu, który pokazuje się dokładnie w zimnym
 * starcie. Klucz pochodzi z TEJ SAMEJ `headerTickerQueryOptions`, przez którą
 * idą `<TrendingTicker>` i loader korzenia - inny sposób składania klucza
 * czytałby cicho pusty wpis.
 *
 * `undefined` = wynik NIEZNANY: zimny start, zapytanie w locie albo błąd.
 * Błędu świadomie nie tłumaczymy na „pusto": dehydratacja przepuszcza wyłącznie
 * zapytania `success` (`router.tsx`, `shouldDehydrateQuery`), więc serwer
 * widziałby błąd, a klient brak wpisu - dwa różne szkielety w jednej hydracji.
 */
export function peekHeaderTickerPosts(
  queryClient: QueryClient,
  cfg: TickerConfig,
): HeaderTickerPost[] | undefined {
  return queryClient.getQueryData(headerTickerQueryOptions(cfg).queryKey);
}
