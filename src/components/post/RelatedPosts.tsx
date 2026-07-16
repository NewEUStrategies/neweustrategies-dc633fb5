// Related-posts UI. Three layouts: grid (2/3/4 cols), list, slider.
// Reads config + scored posts via React Query.
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { OptimizedImage } from "@/components/atoms/OptimizedImage";
import {
  relatedPostsConfigQueryOptions,
  relatedPostsQueryOptions,
} from "@/lib/queries/relatedPosts";
import {
  mergeRelatedConfig,
  type RelatedPostsConfig,
  type RelatedPostsOverride,
} from "@/lib/relatedPosts";
import type { BlogListItem } from "@/lib/queries/public";
import { formatDate } from "@/lib/i18n/format";
import { trackRelatedClick } from "@/lib/relatedClickBeacon";
import { accentFor } from "./relatedVisuals";
import { ArrowUpRight, Clock, Sparkles } from "lucide-react";

export interface RelatedPostsProps {
  postId: string;
  lang: "pl" | "en";
  override?: RelatedPostsOverride | null;
  /** Force layout regardless of config (e.g. sidebar always renders list). */
  forceLayout?: RelatedPostsConfig["layout"];
  /** Force columns count (used in sidebar). */
  forceColumns?: RelatedPostsConfig["columns"];
  className?: string;
}

export function RelatedPosts({
  postId,
  lang,
  override,
  forceLayout,
  forceColumns,
  className,
}: RelatedPostsProps) {
  const { data: globalCfg } = useQuery(relatedPostsConfigQueryOptions());
  const cfg = mergeRelatedConfig(globalCfg, override);

  const { data: posts = [], isLoading } = useQuery(
    relatedPostsQueryOptions({
      postId,
      limit: cfg.items_limit,
      strategy: cfg.source_strategy,
      recencyBoostDays: cfg.recency_boost_days,
    }),
  );

  if (!cfg.enabled) return null;
  if (isLoading) return null;
  if (posts.length === 0) return null;

  const layout = forceLayout ?? cfg.layout;
  const columns = forceColumns ?? cfg.columns;
  const title = lang === "en" ? cfg.title_en : cfg.title_pl;

  return (
    <section
      className={`related-posts cv-auto mt-10 ${className ?? ""}`}
      data-related-position={cfg.position}
      aria-label={title}
    >
      <div className="flex items-center gap-2 mb-5">
        <span
          className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-brand-ink/10 text-brand-ink"
          aria-hidden
        >
          <Sparkles className="h-4 w-4" />
        </span>
        <h2 className="font-display text-2xl">{title}</h2>
      </div>
      {layout === "grid" && (
        <RelatedGrid posts={posts} columns={columns} cfg={cfg} lang={lang} sourcePostId={postId} />
      )}
      {layout === "list" && (
        <RelatedList posts={posts} cfg={cfg} lang={lang} sourcePostId={postId} />
      )}
      {layout === "slider" && (
        <RelatedSlider posts={posts} cfg={cfg} lang={lang} sourcePostId={postId} />
      )}
      {layout === "cards" && (
        <RelatedCards posts={posts} cfg={cfg} lang={lang} sourcePostId={postId} />
      )}
      {layout === "magazine" && (
        <RelatedMagazine posts={posts} cfg={cfg} lang={lang} sourcePostId={postId} />
      )}
      {layout === "timeline" && (
        <RelatedTimeline posts={posts} cfg={cfg} lang={lang} sourcePostId={postId} />
      )}
    </section>
  );
}

// ---------- subcomponents ---------------------------------------------------

interface ViewProps {
  posts: readonly BlogListItem[];
  cfg: RelatedPostsConfig;
  lang: "pl" | "en";
  sourcePostId: string;
}

