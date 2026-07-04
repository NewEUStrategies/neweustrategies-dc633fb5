// Publiczne renderery dla Phase 2 batch 7: author-bio, related-posts.
// Korzystają z CurrentPostCtx (author, categories, tags); dociąganie danych
// idzie przez react-query (blocks.ts), więc prefetch SSR w loaderze $.tsx
// renderuje powiązane wpisy również dla crawlerów.

import { useMemo, type ComponentType, type SVGProps } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  authorPostsCountQueryOptions,
  authorProfileByIdQueryOptions,
  relatedPostsBlockQueryOptions,
} from "@/lib/queries/blocks";
import { useCurrentPostCtx, type CurrentPostAuthor } from "@/lib/builder/currentPostContext";
import { AppLink } from "@/components/atoms/AppLink";
import { OptimizedImage } from "@/components/atoms/OptimizedImage";
import { User, Mail, Globe, Twitter, Linkedin, Facebook, Instagram, Music } from "lucide-react";

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
  /** Explicit author id - overrides the author from the current post context. */
  authorId?: string;
  /** Fully materialized author - used by the admin preview to avoid fetching. */
  authorOverride?: CurrentPostAuthor | null;
}

export function AuthorBioView({
  showAvatar = true,
  showSocial = true,
  showPostsCount = true,
  variant = "card",
  lang = "pl",
  cls,
  authorId,
  authorOverride,
}: AuthorBioProps) {
  const ctx = useCurrentPostCtx();
  const t = L[lang];
  const { data: fetched } = useQuery({
    ...authorProfileByIdQueryOptions(authorId ?? ""),
    enabled: !authorOverride && !!authorId,
  });
  const author: CurrentPostAuthor | null = authorOverride
    ? authorOverride
    : fetched
      ? {
          id: fetched.id,
          name: fetched.display_name ?? undefined,
          slug: fetched.slug ?? undefined,
          avatarUrl: fetched.avatar_url ?? undefined,
          bio_pl: fetched.bio_pl ?? undefined,
          bio_en: fetched.bio_en ?? undefined,
          jobTitle: fetched.job_title ?? undefined,
          contactEmail: fetched.contact_email ?? undefined,
          twitterUrl: fetched.twitter_url ?? undefined,
          linkedinUrl: fetched.linkedin_url ?? undefined,
          facebookUrl: fetched.facebook_url ?? undefined,
          instagramUrl: fetched.instagram_url ?? undefined,
          spotifyUrl: fetched.spotify_url ?? undefined,
          websiteUrl: fetched.website_url ?? undefined,
        }
      : (ctx?.author ?? null);
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

  type IconCmp = ComponentType<SVGProps<SVGSVGElement>>;
  const socials: Array<{ key: string; href: string; label: string; Icon: IconCmp }> = [];
  if (author.contactEmail) {
    socials.push({
      key: "email",
      href: `mailto:${author.contactEmail}`,
      label: author.contactEmail,
      Icon: Mail,
    });
  }
  if (author.twitterUrl) {
    socials.push({ key: "twitter", href: author.twitterUrl, label: "X / Twitter", Icon: Twitter });
  }
  if (author.linkedinUrl) {
    socials.push({ key: "linkedin", href: author.linkedinUrl, label: "LinkedIn", Icon: Linkedin });
  }
  if (author.facebookUrl) {
    socials.push({ key: "facebook", href: author.facebookUrl, label: "Facebook", Icon: Facebook });
  }
  if (author.instagramUrl) {
    socials.push({
      key: "instagram",
      href: author.instagramUrl,
      label: "Instagram",
      Icon: Instagram,
    });
  }
  if (author.spotifyUrl) {
    socials.push({ key: "spotify", href: author.spotifyUrl, label: "Spotify", Icon: Music });
  }
  if (author.websiteUrl) {
    socials.push({ key: "website", href: author.websiteUrl, label: t.viewProfile, Icon: Globe });
  }

  const avatarSize =
    variant === "card" ? "w-24 h-24" : variant === "inline" ? "w-16 h-16" : "w-11 h-11";
  const avatar = showAvatar ? (
    author.avatarUrl ? (
      <OptimizedImage
        src={author.avatarUrl}
        alt={author.name}
        className="rounded-full object-cover w-full h-full ring-2 ring-border"
        sizes="96px"
      />
    ) : (
      <div className="w-full h-full rounded-full bg-muted flex items-center justify-center text-muted-foreground ring-2 ring-border">
        <User className="w-1/2 h-1/2" aria-hidden />
      </div>
    )
  ) : null;

  const socialIcons = showSocial && socials.length > 0 && (
    <div className="flex items-center gap-1.5 flex-wrap">
      {socials.map(({ key, href, label, Icon }) => (
        <a
          key={key}
          href={href}
          target={href.startsWith("mailto:") ? undefined : "_blank"}
          rel={href.startsWith("mailto:") ? undefined : "noreferrer"}
          aria-label={label}
          title={label}
          className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-foreground/40 hover:bg-muted transition-colors"
        >
          <Icon width={14} height={14} aria-hidden />
        </a>
      ))}
    </div>
  );

  const displayNameEl = profileHref ? (
    <AppLink href={profileHref} className="hover:text-primary transition-colors">
      {author.name}
    </AppLink>
  ) : (
    <>{author.name}</>
  );

  if (variant === "minimal") {
    return (
      <div className={`not-prose flex items-center gap-3 ${cls ?? ""}`}>
        {showAvatar && <div className={`${avatarSize} shrink-0`}>{avatar}</div>}
        <div className="min-w-0">
          <div
            className="text-foreground font-semibold leading-tight"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {displayNameEl}
          </div>
          {author.jobTitle && (
            <div className="text-xs text-muted-foreground truncate">{author.jobTitle}</div>
          )}
          {showPostsCount && postsCount !== null && (
            <div className="text-[11px] text-muted-foreground mt-0.5">{t.posts(postsCount)}</div>
          )}
        </div>
      </div>
    );
  }

  if (variant === "inline") {
    return (
      <div className={`not-prose flex items-start gap-4 py-4 ${cls ?? ""}`}>
        {showAvatar && <div className={`${avatarSize} shrink-0`}>{avatar}</div>}
        <div className="flex-1 min-w-0 space-y-1.5">
          <div
            className="text-base font-semibold text-foreground leading-tight"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {displayNameEl}
          </div>
          {author.jobTitle && (
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {author.jobTitle}
            </div>
          )}
          {bio && <p className="text-sm text-muted-foreground m-0 line-clamp-2">{bio}</p>}
          <div className="flex items-center gap-3 pt-1">
            {socialIcons}
            {showPostsCount && postsCount !== null && (
              <span className="text-[11px] text-muted-foreground">{t.posts(postsCount)}</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  // card
  return (
    <aside
      className={`not-prose rounded-2xl border border-border bg-card p-6 shadow-sm ${cls ?? ""}`}
    >
      <div className="flex items-start gap-5">
        {showAvatar && <div className={`${avatarSize} shrink-0`}>{avatar}</div>}
        <div className="flex-1 min-w-0">
          <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            {t.about}
          </div>
          <div
            className="text-2xl font-bold text-foreground leading-tight mt-1"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {displayNameEl}
          </div>
          {author.jobTitle && (
            <div className="text-sm text-muted-foreground mt-0.5">{author.jobTitle}</div>
          )}
          {bio && <p className="text-sm text-foreground/80 mt-3 m-0 leading-relaxed">{bio}</p>}
          <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              {showPostsCount && postsCount !== null && <span>{t.posts(postsCount)}</span>}
              {profileHref && (
                <AppLink href={profileHref} className="text-primary hover:underline font-medium">
                  {t.viewProfile} →
                </AppLink>
              )}
            </div>
            {socialIcons}
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
