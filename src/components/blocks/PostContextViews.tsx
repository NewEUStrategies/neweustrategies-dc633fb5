// Publiczne renderery dla Phase 2 batch 7: author-bio, related-posts.
// Korzystają z CurrentPostCtx (author, categories, tags); dociąganie danych
// idzie przez react-query (blocks.ts), więc prefetch SSR w loaderze $.tsx
// renderuje powiązane wpisy również dla crawlerów.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { authorPostsCountQueryOptions, relatedPostsBlockQueryOptions } from "@/lib/queries/blocks";
import { useCurrentPostCtx } from "@/lib/builder/currentPostContext";
import { AppLink } from "@/components/atoms/AppLink";
import { OptimizedImage } from "@/components/atoms/OptimizedImage";
import { User } from "lucide-react";

type Lang = "pl" | "en";

const L = {
  pl: {
    about: "O autorze",
    posts: (n: number) => `${n} ${n === 1 ? "wpis" : n < 5 ? "wpisy" : "wpisów"}`,
    related: "Powiązane wpisy",
    viewProfile: "Zobacz profil",
  },
  en: {
    about: "About the author",
    posts: (n: number) => `${n} ${n === 1 ? "post" : "posts"}`,
    related: "Related posts",
    viewProfile: "View profile",
  },
} as const;

// -------- Author bio --------

interface AuthorBioProps {
  showAvatar?: boolean;
  showSocial?: boolean;
  showPostsCount?: boolean;
  variant?: "card" | "inline" | "minimal";
  lang?: Lang;
  cls?: string;
}

