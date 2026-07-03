// Public blog list. URL: /blog
import { createFileRoute } from "@tanstack/react-router";
import { RouteErrorFallback } from "@/components/molecules/RouteErrorFallback";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { AdSlotView } from "@/components/AdSlot";
import { PostListCard } from "@/components/molecules/PostListCard";
import { useAdPlacements } from "@/lib/ads/queries";
import { blogListQueryOptions } from "@/lib/queries/public";
import { getRequestUrl } from "@/lib/seo/request";
import { activeLang } from "@/lib/seo/head";
import { buildContentHead } from "@/lib/seo/meta";

export const Route = createFileRoute("/blog/")({
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
  errorComponent: (props) => (
    <RouteErrorFallback {...props} title="Nie udało się załadować listy" />
  ),
});

function BlogIndex() {
  const {
    data: { posts },
  } = useSuspenseQuery(blogListQueryOptions());
  const { i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const { data: feedAds } = useAdPlacements("in_feed", "home");
  const inFeed = feedAds ?? [];

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <main className="flex-1 max-w-[1200px] w-full mx-auto px-4 lg:px-8 py-10">
        <h1 className="font-display text-4xl lg:text-5xl mb-8">Blog</h1>
        {posts.length === 0 ? (
          <p className="text-muted-foreground">Brak opublikowanych wpisów.</p>
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
      </main>
    </div>
  );
}