function CardThumb({ p, cfg }: { p: BlogListItem; cfg: RelatedPostsConfig }) {
  if (!cfg.show_cover || !p.cover_image_url) return null;
  return (
    <div className="aspect-[16/10] overflow-hidden rounded-md bg-muted">
      <OptimizedImage
        src={p.cover_image_url}
        alt=""
        responsive
        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
        className="w-full h-full object-cover transition-transform duration-500 hover:scale-105"
      />
    </div>
  );
}

function CardBody({
  p,
  cfg,
  lang,
  sourcePostId,
}: {
  p: BlogListItem;
  cfg: RelatedPostsConfig;
  lang: "pl" | "en";
  sourcePostId: string;
}) {
  const title = lang === "en" ? p.title_en || p.title_pl : p.title_pl || p.title_en;
  const excerpt = lang === "en" ? p.excerpt_en : p.excerpt_pl;
  return (
    <div className="space-y-1">
      <h3 className="font-display text-base leading-snug">
        {/* Viewport preload + beacon: klikając w rekomendację zapisujemy klik
            do `related_post_clicks`, żeby panel BI mógł liczyć CTR i sankey. */}
        <Link
          to={p.href as "/"}
          preload="viewport"
          className="hover:text-brand-ink transition-colors"
          onClick={() => trackRelatedClick(sourcePostId, p.id)}
        >
          {title}
        </Link>
      </h3>

      {cfg.show_excerpt && excerpt && (
        <p className="text-sm text-muted-foreground line-clamp-2">{excerpt}</p>
      )}
      {cfg.show_meta && p.published_at && (
        <time className="text-xs text-muted-foreground" dateTime={p.published_at}>
          {formatDate(p.published_at, lang, { year: "numeric", month: "short", day: "numeric" })}
        </time>
      )}
    </div>
  );
}

function RelatedGrid({
  posts,
  columns,
  cfg,
  lang,
  sourcePostId,
}: ViewProps & { columns: RelatedPostsConfig["columns"] }) {
  const colClass =
    columns === 2
      ? "sm:grid-cols-2"
      : columns === 4
        ? "sm:grid-cols-2 lg:grid-cols-4"
        : "sm:grid-cols-2 lg:grid-cols-3";
  return (
    <div className={`grid grid-cols-1 ${colClass} gap-5`}>
      {posts.map((p) => (
        <article key={p.id} className="space-y-3">
          <CardThumb p={p} cfg={cfg} />
          <CardBody p={p} cfg={cfg} lang={lang} sourcePostId={sourcePostId} />
        </article>
      ))}
    </div>
  );
}