export function AuthorBioView({
  showAvatar = true,
  showSocial = true,
  showPostsCount = true,
  variant = "card",
  lang = "pl",
  cls,
}: AuthorBioProps) {
  const ctx = useCurrentPostCtx();
  const t = L[lang];
  const author = ctx?.author;
  const { data: postsCountData } = useQuery({
    ...authorPostsCountQueryOptions(author?.id ?? ""),
    enabled: showPostsCount && !!author?.id,
  });
  const postsCount = postsCountData ?? null;

  if (!author?.name) {
    return (
      <div className={cls}>
        <span className="text-xs text-muted-foreground italic">[author-bio]</span>
      </div>
    );
  }

  const bio =
    (lang === "en" ? author.bio_en : author.bio_pl) ?? author.bio_pl ?? author.bio_en ?? "";
  const profileHref = author.slug ? `/author/${author.slug}` : null;

  const avatar = showAvatar ? (
    author.avatarUrl ? (
      <OptimizedImage
        src={author.avatarUrl}
        alt={author.name}
        className="rounded-full object-cover w-full h-full"
        sizes="80px"
      />
    ) : (
      <div className="w-full h-full rounded-full bg-muted flex items-center justify-center text-muted-foreground">
        <User className="w-1/2 h-1/2" aria-hidden />
      </div>
    )
  ) : null;

  if (variant === "minimal") {
    return (
      <div className={`not-prose flex items-center gap-3 ${cls ?? ""}`}>
        {showAvatar && <div className="w-10 h-10 shrink-0">{avatar}</div>}
        <div className="text-sm">
          <div className="text-foreground font-medium">{author.name}</div>
          {showPostsCount && postsCount !== null && (
            <div className="text-xs text-muted-foreground">{t.posts(postsCount)}</div>
          )}
        </div>
      </div>
    );
  }

  if (variant === "inline") {
    return (
      <div className={`not-prose flex items-start gap-4 py-4 ${cls ?? ""}`}>
        {showAvatar && <div className="w-14 h-14 shrink-0">{avatar}</div>}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-foreground">{author.name}</div>
          {bio && <p className="text-sm text-muted-foreground mt-1 m-0">{bio}</p>}
        </div>
      </div>
    );
  }

  // card
  return (
    <aside className={`not-prose rounded-xl border border-border bg-card p-5 ${cls ?? ""}`}>
      <div className="flex items-start gap-4">
        {showAvatar && <div className="w-20 h-20 shrink-0">{avatar}</div>}
        <div className="flex-1 min-w-0">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{t.about}</div>
          <div className="text-lg font-serif font-semibold text-foreground leading-tight mt-0.5">
            {profileHref ? (
              <AppLink href={profileHref} className="hover:text-primary">
                {author.name}
              </AppLink>
            ) : (
              author.name
            )}
          </div>
          {bio && <p className="text-sm text-muted-foreground mt-2 m-0">{bio}</p>}
          <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
            {showPostsCount && postsCount !== null && <span>{t.posts(postsCount)}</span>}
            {showSocial && profileHref && (
              <AppLink href={profileHref} className="text-primary hover:underline">
                {t.viewProfile}
              </AppLink>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}

// -------- Related posts --------

interface RelatedPostsProps {
  limit?: number;
  strategy?: "category" | "tag" | "author" | "latest";
  layout?: "grid" | "list" | "compact";
  heading?: string;
  lang?: Lang;
  cls?: string;
}

interface RelatedRow {
  id: string;
  slug: string;
  title_pl: string | null;
  title_en: string | null;
  cover_image_url: string | null;
  published_at: string | null;
}

export function RelatedPostsView({
  limit = 3,
  strategy = "category",
  layout = "grid",
  heading,
  lang = "pl",
  cls,
}: RelatedPostsProps) {
  const ctx = useCurrentPostCtx();
  const t = L[lang];

  const currentId = ctx?.id ?? null;
  const categorySlugs = useMemo(
    () => (ctx?.categories ?? []).map((c) => c.slug),
    [ctx?.categories],
  );
  const tagSlugs = useMemo(() => (ctx?.tags ?? []).map((tg) => tg.slug), [ctx?.tags]);
  const authorId = ctx?.author?.id ?? null;

  const { data } = useQuery(
    relatedPostsBlockQueryOptions({
      currentId,
      strategy,
      categorySlugs,
      tagSlugs,
      authorId,
      limit,
    }),
  );
  const posts: RelatedRow[] = data ?? [];

  if (posts.length === 0) return null;

  const title = heading?.trim() || t.related;

  if (layout === "compact") {
    return (
      <section className={`not-prose ${cls ?? ""}`} aria-label={title}>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
          {title}
        </h3>
        <ul className="flex flex-col gap-2 list-none m-0 p-0">
          {posts.map((p) => {
            const tt = (lang === "en" ? p.title_en : p.title_pl) ?? "";
            return (
              <li key={p.id}>
                <AppLink
                  href={`/post/${p.slug}`}
                  className="text-sm text-foreground hover:text-primary"
                >
                  {tt}
                </AppLink>
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

  const isGrid = layout === "grid";
  const container = isGrid
    ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5"
    : "flex flex-col gap-5";

  return (
    <section className={`not-prose ${cls ?? ""}`} aria-label={title}>
      <h3 className="font-serif text-xl font-semibold text-foreground mb-4">{title}</h3>
      <ul className={`${container} list-none m-0 p-0`}>
        {posts.map((p) => {
          const tt = (lang === "en" ? p.title_en : p.title_pl) ?? "";
          const href = `/post/${p.slug}`;
          return (
            <li key={p.id} className={isGrid ? "flex flex-col gap-2" : "flex gap-4 items-start"}>
              {p.cover_image_url && (
                <AppLink
                  href={href}
                  className={
                    isGrid
                      ? "block overflow-hidden rounded-lg"
                      : "block overflow-hidden rounded-lg shrink-0 w-32"
                  }
                  style={{ aspectRatio: "4 / 3" }}
                >
                  <OptimizedImage
                    src={p.cover_image_url}
                    alt={tt}
                    className="w-full h-full object-cover"
                    responsive
                    sizes={isGrid ? "(max-width: 768px) 100vw, 400px" : "128px"}
                  />
                </AppLink>
              )}
              <div className={isGrid ? "" : "flex-1 min-w-0"}>
                <h4 className="font-serif text-base leading-tight m-0">
                  <AppLink href={href} className="hover:text-primary">
                    {tt}
                  </AppLink>
                </h4>
                {p.published_at && (
                  <time
                    className="text-xs text-muted-foreground mt-1 block"
                    dateTime={p.published_at}
                  >
                    {new Intl.DateTimeFormat(lang === "en" ? "en" : "pl", {
                      dateStyle: "medium",
                    }).format(new Date(p.published_at))}
                  </time>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
