// Shared query options for the header "Na czasie / Trending" ticker.
//
// One definition consumed by BOTH the root-route loader (SSR prefetch) and
// <TrendingTicker/> (useQuery), so the server render and the client resolve the
// SAME cache entry: the ticker ships inside the SSR HTML and never pops in
// after hydration (which used to push the whole page down ~40px).
import { queryOptions } from "@tanstack/react-query";
import {
  getTrendingPosts,
  getTickerPosts,
  type TrendingPost,
} from "@/lib/views/postViews.functions";

export type TickerSource = "trending" | "latest" | "pinned";
export type TickerMode = "scroll" | "rotate";

/** Header ticker knobs as stored in site_settings.header.trending. */
export interface TickerConfig {
  enabled?: boolean;
  source?: TickerSource;
  mode?: TickerMode;
  days?: number;
  limit?: number;
  intervalSec?: number;
  pinnedPostId?: string;
  pinnedUntil?: string | null;
  fullWidth?: boolean;
}

/** Honor "pinned until" - fall back to latest once it expires. */
export function resolveTickerSource(
  cfg: Pick<TickerConfig, "source" | "pinnedPostId" | "pinnedUntil">,
  now: number = Date.now(),
): TickerSource {
  const source = cfg.source ?? "trending";
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
  return queryOptions<TrendingPost[]>({
    queryKey: ["header_ticker", source, days, limit, pinnedPostId ?? null] as const,
    queryFn: () =>
      source === "trending"
        ? getTrendingPosts({ data: { days, limit } })
        : getTickerPosts({ data: { source, limit, pinnedPostId } }),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });
}