function RelatedList({ posts, cfg, lang, sourcePostId }: ViewProps) {
  return (
    <ul className="divide-y divide-border">
      {posts.map((p) => (
        <li key={p.id} className="py-3 flex gap-3 items-start">
          {cfg.show_cover && p.cover_image_url && (
            <div className="w-20 h-20 shrink-0 overflow-hidden rounded-md bg-muted">
              <OptimizedImage
                src={p.cover_image_url}
                alt=""
                responsive
                responsiveWidths={[80, 160, 240]}
                sizes="80px"
                className="w-full h-full object-cover"
              />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <CardBody p={p} cfg={cfg} lang={lang} sourcePostId={sourcePostId} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function RelatedSlider({ posts, cfg, lang, sourcePostId }: ViewProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (!cfg.slider_autoplay) return;
    const t = window.setInterval(
      () => {
        setIdx((i) => (i + 1) % posts.length);
      },
      Math.max(2000, cfg.slider_interval_ms),
    );
    return () => window.clearInterval(t);
  }, [cfg.slider_autoplay, cfg.slider_interval_ms, posts.length]);

  useEffect(() => {
    const el = trackRef.current?.children[idx] as HTMLElement | undefined;
    el?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
  }, [idx]);

  return (
    <div className="relative">
      <div
        ref={trackRef}
        className="flex gap-5 overflow-x-auto snap-x snap-mandatory pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {posts.map((p) => (
          <article
            key={p.id}
            className="snap-start shrink-0 w-[85%] sm:w-[45%] lg:w-[31%] space-y-3"
          >
            <CardThumb p={p} cfg={cfg} />
            <CardBody p={p} cfg={cfg} lang={lang} sourcePostId={sourcePostId} />
          </article>
        ))}
      </div>
      {posts.length > 1 && (
        <div className="flex justify-center gap-1.5 mt-3" role="tablist">
          {posts.map((_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === idx}
              aria-label={`Slide ${i + 1}`}
              onClick={() => setIdx(i)}
              className={`h-1.5 rounded-full transition-all ${
                i === idx ? "w-6 bg-brand" : "w-1.5 bg-border"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- v2 layouts: cards / magazine / timeline -------------------------

/** Karta z akcentem kolorystycznym i ikoną (deterministyczne z postId). */
function RelatedCards({ posts, cfg, lang, sourcePostId }: ViewProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
      {posts.map((p) => {
        const a = accentFor(p.id);
        const title = lang === "en" ? p.title_en || p.title_pl : p.title_pl || p.title_en;
        const excerpt = lang === "en" ? p.excerpt_en : p.excerpt_pl;
        return (
          <Link
            key={p.id}
            to={p.href as "/"}
            preload="viewport"
            onClick={() => trackRelatedClick(sourcePostId, p.id)}
            className={`group relative flex flex-col overflow-hidden rounded-xl border ${a.borderClass} bg-card transition-all hover:-translate-y-0.5 hover:shadow-lg`}
          >
            {cfg.show_cover && p.cover_image_url ? (
              <div className="relative aspect-[16/10] overflow-hidden bg-muted">
                <OptimizedImage
                  src={p.cover_image_url}
                  alt=""
                  responsive
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
                <span
                  className={`absolute top-3 left-3 inline-flex h-8 w-8 items-center justify-center rounded-md ${a.bgClass} ${a.textClass} backdrop-blur-sm ring-1 ${a.borderClass}`}
                  aria-hidden
                >
                  <a.Icon className="h-4 w-4" />
                </span>
              </div>
            ) : (
              <div className={`h-2 w-full ${a.bgClass}`} aria-hidden />
            )}
            <div className="flex flex-1 flex-col gap-2 p-4">
              <div
                className={`inline-flex w-fit items-center gap-1.5 rounded-full ${a.bgClass} ${a.textClass} px-2 py-0.5 text-xs font-medium`}
              >
                <a.Icon className="h-3 w-3" />
                {lang === "en" ? "Recommended" : "Polecane"}
              </div>
              <h3 className="font-display text-base leading-snug group-hover:text-brand-ink transition-colors">
                {title}
              </h3>
              {cfg.show_excerpt && excerpt && (
                <p className="text-sm text-muted-foreground line-clamp-2">{excerpt}</p>
              )}
              <div className="mt-auto flex items-center justify-between pt-2">
                {cfg.show_meta && p.published_at ? (
                  <time className="text-xs text-muted-foreground" dateTime={p.published_at}>
                    {formatDate(p.published_at, lang, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </time>
                ) : (
                  <span />
                )}
                <span
                  className={`inline-flex items-center gap-1 text-xs ${a.textClass} opacity-0 group-hover:opacity-100 transition-opacity`}
                >
                  {lang === "en" ? "Read" : "Czytaj"}
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </span>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

/** Magazine: 1 duży featured + lista skrócona po prawej. */
function RelatedMagazine({ posts, cfg, lang, sourcePostId }: ViewProps) {
  if (posts.length === 0) return null;
  const [hero, ...rest] = posts;
  const heroAccent = accentFor(hero.id);
  const heroTitle = lang === "en" ? hero.title_en || hero.title_pl : hero.title_pl || hero.title_en;
  const heroExcerpt = lang === "en" ? hero.excerpt_en : hero.excerpt_pl;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
      <Link
        to={hero.href as "/"}
        preload="viewport"
        onClick={() => trackRelatedClick(sourcePostId, hero.id)}
        className={`group relative lg:col-span-3 overflow-hidden rounded-xl border ${heroAccent.borderClass} bg-card`}
      >
        {cfg.show_cover && hero.cover_image_url && (
          <div className="relative aspect-[16/10] overflow-hidden bg-muted">
            <OptimizedImage
              src={hero.cover_image_url}
              alt=""
              responsive
              sizes="(max-width: 1024px) 100vw, 60vw"
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-background/30 to-transparent" />
          </div>
        )}
        <div className="absolute bottom-0 left-0 right-0 p-5 space-y-2">
          <div
            className={`inline-flex w-fit items-center gap-1.5 rounded-full ${heroAccent.bgClass} ${heroAccent.textClass} px-2.5 py-1 text-xs font-medium ring-1 ${heroAccent.borderClass}`}
          >
            <heroAccent.Icon className="h-3.5 w-3.5" />
            {lang === "en" ? "Featured" : "Wyróżnione"}
          </div>
          <h3 className="font-display text-2xl leading-tight group-hover:text-brand-ink transition-colors">
            {heroTitle}
          </h3>
          {cfg.show_excerpt && heroExcerpt && (
            <p className="text-sm text-muted-foreground line-clamp-2 max-w-prose">{heroExcerpt}</p>
          )}
        </div>
      </Link>
      <ul className="lg:col-span-2 divide-y divide-border rounded-xl border border-border bg-card">
        {rest.slice(0, 5).map((p) => {
          const a = accentFor(p.id);
          const title = lang === "en" ? p.title_en || p.title_pl : p.title_pl || p.title_en;
          return (
            <li key={p.id}>
              <Link
                to={p.href as "/"}
                preload="viewport"
                onClick={() => trackRelatedClick(sourcePostId, p.id)}
                className="group flex items-start gap-3 p-3 hover:bg-muted/50 transition-colors"
              >
                <span
                  className={`shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-md ${a.bgClass} ${a.textClass} ring-1 ${a.borderClass}`}
                  aria-hidden
                >
                  <a.Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <h4 className="font-display text-sm leading-snug line-clamp-2 group-hover:text-brand-ink transition-colors">
                    {title}
                  </h4>
                  {cfg.show_meta && p.published_at && (
                    <time
                      className="mt-0.5 block text-xs text-muted-foreground"
                      dateTime={p.published_at}
                    >
                      {formatDate(p.published_at, lang, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </time>
                  )}
                </div>
                <ArrowUpRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Pionowa oś czasu z kropkami-ikonami i akcentem per wpis. */
function RelatedTimeline({ posts, cfg, lang, sourcePostId }: ViewProps) {
  return (
    <ol className="relative border-l border-border pl-6 space-y-6">
      {posts.map((p) => {
        const a = accentFor(p.id);
        const title = lang === "en" ? p.title_en || p.title_pl : p.title_pl || p.title_en;
        const excerpt = lang === "en" ? p.excerpt_en : p.excerpt_pl;
        return (
          <li key={p.id} className="relative">
            <span
              className={`absolute -left-[34px] top-0 inline-flex h-8 w-8 items-center justify-center rounded-full ${a.bgClass} ${a.textClass} ring-2 ring-background border ${a.borderClass}`}
              aria-hidden
            >
              <a.Icon className="h-4 w-4" />
            </span>
            <Link
              to={p.href as "/"}
              preload="viewport"
              onClick={() => trackRelatedClick(sourcePostId, p.id)}
              className="group block rounded-lg border border-border bg-card p-4 hover:border-brand-ink/40 hover:shadow-sm transition-all"
            >
              {cfg.show_meta && p.published_at && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                  <Clock className="h-3 w-3" />
                  <time dateTime={p.published_at}>
                    {formatDate(p.published_at, lang, {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                  </time>
                </div>
              )}
              <h3 className="font-display text-base leading-snug group-hover:text-brand-ink transition-colors">
                {title}
              </h3>
              {cfg.show_excerpt && excerpt && (
                <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{excerpt}</p>
              )}
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
