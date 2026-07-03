// `web-stories-carousel` builder widget view - horizontal cards opening a viewer.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { latestWebStoriesQueryOptions } from "@/lib/queries/webStories";
import { storyTitle } from "@/lib/web-stories/types";
import { StoryViewer } from "@/components/web-stories/StoryViewer";

interface Props {
  c: Record<string, unknown>;
  lang: "pl" | "en";
}

function getNum(c: Record<string, unknown>, k: string, d: number): number {
  const v = c[k];
  return typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : d;
}
function getStr(c: Record<string, unknown>, k: string, d = ""): string {
  const v = c[k];
  return typeof v === "string" ? v : d;
}

export function WebStoriesCarouselView({ c, lang }: Props) {
  const limit = Math.max(2, Math.min(20, getNum(c, "limit", 8)));
  const variant = getStr(c, "variant", "carousel") as "carousel" | "grid";
  const aspect = getStr(c, "aspect", "9/16");
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  const { data, isLoading } = useQuery(latestWebStoriesQueryOptions(limit));
  if (isLoading) return <div className="text-sm text-muted-foreground">…</div>;
  if (!data?.length) {
    return (
      <div className="text-sm text-muted-foreground">
        {lang === "en" ? "No web stories yet." : "Brak historii."}
      </div>
    );
  }

  const open = data[openIdx ?? -1];

  const containerCls =
    variant === "grid"
      ? "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3"
      : "flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 -mx-2 px-2 scrollbar-thin";

  return (
    <div>
      <div className={containerCls}>
        {data.map((s, i) => {
          const title = storyTitle(s, lang);
          return (
            <button
              key={s.id}
              onClick={() => setOpenIdx(i)}
              className={`group relative overflow-hidden rounded-xl border border-border bg-card text-left ${variant === "carousel" ? "min-w-[140px] sm:min-w-[160px] snap-start" : ""}`}
              style={{ aspectRatio: aspect }}
              aria-label={title}
            >
              {s.cover_url ? (
                <img
                  src={s.cover_url}
                  alt=""
                  loading="lazy"
                  className="absolute inset-0 w-full h-full object-cover transition-transform group-hover:scale-105"
                />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-neutral-700 to-neutral-900" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
              <div className="absolute bottom-2 left-2 right-2">
                <div className="text-white text-xs sm:text-sm font-medium line-clamp-2 drop-shadow">
                  {title}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {open && open.pages.length > 0 && (
        <StoryViewer pages={open.pages} lang={lang} onClose={() => setOpenIdx(null)} />
      )}

      {/* SEO crawlable links to single story pages */}
      <div className="sr-only">
        {data.map((s) => (
          <Link key={s.id} to="/web-stories/$slug" params={{ slug: s.slug }}>
            {storyTitle(s, lang)}
          </Link>
        ))}
      </div>
    </div>
  );
}
