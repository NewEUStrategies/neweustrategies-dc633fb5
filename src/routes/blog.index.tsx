// Public blog list. URL: /blog
import { createFileRoute } from "@tanstack/react-router";
import { RouteErrorFallback } from "@/components/molecules/RouteErrorFallback";
import { ArchiveSkeleton } from "@/components/archive/ArchiveSkeleton";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Fragment, useState, useTransition } from "react";
import { useTranslation } from "react-i18next";
import { FooterSlideup } from "@/components/ads/FooterSlideup";
import { useInFeedAds } from "@/components/ads/useInFeedAds";
import { Button } from "@/components/ui/button";
import { PostListCard } from "@/components/molecules/PostListCard";
import { blogListQueryOptions, resolvePostsPerPage } from "@/lib/queries/public";
import { siteSettingsQueryOptions } from "@/lib/useSiteSetting";
import { getRequestUrl } from "@/lib/seo/request";
import { activeLang } from "@/lib/seo/head";
import { buildContentHead } from "@/lib/seo/meta";

export const Route = createFileRoute("/blog/")({
  // SSR prefetches only the first page; "load more" pages are fetched
  // client-side through the same query options with a bigger limit. Rozmiar
  // strony honoruje ustawienie czytania (posts_per_page) - ustawienia są już
  // ciepłe z root loadera, więc to odczyt z cache, nie dodatkowy fetch.
  loader: async ({ context }) => {
    const settings = await context.queryClient.ensureQueryData(siteSettingsQueryOptions);
    await context.queryClient.ensureQueryData(blogListQueryOptions(resolvePostsPerPage(settings)));
  },

  head: () => {
    const url = getRequestUrl() || "/blog";
    const lang = activeLang(url);
    return buildContentHead({
      url,
      lang,
      type: "website",
      title: "Blog - New European Strategies",
      description:
        lang === "en"
          ? "Analyses, interviews and reports - the New European Strategies blog."
          : "Analizy, wywiady i raporty - blog New European Strategies.",
    });
  },
  component: BlogIndex,
  pendingComponent: () => <ArchiveSkeleton />,
  errorComponent: (props) => (
    <RouteErrorFallback
      {...props}
      title={activeLang() === "en" ? "Failed to load the list" : "Nie udało się załadować listy"}
    />
  ),
});

function BlogIndex() {
  // Rozmiar strony z ustawień czytania (ten sam odczyt co loader - klucz
  // zapytania musi się zgadzać, inaczej hydracja robiłaby drugi fetch).
  const { data: settingsMap } = useSuspenseQuery(siteSettingsQueryOptions);
  const pageSize = resolvePostsPerPage(settingsMap);
  // "Load more" grows the limit; useSuspenseQuery re-suspends on the new key,
  // so the bump runs inside a transition - React keeps the current grid on
  // screen (no blank fallback) and isPending drives the button spinner state.
  const [limit, setLimit] = useState(pageSize);
  const [isPending, startTransition] = useTransition();
  const {
    data: { posts },
  } = useSuspenseQuery(blogListQueryOptions(limit));
  const { t, i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  // /blog to archiwum wpisów - dotąd pytał o typ "home", przez co placementy
  // zadeklarowane dla "Archiwa" nigdy się tu nie emitowały (a "home" mylnie tak).
  const inFeed = useInFeedAds("archive");
  // The fetch filled the whole window -> more may exist on the server.
  const canLoadMore = posts.length >= limit;

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <div className="flex-1 max-w-[1200px] w-full mx-auto px-4 lg:px-8 py-10">
        <Breadcrumbs items={[{ label: "Blog" }]} />
        <h1 className="font-display text-4xl lg:text-5xl mb-8">Blog</h1>
        {posts.length === 0 ? (
          <p className="text-muted-foreground">
            {t("blog.empty", {
              defaultValue:
                lang === "en" ? "No published posts yet." : "Brak opublikowanych wpisów.",
            })}
          </p>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {posts.map((p, idx) => {
              const adsAfter = inFeed(idx);
              return (
                <Fragment key={p.id}>
                  <PostListCard
                    post={p}
                    href={p.href}
                    lang={lang}
                    titleClassName="text-base"
                    priority={idx === 0}
                    viewTransitionId={p.id}
                  />
                  {adsAfter && (
                    <div className="md:col-span-2 lg:col-span-3 flex justify-center py-2">
                      {adsAfter}
                    </div>
                  )}
                </Fragment>
              );
            })}
          </div>
        )}
        {canLoadMore && (
          <div className="flex justify-center pt-6">
            <Button
              variant="outline"
              disabled={isPending}
              onClick={() => startTransition(() => setLimit((n) => n + pageSize))}
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
      </div>
      <FooterSlideup pageType="archive" />
    </div>
  );
}
