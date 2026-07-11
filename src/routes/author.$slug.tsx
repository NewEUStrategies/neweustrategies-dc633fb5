// Author profile + posts archive: /author/$slug
// Slug param may also be the user UUID for back-compat.
import { createFileRoute, notFound } from "@tanstack/react-router";
import { RouteErrorFallback } from "@/components/molecules/RouteErrorFallback";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useState, useTransition } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, Globe, Linkedin } from "lucide-react";
import { XIcon } from "@/components/atoms/XIcon";
import { BrandIcon } from "@/components/atoms/BrandIcon";
import { ArchivePostList } from "@/components/archive/ArchivePostList";
import { AuthorCvSections } from "@/components/author/AuthorCvSections";
import { Button } from "@/components/ui/button";
import { FollowButton } from "@/components/FollowButton";
import { usePersonalizedSettings } from "@/hooks/usePersonalizedSettings";
import { authorBySlugQueryOptions, ARCHIVE_PAGE_SIZE } from "@/lib/queries/archives";
import { getRequestUrl } from "@/lib/seo/request";
import { activeLang } from "@/lib/seo/head";
import { buildContentHead } from "@/lib/seo/meta";

export const Route = createFileRoute("/author/$slug")({
  // SSR prefetches only the first page (default limit); "load more" pages are
  // fetched client-side through the same query options with a bigger limit.
  loader: async ({ params, context }) => {
    const data = await context.queryClient.ensureQueryData(authorBySlugQueryOptions(params.slug));
    if (!data) throw notFound();
    return data;
  },
  head: ({ loaderData, params }) => {
    const author = loaderData?.author;
    const url = getRequestUrl() || `/author/${params.slug}`;
    const lang = activeLang(url);
    const name = author?.display_name ?? (lang === "en" ? "Author" : "Autor");
    const bio = author
      ? lang === "en"
        ? author.bio_en || author.bio_pl
        : author.bio_pl || author.bio_en
      : null;
    return buildContentHead({
      url,
      lang,
      type: "website",
      title: lang === "en" ? `${name} - author` : `${name} - autor`,
      description:
        (bio ?? "")
          .replace(/<[^>]+>/g, " ")
          .trim()
          .slice(0, 160) || (lang === "en" ? `Articles by ${name}.` : `Wpisy autora ${name}.`),
      image: author?.avatar_url ?? null,
    });
  },
  component: AuthorArchivePage,
  notFoundComponent: AuthorNotFound,
  errorComponent: (props) => (
    <RouteErrorFallback
      {...props}
      title={
        activeLang() === "en" ? "Failed to load the profile" : "Nie udało się załadować profilu"
      }
    />
  ),
});

function AuthorArchivePage() {
  const { slug } = Route.useParams();
  // Limit window keyed by slug: navigating to another author must start from
  // the first page again instead of carrying over an inflated "load more" limit.
  const [paging, setPaging] = useState({ slug, limit: ARCHIVE_PAGE_SIZE });
  const limit = paging.slug === slug ? paging.limit : ARCHIVE_PAGE_SIZE;
  // The bump re-suspends useSuspenseQuery (new query key), so it runs inside a
  // transition - the current grid stays on screen instead of a blank fallback.
  const [isPending, startTransition] = useTransition();
  const { data } = useSuspenseQuery(authorBySlugQueryOptions(slug, limit));
  const { t, i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const personalized = usePersonalizedSettings();
  if (!data) return <AuthorNotFound />;
  const { author, posts } = data;
  const name = author.display_name ?? (lang === "en" ? "Author" : "Autor");
  const bio = lang === "en" ? (author.bio_en ?? author.bio_pl) : (author.bio_pl ?? author.bio_en);
  const canLoadMore = posts.length >= limit;

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <main className="flex-1 w-full">
        <header className="relative">
          {author.cover_url && (
            <div className="h-40 sm:h-56 w-full overflow-hidden bg-muted">
              <img src={author.cover_url} alt="" className="w-full h-full object-cover" />
            </div>
          )}
          <div className="max-w-[1200px] mx-auto px-4 lg:px-8 py-8">
            <div className="flex flex-col sm:flex-row gap-5 items-start">
              {author.avatar_url && (
                <img
                  src={author.avatar_url}
                  alt={name}
                  className="w-24 h-24 rounded-full object-cover border-4 border-background -mt-16 shadow"
                />
              )}
              <div className="flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="font-display text-3xl lg:text-4xl">{name}</h1>
                  {personalized.followInAuthorHeader && (
                    <FollowButton targetType="author" targetId={author.id} lang={lang} />
                  )}
                </div>
                {bio && <p className="text-muted-foreground max-w-2xl">{bio}</p>}
                <div className="flex flex-wrap gap-3 pt-1 text-sm">
                  {author.website_url && (
                    <a
                      href={author.website_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 hover:text-brand"
                    >
                      <BrandIcon name="website" fallback={Globe} className="w-4 h-4" alt="WWW" />
                      WWW
                    </a>
                  )}
                  {author.twitter_url && (
                    <a
                      href={author.twitter_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 hover:text-brand"
                    >
                      <BrandIcon name="x" fallback={XIcon} className="w-4 h-4" alt="X" />X
                    </a>
                  )}
                  {author.linkedin_url && (
                    <a
                      href={author.linkedin_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 hover:text-brand"
                    >
                      <BrandIcon
                        name="linkedin"
                        fallback={Linkedin}
                        className="w-4 h-4"
                        alt="LinkedIn"
                      />
                      LinkedIn
                    </a>
                  )}
                </div>
              </div>
            </div>
          </div>
        </header>
        <AuthorCvSections userId={author.id} />
        <section className="max-w-[1200px] mx-auto px-4 lg:px-8 pb-12">
          <h2 className="font-display text-2xl mb-5">
            {lang === "en" ? "Author's posts" : "Wpisy autora"}
          </h2>
          <ArchivePostList
            posts={posts}
            lang={lang}
            emptyText={t("archive.empty", {
              defaultValue:
                lang === "en" ? "No published posts yet." : "Brak opublikowanych wpisów.",
            })}
          />
          {canLoadMore && (
            <div className="flex justify-center pt-6">
              <Button
                variant="outline"
                disabled={isPending}
                onClick={() =>
                  startTransition(() => setPaging({ slug, limit: limit + ARCHIVE_PAGE_SIZE }))
                }
              >
                {isPending
                  ? t("common.loading", {
                      defaultValue: lang === "en" ? "Loading..." : "Ładowanie...",
                    })
                  : t("common.loadMore", {
                      defaultValue: lang === "en" ? "Load more" : "Załaduj więcej",
                    })}
              </Button>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function AuthorNotFound() {
  const { t, i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 flex items-center justify-center px-4">
        <div className="text-center space-y-3">
          <h1 className="font-display text-3xl">
            {t("archive.authorNotFound", {
              defaultValue: lang === "en" ? "Author not found" : "Autor nie znaleziony",
            })}
          </h1>
          <a
            href="/blog"
            className="inline-flex items-center gap-1 text-brand hover:underline text-sm"
          >
            <ExternalLink className="w-3 h-3" />
            {t("archive.backToBlog", {
              defaultValue: lang === "en" ? "Back to the blog" : "Wróć na blog",
            })}
          </a>
        </div>
      </main>
    </div>
  );
}
