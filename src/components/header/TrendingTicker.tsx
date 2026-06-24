// Header "Na czasie / Trending" — compact horizontal scroller of the most-read
// posts (last 7 days). Lazy-loaded so it never blocks the header chrome.
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Flame } from "lucide-react";
import { getTrendingPosts } from "@/lib/views/postViews.functions";

interface Props {
  days?: number;
  limit?: number;
  className?: string;
}

export function TrendingTicker({ days = 7, limit = 8, className }: Props) {
  const { t, i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const fetcher = useServerFn(getTrendingPosts);

  const { data, isLoading } = useQuery({
    queryKey: ["trending_posts", days, limit] as const,
    queryFn: () => fetcher({ data: { days, limit } }),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });

  if (isLoading || !data?.length) return null;

  const label = lang === "en" ? "Trending" : "Na czasie";

  return (
    <div
      className={`cms-trending border-b border-border bg-muted/30 ${className ?? ""}`}
      data-testid="trending-ticker"
    >
      <div className="max-w-[1400px] mx-auto px-4 lg:px-8 py-2 flex items-center gap-3 overflow-hidden">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-brand shrink-0">
          <Flame className="w-3.5 h-3.5" aria-hidden /> {label}
        </span>
        <div
          className="flex items-center gap-5 overflow-x-auto scrollbar-none"
          style={{ scrollbarWidth: "none" }}
        >
          {data.map((p, i) => {
            const title = lang === "en" ? p.title_en || p.title_pl : p.title_pl || p.title_en;
            return (
              <a
                key={p.id}
                href={p.href}
                className="group flex items-center gap-2 text-sm whitespace-nowrap hover:text-brand transition"
                title={`${title} - ${p.views_count} ${t("views", { defaultValue: "wyświetleń" })}`}
              >
                <span className="text-[10px] font-bold text-muted-foreground tabular-nums">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="truncate max-w-[260px] font-medium">{title}</span>
              </a>
            );
          })}
        </div>
      </div>
    </div>
  );
}
