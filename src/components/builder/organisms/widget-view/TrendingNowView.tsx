// Builder widget `trending-now` ("Warte przeczytania" / "Worth reading").
//
// Jeden wiersz w formie pigułki: pomarańczowy badge po lewej, a po prawej
// szklana karta z inline'owym numerem, tytułem, awatarem i imieniem autora.
// Dane pochodzą z tego samego zapytania co `news-ticker`, więc prefetch,
// cache i de-duplikacja wpisów na stronie działają identycznie.
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Flame } from "lucide-react";
import type { WidgetContent } from "@/lib/builder/types";
import { useUsedPostIds } from "@/lib/builder/usedPostIds";
import { AppLink } from "@/components/atoms/AppLink";
import { dedupeAndSlice, type Lang } from "@/lib/builder/postListQuery";
import { asBool, asNum, asStr } from "@/lib/content-model/contentValue";
import {
  newsTickerQueryOptions,
  newsTickerDisplayLimit,
  type TickerPost,
} from "@/lib/builder/newsTickerQuery";

function readStr(c: WidgetContent, key: string, dflt = ""): string {
  return asStr(c[key]) || dflt;
}

/** Hold-then-advance keyframes: every card rests, then slides up by one row. */
export function buildTrendingKeyframes(slots: number, animName: string): string {
  if (slots < 2) return "";
  const steps = slots - 1;
  const transition = 100 / (slots * steps);
  const hold = 100 / slots - transition;
  let frames = "";
  for (let i = 0; i < steps; i += 1) {
    const start = i * ((100 - transition) / steps);
    const end = start + Math.max(0, hold);
    const y = -((i * 100) / slots);
    frames += `${start.toFixed(2)}%,${end.toFixed(2)}%{transform:translate3d(0,${y.toFixed(2)}%,0)}`;
  }
  frames += `100%{transform:translate3d(0,${(-((steps * 100) / slots)).toFixed(2)}%,0)}`;
  return `@keyframes ${animName}{0%{transform:translate3d(0,0,0)}${frames}}
    @media (prefers-reduced-motion: reduce){
      [data-trending-now] [style*="animation"]{animation:none !important}
    }`;
}

export function TrendingNowView({ c, lang }: { c: WidgetContent; lang: Lang }) {
  const { t } = useTranslation();
  const badge = readStr(c, `badge_${lang}`) || readStr(c, "badge_pl") || t("trendingTicker.badge");
  const displayLimit = newsTickerDisplayLimit(c);
  const intervalSec = Math.max(2, Math.min(60, asNum(c.intervalSec, 5)));
  const pauseOnHover = asBool(c.pauseOnHover, true);
  const showAuthor = asBool(c.showAuthor, true);
  const showIndex = asBool(c.showIndex, true);
  const uniqueOnPage = asBool(c.uniqueOnPage, false);

  const used = useUsedPostIds();
  const { data, isLoading } = useQuery(newsTickerQueryOptions(c, lang));
  const fetched: TickerPost[] = data ?? [];

  const [excludeIds, setExcludeIds] = useState<readonly string[]>([]);
  useEffect(() => {
    if (!uniqueOnPage) return;
    setExcludeIds(used.getSnapshot());
  }, [uniqueOnPage, used, data]);

  const rows: TickerPost[] = uniqueOnPage
    ? dedupeAndSlice(fetched, excludeIds, displayLimit)
    : fetched.slice(0, displayLimit);

  const visibleIdsKey = rows.map((r) => r.id).join(",");
  useEffect(() => {
    if (visibleIdsKey) used.register(visibleIdsKey.split(","));
  }, [visibleIdsKey, used]);

  const animName = `trending-now-${useId().replace(/:/g, "")}`;

  if ((isLoading && !rows.length) || !rows.length) {
    return (
      <div className="cms-meta w-full overflow-hidden rounded-full border border-border bg-card px-4 py-2">
        {isLoading
          ? lang === "pl"
            ? "Ładowanie…"
            : "Loading…"
          : lang === "pl"
            ? "Brak wpisów do wyświetlenia."
            : "No posts to display."}
      </div>
    );
  }

  const track = rows.length > 1 ? [...rows, rows[0]] : rows;
  const durationSec = Math.max(2, rows.length * intervalSec);
  const keyframes = rows.length > 1 ? buildTrendingKeyframes(track.length, animName) : "";

  const title = (p: TickerPost) =>
    (lang === "pl" ? p.title_pl : p.title_en) || p.title_pl || p.title_en || "-";

  return (
    <div
      data-trending-now
      role="marquee"
      aria-label={badge}
      className="flex w-full items-stretch gap-0 overflow-hidden rounded-2xl shadow-[0_18px_40px_-28px_color-mix(in_oklab,var(--foreground)_60%,transparent)]"
      style={{ fontFamily: "var(--font-display)" }}
    >
      <span className="flex shrink-0 items-center gap-2 rounded-l-2xl bg-[linear-gradient(135deg,var(--brand),color-mix(in_oklab,var(--brand)_65%,white))] px-5 text-[13px] font-black uppercase tracking-[0.14em] text-brand-foreground">
        <Flame className="h-4 w-4 shrink-0" aria-hidden />
        <span className="whitespace-nowrap">{badge}</span>
      </span>

      <div className="relative min-w-0 flex-1 overflow-hidden rounded-r-2xl border border-l-0 border-border bg-card">
        <div
          className="flex flex-col"
          style={
            keyframes
              ? { animation: `${animName} ${durationSec}s cubic-bezier(.65,0,.35,1) infinite` }
              : undefined
          }
          onMouseEnter={(e) => {
            if (pauseOnHover) e.currentTarget.style.animationPlayState = "paused";
          }}
          onMouseLeave={(e) => {
            if (pauseOnHover) e.currentTarget.style.animationPlayState = "running";
          }}
        >
          {track.map((p, i) => (
            <AppLink
              key={`${p.id}-${i}`}
              href={`/post/${p.slug}`}
              title={title(p)}
              aria-hidden={i >= rows.length ? true : undefined}
              tabIndex={i >= rows.length ? -1 : undefined}
              className="group flex h-12 shrink-0 items-center gap-3 px-5 transition-colors hover:bg-muted/40"
            >
              {showIndex ? (
                <span className="shrink-0 text-[15px] font-bold tabular-nums text-[var(--brand)]">
                  {String((i % rows.length) + 1).padStart(2, "0")}
                </span>
              ) : null}
              <span className="min-w-0 flex-1 truncate text-[15px] font-bold tracking-tight text-foreground transition-colors group-hover:text-[var(--brand-ink)]">
                {title(p)}
              </span>
              {showAuthor && (p.author_avatar_url || p.author_display_name) ? (
                <span className="flex shrink-0 items-center gap-2 border-l border-border pl-3">
                  {p.author_avatar_url ? (
                    <img
                      src={p.author_avatar_url}
                      alt=""
                      loading="lazy"
                      className="h-6 w-6 rounded-full object-cover ring-1 ring-border"
                    />
                  ) : null}
                  {p.author_display_name ? (
                    <span className="hidden whitespace-nowrap text-[13px] font-semibold text-muted-foreground sm:inline">
                      {p.author_display_name}
                    </span>
                  ) : null}
                </span>
              ) : null}
            </AppLink>
          ))}
        </div>
        {keyframes ? <style dangerouslySetInnerHTML={{ __html: keyframes }} /> : null}
      </div>
    </div>
  );
}
