// Header "Na czasie / Trending" - compact horizontal scroller of the most-read
// posts (last 7 days). Lazy-loaded so it never blocks the header chrome.
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Flame } from "lucide-react";
import { getTrendingPosts } from "@/lib/views/postViews.functions";
import { AppLink } from "@/components/atoms/AppLink";

interface Props {
  days?: number;
  limit?: number;
  fullWidth?: boolean;
  className?: string;
}

export function TrendingTicker({ days = 7, limit = 8, fullWidth = true, className }: Props) {
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
  const innerMax = fullWidth ? "max-w-none" : "max-w-[1400px] mx-auto";

  return (
    <div
      className={`cms-trending border-b border-border bg-muted/30 ${className ?? ""}`}
      data-testid="trending-ticker"
    >
      <div className={`${innerMax} px-4 lg:px-8 py-2 flex items-center gap-4 overflow-hidden`}>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-brand shrink-0 whitespace-nowrap">
          <Flame className="w-3.5 h-3.5 shrink-0" aria-hidden /> {label}
        </span>
        <span className="hidden sm:block h-4 w-px bg-border shrink-0" aria-hidden />
        <div
          className="flex-1 min-w-0 flex items-center gap-6 overflow-x-auto scrollbar-none"
          style={{ scrollbarWidth: "none" }}
        >
          {data.map((p, i) => {
            const title = lang === "en" ? p.title_en || p.title_pl : p.title_pl || p.title_en;
            return (
              <AppLink
                key={p.id}
                href={p.href}
                className="group flex items-center gap-2 text-sm whitespace-nowrap hover:text-brand transition shrink-0"
                title={`${title} - ${p.views_count} ${t("views", { defaultValue: "wyświetleń" })}`}
              >
                <span className="text-[10px] font-bold text-muted-foreground tabular-nums">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="font-medium truncate max-w-[220px] sm:max-w-none sm:whitespace-nowrap">{title}</span>
              </AppLink>
            );
          })}
        </div>
      </div>
    </div>
  );
}
