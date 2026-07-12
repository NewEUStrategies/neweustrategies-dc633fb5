// Publiczny indeks relacji na żywo. URL: /live
// Do tej pory live blog nie miał żadnego publicznego adresu - redakcja nie
// mogła nigdzie podlinkować "relacji", a czytelnik/crawler nie miał jak
// odkryć, że trwa wydarzenie. Ta strona listuje posty z osadzoną relacją,
// z pulsującą plakietką LIVE dla aktywnych (wpis w ostatnich 3 godzinach).
import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Radio } from "lucide-react";
import { AppLink } from "@/components/atoms/AppLink";
import { RouteErrorFallback } from "@/components/molecules/RouteErrorFallback";
import { ArchiveSkeleton } from "@/components/archive/ArchiveSkeleton";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { isLiveNow, liveBlogsQueryOptions } from "@/lib/queries/liveBlogs";
import { activeLang } from "@/lib/seo/head";
import { buildContentHead } from "@/lib/seo/meta";
import { getRequestUrl } from "@/lib/seo/request";

export const Route = createFileRoute("/live")({
  loader: ({ context }) => context.queryClient.ensureQueryData(liveBlogsQueryOptions()),
  head: () => {
    const url = getRequestUrl() || "/live";
    const lang = activeLang(url);
    return buildContentHead({
      url,
      lang,
      type: "website",
      title:
        lang === "en"
          ? "Live coverage - New European Strategies"
          : "Relacje na żywo - New European Strategies",
      description:
        lang === "en"
          ? "Ongoing and recent live coverage of key European events."
          : "Trwające i niedawne relacje na żywo z kluczowych wydarzeń europejskich.",
    });
  },
  component: LiveIndex,
  pendingComponent: () => <ArchiveSkeleton />,
  errorComponent: (props) => (
    <RouteErrorFallback
      {...props}
      title={
        activeLang() === "en" ? "Failed to load live blogs" : "Nie udało się załadować relacji"
      }
    />
  ),
});

function LiveIndex() {
  const { data } = useSuspenseQuery(liveBlogsQueryOptions());
  const { i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const L = (pl: string, en: string) => (lang === "pl" ? pl : en);
  const locale = lang === "pl" ? "pl-PL" : "en-US";

  return (
    <div className="max-w-[1200px] mx-auto px-4 lg:px-8 py-8">
      <Breadcrumbs items={[{ label: L("Na żywo", "Live") }]} />
      <header className="mb-8">
        <h1 className="font-display text-3xl lg:text-4xl flex items-center gap-3">
          <Radio className="h-7 w-7 text-red-600" aria-hidden />
          {L("Relacje na żywo", "Live coverage")}
        </h1>
        <p className="mt-2 text-muted-foreground">
          {L(
            "Trwające i niedawne relacje na żywo z kluczowych wydarzeń.",
            "Ongoing and recent live coverage of key events.",
          )}
        </p>
      </header>

      {data.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          {L(
            "Obecnie nie prowadzimy żadnej relacji na żywo. Zajrzyj później.",
            "No live coverage is running right now. Check back later.",
          )}
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {data.map(({ post, lastEntryAt, entryCount }) => {
            const live = isLiveNow(lastEntryAt);
            const title =
              (lang === "en" ? post.title_en || post.title_pl : post.title_pl || post.title_en) ??
              post.slug;
            const excerpt =
              lang === "en"
                ? post.excerpt_en || post.excerpt_pl
                : post.excerpt_pl || post.excerpt_en;
            return (
              <li key={post.id}>
                <AppLink
                  href={post.href}
                  className="flex h-full flex-col gap-3 rounded-xl border border-border bg-card p-5 transition-colors hover:border-foreground/30"
                >
                  <div className="flex items-center gap-2 text-xs">
                    {live ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-red-600/10 px-2.5 py-1 font-semibold uppercase tracking-wide text-red-600">
                        <span className="relative flex h-2 w-2">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-red-600" />
                        </span>
                        {L("Na żywo", "Live")}
                      </span>
                    ) : (
                      <span className="rounded-full bg-muted px-2.5 py-1 font-medium uppercase tracking-wide text-muted-foreground">
                        {L("Zakończona", "Ended")}
                      </span>
                    )}
                    <span className="text-muted-foreground">
                      {L("Ostatni wpis:", "Last update:")}{" "}
                      {new Date(lastEntryAt).toLocaleString(locale)}
                    </span>
                  </div>
                  <h2 className="font-display text-xl leading-snug m-0">{title}</h2>
                  {excerpt && (
                    <p className="text-sm text-muted-foreground line-clamp-2 m-0">{excerpt}</p>
                  )}
                  <span className="mt-auto text-xs text-muted-foreground">
                    {entryCount}{" "}
                    {lang === "pl"
                      ? entryCount === 1
                        ? "wpis"
                        : entryCount < 5
                          ? "wpisy"
                          : "wpisów"
                      : entryCount === 1
                        ? "update"
                        : "updates"}
                  </span>
                </AppLink>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
