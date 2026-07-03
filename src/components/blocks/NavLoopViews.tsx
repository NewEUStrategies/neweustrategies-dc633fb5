// Publiczne renderery dla bloków Phase 2 batch 5: navigation, post-navigation-link, query-loop.
// Dane przez react-query (blocks.ts) - z prefetchem SSR w loaderze $.tsx te
// widoki renderują pełne HTML dla crawlerów zamiast pustych placeholderów.
import { useQuery } from "@tanstack/react-query";
import {
  blockNavigationQueryOptions,
  postNeighborQueryOptions,
  queryLoopBlockQueryOptions,
} from "@/lib/queries/blocks";
import { useCurrentPostCtx } from "@/lib/builder/currentPostContext";
import { AppLink } from "@/components/atoms/AppLink";
import { OptimizedImage } from "@/components/atoms/OptimizedImage";

type Lang = "pl" | "en";

export function NavigationView({
  menuKey,
  layout,
  lang,
  cls,
}: {
  menuKey: string;
  layout: string;
  lang: Lang;
  cls: string;
}) {
  // MVP: top-level categories as primary navigation menu (menuKey for future routing).
  const { data: items = [] } = useQuery(blockNavigationQueryOptions());

  if (items.length === 0) return null;
  const vertical = layout === "vertical";
  return (
    <nav className={cls} aria-label={menuKey}>
      <ul
        className={`not-prose flex ${vertical ? "flex-col gap-1" : "flex-row flex-wrap gap-4"} m-0 p-0 list-none`}
      >
        {items.map((it) => {
          const label = (lang === "en" ? it.name_en : it.name_pl) ?? it.name_pl ?? it.name_en ?? "";
          if (!label) return null;
          return (
            <li key={it.id}>
              <AppLink
                href={`/category/${it.slug}`}
                className="text-sm font-medium hover:text-primary"
              >
                {label}
              </AppLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function PostNavigationLinkView({
  direction,
  showTitle,
  lang,
  cls,
}: {
  direction: "prev" | "next";
  showTitle: boolean;
  lang: Lang;
  cls: string;
}) {
  const ctx = useCurrentPostCtx();
  const enabled = !!ctx?.id && !!ctx?.publishedAt;
  const { data } = useQuery({
    ...postNeighborQueryOptions({
      currentId: ctx?.id ?? "",
      publishedAt: ctx?.publishedAt ?? "",
      direction,
    }),
    enabled,
  });

  if (!data) return null;
  const title = (lang === "en" ? data.post.title_en : data.post.title_pl) ?? "";
  const arrow = direction === "next" ? "→" : "←";
  return (
    <div className={`not-prose ${cls}`}>
      <AppLink
        href={data.href}
        className="inline-flex items-center gap-2 text-sm font-medium hover:text-primary"
      >
        {direction === "prev" && <span>{arrow}</span>}
        <span className="flex flex-col">
          <span className="text-xs text-muted-foreground uppercase tracking-wide">
            {direction === "next"
              ? lang === "en"
                ? "Next"
                : "Następny"
              : lang === "en"
                ? "Previous"
                : "Poprzedni"}
          </span>
          {showTitle && <span>{title}</span>}
        </span>
        {direction === "next" && <span>{arrow}</span>}
      </AppLink>
    </div>
  );
}

export function QueryLoopView({
  categorySlug,
  limit,
  layout,
  showExcerpt,
  showDate,
  showImage,
  orderBy,
  lang,
  cls,
}: {
  categorySlug: string;
  limit: number;
  layout: "grid" | "list";
  showExcerpt: boolean;
  showDate: boolean;
  showImage: boolean;
  orderBy: "date" | "title";
  lang: Lang;
  cls: string;
}) {
  const { data: posts = [] } = useQuery(
    queryLoopBlockQueryOptions({ categorySlug, limit, orderBy, lang }),
  );

  if (posts.length === 0) return null;

  const isGrid = layout === "grid";
  const container = isGrid
    ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6"
    : "flex flex-col gap-6";

  return (
    <div className={`not-prose ${cls}`}>
      <ul className={`${container} list-none m-0 p-0`}>
        {posts.map((p) => {
          const title = (lang === "en" ? p.title_en : p.title_pl) ?? "";
          const excerpt = (lang === "en" ? p.excerpt_en : p.excerpt_pl) ?? "";
          const href = `/post/${p.slug}`;
          return (
            <li key={p.id} className="flex flex-col gap-2">
              {showImage && p.cover_image_url && (
                <AppLink
                  href={href}
                  className="block overflow-hidden rounded-lg"
                  style={{ aspectRatio: "4 / 3" }}
                >
                  <OptimizedImage
                    src={p.cover_image_url}
                    alt={title}
                    className="w-full h-full object-cover"
                    responsive
                    sizes="(max-width: 768px) 100vw, 400px"
                  />
                </AppLink>
              )}
              <h3 className="font-serif text-lg leading-tight m-0">
                <AppLink href={href} className="hover:text-primary">
                  {title}
                </AppLink>
              </h3>
              {showDate && p.published_at && (
                <time className="text-xs text-muted-foreground" dateTime={p.published_at}>
                  {new Intl.DateTimeFormat(lang === "en" ? "en" : "pl", {
                    dateStyle: "medium",
                  }).format(new Date(p.published_at))}
                </time>
              )}
              {showExcerpt && excerpt && (
                <p className="text-sm text-muted-foreground m-0">{excerpt}</p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
