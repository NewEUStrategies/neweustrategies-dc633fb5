// Shared query options for the header "Na czasie / Trending" ticker.
//
// One definition consumed by BOTH the root-route loader (SSR prefetch) and
// <TrendingTicker/> (useQuery), so the server render and the client resolve the
// SAME cache entry: the ticker ships inside the SSR HTML and never pops in
// after hydration (which used to push the whole page down ~40px).
// Trzeci odbiorca: `HeaderSkeleton` czyta ten sam wpis (`peekHeaderTickerPosts`),
// żeby nie rezerwować pasa, który pasek i tak zwinie do zera.
import { queryOptions, type QueryClient } from "@tanstack/react-query";
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

export function headerTickerQueryOptions(cfg: TickerConfig) {
  const source = resolveTickerSource(cfg);
  const days = cfg.days ?? 7;
  const limit = cfg.limit ?? 8;
  const pinnedPostId = cfg.pinnedPostId;
  const selectedIds = (cfg.selectedPostIds ?? []).filter(Boolean).slice(0, 3);
  const mixedFill: MixedFill = cfg.mixedFill ?? "trending";
  return queryOptions<TrendingPost[]>({
    queryKey: [
      "header_ticker",
      source,
      days,
      limit,
      pinnedPostId ?? null,
      selectedIds.join(","),
      mixedFill,
    ] as const,
    queryFn: () => {
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
    },
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
): TrendingPost[] | undefined {
  return queryClient.getQueryData(headerTickerQueryOptions(cfg).queryKey);
}
