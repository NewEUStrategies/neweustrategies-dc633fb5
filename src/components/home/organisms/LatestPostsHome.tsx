// Strona główna w trybie „NAJNOWSZE WPISY": paginowana siatka archiwum pod
// adresem `/`.
//
// ORGANIZM, bo skleja dane z prezentacją: czyta ustawienia czytania
// (`posts_per_page`) i stronę archiwum przez `useSuspenseQuery`, dokłada
// wstawki in-feed i zamienia klik w paginację na nawigację routera.
//
// KLUCZ ZAPYTANIA MUSI BYĆ IDENTYCZNY JAK W LOADERZE trasy `/`. Rozjazd
// choćby o rozmiar strony oznacza DRUGI fetch przy hydracji najczęściej
// odwiedzanej trasy serwisu - dlatego `pageSize` liczy tu ten sam
// `resolvePostsPerPage` z tej samej mapy ustawień.
//
// NUMER STRONY PRZYCHODZI PROPSEM, nie z `Route.useSearch()`. Import trasy
// w komponencie zamknąłby cykl (`routes/index.tsx` -> ten plik -> `routes/index.tsx`),
// a poza tym organizm nie ma po co znać gramatyki adresu - zna tylko liczbę.
import { useTransition } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { PaginatedPostGrid } from "@/components/archive/PaginatedPostGrid";
import { useInFeedAds } from "@/components/ads/useInFeedAds";
import { homePageSearch, homeTotalPages } from "@/components/home/atoms/homePagination";
import { blogArchiveQueryOptions, resolvePostsPerPage } from "@/lib/queries/public";
import { siteSettingsQueryOptions } from "@/lib/useSiteSetting";
import { HomeLoadingNotice } from "@/components/home/molecules/HomeLoadingNotice";

export function LatestPostsHome({ lang, page }: { lang: "pl" | "en"; page: number }) {
  const { data: settingsMap } = useSuspenseQuery(siteSettingsQueryOptions);
  const pageSize = resolvePostsPerPage(settingsMap);
  const archiveQuery = useSuspenseQuery(blogArchiveQueryOptions({ page, pageSize }));
  const { posts, total } = archiveQuery.data;
  const navigate = useNavigate();
  const router = useRouter();
  // Zmiana strony biegnie w transition - obecna siatka zostaje na ekranie
  // (bez pustego fallbacku), a isPending steruje stanem kontrolek paginacji.
  const [isPending, startTransition] = useTransition();
  const { t } = useTranslation();
  // Strona główna w trybie „najnowsze wpisy" honoruje placementy in_feed
  // zadeklarowane dla typu „Strona główna" (dotąd emitowały się tylko na /blog).
  const inFeed = useInFeedAds("home");
  const totalPages = homeTotalPages(total, pageSize);

  // SEO: realne adresy stron wyników (linkowa paginacja). publicHref przechodzi
  // przez rewrite routera, więc niesie właściwy prefiks języka (/en?page=2).
  const hrefFor = (nextPage: number) =>
    router.buildLocation({ to: "/", search: homePageSearch(nextPage) }).publicHref;
  const onPageChange = (nextPage: number) =>
    startTransition(() => {
      void navigate({ to: "/", search: homePageSearch(nextPage) });
    });

  if (archiveQuery.dataUpdatedAt === 0) {
    return <HomeLoadingNotice onRetry={() => void archiveQuery.refetch()} />;
  }

  return (
    <div className="max-w-[1200px] w-full mx-auto px-4 lg:px-8 py-10">
      {/* Pusty stan bierzemy z `blog.empty`: korzeń `home` nie istnieje w
          słowniku, a strona główna w trybie „najnowsze wpisy” renderuje tę samą
          siatkę co /blog - jeden klucz zamiast dwóch kopii tego samego zdania. */}
      <PaginatedPostGrid
        posts={posts}
        page={page}
        totalPages={totalPages}
        lang={lang}
        emptyText={t("blog.empty")}
        isPending={isPending}
        onPageChange={onPageChange}
        hrefFor={hrefFor}
        renderAfterCard={inFeed}
      />
    </div>
  );
}
