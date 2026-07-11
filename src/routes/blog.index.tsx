// Public blog list. URL: /blog
import { createFileRoute } from "@tanstack/react-router";
import { RouteErrorFallback } from "@/components/molecules/RouteErrorFallback";
import { ArchiveSkeleton } from "@/components/archive/ArchiveSkeleton";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Fragment, useState, useTransition } from "react";
import { useTranslation } from "react-i18next";
import { AdSlotView } from "@/components/AdSlot";
import { Button } from "@/components/ui/button";
import { PostListCard } from "@/components/molecules/PostListCard";
import { useAdPlacements } from "@/lib/ads/queries";
import { blogListQueryOptions, BLOG_PAGE_SIZE } from "@/lib/queries/public";
import { getRequestUrl } from "@/lib/seo/request";
import { activeLang } from "@/lib/seo/head";
import { buildContentHead } from "@/lib/seo/meta";

export const Route = createFileRoute("/blog/")({
  // SSR prefetches only the first page (default limit); "load more" pages are
  // fetched client-side through the same query options with a bigger limit.
  loader: ({ context }) => context.queryClient.ensureQueryData(blogListQueryOptions()),

  head: () => {
    const url = getRequestUrl() || "/blog";
    const lang = activeLang(url);
    return buildContentHead({
      url,
      lang,
      type: "website",
      title: lang === "en" ? "Blog - New European Strategies" : "Blog - New European Strategies",
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
  // "Load more" grows the limit; useSuspenseQuery re-suspends on the new key,
  // so the bump runs inside a transition - React keeps the current grid on
  // screen (no blank fallback) and isPending drives the button spinner state.
  const [limit, setLimit] = useState(BLOG_PAGE_SIZE);
  const [isPending, startTransition] = useTransition();
  const {
    data: { posts },
  } = useSuspenseQuery(blogListQueryOptions(limit));
  const { t, i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const { data: feedAds } = useAdPlacements("in_feed", "home");
  const inFeed = feedAds ?? [];
  // The fetch filled the whole window -> more may exist on the server.
  const canLoadMore = posts.length >= limit;

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <div className="flex-1 max-w-[1200px] w-full mx-auto px-4 lg:px-8 py-10">
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
              const adsAfter = inFeed.filter((ad) => {
                const every = Math.max(1, Number((ad.config as { every?: number }).every ?? 5));
                return (idx + 1) % every === 0;
              });
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
                  {adsAfter.map((ad) => (
                    <div
                      key={ad.id}
                      className="md:col-span-2 lg:col-span-3 flex justify-center py-2"
                    >
                      <AdSlotView placement={ad} />
                    </div>
                  ))}
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
              onClick={() => startTransition(() => setLimit((n) => n + BLOG_PAGE_SIZE))}
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
    </div>
  );
}
