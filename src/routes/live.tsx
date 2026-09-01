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
import { DegradedDataNotice } from "@/components/molecules/DegradedDataNotice";
import { isLiveNow, liveBlogsQueryOptions, type LiveBlogListItem } from "@/lib/queries/liveBlogs";
import { loadResilient, resilientCacheControl } from "@/lib/ssr/resilientLoad";
import { setCacheControlHeader } from "@/lib/http/responseHeaders";
import { liveCacheControl } from "@/lib/http/defaultCacheControl";
import { activeLang } from "@/lib/seo/head";
import {
  SITE_CANONICAL_ORIGIN,
  buildContentHead,
  feedAlternateLink,
  splitUrl,
} from "@/lib/seo/meta";
import { getRequestUrl } from "@/lib/seo/request";
import { formatDate } from "@/lib/i18n/format";
import { useNowMs } from "@/lib/time/useNowMs";

/** Pusta lista jako fallback zdegradowanego renderu (lib/ssr/resilientLoad). */
const NO_LIVE_BLOGS: LiveBlogListItem[] = [];

export const Route = createFileRoute("/live")({
  // Odporne SSR: blip backendu daje HTTP 200 z uczciwym komunikatem zamiast
  // 500 (patrz lib/ssr/resilientLoad). Zdegradowany render nie idzie do
  // cache'a wspólnego, więc pustka nie zamarza na brzegu CDN.
  loader: async ({ context }) => {
    const { degraded } = await loadResilient(
      context.queryClient,
      liveBlogsQueryOptions(),
      NO_LIVE_BLOGS,
    );
    // Czysty render relacji na żywo dostaje POLITYKĘ ŻYWĄ (s-maxage 30 s), nie
    // domyślną politykę treści (900 s): czytelnik trwającej relacji nie może
    // dostawać wpisu sprzed 15 minut. Ta sama wartość, którą dla `/live`
    // deklaruje `planDefaultCacheControl` - jedna doktryna, jedno źródło.
    setCacheControlHeader(resilientCacheControl(degraded, liveCacheControl()));
    return { degraded };
  },
  head: () => {
    const url = getRequestUrl() || "/live";
    const lang = activeLang(url);
    const head = buildContentHead({
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
    // Autodiscovery kanału relacji: czytelnik trwającej relacji ma dostawać
    // kolejne wpisy pushem, a nie odświeżać stronę.
    const origin = splitUrl(url).origin || SITE_CANONICAL_ORIGIN;
    return {
      ...head,
      links: [
        ...head.links,
        feedAlternateLink({
          origin,
          feedPath: "/live/rss.xml",
          title: lang === "en" ? "Live coverage - RSS" : "Relacje na żywo - RSS",
          lang,
        }),
      ],
    };
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
  const { degraded } = Route.useLoaderData();
  const { i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const L = (pl: string, en: string) => (lang === "pl" ? pl : en);
  // „TERAZ" DOPIERO PO MONTAŻU. `isLiveNow()` domyśla sobie `Date.now()`, więc
  // plakietka „Na żywo" / „Zakończona" była liczona ZEGAREM SERWERA - na Workers
  // kwantowanym do ostatniego I/O - i konserwowana w cache brzegowym. Klient po
  // hydratacji liczył ją inaczej, a to nie jest rozjazd TEKSTU, tylko
  // STRUKTURY: gałąź „na żywo" niesie trzy dodatkowe elementy z animacją.
  // React 19 odpowiada na to przebudową całego poddrzewa.
  const nowMs = useNowMs(30_000);

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

      {degraded ? (
        // Pusta lista i „nic nie dojechało" wyglądają identycznie - a to dwie
        // różne prawdy. Przy degradacji mówimy wprost, co się stało.
        <DegradedDataNotice
          title={L("Nie udało się załadować relacji", "Couldn't load live coverage")}
        />
      ) : data.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          {L(
            "Obecnie nie prowadzimy żadnej relacji na żywo. Zajrzyj później.",
            "No live coverage is running right now. Check back later.",
          )}
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {data.map(({ post, lastEntryAt, entryCount }) => {
            // Pierwsze przejście (serwer + hydratacja) NIE ZGADUJE: dopóki nie
            // znamy chwili klienta, relacja jest opisana neutralnie.
            const live = nowMs === null ? false : isLiveNow(lastEntryAt, nowMs);
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
                      {/* `formatDate` domyka strefę serwisu. `toLocaleString`
                          bez opcji brał strefę MASZYNY (UTC na serwerze,
                          strefa czytelnika w przeglądarce) - czyli inną
                          godzinę po obu stronach hydratacji. */}
                      {formatDate(lastEntryAt, lang, {
                        year: "numeric",
                        month: "numeric",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
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
