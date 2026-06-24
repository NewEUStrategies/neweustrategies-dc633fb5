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
import { mergeRelatedConfig, type RelatedPostsConfig, type RelatedPostsOverride } from "@/lib/relatedPosts";
import type { BlogListItem } from "@/lib/queries/public";

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
      className={`related-posts mt-10 ${className ?? ""}`}
      data-related-position={cfg.position}
      aria-label={title}
    >
      <h2 className="font-display text-2xl mb-5">{title}</h2>
      {layout === "grid" && <RelatedGrid posts={posts} columns={columns} cfg={cfg} lang={lang} />}
      {layout === "list" && <RelatedList posts={posts} cfg={cfg} lang={lang} />}
      {layout === "slider" && <RelatedSlider posts={posts} cfg={cfg} lang={lang} />}
    </section>
  );
}

// ---------- subcomponents ---------------------------------------------------

interface ViewProps {
  posts: readonly BlogListItem[];
  cfg: RelatedPostsConfig;
  lang: "pl" | "en";
}

function CardThumb({ p, cfg }: { p: BlogListItem; cfg: RelatedPostsConfig }) {
  if (!cfg.show_cover || !p.cover_image_url) return null;
  return (
    <div className="aspect-[16/10] overflow-hidden rounded-md bg-muted">
      <OptimizedImage
        src={p.cover_image_url}
        alt=""
        className="w-full h-full object-cover transition-transform duration-500 hover:scale-105"
      />
    </div>
  );
}

function CardBody({ p, cfg, lang }: { p: BlogListItem; cfg: RelatedPostsConfig; lang: "pl" | "en" }) {
  const title = lang === "en" ? p.title_en || p.title_pl : p.title_pl || p.title_en;
  const excerpt = lang === "en" ? p.excerpt_en : p.excerpt_pl;
  return (
    <div className="space-y-1">
      <h3 className="font-display text-base leading-snug">
        <Link to={p.href as "/"} className="hover:text-brand transition-colors">
          {title}
        </Link>
      </h3>
      {cfg.show_excerpt && excerpt && (
        <p className="text-sm text-muted-foreground line-clamp-2">{excerpt}</p>
      )}
      {cfg.show_meta && p.published_at && (
        <time className="text-xs text-muted-foreground" dateTime={p.published_at}>
          {new Date(p.published_at).toLocaleDateString(lang === "en" ? "en-US" : "pl-PL", {
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
        </time>
      )}
    </div>
  );
}

function RelatedGrid({ posts, columns, cfg, lang }: ViewProps & { columns: RelatedPostsConfig["columns"] }) {
  const colClass =
    columns === 2 ? "sm:grid-cols-2" : columns === 4 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-2 lg:grid-cols-3";
  return (
    <div className={`grid grid-cols-1 ${colClass} gap-5`}>
      {posts.map((p) => (
        <article key={p.id} className="space-y-3">
          <CardThumb p={p} cfg={cfg} />
          <CardBody p={p} cfg={cfg} lang={lang} />
        </article>
      ))}
    </div>
  );
}

function RelatedList({ posts, cfg, lang }: ViewProps) {
  return (
    <ul className="divide-y divide-border">
      {posts.map((p) => (
        <li key={p.id} className="py-3 flex gap-3 items-start">
          {cfg.show_cover && p.cover_image_url && (
            <div className="w-20 h-20 shrink-0 overflow-hidden rounded-md bg-muted">
              <OptimizedImage src={p.cover_image_url} alt="" className="w-full h-full object-cover" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <CardBody p={p} cfg={cfg} lang={lang} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function RelatedSlider({ posts, cfg, lang }: ViewProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (!cfg.slider_autoplay) return;
    const t = window.setInterval(() => {
      setIdx((i) => (i + 1) % posts.length);
    }, Math.max(2000, cfg.slider_interval_ms));
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
            <CardBody p={p} cfg={cfg} lang={lang} />
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
